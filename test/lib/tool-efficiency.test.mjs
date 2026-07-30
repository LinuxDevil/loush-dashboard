// Tests for tool-efficiency.mjs. The point of this module is the THIRD outcome — a tool call with
// no result is neither a success nor a failure — so most of these pin that it stays separate and
// that every rate ships with the denominator needed to check it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { toolEfficiency, extractToolCalls, resultSize, MIN_SAMPLE } from '../../lib/tool-efficiency.mjs'
import { findTranscripts, readTranscript } from '../../lib/transcript-records.mjs'

let clock = 0
const at = n => new Date(1770000000000 + n * 1000).toISOString()

// assistant turn issuing tool calls; `out` is the message's output_tokens
const asst = (uses, { out = null, ts = at(clock++) } = {}) => ({
  type: 'assistant', timestamp: ts,
  message: { model: 'claude-sonnet-4-5', usage: out == null ? undefined : { output_tokens: out }, content: uses.map(u => ({ type: 'tool_use', id: u.id, name: u.name })) },
})
// user turn carrying results
const res = (rs, ts = at(clock++)) => ({
  type: 'user', timestamp: ts,
  message: { content: rs.map(r => ({ type: 'tool_result', tool_use_id: r.id, ...('err' in r ? { is_error: r.err } : {}), content: r.content ?? 'ok' })) },
})

// ---------------------------------------------------------------- the three states

test('unresolved is a third state, kept out of the success-rate denominator', () => {
  const t = [
    asst([{ id: '1', name: 'Bash' }, { id: '2', name: 'Bash' }, { id: '3', name: 'Bash' }]),
    res([{ id: '1', err: false }, { id: '2', err: true }]),
    // id 3 never gets a result — session interrupted, or permission denied.
  ]
  const r = toolEfficiency(t)
  const bash = r.tools.find(x => x.name === 'Bash')
  assert.equal(bash.success, 1)
  assert.equal(bash.failure, 1)
  assert.equal(bash.unresolved, 1)
  assert.equal(bash.resolved, 2)
  assert.equal(bash.successRate, 0.5, 'over resolved calls only')
  assert.equal(bash.successRateDenominator, 2)
  // The two wrong readings this module exists to prevent:
  assert.notEqual(bash.successRate, 2 / 3, 'counting unresolved as success would inflate the rate')
  assert.notEqual(bash.successRate, 1 / 3, 'counting unresolved as failure would deflate it')
  assert.equal(bash.unresolvedShare, +(1 / 3).toFixed(4))
})

test('the totals publish both extremes so the size of the ambiguity is visible', () => {
  const t = [asst([{ id: '1', name: 'A' }, { id: '2', name: 'A' }]), res([{ id: '1', err: false }])]
  const r = toolEfficiency(t)
  assert.equal(r.totals.successRate, 1, 'of the calls that resolved, all succeeded')
  assert.equal(r.totals.successRateIfUnresolvedAllSucceeded, 1)
  assert.equal(r.totals.successRateIfUnresolvedAllFailed, 0.5)
  assert.equal(r.complete, false, 'an unresolved call means the picture is not complete')
})

test('a MISSING is_error is not an error — real transcripts omit the field on some results', () => {
  // Verified against ~/.claude/projects: AskUserQuestion results arrive with keys
  // {type, content, tool_use_id} and no is_error at all. Treating undefined as truthy-checked
  // failure would have invented errors that never happened.
  const t = [asst([{ id: '1', name: 'AskUserQuestion' }]), res([{ id: '1' }])]
  const r = toolEfficiency(t)
  assert.equal(r.tools[0].success, 1)
  assert.equal(r.tools[0].failure, 0)
  assert.equal(r.tools[0].successRate, 1)
})

test('only is_error === true counts as failure — a truthy string does not', () => {
  const t = [asst([{ id: '1', name: 'A' }, { id: '2', name: 'A' }]), res([{ id: '1', err: 'yes' }, { id: '2', err: true }])]
  const r = toolEfficiency(t)
  assert.equal(r.tools[0].failure, 1)
})

test('nothing resolved means successRate is null, not 0 and not 1', () => {
  const r = toolEfficiency([asst([{ id: '1', name: 'A' }])])
  assert.equal(r.tools[0].successRate, null)
  assert.equal(r.tools[0].successRateDenominator, 0)
  assert.equal(r.totals.successRate, null)
})

// ---------------------------------------------------------------- low n is marked, not hidden

test('a low-n row is reported WITH its n and marked, never dropped', () => {
  const t = [asst([{ id: '1', name: 'Rare' }]), res([{ id: '1', err: false }])]
  const r = toolEfficiency(t)
  const row = r.tools.find(x => x.name === 'Rare')
  assert.ok(row, 'a rarely-used tool is still information and must appear')
  assert.equal(row.n, 1)
  assert.equal(row.successRate, 1, 'a 100% rate on n=1 is meaningless...')
  assert.equal(row.lowSample, true, '...which is exactly what this flag says')
  assert.equal(row.minSample, MIN_SAMPLE, 'the threshold is disclosed')
  assert.equal(r.totals.lowSampleTools, 1)
})

test('the low-sample threshold is configurable and applied against RESOLVED calls', () => {
  const uses = Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, name: 'A' }))
  const t = [asst(uses), res(uses.slice(0, 3).map(u => ({ id: u.id, err: false })))]
  const r = toolEfficiency(t)
  // 6 calls but only 3 resolved: the rate rests on 3 samples, so it is low even though n looks fine.
  assert.equal(r.tools[0].calls, 6)
  assert.equal(r.tools[0].resolved, 3)
  assert.equal(r.tools[0].lowSample, true)
  assert.equal(toolEfficiency(t, { minSample: 2 }).tools[0].lowSample, false)
})

// ---------------------------------------------------------------- duration + size

test('duration is derived from record timestamps and is LABELLED as a model', () => {
  const t = [asst([{ id: '1', name: 'Bash' }], { ts: at(0) }), res([{ id: '1', err: false }], at(5))]
  const row = toolEfficiency(t).tools[0]
  assert.equal(row.meanDurationMs, 5000)
  assert.equal(row.durationEstimated, true, 'this is arithmetic over two timestamps, not an observation')
  assert.match(row.durationBasis, /not tool execution time alone/)
  assert.equal(row.durationDenominator, 1, 'how many calls the mean rests on')
})

test('unmeasurable durations are excluded from the mean and shrink its stated denominator', () => {
  const t = [
    asst([{ id: '1', name: 'A' }], { ts: at(0) }), res([{ id: '1', err: false }], at(2)),
    asst([{ id: '2', name: 'A' }], { ts: 'not-a-date' }), res([{ id: '2', err: false }], 'also-bad'),
  ]
  const row = toolEfficiency(t).tools[0]
  assert.equal(row.meanDurationMs, 2000, 'the untimed call does not drag the mean toward 0')
  assert.equal(row.durationDenominator, 1)
  assert.equal(row.calls, 2, 'but it is still a call')
})

test('mean output size uses only successful calls and reports what it could not measure', () => {
  const t = [
    asst([{ id: '1', name: 'A' }, { id: '2', name: 'A' }]),
    res([{ id: '1', err: false, content: 'x'.repeat(100) }, { id: '2', err: false, content: [{ type: 'image' }] }]),
  ]
  const row = toolEfficiency(t).tools[0]
  assert.equal(row.meanOutputBytes, 100, 'an unmeasurable image result is not counted as 0 bytes')
  assert.equal(row.outputDenominator, 1)
  assert.equal(row.outputSizeComplete, false)
  assert.equal(row.outputSizeUnmeasured, 1)
})

test('resultSize handles string, block-array and unmeasurable content', () => {
  assert.equal(resultSize('abc'), 3)
  assert.equal(resultSize([{ type: 'text', text: 'ab' }, { type: 'text', text: 'c' }]), 3)
  assert.equal(resultSize([{ type: 'image', source: {} }]), null, 'null, not 0')
  assert.equal(resultSize(undefined), null)
  assert.equal(resultSize([]), 0, 'an empty block list genuinely is zero bytes')
})

// ---------------------------------------------------------------- token attribution

test('tokens-per-successful-call splits the issuing message evenly and reports the denominator', () => {
  // One message issues 2 calls and cost 100 output tokens => 50 attributed to each.
  const t = [asst([{ id: '1', name: 'A' }, { id: '2', name: 'A' }], { out: 100 }), res([{ id: '1', err: false }, { id: '2', err: false }])]
  const row = toolEfficiency(t).tools[0]
  assert.equal(row.tokensPerSuccessfulCall, 50)
  assert.equal(row.tokensDenominator, 2, 'the denominator is published so the mean is checkable')
  assert.equal(row.tokensEstimated, true)
  assert.match(row.tokensBasis, /EXCLUDES the input-token cost of feeding the result back/)
})

test('successful calls with no usage record are excluded and counted as unattributed', () => {
  const t = [
    asst([{ id: '1', name: 'A' }], { out: 80 }), res([{ id: '1', err: false }]),
    asst([{ id: '2', name: 'A' }]), res([{ id: '2', err: false }]),   // no usage on this message
  ]
  const row = toolEfficiency(t).tools[0]
  assert.equal(row.tokensPerSuccessfulCall, 80, 'the unattributable call does not pull the mean to 40')
  assert.equal(row.tokensDenominator, 1)
  assert.equal(row.tokensUnattributed, 1)
})

test('failed and unresolved calls are excluded from the token mean', () => {
  const t = [asst([{ id: '1', name: 'A' }], { out: 30 }), asst([{ id: '2', name: 'A' }], { out: 900 }), res([{ id: '1', err: false }, { id: '2', err: true }])]
  const row = toolEfficiency(t).tools[0]
  assert.equal(row.tokensPerSuccessfulCall, 30)
  assert.equal(row.tokensDenominator, 1)
})

test('no attributable tokens means null, not 0', () => {
  const t = [asst([{ id: '1', name: 'A' }]), res([{ id: '1', err: false }])]
  assert.equal(toolEfficiency(t).tools[0].tokensPerSuccessfulCall, null)
})

// ---------------------------------------------------------------- partial windows + robustness

test('a result with no matching tool_use is an ORPHAN and makes the window incomplete', () => {
  // The signature of reading a subagent transcript without its parent, or slicing mid-session.
  const r = toolEfficiency([res([{ id: 'never-issued', err: false }])])
  assert.equal(r.orphanResults, 1)
  assert.equal(r.complete, false)
  assert.equal(r.totals.calls, 0, 'an orphan result is not invented into a call')
})

test('a limit reports the tools it hid and keeps their calls in the totals', () => {
  const t = [asst([{ id: '1', name: 'A' }, { id: '2', name: 'A' }, { id: '3', name: 'B' }]), res([{ id: '1', err: false }, { id: '2', err: false }, { id: '3', err: false }])]
  const r = toolEfficiency(t, { limit: 1 })
  assert.equal(r.tools.length, 1)
  assert.equal(r.toolCount, 2)
  const b = r.bounds.find(x => x.bound === 'limit')
  assert.equal(b.hiddenTools, 1)
  assert.equal(b.hiddenCalls, 1)
  assert.equal(r.totals.calls, 3, 'totals still cover the hidden tool')
})

test('malformed records never throw and never invent calls', () => {
  const junk = [null, 42, 'x', {}, { message: null }, { message: { content: 'a string' } }, { message: { content: [null, { type: 'tool_use' }] } }]
  const r = toolEfficiency(junk)
  assert.equal(r.totals.calls, 0, 'a tool_use with no id cannot be tracked and is not counted')
  assert.deepEqual(r.tools, [])
  for (const bad of [null, undefined, 'x', 42]) assert.equal(toolEfficiency(bad).totals.calls, 0)
})

test('a duplicate tool_use id keeps the first and does not double-count', () => {
  const t = [asst([{ id: '1', name: 'A' }]), asst([{ id: '1', name: 'B' }]), res([{ id: '1', err: false }])]
  const r = toolEfficiency(t)
  assert.equal(r.totals.calls, 1)
  assert.equal(r.tools[0].name, 'A')
})

test('a tool_use with no name is labelled rather than silently merged into another tool', () => {
  const t = [{ type: 'assistant', timestamp: at(0), message: { content: [{ type: 'tool_use', id: '1' }] } }]
  const r = toolEfficiency(t)
  assert.equal(r.tools[0].name, '(unnamed)')
  assert.equal(r.tools[0].nameKnown, undefined)
  assert.equal(extractToolCalls(t).calls[0].nameKnown, false)
})

test('empty input yields an empty honest table', () => {
  const r = toolEfficiency([])
  assert.deepEqual(r.tools, [])
  assert.equal(r.totals.successRate, null)
  assert.equal(r.complete, true, 'nothing observed and nothing unresolved is a complete, empty picture')
})

// ---------------------------------------------------------------- real data

test('tool efficiency holds up on the real transcripts under ~/.claude/projects', { skip: !fs.existsSync(path.join(os.homedir(), '.claude', 'projects')) }, () => {
  const files = findTranscripts(path.join(os.homedir(), '.claude', 'projects'))
  const records = files.flatMap(f => readTranscript(f).records)
  if (!records.length) return

  const r = toolEfficiency(records)
  if (!r.totals.calls) return

  // The three states must partition the calls exactly — this is the invariant that a two-state
  // implementation silently violates.
  assert.equal(r.totals.success + r.totals.failure + r.totals.unresolved, r.totals.calls)
  for (const row of r.tools) {
    assert.equal(row.success + row.failure + row.unresolved, row.calls, `${row.name} states must partition`)
    assert.equal(row.resolved, row.success + row.failure)
    if (row.successRate !== null) {
      assert.ok(row.successRate >= 0 && row.successRate <= 1)
      assert.ok(row.successRateDenominator > 0, 'a non-null rate always has a positive denominator')
    }
    if (row.meanDurationMs !== null) assert.ok(row.meanDurationMs >= 0, `${row.name} duration cannot be negative`)
    assert.ok(row.tokensDenominator <= row.success, 'attribution can never exceed the successful calls')
  }
  // The bracket must contain the headline rate; if it does not, the unresolved bucket is mis-handled.
  assert.ok(r.totals.successRateIfUnresolvedAllFailed <= r.totals.successRate)
  assert.ok(r.totals.successRate <= r.totals.successRateIfUnresolvedAllSucceeded)
})
