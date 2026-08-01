// tool-efficiency.mjs — per-tool success rate, duration, output size and tokens-per-successful-call.
//
// The load-bearing idea is that a tool call has THREE outcomes, not two:
//
//   success     — a tool_result came back and `is_error` was not true
//   failure     — a tool_result came back with `is_error: true`
//   unresolved  — no tool_result ever appeared for that tool_use id
//
// Unresolved calls are real and common: the session was interrupted, the user denied the permission
// prompt, the transcript is still being written, or the result lives in a file we were not given.
// Folding them into success inflates the rate; folding them into failure deflates it. Both readings
// are wrong in a way that is invisible in the output, so `successRate` is computed over RESOLVED
// calls only, and `unresolved` travels next to it with its own count and share.
//
// Record handling is imported from lib/transcript-records.mjs rather than re-derived here. (The
// brief named lib/context-analysis.mjs and lib/event-grouping.mjs; neither exists in this repo —
// see the note at the top of transcript-records.mjs.)

import { contentBlocks } from './transcript-records.mjs'

/** Below this many resolved calls a rate is noise. Rows are MARKED, never dropped — see extractToolCalls. */
export const MIN_SAMPLE = 5

const isNum = v => typeof v === 'number' && Number.isFinite(v)

/** Byte length of a tool_result's content, whatever shape it arrived in. Null when unmeasurable. */
export function resultSize(content) {
  if (typeof content === 'string') return content.length
  if (Array.isArray(content)) {
    let n = 0
    for (const b of content) {
      if (typeof b === 'string') n += b.length
      else if (b && typeof b === 'object' && typeof b.text === 'string') n += b.text.length
      // An image/document block has no text length. Counting it as 0 would understate the result, so
      // the block is skipped and `sizeComplete:false` is raised by the caller instead.
      else return null
    }
    return n
  }
  return null
}

/**
 * Pair tool_use blocks with their tool_result blocks across a transcript.
 *
 * Returns one entry per tool_use, plus `orphanResults` — tool_results whose id we never saw issued,
 * which is the signature of a partial transcript (subagent file read without its parent, or a window
 * that starts mid-session). It is reported so a suspiciously clean success rate can be questioned.
 */
export function extractToolCalls(records = []) {
  const list = Array.isArray(records) ? records : []
  const calls = new Map()
  const results = new Map()

  for (const r of list) {
    const t = r?.timestamp ? Date.parse(r.timestamp) : null
    const at = isNum(t) ? t : null
    for (const b of contentBlocks(r)) {
      if (!b || typeof b !== 'object') continue
      if (b.type === 'tool_use') {
        if (typeof b.id !== 'string') continue
        // A duplicated id would double-count; keep the first and let the second fall through as a
        // result-only pairing rather than silently overwriting the original call's timestamp.
        if (!calls.has(b.id)) {
          calls.set(b.id, {
            id: b.id,
            name: typeof b.name === 'string' && b.name ? b.name : '(unnamed)',
            nameKnown: typeof b.name === 'string' && !!b.name,
            at,
            usageOutputTokens: isNum(r?.message?.usage?.output_tokens) ? r.message.usage.output_tokens : null,
            siblingToolUses: 0,
            sessionId: r?.sessionId ?? null,
          })
        }
      } else if (b.type === 'tool_result') {
        if (typeof b.tool_use_id !== 'string') continue
        if (results.has(b.tool_use_id)) continue
        const size = resultSize(b.content)
        results.set(b.tool_use_id, {
          at,
          // ONLY `is_error === true` is a failure. An absent is_error means the harness did not flag
          // one — real transcripts here omit the field entirely on some results (AskUserQuestion,
          // for one), and reading `undefined` as a failure would invent errors that never happened.
          isError: b.is_error === true,
          isErrorPresent: 'is_error' in b,
          size,
        })
      }
    }
  }

  // How many tool_use blocks shared the issuing assistant message — the denominator for splitting
  // that message's output tokens across its calls.
  const perMessage = new Map()
  for (const r of list) {
    const ids = contentBlocks(r).filter(b => b?.type === 'tool_use' && typeof b.id === 'string').map(b => b.id)
    if (ids.length) for (const id of ids) perMessage.set(id, ids.length)
  }
  for (const c of calls.values()) c.siblingToolUses = perMessage.get(c.id) ?? 1

  const paired = [...calls.values()].map(c => {
    const res = results.get(c.id) ?? null
    return {
      ...c,
      resolved: !!res,
      state: !res ? 'unresolved' : res.isError ? 'failure' : 'success',
      isErrorPresent: res ? res.isErrorPresent : null,
      resultSize: res ? res.size : null,
      // Duration is the gap between two RECORD timestamps, so it includes harness and model latency
      // around the tool, not just the tool's own execution. Labelled `estimated` everywhere it
      // surfaces because no transcript field carries true tool execution time (verified: no
      // duration/elapsed/ms key exists on toolUseResult in any transcript under ~/.claude/projects).
      durationMs: res && isNum(res.at) && isNum(c.at) && res.at >= c.at ? res.at - c.at : null,
    }
  })

  const issuedIds = new Set(calls.keys())
  const orphanResults = [...results.keys()].filter(id => !issuedIds.has(id)).length

  return { calls: paired, orphanResults }
}

const mean = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)

/**
 * Per-tool efficiency table.
 *
 * TOKEN ATTRIBUTION CHOICE (stated because the number is meaningless without it):
 * `tokensPerSuccessfulCall` attributes the `output_tokens` of the assistant message that ISSUED the
 * tool_use, split evenly across the tool_use blocks in that same message, then averaged over the
 * successful calls that had a usage record.
 *
 *   Why this one: those tokens are the ones the model demonstrably spent to produce the call, they
 *   are attributable to a single tool with no cross-turn guessing, and even splitting is the only
 *   defensible division when a message issues several calls at once (nothing in the transcript says
 *   which block cost more).
 *   What it deliberately EXCLUDES: the input-token cost of feeding the tool's result back on the
 *   next turn. For a tool like Read that returns far more than it costs to call, that is the larger
 *   number — so this metric measures the price of ASKING, not the price of the tool overall. The
 *   field name and the `basis` string say so, and `denominator` is published so the average can be
 *   recomputed by hand.
 *
 * Low-n rows are marked with `lowSample: true`, not hidden — a tool used twice is information, and
 * dropping it makes the table look more complete than it is.
 */
export function toolEfficiency(records = [], opts = {}) {
  const minSample = isNum(opts.minSample) ? opts.minSample : MIN_SAMPLE
  const { calls, orphanResults } = extractToolCalls(records)

  const byName = new Map()
  for (const c of calls) {
    let g = byName.get(c.name)
    if (!g) { g = { name: c.name, calls: [] }; byName.set(c.name, g) }
    g.calls.push(c)
  }

  let rows = [...byName.values()].map(g => {
    const n = g.calls.length
    const success = g.calls.filter(c => c.state === 'success')
    const failure = g.calls.filter(c => c.state === 'failure')
    const unresolved = g.calls.filter(c => c.state === 'unresolved')
    const resolved = success.length + failure.length

    const durations = g.calls.map(c => c.durationMs).filter(isNum)
    const sizes = success.map(c => c.resultSize).filter(isNum)
    const sizeMissing = success.length - sizes.length

    const attributable = success.filter(c => isNum(c.usageOutputTokens))
    const perCall = attributable.map(c => c.usageOutputTokens / (c.siblingToolUses || 1))

    return {
      name: g.name,
      n,
      calls: n,
      success: success.length,
      failure: failure.length,
      unresolved: unresolved.length,
      resolved,
      // null, not 0 and not 1: with nothing resolved there is no rate to report.
      successRate: resolved ? +(success.length / resolved).toFixed(4) : null,
      successRateDenominator: resolved,
      successRateBasis: 'resolved calls only (success + failure); unresolved calls are excluded and counted separately',
      unresolvedShare: n ? +(unresolved.length / n).toFixed(4) : null,
      lowSample: resolved < minSample,
      minSample,

      meanDurationMs: durations.length ? Math.round(mean(durations)) : null,
      durationDenominator: durations.length,
      durationEstimated: true,
      durationBasis: 'tool_result record timestamp minus tool_use record timestamp — includes model and harness latency, not tool execution time alone',

      meanOutputBytes: sizes.length ? Math.round(mean(sizes)) : null,
      outputDenominator: sizes.length,
      outputSizeComplete: sizeMissing === 0,
      outputSizeUnmeasured: sizeMissing,

      tokensPerSuccessfulCall: perCall.length ? Math.round(mean(perCall)) : null,
      tokensDenominator: perCall.length,
      tokensUnattributed: success.length - perCall.length,
      tokensEstimated: true,
      tokensBasis: 'issuing assistant message output_tokens split evenly across its tool_use blocks; EXCLUDES the input-token cost of feeding the result back',
    }
  })

  rows.sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))

  const bounds = []
  if (isNum(opts.limit) && opts.limit >= 0 && rows.length > opts.limit) {
    const cut = rows.slice(opts.limit)
    bounds.push({
      bound: 'limit', limit: opts.limit, totalTools: rows.length, shown: opts.limit,
      hiddenTools: cut.length, hiddenCalls: cut.reduce((s, r) => s + r.calls, 0),
      effect: 'tools beyond the limit are not listed — their calls are still inside totals below',
    })
    rows = rows.slice(0, opts.limit)
  }

  const all = calls
  const totalResolved = all.filter(c => c.state !== 'unresolved').length
  const totalSuccess = all.filter(c => c.state === 'success').length
  const totalUnresolved = all.length - totalResolved

  return {
    tools: rows,
    toolCount: byName.size,
    totals: {
      calls: all.length,
      success: totalSuccess,
      failure: totalResolved - totalSuccess,
      unresolved: totalUnresolved,
      resolved: totalResolved,
      successRate: totalResolved ? +(totalSuccess / totalResolved).toFixed(4) : null,
      successRateDenominator: totalResolved,
      // The two extremes, published so a reader can see the size of the ambiguity that the
      // unresolved bucket represents instead of taking the middle figure on faith.
      successRateIfUnresolvedAllSucceeded: all.length ? +((totalSuccess + totalUnresolved) / all.length).toFixed(4) : null,
      successRateIfUnresolvedAllFailed: all.length ? +(totalSuccess / all.length).toFixed(4) : null,
      lowSampleTools: rows.filter(r => r.lowSample).length,
      minSample,
    },
    // A non-zero count means the record window does not contain every call it has results for, so
    // unresolved counts are an upper bound on genuinely-unanswered calls.
    orphanResults,
    complete: orphanResults === 0 && totalUnresolved === 0,
    bounds,
  }
}
