import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { makeStore } from './career-config.mjs'
import { resolveIdentity, warnIfNoMatch } from './career-identity.mjs'
import { buildSnapshot, updateRollup } from './career-snapshot.mjs'
import { importGithub } from './career-import-github.mjs'
import { importJira } from './career-import-jira.mjs'
import { blameMapForBugs } from './career-blame.mjs'
import { analysisKey, runAnalyze } from './career-analyze.mjs'

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
  const readBugs = deps.readBugs || (() => {
    const b = readJson(path.join(CLAUDE, 'bugs.json'), { bugs: [] })
    return { bugs: b.bugs || [], findings: [], myPrCount: 0, reverts: 0 } // findings/PRs arrive Phase 2 (GitHub)
  })
  const readTasks = deps.readTasks || (() => {
    const board = readJson(path.join(CLAUDE, 'taskboard.json'), { tickets: [] })
    return (board.tickets || []).map(t => mapTicket(t))
  })
  const readReport = deps.readReport || (() => { try { return fs.readFileSync(path.join(usageDir, 'report.html'), 'utf8') } catch { return '' } })
  // GitHub import is a snapshot INPUT read from the latest disk drop — never a live gh call on refresh.
  const readGithub = deps.readGithub || ((resolved) => {
    const drop = latestDrop('github')
    if (!drop) return null
    const imp = importGithub({ ghJson: { reviews: drop.reviews, prs: drop.prs }, resolved })
    imp.blame = drop.blame || {}   // { bugId -> introducingAuthorEmail }, computed at import (Task 2)
    return imp
  })
  const readJira = deps.readJira || ((resolved) => {
    const drop = latestDrop('jira')
    if (!drop) return null
    return importJira({ issues: drop.issues || [], resolved })
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

  const build = () => {
    const config = store.read()
    const resolved = resolveIdentity(config.identity)
    const github = readGithub(resolved)
    const jira = readJira(resolved)
    const snap = buildSnapshot({ usageDir, mtimeCache, config, resolved, readBugs, readTasks, readReport, readRunning, github, jira, probeRepo })
    warnIfNoMatch(resolved, snap.quality.attributed.length + snap.quality.unattributed.length ? snap.quality.attributed.length : 0, 'bugs')
    const patch = updateRollup(config, snap, new Date().toISOString().slice(0, 10))
    store.write(patch)
    snap.rollup = { ...config.rollup, ...patch.rollup }
    snap.bragCandidates = bragCandidates()
    cache = snap
    return snap
  }

  app.get('/api/career/snapshot', (req, res) => { try { res.json(cache || build()) } catch (e) { res.status(500).json({ error: e.message }) } })
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
