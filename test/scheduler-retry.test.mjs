import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextSchedule } from '../scheduler.mjs'

const CAD = 10080 * 60_000 // weekly
const RETRY_DELAY = 5 * 60_000

test('success parks a full cadence and resets attempt', () => {
  const s = nextSchedule({ ok: true, attempt: 1, cadenceMs: CAD, ts: 1000 })
  assert.deepEqual(s, { lastRun: 1000, attempt: 0, retry: 0 })
})

test('first failure schedules a retry ~5 min out, not a full cadence', () => {
  const ts = 1_000_000
  const s = nextSchedule({ ok: false, attempt: 0, cadenceMs: CAD, ts })
  assert.equal(s.attempt, 1)
  assert.equal(s.retry, 1)
  // next tick fires it once (now - lastRun) >= cadence, i.e. after RETRY_DELAY
  assert.equal(ts - s.lastRun, CAD - RETRY_DELAY)
})

test('retries stop at maxRetries, then park full cadence', () => {
  const s = nextSchedule({ ok: false, attempt: 2, maxRetries: 2, cadenceMs: CAD, ts: 5000 })
  assert.deepEqual(s, { lastRun: 5000, attempt: 0, retry: 0 })
})

test('maxRetries override is honored', () => {
  assert.equal(nextSchedule({ ok: false, attempt: 0, maxRetries: 0, cadenceMs: CAD, ts: 1 }).retry, 0)
  assert.equal(nextSchedule({ ok: false, attempt: 4, maxRetries: 5, cadenceMs: CAD, ts: 1 }).retry, 5)
})
