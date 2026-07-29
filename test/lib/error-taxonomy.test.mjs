import test from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORIES, classifyError, summarizeErrors, patternEvidence } from '../../lib/error-taxonomy.mjs'

const cat = e => classifyError(e).category

test('the taxonomy is inspectable and internally consistent', () => {
  const ids = CATEGORIES.map(c => c.id)
  assert.equal(new Set(ids).size, ids.length, 'category ids are unique')
  for (const c of CATEGORIES) {
    assert.equal(typeof c.label, 'string')
    assert.ok(c.label.length > 0)
    assert.ok(c.description.length > 0, `${c.id} explains itself`)
    assert.ok([true, false, null].includes(c.retryable), `${c.id}.retryable is a tri-state`)
  }
  // The set the product depends on for grouping. Adding is fine; dropping one breaks callers.
  for (const required of [
    'rate_limit', 'overloaded', 'auth', 'quota', 'context_length',
    'timeout', 'network', 'tool_error', 'invalid_request', 'model_refusal', 'unknown',
  ]) assert.ok(ids.includes(required), `missing category ${required}`)
})

test('retryable is right where it matters — waiting fixes some of these and none of the others', () => {
  const retryable = Object.fromEntries(CATEGORIES.map(c => [c.id, c.retryable]))
  assert.equal(retryable.rate_limit, true)
  assert.equal(retryable.overloaded, true)
  assert.equal(retryable.timeout, true)
  assert.equal(retryable.network, true)
  assert.equal(retryable.auth, false, 'retrying with the same bad key fails identically')
  assert.equal(retryable.quota, false, 'an empty balance does not refill by waiting a second')
  assert.equal(retryable.context_length, false, 'the same oversized prompt is oversized next time')
  assert.equal(retryable.invalid_request, false)
  assert.equal(retryable.model_refusal, false)
  assert.equal(retryable.unknown, null, 'not false — false would read as "a real bug"')
})

test('an unrecognised error is unknown at zero confidence, not the nearest category', () => {
  // The regression this guards is the pricing bug's shape: a fallthrough default that makes an
  // unclassifiable thing indistinguishable from a real classification on every chart.
  const r = classifyError('the flux capacitor disagreed with the manifold')
  assert.equal(r.category, 'unknown')
  assert.equal(r.confidence, 0)
  assert.equal(r.retryable, null)
  assert.equal(r.matchedOn, null)
})

test('empty, null and unshaped inputs classify rather than throw', () => {
  for (const input of [null, undefined, '', {}, 42, []]) {
    const r = classifyError(input)
    assert.equal(r.category, 'unknown', `${JSON.stringify(input)} should be unknown`)
    assert.equal(r.confidence, 0)
  }
})

test('the raw input is carried through so a reader can go check', () => {
  const raw = { status: 429, message: 'slow down' }
  assert.equal(classifyError(raw).raw, raw)
})

test('a named error type classifies with high confidence and names the signal', () => {
  const r = classifyError({ error: { type: 'rate_limit_error', message: 'whatever' } })
  assert.equal(r.category, 'rate_limit')
  assert.equal(r.retryable, true)
  assert.ok(r.confidence >= 0.9)
  assert.equal(r.matchedOn, 'type:rate_limit_error')
})

test('documented provider error types map across both vocabularies', () => {
  assert.equal(cat({ type: 'overloaded_error' }), 'overloaded')
  assert.equal(cat({ type: 'authentication_error' }), 'auth')
  assert.equal(cat({ type: 'permission_error' }), 'auth')
  assert.equal(cat({ type: 'billing_error' }), 'quota')
  assert.equal(cat({ type: 'insufficient_quota' }), 'quota')       // OpenAI-shaped
  assert.equal(cat({ type: 'context_length_exceeded' }), 'context_length')
  assert.equal(cat({ type: 'invalid_request_error' }), 'invalid_request')
  assert.equal(cat({ type: 'content_filter' }), 'model_refusal')
})

test('node connection codes are network or timeout, not unknown', () => {
  const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
  assert.equal(cat(err), 'network')
  assert.equal(cat({ code: 'ETIMEDOUT' }), 'timeout')
  assert.equal(cat({ code: 'ENOTFOUND', message: 'getaddrinfo failed' }), 'network')
})

test('HTTP status classifies when no type is given', () => {
  assert.equal(cat({ status: 429 }), 'rate_limit')
  assert.equal(cat({ status: 529 }), 'overloaded')
  assert.equal(cat({ status: 401 }), 'auth')
  assert.equal(cat({ status: 402 }), 'quota')
  assert.equal(cat({ status: 400 }), 'invalid_request')
  assert.equal(cat({ status: 504 }), 'timeout')
  assert.equal(cat({ statusCode: 503 }), 'overloaded')
  assert.equal(classifyError({ status: 429 }).matchedOn, 'status:429')
})

test('an unmapped status falls through to unknown instead of a 5xx-shaped guess', () => {
  assert.equal(cat({ status: 418 }), 'unknown')
  assert.equal(classifyError({ status: 599 }).confidence, 0)
})

test('a named type outranks the status it arrived with', () => {
  // A 429 carrying billing_error is a quota problem. Calling it a rate limit would tell the
  // user to wait for something that never clears — the exact misdirection this module prevents.
  const r = classifyError({ status: 429, error: { type: 'billing_error' } })
  assert.equal(r.category, 'quota')
  assert.equal(r.retryable, false)
  assert.equal(r.matchedOn, 'type:billing_error')
})

test('status outranks message text', () => {
  // Tool output can legitimately contain the words "rate limit"; a real 401 must still win.
  const r = classifyError({ status: 401, message: 'rate limit docs say to slow down' })
  assert.equal(r.category, 'auth')
  assert.equal(r.matchedOn, 'status:401')
})

test('message text classifies when it is all we have, at a capped confidence', () => {
  const r = classifyError('API Error: 429 {"type":"error"} rate limit exceeded')
  assert.equal(r.category, 'rate_limit')
  assert.equal(r.retryable, true)
  assert.ok(r.confidence > 0 && r.confidence <= 0.85, 'text is weaker evidence than a named type')
  assert.ok(r.matchedOn.startsWith('text:'))
})

test('provider prose patterns land in the categories a user can act on', () => {
  assert.equal(cat('Overloaded'), 'overloaded')
  assert.equal(cat('prompt is too long: 250000 tokens > 200000 maximum'), 'context_length')
  assert.equal(cat('Your credit balance is too low to access the API'), 'quota')
  assert.equal(cat('invalid x-api-key'), 'auth')
  assert.equal(cat('Request timed out after 600000ms'), 'timeout')
  assert.equal(cat('fetch failed'), 'network')
})

// --- shapes read out of real transcripts under ~/.claude/projects/ -------------------------
// These four strings are verbatim from `is_error: true` tool_result blocks in this repo's own
// session log. They are the only error text in this module confirmed against real data.

test('confirmed transcript tool failures classify as tool_error', () => {
  assert.equal(cat('Exit code 144'), 'tool_error')
  assert.equal(cat('File does not exist. Note: your current working directory is /home/user/loush-dashboard.'), 'tool_error')
  assert.equal(cat('Exit code 1\nTraceback (most recent call last):\n  File "<string>", line 3'), 'tool_error')
})

test('a user declining a tool is not counted as a failure', () => {
  // Verbatim from a real transcript. Folding this into tool_error would report a human's
  // deliberate decision as a bug in the "37% were rate limits" breakdown.
  const r = classifyError("The user doesn't want to proceed with this tool use. The tool use was rejected")
  assert.equal(r.category, 'user_rejected')
  assert.equal(r.retryable, false)
})

test('a transcript tool_result block classifies through its envelope', () => {
  const r = classifyError({ type: 'tool_result', is_error: true, content: 'Exit code 144' })
  assert.equal(r.category, 'tool_error')
  assert.equal(r.matchedOn, 'text:/^exit code \\d+/im')
})

test('an is_error block with unrecognised text is still a tool error, at low confidence', () => {
  // The envelope is a real signal — the harness told us a tool call failed — so this classifies
  // rather than falling to unknown. The low confidence records that we learned it from the
  // wrapper, not the content.
  const r = classifyError({ type: 'tool_result', is_error: true, content: 'zork returned a grue' })
  assert.equal(r.category, 'tool_error')
  assert.equal(r.matchedOn, 'shape:is_error')
  assert.ok(r.confidence < 0.6)
})

test('a nested transcript record is unwrapped one level', () => {
  const record = {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: 'File does not exist.' }] },
  }
  assert.equal(cat(record), 'tool_error')
})

test('a refusal stop_reason is trusted over prose', () => {
  const r = classifyError({ stop_reason: 'refusal', message: 'no text pattern here' })
  assert.equal(r.category, 'model_refusal')
  assert.equal(r.matchedOn, 'stop_reason:refusal')
})

test('patterns declare which are confirmed against real data and which are speculative', () => {
  // The module is required to be honest about its evidence; this keeps the tags from rotting
  // into a uniform "confirmed" as patterns get added.
  const { confirmed, speculative } = patternEvidence()
  assert.ok(confirmed.length >= 4, 'the transcript-verified patterns are labelled')
  assert.ok(speculative.length > 0, 'the doc-derived patterns are not passed off as verified')
})

test('summarize ranks categories by count with shares that sum to one', () => {
  const s = summarizeErrors([
    { status: 429 }, { status: 429 }, { status: 429 },
    { status: 401 },
    'Exit code 1',
  ])
  assert.equal(s.total, 5)
  assert.equal(s.categories[0].id, 'rate_limit')
  assert.equal(s.categories[0].count, 3)
  assert.ok(Math.abs(s.categories[0].share - 0.6) < 1e-9)
  assert.ok(Math.abs(s.categories.reduce((a, c) => a + c.share, 0) - 1) < 1e-9)
})

test('summarize rolls up the retryable share — the headline claim', () => {
  // "37% of your failed turns were rate limits, not bugs" is exactly this number.
  const s = summarizeErrors([{ status: 429 }, { status: 529 }, { status: 401 }, 'Exit code 2'])
  assert.equal(s.retryable.count, 2)
  assert.equal(s.retryable.share, 0.5)
})

test('summarize reports the unclassified share instead of hiding it', () => {
  const s = summarizeErrors([{ status: 429 }, 'a wholly novel calamity', 'another novel calamity'])
  assert.equal(s.unknown.count, 2)
  assert.ok(Math.abs(s.unknown.share - 2 / 3) < 1e-9)
  assert.equal(s.categories.find(c => c.id === 'unknown').count, 2)
})

test('summarize of an empty list is zeroes, never NaN', () => {
  const s = summarizeErrors([])
  assert.equal(s.total, 0)
  assert.deepEqual(s.categories, [])
  assert.equal(s.retryable.share, 0)
  assert.equal(s.unknown.share, 0)
  assert.ok(Number.isFinite(s.retryable.share))
})

test('summarize accepts already-classified results without reclassifying', () => {
  const pre = [classifyError({ status: 429 }), classifyError({ status: 401 })]
  const s = summarizeErrors(pre)
  assert.equal(s.total, 2)
  assert.deepEqual(s.categories.map(c => c.id).sort(), ['auth', 'rate_limit'])
})

test('ties rank in declared category order so the table is stable across runs', () => {
  const a = summarizeErrors([{ status: 401 }, { status: 429 }])
  const b = summarizeErrors([{ status: 429 }, { status: 401 }])
  assert.deepEqual(a.categories.map(c => c.id), b.categories.map(c => c.id))
  assert.equal(a.categories[0].id, 'rate_limit', 'CATEGORIES order breaks the tie, not input order')
})
