import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import {
  mountHooksReceiver, createHookStore, hookEventHandler, liveViewHandler,
  normalizeEvent, applyEvent, getLiveState, readBody, resolveTargets,
  HOOK_EVENTS, LIMITS, ROUTES, UNKNOWN, DEFAULT_DASH_PORT, MAX_INSTANCES,
} from '../../server/hooks-receiver.mjs'

const mkRes = () => ({
  statusCode: null, body: null, ended: false,
  status(c) { this.statusCode = c; return this },
  json(b) { this.body = b; this.ended = true; return this },
})

const mkReq = (body, over = {}) => ({ method: 'POST', headers: {}, body, ...over })

const mkStreamReq = (text, over = {}) => Object.assign(Readable.from([Buffer.from(text)]), { method: 'POST', headers: {}, ...over })

const ev = (name, extra = {}) => ({ hook_event_name: name, session_id: 's1', ...extra })

const send = async (store, body, opts) => {
  const res = mkRes()
  await hookEventHandler(store, opts)(mkReq(body), res)
  return res
}

const sessionOf = (store, id = 's1') => getLiveState(store).sessions.find(s => s.sessionId === id)

// ---------------------------------------------------------------------------------------------

test('all nine real Claude Code hook events are accepted', async () => {
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
  const store = createHookStore()
  for (const bad of [null, 'PreToolUse', 42, ['PreToolUse']]) {
    const res = await send(store, bad)
    assert.equal(res.statusCode, 400, `${JSON.stringify(bad)} must be rejected`)
  }
  assert.equal(getLiveState(store).sessionCount, 0)
})

// ---------------------------------------------------------------------------------------------

test('an event with no session_id lands in an explicitly-unknown bucket, not the newest session', async () => {
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
  const store = createHookStore()
  await send(store, ev('PreToolUse'))
  const s = sessionOf(store)
  assert.equal(s.status, 'running-tool')
  assert.equal(s.currentTool.name, UNKNOWN)
})

test('a field absent from a later event does not erase what an earlier event established', async () => {
  const store = createHookStore()
  await send(store, ev('SessionStart', { cwd: '/repo', model: 'opus', permission_mode: 'default' }))
  await send(store, ev('PreToolUse', { tool_name: 'Read' }))
  const s = sessionOf(store)
  assert.equal(s.cwd, '/repo')
  assert.equal(s.model, 'opus')
  assert.equal(s.permissionMode, 'default')
})

// ---------------------------------------------------------------------------------------------

test('the mid-turn lifecycle moves through working, running-tool and back to idle', async () => {
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
  const store = createHookStore()
  await send(store, ev('Stop'))
  await send(store, ev('Notification', { notification_type: 'idle', message: 'still there?' }))
  assert.equal(sessionOf(store).status, 'idle')
  await send(store, ev('SubagentStop', { agent_id: 'a1' }))
  assert.equal(sessionOf(store).status, 'idle')
})

test('a PostToolUse for a different tool_use_id leaves the open tool call standing', async () => {
  const store = createHookStore()
  await send(store, ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 't1' }))
  await send(store, ev('PostToolUse', { tool_name: 'Read', tool_use_id: 't2' }))
  assert.equal(sessionOf(store).currentTool.toolUseId, 't1', 'the unrelated result must not clear it')
  await send(store, ev('PostToolUse', { tool_name: 'Bash', tool_use_id: 't1' }))
  assert.equal(sessionOf(store).currentTool, null)
})

test('SessionEnd records the exit reason and clears any tool that was still open', async () => {
  const store = createHookStore()
  await send(store, ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 't1' }))
  await send(store, ev('SessionEnd', { exit_reason: 'logout' }))
  const s = sessionOf(store)
  assert.equal(s.status, 'ended')
  assert.equal(s.currentTool, null)
  assert.equal(s.lastStopReason, 'logout')
})

// ---------------------------------------------------------------------------------------------

test('the session map is bounded and the eviction is counted, not silent', async () => {
  const store = createHookStore({ limits: { maxSessions: 3 } })
  for (const id of ['a', 'b', 'c', 'd']) await send(store, ev('SessionStart', { session_id: id }))
  const view = getLiveState(store)
  assert.equal(view.sessionCount, 3)
  assert.equal(view.sessions.some(s => s.sessionId === 'a'), false, 'least-recently-seen is evicted')
  assert.equal(view.totals.sessionsEvicted, 1)
  assert.equal(view.limits.maxSessions, 3, 'the live view states the bound it enforced')
})

test('the POST that will evict a session says so in its own response', async () => {
  const store = createHookStore({ limits: { maxSessions: 2 } })
  await send(store, ev('SessionStart', { session_id: 'a' }))
  await send(store, ev('SessionStart', { session_id: 'b' }))
  const res = await send(store, ev('SessionStart', { session_id: 'c' }))
  assert.equal(res.body.report.willEvictOldestSession, true)
  assert.equal(res.body.limits.maxSessions, 2)
})

test('a touched session is not the one evicted', async () => {
  const store = createHookStore({ limits: { maxSessions: 2 } })
  await send(store, ev('SessionStart', { session_id: 'a' }))
  await send(store, ev('SessionStart', { session_id: 'b' }))
  await send(store, ev('PreToolUse', { session_id: 'a', tool_name: 'Read' }))
  await send(store, ev('SessionStart', { session_id: 'c' }))
  const ids = getLiveState(store).sessions.map(s => s.sessionId).sort()
  assert.deepEqual(ids, ['a', 'c'])
})

test('per-session events are a bounded ring and the drop count is retained', async () => {
  const store = createHookStore({ limits: { maxEventsPerSession: 3 } })
  for (let i = 0; i < 5; i++) await send(store, ev('PreToolUse', { tool_name: `T${i}` }))
  const s = sessionOf(store)
  assert.equal(s.eventCount, 3)
  assert.equal(s.drops.events, 2)
  const withEvents = getLiveState(store, { events: 10 }).sessions[0]
  assert.deepEqual(withEvents.events.map(e => e.toolName), ['T2', 'T3', 'T4'], 'the newest events survive')
})

test('subagents are bounded per session and overflow is counted rather than ignored', async () => {
  const store = createHookStore({ limits: { maxAgentsPerSession: 2 } })
  for (const id of ['a1', 'a2', 'a3']) await send(store, ev('PreToolUse', { agent_id: id, tool_name: 'Read' }))
  const s = sessionOf(store)
  assert.equal(s.agents.length, 2)
  assert.equal(s.drops.agents, 1)
})

test('an oversized raw body is rejected with 413 and the cap is named in the rejection', async () => {
  const store = createHookStore({ limits: { ...LIMITS, maxBodyBytes: 64 } })
  const res = mkRes()
  await hookEventHandler(store)(mkStreamReq(JSON.stringify({ hook_event_name: 'Stop', session_id: 'x'.repeat(500) })), res)
  assert.equal(res.statusCode, 413)
  assert.equal(res.body.error, 'tooLarge')
  assert.equal(res.body.limits.maxBodyBytes, 64)
  assert.equal(store.rejected.tooLarge, 1)
})

test('long free-text fields are truncated and the truncation is reported on the response', async () => {
  const store = createHookStore()
  const res = await send(store, ev('UserPromptSubmit', { user_input: 'x'.repeat(LIMITS.maxStringLength + 500) }))
  assert.equal(res.body.report.truncatedFields, 1)
  assert.equal(sessionOf(store).drops.truncatedFields, 1)
  const stored = getLiveState(store, { events: 1 }).sessions[0].events[0]
  assert.equal(stored.userInput.length, LIMITS.maxStringLength)
})

test('malformed JSON on the raw stream is a counted 400, never an exception', async () => {
  const store = createHookStore()
  const res = mkRes()
  await hookEventHandler(store)(mkStreamReq('{not json'), res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error, 'badJson')
  assert.equal(store.rejected.badJson, 1)
})

// ---------------------------------------------------------------------------------------------

test('tool_input values are never retained, only their key names', async () => {
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
  const store = createHookStore()
  await send(store, ev('Notification', { message: 'ok\u001b[2Jwiped\nsecond line' }))
  const msg = sessionOf(store).lastNotification.message
  assert.equal(msg.includes('\u001b'), false)
  assert.equal(msg.includes('\n'), false)
})

test('a hostile session_id cannot carry path or shell syntax into stored state', async () => {
  const store = createHookStore()
  await send(store, ev('SessionStart', { session_id: '../../etc/passwd; rm -rf ~' }))
  const ids = getLiveState(store).sessions.map(s => s.sessionId)
  assert.equal(ids.length, 1)
  assert.equal(/[;`$'"\\]/.test(ids[0]), false, 'shell metacharacters must not survive ingest')
  assert.equal(ids[0].includes('..'), true, 'but distinct ids must stay distinct — sanitising is not deleting')
})

test('two hostile ids that differ only in bad characters do not collapse into one session', async () => {
  const store = createHookStore()
  await send(store, ev('SessionStart', { session_id: 'a b' }))
  await send(store, ev('SessionStart', { session_id: 'a\tb' }))
  await send(store, ev('SessionStart', { session_id: 'ab' }))
  assert.equal(getLiveState(store).sessionCount, 2, 'a_b and ab are different; the two whitespace forms are not')
})

// ---------------------------------------------------------------------------------------------

test('the response is written before the store is mutated', async () => {
  const store = createHookStore()
  let storeSizeWhenAnswered = null
  const res = mkRes()
  res.json = function (b) { this.body = b; storeSizeWhenAnswered = store.sessions.size; return this }
  await hookEventHandler(store)(mkReq(ev('SessionStart')), res)
  assert.equal(storeSizeWhenAnswered, 0, 'the ack must not wait on ingest')
  assert.equal(store.sessions.size, 1, 'and the ingest must still happen')
})

test('the ack reports the durability contract so no consumer assumes persistence', async () => {
  const store = createHookStore()
  const res = await send(store, ev('Stop'))
  assert.equal(res.body.durability, 'in-memory-only')
  assert.match(getLiveState(store).durability, /in-memory-only/)
})

// ---------------------------------------------------------------------------------------------

test('mountHooksReceiver registers routes that do not collide with the hook-library routes', async () => {
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
  const store = createHookStore()
  for (let i = 0; i < 10; i++) await send(store, ev('PreToolUse', { tool_name: `T${i}` }))
  assert.equal(getLiveState(store).sessions[0].events, undefined)
  assert.equal(getLiveState(store, { events: 3 }).sessions[0].events.length, 3)
  assert.equal(getLiveState(store, { events: 99999 }).sessions[0].events.length, 10, 'the request cannot exceed the ring')
})

test('the live view is ordered most-recently-active first', async () => {
  const store = createHookStore()
  await send(store, ev('SessionStart', { session_id: 'old' }))
  await send(store, ev('SessionStart', { session_id: 'new' }))
  await send(store, ev('PreToolUse', { session_id: 'old', tool_name: 'Read' }))
  assert.equal(getLiveState(store).sessions[0].sessionId, 'old')
})

test('the GET handler answers with the live state and its limits', () => {
  const store = createHookStore()
  const res = mkRes()
  liveViewHandler(store)({ query: {} }, res)
  assert.equal(res.body.ok, true)
  assert.deepEqual(res.body.acceptedEvents, HOOK_EVENTS)
  assert.equal(res.body.limits.maxSessions, LIMITS.maxSessions)
  assert.equal(JSON.stringify(res.body).length > 0, true, 'the view must be JSON-serialisable — no Maps')
})

// ---------------------------------------------------------------------------------------------

test('DASH_PORT overrides discovery and DASH_HOOK_URL overrides both', () => {
  assert.deepEqual(resolveTargets({ DASH_PORT: '5200' }), { source: 'DASH_PORT', targets: ['http://127.0.0.1:5200'] })
  const urls = resolveTargets({ DASH_HOOK_URL: 'http://127.0.0.1:1,http://127.0.0.1:2', DASH_PORT: '5200' })
  assert.equal(urls.source, 'DASH_HOOK_URL')
  assert.equal(urls.targets.length, 2)
})

test('discovery falls back to the default port when the registry is missing or corrupt', () => {
  const env = { CLAUDE_CONFIG_DIR: '/nonexistent-dir-for-hook-tests-43' }
  assert.deepEqual(resolveTargets(env), { source: 'default', targets: [`http://127.0.0.1:${DEFAULT_DASH_PORT}`] })
})

test('an invalid DASH_PORT is ignored rather than producing a nonsense URL', () => {
  for (const bad of ['', 'abc', '0', '70000', '-1'])
    assert.notEqual(resolveTargets({ DASH_PORT: bad, CLAUDE_CONFIG_DIR: '/nonexistent-dir-for-hook-tests-43' }).source, 'DASH_PORT', `DASH_PORT=${bad}`)
})

test('the instance registry fan-out is bounded', () => {
  assert.equal(MAX_INSTANCES <= 8, true)
})

// ---------------------------------------------------------------------------------------------

test('normalizeEvent reports truncation counts without mutating any store', () => {
  const n = normalizeEvent({ hook_event_name: 'Stop', session_id: 's', last_assistant_message: 'y'.repeat(5000) }, 1)
  assert.equal(n.ok, true)
  assert.equal(n.truncatedFields, 1)
  assert.equal(n.event.lastAssistantMessage.length, LIMITS.maxStringLength)
})

test('applyEvent is idempotent in shape — repeated events grow counts, not session keys', () => {
  const store = createHookStore()
  const now = 1
  for (let i = 0; i < 20; i++) applyEvent(store, normalizeEvent(ev('PostToolUse', { tool_name: 'Read' }), now).event)
  assert.equal(store.sessions.size, 1)
  assert.equal(sessionOf(store).counts.PostToolUse, 20)
})

test('readBody prefers an already-parsed body over re-reading a consumed stream', async () => {
  const req = Object.assign(Readable.from([]), { body: { hook_event_name: 'Stop' } })
  assert.deepEqual(await readBody(req), { ok: true, body: { hook_event_name: 'Stop' } })
})
