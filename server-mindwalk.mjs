// Mindwalk (github.com/cosmtrek/mindwalk) — replays an agent session as light moving over a
// 3D map of the repo. It's a Go binary that serves its own UI, so we run it as a child process
// on a fixed port and iframe it; we don't reimplement the renderer.
//
// Mindwalk only speaks Claude Code / Codex JSONL. Cursor keeps its sessions in sqlite instead,
// so for the Cursor source we transcode composers into Claude-shaped JSONL in a temp dir and
// start mindwalk with --claude-dir pointed at it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { cursorSnapshot } from './server-cursor.mjs'

const HOME = os.homedir()
const DB = path.join(HOME, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
const EXPORT_DIR = path.join(HOME, '.cache', 'mindwalk-cursor') // not tmpdir: the transcode is expensive, keep it across reboots
const PORTS = { claude: 8766, cursor: 8767 }
const SESSION_LIMIT = 60 // ponytail: most recent N Cursor composers; raise if you need older ones

function binary() {
  const local = path.join(HOME, '.local', 'bin', 'mindwalk')
  if (fs.existsSync(local)) return local
  const r = spawnSync('which', ['mindwalk'])
  return r.status === 0 ? r.stdout.toString().trim() : null
}

// ---- Cursor -> Claude Code JSONL ----
// Only the tools that touch the repo matter — mindwalk maps a session onto files, so todo_write,
// web_search, MCP calls and friends are dropped. Cursor renames tools freely across versions
// (read_file -> read_file_v2, ...) and each generation spells its arguments differently, so the
// key lookup below is deliberately generous rather than one shape per tool.
const MAP = {
  read_file: 'Read', read_file_v2: 'Read', read_lints: 'Read',
  edit_file: 'Edit', edit_file_v2: 'Edit', edit_file_v2_search_replace: 'Edit',
  search_replace: 'Edit', MultiEdit: 'Edit', delete_file: 'Edit',
  write: 'Write', create_file: 'Write', edit_file_v2_write: 'Write',
  list_dir: 'LS', list_dir_v2: 'LS',
  file_search: 'Glob', glob_file_search: 'Glob',
  grep: 'Grep', grep_search: 'Grep', ripgrep_raw_search: 'Grep',
  codebase_search: 'Grep', semantic_search_full: 'Grep',
  run_terminal_cmd: 'Bash', run_terminal_command_v2: 'Bash',
}

const pick = (a, ...keys) => { for (const k of keys) if (typeof a[k] === 'string' && a[k]) return a[k]; return '' }
const FILE = a => pick(a, 'file_path', 'target_file', 'targetFile', 'path', 'relativeWorkspacePath', 'effectiveUri')
const DIR = a => pick(a, 'path', 'target_directory', 'targetDirectory', 'relative_workspace_path')
const PATTERN = a => pick(a, 'pattern', 'query', 'glob_pattern', 'globPattern')

function inputFor(tool, a) {
  switch (MAP[tool]) {
    case 'Read': return { file_path: tool === 'read_lints' ? (Array.isArray(a.paths) ? a.paths[0] : a.paths || '') : FILE(a) }
    case 'Edit': case 'Write': return { file_path: FILE(a) }
    case 'LS': return { path: DIR(a) }
    case 'Glob': return { pattern: PATTERN(a), path: DIR(a) }
    case 'Grep': return { pattern: PATTERN(a), path: pick(a, 'include_pattern') || DIR(a) }
    case 'Bash': return { command: pick(a, 'command') }
    default: return null
  }
}

const sq = (sql, maxBuffer = 64 * 1024 * 1024) => {
  const r = spawnSync('sqlite3', ['-json', `file:${DB}?mode=ro`, sql], { timeout: 120_000, maxBuffer })
  if (r.status !== 0) throw new Error('sqlite3: ' + (r.stderr || '').toString().slice(0, 200))
  const out = r.stdout.toString().trim()
  return out ? JSON.parse(out) : []
}

const mangle = dir => dir.replace(/[\\/:._]/g, '-') // same shape as Claude Code's project dirs

// bubbleId rows are multi-MB blobs in a multi-GB table, so pull only the fields we need and do it
// in ONE scan for every session we're exporting — a per-session LIKE scan takes minutes.
function bubblesFor(ids) {
  const list = ids.map(id => `'${id}'`).join(',')
  const rows = sq(`SELECT substr(key,10,36) cid, substr(key,47) bid,
      json_extract(value,'$.type') type,
      substr(json_extract(value,'$.text'),1,4000) text,
      json_extract(value,'$.toolFormerData.name') tool,
      json_extract(value,'$.toolFormerData.rawArgs') args,
      substr(json_extract(value,'$.toolFormerData.params'),1,4000) params,
      json_extract(value,'$.toolFormerData.toolCallId') tid,
      json_extract(value,'$.toolFormerData.status') status,
      substr(json_extract(value,'$.toolFormerData.result'),1,8000) result
    FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' AND substr(key,10,36) IN (${list}) ORDER BY rowid`, 256 * 1024 * 1024)
  const by = {}
  for (const r of rows) (by[r.cid] ||= []).push(r)
  return by
}

// rowid order matches fullConversationHeadersOnly, which is where the real per-bubble timestamps
// live. Pull those separately; fall back to synthesized timestamps when a composer has no headers.
function headerTimes(ids) {
  const list = ids.map(id => `'${id}'`).join(',')
  const rows = sq(`SELECT substr(key,14) cid, json_extract(value,'$.fullConversationHeadersOnly') h
    FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND substr(key,14) IN (${list})`, 128 * 1024 * 1024)
  const by = {}
  for (const r of rows) {
    try { for (const h of JSON.parse(r.h || '[]')) if (h.createdAt) (by[r.cid] ||= {})[h.bubbleId] = h.createdAt } catch {}
  }
  return by
}

// Cursor's recorded workspace folder goes stale when a repo is moved or renamed, and mindwalk
// maps a session onto the tree at cwd — a stale cwd means an empty map. The paths the agent
// actually touched are the better witness, so fall back to their deepest existing common parent.
// A common path prefix is the wrong anchor — a session that touches two repos would land on
// their shared parent (often $HOME), and mindwalk would try to map the whole thing. Anchor on
// the git root the session's files actually live in, and take the busiest one.
function repoRootOf(file) {
  let dir = path.dirname(file)
  while (dir.length > 1 && dir !== HOME) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    dir = path.dirname(dir)
  }
  return ''
}

function resolveCwd(folder, calls) {
  if (folder && fs.existsSync(folder)) return folder
  const hits = {}
  for (const c of calls) {
    const f = c.file_path || c.path || ''
    if (!f.startsWith('/')) continue
    const root = repoRootOf(f)
    if (root) hits[root] = (hits[root] || 0) + 1
  }
  const best = Object.entries(hits).sort((a, b) => b[1] - a[1])[0]
  return best ? best[0] : folder
}

function transcode(session, bubbles, times) {
  const parse = s => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} } }

  const steps = bubbles.map((b, i) => {
    const ts = times?.[b.bid] || new Date((session.createdAt || Date.now()) + i * 1000).toISOString()
    if (b.tool && MAP[b.tool]) {
      // the *_v2 tools leave rawArgs empty and put camelCased arguments in params instead
      const input = inputFor(b.tool, { ...parse(b.params), ...parse(b.args) })
      if (!input || !Object.values(input).some(Boolean)) return null
      return { ts, tool: MAP[b.tool], input, id: b.tid || `${b.bid}-${i}`, result: String(b.result || ''), error: b.status === 'error' }
    }
    if (b.type === 1 && b.text) return { ts, text: b.text }
    return null
  }).filter(Boolean)

  const cwd = resolveCwd(session.folder, steps.map(s => s.input).filter(Boolean))
  const lines = []
  const push = (type, at, content) => lines.push(JSON.stringify({
    type, timestamp: at, sessionId: session.id, cwd,
    message: { role: type, model: session.model || undefined, content },
  }))

  // mindwalk reads its session-list title from an ai-title line; without one it shows the filename
  if (session.name) lines.push(JSON.stringify({ type: 'ai-title', timestamp: steps[0]?.ts || new Date(session.createdAt || Date.now()).toISOString(), sessionId: session.id, aiTitle: session.name }))

  for (const s of steps) {
    if (s.text) { push('user', s.ts, [{ type: 'text', text: s.text }]); continue }
    push('assistant', s.ts, [{ type: 'tool_use', id: s.id, name: s.tool, input: s.input }])
    // mindwalk mines Grep/Glob/LS result text for the paths that were hit
    push('user', s.ts, [{ type: 'tool_result', tool_use_id: s.id, content: s.result, is_error: s.error }])
  }
  return lines
}

// Rebuilds only what changed: a composer whose .jsonl is newer than its lastUpdatedAt is skipped.
function exportCursor() {
  const { sessions } = cursorSnapshot()
  const usable = sessions.filter(s => s.folder && s.messages > 0).slice(0, SESSION_LIMIT)
  const fileFor = s => path.join(EXPORT_DIR, mangle(s.folder), s.id + '.jsonl')
  const stale = usable.filter(s => {
    const f = fileFor(s)
    return !fs.existsSync(f) || fs.statSync(f).mtimeMs < (s.lastUpdatedAt || s.createdAt || 0)
  })
  if (!stale.length) return { sessions: usable.length, rebuilt: 0, dir: EXPORT_DIR }

  const ids = stale.map(s => s.id)
  const bubbles = bubblesFor(ids)
  const times = headerTimes(ids)
  let written = 0
  for (const s of stale) {
    const lines = transcode(s, bubbles[s.id] || [], times[s.id])
    if (!lines.length) continue
    const f = fileFor(s)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, lines.join('\n') + '\n')
    written++
  }
  return { sessions: usable.length, rebuilt: written, dir: EXPORT_DIR }
}

// ---- child process per source ----
const procs = {} // source -> ChildProcess
const alive = source => procs[source] && procs[source].exitCode === null

async function serve(source) {
  const bin = binary()
  if (!bin) throw new Error('mindwalk is not installed')
  if (alive(source)) return PORTS[source]
  const args = ['serve', '--port', String(PORTS[source]), '--no-open']
  if (source === 'cursor') {
    exportCursor()
    // point both adapters away from the real dirs so the Cursor view shows only Cursor sessions
    args.push('--claude-dir', EXPORT_DIR, '--codex-dir', path.join(EXPORT_DIR, '.none'))
  }
  const child = spawn(bin, args, { stdio: 'ignore', detached: false })
  child.on('exit', () => { if (procs[source] === child) delete procs[source] })
  procs[source] = child

  // don't answer until the port is actually listening — the UI drops the iframe straight onto it
  const url = `http://127.0.0.1:${PORTS[source]}/`
  for (let i = 0; i < 50; i++) {
    try { await fetch(url); return PORTS[source] } catch {}
    if (!alive(source)) throw new Error('mindwalk exited on startup')
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('mindwalk did not start listening')
}

process.on('exit', () => Object.values(procs).forEach(c => c.kill()))

export default function mountMindwalk(app) {
  app.get('/api/mindwalk/status', (_req, res) => {
    res.json({
      installed: !!binary(),
      install: 'curl -fsSL https://raw.githubusercontent.com/cosmtrek/mindwalk/master/scripts/install.sh | sh',
      sources: Object.fromEntries(Object.keys(PORTS).map(s => [s, { port: PORTS[s], running: alive(s) }])),
    })
  })

  // Starting the Cursor source transcodes first, so this can take a few seconds on a cold run.
  app.post('/api/mindwalk/serve', async (req, res) => {
    const source = req.body?.source === 'cursor' ? 'cursor' : 'claude'
    try { res.json({ ok: true, source, port: await serve(source) }) }
    catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }) }
  })

  app.post('/api/mindwalk/stop', (_req, res) => {
    Object.values(procs).forEach(c => c.kill())
    res.json({ ok: true })
  })
}
