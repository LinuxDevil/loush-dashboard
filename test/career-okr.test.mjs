import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveKrCurrent, hydrateOkrs, krClosed } from '../career-okr.mjs'

test('a KR wired to quality.changeFailProxy reflects the live snapshot value', () => {
  const snap = { quality: { changeFailProxy: 0.12 } }
  assert.equal(resolveKrCurrent({ metricRef: 'quality.changeFailProxy', target: 0.05 }, snap), 0.12)
})

test('an unknown metricRef resolves to null, not a throw', () => {
  assert.equal(resolveKrCurrent({ metricRef: 'nope.missing' }, {}), null)
})

test('a null/absent metricRef resolves to null (manual KR)', () => {
  assert.equal(resolveKrCurrent({ target: 1 }, { a: 1 }), null)
  assert.equal(resolveKrCurrent({ metricRef: '' }, { a: 1 }), null)
})

test('hydrateOkrs fills current from the snapshot, preserving manual current', () => {
  const okrs = [{ id: 'o1', objective: 'Ship quality', quarter: '2026Q3', krs: [
    { id: 'k1', text: 'CFR down', metricRef: 'quality.changeFailProxy', target: 0.05 },
    { id: 'k2', text: 'Manual KR', current: 3, target: 5 },
  ] }]
  const snap = { quality: { changeFailProxy: 0.12 } }
  const out = hydrateOkrs(okrs, snap)
  assert.equal(out[0].krs[0].current, 0.12)   // metric-linked → live
  assert.equal(out[0].krs[1].current, 3)      // manual → preserved
  // original untouched (pure)
  assert.equal(okrs[0].krs[0].current, undefined)
})

test('krClosed emits one outcome XP event keyed by kr id', () => {
  const ev = krClosed({ id: 'k1', text: 'CFR down' })
  assert.equal(ev.type, 'kr')
  assert.equal(ev.id, 'kr:k1')
  assert.ok(ev.xp > 0)
})
