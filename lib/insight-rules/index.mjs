// insight-rules/index.mjs — the registry and the engine.
//
// SHAPE: a rule is a pure function `(session, allSessions, ctx) => Insight | null`, and the whole
// engine is `RULES.map(run).filter(Boolean).sort(bySeverity)`. Adding an insight is one small file
// plus one line in RULES, and the file is testable on its own with no engine and no React.
//
// The four properties this engine exists to guarantee, none of which a rule can guarantee alone:
//
//   1. A RULE THAT THROWS DOES NOT TAKE THE ENGINE DOWN — and, more importantly, does not silently
//      shrink the output. Each rule runs inside its own try/catch and a thrown error becomes a NAMED
//      entry in `failures` with `complete: false`. Silently producing four insights instead of five
//      is indistinguishable from "nothing else to report", which is the worst possible failure for a
//      panel whose only job is to tell you when something is wrong.
//
//   2. A RULE THAT CANNOT DECIDE RETURNS null — never a hedged low-confidence insight. The reason it
//      could not decide is captured through `ctx.abstain(reason)` and surfaces in `abstentions`, so
//      "no finding" and "not measurable" stay distinct facts on the way to the UI.
//
//   3. AN INSIGHT WITHOUT EVIDENCE IS REJECTED. validateInsight() is applied to every return value;
//      a malformed insight is reported in `failures` as a rule bug, not dropped and not rendered.
//
//   4. ANY CAP IS REPORTED. `opts.limit` truncates the list, and `bounds.note` says so in words.
//
// Never throws on malformed input: runInsightRules(null, 'nonsense') returns an empty, explained result.

import { SEVERITY_RANK, validateInsight, makeContext } from './types.mjs'
import cacheReadCollapse from './cache-read-collapse.mjs'
import toolErrorRate from './tool-error-rate.mjs'
import errorToolConcentration from './error-tool-concentration.mjs'
import costPerOutput from './cost-per-output.mjs'

export { SEVERITY, SEVERITY_RANK, validateInsight, MIN_SAMPLE } from './types.mjs'

/**
 * The registry. One entry per rule file; order here is irrelevant, output is sorted by severity.
 *
 * `needs` names the session fields the rule reads, so a caller can see at a glance what a data
 * source has to supply — and so a rule that will never fire because a field is not wired shows up as
 * a wiring gap rather than as a permanently quiet rule. `peers: true` means the rule needs a
 * same-project peer list and will abstain without one.
 *
 * Every field listed here was verified to exist in real transcripts under ~/.claude/projects — see
 * INTEGRATION-flow.md for the counts and the derivation of each one.
 */
export const RULES = [
  { id: 'cache-read-collapse', fn: cacheReadCollapse, peers: true, needs: ['proj', 'in', 'cacheRead'] },
  { id: 'tool-error-rate', fn: toolErrorRate, peers: true, needs: ['proj', 'toolCalls', 'errors'] },
  { id: 'error-tool-concentration', fn: errorToolConcentration, peers: false, needs: ['errorsByTool', 'toolUsesByTool'] },
  { id: 'cost-per-output', fn: costPerOutput, peers: true, needs: ['proj', 'cost', 'out'] },
]

/**
 * Which registry rules cannot run against a given session because a field they need is absent.
 * A rule that is silent for want of a field looks identical to a rule that found nothing, so the
 * caller needs to be able to tell the difference BEFORE running anything.
 */
export function missingFieldsFor(session, rules = RULES) {
  const s = session && typeof session === 'object' ? session : {}
  return (Array.isArray(rules) ? rules : []).map(r => ({
    rule: r.id,
    missing: (r.needs || []).filter(f => s[f] == null),
    needsPeers: Boolean(r.peers),
  })).filter(x => x.missing.length > 0)
}

const errText = e => (e instanceof Error ? `${e.name}: ${e.message}` : String(e))

/**
 * runInsightRules(session, allSessions, opts) -> {
 *   insights, failures, abstentions, complete, rulesRun, bounds
 * }
 *
 * opts: { rules = RULES, limit = null }
 */
export function runInsightRules(session, allSessions, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const rules = Array.isArray(o.rules) ? o.rules : RULES
  const all = Array.isArray(allSessions) ? allSessions : []
  const allWasUsable = Array.isArray(allSessions)

  const insights = [], failures = [], abstentions = []
  for (const entry of rules) {
    const rid = (entry && (entry.id ?? entry.fn?.name)) || 'anonymous-rule'
    const fn = entry && typeof entry.fn === 'function' ? entry.fn : (typeof entry === 'function' ? entry : null)
    if (!fn) { failures.push({ rule: rid, kind: 'not-a-function', error: 'registry entry has no callable fn' }); continue }
    const ctx = makeContext(rid)
    let out
    try {
      out = fn(session, all, ctx)
    } catch (e) {
      // NAMED, not swallowed. The UI must be able to say "cache-read-collapse failed" so the reader
      // knows the list is short because a rule broke, not because the session was clean.
      failures.push({ rule: rid, kind: 'threw', error: errText(e), stack: e instanceof Error ? e.stack : null })
      continue
    }
    for (const a of ctx._abstentions) abstentions.push(a)
    if (out == null) {
      // A rule may return null without abstaining: that is "decided, nothing to report".
      if (!ctx._abstentions.length) abstentions.push({ rule: rid, reason: 'no-finding' })
      continue
    }
    const v = validateInsight(out)
    if (!v.ok) { failures.push({ rule: rid, kind: 'invalid-insight', error: v.problems.join('; '), value: out }); continue }
    insights.push({ ...out, rule: out.rule ?? rid })
  }

  insights.sort((a, b) =>
    (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) ||
    ((b.n ?? 0) - (a.n ?? 0)) ||
    String(a.id).localeCompare(String(b.id)))

  const limit = Number.isInteger(o.limit) && o.limit > 0 ? o.limit : null
  const produced = insights.length
  const shownList = limit ? insights.slice(0, limit) : insights
  const truncated = shownList.length < produced

  return {
    insights: shownList,
    failures,
    abstentions,
    // `complete` is false whenever ANY rule failed — the caller must not present a short list as a
    // clean bill of health.
    complete: failures.length === 0,
    rulesRun: rules.length,
    bounds: {
      limit, produced, shown: shownList.length, hidden: produced - shownList.length, truncated,
      note: truncated
        ? `showing ${shownList.length} of ${produced} insights (limit ${limit})`
        : `showing all ${produced} insight${produced === 1 ? '' : 's'}`,
      rulesRun: rules.length, rulesFailed: failures.length,
      failureNote: failures.length
        ? `${failures.length} of ${rules.length} rules failed and produced no verdict: ${failures.map(f => f.rule).join(', ')} — this list is INCOMPLETE`
        : null,
      baselineNote: allWasUsable ? null : 'no peer-session list was supplied, so every comparative rule abstained',
    },
  }
}

/** Convenience: run the engine for every session in a list. Never throws. */
export function runInsightRulesForAll(allSessions, opts = {}) {
  const all = Array.isArray(allSessions) ? allSessions : []
  return all.map(s => ({ sessionId: s?.sessionId ?? null, ...runInsightRules(s, all, opts) }))
}

export default runInsightRules
