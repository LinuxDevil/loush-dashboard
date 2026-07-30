import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import { dayKey, isDayKey } from '../../lib/todos.mjs'

export * from '../../lib/todos.mjs'

const CHANGED = 'todos-changed'
const DAY_CHANGED = 'todos-day-changed'
const DAY_KEY = 'todos.selectedDay'

export const todosChanged = () => window.dispatchEvent(new Event(CHANGED))

function storedDay() {
  try {
    const v = localStorage.getItem(DAY_KEY)
    if (isDayKey(v)) return v
  } catch { }
  return dayKey()
}

export function setSelectedDay(date) {
  if (!isDayKey(date)) return
  try { localStorage.setItem(DAY_KEY, date) } catch {}
  window.dispatchEvent(new CustomEvent(DAY_CHANGED, { detail: date }))
}

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
  linkJira: (id, jira) => after(api.patch('/api/todos/' + id, { jira })),
}
