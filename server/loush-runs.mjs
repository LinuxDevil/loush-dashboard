import { PROJECT, mangle, readClaudeJson } from './dashboard-core.mjs'
import { entryCost } from '../lib/pricing.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { runAgent } from '../lib/agent.mjs'
import { verdictFrom } from '../lib/run-verdict.mjs'

let collectUsage

function projectDirs() {
  const s = new Set([PROJECT])
  try { for (const d of Object.keys(readClaudeJson().projects || {})) s.add(path.resolve(d)) } catch {}
  return s
}

function loushSafe(proj, ...rel) {
  const P = path.resolve(String(proj || ''))
  if (!projectDirs().has(P)) throw Object.assign(new Error('unknown project'), { status: 403 })
  const base = path.join(P, '.loush')
  const p = path.resolve(base, ...rel)
  if (p !== base && !p.startsWith(base + path.sep)) throw Object.assign(new Error('path escapes .loush'), { status: 403 })
  return p
}

const eventsCache = new Map()

function normalizeEvent(e, i) {
  if (e.seq == null) e.seq = i + 1
  if (e.t == null && e.ts != null) e.t = e.ts
  if (e.type == null && e.event != null) e.type = e.event
  if (e.data == null || typeof e.data !== 'object') e.data = {}
  if (e.type === 'run.started' && e.data.flow == null && e.flow != null) e.data.flow = e.flow
  if ((e.type === 'step.started' || e.type === 'step.completed') && e.data.label == null && e.phase != null) e.data.label = e.phase
  return e
}

function readEvents(file) {
  let st; try { st = fs.statSync(file) } catch { return [] }
  const c = eventsCache.get(file)
  if (c && c.mtime === st.mtimeMs && c.size === st.size) return c.events
  let events = []
  try {
    events = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      .map((l, i) => { try { return normalizeEvent(JSON.parse(l), i) } catch { return null } })
      .filter(Boolean)
  } catch { return [] }
  eventsCache.set(file, { mtime: st.mtimeMs, size: st.size, events })
  return events
}

function runDir(proj, ticket) {
  const base = loushSafe(proj)
  const sub = loushSafe(proj, String(ticket || ''))
  return (fs.existsSync(path.join(sub, 'events.jsonl')) || fs.existsSync(path.join(sub, 'state.json'))) ? sub : base
}

const asMs = v => (typeof v === 'number' ? v : Date.parse(v) || null)

function computeVerdict(dir, state, term, awaitingApproval) {
  let review = null
  try { review = JSON.parse(fs.readFileSync(path.join(dir, 'review.json'), 'utf8')) } catch {}
  return verdictFrom({ review, retries: state.retries, phase: state.phase, phaseStatus: state.phase_status,
    terminalFailed: term?.type === 'run.failed', terminalDone: term?.type === 'run.completed', awaitingApproval })
}

function scanRuns() {
  const runs = []
  for (const proj of projectDirs()) {
    const root = path.join(proj, '.loush')
    if (!fs.existsSync(root)) continue
    const dirs = [root]
    try { for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isDirectory()) dirs.push(path.join(root, e.name)) } catch {}
    for (const dir of dirs) {
      const stateF = path.join(dir, 'state.json'), evF = path.join(dir, 'events.jsonl')
      if (!fs.existsSync(stateF) && !fs.existsSync(evF)) continue
      let state = {}
      try { state = JSON.parse(fs.readFileSync(stateF, 'utf8')) } catch {}
      const events = fs.existsSync(evF) ? readEvents(evF) : []
      const term = [...events].reverse().find(e => e.type === 'run.completed' || e.type === 'run.failed')
      const ticket = dir === root ? (state.ticket_id || '(current)') : path.basename(dir)
      const status = term ? (term.type === 'run.completed' ? (term.data?.status || 'completed') : 'failed')
        : state.phase_status === 'blocked' ? 'blocked' : state.phase_status === 'failed' ? 'failed'
        : (events.length || state.phase) ? 'running' : 'unknown'
      runs.push({
        proj, projName: path.basename(proj), ticket, flow: state.flow || events[0]?.data?.flow || null,
        phase: state.phase || null, phaseStatus: state.phase_status || null, retries: state.retries || null,
        headSha: state.head_sha || null, updatedAt: asMs(state.updated_at) || (fs.existsSync(evF) ? fs.statSync(evF).mtimeMs : null),
        events: events.length, startedAt: asMs(events[0]?.t), endedAt: asMs(term?.t), status,
        branch: state.branch || null, base: state.base || null, note: state.note || null,
        decision: state.decision || term?.data?.decision || null,
        hasReview: fs.existsSync(path.join(dir, 'review.json')),
        awaitingApproval: state.phase_status === 'blocked' && !fs.existsSync(path.join(dir, 'approvals.json')),
        verdict: computeVerdict(dir, state, term, state.phase_status === 'blocked' && !fs.existsSync(path.join(dir, 'approvals.json'))),
      })
    }
  }
  return runs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}
// ponytail: time-window join — no sessionId plumbing needed. Exact only if one run per repo at a time.

function joinRunCost(runs) {
  let entries = []
  try { entries = collectUsage().entries } catch { return }
  const byProj = {}
  for (const e of entries) (byProj[e.proj] ||= []).push(e)
  for (const r of runs) {
    if (!r.startedAt) { r.cost = null; continue }
    const end = r.endedAt || Date.now()
    r.cost = (byProj[mangle(r.proj)] || []).filter(e => e.t >= r.startedAt && e.t <= end).reduce((s, e) => s + entryCost(e), 0)
  }
}

const LOUSH_FLOWS = ['loush-jira-implement', 'loush-feature', 'loush-pr-review', 'loush-test-cases', 'loush-bug-fix']

export default function mountLoushRuns(app, deps) {
  ({ collectUsage } = deps)

app.get('/api/runs', (req, res) => {
  const all = scanRuns()
  joinRunCost(all)
  const { proj, flow, status, ticket } = req.query
  let runs = all
  if (proj) runs = runs.filter(r => r.projName === proj)
  if (flow) runs = runs.filter(r => r.flow === flow)
  if (status) runs = runs.filter(r => r.status === status)
  if (req.query.verdict) runs = runs.filter(r => r.verdict === req.query.verdict)
  if (ticket) runs = runs.filter(r => r.ticket.toLowerCase().includes(String(ticket).toLowerCase()))
  res.json({
    runs, projects: [...new Set(all.map(r => r.projName))].sort(), flows: [...new Set(all.map(r => r.flow).filter(Boolean))].sort(),
    allProjects: [...projectDirs()].map(p => ({ name: path.basename(p), path: p })).sort((a, b) => a.name.localeCompare(b.name)),
    dispatchFlows: LOUSH_FLOWS,
  })
})

app.get('/api/runs/events', (req, res) => {
  const events = readEvents(path.join(runDir(req.query.proj, req.query.ticket), 'events.jsonl'))
  const after = Number(req.query.after) || 0
  res.json({ events: events.filter(e => (e.seq || 0) > after) })
})

app.get('/api/runs/files', (req, res) => {
  const dir = runDir(req.query.proj, req.query.ticket)
  let files = []
  try {
    files = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name !== 'events.jsonl')
      .map(e => { const st = fs.statSync(path.join(dir, e.name)); return { name: e.name, size: st.size, mtime: st.mtimeMs } })
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {}
  res.json({ files })
})

app.get('/api/runs/artifact', (req, res) => {
  const dir = runDir(req.query.proj, req.query.ticket)
  const name = String(req.query.name || '').replace(/[^\w./-]/g, '')
  const p = path.resolve(dir, name)
  if (p !== dir && !p.startsWith(dir + path.sep)) return res.status(403).json({ error: 'bad name' })
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' })
  res.json({ content: fs.readFileSync(p, 'utf8') })
})

app.post('/api/runs/approve', (req, res) => {
  const { proj, ticket, decision, comments, artifact } = req.body
  if (!['approve', 'revise'].includes(decision)) return res.status(400).json({ error: 'decision must be approve|revise' })
  const dir = runDir(proj, ticket)
  fs.writeFileSync(path.join(dir, 'approvals.json'), JSON.stringify({ artifact: artifact || 'test-plan', decision, comments: comments || [] }, null, 2))
  res.json({ ok: true })
})

app.post('/api/runs/approve-batch', (req, res) => {
  const { runs, decision, comments } = req.body
  if (!['approve', 'revise'].includes(decision)) return res.status(400).json({ error: 'decision must be approve|revise' })
  if (!Array.isArray(runs) || !runs.length) return res.status(400).json({ error: 'runs must be a non-empty array' })
  const results = runs.map(({ proj, ticket, artifact }) => {
    try {
      fs.writeFileSync(path.join(runDir(proj, ticket), 'approvals.json'), JSON.stringify({ artifact: artifact || 'test-plan', decision, comments: comments || [] }, null, 2))
      return { proj, ticket, ok: true }
    } catch (e) { return { proj, ticket, ok: false, error: e.message } }
  })
  res.json({ ok: results.every(r => r.ok), results })
})

app.post('/api/runs/dispatch', (req, res) => {
  const { proj, flow } = req.body || {}
  const ticket = String(req.body?.ticket || '').trim()
  if (!LOUSH_FLOWS.includes(flow)) return res.status(400).json({ error: 'unknown flow' })
  if (!/^[\w.\/-]+$/.test(ticket)) return res.status(400).json({ error: 'ticket required (letters, digits, . _ / -)' })
  let dir
  try { dir = loushSafe(proj, ticket) } catch (e) { return res.status(e.status || 400).json({ error: e.message }) }
  if (fs.existsSync(path.join(dir, 'state.json')) || fs.existsSync(path.join(dir, 'events.jsonl')))
    return res.status(409).json({ error: 'a run for this ticket already exists — clear .loush/' + ticket + '/ first' })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ticket_id: ticket, flow, phase: 'dispatch', phase_status: 'running', updated_at: new Date().toISOString() }, null, 2))
  runAgent({ cwd: path.resolve(proj), prompt: `/${flow} ${ticket}`, timeoutMs: 4 * 3600_000 }).catch(() => {})
  res.json({ ok: true })
})
}

export { projectDirs, scanRuns }
