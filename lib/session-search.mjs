/**
 * Transcript analysis: full-text search (059), abnormal-end detection (060),
 * compaction tracking (058).
 *
 * Everything here is pure: parsed JSONL records in, plain objects out. No fs,
 * no network, no clock reads (pass `opts.now` if you want staleness judged).
 * Nothing throws on a malformed record — a record that is not an object, or
 * whose `message`/`content` is the wrong shape, is skipped and counted.
 *
 * Record shapes were read off the real transcripts on this machine
 * (~/.claude/projects/<mangled>/<session>.jsonl and
 * <session>/subagents/agent-*.jsonl, Claude Code version 2.1.220). See the
 * VERIFIED / INFERRED notes above each feature.
 */

/* ------------------------------------------------------------------ shared */

export const UNKNOWN = 'unknown'

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = v => (typeof v === 'string' ? v : '')
const finite = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** VERIFIED: every conversation record carries `type`; 'user' | 'assistant' |
 *  'system' are the conversation-bearing ones. 'attachment', 'mode',
 *  'last-prompt' and 'queue-operation' also appear and are bookkeeping. */
const CONVERSATION_TYPES = new Set(['user', 'assistant', 'system'])

/** message.content is EITHER a string (35 of 599 user records here) or an
 *  array of blocks. Anything else is treated as no blocks. */
const blocksOf = rec => {
  if (!isObj(rec)) return []
  const content = isObj(rec.message) ? rec.message.content : undefined
  if (Array.isArray(content)) return content.filter(isObj)
  return []
}

const contentStringOf = rec => {
  if (!isObj(rec)) return ''
  const content = isObj(rec.message) ? rec.message.content : undefined
  return typeof content === 'string' ? content : ''
}

/** VERIFIED: `type` and `message.role` agree in the real data; role is the
 *  fallback, and 'unknown' is a real answer when neither is usable. */
const roleOf = rec => {
  if (!isObj(rec)) return UNKNOWN
  const t = str(rec.type)
  if (t === 'user' || t === 'assistant' || t === 'system') return t
  const role = isObj(rec.message) ? str(rec.message.role) : ''
  if (role === 'user' || role === 'assistant') return role
  return UNKNOWN
}

const tsOf = rec => (isObj(rec) && typeof rec.timestamp === 'string' ? rec.timestamp : null)

const msOf = rec => {
  const t = tsOf(rec)
  if (!t) return null
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : null
}

/* ------------------------------------------------- 059: full-text search */

/**
 * VERIFIED field names used below:
 *   rec.type, rec.uuid, rec.sessionId, rec.timestamp, rec.isSidechain,
 *   rec.cwd, rec.gitBranch, rec.agentId (subagent files only),
 *   rec.message.role, rec.message.content[]
 *   text block:      { type: 'text', text }
 *   thinking block:  { type: 'thinking', thinking, signature }
 *   tool_use block:  { type: 'tool_use', id, name, input, caller }
 *   tool_result:     { type: 'tool_result', tool_use_id, content, is_error }
 *
 * REDACTION POLICY (deliberate): tool_use *inputs* are searched, because that
 * is where the useful "which session ran that command" signal lives — but no
 * tool input VALUE is ever returned. A tool-input hit returns the tool name
 * and the JSON path of the field that matched (e.g. `Bash.command`), and a
 * snippet that is a fixed description, never a slice of the value. So a match
 * on a Bash command containing an API token tells you where to look without
 * reprinting the token. Tool RESULTS are not searched at all for the same
 * reason (their content is unbounded command output). If you want the value,
 * open the transcript yourself — that is an explicit act, not a search result.
 */

export const DEFAULT_SEARCH_LIMIT = 200
export const DEFAULT_SNIPPET_RADIUS = 80

export const REDACTED_SNIPPET = '[tool input value redacted]'

/** Split a query into quoted phrases and bare terms. Unbalanced quotes are
 *  reported rather than thrown on: the dangling fragment becomes a term. */
export function parseQuery(query) {
  const raw = typeof query === 'string' ? query : ''
  const phrases = []
  const terms = []
  let unbalancedQuote = false
  const re = /"([^"]*)"|(\S+)/g
  let m
  while ((m = re.exec(raw)) !== null) {
    if (m[1] !== undefined) {
      const p = m[1].trim()
      if (p) phrases.push(p)
    } else {
      const t = m[2]
      if (t.includes('"')) {
        unbalancedQuote = true
        const cleaned = t.replace(/"/g, '').trim()
        if (cleaned) terms.push(cleaned)
      } else if (t) {
        terms.push(t)
      }
    }
  }
  return { phrases, terms, needles: [...phrases, ...terms], unbalancedQuote, raw }
}

const indexOfNeedle = (haystack, needle, caseSensitive) => {
  if (!haystack || !needle) return -1
  return caseSensitive
    ? haystack.indexOf(needle)
    : haystack.toLowerCase().indexOf(needle.toLowerCase())
}

const snippetAround = (text, at, needleLength, radius) => {
  const start = Math.max(0, at - radius)
  const end = Math.min(text.length, at + needleLength + radius)
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return { snippet: `${prefix}${body}${suffix}`, truncatedLeft: start > 0, truncatedRight: end < text.length }
}

/** Walk a tool_use input, returning `[{ path, value }]` for every string leaf.
 *  Depth- and node-bounded so a pathological input cannot hang the search;
 *  a bound that was hit is reported on the result (`inputTruncated`). */
const stringLeaves = (value, path, out, state) => {
  if (out.length >= state.maxLeaves || state.depth > state.maxDepth) {
    state.hitBound = true
    return
  }
  if (typeof value === 'string') {
    out.push({ path, value })
    return
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    out.push({ path, value: String(value) })
    return
  }
  if (Array.isArray(value)) {
    state.depth++
    for (let i = 0; i < value.length; i++) stringLeaves(value[i], `${path}[${i}]`, out, state)
    state.depth--
    return
  }
  if (isObj(value)) {
    state.depth++
    for (const k of Object.keys(value)) stringLeaves(value[k], path ? `${path}.${k}` : k, out, state)
    state.depth--
  }
}

/**
 * searchTranscripts(records, query, opts)
 *
 * @param {Array} records parsed JSONL records (any mix of sessions/subagents)
 * @param {string} query  bare terms and/or "quoted phrases"; all must match
 * @param {object} [opts]
 *   limit           max results returned (default 200); truncation is reported
 *   caseSensitive   default false
 *   matchMode       'all' (default) | 'any'
 *   snippetRadius   chars of context either side of the hit (default 80)
 *   includeThinking search assistant thinking blocks too (default false)
 *   includeToolInputs search tool_use inputs (default true, values redacted)
 *   sessionId       fallback sessionId for records that lack one
 * @returns {{results: Array, total: number, returned: number, truncated: boolean,
 *            limit: number, query: object, skipped: number, scanned: number}}
 */
export function searchTranscripts(records, query, opts = {}) {
  const o = isObj(opts) ? opts : {}
  const limit = finite(o.limit) !== null && o.limit > 0 ? Math.floor(o.limit) : DEFAULT_SEARCH_LIMIT
  const caseSensitive = o.caseSensitive === true
  const matchMode = o.matchMode === 'any' ? 'any' : 'all'
  const radius = finite(o.snippetRadius) !== null && o.snippetRadius >= 0
    ? Math.floor(o.snippetRadius)
    : DEFAULT_SNIPPET_RADIUS
  const includeThinking = o.includeThinking === true
  const includeToolInputs = o.includeToolInputs !== false
  const fallbackSession = str(o.sessionId) || null

  const parsed = parseQuery(query)
  const empty = {
    results: [],
    total: 0,
    returned: 0,
    truncated: false,
    limit,
    query: parsed,
    scanned: 0,
    skipped: 0,
  }
  if (!Array.isArray(records)) return { ...empty, skipped: 0 }
  if (parsed.needles.length === 0) return { ...empty, scanned: 0 }

  const results = []
  let total = 0
  let scanned = 0
  let skipped = 0

  const matchesAll = fields => {
    // Every needle must appear SOMEWHERE in the record's searchable fields
    // (not necessarily the same field) — otherwise a two-word query would only
    // ever hit a single block.
    if (matchMode === 'any') return true
    return parsed.needles.every(n => fields.some(f => indexOfNeedle(f, n, caseSensitive) >= 0))
  }

  const push = hit => {
    total++
    if (results.length < limit) results.push(hit)
  }

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    if (!isObj(rec)) { skipped++; continue }
    scanned++

    const role = roleOf(rec)
    const base = {
      sessionId: str(rec.sessionId) || fallbackSession || UNKNOWN,
      agentId: str(rec.agentId) || null,
      uuid: str(rec.uuid) || null,
      timestamp: tsOf(rec),
      role,
      index: i,
      isSidechain: typeof rec.isSidechain === 'boolean' ? rec.isSidechain : null,
      cwd: str(rec.cwd) || null,
      gitBranch: str(rec.gitBranch) || null,
    }

    // Collect the searchable surfaces of this record first, so an all-terms
    // query can be satisfied across blocks.
    const textFields = []
    const textBlocks = []
    const toolBlocks = []

    const contentStr = contentStringOf(rec)
    if (contentStr) {
      textFields.push(contentStr)
      textBlocks.push({ kind: role === 'assistant' ? 'assistant_text' : 'user_text', text: contentStr, tool: null })
    }

    for (const b of blocksOf(rec)) {
      const t = str(b.type)
      if (t === 'text' && typeof b.text === 'string') {
        textFields.push(b.text)
        textBlocks.push({ kind: role === 'assistant' ? 'assistant_text' : 'user_text', text: b.text, tool: null })
      } else if (t === 'thinking' && includeThinking && typeof b.thinking === 'string') {
        textFields.push(b.thinking)
        textBlocks.push({ kind: 'assistant_thinking', text: b.thinking, tool: null })
      } else if (t === 'tool_use' && includeToolInputs) {
        const leaves = []
        const state = { depth: 0, maxDepth: 12, maxLeaves: 500, hitBound: false }
        stringLeaves(b.input, '', leaves, state)
        const name = str(b.name) || UNKNOWN
        toolBlocks.push({ name, id: str(b.id) || null, leaves, inputTruncated: state.hitBound })
        for (const leaf of leaves) textFields.push(leaf.value)
      }
      // tool_result blocks are intentionally NOT searched — see REDACTION POLICY.
    }

    if (textFields.length === 0) continue
    if (!matchesAll(textFields)) continue

    for (const tb of textBlocks) {
      for (const needle of parsed.needles) {
        const at = indexOfNeedle(tb.text, needle, caseSensitive)
        if (at < 0) continue
        const { snippet, truncatedLeft, truncatedRight } = snippetAround(tb.text, at, needle.length, radius)
        push({
          ...base,
          source: tb.kind,
          tool: null,
          field: null,
          matched: needle,
          matchedIsPhrase: parsed.phrases.includes(needle),
          snippet,
          snippetRedacted: false,
          snippetTruncated: truncatedLeft || truncatedRight,
        })
        break // one hit per block is enough to locate it
      }
    }

    for (const tool of toolBlocks) {
      for (const leaf of tool.leaves) {
        const needle = parsed.needles.find(n => indexOfNeedle(leaf.value, n, caseSensitive) >= 0)
        if (!needle) continue
        push({
          ...base,
          source: 'tool_input',
          tool: tool.name,
          toolUseId: tool.id,
          // The FIELD PATH is safe to return; the VALUE never is.
          field: leaf.path || UNKNOWN,
          matched: needle,
          matchedIsPhrase: parsed.phrases.includes(needle),
          snippet: `${tool.name} input field "${leaf.path || UNKNOWN}" matched ${REDACTED_SNIPPET}`,
          snippetRedacted: true,
          snippetTruncated: false,
          inputTruncated: tool.inputTruncated,
        })
        break // one hit per tool_use block; do not enumerate every field
      }
    }
  }

  return {
    results,
    total,
    returned: results.length,
    truncated: total > results.length,
    limit,
    query: parsed,
    scanned,
    skipped,
  }
}

/* --------------------------------------- 060: abnormal-end detection */

/**
 * VERIFIED on this machine:
 *   - assistant `message.stop_reason` is 'tool_use' (1039), 'end_turn' (35) or
 *     null (4) in the main session. In the SUBAGENT files it is present but
 *     null on 39 of 41 assistant records — so a missing/null stop_reason is
 *     NOT evidence of a crash, it is evidence of nothing. That is why those
 *     sessions resolve to 'unknown' rather than 'abnormal'.
 *   - one logical assistant turn can be split across several records sharing
 *     `message.id` (seen up to 5); only some carry a stop_reason, so the whole
 *     trailing group is inspected.
 *   - `interruptedByShutdown: true` and `toolDenialKind: 'user-rejected'`
 *     appear on user records; the first is only treated as an ending signal
 *     when it is in the trailing segment.
 *   - trailing bookkeeping records ('mode', 'last-prompt', 'queue-operation',
 *     'attachment') are ignored when deciding how the conversation ended.
 * INFERRED: 'max_tokens' / 'stop_sequence' / 'refusal' as terminal stop
 * reasons — not observed here, accepted as terminal because they end a turn.
 */

const TERMINAL_STOP_REASONS = new Set(['end_turn', 'stop_sequence', 'max_tokens', 'refusal'])

export const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000

/**
 * detectAbnormalEnd(records, opts)
 *
 * @param {Array} records one session's records, in file order
 * @param {object} [opts]
 *   now           epoch ms "current time"; without it staleness is not judged
 *   staleAfterMs  silence after which an unfinished session looks dead (30m)
 *   gapFactor     trailing gap / median gap ratio that counts as a long gap (8)
 * @returns {{ended: 'clean'|'abnormal'|'unknown', reason: string, evidence: object}}
 */
export function detectAbnormalEnd(records, opts = {}) {
  const o = isObj(opts) ? opts : {}
  const now = finite(o.now)
  const staleAfterMs = finite(o.staleAfterMs) !== null && o.staleAfterMs > 0
    ? o.staleAfterMs
    : DEFAULT_STALE_AFTER_MS
  const gapFactor = finite(o.gapFactor) !== null && o.gapFactor > 1 ? o.gapFactor : 8

  const evidence = {
    records: Array.isArray(records) ? records.length : 0,
    conversationRecords: 0,
    malformedRecords: 0,
    pendingToolUses: [],
    lastRole: UNKNOWN,
    lastStopReason: UNKNOWN,
    lastTimestamp: null,
    trailingGapMs: null,
    medianGapMs: null,
    sinceLastRecordMs: null,
    stale: UNKNOWN,
    interruptedByShutdown: false,
    stopReasonsSeen: 0,
  }

  if (!Array.isArray(records) || records.length === 0) {
    return { ended: UNKNOWN, reason: 'no-records', evidence }
  }

  const conv = []
  const pending = new Map() // tool_use id -> { name, index, uuid }
  const timestamps = []

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    if (!isObj(rec)) { evidence.malformedRecords++; continue }
    const ms = msOf(rec)
    if (ms !== null) timestamps.push(ms)

    for (const b of blocksOf(rec)) {
      const t = str(b.type)
      if (t === 'tool_use') {
        const id = str(b.id)
        if (id) pending.set(id, { id, name: str(b.name) || UNKNOWN, index: i, uuid: str(rec.uuid) || null })
      } else if (t === 'tool_result') {
        const id = str(b.tool_use_id)
        if (id) pending.delete(id)
      }
    }

    if (CONVERSATION_TYPES.has(str(rec.type))) conv.push({ rec, index: i })
  }

  evidence.conversationRecords = conv.length
  evidence.pendingToolUses = [...pending.values()].map(p => ({ id: p.id, name: p.name, index: p.index }))

  if (timestamps.length > 0) {
    evidence.lastTimestamp = new Date(timestamps[timestamps.length - 1]).toISOString()
    if (timestamps.length >= 2) {
      evidence.trailingGapMs = timestamps[timestamps.length - 1] - timestamps[timestamps.length - 2]
      const gaps = []
      for (let i = 1; i < timestamps.length; i++) gaps.push(timestamps[i] - timestamps[i - 1])
      gaps.sort((a, b) => a - b)
      evidence.medianGapMs = gaps[Math.floor(gaps.length / 2)]
    }
    if (now !== null) {
      evidence.sinceLastRecordMs = now - timestamps[timestamps.length - 1]
      evidence.stale = evidence.sinceLastRecordMs > staleAfterMs
    }
  }

  if (conv.length === 0) {
    return { ended: UNKNOWN, reason: 'no-conversation-records', evidence }
  }

  const last = conv[conv.length - 1]
  evidence.lastRole = roleOf(last.rec)

  // The trailing assistant turn may be split across records sharing message.id;
  // look at the whole group for a stop_reason before concluding there is none.
  const lastAssistant = [...conv].reverse().find(c => roleOf(c.rec) === 'assistant')
  let trailingStopReason = null
  let sawStopReasonKey = false
  if (lastAssistant) {
    const msgId = isObj(lastAssistant.rec.message) ? str(lastAssistant.rec.message.id) : ''
    for (const c of conv) {
      if (roleOf(c.rec) !== 'assistant' || !isObj(c.rec.message)) continue
      const sameTurn = msgId ? str(c.rec.message.id) === msgId : c.index === lastAssistant.index
      if (!sameTurn) continue
      if ('stop_reason' in c.rec.message) sawStopReasonKey = true
      const sr = str(c.rec.message.stop_reason)
      if (sr) trailingStopReason = sr
    }
  }
  evidence.lastStopReason = trailingStopReason ?? (sawStopReasonKey ? null : UNKNOWN)

  // How many stop reasons does this transcript record AT ALL? Subagent files
  // record none, and in that world "no terminal stop reason" means nothing.
  for (const c of conv) {
    if (roleOf(c.rec) !== 'assistant' || !isObj(c.rec.message)) continue
    if (str(c.rec.message.stop_reason)) evidence.stopReasonsSeen++
  }

  // interruptedByShutdown counts only when nothing came after it — in the real
  // transcript it appears mid-session and the session carried on for hours.
  const afterLastAssistant = lastAssistant
    ? conv.filter(c => c.index > lastAssistant.index)
    : conv
  evidence.interruptedByShutdown = afterLastAssistant.some(c => c.rec.interruptedByShutdown === true)

  // --- decision ---------------------------------------------------------

  if (pending.size > 0) {
    // A tool call was issued and never answered. This is the strongest signal.
    if (now !== null && evidence.stale === false) {
      return {
        ended: UNKNOWN,
        reason: 'tool-call-in-flight',
        evidence: { ...evidence, note: 'unanswered tool_use, but the session is still recent — it may simply be running' },
      }
    }
    return {
      ended: 'abnormal',
      reason: 'unanswered-tool-use',
      evidence,
    }
  }

  if (evidence.interruptedByShutdown) {
    return { ended: 'abnormal', reason: 'interrupted-by-shutdown', evidence }
  }

  if (trailingStopReason && TERMINAL_STOP_REASONS.has(trailingStopReason)) {
    // A long silence after a completed turn is an idle session, not a crash.
    return { ended: 'clean', reason: `terminal-stop-reason:${trailingStopReason}`, evidence }
  }

  if (!lastAssistant) {
    return { ended: UNKNOWN, reason: 'no-assistant-turn', evidence }
  }

  if (evidence.stopReasonsSeen === 0) {
    // e.g. subagent transcripts: stop_reason is present but always null.
    // Absence of the signal is not presence of a crash.
    return { ended: UNKNOWN, reason: 'transcript-records-no-stop-reasons', evidence }
  }

  if (trailingStopReason === 'tool_use') {
    // stop_reason says a tool call follows, and we already know every tool_use
    // was answered — so the file stops between the result and the next turn.
    // On a LIVE session that is simply the current moment, which is why a
    // recent last record downgrades this to unknown rather than abnormal.
    if (now !== null && evidence.stale === false) {
      return {
        ended: UNKNOWN,
        reason: 'turn-in-flight',
        evidence: { ...evidence, note: 'last turn handed off to a tool result and the session is still recent' },
      }
    }
    return { ended: 'abnormal', reason: 'stopped-awaiting-next-turn', evidence }
  }

  const longGap = evidence.trailingGapMs !== null
    && evidence.medianGapMs !== null
    && evidence.medianGapMs > 0
    && evidence.trailingGapMs > evidence.medianGapMs * gapFactor

  if (longGap && evidence.lastRole === 'user') {
    return { ended: 'abnormal', reason: 'user-turn-never-answered', evidence }
  }

  if (evidence.lastRole === 'user') {
    return { ended: UNKNOWN, reason: 'ends-on-user-turn', evidence }
  }

  return { ended: UNKNOWN, reason: 'no-terminal-stop-reason', evidence }
}

/* ------------------------------------------- 058: compaction tracking */

/**
 * WHAT I ACTUALLY FOUND vs WHAT IS INFERRED — read this before trusting output.
 *
 * VERIFIED: `type: 'system'` records exist and carry a `subtype`. The only
 * subtype present in the transcripts on this machine is 'stop_hook_summary'
 * (18 records). There is NOT a single `compact_boundary` record, no
 * `compactMetadata`, no `isCompactSummary` and no `type: 'summary'` record
 * anywhere under ~/.claude/projects — this account's sessions never compacted.
 * So the compaction field names below could NOT be verified against data.
 *
 * INFERRED from the shape of the surrounding code and the documented event:
 *   record:   { type: 'system', subtype: 'compact_boundary', timestamp, uuid,
 *               sessionId, compactMetadata: {...} }
 *   trigger:  compactMetadata.trigger  ('manual' | 'auto')
 *   tokens:   compactMetadata.preTokens / .postTokens
 *   duration: compactMetadata.durationMs
 * Because none of that is verified, the parser accepts a set of ALIASES for
 * each field (both nested under compactMetadata and flat on the record) and
 * reports, per event, which concrete key it read each value from
 * (`fieldSources`) and which requested fields were absent (`missing`). If the
 * real format differs, the aliases below are the one place to extend.
 */

// 'compaction_trigger' is the name the hooks receiver in this repo already
// uses (server/hooks-receiver.mjs), which is why it is in the alias list.
const TRIGGER_KEYS = ['trigger', 'compactTrigger', 'compactionTrigger', 'compaction_trigger', 'reason', 'kind']
const PRE_KEYS = ['preTokens', 'preCompactTokens', 'tokensBefore', 'preTokenCount', 'inputTokens']
const POST_KEYS = ['postTokens', 'postCompactTokens', 'tokensAfter', 'postTokenCount']
const DURATION_KEYS = ['durationMs', 'duration_ms', 'durationMS', 'compactionDurationMs', 'elapsedMs']

const pickFrom = (sources, keys, coerce) => {
  for (const { name, obj } of sources) {
    if (!isObj(obj)) continue
    for (const key of keys) {
      if (!(key in obj)) continue
      const v = coerce(obj[key])
      if (v !== null) return { value: v, from: name ? `${name}.${key}` : key }
    }
  }
  return { value: null, from: null }
}

const asNumber = v => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

const asString = v => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

const isCompactionRecord = rec => {
  if (!isObj(rec)) return null
  if (str(rec.type) === 'system' && str(rec.subtype) === 'compact_boundary') return 'system.compact_boundary'
  if (isObj(rec.compactMetadata)) return 'compactMetadata'
  if (rec.isCompactSummary === true) return 'isCompactSummary'
  return null
}

/**
 * compactionEvents(records)
 *
 * @param {Array} records parsed records for one or more sessions
 * @returns {{events: Array, count: number, scanned: number, malformedRecords: number,
 *            detectors: object}}
 *   each event: { at, trigger, preTokens, postTokens, reclaimed, durationMs,
 *                 index, uuid, sessionId, detectedBy, fieldSources, missing }
 *   `reclaimed` is preTokens - postTokens ONLY when both are real numbers,
 *   and null otherwise — never derived from a default or a zero.
 */
export function compactionEvents(records) {
  const out = {
    events: [],
    count: 0,
    scanned: 0,
    malformedRecords: 0,
    detectors: { 'system.compact_boundary': 0, compactMetadata: 0, isCompactSummary: 0 },
  }
  if (!Array.isArray(records)) return out

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    if (!isObj(rec)) { out.malformedRecords++; continue }
    out.scanned++
    const detectedBy = isCompactionRecord(rec)
    if (!detectedBy) continue
    out.detectors[detectedBy]++

    // Look inside compactMetadata first, then at the record's own top level.
    const sources = [
      { name: 'compactMetadata', obj: rec.compactMetadata },
      { name: '', obj: rec },
    ]

    const trigger = pickFrom(sources, TRIGGER_KEYS, asString)
    const pre = pickFrom(sources, PRE_KEYS, asNumber)
    const post = pickFrom(sources, POST_KEYS, asNumber)
    const duration = pickFrom(sources, DURATION_KEYS, asNumber)

    // The one arithmetic rule that matters: no default stands in for a missing
    // number. Either both endpoints are real, or reclaimed is null.
    const reclaimed = pre.value !== null && post.value !== null ? pre.value - post.value : null

    const missing = []
    if (trigger.value === null) missing.push('trigger')
    if (pre.value === null) missing.push('preTokens')
    if (post.value === null) missing.push('postTokens')
    if (duration.value === null) missing.push('durationMs')
    if (reclaimed === null) missing.push('reclaimed')

    out.events.push({
      at: tsOf(rec),
      trigger: trigger.value,
      preTokens: pre.value,
      postTokens: post.value,
      reclaimed,
      durationMs: duration.value,
      index: i,
      uuid: str(rec.uuid) || null,
      sessionId: str(rec.sessionId) || null,
      detectedBy,
      fieldSources: {
        trigger: trigger.from,
        preTokens: pre.from,
        postTokens: post.from,
        durationMs: duration.from,
      },
      missing,
    })
  }

  out.count = out.events.length
  return out
}
