// src/lib/todos.js — the client half of the TODO list.
//
// The list is rendered in two places at once: the full-screen Todos section and the floating dock's
// drawer, which is mounted on EVERY screen. Both must show the same day and the same counts, and a
// tick in one must land in the other without a reload. That is the whole job of this file:
//
//   * `useTodoDay(date)` — one hook both consumers use, so there is one fetch shape and one refresh path.
//   * `todosChanged()` — a window event fired after every mutation; every mounted consumer re-reads.
//   * `useSelectedDay()` — the selected day itself is shared state, persisted, so opening the drawer
//     from another screen does not silently reset the day the user was working on.
//
// The stage model is NOT redefined here — it is imported from lib/todos.mjs, the same module the
// server validates against. A second copy in the client is exactly how a stage rename produces cards
// that render in no column.
import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import { dayKey, isDayKey } from '../../lib/todos.mjs'

export * from '../../lib/todos.mjs'

const CHANGED = 'todos-changed'
const DAY_CHANGED = 'todos-day-changed'
const DAY_KEY = 'todos.selectedDay'

export const todosChanged = () => window.dispatchEvent(new Event(CHANGED))

/** Read the persisted day once. Falls back to today for a first run or a corrupted value. */
function storedDay() {
  try {
    const v = localStorage.getItem(DAY_KEY)
    if (isDayKey(v)) return v
  } catch { /* private mode — session-only day is fine */ }
  return dayKey()
}

export function setSelectedDay(date) {
  if (!isDayKey(date)) return
  try { localStorage.setItem(DAY_KEY, date) } catch {}
  window.dispatchEvent(new CustomEvent(DAY_CHANGED, { detail: date }))
}

/** The shared selected day. Every consumer re-renders when any of them moves it. */
export function useSelectedDay() {
  const [date, setDate] = useState(storedDay)
  useEffect(() => {
    const on = e => setDate(e.detail)
    window.addEventListener(DAY_CHANGED, on)
    return () => window.removeEventListener(DAY_CHANGED, on)
  }, [])
  return [date, setSelectedDay]
}

/**
 * One day's todos. `root` narrows to a repo but never hides unbound todos (the server decides that —
 * see /api/todos). Returns `data: null` while the first load is in flight so callers can render a
 * skeleton instead of an empty board, which would read as "nothing to do today".
 */
export function useTodoDay(date, root) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const load = useCallback(() => {
    // A null date means "this consumer is not showing anything right now" (the closed dock). Skipping
    // the request matters: this hook is mounted app-wide, and a closed drawer polling the day payload
    // on every change event is a scan of every transcript for a panel nobody is looking at.
    if (!date) { setData(null); return Promise.resolve(null) }
    const qs = new URLSearchParams({ date })
    if (root) qs.set('root', root)
    return api.get('/api/todos?' + qs)
      .then(d => { setData(d); setErr(null); return d })
      .catch(e => { setErr(e.message); return null })
  }, [date, root])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const on = () => load()
    window.addEventListener(CHANGED, on)
    return () => window.removeEventListener(CHANGED, on)
  }, [load])
  return { data, err, reload: load }
}

// Mutations. Each one fires `todosChanged` so the other consumer catches up — the caller never has to
// remember to refresh both, which is the bug this indirection exists to prevent.
const after = p => p.then(r => { todosChanged(); return r })
export const todoApi = {
  create: body => after(api.post('/api/todos', body)),
  patch: (id, body) => after(api.patch('/api/todos/' + id, body)),
  remove: id => after(api.del('/api/todos/' + id)),
  importFiles: body => after(api.post('/api/todos/import', body)),
  move: (ids, date) => after(api.post('/api/todos/move', { ids, date })),
  suggest: (date, root) => api.get('/api/todos/suggest?' + new URLSearchParams(root ? { date, root } : { date })),
  count: date => api.get('/api/todos/count?date=' + date),
  insights: (period, date, root) => api.get('/api/todos/insights?' + new URLSearchParams(root ? { period, date, root } : { period, date })),
  settings: () => api.get('/api/todos/settings'),
  saveSettings: body => after(api.put('/api/todos/settings', body)),
  rollover: date => after(api.post('/api/todos/rollover', { date })),
  // A JIRA key, a pasted browse URL, or '' to unlink. The server owns what counts as a key.
  linkJira: (id, jira) => after(api.patch('/api/todos/' + id, { jira })),
}
