import test from 'node:test'
import assert from 'node:assert/strict'
import { convergenceVerdict } from '../../server/board.mjs'

// The stop condition used to be "three fix runs, then block", which gives the same answer for a
// loop that is closing in and one going round in circles. AIR-10733 was the second kind: findings
// 9 → 8 → 9, worst severity critical → high → high, $18.84 spent, and nothing in the system could
// say so. These cases pin the difference.

const f = (severity, over = {}) => ({ severity, class: 'code', status: 'open', summary: 's', seenCount: 1, ...over })
const round = (worst, open) => ({ worst, open })

test('no blocking findings advances, and says what was left behind', () => {
  const v = convergenceVerdict({ rounds: [round(3, 5)], blocking: [], openCode: [f('low'), f('low')], spend: 5, budget: 0 })
  assert.equal(v.action, 'advance')
  assert.match(v.reason, /2 minor/)
})

test('a blocking finding on the first round asks for a fix, not a stop', () => {
  const v = convergenceVerdict({ rounds: [], blocking: [f('critical')], openCode: [f('critical')], spend: 1, budget: 0 })
  assert.equal(v.action, 'fix')
})

test('improving severity keeps going even after several rounds', () => {
  // critical → high → medium: each round strictly better, so it must not be called stalled.
  const v = convergenceVerdict({
    rounds: [round(4, 9), round(3, 8), round(2, 6)],
    blocking: [f('medium')], openCode: [f('medium'), f('low')], spend: 10, budget: 0,
  })
  assert.equal(v.action, 'fix', 'severity falling every round is progress')
})

test('a falling count keeps going even when severity is stuck', () => {
  const v = convergenceVerdict({
    rounds: [round(3, 9), round(3, 7), round(3, 5)],
    blocking: [f('high')], openCode: [f('high'), f('low')], spend: 10, budget: 0,
  })
  assert.equal(v.action, 'fix', 'fewer findings at the same severity is still progress')
})

test('the real AIR-10733 trajectory is called stalled', () => {
  // 9 open / worst critical, then 8 / high, then 9 / high — neither measure improving. The open
  // list has to match what the rounds recorded, or the case is not the trajectory it claims to be.
  const blocking = [f('high', { seenCount: 3 }), f('high', { seenCount: 3 }), f('high', { seenCount: 2 })]
  const openCode = [...blocking, ...Array.from({ length: 6 }, () => f('low'))]
  assert.equal(openCode.length, 9, 'this case is only meaningful if it matches the recorded rounds')
  const v = convergenceVerdict({
    rounds: [round(4, 9), round(3, 8), round(3, 9)],
    blocking, openCode, spend: 18.84, budget: 0,
  })
  assert.equal(v.action, 'stalled')
  assert.match(v.reason, /raised 3\+ times/, 'the repeat count is the evidence a human is needed')
})

test('the cost cap stops the loop before the next run, not after', () => {
  const v = convergenceVerdict({ rounds: [round(4, 2)], blocking: [f('critical')], openCode: [f('critical')], spend: 25, budget: 20 })
  assert.equal(v.action, 'budget')
  assert.match(v.reason, /\$25\.00 .* \$20\.00/)
})

test('the cost cap outranks everything, including a clean review', () => {
  const v = convergenceVerdict({ rounds: [], blocking: [], openCode: [], spend: 30, budget: 20 })
  assert.equal(v.action, 'budget', 'spend is checked first so a runaway ticket cannot slip through on a clean round')
})

test('an absolute round ceiling still applies when each round looks like progress', () => {
  const v = convergenceVerdict({
    rounds: [round(4, 9), round(3, 8), round(2, 7), round(2, 6), round(2, 5)],
    blocking: [f('medium')], openCode: [f('medium')], spend: 10, budget: 0, maxRounds: 5,
  })
  assert.equal(v.action, 'stalled', 'slow progress forever is still a reason to hand over')
})

test('every verdict carries a reason a human can act on', () => {
  const cases = [
    { rounds: [], blocking: [], openCode: [], spend: 0, budget: 0 },
    { rounds: [], blocking: [f('high')], openCode: [f('high')], spend: 0, budget: 0 },
    { rounds: [round(3, 5), round(3, 5), round(3, 5)], blocking: [f('high')], openCode: [f('high')], spend: 0, budget: 0 },
    { rounds: [], blocking: [f('high')], openCode: [f('high')], spend: 99, budget: 1 },
  ]
  for (const c of cases) {
    const v = convergenceVerdict(c)
    assert.ok(v.reason && v.reason.length > 10, `${v.action} must explain itself`)
  }
})
