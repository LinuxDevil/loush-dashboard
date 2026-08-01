
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

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
export const stepStatus = (id, delta) =>
  STATUS_IDS[Math.min(STATUS_IDS.length - 1, Math.max(0, statusIndex(id) + delta))]

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

const pad = n => String(n).padStart(2, '0')
export const dayKey = (d = new Date()) => {
  const x = d instanceof Date ? d : new Date(d)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}
export const isDayKey = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
export const dayStart = key => {
  const [y, m, d] = String(key).split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}
export const dayEnd = key => dayStart(key) + 86_400_000
export const shiftDay = (key, days) => dayKey(new Date(dayStart(key) + days * 86_400_000))
export function humanDay(key, today = dayKey()) {
  if (!isDayKey(key)) return key
  if (key === today) return 'today'
  if (key === shiftDay(today, -1)) return 'yesterday'
  if (key === shiftDay(today, 1)) return 'tomorrow'
  const d = new Date(dayStart(key))
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
export const dottedDay = key => {
  if (!isDayKey(key)) return key
  const [y, m, d] = key.split('-').map(Number)
  return `${d}.${m}.${y}`
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

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
    evidence: input.evidence && typeof input.evidence === 'object' ? input.evidence : null,
    jira: input.jira && input.jira.key ? { key: String(input.jira.key), url: input.jira.url || null, host: input.jira.host || null, linkedAt: now } : null,
    firstDate: date,
    rollovers: 0,
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
  if (patch.jira !== undefined) {
    t.jira = patch.jira && patch.jira.key
      ? { key: String(patch.jira.key), url: patch.jira.url || null, host: patch.jira.host || null, linkedAt: t.jira?.linkedAt || now }
      : null
  }
  if (t.firstDate === undefined) t.firstDate = todo.date || t.date

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

export function progressOf(todo) {
  const subs = todo?.subtasks || []
  const done = subs.filter(s => s.done).length
  return { done, total: subs.length, pct: subs.length ? Math.round((done / subs.length) * 100) : null }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

export const statusCounts = (todos = []) => {
  const out = Object.fromEntries(STATUS_IDS.map(s => [s, 0]))
  for (const t of todos) if (out[t.status] !== undefined) out[t.status]++
  return out
}

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
    } else d.todos.push(t)
  }
  const out = [...dirs.values()]
    .map(d => ({ ...d, files: [...d.files.values()].sort((a, b) => a.file.localeCompare(b.file)) }))
    .sort((a, b) => a.dir.localeCompare(b.dir))
  return { dirs: out, loose }
}

// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

/**
 * Move every UNFINISHED todo dated before `today` onto `today`.
 *
 * WHY IT MOVES RATHER THAN COPIES
 * A to-do that is still open is one piece of work, not one per day it survived. Copying it would
 * inflate every count that matters (created, open, completion rate) by the number of days you failed
 * to finish it, and the day it was actually started would stop being findable.
 *
 * WHAT IS KEPT SO THE MOVE IS NOT A LIE
 *   firstDate  the day it was originally filed for — never changes
 *   rollovers  how many times it has been moved
 *   history    one `kind:'rollover'` entry per move, with the dates
 * so the card can say "carried for 4 days, since 24.7" instead of pretending it was written today.
 *
 * Finished todos never move: they are the record of the day they were finished on.
 * Pure: returns a NEW array plus what changed, and the caller decides whether to persist.
 */
export function rollForward(todos = [], today = dayKey(), now = Date.now()) {
  if (!isDayKey(today)) return { todos, moved: [], changed: false }
  const moved = []
  const next = todos.map(t => {
    if (t.done || !isDayKey(t.date) || t.date >= today) return t
    const from = t.date
    const rolled = {
      ...t,
      date: today,
      firstDate: t.firstDate || from,
      rollovers: (t.rollovers || 0) + 1,
      updatedAt: now,
      history: [...(t.history || []), { at: now, kind: 'rollover', fromDate: from, toDate: today }],
    }
    moved.push({ id: rolled.id, title: rolled.title, from, to: today, rollovers: rolled.rollovers })
    return rolled
  })
  return { todos: next, moved, changed: moved.length > 0 }
}

export const carriedDays = (todo, today = dayKey()) => {
  const first = isDayKey(todo?.firstDate) ? todo.firstDate : todo?.date
  if (!isDayKey(first) || !isDayKey(today)) return 0
  return Math.max(0, Math.round((dayStart(today) - dayStart(first)) / 86_400_000))
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

/**
 * The stage timeline: one interval per stage the todo has sat in, in order.
 *
 * The clock STOPS at doneAt. A finished todo that has been sitting in the store for a month did not
 * spend a month in Manual QA, and letting `now` run on would make every historical average grow just
 * because time passed.
 */
export function stageIntervals(todo, now = Date.now()) {
  if (!todo) return []
  const end = todo.done && todo.doneAt ? todo.doneAt : now
  const hist = (todo.history || []).filter(h => h && typeof h.at === 'number')
  const first = hist.find(h => isStatus(h.to))
  let cursor = todo.createdAt ?? first?.at ?? end
  let cur = first?.to || todo.status || DEFAULT_STATUS
  const out = []
  for (const h of hist) {
    if (h === first || !isStatus(h.to)) continue
    if (h.at < cursor) continue
    out.push({ status: cur, from: cursor, to: h.at })
    cursor = h.at
    cur = h.to
  }
  out.push({ status: cur, from: cursor, to: Math.max(cursor, end), open: !(todo.done && todo.doneAt) })
  return out
}

/**
 * Time per stage for ONE todo, optionally clipped to [from, to).
 *
 * Clipping is what makes a monthly view mean "time spent in each column DURING that month" rather
 * than "total time of every todo that happens to touch the month", which double-counts a two-month
 * ticket into both.
 */
export function stageDurations(todo, { from = -Infinity, to = Infinity, now = Date.now() } = {}) {
  const by = {}
  let total = 0
  for (const iv of stageIntervals(todo, now)) {
    const a = Math.max(iv.from, from), b = Math.min(iv.to, to)
    const ms = b - a
    if (ms <= 0) continue
    by[iv.status] = (by[iv.status] || 0) + ms
    total += ms
  }
  return { byStatus: by, total }
}

export function timeInStages(todo, now = Date.now()) {
  const ivs = stageIntervals(todo, now)
  const { byStatus, total } = stageDurations(todo, { now })
  const last = ivs[ivs.length - 1]
  const created = todo?.createdAt ?? null
  const doneAt = todo?.done ? todo?.doneAt ?? null : null
  return {
    byStatus,
    total,
    ordered: STATUS_IDS.filter(s => byStatus[s] > 0).map(s => ({ status: s, ms: byStatus[s], pct: total ? Math.round((byStatus[s] / total) * 100) : 0 })),
    current: last ? { status: last.status, ms: last.to - last.from, open: !!last.open } : null,
    leadMs: doneAt && created != null ? doneAt - created : null,
    ageMs: created != null ? (doneAt || now) - created : null,
  }
}

export function humanMs(ms) {
  if (ms == null || !isFinite(ms)) return '—'
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '')
  const d = Math.floor(h / 24)
  return d + 'd' + (h % 24 ? ' ' + (h % 24) + 'h' : '')
}

export const median = xs => {
  const a = xs.filter(x => typeof x === 'number' && isFinite(x)).sort((p, q) => p - q)
  if (!a.length) return null
  const i = Math.floor(a.length / 2)
  return a.length % 2 ? a[i] : Math.round((a[i - 1] + a[i]) / 2)
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

export const PERIODS = ['day', 'week', 'month']

export function periodRange(period, date = dayKey()) {
  const anchor = isDayKey(date) ? date : dayKey()
  const d = new Date(dayStart(anchor))
  if (period === 'week') {
    const dow = (d.getDay() + 6) % 7
    const from = shiftDay(anchor, -dow)
    return { period, from, to: shiftDay(from, 7), days: 7, label: `week of ${dottedDay(from)}` }
  }
  if (period === 'month') {
    const from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
    const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    const to = dayKey(nextMonth)
    return { period, from, to, days: Math.round((dayStart(to) - dayStart(from)) / 86_400_000), label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }
  }
  return { period: 'day', from: anchor, to: shiftDay(anchor, 1), days: 1, label: dottedDay(anchor) }
}

/**
 * Everything the insights panel shows, computed from the store alone.
 *
 * HONESTY RULES THIS FUNCTION FOLLOWS
 *   * `completionRate` is null when nothing was created in the window — 0% would read as failure
 *     where the truth is "no data".
 *   * per-stage time is CLIPPED to the window, and each stage carries the `n` of todos that
 *     contributed, so a 6-day median built from one todo is visibly built from one todo.
 *   * lead time averages completed work only (see timeInStages).
 *   * `bottleneck` is the stage with the most accrued time in the window, and is null below a
 *     minimum sample rather than crowning a stage on the strength of a single card.
 */
export function insights(todos = [], { period = 'day', date = dayKey(), now = Date.now(), minSample = 2 } = {}) {
  const range = periodRange(PERIODS.includes(period) ? period : 'day', date)
  const from = dayStart(range.from), to = dayStart(range.to)
  const inWin = t => (t.createdAt ?? 0) < to && ((t.done && t.doneAt ? t.doneAt : now) >= from)

  const created = todos.filter(t => t.createdAt >= from && t.createdAt < to)
  const completed = todos.filter(t => t.done && t.doneAt >= from && t.doneAt < to)
  const active = todos.filter(inWin)
  const openNow = todos.filter(t => !t.done && (t.createdAt ?? 0) < to)

  const perStage = Object.fromEntries(STATUS_IDS.map(s => [s, { status: s, totalMs: 0, n: 0, samples: [] }]))
  for (const t of active) {
    const { byStatus } = stageDurations(t, { from, to, now })
    for (const [s, ms] of Object.entries(byStatus)) {
      if (!perStage[s] || ms <= 0) continue
      perStage[s].totalMs += ms
      perStage[s].n++
      perStage[s].samples.push(ms)
    }
  }
  const stages = STATUS_IDS.map(s => {
    const x = perStage[s]
    return { status: s, totalMs: x.totalMs, n: x.n, avgMs: x.n ? Math.round(x.totalMs / x.n) : null, medianMs: median(x.samples) }
  })
  const ranked = [...stages].filter(s => s.n >= minSample).sort((a, b) => b.totalMs - a.totalMs)
  const bottleneck = ranked.length ? ranked[0] : null

  const buckets = []
  if (range.period === 'day') {
    for (let h = 0; h < 24; h++) {
      const a = from + h * 3_600_000, b = a + 3_600_000
      buckets.push({
        key: String(h).padStart(2, '0'),
        created: todos.filter(t => t.createdAt >= a && t.createdAt < b).length,
        completed: todos.filter(t => t.done && t.doneAt >= a && t.doneAt < b).length,
      })
    }
  } else {
    for (let i = 0; i < range.days; i++) {
      const day = shiftDay(range.from, i)
      const a = dayStart(day), b = a + 86_400_000
      buckets.push({
        key: day,
        label: String(new Date(a).getDate()),
        created: todos.filter(t => t.createdAt >= a && t.createdAt < b).length,
        completed: todos.filter(t => t.done && t.doneAt >= a && t.doneAt < b).length,
      })
    }
  }

  const rolls = todos.reduce((n, t) => n + (t.history || []).filter(h => h.kind === 'rollover' && h.at >= from && h.at < to).length, 0)
  const asOf = dayKey(new Date(Math.min(now, to - 1)))
  const aging = openNow
    .map(t => ({ id: t.id, title: t.title, status: t.status, days: carriedDays(t, asOf), rollovers: t.rollovers || 0, jira: t.jira?.key || null }))
    .filter(t => t.days > 0)
    .sort((a, b) => b.days - a.days)
    .slice(0, 10)

  const byDir = new Map()
  for (const t of active) {
    if (!t.dir) continue
    const x = byDir.get(t.dir) || { dir: t.dir, total: 0, open: 0, done: 0 }
    x.total++; t.done ? x.done++ : x.open++
    byDir.set(t.dir, x)
  }

  const byJira = new Map()
  for (const t of active) {
    if (!t.jira?.key) continue
    const x = byJira.get(t.jira.key) || { key: t.jira.key, url: t.jira.url || null, total: 0, open: 0, done: 0, msByStage: {} }
    x.total++; t.done ? x.done++ : x.open++
    const { byStatus } = stageDurations(t, { from, to, now })
    for (const [s, ms] of Object.entries(byStatus)) x.msByStage[s] = (x.msByStage[s] || 0) + ms
    byJira.set(t.jira.key, x)
  }

  const leads = completed.map(t => timeInStages(t, now).leadMs).filter(x => x != null)
  return {
    range,
    counts: {
      created: created.length,
      completed: completed.length,
      active: active.length,
      open: openNow.filter(t => !t.done).length,
      rollovers: rolls,
      linkedToJira: active.filter(t => t.jira?.key).length,
    },
    completionRate: created.length ? Math.round((completed.length / created.length) * 100) : null,
    leadTime: { n: leads.length, medianMs: median(leads), avgMs: leads.length ? Math.round(leads.reduce((a, b) => a + b, 0) / leads.length) : null },
    stages,
    bottleneck,
    minSample,
    series: buckets,
    aging,
    byDir: [...byDir.values()].sort((a, b) => b.open - a.open || b.total - a.total).slice(0, 10),
    byJira: [...byJira.values()].sort((a, b) => b.total - a.total).slice(0, 20),
    empty: active.length === 0 && created.length === 0,
  }
}
