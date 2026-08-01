// cost-per-output.mjs
//
// CLAIM: this session paid far more per token it PRODUCED than the project's other sessions — the
// spend went into reading context rather than writing anything. This is the one cost rule worth
// having, because raw "$X spent" is unfalsifiable (a long session should cost more) whereas
// $-per-1k-output-tokens is a unit rate that a long session does not inflate.
//
// Why it is not the same finding as cache-read-collapse: a poor cache share is one possible CAUSE of
// a bad unit rate, but a session can have an excellent cache share and still burn money re-reading a
// huge repo, and it can have a poor cache share on a tiny prompt and cost nothing. The two rules can
// fire together — that is informative, not redundant — and each prints its own evidence.
//
// OUTPUT TOKENS ARE THE DENOMINATOR AND THEY CAN BE ZERO. A session that produced nothing has no
// unit rate at all: dividing by zero would render as Infinity or, worse, be "handled" as 0. It
// abstains with `no-output-tokens`, which is a different fact from "the rate is fine".

import { median, ratio, peersOf, round, num } from './stats.mjs'

export const id = 'cost-per-output'
export const severity = 'medium'

export const MIN_PEERS = 8
export const MIN_OUTPUT_TOKENS = 2_000
export const MIN_COST_USD = 0.25   // below this the absolute waste is not worth a reader's attention
export const MULTIPLE = 2.5

const unitRate = s => {
  const cost = num(s?.cost), out = num(s?.out)
  if (cost == null || out == null || out < MIN_OUTPUT_TOKENS) return null
  return ratio(cost, out / 1000)   // $ per 1k output tokens
}

export default function costPerOutput(session, allSessions, ctx) {
  const abstain = (r, d) => (ctx ? ctx.abstain(r, d) : null)
  if (!session || typeof session !== 'object') return abstain('no-session')

  const cost = num(session.cost), out = num(session.out)
  if (cost == null) return abstain('cost-not-reported')
  if (out == null) return abstain('output-tokens-not-reported')
  if (out === 0) return abstain('no-output-tokens', 'no unit rate exists for a session that produced nothing')
  if (out < MIN_OUTPUT_TOKENS) return abstain('below-min-output-tokens', { out, min: MIN_OUTPUT_TOKENS })
  if (cost < MIN_COST_USD) return abstain('below-min-cost', { cost, min: MIN_COST_USD })

  const rate = unitRate(session)
  if (rate == null) return abstain('rate-unmeasurable')

  const peers = peersOf(session, allSessions, s => unitRate(s) != null)
  if (peers.length < MIN_PEERS) return abstain('insufficient-peer-baseline', { peers: peers.length, min: MIN_PEERS })
  const baseline = median(peers.map(unitRate))
  if (baseline == null || baseline === 0) return abstain('peer-baseline-unmeasurable')

  if (rate < baseline * MULTIPLE) return null

  const costAtBaseline = (out / 1000) * baseline
  return {
    id, rule: id, severity: rate >= baseline * 5 ? 'high' : severity,
    sessionId: session.sessionId ?? null,
    title: `$${round(rate, 3)} per 1k output tokens — ${round(rate / baseline, 1)}× this project's median`,
    detail: `$${round(cost, 2)} for ${(out / 1000).toFixed(1)}k output tokens. Median over ${peers.length} peer sessions is $${round(baseline, 3)} per 1k.`,
    n: peers.length,
    evidence: {
      costUsd: round(cost, 4),
      outputTokens: out,
      usdPer1kOutput: round(rate, 4),
      peerMedianUsdPer1kOutput: round(baseline, 4),
      peerSessions: peers.length,
      // Counterfactual, clearly labelled: what the same output would have cost at the project median.
      counterfactualCostAtPeerMedianUsd: round(costAtBaseline, 2),
      excessOverPeerMedianUsd: round(cost - costAtBaseline, 2),
      costSource: 'per-entry price model in server/index.mjs — an estimate from token counts, not an invoice',
      thresholds: { multipleOfBaseline: MULTIPLE, minOutputTokens: MIN_OUTPUT_TOKENS, minCostUsd: MIN_COST_USD },
    },
    falsifiableAs: `If the same work is re-run and lands within ${MULTIPLE}× of $${round(baseline, 3)}/1k output, the spend was situational rather than a property of this session, and this rule is wrong.`,
  }
}
