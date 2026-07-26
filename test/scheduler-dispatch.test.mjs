import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dispatchPlan } from '../lib/scheduler.mjs'

const T = [
  { id: 'a', stage: 'backlog', project: '/p1' },
  { id: 'b', stage: 'backlog', project: '/p2' },
  { id: 'c', stage: 'in-progress', project: '/p1' },
  { id: 'd', stage: 'backlog', project: '/p1', blocked: { by: 'x' } },
]

test('takes up to max tickets in the trigger stage, skips blocked + other stages', () => {
  const p = dispatchPlan({ tickets: T, stage: 'backlog', max: 5 })
  assert.deepEqual(p, { held: null, ids: ['a', 'b'] }) // c (wrong stage) + d (blocked) excluded
})

test('maxDispatch caps per tick', () => {
  assert.deepEqual(dispatchPlan({ tickets: T, stage: 'backlog', max: 1 }).ids, ['a'])
})

test('project filter narrows candidates', () => {
  assert.deepEqual(dispatchPlan({ tickets: T, stage: 'backlog', max: 5, project: '/p2' }).ids, ['b'])
})

test('cost ceiling HALTS dispatch when today >= ceiling', () => {
  const p = dispatchPlan({ tickets: T, stage: 'backlog', max: 5, todayUSD: 12, ceiling: 10 })
  assert.equal(p.ids.length, 0)
  assert.match(p.held, /cost ceiling/)
})

test('under the ceiling dispatches normally', () => {
  assert.deepEqual(dispatchPlan({ tickets: T, stage: 'backlog', max: 5, todayUSD: 3, ceiling: 10 }).ids, ['a', 'b'])
})

test('max defaults to 1', () => {
  assert.equal(dispatchPlan({ tickets: T, stage: 'backlog' }).ids.length, 1)
})
