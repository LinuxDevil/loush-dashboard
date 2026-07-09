import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveIdentity } from '../career-identity.mjs'
import { attributeBugs, attributeBugsWithBlame } from '../career-attribution.mjs'

const resolved = resolveIdentity({ gitEmails: ['ali@work.com'] })

test('attributes escaped bugs by ticket-branch and culprit; buckets unattributable', () => {
  const bugs = [
    { id: 'b1', ticketAuthorEmail: 'ali@work.com' },
    { id: 'b2', culpritAuthorEmail: 'ALI@WORK.COM' },
    { id: 'b3', culpritAuthorEmail: 'someone@else.com' },
  ]
  const r = attributeBugs({ bugs, findings: [], myPrCount: 4, reverts: 0, resolved })
  assert.deepEqual(r.attributed.map(a => a.id).sort(), ['b1', 'b2'])
  assert.deepEqual(r.unattributed.map(a => a.id), ['b3'])
  assert.equal(r.changeFailProxy, 2 / 4)
})

test('review findings NEVER move the change-fail proxy', () => {
  const findings = [
    { id: 'f1', severity: 'warning', diffAuthorEmail: 'ali@work.com' },
    { id: 'f2', severity: 'info', diffAuthorEmail: 'ali@work.com' },   // below threshold, ignored
    { id: 'f3', severity: 'error', diffAuthorEmail: 'other@x.com' },   // not mine
  ]
  const r = attributeBugs({ bugs: [], findings, myPrCount: 2, reverts: 0, resolved })
  assert.equal(r.changeFailProxy, 0)                       // findings excluded
  assert.equal(r.caughtInReview.length, 1)                 // only f1
  assert.equal(r.defectDensityCaughtInReview, 1 / 2)
})

test('blame attribution: introducing author (pure data) attributes; review findings stay separate', () => {
  const bugs = [
    { id: 'b1', introducingAuthorEmail: 'ali@work.com' },        // I introduced the fixed lines → mine
    { id: 'b2', introducingAuthorEmail: 'someone@else.com' },     // coworker introduced → unattributed
    { id: 'b3', ticketAuthorEmail: 'ali@work.com' },              // falls back to Phase-1 rule
  ]
  const findings = [{ id: 'f1', severity: 'error', diffAuthorEmail: 'ali@work.com' }]
  const r = attributeBugsWithBlame({ bugs, findings, myPrCount: 4, reverts: 0, resolved })
  assert.deepEqual(r.attributed.map(a => a.id).sort(), ['b1', 'b3'])
  assert.equal(r.attributed.find(a => a.id === 'b1').rule, 'blame')
  assert.deepEqual(r.unattributed.map(a => a.id), ['b2'])
  assert.equal(r.changeFailProxy, 2 / 4)                          // b1 + b3, findings excluded
  assert.equal(r.caughtInReview.length, 1)                        // review finding on a separate axis
})

test('empty identity attributes nothing', () => {
  const r = attributeBugs({ bugs: [{ id: 'b1', culpritAuthorEmail: 'ali@work.com' }], findings: [], myPrCount: 1, reverts: 0, resolved: resolveIdentity({ gitEmails: [] }) })
  assert.equal(r.attributed.length, 0)
  assert.equal(r.unattributed.length, 1)
})
