// lib/tracker.mjs — the logic behind the agent-callable tracker tools
// (tracker_create / tracker_update / tracker_list / tracker_link_session), so an agent maintains the
// SAME board a human looks at instead of a private list nobody reconciles.
//
// WHY THIS FILE IS PARANOID
// Every caller here is an LLM tool call. That is an untrusted surface in the ordinary security sense
// (the arguments are model output, sometimes model output derived from a repo file or a web page)
// AND in a subtler sense: a model will confidently pass `status: "in progres"`, a title 40 kB long,
// or an id it half-remembers. The express board routes can afford `t[k] = req.body[k]` because a
// human typed into a form and watches the result. Nothing watches a tool call. So:
//
//   * unknown enum values are REJECTED and the reply names the allowed set (a model can only fix a
//     mistake it is told the shape of; "bad request" produces a retry loop with the same wrong word),
//   * ids are pattern-checked, including against the object-key names that would poison a prototype,
//   * free text is capped and the cap is REPORTED — a silently truncated acceptance criterion reads
//     as a complete one to the next agent that picks the item up,
//   * update on a missing id FAILS: a silent upsert turns a typo'd id into a ghost item that sits on
//     a board nobody filters for, while the real item stays untouched and looks un-worked,
//   * every write is compare-and-set on `version`: last-write-wins silently DELETES the other
//     writer's edit, and with two agents on one board that is the normal case, not the rare one,
//   * nothing here throws. A thrown exception inside a tool handler surfaces to the model as an
//     opaque failure, and the model's next move is to retry the same call.
//
// PURITY: no fs, no express, no clock beyond an injectable `now`. State goes in, a new state comes
// out. The caller (a route) owns reading/writing ~/.claude/taskboard.json.

// ---------------------------------------------------------------------------
// vocabulary
// ---------------------------------------------------------------------------

// The default board pipeline, verbatim from the human board (server/index.mjs default pipeline).
// Duplicated deliberately-narrowly: callers with a custom pipeline pass `allowedStatuses` so the
// agent is held to the SAME columns the human sees, not to a second hard-coded list that drifts.
export const TRACKER_STATUSES = [
  'backlog', 'in-progress', 'code-review', 'fixing', 'ready-for-qa',
  'qa-running', 'bug-reported', 'ready-for-release', 'released',
]
export const TRACKER_TYPES = ['feature', 'sub', 'bug', 'chore']
export const DEFAULT_STATUS = 'backlog'

// Caps. Exported because a cap the caller cannot read is a cap the caller cannot respect: the tool
// description shown to the model is generated from these, and every truncation reports the number
// it was truncated to.
export const LIMITS = {
  title: 200,
  notes: 8000,
  reason: 1000,
  tag: 40,
  tags: 12,
  links: 50,          // session links kept per item
  listPageMax: 200,   // hard ceiling on trackerList page size
  listPageDefault: 50,
  items: 5000,        // total items one board will hold before create is refused (refused, not silently dropped)
}

// Ids: what the board generates is `tk` + base36, but items may be imported with foreign keys, so the
// pattern is "a short opaque token", not "our generator's output". No slashes (an id reaches a file
// path in the worktree layer), no whitespace, no dots-only, bounded length.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/
// Keys that are legal strings but poison an object used as a map. The item store here is a plain
// object keyed by id; `__proto__` as an id would silently rewrite every item's prototype.
const POISON_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

export function isTrackerId(id) {
  return typeof id === 'string' && ID_RE.test(id) && !POISON_KEYS.has(id)
}

// Session ids are Claude Code session uuids in practice, but transcripts have been seen with other
// shapes, so this validates "opaque token, no path separators" rather than a strict uuid — a
// too-strict check would REJECT a real session, and rejecting a real link is worse than recording it.
const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/
export const isSessionId = s => typeof s === 'string' && SESSION_RE.test(s)

// ---------------------------------------------------------------------------
// result envelopes — one shape, always, so a caller cannot mistake absence for success
// ---------------------------------------------------------------------------

const ok = (extra = {}) => ({ ok: true, error: null, reason: null, ...extra })
const fail = (error, reason, extra = {}) => ({ ok: false, error, reason, ...extra })

// ---------------------------------------------------------------------------
// state normalisation — malformed state is repaired and the repair is reported
// ---------------------------------------------------------------------------

/**
 * Accepts anything (a fresh install's `undefined`, a half-written JSON blob, a hostile shape) and
 * returns a usable state plus the list of repairs performed. Repairs are REPORTED rather than
 * silent: "your board had 3 unreadable rows" is a fact the operator needs; dropping them quietly
 * makes items disappear with no event anywhere.
 */
export function normalizeState(state) {
  const repairs = []
  const items = Object.create(null)
  if (state == null || typeof state !== 'object') {
    if (state !== undefined && state !== null) repairs.push({ what: 'state', reason: `state was ${typeof state}, expected object — started from empty` })
    return { state: { items, seq: 0 }, repairs }
  }
  const raw = state.items
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : []
  if (raw != null && !Array.isArray(raw) && typeof raw !== 'object') repairs.push({ what: 'items', reason: `items was ${typeof raw}, expected array or object — treated as empty` })
  for (const it of list) {
    if (!it || typeof it !== 'object') { repairs.push({ what: 'item', reason: 'non-object row dropped' }); continue }
    if (!isTrackerId(it.id)) { repairs.push({ what: 'item', id: String(it.id).slice(0, 64), reason: 'row has no usable id — dropped (it could never be updated or linked)' }); continue }
    if (items[it.id]) { repairs.push({ what: 'item', id: it.id, reason: 'duplicate id — kept the first, dropped the second' }); continue }
    items[it.id] = {
      ...it,
      version: Number.isInteger(it.version) && it.version > 0 ? it.version : 1,
      links: Array.isArray(it.links) ? it.links : [],
      history: Array.isArray(it.history) ? it.history : [],
      tags: Array.isArray(it.tags) ? it.tags : [],
    }
    if (!Number.isInteger(it.version) || it.version <= 0) repairs.push({ what: 'item', id: it.id, reason: 'version missing or not a positive integer — reset to 1, so the first compare-and-set may report a conflict' })
  }
  const seq = Number.isInteger(state.seq) && state.seq >= 0 ? state.seq : 0
  return { state: { items, seq }, repairs }
}

/** The list form the UI and the routes want. Sorted newest-first; unknown createdAt sorts last. */
export const toArray = state => Object.values(normalizeState(state).state.items)
  .sort((a, b) => (b.createdAt ?? -Infinity) - (a.createdAt ?? -Infinity))

// ---------------------------------------------------------------------------
// field validation
// ---------------------------------------------------------------------------

/**
 * Cap a free-text field. Returns {value, truncated} where `truncated` names the cap and the original
 * length — the WHY: an agent that pasted 30 kB of acceptance criteria into `notes` must learn that
 * only the first 8 kB survived, or it will assume the rest is on the board and act on it.
 */
function capText(field, raw, cap) {
  if (raw == null) return { value: null, truncated: null }
  const s = typeof raw === 'string' ? raw : String(raw)
  if (s.length <= cap) return { value: s, truncated: null }
  return { value: s.slice(0, cap), truncated: { field, cap, originalLength: s.length, dropped: s.length - cap, reason: `${field} was truncated to the ${cap}-character cap — ${s.length - cap} characters were NOT stored` } }
}

// Nearest allowed value within a small edit distance, on a de-punctuated form. "in progres" and
// "inprogress" are the two mistakes a model actually makes (a space for the dash, a dropped letter),
// and naming the intended value turns a retry loop into a single corrected call.
const canon = s => String(s).toLowerCase().replace(/[\s_-]/g, '')
function editDistance(a, b) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 2) return 99
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = row
  }
  return prev[b.length]
}
function nearest(value, allowed) {
  const v = canon(value)
  let best = null, bestD = 3
  for (const a of allowed) { const d = editDistance(v, canon(a)); if (d < bestD) { bestD = d; best = a } }
  return best
}

function validateStatus(status, allowed) {
  if (status == null) return { ok: true, value: null }
  if (typeof status !== 'string') return { ok: false, result: fail('invalid_status', `status must be a string, got ${typeof status}`, { allowed }) }
  const v = status.trim()
  if (allowed.includes(v)) return { ok: true, value: v }
  // Name the allowed set AND, when the miss is obviously a near-miss, name the likely intent. A
  // model handed only "invalid status" retries with the same word; handed the set, it self-corrects.
  const near = nearest(v, allowed)
  return {
    ok: false,
    result: fail('unknown_status', `"${v}" is not a status on this board${near ? ` — did you mean "${near}"?` : ''}`, { allowed, given: v, suggestion: near || null }),
  }
}

function validateType(type) {
  if (type == null) return { ok: true, value: null }
  if (typeof type === 'string' && TRACKER_TYPES.includes(type)) return { ok: true, value: type }
  return { ok: false, result: fail('unknown_type', `"${String(type).slice(0, 40)}" is not a tracker item type`, { allowed: TRACKER_TYPES, given: type == null ? null : String(type).slice(0, 40) }) }
}

function validateTags(tags) {
  if (tags == null) return { ok: true, value: null, notes: [] }
  if (!Array.isArray(tags)) return { ok: false, result: fail('invalid_tags', `tags must be an array, got ${typeof tags}`) }
  const notes = []
  const out = []
  for (const t of tags) {
    if (typeof t !== 'string' || !t.trim()) { notes.push({ field: 'tags', reason: 'a non-string or empty tag was dropped' }); continue }
    if (out.length >= LIMITS.tags) { notes.push({ field: 'tags', cap: LIMITS.tags, reason: `only the first ${LIMITS.tags} tags were kept — ${tags.length - LIMITS.tags} dropped` }); break }
    const c = capText('tag', t.trim(), LIMITS.tag)
    if (c.truncated) notes.push(c.truncated)
    out.push(c.value)
  }
  return { ok: true, value: out, notes }
}

// ---------------------------------------------------------------------------
// tracker_create
// ---------------------------------------------------------------------------

/**
 * @param {object} state    board state (anything; normalised defensively)
 * @param {object} input    the tool arguments — untrusted
 * @param {object} [opts]   {now, allowedStatuses, idFactory, knownProjects}
 * @returns {{ok, state, item, warnings, ...}} never throws
 */
export function trackerCreate(state, input, opts = {}) {
  const now = opts.now ?? Date.now()
  const allowed = Array.isArray(opts.allowedStatuses) && opts.allowedStatuses.length ? opts.allowedStatuses : TRACKER_STATUSES
  const { state: st, repairs } = normalizeState(state)
  const warnings = [...repairs]

  if (input == null || typeof input !== 'object' || Array.isArray(input))
    return fail('invalid_input', `tracker_create expects an object of fields, got ${Array.isArray(input) ? 'array' : typeof input}`, { state: st, item: null, warnings })

  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) return fail('title_required', 'an item with no title is invisible on a board — pass a title', { state: st, item: null, warnings })

  const st1 = validateStatus(input.status, allowed)
  if (!st1.ok) return { ...st1.result, state: st, item: null, warnings }
  const ty = validateType(input.type)
  if (!ty.ok) return { ...ty.result, state: st, item: null, warnings }
  const tg = validateTags(input.tags)
  if (!tg.ok) return { ...tg.result, state: st, item: null, warnings }
  warnings.push(...tg.notes)

  const count = Object.keys(st.items).length
  if (count >= LIMITS.items)
    return fail('board_full', `this board already holds ${count} items, the cap is ${LIMITS.items} — refusing to create rather than evicting something you would never be told about`, { cap: LIMITS.items, count, state: st, item: null, warnings })

  // Caller-supplied id is allowed (import / idempotent retry) but validated like everything else.
  let id
  if (input.id !== undefined) {
    if (!isTrackerId(input.id))
      return fail('invalid_id', `"${String(input.id).slice(0, 64)}" is not a usable item id — 3-64 chars of letters, digits, dot, dash, underscore, starting alphanumeric`, { pattern: ID_RE.source, state: st, item: null, warnings })
    if (st.items[input.id])
      return fail('id_exists', `item "${input.id}" already exists — use tracker_update (with its expectedVersion) instead of re-creating it`, { id: input.id, currentVersion: st.items[input.id].version, state: st, item: null, warnings })
    id = input.id
  } else {
    id = (opts.idFactory || defaultIdFactory)(now, st)
  }

  const tTitle = capText('title', title, LIMITS.title)
  const tNotes = capText('notes', input.notes ?? input.desc ?? null, LIMITS.notes)
  for (const t of [tTitle.truncated, tNotes.truncated]) if (t) warnings.push(t)

  // UNKNOWN IS A VALUE. `project` is not defaulted to "the first project" or to the board's only
  // project: an item filed under the wrong project is worse than one visibly filed under none, and
  // every project-scoped view can then state "1 item has no project" instead of miscounting.
  const unknown = {}
  let project = null
  if (typeof input.project === 'string' && input.project.trim()) {
    project = input.project.trim()
    if (Array.isArray(opts.knownProjects) && !opts.knownProjects.includes(project)) {
      // Recorded, not rejected and not trusted: the project list may simply be stale.
      unknown.project = `project "${project}" is not in the known-project list — recorded as given, treat project-scoped counts for it as unverified`
      warnings.push({ field: 'project', reason: unknown.project })
    }
  } else {
    unknown.project = 'no project supplied — this item is unscoped and will NOT appear under any project filter'
  }

  const item = {
    id,
    title: tTitle.value,
    notes: tNotes.value,
    status: st1.value ?? DEFAULT_STATUS,
    type: ty.value ?? 'feature',
    project,
    tags: tg.value ?? [],
    parent: isTrackerId(input.parent) ? input.parent : null,
    origin: 'agent',
    version: 1,
    createdAt: now,
    updatedAt: now,
    links: [],
    history: [{ at: now, from: null, to: st1.value ?? DEFAULT_STATUS, by: 'agent', note: 'created via tracker_create' }],
    unknown: Object.keys(unknown).length ? unknown : null,
  }
  if (input.parent !== undefined && !isTrackerId(input.parent))
    warnings.push({ field: 'parent', reason: `parent "${String(input.parent).slice(0, 64)}" is not a usable id — stored as null, this item is top-level` })
  else if (item.parent && !st.items[item.parent])
    warnings.push({ field: 'parent', reason: `parent "${item.parent}" does not exist on this board — the link is recorded but dangling` })

  const items = { ...st.items, [id]: item }
  return ok({
    state: { items, seq: st.seq + 1 },
    item,
    created: true,
    // Say what was actually stored, not what was asked for — the two differ whenever a cap fired.
    stored: { id, title: item.title, status: item.status, project: item.project, version: 1 },
    warnings,
    caps: LIMITS,
  })
}

const defaultIdFactory = (now, st) => {
  // Same shape as the human board's generator so both kinds of item sort and read alike.
  let id
  do { id = 'tk' + now.toString(36) + Math.random().toString(36).slice(2, 5) } while (st.items[id])
  return id
}

// ---------------------------------------------------------------------------
// tracker_update — compare-and-set, never an upsert
// ---------------------------------------------------------------------------

const UPDATABLE = ['title', 'notes', 'status', 'type', 'project', 'tags', 'parent']

/**
 * @param {object} input {id, expectedVersion, ...fields}
 * @returns {{ok, state, item, changed:[{field,from,to}], ...}}
 */
export function trackerUpdate(state, input, opts = {}) {
  const now = opts.now ?? Date.now()
  const allowed = Array.isArray(opts.allowedStatuses) && opts.allowedStatuses.length ? opts.allowedStatuses : TRACKER_STATUSES
  const { state: st, repairs } = normalizeState(state)
  const warnings = [...repairs]

  if (input == null || typeof input !== 'object' || Array.isArray(input))
    return fail('invalid_input', `tracker_update expects an object of fields, got ${Array.isArray(input) ? 'array' : typeof input}`, { state: st, item: null, changed: [], warnings })
  if (!isTrackerId(input.id))
    return fail('invalid_id', `"${String(input.id).slice(0, 64)}" is not a usable item id — nothing was written`, { pattern: ID_RE.source, state: st, item: null, changed: [], warnings })

  const cur = st.items[input.id]
  // NEVER a silent upsert. A model that mistypes an id and gets a fresh item back has created a
  // ghost: the real item stays unchanged (and looks abandoned), while work is logged against an id
  // no human view filters for. Failing here costs one retry; upserting costs a lost item.
  if (!cur)
    return fail('no_such_item', `no item "${input.id}" on this board — tracker_update never creates, so nothing was written. Use tracker_create if this is genuinely new.`, {
      id: input.id, state: st, item: null, changed: [], warnings,
      hint: 'call tracker_list to see the ids that do exist',
    })

  // COMPARE-AND-SET. Without this, two agents (or an agent and a human) reading version N and both
  // writing produce one surviving edit and one silently discarded one, with no record that anything
  // was lost. `expectedVersion` is required, not optional, for exactly that reason.
  if (input.expectedVersion === undefined || input.expectedVersion === null)
    return fail('expected_version_required', `tracker_update requires expectedVersion so a concurrent edit cannot be silently overwritten — item "${cur.id}" is currently at version ${cur.version}`, {
      id: cur.id, currentVersion: cur.version, state: st, item: cur, changed: [], warnings,
    })
  const expected = Number(input.expectedVersion)
  if (!Number.isInteger(expected) || expected < 1)
    return fail('invalid_expected_version', `expectedVersion must be a positive integer, got ${JSON.stringify(input.expectedVersion)} — item "${cur.id}" is at version ${cur.version}`, {
      id: cur.id, currentVersion: cur.version, state: st, item: cur, changed: [], warnings,
    })
  if (expected !== cur.version)
    return fail('version_conflict', `item "${cur.id}" was modified by someone else: you passed expectedVersion ${expected}, the stored version is ${cur.version}. Nothing was written — re-read the item and re-apply your change.`, {
      id: cur.id, expectedVersion: expected, actualVersion: cur.version, state: st, item: cur, changed: [], warnings,
      lastChangedAt: cur.updatedAt ?? null,
    })

  const next = { ...cur, links: [...cur.links], history: [...cur.history], tags: [...(cur.tags || [])] }
  const changed = []

  if (input.status !== undefined) {
    const v = validateStatus(input.status, allowed)
    if (!v.ok) return { ...v.result, id: cur.id, state: st, item: cur, changed: [], warnings }
    if (v.value !== null && v.value !== cur.status) { changed.push({ field: 'status', from: cur.status, to: v.value }); next.status = v.value; next.history.push({ at: now, from: cur.status, to: v.value, by: 'agent', note: 'tracker_update' }) }
  }
  if (input.type !== undefined) {
    const v = validateType(input.type)
    if (!v.ok) return { ...v.result, id: cur.id, state: st, item: cur, changed: [], warnings }
    if (v.value !== null && v.value !== cur.type) { changed.push({ field: 'type', from: cur.type, to: v.value }); next.type = v.value }
  }
  if (input.tags !== undefined) {
    const v = validateTags(input.tags)
    if (!v.ok) return { ...v.result, id: cur.id, state: st, item: cur, changed: [], warnings }
    warnings.push(...v.notes)
    const from = cur.tags || []
    if (JSON.stringify(from) !== JSON.stringify(v.value)) { changed.push({ field: 'tags', from, to: v.value }); next.tags = v.value }
  }
  for (const [field, cap] of [['title', LIMITS.title], ['notes', LIMITS.notes]]) {
    if (input[field] === undefined) continue
    if (input[field] === null) { if (cur[field] !== null) { changed.push({ field, from: cur[field], to: null }); next[field] = null } continue }
    if (typeof input[field] !== 'string')
      return fail('invalid_field', `${field} must be a string or null, got ${typeof input[field]} — nothing was written`, { id: cur.id, field, state: st, item: cur, changed: [], warnings })
    const t = capText(field, field === 'title' ? input[field].trim() : input[field], cap)
    if (t.truncated) warnings.push(t.truncated)
    if (field === 'title' && !t.value)
      return fail('title_required', 'refusing to blank a title — an untitled card is invisible on the board', { id: cur.id, state: st, item: cur, changed: [], warnings })
    if (t.value !== cur[field]) { changed.push({ field, from: cur[field], to: t.value }); next[field] = t.value }
  }
  if (input.project !== undefined) {
    const p = typeof input.project === 'string' && input.project.trim() ? input.project.trim() : null
    if (p !== cur.project) {
      changed.push({ field: 'project', from: cur.project, to: p })
      next.project = p
      // Clearing a project is a real state, and it must keep SAYING so — otherwise the item quietly
      // vanishes from every project-scoped count with nothing anywhere explaining the drop.
      const u = { ...(cur.unknown || {}) }
      if (p) delete u.project
      else u.project = 'project cleared — this item is unscoped and will NOT appear under any project filter'
      next.unknown = Object.keys(u).length ? u : null
    }
  }
  if (input.parent !== undefined) {
    const p = isTrackerId(input.parent) ? input.parent : null
    if (input.parent != null && !p) warnings.push({ field: 'parent', reason: `parent "${String(input.parent).slice(0, 64)}" is not a usable id — parent left unchanged` })
    else if (p !== cur.parent) {
      if (p === cur.id) return fail('invalid_parent', 'an item cannot be its own parent — nothing was written', { id: cur.id, state: st, item: cur, changed: [], warnings })
      if (p && !st.items[p]) warnings.push({ field: 'parent', reason: `parent "${p}" does not exist on this board — the link is recorded but dangling` })
      changed.push({ field: 'parent', from: cur.parent, to: p }); next.parent = p
    }
  }

  const unknownFields = Object.keys(input).filter(k => k !== 'id' && k !== 'expectedVersion' && !UPDATABLE.includes(k))
  for (const f of unknownFields) warnings.push({ field: f, reason: `"${f}" is not an updatable field and was ignored — updatable fields are: ${UPDATABLE.join(', ')}` })

  // A no-op does NOT bump the version. Bumping would invalidate every other holder's expectedVersion
  // for a write that changed nothing, turning idempotent retries into a conflict storm.
  if (!changed.length)
    return ok({
      state: st, item: cur, changed: [], noop: true,
      reason: unknownFields.length
        ? `nothing changed — every field you passed was either identical to the stored value or not updatable (${unknownFields.join(', ')})`
        : 'nothing changed — every field you passed already held that value; the version was NOT bumped',
      version: cur.version, warnings,
    })

  next.version = cur.version + 1
  next.updatedAt = now
  return ok({
    state: { items: { ...st.items, [next.id]: next }, seq: st.seq + 1 },
    item: next,
    changed,                          // exactly what moved, field by field, old → new
    version: next.version,
    previousVersion: cur.version,
    reason: `${changed.length} field(s) changed; item "${next.id}" is now at version ${next.version} — pass that as expectedVersion on your next update`,
    warnings,
  })
}

// ---------------------------------------------------------------------------
// tracker_link_session
// ---------------------------------------------------------------------------

/**
 * Link an item to the session that worked it.
 *
 * VERIFICATION IS TRISTATE ON PURPOSE. A session id the caller supplies can be (a) present in the
 * session index → verified, (b) absent from a supplied index → recorded as UNVERIFIED, (c) checked
 * against no index at all → verified:null, "not checked". Rejecting (b) loses real links, because
 * the index is a 7-day window over transcripts and long-lived work legitimately points further back;
 * trusting (b) silently puts a fabricated id on the board that renders as a working resume command.
 * So it is recorded, flagged, and the flag is what the UI renders.
 */
export function trackerLinkSession(state, input, opts = {}) {
  const now = opts.now ?? Date.now()
  const { state: st, repairs } = normalizeState(state)
  const warnings = [...repairs]

  if (input == null || typeof input !== 'object' || Array.isArray(input))
    return fail('invalid_input', `tracker_link_session expects an object, got ${Array.isArray(input) ? 'array' : typeof input}`, { state: st, item: null, link: null, warnings })
  if (!isTrackerId(input.id))
    return fail('invalid_id', `"${String(input.id).slice(0, 64)}" is not a usable item id — nothing was linked`, { state: st, item: null, link: null, warnings })
  const cur = st.items[input.id]
  if (!cur)
    return fail('no_such_item', `no item "${input.id}" on this board — a link cannot create the item it points at`, { id: input.id, state: st, item: null, link: null, warnings })
  if (!isSessionId(input.sessionId))
    return fail('invalid_session_id', `"${String(input.sessionId).slice(0, 64)}" is not a usable session id — 6-128 chars, no whitespace or path separators`, { id: cur.id, state: st, item: cur, link: null, warnings })

  const known = opts.knownSessionIds
  let verified = null
  let verifyReason = 'no session index was supplied to check against — this link is RECORDED BUT UNCHECKED'
  if (Array.isArray(known) || known instanceof Set) {
    const has = known instanceof Set ? known.has(input.sessionId) : known.includes(input.sessionId)
    verified = has
    verifyReason = has
      ? 'session found in the supplied session index'
      : `session "${input.sessionId}" is NOT in the supplied session index (${known instanceof Set ? known.size : known.length} sessions) — recorded as UNVERIFIED rather than rejected, because the index is a bounded window and older real sessions fall outside it. Do not present this as a resumable session without re-checking.`
    if (!has) warnings.push({ field: 'sessionId', reason: verifyReason })
  } else {
    warnings.push({ field: 'sessionId', reason: verifyReason })
  }

  const roleRaw = typeof input.role === 'string' ? input.role.trim() : ''
  const role = roleRaw || null
  const noteCap = capText('note', input.note ?? null, LIMITS.reason)
  if (noteCap.truncated) warnings.push(noteCap.truncated)

  const existing = cur.links.find(l => l.sessionId === input.sessionId)
  if (existing) {
    // Re-linking is not an error, but it must not silently look like a second unit of work.
    const upgraded = verified === true && existing.verified !== true
    const links = cur.links.map(l => (l.sessionId === input.sessionId ? { ...l, verified, verifyReason, at: l.at, lastSeenAt: now, role: role ?? l.role, note: noteCap.value ?? l.note } : l))
    const next = { ...cur, links, version: upgraded ? cur.version + 1 : cur.version, updatedAt: upgraded ? now : cur.updatedAt }
    return ok({
      state: upgraded ? { items: { ...st.items, [next.id]: next }, seq: st.seq + 1 } : { items: { ...st.items, [next.id]: next }, seq: st.seq },
      item: next,
      link: links.find(l => l.sessionId === input.sessionId),
      changed: upgraded ? [{ field: 'links', from: 'unverified', to: 'verified' }] : [],
      duplicate: true,
      verified, verifyReason,
      reason: upgraded
        ? `session "${input.sessionId}" was already linked as unverified and is now verified`
        : `session "${input.sessionId}" was already linked to "${cur.id}" — the timestamp was refreshed, no new link was added`,
      warnings,
    })
  }

  // Cap the link list, and REPORT the cap: an item silently keeping only the newest 50 sessions
  // would make "sessions that worked this" quietly wrong for long-running items.
  let links = [...cur.links, { sessionId: input.sessionId, at: now, lastSeenAt: now, verified, verifyReason, role, note: noteCap.value }]
  let capped = null
  if (links.length > LIMITS.links) {
    const dropped = links.length - LIMITS.links
    links = links.slice(-LIMITS.links)
    capped = { cap: LIMITS.links, dropped, reason: `this item now holds the ${LIMITS.links} most recent session links; ${dropped} older link(s) were dropped and are NOT recoverable from this record` }
    warnings.push(capped)
  }
  const next = { ...cur, links, version: cur.version + 1, updatedAt: now }
  return ok({
    state: { items: { ...st.items, [next.id]: next }, seq: st.seq + 1 },
    item: next,
    link: links[links.length - 1],
    changed: [{ field: 'links', from: cur.links.length, to: links.length }],
    version: next.version,
    verified, verifyReason,
    capped,
    reason: `linked session "${input.sessionId}" to "${cur.id}" (verified: ${verified === null ? 'not checked' : verified})`,
    warnings,
  })
}

// ---------------------------------------------------------------------------
// tracker_list
// ---------------------------------------------------------------------------

/**
 * Filter + page. Unknown filter values are REJECTED by name rather than ignored: a caller that asks
 * for status "done" (not a column here) and receives every item would read the full board as "all
 * of these are done". Every bound — page size, total, whether more remain — is in the reply.
 */
export function trackerList(state, query = {}, opts = {}) {
  const allowed = Array.isArray(opts.allowedStatuses) && opts.allowedStatuses.length ? opts.allowedStatuses : TRACKER_STATUSES
  const { state: st, repairs } = normalizeState(state)
  const warnings = [...repairs]
  const q = query == null || typeof query !== 'object' || Array.isArray(query) ? {} : query
  if (query != null && (typeof query !== 'object' || Array.isArray(query)))
    warnings.push({ field: 'query', reason: `query must be an object, got ${Array.isArray(query) ? 'array' : typeof query} — listed everything instead of guessing a filter` })

  const applied = {}
  let rows = Object.values(st.items)

  if (q.status !== undefined && q.status !== null) {
    const statuses = Array.isArray(q.status) ? q.status : [q.status]
    for (const s of statuses) {
      const v = validateStatus(s, allowed)
      if (!v.ok) return { ...v.result, items: [], total: 0, returned: 0, warnings }
    }
    applied.status = statuses
    rows = rows.filter(r => statuses.includes(r.status))
  }
  if (typeof q.project === 'string' && q.project.trim()) {
    applied.project = q.project.trim()
    rows = rows.filter(r => r.project === applied.project)
  }
  // Explicit "unscoped only" — otherwise items with a null project are unreachable by any filter.
  if (q.project === null) { applied.project = null; rows = rows.filter(r => r.project == null) }
  if (typeof q.sessionId === 'string' && q.sessionId) {
    applied.sessionId = q.sessionId
    rows = rows.filter(r => r.links.some(l => l.sessionId === q.sessionId))
  }
  if (typeof q.text === 'string' && q.text.trim()) {
    const needle = q.text.trim().toLowerCase()
    applied.text = q.text.trim()
    rows = rows.filter(r => `${r.title} ${r.notes || ''} ${(r.tags || []).join(' ')}`.toLowerCase().includes(needle))
  }
  if (q.type !== undefined && q.type !== null) {
    const v = validateType(q.type)
    if (!v.ok) return { ...v.result, items: [], total: 0, returned: 0, warnings }
    applied.type = v.value
    rows = rows.filter(r => r.type === v.value)
  }

  rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const total = rows.length
  const offset = Number.isInteger(q.offset) && q.offset > 0 ? q.offset : 0
  const askedLimit = Number.isInteger(q.limit) && q.limit > 0 ? q.limit : LIMITS.listPageDefault
  const limit = Math.min(askedLimit, LIMITS.listPageMax)
  const items = rows.slice(offset, offset + limit)
  const capped = total > offset + items.length

  return ok({
    items,
    total,                                    // matches BEFORE paging — the number a count should use
    returned: items.length,
    offset, limit,
    limitCapped: askedLimit > LIMITS.listPageMax ? { asked: askedLimit, cap: LIMITS.listPageMax, reason: `you asked for ${askedLimit} items; the hard page cap is ${LIMITS.listPageMax}` } : null,
    more: capped,
    // Never let a paged answer read like a complete one.
    reason: capped
      ? `showing ${items.length} of ${total} matching item(s) — ${total - offset - items.length} more remain, page with offset=${offset + items.length}`
      : `showing all ${items.length} matching item(s)`,
    filters: applied,
    unscopedCount: Object.values(st.items).filter(r => r.project == null).length,
    warnings,
  })
}

// ---------------------------------------------------------------------------
// persistence adapter — the ONLY part of this file that knows a store exists, and it does not know
// what the store is. The caller injects `read()`/`write()`; this module never imports a board
// module, never touches fs, and can therefore be tested (including its concurrency behaviour)
// without a disk. It also means the same logic serves the express routes, an MCP tool server and a
// test harness without any of them forking it.
// ---------------------------------------------------------------------------

/**
 * @param {object} io
 * @param {() => any | Promise<any>} io.read     returns persisted tracker state (any shape; normalised)
 * @param {(state) => any}           io.write    persists a new state. Only called when a mutation
 *                                               actually changed something.
 * @param {() => number}            [io.now]
 * @param {() => string[]}          [io.allowedStatuses]   the pipeline stages the HUMAN board shows
 * @param {() => string[]}          [io.knownProjects]
 * @param {() => string[]|Set}      [io.knownSessionIds]   omit entirely to get verified:null ("not checked")
 * @returns {{tracker_create, tracker_update, tracker_list, tracker_link_session, schemas}}
 *
 * Every handler is async, returns the same envelope the pure function does, and NEVER throws — a
 * store that is missing, locked or holding corrupt JSON becomes `{ok:false, error:'store_read_failed',
 * reason}`, because an exception inside a tool handler reaches the model as an opaque failure and its
 * next move is to retry the identical call.
 */
export function createTracker(io = {}) {
  const readState = async () => {
    if (typeof io.read !== 'function') return { ok: false, result: fail('store_unavailable', 'no read() was injected into createTracker — the tracker has no store to work against and refuses to pretend the board is empty') }
    try { return { ok: true, state: await io.read() } } catch (e) { return { ok: false, result: fail('store_read_failed', `could not read the tracker store: ${e?.message || e}. Nothing was read, so nothing is being reported as absent.`) } }
  }
  const opts = () => ({
    now: io.now ? io.now() : Date.now(),
    allowedStatuses: io.allowedStatuses ? io.allowedStatuses() : undefined,
    knownProjects: io.knownProjects ? io.knownProjects() : undefined,
    // Deliberately absent (not []) when no provider is injected: [] would mean "checked, not found",
    // a different and stronger claim than "not checked".
    ...(io.knownSessionIds ? { knownSessionIds: io.knownSessionIds() } : {}),
  })
  const persist = async (r, before) => {
    // Only write when something moved. A write on a no-op read-modify-write races other writers for
    // no benefit, and on a file-backed store it rewrites the file on every list-shaped call.
    if (!r.ok || !r.state || r.state === before || r.noop) return r
    if (typeof io.write !== 'function') return { ...r, persisted: false, reason: `${r.reason || ''} — WARNING: no write() was injected, so this change exists only in the returned state and was NOT persisted`.trim() }
    try { await io.write(r.state); return { ...r, persisted: true } } catch (e) {
      // The in-memory result is now a lie about the board. Say so rather than returning ok:true.
      return fail('store_write_failed', `the change was computed but could NOT be persisted: ${e?.message || e}. Treat this as not applied.`, { changed: r.changed || [], item: r.item || null, persisted: false })
    }
  }
  const run = fn => async input => {
    const rd = await readState()
    if (!rd.ok) return rd.result
    let r
    try { r = fn(rd.state, input, opts()) } catch (e) {
      // Defence in depth: the pure functions are written not to throw, and this makes that
      // guarantee hold even if a future edit breaks it.
      return fail('tracker_internal_error', `the tracker failed internally and wrote nothing: ${e?.message || e}`)
    }
    return persist(r, rd.state)
  }
  return {
    tracker_create: run(trackerCreate),
    tracker_update: run(trackerUpdate),
    tracker_link_session: run(trackerLinkSession),
    // list never writes; it also never needs a persist round-trip.
    tracker_list: async query => {
      const rd = await readState()
      if (!rd.ok) return rd.result
      try { return trackerList(rd.state, query, opts()) } catch (e) { return fail('tracker_internal_error', `the tracker failed internally: ${e?.message || e}`) }
    },
    schemas: () => trackerToolSchemas(io.allowedStatuses ? io.allowedStatuses() : TRACKER_STATUSES),
  }
}

// ---------------------------------------------------------------------------
// tool schema — generated from the same constants the validators use, so the description a model
// reads can never drift from the rules it is judged by (drift here is the #1 source of "the model
// keeps passing an invalid status").
// ---------------------------------------------------------------------------
export const trackerToolSchemas = (allowedStatuses = TRACKER_STATUSES) => ([
  {
    name: 'tracker_create',
    description: `Create a board item. Statuses: ${allowedStatuses.join(' | ')}. title is capped at ${LIMITS.title} chars, notes at ${LIMITS.notes} (truncation is reported back). Omitting project leaves the item unscoped — it will not appear under any project filter.`,
    input: { title: 'string (required)', notes: 'string', status: allowedStatuses, type: TRACKER_TYPES, project: 'string absolute repo path', tags: `string[] (max ${LIMITS.tags})`, parent: 'item id' },
  },
  {
    name: 'tracker_update',
    description: `Update an existing item. REQUIRES expectedVersion (from tracker_list); a mismatch returns version_conflict naming both versions and writes nothing. Never creates: an unknown id fails.`,
    input: { id: 'item id (required)', expectedVersion: 'integer (required)', ...Object.fromEntries(UPDATABLE.map(f => [f, 'optional'])) },
  },
  {
    name: 'tracker_list',
    description: `List items. Returns total (pre-paging) plus returned/offset/limit; page cap ${LIMITS.listPageMax}. An unknown status filter is rejected and the reply names the allowed set.`,
    input: { status: `${allowedStatuses.join(' | ')} or array`, project: 'string, or null for unscoped-only', type: TRACKER_TYPES, text: 'substring over title/notes/tags', sessionId: 'string', limit: 'integer', offset: 'integer' },
  },
  {
    name: 'tracker_link_session',
    description: `Link an item to the session that worked it. A session id not present in the session index is recorded as UNVERIFIED (verified:false) rather than rejected or trusted; with no index available, verified is null ("not checked"). Max ${LIMITS.links} links per item, oldest dropped with a report.`,
    input: { id: 'item id (required)', sessionId: 'string (required)', role: 'string e.g. dev|review|qa', note: `string (capped ${LIMITS.reason})` },
  },
])
