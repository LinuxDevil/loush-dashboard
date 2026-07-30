// ============================================================================================
// ============================================================================================
// ============================================================================================
// ============================================================================================
// ============================================================================================
// ============================================================================================

// ------------------------------------------------------------------------------------------------
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

export const LIMITS = Object.freeze({
  maxBodyBytes: 256 * 1024,
  maxSessions: 64,
  maxEventsPerSession: 200,
  maxAgentsPerSession: 32,
  maxStringLength: 2000,
  maxIdLength: 200,
  maxToolInputKeys: 24,
})

// ------------------------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g

function clean(raw, max) {
  if (raw == null) return { value: null, truncated: false }
  const s = typeof raw === 'string' ? raw : String(raw)
  const stripped = s.replace(CONTROL_CHARS, ' ')
  if (stripped.length <= max) return { value: stripped, truncated: false }
  return { value: stripped.slice(0, max), truncated: true }
}

function cleanId(raw, max = LIMITS.maxIdLength) {
  const { value, truncated } = clean(raw, max)
  if (value == null) return { value: null, truncated }
  const safe = value.replace(/[^A-Za-z0-9._:@/-]/g, '_').trim()
  return { value: safe.length ? safe : null, truncated }
}

const isPlainObject = v => v != null && typeof v === 'object' && !Array.isArray(v)

// ------------------------------------------------------------------------------------------------

function newSession(id, known, now) {
  return {
    sessionId: id,
    sessionIdKnown: known,
    status: UNKNOWN,
    statusSince: now,
    firstSeen: now,
    lastSeen: now,
    cwd: UNKNOWN,
    transcriptPath: UNKNOWN,
    model: UNKNOWN,
    permissionMode: UNKNOWN,
    source: UNKNOWN,
    currentTool: null,
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
    sessions: new Map(),
    startedAt: opts.now ? opts.now() : Date.now(),
    totals: { received: 0, accepted: 0, rejected: 0, sessionsEvicted: 0 },
    rejected: { unknownEvent: 0, notAnObject: 0, tooLarge: 0, badJson: 0 },
    lastUnknownEventName: null,
  }
}

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
const STATUS_BY_EVENT = {
  SessionStart: 'idle',
  UserPromptSubmit: 'working',
  PreToolUse: 'running-tool',
  PostToolUse: 'working',
  Stop: 'idle',
  PreCompact: 'compacting',
  SessionEnd: 'ended',
}

export const STATUSES = Object.freeze(['unknown', 'idle', 'working', 'running-tool', 'compacting', 'ended'])

// ------------------------------------------------------------------------------------------------

export function normalizeEvent(body, now) {
  if (!isPlainObject(body)) return { ok: false, reason: 'notAnObject', message: 'hook event body must be a JSON object' }

  const name = typeof body.hook_event_name === 'string' ? body.hook_event_name : null
  if (!name || !EVENT_SET.has(name)) {
    return {
      ok: false,
      reason: 'unknownEvent',
      message: 'unrecognised hook_event_name',
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
    cwd: take(body.cwd, LIMITS.maxIdLength),
    transcriptPath: take(body.transcript_path, LIMITS.maxIdLength),
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

  if (isPlainObject(body.tool_input)) {
    const keys = Object.keys(body.tool_input)
    ev.toolInputKeys = keys.slice(0, LIMITS.maxToolInputKeys).map(k => clean(k, 64).value)
    ev.toolInputKeysDropped = Math.max(0, keys.length - LIMITS.maxToolInputKeys)
  }

  return { ok: true, event: ev, truncatedFields }
}

// ------------------------------------------------------------------------------------------------

export function applyEvent(store, ev) {
  const key = ev.sessionIdKnown ? ev.sessionId : UNKNOWN
  let session = store.sessions.get(key)
  const created = !session
  if (!session) session = newSession(key, ev.sessionIdKnown, ev.at)
  touch(store, key, session)

  session.lastSeen = ev.at
  session.counts[ev.event]++

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
      name: ev.toolName ?? UNKNOWN,
      toolUseId: ev.toolUseId ?? UNKNOWN,
      startedAt: ev.at,
      inputKeys: ev.toolInputKeys ?? null,
    }
  } else if (ev.event === 'PostToolUse') {
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

export function liveView(store, opts = {}) {
  const wantEvents = Math.max(0, Math.min(Number(opts.events) || 0, store.limits.maxEventsPerSession))
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
  sessions.sort((a, b) => (b.lastSeen - a.lastSeen) || (b.ord - a.ord))
  for (const s of sessions) delete s.ord
  return {
    ok: true,
    startedAt: store.startedAt,
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

export function getLiveState(store, opts) {
  return liveView(store, opts)
}

// ------------------------------------------------------------------------------------------------

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

const REJECT_STATUS = { tooLarge: 413, badJson: 400, notAnObject: 400, unknownEvent: 400 }

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

    const ev = norm.event
    const willEvict = !store.sessions.has(ev.sessionIdKnown ? ev.sessionId : UNKNOWN) && store.sessions.size >= store.limits.maxSessions
    const existing = store.sessions.get(ev.sessionIdKnown ? ev.sessionId : UNKNOWN)
    const willDropEvent = !!existing && existing.events.length >= store.limits.maxEventsPerSession

    res.status(202).json({
      ok: true,
      accepted: ev.event,
      sessionId: ev.sessionId,
      sessionIdKnown: ev.sessionIdKnown,
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

  return {
    store,
    routes: { ingest, live },
    getLiveState: o => getLiveState(store, o),
  }
}

export default mountHooksReceiver

export {
  DEFAULT_DASH_PORT,
  MAX_INSTANCES,
  claudeDir,
  instancesFile,
  readInstances,
  publishInstance,
  unpublishInstance,
  resolveTargets,
} from '../lib/dash-instances.mjs'
