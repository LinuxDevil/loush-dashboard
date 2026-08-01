import { HOME, propose, readJson, track } from './dashboard-core.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

let scanTranscripts, settingsFileFor

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
  { name: 'truncate-tool-result', event: 'PostToolUse', matcher: 'Read', description: 'caps an oversized tool result — keeps the head, tells the model what was cut (params: tool, maxChars)',
    params: { tool: 'Read', maxChars: 20000 }, command: truncateCmd('Read', 20000) },
]

function resolvePattern(name, params) {
  const pat = HOOK_LIBRARY.find(h => h.name === name)
  if (!pat || !pat.params) return pat
  const p = { ...pat.params, ...(params || {}) }
  const tool = String(p.tool || pat.params.tool).replace(/[^\w|]/g, '')
  const maxChars = Math.max(500, Math.min(500_000, Number(p.maxChars) || pat.params.maxChars))
  return { ...pat, matcher: tool, params: { tool, maxChars }, command: truncateCmd(tool, maxChars) }
}

export default function mountNativeHooks(app, deps) {
  ({ scanTranscripts, settingsFileFor } = deps)

app.post('/api/hooks/test', (req, res) => {
  const { matcher, tool } = req.body
  let fires, note = '', invalidMatcher = false
  if (!matcher) { fires = true; note = 'empty matcher matches every tool' }
  else try { fires = new RegExp(`^(${matcher})$`).test(tool || '') } catch (e) {
    // An invalid matcher degrades to an exact string comparison, which almost never matches — so
    // the hook looks installed and silently does nothing. The note is the only thing that says
    // otherwise, and it must carry the parse error, not just the fact of a fallback.
    fires = matcher === tool
    note = `invalid regex (${e.message}) — fell back to an exact string match, so this hook will only ever fire on a tool named exactly "${matcher}"`
    invalidMatcher = true
  }
  res.json({ fires, note, invalidMatcher })
})

// Claude Code runs a hook command through the platform shell. Mirroring that here is what makes
// a dry run mean anything — running it through a different interpreter would test something the
// harness will never do.
function shellFor() {
  if (process.platform === 'win32') return { cmd: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c'] }
  return { cmd: process.env.SHELL && process.env.SHELL.includes('sh') ? process.env.SHELL : '/bin/sh', args: ['-c'] }
}

app.post('/api/hooks/dryrun', (req, res) => {
  const { command, event = 'PreToolUse', toolName = 'Bash', toolInput = {} } = req.body
  if (!command) return res.status(400).json({ error: 'command required' })
  const payload = JSON.stringify({ hook_event_name: event, tool_name: toolName, tool_input: toolInput, cwd: HOME, session_id: 'dryrun' })
  // `sh` does not exist on Windows, so this did not fail loudly — it failed to SPAWN, and the
  // dry run reported "spawn error" for every hook regardless of whether the hook was correct.
  // The user cannot tell a broken hook from an unsupported platform. Use the platform's own
  // shell, and if there isn't one, say so instead of reporting the hook as faulty.
  const sh = shellFor()
  if (!sh) return res.json({ exit: null, decision: 'cannot run here', stderr: `no shell available on ${process.platform} — this is a limitation of the dry run, not a fault in the hook`, platform: process.platform })
  const child = spawn(sh.cmd, [...sh.args, command], { cwd: HOME, env: process.env, shell: false })
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

app.get('/api/hooks/library', (req, res) => res.json(HOOK_LIBRARY))

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
}
