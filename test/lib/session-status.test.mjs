import test from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveStatus, lastSignal, collapseIdle, contextPressure, contextWindowFor,
  permissionBadge, permissionModeLabel, localMidnight, toEpochMs,
  ACTIVE_MS, BLOCKED_HOLD_MS, CLOCK_SKEW_MS,
} from '../../lib/session-status.mjs'

const NOW = Date.parse('2026-07-29T14:30:00Z')
const ago = ms => NOW - ms

const working = (ms, over = {}) => ({
  lastEventAt: ago(ms), lastEventType: 'assistant', lastContentTypes: ['tool_use'], ...over,
})
const blocked = (ms, over = {}) => ({
  lastEventAt: ago(ms), lastEventType: 'assistant', lastContentTypes: ['text'], ...over,
})

const withTZ = (tz, fn) => {
  const prev = process.env.TZ
  process.env.TZ = tz
  try { return fn() } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev }
}

// ---------------------------------------------------------------- deriveStatus: the unknown rule

test('a session with no lastEventAt is unknown, never idle', () => {
  for (const missing of [undefined, null, '', 'not-a-date', NaN, {}]) {
    const r = deriveStatus({ lastEventAt: missing, lastEventType: 'assistant', lastContentTypes: ['tool_use'] }, NOW)
    assert.equal(r.status, 'unknown', `lastEventAt=${String(missing)}`)
    assert.equal(r.reason, 'no-last-event-at')
    assert.equal(r.elapsedMs, null, 'no timestamp means no elapsed time to report either')
  }
})

test('a recent event we cannot classify is unknown rather than a coin-flip', () => {
  const r = deriveStatus({ lastEventAt: ago(2_000) }, NOW)
  assert.equal(r.status, 'unknown')
  assert.equal(r.reason, 'recent-but-unclassifiable')
})

test('an unclassifiable event long ago is idle, because idleness needs only recency', () => {
  const r = deriveStatus({ lastEventAt: ago(5 * 60_000) }, NOW)
  assert.equal(r.status, 'idle')
})

test('a timestamp from the future is unknown, not zero-elapsed "thinking"', () => {
  const skewed = deriveStatus({ ...working(0), lastEventAt: NOW + 60_000 }, NOW)
  assert.equal(skewed.status, 'unknown')
  assert.equal(skewed.reason, 'timestamp-in-future')
  const tolerated = deriveStatus({ ...working(0), lastEventAt: NOW + CLOCK_SKEW_MS - 1 }, NOW)
  assert.equal(tolerated.status, 'thinking')
})

// ---------------------------------------------------------------- deriveStatus: the transitions

test('tool_use inside the active window is thinking, and text is waiting', () => {
  assert.equal(deriveStatus(working(1_000), NOW).status, 'thinking')
  assert.equal(deriveStatus(blocked(1_000), NOW).status, 'waiting')
})

test('a turn that both spoke and called a tool is still thinking', () => {
  assert.equal(lastSignal({ lastEventType: 'assistant', lastContentTypes: ['text', 'tool_use'] }), 'working')
})

test('thinking decays to idle at ACTIVE_MS but waiting holds until BLOCKED_HOLD_MS', () => {
  assert.equal(deriveStatus(working(ACTIVE_MS - 1), NOW).status, 'thinking')
  assert.equal(deriveStatus(working(ACTIVE_MS), NOW).status, 'idle')
  assert.equal(deriveStatus(blocked(ACTIVE_MS + 1), NOW).status, 'waiting')
  assert.equal(deriveStatus(blocked(BLOCKED_HOLD_MS - 1), NOW).status, 'waiting')
  assert.equal(deriveStatus(blocked(BLOCKED_HOLD_MS), NOW).status, 'idle')
})

test('an error in the recent log outranks the working signal', () => {
  const r = deriveStatus(working(1_000, { recentLog: [{ type: 'tool' }, { type: 'error' }] }), NOW)
  assert.equal(r.status, 'error')
})

test('only the last few log entries are inspected for errors', () => {
  const recovered = { type: 'error' }
  const since = [{ type: 'tool' }, { type: 'tool' }, { type: 'text' }]
  assert.equal(deriveStatus(working(1_000, { recentLog: [recovered, ...since] }), NOW).status, 'thinking')
  assert.equal(deriveStatus(working(1_000, { recentLog: [...since, recovered] }), NOW).status, 'error')
})

test('a long-dead session is idle whatever its last signal said', () => {
  for (const s of [working(2 * BLOCKED_HOLD_MS), blocked(2 * BLOCKED_HOLD_MS)]) {
    assert.equal(deriveStatus(s, NOW).status, 'idle')
  }
  const errored = { ...working(2 * BLOCKED_HOLD_MS), recentLog: [{ type: 'error' }] }
  assert.equal(deriveStatus(errored, NOW).status, 'idle')
})

// ---------------------------------------------------------------- idle-stale / local midnight

test('local midnight is the host zone, not toISOString', () => {
  withTZ('Pacific/Kiritimati', () => {
    const t = Date.parse('2026-07-29T12:00:00Z')
    const m = localMidnight(t)
    const d = new Date(m)
    assert.equal(d.getHours(), 0)
    assert.equal(d.getDate(), 30, 'local calendar day is the 30th, not the UTC 29th')
    const utcMidnight = Date.parse('2026-07-29T00:00:00Z')
    assert.notEqual(m, utcMidnight)
    assert.ok(m > utcMidnight, 'the UTC-day boundary is 26 hours stale here')
  })
  withTZ('America/Los_Angeles', () => {
    const t = Date.parse('2026-07-30T04:00:00Z')
    assert.equal(new Date(localMidnight(t)).getDate(), 29, 'still the 29th locally')
  })
})

test('local midnight zeroes the whole time-of-day and stays within the same day', () => {
  const m = localMidnight(NOW)
  const d = new Date(m)
  assert.deepEqual([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()], [0, 0, 0, 0])
  assert.ok(m <= NOW && NOW - m < 25 * 3600_000)
})

test('idle since before local midnight is tiered idle-stale', () => {
  withTZ('Asia/Kolkata', () => {
    const now = Date.parse('2026-07-29T06:00:00Z')
    const midnight = localMidnight(now)
    const yesterday = deriveStatus({ lastEventAt: midnight - 60_000 }, now)
    assert.equal(yesterday.status, 'idle')
    assert.equal(yesterday.stale, true)
    assert.equal(yesterday.label, 'idle-stale')

    const today = deriveStatus({ lastEventAt: midnight + 60_000 }, now)
    assert.equal(today.status, 'idle')
    assert.equal(today.stale, false)
    assert.equal(today.label, 'idle')
  })
})

test('only idle carries the stale tier', () => {
  const r = deriveStatus(blocked(1_000), NOW)
  assert.equal(r.stale, false)
  assert.equal(r.label, 'waiting')
})

// ---------------------------------------------------------------- collapseIdle

const row = (id, label, status, lastEventAt) => ({ id, label, status, lastEventAt })

test('idle rows are dropped when their label has a live session', () => {
  const { sessions, dropped, reasons } = collapseIdle([
    row('a', 'loush-dashboard', 'idle', ago(90 * 60_000)),
    row('b', 'loush-dashboard', 'thinking', ago(1_000)),
    row('c', 'other-repo', 'idle', ago(90 * 60_000)),
  ])
  assert.deepEqual(sessions.map(s => s.id), ['b', 'c'])
  assert.equal(dropped, 1)
  assert.equal(reasons['label-has-active-session'], 1)
})

test('idle rows dedupe to the newest per label', () => {
  const { sessions, drops } = collapseIdle([
    row('old', 'repo', 'idle', ago(9_000_000)),
    row('new', 'repo', 'idle', ago(90_000)),
    row('mid', 'repo', 'idle', ago(900_000)),
  ])
  assert.deepEqual(sessions.map(s => s.id), ['new'])
  assert.deepEqual(drops.map(d => d.reason), ['superseded-by-newer-idle-session', 'superseded-by-newer-idle-session'])
})

test('every dropped row is reported, with a reason', () => {
  const input = [
    row('a', 'repo', 'idle', ago(60_000)),
    row('b', 'repo', 'idle', ago(70_000)),
    row('c', 'repo', 'waiting', ago(1_000)),
  ]
  const out = collapseIdle(input)
  assert.equal(out.dropped, 2)
  assert.equal(out.drops.length, out.dropped)
  assert.equal(out.sessions.length + out.dropped, input.length, 'nothing vanishes unaccounted for')
  for (const d of out.drops) assert.ok(d.reason && d.session && d.label)
})

test('unknown-status rows are never collapsed away', () => {
  const { sessions, dropped } = collapseIdle([
    row('u1', 'repo', 'unknown', null),
    row('u2', 'repo', 'unknown', null),
    row('live', 'repo', 'thinking', ago(500)),
  ])
  assert.deepEqual(sessions.map(s => s.id), ['u1', 'u2', 'live'])
  assert.equal(dropped, 0)
})

test('unlabelled idle rows cannot be grouped and so are never dropped', () => {
  const { sessions, dropped } = collapseIdle([
    row('x', null, 'idle', ago(60_000)),
    row('y', null, 'idle', ago(70_000)),
  ])
  assert.equal(sessions.length, 2)
  assert.equal(dropped, 0)
})

test('input order is preserved and non-arrays are tolerated', () => {
  const rows = [row('a', 'p', 'waiting', ago(1)), row('b', 'q', 'thinking', ago(2)), row('c', 'p', 'error', ago(3))]
  assert.deepEqual(collapseIdle(rows).sessions.map(s => s.id), ['a', 'b', 'c'])
  assert.deepEqual(collapseIdle(undefined), { sessions: [], dropped: 0, drops: [], reasons: {} })
})

// ---------------------------------------------------------------- context-window pressure

test('the context denominator is model-aware, not a hardcoded 200K', () => {
  assert.equal(contextWindowFor('claude-opus-4-6'), 1_000_000)
  assert.equal(contextWindowFor('claude-sonnet-4-6'), 1_000_000)
  assert.equal(contextWindowFor('claude-opus-5'), 1_000_000)
  assert.equal(contextWindowFor('claude-haiku-4-5-20251001'), 200_000)
  assert.equal(contextWindowFor('claude-opus-4-5-20251101'), 200_000)
  assert.equal(contextWindowFor('claude-sonnet-4-5-20250929'), 200_000)
})

test('an explicit [1m] marker beats the family default', () => {
  assert.equal(contextWindowFor('claude-sonnet-4-5[1m]'), 1_000_000)
})

test('an unknown model has an unknown window — no fallback denominator', () => {
  assert.equal(contextWindowFor('llama3-local'), null)
  assert.equal(contextWindowFor(''), null)
  assert.equal(contextWindowFor(undefined), null)

  const p = contextPressure({ lastTurn: { model: 'llama3-local', in: 50_000, cacheCreate: 0, cacheRead: 100_000 } })
  assert.equal(p.known, false)
  assert.equal(p.percent, null)
  assert.equal(p.reason, 'unknown-model-window')
  assert.equal(p.total, 150_000, 'the token total is still a real measurement and is still reported')
})

test('pressure is in + cacheCreate + cacheRead over the model window', () => {
  const p = contextPressure({ lastTurn: { model: 'claude-opus-4-6', in: 10_000, cacheCreate: 40_000, cacheRead: 150_000 } })
  assert.equal(p.known, true)
  assert.equal(p.total, 200_000)
  assert.equal(p.window, 1_000_000)
  assert.equal(p.percent, 20)
  assert.equal(p.over, false)
})

test('a missing current-turn figure is unknown, never a lifetime-token substitute', () => {
  const p = contextPressure({ totalTokens: 4_000_000, lastTurn: { model: 'claude-opus-4-6' } })
  assert.equal(p.known, false)
  assert.equal(p.total, null)
  assert.equal(p.percent, null)
  assert.equal(p.reason, 'no-current-turn-input-tokens')
  assert.equal(contextPressure(null).known, false)
  assert.equal(contextPressure({}).known, false)
})

test('absent cache fields count as zero but an absent input count does not', () => {
  const p = contextPressure({ lastTurn: { model: 'claude-haiku-4-5', in: 20_000 } })
  assert.equal(p.total, 20_000)
  assert.equal(p.percent, 10)
  assert.equal(contextPressure({ lastTurn: { model: 'claude-haiku-4-5', cacheRead: 20_000 } }).known, false)
})

test('percent is not silently clamped at 100', () => {
  const p = contextPressure({ lastTurn: { model: 'claude-haiku-4-5', in: 300_000, cacheRead: 0 } })
  assert.equal(p.percent, 150)
  assert.equal(p.over, true)
})

// ---------------------------------------------------------------- permission badges

test('bypassPermissions and acceptEdits get badges, everything else gets none', () => {
  assert.deepEqual(
    [permissionBadge({ permissionMode: 'bypassPermissions' }).label, permissionBadge({ permissionMode: 'bypassPermissions' }).level],
    ['YOLO', 'high'],
  )
  assert.deepEqual(
    [permissionBadge({ permissionMode: 'acceptEdits' }).label, permissionBadge({ permissionMode: 'acceptEdits' }).level],
    ['AUTO-EDIT', 'medium'],
  )
  for (const mode of ['default', 'plan', 'somethingNew', undefined, null, 42]) {
    assert.equal(permissionBadge({ permissionMode: mode }), null, `mode=${String(mode)}`)
  }
  assert.equal(permissionBadge(undefined), null)
})

test('badge copy describes the mode and does not editorialise', () => {
  for (const mode of ['bypassPermissions', 'acceptEdits']) {
    const note = permissionBadge({ permissionMode: mode }).note
    assert.ok(!/danger|warn|risk|caution|unsafe|!/i.test(note), `editorialising copy: ${note}`)
  }
})

test('a missing permissionMode reads as unknown, not as default', () => {
  assert.equal(permissionModeLabel({ permissionMode: 'plan' }), 'plan')
  assert.equal(permissionModeLabel({}), 'unknown')
  assert.equal(permissionModeLabel({ permissionMode: '  ' }), 'unknown')
  assert.equal(permissionModeLabel(undefined), 'unknown')
})

// ---------------------------------------------------------------- timestamp parsing

test('timestamps parse from ms, ISO and numeric strings; junk yields null not 0', () => {
  assert.equal(toEpochMs(NOW), NOW)
  assert.equal(toEpochMs('2026-07-29T14:30:00Z'), NOW)
  assert.equal(toEpochMs(String(NOW)), NOW)
  assert.equal(toEpochMs(new Date(NOW)), NOW)
  for (const junk of [null, undefined, '', '   ', 'yesterday', NaN, Infinity, new Date('nope'), {}]) {
    assert.equal(toEpochMs(junk), null, `junk=${String(junk)}`)
  }
})
