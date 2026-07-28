// lib/todos.mjs — the delivery-stage TODO model, shared by the server route and the React UI.
//
// WHY THIS IS A LIB AND NOT INLINE IN THE ROUTE
// Three consumers need the SAME answer to "what stage is this in", "what day does it belong to" and
// "which directory does it hang under": the Express route (writes), the full-screen Todos section
// (board + tree), and the floating drawer (quick capture). Two of those live in the browser. When the
// stage list was duplicated, a rename in one place silently produced todos the other consumer filed
// under an unknown column and dropped from every count. So the model lives here, is pure, has no fs
// and no React, and is imported by all three. Vite resolves this file for the client the same way
// node does for the server — plain ESM, no build step, no duplication.
//
// DATE SCOPING IS LOCAL, DELIBERATELY
// A todo belongs to the day the human was working, not to a UTC instant. `2025-07-28` at 01:00 in
// UTC+3 is still the 28th to the person who typed it, and `toISOString().slice(0,10)` would file it
// under the 27th. Every key in this module is built from local getFullYear/getMonth/getDate.

// ---------------------------------------------------------------------------
// stages
// ---------------------------------------------------------------------------

// The pipeline the user asked for, in order. `id` is what is persisted (stable, kebab-case), `label`
// is the only thing rendered, and `color` is a token name — never a hex, or the light theme breaks.
export const STATUSES = [
  { id: 'draft', label: 'Draft', short: 'DRF', color: 'var(--text-secondary)', hint: 'captured, not started' },
  { id: 'in-progress', label: 'In progress', short: 'WIP', color: 'var(--blue)', hint: 'being worked on right now' },
  { id: 'code-review', label: 'Code review', short: 'CR', color: 'var(--violet)', hint: 'waiting on a reviewer' },
  { id: 'design-qa', label: 'Design QA', short: 'DQA', color: 'var(--pink)', hint: 'design sign-off' },
  { id: 'manual-qa', label: 'Manual QA', short: 'MQA', color: 'var(--orange)', hint: 'tester sign-off' },
  { id: 'ready-for-release', label: 'Ready for release', short: 'RFR', color: 'var(--amber)', hint: 'merged, waiting to ship' },
  { id: 'live', label: 'Live', short: 'LIVE', color: 'var(--green)', hint: 'shipped to users' },
]
export const STATUS_IDS = STATUSES.map(s => s.id)
export const TERMINAL_STATUS = 'live'
export const DEFAULT_STATUS = 'draft'
export const statusMeta = id => STATUSES.find(s => s.id === id) || STATUSES[0]
export const isStatus = id => STATUS_IDS.includes(id)
export const statusIndex = id => Math.max(0, STATUS_IDS.indexOf(id))
/** Neighbouring stage, clamped. Powers the ‹ › buttons on a card. Returns the same id at the ends. */
export const stepStatus = (id, delta) =>
  STATUS_IDS[Math.min(STATUS_IDS.length - 1, Math.max(0, statusIndex(id) + delta))]

// ---------------------------------------------------------------------------
// day keys (local, never UTC — see header)
// ---------------------------------------------------------------------------

const pad = n => String(n).padStart(2, '0')
export const dayKey = (d = new Date()) => {
  const x = d instanceof Date ? d : new Date(d)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}
export const isDayKey = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
/** Midnight local for a key — the anchor for "which edits happened on this day". */
export const dayStart = key => {
  const [y, m, d] = String(key).split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}
export const dayEnd = key => dayStart(key) + 86_400_000
export const shiftDay = (key, days) => dayKey(new Date(dayStart(key) + days * 86_400_000))
/** "today" / "yesterday" / "Mon 28 Jul" — the label above the board. */
export function humanDay(key, today = dayKey()) {
  if (!isDayKey(key)) return key
  if (key === today) return 'today'
  if (key === shiftDay(today, -1)) return 'yesterday'
  if (key === shiftDay(today, 1)) return 'tomorrow'
  const d = new Date(dayStart(key))
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
/** 28.7.2025 — the format the request was written in, used as the secondary label. */
export const dottedDay = key => {
  if (!isDayKey(key)) return key
  const [y, m, d] = key.split('-').map(Number)
  return `${d}.${m}.${y}`
}

// ---------------------------------------------------------------------------
// paths — the "sub directory / sub file" axis
// ---------------------------------------------------------------------------

/** POSIX-normalised repo-relative path. Absolute paths and `..` escapes are rejected, not clamped. */
export function normalizeRel(p) {
  const s = String(p || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
  if (!s) return null
  if (s.split('/').includes('..')) return null
  return s
}
export const dirOfRel = rel => {
  const r = normalizeRel(rel)
  if (!r) return null
  const i = r.lastIndexOf('/')
  return i === -1 ? '.' : r.slice(0, i)
}
export const baseOfRel = rel => String(rel || '').split('/').pop()

// ---------------------------------------------------------------------------
// records
// ---------------------------------------------------------------------------

const uid = (seed = '') => 'td' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + seed
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * Build a stored todo from untrusted input. Unknown stages fall back to `draft` rather than 400-ing
 * the whole request: the point of the quick-capture drawer is that a typed line never gets lost.
 * `file` implies `dir`, so a todo attached to a file always sorts under its directory in the tree.
 */
export function normalizeTodo(input = {}, now = Date.now()) {
  const title = clean(input.title, 200)
  if (!title) throw new Error('title is required')
  const file = normalizeRel(input.file)
  const dir = file ? dirOfRel(file) : (normalizeRel(input.dir) || null)
  const status = isStatus(input.status) ? input.status : DEFAULT_STATUS
  const date = isDayKey(input.date) ? input.date : dayKey(new Date(now))
  return {
    id: input.id || uid(),
    title,
    notes: String(input.notes ?? '').slice(0, 4000),
    status,
    date,
    done: status === TERMINAL_STATUS ? true : !!input.done,
    doneAt: input.done || status === TERMINAL_STATUS ? now : null,
    root: input.root ? String(input.root) : null,
    dir,
    file,
    tags: Array.isArray(input.tags) ? input.tags.map(t => clean(t, 30)).filter(Boolean).slice(0, 8) : [],
    subtasks: (Array.isArray(input.subtasks) ? input.subtasks : [])
      .map(s => ({ id: s.id || uid('s'), title: clean(s.title, 200), done: !!s.done }))
      .filter(s => s.title).slice(0, 50),
    source: input.source === 'workingset' ? 'workingset' : 'manual',
    // Why this row was suggested — edit counts and failures from the transcripts, kept with the todo
    // so the card can show its own evidence instead of asking the user to trust a ranking.
    evidence: input.evidence && typeof input.evidence === 'object' ? input.evidence : null,
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, from: null, to: status, note: 'created' }],
  }
}

/**
 * Mutate-by-copy. Returns a NEW todo — callers write the whole array back, so no aliasing surprises.
 *
 * The done↔stage coupling, stated once so both clients agree:
 *   * ticking the box completes the item and does NOT move it — a draft you decided was handled is a
 *     legitimate state, and silently promoting it to Live would claim something shipped that did not.
 *   * moving a todo TO `live` ticks the box: shipped is done, and leaving it unchecked makes the day's
 *     "n of m done" count lie.
 *   * un-ticking a `live` todo walks it back one stage, because `live && !done` is not a real state.
 */
export function applyPatch(todo, patch = {}, now = Date.now()) {
  const t = { ...todo, subtasks: (todo.subtasks || []).map(s => ({ ...s })), history: [...(todo.history || [])] }
  if (patch.title !== undefined) { const v = clean(patch.title, 200); if (v) t.title = v }
  if (patch.notes !== undefined) t.notes = String(patch.notes ?? '').slice(0, 4000)
  if (patch.date !== undefined && isDayKey(patch.date)) t.date = patch.date
  if (patch.root !== undefined) t.root = patch.root ? String(patch.root) : null
  if (patch.file !== undefined) {
    t.file = normalizeRel(patch.file)
    if (t.file) t.dir = dirOfRel(t.file)
  }
  if (patch.dir !== undefined && patch.file === undefined) t.dir = normalizeRel(patch.dir)
  if (Array.isArray(patch.tags)) t.tags = patch.tags.map(x => clean(x, 30)).filter(Boolean).slice(0, 8)

  if (patch.status !== undefined && isStatus(patch.status) && patch.status !== t.status) {
    t.history.push({ at: now, from: t.status, to: patch.status, note: patch.note || '' })
    t.status = patch.status
    if (patch.status === TERMINAL_STATUS) { t.done = true; t.doneAt = t.doneAt || now }
  }
  if (patch.done !== undefined) {
    const done = !!patch.done
    if (done !== t.done) {
      t.done = done
      t.doneAt = done ? now : null
      if (!done && t.status === TERMINAL_STATUS) {
        const back = stepStatus(TERMINAL_STATUS, -1)
        t.history.push({ at: now, from: t.status, to: back, note: 'un-checked' })
        t.status = back
      }
    }
  }

  if (patch.subtaskAdd) {
    const title = clean(patch.subtaskAdd, 200)
    if (title && t.subtasks.length < 50) t.subtasks.push({ id: uid('s'), title, done: false })
  }
  if (patch.subtaskToggle) {
    const s = t.subtasks.find(x => x.id === patch.subtaskToggle)
    if (s) s.done = patch.subtaskDone === undefined ? !s.done : !!patch.subtaskDone
  }
  if (patch.subtaskRemove) t.subtasks = t.subtasks.filter(x => x.id !== patch.subtaskRemove)
  if (Array.isArray(patch.subtasks)) {
    t.subtasks = patch.subtasks
      .map(s => ({ id: s.id || uid('s'), title: clean(s.title, 200), done: !!s.done }))
      .filter(s => s.title).slice(0, 50)
  }
  t.updatedAt = now
  return t
}

/** Sub-task completion. `total: 0` renders as "—", never as 0% — a todo with no sub-tasks is not 0% done. */
export function progressOf(todo) {
  const subs = todo?.subtasks || []
  const done = subs.filter(s => s.done).length
  return { done, total: subs.length, pct: subs.length ? Math.round((done / subs.length) * 100) : null }
}

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------

export const statusCounts = (todos = []) => {
  const out = Object.fromEntries(STATUS_IDS.map(s => [s, 0]))
  for (const t of todos) if (out[t.status] !== undefined) out[t.status]++
  return out
}

/** Everything the day header needs: how many, how many ticked, how many still unfinished. */
export function dayStats(todos = []) {
  const done = todos.filter(t => t.done).length
  return { total: todos.length, done, open: todos.length - done, byStatus: statusCounts(todos) }
}

/**
 * Split the store around the selected day.
 *   onDate  — the day's list
 *   carry   — UNFINISHED todos from earlier days. A date-scoped list that simply hides yesterday's
 *             unfinished work is a to-do app that loses to-dos, so these surface with a "pull to
 *             this day" action instead of vanishing.
 *   later   — todos already filed for a future day, counted only (so the header can say "3 ahead").
 */
export function partitionByDate(todos = [], date) {
  const onDate = [], carry = [], later = []
  for (const t of todos) {
    if (t.date === date) onDate.push(t)
    else if (t.date < date) { if (!t.done) carry.push(t) }
    else later.push(t)
  }
  carry.sort((a, b) => (a.date < b.date ? 1 : -1) || statusIndex(b.status) - statusIndex(a.status))
  return { onDate, carry, later }
}

/**
 * The tree the request asked for: directory → file → todos, with everything unattached kept in a
 * visible "no file" bucket rather than dropped. Sorted by path so the shape matches the repo.
 */
export function groupByPath(todos = []) {
  const dirs = new Map()
  const loose = []
  for (const t of todos) {
    if (!t.dir && !t.file) { loose.push(t); continue }
    const dir = t.dir || dirOfRel(t.file) || '.'
    let d = dirs.get(dir)
    if (!d) dirs.set(dir, d = { dir, files: new Map(), todos: [], count: 0, done: 0 })
    d.count++
    if (t.done) d.done++
    if (t.file) {
      let f = d.files.get(t.file)
      if (!f) d.files.set(t.file, f = { file: t.file, name: baseOfRel(t.file), todos: [], count: 0, done: 0 })
      f.todos.push(t); f.count++; if (t.done) f.done++
    } else d.todos.push(t) // attached to the directory itself, not to one file
  }
  const out = [...dirs.values()]
    .map(d => ({ ...d, files: [...d.files.values()].sort((a, b) => a.file.localeCompare(b.file)) }))
    .sort((a, b) => a.dir.localeCompare(b.dir))
  return { dirs: out, loose }
}

// ---------------------------------------------------------------------------
// suggestions — the join to real data
// ---------------------------------------------------------------------------

/**
 * What did the agent actually touch on this day, in this repo? Built from transcript edits and tool
 * errors, grouped the same directory → file way the board groups todos, so "add as todo" produces a
 * row that is already filed in the right place.
 *
 * edits:  [{t, file(abs), add, del, sessionId}]  errors: [{t, file(abs), tool, text}]
 * Returns null-free rows; a day with no edits returns an empty list, and the caller says so in words
 * rather than rendering an empty board as if there were nothing to do.
 */
export function suggestFromActivity({ edits = [], errors = [], root, date, existing = [] }) {
  if (!root || !isDayKey(date)) return { dirs: [], files: 0, edits: 0 }
  const from = dayStart(date), to = dayEnd(date)
  const sep = root.endsWith('/') || root.endsWith('\\') ? '' : '/'
  const prefix = root + sep
  const relOf = abs => {
    const p = String(abs || '').replace(/\\/g, '/')
    const pre = prefix.replace(/\\/g, '/')
    return p.startsWith(pre) ? p.slice(pre.length) : null
  }
  const taken = new Set(existing.filter(t => t.file && (!t.root || t.root === root)).map(t => t.file))
  const rows = new Map()
  let total = 0
  for (const e of edits) {
    if (!e.t || e.t < from || e.t >= to) continue
    const rel = relOf(e.file)
    if (!rel) continue
    total++
    let r = rows.get(rel)
    if (!r) rows.set(rel, r = { file: rel, dir: dirOfRel(rel), name: baseOfRel(rel), edits: 0, add: 0, del: 0, failures: 0, sessions: new Set(), lastT: 0, errSamples: [] })
    r.edits++
    r.add += e.add || 0
    r.del += e.del || 0
    if (e.sessionId) r.sessions.add(e.sessionId)
    r.lastT = Math.max(r.lastT, e.t)
  }
  for (const er of errors) {
    if (!er.t || er.t < from || er.t >= to) continue
    const rel = relOf(er.file)
    const r = rel && rows.get(rel)
    if (!r) continue
    r.failures++
    if (r.errSamples.length < 3) r.errSamples.push({ tool: er.tool || null, text: String(er.text || '').slice(0, 200) })
  }
  const dirs = new Map()
  for (const r of rows.values()) {
    const row = { ...r, sessions: r.sessions.size, hasTodo: taken.has(r.file) }
    let d = dirs.get(r.dir)
    if (!d) dirs.set(r.dir, d = { dir: r.dir, files: [], edits: 0, failures: 0 })
    d.files.push(row); d.edits += row.edits; d.failures += row.failures
  }
  const out = [...dirs.values()]
    .map(d => ({ ...d, files: d.files.sort((a, b) => b.edits - a.edits || a.file.localeCompare(b.file)) }))
    .sort((a, b) => b.edits - a.edits || a.dir.localeCompare(b.dir))
  return { dirs: out, files: rows.size, edits: total }
}
