import fs from 'node:fs'
import path from 'node:path'

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const listJson = (dir) => { try { return fs.readdirSync(dir).filter(f => f.endsWith('.json')) } catch { return [] } }

// Parse one file, using mtime cache. Returns { val, fromDisk } or throws.
function cachedRead(file, cache) {
  const mt = fs.statSync(file).mtimeMs
  const hit = cache.get(file)
  if (hit && hit.mt === mt) return { val: hit.val, fromDisk: false }
  const val = readJson(file)                 // throws on malformed
  cache.set(file, { mt, val })
  return { val, fromDisk: true }
}

export function parseUsageData(dir, { mtimeCache } = {}) {
  const cache = mtimeCache || new Map()
  let parsed = 0
  const metaDir = path.join(dir, 'session-meta')
  const facetDir = path.join(dir, 'facets')
  let skipped = 0
  const metas = new Map()
  for (const f of listJson(metaDir)) {
    try {
      const { val: m, fromDisk } = cachedRead(path.join(metaDir, f), cache)
      metas.set(m.session_id, m)
      if (fromDisk) parsed++
    }
    catch { skipped++ }
  }
  const sessions = []
  for (const f of listJson(facetDir)) {
    let fa, fromDisk
    try { ({ val: fa, fromDisk } = cachedRead(path.join(facetDir, f), cache)) }
    catch { skipped++; continue }
    const meta = metas.get(fa.session_id)
    if (!meta) { skipped++; continue }       // orphan facet
    sessions.push({ ...meta, ...fa, session_id: fa.session_id })
    if (fromDisk) parsed++
  }
  return { sessions, skipped, parsed }
}

const bump = (obj, key, by = 1) => { if (key == null) return; obj[key] = (obj[key] || 0) + by }
const mergeCounts = (into, from) => { for (const [k, v] of Object.entries(from || {})) bump(into, k, v) }

export function groupByProject(sessions) {
  const g = new Map()
  for (const s of sessions) {
    const key = s.project_path || '(unknown)'
    if (!g.has(key)) g.set(key, { sessions: [], totals: {
      sessions: 0, gitCommits: 0, gitPushes: 0, interruptions: 0, responseTimes: [],
      outcomes: {}, friction: {}, sessionTypes: {}, tools: {}, languages: {},
    } })
    const p = g.get(key); const t = p.totals
    p.sessions.push(s)
    t.sessions++; t.gitCommits += s.git_commits || 0; t.gitPushes += s.git_pushes || 0
    t.interruptions += s.user_interruptions || 0
    t.responseTimes.push(...(s.user_response_times || []))
    bump(t.outcomes, s.outcome); bump(t.sessionTypes, s.session_type)
    mergeCounts(t.friction, s.friction_counts); mergeCounts(t.tools, s.tool_counts); mergeCounts(t.languages, s.languages)
  }
  for (const p of g.values()) {
    const rt = p.totals.responseTimes
    p.totals.avgResponseSec = rt.length ? rt.reduce((a, b) => a + b, 0) / rt.length : 0
    p.totals.interruptRate = p.totals.sessions ? p.totals.interruptions / p.totals.sessions : 0
  }
  return g
}
