// routing-policy.mjs — 113. An editable table: task signal → agent type → model tier, plus a
// complexity override, plus a shadowing check.
//
// THIS IS A POLICY, NOT A PREDICTION. The table below is a statement of intent — "we choose to send
// doc edits to haiku" — and nothing here claims it will save money, be faster, or be as good. The
// only number this module produces about cost is `modelledCostEffect()`, which returns
// `modelled: true` and an `assumption` string saying exactly what was assumed and that nobody ran
// it. It is arithmetic over prices YOU supply — not a measurement, not a forecast. There is no
// outcome data in this repo to fit one against.
//
// THE COMPLEXITY CLASSIFIER IS INJECTED, NOT IMPLEMENTED HERE.
// `lib/complexity.mjs` (exports `classifyConversation`, `tierDistribution`) is the repo's single
// classifier. It is NOT present in the tree this file was written in, so importing it by path
// would have been an import of something unverifiable. Writing a second signal table here would
// have been worse: two classifiers that disagree is exactly the failure this ticket exists to
// prevent. So the classifier arrives as a parameter against the documented contract below, and
// when none is supplied the override DOES NOT RUN and says so — it never falls back to a private
// guess and never assumes "moderate".
//
// See INTEGRATION-tickets.md for the one-line wiring that passes `classifyConversation` in.

export const MODEL_TIERS = ['haiku', 'sonnet', 'opus']           // ordered cheap → capable
export const COMPLEXITY_LEVELS = ['trivial', 'moderate', 'complex']  // ordered low → high
export const AGENT_TYPES = ['general-purpose', 'code-reviewer', 'debugger', 'doc-writer', 'test-writer', 'security-reviewer', 'architect', 'explorer']

/**
 * CLASSIFIER CONTRACT — what `opts.classifier` must be.
 *
 *   classifier(taskText: string) => one of:
 *     · a string                          — a complexity level OR a model tier
 *     · { level }  | { complexity }       — a complexity level
 *     · { tier }   | { model }            — a model tier
 *     · null / undefined / anything else  — "could not classify"
 *   optionally carrying `{ reason }`, which is surfaced verbatim in the route.
 *
 * A model tier is accepted because `lib/complexity.mjs` reports a TIER per prompt
 * (`classifyConversation` / `tierDistribution`). Mapping it onto a complexity level is done by
 * position — haiku↔trivial, sonnet↔moderate, opus↔complex — and that mapping is an ASSUMPTION this
 * module states out loud (`normalizeComplexity().assumption`), not a fact it verified. A caller who
 * disagrees should pass an adapter that returns `{level}` directly.
 *
 * The classifier is called inside a try/catch: a classifier that throws must not take routing down,
 * and its failure is reported as "not classified", never swallowed into "simple".
 */
export const CLASSIFIER_CONTRACT = Object.freeze({
  accepts: 'taskText: string',
  returns: ['"trivial"|"moderate"|"complex"', '"haiku"|"sonnet"|"opus"', '{level|complexity}', '{tier|model}'],
  onUnknown: 'route() reports override.applied=false with a reason; the table tier stands unadjusted',
  tierToLevel: 'haiku→trivial, sonnet→moderate, opus→complex (positional, an assumption — not verified)',
})

/**
 * The explicit fall-through. A signal that matches no rule lands HERE and every route says so
 * (`matched:false`, `ruleId:null`, and this reason verbatim). It is never a silent default: an
 * unrouted task that quietly gets sonnet looks identical to a task the table deliberately routed
 * to sonnet, and those need different fixes — one is a missing rule, the other is working.
 */
export const DEFAULT_ROUTE = Object.freeze({
  agent: 'general-purpose',
  model: 'sonnet',
  reason: 'NO RULE MATCHED — this is the explicit default, not a routing decision about this task. If you see this often, the table is missing a rule.',
})

/**
 * The table. Order matters: FIRST match wins, so broader rules must come after narrower ones.
 * `checkShadowing()` proves that property rather than trusting it.
 *
 * `minModel` is a floor the complexity override cannot go below (a security review does not get
 * downgraded to haiku just because it was phrased simply).
 */
export const RULES = Object.freeze([
  { id: 'security-review', keywords: ['security review', 'threat model', 'vulnerability', 'auth flow', 'credential'], agent: 'security-reviewer', model: 'opus', minModel: 'sonnet', why: 'a missed authz hole is not caught by a later commit' },
  { id: 'incident-debug', keywords: ['race condition', 'deadlock', 'memory leak', 'flaky test', 'intermittent', 'root cause'], agent: 'debugger', model: 'opus', minModel: 'sonnet', why: 'unbounded search; cheap models loop' },
  { id: 'architecture', keywords: ['architecture', 'redesign', 'migration plan', 'decompose', 'system design'], agent: 'architect', model: 'opus', minModel: 'sonnet', why: 'expensive to reverse' },
  { id: 'refactor', keywords: ['refactor', 'restructure', 'extract module', 'deduplicate'], agent: 'architect', model: 'sonnet', minModel: 'sonnet', why: 'wide blast radius, but a known shape' },
  { id: 'code-review', keywords: ['review this', 'code review', 'pr review', 'diff review'], agent: 'code-reviewer', model: 'sonnet', minModel: 'sonnet', why: 'judgement over a bounded diff' },
  { id: 'write-tests', keywords: ['write tests', 'unit test', 'add coverage', 'test case'], agent: 'test-writer', model: 'sonnet', minModel: 'haiku', why: 'mechanical once the behaviour is decided' },
  { id: 'explore', keywords: ['where is', 'find the', 'search for', 'which file', 'how does'], agent: 'explorer', model: 'haiku', minModel: 'haiku', why: 'grep with a summary; capability is not the constraint' },
  { id: 'docs', keywords: ['readme', 'changelog', 'docstring', 'document the', 'write docs'], agent: 'doc-writer', model: 'haiku', minModel: 'haiku', why: 'prose against a known structure' },
  { id: 'trivial-edit', keywords: ['typo', 'rename', 'bump version', 'formatting', 'lint fix'], agent: 'general-purpose', model: 'haiku', minModel: 'haiku', why: 'one obviously-correct answer' },
])

const tierIndex = m => MODEL_TIERS.indexOf(m)
const norm = s => String(s).toLowerCase()

/** Does this rule match this text? Substring on lowercased keywords — deliberately dumb and auditable. */
export function ruleMatches(rule, text) {
  const t = norm(text)
  return (rule.keywords || []).some(k => t.includes(norm(k)))
}

// ---------------------------------------------------------------------------------------------
// Normalising whatever the injected classifier returned
// ---------------------------------------------------------------------------------------------
/**
 * Whatever the classifier gave back → `{level, reason, assumption}`. NEVER THROWS.
 *
 * An unrecognised value returns `level: null` and names the value, with the allowed sets listed —
 * it is never coerced to the nearest tier and never defaulted to "moderate". A classifier that has
 * been changed under us must surface as "not classified", not as a confident wrong answer.
 */
export function normalizeComplexity(raw) {
  const reasonOf = v => (v && typeof v === 'object' && typeof v.reason === 'string' ? v.reason : null)
  const pick = v => {
    if (typeof v === 'string') return v
    if (v && typeof v === 'object') return v.level ?? v.complexity ?? v.tier ?? v.model ?? null
    return null
  }
  const val = pick(raw)
  if (val == null) return { level: null, raw, reason: reasonOf(raw) || `the classifier returned nothing this module recognises (${raw === null ? 'null' : typeof raw}) — see CLASSIFIER_CONTRACT`, assumption: null }
  const s = String(val).toLowerCase()
  if (COMPLEXITY_LEVELS.includes(s)) return { level: s, raw, reason: reasonOf(raw) || `classifier reported complexity "${s}"`, assumption: null }
  const ti = MODEL_TIERS.indexOf(s)
  if (ti >= 0) return {
    level: COMPLEXITY_LEVELS[ti], raw,
    reason: reasonOf(raw) || `classifier reported model tier "${s}"`,
    // Stated, not hidden: the classifier reported a TIER and this module read it as a LEVEL.
    assumption: `tier "${s}" was read as complexity "${COMPLEXITY_LEVELS[ti]}" by position (${CLASSIFIER_CONTRACT.tierToLevel}). Nobody verified that the classifier means the same thing by it.`,
  }
  return { level: null, raw, reason: `"${String(val)}" is neither a complexity level nor a model tier`, allowed: { levels: [...COMPLEXITY_LEVELS], tiers: [...MODEL_TIERS] }, assumption: null }
}

/** NEVER THROWS. Rejects unknown enum values BY NAME with the allowed set. */
export function validateRules(rules = RULES) {
  if (!Array.isArray(rules)) return { ok: false, errors: [{ field: '(root)', reason: `rules must be an array, received ${typeof rules}` }] }
  const errors = [], ids = new Set()
  rules.forEach((r, i) => {
    const at = `rules[${i}]`
    if (!r || typeof r !== 'object') { errors.push({ field: at, reason: 'each rule must be an object' }); return }
    if (typeof r.id !== 'string' || !r.id) errors.push({ field: `${at}.id`, value: r.id ?? null, reason: 'a rule id is required — shadowing reports name rules by id' })
    else if (ids.has(r.id)) errors.push({ field: `${at}.id`, value: r.id, reason: 'duplicate rule id — the second is indistinguishable from the first in any report' })
    else ids.add(r.id)
    if (!Array.isArray(r.keywords) || !r.keywords.length) errors.push({ field: `${at}.keywords`, value: r.keywords ?? null, reason: 'a rule with no keywords can never match' })
    if (!MODEL_TIERS.includes(r.model)) errors.push({ field: `${at}.model`, value: r.model ?? null, reason: `"${String(r.model)}" is not a model tier`, allowed: [...MODEL_TIERS] })
    if (r.minModel !== undefined && !MODEL_TIERS.includes(r.minModel)) errors.push({ field: `${at}.minModel`, value: r.minModel, reason: `"${String(r.minModel)}" is not a model tier`, allowed: [...MODEL_TIERS] })
    if (!AGENT_TYPES.includes(r.agent)) errors.push({ field: `${at}.agent`, value: r.agent ?? null, reason: `"${String(r.agent)}" is not a known agent type`, allowed: [...AGENT_TYPES] })
  })
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] }
}

// ---------------------------------------------------------------------------------------------
// Shadowing — an unreachable row is a rule the author believes is in force and is not
// ---------------------------------------------------------------------------------------------
/**
 * Rule B is UNREACHABLE if, for every keyword of B, some EARLIER rule A also matches that keyword
 * — then no input that would have selected B ever gets past A. Partial shadowing (some but not all
 * of B's keywords captured earlier) is reported separately: it is not a dead row, but it means B
 * fires for fewer inputs than its author thinks.
 *
 * NEVER THROWS.
 */
export function checkShadowing(rules = RULES) {
  if (!Array.isArray(rules)) return { ok: false, reason: `rules must be an array, received ${typeof rules}` }
  const unreachable = [], partial = []
  for (let i = 0; i < rules.length; i++) {
    const b = rules[i]
    if (!b || !Array.isArray(b.keywords) || !b.keywords.length) continue
    const shadowedKw = []
    for (const kw of b.keywords) {
      for (let j = 0; j < i; j++) {
        const a = rules[j]
        if (!a || !Array.isArray(a.keywords)) continue
        if (ruleMatches(a, kw)) { shadowedKw.push({ keyword: kw, by: a.id, viaKeyword: a.keywords.find(k => norm(kw).includes(norm(k))) }); break }
      }
    }
    if (!shadowedKw.length) continue
    const by = [...new Set(shadowedKw.map(s => s.by))]
    const entry = { ruleId: b.id, index: i, shadowedKeywords: shadowedKw, shadowedBy: by }
    if (shadowedKw.length === b.keywords.length)
      unreachable.push({ ...entry, reason: `rule "${b.id}" is UNREACHABLE: all ${b.keywords.length} of its keywords are already matched by earlier rule(s) ${by.join(', ')} — it can never fire` })
    else
      partial.push({ ...entry, reason: `rule "${b.id}" is PARTIALLY shadowed: ${shadowedKw.length} of ${b.keywords.length} keywords are captured earlier by ${by.join(', ')} — it fires for fewer inputs than it appears to` })
  }
  return {
    ok: true, unreachable, partial,
    note: unreachable.length
      ? `${unreachable.length} rule(s) can never fire. They are still in the table and are still reported by route() as non-matching — they are not silently removed.`
      : 'every rule is reachable by at least one of its own keywords.',
  }
}

// ---------------------------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------------------------
/**
 * Route a task. NEVER THROWS.
 *
 * @param {string} task
 * @param {object} [opts]
 * @param {function} [opts.classifier]  see CLASSIFIER_CONTRACT. ABSENT ⇒ the override does not run.
 * @param {*}        [opts.complexity]  a pre-computed classification, same accepted shapes.
 * @param {Array}    [opts.rules]
 *
 * The complexity override, in full:
 *   · complex  → raise the model one tier (capped at opus, and the cap is REPORTED)
 *   · trivial  → lower one tier, but never below the rule's `minModel` floor (floor REPORTED)
 *   · moderate → no change
 *   · unclassifiable, or no classifier injected → NO CHANGE, and the route says which of those it
 *     was. It does not fall back to "moderate": a task nobody classified has not been judged simple.
 */
export function route(task, opts = {}) {
  const rules = opts.rules ?? RULES
  if (typeof task !== 'string' || !task.trim()) {
    return {
      ok: true, matched: false, ruleId: null, agent: DEFAULT_ROUTE.agent, model: DEFAULT_ROUTE.model,
      isDefault: true, reason: `no task text to route (received ${task === null ? 'null' : typeof task === 'string' ? 'an empty string' : typeof task}) — ${DEFAULT_ROUTE.reason}`,
      complexity: { level: null, reason: 'not classified: no task text' }, override: null,
    }
  }
  const v = validateRules(rules)
  if (!v.ok) return { ok: false, reason: 'the rule table is invalid — refusing to route against it', errors: v.errors }

  const hit = rules.find(r => ruleMatches(r, task)) || null
  const base = hit
    ? { agent: hit.agent, model: hit.model, minModel: hit.minModel || MODEL_TIERS[0] }
    : { agent: DEFAULT_ROUTE.agent, model: DEFAULT_ROUTE.model, minModel: MODEL_TIERS[0] }

  // --- obtain a complexity, or explicitly none ---
  let cx, noClassifier = false
  if (opts.complexity !== undefined) cx = normalizeComplexity(opts.complexity)
  else if (typeof opts.classifier === 'function') {
    let raw = null, threw = null
    try { raw = opts.classifier(task) } catch (e) { threw = e?.message || String(e) }
    cx = threw
      ? { level: null, reason: `the injected classifier threw (${threw}) — treated as "not classified", never as "simple"`, assumption: null }
      : normalizeComplexity(raw)
  } else {
    noClassifier = true
    cx = { level: null, reason: 'no complexity classifier was injected — pass opts.classifier (see CLASSIFIER_CONTRACT). This module deliberately does not carry its own; a second classifier that disagreed with lib/complexity.mjs would be worse than none.', assumption: null }
  }

  let model = base.model, override = null
  if (opts.applyComplexityOverride === false) {
    override = { applied: false, reason: 'complexity override disabled by the caller' }
  } else if (cx.level == null) {
    override = { applied: false, classifier: noClassifier ? 'absent' : 'ran', reason: `complexity override did NOT run: ${cx.reason}. The model tier is the table's, unadjusted — an unclassified task is not treated as simple.` }
  } else if (cx.level === 'complex') {
    const top = MODEL_TIERS.length - 1
    const want = Math.min(tierIndex(model) + 1, top)
    override = { applied: MODEL_TIERS[want] !== model, direction: 'up', from: model, to: MODEL_TIERS[want], because: cx.reason, clampedAt: tierIndex(model) + 1 > top ? `already at the top tier (${MODEL_TIERS[top]}) — no higher tier exists` : null }
    model = MODEL_TIERS[want]
  } else if (cx.level === 'trivial') {
    const want = Math.max(tierIndex(model) - 1, 0)
    const floored = want < tierIndex(base.minModel)
    const to = MODEL_TIERS[floored ? tierIndex(base.minModel) : want]
    override = { applied: to !== model, direction: 'down', from: model, to, because: cx.reason, flooredAt: floored ? `rule "${hit?.id ?? '(default)'}" sets minModel="${base.minModel}" — the downgrade stopped there` : null }
    model = to
  } else {
    override = { applied: false, reason: 'complexity "moderate" — the table\'s tier stands' }
  }
  if (cx.assumption) override.assumption = cx.assumption   // tier→level mapping, surfaced not buried

  return {
    ok: true,
    matched: !!hit,
    ruleId: hit?.id ?? null,
    agent: base.agent,
    model,
    isDefault: !hit,
    reason: hit ? `matched rule "${hit.id}" (${hit.why})` : DEFAULT_ROUTE.reason,
    matchedKeyword: hit ? (hit.keywords.find(k => norm(task).includes(norm(k))) ?? null) : null,
    complexity: { level: cx.level, reason: cx.reason, source: opts.complexity !== undefined ? 'caller-supplied' : noClassifier ? 'none' : 'injected-classifier' },
    override,
  }
}

/** Route many, and report the default rate — the number that tells you the table has a hole. */
export function routeAll(tasks, opts = {}) {
  if (!Array.isArray(tasks)) return { ok: false, reason: `expected an array of task strings, received ${typeof tasks}` }
  const routes = tasks.map(t => route(t, opts))
  const unmatched = routes.filter(r => r.isDefault)
  const unclassified = routes.filter(r => r.complexity?.level == null)
  return {
    ok: true, routes,
    byModel: routes.reduce((a, r) => (a[r.model] = (a[r.model] || 0) + 1, a), {}),
    unmatched: unmatched.length,
    unclassified: unclassified.length,
    note: [
      unmatched.length ? `${unmatched.length}/${tasks.length} task(s) hit the explicit default — the table has no rule for them.` : 'every task matched a rule.',
      unclassified.length ? `${unclassified.length}/${tasks.length} task(s) were not classified, so the complexity override did not run for them.` : null,
    ].filter(Boolean).join(' '),
  }
}

// ---------------------------------------------------------------------------------------------
// MODELLED cost effect — arithmetic, not a claim
// ---------------------------------------------------------------------------------------------
/**
 * ⚠ MODELLED, NOT MEASURED, AND NOT A PREDICTION.
 *
 * Given tasks and a price-per-tier YOU supply, this computes what two allocations would cost IF
 * every assumption below held. It does not claim the policy saves money. The result carries
 * `modelled: true` and an `assumption` string; nothing here was observed and nobody ran it.
 *
 * The assumptions, all of which are wrong to some degree:
 *   1. Every task consumes the SAME token volume regardless of which model runs it. In practice a
 *      cheaper model often takes more turns, and can fail outright — which moves the true cost in
 *      the opposite direction to the number below.
 *   2. Quality is equal across tiers. There is no outcome data here; a rerun after a bad cheap run
 *      costs more than the expensive run it replaced, and is not counted.
 *   3. `pricePerTask` is a flat per-task price you provide. There is no token accounting in this
 *      routing path to derive one from.
 *   4. The baseline is "everything on one tier". If your real baseline is a human choosing per
 *      task, this is a comparison against a strawman.
 */
export function modelledCostEffect(tasks, pricePerTask, opts = {}) {
  if (!Array.isArray(tasks)) return { ok: false, reason: `expected an array of task strings, received ${typeof tasks}` }
  if (!pricePerTask || typeof pricePerTask !== 'object') return { ok: false, reason: 'pricePerTask is required — this module ships no prices, because a stale hardcoded price is a wrong number that looks authoritative' }
  const missing = MODEL_TIERS.filter(m => !Number.isFinite(pricePerTask[m]))
  if (missing.length) return { ok: false, reason: `pricePerTask is missing a finite value for: ${missing.join(', ')}`, required: [...MODEL_TIERS] }

  const baselineTier = opts.baseline ?? 'sonnet'
  if (!MODEL_TIERS.includes(baselineTier)) return { ok: false, reason: `"${baselineTier}" is not a model tier`, allowed: [...MODEL_TIERS] }

  const r = routeAll(tasks, opts)
  if (!r.ok) return r
  const policy = r.routes.reduce((s, x) => s + pricePerTask[x.model], 0)
  const baseline = tasks.length * pricePerTask[baselineTier]

  return {
    ok: true,
    modelled: true, measured: false, is_prediction: false,
    assumption: `MODELLED, not observed: nobody ran these ${tasks.length} task(s). Assumes identical token volume across tiers, equal output quality across tiers (reruns after a cheap failure are NOT counted), a flat caller-supplied price per task rather than token accounting, and a baseline of "every task on ${baselineTier}". This is arithmetic over the routing table, not a measurement of spend and not a forecast of it.`,
    baseline: { tier: baselineTier, total: +baseline.toFixed(4) },
    policy: { total: +policy.toFixed(4), byModel: r.byModel },
    difference: +(policy - baseline).toFixed(4),
    differencePct: baseline === 0 ? null : Math.round(((policy - baseline) / baseline) * 100),
    unmatched: r.unmatched,
    unclassified: r.unclassified,
    assumptions: [
      'token volume per task is identical across model tiers',
      'output quality is equal across tiers — reruns after a cheap failure are NOT counted',
      'pricePerTask is a flat caller-supplied per-task price, not token accounting',
      `baseline is "every task on ${baselineTier}", which may not be your real baseline`,
      ...(r.unclassified ? [`${r.unclassified} task(s) had no complexity classification, so the override did not adjust their tier`] : []),
    ],
  }
}
