import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, exec, execFile, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { toggleOffFile } from './customize-toggle.mjs'
import mountCursor from './server-cursor.mjs'
import mountConstitution from './server-constitution.mjs'
import mountAtoms from './server-atoms.mjs'
import mountEng from './server-eng.mjs'
import mountCareer from './server-career.mjs'
import mountMemory, { retrieveContext } from './server-memory.mjs'
import mountMindwalk from './server-mindwalk.mjs'
import mountGame from './server-game.mjs'
import mountFigmaCapture from './server-figma-capture.mjs'
import mountPromptCheck from './server-promptcheck.mjs'
import { startScheduler, schedulerInbox, readSchedulerConfig, writeSchedulerConfig } from './scheduler.mjs'
import { verdictFrom } from './run-verdict.mjs'
import { computeUsageHealth, computeRegression } from './career-health.mjs'
import { buildDailyCacheMap, rollingCacheEfficiency, cacheWasteCost, buildDailyUsage, detectDailyAnomalies, projectMonthEnd } from './career-usage-trends.mjs'

// ============================ TWO DATA PLANES — READ THIS BEFORE ADDING AN ENDPOINT ============================
// PLANE A (work artifacts: JIRA, GitHub PRs, reviews, CI, bugs) lives in server-eng.mjs. It is already
//   team-visible — every engineer can open the underlying artifact — so per-person views are allowed there.
// PLANE B (this file: transcripts, tokens, cost, session times) is SELF-ONLY, FOREVER.
//   * server.mjs only ever reads the local ~/.claude of the person running the dashboard.
//   * No endpoint here accepts a machine/user/engineer parameter for transcript data. Ever.
//   * No aggregate over plane-B data is keyed by a person other than the viewer. No tokens-per-engineer,
//     no cost-per-engineer, no active-hours, no leaderboard. This is a boundary, not a preference.
//   * The ONLY permitted cross-plane join is /api/roi, at COHORT level: it drops the author/assignee field
//     BEFORE aggregating and never emits a per-person token, cost or session-time field.
//   * No auto-nudge / auto-ping: every "nudge" this server emits is a line of text for a human to send.
// Inbox items therefore carry `plane: 'work' | 'harness'` so the boundary is visible in the payload itself.
// =============================================================================================================

const HOME = os.homedir()
const CLAUDE = path.join(HOME, '.claude')
const CLAUDE_JSON = path.join(HOME, '.claude.json')
const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WIN = process.platform === 'win32'
const BACKUPS = path.join(CLAUDE, 'dashboard-backups')
const PORT = Number(process.env.DASH_PORT) || 5178

const app = express()
app.use(express.json({ limit: '10mb' }))
mountCursor(app, { testMcp: (...a) => mcpTest(...a) }) // /api/cursor/* — fully separate Cursor dashboard
mountConstitution(app) // /api/constitution/* — .wakeel/constitution insights, shared by both dashboards
mountAtoms(app) // /api/atoms/* — feature catalog + grounded ask-the-project search, shared by both dashboards
mountEng(app) // /api/eng/* — Engineering Metrics dashboard (JIRA changelog + GitHub PRs)
mountCareer(app, { track: (...a) => track(...a), readJson: (...a) => readJson(...a) }) // /api/career/* — personal Career dashboard
mountMemory(app) // /api/memory/* — Memory Recall: search curated memory + transcripts
mountMindwalk(app) // /api/mindwalk/* — runs the mindwalk binary (Claude sessions, or transcoded Cursor ones)
mountGame(app) // /api/game — XP/levels/achievements from outcome events. Self-only: no cross-person leaderboard, ever
mountFigmaCapture(app) // /api/figma-capture/* — annotate Figma screenshots with design-system component mappings
mountPromptCheck(app) // /api/promptcheck — cached `claude -p` rating of how the user prompts (claude|cursor)

// ---------- response cache for heavy aggregate GETs ----------
// Aggregation is local parsing (no claude CLI, no tokens) but re-runs on every section visit.
// TTL memo per URL; x-cached-at header drives the staleness chip in the UI; ?fresh=1 bypasses.
const HEAVY_TTL = {
  '/api/overview': 300_000, '/api/usage': 120_000, '/api/projects': 300_000, '/api/harness': 60_000,
  '/api/chatstats': 600_000, '/api/dupes': 600_000, '/api/flow': 600_000, '/api/search': 600_000,
  '/api/hub': 300_000, '/api/reviews': 600_000, '/api/hooks/health': 600_000, '/api/gov/failures': 600_000,
  '/api/gov/costs': 120_000, '/api/digest': 300_000, '/api/board/analytics': 120_000,
  '/api/inbox': 60_000, '/api/capabilities': 300_000, '/api/forensics': 600_000, '/api/sessions': 120_000,
  '/api/roi': 600_000, '/api/ci/health': 600_000, '/api/gov/team': 300_000,
}
const respCache = new Map() // url -> {at, body}
app.use((req, res, next) => {
  if (req.method !== 'GET') { respCache.clear(); return next() } // any write invalidates everything — cheap and always correct
  const ttl = HEAVY_TTL[req.path]
  if (!ttl) return next()
  const key = req.originalUrl.replace(/[?&]fresh=1/, '')
  const hit = respCache.get(key)
  if (hit && req.query.fresh !== '1' && Date.now() - hit.at < ttl) { res.set('x-cached-at', String(hit.at)); return res.json(hit.body) }
  const orig = res.json.bind(res)
  res.json = body => { if (res.statusCode === 200) respCache.set(key, { at: Date.now(), body }); res.set('x-cached-at', String(Date.now())); return orig(body) }
  next()
})

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
// generic JSON-RPC initialize probe — shared by the Claude and Cursor MCP sections
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
      // 401 means reachable but needs OAuth — still a live server
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
app.post('/api/mcp/:name/test', async (req, res) => res.json(await mcpTest(req.body.config)))

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

// ---------- Customize: one unified inventory + REAL enable/disable across every category ----------
// The presentation layer (CustomizeSection.jsx) shows skills/commands/subagents/rules/mcp/hooks/plugins as
// grouped cards with a toggle. "Disable" must actually make Claude skip the item — so it is enforced at the
// real source of truth, never a cosmetic flag:
//   · skills/commands/agents/rules → rename the discovered file to `<file>.off` (Claude only loads a skill
//     when SKILL.md exists; an agent/command/rule when its .md exists). Reversible, backed up on the way in.
//   · mcp     → park the server config in `_disabledMcpServers` in ~/.claude.json (out of `mcpServers` = off).
//   · plugins → the native `enabledPlugins` boolean in settings.json.
//   · hooks   → move the matcher entry between `settings.hooks[event]` and `settings._disabledHooks[event]`.
const OFF = '.off'
function customizeRes(kind) { // skills/commands/agents
  const out = []
  for (const { scope, dir } of KINDS[kind].dirs()) {
    if (!fs.existsSync(dir)) continue
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      let name, enabled, file
      if (KINDS[kind].nested) {
        if (!e.isDirectory()) continue
        name = e.name
        const live = path.join(dir, name, 'SKILL.md')
        if (fs.existsSync(live)) { enabled = true; file = live }
        else if (fs.existsSync(live + OFF)) { enabled = false; file = live + OFF }
        else continue
      } else {
        if (e.name.endsWith('.md' + OFF)) { name = e.name.slice(0, -(3 + OFF.length)); enabled = false; file = path.join(dir, e.name) }
        else if (e.name.endsWith('.md')) { name = e.name.slice(0, -3); enabled = true; file = path.join(dir, e.name) }
        else continue
      }
      const { fm } = parseFM(fs.readFileSync(file, 'utf8'))
      out.push({ kind, name, scope, group: scope, enabled, description: String(fm.description || ''), tokens: tokens(fs.readFileSync(file, 'utf8')), path: file, status: enabled ? 'on' : 'off' })
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
app.get('/api/customize', (req, res) => { try { res.json(customizeAll()) } catch (e) { res.status(500).json({ error: e.message }) } })

// toggle one item on/off at its real source of truth. { kind, scope, name, enable, ref }
app.post('/api/customize/toggle', (req, res) => {
  try {
    const { kind, scope, name, enable, ref } = req.body
    if (kind === 'skills' || kind === 'commands' || kind === 'agents') {
      const dir = scopeDir(kind, scope)
      const live = safe(KINDS[kind].nested ? path.join(dir, name, 'SKILL.md') : path.join(dir, name + '.md'))
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

function overviewItems() {
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
  return items
}
app.get('/api/overview', (req, res) => res.json({ items: overviewItems() }))

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
    if (!rec || rec.v !== 2 || rec.mtime !== st.mtimeMs || rec.size !== st.size) {
      // v2: also keeps cwd + gitBranch + per-file $ / token / span totals (session ledger + /api/roi)
      rec = { v: 2, mtime: st.mtimeMs, size: st.size, entries: [], lines: [], tools: {}, out: 0, msgs: 0, toolCalls: 0, in: 0, cc: 0, cr: 0, cost: 0, first: 0, last: 0, cwd: '', branches: {} }
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
              const t = Date.parse(j.timestamp)
              const e = { t, model, proj, in: u.input_tokens || 0, out: u.output_tokens || 0, cc: u.cache_creation_input_tokens || 0, cr: u.cache_read_input_tokens || 0, tc }
              rec.entries.push(e)
              rec.out += e.out; rec.in += e.in; rec.cc += e.cc; rec.cr += e.cr; rec.msgs++; rec.toolCalls += tc
              rec.cost += entryCost(e)
              rec.first ||= t; rec.last = Math.max(rec.last, t)
              if (j.cwd) rec.cwd = j.cwd
              const br = j.gitBranch || ''
              const b = (rec.branches[br] ||= { cost: 0, out: 0, msgs: 0, first: 0, last: 0, cwd: j.cwd || '' })
              b.cost += entryCost(e); b.out += e.out; b.msgs++; b.first ||= t; b.last = Math.max(b.last, t)
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
    all.files.push({
      path: f, proj, isAgent: f.includes('subagents'), mtime: st.mtimeMs, out: rec.out, msgs: rec.msgs, toolCalls: rec.toolCalls,
      in: rec.in, cc: rec.cc, cr: rec.cr, cost: rec.cost, first: rec.first, last: rec.last, cwd: rec.cwd, branches: rec.branches,
      entries: rec.entries,
    })
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
    .map(f => ({ sessionId: path.basename(f.path, '.jsonl'), proj: projNames[f.proj] || f.proj.split('-').pop(), mtime: f.mtime, out: f.out, msgs: f.msgs, toolCalls: f.toolCalls }))
  const tools = Object.entries(toolTotals).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([name, count]) => ({ name, count }))
  const hiddenPerTurn = HARNESS_DEFAULTS.context.alwaysLoadedBudget.systemPrompt + HARNESS_DEFAULTS.context.alwaysLoadedBudget.toolDefs
  // cache TTL waste + daily anomalies + month-end projection — all pure trend reads over `entries`
  const { map: cacheMap, sortedDates: cacheDates } = buildDailyCacheMap(entries)
  const rollingEff = rollingCacheEfficiency(cacheMap, cacheDates)
  const waste = cacheWasteCost(entries, PRICE_PER_M, rollingEff.bestEffPct / 100)
  const { map: usageMap, sortedDates: usageDates } = buildDailyUsage(entries, entryCost)
  const anomalies = detectDailyAnomalies(usageMap, usageDates)
  const dailyCostMap = {}; for (const d of usageDates) dailyCostMap[d] = usageMap[d].cost
  const budget = Number(req.query.budget) || null
  const projection = projectMonthEnd(dailyCostMap, dayOf(now), budget)
  res.json({
    perModel, activeBlock: active, totalMsgs: entries.length, since: entries[0]?.t || null,
    daily: series, streak, activeDays: days.length, tools, recentSessions,
    health: computeUsageHealth(entries, entryCost, hiddenPerTurn, now),
    regression: computeRegression(entries, now),
    cacheTtl: { ...rollingEff, ...waste },
    anomalies: anomalies.slice(0, 20),
    costProjection: projection,
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
// Force execution plans into a machine-parseable DAG so the dashboard can render them (see src/PlanGraph.jsx).
const PLAN_SCHEMA_RULE = `When asked to create an execution plan, you MUST output a JSON array inside a \`\`\`json code block — not a markdown list. Every element uses exactly this schema:
{"step_id": 1, "description": "short action", "dependencies": [], "expected_skill": [], "active_rules": [], "mcp_server": null, "tool_to_call": "Edit", "expected_params": {"name": "value or 'TBD based on step N'"}}
dependencies is an array of step_ids that must finish first. Use null/[] where a field does not apply. This rule applies only when an execution plan is requested; answer normally otherwise.`
function chatBroadcast(chat, ev) {
  chat.events.push(ev)
  const line = `data: ${JSON.stringify(ev)}\n\n`
  for (const l of chat.listeners) l.write(line)
}
// past conversation history from the on-disk transcript (resumed CLI sessions emit nothing until the first new message)
const readTranscript = (file, parentId) => {
  const out = []
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      try {
        const j = JSON.parse(line)
        if ((j.type !== 'user' && j.type !== 'assistant') || j.isMeta || !j.message) continue
        if (typeof j.message.content === 'string' && j.message.content.startsWith('<')) continue
        out.push({ type: j.type, message: j.message, parent_tool_use_id: parentId || j.parent_tool_use_id || null, toolUseResult: j.toolUseResult, timestamp: j.timestamp })
      } catch {}
    }
  } catch {}
  return out
}
function historyEvents(cwd, sessionId) {
  const dir = path.join(CLAUDE, 'projects', mangle(cwd))
  const main = readTranscript(path.join(dir, sessionId + '.jsonl')).slice(-200)
  // stitch in subagent transcripts (stored under <sessionId>/subagents/, linked by meta.toolUseId)
  // so resumed sessions show what each subagent actually did, nested under its Task node
  const taskIds = new Set()
  for (const e of main) if (e.type === 'assistant' && Array.isArray(e.message?.content))
    for (const c of e.message.content) if (c.type === 'tool_use' && (c.name === 'Task' || c.name === 'Agent')) taskIds.add(c.id)
  try {
    const subDir = path.join(dir, sessionId, 'subagents')
    for (const meta of fs.readdirSync(subDir).filter(f => f.endsWith('.meta.json'))) {
      let link; try { link = JSON.parse(fs.readFileSync(path.join(subDir, meta), 'utf8')) } catch { continue }
      if (!taskIds.has(link.toolUseId)) continue // only stitch children whose Task node is in view
      main.push(...readTranscript(path.join(subDir, meta.replace('.meta.json', '.jsonl')), link.toolUseId))
    }
  } catch {}
  return main
}
app.post('/api/chat', (req, res) => {
  const { cwd, resume, model } = req.body
  if (!cwd || !fs.existsSync(cwd)) return res.status(400).json({ error: 'cwd does not exist' })
  if (resume) {
    const existing = [...chats.entries()].find(([, c]) => c.alive && c.cwd === cwd && c.resume === resume)
    if (existing) return res.json({ id: existing[0] })
  }
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--append-system-prompt', PLAN_SCHEMA_RULE]
  if (resume) args.push('--resume', resume)
  if (model) args.push('--model', model)
  const child = spawn('claude', args, { cwd, env: process.env, shell: WIN }) // shell resolves claude.cmd on Windows
  const id = Math.random().toString(36).slice(2, 10)
  const chat = { child, cwd, resume: resume || null, model: model || null, sessionId: resume || null, alive: true, events: resume ? historyEvents(cwd, resume) : [], listeners: new Set() }
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
  res.json([...chats.entries()].map(([id, c]) => ({ id, cwd: c.cwd, sessionId: c.sessionId, model: c.model, alive: c.alive, events: c.events.length }))))
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
  const content = (req.body.images || []).slice(0, 20).map(i => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } }))
  content.push({ type: 'text', text: req.body.text })
  chatBroadcast(chat, { type: 'user', message: { role: 'user', content } }) // echo the CLEAN text to viewers
  // L1 grounding: prepend top curated-memory hits to the MODEL's copy only, and ask it to cite them.
  // Guarded: never fails the turn; curated memory only (self-authored, high-signal); off if no hits.
  let modelContent = content
  try {
    const hits = req.body.text ? retrieveContext(req.body.text, mangle(chat.cwd)) : []
    if (hits.length) {
      const block = '[grounded context from your curated memory — cite as [memory:<name>] when you use a fact, and say if none apply]\n'
        + hits.map(h => `- ${h.name}: ${h.excerpt}`).join('\n')
      modelContent = [{ type: 'text', text: block }, ...content]
    }
  } catch {}
  chat.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: modelContent } }) + '\n')
  res.json({ ok: true })
})
// autocomplete for the chat input: "/" = slash commands+skills (global + chat project), "@" = project files
app.get('/api/chat/complete', (req, res) => {
  const cwd = req.query.cwd && fs.existsSync(req.query.cwd) ? req.query.cwd : HOME
  const q = String(req.query.q || '').toLowerCase()
  if (req.query.kind === 'files') {
    const qRaw = String(req.query.q || '')
    const r = spawnSync('git', ['-C', cwd, 'ls-files', '-co', '--exclude-standard'], { timeout: 5000, maxBuffer: 16 * 1024 * 1024 }) // tracked + untracked-not-ignored
    if (r.status === 0 && r.stdout.toString().trim()) {
      const files = r.stdout.toString().split('\n').filter(Boolean)
      const dirs = new Set()
      for (const f of files) { let d = path.dirname(f); while (d && d !== '.' && d !== '/') { dirs.add(d + '/'); d = path.dirname(d) } }
      const match = [...dirs, ...files].filter(f => f.toLowerCase().includes(q))
      match.sort((a, b) => (b.endsWith('/') - a.endsWith('/')) || a.localeCompare(b)) // folders first
      return res.json(match.slice(0, 25).map(f => ({ name: f })))
    }
    // not a repo — browse by typed path segment so folders drill down (@dashboard/src/…)
    const slash = qRaw.lastIndexOf('/')
    const dirPart = slash >= 0 ? qRaw.slice(0, slash + 1) : ''
    const namePart = qRaw.slice(slash + 1).toLowerCase()
    let out = []
    try {
      out = fs.readdirSync(path.join(cwd, dirPart), { withFileTypes: true })
        .filter(d => d.name !== 'node_modules' && d.name !== '.git' && d.name.toLowerCase().includes(namePart))
        .map(d => ({ name: dirPart + d.name + (d.isDirectory() ? '/' : '') }))
    } catch {}
    out.sort((a, b) => (b.name.endsWith('/') - a.name.endsWith('/')) || a.name.localeCompare(b.name))
    return res.json(out.slice(0, 25))
  }
  const out = []
  const desc = p => { try { return (/^description:\s*["']?(.+?)["']?\s*$/m.exec(fs.readFileSync(p, 'utf8').slice(0, 2000)) || [])[1] || '' } catch { return '' } }
  const scanCmds = (dir, scope) => { try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) out.push({ name: f.replace(/\.md$/, ''), scope, desc: desc(path.join(dir, f)) }) } catch {} }
  const scanSkills = (dir, scope) => { try { for (const d of fs.readdirSync(dir)) { const p = path.join(dir, d, 'SKILL.md'); if (fs.existsSync(p)) out.push({ name: d, scope: scope + ' skill', desc: desc(p) }) } } catch {} }
  scanCmds(path.join(CLAUDE, 'commands'), 'user'); scanCmds(path.join(cwd, '.claude', 'commands'), 'project')
  scanSkills(path.join(CLAUDE, 'skills'), 'user'); scanSkills(path.join(cwd, '.claude', 'skills'), 'project')
  res.json(out.filter(c => c.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25))
})
// non-image attachments (video, pdf, csv, …): saved to disk, referenced in the message as @path
app.post('/api/chat/upload', express.raw({ type: '*/*', limit: '300mb' }), (req, res) => {
  const name = path.basename(String(req.query.name || 'file')).replace(/[^\w.-]/g, '_')
  if (!req.body?.length) return res.status(400).json({ error: 'empty upload' })
  const dir = path.join(CLAUDE, 'chat-uploads')
  fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, Date.now().toString(36) + '-' + name)
  fs.writeFileSync(p, req.body)
  res.json({ path: p })
})
app.delete('/api/chat/:id', (req, res) => {
  const chat = chats.get(req.params.id)
  if (chat) { try { chat.child.kill() } catch {}; chats.delete(req.params.id) }
  res.json({ ok: true })
})

// ---------- quick actions: one-shot `claude -p "/cmd"` runs against a chosen project ----------
// Reuses the chats map + /api/chat/:id/events SSE for streaming; a run is just a chat that
// exits after one result. Analysis is derived from the run's own stream-json events.
function analyzeRun(events) {
  const a = { tools: {}, files: new Set(), skills: new Set(), mcp: new Set(), agents: new Set(), cost: null, durationMs: null, turns: null, tokens: null }
  for (const ev of events) {
    if (ev.type === 'result') { a.cost = ev.total_cost_usd ?? a.cost; a.durationMs = ev.duration_ms ?? a.durationMs; a.turns = ev.num_turns ?? a.turns; a.tokens = ev.usage || a.tokens }
    if (ev.type !== 'assistant' || !Array.isArray(ev.message?.content)) continue
    for (const c of ev.message.content) {
      if (c.type !== 'tool_use') continue
      a.tools[c.name] = (a.tools[c.name] || 0) + 1
      if (c.name.startsWith('mcp__')) a.mcp.add(c.name.split('__')[1])
      if (c.name === 'Skill' && c.input?.skill) a.skills.add(c.input.skill)
      if ((c.name === 'Task' || c.name === 'Agent') && c.input?.subagent_type) a.agents.add(c.input.subagent_type)
      if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(c.name) && c.input?.file_path) a.files.add(c.input.file_path)
    }
  }
  return { ...a, files: [...a.files], skills: [...a.skills], mcp: [...a.mcp], agents: [...a.agents] }
}
app.post('/api/actions/run', (req, res) => {
  const { cmd, cwd, args, runner } = req.body
  const isCursor = runner === 'cursor'
  if (!cmd || (!isCursor && !String(cmd).startsWith('/'))) return res.status(400).json({ error: isCursor ? 'prompt required' : 'cmd must be a /slash-command' })
  if (!cwd || !fs.existsSync(cwd)) return res.status(400).json({ error: 'cwd does not exist' })
  if ([...chats.values()].filter(c => c.alive && c.action).length >= 3) return res.status(429).json({ error: 'max 3 concurrent action runs' }) // ponytail: global cap
  const prompt = args ? `${cmd} ${args}` : cmd
  const child = isCursor
    ? spawn('cursor-agent', ['-p', prompt, '--output-format', 'stream-json', '-f'], { cwd, env: process.env, shell: WIN })
    : spawn('claude', ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'], { cwd, env: process.env, shell: WIN })
  const id = Math.random().toString(36).slice(2, 10)
  const chat = { child, cwd, sessionId: null, alive: true, events: [], listeners: new Set(), action: { cmd, args: args || '', runner: runner || 'claude', startedAt: Date.now() } }
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
  const finish = code => {
    if (!chat.alive) return
    chat.alive = false
    chat.action.endedAt = Date.now()
    chat.action.exitCode = code
    chat.analysis = analyzeRun(chat.events)
    chatBroadcast(chat, { type: 'closed', code })
  }
  child.on('error', e => { chatBroadcast(chat, { type: 'stderr', text: e.message }); finish(-1) })
  child.on('exit', finish)
  res.json({ id })
})
app.get('/api/actions', (req, res) =>
  res.json([...chats.entries()].filter(([, c]) => c.action).map(([id, c]) => ({
    id, cwd: c.cwd, alive: c.alive, sessionId: c.sessionId, ...c.action, analysis: c.analysis || null,
  })).sort((a, b) => b.startedAt - a.startedAt)))
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
    if (!rec || rec.v !== 2 || rec.mtime !== st.mtimeMs || rec.size !== st.size) {
      // v2 (item 9 — session forensics): the walker already had the tool_use→name map, the is_error detector
      // and the compaction counter; it threw the error TEXT and the result SIZE away. Same loop, now it keeps both.
      rec = {
        v: 2, mtime: st.mtimeMs, size: st.size, proj: path.relative(base, f).split(path.sep)[0],
        sessionId: path.basename(f, '.jsonl'), file: f,
        toolErrs: {}, toolUses: {}, byHour: {}, turns: 0, compactions: 0, retries: 0, last: 0,
        errs: [], bytes: {}, sizes: {}, big: [],
      }
      const idName = {}
      let lastErrTool = null
      const RESULT_TEXT = c => (typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map(x => x?.text || (typeof x === 'string' ? x : '')).join('\n') : c.content ? JSON.stringify(c.content) : '')
      try {
        for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
          if (!line) continue
          const isErr = line.includes('"is_error":true')
          if (!isErr && !line.includes('"tool_use"') && !line.includes('tool_result') && !line.includes('isCompactSummary') && !line.includes('"type":"summary"')) continue
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
              for (const c of j.message.content) {
                if (c.type !== 'tool_result') continue
                const name = idName[c.tool_use_id] || '?'
                const chars = RESULT_TEXT(c).length
                // (b) context pressure: bytes into context, per tool + the biggest single results
                rec.bytes[name] = (rec.bytes[name] || 0) + chars
                const s = (rec.sizes[name] ||= [])
                if (s.length < 300) s.push(chars) // sample cap — medians only, not a full census
                if (chars >= 20000) {
                  rec.big.push({ tool: name, chars, t })
                  if (rec.big.length > 40) { rec.big.sort((a, b) => b.chars - a.chars); rec.big.length = 20 }
                }
                if (!c.is_error) continue
                rec.toolErrs[name] = (rec.toolErrs[name] || 0) + 1
                lastErrTool = name
                if (t) { const d = new Date(t); const k = d.getDay() + ':' + d.getHours(); rec.byHour[k] = (rec.byHour[k] || 0) + 1 }
                // (a) failure signatures: keep the first 240 chars of the error verbatim + when + how big
                if (rec.errs.length < 400) rec.errs.push({ t, tool: name, text: RESULT_TEXT(c).replace(/\s+/g, ' ').trim().slice(0, 240), chars })
              }
          } catch {}
        }
      } catch {}
      rec.big.sort((a, b) => b.chars - a.chars); rec.big.length = Math.min(rec.big.length, 20)
      failCache.set(f, rec)
    }
    out.push(rec)
  }
  return out
}
// normalized failure signature: strip the varying parts (paths, ids, numbers, quotes) so the same bug groups
const errSig = (tool, text) => tool + ': ' + text
  .replace(/\/[\w./~-]+/g, '<path>').replace(/\b[0-9a-f]{8,}\b/gi, '<id>').replace(/\b\d+\b/g, '<n>')
  .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '<str>').replace(/\s+/g, ' ').trim().slice(0, 120)
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
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
function driftFor(project) {
  const meta = readMeta()
  const bFile = meta.baselines?.[project]
  if (!bFile) return { baseline: null, drifts: [] }
  const b = readJson(path.join(LIBRARY_DIR, path.basename(bFile)), null)
  if (!b) return { baseline: bFile, error: 'baseline bundle missing', drifts: [] }
  return { baseline: bFile, provenance: b.provenance, drifts: driftVs(b, project) } // driftVs is shared with the team baseline (item 14)
}
app.get('/api/gov/drift', (req, res) => res.json(driftFor(req.query.project)))
function syncDriftField(project, field) {
  const meta = readMeta()
  const b = readJson(path.join(LIBRARY_DIR, path.basename(meta.baselines?.[project] || '')), null)
  if (!b) throw Object.assign(new Error('no baseline'), { status: 400 })
  if (field === 'settings.harness' || field === 'settings.permissions') {
    const file = path.join(project, '.claude', 'settings.json')
    const s = readJson(file, {})
    const key = field.split('.')[1]
    if (b.settings?.[key] === undefined) delete s[key]; else s[key] = b.settings[key]
    track(file, JSON.stringify(s, null, 2), { scope: project, summary: `sync ${field} from baseline` })
  } else if (field.startsWith('rules/')) {
    const rel = field.slice(6)
    if (b.rules?.[rel] != null) track(path.join(project, rel), b.rules[rel], { scope: project, summary: `sync ${rel} from baseline` })
  } else throw Object.assign(new Error('field not syncable'), { status: 400 })
}
app.post('/api/gov/drift/sync', (req, res) => {
  syncDriftField(req.body.project, req.body.field)
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
  if (project && fs.existsSync(project)) {
    try { // 29: design drift feeds recommendations
      const dd = designDrift(project)
      if (dd.manifest && dd.drifts.length) recs.push({ key: 'design-drift:' + project, severity: 'warning', text: `${dd.drifts.length} design-system drift(s) vs the Figma manifest (${dd.drifts.slice(0, 3).map(d => d.component).join(', ')}…) — see Quality → Design drift`, fix: dd.manifest })
    } catch {}
    try { // 30: recurring review findings → suggest a hook
      for (const rc of reviewData(project).recurring.slice(0, 3))
        recs.push({ key: 'recurring-finding:' + rc.category, severity: 'warning', text: `"${rc.category}" flagged in ${rc.passes} separate reviews (${rc.count} findings) — add a PreToolUse hook to block the pattern automatically (Hooks → Library)`, fix: null })
    } catch {}
  }
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
// The template bakes in the four behaviours that scored highest on the Prompt Quality rubric — plan-first,
// explicit output/format expectations, behavioural (not code-level) acceptance criteria, and concrete
// anchors instead of "shared memory". So even a one-line goal assembles into a ≥9/10-structured prompt.
// scorePrompt() below grades the same structure, so the badge the Studio shows is honest, not cosmetic.
const PLAN_FIRST = {
  implementation: '## Plan first\nBefore editing, outline your approach and the exact files you will touch, then pause for my confirmation. If two approaches are viable, give the tradeoffs and let me pick.',
  bugfix: '## Plan first\nReproduce and state the root cause before changing code. Outline the fix and the files it touches, then pause for my confirmation.',
  research: '## Scope first\nRestate the question in your own words and list what you will check, then proceed.',
  review: '## Scope first\nList what you will evaluate (correctness, security, performance, style) before diving in.',
}
const OUTPUT_EXPECT = {
  implementation: '## Output expectations\n- State what changed and why in ≤5 lines, then the files touched.\n- Call out anything deliberately skipped and when to revisit it.',
  bugfix: '## Output expectations\n- One line: the root cause. Then the fix, and how you verified it (the failing case now passing).',
  research: '## Output expectations\n- Answer first in 2-3 sentences, then the evidence with source links.\n- Flag uncertainty and what you could not verify.',
  review: '## Output expectations\n- Lead with the verdict, then findings by severity (blocker / nit), each with file:line and a concrete suggestion.',
}
const AC_DEFAULT = {
  implementation: ['- The described behaviour is observable end to end (state the exact user-visible outcome)', '- No regressions in existing behaviour', '- Edge and error states are handled, not just the happy path'],
  bugfix: ['- The reported failing case now passes', '- The root cause is fixed, not just the symptom', '- No regression in adjacent behaviour'],
  research: ['- The question is answered directly, with evidence', '- Trade-offs and unknowns are stated, not hidden', '- Sources are cited and checkable'],
  review: ['- Every finding names a concrete location and a fix', '- Severity is assigned honestly', '- Nothing critical is left unmentioned'],
}
const PLACEHOLDER_GOAL = '(describe the goal)'

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
  const lines = [`# ${p.title || H}`, '', `## Goal`, texts[0] || PLACEHOLDER_GOAL, '']
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
  lines.push(PLAN_FIRST[tpl] || PLAN_FIRST.implementation, '')
  lines.push(OUTPUT_EXPECT[tpl] || OUTPUT_EXPECT.implementation, '')
  lines.push('## Constraints', `${tone || 'Follow the project rules (CLAUDE.md).'} Reference files by concrete path, not by memory of earlier chats.`, '')
  lines.push('## Acceptance criteria', ...(p.acceptance ? p.acceptance.split('\n').filter(Boolean).map(l => l.startsWith('-') ? l : '- ' + l) : (AC_DEFAULT[tpl] || AC_DEFAULT.implementation)))
  return lines.join('\n')
}

// Grades the assembled prompt on the rubric the template is built around. Floor is 9 once there is a
// real goal, because the four structural sections are always present; the rest is input-richness bonus.
function scorePrompt(p, output) {
  const tpl = p.template || 'implementation'
  const texts = (p.inputs || []).filter(i => i.type === 'text').map(i => i.value)
  const goalReal = !!texts[0] && texts[0].trim().length >= 12 && texts[0].trim() !== PLACEHOLDER_GOAL
  const anchors = (p.inputs || []).some(i => ['file', 'artifact', 'url', 'image'].includes(i.type))
  const context = texts.length > 1
  const customAC = !!(p.acceptance && p.acceptance.trim())
  const b = [
    ['Clear goal', goalReal ? 3 : 0, 3],
    ['Plan-first / scope-first', output.includes('## Plan first') || output.includes('## Scope first') ? 1.5 : 0, 1.5],
    ['Output expectations up front', output.includes('## Output expectations') ? 1.5 : 0, 1.5],
    ['Behavioural acceptance criteria', output.includes('## Acceptance criteria') ? 1.5 : 0, 1.5],
    ['Constraints stated', output.includes('## Constraints') ? 1.5 : 0, 1.5],
    ['Context provided', context ? 0.4 : 0, 0.4],
    ['Concrete file/URL anchors', anchors ? 0.4 : 0, 0.4],
    ['Own acceptance criteria', customAC ? 0.2 : 0, 0.2],
  ]
  const raw = b.reduce((s, x) => s + x[1], 0)
  const score = Math.min(10, +raw.toFixed(1))
  const gaps = b.filter(x => x[1] === 0).map(x => x[0])
  return { score, breakdown: b.map(([label, got, max]) => ({ label, got, max })), gaps, needsGoal: !goalReal }
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
  const quality = scorePrompt(b, output)
  const versions = existing?.versions || []
  if (existing?.output && existing.output !== output) versions.push({ ts: existing.updatedAt, output: existing.output, tone: existing.tone, template: existing.template })
  const doc = { id, title: b.title || 'untitled prompt', tags: b.tags || [], project: b.project || null, inputs: b.inputs || [], template: b.template || 'implementation', tone: b.tone || 'direct', acceptance: b.acceptance || '', output, quality, versions: versions.slice(-20), updatedAt: Date.now(), author: AUTHOR }
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

// ================= flow graph, chat insights, inbox, palette, scaffold, batch, pins, bundles =================

// ---------- transcript prompt/invocation scan (per-file mtime cache, like usageCache) ----------
const scanCache = new Map() // file -> {mtime,size,prompts,invocations,userMsgs,toolCalls,first,last}
function scanTranscripts() {
  const base = path.join(CLAUDE, 'projects')
  const files = []
  const walkS = d => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkS(p); else if (e.name.endsWith('.jsonl')) files.push(p) } } catch {} }
  walkS(base)
  const all = { prompts: [], invocations: [], sessions: [], hooks: {}, hookBlocks: 0, reviews: [], hookEvents: [], edits: [], cmds: [], texts: [] }
  const HOOK_RE = /(PreToolUse|PostToolUse|UserPromptSubmit|SessionStart|SessionEnd|Stop|SubagentStop|PreCompact|Notification)(?::[\w./ -]+)? hook/
  const PATH_KEYS = ['file_path', 'path', 'notebook_path', 'filePath']
  for (const f of files) {
    let st; try { st = fs.statSync(f) } catch { continue }
    const proj = path.relative(base, f).split(path.sep)[0]
    const sessionId = path.basename(f, '.jsonl')
    let rec = scanCache.get(f)
    if (!rec || rec.v !== 3 || rec.mtime !== st.mtimeMs || rec.size !== st.size) {
      // v3 (items 9c + 16): same single walk now also keeps structured hook attachments, assistant text,
      // tool_use inputs (paths touched, bash commands) and Edit structuredPatch hunks — the search index.
      rec = {
        v: 3, mtime: st.mtimeMs, size: st.size, prompts: [], invocations: [], reviews: [], hooks: {}, hookBlocks: 0,
        userMsgs: 0, toolCalls: 0, first: 0, last: 0, cwd: '', branch: '',
        hookEvents: [], edits: [], cmds: [], texts: [], files: [],
      }
      const touched = new Set()
      // ponytail: "src" attribution = last Skill invoked since the user's prompt — a heuristic, not a real call graph
      let lastSkill = null
      try {
        for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
          if (!line) continue
          if (line.includes(' hook')) { // hook firings show up as system/hook-context lines
            const m = HOOK_RE.exec(line)
            if (m) rec.hooks[m[1]] = (rec.hooks[m[1]] || 0) + 1
            if (/hook (denied|blocked)/.test(line)) rec.hookBlocks++
          }
          let j; try { j = JSON.parse(line) } catch { continue }
          const t = j.timestamp ? Date.parse(j.timestamp) : 0
          if (t) { rec.first ||= t; rec.last = Math.max(rec.last, t) }
          if (j.cwd) rec.cwd = j.cwd
          if (j.gitBranch) rec.branch = j.gitBranch
          // hook blast radius: hooks are logged as attachments carrying name/event/exitCode/durationMs/stdout
          const at = j.attachment
          if (at && typeof at.type === 'string' && at.type.startsWith('hook_') && at.hookName) {
            const std = String(at.stdout || '') + String(at.content || '')
            const blocked = at.exitCode === 2 || at.type === 'hook_blocked' || /"permissionDecision"\s*:\s*"(deny|ask)"|"decision"\s*:\s*"block"/.test(std)
            const reason = blocked ? (/"(?:permissionDecisionReason|reason)"\s*:\s*"((?:[^"\\]|\\.){0,200})"/.exec(std)?.[1] || String(at.stderr || '').trim() || '').slice(0, 200) : ''
            const hookEv = {
              t, hook: at.hookName, event: at.hookEvent || at.hookName.split(':')[0],
              tool: at.hookName.includes(':') ? at.hookName.split(':').slice(1).join(':') : null,
              ms: typeof at.durationMs === 'number' ? at.durationMs : null,
              exit: typeof at.exitCode === 'number' ? at.exitCode : null,
              blocked, reason, cancelled: at.type === 'hook_cancelled',
            }
            if (rec.hookEvents.length < 800) rec.hookEvents.push(hookEv)
            if (blocked) rec.hookBlocks++
          }
          // Edit/Write structuredPatch hunks — searchable diff text, and the "files edited" index
          const tur = j.toolUseResult
          if (tur && typeof tur === 'object' && Array.isArray(tur.structuredPatch) && tur.filePath) {
            touched.add(tur.filePath)
            let add = 0, del = 0
            const hunk = []
            for (const h of tur.structuredPatch) for (const l of h.lines || []) {
              if (l[0] === '+') add++; else if (l[0] === '-') del++
              if (hunk.length < 24) hunk.push(l)
            }
            if (rec.edits.length < 400) rec.edits.push({ t, file: tur.filePath, add, del, hunk: hunk.join('\n').slice(0, 600) })
          }
          if (j.type === 'user' && !j.isMeta && j.message) {
            const c = j.message.content
            const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join(' ') : ''
            if (text.trim() && !text.startsWith('<') && !text.startsWith('[Request interrupted')) { rec.prompts.push({ t, text: text.slice(0, 500) }); rec.userMsgs++; lastSkill = null }
          } else if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
            for (const c of j.message.content) {
              if (c.type === 'text' && c.text?.trim() && rec.texts.length < 400) { rec.texts.push({ t, text: c.text.replace(/\s+/g, ' ').trim().slice(0, 400) }); continue }
              if (c.type !== 'tool_use') continue
              rec.toolCalls++
              if (c.input && typeof c.input === 'object') {
                for (const k of PATH_KEYS) if (typeof c.input[k] === 'string' && c.input[k].startsWith('/')) touched.add(c.input[k])
                if (c.name === 'Bash' && typeof c.input.command === 'string' && rec.cmds.length < 400)
                  rec.cmds.push({ t, cmd: c.input.command.replace(/\s+/g, ' ').trim().slice(0, 240) })
              }
              if (c.name === 'Skill' && c.input?.skill) { rec.invocations.push({ t, kind: 'skill', name: String(c.input.skill), src: lastSkill }); lastSkill = 'skill:' + c.input.skill }
              else if ((c.name === 'Task' || c.name === 'Agent') && c.input?.subagent_type) rec.invocations.push({ t, kind: 'agent', name: String(c.input.subagent_type), src: lastSkill })
              else if (c.name.startsWith('mcp__')) rec.invocations.push({ t, kind: 'mcp', name: c.name.slice(5).split('__')[0], src: lastSkill })
              // native /review & /security-review report through the ReportFindings tool
              else if (c.name === 'ReportFindings' && Array.isArray(c.input?.findings)) rec.reviews.push({
                t, level: c.input.level || null,
                findings: c.input.findings.slice(0, 32).map(x => ({ file: x.file, line: x.line, summary: String(x.summary || '').slice(0, 240), category: x.category || 'uncategorized', verdict: x.verdict || null, outcome: x.outcome || null })),
              })
            }
          }
        }
      } catch {}
      rec.files = [...touched].slice(0, 500)
      scanCache.set(f, rec)
    }
    for (const p of rec.prompts) all.prompts.push({ ...p, proj, sessionId })
    for (const i of rec.invocations) all.invocations.push({ ...i, proj, sessionId })
    for (const r of rec.reviews) all.reviews.push({ ...r, proj, sessionId, isAgent: f.includes('subagents') })
    for (const [ev, n] of Object.entries(rec.hooks)) all.hooks[ev] = (all.hooks[ev] || 0) + n
    all.hookBlocks += rec.hookBlocks
    for (const h of rec.hookEvents) all.hookEvents.push({ ...h, proj, sessionId })
    for (const e of rec.edits) all.edits.push({ ...e, proj, sessionId })
    for (const c of rec.cmds) all.cmds.push({ ...c, proj, sessionId })
    for (const x of rec.texts) all.texts.push({ ...x, proj, sessionId })
    all.sessions.push({ proj, sessionId, userMsgs: rec.userMsgs, toolCalls: rec.toolCalls, first: rec.first, last: rec.last, isAgent: f.includes('subagents'), cwd: rec.cwd, branch: rec.branch, files: rec.files })
  }
  all.prompts.sort((a, b) => a.t - b.t)
  return all
}

// ---------- 13: skills & agents flow graph ----------
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
  // defined edges: an item's body mentions another item's name (or its mcp__ prefix)
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
  // observed edges: real invocations from transcripts, weighted by frequency
  const { invocations } = scanTranscripts()
  const projFilter = project ? mangle(project) : null
  const observed = new Map(), nodeUse = {}
  for (const inv of invocations) {
    if (projFilter && inv.proj !== projFilter) continue
    const to = nid(inv.kind, inv.name)
    if (!seen.has(to)) addNode(inv.kind, inv.name, { ghost: true }) // used in sessions but not defined in this scope (plugin skills etc.)
    const from = inv.src && seen.has(inv.src) ? inv.src : 'entry:prompt'
    const k = from + '→' + to
    const e = observed.get(k) || { from, to, count: 0, last: 0 }
    e.count++; e.last = Math.max(e.last, inv.t); observed.set(k, e)
    const u = nodeUse[to] ||= { count: 0, last: 0 }; u.count++; u.last = Math.max(u.last, inv.t)
  }
  for (const n of nodes) Object.assign(n, nodeUse[n.id] || { count: 0, last: null })
  // dead ends: defined but never observed; cycles: DFS over defined edges
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
  // most-traveled path: greedy walk over observed counts from the entry
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
const normPrompt = s => s.toLowerCase().replace(/\s+/g, ' ').trim()
const tokset = s => new Set(normPrompt(s).split(' ').filter(w => w.length > 2))
const jaccard = (a, b) => { let i = 0; for (const w of a) if (b.has(w)) i++; return i / (a.size + b.size - i || 1) }
app.get('/api/dupes', (req, res) => {
  const days = Number(req.query.days) || 90
  const sim = Math.min(1, Math.max(0.3, Number(req.query.sim) || 0.75))
  const projFilter = req.query.project ? mangle(req.query.project) : null
  const cutoff = Date.now() - days * 86400_000
  const { prompts } = scanTranscripts()
  // slash-commands are already reusable artifacts — exclude them
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
  // correction rate: a prompt re-phrasing the previous one in the same session within 3 minutes
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
// Indexes prompts + assistant text + tool_use inputs (bash commands, files touched) + Edit hunks.
// `?file=<substr>` is the killer filter: only sessions that EDITED (or touched) that path.
// Plane B: self-only. There is deliberately no machine/user parameter and there never will be.
app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').toLowerCase()
  const file = String(req.query.file || '').toLowerCase()
  const kinds = new Set(String(req.query.kind || 'all').split(',').map(s => s.trim()))
  const wants = k => kinds.has('all') || kinds.has(k)
  const limit = Math.min(100, Number(req.query.limit) || 25)
  if (q.length < 3 && !file) return res.json([])
  const { prompts, texts, cmds, edits, sessions } = scanTranscripts()
  const meta = {}   // sessionId -> {cwd, branch, files}
  for (const s of sessions) meta[s.sessionId] = s
  // "only sessions that edited <path>" — the query the IC most wants and cannot express today
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
      if (file && kind === 'edit' && !String(r.file || '').toLowerCase().includes(file)) continue // an edit row must be an edit TO that file
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
  // file-only query (no q): one row per session that touched the path
  if (!q && file)
    for (const s of sessions) {
      const f = (s.files || []).filter(p => p.toLowerCase().includes(file))
      if (!f.length) continue
      hits.push({ kind: 'session', proj: s.proj, sessionId: s.sessionId, t: s.last, snippet: `${f.length} file(s) touched · ${s.userMsgs} prompts`, cwd: s.cwd || null, branch: s.branch || null, files: f.slice(0, 5), resume: s.cwd ? `cd ${s.cwd} && claude --resume ${s.sessionId}` : `claude --resume ${s.sessionId}` })
    }
  res.json(hits.sort((a, b) => b.t - a.t).slice(0, limit))
})

// ---------- plane-A bridge: the eng snapshot (server-eng.mjs OWNS it — we only read it) ----------
// Zero new API calls, zero new auth: server-eng.mjs already caches the JIRA+GitHub aggregate for 2h.
let engMod = null
// at = last SUCCESS (drives ENG_TTL). errAt = last failure/unavailable (drives the short backoff).
// Caching a null under ENG_TTL is the bug that served a crippled inbox for 10 minutes after every restart.
const engSnap = { at: 0, errAt: 0, data: null, p: null }
const ENG_TTL = 10 * 60_000
const ENG_ERR_TTL = 15_000      // failure backoff: seconds, not minutes — a cold start must converge fast
const ENG_COLD_WAIT = 90_000    // first-ever fetch (~65s of live JIRA+GitHub): wait it out rather than serve a 3-item inbox.
                                // All cold callers await the SAME in-flight promise, so this is one fetch, not one per poll.
async function loadEngSnapshot() {
  engMod ||= await import('./server-eng.mjs')
  if (typeof engMod.snapshotAll === 'function') return await engMod.snapshotAll() // in-process, once server-eng exports it
  const r = await fetch(`http://127.0.0.1:${PORT}/api/eng/snapshot?project=all`)   // fallback: its own route, same cache
  return await r.json()
}
// wait=false: don't block on a *refresh* of a snapshot we already have (the inbox polls every 60s — it can wait a poll).
// But a caller with NO snapshot at all is blocked briefly (ENG_COLD_WAIT), because "no data" is not a valid answer.
async function engSnapshot(wait = true) {
  const now = Date.now()
  const stale = !engSnap.data || now - engSnap.at > ENG_TTL
  const backoff = !engSnap.data && now - engSnap.errAt < ENG_ERR_TTL // only successes get the long TTL
  if (!engSnap.p && stale && !backoff)
    engSnap.p = loadEngSnapshot()
      .then(d => { if (d?.available) { engSnap.data = d; engSnap.at = Date.now() } else engSnap.errAt = Date.now(); engSnap.p = null; return engSnap.data })
      .catch(() => { engSnap.errAt = Date.now(); engSnap.p = null; return engSnap.data })
  if (engSnap.data) return engSnap.data // warm: serve it, any refresh finishes in the background
  if (!engSnap.p) return null           // cold + inside the error backoff: next request retries
  if (wait) { try { return await engSnap.p } catch { return null } }
  // cold, no data: wait a bounded while for the in-flight fetch rather than serve a hollow answer
  let t
  try { return await Promise.race([engSnap.p.catch(() => null), new Promise(r => { t = setTimeout(() => r(null), ENG_COLD_WAIT) })]) }
  finally { clearTimeout(t) }
}

// ---------- 1: delivery risk in the inbox (plane A → work items) ----------
// Working days: openDays/inCurrent are ALREADY working days (10:00–18:00 Sun–Thu), so 24 working hours = 3d, 48 = 6d.
const SLA_REVIEW = 3, SLA_REVIEW_HARD = 6
const jiraUrl = i => `https://${i.host}/browse/${i.key}`
const prUrl = p => `https://github.com/${p.repo}/pull/${p.num}`
const d1 = n => (Math.round(n * 10) / 10).toFixed(1)
function workItems(snap) {
  const items = []
  if (!snap?.available) return items
  const W = (key, kind, severity, text, ts, extra) => items.push({ key, kind, severity, text, ts: ts || Date.now(), section: 'delivery', plane: 'work', ...extra })
  for (const p of snap.prs || []) {
    if (p.state === 'Merged' || p.state === 'Closed') continue
    const created = Date.parse(p.createdAt) || Date.now()
    const reviews = (p.reviewEvents || []).length // reviewEvents are already non-bot only (server-eng BOT filter)
    if (!reviews && p.openDays >= SLA_REVIEW)
      W(`pr:noreview:${p.repo}#${p.num}`, 'review', p.openDays >= SLA_REVIEW_HARD ? 'error' : 'warning',
        `PR #${p.num} (${p.ticket}) has had zero reviews for ${d1(p.openDays)} working days — ${p.author} is blocked`, created,
        { link: prUrl(p), owner: p.author, ageWorkDays: p.openDays,
          nudge: `${p.repo} PR #${p.num} "${p.title}" (${p.ticket}) has been waiting ${d1(p.openDays)} working days with no review — ${p.author} is blocked on it. Can someone pick it up today? ${prUrl(p)}` })
    const changesReq = Math.max(0, (p.cycles || 1) - 1)
    if (changesReq >= 2)
      W(`pr:cr:${p.repo}#${p.num}`, 'review', 'warning',
        `PR #${p.num} (${p.ticket}) is on review round ${changesReq + 1} — ${changesReq} changes-requested`, created,
        { link: prUrl(p), owner: p.author, cycles: p.cycles,
          nudge: `${p.repo} PR #${p.num} (${p.ticket}) has had ${changesReq} rounds of changes requested. Worth 10 minutes on a call instead of another round? ${prUrl(p)}` })
  }
  for (const i of snap.issues || []) {
    if (i.live) continue
    const ts = Date.parse(i.curSince) || Date.now()
    const who = i.assignee?.name || 'unassigned'
    if (i.rec?.atRisk)
      W(`tkt:budget:${i.key}`, 'ticket', i.rec.remaining <= -2 ? 'error' : 'warning',
        `${i.key} is ${d1(-i.rec.remaining)} working days past its ${i.status} budget (${i.rec.budget}d) — next: ${i.rec.next}`, ts,
        { link: jiraUrl(i), owner: who, ageWorkDays: i.inCurrent, overBudgetBy: +(-i.rec.remaining).toFixed(2),
          nudge: `${i.key} "${i.summary}" has sat in ${i.status} for ${d1(i.inCurrent)} working days — ${d1(-i.rec.remaining)}d past the ${i.rec.budget}d budget. ${who}, what is blocking the move to ${i.rec.next}? ${jiraUrl(i)}` })
    if (i.qaCycles >= 3)
      W(`tkt:qa:${i.key}`, 'quality', 'warning', `${i.key} has been through QA ${i.qaCycles} times`, ts,
        { link: jiraUrl(i), owner: who, qaCycles: i.qaCycles,
          nudge: `${i.key} "${i.summary}" has bounced through QA ${i.qaCycles} times. Worth a dev+QA pairing pass before the next handoff? ${jiraUrl(i)}` })
    if (i.rework)
      W(`tkt:rework:${i.key}`, 'quality', 'warning', `${i.key} re-entered development after review/QA (rework)`, ts,
        { link: jiraUrl(i), owner: who,
          nudge: `${i.key} "${i.summary}" went backwards into development after review/QA. Worth capturing why in the retro? ${jiraUrl(i)}` })
    if (i.stale)
      W(`tkt:stale:${i.key}`, 'ticket', 'warning', `${i.key} is still "${i.status}" — ${i.staleNote}`, ts,
        { link: jiraUrl(i), owner: who,
          nudge: `${i.key} "${i.summary}" still shows ${i.status} but its PR is merged. ${who}, can you move it? ${jiraUrl(i)}` })
  }
  return items
}

// ---------- 17: attention inbox ----------
// Every item declares its plane: 'work' (JIRA/GitHub/CI artifacts) or 'harness' (this machine's ~/.claude).
async function inboxItems() {
  const items = []
  for (const a of readApprovals()) if (a.status === 'proposed') items.push({ key: 'appr:' + a.id, kind: 'approval', severity: 'warning', text: `pending approval: ${a.summary}`, ts: a.ts, section: 'governance' })
  const { alerts } = costAlerts()
  for (const a of alerts) items.push({ key: 'cost:' + a.text.slice(0, 40), kind: 'budget', severity: a.level, text: a.text, ts: Date.now(), section: 'reliability' })
  for (const r of evalRuns().slice(-10)) if (r.passRate < 1) items.push({ key: 'eval:' + r.id, kind: 'eval', severity: r.passRate === 0 ? 'error' : 'warning', text: `eval run at ${Math.round(r.passRate * 100)}% pass (${r.scope === 'global' ? 'global' : path.basename(r.scope)})`, ts: r.ts, section: 'reliability' })
  for (const [id, c] of chats) {
    if (c.action) { // quick-action runs: completed = info, failed = error
      if (!c.alive) items.push({ key: 'action:' + id, kind: 'action', severity: c.action.exitCode === 0 ? 'info' : 'error', text: `${c.action.cmd} in ${path.basename(c.cwd)} ${c.action.exitCode === 0 ? 'finished' : `failed (exit ${c.action.exitCode})`}${c.analysis?.cost ? ` · $${c.analysis.cost.toFixed(3)}` : ''}`, ts: c.action.endedAt, section: 'workflows' })
      continue
    }
    if (!c.alive) continue
    const lastEv = c.events[c.events.length - 1]
    if (lastEv && lastEv.type === 'result') items.push({ key: 'chat:' + id, kind: 'session', severity: 'info', text: `session in ${path.basename(c.cwd)} is waiting for your input`, ts: Date.now(), section: 'chat' })
  }
  // 34: blocked board tickets are actually stuck (error) — distinct from paused-by-design idle cards (info)
  try {
    for (const t of readBoard().tickets) {
      if (t.blocked) items.push({ key: 'board:blk:' + t.id + ':' + t.blocked.at, kind: 'board', severity: 'error', text: `ticket "${t.title}" blocked by ${t.blocked.by}: ${t.blocked.needed || t.blocked.reason}`.slice(0, 140), ts: t.blocked.at, section: 'board' })
      else if (['code-review', 'ready-for-qa', 'ready-for-release'].includes(t.stage) && !boardRuns.get(t.id)) items.push({ key: 'board:idle:' + t.id + ':' + t.stage, kind: 'board', severity: 'info', text: `ticket "${t.title}" is waiting for your ${t.stage === 'code-review' ? 'review run' : t.stage === 'ready-for-qa' ? 'QA run' : 'release'}`, ts: (t.history || []).slice(-1)[0]?.at || t.createdAt, section: 'board' })
    }
  } catch {}
  try {
    const dismissed = readMeta().recsDismissed || {}
    for (const dir of Object.keys(readClaudeJson().projects || {}).filter(d => d !== HOME && fs.existsSync(d)).slice(0, 8)) {
      const hub = hubResolve(dir)
      for (const f of (hub.findings || []).filter(f => f.severity === 'error').slice(0, 2)) {
        // the same finding text is raised against several projects — the key MUST carry the project or the rows
        // collide (React dup-key) and clearing one clears "both" (inboxDone is keyed by this). legacyKey keeps
        // pre-fix clears/dismissals honoured (old format: 'finding:<text>', no project).
        const legacyKey = 'finding:' + f.text.slice(0, 60)
        const key = `finding:${dir}:${f.text.slice(0, 60)}`
        if (!dismissed[key] && !dismissed[legacyKey]) items.push({ key, legacyKey, kind: 'recommendation', severity: 'error', text: `${path.basename(dir)}: ${f.text}`, ts: Date.now(), section: 'library' })
      }
    }
  } catch {}
  try { // loush runs: failed = error, blocked/awaiting-approval = warning (section: runs)
    for (const r of scanRuns()) {
      if (r.status === 'failed') items.push({ key: 'run:fail:' + r.proj + ':' + r.ticket, kind: 'run', severity: 'error', text: `loush ${r.flow || 'run'} for ${r.ticket} failed (${r.projName})`, ts: r.updatedAt || Date.now(), section: 'workflows' })
      else if (r.awaitingApproval) items.push({ key: 'run:appr:' + r.proj + ':' + r.ticket, kind: 'run', severity: 'warning', text: `loush ${r.flow || 'run'} for ${r.ticket} awaits approval (${r.projName})`, ts: r.updatedAt || Date.now(), section: 'workflows' })
      else if (r.status === 'blocked') items.push({ key: 'run:blk:' + r.proj + ':' + r.ticket, kind: 'run', severity: 'warning', text: `loush ${r.flow || 'run'} for ${r.ticket} is blocked (${r.projName})`, ts: r.updatedAt || Date.now(), section: 'workflows' })
    }
  } catch {}
  try { items.push(...schedulerInbox(CLAUDE)) } catch {} // Gap B: scheduled-job results (info-only, self-only)
  // L1: nudge (never auto-install) the two default safety hooks if absent. Global config is the user's
  // to change — surface it, they click install in Hooks. Match on a distinctive message fragment so
  // JSON-escaping of the command string doesn't matter.
  try {
    const MARK = { 'block-prod-file-edit': 'protected path', 'secret-scan-pre-write': 'looks like a secret' }
    const userHooks = JSON.stringify(readJson(SETTINGS_FILES.user, {}).hooks || {})
    const missing = Object.entries(MARK).filter(([, m]) => !userHooks.includes(m)).map(([n]) => n)
    if (missing.length && !(readMeta().inboxDone || {})['hooks:safety'])
      items.push({ key: 'hooks:safety', kind: 'recommendation', severity: 'info', section: 'hooks', text: `${missing.length} recommended safety hook${missing.length === 1 ? '' : 's'} not installed (${missing.join(', ')}) — install from Hooks` })
  } catch {}
  for (const i of items) i.plane ||= 'harness' // everything above is this machine's own harness telemetry
  // plane A: delivery risk (JIRA + GitHub + CI), from the snapshot server-eng.mjs already caches.
  // Non-blocking: a cold snapshot (~80s) must not stall the badge — the work items land on the next 60s poll.
  const snap = await engSnapshot(false).catch(() => null)
  items.push(...workItems(snap))
  try {
    for (const r of (await ciHealth(14, false, false)).repos) {
      if (!r.mainRed) continue
      items.push({
        key: `ci:red:${r.repo}`, kind: 'ci', severity: 'error', plane: 'work', section: 'delivery',
        text: `main is RED on ${r.repo} — ${r.lastRun?.workflowName || 'CI'} failed`, ts: r.lastRun?.at || Date.now(),
        link: r.lastRun?.url || `https://github.com/${r.repo}/actions`, owner: r.lastRun?.actor || null,
        nudge: `main is red on ${r.repo} (${r.lastRun?.workflowName || 'CI'}, ${r.lastRun?.headSha?.slice(0, 7) || '?'}). Everyone branching off main is blocked. ${r.lastRun?.url || ''}`,
      })
    }
  } catch {}
  // inboxDone: {until:ts} = snoozed, {until:null} = cleared. Legacy boolean/number values still mean "cleared".
  const done = readMeta().inboxDone || {}
  const doneOf = v => {
    if (!v) return { done: false, snoozedUntil: null }
    if (typeof v !== 'object') return { done: true, snoozedUntil: null }        // legacy: true / Date.now()
    if (v.until == null) return { done: true, snoozedUntil: null }
    return v.until > Date.now() ? { done: true, snoozedUntil: v.until } : { done: false, snoozedUntil: null } // snooze expired → back
  }
  const sev = { error: 0, warning: 1, info: 2 }
  // legacyKey (if any) is the pre-fix key for the same item — read-through so nothing already cleared comes back.
  // It never reaches the client: /api/inbox/done always writes the new key.
  return items
    .map(({ legacyKey, ...i }) => ({ ...i, ...doneOf(done[i.key] ?? (legacyKey ? done[legacyKey] : undefined)) }))
    .sort((a, b) => sev[a.severity] - sev[b.severity] || b.ts - a.ts)
}
app.get('/api/inbox', async (req, res) => {
  const items = await inboxItems()
  const plane = req.query.plane // 'work' | 'harness' | undefined (both)
  res.json(plane ? items.filter(i => i.plane === plane) : items)
})
// { key, done } clears; { key, snoozeHours } defers. Snooze is why inboxDone is an object now.
app.post('/api/inbox/done', (req, res) => {
  const { key, done, snoozeHours } = req.body
  const meta = readMeta()
  meta.inboxDone ||= {}
  if (snoozeHours > 0) meta.inboxDone[key] = { at: Date.now(), until: Date.now() + snoozeHours * 3600_000 }
  else if (done) meta.inboxDone[key] = { at: Date.now(), until: null }
  else delete meta.inboxDone[key]
  for (const [k, v] of Object.entries(meta.inboxDone)) if (v && typeof v === 'object' && v.until && v.until < Date.now()) delete meta.inboxDone[k] // prune expired snoozes
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  res.json({ ok: true })
})

// ---------- 24: daily digest ----------
app.get('/api/digest', async (req, res) => {
  const since = Date.now() - (Number(req.query.days) || 1) * 86400_000
  const { entries, lineEvents } = collectUsage()
  const en = entries.filter(e => e.t >= since)
  const byProj = {}
  for (const e of en) { const p = byProj[e.proj] ||= { out: 0, cost: 0, msgs: 0 }; p.out += e.out; p.cost += entryCost(e); p.msgs++ }
  const lines = lineEvents.filter(l => l.t >= since)
  const commits = []
  try {
    for (const dir of Object.keys(readClaudeJson().projects || {}).filter(d => d !== HOME && fs.existsSync(d))) {
      const r = spawnSync('git', ['-C', dir, 'log', '--since=' + new Date(since).toISOString(), '--oneline'], { timeout: 3000 })
      const list = r.stdout ? r.stdout.toString().split('\n').filter(Boolean) : []
      if (list.length) commits.push({ project: path.basename(dir), count: list.length, latest: list[0].slice(0, 90) })
    }
  } catch {}
  const evals = evalRuns().filter(r => r.ts >= since)
  const drift = []
  for (const proj of Object.keys(readMeta().baselines || {})) {
    try { const d = driftFor(proj); if (d.drifts.length) drift.push({ project: path.basename(proj), fields: d.drifts.length }) } catch {}
  }
  res.json({
    since,
    tokens: en.reduce((s, e) => s + e.out, 0), cost: en.reduce((s, e) => s + entryCost(e), 0), msgs: en.length,
    lines: { add: lines.reduce((s, l) => s + l.add, 0), del: lines.reduce((s, l) => s + l.del, 0) },
    byProj: Object.entries(byProj).sort((a, b) => b[1].cost - a[1].cost).slice(0, 8),
    commits: commits.sort((a, b) => b.count - a.count),
    evals: { runs: evals.length, passRate: evals.length ? evals.reduce((s, r) => s + r.passRate, 0) / evals.length : null },
    drift,
    attention: (await inboxItems()).filter(i => !i.done).slice(0, 6),
  })
})

// ---------- 5: skill/agent/MCP ROI ledger — fires × always-on cost ----------
// Pure join of /api/overview items (kind, name, descTokens, fullTokens) × /api/flow invocations
// (count, last), both of which already exist. Zero new sources. Plane B, self-only by construction.
const CAP_KIND = { skills: 'skill', agents: 'agent', commands: 'command', mcp: 'mcp' }
function capabilityLedger() {
  const items = overviewItems()
  const { invocations, prompts, sessions } = scanTranscripts()
  const now = Date.now(), d30 = now - 30 * 86400_000, d90 = now - 90 * 86400_000
  const use = {}
  const bump = (kind, name, t) => {
    const u = (use[kind + ':' + name] ||= { c30: 0, c90: 0, all: 0, last: 0 })
    u.all++; if (t >= d30) u.c30++; if (t >= d90) u.c90++; u.last = Math.max(u.last, t)
  }
  for (const i of invocations) bump(i.kind, i.name, i.t)
  // commands don't fire as tool_use — they arrive as a "/name" prompt
  const cmds = new Set(items.filter(i => i.kind === 'commands').map(i => i.name))
  for (const p of prompts) {
    const m = /^\/([\w:.-]+)/.exec(p.text.trim())
    if (!m) continue
    const full = m[1], short = full.split(':').pop()
    if (cmds.has(full)) bump('command', full, p.t)
    else if (cmds.has(short)) bump('command', short, p.t)
  }
  const real = sessions.filter(s => !s.isAgent)
  const sessions30 = real.filter(s => s.last >= d30).length
  const sessions90 = real.filter(s => s.last >= d90).length
  const rows = items.filter(i => CAP_KIND[i.kind]).map(i => {
    const u = use[CAP_KIND[i.kind] + ':' + i.name] || { c30: 0, c90: 0, all: 0, last: 0 }
    return {
      kind: i.kind, name: i.name, scope: i.scope, group: i.group,
      alwaysOnTokens: i.descTokens || 0,   // in context on EVERY session (the metadata listing)
      fullTokens: i.fullTokens || 0,       // loaded only when it actually fires
      fires30: u.c30, fires90: u.c90, firesAll: u.all, last: u.last || null,
      // the always-on tax you actually paid per fire over 90d (descTokens × sessions ÷ fires)
      tokPerFire: u.c90 ? Math.round((i.descTokens || 0) * sessions90 / u.c90) : null,
      verdict: !u.all ? 'DEAD' : u.c30 === 0 ? 'COLD' : 'HOT',
    }
  })
  const rank = { DEAD: 0, COLD: 1, HOT: 2 }
  rows.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.alwaysOnTokens - a.alwaysOnTokens || b.fires90 - a.fires90)
  const sum = (l, f) => l.reduce((s, x) => s + f(x), 0)
  const dead = rows.filter(r => r.verdict === 'DEAD'), cold = rows.filter(r => r.verdict === 'COLD')
  const alwaysOn = sum(rows, r => r.alwaysOnTokens)
  return {
    items: rows, sessions30, sessions90,
    headline: {
      alwaysOnTokens: alwaysOn, deadCount: dead.length, deadTokens: sum(dead, r => r.alwaysOnTokens),
      coldCount: cold.length, coldTokens: sum(cold, r => r.alwaysOnTokens), hotCount: rows.length - dead.length - cold.length,
      text: `you pay ${alwaysOn.toLocaleString()} tok every session for ${rows.length} capabilities — ${dead.length} of them (${sum(dead, r => r.alwaysOnTokens).toLocaleString()} tok/session) have never fired`,
    },
  }
}
app.get('/api/capabilities', (req, res) => res.json(capabilityLedger()))
// archive = the EXISTING backup()/track() write path (same as the batch `disable-skill` op): dry-run, backed up, reversible.
app.post('/api/capabilities/archive', (req, res) => {
  const { items = [], project, dryRun } = req.body
  const out = []
  for (const it of items) {
    const { kind, name, scope = 'user' } = it
    if (!KINDS[kind]) { out.push({ ...it, error: 'kind not archivable (only skills/commands/agents)' }); continue }
    try {
      if (project && scope === 'project') { // reuse the batch op verbatim for project-scoped skills
        const plan = batchPlan('disable-skill', project, { skill: name })
        if (!dryRun && plan.changed && plan.apply) plan.apply()
        out.push({ kind, name, scope, target: project, desc: plan.desc, changed: plan.changed, applied: !dryRun && plan.changed })
        continue
      }
      const root = safe(itemRoot(kind, scopeDir(kind, scope), name))
      const exists = fs.existsSync(root)
      const tok = exists ? tokens(readIf(itemFile(kind, scopeDir(kind, scope), name)) || '') : 0
      if (dryRun || !exists) { out.push({ kind, name, scope, path: root, exists, reclaimTokens: tok, changed: exists, applied: false }); continue }
      const bak = backup(root)
      fs.rmSync(root, { recursive: true, force: true })
      appendVersion({ id: 'v' + Date.now().toString(36), ts: Date.now(), author: AUTHOR, machine: os.hostname(), scope, file: root, summary: `archive ${kind}/${name} (ROI ledger)`, prev: null, content: null, backup: bak })
      out.push({ kind, name, scope, path: root, exists: true, reclaimTokens: tok, changed: true, applied: true, backup: bak })
    } catch (e) { out.push({ ...it, error: e.message }) }
  }
  respCache.clear()
  res.json({ dryRun: !!dryRun, reclaimTokens: out.reduce((s, o) => s + (o.reclaimTokens || 0), 0), results: out })
})

// ---------- 9: session forensics — failure signatures, context pressure, hook blast radius ----------
// All three panels come off the ONE extra parse now living inside the failStats()/scanTranscripts() walkers.
app.get('/api/forensics', (req, res) => {
  const days = Number(req.query.days) || 30
  const projFilter = req.query.project ? mangle(req.query.project) : null
  const cutoff = Date.now() - days * 86400_000
  const half = Date.now() - (days / 2) * 86400_000
  const recs = failStats().filter(r => r.last >= cutoff && (!projFilter || r.proj === projFilter))

  // (a) failure signatures
  const sigs = {}
  for (const r of recs) for (const e of r.errs) {
    if (e.t && e.t < cutoff) continue
    const sig = errSig(e.tool, e.text)
    const g = (sigs[sig] ||= { sig, tool: e.tool, count: 0, recent: 0, prior: 0, first: e.t, last: e.t, example: e.text, sessions: new Set(), projects: new Set() })
    g.count++; if (e.t >= half) g.recent++; else g.prior++
    g.first = Math.min(g.first || e.t, e.t); g.last = Math.max(g.last, e.t)
    g.sessions.add(r.sessionId); g.projects.add(r.proj)
    if (e.t === g.last) g.example = e.text // freshest verbatim example
  }
  const failures = Object.values(sigs).map(g => ({
    sig: g.sig, tool: g.tool, count: g.count, first: g.first, last: g.last, example: g.example,
    sessions: g.sessions.size, projects: [...g.projects].slice(0, 4),
    trend: g.recent > g.prior ? 'up' : g.recent < g.prior ? 'down' : 'flat', recent: g.recent, prior: g.prior,
    biting: g.count >= 3, // "this has bitten you N times"
  })).sort((a, b) => b.count - a.count).slice(0, 60)

  // (b) context pressure
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
  const totalBytes = Object.values(bytes).reduce((a, b) => a + b, 0)
  const tools = Object.keys(bytes).map(name => {
    const med = median(sizes[name] || [0])
    return {
      name, chars: bytes[name], share: totalBytes ? +(bytes[name] / totalBytes).toFixed(3) : 0,
      results: (sizes[name] || []).length, medianChars: Math.round(med), p90Chars: Math.round((sizes[name] || []).sort((a, b) => a - b)[Math.floor(((sizes[name] || []).length - 1) * 0.9)] || 0),
      hog: med >= 20000, // median result over ~20k chars = this tool is eating your context window
    }
  }).sort((a, b) => b.chars - a.chars).slice(0, 20)

  // (c) hook blast radius
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
      tools, totalChars: totalBytes, compactions,
      compactionsPerSession: recs.length ? +(compactions / recs.length).toFixed(2) : 0,
      biggest: big.sort((a, b) => b.chars - a.chars).slice(0, 10),
      worstSessions: perSession.sort((a, b) => b.compactions - a.compactions).slice(0, 10),
    },
    hooks: hookRows,
  })
})

// ---------- 10: session ledger with real $ ----------
// collectUsage() already carried sessionId into recentSessions — only cost was missing.
app.get('/api/sessions', (req, res) => {
  const days = Number(req.query.days) || 7
  const limit = Math.min(200, Number(req.query.limit) || 20)
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
      cost: +f.cost.toFixed(4), out: f.out, in: f.in, cacheRead: f.cr,
      cacheReadPct: cacheIn ? +(f.cr / cacheIn).toFixed(3) : 0,
      first: f.first, last: f.last, durationMs: Math.max(0, f.last - f.first),
      msgs: f.msgs, toolCalls: f.toolCalls,
      compactions: fr?.compactions || 0,
      errors: fr ? Object.values(fr.toolErrs).reduce((a, b) => a + b, 0) : 0,
      branch: Object.keys(f.branches).filter(Boolean)[0] || null,
      transcript: f.path,
      resume: cwd ? `cd ${cwd} && claude --resume ${id}` : `claude --resume ${id}`,
    }
  }).sort((a, b) => b.last - a.last)
  const totals = { cost: +rows.reduce((s, r) => s + r.cost, 0).toFixed(2), sessions: rows.length, out: rows.reduce((s, r) => s + r.out, 0) }
  res.json({ days, plane: 'harness', totals, sessions: rows.slice(0, limit) })
})

// ---------- Context Window Explorer — real per-turn context occupancy for one session ----------
// e.in + e.cc + e.cr on a turn IS the total prompt (context window) size the model saw for that turn —
// Anthropic's usage block already reports it split fresh/cache-write/cache-read, no reconstruction needed.
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

// ---------- 8: /api/roi — cohort-level AI ROI (THE ONLY CROSS-PLANE JOIN) ----------
// Join: transcript gitBranch → cfg.ticketRegex → JIRA key (falling back to pr.branch → pr.ticket).
// THE AUTHOR/ASSIGNEE FIELD IS DROPPED BEFORE ANY AGGREGATION. Cohorts only. Never per person.
// Correlational, not causal: n is shown per bucket, n<5 is flagged `low`, unattributed % is stated.
app.get('/api/roi', async (req, res) => {
  const days = Number(req.query.days) || 90
  const cutoff = Date.now() - days * 86400_000
  const snap = await engSnapshot()
  if (!snap?.available) return res.json({ available: false, reason: 'no eng snapshot (JIRA creds / gh auth)', plane: 'cohort' })
  const { files } = collectUsage()
  // branch → ticket
  const keyRes = [...new Set((snap.projects || []).map(p => p.jiraProjectKey).filter(Boolean))].map(k => new RegExp(`${k}-\\d+`, 'i'))
  const branchTicket = {}
  for (const p of snap.prs || []) if (p.branch) branchTicket[p.branch] = p.ticket
  const ticketOf = branch => {
    if (!branch) return null
    for (const re of keyRes) { const m = branch.match(re); if (m) return m[0].toUpperCase() }
    return branchTicket[branch] || null
  }
  // Claude spend per ticket. NOTE: this is the viewer's OWN spend — plane B is self-only, so an
  // "AI-touched" cohort here means "touched by THIS machine's Claude", stated plainly in the payload.
  const spendByTicket = {}, weekly = {}
  let attributed = 0, total = 0
  const wk = t => { const d = new Date(t); const day = (d.getUTCDay() + 6) % 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10) }
  for (const f of files) {
    for (const [branch, b] of Object.entries(f.branches || {})) {
      if (!b.last || b.last < cutoff) continue
      total += b.cost
      const w = (weekly[wk(b.last)] ||= { week: wk(b.last), spend: 0, points: 0, tickets: new Set() })
      w.spend += b.cost
      const tk = ticketOf(branch)
      if (!tk) continue
      attributed += b.cost
      const s = (spendByTicket[tk] ||= { cost: 0, sessions: 0, last: 0 })
      s.cost += b.cost; s.sessions++; s.last = Math.max(s.last, b.last)
      w.tickets.add(tk)
    }
  }
  // shipped stories in the window — author/assignee deliberately NOT read
  const shipped = (snap.issues || []).filter(i => i.live && i.pts > 0 && Date.parse(i.closedAt || 0) >= cutoff)
  for (const i of shipped) { const w = (weekly[wk(Date.parse(i.closedAt))] ||= { week: wk(Date.parse(i.closedAt)), spend: 0, points: 0, tickets: new Set() }); w.points += i.pts }
  const trend = Object.values(weekly).sort((a, b) => a.week.localeCompare(b.week)).map(w => ({
    week: w.week, spend: +w.spend.toFixed(2), points: w.points,
    perPoint: w.points ? +(w.spend / w.points).toFixed(2) : null, n: w.tickets.size,
  }))
  // cohorts, bucketed by story points. Only cohort-level medians — nothing keyed to a human.
  const BUCKETS = [[1, 2, '1–2'], [3, 3, '3'], [5, 5, '5'], [8, 8, '8'], [13, 99, '13+']]
  const cohort = BUCKETS.map(([lo, hi, label]) => {
    const inB = shipped.filter(i => i.pts >= lo && i.pts <= hi)
    const cut = list => ({
      n: list.length, low: list.length < 5, // n<5 → the UI greys this cell
      medianCycleDays: list.length ? +median(list.map(i => i.delivery)).toFixed(2) : null,
      medianActiveDays: list.length ? +median(list.map(i => i.activeDays)).toFixed(2) : null,
      medianQaCycles: list.length ? +median(list.map(i => i.qaCycles || 0)).toFixed(2) : null,
      reworkRate: list.length ? +(list.filter(i => i.rework).length / list.length).toFixed(2) : null,
      medianSpend: list.length ? +median(list.map(i => spendByTicket[i.key]?.cost || 0)).toFixed(2) : null,
    })
    const ai = inB.filter(i => spendByTicket[i.key])
    const un = inB.filter(i => !spendByTicket[i.key])
    return { bucket: label, pts: lo, aiTouched: cut(ai), untouched: cut(un) }
  })
  const shippedPts = shipped.reduce((s, i) => s + i.pts, 0)
  res.json({
    available: true, plane: 'cohort', days, caveat: 'correlational, not causal · AI spend is the viewer\'s own Claude usage (plane B is self-only) · no author/assignee field is read or emitted',
    headline: {
      spend: +total.toFixed(2), shippedPoints: shippedPts,
      spendPerPoint: shippedPts ? +(total / shippedPts).toFixed(2) : null,
      attributedPct: total ? +(attributed / total).toFixed(3) : 0,
      unattributedPct: total ? +(1 - attributed / total).toFixed(3) : 1, // spend on branches that map to no ticket
      ticketsWithSpend: Object.keys(spendByTicket).length, shippedTickets: shipped.length,
      // quality guardrail on spendPerPoint — cheap points mean nothing if they bounce back (rework = reopens + re-entered In Progress)
      reworkRate: shipped.length ? +(shipped.filter(i => i.rework).length / shipped.length).toFixed(2) : null,
      medianQaCycles: shipped.length ? +median(shipped.map(i => i.qaCycles || 0)).toFixed(2) : null,
      reworkedTickets: shipped.filter(i => i.rework).length,
      // shipped tickets carrying no story points can't enter a points bucket — say so rather than hide them
      unpointedShipped: (snap.issues || []).filter(i => i.live && !(i.pts > 0) && Date.parse(i.closedAt || 0) >= cutoff).length,
    },
    trend, cohort,
  })
})

// ---------- 14: team harness baseline (repos from projects.json + a team-harness.json read from git) ----------
function driftVs(bundle, project) {
  const cur = exportBundle(project, 'current', '')
  const drifts = []
  const cmp = (field, a, c) => { const A = JSON.stringify(a ?? null), C = JSON.stringify(c ?? null); if (A !== C) drifts.push({ field, baseline: A.slice(0, 400), current: C.slice(0, 400), syncable: true }) }
  cmp('settings.harness', bundle.settings?.harness, cur.settings?.harness)
  cmp('settings.permissions', bundle.settings?.permissions, cur.settings?.permissions)
  for (const k of new Set([...Object.keys(bundle.rules || {}), ...Object.keys(cur.rules || {})])) cmp('rules/' + k, bundle.rules?.[k], cur.rules?.[k])
  for (const k of new Set([...Object.keys(bundle.skills || {}), ...Object.keys(cur.skills || {})])) cmp('skills/' + k, bundle.skills?.[k] ? 'present' : null, cur.skills?.[k] ? 'present' : null)
  return drifts
}
// map a team repo (owner/name) to a local clone: any registered project dir whose origin remote matches
const remoteCache = new Map()
function originOf(dir) {
  const hit = remoteCache.get(dir)
  if (hit && Date.now() - hit.t < 600_000) return hit.v
  let v = ''
  try { v = (spawnSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { timeout: 3000 }).stdout || '').toString().trim() } catch {}
  remoteCache.set(dir, { t: Date.now(), v })
  return v
}
function localCloneOf(repo) {
  const [owner, name] = repo.split('/')
  let dirs = []
  try { dirs = Object.keys(readClaudeJson().projects || {}).filter(d => d !== HOME && fs.existsSync(d)) } catch {}
  for (const d of dirs) { const o = originOf(d); if (o && o.replace(/\.git$/, '').endsWith(`${owner}/${name}`)) return d }
  return dirs.find(d => path.basename(d) === name) || null
}
app.get('/api/gov/team', async (req, res) => {
  const meta = readMeta()
  const file = req.query.file || meta.teamHarness || null
  const bundle = file ? readJson(file, null) : null
  const projects = await engProjectList().catch(() => [])
  const repos = projects.filter(p => p.githubRepo).map(p => {
    const local = localCloneOf(p.githubRepo)
    const scaffolded = local ? fs.existsSync(path.join(local, '.claude')) : false
    let drifts = []
    if (bundle && local && scaffolded) { try { drifts = driftVs(bundle, local) } catch {} }
    return {
      key: p.key, name: p.name, repo: p.githubRepo, localPath: local,
      status: !local ? 'not-cloned' : !scaffolded ? 'never-scaffolded' : !bundle ? 'no-baseline' : drifts.length ? 'drifted' : 'on-baseline',
      drifts,
    }
  })
  res.json({ plane: 'work', file, hasBaseline: !!bundle, provenance: bundle?.provenance || null, repos })
})
// pin the team baseline: point at a team-harness.json committed in a shared repo (read from git working copy)
app.post('/api/gov/team/baseline', (req, res) => {
  const { file } = req.body
  if (!file || !fs.existsSync(file)) return res.status(400).json({ error: 'team-harness.json not found at that path — clone the repo first' })
  if (!readJson(file, null)) return res.status(400).json({ error: 'not valid JSON' })
  const meta = readMeta()
  meta.teamHarness = file
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  respCache.clear()
  res.json({ ok: true, file })
})
// export THIS project's harness as the team baseline, written (tracked) to the shared repo path
app.post('/api/gov/team/export', (req, res) => {
  const { project, file, dryRun } = req.body
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  const target = file || readMeta().teamHarness
  if (!target) return res.status(400).json({ error: 'no team-harness.json path set — POST /api/gov/team/baseline first' })
  const bundle = exportBundle(project, 'team-harness', `team baseline from ${path.basename(project)}`)
  const content = JSON.stringify(bundle, null, 2)
  if (dryRun) return res.json({ dryRun: true, file: target, bytes: content.length, skills: Object.keys(bundle.skills || {}), rules: Object.keys(bundle.rules || {}) })
  track(target, content, { scope: project, summary: 'export team harness baseline' })
  const meta = readMeta(); meta.teamHarness = target; fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  res.json({ ok: true, file: target, note: 'commit and push team-harness.json to share it' })
})
// sync one team repo to the baseline — same dry-run guard + tracked-write path as /api/gov/drift/sync
app.post('/api/gov/team/sync', (req, res) => {
  const { project, fields, dryRun } = req.body
  const bundle = readJson(readMeta().teamHarness || '', null)
  if (!bundle) return res.status(400).json({ error: 'no team baseline set' })
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  const drifts = driftVs(bundle, project).filter(d => d.syncable && (!fields?.length || fields.includes(d.field)))
  if (dryRun) return res.json({ dryRun: true, drifts })
  const applied = []
  for (const d of drifts) {
    if (d.field === 'settings.harness' || d.field === 'settings.permissions') {
      const f = path.join(project, '.claude', 'settings.json')
      const s = readJson(f, {})
      const key = d.field.split('.')[1]
      if (bundle.settings?.[key] === undefined) delete s[key]; else s[key] = bundle.settings[key]
      track(f, JSON.stringify(s, null, 2), { scope: project, summary: `sync ${d.field} from team baseline` })
      applied.push(d.field)
    } else if (d.field.startsWith('rules/') && bundle.rules?.[d.field.slice(6)] != null) {
      track(path.join(project, d.field.slice(6)), bundle.rules[d.field.slice(6)], { scope: project, summary: `sync ${d.field} from team baseline` })
      applied.push(d.field)
    }
  }
  res.json({ ok: true, applied })
})

// ---------- 18: new-project harness scaffolder ----------
function scaffoldFiles(dir, { profile, cloneFrom, skills = [] }) {
  const files = []
  let settings = { permissions: { deny: ['Read(./.env)', 'Read(./.env.*)', 'Read(./secrets/**)'], ask: ['Bash(git push*)', 'WebFetch'], allow: ['Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)'] } }
  const p = profile ? readProfiles().find(x => x.name === profile) : null
  if (p) settings.harness = p.harness
  if (cloneFrom && fs.existsSync(cloneFrom)) {
    const src = readJson(path.join(cloneFrom, '.claude', 'settings.json'), null)
    if (src) settings = p ? { ...src, harness: deepMerge(src.harness || {}, p.harness) } : src
    const mcp = readJson(path.join(cloneFrom, '.mcp.json'), null)
    if (mcp) files.push({ rel: '.mcp.json', content: JSON.stringify(mcp, null, 2) })
    for (const s of hubListSkills(path.join(cloneFrom, '.claude', 'skills'), 'project')) files.push({ rel: `.claude/skills/${s.name}/SKILL.md`, content: readIf(s.path) || '' })
    for (const a of hubListAgents(path.join(cloneFrom, '.claude', 'agents'), 'project')) files.push({ rel: `.claude/agents/${a.name}.md`, content: readIf(a.path) || '' })
    const md = readIf(path.join(cloneFrom, 'CLAUDE.md'))
    if (md) files.push({ rel: 'CLAUDE.md', content: md })
  }
  files.unshift({ rel: '.claude/settings.json', content: JSON.stringify(settings, null, 2) })
  if (!files.some(f => f.rel === 'CLAUDE.md')) {
    let langs = []
    try { langs = repoInfo(dir).langs } catch {}
    files.push({ rel: 'CLAUDE.md', content: `# ${path.basename(dir)}\n\n${langs.length ? `Primary language: ${langs.join(', ')}.\n\n` : ''}## Conventions\n\n- Keep diffs small; prefer already-installed dependencies.\n- Run the project's tests before claiming a change works.\n\n## Commands\n\n<!-- build / test / run commands here -->\n` })
  }
  for (const name of skills) {
    const src = readIf(path.join(CLAUDE, 'skills', name, 'SKILL.md'))
    if (src && !files.some(f => f.rel === `.claude/skills/${name}/SKILL.md`)) files.push({ rel: `.claude/skills/${name}/SKILL.md`, content: src })
  }
  return files
}
app.post('/api/scaffold', (req, res) => {
  const { dir, profile, cloneFrom, skills, dryRun } = req.body
  if (!dir || !fs.existsSync(dir)) return res.status(400).json({ error: 'target directory does not exist — create it first' })
  const files = scaffoldFiles(dir, { profile, cloneFrom, skills })
  if (dryRun) return res.json({ files: files.map(f => ({ ...f, exists: fs.existsSync(path.join(dir, f.rel)) })) })
  const written = []
  for (const f of files) { track(path.join(dir, f.rel), f.content, { scope: dir, summary: 'scaffold harness' }); written.push(f.rel) }
  try { // register so it shows up in Projects
    const cj = readClaudeJson()
    if (!cj.projects?.[dir]) { (cj.projects ||= {})[dir] = {}; backup(CLAUDE_JSON); fs.writeFileSync(CLAUDE_JSON, JSON.stringify(cj, null, 2)) }
  } catch {}
  res.json({ ok: true, written })
})

// ---------- 19: batch operations across projects ----------
function batchPlan(op, target, params) {
  if (op === 'set-setting') {
    if (!/^(harness|permissions|model|env)(\.|$)/.test(params.path || '')) throw new Error('path must be under harness/permissions/model/env')
    const file = path.join(target, '.claude', 'settings.json')
    const s = readJson(file, {})
    const before = JSON.stringify(getPath(s, params.path) ?? null)
    const keys = params.path.split('.')
    let o = s
    for (const k of keys.slice(0, -1)) o = o[k] = (o[k] && typeof o[k] === 'object') ? o[k] : {}
    if (params.value === null) delete o[keys[keys.length - 1]]
    else o[keys[keys.length - 1]] = params.value
    const content = JSON.stringify(s, null, 2)
    const changed = before !== JSON.stringify(params.value ?? null)
    return { desc: `${params.path}: ${before} → ${JSON.stringify(params.value)}`, changed, apply: () => track(file, content, { scope: target, summary: `batch: set ${params.path}` }) }
  }
  if (op === 'enable-skill') {
    const src = path.join(CLAUDE, 'skills', params.skill, 'SKILL.md')
    const dst = path.join(target, '.claude', 'skills', params.skill, 'SKILL.md')
    if (!fs.existsSync(src)) return { desc: `global skill "${params.skill}" not found`, changed: false }
    const changed = !fs.existsSync(dst)
    return { desc: changed ? `copy skill "${params.skill}" into project` : 'already enabled', changed, apply: () => track(dst, fs.readFileSync(src, 'utf8'), { scope: target, summary: `batch: enable skill ${params.skill}` }) }
  }
  if (op === 'disable-skill') {
    const dst = path.join(target, '.claude', 'skills', params.skill)
    const changed = fs.existsSync(dst)
    return {
      desc: changed ? `remove project skill "${params.skill}"` : 'not present', changed,
      apply: () => { backup(dst); fs.rmSync(dst, { recursive: true }); appendVersion({ id: 'v' + Date.now().toString(36), ts: Date.now(), author: AUTHOR, machine: os.hostname(), scope: target, file: dst, summary: `batch: disable skill ${params.skill}`, prev: null, content: null }) },
    }
  }
  if (op === 'push-rule') {
    const file = path.join(target, 'CLAUDE.md')
    const cur = readIf(file) || ''
    const rule = String(params.rule || '').trim()
    if (!rule) throw new Error('empty rule')
    const changed = !cur.includes(rule)
    return { desc: changed ? 'append rule to CLAUDE.md' : 'rule already present', changed, apply: () => track(file, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + '\n' + rule + '\n', { scope: target, summary: 'batch: push rule' }) }
  }
  if (op === 'sync-drift') {
    const d = driftFor(target)
    const syncable = (d.drifts || []).filter(x => x.syncable)
    return { desc: d.baseline ? `${syncable.length} drifted field(s): ${syncable.map(x => x.field).join(', ').slice(0, 120)}` : 'no baseline set', changed: syncable.length > 0, apply: () => syncable.forEach(x => syncDriftField(target, x.field)) }
  }
  throw new Error('unknown op: ' + op)
}
app.post('/api/batch', (req, res) => {
  const { op, targets, params = {}, dryRun } = req.body
  const results = []
  for (const t of targets || []) {
    if (!fs.existsSync(t)) { results.push({ target: t, desc: 'directory missing', changed: false }); continue }
    try {
      const plan = batchPlan(op, t, params)
      if (!dryRun && plan.changed && plan.apply) plan.apply()
      results.push({ target: t, desc: plan.desc, changed: plan.changed, applied: !dryRun && plan.changed })
    } catch (e) { results.push({ target: t, desc: 'error: ' + e.message, changed: false }) }
  }
  res.json({ dryRun: !!dryRun, results })
})

// ---------- 21: session bookmarks (pins live in dashboard-meta.json) ----------
app.get('/api/pins', (req, res) => {
  const meta = readMeta()
  res.json(Object.values(meta.pins || {}).sort((a, b) => b.ts - a.ts))
})
app.put('/api/pins', (req, res) => {
  const { sessionId, cwd, label, title, pinned } = req.body
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })
  const meta = readMeta()
  meta.pins ||= {}
  if (pinned) meta.pins[sessionId] = { sessionId, cwd, label: label || '', title: title || '', ts: Date.now(), configVersion: readVersions().slice(-1)[0]?.id || null }
  else delete meta.pins[sessionId]
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  res.json({ ok: true })
})

// ---------- 22: reusable context bundles ----------
const CTX_FILE = path.join(CLAUDE, 'context-bundles.json')
app.get('/api/ctxbundles', (req, res) => res.json(readJson(CTX_FILE, [])))
app.put('/api/ctxbundles', (req, res) => {
  track(CTX_FILE, JSON.stringify(req.body.bundles || [], null, 2), { summary: 'update context bundles' })
  res.json({ ok: true })
})

// ---------- 20: quick capture — notes land in ~/.claude/notes (visible in Artifacts) ----------
app.post('/api/notes', (req, res) => {
  const dir = path.join(CLAUDE, 'notes')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, (String(req.body.title || 'note').replace(/[^\w-]+/g, '-').slice(0, 40) || 'note') + '-' + Date.now().toString(36) + '.md')
  fs.writeFileSync(file, req.body.content || '')
  res.json({ ok: true, path: file })
})

// ---------- 23: notifications (desktop handled client-side; slack via webhook) ----------
app.get('/api/notify', (req, res) => res.json(readMeta().notify || { desktop: true, slackWebhook: '' }))
app.put('/api/notify', (req, res) => {
  const meta = readMeta()
  meta.notify = { desktop: !!req.body.desktop, slackWebhook: String(req.body.slackWebhook || '') }
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  res.json({ ok: true })
})
app.post('/api/notify/test', async (req, res) => {
  const hook = (readMeta().notify || {}).slackWebhook
  if (!hook) return res.status(400).json({ error: 'no slack webhook configured' })
  try {
    const r = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'claude-dashboard: test notification' }), signal: AbortSignal.timeout(8000) })
    res.json({ ok: r.ok, status: r.status })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// push new error/warning inbox items to slack (dedup per server run)
// (this is the viewer's own webhook, to themselves — no auto-nudge is ever sent to anyone else)
const slackNotified = new Set()
setInterval(async () => {
  const hook = (readMeta().notify || {}).slackWebhook
  if (!hook) return
  try {
    for (const i of await inboxItems()) {
      if (i.done || i.severity === 'info' || slackNotified.has(i.key)) continue
      slackNotified.add(i.key)
      fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `[claude-dashboard] ${i.severity.toUpperCase()}: ${i.text}` }) }).catch(() => {})
    }
  } catch {}
}, 60_000)

// ---------- agent teams: activation flag + team designer with AI review ----------
const TEAMS_FLAG = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'
app.get('/api/team/flag', (req, res) => {
  const s = readJson(settingsFileFor('global'), {})
  res.json({ enabled: s.env?.[TEAMS_FLAG] === '1' })
})
app.post('/api/team/flag', (req, res) => {
  const file = settingsFileFor('global')
  const s = readJson(file, {})
  s.env ||= {}
  if (req.body.enable === false) delete s.env[TEAMS_FLAG]
  else s.env[TEAMS_FLAG] = '1'
  // applied directly (not proposed): explicitly user-initiated, versioned & reversible in Governance
  track(file, JSON.stringify(s, null, 2), { summary: (req.body.enable === false ? 'disable' : 'enable') + ' agent teams flag' })
  res.json({ ok: true, enabled: req.body.enable !== false })
})

const TEAM_DESIGNS = path.join(CLAUDE, 'team-designs.json')
app.get('/api/team/designs', (req, res) => res.json(readJson(TEAM_DESIGNS, [])))
app.put('/api/team/designs', (req, res) => {
  track(TEAM_DESIGNS, JSON.stringify(req.body.designs || [], null, 2), { summary: 'update team designs' })
  res.json({ ok: true })
})

// AI review of a team design — same claude -p mechanism the eval runner uses
app.post('/api/team/design/review', (req, res) => {
  const design = req.body.design
  if (!design?.name || !Array.isArray(design.members)) return res.status(400).json({ error: 'design needs a name and members[]' })
  const rubric = `You are reviewing an agent-team design for Claude Code agent teams (a lead session spawns teammates that share a task list and message each other). Judge it like a pragmatic senior engineer: teams cost tokens, so every member must earn its place. An agent whose job is a single transformation with no tool use or autonomy should be "just-a-prompt" (a skill/command instead). Overlapping members should be "merge". Members that add nothing should be "unnecessary".

Reply with ONLY valid JSON (no markdown fences, no prose) matching exactly:
{"score": <0-100>, "summary": "<2 sentences>",
 "config": [{"check": "<configuration point>", "pass": true|false, "note": "<short>"}],
 "members": [{"name": "<member name>", "verdict": "keep"|"just-a-prompt"|"unnecessary"|"merge", "reason": "<short>",
   "inputs": "<what it consumes>", "outputs": "<what it returns>", "artifacts": ["<files/reports it generates>"],
   "tasks": ["<initial task list>"], "skills": ["<skills it should use>"], "connectors": ["<MCP servers/tools>"], "adrs": ["<decisions to record>"]}],
 "collaboration": [{"from": "<member>", "to": "<member>", "what": "<what flows on this edge>"}],
 "risks": ["<top risks>"]}

The design to review:
${JSON.stringify(design, null, 2)}`
  const child = spawn('claude', ['-p', rubric, '--output-format', 'json', '--dangerously-skip-permissions'], { cwd: HOME, env: process.env, shell: WIN })
  let out = ''
  const timer = setTimeout(() => { try { child.kill() } catch {}; res.status(504).json({ error: 'review timed out (180s)' }) }, 180_000)
  child.stdout.on('data', d => out += d)
  child.on('error', e => { clearTimeout(timer); res.status(500).json({ error: e.message }) })
  child.on('exit', () => {
    clearTimeout(timer)
    if (res.headersSent) return
    try {
      const j = JSON.parse(out)
      const raw = String(j.result || '')
      const review = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
      res.json({ review, cost: j.total_cost_usd || null, ms: j.duration_ms || null })
    } catch (e) { res.status(500).json({ error: 'could not parse AI review: ' + e.message, raw: out.slice(0, 800) }) }
  })
})

// ================= 25 bugs · 26 hooks · 27 CI gating · 28 analytics · 29 design drift · 30 review loop =================

// ---------- 25: bug triage workspace ----------
const BUGS_FILE = path.join(CLAUDE, 'bugs.json')
const readBugs = () => readJson(BUGS_FILE, [])
const writeBugs = b => track(BUGS_FILE, JSON.stringify(b, null, 2), { summary: 'update bugs' })
function parseTrace(text) {
  const frames = [], seen = new Set()
  const push = (file, line, fn) => { const k = file + ':' + line; if (!seen.has(k) && frames.length < 20 && !/node_modules/.test(file)) { seen.add(k); frames.push({ file, line: Number(line) || null, fn: fn || null }) } }
  for (const m of text.matchAll(/at (\S+) \((.*?):(\d+):\d+\)/g)) push(m[2], m[3], m[1])              // js: at fn (file:l:c)
  for (const m of text.matchAll(/at ((?:\/|\.{1,2}\/|[A-Za-z]:\\)[^\s():]+):(\d+):\d+/g)) push(m[1], m[2]) // js: at file:l:c
  for (const m of text.matchAll(/File "(.*?)", line (\d+)(?:, in (\S+))?/g)) push(m[1], m[2], m[3])   // python
  for (const m of text.matchAll(/((?:\/|\.{1,2}\/)[\w./-]+\.\w{1,5}):(\d+)/g)) push(m[1], m[2])       // generic path:line
  const links = [...text.matchAll(/https?:\/\/\S+/g)].map(m => m[0]).slice(0, 5)
  return { frames, links }
}
app.get('/api/bugs', (req, res) => res.json(readBugs().map(b => ({ ...b, bisect: bisects.get(b.id) || null }))))
app.post('/api/bugs', (req, res) => {
  const { project, title, severity, intake } = req.body
  if (!title?.trim()) return res.status(400).json({ error: 'title required' })
  const bugs = readBugs()
  const bug = { id: 'bug' + Date.now().toString(36), project: project || null, title: title.trim(), severity: severity || 'medium', status: 'open', intake: String(intake || '').slice(0, 20000), ...parseTrace(String(intake || '')), createdAt: Date.now(), fix: null, boardTicketId: null }
  // Cross-link (not merge): a project bug also becomes a Board type:'bug' ticket so the two stores
  // share one source of truth per bug. Each references the other; bug status stays authoritative here.
  if (project && fs.existsSync(project)) {
    try {
      const board = readBoard()
      const pipe = board.pipelines.find(p => p.id === projCfg(board, project).pipeline) || board.pipelines[0]
      const t = {
        id: 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        project, title: bug.title, desc: `Filed from Bugs (${bug.id}, ${bug.severity}).`, type: 'bug',
        parent: null, deps: [], team: null, model: null, bugId: bug.id,
        stage: 'backlog', stages: pipe.stages, pipelineVersion: `${pipe.id}@v${pipe.version}`,
        blocked: null, branch: null, worktree: null, qa: null, qaResults: [], findings: [], runs: [], conflictRisk: [], preview: null, proposal: null,
        history: [{ at: Date.now(), from: null, to: 'backlog', note: 'created from bug ' + bug.id }], createdAt: Date.now(), releasedAt: null,
      }
      board.tickets.push(t); writeBoard(board)
      bug.boardTicketId = t.id
    } catch {}
  }
  bugs.push(bug); writeBugs(bugs)
  res.json(bug)
})
app.patch('/api/bugs/:id', (req, res) => {
  const bugs = readBugs()
  const b = bugs.find(x => x.id === req.params.id)
  if (!b) return res.status(404).json({ error: 'no such bug' })
  for (const k of ['status', 'severity', 'title', 'project']) if (req.body[k] !== undefined) b[k] = req.body[k]
  if (req.body.status === 'fixed' && !b.fix) b.fix = { at: Date.now(), configVersion: readVersions().slice(-1)[0]?.id || null, sessionId: req.body.sessionId || null }
  writeBugs(bugs)
  res.json(b)
})
app.delete('/api/bugs/:id', (req, res) => { writeBugs(readBugs().filter(b => b.id !== req.params.id)); res.json({ ok: true }) })

// ---------- L1: chat review trail — record accept/reject per assistant output so "human reviews every
// output" is logged, not implicit. Same git-tracked JSON-store pattern as bugs above. ----------
const REVIEW_TRAIL_FILE = path.join(CLAUDE, 'chat-review-trail.json')
const readReviewTrail = () => readJson(REVIEW_TRAIL_FILE, [])
app.get('/api/chat-review', (req, res) => res.json(readReviewTrail()))
app.post('/api/chat-review', (req, res) => {
  const { chatId, cwd, verdict, text, note } = req.body
  if (!['accept', 'reject'].includes(verdict)) return res.status(400).json({ error: 'verdict must be accept|reject' })
  const trail = readReviewTrail()
  const entry = { id: Math.random().toString(36).slice(2, 10), chatId: chatId || null, cwd: cwd || null, verdict, text: String(text || '').slice(0, 2000), note: String(note || '').slice(0, 500), ts: Date.now() }
  trail.push(entry)
  track(REVIEW_TRAIL_FILE, JSON.stringify(trail, null, 2), { summary: `chat review: ${verdict}` })
  res.json({ ok: true, entry })
})

// auto-bisect: async, poll status — culprit commit + diffstat + author
const bisects = new Map() // bugId -> {status, log, culprit}
app.post('/api/bugs/:id/bisect', (req, res) => {
  const bug = readBugs().find(b => b.id === req.params.id)
  const { good, cmd } = req.body
  if (!bug?.project || !fs.existsSync(bug.project)) return res.status(400).json({ error: 'bug has no valid project' })
  if (!good || !cmd) return res.status(400).json({ error: 'need a last-known-good ref and a repro command (exit 0 = good)' })
  if (bisects.get(bug.id)?.status === 'running') return res.status(409).json({ error: 'bisect already running' })
  bisects.set(bug.id, { status: 'running', startedAt: Date.now() })
  res.json({ ok: true })
  ;(async () => {
    const g = args => spawnSync('git', ['-C', bug.project, ...args], { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 })
    try {
      const dirty = g(['status', '--porcelain']).stdout.toString().trim()
      if (dirty) return bisects.set(bug.id, { status: 'error', log: 'working tree is dirty — commit or stash first (bisect checks out old commits)' })
      g(['bisect', 'reset'])
      const start = g(['bisect', 'start', 'HEAD', good])
      if (start.status !== 0) return bisects.set(bug.id, { status: 'error', log: start.stderr.toString().slice(0, 1000) })
      const run = g(['bisect', 'run', 'sh', '-c', cmd])
      const out = run.stdout.toString() + run.stderr.toString()
      const m = /([0-9a-f]{40}) is the first bad commit/.exec(out)
      let culprit = null
      if (m) {
        const show = g(['show', '-s', '--format=%h%n%an%n%ad%n%s', m[1]]).stdout.toString().split('\n')
        culprit = { hash: m[1], short: show[0], author: show[1], date: show[2], subject: show[3], stat: g(['show', '--stat', '--format=', m[1]]).stdout.toString().slice(0, 2000) }
      }
      bisects.set(bug.id, { status: culprit ? 'done' : 'error', culprit, log: out.slice(-1500), finishedAt: Date.now() })
    } catch (e) { bisects.set(bug.id, { status: 'error', log: e.message }) }
    finally { g(['bisect', 'reset']) }
  })()
})
// root-cause session prompt: trace + suspect files + git blame for the suspect lines
app.get('/api/bugs/:id/context', (req, res) => {
  const bug = readBugs().find(b => b.id === req.params.id)
  if (!bug) return res.status(404).json({ error: 'no such bug' })
  const blames = []
  if (bug.project && fs.existsSync(bug.project)) {
    for (const fr of (bug.frames || []).slice(0, 6)) {
      if (!fr.line) continue
      const rel = fr.file.startsWith('/') ? path.relative(bug.project, fr.file) : fr.file
      if (rel.startsWith('..')) continue
      const r = spawnSync('git', ['-C', bug.project, 'blame', '-L', `${Math.max(1, fr.line - 2)},${fr.line + 2}`, '--date=short', '--', rel], { timeout: 5000 })
      if (r.status === 0) blames.push({ file: rel, line: fr.line, blame: r.stdout.toString().slice(0, 800) })
    }
  }
  const culprit = bisects.get(bug.id)?.culprit
  const prompt = [
    `Root-cause this bug: ${bug.title} (severity: ${bug.severity})`,
    '',
    '## Trace / intake', '```', bug.intake.slice(0, 4000), '```',
    (bug.frames || []).length ? '\n## Suspect files — read these first\n' + bug.frames.slice(0, 8).map(f => `- read @${f.file}${f.line ? ` (line ${f.line}${f.fn ? `, in ${f.fn}` : ''})` : ''}`).join('\n') : '',
    blames.length ? '\n## git blame around the suspect lines\n' + blames.map(b => `${b.file}:${b.line}\n\`\`\`\n${b.blame}\`\`\``).join('\n') : '',
    culprit ? `\n## Bisect culprit\n${culprit.short} by ${culprit.author} (${culprit.date}): ${culprit.subject}\n\`\`\`\n${culprit.stat}\`\`\`` : '',
    '\nFind the root cause, fix it, then write a regression test that fails before the fix and passes after.',
  ].filter(Boolean).join('\n')
  res.json({ prompt, blames, culprit: culprit || null })
})

// ---------- 26: native hooks — matcher test, dry-run, health, pattern library ----------
app.post('/api/hooks/test', (req, res) => {
  const { matcher, tool } = req.body
  let fires, note = ''
  if (!matcher) { fires = true; note = 'empty matcher matches every tool' }
  else try { fires = new RegExp(`^(${matcher})$`).test(tool || '') } catch (e) { fires = matcher === tool; note = 'invalid regex — fell back to exact match' }
  res.json({ fires, note })
})
app.post('/api/hooks/dryrun', (req, res) => {
  const { command, event = 'PreToolUse', toolName = 'Bash', toolInput = {} } = req.body
  if (!command) return res.status(400).json({ error: 'command required' })
  const payload = JSON.stringify({ hook_event_name: event, tool_name: toolName, tool_input: toolInput, cwd: HOME, session_id: 'dryrun' })
  const child = spawn('sh', ['-c', command], { cwd: HOME, env: process.env, shell: false })
  let out = '', err = ''
  const t0 = Date.now()
  const timer = setTimeout(() => { try { child.kill() } catch {}; res.json({ exit: null, decision: 'timeout (10s)', stdout: out.slice(0, 800), stderr: err.slice(0, 800) }) }, 10_000)
  child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d)
  child.stdin.write(payload); child.stdin.end()
  child.on('error', e => { clearTimeout(timer); if (!res.headersSent) res.json({ exit: null, decision: 'spawn error', stderr: e.message }) })
  child.on('exit', code => {
    clearTimeout(timer)
    if (res.headersSent) return
    let decision = code === 0 ? 'allow' : code === 2 ? 'BLOCK (exit 2)' : `non-blocking error (exit ${code})`
    try { const j = JSON.parse(out); if (j.decision) decision = j.decision + ' (json)' } catch {}
    res.json({ exit: code, decision, ms: Date.now() - t0, stdout: out.slice(0, 800), stderr: err.slice(0, 800) })
  })
})
app.get('/api/hooks/health', (req, res) => {
  const { hooks, hookBlocks, sessions } = scanTranscripts()
  const total = Object.values(hooks).reduce((a, b) => a + b, 0)
  res.json({ byEvent: hooks, blocks: hookBlocks, total, sessions: sessions.filter(s => !s.isAgent).length,
    // ponytail: firings counted from transcript hook-context lines — latency is not recorded there; measure a hook's cost with dry-run
    note: 'firings parsed from transcript hook-output lines · per-call latency not in transcripts — use dry-run to time a hook' })
})
// PostToolUse cap: exits 0 (never blocks) when the result is small; when it is oversized it emits the head of the
// result plus an explicit "cut N chars" note as additionalContext, so the model sees a bounded, honest result.
const truncateCmd = (tool, max) => `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const r=j.tool_response;const t=typeof r==='string'?r:JSON.stringify(r==null?'':r);if(t.length<=${max})process.exit(0);const note='[truncate-tool-result] ${tool} returned '+t.length+' chars, capped at ${max}. First ${max} chars follow; re-read a narrower range (offset/limit, head, grep) for the rest.\\n\\n'+t.slice(0,${max});console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PostToolUse',additionalContext:note},systemMessage:'${tool} result capped: '+t.length+' → ${max} chars'}))})"`
const HOOK_LIBRARY = [
  { name: 'block-prod-file-edit', event: 'PreToolUse', matcher: 'Edit|Write', description: 'blocks edits to .env, secrets, and prod-named paths',
    command: `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=(JSON.parse(s).tool_input||{}).file_path||'';if(/\\.env|secrets\\/|\\bprod(uction)?\\b/.test(p)){console.error('blocked: protected path '+p);process.exit(2)}})"` },
  { name: 'secret-scan-pre-write', event: 'PreToolUse', matcher: 'Edit|Write', description: 'blocks writes whose content looks like a credential (AWS key, private key, password=)',
    command: `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const i=JSON.parse(s).tool_input||{};const c=(i.content||i.new_string||'');if(/AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|password\\s*=\\s*['\\\"][^'\\\"]{6,}/.test(c)){console.error('blocked: looks like a secret');process.exit(2)}})"` },
  { name: 'require-tests-before-stop', event: 'Stop', matcher: '', description: 'refuses to finish if source changed but no test file was touched',
    command: `sh -c 'CH=$(git diff --name-only HEAD 2>/dev/null); echo "$CH" | grep -qE "\\.(ts|js|py|go|tsx)$" || exit 0; echo "$CH" | grep -qE "(test|spec)" && exit 0; echo "source changed but no tests touched" >&2; exit 2'` },
  { name: 'log-tool-usage', event: 'PostToolUse', matcher: '', description: 'appends every tool call to ~/.claude/tool-log.jsonl for auditing',
    command: `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);require('fs').appendFileSync(require('os').homedir()+'/.claude/tool-log.jsonl',JSON.stringify({t:Date.now(),tool:j.tool_name})+'\\n')})"` },
  // "Cap this tool" installs this one. Parameterised: params are merged from the install body, so ONE pattern
  // covers any tool whose median result blows out the context window (Read is ~57% of every byte pulled in).
  { name: 'truncate-tool-result', event: 'PostToolUse', matcher: 'Read', description: 'caps an oversized tool result — keeps the head, tells the model what was cut (params: tool, maxChars)',
    params: { tool: 'Read', maxChars: 20000 }, command: truncateCmd('Read', 20000) },
]
app.get('/api/hooks/library', (req, res) => res.json(HOOK_LIBRARY)) // `command` is the default rendering; params are re-applied on install
// name + optional params → the concrete pattern to write. Parameterless patterns are returned untouched.
function resolvePattern(name, params) {
  const pat = HOOK_LIBRARY.find(h => h.name === name)
  if (!pat || !pat.params) return pat
  const p = { ...pat.params, ...(params || {}) }
  const tool = String(p.tool || pat.params.tool).replace(/[^\w|]/g, '')          // matcher is a regex — keep it a tool name
  const maxChars = Math.max(500, Math.min(500_000, Number(p.maxChars) || pat.params.maxChars))
  return { ...pat, matcher: tool, params: { tool, maxChars }, command: truncateCmd(tool, maxChars) }
}
app.post('/api/hooks/install', (req, res) => {
  const pat = resolvePattern(req.body.name, req.body.params)
  const scope = req.body.scope || 'global'
  if (!pat) return res.status(404).json({ error: 'unknown pattern' })
  const file = settingsFileFor(scope)
  const s = readJson(file, {})
  s.hooks ||= {}
  s.hooks[pat.event] ||= []
  if (s.hooks[pat.event].some(g => (g.hooks || []).some(h => h.command === pat.command))) return res.json({ ok: true, already: true })
  s.hooks[pat.event].push({ matcher: pat.matcher, hooks: [{ type: 'command', command: pat.command, timeout: 10 }] })
  const content = JSON.stringify(s, null, 2)
  if (scope === 'global') return res.json({ ok: true, proposed: propose(file, content, `install hook pattern "${pat.name}"`) })
  track(file, content, { scope, summary: `install hook pattern "${pat.name}"` })
  res.json({ ok: true })
})

// ---------- 27: CI/CD eval gating ----------
const ciWorkflowPath = (project, provider) => provider === 'gitlab' ? path.join(project, '.gitlab-ci.yml') : path.join(project, '.github', 'workflows', 'harness-evals.yml')
function ciYaml(provider, minPass) {
  const runner = `node -e "const fs=require('fs'),{execSync}=require('child_process');const tasks=JSON.parse(fs.readFileSync('.claude/harness-evals.json','utf8'));let pass=0;for(const t of tasks){let ok=false;try{const r=JSON.parse(execSync('claude -p '+JSON.stringify(t.prompt)+' --output-format json --dangerously-skip-permissions',{timeout:180000,encoding:'utf8'}));ok=new RegExp(t.expect).test(r.result||'')}catch(e){}console.log((ok?'PASS':'FAIL')+' '+t.name);if(ok)pass++}const rate=pass/tasks.length;console.log('pass rate '+Math.round(rate*100)+'% (gate ${Math.round(minPass * 100)}%)');if(rate<${minPass})process.exit(1)"`
  if (provider === 'gitlab') return `# generated by claude-dashboard — harness eval gate (min pass ${Math.round(minPass * 100)}%)
harness-evals:
  image: node:22
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes: [".claude/**/*"]
  script:
    - npm install -g @anthropic-ai/claude-code
    - ${runner}
  variables:
    ANTHROPIC_API_KEY: $ANTHROPIC_API_KEY
`
  return `# generated by claude-dashboard — harness eval gate (min pass ${Math.round(minPass * 100)}%)
name: harness-evals
on:
  pull_request:
    paths: ['.claude/**']
jobs:
  evals:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm install -g @anthropic-ai/claude-code
      - run: ${runner}
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
`
}
app.get('/api/ci/status', (req, res) => {
  const project = req.query.project
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  let existing = null
  for (const provider of ['github', 'gitlab']) {
    const p = ciWorkflowPath(project, provider)
    const src = readIf(p)
    if (src && src.includes('harness-eval')) existing = { provider, path: p, minPass: Number((/min pass (\d+)%/.exec(src) || [])[1] || 0) / 100 }
  }
  const gh = spawnSync('gh', ['--version'], { timeout: 3000 })
  res.json({ workflow: existing, ghAvailable: gh.status === 0, evalsInRepo: fs.existsSync(path.join(project, '.claude', 'harness-evals.json')) })
})
app.post('/api/ci/generate', (req, res) => {
  const { project, provider = 'github', minPass = 0.9, dryRun } = req.body
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  const files = [
    { rel: path.relative(project, ciWorkflowPath(project, provider)), content: ciYaml(provider, minPass) },
    { rel: '.claude/harness-evals.json', content: JSON.stringify(readJson(EVALS_FILE, DEFAULT_EVALS), null, 2) }, // evals must live in-repo for CI
  ]
  if (dryRun) return res.json({ files: files.map(f => ({ ...f, exists: fs.existsSync(path.join(project, f.rel)) })) })
  for (const f of files) track(path.join(project, f.rel), f.content, { scope: project, summary: `CI eval gate (${provider}, min ${Math.round(minPass * 100)}%)` })
  res.json({ ok: true, written: files.map(f => f.rel), note: 'set the ANTHROPIC_API_KEY secret in your repo settings' })
})
// ---------- 4: cross-repo CI health (main-branch failure rate, time-to-green, flakes) ----------
// Plane A. One `gh run list` per repo from projects.json, existing gh auth, 10-min cache.
const ghAvailable = () => { try { return spawnSync('gh', ['auth', 'status'], { timeout: 8000 }).status === 0 } catch { return false } }
async function engProjectList() {
  engMod ||= await import('./server-eng.mjs')
  if (typeof engMod.projectList === 'function') return engMod.projectList()
  const r = await fetch(`http://127.0.0.1:${PORT}/api/eng/projects`)
  return await r.json()
}
const RUN_FIELDS = 'databaseId,status,conclusion,workflowName,headSha,headBranch,createdAt,updatedAt,url,displayTitle'
function repoRuns(repo, branch, limit = 100) {
  const r = spawnSync('gh', ['run', 'list', '--repo', repo, '--branch', branch, '--json', RUN_FIELDS, '--limit', String(limit)], { timeout: 25000, maxBuffer: 32 * 1024 * 1024 })
  if (r.status !== 0) throw new Error((r.stderr || '').toString().trim().slice(0, 160) || 'gh run list failed')
  return JSON.parse(r.stdout.toString() || '[]')
}
function repoCI(repo, project, days) {
  const cutoff = Date.now() - days * 86400_000
  let raw = repoRuns(repo, 'main')
  let branch = 'main'
  if (!raw.length) { raw = repoRuns(repo, 'master'); branch = raw.length ? 'master' : 'main' }
  const runs = raw.filter(x => Date.parse(x.createdAt) >= cutoff)
    .map(x => ({ id: x.databaseId, status: x.status, conclusion: x.conclusion, workflowName: x.workflowName, headSha: x.headSha, at: Date.parse(x.createdAt), endedAt: Date.parse(x.updatedAt), url: x.url, title: x.displayTitle }))
    .sort((a, b) => a.at - b.at)
  const done = runs.filter(r => r.conclusion === 'success' || r.conclusion === 'failure')
  const fails = done.filter(r => r.conclusion === 'failure')
  // time-to-green: from a red main to the next green run of the same workflow
  const greens = []
  for (const f of fails) {
    const fix = done.find(r => r.workflowName === f.workflowName && r.at > f.at && r.conclusion === 'success')
    if (fix) greens.push((fix.at - f.at) / 60000)
  }
  // flaky = the SAME headSha produced both a failure and a success
  const bySha = {}
  for (const r of done) { const s = (bySha[r.headSha] ||= { ok: 0, bad: 0, wf: new Set(), last: 0 }); if (r.conclusion === 'success') s.ok++; else s.bad++; s.wf.add(r.workflowName); s.last = Math.max(s.last, r.at) }
  const flakySha = Object.entries(bySha).filter(([, s]) => s.ok && s.bad)
  const byWf = {}
  for (const [sha, s] of flakySha) for (const w of s.wf) { const e = (byWf[w] ||= { workflow: w, count: 0, shas: [], last: 0 }); e.count++; if (e.shas.length < 5) e.shas.push(sha.slice(0, 7)); e.last = Math.max(e.last, s.last) }
  const last = done[done.length - 1] || null
  return {
    repo, project, branch, days,
    runs: runs.length, completed: done.length, failures: fails.length,
    failureRate: done.length ? +(fails.length / done.length).toFixed(3) : null,
    mainRed: last ? last.conclusion === 'failure' : false,
    lastRun: last,
    medianTimeToGreenMin: greens.length ? Math.round(median(greens)) : null,
    medianDurationMin: done.length ? Math.round(median(done.map(r => (r.endedAt - r.at) / 60000))) : null,
    flaky: Object.values(byWf).sort((a, b) => b.count - a.count).slice(0, 10),
    flakyShas: flakySha.length,
    recent: runs.slice(-15).reverse(),
  }
}
const ciCache = { at: 0, data: null }
const CI_TTL = 10 * 60_000
// wait=false (the inbox): never shell out to gh inside the poll — serve the cache, refresh behind it
async function ciHealth(days = 14, fresh = false, wait = true) {
  if (!fresh && ciCache.data && Date.now() - ciCache.at < CI_TTL && ciCache.data.days === days) return ciCache.data
  if (!wait) {
    if (Date.now() - ciCache.at > CI_TTL) { ciCache.at = Date.now(); setTimeout(() => ciHealth(days, true).catch(() => {}), 0) }
    return ciCache.data || { days, ghAvailable: false, repos: [], redRepos: [], cold: true }
  }
  engMod ||= await import('./server-eng.mjs')
  if (typeof engMod.ciHealth === 'function') return await engMod.ciHealth(days) // server-eng owns it if it ever exports one
  const gh = ghAvailable()
  const projects = gh ? await engProjectList().catch(() => []) : []
  const repos = []
  for (const p of projects) {
    if (!p.githubRepo) continue
    try { repos.push(repoCI(p.githubRepo, p.key, days)) }
    catch (e) { repos.push({ repo: p.githubRepo, project: p.key, error: e.message, runs: 0, mainRed: false, flaky: [] }) }
  }
  const data = { days, ghAvailable: gh, generatedAt: Date.now(), repos, redRepos: repos.filter(r => r.mainRed).map(r => r.repo) }
  ciCache.at = Date.now(); ciCache.data = data
  return data
}
// ?project=<local dir> keeps the old harness-evals workflow view; otherwise: cross-repo main-branch health.
app.get('/api/ci/runs', async (req, res) => {
  const project = req.query.project
  if (project) {
    if (!fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
    const r = spawnSync('gh', ['run', 'list', '--workflow', 'harness-evals.yml', '--json', 'status,conclusion,createdAt,headBranch,displayTitle,url', '--limit', '15'], { cwd: project, timeout: 15000 })
    if (r.status !== 0) return res.json({ error: (r.stderr || '').toString().slice(0, 200) || 'gh CLI unavailable or no workflow runs', runs: [] })
    try { return res.json({ runs: JSON.parse(r.stdout.toString()).map(x => ({ ...x, source: 'CI' })) }) } catch { return res.json({ runs: [] }) }
  }
  res.json(await ciHealth(Number(req.query.days) || 14, req.query.fresh === '1'))
})
app.get('/api/ci/health', async (req, res) => res.json(await ciHealth(Number(req.query.days) || 14, req.query.fresh === '1')))
app.post('/api/ci/rerun', (req, res) => {
  const { repo, id, failedOnly } = req.body
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^\d+$/.test(String(id || ''))) return res.status(400).json({ error: 'repo (owner/name) and numeric run id required' })
  const args = ['run', 'rerun', String(id), '--repo', repo, ...(failedOnly ? ['--failed'] : [])]
  const r = spawnSync('gh', args, { timeout: 20000 })
  if (r.status !== 0) return res.status(500).json({ error: (r.stderr || '').toString().slice(0, 200) })
  ciCache.at = 0
  res.json({ ok: true })
})

// ---------- 28: analytics instrumentation registry + taxonomy drift ----------
const TRACK_RE = /(?:\.|\b)(track|capture|logEvent|trackEvent|recordEvent)\s*\(\s*['"`]([\w .:/-]{3,60})['"`]/
const SRC_EXT = /\.(js|jsx|ts|tsx|py|swift|kt|java|vue|rb)$/
function scanTracking(project) {
  const events = new Map() // name -> {locations, props}
  let filesScanned = 0
  const walkT = (d, depth) => {
    if (depth > 6 || filesScanned > 4000) return
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || ['node_modules', 'dist', 'build', 'vendor', 'coverage'].includes(e.name)) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walkT(p, depth + 1); continue }
      if (!SRC_EXT.test(e.name) || filesScanned > 4000) continue
      filesScanned++
      let src; try { src = fs.readFileSync(p, 'utf8') } catch { continue }
      if (src.length > 1024 * 1024) continue
      src.split('\n').forEach((line, i) => {
        const m = TRACK_RE.exec(line)
        if (!m) return
        const ev = events.get(m[2]) || { name: m[2], locations: [], props: new Set() }
        if (ev.locations.length < 20) ev.locations.push({ file: path.relative(project, p), line: i + 1, callee: m[1] })
        const propM = /\{([^{}]*)\}/.exec(line.slice(m.index))
        if (propM) for (const k of propM[1].split(',').map(s => s.split(':')[0].trim()).filter(s => /^\w+$/.test(s))) ev.props.add(k)
        events.set(m[2], ev)
      })
    }
  }
  walkT(project, 0)
  return { events: [...events.values()].map(e => ({ ...e, props: [...e.props] })), filesScanned }
}
const caseOf = n => /^[a-z0-9]+(_[a-z0-9]+)*$/.test(n) ? 'snake_case' : /^[a-z0-9]+([A-Z][a-z0-9]*)+$/.test(n) ? 'camelCase' : /^[\w]+([./:][\w]+)+$/.test(n) ? 'dot.separated' : /^[A-Z]/.test(n) ? 'TitleCase' : 'other'
const taxonomyPath = project => path.join(project, '.claude', 'analytics-taxonomy.json')
function analyticsRegistry(project) {
  const { events, filesScanned } = scanTracking(project)
  const tax = readJson(taxonomyPath(project), null)
  const convention = tax?.convention || (() => { // derive dominant style
    const c = {}; for (const e of events) c[caseOf(e.name)] = (c[caseOf(e.name)] || 0) + 1
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  })()
  const known = new Set((tax?.events || []).map(e => e.name))
  const checked = events.map(e => {
    const issues = []
    if (convention && caseOf(e.name) !== convention) issues.push(`naming: ${caseOf(e.name)} — convention is ${convention}`)
    if (tax && !known.has(e.name)) issues.push('not in taxonomy')
    const req = (tax?.events || []).find(x => x.name === e.name)?.required || []
    for (const r of req) if (!e.props.includes(r)) issues.push(`missing required property "${r}"`)
    // near-duplicate name check
    const twin = events.find(o => o !== e && o.name.toLowerCase().replace(/[_.\s-]/g, '') === e.name.toLowerCase().replace(/[_.\s-]/g, ''))
    if (twin) issues.push(`near-duplicate of "${twin.name}"`)
    return { ...e, count: e.locations.length, issues, ok: issues.length === 0 }
  })
  const missing = (tax?.events || []).filter(e => !events.some(x => x.name === e.name)).map(e => e.name)
  return { events: checked.sort((a, b) => b.count - a.count), convention, taxonomy: tax ? taxonomyPath(project) : null, missingFromCode: missing, filesScanned }
}
app.get('/api/analytics/registry', (req, res) => {
  const project = req.query.project
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  res.json(analyticsRegistry(project))
})
app.post('/api/analytics/taxonomy', (req, res) => { // bootstrap taxonomy from what the code does today
  const project = req.body.project
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  const reg = analyticsRegistry(project)
  const tax = { convention: reg.convention, events: reg.events.map(e => ({ name: e.name, required: e.props.slice(0, 8) })) }
  track(taxonomyPath(project), JSON.stringify(tax, null, 2), { scope: project, summary: 'bootstrap analytics taxonomy from code' })
  res.json({ ok: true, path: taxonomyPath(project), events: tax.events.length })
})
app.get('/api/analytics/drift', (req, res) => { // uncommitted new events vs taxonomy — catch drift before commit
  const project = req.query.project
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  const r = spawnSync('git', ['-C', project, 'diff', 'HEAD', '--unified=0'], { timeout: 10000, maxBuffer: 8 * 1024 * 1024 })
  const tax = readJson(taxonomyPath(project), null)
  const known = new Set((tax?.events || []).map(e => e.name))
  const added = []
  for (const line of (r.stdout || '').toString().split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    const m = TRACK_RE.exec(line)
    if (m) added.push({ name: m[2], issues: [tax && !known.has(m[2]) && 'not in taxonomy', tax?.convention && caseOf(m[2]) !== tax.convention && `naming: ${caseOf(m[2])} vs ${tax.convention}`].filter(Boolean) })
  }
  res.json({ added, hasTaxonomy: !!tax })
})

// ---------- 29: design-system drift vs Figma manifest + MCP call budget ----------
const manifestPath = project => path.join(project, '.claude', 'design-manifest.json')
function scanComponents(project) {
  const comps = new Map()
  let n = 0
  let dirs = ['src/components', 'src/ui', 'components', 'app/components', 'src'].map(d => path.join(project, d)).filter(fs.existsSync)
  if (!dirs.length) dirs = [project] // monorepo / nested layout — walk the root instead
  const walkC = (d, depth) => {
    if (depth > 4 || n > 1500) return
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walkC(p, depth + 1); continue }
      if (!/\.(jsx|tsx|vue|swift)$/.test(e.name)) continue
      n++
      let src; try { src = fs.readFileSync(p, 'utf8') } catch { continue }
      for (const m of src.matchAll(/export (?:default )?(?:function|const) ([A-Z]\w+)/g)) {
        const name = m[1]
        const propM = new RegExp(`(?:function ${name}|const ${name} =[^(]*)\\(\\s*\\{([^}]*)\\}`).exec(src)
        const props = propM ? propM[1].split(',').map(s => s.split(/[:=]/)[0].trim()).filter(s => /^\w+$/.test(s)) : []
        if (!comps.has(name)) comps.set(name, { name, file: path.relative(project, p), props })
      }
    }
  }
  for (const d of [...new Set(dirs)]) walkC(d, 0)
  return [...comps.values()]
}
function designDrift(project) {
  const manifest = readJson(manifestPath(project), null)
  const code = scanComponents(project)
  if (!manifest) return { manifest: null, code: code.length, drifts: [] }
  const drifts = []
  const byName = Object.fromEntries(code.map(c => [c.name, c]))
  for (const [name, spec] of Object.entries(manifest.components || {})) {
    const c = byName[name]
    if (!c) { drifts.push({ component: name, type: 'missing-in-code', detail: 'in the Figma manifest but not implemented', figmaNode: spec.figmaNode || null }); continue }
    for (const p of spec.props || []) if (!c.props.includes(p)) drifts.push({ component: name, type: 'prop-drift', detail: `manifest prop "${p}" not in code (${c.file}) — renamed or dropped?`, figmaNode: spec.figmaNode || null })
    for (const v of spec.variants || []) if (!c.props.includes('variant') && !(spec.props || []).includes(v)) continue
  }
  for (const c of code) if (!manifest.components?.[c.name] && c.props.length) drifts.push({ component: c.name, type: 'undocumented', detail: `${c.file} — in code but not in the Figma manifest`, figmaNode: null })
  return { manifest: manifestPath(project), code: code.length, drifts: drifts.slice(0, 80) }
}
app.get('/api/design/drift', (req, res) => {
  const project = req.query.project
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  // figma MCP usage from transcripts — call budget awareness for batch design work
  const { invocations } = scanTranscripts()
  const proj = mangle(project)
  const figma = invocations.filter(i => i.kind === 'mcp' && /figma/i.test(i.name))
  const day = Date.now() - 86400_000, week = Date.now() - 7 * 86400_000
  res.json({
    ...designDrift(project),
    figmaCalls: { day: figma.filter(i => i.proj === proj && i.t >= day).length, week: figma.filter(i => i.proj === proj && i.t >= week).length, allProjectsDay: figma.filter(i => i.t >= day).length },
  })
})
app.post('/api/design/manifest', (req, res) => { // bootstrap manifest from code — a Figma MCP session can then enrich it with node ids/variants
  const project = req.body.project
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  const comps = scanComponents(project)
  const manifest = { generatedFrom: 'code', createdAt: Date.now(), components: Object.fromEntries(comps.map(c => [c.name, { props: c.props, variants: [], figmaNode: null }])) }
  track(manifestPath(project), JSON.stringify(manifest, null, 2), { scope: project, summary: 'bootstrap design manifest from code' })
  res.json({ ok: true, path: manifestPath(project), components: comps.length })
})

// ---------- 30: code review loop — /review & /security-review history from transcripts ----------
function reviewData(project) {
  const { reviews } = scanTranscripts()
  const proj = project ? mangle(project) : null
  const rel = reviews.filter(r => !proj || r.proj === proj).sort((a, b) => b.t - a.t)
  const sessions = rel.slice(0, 60).map(r => ({
    t: r.t, proj: r.proj, sessionId: r.sessionId, source: r.isAgent ? 'subagent' : 'main', level: r.level,
    findings: r.findings,
    fixed: r.findings.filter(f => f.outcome === 'fixed').length,
    dismissed: r.findings.filter(f => f.outcome === 'skipped' || f.outcome === 'no_change_needed').length,
  }))
  // recurring: same category across ≥3 distinct review passes
  const byCat = {}
  for (const r of rel) for (const f of r.findings) { const c = byCat[f.category] ||= { category: f.category, count: 0, passes: new Set(), examples: [] }; c.count++; c.passes.add(r.sessionId); if (c.examples.length < 3) c.examples.push(f.summary) }
  const recurring = Object.values(byCat).filter(c => c.passes.size >= 3).map(c => ({ category: c.category, count: c.count, passes: c.passes.size, examples: c.examples }))
    .sort((a, b) => b.count - a.count)
  // fold in Loush code-reviewer output (review.json, contract §14) so run reviews sit beside transcript-scraped ones
  const runReviews = []
  for (const proj of (project ? [path.resolve(project)] : [...projectDirs()])) {
    try {
      const rj = JSON.parse(fs.readFileSync(path.join(proj, '.loush', 'review.json'), 'utf8'))
      runReviews.push({ proj: path.basename(proj), decision: rj.decision, summary: rj.summary, headSha: rj.head_sha, findings: rj.findings || [] })
    } catch {}
  }
  return { sessions, recurring, totalFindings: rel.reduce((s, r) => s + r.findings.length, 0), runReviews }
}
app.get('/api/reviews', (req, res) => res.json(reviewData(req.query.project)))

// ---------- 31–37: agentic task board — JIRA-style dev → review → QA → release pipeline ----------
const BOARD_FILE = path.join(CLAUDE, 'taskboard.json')
const WORKTREES = path.join(CLAUDE, 'board-worktrees')
const DEFAULT_STAGES = ['backlog', 'in-progress', 'code-review', 'fixing', 'ready-for-qa', 'qa-running', 'bug-reported', 'ready-for-release', 'released']
const DEFAULT_BOARD = {
  teams: [], // {id, name, version, stages: {dev|review|qa: {model, instructions}}}
  pipelines: [
    { id: 'default', name: 'Team Production', version: 1, stages: DEFAULT_STAGES, wip: {} },
    { id: 'solo', name: 'Solo Side Project', version: 1, stages: ['backlog', 'in-progress', 'ready-for-release', 'released'], wip: {} },
  ],
  projects: {}, // proj -> {pipeline, base, branchPrefix, mergeMethod, requirePr, defaultModel, previewCmd, previewStopCmd, previewIdleMin, qaSeesFindings}
  tickets: [],
}
const readBoard = () => { const b = readJson(BOARD_FILE, {}); return { ...DEFAULT_BOARD, ...b, pipelines: b.pipelines?.length ? b.pipelines : DEFAULT_BOARD.pipelines } }
const writeBoard = b => track(BOARD_FILE, JSON.stringify(b, null, 2), { summary: 'update task board' })
const projCfg = (board, project) => ({ pipeline: 'default', base: 'main', branchPrefix: 'ticket/', mergeMethod: 'merge', requirePr: false, defaultModel: '', previewCmd: '', previewStopCmd: '', previewIdleMin: 240, qaSeesFindings: false, ...(board.projects[project] || {}) })
const tkt = (board, id) => board.tickets.find(t => t.id === id)
const stamp = (t, to, note) => { (t.history ||= []).push({ at: Date.now(), from: t.stage, to, note: note || '' }); t.stage = to; if (to === 'released') { loushRunEmit(t.project, t.id, 'run.completed', { status: 'completed' }); loushRunState(t.project, t.id, 'released', 'passed') } }
const blockT = (t, by, category, reason, needed) => { t.blocked = { at: Date.now(), by, category, reason: String(reason).slice(0, 1500), needed: needed || '' }; (t.history ||= []).push({ at: Date.now(), from: t.stage, to: 'blocked:' + category, note: String(reason).slice(0, 200) }) }
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const extractJson = s => { for (const re of [/\[[\s\S]*\]/, /\{[\s\S]*\}/]) { const m = re.exec(s || ''); if (m) try { return JSON.parse(m[0]) } catch {} } return null }

// one-shot headless agent run — same claude -p pattern as evals/team-plan; BLOCKED: marker = feature 34
const boardRuns = new Map() // ticketId -> {kind, startedAt}
function runAgent({ cwd, prompt, model, timeoutMs = 1800_000, resume }) {
  return new Promise(resolve => {
    const args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions']
    if (model) args.push('--model', model)
    if (resume) args.push('--resume', resume)
    const child = spawn('claude', args, { cwd, env: process.env, shell: WIN })
    let out = '', err = ''
    const timer = setTimeout(() => { try { child.kill() } catch {}; resolve({ error: 'timeout after ' + timeoutMs / 60000 + 'min' }) }, timeoutMs)
    child.stdout.on('data', d => out += d)
    child.stderr.on('data', d => err += d)
    child.on('error', e => { clearTimeout(timer); resolve({ error: e.message }) })
    child.on('exit', () => {
      clearTimeout(timer)
      try {
        const j = JSON.parse(out)
        const blocked = /^BLOCKED:\s*(.+)/m.exec(j.result || '')
        resolve({ result: j.result || '', blocked: blocked?.[1] || null, cost: j.total_cost_usd || 0, turns: j.num_turns || 0, sessionId: j.session_id || null, ms: j.duration_ms || 0 })
      } catch { resolve({ error: (err || out).slice(0, 1200) || 'no output from claude' }) }
    })
  })
}
// Unify board runs into the Loush Runs model: each ticket becomes a .loush/<id>/ run in its repo.
function loushRunEmit(project, ticket, type, data) {
  if (!project || !fs.existsSync(project)) return
  try {
    const dir = path.join(project, '.loush', ticket)
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, 'events.jsonl')
    const n = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0
    const rows = []
    if (n === 0) rows.push({ seq: 1, t: new Date().toISOString(), type: 'run.started', data: { flow: 'board' } })
    rows.push({ seq: n + rows.length + 1, t: new Date().toISOString(), type, data })
    fs.appendFileSync(f, rows.map(x => JSON.stringify(x)).join('\n') + '\n')
  } catch {}
}
function loushRunState(project, ticket, phase, phase_status) {
  if (!project || !fs.existsSync(project)) return
  try {
    const dir = path.join(project, '.loush', ticket)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ticket_id: ticket, flow: 'board', phase, phase_status, updated_at: new Date().toISOString() }, null, 2))
  } catch {}
}
function recordRun(t, kind, model, r, handoff) {
  (t.runs ||= []).push({ at: Date.now(), kind, model: model || 'default', status: r.error ? 'error' : r.blocked ? 'blocked' : 'ok', cost: r.cost || 0, turns: r.turns || 0, ms: r.ms || 0, sessionId: r.sessionId || null, summary: (r.result || r.error || '').slice(0, 1500), handoff }) // handoff = feature 36 audit: what was passed vs deliberately excluded
  loushRunEmit(t.project, t.id, 'step.completed', { label: kind, agent: 'board:' + kind, status: r.error ? 'failed' : r.blocked ? 'blocked' : 'passed' })
  loushRunState(t.project, t.id, kind, 'running')
}
const teamStage = (board, t, stageKind) => { const team = board.teams.find(x => x.id === t.team); const s = team?.stages?.[stageKind] || {}; return { model: t.model || s.model || projCfg(board, t.project).defaultModel || undefined, instructions: s.instructions || '' } }
const gitB = (project, args, timeout = 60_000) => spawnSync('git', ['-C', project, ...args], { timeout, maxBuffer: 8 * 1024 * 1024 })
const changedFiles = (project, base, ref) => { const r = gitB(project, ['diff', '--name-only', `${base}...${ref}`]); return r.status === 0 ? r.stdout.toString().trim().split('\n').filter(Boolean) : [] }
// 35: early conflict warning — overlapping changed files vs other in-flight branches (best-effort, after work exists)
function conflictScan(board, t) {
  if (!t.branch || !fs.existsSync(t.project)) return
  const cfg = projCfg(board, t.project)
  const mine = new Set(changedFiles(t.project, cfg.base, t.branch))
  t.conflictRisk = []
  for (const o of board.tickets) {
    if (o.id === t.id || o.project !== t.project || !o.branch || o.stage === 'released' || o.stage === 'backlog') continue
    const overlap = changedFiles(t.project, cfg.base, o.branch).filter(f => mine.has(f))
    if (overlap.length) t.conflictRisk.push({ ticket: o.id, title: o.title, files: overlap.slice(0, 10) })
  }
}
function ensureWorktree(board, t) {
  const cfg = projCfg(board, t.project)
  t.branch ||= cfg.branchPrefix + t.id
  t.worktree ||= path.join(WORKTREES, t.id)
  if (fs.existsSync(path.join(t.worktree, '.git'))) return null
  fs.mkdirSync(WORKTREES, { recursive: true })
  // 35 stacked mode: dependent branches base on their blocker's branch when it exists
  const dep = (t.deps || []).map(d => tkt(board, d)).find(d => d?.branch && d.project === t.project)
  const baseRef = dep?.branch && gitB(t.project, ['rev-parse', '--verify', dep.branch]).status === 0 ? dep.branch : cfg.base
  const r = gitB(t.project, ['worktree', 'add', t.worktree, '-b', t.branch, baseRef])
  if (r.status !== 0) {
    const r2 = gitB(t.project, ['worktree', 'add', t.worktree, t.branch]) // branch already exists — reattach
    if (r2.status !== 0) return (r.stderr.toString() + r2.stderr.toString()).slice(0, 800)
  }
  t.basedOn = baseRef
  return null
}

app.get('/api/board', (req, res) => {
  const board = readBoard()
  const project = req.query.project
  const tickets = board.tickets.filter(t => !project || t.project === project).map(t => ({
    ...t,
    running: boardRuns.get(t.id) || null,
    depBlocked: (t.deps || []).filter(d => { const o = tkt(board, d); return o && !['ready-for-release', 'released'].includes(o.stage) }),
  }))
  res.json({ tickets, teams: board.teams, pipelines: board.pipelines, config: project ? projCfg(board, project) : null })
})
app.post('/api/board/tickets', (req, res) => {
  const { project, title, desc, parent, deps, team, model, type } = req.body
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'valid project required' })
  if (!title?.trim()) return res.status(400).json({ error: 'title required' })
  const board = readBoard()
  const cfg = projCfg(board, project)
  const pipe = board.pipelines.find(p => p.id === cfg.pipeline) || board.pipelines[0]
  const t = {
    id: 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    project, title: title.trim(), desc: String(desc || '').slice(0, 20000), type: type || 'feature',
    parent: parent || null, deps: deps || [], team: team || null, model: model || null,
    stage: 'backlog', stages: pipe.stages, pipelineVersion: `${pipe.id}@v${pipe.version}`, // 37: in-flight tickets keep the template version they started on
    blocked: null, branch: null, worktree: null, qa: null, qaResults: [], findings: [], runs: [], conflictRisk: [], preview: null, proposal: null,
    history: [{ at: Date.now(), from: null, to: 'backlog', note: 'created' }], createdAt: Date.now(), releasedAt: null,
  }
  board.tickets.push(t); writeBoard(board)
  res.json(t)
})
app.patch('/api/board/tickets/:id', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  for (const k of ['title', 'desc', 'team', 'model', 'deps', 'qa', 'type']) if (req.body[k] !== undefined) t[k] = req.body[k]
  if (req.body.stage && req.body.stage !== t.stage) {
    stamp(t, req.body.stage, 'manual move')
    if (req.body.stage === 'released') { t.releasedAt = Date.now(); stopPreview(t) }
  }
  if (req.body.blocked === null && t.blocked) { t.blocked = null; (t.history ||= []).push({ at: Date.now(), from: 'blocked', to: t.stage, note: 'manually unblocked' }) }
  writeBoard(board); res.json(t)
})
app.delete('/api/board/tickets/:id', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (t) { stopPreview(t); if (t.worktree && fs.existsSync(t.worktree)) gitB(t.project, ['worktree', 'remove', '--force', t.worktree]) }
  board.tickets = board.tickets.filter(x => x.id !== req.params.id)
  writeBoard(board); res.json({ ok: true })
})

// 31: intake analysis — agent proposes an independently-workable sub-ticket breakdown
app.post('/api/board/tickets/:id/analyze', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'a run is already active on this ticket' })
  const { model } = teamStage(board, t, 'dev')
  boardRuns.set(t.id, { kind: 'analyze', startedAt: Date.now() })
  res.json({ ok: true })
  ;(async () => {
    const prompt = `Analyze this ticket and propose a breakdown into independently-workable sub-tickets (e.g. "add API endpoint", "add frontend form", "write migration"). Explore the codebase briefly to ground the breakdown.\n\n## Ticket: ${t.title}\n${t.desc}\n\nReturn ONLY a JSON array: [{"title": "...", "desc": "1-3 sentence scope incl. likely files", "deps": [indices of sub-tickets this one is blocked by]}]. 2-6 sub-tickets; fewer is better.`
    const r = await runAgent({ cwd: t.project, prompt, model, timeoutMs: 300_000 })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    recordRun(t2, 'analyze', model, r, { passed: ['ticket title+desc', 'codebase (agent-explored)'], excluded: ['prior tickets', 'chat history'] })
    t2.proposal = r.error ? null : (extractJson(r.result) || []).filter(s => s.title).slice(0, 8)
    writeBoard(b2)
  })().catch(() => boardRuns.delete(t.id))
})
app.post('/api/board/tickets/:id/breakdown', (req, res) => { // accept (possibly user-edited) breakdown → child tickets
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  const subs = (req.body.subs || []).filter(s => s.title?.trim())
  const ids = subs.map(() => 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5))
  subs.forEach((s, i) => board.tickets.push({
    id: ids[i], project: t.project, title: s.title.trim(), desc: String(s.desc || ''), type: 'sub', parent: t.id,
    deps: (s.deps || []).map(d => ids[d]).filter(Boolean), team: t.team, model: t.model,
    stage: 'backlog', stages: t.stages, pipelineVersion: t.pipelineVersion,
    blocked: null, branch: null, worktree: null, qa: null, qaResults: [], findings: [], runs: [], conflictRisk: [], preview: null, proposal: null,
    history: [{ at: Date.now(), from: null, to: 'backlog', note: 'from breakdown of ' + t.id }], createdAt: Date.now(), releasedAt: null,
  }))
  t.proposal = null
  writeBoard(board); res.json({ ok: true, created: ids.length })
})

// Backlog → In Progress: dev agent in an isolated worktree branch. 36: gets ticket + breakdown + linked context, NOT prior tickets' history.
function startTicket(id, { model: modelOverride, reply, resume } = {}, res) {
  const board = readBoard(); const t = tkt(board, id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'already running' })
  const unmet = (t.deps || []).map(d => tkt(board, d)).filter(d => d && !['ready-for-release', 'released'].includes(d.stage))
  if (unmet.length) return res.status(400).json({ error: 'blocked by: ' + unmet.map(d => d.title).join(', ') })
  const pipe = board.pipelines.find(p => p.id === projCfg(board, t.project).pipeline) || board.pipelines[0]
  const wip = pipe.wip?.['in-progress']
  if (wip && board.tickets.filter(x => x.project === t.project && x.stage === 'in-progress').length >= wip) return res.status(400).json({ error: `WIP limit for in-progress is ${wip}` })
  if (modelOverride) t.model = modelOverride // mid-flight escalation lives on the ticket
  const wtErr = ensureWorktree(board, t)
  if (wtErr) { blockT(t, 'system', 'provision', 'worktree/branch creation failed: ' + wtErr); writeBoard(board); return res.status(400).json({ error: wtErr }) }
  const { model, instructions } = teamStage(board, t, 'dev')
  const kids = board.tickets.filter(x => x.parent === t.id)
  stamp(t, 'in-progress', 'dev agent started' + (model ? ' (' + model + ')' : ''))
  boardRuns.set(t.id, { kind: 'dev', startedAt: Date.now() })
  writeBoard(board)
  res.json({ ok: true })
  ;(async () => {
    const prompt = [
      `Implement this ticket. You are in an isolated git worktree on branch ${t.branch} — commit incrementally with clear messages. Run the project's tests/build before declaring done.`,
      instructions, `\n## Ticket: ${t.title}\n${t.desc}`,
      kids.length ? '\n## Accepted sub-ticket breakdown\n' + kids.map(k => `- ${k.title}: ${k.desc}`).join('\n') : '',
      t.type === 'bug' && t.qaEvidence ? '\n## QA evidence / repro\n' + t.qaEvidence : '',
      reply ? '\n## Answer to your blocking question\n' + reply : '',
      '\nIf you hit a genuinely ambiguous requirement, missing credential, or unresolvable dependency: stop and print a final line "BLOCKED: <exactly what you need>".',
    ].filter(Boolean).join('\n')
    const r = await runAgent({ cwd: t.worktree, prompt, model, resume })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    recordRun(t2, 'dev', model, r, { passed: ['ticket', 'sub-ticket breakdown', 'worktree codebase + CLAUDE.md', ...(reply ? ['unblock reply'] : [])], excluded: ['prior tickets', 'other branches'] })
    if (r.error) blockT(t2, 'dev agent', 'agent-error', r.error)
    else if (r.blocked) blockT(t2, 'dev agent', 'needs-input', r.blocked, r.blocked)
    else { stamp(t2, 'code-review', 'dev done — idle until you run code review'); conflictScan(b2, t2) }
    writeBoard(b2)
  })().catch(() => boardRuns.delete(t.id))
}
app.post('/api/board/tickets/:id/start', (req, res) => startTicket(req.params.id, req.body, res))

// Code Review (manual trigger). 36: review agent gets diff + ticket + dev summary — not the dev transcript.
app.post('/api/board/tickets/:id/review', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t?.worktree) return res.status(400).json({ error: 'no worktree — start the ticket first' })
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'already running' })
  const { model, instructions } = teamStage(board, t, 'review')
  const cfg = projCfg(board, t.project)
  const devRun = (t.runs || []).filter(r => r.kind === 'dev').pop()
  boardRuns.set(t.id, { kind: 'review', startedAt: Date.now() })
  writeBoard(board)
  res.json({ ok: true })
  ;(async () => {
    const prompt = [
      `Senior code review of this branch. Run \`git diff ${cfg.base}...HEAD\` and review the changes against the ticket. ${instructions}`,
      `\n## Ticket: ${t.title}\n${t.desc}`,
      devRun ? '\n## Dev agent summary of what it did\n' + devRun.summary : '',
      '\nReturn ONLY JSON: [{"severity": "critical|high|medium|low", "file": "path", "summary": "one sentence"}]. Empty array [] if clean. critical/high = must fix before QA.',
    ].filter(Boolean).join('\n')
    const r = await runAgent({ cwd: t.worktree, prompt, model, timeoutMs: 900_000 })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    recordRun(t2, 'review', model, r, { passed: ['diff vs ' + cfg.base, 'ticket', 'dev agent summary'], excluded: ['dev agent raw transcript'] })
    if (r.error) blockT(t2, 'review agent', 'agent-error', r.error)
    else {
      t2.findings = (extractJson(r.result) || []).filter(f => f.summary).map(f => ({ ...f, at: Date.now() }))
      const blocking = t2.findings.filter(f => ['critical', 'high'].includes(f.severity))
      if (!blocking.length) { stamp(t2, 'ready-for-qa', `review clean (${t2.findings.length} minor) — idle until you run QA`); startPreview(b2, t2) } // 33: auto-provision on review-clean
      else stamp(t2, 'code-review', `${blocking.length} blocking finding${blocking.length === 1 ? '' : 's'}`)
    }
    writeBoard(b2)
  })().catch(() => boardRuns.delete(t.id))
})

// fix loop: dev agent gets findings + diff context, not a codebase re-read. Cap 3 iterations → Blocked (34).
app.post('/api/board/tickets/:id/fix', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t?.findings?.length) return res.status(400).json({ error: 'no findings to fix' })
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'already running' })
  const fixes = (t.runs || []).filter(r => r.kind === 'fix').length
  if (fixes >= 3) { blockT(t, 'fix loop', 'max-iterations', '3 fix iterations without a clean review — take over manually'); writeBoard(board); return res.status(400).json({ error: 'max fix iterations hit — ticket blocked' }) }
  const { model } = teamStage(board, t, 'dev')
  const cfg = projCfg(board, t.project)
  stamp(t, 'fixing', 'auto-fixing review findings (' + (fixes + 1) + '/3)')
  boardRuns.set(t.id, { kind: 'fix', startedAt: Date.now() })
  writeBoard(board)
  res.json({ ok: true })
  ;(async () => {
    const prompt = `Fix these code-review findings on the current branch (diff vs ${cfg.base}). Commit the fixes. Do NOT re-architect — address the findings only.\n\n## Ticket: ${t.title}\n\n## Findings\n${t.findings.map(f => `- [${f.severity}] ${f.file}: ${f.summary}`).join('\n')}`
    const r = await runAgent({ cwd: t.worktree, prompt, model, resume: (t.runs || []).filter(x => x.kind === 'dev' && x.sessionId).pop()?.sessionId })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    recordRun(t2, 'fix', model, r, { passed: ['findings', 'original diff context (resumed session when possible)'], excluded: ['full codebase re-read'] })
    if (r.error) blockT(t2, 'fix agent', 'agent-error', r.error)
    else stamp(t2, 'code-review', 'fixes committed — re-run code review')
    writeBoard(b2)
  })().catch(() => boardRuns.delete(t.id))
})

// 33: preview environments — plug-in point is a per-project shell command; URL parsed from its output
const previews = new Map() // ticketId -> child
function startPreview(board, t) {
  const cfg = projCfg(board, t.project)
  if (!cfg.previewCmd || previews.has(t.id)) return
  const child = spawn('sh', ['-c', cfg.previewCmd], { cwd: t.worktree || t.project, env: { ...process.env, TICKET: t.id, BRANCH: t.branch || '', WORKTREE: t.worktree || '' }, detached: true })
  previews.set(t.id, child)
  let out = ''
  const onData = d => {
    out += d
    const m = /https?:\/\/[^\s'"]+/.exec(out)
    if (m && !t.preview?.url) {
      const b2 = readBoard(); const t2 = tkt(b2, t.id)
      if (t2) { t2.preview = { url: m[0], startedAt: Date.now() }; if (t2.qa) t2.qa.baseUrl = m[0]; else t2.qa = { baseUrl: m[0] }; writeBoard(b2) }
    }
  }
  child.stdout.on('data', onData); child.stderr.on('data', onData)
  child.on('exit', code => {
    previews.delete(t.id)
    if (code && !out.includes('http')) { // build/migration failure before serving → Blocked, not a silently broken ready-for-qa
      const b2 = readBoard(); const t2 = tkt(b2, t.id)
      if (t2 && t2.stage === 'ready-for-qa') { blockT(t2, 'preview provisioning', 'provision', 'preview command exited ' + code + ':\n' + out.slice(-1200)); writeBoard(b2) }
    }
  })
}
function stopPreview(t) {
  const child = previews.get(t.id)
  if (child) { try { process.kill(-child.pid) } catch { try { child.kill() } catch {} }; previews.delete(t.id) }
  if (t.preview) t.preview = null
}
app.post('/api/board/tickets/:id/preview', (req, res) => { const b = readBoard(); const t = tkt(b, req.params.id); if (!t) return res.status(404).json({ error: 'no such ticket' }); startPreview(b, t); writeBoard(b); res.json({ ok: true }) })
app.delete('/api/board/tickets/:id/preview', (req, res) => { const b = readBoard(); const t = tkt(b, req.params.id); if (t) { stopPreview(t); writeBoard(b) } res.json({ ok: true }) })
setInterval(() => { // idle teardown — preview cost shouldn't outlive attention
  const b = readBoard(); let dirty = false
  for (const t of b.tickets) if (t.preview && Date.now() - t.preview.startedAt > projCfg(b, t.project).previewIdleMin * 60_000) { stopPreview(t); dirty = true }
  if (dirty) writeBoard(b)
}, 600_000).unref()

// Ready for QA → QA Running (manual trigger). 36: QA gets ticket+AC+changed files+preview URL — NOT review findings unless opted in.
app.post('/api/board/tickets/:id/qa', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t?.worktree) return res.status(400).json({ error: 'no worktree — start the ticket first' })
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'already running' })
  const pipe = board.pipelines.find(p => p.id === projCfg(board, t.project).pipeline) || board.pipelines[0]
  const wip = pipe.wip?.['qa-running']
  if (wip && board.tickets.filter(x => x.project === t.project && x.stage === 'qa-running').length >= wip) return res.status(400).json({ error: `WIP limit for qa-running is ${wip}` })
  t.qa = { ...(t.qa || {}), ...req.body } // baseUrl, scope, env, login, notes
  const cfg = projCfg(board, t.project)
  const { model, instructions } = teamStage(board, t, 'qa')
  const files = changedFiles(t.project, cfg.base, t.branch || 'HEAD')
  stamp(t, 'qa-running', 'QA agent started')
  boardRuns.set(t.id, { kind: 'qa', startedAt: Date.now() })
  writeBoard(board)
  res.json({ ok: true })
  ;(async () => {
    const prompt = [
      `You are a QA agent. From the ticket below, derive acceptance criteria (if not given) and a concrete test-case list (functional, edge cases, regression-relevant). Execute each case: API assertions via curl, UI flows via browser tools if available — otherwise mark them "manual" with exact steps. Capture evidence (response bodies, observed text).`,
      instructions,
      `\n## Ticket: ${t.title}\n${t.desc}`,
      `\n## Changed files (focus tests here)\n${files.slice(0, 40).join('\n') || '(unknown)'}`,
      `\n## Environment\nbase URL: ${t.qa.baseUrl || '(none — API/unit-level checks only)'}\nenv: ${t.qa.env || 'staging'}\nscope: ${t.qa.scope || 'whole ticket'}\nlogin/notes: ${t.qa.notes || '-'}`,
      cfg.qaSeesFindings && t.findings?.length ? '\n## Code-review findings (user opted QA in)\n' + t.findings.map(f => `- ${f.summary}`).join('\n') : '',
      '\nReturn ONLY JSON: {"cases": [{"name": "...", "kind": "ui|api|manual", "pass": true|false, "severity": "critical|high|medium|low", "evidence": "≤300 chars"}]}',
    ].filter(Boolean).join('\n')
    const r = await runAgent({ cwd: t.worktree, prompt, model, timeoutMs: 1800_000 })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    recordRun(t2, 'qa', model, r, { passed: ['ticket+AC', 'changed files list', 'preview URL + QA inputs', ...(cfg.qaSeesFindings ? ['review findings (opt-in)'] : [])], excluded: cfg.qaSeesFindings ? [] : ['code-review findings'] })
    if (r.error) return blockT(t2, 'QA agent', 'agent-error', r.error), writeBoard(b2)
    const cases = (extractJson(r.result)?.cases || []).slice(0, 60)
    const failed = cases.filter(c => c.pass === false)
    ;(t2.qaResults ||= []).push({ at: Date.now(), cases, pass: !failed.length }) // saved per ticket — regression pack for future runs (feeds feature 4)
    if (failed.length) {
      stamp(t2, 'bug-reported', `${failed.length} QA failure${failed.length === 1 ? '' : 's'} — bugs filed`)
      for (const c of failed.slice(0, 5)) b2.tickets.push({ // QA auto-files linked bug sub-tickets with repro + evidence + exact commit
        id: 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        project: t2.project, title: 'QA bug: ' + c.name, type: 'bug', parent: t2.id,
        desc: `QA-found on ${t2.branch} @ ${gitB(t2.project, ['rev-parse', '--short', t2.branch]).stdout?.toString().trim() || '?'}\nseverity: ${c.severity || 'medium'}\n\nrepro / evidence:\n${c.evidence || '(see QA run)'}`,
        qaEvidence: c.evidence || '', deps: [], team: t2.team, model: t2.model,
        stage: 'backlog', stages: t2.stages, pipelineVersion: t2.pipelineVersion,
        blocked: null, branch: t2.branch, worktree: t2.worktree, qa: t2.qa, qaResults: [], findings: [], runs: [], conflictRisk: [], preview: null, proposal: null,
        history: [{ at: Date.now(), from: null, to: 'backlog', note: 'auto-filed by QA on ' + t2.id }], createdAt: Date.now(), releasedAt: null,
      })
    } else stamp(t2, 'ready-for-release', 'QA clean — human release gate')
    writeBoard(b2)
  })().catch(() => boardRuns.delete(t.id))
})

// 35: release — merge queue (per-repo lock, no races), rebase attempt on conflict → Blocked with hunks. Human gate: only ever manual.
const mergeLocks = new Map() // project -> Promise
app.post('/api/board/tickets/:id/release', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  const cfg = projCfg(board, t.project)
  if (cfg.requirePr) { // human-approved PR path: don't merge, hand over the command
    stamp(t, 'released', 'marked released (PR flow)'); t.releasedAt = Date.now(); stopPreview(t); writeBoard(board)
    return res.json({ ok: true, prCmd: `cd ${t.project} && gh pr create --head ${t.branch} --base ${cfg.base} --title "${t.title.replace(/"/g, '')}" --body "Ticket ${t.id}"` })
  }
  const prev = mergeLocks.get(t.project) || Promise.resolve()
  const job = prev.then(() => {
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    if (!t2?.branch) return
    const dirty = gitB(t2.project, ['status', '--porcelain']).stdout.toString().trim()
    if (dirty) { blockT(t2, 'merge', 'merge-conflict', 'main working tree is dirty — commit or stash before releasing'); writeBoard(b2); return }
    gitB(t2.project, ['checkout', cfg.base])
    // second-to-merge rebases forward first; on conflict → Blocked with the conflicting hunks, never auto-resolved
    const reb = spawnSync('git', ['-C', t2.worktree, 'rebase', cfg.base], { timeout: 120_000 })
    if (reb.status !== 0) {
      const hunks = spawnSync('git', ['-C', t2.worktree, 'diff'], { timeout: 30_000 }).stdout.toString().slice(0, 3000)
      spawnSync('git', ['-C', t2.worktree, 'rebase', '--abort'], { timeout: 30_000 })
      blockT(t2, 'merge', 'merge-conflict', 'rebase onto ' + cfg.base + ' conflicts:\n' + (reb.stderr.toString().slice(0, 500) || '') + '\n' + hunks)
      writeBoard(b2); return
    }
    const method = cfg.mergeMethod === 'squash' ? ['merge', '--squash', t2.branch] : cfg.mergeMethod === 'rebase' ? ['merge', '--ff-only', t2.branch] : ['merge', '--no-ff', '-m', `merge: ${t2.title} (${t2.id})`, t2.branch]
    const m = gitB(t2.project, method, 120_000)
    if (m.status !== 0) { gitB(t2.project, ['merge', '--abort']); blockT(t2, 'merge', 'merge-conflict', m.stderr.toString().slice(0, 2000)); writeBoard(b2); return }
    if (cfg.mergeMethod === 'squash') gitB(t2.project, ['commit', '-m', `${t2.title} (${t2.id})`])
    const sha = gitB(t2.project, ['rev-parse', '--short', 'HEAD']).stdout.toString().trim()
    stamp(t2, 'released', `merged ${t2.branch} → ${cfg.base} @ ${sha} (${cfg.mergeMethod})`) // audit: ticket + commit + agent/model in history & runs
    t2.releasedAt = Date.now(); stopPreview(t2)
    if (t2.worktree && fs.existsSync(t2.worktree)) gitB(t2.project, ['worktree', 'remove', '--force', t2.worktree])
    writeBoard(b2)
  }).catch(() => {})
  mergeLocks.set(t.project, job)
  job.then(() => { if (mergeLocks.get(t.project) === job) mergeLocks.delete(t.project) })
  res.json({ ok: true, queued: true })
})

// 34: unblock — reply resumes the same agent with the answer injected
app.post('/api/board/tickets/:id/unblock', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t?.blocked) return res.status(400).json({ error: 'ticket is not blocked' })
  const lastSession = (t.runs || []).filter(r => r.sessionId).pop()?.sessionId
  t.blocked = null
  t.stage = 'backlog' // re-enters the dev flow; startTicket stamps in-progress
  ;(t.history ||= []).push({ at: Date.now(), from: 'blocked', to: 'backlog', note: 'unblocked with reply' })
  writeBoard(board)
  startTicket(t.id, { reply: req.body.reply || '', resume: lastSession }, res)
})

// teams / pipelines / per-project config (8-style versioning: bumped on every save)
app.post('/api/board/teams', (req, res) => {
  const board = readBoard(); const team = req.body
  if (!team.name?.trim()) return res.status(400).json({ error: 'name required' })
  const existing = board.teams.find(x => x.id === team.id)
  if (existing) Object.assign(existing, team, { version: (existing.version || 1) + 1 })
  else board.teams.push({ ...team, id: 'team' + Date.now().toString(36), version: 1 })
  writeBoard(board); res.json({ ok: true })
})
app.delete('/api/board/teams/:id', (req, res) => { const b = readBoard(); b.teams = b.teams.filter(x => x.id !== req.params.id); writeBoard(b); res.json({ ok: true }) })
app.post('/api/board/pipelines', (req, res) => {
  const board = readBoard(); const p = req.body
  if (!p.name?.trim() || !p.stages?.length) return res.status(400).json({ error: 'name and stages required' })
  const existing = board.pipelines.find(x => x.id === p.id)
  if (existing) Object.assign(existing, p, { version: (existing.version || 1) + 1 })
  else board.pipelines.push({ ...p, id: 'pipe' + Date.now().toString(36), version: 1 })
  writeBoard(board); res.json({ ok: true })
})
app.post('/api/board/config', (req, res) => {
  const { project, ...cfg } = req.body
  if (!project) return res.status(400).json({ error: 'project required' })
  const board = readBoard()
  board.projects[project] = { ...projCfg(board, project), ...cfg }
  writeBoard(board); res.json(board.projects[project])
})

// 32: task board analytics — all computed live from ticket history/runs, no stored numbers
app.get('/api/board/analytics', (req, res) => {
  const board = readBoard()
  const days = Number(req.query.days) || 30
  const since = Date.now() - days * 86400_000
  const tickets = board.tickets.filter(t => (!req.query.project || t.project === req.query.project) && t.createdAt >= since - 90 * 86400_000)
  const stageSet = [...new Set([...DEFAULT_STAGES, ...board.pipelines.flatMap(p => p.stages)])]
  const columns = Object.fromEntries(stageSet.map(s => [s, tickets.filter(t => t.stage === s && !t.blocked).length]))
  const blockedNow = tickets.filter(t => t.blocked)
  // time-in-stage from history pairs (current stage counts up to now unless released)
  const stageDur = {}, blockedDur = {}
  for (const t of tickets) {
    const h = t.history || []
    for (let i = 0; i < h.length; i++) {
      const end = h[i + 1]?.at ?? (t.stage === 'released' ? h[i].at : Date.now())
      const d = Math.max(0, end - h[i].at)
      if (h[i].to.startsWith('blocked:')) (blockedDur[h[i].to.slice(8)] ||= []).push(d)
      else (stageDur[h[i].to] ||= []).push(d)
    }
  }
  const released = tickets.filter(t => t.releasedAt && t.releasedAt >= since)
  const cycles = released.map(t => t.releasedAt - t.createdAt)
  const perDay = {}
  for (const t of released) { const k = new Date(t.releasedAt).toISOString().slice(0, 10); perDay[k] = (perDay[k] || 0) + 1 }
  const bugs = tickets.filter(t => t.type === 'bug' && t.parent)
  // per team/model/agent quality + cost breakdowns
  const groupBy = key => {
    const g = {}
    for (const t of tickets) {
      const k = key(t) || '(none)'
      const o = g[k] ||= { released: 0, bugs: 0, findings: 0, reviews: 0, cost: 0, cycles: [], escalations: 0, touches: 0 }
      if (t.releasedAt) { o.released++; o.cycles.push(t.releasedAt - t.createdAt) }
      o.bugs += tickets.filter(b => b.type === 'bug' && b.parent === t.id).length
      const firstReview = (t.runs || []).find(r => r.kind === 'review')
      if (firstReview) { o.reviews++; o.findings += (t.findings || []).length }
      o.cost += (t.runs || []).reduce((s, r) => s + (r.cost || 0), 0)
      const models = new Set((t.runs || []).map(r => r.model))
      if (models.size > 1) o.escalations++
      o.touches += (t.runs || []).filter(r => ['review', 'qa', 'fix'].includes(r.kind)).length // manual triggers = human-touch proxy
    }
    return Object.fromEntries(Object.entries(g).map(([k, o]) => [k, { ...o, avgCycleH: o.cycles.length ? Math.round(o.cycles.reduce((a, b) => a + b, 0) / o.cycles.length / 3600_000 * 10) / 10 : null, bugRatio: o.released ? Math.round(o.bugs / o.released * 100) / 100 : null, cycles: undefined }]))
  }
  // QA cycles per released ticket: bug-free first pass vs 1/2/3+
  const qaDist = { 0: 0, 1: 0, 2: 0, '3+': 0 }
  for (const t of released) { const fails = (t.qaResults || []).filter(q => !q.pass).length; qaDist[fails >= 3 ? '3+' : fails]++ }
  const runCost = kind => tickets.reduce((s, t) => s + (t.runs || []).filter(r => r.kind === kind).reduce((a, r) => a + (r.cost || 0), 0), 0)
  const sunk = tickets.filter(t => !t.releasedAt).reduce((s, t) => s + (t.runs || []).reduce((a, r) => a + (r.cost || 0), 0), 0)
  // regression pack effectiveness: cases seen ≥2 runs — do they ever catch anything?
  const caseStats = {}
  for (const t of tickets) for (const q of t.qaResults || []) for (const c of q.cases || []) { const o = caseStats[c.name] ||= { runs: 0, fails: 0 }; o.runs++; if (c.pass === false) o.fails++ }
  const stale = Object.entries(caseStats).filter(([, o]) => o.runs >= 2 && !o.fails).length
  res.json({
    days, total: tickets.length, columns, blockedNow: blockedNow.map(t => ({ id: t.id, title: t.title, category: t.blocked.category, since: t.blocked.at })),
    timeInStageH: Object.fromEntries(Object.entries(stageDur).map(([s, arr]) => [s, { avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length / 3600_000 * 10) / 10, p90: Math.round((pct(arr, 0.9) || 0) / 3600_000 * 10) / 10, n: arr.length }])),
    blockedByReasonH: Object.fromEntries(Object.entries(blockedDur).map(([c, arr]) => [c, Math.round(arr.reduce((a, b) => a + b, 0) / 3600_000 * 10) / 10])),
    cycle: { p50h: cycles.length ? Math.round(pct(cycles, 0.5) / 3600_000 * 10) / 10 : null, p90h: cycles.length ? Math.round(pct(cycles, 0.9) / 3600_000 * 10) / 10 : null, released: released.length },
    throughputPerDay: perDay,
    bugRatio: released.length ? Math.round(bugs.length / released.length * 100) / 100 : null,
    qaCyclesDist: qaDist,
    byTeam: groupBy(t => board.teams.find(x => x.id === t.team)?.name),
    byModel: groupBy(t => t.model || projCfg(board, t.project).defaultModel || '(default)'),
    costByStage: { dev: runCost('dev') + runCost('fix'), review: runCost('review'), qa: runCost('qa') + runCost('analyze') },
    costSunkUnreleased: sunk,
    costPerReleased: released.length ? (tickets.reduce((s, t) => s + (t.runs || []).reduce((a, r) => a + (r.cost || 0), 0), 0) - sunk) / released.length : null,
    staleRegressionCases: stale,
  })
})

// ---------- loush runs: .loush/<ticket>/ across known repos (contract §12–16) ----------
// The orchestrators write state.json + events.jsonl into each target repo's .loush/. We scan
// every known project repo for those and surface runs, a live event tail, and the approval gate.
function projectDirs() {
  const s = new Set([PROJECT])
  try { for (const d of Object.keys(readClaudeJson().projects || {})) s.add(path.resolve(d)) } catch {}
  return s
}
function loushSafe(proj, ...rel) { // validate proj is a known repo and the path stays under its .loush
  const P = path.resolve(String(proj || ''))
  if (!projectDirs().has(P)) throw Object.assign(new Error('unknown project'), { status: 403 })
  const base = path.join(P, '.loush')
  const p = path.resolve(base, ...rel)
  if (p !== base && !p.startsWith(base + path.sep)) throw Object.assign(new Error('path escapes .loush'), { status: 403 })
  return p
}
const eventsCache = new Map() // file -> {mtime, size, events} — the runs list polls every 5s; skip re-parsing unchanged files
// Coerce a raw event to the canonical contract-§13 shape {seq,t,type,phase,data} that scanRuns and
// deriveRunMetrics read. Some flows emit a divergent shape ({ts,event,flow,...} instead of
// {t,type,data}); tolerate both so every run renders regardless of which the flow wrote.
function normalizeEvent(e, i) {
  if (e.seq == null) e.seq = i + 1 // fallback seq so a missing-seq file still tails
  if (e.t == null && e.ts != null) e.t = e.ts
  if (e.type == null && e.event != null) e.type = e.event
  if (e.data == null || typeof e.data !== 'object') e.data = {}
  if (e.type === 'run.started' && e.data.flow == null && e.flow != null) e.data.flow = e.flow
  // step events key on data.label; divergent flows put the phase name at top level instead
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
function runDir(proj, ticket) { // a run lives at .loush/<ticket>/ or (legacy single-run) .loush/ itself
  const base = loushSafe(proj)
  const sub = loushSafe(proj, String(ticket || ''))
  return (fs.existsSync(path.join(sub, 'events.jsonl')) || fs.existsSync(path.join(sub, 'state.json'))) ? sub : base
}
const asMs = v => (typeof v === 'number' ? v : Date.parse(v) || null)
// verdict = the run's review.json (if any) fed into the pure gate logic in run-verdict.mjs.
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
        decision: state.decision || term?.data?.decision || null, // pr-review / fix outcome, if the flow recorded one
        hasReview: fs.existsSync(path.join(dir, 'review.json')),
        awaitingApproval: state.phase_status === 'blocked' && !fs.existsSync(path.join(dir, 'approvals.json')),
        verdict: computeVerdict(dir, state, term, state.phase_status === 'blocked' && !fs.existsSync(path.join(dir, 'approvals.json'))),
      })
    }
  }
  return runs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}
// estimate a run's $ from transcript entries in its time window (same estimator Reliability uses).
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
// every file the flow left in .loush/<ticket>/ — the change requested (jira.md), the reviewed
// code (scoped.diff), findings (review.md), etc. Content is fetched per-file via /artifact.
app.get('/api/runs/files', (req, res) => {
  const dir = runDir(req.query.proj, req.query.ticket)
  let files = []
  try {
    files = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name !== 'events.jsonl') // events have their own viewer
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
// batch approve — the L2 shift: the human supervises a converged batch instead of one run at a time.
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
// dispatch a fresh loush run: spawn `claude -p /<flow> <ticket>` in the repo; the flow owns .loush/<ticket>/ from there.
const LOUSH_FLOWS = ['loush-jira-implement', 'loush-feature', 'loush-pr-review', 'loush-test-cases', 'loush-bug-fix']
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
  runAgent({ cwd: path.resolve(proj), prompt: `/${flow} ${ticket}`, timeoutMs: 4 * 3600_000 }).catch(() => {}) // fire-and-forget; long-running
  res.json({ ok: true })
})

// Gap B scheduler config — enable/disable the cadence loop and edit its jobs. enabled defaults false.
app.get('/api/scheduler', (req, res) => res.json(readSchedulerConfig(CLAUDE)))
app.put('/api/scheduler', (req, res) => res.json(writeSchedulerConfig(CLAUDE, req.body || {})))

app.get('/api/meta', (req, res) => res.json({ home: HOME, claudeDir: CLAUDE, project: PROJECT, backups: BACKUPS }))

app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }))
app.listen(PORT, () => {
  console.log(`[claude-dashboard] API on http://localhost:${PORT}`)
  // start the plane-A fetch at boot, not at first request: the inbox badge/notification/Slack push are wrong
  // until it lands, so the clock should start now. Failure is fine — it retries (short backoff), it never caches null.
  engSnapshot(true).then(s => console.log(`[claude-dashboard] eng snapshot ${s?.available ? 'warm' : 'unavailable (will retry)'}`)).catch(() => {})
  startScheduler({ CLAUDE, port: PORT, runAgent, log: console.log }) // Gap B: cadence loop (opt-in, info-only)
})
