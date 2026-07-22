// Cursor dashboard — fully separate read-only routes under /api/cursor/*.
// Reads Cursor's state.vscdb with the sqlite3 CLI on PATH (mode=ro: no npm dep,
// no lock contention with a running Cursor). Schema is undocumented — everything fails soft.
//
// ============================ THE PLANE RULE (not a convention — a boundary) ============================
// TWO DATA PLANES. They do not mix.
//
//   PLANE B (LOCAL, SELF-ONLY) — everything in this file and in server-cursor-join.mjs.
//     Source: this machine's state.vscdb + this machine's git checkouts. Transcripts, prompt text,
//     hour-of-day, per-turn latency, tool errors, context %, cost, accept rate, cursorBlame.
//     Rules: never keyed by another human's identity, never accepts a user/machine parameter,
//     never aggregated across people, never transmitted anywhere. It is the signed-in user's own
//     laptop telling them about their own laptop. Full stop.
//
//   PLANE A (TEAM) — server-cursor-team.mjs ONLY, and it is the ONE exception.
//     Source: the Cursor Admin API (org billing data the admin already sees in the billing console)
//     + the GitHub/JIRA snapshot server-eng.mjs already fetches. It may emit per-email rows for
//     exactly THREE administrative facts: seat assigned, client version, spend-to-date.
//     It may NOT emit per-person accept rate, prompt content, session times, latency or AI-line
//     counts — every behavioral number is aggregated to team level behind a k>=5 floor IN THE SERVER.
//
//   THE JOIN IS FORBIDDEN. Plane A is never joined to Plane B. There is no code path that attaches
//   local transcript telemetry to a named human other than the viewer, and none may be added.
//   No per-person evaluative score. No leaderboard. No lines-typed vanity stat.
//   If a source is missing, an endpoint says so — it never fabricates a zero.
// =======================================================================================================
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import mountCursorJoin from './server-cursor-join.mjs'
import mountCursorTeam from './server-cursor-team.mjs'

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
    const unfile = u => decodeURIComponent(String(u || '').replace(/^file:\/\//, '')) || null
    for (const id of fs.readdirSync(WS_DIR)) {
      let folder = null
      try {
        const wj = JSON.parse(fs.readFileSync(path.join(WS_DIR, id, 'workspace.json'), 'utf8'))
        folder = unfile(wj.folder)
        // multi-root workspaces point at a .code-workspace file instead — 16 of 65 dirs here, and every
        // one of them was silently folderless (which is why spend-by-project rendered as `null`)
        if (!folder && wj.workspace) {
          const cw = JSON.parse(fs.readFileSync(unfile(wj.workspace), 'utf8'))
          folder = unfile(cw.folders?.[0]?.path || cw.folders?.[0]?.uri) || null
        }
      } catch {}
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
  // usageData / contextUsagePercent are populated on composerData rows and were never SELECTed —
  // that is the whole of item 2 and item 9: the money and the context pressure were already on disk.
  const folderVals = [...new Set(Object.values(folders))].sort((a, b) => b.length - a.length) // longest first
  const sessions = sq(`SELECT substr(key,14) id, json_extract(value,'$.name') name, json_extract(value,'$.createdAt') c, json_extract(value,'$.lastUpdatedAt') u, json_extract(value,'$.isArchived') a, json_extract(value,'$.workspaceIdentifier') wsid, json_extract(value,'$.modelConfig.modelName') model, json_extract(value,'$.usageData') usage, json_extract(value,'$.contextUsagePercent') ctxPct, json_extract(value,'$.contextTokensUsed') ctxTok, json_extract(value,'$.contextTokenLimit') ctxLim, json_extract(value,'$.isAgentic') agentic, (SELECT je.key FROM json_each(json_extract(z.value,'$.codeBlockData')) je LIMIT 1) cbFile FROM cursorDiskKV z WHERE key LIKE 'composerData:%'`, 64 * 1024 * 1024)
    .map(h => {
      // newer sessions carry the workspace inline; older ones only appear in a workspace DB's allComposers
      let folder = byComposer[h.id]?.folder || null, workspaceId = byComposer[h.id]?.workspaceId || null
      try {
        const w = JSON.parse(h.wsid || 'null')
        const fs2 = w?.uri?.fsPath || w?.configPath?.fsPath
        if (fs2) { folder = fs2.replace(/\.code-workspace$/, ''); workspaceId = w.id || workspaceId }
      } catch {}
      // usageData: {"<model>":{"costInCents":n,"amount":n}} — cents are integers, amount is request count
      let costCents = 0, models = {}
      try {
        for (const [m, v] of Object.entries(JSON.parse(h.usage || '{}'))) {
          const cents = v?.costInCents || 0
          costCents += cents
          models[m] = { cents: (models[m]?.cents || 0) + cents, calls: (models[m]?.calls || 0) + (v?.amount || 0) }
        }
      } catch {}
      folder = folder || folders[workspaceId] || null // workspace.json knows the folder even when the composer row does not
      // last resort: the files the session actually edited. The two biggest-spend workspaces here are
      // multi-root ones whose .code-workspace definition has since been DELETED, so this is the only
      // way their project attribution survives at all — without it 74% of spend renders as `null`.
      if (!folder && h.cbFile) {
        const p = decodeURIComponent(h.cbFile.replace(/^file:\/\//, ''))
        folder = folderVals.find(f => p.startsWith(f + '/')) || null
      }
      return {
        id: h.id, workspaceId, folder, name: h.name || null, createdAt: h.c, lastUpdatedAt: h.u, archived: !!h.a,
        model: h.model || null, agentic: !!h.agentic,
        linesAdded: byComposer[h.id]?.linesAdded || 0, linesRemoved: byComposer[h.id]?.linesRemoved || 0,
        costCents, models,
        ctxPct: h.ctxPct == null ? null : h.ctxPct, ctxTokens: h.ctxTok || 0, ctxLimit: h.ctxLim || 0,
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
    .map(g => ({ text: g.text, count: g.count, sessions: g.sessions.size, sessionIds: [...g.sessions] })) // ids: item 2 costs each cluster
    .sort((a, b) => b.count - a.count).slice(0, 50)
  const data = { userPrompts: rows.length, dupes }
  insCache = { mtime, data }
  return data
}

// ---- period window: every panel takes the same ?days= / ?from= / ?to= (item 1's period selector) ----
const DAYMS = 864e5
function windowOf(q = {}) {
  const to = q.to ? Number(q.to) : Date.now()
  const days = Number(q.days) > 0 ? Number(q.days) : 90
  const from = q.from ? Number(q.from) : to - days * DAYMS
  return { from, to, days: Math.max(1, Math.round((to - from) / DAYMS)) }
}
const inWin = (t, w) => t && t >= w.from && t <= w.to
const dayKey = t => new Date(t).toISOString().slice(0, 10)
const weekKey = t => { const d = new Date(t); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) } // ISO Monday
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))] }

// ---- ONE bubble scan feeding tool-failure triage (item 7) and turn latency (item 12). ----
// toolFormerData.error is a JSON *string*, not an object — json_extract cannot reach into it,
// which is why sqlite reports NULL for $.toolFormerData.error.clientVisibleErrorMessage. Parse in JS.
let bubCache = null
function bubbleStats() {
  const mtime = fs.statSync(DB).mtimeMs
  if (bubCache?.mtime === mtime) return bubCache.data
  const rows = sq(`SELECT substr(key,10,36) id, json_extract(value,'$.toolFormerData.name') tool, json_extract(value,'$.toolFormerData.status') st, json_extract(value,'$.toolFormerData.error') err, json_extract(value,'$.timingInfo.clientRpcSendTime') t0, json_extract(value,'$.timingInfo.clientSettleTime') t1, json_extract(value,'$.thinkingDurationMs') think FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' AND (json_extract(value,'$.toolFormerData.name') IS NOT NULL OR json_extract(value,'$.timingInfo.clientRpcSendTime') IS NOT NULL)`, 128 * 1024 * 1024)
  const tools = {}       // tool -> {calls, errors}
  const fails = {}       // tool|msg -> {tool, message, count, sessions:Set, first, last}
  const perSession = {}  // id -> {toolCalls, toolErrors, turns, waitMs, thinkMs, latencies:[]}
  for (const r of rows) {
    const s = (perSession[r.id] ||= { toolCalls: 0, toolErrors: 0, turns: 0, waitMs: 0, thinkMs: 0, latencies: [] })
    if (r.tool) {
      const t = (tools[r.tool] ||= { calls: 0, errors: 0 })
      t.calls++; s.toolCalls++
      if (r.st === 'error') {
        t.errors++; s.toolErrors++
        let msg = 'unknown error'
        try { msg = JSON.parse(r.err || '{}').clientVisibleErrorMessage || msg } catch {}
        const k = r.tool + ' ' + msg
        const f = (fails[k] ||= { tool: r.tool, message: msg, count: 0, sessions: new Set() })
        f.count++; f.sessions.add(r.id)
      }
    }
    if (r.t0 && r.t1 && r.t1 >= r.t0) { const ms = r.t1 - r.t0; s.turns++; s.waitMs += ms; s.latencies.push(ms) }
    if (r.think) s.thinkMs += r.think
  }
  const data = { tools, perSession, fails: Object.values(fails).map(f => ({ ...f, sessions: f.sessions.size })) }
  bubCache = { mtime, data }
  return data
}

// ---- item 4: Cursor's own suggested-vs-accepted line counters. ItemTable, one row per day. ----
// This is the ONLY honest accept signal on disk. toolFormerData.userDecision is NOT (7403 accepted
// vs 13 rejected = auto-accept mode, a constant wearing a metric's clothes).
export function acceptSeries(win) {
  const out = []
  for (const r of sq(`SELECT substr(key,length('aiCodeTracking.dailyStats.v1.5.')+1) d, value v FROM ItemTable WHERE key LIKE 'aiCodeTracking.dailyStats.v1.5.%' ORDER BY 1`)) {
    let j = {}; try { j = JSON.parse(r.v) } catch { continue }
    const t = Date.parse(r.d + 'T12:00:00Z')
    if (win && !inWin(t, win)) continue
    const sug = (j.tabSuggestedLines || 0) + (j.composerSuggestedLines || 0)
    const acc = (j.tabAcceptedLines || 0) + (j.composerAcceptedLines || 0)
    out.push({
      day: r.d, ts: t,
      tabSuggested: j.tabSuggestedLines || 0, tabAccepted: j.tabAcceptedLines || 0,
      composerSuggested: j.composerSuggestedLines || 0, composerAccepted: j.composerAcceptedLines || 0,
      suggested: sug, accepted: acc, acceptRate: sug ? +(acc / sug).toFixed(4) : null,
    })
  }
  return out
}

// ---- item 5 spine input: cursorBlame — Cursor's own per-commit AI-vs-human line attribution. ----
// Richer than the roadmap knew: every row carries commitHash, branchName, repoName, commitTimestamp,
// agentLinesAdded/nonAiLinesAdded AND the originating conversationId(s) in rangeAnnotations.
export function blameRows(win) {
  const out = []
  for (const r of sq(`SELECT substr(key,13) sha, value v FROM cursorDiskKV WHERE key LIKE 'cursorBlame:%'`, 32 * 1024 * 1024)) {
    let m = null; try { m = JSON.parse(r.v).metrics } catch { continue }
    if (!m) continue
    const ts = Date.parse(m.commitTimestamp || '') || null
    if (win && !inWin(ts, win)) continue
    const sessions = new Set()
    for (const f of m.rangeAnnotations || []) for (const g of f.groups || []) if (g.conversationId) sessions.add(g.conversationId)
    out.push({
      sha: r.sha, repo: m.repoName || null, branch: m.branchName || null, primaryBranch: !!m.isPrimaryBranch,
      message: m.message || '', ts, day: ts ? dayKey(ts) : null,
      aiLinesAdded: m.agentLinesAdded || 0, aiLinesDeleted: m.agentLinesDeleted || 0,
      humanLinesAdded: m.nonAiLinesAdded || 0, humanLinesDeleted: m.nonAiLinesDeleted || 0,
      totalLinesAdded: m.totalLinesAdded || 0, totalLinesDeleted: m.totalLinesDeleted || 0,
      files: (m.rangeAnnotations || []).map(f => f.filePath),
      sessions: [...sessions],
    })
  }
  return out.sort((a, b) => (b.ts || 0) - (a.ts || 0))
}

// ---- item 10: FTS5 sidecar over every bubble text. Built in ~5s, ~30MB, cached by DB mtime. ----
// The main DB is opened read-only, so the index lives beside the dashboard's other state.
const FTS = path.join(HOME, '.claude', 'cursor-search.db')
let ftsAt = null
function ftsIndex() {
  const mtime = fs.statSync(DB).mtimeMs
  if (ftsAt === mtime && fs.existsSync(FTS)) return FTS
  fs.mkdirSync(path.dirname(FTS), { recursive: true })
  try { fs.rmSync(FTS) } catch {}
  const r = spawnSync('sqlite3', [FTS, `ATTACH 'file:${DB}?mode=ro' AS c; CREATE VIRTUAL TABLE fts USING fts5(sid UNINDEXED, bid UNINDEXED, role UNINDEXED, text); INSERT INTO fts SELECT substr(key,10,36), substr(key,47), json_extract(value,'$.type'), json_extract(value,'$.text') FROM c.cursorDiskKV WHERE key LIKE 'bubbleId:%' AND length(json_extract(value,'$.text'))>0;`], { timeout: 300_000 })
  if (r.status !== 0) throw new Error('fts build: ' + (r.stderr || '').toString().slice(0, 200))
  ftsAt = mtime
  return FTS
}
function ftsSearch(q, limit) {
  const db = ftsIndex()
  const term = String(q).replace(/["']/g, ' ').trim()
  if (!term) return []
  const r = spawnSync('sqlite3', ['-json', `file:${db}?mode=ro`, `SELECT sid, bid, role, snippet(fts,3,'<<','>>','…',16) snip FROM fts WHERE fts MATCH '"${term}"' LIMIT ${Math.min(500, limit)}`], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })
  if (r.status !== 0) throw new Error('fts: ' + (r.stderr || '').toString().slice(0, 200))
  const out = r.stdout.toString().trim()
  return out ? JSON.parse(out) : []
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

// Cross-tool reuse (Career G1): AI-authored line totals from Cursor sessions. Quarantined — no Cursor
// DB (or a read error) degrades to zeros so the Career build never fails on a missing Cursor install.
// shared with server-mindwalk.mjs, which needs the composerId -> folder mapping
export const cursorSnapshot = () => snapshot()

export function cursorAiLines() {
  try {
    if (!fs.existsSync(DB)) return { sessions: 0, linesAdded: 0, linesRemoved: 0 }
    const { sessions } = snapshot()
    const real = sessions.filter(s => !s.subagent)
    return {
      sessions: real.length,
      linesAdded: real.reduce((a, s) => a + (s.linesAdded || 0), 0),
      linesRemoved: real.reduce((a, s) => a + (s.linesRemoved || 0), 0),
    }
  } catch { return { sessions: 0, linesAdded: 0, linesRemoved: 0 } }
}

export default function mountCursor(app, { testMcp } = {}) {
  // server.mjs mounts only this module; the join (plane B) and team (plane A) routes hang off it.
  // Join goes first: it claims /api/cursor/export?kind=join and next()s everything else through.
  mountCursorJoin(app)
  mountCursorTeam(app)

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

  // ---- item 9: loaded-context accounting (the always-context TAX) + context PRESSURE, one endpoint ----
  app.get('/api/cursor/context', guard((req, res) => {
    const always = [], onInvoke = []
    for (const kind of KINDS) for (const r of listResources(kind)) {
      if (req.query.workspace && r.folder && r.folder !== req.query.workspace) continue
      if (r.tokensAlways) always.push({ kind, name: r.name, path: r.path, folder: r.folder || null, scope: r.scope || null, tokens: r.tokensAlways, why: r.alwaysApply ? 'alwaysApply rule' : 'description in context' })
      if (r.tokensOnInvoke) onInvoke.push({ kind, name: r.name, path: r.path, tokens: r.tokensOnInvoke })
    }
    if (req.query.workspace) {
      const h = harness(String(req.query.workspace))
      if (h.agents) always.push({ kind: 'root', name: 'AGENTS.md', tokens: h.agents.tokens, why: 'always loaded' })
      if (h.legacy) always.push({ kind: 'root', name: '.cursorrules', tokens: h.legacy.tokens, why: 'always loaded (legacy)' })
    }
    always.sort((a, b) => b.tokens - a.tokens); onInvoke.sort((a, b) => b.tokens - a.tokens)

    // pressure: contextUsagePercent is on 724 sessions and was never read. Bucketed, plus the
    // high-context tool-error question ("does search_replace get worse above 80% context?").
    const w = windowOf(req.query)
    const { perSession } = bubbleStats()
    const mine = snapshot().sessions.filter(s => inWin(s.lastUpdatedAt, w) && s.ctxPct != null)
    const buckets = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i * 10 + 10, sessions: 0 }))
    let hiCalls = 0, hiErrs = 0, loCalls = 0, loErrs = 0
    const over80 = []
    for (const s of mine) {
      const p = Math.max(0, Math.min(99.9, s.ctxPct))
      buckets[Math.floor(p / 10)].sessions++
      const b = perSession[s.id] || { toolCalls: 0, toolErrors: 0 }
      if (p >= 80) { hiCalls += b.toolCalls; hiErrs += b.toolErrors; over80.push({ id: s.id, name: s.name, folder: s.folder, ctxPct: +p.toFixed(1), ctxTokens: s.ctxTokens, ctxLimit: s.ctxLimit, toolErrors: b.toolErrors, lastUpdatedAt: s.lastUpdatedAt }) }
      else { loCalls += b.toolCalls; loErrs += b.toolErrors }
    }
    res.json({
      always, onInvoke,
      totals: { always: always.reduce((s, x) => s + x.tokens, 0), onInvoke: onInvoke.reduce((s, x) => s + x.tokens, 0) },
      // honest label — Cursor does NOT log .mdc rule application; only plugin SKILL.md paths ever appear
      activationsNote: 'recorded activations: plugin skills only — Cursor does not log .mdc rule loads',
      pressure: {
        window: w, sessions: mine.length, buckets,
        over80: over80.sort((a, b) => b.ctxPct - a.ctxPct).slice(0, 50),
        errorRate: {
          high: hiCalls ? +(hiErrs / hiCalls).toFixed(4) : null, highCalls: hiCalls,
          low: loCalls ? +(loErrs / loCalls).toFixed(4) : null, lowCalls: loCalls,
        },
      },
    })
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

  // ---- item 1: truth pass. Names the tiles that are structurally dead so the UI can delete them,
  // and ships the trend /api/cursor/overview already computed and the client threw away. ----
  app.get('/api/cursor/truth', guard((req, res) => {
    const { sessions } = snapshot()
    const w = windowOf(req.query)
    const perDay = {}
    for (const s of sessions) if (inWin(s.lastUpdatedAt, w)) perDay[dayKey(s.lastUpdatedAt)] = (perDay[dayKey(s.lastUpdatedAt)] || 0) + 1
    const days = []
    for (let t = w.from; t <= w.to; t += DAYMS) { const d = dayKey(t); days.push({ day: d, sessions: perDay[d] || 0 }) }
    const half = Math.floor(days.length / 2)
    const prev = days.slice(0, half).reduce((a, d) => a + d.sessions, 0)
    const curr = days.slice(half).reduce((a, d) => a + d.sessions, 0)
    res.json({
      window: w,
      trend: { days, current: curr, previous: prev, deltaPct: prev ? +(((curr - prev) / prev) * 100).toFixed(1) : null },
      // each of these was verified against the live DB on this machine
      dead: [
        { tile: 'subagent runs', where: 'CursorDashboard Overview', why: 'snapshot() hardcodes subagent:false on every session, so sessions.length - real.length is structurally always 0', verdict: 'DELETE', evidence: { subagents: 0, ofSessions: sessions.length } },
        { tile: 'day x hour Heatmap (Overview + ProjectDetail)', where: 'CursorDashboard', why: 'built from lastUpdatedAt (not activity), all-history, un-trended, one persons clock — surveillance-shaped and not even accurate', verdict: 'DELETE' },
        { tile: 'Biggest sessions (by lines changed)', where: 'ProjectDetail', why: 'ranks by lines an AI typed; rewards churn. Replaced by /api/cursor/accept', verdict: 'DELETE (server field topSessions still shipped for now — remove with the UI)' },
        { tile: 'user prompts (8-500 chars)', where: 'Insights', why: 'arbitrary character window presented as a headline number', verdict: 'DELETE (dupe clusters underneath survive, now costed by /api/cursor/spend)' },
        { tile: 'Models used (count chips)', where: 'ProjectDetail', why: 'session count is the wrong denominator by an order of magnitude; use spend weight', verdict: 'REPLACE with /api/cursor/models' },
      ],
      demote: ['messages', 'workspaces', 'activeDays'],
    })
  }))

  // ---- item 2: spend. All of it was already in the local DB, on 310 sessions, unread. ----
  app.get('/api/cursor/spend', guard((req, res) => {
    const w = windowOf(req.query)
    const { sessions } = snapshot()
    const priced = sessions.filter(s => s.costCents > 0)
    const inw = priced.filter(s => inWin(s.lastUpdatedAt, w))
    const cents = ss => ss.reduce((a, s) => a + s.costCents, 0)
    const now = Date.now(), mtd = priced.filter(s => s.lastUpdatedAt >= Date.parse(new Date(now).toISOString().slice(0, 7) + '-01'))

    const perDay = {}, byProject = {}, byModel = {}
    for (const s of inw) {
      perDay[dayKey(s.lastUpdatedAt)] = (perDay[dayKey(s.lastUpdatedAt)] || 0) + s.costCents
      const k = s.folder || s.workspaceId || 'unknown'
      const p = (byProject[k] ||= { folder: s.folder, workspaceId: s.workspaceId, cents: 0, sessions: 0, aiLines: 0 })
      p.cents += s.costCents; p.sessions++; p.aiLines += s.linesAdded
      for (const [m, v] of Object.entries(s.models)) {
        const mm = (byModel[m] ||= { model: m, cents: 0, calls: 0, sessions: 0 })
        mm.cents += v.cents; mm.calls += v.calls; mm.sessions++
      }
    }
    const total = cents(inw)
    const days = []
    for (let t = w.from; t <= w.to; t += DAYMS) { const d = dayKey(t); days.push({ day: d, cents: perDay[d] || 0 }) }

    // waste (a): sessions that cost money and produced no code at all
    const abandoned = inw.filter(s => s.linesAdded + s.linesRemoved === 0)
    const abByProject = {}
    for (const s of abandoned) {
      const k = s.folder || s.workspaceId || 'unknown'
      const p = (abByProject[k] ||= { folder: s.folder, cents: 0, sessions: 0 })
      p.cents += s.costCents; p.sessions++
    }
    // waste (b): the existing duplicate-prompt clusters, now carrying a dollar figure
    const costById = Object.fromEntries(sessions.map(s => [s.id, s.costCents]))
    const dupes = insights().dupes.map(d => ({ ...d, cents: (d.sessionIds || []).reduce((a, id) => a + (costById[id] || 0), 0) }))

    const aiLines = inw.reduce((a, s) => a + s.linesAdded, 0)
    // Cursor stopped writing usageData after lastPricedAt on this machine. A window with no priced
    // session is NOT "$0 spent" — it is "no data". Emit null + the reason, never a fake zero.
    const lastPricedAt = priced.length ? Math.max(...priced.map(s => s.lastUpdatedAt)) : null
    const span = (ms) => { const g = priced.filter(s => s.lastUpdatedAt >= now - ms); return g.length ? cents(g) : null }
    res.json({
      window: w, source: 'local composerData.usageData (self-only, never transmitted)',
      pricedSessions: inw.length, unpricedSessions: sessions.filter(s => inWin(s.lastUpdatedAt, w) && !s.costCents).length,
      coverage: {
        lastPricedAt, firstPricedAt: priced.length ? Math.min(...priced.map(s => s.lastUpdatedAt)) : null,
        pricedSessionsAllTime: priced.length, totalSessionsAllTime: sessions.length,
        stale: !!(lastPricedAt && now - lastPricedAt > 30 * DAYMS),
        note: lastPricedAt && now - lastPricedAt > 30 * DAYMS
          ? `usageData has not been written to this DB since ${dayKey(lastPricedAt)} — this Cursor build/plan stopped recording per-request cost locally. Windows after that date return null (no data), NOT zero. Do not render a $0 tile.`
          : null,
      },
      totals: {
        cents: inw.length ? total : null,
        cents30d: span(30 * DAYMS), cents90d: span(90 * DAYMS),
        centsMTD: mtd.length ? cents(mtd) : null,
        centsPerKAiLine: inw.length && aiLines ? +((total / aiLines) * 1000).toFixed(1) : null,
      },
      perDay: days,
      byProject: Object.values(byProject).sort((a, b) => b.cents - a.cents),
      byModel: Object.values(byModel).map(m => ({ ...m, sharePct: total ? +((m.cents / total) * 100).toFixed(1) : 0 })).sort((a, b) => b.cents - a.cents),
      waste: {
        abandoned: { sessions: abandoned.length, cents: cents(abandoned), byProject: Object.values(abByProject).sort((a, b) => b.cents - a.cents) },
        dupes: dupes.sort((a, b) => b.cents - a.cents).slice(0, 25),
      },
    })
  }))

  // ---- item 4: accept & ship rate. Kills the lines-typed stat. Repo/week only — never per person. ----
  app.get('/api/cursor/accept', guard((req, res) => {
    const w = windowOf(req.query)
    const series = acceptSeries(w)
    const sug = series.reduce((a, d) => a + d.suggested, 0), acc = series.reduce((a, d) => a + d.accepted, 0)
    const weeks = {}
    for (const d of series) {
      const wk = weekKey(d.ts)
      const b = (weeks[wk] ||= { week: wk, suggested: 0, accepted: 0 })
      b.suggested += d.suggested; b.accepted += d.accepted
    }
    // per-repo AI lines from cursorBlame (Cursor's own commit-level attribution) — the ship-rate numerator
    const byRepoWeek = {}
    for (const b of blameRows(w)) {
      if (!b.repo || !b.ts) continue
      const k = b.repo + '|' + weekKey(b.ts)
      const r = (byRepoWeek[k] ||= { repo: b.repo, week: weekKey(b.ts), aiLinesAdded: 0, humanLinesAdded: 0, commits: 0 })
      r.aiLinesAdded += b.aiLinesAdded; r.humanLinesAdded += b.humanLinesAdded; r.commits++
    }
    res.json({
      window: w,
      source: 'ItemTable aiCodeTracking.dailyStats.v1.5.* (Cursors own suggested-vs-accepted counters)',
      note: 'accept rate is NOT derived from toolFormerData.userDecision — measured 7403 accepted / 13 rejected, which is auto-accept mode, not judgement',
      days: series,
      weeks: Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week)),
      totals: { suggested: sug, accepted: acc, acceptRate: sug ? +(acc / sug).toFixed(4) : null, acceptedLineYield: acc },
      byRepoWeek: Object.values(byRepoWeek).sort((a, b) => b.week.localeCompare(a.week)),
      shipRateAt: '/api/cursor/ship — joins these repo/week AI lines to merged-PR additions',
    })
  }))

  // ---- item 7: wasted turns. toolFormerData.{name,status,error} was parsed and thrown away. ----
  app.get('/api/cursor/tools', guard((req, res) => {
    const { tools, fails, perSession } = bubbleStats()
    const w = windowOf(req.query)
    const recent = new Set(snapshot().sessions.filter(s => inWin(s.lastUpdatedAt, w)).map(s => s.id))
    const byTool = Object.entries(tools).map(([tool, t]) => ({
      tool, calls: t.calls, errors: t.errors,
      errorRate: t.calls ? +(t.errors / t.calls).toFixed(4) : 0,
      hot: t.calls >= 20 && t.errors / t.calls > 0.1, // red badge over a 10% error rate
    })).sort((a, b) => b.errors - a.errors)
    const wasted = fails.map(f => ({ ...f, pctOfToolCalls: tools[f.tool]?.calls ? +((f.count / tools[f.tool].calls) * 100).toFixed(1) : null }))
      .sort((a, b) => b.count - a.count)
    const sessTop = [...recent].map(id => ({ id, ...(perSession[id] || { toolCalls: 0, toolErrors: 0 }) }))
      .filter(s => s.toolErrors > 0).sort((a, b) => b.toolErrors - a.toolErrors).slice(0, 25)
    res.json({
      window: w, note: 'counts are all-history per tool (toolFormerData carries no timestamp); the session list is window-scoped',
      byTool, wasted, worstSessions: sessTop,
      totals: { calls: byTool.reduce((a, t) => a + t.calls, 0), errors: byTool.reduce((a, t) => a + t.errors, 0) },
    })
  }))

  // ---- item 12: model mix BY COST (not count chips) + wall-clock wait. Latency is LOCAL PLANE ONLY. ----
  app.get('/api/cursor/models', guard((req, res) => {
    const w = windowOf(req.query)
    const { perSession } = bubbleStats()
    const inw = snapshot().sessions.filter(s => inWin(s.lastUpdatedAt, w))
    const byModel = {}, weeks = {}
    let waitMs = 0, thinkMs = 0
    for (const s of inw) {
      const b = perSession[s.id] || { latencies: [], waitMs: 0, thinkMs: 0, turns: 0 }
      waitMs += b.waitMs; thinkMs += b.thinkMs
      // spend attributes per usageData model; latency attributes to the session's configured model
      for (const [m, v] of Object.entries(s.models)) {
        const e = (byModel[m] ||= { model: m, cents: 0, calls: 0, sessions: 0, latencies: [], thinkMs: 0, turns: 0 })
        e.cents += v.cents; e.calls += v.calls; e.sessions++
        const wk = weekKey(s.lastUpdatedAt)
        const k = (weeks[wk + '|' + m] ||= { week: wk, model: m, cents: 0, folder: null })
        k.cents += v.cents
      }
      const lm = s.model
      if (lm) {
        const e = (byModel[lm] ||= { model: lm, cents: 0, calls: 0, sessions: 0, latencies: [], thinkMs: 0, turns: 0 })
        e.latencies.push(...b.latencies); e.thinkMs += b.thinkMs; e.turns += b.turns
      }
    }
    const total = Object.values(byModel).reduce((a, m) => a + m.cents, 0)
    res.json({
      window: w, plane: 'local (self-only) — latency and thinking time never leave this machine',
      byModel: Object.values(byModel).map(m => ({
        model: m.model, cents: m.cents, calls: m.calls, sessions: m.sessions,
        sharePct: total ? +((m.cents / total) * 100).toFixed(1) : 0,
        turns: m.turns,
        p50LatencyMs: pct(m.latencies, 50), p90LatencyMs: pct(m.latencies, 90),
        thinkHours: +(m.thinkMs / 36e5).toFixed(2),
      })).sort((a, b) => b.cents - a.cents),
      byWeek: Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week)),
      wait: { totalHours: +(waitMs / 36e5).toFixed(2), thinkHours: +(thinkMs / 36e5).toFixed(2) },
      sledgehammerAt: '/api/cursor/outcomes — the small-PR-on-the-expensive-model ratio needs the PR join',
    })
  }))

  // ---- item 10: search everything I've ever asked. FTS5 sidecar, self-only, never aggregated. ----
  app.get('/api/cursor/search', guard((req, res) => {
    const q = String(req.query.q || '').trim()
    if (q.length < 2) return res.json({ q, results: [], total: 0 })
    const w = req.query.from || req.query.to || req.query.days ? windowOf(req.query) : null
    const { perSession } = bubbleStats()
    const byId = Object.fromEntries(snapshot().sessions.map(s => [s.id, s]))
    const role = req.query.role ? Number(req.query.role) : null // 1 = me, 2 = assistant
    const hits = ftsSearch(q, Number(req.query.limit) || 100)
    const results = []
    for (const h of hits) {
      const s = byId[h.sid]
      if (!s) continue
      if (role && h.role !== role) continue
      if (w && !inWin(s.lastUpdatedAt, w)) continue
      if (req.query.project && s.folder !== req.query.project && s.workspaceId !== req.query.project) continue
      if (req.query.hasError === '1' && !(perSession[h.sid]?.toolErrors > 0)) continue
      results.push({
        sessionId: h.sid, bubbleId: h.bid, role: h.role, snippet: h.snip,
        name: s.name, folder: s.folder, model: s.model, lastUpdatedAt: s.lastUpdatedAt,
        hasError: (perSession[h.sid]?.toolErrors || 0) > 0,
      })
    }
    res.json({ q, total: results.length, results })
  }))

  // ---- item 3: harness governance — one table, every repo, with push-to-all. ----
  app.get('/api/cursor/governance', guard((req, res) => {
    const ref = req.query.reference || null
    const rows = knownFolders().map(folder => {
      const h = harness(folder)
      let lastChange = null
      try {
        const r = spawnSync('git', ['-C', folder, 'log', '-1', '--format=%ct', '--', '.cursor'], { timeout: 8000 })
        if (r.status === 0 && r.stdout.toString().trim()) lastChange = Number(r.stdout.toString().trim()) * 1000
      } catch {}
      const alwaysTokens = h.context.tokens
      return {
        folder, name: path.basename(folder),
        agents: !!h.agents, agentsTokens: h.agents?.tokens || 0,
        legacy: !!h.legacy,
        alwaysRules: h.rules.filter(r => r.alwaysApply).length,
        globRules: h.rules.filter(r => !r.alwaysApply && r.globs).length,
        rules: h.rules.length, commands: h.commands.length, skills: h.skills.length,
        hooks: h.hooks, mcp: h.mcp.project.map(m => m.name), mcpGlobal: h.mcp.global.map(m => m.name),
        alwaysTokens, cursorLastChanged: lastChange,
        flags: [
          ...(!h.rules.length && !h.agents ? ['UNGOVERNED'] : []),
          ...(alwaysTokens > 4000 ? ['OBESE CONTEXT'] : []), // paid on every request by everyone, forever
        ],
      }
    }).sort((a, b) => b.alwaysTokens - a.alwaysTokens)
    const refRow = ref ? rows.find(r => r.folder === ref) : null
    if (refRow) for (const r of rows) r.diffs = ['agents', 'alwaysRules', 'hooks', 'mcp'].filter(k => JSON.stringify(r[k]) !== JSON.stringify(refRow[k]))
    res.json({ reference: ref, rows })
  }))

  // push a rule / command / AGENTS.md / MCP server into N repos. Dry-run first, backup, reversible.
  app.post('/api/cursor/governance/push', guard((req, res) => {
    const { kind, sourcePath, name, targets, dryRun = true, mcpConfig, mcpScope } = req.body || {}
    if (!Array.isArray(targets) || !targets.length) return res.status(400).json({ error: 'targets required' })
    const known = new Set(knownFolders())
    const bad = targets.filter(t => !known.has(t))
    if (bad.length) return res.status(403).json({ error: 'unknown target folder(s)', bad })
    const plan = []
    if (kind === 'mcp') {
      if (!name) return res.status(400).json({ error: 'name required' })
      for (const t of targets) {
        const file = path.join(t, '.cursor', 'mcp.json')
        const cur = readJson(file)?.mcpServers?.[name]
        plan.push({ target: t, file, action: cur ? 'overwrite' : 'create', before: cur || null, after: mcpConfig || null })
      }
      if (!dryRun) for (const t of targets) editMcp(t, s => { s[name] = mcpConfig || {} })
    } else {
      if (!sourcePath || !writable(sourcePath) || !fs.existsSync(sourcePath)) return res.status(400).json({ error: 'sourcePath required and must be a known .cursor/AGENTS.md path' })
      const content = fs.readFileSync(sourcePath, 'utf8')
      const base = path.basename(sourcePath)
      const rel = kind === 'agents' ? 'AGENTS.md' : kind === 'command' ? path.join('.cursor', 'commands', base) : path.join('.cursor', 'rules', base)
      for (const t of targets) {
        const dest = path.join(t, rel)
        if (!writable(dest)) return res.status(403).json({ error: 'destination not allowed: ' + dest })
        const before = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null
        plan.push({ target: t, file: dest, action: before == null ? 'create' : before === content ? 'identical' : 'overwrite', bytes: content.length })
        if (!dryRun && before !== content) { backup(dest); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, content) }
      }
    }
    res.json({ dryRun, kind, applied: !dryRun, plan })
  }))

  // ---- item 11: raw data escape hatch. Streaming NDJSON. Local plane only — the team plane
  // (server-cursor-team.mjs) is deliberately NOT exportable per-email. ----
  const EXPORT = {
    sessions: w => snapshot().sessions.filter(s => inWin(s.lastUpdatedAt, w)),
    blame: w => blameRows(w),
    tools: () => bubbleStats().fails,
    spend: w => snapshot().sessions.filter(s => s.costCents > 0 && inWin(s.lastUpdatedAt, w)).map(s => ({ id: s.id, folder: s.folder, model: s.model, costCents: s.costCents, models: s.models, lastUpdatedAt: s.lastUpdatedAt })),
    accept: w => acceptSeries(w),
    bubbles: w => {
      const ids = new Set(snapshot().sessions.filter(s => inWin(s.lastUpdatedAt, w)).map(s => s.id))
      return sq(`SELECT substr(key,10,36) sessionId, substr(key,47) bubbleId, json_extract(value,'$.type') role, json_extract(value,'$.text') text FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' AND length(json_extract(value,'$.text'))>0`, 256 * 1024 * 1024).filter(b => ids.has(b.sessionId))
    },
  }
  app.get('/api/cursor/export', guard((req, res) => {
    const kind = String(req.query.kind || '')
    if (!EXPORT[kind]) return res.status(400).json({ error: 'kind must be one of: ' + Object.keys(EXPORT).join('|') + '|join' })
    const rows = EXPORT[kind](windowOf(req.query))
    res.type('application/x-ndjson').set('Content-Disposition', `attachment; filename="cursor-${kind}.ndjson"`)
    for (const r of rows) res.write(JSON.stringify(r) + '\n')
    res.end()
  }))
}
export { windowOf, inWin, weekKey, dayKey, pct, bubbleStats, knownFolders }
