import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapTicket } from '../server-career.mjs'

const NOW = Date.parse('2026-07-09T00:00:00Z')

test('mapTicket buckets ready-for-qa and qa-running into toTest', () => {
  assert.equal(mapTicket({ id: '1', stage: 'ready-for-qa' }, NOW).bucket, 'toTest')
  assert.equal(mapTicket({ id: '2', stage: 'qa-running' }, NOW).bucket, 'toTest')
})

test('mapTicket buckets in-progress, code-review, fixing into inProgress', () => {
  assert.equal(mapTicket({ id: '3', stage: 'in-progress' }, NOW).bucket, 'inProgress')
  assert.equal(mapTicket({ id: '4', stage: 'code-review' }, NOW).bucket, 'inProgress')
  assert.equal(mapTicket({ id: '5', stage: 'fixing' }, NOW).bucket, 'inProgress')
})

test('mapTicket buckets backlog into pending', () => {
  assert.equal(mapTicket({ id: '6', stage: 'backlog' }, NOW).bucket, 'pending')
})

test('mapTicket buckets unknown stages into pending', () => {
  assert.equal(mapTicket({ id: '7', stage: 'released' }, NOW).bucket, 'pending')
})

test('mapTicket computes ageDays from the last history entry', () => {
  const threeDaysAgo = NOW - 3 * 86400000
  const t = { id: '8', stage: 'backlog', history: [{ at: NOW - 10 * 86400000 }, { at: threeDaysAgo }] }
  assert.equal(mapTicket(t, NOW).ageDays, 3)
})

test('mapTicket defaults ageDays to 0 with no history', () => {
  assert.equal(mapTicket({ id: '9', stage: 'backlog' }, NOW).ageDays, 0)
  assert.equal(mapTicket({ id: '10', stage: 'backlog', history: [] }, NOW).ageDays, 0)
})

test('mapTicket always sets slaDays to 5 and passes through id/project/title', () => {
  const t = mapTicket({ id: '11', stage: 'backlog', project: 'proj', title: 'Ticket Title' }, NOW)
  assert.equal(t.slaDays, 5)
  assert.equal(t.id, '11')
  assert.equal(t.project, 'proj')
  assert.equal(t.title, 'Ticket Title')
})
