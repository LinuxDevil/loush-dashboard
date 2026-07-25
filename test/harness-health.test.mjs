// Tests for harness-health.mjs — the A–F grade on the Harness ▸ Usage panel.
//
// The audit's charge: it could not express "no data". Two of three factors returned score:50 with no
// `na` flag, so they entered the weighted mean as if measured — a brand-new install scored 50/D, one
// turn scored 25/F, and one good day flipped it to A. These pin the null discipline and the
// arithmetic, including a regression predicate that was dead code.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeUsageHealth, computeRegression, MIN_TURNS_FOR_GRADE } from '../harness-health.mjs'

const DAY = 86400_000
const NOW = Date.parse('2026-06-15T12:00:00Z')
const cost = e => (e.out || 0) * 0.001
// n entries inside the window starting `agoMs` back
const turns = (n, agoMs, over = {}) =>
  Array.from({ length: n }, (_, i) => ({ t: NOW - agoMs - i * 1000, in: 1000, out: 200, cc: 500, cr: 9000, ...over }))

test('no entries yields a NULL grade, not F and not 0', () => {
  const h = computeUsageHealth([], cost, 3800, NOW)
  assert.equal(h.total, null)
  assert.equal(h.grade, null)
  assert.equal(h.reason, 'insufficient-data')
})

test('below the minimum turn count the grade stays null — a letter must not swing on n=1', () => {
  for (const n of [1, 5, MIN_TURNS_FOR_GRADE - 1]) {
    const h = computeUsageHealth(turns(n, 0), cost, 3800, NOW)
    assert.equal(h.grade, null, `n=${n} should not produce a grade`)
    assert.equal(h.n, n)
    assert.equal(h.minN, MIN_TURNS_FOR_GRADE)
  }
})

test('at or above the minimum a grade is produced', () => {
  const h = computeUsageHealth([...turns(20, 0), ...turns(20, 9 * DAY)], cost, 3800, NOW)
  assert.ok(h.total != null && h.grade != null)
  assert.match(h.grade, /^[A-F]$/)
})

test('a factor with no data is na and is DROPPED from the mean, never counted as 50', () => {
  // No cache tokens at all -> cacheEfficiency has nothing to measure.
  const h = computeUsageHealth(turns(30, 0, { cc: 0, cr: 0 }), cost, 3800, NOW)
  const cache = h.factors.find(f => f.name === 'cacheEfficiency')
  assert.equal(cache.na, true)
  assert.equal(cache.score, null, 'must be null, not a fabricated 50')

  // The reported total must equal the weighted mean of the non-na factors only.
  const live = h.factors.filter(f => !f.na)
  const expected = Math.round(live.reduce((s, f) => s + f.score * f.weight, 0) / live.reduce((s, f) => s + f.weight, 0))
  assert.equal(h.total, expected)
})

test('costTrend compares PER-TURN rates, so simply working more is not a regression', () => {
  // Same cost per turn both weeks, but three times as many turns this week.
  const cur = turns(60, 0)
  const prev = turns(20, 9 * DAY)
  const h = computeUsageHealth([...cur, ...prev], cost, 3800, NOW)
  const ct = h.factors.find(f => f.name === 'costTrend')
  assert.equal(ct.raw.changePct, 0, 'identical per-turn cost must read as 0% change despite 3x the volume')
  assert.equal(ct.score, 100)
})

test('costTrend does flag a genuine per-turn cost increase', () => {
  const cur = turns(30, 0, { out: 400 })       // 2x the output per turn
  const prev = turns(30, 9 * DAY, { out: 200 })
  const ct = computeUsageHealth([...cur, ...prev], cost, 3800, NOW).factors.find(f => f.name === 'costTrend')
  assert.equal(ct.raw.changePct, 100)
  assert.equal(ct.score, 0)
})

test('contextEfficiency is flagged as resting on an assumed constant', () => {
  const ce = computeUsageHealth(turns(30, 0), cost, 3800, NOW).factors.find(f => f.name === 'contextEfficiency')
  assert.equal(ce.assumed, true, 'hiddenPerTurn is assumed, not measured, and is user-overridable')
  assert.equal(ce.raw.hiddenPerTurn, 3800)
})

// ---------------------------------------------------------------- computeRegression

test('computeRegression returns null below the sample floor', () => {
  const r = computeRegression(turns(3, 0), NOW)
  assert.equal(r.tokensPerTurn, null)
  assert.equal(r.regressed, false)
})

test('computeRegression detects a real week-over-week per-turn increase', () => {
  // default turn is ~10,700 tok; double the cache-read to clear the 15% default threshold
  const cur = turns(10, 0, { cr: 18000 })
  const prev = turns(10, 9 * DAY, { cr: 9000 })
  const r = computeRegression([...cur, ...prev], NOW)
  assert.equal(r.regressed, true, `deltaPct was ${r.tokensPerTurn?.deltaPct}`)
  assert.ok(r.tokensPerTurn.deltaPct >= 15)
})

test('computeRegression can actually attribute a cause — the window predicate was inverted, so it never could', () => {
  // Cache hit-rate collapses this week (cr 9000 -> 1000) while total tokens per turn rise.
  const cur = turns(10, 0, { in: 4000, cr: 1000, cc: 9000 })
  const prev = turns(10, 9 * DAY, { in: 1000, cr: 9000, cc: 500 })
  const r = computeRegression([...cur, ...prev], NOW)
  assert.equal(r.regressed, true)
  assert.equal(r.cause, 'cache-hit-rate dropped',
    'the old `if (age > from || age <= to) continue` skipped every entry, so cause was permanently null')
})

test('computeRegression reports no cause when the cache rate did not move', () => {
  const cur = turns(10, 0, { in: 4000 })
  const prev = turns(10, 9 * DAY, { in: 1000 })
  const r = computeRegression([...cur, ...prev], NOW)
  assert.equal(r.regressed, true)
  assert.equal(r.cause, null)
})
