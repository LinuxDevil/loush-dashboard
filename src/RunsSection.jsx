import React, { useEffect, useState } from 'react'
import { api, toast } from './api.js'
import Skeleton from './Skeleton.jsx'
import { deriveRunMetrics, fmtDur, relTime } from './runMetrics.js'
import { useVisiblePoll } from './hooks.js'

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }
// queued gray / running blue / completed green / failed red / aborted orange / blocked purple (feature 10)
const STATUS = { unknown: '#6a6f78', running: '#5eb3f6', completed: '#3fb96a', failed: '#e5484d', aborted: '#e8a06a', blocked: '#a06ae5' }
const sc = s => STATUS[s] || STATUS.unknown

// URL-driven filters (feature 7): shareable, back/forward works, removable pills.
const FKEYS = { proj: 'runProj', flow: 'runFlow', status: 'runStatus', ticket: 'runQ' }
function readFilters() {
  const q = new URLSearchParams(window.location.search)
  return Object.fromEntries(Object.entries(FKEYS).map(([k, p]) => [k, q.get(p) || '']))
}
function writeFilters(f) {
  const q = new URLSearchParams(window.location.search)
  for (const [k, p] of Object.entries(FKEYS)) f[k] ? q.set(p, f[k]) : q.delete(p)
  history.replaceState(null, '', window.location.pathname + (q.toString() ? '?' + q : ''))
}

function Kpis({ runs }) {
  const done = runs.filter(r => r.endedAt && r.startedAt)
  const avg = done.length ? done.reduce((s, r) => s + (r.endedAt - r.startedAt), 0) / done.length : null
  const k = (label, val, color) => (
    <div style={{ ...PANEL, padding: '12px 16px', flex: 1, minWidth: 120 }}>
      <div style={{ font: `700 22px ${HEAD}`, color: color || '#e5dbd2' }}>{val}</div>
      <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{label}</div>
    </div>
  )
  const n = s => runs.filter(r => r.status === s).length
  const totalCost = runs.reduce((s, r) => s + (r.cost || 0), 0)
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {k('total runs', runs.length)}
      {k('running', n('running'), STATUS.running)}
      {k('failed', n('failed'), STATUS.failed)}
      {k('blocked', n('blocked'), STATUS.blocked)}
      {k('avg duration', fmtDur(avg))}
      {k('est. cost', totalCost ? '$' + totalCost.toFixed(2) : '—')}
    </div>
  )
}

function Approval({ run, onDone }) {
  const [content, setContent] = useState(null)
  const [note, setNote] = useState('')
  const name = run.flow === 'test-cases' || run.flow === 'jira-implement' ? 'test-cases/test-plan.md' : 'review.md'
  useEffect(() => {
    api.get(`/api/runs/artifact?proj=${encodeURIComponent(run.proj)}&ticket=${encodeURIComponent(run.ticket)}&name=${encodeURIComponent(name)}`)
      .then(d => setContent(d.content)).catch(() => setContent('(artifact not found — ' + name + ')'))
  }, [run.proj, run.ticket])
  const decide = decision => api.post('/api/runs/approve', {
    proj: run.proj, ticket: run.ticket, decision, artifact: name.split('/').pop().replace('.md', ''),
    comments: note.trim() ? [{ section: 'general', note: note.trim() }] : [],
  }).then(onDone).catch(e => alert(e.message))
  return (
    <div style={{ border: '1px solid rgba(160,106,229,0.3)', background: 'rgba(160,106,229,0.06)', borderRadius: 10, padding: 12 }}>
      <div style={{ font: `600 12px ${HEAD}`, color: STATUS.blocked, marginBottom: 8 }}>⏸ Awaiting approval — {name}</div>
      <pre style={{ margin: 0, font: `400 10.5px/1.5 ${MONO}`, color: '#b0a69e', whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto', background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: 10 }}>{content ?? 'loading…'}</pre>
      <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="revision note (required for revise)" style={{ width: '100%', marginTop: 8 }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="primary" onClick={() => decide('approve')}>✓ Approve</button>
        <button onClick={() => note.trim() ? decide('revise') : alert('add a revision note')}>↻ Request revision</button>
      </div>
    </div>
  )
}

function Detail({ run, onDone }) {
  const [events, setEvents] = useState(null)
  useEffect(() => {
    let seq = 0, live = true
    const poll = () => api.get(`/api/runs/events?proj=${encodeURIComponent(run.proj)}&ticket=${encodeURIComponent(run.ticket)}&after=${seq}`)
      .then(d => {
        if (!live || !d.events.length) return
        seq = d.events[d.events.length - 1].seq || seq
        setEvents(prev => [...(prev || []), ...d.events])
        if (d.events.some(e => e.type === 'run.completed' || e.type === 'run.failed')) live = false // stop on terminal (feature 5)
      }).catch(() => {})
    setEvents([]); poll()
    const t = setInterval(() => { if (live) poll() }, 5000)
    return () => { live = false; clearInterval(t) }
  }, [run.proj, run.ticket])
  const m = deriveRunMetrics(events || [])
  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
      <div style={{ display: 'flex', gap: 18, font: `400 11px ${MONO}`, color: '#b0a69e', flexWrap: 'wrap' }}>
        <span>status <b style={{ color: sc(m.status) }}>{m.status}</b></span>
        <span>duration <b style={{ color: '#e5dbd2' }}>{fmtDur(m.durationMs)}</b></span>
        <span>steps <b style={{ color: '#e5dbd2' }}>{m.steps.length}</b></span>
        <span>tool calls <b style={{ color: '#e5dbd2' }}>{m.toolCalls}</b></span>
        {run.cost != null && <span title="estimated from transcript token usage in this run's time window">est. cost <b style={{ color: '#3fb96a' }}>${run.cost.toFixed(3)}</b></span>}
        {run.retries && <span>retries <b style={{ color: '#e8a06a' }}>{Object.entries(run.retries).map(([k, v]) => `${k}:${v}`).join(' ')}</b></span>}
      </div>
      {run.awaitingApproval && <Approval run={run} onDone={onDone} />}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{ font: `600 12px ${HEAD}` }}>Timeline</div>
          {events?.length > 0 && <button className="mini" style={{ marginTop: 0 }} onClick={() => navigator.clipboard.writeText(events.map(e => JSON.stringify(e)).join('\n')).then(() => toast('events.jsonl copied', 'success'))}>copy events</button>}
        </div>
        {events === null && <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>loading events…</div>}
        {events && !m.steps.length && <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>no step events yet</div>}
        {m.steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0', font: `400 11px ${MONO}` }}>
            <span style={{ color: sc(s.status) }}>●</span>
            <span style={{ color: '#e5dbd2', flex: 1 }}>{s.label}{s.agent ? <span style={{ color: '#7a716a' }}> · {s.agent}</span> : ''}</span>
            {s.decision && <span style={{ color: '#7cc4f7' }}>{s.decision}{s.findings != null ? ` (${s.findings})` : ''}</span>}
            <span style={{ color: '#7a716a' }}>{fmtDur(s.ms)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function RunsSection() {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)
  const [f, setF] = useState(readFilters)
  const load = () => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v).map(([k, v]) => [k, v])).toString()
    api.get('/api/runs' + (q ? '?' + q : '')).then(setData).catch(() => {})
  }
  useEffect(() => { writeFilters(f) }, [f])
  useVisiblePoll(load, 5000, [f]) // poll every 5s, paused while tab hidden
  if (!data) return <Skeleton tiles={0} rows={6} />

  const runs = data.runs
  const setFilter = (k, v) => setF(p => ({ ...p, [k]: v }))
  const activePills = Object.entries(f).filter(([, v]) => v)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Kpis runs={runs} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={f.ticket} onChange={e => setFilter('ticket', e.target.value)} placeholder="search ticket…" style={{ width: 160 }} />
        <select value={f.proj} onChange={e => setFilter('proj', e.target.value)}><option value="">all projects</option>{data.projects.map(p => <option key={p}>{p}</option>)}</select>
        <select value={f.flow} onChange={e => setFilter('flow', e.target.value)}><option value="">all flows</option>{data.flows.map(fl => <option key={fl}>{fl}</option>)}</select>
        <select value={f.status} onChange={e => setFilter('status', e.target.value)}><option value="">all statuses</option>{Object.keys(STATUS).map(s => <option key={s}>{s}</option>)}</select>
        <span style={{ font: `400 11px ${MONO}`, color: '#7a716a', marginLeft: 'auto' }}>{runs.length} run{runs.length === 1 ? '' : 's'}</span>
      </div>
      {activePills.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {activePills.map(([k, v]) => (
            <span key={k} onClick={() => setFilter(k, '')} style={{ cursor: 'pointer', font: `400 10.5px ${MONO}`, color: '#e5dbd2', background: 'rgba(255,255,255,0.06)', borderRadius: 20, padding: '3px 10px' }}>{k}: {v} ✕</span>
          ))}
        </div>
      )}
      {runs.map(r => {
        const id = r.proj + ':' + r.ticket
        return (
          <div key={id} style={{ ...PANEL, padding: '14px 18px', borderLeft: `3px solid ${sc(r.status)}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpen(open === id ? null : id)}>
              <span style={{ color: sc(r.status) }}>●</span>
              <span style={{ font: "600 13.5px 'IBM Plex Sans'", color: '#e5dbd2' }}>{r.ticket}</span>
              {r.flow && <span style={{ font: `500 10px ${MONO}`, color: '#7cc4f7', background: 'rgba(124,196,247,0.08)', borderRadius: 5, padding: '2px 7px' }}>{r.flow}</span>}
              {r.phase && <span style={{ font: `400 10.5px ${MONO}`, color: '#b0a69e' }}>{r.phase}{r.phaseStatus ? ` · ${r.phaseStatus}` : ''}</span>}
              {r.awaitingApproval && <span style={{ font: `600 10px ${MONO}`, color: STATUS.blocked }}>⏸ needs approval</span>}
              <span style={{ font: `500 10.5px ${MONO}`, color: sc(r.status), marginLeft: 'auto' }}>{r.status}</span>
              <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{r.projName} · {relTime(r.updatedAt)}</span>
            </div>
            {open === id && <Detail run={r} onDone={load} />}
          </div>
        )
      })}
      {runs.length === 0 && <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: '#7a716a' }}>no loush runs found — they appear here once a flow writes .loush/&lt;ticket&gt;/state.json or events.jsonl in a known repo</div>}
      <p className="small">runs are read live from each repo's .loush/&lt;ticket&gt;/ · timeline + metrics derive from events.jsonl (contract §13) · blocked runs can be approved/revised here (contract §16) · filters are URL-shareable</p>
    </div>
  )
}
