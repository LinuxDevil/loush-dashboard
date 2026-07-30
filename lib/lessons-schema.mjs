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

export const LESSON_FIELDS = ['ts', 'task', 'mistake', 'evidence', 'rule', 'fix', 'tests', 'status']
export const LESSON_META_FIELDS = ['confidence', 'signal']

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = v => typeof v === 'string'
const trimmed = v => (isStr(v) ? v.trim() : '')

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

  let ts
  if (obj.ts === 'unknown') ts = 'unknown'
  else if (isIsoish(obj.ts)) ts = obj.ts
  else {
    ts = 'unknown'
    err('ts', 'ts must be an ISO-8601 timestamp or the string "unknown"')
  }

  const task = trimmed(obj.task) || 'unknown'

  const mistake = trimmed(obj.mistake)
  if (!mistake) err('mistake', 'mistake is required and must be a non-empty string')
  const rule = trimmed(obj.rule)
  if (!rule) err('rule', 'rule is required and must be a non-empty string')
  const fix = trimmed(obj.fix)
  if (!fix) err('fix', 'fix is required and must be a non-empty string (use "unknown" if not observed)')

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

  let tests = []
  if (obj.tests === undefined || obj.tests === null) tests = []
  else if (Array.isArray(obj.tests)) tests = obj.tests.map(t => trimmed(t)).filter(Boolean)
  else err('tests', 'tests must be an array of strings when present')

  let status = trimmed(obj.status)
  if (!status) {
    status = 'proposed'
  } else if (!LESSON_STATUS_IDS.includes(status)) {
    err('status', `status must be one of: ${LESSON_STATUS_IDS.join(', ')}`)
    status = 'proposed'
  }

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

export { isObj, isStr, isIsoish }
