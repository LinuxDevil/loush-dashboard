// Tests for ci-cost.mjs. The execution file comes off a CI runner we do not control, so most of
// these are about malformed input arriving as a reason instead of an exception or a fake $0.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ingestExecutionFile, parseExecutionJson, extractEvents, summarizeRuns } from '../../lib/ci-cost.mjs'

const result = (over = {}) => ({ type: 'result', subtype: 'success', is_error: false, duration_ms: 12345, num_turns: 7, total_cost_usd: 0.42, session_id: 's1', ...over })
const file = (...events) => JSON.stringify([{ type: 'system', subtype: 'init' }, { type: 'assistant' }, ...events])

// ---------------------------------------------------------------- happy path + shapes

test('a top-level array with one result yields a verified cost', () => {
  const r = ingestExecutionFile(file(result()))
  assert.equal(r.ok, true)
  assert.equal(r.cost, 0.42)
  assert.equal(r.verified, true)
  assert.equal(r.durationMs, 12345)
  assert.equal(r.shape, 'top-level-array')
  assert.equal(r.numTurns, 7)
  assert.match(r.basis, /observed/, 'a reported invoice figure must be labelled as observed, not modelled')
})

test('the {events:[...]} envelope is handled as well as the bare array', () => {
  const r = ingestExecutionFile(JSON.stringify({ events: [result({ total_cost_usd: 1.5 })] }))
  assert.equal(r.ok, true)
  assert.equal(r.cost, 1.5)
  assert.equal(r.shape, 'events-envelope')
})

test('an already-parsed object is accepted without re-stringifying', () => {
  assert.equal(ingestExecutionFile([result()]).cost, 0.42)
})

// ---------------------------------------------------------------- unknown is not zero

test('no result element reports itself and does NOT report $0', () => {
  const r = ingestExecutionFile(file())
  assert.equal(r.reason, 'no-result-element')
  assert.equal(r.cost, null)
  assert.equal(r.verified, false)
  assert.notEqual(r.cost, 0, 'a run whose cost we could not read is not a free run')
  assert.equal(r.eventCount, 2, 'we still say how much of the file we looked at')
})

test('a result element with no total_cost_usd is UNKNOWN, not zero', () => {
  const noField = result()
  delete noField.total_cost_usd
  const r = ingestExecutionFile(file(noField))
  assert.equal(r.ok, true, 'the file itself was fine')
  assert.equal(r.cost, null)
  assert.equal(r.verified, false)
  assert.equal(r.reason, 'no-total_cost_usd-field')
  // duration survived independently — one unknown field does not void the others.
  assert.equal(r.durationMs, 12345)
})

test('a null, non-numeric or negative total_cost_usd is unknown with a distinguishing reason', () => {
  assert.equal(ingestExecutionFile(file(result({ total_cost_usd: null }))).reason, 'total_cost_usd-is-null')
  assert.equal(ingestExecutionFile(file(result({ total_cost_usd: '0.42' }))).reason, 'total_cost_usd-not-a-number:string')
  assert.equal(ingestExecutionFile(file(result({ total_cost_usd: -1 }))).reason, 'total_cost_usd-negative')
  for (const bad of [null, '0.42', -1]) {
    assert.equal(ingestExecutionFile(file(result({ total_cost_usd: bad }))).cost, null)
    assert.equal(ingestExecutionFile(file(result({ total_cost_usd: bad }))).verified, false)
  }
})

test('a genuinely free run is verified at 0 — that is different from unreadable', () => {
  const r = ingestExecutionFile(file(result({ total_cost_usd: 0 })))
  assert.equal(r.cost, 0)
  assert.equal(r.verified, true, 'an observed zero is a measurement and must not be demoted to unknown')
})

test('a missing duration_ms is null with its own reason and does not void the cost', () => {
  const noDur = result()
  delete noDur.duration_ms
  const r = ingestExecutionFile(file(noDur))
  assert.equal(r.cost, 0.42)
  assert.equal(r.verified, true)
  assert.equal(r.durationMs, null)
  assert.equal(r.results[0].durationReason, 'no-duration_ms-field')
})

// ---------------------------------------------------------------- never throw

test('malformed input never throws — every case returns {ok:false, reason}', () => {
  const cases = [
    ['', 'empty-input'], [null, 'empty-input'], ['   ', 'empty-input'],
    ['{not json', 'invalid-json'], ['[{"type":"result"', 'truncated-json'],
    ['"a string"', 'unrecognised-shape'], ['42', 'unrecognised-shape'],
    ['{"events":"nope"}', 'events-field-is-not-an-array'],
    [12345, 'unsupported-input-type:number'],
  ]
  for (const [input, reason] of cases) {
    const r = ingestExecutionFile(input)
    assert.equal(r.ok, false, `${JSON.stringify(input)} must not be ok`)
    assert.equal(r.reason, reason, `reason for ${JSON.stringify(input)}`)
    assert.equal(r.cost, null)
    assert.equal(r.verified, false)
  }
})

test('a truncated artifact is named as truncated, which is the actionable finding', () => {
  const r = ingestExecutionFile('[{"type":"result","total_cost_usd":0.4')
  assert.equal(r.reason, 'truncated-json')
  assert.ok(r.detail, 'the parser message is kept for debugging')
})

test('junk elements inside a valid array are skipped without killing the ingest', () => {
  const r = ingestExecutionFile(JSON.stringify([null, 'str', 42, { type: 'result', total_cost_usd: 2 }]))
  assert.equal(r.ok, true)
  assert.equal(r.cost, 2)
})

// ---------------------------------------------------------------- multiple results

test('multiple result elements: all reported, one chosen, and the rule stated', () => {
  const r = ingestExecutionFile(file(result({ total_cost_usd: 1 }), { type: 'assistant' }, result({ total_cost_usd: 3 })))
  assert.equal(r.resultCount, 2)
  assert.equal(r.results.length, 2, 'every candidate is reported, not just the winner')
  assert.deepEqual(r.results.map(x => x.cost), [1, 3])
  assert.equal(r.cost, 3, 'the last result element is the run outcome')

  const b = r.bounds.find(x => x.bound === 'multiple-result-elements')
  assert.ok(b, 'choosing among candidates is a decision and must be reported')
  assert.match(b.why, /last result element/i)
  assert.match(b.effect, /NOT summed/, 'the reader must know the other costs were not added in')
  assert.notEqual(r.cost, 4, 'costs from separate result elements are never summed')
})

test('the chosen result can itself be unverified while earlier ones were fine', () => {
  const noField = result({ total_cost_usd: undefined })
  delete noField.total_cost_usd
  const r = ingestExecutionFile(file(result({ total_cost_usd: 1 }), noField))
  assert.equal(r.cost, null, 'we do not fall back to an earlier result to manufacture a number')
  assert.equal(r.verified, false)
  assert.equal(r.results[0].cost, 1, 'but the readable one is still visible for a human to judge')
})

// ---------------------------------------------------------------- bounds are reported

test('a maxEvents cap that actually bites is published in bounds', () => {
  const events = [{ type: 'assistant' }, { type: 'assistant' }, result()]
  const r = ingestExecutionFile(JSON.stringify(events), { maxEvents: 2 })
  assert.equal(r.reason, 'no-result-element')
  const b = r.bounds.find(x => x.bound === 'maxEvents')
  assert.ok(b, 'a truncated scan that hid the result element must say so')
  assert.equal(b.total, 3)
  assert.equal(b.scanned, 2)
  // Without the bound this output is indistinguishable from a file that has no result at all.
  assert.match(b.effect, /not scanned/)
})

test('a cap that does not bite adds no bound', () => {
  const r = ingestExecutionFile(file(result()), { maxEvents: 500 })
  assert.equal(r.bounds.length, 0)
  assert.equal(r.cost, 0.42)
})

// ---------------------------------------------------------------- helpers

test('parseExecutionJson and extractEvents are independently usable and total', () => {
  assert.equal(parseExecutionJson('[]').ok, true)
  assert.equal(extractEvents([]).shape, 'top-level-array')
  assert.equal(extractEvents({}).ok, false)
})

// ---------------------------------------------------------------- summarizeRuns

test('summarizeRuns totals only verified runs and says the total is partial', () => {
  const runs = [
    ingestExecutionFile(file(result({ total_cost_usd: 1 }))),
    ingestExecutionFile(file(result({ total_cost_usd: 2 }))),
    ingestExecutionFile(file()),                                  // no result element
    ingestExecutionFile('{broken'),                               // unparseable
  ]
  const s = summarizeRuns(runs)
  assert.equal(s.runs, 4)
  assert.equal(s.verifiedRuns, 2)
  assert.equal(s.unverifiedRuns, 2)
  assert.equal(s.usd, 3, 'the two unreadable runs contribute nothing and are not treated as $0')
  assert.equal(s.complete, false)
  assert.equal(s.coverage, 0.5)
  assert.match(s.basis, /verified runs only/)
  assert.deepEqual(s.unverifiedReasons, { 'no-result-element': 1, 'invalid-json': 1 })
})

test('summarizeRuns over nothing is null, not $0.00', () => {
  const s = summarizeRuns([])
  assert.equal(s.usd, null)
  assert.equal(s.complete, false)
  assert.equal(s.coverage, null)
})

test('summarizeRuns marks a fully-verified set complete', () => {
  const s = summarizeRuns([ingestExecutionFile(file(result({ total_cost_usd: 1 })))])
  assert.equal(s.complete, true)
  assert.equal(s.usd, 1)
  assert.equal(s.totalDurationMs, 12345)
  assert.equal(s.durationCoverage, 1)
})
