// A child killed by a SIGNAL is not a clean exit.
//
// The gap this closes was recorded as already closed. The finding was "a killed / non-zero-exit
// agent run reports done", and the fix was two things: `timedOut` in lib/agent.mjs, and
// server/research.mjs folding the exit CODE into the error. Neither covers a signal:
//
//   · `timedOut` is set only by lib/agent.mjs's own timer, so it says nothing about a kill from
//     anywhere else — the OOM killer, `pkill claude`, or a Ctrl-C delivered to the whole process
//     group, which is what happens to a dev server started from a terminal.
//   · a signal death sets `code` to NULL, so `code ? \`exited with code ${code}\` : null` — the
//     exact expression in research.mjs — evaluates to null. `{code: null, error: null}` is
//     byte-for-byte what a clean finish looks like.
//
// Both callers act on a null error: server/research.mjs publishes the run as `done`, and
// server/ticket.mjs renames the STAGED document into its final path as though the agent had
// finished writing it. So the fold lives in lib/agent.mjs, where every caller gets it.
//
// This drives a real child process rather than a stub, because the whole bug was a wrong belief
// about what Node's 'exit' event carries.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'

// `spawnAgent` spawns `claude`, which is not present in this environment, so the exit path is
// exercised by re-creating it against a real child: the same handler shape, on a process we kill.
// The shape is pinned against the source below, so this cannot drift into testing nothing.
test("Node's 'exit' really does report code=null and a signal name", async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'])
  const seen = await new Promise(resolve => {
    child.on('exit', (code, signal) => resolve({ code, signal }))
    setTimeout(() => child.kill('SIGKILL'), 50)
  })
  assert.equal(seen.code, null, 'a signal death has no exit code — this is the whole bug')
  assert.equal(seen.signal, 'SIGKILL')

  // And the expression research.mjs uses on that payload produces no error at all.
  const asResearchWouldRead = seen.code ? `exited with code ${seen.code}` : null
  assert.equal(asResearchWouldRead, null,
    'folding only the CODE cannot distinguish a killed agent from a finished one')
})

test('lib/agent.mjs passes the signal through and turns it into an error', () => {
  const src = readFileSync(new URL('../../lib/agent.mjs', import.meta.url), 'utf8')
  assert.match(src, /child\.on\('exit', \(code, signal\) =>/,
    "the 'exit' handler must take the signal, not just the code")
  assert.match(src, /payload\?\.signal && !payload\?\.error/,
    'a signal with no error must be turned into an error')
  assert.match(src, /finish\(\{ code, signal: signal \|\| null, error: null \}\)/)
})

test('the fold turns {signal} into an error and leaves a clean exit alone', () => {
  // The fold, exercised directly on the four payload shapes that reach it.
  const src = readFileSync(new URL('../../lib/agent.mjs', import.meta.url), 'utf8')
  const line = src.split('\n').find(l => l.includes('payload?.signal && !payload?.error'))
  assert.ok(line, 'the fold should be one line, so it can be evaluated here')
  const fold = new Function('payload', 'timeoutMs', `
    let timedOut = false
    ${line.trim().replace(/^else /, '')}
    return payload`)

  assert.equal(fold({ code: 0, signal: null, error: null }).error, null, 'a clean exit stays clean')
  assert.equal(fold({ code: 1, signal: null, error: null }).error, null, 'a code is the caller\'s to fold')
  assert.match(fold({ code: null, signal: 'SIGKILL', error: null }).error, /killed \(SIGKILL\)/)
  assert.match(fold({ code: null, signal: 'SIGTERM', error: null }).error, /killed \(SIGTERM\)/)
  assert.equal(fold({ code: null, signal: 'SIGKILL', error: 'the real reason' }).error, 'the real reason',
    'an error already established must not be overwritten by the signal')
})

test('research.mjs and ticket.mjs both treat a null error as success, which is why this matters', () => {
  const research = readFileSync(new URL('../../server/research.mjs', import.meta.url), 'utf8')
  const ticket = readFileSync(new URL('../../server/ticket.mjs', import.meta.url), 'utf8')
  // research: `finish` publishes `done` when nothing set an error…
  assert.match(research, /r\.status = r\.cancelled \? 'cancelled' : error \? 'error' : 'done'/)
  // …and ticket promotes the staged file out of the staging path on the same signal.
  assert.match(ticket, /const clean = !run\.cancelled && !error/)
  assert.match(ticket, /fs\.renameSync\(stageAbs, abs\)/)
})

// Guards the one-shot property across the new branch, since `finish` grew a case.
test('onExit still fires exactly once when a child is killed', async () => {
  const calls = []
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => {}
  // Emitting both 'error' and 'exit', which a killed child can do, must still produce one call.
  const ended = { v: false }
  const finish = payload => {
    if (ended.v) return; ended.v = true
    calls.push(payload)
  }
  child.on('error', e => finish({ code: null, error: e.message }))
  child.on('exit', (code, signal) => finish({ code, signal: signal || null, error: null }))
  child.emit('exit', null, 'SIGKILL')
  child.emit('error', new Error('and then this'))
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { code: null, signal: 'SIGKILL', error: null })
})
