// The autopilot's whole risk surface is `nextAction`: it is the thing that decides, without a
// human present, that a ticket should move. Two failure modes matter and neither is visible by
// watching it work — a step it takes that it should not (starting a parent whose children are
// still open, re-running a fix that already ran, shipping past a design check that failed), and a
// step it refuses to take, which just looks like a board that quietly stopped.
//
// So the transitions are asserted directly rather than through the HTTP layer. The endpoints have
// their own guards and are exercised by hand every day; this table is the part nobody clicks.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextAction } from '../../server/autopilot.mjs'

const T = (over = {}) => ({ id: 'tk1', project: '/p', stage: 'backlog', runs: [], findings: [], ...over })
const B = (...tickets) => ({ tickets })

test('backlog: analyze once, then act on what it produced', () => {
  const t = T()
  assert.deepEqual(nextAction(B(t), t), ['analyze', {}])

  const proposed = T({ proposal: [{ title: 'a' }, { title: 'b' }], runs: [{ kind: 'analyze' }] })
  assert.deepEqual(nextAction(B(proposed), proposed), ['breakdown', { subs: proposed.proposal }])

  // Analyze ran and proposed nothing: the ticket is a leaf, not a thing to analyze forever.
  const leaf = T({ runs: [{ kind: 'analyze' }] })
  assert.deepEqual(nextAction(B(leaf), leaf), ['start', {}])
})

test('a parent waits on its children; a sub-ticket starts without being analyzed', () => {
  const parent = T({ id: 'p1', runs: [{ kind: 'analyze' }] })
  const kid = T({ id: 'k1', parent: 'p1' })
  assert.equal(nextAction(B(parent, kid), parent), null)
  assert.deepEqual(nextAction(B(parent, kid), kid), ['start', {}])

  // Released children no longer hold the parent back.
  const done = T({ id: 'k1', parent: 'p1', stage: 'released' })
  assert.deepEqual(nextAction(B(parent, done), parent), ['start', {}])
})

test('the two stops that exist to protect a human decision', () => {
  for (const stage of ['bug-reported', 'ready-for-release', 'released', 'in-progress', 'fixing', 'qa-running']) {
    const t = T({ stage })
    assert.equal(nextAction(B(t), t), null, `${stage} must not be advanced automatically`)
  }
  const blocked = T({ blocked: { reason: 'which variant wins?' } })
  assert.equal(nextAction(B(blocked), blocked), null, 'a question is for a person to answer')

  const bug = T({ type: 'bug', parent: 'p1' })
  assert.equal(nextAction(B(bug), bug), null, 'QA-filed bugs are not picked up unattended')
})

test('code review: findings present means reviewed-and-not-yet-fixed', () => {
  const clean = T({ stage: 'code-review' })
  assert.deepEqual(nextAction(B(clean), clean), ['review', {}])

  const blocking = T({ stage: 'code-review', findings: [{ severity: 'high', summary: 'x' }] })
  assert.deepEqual(nextAction(B(blocking), blocking), ['fix', {}])

  // Minor findings are not worth a fix loop — they go back through review and on.
  const minor = T({ stage: 'code-review', findings: [{ severity: 'low', summary: 'x' }] })
  assert.deepEqual(nextAction(B(minor), minor), ['review', {}])
})

test('design QA runs before functional QA, and only when there is something to compare against', () => {
  const withDesign = T({ stage: 'ready-for-qa', designRefs: { figma: ['https://figma.com/x'] } })
  assert.deepEqual(nextAction(B(withDesign), withDesign), ['designqa', {}])

  const passed = T({ stage: 'ready-for-qa', designRefs: { figma: ['https://figma.com/x'] }, designQa: { pass: true } })
  assert.deepEqual(nextAction(B(passed), passed), ['qa', {}])

  const noDesign = T({ stage: 'ready-for-qa', designRefs: { figma: [], captures: [], contentCsv: null } })
  assert.deepEqual(nextAction(B(noDesign), noDesign), ['qa', {}])

  // A copy deck alone is enough of a design contract to check against.
  const copyOnly = T({ stage: 'ready-for-qa', designRefs: { contentCsv: '/p/docs/AIR-1/content.csv' } })
  assert.deepEqual(nextAction(B(copyOnly), copyOnly), ['designqa', {}])
})
