import React, { useEffect, useState } from 'react'
import { api, tildify } from '../lib/api.js'
import { workScope, basename } from '../lib/workScope.js'

const MONO = 'var(--mono)'

/** Subscribe once, re-render on every change. Unsubscribes on unmount — no leaked listeners. */
export function useWorkScope() {
  const [s, setS] = useState(() => workScope.get())
  useEffect(() => workScope.subscribe(setS), [])
  return s
}

/**
 * The one project control for this section, stated in words above the panes it governs.
 *
 * It lists every folder Claude Code knows about rather than the intersection of what each pane can
 * show, because an intersection silently hides repos: a folder with no board yet would vanish from
 * the picker, and the fix — "create a board" — lives behind the picker that just hid it. Panes that
 * have no data for the chosen path say so themselves.
 */
export default function WorkScopeBar() {
  const scope = useWorkScope()
  const [projects, setProjects] = useState([])
  useEffect(() => {
    api.get('/api/projects')
      .then(ps => {
        const ex = ps.filter(p => p.exists !== false)
        setProjects(ex)
        if (!workScope.get().path && ex[0]) workScope.set({ path: ex[0].path })
      })
      .catch(() => {})
  }, [])
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>working in</span>
      <select value={scope.path || ''} aria-label="project for every pane in this section"
        onChange={e => workScope.set({ path: e.target.value || null })}
        title="every pane below reads this — the board, the runs, and the commands all follow it"
        style={{ font: `400 12px ${MONO}`, maxWidth: 360 }}>
        <option value="">pick a project…</option>
        {projects.map(p => <option key={p.path} value={p.path}>{p.name} — {tildify(p.path)}</option>)}
      </select>
      {scope.ticket
        ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: `500 11px ${MONO}`, color: 'var(--accent-light)', background: 'var(--accent-bg)', border: '1px solid var(--border-default)', borderRadius: 999, padding: '2px 6px 2px 10px' }}>
            {scope.ticket}
            <button onClick={() => workScope.set({ ticket: null })} aria-label={`stop working on ${scope.ticket}`} title="clear the ticket"
              style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit', padding: '0 4px', font: `400 11px ${MONO}` }}>✕</button>
          </span>
        )
        : <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no ticket open</span>}
      {scope.path && <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>runs and board key on <code>{basename(scope.path)}</code></span>}
    </div>
  )
}
