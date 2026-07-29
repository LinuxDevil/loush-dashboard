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
  groupByPath, statusMeta, humanMs, PERIODS,
} from '../lib/todos.js'

const MONO = 'var(--mono)'
const HEAD = 'var(--head)'
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 12 }

// ---------------------------------------------------------------------------
// day header
// ---------------------------------------------------------------------------

function DayBar({ date, setDate, stats, carry, ahead, days, settings, onRollNow }) {
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
      {/* Roll-over changes data without the user asking, so it is stated and switchable here rather
          than being a hidden policy someone discovers when yesterday's list appears on today's. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
        <label title="unfinished todos move to the current day automatically, once per day"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: `400 11px ${MONO}`, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!settings?.rollover} style={{ width: 13, height: 13 }}
            onChange={e => todoApi.saveSettings({ rollover: e.target.checked }).catch(err => toast(err.message, 'error'))} />
          roll unfinished forward
        </label>
        <button className="mini" style={{ marginTop: 0 }} onClick={onRollNow} title="move every unfinished todo from earlier days onto this day now">roll now</button>
      </div>
      <div style={{ display: 'flex', gap: 3, width: '100%', justifyContent: 'flex-end' }}>
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

function Board({ todos, onOpenFile, jiraConfig }) {
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
            {col.map(t => <TodoCard key={t.id} todo={t} compact onOpenFile={onOpenFile} jiraConfig={jiraConfig} />)}
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

function Tree({ todos, onOpenFile, jiraConfig }) {
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
          {d.todos.map(t => <TodoCard key={t.id} todo={t} onOpenFile={onOpenFile} jiraConfig={jiraConfig} />)}
          {d.files.map(f => (
            <div key={f.file} style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ font: `500 11px ${MONO}`, color: 'var(--accent-light)' }}>▤ {f.name}</span>
                <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>{f.done}/{f.count}</span>
              </div>
              {f.todos.map(t => <TodoCard key={t.id} todo={t} onOpenFile={onOpenFile} jiraConfig={jiraConfig} />)}
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
          {loose.map(t => <TodoCard key={t.id} todo={t} onOpenFile={onOpenFile} jiraConfig={jiraConfig} />)}
        </Group>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// insights — day / week / month
// ---------------------------------------------------------------------------

const KPI = ({ label, value, sub, tone }) => (
  <div style={{ ...PANEL, padding: '10px 12px', flex: '1 1 140px' }}>
    <div style={{ font: `400 10px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>{label}</div>
    <div style={{ font: `600 20px ${HEAD}`, color: tone || 'var(--text-primary)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    {sub && <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', marginTop: 2 }}>{sub}</div>}
  </div>
)

function Insights({ date, root }) {
  const [period, setPeriod] = useState('day')
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const load = () => todoApi.insights(period, date, root).then(x => { setD(x); setErr(null) }).catch(e => setErr(e.message))
  useEffect(() => { load() }, [period, date, root])
  useEffect(() => {
    const on = () => load()
    window.addEventListener('todos-changed', on)
    return () => window.removeEventListener('todos-changed', on)
  }, [period, date, root])

  const Switch = (
    <div className="tabs" style={{ border: 'none' }}>
      {PERIODS.map(p => (
        <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>
          {p === 'day' ? 'Daily' : p === 'week' ? 'Weekly' : 'Monthly'}
        </button>
      ))}
    </div>
  )
  if (err) return <div style={{ ...PANEL, color: 'var(--red)', font: `400 12px ${MONO}` }}>{err}</div>
  if (!d) return <Skeleton tiles={0} rows={4} />

  const maxBucket = Math.max(1, ...d.series.map(b => Math.max(b.created, b.completed)))
  const maxStage = Math.max(1, ...d.stages.map(s => s.totalMs))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {Switch}
        <span style={{ font: `500 12px ${MONO}`, color: 'var(--text-secondary)' }}>{d.range.label}</span>
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>
          {dottedDay(d.range.from)} → {dottedDay(shiftDay(d.range.to, -1))}
        </span>
      </div>

      {!d.available ? (
        <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ font: `600 13px ${HEAD}` }}>Nothing in this window</div>
          <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{d.detail}</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <KPI label="created" value={d.counts.created} sub={`${d.counts.active} active in window`} />
            <KPI label="completed" value={d.counts.completed} tone={d.counts.completed ? 'var(--green)' : undefined}
              sub={d.completionRate == null ? 'nothing created — rate n/a' : `${d.completionRate}% of what was created`} />
            <KPI label="still open" value={d.counts.open} tone={d.counts.open ? 'var(--amber)' : undefined} />
            <KPI label="rolled forward" value={d.counts.rollovers} tone={d.counts.rollovers ? 'var(--amber)' : undefined}
              sub="times work moved to another day" />
            <KPI label="median lead time" value={d.leadTime.medianMs == null ? '—' : humanMs(d.leadTime.medianMs)}
              sub={d.leadTime.n ? `${d.leadTime.n} completed` : 'no completed todos yet'} />
            <KPI label="linked to JIRA" value={d.counts.linkedToJira} sub={`${d.byJira.length} ticket${d.byJira.length === 1 ? '' : 's'}`} />
          </div>

          {/* time in each column — the answer to "where does the work actually sit" */}
          <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ font: `600 13px ${HEAD}` }}>Time in each column</div>
              <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>
                clipped to this window — a ticket spanning two months is not counted twice
              </span>
              {d.bottleneck && (
                <span style={{ marginLeft: 'auto', font: `500 11px ${MONO}`, color: 'var(--amber)' }}>
                  bottleneck: {statusMeta(d.bottleneck.status).label} · {humanMs(d.bottleneck.totalMs)} across {d.bottleneck.n}
                </span>
              )}
            </div>
            {d.stages.map(s => (
              <div key={s.status} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ font: `500 11px ${MONO}`, color: statusMeta(s.status).color, width: 120, flexShrink: 0 }}>{statusMeta(s.status).label}</span>
                <div style={{ flex: 1, height: 8, background: 'var(--bg-inset)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.round((s.totalMs / maxStage) * 100)}%`, height: '100%', background: statusMeta(s.status).color, opacity: 0.8 }} />
                </div>
                {/* n travels with every aggregate — a 3-day median built from one card must look like one card */}
                <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', width: 210, textAlign: 'right', flexShrink: 0 }}>
                  {s.n ? `${humanMs(s.totalMs)} total · median ${humanMs(s.medianMs)} · n=${s.n}` : '—'}
                </span>
              </div>
            ))}
            {!d.bottleneck && (
              <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>
                No stage has {d.minSample}+ todos in this window yet, so no bottleneck is named — one card is not a trend.
              </div>
            )}
          </div>

          {/* throughput */}
          <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ font: `600 13px ${HEAD}` }}>Created vs completed{d.range.period === 'day' ? ', by hour' : ', by day'}</div>
            {/* An axis with no bars reads as a broken chart. When the window genuinely holds no
                create/complete events — work in flight from earlier days, which is a normal state —
                say that, and keep the (empty) axis below it rather than implying a rendering failure. */}
            {!d.series.some(b => b.created || b.completed) && (
              <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                Nothing was created or completed in this window — the {d.counts.active} active todo
                {d.counts.active === 1 ? '' : 's'} above {d.counts.active === 1 ? 'was' : 'were'} started
                on an earlier day and {d.counts.active === 1 ? 'is' : 'are'} still open.
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 90 }}>
              {d.series.map(b => (
                <div key={b.key} title={`${b.label || b.key}: ${b.created} created, ${b.completed} completed`}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 1, height: '100%' }}>
                  <div style={{ height: `${(b.created / maxBucket) * 45}%`, background: 'var(--blue)', opacity: 0.75, borderRadius: '2px 2px 0 0', minHeight: b.created ? 2 : 0 }} />
                  <div style={{ height: `${(b.completed / maxBucket) * 45}%`, background: 'var(--green)', opacity: 0.85, borderRadius: '0 0 2px 2px', minHeight: b.completed ? 2 : 0 }} />
                  <span style={{ font: `400 8px ${MONO}`, color: 'var(--text-tertiary)', textAlign: 'center' }}>{b.label || b.key}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12, font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>
              <span><span style={{ color: 'var(--blue)' }}>■</span> created</span>
              <span><span style={{ color: 'var(--green)' }}>■</span> completed</span>
            </div>
          </div>

          <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* aging — the honest cost of roll-over */}
            <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ font: `600 13px ${HEAD}` }}>Carried forward the longest</div>
              {!d.aging.length ? (
                <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>Nothing has been rolled forward — every open todo was filed for the day it sits on.</div>
              ) : d.aging.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ font: `600 11px ${MONO}`, color: a.days >= 3 ? 'var(--red)' : 'var(--amber)', width: 46 }}>{a.days}d</span>
                  <StageChip status={a.status} small />
                  <span style={{ font: '400 12px var(--body)', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
                  {a.jira && <span style={{ font: `500 10px ${MONO}`, color: 'var(--text-tertiary)' }}>{a.jira}</span>}
                </div>
              ))}
            </div>

            {/* where the work lives, in the code and on the board */}
            <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ font: `600 13px ${HEAD}` }}>By directory</div>
              {!d.byDir.length ? (
                <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>No todo in this window is bound to a path yet.</div>
              ) : d.byDir.map(x => (
                <div key={x.dir} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ font: `500 11px ${MONO}`, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>▸ {x.dir}</span>
                  <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>{x.done}/{x.total} done{x.open ? ` · ${x.open} open` : ''}</span>
                </div>
              ))}
            </div>
          </div>

          {d.byJira.length > 0 && (
            <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ font: `600 13px ${HEAD}` }}>By JIRA ticket</div>
              {d.byJira.map(j => (
                <div key={j.key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {j.url ? <a href={j.url} target="_blank" rel="noreferrer" style={{ font: `600 11px ${MONO}`, color: 'var(--text-link)', width: 110 }}>{j.key} ↗</a>
                    : <span style={{ font: `600 11px ${MONO}`, color: 'var(--text-primary)', width: 110 }}>{j.key}</span>}
                  <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', width: 130 }}>{j.done}/{j.total} done{j.open ? ` · ${j.open} open` : ''}</span>
                  <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>
                    {STATUSES.filter(s => j.msByStage[s.id] > 0).map(s => (
                      <span key={s.id}><span style={{ color: s.color }}>●</span> {s.label} {humanMs(j.msByStage[s.id])}</span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
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
      <DayBar date={date} setDate={setDate} stats={data.stats} carry={data.carry.length} ahead={data.ahead} days={data.days}
        settings={data.settings}
        onRollNow={() => todoApi.rollover(date)
          .then(r => toast(r.moved.length ? `${r.moved.length} unfinished todo(s) moved to ${dottedDay(r.date)}` : 'nothing to roll forward', r.moved.length ? 'success' : 'info'))
          .catch(e => toast(e.message, 'error'))} />
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
          <button className={view === 'insights' ? 'active' : ''} onClick={() => setView('insights')}>Insights — daily · weekly · monthly</button>
        </div>
        {view !== 'insights' && (
          <button className="mini" style={{ marginTop: 0, marginLeft: 'auto' }} onClick={() => setShowSug(s => !s)}>
            {showSug ? 'hide' : 'show'} working-set suggestions
          </button>
        )}
      </div>

      {view === 'insights' ? <Insights date={date} root={root} />
        : data.todos.length === 0 ? (
        <div style={{ ...PANEL, textAlign: 'center', padding: 24 }}>
          <div style={{ font: `600 14px ${HEAD}` }}>Nothing filed for {dottedDay(date)}</div>
          <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.6 }}>
            Type a line above, or file what the agent already touched that day from the panel below.
          </div>
        </div>
      ) : view === 'board' ? <Board todos={data.todos} onOpenFile={openFile} jiraConfig={data.jiraConfig} />
        : <Tree todos={data.todos} onOpenFile={openFile} jiraConfig={data.jiraConfig} />}

      {showSug && view !== 'insights' && <Suggest date={date} root={root || sug?.root || ''} sug={sug} onRoot={setRoot} />}
    </div>
  )
}
