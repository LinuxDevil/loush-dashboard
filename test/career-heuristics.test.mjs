import { test } from 'node:test'
import assert from 'node:assert/strict'
import { focusItems } from '../career-heuristics.mjs'

test('emits quality, workflow, flow and task-risk items and sorts by severity', () => {
  const snap = {
    quality: { changeFailProxy: 0.3, priorChangeFailProxy: 0.1 },
    workflow: { topFriction: 'wrong_approach' },
    flow: { afterHoursPct: 0.5, wip: 2 },
    tasks: [{ id: 'AIR-1', stage: 'in-progress', ageDays: 10, slaDays: 5 }],
  }
  const items = focusItems(snap)
  const areas = items.map(i => i.area)
  assert.ok(areas.includes('quality'))
  assert.ok(areas.includes('workflow'))
  assert.ok(areas.includes('flow'))
  assert.ok(areas.includes('tasks'))
  assert.equal(items[0].severity, 'high')                 // sorted, high first
  assert.ok(items.every(i => i.actedOn === null && i.id))
})

test('quiet snapshot yields no items', () => {
  const items = focusItems({ quality: { changeFailProxy: 0.05, priorChangeFailProxy: 0.05 }, workflow: {}, flow: { afterHoursPct: 0.1, wip: 1 }, tasks: [] })
  assert.equal(items.length, 0)
})
