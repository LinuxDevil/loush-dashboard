// Tests for lib/context-reduction.mjs.
//
// The metric under test is a percentage, and a percentage is the easiest number in software to make
// true-but-lying. So every test here pins falsifiability rather than arithmetic:
//   1. A missing side => null WITH A REASON. Never an impressive number from a guessed baseline.
//   2. The numerator and denominator are always reported, and the denominator says what it means.
//   3. Estimated inputs are excluded by default; including them stamps the result 'partly-estimated'.
//   4. Excluded capabilities are counted and listed — coverage travels with the ratio.
//   5. Nothing throws.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeContextReduction, fromCapabilityLedger, formatReduction, EXCLUSION,
} from '../../lib/context-reduction.mjs'

const SNAP = { at: Date.parse('2026-07-30T00:00:00Z'), source: 'test fixture' }
const item = (name, a, f, over = {}) => ({ name, kind: 'skill', alwaysOnTokens: a, fullTokens: f, ...over })
const ok = extra => computeContextReduction({ userId: 'u1', snapshot: SNAP, items: [item('a', 100, 1000), item('b', 50, 500)], ...extra })

describe('a missing side is null with a reason, never a number', () => {
  test('no capabilities at all', () => {
    const r = computeContextReduction({ userId: 'u1', items: [], snapshot: SNAP })
    assert.equal(r.reductionPct, null)
    assert.equal(r.savedTokens, null)
    assert.equal(r.alwaysOnTokens, null)
    assert.equal(r.fullTokens, null)
    assert.equal(r.reason, 'no-capabilities-supplied')
    assert.match(r.because, /no baseline/)
  })

  test('every full-install count missing => null, naming which side failed', () => {
    const r = computeContextReduction({ userId: 'u1', snapshot: SNAP, items: [item('a', 100, null), item('b', 50, undefined)] })
    assert.equal(r.reductionPct, null)
    assert.equal(r.reason, 'no-measured-capabilities')
    assert.match(r.because, /full \(on-invoke\) token count not measured/)
    assert.match(r.because, /guessed baseline/)
    assert.equal(r.itemsExcluded, 2)
    assert.ok(r.excluded.every(e => e.reason === EXCLUSION.FULL_UNMEASURED))
  })

  test('every always-on count missing => null, naming the OTHER side', () => {
    const r = computeContextReduction({ userId: 'u1', snapshot: SNAP, items: [item('a', null, 1000)] })
    assert.equal(r.reductionPct, null)
    assert.ok(r.excluded.every(e => e.reason === EXCLUSION.ALWAYS_ON_UNMEASURED))
  })

  test('NaN / negative / string token counts are "not measured", not coerced', () => {
    for (const bad of [NaN, -5, '1000', Infinity, {}, []]) {
      const r = computeContextReduction({ userId: 'u1', snapshot: SNAP, items: [item('a', 100, bad)] })
      assert.equal(r.reductionPct, null, `fullTokens=${String(bad)} must not produce a percentage`)
    }
  })

  test('a zero denominator is null, not 0% and not 100%', () => {
    const r = computeContextReduction({ userId: 'u1', snapshot: SNAP, items: [item('a', 0, 0, { estimated: false })] })
    assert.equal(r.reductionPct, null)
    assert.equal(r.reason, 'denominator-zero')
    assert.match(r.because, /fabrications/)
    assert.equal(r.fullTokens, 0, 'the operands are still reported so the null can be checked')
  })

  test('formatReduction refuses to print a number when there is none', () => {
    const s = formatReduction(computeContextReduction({ items: [] }))
    assert.match(s, /UNAVAILABLE/)
    assert.doesNotMatch(s, /\d+\.\d%/)
  })
})

describe('the percentage never travels without its operands', () => {
  test('numerator, denominator and both totals are reported', () => {
    const r = ok()
    assert.equal(r.alwaysOnTokens, 150)
    assert.equal(r.fullTokens, 1500)
    assert.equal(r.numerator, 1350)
    assert.equal(r.denominator, 1500)
    assert.equal(r.savedTokens, 1350)
    assert.equal(r.reductionPct, 90)
    assert.equal(r.numerator / r.denominator * 100, r.reductionPct, 'the ratio must be derivable from the reported operands')
  })

  test('the denominator states what it is a percentage OF, and what it is NOT', () => {
    const r = ok()
    assert.ok(r.denominatorMeans.length > 40)
    assert.match(r.denominatorMeans, /NOT the context window/)
    assert.match(r.denominatorMeans, /NOT.*bill/)
    assert.ok(r.numeratorMeans.includes('fullTokens - alwaysOnTokens'))
  })

  test('the claim sentence contains both operands and the item count', () => {
    const r = ok()
    assert.match(r.claim, /1,500/)
    assert.match(r.claim, /150/)
    assert.match(r.claim, /2 measured capabilities/)
    assert.match(r.claim, /for user u1/)
    assert.match(r.claim, /2026-07-30/)
  })

  test('per-item rows let the total be audited line by line, deterministically', () => {
    const r = ok()
    assert.equal(r.perItem.length, 2)
    assert.equal(r.perItem.reduce((s, i) => s + i.saved, 0), r.numerator)
    assert.equal(r.perItem[0].name, 'a', 'sorted by saving, descending')
    const tie = computeContextReduction({ items: [item('z', 0, 10), item('a', 0, 10)], snapshot: SNAP })
    assert.deepEqual(tie.perItem.map(i => i.name), ['a', 'z'], 'ties break by name so output is stable')
  })
})

describe('provenance — an unattributed or undated figure says so', () => {
  test('a per-user figure carries the user id', () => {
    const r = ok()
    assert.equal(r.userId, 'u1')
    assert.equal(r.scope, 'per-user')
    assert.equal(r.scopeNote, null)
  })

  test('without a user id the scope is "unattributed" and warns against personal framing', () => {
    const r = computeContextReduction({ snapshot: SNAP, items: [item('a', 100, 1000)] })
    assert.equal(r.scope, 'unattributed')
    assert.match(r.scopeNote, /must not be presented as any particular person/)
  })

  test('without a snapshot the result says it is not independently checkable', () => {
    const r = computeContextReduction({ userId: 'u1', items: [item('a', 100, 1000)] })
    assert.equal(r.snapshot, null)
    assert.match(r.snapshotNote, /not independently checkable/)
    assert.ok(r.reductionPct != null, 'missing provenance is a caveat, not a nullifier — the measurement itself is intact')
  })

  test('the heuristic token counter is disclosed unless attested exact', () => {
    assert.match(ok().tokenCountingNote, /4-chars-per-token/)
    assert.equal(ok({ tokenCounting: { method: 'tokenizer', exact: true } }).tokenCountingNote, null)
  })
})

describe('estimated inputs are excluded by default', () => {
  const items = [item('measured', 100, 1000), item('guessed', 600, 600, { estimated: true })]

  test('an estimated capability is excluded and the reason names it', () => {
    const r = computeContextReduction({ userId: 'u1', snapshot: SNAP, items })
    assert.equal(r.itemsIncluded, 1)
    assert.equal(r.denominator, 1000, 'the guess must not enter the denominator')
    assert.equal(r.basis, 'measured')
    assert.equal(r.excluded[0].reason, EXCLUSION.ESTIMATED)
  })

  test('opting in stamps the result partly-estimated and says the error is not computable', () => {
    const r = computeContextReduction({ userId: 'u1', snapshot: SNAP, items, includeEstimated: true })
    assert.equal(r.itemsIncluded, 2)
    assert.equal(r.basis, 'partly-estimated')
    assert.match(r.basisNote, /error is not computable/)
    assert.match(formatReduction(r), /partly-estimated/)
  })

  test('an item whose always-on cost exceeds its full cost is excluded as incoherent', () => {
    const r = computeContextReduction({ userId: 'u1', snapshot: SNAP, items: [item('a', 100, 1000), item('bad', 900, 100)] })
    assert.equal(r.itemsIncluded, 1)
    assert.equal(r.excluded[0].reason, EXCLUSION.INCOHERENT)
    assert.equal(r.numerator, 900, 'a data bug must not silently shrink the saving')
  })
})

describe('coverage travels with the ratio', () => {
  test('partial measurement is disclosed as neither an upper nor a lower bound', () => {
    const r = computeContextReduction({ userId: 'u1', snapshot: SNAP, items: [item('a', 100, 1000), item('b', null, null), item('c', null, null)] })
    assert.equal(r.coverage.itemsMeasured, 1)
    assert.equal(r.coverage.itemsSupplied, 3)
    assert.equal(r.coverage.complete, false)
    assert.match(r.coverage.note, /UNKNOWN, not zero/)
    assert.match(r.coverage.note, /neither an upper nor a lower bound/)
    assert.match(r.claim, /2 further capabilities were excluded/)
  })

  test('full coverage says so and adds no caveat', () => {
    const r = ok()
    assert.equal(r.coverage.complete, true)
    assert.equal(r.coverage.note, null)
    assert.equal(r.coverage.itemsMeasuredPct, 1)
  })

  test('formatReduction shows the coverage fraction beside the percentage', () => {
    assert.match(formatReduction(ok()), /2\/2 capabilities measured/)
    assert.match(formatReduction(ok()), /90\.0% = 1,350 \/ 1,500/)
  })
})

describe('the capability-ledger adapter reuses existing repo data', () => {
  test('it maps server/index.mjs capabilityLedger() rows directly', () => {
    const ledger = { items: [{ name: 'x', kind: 'skill', alwaysOnTokens: 80, fullTokens: 4000 }, { name: 'y', kind: 'agent', alwaysOnTokens: 20, fullTokens: 1000 }] }
    const r = fromCapabilityLedger(ledger, { userId: 'u1', snapshot: SNAP })
    assert.equal(r.denominator, 5000)
    assert.equal(r.numerator, 4900)
    assert.equal(r.itemsIncluded, 2)
  })

  test('all-zero rows (plugins pushed with 0/0) are treated as estimated, not as denominator padding', () => {
    const ledger = { items: [{ name: 'x', kind: 'skill', alwaysOnTokens: 80, fullTokens: 4000 }, { name: 'p', kind: 'plugin', alwaysOnTokens: 0, fullTokens: 0 }] }
    const r = fromCapabilityLedger(ledger, { userId: 'u1', snapshot: SNAP })
    assert.equal(r.itemsIncluded, 1)
    assert.equal(r.itemsExcluded, 1)
    assert.equal(r.denominator, 4000)
  })

  test('a missing or malformed ledger yields null with a reason, not zero', () => {
    for (const junk of [null, undefined, {}, { items: 'nope' }, 5, []]) {
      const r = fromCapabilityLedger(junk, { userId: 'u1' })
      assert.equal(r.reductionPct, null)
      assert.equal(r.reason, 'no-capabilities-supplied')
    }
  })
})

describe('nothing throws', () => {
  test('junk arguments are survivable', () => {
    // `null` specifically: a default parameter only fires on `undefined`, so a null returned by a
    // failed upstream read would be destructured and throw. This caught a real bug.
    for (const junk of [undefined, null, 'x', 5, [], {}, { items: null }, { items: 'x' }, { items: [null, 3, 'a', []] }, { items: [{}], userId: 5 }]) {
      assert.doesNotThrow(() => computeContextReduction(junk), `computeContextReduction(${JSON.stringify(junk)})`)
      assert.equal(computeContextReduction(junk).reductionPct, null)
    }
    assert.doesNotThrow(() => formatReduction(null))
    assert.doesNotThrow(() => formatReduction('x'))
    for (const junk of [null, undefined, 'x', { items: [null, 'a'] }]) {
      assert.doesNotThrow(() => fromCapabilityLedger(junk, null))
    }
  })

  test('an item with no name is still accounted for, under "(unnamed)"', () => {
    const r = computeContextReduction({ items: [{ alwaysOnTokens: 1, fullTokens: 10 }], snapshot: SNAP })
    assert.equal(r.perItem[0].name, '(unnamed)')
    assert.equal(r.itemsIncluded, 1)
  })

  test('the computation is deterministic', () => {
    assert.equal(JSON.stringify(ok()), JSON.stringify(ok()))
  })
})
