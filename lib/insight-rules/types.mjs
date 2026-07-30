// types.mjs — the Insight shape, the severity order, and the validator the engine enforces.
//
// THE TYPE IS THE POINT. An "insight" with no `evidence` is a confidently-worded guess, which is the
// failure mode of every insights panel ever shipped: it reads like a finding, it cannot be checked,
// and once a reader catches one that is wrong they stop reading all of them. So `evidence` is
// mandatory and non-empty, and anything that computes a rate must carry the sample size `n` it was
// computed from. A rule that returns an object without those is a BUG IN THE RULE and is reported as
// a rule failure — it is not quietly dropped, because "quietly dropped" looks like "nothing to say".

export const SEVERITY = ['critical', 'high', 'medium', 'low']
export const SEVERITY_RANK = Object.fromEntries(SEVERITY.map((s, i) => [s, i]))

/** Default minimum sample size for any rule that computes a rate. Individual rules may raise it. */
export const MIN_SAMPLE = 5

const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v)

/**
 * Validate an insight. Returns { ok: true } or { ok: false, problems: [string] }.
 * Deliberately strict: every relaxation here is a future unfalsifiable claim on someone's dashboard.
 */
export function validateInsight(ins) {
  const problems = []
  if (!isObj(ins)) return { ok: false, problems: ['insight is not an object'] }
  if (typeof ins.id !== 'string' || !ins.id) problems.push('missing id')
  if (typeof ins.title !== 'string' || !ins.title) problems.push('missing title')
  if (!SEVERITY.includes(ins.severity)) problems.push(`severity must be one of ${SEVERITY.join('|')} (got ${JSON.stringify(ins.severity)})`)
  if (!isObj(ins.evidence) || Object.keys(ins.evidence).length === 0)
    problems.push('missing evidence — an insight with no evidence is not allowed by the type')
  if (typeof ins.falsifiableAs !== 'string' || !ins.falsifiableAs)
    problems.push('missing falsifiableAs — state the observation that would refute this')
  // A rate with no denominator is the classic "100% failure rate (n=1)" headline.
  const hasRate = isObj(ins.evidence) && Object.keys(ins.evidence).some(k => /rate|pct|share|per/i.test(k))
  if (hasRate && !(Number.isInteger(ins.n) && ins.n > 0))
    problems.push('evidence contains a rate, so `n` (sample size) is required and must be a positive integer')
  return problems.length ? { ok: false, problems } : { ok: true }
}

/**
 * The context object handed to every rule as the third argument.
 *
 * A rule that cannot decide must `return null`. `null` alone cannot carry a reason, and "no insight"
 * and "could not tell" are different facts — so the rule calls ctx.abstain(reason) on its way out and
 * the engine keeps the reason. Rules stay pure w.r.t. their return value; the ctx is write-only
 * bookkeeping owned by the engine.
 */
export function makeContext(ruleId) {
  const abstentions = []
  return {
    rule: ruleId,
    abstain(reason, detail) { abstentions.push({ rule: ruleId, reason: String(reason), ...(detail ? { detail } : {}) }); return null },
    _abstentions: abstentions,
  }
}
