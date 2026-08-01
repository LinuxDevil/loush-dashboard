import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validId, runPaths, researchView, sseFrames, readReportCapped, evictableIds } from '../../server/research.mjs'
import { createRun, emit } from '../../lib/chat-protocol.mjs'

const tmpFile = (name, contents) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-test-'))
  const file = path.join(dir, name)
  fs.writeFileSync(file, contents)
  return file
}

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

test('an oversized report is read bounded and says it was truncated', () => {
  const file = tmpFile('report.md', 'x'.repeat(500))

  const whole = readReportCapped(file, 500)
  assert.equal(whole.truncated, false, 'exactly at the cap is not truncated')
  assert.equal(whole.report.length, 500)
  assert.equal(whole.bytes, 500)

  const clipped = readReportCapped(file, 100)
  // The flag is the point: a silently clipped report reads as a complete one.
  assert.equal(clipped.truncated, true)
  assert.equal(clipped.report.length, 100, 'no more than the cap is ever returned')
  assert.equal(clipped.bytes, 500, 'the real size on disk is still reported')
})

test('a report that does not exist is empty rather than an error', () => {
  const r = readReportCapped(path.join(os.tmpdir(), 'research-test-nope', 'report.md'))
  assert.deepEqual(r, { report: '', truncated: false, bytes: 0 })
})

test('the byte cap does not leave a half-decoded character at the end', () => {
  // 'é' is two bytes, so a 3-byte cap lands inside the second one.
  const file = tmpFile('report.md', 'ééé')
  const r = readReportCapped(file, 3)
  assert.equal(r.truncated, true)
  assert.equal(r.report, 'é', 'the split character is dropped, not shown as U+FFFD')
})

test('a finished run whose child is still alive is never evicted', () => {
  const at = i => new Date(1e12 + i * 1000).toISOString()
  const run = (i, over) => ({ id: 'r' + i, at: at(i), status: 'cancelled', listeners: new Set(), child: null, ...over })

  // The failure mode this guards: cancel force-finishes a run whose child ignored SIGTERM, eviction
  // then drops it from the map, and nothing holds the handle — the child can never be killed again.
  const zombie = run(0, { child: { alive: true } })
  const ids = evictableIds([zombie, run(1), run(2), run(3)], 1)
  assert.ok(!ids.includes('r0'), 'a live child pins its run in the map')
  assert.deepEqual(ids, ['r1', 'r2'], 'the oldest evictable ones go, newest kept')

  // A dead child is no reason to keep it, and a running run is not a candidate at all.
  assert.deepEqual(evictableIds([run(0, { child: { alive: false } }), run(1)], 1), ['r0'])
  assert.deepEqual(evictableIds([run(0, { status: 'running' }), run(1), run(2)], 1), ['r1'])
  // An attached listener also pins a run: evicting it would cut a client mid-replay.
  assert.deepEqual(evictableIds([run(0, { listeners: new Set([{}]) }), run(1)], 1), [])
  // Nothing to do below the keep threshold.
  assert.deepEqual(evictableIds([run(0), run(1)], 20), [])
})
