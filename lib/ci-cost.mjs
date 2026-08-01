// ci-cost.mjs — turn the Claude action's `execution_file` artifact into a cost record.
//
// The input is arbitrary JSON produced by a CI job on someone else's machine. It may be truncated by
// a killed runner, wrapped by a newer action version, or empty because the step never ran. None of
// those are exceptions: they are findings, and each one has to arrive at the caller as a reason
// string rather than a thrown error or a $0 that looks like a successful free run.

const isNum = v => typeof v === 'number' && Number.isFinite(v)

/** Parse to a JS value without throwing. Accepts an already-parsed object so callers need not double-guess. */
export function parseExecutionJson(input) {
  if (input == null) return { ok: false, reason: 'empty-input' }
  if (typeof input === 'object') return { ok: true, value: input }
  if (typeof input !== 'string') return { ok: false, reason: `unsupported-input-type:${typeof input}` }
  const text = input.trim()
  if (!text) return { ok: false, reason: 'empty-input' }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (e) {
    // A runner killed mid-write leaves valid JSON up to the cut point. Report that specifically:
    // "your artifact is truncated" is actionable, "unexpected token" is not.
    //
    // Detection is by error POSITION, not by message text: V8 stopped emitting "Unexpected end of
    // JSON input" for most truncations and now reports "Expected ',' or '}' ... at position N".
    // Matching on the old wording silently reclassified every truncated artifact as invalid-json.
    const pos = Number((e.message.match(/at position (\d+)/) || [])[1])
    const truncated = /Unexpected end of (JSON|input)/i.test(e.message) ||
      (Number.isFinite(pos) && pos >= text.length - 1)
    return { ok: false, reason: truncated ? 'truncated-json' : 'invalid-json', detail: e.message }
  }
}

/**
 * Find the event array. The action has shipped both a bare top-level array and a `{events:[...]}`
 * envelope; a caller that only handled one of them reported "no result" for half the fleet.
 */
export function extractEvents(value) {
  if (Array.isArray(value)) return { ok: true, events: value, shape: 'top-level-array' }
  if (value && typeof value === 'object') {
    if (Array.isArray(value.events)) return { ok: true, events: value.events, shape: 'events-envelope' }
    // Recognise the envelope-with-no-events case distinctly from "wrong file entirely".
    if ('events' in value) return { ok: false, reason: 'events-field-is-not-an-array' }
  }
  return { ok: false, reason: 'unrecognised-shape', shape: Array.isArray(value) ? 'array' : typeof value }
}

/**
 * Ingest an execution file into a cost record.
 *
 * The returned record ALWAYS carries `verified`. It is true only when a `result` element was found
 * and it actually carried a finite, non-negative `total_cost_usd`. Everything else — no result
 * element, a result element with the field absent, a field holding a string or NaN — yields
 * `cost: null` with a reason. A CI run whose cost we failed to read is not a free CI run, and the
 * only way to keep those two apart downstream is to never emit 0 for the second one.
 *
 * @param {string|object} input raw file text or pre-parsed JSON
 * @param {{source?: string, maxEvents?: number}} [opts]
 */
export function ingestExecutionFile(input, opts = {}) {
  const source = opts.source ?? null
  const base = { ok: false, source, cost: null, durationMs: null, verified: false, results: [], chosen: null, bounds: [] }

  const parsed = parseExecutionJson(input)
  if (!parsed.ok) return { ...base, reason: parsed.reason, detail: parsed.detail ?? null }

  const ext = extractEvents(parsed.value)
  if (!ext.ok) return { ...base, reason: ext.reason }

  const bounds = []
  let events = ext.events
  if (isNum(opts.maxEvents) && opts.maxEvents >= 0 && events.length > opts.maxEvents) {
    // Truncating the scan can hide the very element we are looking for, so the cap and the fact that
    // it bit are both published. A silent slice here would produce "no result element" on a file
    // that plainly has one.
    bounds.push({ bound: 'maxEvents', limit: opts.maxEvents, total: events.length, scanned: opts.maxEvents, effect: 'events beyond the limit were not scanned for result elements' })
    events = events.slice(0, opts.maxEvents)
  }

  const results = []
  events.forEach((e, index) => {
    if (!e || typeof e !== 'object' || e.type !== 'result') return
    const rawCost = e.total_cost_usd
    let cost = null, costReason = null
    if (!('total_cost_usd' in e)) costReason = 'no-total_cost_usd-field'
    else if (rawCost === null) costReason = 'total_cost_usd-is-null'
    else if (!isNum(rawCost)) costReason = `total_cost_usd-not-a-number:${typeof rawCost}`
    else if (rawCost < 0) costReason = 'total_cost_usd-negative'
    else cost = rawCost

    const rawDur = e.duration_ms
    const durationMs = isNum(rawDur) && rawDur >= 0 ? rawDur : null

    results.push({
      index,
      cost,
      costReason,
      verified: cost !== null,
      durationMs,
      durationReason: durationMs === null ? (('duration_ms' in e) ? 'duration_ms-unusable' : 'no-duration_ms-field') : null,
      subtype: typeof e.subtype === 'string' ? e.subtype : null,
      isError: typeof e.is_error === 'boolean' ? e.is_error : null,
      numTurns: isNum(e.num_turns) ? e.num_turns : null,
      sessionId: typeof e.session_id === 'string' ? e.session_id : null,
    })
  })

  if (!results.length) {
    // The distinction that matters: the file parsed, we understood its shape, and it contains no
    // result element. That is "cost unknown", never "cost zero".
    return {
      ...base,
      reason: 'no-result-element',
      shape: ext.shape,
      eventCount: ext.events.length,
      bounds,
      note: 'file parsed and had a recognised shape but contained no type:"result" element — cost is unknown, not zero',
    }
  }

  // Selection rule, stated in the payload so a reader can disagree with it rather than guess at it:
  // the action appends its terminating result last, so the LAST result element is the run's outcome.
  // Earlier ones come from resumed or nested executions within the same file.
  const chosenIdx = results.length - 1
  const chosen = results[chosenIdx]
  if (results.length > 1) {
    bounds.push({
      bound: 'multiple-result-elements',
      total: results.length,
      chosenElementIndex: chosen.index,
      why: 'last result element in document order — the action appends the terminating result last; earlier ones are from resumed or nested executions',
      effect: 'costs from the non-chosen result elements are listed in results[] but are NOT summed into cost',
    })
  }

  return {
    ok: true,
    source,
    shape: ext.shape,
    eventCount: ext.events.length,
    cost: chosen.cost,
    // verified answers "did we read a real dollar figure", not "did the run succeed".
    verified: chosen.verified,
    reason: chosen.verified ? null : chosen.costReason,
    durationMs: chosen.durationMs,
    isError: chosen.isError,
    numTurns: chosen.numTurns,
    sessionId: chosen.sessionId,
    resultCount: results.length,
    results,
    chosen: { index: chosen.index, ordinal: chosenIdx },
    bounds,
    // Cost here is REPORTED by the action, not recomputed from tokens by lib/pricing.mjs. Labelled so
    // a mixed ledger can tell an observed invoice figure from one this repo modelled.
    basis: 'observed:total_cost_usd reported by the Claude action',
  }
}

/**
 * Roll several execution files into one total.
 *
 * `usd` sums ONLY the verified records. `unverified` is carried alongside with its own count so the
 * headline can never be read as complete when it is not — a total of $4.10 over 10 runs means
 * something very different if 6 of them were unpriceable.
 */
export function summarizeRuns(records = []) {
  const list = Array.isArray(records) ? records : []
  const verified = list.filter(r => r && r.verified && isNum(r.cost))
  const unverified = list.filter(r => !r || !r.verified || !isNum(r.cost))
  const durations = verified.map(r => r.durationMs).filter(isNum)
  return {
    runs: list.length,
    verifiedRuns: verified.length,
    unverifiedRuns: unverified.length,
    usd: verified.length ? verified.reduce((s, r) => s + r.cost, 0) : null,
    basis: 'sum of verified runs only',
    coverage: list.length ? +(verified.length / list.length).toFixed(4) : null,
    complete: list.length > 0 && unverified.length === 0,
    unverifiedReasons: unverified.reduce((m, r) => { const k = (r && r.reason) || 'unknown'; m[k] = (m[k] || 0) + 1; return m }, {}),
    totalDurationMs: durations.length ? durations.reduce((a, b) => a + b, 0) : null,
    durationCoverage: verified.length ? +(durations.length / verified.length).toFixed(4) : null,
  }
}
