
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


// ---------------------------------------------------------------------------------------------
const TYPE_MAP = new Map([
  ['rate_limit_error', ['rate_limit', 0.95, 'speculative']],
  ['overloaded_error', ['overloaded', 0.95, 'speculative']],
  ['authentication_error', ['auth', 0.95, 'speculative']],
  ['permission_error', ['auth', 0.9, 'speculative']],
  ['billing_error', ['quota', 0.95, 'speculative']],
  ['invalid_request_error', ['invalid_request', 0.9, 'speculative']],
  ['not_found_error', ['invalid_request', 0.85, 'speculative']],
  ['request_too_large', ['context_length', 0.75, 'speculative']],
  ['timeout_error', ['timeout', 0.95, 'speculative']],
  ['request_timeout', ['timeout', 0.95, 'speculative']],
  ['insufficient_quota', ['quota', 0.95, 'speculative']],
  ['quota_exceeded', ['quota', 0.9, 'speculative']],
  ['invalid_api_key', ['auth', 0.95, 'speculative']],
  ['context_length_exceeded', ['context_length', 0.95, 'speculative']],
  ['content_filter', ['model_refusal', 0.9, 'speculative']],
  ['content_policy_violation', ['model_refusal', 0.9, 'speculative']],
  ['server_error', ['overloaded', 0.8, 'speculative']],
  ['service_unavailable', ['overloaded', 0.85, 'speculative']],
  ['econnreset', ['network', 0.95, 'speculative']],
  ['econnrefused', ['network', 0.95, 'speculative']],
  ['enotfound', ['network', 0.95, 'speculative']],
  ['eai_again', ['network', 0.95, 'speculative']],
  ['epipe', ['network', 0.9, 'speculative']],
  ['etimedout', ['timeout', 0.95, 'speculative']],
  ['und_err_connect_timeout', ['timeout', 0.9, 'speculative']],
  ['tool_error', ['tool_error', 0.9, 'speculative']],
  ['tool_use_error', ['tool_error', 0.9, 'speculative']],
])

// ---------------------------------------------------------------------------------------------
const STATUS_MAP = new Map([
  [400, ['invalid_request', 0.7]],
  [401, ['auth', 0.9]],
  [402, ['quota', 0.85]],
  [403, ['auth', 0.8]],
  [404, ['invalid_request', 0.6]],
  [408, ['timeout', 0.85]],
  [413, ['context_length', 0.6]],
  [422, ['invalid_request', 0.7]],
  [429, ['rate_limit', 0.85]],
  [500, ['overloaded', 0.55]],
  [502, ['overloaded', 0.7]],
  [503, ['overloaded', 0.75]],
  [504, ['timeout', 0.8]],
  [529, ['overloaded', 0.9]],
])

// ---------------------------------------------------------------------------------------------
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

export const patternEvidence = () => ({
  confirmed: PATTERNS.filter(p => p.evidence === 'confirmed').map(p => String(p.re)),
  speculative: PATTERNS.filter(p => p.evidence === 'speculative').map(p => String(p.re)),
})

// ---------------------------------------------------------------------------------------------

const firstString = (...vals) => vals.find(v => typeof v === 'string' && v.length > 0) ?? ''

const contentText = c => {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map(b => (typeof b === 'string' ? b : firstString(b?.text, b?.content))).join('\n')
  return ''
}

function probe(input) {
  if (input == null) return { status: null, type: '', text: '', stopReason: '', toolResult: false }
  if (typeof input === 'string') return { status: null, type: '', text: input, stopReason: '', toolResult: false }

  const inner = input.error && typeof input.error === 'object' ? input.error : {}
  const msg = input.message && typeof input.message === 'object' ? input.message : {}

  const statusRaw = [input.status, input.statusCode, input.status_code, input.httpStatus, input.http_status, inner.status]
    .find(v => Number.isFinite(v))
  const codeIsStatus = Number.isFinite(input.code)

  const typeCandidates = [
    inner.type,
    input.error_type,
    input.errorType,
    typeof input.code === 'string' ? input.code : '',
    typeof inner.code === 'string' ? inner.code : '',
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

  if (p.type && TYPE_MAP.has(p.type)) {
    const [category, confidence] = TYPE_MAP.get(p.type)
    return result(category, confidence, `type:${p.type}`, input)
  }

  if (p.status != null && STATUS_MAP.has(p.status)) {
    const [category, confidence] = STATUS_MAP.get(p.status)
    return result(category, confidence, `status:${p.status}`, input)
  }

  if (p.stopReason === 'refusal') return result('model_refusal', 0.9, 'stop_reason:refusal', input)

  if (p.text) {
    for (const pat of PATTERNS) {
      if (pat.re.test(p.text)) return result(pat.category, pat.confidence, `text:${pat.re}`, input)
    }
  }

  if (p.toolResult) return result('tool_error', 0.5, 'shape:is_error', input)

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
    .sort((a, b) => b.count - a.count || CATEGORIES.findIndex(c => c.id === a.id) - CATEGORIES.findIndex(c => c.id === b.id))

  const unknownCount = counts.get('unknown') ?? 0
  return {
    total,
    categories,
    retryable: { count: retryableCount, share: share(retryableCount) },
    unknown: { count: unknownCount, share: share(unknownCount) },
  }
}
