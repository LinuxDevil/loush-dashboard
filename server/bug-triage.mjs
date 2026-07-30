import { CLAUDE, readJson, readVersions, track } from './dashboard-core.mjs'
import { exec, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { projCfg, readBoard, writeBoard } from './board.mjs'

const BUGS_FILE = path.join(CLAUDE, 'bugs.json')

const readBugs = () => readJson(BUGS_FILE, [])

const writeBugs = b => track(BUGS_FILE, JSON.stringify(b, null, 2), { summary: 'update bugs' })

function parseTrace(text) {
  const frames = [], seen = new Set()
  const push = (file, line, fn) => { const k = file + ':' + line; if (!seen.has(k) && frames.length < 20 && !/node_modules/.test(file)) { seen.add(k); frames.push({ file, line: Number(line) || null, fn: fn || null }) } }
  for (const m of text.matchAll(/at (\S+) \((.*?):(\d+):\d+\)/g)) push(m[2], m[3], m[1])
  for (const m of text.matchAll(/at ((?:\/|\.{1,2}\/|[A-Za-z]:\\)[^\s():]+):(\d+):\d+/g)) push(m[1], m[2])
  for (const m of text.matchAll(/File "(.*?)", line (\d+)(?:, in (\S+))?/g)) push(m[1], m[2], m[3])
  for (const m of text.matchAll(/((?:\/|\.{1,2}\/)[\w./-]+\.\w{1,5}):(\d+)/g)) push(m[1], m[2])
  const links = [...text.matchAll(/https?:\/\/\S+/g)].map(m => m[0]).slice(0, 5)
  return { frames, links }
}

const REVIEW_TRAIL_FILE = path.join(CLAUDE, 'chat-review-trail.json')

const readReviewTrail = () => readJson(REVIEW_TRAIL_FILE, [])

const bisects = new Map()

export default function mountBugTriage(app) {
app.get('/api/bugs', (req, res) => res.json(readBugs().map(b => ({ ...b, bisect: bisects.get(b.id) || null }))))

app.post('/api/bugs', (req, res) => {
  const { project, title, severity, intake } = req.body
  if (!title?.trim()) return res.status(400).json({ error: 'title required' })
  const bugs = readBugs()
  const bug = { id: 'bug' + Date.now().toString(36), project: project || null, title: title.trim(), severity: severity || 'medium', status: 'open', intake: String(intake || '').slice(0, 20000), ...parseTrace(String(intake || '')), createdAt: Date.now(), fix: null, boardTicketId: null }
  if (project && fs.existsSync(project)) {
    try {
      const board = readBoard()
      const pipe = board.pipelines.find(p => p.id === projCfg(board, project).pipeline) || board.pipelines[0]
      const t = {
        id: 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        project, title: bug.title, desc: `Filed from Bugs (${bug.id}, ${bug.severity}).`, type: 'bug',
        parent: null, deps: [], team: null, model: null, bugId: bug.id,
        stage: 'backlog', stages: pipe.stages, pipelineVersion: `${pipe.id}@v${pipe.version}`,
        blocked: null, branch: null, worktree: null, qa: null, qaResults: [], findings: [], runs: [], conflictRisk: [], preview: null, proposal: null,
        history: [{ at: Date.now(), from: null, to: 'backlog', note: 'created from bug ' + bug.id }], createdAt: Date.now(), releasedAt: null,
      }
      board.tickets.push(t); writeBoard(board)
      bug.boardTicketId = t.id
    } catch {}
  }
  bugs.push(bug); writeBugs(bugs)
  res.json(bug)
})

app.patch('/api/bugs/:id', (req, res) => {
  const bugs = readBugs()
  const b = bugs.find(x => x.id === req.params.id)
  if (!b) return res.status(404).json({ error: 'no such bug' })
  for (const k of ['status', 'severity', 'title', 'project']) if (req.body[k] !== undefined) b[k] = req.body[k]
  if (req.body.status === 'fixed' && !b.fix) b.fix = { at: Date.now(), configVersion: readVersions().slice(-1)[0]?.id || null, sessionId: req.body.sessionId || null }
  writeBugs(bugs)
  res.json(b)
})

app.delete('/api/bugs/:id', (req, res) => { writeBugs(readBugs().filter(b => b.id !== req.params.id)); res.json({ ok: true }) })

// ---------- L1: chat review trail — record accept/reject per assistant output so "human reviews every
// output" is logged, not implicit. Same git-tracked JSON-store pattern as bugs above. ----------

app.get('/api/chat-review', (req, res) => res.json(readReviewTrail()))

app.post('/api/chat-review', (req, res) => {
  const { chatId, cwd, verdict, text, note } = req.body
  if (!['accept', 'reject'].includes(verdict)) return res.status(400).json({ error: 'verdict must be accept|reject' })
  const trail = readReviewTrail()
  const entry = { id: Math.random().toString(36).slice(2, 10), chatId: chatId || null, cwd: cwd || null, verdict, text: String(text || '').slice(0, 2000), note: String(note || '').slice(0, 500), ts: Date.now() }
  trail.push(entry)
  track(REVIEW_TRAIL_FILE, JSON.stringify(trail, null, 2), { summary: `chat review: ${verdict}` })
  res.json({ ok: true, entry })
})

app.post('/api/bugs/:id/bisect', (req, res) => {
  const bug = readBugs().find(b => b.id === req.params.id)
  const { good, cmd } = req.body
  if (!bug?.project || !fs.existsSync(bug.project)) return res.status(400).json({ error: 'bug has no valid project' })
  if (!good || !cmd) return res.status(400).json({ error: 'need a last-known-good ref and a repro command (exit 0 = good)' })
  if (bisects.get(bug.id)?.status === 'running') return res.status(409).json({ error: 'bisect already running' })
  bisects.set(bug.id, { status: 'running', startedAt: Date.now() })
  res.json({ ok: true })
  ;(async () => {
    const g = args => spawnSync('git', ['-C', bug.project, ...args], { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 })
    try {
      const dirty = g(['status', '--porcelain']).stdout.toString().trim()
      if (dirty) return bisects.set(bug.id, { status: 'error', log: 'working tree is dirty — commit or stash first (bisect checks out old commits)' })
      g(['bisect', 'reset'])
      const start = g(['bisect', 'start', 'HEAD', good])
      if (start.status !== 0) return bisects.set(bug.id, { status: 'error', log: start.stderr.toString().slice(0, 1000) })
      const run = g(['bisect', 'run', 'sh', '-c', cmd])
      const out = run.stdout.toString() + run.stderr.toString()
      const m = /([0-9a-f]{40}) is the first bad commit/.exec(out)
      let culprit = null
      if (m) {
        const show = g(['show', '-s', '--format=%h%n%an%n%ad%n%s', m[1]]).stdout.toString().split('\n')
        culprit = { hash: m[1], short: show[0], author: show[1], date: show[2], subject: show[3], stat: g(['show', '--stat', '--format=', m[1]]).stdout.toString().slice(0, 2000) }
      }
      bisects.set(bug.id, { status: culprit ? 'done' : 'error', culprit, log: out.slice(-1500), finishedAt: Date.now() })
    } catch (e) { bisects.set(bug.id, { status: 'error', log: e.message }) }
    finally { g(['bisect', 'reset']) }
  })()
})

app.get('/api/bugs/:id/context', (req, res) => {
  const bug = readBugs().find(b => b.id === req.params.id)
  if (!bug) return res.status(404).json({ error: 'no such bug' })
  const blames = []
  if (bug.project && fs.existsSync(bug.project)) {
    for (const fr of (bug.frames || []).slice(0, 6)) {
      if (!fr.line) continue
      const rel = fr.file.startsWith('/') ? path.relative(bug.project, fr.file) : fr.file
      if (rel.startsWith('..')) continue
      const r = spawnSync('git', ['-C', bug.project, 'blame', '-L', `${Math.max(1, fr.line - 2)},${fr.line + 2}`, '--date=short', '--', rel], { timeout: 5000 })
      if (r.status === 0) blames.push({ file: rel, line: fr.line, blame: r.stdout.toString().slice(0, 800) })
    }
  }
  const culprit = bisects.get(bug.id)?.culprit
  const prompt = [
    `Root-cause this bug: ${bug.title} (severity: ${bug.severity})`,
    '',
    '## Trace / intake', '```', bug.intake.slice(0, 4000), '```',
    (bug.frames || []).length ? '\n## Suspect files — read these first\n' + bug.frames.slice(0, 8).map(f => `- read @${f.file}${f.line ? ` (line ${f.line}${f.fn ? `, in ${f.fn}` : ''})` : ''}`).join('\n') : '',
    blames.length ? '\n## git blame around the suspect lines\n' + blames.map(b => `${b.file}:${b.line}\n\`\`\`\n${b.blame}\`\`\``).join('\n') : '',
    culprit ? `\n## Bisect culprit\n${culprit.short} by ${culprit.author} (${culprit.date}): ${culprit.subject}\n\`\`\`\n${culprit.stat}\`\`\`` : '',
    '\nFind the root cause, fix it, then write a regression test that fails before the fix and passes after.',
  ].filter(Boolean).join('\n')
  res.json({ prompt, blames, culprit: culprit || null })
})

// ---------- 26: native hooks — matcher test, dry-run, health, pattern library ----------
}
