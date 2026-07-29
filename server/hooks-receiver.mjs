// server/hooks-receiver.mjs — live ingest of Claude Code hook events (feature 043).
//
// WHY THIS EXISTS
// Every other view in this dashboard reads transcripts off disk, which means it can only ever show
// what has already *finished*: a tool call becomes visible after it returns, a turn after it ends.
// There is no file on disk that says "the agent is running Bash right now". Claude Code will tell
// us that, but only by invoking a hook command at the moment it happens. So the hook script
// (scripts/hook-handler.mjs) POSTs each event here, and this module keeps the resulting picture in
// memory for the live view to read.
//
// WHY IN-MEMORY, AND WHY THAT IS NOT A LIMITATION
// Transcripts remain the durable source of truth; everything here is a strictly-more-recent, strictly
// -less-complete view of the same sessions. Persisting it would create a second store that can
// disagree with the transcripts and then has to be reconciled. Losing it on restart is correct: the
// next hook event repopulates it, and anything older is on disk anyway.
//
// ============================================================================================
// TRUST BOUNDARY — read this before changing any handler below.
// ============================================================================================
// The ingest endpoint is UNAUTHENTICATED. It has to be: the hook command is spawned by Claude Code
// in an environment we do not control and cannot hand a secret to. What limits the blast radius is
// that the server binds loopback by default (server/security.mjs bindHost) and the host/origin
// guards in front of it — NOT anything in this file.
//
// Therefore every field of every event is treated as attacker-controlled input:
//   * No field is ever used as a filesystem path, a shell argument, a spawn target, a require
//     specifier, or a URL to fetch. Nothing on the ingest path touches the filesystem at all —
//     `transcript_path` and `cwd` are retained as opaque display strings and are never opened. The
//     only fs use in this module is the port registry at the bottom, which reads and writes fixed
//     paths and never sees an event field. node:child_process is not imported at all.
//   * `hook_event_name` is whitelisted against HOOK_EVENTS. Unknown names are rejected, not stored,
//     so an attacker cannot mint arbitrary keys in our state.
//   * All retained strings are coerced, control-character-stripped and length-capped (`clean`), so
//     a hostile value cannot blow up memory or smuggle terminal escapes into a UI or a log line.
//   * `tool_input` VALUES ARE NEVER STORED — only the key names. Tool inputs routinely contain file
//     contents, secrets and credentials; a live view does not need them, and anything that holds
//     them becomes a thing that can leak them. The key names alone are enough to render "Edit on 2
//     fields".
//   * Session/agent identifiers are stored and echoed back, so they are cleaned to a conservative
//     charset before they are ever used as an object key or rendered.
//
// ============================================================================================
// "UNKNOWN" IS A VALUE
// ============================================================================================
// A mid-turn state that was guessed is worse than no state at all: a dashboard that confidently says
// "idle" when it does not know is actively misleading, and a user cannot tell the difference. So
// wherever an event does not carry the data to determine something, we store the literal string
// 'unknown' (UNKNOWN) rather than a plausible default. Notably: an event with no session_id lands in
// the UNKNOWN session bucket with `sessionIdKnown: false` instead of being merged into whatever
// session happened to be most recent.
//
// ============================================================================================
// NO SILENT CAPS
// ============================================================================================
// Every bound below is (a) a named constant, (b) reported in the LIMITS block of every response, and
// (c) accompanied by a counter, so a caller can always tell that something was dropped and why. The
// POST response additionally reports what THIS request cost: which fields were truncated, whether it
// evicted a session, whether it pushed an event off the ring.

// ------------------------------------------------------------------------------------------------
// The event vocabulary.
//
// VERIFIED against this repo's own two independent lists rather than assumed: the picker in
// src/sections/HooksSection.jsx:11 and the transcript-scanning regex in server/index.mjs:2364 both
// enumerate NINE events, and they agree with each other. The upstream field table in
// RESEARCH_MERGED.md (the `hooks#common-input-fields` extract) lists the same nine.
//
// The feature brief said "the 8 standard hook types" and the CCAM source it is mined from installs
// 8 — that list omits PreCompact and includes SessionEnd. We accept all nine, because rejecting a
// SessionEnd that Claude Code really does emit would leave sessions stuck "live" forever, which is
// exactly the kind of confidently-wrong state this module is supposed to avoid.
//
// Deliberately NOT accepted: PostToolUseFailure, PermissionRequest, SubagentStart, TeammateIdle,
// TaskCompleted and the other names floating around community hook taxonomies. RESEARCH_MERGED.md
// flags them as unverified against current Claude Code. An unknown name is rejected with the
// whitelist in the error body, so adding one later is a one-line change with a visible signal in
// the meantime (see `rejected.unknownEvent` in the live view).
export const HOOK_EVENTS = Object.freeze([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'SessionEnd',
])

const EVENT_SET = new Set(HOOK_EVENTS)

export const UNKNOWN = 'unknown'

// ------------------------------------------------------------------------------------------------
// Bounds. All of them are reported; none of them is silent.

export const LIMITS = Object.freeze({
  // A hook payload carries a prompt, a tool result or a last assistant message. 256 KiB is generous
  // for those and small enough that a flood cannot exhaust memory before the cap bites. The global
  // express.json({limit:'10mb'}) in server/index.mjs is far too permissive for an unauthenticated
  // endpoint, so this module enforces its own cap on the raw stream and does not rely on it.
  maxBodyBytes: 256 * 1024,
  // Sessions are evicted least-recently-seen. 64 concurrent sessions is well past any realistic
  // number of simultaneously-live agents on one machine; the point of the cap is that a hostile or
  // buggy sender cycling session ids cannot grow this map without limit.
  maxSessions: 64,
  // Per-session ring buffer. This is a LIVE view, not a history — history is the transcript. 200
  // events covers a long turn's worth of tool calls while keeping a pathological session bounded.
  maxEventsPerSession: 200,
  // Subagents tracked per session. Task fan-out beyond this is real but rare; past the cap we keep
  // counting (agentsDropped) rather than pretending the extras do not exist.
  maxAgentsPerSession: 32,
  // Free-text fields (messages, prompts, last assistant message) retained for display.
  maxStringLength: 2000,
  // Identifier-ish fields (session_id, tool_name, agent_type, ...).
  maxIdLength: 200,
  // tool_input key NAMES kept per event. Values are never kept at all — see the trust boundary note.
  maxToolInputKeys: 24,
})

// ------------------------------------------------------------------------------------------------
// Sanitisers.

// Strip C0/C1 control characters (terminal escape smuggling, log injection via \n) and cap length.
// Returns { value, truncated } so the caller can REPORT the truncation instead of hiding it.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g

function clean(raw, max) {
  if (raw == null) return { value: null, truncated: false }
  const s = typeof raw === 'string' ? raw : String(raw)
  const stripped = s.replace(CONTROL_CHARS, ' ')
  if (stripped.length <= max) return { value: stripped, truncated: false }
  return { value: stripped.slice(0, max), truncated: true }
}

// Identifiers become object keys and are echoed into responses, so they get a conservative charset
// on top of the generic cleaning. Anything outside it becomes '_' rather than being dropped, so two
// distinct ids cannot collapse into one by having their bad characters removed.
function cleanId(raw, max = LIMITS.maxIdLength) {
  const { value, truncated } = clean(raw, max)
  if (value == null) return { value: null, truncated }
  const safe = value.replace(/[^A-Za-z0-9._:@/-]/g, '_').trim()
  return { value: safe.length ? safe : null, truncated }
}

const isPlainObject = v => v != null && typeof v === 'object' && !Array.isArray(v)

// ------------------------------------------------------------------------------------------------
// The store.

function newSession(id, known, now) {
  return {
    sessionId: id,
    // Explicit, because 'unknown' is a legitimate id here and a consumer must be able to tell the
    // difference between "the session is literally called unknown" and "we could not attribute this".
    sessionIdKnown: known,
    status: UNKNOWN,          // never guessed — see updateStatus()
    statusSince: now,
    firstSeen: now,
    lastSeen: now,
    cwd: UNKNOWN,
    transcriptPath: UNKNOWN,
    model: UNKNOWN,
    permissionMode: UNKNOWN,
    source: UNKNOWN,
    currentTool: null,        // { name, toolUseId, startedAt, inputKeys }
    lastNotification: null,
    lastStopReason: null,
    agents: new Map(),
    events: [],
    counts: Object.fromEntries(HOOK_EVENTS.map(e => [e, 0])),
    drops: { events: 0, agents: 0, truncatedFields: 0 },
  }
}

export function createHookStore(opts = {}) {
  const limits = { ...LIMITS, ...(opts.limits || {}) }
  return {
    limits,
    sessions: new Map(),      // insertion order is maintained as LRU: touched sessions move to the end
    startedAt: opts.now ? opts.now() : Date.now(),
    totals: { received: 0, accepted: 0, rejected: 0, sessionsEvicted: 0 },
    // Rejections are counted by reason so an operator can see a misconfigured hook (wrong event
    // name, malformed body) instead of silence.
    rejected: { unknownEvent: 0, notAnObject: 0, tooLarge: 0, badJson: 0 },
    lastUnknownEventName: null,
  }
}

// Move a session to the LRU tail. Map preserves insertion order, so delete+set is the whole trick.
function touch(store, key, session) {
  store.sessions.delete(key)
  store.sessions.set(key, session)
}

function evictIfNeeded(store) {
  let evicted = 0
  while (store.sessions.size > store.limits.maxSessions) {
    const oldest = store.sessions.keys().next().value
    store.sessions.delete(oldest)
    evicted++
  }
  store.totals.sessionsEvicted += evicted
  return evicted
}

// ------------------------------------------------------------------------------------------------
// Status derivation.
//
// The ONLY inputs are the event name and whether the fields it needs were actually present. There is
// no timer, no inference from silence, and no "probably still working". A session whose first
// observed event is a PostToolUse has a genuinely unknown prior status and says so.
const STATUS_BY_EVENT = {
  SessionStart: 'idle',
  UserPromptSubmit: 'working',
  PreToolUse: 'running-tool',
  PostToolUse: 'working',
  Stop: 'idle',
  PreCompact: 'compacting',
  SessionEnd: 'ended',
  // Notification: intentionally absent. A notification may mean "waiting for your permission" or may
  // be purely informational, and the payload does not always say which. Guessing 'waiting' here
  // would put a permanent false "needs you" badge on the dashboard.
  // SubagentStop: intentionally absent. It ends a SUBagent; the parent's own status is unchanged and
  // inferring 'working' from it would resurrect a session the user already stopped.
}

export const STATUSES = Object.freeze(['unknown', 'idle', 'working', 'running-tool', 'compacting', 'ended'])

// ------------------------------------------------------------------------------------------------
// Normalising one raw event into what we are willing to keep.

export function normalizeEvent(body, now) {
  if (!isPlainObject(body)) return { ok: false, reason: 'notAnObject', message: 'hook event body must be a JSON object' }

  const name = typeof body.hook_event_name === 'string' ? body.hook_event_name : null
  if (!name || !EVENT_SET.has(name)) {
    return {
      ok: false,
      reason: 'unknownEvent',
      message: 'unrecognised hook_event_name',
      // Echoed back cleaned, so a misconfigured hook is debuggable without the error itself becoming
      // an injection vector.
      received: clean(name, 80).value,
      allowed: HOOK_EVENTS,
    }
  }

  let truncatedFields = 0
  const take = (raw, max) => {
    const { value, truncated } = clean(raw, max)
    if (truncated) truncatedFields++
    return value
  }
  const takeId = (raw, max) => {
    const { value, truncated } = cleanId(raw, max)
    if (truncated) truncatedFields++
    return value
  }

  const sessionId = takeId(body.session_id)
  const ev = {
    event: name,
    at: now,
    sessionId: sessionId ?? UNKNOWN,
    sessionIdKnown: sessionId != null,
    agentId: takeId(body.agent_id),
    agentType: takeId(body.agent_type),
    cwd: take(body.cwd, LIMITS.maxIdLength),                     // display-only string, never resolved
    transcriptPath: take(body.transcript_path, LIMITS.maxIdLength), // ditto — NEVER opened by this module
    permissionMode: takeId(body.permission_mode),
    toolName: takeId(body.tool_name),
    toolUseId: takeId(body.tool_use_id),
    toolInputKeys: null,
    toolResultIsError: typeof body.tool_result_is_error === 'boolean' ? body.tool_result_is_error : null,
    notificationType: takeId(body.notification_type),
    message: take(body.message, LIMITS.maxStringLength),
    userInput: take(body.user_input, LIMITS.maxStringLength),
    lastAssistantMessage: take(body.last_assistant_message, LIMITS.maxStringLength),
    compactionTrigger: takeId(body.compaction_trigger),
    exitReason: takeId(body.exit_reason),
    source: takeId(body.source),
    model: takeId(body.model),
  }

  // Key names only. See the trust-boundary note: tool_input values carry file contents and secrets.
  if (isPlainObject(body.tool_input)) {
    const keys = Object.keys(body.tool_input)
    ev.toolInputKeys = keys.slice(0, LIMITS.maxToolInputKeys).map(k => clean(k, 64).value)
    ev.toolInputKeysDropped = Math.max(0, keys.length - LIMITS.maxToolInputKeys)
  }

  return { ok: true, event: ev, truncatedFields }
}

// ------------------------------------------------------------------------------------------------
// Applying a normalised event to the store. Returns what it cost, so the caller can report it.

export function applyEvent(store, ev) {
  const key = ev.sessionIdKnown ? ev.sessionId : UNKNOWN
  let session = store.sessions.get(key)
  const created = !session
  if (!session) session = newSession(key, ev.sessionIdKnown, ev.at)
  touch(store, key, session)

  session.lastSeen = ev.at
  session.counts[ev.event]++

  // Only overwrite a field when the event actually carried it. An event without `cwd` must not
  // reset a known cwd back to unknown, and must not invent one either.
  if (ev.cwd) session.cwd = ev.cwd
  if (ev.transcriptPath) session.transcriptPath = ev.transcriptPath
  if (ev.permissionMode) session.permissionMode = ev.permissionMode
  if (ev.model) session.model = ev.model
  if (ev.source) session.source = ev.source

  // --- status ------------------------------------------------------------------------------------
  const next = STATUS_BY_EVENT[ev.event]
  if (next && next !== session.status) {
    session.status = next
    session.statusSince = ev.at
  }

  // --- current tool ------------------------------------------------------------------------------
  if (ev.event === 'PreToolUse') {
    session.currentTool = {
      name: ev.toolName ?? UNKNOWN,   // a PreToolUse with no tool_name is genuinely unknown, not "Bash"
      toolUseId: ev.toolUseId ?? UNKNOWN,
      startedAt: ev.at,
      inputKeys: ev.toolInputKeys ?? null,
    }
  } else if (ev.event === 'PostToolUse') {
    // Clear only if it plausibly closes the same call. Without a tool_use_id we cannot pair them, so
    // we clear on a name match and otherwise leave the open call standing rather than silently
    // "finishing" a tool that may still be running.
    const cur = session.currentTool
    if (!cur) session.currentTool = null
    else if (ev.toolUseId && cur.toolUseId !== UNKNOWN) { if (ev.toolUseId === cur.toolUseId) session.currentTool = null }
    else if (!ev.toolName || ev.toolName === cur.name) session.currentTool = null
  } else if (ev.event === 'Stop' || ev.event === 'SessionEnd') {
    session.currentTool = null
  }

  if (ev.event === 'Notification') {
    session.lastNotification = { type: ev.notificationType ?? UNKNOWN, message: ev.message ?? null, at: ev.at }
  }
  if (ev.event === 'SessionEnd') session.lastStopReason = ev.exitReason ?? UNKNOWN
  if (ev.event === 'Stop') session.lastStopReason = 'stop'

  // --- subagents ---------------------------------------------------------------------------------
  let agentsDropped = 0
  if (ev.agentId || ev.event === 'SubagentStop') {
    const aKey = ev.agentId ?? UNKNOWN
    let agent = session.agents.get(aKey)
    if (!agent && session.agents.size >= store.limits.maxAgentsPerSession) {
      agentsDropped = 1
      session.drops.agents++
    } else {
      if (!agent) {
        agent = { agentId: aKey, agentIdKnown: ev.agentId != null, agentType: ev.agentType ?? UNKNOWN, status: UNKNOWN, firstSeen: ev.at, lastSeen: ev.at }
        session.agents.set(aKey, agent)
      }
      agent.lastSeen = ev.at
      if (ev.agentType) agent.agentType = ev.agentType
      if (ev.event === 'SubagentStop') agent.status = 'stopped'
      else if (STATUS_BY_EVENT[ev.event]) agent.status = STATUS_BY_EVENT[ev.event]
    }
  }

  // --- ring buffer -------------------------------------------------------------------------------
  session.events.push(ev)
  let eventsDropped = 0
  while (session.events.length > store.limits.maxEventsPerSession) {
    session.events.shift()
    eventsDropped++
  }
  session.drops.events += eventsDropped

  const sessionsEvicted = evictIfNeeded(store)
  return { created, sessionsEvicted, eventsDropped, agentsDropped, status: session.status }
}

// ------------------------------------------------------------------------------------------------
// The live view. Serialisable, bounded, and it always carries its own limits so a consumer can never
// mistake a truncated picture for the whole one.

export function liveView(store, opts = {}) {
  const wantEvents = Math.max(0, Math.min(Number(opts.events) || 0, store.limits.maxEventsPerSession))
  // `ord` is the LRU position (the Map's insertion order, which touch() maintains). It is the
  // tie-break for sessions whose lastSeen lands in the same millisecond — without it a burst of
  // events inside one tick would order sessions arbitrarily and the live view would jitter.
  let ord = 0
  const sessions = [...store.sessions.values()].map(s => ({
    ord: ord++,
    sessionId: s.sessionId,
    sessionIdKnown: s.sessionIdKnown,
    status: s.status,
    statusSince: s.statusSince,
    firstSeen: s.firstSeen,
    lastSeen: s.lastSeen,
    cwd: s.cwd,
    transcriptPath: s.transcriptPath,
    model: s.model,
    permissionMode: s.permissionMode,
    source: s.source,
    currentTool: s.currentTool,
    lastNotification: s.lastNotification,
    lastStopReason: s.lastStopReason,
    agents: [...s.agents.values()],
    eventCount: s.events.length,
    counts: { ...s.counts },
    drops: { ...s.drops },
    ...(wantEvents ? { events: s.events.slice(-wantEvents) } : {}),
  }))
  // Most recently active first — the live view's whole job is "what is happening now".
  sessions.sort((a, b) => (b.lastSeen - a.lastSeen) || (b.ord - a.ord))
  for (const s of sessions) delete s.ord
  return {
    ok: true,
    startedAt: store.startedAt,
    // Stated outright rather than left for a reader to discover after a restart wipes the view.
    durability: 'in-memory-only; lost on dashboard restart. Transcripts remain the durable source of truth.',
    sessionCount: sessions.length,
    totals: { ...store.totals },
    rejected: { ...store.rejected, lastUnknownEventName: store.lastUnknownEventName },
    limits: { ...store.limits },
    acceptedEvents: HOOK_EVENTS,
    statuses: STATUSES,
    sessions,
  }
}

// The getter the live UI is meant to use. Kept separate from liveView so the store shape stays an
// implementation detail that can change without breaking callers.
export function getLiveState(store, opts) {
  return liveView(store, opts)
}

// ------------------------------------------------------------------------------------------------
// Body reading.
//
// Two paths on purpose. If server/index.mjs's global express.json already parsed the body we use it
// (re-reading a consumed stream would hang). Otherwise we read the raw stream ourselves with OUR cap,
// because an unauthenticated endpoint must not inherit a 10 MB limit set for authenticated ones.

export function readBody(req, limits = LIMITS) {
  if (isPlainObject(req.body)) return Promise.resolve({ ok: true, body: req.body })
  if (typeof req.on !== 'function') return Promise.resolve({ ok: false, reason: 'notAnObject' })
  return new Promise(resolve => {
    let size = 0
    const chunks = []
    let done = false
    const finish = r => { if (!done) { done = true; resolve(r) } }
    req.on('data', c => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(String(c))
      size += buf.length
      if (size > limits.maxBodyBytes) {
        // Stop reading immediately; do not buffer the rest of a hostile upload just to reject it.
        if (typeof req.destroy === 'function') req.destroy()
        finish({ ok: false, reason: 'tooLarge', size })
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      try { finish({ ok: true, body: JSON.parse(text) }) } catch { finish({ ok: false, reason: 'badJson' }) }
    })
    req.on('error', () => finish({ ok: false, reason: 'badJson' }))
  })
}

// ------------------------------------------------------------------------------------------------
// Handlers.

const REJECT_STATUS = { tooLarge: 413, badJson: 400, notAnObject: 400, unknownEvent: 400 }

// POST handler. Contract with the hook script: it will not read this response. Everything here is
// for humans and for `curl`, which is why the ack is verbose about limits — the one reader who ever
// sees it is the one debugging why an event did not show up.
export function hookEventHandler(store, opts = {}) {
  const now = opts.now || (() => Date.now())
  return async function handleHookEvent(req, res) {
    store.totals.received++
    const read = await readBody(req, store.limits)
    if (!read.ok) {
      store.totals.rejected++
      store.rejected[read.reason] = (store.rejected[read.reason] || 0) + 1
      return res.status(REJECT_STATUS[read.reason] || 400).json({
        ok: false, error: read.reason,
        // The bound is stated in the rejection itself; a caller never has to guess why 413 happened.
        limits: { maxBodyBytes: store.limits.maxBodyBytes },
      })
    }

    const norm = normalizeEvent(read.body, now())
    if (!norm.ok) {
      store.totals.rejected++
      store.rejected[norm.reason] = (store.rejected[norm.reason] || 0) + 1
      if (norm.reason === 'unknownEvent') store.lastUnknownEventName = norm.received ?? null
      return res.status(REJECT_STATUS[norm.reason] || 400).json({
        ok: false, error: norm.reason, message: norm.message,
        received: norm.received, allowed: norm.allowed,
      })
    }

    // FIRE-AND-FORGET: answer before touching the store. The sender exits the moment the request
    // flushes, so nothing it does depends on this body — but a slow response still holds a socket
    // open in the agent's process, and the whole point is to never make an agent wait on us.
    // Everything after res.json() runs with the response already written.
    const ev = norm.event
    const willEvict = !store.sessions.has(ev.sessionIdKnown ? ev.sessionId : UNKNOWN) && store.sessions.size >= store.limits.maxSessions
    const existing = store.sessions.get(ev.sessionIdKnown ? ev.sessionId : UNKNOWN)
    const willDropEvent = !!existing && existing.events.length >= store.limits.maxEventsPerSession

    res.status(202).json({
      ok: true,
      accepted: ev.event,
      sessionId: ev.sessionId,
      sessionIdKnown: ev.sessionIdKnown,
      // No silent caps: this request's own cost, not just the static limits.
      report: {
        truncatedFields: norm.truncatedFields,
        toolInputKeysDropped: ev.toolInputKeysDropped || 0,
        willEvictOldestSession: willEvict,
        willDropOldestEvent: willDropEvent,
      },
      limits: { ...store.limits },
      durability: 'in-memory-only',
    })

    store.totals.accepted++
    applyEvent(store, ev)
    if (norm.truncatedFields) {
      const s = store.sessions.get(ev.sessionIdKnown ? ev.sessionId : UNKNOWN)
      if (s) s.drops.truncatedFields += norm.truncatedFields
    }
    return undefined
  }
}

export function liveViewHandler(store) {
  return function handleLiveView(req, res) {
    const q = (req && req.query) || {}
    res.json(getLiveState(store, { events: q.events }))
  }
}

// ------------------------------------------------------------------------------------------------
// Mounting.
//
// Route names are chosen to not collide with the hook-LIBRARY routes already in server/index.mjs
// (/api/hooks, /api/hooks/test, /api/hooks/dryrun, /api/hooks/health, /api/hooks/library,
// /api/hooks/install). Those are about *configuring* hooks in settings.json; these are about
// *receiving* what configured hooks emit. Different nouns, hence /api/hooks/event and
// /api/hooks/live rather than anything under the existing names.
export const ROUTES = Object.freeze({
  ingest: '/api/hooks/event',
  live: '/api/hooks/live',
})

export function mountHooksReceiver(app, opts = {}) {
  const store = opts.store || createHookStore(opts)
  const ingest = opts.routes?.ingest || ROUTES.ingest
  const live = opts.routes?.live || ROUTES.live

  app.post(ingest, hookEventHandler(store, opts))
  app.get(live, liveViewHandler(store))

  // Returned so the caller owns the store: index.mjs can hand `getLiveState` to any other section
  // (ActivityTimeline, WorkingSet) without importing this module's internals.
  return {
    store,
    routes: { ingest, live },
    getLiveState: o => getLiveState(store, o),
  }
}

export default mountHooksReceiver

// ================================================================================================
// PORT DISCOVERY
// ================================================================================================
// THE PROBLEM
// The hook command is a line of JSON in settings.json. It is spawned by Claude Code, from an
// arbitrary cwd, with no knowledge of this repo and no way to be told at spawn time which port the
// dashboard ended up on. DASH_PORT is our convention, but it lives in the shell that started the
// dashboard, not in the shell that starts Claude Code — so relying on it alone means the hook
// silently posts into the void whenever someone runs `DASH_PORT=5200 npm run dev`.
//
// THE MECHANISM
// The dashboard publishes a small registry at:
//
//     ${CLAUDE_CONFIG_DIR or ~/.claude}/loush-dashboard-instances.json
//
// ~/.claude is chosen because it is the one directory both sides already agree on: the dashboard
// reads it for transcripts and settings, and Claude Code owns it. A file inside the repo would not
// work — the hook has no idea where the repo is.
//
// Shape (versioned, so a future change is detectable rather than silently misread):
//     { "version": 1, "instances": [ { "port": 5178, "pid": 1234, "host": "127.0.0.1",
//                                      "startedAt": 1700000000000, "root": "/path/to/repo" } ] }
//
// The array (not a single port) is what lets the hook fan out to EVERY live dashboard, which is the
// behaviour the feature is mined from — two dashboards open on two repos should both light up.
//
// LIVENESS
// Entries are pruned by `process.kill(pid, 0)`, which signals nothing and merely asks "does this pid
// exist". That is the only cheap liveness check available without connecting. It over-accepts after a
// pid is recycled; the consequence is a wasted POST to a closed port, which the hook already ignores,
// so an over-accept is harmless and an under-accept (dropping a live dashboard) would not be.
//
// TRUST: this file is written and read by the same user under their own home directory. We still
// validate every field on read (ports must be integers in range, entries must be objects) because a
// corrupt or half-written file must degrade to "use the default port", never to an exception in a
// hook that would fail the agent's turn.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_DASH_PORT = 5178

// Max instances retained in the registry. Bounds both the file size and the hook's fan-out — a hook
// that had to POST to 500 stale entries would stop being fire-and-forget.
export const MAX_INSTANCES = 8

export function claudeDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

export function instancesFile(env = process.env) {
  return path.join(claudeDir(env), 'loush-dashboard-instances.json')
}

const validPort = p => Number.isInteger(p) && p > 0 && p < 65536

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e && e.code === 'EPERM' } // EPERM = exists, not ours
}

// Returns [] for every failure mode (missing, unreadable, corrupt, wrong version). A hook must never
// throw, so there is no error path to propagate — the caller falls back to the default port.
export function readInstances(env = process.env, { prune = true } = {}) {
  let parsed
  try { parsed = JSON.parse(fs.readFileSync(instancesFile(env), 'utf8')) } catch { return [] }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.instances)) return []
  return parsed.instances
    .filter(i => i && typeof i === 'object' && validPort(i.port))
    .filter(i => !prune || pidAlive(i.pid))
    .slice(0, MAX_INSTANCES)
}

// Called by the server at listen() time. Merges this process's entry, drops dead ones, and writes
// atomically (tmp + rename) so a hook reading concurrently never sees a half-written file.
// Returns the entry list actually written, or null if the registry could not be written — publishing
// is best-effort by design: a dashboard that cannot write ~/.claude must still start.
export function publishInstance({ port, host = '127.0.0.1', root = process.cwd(), env = process.env, pid = process.pid } = {}) {
  if (!validPort(port)) return null
  try {
    const others = readInstances(env).filter(i => i.pid !== pid && i.port !== port)
    const entry = { port, pid, host, startedAt: Date.now(), root: String(root) }
    const instances = [entry, ...others].slice(0, MAX_INSTANCES)
    const file = instancesFile(env)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, maxInstances: MAX_INSTANCES, instances }, null, 2))
    fs.renameSync(tmp, file)
    return instances
  } catch { return null }
}

// Called on graceful shutdown. Not required for correctness — pid pruning covers a hard kill — but it
// keeps the registry honest for the common case.
export function unpublishInstance({ env = process.env, pid = process.pid } = {}) {
  try {
    const instances = readInstances(env, { prune: false }).filter(i => i.pid !== pid)
    const file = instancesFile(env)
    const tmp = `${file}.${pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, maxInstances: MAX_INSTANCES, instances }, null, 2))
    fs.renameSync(tmp, file)
    return instances
  } catch { return null }
}

// The resolution order the hook script uses. Exported here so the receiver and the sender can never
// drift apart, and so it is testable without spawning anything.
//   1. DASH_HOOK_URL  — explicit full origin(s), comma-separated. The escape hatch for anything odd.
//   2. DASH_PORT      — the existing repo convention. An explicit env var always beats discovery.
//   3. the registry   — the normal path.
//   4. DEFAULT_DASH_PORT — last resort, so a dashboard started before this feature still receives.
export function resolveTargets(env = process.env) {
  const fromUrl = String(env.DASH_HOOK_URL || '').split(',').map(s => s.trim()).filter(Boolean)
  if (fromUrl.length) return { source: 'DASH_HOOK_URL', targets: fromUrl.slice(0, MAX_INSTANCES) }

  const envPort = Number(env.DASH_PORT)
  if (validPort(envPort)) return { source: 'DASH_PORT', targets: [`http://127.0.0.1:${envPort}`] }

  const instances = readInstances(env)
  if (instances.length) return { source: 'instances-file', targets: instances.map(i => `http://127.0.0.1:${i.port}`) }

  return { source: 'default', targets: [`http://127.0.0.1:${DEFAULT_DASH_PORT}`] }
}

