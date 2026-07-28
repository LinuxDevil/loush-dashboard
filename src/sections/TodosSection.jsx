// src/sections/TodosSection.jsx — the full-screen TODO board.
//
// One day at a time, seven delivery stages, and every row filed under the directory and file it
// belongs to. The two views are the same todos read two ways:
//
//   BOARD  by stage — "what is stuck in Code review" — the planning question.
//   TREE   by directory → file — "what is outstanding in src/sections" — the code question, and the
//          reason this list is worth having next to a Working Set rather than in a notes app.
//
// The Suggest panel is the join to real data: it lists the files the agent actually edited on the
// selected day, in the selected repo, straight from the transcripts, and files them as Draft todos
// already bound to their path. A day therefore starts from what happened, not from an empty box.
import React, { useEffect, useMemo, useState } from 'react'
import { api, toast } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import { TodoCard, Check, StageChip } from '../ui/todoParts.jsx'
import {
  STATUSES, useTodoDay, useSelectedDay, todoApi, dayKey, shiftDay, humanDay, dottedDay,
  groupByPath, statusMeta,
} from '../lib/todos.js'

const MONO = 'var(--mono)'
const HEAD = 'var(--head)'
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 12 }

// ---------------------------------------------------------------------------
// day header
// ---------------------------------------------------------------------------

function DayBar({ date, setDate, stats, carry, ahead, days }) {
  const today = dayKey()
  const has = new Set(days || [])
  // Seven days ending on the selected one — enough to see the week without a calendar widget, and
  // dots mark the days that actually hold something so an empty day is never a dead end.
  const strip = Array.from({ length: 7 }, (_, i) => shiftDay(date, i - 6))
  return (
    <div style={{ ...PANEL, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button onClick={() => setDate(shiftDay(date, -1))} title="previous day" aria-label="previous day">‹</button>
        <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)}
          aria-label="day" style={{ width: 150, font: `500 12px ${MONO}` }} />
        <button onClick={() => setDate(shiftDay(date, +1))} title="next day" aria-label="next day">›</button>
        <button onClick={() => setDate(today)} disabled={date === today} style={{ marginLeft: 4 }}>today</button>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ font: `600 15px ${HEAD}`, color: 'var(--text-primary)' }}>
          {dottedDay(date)} <span style={{ font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>· {humanDay(date, today)}</span>
        </div>
        <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginTop: 2 }}>
          {stats.total === 0 ? 'nothing filed for this day yet'
            : `${stats.done}/${stats.total} done · ${stats.open} open`}
          {carry > 0 && <span style={{ color: 'var(--amber)' }}> · {carry} carried over</span>}
          {ahead > 0 && <span> · {ahead} ahead</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 3, marginLeft: 'auto' }}>
        {strip.map(d => (
          <button key={d} onClick={() => setDate(d)} title={dottedDay(d)}
            style={{
              padding: '2px 7px', minWidth: 34, font: `500 10px ${MONO}`,
              background: d === date ? 'var(--bg-surface-active)' : 'transparent',
              borderColor: d === date ? 'var(--border-active)' : 'var(--border-subtle)',
              color: d === date ? 'var(--text-primary)' : 'var(--text-tertiary)',
            }}>
            {new Date(d + 'T00:00:00').getDate()}
            <span style={{ display: 'block', height: 3, marginTop: 2, borderRadius: 2, background: has.has(d) ? 'var(--green)' : 'transparent' }} />
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

function QuickAdd({ date, root, dirs }) {
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState('draft')
  const [file, setFile] = useState('')
  const submit = () => {
    const t = title.trim()
    if (!t) return
    todoApi.create({ title: t, status, date, root: root || null, file: file || null })
      .then(() => { setTitle(''); })
      .catch(e => toast(e.message, 'error'))
  }
  return (
    <div style={{ ...PANEL, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder={`what needs doing on ${dottedDay(date)}?`} style={{ flex: 1, minWidth: 240 }} />
      <select value={status} onChange={e => setStatus(e.target.value)} aria-label="stage">
        {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      {/* Path binding is optional and comes from the files the agent touched — a free-text path field
          invites typos that file a todo under a directory that does not exist. */}
      <select value={file} onChange={e => setFile(e.target.value)} aria-label="file"
        style={{ maxWidth: 280 }} disabled={!dirs.length}>
        <option value="">{dirs.length ? 'no file' : 'no agent history for this day'}</option>
        {dirs.map(d => (
          <optgroup key={d.dir} label={d.dir}>
            {d.files.map(f => <option key={f.file} value={f.file}>{f.name}</option>)}
          </optgroup>
        ))}
      </select>
      <button className="primary" onClick={submit} disabled={!title.trim()}>Add</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------

function Board({ todos, onOpenFile }) {
  return (
    <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6, alignItems: 'flex-start' }}>
      {STATUSES.map(s => {
        const col = todos.filter(t => t.status === s.id)
        return (
          <div key={s.id} style={{
            flex: '0 0 260px', background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)',
            borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 120,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={s.hint}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: s.color }} />
              <span style={{ font: `600 11px ${HEAD}`, color: 'var(--text-primary)' }}>{s.label}</span>
              <span style={{ font: `500 11px ${MONO}`, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{col.length}</span>
            </div>
            {col.map(t => <TodoCard key={t.id} todo={t} compact onOpenFile={onOpenFile} />)}
            {!col.length && <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', padding: '6px 2px' }}>—</div>}
          </div>
        )
      })}
    </div>
  )
}

// Declared at module level ON PURPOSE. As a function defined inside Tree it was a NEW component type
// on every render, so React unmounted and remounted the whole subtree whenever the day reloaded —
// which silently collapsed any card the user had open, mid-typing, every time a todo changed.
const Group = ({ open, onToggle, head, children }) => (
  <div style={{ ...PANEL, padding: 0, overflow: 'hidden' }}>
    <div onClick={onToggle}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', cursor: 'pointer', background: 'var(--bg-surface-hover)' }}>
      <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', width: 10 }}>{open ? '▾' : '▸'}</span>
      {head}
    </div>
    {open && <div style={{ padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>}
  </div>
)

function Tree({ todos, onOpenFile }) {
  const { dirs, loose } = useMemo(() => groupByPath(todos), [todos])
  const [closed, setClosed] = useState({})
  const toggle = id => () => setClosed(c => ({ ...c, [id]: !c[id] }))
  if (!dirs.length && !loose.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {dirs.map(d => (
        <Group key={d.dir} open={!closed[d.dir]} onToggle={toggle(d.dir)} head={
          <>
            <span style={{ font: `600 12px ${MONO}`, color: 'var(--text-primary)' }}>▸ {d.dir}</span>
            <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
              {d.done}/{d.count} done · {d.files.length} file{d.files.length === 1 ? '' : 's'}
            </span>
          </>
        }>
          {/* directory-level todos first — they are not "in" any one file */}
          {d.todos.map(t => <TodoCard key={t.id} todo={t} onOpenFile={onOpenFile} />)}
          {d.files.map(f => (
            <div key={f.file} style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ font: `500 11px ${MONO}`, color: 'var(--accent-light)' }}>▤ {f.name}</span>
                <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>{f.done}/{f.count}</span>
              </div>
              {f.todos.map(t => <TodoCard key={t.id} todo={t} onOpenFile={onOpenFile} />)}
            </div>
          ))}
        </Group>
      ))}
      {loose.length > 0 && (
        <Group open={!closed.__loose} onToggle={toggle('__loose')} head={
          <>
            <span style={{ font: `600 12px ${MONO}`, color: 'var(--text-secondary)' }}>not attached to a path</span>
            <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{loose.length}</span>
          </>
        }>
          {loose.map(t => <TodoCard key={t.id} todo={t} onOpenFile={onOpenFile} />)}
        </Group>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// suggestions — what the agent actually did on this day
// ---------------------------------------------------------------------------

function Suggest({ date, root, sug, onRoot }) {
  const [sel, setSel] = useState({})
  const [busy, setBusy] = useState(false)
  useEffect(() => setSel({}), [date, root])
  if (!sug) return <div style={{ ...PANEL, font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>reading transcripts…</div>
  if (!sug.available) {
    return (
      <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ font: `600 13px ${HEAD}` }}>No agent history on this machine</div>
        <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{sug.detail}</div>
      </div>
    )
  }
  const chosen = Object.keys(sel).filter(k => sel[k])
  const add = () => {
    setBusy(true)
    todoApi.importFiles({ root, date, files: chosen, status: 'draft' })
      .then(r => {
        setSel({})
        toast(`${r.added.length} todo(s) filed${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`, 'success')
      })
      .catch(e => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }
  return (
    <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ font: `600 13px ${HEAD}` }}>What the agent touched on {dottedDay(date)}</div>
        <select value={root || ''} onChange={e => onRoot(e.target.value)} aria-label="repo"
          style={{ font: `400 11px ${MONO}` }}>
          {sug.roots.map(r => <option key={r.root} value={r.root}>{r.name} — {r.root}</option>)}
        </select>
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>
          {sug.files} file{sug.files === 1 ? '' : 's'} · {sug.edits} edit{sug.edits === 1 ? '' : 's'}
        </span>
        <button className="primary" style={{ marginLeft: 'auto' }} disabled={!chosen.length || busy} onClick={add}>
          {busy ? 'filing…' : `File ${chosen.length || ''} as Draft`}
        </button>
      </div>
      {!sug.dirs.length ? (
        <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>
          No edits recorded in this repo on this day. Pick another day or another repo — this reads your
          ~/.claude transcripts, so it is empty when the agent did not run, not when there was no work.
        </div>
      ) : sug.dirs.map(d => (
        <div key={d.dir} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ font: `500 11px ${MONO}`, color: 'var(--text-secondary)' }}>
            ▸ {d.dir} <span style={{ color: 'var(--text-tertiary)' }}>· {d.edits} edit{d.edits === 1 ? '' : 's'}{d.failures ? ` · ${d.failures} error${d.failures === 1 ? '' : 's'}` : ''}</span>
          </div>
          {d.files.map(f => (
            <div key={f.file} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 14 }}>
              <Check size={13} checked={!!sel[f.file]} label={f.file} onChange={v => setSel(s => ({ ...s, [f.file]: v }))} />
              <span style={{ font: `400 11px ${MONO}`, color: f.hasTodo ? 'var(--text-tertiary)' : 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.name}{f.hasTodo && <span style={{ color: 'var(--green)' }}> · already filed</span>}
              </span>
              <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>
                {f.edits}× · +{f.add}/-{f.del}{f.failures ? ` · ✕${f.failures}` : ''}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// section
// ---------------------------------------------------------------------------

export default function TodosSection() {
  const [date, setDate] = useSelectedDay()
  const [root, setRoot] = useState('')
  const [view, setView] = useState('board')
  const [showSug, setShowSug] = useState(true)
  const [sug, setSug] = useState(null)
  const { data, err } = useTodoDay(date, root)

  // The suggestion payload is the day's raw agent activity — it re-reads whenever the day or the repo
  // changes, and after an import so "already filed" stops lying.
  const loadSug = () => todoApi.suggest(date, root).then(s => {
    setSug(s)
    if (s.root && s.root !== root) setRoot(s.root)
  }).catch(() => setSug(null))
  useEffect(() => { loadSug() }, [date, root])
  useEffect(() => {
    const on = () => loadSug()
    window.addEventListener('todos-changed', on)
    return () => window.removeEventListener('todos-changed', on)
  }, [date, root])

  // Seed a Claude session with the file's real working context (blast radius, recent hunks, the tool
  // errors already hit on it) — the same hand-off Bugs and Library use, not a new mechanism.
  const openFile = async todo => {
    if (!todo.file) return
    const r = todo.root || root
    if (!r) return toast('this todo is not bound to a repo', 'error')
    const d = await api.get(`/api/fe/dossier?root=${encodeURIComponent(r)}&file=${encodeURIComponent(todo.file)}`)
      .catch(e => { toast(e.message, 'error'); return null })
    if (!d) return
    sessionStorage.setItem('ctx-bundle-prompt', `${d.bundle}\n\n**Todo (${statusMeta(todo.status).label}):** ${todo.title}\n`)
    window.dispatchEvent(new Event('nav-chat'))
  }

  if (err) return <div style={{ ...PANEL, color: 'var(--red)', font: `400 12px ${MONO}` }}>{err}</div>
  if (!data) return <Skeleton tiles={0} rows={6} />

  const dirs = sug?.dirs || []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 56 }}>
      <DayBar date={date} setDate={setDate} stats={data.stats} carry={data.carry.length} ahead={data.ahead} days={data.days} />
      <QuickAdd date={date} root={root} dirs={dirs} />

      {/* Unfinished work from earlier days. Visible and movable, never silently hidden by the date scope. */}
      {data.carry.length > 0 && (
        <div style={{ ...PANEL, borderColor: 'var(--amber)', background: 'var(--amber-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ font: `600 12px ${HEAD}`, color: 'var(--amber)' }}>
              {data.carry.length} unfinished from earlier days
            </span>
            <button className="mini" style={{ marginTop: 0 }}
              onClick={() => todoApi.move(data.carry.map(t => t.id), date).then(() => toast('moved to ' + dottedDay(date), 'success')).catch(e => toast(e.message, 'error'))}>
              pull all into {dottedDay(date)}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
            {data.carry.slice(0, 8).map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', width: 76 }}>{dottedDay(t.date)}</span>
                <StageChip status={t.status} small />
                <span style={{ font: '400 12px var(--body)', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                <button className="mini" style={{ marginTop: 0 }} onClick={() => todoApi.move([t.id], date).catch(e => toast(e.message, 'error'))}>pull</button>
              </div>
            ))}
            {data.carry.length > 8 && <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>…and {data.carry.length - 8} more</span>}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="tabs" style={{ border: 'none' }}>
          <button className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>Board — by stage</button>
          <button className={view === 'tree' ? 'active' : ''} onClick={() => setView('tree')}>Tree — by directory & file</button>
        </div>
        <button className="mini" style={{ marginTop: 0, marginLeft: 'auto' }} onClick={() => setShowSug(s => !s)}>
          {showSug ? 'hide' : 'show'} working-set suggestions
        </button>
      </div>

      {data.todos.length === 0 ? (
        <div style={{ ...PANEL, textAlign: 'center', padding: 24 }}>
          <div style={{ font: `600 14px ${HEAD}` }}>Nothing filed for {dottedDay(date)}</div>
          <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.6 }}>
            Type a line above, or file what the agent already touched that day from the panel below.
          </div>
        </div>
      ) : view === 'board' ? <Board todos={data.todos} onOpenFile={openFile} />
        : <Tree todos={data.todos} onOpenFile={openFile} />}

      {showSug && <Suggest date={date} root={root || sug?.root || ''} sug={sug} onRoot={setRoot} />}
    </div>
  )
}
