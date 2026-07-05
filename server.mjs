import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, execFile, spawnSync } from 'node:child_process'
import YAML from 'yaml'

const HOME = os.homedir()
const CLAUDE = path.join(HOME, '.claude')
const CLAUDE_JSON = path.join(HOME, '.claude.json')
const PROJECT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
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
      const child = spawn(cfg.command, cfg.args || [], { env: { ...process.env, ...(cfg.env || {}) } })
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
  execFile('open', ['-R', safe(req.body.path)])
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
  try { for (const d of Object.keys(readClaudeJson().projects || {})) projNames[d.replace(/[/._]/g, '-')] = path.basename(d) } catch {}
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
  const mangle = dir => dir.replace(/[/._]/g, '-') // Claude Code transcript-dir naming
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
  const child = spawn('claude', args, { cwd, env: process.env })
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
  const dir = path.join(CLAUDE, 'projects', String(req.query.cwd || '').replace(/[/._]/g, '-'))
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
const mangle = dir => dir.replace(/[/._]/g, '-')
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

app.get('/api/meta', (req, res) => res.json({ home: HOME, claudeDir: CLAUDE, project: PROJECT, backups: BACKUPS }))

app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }))
app.listen(PORT, () => console.log(`[claude-dashboard] API on http://localhost:${PORT}`))
