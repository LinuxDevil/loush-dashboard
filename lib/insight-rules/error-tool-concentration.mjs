// error-tool-concentration.mjs
//
// CLAIM: this session's tool failures are concentrated in ONE tool, and that tool's own failure rate
// inside the session is high — so the fix is that tool's usage, not the session's approach.
//
// NOT the same question as tool-error-rate.mjs, and the two can fire independently:
//   * tool-error-rate asks "is this session unusual for this project?" (needs peers)
//   * this rule asks "within this session, is the damage localised or spread?" (needs NO peers)
// A session can be perfectly normal for the project and still have every failure in Bash; a session
// can be a project-level outlier with failures spread evenly across six tools. The actions differ:
// one says "fix how you call Bash", the other says "the environment is broken".
//
// NO PEER BASELINE IS USED, deliberately. Every other rule in this registry is comparative and
// therefore silent on a machine with few sessions in a project. This one is answerable from a single
// transcript, so the panel is not empty on day one.
//
// FIELD PROVENANCE — verified against 32 transcripts / 5,525 records under ~/.claude/projects
// (recursive, including the 31 files under nested `subagents/` dirs):
//   * 1,668 `tool_use` blocks  → toolUsesByTool
//   * 1,668 `tool_result` blocks, 66 with `is_error: true`, and ALL 66 resolved to a tool name via
//     `tool_result.tool_use_id` → `tool_use.id` → toolUsesByTool. Zero unattributed.
// Both maps are already computed server-side by failStats() as `rec.toolUses` / `rec.toolErrs`;
// see INTEGRATION-flow.md for the two lines needed to put them on the session row.

import { ratio, round, num } from './stats.mjs'

export const id = 'error-tool-concentration'
export const severity = 'medium'

/** The session needs this many failures before "concentrated" means anything. Two errors in the same
 *  tool is a coincidence; the word "concentration" implies a distribution, and n=2 has none. */
export const MIN_ERRORS = 5
/** The offending tool must have been called this many times, or its own rate is not a rate. */
export const MIN_CALLS_FOR_TOOL = 10
/** Share of the session's errors that must land in one tool. */
export const MIN_SHARE = 0.6
/** And that tool must actually be failing often, not merely be the most-used tool. */
export const MIN_TOOL_RATE = 0.15

const asCounts = m => {
  if (m == null || typeof m !== 'object' || Array.isArray(m)) return null
  const out = {}
  for (const [k, v] of Object.entries(m)) { const n = num(v); if (n == null || n < 0) return null; out[k] = n }
  return out
}

export default function errorToolConcentration(session, _allSessions, ctx) {
  const abstain = (r, d) => (ctx ? ctx.abstain(r, d) : null)
  if (!session || typeof session !== 'object') return abstain('no-session')

  const errsBy = asCounts(session.errorsByTool)
  const usesBy = asCounts(session.toolUsesByTool)
  // Unknown is a value: an absent breakdown is not an empty breakdown. Returning "no concentration"
  // here would be a finding about data we never had.
  if (errsBy == null) return abstain('errorsByTool-not-provided', 'per-tool error breakdown absent or malformed')
  if (usesBy == null) return abstain('toolUsesByTool-not-provided', 'per-tool call counts absent or malformed')

  const totalErrors = Object.values(errsBy).reduce((a, b) => a + b, 0)
  if (totalErrors === 0) return null            // measured, and there were none — decided, not unknown
  if (totalErrors < MIN_ERRORS) return abstain('below-min-errors', { errors: totalErrors, min: MIN_ERRORS })

  const ranked = Object.entries(errsBy).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const [tool, toolErrors] = ranked[0]
  const share = ratio(toolErrors, totalErrors)

  const calls = num(usesBy[tool])
  // A tool that errored but has no recorded call count cannot be given a rate. Guessing the
  // denominator is exactly the "plausible default" this codebase refuses to ship.
  if (calls == null) return abstain('tool-call-count-missing', { tool })
  if (calls < MIN_CALLS_FOR_TOOL) return abstain('tool-called-too-few-times-for-a-rate', { tool, calls, min: MIN_CALLS_FOR_TOOL })
  const toolRate = ratio(toolErrors, calls)
  if (toolRate == null) return abstain('tool-rate-unmeasurable', { tool })

  if (share < MIN_SHARE) return null            // failures are spread — a different problem, not this one
  if (toolRate < MIN_TOOL_RATE) return null     // it is just the most-used tool, not a failing one

  const others = ranked.slice(1, 4).map(([t, n]) => `${t} ${n}`)
  return {
    id, rule: id, severity: toolRate >= 0.4 ? 'high' : severity,
    sessionId: session.sessionId ?? null,
    title: `${Math.round(share * 100)}% of this session's tool errors are ${tool} — ${toolErrors} of ${calls} ${tool} calls failed`,
    detail: others.length ? `Next worst: ${others.join(', ')}.` : `${tool} is the only tool that errored.`,
    // n is the denominator of the headline rate: how many times the offending tool was called.
    n: calls,
    evidence: {
      tool,
      toolErrors,
      toolCalls: calls,
      toolErrorRate: round(toolRate),
      sessionErrors: totalErrors,
      shareOfSessionErrors: round(share),
      errorsByTool: errsBy,
      attribution: 'tool_result.is_error === true, resolved to a tool via tool_result.tool_use_id → tool_use.id',
      thresholds: { minErrors: MIN_ERRORS, minCallsForTool: MIN_CALLS_FOR_TOOL, minShare: MIN_SHARE, minToolRate: MIN_TOOL_RATE },
    },
    falsifiableAs: `Grep the transcript for is_error results and group by tool_use_id. If fewer than ${Math.ceil(MIN_SHARE * totalErrors)} of the ${totalErrors} failures are ${tool}, the concentration claim is wrong.`,
  }
}
