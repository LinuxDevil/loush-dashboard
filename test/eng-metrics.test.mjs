// Tests for eng-metrics.mjs. Each block pins the exact failure an audit found — the wrong version
// looked reasonable in every case, which is why none of them were caught by reading the code.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estAccuracy, escapeRateSeries, busFactor, BUS_FACTOR_MIN_TICKETS } from '../lib/eng-metrics.mjs'

const DAY = 86400_000

// ---------------------------------------------------------------- estAccuracy

test('estAccuracy is 100% only for a perfect estimate', () => {
  assert.equal(estAccuracy(5, 5), 100)
  assert.equal(estAccuracy(0.4, 0.4), 100)
})

test('estAccuracy is MONOTONE — the old version scored 10x-early as worse than 2x-late', () => {
  // est = 5 days. Old formula: actual 0.1 -> 51%, actual 10 -> 50%. It rated finishing 50x faster
  // than estimated as barely better than taking twice as long.
  const early = estAccuracy(5, 0.1)
  const late = estAccuracy(5, 10)
  assert.ok(early < late, `being 50x off must score worse than being 2x off (early=${early}, late=${late})`)

  // accuracy must fall monotonically as the estimate gets worse in either direction
  const overshoot = [5, 6, 8, 12, 20].map(a => estAccuracy(5, a))
  for (let i = 1; i < overshoot.length; i++) assert.ok(overshoot[i] < overshoot[i - 1], 'monotone as actual grows')
  const undershoot = [5, 4, 3, 2, 1].map(a => estAccuracy(5, a))
  for (let i = 1; i < undershoot.length; i++) assert.ok(undershoot[i] < undershoot[i - 1], 'monotone as actual shrinks')
})

test('estAccuracy is SYMMETRIC, so inflating an estimate no longer games the OKR', () => {
  // The metric feeds an OKR target of >=85%. Under the old asymmetric formula the reliable way to
  // hit it was to pad estimates: overshoot was punished gently, undershoot hard.
  assert.equal(estAccuracy(5, 10), estAccuracy(10, 5), 'off by 2x scores the same in both directions')
  assert.equal(estAccuracy(2, 8), estAccuracy(8, 2))
})

test('estAccuracy returns null for missing or non-positive inputs', () => {
  for (const [e, a] of [[0, 5], [5, 0], [null, 5], [5, null], [-1, 5], [undefined, undefined]])
    assert.equal(estAccuracy(e, a), null, `estAccuracy(${e}, ${a})`)
})

// ---------------------------------------------------------------- escapeRateSeries

const NOW = Date.parse('2026-07-01T00:00:00Z')
const march = Date.parse('2026-03-10T00:00:00Z')
const april = Date.parse('2026-04-10T00:00:00Z')

test('an escaped bug counts against the month its PARENT shipped, not the month it was filed', () => {
  const r = escapeRateSeries({
    now: NOW,
    shipped: [{ liveAt: march }, { liveAt: march }],           // 2 shipped in March
    bugs: [{ escaped: true, created: april, parentLiveAt: march }], // filed in April, but about March's release
  })
  const m = r.series.find(x => x.month === '2026-03')
  assert.equal(m.shipped, 2)
  assert.equal(m.escaped, 1)
  assert.equal(m.rate, 50, 'the bug belongs to the cohort it escaped from')
  assert.equal(r.series.find(x => x.month === '2026-04'), undefined, 'April had no releases, so it has no rate')
})

test('the >100% case is gone: old bugs against old releases no longer land in a slow month', () => {
  // The scenario the audit named: ship 2 things this month, have 4 old bugs surface.
  const jan = Date.parse('2026-01-10T00:00:00Z')
  const r = escapeRateSeries({
    now: NOW,
    shipped: [{ liveAt: march }, { liveAt: march }, ...Array.from({ length: 20 }, () => ({ liveAt: jan }))],
    bugs: Array.from({ length: 4 }, () => ({ escaped: true, created: march, parentLiveAt: jan })),
  })
  const mar = r.series.find(x => x.month === '2026-03')
  assert.equal(mar.escaped, 0, 'those bugs belong to January')
  assert.equal(mar.rate, 0)
  const janRow = r.series.find(x => x.month === '2026-01')
  assert.equal(janRow.rate, 20, '4 escaped from 20 shipped')
  for (const row of r.series) assert.ok(row.rate == null || row.rate <= 100, 'no month may exceed 100%')
})

test('a team that does not link bugs to parents gets NULL, not a fabricated 0%', () => {
  const r = escapeRateSeries({
    now: NOW,
    shipped: [{ liveAt: march }, { liveAt: march }],
    bugs: [{ escaped: false, created: march, parentLiveAt: null }, { escaped: false, created: march, parentLiveAt: null }],
  })
  assert.equal(r.measurable, false)
  assert.equal(r.linkablePct, 0)
  assert.ok(r.note && /cannot be distinguished/i.test(r.note))
  for (const row of r.series) assert.equal(row.rate, null, 'a good-looking 0% produced by missing data is the worst case')
})

test('a month with no releases has a null rate — nothing could escape from it', () => {
  const r = escapeRateSeries({
    now: NOW,
    shipped: [{ liveAt: march }],
    bugs: [{ escaped: true, created: march, parentLiveAt: march }],
  })
  assert.equal(r.series.find(x => x.month === '2026-03').rate, 100)
})

test('a month too recent for bugs to have surfaced is flagged provisional', () => {
  const now = Date.parse('2026-07-05T00:00:00Z')
  const r = escapeRateSeries({
    now,
    shipped: [{ liveAt: Date.parse('2026-07-02T00:00:00Z') }, { liveAt: march }],
    bugs: [],
    maturityDays: 30,
  })
  assert.equal(r.series.find(x => x.month === '2026-07').provisional, true, 'July released 3 days ago')
  assert.equal(r.series.find(x => x.month === '2026-03').provisional, false)
})

test('escapeRateSeries flags a low-n month rather than presenting it as a rate to act on', () => {
  const r = escapeRateSeries({ now: NOW, shipped: [{ liveAt: march }], bugs: [{ escaped: true, created: march, parentLiveAt: march }] })
  assert.equal(r.series.find(x => x.month === '2026-03').lowN, true)
})

// ---------------------------------------------------------------- busFactor

test('busFactor is NULL below the minimum ticket count — one ticket is not a bus factor', () => {
  // The audit's case: an area with a single ticket has exactly one contributor, so the old
  // `rows.length === 1` test flagged it and would send a manager to "spread knowledge" about it.
  const r = busFactor({ total: 1, rows: [{ name: 'A', share: 100 }] })
  assert.equal(r.busFactor, null)
  assert.equal(r.reason, 'insufficient-data')
  assert.equal(r.minN, BUS_FACTOR_MIN_TICKETS)
})

test('busFactor flags a genuine sole owner once there is enough work to judge', () => {
  const r = busFactor({ total: 12, rows: [{ name: 'A', share: 100 }] })
  assert.equal(r.busFactor, true)
  assert.equal(r.reason, 'sole-contributor')
})

test('busFactor flags a dominant contributor at or above the threshold', () => {
  assert.equal(busFactor({ total: 20, rows: [{ name: 'A', share: 70 }, { name: 'B', share: 30 }] }).busFactor, true)
  assert.equal(busFactor({ total: 20, rows: [{ name: 'A', share: 69 }, { name: 'B', share: 31 }] }).busFactor, false)
})

test('busFactor is false — not null — for a genuinely well-spread area', () => {
  const r = busFactor({ total: 30, rows: [{ name: 'A', share: 40 }, { name: 'B', share: 35 }, { name: 'C', share: 25 }] })
  assert.equal(r.busFactor, false, 'measured and fine is different from not measured')
  assert.equal(r.reason, null)
})

test('busFactor returns null for an area with no contributor rows at all', () => {
  assert.equal(busFactor({ total: 50, rows: [] }).busFactor, null)
})
