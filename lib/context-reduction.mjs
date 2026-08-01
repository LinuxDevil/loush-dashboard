// lib/context-reduction.mjs — an honest, per-user "always-on vs deferred" context-savings figure.
//
// THE CLAIM THIS MODULE MAKES, IN FULL
//
//   For user U, at snapshot time T, across the N capabilities installed for U whose token costs were
//   both measured: loading only their metadata costs A tokens per session, whereas loading all of
//   them in full would cost F tokens per session. The deferred-loading saving is (F - A) tokens per
//   session, which is (F - A) / F of F.
//
// Everything in that sentence is reported as a field. The percentage is never returned without its
// numerator and denominator, because a percentage alone is unfalsifiable: you cannot check it, you
// cannot reproduce it, and you cannot notice when it breaks.
//
// WHAT IT IS *NOT* A PERCENTAGE OF
// It is NOT a percentage of the context window, of a session's actual token usage, or of anyone's
// bill. Those are different denominators with wildly different values, and quoting a number computed
// against one while implying another is the single easiest way to produce a true-but-lying metric.
// `denominatorMeans` spells this out in the returned object so it travels with the number.
//
// THE FAILURE MODE THIS IS BUILT AGAINST
// server/index.mjs line 1594-1600 sums the always-on budget from contributors that include
// `{ name: 'system prompt', tokens: 2100, est: true }` and `{ kind: 'mcp', estTokens: 600 }` — a
// hardcoded 600 tokens per MCP server, guessed, flagged `est: true`, and then added into the same
// total as measured file sizes. Divide a measured number by a total containing guesses and you get
// an impressive-looking figure whose error bars nobody can compute. So: by default, estimated inputs
// are EXCLUDED from both sides and listed separately. `includeEstimated: true` is available, and it
// stamps `basis: 'partly-estimated'` on the result so the caller cannot forget.
//
// If either side is unmeasured, the answer is null with a reason. Never a number.

/** A token count is usable only if it is a finite, non-negative number. `undefined`, `null`, NaN and
 *  negatives are all "not measured" — distinctly different from "measured as 0". */
const measured = v => Number.isFinite(v) && v >= 0

export const EXCLUSION = {
  ALWAYS_ON_UNMEASURED: 'always-on token count not measured',
  FULL_UNMEASURED: 'full (on-invoke) token count not measured',
  BOTH_UNMEASURED: 'neither token count was measured',
  ESTIMATED: 'token count is an ESTIMATE, not a measurement',
  INCOHERENT: 'always-on cost exceeds full cost, which cannot be true for a deferred capability',
}

/**
 * Compute the deferred-loading context saving for one user.
 *
 * @param {object}  a
 * @param {string}  a.userId       Who this is about. A per-user metric without a user id is a
 *                                 per-machine metric mislabelled; absent, the result is still
 *                                 computed but `scope` says 'unattributed'.
 * @param {Array}   a.items        [{ name, kind, alwaysOnTokens, fullTokens, estimated?, mode? }]
 *                                 alwaysOnTokens = tokens present in EVERY session (the metadata /
 *                                 description listing). fullTokens = tokens when the capability
 *                                 actually loads.
 * @param {object}  a.snapshot     { at, source } — when and from what these counts were read.
 * @param {boolean} a.includeEstimated  default false.
 * @param {object}  a.tokenCounting { method, exact } — how the counts were produced.
 */
export function computeContextReduction(args) {
  // A default parameter only fires on `undefined`, so `computeContextReduction(null)` would destructure
  // null and throw. Callers pass whatever an upstream reader returned — including null on a failed
  // read — and this metric must degrade to "unknown, here's why", never to a stack trace.
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
  const { userId = null, items = [], snapshot = null, includeEstimated = false, tokenCounting = null } = a
  const list = Array.isArray(items) ? items.filter(i => i && typeof i === 'object' && !Array.isArray(i)) : []

  const provenance = {
    userId: userId || null,
    scope: userId ? 'per-user' : 'unattributed',
    scopeNote: userId ? null : 'no user id supplied — this figure describes whatever capability set was passed in, and must not be presented as any particular person\'s number',
    snapshot: snapshot && Number.isFinite(snapshot.at)
      ? { at: snapshot.at, iso: new Date(snapshot.at).toISOString(), source: snapshot.source || 'unspecified' }
      : null,
    snapshotNote: snapshot && Number.isFinite(snapshot.at) ? null
      : 'no snapshot time/source supplied — the reader cannot tell WHEN these counts were true or WHERE they came from, so the figure is not independently checkable',
    tokenCounting: tokenCounting || { method: 'unspecified', exact: null },
    tokenCountingNote: tokenCounting && tokenCounting.exact === true ? null
      : 'token counts are not attested exact (this repo uses a ~4-chars-per-token heuristic in server/index.mjs:569); the RATIO is far more robust to that than either absolute figure, since the same bias appears in numerator and denominator',
  }

  const included = [], excluded = []

  for (const it of list) {
    const name = typeof it.name === 'string' ? it.name : '(unnamed)'
    const entry = { name, kind: it.kind || null, alwaysOnTokens: it.alwaysOnTokens ?? null, fullTokens: it.fullTokens ?? null }
    const aOk = measured(it.alwaysOnTokens), fOk = measured(it.fullTokens)

    if (!aOk && !fOk) { excluded.push({ ...entry, reason: EXCLUSION.BOTH_UNMEASURED }); continue }
    if (!aOk) { excluded.push({ ...entry, reason: EXCLUSION.ALWAYS_ON_UNMEASURED }); continue }
    if (!fOk) { excluded.push({ ...entry, reason: EXCLUSION.FULL_UNMEASURED }); continue }
    if (it.estimated === true && !includeEstimated) { excluded.push({ ...entry, reason: EXCLUSION.ESTIMATED, estimated: true }); continue }
    // A capability whose always-on cost exceeds its full cost is a data bug, not a negative saving.
    // Letting it through would silently shrink the numerator with a number nobody can defend.
    if (it.alwaysOnTokens > it.fullTokens) { excluded.push({ ...entry, reason: EXCLUSION.INCOHERENT }); continue }

    included.push({ ...entry, estimated: it.estimated === true, saved: it.fullTokens - it.alwaysOnTokens })
  }

  const base = {
    ...provenance,
    itemsSupplied: list.length,
    itemsIncluded: included.length,
    itemsExcluded: excluded.length,
    excluded,
    includeEstimated,
  }

  // ---- the null branches. Each names WHICH side failed. ----
  if (list.length === 0) {
    return { ...base, reductionPct: null, savedTokens: null, alwaysOnTokens: null, fullTokens: null,
      reason: 'no-capabilities-supplied',
      because: 'no capability records were supplied, so neither the always-on side nor the full-install side was measured. There is no baseline to compute a percentage against.' }
  }
  if (included.length === 0) {
    const reasons = [...new Set(excluded.map(e => e.reason))]
    return { ...base, reductionPct: null, savedTokens: null, alwaysOnTokens: null, fullTokens: null,
      reason: 'no-measured-capabilities',
      because: `all ${list.length} supplied capabilities were excluded (${reasons.join('; ')}). A savings figure here would be computed from a guessed baseline, which is precisely the number this module exists not to print.` }
  }

  const alwaysOnTokens = included.reduce((s, i) => s + i.alwaysOnTokens, 0)
  const fullTokens = included.reduce((s, i) => s + i.fullTokens, 0)

  if (fullTokens === 0) {
    return { ...base, reductionPct: null, savedTokens: null, alwaysOnTokens, fullTokens,
      reason: 'denominator-zero',
      because: 'the full-install total across measured capabilities is 0 tokens, so there is nothing to be a percentage of. Reporting 0% or 100% here would both be fabrications.' }
  }

  const savedTokens = fullTokens - alwaysOnTokens
  const anyEstimated = included.some(i => i.estimated)

  // Coverage matters as much as the ratio. 94% measured over 3 of 40 capabilities is a different
  // claim from 94% over 40 of 40, and only the numerator/denominator pair plus coverage lets a
  // reader tell them apart.
  const coverage = {
    itemsMeasured: included.length,
    itemsSupplied: list.length,
    itemsMeasuredPct: included.length / list.length,
    complete: excluded.length === 0,
    note: excluded.length === 0 ? null
      : `${excluded.length} of ${list.length} capabilities were excluded for lack of measurement; their token cost is UNKNOWN, not zero, so the totals below are neither an upper nor a lower bound on the full install — they describe the measured subset only`,
  }

  return {
    ...base,
    // --- the falsifiable core: both operands, then the ratio derived from them ---
    numerator: savedTokens,
    numeratorMeans: 'tokens per session NOT spent because these capabilities defer their body until invoked = fullTokens - alwaysOnTokens, over the measured subset',
    denominator: fullTokens,
    denominatorMeans: 'tokens per session that these same measured capabilities would cost if every one of them were loaded in full into every session. NOT the context window, NOT observed session usage, NOT a bill.',
    savedTokens,
    alwaysOnTokens,
    fullTokens,
    reductionPct: (savedTokens / fullTokens) * 100,
    basis: anyEstimated ? 'partly-estimated' : 'measured',
    basisNote: anyEstimated
      ? `includeEstimated=true: ${included.filter(i => i.estimated).length} of ${included.length} included capabilities carry ESTIMATED token counts, so this figure is part measurement and part guess and its error is not computable`
      : 'every included capability carries a measured (non-estimated) token count on both sides',
    coverage,
    claim:
      `Across ${included.length} measured capabilities${userId ? ` for user ${userId}` : ''}${provenance.snapshot ? ` as of ${provenance.snapshot.iso}` : ''}: `
      + `${alwaysOnTokens.toLocaleString()} tok/session always-on vs ${fullTokens.toLocaleString()} tok/session if all were fully loaded — `
      + `${savedTokens.toLocaleString()} tok/session saved, ${((savedTokens / fullTokens) * 100).toFixed(1)}% of ${fullTokens.toLocaleString()}.`
      + (excluded.length ? ` ${excluded.length} further capabilities were excluded as unmeasured and are NOT represented.` : ''),
    reason: null,
    // Sorted by absolute saving so the claim can be audited item by item; ties broken by name so the
    // output is deterministic.
    perItem: [...included].sort((a, b) => b.saved - a.saved || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  }
}

/**
 * Adapter for the shape this repo already produces.
 *
 * `server/index.mjs capabilityLedger()` emits rows with exactly `{ name, kind, alwaysOnTokens,
 * fullTokens }` — see server/index.mjs:2892. That is the data this metric needs and it already
 * exists, so this reuses it rather than inventing a parallel source.
 *
 * What it does NOT reuse: the `alwaysOn` total from hubResolve() (server/index.mjs:1600). That total
 * folds in `{ name: 'system prompt', tokens: 2100, est: true }` and a flat 600-token-per-MCP-server
 * guess. Those are estimates and they have no `fullTokens` counterpart at all, so using them as a
 * denominator would be the guessed baseline this module is written to refuse.
 */
export function fromCapabilityLedger(ledger, opts) {
  // Same null-vs-undefined guard as above: a caller handing us `null` options must not crash.
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {}
  const { userId = null, snapshot = null, includeEstimated = false, tokenCounting = null } = o
  const rows = ledger && typeof ledger === 'object' && Array.isArray(ledger.items) ? ledger.items : null
  if (!rows) {
    return computeContextReduction({ userId, items: [], snapshot, includeEstimated, tokenCounting })
  }
  const items = rows.filter(r => r && typeof r === 'object').map(r => ({
    name: r.name, kind: r.kind,
    alwaysOnTokens: r.alwaysOnTokens,
    fullTokens: r.fullTokens,
    // A row whose fullTokens is 0 while alwaysOnTokens is 0 carries no information (server/index.mjs
    // pushes plugins with descTokens:0, fullTokens:0). Marking it estimated keeps it out of the
    // default computation instead of padding the denominator with zeros.
    estimated: r.estimated === true || (r.alwaysOnTokens === 0 && r.fullTokens === 0),
  }))
  return computeContextReduction({ userId, items, snapshot, includeEstimated, tokenCounting })
}

/** One-line renderer. Refuses to emit a number when there isn't one. */
export function formatReduction(r) {
  if (!r || typeof r !== 'object') return 'context reduction: no result'
  if (r.reductionPct == null) return `context reduction: UNAVAILABLE (${r.reason}) — ${r.because}`
  return `context reduction: ${r.reductionPct.toFixed(1)}% = ${r.numerator.toLocaleString()} / ${r.denominator.toLocaleString()} tok/session `
    + `[${r.basis}, ${r.coverage.itemsMeasured}/${r.coverage.itemsSupplied} capabilities measured]`
}
