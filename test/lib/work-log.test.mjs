// Tests for lib/work-log.mjs.
//
// The property under test is HONESTY, not parsing convenience:
//  · a self-reported field must be labelled as self-reported;
//  · an absent sub-agent result must be null-with-a-reason, never a pass;
//  · a claimed-but-unobserved file must NOT be merged into the observed set — that merge is the
//    single mistake that would make this feature actively harmful, because it would turn "the model
//    said it edited X" into "X was edited".

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWorkLog, reconcile, crossCheckWorkLog, MAX_ITEMS_PER_BUCKET } from '../../lib/work-log.mjs'

const SAMPLE = `
Some preamble the agent wrote.

## Work Log

- Read: \`lib/paths.mjs\`
- Read: \`server/index.mjs\`
- Changed: \`lib/work-log.mjs\`
- Changed: \`README.md\`, \`package.json\`
- code-reviewer: PASS — no blocking findings
- test-writer: FAIL (2 tests red)
- Decision: kept three sets instead of two because claimed-only and observed-only are opposite defects

## Next steps
- ship it
`

test('parses a well-formed Work Log into labelled self-reported fields', () => {
  const r = parseWorkLog(SAMPLE)
  assert.equal(r.ok, true)
  assert.equal(r.evidence, 'self-reported')
  assert.deepEqual(r.selfReportedFilesRead.map(f => f.path), ['lib/paths.mjs', 'server/index.mjs'])
  assert.deepEqual(r.selfReportedFilesChanged.map(f => f.path), ['lib/work-log.mjs', 'README.md', 'package.json'])
  assert.equal(r.selfReportedDecisions.length, 1)
  // every file entry carries the self-report marker — a caller cannot lose it by destructuring
  for (const f of [...r.selfReportedFilesRead, ...r.selfReportedFilesChanged]) assert.equal(f.selfReported, true)
})

test('the section ends at the next same-level heading — "ship it" is not a Work Log item', () => {
  const r = parseWorkLog(SAMPLE)
  assert.ok(!r.selfReportedItems.some(i => /ship it/.test(i.raw)))
})

test('sub-agent verdicts normalise only when unambiguous', () => {
  const r = parseWorkLog(SAMPLE)
  assert.equal(r.selfReportedCodeReviewerResult.normalized, 'PASS')
  assert.equal(r.selfReportedCodeReviewerResult.selfReported, true)
  assert.equal(r.selfReportedTestWriterResult.normalized, 'FAIL')
})

test('a verdict containing both pass and fail wording is NOT normalised', () => {
  const r = parseWorkLog('## Work Log\n- code-reviewer: passed, but one required finding remains\n')
  assert.equal(r.ok, true)
  assert.equal(r.selfReportedCodeReviewerResult.normalized, null)
  assert.match(r.selfReportedCodeReviewerResult.reason, /ambiguous/)
  assert.equal(r.selfReportedCodeReviewerResult.value, 'passed, but one required finding remains')
})

test('an ABSENT code-reviewer line is null-with-a-reason, never a pass', () => {
  const r = parseWorkLog('## Work Log\n- Changed: a.mjs\n')
  assert.equal(r.ok, true)
  assert.equal(r.selfReportedCodeReviewerResult.value, null)
  assert.equal(r.selfReportedCodeReviewerResult.normalized, null)
  assert.match(r.selfReportedCodeReviewerResult.reason, /Absence is not a pass/)
  assert.match(r.selfReportedTestWriterResult.reason, /Absence is not a pass/)
})

test('sub-headings act as buckets', () => {
  const r = parseWorkLog('## Work Log\n\n### Files Changed\n- lib/a.mjs\n- lib/b.mjs\n\n### Files Read\n- lib/c.mjs\n')
  assert.deepEqual(r.selfReportedFilesChanged.map(f => f.path), ['lib/a.mjs', 'lib/b.mjs'])
  assert.deepEqual(r.selfReportedFilesRead.map(f => f.path), ['lib/c.mjs'])
})

test('every Work Log section is parsed — taking only the first would be a silent cap', () => {
  const r = parseWorkLog('## Work Log\n- Changed: a.mjs\n\n## Other\ntext\n\n## Work Log\n- Changed: b.mjs\n')
  assert.equal(r.sectionCount, 2)
  assert.deepEqual(r.selfReportedFilesChanged.map(f => f.path), ['a.mjs', 'b.mjs'])
})

// --- malformed input never throws and never returns an empty-looking success -------------------
test('no Work Log section → {ok:false, reason}, NOT an object with empty arrays', () => {
  const r = parseWorkLog('# Report\n\nI did some things.\n')
  assert.equal(r.ok, false)
  assert.match(r.reason, /never wrote a Work Log/)
  assert.equal(r.selfReportedFilesChanged, undefined)
})

test('an empty Work Log section → {ok:false}, because "[]" would read as "changed nothing"', () => {
  const r = parseWorkLog('## Work Log\n\n## Next\n- x\n')
  assert.equal(r.ok, false)
  assert.match(r.reason, /section is empty/)
})

test('non-string input does not throw', () => {
  for (const v of [null, undefined, 42, {}, []]) {
    const r = parseWorkLog(v)
    assert.equal(r.ok, false)
    assert.ok(r.reason.length)
  }
})

test('a claim with no extractable path is kept with path:null and a reason, not dropped', () => {
  const r = parseWorkLog('## Work Log\n- Changed: tidied up the imports everywhere\n')
  assert.equal(r.selfReportedFilesChanged.length, 1)
  assert.equal(r.selfReportedFilesChanged[0].path, null)
  assert.match(r.selfReportedFilesChanged[0].reason, /no file-like token/)
})

test('an unrecognised label is surfaced, not silently swallowed', () => {
  const r = parseWorkLog('## Work Log\n- Widgets frobbed: 3\n')
  assert.ok(r.unrecognisedLabels.some(u => /Widgets frobbed/.test(u.label)))
})

test('caps are reported, never silent', () => {
  const many = ['## Work Log', ...Array.from({ length: MAX_ITEMS_PER_BUCKET + 5 }, (_, i) => `- Changed: f${i}.mjs`)].join('\n')
  const r = parseWorkLog(many)
  assert.equal(r.selfReportedFilesChanged.length, MAX_ITEMS_PER_BUCKET)
  assert.equal(r.caps.dropped.filesChanged, 5)
  assert.match(r.caps.note, /lower bounds/)
})

// --- reconcile: the honesty property this feature exists for -----------------------------------
test('claimed-only is NOT merged into observed — three separate sets', () => {
  // `config.json` was edited with `sed -i`: the agent knows, tool-call parsing does not.
  const r = reconcile(
    [{ path: 'lib/a.mjs', line: 4 }, { path: 'config.json', line: 5 }],
    ['lib/a.mjs', 'lib/z.mjs'],
  )
  assert.equal(r.ok, true)
  assert.deepEqual(r.both.map(x => x.path), ['lib/a.mjs'])
  assert.deepEqual(r.claimedOnly.map(x => x.path), ['config.json'])
  assert.deepEqual(r.observedOnly.map(x => x.path), ['lib/z.mjs'])
  // the merge that must never happen
  assert.ok(!r.observedOnly.some(x => x.path === 'config.json'))
  assert.ok(!r.both.some(x => x.path === 'config.json'))
  assert.equal(r.claimedOnly[0].observedInToolCalls, false)
  assert.equal(r.claimedOnly[0].selfReported, true)
})

test('claimed-only keeps BOTH interpretations — Bash edit and false claim are not disambiguated', () => {
  const r = reconcile(['x.mjs'], [])
  assert.equal(r.claimedOnly[0].interpretation, 'ambiguous')
  assert.equal(r.claimedOnly[0].possibleCauses.length, 2)
  assert.ok(r.claimedOnly[0].possibleCauses.some(c => /sed -i/.test(c)))
  assert.ok(r.claimedOnly[0].possibleCauses.some(c => /did not make/.test(c)))
})

test('observed-only entries are marked selfReported:false', () => {
  const r = reconcile([], ['lib/z.mjs'])
  assert.equal(r.observedOnly[0].selfReported, false)
  assert.equal(r.observedOnly[0].observedInToolCalls, true)
})

test('agreement over an empty comparison is null, not 1', () => {
  const r = reconcile([], [])
  assert.equal(r.agreementRatio, null)
  assert.match(r.agreementReason, /no agreement can be computed/)
})

test('without a cwd, relative and absolute paths do NOT silently match', () => {
  const r = reconcile(['lib/a.mjs'], ['/home/u/proj/lib/a.mjs'])
  assert.equal(r.both.length, 0)
  assert.equal(r.claimedOnly.length, 1)
  assert.equal(r.observedOnly.length, 1)
  // but the suspicion is surfaced so a human can act on it
  assert.equal(r.basenameCollisions.length, 1)
  assert.match(r.basenameCollisions[0].note, /NOT counted as agreement/)
  assert.equal(r.normalization.cwd, null)
})

test('with a cwd, relative claims resolve and DO match', () => {
  const r = reconcile(['lib/a.mjs'], ['/home/u/proj/lib/a.mjs'], { cwd: '/home/u/proj' })
  assert.deepEqual(r.both.map(x => x.path), ['/home/u/proj/lib/a.mjs'])
  assert.equal(r.claimedOnly.length, 0)
  assert.equal(r.agreementRatio, 1)
})

test('unresolvable claims are counted separately, not folded into any of the three sets', () => {
  const parsed = parseWorkLog('## Work Log\n- Changed: tidied things\n- Changed: lib/a.mjs\n')
  const r = reconcile(parsed.selfReportedFilesChanged, ['lib/a.mjs'])
  assert.equal(r.counts.both, 1)
  assert.equal(r.counts.claimedOnly, 0)
  assert.equal(r.counts.unresolvedClaims, 1)
})

test('reconcile with non-array input returns {ok:false}, does not throw', () => {
  assert.equal(reconcile(null, []).ok, false)
  assert.equal(reconcile([], 'x').ok, false)
})

test('crossCheckWorkLog propagates the parse failure instead of returning an empty reconciliation', () => {
  const r = crossCheckWorkLog('no work log here', ['a.mjs'])
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'parse')
  assert.equal(r.reconciliation, undefined)
})

test('crossCheckWorkLog end to end catches the Bash-edit case', () => {
  const out = `## Work Log
- Changed: \`lib/a.mjs\`
- Changed: \`docs/gen.md\`  (written with \`sed -i\`)
`
  // the tool-call list only ever sees Edit/Write/MultiEdit/NotebookEdit (server/index.mjs:1051)
  const r = crossCheckWorkLog(out, ['lib/a.mjs'])
  assert.equal(r.ok, true)
  assert.deepEqual(r.reconciliation.claimedOnly.map(x => x.path), ['docs/gen.md'])
  assert.equal(r.workLog.evidence, 'self-reported')
})
