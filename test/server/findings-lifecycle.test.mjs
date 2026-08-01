import test from 'node:test'
import assert from 'node:assert/strict'
import { findingId, mergeFindings, openCodeFindings, blockingFindings } from '../../server/board.mjs'

// What this guards, observed on AIR-10733 rather than imagined: three review rounds produced 9, 8
// and 9 findings, and nothing could tell that apart from progress — because each round REPLACED the
// list instead of merging it. Findings a fix agent could never resolve (a GTM container value only
// Avo can register, Figma fidelity needing design QA) were re-raised every round, and a human
// decision to accept one had nowhere to live. Identity, memory, and acknowledgement are the three
// properties that let the loop terminate; each is asserted below.

const f = (over = {}) => ({ severity: 'high', class: 'code', file: 'packages/app/x/Thing.tsx', summary: 'The variant ignores the baggageIcon prop and hardcodes an icon', ...over })

test('the same defect keeps its id when the reviewer rewords it', () => {
  const a = findingId(f())
  const b = findingId(f({ summary: 'The variant ignores a baggageIcon prop, and it hardcodes the icon' }))
  assert.equal(a, b, 'reordered filler words must not mint a new finding')
})

test('different defects in the same file get different ids', () => {
  assert.notEqual(findingId(f()), findingId(f({ summary: 'RTL mirroring is applied twice and one transform is dead' })))
})

test('severity is part of identity — the same sentence at a new severity is a new decision', () => {
  assert.notEqual(findingId(f()), findingId(f({ severity: 'low' })))
})

test('a finding seen again keeps its first sighting and counts up', () => {
  const round1 = mergeFindings([], [f()], 'sha1')
  const round2 = mergeFindings(round1, [f()], 'sha2')
  assert.equal(round2.length, 1)
  assert.equal(round2[0].seenCount, 2)
  assert.equal(round2[0].firstSeenSha, 'sha1', 'first sighting is the evidence that it is not new')
  assert.equal(round2[0].lastSeenSha, 'sha2')
})

test('an acknowledgement survives the next review and stops blocking', () => {
  let list = mergeFindings([], [f({ severity: 'critical' })], 'sha1')
  list = list.map(x => ({ ...x, status: 'acked', class: 'needs-human', ackNote: 'Avo must register the container first' }))
  const after = mergeFindings(list, [f({ severity: 'critical' })], 'sha2')
  assert.equal(after[0].status, 'acked', 'a human decision must not be undone by re-running the reviewer')
  assert.equal(after[0].ackNote, 'Avo must register the container first')
  assert.equal(blockingFindings({ findings: after }).length, 0, 'an acked finding cannot block the pipeline')
})

test('a finding the new review no longer raises is resolved, not deleted', () => {
  const round1 = mergeFindings([], [f(), f({ summary: 'Second unrelated problem here somewhere' })], 'sha1')
  const round2 = mergeFindings(round1, [f()], 'sha2')
  assert.equal(round2.length, 2, 'history is the only evidence the loop is converging')
  const gone = round2.find(x => x.summary.startsWith('Second'))
  assert.equal(gone.status, 'resolved')
  assert.equal(gone.resolvedSha, 'sha2')
  assert.equal(openCodeFindings({ findings: round2 }).length, 1, 'resolved findings are not actionable')
})

test('only code-class findings are actionable', () => {
  const list = mergeFindings([], [
    f({ class: 'code' }),
    f({ class: 'needs-human', summary: 'Needs Avo to register the GA4 container value' }),
    f({ class: 'pre-existing', summary: 'Jest cannot run because Babel is too old' }),
  ], 'sha1')
  assert.equal(list.length, 3, 'all three are kept — they are true')
  assert.equal(openCodeFindings({ findings: list }).length, 1, 'only one can be handed to a fix agent')
})

test('findings recorded before this lifecycle existed are given an id and a class as they carry through', () => {
  // Real shape from the board file: no id, no class, no status — nine of these existed on
  // AIR-10733 when the lifecycle shipped, and they still have to render and be actionable.
  const legacy = [{ severity: 'high', file: 'a/b/Old.tsx', summary: 'Something was wrong here before ids existed', at: 1 }]
  const merged = mergeFindings(legacy, [], 'sha2')
  assert.equal(merged.length, 1)
  assert.ok(merged[0].id, 'a carried finding must get an id or it can never be acknowledged')
  assert.equal(merged[0].class, 'code')
  assert.equal(merged[0].status, 'resolved')
})

test('an unknown class falls back to code rather than silently vanishing', () => {
  const list = mergeFindings([], [f({ class: 'wishful-thinking' })], 'sha1')
  assert.equal(list[0].class, 'code', 'a class we do not recognise must not remove the finding from the loop')
})
