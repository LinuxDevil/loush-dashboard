// tool-error-rate.mjs
//
// CLAIM: tool calls in this session failed at a rate materially above the pooled rate of the same
// project's other sessions — i.e. the agent spent this session fighting the environment, not the task.
//
// Why this is falsifiable: the comparison is a pooled rate over named peers, both numerator and
// denominator are printed, and the threshold is stated. If the project's pooled rate is itself high,
// this session is not an outlier and the rule stays silent — "many errors" on its own is never enough.
//
// MINIMUM SAMPLE: a session with 4 tool calls and 2 errors is a 50% failure rate and means nothing.
// `n` on the returned insight is the session's own tool-call count, which is the denominator of the
// headline rate; `evidence.peerSessions` and `evidence.peerToolCalls` carry the baseline's sample.
//
// UNKNOWN vs ZERO: `/api/sessions` emits `errors: 0` when no forensics record exists for the file, so
// zero is overloaded there. This rule requires `errors` to be an actual number AND requires the
// caller to have supplied `errorsMeasured !== false`; a caller that cannot tell must pass
// `errors: null`. See INTEGRATION-flow.md — the endpoint has to stop laundering unknown into 0.

import { ratio, peersOf, round, num } from './stats.mjs'

export const id = 'tool-error-rate'
export const severity = 'high'

export const MIN_TOOL_CALLS = 20   // this session's denominator
export const MIN_PEERS = 5         // peer sessions contributing to the pooled baseline
export const MIN_ERRORS = 3        // below this it is noise however good the rate looks
export const MULTIPLE = 2          // outlier = at least this many times the pooled baseline
export const MIN_ABSOLUTE_GAP = 0.05

const measurable = s => num(s?.errors) != null && num(s?.toolCalls) != null && s.errorsMeasured !== false

export default function toolErrorRate(session, allSessions, ctx) {
  const abstain = (r, d) => (ctx ? ctx.abstain(r, d) : null)
  if (!session || typeof session !== 'object') return abstain('no-session')
  if (!measurable(session)) return abstain('error-count-not-measured', 'session.errors is null/absent, or errorsMeasured === false')

  const calls = num(session.toolCalls), errs = num(session.errors)
  if (calls < MIN_TOOL_CALLS) return abstain('below-min-tool-calls', { toolCalls: calls, min: MIN_TOOL_CALLS })
  const rate = ratio(errs, calls)
  if (rate == null) return abstain('no-tool-calls')

  const peers = peersOf(session, allSessions, s => measurable(s) && num(s.toolCalls) >= MIN_TOOL_CALLS)
  if (peers.length < MIN_PEERS) return abstain('insufficient-peer-baseline', { peers: peers.length, min: MIN_PEERS })

  const peerErrs = peers.reduce((a, s) => a + num(s.errors), 0)
  const peerCalls = peers.reduce((a, s) => a + num(s.toolCalls), 0)
  // Pooled, not mean-of-rates: a 20-call session and a 900-call session must not carry equal weight
  // in the baseline, or one unlucky short session sets the bar for the whole project.
  const baseline = ratio(peerErrs, peerCalls)
  if (baseline == null) return abstain('peer-baseline-unmeasurable')

  if (errs < MIN_ERRORS) return null
  if (!(rate >= baseline * MULTIPLE && rate - baseline >= MIN_ABSOLUTE_GAP)) return null

  return {
    id, rule: id, severity: rate >= baseline * 4 ? 'critical' : severity,
    sessionId: session.sessionId ?? null,
    title: `${Math.round(rate * 100)}% of tool calls errored — ${Math.round(baseline * 100)}% is normal for this project`,
    detail: `${errs} errors in ${calls} tool calls. Pooled baseline over ${peers.length} peer sessions: ${peerErrs} in ${peerCalls}.`,
    n: calls,
    evidence: {
      errors: errs,
      toolCalls: calls,
      errorRate: round(rate),
      peerPooledErrorRate: round(baseline),
      peerSessions: peers.length,
      peerErrors: peerErrs,
      peerToolCalls: peerCalls,
      thresholds: { multipleOfBaseline: MULTIPLE, minAbsoluteGap: MIN_ABSOLUTE_GAP, minToolCalls: MIN_TOOL_CALLS, minErrors: MIN_ERRORS },
    },
    falsifiableAs: `Open the transcript and count is_error tool results. If they are under ${Math.ceil(baseline * MULTIPLE * calls)} for ${calls} calls, the rate is not an outlier and this rule is wrong.`,
  }
}
