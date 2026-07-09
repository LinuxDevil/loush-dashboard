import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeAllocation } from '../career-allocation.mjs'

test('interrupt-skewed sessions yield high actual.opsInterrupts', () => {
  const sessions = [
    { user_interruptions: 5 }, { user_interruptions: 4 }, { user_interruptions: 3 },
    { user_interruptions: 0 },
  ]
  const r = computeAllocation({ sessions })
  assert.ok(r.actual.opsInterrupts >= 75, `expected high ops, got ${r.actual.opsInterrupts}`)
  assert.equal(r.actual.deepWork, 25)
})

test('drift warns when a bucket is under half its target; reviews fold in GitHub footprint', () => {
  const sessions = [{ user_interruptions: 0 }, { user_interruptions: 0 }]     // 2 deep-work
  const github = { reviewFootprint: { prsReviewed: 2 } }                       // 2 review units
  const target = { deepWork: 40, reviewsMentorship: 20, designStrategy: 20, opsInterrupts: 20 }
  const r = computeAllocation({ sessions, github, target })
  assert.equal(r.actual.reviewsMentorship, 50)   // 2 of 4 units
  assert.equal(r.drift.designStrategy.warn, true) // 0% actual vs 20% target
  assert.equal(r.drift.deepWork.warn, false)
})
