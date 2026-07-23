import { test } from 'node:test'
import assert from 'node:assert/strict'
import { remediationPlan } from '../scheduler.mjs'

test('red main → proposes a git revert scoped to the repo', () => {
  const p = remediationPlan([{ kind: 'ci', key: 'ci:red:tajawal/ct-web-flights', severity: 'error', text: 'main is red' }])
  assert.equal(p.length, 1)
  assert.equal(p[0].verb, 'git-revert')
  assert.equal(p[0].repo, 'tajawal/ct-web-flights')
  assert.match(p[0].action, /revert --no-edit HEAD/)
})

test('hard eval regression (0% → error) → proposes gov-rollback', () => {
  const p = remediationPlan([{ kind: 'eval', id: 'e1', severity: 'error', text: 'eval run at 0% pass' }])
  assert.equal(p.length, 1)
  assert.equal(p[0].verb, 'gov-rollback')
})

test('partial eval dip (warning) proposes nothing — stays propose-nothing', () => {
  assert.equal(remediationPlan([{ kind: 'eval', id: 'e2', severity: 'warning', text: 'eval run at 60% pass' }]).length, 0)
})

test('ignores unrelated inbox kinds', () => {
  assert.equal(remediationPlan([{ kind: 'board', severity: 'info' }, { kind: 'budget', severity: 'warning' }]).length, 0)
})

test('mixed signals produce one proposal each', () => {
  const p = remediationPlan([
    { kind: 'ci', key: 'ci:red:a/b', severity: 'error', text: 'red' },
    { kind: 'eval', id: 'e', severity: 'error', text: '0% pass' },
  ])
  assert.deepEqual(p.map(x => x.verb).sort(), ['git-revert', 'gov-rollback'])
})

test('no signals → empty plan', () => {
  assert.deepEqual(remediationPlan([]), [])
})
