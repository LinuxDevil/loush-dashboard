import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import { Tabs } from '../ui/tabs.jsx'

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }
const KIND = {
  entry: { color: '#a78bfa', label: 'entry (prompt)' },
  skill: { color: '#d97757', label: 'skill' },
  command: { color: '#e5a03a', label: 'command' },
  agent: { color: '#5eb3f6', label: 'agent' },
  mcp: { color: '#3fb96a', label: 'mcp server' },
}
const fmtN = n => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0))
const ago = t => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago' }

// per-column cap so 100+ skills don't become a hairball — top by usage, then defined-edge presence
const COL_CAP = 14

export default function FlowSection() {
  const [data, setData] = useState(null)
  const [scopes, setScopes] = useState([])
  const [project, setProject] = useState('')
  const [mode, setMode] = useState('Observed flow')
  const [sel, setSel] = useState(null)
  const [q, setQ] = useState('')
  const svgRef = useRef(null)
  const exportSvg = () => {
    if (!svgRef.current) return
    const s = new XMLSerializer().serializeToString(svgRef.current)
    const blob = new Blob(['<?xml version="1.0"?>\n' + s], { type: 'image/svg+xml' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'flow-graph.svg'; a.click(); URL.revokeObjectURL(a.href)
  }
  useEffect(() => { api.get('/api/harness').then(d => setScopes(d.scopes)).catch(() => {}) }, [])
  useEffect(() => {
    setData(null); setSel(null)
    api.get('/api/flow' + (project ? '?project=' + encodeURIComponent(project) : '')).then(setData).catch(() => {})
  }, [project])

  const view = useMemo(() => {
    if (!data) return null
    const edges = mode === 'Observed flow' ? data.observed : data.defined.map(e => ({ ...e, count: 1 }))
    const inEdges = new Set(edges.flatMap(e => [e.from, e.to]))
    const cols = { entry: [], skill: [], command: [], agent: [], mcp: [] }
    for (const n of data.nodes) if (cols[n.kind]) cols[n.kind].push(n)
    for (const k of Object.keys(cols)) {
      cols[k].sort((a, b) => (b.count - a.count) || (inEdges.has(b.id) - inEdges.has(a.id)) || a.name.localeCompare(b.name))
      if (k !== 'entry') {
        const matched = q ? cols[k].filter(n => n.name.toLowerCase().includes(q.toLowerCase())) : cols[k]
        cols[k] = matched.slice(0, COL_CAP)
      }
    }
    const shown = new Set(Object.values(cols).flat().map(n => n.id))
    const vEdges = edges.filter(e => shown.has(e.from) && shown.has(e.to))
    // layout: fixed columns, vertical spread
    const X = { entry: 70, skill: 300, agent: 560, mcp: 800 } // command nodes merge into the skill column
    const mid = [...cols.skill, ...cols.command]
    const H = Math.max(420, (Math.max(mid.length, cols.agent.length, cols.mcp.length) + 1) * 44)
    const pos = {}
    const place = (list, x) => list.forEach((n, i) => { pos[n.id] = { x, y: 40 + ((i + 0.5) / list.length) * (H - 80) } })
    place(cols.entry, X.entry); place(mid, X.skill); place(cols.agent, X.agent); place(cols.mcp, X.mcp)
    // isolate: nodes reachable from/to the selected one over visible edges
    let lit = null
    if (sel && shown.has(sel)) {
      lit = new Set([sel])
      const fwd = {}, back = {}
      for (const e of vEdges) { (fwd[e.from] ||= []).push(e.to); (back[e.to] ||= []).push(e.from) }
      const walk = (start, adj) => { const st = [start]; while (st.length) { const v = st.pop(); for (const w of adj[v] || []) if (!lit.has(w)) { lit.add(w); st.push(w) } } }
      walk(sel, fwd); walk(sel, back)
    }
    const maxC = Math.max(...vEdges.map(e => e.count), 1)
    return { cols, mid, vEdges, pos, H, lit, maxC, shown, hidden: data.nodes.length - shown.size }
  }, [data, mode, sel, q])

  if (!data) return <Skeleton tiles={0} rows={8} />
  const { nodes, deadEnds, cycles, trail } = data
  const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]))
  const invocations = data.observed.reduce((s, e) => s + e.count, 0)

  const edgeOn = e => !view.lit || (view.lit.has(e.from) && view.lit.has(e.to))
  const nodeOn = n => !view.lit || view.lit.has(n.id)
  const pulses = view.vEdges.filter(edgeOn).sort((a, b) => b.count - a.count).slice(0, 8)

  const node = n => {
    const p = view.pos[n.id]
    if (!p) return null
    const c = KIND[n.kind].color
    const r = 9 + Math.min(9, Math.sqrt(n.count || 0) * 1.6) // size by usage frequency
    const on = nodeOn(n)
    const isSel = sel === n.id
    return (
      <g key={n.id} onClick={() => setSel(isSel ? null : n.id)} style={{ cursor: 'pointer', opacity: on ? 1 : 0.14, transition: 'opacity .2s' }}>
        <title>{`${n.name} (${KIND[n.kind].label}${n.scope ? ' · ' + n.scope : ''}${n.ghost ? ' · not defined in this scope' : ''})\n${n.model ? 'model: ' + n.model + '\n' : ''}used ${fmtN(n.count)}× · last ${ago(n.last)}${n.description ? '\n' + n.description : ''}`}</title>
        {n.kind === 'agent'
          ? <rect x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} rx={5} fill={c} stroke={isSel ? '#f6efe9' : 'rgba(255,255,255,0.18)'} strokeWidth={isSel ? 2.5 : 1.4} />
          : n.kind === 'entry'
            ? <path d={`M ${p.x} ${p.y - 14} L ${p.x + 14} ${p.y} L ${p.x} ${p.y + 14} L ${p.x - 14} ${p.y} Z`} fill={c} stroke={isSel ? '#f6efe9' : 'rgba(255,255,255,0.25)'} strokeWidth={isSel ? 2.5 : 1.4} />
            : <circle cx={p.x} cy={p.y} r={r} fill={n.kind === 'command' ? 'transparent' : c} stroke={n.kind === 'command' ? c : isSel ? '#f6efe9' : 'rgba(255,255,255,0.18)'} strokeWidth={n.kind === 'command' ? 2.2 : isSel ? 2.5 : 1.4} strokeDasharray={n.ghost ? '3 3' : 'none'} />}
        <text x={p.x + (n.kind === 'entry' ? 0 : r + 6)} y={n.kind === 'entry' ? p.y + 28 : p.y + 4} textAnchor={n.kind === 'entry' ? 'middle' : 'start'} style={{ font: `500 10px ${MONO}`, fill: isSel ? '#f6efe9' : '#b0a69e' }}>{n.name.length > 22 ? n.name.slice(0, 21) + '…' : n.name}</text>
        {deadEnds.includes(n.id) && <circle cx={p.x - r - 3} cy={p.y - r - 3} r={3.2} fill="#e5484d"><title>dead end — never reached in any session</title></circle>}
      </g>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Tabs tabs={['Observed flow', 'Defined flow']} tab={mode} setTab={setMode} />
        <select value={project} onChange={e => setProject(e.target.value)}>
          <option value="">Global scope</option>
          {scopes.filter(s => s.id !== 'global').map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="filter nodes…" style={{ width: 180 }} />
        <button className="mini" style={{ marginTop: 0 }} onClick={exportSvg}>export SVG</button>
        <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginLeft: 'auto' }}>
          {nodes.length} nodes · {invocations} observed invocations{view.hidden > 0 ? ` · showing top ${COL_CAP}/type (${view.hidden} hidden — filter to find them)` : ''}
        </span>
      </div>

      <div style={{ position: 'relative', ...PANEL, animation: 'fadeUp .5s ease both' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <div style={{ font: `600 15px ${HEAD}` }}>Orchestration topology <span style={{ font: `400 11px ${MONO}`, color: '#8a807a' }}>{mode === 'Observed flow' ? 'what actually ran, weighted by session frequency' : "what's wired up in skill/agent definitions"}</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, font: `400 10px ${MONO}`, color: '#8a807a' }}>
            {Object.entries(KIND).map(([k, v]) => (
              <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: k === 'agent' ? 2 : '50%', background: v.color }} />{v.label}</span>
            ))}
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e5484d' }} />dead end</span>
          </div>
        </div>
        <svg ref={svgRef} viewBox={`0 0 900 ${view.H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          {view.vEdges.map((e, i) => {
            const p = view.pos[e.from], t = view.pos[e.to]
            if (!p || !t) return null
            const w = 0.8 + (Math.log(e.count + 1) / Math.log(view.maxC + 1)) * 2.6
            const mx = (p.x + t.x) / 2
            return (
              <path key={i} d={`M ${p.x} ${p.y} C ${mx} ${p.y}, ${mx} ${t.y}, ${t.x} ${t.y}`} fill="none"
                stroke={KIND[nodeById[e.to]?.kind || 'skill'].color} strokeWidth={w} strokeDasharray="5 4"
                style={{ animation: 'dash 1.2s linear infinite', opacity: edgeOn(e) ? (e.trigger ? 0.14 : 0.42) : 0.04, transition: 'opacity .2s' }}>
                <title>{`${nodeById[e.from]?.name || e.from} → ${nodeById[e.to]?.name || e.to}${e.count > 1 ? ` · ${e.count}×` : ''}${e.last ? ' · last ' + ago(e.last) : ''}`}</title>
              </path>
            )
          })}
          {mode === 'Observed flow' && pulses.map((e, i) => {
            const p = view.pos[e.from], t = view.pos[e.to]
            if (!p || !t) return null
            const mx = (p.x + t.x) / 2, c = KIND[nodeById[e.to]?.kind || 'skill'].color
            return (
              <circle key={'p' + i} r="3.2" fill={c} style={{ filter: `drop-shadow(0 0 5px ${c})` }}>
                <animateMotion dur={(2.6 + (i % 3) * 0.4).toFixed(1) + 's'} begin={(i * 0.4).toFixed(1) + 's'} repeatCount="indefinite" path={`M ${p.x} ${p.y} C ${mx} ${p.y}, ${mx} ${t.y}, ${t.x} ${t.y}`} />
              </circle>
            )
          })}
          {[...view.cols.entry, ...view.mid, ...view.cols.agent, ...view.cols.mcp].map(node)}
        </svg>
        <div style={{ position: 'absolute', bottom: 14, left: 20, font: `400 10px ${MONO}`, color: '#6a615a' }}>
          click a node to isolate its upstream/downstream path · edge width = run frequency · node size = usage{sel ? ' · click again to clear' : ''}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        <div style={{ ...PANEL, animation: 'fadeUp .5s ease both', animationDelay: '.1s' }}>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 10 }}>Most-traveled path <span style={{ font: `400 11px ${MONO}`, color: '#8a807a' }}>observed</span></div>
          {trail.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              {trail.map((id, i) => (
                <React.Fragment key={id}>
                  {i > 0 && <span style={{ color: '#5a514a' }}>→</span>}
                  <span onClick={() => setSel(id)} style={{ font: `500 11px ${MONO}`, padding: '3px 9px', borderRadius: 6, cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: KIND[nodeById[id]?.kind || 'skill'].color }}>{nodeById[id]?.name || id}</span>
                </React.Fragment>
              ))}
            </div>
          ) : <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>no observed invocations yet</div>}
        </div>
        <div style={{ ...PANEL, animation: 'fadeUp .5s ease both', animationDelay: '.15s' }}>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 10 }}>Dead ends <span style={{ font: `400 11px ${MONO}`, color: '#8a807a' }}>{deadEnds.length} never reached</span></div>
          <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {deadEnds.slice(0, 60).map(id => (
              <span key={id} onClick={() => { setQ(nodeById[id]?.name || ''); setSel(id) }} style={{ font: `400 10.5px ${MONO}`, padding: '2px 8px', borderRadius: 6, cursor: 'pointer', background: 'rgba(229,72,77,0.08)', color: '#c99', border: '1px solid rgba(229,72,77,0.2)' }}>{nodeById[id]?.name || id}</span>
            ))}
            {deadEnds.length === 0 && <span style={{ font: `400 11px ${MONO}`, color: '#3fb96a' }}>✓ everything defined has been used</span>}
          </div>
        </div>
        <div style={{ ...PANEL, animation: 'fadeUp .5s ease both', animationDelay: '.2s' }}>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 10 }}>Cycles <span style={{ font: `400 11px ${MONO}`, color: '#8a807a' }}>in defined wiring</span></div>
          {cycles.length ? cycles.map(c => (
            <div key={c} style={{ font: `400 10.5px ${MONO}`, color: '#e8a06a', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>↻ {c.replace(/(skill|command|agent|mcp|entry):/g, '')}</div>
          )) : <div style={{ font: `400 11px ${MONO}`, color: '#3fb96a' }}>✓ no cycles detected</div>}
        </div>
      </div>
    </div>
  )
}
