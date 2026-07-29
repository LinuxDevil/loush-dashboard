// src/ui/TodoDock.jsx — the floating TODO button, mounted once in the app shell.
//
// TWO WAYS IN, ONE LIST
//   * this button (every screen) → a drawer for capture and ticking off, without losing your place
//   * the TODO tab in the sidebar → the full board, for planning the day
// Both read `useTodoDay` and mutate through `todoApi`, so a tick here shows up there immediately and
// the day selected in one is the day shown in the other.
//
// The badge is the day's OPEN count, polled from /api/todos/count — a deliberately tiny endpoint,
// because this component is alive on every screen and must not drag a full day payload behind it.
import React, { useEffect, useState } from 'react'
import { toast } from '../lib/api.js'
import { TodoCard } from './todoParts.jsx'
import { STATUSES, useTodoDay, useSelectedDay, todoApi, dayKey, shiftDay, humanDay, dottedDay } from '../lib/todos.js'

const MONO = 'var(--mono)'
const HEAD = 'var(--head)'

export default function TodoDock({ onNav }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useSelectedDay()
  const [count, setCount] = useState(null)
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState('draft')
  const { data } = useTodoDay(open ? date : null)

  // Badge polling. Runs whether or not the drawer is open — that is the point of a dock: the number
  // is visible from wherever you are. Paused while the tab is hidden, like the other pollers here.
  useEffect(() => {
    const load = () => todoApi.count(date).then(setCount).catch(() => {})
    load()
    const onChange = () => load()
    const t = setInterval(() => { if (!document.hidden) load() }, 30_000)
    window.addEventListener('todos-changed', onChange)
    return () => { clearInterval(t); window.removeEventListener('todos-changed', onChange) }
  }, [date])

  // Alt+T toggles the drawer — Cmd/Ctrl+Shift+T and Cmd+J are taken by the browser itself, and a
  // shortcut the browser eats is worse than none. Escape closes, matching the command palette.
  useEffect(() => {
    const onKey = e => {
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 't') { e.preventDefault(); setOpen(o => !o) }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const add = () => {
    const t = title.trim()
    if (!t) return
    setTitle('')
    todoApi.create({ title: t, status, date }).catch(e => toast(e.message, 'error'))
  }

  const openCount = count?.open ?? 0
  const carry = count?.carry ?? 0

  return (
    <>
      <button className="todo-fab" onClick={() => setOpen(o => !o)}
        title={`todos for ${dottedDay(date)} — ${openCount} open${carry ? `, ${carry} carried over` : ''} (Alt+T)`}
        aria-label="open todos">
        <span className="todo-fab-icon">☑</span>
        <span className="todo-fab-label">Todos</span>
        {openCount > 0 && <span className="todo-fab-badge">{openCount}</span>}
        {carry > 0 && openCount === 0 && <span className="todo-fab-badge carry">{carry}</span>}
      </button>

      {open && (
        <>
          <div className="drawer-overlay" onClick={() => setOpen(false)} />
          <div className="drawer todo-drawer" role="dialog" aria-label="Todos">
            <div className="drawer-head">
              <div style={{ minWidth: 0 }}>
                <h3>Todos · {dottedDay(date)}</h3>
                <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>
                  {humanDay(date)} · {data ? `${data.stats.done}/${data.stats.total} done` : '…'}
                  {data?.carry.length ? ` · ${data.carry.length} carried over` : ''}
                  {data?.settings?.rollover === false ? ' · roll-over off' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <button className="ghost" title="previous day" onClick={() => setDate(shiftDay(date, -1))}>‹</button>
                <button className="ghost" title="today" onClick={() => setDate(dayKey())}>●</button>
                <button className="ghost" title="next day" onClick={() => setDate(shiftDay(date, +1))}>›</button>
                <button className="ghost" onClick={() => setOpen(false)} aria-label="close">✕</button>
              </div>
            </div>

            <div className="drawer-body" style={{ gap: 10 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
                  placeholder="capture a todo…" style={{ flex: 1 }} autoFocus />
                <select value={status} onChange={e => setStatus(e.target.value)} aria-label="stage" style={{ font: `400 11px ${MONO}` }}>
                  {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <button className="primary" onClick={add} disabled={!title.trim()}>+</button>
              </div>

              {!data ? <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>loading…</div>
                : data.todos.length === 0 ? (
                  <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                    Nothing filed for {dottedDay(date)}. Type a line above, or open the full board to file
                    what the agent already touched that day.
                  </div>
                ) : STATUSES.map(s => {
                  const col = data.todos.filter(t => t.status === s.id)
                  if (!col.length) return null
                  return (
                    <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 2, background: s.color }} />
                        <span style={{ font: `600 11px ${HEAD}`, color: 'var(--text-secondary)' }}>{s.label}</span>
                        <span style={{ font: `500 10px ${MONO}`, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{col.length}</span>
                      </div>
                      {col.map(t => <TodoCard key={t.id} todo={t} compact jiraConfig={data.jiraConfig} />)}
                    </div>
                  )
                })}

              {data?.carry.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ font: `600 11px ${HEAD}`, color: 'var(--amber)' }}>{data.carry.length} unfinished from earlier days</span>
                    <button className="mini" style={{ marginTop: 0, marginLeft: 'auto' }}
                      onClick={() => todoApi.move(data.carry.map(t => t.id), date).catch(e => toast(e.message, 'error'))}>pull all</button>
                  </div>
                </div>
              )}
            </div>

            <div className="drawer-foot">
              <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', marginRight: 'auto' }}>Alt+T toggles this</span>
              <button className="primary" onClick={() => { setOpen(false); onNav?.('todos') }}>Open full board ↗</button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
