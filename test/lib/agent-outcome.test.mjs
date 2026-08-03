import test from 'node:test'
import assert from 'node:assert/strict'
import { unfinishedReason } from '../../lib/agent-outcome.mjs'

// The string below is the real one, copied off the board file: ticket AIR-10733 recorded it as a
// `review` run with status `ok`, and the ticket was promoted to `ready-for-qa` on the strength of
// it. Everything here exists to make that impossible without making the opposite mistake — a false
// positive blocks work that actually happened, which is why the long-review case is asserted too.

const REAL = "You've hit your session limit · resets 4:20am (Asia/Amman)"

test('the real session-limit notice is caught', () => {
  assert.ok(unfinishedReason(REAL, null))
})

test('the reset time survives into the reason — it is the only actionable fact in the notice', () => {
  assert.match(unfinishedReason(REAL, null), /4:20am \(Asia\/Amman\)/)
})

test('other wordings of the same notice are caught', () => {
  for (const s of [
    'Claude usage limit reached. Your limit will reset at 3pm.',
    '5-hour limit reached ∙ resets 9:00pm',
    "You've hit the weekly limit · resets Monday",
  ]) assert.ok(unfinishedReason(s, null), s)
})

test('empty and whitespace-only output are caught', () => {
  for (const s of ['', '   \n\t ', null, undefined]) assert.match(unfinishedReason(s, null), /no output/)
})

test('a caller-reported interruption is carried through verbatim', () => {
  assert.equal(unfinishedReason('partial…', 'stopped (SIGTERM)'), 'stopped (SIGTERM)')
})

test('a long legitimate review that mentions a limit is NOT caught', () => {
  // The false-positive guard. A review is allowed to say "the rate limit handler is untested"
  // without being thrown away — a wrong positive here stalls a ticket whose work really happened.
  const review = 'The pagination change looks right. ' +
    'One concern: the client will hit your session limit handling on retry, and resets 4:20am is hardcoded. '.repeat(20) +
    '[{"severity":"high","class":"code","file":"a.ts","summary":"retry loop ignores the cap"}]'
  assert.ok(review.length > 400)
  assert.equal(unfinishedReason(review, null), null)
})

test('a normal findings result is not caught', () => {
  assert.equal(unfinishedReason('[{"severity":"low","class":"code","file":"a.ts","summary":"nit"}]', null), null)
})

test('a clean short review is not caught', () => {
  assert.equal(unfinishedReason('[]', null), null)
})
