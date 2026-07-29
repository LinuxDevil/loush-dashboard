// Mistake→rule→fix "Lessons" ledger — feature 066.
//
// Upstream (SuperClaude, MIT) describes this JSONL schema but never shipped code that fills it
// in. The schema is the cheap half. The valuable half is `deriveLessons()`, which proposes
// lessons out of transcript records this dashboard already parses — so a lesson is a thing that
// demonstrably happened, not a thing a model thought sounded wise.
//
// The rule that shapes every decision below:
//
//   A lesson with no evidence is never emitted.
//
// A "lesson" is an instruction a user may well paste into their CLAUDE.md. An ungrounded one is
// a hallucinated instruction with a ledger's authority behind it — strictly worse than an empty
// ledger, because the empty ledger is honest. So each proposal carries `evidence` pointing at
// the uuids/timestamps of the records that produced it, every candidate is filtered on
// `evidence.length > 0` before it leaves this module, and the derivation prefers emitting
// nothing over emitting a guess.
//
// House rules applied here:
//   - Unknown is a value. A field we cannot observe is the string 'unknown' (or an empty
//     `tests` array), never an invented plausible value.
//   - No silent caps. Every bound — max proposals, the confidence floor, each signal threshold —
//     is in `opts`, is echoed back in the returned `limits`, and anything it dropped is counted.
//   - Never throws. Malformed records, malformed JSONL lines, a non-array input, a null `opts`:
//     all return a value describing the problem.
//   - Pure. Records in, objects out. No fs, no network, no clock (`ts` comes from the records).
//
// EVIDENCE NOTE — what the signals below were calibrated against.
// The transcripts available on this machine (~/.claude/projects/-home-user-loush-dashboard/)
// hold 452 tool_use blocks, 453 tool_result blocks, and 25 `is_error: true` results. Observed
// error strings include `File does not exist.`, `Exit code 1` (+ traceback), `Exit code 144`,
// and `The user doesn't want to proceed with this tool use.`. That last one is a human
// deliberately declining a tool call. It is a decision, not a mistake, and DECLINE_PATTERNS
// exists to keep it out of every failure signal.

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

// The status enum. Small on purpose: this tracks a human's review of a machine proposal, and
// every extra state is another one a UI has to explain.
export const LESSON_STATUSES = [
  {
    id: 'proposed',
    label: 'Proposed',
    description:
      'Derived from transcript evidence by this module and not yet reviewed by a human. Everything ' +
      '`deriveLessons()` returns is `proposed`. A proposed lesson is a claim about what happened, ' +
      'not an accepted rule — it should never be presented as guidance the user already agreed to.',
  },
  {
    id: 'accepted',
    label: 'Accepted',
    description:
      'A human read the lesson and adopted its rule. Only an accepted lesson belongs in generated ' +
      'guidance (a CLAUDE.md block, a checklist). Set by a person, never by derivation.',
  },
  {
    id: 'rejected',
    label: 'Rejected',
    description:
      'A human read the lesson and declined it — wrong reading of the evidence, or true but not ' +
      'worth a rule. Kept in the ledger rather than deleted so the same signal does not come back ' +
      'looking like a new discovery on the next derivation run.',
  },
  {
    id: 'superseded',
    label: 'Superseded',
    description:
      'Was accepted, and a later lesson now covers the same ground. Retained for history: it ' +
      'explains why the older rule existed, which is the part a diff of CLAUDE.md loses.',
  },
]

export const LESSON_STATUS_IDS = LESSON_STATUSES.map(s => s.id)

// The eight schema fields, in serialization order, plus the two proposal-metadata fields.
export const LESSON_FIELDS = ['ts', 'task', 'mistake', 'evidence', 'rule', 'fix', 'tests', 'status']
export const LESSON_META_FIELDS = ['confidence', 'signal']

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = v => typeof v === 'string'
const trimmed = v => (isStr(v) ? v.trim() : '')

// A ts is either a parseable ISO-8601 instant or the literal 'unknown'. 'unknown' is legal
// because a record can carry a uuid and no timestamp, and dropping an otherwise-grounded lesson
// over a missing clock reading would be the wrong trade.
const isIsoish = s => isStr(s) && s.length >= 10 && Number.isFinite(Date.parse(s))

/**
 * Normalize one evidence reference.
 * Accepts a bare uuid string, or `{uuid, ts, note}`. A reference must identify at least one
 * record — a uuid or a timestamp. `{note: 'it felt wrong'}` is not evidence and is rejected.
 * @returns {{ok: boolean, value: {uuid: string|null, ts: string|null, note: string|null}|null, reason: string|null}}
 */
export function normalizeEvidence(ref) {
  if (isStr(ref)) {
    const uuid = ref.trim()
    if (!uuid) return { ok: false, value: null, reason: 'empty evidence reference' }
    return { ok: true, value: { uuid, ts: null, note: null }, reason: null }
  }
  if (!isObj(ref)) return { ok: false, value: null, reason: 'evidence reference must be a string or an object' }
  const uuid = trimmed(ref.uuid) || null
  const ts = isIsoish(ref.ts) ? ref.ts : null
  const note = trimmed(ref.note) || null
  if (!uuid && !ts) {
    return { ok: false, value: null, reason: 'evidence reference identifies no record (needs uuid or ts)' }
  }
  return { ok: true, value: { uuid, ts, note }, reason: null }
}

/**
 * Validate and normalize a lesson. Never throws.
 *
 * @returns {{ok: boolean, errors: Array<{field: string, message: string}>, normalized: object|null}}
 *   `normalized` is null when `ok` is false — deliberately, so that
 *   `if (v.normalized) write(v.normalized)` cannot append an invalid lesson to the ledger.
 */
export function validateLesson(obj) {
  const errors = []
  const err = (field, message) => errors.push({ field, message })

  if (!isObj(obj)) {
    return { ok: false, errors: [{ field: '.', message: 'lesson must be an object' }], normalized: null }
  }

  // ts — when the mistake happened. 'unknown' allowed (see isIsoish note above).
  let ts
  if (obj.ts === 'unknown') ts = 'unknown'
  else if (isIsoish(obj.ts)) ts = obj.ts
  else {
    ts = 'unknown'
    err('ts', 'ts must be an ISO-8601 timestamp or the string "unknown"')
  }

  // task — what was being attempted. Unobservable often enough that 'unknown' is a normal value,
  // so a missing task is normalized rather than rejected.
  const task = trimmed(obj.task) || 'unknown'

  // mistake / rule / fix — the three load-bearing strings. A lesson missing any of them is not a
  // mistake→rule→fix record, it is a note. 'unknown' is accepted for `fix` (and only for `fix`),
  // because a failure whose resolution is not in the transcript is still worth recording.
  const mistake = trimmed(obj.mistake)
  if (!mistake) err('mistake', 'mistake is required and must be a non-empty string')
  const rule = trimmed(obj.rule)
  if (!rule) err('rule', 'rule is required and must be a non-empty string')
  const fix = trimmed(obj.fix)
  if (!fix) err('fix', 'fix is required and must be a non-empty string (use "unknown" if not observed)')

  // evidence — the whole point. Must be a non-empty array of resolvable references.
  const evidence = []
  if (!Array.isArray(obj.evidence) || obj.evidence.length === 0) {
    err('evidence', 'evidence is required: a lesson with no evidence is an invented instruction')
  } else {
    obj.evidence.forEach((ref, i) => {
      const n = normalizeEvidence(ref)
      if (n.ok) evidence.push(n.value)
      else err(`evidence[${i}]`, n.reason)
    })
    if (evidence.length === 0) err('evidence', 'no evidence reference resolved to a record')
  }

  // tests — commands/tests that would demonstrate the fix. Empty means "none observed", which is
  // different from "none needed"; a UI must not render an empty list as a green check.
  let tests = []
  if (obj.tests === undefined || obj.tests === null) tests = []
  else if (Array.isArray(obj.tests)) tests = obj.tests.map(t => trimmed(t)).filter(Boolean)
  else err('tests', 'tests must be an array of strings when present')

  // status
  let status = trimmed(obj.status)
  if (!status) {
    status = 'proposed'
  } else if (!LESSON_STATUS_IDS.includes(status)) {
    err('status', `status must be one of: ${LESSON_STATUS_IDS.join(', ')}`)
    status = 'proposed'
  }

  // Proposal metadata. Optional, preserved through serialization so a reviewer can see how sure
  // the derivation was and which signal fired.
  let confidence = null
  if (obj.confidence === undefined || obj.confidence === null) confidence = null
  else if (typeof obj.confidence === 'number' && Number.isFinite(obj.confidence) && obj.confidence >= 0 && obj.confidence <= 1) {
    confidence = obj.confidence
  } else {
    err('confidence', 'confidence must be a number in [0, 1] when present')
  }
  const signal = trimmed(obj.signal) || null

  if (errors.length) return { ok: false, errors, normalized: null }

  return {
    ok: true,
    errors: [],
    normalized: { ts, task, mistake, evidence, rule, fix, tests, status, confidence, signal },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JSONL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialize one lesson to a single JSONL line (no trailing newline). Never throws.
 * @returns {string|null} null when the lesson is invalid — writing an invalid lesson is how a
 *   ledger quietly becomes untrustworthy, so this refuses rather than doing its best.
 */
export function serializeLesson(lesson) {
  const v = validateLesson(lesson)
  if (!v.ok) return null
  const n = v.normalized
  const ordered = {}
  for (const f of LESSON_FIELDS) ordered[f] = n[f]
  for (const f of LESSON_META_FIELDS) if (n[f] !== null) ordered[f] = n[f]
  try {
    return JSON.stringify(ordered)
  } catch {
    return null
  }
}

/**
 * Parse a lessons JSONL document. Never throws.
 *
 * Every line is accounted for. A line that is not JSON, or is JSON that fails validation, lands
 * in `malformed` with its 1-based line number and the raw text — it is never silently skipped.
 * A lessons file that quietly loses entries is worse than no lessons file: the user believes
 * they have a history they do not have.
 *
 * @returns {{lessons: object[], malformed: Array<{line: number, raw: string, reason: string,
 *   errors: Array<{field:string,message:string}>}>, counts: {total:number, parsed:number,
 *   malformed:number, blank:number}}}
 */
export function parseLessonsJsonl(text) {
  const lessons = []
  const malformed = []
  let blank = 0

  if (!isStr(text)) {
    return {
      lessons,
      malformed: [{ line: 0, raw: '', reason: 'input is not a string', errors: [] }],
      counts: { total: 0, parsed: 0, malformed: 1, blank: 0 },
    }
  }

  const lines = text.split(/\r?\n/)
  lines.forEach((raw, i) => {
    const lineNo = i + 1
    if (raw.trim() === '') {
      blank++
      return
    }
    let obj
    try {
      obj = JSON.parse(raw)
    } catch (e) {
      malformed.push({ line: lineNo, raw, reason: `invalid JSON: ${e && e.message ? e.message : 'parse failed'}`, errors: [] })
      return
    }
    const v = validateLesson(obj)
    if (!v.ok) {
      malformed.push({
        line: lineNo,
        raw,
        reason: `invalid lesson: ${v.errors.map(x => `${x.field}: ${x.message}`).join('; ')}`,
        errors: v.errors,
      })
      return
    }
    lessons.push(v.normalized)
  })

  return {
    lessons,
    malformed,
    counts: { total: lines.length, parsed: lessons.length, malformed: malformed.length, blank },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivation — the valuable half
// ─────────────────────────────────────────────────────────────────────────────

// A user declining a tool call. This is a human making a deliberate decision, and it is the one
// `is_error: true` result that must never become a lesson: "learning" from it would teach the
// assistant to route around its own permission gate. Observed verbatim in this repo's
// transcripts as "The user doesn't want to proceed with this tool use."
const DECLINE_PATTERNS = [
  /user doesn'?t want to proceed/i,
  /tool use was rejected/i,
  /user rejected/i,
  /rejected by (the )?user/i,
  /operation (was )?(cancelled|canceled) by (the )?user/i,
  /\[request interrupted by user/i,
]

// User corrections, split by how unambiguous they are. Strong patterns explicitly reverse the
// previous instruction; weak ones only suggest a course change and score below the default
// confidence floor, so they need an explicit `minConfidence` to surface.
const CORRECTION_STRONG = [
  /\brevert (that|it|this|the)\b/i,
  /\bundo (that|it|this|the)\b/i,
  /\bthat'?s (not|n[o']t) what i (asked|wanted|meant|said)\b/i,
  /\bthat'?s wrong\b/i,
  /\b(that|this|it) is wrong\b/i,
  /\bwrong\b.*\b(again|approach|file|change)\b/i,
  /\bdon'?t do (that|this)\b/i,
  /\bstop doing (that|this)\b/i,
  /\bi (said|told you)\b.*\bnot\b/i,
  /\bput (it|that) back\b/i,
]
const CORRECTION_WEAK = [
  /^\s*no[.,!\s]/i,
  /^\s*nope\b/i,
  /^\s*actually[,\s]/i,
  /\bactually,? (i|we|let'?s|you should)\b/i,
  /\binstead,? (do|use|try)\b/i,
  /\bnot like that\b/i,
]

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'str_replace_editor'])

// Signal catalogue. Exported as data so a UI can render "why did this appear?" next to a
// proposal, and so the thresholds are auditable without reading the implementation.
export const SIGNALS = [
  {
    id: 'retry_after_failure',
    label: 'Failed call retried with a changed approach',
    description:
      'A tool call failed, and a later call to the same tool against the same target — with ' +
      'different input — succeeded. Mistake and fix are both literally in the transcript.',
    threshold: 'retry found within `retryWindow` (default 3) subsequent calls to the same tool, ' +
      'input similarity >= `retrySimilarity` (default 0.4), and the retry must have succeeded.',
    justification:
      'The strongest signal available, because nothing is inferred: the failing input and the ' +
      'working input are both recorded. The window exists because unrelated reads routinely sit ' +
      'between a failure and its retry; the similarity floor stops an unrelated later call to the ' +
      'same tool from being read as a fix. Requiring the retry to succeed is what makes it a fix ' +
      'rather than more of the same failure (which signal `failure_run` covers instead).',
  },
  {
    id: 'edit_thrash',
    label: 'One file edited many times in a session',
    description: 'The same file was edited `thrashThreshold`+ times, suggesting the change was not understood before it was attempted.',
    threshold: '>= `thrashThreshold` edit-tool calls (default 5) resolving to one file path.',
    justification:
      'Threshold taken from the research note (5+). Held there rather than tuned down: 3-4 edits ' +
      'to one file is ordinary iterative work, and a ledger that flags ordinary work gets ignored ' +
      'wholesale. The lesson is deliberately weaker in wording than the retry signal, because ' +
      'thrashing is a symptom whose cause is not in the transcript.',
  },
  {
    id: 'user_correction',
    label: 'User reversed or corrected the previous instruction',
    description: 'A human turn that contradicts what was just done ("no", "wrong", "actually", "revert that").',
    threshold:
      'A human message matching a strong pattern (confidence 0.7) or a weak pattern (0.45, below ' +
      'the default floor), which must not be the first message of the session.',
    justification:
      'A correction is the user stating a rule directly, so the `fix` field can quote them rather ' +
      'than paraphrase. Split into strong/weak because "actually" and a leading "no" appear ' +
      'constantly in ordinary conversation; scoring them below the default floor means they are ' +
      'available to a caller who lowers it, and invisible to one who does not.',
  },
  {
    id: 'failure_run',
    label: 'Consecutive failing tool calls',
    description: 'A run of `failureRunThreshold`+ tool results in a row came back as errors, with no success between.',
    threshold: '>= `failureRunThreshold` (default 3) consecutive `is_error` results, declines excluded.',
    justification:
      'Three is the point where a run stops looking like one bad command and starts looking like a ' +
      'wrong approach being repeated. Declines neither count toward a run nor extend one — they ' +
      'end it, because a human intervening is a different event from a tool failing. `fix` stays ' +
      '"unknown" unless a successful call ends the run, since otherwise the transcript does not ' +
      'say what worked.',
  },
]

export const DEFAULT_DERIVE_OPTS = {
  maxLessons: 20,          // cap on emitted proposals; reported in `limits`, never silent
  minConfidence: 0.5,      // proposals below this are dropped and counted
  thrashThreshold: 5,      // edits to one file before it counts as thrashing
  failureRunThreshold: 3,  // consecutive failures before a run counts
  retryWindow: 3,          // how many later same-tool calls may count as the retry
  retrySimilarity: 0.4,    // Jaccard token overlap between failing and retrying input
  includeSidechains: false,// subagent transcripts are a different session's story by default
}

const clamp01 = n => (n < 0 ? 0 : n > 1 ? 1 : Math.round(n * 100) / 100)
// Per-signal ceiling. Nothing derived here is certain — a real session showed one file edited 24
// times, which an uncapped linear bonus scored at 1.0. A 1.0 on an inferred rule misrepresents
// the method, and thrash is inference (the cause of the thrashing is not in the transcript).
const ceil = (n, max) => clamp01(Math.min(n, max))

// Tokenized down to path/command components, not whole paths: `lib/pricing.js` and
// `lib/pricing.mjs` are the same fix attempted twice, and whole-string tokens would score them
// as unrelated (one shared token out of three) and lose the clearest retry signal there is.
const tokens = s =>
  new Set(
    String(s)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 1)
  )

function jaccard(a, b) {
  const A = tokens(a)
  const B = tokens(b)
  if (A.size === 0 && B.size === 0) return 1
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

function blocksOf(rec) {
  const c = rec && rec.message && rec.message.content
  if (Array.isArray(c)) return c.filter(isObj)
  return []
}

// Text of a user turn: content may be a plain string (real human prompts in this repo's
// transcripts) or an array of text blocks.
function userText(rec) {
  const c = rec && rec.message && rec.message.content
  if (isStr(c)) return c
  if (Array.isArray(c)) {
    return c
      .filter(b => isObj(b) && b.type === 'text' && isStr(b.text))
      .map(b => b.text)
      .join('\n')
  }
  return ''
}

function resultText(block, rec) {
  const c = block && block.content
  if (isStr(c)) return c
  if (Array.isArray(c)) {
    return c
      .filter(b => isObj(b) && isStr(b.text))
      .map(b => b.text)
      .join('\n')
  }
  if (isStr(rec && rec.toolUseResult)) return rec.toolUseResult
  return ''
}

function targetOf(name, input) {
  if (!isObj(input)) return null
  const p = input.file_path || input.filePath || input.notebook_path || input.path
  if (isStr(p) && p.trim()) return p.trim()
  if (isStr(input.command) && input.command.trim()) return `$ ${input.command.trim()}`
  if (isStr(input.pattern) && input.pattern.trim()) return `/${input.pattern.trim()}/`
  return null
}

function inputString(input) {
  if (!isObj(input)) return ''
  try {
    return JSON.stringify(input)
  } catch {
    return ''
  }
}

const snip = (s, n = 160) => {
  const one = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

const evRef = rec => ({
  uuid: isStr(rec && rec.uuid) && rec.uuid ? rec.uuid : null,
  ts: isIsoish(rec && rec.timestamp) ? rec.timestamp : null,
})

/**
 * Propose lessons from transcript records. Never throws. Pure.
 *
 * Every proposal is `status: 'proposed'` and carries `evidence` naming the records that produced
 * it; candidates that end up with no resolvable evidence are dropped and counted, never emitted.
 *
 * Confidence: each signal has a floor reflecting how much of the claim is observed versus
 * inferred (retry 0.6, correction 0.7 strong / 0.45 weak, failure run 0.55, thrash 0.5), plus
 * small bonuses for corroborating detail — an identical target, an immediate retry, more repeats
 * than the threshold. Ceilings sit at 0.9 or below: nothing here is certain, and a 1.0 on a
 * derived instruction would be a lie about the method.
 *
 * @param {object[]} records Transcript records (JSONL objects), in file order.
 * @param {object} [opts] See DEFAULT_DERIVE_OPTS. Unknown keys ignored.
 * @returns {{lessons: object[], stats: object, limits: object}}
 */
export function deriveLessons(records, opts) {
  const o = { ...DEFAULT_DERIVE_OPTS, ...(isObj(opts) ? opts : {}) }
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  o.maxLessons = Math.max(0, Math.floor(num(o.maxLessons, DEFAULT_DERIVE_OPTS.maxLessons)))
  o.minConfidence = num(o.minConfidence, DEFAULT_DERIVE_OPTS.minConfidence)
  o.thrashThreshold = Math.max(2, Math.floor(num(o.thrashThreshold, DEFAULT_DERIVE_OPTS.thrashThreshold)))
  o.failureRunThreshold = Math.max(2, Math.floor(num(o.failureRunThreshold, DEFAULT_DERIVE_OPTS.failureRunThreshold)))
  o.retryWindow = Math.max(1, Math.floor(num(o.retryWindow, DEFAULT_DERIVE_OPTS.retryWindow)))
  o.retrySimilarity = num(o.retrySimilarity, DEFAULT_DERIVE_OPTS.retrySimilarity)

  const stats = {
    records: Array.isArray(records) ? records.length : 0,
    considered: 0,
    skippedNonRecord: 0,
    skippedSidechain: 0,
    toolCalls: 0,
    toolResults: 0,
    failures: 0,
    declines: 0,
    candidates: 0,
    dropped: { ungrounded: 0, lowConfidence: 0, invalid: 0, duplicate: 0, overCap: 0 },
  }
  const limits = {
    maxLessons: o.maxLessons,
    capApplied: false,
    minConfidence: o.minConfidence,
    thresholds: {
      thrashThreshold: o.thrashThreshold,
      failureRunThreshold: o.failureRunThreshold,
      retryWindow: o.retryWindow,
      retrySimilarity: o.retrySimilarity,
    },
    includeSidechains: !!o.includeSidechains,
  }

  if (!Array.isArray(records)) {
    return { lessons: [], stats, limits }
  }

  // ── Pass 1: index the transcript ───────────────────────────────────────────
  const recs = []
  for (const r of records) {
    if (!isObj(r)) {
      stats.skippedNonRecord++
      continue
    }
    if (r.isSidechain === true && !o.includeSidechains) {
      stats.skippedSidechain++
      continue
    }
    recs.push(r)
  }
  stats.considered = recs.length

  const calls = []          // tool_use blocks in order
  const callById = new Map()
  const resultsById = new Map()
  const humanTurns = []     // {rec, index, text}

  recs.forEach((rec, index) => {
    const blocks = blocksOf(rec)
    let sawToolResult = false
    for (const b of blocks) {
      if (b.type === 'tool_use') {
        stats.toolCalls++
        const call = {
          id: isStr(b.id) ? b.id : null,
          name: isStr(b.name) ? b.name : 'unknown',
          input: isObj(b.input) ? b.input : {},
          rec,
          index,
          order: calls.length,
        }
        call.target = targetOf(call.name, call.input)
        calls.push(call)
        if (call.id) callById.set(call.id, call)
      } else if (b.type === 'tool_result') {
        sawToolResult = true
        stats.toolResults++
        const text = resultText(b, rec)
        const declined = DECLINE_PATTERNS.some(p => p.test(text))
        const failed = b.is_error === true && !declined
        if (declined) stats.declines++
        if (failed) stats.failures++
        const entry = { id: isStr(b.tool_use_id) ? b.tool_use_id : null, rec, index, text, declined, failed, isError: b.is_error === true }
        if (entry.id) resultsById.set(entry.id, entry)
      }
    }
    // A human turn: type 'user' with no tool_result block (tool results are also type 'user').
    if (rec.type === 'user' && !sawToolResult) {
      const text = userText(rec)
      if (text.trim()) humanTurns.push({ rec, index, text })
    }
  })

  for (const c of calls) c.result = c.id ? resultsById.get(c.id) || null : null

  const taskHint = (() => {
    const first = humanTurns[0]
    return first ? snip(first.text, 120) : 'unknown'
  })()

  const candidates = []
  const push = c => {
    stats.candidates++
    candidates.push(c)
  }

  // ── Signal A: a failed call retried with a changed approach ────────────────
  calls.forEach((call, i) => {
    if (!call.result || !call.result.failed) return
    let searched = 0
    for (let j = i + 1; j < calls.length && searched < o.retryWindow; j++) {
      const next = calls[j]
      if (next.name !== call.name) continue
      searched++
      const sameInput = inputString(next.input) === inputString(call.input)
      if (sameInput) continue // an identical rerun is not a changed approach
      const sim = jaccard(inputString(call.input), inputString(next.input))
      const sameTarget = call.target !== null && next.target === call.target
      if (!sameTarget && sim < o.retrySimilarity) continue
      if (!next.result || next.result.failed || next.result.declined || next.result.isError) continue

      let confidence = 0.6
      if (sameTarget) confidence += 0.15
      if (searched === 1 && j === i + 1) confidence += 0.1
      if (sim >= 0.7) confidence += 0.05

      const cmd = isStr(next.input && next.input.command) ? next.input.command : ''
      const tests = /\b(npm (run )?test|node --test|pytest|vitest|jest)\b/.test(cmd) ? [cmd.trim()] : []

      push({
        signal: 'retry_after_failure',
        confidence: clamp01(confidence),
        ts: (call.result.rec && call.result.rec.timestamp) || call.rec.timestamp,
        task: taskHint,
        mistake:
          `${call.name} failed on ${call.target || 'an unrecorded target'}: ${snip(call.result.text, 140)}`,
        rule:
          `Before calling ${call.name} on ${call.target || 'this target'}, account for the failure ` +
          `"${snip(call.result.text, 80)}" — the same call succeeded only after its input changed.`,
        fix: `Retried ${next.name} with changed input (${snip(inputString(next.input), 140)}) and it succeeded.`,
        tests,
        evidence: [
          { ...evRef(call.rec), note: `failing ${call.name} call` },
          { ...evRef(call.result.rec), note: 'error result' },
          { ...evRef(next.rec), note: `succeeding ${next.name} retry` },
        ],
        key: `retry:${call.rec.uuid || call.order}:${next.rec.uuid || next.order}`,
      })
      break // one lesson per failure; the first working retry is the fix
    }
  })

  // ── Signal B: edit thrashing ───────────────────────────────────────────────
  const byFile = new Map()
  for (const call of calls) {
    if (!EDIT_TOOLS.has(call.name)) continue
    const f = isStr(call.input.file_path || call.input.filePath || call.input.notebook_path)
      ? (call.input.file_path || call.input.filePath || call.input.notebook_path).trim()
      : null
    if (!f) continue
    if (!byFile.has(f)) byFile.set(f, [])
    byFile.get(f).push(call)
  }
  for (const [file, group] of byFile) {
    if (group.length < o.thrashThreshold) continue
    const over = group.length - o.thrashThreshold
    const last = group[group.length - 1]
    push({
      signal: 'edit_thrash',
      confidence: ceil(0.5 + 0.05 * over, 0.85),
      ts: last.rec.timestamp,
      task: taskHint,
      mistake: `${file} was edited ${group.length} times in one session (threshold ${o.thrashThreshold}).`,
      rule:
        `Read ${file} in full and settle the intended end state before editing it; ${group.length} ` +
        `edits in one session is a sign the change was attempted before it was understood.`,
      fix: 'unknown',
      tests: [],
      evidence: group.map((c, i) => ({ ...evRef(c.rec), note: `edit ${i + 1} of ${group.length}` })),
      key: `thrash:${file}`,
    })
  }

  // ── Signal C: user correction ──────────────────────────────────────────────
  humanTurns.forEach((turn, i) => {
    if (turn.index === 0 || i === 0) return // nothing has happened yet to correct
    const text = turn.text
    const strong = CORRECTION_STRONG.find(p => p.test(text))
    const weak = strong ? null : CORRECTION_WEAK.find(p => p.test(text))
    if (!strong && !weak) return
    const prior = humanTurns[i - 1]
    const evidence = [{ ...evRef(turn.rec), note: 'corrective user message' }]
    if (prior) evidence.push({ ...evRef(prior.rec), note: 'instruction being corrected' })
    push({
      signal: 'user_correction',
      confidence: strong ? 0.7 : 0.45,
      ts: turn.rec.timestamp,
      task: prior ? snip(prior.text, 120) : taskHint,
      mistake: `The user reversed the preceding work: "${snip(text, 160)}"`,
      rule:
        `Confirm the intended change against the user's stated constraint before acting; this turn ` +
        `had to be corrected with "${snip(text, 100)}".`,
      fix: snip(text, 200),
      tests: [],
      evidence,
      key: `correction:${turn.rec.uuid || turn.index}`,
    })
  })

  // ── Signal D: consecutive failing tool calls ───────────────────────────────
  let run = []
  const flushRun = endedBy => {
    if (run.length >= o.failureRunThreshold) {
      const names = [...new Set(run.map(c => c.name))]
      const over = run.length - o.failureRunThreshold
      push({
        signal: 'failure_run',
        confidence: ceil(0.55 + 0.05 * over, 0.8),
        ts: (run[run.length - 1].result.rec && run[run.length - 1].result.rec.timestamp) || run[run.length - 1].rec.timestamp,
        task: taskHint,
        mistake:
          `${run.length} tool calls failed in a row (${names.join(', ')}). Last error: ` +
          `${snip(run[run.length - 1].result.text, 140)}`,
        rule:
          `After ${o.failureRunThreshold} consecutive tool failures, stop and re-check the ` +
          `assumption behind the approach instead of reissuing variations of it.`,
        fix: endedBy
          ? `The run ended when ${endedBy.name} succeeded (${snip(inputString(endedBy.input), 120)}).`
          : 'unknown',
        tests: [],
        evidence: run.map((c, i) => ({ ...evRef(c.rec), note: `failure ${i + 1} of ${run.length}: ${snip(c.result.text, 80)}` })),
        key: `run:${run[0].rec.uuid || run[0].order}:${run.length}`,
      })
    }
    run = []
  }
  for (const call of calls) {
    const res = call.result
    if (!res) continue // no observed verdict — neither a failure nor a success
    if (res.declined) {
      // A human declining is not a failure and does not belong in a failure run.
      flushRun(null)
      continue
    }
    if (res.failed) run.push(call)
    else flushRun(call)
  }
  flushRun(null)

  // ── Assemble: ground, score, validate, cap ────────────────────────────────
  const seen = new Set()
  const kept = []
  for (const c of candidates) {
    const evidence = c.evidence.filter(e => e && (e.uuid || isIsoish(e.ts)))
    if (evidence.length === 0) {
      // The hard rule. A candidate whose records carried neither uuid nor timestamp cannot be
      // checked by the user, so it is not a lesson.
      stats.dropped.ungrounded++
      continue
    }
    if (c.confidence < o.minConfidence) {
      stats.dropped.lowConfidence++
      continue
    }
    if (seen.has(c.key)) {
      stats.dropped.duplicate++
      continue
    }
    seen.add(c.key)

    const v = validateLesson({
      ts: isIsoish(c.ts) ? c.ts : 'unknown',
      task: c.task,
      mistake: c.mistake,
      evidence,
      rule: c.rule,
      fix: c.fix,
      tests: c.tests,
      status: 'proposed',
      confidence: c.confidence,
      signal: c.signal,
    })
    if (!v.ok) {
      stats.dropped.invalid++
      continue
    }
    kept.push(v.normalized)
  }

  kept.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence
    const at = a.ts === 'unknown' ? Infinity : Date.parse(a.ts)
    const bt = b.ts === 'unknown' ? Infinity : Date.parse(b.ts)
    return at - bt
  })

  let lessons = kept
  if (kept.length > o.maxLessons) {
    lessons = kept.slice(0, o.maxLessons)
    stats.dropped.overCap = kept.length - o.maxLessons
    limits.capApplied = true
  }

  return { lessons, stats, limits }
}
