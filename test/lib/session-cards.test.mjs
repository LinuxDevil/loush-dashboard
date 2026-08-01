// test/lib/session-cards.test.mjs — sessions as kanban cards + the session↔file join.
// The assertions that matter: "we did not measure" never renders as "0 files changed", a session
// with no file activity stays ON the board, and every cap is reported alongside the true total.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIVITY, COLUMN_IDS, CARD_LIMITS, columnFor,
  buildSessionCards, sessionsForFile, searchCards, createSessionCardSource,
} from '../../lib/session-cards.mjs'

const NOW = 1_700_000_000_000
const MIN = 60_000, HOUR = 3_600_000, DAY = 24 * HOUR

const sess = (id, over = {}) => ({
  sessionId: id, project: 'dash', cwd: '/repo/dash', branch: 'main',
  cost: 1.5, durationMs: 10 * MIN, toolCalls: 12, errors: 0, last: NOW - MIN,
  transcript: `/t/${id}.jsonl`, ...over,
})

// ---------------------------------------------------------------------------
// columns
// ---------------------------------------------------------------------------

test('columns bucket by recency, and a session with no timestamp gets its OWN column', () => {
  assert.equal(columnFor(NOW - 2 * MIN, NOW).column, 'active')
  assert.equal(columnFor(NOW - 5 * HOUR, NOW).column, 'today')
  assert.equal(columnFor(NOW - 3 * DAY, NOW).column, 'week')
  assert.equal(columnFor(NOW - 40 * DAY, NOW).column, 'older')
  const u = columnFor(undefined, NOW)
  assert.equal(u.column, 'unknown')
  assert.equal(u.ageMs, null)                      // no invented age
  assert.match(u.reason, /no usable last-activity timestamp/)
  assert.equal(columnFor(0, NOW).column, 'unknown')
  assert.ok(COLUMN_IDS.includes('unknown'))
})

// ---------------------------------------------------------------------------
// the honesty property: unmeasured is not zero
// ---------------------------------------------------------------------------

test('a session with NO file-activity record stays on the board and is NOT shown as 0 files', () => {
  const b = buildSessionCards([sess('s-no-record')], { 's-other': ['/repo/dash/a.js'] }, { now: NOW })
  assert.equal(b.cards.length, 1)                  // not dropped
  const c = b.cards[0]
  assert.equal(c.activity, ACTIVITY.UNRECORDED)
  assert.equal(c.fileCount, null)                  // null, never 0
  assert.deepEqual(c.files, [])
  assert.match(c.reason, /NOT "0 files changed"/)
  assert.equal(b.totals.unrecorded, 1)
})

test('a session that WAS scanned and touched nothing is a distinct, measured state', () => {
  const b = buildSessionCards([sess('s-empty')], { 's-empty': [] }, { now: NOW })
  const c = b.cards[0]
  assert.equal(c.activity, ACTIVITY.RECORDED_EMPTY)
  assert.equal(c.fileCount, 0)                     // a measured zero
  assert.match(c.reason, /measured zero/)
  assert.equal(b.totals.recordedEmpty, 1)
  assert.equal(b.totals.unrecorded, 0)
})

test('totals exclude unmeasured cards from the file sum and SAY on what basis they were computed', () => {
  const b = buildSessionCards(
    [sess('a'), sess('b'), sess('c')],
    { a: ['/repo/dash/x.js', '/repo/dash/y.js'], b: [] },
    { now: NOW },
  )
  assert.equal(b.totals.filesTouched, 2)
  assert.match(b.totals.filesTouchedBasis, /2 of 3 card/)
  assert.match(b.totals.filesTouchedBasis, /1 card\(s\) are excluded/)
})

test('a missing file-activity dataset makes every card "unrecorded", not an empty board', () => {
  const b = buildSessionCards([sess('a'), sess('b')], null, { now: NOW })
  assert.equal(b.cards.length, 2)
  assert.ok(b.cards.every(c => c.activity === ACTIVITY.UNRECORDED && c.fileCount === null))
  assert.ok(b.problems.some(p => /no file-activity dataset/.test(p.reason)))
})

// ---------------------------------------------------------------------------
// links, both directions
// ---------------------------------------------------------------------------

test('session→files paths are relativised to the session cwd, deduped and sorted', () => {
  const b = buildSessionCards(
    [sess('a')],
    { a: ['/repo/dash/src/b.js', '/repo/dash/src/a.js', '/repo/dash/src/a.js', '/elsewhere/z.js'] },
    { now: NOW },
  )
  assert.deepEqual(b.cards[0].files, ['/elsewhere/z.js', 'src/a.js', 'src/b.js'])
  assert.equal(b.cards[0].fileCount, 3)
})

test('file→sessions is the reverse index, built from the FULL list, not the capped one', () => {
  const files = Array.from({ length: CARD_LIMITS.files + 5 }, (_, i) => `/repo/dash/f${String(i).padStart(3, '0')}.js`)
  const b = buildSessionCards([sess('a'), sess('b')], { a: files, b: [files.at(-1)] }, { now: NOW })
  const hidden = files.at(-1).replace('/repo/dash/', '')
  assert.equal(b.cards[0].files.includes(hidden), false, 'this file is beyond the per-card cap')
  const rev = sessionsForFile(b, hidden)
  assert.equal(rev.total, 2)                       // …yet both sessions still link to it
  assert.deepEqual(rev.sessions.map(s => s.sessionId).sort(), ['a', 'b'])
})

test('a file nobody touched answers with a reason that admits what could not be seen', () => {
  const b = buildSessionCards([sess('a')], { a: [] }, { now: NOW })
  const r = sessionsForFile(b, 'src/nope.js')
  assert.equal(r.total, 0)
  assert.match(r.reason, /no recorded session touched/)
  assert.match(r.reason, /unrecorded file activity/)
})

// ---------------------------------------------------------------------------
// caps — every bound reported
// ---------------------------------------------------------------------------

test('the per-card file list is capped, the cap is reported, and fileCount keeps the TRUE total', () => {
  const files = Array.from({ length: 40 }, (_, i) => `/repo/dash/f${i}.js`)
  const b = buildSessionCards([sess('a')], { a: files }, { now: NOW, filesCap: 10 })
  const c = b.cards[0]
  assert.equal(c.files.length, 10)
  assert.equal(c.fileCount, 40)                    // the card can still state the real number
  assert.equal(c.filesCapped.cap, 10)
  assert.equal(c.filesCapped.total, 40)
  assert.equal(c.filesCapped.hidden, 30)
  assert.match(c.filesCapped.reason, /10 of 40/)
  assert.equal(b.caps.filesPerCard, 10)
})

test('the card count is capped and the cap names how many sessions are NOT on the board', () => {
  const sessions = Array.from({ length: 12 }, (_, i) => sess('s' + i, { last: NOW - i * MIN }))
  const b = buildSessionCards(sessions, {}, { now: NOW, cardsCap: 5 })
  assert.equal(b.cards.length, 5)
  assert.equal(b.caps.cards.total, 12)
  assert.equal(b.caps.cards.hidden, 7)
  assert.match(b.caps.cards.reason, /7 older session\(s\) are NOT on this board/)
  assert.deepEqual(b.cards.map(c => c.sessionId), ['s0', 's1', 's2', 's3', 's4'])  // newest kept
})

test('the per-file session list is capped and reports the true count', () => {
  const many = Array.from({ length: CARD_LIMITS.sessions + 4 }, (_, i) => sess('s' + i))
  const activity = Object.fromEntries(many.map(s => [s.sessionId, ['/repo/dash/hot.js']]))
  const b = buildSessionCards(many, activity, { now: NOW })
  const hot = sessionsForFile(b, 'hot.js')
  assert.equal(hot.total, CARD_LIMITS.sessions + 4)
  assert.equal(hot.sessions.length, CARD_LIMITS.sessions)
  assert.equal(hot.capped.hidden, 4)
  assert.match(hot.capped.reason, /most recent are listed/)
})

// ---------------------------------------------------------------------------
// unknown-is-a-value on the card itself
// ---------------------------------------------------------------------------

test('a session with no cwd says why there is no resume path, instead of guessing one', () => {
  const b = buildSessionCards([sess('a', { cwd: '' })], { a: ['/abs/x.js'] }, { now: NOW })
  assert.equal(b.cards[0].cwd, null)
  assert.match(b.cards[0].cwdReason, /no reliable resume command/)
  assert.deepEqual(b.cards[0].files, ['/abs/x.js'])   // left absolute rather than mangled
})

test('unusable numeric fields become null, not 0', () => {
  const b = buildSessionCards([sess('a', { cost: 'n/a', durationMs: null, toolCalls: undefined })], {}, { now: NOW })
  const c = b.cards[0]
  assert.equal(c.cost, null)
  assert.equal(c.durationMs, null)
  assert.equal(c.toolCalls, null)
})

test('malformed rows are skipped WITH a reported reason and never throw', () => {
  for (const bad of [null, 7, 'x', { nope: 1 }]) {
    const b = buildSessionCards(bad, bad, { now: NOW })
    assert.ok(Array.isArray(b.cards))
    assert.ok(b.problems.length > 0)
  }
  const b = buildSessionCards([sess('a'), null, { cost: 1 }], { a: 'not-an-array', b: null }, { now: NOW })
  assert.equal(b.cards.length, 1)
  assert.ok(b.problems.some(p => /without a usable sessionId/.test(p.reason)))
  assert.ok(b.problems.some(p => /expected array/.test(p.reason)))
})

// ---------------------------------------------------------------------------
// search — a pure function
// ---------------------------------------------------------------------------

test('search filters and can STATE what it filtered by', () => {
  const b = buildSessionCards(
    [sess('a', { project: 'dash' }), sess('b', { project: 'other', last: NOW - 3 * DAY })],
    { a: ['/repo/dash/src/api.js'], b: ['/repo/dash/src/ui.js'] },
    { now: NOW },
  )
  const r = searchCards(b, { project: 'dash' })
  assert.equal(r.ok, true)
  assert.equal(r.total, 1)
  assert.equal(r.searched, 2)
  assert.match(r.describe, /1 of 2 session card\(s\), filtered by project=dash/)
  assert.match(searchCards(b, {}).describe, /no filter applied/)
  assert.equal(searchCards(b, { column: 'week' }).total, 1)
  assert.equal(searchCards(b.cards, { file: 'api' }).total, 1)
  assert.equal(searchCards(b, { text: 'other' }).total, 1)
})

test('an unknown column or activity filter is rejected BY NAME, never silently ignored', () => {
  const b = buildSessionCards([sess('a')], { a: [] }, { now: NOW })
  const r = searchCards(b, { column: 'done' })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'unknown_column')
  assert.deepEqual(r.allowed, COLUMN_IDS)
  assert.deepEqual(r.matched, [])                  // not the whole board under a bogus heading
  const a = searchCards(b, { activity: 'zero' })
  assert.equal(a.error, 'unknown_activity')
  assert.deepEqual(a.allowed, Object.values(ACTIVITY))
})

test('a file filter admits which cards it could not honestly rule out', () => {
  const files = Array.from({ length: 30 }, (_, i) => `/repo/dash/f${String(i).padStart(3, '0')}.js`)
  const b = buildSessionCards(
    [sess('capped'), sess('unmeasured')],
    { capped: files },
    { now: NOW, filesCap: 5 },
  )
  const r = searchCards(b, { file: 'f029' })
  assert.equal(r.total, 0)                         // it genuinely is not in the listed files
  const ids = r.uncertain.map(u => u.sessionId).sort()
  assert.deepEqual(ids, ['capped', 'unmeasured'])
  assert.match(r.uncertain.find(u => u.sessionId === 'capped').reason, /cannot be ruled out/)
  assert.match(r.uncertain.find(u => u.sessionId === 'unmeasured').reason, /neither match nor be excluded/)
})

test('search never throws and reports when an unusable query left the board UNFILTERED', () => {
  const b = buildSessionCards([sess('a')], {}, { now: NOW })
  const r = searchCards(b, 'nope')
  assert.equal(r.ok, true)
  assert.equal(r.total, 1)
  assert.ok(r.problems.some(p => /UNFILTERED/.test(p.reason)))
  assert.equal(searchCards(null, {}).total, 0)
  assert.equal(searchCards(undefined, undefined).ok, true)
})

// ---------------------------------------------------------------------------
// createSessionCardSource — injected data sources, so every source failure is unit-testable
// ---------------------------------------------------------------------------

test('the source adapter joins both injected readers', async () => {
  const src = createSessionCardSource({
    readSessions: async q => { assert.equal(q.days, 7); return [sess('a')] },
    readFileActivity: async () => ({ a: ['/repo/dash/x.js'] }),
  })
  const b = await src.build({ days: 7 }, { now: NOW })
  assert.equal(b.cards.length, 1)
  assert.deepEqual(b.cards[0].files, ['x.js'])
  assert.deepEqual(b.sourcesOk, { sessions: true, fileActivity: true })
})

test('a failing session source gives an empty board that SAYS the read failed', async () => {
  const src = createSessionCardSource({ readSessions: () => { throw new Error('EACCES') } })
  const b = await src.build({}, { now: NOW })
  assert.deepEqual(b.cards, [])
  assert.equal(b.sourcesOk.sessions, false)
  assert.ok(b.problems.some(p => /EMPTY BECAUSE THE READ FAILED/.test(p.reason)))
})

test('a failing or absent file-activity source degrades to "unrecorded", never to 0 files', async () => {
  const failing = createSessionCardSource({ readSessions: () => [sess('a')], readFileActivity: () => { throw new Error('boom') } })
  const b = await failing.build({}, { now: NOW })
  assert.equal(b.cards[0].activity, ACTIVITY.UNRECORDED)
  assert.equal(b.cards[0].fileCount, null)
  assert.equal(b.sourcesOk.fileActivity, false)
  assert.ok(b.problems.some(p => /fabricated 0/.test(p.reason)))

  const absent = createSessionCardSource({ readSessions: () => [sess('a')] })
  const c = await absent.build({}, { now: NOW })
  assert.equal(c.cards[0].fileCount, null)
  assert.ok(c.problems.some(p => /no readFileActivity\(\) was injected/.test(p.reason)))
})

test('the source adapter never throws, even with no readers at all', async () => {
  const b = await createSessionCardSource({}).build()
  assert.deepEqual(b.cards, [])
  assert.ok(b.problems.some(p => /NOT because there are no sessions/.test(p.reason)))
  const junk = await createSessionCardSource({ readSessions: () => 'nope', readFileActivity: () => 7 }).build({}, { now: NOW })
  assert.deepEqual(junk.cards, [])
  assert.ok(junk.problems.length > 0)
})

test('byColumn totals cover every column id so no card is invisible in the counts', () => {
  const b = buildSessionCards(
    [sess('a'), sess('b', { last: NOW - 5 * HOUR }), sess('c', { last: null })],
    {}, { now: NOW },
  )
  assert.deepEqual(Object.keys(b.totals.byColumn).sort(), [...COLUMN_IDS].sort())
  assert.equal(Object.values(b.totals.byColumn).reduce((a, x) => a + x, 0), b.cards.length)
  assert.equal(b.totals.byColumn.unknown, 1)
})
