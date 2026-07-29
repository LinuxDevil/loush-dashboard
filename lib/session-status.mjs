// Live "Now" board — classification layer for sessions that are (or recently were) running.
//
// Pure and dependency-free on purpose: every function takes `now` as an argument and touches no
// clock, no filesystem and no network, so the timing rules below are testable at any instant
// rather than only when a transcript happens to be fresh.
//
// The rule this whole file is written around: a status is a claim about a session, and we only
// make claims the data supports. Where the input is silent we return `unknown` — never the
// most plausible-looking of the real states. The upstream implementation this is modelled on
// (Stargx's `deriveStatus`) renders a session with no timestamp as `idle`, which reads on screen
// as "we looked and nothing is happening" when the truth is "we never saw a timestamp at all".

// ---------------------------------------------------------------------------------------------
// Thresholds. Every one of these is a judgement call about how long a signal stays true for, so
// each is named, exported and justified rather than inlined as a magic number at a comparison.
// ---------------------------------------------------------------------------------------------

// How long after the last event we are still willing to assert "Claude is working right now".
// A running turn emits something — a tool_use, a tool result, a progress record, a streamed
// assistant chunk — every few seconds; 15s is wide enough to ride through one slow tool call
// without the card flickering, and short enough that a turn which really has ended stops
// claiming to be alive within one or two poll intervals of a ~2s board.
export const ACTIVE_MS = 15_000

// How long a *blocked* state (waiting on a human, or errored and awaiting a decision) keeps
// asserting itself. Unlike `thinking`, this is not a claim that something is happening — it is
// a claim that the session stopped and left the next move to a person, which stays true while
// that person reads, thinks and types. 15 minutes is the point past which "waiting for you"
// stops being actionable and becomes archaeology; after it, recency alone is all we assert.
export const BLOCKED_HOLD_MS = 15 * 60_000

// A timestamp slightly in the future is normal: writer and reader clocks disagree, and some
// records are stamped at the start of an operation. Up to 2s ahead we treat as "now"; further
// ahead than that we do not pretend to know what the elapsed time is.
export const CLOCK_SKEW_MS = 2_000

// How many trailing log entries are inspected for an error marker. The last event type alone
// misses the common shape where a failed tool result is followed immediately by the assistant
// turn that reports it, so we look back a short distance. Three is upstream's number and it is
// a reasonable one: far enough to survive that pairing, short enough that an error the agent
// already recovered from does not keep colouring the card red.
export const ERROR_LOOKBACK = 3

export const STATUSES = ['thinking', 'waiting', 'idle', 'error', 'unknown']

// ---------------------------------------------------------------------------------------------
// Local midnight
// ---------------------------------------------------------------------------------------------

// `new Date(t).toISOString().slice(0, 10)` is a UTC calendar day. For anyone not on UTC it names
// the wrong day for part of every day — east of UTC in the early morning, west of UTC in the
// late evening — which silently shifts "since midnight" boundaries by up to a full day. This
// repo already carries that bug in several places (see lib/harness-usage-trends.mjs and
// server/index.mjs); this file does not add another. setHours(0,0,0,0) resolves against the
// host's own zone, including its DST rules for the day in question.
export const localMidnight = now => {
  const d = new Date(now)
  if (Number.isNaN(d.getTime())) return null
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// ---------------------------------------------------------------------------------------------
// Signal extraction
// ---------------------------------------------------------------------------------------------

const asArray = v => (Array.isArray(v) ? v : v == null ? [] : [v])

const hasErrorMarker = session => {
  if (session.lastEventType === 'error') return true
  if (session.isError === true) return true
  // Only the tail is inspected — see ERROR_LOOKBACK. Entries are read defensively because the
  // log is a ring buffer of loosely-typed records, not a schema we control.
  const log = Array.isArray(session.recentLog) ? session.recentLog : []
  return log.slice(-ERROR_LOOKBACK).some(e => e && (e.type === 'error' || e.isError === true))
}

// Reduces the raw event fields to one of three claims, or null when the record says nothing
// about what the session was doing. Kept separate from deriveStatus so the "what did it last
// do" question and the "how long ago" question stay independently testable.
//
//   'working' — the last thing recorded was the agent acting: a tool call, a thinking block, a
//               progress record, or a user turn that has been handed to the model. Combined with
//               recency this becomes `thinking`.
//   'blocked' — the last thing recorded was the agent finishing a turn with prose and nothing
//               else. It has spoken and stopped; the next move is a human's. Becomes `waiting`.
//   'error'   — an error marker in the recent tail.
//    null     — we have a timestamp but nothing that says what happened.
export function lastSignal(session) {
  if (!session || typeof session !== 'object') return null
  if (hasErrorMarker(session)) return 'error'

  const type = session.lastEventType
  const content = asArray(session.lastContentTypes)

  if (type === 'assistant') {
    // Order matters: a turn that called a tool is still working even if it also emitted prose
    // alongside the call, so tool_use is checked before text.
    if (content.includes('tool_use')) return 'working'
    if (content.includes('thinking')) return 'working'
    if (content.includes('text')) return 'blocked'
    return null
  }
  if (type === 'progress') return 'working'
  // A user event means the prompt has been handed over and the model owns the turn.
  if (type === 'user') return 'working'
  return null
}

// ---------------------------------------------------------------------------------------------
// deriveStatus
// ---------------------------------------------------------------------------------------------

const result = (status, reason, extra = {}) => ({
  status,
  stale: false,
  label: status,
  reason,
  elapsedMs: null,
  since: null,
  ...extra,
})

/**
 * Classify one session.
 *
 * @param {object} session  { lastEventAt, lastEventType, lastContentTypes, recentLog }
 * @param {number} now      epoch ms — always passed in, never read from the clock
 * @returns {{status, stale, label, reason, elapsedMs, since}}
 *
 * `label` is `status` except for the stale idle tier, where it is 'idle-stale'; `reason` names
 * the branch that fired so a card can explain itself instead of asserting a colour.
 *
 * State machine, in evaluation order:
 *
 *   no usable lastEventAt ................................ unknown   (never idle — see below)
 *   timestamp more than CLOCK_SKEW_MS in the future ...... unknown
 *   elapsed >= BLOCKED_HOLD_MS ........................... idle      (recency outranks any signal)
 *   signal 'error' ....................................... error
 *   signal 'working'  and elapsed <  ACTIVE_MS ........... thinking
 *   signal 'working'  and elapsed >= ACTIVE_MS ........... idle      (was working; no longer evidenced)
 *   signal 'blocked' ..................................... waiting
 *   no signal         and elapsed <  ACTIVE_MS ........... unknown   (something just happened; what is unknown)
 *   no signal         and elapsed >= ACTIVE_MS ........... idle      (nothing recent — idleness needs only recency)
 *
 * Two transitions carry most of the design:
 *
 *  - `working` decays to `idle` at ACTIVE_MS but `blocked` does not decay until BLOCKED_HOLD_MS.
 *    They are different kinds of claim. "Thinking" asserts activity, and after 15 silent seconds
 *    there is no evidence of activity left. "Waiting" asserts that the agent stopped and left
 *    the turn to a person, which remains just as true a minute later.
 *
 *  - A missing timestamp is `unknown`, not `idle`. Idle is a measurement ("nothing has happened
 *    for a while") and with no timestamp there is nothing to measure. This is the single case
 *    the upstream implementation gets wrong, and it is wrong in the most expensive direction:
 *    a session actively burning tokens whose timestamp we failed to parse renders as a calm
 *    grey "idle" card.
 */
export function deriveStatus(session, now) {
  if (!session || typeof session !== 'object') return result('unknown', 'no-session')
  if (!Number.isFinite(now)) return result('unknown', 'no-clock')

  const at = toEpochMs(session.lastEventAt)
  if (at == null) return result('unknown', 'no-last-event-at')

  const elapsedMs = now - at
  if (elapsedMs < -CLOCK_SKEW_MS) {
    // Beyond tolerance the record is from the future as far as this host is concerned. We cannot
    // say how stale it is, so we do not guess in either direction.
    return result('unknown', 'timestamp-in-future', { elapsedMs, since: at })
  }
  const elapsed = Math.max(0, elapsedMs)
  const base = { elapsedMs: elapsed, since: at }

  const idle = reason => {
    const stale = at < localMidnight(now)
    return result('idle', reason, { ...base, stale, label: stale ? 'idle-stale' : 'idle' })
  }

  // Recency outranks the signal: whatever the session was last seen doing, past this point the
  // only honest statement is that nothing has happened for a long time.
  if (elapsed >= BLOCKED_HOLD_MS) return idle('blocked-hold-expired')

  const signal = lastSignal(session)
  if (signal === 'error') return result('error', 'error-in-recent-log', base)
  if (signal === 'working') {
    return elapsed < ACTIVE_MS ? result('thinking', 'working-signal-fresh', base) : idle('working-signal-stale')
  }
  if (signal === 'blocked') return result('waiting', 'assistant-turn-ended-with-text', base)

  // Timestamp but no usable event/content type. Inside the active window that is genuinely
  // ambiguous — something happened moments ago and we cannot say what — so it is unknown, not a
  // coin-flip between thinking and waiting. Outside it, idleness follows from recency alone.
  return elapsed < ACTIVE_MS ? result('unknown', 'recent-but-unclassifiable', base) : idle('no-signal-and-not-recent')
}

// Accepts epoch ms, a numeric string, or an ISO date string. Returns null — not 0, not NaN, not
// Date.now() — for anything it cannot read, so callers cannot mistake a parse failure for a
// timestamp at the epoch.
export function toEpochMs(value) {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  if (typeof value !== 'string' || value.trim() === '') return null
  const n = Number(value)
  if (Number.isFinite(n)) return n
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : t
}

// ---------------------------------------------------------------------------------------------
// collapseIdle
// ---------------------------------------------------------------------------------------------

const IDLE_STATUSES = new Set(['idle'])

const labelOf = s => {
  const l = s?.label ?? s?.project ?? null
  return typeof l === 'string' && l.trim() !== '' ? l : null
}

const statusOf = s => (typeof s?.status === 'string' ? s.status : s?.status?.status ?? null)

/**
 * Reduce a session list to what is happening now.
 *
 *  - Non-idle rows (thinking / waiting / error / unknown) are always kept. `unknown` in
 *    particular is never dropped: we do not know it is idle, and dropping it would turn "we
 *    could not classify this" into "this is not worth showing".
 *  - Idle rows are dropped when the same project label already has a non-idle row — the live
 *    card supersedes the dead one.
 *  - Otherwise idle rows are deduped to the newest per label.
 *  - Rows with no label cannot be grouped and are therefore never dropped.
 *
 * Returns the kept rows *and* an account of every drop. A board that silently shrinks its own
 * list is indistinguishable from a board that failed to load half of it, so the count and the
 * per-row reason are part of the return value rather than something a caller has to recompute.
 *
 * @param {Array} sessions rows carrying { label|project, lastEventAt, status }
 * @returns {{sessions: Array, dropped: number, drops: Array<{label, reason, session}>, reasons: object}}
 */
export function collapseIdle(sessions) {
  const rows = Array.isArray(sessions) ? sessions : []
  const activeLabels = new Set()
  const newestIdle = new Map() // label -> { at, row }

  for (const s of rows) {
    const label = labelOf(s)
    if (label == null) continue
    const status = statusOf(s)
    if (status != null && !IDLE_STATUSES.has(status)) { activeLabels.add(label); continue }
    if (!IDLE_STATUSES.has(status)) continue
    const at = toEpochMs(s.lastEventAt) ?? -Infinity
    const held = newestIdle.get(label)
    // `>=` so that among equal timestamps the later row in the input wins, matching the
    // convention in lib/pricing.mjs where the last record for a key holds the final state.
    if (!held || at >= held.at) newestIdle.set(label, { at, row: s })
  }

  const kept = []
  const drops = []
  for (const s of rows) {
    const label = labelOf(s)
    const status = statusOf(s)
    if (label == null || !IDLE_STATUSES.has(status)) { kept.push(s); continue }
    if (activeLabels.has(label)) {
      drops.push({ label, reason: 'label-has-active-session', session: s })
      continue
    }
    if (newestIdle.get(label)?.row !== s) {
      drops.push({ label, reason: 'superseded-by-newer-idle-session', session: s })
      continue
    }
    kept.push(s)
  }

  const reasons = {}
  for (const d of drops) reasons[d.reason] = (reasons[d.reason] || 0) + 1
  return { sessions: kept, dropped: drops.length, drops, reasons }
}

// ---------------------------------------------------------------------------------------------
// Context-window pressure
// ---------------------------------------------------------------------------------------------

// Context window sizes in tokens, matched in table order against the model id recorded on the
// turn. Sourced from Anthropic's published model table (see the model overview docs / the
// claude-api reference): the 4.6-and-later Opus line, Sonnet 4.6 and later, and the Fable/Mythos
// line all carry a 1M window; Haiku 4.5 and the 4.5-and-earlier Opus/Sonnet models carry 200K.
//
// `[1m]` is the marker Claude Code itself writes into the model string when a session is running
// on the long-context variant, and server/index.mjs already keys off it — it is checked first so
// an explicit marker beats any inference from the family name.
//
// There is deliberately no trailing default. An unrecognised or locally-hosted model returns
// null and the caller reports "unknown", rather than being measured against 200K — the same
// decision lib/pricing.mjs makes for an unpriced model, and for the same reason: a percentage
// against the wrong denominator is not a rough figure, it is a wrong figure with a bar next to it.
export const CONTEXT_WINDOW_TABLE = [
  [/\[1m\]/i, 1_000_000],
  [/opus-4-[678]/i, 1_000_000],
  [/opus-5/i, 1_000_000],
  [/(fable|mythos)-5/i, 1_000_000],
  [/sonnet-(5|4-6)/i, 1_000_000],
  [/haiku/i, 200_000],
  [/opus-(3|4-[015])/i, 200_000],
  [/sonnet-(3|4-5)/i, 200_000],
  [/opus-4(?![.\-]?\d)/i, 200_000],
  [/sonnet-4(?![.\-]?\d)/i, 200_000],
]

export const contextWindowFor = model => {
  if (typeof model !== 'string' || model.trim() === '') return null
  for (const [re, tokens] of CONTEXT_WINDOW_TABLE) if (re.test(model)) return tokens
  return null
}

const finiteNonNegative = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

/**
 * Context-window pressure for the most recent assistant turn.
 *
 * `lastTurnInputTotal = in + cacheCreate + cacheRead` is the whole prompt the model saw on that
 * turn — Anthropic's usage block already reports the prompt split three ways, so nothing is
 * being reconstructed here. Divided by that model's window it is the real occupancy of the
 * context at the last turn.
 *
 * Two things are deliberately absent:
 *  - No hardcoded 200K denominator. The window comes from the turn's own model id, and an
 *    unrecognised model yields `known: false` rather than a number measured against a guess.
 *  - No lifetime-token fallback. When the current turn's figures are missing, upstream
 *    substitutes the session's cumulative token count, which is a much larger and completely
 *    unrelated number — a long session reads as "context nearly full" when its context may be
 *    almost empty. We return unknown instead.
 *
 * `percent` is not clamped. A turn can legitimately exceed the window figure we hold (a model
 * we mapped conservatively, or a beta long-context variant we did not recognise), and clamping
 * to 100 would hide exactly that. `over` flags it; clamping the *bar width* is the renderer's job.
 *
 * @param {object} session { lastTurn: { model, in, cacheCreate, cacheRead } } (or the same fields at top level)
 * @returns {{known, total, window, percent, over, model, reason}}
 */
export function contextPressure(session) {
  const turn = session?.lastTurn ?? session?.lastAssistantTurn ?? session ?? null
  const unknown = (reason, extra = {}) => ({
    known: false, total: null, window: null, percent: null, over: false,
    model: typeof turn?.model === 'string' ? turn.model : null, reason, ...extra,
  })
  if (!turn || typeof turn !== 'object') return unknown('no-turn')

  // Input tokens are the load-bearing field: every assistant turn has them. The two cache
  // fields are legitimately absent when nothing was cached, so an absent cache field counts as
  // zero — but an absent `in` means we are not looking at a usage block at all, and no amount
  // of zero-filling turns that into a measurement.
  const input = finiteNonNegative(turn.in ?? turn.input ?? turn.inputTokens)
  if (input == null) return unknown('no-current-turn-input-tokens')
  const cacheCreate = finiteNonNegative(turn.cacheCreate ?? turn.cc ?? turn.cacheCreationInputTokens) ?? 0
  const cacheRead = finiteNonNegative(turn.cacheRead ?? turn.cr ?? turn.cacheReadInputTokens) ?? 0

  const total = input + cacheCreate + cacheRead
  const model = typeof turn.model === 'string' ? turn.model : null
  const window = contextWindowFor(model)
  // The total is a real measurement even when the denominator is not known, so it is reported
  // either way — "412,000 tokens, window unknown" is a useful line; "unknown%" alone is not.
  if (window == null) return { ...unknown(model ? 'unknown-model-window' : 'no-model-on-turn'), total }

  const percent = (total / window) * 100
  return { known: true, total, window, percent, over: percent > 100, model, reason: null }
}

// ---------------------------------------------------------------------------------------------
// Permission mode
// ---------------------------------------------------------------------------------------------

// Copy is descriptive, not advisory. This project is itself run with --dangerously-skip-permissions,
// so `bypassPermissions` is the normal case here and the badge exists to say which mode a session
// is in — not to warn anybody about a mode they chose on purpose. `level` is there so a renderer
// can pick a colour; it ranks the modes against each other and is not a safety verdict.
export const PERMISSION_BADGES = {
  bypassPermissions: {
    mode: 'bypassPermissions',
    label: 'YOLO',
    level: 'high',
    note: 'Tool permission prompts are skipped for this session.',
  },
  acceptEdits: {
    mode: 'acceptEdits',
    label: 'AUTO-EDIT',
    level: 'medium',
    note: 'File edits are applied without a prompt. Other tools still prompt.',
  },
}

/**
 * Badge descriptor for a session's permission mode, or null when the mode carries no badge.
 *
 * Null covers two different situations — a mode that simply has no badge ('default', 'plan'),
 * and a session where `permissionMode` was never recorded. That is not a case of rendering
 * unknown as a plausible value: the absence of a badge asserts nothing about the session. Use
 * `permissionModeLabel` where the mode itself has to be shown, since that one does distinguish
 * "default" from "we never saw a permission mode".
 */
export function permissionBadge(session) {
  const mode = session?.permissionMode
  if (typeof mode !== 'string') return null
  return PERMISSION_BADGES[mode] ?? null
}

// 'unknown' here is the honest reading of a missing field: Claude Code writes permissionMode on
// its events, so a session without one is a session we failed to read, not a session in default
// mode. Rendering it as "default" would be a claim we cannot support.
export const permissionModeLabel = session => {
  const mode = session?.permissionMode
  return typeof mode === 'string' && mode.trim() !== '' ? mode : 'unknown'
}
