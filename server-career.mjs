import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { makeStore } from './career-config.mjs'
import { resolveIdentity, warnIfNoMatch } from './career-identity.mjs'
import { buildSnapshot, updateRollup, periodWindow } from './career-snapshot.mjs'
import { importGithub } from './career-import-github.mjs'
import { importJira } from './career-import-jira.mjs'
import { blameMapForBugs } from './career-blame.mjs'
import { analysisKey, runAnalyze } from './career-analyze.mjs'
import { krClosed } from './career-okr.mjs'
import { awardXp } from './career-gamify.mjs'
import { harvestCandidates, distill, evaluateLesson, addLesson } from './career-lessons.mjs'
import { ticketRetro } from './career-retro.mjs'

const HOME = os.homedir()
const CLAUDE = path.join(HOME, '.claude')
const IMPORTS = path.join(CLAUDE, 'career-imports')

// Read-only shell to the already-authed gh CLI (mirrors server-eng.mjs). Never writes back.
function gh(args, timeout = 60000) {
  const r = spawnSync('gh', args, { timeout, maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error('gh: ' + (r.stderr || '').toString().slice(0, 200))
  return r.stdout.toString()
}
// Latest raw drop for a source, or null. Quarantined: a missing/corrupt drop degrades to null.
function latestDrop(source) {
  const dir = path.join(IMPORTS, source)
  let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() } catch { return null }
  const f = files[files.length - 1]
  if (!f) return null
  try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null }
}
function writeDrop(source, data) {
  const dir = path.join(IMPORTS, source); fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, `${Date.now()}.json`)
  fs.writeFileSync(p, JSON.stringify(data))
  return p
}
// authored sections the config POST is allowed to touch (never derived/rollup)
const AUTHORED = new Set(['identity', 'projects', 'competency', 'learning', 'okrs', 'courses', 'ownership',
  'feedback', 'feedbackRequests', 'decisions', 'brag', 'retros', 'timeTarget', 'oneOnOnes',
  'pendingDecisions', 'afterHoursWindow', 'tzOffsetHours', 'focusActed'])

export const __test = { AUTHORED }

const BUCKET_BY_STAGE = { 'ready-for-qa': 'toTest', 'qa-running': 'toTest',
  'in-progress': 'inProgress', 'code-review': 'inProgress', 'fixing': 'inProgress',
  'backlog': 'pending' }

export function mapTicket(t, now = Date.now()) {
  const lastAt = (t.history || []).slice(-1)[0]?.at
  const ageDays = lastAt ? (now - lastAt) / 86400000 : 0
  return { id: t.id, stage: t.stage, bucket: BUCKET_BY_STAGE[t.stage] || 'pending',
    ageDays, slaDays: 5, project: t.project, title: t.title }
}

export default function mountCareer(app, deps = {}) {
  const { track, readJson } = deps
  const careerFile = deps.careerFile || path.join(CLAUDE, 'career.json')
  const usageDir = deps.usageDir || path.join(CLAUDE, 'usage-data')
  const store = makeStore({ file: careerFile, track, readJson })
  const mtimeCache = new Map()
  let cache = null

  // real bug/task/report readers; overridable in deps for tests
  const inWin = (t, w) => { const ms = Date.parse(t); return Number.isNaN(ms) || (ms >= w.start && ms < w.end) }
  const readBugs = deps.readBugs || ((w) => {
    const b = readJson(path.join(CLAUDE, 'bugs.json'), { bugs: [] })
    let bugs = b.bugs || []
    if (w && !w.isYear) bugs = bugs.filter(x => inWin(x.date || x.createdAt || x.closedAt || x.introducedAt, w))
    return { bugs, findings: [], myPrCount: 0, reverts: 0 } // findings/PRs arrive Phase 2 (GitHub)
  })
  const readTasks = deps.readTasks || ((w) => {
    const board = readJson(path.join(CLAUDE, 'taskboard.json'), { tickets: [] })
    let tickets = board.tickets || []
    // ponytail: quarter-scope by a ticket's last activity; undated (no history) tickets stay visible. Ceiling: not per-status.
    if (w && !w.isYear) tickets = tickets.filter(t => { const at = (t.history || []).slice(-1)[0]?.at; return at == null || (at >= w.start && at < w.end) })
    return tickets.map(t => mapTicket(t))
  })
  const readReport = deps.readReport || (() => { try { return fs.readFileSync(path.join(usageDir, 'report.html'), 'utf8') } catch { return '' } })
  // GitHub import is a snapshot INPUT read from the latest disk drop — never a live gh call on refresh.
  const readGithub = deps.readGithub || ((resolved, w) => {
    const drop = latestDrop('github')
    if (!drop) return null
    let prs = drop.prs || [], items = drop.reviews?.items || []
    if (w && !w.isYear) {
      prs = prs.filter(p => inWin(p.createdAt, w))
      items = items.filter(it => inWin(it.created_at || it.updated_at || it.submittedAt, w))
    }
    const imp = importGithub({ ghJson: { reviews: { ...drop.reviews, items }, prs }, resolved })
    imp.blame = drop.blame || {}   // { bugId -> introducingAuthorEmail }, computed at import (Task 2)
    return imp
  })
  const readJira = deps.readJira || ((resolved, w) => {
    const drop = latestDrop('jira')
    if (!drop) return null
    let issues = drop.issues || []
    if (w && !w.isYear) issues = issues.filter(i => inWin(i.fields?.created, w))
    return importJira({ issues, resolved })
  })
  // Re-detect CLAUDE.md presence + rough quality each refresh (no persistence, §11.B/D).
  const probeRepo = deps.probeRepo || ((projectPath) => {
    for (const f of ['CLAUDE.md', path.join('.claude', 'CLAUDE.md')]) {
      try { const txt = fs.readFileSync(path.join(projectPath, f), 'utf8'); return { hasClaudeMd: true, claudeMdQuality: Math.min(1, txt.length / 1500) } } catch {}
    }
    return { hasClaudeMd: false, claudeMdQuality: 0 }
  })
  const readRunning = deps.readRunning || (() => {
    const root = path.join(CLAUDE, 'projects'); const cutoff = Date.now() - 5 * 60_000; const out = []
    let dirs = []; try { dirs = fs.readdirSync(root) } catch { return out }
    for (const d of dirs) {
      const pdir = path.join(root, d)
      let files = []; try { files = fs.readdirSync(pdir).filter(f => f.endsWith('.jsonl')) } catch { continue }
      for (const f of files) { try { if (fs.statSync(path.join(pdir, f)).mtimeMs > cutoff) { out.push({ project: d, startedAt: fs.statSync(path.join(pdir, f)).mtimeMs }); break } } catch {} }
    }
    return out
  })

  function bragCandidates() {
    const board = readJson(path.join(CLAUDE, 'taskboard.json'), { tickets: [] })
    const cands = []
    for (const t of board.tickets || []) if (t.stage === 'released')
      cands.push({ id: 'tkt:' + t.id, date: t.updatedAt || Date.now(), title: `Shipped ${t.id}: ${t.title || ''}`.trim(), impact: '', evidence: t.id, source: 'auto' })
    const nar = cache?.insights?.narrative
    for (const w of (nar?.wins || [])) cands.push({ id: 'win:' + w.title, date: Date.now(), title: w.title, impact: w.desc, evidence: '/insights', source: 'auto' })
    return cands
  }
  const storyMd = (cfg) => {
    const wins = [...(cfg.brag || [])].slice(-20)
    return `# Story so far\n\n` + wins.map(b => `- **${b.title}** — ${b.impact || ''} ${b.evidence ? `(${b.evidence})` : ''}`).join('\n')
  }

  const build = (period = '') => {
    const config = store.read()
    const resolved = resolveIdentity(config.identity)
    const window = periodWindow(period)
    const github = readGithub(resolved, window)
    const jira = readJira(resolved, window)
    const snap = buildSnapshot({ usageDir, transcriptsDir: path.join(CLAUDE, 'projects'), mtimeCache, config, resolved,
      readBugs: () => readBugs(window), readTasks: () => readTasks(window), readReport, readRunning, github, jira, probeRepo, window })
    snap.period = window.label
    warnIfNoMatch(resolved, snap.quality.attributed.length + snap.quality.unattributed.length ? snap.quality.attributed.length : 0, 'bugs')
    // Rollup/lessons are CURRENT-STATE side effects — only the full-year build may mutate them (a quarter view is read-only).
    if (window.isYear) {
      const patch = updateRollup(config, snap, new Date().toISOString().slice(0, 10))
      store.write(patch)
      snap.rollup = { ...config.rollup, ...patch.rollup }
      // auto-graduate active lessons whose STRUCTURED check cleared (idempotent: internalized never re-fires)
      const graduated = (config.lessons || []).map(l =>
        l.status === 'active' && evaluateLesson(l, snap).graduate ? { ...l, status: 'internalized', graduatedAt: Date.now() } : l)
      if (graduated.some((l, i) => l !== (config.lessons || [])[i])) { store.write({ lessons: graduated }); snap.lessons = graduated.map(l => ({ ...l, eval: evaluateLesson(l, snap) })) }
      cache = snap
    } else {
      snap.rollup = { ...config.rollup }
    }
    snap.bragCandidates = bragCandidates()
    return snap
  }

  app.get('/api/career/snapshot', (req, res) => {
    try {
      const period = req.query?.period || ''
      res.json(periodWindow(period).isYear ? (cache || build(period)) : build(period))
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.post('/api/career/refresh', (req, res) => {
    try { const t0 = Date.now(); const s = build(); res.json({ parsed: s.parsed, skipped: s.skipped, tookMs: Date.now() - t0 }) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.get('/api/career/config', (req, res) => { try { res.json(store.read()) } catch (e) { res.status(500).json({ error: e.message }) } })
  app.post('/api/career/config', (req, res) => {
    try {
      const patch = {}
      for (const [k, v] of Object.entries(req.body || {})) if (AUTHORED.has(k)) patch[k] = v
      const next = store.write(patch); cache = null
      res.json(next)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.post('/api/career/focus/act', (req, res) => {
    try {
      const { id, ref } = req.body || {}
      const cfg = store.read(); const acted = cfg.focusActed || {}
      acted[id] = { ref: ref || null, at: Date.now() }
      store.write({ focusActed: acted }); cache = null
      res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // Read-only batch drop (spec §11.A): shell gh, write raw JSON to disk, persist only {lastAt,path}.
  // Blame is computed HERE (once), not on refresh (spec §2.4 perf). A gh/format failure is quarantined.
  app.post('/api/career/import/github', (req, res) => {
    try {
      const reviews = JSON.parse(gh(['api', 'search/issues?q=reviewed-by:@me+type:pr&per_page=50']))
      const prs = JSON.parse(gh(['pr', 'list', '--author', '@me', '--state', 'all', '--json', 'number,title,createdAt,mergedAt,reviews,additions,deletions,files', '--limit', '50']))
      const bugs = (readBugs().bugs) || []
      const blame = blameMapForBugs(bugs)
      const at = Date.now()
      const p = writeDrop('github', { at, reviews, prs, blame })
      const cfg = store.read()
      store.write({ imports: { ...cfg.imports, github: { lastAt: at, path: p } } })
      cache = null
      res.json({ ok: true, lastAt: at, prs: prs.length, reviewsHit: (reviews.items || []).length })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // Jira: prefer a pasted export (the changelog-bearing REST payload); acli can't expand changelog,
  // so a paste is the reliable source. Read-only drop to disk + persist {lastAt,path}. Quarantined.
  app.post('/api/career/import/jira', (req, res) => {
    try {
      let issues = req.body?.issues
      if (!Array.isArray(issues)) throw new Error('POST { issues: [...] } — paste the Jira REST export (fields + changelog)')
      const at = Date.now()
      const p = writeDrop('jira', { at, issues })
      const cfg = store.read()
      store.write({ imports: { ...cfg.imports, jira: { lastAt: at, path: p } } })
      cache = null
      res.json({ ok: true, lastAt: at, issues: issues.length })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // On-demand only (§2,§3): cached by input hash so repeat clicks are free. Never runs on snapshot build.
  // ponytail: spawnSync blocks this handler for the claude -p call — fine for a local single-user dashboard.
  app.post('/api/career/analyze', (req, res) => {
    try {
      const { panelKey, payload } = req.body || {}
      if (!panelKey) return res.status(400).json({ error: 'panelKey required' })
      const key = analysisKey(panelKey, payload)
      const cfg = store.read()
      const hit = (cfg.analyses || {})[key]
      if (hit) return res.json({ markdown: hit.markdown, cached: true })
      const { markdown } = runAnalyze({ panelKey, payload })
      store.write({ analyses: { ...(cfg.analyses || {}), [key]: { inputHash: key, at: Date.now(), markdown } } })
      cache = null
      res.json({ markdown, cached: false })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  app.get('/api/career/brag', (req, res) => res.json({ candidates: bragCandidates(), entries: store.read().brag }))
  app.post('/api/career/brag', (req, res) => { const cfg = store.read(); const e = { id: 'b' + Date.now(), date: Date.now(), source: 'manual', ...req.body.entry }; store.write({ brag: [...cfg.brag, e] }); cache = null; res.json({ ok: true }) })
  app.post('/api/career/retro', (req, res) => { const cfg = store.read(); store.write({ retros: [...cfg.retros, { id: 'r' + Date.now(), ...req.body }] }); res.json({ ok: true }) })
  app.get('/api/career/story-so-far', (req, res) => res.json({ markdown: storyMd(store.read()) }))
  app.get('/api/career/promo-packet', (req, res) => { const c = store.read(); res.json({ markdown: storyMd(c) + `\n\n## Competency self-assessment\nLevel: ${c.competency?.levelSelfAssessed || '—'}\n` }) })

  // T6: closing a KR emits an outcome XP event (idempotent by kr id, Task 5 Goodhart guard)
  app.post('/api/career/okr/close-kr', (req, res) => {
    try {
      const { krId, text } = req.body || {}
      if (!krId) return res.status(400).json({ error: 'krId required' })
      const cfg = store.read()
      const { xpLedger } = awardXp(cfg, [krClosed({ id: krId, text })])
      store.write({ xpLedger }); cache = null
      res.json({ ok: true, xp: xpLedger.reduce((a, e) => a + e.xp, 0) })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // T4: weekly harvest of recurring themes → DRAFT lessons. Nothing is persisted here; the human
  // approves via POST /lessons. ponytail: the rule/check is authored in the panel, not by an LLM pass.
  app.post('/api/career/lessons/harvest', (req, res) => {
    try {
      const candidates = harvestCandidates(req.body || {})
      const drafts = distill({ candidates, runAnalyze: c => ({ situation: c.theme, pattern: '', rule: '', check: { freeText: '' } }) })
      res.json({ candidates, drafts })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.post('/api/career/lessons', (req, res) => {   // approve/add an active lesson (cap-enforced)
    try {
      const cfg = store.read()
      const lesson = { id: 'lsn' + Date.now(), status: 'active', raisedAt: Date.now(), ...(req.body.lesson || {}) }
      const { lessons, error } = addLesson(cfg.lessons || [], lesson)
      if (error) return res.status(409).json({ error })
      store.write({ lessons }); cache = null
      res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.post('/api/career/lessons/:id/discard', (req, res) => {
    try {
      const cfg = store.read()
      store.write({ lessons: (cfg.lessons || []).map(l => l.id === req.params.id ? { ...l, status: 'discarded' } : l) })
      cache = null; res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // T3: per-ticket retro. Session linkage needs branch/prompt metadata we don't persist yet, so sessions=[]
  // → sessionsShown:false (the spec's preferred honest degradation — never a guessed join).
  app.get('/api/career/retro-tickets', (req, res) => {
    const board = readJson(path.join(CLAUDE, 'taskboard.json'), { tickets: [] })
    res.json({ tickets: (board.tickets || []).filter(t => ['released', 'ready-for-qa', 'qa-running'].includes(t.stage)).map(t => ({ id: t.id, title: t.title, stage: t.stage })) })
  })
  app.get('/api/career/retro/:ticketId', (req, res) => {
    try {
      const board = readJson(path.join(CLAUDE, 'taskboard.json'), { tickets: [] })
      const ticket = (board.tickets || []).find(t => t.id === req.params.ticketId)
      if (!ticket) return res.status(404).json({ error: 'ticket not found' })
      const prs = latestDrop('github')?.prs || []
      res.json(ticketRetro({ ticket, prs, bugs: (readBugs().bugs) || [], sessions: [], ticketLinks: store.read().ticketLinks || {} }))
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  function brief() {
    const cfg = store.read()
    const last = cfg.oneOnOnes[cfg.oneOnOnes.length - 1]
    const sinceTs = last ? last.date : 0
    const winsSinceLast = (cfg.brag || []).filter(b => (b.date || 0) >= sinceTs).map(b => b.title)
    const blockers = (cache?.focus || []).filter(f => f.severity === 'high').map(f => f.message)
    // growthTopic defaults to the top not-yet-acted-on focus item (fix 7) — not a hardcoded '' placeholder
    const topFocus = (cache?.focus || []).find(f => !f.actedOn)
    return {
      winsSinceLast, blockers,
      decisionsNeeded: cfg.pendingDecisions || [],        // manual quick-add (§4: legitimate manual input; brief auto-composes the rest)
      lastAgreed: last?.agreedActions || [],
      growthTopic: topFocus ? topFocus.message : '',
    }
  }
  // manual quick-add for "a decision I need from my manager" — inherently something you type
  app.post('/api/career/pending-decision', (req, res) => {
    try { const cfg = store.read(); store.write({ pendingDecisions: [...(cfg.pendingDecisions || []), String(req.body.text || '').slice(0, 300)] }); cache = null; res.json({ ok: true }) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.get('/api/career/brief', (req, res) => res.json(brief()))
  app.post('/api/career/one-on-one', (req, res) => {
    const cfg = store.read()
    const rec = { id: 'o' + Date.now(), date: Date.now(), agreedActions: req.body.agreedActions || [], managerFeedback: req.body.managerFeedback || '', growthTopic: req.body.growthTopic || '', briefSnapshot: brief() }
    store.write({ oneOnOnes: [...cfg.oneOnOnes, rec] }); cache = null
    res.json({ ok: true })
  })
}
