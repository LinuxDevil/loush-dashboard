// Tests for harness-metrics.mjs — the capability ROI verdict and the context-pressure table.
// These live outside server.mjs precisely so they can be tested: server.mjs opens a listener on
// import, which is why this arithmetic had no coverage at all.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  capabilityVerdict, tokPerFire, sessionsSince, contextPressure,
  NEW_CAPABILITY_DAYS, CHARS_PER_TOKEN, median,
} from '../lib/harness-metrics.mjs'

// ---------------------------------------------------------------- capabilityVerdict

test('a capability installed this morning is NEW, not DEAD', () => {
  // The audit's case: the ledger labelled a skill installed yesterday DEAD — the same label as one
  // abandoned a year ago — and the headline invited you to archive it.
  assert.equal(capabilityVerdict({ firesAll: 0, fires30: 0, ageDays: 0 }), 'NEW')
  assert.equal(capabilityVerdict({ firesAll: 0, fires30: 0, ageDays: NEW_CAPABILITY_DAYS - 1 }), 'NEW')
})

test('a genuinely abandoned capability is still DEAD', () => {
  assert.equal(capabilityVerdict({ firesAll: 0, fires30: 0, ageDays: NEW_CAPABILITY_DAYS }), 'DEAD')
  assert.equal(capabilityVerdict({ firesAll: 0, fires30: 0, ageDays: 400 }), 'DEAD')
})

test('firing at all beats being new — a young capability that fired is HOT', () => {
  assert.equal(capabilityVerdict({ firesAll: 3, fires30: 3, ageDays: 1 }), 'HOT')
  assert.equal(capabilityVerdict({ firesAll: 3, fires30: 0, ageDays: 1 }), 'COLD')
})

test('unknown age falls back to the old behaviour rather than inventing a NEW verdict', () => {
  assert.equal(capabilityVerdict({ firesAll: 0, fires30: 0, ageDays: null }), 'DEAD')
})

// ---------------------------------------------------------------- tokPerFire

test('tokPerFire charges only the sessions that could have loaded the capability', () => {
  // Install yesterday, fire once, with 3 sessions since install out of 500 in the window.
  // Old formula charged all 500 sessions' worth of always-on tax to that one fire.
  const scoped = tokPerFire({ descTokens: 100, fires: 1, sessionsSinceInstall: 3 })
  const unscoped = 100 * 500 / 1
  assert.equal(scoped, 300)
  assert.ok(scoped < unscoped / 100, 'the lifetime-scoped figure must be dramatically smaller')
})

test('tokPerFire is null when it cannot be computed, never 0', () => {
  assert.equal(tokPerFire({ descTokens: 100, fires: 0, sessionsSinceInstall: 50 }), null, 'no fires')
  assert.equal(tokPerFire({ descTokens: 100, fires: 5, sessionsSinceInstall: null }), null, 'unknown install date')
  assert.equal(tokPerFire({ descTokens: 100, fires: 5, sessionsSinceInstall: 0 }), null, 'no sessions since install')
})

test('tokPerFire scales linearly with sessions and inversely with fires', () => {
  assert.equal(tokPerFire({ descTokens: 200, fires: 2, sessionsSinceInstall: 10 }), 1000)
  assert.equal(tokPerFire({ descTokens: 200, fires: 4, sessionsSinceInstall: 10 }), 500)
})

// ---------------------------------------------------------------- sessionsSince

test('sessionsSince counts only sessions after the install, bounded by the window', () => {
  const t = n => Date.parse('2026-06-01T00:00:00Z') + n * 86400_000
  const times = [t(0), t(5), t(10), t(20)]
  assert.equal(sessionsSince(times, t(9), 0), 2, 'sessions on days 10 and 20')
  assert.equal(sessionsSince(times, t(0), 0), 4)
  assert.equal(sessionsSince(times, t(9), t(15)), 1, 'window start is later than install, so it wins')
})

test('sessionsSince returns null for an unknown install date rather than guessing', () => {
  assert.equal(sessionsSince([1, 2, 3], null), null)
})

// ---------------------------------------------------------------- contextPressure

test('contextPressure names its denominator instead of implying share of the context window', () => {
  const r = contextPressure({ bytesByTool: { Read: 8000, Bash: 2000 }, sizesByTool: { Read: [8000], Bash: [2000] } })
  const read = r.tools.find(t => t.name === 'Read')
  assert.equal(read.shareOfToolBytes, 0.8)
  assert.equal('share' in read, false, 'the ambiguous field name is gone')
  assert.match(r.denominator, /excludes system prompt/i)
})

test('contextPressure reports an explicit token ESTIMATE rather than passing chars off as tokens', () => {
  const r = contextPressure({ bytesByTool: { Read: 40000 }, sizesByTool: { Read: [40000] } })
  assert.equal(r.tools[0].estTokens, 40000 / CHARS_PER_TOKEN)
  assert.equal(r.totalEstTokens, 40000 / CHARS_PER_TOKEN)
  assert.equal(r.charsPerToken, CHARS_PER_TOKEN, 'the divisor is disclosed, not hidden')
})

test('a tool with no recorded results has NULL medians, not 0', () => {
  const r = contextPressure({ bytesByTool: { Grep: 500 }, sizesByTool: {} })
  assert.equal(r.tools[0].medianChars, null)
  assert.equal(r.tools[0].p90Chars, null)
  assert.equal(r.tools[0].hog, false, 'a null median must not satisfy the >= 20k hog test')
})

test('contextPressure does not mutate the caller arrays — the p90 used to sort in place', () => {
  const sizes = [500, 100, 900, 300]
  const snapshot = [...sizes]
  contextPressure({ bytesByTool: { Read: 1800 }, sizesByTool: { Read: sizes } })
  assert.deepEqual(sizes, snapshot, 'input array order must be preserved')
})

test('the hog flag fires on a genuinely large median and its percentiles are right', () => {
  const sizes = [21000, 22000, 25000, 30000, 90000]
  const r = contextPressure({ bytesByTool: { Read: 188000 }, sizesByTool: { Read: sizes } })
  const read = r.tools[0]
  assert.equal(read.hog, true)
  assert.equal(read.medianChars, 25000)
  // p90 uses the repo's one correct percentile convention — index floor((n-1) * p), no
  // interpolation — so for n=5 that is a[3]. Pinned here so a future edit cannot quietly switch
  // conventions again; the audit found six mutually-inconsistent implementations.
  assert.equal(read.p90Chars, 30000)
  assert.equal(read.results, 5)
})

test('median returns null on empty input', () => {
  assert.equal(median([]), null)
  assert.equal(median([7]), 7)
})

test('contextPressure on no data returns an empty table, not a fabricated row', () => {
  const r = contextPressure({ bytesByTool: {}, sizesByTool: {} })
  assert.deepEqual(r.tools, [])
  assert.equal(r.totalChars, 0)
})
