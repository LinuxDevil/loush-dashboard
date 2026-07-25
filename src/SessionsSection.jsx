import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, toast } from './api.js'
import Skeleton from './Skeleton.jsx'
import { Stagger, CountUp } from './anim.jsx'

// ---------- 10: session ledger — real $, terminal escape hatches, keyboard layer ----------
// The app's only previous "resume" spawned the session INSIDE the dashboard's chat pane, which is not
// what a terminal-first dev wants. This copies `cd <cwd> && claude --resume <id>` and gets out of the way.
// Plane B: this machine's own transcripts. There is no user/machine parameter and there never will be.
const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const RED = '#e5484d', GOLD = '#e5a03a', GREEN = '#3fb96a', DIM = '#8a807a'
const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)))
const fmtDur = ms => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m` }
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd' }

const COLS = [
  ['project', 'Project', r => r.project], ['branch', 'Branch', r => r.branch || ''],
  ['cost', '$', r => r.cost], ['out', 'Out tok', r => r.out], ['cacheReadPct', 'Cache read', r => r.cacheReadPct],
  ['durationMs', 'Duration', r => r.durationMs], ['toolCalls', 'Tools', r => r.toolCalls],
  ['compactions', 'Compact', r => r.compactions], ['errors', 'Errors', r => r.errors], ['last', 'Last', r => r.last],
]

export default function SessionsSection() {
  const [days, setDays] = useState(7)
  const [d, setD] = useState(null)
  const [usage, setUsage] = useState(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState({ col: 'last', dir: -1 })
  const [cur, setCur] = useState(0)
  const filterRef = useRef(null)
  const bodyRef = useRef(null)

  useEffect(() => { setD(null); api.get(`/api/sessions?days=${days}&limit=200`).then(setD).catch(() => {}) }, [days])
  useEffect(() => { api.get('/api/usage').then(setUsage).catch(() => {}) }, [])

  const rows = useMemo(() => {
    if (!d) return []
    const get = COLS.find(c => c[0] === sort.col)?.[2] || (r => r[sort.col])
    const f = d.sessions.filter(s => !q || (s.project + ' ' + (s.branch || '') + ' ' + s.sessionId + ' ' + s.cwd).toLowerCase().includes(q.toLowerCase()))
    return [...f].sort((a, b) => { const x = get(a), y = get(b); return sort.dir * (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) })
  }, [d, q, sort])

  // Resume IN-APP. This used to copy `claude --resume <id>` for you to paste into a terminal,
  // while POST /api/chat {resume} — which does it properly — already existed and was used by Chat.
  const resumeHere = r => {
    window.dispatchEvent(new CustomEvent('chat-open', { detail: { sessionId: r.sessionId, cwd: r.cwd } }))
    toast(`resuming ${String(r.sessionId).slice(0, 8)} — opening Chat`, 'success')
    window.dispatchEvent(new Event('nav-chat'))
  }
  // Kept for the terminal case. The old version swallowed the rejection and toasted success anyway,
  // so a blocked clipboard reported "copied".
  const copyResume = r => navigator.clipboard.writeText(r.resume).then(
    () => toast('copied · paste into a terminal: ' + r.resume, 'success'),
    () => toast('clipboard blocked by the browser', 'error'))
  const reveal = r => api.post('/api/artifacts/reveal', { path: r.transcript }).catch(e => toast(e.message, 'error'))
  const openRaw = r => window.open('/api/artifacts/download?path=' + encodeURIComponent(r.transcript), '_blank')

  // keyboard layer: `/` focus filter · j/k move · `y` copy the resume line · Enter open the raw transcript
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
        <div className="kpi"><div className="kpi-label"><span>spend</span><span className="kpi-tag" style={{ background: 'rgba(255,255,255,0.05)', color: DIM }}>{days}d</span></div>
          <div className="kpi-value"><CountUp value={t.cost} prefix="$" decimals={2} /></div>
          <div className="kpi-sub"><CountUp value={t.sessions} /> sessions · ${(t.cost / (t.sessions || 1)).toFixed(2)} median-ish per session</div></div>
        <div className="kpi"><div className="kpi-label"><span>output</span></div>
          <div className="kpi-value"><CountUp value={t.out} format={fmtTok} /></div><div className="kpi-sub">tokens written by Claude</div></div>
        <div className="kpi" title="an estimate (90% of input price) × an estimate (~4 chars/token), against a counterfactual that never happened, that only ever goes up. It is here, in small type, because no decision hangs on it — it was NOT worth a headline KPI tile.">
          <div className="kpi-label"><span>cache saved</span><span className="kpi-tag" style={{ background: 'rgba(255,255,255,0.05)', color: DIM }}>est · all time</span></div>
          <div className="kpi-value" style={{ color: DIM }}>{usage ? '$' + fmtTok(usage.kpis.costSaved) : '…'}</div>
          <div className="kpi-sub">estimate × estimate vs a counterfactual — hover</div></div>
        <div className="kpi"><div className="kpi-label"><span>compactions</span></div>
          <div className="kpi-value" style={{ color: rows.some(r => r.compactions > 2) ? GOLD : undefined }}><CountUp value={rows.reduce((s, r) => s + r.compactions, 0)} /></div>
          <div className="kpi-sub">context overflow events · see Forensics</div></div>
      </div>

      <div className="panel" style={{ marginBottom: 0 }}>
        <div className="panel-head">
          <h3>Session ledger <span className="muted">{rows.length} sessions · plane: this machine only</span></h3>
          <input ref={filterRef} placeholder="filter project, branch, id… ( / )" value={q} onChange={e => setQ(e.target.value)} style={{ width: 230 }} />
          <select value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
          </select>
          <span style={{ font: `400 10.5px ${MONO}`, color: '#6a615a' }}>/ filter · j/k move · y copy resume · ↵ open raw</span>
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
              {rows.map((r, i) => (
                <tr key={r.sessionId} data-cur={i === cur ? '1' : '0'} onClick={() => setCur(i)}
                  style={{ background: i === cur ? 'rgba(217,119,87,0.12)' : undefined, cursor: 'pointer' }}>
                  <td className="mono" style={{ color: '#eee3da' }} title={r.cwd}>{r.project}</td>
                  <td className="mono" style={{ color: r.branch ? '#8b7cf6' : DIM }}>{r.branch || '—'}</td>
                  <td className="num" style={{ color: r.cost > 20 ? GOLD : '#eee3da' }}>${r.cost.toFixed(2)}</td>
                  <td className="num">{fmtTok(r.out)}</td>
                  <td className="num" title="share of input tokens served from the prompt cache">{Math.round(r.cacheReadPct * 100)}%</td>
                  <td className="num">{fmtDur(r.durationMs)}</td>
                  <td className="num">{r.toolCalls}</td>
                  <td className="num" style={{ color: r.compactions ? GOLD : DIM }}>{r.compactions || '—'}</td>
                  <td className="num" style={{ color: r.errors ? RED : DIM }}>{r.errors || '—'}</td>
                  <td className="mono" style={{ color: '#7a716a' }}>{ago(r.last)} ago</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="mini" style={{ marginTop: 0 }} title="resume this session inside the dashboard" onClick={e => { e.stopPropagation(); resumeHere(r) }}>r · resume</button>
                    <button className="mini" style={{ marginTop: 0 }} title={r.resume} onClick={e => { e.stopPropagation(); copyResume(r) }}>y · copy</button>
                    <button className="mini" style={{ marginTop: 0, marginLeft: 4 }} onClick={e => { e.stopPropagation(); reveal(r) }}>reveal</button>
                    <button className="mini" style={{ marginTop: 0, marginLeft: 4 }} onClick={e => { e.stopPropagation(); openRaw(r) }}>raw</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={11} style={{ font: `400 11px ${MONO}`, color: DIM, padding: 12 }}>no sessions in this window</td></tr>}
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
