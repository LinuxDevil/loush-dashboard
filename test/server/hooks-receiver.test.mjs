import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import {
  mountHooksReceiver, createHookStore, hookEventHandler, liveViewHandler,
  normalizeEvent, applyEvent, getLiveState, readBody, resolveTargets,
  HOOK_EVENTS, LIMITS, ROUTES, UNKNOWN, DEFAULT_DASH_PORT, MAX_INSTANCES,
} from '../../server/hooks-receiver.mjs'

// The handler is exercised directly with stubs — no port is ever bound, so the suite cannot collide
// with a dashboard already running on the developer's machine and stays fast enough to run on save.
const mkRes = () => ({
  statusCode: null, body: null, ended: false,
  status(c) { this.statusCode = c; return this },
  json(b) { this.body = b; this.ended = true; return this },
})

// A request whose body express already parsed (the shape index.mjs's global express.json produces).
const mkReq = (body, over = {}) => ({ method: 'POST', headers: {}, body, ...over })

// A request that is still a raw stream — the path that enforces our own byte cap.
const mkStreamReq = (text, over = {}) => Object.assign(Readable.from([Buffer.from(text)]), { method: 'POST', headers: {}, ...over })

const ev = (name, extra = {}) => ({ hook_event_name: name, session_id: 's1', ...extra })

// Fires the POST handler and returns the response stub. `await` matters: the handler intentionally
// answers before it mutates the store, so the store is only settled once the promise resolves.
const send = async (store, body, opts) => {
  const res = mkRes()
  await hookEventHandler(store, opts)(mkReq(body), res)
  return res
}

const sessionOf = (store, id = 's1') => getLiveState(store).sessions.find(s => s.sessionId === id)

// ---------------------------------------------------------------------------------------------
// event vocabulary

test('all nine real Claude Code hook events are accepted', async () => {
  // Guards the regression where the feature brief's "8 standard hook types" is taken literally and
  // SessionEnd (or PreCompact) is rejected — a dropped SessionEnd leaves a session pinned "live"
  // forever in the UI, which is exactly the confidently-wrong state this module exists to avoid.
  assert.equal(HOOK_EVENTS.length, 9)
  const store = createHookStore()
  for (const name of HOOK_EVENTS) {
    const res = await send(store, ev(name))
    assert.equal(res.statusCode, 202, `${name} must be accepted`)
    assert.equal(res.body.accepted, name)
  }
  assert.equal(store.totals.rejected, 0)
})

test('an unrecognised event name is rejected and answers with the whitelist', async () => {
  // Guards against a typo'd or invented hook name silently minting state: an attacker (or a broken
  // settings.json) must not be able to create arbitrary keys, and the operator must be able to see
  // that it happened rather than wonder why nothing appears.
  const store = createHookStore()
  const res = await send(store, ev('PostToolUseFailure'))
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.ok, false)
  assert.equal(res.body.error, 'unknownEvent')
  assert.deepEqual(res.body.allowed, HOOK_EVENTS)
  assert.equal(store.rejected.unknownEvent, 1)
  assert.equal(getLiveState(store).sessionCount, 0, 'a rejected event must create no state')
  assert.equal(getLiveState(store).rejected.lastUnknownEventName, 'PostToolUseFailure')
})

test('a non-object body is rejected instead of being coerced into a session', async () => {
  // Guards `JSON.parse("null")` / arrays / bare strings reaching normalizeEvent and producing an
  // undefined-keyed session.
  const store = createHookStore()
  for (const bad of [null, 'PreToolUse', 42, ['PreToolUse']]) {
    const res = await send(store, bad)
    assert.equal(res.statusCode, 400, `${JSON.stringify(bad)} must be rejected`)
  }
  assert.equal(getLiveState(store).sessionCount, 0)
})

// ---------------------------------------------------------------------------------------------
// "unknown is a value"

test('an event with no session_id lands in an explicitly-unknown bucket, not the newest session', async () => {
  // Guards the tempting bug of attributing an unattributable event to whichever session was most
  // recently seen — that silently corrupts the one session a user is actually watching.
  const store = createHookStore()
  await send(store, ev('UserPromptSubmit', { session_id: 'real' }))
  await send(store, { hook_event_name: 'PreToolUse', tool_name: 'Bash' })

  const view = getLiveState(store)
  assert.equal(view.sessionCount, 2)
  const orphan = view.sessions.find(s => !s.sessionIdKnown)
  assert.ok(orphan, 'the unattributable event needs its own bucket')
  assert.equal(orphan.sessionId, UNKNOWN)
  assert.equal(view.sessions.find(s => s.sessionId === 'real').counts.PreToolUse, 0, 'must not be merged into the real session')
})

test('a session whose first event carries no context reports unknown, never a plausible default', async () => {
  // Guards defaults like status:'idle' or model:'sonnet' being invented for fields no event supplied.
  const store = createHookStore()
  await send(store, { hook_event_name: 'Notification', session_id: 's1' })
  const s = sessionOf(store)
  assert.equal(s.status, UNKNOWN, 'Notification alone does not reveal what the session is doing')
  assert.equal(s.cwd, UNKNOWN)
  assert.equal(s.model, UNKNOWN)
  assert.equal(s.permissionMode, UNKNOWN)
  assert.equal(s.lastNotification.type, UNKNOWN, 'a notification with no type is unknown, not "info"')
})

test('a PreToolUse with no tool_name reports an unknown tool rather than omitting the running tool', async () => {
  // Guards both halves: inventing a tool name, and dropping the fact that SOMETHING is running.
  const store = createHookStore()
  await send(store, ev('PreToolUse'))
  const s = sessionOf(store)
  assert.equal(s.status, 'running-tool')
  assert.equal(s.currentTool.name, UNKNOWN)
})

test('a field absent from a later event does not erase what an earlier event established', async () => {
  // Guards the "last event wins, including its blanks" bug that would flicker cwd/model back to
  // unknown on every PreToolUse.
  const store = createHookStore()
  await send(store, ev('SessionStart', { cwd: '/repo', model: 'opus', permission_mode: 'default' }))
  await send(store, ev('PreToolUse', { tool_name: 'Read' }))
  const s = sessionOf(store)
  assert.equal(s.cwd, '/repo')
  assert.equal(s.model, 'opus')
  assert.equal(s.permissionMode, 'default')
})

// ---------------------------------------------------------------------------------------------
// status derivation

test('the mid-turn lifecycle moves through working, running-tool and back to idle', async () => {
  // The core capability: the whole feature is worthless if the status does not change while the turn
  // is still open. Guards any regression that only updates state on Stop.
  const store = createHookStore()
  await send(store, ev('SessionStart'))
  assert.equal(sessionOf(store).status, 'idle')
  await send(store, ev('UserPromptSubmit', { user_input: 'hi' }))
  assert.equal(sessionOf(store).status, 'working')
  await send(store, ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 't1' }))
  assert.equal(sessionOf(store).status, 'running-tool')
  await send(store, ev('PostToolUse', { tool_name: 'Bash', tool_use_id: 't1' }))
  assert.equal(sessionOf(store).status, 'working')
  assert.equal(sessionOf(store).currentTool, null)
  await send(store, ev('Stop'))
  assert.equal(sessionOf(store).status, 'idle')
})

test('Notification and SubagentStop do not move the parent session status', async () => {
  // Guards two specific false signals: a permanent "waiting for you" badge derived from any
  // Notification, and a session resurrected to "working" by a subagent finishing after the user
  // already stopped the turn.
  const store = createHookStore()
  await send(store, ev('Stop'))
  await send(store, ev('Notification', { notification_type: 'idle', message: 'still there?' }))
  assert.equal(sessionOf(store).status, 'idle')
  await send(store, ev('SubagentStop', { agent_id: 'a1' }))
  assert.equal(sessionOf(store).status, 'idle')
})

test('a PostToolUse for a different tool_use_id leaves the open tool call standing', async () => {
  // Guards the parallel-tool-call case: closing whatever happens to be current on any PostToolUse
  // would show a tool as finished while it is still running.
  const store = createHookStore()
  await send(store, ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 't1' }))
  await send(store, ev('PostToolUse', { tool_name: 'Read', tool_use_id: 't2' }))
  assert.equal(sessionOf(store).currentTool.toolUseId, 't1', 'the unrelated result must not clear it')
  await send(store, ev('PostToolUse', { tool_name: 'Bash', tool_use_id: 't1' }))
  assert.equal(sessionOf(store).currentTool, null)
})

test('SessionEnd records the exit reason and clears any tool that was still open', async () => {
  // Guards a killed session leaving a phantom "running Bash" tile on the dashboard forever.
  const store = createHookStore()
  await send(store, ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 't1' }))
  await send(store, ev('SessionEnd', { exit_reason: 'logout' }))
  const s = sessionOf(store)
  assert.equal(s.status, 'ended')
  assert.equal(s.currentTool, null)
  assert.equal(s.lastStopReason, 'logout')
})

// ---------------------------------------------------------------------------------------------
// bounds — every one of them reported

test('the session map is bounded and the eviction is counted, not silent', async () => {
  // Guards unbounded growth from a sender that cycles session ids, and guards the eviction being
  // invisible — a user must be able to tell that older sessions fell out rather than never arrived.
  const store = createHookStore({ limits: { maxSessions: 3 } })
  for (const id of ['a', 'b', 'c', 'd']) await send(store, ev('SessionStart', { session_id: id }))
  const view = getLiveState(store)
  assert.equal(view.sessionCount, 3)
  assert.equal(view.sessions.some(s => s.sessionId === 'a'), false, 'least-recently-seen is evicted')
  assert.equal(view.totals.sessionsEvicted, 1)
  assert.equal(view.limits.maxSessions, 3, 'the live view states the bound it enforced')
})

test('the POST that will evict a session says so in its own response', async () => {
  // Guards the "no silent caps" rule at the point of loss: the ack must report the cost of THIS
  // request, not just the static limit.
  const store = createHookStore({ limits: { maxSessions: 2 } })
  await send(store, ev('SessionStart', { session_id: 'a' }))
  await send(store, ev('SessionStart', { session_id: 'b' }))
  const res = await send(store, ev('SessionStart', { session_id: 'c' }))
  assert.equal(res.body.report.willEvictOldestSession, true)
  assert.equal(res.body.limits.maxSessions, 2)
})

test('a touched session is not the one evicted', async () => {
  // Guards a plain FIFO being used where LRU is meant: the session a user is actively watching is by
  // definition the most recently touched and must never be the one dropped.
  const store = createHookStore({ limits: { maxSessions: 2 } })
  await send(store, ev('SessionStart', { session_id: 'a' }))
  await send(store, ev('SessionStart', { session_id: 'b' }))
  await send(store, ev('PreToolUse', { session_id: 'a', tool_name: 'Read' }))
  await send(store, ev('SessionStart', { session_id: 'c' }))
  const ids = getLiveState(store).sessions.map(s => s.sessionId).sort()
  assert.deepEqual(ids, ['a', 'c'])
})

test('per-session events are a bounded ring and the drop count is retained', async () => {
  // Guards a long-running session's event list growing without limit, and guards the drop being
  // untraceable afterwards.
  const store = createHookStore({ limits: { maxEventsPerSession: 3 } })
  for (let i = 0; i < 5; i++) await send(store, ev('PreToolUse', { tool_name: `T${i}` }))
  const s = sessionOf(store)
  assert.equal(s.eventCount, 3)
  assert.equal(s.drops.events, 2)
  const withEvents = getLiveState(store, { events: 10 }).sessions[0]
  assert.deepEqual(withEvents.events.map(e => e.toolName), ['T2', 'T3', 'T4'], 'the newest events survive')
})

test('subagents are bounded per session and overflow is counted rather than ignored', async () => {
  // Guards a Task fan-out from growing the agent map without limit.
  const store = createHookStore({ limits: { maxAgentsPerSession: 2 } })
  for (const id of ['a1', 'a2', 'a3']) await send(store, ev('PreToolUse', { agent_id: id, tool_name: 'Read' }))
  const s = sessionOf(store)
  assert.equal(s.agents.length, 2)
  assert.equal(s.drops.agents, 1)
})

test('an oversized raw body is rejected with 413 and the cap is named in the rejection', async () => {
  // Guards this unauthenticated endpoint inheriting index.mjs's global 10 MB express.json limit,
  // and guards a 413 that does not say what the limit was.
  const store = createHookStore({ limits: { ...LIMITS, maxBodyBytes: 64 } })
  const res = mkRes()
  await hookEventHandler(store)(mkStreamReq(JSON.stringify({ hook_event_name: 'Stop', session_id: 'x'.repeat(500) })), res)
  assert.equal(res.statusCode, 413)
  assert.equal(res.body.error, 'tooLarge')
  assert.equal(res.body.limits.maxBodyBytes, 64)
  assert.equal(store.rejected.tooLarge, 1)
})

test('long free-text fields are truncated and the truncation is reported on the response', async () => {
  // Guards a hostile or merely huge prompt being retained in full, and guards silent truncation —
  // a user reading a clipped message must be able to learn that it was clipped.
  const store = createHookStore()
  const res = await send(store, ev('UserPromptSubmit', { user_input: 'x'.repeat(LIMITS.maxStringLength + 500) }))
  assert.equal(res.body.report.truncatedFields, 1)
  assert.equal(sessionOf(store).drops.truncatedFields, 1)
  const stored = getLiveState(store, { events: 1 }).sessions[0].events[0]
  assert.equal(stored.userInput.length, LIMITS.maxStringLength)
})

test('malformed JSON on the raw stream is a counted 400, never an exception', async () => {
  // Guards a parse throw escaping into express's error handler — which for a fire-and-forget sender
  // would turn a corrupt payload into a hung socket.
  const store = createHookStore()
  const res = mkRes()
  await hookEventHandler(store)(mkStreamReq('{not json'), res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error, 'badJson')
  assert.equal(store.rejected.badJson, 1)
})

// ---------------------------------------------------------------------------------------------
// trust boundary

test('tool_input values are never retained, only their key names', async () => {
  // Guards the leak this module is most likely to cause: tool inputs carry file contents, tokens and
  // credentials, and anything that stores them becomes something that can disclose them over an
  // unauthenticated GET.
  const store = createHookStore()
  await send(store, ev('PreToolUse', {
    tool_name: 'Bash',
    tool_input: { command: 'curl -H "Authorization: Bearer sk-secret-value" x', description: 'fetch' },
  }))
  const dump = JSON.stringify(getLiveState(store, { events: 5 }))
  assert.equal(dump.includes('sk-secret-value'), false, 'no tool_input value may appear anywhere in the view')
  assert.deepEqual(sessionOf(store).currentTool.inputKeys, ['command', 'description'])
})

test('control characters are stripped from every retained string', async () => {
  // Guards terminal-escape smuggling into a console log or a UI, and log-injection via newlines in a
  // field that later gets printed.
  const store = createHookStore()
  await send(store, ev('Notification', { message: 'ok\u001b[2Jwiped\nsecond line' }))
  const msg = sessionOf(store).lastNotification.message
  assert.equal(msg.includes('\u001b'), false)
  assert.equal(msg.includes('\n'), false)
})

test('a hostile session_id cannot carry path or shell syntax into stored state', async () => {
  // Guards the worst case: an id that later gets joined into a filesystem path or interpolated into
  // a command. It is reduced to a conservative charset at ingest so no downstream consumer can be
  // the first line of defence.
  const store = createHookStore()
  await send(store, ev('SessionStart', { session_id: '../../etc/passwd; rm -rf ~' }))
  const ids = getLiveState(store).sessions.map(s => s.sessionId)
  assert.equal(ids.length, 1)
  assert.equal(/[;`$'"\\]/.test(ids[0]), false, 'shell metacharacters must not survive ingest')
  assert.equal(ids[0].includes('..'), true, 'but distinct ids must stay distinct — sanitising is not deleting')
})

test('two hostile ids that differ only in bad characters do not collapse into one session', async () => {
  // Guards a sanitiser that strips rather than substitutes, which would let one session masquerade
  // as another.
  const store = createHookStore()
  await send(store, ev('SessionStart', { session_id: 'a b' }))
  await send(store, ev('SessionStart', { session_id: 'a\tb' }))
  await send(store, ev('SessionStart', { session_id: 'ab' }))
  assert.equal(getLiveState(store).sessionCount, 2, 'a_b and ab are different; the two whitespace forms are not')
})

// ---------------------------------------------------------------------------------------------
// fire-and-forget contract

test('the response is written before the store is mutated', async () => {
  // The whole point of the feature: a slow ingest must never hold a socket open inside the agent's
  // process. Guards a refactor that moves applyEvent above res.json().
  const store = createHookStore()
  let storeSizeWhenAnswered = null
  const res = mkRes()
  res.json = function (b) { this.body = b; storeSizeWhenAnswered = store.sessions.size; return this }
  await hookEventHandler(store)(mkReq(ev('SessionStart')), res)
  assert.equal(storeSizeWhenAnswered, 0, 'the ack must not wait on ingest')
  assert.equal(store.sessions.size, 1, 'and the ingest must still happen')
})

test('the ack reports the durability contract so no consumer assumes persistence', async () => {
  // Guards someone building a report on top of this store: it is wiped on restart by design and the
  // API has to say so rather than let that be discovered in production.
  const store = createHookStore()
  const res = await send(store, ev('Stop'))
  assert.equal(res.body.durability, 'in-memory-only')
  assert.match(getLiveState(store).durability, /in-memory-only/)
})

// ---------------------------------------------------------------------------------------------
// mounting and the live view

test('mountHooksReceiver registers routes that do not collide with the hook-library routes', async () => {
  // Guards a name clash with the existing /api/hooks, /api/hooks/test, /api/hooks/library and
  // friends in server/index.mjs — express would answer with whichever was registered first and the
  // failure would look like an unrelated section breaking.
  const registered = { post: [], get: [] }
  const app = { post: p => registered.post.push(p), get: p => registered.get.push(p) }
  const mounted = mountHooksReceiver(app)
  assert.deepEqual(registered.post, [ROUTES.ingest])
  assert.deepEqual(registered.get, [ROUTES.live])
  const existing = ['/api/hooks', '/api/hooks/test', '/api/hooks/dryrun', '/api/hooks/health', '/api/hooks/library', '/api/hooks/install']
  for (const r of [...registered.post, ...registered.get]) assert.equal(existing.includes(r), false, `${r} collides`)
  assert.equal(typeof mounted.getLiveState, 'function')
})

test('the live view omits per-event detail unless it is asked for, and caps what it returns', async () => {
  // Guards the live view becoming an unbounded transcript dump on every poll.
  const store = createHookStore()
  for (let i = 0; i < 10; i++) await send(store, ev('PreToolUse', { tool_name: `T${i}` }))
  assert.equal(getLiveState(store).sessions[0].events, undefined)
  assert.equal(getLiveState(store, { events: 3 }).sessions[0].events.length, 3)
  assert.equal(getLiveState(store, { events: 99999 }).sessions[0].events.length, 10, 'the request cannot exceed the ring')
})

test('the live view is ordered most-recently-active first', async () => {
  // Guards a dashboard showing a stale session above the one that is mid-turn right now.
  const store = createHookStore()
  await send(store, ev('SessionStart', { session_id: 'old' }))
  await send(store, ev('SessionStart', { session_id: 'new' }))
  await send(store, ev('PreToolUse', { session_id: 'old', tool_name: 'Read' }))
  assert.equal(getLiveState(store).sessions[0].sessionId, 'old')
})

test('the GET handler answers with the live state and its limits', () => {
  // Guards the getter drifting from the handler, e.g. returning the raw store with its Maps.
  const store = createHookStore()
  const res = mkRes()
  liveViewHandler(store)({ query: {} }, res)
  assert.equal(res.body.ok, true)
  assert.deepEqual(res.body.acceptedEvents, HOOK_EVENTS)
  assert.equal(res.body.limits.maxSessions, LIMITS.maxSessions)
  assert.equal(JSON.stringify(res.body).length > 0, true, 'the view must be JSON-serialisable — no Maps')
})

// ---------------------------------------------------------------------------------------------
// port discovery

test('DASH_PORT overrides discovery and DASH_HOOK_URL overrides both', () => {
  // Guards the precedence: someone running two dashboards must be able to pin the hook explicitly,
  // and the existing DASH_PORT convention must keep working.
  assert.deepEqual(resolveTargets({ DASH_PORT: '5200' }), { source: 'DASH_PORT', targets: ['http://127.0.0.1:5200'] })
  const urls = resolveTargets({ DASH_HOOK_URL: 'http://127.0.0.1:1,http://127.0.0.1:2', DASH_PORT: '5200' })
  assert.equal(urls.source, 'DASH_HOOK_URL')
  assert.equal(urls.targets.length, 2)
})

test('discovery falls back to the default port when the registry is missing or corrupt', () => {
  // Guards the hook throwing (and so failing an agent turn) on a missing, unreadable, half-written
  // or wrong-version registry file. Every one of those must degrade to the default port.
  const env = { CLAUDE_CONFIG_DIR: '/nonexistent-dir-for-hook-tests-43' }
  assert.deepEqual(resolveTargets(env), { source: 'default', targets: [`http://127.0.0.1:${DEFAULT_DASH_PORT}`] })
})

test('an invalid DASH_PORT is ignored rather than producing a nonsense URL', () => {
  // Guards `DASH_PORT=` or `DASH_PORT=abc` in a shell profile turning into http://127.0.0.1:NaN.
  for (const bad of ['', 'abc', '0', '70000', '-1'])
    assert.notEqual(resolveTargets({ DASH_PORT: bad, CLAUDE_CONFIG_DIR: '/nonexistent-dir-for-hook-tests-43' }).source, 'DASH_PORT', `DASH_PORT=${bad}`)
})

test('the instance registry fan-out is bounded', () => {
  // Guards a stale registry turning every hook invocation into a long serial fan-out, which would
  // make the hook slow enough to be felt inside the agent's turn.
  assert.equal(MAX_INSTANCES <= 8, true)
})

// ---------------------------------------------------------------------------------------------
// unit-level helpers

test('normalizeEvent reports truncation counts without mutating any store', () => {
  // Guards normalization and ingestion becoming entangled, which is what makes "answer first, ingest
  // after" possible at all.
  const n = normalizeEvent({ hook_event_name: 'Stop', session_id: 's', last_assistant_message: 'y'.repeat(5000) }, 1)
  assert.equal(n.ok, true)
  assert.equal(n.truncatedFields, 1)
  assert.equal(n.event.lastAssistantMessage.length, LIMITS.maxStringLength)
})

test('applyEvent is idempotent in shape — repeated events grow counts, not session keys', () => {
  // Guards a per-event session key (e.g. keyed by tool_use_id) exploding the map.
  const store = createHookStore()
  const now = 1
  for (let i = 0; i < 20; i++) applyEvent(store, normalizeEvent(ev('PostToolUse', { tool_name: 'Read' }), now).event)
  assert.equal(store.sessions.size, 1)
  assert.equal(sessionOf(store).counts.PostToolUse, 20)
})

test('readBody prefers an already-parsed body over re-reading a consumed stream', async () => {
  // Guards a hang: express.json in server/index.mjs consumes the stream, so a second read would
  // never emit "end" and the response would never be written.
  const req = Object.assign(Readable.from([]), { body: { hook_event_name: 'Stop' } })
  assert.deepEqual(await readBody(req), { ok: true, body: { hook_event_name: 'Stop' } })
})
