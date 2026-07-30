import { CLAUDE, CLAUDE_JSON, mangle, parseFM, readJson, tokens, track } from './dashboard-core.mjs'
import fs from 'node:fs'
import path from 'node:path'

let deepMerge, harnessResolve, settingsFileFor

const readIf = p => { try { return fs.readFileSync(p, 'utf8') } catch { return null } }

const splitSections = src => {
  const out = []
  let cur = { heading: '(preamble)', text: '' }
  for (const line of (src || '').split('\n')) {
    if (/^#{1,3} /.test(line)) { if (cur.text.trim()) out.push(cur); cur = { heading: line.replace(/^#+ /, '').trim(), text: '' } }
    cur.text += line + '\n'
  }
  if (cur.text.trim()) out.push(cur)
  return out
}

function hubListSkills(dir, scope) {
  const out = []
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const src = readIf(path.join(dir, e.name, 'SKILL.md'))
      if (src == null) continue
      const { fm, body } = parseFM(src)
      const st = fs.statSync(path.join(dir, e.name, 'SKILL.md'))
      out.push({ name: e.name, scope, trigger: String(fm.description || '').slice(0, 160), descTokens: tokens(String(fm.description || '')), fullTokens: tokens(src), mtime: st.mtimeMs, path: path.join(dir, e.name, 'SKILL.md'), body })
    }
  } catch {}
  return out
}

function hubListAgents(dir, scope) {
  const out = []
  try {
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
      const src = readIf(path.join(dir, f))
      const { fm, body } = parseFM(src || '')
      const toolsRaw = fm.tools
      const tools = Array.isArray(toolsRaw) ? toolsRaw : String(toolsRaw || '').split(',').map(s => s.trim()).filter(Boolean)
      out.push({ name: f.replace(/\.md$/, ''), scope, model: fm.model || 'inherit', tools, depth: tools.some(t => /^(Task|Agent|\*)$/.test(t)) || tools.length === 0 ? 2 : 1, path: path.join(dir, f), body, desc: String(fm.description || '').slice(0, 140) })
    }
  } catch {}
  return out
}

function hubResolve(project) {
  const H = harnessResolve(project)
  const softCap = H.resolved.context.alwaysLoadedBudget.softCap
  // ---- rules stack in load order ----
  const ruleFiles = [
    { layer: 'global', label: '~/.claude/CLAUDE.md', file: path.join(CLAUDE, 'CLAUDE.md') },
    { layer: 'project', label: '.claude/CLAUDE.md', file: path.join(project, '.claude', 'CLAUDE.md') },
    { layer: 'project', label: 'CLAUDE.md', file: path.join(project, 'CLAUDE.md') },
    { layer: 'project', label: 'AGENTS.md', file: path.join(project, 'AGENTS.md') },
    { layer: 'project', label: '.cursorrules', file: path.join(project, '.cursorrules') },
  ].map(r => { const src = readIf(r.file); return { ...r, exists: src != null, tokens: src ? tokens(src) : 0, src } })
  const rules = ruleFiles.filter(r => r.exists)
  const globalSections = splitSections(rules.find(r => r.layer === 'global')?.src || '')
  // ---- prompt preview blocks with provenance ----
  const promptBlocks = []
  for (const r of rules)
    for (const sec of splitSections(r.src)) {
      const overrides = r.layer === 'project' && globalSections.some(g => g.heading !== '(preamble)' && g.heading.toLowerCase() === sec.heading.toLowerCase())
      promptBlocks.push({ source: r.label, layer: r.layer, path: r.file, heading: sec.heading, text: sec.text.slice(0, 4000), relation: overrides ? 'overrides' : 'appends' })
    }
  // ---- skills / agents (global + project) ----
  const skills = [...hubListSkills(path.join(CLAUDE, 'skills'), 'global'), ...hubListSkills(path.join(project, '.claude', 'skills'), 'project')]
  const agents = [...hubListAgents(path.join(CLAUDE, 'agents'), 'global'), ...hubListAgents(path.join(project, '.claude', 'agents'), 'project')]
  // ---- ADRs ----
  const adrs = []
  for (const d of ['docs/adr', 'docs/adrs', 'adr', 'docs/decisions', 'docs/architecture/decisions'].map(d => path.join(project, d))) {
    try {
      for (const f of fs.readdirSync(d).filter(f => f.endsWith('.md'))) {
        const src = readIf(path.join(d, f)) || ''
        const title = (src.match(/^#\s+(.+)$/m) || [])[1] || f.replace(/\.md$/, '')
        const status = ((src.match(/status[:\s]+\**\s*(proposed|accepted|superseded|rejected|deprecated)/i) || [])[1] || 'proposed').toLowerCase()
        const constrains = (src.split(/^##\s/m)[1] || src).replace(/^.+\n/, '').trim().slice(0, 180)
        adrs.push({ id: f.replace(/\.md$/, ''), title: title.slice(0, 90), status, constrains, path: path.join(d, f), body: src })
      }
    } catch {}
  }
  // ---- references: URLs cited by rules/skills/adrs ----
  const refMap = new Map()
  const cite = (src, byType, byName) => {
    for (const url of (src || '').match(/https?:\/\/[^\s)>"'\]]+/g) || []) {
      const key = url.replace(/[.,;]$/, '')
      if (!refMap.has(key)) refMap.set(key, { url: key, citedBy: [] })
      const r = refMap.get(key)
      if (!r.citedBy.some(c => c.name === byName)) r.citedBy.push({ type: byType, name: byName })
    }
  }
  for (const r of rules) cite(r.src, 'rule', r.label)
  for (const s of skills) cite(s.body, 'skill', s.name)
  for (const a of adrs) cite(a.body, 'adr', a.id)
  const references = [...refMap.values()].slice(0, 40)
  // ---- MCP servers ----
  const cj = readJson(CLAUDE_JSON, {})
  const mcpDefs = []
  for (const [name, config] of Object.entries(cj.mcpServers || {})) mcpDefs.push({ name, scope: 'global', config })
  for (const [name, config] of Object.entries(cj.projects?.[project]?.mcpServers || {})) mcpDefs.push({ name, scope: 'project', config })
  for (const [name, config] of Object.entries(readJson(path.join(project, '.mcp.json'), {}).mcpServers || {})) mcpDefs.push({ name, scope: 'project', config })
  const mcps = mcpDefs.map(m => {
    const usedBy = []
    for (const s of skills) if ((s.body || '').includes(m.name)) usedBy.push({ type: 'skill', name: s.name })
    for (const a of agents) if (a.tools.some(t => t.includes('mcp__' + m.name)) || (a.body || '').includes('mcp__' + m.name)) usedBy.push({ type: 'agent', name: a.name })
    return { name: m.name, scope: m.scope, transport: m.config.url ? 'http' : 'stdio', toolsHint: m.config.url || m.config.command || '', usedBy, estTokens: 600 }
  })
  // ---- context budget contributors ----
  const contributors = [
    { name: 'system prompt', kind: 'system', tokens: H.resolved.context.alwaysLoadedBudget.systemPrompt, mode: 'always', scope: 'global', est: true },
    ...rules.map(r => ({ name: r.label, kind: 'rules', tokens: r.tokens, mode: 'always', scope: r.layer, path: r.file })),
    ...skills.map(s => ({ name: s.name, kind: 'skill', tokens: s.descTokens, onInvoke: s.fullTokens, mode: 'on-invoke', scope: s.scope, path: s.path })),
    ...mcps.map(m => ({ name: m.name, kind: 'mcp', tokens: m.estTokens, mode: 'always', scope: m.scope, est: true })),
    ...references.slice(0, 10).map(r => ({ name: r.url.replace(/^https?:\/\//, '').slice(0, 40), kind: 'reference', tokens: 0, mode: 'on-demand', scope: 'project' })),
  ]
  const alwaysContribs = contributors.filter(c => c.mode === 'always')
  const alwaysOn = alwaysContribs.reduce((s, c) => s + c.tokens, 0) + skills.reduce((s, x) => s + x.descTokens, 0)
  // This total mixes real measurements (rule files and skill descriptions, counted from disk)
  // with estimates (the system-prompt constant and a per-MCP figure). It then drives an
  // error-severity "exceeds the cap" finding, so a breach caused entirely by the estimated part
  // would read as a measured fact about the user's own configuration. The split is published so
  // the finding below can say which it is.
  const alwaysOnEstimated = alwaysContribs.filter(c => c.est).reduce((s, c) => s + c.tokens, 0)
  const alwaysOnMeasured = alwaysOn - alwaysOnEstimated
  // ---- memory / scratchpad ----
  const memory = []
  const memDir = path.join(CLAUDE, 'projects', mangle(project), 'memory')
  try { for (const f of fs.readdirSync(memDir)) { const st = fs.statSync(path.join(memDir, f)); memory.push({ name: 'memory/' + f, path: path.join(memDir, f), mtime: st.mtimeMs, persists: true }) } } catch {}
  for (const f of ['MEMORY.md', '.planning/STATE.md', '.planning/ROADMAP.md', 'docs/superpowers']) {
    try { const st = fs.statSync(path.join(project, f)); memory.push({ name: f, path: path.join(project, f), mtime: st.mtimeMs, persists: true, dir: st.isDirectory() }) } catch {}
  }
  memory.push({ name: 'session scratchpad (/tmp)', path: null, mtime: null, persists: false })
  // ---- graph ----
  const nodes = [], edges = []
  const addNode = (id, type, label, p) => { if (!nodes.some(n => n.id === id)) nodes.push({ id, type, label, path: p || null }) }
  const projRules = rules.filter(r => r.layer === 'project')
  addNode('rules:global', 'rule', 'global rules', path.join(CLAUDE, 'CLAUDE.md'))
  for (const r of projRules) addNode('rules:' + r.label, 'rule', r.label, r.file)
  const topSkills = [...skills].sort((a, b) => b.mtime - a.mtime).slice(0, 10)
  for (const s of topSkills) addNode('skill:' + s.name, 'skill', s.name, s.path)
  for (const a of agents.slice(0, 8)) addNode('agent:' + a.name, 'agent', a.name, a.path)
  for (const m of mcps.slice(0, 8)) addNode('mcp:' + m.name, 'mcp', m.name, null)
  for (const a of adrs.slice(0, 8)) addNode('adr:' + a.id, 'adr', a.id, a.path)
  for (const r of references.slice(0, 6)) addNode('ref:' + r.url, 'ref', r.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 24), null)
  const addEdge = (a, b, rel) => { if (nodes.some(n => n.id === a) && nodes.some(n => n.id === b) && !edges.some(e => e.a === a && e.b === b)) edges.push({ a, b, rel }) }
  for (const s of topSkills) {
    for (const m of mcps) if ((s.body || '').includes(m.name)) addEdge('skill:' + s.name, 'mcp:' + m.name, 'uses')
    for (const r of references.slice(0, 6)) if ((s.body || '').includes(r.url)) addEdge('skill:' + s.name, 'ref:' + r.url, 'cites')
  }
  for (const a of agents.slice(0, 8)) {
    addEdge('agent:' + a.name, projRules.length ? 'rules:' + projRules[0].label : 'rules:global', 'bound by')
    for (const m of mcps) if (a.tools.some(t => t.includes('mcp__' + m.name))) addEdge('agent:' + a.name, 'mcp:' + m.name, 'uses')
  }
  for (const a of adrs.slice(0, 8)) {
    const mentioned = rules.some(r => (r.src || '').includes(a.id)) || (a.body || '').match(/CLAUDE\.md|AGENTS\.md/i)
    if (mentioned) addEdge('adr:' + a.id, projRules.length ? 'rules:' + projRules[0].label : 'rules:global', 'justifies')
  }
  // ---- trigger map ----
  const settingsMerged = deepMerge(readJson(settingsFileFor('global'), {}), readJson(settingsFileFor(project), {}))
  const triggers = []
  for (const [event, ms] of Object.entries(settingsMerged.hooks || {}))
    for (const m of Array.isArray(ms) ? ms : [])
      for (const hk of m.hooks || []) triggers.push({ event: event + (m.matcher ? ` (${m.matcher})` : ''), target: String(hk.command || '').slice(0, 60), kind: 'hook' })
  for (const s of topSkills) if (s.trigger) triggers.push({ event: 'prompt: ' + s.trigger.slice(0, 60), target: '/' + s.name, kind: 'skill' })
  for (const a of agents.slice(0, 6)) if (a.desc) triggers.push({ event: 'delegation: ' + a.desc.slice(0, 60), target: a.name + ' agent', kind: 'agent' })
  // ---- conflict / redundancy audit ----
  const findings = []
  const F = (severity, text, artifact) => findings.push({ severity, text, artifact })
  const names = {}
  for (const s of skills) { (names[s.name] ||= []).push(s) }
  for (const [n, list] of Object.entries(names)) if (list.length > 1) F('warning', `duplicate skill "${n}" exists in global and project scope — project wins`, { type: 'skill', name: n, path: list.find(s => s.scope === 'project')?.path })
  for (const m of mcps) if (!m.usedBy.length) F('info', `MCP server "${m.name}" is referenced by no skill or agent`, { type: 'mcp', name: m.name })
  const mergedRules = rules.map(r => r.src).join('\n')
  if (/\b(test|lint|typecheck)\b/i.test(mergedRules) && triggers.filter(t => t.kind === 'hook').length === 0 && !H.verification.some(g => g.kind === 'gate'))
    F('warning', 'rules mention test/lint/typecheck but no hook or verification gate enforces them', { type: 'rule', name: 'rules stack' })
  if (alwaysOn > softCap) {
    // If the measured part alone is under the cap, the breach depends on figures nobody measured.
    // Saying so is the difference between "trim your rules" and "trim your rules, maybe".
    const measuredAlone = alwaysOnMeasured <= softCap
    F(measuredAlone ? 'warn' : 'error',
      `always-loaded context (${Math.round(alwaysOn / 100) / 10}k) exceeds the ${Math.round(softCap / 1000)}k soft cap`
      + (alwaysOnEstimated ? ` — ${Math.round(alwaysOnEstimated / 100) / 10}k of that is estimated (system prompt + MCP), not measured${measuredAlone ? ', and the measured part alone is under the cap' : ''}` : ''),
      { type: 'budget', name: 'context budget' })
  }
  for (const a of adrs) if (a.status === 'superseded') F('info', `ADR "${a.id}" is superseded — check nothing still cites it`, { type: 'adr', name: a.id, path: a.path })
  for (const b of promptBlocks) if (b.relation === 'overrides') F('info', `project section "${b.heading}" overrides the global section of the same name`, { type: 'rule', name: b.source, path: b.path })
  for (const c of H.valid.conflicts) F('error', c, { type: 'config', name: 'settings.json' })
  const sev = { error: 15, warning: 8, info: 2 }
  const health = Math.max(5, 100 - findings.reduce((s, f) => s + sev[f.severity], 0))
  // ---- sessions (for replay) ----
  const sessions = []
  try {
    const sdir = path.join(CLAUDE, 'projects', mangle(project))
    for (const f of fs.readdirSync(sdir).filter(f => f.endsWith('.jsonl')).slice(0, 200)) {
      const st = fs.statSync(path.join(sdir, f))
      sessions.push({ id: f.replace(/\.jsonl$/, ''), mtime: st.mtimeMs, size: st.size })
    }
  } catch {}
  sessions.sort((a, b) => b.mtime - a.mtime)
  return {
    project, harness: { overridden: H.overridden, health: H.health, valid: H.valid, context: H.resolved.context },
    budget: { contributors, alwaysOn, alwaysOnMeasured, alwaysOnEstimated, softCap, onInvoke: skills.reduce((s, x) => s + x.fullTokens, 0) },
    promptBlocks, graph: { nodes, edges },
    inventory: {
      skills: skills.map(({ body, ...s }) => s), agents: agents.map(({ body, ...a }) => a),
      rules: ruleFiles.map(({ src, ...r }) => r), adrs: adrs.map(({ body, ...a }) => a), references, mcps, memory,
    },
    triggers: triggers.slice(0, 40), findings, health, sessions: sessions.slice(0, 8),
  }
}

export default function mountHarnessHub(app, deps) {
  ({ deepMerge, harnessResolve, settingsFileFor } = deps)

app.get('/api/hub', (req, res) => {
  const project = req.query.project
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  res.json(hubResolve(project))
})

app.get('/api/hub/session', (req, res) => {
  const { project, id } = req.query
  const f = path.join(CLAUDE, 'projects', mangle(String(project || '')), String(id || '') + '.jsonl')
  if (!/^[\w-]+$/.test(String(id || '')) || !fs.existsSync(f)) return res.status(404).json({ error: 'no such session' })
  const out = { skills: [], agents: [], tools: {}, msgs: 0, compactions: 0, first: null, last: null }
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue
    try {
      const j = JSON.parse(line)
      if (j.timestamp) { out.last = Date.parse(j.timestamp); out.first ??= out.last }
      if (j.isCompactSummary || j.type === 'summary') out.compactions++
      if (j.type !== 'assistant' || !Array.isArray(j.message?.content)) continue
      out.msgs++
      for (const c of j.message.content) {
        if (c.type !== 'tool_use') continue
        out.tools[c.name] = (out.tools[c.name] || 0) + 1
        if (c.name === 'Skill' && c.input?.skill) out.skills.push(c.input.skill)
        if ((c.name === 'Task' || c.name === 'Agent') && c.input) out.agents.push(c.input.subagent_type || c.input.description || 'agent')
      }
    } catch {}
  }
  out.skills = [...new Set(out.skills)]
  res.json(out)
})

app.get('/api/hub/file', (req, res) => {
  const p = path.resolve(String(req.query.path || ''))
  const cj = readJson(CLAUDE_JSON, {})
  const roots = [CLAUDE, ...Object.keys(cj.projects || {})]
  if (!roots.some(r => p === r || p.startsWith(r + path.sep))) return res.status(403).json({ error: 'outside allowed roots' })
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return res.status(404).json({ error: 'not a file' })
  res.json({ path: p, content: fs.readFileSync(p, 'utf8') })
})

app.put('/api/hub/file', (req, res) => {
  const p = path.resolve(String(req.body.path || ''))
  const cj = readJson(CLAUDE_JSON, {})
  const roots = [CLAUDE, ...Object.keys(cj.projects || {})]
  if (!roots.some(r => p === r || p.startsWith(r + path.sep))) return res.status(403).json({ error: 'outside allowed roots' })
  if (p.endsWith('.json')) { try { JSON.parse(req.body.content) } catch (e) { return res.status(400).json({ error: 'invalid JSON: ' + e.message }) } }
  const scope = roots.find(r => r !== CLAUDE && p.startsWith(r + path.sep)) || 'global'
  track(p, req.body.content, { scope, summary: 'edit ' + path.basename(p) })
  res.json({ ok: true })
})
}
