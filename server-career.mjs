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
  'pendingDecisions', 'afterHoursWindow', 'tzOffsetHours'])

export const __test = { AUTHORED }

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
    return (board.tickets || []).map(t => ({ id: t.id, stage: t.stage, ageDays: 0, slaDays: Infinity, project: t.project, title: t.title }))
  })
  const readReport = deps.readReport || (() => { try { return fs.readFileSync(path.join(usageDir, 'report.html'), 'utf8') } catch { return '' } })

  const build = () => {
    const config = store.read()
    const resolved = resolveIdentity(config.identity)
    const snap = buildSnapshot({ usageDir, mtimeCache, config, resolved, readBugs, readTasks, readReport })
    warnIfNoMatch(resolved, snap.quality.attributed.length + snap.quality.unattributed.length ? snap.quality.attributed.length : 0, 'bugs')
    const patch = updateRollup(config, snap, new Date().toISOString().slice(0, 10))
    store.write(patch)
    snap.rollup = { ...config.rollup, ...patch.rollup }
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
}
