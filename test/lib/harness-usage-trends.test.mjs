import test from 'node:test'
import assert from 'node:assert/strict'
import { cacheWasteCost } from '../../lib/harness-usage-trends.mjs'
import { entryCacheRates } from '../../lib/pricing.mjs'

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
  const std = cacheWasteCost([e({ cc: 1e6, cc5: 1e6 })], entryCacheRates, 1)
  const intro = cacheWasteCost([e({ cc: 1e6, cc5: 1e6, t: '2026-08-01T00:00:00Z' })], entryCacheRates, 1)
  assert.ok(intro.avgPriceDelta < std.avgPriceDelta, 'promo usage must cost less, not the same')
})

test('an unpriced model is left out of the average rather than averaged in as free', () => {
  const priced = cacheWasteCost([e({ cc: 1e6, cc5: 1e6 })], entryCacheRates, 1)
  const mixed = cacheWasteCost(
    [e({ cc: 1e6, cc5: 1e6 }), e({ model: 'llama3-local', cc: 1e6, cc5: 1e6 })],
    entryCacheRates, 1,
  )
  near(mixed.avgPriceDelta, priced.avgPriceDelta)
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
  const r = cacheWasteCost([e({ cc: 1e6, cc5: 1e6, cr: 9e6 })], entryCacheRates, 0)
  assert.equal(r.excessCreation, 0)
  assert.equal(r.wasteCost, 0)
})

test('an entry with no tier breakdown is still priced, at the documented 5m fallback', () => {
  const r = cacheWasteCost([e({ cc: 1e6 })], entryCacheRates, 1)
  near(r.avgPriceDelta, 3.75 - 0.3)
})
