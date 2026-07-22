import { test } from 'node:test'
import assert from 'node:assert/strict'
import { metricsFor, ranker, buildRadars } from '../src/eng/memberMetrics.mjs'

const WIN = { from: 0, to: 1e15, label: 'all' }
const iso = t => new Date(t).toISOString()

// three devs, one window. A ships fast & clean, B ships slow with rework, C has nothing shipped.
const issues = [
  { key: 'X-1', assignee: { id: 'A' }, live: true, liveAt: iso(1000), delivery: 2, rework: 0, estAcc: 90, prNums: [1], pts: 3 },
  { key: 'X-2', assignee: { id: 'A' }, live: true, liveAt: iso(2000), delivery: 3, rework: 0, estAcc: 80, prNums: [], pts: 2 },
  { key: 'X-3', assignee: { id: 'B' }, live: true, liveAt: iso(3000), delivery: 9, rework: 1, estAcc: 40, prNums: [], pts: 5 },
  { key: 'X-4', assignee: { id: 'B' }, active: true, live: false, rec: { atRisk: true }, sprint: { state: 'active' } },
  { key: 'X-5', assignee: { id: 'C' }, active: true, live: false, sprints: [{ state: 'future' }] },
  { key: 'BUG-1', isBug: true, ownerId: 'B', created: iso(500), assignee: { id: 'B' } },
]
const prs = [{ num: 1, state: 'Merged', mergedAt: iso(1000), mergeDays: 1 }]

test('metricsFor scopes counts to the window and attributes honestly', () => {
  const a = metricsFor('A', issues, prs, WIN)
  assert.equal(a.shipped.length, 2)
  assert.equal(a.pts, 5)
  assert.equal(a.reworkRate, 0)
  assert.equal(a.merged.length, 1)
  assert.equal(a.lowN, true) // 2 < MIN_N

  const b = metricsFor('B', issues, prs, WIN)
  assert.equal(b.bugs.length, 1)             // owns BUG-1
  assert.equal(b.atRisk.length, 1)
  assert.equal(b.focus.length, 1)            // X-4 is in the active sprint, unfinished
  assert.equal(b.reworkRate, 1)

  const c = metricsFor('C', issues, prs, WIN)
  assert.equal(c.shipped.length, 0)
  assert.equal(c.cyc.p50, null)              // no shipped → null, never 0
  assert.equal(c.focus.length, 1)            // X-5 active
})

test('window excludes work outside [from,to]', () => {
  const past = metricsFor('A', issues, prs, { from: 1e14, to: 1e15, label: 'later' })
  assert.equal(past.shipped.length, 0)       // A shipped at t=1000/2000, before the window
})

test('ranker: faster cycle ranks higher; members without data are excluded', () => {
  const rows = metricsFor // silence
  const M = ['A', 'B', 'C'].map(id => metricsFor(id, issues, prs, WIN))
  const speed = ranker(M, m => m.cyc.p50, false) // lower is better
  assert.ok(speed('A').pct > speed('B').pct)     // A (2.5d p50) beats B (9d)
  assert.equal(speed('C').has, false)            // C has no cycle data → excluded from this axis
})

test('buildRadars returns one axis set per member with pct in [0,1] or null', () => {
  const M = ['A', 'B', 'C'].map(id => metricsFor(id, issues, prs, WIN))
  const r = buildRadars(M)
  assert.equal(Object.keys(r).length, 3)
  for (const axis of r.A) assert.ok(axis.pct === null || (axis.pct >= 0 && axis.pct <= 1))
  const tp = r.A.find(a => a.key === 'throughput')
  assert.ok(tp.pct >= 0.5) // A ships the most → at or above median
})
