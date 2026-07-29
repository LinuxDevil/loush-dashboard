import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DIMENSIONS,
  DIMENSION_COUNT,
  TIERS,
  TIER_RANK,
  TIER_ANCHOR,
  BOUNDARIES,
  CONFIDENCE,
  MOMENTUM_WEIGHT,
  MAX_SCAN_CHARS,
  WEIGHT_BUDGET,
  tierFor,
  boundaryDistance,
  computeConfidence,
  maxTier,
  scoreTurn,
  classifyConversation,
  tierDistribution,
} from '../../lib/complexity.mjs'

// A courtesy turn: down-signal only, no complexity vocabulary.
const COURTESY = 'thanks, that worked'

// An ordinary work turn: one mid-weight signal, short.
const ORDINARY = 'Please add a unit test for the parseMode function.'

// A turn that saturates many independent signals at once.
const HEAVY = [
  "Prove that the scheduler's retry cap is an invariant. Step by step:",
  '1. Analyze the algorithm',
  '   - evaluate the concurrency model',
  '     - consider each mutex',
  '2. If the cap is exceeded, therefore the run must be BLOCKED; otherwise continue.',
  'Compare and contrast with the distributed protocol. For each phase, implement a unit test,',
  'refactor the module, and respond with json.',
  'Must never exceed 3 retries. Should always ensure idempotent behaviour. Do not skip any edge case.',
  'What are the implications? How would you prove it? To what extent is this sufficient? Why might it fail?',
  '```js',
  'const x = 1',
  '```',
].join('\n')

const dim = (result, name) => result.dimensions.find(d => d.name === name)

// ── shape of the dimension table ────────────────────────────────────────────────────────

test('the table is the advertised 32 dimensions: 22 keyword + 10 structural', () => {
  // The research describes manifest's scorer as "22 keyword dimensions + 10 structural
  // dimensions". If either count drifts, the port has stopped matching its own documentation.
  assert.equal(DIMENSION_COUNT, 32)
  assert.equal(DIMENSIONS.filter(d => d.kind === 'keyword').length, 22)
  assert.equal(DIMENSIONS.filter(d => d.kind === 'structural').length, 10)
})

test('every dimension is individually inspectable', () => {
  // The point of this module is that a user can see WHY a turn scored as it did, so each
  // dimension has to carry its own identity, weight and direction — not just fold into a sum.
  const names = new Set()
  for (const d of DIMENSIONS) {
    assert.equal(typeof d.name, 'string')
    assert.ok(d.name.length > 0)
    assert.ok(!names.has(d.name), `duplicate dimension name ${d.name}`)
    names.add(d.name)
    assert.ok(['keyword', 'structural'].includes(d.kind))
    assert.ok(['up', 'down'].includes(d.direction))
    assert.ok(Number.isFinite(d.weight) && d.weight >= 0, `${d.name} weight`)
    assert.equal(typeof d.extract, 'function')
    assert.equal(typeof d.test, 'function')
  }
})

test('the weighted keyword dimensions carry the weights the research reproduced', () => {
  // These come from manifest's scoring/config.ts as transcribed in RESEARCH_MERGED.md. They
  // are the only numbers in the module with a documented origin; everything else is a guess,
  // so a drift here is a real regression rather than a tuning choice.
  const expected = {
    simpleIndicators: 0.08, formalLogic: 0.07, technicalTerms: 0.07, multiStep: 0.07,
    analyticalReasoning: 0.06, codeGeneration: 0.06, codeReview: 0.05, domainSpecificity: 0.05,
    creative: 0.03, questionComplexity: 0.03, agenticTasks: 0.03, imperativeVerbs: 0.02,
    outputFormat: 0.02, relay: 0.02,
  }
  for (const [name, weight] of Object.entries(expected)) {
    assert.equal(DIMENSIONS.find(d => d.name === name)?.weight, weight, name)
  }
  // Only these two argue a turn is cheaper.
  assert.deepEqual(DIMENSIONS.filter(d => d.direction === 'down').map(d => d.name), ['simpleIndicators', 'relay'])
})

test('the eight specificity dimensions are scored but contribute nothing', () => {
  // Upstream uses them for an independent task-category axis. They must still report hits —
  // that is what makes the category axis buildable later — while moving the score by exactly 0.
  const zero = ['webBrowsing', 'dataAnalysis', 'imageGeneration', 'videoGeneration',
    'socialMedia', 'emailManagement', 'calendarManagement', 'trading']
  for (const name of zero) assert.equal(DIMENSIONS.find(d => d.name === name)?.weight, 0, name)

  const r = scoreTurn('Search the web for the ETF ticker and put it on my calendar')
  assert.equal(dim(r, 'webBrowsing').hit, true)
  assert.equal(dim(r, 'trading').hit, true)
  assert.equal(dim(r, 'calendarManagement').hit, true)
  for (const name of zero) assert.equal(dim(r, name).contribution, 0, name)
})

// ── "unknown is a value" ────────────────────────────────────────────────────────────────

test('empty input is tier null with confidence 0 — never a default of simple', () => {
  // The regression this guards: defaulting to `simple` makes the headline claim
  // ("you paid Opus rates for N simple turns") count every blank turn as overspend.
  for (const input of ['', '   ', '\n\t ']) {
    const r = scoreTurn(input)
    assert.equal(r.tier, null)
    assert.equal(r.confidence, 0)
    assert.equal(r.score, null)
    assert.equal(r.reason, 'empty-input')
  }
})

test('non-string and too-short input are unscoreable, each with a stated reason', () => {
  assert.equal(scoreTurn(null).reason, 'empty-input')
  assert.equal(scoreTurn(undefined).reason, 'empty-input')
  assert.equal(scoreTurn(42).reason, 'non-string-input')
  assert.equal(scoreTurn({}).reason, 'non-string-input')
  assert.equal(scoreTurn('?').reason, 'too-short-to-score')
  assert.equal(scoreTurn('k').reason, 'too-short-to-score')
  for (const input of [null, 42, '?']) assert.equal(scoreTurn(input).tier, null)
})

test('an unscoreable result still lists every dimension, so the UI never special-cases it', () => {
  const r = scoreTurn('')
  assert.equal(r.dimensions.length, DIMENSION_COUNT)
  assert.ok(r.dimensions.every(d => d.hit === false && d.contribution === 0))
  assert.deepEqual(r.hits, [])
})

// ── scoring ─────────────────────────────────────────────────────────────────────────────

test('a result is never a bare number: every dimension appears with its contribution', () => {
  const r = scoreTurn(ORDINARY)
  assert.equal(r.dimensions.length, DIMENSION_COUNT)
  assert.deepEqual(r.dimensions.map(d => d.name), DIMENSIONS.map(d => d.name))
  for (const d of r.dimensions) {
    assert.ok(d.activation >= 0 && d.activation <= 1, `${d.name} activation in range`)
    assert.equal(d.hit, d.activation > 0)
  }
  assert.deepEqual(r.hits, r.dimensions.filter(d => d.hit).map(d => d.name))
})

test('the raw score is exactly the sum of the reported contributions', () => {
  // If the two ever diverge, the per-dimension breakdown is decoration rather than evidence.
  const r = scoreTurn(HEAVY, { tools: ['Read', 'Bash'], depth: 4 })
  const sum = r.dimensions.reduce((a, d) => a + d.contribution, 0)
  assert.ok(Math.abs(sum - r.rawScore) < 1e-12, `${sum} ≈ ${r.rawScore}`)
  assert.ok(Math.abs(r.signals.up + r.signals.down - r.rawScore) < 1e-12)
  assert.ok(r.signals.up > 0 && r.signals.down <= 0)
})

test('each contribution is activation x weight, negated for down-direction dimensions', () => {
  const r = scoreTurn(COURTESY)
  for (const d of r.dimensions) {
    const spec = DIMENSIONS.find(s => s.name === d.name)
    const expected = d.activation * spec.weight * (spec.direction === 'down' ? -1 : 1)
    assert.ok(Math.abs(d.contribution - expected) < 1e-12, d.name)
  }
  assert.ok(dim(r, 'simpleIndicators').contribution < 0, 'courtesy vocabulary pushes the score down')
})

test('tiers separate as intended across a courtesy / ordinary / heavy turn', () => {
  const courtesy = scoreTurn(COURTESY)
  const ordinary = scoreTurn(ORDINARY)
  const heavy = scoreTurn(HEAVY)
  assert.equal(courtesy.tier, 'simple')
  assert.equal(ordinary.tier, 'standard')
  assert.equal(heavy.tier, 'reasoning')
  // Ordering is the property that must hold even after the weights are recalibrated.
  assert.ok(courtesy.score < ordinary.score)
  assert.ok(ordinary.score < heavy.score)
})

test('a mid-weight analytical turn lands in complex, between the two extremes', () => {
  const r = scoreTurn(
    'Analyze the trade-offs between our caching layer and a distributed cache. Consider latency, ' +
    'throughput, and the race condition from last week. Compare three approaches step by step and justify one.',
  )
  assert.equal(r.tier, 'complex')
  assert.equal(dim(r, 'analyticalReasoning').hit, true)
  assert.equal(dim(r, 'technicalTerms').hit, true)
})

test('tierFor treats each boundary as the inclusive top of its band', () => {
  assert.equal(tierFor(BOUNDARIES.simpleMax), 'simple')
  assert.equal(tierFor(BOUNDARIES.simpleMax + 1e-9), 'standard')
  assert.equal(tierFor(BOUNDARIES.standardMax), 'standard')
  assert.equal(tierFor(BOUNDARIES.standardMax + 1e-9), 'complex')
  assert.equal(tierFor(BOUNDARIES.complexMax), 'complex')
  assert.equal(tierFor(BOUNDARIES.complexMax + 1e-9), 'reasoning')
  assert.equal(tierFor(-WEIGHT_BUDGET.down), 'simple')
  assert.equal(tierFor(WEIGHT_BUDGET.up), 'reasoning')
  // Unknown stays unknown rather than collapsing to a tier.
  for (const bad of [null, undefined, NaN, Infinity, 'x']) assert.equal(tierFor(bad), null)
})

test('every tier anchor lands inside the tier it anchors', () => {
  // Momentum blends an anchor back in; an anchor outside its own band would make momentum
  // pull toward the wrong tier.
  for (const t of TIERS) assert.equal(tierFor(TIER_ANCHOR[t]), t)
})

// ── keyword matching ────────────────────────────────────────────────────────────────────

test('keywords match whole words, so "note" is not the courtesy word "no"', () => {
  // Substring matching here would drag long technical turns down a tier on incidental letters.
  const prose = scoreTurn('Take note of the compiler behaviour and the nokia driver')
  assert.equal(dim(prose, 'simpleIndicators').hit, false)
  assert.equal(dim(scoreTurn('no, revert that'), 'simpleIndicators').hit, true)
  // Same trap on the other side: "okay-ish" is not the courtesy word "okay".
  assert.equal(dim(scoreTurn('the latency is okay-ish for a distributed protocol'), 'simpleIndicators').hit, false)
})

test('one courtesy word saturates its dimension; one technical word does not', () => {
  // Deliberate asymmetry. Evidence of complexity accumulates — three unrelated technical terms
  // really are a stronger signal than one — but evidence of triviality does not: a turn whose
  // whole content is "sure" is already as simple as a turn gets. Sharing the saturation of 3
  // left a one-word acknowledgement at 1/3 activation, where the conversation-depth dimension
  // alone could tip it out of `simple`.
  for (const d of DIMENSIONS.filter(d => d.kind === 'keyword')) {
    assert.equal(d.saturation, d.direction === 'down' ? 1 : 3, d.name)
  }
  // Not exactly 1: the short-turn scaling below is still applied on top, and even a one-word
  // turn is a token long. Near-saturation from a single hit is the property that matters.
  assert.ok(dim(scoreTurn('sure'), 'simpleIndicators').activation > 0.95)
  assert.ok(dim(scoreTurn('the algorithm'), 'technicalTerms').activation < 0.5)

  // The case that motivated it: bare acknowledgements stay simple however late they appear.
  const results = classifyConversation(['ok', 'thanks', 'yes', 'sure', 'sounds good'])
  assert.deepEqual(results.map(r => r.tier), Array(5).fill('simple'))
})

test('courtesy words fade out as the turn gets longer', () => {
  // "thanks" as the whole turn is the entire signal; "thanks" inside a 900-word spec is
  // punctuation. Without this scaling a long, genuinely complex turn could be pulled down.
  const short = scoreTurn('thanks')
  const buried = scoreTurn('thanks. ' + 'Refactor the distributed protocol module carefully. '.repeat(30))
  assert.ok(dim(short, 'simpleIndicators').activation > 0)
  assert.ok(dim(buried, 'simpleIndicators').activation < dim(short, 'simpleIndicators').activation)
  assert.equal(dim(buried, 'simpleIndicators').activation, 0)
})

// ── structural dimensions ───────────────────────────────────────────────────────────────

test('tool count comes from the caller, not from guessing tool names out of prose', () => {
  const none = scoreTurn(ORDINARY)
  const some = scoreTurn(ORDINARY, { tools: ['Read', 'Edit', 'Bash'] })
  assert.equal(dim(none, 'toolCount').activation, 0)
  assert.ok(dim(some, 'toolCount').activation > 0)
  assert.ok(some.score > none.score)
})

test('nested list depth reads indentation, and a flat list scores 0', () => {
  const flat = scoreTurn('Do these:\n- alpha\n- beta\n- gamma')
  const nested = scoreTurn('Do these:\n- alpha\n  - beta\n    - gamma\n      - delta')
  assert.equal(dim(flat, 'nestedListDepth').activation, 0, 'depth 1 is not nesting')
  assert.equal(dim(nested, 'nestedListDepth').activation, 1)
})

test('question count and conditional logic register independently', () => {
  const q = scoreTurn('Which one? Why that one? When does it break? What else?')
  assert.equal(dim(q, 'questionCount').activation, 1)
  const c = scoreTurn('If it fails, retry; unless the cap is hit, otherwise stop, depending on the phase.')
  assert.ok(dim(c, 'conditionalLogic').activation > 0)
})

test('conversation depth is a dimension, so a late turn outscores the same text at turn 0', () => {
  const first = scoreTurn(ORDINARY, { depth: 0 })
  const later = scoreTurn(ORDINARY, { depth: 10 })
  assert.equal(dim(first, 'conversationDepth').activation, 0)
  assert.equal(dim(later, 'conversationDepth').activation, 1)
  assert.ok(later.rawScore > first.rawScore)
})

test('fenced code raises the code-to-prose fraction', () => {
  const prose = scoreTurn('Here is the plan we discussed for the module rewrite.')
  const code = scoreTurn('Fix this:\n```js\nconst x = 1\nconst y = 2\nreturn x + y\n```')
  assert.equal(dim(prose, 'codeToProse').activation, 0)
  assert.ok(dim(code, 'codeToProse').activation > 0.5)
})

// ── no silent caps ──────────────────────────────────────────────────────────────────────

test('truncation is reported, and the token estimate still measures the full text', () => {
  // "No silent caps": if we only looked at part of the input, the result has to say so.
  const long = 'algorithm and latency '.repeat(3000)
  assert.ok(long.length > MAX_SCAN_CHARS)
  const r = scoreTurn(long)
  assert.equal(r.truncated.applied, true)
  assert.equal(r.truncated.originalChars, long.trim().length)
  assert.equal(r.truncated.scannedChars, MAX_SCAN_CHARS)
  assert.match(r.truncated.note, /limited to the first/)
  // Length is cheap to measure exactly, so truncating the scan must not truncate the length.
  assert.equal(dim(r, 'tokenCount').activation, 1)
})

test('an untruncated turn says so explicitly rather than omitting the field', () => {
  const r = scoreTurn(ORDINARY)
  assert.equal(r.truncated.applied, false)
  assert.equal(r.truncated.originalChars, ORDINARY.length)
  assert.equal(r.truncated.scannedChars, ORDINARY.length)
})

// ── confidence ──────────────────────────────────────────────────────────────────────────

test('confidence measures distance from the nearest tier boundary', () => {
  assert.equal(boundaryDistance(BOUNDARIES.standardMax), 0)
  assert.ok(boundaryDistance(WEIGHT_BUDGET.up) > boundaryDistance(BOUNDARIES.complexMax + 0.01))
  // Sitting exactly on a boundary is the least confident a scoreable turn can be.
  const onEdge = computeConfidence(BOUNDARIES.standardMax)
  assert.ok(onEdge < computeConfidence(BOUNDARIES.standardMax + 0.05))
  assert.ok(computeConfidence(1) > 0.99)
  assert.equal(computeConfidence(null), 0)
  // The midpoint is the half-confidence point by construction.
  assert.ok(Math.abs(computeConfidence(BOUNDARIES.standardMax + CONFIDENCE.midpoint) - 0.5) < 1e-9)
})

test('the confident flag is the threshold applied, not a separate opinion', () => {
  const heavy = scoreTurn(HEAVY)
  assert.equal(heavy.confident, heavy.confidence >= CONFIDENCE.threshold)
  assert.equal(heavy.confident, true, 'a turn saturating many signals is far from any boundary')
  const borderline = scoreTurn('What is the capital of France?')
  assert.equal(borderline.confident, borderline.confidence >= CONFIDENCE.threshold)
})

// ── momentum ────────────────────────────────────────────────────────────────────────────

test('momentum stops a conversation flapping back to simple on one short turn', () => {
  // The behaviour being bought: "ok" in the middle of a complex debugging session is a
  // continuation of complex work, not a new cheap request.
  const [, ok] = classifyConversation([HEAVY, 'ok'])
  assert.equal(ok.momentum.tierBeforeMomentum, 'simple', 'on its own the turn reads as simple')
  assert.equal(ok.momentum.applied, true)
  assert.equal(ok.momentum.previousTier, 'reasoning')
  assert.equal(ok.momentum.changedTier, true)
  assert.notEqual(ok.tier, 'simple')
  assert.ok(ok.score > ok.rawScore, 'the prior tier pulled the score up')
})

test('momentum is a tie-breaker: it never moves a turn more than one tier', () => {
  const results = classifyConversation([HEAVY, 'ok', 'ok', 'ok', 'ok'])
  for (const r of results) {
    const before = TIER_RANK[r.momentum.tierBeforeMomentum]
    assert.ok(Math.abs(TIER_RANK[r.tier] - before) <= 1, `turn ${r.index} moved more than one tier`)
  }
})

test('momentum never invents a tier that neither the text nor the prior turn supports', () => {
  // The strong form of the tie-breaker property: the result always sits between what this
  // turn's own text says and what the previous turn said. Momentum interpolates, never
  // extrapolates — so it cannot manufacture a `reasoning` turn out of two `standard` ones.
  const results = classifyConversation([HEAVY, 'ok', 'ok', ORDINARY, 'ok'])
  for (const r of results.slice(1)) {
    const ends = [TIER_RANK[r.momentum.tierBeforeMomentum], TIER_RANK[r.momentum.previousTier]]
    assert.ok(TIER_RANK[r.tier] >= Math.min(...ends), `turn ${r.index} below both ends`)
    assert.ok(TIER_RANK[r.tier] <= Math.max(...ends), `turn ${r.index} above both ends`)
  }
  // The pull also shrinks once the carried tier stops disagreeing with the text.
  assert.ok(results[2].momentum.weight < results[1].momentum.weight)
})

test('momentum does not manufacture complexity in a conversation that has none', () => {
  const results = classifyConversation(['ok', 'thanks', 'yes', 'sure', 'sounds good'])
  assert.deepEqual(results.map(r => r.tier), Array(5).fill('simple'))
})

test('momentum is scaled by the previous turn confidence and can be switched off', () => {
  const strong = scoreTurn('ok', { previous: { tier: 'reasoning', confidence: 1 } })
  const weak = scoreTurn('ok', { previous: { tier: 'reasoning', confidence: 0.1 } })
  const off = scoreTurn('ok', { previous: { tier: 'reasoning', confidence: 1 }, momentum: 0 })
  assert.equal(strong.momentum.weight, MOMENTUM_WEIGHT)
  assert.ok(weak.momentum.weight < strong.momentum.weight, 'an uncertain prior steers less')
  assert.ok(strong.score > weak.score)
  assert.equal(off.momentum.applied, false)
  assert.equal(off.score, off.rawScore)
  assert.equal(off.tier, off.momentum.tierBeforeMomentum)
})

test('a garbage previous tier is ignored rather than trusted', () => {
  const r = scoreTurn(ORDINARY, { previous: { tier: 'expensive', confidence: 1 } })
  assert.equal(r.momentum.applied, false)
  assert.equal(r.momentum.previousTier, null)
  assert.equal(r.score, r.rawScore)
})

test('the first turn of a conversation has no momentum to carry', () => {
  const [first] = classifyConversation([HEAVY, ORDINARY])
  assert.equal(first.momentum.applied, false)
  assert.equal(first.momentum.previousTier, null)
  assert.equal(first.score, first.rawScore)
})

// ── classifyConversation ────────────────────────────────────────────────────────────────

test('classifyConversation returns one indexed result per turn and accepts objects or strings', () => {
  const results = classifyConversation([
    HEAVY,
    { text: ORDINARY, tools: ['Read', 'Bash', 'Edit'] },
    { content: COURTESY },
  ])
  assert.equal(results.length, 3)
  assert.deepEqual(results.map(r => r.index), [0, 1, 2])
  assert.ok(results.every(r => r.dimensions.length === DIMENSION_COUNT))
  assert.ok(dim(results[1], 'toolCount').activation > 0, 'per-turn tools are read off the object')
  assert.equal(dim(results[2], 'conversationDepth').activation, 0.2, 'depth defaults to the turn index')
})

test('a non-array conversation yields no results rather than throwing', () => {
  assert.deepEqual(classifyConversation(null), [])
  assert.deepEqual(classifyConversation(undefined), [])
  assert.deepEqual(classifyConversation('not turns'), [])
})

test('an unscoreable turn mid-conversation does not reset the momentum anchor', () => {
  // Dropping the anchor on a blank turn would reintroduce exactly the flapping momentum exists
  // to damp, and a blank turn carries no evidence in either direction.
  const results = classifyConversation([HEAVY, '', 'ok'])
  assert.equal(results[1].tier, null)
  assert.equal(results[1].momentum.applied, false)
  assert.equal(results[2].momentum.previousTier, 'reasoning', 'the blank turn was skipped, not honoured')
})

// ── aggregation helpers ─────────────────────────────────────────────────────────────────

test('maxTier merges two tiers by the documented ordering', () => {
  assert.deepEqual(TIERS, ['simple', 'standard', 'complex', 'reasoning'])
  assert.equal(maxTier('simple', 'complex'), 'complex')
  assert.equal(maxTier('reasoning', 'complex'), 'reasoning')
  assert.equal(maxTier('standard', 'standard'), 'standard')
  assert.equal(maxTier(null, 'standard'), 'standard')
  assert.equal(maxTier('standard', null), 'standard')
  assert.equal(maxTier(null, null), null)
})

test('the tier distribution counts unknown turns separately from simple ones', () => {
  // This is the number the headline cost claim is made from, so an unscoreable turn must not
  // quietly inflate it.
  const results = classifyConversation([COURTESY, '', HEAVY, null, ORDINARY])
  const d = tierDistribution(results)
  assert.equal(d.total, 5)
  assert.equal(d.unknown, 2)
  assert.equal(d.counts.simple, 1)
  assert.equal(d.counts.reasoning, 1)
  assert.equal(d.counts.simple + d.counts.standard + d.counts.complex + d.counts.reasoning + d.unknown, d.total)
  assert.ok(d.lowConfidence <= d.total - d.unknown)
  assert.deepEqual(tierDistribution(null), { counts: { simple: 0, standard: 0, complex: 0, reasoning: 0 }, unknown: 0, lowConfidence: 0, total: 0 })
})
