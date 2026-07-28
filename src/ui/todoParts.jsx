// src/ui/todoParts.jsx — the pieces the full-screen board and the floating drawer BOTH render.
//
// The drawer is not a different to-do list with a smaller font: it is the same card, the same
// checkbox and the same stage control at `compact` density. Sharing them here is what keeps a tick in
// the drawer and a tick on the board from drifting into two behaviours.
import React, { useState } from 'react'
import { STATUSES, statusMeta, stepStatus, progressOf, todoApi } from '../lib/todos.js'
import { toast } from '../lib/api.js'

const MONO = 'var(--mono)'

/** The checkbox. Big enough to hit, labelled for screen readers, and it is the only thing that ticks. */
export function Check({ checked, onChange, label, size = 16 }) {
  return (
    <button
      role="checkbox"
      aria-checked={!!checked}
      aria-label={label}
      title={checked ? 'mark not done' : 'mark done'}
      onClick={e => { e.stopPropagation(); onChange(!checked) }}
      style={{
        width: size, height: size, minWidth: size, padding: 0, borderRadius: 4, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${checked ? 'var(--green-solid)' : 'var(--border-active)'}`,
        background: checked ? 'var(--green-solid)' : 'transparent',
        color: '#fff', font: `700 ${Math.round(size * 0.62)}px ${MONO}`, lineHeight: 1,
      }}
    >{checked ? '✓' : ''}</button>
  )
}

export const StageChip = ({ status, small }) => {
  const m = statusMeta(status)
  return (
    <span title={m.hint} style={{
      font: `600 ${small ? 9 : 10}px ${MONO}`, letterSpacing: '0.04em', padding: small ? '1px 5px' : '2px 7px',
      borderRadius: 9999, color: m.color, background: 'var(--bg-surface-active)', whiteSpace: 'nowrap',
    }}>{small ? m.short : m.label}</span>
  )
}

/**
 * Stage control: ‹ › walk the pipeline one step, the select jumps anywhere.
 *
 * `arrowsOnly` is the narrow-card mode, and it is not cosmetic: a 260px board column carrying a
 * dropdown wide enough to read "Ready for release" leaves the title about one character per line.
 * On those cards the stage is already stated by the column (or by the drawer's group header), so the
 * arrows are the whole control and the dropdown moves into the expanded panel, where there is room.
 */
export function StagePicker({ todo, arrowsOnly }) {
  const set = status => todoApi.patch(todo.id, { status }).catch(e => toast(e.message, 'error'))
  const i = STATUSES.findIndex(s => s.id === todo.status)
  const m = statusMeta(todo.status)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      <button className="ghost" style={{ marginTop: 0, fontSize: 13, padding: '0 3px' }} disabled={i <= 0}
        title={i > 0 ? `back to ${STATUSES[i - 1].label}` : 'first stage'} aria-label="previous stage"
        onClick={() => set(stepStatus(todo.status, -1))}>‹</button>
      {arrowsOnly ? (
        <span title={`${m.label} — ${m.hint}`} style={{ font: `600 9px ${MONO}`, color: m.color, minWidth: 26, textAlign: 'center' }}>{m.short}</span>
      ) : (
        <select value={todo.status} onChange={e => set(e.target.value)} aria-label="stage"
          style={{ font: `500 11px ${MONO}`, padding: '2px 4px', height: 'auto' }}>
          {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      )}
      <button className="ghost" style={{ marginTop: 0, fontSize: 13, padding: '0 3px' }} disabled={i >= STATUSES.length - 1}
        title={i < STATUSES.length - 1 ? `move to ${STATUSES[i + 1].label}` : 'last stage'} aria-label="next stage"
        onClick={() => set(stepStatus(todo.status, +1))}>›</button>
    </span>
  )
}

/**
 * file · dir provenance, as the repo-relative path so it is greppable. Long paths truncate from the
 * LEFT (`direction: rtl`) because the tail — the file name — is the part that identifies it. The icon
 * sits in its own element: inside the rtl span the browser flips it to the far end of the line.
 */
export const PathChip = ({ todo }) => {
  const p = todo.file || todo.dir
  if (!p) return null
  return (
    <span title={(todo.root ? todo.root + '/' : '') + p}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, minWidth: 0, maxWidth: 260, font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>
      <span>{todo.file ? '▤' : '▸'}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left' }}>{p}</span>
    </span>
  )
}

/** Sub-tasks: checkable, addable, removable. The second level of "checkable" the request asked for. */
function Subtasks({ todo }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    todoApi.patch(todo.id, { subtaskAdd: title }).catch(e => toast(e.message, 'error'))
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 24 }}>
      {(todo.subtasks || []).map(s => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Check size={13} checked={s.done} label={s.title}
            onChange={() => todoApi.patch(todo.id, { subtaskToggle: s.id }).catch(e => toast(e.message, 'error'))} />
          <span style={{
            font: '400 12px var(--body)', flex: 1,
            color: s.done ? 'var(--text-tertiary)' : 'var(--text-secondary)',
            textDecoration: s.done ? 'line-through' : 'none',
          }}>{s.title}</span>
          <button className="ghost" title="remove sub-task" style={{ marginTop: 0 }}
            onClick={() => todoApi.patch(todo.id, { subtaskRemove: s.id }).catch(e => toast(e.message, 'error'))}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="add a sub-task…" style={{ flex: 1, font: '400 11px var(--body)', padding: '3px 6px' }} />
        <button className="mini" style={{ marginTop: 0 }} onClick={add} disabled={!draft.trim()}>+</button>
      </div>
    </div>
  )
}

/**
 * One todo. `compact` is the drawer density: no notes editor, no history, sub-tasks only once opened.
 * Everything on the card is an action — tick it, move its stage, open its file's dossier, delete it —
 * because a row you can only look at is a row that goes stale.
 */
export function TodoCard({ todo, compact, onOpenFile }) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState(todo.notes || '')
  const prog = progressOf(todo)
  const patch = body => todoApi.patch(todo.id, body).catch(e => toast(e.message, 'error'))
  return (
    <div style={{
      border: '1px solid var(--border-default)', borderRadius: 6, background: 'var(--bg-surface)',
      padding: compact ? '7px 8px' : '9px 11px', display: 'flex', flexDirection: 'column', gap: 6,
      opacity: todo.done ? 0.62 : 1,
      borderLeft: `2px solid ${statusMeta(todo.status).color}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Check checked={todo.done} label={todo.title} onChange={done => patch({ done })} size={compact ? 14 : 16} />
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
          <div style={{
            font: `500 ${compact ? 12 : 13}px var(--body)`, color: 'var(--text-primary)',
            textDecoration: todo.done ? 'line-through' : 'none', wordBreak: 'break-word',
          }}>{todo.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
            {/* On a compact card the stage is already stated twice over — by the board column or the
                drawer's group header, and by the short code in the picker. A third copy costs width
                the title needs. */}
            {!compact && <StageChip status={todo.status} />}
            <PathChip todo={todo} />
            {prog.total > 0 && (
              <span style={{ font: `400 10px ${MONO}`, color: prog.done === prog.total ? 'var(--green)' : 'var(--text-tertiary)' }}>
                ☑ {prog.done}/{prog.total}
              </span>
            )}
            {todo.source === 'workingset' && (
              <span title="filed from what the agent actually edited that day" style={{ font: `400 10px ${MONO}`, color: 'var(--blue)' }}>◈ working set</span>
            )}
            {todo.evidence?.failures > 0 && (
              <span title={`${todo.evidence.failures} tool error(s) hit on this file that day`} style={{ font: `400 10px ${MONO}`, color: 'var(--red)' }}>✕ {todo.evidence.failures}</span>
            )}
          </div>
        </div>
        <StagePicker todo={todo} arrowsOnly={compact} />
      </div>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
          {/* the jump-anywhere control lives here on compact cards, where there is room for it */}
          {compact && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>stage</span>
              <StagePicker todo={todo} />
            </div>
          )}
          <Subtasks todo={todo} />
          {!compact && (
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              onBlur={() => notes !== (todo.notes || '') && patch({ notes })}
              placeholder="notes — what 'done' means here, the PR link, who is reviewing…"
              style={{ font: `400 11px ${MONO}` }} />
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {todo.evidence && (
              <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>
                {todo.evidence.edits} edit(s) · +{todo.evidence.add}/-{todo.evidence.del} · {todo.evidence.sessions} session(s)
              </span>
            )}
            {todo.file && onOpenFile && (
              <button className="mini" style={{ marginTop: 0 }} onClick={() => onOpenFile(todo)}>open file dossier ↗</button>
            )}
            <button className="mini danger" style={{ marginTop: 0, marginLeft: 'auto' }}
              onClick={() => todoApi.remove(todo.id).catch(e => toast(e.message, 'error'))}>delete</button>
          </div>
        </div>
      )}
    </div>
  )
}
