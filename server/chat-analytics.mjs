import { CLAUDE, mangle, parseFM, readClaudeJson, readJson } from './dashboard-core.mjs'
import { entryCost } from '../lib/pricing.mjs'
import fs from 'node:fs'
import path from 'node:path'

let chats, collectUsage, scanTranscripts

const normPrompt = s => s.toLowerCase().replace(/\s+/g, ' ').trim()

const tokset = s => new Set(normPrompt(s).split(' ').filter(w => w.length > 2))

const jaccard = (a, b) => { let i = 0; for (const w of a) if (b.has(w)) i++; return i / (a.size + b.size - i || 1) }

export default function mountChatAnalytics(app, deps) {
  ({ chats, collectUsage, scanTranscripts } = deps)

app.get('/api/flow', (req, res) => {
  const project = req.query.project && req.query.project !== 'global' && fs.existsSync(req.query.project) ? req.query.project : null
  const nodes = [], seen = new Set()
  const nid = (kind, name) => kind + ':' + name
  const addNode = (kind, name, extra = {}) => { const id = nid(kind, name); if (!seen.has(id)) { seen.add(id); nodes.push({ id, kind, name, ...extra }) }; return id }
  addNode('entry', 'prompt')
  const bodies = {}
  for (const kind of ['skills', 'commands', 'agents']) {
    const dirs = [{ scope: 'global', dir: path.join(CLAUDE, kind) }]
    if (project) dirs.push({ scope: 'project', dir: path.join(project, '.claude', kind) })
    for (const { scope, dir } of dirs) {
      if (!fs.existsSync(dir)) continue
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const name = kind === 'skills' ? entry.name : entry.name.replace(/\.md$/, '')
        const file = kind === 'skills' ? path.join(dir, name, 'SKILL.md') : path.join(dir, name + '.md')
        if (!fs.existsSync(file)) continue
        const content = fs.readFileSync(file, 'utf8')
        const { fm } = parseFM(content)
        const nodeKind = kind === 'agents' ? 'agent' : kind === 'skills' ? 'skill' : 'command'
        const id = addNode(nodeKind, name, { scope, model: fm.model || null, description: String(fm.description || '').slice(0, 160) })
        bodies[id] = content
      }
    }
  }
  try { for (const name of Object.keys(readClaudeJson().mcpServers || {})) addNode('mcp', name, { scope: 'global' }) } catch {}
  if (project) for (const name of Object.keys(readJson(path.join(project, '.mcp.json'), {}).mcpServers || {})) addNode('mcp', name, { scope: 'project' })
  const defined = new Map()
  const named = nodes.filter(n => n.kind !== 'entry')
  for (const [srcId, body] of Object.entries(bodies)) {
    for (const n of named) {
      if (n.id === srcId || n.name.length < 4) continue
      const hit = n.kind === 'mcp' ? body.includes('mcp__' + n.name) :
        new RegExp('(^|[\\s"`\'(/])' + n.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([\\s"`\'):.,]|$)', 'm').test(body)
      if (hit) defined.set(srcId + '→' + n.id, { from: srcId, to: n.id })
    }
  }
  for (const n of nodes) if (n.kind === 'skill' || n.kind === 'command') defined.set('entry:prompt→' + n.id, { from: 'entry:prompt', to: n.id, trigger: true })
  const { invocations } = scanTranscripts()
  const projFilter = project ? mangle(project) : null
  const observed = new Map(), nodeUse = {}
  for (const inv of invocations) {
    if (projFilter && inv.proj !== projFilter) continue
    const to = nid(inv.kind, inv.name)
    if (!seen.has(to)) addNode(inv.kind, inv.name, { ghost: true })
    const from = inv.src && seen.has(inv.src) ? inv.src : 'entry:prompt'
    const k = from + '→' + to
    const e = observed.get(k) || { from, to, count: 0, last: 0 }
    e.count++; e.last = Math.max(e.last, inv.t); observed.set(k, e)
    const u = nodeUse[to] ||= { count: 0, last: 0 }; u.count++; u.last = Math.max(u.last, inv.t)
  }
  for (const n of nodes) Object.assign(n, nodeUse[n.id] || { count: 0, last: null })
  const deadEnds = nodes.filter(n => n.kind !== 'entry' && !n.ghost && !n.count).map(n => n.id)
  const adj = {}; for (const e of defined.values()) (adj[e.from] ||= []).push(e.to)
  const cycles = [], state = {}
  const dfs = (v, stack) => {
    state[v] = 1
    for (const w of adj[v] || []) {
      if (state[w] === 1) cycles.push([...stack.slice(stack.indexOf(w)), w].join(' → '))
      else if (!state[w]) dfs(w, [...stack, w])
    }
    state[v] = 2
  }
  for (const n of nodes) if (!state[n.id]) dfs(n.id, [n.id])
  const out = {}; for (const e of observed.values()) (out[e.from] ||= []).push(e)
  const trail = ['entry:prompt']
  for (let i = 0; i < 6; i++) {
    const next = (out[trail[trail.length - 1]] || []).filter(e => !trail.includes(e.to)).sort((a, b) => b.count - a.count)[0]
    if (!next) break
    trail.push(next.to)
  }
  res.json({ nodes, defined: [...defined.values()], observed: [...observed.values()], deadEnds, cycles: [...new Set(cycles)].slice(0, 10), trail: trail.length > 1 ? trail : [] })
})

// ---------- 14: duplicated prompts across chats ----------

app.get('/api/dupes', (req, res) => {
  const days = Number(req.query.days) || 90
  const sim = Math.min(1, Math.max(0.3, Number(req.query.sim) || 0.75))
  const projFilter = req.query.project ? mangle(req.query.project) : null
  const cutoff = Date.now() - days * 86400_000
  const { prompts } = scanTranscripts()
  const list = prompts.filter(p => p.t >= cutoff && (!projFilter || p.proj === projFilter) && p.text.length >= 25 && !p.text.startsWith('/')).slice(-4000)
  const clusters = []
  for (const p of list) {
    const toks = tokset(p.text)
    let best = null, bestScore = 0
    for (const c of clusters) { const s = jaccard(toks, c.toks); if (s > bestScore) { bestScore = s; best = c } }
    if (best && bestScore >= sim) best.items.push(p)
    else clusters.push({ canonical: p.text, toks, items: [p] })
  }
  const out = clusters.filter(c => c.items.length >= 2).sort((a, b) => b.items.length - a.items.length).slice(0, 60).map(c => ({
    canonical: c.canonical, count: c.items.length,
    projects: [...new Set(c.items.map(i => i.proj))],
    sessions: new Set(c.items.map(i => i.sessionId)).size,
    first: c.items[0].t, last: c.items[c.items.length - 1].t,
    exact: new Set(c.items.map(i => normPrompt(i.text))).size === 1,
    items: c.items.slice(-10).map(({ t, proj, sessionId, text }) => ({ t, proj, sessionId, text: text.slice(0, 240) })),
  }))
  res.json({ scanned: list.length, clusters: out })
})

// ---------- 15: chat stats ----------

app.get('/api/chatstats', (req, res) => {
  const days = Number(req.query.days) || 30
  const projFilter = req.query.project ? mangle(req.query.project) : null
  const cutoff = Date.now() - days * 86400_000
  const { prompts, sessions } = scanTranscripts()
  const { entries } = collectUsage()
  const sess = sessions.filter(s => !s.isAgent && s.userMsgs > 0 && s.last >= cutoff && (!projFilter || s.proj === projFilter))
  const pr = prompts.filter(p => p.t >= cutoff && (!projFilter || p.proj === projFilter))
  const en = entries.filter(e => e.t >= cutoff && (!projFilter || e.proj === projFilter))
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0))
  for (const p of pr) { const d = new Date(p.t); heat[d.getDay()][d.getHours()]++ }
  let reprompts = 0
  const prevBySess = {}
  for (const p of pr) {
    const prev = prevBySess[p.sessionId]
    if (prev && p.t - prev.t < 180_000 && jaccard(tokset(p.text), tokset(prev.text)) >= 0.5) reprompts++
    prevBySess[p.sessionId] = p
  }
  const oneShot = sess.filter(s => s.userMsgs === 1 && s.toolCalls > 0).length
  // ponytail: "abandoned" = one prompt, zero tool calls — crude but observable
  const abandoned = sess.filter(s => s.userMsgs === 1 && s.toolCalls === 0).length
  const cost = en.reduce((s, e) => s + entryCost(e), 0)
  const byProj = {}, byModel = {}
  for (const e of en) { byProj[e.proj] = (byProj[e.proj] || 0) + entryCost(e); byModel[e.model] = (byModel[e.model] || 0) + entryCost(e) }
  const durs = sess.map(s => s.last - s.first).filter(d => d > 0)
  const dupes = new Map()
  for (const p of pr) { if (p.text.length >= 25 && !p.text.startsWith('/')) { const k = normPrompt(p.text); dupes.set(k, (dupes.get(k) || 0) + 1) } }
  const reused = [...dupes.entries()].filter(([, n]) => n >= 2)
  const byHour = new Array(24).fill(0); for (const p of pr) byHour[new Date(p.t).getHours()]++
  res.json({
    chats: sess.length, msgs: pr.length,
    avgMsgs: sess.length ? pr.length / sess.length : 0,
    activeDays: new Set(pr.map(p => new Date(p.t).toISOString().slice(0, 10))).size,
    heat, byHour,
    avgSessionMs: durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0,
    toolsPerChat: sess.length ? sess.reduce((x, s) => x + s.toolCalls, 0) / sess.length : 0,
    oneShotRate: sess.length ? oneShot / sess.length : 0,
    abandonRate: sess.length ? abandoned / sess.length : 0,
    repromptRate: pr.length ? reprompts / pr.length : 0,
    reuseRate: dupes.size ? reused.reduce((s, [, n]) => s + n, 0) / Math.max(1, [...dupes.values()].reduce((a, b) => a + b, 0)) : 0,
    dupClusters: reused.length,
    tokIn: en.reduce((s, e) => s + e.in + e.cc + e.cr, 0), tokOut: en.reduce((s, e) => s + e.out, 0),
    cost, costPerChat: sess.length ? cost / sess.length : 0,
    byProj: Object.entries(byProj).sort((a, b) => b[1] - a[1]).slice(0, 6),
    byModel: Object.entries(byModel).sort((a, b) => b[1] - a[1]).slice(0, 6),
    longest: [...sess].sort((a, b) => b.userMsgs - a.userMsgs).slice(0, 6).map(s => ({ proj: s.proj, sessionId: s.sessionId, userMsgs: s.userMsgs, toolCalls: s.toolCalls, last: s.last })),
    topPrompts: reused.sort((a, b) => b[1] - a[1]).slice(0, 6).map(([text, n]) => ({ text: text.slice(0, 140), count: n })),
  })
})

// ---------- 16: search my past self (palette) ----------

app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').toLowerCase()
  const file = String(req.query.file || '').toLowerCase()
  const kinds = new Set(String(req.query.kind || 'all').split(',').map(s => s.trim()))
  const wants = k => kinds.has('all') || kinds.has(k)
  const limit = Math.min(100, Number(req.query.limit) || 25)
  if (q.length < 3 && !file) return res.json([])
  const { prompts, texts, cmds, edits, sessions } = scanTranscripts()
  const meta = {}
  for (const s of sessions) meta[s.sessionId] = s
  const okSession = sid => !file || (meta[sid]?.files || []).some(p => p.toLowerCase().includes(file))
  const hits = []
  const snip = (text, at) => text.slice(Math.max(0, at - 60), at + 160)
  const scan = (list, kind, field, extra = () => ({})) => {
    if (!wants(kind)) return
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i]
      const hay = String(r[field] || '')
      const idx = q ? hay.toLowerCase().indexOf(q) : 0
      if (q && idx < 0) continue
      if (!okSession(r.sessionId)) continue
      if (file && kind === 'edit' && !String(r.file || '').toLowerCase().includes(file)) continue
      const s = meta[r.sessionId]
      hits.push({
        kind, proj: r.proj, sessionId: r.sessionId, t: r.t, snippet: snip(hay, idx),
        cwd: s?.cwd || null, branch: s?.branch || null,
        files: (s?.files || []).filter(p => !file || p.toLowerCase().includes(file)).slice(0, 5),
        resume: s?.cwd ? `cd ${s.cwd} && claude --resume ${r.sessionId}` : `claude --resume ${r.sessionId}`,
        ...extra(r),
      })
    }
  }
  scan(prompts, 'prompt', 'text')
  scan(texts, 'assistant', 'text')
  scan(cmds, 'bash', 'cmd')
  scan(edits, 'edit', 'hunk', e => ({ file: e.file, add: e.add, del: e.del }))
  if (!q && file)
    for (const s of sessions) {
      const f = (s.files || []).filter(p => p.toLowerCase().includes(file))
      if (!f.length) continue
      hits.push({ kind: 'session', proj: s.proj, sessionId: s.sessionId, t: s.last, snippet: `${f.length} file(s) touched · ${s.userMsgs} prompts`, cwd: s.cwd || null, branch: s.branch || null, files: f.slice(0, 5), resume: s.cwd ? `cd ${s.cwd} && claude --resume ${s.sessionId}` : `claude --resume ${s.sessionId}` })
    }
  res.json(hits.sort((a, b) => b.t - a.t).slice(0, limit))
})
}
