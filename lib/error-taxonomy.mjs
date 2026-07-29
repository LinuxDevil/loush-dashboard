// Cross-provider error taxonomy — feature 065.
//
// Turns the assorted error shapes that end up in a Claude Code transcript into a small, stable
// set of category ids, so a failed turn can be grouped rather than eyeballed. The claim this
// exists to support is "37% of your failed turns were rate limits, not bugs" — which is only
// worth printing if the classification is honest about what it does *not* recognise.
//
// Two rules the rest of this codebase enforces, applied here:
//
//   1. "Unknown is a value." An error we do not recognise classifies as `unknown` with
//      confidence 0. It is never nudged into the nearest-looking category. On a reliability
//      screen a wrong confident label is worse than a visible gap: the gap prompts a look at
//      the transcript, the wrong label ends the investigation.
//   2. `retryable` is the actionable output. A rate limit is retryable (wait and it works); an
//      auth failure is not (waiting changes nothing). For `unknown` retryable is `null` — not
//      `false` — because we genuinely do not know, and `false` would read as "this is a real
//      bug", which is exactly the mistake this module is supposed to prevent.
//
// EVIDENCE NOTE — read before trusting any pattern below.
// The only transcripts available on this machine at build time were the sessions under
// ~/.claude/projects/-home-user-loush-dashboard/. They contain 9 `is_error: true` tool_result
// blocks and *zero* provider API errors (`grep -c isApiErrorMessage` → 0). So:
//   - Patterns tagged `confirmed` were read out of those real transcript lines, verbatim.
//   - Patterns tagged `speculative` are derived from the Anthropic/OpenAI documented error
//     `type` vocabulary and HTTP semantics. They are plausible, not observed. If one of them
//     ever fires on real data, promote the tag; do not assume it is already earning its keep.
// Every entry in PATTERNS and TYPE_MAP carries one of those two tags for that reason.

// The taxonomy. Exported as data so a UI can render the legend, and a reader can audit the
// retryable column, without importing the classifier's internals.
export const CATEGORIES = [
  {
    id: 'rate_limit',
    label: 'Rate limit',
    retryable: true,
    description: 'Requests or tokens per minute exceeded, or a plan usage limit hit. Clears with time.',
  },
  {
    id: 'overloaded',
    label: 'Provider overloaded',
    retryable: true,
    description: 'The provider was saturated or returned a 5xx. Nothing about the request was wrong.',
  },
  {
    id: 'auth',
    label: 'Authentication',
    retryable: false,
    description: 'Missing, invalid, or expired credentials. Retrying with the same key fails identically.',
  },
  {
    id: 'quota',
    label: 'Quota / billing',
    retryable: false,
    description: 'Credit balance or spend cap exhausted. Needs a payment or limit change, not a retry.',
  },
  {
    id: 'context_length',
    label: 'Context length',
    retryable: false,
    description: 'The prompt exceeded the model context window or the request size cap. Resend smaller.',
  },
  {
    id: 'timeout',
    label: 'Timeout',
    retryable: true,
    description: 'The request or stream exceeded its deadline. Often transient.',
  },
  {
    id: 'network',
    label: 'Network',
    retryable: true,
    description: 'The request never reached a verdict — DNS, TLS, connection reset, socket hang-up.',
  },
  {
    id: 'tool_error',
    label: 'Tool error',
    retryable: false,
    description: 'A local tool call failed (non-zero exit, missing file, traceback). Not a provider fault.',
  },
  {
    id: 'user_rejected',
    label: 'User rejected',
    retryable: false,
    description: 'A human declined the tool use. A decision, not a failure — kept out of the bug counts.',
  },
  {
    id: 'invalid_request',
    label: 'Invalid request',
    retryable: false,
    description: 'Malformed or unacceptable request: bad parameter, unknown model, schema violation.',
  },
  {
    id: 'model_refusal',
    label: 'Model refusal',
    retryable: false,
    description: 'The model or a safety filter declined to produce the output. Retrying verbatim will not help.',
  },
  {
    id: 'unknown',
    label: 'Unknown',
    retryable: null,
    description: 'No signal matched. Deliberately not guessed — inspect the raw entry.',
  },
]

const BY_ID = new Map(CATEGORIES.map(c => [c.id, c]))

// `user_rejected` exists because real transcripts are full of it. Of the 9 error-flagged tool
// results in the sample, one was "The user doesn't want to proceed with this tool use." Folding
// that into `tool_error` would report a human's deliberate decision as a failed turn, which is
// the same class of mistake as pricing an unknown model at Sonnet's rate.

// ---------------------------------------------------------------------------------------------
// Signal 1: an explicit machine-readable error type. Highest confidence — the provider named it.
// Keys are lowercased. Generic types (`api_error`) are deliberately absent so they fall through
// to the status code, which carries more meaning than "something went wrong".
const TYPE_MAP = new Map([
  // Anthropic documented types — speculative here only in the sense that none appeared in the
  // sample transcripts; the vocabulary itself is from the published API error reference.
  ['rate_limit_error', ['rate_limit', 0.95, 'speculative']],
  ['overloaded_error', ['overloaded', 0.95, 'speculative']],
  ['authentication_error', ['auth', 0.95, 'speculative']],
  ['permission_error', ['auth', 0.9, 'speculative']],
  ['billing_error', ['quota', 0.95, 'speculative']],
  ['invalid_request_error', ['invalid_request', 0.9, 'speculative']],
  ['not_found_error', ['invalid_request', 0.85, 'speculative']],
  // 413. Sits under context_length rather than invalid_request because the actionable reading
  // for a user is "your input was too big", which is what context_length communicates.
  ['request_too_large', ['context_length', 0.75, 'speculative']],
  ['timeout_error', ['timeout', 0.95, 'speculative']],
  ['request_timeout', ['timeout', 0.95, 'speculative']],
  // OpenAI-shaped types, present because the taxonomy is meant to be cross-provider.
  ['insufficient_quota', ['quota', 0.95, 'speculative']],
  ['quota_exceeded', ['quota', 0.9, 'speculative']],
  ['invalid_api_key', ['auth', 0.95, 'speculative']],
  ['context_length_exceeded', ['context_length', 0.95, 'speculative']],
  ['content_filter', ['model_refusal', 0.9, 'speculative']],
  ['content_policy_violation', ['model_refusal', 0.9, 'speculative']],
  ['server_error', ['overloaded', 0.8, 'speculative']],
  ['service_unavailable', ['overloaded', 0.85, 'speculative']],
  // Node/undici connection errors, which surface as `code` on a thrown Error.
  ['econnreset', ['network', 0.95, 'speculative']],
  ['econnrefused', ['network', 0.95, 'speculative']],
  ['enotfound', ['network', 0.95, 'speculative']],
  ['eai_again', ['network', 0.95, 'speculative']],
  ['epipe', ['network', 0.9, 'speculative']],
  ['etimedout', ['timeout', 0.95, 'speculative']],
  ['und_err_connect_timeout', ['timeout', 0.9, 'speculative']],
  // Harness-side tool failures.
  ['tool_error', ['tool_error', 0.9, 'speculative']],
  ['tool_use_error', ['tool_error', 0.9, 'speculative']],
])

// ---------------------------------------------------------------------------------------------
// Signal 2: HTTP status. Weaker than a named type — several statuses are genuinely ambiguous
// across providers (429 is a rate limit for Anthropic but also carries OpenAI's quota
// exhaustion), so the confidences here top out below the type map's.
const STATUS_MAP = new Map([
  [400, ['invalid_request', 0.7]],
  [401, ['auth', 0.9]],
  [402, ['quota', 0.85]],
  [403, ['auth', 0.8]],
  [404, ['invalid_request', 0.6]],
  [408, ['timeout', 0.85]],
  [413, ['context_length', 0.6]],
  [422, ['invalid_request', 0.7]],
  [429, ['rate_limit', 0.85]], // not 0.95: an unlabelled 429 may be quota exhaustion
  [500, ['overloaded', 0.55]], // a bare 500 says little beyond "their side"; kept low on purpose
  [502, ['overloaded', 0.7]],
  [503, ['overloaded', 0.75]],
  [504, ['timeout', 0.8]],
  [529, ['overloaded', 0.9]], // Anthropic's dedicated overloaded status
])

// ---------------------------------------------------------------------------------------------
// Signal 3: message text. Ordered, first match wins, most specific first — a rejection notice
// mentioning "tool use" must not be caught by a generic tool pattern, and the confirmed shapes
// are checked before the speculative provider prose.
//
// Confidences are capped below the structured signals because text is the weakest evidence we
// have: a Bash tool result can legitimately *contain* the words "rate limit" in output it was
// asked to print. Documented so a reader knows the ceiling is deliberate.
const PATTERNS = [
  // --- confirmed: read verbatim out of real transcript tool_result blocks ---
  { category: 'user_rejected', re: /the user doesn't want to proceed/i, confidence: 0.9, evidence: 'confirmed' },
  { category: 'user_rejected', re: /tool use was rejected/i, confidence: 0.9, evidence: 'confirmed' },
  { category: 'user_rejected', re: /the user doesn't want to take this action/i, confidence: 0.85, evidence: 'speculative' },
  { category: 'tool_error', re: /^exit code \d+/im, confidence: 0.8, evidence: 'confirmed' },
  { category: 'tool_error', re: /file does not exist/i, confidence: 0.8, evidence: 'confirmed' },
  { category: 'tool_error', re: /traceback \(most recent call last\)/i, confidence: 0.8, evidence: 'confirmed' },
  { category: 'tool_error', re: /no such file or directory/i, confidence: 0.75, evidence: 'speculative' },
  { category: 'tool_error', re: /command not found/i, confidence: 0.75, evidence: 'speculative' },

  // --- speculative: provider error prose, from published API docs, not observed locally ---
  { category: 'context_length', re: /prompt is too long/i, confidence: 0.8, evidence: 'speculative' },
  { category: 'context_length', re: /(maximum|max) context (length|window)/i, confidence: 0.8, evidence: 'speculative' },
  { category: 'context_length', re: /context (length|window) exceeded/i, confidence: 0.8, evidence: 'speculative' },
  { category: 'quota', re: /credit balance is too low/i, confidence: 0.8, evidence: 'speculative' },
  { category: 'quota', re: /insufficient (credits?|quota|funds|balance)/i, confidence: 0.8, evidence: 'speculative' },
  { category: 'quota', re: /(billing|payment required|exceeded your current quota)/i, confidence: 0.7, evidence: 'speculative' },
  { category: 'rate_limit', re: /rate[ _-]?limit/i, confidence: 0.8, evidence: 'speculative' },
  { category: 'rate_limit', re: /too many requests/i, confidence: 0.8, evidence: 'speculative' },
  { category: 'rate_limit', re: /usage limit reached/i, confidence: 0.75, evidence: 'speculative' },
  { category: 'auth', re: /(invalid|missing|expired) (api[ _-]?key|x-api-key|bearer token|oauth token)/i, confidence: 0.85, evidence: 'speculative' },
  { category: 'auth', re: /(authentication|unauthorized|not authenticated|please run \/login)/i, confidence: 0.75, evidence: 'speculative' },
  { category: 'overloaded', re: /overloaded/i, confidence: 0.85, evidence: 'speculative' },
  { category: 'overloaded', re: /(service unavailable|temporarily unavailable|upstream error)/i, confidence: 0.7, evidence: 'speculative' },
  { category: 'timeout', re: /(timed out|timeout|deadline exceeded)/i, confidence: 0.8, evidence: 'speculative' },
  { category: 'network', re: /(econnreset|econnrefused|enotfound|socket hang ?up|fetch failed|network error|tls|certificate)/i, confidence: 0.75, evidence: 'speculative' },
  { category: 'model_refusal', re: /(content filtering policy|content policy|refused to (answer|respond)|declined to generate)/i, confidence: 0.7, evidence: 'speculative' },
  { category: 'invalid_request', re: /(invalid request|is not a valid model|unexpected parameter|unsupported parameter)/i, confidence: 0.7, evidence: 'speculative' },
]

// Exported for inspection/tests: the honest split between what we have seen and what we assume.
export const patternEvidence = () => ({
  confirmed: PATTERNS.filter(p => p.evidence === 'confirmed').map(p => String(p.re)),
  speculative: PATTERNS.filter(p => p.evidence === 'speculative').map(p => String(p.re)),
})

// ---------------------------------------------------------------------------------------------

const firstString = (...vals) => vals.find(v => typeof v === 'string' && v.length > 0) ?? ''

// Content in a transcript is sometimes a plain string and sometimes an array of blocks. Flatten
// to text so one pattern set covers both, rather than duplicating the table per shape.
const contentText = c => {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map(b => (typeof b === 'string' ? b : firstString(b?.text, b?.content))).join('\n')
  return ''
}

// Pull the three signals out of whatever the caller handed us. Accepts a bare string, an Error,
// a raw provider error body, or a transcript record whose payload sits under `.message`.
function probe(input) {
  if (input == null) return { status: null, type: '', text: '', stopReason: '', toolResult: false }
  if (typeof input === 'string') return { status: null, type: '', text: input, stopReason: '', toolResult: false }

  const inner = input.error && typeof input.error === 'object' ? input.error : {}
  // One level of transcript nesting: { type:'user', message:{ content:[ {type:'tool_result',…} ] } }
  const msg = input.message && typeof input.message === 'object' ? input.message : {}

  const statusRaw = [input.status, input.statusCode, input.status_code, input.httpStatus, input.http_status, inner.status]
    .find(v => Number.isFinite(v))
  // `code` is numeric on some clients (HTTP status) and a string on Node errors (ECONNRESET).
  const codeIsStatus = Number.isFinite(input.code)

  const typeCandidates = [
    inner.type,
    input.error_type,
    input.errorType,
    typeof input.code === 'string' ? input.code : '',
    typeof inner.code === 'string' ? inner.code : '',
    // input.type is last and only used when it is not a transcript shape marker — 'tool_result'
    // and 'user' describe the envelope, not the error.
    input.type === 'tool_result' || input.type === 'user' || input.type === 'assistant' ? '' : input.type,
  ]

  return {
    status: Number.isFinite(statusRaw) ? statusRaw : codeIsStatus ? input.code : null,
    type: firstString(...typeCandidates).toLowerCase().trim(),
    text: firstString(
      typeof input.message === 'string' ? input.message : '',
      inner.message,
      contentText(input.content),
      contentText(msg.content),
      input.text,
      input.detail,
      typeof input.toString === 'function' && input instanceof Error ? input.message : '',
    ),
    stopReason: firstString(input.stop_reason, input.stopReason, msg.stop_reason).toLowerCase(),
    toolResult:
      input.type === 'tool_result' ||
      input.is_error === true ||
      input.isError === true ||
      input.isApiErrorMessage === true ||
      (Array.isArray(msg.content) && msg.content.some(b => b?.is_error === true)),
  }
}

const result = (category, confidence, matchedOn, raw) => ({
  category,
  retryable: BY_ID.get(category).retryable,
  confidence,
  matchedOn,
  raw,
})

/**
 * Classify one error into the taxonomy.
 *
 * Signals are consulted strongest-first: a named error type beats an HTTP status, which beats
 * message text, which beats the bare fact that something was flagged as an error. The order is
 * the point — a 429 carrying `type: "billing_error"` is a quota problem, and calling it a rate
 * limit would tell the user to wait for something that will never clear.
 *
 * Returns { category, retryable, confidence, matchedOn, raw }. `matchedOn` names the signal that
 * decided it, so a UI can show its work; it is null only for `unknown`.
 */
export function classifyError(input) {
  const p = probe(input)

  // 1. Named type.
  if (p.type && TYPE_MAP.has(p.type)) {
    const [category, confidence] = TYPE_MAP.get(p.type)
    return result(category, confidence, `type:${p.type}`, input)
  }

  // 2. HTTP status.
  if (p.status != null && STATUS_MAP.has(p.status)) {
    const [category, confidence] = STATUS_MAP.get(p.status)
    return result(category, confidence, `status:${p.status}`, input)
  }

  // 3. A refusal stop_reason is structured, not prose — trusted above text.
  if (p.stopReason === 'refusal') return result('model_refusal', 0.9, 'stop_reason:refusal', input)

  // 4. Message text.
  if (p.text) {
    for (const pat of PATTERNS) {
      if (pat.re.test(p.text)) return result(pat.category, pat.confidence, `text:${pat.re}`, input)
    }
  }

  // 5. The envelope itself. A transcript block flagged `is_error: true` really is a failed tool
  // call even when its text says nothing we recognise — the harness told us the category. That
  // is a genuine signal, not a guess, so it classifies rather than falling through; the low
  // confidence records that we learned it from the wrapper and not the content.
  if (p.toolResult) return result('tool_error', 0.5, 'shape:is_error', input)

  // 6. Nothing matched. Not the nearest category — `unknown`, at zero, with retryable null.
  return result('unknown', 0, null, input)
}

/**
 * Aggregate a list of errors into ranked per-category counts.
 *
 * Each element may be a raw error (it gets classified) or an already-classified result — so a
 * caller that needs the per-error detail does not have to classify twice.
 *
 * Shape:
 *   { total, categories: [{ id, label, retryable, count, share }], retryable, unknown }
 * where `share` is a fraction of `total` (0..1, never NaN on an empty list), `retryable` is the
 * roll-up that makes the headline claim sayable, and `unknown` is reported at the top level so
 * a reader can weigh the rest of the table against how much went unclassified.
 */
export function summarizeErrors(errors = []) {
  const list = [...errors]
  const counts = new Map()
  let retryableCount = 0

  for (const e of list) {
    const c = e && typeof e === 'object' && typeof e.category === 'string' && BY_ID.has(e.category)
      ? e
      : classifyError(e)
    counts.set(c.category, (counts.get(c.category) ?? 0) + 1)
    if (BY_ID.get(c.category).retryable === true) retryableCount += 1
  }

  const total = list.length
  const share = n => (total === 0 ? 0 : n / total)

  const categories = [...counts.entries()]
    .map(([id, count]) => {
      const c = BY_ID.get(id)
      return { id, label: c.label, retryable: c.retryable, count, share: share(count) }
    })
    // Rank by count, then by the declared order in CATEGORIES so ties are stable across runs
    // rather than depending on insertion order.
    .sort((a, b) => b.count - a.count || CATEGORIES.findIndex(c => c.id === a.id) - CATEGORIES.findIndex(c => c.id === b.id))

  const unknownCount = counts.get('unknown') ?? 0
  return {
    total,
    categories,
    retryable: { count: retryableCount, share: share(retryableCount) },
    unknown: { count: unknownCount, share: share(unknownCount) },
  }
}
