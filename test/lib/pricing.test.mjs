import test from 'node:test'
import assert from 'node:assert/strict'
import { PRICE_PER_M, isPriced, entryCost, dedupeTurns } from '../../lib/pricing.mjs'

const entry = (over = {}) => ({ model: 'claude-sonnet-5', in: 0, out: 0, cc: 0, cr: 0, ...over })

test('known models resolve to their published input rate', () => {
  assert.equal(PRICE_PER_M('claude-opus-5'), 15)
  assert.equal(PRICE_PER_M('claude-sonnet-5'), 3)
  assert.equal(PRICE_PER_M('claude-haiku-4-5-20251001'), 1)
})

test('an unrecognised model is unpriced rather than silently billed at another rate', () => {
  // The regression this guards: the old ladder ended in `: 3`, so a local model was
  // indistinguishable from Sonnet on every dollar figure in the product.
  assert.equal(PRICE_PER_M('llama3-local'), null)
  assert.equal(isPriced('llama3-local'), false)
  assert.equal(isPriced('claude-opus-5'), true)
})

test('cost of an unpriced model is 0, never NaN', () => {
  const c = entryCost(entry({ model: 'llama3-local', in: 1e6, out: 1e6, cc: 1e6, cr: 1e6 }))
  assert.equal(c, 0)
  assert.ok(Number.isFinite(c))
})

test('entry cost applies the output and cache ratios off the input rate', () => {
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`)
  near(entryCost(entry({ in: 1e6 })), 3)      // input at 1x
  near(entryCost(entry({ out: 1e6 })), 15)    // output at 5x
  near(entryCost(entry({ cc: 1e6 })), 3.75)   // cache write at 1.25x
  near(entryCost(entry({ cr: 1e6 })), 0.3)    // cache read at 0.1x
})

test('repeated records for one streamed turn collapse to the last', () => {
  // Real transcripts append a turn repeatedly as it streams; each record carries the same
  // message.id and cumulative usage. Counting them all inflated total cost by ~2.12x.
  const deduped = dedupeTurns([
    { id: 'msg_a', e: entry({ out: 2 }) },
    { id: 'msg_a', e: entry({ out: 235 }) },
    { id: 'msg_b', e: entry({ out: 7 }) },
  ])
  assert.equal(deduped.length, 2)
  assert.equal(deduped[0].e.out, 235, 'last record for an id wins — it holds the final totals')
  assert.equal(deduped[1].e.out, 7)
})

test('a repeated id keeps the position of its first sighting', () => {
  const deduped = dedupeTurns([
    { id: 'first', e: entry({ out: 1 }) },
    { id: 'second', e: entry({ out: 2 }) },
    { id: 'first', e: entry({ out: 99 }) },
  ])
  // Chronological order has to survive dedup, since first/last timestamps are folded in order.
  assert.deepEqual(deduped.map(r => r.id), ['first', 'second'])
  assert.equal(deduped[0].e.out, 99)
})

test('records without a message.id are never collapsed together', () => {
  const deduped = dedupeTurns([
    { id: undefined, e: entry({ out: 1 }) },
    { id: undefined, e: entry({ out: 2 }) },
    { id: undefined, e: entry({ out: 3 }) },
  ])
  assert.equal(deduped.length, 3, 'unrelated turns must not merge just because they lack an id')
  assert.deepEqual(deduped.map(r => r.e.out), [1, 2, 3])
})

test('deduping is what keeps a doubled transcript from doubling the bill', () => {
  const once = [{ id: 'x', e: entry({ in: 1e6 }) }]
  const streamed = [{ id: 'x', e: entry({ in: 1e6 }) }, { id: 'x', e: entry({ in: 1e6 }) }]
  const total = rs => dedupeTurns(rs).reduce((s, r) => s + entryCost(r.e), 0)
  assert.equal(total(streamed), total(once))
})
