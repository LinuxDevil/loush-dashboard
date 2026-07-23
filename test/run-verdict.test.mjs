import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verdictFrom } from '../run-verdict.mjs'

test('awaiting approval → NEEDS-HUMAN (wins over everything)', () => {
  assert.equal(verdictFrom({ awaitingApproval: true, terminalFailed: true }), 'NEEDS-HUMAN')
})

test('terminal failed → BLOCKED', () => {
  assert.equal(verdictFrom({ terminalFailed: true }), 'BLOCKED')
})

test('phase_status failed → BLOCKED', () => {
  assert.equal(verdictFrom({ phaseStatus: 'failed' }), 'BLOCKED')
})

test('retry cap hit (verify ≥ 3) → BLOCKED', () => {
  assert.equal(verdictFrom({ retries: { verify: 3 }, terminalDone: true }), 'BLOCKED')
})

test('resolve-pr uses the higher cap of 5 — 4 retries is not yet a cap hit', () => {
  assert.equal(verdictFrom({ retries: { 'resolve-pr': 4 }, terminalDone: true }), 'PASSING')
  assert.equal(verdictFrom({ retries: { 'resolve-pr': 5 }, terminalDone: true }), 'BLOCKED')
})

test('REQUEST_CHANGES with a blocking finding → BLOCKED', () => {
  assert.equal(verdictFrom({ terminalDone: true, review: { decision: 'REQUEST_CHANGES', findings: [{ severity: 'Required' }] } }), 'BLOCKED')
})

test('REQUEST_CHANGES with only non-blocking findings does not block a done run', () => {
  assert.equal(verdictFrom({ terminalDone: true, review: { decision: 'REQUEST_CHANGES', findings: [{ severity: 'Nit' }, { severity: 'FYI' }] } }), 'PASSING')
})

test('done + clean review → PASSING', () => {
  assert.equal(verdictFrom({ terminalDone: true, review: { decision: 'APPROVE', findings: [] } }), 'PASSING')
  assert.equal(verdictFrom({ phase: 'done' }), 'PASSING')
})

test('still running (no terminal, no failure) → null', () => {
  assert.equal(verdictFrom({ phase: 'implement', phaseStatus: 'running' }), null)
})

test('blocking finding without an explicit REQUEST_CHANGES still withholds PASSING', () => {
  // a done run carrying an unresolved Critical finding must not read as PASSING
  assert.equal(verdictFrom({ terminalDone: true, review: { decision: 'COMMENT', findings: [{ severity: 'Critical' }] } }), null)
})
