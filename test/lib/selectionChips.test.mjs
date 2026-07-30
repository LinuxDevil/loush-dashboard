import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  safeSerialize, normalizeChip, packChips, chipsToPrompt, chipsForOpenTabs,
  CHIP_TOTAL_CAP_BYTES, CHIP_MAX_COUNT,
} from '../../src/lib/selectionChips.js'

const chip = (over = {}) => ({ id: 'c1', label: 'Selection', includeData: true, data: { a: 1 }, ...over })

// --- serialisation ---------------------------------------------------------

test('a cyclic object does not throw and the cycle is reported', () => {
  const o = { name: 'root' }
  o.self = o
  let r
  assert.doesNotThrow(() => { r = safeSerialize(o) })
  assert.equal(typeof r.text, 'string')
  assert.match(r.text, /cycle/)
  assert.ok(r.dropped.some(d => /cycle/.test(d.why)), 'the strip is recorded, not just substituted')
})

test('a cycle through an array does not throw', () => {
  const a = [1, 2]
  a.push(a)
  assert.doesNotThrow(() => safeSerialize(a))
})

test('a value shared twice is not mistaken for a cycle', () => {
  const shared = { x: 1 }
  const r = safeSerialize({ a: shared, b: shared })
  assert.equal(r.dropped.length, 0)
  assert.deepEqual(JSON.parse(r.text), { a: { x: 1 }, b: { x: 1 } })
})

test('non-JSON values are stripped and each strip is recorded', () => {
  const r = safeSerialize({ fn() {}, sym: Symbol('s'), big: 10n, nan: NaN, inf: Infinity, undef: undefined })
  const whys = r.dropped.map(d => d.path)
  for (const p of ['$.fn', '$.sym', '$.big', '$.nan', '$.inf', '$.undef']) assert.ok(whys.includes(p), `${p} reported`)
  assert.doesNotThrow(() => JSON.parse(r.text))
})

test('a throwing getter is contained, not propagated', () => {
  const o = {}
  Object.defineProperty(o, 'boom', { enumerable: true, get() { throw new Error('nope') } })
  let r
  assert.doesNotThrow(() => { r = safeSerialize(o) })
  assert.ok(r.dropped.some(d => /getter threw/.test(d.why)))
})

test('nesting past the depth limit is truncated with a reason', () => {
  let deep = {}, cur = deep
  for (let i = 0; i < 40; i++) { cur.n = {}; cur = cur.n }
  const r = safeSerialize(deep, { maxDepth: 5 })
  assert.match(r.text, /too deep/)
  assert.ok(r.dropped.some(d => /nesting limit/.test(d.why)))
})

test('Map, Set and Date survive in a readable form', () => {
  const r = safeSerialize({ m: new Map([['k', 1]]), s: new Set([1, 2]), d: new Date(0) })
  const o = JSON.parse(r.text)
  assert.deepEqual(o.m['[Map]'], [['k', 1]])
  assert.deepEqual(o.s['[Set]'], [1, 2])
  assert.equal(o.d, '1970-01-01T00:00:00.000Z')
})

// --- normalisation ---------------------------------------------------------

test('a chip without an id is rejected with a reason', () => {
  const r = normalizeChip({ label: 'x' })
  assert.equal(r.ok, false)
  assert.match(r.reason, /no id/)
})

test('a missing label is stated, not invented from the id', () => {
  const r = normalizeChip({ id: 'abc123' })
  assert.equal(r.chip.label, '(unlabelled selection)')
  assert.ok(!r.chip.label.includes('abc123'))
})

test('includeData is strictly opt-in — a truthy non-true value does not count', () => {
  assert.equal(normalizeChip({ id: 'a', includeData: 'yes' }).chip.includeData, false)
  assert.equal(normalizeChip({ id: 'a', includeData: 1 }).chip.includeData, false)
  assert.equal(normalizeChip({ id: 'a', includeData: true }).chip.includeData, true)
})

test('normalizeChip never throws on garbage', () => {
  for (const bad of [null, undefined, 5, 'x', []]) assert.doesNotThrow(() => normalizeChip(bad))
})

// --- packing ---------------------------------------------------------------

test('data is withheld without includeData, and the chip says so', () => {
  const [c] = packChips([chip({ includeData: false })]).chips
  assert.equal(c.payload, null)
  assert.match(c.note, /data not included/)
})

test('opted-in data is attached and counted', () => {
  const p = packChips([chip()])
  assert.ok(p.chips[0].payload.includes('"a": 1'))
  assert.equal(p.totalBytes, p.chips[0].bytes)
  assert.equal(p.capHit, false)
})

test('the 32 KiB cap truncates AND the chip says how much was lost', () => {
  const big = { blob: 'x'.repeat(60 * 1024) }
  const p = packChips([chip({ data: big })])
  const c = p.chips[0]
  assert.equal(c.truncated, true, 'truncation happened')
  assert.ok(c.bytes <= CHIP_TOTAL_CAP_BYTES, 'the cap was enforced')
  assert.ok(c.truncatedFrom > c.bytes, 'the original size is retained for the message')
  assert.match(c.note, /truncated/)
  assert.equal(p.capHit, true)
  assert.ok(p.notes.some(n => /budget was reached/.test(n)), 'the tray gets a visible note too')
})

test('the cap is a TOTAL across chips — the later chip is the one marked', () => {
  const p = packChips([
    chip({ id: 'a', data: { blob: 'x'.repeat(30 * 1024) } }),
    chip({ id: 'b', data: { blob: 'y'.repeat(30 * 1024) } }),
  ])
  assert.equal(p.chips[0].truncated, false)
  assert.equal(p.chips[1].truncated, true)
  assert.ok(p.totalBytes <= CHIP_TOTAL_CAP_BYTES)
})

test('a truncated payload is never presented as complete in the prompt', () => {
  const p = packChips([chip({ data: { blob: 'x'.repeat(60 * 1024) } })])
  const prompt = chipsToPrompt(p)
  assert.match(prompt, /TRUNCATED/)
  assert.match(prompt, /Do not assume it is complete/)
})

test('the prompt block names stripped values so the model is not misled either', () => {
  const o = { keep: 1 }
  o.loop = o
  const prompt = chipsToPrompt(packChips([chip({ data: o })]))
  assert.match(prompt, /stripped as cyclic or non-JSON-serialisable/)
})

test('packing a cyclic chip does not throw and marks the chip', () => {
  const o = {}
  o.o = o
  let p
  assert.doesNotThrow(() => { p = packChips([chip({ data: o })]) })
  assert.match(p.chips[0].note, /stripped/)
})

test('the chip-count limit is reported and the overflow is named', () => {
  const many = Array.from({ length: CHIP_MAX_COUNT + 3 }, (_, i) => chip({ id: 'c' + i, label: 'sel' + i, includeData: false }))
  const p = packChips(many)
  assert.equal(p.chips.length, CHIP_MAX_COUNT)
  assert.equal(p.overflow.length, 3)
  assert.ok(p.notes.some(n => /chip limit/.test(n)))
})

test('duplicate ids and malformed chips are rejected visibly, not dropped', () => {
  const p = packChips([chip({ id: 'x' }), chip({ id: 'x' }), { nope: true }])
  assert.equal(p.chips.length, 1)
  assert.equal(p.rejected.length, 2)
  assert.ok(p.rejected.every(r => typeof r.reason === 'string' && r.reason.length))
  assert.ok(p.notes.some(n => /not added/.test(n)))
})

test('packChips never throws on garbage input', () => {
  for (const bad of [null, undefined, 5, 'x', [null], [undefined]]) assert.doesNotThrow(() => packChips(bad))
  assert.equal(chipsToPrompt(null), '')
  assert.equal(chipsToPrompt({ chips: [] }), '')
})

test('a chip with no data at all says that, rather than showing an empty payload', () => {
  const [c] = packChips([{ id: 'a', label: 'l', includeData: true }]).chips
  assert.match(c.note, /no structured data/)
})

// --- tab lifecycle ---------------------------------------------------------

test('closing a tab removes its chips and explains the removal', () => {
  const chips = [{ id: '1', label: 'A', tabId: 't1' }, { id: '2', label: 'B', tabId: 't2' }]
  const r = chipsForOpenTabs(chips, ['t2'])
  assert.deepEqual(r.kept.map(c => c.id), ['2'])
  assert.equal(r.removed.length, 1)
  assert.match(r.notice, /editor tab was closed/)
  assert.match(r.notice, /A/)
})

test('chips not owned by any tab survive a tab close, and nothing is reported when nothing went', () => {
  const r = chipsForOpenTabs([{ id: '1', label: 'A' }], [])
  assert.equal(r.kept.length, 1)
  assert.equal(r.notice, null)
})

test('chipsForOpenTabs never throws on garbage', () => {
  for (const bad of [null, undefined, 5, [null]]) assert.doesNotThrow(() => chipsForOpenTabs(bad, bad))
})
