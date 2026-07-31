import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { validId, runPaths, researchView, sseFrames } from '../../server/research.mjs'
import { createRun, emit } from '../../lib/chat-protocol.mjs'

test('an id that is not one we would mint never reaches a path', () => {
  const bad = ['../../etc/passwd', '..', '.', 'a/../b', 'abc/def', 'ABCDEF', 'abcd', 'a'.repeat(13), 'abc-def', 'abc def', '', null, undefined, 'report.md']
  for (const id of bad) {
    assert.equal(validId(id), false, `should reject ${JSON.stringify(id)}`)
    assert.equal(runPaths(id), null, `should refuse a path for ${JSON.stringify(id)}`)
  }
})

test('a valid id resolves to a directory under the research root, never above it', () => {
  const p = runPaths('a1b2c3d4e5')
  assert.ok(p, 'a 10-char hex id is valid')
  assert.equal(path.basename(p.dir), 'a1b2c3d4e5')
  assert.equal(p.report, path.join(p.dir, 'report.md'))
  assert.equal(p.meta, path.join(p.dir, 'meta.json'))
  // Traversal cannot survive the join because the id could not contain a separator.
  assert.ok(!path.relative(path.dirname(p.dir), p.dir).startsWith('..'))
})

test('a cancelled run is not reported done', () => {
  // The failure mode: a run stopped halfway whose report the user then trusts as finished.
  const cancelled = researchView({ id: 'aabbccddee', question: 'q', at: new Date().toISOString(), status: 'cancelled', reportBytes: 4096 })
  assert.equal(cancelled.done, false)
  assert.equal(cancelled.running, false)
  assert.equal(cancelled.status, 'cancelled')

  for (const status of ['running', 'error', 'interrupted']) {
    assert.equal(researchView({ status, reportBytes: 9999 }).done, false, `${status} must not be done`)
  }
  assert.equal(researchView({ status: 'done', reportBytes: 10 }).done, true)
  assert.equal(researchView({ status: 'running' }).running, true)
})

test('fromSeq replay returns only the frames after the given seq', () => {
  const run = createRun('aabbccddee', { bufferSize: 50 })
  for (let i = 0; i < 5; i++) emit(run, 'event', { i })

  const { gap, frames } = sseFrames(run, 3)
  assert.equal(gap, null)
  assert.deepEqual(frames.map(f => f.seq), [4, 5])

  // Absent or junk fromSeq is a first connection: it wants the whole retained log, not an error.
  for (const raw of [undefined, null, '', 'abc', '0', '-4']) {
    const r = sseFrames(run, raw)
    assert.equal(r.gap, null, `${JSON.stringify(raw)} should not be a gap`)
    assert.deepEqual(r.frames.map(f => f.seq), [1, 2, 3, 4, 5], `${JSON.stringify(raw)} should replay everything`)
  }

  // Caught up: nothing owed, and still no gap.
  assert.deepEqual(sseFrames(run, 5), { gap: null, frames: [] })
})

test('a gap the buffer can no longer serve is reported instead of a truncated tail', () => {
  const run = createRun('aabbccddee', { bufferSize: 3 })
  for (let i = 0; i < 6; i++) emit(run, 'event', { i })   // buffer now holds seq 4,5,6

  const { gap, frames } = sseFrames(run, 1)               // needs seq 2, which is gone
  assert.ok(gap, 'the client must be told the gap cannot be served')
  assert.equal(gap.kind, 'gap')
  assert.equal(gap.payload.earliestSeq, 4)
  assert.equal(gap.payload.requestedFrom, 1)
  assert.equal(gap.payload.dropped, 3)
  assert.deepEqual(frames.map(f => f.seq), [4, 5, 6])
})
