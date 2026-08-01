import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeLineDiff, summariseDiff } from '../../src/lib/lineDiff.js'

test('a missing baseline is a reason, not "every line added"', () => {
  const d = computeLineDiff(null, 'a\nb\nc')
  assert.equal(d.hunks, null)
  assert.equal(d.stats, null)
  assert.match(d.reason, /no baseline/)
})

test('a missing buffer is a reason too', () => {
  const d = computeLineDiff('a', undefined)
  assert.equal(d.hunks, null)
  assert.match(d.reason, /no current content/)
})

test('identical files diff to zero changes', () => {
  const d = computeLineDiff('a\nb\nc', 'a\nb\nc')
  assert.deepEqual(d.stats, { added: 0, removed: 0, unchanged: 3 })
})

test('a one-line edit is one add and one delete', () => {
  const d = computeLineDiff('a\nb\nc', 'a\nB\nc')
  assert.equal(d.stats.added, 1)
  assert.equal(d.stats.removed, 1)
  assert.equal(d.stats.unchanged, 2)
  assert.ok(d.hunks.some(h => h.type === 'add' && h.text === 'B' && h.afterLine === 2))
  assert.ok(d.hunks.some(h => h.type === 'del' && h.text === 'b' && h.beforeLine === 2))
})

test('an insertion keeps the surrounding lines as unchanged', () => {
  const d = computeLineDiff('a\nc', 'a\nb\nc')
  assert.deepEqual(d.stats, { added: 1, removed: 0, unchanged: 2 })
})

test('the line cap is reported, not silently applied', () => {
  const before = Array.from({ length: 50 }, (_, i) => 'l' + i).join('\n')
  const after = before.replace('l0', 'x0')
  const d = computeLineDiff(before, after, { maxLines: 10 })
  assert.ok(d.truncated, 'truncation is on the result')
  assert.equal(d.truncated.limit, 10)
  assert.equal(d.truncated.beforeTotal, 50)
  assert.match(summariseDiff(d), /first 10 lines only/)
})

test('over the cell budget the diff degrades coarsely AND says so', () => {
  const before = Array.from({ length: 40 }, (_, i) => 'a' + i).join('\n')
  const after = Array.from({ length: 40 }, (_, i) => 'b' + i).join('\n')
  const d = computeLineDiff(before, after, { maxCells: 100 })
  assert.ok(d.degraded, 'degradation is reported')
  assert.match(d.degraded.reason, /diff budget/)
  assert.equal(d.stats.added, 40)
  assert.equal(d.stats.removed, 40)
})

test('malformed inputs never throw', () => {
  for (const [a, b] of [[{}, 'x'], [[], []], [0, 1], [NaN, 'y'], [Symbol('s'), 'z']])
    assert.doesNotThrow(() => computeLineDiff(a, b))
  assert.equal(summariseDiff(null), 'no diff available')
  assert.equal(summariseDiff(undefined), 'no diff available')
})

test('empty-string sides are real content, not unknown', () => {
  const d = computeLineDiff('', 'a')
  assert.ok(d.hunks)
  assert.equal(d.stats.added, 1)
})
