#!/usr/bin/env node
// scripts/hook-handler.mjs — the sender half of feature 043.
//
// Claude Code spawns this once per hook event, writes the event JSON to our stdin, and waits for us
// to exit. We POST that JSON to every live dashboard and get out of the way.
//
// ============================================================================================
// THE HARD REQUIREMENT: NEVER FAIL, NEVER BLOCK
// ============================================================================================
// Claude Code treats a hook's exit code as a verdict on the agent's turn — exit 2 is a BLOCKING
// error, and anything non-zero is at minimum surfaced as a failure. It also parses a hook's stdout
// as JSON control output when the hook exits 0. Both facts make this script's failure modes far more
// dangerous than "the dashboard misses an event":
//
//   * A dashboard that is not running MUST NOT fail the turn.  -> every error path exits 0.
//   * A dashboard that is running but wedged MUST NOT hang the turn. -> hard watchdog, see below.
//   * Nothing may ever be printed to stdout. -> a stray console.log would be parsed as hook control
//     output and could, at best, produce a confusing error and, at worst, alter the agent's run.
//     Diagnostics go to stderr and only when DASH_HOOK_DEBUG is set.
//
// This is why the whole body is wrapped, why uncaughtException/unhandledRejection are trapped, and
// why process.exitCode is never anything but 0. There is no failure of this script that is worth
// interrupting a developer's agent for.
//
// ============================================================================================
// WHAT "FIRE AND FORGET" MEANS HERE, PRECISELY
// ============================================================================================
// We do not await the HTTP *response*. We do wait for the request to flush out of our own socket
// buffer ('finish'), because exiting before that discards the bytes and the event is simply lost —
// a "fire and forget" that reliably forgets nothing is not a feature. On loopback that flush is
// sub-millisecond. A watchdog caps the entire process regardless.
//
// ============================================================================================
// TRUST
// ============================================================================================
// stdin comes from Claude Code, but we treat it as untrusted anyway: it is size-capped, and it is
// forwarded as an opaque byte string. This script never parses a field out of it, never interpolates
// it into a path, a command, or a URL, and never spawns anything. The URL is built entirely from
// discovery output (see resolveTargets in server/hooks-receiver.mjs).
//
// ============================================================================================
// INSTALLING IT (settings.json)
// ============================================================================================
//   { "hooks": { "PreToolUse": [ { "matcher": "", "hooks": [
//       { "type": "command", "command": "node /abs/path/to/loush-dashboard/scripts/hook-handler.mjs" }
//   ] } ] } }
// Repeat per event name. Port discovery is automatic; DASH_PORT overrides it.

import http from 'node:http'
import { resolveTargets } from '../server/hooks-receiver.mjs'

// --- bounds, all deliberate and all stated -------------------------------------------------------

// Matches the receiver's maxBodyBytes. Reading more than the receiver will accept is pure waste.
const MAX_STDIN_BYTES = 256 * 1024
// Cap on the whole process. If stdin never closes or a socket wedges, we leave anyway. Chosen to be
// far longer than a loopback POST needs and far shorter than a human would notice per tool call.
const WATCHDOG_MS = 750
// Per-request socket timeout, so one dead target cannot consume the entire watchdog budget.
const SOCKET_TIMEOUT_MS = 300
// Reading stdin is capped separately: a hook invoked with no stdin at all must not sit there.
const STDIN_TIMEOUT_MS = 400

const debug = (...a) => { if (process.env.DASH_HOOK_DEBUG) { try { process.stderr.write(`[hook-handler] ${a.join(' ')}\n`) } catch { /* stderr can be closed too */ } } }

// Single exit point. Always 0. Duplicated calls are harmless.
let exiting = false
function done(why) {
  if (exiting) return
  exiting = true
  debug('exit:', why)
  process.exit(0)
}

// Belt and braces: even a bug in this file exits clean.
process.on('uncaughtException', e => { debug('uncaught', e && e.message); done('uncaught') })
process.on('unhandledRejection', e => { debug('unhandled', e && String(e)); done('unhandled') })
// EPIPE on stdout/stderr is normal when the parent stops reading; it must not become an exception.
process.stdout.on('error', () => {})
process.stderr.on('error', () => {})

const watchdog = setTimeout(() => done('watchdog'), WATCHDOG_MS)
watchdog.unref?.()

function readStdin() {
  return new Promise(resolve => {
    const chunks = []
    let size = 0
    let settled = false
    const finish = () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks).toString('utf8')) } }
    const timer = setTimeout(finish, STDIN_TIMEOUT_MS)
    timer.unref?.()
    process.stdin.on('data', c => {
      size += c.length
      // Truncate rather than abort: a partial POST is rejected by the receiver as bad JSON, which is
      // a visible, counted rejection. Sending nothing at all would be indistinguishable from "no
      // dashboard running", and silent ambiguity is the thing this feature exists to remove.
      if (size <= MAX_STDIN_BYTES) chunks.push(c)
      else { clearTimeout(timer); finish() }
    })
    process.stdin.on('end', () => { clearTimeout(timer); finish() })
    process.stdin.on('error', () => { clearTimeout(timer); finish() })
  })
}

// POSTs `body` to one origin. Resolves when our own bytes are flushed — NOT when the server answers.
function post(origin, body) {
  return new Promise(resolve => {
    let settled = false
    const finish = why => { if (!settled) { settled = true; debug(origin, why); resolve() } }
    let url
    try { url = new URL('/api/hooks/event', origin) } catch { return finish('bad-origin') }

    const req = http.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        // Lets the receiver-side host guard see a loopback Host even when hostname is an IP literal.
        'user-agent': 'loush-hook-handler/1',
      },
    }, res => {
      // We do not read the body, but we must not leave the socket half-open holding the event loop.
      res.resume()
      finish(`response ${res.statusCode}`)
    })

    req.setTimeout(SOCKET_TIMEOUT_MS, () => { req.destroy(); finish('timeout') })
    // ECONNREFUSED is the expected steady state when no dashboard is running. It is not an error
    // worth reporting anywhere the user can see.
    req.on('error', e => finish(`error ${e && e.code}`))
    // The actual fire-and-forget point: once our bytes are on the wire we consider this target done.
    req.on('finish', () => finish('flushed'))
    req.end(body)
  })
}

async function main() {
  const body = await readStdin()
  if (!body.trim()) return done('empty stdin')

  const { source, targets } = resolveTargets(process.env)
  debug('targets via', source, targets.join(','))
  if (!targets.length) return done('no targets')

  // Fan out in parallel; one dead dashboard must not delay a live one.
  await Promise.all(targets.map(t => post(t, body)))
  done('sent')
}

main().catch(e => { debug('main', e && e.message); done('main-error') })
