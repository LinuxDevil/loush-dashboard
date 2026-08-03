import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statusSegments } from '../../server/eng.mjs'

// A QA cycle is a ticket coming BACK OUT of QA to be worked again. Counting entries into QA instead
// scored the ordinary path — Ready for QA → In QA — as two cycles on a ticket QA had not yet
// touched, which put "2 QA cycles" on almost every board card.

const DAY = 864e5
const iso = t => new Date(t).toISOString()
const t0 = Date.parse('2026-06-01T09:00:00.000Z')

/** @param {[string,string][]} moves from → to, one working day apart */
const issue = moves => ({
  fields: { created: iso(t0), status: { name: moves.length ? moves[moves.length - 1][1] : 'To Do' } },
  changelog: {
    histories: moves.map(([from, to], i) => ({
      created: iso(t0 + (i + 1) * DAY),
      author: { displayName: 'Dev' },
      items: [{ field: 'status', fromString: from, toString: to }],
    })),
  },
})

test('the clean path through QA is zero cycles', () => {
  const s = statusSegments(issue([
    ['To Do', 'In Progress'],
    ['In Progress', 'Ready for QA'],
    ['Ready for QA', 'In QA'],
    ['In QA', 'Ready for Release'],
  ]))
  assert.equal(s.qaCycles, 0, 'entering Ready for QA and then In QA is one hand-off, not two cycles')
})

test('each kick-back out of QA is one cycle', () => {
  const s = statusSegments(issue([
    ['To Do', 'In Progress'],
    ['In Progress', 'Ready for QA'],
    ['Ready for QA', 'In QA'],
    ['In QA', 'In Progress'],          // 1 — QA failed it
    ['In Progress', 'Ready for QA'],
    ['Ready for QA', 'In Progress'],   // 2 — pulled back before QA picked it up
    ['In Progress', 'In QA (Dev)'],
    ['In QA (Dev)', 'Reopen'],         // 3 — reopened out of dev QA
    ['Reopen', 'In Progress'],
    ['In Progress', 'Live'],
  ]))
  assert.equal(s.qaCycles, 3)
})

test('statuses that never touched QA never count', () => {
  const s = statusSegments(issue([
    ['To Do', 'In Progress'],
    ['In Progress', 'In Code Review'],
    ['In Code Review', 'In Progress'],
    ['In Progress', 'Live'],
  ]))
  assert.equal(s.qaCycles, 0)
})
