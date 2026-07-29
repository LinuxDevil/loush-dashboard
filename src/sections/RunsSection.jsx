import React, { useEffect, useState } from 'react'
import { api, toast, fmtSize } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import { deriveRunMetrics, fmtDur, relTime } from '../lib/runMetrics.js'
import { useVisiblePoll } from '../lib/hooks.js'

const MONO = "var(--mono)"
const HEAD = "var(--head)"
const SANS = 'var(--body)'
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12, padding: '16px 18px' }
const STATUS = { unknown: 'var(--text-tertiary)', running: 'var(--blue)', completed: 'var(--green)', failed: 'var(--red)', aborted: 'var(--accent-light)', blocked: 'var(--violet)' }
const sc = s => STATUS[s] || STATUS.unknown
const VERDICT = { PASSING: 'var(--green)', BLOCKED: 'var(--red)', 'NEEDS-HUMAN': 'var(--violet)' }
const artifactName = flow => (flow === 'test-cases' || flow === 'jira-implement') ? 'test-cases/test-plan.md' : 'review.md'

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

function Dispatch({ projects, flows, onDone }) {
  const [open, setOpen] = useState(false)
  const [proj, setProj] = useState('')
  const [flow, setFlow] = useState(flows[0] || '')
  const [ticket, setTicket] = useState('')
  const [busy, setBusy] = useState(false)
  const go = () => {
    if (!proj || !ticket.trim()) return alert('pick a project and a ticket')
    setBusy(true)
    api.post('/api/runs/dispatch', { proj, flow, ticket: ticket.trim() })
      .then(() => { toast(`dispatched ${flow} · ${ticket.trim()}`, 'success'); setTicket(''); setOpen(false); onDone() })
      .catch(e => alert(e.message)).finally(() => setBusy(false))
  }
  if (!open) return <button style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>＋ dispatch a run</button>
  return (
    <div style={{ ...PANEL, padding: '14px 18px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)' }}>Dispatch a run</span>
      <select value={proj} onChange={e => setProj(e.target.value)}><option value="">pick project…</option>{projects.map(p => <option key={p.path} value={p.path}>{p.name}</option>)}</select>
      <select value={flow} onChange={e => setFlow(e.target.value)}>{flows.map(fl => <option key={fl}>{fl}</option>)}</select>
      <input value={ticket} onChange={e => setTicket(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder="ticket (e.g. ABC-123)" style={{ width: 180 }} />
      <button className="primary" disabled={busy} onClick={go}>{busy ? 'starting…' : '▸ Start'}</button>
      <button disabled={busy} onClick={() => setOpen(false)}>cancel</button>
      <span className="small" style={{ flexBasis: '100%', color: 'var(--text-tertiary)' }}>runs <code>claude -p /{flow || '…'} &lt;ticket&gt;</code> in the repo · appears below as running once it writes .loush/</span>
    </div>
  )
}

function Kpis({ runs }) {
  const done = runs.filter(r => r.endedAt && r.startedAt)
  const avg = done.length ? done.reduce((s, r) => s + (r.endedAt - r.startedAt), 0) / done.length : null
  const k = (label, val, color) => (
    <div style={{ ...PANEL, padding: '12px 16px', flex: 1, minWidth: 120 }}>
      <div style={{ font: `700 18px ${HEAD}`, color: color || 'var(--text-primary)' }}>{val}</div>
      <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{label}</div>
    </div>
  )
  const n = s => runs.filter(r => r.status === s).length
  const totalCost = runs.reduce((s, r) => s + (r.cost || 0), 0)
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {k('total runs', runs.length)}
      {k('running', n('running'), STATUS.running)}
      {k('failed', n('failed'), STATUS.failed)}
      {k('needs approval', runs.filter(r => r.verdict === 'NEEDS-HUMAN').length, VERDICT['NEEDS-HUMAN'])}
      {k('avg duration', fmtDur(avg))}
      {k('est. cost', totalCost ? '$' + totalCost.toFixed(2) : '—')}
    </div>
  )
}

function Approval({ run, onDone }) {
  const [content, setContent] = useState(null)
  const [note, setNote] = useState('')
  const name = artifactName(run.flow)
  useEffect(() => {
    api.get(`/api/runs/artifact?proj=${encodeURIComponent(run.proj)}&ticket=${encodeURIComponent(run.ticket)}&name=${encodeURIComponent(name)}`)
      .then(d => setContent(d.content)).catch(() => setContent('(artifact not found — ' + name + ')'))
  }, [run.proj, run.ticket])
  const decide = decision => api.post('/api/runs/approve', {
    proj: run.proj, ticket: run.ticket, decision, artifact: name.split('/').pop().replace('.md', ''),
    comments: note.trim() ? [{ section: 'general', note: note.trim() }] : [],
  }).then(onDone).catch(e => alert(e.message))
  return (
    <div style={{ border: '1px solid var(--violet)', background: 'var(--violet-bg)', borderRadius: 6, padding: 12 }}>
      <div style={{ font: `600 12px ${HEAD}`, color: STATUS.blocked, marginBottom: 8 }}>⏸ Awaiting approval — {name}</div>
      <pre style={{ margin: 0, font: `400 11px/1.5 ${MONO}`, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto', background: 'var(--bg-inset)', borderRadius: 8, padding: 10 }}>{content ?? 'loading…'}</pre>
      <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="revision note (required for revise)" style={{ width: '100%', marginTop: 8 }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="primary" onClick={() => decide('approve')}>✓ Approve</button>
        <button onClick={() => note.trim() ? decide('revise') : alert('add a revision note')}>↻ Request revision</button>
      </div>
    </div>
  )
}

const PRE = { margin: 0, font: `400 11px/1.6 ${MONO}`, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 420, overflow: 'auto', background: 'var(--bg-inset)', borderRadius: 12, padding: '16px 18px' }

function FileBody({ name, content }) {
  if (content == null) return <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>loading…</div>
  if (name.endsWith('.diff') || name.endsWith('.patch')) {
    return (
      <pre style={PRE}>{content.split('\n').map((ln, i) => {
        const col = (ln.startsWith('+') && !ln.startsWith('+++')) ? 'var(--green)'
          : (ln.startsWith('-') && !ln.startsWith('---')) ? 'var(--red)'
          : ln.startsWith('@@') ? 'var(--blue)' : (ln.startsWith('diff ') || ln.startsWith('index ')) ? 'var(--text-tertiary)' : 'var(--text-secondary)'
        return <div key={i} style={{ color: col }}>{ln || ' '}</div>
      })}</pre>
    )
  }
  return <pre style={PRE}>{content}</pre>
}

function RunFiles({ run }) {
  const [files, setFiles] = useState(null)
  const [open, setOpen] = useState(null)
  const [body, setBody] = useState(null)
  useEffect(() => {
    api.get(`/api/runs/files?proj=${encodeURIComponent(run.proj)}&ticket=${encodeURIComponent(run.ticket)}`)
      .then(d => setFiles(d.files)).catch(() => setFiles([]))
  }, [run.proj, run.ticket])
  const view = name => {
    if (open === name) { setOpen(null); setBody(null); return }
    setOpen(name); setBody(null)
    api.get(`/api/runs/artifact?proj=${encodeURIComponent(run.proj)}&ticket=${encodeURIComponent(run.ticket)}&name=${encodeURIComponent(name)}`)
      .then(d => setBody(d.content)).catch(e => setBody('(could not load — ' + e.message + ')'))
  }
  if (!files) return null
  if (!files.length) return <Dim>no files in .loush/{run.ticket}/</Dim>
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ font: `600 12px ${HEAD}` }}>Files</div>
      {files.map(f => (
        <div key={f.name}>
          <div onClick={() => view(f.name)} style={{ display: 'flex', gap: 8, alignItems: 'baseline', cursor: 'pointer', font: `400 11px ${MONO}`, padding: '2px 0' }}>
            <span style={{ color: open === f.name ? ACCENT : 'var(--blue)' }}>{open === f.name ? '▾' : '▸'} {f.name}</span>
            <Dim style={{ marginLeft: 'auto' }}>{fmtSize(f.size)}</Dim>
          </div>
          {open === f.name && (
            <div style={{ marginBottom: 6 }}>
              <button className="mini" style={{ marginTop: 0, marginBottom: 4 }} onClick={() => body != null && navigator.clipboard.writeText(body).then(() => toast(f.name + ' copied', 'success'))}>copy</button>
              <FileBody name={f.name} content={body} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const Dim = ({ children, style }) => <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', ...style }}>{children}</span>
const ACCENT = 'var(--blue)'

const DECISION_COLOR = { REQUEST_CHANGES: 'var(--accent-light)', APPROVE: 'var(--green)', APPROVED: 'var(--green)', BLOCKED: 'var(--red)' }

function Detail({ run, onDone }) {
  const [events, setEvents] = useState(null)
  const [showRaw, setShowRaw] = useState(false)
  useEffect(() => {
    let seq = 0, live = true
    const poll = () => api.get(`/api/runs/events?proj=${encodeURIComponent(run.proj)}&ticket=${encodeURIComponent(run.ticket)}&after=${seq}`)
      .then(d => {
        if (!live || !d.events.length) return
        seq = d.events[d.events.length - 1].seq || seq
        setEvents(prev => [...(prev || []), ...d.events])
        if (d.events.some(e => e.type === 'run.completed' || e.type === 'run.failed')) live = false
      }).catch(() => {})
    setEvents([]); poll()
    const t = setInterval(() => { if (live) poll() }, 5000)
    return () => { live = false; clearInterval(t) }
  }, [run.proj, run.ticket])
  const m = deriveRunMetrics(events || [])
  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
      <div style={{ display: 'flex', gap: 18, font: `400 11px ${MONO}`, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
        <span>status <b style={{ color: sc(m.status) }}>{m.status}</b></span>
        <span>duration <b style={{ color: 'var(--text-primary)' }}>{fmtDur(m.durationMs)}</b></span>
        <span>steps <b style={{ color: 'var(--text-primary)' }}>{m.steps.length}</b></span>
        <span>tool calls <b style={{ color: 'var(--text-primary)' }}>{m.toolCalls}</b></span>
        {run.cost != null && <span title="estimated from transcript token usage in this run's time window">est. cost <b style={{ color: 'var(--green)' }}>${run.cost.toFixed(3)}</b></span>}
        {run.retries && <span>retries <b style={{ color: 'var(--accent-light)' }}>{Object.entries(run.retries).map(([k, v]) => `${k}:${v}`).join(' ')}</b></span>}
      </div>
      {(run.decision || run.branch || run.note) && (
        <div style={{ display: 'grid', gap: 6, background: 'var(--bg-inset)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', font: `400 11px ${MONO}` }}>
            {run.decision && <span style={{ font: `600 10px ${MONO}`, color: DECISION_COLOR[run.decision] || 'var(--text-secondary)', background: (DECISION_COLOR[run.decision] || 'var(--text-secondary)') + '18', borderRadius: 5, padding: '2px 7px' }}>{run.decision.replace(/_/g, ' ')}</span>}
            {run.branch && <span style={{ color: 'var(--text-secondary)' }}>branch <b style={{ color: 'var(--text-primary)' }}>{run.branch}</b>{run.base ? <> → <b style={{ color: 'var(--text-primary)' }}>{run.base}</b></> : ''}</span>}
            {run.headSha && <span style={{ color: 'var(--text-tertiary)' }}>@ {String(run.headSha).slice(0, 7)}</span>}
          </div>
          {run.note && <div style={{ font: `400 12px ${SANS}`, color: 'var(--text-secondary)' }}>{run.note}</div>}
        </div>
      )}

      {run.awaitingApproval && <Approval run={run} onDone={onDone} />}

      <RunFiles run={run} />

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{ font: `600 12px ${HEAD}` }}>Timeline</div>
          {events?.length > 0 && <button className="mini" style={{ marginTop: 0 }} onClick={() => setShowRaw(r => !r)}>{showRaw ? 'hide raw' : 'raw events'}</button>}
          {events?.length > 0 && <button className="mini" style={{ marginTop: 0 }} onClick={() => navigator.clipboard.writeText(events.map(e => JSON.stringify(e)).join('\n')).then(() => toast('events.jsonl copied', 'success'))}>copy events</button>}
        </div>
        {events === null && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>loading events…</div>}
        {events && !m.steps.length && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no step events yet</div>}
        {m.steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0', font: `400 11px ${MONO}` }}>
            <span style={{ color: sc(s.status) }}>●</span>
            <span style={{ color: 'var(--text-primary)', flex: 1 }}>{s.label}{s.agent ? <span style={{ color: 'var(--text-tertiary)' }}> · {s.agent}</span> : ''}</span>
            {s.decision && <span style={{ color: 'var(--blue)' }}>{s.decision}{s.findings != null ? ` (${s.findings})` : ''}</span>}
            <span style={{ color: 'var(--text-tertiary)' }}>{fmtDur(s.ms)}</span>
          </div>
        ))}
        {showRaw && events && (
          <pre style={{ ...PRE, marginTop: 8 }}>{events.map(e => `${e.t ? new Date(e.t).toLocaleTimeString() : '—'}  ${e.type || '?'}${e.data && Object.keys(e.data).length ? '  ' + JSON.stringify(e.data) : ''}`).join('\n')}</pre>
        )}
      </div>

      {m.outputs?.length > 0 && (
        <div>
          <div style={{ font: `600 12px ${HEAD}`, marginBottom: 6 }}>Notes</div>
          <pre style={PRE}>{m.outputs.map(o => o.text).join('\n\n')}</pre>
        </div>
      )}
    </div>
  )
}

export default function RunsSection() {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [f, setF] = useState(readFilters)
  const load = () => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v).map(([k, v]) => [k, v])).toString()
    api.get('/api/runs' + (q ? '?' + q : '')).then(setData).catch(() => {})
  }
  useEffect(() => { writeFilters(f) }, [f])
  useVisiblePoll(load, 5000, [f])
  if (!data) return <Skeleton tiles={0} rows={6} />

  const runs = data.runs
  const setFilter = (k, v) => setF(p => ({ ...p, [k]: v }))
  const activePills = Object.entries(f).filter(([, v]) => v)
  const approvable = runs.filter(r => r.verdict === 'NEEDS-HUMAN')
  const rid = r => r.proj + ':' + r.ticket
  const toggleSel = r => setSelected(p => { const n = new Set(p); n.has(rid(r)) ? n.delete(rid(r)) : n.add(rid(r)); return n })
  const approveBatch = list => {
    if (!list.length) return
    api.post('/api/runs/approve-batch', {
      decision: 'approve',
      runs: list.map(r => ({ proj: r.proj, ticket: r.ticket, artifact: artifactName(r.flow).split('/').pop().replace('.md', '') })),
    }).then(d => { toast(`approved ${d.results.filter(x => x.ok).length}/${d.results.length} run${d.results.length === 1 ? '' : 's'}`, d.ok ? 'success' : 'error'); setSelected(new Set()); load() })
      .catch(e => alert(e.message))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Dispatch projects={data.allProjects || []} flows={data.dispatchFlows || []} onDone={load} />
      <Kpis runs={runs} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={f.ticket} onChange={e => setFilter('ticket', e.target.value)} placeholder="search ticket…" style={{ width: 160 }} />
        <select value={f.proj} onChange={e => setFilter('proj', e.target.value)}><option value="">all projects</option>{data.projects.map(p => <option key={p}>{p}</option>)}</select>
        <select value={f.flow} onChange={e => setFilter('flow', e.target.value)}><option value="">all flows</option>{data.flows.map(fl => <option key={fl}>{fl}</option>)}</select>
        <select value={f.status} onChange={e => setFilter('status', e.target.value)}><option value="">all statuses</option>{Object.keys(STATUS).map(s => <option key={s}>{s}</option>)}</select>
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{runs.length} run{runs.length === 1 ? '' : 's'}</span>
      </div>
      {activePills.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {activePills.map(([k, v]) => (
            <span key={k} onClick={() => setFilter(k, '')} style={{ cursor: 'pointer', font: `400 11px ${MONO}`, color: 'var(--text-primary)', background: 'var(--bg-surface-hover)', borderRadius: 8, padding: '3px 10px' }}>{k}: {v} ✕</span>
          ))}
        </div>
      )}
      {approvable.length > 0 && (
        <div style={{ ...PANEL, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, borderLeft: `3px solid ${VERDICT['NEEDS-HUMAN']}` }}>
          <span style={{ font: `500 11px ${MONO}`, color: 'var(--text-secondary)' }}>{approvable.length} run{approvable.length === 1 ? '' : 's'} converged & awaiting approval{selected.size ? ` · ${selected.size} selected` : ''}</span>
          {selected.size > 0 && <button onClick={() => approveBatch(approvable.filter(r => selected.has(rid(r))))}>✓ Approve selected ({selected.size})</button>}
          <button className="primary" style={{ marginLeft: 'auto' }} onClick={() => approveBatch(approvable)}>✓ Approve all converged</button>
        </div>
      )}
      {runs.map(r => {
        const id = r.proj + ':' + r.ticket
        return (
          <div key={id} style={{ ...PANEL, padding: '14px 18px', borderLeft: `3px solid ${sc(r.status)}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpen(open === id ? null : id)}>
              {r.verdict === 'NEEDS-HUMAN' && <input type="checkbox" checked={selected.has(id)} onClick={e => e.stopPropagation()} onChange={() => toggleSel(r)} title="select for batch approve" />}
              <span style={{ color: sc(r.status) }}>●</span>
              <span style={{ font: "600 14px var(--body)", color: 'var(--text-primary)' }}>{r.ticket}</span>
              {r.flow && <span style={{ font: `500 10px ${MONO}`, color: 'var(--blue)', background: 'var(--blue-bg)', borderRadius: 5, padding: '2px 7px' }}>{r.flow}</span>}
              {r.phase && <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>{r.phase}{r.phaseStatus ? ` · ${r.phaseStatus}` : ''}</span>}
              {r.verdict && <span style={{ font: `600 10px ${MONO}`, color: VERDICT[r.verdict], background: VERDICT[r.verdict] + '18', borderRadius: 5, padding: '2px 7px' }}>{r.verdict}</span>}
              <span style={{ font: `500 11px ${MONO}`, color: sc(r.status), marginLeft: 'auto' }}>{r.status}</span>
              <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{r.projName} · {relTime(r.updatedAt)}</span>
            </div>
            {open === id && <Detail run={r} onDone={load} />}
          </div>
        )
      })}
      {runs.length === 0 && <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>no loush runs found — they appear here once a flow writes .loush/&lt;ticket&gt;/state.json or events.jsonl in a known repo</div>}
      <p className="small">runs are read live from each repo's .loush/&lt;ticket&gt;/ · timeline + metrics derive from events.jsonl (contract §13) · blocked runs can be approved/revised here (contract §16) · filters are URL-shareable</p>
    </div>
  )
}
