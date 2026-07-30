// cache-read-collapse.mjs
//
// CLAIM: this session served a far smaller share of its prompt from the cache than the same project
// normally does, so it paid full input price for context it had already paid to write.
//
// Why this is falsifiable and not a restatement: it is a comparison against the project's OWN
// measured baseline, it names the peer count, and it predicts a specific number — the fresh input
// tokens that would not have been fresh at the baseline share. If you re-run comparable work and the
// share does not move, the rule was wrong and you can see that from the evidence it printed.
//
// WHAT IT REFUSES TO DO: `/api/sessions` computes `cacheReadPct: cacheIn ? f.cr/cacheIn : 0` — a
// session with no cache accounting at all reports 0, which is indistinguishable from "measured, and
// it really was zero". Trusting that field would let this rule declare a cache collapse on a session
// whose cache was never measured. So the rule recomputes the share from `in` + `cacheRead` and
// abstains when that denominator is zero or either term is missing.

import { median, ratio, peersOf, round, num } from './stats.mjs'

export const id = 'cache-read-collapse'
export const severity = 'high'

/** Peers needed before a baseline means anything. Below this the median is one person's Tuesday. */
export const MIN_PEERS = 8
/** Below this many input tokens the share is dominated by rounding, not behaviour. */
export const MIN_INPUT_TOKENS = 20_000
/** Absolute percentage-point gap below the peer median that counts as a collapse. */
export const MIN_GAP = 0.25

const shareOf = s => {
  const fresh = num(s?.in), cached = num(s?.cacheRead)
  if (fresh == null || cached == null) return null
  return ratio(cached, fresh + cached)   // null when the denominator is 0 — unknown, not 0%
}

export default function cacheReadCollapse(session, allSessions, ctx) {
  const abstain = (r, d) => (ctx ? ctx.abstain(r, d) : null)
  if (!session || typeof session !== 'object') return abstain('no-session')

  const fresh = num(session.in), cached = num(session.cacheRead)
  if (fresh == null || cached == null) return abstain('cache-tokens-not-reported', 'session.in / session.cacheRead missing')
  const total = fresh + cached
  if (total === 0) return abstain('no-input-tokens-recorded')
  if (total < MIN_INPUT_TOKENS) return abstain('below-min-input-tokens', { total, min: MIN_INPUT_TOKENS })

  const share = ratio(cached, total)
  const peers = peersOf(session, allSessions, s => shareOf(s) != null && (num(s.in) + num(s.cacheRead)) >= MIN_INPUT_TOKENS)
  if (peers.length < MIN_PEERS) return abstain('insufficient-peer-baseline', { peers: peers.length, min: MIN_PEERS })

  const baseline = median(peers.map(shareOf))
  if (baseline == null) return abstain('peer-baseline-unmeasurable')

  const gap = baseline - share
  if (gap < MIN_GAP) return null   // measured, and it is fine — not an insight, and not a hedge

  // What the fresh-input bill would have been at the project's own median share. Labelled as a
  // counterfactual, not as an observation, because it is arithmetic on a baseline, not a measurement.
  const freshAtBaseline = Math.round(total * (1 - baseline))

  return {
    id, rule: id, severity,
    sessionId: session.sessionId ?? null,
    title: `Cache read share ${Math.round(share * 100)}% vs ${Math.round(baseline * 100)}% for this project`,
    detail: `${(total / 1000).toFixed(0)}k input tokens, ${Math.round(share * 100)}% served from cache. The other ${peers.length} sessions in ${session.project ?? session.proj} median ${Math.round(baseline * 100)}%.`,
    n: peers.length,
    evidence: {
      shareOfInputFromCache: round(share),
      peerMedianShare: round(baseline),
      gapPoints: round(gap),
      peerSessions: peers.length,
      freshInputTokens: fresh,
      cachedInputTokens: cached,
      counterfactualFreshInputTokensAtPeerMedian: freshAtBaseline,
      denominator: 'in + cacheRead for this session; cache-creation tokens are not in the /api/sessions row and are excluded from both sides',
    },
    falsifiableAs: `Re-run comparable work in ${session.project ?? session.proj}; if the cache-read share stays near ${Math.round(share * 100)}% across sessions then ${Math.round(baseline * 100)}% is not this project's baseline and this rule is wrong.`,
  }
}
