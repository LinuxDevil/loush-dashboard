// Cursor dashboard — fully separate read-only routes under /api/cursor/*.
// Reads Cursor's state.vscdb with the sqlite3 CLI on PATH (mode=ro: no npm dep,
// no lock contention with a running Cursor). Schema is undocumented — everything fails soft.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const HOME = os.homedir()
// Cursor's per-user data dir is platform-specific (same layout as VS Code):
//   macOS   ~/Library/Application Support/Cursor/User
//   Windows %APPDATA%\Cursor\User   (falls back to ~/AppData/Roaming)
//   Linux   ~/.config/Cursor/User
const CURSOR_USER = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'Cursor', 'User')
  : process.platform === 'darwin'
    ? path.join(HOME, 'Library', 'Application Support', 'Cursor', 'User')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'Cursor', 'User')
const DB = path.join(CURSOR_USER, 'globalStorage', 'state.vscdb')
const WS_DIR = path.join(CURSOR_USER, 'workspaceStorage')

function sq(sql, maxBuffer = 8 * 1024 * 1024) {
  const r = spawnSync('sqlite3', ['-json', `file:${DB}?mode=ro`, sql], { timeout: 120_000, maxBuffer })
  if (r.status !== 0) throw new Error('sqlite3: ' + (r.stderr || '').toString().slice(0, 200))
  const out = r.stdout.toString().trim()
  return out ? JSON.parse(out) : []
}

// composerId -> {workspaceId, folder, linesAdded, linesRemoved} from each workspace's own
// state.vscdb (ItemTable key 'composer.composerData' -> allComposers). The global
// composerHeaders table is empty in current Cursor builds — this is the real mapping.
function workspaceComposers() {
  const byComposer = {}, folders = {}
  try {
    for (const id of fs.readdirSync(WS_DIR)) {
      let folder = null
      try { folder = decodeURIComponent(String(JSON.parse(fs.readFileSync(path.join(WS_DIR, id, 'workspace.json'), 'utf8')).folder || '').replace(/^file:\/\//, '')) || null } catch {}
      if (folder) folders[id] = folder
      const wdb = path.join(WS_DIR, id, 'state.vscdb')
      if (!fs.existsSync(wdb)) continue
      try {
        const r = spawnSync('sqlite3', ['-json', `file:${wdb}?mode=ro`, `SELECT value FROM ItemTable WHERE key='composer.composerData'`], { timeout: 10_000, maxBuffer: 32 * 1024 * 1024 })
        const rows = r.status === 0 && r.stdout.toString().trim() ? JSON.parse(r.stdout.toString()) : []
        for (const c of JSON.parse(rows[0]?.value || '{}').allComposers || [])
          byComposer[c.composerId] = { workspaceId: id, folder, linesAdded: c.totalLinesAdded || 0, linesRemoved: c.totalLinesRemoved || 0 }
      } catch {}
    }
  } catch {}
  return { byComposer, folders }
}

// snapshot cached by DB mtime with a 60s TTL floor — a running Cursor touches the DB
// constantly, so mtime alone would rebuild (≈6s) on every request.
let snapCache = null // {mtime, at, data}
let snapBuilds = 0
function snapshot() {
  const mtime = fs.statSync(DB).mtimeMs
  if (snapCache && (snapCache.mtime === mtime || Date.now() - snapCache.at < 60_000)) return snapCache.data
  snapBuilds++
  const { byComposer, folders } = workspaceComposers()
  const counts = {}
  for (const r of sq(`SELECT substr(key,10,36) id, count(*) n FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' GROUP BY 1`)) counts[r.id] = r.n
  const sessions = sq(`SELECT substr(key,14) id, json_extract(value,'$.name') name, json_extract(value,'$.createdAt') c, json_extract(value,'$.lastUpdatedAt') u, json_extract(value,'$.isArchived') a, json_extract(value,'$.workspaceIdentifier') wsid, json_extract(value,'$.modelConfig.modelName') model FROM cursorDiskKV WHERE key LIKE 'composerData:%'`, 64 * 1024 * 1024)
    .map(h => {
      // newer sessions carry the workspace inline; older ones only appear in a workspace DB's allComposers
      let folder = byComposer[h.id]?.folder || null, workspaceId = byComposer[h.id]?.workspaceId || null
      try {
        const w = JSON.parse(h.wsid || 'null')
        const fs2 = w?.uri?.fsPath || w?.configPath?.fsPath
        if (fs2) { folder = fs2.replace(/\.code-workspace$/, ''); workspaceId = w.id || workspaceId }
      } catch {}
      return {
        id: h.id, workspaceId, folder, name: h.name || null, createdAt: h.c, lastUpdatedAt: h.u, archived: !!h.a,
        model: h.model || null,
        linesAdded: byComposer[h.id]?.linesAdded || 0, linesRemoved: byComposer[h.id]?.linesRemoved || 0,
        subagent: false, messages: counts[h.id] || 0,
      }
    }).sort((x, y) => (y.lastUpdatedAt || 0) - (x.lastUpdatedAt || 0))
  const data = { sessions, workspaces: folders }
  snapCache = { mtime, at: Date.now(), data }
  return data
}

// insights need user-bubble texts — a real blob scan over the 2GB DB. Own mtime cache;
// first request is slow (tens of seconds), later ones are instant.
let insCache = null
function insights() {
  const mtime = fs.statSync(DB).mtimeMs
  if (insCache?.mtime === mtime) return insCache.data
  const rows = sq(`SELECT substr(key,10,36) id, trim(json_extract(value,'$.text')) t FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' AND json_extract(value,'$.type')=1 AND length(json_extract(value,'$.text')) BETWEEN 8 AND 500`, 128 * 1024 * 1024)
  const groups = {}
  for (const r of rows) {
    const k = r.t.toLowerCase().replace(/\s+/g, ' ')
    ;(groups[k] ||= { text: r.t, count: 0, sessions: new Set() }).count++
    groups[k].sessions.add(r.id)
  }
  const dupes = Object.values(groups).filter(g => g.count > 1)
    .map(g => ({ text: g.text, count: g.count, sessions: g.sessions.size }))
    .sort((a, b) => b.count - a.count).slice(0, 50)
  const data = { userPrompts: rows.length, dupes }
  insCache = { mtime, data }
  return data
}

// ---- Harness: Cursor's config is plain files (unlike chats, which live in the DB) ----
// Reads a workspace's .cursor/{rules,commands,skills,hooks.json,mcp.json} + root AGENTS.md/
// .cursorrules, plus the always-loaded global ~/.cursor/mcp.json. Everything fails soft.
const est = s => Math.round((s || '').length / 4) // ~4 chars/token, good enough for a cost hint
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const mcpNames = f => { const j = readJson(f); return j?.mcpServers ? Object.entries(j.mcpServers).map(([name, v]) => ({ name, transport: v.url ? 'http' : 'stdio', target: v.url || v.command || '' })) : [] }

function parseMdc(f) {
  let raw = ''; try { raw = fs.readFileSync(f, 'utf8') } catch { return null }
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const fm = {}, body = m ? m[2] : raw
  if (m) for (const line of m[1].split('\n')) { const kv = line.match(/^(\w+):\s*(.*)$/); if (kv) fm[kv[1]] = kv[2].trim() }
  const always = /^true$/i.test(fm.alwaysApply || '')
  return {
    name: path.basename(f, '.mdc'), description: fm.description || '', globs: fm.globs || '',
    alwaysApply: always, scope: always ? 'always' : fm.globs ? 'glob' : 'agent-requested',
    tokens: est(body),
  }
}

function harness(folder) {
  const dot = path.join(folder, '.cursor')
  const rulesDir = path.join(dot, 'rules'), cmdDir = path.join(dot, 'commands'), skillsDir = path.join(dot, 'skills')
  const ls = d => { try { return fs.readdirSync(d) } catch { return [] } }
  const rules = ls(rulesDir).filter(f => f.endsWith('.mdc')).map(f => parseMdc(path.join(rulesDir, f))).filter(Boolean)
  const commands = ls(cmdDir).filter(f => f.endsWith('.md')).map(f => {
    let first = ''; try { first = (fs.readFileSync(path.join(cmdDir, f), 'utf8').split('\n').find(l => l.trim()) || '').replace(/^#+\s*/, '') } catch {}
    return { name: path.basename(f, '.md'), description: first.slice(0, 120) }
  })
  const skills = ls(skillsDir).filter(f => { try { return fs.statSync(path.join(skillsDir, f)).isDirectory() } catch { return false } })

  const agentsMd = path.join(folder, 'AGENTS.md'), cursorRulesLegacy = path.join(folder, '.cursorrules')
  const agents = fs.existsSync(agentsMd) ? { file: 'AGENTS.md', tokens: est(fs.readFileSync(agentsMd, 'utf8')) } : null
  const legacy = fs.existsSync(cursorRulesLegacy) ? { file: '.cursorrules', tokens: est(fs.readFileSync(cursorRulesLegacy, 'utf8')) } : null

  const mcpProject = mcpNames(path.join(dot, 'mcp.json'))
  const mcpGlobal = mcpNames(path.join(HOME, '.cursor', 'mcp.json'))
  const hooks = readJson(path.join(dot, 'hooks.json'))

  // always-loaded context = alwaysApply rules + AGENTS.md + legacy .cursorrules (glob rules load only on match)
  const alwaysRules = rules.filter(r => r.alwaysApply)
  const alwaysTokens = alwaysRules.reduce((s, r) => s + r.tokens, 0) + (agents?.tokens || 0) + (legacy?.tokens || 0)

  return {
    folder, rules, commands, skills, hooks: hooks ? Object.keys(hooks) : [],
    agents, legacy, mcp: { project: mcpProject, global: mcpGlobal },
    context: { alwaysRules: alwaysRules.map(r => r.name), agents: !!agents, legacy: !!legacy, tokens: alwaysTokens },
  }
}

// ---- Capabilities: global skills / agents + per-project rules / commands, with CRUD ----
const CURSOR_HOME = path.join(HOME, '.cursor')
const BAK = path.join(HOME, '.claude', 'dashboard-backups') // same backup dir as the Claude side — one place to look
function backup(p) { try { if (fs.existsSync(p)) { fs.mkdirSync(BAK, { recursive: true }); fs.copyFileSync(p, path.join(BAK, Date.now().toString(36) + '-' + path.basename(p))) } } catch {} }
function knownFolders() { try { return [...new Set(Object.values(snapshot().workspaces))].filter(f => fs.existsSync(f)) } catch { return [] } }
// writes allowed only inside ~/.cursor/** or a known workspace's .cursor/** / AGENTS.md / .cursorrules
function writable(p) {
  const r = path.resolve(p)
  if (r.startsWith(CURSOR_HOME + path.sep)) return true
  return knownFolders().some(f => r === path.join(f, 'AGENTS.md') || r === path.join(f, '.cursorrules') || r.startsWith(path.join(f, '.cursor') + path.sep))
}
function frontDesc(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---/)
  const d = m && m[1].match(/^description:\s*(.*)$/m)
  return d ? d[1].trim().replace(/^['"]|['"]$/g, '') : ''
}
const KINDS = ['skills', 'agents', 'rules', 'commands']
function listResources(kind) {
  const items = [], ls = d => { try { return fs.readdirSync(d) } catch { return [] } }
  const read = p => { try { return fs.readFileSync(p, 'utf8') } catch { return null } }
  if (kind === 'skills') {
    for (const root of ['skills', 'skills-cursor']) for (const name of ls(path.join(CURSOR_HOME, root))) {
      const p = path.join(CURSOR_HOME, root, name, 'SKILL.md'), raw = read(p)
      if (raw != null) items.push({ name, scope: root === 'skills' ? 'user' : 'built-in', path: p, description: frontDesc(raw), tokensAlways: est(frontDesc(raw)), tokensOnInvoke: est(raw) })
    }
  } else if (kind === 'agents') {
    for (const f of ls(path.join(CURSOR_HOME, 'agents')).filter(f => f.endsWith('.md'))) {
      const p = path.join(CURSOR_HOME, 'agents', f), raw = read(p)
      if (raw != null) items.push({ name: f.replace(/\.md$/, ''), scope: 'user', path: p, description: frontDesc(raw), tokensAlways: est(frontDesc(raw)), tokensOnInvoke: est(raw) })
    }
  } else if (kind === 'rules') {
    for (const folder of knownFolders()) for (const f of ls(path.join(folder, '.cursor', 'rules')).filter(f => f.endsWith('.mdc'))) {
      const p = path.join(folder, '.cursor', 'rules', f), meta = parseMdc(p)
      if (meta) items.push({ ...meta, scope: 'project', folder, path: p, tokensAlways: meta.alwaysApply ? meta.tokens : est(meta.description), tokensOnInvoke: meta.tokens })
    }
  } else if (kind === 'commands') {
    const roots = [[path.join(CURSOR_HOME, 'commands'), 'user', null], ...knownFolders().map(f => [path.join(f, '.cursor', 'commands'), 'project', f])]
    for (const [dir, scope, folder] of roots) for (const f of ls(dir).filter(f => f.endsWith('.md'))) {
      const p = path.join(dir, f), raw = read(p)
      if (raw != null) items.push({ name: f.replace(/\.md$/, ''), scope, folder, path: p, description: (raw.split('\n').find(l => l.trim()) || '').replace(/^#+\s*/, '').slice(0, 120), tokensAlways: 0, tokensOnInvoke: est(raw) })
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name))
}

// ---- MCP config: global ~/.cursor/mcp.json + per-project .cursor/mcp.json ----
function mcpFiles() {
  const out = [[path.join(CURSOR_HOME, 'mcp.json'), 'user']]
  for (const f of knownFolders()) { const p = path.join(f, '.cursor', 'mcp.json'); if (fs.existsSync(p)) out.push([p, f]) }
  return out
}
function editMcp(scope, fn) {
  const file = scope === 'user' ? path.join(CURSOR_HOME, 'mcp.json') : path.join(scope, '.cursor', 'mcp.json')
  if (!writable(file)) throw new Error('scope not allowed')
  const j = readJson(file) || { mcpServers: {} }
  j.mcpServers ||= {}
  fn(j.mcpServers)
  backup(file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(j, null, 2))
}

const UUID = /^[0-9a-f-]{36}$/i

export default function mountCursor(app, { testMcp } = {}) {
  const guard = handler => (req, res) => {
    if (!fs.existsSync(DB)) return res.json({ available: false })
    Promise.resolve().then(() => handler(req, res)).catch(e => { try { res.status(500).json({ error: e.message }) } catch {} })
  }

  app.get('/api/cursor/overview', guard((req, res) => {
    const { sessions, workspaces: ws } = snapshot()
    const real = sessions.filter(s => !s.subagent)
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0))
    const perDay = {}
    for (const s of real) {
      if (!s.lastUpdatedAt) continue
      const d = new Date(s.lastUpdatedAt)
      heat[d.getDay()][d.getHours()]++
      const day = d.toISOString().slice(0, 10)
      perDay[day] = (perDay[day] || 0) + 1
    }
    res.json({
      available: true,
      sessions: real.length, subagents: sessions.length - real.length,
      messages: sessions.reduce((s, x) => s + x.messages, 0),
      workspaces: Object.keys(ws).length,
      activeDays: Object.keys(perDay).length,
      first: Math.min(...real.map(s => s.createdAt || Infinity)),
      last: Math.max(...real.map(s => s.lastUpdatedAt || 0)),
      heat, perDay,
    })
  }))

  app.get('/api/cursor/projects', guard((req, res) => {
    const { sessions } = snapshot()
    const byWs = {}
    for (const s of sessions.filter(s => !s.subagent)) {
      const key = s.folder || s.workspaceId || 'unknown'
      const p = (byWs[key] ||= { folder: s.folder, workspaceId: s.workspaceId, sessions: 0, messages: 0, linesAdded: 0, linesRemoved: 0, last: 0 })
      p.sessions++; p.messages += s.messages; p.linesAdded += s.linesAdded; p.linesRemoved += s.linesRemoved; p.last = Math.max(p.last, s.lastUpdatedAt || 0)
    }
    res.json(Object.values(byWs).sort((a, b) => b.last - a.last))
  }))

  app.get('/api/cursor/sessions', guard((req, res) => {
    let { sessions } = snapshot()
    if (req.query.workspace) sessions = sessions.filter(s => s.workspaceId === req.query.workspace || s.folder === req.query.workspace)
    res.json(sessions.filter(s => !s.subagent).slice(0, 500))
  }))

  app.get('/api/cursor/session/:id', guard((req, res) => {
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'bad id' })
    const id = req.params.id
    const [meta] = sq(`SELECT json_extract(value,'$.name') name, json_extract(value,'$.createdAt') createdAt, json_extract(value,'$.lastUpdatedAt') lastUpdatedAt, json_extract(value,'$.modelConfig.modelName') model, json_extract(value,'$.isAgentic') agentic, json_extract(value,'$.totalLinesAdded') la, json_extract(value,'$.totalLinesRemoved') lr, json_extract(value,'$.contextTokensUsed') ctxTokens, json_extract(value,'$.contextTokenLimit') ctxLimit, json_extract(value,'$.codeBlockData') codeBlocks, json_extract(value,'$.fullConversationHeadersOnly') headers FROM cursorDiskKV WHERE key = 'composerData:${id}'`, 64 * 1024 * 1024)
    const order = (() => { try { return JSON.parse(meta?.headers || '[]').map(h => h.bubbleId) } catch { return [] } })()
    const bubbles = {}
    // analysis fields (cursorRules = rules/skills that actually applied; toolFormerData = a tool call)
    let userMsgs = 0, asstMsgs = 0, toolCalls = 0, userChars = 0
    const rulesApplied = new Set(), tools = new Set()
    for (const b of sq(`SELECT substr(key,47) bid, json_extract(value,'$.type') type, json_extract(value,'$.text') text, json_extract(value,'$.cursorRules') rules, json_extract(value,'$.toolFormerData.tool') tool FROM cursorDiskKV WHERE key LIKE 'bubbleId:${id}:%'`, 96 * 1024 * 1024)) {
      bubbles[b.bid] = { type: b.type, text: b.text || '' }
      if (b.type === 1) { userMsgs++; userChars += (b.text || '').length } else if (b.type === 2) asstMsgs++
      if (b.tool != null) { toolCalls++; tools.add(b.tool) }
      try { for (const r of JSON.parse(b.rules || '[]')) if (r?.name) rulesApplied.add(path.basename(r.name).replace(/\.(mdc|md)$/, '')) } catch {}
    }
    const known = new Set(order)
    const messages = [...order.map(bid => bubbles[bid]).filter(Boolean), ...Object.entries(bubbles).filter(([bid]) => !known.has(bid)).map(([, b]) => b)]
    const files = (() => { try { return Object.keys(JSON.parse(meta?.codeBlocks || '{}')).map(u => u.replace(/^file:\/\//, '')) } catch { return [] } })()
    const analysis = {
      model: meta?.model || null, agentic: !!meta?.agentic,
      userMsgs, asstMsgs, toolCalls, distinctTools: tools.size, userChars,
      linesAdded: meta?.la || 0, linesRemoved: meta?.lr || 0,
      contextTokens: meta?.ctxTokens || 0, contextLimit: meta?.ctxLimit || 0,
      durationMs: meta?.lastUpdatedAt && meta?.createdAt ? meta.lastUpdatedAt - meta.createdAt : 0,
      files, rulesApplied: [...rulesApplied],
    }
    res.json({ id, name: meta?.name || null, createdAt: meta?.createdAt || null, analysis, messages: messages.filter(m => m.text) })
  }))

  // Per-project analysis — all aggregated from the snapshot (zero extra queries).
  app.get('/api/cursor/project', guard((req, res) => {
    const ws = req.query.workspace
    if (!ws) return res.status(400).json({ error: 'workspace required' })
    const { sessions } = snapshot()
    const mine = sessions.filter(s => !s.subagent && (s.workspaceId === ws || s.folder === ws))
    if (!mine.length) return res.json({ available: true, sessions: 0 })
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0))
    const perDay = {}, models = {}
    let messages = 0, linesAdded = 0, linesRemoved = 0
    for (const s of mine) {
      messages += s.messages; linesAdded += s.linesAdded; linesRemoved += s.linesRemoved
      if (s.model) models[s.model] = (models[s.model] || 0) + 1
      if (s.lastUpdatedAt) { const d = new Date(s.lastUpdatedAt); heat[d.getDay()][d.getHours()]++; perDay[d.toISOString().slice(0, 10)] = 1 }
    }
    res.json({
      available: true, folder: mine.find(s => s.folder)?.folder || null,
      sessions: mine.length, messages, linesAdded, linesRemoved,
      activeDays: Object.keys(perDay).length,
      avgMessages: Math.round(messages / mine.length),
      first: Math.min(...mine.map(s => s.createdAt || Infinity)), last: Math.max(...mine.map(s => s.lastUpdatedAt || 0)),
      models: Object.entries(models).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
      heat,
      topSessions: [...mine].sort((a, b) => (b.linesAdded + b.linesRemoved) - (a.linesAdded + a.linesRemoved)).slice(0, 8)
        .map(s => ({ id: s.id, name: s.name, messages: s.messages, linesAdded: s.linesAdded, linesRemoved: s.linesRemoved, model: s.model })),
    })
  }))

  // Per-project harness — static config from files under the workspace folder.
  app.get('/api/cursor/harness', guard((req, res) => {
    const folder = req.query.workspace
    if (!folder || !folder.startsWith('/')) return res.status(400).json({ error: 'workspace folder required' })
    if (!fs.existsSync(folder)) return res.json({ available: false, folder })
    res.json({ available: true, ...harness(folder) })
  }))

  app.get('/api/cursor/insights', guard((req, res) => res.json(insights())))
  app.get('/api/cursor/debug', (req, res) => res.json({ pid: process.pid, snapBuilds, cacheAt: snapCache?.at || null }))

  // ---- capabilities CRUD (skills / agents / rules / commands) ----
  app.get('/api/cursor/res/:kind', guard((req, res) => {
    if (!KINDS.includes(req.params.kind)) return res.status(400).json({ error: 'bad kind' })
    res.json(listResources(req.params.kind))
  }))
  app.get('/api/cursor/res-item', guard((req, res) => {
    const p = String(req.query.path || '')
    if (!writable(p)) return res.status(403).json({ error: 'path not allowed' })
    res.json({ path: p, content: fs.readFileSync(p, 'utf8') })
  }))
  app.put('/api/cursor/res-item', guard((req, res) => {
    const { path: p, content } = req.body
    if (!writable(p || '')) return res.status(403).json({ error: 'path not allowed' })
    backup(p)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, String(content ?? ''))
    res.json({ ok: true })
  }))
  app.post('/api/cursor/res/:kind', guard((req, res) => {
    const kind = req.params.kind
    const name = String(req.body.name || '').replace(/[^\w.-]/g, '-')
    if (!KINDS.includes(kind) || !name) return res.status(400).json({ error: 'bad kind or name' })
    const folder = req.body.folder // required for project-scoped kinds
    const p = kind === 'skills' ? path.join(CURSOR_HOME, 'skills', name, 'SKILL.md')
      : kind === 'agents' ? path.join(CURSOR_HOME, 'agents', name + '.md')
      : kind === 'rules' ? path.join(String(folder || ''), '.cursor', 'rules', name + '.mdc')
      : folder ? path.join(folder, '.cursor', 'commands', name + '.md') : path.join(CURSOR_HOME, 'commands', name + '.md')
    if (!writable(p)) return res.status(403).json({ error: 'path not allowed (rules/commands need a known project folder)' })
    if (fs.existsSync(p)) return res.status(409).json({ error: 'already exists' })
    const tpl = req.body.content || (kind === 'rules'
      ? `---\ndescription: ${req.body.description || ''}\nglobs:\nalwaysApply: false\n---\n\n`
      : `---\nname: ${name}\ndescription: ${req.body.description || ''}\n---\n\n`)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, tpl)
    res.json({ ok: true, path: p })
  }))
  app.delete('/api/cursor/res-item', guard((req, res) => {
    const p = String(req.query.path || '')
    if (!writable(p)) return res.status(403).json({ error: 'path not allowed' })
    backup(p)
    fs.rmSync(p)
    if (path.basename(p) === 'SKILL.md') { try { fs.rmSync(path.dirname(p), { recursive: true }) } catch {} } // remove the skill dir shell
    res.json({ ok: true })
  }))

  // ---- loaded-context accounting: what Cursor pays every session vs on invoke ----
  app.get('/api/cursor/context', guard((req, res) => {
    const always = [], onInvoke = []
    for (const kind of KINDS) for (const r of listResources(kind)) {
      if (req.query.workspace && r.folder && r.folder !== req.query.workspace) continue
      if (r.tokensAlways) always.push({ kind, name: r.name, tokens: r.tokensAlways, why: r.alwaysApply ? 'alwaysApply rule' : 'description in context' })
      if (r.tokensOnInvoke) onInvoke.push({ kind, name: r.name, tokens: r.tokensOnInvoke })
    }
    if (req.query.workspace) {
      const h = harness(String(req.query.workspace))
      if (h.agents) always.push({ kind: 'root', name: 'AGENTS.md', tokens: h.agents.tokens, why: 'always loaded' })
      if (h.legacy) always.push({ kind: 'root', name: '.cursorrules', tokens: h.legacy.tokens, why: 'always loaded (legacy)' })
    }
    always.sort((a, b) => b.tokens - a.tokens); onInvoke.sort((a, b) => b.tokens - a.tokens)
    res.json({ always, onInvoke, totals: { always: always.reduce((s, x) => s + x.tokens, 0), onInvoke: onInvoke.reduce((s, x) => s + x.tokens, 0) } })
  }))

  // ---- MCP servers: list / edit / create / delete / live test ----
  app.get('/api/cursor/mcp', guard((req, res) => {
    const out = []
    for (const [file, scope] of mcpFiles())
      for (const [name, config] of Object.entries(readJson(file)?.mcpServers || {})) out.push({ name, scope, config })
    res.json(out)
  }))
  app.put('/api/cursor/mcp/:name', guard((req, res) => {
    editMcp(req.body.scope || 'user', s => { s[req.params.name] = req.body.config })
    res.json({ ok: true })
  }))
  app.post('/api/cursor/mcp', guard((req, res) => {
    const { name, scope, config } = req.body
    if (!name) return res.status(400).json({ error: 'name required' })
    editMcp(scope || 'user', s => { if (s[name]) throw new Error('already exists'); s[name] = config || {} })
    res.json({ ok: true })
  }))
  app.delete('/api/cursor/mcp/:name', guard((req, res) => {
    editMcp(req.query.scope || 'user', s => { delete s[req.params.name] })
    res.json({ ok: true })
  }))
  app.post('/api/cursor/mcp/:name/test', guard(async (req, res) => {
    if (!testMcp) return res.status(501).json({ error: 'tester unavailable' })
    res.json(await testMcp(req.body.config || {}))
  }))
}
