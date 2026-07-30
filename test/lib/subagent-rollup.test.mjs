import test from 'node:test'
import assert from 'node:assert/strict'
import { rollupSubagents, electDominantModel, modelDelegationSavings, activeSubagents, totalTokens } from '../../lib/subagent-rollup.mjs'
import { entryCost } from '../../lib/pricing.mjs'

const OPUS = 'claude-opus-5'      // in 5 / out 25 per M
const HAIKU = 'claude-haiku-4-5'  // in 1 / out 5 per M
const turn = (model, agent, { i = 1000, o = 1000, cr = 0, cc = 0, t = null, tool = null } = {}) =>
  ({ model, agent, in: i, out: o, cr, cc, t, tool })

// ---- dominant model ----

test('the dominant model is the one with the most tokens, and its share is reported', () => {
  const d = electDominantModel([
    { model: OPUS, in: 9000, out: 0, cr: 0, cc: 0 },
    { model: HAIKU, in: 1000, out: 0, cr: 0, cc: 0 },
  ].map(e => ({ ...e })))
  assert.equal(d.model, OPUS)
  assert.equal(d.share, 0.9)
  assert.equal(d.reason, 'mixed-model')
})

test('a single-model run is not flagged as mixed', () => {
  const d = electDominantModel([{ model: OPUS, in: 10, out: 0, cr: 0, cc: 0 }])
  assert.equal(d.reason, null)
  assert.equal(d.share, 1)
})

test('with no model on any turn there is no dominant model and no share', () => {
  const d = electDominantModel([{ model: null, in: 10, out: 0, cr: 0, cc: 0 }])
  assert.equal(d.model, null)
  assert.equal(d.share, null, '0/0 is not 0%')
  assert.equal(d.reason, 'no-model-on-any-turn')
})

test('a barely-dominant model still reports its low share, so the label can be distrusted', () => {
  const d = electDominantModel([
    { model: OPUS, in: 34, out: 0, cr: 0, cc: 0 },
    { model: HAIKU, in: 33, out: 0, cr: 0, cc: 0 },
    { model: 'claude-sonnet-5', in: 33, out: 0, cr: 0, cc: 0 },
  ])
  assert.ok(d.share < 0.4, 'a 34% label describes a third of the run')
  assert.equal(d.models.length, 3)
})

// ---- rollup ----

test('subagents are separated from the main thread', () => {
  const r = rollupSubagents([turn(OPUS, null), turn(OPUS, 'a1'), turn(OPUS, 'a1'), turn(OPUS, 'a2')])
  assert.equal(r.subagents.length, 2)
  assert.equal(r.totals.agents, 2)
  assert.equal(r.agents.find(a => a.isMain).turns, 1)
})

test('cost is summed per turn at each turn OWN rate, never at the dominant model rate', () => {
  // 9 opus turns and 1 haiku turn: opus dominates, but the haiku turn must be priced as haiku.
  const rows = [...Array(9)].map(() => turn(OPUS, 'a1')).concat([turn(HAIKU, 'a1')])
  const r = rollupSubagents(rows)
  const a = r.subagents[0]
  const expected = rows.reduce((n, e) => n + entryCost({ ...e, t: null }), 0)
  assert.ok(Math.abs(a.cost - expected) < 1e-12, 'per-turn pricing')
  const atDominant = rows.length * entryCost({ ...turn(OPUS, 'a1'), t: null })
  assert.ok(Math.abs(a.cost - atDominant) > 1e-9, 'pricing everything at opus would overstate this run')
  assert.equal(a.dominantModel, OPUS)
  assert.equal(a.mixedModel, true)
})

test('unpriced turns are counted, not silently treated as free', () => {
  const r = rollupSubagents([turn(OPUS, 'a1'), turn('some-unknown-model', 'a1')])
  const a = r.subagents[0]
  assert.equal(a.unpricedTurns, 1)
  assert.equal(a.costComplete, false)
  assert.ok(a.unpricedTokens > 0)
  assert.match(r.note, /missing from these totals, not zero/)
})

test('an entirely unpriced subagent has a null cost, because unpriced is not free', () => {
  const r = rollupSubagents([turn('mystery-model', 'a1')])
  assert.equal(r.subagents[0].cost, null)
  assert.equal(r.totals.cost, null)
})

test('token components are totalled separately', () => {
  const r = rollupSubagents([turn(OPUS, 'a1', { i: 10, o: 20, cr: 30, cc: 40 })])
  const a = r.subagents[0]
  assert.deepEqual([a.in, a.out, a.cacheRead, a.cacheWrite], [10, 20, 30, 40])
  assert.equal(a.tokens, 100)
})

test('agents are ranked by cost, priced ones ahead of unpriceable ones', () => {
  const r = rollupSubagents([
    turn(HAIKU, 'cheap'), turn(OPUS, 'dear'), turn('mystery', 'unknown'),
  ])
  assert.deepEqual(r.subagents.map(a => a.agent), ['dear', 'cheap', 'unknown'])
})

test('junk input yields an empty rollup rather than a crash', () => {
  for (const junk of [null, undefined, 'nope', 42, [null, 'x', {}]]) {
    assert.doesNotThrow(() => rollupSubagents(junk), JSON.stringify(junk))
  }
  assert.equal(rollupSubagents(null).subagents.length, 0)
})

// ---- delegation savings ----

test('re-pricing on a cheaper model is labelled as modelled, with the assumption stated', () => {
  const s = modelDelegationSavings([turn(OPUS, 'a1', { i: 1e6, o: 1e6 })], HAIKU)
  assert.equal(s.modelled, true, 'this is the number most likely to be quoted as if it were observed')
  assert.match(s.assumption, /nobody ran it/)
  assert.equal(s.comparableTurns, 1)
})

test('the arithmetic is right against the real price table', () => {
  // 1M in + 1M out on opus = 5 + 25 = $30; on haiku = 1 + 5 = $6.
  const s = modelDelegationSavings([turn(OPUS, 'a1', { i: 1e6, o: 1e6 })], HAIKU)
  assert.ok(Math.abs(s.actualCost - 30) < 1e-9, `actual ${s.actualCost}`)
  assert.ok(Math.abs(s.modelledCost - 6) < 1e-9, `modelled ${s.modelledCost}`)
  assert.ok(Math.abs(s.modelledSaving - 24) < 1e-9)
  assert.ok(Math.abs(s.modelledSavingPct - 80) < 1e-9)
})

test('turns already on the candidate model are excluded, not counted as zero saving', () => {
  const s = modelDelegationSavings([turn(HAIKU, 'a1'), turn(OPUS, 'a1')], HAIKU)
  assert.equal(s.alreadyOnCandidate, 1)
  assert.equal(s.comparableTurns, 1)
})

test('an unpriceable turn is excluded from both sides rather than inventing money', () => {
  const s = modelDelegationSavings([turn('mystery', 'a1'), turn(OPUS, 'a1')], HAIKU)
  assert.equal(s.skippedUnpriced, 1)
  assert.equal(s.comparableTurns, 1)
  assert.match(s.caveat, /excluded from both sides/)
})

test('an unpriceable candidate is refused rather than compared against nothing', () => {
  const s = modelDelegationSavings([turn(OPUS, 'a1')], 'not-a-real-model')
  assert.equal(s.ok, false)
  assert.equal(s.reason, 'target-model-unpriced')
})

test('nothing comparable means null figures, not a zero saving', () => {
  const s = modelDelegationSavings([turn(HAIKU, 'a1')], HAIKU)
  assert.equal(s.ok, false)
  assert.equal(s.modelledSaving, null)
  assert.equal(s.modelledCost, null)
})

test('a "cheaper" model that would cost more is surfaced, not clamped to zero', () => {
  // Opus cache reads are 0.5/M; fable's are 1/M. Cache-heavy work inverts the headline ordering.
  const s = modelDelegationSavings([turn(OPUS, 'a1', { i: 0, o: 0, cr: 1e6 })], 'claude-fable-5')
  assert.equal(s.wouldCostMore, true)
  assert.ok(s.modelledSaving < 0, 'the honest answer is a negative saving')
})

// ---- live activity ----

test('a subagent with a recent turn is active; an old one is idle', () => {
  const now = Date.parse('2026-01-01T12:00:00Z')
  const a = activeSubagents([
    turn(OPUS, 'fresh', { t: '2026-01-01T11:59:30Z' }),
    turn(OPUS, 'stale', { t: '2026-01-01T11:00:00Z' }),
  ], { now, windowMs: 120_000 })
  assert.deepEqual(a.active.map(x => x.agent), ['fresh'])
  assert.deepEqual(a.idle.map(x => x.agent), ['stale'])
})

test('a subagent with no timestamp is unknown, never assumed idle', () => {
  const a = activeSubagents([turn(OPUS, 'undated', { t: null })])
  assert.equal(a.counts.unknown, 1)
  assert.equal(a.counts.idle, 0)
  assert.match(a.note, /is unknown/)
})

test('the main thread is not a subagent', () => {
  assert.equal(activeSubagents([turn(OPUS, null, { t: new Date().toISOString() })]).counts.active, 0)
})

test('active subagents are ordered most-recent first', () => {
  const now = Date.parse('2026-01-01T12:00:00Z')
  const a = activeSubagents([
    turn(OPUS, 'older', { t: '2026-01-01T11:59:00Z' }),
    turn(OPUS, 'newer', { t: '2026-01-01T11:59:50Z' }),
  ], { now })
  assert.deepEqual(a.active.map(x => x.agent), ['newer', 'older'])
})

test('totalTokens counts every component', () => {
  assert.equal(totalTokens({ in: 1, out: 2, cr: 4, cc: 8 }), 15)
})
