import { CLAUDE, propose, readJson, track } from './dashboard-core.mjs'
import { exec, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { runAgent } from '../lib/agent.mjs'

const BOARD_FILE = path.join(CLAUDE, 'taskboard.json')

const WORKTREES = path.join(CLAUDE, 'board-worktrees')

const DEFAULT_STAGES = ['backlog', 'in-progress', 'code-review', 'fixing', 'ready-for-qa', 'qa-running', 'bug-reported', 'ready-for-release', 'released']

const DEFAULT_BOARD = {
  teams: [],
  pipelines: [
    { id: 'default', name: 'Team Production', version: 1, stages: DEFAULT_STAGES, wip: {} },
    { id: 'solo', name: 'Solo Side Project', version: 1, stages: ['backlog', 'in-progress', 'ready-for-release', 'released'], wip: {} },
  ],
  projects: {},
  tickets: [],
}

const readBoard = () => { const b = readJson(BOARD_FILE, {}); return { ...DEFAULT_BOARD, ...b, pipelines: b.pipelines?.length ? b.pipelines : DEFAULT_BOARD.pipelines } }

const writeBoard = b => track(BOARD_FILE, JSON.stringify(b, null, 2), { summary: 'update task board' })

const projCfg = (board, project) => ({ pipeline: 'default', base: 'main', branchPrefix: 'ticket/', mergeMethod: 'merge', requirePr: false, defaultModel: '', previewCmd: '', previewStopCmd: '', previewIdleMin: 240, qaSeesFindings: false, ...(board.projects[project] || {}) })

const tkt = (board, id) => board.tickets.find(t => t.id === id)

const stamp = (t, to, note) => { (t.history ||= []).push({ at: Date.now(), from: t.stage, to, note: note || '' }); t.stage = to; if (to === 'released') { loushRunEmit(t.project, t.id, 'run.completed', { status: 'completed' }); loushRunState(t.project, t.id, 'released', 'passed') } }

const blockT = (t, by, category, reason, needed) => { t.blocked = { at: Date.now(), by, category, reason: String(reason).slice(0, 1500), needed: needed || '' }; (t.history ||= []).push({ at: Date.now(), from: t.stage, to: 'blocked:' + category, note: String(reason).slice(0, 200) }) }

const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

const extractJson = s => { for (const re of [/\[[\s\S]*\]/, /\{[\s\S]*\}/]) { const m = re.exec(s || ''); if (m) try { return JSON.parse(m[0]) } catch {} } return null }

const boardRuns = new Map()

function loushRunEmit(project, ticket, type, data) {
  if (!project || !fs.existsSync(project)) return
  try {
    const dir = path.join(project, '.loush', ticket)
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, 'events.jsonl')
    const n = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0
    const rows = []
    if (n === 0) rows.push({ seq: 1, t: new Date().toISOString(), type: 'run.started', data: { flow: 'board' } })
    rows.push({ seq: n + rows.length + 1, t: new Date().toISOString(), type, data })
    fs.appendFileSync(f, rows.map(x => JSON.stringify(x)).join('\n') + '\n')
  } catch {}
}

function loushRunState(project, ticket, phase, phase_status) {
  if (!project || !fs.existsSync(project)) return
  try {
    const dir = path.join(project, '.loush', ticket)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ticket_id: ticket, flow: 'board', phase, phase_status, updated_at: new Date().toISOString() }, null, 2))
  } catch {}
}

function recordRun(t, kind, model, r, handoff) {
  (t.runs ||= []).push({ at: Date.now(), kind, model: model || 'default', status: r.error ? 'error' : r.blocked ? 'blocked' : 'ok', cost: r.cost || 0, turns: r.turns || 0, ms: r.ms || 0, sessionId: r.sessionId || null, summary: (r.result || r.error || '').slice(0, 1500), handoff })
  loushRunEmit(t.project, t.id, 'step.completed', { label: kind, agent: 'board:' + kind, status: r.error ? 'failed' : r.blocked ? 'blocked' : 'passed' })
  loushRunState(t.project, t.id, kind, 'running')
}

const teamStage = (board, t, stageKind) => { const team = board.teams.find(x => x.id === t.team); const s = team?.stages?.[stageKind] || {}; return { model: t.model || s.model || projCfg(board, t.project).defaultModel || undefined, instructions: s.instructions || '' } }

const gitB = (project, args, timeout = 60_000) => spawnSync('git', ['-C', project, ...args], { timeout, maxBuffer: 8 * 1024 * 1024 })

const changedFiles = (project, base, ref) => { const r = gitB(project, ['diff', '--name-only', `${base}...${ref}`]); return r.status === 0 ? r.stdout.toString().trim().split('\n').filter(Boolean) : [] }

function conflictScan(board, t) {
  if (!t.branch || !fs.existsSync(t.project)) return
  const cfg = projCfg(board, t.project)
  const mine = new Set(changedFiles(t.project, cfg.base, t.branch))
  t.conflictRisk = []
  for (const o of board.tickets) {
    if (o.id === t.id || o.project !== t.project || !o.branch || o.stage === 'released' || o.stage === 'backlog') continue
    const overlap = changedFiles(t.project, cfg.base, o.branch).filter(f => mine.has(f))
    if (overlap.length) t.conflictRisk.push({ ticket: o.id, title: o.title, files: overlap.slice(0, 10) })
  }
}

function ensureWorktree(board, t) {
  const cfg = projCfg(board, t.project)
  t.branch ||= cfg.branchPrefix + t.id
  t.worktree ||= path.join(WORKTREES, t.id)
  if (fs.existsSync(path.join(t.worktree, '.git'))) return null
  fs.mkdirSync(WORKTREES, { recursive: true })
  const dep = (t.deps || []).map(d => tkt(board, d)).find(d => d?.branch && d.project === t.project)
  const baseRef = dep?.branch && gitB(t.project, ['rev-parse', '--verify', dep.branch]).status === 0 ? dep.branch : cfg.base
  const r = gitB(t.project, ['worktree', 'add', t.worktree, '-b', t.branch, baseRef])
  if (r.status !== 0) {
    const r2 = gitB(t.project, ['worktree', 'add', t.worktree, t.branch])
    if (r2.status !== 0) return (r.stderr.toString() + r2.stderr.toString()).slice(0, 800)
  }
  t.basedOn = baseRef
  return null
}

function startTicket(id, { model: modelOverride, reply, resume } = {}, res) {
  const board = readBoard(); const t = tkt(board, id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'already running' })
  const unmet = (t.deps || []).map(d => tkt(board, d)).filter(d => d && !['ready-for-release', 'released'].includes(d.stage))
  if (unmet.length) return res.status(400).json({ error: 'blocked by: ' + unmet.map(d => d.title).join(', ') })
  const pipe = board.pipelines.find(p => p.id === projCfg(board, t.project).pipeline) || board.pipelines[0]
  const wip = pipe.wip?.['in-progress']
  if (wip && board.tickets.filter(x => x.project === t.project && x.stage === 'in-progress').length >= wip) return res.status(400).json({ error: `WIP limit for in-progress is ${wip}` })
  if (modelOverride) t.model = modelOverride
  const wtErr = ensureWorktree(board, t)
  if (wtErr) { blockT(t, 'system', 'provision', 'worktree/branch creation failed: ' + wtErr); writeBoard(board); return res.status(400).json({ error: wtErr }) }
  const { model, instructions } = teamStage(board, t, 'dev')
  const kids = board.tickets.filter(x => x.parent === t.id)
  stamp(t, 'in-progress', 'dev agent started' + (model ? ' (' + model + ')' : ''))
  boardRuns.set(t.id, { kind: 'dev', startedAt: Date.now() })
  writeBoard(board)
  res.json({ ok: true })
  ;(async () => {
    const prompt = [
      `Implement this ticket. You are in an isolated git worktree on branch ${t.branch} — commit incrementally with clear messages. Run the project's tests/build before declaring done.`,
      instructions, `\n## Ticket: ${t.title}\n${t.desc}`,
      kids.length ? '\n## Accepted sub-ticket breakdown\n' + kids.map(k => `- ${k.title}: ${k.desc}`).join('\n') : '',
      t.type === 'bug' && t.qaEvidence ? '\n## QA evidence / repro\n' + t.qaEvidence : '',
      reply ? '\n## Answer to your blocking question\n' + reply : '',
      '\nIf you hit a genuinely ambiguous requirement, missing credential, or unresolvable dependency: stop and print a final line "BLOCKED: <exactly what you need>".',
    ].filter(Boolean).join('\n')
    const r = await runAgent({ cwd: t.worktree, prompt, model, resume })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    recordRun(t2, 'dev', model, r, { passed: ['ticket', 'sub-ticket breakdown', 'worktree codebase + CLAUDE.md', ...(reply ? ['unblock reply'] : [])], excluded: ['prior tickets', 'other branches'] })
    if (r.error) blockT(t2, 'dev agent', 'agent-error', r.error)
    else if (r.blocked) blockT(t2, 'dev agent', 'needs-input', r.blocked, r.blocked)
    else { stamp(t2, 'code-review', 'dev done — idle until you run code review'); conflictScan(b2, t2) }
    writeBoard(b2)
  })().catch(() => boardRuns.delete(t.id))
}

const previews = new Map()

function startPreview(board, t) {
  const cfg = projCfg(board, t.project)
  if (!cfg.previewCmd || previews.has(t.id)) return
  const child = spawn('sh', ['-c', cfg.previewCmd], { cwd: t.worktree || t.project, env: { ...process.env, TICKET: t.id, BRANCH: t.branch || '', WORKTREE: t.worktree || '' }, detached: true })
  previews.set(t.id, child)
  let out = ''
  const onData = d => {
    out += d
    const m = /https?:\/\/[^\s'"]+/.exec(out)
    if (m && !t.preview?.url) {
      const b2 = readBoard(); const t2 = tkt(b2, t.id)
      if (t2) { t2.preview = { url: m[0], startedAt: Date.now() }; if (t2.qa) t2.qa.baseUrl = m[0]; else t2.qa = { baseUrl: m[0] }; writeBoard(b2) }
    }
  }
  child.stdout.on('data', onData); child.stderr.on('data', onData)
  child.on('exit', code => {
    previews.delete(t.id)
    if (code && !out.includes('http')) {
      const b2 = readBoard(); const t2 = tkt(b2, t.id)
      if (t2 && t2.stage === 'ready-for-qa') { blockT(t2, 'preview provisioning', 'provision', 'preview command exited ' + code + ':\n' + out.slice(-1200)); writeBoard(b2) }
    }
  })
}

function stopPreview(t) {
  const child = previews.get(t.id)
  if (child) { try { process.kill(-child.pid) } catch { try { child.kill() } catch {} }; previews.delete(t.id) }
  if (t.preview) t.preview = null
}

const mergeLocks = new Map()

export default function mountBoard(app) {
app.get('/api/board', (req, res) => {
  const board = readBoard()
  const project = req.query.project
  const tickets = board.tickets.filter(t => !project || t.project === project).map(t => ({
    ...t,
    running: boardRuns.get(t.id) || null,
    depBlocked: (t.deps || []).filter(d => { const o = tkt(board, d); return o && !['ready-for-release', 'released'].includes(o.stage) }),
  }))
  res.json({ tickets, teams: board.teams, pipelines: board.pipelines, config: project ? projCfg(board, project) : null })
})

app.post('/api/board/tickets', (req, res) => {
  const { project, title, desc, parent, deps, team, model, type, jiraKey, designDoc } = req.body
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'valid project required' })
  if (!title?.trim()) return res.status(400).json({ error: 'title required' })
  const board = readBoard()
  const cfg = projCfg(board, project)
  const pipe = board.pipelines.find(p => p.id === cfg.pipeline) || board.pipelines[0]
  const t = {
    id: 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    project, title: title.trim(), desc: String(desc || '').slice(0, 20000), type: type || 'feature',
    parent: parent || null, deps: deps || [], team: team || null, model: model || null,
    jiraKey: typeof jiraKey === 'string' && jiraKey ? jiraKey.toUpperCase() : null,
    designDoc: typeof designDoc === 'string' && designDoc ? designDoc : null,
    stage: 'backlog', stages: pipe.stages, pipelineVersion: `${pipe.id}@v${pipe.version}`,
    blocked: null, branch: null, worktree: null, qa: null, qaResults: [], findings: [], runs: [], conflictRisk: [], preview: null, proposal: null,
    history: [{ at: Date.now(), from: null, to: 'backlog', note: 'created' }], createdAt: Date.now(), releasedAt: null,
  }
  board.tickets.push(t); writeBoard(board)
  res.json(t)
})

app.patch('/api/board/tickets/:id', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  for (const k of ['title', 'desc', 'team', 'model', 'deps', 'qa', 'type']) if (req.body[k] !== undefined) t[k] = req.body[k]
  if (req.body.stage && req.body.stage !== t.stage) {
    stamp(t, req.body.stage, 'manual move')
    if (req.body.stage === 'released') { t.releasedAt = Date.now(); stopPreview(t) }
  }
  if (req.body.blocked === null && t.blocked) { t.blocked = null; (t.history ||= []).push({ at: Date.now(), from: 'blocked', to: t.stage, note: 'manually unblocked' }) }
  writeBoard(board); res.json(t)
})

app.delete('/api/board/tickets/:id', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (t) { stopPreview(t); if (t.worktree && fs.existsSync(t.worktree)) gitB(t.project, ['worktree', 'remove', '--force', t.worktree]) }
  board.tickets = board.tickets.filter(x => x.id !== req.params.id)
  writeBoard(board); res.json({ ok: true })
})

app.post('/api/board/tickets/:id/analyze', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'a run is already active on this ticket' })
  const { model } = teamStage(board, t, 'dev')
  boardRuns.set(t.id, { kind: 'analyze', startedAt: Date.now() })
  res.json({ ok: true })
  ;(async () => {
    const prompt = `Analyze this ticket and propose a breakdown into independently-workable sub-tickets (e.g. "add API endpoint", "add frontend form", "write migration"). Explore the codebase briefly to ground the breakdown.\n\n## Ticket: ${t.title}\n${t.desc}\n\nReturn ONLY a JSON array: [{"title": "...", "desc": "1-3 sentence scope incl. likely files", "deps": [indices of sub-tickets this one is blocked by]}]. 2-6 sub-tickets; fewer is better.`
    const r = await runAgent({ cwd: t.project, prompt, model, timeoutMs: 300_000 })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    recordRun(t2, 'analyze', model, r, { passed: ['ticket title+desc', 'codebase (agent-explored)'], excluded: ['prior tickets', 'chat history'] })
    t2.proposal = r.error ? null : (extractJson(r.result) || []).filter(s => s.title).slice(0, 8)
    writeBoard(b2)
  })().catch(() => boardRuns.delete(t.id))
})

app.post('/api/board/tickets/:id/breakdown', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  const subs = (req.body.subs || []).filter(s => s.title?.trim())
  const ids = subs.map(() => 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5))
  subs.forEach((s, i) => board.tickets.push({
    id: ids[i], project: t.project, title: s.title.trim(), desc: String(s.desc || ''), type: 'sub', parent: t.id,
    deps: (s.deps || []).map(d => ids[d]).filter(Boolean), team: t.team, model: t.model,
    stage: 'backlog', stages: t.stages, pipelineVersion: t.pipelineVersion,
    blocked: null, branch: null, worktree: null, qa: null, qaResults: [], findings: [], runs: [], conflictRisk: [], preview: null, proposal: null,
    history: [{ at: Date.now(), from: null, to: 'backlog', note: 'from breakdown of ' + t.id }], createdAt: Date.now(), releasedAt: null,
  }))
  t.proposal = null
  writeBoard(board); res.json({ ok: true, created: ids.length })
})

app.post('/api/board/tickets/:id/start', (req, res) => startTicket(req.params.id, req.body, res))

app.post('/api/board/tickets/:id/review', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t?.worktree) return res.status(400).json({ error: 'no worktree — start the ticket first' })
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'already running' })
  const { model, instructions } = teamStage(board, t, 'review')
  const cfg = projCfg(board, t.project)
  const devRun = (t.runs || []).filter(r => r.kind === 'dev').pop()
  boardRuns.set(t.id, { kind: 'review', startedAt: Date.now() })
  writeBoard(board)
  res.json({ ok: true })
  ;(async () => {
    const prompt = [
      `Senior code review of this branch. Run \`git diff ${cfg.base}...HEAD\` and review the changes against the ticket. ${instructions}`,
      `\n## Ticket: ${t.title}\n${t.desc}`,
      devRun ? '\n## Dev agent summary of what it did\n' + devRun.summary : '',
      '\nReturn ONLY JSON: [{"severity": "critical|high|medium|low", "file": "path", "summary": "one sentence"}]. Empty array [] if clean. critical/high = must fix before QA.',
    ].filter(Boolean).join('\n')
    const r = await runAgent({ cwd: t.worktree, prompt, model, timeoutMs: 900_000 })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    recordRun(t2, 'review', model, r, { passed: ['diff vs ' + cfg.base, 'ticket', 'dev agent summary'], excluded: ['dev agent raw transcript'] })
    if (r.error) blockT(t2, 'review agent', 'agent-error', r.error)
    else {
      t2.findings = (extractJson(r.result) || []).filter(f => f.summary).map(f => ({ ...f, at: Date.now() }))
      const blocking = t2.findings.filter(f => ['critical', 'high'].includes(f.severity))
      if (!blocking.length) { stamp(t2, 'ready-for-qa', `review clean (${t2.findings.length} minor) — idle until you run QA`); startPreview(b2, t2) }
      else stamp(t2, 'code-review', `${blocking.length} blocking finding${blocking.length === 1 ? '' : 's'}`)
    }
    writeBoard(b2)
  })().catch(() => boardRuns.delete(t.id))
})

app.post('/api/board/tickets/:id/fix', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t?.findings?.length) return res.status(400).json({ error: 'no findings to fix' })
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'already running' })
  const fixes = (t.runs || []).filter(r => r.kind === 'fix').length
  if (fixes >= 3) { blockT(t, 'fix loop', 'max-iterations', '3 fix iterations without a clean review — take over manually'); writeBoard(board); return res.status(400).json({ error: 'max fix iterations hit — ticket blocked' }) }
  const { model } = teamStage(board, t, 'dev')
  const cfg = projCfg(board, t.project)
  stamp(t, 'fixing', 'auto-fixing review findings (' + (fixes + 1) + '/3)')
  boardRuns.set(t.id, { kind: 'fix', startedAt: Date.now() })
  writeBoard(board)
  res.json({ ok: true })
  ;(async () => {
    const prompt = `Fix these code-review findings on the current branch (diff vs ${cfg.base}). Commit the fixes. Do NOT re-architect — address the findings only.\n\n## Ticket: ${t.title}\n\n## Findings\n${t.findings.map(f => `- [${f.severity}] ${f.file}: ${f.summary}`).join('\n')}`
    const r = await runAgent({ cwd: t.worktree, prompt, model, resume: (t.runs || []).filter(x => x.kind === 'dev' && x.sessionId).pop()?.sessionId })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    recordRun(t2, 'fix', model, r, { passed: ['findings', 'original diff context (resumed session when possible)'], excluded: ['full codebase re-read'] })
    if (r.error) blockT(t2, 'fix agent', 'agent-error', r.error)
    else stamp(t2, 'code-review', 'fixes committed — re-run code review')
    writeBoard(b2)
  })().catch(() => boardRuns.delete(t.id))
})

app.post('/api/board/tickets/:id/preview', (req, res) => { const b = readBoard(); const t = tkt(b, req.params.id); if (!t) return res.status(404).json({ error: 'no such ticket' }); startPreview(b, t); writeBoard(b); res.json({ ok: true }) })

app.delete('/api/board/tickets/:id/preview', (req, res) => { const b = readBoard(); const t = tkt(b, req.params.id); if (t) { stopPreview(t); writeBoard(b) } res.json({ ok: true }) })
setInterval(() => {
  const b = readBoard(); let dirty = false
  for (const t of b.tickets) if (t.preview && Date.now() - t.preview.startedAt > projCfg(b, t.project).previewIdleMin * 60_000) { stopPreview(t); dirty = true }
  if (dirty) writeBoard(b)
}, 600_000).unref()

app.post('/api/board/tickets/:id/qa', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t?.worktree) return res.status(400).json({ error: 'no worktree — start the ticket first' })
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'already running' })
  const pipe = board.pipelines.find(p => p.id === projCfg(board, t.project).pipeline) || board.pipelines[0]
  const wip = pipe.wip?.['qa-running']
  if (wip && board.tickets.filter(x => x.project === t.project && x.stage === 'qa-running').length >= wip) return res.status(400).json({ error: `WIP limit for qa-running is ${wip}` })
  t.qa = { ...(t.qa || {}), ...req.body }
  const cfg = projCfg(board, t.project)
  const { model, instructions } = teamStage(board, t, 'qa')
  const files = changedFiles(t.project, cfg.base, t.branch || 'HEAD')
  stamp(t, 'qa-running', 'QA agent started')
  boardRuns.set(t.id, { kind: 'qa', startedAt: Date.now() })
  writeBoard(board)
  res.json({ ok: true })
  ;(async () => {
    const prompt = [
      `You are a QA agent. From the ticket below, derive acceptance criteria (if not given) and a concrete test-case list (functional, edge cases, regression-relevant). Execute each case: API assertions via curl, UI flows via browser tools if available — otherwise mark them "manual" with exact steps. Capture evidence (response bodies, observed text).`,
      instructions,
      `\n## Ticket: ${t.title}\n${t.desc}`,
      `\n## Changed files (focus tests here)\n${files.slice(0, 40).join('\n') || '(unknown)'}`,
      `\n## Environment\nbase URL: ${t.qa.baseUrl || '(none — API/unit-level checks only)'}\nenv: ${t.qa.env || 'staging'}\nscope: ${t.qa.scope || 'whole ticket'}\nlogin/notes: ${t.qa.notes || '-'}`,
      cfg.qaSeesFindings && t.findings?.length ? '\n## Code-review findings (user opted QA in)\n' + t.findings.map(f => `- ${f.summary}`).join('\n') : '',
      '\nReturn ONLY JSON: {"cases": [{"name": "...", "kind": "ui|api|manual", "pass": true|false, "severity": "critical|high|medium|low", "evidence": "≤300 chars"}]}',
    ].filter(Boolean).join('\n')
    const r = await runAgent({ cwd: t.worktree, prompt, model, timeoutMs: 1800_000 })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    recordRun(t2, 'qa', model, r, { passed: ['ticket+AC', 'changed files list', 'preview URL + QA inputs', ...(cfg.qaSeesFindings ? ['review findings (opt-in)'] : [])], excluded: cfg.qaSeesFindings ? [] : ['code-review findings'] })
    if (r.error) return blockT(t2, 'QA agent', 'agent-error', r.error), writeBoard(b2)
    const cases = (extractJson(r.result)?.cases || []).slice(0, 60)
    const failed = cases.filter(c => c.pass === false)
    ;(t2.qaResults ||= []).push({ at: Date.now(), cases, pass: !failed.length })
    if (failed.length) {
      stamp(t2, 'bug-reported', `${failed.length} QA failure${failed.length === 1 ? '' : 's'} — bugs filed`)
      for (const c of failed.slice(0, 5)) b2.tickets.push({
        id: 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        project: t2.project, title: 'QA bug: ' + c.name, type: 'bug', parent: t2.id,
        desc: `QA-found on ${t2.branch} @ ${gitB(t2.project, ['rev-parse', '--short', t2.branch]).stdout?.toString().trim() || '?'}\nseverity: ${c.severity || 'medium'}\n\nrepro / evidence:\n${c.evidence || '(see QA run)'}`,
        qaEvidence: c.evidence || '', deps: [], team: t2.team, model: t2.model,
        stage: 'backlog', stages: t2.stages, pipelineVersion: t2.pipelineVersion,
        blocked: null, branch: t2.branch, worktree: t2.worktree, qa: t2.qa, qaResults: [], findings: [], runs: [], conflictRisk: [], preview: null, proposal: null,
        history: [{ at: Date.now(), from: null, to: 'backlog', note: 'auto-filed by QA on ' + t2.id }], createdAt: Date.now(), releasedAt: null,
      })
    } else stamp(t2, 'ready-for-release', 'QA clean — human release gate')
    writeBoard(b2)
  })().catch(() => boardRuns.delete(t.id))
})

app.post('/api/board/tickets/:id/release', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  const cfg = projCfg(board, t.project)
  if (cfg.requirePr) {
    stamp(t, 'released', 'marked released (PR flow)'); t.releasedAt = Date.now(); stopPreview(t); writeBoard(board)
    return res.json({ ok: true, prCmd: `cd ${t.project} && gh pr create --head ${t.branch} --base ${cfg.base} --title "${t.title.replace(/"/g, '')}" --body "Ticket ${t.id}"` })
  }
  const prev = mergeLocks.get(t.project) || Promise.resolve()
  const job = prev.then(() => {
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    if (!t2?.branch) return
    const dirty = gitB(t2.project, ['status', '--porcelain']).stdout.toString().trim()
    if (dirty) { blockT(t2, 'merge', 'merge-conflict', 'main working tree is dirty — commit or stash before releasing'); writeBoard(b2); return }
    gitB(t2.project, ['checkout', cfg.base])
    const reb = spawnSync('git', ['-C', t2.worktree, 'rebase', cfg.base], { timeout: 120_000 })
    if (reb.status !== 0) {
      const hunks = spawnSync('git', ['-C', t2.worktree, 'diff'], { timeout: 30_000 }).stdout.toString().slice(0, 3000)
      spawnSync('git', ['-C', t2.worktree, 'rebase', '--abort'], { timeout: 30_000 })
      blockT(t2, 'merge', 'merge-conflict', 'rebase onto ' + cfg.base + ' conflicts:\n' + (reb.stderr.toString().slice(0, 500) || '') + '\n' + hunks)
      writeBoard(b2); return
    }
    const method = cfg.mergeMethod === 'squash' ? ['merge', '--squash', t2.branch] : cfg.mergeMethod === 'rebase' ? ['merge', '--ff-only', t2.branch] : ['merge', '--no-ff', '-m', `merge: ${t2.title} (${t2.id})`, t2.branch]
    const m = gitB(t2.project, method, 120_000)
    if (m.status !== 0) { gitB(t2.project, ['merge', '--abort']); blockT(t2, 'merge', 'merge-conflict', m.stderr.toString().slice(0, 2000)); writeBoard(b2); return }
    if (cfg.mergeMethod === 'squash') gitB(t2.project, ['commit', '-m', `${t2.title} (${t2.id})`])
    const sha = gitB(t2.project, ['rev-parse', '--short', 'HEAD']).stdout.toString().trim()
    stamp(t2, 'released', `merged ${t2.branch} → ${cfg.base} @ ${sha} (${cfg.mergeMethod})`)
    t2.releasedAt = Date.now(); stopPreview(t2)
    if (t2.worktree && fs.existsSync(t2.worktree)) gitB(t2.project, ['worktree', 'remove', '--force', t2.worktree])
    writeBoard(b2)
  }).catch(() => {})
  mergeLocks.set(t.project, job)
  job.then(() => { if (mergeLocks.get(t.project) === job) mergeLocks.delete(t.project) })
  res.json({ ok: true, queued: true })
})

app.post('/api/board/tickets/:id/unblock', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t?.blocked) return res.status(400).json({ error: 'ticket is not blocked' })
  const lastSession = (t.runs || []).filter(r => r.sessionId).pop()?.sessionId
  t.blocked = null
  t.stage = 'backlog'
  ;(t.history ||= []).push({ at: Date.now(), from: 'blocked', to: 'backlog', note: 'unblocked with reply' })
  writeBoard(board)
  startTicket(t.id, { reply: req.body.reply || '', resume: lastSession }, res)
})

app.post('/api/board/teams', (req, res) => {
  const board = readBoard(); const team = req.body
  if (!team.name?.trim()) return res.status(400).json({ error: 'name required' })
  const existing = board.teams.find(x => x.id === team.id)
  if (existing) Object.assign(existing, team, { version: (existing.version || 1) + 1 })
  else board.teams.push({ ...team, id: 'team' + Date.now().toString(36), version: 1 })
  writeBoard(board); res.json({ ok: true })
})

app.delete('/api/board/teams/:id', (req, res) => { const b = readBoard(); b.teams = b.teams.filter(x => x.id !== req.params.id); writeBoard(b); res.json({ ok: true }) })

app.post('/api/board/pipelines', (req, res) => {
  const board = readBoard(); const p = req.body
  if (!p.name?.trim() || !p.stages?.length) return res.status(400).json({ error: 'name and stages required' })
  const existing = board.pipelines.find(x => x.id === p.id)
  if (existing) Object.assign(existing, p, { version: (existing.version || 1) + 1 })
  else board.pipelines.push({ ...p, id: 'pipe' + Date.now().toString(36), version: 1 })
  writeBoard(board); res.json({ ok: true })
})

app.post('/api/board/config', (req, res) => {
  const { project, ...cfg } = req.body
  if (!project) return res.status(400).json({ error: 'project required' })
  const board = readBoard()
  board.projects[project] = { ...projCfg(board, project), ...cfg }
  writeBoard(board); res.json(board.projects[project])
})

app.get('/api/board/analytics', (req, res) => {
  const board = readBoard()
  const days = Number(req.query.days) || 30
  const since = Date.now() - days * 86400_000
  const tickets = board.tickets.filter(t => (!req.query.project || t.project === req.query.project) && t.createdAt >= since - 90 * 86400_000)
  const stageSet = [...new Set([...DEFAULT_STAGES, ...board.pipelines.flatMap(p => p.stages)])]
  const columns = Object.fromEntries(stageSet.map(s => [s, tickets.filter(t => t.stage === s && !t.blocked).length]))
  const blockedNow = tickets.filter(t => t.blocked)
  const stageDur = {}, blockedDur = {}
  for (const t of tickets) {
    const h = t.history || []
    for (let i = 0; i < h.length; i++) {
      const end = h[i + 1]?.at ?? (t.stage === 'released' ? h[i].at : Date.now())
      const d = Math.max(0, end - h[i].at)
      if (h[i].to.startsWith('blocked:')) (blockedDur[h[i].to.slice(8)] ||= []).push(d)
      else (stageDur[h[i].to] ||= []).push(d)
    }
  }
  const released = tickets.filter(t => t.releasedAt && t.releasedAt >= since)
  const cycles = released.map(t => t.releasedAt - t.createdAt)
  const perDay = {}
  for (const t of released) { const k = new Date(t.releasedAt).toISOString().slice(0, 10); perDay[k] = (perDay[k] || 0) + 1 }
  const bugs = tickets.filter(t => t.type === 'bug' && t.parent)
  const groupBy = key => {
    const g = {}
    for (const t of tickets) {
      const k = key(t) || '(none)'
      const o = g[k] ||= { released: 0, bugs: 0, findings: 0, reviews: 0, cost: 0, cycles: [], escalations: 0, touches: 0 }
      if (t.releasedAt) { o.released++; o.cycles.push(t.releasedAt - t.createdAt) }
      o.bugs += tickets.filter(b => b.type === 'bug' && b.parent === t.id).length
      const firstReview = (t.runs || []).find(r => r.kind === 'review')
      if (firstReview) { o.reviews++; o.findings += (t.findings || []).length }
      o.cost += (t.runs || []).reduce((s, r) => s + (r.cost || 0), 0)
      const models = new Set((t.runs || []).map(r => r.model))
      if (models.size > 1) o.escalations++
      o.touches += (t.runs || []).filter(r => ['review', 'qa', 'fix'].includes(r.kind)).length
    }
    return Object.fromEntries(Object.entries(g).map(([k, o]) => [k, { ...o, avgCycleH: o.cycles.length ? Math.round(o.cycles.reduce((a, b) => a + b, 0) / o.cycles.length / 3600_000 * 10) / 10 : null, bugRatio: o.released ? Math.round(o.bugs / o.released * 100) / 100 : null, cycles: undefined }]))
  }
  const qaDist = { 0: 0, 1: 0, 2: 0, '3+': 0 }
  for (const t of released) { const fails = (t.qaResults || []).filter(q => !q.pass).length; qaDist[fails >= 3 ? '3+' : fails]++ }
  const runCost = kind => tickets.reduce((s, t) => s + (t.runs || []).filter(r => r.kind === kind).reduce((a, r) => a + (r.cost || 0), 0), 0)
  const sunk = tickets.filter(t => !t.releasedAt).reduce((s, t) => s + (t.runs || []).reduce((a, r) => a + (r.cost || 0), 0), 0)
  const caseStats = {}
  for (const t of tickets) for (const q of t.qaResults || []) for (const c of q.cases || []) { const o = caseStats[c.name] ||= { runs: 0, fails: 0 }; o.runs++; if (c.pass === false) o.fails++ }
  const stale = Object.entries(caseStats).filter(([, o]) => o.runs >= 2 && !o.fails).length
  res.json({
    days, total: tickets.length, columns, blockedNow: blockedNow.map(t => ({ id: t.id, title: t.title, category: t.blocked.category, since: t.blocked.at })),
    timeInStageH: Object.fromEntries(Object.entries(stageDur).map(([s, arr]) => [s, { avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length / 3600_000 * 10) / 10, p90: Math.round((pct(arr, 0.9) || 0) / 3600_000 * 10) / 10, n: arr.length }])),
    blockedByReasonH: Object.fromEntries(Object.entries(blockedDur).map(([c, arr]) => [c, Math.round(arr.reduce((a, b) => a + b, 0) / 3600_000 * 10) / 10])),
    cycle: { p50h: cycles.length ? Math.round(pct(cycles, 0.5) / 3600_000 * 10) / 10 : null, p90h: cycles.length ? Math.round(pct(cycles, 0.9) / 3600_000 * 10) / 10 : null, released: released.length },
    throughputPerDay: perDay,
    bugRatio: released.length ? Math.round(bugs.length / released.length * 100) / 100 : null,
    qaCyclesDist: qaDist,
    byTeam: groupBy(t => board.teams.find(x => x.id === t.team)?.name),
    byModel: groupBy(t => t.model || projCfg(board, t.project).defaultModel || '(default)'),
    costByStage: { dev: runCost('dev') + runCost('fix'), review: runCost('review'), qa: runCost('qa') + runCost('analyze') },
    costSunkUnreleased: sunk,
    costPerReleased: released.length ? (tickets.reduce((s, t) => s + (t.runs || []).reduce((a, r) => a + (r.cost || 0), 0), 0) - sunk) / released.length : null,
    staleRegressionCases: stale,
  })
})
}

export { boardRuns, projCfg, readBoard, tkt, writeBoard }
