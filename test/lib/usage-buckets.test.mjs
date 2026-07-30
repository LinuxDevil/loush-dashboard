// Tests for usage-buckets.mjs — bucketing by (model, speed, inference_geo, service_tier).
//
// The last block runs against the caller's REAL transcripts under ~/.claude/projects when they are
// present, and skips cleanly when they are not. That is where the interesting cases actually live:
// in this checkout 30% of usage records have no `speed` field and every one reports
// `inference_geo: "not_available"`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { bucketUsage, classifyDimension, UNKNOWN, DIMENSIONS } from '../../lib/usage-buckets.mjs'
import { findTranscripts, readTranscript, usageRecords } from '../../lib/transcript-records.mjs'

const AT = Date.parse('2026-01-15T00:00:00Z')
const e = (over = {}) => ({
  t: AT, model: 'claude-sonnet-4-5', speed: 'standard', inference_geo: 'us', service_tier: 'standard',
  in: 1000, out: 1000, cc: 0, cr: 0, ...over,
})

// ---------------------------------------------------------------- classifyDimension

test('an absent dimension and a "not_available" sentinel are both unknown but stay distinguishable', () => {
  assert.deepEqual(classifyDimension(undefined), { label: UNKNOWN, state: 'absent' })
  assert.equal(classifyDimension('not_available').state, 'sentinel')
  assert.equal(classifyDimension('not_available').label, UNKNOWN)
  assert.equal(classifyDimension('standard').state, 'known')
  // A number here means the schema moved; it must not be stringified into a bucket key that reads
  // like a real service tier.
  assert.equal(classifyDimension(3).state, 'malformed')
  assert.equal(classifyDimension(3).label, UNKNOWN)
})

// ---------------------------------------------------------------- bucketing

test('entries split by all four dimensions', () => {
  const r = bucketUsage([e(), e(), e({ service_tier: 'priority' }), e({ model: 'claude-opus-4-1' })])
  assert.equal(r.bucketCount, 3)
  assert.equal(r.buckets.find(b => b.service_tier === 'priority').entries, 1)
  assert.equal(r.buckets.find(b => b.model === 'claude-sonnet-4-5' && b.service_tier === 'standard').entries, 2)
})

test('a missing dimension gets the explicit unknown label and is COUNTED, not defaulted', () => {
  const r = bucketUsage([e(), e({ speed: undefined }), e({ speed: undefined })])
  const unknownBucket = r.buckets.find(b => b.speed === UNKNOWN)
  assert.ok(unknownBucket, 'unknown is its own bucket, never merged into "standard"')
  assert.equal(unknownBucket.entries, 2)
  assert.deepEqual(unknownBucket.unknownDimensions, ['speed'])
  assert.equal(r.dimensions.stats.speed.absent, 2)
  assert.equal(r.dimensions.stats.speed.known, 1)
  assert.equal(r.dimensions.unknownEntries.speed, 2, 'the count of unknown-dimension entries is reported')
  assert.equal(r.dimensions.unknownBuckets, 1)
})

test('bucket cost uses the real rate table and is exact', () => {
  const r = bucketUsage([e({ in: 1e6, out: 0 }), e({ in: 1e6, out: 0 })])
  assert.equal(+r.buckets[0].cost.toFixed(6), 6, '2 x 1M input at $3/M')
  assert.equal(r.totals.pricedUsd, 6)
  assert.equal(r.totals.complete, true)
  assert.equal(r.totals.coverage, 1)
})

// ---------------------------------------------------------------- unpriced is not $0

test('an unpriceable bucket surfaces with cost null and a reason, never $0', () => {
  const r = bucketUsage([e({ model: 'mystery-9', in: 1e6 })])
  const b = r.buckets[0]
  assert.equal(b.priced, false)
  assert.equal(b.cost, null)
  assert.notEqual(b.cost, 0)
  assert.equal(b.costReason, 'unknown-model')
  assert.deepEqual(b.unpricedReasons, { 'unknown-model': 1 })
  // The bucket still has its tokens: we know how much was USED, just not what it cost.
  assert.equal(b.tokens.input, 1e6)
})

test('the grand total is named as covering the priced subset only', () => {
  const r = bucketUsage([e({ in: 1e6, out: 0 }), e({ model: 'mystery-9', in: 5e6 })])
  assert.equal(r.totals.pricedUsd, 3)
  assert.equal(r.totals.unpricedEntries, 1)
  assert.equal(r.totals.complete, false, 'a total missing half its entries must never claim completeness')
  assert.equal(r.totals.coverage, 0.5)
  assert.match(r.totals.basis, /NOT counted as \$0/)
  assert.equal('usd' in r.totals, false, 'the unqualified field name is deliberately absent')
})

test('a partly-priced bucket reports partialCost, not cost — a partial number is not the whole', () => {
  // Same four dimensions, but one entry sits before any known rate period for that model.
  const r = bucketUsage([e({ model: 'claude-haiku-4-5', in: 1e6, out: 0 }), e({ model: 'claude-haiku-4-5', t: Date.parse('2024-01-01'), in: 1e6, out: 0 })])
  const b = r.buckets[0]
  assert.equal(b.cost, null, 'cost is null unless EVERY entry in the bucket was priced')
  assert.equal(+b.partialCost.toFixed(6), 1)
  assert.equal(b.costReason, 'some-entries-unpriced')
  assert.equal(b.pricedEntries, 1)
  assert.equal(b.unpricedEntries, 1)
  assert.deepEqual(b.unpricedReasons, { 'no-rate-at-time': 1 })
})

test('unpriced reasons are aggregated at the top level so a whole-fleet gap is visible', () => {
  const r = bucketUsage([e({ model: 'a' }), e({ model: 'b' }), e({ t: null })])
  assert.equal(r.totals.unpricedReasons['unknown-model'], 2)
  assert.equal(r.totals.unpricedReasons['unknown-time'], 1)
  assert.equal(r.totals.pricedUsd, null, 'nothing priced at all means null, not 0')
})

// ---------------------------------------------------------------- modelled numbers say so

test('an assumed cache-write tier makes the bucket estimated and publishes the bound', () => {
  const r = bucketUsage([e({ in: 0, out: 0, cc: 1e6 })])
  const b = r.buckets[0]
  assert.equal(b.estimated, true)
  assert.equal(b.assumptions[0].field, 'cacheWriteTier')
  assert.equal(b.assumptions[0].entries, 1)
  assert.equal(r.totals.estimated, true)
  assert.ok(r.totals.maxUnderstatementUsd > 0, 'the size of the possible error is in the payload')
  assert.equal(r.totals.assumptionCounts.cacheWriteTier, 1)
})

test('an observed 5m/1h split is exact and NOT flagged estimated', () => {
  const r = bucketUsage([e({
    in: 0, out: 0, cc: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1e6 } },
  })])
  assert.equal(r.buckets[0].estimated, false)
  assert.equal(r.totals.maxUnderstatementUsd, 0)
  assert.equal(+r.buckets[0].cost.toFixed(6), 6, '1M 1h-writes at Sonnet 2x = $6')
})

test('a total built from family-guessed rates is flagged estimated at the TOP level too', () => {
  // Regression: totals.estimated was derived from maxUnderstatementUsd alone, so a total made
  // entirely of family-regex rates reported estimated:false while every bucket under it said true.
  // Model deliberately absent from the price table: with `claude-opus-5` this asserts nothing,
  // because that model has an exact table entry and its rate is not a guess at all.
  const r = bucketUsage([e({ model: 'claude-opus-99-experimental', in: 1e6, out: 0 })], { allowFamilyFallback: true })
  assert.equal(r.buckets[0].estimated, true)
  assert.equal(r.totals.estimated, true, 'the headline must not look observed when its inputs were guessed')
  assert.equal(r.totals.estimatedEntries, 1)
  assert.equal(r.totals.maxUnderstatementUsd, 0, 'no cache-tier assumption here — the flag comes from the rate')
})

// ---------------------------------------------------------------- bounds are reported

test('a limit that hides buckets reports what was hidden AND keeps their dollars in the total', () => {
  const entries = [e({ in: 3e6 }), e({ model: 'claude-opus-4-1', in: 1e6 }), e({ model: 'claude-haiku-4-5', in: 1e6 })]
  const r = bucketUsage(entries, { limit: 1 })
  assert.equal(r.buckets.length, 1)
  assert.equal(r.bucketCount, 3, 'the true bucket count is still reported')
  const b = r.bounds.find(x => x.bound === 'limit')
  assert.ok(b)
  assert.equal(b.hiddenBuckets, 2)
  assert.equal(b.hiddenEntries, 2)
  assert.ok(b.hiddenPricedUsd > 0, 'the dollars behind the fold are quantified')
  // Rows sum to less than the total; the bound is what makes that reconcilable rather than a bug.
  const shown = r.buckets.reduce((s, x) => s + (x.cost ?? 0), 0)
  assert.ok(shown < r.totals.pricedUsd)
  assert.equal(+(shown + b.hiddenPricedUsd).toFixed(6), +r.totals.pricedUsd.toFixed(6))
})

test('a minEntries floor reports the buckets it dropped instead of vanishing them', () => {
  const r = bucketUsage([e(), e(), e({ model: 'claude-opus-4-1' })], { minEntries: 2 })
  assert.equal(r.buckets.length, 1)
  const b = r.bounds.find(x => x.bound === 'minEntries')
  assert.equal(b.droppedBuckets, 1)
  assert.equal(b.droppedEntries, 1)
  assert.equal(r.totals.entries, 3, 'totals still cover everything that came in')
})

test('no bound is reported when no bound was applied', () => {
  assert.deepEqual(bucketUsage([e()]).bounds, [])
})

// ---------------------------------------------------------------- robustness

test('junk entries are skipped and counted, never thrown on', () => {
  const r = bucketUsage([null, 42, 'x', e()])
  assert.equal(r.totals.skippedEntries, 3)
  assert.equal(r.totals.complete, false, 'skipped input makes the result incomplete by definition')
  assert.equal(r.buckets.length, 1)
})

test('non-array input returns an empty, honest result rather than throwing', () => {
  for (const bad of [null, undefined, 'x', 42, {}]) {
    const r = bucketUsage(bad)
    assert.deepEqual(r.buckets, [])
    assert.equal(r.totals.pricedUsd, null)
    assert.equal(r.totals.complete, false)
  }
})

test('every entry lands in exactly one bucket — no entry is lost or double-counted', () => {
  const entries = [e(), e({ speed: undefined }), e({ model: 'claude-opus-4-1' }), e({ inference_geo: 'not_available' }), e()]
  const r = bucketUsage(entries)
  assert.equal(r.buckets.reduce((s, b) => s + b.entries, 0), entries.length)
})

// ---------------------------------------------------------------- real data

test('bucketing holds up on the real transcripts under ~/.claude/projects', { skip: !fs.existsSync(path.join(os.homedir(), '.claude', 'projects')) }, () => {
  const base = path.join(os.homedir(), '.claude', 'projects')
  // Recursive on purpose: subagent transcripts live in nested `<session>/subagents/*.jsonl` dirs and
  // a non-recursive glob silently omits a large share of real usage.
  const files = findTranscripts(base)
  const entries = files.flatMap(f => usageRecords(readTranscript(f).records))
  if (!entries.length) return

  const r = bucketUsage(entries, { allowFamilyFallback: false })

  assert.equal(r.buckets.reduce((s, b) => s + b.entries, 0), entries.length, 'no real entry is lost in bucketing')
  assert.equal(r.totals.entries, entries.length)
  assert.equal(r.totals.skippedEntries, 0, 'usageRecords should already have filtered unusable records')

  for (const b of r.buckets) {
    assert.ok(DIMENSIONS.every(d => typeof b[d] === 'string' && b[d].length), 'every dimension is labelled')
    // The load-bearing invariant: no bucket ever shows a dollar figure it could not compute.
    if (!b.priced) assert.equal(b.cost, null)
    if (b.priced) assert.ok(typeof b.cost === 'number' && b.cost >= 0)
  }

  // These models are not in the shipped rate table, so with fallback off the honest answer for the
  // author's own usage is "unpriced" — not a confident wrong number from a name regex.
  if (r.totals.unpricedEntries > 0) {
    assert.equal(r.totals.pricedUsd === null || r.totals.complete === false, true)
    assert.ok(Object.keys(r.totals.unpricedReasons).length > 0, 'every unpriced entry has a stated reason')
  }

  // Turning the fallback on must price strictly more, and must mark what it produced as estimated.
  const est = bucketUsage(entries, { allowFamilyFallback: true })
  assert.ok(est.totals.pricedEntries >= r.totals.pricedEntries)
  if (est.totals.pricedEntries > r.totals.pricedEntries) {
    assert.ok(est.buckets.some(b => b.estimated), 'family-priced buckets must be flagged estimated')
  }
})
