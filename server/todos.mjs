// server/todos.mjs — /api/todos/* — the date-scoped delivery TODO list.
//
// WHAT THIS IS
// A checkable to-do list whose stages are the delivery pipeline the team actually uses
// (Draft → In progress → Code review → Design QA → Manual QA → Ready for release → Live), scoped to
// ONE DAY at a time, and filed under the directory and file the work belongs to.
//
// WHY IT IS NOT A SECOND TASK BOARD
// /api/board is the AGENT's board: tickets there own a worktree, a branch, runs and QA results, and a
// ticket moves stage because a run finished. This is the HUMAN's list for a given day — typed in one
// line at a time, or pulled from what the agent actually did to the repo that day. Nothing here spawns
// a process, and nothing here is derived: a stage changes because a person changed it.
//
// THE JOIN TO REAL DATA
// /api/todos/suggest reads the same transcripts every other screen reads (scanTranscripts + failStats,
// injected — this module opens no files of its own beyond its store) and answers "which files did the
// agent edit on THIS day, in THIS repo, and which of them fought back". One click files those as Draft
// todos already bound to their directory and file. That is what makes the list start from the current
// data instead of from an empty box.
//
// PLANE: B (self-only). Transcript-derived, never keyed by a person, no user/machine parameter.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  STATUSES, STATUS_IDS, isStatus, dayKey, isDayKey, dayStart, dayEnd,
  normalizeTodo, applyPatch, partitionByDate, dayStats, groupByPath, suggestFromActivity, normalizeRel,
} from '../lib/todos.mjs'

const STORE = path.join(os.homedir(), '.claude', 'dashboard-todos.json')

const readStore = () => {
  try {
    const j = JSON.parse(fs.readFileSync(STORE, 'utf8'))
    return { version: 1, todos: Array.isArray(j.todos) ? j.todos : [] }
  } catch { return { version: 1, todos: [] } }
}

export default function mountTodos(app, deps = {}) {
  const { scanTranscripts, failStats, track, backup } = deps

  // Writes go through `track` when the host provides it, so a todo edit lands in the same versioned
  // history (and the same rollback UI) as every other write this app makes. The fallback is a plain
  // write rather than a throw: the list must keep working if it is ever mounted standalone.
  const writeStore = (store, summary) => {
    const body = JSON.stringify(store, null, 2)
    fs.mkdirSync(path.dirname(STORE), { recursive: true })
    if (typeof track === 'function') { track(STORE, body, { summary }); return }
    if (typeof backup === 'function') { try { backup(STORE) } catch {} }
    fs.writeFileSync(STORE, body)
  }

  // Repos we have agent history for — the same derivation the Working Set uses (session cwd, longest
  // prefix wins so a session started in a subdirectory still attributes to its repo root). This is the
  // only list of roots the UI offers, so a todo can never be bound to a directory nothing knows about.
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

  // Every edit + tool error the transcripts hold, flattened once per request. Scoped to a day by the
  // caller, not here, because the same harvest answers both the suggestion list and the day counts.
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

  // ---------------- read ----------------

  app.get('/api/todos', (req, res) => {
    try {
      const date = dateOf(req)
      const store = readStore()
      const rootFilter = req.query.root ? String(req.query.root) : null
      // A repo filter hides todos bound to OTHER repos but never hides unbound ones: a plain "call
      // the designer" todo belongs to the day, not to a checkout, and must not disappear behind a
      // scope selector the user set for something else.
      const scoped = rootFilter ? store.todos.filter(t => !t.root || t.root === rootFilter) : store.todos
      const { onDate, carry, later } = partitionByDate(scoped, date)
      res.json({
        date,
        statuses: STATUSES,
        todos: onDate,
        carry,
        ahead: later.filter(t => !t.done).length,
        stats: dayStats(onDate),
        tree: groupByPath(onDate),
        roots: roots(),
        // Days that already hold something — the date strip marks them so the user can find the day
        // they were working on instead of clicking backwards through empty ones.
        days: [...new Set(store.todos.map(t => t.date))].sort().slice(-90),
      })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  // The badge on the floating button. Deliberately its own tiny endpoint: the dock polls this every
  // 30s from every screen in the app, and it must not drag the whole day payload (or the transcript
  // scan behind `roots`) along with it.
  app.get('/api/todos/count', (req, res) => {
    try {
      const date = dateOf(req)
      const { onDate, carry } = partitionByDate(readStore().todos, date)
      const open = onDate.filter(t => !t.done)
      res.json({ date, open: open.length, total: onDate.length, carry: carry.length, inProgress: open.filter(t => t.status === 'in-progress').length })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  // What the agent did to this repo on this day, grouped directory → file, with the todos that
  // already exist for those files marked so nothing gets filed twice.
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

  // ---------------- write ----------------

  app.post('/api/todos', (req, res) => {
    try {
      const store = readStore()
      const todo = normalizeTodo(req.body || {})
      store.todos.push(todo)
      writeStore(store, `todo added: ${todo.title.slice(0, 60)}`)
      res.json(todo)
    } catch (e) { res.status(400).json({ error: String(e.message || e) }) }
  })

  // Bulk file from the suggestion panel. Partial success is reported rather than rolled back — one
  // unreadable path should not discard the eleven rows the user just ticked.
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
      const next = applyPatch(store.todos[i], req.body || {})
      store.todos[i] = next
      writeStore(store, `todo updated: ${next.title.slice(0, 60)}`)
      res.json(next)
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

  // Move a batch of unfinished todos onto another day — the action on the carry-over strip.
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
