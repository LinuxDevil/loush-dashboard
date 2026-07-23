import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { makeStore } from './career-config.mjs'
import { resolveIdentity, warnIfNoMatch } from './career-identity.mjs'
import { buildSnapshot, updateRollup, periodWindow, priorPeriod } from './career-snapshot.mjs'
import mountTeam, { engSnapshot, teamBoard, reviewFlow } from './server-team.mjs'
import { importGithub } from './career-import-github.mjs'
import { importJira } from './career-import-jira.mjs'
import { blameMapForBugs } from './career-blame.mjs'
import { analysisKey, runAnalyze } from './career-analyze.mjs'
import { krClosed } from './career-okr.mjs'
import { awardXp, questDone } from './career-gamify.mjs'
import { harvestCandidates, distill, evaluateLesson, addLesson } from './career-lessons.mjs'
import { ticketRetro } from './career-retro.mjs'
import { cursorAiLines } from './server-cursor.mjs'
import { computeDomain } from './career-domain.mjs'
import { meetingStats } from './career-meetings.mjs'
import { weeklyDigest } from './career-digest.mjs'

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
  'pendingDecisions', 'afterHoursWindow', 'tzOffsetHours', 'focusActed', 'quests', 'kpiLinks',
  'effortTaxonomy', 'oneOnOneAgenda', 'oneOnOnesByPerson', 'pulse'])

// Same-process loopback to endpoints that already exist in server.mjs (/api/flow, /api/harness,
// /api/gov/*, /api/memory/search) and server-eng.mjs (/api/eng/ticket/:key). They are all SELF-PLANE
// or Plane-A reads of this machine; calling them is strictly cheaper than duplicating their walkers.
const PORT = Number(process.env.DASH_PORT) || 5178
const local = async (p) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); if (!r.ok) throw new Error(`${p} → ${r.status}`); return r.json() }

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
    const imp = importGithub({ ghJson: { reviews: { ...drop.reviews, items }, prs, reviewedPrs: drop.reviewedPrs || [], reviewPasses: drop.reviewPasses }, resolved })
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
  // G4: domain map is computed at import (git log) and stored whole — snapshot just reads the latest drop.
  const readDomain = deps.readDomain || (() => latestDrop('domain'))
  // G5: calendar events are dropped raw; meeting stats are cheap to compute per build (window-scoped).
  const readMeetings = deps.readMeetings || ((resolved, w) => {
    const drop = latestDrop('calendar')
    if (!drop) return null
    let events = drop.events || []
    if (w && !w.isYear) events = events.filter(e => inWin(e.start, w))
    return meetingStats(events, { meEmails: [...(resolved?.gitEmails || []), resolved?.email].filter(Boolean) })
  })
  const readCursor = deps.readCursor || (() => cursorAiLines())
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

  // item 16 — harvest brag lines from where the work actually lives: merged PRs, the review footprint
  // and the ownership map. Everything stays a DRAFT: nothing is written without a click (POST /brag).
  function bragCandidates(snap = cache) {
    const board = readJson(path.join(CLAUDE, 'taskboard.json'), { tickets: [] })
    const cands = []
    for (const t of board.tickets || []) if (t.stage === 'released')
      cands.push({ id: 'tkt:' + t.id, date: t.updatedAt || Date.now(), title: `Shipped ${t.id}: ${t.title || ''}`.trim(), impact: '', evidence: t.id, source: 'auto' })
    const nar = snap?.insights?.narrative
    for (const w of (nar?.wins || [])) cands.push({ id: 'win:' + w.title, date: Date.now(), title: w.title, impact: w.desc, evidence: '/insights', source: 'auto' })
    // merged PRs from the GitHub drop — the real shipped ledger
    const drop = latestDrop('github')
    for (const p of (drop?.prs || []).filter(p => p.mergedAt)) {
      const files = Array.isArray(p.files) ? p.files.length : (p.files || 0)
      cands.push({ id: 'pr:' + p.number, date: Date.parse(p.mergedAt), source: 'auto',
        title: `Shipped "${p.title}"`,
        impact: `+${p.additions || 0}/−${p.deletions || 0} across ${files} file${files === 1 ? '' : 's'}`,
        evidence: p.url || `PR #${p.number}` })
    }
    // review footprint — mentorship/unblocking is work, and it is invisible in every ticket system
    const forOthers = snap?.github?.reviewFootprint?.reviewedForOthers || {}
    const revN = Object.values(forOthers).reduce((a, b) => a + (b || 0), 0)
    if (revN > 0) cands.push({ id: 'rev:footprint', date: Date.now(), source: 'auto',
      title: `Reviewed ${revN} PRs for ${Object.keys(forOthers).length} teammates`,
      impact: 'Review load carried for the team', evidence: 'github review footprint' })
    // keystone areas from the ownership map
    for (const k of (snap?.domain?.keystones || []))
      cands.push({ id: 'own:' + k, date: Date.now(), source: 'auto',
        title: `Sole maintainer of \`${k}\``, impact: 'Ownership / bus-factor evidence', evidence: 'domain map (git log, 1y)' })
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
      readBugs: () => readBugs(window), readTasks: () => readTasks(window), readReport, readRunning, github, jira, probeRepo, window,
      cursor: readCursor(), domain: readDomain(), meetings: readMeetings(resolved, window) })
    snap.period = window.label
    warnIfNoMatch(resolved, snap.quality.attributed.length + snap.quality.unattributed.length ? snap.quality.attributed.length : 0, 'bugs')
    // Rollup/lessons are CURRENT-STATE side effects — only the full-year build may mutate them (a quarter view is read-only).
    if (window.isYear) {
      const patch = updateRollup(config, snap, new Date().toISOString().slice(0, 10))
      store.write(patch)
      snap.rollup = { ...config.rollup, ...patch.rollup }
      // item 13 — persist the session↔ticket↔PR join into the sink that already existed (career.json
      // `ticketLinks`, already read by the retro route). Only the full-year build writes.
      if (Object.keys(snap.ticketJoin?.links || {}).length) store.write({ ticketLinks: snap.ticketJoin.links })
      // auto-graduate active lessons whose STRUCTURED check cleared (idempotent: internalized never re-fires)
      const graduated = (config.lessons || []).map(l =>
        l.status === 'active' && evaluateLesson(l, snap).graduate ? { ...l, status: 'internalized', graduatedAt: Date.now() } : l)
      if (graduated.some((l, i) => l !== (config.lessons || [])[i])) { store.write({ lessons: graduated }); snap.lessons = graduated.map(l => ({ ...l, eval: evaluateLesson(l, snap) })) }
      cache = snap
    } else {
      snap.rollup = { ...config.rollup }
    }
    snap.bragCandidates = bragCandidates(snap)
    return snap
  }
  // item 4 — the prior period, trimmed to the comparable metrics. This is the denominator of every
  // delta chip in the UI; a single-period number cannot tell anyone whether an intervention worked.
  const COMPARABLE = ['quality', 'ai', 'impact', 'flow', 'workflow', 'allocation', 'meetings', 'period', 'me']
  const priorOf = (period) => {
    const p = priorPeriod(period)
    const s = build(p)   // never isYear (a past period) → read-only, mutates nothing
    return Object.fromEntries([['period', p], ...COMPARABLE.map(k => [k, s[k]])])
  }

  app.get('/api/career/snapshot', (req, res) => {
    try {
      const period = req.query?.period || ''
      const snap = periodWindow(period).isYear ? (cache || build(period)) : build(period)
      if (String(req.query?.compare || '') === '1') snap.prior = priorOf(period)
      res.json(snap)
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
      // `commits` field → per-PR commit list; summed at import for the G1 AI-code-share denominator.
      const prs = JSON.parse(gh(['pr', 'list', '--author', '@me', '--state', 'all', '--json', 'number,title,createdAt,mergedAt,reviews,additions,deletions,files,commits', '--limit', '50']))
      const bugs = (readBugs().bugs) || []
      const blame = blameMapForBugs(bugs)
      // Reviewer-side turnaround: created→my-first-review on OTHERS' PRs. Needs a per-PR reviews fetch.
      // ponytail: bounded to 25 PRs + fully quarantined — a rate-limit/format hiccup degrades to [], never fails the import.
      // reviewPasses = total count of MY review submissions across those PRs (G8 real comment/pass count).
      let reviewedPrs = [], reviewPasses = 0
      try {
        const meLogin = JSON.parse(gh(['api', 'user'])).login
        const searched = JSON.parse(gh(['search', 'prs', '--reviewed-by', '@me', '--state', 'all', '--json', 'number,createdAt,repository', '--limit', '25']))
        for (const pr of searched) {
          try {
            const nwo = pr.repository?.nameWithOwner
            if (!nwo) continue
            const revs = JSON.parse(gh(['api', `repos/${nwo}/pulls/${pr.number}/reviews`]))
            const minePasses = revs.filter(r => r.user?.login === meLogin).map(r => r.submitted_at).filter(Boolean).sort()
            reviewPasses += minePasses.length
            if (minePasses[0]) reviewedPrs.push({ createdAt: pr.createdAt, myFirstReviewAt: minePasses[0] })
          } catch {}
        }
      } catch {}
      const at = Date.now()
      const p = writeDrop('github', { at, reviews, prs, blame, reviewedPrs, reviewPasses })
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

  // G5: calendar import (paste/export). Server can't call the Calendar MCP, so events arrive here as a
  // batch — mirrors the Jira paste. Read-only drop to disk. Quarantined.
  app.post('/api/career/import/calendar', (req, res) => {
    try {
      const events = req.body?.events
      if (!Array.isArray(events)) throw new Error('POST { events: [{start,end,title,organizer}] } — export/paste your calendar')
      const at = Date.now()
      writeDrop('calendar', { at, events })
      cache = null
      res.json({ ok: true, at, events: events.length })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // G4: domain map computed at import (git log over owned repos — NEVER on refresh, spec §2.4 perf).
  app.post('/api/career/import/domain', (req, res) => {
    try {
      const cfg = store.read()
      const resolved = resolveIdentity(cfg.identity)
      const repoPaths = (cfg.projects || []).filter(p => p.owned && p.path).map(p => p.path)
      if (!repoPaths.length) return res.status(400).json({ error: 'no owned projects with a path — add them in config.projects' })
      const domain = computeDomain(repoPaths, [...(resolved?.gitEmails || []), resolved?.email].filter(Boolean))
      const at = Date.now()
      writeDrop('domain', { at, ...domain })
      cache = null
      res.json({ ok: true, at, areas: domain.areas.length, keystones: domain.keystones.length })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // G10: deterministic weekly digest from the current snapshot + the persisted weekly series.
  app.get('/api/career/digest', (req, res) => {
    try { res.json(weeklyDigest(cache || build())) }
    catch (e) { res.status(500).json({ error: e.message }) }
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

  // G2: append one business-impact link (manual). Full array is also editable via POST /config (AUTHORED).
  app.post('/api/career/kpi-link', (req, res) => {
    try {
      const cfg = store.read()
      const e = { id: 'kpi' + Date.now(), at: Date.now(), direction: 'up', ...(req.body.link || req.body || {}) }
      store.write({ kpiLinks: [...(cfg.kpiLinks || []), e] }); cache = null
      res.json({ ok: true, id: e.id })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  app.get('/api/career/brag', (req, res) => res.json({ candidates: bragCandidates(), entries: store.read().brag }))
  app.post('/api/career/brag', (req, res) => { const cfg = store.read(); const e = { id: 'b' + Date.now(), date: Date.now(), source: 'manual', ...req.body.entry }; store.write({ brag: [...cfg.brag, e] }); cache = null; res.json({ ok: true }) })
  app.post('/api/career/retro', (req, res) => { const cfg = store.read(); store.write({ retros: [...cfg.retros, { id: 'r' + Date.now(), ...req.body }] }); res.json({ ok: true }) })

  // self-only weekly friction pulse — authored, never rolled up, never leaves this machine
  app.get('/api/career/pulse', (req, res) => res.json({ entries: store.read().pulse }))
  app.post('/api/career/pulse', (req, res) => {
    const { blocked, note } = req.body || {}
    const n = Number(blocked)
    if (!Number.isInteger(n) || n < 1 || n > 5) return res.status(400).json({ error: 'blocked must be 1-5' })
    const cfg = store.read()
    const e = { id: 'p' + Date.now(), ts: Date.now(), blocked: n, note: (note || '').slice(0, 500) || undefined }
    store.write({ pulse: [...cfg.pulse, e] }); cache = null
    res.json({ ok: true, entry: e })
  })
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

  // Mark a quest done → award its outcome XP (idempotent via awardXp seen-set) and flip quests[i].done.
  app.post('/api/career/quest/:id/done', (req, res) => {
    try {
      const cfg = store.read()
      const quests = [...(cfg.quests || [])]
      const i = quests.findIndex(q => q.id === req.params.id)
      if (i < 0) return res.status(404).json({ error: 'quest not found' })
      const { xpLedger } = awardXp(cfg, [questDone(quests[i])])
      quests[i] = { ...quests[i], done: true }
      store.write({ xpLedger, quests }); cache = null
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
      const ticket = (board.tickets || []).find(t => t.id === req.params.ticketId) || { id: req.params.ticketId, history: [] }
      const prs = latestDrop('github')?.prs || []
      const snap = cache || build()
      res.json(ticketRetro({ ticket, prs, bugs: (readBugs().bugs) || [], sessions: [],
        ticketLinks: snap.ticketJoin?.links || store.read().ticketLinks || {}, coverage: snap.ticketJoin?.coverage ?? null }))
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ═══ item 13 — cost per ticket + honest AI ROI (SELF-ONLY: these sessions are this laptop's) ═══
  app.get('/api/career/ticket-economics', (req, res) => {
    try {
      const snap = cache || build()
      const j = snap.ticketJoin || { links: {}, coverage: 0, linkedSessions: 0, totalSessions: 0 }
      const rows = Object.values(j.links).map(l => ({
        ticket: l.ticket, sessions: l.sessions.length, tokens: l.tokens, usd: l.usd, prs: l.prs,
        firstAt: l.sessions.map(s => s.at).filter(Boolean).sort()[0] || null,
        resume: l.sessions[0] ? `claude --resume ${l.sessions[0].id}` : null,
      })).sort((a, b) => b.usd - a.usd)
      const usd = rows.reduce((a, r) => a + r.usd, 0)
      res.json({ rows, coverage: j.coverage, linkedSessions: j.linkedSessions, totalSessions: j.totalSessions,
        totals: { tickets: rows.length, usd: +usd.toFixed(2), usdPerTicket: rows.length ? +(usd / rows.length).toFixed(2) : null },
        caveat: `Computable only for this laptop's sessions — ${Math.round((j.coverage || 0) * 100)}% of them carry a ticket key. Never a per-engineer AI score.` })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ═══ item 8 — harness ROI: what fires, what is dead weight. SELF-ONLY BY CONSTRUCTION —
  // this page reads one machine's ~/.claude and structurally cannot be rolled up to a manager. ═══
  app.get('/api/career/harness-roi', async (req, res) => {
    try {
      // /api/overview carries the token inventory (descTokens = the tax paid on EVERY prompt,
      // fullTokens = paid on invoke); /api/flow carries the observed invocation counts from the
      // transcripts. The join between them has existed in two endpoints and was never made.
      const [ov, flow] = await Promise.all([local('/api/overview'), local('/api/flow')])
      const fires = new Map()   // singular kind ("skill:foo") -> {count, last}
      for (const n of flow.nodes || []) fires.set(n.id, { count: n.count || 0, last: n.last || null })
      const DIR = { skill: 'skills', agent: 'agents', command: 'commands' }
      const rows = (ov.items || []).map(i => {
        const kind = String(i.kind || '').replace(/s$/, '')          // 'skills' -> 'skill'
        const f = fires.get(`${kind}:${i.name}`) || { count: 0, last: null }
        const always = i.descTokens || 0, onInvoke = i.fullTokens || 0
        return { name: i.name, kind, scope: i.scope || 'user',
          alwaysOnTokens: always, onInvokeTokens: onInvoke, fires: f.count, lastFired: f.last,
          tokensPerFire: f.count ? Math.round(onInvoke / f.count) : null,
          verdict: f.count === 0 && always > 0 ? 'DEAD' : f.count === 0 ? 'COLD' : 'HOT',
          rm: DIR[kind] ? `rm -rf ~/.claude/${DIR[kind]}/${i.name}` : null }
      })
      const hot = [...rows].sort((a, b) => b.fires - a.fires).slice(0, 10).map(r => r.name)
      for (const r of rows) if (r.verdict === 'HOT' && !hot.includes(r.name)) r.verdict = 'WARM'
      const ghosts = (flow.nodes || []).filter(n => n.ghost).map(n => ({ name: n.name, kind: n.kind, fires: n.count || 0, verdict: 'GHOST' }))
      const dead = rows.filter(r => r.verdict === 'DEAD')
      const tax = dead.reduce((a, r) => a + r.alwaysOnTokens, 0)
      rows.sort((a, b) => (a.verdict === 'DEAD' ? 0 : 1) - (b.verdict === 'DEAD' ? 0 : 1) || b.alwaysOnTokens - a.alwaysOnTokens)
      res.json({ rows, ghosts, dead: dead.length,
        headline: `You pay ${tax.toLocaleString()} tok on every session for ${dead.length} capabilities that have never fired.`,
        alwaysOnTax: tax, rmList: dead.map(r => r.rm).filter(Boolean).join('\n'),
        plane: 'self-only' })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ═══ item 9 — run economics + failure forensics (replaces "cost saved"). SELF-ONLY. ═══
  app.get('/api/career/run-economics', async (req, res) => {
    try {
      const days = Number(req.query.days) || 30
      const [costs, fails, usage] = await Promise.all([
        local(`/api/gov/costs?days=${days}`), local(`/api/gov/failures?days=${days}`), local('/api/usage').catch(() => ({})),
      ])
      const spend = Object.values(costs.byDay || {}).reduce((a, d) => a + (d.usd || 0), 0)
      const breakage = (fails.tools || []).map(t => ({ tool: t.name, uses: t.uses, errors: t.errors, rate: +(t.rate || 0).toFixed(3) }))
        .sort((a, b) => b.rate - a.rate)
      res.json({
        days, spend: { total: +spend.toFixed(2), byDay: costs.byDay || {}, byProject: costs.byProj || {}, byModel: costs.byModel || {}, alerts: costs.costAlerts || costs.alerts || null },
        // /api/usage names the live 5h window `activeBlock` — it always has. `block`/`currentBlock` never
        // existed, so this was hard-null and the UI was re-fetching /api/usage to paper over it.
        block: usage.activeBlock || usage.block || usage.currentBlock || null,
        breakage, compactions: fails.compactions || 0, retries: fails.retries || 0, byHour: fails.byHour || {},
        worst: breakage[0] ? `${breakage[0].tool} fails ${Math.round(breakage[0].rate * 100)}% of the time (${breakage[0].errors}/${breakage[0].uses}) — that is a lying CLAUDE.md, not bad luck.` : null,
        plane: 'self-only',
      })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ═══ item 10 — omnibox: ticket/epic lookup (Plane A) OR precedent search (self-plane) ═══
  app.get('/api/career/lookup', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim()
      if (!q) return res.json({ kind: 'empty', hits: [] })
      const key = (q.match(/\b([A-Z]{2,10}-\d+)\b/i) || [])[1]
      if (key) {
        const t = await local(`/api/eng/ticket/${key.toUpperCase()}`)
        const summary = `${key.toUpperCase()} — ${t.summary || ''} · ${t.status || '?'}${t.assignee?.name ? ` · ${t.assignee.name}` : ''}${t.daysIn != null ? ` · ${t.daysIn}d in status` : ''}${(t.prs || []).length ? ` · PR ${(t.prs || []).map(p => '#' + p.num).join(', ')}` : ''}`
        return res.json({ kind: 'ticket', key: key.toUpperCase(), ticket: t, copy: summary })
      }
      const m = await local(`/api/memory/search?q=${encodeURIComponent(q)}&sources=memory,transcript`)
      const hits = (m.results || m.hits || []).slice(0, 15).map(h => ({
        source: h.source || 'transcript', project: h.project || null, date: h.date || h.at || null,
        excerpt: (h.excerpt || h.text || '').slice(0, 240), sessionId: h.sessionId || h.id || null,
        resume: (h.sessionId || h.id) ? `claude --resume ${h.sessionId || h.id}` : null,
      }))
      res.json({ kind: 'precedent', q, hits })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // oneOnOnes is a flat array historically ("me → my manager"). Item 11 re-keys it by accountId while
  // keeping the old array readable: `self` is the legacy lane.
  const oneOnOnesFor = (cfg, pid) => pid === 'self'
    ? (Array.isArray(cfg.oneOnOnes) ? cfg.oneOnOnes : [])
    : ((cfg.oneOnOnesByPerson || {})[pid] || [])

  function brief() {
    const cfg = store.read()
    const list = oneOnOnesFor(cfg, 'self')
    const last = list[list.length - 1]
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

  // ═══ item 11 — per-person 1:1 packet. THE SYMMETRY RULE IS THE FEATURE: this packet is built
  // ONLY from Plane-A work artifacts (JIRA tickets, PRs, reviews, escaped bugs) via server-team.mjs,
  // so the engineer can render the identical packet about themselves from the same UI. No token, cost,
  // hours, session or transcript field can reach it — server-team.mjs cannot emit one. ═══
  async function packet(personId) {
    const cfg = store.read()
    const snap = await engSnapshot()
    const board = teamBoard(snap)
    const row = board.rows.find(r => r.id === personId)
    if (!row) return null
    const list = oneOnOnesFor(cfg, personId)
    const last = list[list.length - 1]
    const since = last?.date || Date.now() - 30 * 86400000
    const shipped = (snap.issues || []).filter(i => i.assignee?.id === personId && i.live && !i.isBug && i.closedAt && Date.parse(i.closedAt) >= since)
      .map(i => ({ key: i.key, summary: i.summary, closedAt: i.closedAt, activeDays: i.activeDays, url: `https://${i.host}/browse/${i.key}` }))
    const bugs = (snap.issues || []).filter(i => i.isBug && i.ownerId === personId && Date.parse(i.created) >= since)
      .map(i => ({ key: i.key, summary: i.summary, status: i.status, url: `https://${i.host}/browse/${i.key}` }))
    // GitHub identity is a login, JIRA identity is an accountId — match on the email local-part, the only
    // bridge that exists without a new mapping table. Missing match degrades to an empty review lane.
    const localPart = (row.name || '').split(' ')[0].toLowerCase()
    const rf = reviewFlow(snap, { me: localPart })
    const reviewLoad = rf.load.find(l => l.login.toLowerCase().includes(localPart)) || null
    const stuck = row.tickets.filter(t => t.atRisk || t.parked)
    const talkingPoints = [
      shipped.length ? `Wins since we last spoke: ${shipped.slice(0, 3).map(s => s.key).join(', ')}${shipped.length > 3 ? ` (+${shipped.length - 3} more)` : ''}.` : 'No tickets closed since our last 1:1 — worth asking what has been absorbing the time.',
      stuck.length ? `${stuck.length} item(s) stuck: ${stuck.slice(0, 2).map(t => `${t.key} in "${t.status}" ${t.inCurrent}d`).join('; ')}. What is the block?` : 'Nothing is parked or at risk right now.',
      reviewLoad ? `Carrying ${reviewLoad.reviews} reviews in 30d${reviewLoad.p90FirstReview != null ? ` (p90 first review ${reviewLoad.p90FirstReview}d)` : ''}.` : 'No review activity in the window — worth a nudge either way.',
    ]
    return {
      person: { id: row.id, name: row.name },
      plane: 'work-artifacts-only',
      symmetry: 'This is the same packet the subject can render about themselves. It contains no token, cost, hours, session or transcript field — by construction.',
      wip: row.wip, open: row.open, atRisk: row.atRisk, flags: row.flags,
      shipped, stuck, bugs, reviewLoad,
      lastOneOnOneAt: last?.date || null,
      lastAgreed: (last?.agreedActions || []).map(a => ({ action: a, doneNow: shipped.some(s => String(a).includes(s.key)) })),
      agendaItems: (cfg.oneOnOneAgenda || {})[personId] || [],
      talkingPoints,
      markdown: `# 1:1 — ${row.name}\n\n## Since last time\n${shipped.map(s => `- ${s.key} ${s.summary}`).join('\n') || '- (nothing closed)'}\n\n## Stuck\n${stuck.map(t => `- ${t.key} — "${t.status}" for ${t.inCurrent}d`).join('\n') || '- (nothing parked)'}\n\n## Talking points\n${talkingPoints.map(t => `- ${t}`).join('\n')}\n`,
    }
  }
  app.get('/api/career/packet', async (req, res) => {
    try {
      const pid = String(req.query.person || '')
      if (!pid) return res.status(400).json({ error: 'person (accountId) required — self is the default view in the UI' })
      const p = await packet(pid)
      if (!p) return res.status(404).json({ error: 'no open work for that person in the snapshot' })
      res.json(p)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  // "+ 1:1 agenda" — push a ticket/PR from the team board or review flow into a person's packet.
  app.post('/api/career/packet/agenda', (req, res) => {
    try {
      const { person, item } = req.body || {}
      if (!person || !item) return res.status(400).json({ error: 'person and item required' })
      const cfg = store.read()
      const agenda = cfg.oneOnOneAgenda || {}
      agenda[person] = [...(agenda[person] || []), { at: Date.now(), ...(typeof item === 'string' ? { text: item } : item) }]
      store.write({ oneOnOneAgenda: agenda }); cache = null
      res.json({ ok: true, items: agenda[person].length })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  // CONSENT MODEL: the export a manager receives is exactly the export the engineer can pull about
  // themselves. It leaves this laptop only on a click, and it never scrapes a colleague's career.json.
  app.post('/api/career/packet/export', async (req, res) => {
    try {
      const pid = String(req.body?.person || '')
      const p = pid ? await packet(pid) : null
      if (!p) return res.status(400).json({ error: 'person required (and must have work in the snapshot)' })
      const at = Date.now()
      const file = writeDrop('packets', { at, exportedBy: 'self', packet: p })
      res.json({ ok: true, at, path: file, packet: p })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  // The manager side reads only packets that were exported INTO the drop directory — a pull, never a scrape.
  app.get('/api/career/packets', (req, res) => {
    try {
      const dir = path.join(IMPORTS, 'packets')
      let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse() } catch {}
      res.json({ packets: files.slice(0, 20).map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null } }).filter(Boolean) })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  mountTeam(app)   // /api/team/* — the Plane-A cross-person surface. It imports only server-eng.mjs.
  // manual quick-add for "a decision I need from my manager" — inherently something you type
  app.post('/api/career/pending-decision', (req, res) => {
    try { const cfg = store.read(); store.write({ pendingDecisions: [...(cfg.pendingDecisions || []), String(req.body.text || '').slice(0, 300)] }); cache = null; res.json({ ok: true }) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.get('/api/career/brief', (req, res) => res.json(brief()))
  // Closing a 1:1 records what was agreed. With `person`, it is keyed by accountId (item 11); without,
  // it stays on the legacy self lane. agreedActions become the next period's did-it-happen check.
  app.post('/api/career/one-on-one', (req, res) => {
    const cfg = store.read()
    const pid = String(req.body?.person || '')
    const rec = { id: 'o' + Date.now(), date: Date.now(), agreedActions: req.body.agreedActions || [], managerFeedback: req.body.managerFeedback || '', growthTopic: req.body.growthTopic || '' }
    if (!pid) { store.write({ oneOnOnes: [...(Array.isArray(cfg.oneOnOnes) ? cfg.oneOnOnes : []), { ...rec, briefSnapshot: brief() }] }); cache = null; return res.json({ ok: true }) }
    const byPerson = Array.isArray(cfg.oneOnOnes) ? {} : { ...(cfg.oneOnOnes || {}) }
    byPerson[pid] = [...(byPerson[pid] || []), rec]
    // keep the legacy self array intact alongside the keyed map
    store.write({ oneOnOnesByPerson: byPerson }); cache = null
    res.json({ ok: true, person: pid })
  })
}
