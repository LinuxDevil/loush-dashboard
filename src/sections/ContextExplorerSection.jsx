import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import { modelName } from '../lib/modelName.js'

const MONO = "var(--mono)"
const FRESH = 'var(--accent)', CACHE = 'var(--blue)', COMPACT = 'var(--amber)', GRID = 'var(--bg-surface-active)'
const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)))
const fmtDate = t => new Date(t).toLocaleString()

export default function ContextExplorerSection() {
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  const [sessionId, setSessionId] = useState(null)
  const [data, setData] = useState(null)
  const [hover, setHover] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [cursor, setCursor] = useState(-1)
  const rafRef = useRef(null)

  useEffect(() => { api.get('/api/context/sessions').then(setList).catch(() => {}) }, [])
  useEffect(() => {
    if (!sessionId) return
    setData(null); setCursor(-1); setPlaying(false)
    api.get(`/api/context/${sessionId}`).then(setData).catch(() => {})
  }, [sessionId])

  const filtered = useMemo(() => {
    if (!list) return []
    const f = list.sessions.filter(s => !q || (s.project + ' ' + s.sessionId).toLowerCase().includes(q.toLowerCase()))
    return f.slice(0, 40)
  }, [list, q])

  useEffect(() => {
    if (!playing || !data) return
    const n = data.entries.length
    let last = performance.now()
    const step = now => {
      if (now - last > 220) { last = now; setCursor(c => (c + 1 >= n ? (setPlaying(false), n - 1) : c + 1)) }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, data])

  if (!list) return <Skeleton tiles={2} rows={8} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel" style={{ marginBottom: 0 }}>
        <div className="panel-head">
          <h3>Context Window Explorer <span className="muted">real per-turn context occupancy · plane: this machine only</span></h3>
          <input placeholder="filter project or session id…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 230 }} />
        </div>
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          <table className="data inv">
            <thead><tr><th>Project</th><th>Turns</th><th>Peak context</th><th>Model</th><th>Last</th></tr></thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.sessionId} onClick={() => setSessionId(s.sessionId)}
                  style={{ cursor: 'pointer', background: sessionId === s.sessionId ? 'var(--accent-bg)' : undefined }}>
                  <td className="mono">{s.project}</td>
                  <td className="num">{s.turns}</td>
                  <td className="num">{fmtTok(s.peak)}</td>
                  <td className="mono" style={{ color: 'var(--text-secondary)' }}>{modelName(s.model || '')}</td>
                  <td className="mono" style={{ color: 'var(--text-tertiary)' }}>{new Date(s.last).toLocaleDateString()}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text-secondary)', padding: 12 }}>no replayable sessions (need ≥2 turns with usage)</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {!sessionId && <div className="panel"><p className="small">pick a session above to replay its context-window timeline.</p></div>}
      {sessionId && !data && <Skeleton tiles={1} rows={4} />}
      {data && <ContextTimeline data={data} hover={hover} setHover={setHover} playing={playing} setPlaying={setPlaying} cursor={cursor} setCursor={setCursor} />}
    </div>
  )
}

export function ContextTimeline({ data, hover, setHover, playing, setPlaying, cursor, setCursor }) {
  const { entries, budget, peak, project, model, firstPrompt, sessionId } = data
  const shown = cursor >= 0 ? entries.slice(0, cursor + 1) : entries
  const W = 900, H = 220, PAD = 30
  const n = entries.length
  const x = i => PAD + (i / Math.max(1, n - 1)) * (W - PAD * 2)
  const y = v => H - PAD - (v / budget) * (H - PAD * 2)

  const path = shown.map((e, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(e.total).toFixed(1)}`).join(' ')
  const areaPath = shown.length ? `${path} L ${x(shown.length - 1).toFixed(1)} ${H - PAD} L ${x(0).toFixed(1)} ${H - PAD} Z` : ''
  const compactionIdx = entries.map((e, i) => e.isCompaction ? i : -1).filter(i => i >= 0)
  const active = hover != null ? entries[hover] : (cursor >= 0 ? entries[cursor] : null)

  return (
    <div className="panel" style={{ marginBottom: 0 }}>
      <div className="panel-head">
        <h3>{project} <span className="muted">{sessionId.slice(0, 8)}… · {modelName(model || '')}</span></h3>
        <button className="mini" onClick={() => setPlaying(p => !p)}>{playing ? '⏸ pause' : '▶ replay'}</button>
        {cursor >= 0 && <button className="mini" onClick={() => setCursor(-1)}>show all</button>}
      </div>
      {firstPrompt && <p className="small" style={{ padding: '0 16px', color: 'var(--text-secondary)' }}>"{firstPrompt}"</p>}

      <div className="kpi-grid" style={{ margin: '0 16px 12px' }}>
        <div className="kpi"><div className="kpi-label"><span>peak context</span></div>
          <div className="kpi-value">{fmtTok(peak)}</div><div className="kpi-sub">{Math.round(peak / budget * 100)}% of {fmtTok(budget)} window</div></div>
        <div className="kpi"><div className="kpi-label"><span>turns</span></div>
          <div className="kpi-value">{entries.length}</div><div className="kpi-sub">assistant turns with usage</div></div>
        <div className="kpi"><div className="kpi-label"><span>compactions</span></div>
          <div className="kpi-value" style={{ color: compactionIdx.length ? COMPACT : undefined }}>{compactionIdx.length}</div>
          <div className="kpi-sub">context-reset events detected</div></div>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}
        onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75, 1].map(f => (
          <g key={f}>
            <line x1={PAD} x2={W - PAD} y1={y(budget * f)} y2={y(budget * f)} strokeWidth={1}  style={{ stroke: (GRID) }} />
            <text x={W - PAD + 4} y={y(budget * f) + 3} fontSize={9} fontFamily={MONO} style={{ fill: 'var(--text-tertiary)' }}>{fmtTok(budget * f)}</text>
          </g>
        ))}
        <path d={areaPath} opacity={0.12}  style={{ fill: (FRESH) }} />
        <path d={path} fill="none" strokeWidth={2}  style={{ stroke: (FRESH) }} />
        {compactionIdx.filter(i => cursor < 0 || i <= cursor).map(i => (
          <line key={i} x1={x(i)} x2={x(i)} y1={PAD} y2={H - PAD} strokeWidth={1.5} strokeDasharray="3,3"  style={{ stroke: (COMPACT) }} />
        ))}
        {shown.map((e, i) => (
          <circle key={i} cx={x(i)} cy={y(e.total)} r={hover === i ? 4 : 2.5}
           
            onMouseEnter={() => setHover(i)} style={{ fill: (e.isCompaction ? COMPACT : CACHE), cursor: 'pointer' }} />
        ))}
      </svg>

      {active && (
        <div style={{ margin: '0 16px 16px', padding: 10, background: 'var(--bg-surface)', borderRadius: 6, font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>
          turn {(hover ?? cursor) + 1} of {entries.length} · {fmtDate(active.t)} · total {fmtTok(active.total)} tok
          {' '}(fresh {fmtTok(active.in)} · cache-write {fmtTok(active.cc)} · cache-read {fmtTok(active.cr)}) · {active.toolCalls} tool call{active.toolCalls === 1 ? '' : 's'}
          {active.isCompaction && <span style={{ color: COMPACT }}> · /compact detected</span>}
        </div>
      )}
      <p className="small" style={{ padding: '0 16px 12px' }}>
        each point is one assistant turn: its height is the <em>total</em> prompt size the model saw for that turn —
        fresh + cache-write + cache-read tokens, straight from Anthropic's usage block. dashed lines mark detected
        <code style={{ color: COMPACT }}> /compact</code> resets.
      </p>
    </div>
  )
}
