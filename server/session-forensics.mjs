import { contextPressure } from '../lib/harness-metrics.mjs'
import fs from 'node:fs'
import { mangle, readClaudeJson } from './dashboard-core.mjs'
import { nameSource } from '../lib/session-name.mjs'
import path from 'node:path'

let collectUsage, errSig, failStats, median, scanTranscripts

const BIG_CTX = 1_000_000, STD_CTX = 200_000

const firstUserPrompt = file => {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    for (const line of lines) {
      if (!line.includes('"role":"user"') && !line.includes('"role": "user"')) continue
      const j = JSON.parse(line)
      if (j.type !== 'user' || !j.message) continue
      const c = j.message.content
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.find(p => p.type === 'text')?.text : ''
      if (text && !text.startsWith('<')) return text.slice(0, 160)
    }
  } catch {}
  return ''
}

export default function mountSessionForensics(app, deps) {
  ({ collectUsage, errSig, failStats, median, scanTranscripts } = deps)

app.get('/api/forensics', (req, res) => {
  const days = Number(req.query.days) || 30
  const projFilter = req.query.project ? mangle(req.query.project) : null
  const cutoff = Date.now() - days * 86400_000
  const half = Date.now() - (days / 2) * 86400_000
  const recs = failStats().filter(r => r.last >= cutoff && (!projFilter || r.proj === projFilter))

  const sigs = {}
  for (const r of recs) for (const e of r.errs) {
    if (e.t && e.t < cutoff) continue
    const sig = errSig(e.tool, e.text)
    const g = (sigs[sig] ||= { sig, tool: e.tool, count: 0, recent: 0, prior: 0, first: e.t, last: e.t, example: e.text, sessions: new Set(), projects: new Set() })
    g.count++; if (e.t >= half) g.recent++; else g.prior++
    g.first = Math.min(g.first || e.t, e.t); g.last = Math.max(g.last, e.t)
    g.sessions.add(r.sessionId); g.projects.add(r.proj)
    if (e.t === g.last) g.example = e.text
  }
  const failures = Object.values(sigs).map(g => ({
    sig: g.sig, tool: g.tool, count: g.count, first: g.first, last: g.last, example: g.example,
    sessions: g.sessions.size, projects: [...g.projects].slice(0, 4),
    trend: g.recent > g.prior ? 'up' : g.recent < g.prior ? 'down' : 'flat', recent: g.recent, prior: g.prior,
    biting: g.count >= 3,
  })).sort((a, b) => b.count - a.count).slice(0, 60)

  const bytes = {}, sizes = {}, big = []
  let compactions = 0
  const perSession = []
  for (const r of recs) {
    for (const [k, v] of Object.entries(r.bytes)) bytes[k] = (bytes[k] || 0) + v
    for (const [k, v] of Object.entries(r.sizes)) (sizes[k] ||= []).push(...v)
    for (const b of r.big) big.push({ ...b, sessionId: r.sessionId, proj: r.proj })
    compactions += r.compactions
    if (r.compactions || r.turns) perSession.push({ sessionId: r.sessionId, proj: r.proj, compactions: r.compactions, turns: r.turns, errors: Object.values(r.toolErrs).reduce((a, b) => a + b, 0), last: r.last })
  }
  const pressure = contextPressure({ bytesByTool: bytes, sizesByTool: sizes })
  const tools = pressure.tools
  const totalBytes = pressure.totalChars

  const { hookEvents } = scanTranscripts()
  const hooks = {}
  for (const h of hookEvents) {
    if (h.t && h.t < cutoff) continue
    if (projFilter && h.proj !== projFilter) continue
    const g = (hooks[h.hook] ||= { hook: h.hook, event: h.event, tool: h.tool, fired: 0, blocks: 0, cancelled: 0, ms: [], blocked: [], last: 0 })
    g.fired++; g.last = Math.max(g.last, h.t || 0)
    if (h.cancelled) g.cancelled++
    if (typeof h.ms === 'number') g.ms.push(h.ms)
    if (h.blocked) { g.blocks++; if (g.blocked.length < 5) g.blocked.push({ t: h.t, tool: h.tool, sessionId: h.sessionId, reason: h.reason }) }
  }
  const hookRows = Object.values(hooks).map(g => ({
    hook: g.hook, event: g.event, tool: g.tool, fired: g.fired, blocks: g.blocks, cancelled: g.cancelled, last: g.last,
    blockRate: g.fired ? +(g.blocks / g.fired).toFixed(3) : 0,
    p50Ms: g.ms.length ? Math.round(median(g.ms)) : null,
    p90Ms: g.ms.length ? Math.round(g.ms.sort((a, b) => a - b)[Math.floor((g.ms.length - 1) * 0.9)]) : null,
    examples: g.blocked,
  })).sort((a, b) => b.blocks - a.blocks || b.fired - a.fired)

  res.json({
    days, plane: 'harness', sessions: recs.length,
    failures,
    context: {
      tools, totalChars: totalBytes,
      totalEstTokens: pressure.totalEstTokens, charsPerToken: pressure.charsPerToken,
      denominator: pressure.denominator,
      compactions,
      compactionsPerSession: recs.length ? +(compactions / recs.length).toFixed(2) : 0,
      biggest: big.sort((a, b) => b.chars - a.chars).slice(0, 10),
      worstSessions: perSession.sort((a, b) => b.compactions - a.compactions).slice(0, 10),
    },
    hooks: hookRows,
  })
})

// ---------- 10: session ledger with real $ ----------

app.get('/api/sessions', (req, res) => {
  const days = Number(req.query.days) || 7
  const limit = Math.min(200, Number(req.query.limit) || 20)
  const offset = Math.max(0, Number(req.query.offset) || 0)
  const q = String(req.query.q || '').trim().toLowerCase()
  const cutoff = Date.now() - days * 86400_000
  const { files } = collectUsage()
  const fail = {}; for (const r of failStats()) fail[r.file] = r
  const projNames = {}, projPaths = {}
  try { for (const d of Object.keys(readClaudeJson().projects || {})) { const k = mangle(d); projNames[k] = path.basename(d); projPaths[k] = d } } catch {}
  const rows = files.filter(f => !f.isAgent && f.msgs > 0 && f.last >= cutoff).map(f => {
    const id = path.basename(f.path, '.jsonl')
    const fr = fail[f.path]
    const cwd = f.cwd || projPaths[f.proj] || ''
    const cacheIn = f.in + f.cc + f.cr
    return {
      sessionId: id, proj: f.proj, project: projNames[f.proj] || f.proj.split('-').pop(), cwd,
      name: f.name || null, nameSource: f.nameSource || null,
      cost: +f.cost.toFixed(4), out: f.out, in: f.in, cacheRead: f.cr,
      subagentCost: +(f.subagentCost || 0).toFixed(4),
      // null, not 0. A session with no cached tokens at all has no cache-read ratio — 0% claims
      // the cache was offered and missed, which is a different (and worse-looking) fact.
      cacheReadPct: cacheIn ? +(f.cr / cacheIn).toFixed(3) : null,
      first: f.first, last: f.last, durationMs: Math.max(0, f.last - f.first),
      msgs: f.msgs, toolCalls: f.toolCalls,
      // `fr` is the forensics record; when it is absent nothing was measured, and "0 errors" is a
      // clean bill of health this endpoint has no basis to issue. Absence is reported as absence.
      compactions: fr ? fr.compactions : null,
      errors: fr ? Object.values(fr.toolErrs).reduce((a, b) => a + b, 0) : null,
      forensicsAvailable: !!fr,
      branch: Object.keys(f.branches).filter(Boolean)[0] || null,
      transcript: f.path,
      resume: cwd ? `cd ${cwd} && claude --resume ${id}` : `claude --resume ${id}`,
    }
  }).sort((a, b) => b.last - a.last)
  const matched = q
    ? rows.filter(r => (r.name || '').toLowerCase().includes(q) || r.sessionId.toLowerCase().includes(q) || r.cwd.toLowerCase().includes(q))
    : rows
  const totals = { cost: +matched.reduce((s, r) => s + r.cost, 0).toFixed(2), sessions: matched.length, out: matched.reduce((s, r) => s + r.out, 0) }
  res.json({
    days, plane: 'harness', totals, q, offset, limit,
    total: matched.length,
    named: matched.filter(r => r.name).length,
    sessions: matched.slice(offset, offset + limit),
  })
})

// ---------- Context Window Explorer — real per-turn context occupancy for one session ----------

app.get('/api/context/sessions', (req, res) => {
  const { files } = collectUsage()
  const projNames = {}
  try { for (const d of Object.keys(readClaudeJson().projects || {})) projNames[mangle(d)] = path.basename(d) } catch {}
  const rows = files.filter(f => !f.isAgent && (f.entries || []).length >= 2).map(f => ({
    sessionId: path.basename(f.path, '.jsonl'), project: projNames[f.proj] || f.proj.split('-').pop(),
    turns: f.entries.length, last: f.last, model: f.entries[f.entries.length - 1]?.model || '',
    peak: Math.max(...f.entries.map(e => e.in + e.cc + e.cr)),
  })).sort((a, b) => b.last - a.last)
  res.json({ sessions: rows.slice(0, 300) })
})

app.get('/api/context/:sessionId', (req, res) => {
  const { files } = collectUsage()
  const f = files.find(x => path.basename(x.path, '.jsonl') === req.params.sessionId)
  if (!f || !(f.entries || []).length) return res.status(404).json({ error: 'session not found' })
  const projNames = {}
  try { for (const d of Object.keys(readClaudeJson().projects || {})) projNames[mangle(d)] = path.basename(d) } catch {}
  let prev = null
  const entries = f.entries.map(e => {
    const total = e.in + e.cc + e.cr
    const isCompaction = prev != null && total < prev * 0.6 && prev > 5000
    prev = total
    return { t: e.t, total, in: e.in, cc: e.cc, cr: e.cr, out: e.out, toolCalls: e.tc, model: e.model, isCompaction }
  })
  const peak = Math.max(...entries.map(e => e.total))
  const lastModel = entries[entries.length - 1]?.model || ''
  const budget = (/\[1m\]/i.test(lastModel) || peak > STD_CTX) ? BIG_CTX : STD_CTX
  res.json({
    sessionId: req.params.sessionId, project: projNames[f.proj] || f.proj.split('-').pop(),
    model: lastModel, budget, peak, firstPrompt: firstUserPrompt(f.path),
    first: f.first, last: f.last, entries,
  })
})
}
