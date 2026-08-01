import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRules, MAX_RULES, applyStoredRates } from '../../server/pricing-store.mjs'
import { DEFAULT_PRICE_TABLE, RATE_KEYS, PRICE_PER_M, setPriceTable, getPriceTable } from '../../lib/pricing.mjs'

const rule = (over = {}) => ({
  match: 'claude-opus-5', in: 5, out: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10, ...over,
})

test('the code default table passes its own validator', () => {
  assert.equal(validateRules(DEFAULT_PRICE_TABLE), null)
})

test('a well-formed rule is accepted', () => {
  assert.equal(validateRules([rule()]), null)
  assert.equal(validateRules([rule({ id: 'claude-opus-5-20260101', match: null })]), null)
})

test('a rule must carry exactly one selector', () => {
  assert.match(validateRules([rule({ id: 'x' })]), /exactly one/)
  assert.match(validateRules([rule({ match: null })]), /exactly one/)
})

test('a rate that is not a finite non-negative number is rejected, not coerced', () => {
  for (const bad of ['5', null, undefined, NaN, Infinity, -1, {}]) {
    assert.ok(validateRules([rule({ in: bad })]), `in: ${String(bad)} should be rejected`)
  }
  for (const k of RATE_KEYS) {
    assert.match(validateRules([rule({ [k]: 'free' })]), new RegExp(k))
  }
})

test('a zero rate is allowed', () => {
  assert.equal(validateRules([rule({ cacheRead: 0 })]), null)
})

test('intro rates require a well-formed cutoff date', () => {
  const intro = { in: 2, out: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 }
  assert.equal(validateRules([rule({ intro_until: '2026-08-31', intro })]), null)
  assert.match(validateRules([rule({ intro })]), /intro_until/)
  assert.match(validateRules([rule({ intro_until: '31-08-2026', intro })]), /intro_until/)
  assert.match(validateRules([rule({ intro_until: 'soon', intro })]), /intro_until/)
  assert.match(validateRules([rule({ intro_until: '2026-08-31' })]), /intro/)
})

test('an incomplete intro rate set is rejected', () => {
  assert.match(
    validateRules([rule({ intro_until: '2026-08-31', intro: { in: 2 } })]),
    /intro\.(out|cacheRead|cacheWrite5m|cacheWrite1h)/,
  )
})

test('structural garbage is rejected rather than thrown on', () => {
  for (const bad of [null, undefined, 'rules', 42, {}]) {
    assert.match(validateRules(bad), /must be an array/)
  }
  for (const bad of [null, 'rule', 42, []]) {
    assert.match(validateRules([bad]), /must be an object/)
  }
})

test('the rule count is bounded, and the bound is a named constant', () => {
  assert.equal(typeof MAX_RULES, 'number')
  assert.equal(validateRules(Array.from({ length: MAX_RULES }, () => rule())), null)
  assert.match(validateRules(Array.from({ length: MAX_RULES + 1 }, () => rule())), /at most/)
})

test('a selector must be a non-empty string within the length bound', () => {
  assert.match(validateRules([rule({ match: '' })]), /non-empty/)
  assert.match(validateRules([rule({ match: '   ' })]), /non-empty/)
  assert.match(validateRules([rule({ match: 'x'.repeat(1000) })]), /at most/)
})

test('applyStoredRates installs a stored table and reports which one is live', () => {
  try {
    const custom = [rule({ match: 'claude-opus-5', in: 42 })]
    assert.equal(applyStoredRates(() => ({ pricing: { rules: custom } })), 'stored')
    assert.equal(PRICE_PER_M('claude-opus-5'), 42)

    assert.equal(applyStoredRates(() => ({})), 'default')
    assert.equal(getPriceTable(), DEFAULT_PRICE_TABLE)
    assert.equal(PRICE_PER_M('claude-opus-5'), 5)
  } finally {
    setPriceTable(null)
  }
})

test('a stored table that fails validation is ignored in favour of the defaults', () => {
  try {
    const broken = { pricing: { rules: [rule({ in: 'free' })] } }
    assert.equal(applyStoredRates(() => broken), 'default')
    assert.equal(PRICE_PER_M('claude-opus-5'), 5)
  } finally {
    setPriceTable(null)
  }
})
