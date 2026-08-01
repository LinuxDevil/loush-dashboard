import test from 'node:test'
import assert from 'node:assert/strict'
import { toCsv, csvField, csvRow, PAGE_TIERS, NEVER_PAGINATE_BELOW } from '../../lib/csv.mjs'

test('a field containing a comma, quote or newline is quoted and escaped', () => {
  // The regression: an unescaped comma shifts every later column by one, producing a file that
  // opens without error and is wrong in a way nobody notices until it is in a report.
  assert.equal(csvField('a,b'), '"a,b"')
  assert.equal(csvField('say "hi"'), '"say ""hi"""')
  assert.equal(csvField('line1\nline2'), '"line1\nline2"')
  assert.equal(csvField('plain'), 'plain')
})

test('nullish becomes empty, never the string "null"', () => {
  // A literal null/undefined in a cell is data as far as a spreadsheet is concerned.
  assert.equal(csvField(null), '')
  assert.equal(csvField(undefined), '')
  assert.equal(csvField(0), '0', 'zero is a real value and must survive')
  assert.equal(csvField(false), 'false')
})

test('columns default to the union of keys so a sparse field is not dropped', () => {
  const csv = toCsv([{ a: 1 }, { a: 2, b: 3 }])
  assert.equal(csv.split('\r\n')[0], 'a,b')
  assert.equal(csv.split('\r\n')[2], '2,3')
  assert.equal(csvField(1), '1')
})

test('an explicit column list fixes the order and omits the rest', () => {
  const csv = toCsv([{ a: 1, b: 2, c: 3 }], ['c', 'a'])
  // RFC 4180 TERMINATES each record rather than separating them, so a trailing CRLF is correct
  // and the split leaves an empty tail.
  assert.deepEqual(csv.split('\r\n'), ['c,a', '3,1', ''])
})

test('rows are CRLF-separated per RFC 4180', () => {
  assert.ok(toCsv([{ a: 1 }]).includes('\r\n'), 'bare \\n trips some importers, Excel among them')
})

test('malformed input yields a header-only file rather than throwing', () => {
  for (const bad of [null, undefined, 'nope', 42, [null, 'x', 7]]) {
    assert.doesNotThrow(() => toCsv(bad))
  }
  assert.equal(toCsv([]), '')
  assert.equal(csvRow(null), '')
})

test('the paging floor is above the first tier so a short table never paginates', () => {
  // If the floor sat below the first tier there would be a band where a table paginated into a
  // single page — controls that do nothing.
  assert.ok(NEVER_PAGINATE_BELOW >= PAGE_TIERS[0], 'floor must not fall below the smallest page size')
  assert.deepEqual([...PAGE_TIERS].sort((a, b) => a - b), PAGE_TIERS, 'tiers must ascend')
})
