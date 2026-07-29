
import { spawn } from 'node:child_process'

const WIN = process.platform === 'win32'

export function runAgent({ cwd, prompt, model, timeoutMs = 1800_000, resume }) {
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

/**
 * Streamed run. Returns a handle immediately; `onEvent` fires per stream-json event.
 * The caller owns the handle so run state can live on the SERVER, keyed by ticket — a client-owned
 * run dies when React remounts the section, and src/App.jsx's refresh() remounts on every click.
 *
 * @returns {{kill(): void, get alive(): boolean}}
 */
export function spawnAgent({ cwd, prompt, model, resume, timeoutMs = 1800_000, onEvent, onExit }) {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions']
  if (model) args.push('--model', model)
  if (resume) args.push('--resume', resume)

  let child
  try {
    child = spawn('claude', args, { cwd, env: process.env, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    onEvent?.({ type: 'closed', error: e.message })
    onExit?.({ code: null, error: e.message })
    return { kill() {}, get alive() { return false } }
  }

  let alive = true
  let buf = ''
  let ended = false
  const finish = payload => { if (ended) return; ended = true; alive = false; clearTimeout(timer); onExit?.(payload) }
  const timer = setTimeout(() => { try { child.kill() } catch {} }, timeoutMs)

  child.stdout.on('data', d => {
    buf += d
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try { onEvent?.(JSON.parse(line)) } catch {}
    }
  })
  child.stderr.on('data', d => onEvent?.({ type: 'stderr', text: String(d).slice(0, 2000) }))
  child.on('error', e => {
    if (!ended) onEvent?.({ type: 'closed', error: e.message })
    finish({ code: null, error: e.message })
  })
  child.on('exit', code => {
    if (!ended) onEvent?.({ type: 'closed', code })
    finish({ code, error: null })
  })

  return {
    kill() { try { child.kill() } catch {} },
    get alive() { return alive },
  }
}
