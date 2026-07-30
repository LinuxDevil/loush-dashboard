// Sequenced chat frames with bounded replay.
//
// Written from a capability description; no upstream source was consulted. The idea comes from
// the siteboon/claudecodeui writeup in our research, which describes a WebSocket gateway with a
// per-run monotonic `seq` and a ring buffer for replaying frames missed across a reconnect.
//
// Deliberately NOT a WebSocket layer. This app's chat already streams over SSE and works; the
// part worth having is the sequencing, and sequencing is transport-agnostic. Swapping transports
// to match an upstream design we are not copying would be churn.
//
// The problem it actually solves: on reconnect the SSE endpoint replays every retained event
// from the beginning. That is O(run length) per reconnect and, once the retained log is capped,
// silently incomplete. With a seq a client says "I have up to N" and either gets exactly what it
// missed, or is told plainly that the gap is no longer serveable.

export const DEFAULT_BUFFER = 2000

/**
 * @param {string} runId
 * @param {{bufferSize?: number}} [opts]
 */
export function createRun(runId, opts = {}) {
  const size = Number.isFinite(opts.bufferSize) && opts.bufferSize > 0 ? Math.floor(opts.bufferSize) : DEFAULT_BUFFER
  return { runId, seq: 0, buffer: [], bufferSize: size, evicted: 0, completed: false }
}

/**
 * Stamp a frame and retain it.
 *
 * Returns `{ok:false, reason:'already-complete'}` rather than throwing or silently dropping when
 * a run tries to terminate twice: a client that receives two terminal frames for one run has no
 * way to know which was real, and a caller that gets no signal cannot tell it was ignored.
 */
export function emit(run, kind, payload) {
  if (!run || typeof run !== 'object') return { ok: false, reason: 'no-run' }
  if (run.completed) return { ok: false, reason: 'already-complete', seq: run.seq }
  const frame = { seq: ++run.seq, kind: String(kind || 'unknown'), at: payload?.at ?? null, payload }
  run.buffer.push(frame)
  while (run.buffer.length > run.bufferSize) { run.buffer.shift(); run.evicted++ }
  if (kind === 'complete') run.completed = true
  return { ok: true, frame }
}

/**
 * Frames a reconnecting client missed.
 *
 * `complete:false` is the load-bearing case. If the client's last seq predates what the buffer
 * still holds, the gap cannot be served — and handing back only the surviving tail would leave
 * the client believing it has the whole stream. It is told what the earliest available seq is so
 * it can decide to resync from scratch.
 */
export function replayFrom(run, lastSeq) {
  if (!run || !Array.isArray(run.buffer)) return { complete: false, reason: 'no-run', frames: [] }
  const from = Number.isFinite(lastSeq) ? Math.floor(lastSeq) : 0
  if (from >= run.seq) return { complete: true, frames: [], upTo: run.seq }
  const earliest = run.buffer.length ? run.buffer[0].seq : run.seq + 1
  if (from + 1 < earliest) {
    return {
      complete: false,
      reason: 'buffer-evicted',
      earliestSeq: earliest,
      evicted: run.evicted,
      frames: run.buffer.slice(),
      upTo: run.seq,
    }
  }
  return { complete: true, frames: run.buffer.filter(f => f.seq > from), upTo: run.seq }
}

/**
 * Replay decision for the SSE chat endpoint, which retains a flat `events` array of already-seq-
 * stamped frames rather than a run object. Kept here, next to `replayFrom`, so the two agree on
 * what "the gap is no longer serveable" means — and so the branch the server actually runs is the
 * branch the tests cover.
 *
 * @param {{events?: Array, seq?: number, dropped?: number}} chat
 * @param {*} rawFromSeq  the query param, unparsed
 */
export function sseReplay(chat, rawFromSeq) {
  const events = Array.isArray(chat?.events) ? chat.events : []
  const from = Number(rawFromSeq)
  // Absent or junk `fromSeq` is a first connection, which wants the whole retained log. It is not
  // an error: a client that has never connected has nothing to resume from.
  const resuming = Number.isFinite(from) && from > 0
  if (!resuming) return { resuming: false, gap: null, frames: events }
  const latest = Number(chat?.seq) || 0
  const earliest = events.length ? (events[0].seq || 0) : latest + 1
  const frames = events.filter(ev => (ev.seq || 0) > from)
  // `from + 1 < earliest` — the next frame the client needs has already been trimmed away.
  const gap = from + 1 < earliest
    ? { type: 'replay_gap', earliestSeq: earliest, requestedFrom: from, dropped: Number(chat?.dropped) || 0 }
    : null
  return { resuming: true, gap, frames }
}

export const INBOUND_VERBS =['chat.send', 'chat.abort', 'chat.subscribe', 'chat.permission-response']

/**
 * Validate an inbound message. Never throws — this parses data off a socket.
 * An unknown verb is named in the rejection rather than ignored, because a client sending a verb
 * this server does not implement should learn that, not sit waiting for a reply that never comes.
 */
export function parseInbound(raw) {
  let msg = raw
  if (typeof raw === 'string') {
    try { msg = JSON.parse(raw) } catch { return { ok: false, error: 'not-json' } }
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { ok: false, error: 'not-an-object' }
  const verb = msg.verb ?? msg.type
  if (typeof verb !== 'string' || !verb) return { ok: false, error: 'no-verb' }
  if (!INBOUND_VERBS.includes(verb)) return { ok: false, error: 'unknown-verb', verb, known: INBOUND_VERBS }
  return { ok: true, verb, payload: msg.payload ?? msg }
}

// Not here: an app-id ↔ provider-id index that keeps the provider session id server-side.
//
// The upstream design allocates its own session id and never lets the provider's reach the
// client. That is the right call there and the wrong one here, and the reason is structural: in
// this app the provider session id IS the durable key. It is the transcript's filename on disk
// (`<sessionId>.jsonl`), and pins, session forensics, cost attribution, resume and the context
// explorer are all keyed on it and all outlive the process. The app-side chat id lives in an
// in-memory Map and dies with the server.
//
// Hiding a durable identifier behind an ephemeral one would break every pinned session across a
// restart. The half of the idea that is genuinely useful — allocating our own id before the
// provider has one, so a chat is addressable the moment it starts — this app already does: the
// key in `chats` is minted at spawn time, before the CLI emits its init event.
