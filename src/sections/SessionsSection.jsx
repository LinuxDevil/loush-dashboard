import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, toast } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import { Stagger, CountUp } from '../ui/anim.jsx'

// ---------- 10: session ledger — real $, terminal escape hatches, keyboard layer ----------
const MONO = "var(--mono)"
const HEAD = "var(--head)"
const RED = 'var(--red)', GOLD = 'var(--amber)', GREEN = 'var(--green)', DIM = 'var(--text-secondary)'
const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)))
const fmtDur = ms => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m` }
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd' }

const NAME_SOURCE = {
  custom: 'you titled this session (/rename, claude -n, or Ctrl+R in the picker)',
  ai: 'auto-generated title from the conversation',
  prompt: 'no title was ever set — this is the first thing you asked, truncated',
}

const COLS = [
  ['name', 'Session', r => r.name || r.sessionId],
  ['project', 'Project', r => r.project], ['branch', 'Branch', r => r.branch || ''],
  ['cost', '$', r => r.cost], ['out', 'Out tok', r => r.out], ['cacheReadPct', 'Cache read', r => r.cacheReadPct],
  ['durationMs', 'Duration', r => r.durationMs], ['toolCalls', 'Tools', r => r.toolCalls],
  ['compactions', 'Compact', r => r.compactions], ['errors', 'Errors', r => r.errors], ['last', 'Last', r => r.last],
]

function SessionEvents({ sessionId }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.get('/api/session/events?session=' + encodeURIComponent(sessionId)).then(setD).catch(e => setErr(e.message)) }, [sessionId])
  if (err) return <div style={{ font: '400 11px var(--mono)', color: 'var(--red)', padding: 8 }}>{err}</div>
  if (!d) return <div style={{ font: '400 11px var(--mono)', color: 'var(--text-tertiary)', padding: 8 }}>reading transcript…</div>
  const groups = d.groups || []
  return (
    <div style={{ padding: '6px 0 10px', font: '400 11px var(--mono)' }}>
      <div style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
        {groups.length} rows
        {}
        {d.truncated?.omitted > 0 && ` · ${d.truncated.omitted} omitted by the ${d.truncated.limit} row cap`}
        {d.counts?.sidechainUnlinked > 0 && ` · ${d.counts.sidechainUnlinked} subagent record(s) carry no parent link and could not be nested`}
        {d.unparsableLines > 0 && ` · ${d.unparsableLines} unparsable line(s)`}
      </div>
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {groups.map((g, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0', alignItems: 'baseline' }}>
            <span style={{ color: g.status === 'error' ? 'var(--red)' : g.status === 'running' ? 'var(--amber, #d79921)' : 'var(--text-tertiary)', width: 58, flexShrink: 0 }}>{g.status || g.kind || ''}</span>
            <span style={{ color: 'var(--text-secondary)', flex: 1 }}>
              {g.title}{g.count > 1 && <span style={{ color: 'var(--text-tertiary)' }}> ×{g.count}</span>}
              {g.enclosingContext && <span style={{ color: 'var(--violet)' }}> · in {g.enclosingContext}</span>}
            </span>
            {g.summary && <span style={{ color: 'var(--text-tertiary)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.summary}>{g.summary}</span>}
          </div>
        ))}
        {groups.length === 0 && <div style={{ color: 'var(--text-tertiary)' }}>no tool calls recorded in this session</div>}
      </div>
    </div>
  )
}

export default function SessionsSection() {
  const [days, setDays] = useState(7)
  const [d, setD] = useState(null)
  const [usage, setUsage] = useState(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState({ col: 'last', dir: -1 })
  const [cur, setCur] = useState(0)
  const [events, setEvents] = useState(null)
  const filterRef = useRef(null)
  const bodyRef = useRef(null)

  const [qLive, setQLive] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQLive(q), 300)
    return () => clearTimeout(t)
  }, [q])
  const [pending, setPending] = useState(false)
  useEffect(() => {
    setPending(true)
    api.get(`/api/sessions?days=${days}&limit=200&q=${encodeURIComponent(qLive)}`)
      .then(setD).catch(() => {}).finally(() => setPending(false))
  }, [days, qLive])
  useEffect(() => { api.get('/api/usage').then(setUsage).catch(() => {}) }, [])

  const rows = useMemo(() => {
    if (!d) return []
    const get = COLS.find(c => c[0] === sort.col)?.[2] || (r => r[sort.col])
    return [...d.sessions].sort((a, b) => { const x = get(a), y = get(b); return sort.dir * (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) })
  }, [d, sort])

  const resumeHere = r => {
    window.dispatchEvent(new CustomEvent('chat-open', { detail: { sessionId: r.sessionId, cwd: r.cwd } }))
    toast(`resuming ${String(r.sessionId).slice(0, 8)} — opening Chat`, 'success')
    window.dispatchEvent(new Event('nav-chat'))
  }
  const copyResume = r => navigator.clipboard.writeText(r.resume).then(
    () => toast('copied · paste into a terminal: ' + r.resume, 'success'),
    () => toast('clipboard blocked by the browser', 'error'))
  const reveal = r => api.post('/api/artifacts/reveal', { path: r.transcript }).catch(e => toast(e.message, 'error'))
  const openRaw = r => window.open('/api/artifacts/download?path=' + encodeURIComponent(r.transcript), '_blank')

  useEffect(() => {
    const onKey = e => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      if (e.key === '/' && !typing) { e.preventDefault(); filterRef.current?.focus(); return }
      if (typing) return
      if (!rows.length) return
      if (e.key === 'j') { e.preventDefault(); setCur(i => Math.min(i + 1, rows.length - 1)) }
      else if (e.key === 'k') { e.preventDefault(); setCur(i => Math.max(i - 1, 0)) }
      else if (e.key === 'r') { e.preventDefault(); resumeHere(rows[cur]) }
      else if (e.key === 'y') { e.preventDefault(); copyResume(rows[cur]) }
      else if (e.key === 'Enter') { e.preventDefault(); openRaw(rows[cur]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, cur])
  useEffect(() => { setCur(0) }, [rows.length])
  useEffect(() => { bodyRef.current?.querySelector('tr[data-cur="1"]')?.scrollIntoView({ block: 'nearest' }) }, [cur])

  if (!d) return <Skeleton tiles={3} rows={10} />
  const t = d.totals

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="kpi-grid" style={{ marginBottom: 0 }}>
        <div className="kpi"><div className="kpi-label"><span>spend</span><span className="kpi-tag" style={{ background: 'var(--bg-surface-hover)', color: DIM }}>{days}d</span></div>
          <div className="kpi-value"><CountUp value={t.cost} prefix="$" decimals={2} /></div>
          <div className="kpi-sub"><CountUp value={t.sessions} /> sessions · ${(t.cost / (t.sessions || 1)).toFixed(2)} median-ish per session</div></div>
        <div className="kpi"><div className="kpi-label"><span>output</span></div>
          <div className="kpi-value"><CountUp value={t.out} format={fmtTok} /></div><div className="kpi-sub">tokens written by Claude</div></div>
        <div className="kpi" title="an estimate (90% of input price) × an estimate (~4 chars/token), against a counterfactual that never happened, that only ever goes up. It is here, in small type, because no decision hangs on it — it was NOT worth a headline KPI tile.">
          <div className="kpi-label"><span>cache saved</span><span className="kpi-tag" style={{ background: 'var(--bg-surface-hover)', color: DIM }}>est · all time</span></div>
          <div className="kpi-value" style={{ color: DIM }}>{usage ? '$' + fmtTok(usage.kpis.costSaved) : '…'}</div>
          <div className="kpi-sub">estimate × estimate vs a counterfactual — hover</div></div>
        <div className="kpi"><div className="kpi-label"><span>compactions</span></div>
          <div className="kpi-value" style={{ color: rows.some(r => r.compactions > 2) ? GOLD : undefined }}><CountUp value={rows.reduce((s, r) => s + r.compactions, 0)} /></div>
          <div className="kpi-sub">context overflow events · see Forensics</div></div>
      </div>

      <div className="panel" style={{ marginBottom: 0 }}>
        <div className="panel-head">
          <h3>Session ledger <span className="muted">
            {}
            {d.total} session{d.total === 1 ? '' : 's'}{rows.length < d.total ? ` · showing ${rows.length}` : ''}
            {d.named < d.total ? ` · ${d.total - d.named} never titled` : ''}
            {d.q ? ` · matching “${d.q}”` : ''} · plane: this machine only
            {pending && ' · searching…'}
          </span></h3>
          <input ref={filterRef} placeholder="search name, id, path… ( / )" value={q} onChange={e => setQ(e.target.value)} style={{ width: 230 }}
            title="searched on the server across the whole window, not just the rows on screen" />
          <select value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
          </select>
          <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>/ filter · j/k move · y copy resume · ↵ open raw</span>
        </div>
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }} ref={bodyRef}>
          <table className="data inv">
            <thead><tr>
              {COLS.map(([c, label]) => (
                <th key={c} onClick={() => setSort(s => ({ col: c, dir: s.col === c ? -s.dir : -1 }))}>
                  {label}{sort.col === c ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
                </th>))}
              <th>Actions</th>
            </tr></thead>
            <Stagger tag="tbody" step={14} max={300}>
              {rows.map((r, i) => [
                <tr key={r.sessionId} data-cur={i === cur ? '1' : '0'} onClick={() => setCur(i)}
                  style={{ background: i === cur ? 'var(--accent-bg)' : undefined, cursor: 'pointer' }}>
                  {}
                  <td style={{ maxWidth: 260 }} title={r.name ? `${NAME_SOURCE[r.nameSource] || ''}\n${r.cwd}` : `this session was never titled\n${r.cwd}`}>
                    <span style={{
                      display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      color: r.name ? (r.nameSource === 'custom' ? 'var(--text-primary)' : 'var(--text-secondary)') : 'var(--text-tertiary)',
                      font: r.name ? '500 12px sans-serif' : `400 11px ${MONO}`,
                    }}>
                      {r.name || r.sessionId.slice(0, 8)}
                    </span>
                  </td>
                  <td className="mono" style={{ color: 'var(--text-primary)' }} title={r.cwd}>{r.project}</td>
                  <td className="mono" style={{ color: r.branch ? 'var(--violet)' : DIM }}>{r.branch || '—'}</td>
                  <td className="num" style={{ color: r.cost > 20 ? GOLD : 'var(--text-primary)' }}>${r.cost.toFixed(2)}</td>
                  <td className="num">{fmtTok(r.out)}</td>
                  <td className="num" title="share of input tokens served from the prompt cache">{Math.round(r.cacheReadPct * 100)}%</td>
                  <td className="num">{fmtDur(r.durationMs)}</td>
                  <td className="num">{r.toolCalls}</td>
                  <td className="num" style={{ color: r.compactions ? GOLD : DIM }}>{r.compactions || '—'}</td>
                  <td className="num" style={{ color: r.errors ? RED : DIM }}>{r.errors || '—'}</td>
                  <td className="mono" style={{ color: 'var(--text-tertiary)' }}>{ago(r.last)} ago</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="mini" style={{ marginTop: 0 }} title="resume this session inside the dashboard" onClick={e => { e.stopPropagation(); resumeHere(r) }}>r · resume</button>
                    <button className="mini" style={{ marginTop: 0 }} title={r.resume} onClick={e => { e.stopPropagation(); copyResume(r) }}>y · copy</button>
                    <button className="mini" style={{ marginTop: 0, marginLeft: 4 }} onClick={e => { e.stopPropagation(); reveal(r) }}>reveal</button>
                    <button className="mini" style={{ marginTop: 0, marginLeft: 4 }} onClick={e => { e.stopPropagation(); openRaw(r) }}>raw</button>
                    <button className="mini" style={{ marginTop: 0, marginLeft: 4 }} title="readable rows for this session's tool calls"
                      onClick={e => { e.stopPropagation(); setEvents(x => x === r.sessionId ? null : r.sessionId) }}>
                      {events === r.sessionId ? 'hide' : 'events'}
                    </button>
                  </td>
                </tr>,
                events === r.sessionId ? (
                  <tr key={r.sessionId + ':events'}>
                    <td colSpan={12} style={{ background: 'var(--bg-base)' }}><SessionEvents sessionId={r.sessionId} /></td>
                  </tr>
                ) : null,
              ]).flat().filter(Boolean)}
              {rows.length === 0 && <tr><td colSpan={12} style={{ font: `400 11px ${MONO}`, color: DIM, padding: 12 }}>no sessions in this window</td></tr>}
            </Stagger>
          </table>
        </div>
        <p className="small">
          $ is real: each entry is priced from its own model and token counts. "y · resume" copies{' '}
          <code style={{ color: GREEN }}>cd &lt;cwd&gt; && claude --resume &lt;id&gt;</code> — the dashboard does not
          re-host your terminal.
        </p>
      </div>
    </div>
  )
}
