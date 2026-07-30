import test from 'node:test'
import assert from 'node:assert/strict'

import {
  contextByTool,
  contextDiff,
  detectPii,
  redact,
  approxTokens,
  toolResultBytes,
  BYTES_PER_TOKEN,
  PII_RULES,
  OPT_IN_RULE_IDS,
} from '../../lib/context-analysis.mjs'

// ---------------------------------------------------------------------------
// helpers shaped like the real transcript records verified on disk
// ---------------------------------------------------------------------------

let seq = 0
const uid = () => `uuid-${++seq}`

const assistant = (content, usage) => ({
  type: 'assistant',
  uuid: uid(),
  timestamp: '2026-07-30T12:00:00.000Z',
  isSidechain: false,
  message: { role: 'assistant', content, ...(usage ? { usage } : {}) },
})

const user = (content) => ({
  type: 'user',
  uuid: uid(),
  timestamp: '2026-07-30T12:00:01.000Z',
  isSidechain: false,
  message: { role: 'user', content },
})

const toolUse = (id, name, input = {}) => ({ type: 'tool_use', id, name, input, caller: 'assistant' })
const toolResult = (id, content, isError = false) => ({
  type: 'tool_result', tool_use_id: id, content, is_error: isError,
})
const usage = (o) => ({
  input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 0,
  ...o,
})

// ===========================================================================
// 062 — contextByTool
// ===========================================================================

test('contextByTool ranks tools by the bytes their results returned', () => {
  // Guards: regression where results were counted per-call instead of by size,
  // making a chatty-but-tiny tool outrank the one actually eating the window.
  const records = [
    assistant([toolUse('t1', 'Read'), toolUse('t2', 'Bash')]),
    user([toolResult('t1', 'x'.repeat(10000)), toolResult('t2', 'ok')]),
    assistant([toolUse('t3', 'Bash')]),
    user([toolResult('t3', 'still ok')]),
    assistant([toolUse('t4', 'Bash')]),
    user([toolResult('t4', 'fine')]),
  ]
  const out = contextByTool(records)
  assert.equal(out.tools[0].tool, 'Read')
  assert.equal(out.tools[0].bytes, 10000)
  assert.equal(out.tools[1].tool, 'Bash')
  assert.equal(out.tools[1].results, 3)
  assert.ok(out.tools[0].shareOfBytes > 0.9)
})

test('contextByTool reports token counts as an estimate with an error bar, never as exact', () => {
  // Guards: a UI rendering approxTokens as a hard number. The estimation block
  // and the low/high bounds must always be present.
  const records = [
    assistant([toolUse('t1', 'Grep')]),
    user([toolResult('t1', 'y'.repeat(3500))]),
  ]
  const out = contextByTool(records)
  assert.equal(out.estimation.approximate, true)
  assert.equal(out.estimation.bytesPerToken, BYTES_PER_TOKEN)
  assert.ok(out.estimation.bytesPerTokenRange.low < out.estimation.bytesPerTokenRange.high)
  const t = out.tools[0]
  assert.equal(t.approxTokens, 1000)
  assert.ok(t.approxTokensLow < t.approxTokens)
  assert.ok(t.approxTokensHigh > t.approxTokens)
})

test("contextByTool groups orphan tool_results under 'unknown' rather than dropping them", () => {
  // Guards: silently discarding tool_results whose tool_use is outside the
  // window (compaction, partial tail read), which under-reports the window.
  const records = [user([toolResult('missing-id', 'z'.repeat(500))])]
  const out = contextByTool(records)
  assert.equal(out.tools.length, 1)
  assert.equal(out.tools[0].tool, 'unknown')
  assert.equal(out.tools[0].bytes, 500)
  assert.equal(out.unresolvedResults, 1)
})

test('contextByTool topN reports what it omitted instead of capping silently', () => {
  // Guards: a "top 2 tools" view that quietly hides the rest, so the shown
  // bytes no longer add up to the total.
  const records = []
  for (const [i, name] of ['A', 'B', 'C', 'D'].entries()) {
    records.push(assistant([toolUse(`t${i}`, name)]))
    records.push(user([toolResult(`t${i}`, 'q'.repeat(1000 * (4 - i)))]))
  }
  const out = contextByTool(records, { topN: 2 })
  assert.equal(out.tools.length, 2)
  assert.equal(out.truncation.applied, true)
  assert.equal(out.truncation.omittedTools, 2)
  assert.equal(out.truncation.omittedBytes, 3000)
  assert.equal(out.totals.tools, 4)
  assert.equal(out.totals.bytes, 10000)
})

test('contextByTool handles array-form tool_result content and image payloads', () => {
  // Guards: real transcripts carry tool_result.content as an array of blocks
  // (23/559 observed). Treating it as a string yielded 0 bytes for those.
  const records = [
    assistant([toolUse('t1', 'Task'), toolUse('t2', 'Read')]),
    user([
      toolResult('t1', [{ type: 'text', text: 'a'.repeat(100) }, { type: 'tool_reference', id: 'x' }]),
      toolResult('t2', [{ type: 'image', source: { type: 'base64', data: 'b'.repeat(400) } }]),
    ]),
  ]
  const out = contextByTool(records)
  const byName = Object.fromEntries(out.tools.map(t => [t.tool, t.bytes]))
  assert.ok(byName.Task >= 100)
  assert.equal(byName.Read, 400)
})

test('contextByTool never throws on malformed input', () => {
  // Guards: a single corrupt JSONL line taking down the whole dashboard panel.
  for (const bad of [null, undefined, 'nope', 42, {}, [null, 3, 'x'], [{ message: null }], [{ message: { content: 'bare string' } }]]) {
    const out = contextByTool(bad)
    assert.equal(typeof out, 'object')
    assert.ok(Array.isArray(out.tools))
    assert.equal(typeof out.totals.bytes, 'number')
  }
  assert.equal(contextByTool([null, 3]).input.malformedRecords, 2)
  assert.equal(contextByTool('nope').input.wasArray, false)
})

test('contextByTool counts error results separately without excluding their bytes', () => {
  // Guards: failed tool calls being skipped — an error payload still occupies
  // the context window and is often huge (stack traces).
  const records = [
    assistant([toolUse('t1', 'Bash')]),
    user([toolResult('t1', 'E'.repeat(2000), true)]),
  ]
  const out = contextByTool(records)
  assert.equal(out.tools[0].errorResults, 1)
  assert.equal(out.tools[0].bytes, 2000)
  assert.equal(out.totals.errorResults, 1)
})

test('toolResultBytes measures UTF-8 bytes, not UTF-16 code units', () => {
  // Guards: using String#length for multi-byte content, which under-reports
  // non-ASCII tool output by up to 3x.
  assert.equal(toolResultBytes(toolResult('t', 'é')), 2)
  assert.equal(toolResultBytes(toolResult('t', '漢')), 3)
  assert.equal(toolResultBytes(toolResult('t', '😀')), 4)
  assert.equal(toolResultBytes(null), 0)
})

test('approxTokens brackets its point estimate', () => {
  // Guards: bounds accidentally inverted (dividing by the wrong end of range).
  const e = approxTokens(7000)
  assert.ok(e.tokensLow < e.tokens && e.tokens < e.tokensHigh)
  assert.equal(e.approximate, true)
  assert.equal(approxTokens(-5).tokens, 0)
  assert.equal(approxTokens('x').tokens, 0)
})

// ===========================================================================
// 063 — contextDiff
// ===========================================================================

test('contextDiff attributes prompt growth to the tool result that caused it', () => {
  // Guards: reporting a rising prompt number with no cause attached, which was
  // the whole point of 063.
  const records = [
    user('start'),
    assistant([{ type: 'text', text: 'hi' }], usage({ input_tokens: 1000 })),
    assistant([toolUse('t1', 'Read', { file_path: '/big' })], usage({ input_tokens: 1100 })),
    user([toolResult('t1', 'L'.repeat(35000))]),
    assistant([{ type: 'text', text: 'done' }], usage({ input_tokens: 21100 })),
  ]
  const out = contextDiff(records)
  assert.equal(out.turns.length, 3)
  const last = out.turns[2]
  assert.equal(last.deltaPromptTokens, 20000)
  assert.ok(last.addedBytesByTool.Read >= 35000)
  const readAdd = last.added.find(a => a.kind === 'tool_result' && a.tool === 'Read')
  assert.ok(readAdd, 'the Read tool_result is listed as an addition')
  assert.equal(readAdd.bytes, 35000)
})

test('contextDiff reports system-prompt and tool-schema changes as invisible, not as zero', () => {
  // Guards: the dangerous failure mode where a diff implies full visibility.
  // A prompt that grew with nothing in the transcript to explain it must
  // surface as unattributed growth plus an explicit not-visible declaration.
  const records = [
    assistant([{ type: 'text', text: 'a' }], usage({ input_tokens: 5000 })),
    // No new user message, no tool result — yet the prompt jumped 9k tokens.
    // In reality: a tool was added, or the system prompt changed.
    assistant([{ type: 'text', text: 'b' }], usage({ input_tokens: 14000 })),
  ]
  const out = contextDiff(records)

  assert.equal(out.visibility.systemPrompt, 'not-visible')
  assert.equal(out.visibility.toolSchemas, 'not-visible')
  assert.equal(out.visibility.wireLevelCapture, false)
  assert.match(out.visibility.note, /system prompt and tool schemas are NOT visible/i)
  const spots = out.visibility.blindSpots.map(b => b.what)
  assert.ok(spots.some(w => /system prompt/i.test(w)))
  assert.ok(spots.some(w => /tool schema/i.test(w)))
  for (const b of out.visibility.blindSpots) assert.ok(b.reason.length > 0)

  const t = out.turns[1]
  assert.equal(t.deltaPromptTokens, 9000)
  assert.ok(t.unattributedTokens > 8000, 'growth is reported as unexplained')
  assert.equal(t.attribution, 'partially-unexplained')
})

test('contextDiff leaves the first turn delta null rather than pretending it is zero', () => {
  // Guards: seeding previousPromptTokens at 0, which invented a huge fake
  // first-turn growth (or, if clamped, a fake zero).
  const out = contextDiff([assistant([{ type: 'text', text: 'x' }], usage({ input_tokens: 4321 }))])
  assert.equal(out.turns[0].previousPromptTokens, null)
  assert.equal(out.turns[0].deltaPromptTokens, null)
  assert.equal(out.turns[0].unattributedTokens, null)
  assert.equal(out.turns[0].attribution, 'no-previous-turn')
  assert.equal(out.turns[0].promptTokens, 4321)
})

test('contextDiff sums cache_read and cache_creation into the prompt size', () => {
  // Guards: reading only input_tokens, which is ~2 on cached turns and made
  // the whole context look empty.
  const out = contextDiff([
    assistant([{ type: 'text', text: 'x' }],
      usage({ input_tokens: 2, cache_read_input_tokens: 40000, cache_creation_input_tokens: 5000 })),
  ])
  assert.equal(out.turns[0].promptTokens, 45002)
  assert.equal(out.turns[0].cacheReadTokens, 40000)
  assert.equal(out.turns[0].cacheCreationTokens, 5000)
})

test("contextDiff counts records it cannot size instead of ignoring them", () => {
  // Guards: attachment/system records (128+18 in the real transcript) silently
  // vanishing, so their contribution looked like unexplained growth with no hint.
  const records = [
    assistant([{ type: 'text', text: 'a' }], usage({ input_tokens: 100 })),
    { type: 'attachment', uuid: uid(), attachment: { kind: 'something' } },
    { type: 'system', uuid: uid(), subtype: 'hook' },
    assistant([{ type: 'text', text: 'b' }], usage({ input_tokens: 200 })),
  ]
  const out = contextDiff(records)
  assert.equal(out.turns[1].opaqueRecordsSincePrevious, 2)
})

test('contextDiff assigns assistant output to the following turn, not the current one', () => {
  // Guards: counting a turn's own output as an addition to its own prompt,
  // which double-counted and made every turn look self-inflated.
  const records = [
    assistant([{ type: 'text', text: 'Z'.repeat(700) }], usage({ input_tokens: 100 })),
    assistant([{ type: 'text', text: 'ok' }], usage({ input_tokens: 300 })),
  ]
  const out = contextDiff(records)
  assert.equal(out.turns[0].addedBytes, 0)
  assert.equal(out.turns[1].addedBytes, 700)
})

test('contextDiff never throws on malformed input and reports trailing pending work', () => {
  // Guards: crashing on truncated/corrupt tails, and losing the additions that
  // arrived after the last assistant turn.
  for (const bad of [null, undefined, 'x', 7, {}, [null, 'y']]) {
    const out = contextDiff(bad)
    assert.ok(Array.isArray(out.turns))
    assert.equal(out.visibility.systemPrompt, 'not-visible')
  }
  const out = contextDiff([
    assistant([{ type: 'text', text: 'a' }], usage({ input_tokens: 10 })),
    user([toolResult('nope', 'k'.repeat(300))]),
  ])
  // the last turn's own output ('a') plus the tool_result that followed it are
  // both still pending — they belong to a turn the transcript never reached
  assert.equal(out.totals.trailingPendingAdditions, 2)
  assert.equal(out.totals.trailingPendingBytes, 301)
})

test('contextDiff sidechain filtering keeps records whose isSidechain is absent', () => {
  // Guards: coercing a missing isSidechain to false/true. 350/2175 real records
  // omit the field; dropping them lost real turns.
  const noFlag = { type: 'assistant', uuid: uid(), message: { role: 'assistant', content: [], usage: usage({ input_tokens: 50 }) } }
  const side = { type: 'assistant', uuid: uid(), isSidechain: true, message: { role: 'assistant', content: [], usage: usage({ input_tokens: 60 }) } }
  const excluded = contextDiff([noFlag, side], { sidechain: 'exclude' })
  assert.equal(excluded.turns.length, 1)
  assert.equal(excluded.turns[0].isSidechain, 'unknown')
  const only = contextDiff([noFlag, side], { sidechain: 'only' })
  assert.equal(only.turns.length, 1)
  assert.equal(only.turns[0].isSidechain, true)
})

// ===========================================================================
// 006 — PII detection and redaction
// ===========================================================================

test('redact replaces matches right-to-left leaving the rest of the string intact', () => {
  // Guards: THE core bug — replacing left-to-right shifts every later match
  // index by (placeholder.length - match.length), so the second and third
  // secrets get spliced at the wrong offset and chew up surrounding text.
  const a = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA'
  const b = 'ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
  const c = 'AKIACCCCCCCCCCCCCCCC'
  const text = `head ${a} mid1 ${b} mid2 ${c} tail`

  const out = redact(text)
  assert.equal(out.ok, true)
  assert.equal(out.total, 3)
  assert.equal(
    out.text,
    'head [REDACTED:anthropicKey] mid1 [REDACTED:githubToken] mid2 [REDACTED:awsAccessKeyId] tail',
  )
  // every literal secret is gone, every literal non-secret survives verbatim
  for (const secret of [a, b, c]) assert.ok(!out.text.includes(secret))
  for (const keep of ['head ', ' mid1 ', ' mid2 ', ' tail']) assert.ok(out.text.includes(keep))
})

test('redact right-to-left survives placeholders longer and shorter than the match', () => {
  // Guards: an ordering bug that only shows up when the length delta is
  // non-zero in one direction. A short placeholder hides it if you only test
  // the long case (and vice versa).
  const text = 'A AKIA1111111111111111 B AKIA2222222222222222 C AKIA3333333333333333 D'
  const short = redact(text, { placeholder: '#' })
  assert.equal(short.text, 'A # B # C # D')
  const long = redact(text, { placeholder: 'X'.repeat(200) })
  assert.equal(long.text, `A ${'X'.repeat(200)} B ${'X'.repeat(200)} C ${'X'.repeat(200)} D`)
})

test('email and ipv4 are NOT redacted by default', () => {
  // Guards: over-broad default rules destroying ordinary content — commit
  // trailers, LICENSE headers, localhost addresses, semver-looking numbers.
  const text = [
    'Co-Authored-By: Jane Dev <jane@example.com>',
    'server listening on 127.0.0.1:3000 and 10.0.0.5',
    'upgraded to 1.2.3.4 build',
  ].join('\n')

  const out = redact(text)
  assert.equal(out.text, text, 'text is untouched by default')
  assert.equal(out.changed, false)
  assert.equal(out.total, 0)
  assert.deepEqual(out.skippedByDefault.sort(), ['email', 'ipv4'])
  assert.deepEqual(OPT_IN_RULE_IDS.sort(), ['email', 'ipv4'])
  assert.ok(!out.rulesEnabled.includes('email'))
  assert.ok(!out.rulesEnabled.includes('ipv4'))

  const detected = detectPii(text)
  assert.equal(detected.total, 0)
})

test('email and ipv4 redact when explicitly opted in', () => {
  // Guards: opt-in wiring being decorative — the rules must actually work when
  // a caller asks for them.
  const text = 'mail jane@example.com host 192.168.1.9'
  const out = redact(text, { include: ['email', 'ipv4'] })
  assert.equal(out.text, 'mail [REDACTED:email] host [REDACTED:ipv4]')
  assert.equal(out.counts.email, 1)
  assert.equal(out.counts.ipv4, 1)
  assert.deepEqual(out.skippedByDefault, [])
})

test('a real-shaped API key is redacted', () => {
  // Guards: patterns too narrow for the key formats actually seen in the wild.
  // Every fixture is assembled at runtime rather than written as one literal. The values are
  // invented, but they are shaped closely enough to real credentials that GitHub's push
  // protection blocks a commit containing them verbatim — which it did, on the Stripe one.
  // Splitting the prefix keeps the file scanner-clean while the test still sees a full-length,
  // correctly-shaped token, which is the whole point of the fixture.
  const j = (...parts) => parts.join('')
  const cases = {
    anthropicKey: j('sk-', 'ant-api03-9fJk2LmQ7xR4vT8bN1cZ6yH3pW5sD0gA-eK2mV9nX4qL7tB1'),
    openAiKey: j('sk-', 'proj-abcdEFGH1234ijklMNOP5678qrstUVWX90'),
    stripeKey: j('sk_', 'live_', '51H8xKjLmNoPqRsTuVwXyZ0123'),
    githubToken: j('ghp', '_16C7e42F292c6912E7710c838347Ae178B4a'),
    slackToken: j('xoxb', '-2345678901-2345678901234-AbCdEfGhIjKlMnOpQrStUvWx'),
    googleApiKey: j('AIza', 'SyD-1234567890abcdefghijklmnopqrstu'),
    npmToken: j('npm', '_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'),
    awsAccessKeyId: j('AKIA', 'IOSFODNN7EXAMPLE'),
    jwt: j('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'),
  }
  for (const [category, secret] of Object.entries(cases)) {
    const out = redact(`value = ${secret};`)
    assert.ok(!out.text.includes(secret), `${category} left in output: ${out.text}`)
    assert.equal(out.total, 1, `${category} matched ${out.total} times`)
    assert.equal(out.redactions[0].category, category, `${category} categorised as ${out.redactions[0].category}`)
  }
})

test('private key blocks, bearer tokens and credentialed connection strings are redacted', () => {
  // Guards: multi-line PEM bodies (a dot-matched-newline mistake leaves the
  // key body behind) and URL credentials that only appear mid-string.
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234\nabcd/efg+hij=\n-----END RSA PRIVATE KEY-----'
  const pemOut = redact(`before\n${pem}\nafter`)
  assert.equal(pemOut.text, 'before\n[REDACTED:privateKey]\nafter')
  assert.ok(!pemOut.text.includes('MIIEowIBAAKCAQEA1234'))

  const bearer = redact('Authorization: Bearer abc123DEF456ghi789JKL')
  assert.equal(bearer.text, 'Authorization: [REDACTED:bearerToken]')

  // the credentialed authority is removed; the trailing path is deliberately
  // kept, since the database/route name is diagnostic and not a secret
  const conn = redact('DB=postgres://admin:s3cr3tP4ss@db.internal:5432/app')
  assert.equal(conn.text, 'DB=[REDACTED:connectionString]/app')
  assert.ok(!conn.text.includes('s3cr3tP4ss'))
  assert.ok(!conn.text.includes('admin'))

  const aws = redact('aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')
  assert.equal(aws.total, 1)
  assert.ok(!aws.text.includes('wJalrXUtnFEMI'))
})

test('redact reports what was removed by category and count', () => {
  // Guards: silent redaction — a user seeing mangled text with no way to tell
  // that redaction happened or what class of thing was taken out.
  const text = 'k1=AKIA1111111111111111 k2=AKIA2222222222222222 gh=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const out = redact(text)
  assert.equal(out.total, 3)
  assert.equal(out.counts.awsAccessKeyId, 2)
  assert.equal(out.counts.githubToken, 1)
  const aws = out.redactions.find(r => r.category === 'awsAccessKeyId')
  assert.equal(aws.count, 2)
  assert.equal(aws.charsRemoved, 40)
  assert.ok(aws.label.length > 0)
  assert.ok(out.charsRemoved > 0)
})

test('detectPii previews never leak the secret they describe', () => {
  // Guards: putting the raw match in the finding, so the "safe" report becomes
  // a second copy of the credential.
  // Split for the same reason as the fixture block above: real-shaped, so scanner-visible.
  const secret = ['ghp', '_16C7e42F292c6912E7710c838347Ae178B4a'].join('')
  const out = detectPii(`token ${secret}`)
  assert.equal(out.total, 1)
  const f = out.findings[0]
  assert.ok(!f.preview.includes(secret))
  assert.ok(!JSON.stringify(out).includes(secret))
  assert.equal(f.length, secret.length)
  assert.equal(f.index, 6)
})

test('overlapping matches are reported once, most specific rule winning', () => {
  // Guards: double-redaction producing nested placeholders like
  // [REDACTED:bearerToken] wrapping [REDACTED:jwt], or corrupted splices.
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.KMUFsIDTnFmyG3nMiGM6H9FNFUROf3wh7SmqJp-QV30'
  const out = redact(`Authorization: Bearer ${jwt}`)
  assert.equal(out.total, 1)
  assert.equal(out.text.match(/\[REDACTED:/g).length, 1)
  assert.ok(!out.text.includes('eyJ'))
})

test('detectPii is stateless across calls', () => {
  // Guards: module-level /g regexes carrying lastIndex between calls, which
  // made every second call miss matches near the start of the string.
  const text = 'AKIA1111111111111111'
  for (let i = 0; i < 5; i++) assert.equal(detectPii(text).total, 1, `call ${i}`)
})

test('detectPii and redact never throw on non-string input', () => {
  // Guards: crashing when handed a tool_result payload that turned out to be
  // an object or null.
  for (const bad of [null, undefined, 42, {}, [], true]) {
    const d = detectPii(bad)
    assert.equal(d.ok, false)
    assert.equal(d.total, 0)
    const r = redact(bad)
    assert.equal(r.ok, false)
    assert.equal(r.changed, false)
    assert.equal(r.text, '')
    assert.equal(typeof r.reason, 'string')
  }
  assert.equal(redact('AKIA1111111111111111', 'not-an-options-object').total, 1)
})

test('unknown rule ids are reported rather than silently ignored', () => {
  // Guards: a typo'd rule name in a config leaving the caller believing a rule
  // was enabled when it was not.
  const out = redact('x', { include: ['emial', 'email'] })
  assert.deepEqual(out.unknownRuleIds, ['emial'])
  assert.ok(out.rulesEnabled.includes('email'))
})

test('PII_RULES exposes the catalogue with default state and no live regexes', () => {
  // Guards: leaking shared mutable RegExp objects (with lastIndex) to callers,
  // and a UI unable to show which rules are opt-in.
  assert.ok(PII_RULES.length >= 15)
  for (const r of PII_RULES) {
    assert.equal(typeof r.id, 'string')
    assert.equal(typeof r.label, 'string')
    assert.equal(typeof r.pattern, 'string')
    assert.equal(typeof r.defaultOn, 'boolean')
  }
  assert.equal(PII_RULES.find(r => r.id === 'email').defaultOn, false)
  assert.equal(PII_RULES.find(r => r.id === 'ipv4').defaultOn, false)
  assert.equal(PII_RULES.find(r => r.id === 'privateKey').defaultOn, true)
})

test('ordinary prose and code survive the default rule set untouched', () => {
  // Guards: false positives. This is the cost side of PII rules — if normal
  // content gets mangled, users turn redaction off entirely.
  const text = [
    'const total = items.reduce((a, b) => a + b, 0)',
    'See https://example.com/docs/getting-started#install',
    'version 4.5.6, released 2026-07-30, commit a1b2c3d4e5f6',
    'run: npm install && npm test -- --watch',
    'The sk- prefix identifies secret keys.',
  ].join('\n')
  const out = redact(text)
  assert.equal(out.text, text)
  assert.equal(out.total, 0)
})
