// Tests for lib/diff-review.mjs.
//
// Three properties carry the whole feature and each has its own test below:
//  1. one pending review per file (two "originals" for one path is silent data loss);
//  2. N consecutive edits coalesce into ONE original→latest diff;
//  3. rejecting a file that changed since the snapshot REFUSES and writes nothing.
//
// Test 3 is the one that matters. Reject is the only operation here that can destroy work.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDiffReviewStore, lineDiff, CONFIDENCE } from '../../lib/diff-review.mjs'

// in-memory disk so a test can make the file diverge behind the store's back
function fakeDisk(initial = {}) {
  const files = new Map(Object.entries(initial))
  return {
    files,
    io: {
      readFile: p => (files.has(p) ? files.get(p) : null),
      writeFile: (p, c) => files.set(p, c),
      now: () => 1_700_000_000_000,
    },
  }
}

test('a normal accept keeps the latest content and records a new baseline', () => {
  const d = fakeDisk({ '/p/a.mjs': 'v1' })
  const s = createDiffReviewStore({ ...d.io, mode: 'hooks' })
  const snap = s.snapshot('/p/a.mjs', 'v1')
  d.files.set('/p/a.mjs', 'v2')
  s.recordEdit('/p/a.mjs', 'v2')
  const r = s.accept(snap.reviewId)
  assert.equal(r.ok, true)
  assert.equal(d.files.get('/p/a.mjs'), 'v2')
  assert.equal(s.pending('/p/a.mjs'), null)
})

// --- property 1 -------------------------------------------------------------------------------
test('a second snapshot for the same file does NOT open a second pending review', () => {
  const s = createDiffReviewStore({ ...fakeDisk().io, mode: 'hooks' })
  const first = s.snapshot('/p/a.mjs', 'original')
  const second = s.snapshot('/p/a.mjs', 'something-else-entirely')
  assert.equal(second.coalesced, true)
  assert.equal(second.reviewId, first.reviewId)
  assert.equal(s.listPending().length, 1)
  assert.match(second.reason, /already covers/)
  // and the ORIGINAL original is kept — the older, safer restore point
  assert.equal(s.get(first.reviewId).originalHash, s.get(second.reviewId).originalHash)
})

test('two different files legitimately get two pending reviews', () => {
  const s = createDiffReviewStore({ ...fakeDisk().io, mode: 'hooks' })
  s.snapshot('/p/a.mjs', 'a')
  s.snapshot('/p/b.mjs', 'b')
  assert.equal(s.listPending().length, 2)
})

// --- property 2 -------------------------------------------------------------------------------
test('N consecutive edits to one file coalesce into ONE review, original→latest', () => {
  const d = fakeDisk({ '/p/a.mjs': 'l1\nl2\nl3\n' })
  const s = createDiffReviewStore({ ...d.io, mode: 'hooks' })
  const snap = s.snapshot('/p/a.mjs', 'l1\nl2\nl3\n')
  for (const c of ['l1\nl2x\nl3\n', 'l1\nl2x\nl3x\n', 'l1\nl2x\nl3x\nl4\n', 'l1\nl2x\nl3x\nl4\nl5\n']) {
    const r = s.recordEdit('/p/a.mjs', c)
    assert.equal(r.reviewId, snap.reviewId)
    assert.equal(r.coalesced, true)
  }
  assert.equal(s.listPending().length, 1, 'four edits must not stack four reviews')
  const rev = s.get(snap.reviewId)
  assert.equal(rev.coalescedEdits, 4)

  const dd = s.diff(snap.reviewId)
  assert.equal(dd.ok, true)
  assert.equal(dd.coalescedEdits, 4)
  // the diff is against the FIRST original, not the previous intermediate state
  assert.ok(dd.hunks.some(h => (h.removedLines || []).includes('l2')))
  assert.ok(dd.hunks.some(h => (h.addedLines || []).includes('l5')))
})

test('after accept, the next snapshot opens a fresh review rather than reusing the old one', () => {
  const d = fakeDisk({ '/p/a.mjs': 'v1' })
  const s = createDiffReviewStore({ ...d.io, mode: 'hooks' })
  const one = s.snapshot('/p/a.mjs', 'v1')
  s.recordEdit('/p/a.mjs', 'v2'); d.files.set('/p/a.mjs', 'v2')
  s.accept(one.reviewId)
  const two = s.snapshot('/p/a.mjs', 'v2')
  assert.notEqual(two.reviewId, one.reviewId)
  assert.equal(two.coalesced, false)
})

// --- property 3: the dangerous path ------------------------------------------------------------
test('reject restores the ORIGINAL when the file is still what the reviewer saw', () => {
  const d = fakeDisk({ '/p/a.mjs': 'original\n' })
  const s = createDiffReviewStore({ ...d.io, mode: 'hooks' })
  const snap = s.snapshot('/p/a.mjs', 'original\n')
  d.files.set('/p/a.mjs', 'agent-edit\n')
  s.recordEdit('/p/a.mjs', 'agent-edit\n')
  const r = s.reject(snap.reviewId)
  assert.equal(r.ok, true)
  assert.equal(d.files.get('/p/a.mjs'), 'original\n')
})

test('reject REFUSES when the file changed since the snapshot, and writes nothing', () => {
  const d = fakeDisk({ '/p/a.mjs': 'original\n' })
  const s = createDiffReviewStore({ ...d.io, mode: 'hooks' })
  const snap = s.snapshot('/p/a.mjs', 'original\n')
  s.recordEdit('/p/a.mjs', 'agent-edit\n')
  d.files.set('/p/a.mjs', 'agent-edit\nplus the human typed this\n') // changed behind our back

  const r = s.reject(snap.reviewId)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'changed-since-snapshot')
  assert.match(r.reason, /destroy that later change/)
  assert.equal(d.files.get('/p/a.mjs'), 'agent-edit\nplus the human typed this\n', 'NOTHING may be written on a refused reject')
  assert.equal(s.listPending().length, 1, 'the review stays pending so it can be re-reviewed')
  assert.ok(r.diskHash && r.reviewedHash && r.diskHash !== r.reviewedHash)
})

test('reject refuses when the file was deleted rather than re-creating it', () => {
  const d = fakeDisk({ '/p/a.mjs': 'original\n' })
  const s = createDiffReviewStore({ ...d.io, mode: 'hooks' })
  const snap = s.snapshot('/p/a.mjs', 'original\n')
  s.recordEdit('/p/a.mjs', 'edited\n')
  d.files.delete('/p/a.mjs')
  const r = s.reject(snap.reviewId)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'file-missing')
  assert.equal(d.files.has('/p/a.mjs'), false)
})

test('force-reject requires a literal acknowledgement and reports what it discarded', () => {
  const d = fakeDisk({ '/p/a.mjs': 'original\n' })
  const s = createDiffReviewStore({ ...d.io, mode: 'hooks' })
  const snap = s.snapshot('/p/a.mjs', 'original\n')
  s.recordEdit('/p/a.mjs', 'edited\n')
  d.files.set('/p/a.mjs', 'edited\nhuman work\n')

  assert.equal(s.rejectForce(snap.reviewId, true).ok, false, 'a truthy flag must not be enough')
  assert.equal(s.rejectForce(snap.reviewId, 'yes').ok, false)
  const r = s.rejectForce(snap.reviewId, 'discard-later-changes')
  assert.equal(r.ok, true)
  assert.equal(r.forced, true)
  assert.equal(d.files.get('/p/a.mjs'), 'original\n')
  assert.equal(r.discardedChars, 'edited\nhuman work\n'.length)
  assert.match(r.warning, /unreviewed change was overwritten/)
})

test('a review with no original at all refuses reject rather than deleting the file', () => {
  const d = fakeDisk({ '/p/new.mjs': 'appeared\n' })
  const s = createDiffReviewStore({ ...d.io, mode: 'degraded' })
  const r = s.recordEdit('/p/new.mjs', 'appeared\n') // never snapshotted, no baseline
  assert.equal(s.get(r.reviewId).originalConfidence, CONFIDENCE.UNKNOWN)
  const rj = s.reject(r.reviewId)
  assert.equal(rj.ok, false)
  assert.equal(rj.code, 'no-original')
  assert.match(rj.reason, /nothing to restore/)
  assert.equal(d.files.get('/p/new.mjs'), 'appeared\n')
})

// --- degraded mode ------------------------------------------------------------------------------
test('degraded mode is the DEFAULT and says so — claiming hook confidence we lack would be a lie', () => {
  const s = createDiffReviewStore(fakeDisk().io)
  assert.equal(s.status().mode, 'degraded')
  assert.equal(s.status().degraded, true)
  assert.match(s.status().degradedReason, /best guess/)
})

test('a degraded review labels its original as INFERRED and carries the reason into the diff', () => {
  const d = fakeDisk({ '/p/a.mjs': 'on-open\n' })
  const s = createDiffReviewStore({ ...d.io, mode: 'degraded' })
  s.noteFileOpened('/p/a.mjs')
  const r = s.recordEdit('/p/a.mjs', 'after\n')
  const rev = s.get(r.reviewId)
  assert.equal(rev.degraded, true)
  assert.equal(rev.originalConfidence, CONFIDENCE.INFERRED)
  assert.match(rev.originalConfidenceReason, /not observed pre-edit content/)
  const dd = s.diff(r.reviewId)
  assert.equal(dd.degraded, true)
  assert.ok(dd.originalConfidenceReason.length)
})

test('a hook-mode snapshot is labelled OBSERVED and not degraded', () => {
  const s = createDiffReviewStore({ ...fakeDisk().io, mode: 'hooks' })
  const r = s.snapshot('/p/a.mjs', 'v1')
  const rev = s.get(r.reviewId)
  assert.equal(rev.degraded, false)
  assert.equal(rev.originalConfidence, CONFIDENCE.OBSERVED)
})

test('a degraded reject succeeds but warns that the restored original was inferred', () => {
  const d = fakeDisk({ '/p/a.mjs': 'on-open\n' })
  const s = createDiffReviewStore({ ...d.io, mode: 'degraded' })
  s.noteFileOpened('/p/a.mjs')
  const r = s.recordEdit('/p/a.mjs', 'after\n')
  d.files.set('/p/a.mjs', 'after\n')
  const rj = s.reject(r.reviewId)
  assert.equal(rj.ok, true)
  assert.equal(rj.degraded, true)
  assert.match(rj.warning, /INFERRED original/)
  assert.equal(d.files.get('/p/a.mjs'), 'on-open\n')
})

// --- bounds + malformed input --------------------------------------------------------------------
test('bad arguments return {ok:false} and never throw', () => {
  const s = createDiffReviewStore(fakeDisk().io)
  assert.equal(s.snapshot('', 'x').ok, false)
  assert.equal(s.snapshot(null, 'x').ok, false)
  assert.equal(s.recordEdit(undefined, 'x').ok, false)
  assert.equal(s.accept('nope').ok, false)
  assert.equal(s.reject('nope').ok, false)
  assert.equal(s.diff('nope').ok, false)
})

test('the diff cap is reported rather than silently truncating', () => {
  const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')
  const d = lineDiff(big, big + '\nextra')
  assert.ok(d.capped)
  assert.equal(d.capped.limit, 4000)
  assert.match(d.capped.note, /whole-file replacement/)
})

test('status reports its limits', () => {
  const s = createDiffReviewStore(fakeDisk().io)
  assert.equal(typeof s.status().limits.contentBytes, 'number')
  assert.equal(typeof s.status().limits.diffLines, 'number')
})

// --- real filesystem ------------------------------------------------------------------------------
test('against a REAL file on disk: coalesced edits, then a refused reject after an external change', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-review-'))
  const f = path.join(dir, 'target.txt')
  fs.writeFileSync(f, 'alpha\nbeta\n')
  const s = createDiffReviewStore({ mode: 'hooks' }) // real node:fs

  const snap = s.snapshot(f, fs.readFileSync(f, 'utf8'))
  fs.writeFileSync(f, 'alpha\nBETA\n'); s.recordEdit(f, fs.readFileSync(f, 'utf8'))
  fs.writeFileSync(f, 'alpha\nBETA\ngamma\n'); s.recordEdit(f, fs.readFileSync(f, 'utf8'))
  assert.equal(s.listPending().length, 1)

  // someone else touches the file after the diff was captured
  fs.appendFileSync(f, 'delta\n')
  const refused = s.reject(snap.reviewId)
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'changed-since-snapshot')
  assert.equal(fs.readFileSync(f, 'utf8'), 'alpha\nBETA\ngamma\ndelta\n')

  // re-sync the review to the current disk state, then reject for real
  s.recordEdit(f, fs.readFileSync(f, 'utf8'))
  const done = s.reject(snap.reviewId)
  assert.equal(done.ok, true)
  assert.equal(fs.readFileSync(f, 'utf8'), 'alpha\nbeta\n')
  fs.rmSync(dir, { recursive: true, force: true })
})
