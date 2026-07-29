import test from 'node:test'
import assert from 'node:assert/strict'
import { cacheWasteCost } from '../../lib/harness-usage-trends.mjs'
import { entryCacheRates } from '../../lib/pricing.mjs'

// This file exists because cacheWasteCost held a SECOND, untested copy of the cache-price
// ratios (`p * 1.25 - p * 0.1`) outside lib/pricing.mjs. Nothing would have caught it drifting
// from the real table, and nothing did: it priced 1-hour cache writes at the 5-minute rate for
// as long as it existed. The point of every assertion below is that the rates now come from the
// shared table, per entry, and that an unpriced model is treated as unknown rather than free.
//
// Standard Sonnet 5 rates, for reading the arithmetic: cacheWrite5m 3.75, cacheWrite1h 6,
// cacheRead 0.3 — all $/1M. No `t` on these entries, so no introductory rate applies.
const e = (over = {}) => ({ model: 'claude-sonnet-5', in: 0, out: 0, cc: 0, cc5: 0, cc1h: 0, cr: 0, ...over })
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`)

test('the write/read delta comes from the shared rate table', () => {
  const r = cacheWasteCost([e({ cc: 1e6, cc5: 1e6 })], entryCacheRates, 1)
  near(r.avgPriceDelta, 3.75 - 0.3)
  near(r.excessCreation, 1e6)
  near(r.wasteCost, 3.45)
})

test('a 1-hour cache write is costed above a 5-minute one', () => {
  const five = cacheWasteCost([e({ cc: 1e6, cc5: 1e6 })], entryCacheRates, 1)
  const hour = cacheWasteCost([e({ cc: 1e6, cc1h: 1e6 })], entryCacheRates, 1)
  near(hour.avgPriceDelta, 6 - 0.3)
  assert.ok(
    hour.wasteCost > five.wasteCost,
    'the old copy of the ratios priced both tiers at 1.25x, understating the 1h write side',
  )
})

test('an introductory rate reaches this calculation too', () => {
  // Nothing here knows about promos; it just asks the table what this entry cost. If the rate
  // plumbing regressed to a fixed ratio off a base price, this is where it would show.
  const std = cacheWasteCost([e({ cc: 1e6, cc5: 1e6 })], entryCacheRates, 1)
  const intro = cacheWasteCost([e({ cc: 1e6, cc5: 1e6, t: '2026-08-01T00:00:00Z' })], entryCacheRates, 1)
  assert.ok(intro.avgPriceDelta < std.avgPriceDelta, 'promo usage must cost less, not the same')
})

test('an unpriced model is left out of the average rather than averaged in as free', () => {
  // A model we hold no rate for is unknown, not $0. Counting its tokens in the denominator
  // would drag the average price down and quietly understate the waste.
  const priced = cacheWasteCost([e({ cc: 1e6, cc5: 1e6 })], entryCacheRates, 1)
  const mixed = cacheWasteCost(
    [e({ cc: 1e6, cc5: 1e6 }), e({ model: 'llama3-local', cc: 1e6, cc5: 1e6 })],
    entryCacheRates, 1,
  )
  near(mixed.avgPriceDelta, priced.avgPriceDelta)
  // Its tokens still count as volume — we know they were written, we just cannot price them.
  near(mixed.excessCreation, 2e6)
})

test('an all-unpriced corpus yields 0, never NaN', () => {
  const r = cacheWasteCost([e({ model: 'llama3-local', cc: 1e6, cc5: 1e6 })], entryCacheRates, 1)
  assert.equal(r.avgPriceDelta, 0)
  assert.equal(r.wasteCost, 0)
  assert.ok(Number.isFinite(r.wasteCost))
})

test('no entries at all yields 0, never NaN', () => {
  const r = cacheWasteCost([], entryCacheRates, 1)
  assert.equal(r.avgPriceDelta, 0)
  assert.equal(r.excessCreation, 0)
  assert.ok(Number.isFinite(r.wasteCost))
})

test('excess creation floors at zero rather than going negative', () => {
  // A corpus already at or above the best observed efficiency has wasted nothing; a negative
  // excess would render as a negative dollar figure, which reads as a refund.
  const r = cacheWasteCost([e({ cc: 1e6, cc5: 1e6, cr: 9e6 })], entryCacheRates, 0)
  assert.equal(r.excessCreation, 0)
  assert.equal(r.wasteCost, 0)
})

test('an entry with no tier breakdown is still priced, at the documented 5m fallback', () => {
  // Older transcripts may carry only the flat cache_creation total. It must not price as free.
  const r = cacheWasteCost([e({ cc: 1e6 })], entryCacheRates, 1)
  near(r.avgPriceDelta, 3.75 - 0.3)
})
