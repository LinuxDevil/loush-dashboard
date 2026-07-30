import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { toggleOffFile } from '../lib/customize-toggle.mjs'
import { CLAUDE, CLAUDE_JSON, PROJECT, WIN, safe, backup, parseFM, readClaudeJson, tokens, track, propose } from './dashboard-core.mjs'

const KINDS = {
  skills: {
    dirs: () => [{ scope: 'user', dir: path.join(CLAUDE, 'skills') }, { scope: 'project', dir: path.join(PROJECT, '.claude', 'skills') }],
    nested: true,
    template: n => `---\nname: ${n}\ndescription: ""\n---\n\n# /${n}\n\nInstructions for this skill.\n`,
  },
  commands: {
    dirs: () => [{ scope: 'user', dir: path.join(CLAUDE, 'commands') }, { scope: 'project', dir: path.join(PROJECT, '.claude', 'commands') }],
    nested: false,
    template: n => `---\ndescription: \nargument-hint: <args>\n---\n\nPrompt body.\n\n$ARGUMENTS\n`,
  },
  agents: {
    dirs: () => [{ scope: 'user', dir: path.join(CLAUDE, 'agents') }, { scope: 'project', dir: path.join(PROJECT, '.claude', 'agents') }],
    nested: false,
    template: n => `---\nname: ${n}\ndescription: \ntools: Read, Grep, Glob\n---\n\nSystem prompt for this agent.\n`,
  },
}

const OFF = '.off'

const flatName = name => name.split(':')

function walkFlatKind(dir) {
  const out = []
  const walk = (d, prefix) => {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walk(p, prefix ? `${prefix}:${e.name}` : e.name); continue }
      let base, enabled
      if (e.name.endsWith('.md' + OFF)) { base = e.name.slice(0, -(3 + OFF.length)); enabled = false }
      else if (e.name.endsWith('.md')) { base = e.name.slice(0, -3); enabled = true }
      else continue
      out.push({ name: prefix ? `${prefix}:${base}` : base, file: p, enabled })
    }
  }
  walk(dir, '')
  return out
}

function listItemNames(kind, dir) {
  if (!fs.existsSync(dir)) return []
  if (KINDS[kind].nested) {
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) } catch { return [] }
  }
  return walkFlatKind(dir).filter(i => i.enabled).map(i => i.name)
}

function itemFile(kind, scopeDir, name) {
  return KINDS[kind].nested ? path.join(scopeDir, name, 'SKILL.md') : path.join(scopeDir, ...flatName(name)) + '.md'
}

function itemRoot(kind, scopeDir, name) {
  return KINDS[kind].nested ? path.join(scopeDir, name) : path.join(scopeDir, ...flatName(name)) + '.md'
}

function scopeDir(kind, scope) {
  const s = KINDS[kind].dirs().find(d => d.scope === scope)
  if (!s) throw Object.assign(new Error('bad scope'), { status: 400 })
  return s.dir
}

const kindGuard = (req, res, next) => (KINDS[req.params.kind] ? next() : res.status(404).json({ error: 'unknown kind' }))

const INIT_MSG = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'claude-dashboard', version: '1.0.0' } } }

async function mcpTest(cfg) {
  const t0 = Date.now()
  try {
    if (cfg.url) {
      const r = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify(INIT_MSG),
        signal: AbortSignal.timeout(8000),
      })
      const body = (await r.text()).slice(0, 300)
      return { ok: r.status < 500, status: r.status, ms: Date.now() - t0, detail: body }
    }
    return await new Promise(resolve => {
      const child = spawn(cfg.command, cfg.args || [], { env: { ...process.env, ...(cfg.env || {}) }, shell: WIN })
      let out = '', err = '', settled = false
      const done = r => { if (settled) return; settled = true; try { child.kill() } catch {}; resolve(r) }
      const timer = setTimeout(() => done({ ok: false, error: 'timeout after 15s', stderr: err.slice(-300) }), 15000)
      child.stdout.on('data', d => {
        out += d
        for (const line of out.split('\n')) {
          try {
            const j = JSON.parse(line)
            if (j.id === 1) { clearTimeout(timer); done({ ok: true, ms: Date.now() - t0, serverInfo: j.result?.serverInfo }) }
          } catch {}
        }
      })
      child.stderr.on('data', d => { err += d })
      child.on('error', e => { clearTimeout(timer); done({ ok: false, error: e.message }) })
      child.on('exit', c => { if (c) { clearTimeout(timer); done({ ok: false, error: `exited with code ${c}`, stderr: err.slice(-300) }) } })
      child.stdin.write(JSON.stringify(INIT_MSG) + '\n')
    })
  } catch (e) {
    return { ok: false, error: e.message, ms: Date.now() - t0 }
  }
}

const SETTINGS_FILES = {
  user: path.join(CLAUDE, 'settings.json'),
  project: path.join(PROJECT, '.claude', 'settings.json'),
  local: path.join(PROJECT, '.claude', 'settings.local.json'),
}

function customizeRes(kind) {
  const out = []
  const add = (scope, name, enabled, file) => {
    const content = fs.readFileSync(file, 'utf8')
    const { fm } = parseFM(content)
    out.push({ kind, name, scope, group: scope, enabled, description: String(fm.description || ''), tokens: tokens(content), path: file, status: enabled ? 'on' : 'off' })
  }
  for (const { scope, dir } of KINDS[kind].dirs()) {
    if (!fs.existsSync(dir)) continue
    if (KINDS[kind].nested) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        const live = path.join(dir, e.name, 'SKILL.md')
        if (fs.existsSync(live)) add(scope, e.name, true, live)
        else if (fs.existsSync(live + OFF)) add(scope, e.name, false, live + OFF)
      }
    } else {
      for (const { name, file, enabled } of walkFlatKind(dir)) add(scope, name, enabled, file)
    }
  }
  return out
}

const RULE_TARGETS = () => [
  { name: '~/.claude/CLAUDE.md', scope: 'global', base: path.join(CLAUDE, 'CLAUDE.md') },
  { name: '.claude/CLAUDE.md', scope: 'project', base: path.join(PROJECT, '.claude', 'CLAUDE.md') },
  { name: 'CLAUDE.md', scope: 'project', base: path.join(PROJECT, 'CLAUDE.md') },
  { name: 'AGENTS.md', scope: 'project', base: path.join(PROJECT, 'AGENTS.md') },
  { name: '.cursorrules', scope: 'project', base: path.join(PROJECT, '.cursorrules') },
]

function customizeRules() {
  const out = []
  for (const r of RULE_TARGETS()) {
    const on = fs.existsSync(r.base), off = fs.existsSync(r.base + OFF)
    if (!on && !off) continue
    const file = on ? r.base : r.base + OFF
    out.push({ kind: 'rules', name: r.name, scope: r.scope, group: r.scope, enabled: on, description: `always-on rules · ${tokens(fs.readFileSync(file, 'utf8'))} tokens`, tokens: tokens(fs.readFileSync(file, 'utf8')), path: file, status: on ? 'always' : 'off' })
  }
  return out
}

function customizeMcp() {
  const cj = readClaudeJson(), out = []
  for (const [name, config] of Object.entries(cj.mcpServers || {}))
    out.push({ kind: 'mcp', name, scope: 'user', group: 'mcp', enabled: true, description: (config.url || config.command || '') + '', tokens: tokens(JSON.stringify(config)), status: 'connected' })
  for (const [name, config] of Object.entries(cj._disabledMcpServers || {}))
    out.push({ kind: 'mcp', name, scope: 'user', group: 'mcp', enabled: false, description: (config.url || config.command || '') + '', tokens: tokens(JSON.stringify(config)), status: 'off' })
  return out
}

function customizePlugins() {
  let settings = {}; try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILES.user, 'utf8')) } catch {}
  return Object.entries(settings.enabledPlugins || {}).map(([full, on]) => ({
    kind: 'plugins', name: full.split('@')[0], scope: 'user', group: 'plugins', enabled: !!on, description: full.includes('@') ? full.split('@')[1] : '', tokens: 0, status: on ? 'enabled' : 'off', ref: full,
  }))
}

const hookKey = (event, entry) => `${event}::${entry.matcher || '*'}::${JSON.stringify(entry.hooks || [])}`

function customizeHooks() {
  let settings = {}; try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILES.user, 'utf8')) } catch {}
  const out = []
  const emit = (bag, enabled) => { for (const [event, entries] of Object.entries(bag || {})) for (const entry of entries || []) {
    const cmds = (entry.hooks || []).map(h => h.command || h.type).join(', ')
    out.push({ kind: 'hooks', name: `${event} · ${entry.matcher || '*'}`, scope: 'user', group: event, enabled, description: cmds.slice(0, 120), tokens: 0, status: enabled ? 'active' : 'off', ref: hookKey(event, entry) })
  } }
  emit(settings.hooks, true); emit(settings._disabledHooks, false)
  return out
}

function customizeAll() {
  return {
    skills: customizeRes('skills'), commands: customizeRes('commands'), agents: customizeRes('agents'),
    rules: customizeRules(), mcp: customizeMcp(), hooks: customizeHooks(), plugins: customizePlugins(),
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'plugins', 'dashboard-backups', 'statsig', '__pycache__', 'shell-snapshots', 'file-history', 'paste-cache', 'telemetry', 'todos'])

const SKIP_EXTS = new Set(['db', 'db-shm', 'db-wal', 'sqlite', 'sqlite3', 'lock', 'lockb', 'pyc'])

const MIME = { html: 'text/html', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', json: 'application/json', pdf: 'application/pdf' }

export default function mountInventory(app) {
app.get('/api/res/:kind', kindGuard, (req, res) => {
  const kind = req.params.kind, out = []
  for (const { scope, dir } of KINDS[kind].dirs()) {
    for (const name of listItemNames(kind, dir)) {
      const file = itemFile(kind, dir, name)
      if (!fs.existsSync(file)) continue
      const st = fs.statSync(file)
      const { fm } = parseFM(fs.readFileSync(file, 'utf8'))
      out.push({ name, scope, path: file, mtime: st.mtimeMs, description: fm.description || '' })
    }
  }
  res.json(out)
})

app.get('/api/res/:kind/item', kindGuard, (req, res) => {
  const { kind } = req.params, { scope, name } = req.query
  const file = safe(itemFile(kind, scopeDir(kind, scope), name))
  const content = fs.readFileSync(file, 'utf8')
  const { fm, body } = parseFM(content)
  let assets = []
  if (KINDS[kind].nested) {
    const root = path.dirname(file)
    const walkA = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walkA(p)
      else if (e.name !== 'SKILL.md') assets.push(path.relative(root, p))
    })
    walkA(root)
  }
  res.json({ path: file, content, fm, body, assets, mtime: fs.statSync(file).mtimeMs })
})

app.put('/api/res/:kind/item', kindGuard, (req, res) => {
  const { kind } = req.params, { scope, name } = req.query
  const file = safe(itemFile(kind, scopeDir(kind, scope), name))
  const bak = backup(file)
  fs.writeFileSync(file, req.body.content)
  res.json({ ok: true, backup: bak })
})

app.post('/api/res/:kind', kindGuard, (req, res) => {
  const { kind } = req.params, { scope = 'user', name } = req.body
  if (!/^[\w.-]+(:[\w.-]+)*$/.test(name || '') || name.includes('..')) return res.status(400).json({ error: 'invalid name' })
  const file = safe(itemFile(kind, scopeDir(kind, scope), name))
  if (fs.existsSync(file)) return res.status(409).json({ error: 'already exists' })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, req.body.content || KINDS[kind].template(name))
  res.json({ ok: true, path: file })
})

app.delete('/api/res/:kind/item', kindGuard, (req, res) => {
  const { kind } = req.params, { scope, name } = req.query
  const root = safe(itemRoot(kind, scopeDir(kind, scope), name))
  const bak = backup(root)
  fs.rmSync(root, { recursive: true })
  res.json({ ok: true, backup: bak })
})

// ---------- MCP servers ----------

app.get('/api/mcp', (req, res) => {
  const cj = readClaudeJson(), out = []
  for (const [name, config] of Object.entries(cj.mcpServers || {})) out.push({ name, scope: 'user', config })
  for (const [proj, pcfg] of Object.entries(cj.projects || {}))
    for (const [name, config] of Object.entries(pcfg.mcpServers || {})) out.push({ name, scope: 'project', project: proj, config })
  res.json(out)
})

app.put('/api/mcp/:name', (req, res) => {
  const cj = readClaudeJson(), { project, config } = req.body
  const target = project ? cj.projects?.[project]?.mcpServers : cj.mcpServers
  if (!target) return res.status(404).json({ error: 'scope not found' })
  const bak = backup(CLAUDE_JSON)
  target[req.params.name] = config
  fs.writeFileSync(CLAUDE_JSON, JSON.stringify(cj, null, 2))
  res.json({ ok: true, backup: bak })
})

app.post('/api/mcp', (req, res) => {
  const cj = readClaudeJson(), { name, config } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  cj.mcpServers = cj.mcpServers || {}
  if (cj.mcpServers[name]) return res.status(409).json({ error: 'already exists' })
  const bak = backup(CLAUDE_JSON)
  cj.mcpServers[name] = config
  fs.writeFileSync(CLAUDE_JSON, JSON.stringify(cj, null, 2))
  res.json({ ok: true, backup: bak })
})

app.delete('/api/mcp/:name', (req, res) => {
  const cj = readClaudeJson(), { project } = req.query
  const target = project ? cj.projects?.[project]?.mcpServers : cj.mcpServers
  if (!target?.[req.params.name]) return res.status(404).json({ error: 'not found' })
  const bak = backup(CLAUDE_JSON)
  delete target[req.params.name]
  fs.writeFileSync(CLAUDE_JSON, JSON.stringify(cj, null, 2))
  res.json({ ok: true, backup: bak })
})

app.post('/api/mcp/:name/test', async (req, res) => res.json(await mcpTest(req.body.config)))

// ---------- hooks + settings ----------

app.get('/api/hooks', (req, res) => {
  const out = {}
  for (const [scope, file] of Object.entries(SETTINGS_FILES))
    out[scope] = fs.existsSync(file) ? { path: file, settings: JSON.parse(fs.readFileSync(file, 'utf8')) } : { path: file, settings: null }
  res.json(out)
})

app.put('/api/hooks', (req, res) => {
  const { scope, hooks } = req.body
  const file = SETTINGS_FILES[scope]
  if (!file) return res.status(400).json({ error: 'bad scope' })
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  const bak = backup(file)
  if (hooks === null) delete settings.hooks
  else settings.hooks = hooks
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(settings, null, 2))
  res.json({ ok: true, backup: bak })
})

app.put('/api/settings', (req, res) => {
  const { scope, settings } = req.body
  const file = SETTINGS_FILES[scope]
  if (!file) return res.status(400).json({ error: 'bad scope' })
  if (settings == null || typeof settings !== 'object') return res.status(400).json({ error: 'settings must be an object' })
  const content = JSON.stringify(settings, null, 2)
  if (scope === 'user' || scope === 'global')
    return res.json({ ok: true, proposed: propose(file, content, 'edit settings.json (api/settings)'), superseded: 'PUT /api/harness/raw' })
  track(file, content, { scope, summary: 'edit settings.json (api/settings)' })
  res.json({ ok: true, superseded: 'PUT /api/harness/raw' })
})

// ---------- Customize: one unified inventory + REAL enable/disable across every category ----------

app.get('/api/customize', (req, res) => { try { res.json(customizeAll()) } catch (e) { res.status(500).json({ error: e.message }) } })

app.post('/api/customize/toggle', (req, res) => {
  try {
    const { kind, scope, name, enable, ref } = req.body
    if (kind === 'skills' || kind === 'commands' || kind === 'agents') {
      const live = safe(itemFile(kind, scopeDir(kind, scope), name))
      return res.json(toggleOffFile(live, enable))
    }
    if (kind === 'rules') {
      const t = RULE_TARGETS().find(r => r.name === name && r.scope === scope)
      if (!t) return res.status(404).json({ error: 'unknown rules file' })
      return res.json(toggleOffFile(safe(t.base), enable))
    }
    if (kind === 'mcp') {
      const cj = readClaudeJson()
      cj._disabledMcpServers = cj._disabledMcpServers || {}
      const bak = backup(CLAUDE_JSON)
      if (enable) { const c = cj._disabledMcpServers[name]; if (c) { cj.mcpServers = cj.mcpServers || {}; cj.mcpServers[name] = c; delete cj._disabledMcpServers[name] } }
      else { const c = (cj.mcpServers || {})[name]; if (c) { cj._disabledMcpServers[name] = c; delete cj.mcpServers[name] } }
      fs.writeFileSync(CLAUDE_JSON, JSON.stringify(cj, null, 2))
      return res.json({ ok: true, enabled: enable, backup: bak })
    }
    if (kind === 'plugins') {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILES.user, 'utf8'))
      const key = ref && settings.enabledPlugins?.[ref] !== undefined ? ref : Object.keys(settings.enabledPlugins || {}).find(k => k.split('@')[0] === name)
      if (!key) return res.status(404).json({ error: 'plugin not found' })
      const bak = backup(SETTINGS_FILES.user)
      settings.enabledPlugins[key] = !!enable
      fs.writeFileSync(SETTINGS_FILES.user, JSON.stringify(settings, null, 2))
      return res.json({ ok: true, enabled: enable, backup: bak })
    }
    if (kind === 'hooks') {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILES.user, 'utf8'))
      settings.hooks = settings.hooks || {}; settings._disabledHooks = settings._disabledHooks || {}
      const src = enable ? settings._disabledHooks : settings.hooks
      const dst = enable ? settings.hooks : settings._disabledHooks
      let moved = null
      for (const [event, entries] of Object.entries(src)) {
        const idx = (entries || []).findIndex(e => hookKey(event, e) === ref)
        if (idx >= 0) { moved = entries.splice(idx, 1)[0]; if (!entries.length) delete src[event]; (dst[event] = dst[event] || []).push(moved); break }
      }
      if (!moved) return res.json({ ok: true, noop: true, enabled: enable })
      const bak = backup(SETTINGS_FILES.user)
      fs.writeFileSync(SETTINGS_FILES.user, JSON.stringify(settings, null, 2))
      return res.json({ ok: true, enabled: enable, backup: bak })
    }
    res.status(400).json({ error: 'unknown kind' })
  } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

// ---------- artifacts ----------

app.get('/api/artifacts', (req, res) => {
  const out = []
  const walk = (dir, group) => {
    if (out.length > 8000) return // ponytail: hard cap, paginate if ~/.claude ever outgrows it
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, group || e.name) }
      else {
        const ext = path.extname(e.name).slice(1).toLowerCase()
        if (SKIP_EXTS.has(ext)) continue
        const st = fs.statSync(p)
        out.push({ name: e.name, path: p, ext, size: st.size, mtime: st.mtimeMs, group: group || '(root)' })
      }
    }
  }
  walk(CLAUDE, null)
  res.json(out)
})

app.get('/api/artifacts/raw', (req, res) => {
  const p = safe(req.query.path)
  res.type(MIME[path.extname(p).slice(1).toLowerCase()] || 'text/plain')
  fs.createReadStream(p).pipe(res)
})

app.get('/api/artifacts/content', (req, res) => {
  const p = safe(req.query.path)
  const st = fs.statSync(p)
  if (st.size > 2 * 1024 * 1024) return res.status(413).json({ error: `file too large to render (${st.size} bytes) — use download` })
  res.json({ content: fs.readFileSync(p, 'utf8') })
})

app.get('/api/artifacts/download', (req, res) => res.download(safe(req.query.path)))

app.post('/api/artifacts/reveal', (req, res) => {
  const p = safe(req.body.path)
  if (WIN) execFile('explorer', ['/select,', p])
  else if (process.platform === 'darwin') execFile('open', ['-R', p])
  else execFile('xdg-open', [path.dirname(p)])
  res.json({ ok: true })
})

app.post('/api/artifacts/rename', (req, res) => {
  const p = safe(req.body.path)
  if (!/^[^/\\]+$/.test(req.body.newName || '')) return res.status(400).json({ error: 'invalid name' })
  const dest = path.join(path.dirname(p), req.body.newName)
  if (fs.existsSync(dest)) return res.status(409).json({ error: 'target exists' })
  fs.renameSync(p, dest)
  res.json({ ok: true, path: dest })
})

app.delete('/api/artifacts', (req, res) => {
  const p = safe(req.query.path)
  const bak = backup(p)
  fs.rmSync(p)
  res.json({ ok: true, backup: bak })
})
}

export { KINDS, OFF, SETTINGS_FILES, itemFile, itemRoot, listItemNames, scopeDir }
