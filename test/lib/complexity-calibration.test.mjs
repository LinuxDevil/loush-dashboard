import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreTurn, BOUNDARIES, CONFIDENCE } from '../../lib/complexity.mjs'
import { LABELLED_PROMPTS, TIER_RANK_ORDER } from '../fixtures/complexity-labelled.mjs'

const rank = t => TIER_RANK_ORDER.indexOf(t)

test('every labelled prompt lands in its labelled tier', () => {
  const misses = []
  for (const [want, text] of LABELLED_PROMPTS) {
    const got = scoreTurn(text).tier
    if (got !== want) misses.push(`${want} -> ${got}: ${text.slice(0, 60)}`)
  }
  assert.deepEqual(misses, [], `${misses.length}/${LABELLED_PROMPTS.length} prompts changed tier`)
})

test('the labelled tiers occupy separated score bands', () => {
  const bands = {}
  for (const [want, text] of LABELLED_PROMPTS) {
    const s = scoreTurn(text).rawScore
    const b = (bands[want] ||= { min: Infinity, max: -Infinity })
    b.min = Math.min(b.min, s); b.max = Math.max(b.max, s)
  }
  for (let i = 0; i < TIER_RANK_ORDER.length - 1; i++) {
    const lo = bands[TIER_RANK_ORDER[i]], hi = bands[TIER_RANK_ORDER[i + 1]]
    if (!lo || !hi) continue
    assert.ok(lo.max < hi.min, `${TIER_RANK_ORDER[i]} (max ${lo.max.toFixed(4)}) must not overlap ${TIER_RANK_ORDER[i + 1]} (min ${hi.min.toFixed(4)})`)
  }
})

test('each boundary sits inside the gap it divides, not flush against a band', () => {
  const bands = {}
  for (const [want, text] of LABELLED_PROMPTS) {
    const s = scoreTurn(text).rawScore
    const b = (bands[want] ||= { min: Infinity, max: -Infinity })
    b.min = Math.min(b.min, s); b.max = Math.max(b.max, s)
  }
  const edges = [['simpleMax', 'simple', 'standard'], ['standardMax', 'standard', 'complex'], ['complexMax', 'complex', 'reasoning']]
  for (const [key, lower, upper] of edges) {
    assert.ok(BOUNDARIES[key] > bands[lower].max, `${key} must sit above the top of ${lower}`)
    assert.ok(BOUNDARIES[key] < bands[upper].min, `${key} must sit below the bottom of ${upper}`)
  }
})

test('an unambiguous turn is confident and a borderline one is not', () => {
  const clear = scoreTurn('ok')
  assert.ok(clear.confidence > 0.9, `a bare acknowledgment should be unambiguous, got ${clear.confidence}`)
  const borderline = scoreTurn('run the tests')
  assert.ok(borderline.confidence < CONFIDENCE.threshold, `a prompt near a tier edge should report low confidence, got ${borderline.confidence}`)
})

test('tier ordering is monotonic in score', () => {
  const scored = LABELLED_PROMPTS.map(([want, text]) => ({ want, score: scoreTurn(text).rawScore }))
  scored.sort((a, b) => a.score - b.score)
  for (let i = 1; i < scored.length; i++)
    assert.ok(rank(scored[i].want) >= rank(scored[i - 1].want), `sorting by score must not put ${scored[i].want} below ${scored[i - 1].want}`)
})
