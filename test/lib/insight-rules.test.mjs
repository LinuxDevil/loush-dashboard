// Tests for lib/insight-rules/* — the pure-function insight registry.
//
// These pin the properties that make an insights panel worth reading at all:
//   * a rule that cannot decide returns null (never a hedged low-confidence insight)
//   * a rule that throws is NAMED in `failures` and marks the run incomplete — a short list must
//     never pass for a clean bill of health
//   * an insight without evidence is rejected by the type
//   * every rate carries the sample size it was computed from
//   * any cap on the output is reported

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInsightRules, runInsightRulesForAll, RULES, SEVERITY, validateInsight, missingFieldsFor } from '../../lib/insight-rules/index.mjs'
import { makeContext } from '../../lib/insight-rules/types.mjs'
import cacheReadCollapse, { MIN_PEERS as CACHE_MIN_PEERS } from '../../lib/insight-rules/cache-read-collapse.mjs'
import toolErrorRate, { MIN_TOOL_CALLS } from '../../lib/insight-rules/tool-error-rate.mjs'
import errorToolConcentration from '../../lib/insight-rules/error-tool-concentration.mjs'
import costPerOutput from '../../lib/insight-rules/cost-per-output.mjs'

const HOUR = 3_600_000

// A healthy peer session for project "p". Every field the rules read is present and measured.
// Field names and plausible magnitudes come from real transcripts (see INTEGRATION-flow.md).
const peer = (i, over = {}) => ({
  sessionId: 'peer-' + i, proj: 'p', project: 'p',
  in: 20_000, cacheRead: 380_000, out: 20_000, cost: 2,
  toolCalls: 100, errors: 2, durationMs: 2 * HOUR,
  errorsByTool: { Bash: 1, Edit: 1 }, toolUsesByTool: { Bash: 70, Edit: 20, Read: 10 },
  ...over,
})
const peers = (n, over = {}) => Array.from({ length: n }, (_, i) => peer(i, over))
const ctxFor = id => makeContext(id)

// ---------------------------------------------------------------------------
// registry shape
// ---------------------------------------------------------------------------

test('the registry is an array of {id, fn} and every id is unique', () => {
  assert.ok(Array.isArray(RULES) && RULES.length >= 3)
  const ids = RULES.map(r => r.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const r of RULES) assert.equal(typeof r.fn, 'function')
})

// ---------------------------------------------------------------------------
// "a rule that cannot decide returns null"
// ---------------------------------------------------------------------------

test('every rule returns null on a session with no measurements — not a low-confidence insight', () => {
  const blank = { sessionId: 'x', proj: 'p' }
  for (const { id, fn } of RULES) {
    const ctx = ctxFor(id)
    assert.equal(fn(blank, [], ctx), null, `${id} must abstain on an unmeasured session`)
    assert.ok(ctx._abstentions.length >= 1, `${id} must say WHY it could not decide`)
  }
})

test('every COMPARATIVE rule returns null with too few peers, and names that as the reason', () => {
  const s = peer(99, { in: 400_000, cacheRead: 0, errors: 40, cost: 90 })
  const comparative = RULES.filter(r => r.peers)
  assert.ok(comparative.length >= 3)
  for (const { id, fn } of comparative) {
    const ctx = ctxFor(id)
    assert.equal(fn(s, [peer(1)], ctx), null, `${id} fired on n=1`)
    assert.ok(ctx._abstentions.some(a => /peer/.test(a.reason)), `${id}: ${JSON.stringify(ctx._abstentions)}`)
  }
})

test('the registry declares which fields each rule needs and whether it needs peers', () => {
  for (const r of RULES) {
    assert.ok(Array.isArray(r.needs) && r.needs.length, `${r.id} must declare its inputs`)
    assert.equal(typeof r.peers, 'boolean')
  }
  // at least one rule must be answerable from a single session — otherwise the whole panel is blank
  // on any machine that has not accumulated a project history yet.
  assert.ok(RULES.some(r => !r.peers), 'at least one rule must work without a peer baseline')
})

test('missingFieldsFor names the wiring gaps before anything is run', () => {
  const gaps = missingFieldsFor({ sessionId: 'x', proj: 'p', in: 1, cacheRead: 1 })
  const byRule = Object.fromEntries(gaps.map(g => [g.rule, g.missing]))
  assert.deepEqual(byRule['cost-per-output'], ['cost', 'out'])
  assert.deepEqual(byRule['error-tool-concentration'], ['errorsByTool', 'toolUsesByTool'])
  assert.equal(byRule['cache-read-collapse'], undefined, 'a fully-supplied rule is not a gap')
  assert.deepEqual(missingFieldsFor(null).length, RULES.length)
})

test('cache rule abstains rather than trusting the endpoint\'s cacheReadPct:0-for-unknown', () => {
  // in + cacheRead === 0 means "never measured". A rule that read `cacheReadPct` would see 0 and
  // declare a total cache collapse on a session that has no cache accounting at all.
  const s = { sessionId: 'z', proj: 'p', in: 0, cacheRead: 0, cacheReadPct: 0 }
  const ctx = ctxFor('cache-read-collapse')
  assert.equal(cacheReadCollapse(s, peers(20), ctx), null)
  assert.equal(ctx._abstentions[0].reason, 'no-input-tokens-recorded')
})

test('error rule treats a null error count as unknown, not as zero errors', () => {
  const ctx = ctxFor('tool-error-rate')
  assert.equal(toolErrorRate(peer(1, { errors: null }), peers(20), ctx), null)
  assert.equal(ctx._abstentions[0].reason, 'error-count-not-measured')
  // and an explicit "we could not measure this" flag is honoured even when a number is present
  const ctx2 = ctxFor('tool-error-rate')
  assert.equal(toolErrorRate(peer(1, { errors: 0, errorsMeasured: false }), peers(20), ctx2), null)
})

test('cost rule refuses to divide by zero output tokens', () => {
  const ctx = ctxFor('cost-per-output')
  assert.equal(costPerOutput(peer(1, { out: 0, cost: 50 }), peers(20), ctx), null)
  assert.equal(ctx._abstentions[0].reason, 'no-output-tokens')
})

test('concentration rule treats an absent per-tool breakdown as unknown, not as "no concentration"', () => {
  const ctx = ctxFor('error-tool-concentration')
  assert.equal(errorToolConcentration(peer(1, { errorsByTool: undefined }), [], ctx), null)
  assert.equal(ctx._abstentions[0].reason, 'errorsByTool-not-provided')
  const ctx2 = ctxFor('error-tool-concentration')
  assert.equal(errorToolConcentration(peer(1, { toolUsesByTool: null }), [], ctx2), null)
  assert.equal(ctx2._abstentions[0].reason, 'toolUsesByTool-not-provided')
  // a malformed map is unknown too — it is not silently coerced
  const ctx3 = ctxFor('error-tool-concentration')
  assert.equal(errorToolConcentration(peer(1, { errorsByTool: { Bash: 'lots' } }), [], ctx3), null)
  assert.equal(ctx3._abstentions[0].reason, 'errorsByTool-not-provided')
})

test('concentration rule will not give a tool an error rate without its call count', () => {
  const ctx = ctxFor('error-tool-concentration')
  const s = peer(1, { errorsByTool: { Bash: 9 }, toolUsesByTool: { Read: 40 } })
  assert.equal(errorToolConcentration(s, [], ctx), null)
  assert.equal(ctx._abstentions[0].reason, 'tool-call-count-missing')
})

test('a healthy session against a healthy baseline yields no insights at all', () => {
  const r = runInsightRules(peer(0), peers(20))
  assert.deepEqual(r.insights, [])
  assert.equal(r.complete, true)
})

// ---------------------------------------------------------------------------
// the rules actually fire on the thing they claim to detect
// ---------------------------------------------------------------------------

test('cache-read-collapse fires when the share is far below the project median, with n and evidence', () => {
  const s = peer(99, { in: 400_000, cacheRead: 20_000 })   // 5% vs peers' 95%
  const ins = cacheReadCollapse(s, peers(20), ctxFor('c'))
  assert.ok(ins, 'expected a finding')
  assert.equal(ins.severity, 'high')
  assert.equal(ins.n, 20)
  assert.equal(ins.evidence.peerSessions, 20)
  assert.ok(ins.evidence.shareOfInputFromCache < 0.1)
  assert.ok(ins.evidence.peerMedianShare > 0.9)
  assert.equal(validateInsight(ins).ok, true)
  assert.ok(CACHE_MIN_PEERS >= 5)
})

test('tool-error-rate fires only above BOTH the multiple and the absolute gap, and reports the pooled n', () => {
  const s = peer(99, { toolCalls: 100, errors: 30 })     // 30% vs pooled 2%
  const ins = toolErrorRate(s, peers(20), ctxFor('e'))
  assert.ok(ins)
  assert.equal(ins.n, 100, 'n is the denominator of the headline rate')
  assert.equal(ins.evidence.peerToolCalls, 2000)
  assert.equal(ins.evidence.errorRate, 0.3)
  assert.equal(ins.severity, 'critical')
  // a slightly-above-baseline session is NOT an outlier
  assert.equal(toolErrorRate(peer(98, { toolCalls: 100, errors: 4 }), peers(20), ctxFor('e')), null)
})

test('tool-error-rate refuses a headline rate from a handful of calls', () => {
  const ctx = ctxFor('e')
  assert.equal(toolErrorRate(peer(97, { toolCalls: 4, errors: 4 }), peers(20), ctx), null, '100% of 4 calls is not a rate')
  assert.equal(ctx._abstentions[0].reason, 'below-min-tool-calls')
  assert.ok(MIN_TOOL_CALLS >= 10)
})

test('error-tool-concentration fires WITHOUT any peers — the panel is not empty on day one', () => {
  const s = peer(99, { errorsByTool: { Bash: 18, Edit: 2 }, toolUsesByTool: { Bash: 60, Edit: 20 } })
  const ins = errorToolConcentration(s, [], ctxFor('k'))   // no peer list at all
  assert.ok(ins, 'a within-session rule must not need a project baseline')
  assert.equal(ins.evidence.tool, 'Bash')
  assert.equal(ins.evidence.toolErrors, 18)
  assert.equal(ins.n, 60, 'n is the offending tool\'s call count')
  assert.equal(ins.evidence.toolErrorRate, 0.3)
  assert.equal(ins.evidence.shareOfSessionErrors, 0.9)
  assert.equal(validateInsight(ins).ok, true)
})

test('error-tool-concentration stays silent when failures are SPREAD rather than concentrated', () => {
  const s = peer(99, { errorsByTool: { Bash: 5, Edit: 5, Read: 5 }, toolUsesByTool: { Bash: 20, Edit: 20, Read: 20 } })
  assert.equal(errorToolConcentration(s, [], ctxFor('k')), null)
})

test('error-tool-concentration stays silent for a merely popular tool with a low failure rate', () => {
  const s = peer(99, { errorsByTool: { Bash: 8 }, toolUsesByTool: { Bash: 400 } })   // 2% — concentrated but fine
  assert.equal(errorToolConcentration(s, [], ctxFor('k')), null)
})

test('cost-per-output fires on a unit-rate outlier and labels its counterfactual as such', () => {
  const s = peer(99, { cost: 60, out: 20_000 })   // $3/1k vs peers' $0.1/1k
  const ins = costPerOutput(s, peers(20), ctxFor('m'))
  assert.ok(ins)
  assert.equal(ins.evidence.usdPer1kOutput, 3)
  assert.equal(ins.evidence.peerMedianUsdPer1kOutput, 0.1)
  assert.ok('counterfactualCostAtPeerMedianUsd' in ins.evidence)
  assert.match(ins.evidence.costSource, /estimate/)
})

// ---------------------------------------------------------------------------
// the type: evidence is mandatory
// ---------------------------------------------------------------------------

test('validateInsight rejects an insight with no evidence', () => {
  const v = validateInsight({ id: 'x', title: 't', severity: 'high', falsifiableAs: 'f' })
  assert.equal(v.ok, false)
  assert.ok(v.problems.some(p => /evidence/.test(p)))
})

test('validateInsight rejects a rate with no sample size', () => {
  const v = validateInsight({ id: 'x', title: 't', severity: 'high', falsifiableAs: 'f', evidence: { errorRate: 0.9 } })
  assert.equal(v.ok, false)
  assert.ok(v.problems.some(p => /sample size/.test(p)))
  assert.equal(validateInsight({ id: 'x', title: 't', severity: 'high', falsifiableAs: 'f', evidence: { errorRate: 0.9 }, n: 40 }).ok, true)
})

test('validateInsight rejects an unknown severity and a missing falsifiableAs', () => {
  assert.equal(validateInsight({ id: 'x', title: 't', severity: 'scary', falsifiableAs: 'f', evidence: { a: 1 } }).ok, false)
  assert.equal(validateInsight({ id: 'x', title: 't', severity: 'low', evidence: { a: 1 } }).ok, false)
  assert.equal(validateInsight(null).ok, false)
  assert.equal(validateInsight('nope').ok, false)
})

test('every real rule that fires produces a type-valid insight', () => {
  const bad = peer(99, { in: 400_000, cacheRead: 5_000, toolCalls: 200, errors: 80, cost: 90, out: 20_000,
    errorsByTool: { Bash: 72, Edit: 8 }, toolUsesByTool: { Bash: 150, Edit: 50 } })
  const r = runInsightRules(bad, peers(20))
  assert.equal(r.insights.length, 4, 'all four rules should have something to say about this session')
  for (const ins of r.insights) {
    assert.equal(validateInsight(ins).ok, true, ins.id)
    assert.ok(Object.keys(ins.evidence).length >= 3)
    assert.ok(ins.falsifiableAs.length > 20)
  }
})

// ---------------------------------------------------------------------------
// isolation: a failing rule is NAMED, not swallowed
// ---------------------------------------------------------------------------

test('a rule that throws is named in failures and the run is marked incomplete', () => {
  const boom = { id: 'exploding-rule', fn: () => { throw new TypeError('kaboom') } }
  const r = runInsightRules(peer(0), peers(20), { rules: [...RULES, boom] })
  assert.equal(r.complete, false)
  assert.equal(r.failures.length, 1)
  assert.equal(r.failures[0].rule, 'exploding-rule')
  assert.equal(r.failures[0].kind, 'threw')
  assert.match(r.failures[0].error, /kaboom/)
  assert.match(r.bounds.failureNote, /exploding-rule/)
  assert.match(r.bounds.failureNote, /INCOMPLETE/)
})

test('one exploding rule does not stop the others from producing their insights', () => {
  const boom = { id: 'exploding-rule', fn: () => { throw new Error('nope') } }
  const bad = peer(99, { in: 400_000, cacheRead: 5_000 })
  const r = runInsightRules(bad, peers(20), { rules: [boom, ...RULES] })
  assert.ok(r.insights.some(i => i.id === 'cache-read-collapse'))
  assert.equal(r.failures.length, 1)
})

test('a rule that returns a malformed insight is reported as a rule bug, not silently dropped', () => {
  const sloppy = { id: 'no-evidence-rule', fn: () => ({ id: 'x', title: 'Something feels off', severity: 'high' }) }
  const r = runInsightRules(peer(0), peers(20), { rules: [sloppy] })
  assert.equal(r.insights.length, 0)
  assert.equal(r.failures[0].kind, 'invalid-insight')
  assert.equal(r.failures[0].rule, 'no-evidence-rule')
  assert.match(r.failures[0].error, /evidence/)
  assert.equal(r.complete, false)
})

test('a registry entry with no callable fn is reported rather than crashing the engine', () => {
  const r = runInsightRules(peer(0), peers(20), { rules: [{ id: 'broken' }] })
  assert.equal(r.failures[0].kind, 'not-a-function')
  assert.equal(r.complete, false)
})

// ---------------------------------------------------------------------------
// abstentions are kept — "no finding" and "could not tell" are different facts
// ---------------------------------------------------------------------------

test('abstention reasons reach the caller', () => {
  const r = runInsightRules({ sessionId: 'x', proj: 'p' }, [])
  assert.equal(r.insights.length, 0)
  assert.equal(r.complete, true, 'abstaining is not failing')
  assert.equal(r.abstentions.length >= RULES.length, true)
  for (const a of r.abstentions) assert.equal(typeof a.reason, 'string')
})

test('a missing peer list is stated, not treated as an empty-but-valid baseline', () => {
  const r = runInsightRules(peer(0), null)
  assert.match(r.bounds.baselineNote, /no peer-session list/)
  const r2 = runInsightRules(peer(0), peers(20))
  assert.equal(r2.bounds.baselineNote, null)
})

// ---------------------------------------------------------------------------
// ordering and caps
// ---------------------------------------------------------------------------

test('insights are sorted by severity, most severe first', () => {
  const bad = peer(99, { in: 400_000, cacheRead: 5_000, toolCalls: 200, errors: 80, cost: 90, out: 20_000,
    errorsByTool: { Bash: 72, Edit: 8 }, toolUsesByTool: { Bash: 150, Edit: 50 } })
  const r = runInsightRules(bad, peers(20))
  const ranks = r.insights.map(i => SEVERITY.indexOf(i.severity))
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b))
})

test('a limit is applied AND reported — a truncated list must not look complete', () => {
  const bad = peer(99, { in: 400_000, cacheRead: 5_000, toolCalls: 200, errors: 80, cost: 90, out: 20_000,
    errorsByTool: { Bash: 72, Edit: 8 }, toolUsesByTool: { Bash: 150, Edit: 50 } })
  const r = runInsightRules(bad, peers(20), { limit: 2 })
  assert.equal(r.insights.length, 2)
  assert.equal(r.bounds.produced, 4)
  assert.equal(r.bounds.hidden, 2)
  assert.equal(r.bounds.truncated, true)
  assert.match(r.bounds.note, /showing 2 of 4 insights/)
})

test('an unlimited run says "showing all" rather than staying silent about the count', () => {
  const r = runInsightRules(peer(0), peers(20))
  assert.equal(r.bounds.truncated, false)
  assert.match(r.bounds.note, /showing all 0 insights/)
})

// ---------------------------------------------------------------------------
// never throws
// ---------------------------------------------------------------------------

test('the engine never throws on malformed input', () => {
  for (const s of [null, undefined, 'x', 7, [], {}]) {
    for (const all of [null, undefined, 'x', 7, [null, 'x', 3], [{}]]) {
      const r = runInsightRules(s, all)
      assert.ok(Array.isArray(r.insights))
      assert.ok(Array.isArray(r.failures))
      assert.equal(r.complete, true, `a malformed input must abstain, not fail: ${JSON.stringify(s)}`)
    }
  }
  assert.ok(Array.isArray(runInsightRulesForAll(null)))
  assert.equal(runInsightRulesForAll([peer(0), null, 'x']).length, 3)
})

test('bad opts are tolerated', () => {
  assert.ok(runInsightRules(peer(0), peers(20), null).insights.length === 0)
  assert.ok(runInsightRules(peer(0), peers(20), { rules: 'nope', limit: -3 }).rulesRun === RULES.length)
})

// ---------------------------------------------------------------------------
// peers are same-project only
// ---------------------------------------------------------------------------

test('a baseline is never borrowed from another project', () => {
  const s = peer(99, { proj: 'other', project: 'other', in: 400_000, cacheRead: 5_000 })
  const ctx = ctxFor('c')
  assert.equal(cacheReadCollapse(s, peers(30), ctx), null)
  assert.equal(ctx._abstentions[0].reason, 'insufficient-peer-baseline')
})

test('a session is not its own peer — by identity or by sessionId', () => {
  const s = peer(99, { in: 400_000, cacheRead: 5_000 })
  // present twice: the same object, and a same-sessionId copy. Neither may inflate the baseline,
  // and neither may drag the median toward the very session being judged.
  const ins = cacheReadCollapse(s, [s, { ...s }, ...peers(20)], ctxFor('c'))
  assert.equal(ins.evidence.peerSessions, 20)
})
