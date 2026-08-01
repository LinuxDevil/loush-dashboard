
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

export const ACTIVE_MS = 15_000

export const BLOCKED_HOLD_MS = 15 * 60_000

export const CLOCK_SKEW_MS = 2_000

export const ERROR_LOOKBACK = 3

export const STATUSES = ['thinking', 'waiting', 'idle', 'error', 'unknown']

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

export const localMidnight = now => {
  const d = new Date(now)
  if (Number.isNaN(d.getTime())) return null
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

const asArray = v => (Array.isArray(v) ? v : v == null ? [] : [v])

const hasErrorMarker = session => {
  if (session.lastEventType === 'error') return true
  if (session.isError === true) return true
  const log = Array.isArray(session.recentLog) ? session.recentLog : []
  return log.slice(-ERROR_LOOKBACK).some(e => e && (e.type === 'error' || e.isError === true))
}

export function lastSignal(session) {
  if (!session || typeof session !== 'object') return null
  if (hasErrorMarker(session)) return 'error'

  const type = session.lastEventType
  const content = asArray(session.lastContentTypes)

  if (type === 'assistant') {
    if (content.includes('tool_use')) return 'working'
    if (content.includes('thinking')) return 'working'
    if (content.includes('text')) return 'blocked'
    return null
  }
  if (type === 'progress') return 'working'
  if (type === 'user') return 'working'
  return null
}

// ---------------------------------------------------------------------------------------------
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
    return result('unknown', 'timestamp-in-future', { elapsedMs, since: at })
  }
  const elapsed = Math.max(0, elapsedMs)
  const base = { elapsedMs: elapsed, since: at }

  const idle = reason => {
    const stale = at < localMidnight(now)
    return result('idle', reason, { ...base, stale, label: stale ? 'idle-stale' : 'idle' })
  }

  if (elapsed >= BLOCKED_HOLD_MS) return idle('blocked-hold-expired')

  const signal = lastSignal(session)
  if (signal === 'error') return result('error', 'error-in-recent-log', base)
  if (signal === 'working') {
    return elapsed < ACTIVE_MS ? result('thinking', 'working-signal-fresh', base) : idle('working-signal-stale')
  }
  if (signal === 'blocked') return result('waiting', 'assistant-turn-ended-with-text', base)

  return elapsed < ACTIVE_MS ? result('unknown', 'recent-but-unclassifiable', base) : idle('no-signal-and-not-recent')
}

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
  const newestIdle = new Map()

  for (const s of rows) {
    const label = labelOf(s)
    if (label == null) continue
    const status = statusOf(s)
    if (status != null && !IDLE_STATUSES.has(status)) { activeLabels.add(label); continue }
    if (!IDLE_STATUSES.has(status)) continue
    const at = toEpochMs(s.lastEventAt) ?? -Infinity
    const held = newestIdle.get(label)
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
// ---------------------------------------------------------------------------------------------

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

  const input = finiteNonNegative(turn.in ?? turn.input ?? turn.inputTokens)
  if (input == null) return unknown('no-current-turn-input-tokens')
  const cacheCreate = finiteNonNegative(turn.cacheCreate ?? turn.cc ?? turn.cacheCreationInputTokens) ?? 0
  const cacheRead = finiteNonNegative(turn.cacheRead ?? turn.cr ?? turn.cacheReadInputTokens) ?? 0

  const total = input + cacheCreate + cacheRead
  const model = typeof turn.model === 'string' ? turn.model : null
  const window = contextWindowFor(model)
  if (window == null) return { ...unknown(model ? 'unknown-model-window' : 'no-model-on-turn'), total }

  const percent = (total / window) * 100
  return { known: true, total, window, percent, over: percent > 100, model, reason: null }
}

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

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

export const permissionModeLabel = session => {
  const mode = session?.permissionMode
  return typeof mode === 'string' && mode.trim() !== '' ? mode : 'unknown'
}
