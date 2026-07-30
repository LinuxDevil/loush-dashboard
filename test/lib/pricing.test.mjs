import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PRICE_PER_M, isPriced, entryCost, dedupeTurns,
  rateFor, setPriceTable, getPriceTable, DEFAULT_PRICE_TABLE,
  splitCacheWrite, entryCacheRates, FALLBACKS, UNTIERED_CACHE_WRITE_TIER,
} from '../../lib/pricing.mjs'

const entry = (over = {}) => ({ model: 'claude-sonnet-5', in: 0, out: 0, cc: 0, cr: 0, ...over })
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`)

test('known models resolve to their published input rate', () => {
  assert.equal(PRICE_PER_M('claude-fable-5'), 10)
  assert.equal(PRICE_PER_M('claude-opus-5'), 5)
  assert.equal(PRICE_PER_M('claude-opus-4-8'), 5)
  assert.equal(PRICE_PER_M('claude-sonnet-5'), 3)
  assert.equal(PRICE_PER_M('claude-sonnet-4-6'), 3)
  assert.equal(PRICE_PER_M('claude-haiku-4-5-20251001'), 1)
})

test('a dated snapshot matches its family rule, and one generation cannot shadow another', () => {
  assert.equal(PRICE_PER_M('claude-haiku-4-5-20251001'), PRICE_PER_M('claude-haiku-4-5'))
  assert.equal(rateFor('claude-opus-4-8').out, 25)
  assert.equal(PRICE_PER_M('claude-opus-4-9'), null, 'an unreleased neighbour must not inherit 4-8’s rate')
})

test('an unrecognised model is unpriced rather than silently billed at another rate', () => {
  assert.equal(PRICE_PER_M('llama3-local'), null)
  assert.equal(isPriced('llama3-local'), false)
  assert.equal(isPriced('claude-opus-5'), true)
})

test('cost of an unpriced model is 0, never NaN', () => {
  const c = entryCost(entry({ model: 'llama3-local', in: 1e6, out: 1e6, cc: 1e6, cr: 1e6 }))
  assert.equal(c, 0)
  assert.ok(Number.isFinite(c))
})

test('entry cost bills each category at its own rate', () => {
  near(entryCost(entry({ in: 1e6 })), 3)
  near(entryCost(entry({ out: 1e6 })), 15)
  near(entryCost(entry({ cr: 1e6 })), 0.3)
  near(entryCost(entry({ cc: 1e6 })), 3.75)
})

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

test('a 1-hour cache write costs more than a 5-minute one', () => {
  near(entryCost(entry({ cc5: 1e6 })), 3.75)
  near(entryCost(entry({ cc1h: 1e6 })), 6)
  assert.ok(
    entryCost(entry({ cc1h: 1e6 })) > entryCost(entry({ cc5: 1e6 })),
    'pricing 1h at the 5m rate is the understatement this whole change fixes',
  )
})

test('a tiered entry ignores the flat total and prices the split', () => {
  const split = entryCost(entry({ cc: 1e6, cc5: 400_000, cc1h: 600_000 }))
  near(split, (400_000 * 3.75 + 600_000 * 6) / 1e6)
  assert.ok(split > entryCost(entry({ cc: 1e6 })), 'a mostly-1h record must cost more than the 5m fallback')
})

test('an entry with no tier fields falls back to 5m and says that it did', () => {
  const before = FALLBACKS.untieredCacheWrite
  entryCost(entry({ cc: 1e6 }))
  assert.equal(FALLBACKS.untieredCacheWrite, before + 1, 'an assumed tier must be countable, never silent')
  assert.equal(UNTIERED_CACHE_WRITE_TIER, '5m', 'the fallback preserves the pre-tier numbers to the cent')
})

test('a zero cache-creation total is not a fallback', () => {
  const before = FALLBACKS.untieredCacheWrite
  entryCost(entry({ in: 1e6 }))
  assert.equal(FALLBACKS.untieredCacheWrite, before, 'nothing was assumed, so nothing should be counted')
})

test('splitCacheWrite treats either tier field as authoritative', () => {
  assert.deepEqual(splitCacheWrite(1e6, 0, 1e6), { cc5: 0, cc1h: 1e6 })
  assert.deepEqual(splitCacheWrite(1e6, 1e6, 0), { cc5: 1e6, cc1h: 0 })
  assert.deepEqual(splitCacheWrite(500, 500, 0), { cc5: 500, cc1h: 0 })
})

test('entryCacheRates blends the write rate across the tiers actually present', () => {
  assert.deepEqual(entryCacheRates(entry({ cc5: 1e6 })), { write: 3.75, read: 0.3 })
  assert.deepEqual(entryCacheRates(entry({ cc1h: 1e6 })), { write: 6, read: 0.3 })
  const mixed = entryCacheRates(entry({ cc5: 1e6, cc1h: 1e6 }))
  near(mixed.write, (3.75 + 6) / 2)
  assert.deepEqual(entryCacheRates(entry({ model: 'llama3-local', cc1h: 1e6 })), { write: 0, read: 0 })
})

test('entryCacheRates does not double-count the untiered fallback', () => {
  const before = FALLBACKS.untieredCacheWrite
  entryCacheRates(entry({ cc: 1e6 }))
  assert.equal(FALLBACKS.untieredCacheWrite, before, 'only entryCost owns the counter, or one entry counts twice')
})

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

test('usage on or before the promo cutoff prices at the intro rate', () => {
  assert.equal(PRICE_PER_M('claude-sonnet-5', '2026-08-30T12:00:00Z'), 2, 'day before the cutoff')
  assert.equal(PRICE_PER_M('claude-sonnet-5', '2026-08-31T23:59:00Z'), 2, 'cutoff day is inclusive')
  assert.equal(PRICE_PER_M('claude-sonnet-5', '2026-09-01T00:00:00Z'), 3, 'day after reverts to standard')
})

test('a model with no promo is unaffected by its timestamp', () => {
  assert.equal(PRICE_PER_M('claude-opus-5', '2026-01-01T00:00:00Z'), 5)
  assert.equal(PRICE_PER_M('claude-opus-5', '2027-01-01T00:00:00Z'), 5)
})

test('an entry with no timestamp prices at standard, not at the promo', () => {
  assert.equal(PRICE_PER_M('claude-sonnet-5'), 3)
  near(entryCost(entry({ in: 1e6 })), 3)
  near(entryCost(entry({ in: 1e6, t: '2026-08-01T00:00:00Z' })), 2)
})

test('an unparseable timestamp prices at standard rather than throwing', () => {
  assert.equal(PRICE_PER_M('claude-sonnet-5', 'not-a-date'), 3)
})

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

test('an injected table overrides the defaults, and clearing it restores them', () => {
  try {
    setPriceTable([{ match: 'claude-opus-5', in: 99, out: 1, cacheRead: 1, cacheWrite5m: 1, cacheWrite1h: 1 }])
    assert.equal(PRICE_PER_M('claude-opus-5'), 99)
    setPriceTable([])
    assert.equal(PRICE_PER_M('claude-opus-5'), 5, 'an emptied table reads as "reset", never as $0')
    setPriceTable(null)
    assert.equal(getPriceTable(), DEFAULT_PRICE_TABLE)
  } finally {
    setPriceTable(null)
  }
})

test('a user table that omits a model leaves it unpriced rather than defaulted', () => {
  try {
    setPriceTable([{ match: 'claude-sonnet-5', in: 3, out: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 }])
    assert.equal(PRICE_PER_M('claude-opus-5'), null)
    assert.equal(isPriced('claude-opus-5'), false)
    assert.equal(entryCost(entry({ model: 'claude-opus-5', in: 1e6 })), 0)
  } finally {
    setPriceTable(null)
  }
})

test('every default rule carries all five rates', () => {
  for (const r of DEFAULT_PRICE_TABLE) {
    for (const k of ['in', 'out', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h']) {
      assert.equal(typeof r[k], 'number', `${r.id || r.match} is missing ${k}`)
    }
    if (r.intro) {
      assert.ok(r.intro_until, `${r.id || r.match} has intro rates but no cutoff date`)
      for (const k of ['in', 'out', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h']) {
        assert.equal(typeof r.intro[k], 'number', `${r.id || r.match} intro is missing ${k}`)
      }
    }
  }
})

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

test('repeated records for one streamed turn collapse to the last', () => {
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
