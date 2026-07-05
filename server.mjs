import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, exec, execFile, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const HOME = os.homedir()
const CLAUDE = path.join(HOME, '.claude')
const CLAUDE_JSON = path.join(HOME, '.claude.json')
const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WIN = process.platform === 'win32'
const BACKUPS = path.join(CLAUDE, 'dashboard-backups')
const PORT = 5178

const app = express()
app.use(express.json({ limit: '10mb' }))

// ---------- safety + backups ----------
const ALLOWED_ROOTS = [CLAUDE, path.join(PROJECT, '.claude'), CLAUDE_JSON]
function safe(p) {
  const r = path.resolve(p)
  if (!ALLOWED_ROOTS.some(root => r === root || r.startsWith(root + path.sep)))
    throw Object.assign(new Error('path outside allowed roots: ' + r), { status: 403 })
  return r
}
function backup(file) {
  if (!fs.existsSync(file)) return null
  fs.mkdirSync(BACKUPS, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(BACKUPS, `${ts}__${file.replaceAll(path.sep, '~')}`)
  fs.cpSync(file, dest, { recursive: true })
  return dest
}
function parseFM(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src)
  if (!m) return { fm: {}, body: src }
  let fm = {}
  try { fm = YAML.parse(m[1]) || {} } catch (e) { fm = { _parse_error: e.message } }
  return { fm, body: src.slice(m[0].length) }
}

// ---------- skills / commands / agents ----------
// skills are dirs containing SKILL.md; commands/agents are flat .md files
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
function itemFile(kind, scopeDir, name) {
  return KINDS[kind].nested ? path.join(scopeDir, name, 'SKILL.md') : path.join(scopeDir, name + '.md')
}
function itemRoot(kind, scopeDir, name) {
  return KINDS[kind].nested ? path.join(scopeDir, name) : path.join(scopeDir, name + '.md')
}
function scopeDir(kind, scope) {
  const s = KINDS[kind].dirs().find(d => d.scope === scope)
  if (!s) throw Object.assign(new Error('bad scope'), { status: 400 })
  return s.dir
}
const kindGuard = (req, res, next) => (KINDS[req.params.kind] ? next() : res.status(404).json({ error: 'unknown kind' }))

app.get('/api/res/:kind', kindGuard, (req, res) => {
  const kind = req.params.kind, out = []
  for (const { scope, dir } of KINDS[kind].dirs()) {
    if (!fs.existsSync(dir)) continue
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = KINDS[kind].nested ? entry.name : entry.name.replace(/\.md$/, '')
      if (KINDS[kind].nested ? !entry.isDirectory() : !entry.name.endsWith('.md')) continue
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
  if (!/^[\w.-]+$/.test(name || '')) return res.status(400).json({ error: 'invalid name' })
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
function readClaudeJson() { return JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8')) }
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

const INIT_MSG = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'claude-dashboard', version: '1.0.0' } } }
app.post('/api/mcp/:name/test', async (req, res) => {
  const cfg = req.body.config
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
      // 401 means reachable but needs OAuth — still a live server
      return res.json({ ok: r.status < 500, status: r.status, ms: Date.now() - t0, detail: body })
    }
    const result = await new Promise(resolve => {
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
    res.json(result)
  } catch (e) {
    res.json({ ok: false, error: e.message, ms: Date.now() - t0 })
  }
})

// ---------- hooks + settings ----------
const SETTINGS_FILES = {
  user: path.join(CLAUDE, 'settings.json'),
  project: path.join(PROJECT, '.claude', 'settings.json'),
  local: path.join(PROJECT, '.claude', 'settings.local.json'),
}
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
  const { scope, settings } = req.body // full settings object, already-parsed JSON
  const file = SETTINGS_FILES[scope]
  if (!file) return res.status(400).json({ error: 'bad scope' })
  const bak = backup(file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(settings, null, 2))
  res.json({ ok: true, backup: bak })
})

// ---------- artifacts ----------
const SKIP_DIRS = new Set(['node_modules', '.git', 'plugins', 'dashboard-backups', 'statsig', '__pycache__', 'shell-snapshots', 'file-history', 'paste-cache', 'telemetry', 'todos'])
const SKIP_EXTS = new Set(['db', 'db-shm', 'db-wal', 'sqlite', 'sqlite3', 'lock', 'lockb', 'pyc'])
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
const MIME = { html: 'text/html', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', json: 'application/json', pdf: 'application/pdf' }
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

// ---------- overview: context cost, quality score, specificity, groups/tags ----------
const META_FILE = path.join(CLAUDE, 'dashboard-meta.json')
const readMeta = () => { try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')) } catch { return { tags: {} } } }
const tokens = s => Math.ceil((s || '').length / 4) // ~4 chars/token heuristic

function scoreItem(fm, body, kind) {
  // ponytail: static-analysis heuristic, not an LLM judge — upgrade to an eval harness if scores need to be trusted
  let s = 0
  const d = String(fm.description || '')
  if (d) s += 15
  if (d.length >= 60) s += 10
  if (d.length >= 150) s += 5
  if (/use (this |it )?when|trigger|whenever|use for/i.test(d)) s += 10
  if (fm['argument-hint']) s += 8
  if (fm['allowed-tools'] || fm.tools) s += 8
  if (fm.name || kind === 'commands' || kind === 'templates') s += 4
  const words = body.trim().split(/\s+/).length
  if (words >= 50) s += 10
  if (words >= 200) s += 5
  if (/^#{1,3} /m.test(body)) s += 10
  if (/```/.test(body) || /^\s*[-*] /m.test(body)) s += 10
  if (kind === 'commands' && /\$ARGUMENTS/.test(body)) s += 5
  if (words > 4000) s -= 10 // context hog when invoked
  return Math.max(0, Math.min(100, s))
}
const levelOf = s => (s >= 90 ? 'perfect' : s >= 70 ? 'excellent' : s >= 45 ? 'good' : 'poor')
function specificityOf(fm, kind) {
  const d = String(fm.description || '')
  let s = Math.min(30, d.length / 10)
  if (/use (this |it )?when|trigger|whenever|use for|use whenever/i.test(d)) s += 20
  if (/"[^"]+"|'[^']+'|`[^`]+`/.test(d)) s += 15
  if (/e\.g\.|example|such as/i.test(d)) s += 10
  if (fm['argument-hint']) s += 15
  if (/do not|don't|never|only|instead of/i.test(d)) s += 10
  return Math.round(Math.min(100, s))
}
function groupOf(name, kind) {
  const prefix = name.split(/[-_]/)[0].toLowerCase()
  return ['gsd', 'loush', 'ticket', 'figma', 'notion', 'ctx'].includes(prefix) ? prefix : kind
}

app.get('/api/overview', (req, res) => {
  const meta = readMeta()
  const items = []
  const push = (kind, name, extra) => items.push({ kind, name, tags: meta.tags?.[`${kind}:${name}`] || [], ...extra })
  for (const kind of ['skills', 'commands', 'agents']) {
    for (const { scope, dir } of KINDS[kind].dirs()) {
      if (!fs.existsSync(dir)) continue
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const name = KINDS[kind].nested ? entry.name : entry.name.replace(/\.md$/, '')
        const file = itemFile(kind, dir, name)
        if (!fs.existsSync(file)) continue
        const content = fs.readFileSync(file, 'utf8')
        const { fm, body } = parseFM(content)
        const score = scoreItem(fm, body, kind)
        push(kind, name, {
          scope, group: groupOf(name, kind),
          descTokens: tokens(String(fm.description || '')), // always in context (metadata listing)
          fullTokens: tokens(content),                       // loaded when invoked
          score, level: levelOf(score), specificity: specificityOf(fm, kind),
        })
      }
    }
  }
  const tplDir = path.join(CLAUDE, 'templates')
  if (fs.existsSync(tplDir))
    for (const f of fs.readdirSync(tplDir).filter(f => !f.startsWith('.') && fs.statSync(path.join(tplDir, f)).isFile())) {
      const content = fs.readFileSync(path.join(tplDir, f), 'utf8')
      const { fm, body } = parseFM(content)
      const score = scoreItem(fm, body, 'templates')
      push('templates', f, { scope: 'user', group: 'templates', descTokens: 0, fullTokens: tokens(content), score, level: levelOf(score), specificity: specificityOf(fm, 'templates') })
    }
  try {
    const cj = readClaudeJson()
    for (const [name, config] of Object.entries(cj.mcpServers || {}))
      push('mcp', name, { scope: 'user', group: 'mcp', descTokens: 0, fullTokens: tokens(JSON.stringify(config)), score: null, level: null, specificity: null })
  } catch {}
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILES.user, 'utf8'))
    for (const [name, on] of Object.entries(settings.enabledPlugins || {}))
      if (on) push('plugins', name.split('@')[0], { scope: 'user', group: 'plugins', descTokens: 0, fullTokens: 0, score: null, level: null, specificity: null })
  } catch {}
  res.json({ items })
})

app.put('/api/tags', (req, res) => {
  const { key, tags: t } = req.body // key = "<kind>:<name>"
  const meta = readMeta()
  meta.tags = meta.tags || {}
  if (t?.length) meta.tags[key] = t
  else delete meta.tags[key]
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  res.json({ ok: true })
})

// ---------- usage: parsed from session transcripts (per-file mtime cache) ----------
const usageCache = new Map() // file -> {mtime, size, entries, lines, tools, out, msgs, toolCalls}
function collectUsage() {
  const base = path.join(CLAUDE, 'projects')
  const files = []
  const walkJ = d => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkJ(p); else if (e.name.endsWith('.jsonl')) files.push(p) } } catch {} }
  walkJ(base)
  const all = { entries: [], lineEvents: [], toolTotals: {}, files: [] }
  for (const f of files) {
    const st = fs.statSync(f)
    const proj = path.relative(base, f).split(path.sep)[0]
    let rec = usageCache.get(f)
    if (!rec || rec.mtime !== st.mtimeMs || rec.size !== st.size) {
      rec = { mtime: st.mtimeMs, size: st.size, entries: [], lines: [], tools: {}, out: 0, msgs: 0, toolCalls: 0 }
      try {
        for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
          if (line.includes('"usage"')) {
            try {
              const j = JSON.parse(line)
              const u = j.message?.usage, model = j.message?.model
              if (!u || !model || model === '<synthetic>' || !j.timestamp) continue
              let tc = 0
              if (Array.isArray(j.message.content))
                for (const c of j.message.content) if (c.type === 'tool_use') { tc++; rec.tools[c.name] = (rec.tools[c.name] || 0) + 1 }
              rec.entries.push({ t: Date.parse(j.timestamp), model, proj, in: u.input_tokens || 0, out: u.output_tokens || 0, cc: u.cache_creation_input_tokens || 0, cr: u.cache_read_input_tokens || 0, tc })
              rec.out += u.output_tokens || 0; rec.msgs++; rec.toolCalls += tc
            } catch {}
          } else if (line.includes('"structuredPatch"')) {
            try {
              const j = JSON.parse(line)
              const sp = j.toolUseResult?.structuredPatch
              if (!Array.isArray(sp) || !j.timestamp) continue
              let add = 0, del = 0
              for (const h of sp) for (const l of h.lines || []) { if (l[0] === '+') add++; else if (l[0] === '-') del++ }
              if (add + del) rec.lines.push({ t: Date.parse(j.timestamp), proj, add, del })
            } catch {}
          }
        }
      } catch {}
      usageCache.set(f, rec)
    }
    all.entries.push(...rec.entries)
    all.lineEvents.push(...rec.lines)
    for (const [k, v] of Object.entries(rec.tools)) all.toolTotals[k] = (all.toolTotals[k] || 0) + v
    all.files.push({ path: f, proj, isAgent: f.includes('subagents'), mtime: st.mtimeMs, out: rec.out, msgs: rec.msgs, toolCalls: rec.toolCalls })
  }
  all.entries.sort((a, b) => a.t - b.t)
  return all
}
// est. $ saved by prompt caching: cache reads cost ~10% of input price → 90% saved
const PRICE_PER_M = m => (/opus|fable/.test(m) ? 15 : /haiku/.test(m) ? 0.8 : 3)
const HOUR = 3600_000, BLOCK = 5 * HOUR
app.get('/api/usage', (req, res) => {
  const { entries, lineEvents, toolTotals, files } = collectUsage()
  const perModel = {}
  for (const e of entries) {
    const m = (perModel[e.model] ||= { msgs: 0, out: 0, in: 0, cache: 0 })
    m.msgs++; m.out += e.out; m.in += e.in; m.cache += e.cc + e.cr
  }
  // 5h billing blocks: start hour-floored at first activity, next block at first activity after previous end
  let blockStart = null, active = null
  for (const e of entries) {
    if (blockStart === null || e.t >= blockStart + BLOCK) blockStart = Math.floor(e.t / HOUR) * HOUR
  }
  if (blockStart !== null && Date.now() < blockStart + BLOCK) {
    const blockEntries = entries.filter(e => e.t >= blockStart)
    const byModel = {}
    for (const e of blockEntries) {
      const m = (byModel[e.model] ||= { msgs: 0, out: 0, in: 0, cache: 0 })
      m.msgs++; m.out += e.out; m.in += e.in; m.cache += e.cc + e.cr
    }
    active = { start: blockStart, end: blockStart + BLOCK, byModel, msgs: blockEntries.length, out: blockEntries.reduce((s, e) => s + e.out, 0), in: blockEntries.reduce((s, e) => s + e.in + e.cc, 0) }
  }
  // daily series (126 days = 18 weeks, for heatmap + sparklines) + streak
  const dayOf = t => new Date(t).toISOString().slice(0, 10)
  const daily = {}
  for (const e of entries) { const d = (daily[dayOf(e.t)] ||= { out: 0, msgs: 0, tools: 0, lines: 0 }); d.out += e.out; d.msgs++; d.tools += e.tc }
  for (const l of lineEvents) { const d = daily[dayOf(l.t)]; if (d) d.lines += l.add + l.del }
  const days = Object.keys(daily).sort()
  const series = []
  for (let i = 125; i >= 0; i--) {
    const d = dayOf(Date.now() - i * 24 * HOUR)
    series.push({ date: d, ...(daily[d] || { out: 0, msgs: 0, tools: 0, lines: 0 }) })
  }
  let streak = 0
  for (let i = 0; ; i++) {
    const d = dayOf(Date.now() - i * 24 * HOUR)
    if (daily[d]) streak++
    else if (i === 0) continue // today idle doesn't break the streak
    else break
  }
  // KPI extras
  const now = Date.now(), d7 = now - 7 * 24 * HOUR, d30 = now - 30 * 24 * HOUR
  const todayKey = dayOf(now)
  let lines7Add = 0, lines7Del = 0
  for (const l of lineEvents) if (l.t >= d7) { lines7Add += l.add; lines7Del += l.del }
  const costSaved = entries.reduce((s, e) => s + (e.cr / 1e6) * PRICE_PER_M(e.model) * 0.9, 0)
  const sessions30 = files.filter(f => !f.isAgent && f.mtime >= d30).length
  const projNames = {}
  try { for (const d of Object.keys(readClaudeJson().projects || {})) projNames[d.replace(/[\\/:._]/g, '-')] = path.basename(d) } catch {}
  const recentSessions = files.filter(f => !f.isAgent && f.msgs > 0).sort((a, b) => b.mtime - a.mtime).slice(0, 6)
    .map(f => ({ proj: projNames[f.proj] || f.proj.split('-').pop(), mtime: f.mtime, out: f.out, msgs: f.msgs, toolCalls: f.toolCalls }))
  const tools = Object.entries(toolTotals).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([name, count]) => ({ name, count }))
  res.json({
    perModel, activeBlock: active, totalMsgs: entries.length, since: entries[0]?.t || null,
    daily: series, streak, activeDays: days.length, tools, recentSessions,
    kpis: {
      lines7d: { add: lines7Add, del: lines7Del },
      toolCallsToday: daily[todayKey]?.tools || 0, toolCallsTotal: entries.reduce((s, e) => s + e.tc, 0),
      sessions30, costSaved: Math.round(costSaved * 100) / 100, cacheReadTok: entries.reduce((s, e) => s + e.cr, 0),
    },
  })
})

// ---------- projects ----------
const ACTIVE_MS = 5 * 60_000 // transcript touched in last 5 min = running
const gitCache = new Map() // dir -> {t, commits, langs}
const LANG_EXT = { ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', py: 'Python', go: 'Go', rs: 'Rust', rb: 'Ruby', java: 'Java', kt: 'Kotlin', swift: 'Swift', css: 'CSS', scss: 'CSS', vue: 'Vue', php: 'PHP', dart: 'Dart', md: 'Markdown', sh: 'Shell' }
function repoInfo(dir) {
  const c = gitCache.get(dir)
  if (c && Date.now() - c.t < 10 * 60_000) return c
  let commits = null
  try { commits = parseInt(spawnSync('git', ['-C', dir, 'rev-list', '--count', 'HEAD'], { timeout: 3000 }).stdout.toString().trim()) || null } catch {}
  const counts = {}
  const walk2 = (d, depth) => {
    if (depth > 2) return
    try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.') || e.name === 'node_modules') continue; if (e.isDirectory()) walk2(path.join(d, e.name), depth + 1); else { const l = LANG_EXT[path.extname(e.name).slice(1)]; if (l) counts[l] = (counts[l] || 0) + 1 } } } catch {}
  }
  walk2(dir, 0)
  const langs = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n)
  const info = { t: Date.now(), commits, langs }
  gitCache.set(dir, info)
  return info
}
app.get('/api/projects', (req, res) => {
  const cj = readClaudeJson()
  const { entries, lineEvents } = collectUsage()
  const byProj = {}
  const day = 24 * 3600_000, d14 = Date.now() - 14 * day
  for (const e of entries) {
    const p = (byProj[e.proj] ||= { out: 0, in: 0, cache: 0, msgs: 0, last: 0, models: {}, spark: new Array(14).fill(0), add: 0, del: 0 })
    p.out += e.out; p.in += e.in; p.cache += e.cc + e.cr; p.msgs++; p.last = Math.max(p.last, e.t)
    p.models[e.model] = (p.models[e.model] || 0) + 1
    if (e.t >= d14) p.spark[Math.min(13, Math.floor((e.t - d14) / day))] += e.out
  }
  for (const l of lineEvents) { const p = byProj[l.proj]; if (p) { p.add += l.add; p.del += l.del } }
  const now = Date.now(), base = path.join(CLAUDE, 'projects')
  const mangle = dir => dir.replace(/[\\/:._]/g, '-') // Claude Code transcript-dir naming
  const listDir = (p, nested) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter(e => (nested ? e.isDirectory() : e.name.endsWith('.md'))).map(e => (nested ? e.name : e.name.replace(/\.md$/, ''))) } catch { return [] } }
  const out = []
  for (const dir of Object.keys(cj.projects || {})) {
    const tdir = path.join(base, mangle(dir))
    let sessions = 0, running = 0, runningAgents = 0
    const walkT = d => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkT(p); else if (e.name.endsWith('.jsonl')) { const st = fs.statSync(p); if (d.includes('subagents')) { if (now - st.mtimeMs < ACTIVE_MS) runningAgents++ } else { sessions++; if (now - st.mtimeMs < ACTIVE_MS) running++ } } } } catch {} }
    walkT(tdir)
    let mcp = Object.keys(cj.projects[dir]?.mcpServers || {})
    try { mcp = [...new Set([...mcp, ...Object.keys(JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8')).mcpServers || {})])] } catch {}
    let progress = null // GSD roadmap checkboxes, if the project uses .planning/
    try {
      const rm = fs.readFileSync(path.join(dir, '.planning', 'ROADMAP.md'), 'utf8')
      const done = (rm.match(/^\s*- \[x\]/gim) || []).length, open = (rm.match(/^\s*- \[ \]/gm) || []).length
      if (done + open) progress = { done, total: done + open }
    } catch {}
    const u = byProj[mangle(dir)]
    const exists = fs.existsSync(dir)
    const info = exists ? repoInfo(dir) : { commits: null, langs: [] }
    out.push({
      path: dir, name: path.basename(dir), exists, current: dir === PROJECT,
      sessions, running, runningAgents, progress, mcp,
      commits: info.commits, langs: info.langs,
      skills: listDir(path.join(dir, '.claude', 'skills'), true),
      commands: listDir(path.join(dir, '.claude', 'commands'), false),
      agents: listDir(path.join(dir, '.claude', 'agents'), false),
      usage: u ? { out: u.out, in: u.in, cache: u.cache, msgs: u.msgs, last: u.last, spark: u.spark, linesAdd: u.add, linesDel: u.del, topModel: Object.entries(u.models).sort((a, b) => b[1] - a[1])[0]?.[0] || null } : null,
    })
  }
  out.sort((a, b) => (b.current - a.current) || (b.usage?.last || 0) - (a.usage?.last || 0))
  res.json(out)
})

// ---------- chat: live claude sessions ----------
// ponytail: sessions live in server memory — a dashboard restart orphans the view, but the
// CLI session persists on disk and can be resumed. Add persistence if that ever hurts.
const chats = new Map() // chatId -> {child, cwd, sessionId, alive, events: [], listeners: Set<res>}
function chatBroadcast(chat, ev) {
  chat.events.push(ev)
  const line = `data: ${JSON.stringify(ev)}\n\n`
  for (const l of chat.listeners) l.write(line)
}
// past conversation history from the on-disk transcript (resumed CLI sessions emit nothing until the first new message)
function historyEvents(cwd, sessionId) {
  const out = []
  try {
    for (const line of fs.readFileSync(path.join(CLAUDE, 'projects', mangle(cwd), sessionId + '.jsonl'), 'utf8').split('\n')) {
      try {
        const j = JSON.parse(line)
        if ((j.type !== 'user' && j.type !== 'assistant') || j.isMeta || !j.message) continue
        if (typeof j.message.content === 'string' && j.message.content.startsWith('<')) continue
        out.push({ type: j.type, message: j.message, parent_tool_use_id: j.parent_tool_use_id || null })
      } catch {}
    }
  } catch {}
  return out.slice(-200)
}
app.post('/api/chat', (req, res) => {
  const { cwd, resume } = req.body
  if (!cwd || !fs.existsSync(cwd)) return res.status(400).json({ error: 'cwd does not exist' })
  if (resume) {
    const existing = [...chats.entries()].find(([, c]) => c.alive && c.cwd === cwd && c.resume === resume)
    if (existing) return res.json({ id: existing[0] })
  }
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions']
  if (resume) args.push('--resume', resume)
  const child = spawn('claude', args, { cwd, env: process.env, shell: WIN }) // shell resolves claude.cmd on Windows
  const id = Math.random().toString(36).slice(2, 10)
  const chat = { child, cwd, resume: resume || null, sessionId: resume || null, alive: true, events: resume ? historyEvents(cwd, resume) : [], listeners: new Set() }
  chats.set(id, chat)
  let buf = ''
  child.stdout.on('data', d => {
    buf += d
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const ev = JSON.parse(line)
        if (ev.type === 'system' && ev.subtype === 'init') chat.sessionId = ev.session_id
        chatBroadcast(chat, ev)
      } catch {}
    }
  })
  child.stderr.on('data', d => chatBroadcast(chat, { type: 'stderr', text: String(d).slice(0, 2000) }))
  child.on('error', e => { chat.alive = false; chatBroadcast(chat, { type: 'closed', error: e.message }) })
  child.on('exit', code => { chat.alive = false; chatBroadcast(chat, { type: 'closed', code }) })
  res.json({ id })
})
app.get('/api/chat', (req, res) =>
  res.json([...chats.entries()].map(([id, c]) => ({ id, cwd: c.cwd, sessionId: c.sessionId, alive: c.alive, events: c.events.length }))))
app.get('/api/chat/:id/events', (req, res) => {
  const chat = chats.get(req.params.id)
  if (!chat) return res.status(404).json({ error: 'no such chat' })
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  res.write(': connected\n\n') // flush headers even when no events yet
  for (const ev of chat.events) res.write(`data: ${JSON.stringify(ev)}\n\n`)
  chat.listeners.add(res)
  req.on('close', () => chat.listeners.delete(res))
})
app.post('/api/chat/:id/message', (req, res) => {
  const chat = chats.get(req.params.id)
  if (!chat) return res.status(404).json({ error: 'no such chat' })
  if (!chat.alive) return res.status(410).json({ error: 'session ended' })
  const msg = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: req.body.text }] } }
  chatBroadcast(chat, msg) // echo so all viewers see it
  chat.child.stdin.write(JSON.stringify(msg) + '\n')
  res.json({ ok: true })
})
app.delete('/api/chat/:id', (req, res) => {
  const chat = chats.get(req.params.id)
  if (chat) { try { chat.child.kill() } catch {}; chats.delete(req.params.id) }
  res.json({ ok: true })
})
// past sessions on disk for a project (for --resume)
app.get('/api/chat/sessions', (req, res) => {
  const dir = path.join(CLAUDE, 'projects', String(req.query.cwd || '').replace(/[\\/:._]/g, '-'))
  const out = []
  try {
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
      const p = path.join(dir, f), st = fs.statSync(p)
      let title = ''
      try {
        // ponytail: first 64KB is enough to find the opening user message
        const fd = fs.openSync(p, 'r'), b = Buffer.alloc(65536)
        const n = fs.readSync(fd, b, 0, b.length, 0)
        fs.closeSync(fd)
        for (const line of b.toString('utf8', 0, n).split('\n')) {
          try {
            const j = JSON.parse(line)
            if (j.type !== 'user') continue
            const c = j.message?.content
            const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join(' ') : ''
            if (text.trim() && !text.startsWith('<')) { title = text.slice(0, 120); break }
          } catch {}
        }
      } catch {}
      out.push({ sessionId: f.replace(/\.jsonl$/, ''), mtime: st.mtimeMs, size: st.size, title })
    }
  } catch {}
  out.sort((a, b) => b.mtime - a.mtime)
  res.json(out.slice(0, 20))
})

// ---------- agent teams (experimental) ----------
const TEAMS = path.join(CLAUDE, 'teams')
const TASKS = path.join(CLAUDE, 'tasks')
const mangle = dir => dir.replace(/[\\/:._]/g, '-')
const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }

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
// find a teammate's transcript jsonl under the project transcript dir
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
const teamTokCache = new Map() // file -> {mtime,size,tokens,model,lastErr}
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
    // tail: last 256KB is plenty for a live transcript view
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
// all lead->teammate controls are inbox messages (that IS the team IPC mechanism)
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
// Real fields (permissions, model, env, hooks) live where Claude Code reads them.
// Mockup-only concepts (turn policy, context budget, routing) persist under a
// `harness` namespace in the same settings.json so inheritance is genuine.
const HARNESS_DEFAULTS = {
  turnPolicy: { maxTurns: 40, stopConditions: ['task done', 'needs input', 'budget hit'], retry: '3x exp backoff (2s->8s)', onError: 'checkpoint + retry', checkpointInterval: 5 },
  context: { windowSize: 200000, compactionThreshold: 0.82, keepTurns: 12, alwaysLoadedBudget: { systemPrompt: 2100, toolDefs: 1700, softCap: 8000 } },
  modelRouting: [
    { task: 'Plan & architect', model: 'opus-4-8', fallback: 'sonnet-4-6' },
    { task: 'Implement & edit', model: 'sonnet-4-6', fallback: 'sonnet-4-6' },
    { task: 'Quick edits & grep', model: 'haiku-4-5', fallback: 'sonnet-4-6' },
    { task: 'Subagent default', model: 'sonnet-4-6', fallback: 'haiku-4-5' },
  ],
  environment: { sandbox: 'filesystem · repo-scoped', network: 'off (opt-in)' },
}
const GUARDRAIL_DEFS = [
  { rule: 'Destructive shell (rm -rf, dd)', pattern: 'Bash(rm -rf*)', dflt: 'BLOCK' },
  { rule: 'git push / force-push', pattern: 'Bash(git push*)', dflt: 'ASK' },
  { rule: 'Outbound network requests', pattern: 'WebFetch', dflt: 'ASK' },
  { rule: 'Read secret files (.env, keys)', pattern: 'Read(./.env)', dflt: 'DENY' },
  { rule: 'Package install', pattern: 'Bash(npm install*)', dflt: 'ALLOW' },
]
const settingsFileFor = scope => (scope === 'global' ? path.join(CLAUDE, 'settings.json') : path.join(scope, '.claude', 'settings.json'))
const claudeMdFor = scope => (scope === 'global' ? path.join(CLAUDE, 'CLAUDE.md') : path.join(scope, 'CLAUDE.md'))
const leafPaths = (obj, prefix = '') => {
  let out = []
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue
    const p = prefix ? prefix + '.' + k : k
    if (typeof v === 'object' && !Array.isArray(v)) out = out.concat(leafPaths(v, p))
    else out.push(p)
  }
  return out
}
const getPath = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[Array.isArray(o) ? Number(k) : k]), obj)
const deepMerge = (base, over) => {
  if (over === undefined) return base
  if (base && over && typeof base === 'object' && typeof over === 'object' && !Array.isArray(base) && !Array.isArray(over)) {
    const out = { ...base }
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k])
    return out
  }
  return over
}
function harnessResolve(scope) {
  const gRaw = readJson(settingsFileFor('global'), {})
  const pRaw = scope === 'global' ? {} : readJson(settingsFileFor(scope), {})
  const overridden = scope === 'global' ? [] : leafPaths({ harness: pRaw.harness, permissions: pRaw.permissions, model: pRaw.model, env: pRaw.env })
  const settings = deepMerge(gRaw, pRaw)
  const h = deepMerge(HARNESS_DEFAULTS, settings.harness || {})
  const perms = settings.permissions || {}
  const guardMode = pat => {
    const inList = l => (perms[l] || []).some(r => r === pat)
    return inList('deny') ? 'DENY' : inList('ask') ? 'ASK' : inList('allow') ? 'ALLOW' : null
  }
  const guardrails = GUARDRAIL_DEFS.map(g => ({ ...g, mode: guardMode(g.pattern) || g.dflt, fromConfig: !!guardMode(g.pattern) }))
  // verification gates: real hooks + harness.verification entries
  const gates = []
  for (const [event, matchers] of Object.entries(settings.hooks || {}))
    for (const m of Array.isArray(matchers) ? matchers : [])
      for (const hk of m.hooks || [])
        gates.push({ name: `${event}${m.matcher ? ' · ' + m.matcher : ''}`, command: String(hk.command || '').slice(0, 80), status: 'hook', kind: 'hook' })
  for (const v of Array.isArray(settings.harness?.verification) ? settings.harness.verification : (Array.isArray(h.verification) ? h.verification : []))
    gates.push({ name: v.name, command: v.command, status: verifyResults.get(scope + '|' + v.name)?.status || 'manual', kind: 'gate' })
  // validation
  const conflicts = []
  for (const [s, f] of [['global', settingsFileFor('global')], [scope, settingsFileFor(scope)]]) {
    if (s === 'global' && scope !== 'global') {} // still validate both
    if (!fs.existsSync(f)) continue
    try { JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { conflicts.push(`${f}: invalid JSON — ${e.message.slice(0, 60)}`) }
  }
  for (const l of ['allow', 'ask', 'deny']) for (const r of perms[l] || []) if (typeof r !== 'string') conflicts.push(`permissions.${l} contains a non-string entry`)
  const dupes = (perms.allow || []).filter(r => (perms.deny || []).includes(r))
  for (const d of dupes) conflicts.push(`"${d}" is in both allow and deny`)
  if (h.turnPolicy.maxTurns < 1 || h.turnPolicy.maxTurns > 500) conflicts.push('harness.turnPolicy.maxTurns out of range (1-500)')
  if (h.context.compactionThreshold < 0.3 || h.context.compactionThreshold > 0.98) conflicts.push('harness.context.compactionThreshold out of range (0.3-0.98)')
  // instructions
  const mdPath = claudeMdFor(scope)
  const md = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : (scope !== 'global' && fs.existsSync(path.join(scope, '.claude', 'CLAUDE.md')) ? fs.readFileSync(path.join(scope, '.claude', 'CLAUDE.md'), 'utf8') : null)
  const claudeMdTokens = md ? tokens(md) : 0
  // live context usage: latest transcript entry for this scope's project
  let usedTokens = null
  try {
    const { entries } = collectUsage()
    const proj = scope === 'global' ? null : mangle(scope)
    const rel = proj ? entries.filter(e => e.proj === proj) : entries
    const last = rel[rel.length - 1]
    if (last) usedTokens = Math.min(last.in + last.cr, h.context.windowSize)
  } catch {}
  // health: computed, not stored
  const checks = [
    ['add a deny list', (perms.deny || []).length > 0, 15],
    ['add ask-first rules', (perms.ask || []).length > 0, 10],
    ['add auto-allow rules', (perms.allow || []).length > 0, 10],
    ['create CLAUDE.md', !!md, 10],
    ['trim always-loaded budget under soft cap', h.context.alwaysLoadedBudget.systemPrompt + h.context.alwaysLoadedBudget.toolDefs + claudeMdTokens <= h.context.alwaysLoadedBudget.softCap, 10],
    ['set compaction between 50–95%', h.context.compactionThreshold >= 0.5 && h.context.compactionThreshold <= 0.95, 10],
    ['set turn budget between 10–200', h.turnPolicy.maxTurns >= 10 && h.turnPolicy.maxTurns <= 200, 10],
    ['add ≥2 verification gates', gates.length >= 2, 15],
    ['resolve schema conflicts', conflicts.length === 0, 10],
  ]
  const health = checks.reduce((s, [, ok, w]) => s + (ok ? w : 0), 0)
  const failing = checks.filter(c => !c[1]).map(c => c[0])
  return {
    resolved: {
      turnPolicy: h.turnPolicy, context: h.context, modelRouting: h.modelRouting,
      guardrails: guardrails.map(({ rule, pattern, mode }) => ({ rule, pattern, mode })),
      permissions: { autoAllow: perms.allow || [], askFirst: perms.ask || [], denied: perms.deny || [], sandbox: h.environment.sandbox },
      environment: { workingDir: scope === 'global' ? HOME : scope, sandbox: h.environment.sandbox, network: h.environment.network, shell: (process.env.SHELL || process.env.ComSpec || '/bin/sh') + ' · non-interactive', envVars: Object.keys(settings.env || {}).length },
      model: settings.model || null,
    },
    verification: gates, overridden,
    meta: { configPath: settingsFileFor(scope), instrPath: mdPath, claudeMd: md, claudeMdTokens, usedTokens, windowSize: h.context.windowSize },
    health: { score: health, failing },
    valid: { ok: conflicts.length === 0, conflicts },
  }
}
const verifyResults = new Map() // scope|name -> {status, out, t}
app.get('/api/harness', (req, res) => {
  const cj = readJson(CLAUDE_JSON, {})
  const scopes = [{ id: 'global', label: 'Global', path: settingsFileFor('global'), ovCount: 0 }]
  for (const dir of Object.keys(cj.projects || {})) {
    if (dir === HOME || !fs.existsSync(dir)) continue // HOME's ".claude" IS the global scope
    const pset = readJson(path.join(dir, '.claude', 'settings.json'), null)
    scopes.push({ id: dir, label: path.basename(dir), path: path.join(dir, '.claude', 'settings.json'), ovCount: pset ? leafPaths({ harness: pset.harness, permissions: pset.permissions, model: pset.model, env: pset.env }).length : 0 })
  }
  const scope = req.query.scope && (req.query.scope === 'global' || scopes.some(s => s.id === req.query.scope)) ? req.query.scope : 'global'
  res.json({ scopes, scope, ...harnessResolve(scope) })
})
app.patch('/api/harness', (req, res) => {
  const { scope, path: dotPath, value } = req.body
  if (!dotPath || !/^(harness|permissions|model|env)(\.|$)/.test(dotPath)) return res.status(400).json({ error: 'path must be under harness/permissions/model/env' })
  const file = settingsFileFor(scope)
  const settings = readJson(file, {})
  const keys = dotPath.split('.')
  let o = settings
  for (const k of keys.slice(0, -1)) o = o[k] = (o[k] && typeof o[k] === 'object') ? o[k] : {}
  if (value === null) delete o[keys[keys.length - 1]]
  else o[keys[keys.length - 1]] = value
  const content = JSON.stringify(settings, null, 2)
  if (scope === 'global') return res.json({ ok: true, proposed: propose(file, content, `set ${dotPath}`), ...harnessResolve(scope) })
  track(file, content, { scope, summary: `set ${dotPath}` })
  res.json({ ok: true, ...harnessResolve(scope) })
})
app.get('/api/harness/raw', (req, res) => {
  const file = settingsFileFor(req.query.scope || 'global')
  res.json({ path: file, content: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{\n}\n' })
})
app.put('/api/harness/raw', (req, res) => {
  const { scope, content } = req.body
  try { JSON.parse(content) } catch (e) { return res.status(400).json({ error: 'invalid JSON: ' + e.message }) }
  const file = settingsFileFor(scope || 'global')
  if ((scope || 'global') === 'global') return res.json({ ok: true, proposed: propose(file, content, 'edit settings.json (raw)') })
  track(file, content, { scope, summary: 'edit settings.json (raw)' })
  res.json({ ok: true })
})
app.post('/api/harness/verify', (req, res) => {
  const { scope, name, command } = req.body
  const cwd = scope === 'global' ? HOME : scope
  exec(command, { cwd, timeout: 60000 }, (err, stdout, stderr) => { // exec uses cmd.exe on Windows, sh elsewhere
    const status = err ? 'failing' : 'passing'
    verifyResults.set(scope + '|' + name, { status, t: Date.now() })
    res.json({ status, out: String(stdout || '').slice(-400), err: String(stderr || '').slice(-400) })
  })
})

// ---------- project harness hub ----------
const readIf = p => { try { return fs.readFileSync(p, 'utf8') } catch { return null } }
const splitSections = src => {
  // split markdown into heading-anchored blocks for per-block provenance
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
  const alwaysOn = contributors.filter(c => c.mode === 'always').reduce((s, c) => s + c.tokens, 0) + skills.reduce((s, x) => s + x.descTokens, 0)
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
  if (alwaysOn > softCap) F('error', `always-loaded context (${Math.round(alwaysOn / 100) / 10}k) exceeds the ${Math.round(softCap / 1000)}k soft cap`, { type: 'budget', name: 'context budget' })
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
    budget: { contributors, alwaysOn, softCap, onInvoke: skills.reduce((s, x) => s + x.fullTokens, 0) },
    promptBlocks, graph: { nodes, edges },
    inventory: {
      skills: skills.map(({ body, ...s }) => s), agents: agents.map(({ body, ...a }) => a),
      rules: ruleFiles.map(({ src, ...r }) => r), adrs: adrs.map(({ body, ...a }) => a), references, mcps, memory,
    },
    triggers: triggers.slice(0, 40), findings, health, sessions: sessions.slice(0, 8),
  }
}
app.get('/api/hub', (req, res) => {
  const project = req.query.project
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  res.json(hubResolve(project))
})
// session replay: which skills/agents/tools actually fired
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
// artifact file read/edit (hub detail) — restricted to ~/.claude and known project dirs
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

// ---------- governance: version history, approvals, audit ----------
const VERSIONS_FILE = path.join(CLAUDE, 'dashboard-versions.jsonl')
const APPROVALS_FILE = path.join(CLAUDE, 'dashboard-approvals.json')
const AUTHOR = os.userInfo().username
const appendVersion = entry => fs.appendFileSync(VERSIONS_FILE, JSON.stringify(entry) + '\n')
// tracked write: every config mutation appends an immutable version/audit entry
function track(file, content, { scope = 'global', summary = '', author = AUTHOR, approvedBy = null } = {}) {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  const id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  appendVersion({ id, ts: Date.now(), author, machine: os.hostname(), scope, file, summary, approvedBy, prev, content })
  return id
}
function readVersions() {
  try { return fs.readFileSync(VERSIONS_FILE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] }
}
app.get('/api/gov/versions', (req, res) => {
  const { scope, file, author, q } = req.query
  let v = readVersions()
  if (scope) v = v.filter(x => x.scope === scope)
  if (file) v = v.filter(x => x.file.includes(file))
  if (author) v = v.filter(x => x.author === author)
  if (q) v = v.filter(x => (x.summary + x.file).toLowerCase().includes(String(q).toLowerCase()))
  res.json(v.slice(-300).reverse().map(({ prev, content, ...meta }) => ({ ...meta, bytes: (content || '').length })))
})
app.get('/api/gov/versions/:id', (req, res) => {
  const v = readVersions().find(x => x.id === req.params.id)
  if (!v) return res.status(404).json({ error: 'no such version' })
  res.json(v)
})
app.post('/api/gov/rollback', (req, res) => {
  const v = readVersions().find(x => x.id === req.body.id)
  if (!v) return res.status(404).json({ error: 'no such version' })
  const target = req.body.to === 'prev' ? v.prev : v.content // roll back TO this version's state (or to before it)
  if (target == null) return res.status(400).json({ error: 'nothing to roll back to' })
  const id = track(v.file, target, { scope: v.scope, summary: `rollback to ${v.id}${req.body.to === 'prev' ? ' (before)' : ''}` })
  res.json({ ok: true, id })
})
// approvals: global-scope config changes are proposed, not applied
const readApprovals = () => readJson(APPROVALS_FILE, [])
const writeApprovals = a => fs.writeFileSync(APPROVALS_FILE, JSON.stringify(a, null, 2))
function propose(file, content, summary) {
  const a = readApprovals()
  const id = 'p' + Date.now().toString(36)
  a.push({ id, ts: Date.now(), author: AUTHOR, file, scope: 'global', summary, content, status: 'proposed' })
  writeApprovals(a)
  appendVersion({ id: id + '-proposed', ts: Date.now(), author: AUTHOR, machine: os.hostname(), scope: 'global', file, summary: 'PROPOSED: ' + summary, prev: null, content: null })
  return id
}
app.get('/api/gov/approvals', (req, res) => res.json(readApprovals().slice(-100).reverse()))
app.post('/api/gov/approvals/:id', (req, res) => {
  const a = readApprovals()
  const p = a.find(x => x.id === req.params.id)
  if (!p || p.status !== 'proposed') return res.status(404).json({ error: 'no pending proposal' })
  p.status = req.body.approve ? 'approved' : 'rejected'
  p.reviewedBy = AUTHOR; p.reviewedAt = Date.now(); p.note = req.body.note || ''
  if (req.body.approve) track(p.file, p.content, { scope: 'global', summary: p.summary, approvedBy: AUTHOR })
  writeApprovals(a)
  res.json({ ok: true, status: p.status })
})

// ---------- dry-run: resolve a hypothetical settings content without committing ----------
let dryRunOverride = null // {scope, settings} — consulted by readJson shim below during resolve
app.post('/api/gov/dryrun', (req, res) => {
  const { scope, content } = req.body
  let proposed
  try { proposed = JSON.parse(content) } catch (e) { return res.status(400).json({ error: 'invalid JSON: ' + e.message }) }
  const before = harnessResolve(scope)
  const file = settingsFileFor(scope)
  const real = readIf(file)
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(proposed, null, 2)) // ponytail: write+revert beats threading an override through the resolver
    const after = harnessResolve(scope)
    const pick = H => ({
      alwaysBudget: H.resolved.context.alwaysLoadedBudget, compaction: H.resolved.context.compactionThreshold,
      maxTurns: H.resolved.turnPolicy.maxTurns, guardrails: H.resolved.guardrails, routing: H.resolved.modelRouting,
      gates: H.verification.length, health: H.health.score, conflicts: H.valid.conflicts,
      permissions: H.resolved.permissions,
    })
    res.json({ before: pick(before), after: pick(after) })
  } finally {
    if (real == null) fs.rmSync(file, { force: true })
    else fs.writeFileSync(file, real)
  }
})

// ---------- failure & retry analytics ----------
const failCache = new Map() // file -> {mtime,size,toolErrs,toolUses,byHour,turns,compactions,retries,proj,last}
function failStats() {
  const base = path.join(CLAUDE, 'projects')
  const files = []
  const walkF = d => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkF(p); else if (e.name.endsWith('.jsonl')) files.push(p) } } catch {} }
  walkF(base)
  const out = []
  for (const f of files) {
    const st = fs.statSync(f)
    let rec = failCache.get(f)
    if (!rec || rec.mtime !== st.mtimeMs || rec.size !== st.size) {
      rec = { mtime: st.mtimeMs, size: st.size, proj: path.relative(base, f).split(path.sep)[0], toolErrs: {}, toolUses: {}, byHour: {}, turns: 0, compactions: 0, retries: 0, last: 0 }
      const idName = {}
      let lastErrTool = null
      try {
        for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
          if (!line) continue
          const isErr = line.includes('"is_error":true')
          if (!isErr && !line.includes('"tool_use"') && !line.includes('isCompactSummary') && !line.includes('"type":"summary"')) continue
          try {
            const j = JSON.parse(line)
            const t = Date.parse(j.timestamp) || 0
            rec.last = Math.max(rec.last, t)
            if (j.isCompactSummary || j.type === 'summary') { rec.compactions++; continue }
            if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
              rec.turns++
              let first = true
              for (const c of j.message.content) if (c.type === 'tool_use') {
                idName[c.id] = c.name
                rec.toolUses[c.name] = (rec.toolUses[c.name] || 0) + 1
                // retry = the very next tool call after an error hits the same tool
                if (first && lastErrTool === c.name) rec.retries++
                if (first) { lastErrTool = null; first = false }
              }
            }
            if (j.type === 'user' && Array.isArray(j.message?.content))
              for (const c of j.message.content) if (c.type === 'tool_result' && c.is_error) {
                const name = idName[c.tool_use_id] || '?'
                rec.toolErrs[name] = (rec.toolErrs[name] || 0) + 1
                lastErrTool = name
                if (t) { const d = new Date(t); const k = d.getDay() + ':' + d.getHours(); rec.byHour[k] = (rec.byHour[k] || 0) + 1 }
              }
          } catch {}
        }
      } catch {}
      failCache.set(f, rec)
    }
    out.push(rec)
  }
  return out
}
app.get('/api/gov/failures', (req, res) => {
  const days = Number(req.query.days) || 30
  const proj = req.query.project ? mangle(req.query.project) : null
  const cutoff = Date.now() - days * 86400_000
  const recs = failStats().filter(r => r.last >= cutoff && (!proj || r.proj === proj))
  const toolErrs = {}, toolUses = {}, byHour = {}
  let compactions = 0, retries = 0
  const turnsDist = []
  for (const r of recs) {
    for (const [k, v] of Object.entries(r.toolErrs)) toolErrs[k] = (toolErrs[k] || 0) + v
    for (const [k, v] of Object.entries(r.toolUses)) toolUses[k] = (toolUses[k] || 0) + v
    for (const [k, v] of Object.entries(r.byHour)) byHour[k] = (byHour[k] || 0) + v
    compactions += r.compactions; retries += r.retries
    if (r.turns > 0) turnsDist.push(r.turns)
  }
  const tools = Object.keys(toolUses).map(name => ({ name, uses: toolUses[name], errors: toolErrs[name] || 0, rate: toolUses[name] ? (toolErrs[name] || 0) / toolUses[name] : 0 }))
    .filter(t => t.uses >= 3).sort((a, b) => b.errors - a.errors).slice(0, 12)
  res.json({ tools, byHour, compactions, retries, turnsDist, sessions: recs.length })
})

// ---------- trace viewer ----------
app.get('/api/gov/trace', (req, res) => {
  const { project, id } = req.query
  const f = path.join(CLAUDE, 'projects', mangle(String(project || '')), String(id || '') + '.jsonl')
  if (!/^[\w-]+$/.test(String(id || '')) || !fs.existsSync(f)) return res.status(404).json({ error: 'no such session' })
  const steps = []
  let firstTs = null
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue
    try {
      const j = JSON.parse(line)
      const ts = Date.parse(j.timestamp) || null
      firstTs ??= ts
      if (j.type === 'user' && typeof j.message?.content === 'string' && !j.message.content.startsWith('<'))
        steps.push({ kind: 'prompt', ts, text: j.message.content.slice(0, 300) })
      else if (j.type === 'user' && Array.isArray(j.message?.content))
        for (const c of j.message.content) if (c.type === 'tool_result') steps.push({ kind: 'observe', ts, err: !!c.is_error, text: (typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 200) })
      else if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
        const outTok = j.message.usage?.output_tokens || 0
        for (const c of j.message.content) {
          if (c.type === 'text' && c.text.trim()) steps.push({ kind: 'reason', ts, tokens: outTok, text: c.text.slice(0, 300) })
          else if (c.type === 'tool_use') steps.push({ kind: 'act', ts, tokens: outTok, name: c.name, text: JSON.stringify(c.input).slice(0, 200) })
        }
      } else if (j.isCompactSummary || j.type === 'summary') steps.push({ kind: 'checkpoint', ts, text: 'context compacted' })
    } catch {}
  }
  for (let i = 0; i < steps.length; i++) steps[i].latency = steps[i + 1]?.ts && steps[i].ts ? steps[i + 1].ts - steps[i].ts : null
  // config version active during this session
  const ver = readVersions().filter(v => v.ts <= (firstTs || 0)).pop() || null
  res.json({ steps: steps.slice(0, 400), total: steps.length, startedAt: firstTs, configVersion: ver ? { id: ver.id, summary: ver.summary, file: ver.file, ts: ver.ts } : null })
})

// ---------- eval / regression suite ----------
const EVALS_FILE = path.join(CLAUDE, 'harness-evals.json')
const EVAL_RUNS = path.join(CLAUDE, 'harness-eval-runs.jsonl')
const DEFAULT_EVALS = [
  { name: 'sanity: instruction following', prompt: 'Reply with exactly the word: HARNESS_OK', expect: 'HARNESS_OK' },
  { name: 'reasoning: arithmetic', prompt: 'What is 17*23? Reply with just the number.', expect: '391' },
  { name: 'tool use: filesystem', prompt: 'List the files in the current directory, then reply with the word FS_DONE at the end.', expect: 'FS_DONE' },
]
const evalRuns = () => { try { return fs.readFileSync(EVAL_RUNS, 'utf8').split('\n').filter(Boolean).map(JSON.parse) } catch { return [] } }
const activeEvals = new Map() // runId -> {status, done, total}
app.get('/api/gov/evals', (req, res) => res.json({ tasks: readJson(EVALS_FILE, DEFAULT_EVALS), runs: evalRuns().slice(-40).reverse(), active: [...activeEvals.entries()].map(([id, s]) => ({ id, ...s })) }))
app.put('/api/gov/evals', (req, res) => { fs.writeFileSync(EVALS_FILE, JSON.stringify(req.body.tasks, null, 2)); res.json({ ok: true }) })
app.post('/api/gov/evals/run', (req, res) => {
  const scope = req.body.scope || 'global'
  const cwd = scope === 'global' ? HOME : scope
  const tasks = readJson(EVALS_FILE, DEFAULT_EVALS)
  const runId = 'run' + Date.now().toString(36)
  activeEvals.set(runId, { status: 'running', done: 0, total: tasks.length })
  res.json({ ok: true, runId })
  ;(async () => {
    const results = []
    for (const t of tasks) {
      const r = await new Promise(resolve => {
        const child = spawn('claude', ['-p', t.prompt, '--output-format', 'json', '--dangerously-skip-permissions'], { cwd, env: process.env, shell: WIN })
        let out = ''
        const timer = setTimeout(() => { try { child.kill() } catch {}; resolve({ pass: false, error: 'timeout' }) }, 180000)
        child.stdout.on('data', d => out += d)
        child.on('exit', () => {
          clearTimeout(timer)
          try {
            const j = JSON.parse(out)
            resolve({ pass: new RegExp(t.expect).test(j.result || ''), tokens: (j.usage?.input_tokens || 0) + (j.usage?.output_tokens || 0), turns: j.num_turns, cost: j.total_cost_usd, ms: j.duration_ms })
          } catch { resolve({ pass: false, error: 'no result' }) }
        })
      })
      results.push({ name: t.name, ...r })
      activeEvals.get(runId).done++
    }
    const passRate = results.filter(r => r.pass).length / (results.length || 1)
    fs.appendFileSync(EVAL_RUNS, JSON.stringify({ id: runId, ts: Date.now(), scope, passRate, tokens: results.reduce((s, r) => s + (r.tokens || 0), 0), cost: results.reduce((s, r) => s + (r.cost || 0), 0), turns: results.reduce((s, r) => s + (r.turns || 0), 0), results }) + '\n')
    activeEvals.delete(runId)
  })().catch(() => activeEvals.delete(runId))
})

// ---------- costs, budgets, alerts ----------
// anthropic-ish price ratios off PRICE_PER_M (input price): out=5x, cache-write=1.25x, cache-read=0.1x
const entryCost = e => { const P = PRICE_PER_M(e.model); return (e.in * P + e.out * P * 5 + e.cc * P * 1.25 + e.cr * P * 0.1) / 1e6 }
function costAlerts() {
  const { entries } = collectUsage()
  const today = new Date().toISOString().slice(0, 10)
  const gRaw = readJson(settingsFileFor('global'), {})
  const budgets = deepMerge({ dailyUSD: null, dailyTokens: null }, gRaw.harness?.budgets || {})
  let usd = 0, tok = 0
  for (const e of entries) if (new Date(e.t).toISOString().slice(0, 10) === today) { usd += entryCost(e); tok += e.in + e.out + e.cc }
  const alerts = []
  for (const [key, cap, val, unit] of [['dailyUSD', budgets.dailyUSD, usd, '$'], ['dailyTokens', budgets.dailyTokens, tok, ' tok']]) {
    if (!cap) continue
    if (val >= cap) alerts.push({ level: 'error', text: `${key} cap exceeded: ${unit === '$' ? '$' + val.toFixed(2) : Math.round(val).toLocaleString() + unit} / ${unit === '$' ? '$' + cap : cap.toLocaleString() + unit}` })
    else if (val >= cap * 0.8) alerts.push({ level: 'warning', text: `${key} at ${Math.round((val / cap) * 100)}% of cap` })
  }
  return { todayUSD: usd, todayTokens: tok, budgets, alerts }
}
app.get('/api/gov/costs', (req, res) => {
  const days = Number(req.query.days) || 30
  const { entries } = collectUsage()
  const cutoff = Date.now() - days * 86400_000
  const byDay = {}, byProj = {}, byModel = {}
  for (const e of entries) {
    if (e.t < cutoff) continue
    const c = entryCost(e), d = new Date(e.t).toISOString().slice(0, 10)
    ;(byDay[d] ||= { usd: 0, tok: 0 }); byDay[d].usd += c; byDay[d].tok += e.in + e.out + e.cc
    ;(byProj[e.proj] ||= { usd: 0, tok: 0 }); byProj[e.proj].usd += c; byProj[e.proj].tok += e.in + e.out + e.cc
    ;(byModel[e.model] ||= { usd: 0, tok: 0 }); byModel[e.model].usd += c; byModel[e.model].tok += e.in + e.out + e.cc
  }
  res.json({ byDay, byProj, byModel, ...costAlerts() })
})

// ---------- profiles / presets ----------
const PROFILES_FILE = path.join(CLAUDE, 'harness-profiles.json')
const DEFAULT_PROFILES = [
  { name: 'deep refactor', description: 'long horizon, strict verification, opus for planning', harness: { turnPolicy: { maxTurns: 120, checkpointInterval: 3 }, modelRouting: [{ task: 'Plan & architect', model: 'opus-4-8', fallback: 'sonnet-4-6' }, { task: 'Implement & edit', model: 'sonnet-4-6', fallback: 'sonnet-4-6' }, { task: 'Quick edits & grep', model: 'haiku-4-5', fallback: 'sonnet-4-6' }, { task: 'Subagent default', model: 'sonnet-4-6', fallback: 'haiku-4-5' }] } },
  { name: 'quick fix', description: 'short horizon, fast models, minimal ceremony', harness: { turnPolicy: { maxTurns: 15, checkpointInterval: 10 }, modelRouting: [{ task: 'Plan & architect', model: 'sonnet-4-6', fallback: 'haiku-4-5' }, { task: 'Implement & edit', model: 'sonnet-4-6', fallback: 'haiku-4-5' }, { task: 'Quick edits & grep', model: 'haiku-4-5', fallback: 'haiku-4-5' }, { task: 'Subagent default', model: 'haiku-4-5', fallback: 'haiku-4-5' }] } },
  { name: 'research', description: 'wide context, high compaction threshold, read-heavy', harness: { turnPolicy: { maxTurns: 60 }, context: { compactionThreshold: 0.9, keepTurns: 20 } } },
]
const readProfiles = () => readJson(PROFILES_FILE, DEFAULT_PROFILES)
app.get('/api/gov/profiles', (req, res) => res.json(readProfiles()))
app.put('/api/gov/profiles', (req, res) => {
  track(PROFILES_FILE, JSON.stringify(req.body.profiles, null, 2), { summary: 'update harness profiles' })
  res.json({ ok: true })
})
app.post('/api/gov/profiles/apply', (req, res) => {
  const { name, scope } = req.body
  const p = readProfiles().find(x => x.name === name)
  if (!p) return res.status(404).json({ error: 'no such profile' })
  const file = settingsFileFor(scope)
  const settings = readJson(file, {})
  const next = JSON.stringify({ ...settings, harness: deepMerge(settings.harness || {}, p.harness) }, null, 2)
  if (scope === 'global') return res.json({ ok: true, proposed: propose(file, next, `apply profile "${name}" to global`) })
  track(file, next, { scope, summary: `apply profile "${name}"` })
  res.json({ ok: true })
})

// ---------- import / export / library + drift ----------
const LIBRARY_DIR = path.join(CLAUDE, 'harness-library')
function exportBundle(project, name, description) {
  const grab = p => readIf(p)
  const bundle = {
    name, description, provenance: { author: AUTHOR, machine: os.hostname(), project, createdAt: Date.now() },
    settings: readJson(path.join(project, '.claude', 'settings.json'), null),
    rules: Object.fromEntries([['CLAUDE.md', grab(path.join(project, 'CLAUDE.md'))], ['.claude/CLAUDE.md', grab(path.join(project, '.claude', 'CLAUDE.md'))], ['AGENTS.md', grab(path.join(project, 'AGENTS.md'))]].filter(([, v]) => v != null)),
    skills: Object.fromEntries(hubListSkills(path.join(project, '.claude', 'skills'), 'project').map(s => [s.name, readIf(s.path)])),
    agents: Object.fromEntries(hubListAgents(path.join(project, '.claude', 'agents'), 'project').map(a => [a.name, readIf(a.path)])),
    mcp: readJson(path.join(project, '.mcp.json'), null),
    profiles: readProfiles(),
  }
  return bundle
}
app.post('/api/gov/bundle/export', (req, res) => {
  const { project, name, description } = req.body
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  const bundle = exportBundle(project, name || path.basename(project), description || '')
  fs.mkdirSync(LIBRARY_DIR, { recursive: true })
  const file = path.join(LIBRARY_DIR, (name || path.basename(project)).replace(/[^\w.-]/g, '_') + '.json')
  track(file, JSON.stringify(bundle, null, 2), { summary: `export bundle from ${path.basename(project)}` })
  res.json({ ok: true, file, bundle })
})
app.get('/api/gov/library', (req, res) => {
  const out = []
  try {
    for (const f of fs.readdirSync(LIBRARY_DIR).filter(f => f.endsWith('.json'))) {
      const b = readJson(path.join(LIBRARY_DIR, f), null)
      if (b) out.push({ file: f, name: b.name, description: b.description, provenance: b.provenance, counts: { rules: Object.keys(b.rules || {}).length, skills: Object.keys(b.skills || {}).length, agents: Object.keys(b.agents || {}).length } })
    }
  } catch {}
  res.json(out)
})
app.post('/api/gov/bundle/import', (req, res) => {
  const { file, project } = req.body
  const b = readJson(path.join(LIBRARY_DIR, path.basename(file || '')), null)
  if (!b || !project || !fs.existsSync(project)) return res.status(400).json({ error: 'bad bundle or project' })
  const written = []
  const w = (rel, content) => { const p = path.join(project, rel); track(p, content, { scope: project, summary: `import from bundle "${b.name}"` }); written.push(rel) }
  if (b.settings) w('.claude/settings.json', JSON.stringify(b.settings, null, 2))
  for (const [rel, src] of Object.entries(b.rules || {})) w(rel, src)
  for (const [n, src] of Object.entries(b.skills || {})) w(path.join('.claude', 'skills', n, 'SKILL.md'), src)
  for (const [n, src] of Object.entries(b.agents || {})) w(path.join('.claude', 'agents', n + '.md'), src)
  if (b.mcp) w('.mcp.json', JSON.stringify(b.mcp, null, 2))
  res.json({ ok: true, written })
})
// drift: compare project's current harness vs an agreed baseline bundle
app.post('/api/gov/baseline', (req, res) => {
  const meta = readMeta()
  ;(meta.baselines ||= {})[req.body.project] = req.body.file
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  res.json({ ok: true })
})
app.get('/api/gov/drift', (req, res) => {
  const project = req.query.project
  const meta = readMeta()
  const bFile = meta.baselines?.[project]
  if (!bFile) return res.json({ baseline: null, drifts: [] })
  const b = readJson(path.join(LIBRARY_DIR, path.basename(bFile)), null)
  if (!b) return res.json({ baseline: bFile, error: 'baseline bundle missing', drifts: [] })
  const cur = exportBundle(project, 'current', '')
  const drifts = []
  const cmp = (field, a, c) => { const A = JSON.stringify(a ?? null), C = JSON.stringify(c ?? null); if (A !== C) drifts.push({ field, baseline: A.slice(0, 400), current: C.slice(0, 400), syncable: true }) }
  cmp('settings.harness', b.settings?.harness, cur.settings?.harness)
  cmp('settings.permissions', b.settings?.permissions, cur.settings?.permissions)
  for (const k of new Set([...Object.keys(b.rules || {}), ...Object.keys(cur.rules || {})])) cmp('rules/' + k, b.rules?.[k], cur.rules?.[k])
  for (const k of new Set([...Object.keys(b.skills || {}), ...Object.keys(cur.skills || {})])) cmp('skills/' + k, b.skills?.[k] ? 'present' : null, cur.skills?.[k] ? 'present' : null)
  res.json({ baseline: bFile, provenance: b.provenance, drifts })
})
app.post('/api/gov/drift/sync', (req, res) => {
  const { project, field } = req.body
  const meta = readMeta()
  const b = readJson(path.join(LIBRARY_DIR, path.basename(meta.baselines?.[project] || '')), null)
  if (!b) return res.status(400).json({ error: 'no baseline' })
  if (field === 'settings.harness' || field === 'settings.permissions') {
    const file = path.join(project, '.claude', 'settings.json')
    const s = readJson(file, {})
    const key = field.split('.')[1]
    if (b.settings?.[key] === undefined) delete s[key]; else s[key] = b.settings[key]
    track(file, JSON.stringify(s, null, 2), { scope: project, summary: `sync ${field} from baseline` })
  } else if (field.startsWith('rules/')) {
    const rel = field.slice(6)
    if (b.rules?.[rel] != null) track(path.join(project, rel), b.rules[rel], { scope: project, summary: `sync ${rel} from baseline` })
  } else return res.status(400).json({ error: 'field not syncable' })
  res.json({ ok: true })
})

// ---------- recommendations ----------
app.get('/api/gov/recs', (req, res) => {
  const project = req.query.project
  const meta = readMeta()
  const dismissed = meta.recsDismissed || {}
  const recs = []
  if (project && fs.existsSync(project)) {
    const hub = hubResolve(project)
    for (const f of hub.findings) recs.push({ key: 'finding:' + f.text.slice(0, 60), severity: f.severity, text: f.text, fix: f.artifact?.path || null })
    // skills that cost a lot when loaded and haven't been touched in 60d
    const stale = hub.inventory.skills.filter(s => s.fullTokens > 3000 && Date.now() - s.mtime > 60 * 86400_000).slice(0, 5)
    if (stale.length) recs.push({ key: 'stale-skills:' + project, severity: 'info', text: `${stale.length} large skills untouched for 60+ days (${stale.map(s => s.name).slice(0, 3).join(', ')}) — consider pruning or making on-demand`, fix: stale[0].path })
    if (hub.budget.alwaysOn > hub.budget.softCap) recs.push({ key: 'budget:' + project, severity: 'error', text: `always-loaded budget ${Math.round(hub.budget.alwaysOn / 100) / 10}k exceeds the ${Math.round(hub.budget.softCap / 1000)}k cap — trim rules or skill metadata`, fix: null })
  }
  const { alerts } = costAlerts()
  for (const a of alerts) recs.push({ key: 'cost:' + a.text.slice(0, 40), severity: a.level, text: a.text + ' — consider downgrading model routing for routine tasks', fix: null })
  res.json(recs.map(r => ({ ...r, dismissed: dismissed[r.key] || null })))
})
app.post('/api/gov/recs/dismiss', (req, res) => {
  const meta = readMeta()
  ;(meta.recsDismissed ||= {})[req.body.key] = { reason: req.body.reason || '', ts: Date.now(), by: AUTHOR }
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  res.json({ ok: true })
})

// ---------- prompt generator / library ----------
const PROMPTS_DIR = path.join(CLAUDE, 'prompts-library')
const ASSETS_DIR = path.join(PROMPTS_DIR, 'assets')
function assemblePrompt(p) {
  const inputs = p.inputs || []
  const texts = inputs.filter(i => i.type === 'text').map(i => i.value)
  const urls = inputs.filter(i => i.type === 'url')
  const files = inputs.filter(i => i.type === 'file')
  const images = inputs.filter(i => i.type === 'image')
  const artifacts = inputs.filter(i => i.type === 'artifact')
  const tone = { direct: 'Be direct and concise.', thorough: 'Be thorough — explain reasoning and edge cases.', cautious: 'Proceed carefully; confirm before destructive steps.' }[p.tone] || ''
  const tpl = p.template || 'implementation'
  const H = { implementation: 'Implement the following', bugfix: 'Fix the following bug', research: 'Research the following question', review: 'Review the following' }[tpl] || 'Task'
  const lines = [`# ${p.title || H}`, '', `## Goal`, texts[0] || '(describe the goal)', '']
  if (texts.length > 1) lines.push('## Context', ...texts.slice(1), '')
  if (files.length || artifacts.length) {
    lines.push('## Relevant files & artifacts')
    for (const f of files) lines.push(`- \`${f.value}\``)
    for (const a of artifacts) lines.push(`- ${a.meta?.kind || 'artifact'}: \`${a.value}\``)
    lines.push('')
  }
  if (urls.length || images.length) {
    lines.push('## Attached references')
    for (const u of urls) lines.push(`- [${u.meta?.title || u.value}](${u.value})${u.meta?.description ? ' — ' + u.meta.description : ''}`)
    for (const im of images) lines.push(`- screenshot: ${im.meta?.name || im.value} (attached)`)
    lines.push('')
  }
  lines.push('## Constraints', tone || 'Follow the project rules (CLAUDE.md).', '')
  lines.push('## Acceptance criteria', ...(p.acceptance ? p.acceptance.split('\n').map(l => l.startsWith('-') ? l : '- ' + l) : ['- Works end to end', '- No regressions in existing behavior']))
  return lines.join('\n')
}
const promptFile = id => path.join(PROMPTS_DIR, id + '.json')
app.get('/api/prompts', (req, res) => {
  const out = []
  try {
    for (const f of fs.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.json'))) {
      const p = readJson(path.join(PROMPTS_DIR, f), null)
      if (p) out.push({ id: p.id, title: p.title, tags: p.tags || [], project: p.project || null, updatedAt: p.updatedAt, versions: (p.versions || []).length, inputs: (p.inputs || []).length })
    }
  } catch {}
  const q = String(req.query.q || '').toLowerCase()
  res.json(out.filter(p => !q || (p.title + (p.tags || []).join(' ')).toLowerCase().includes(q)).sort((a, b) => b.updatedAt - a.updatedAt))
})
app.get('/api/prompts/:id', (req, res) => {
  const p = readJson(promptFile(req.params.id.replace(/[^\w-]/g, '')), null)
  p ? res.json(p) : res.status(404).json({ error: 'not found' })
})
app.post('/api/prompts', (req, res) => {
  fs.mkdirSync(PROMPTS_DIR, { recursive: true })
  const b = req.body
  const id = b.id || 'pr' + Date.now().toString(36)
  const existing = readJson(promptFile(id), null)
  const output = assemblePrompt(b)
  const versions = existing?.versions || []
  if (existing?.output && existing.output !== output) versions.push({ ts: existing.updatedAt, output: existing.output, tone: existing.tone, template: existing.template })
  const doc = { id, title: b.title || 'untitled prompt', tags: b.tags || [], project: b.project || null, inputs: b.inputs || [], template: b.template || 'implementation', tone: b.tone || 'direct', acceptance: b.acceptance || '', output, versions: versions.slice(-20), updatedAt: Date.now(), author: AUTHOR }
  fs.writeFileSync(promptFile(id), JSON.stringify(doc, null, 2))
  res.json(doc)
})
app.delete('/api/prompts/:id', (req, res) => {
  try { fs.rmSync(promptFile(req.params.id.replace(/[^\w-]/g, ''))) } catch {}
  res.json({ ok: true })
})
app.post('/api/prompts/url-meta', async (req, res) => {
  try {
    const r = await fetch(req.body.url, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'claude-dashboard' } })
    const html = (await r.text()).slice(0, 60000)
    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || req.body.url
    const description = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) || [])[1] || ''
    res.json({ title: title.slice(0, 120), description: description.slice(0, 200), status: r.status })
  } catch (e) { res.json({ title: req.body.url, description: '', error: e.message }) }
})
app.post('/api/prompts/asset', (req, res) => {
  const { name, dataUrl } = req.body
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl || '')
  if (!m) return res.status(400).json({ error: 'expected image data URL' })
  fs.mkdirSync(ASSETS_DIR, { recursive: true })
  const file = path.join(ASSETS_DIR, Date.now().toString(36) + '-' + String(name || 'img').replace(/[^\w.-]/g, '_'))
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'))
  res.json({ ok: true, path: file })
})

app.get('/api/meta', (req, res) => res.json({ home: HOME, claudeDir: CLAUDE, project: PROJECT, backups: BACKUPS }))

app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }))
app.listen(PORT, () => console.log(`[claude-dashboard] API on http://localhost:${PORT}`))
