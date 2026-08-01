// context-analysis.mjs
//
// Three pure analyses over Claude Code JSONL transcript records:
//
//   contextByTool(records) — 062: which tools ate the context window
//   contextDiff(records)   — 063: what changed between consecutive turns
//   detectPii(text) / redact(text, opts) — 006: secret detection + redaction
//
// House rules honoured here:
//   * unknown is a value — we emit the string 'unknown' / null rather than dropping rows
//   * no silent caps — every limit reports what it left out
//   * never throw on malformed input — every entry point is total
//   * pure — records/strings in, plain objects out; no fs, no network, no clock
//
// ---------------------------------------------------------------------------
// VERIFIED RECORD SHAPE (checked against ~/.claude/projects/**/**.jsonl on this
// machine, 2175-line main transcript + subagent sidechain transcripts):
//
//   record.type              'user' | 'assistant' | 'system' | 'attachment' |
//                            'queue-operation' | 'last-prompt' | 'mode'
//   record.message.role      'user' | 'assistant'   (only on user/assistant records)
//   record.message.content   Array of blocks — OR a bare string on some user
//                            records (35 of 599 observed). Both handled.
//   block.type               'text' | 'thinking' | 'tool_use' | 'tool_result'
//   tool_use                 { type, id, name, input, caller }
//   tool_result              { tool_use_id, type, content, is_error }
//                            content is a string (537 obs) or an array of
//                            { type: 'text' | 'tool_reference' | 'image' } (23 obs)
//   message.usage            { input_tokens, output_tokens,
//                              cache_creation_input_tokens,
//                              cache_read_input_tokens, ... }
//                            present on assistant records only (1085 obs)
//   record.timestamp, record.uuid, record.isSidechain (false | absent)
//
// Fields the task brief named that are NOT reliably present are treated as
// optional everywhere: isSidechain was absent on 350/2175 records, so absence
// is reported as 'unknown' rather than coerced to false.
// ---------------------------------------------------------------------------

// ===========================================================================
// bytes -> tokens conversion
// ===========================================================================
//
// BYTES_PER_TOKEN is an APPROXIMATION, not a measurement. There is no
// tokenizer in this process and transcripts do not record per-block token
// counts, so any per-tool token number here is an estimate with a real error
// bar. Never render these as exact.
//
// Basis:
//   * Anthropic's published rule of thumb for English prose is ~4 chars/token;
//     dense JSON / code / paths / hashes tokenize worse, ~2.5-3.5 chars/token.
//     Tool results in these transcripts are mostly the latter (file listings,
//     diffs, JSON, stack traces), so 3.5 is chosen over 4.
//   * Empirical calibration on this machine: for every consecutive pair of
//     assistant turns, (prompt tokens added) was compared against (visible
//     content bytes added). Main transcript: aggregate 2.56 bytes/token,
//     median 2.43, p10 1.39, p90 11.01. Subagent transcripts: aggregate
//     0.98-1.44 bytes/token.
//   * Those empirical numbers are BIASED LOW and are not usable directly: the
//     denominator (prompt-token growth) includes content that is invisible in
//     transcripts — system prompt, tool schemas, injected system-reminders,
//     cache-boundary re-encoding — while the numerator only counts bytes we
//     can see. They confirm the direction of the error, not the value.
//
// So: point estimate 3.5 bytes/token, with a stated plausible range of
// 2.5-5.0 bytes/token. Every token figure this module emits is accompanied by
// tokensLow/tokensHigh derived from that range (roughly -30% / +40%). Treat a
// ranking as meaningful and an absolute token count as ±40%.
export const BYTES_PER_TOKEN = 3.5
export const BYTES_PER_TOKEN_RANGE = { low: 2.5, high: 5.0 }

export const TOKEN_ESTIMATE_NOTE =
  'Token counts are estimated from payload bytes at ~3.5 bytes/token; ' +
  'true value varies 2.5-5.0 bytes/token by content type. Rankings are ' +
  'reliable, absolute counts are approximate (roughly -30%/+40%).'

/** Approximate token count for a byte size, with an explicit error bar. */
export function approxTokens(bytes) {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  return {
    bytes: b,
    tokens: Math.round(b / BYTES_PER_TOKEN),
    tokensLow: Math.round(b / BYTES_PER_TOKEN_RANGE.high),
    tokensHigh: Math.round(b / BYTES_PER_TOKEN_RANGE.low),
    approximate: true,
  }
}

// ===========================================================================
// small total helpers (no throwing, ever)
// ===========================================================================

const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)
const asArray = v => (Array.isArray(v) ? v : [])
const asStr = v => (typeof v === 'string' ? v : null)

/** UTF-8 byte length without Buffer (keeps the module runtime-agnostic). */
const utf8Bytes = s => {
  if (typeof s !== 'string') return 0
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++ }
    else n += 3
  }
  return n
}

/** Byte size of any JSON-ish value; cycles and exotic values degrade to 0. */
const valueBytes = v => {
  if (v == null) return 0
  if (typeof v === 'string') return utf8Bytes(v)
  try { return utf8Bytes(JSON.stringify(v) ?? '') } catch { return 0 }
}

const blocksOf = record => {
  const c = isObj(record) && isObj(record.message) ? record.message.content : undefined
  if (Array.isArray(c)) return c.filter(isObj)
  return []
}

/** Bare-string message content (observed on real user records). */
const stringContentOf = record => {
  const c = isObj(record) && isObj(record.message) ? record.message.content : undefined
  return typeof c === 'string' ? c : null
}

const sidechainOf = record => {
  if (!isObj(record)) return 'unknown'
  if (record.isSidechain === true) return true
  if (record.isSidechain === false) return false
  return 'unknown' // absent on 350/2175 real records — do not coerce to false
}

const keepBySidechain = (record, mode) => {
  if (mode === 'include') return true
  const s = sidechainOf(record)
  if (mode === 'only') return s === true
  if (mode === 'exclude') return s !== true // 'unknown' kept; absence is not proof
  return true
}

/** Bytes of a tool_result block's payload, whatever shape `content` took. */
export function toolResultBytes(block) {
  if (!isObj(block)) return 0
  const c = block.content
  if (typeof c === 'string') return utf8Bytes(c)
  if (Array.isArray(c)) {
    let n = 0
    for (const part of c) {
      if (!isObj(part)) { n += valueBytes(part); continue }
      if (typeof part.text === 'string') { n += utf8Bytes(part.text); continue }
      // image blocks carry base64 in source.data and dominate size when present
      const data = isObj(part.source) ? part.source.data : undefined
      if (typeof data === 'string') { n += utf8Bytes(data); continue }
      n += valueBytes(part)
    }
    return n
  }
  return valueBytes(c)
}

// ===========================================================================
// 062 — contextByTool
// ===========================================================================

/**
 * Group tool_result payload sizes by the tool that produced them and rank.
 *
 * @param {Array} records  parsed JSONL records, in transcript order
 * @param {object} [opts]
 *   opts.topN       number|null  cap the returned tools list (default null = no cap).
 *                                Truncation is always reported, never silent.
 *   opts.sidechain  'include'|'exclude'|'only'  default 'include'
 * @returns {object}
 */
export function contextByTool(records, opts) {
  const options = isObj(opts) ? opts : {}
  const mode = ['include', 'exclude', 'only'].includes(options.sidechain)
    ? options.sidechain
    : 'include'
  const topN = Number.isInteger(options.topN) && options.topN > 0 ? options.topN : null

  const list = Array.isArray(records) ? records : []
  const malformedRecords = Array.isArray(records)
    ? list.filter(r => !isObj(r)).length
    : 0
  const inputWasArray = Array.isArray(records)

  // Pass 1: tool_use_id -> tool name. Names live on the assistant side only.
  const nameById = new Map()
  for (const r of list) {
    if (!isObj(r) || !keepBySidechain(r, mode)) continue
    for (const b of blocksOf(r)) {
      if (b.type !== 'tool_use') continue
      const id = asStr(b.id)
      const name = asStr(b.name)
      if (id) nameById.set(id, name || 'unknown')
    }
  }

  // Pass 2: attribute tool_result bytes.
  const byTool = new Map()
  let totalBytes = 0
  let totalResults = 0
  let unresolvedResults = 0
  let errorResults = 0

  const bucket = name => {
    let e = byTool.get(name)
    if (!e) {
      e = { tool: name, results: 0, errorResults: 0, bytes: 0, largestResultBytes: 0, largestResultToolUseId: null }
      byTool.set(name, e)
    }
    return e
  }

  for (const r of list) {
    if (!isObj(r) || !keepBySidechain(r, mode)) continue
    for (const b of blocksOf(r)) {
      if (b.type !== 'tool_result') continue
      const id = asStr(b.tool_use_id)
      const resolved = id ? nameById.get(id) : undefined
      if (resolved === undefined) unresolvedResults++
      // 'unknown' is a value: an orphan tool_result still consumed the window.
      const name = resolved === undefined ? 'unknown' : resolved
      const bytes = toolResultBytes(b)
      const e = bucket(name)
      e.results++
      e.bytes += bytes
      if (b.is_error === true) { e.errorResults++; errorResults++ }
      if (bytes > e.largestResultBytes) {
        e.largestResultBytes = bytes
        e.largestResultToolUseId = id ?? null
      }
      totalBytes += bytes
      totalResults++
    }
  }

  const all = [...byTool.values()]
    .map(e => {
      const est = approxTokens(e.bytes)
      return {
        tool: e.tool,
        results: e.results,
        errorResults: e.errorResults,
        bytes: e.bytes,
        approxTokens: est.tokens,
        approxTokensLow: est.tokensLow,
        approxTokensHigh: est.tokensHigh,
        shareOfBytes: totalBytes > 0 ? e.bytes / totalBytes : 0,
        meanBytesPerResult: e.results > 0 ? Math.round(e.bytes / e.results) : 0,
        largestResultBytes: e.largestResultBytes,
        largestResultToolUseId: e.largestResultToolUseId,
      }
    })
    .sort((a, b) => b.bytes - a.bytes || String(a.tool).localeCompare(String(b.tool)))

  const tools = topN == null ? all : all.slice(0, topN)
  const omitted = all.length - tools.length
  const omittedBytes = omitted > 0
    ? all.slice(tools.length).reduce((s, t) => s + t.bytes, 0)
    : 0

  const totalEst = approxTokens(totalBytes)

  return {
    tools,
    totals: {
      tools: all.length,
      toolResults: totalResults,
      errorResults,
      bytes: totalBytes,
      approxTokens: totalEst.tokens,
      approxTokensLow: totalEst.tokensLow,
      approxTokensHigh: totalEst.tokensHigh,
    },
    // no silent caps: say exactly what was dropped and why
    truncation: {
      applied: omitted > 0,
      limit: topN,
      omittedTools: omitted,
      omittedBytes,
    },
    estimation: {
      bytesPerToken: BYTES_PER_TOKEN,
      bytesPerTokenRange: { ...BYTES_PER_TOKEN_RANGE },
      approximate: true,
      note: TOKEN_ESTIMATE_NOTE,
    },
    input: {
      records: list.length,
      malformedRecords,
      wasArray: inputWasArray,
      sidechainMode: mode,
    },
    unresolvedResults,
    notes: [
      'Only tool_result payloads are counted. Tool schemas, the system prompt, ' +
      'and injected system-reminders also occupy the window but are not present ' +
      'in transcripts, so they are excluded rather than guessed.',
      "tool_result blocks whose tool_use_id has no matching tool_use are grouped under 'unknown'.",
    ],
  }
}

// ===========================================================================
// 063 — contextDiff
// ===========================================================================

// What a transcript CANNOT tell us. Stated as data so a UI can render it
// instead of implying the diff is complete.
const DIFF_BLIND_SPOTS = Object.freeze([
  { what: 'system prompt', visibility: 'not-visible', reason: 'never written to the transcript; a change between turns is indistinguishable from no change' },
  { what: 'tool schemas / tool definitions', visibility: 'not-visible', reason: 'sent on the wire each request, never recorded; adding or removing a tool shows up only as unattributed token growth' },
  { what: 'injected system-reminders', visibility: 'not-visible', reason: 'injected server-side around user content and not stored as message blocks' },
  { what: 'context compaction / truncation done upstream', visibility: 'partial', reason: 'a drop in prompt tokens is observable, but what was dropped is not' },
  { what: 'cache boundary placement', visibility: 'partial', reason: 'cache_creation vs cache_read split is visible; which spans were cached is not' },
])

export const CONTEXT_DIFF_VISIBILITY_NOTE =
  'This diff is built from transcript records only. There are no wire-level ' +
  'captures, so the system prompt and tool schemas are NOT visible: a change ' +
  'to either is reported as unattributed growth, never as zero change.'

const promptTokensOf = usage => {
  if (!isObj(usage)) return null
  const parts = [
    usage.input_tokens,
    usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens,
  ].map(n => (Number.isFinite(n) ? n : 0))
  const anyPresent = [
    usage.input_tokens,
    usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens,
  ].some(n => Number.isFinite(n))
  if (!anyPresent) return null
  return parts[0] + parts[1] + parts[2]
}

/**
 * Turn-to-turn context diff.
 *
 * A "turn" is an assistant record carrying message.usage — the only place a
 * real prompt size is recorded. For each turn we report the visible additions
 * accumulated since the previous turn (new tool results, new user/assistant
 * messages) plus the measured prompt size, so growth has a cause attached.
 *
 * @param {Array} records
 * @param {object} [opts]
 *   opts.sidechain 'include'|'exclude'|'only'  default 'include'
 *   opts.maxAdditionsPerTurn number|null  cap the per-turn additions list
 *                                         (default null = no cap; truncation reported)
 */
export function contextDiff(records, opts) {
  const options = isObj(opts) ? opts : {}
  const mode = ['include', 'exclude', 'only'].includes(options.sidechain)
    ? options.sidechain
    : 'include'
  const maxAdd = Number.isInteger(options.maxAdditionsPerTurn) && options.maxAdditionsPerTurn > 0
    ? options.maxAdditionsPerTurn
    : null

  const list = Array.isArray(records) ? records : []
  let malformedRecords = 0

  // tool_use_id -> name, so added tool results can name their cause
  const nameById = new Map()
  for (const r of list) {
    if (!isObj(r)) continue
    for (const b of blocksOf(r)) {
      if (b.type === 'tool_use' && asStr(b.id)) nameById.set(b.id, asStr(b.name) || 'unknown')
    }
  }

  let pending = []            // visible additions since last emitted turn
  let pendingBytes = 0
  let opaqueRecords = 0       // attachment/system/etc: real context, unknown size
  const turns = []
  let prevPromptTokens = null
  let prevTurnIndex = null

  const pushAddition = (a) => { pending.push(a); pendingBytes += a.bytes }

  const absorb = (r) => {
    const role = isObj(r.message) ? asStr(r.message.role) : null
    const blocks = blocksOf(r)
    const bare = stringContentOf(r)
    if (bare != null) {
      pushAddition({
        kind: 'message',
        role: role ?? 'unknown',
        tool: null,
        bytes: utf8Bytes(bare),
        uuid: asStr(r.uuid),
        timestamp: asStr(r.timestamp),
      })
      return
    }
    if (blocks.length === 0 && r.type !== 'user' && r.type !== 'assistant') {
      // attachment / system / mode / queue-operation records. Some of these DO
      // reach the model (attachments, system-reminders) but their on-the-wire
      // size is not recorded, so we count them rather than invent bytes.
      opaqueRecords++
      return
    }
    for (const b of blocks) {
      if (b.type === 'tool_result') {
        const id = asStr(b.tool_use_id)
        const resolved = id ? nameById.get(id) : undefined
        pushAddition({
          kind: 'tool_result',
          role: role ?? 'unknown',
          tool: resolved === undefined ? 'unknown' : resolved,
          toolUseId: id ?? null,
          isError: b.is_error === true,
          bytes: toolResultBytes(b),
          uuid: asStr(r.uuid),
          timestamp: asStr(r.timestamp),
        })
      } else if (b.type === 'tool_use') {
        pushAddition({
          kind: 'tool_use',
          role: role ?? 'unknown',
          tool: asStr(b.name) || 'unknown',
          toolUseId: asStr(b.id),
          bytes: valueBytes(b.input) + utf8Bytes(asStr(b.name) || ''),
          uuid: asStr(r.uuid),
          timestamp: asStr(r.timestamp),
        })
      } else if (b.type === 'text' || b.type === 'thinking') {
        const txt = asStr(b.text) ?? asStr(b.thinking) ?? ''
        pushAddition({
          kind: b.type,
          role: role ?? 'unknown',
          tool: null,
          bytes: utf8Bytes(txt),
          uuid: asStr(r.uuid),
          timestamp: asStr(r.timestamp),
        })
      } else {
        pushAddition({
          kind: asStr(b.type) ?? 'unknown',
          role: role ?? 'unknown',
          tool: null,
          bytes: valueBytes(b),
          uuid: asStr(r.uuid),
          timestamp: asStr(r.timestamp),
        })
      }
    }
  }

  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    if (!isObj(r)) { malformedRecords++; continue }
    if (!keepBySidechain(r, mode)) continue

    const usage = isObj(r.message) ? r.message.usage : undefined
    const promptTokens = promptTokensOf(usage)

    if (promptTokens != null) {
      // Everything buffered before this record is what the prompt gained.
      const added = pending
      const addedBytes = pendingBytes
      const est = approxTokens(addedBytes)
      const delta = prevPromptTokens == null ? null : promptTokens - prevPromptTokens
      const unattributed = delta == null ? null : delta - est.tokens

      const capped = maxAdd == null ? added : added.slice(0, maxAdd)
      const omitted = added.length - capped.length

      const byKind = {}
      const byTool = {}
      for (const a of added) {
        byKind[a.kind] = (byKind[a.kind] || 0) + a.bytes
        if (a.tool) byTool[a.tool] = (byTool[a.tool] || 0) + a.bytes
      }

      turns.push({
        turn: turns.length,
        recordIndex: i,
        uuid: asStr(r.uuid),
        timestamp: asStr(r.timestamp),
        isSidechain: sidechainOf(r),
        promptTokens,
        previousPromptTokens: prevPromptTokens,
        // null on the first turn: there is no previous turn to diff against,
        // and 0 would be a lie.
        deltaPromptTokens: delta,
        outputTokens: isObj(usage) && Number.isFinite(usage.output_tokens) ? usage.output_tokens : null,
        cacheReadTokens: isObj(usage) && Number.isFinite(usage.cache_read_input_tokens) ? usage.cache_read_input_tokens : null,
        cacheCreationTokens: isObj(usage) && Number.isFinite(usage.cache_creation_input_tokens) ? usage.cache_creation_input_tokens : null,
        added: capped,
        addedCount: added.length,
        addedBytes,
        addedApproxTokens: est.tokens,
        addedApproxTokensLow: est.tokensLow,
        addedApproxTokensHigh: est.tokensHigh,
        addedBytesByKind: byKind,
        addedBytesByTool: byTool,
        opaqueRecordsSincePrevious: opaqueRecords,
        // Growth we measured but cannot pin on anything in the transcript.
        // This is where a system-prompt or tool-schema change lands.
        unattributedTokens: unattributed,
        attribution: delta == null
          ? 'no-previous-turn'
          : unattributed == null
            ? 'unknown'
            : Math.abs(unattributed) <= Math.max(50, Math.abs(delta) * 0.15)
              ? 'explained-by-transcript'
              : unattributed > 0
                ? 'partially-unexplained'
                : 'over-attributed',
        truncation: {
          applied: omitted > 0,
          limit: maxAdd,
          omittedAdditions: omitted,
          omittedBytes: omitted > 0 ? added.slice(capped.length).reduce((s, a) => s + a.bytes, 0) : 0,
        },
        previousTurn: prevTurnIndex,
      })

      prevTurnIndex = turns.length - 1
      prevPromptTokens = promptTokens
      pending = []
      pendingBytes = 0
      opaqueRecords = 0
      // The assistant's own output becomes part of the NEXT prompt.
      absorb(r)
      continue
    }

    absorb(r)
  }

  const growth = turns.filter(t => Number.isFinite(t.deltaPromptTokens))
  const totalGrowth = growth.reduce((s, t) => s + t.deltaPromptTokens, 0)
  const totalUnattributed = growth.reduce(
    (s, t) => s + (Number.isFinite(t.unattributedTokens) ? t.unattributedTokens : 0), 0,
  )

  return {
    turns,
    totals: {
      turns: turns.length,
      firstPromptTokens: turns.length ? turns[0].promptTokens : null,
      lastPromptTokens: turns.length ? turns[turns.length - 1].promptTokens : null,
      totalGrowthTokens: turns.length ? totalGrowth : null,
      totalUnattributedTokens: turns.length ? totalUnattributed : null,
      trailingPendingAdditions: pending.length,
      trailingPendingBytes: pendingBytes,
    },
    estimation: {
      bytesPerToken: BYTES_PER_TOKEN,
      bytesPerTokenRange: { ...BYTES_PER_TOKEN_RANGE },
      approximate: true,
      note: TOKEN_ESTIMATE_NOTE,
    },
    // Explicit, machine-readable statement of what this analysis cannot see.
    // Consumers should render this; reporting "system prompt: no change" would
    // be false, the truth is "system prompt: not observable".
    visibility: {
      note: CONTEXT_DIFF_VISIBILITY_NOTE,
      source: 'transcript-only',
      wireLevelCapture: false,
      systemPrompt: 'not-visible',
      toolSchemas: 'not-visible',
      blindSpots: DIFF_BLIND_SPOTS.map(b => ({ ...b })),
    },
    input: {
      records: list.length,
      malformedRecords,
      wasArray: Array.isArray(records),
      sidechainMode: mode,
    },
  }
}

// ===========================================================================
// 006 — PII / secret detection and redaction
// ===========================================================================
//
// Rules are ordered: earlier rules win when matches overlap, so a JWT inside a
// `Bearer` header is reported once as the more specific thing.
//
// WHY email AND ipv4 ARE OPT-IN (defaultOn: false)
// ------------------------------------------------
// Both patterns are famously over-broad on ordinary technical text and destroy
// content the user wanted to keep:
//   * email matches maintainer addresses in LICENSE headers, git commit
//     trailers ("Co-Authored-By:"), npm package metadata, mailing-list URLs,
//     `user@host` in ssh/scp examples, and every `foo@bar.com` in docs.
//   * ipv4 matches version strings (`1.2.3.4`), semver-ish build numbers,
//     127.0.0.1 / 0.0.0.0 / 10.0.0.1 in configs and logs, netmasks, and even
//     decimal-dotted data in CSVs.
// Redacting those silently mangles diffs, logs and docs, and the user cannot
// tell what happened. They are real PII patterns, so they stay available — but
// only when a caller explicitly asks: redact(t, { include: ['email','ipv4'] }).
//
// Measured on a real 3.6 MB transcript from this machine: the default rule set
// produced 1 hit (a genuine planted credential) and 0 false positives. Turning
// email + ipv4 on produced 31 + 164 additional hits on that same text, almost
// all of them ordinary content. That ratio is the whole argument.
//
// Every rule below is anchored on a distinctive prefix, a structural marker,
// or a keyword, rather than on "looks random", to keep false positives low.

const RULES = [
  {
    id: 'privateKey',
    label: 'PEM private key block',
    defaultOn: true,
    // -----BEGIN [RSA|EC|OPENSSH|PGP|DSA] PRIVATE KEY----- ... -----END ...-----
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    id: 'jwt',
    label: 'JSON Web Token',
    defaultOn: true,
    // header.payload.signature where the header base64url-decodes from '{"'
    re: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
  },
  {
    id: 'awsAccessKeyId',
    label: 'AWS access key id',
    defaultOn: true,
    re: /\b(?:AKIA|ASIA|ABIA|ACCA|AIDA|AIPA|ANPA|ANVA|AROA)[0-9A-Z]{16}\b/g,
  },
  {
    id: 'awsSecretAccessKey',
    label: 'AWS secret access key',
    defaultOn: true,
    // Requires the keyword: a bare 40-char base64 string is not distinctive.
    re: /\baws[_-]?secret[_-]?access[_-]?key\b\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/gi,
  },
  {
    id: 'privateKeySsh',
    label: 'OpenSSH private key body',
    defaultOn: true,
    re: /\bPuTTY-User-Key-File-\d[\s\S]*?Private-MAC:\s*\S+/g,
  },
  {
    id: 'bearerToken',
    label: 'Bearer / Authorization token',
    defaultOn: true,
    re: /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9\-._~+/]{12,}={0,2}/g,
  },
  {
    id: 'anthropicKey',
    label: 'Anthropic API key',
    defaultOn: true,
    re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  },
  {
    id: 'openAiKey',
    label: 'OpenAI-style sk- API key',
    defaultOn: true,
    // sk-..., sk-proj-..., sk-svcacct-..., sk-None-...
    re: /\bsk-(?:proj-|svcacct-|admin-|None-|live-|test-)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: 'stripeKey',
    label: 'Stripe secret/restricted key',
    defaultOn: true,
    re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  },
  {
    id: 'githubToken',
    label: 'GitHub token',
    defaultOn: true,
    re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  },
  {
    id: 'slackToken',
    label: 'Slack token',
    defaultOn: true,
    re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  },
  {
    id: 'googleApiKey',
    label: 'Google API key',
    defaultOn: true,
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: 'npmToken',
    label: 'npm access token',
    defaultOn: true,
    re: /\bnpm_[A-Za-z0-9]{30,}\b/g,
  },
  {
    id: 'connectionString',
    label: 'connection string with embedded credentials',
    defaultOn: true,
    // scheme://user:password@host — only matches when a password is present.
    re: /\b[a-zA-Z][a-zA-Z0-9+.-]{1,30}:\/\/[^\s:/@]+:[^\s/@]+@[^\s/?#]+/g,
  },
  {
    id: 'genericSecretAssignment',
    label: 'keyword-labelled secret assignment',
    defaultOn: true,
    // API_KEY=..., "secret": "...", password: '...'
    re: /\b(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret[_-]?key|client[_-]?secret|password|passwd|refresh[_-]?token)\b["']?\s*[:=]\s*["']?[^\s"',;]{8,}["']?/gi,
  },
  {
    id: 'email',
    label: 'email address',
    defaultOn: false, // see the comment block above — over-broad on real text
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    id: 'ipv4',
    label: 'IPv4 address',
    defaultOn: false, // see the comment block above — over-broad on real text
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,
  },
]

/** Rule catalogue, safe to expose to a UI (regexes rendered as source strings). */
export const PII_RULES = RULES.map(r => ({
  id: r.id,
  label: r.label,
  defaultOn: r.defaultOn,
  pattern: r.re.source,
}))

export const OPT_IN_RULE_IDS = RULES.filter(r => !r.defaultOn).map(r => r.id)

const resolveRules = (opts) => {
  const o = isObj(opts) ? opts : {}
  const include = new Set(asArray(o.include).filter(x => typeof x === 'string'))
  const exclude = new Set(asArray(o.exclude).filter(x => typeof x === 'string'))
  const only = Array.isArray(o.only) ? new Set(o.only.filter(x => typeof x === 'string')) : null

  const enabled = RULES.filter(r => {
    if (only) return only.has(r.id)
    if (exclude.has(r.id)) return false
    if (include.has(r.id)) return true
    return r.defaultOn
  })

  const known = new Set(RULES.map(r => r.id))
  const unknownIds = [...include, ...exclude, ...(only ?? [])].filter(id => !known.has(id))
  return { enabled, unknownIds }
}

/** Short, non-leaking preview of a matched secret: first 4 chars + length. */
const previewOf = (m) => {
  const s = typeof m === 'string' ? m : ''
  if (s.length <= 8) return '*'.repeat(s.length)
  return `${s.slice(0, 4)}…${'*'.repeat(4)} (${s.length} chars)`
}

/**
 * Find secrets in `text`.
 *
 * @param {string} text
 * @param {object} [opts] { include: [ruleId], exclude: [ruleId], only: [ruleId] }
 * @returns {object} { ok, findings, counts, categories, total, rules, ... }
 */
export function detectPii(text, opts) {
  const { enabled, unknownIds } = resolveRules(opts)
  const base = {
    rulesEnabled: enabled.map(r => r.id),
    rulesAvailable: RULES.map(r => r.id),
    optInRules: [...OPT_IN_RULE_IDS],
    unknownRuleIds: unknownIds,
  }

  if (typeof text !== 'string') {
    return {
      ok: false,
      reason: 'input-not-a-string',
      inputType: text === null ? 'null' : typeof text,
      findings: [],
      counts: {},
      categories: [],
      total: 0,
      ...base,
    }
  }

  const raw = []
  for (const rule of enabled) {
    // Fresh regex per call — a shared /g regex carries lastIndex across calls.
    let re
    try { re = new RegExp(rule.re.source, rule.re.flags) } catch { continue }
    let m
    let guard = 0
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue }
      raw.push({
        category: rule.id,
        label: rule.label,
        index: m.index,
        length: m[0].length,
        end: m.index + m[0].length,
        preview: previewOf(m[0]),
      })
      if (++guard > 100000) break // pathological input: bail rather than hang
    }
  }

  // Resolve overlaps: rule order = priority, then longest match.
  const priority = new Map(RULES.map((r, i) => [r.id, i]))
  raw.sort((a, b) =>
    a.index - b.index ||
    (priority.get(a.category) - priority.get(b.category)) ||
    (b.length - a.length))

  const findings = []
  for (const f of raw) {
    const clash = findings.find(k => f.index < k.end && k.index < f.end)
    if (clash) { clash.overlapsSuppressed = (clash.overlapsSuppressed || 0) + 1; continue }
    findings.push(f)
  }
  findings.sort((a, b) => a.index - b.index)

  const counts = {}
  for (const f of findings) counts[f.category] = (counts[f.category] || 0) + 1

  return {
    ok: true,
    findings,
    counts,
    categories: Object.keys(counts).sort(),
    total: findings.length,
    ...base,
  }
}

/**
 * Redact secrets in `text`.
 *
 * Matches are replaced RIGHT-TO-LEFT (descending start index) so that every
 * not-yet-applied match still points at a valid offset in the string being
 * mutated. Replacing left-to-right would shift every later index by
 * (replacement.length - match.length) and corrupt the remaining splices.
 *
 * @param {string} text
 * @param {object} [opts]
 *   include/exclude/only : rule id arrays (email & ipv4 are opt-in)
 *   placeholder          : (category, finding) => string, or a fixed string
 * @returns {object} { ok, text, changed, redactions, counts, total, ... }
 */
export function redact(text, opts) {
  const o = isObj(opts) ? opts : {}
  const detected = detectPii(text, o)

  if (!detected.ok) {
    return {
      ok: false,
      reason: detected.reason,
      inputType: detected.inputType,
      text: typeof text === 'string' ? text : '',
      changed: false,
      redactions: [],
      counts: {},
      total: 0,
      bytesRemoved: 0,
      rulesEnabled: detected.rulesEnabled,
      optInRules: detected.optInRules,
      skippedByDefault: OPT_IN_RULE_IDS.filter(id => !detected.rulesEnabled.includes(id)),
      unknownRuleIds: detected.unknownRuleIds,
    }
  }

  const makePlaceholder = (f) => {
    if (typeof o.placeholder === 'string') return o.placeholder
    if (typeof o.placeholder === 'function') {
      try {
        const v = o.placeholder(f.category, { ...f })
        if (typeof v === 'string') return v
      } catch { /* fall through to the default */ }
    }
    return `[REDACTED:${f.category}]`
  }

  // RIGHT-TO-LEFT: descending start index keeps earlier offsets valid.
  const ordered = [...detected.findings].sort((a, b) => b.index - a.index)

  let out = text
  const counts = {}
  let removedChars = 0
  for (const f of ordered) {
    const ph = makePlaceholder(f)
    out = out.slice(0, f.index) + ph + out.slice(f.index + f.length)
    counts[f.category] = (counts[f.category] || 0) + 1
    removedChars += f.length
  }

  const byCategory = Object.keys(counts).sort().map(id => {
    const rule = RULES.find(r => r.id === id)
    const items = detected.findings.filter(f => f.category === id)
    return {
      category: id,
      label: rule ? rule.label : 'unknown',
      count: counts[id],
      charsRemoved: items.reduce((s, f) => s + f.length, 0),
    }
  })

  return {
    ok: true,
    text: out,
    changed: detected.findings.length > 0,
    // "report WHAT was redacted": category + count + size, never the secret.
    redactions: byCategory,
    counts,
    total: detected.findings.length,
    charsRemoved: removedChars,
    findings: detected.findings.map(f => ({
      category: f.category, index: f.index, length: f.length, preview: f.preview,
    })),
    rulesEnabled: detected.rulesEnabled,
    optInRules: detected.optInRules,
    // Named explicitly so a caller can see that email/ipv4 were left alone
    // on purpose, rather than assuming the text contained none.
    skippedByDefault: OPT_IN_RULE_IDS.filter(id => !detected.rulesEnabled.includes(id)),
    unknownRuleIds: detected.unknownRuleIds,
  }
}
