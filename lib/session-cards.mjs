// lib/session-cards.mjs — sessions rendered as kanban cards, joined to the files each session
// touched, with links that work in BOTH directions (session → files, file → sessions).
//
// THE JOIN IS THE POINT
// /api/sessions answers "what did this session cost"; scanTranscripts() answers "what did it touch".
// Neither alone answers the question a person actually has in front of a board — "what was being
// worked on, and where in the repo did it land" — and the click a person wants next ("who else has
// been in this file?") needs the reverse index, which nothing builds today.
//
// THE HONESTY PROBLEM THIS FILE EXISTS TO AVOID
// Two different facts both look like an empty array:
//   (a) we parsed this session's transcript and it edited nothing — a real, interesting state
//       ("40 minutes, $1.90, zero files touched" is a finding),
//   (b) we have NO file-activity record for this session at all — the transcript wasn't scanned,
//       fell outside the scan window, or the scan errored.
// Rendering both as "0 files changed" states a measurement that was never taken. So `fileCount` is
// null for (b), `activity` names which case it is, and `reason` says why in words a person can read.
// Nothing is dropped from the board for lacking file activity either: a card missing from a board is
// indistinguishable from work that never happened.
//
// PURE: no fs, no fetch, no React. Callers pass the two datasets in.

export const CARD_LIMITS = {
  files: 25,        // files listed per card
  sessions: 20,     // sessions listed per file in the reverse index
  cards: 500,       // cards built in one pass
  pathLabel: 80,    // display-truncation length for a path label
}

// Activity kinds — exported so the UI switches on a constant instead of re-deriving the rule.
export const ACTIVITY = {
  RECORDED: 'recorded',        // we scanned it and it touched >= 1 file
  RECORDED_EMPTY: 'none',      // we scanned it and it touched 0 files — a measurement, not a gap
  UNRECORDED: 'unrecorded',    // we have no file-activity record for this session — NOT the same as 0
}

// Freshness columns. A board needs columns; the honest ones for sessions are about recency of the
// last turn, since that is the only lifecycle signal a transcript actually carries.
export const COLUMNS = [
  { id: 'active', label: 'Active', maxAgeMs: 15 * 60_000, hint: 'last turn under 15 minutes ago' },
  { id: 'today', label: 'Today', maxAgeMs: 24 * 3_600_000, hint: 'last turn within a day' },
  { id: 'week', label: 'This week', maxAgeMs: 7 * 24 * 3_600_000, hint: 'last turn within 7 days' },
  { id: 'older', label: 'Older', maxAgeMs: Infinity, hint: 'last turn more than 7 days ago' },
  { id: 'unknown', label: 'No timestamp', maxAgeMs: null, hint: 'no usable last-activity timestamp on this session' },
]
export const COLUMN_IDS = COLUMNS.map(c => c.id)

/**
 * Which column a session belongs in. A session with no usable timestamp goes to its OWN column with
 * a stated reason — bucketing it as "older" would invent an age, and bucketing it as "active" would
 * put unmeasured work at the top of the board.
 */
export function columnFor(lastAt, now = Date.now()) {
  if (!Number.isFinite(lastAt) || lastAt <= 0)
    return { column: 'unknown', ageMs: null, reason: 'this session has no usable last-activity timestamp — it is NOT being aged, and its position on the board says nothing about recency' }
  const ageMs = Math.max(0, now - lastAt)
  for (const c of COLUMNS) {
    if (c.maxAgeMs === null) continue
    if (ageMs <= c.maxAgeMs) return { column: c.id, ageMs, reason: null }
  }
  return { column: 'older', ageMs, reason: null }
}

// ---------------------------------------------------------------------------
// input normalisation — malformed rows are reported, never thrown on
// ---------------------------------------------------------------------------

/**
 * File activity may arrive as a map {sessionId: [paths]} or as rows [{sessionId, files}] (that is the
 * shape scanTranscripts() produces). Both are accepted; anything else is reported and treated as
 * "no activity recorded", which is exactly the (b) case above and renders as such.
 */
function indexActivity(fileActivity) {
  const map = new Map()
  const problems = []
  if (fileActivity == null) return { map, problems: [{ what: 'fileActivity', reason: 'no file-activity dataset was supplied — every card will report activity: unrecorded rather than "0 files"' }] }
  const rows = Array.isArray(fileActivity)
    ? fileActivity
    : typeof fileActivity === 'object'
      ? Object.entries(fileActivity).map(([sessionId, files]) => ({ sessionId, files }))
      : null
  if (!rows) return { map, problems: [{ what: 'fileActivity', reason: `file-activity dataset was ${typeof fileActivity}, expected array or object — treated as absent, so cards report "unrecorded" instead of a fabricated 0` }] }
  for (const r of rows) {
    if (!r || typeof r !== 'object' || typeof r.sessionId !== 'string' || !r.sessionId) { problems.push({ what: 'fileActivityRow', reason: 'row without a usable sessionId was skipped' }); continue }
    const files = Array.isArray(r.files) ? r.files.filter(f => typeof f === 'string' && f) : null
    if (r.files != null && !Array.isArray(r.files)) problems.push({ what: 'fileActivityRow', sessionId: r.sessionId, reason: `files was ${typeof r.files}, expected array — recorded as unrecorded rather than empty` })
    // A row that exists WITH an empty array is case (a): scanned, touched nothing. Keep the
    // distinction all the way through — this is the whole reason the map holds null vs [].
    map.set(r.sessionId, files)
  }
  return { map, problems }
}

/** A number, or null. Only real finite numbers pass — see the cost comment at the call site. */
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const relOf = (abs, cwd) => {
  if (typeof abs !== 'string' || !abs) return null
  if (typeof cwd === 'string' && cwd && abs.startsWith(cwd)) {
    const r = abs.slice(cwd.length).replace(/^[/\\]+/, '')
    return r || abs
  }
  return abs
}

// ---------------------------------------------------------------------------
// cards
// ---------------------------------------------------------------------------

/**
 * @param {Array}  sessions      rows shaped like GET /api/sessions -> sessions[]
 * @param {object|Array} fileActivity  {sessionId: [absPaths]} or [{sessionId, files}]
 * @param {object} [opts] {now, filesCap, cardsCap}
 * @returns {{cards, fileIndex, totals, caps, problems}}
 */
export function buildSessionCards(sessions, fileActivity, opts = {}) {
  const now = opts.now ?? Date.now()
  const filesCap = Number.isInteger(opts.filesCap) && opts.filesCap > 0 ? opts.filesCap : CARD_LIMITS.files
  const cardsCap = Number.isInteger(opts.cardsCap) && opts.cardsCap > 0 ? opts.cardsCap : CARD_LIMITS.cards
  const problems = []

  const list = Array.isArray(sessions) ? sessions : []
  if (sessions != null && !Array.isArray(sessions)) problems.push({ what: 'sessions', reason: `sessions was ${typeof sessions}, expected array — produced an empty board rather than guessing` })

  const { map: activity, problems: actProblems } = indexActivity(fileActivity)
  problems.push(...actProblems)

  const usable = []
  for (const s of list) {
    if (!s || typeof s !== 'object' || typeof s.sessionId !== 'string' || !s.sessionId) { problems.push({ what: 'session', reason: 'session row without a usable sessionId was skipped — it could not be linked to files or resumed' }); continue }
    usable.push(s)
  }
  usable.sort((a, b) => (Number(b.last) || 0) - (Number(a.last) || 0))

  // Cap, and REPORT it. A board silently showing the newest 500 of 900 sessions makes "sessions this
  // week" wrong by 400 with nothing on screen admitting it.
  const cardsCapped = usable.length > cardsCap
    ? { cap: cardsCap, total: usable.length, hidden: usable.length - cardsCap, reason: `showing the ${cardsCap} most recent sessions of ${usable.length}; ${usable.length - cardsCap} older session(s) are NOT on this board` }
    : null
  const kept = cardsCapped ? usable.slice(0, cardsCap) : usable

  const cards = []
  const fileIndex = new Map() // relPath -> {file, sessions:[], total}

  for (const s of kept) {
    const last = num(s.last)   // null, never a coerced 0 — 0 would read as "epoch", an age of 55 years
    const col = columnFor(last ?? NaN, now)
    const raw = activity.has(s.sessionId) ? activity.get(s.sessionId) : undefined

    let files = [], fileCount = null, act = ACTIVITY.UNRECORDED, reason = null, filesCapped = null
    if (raw === undefined || raw === null) {
      act = ACTIVITY.UNRECORDED
      reason = 'no file-activity record exists for this session — this is NOT "0 files changed", it is "we did not measure". The session is on the board because a missing card is indistinguishable from work that never happened.'
    } else {
      const rels = [...new Set(raw.map(f => relOf(f, s.cwd)).filter(Boolean))].sort()
      fileCount = rels.length
      if (rels.length === 0) {
        act = ACTIVITY.RECORDED_EMPTY
        reason = 'this session was scanned and touched no files — a measured zero, not a missing measurement'
      } else {
        act = ACTIVITY.RECORDED
        files = rels.slice(0, filesCap)
        if (rels.length > filesCap)
          filesCapped = { cap: filesCap, total: rels.length, hidden: rels.length - filesCap, reason: `listing ${filesCap} of ${rels.length} files touched — ${rels.length - filesCap} more are not shown on this card (fileCount is the true total)` }
        // Reverse index is built from the FULL list, not the capped one: "which sessions touched this
        // file" must not depend on where a file happened to sort on some other card.
        for (const rel of rels) {
          let e = fileIndex.get(rel)
          if (!e) { e = { file: rel, sessions: [], total: 0, capped: null }; fileIndex.set(rel, e) }
          e.total++
          if (e.sessions.length < CARD_LIMITS.sessions) e.sessions.push({ sessionId: s.sessionId, project: s.project ?? null, last, branch: s.branch ?? null })
        }
      }
    }

    cards.push({
      sessionId: s.sessionId,
      project: typeof s.project === 'string' && s.project ? s.project : null,
      // Unknown is a value: no cwd means no resume command and no path-relativisation, and the card
      // says so instead of showing a `claude --resume` line that lands in the wrong directory.
      cwd: typeof s.cwd === 'string' && s.cwd ? s.cwd : null,
      cwdReason: typeof s.cwd === 'string' && s.cwd ? null : 'no working directory recorded for this session — file paths are shown absolute and there is no reliable resume command',
      branch: typeof s.branch === 'string' && s.branch ? s.branch : null,
      column: col.column,
      lastAt: last,
      ageMs: col.ageMs,
      columnReason: col.reason,
      // `Number(null)` is 0 and `Number('')` is 0 — coercing here would turn "this session's cost was
      // never recorded" into "$0.00 spent", which sums into every total as a confident zero.
      cost: num(s.cost),
      durationMs: num(s.durationMs),
      toolCalls: num(s.toolCalls),
      errors: num(s.errors),
      activity: act,
      files,
      fileCount,            // null when unmeasured — never coerce this to 0 for display
      filesCapped,
      reason,
      transcript: typeof s.transcript === 'string' ? s.transcript : null,
    })
  }

  for (const e of fileIndex.values()) {
    if (e.total > e.sessions.length)
      e.capped = { cap: CARD_LIMITS.sessions, total: e.total, hidden: e.total - e.sessions.length, reason: `${e.total} sessions touched this file; the ${CARD_LIMITS.sessions} most recent are listed` }
  }

  const measured = cards.filter(c => c.activity !== ACTIVITY.UNRECORDED)
  const totals = {
    cards: cards.length,
    unrecorded: cards.filter(c => c.activity === ACTIVITY.UNRECORDED).length,
    recordedEmpty: cards.filter(c => c.activity === ACTIVITY.RECORDED_EMPTY).length,
    // Only measured cards contribute. Summing `fileCount ?? 0` would fold "we did not look" into the
    // same total as "we looked and found nothing", which is the exact lie this module is built to avoid.
    filesTouched: measured.reduce((n, c) => n + (c.fileCount || 0), 0),
    filesTouchedBasis: `summed over ${measured.length} of ${cards.length} card(s) that have file activity recorded; ${cards.length - measured.length} card(s) are excluded because nothing was measured for them`,
    uniqueFiles: fileIndex.size,
    byColumn: Object.fromEntries(COLUMN_IDS.map(id => [id, cards.filter(c => c.column === id).length])),
  }

  return {
    cards,
    fileIndex: [...fileIndex.values()].sort((a, b) => b.total - a.total || a.file.localeCompare(b.file)),
    totals,
    caps: { cards: cardsCapped, filesPerCard: filesCap, sessionsPerFile: CARD_LIMITS.sessions },
    problems,
  }
}

// ---------------------------------------------------------------------------
// data-source adapter — the two datasets are INJECTED as functions. This module therefore never
// imports a server module, never reads a transcript, and every failure mode of the sources (missing,
// throwing, returning junk) is reachable from a unit test.
// ---------------------------------------------------------------------------

/**
 * @param {object} io
 * @param {(q) => Array|Promise<Array>} io.readSessions       rows shaped like GET /api/sessions -> sessions[]
 * @param {(q) => object|Array|Promise} [io.readFileActivity] {sessionId: [absPaths]} or [{sessionId, files}].
 *        OMIT IT — do not supply a stub returning {} — when file activity is genuinely unavailable:
 *        an empty map asserts "every session touched nothing", which is the exact fabrication this
 *        module exists to prevent. Absent means every card reports `unrecorded`, which is true.
 * @returns {{build: (query, opts) => Promise<result>}}
 *
 * A source that throws does NOT take the board down: sessions failing gives an empty board WITH the
 * reason attached (never a silent empty state), and file activity failing degrades every card to
 * "unrecorded" — which is exactly what is then true.
 */
export function createSessionCardSource(io = {}) {
  return {
    async build(query = {}, opts = {}) {
      const problems = []
      let sessions = []
      if (typeof io.readSessions !== 'function') {
        problems.push({ what: 'readSessions', reason: 'no readSessions() was injected — the board is empty because nothing was asked for, NOT because there are no sessions' })
      } else {
        try { sessions = await io.readSessions(query) } catch (e) {
          problems.push({ what: 'readSessions', reason: `the session source failed (${e?.message || e}) — this board is EMPTY BECAUSE THE READ FAILED, not because no sessions exist` })
          sessions = []
        }
      }
      let activity = null
      if (typeof io.readFileActivity === 'function') {
        try { activity = await io.readFileActivity(query) } catch (e) {
          // null, not {} — see the doc note above. {} would claim every session touched nothing.
          activity = null
          problems.push({ what: 'readFileActivity', reason: `the file-activity source failed (${e?.message || e}) — every card reports "unrecorded" rather than a fabricated 0 files` })
        }
      } else {
        problems.push({ what: 'readFileActivity', reason: 'no readFileActivity() was injected — cards report "file activity not recorded", which is accurate, not "0 files touched", which would not be' })
      }
      const built = buildSessionCards(sessions, activity, opts)
      return { ...built, problems: [...problems, ...built.problems], sourcesOk: { sessions: typeof io.readSessions === 'function' && !problems.some(p => p.what === 'readSessions'), fileActivity: activity != null } }
    },
  }
}

/** Sessions that touched a given file (exact repo-relative path). Reverse half of the link. */
export function sessionsForFile(built, file) {
  const idx = Array.isArray(built?.fileIndex) ? built.fileIndex : []
  const hit = idx.find(e => e.file === file)
  if (!hit) return { file, sessions: [], total: 0, capped: null, reason: `no recorded session touched "${file}" — note that sessions with unrecorded file activity (${built?.totals?.unrecorded ?? 'unknown'} of them) cannot appear in this answer` }
  return { ...hit, reason: null }
}

// ---------------------------------------------------------------------------
// search / filter — a pure function over built cards
// ---------------------------------------------------------------------------

/**
 * Filter cards. Every predicate is optional; an unrecognised column or activity value is REJECTED by
 * name rather than ignored, because a filter that silently does nothing returns the whole board
 * under a heading that claims it is filtered.
 *
 * A file filter can only see the files a card actually lists, and cards carry the CAPPED list. So a
 * card whose match could only lie beyond its cap is reported in `uncertain` rather than counted as a
 * clean non-match — "not found" and "not looked at" are different answers.
 */
export function searchCards(cards, query = {}, opts = {}) {
  const list = Array.isArray(cards) ? cards : Array.isArray(cards?.cards) ? cards.cards : []
  const problems = []
  if (cards != null && !Array.isArray(cards) && !Array.isArray(cards?.cards))
    problems.push({ what: 'cards', reason: `expected an array of cards or a build result, got ${typeof cards} — searched nothing` })
  const q = query && typeof query === 'object' && !Array.isArray(query) ? query : {}
  if (query != null && (typeof query !== 'object' || Array.isArray(query)))
    problems.push({ what: 'query', reason: 'query must be an object — no filter was applied, so this result is the UNFILTERED board' })

  if (q.column !== undefined && q.column !== null && !COLUMN_IDS.includes(q.column))
    return { ok: false, error: 'unknown_column', reason: `"${String(q.column).slice(0, 40)}" is not a board column`, allowed: COLUMN_IDS, matched: [], total: 0, problems }
  const activities = Object.values(ACTIVITY)
  if (q.activity !== undefined && q.activity !== null && !activities.includes(q.activity))
    return { ok: false, error: 'unknown_activity', reason: `"${String(q.activity).slice(0, 40)}" is not a file-activity state`, allowed: activities, matched: [], total: 0, problems }

  const text = typeof q.text === 'string' ? q.text.trim().toLowerCase() : ''
  const file = typeof q.file === 'string' ? q.file.trim().toLowerCase() : ''
  const applied = {}
  const uncertain = []

  const matched = list.filter(c => {
    if (q.column && c.column !== q.column) return false
    if (q.activity && c.activity !== q.activity) return false
    if (typeof q.project === 'string' && q.project && c.project !== q.project) return false
    if (file) {
      const hit = (c.files || []).some(f => f.toLowerCase().includes(file))
      if (!hit) {
        // Truthfulness about the cap: this card MIGHT match in the files we did not list, and we say
        // so rather than reporting a clean "no".
        if (c.filesCapped) uncertain.push({ sessionId: c.sessionId, reason: `only ${c.filesCapped.cap} of ${c.filesCapped.total} files are listed on this card, so a match among the ${c.filesCapped.hidden} unlisted file(s) cannot be ruled out` })
        else if (c.activity === ACTIVITY.UNRECORDED) uncertain.push({ sessionId: c.sessionId, reason: 'no file activity was recorded for this session, so it can neither match nor be excluded by a file filter' })
        return false
      }
    }
    if (text) {
      const hay = `${c.sessionId} ${c.project || ''} ${c.branch || ''} ${c.cwd || ''} ${(c.files || []).join(' ')}`.toLowerCase()
      if (!hay.includes(text)) return false
    }
    return true
  })
  if (q.column) applied.column = q.column
  if (q.activity) applied.activity = q.activity
  if (typeof q.project === 'string' && q.project) applied.project = q.project
  if (file) applied.file = q.file.trim()
  if (text) applied.text = q.text.trim()

  return {
    ok: true, error: null,
    matched,
    total: matched.length,
    searched: list.length,
    filters: applied,
    // The board must be able to say what it is showing. "12 of 340 sessions, filtered by file X"
    // is a headline; "12 sessions" under an unstated filter is a wrong number.
    describe: Object.keys(applied).length
      ? `${matched.length} of ${list.length} session card(s), filtered by ${Object.entries(applied).map(([k, v]) => `${k}=${v}`).join(' · ')}`
      : `all ${matched.length} session card(s) — no filter applied`,
    uncertain,   // cards that could not be honestly excluded; render as "maybe" not as absent
    problems,
  }
}
