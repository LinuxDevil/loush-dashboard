import { CLAUDE, PROJECT, mangle, readJson, tokens } from './dashboard-core.mjs'
import fs from 'node:fs'
import path from 'node:path'

const TEAMS = path.join(CLAUDE, 'teams')

const TASKS = path.join(CLAUDE, 'tasks')

function listTeams() {
  try {
    return fs.readdirSync(TEAMS).filter(t => fs.existsSync(path.join(TEAMS, t, 'config.json')))
      .sort((a, b) => fs.statSync(path.join(TEAMS, b, 'config.json')).mtimeMs - fs.statSync(path.join(TEAMS, a, 'config.json')).mtimeMs)
  } catch { return [] }
}

function readInboxes(team) {
  const dir = path.join(TEAMS, team, 'inboxes'), msgs = []
  try {
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const raw = readJson(path.join(dir, f), [])
      const arr = Array.isArray(raw) ? raw : raw.messages || []
      const inboxOwner = f.replace(/\.json$/, '')
      for (const m of arr) {
        let text = m.content ?? m.text ?? ''
        let kind = 'text'
        if (typeof text === 'string' && text.startsWith('{')) {
          let j = null; try { j = JSON.parse(text) } catch {}
          if (j?.type) { kind = j.type; text = j.text || j.content || j.message || `[${j.type}]` }
        }
        msgs.push({ from: m.from || '?', to: m.to || inboxOwner, text: String(text), kind, ts: Date.parse(m.timestamp) || m.timestamp || 0 })
      }
    }
  } catch {}
  msgs.sort((a, b) => b.ts - a.ts)
  return msgs
}

function findTranscript(cwd, agentId, name) {
  const roots = [path.join(CLAUDE, 'projects', mangle(cwd || PROJECT))]
  const wanted = [`agent-${agentId}.jsonl`, `${agentId}.jsonl`, `agent-${name}.jsonl`]
  let best = null
  const walk = (d, depth) => {
    if (depth > 3) return
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of es) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (wanted.includes(e.name) || (e.name.endsWith('.jsonl') && agentId && e.name.includes(agentId))) {
        const st = fs.statSync(p)
        if (!best || st.mtimeMs > best.mtime) best = { path: p, mtime: st.mtimeMs }
      }
    }
  }
  for (const r of roots) walk(r, 0)
  return best
}

const teamTokCache = new Map()

function transcriptStats(file) {
  const st = fs.statSync(file)
  let rec = teamTokCache.get(file)
  if (rec && rec.mtime === st.mtimeMs && rec.size === st.size) return rec
  rec = { mtime: st.mtimeMs, size: st.size, tokens: 0, model: null, lastErr: null }
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (line.includes('"usage"')) {
        try {
          const j = JSON.parse(line), u = j.message?.usage
          if (u) { rec.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0); rec.model = j.message.model || rec.model }
        } catch {}
      } else if (line.includes('"is_error":true') || line.includes('"isApiErrorMessage":true')) {
        try { const j = JSON.parse(line); rec.lastErr = String(j.message?.content?.[0]?.text || j.error || '').slice(0, 300) || rec.lastErr } catch {}
      }
    }
  } catch {}
  teamTokCache.set(file, rec)
  return rec
}

const ACTIVE_TEAM_MS = 30_000

function teamState(teamName) {
  const cfg = readJson(path.join(TEAMS, teamName, 'config.json'), null)
  if (!cfg) return null
  const messages = readInboxes(teamName)
  const tasks = []
  try {
    for (const f of fs.readdirSync(path.join(TASKS, teamName)).filter(f => f.endsWith('.json'))) {
      const t = readJson(path.join(TASKS, teamName, f), null)
      if (t) tasks.push(t)
    }
  } catch {}
  tasks.sort((a, b) => Number(a.id) - Number(b.id))
  const now = Date.now()
  const members = (cfg.members || []).map(m => {
    const isLead = m.agentType === 'team-lead' || m.agentId === cfg.leadAgentId
    const tr = findTranscript(m.cwd, m.agentId, m.name)
    const stats = tr ? transcriptStats(tr.path) : null
    const myTask = tasks.find(t => t.owner === m.name && t.status === 'in_progress')
    const recentlyActive = tr && now - tr.mtime < ACTIVE_TEAM_MS
    // ponytail: status is a heuristic (no status file exists) — transcript freshness + task claim + idle pings
    const lastIdlePing = messages.find(x => x.from === m.name && /idle/i.test(x.kind))
    let status = 'idle'
    if (stats?.lastErr && !recentlyActive) status = 'failed'
    else if (m.planModeRequired && messages.find(x => x.from === m.name && /plan/i.test(x.kind))) status = 'planning'
    else if (recentlyActive || myTask) status = 'working'
    else if (lastIdlePing || !tr) status = 'idle'
    if (tr && now - tr.mtime > 30 * 60_000 && !myTask) status = 'shutdown'
    return {
      name: m.name, agentId: m.agentId, agentType: m.agentType, isLead,
      model: (m.model || stats?.model || '').replace(/^claude-/, ''),
      effort: m.effort || null, permissionMode: m.planModeRequired ? 'plan' : m.permissionMode || 'default',
      status: isLead ? (recentlyActive ? 'working' : 'idle') : status,
      currentTask: myTask ? (myTask.activeForm || myTask.subject) : null,
      error: stats?.lastErr || null, tokens: stats?.tokens || 0,
      startedAt: m.joinedAt || cfg.createdAt || null, transcript: tr?.path || null, lastActivity: tr?.mtime || null,
    }
  })
  return {
    team: { name: cfg.name || teamName, dir: path.join(TEAMS, teamName), createdAt: cfg.createdAt || fs.statSync(path.join(TEAMS, teamName)).birthtimeMs },
    members, tasks: tasks.map(t => ({ id: t.id, subject: t.subject, description: t.description, status: t.status, owner: t.owner || null, blockedBy: t.blockedBy || [], blocks: t.blocks || [] })),
    messages: messages.slice(0, 200).map(m => ({ ...m, fromLead: members.find(x => x.isLead)?.name === m.from, toLead: members.find(x => x.isLead)?.name === m.to })),
    live: members.some(m => m.lastActivity && now - m.lastActivity < 5 * 60_000),
  }
}

function inboxAppend(team, to, content) {
  const cfg = readJson(path.join(TEAMS, team, 'config.json'), null)
  if (!cfg) throw Object.assign(new Error('no such team'), { status: 404 })
  const lead = cfg.members?.find(m => m.agentType === 'team-lead' || m.agentId === cfg.leadAgentId)
  const file = path.join(TEAMS, team, 'inboxes', to + '.json')
  const raw = readJson(file, [])
  const arr = Array.isArray(raw) ? raw : raw.messages || []
  arr.push({ from: lead?.name || 'team-lead', to, content, timestamp: new Date().toISOString(), read: false, messageId: 'dash-' + Date.now() })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(Array.isArray(raw) ? arr : { ...raw, messages: arr }, null, 2))
}

export default function mountAgentTeams(app) {
app.get('/api/team', (req, res) => {
  const teams = listTeams()
  const name = req.query.team && teams.includes(req.query.team) ? req.query.team : teams[0]
  if (!name) return res.json({ team: null, teams })
  const state = teamState(name)
  if (!state) return res.json({ team: null, teams })
  res.json({ ...state, teams })
})

app.get('/api/team/agent', (req, res) => {
  const { team, name } = req.query
  const cfg = readJson(path.join(TEAMS, team || '', 'config.json'), null)
  const m = cfg?.members?.find(x => x.name === name)
  if (!m) return res.status(404).json({ error: 'no such teammate' })
  const tr = findTranscript(m.cwd, m.agentId, m.name)
  let events = [], currentTool = null
  if (tr) {
    const st = fs.statSync(tr.path)
    const start = Math.max(0, st.size - 256 * 1024)
    const fd = fs.openSync(tr.path, 'r'), buf = Buffer.alloc(st.size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    const lines = buf.toString('utf8').split('\n').slice(start > 0 ? 1 : 0)
    const open = new Map()
    for (const line of lines) {
      try {
        const j = JSON.parse(line)
        if (j.type === 'assistant' || j.type === 'user') {
          events.push(j)
          for (const c of (Array.isArray(j.message?.content) ? j.message.content : []))
            if (c.type === 'tool_use') open.set(c.id, c.name)
            else if (c.type === 'tool_result') open.delete(c.tool_use_id)
        }
      } catch {}
    }
    events = events.slice(-120)
    currentTool = [...open.values()].pop() || null
  }
  res.json({ transcript: tr?.path || null, events, currentTool })
})

app.post('/api/team/message', (req, res) => {
  inboxAppend(req.body.team, req.body.name, req.body.text)
  res.json({ ok: true })
})

app.post('/api/team/interrupt', (req, res) => {
  // ponytail: no external interrupt API exists — best effort is a priority inbox message
  inboxAppend(req.body.team, req.body.name, '[interrupt] Stop your current work immediately and check your inbox for further instructions.')
  res.json({ ok: true, note: 'best-effort: delivered as inbox message' })
})

app.post('/api/team/shutdown', (req, res) => {
  inboxAppend(req.body.team, req.body.name, JSON.stringify({ type: 'shutdown_request', text: 'Please finish your current step, hand off any state, and shut down gracefully.' }))
  res.json({ ok: true })
})

app.post('/api/team/plan', (req, res) => {
  const { team, name, approve, feedback } = req.body
  inboxAppend(team, name, approve
    ? `Plan approved.${feedback ? ' Notes: ' + feedback : ''} Proceed with implementation.`
    : `Plan rejected. Revise and resubmit. Feedback: ${feedback}`)
  res.json({ ok: true })
})

// ---------- harness (scope-based config with inheritance) ----------
}
