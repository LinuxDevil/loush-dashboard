
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  STATUSES, STATUS_IDS, PERIODS, isStatus, dayKey, isDayKey, dayStart, dayEnd,
  normalizeTodo, applyPatch, partitionByDate, dayStats, groupByPath, suggestFromActivity, normalizeRel,
  rollForward, insights, timeInStages, carriedDays,
} from '../lib/todos.mjs'
import { normalizeKey } from './ticket.mjs'
import { loadEngConfig } from '../lib/eng-config.mjs'
import { PROJECTS_FILE } from '../lib/paths.mjs'

const STORE = path.join(os.homedir(), '.claude', 'dashboard-todos.json')
const DEFAULT_SETTINGS = { rollover: true }

const readStore = () => {
  try {
    const j = JSON.parse(fs.readFileSync(STORE, 'utf8'))
    return {
      version: 1,
      todos: Array.isArray(j.todos) ? j.todos : [],
      settings: { ...DEFAULT_SETTINGS, ...(j.settings || {}) },
      lastRollover: typeof j.lastRollover === 'string' ? j.lastRollover : null,
    }
  } catch { return { version: 1, todos: [], settings: { ...DEFAULT_SETTINGS }, lastRollover: null } }
}

/**
 * Resolve the browse URL for a JIRA key from the CONFIGURED host — the per-board host when the key's
 * prefix matches a configured board, the global one otherwise. No host configured means `url: null`,
 * and the UI says so: a link built from a guessed hostname 404s, which is worse than a plain key.
 */
function jiraFor(key) {
  let cfg
  try { cfg = loadEngConfig(PROJECTS_FILE) } catch { cfg = { jiraHost: null, projects: [] } }
  const prefix = String(key).split('-')[0].toUpperCase()
  const proj = (cfg.projects || []).find(p => String(p.jiraProjectKey || p.key || '').toUpperCase() === prefix)
  const host = proj?.jiraHost || cfg.jiraHost || null
  return { key, host, url: host ? `https://${host}/browse/${key}` : null }
}

function jiraConfig() {
  let cfg
  try { cfg = loadEngConfig(PROJECTS_FILE) } catch { cfg = { jiraHost: null, projects: [] } }
  const prefixes = [...new Set((cfg.projects || []).map(p => String(p.jiraProjectKey || p.key || '').toUpperCase()).filter(Boolean))]
  return { host: cfg.jiraHost || null, prefixes, configured: !!(cfg.jiraHost || prefixes.length) }
}

export default function mountTodos(app, deps = {}) {
  const { scanTranscripts, failStats, track, backup } = deps

  const writeStore = (store, summary) => {
    const body = JSON.stringify(store, null, 2)
    fs.mkdirSync(path.dirname(STORE), { recursive: true })
    if (typeof track === 'function') { track(STORE, body, { summary }); return }
    if (typeof backup === 'function') { try { backup(STORE) } catch {} }
    fs.writeFileSync(STORE, body)
  }

  const roots = () => {
    if (typeof scanTranscripts !== 'function') return []
    const all = scanTranscripts()
    const byRoot = new Map()
    const dirs = [...new Set(all.sessions.map(s => s.cwd).filter(Boolean))]
      .filter(c => { try { return fs.statSync(c).isDirectory() } catch { return false } })
      .sort((a, b) => b.length - a.length)
    for (const e of all.edits) {
      if (!e.file || !path.isAbsolute(e.file)) continue
      const root = dirs.find(r => e.file.startsWith(r + path.sep))
      if (!root) continue
      const x = byRoot.get(root) || { root, name: path.basename(root), edits: 0, lastT: 0 }
      x.edits++; x.lastT = Math.max(x.lastT, e.t || 0)
      byRoot.set(root, x)
    }
    return [...byRoot.values()].sort((a, b) => b.lastT - a.lastT).slice(0, 20)
  }

  const activity = () => {
    if (typeof scanTranscripts !== 'function') return { edits: [], errors: [] }
    const all = scanTranscripts()
    const errors = []
    if (typeof failStats === 'function') {
      for (const rec of failStats()) for (const er of rec.errs || []) {
        if (er.file && path.isAbsolute(er.file)) errors.push({ ...er, sessionId: rec.sessionId })
      }
    }
    return { edits: all.edits.filter(e => e.file && path.isAbsolute(e.file)), errors }
  }

  const dateOf = req => (isDayKey(req.query.date) ? req.query.date : dayKey())

  /**
   * Carry unfinished work onto today, at most once per calendar day.
   *
   * Guarded by `lastRollover` rather than run per request: this is a WRITE, and a write that fires on
   * every read of a polled endpoint would rewrite the store several times a minute and bury the
   * versioned history under noise. Reading a PAST day never triggers it either — the trigger is the
   * calendar advancing, not which day you happen to be looking at.
   */
  const maybeRollover = () => {
    const store = readStore()
    const today = dayKey()
    if (!store.settings.rollover || store.lastRollover === today) return store
    const { todos, moved, changed } = rollForward(store.todos, today)
    store.todos = todos
    store.lastRollover = today
    writeStore(store, changed ? `todos rolled forward to ${today}: ${moved.length}` : `todo roll-over checked for ${today}`)
    if (changed) console.log(`[claude-dashboard] rolled ${moved.length} unfinished todo(s) forward to ${today}`)
    return store
  }

  // ---------------- read ----------------

  app.get('/api/todos', (req, res) => {
    try {
      const date = dateOf(req)
      const store = maybeRollover()
      const rootFilter = req.query.root ? String(req.query.root) : null
      const scoped = rootFilter ? store.todos.filter(t => !t.root || t.root === rootFilter) : store.todos
      const { onDate, carry, later } = partitionByDate(scoped, date)
      const now = Date.now()
      const withTime = t => ({ ...t, timing: timeInStages(t, now), carriedDays: carriedDays(t, date) })
      res.json({
        date,
        statuses: STATUSES,
        settings: store.settings,
        jiraConfig: jiraConfig(),
        rolledOverToday: store.lastRollover === dayKey(),
        todos: onDate.map(withTime),
        carry: carry.map(withTime),
        ahead: later.filter(t => !t.done).length,
        stats: dayStats(onDate),
        tree: groupByPath(onDate.map(withTime)),
        roots: roots(),
        days: [...new Set(store.todos.map(t => t.date))].sort().slice(-90),
      })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  app.get('/api/todos/count', (req, res) => {
    try {
      const date = dateOf(req)
      const { onDate, carry } = partitionByDate(maybeRollover().todos, date)
      const open = onDate.filter(t => !t.done)
      res.json({ date, open: open.length, total: onDate.length, carry: carry.length, inProgress: open.filter(t => t.status === 'in-progress').length })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  app.get('/api/todos/suggest', (req, res) => {
    try {
      const date = dateOf(req)
      const list = roots()
      if (!list.length) {
        return res.json({
          available: false, date, roots: [],
          reason: 'no-agent-history',
          detail: 'No Claude Code edit history was found in ~/.claude/projects, so there is nothing to suggest from. Todos typed by hand still work — this panel populates the first time an agent edits a file in a repo.',
          dirs: [], files: 0, edits: 0,
        })
      }
      const root = req.query.root && list.some(r => r.root === req.query.root) ? String(req.query.root) : list[0].root
      const { edits, errors } = activity()
      const store = readStore()
      const out = suggestFromActivity({ edits, errors, root, date, existing: store.todos.filter(t => t.date === date) })
      res.json({ available: true, date, root, roots: list, ...out })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  /**
   * Daily / weekly / monthly insights, computed from the store alone — no LLM, no external service,
   * no cost. Every number here is derived from timestamps this app wrote itself, which is why the
   * per-stage figures can be trusted: they are not a self-report of how long review "felt".
   */
  app.get('/api/todos/insights', (req, res) => {
    try {
      const period = PERIODS.includes(req.query.period) ? req.query.period : 'day'
      const date = dateOf(req)
      const store = readStore()
      const rootFilter = req.query.root ? String(req.query.root) : null
      const scoped = rootFilter ? store.todos.filter(t => !t.root || t.root === rootFilter) : store.todos
      const out = insights(scoped, { period, date })
      res.json({
        ...out,
        statuses: STATUSES,
        available: !out.empty,
        detail: out.empty ? `No todos were open or created in ${out.range.label}. Insights are computed from the todos you file here — this window is empty, which is not the same as a week with no work.` : null,
      })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  // ---------------- write ----------------

  app.get('/api/todos/settings', (req, res) => {
    const store = readStore()
    res.json({ ...store.settings, lastRollover: store.lastRollover, jira: jiraConfig() })
  })
  app.put('/api/todos/settings', (req, res) => {
    try {
      const store = readStore()
      if (req.body?.rollover !== undefined) store.settings.rollover = !!req.body.rollover
      writeStore(store, `todo settings: rollover ${store.settings.rollover ? 'on' : 'off'}`)
      res.json(store.settings)
    } catch (e) { res.status(400).json({ error: String(e.message || e) }) }
  })

  app.post('/api/todos/rollover', (req, res) => {
    try {
      const store = readStore()
      const today = isDayKey(req.body?.date) ? req.body.date : dayKey()
      const { todos, moved, changed } = rollForward(store.todos, today)
      store.todos = todos
      store.lastRollover = today
      if (changed) writeStore(store, `todos rolled forward to ${today}: ${moved.length}`)
      res.json({ moved, date: today })
    } catch (e) { res.status(400).json({ error: String(e.message || e) }) }
  })

  app.post('/api/todos', (req, res) => {
    try {
      const store = readStore()
      const todo = normalizeTodo(req.body || {})
      store.todos.push(todo)
      writeStore(store, `todo added: ${todo.title.slice(0, 60)}`)
      res.json(todo)
    } catch (e) { res.status(400).json({ error: String(e.message || e) }) }
  })

  app.post('/api/todos/import', (req, res) => {
    try {
      const { root, date, files, status } = req.body || {}
      const day = isDayKey(date) ? date : dayKey()
      if (!root || !Array.isArray(files) || !files.length) return res.status(400).json({ error: 'root and a non-empty files[] are required' })
      const store = readStore()
      const have = new Set(store.todos.filter(t => t.date === day && t.file).map(t => t.root + '::' + t.file))
      const { edits, errors } = activity()
      const sug = suggestFromActivity({ edits, errors, root, date: day })
      const byFile = new Map(sug.dirs.flatMap(d => d.files).map(f => [f.file, f]))
      const added = [], skipped = []
      for (const f of files) {
        const rel = normalizeRel(f)
        if (!rel) { skipped.push({ file: f, why: 'invalid path' }); continue }
        if (have.has(root + '::' + rel)) { skipped.push({ file: rel, why: 'already on this day' }); continue }
        const ev = byFile.get(rel)
        const todo = normalizeTodo({
          title: rel.split('/').pop(),
          notes: ev ? `Agent edited this on ${day}: ${ev.edits} edit(s), +${ev.add}/-${ev.del} across ${ev.sessions} session(s)${ev.failures ? `, ${ev.failures} tool error(s)` : ''}.` : '',
          status: isStatus(status) ? status : 'draft',
          date: day, root, file: rel, source: 'workingset',
          evidence: ev ? { edits: ev.edits, add: ev.add, del: ev.del, failures: ev.failures, sessions: ev.sessions, lastT: ev.lastT } : null,
        })
        store.todos.push(todo)
        added.push(todo)
        have.add(root + '::' + rel)
      }
      if (added.length) writeStore(store, `todos imported from working set: ${added.length}`)
      res.json({ added, skipped })
    } catch (e) { res.status(400).json({ error: String(e.message || e) }) }
  })

  app.patch('/api/todos/:id', (req, res) => {
    try {
      const store = readStore()
      const i = store.todos.findIndex(t => t.id === req.params.id)
      if (i === -1) return res.status(404).json({ error: 'no such todo' })
      if (req.body?.status !== undefined && !isStatus(req.body.status))
        return res.status(400).json({ error: `status must be one of: ${STATUS_IDS.join(', ')}` })
      const patch = { ...(req.body || {}) }
      if (patch.jira !== undefined) {
        const raw = typeof patch.jira === 'object' && patch.jira ? patch.jira.key : patch.jira
        if (!raw) patch.jira = null
        else {
          const key = normalizeKey(raw)
          if (!key) return res.status(400).json({ error: `"${String(raw).slice(0, 40)}" is not a JIRA key — use ABC-123, or paste the ticket URL` })
          patch.jira = jiraFor(key)
        }
      }
      const next = applyPatch(store.todos[i], patch)
      store.todos[i] = next
      writeStore(store, `todo updated: ${next.title.slice(0, 60)}`)
      res.json({ ...next, timing: timeInStages(next), carriedDays: carriedDays(next, next.date) })
    } catch (e) { res.status(400).json({ error: String(e.message || e) }) }
  })

  app.delete('/api/todos/:id', (req, res) => {
    try {
      const store = readStore()
      const t = store.todos.find(x => x.id === req.params.id)
      if (!t) return res.status(404).json({ error: 'no such todo' })
      store.todos = store.todos.filter(x => x.id !== req.params.id)
      writeStore(store, `todo deleted: ${t.title.slice(0, 60)}`)
      res.json({ ok: true })
    } catch (e) { res.status(400).json({ error: String(e.message || e) }) }
  })

  app.post('/api/todos/move', (req, res) => {
    try {
      const { ids, date } = req.body || {}
      if (!Array.isArray(ids) || !ids.length || !isDayKey(date)) return res.status(400).json({ error: 'ids[] and a YYYY-MM-DD date are required' })
      const store = readStore()
      const set = new Set(ids)
      let moved = 0
      store.todos = store.todos.map(t => { if (!set.has(t.id)) return t; moved++; return applyPatch(t, { date }) })
      if (moved) writeStore(store, `todos moved to ${date}: ${moved}`)
      res.json({ moved, date })
    } catch (e) { res.status(400).json({ error: String(e.message || e) }) }
  })

  return { STORE, readStore, dayStart, dayEnd }
}
