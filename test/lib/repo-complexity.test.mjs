// Tests for lib/repo-complexity.mjs.
//
// Honesty properties pinned here:
//   1. DETERMINISM. Same tree in, byte-identical score out — repeatedly, and independent of
//      directory read order. A "deterministic rubric" that drifts is just a vibe with a number.
//   2. An unmeasurable dimension scores null and is EXCLUDED, never counted as 0. Otherwise a
//      broken scan reads as a simple repo.
//   3. The audit NEVER claims a capability is unused. `provenUnusedCount` is 0, always.
//   4. No observation window => null count with a reason, not a confident zero.
//   5. Capabilities installed after the window opened are not judged on it.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RUBRIC, MAX_SCORE, gatherRepoEvidence, scoreComplexity, complexityOf,
  auditOverEngineering, deriveObservationWindow,
} from '../../lib/repo-complexity.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DAY = 86400_000

function makeRepo(spec = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cplx-'))
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  for (let i = 0; i < (spec.jsFiles ?? 3); i++) fs.writeFileSync(path.join(dir, 'src', `f${i}.js`), 'x')
  if (spec.pkg !== null) fs.writeFileSync(path.join(dir, 'package.json'), spec.pkg ?? JSON.stringify({ dependencies: { a: '1' }, scripts: { test: 'x' } }))
  return dir
}

describe('rubric is declared, not implied', () => {
  test('six dimensions, each stating what it is measured from and its threshold', () => {
    assert.equal(RUBRIC.length, 6)
    assert.equal(MAX_SCORE, 6)
    for (const r of RUBRIC) {
      assert.ok(r.key && r.label)
      assert.ok(r.measuredFrom && r.measuredFrom.length > 10, `${r.key} must say what evidence it uses`)
      assert.equal(typeof r.threshold, 'number')
      assert.ok(r.unit && r.rationale)
    }
    assert.equal(new Set(RUBRIC.map(r => r.key)).size, 6, 'keys must be unique')
  })

  test('a score carries per-dimension evidence, not just points', () => {
    const dir = makeRepo()
    try {
      const c = complexityOf(dir)
      assert.equal(c.dimensions.length, 6)
      for (const d of c.dimensions) {
        assert.ok(d.evidence, `${d.key} must report the evidence behind its verdict`)
        assert.equal(typeof d.threshold, 'number')
        assert.ok(d.measured != null, `${d.key} measured value must be reported`)
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('determinism — same repo in, same score out', () => {
  test('ten consecutive scores of the same tree are byte-identical', () => {
    const dir = makeRepo()
    try {
      const first = JSON.stringify(complexityOf(dir))
      for (let i = 0; i < 9; i++) assert.equal(JSON.stringify(complexityOf(dir)), first, `run ${i + 2} diverged`)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  test('this repo scores identically across runs', () => {
    assert.equal(JSON.stringify(complexityOf(REPO)), JSON.stringify(complexityOf(REPO)))
  })

  test('the score does not move when the clock does', () => {
    const dir = makeRepo()
    const realNow = Date.now, realRandom = Math.random
    try {
      const a = JSON.stringify(complexityOf(dir))
      // If any Date.now()/Math.random() crept into the scorer these stubs would change the answer.
      Date.now = () => 4102444800000
      Math.random = () => 0.99999
      assert.equal(JSON.stringify(complexityOf(dir)), a, 'the score must not depend on time or randomness')
    } finally { Date.now = realNow; Math.random = realRandom; fs.rmSync(dir, { recursive: true, force: true }) }
  })

  test('scoreComplexity is pure — the same evidence object always yields the same score', () => {
    const dir = makeRepo()
    try {
      const ev = gatherRepoEvidence(dir)
      assert.equal(JSON.stringify(scoreComplexity(ev)), JSON.stringify(scoreComplexity(ev)))
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  test('adding a file changes the evidence — the score is not merely constant', () => {
    const dir = makeRepo()
    try {
      const before = gatherRepoEvidence(dir).sourceFiles
      fs.writeFileSync(path.join(dir, 'src', 'extra.ts'), 'y')
      const after = gatherRepoEvidence(dir)
      assert.equal(after.sourceFiles, before + 1, 'determinism must not be achieved by ignoring the repo')
      assert.ok('.ts' in after.extensions)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('unmeasurable dimensions are null, never 0', () => {
  test('an unparseable package.json makes dependencyLoad null and shrinks the denominator', () => {
    const dir = makeRepo({ pkg: '{ this is not json' })
    try {
      const c = complexityOf(dir)
      const d = c.dimensions.find(x => x.key === 'dependencyLoad')
      assert.equal(d.measured, null)
      assert.equal(d.met, null)
      assert.equal(d.points, null, 'an unreadable manifest must NOT be scored as 0 dependencies')
      assert.match(d.evidence, /unparseable/)
      assert.ok(d.because.includes('EXCLUDED'))
      // `automation` also goes null: it sums npm scripts, and an unparseable manifest means the
      // script count is unknown too. Both drop out rather than being scored from a partial read.
      assert.equal(c.dimensions.find(x => x.key === 'automation').points, null)
      assert.equal(c.scoreOutOf, 4, 'the score must be out of the dimensions actually measured')
      assert.equal(c.dimensionsMeasured, 4)
      assert.equal(c.complete, false)
      assert.ok(c.incompleteNote.includes('LOWER BOUND'))
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  test('an unreadable repo root yields score null with a reason, not 0/6', () => {
    const c = complexityOf('/definitely/not/a/repo/anywhere')
    assert.equal(c.score, null)
    assert.notEqual(c.score, 0)
    assert.ok(c.reason && c.reason.length > 0)
    assert.equal(c.dimensionsMeasured, 0)
    for (const d of c.dimensions) assert.equal(d.met, null)
  })

  test('malformed evidence never throws', () => {
    for (const junk of [null, undefined, 0, 'x', [], { rootReadable: false }]) {
      assert.doesNotThrow(() => scoreComplexity(junk))
      assert.equal(scoreComplexity(junk).score, null)
    }
    assert.doesNotThrow(() => gatherRepoEvidence(null))
    assert.doesNotThrow(() => complexityOf(undefined))
  })

  test('bounds that bite are reported, and flagged as making the score a lower bound', () => {
    const dir = makeRepo({ jsFiles: 8 })
    try {
      const ev = gatherRepoEvidence(dir, { maxFiles: 3 })
      const b = ev.bounds.find(x => x.what === 'files walked')
      assert.ok(b && b.hit)
      assert.match(b.note, /LOWER BOUND/)
      assert.ok(scoreComplexity(ev).bounds.length > 0, 'bounds must survive into the score')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  test('node_modules is excluded — otherwise every repo maxes the rubric', () => {
    const dir = makeRepo()
    try {
      const before = gatherRepoEvidence(dir).sourceFiles
      fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true })
      for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', `m${i}.js`), 'z')
      assert.equal(gatherRepoEvidence(dir).sourceFiles, before)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('this repo scores, with evidence', () => {
  test('a real score is produced for the checkout under test', () => {
    const c = complexityOf(REPO)
    assert.equal(c.reason, null)
    assert.ok(Number.isInteger(c.score) && c.score >= 0 && c.score <= 6)
    assert.equal(c.complete, true, 'every dimension should be measurable in this checkout')
    assert.equal(c.scoreOutOf, 6)
    const breadth = c.dimensions.find(d => d.key === 'breadth')
    assert.ok(breadth.measured > 0, 'this repo has source files')
    assert.ok(c.dimensions.find(d => d.key === 'testSurface').measured > 0)
  })
})

// ---------------------------------------------------------------------------
// The over-engineering audit
// ---------------------------------------------------------------------------
const W = { start: 1000 * DAY, end: 1100 * DAY, source: 'test' }
const cap = (name, over = {}) => ({ kind: 'skill', name, installedAt: 900 * DAY, alwaysOnTokens: 100, ...over })

describe('the audit never claims a capability is unused', () => {
  test('provenUnusedCount is 0 even when nothing fired at all', () => {
    const a = auditOverEngineering({ installed: [cap('a'), cap('b'), cap('c')], invocations: [], window: W })
    assert.equal(a.noRecordedInvocationCount, 3)
    assert.equal(a.provenUnusedCount, 0)
    assert.ok(a.provenUnusedNote.includes('Always 0'))
    assert.match(a.headline, /0 are proven unused/)
    // The headline may only use "unused" inside the disclaimer. It must never assert non-use.
    assert.doesNotMatch(a.headline, /never fired|are unused|never used/i)
    assert.match(a.headline, /no recorded invocation/)
  })

  test('per-item the field is noRecordedInvocation, and no field claims "unused"', () => {
    const a = auditOverEngineering({ installed: [cap('a')], invocations: [], window: W })
    const i = a.items[0]
    assert.equal(i.noRecordedInvocation, true)
    assert.ok(!('unused' in i), 'the field name is the argument — it must not be "unused"')
    assert.match(i.claim, /no invocation recorded/)
    assert.match(i.claim, /window/)
  })

  test('caveats spell out why absence of a record is not a record of absence', () => {
    const a = auditOverEngineering({ installed: [cap('a')], invocations: [], window: W })
    assert.ok(a.caveats.length >= 3)
    assert.ok(a.caveats.some(c => /NOT proven unused/.test(c)))
    assert.ok(a.caveats.some(c => /complete/i.test(c)))
  })

  test('record completeness defaults to "unknown", the honest default', () => {
    const a = auditOverEngineering({ installed: [cap('a')], invocations: [], window: W })
    assert.equal(a.observationWindow.recordCompleteness, 'unknown')
  })
})

describe('no observation window => null, not zero', () => {
  test('a missing window nulls the count and gives a reason', () => {
    for (const w of [null, undefined, {}, { start: NaN, end: 5 }, { start: 10, end: 1 }]) {
      const a = auditOverEngineering({ installed: [cap('a'), cap('b')], invocations: [], window: w })
      assert.equal(a.noRecordedInvocationCount, null, 'a count without a window is an accusation with no span')
      assert.equal(a.withRecordedInvocation, null)
      assert.equal(a.headline, null, 'no headline may be printed without a window')
      assert.equal(a.reason, 'observation-window-unknown')
      assert.ok(a.because.length > 20)
      assert.equal(a.installedCount, 2, 'what IS known is still reported')
      assert.equal(a.provenUnusedCount, 0)
    }
  })

  test('deriveObservationWindow returns null + reason with no timestamps', () => {
    const { window, reason } = deriveObservationWindow({})
    assert.equal(window, null)
    assert.match(reason, /unknown/)
  })

  test('deriveObservationWindow clamps to firstStartTime — nothing was recorded before the CLI ran', () => {
    const { window } = deriveObservationWindow({ transcriptTimes: [100, 500], firstStartTime: 300 })
    assert.equal(window.start, 300)
    assert.match(window.source, /firstStartTime/)
  })

  test('deriveObservationWindow ignores a firstStartTime later than the data would allow it to shrink past', () => {
    const { window } = deriveObservationWindow({ transcriptTimes: [400, 500], firstStartTime: 100 })
    assert.equal(window.start, 400, 'an earlier firstStartTime must not widen the window beyond observed data')
  })
})

describe('the window is always reported, and short windows say so', () => {
  test('window span, source and completeness travel with the count', () => {
    const a = auditOverEngineering({ installed: [cap('a')], invocations: [], window: W, recordCompleteness: 'partial' })
    assert.equal(a.observationWindow.days, 100)
    assert.equal(a.observationWindow.source, 'test')
    assert.equal(a.observationWindow.recordCompleteness, 'partial')
    assert.match(a.headline, /100.00-day window/)
  })

  test('a sub-week window is flagged too short for habit claims', () => {
    const short = { start: 1000 * DAY, end: 1000 * DAY + 3 * 3600_000, source: 'test' }
    const a = auditOverEngineering({ installed: [cap('a', { installedAt: 999 * DAY })], invocations: [], window: short })
    assert.equal(a.observationWindow.tooShortForHabitClaims, true)
    assert.match(a.observationWindow.note, /no data yet/)
  })

  test('a long window is not flagged', () => {
    const a = auditOverEngineering({ installed: [cap('a')], invocations: [], window: W })
    assert.equal(a.observationWindow.tooShortForHabitClaims, false)
    assert.equal(a.observationWindow.note, null)
  })
})

describe('capabilities are not judged on a window they did not exist for', () => {
  test('one installed after the window opened is separated out', () => {
    const a = auditOverEngineering({
      installed: [cap('old', { installedAt: 900 * DAY }), cap('new', { installedAt: 1099 * DAY })],
      invocations: [], window: W,
    })
    assert.equal(a.breakdown.existedForWholeWindow, 1)
    assert.equal(a.breakdown.installedAfterWindowStart, 1)
    const n = a.items.find(i => i.name === 'new')
    assert.equal(n.installedAfterWindowStart, true)
    assert.equal(n.observedDays, 1, 'exposure is the overlap of install and window, not the whole window')
    assert.match(a.headline, /1 were installed after it opened/)
  })

  test('an unknown install date is its own bucket, not lumped with the judgeable', () => {
    const a = auditOverEngineering({ installed: [cap('x', { installedAt: null })], invocations: [], window: W })
    assert.equal(a.breakdown.installDateUnknown, 1)
    assert.equal(a.breakdown.existedForWholeWindow, 0)
    assert.equal(a.items[0].observedDays, null)
    assert.match(a.items[0].claim, /install date unknown/)
  })

  test('reclaimable tokens are null when any candidate is unmeasured, not silently summed', () => {
    const a = auditOverEngineering({ installed: [cap('a'), cap('b', { alwaysOnTokens: null })], invocations: [], window: W })
    assert.equal(a.reclaimableTokensUpperBound, null)
    assert.match(a.reclaimableTokensNote, /part-measurement part-guess/)
  })

  test('when all candidates are measured the total is labelled an UPPER bound', () => {
    const a = auditOverEngineering({ installed: [cap('a'), cap('b')], invocations: [], window: W })
    assert.equal(a.reclaimableTokensUpperBound, 200)
    assert.match(a.reclaimableTokensNote, /UPPER bound/)
  })
})

describe('invocations that do fire are counted, and mismatches surfaced', () => {
  test('a firing inside the window flips the verdict', () => {
    const a = auditOverEngineering({ installed: [cap('a'), cap('b')], invocations: [{ kind: 'skill', name: 'a', t: 1050 * DAY }], window: W })
    assert.equal(a.withRecordedInvocation, 1)
    assert.equal(a.noRecordedInvocationCount, 1)
    assert.equal(a.items.find(i => i.name === 'a').recordedInvocations, 1)
  })

  test('firings outside the window are excluded from the verdict but counted', () => {
    const a = auditOverEngineering({ installed: [cap('a')], invocations: [{ kind: 'skill', name: 'a', t: 500 * DAY }], window: W })
    assert.equal(a.noRecordedInvocationCount, 1)
    assert.equal(a.invocationsOutsideWindow, 1, 'discarded evidence must still be visible')
  })

  test('a firing for a name not in the inventory proves the inventory incomplete — observed for real with claude-api', () => {
    const a = auditOverEngineering({ installed: [cap('a')], invocations: [{ kind: 'skill', name: 'ghost', t: 1050 * DAY }], window: W })
    assert.equal(a.unmatchedInvocations.length, 1)
    assert.equal(a.unmatchedInvocations[0].key, 'skill:ghost')
    assert.equal(a.inventoryCompleteness, 'DEMONSTRABLY INCOMPLETE')
    assert.match(a.headline, /inventory itself is known to be incomplete/)
    assert.match(a.inventoryNote, /skill:ghost/)
  })

  test('no mismatch => no false alarm', () => {
    const a = auditOverEngineering({ installed: [cap('a')], invocations: [{ kind: 'skill', name: 'a', t: 1050 * DAY }], window: W })
    assert.deepEqual(a.unmatchedInvocations, [])
    assert.equal(a.inventoryCompleteness, 'no contradiction found')
    assert.equal(a.inventoryNote, null)
  })

  test('the audit output is deterministic and never throws on junk', () => {
    const args = { installed: [cap('b'), cap('a')], invocations: [{ kind: 'skill', name: 'z', t: 1050 * DAY }], window: W }
    assert.equal(JSON.stringify(auditOverEngineering(args)), JSON.stringify(auditOverEngineering(args)))
    // `null` specifically: a default parameter only fires on `undefined`, so a null from a failed
    // upstream read would destructure and throw. This caught a real bug in all three modules.
    for (const junk of [undefined, null, 'x', 5, [], {}, { installed: null, invocations: 'x', window: 5 }, { installed: [null, 3, { name: 1 }], invocations: [{ name: 'a', t: 'x' }], window: W }]) {
      assert.doesNotThrow(() => auditOverEngineering(junk), `auditOverEngineering(${JSON.stringify(junk)})`)
    }
    for (const junk of [undefined, null, 'x', [], { invocationTimes: null, transcriptTimes: 'x' }]) {
      assert.doesNotThrow(() => deriveObservationWindow(junk))
      assert.equal(deriveObservationWindow(junk).window, null)
    }
    assert.equal(auditOverEngineering(null).reason, 'observation-window-unknown')
  })
})
