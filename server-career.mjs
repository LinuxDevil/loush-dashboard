import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { makeStore } from './career-config.mjs'
import { resolveIdentity, warnIfNoMatch } from './career-identity.mjs'
import { buildSnapshot, updateRollup } from './career-snapshot.mjs'

const HOME = os.homedir()
const CLAUDE = path.join(HOME, '.claude')
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
    const snap = buildSnapshot({ usageDir, mtimeCache, config, resolved, readBugs, readTasks, readReport, readRunning })
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

  app.get('/api/career/brag', (req, res) => res.json({ candidates: bragCandidates(), entries: store.read().brag }))
  app.post('/api/career/brag', (req, res) => { const cfg = store.read(); const e = { id: 'b' + Date.now(), date: Date.now(), source: 'manual', ...req.body.entry }; store.write({ brag: [...cfg.brag, e] }); cache = null; res.json({ ok: true }) })
  app.post('/api/career/retro', (req, res) => { const cfg = store.read(); store.write({ retros: [...cfg.retros, { id: 'r' + Date.now(), ...req.body }] }); res.json({ ok: true }) })
  app.get('/api/career/story-so-far', (req, res) => res.json({ markdown: storyMd(store.read()) }))
  app.get('/api/career/promo-packet', (req, res) => { const c = store.read(); res.json({ markdown: storyMd(c) + `\n\n## Competency self-assessment\nLevel: ${c.competency?.levelSelfAssessed || '—'}\n` }) })
}
