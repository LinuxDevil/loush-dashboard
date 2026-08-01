import { CLAUDE, CLAUDE_JSON, HOME, WIN, mangle, propose, readJson, tokens, track } from './dashboard-core.mjs'
import { exec, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

let chatBroadcast, chats, collectUsage

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
  const gates = []
  for (const [event, matchers] of Object.entries(settings.hooks || {}))
    for (const m of Array.isArray(matchers) ? matchers : [])
      for (const hk of m.hooks || [])
        gates.push({ name: `${event}${m.matcher ? ' · ' + m.matcher : ''}`, command: String(hk.command || '').slice(0, 80), status: 'hook', kind: 'hook' })
  for (const v of Array.isArray(settings.harness?.verification) ? settings.harness.verification : (Array.isArray(h.verification) ? h.verification : []))
    gates.push({ name: v.name, command: v.command, status: verifyResults.get(scope + '|' + v.name)?.status || 'manual', kind: 'gate' })
  const conflicts = []
  for (const [s, f] of [['global', settingsFileFor('global')], [scope, settingsFileFor(scope)]]) {
    if (s === 'global' && scope !== 'global') {}
    if (!fs.existsSync(f)) continue
    try { JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { conflicts.push(`${f}: invalid JSON — ${e.message.slice(0, 60)}`) }
  }
  for (const l of ['allow', 'ask', 'deny']) for (const r of perms[l] || []) if (typeof r !== 'string') conflicts.push(`permissions.${l} contains a non-string entry`)
  const dupes = (perms.allow || []).filter(r => (perms.deny || []).includes(r))
  for (const d of dupes) conflicts.push(`"${d}" is in both allow and deny`)
  if (h.turnPolicy.maxTurns < 1 || h.turnPolicy.maxTurns > 500) conflicts.push('harness.turnPolicy.maxTurns out of range (1-500)')
  if (h.context.compactionThreshold < 0.3 || h.context.compactionThreshold > 0.98) conflicts.push('harness.context.compactionThreshold out of range (0.3-0.98)')
  const mdPath = claudeMdFor(scope)
  const md = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : (scope !== 'global' && fs.existsSync(path.join(scope, '.claude', 'CLAUDE.md')) ? fs.readFileSync(path.join(scope, '.claude', 'CLAUDE.md'), 'utf8') : null)
  const claudeMdTokens = md ? tokens(md) : 0
  let usedTokens = null
  try {
    const { entries } = collectUsage()
    const proj = scope === 'global' ? null : mangle(scope)
    const rel = proj ? entries.filter(e => e.proj === proj) : entries
    const last = rel[rel.length - 1]
    if (last) usedTokens = Math.min(last.in + last.cr, h.context.windowSize)
  } catch {}
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

const verifyResults = new Map()

export default function mountHarness(app, deps) {
  ({ chatBroadcast, chats, collectUsage } = deps)

app.post('/api/actions/run', (req, res) => {
  const { cmd, cwd, args, runner } = req.body
  const isCursor = runner === 'cursor'
  if (!cmd || (!isCursor && !String(cmd).startsWith('/'))) return res.status(400).json({ error: isCursor ? 'prompt required' : 'cmd must be a /slash-command' })
  if (!cwd || !fs.existsSync(cwd)) return res.status(400).json({ error: 'cwd does not exist' })
  if ([...chats.values()].filter(c => c.alive && c.action).length >= 3) return res.status(429).json({ error: 'max 3 concurrent action runs' }) // ponytail: global cap
  const prompt = args ? `${cmd} ${args}` : cmd
  const child = isCursor
    ? spawn('cursor-agent', ['-p', prompt, '--output-format', 'stream-json', '-f'], { cwd, env: process.env, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn('claude', ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'], { cwd, env: process.env, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] })
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

app.get('/api/harness', (req, res) => {
  const cj = readJson(CLAUDE_JSON, {})
  const scopes = [{ id: 'global', label: 'Global', path: settingsFileFor('global'), ovCount: 0 }]
  for (const dir of Object.keys(cj.projects || {})) {
    if (dir === HOME || !fs.existsSync(dir)) continue
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
  exec(command, { cwd, timeout: 60000 }, (err, stdout, stderr) => {
    const status = err ? 'failing' : 'passing'
    verifyResults.set(scope + '|' + name, { status, t: Date.now() })
    res.json({ status, out: String(stdout || '').slice(-400), err: String(stderr || '').slice(-400) })
  })
})
}

export { HARNESS_DEFAULTS, settingsFileFor, deepMerge, getPath, harnessResolve }
