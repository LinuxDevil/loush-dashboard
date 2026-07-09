import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harvestCandidates, distill, evaluateLesson, addLesson, ACTIVE_CAP } from '../career-lessons.mjs'

test('(a) a structured check meeting its target auto-graduates', () => {
  const lesson = { id: 'l1', rule: 'front-load constraints', status: 'active',
    check: { metricRef: 'workflow.frictionRate', comparator: '<=', target: 0.2, window: '30d' } }
  const r = evaluateLesson(lesson, { workflow: { frictionRate: 0.1 } })
  assert.equal(r.status, 'cleared')
  assert.equal(r.graduate, true)
})

test('(b) a free-text check NEVER auto-graduates', () => {
  const lesson = { id: 'l2', rule: 'ask for design review earlier', status: 'active',
    check: { freeText: 'did I request a review before coding?' } }
  const r = evaluateLesson(lesson, { workflow: { frictionRate: 0 } })
  assert.equal(r.graduate, false)
  assert.equal(r.status, 'pending')   // manual-graduate only
})

test('(c) the active cap rejects a 6th active lesson', () => {
  let lessons = []
  for (let i = 0; i < ACTIVE_CAP; i++) lessons = addLesson(lessons, { id: 'a' + i, rule: 'r', status: 'active' }).lessons
  assert.equal(lessons.length, ACTIVE_CAP)
  const res = addLesson(lessons, { id: 'a6', rule: 'one too many', status: 'active' })
  assert.ok(res.error)
  assert.equal(res.lessons.length, ACTIVE_CAP)   // unchanged
})

test('an internalized lesson does not count against the active cap', () => {
  let lessons = []
  for (let i = 0; i < ACTIVE_CAP; i++) lessons = addLesson(lessons, { id: 'g' + i, rule: 'r', status: 'internalized' }).lessons
  const res = addLesson(lessons, { id: 'new', rule: 'still room', status: 'active' })
  assert.ok(!res.error)
})

test('(d) harvest keeps recurring themes and ignores one-offs', () => {
  const cands = harvestCandidates({
    prFindings: [{ theme: 'missing-tests', ref: 'pr:1' }, { theme: 'missing-tests', ref: 'pr:2' }],
    escapedBugs: [{ theme: 'off-by-one', ref: 'bug:9' }],   // one-off → dropped
    ticketAcGaps: [], sessionFriction: [], retros: [],
  })
  const themes = cands.map(c => c.theme)
  assert.ok(themes.includes('missing-tests'))
  assert.ok(!themes.includes('off-by-one'))
  assert.deepEqual(cands.find(c => c.theme === 'missing-tests').evidenceRefs, ['pr:1', 'pr:2'])
})

test('a cleared→recurring flip flags a 1:1', () => {
  const lesson = { id: 'l3', status: 'active', lastStatus: 'cleared',
    check: { metricRef: 'workflow.frictionRate', comparator: '<=', target: 0.2, window: '30d' } }
  const r = evaluateLesson(lesson, { workflow: { frictionRate: 0.5 } })   // regressed
  assert.equal(r.status, 'recurring')
  assert.equal(r.flag1on1, true)
})

test('distill wraps candidates as drafts (never auto-active)', () => {
  const drafts = distill({ candidates: [{ theme: 'missing-tests', evidenceRefs: ['pr:1', 'pr:2'] }],
    runAnalyze: () => ({ situation: 'PRs', pattern: 'skipping tests', rule: 'write test first',
      check: { metricRef: 'quality.changeFailProxy', comparator: '<=', target: 0.1, window: '30d' } }) })
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0].status, 'draft')
  assert.equal(drafts[0].rule, 'write test first')
})
