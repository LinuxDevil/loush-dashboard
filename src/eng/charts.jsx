import React, { useState } from 'react'
import { HEAD, BODY, MONO, BB, GREEN, GOLD, RED, PURPLE, STEEL, DIM, HI } from './ui.jsx'
import { Draw } from '../ui/anim.jsx'


const AX = 'var(--bg-surface-active)'
const tip = { position: 'fixed', zIndex: 2147483647, padding: '7px 10px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-md)', pointerEvents: 'none', font: `500 11px ${BODY}`, color: HI, maxWidth: 320 }

export function Scatter({ points, p85, p50, height = 260, onPick }) {
  const [hov, setHov] = useState(null)
  const W = 900, H = height, L = 38, R = 12, T = 14, B = 26
  if (!points.length) return <div style={{ padding: 24, textAlign: 'center', font: `400 12px ${BODY}`, color: DIM }}>No shipped tickets in this window.</div>
  const xs = points.map(p => p.x), ys = points.map(p => p.y)
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1
  const sorted = [...ys].sort((a, b) => a - b)
  const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)]
  const ymax = Math.max(1, Math.min(Math.max(...ys), Math.max(p95, (p85 || 0) * 1.6))) * 1.1
  const off = points.filter(p => p.y > ymax)
  const px = v => L + ((v - x0) / Math.max(1, x1 - x0)) * (W - L - R)
  const py = v => H - B - (Math.min(v, ymax) / ymax) * (H - T - B)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => +(ymax * f).toFixed(1))
  const dfmt = t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })
  return <div style={{ position: 'relative' }}>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto', display: 'block' }}>
      {ticks.map((t, i) => <g key={i}>
        <line x1={L} x2={W - R} y1={py(t)} y2={py(t)}  style={{ stroke: (AX) }} />
        <text x={L - 6} y={py(t) + 3} textAnchor="end" style={{ font: `500 9px ${MONO}`, fill: DIM }}>{t}</text>
      </g>)}
      {[0, 0.5, 1].map((f, i) => <text key={i} x={L + f * (W - L - R)} y={H - 8} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} style={{ font: `500 9px ${MONO}`, fill: DIM }}>{dfmt(x0 + f * (x1 - x0))}</text>)}
      {p50 != null && <><line x1={L} x2={W - R} y1={py(p50)} y2={py(p50)} strokeWidth="1" strokeDasharray="2 4" opacity="0.7"  style={{ stroke: (BB) }} />
        <text x={W - R} y={py(p50) - 4} textAnchor="end" style={{ font: `600 10px ${MONO}`, fill: BB }}>p50 {p50.toFixed(1)}d</text></>}
      {p85 != null && <><line x1={L} x2={W - R} y1={py(p85)} y2={py(p85)} strokeWidth="1.5" strokeDasharray="5 4"  style={{ stroke: (GOLD) }} />
        <text x={W - R} y={py(p85) - 4} textAnchor="end" style={{ font: `700 10px ${MONO}`, fill: GOLD }}>p85 {p85.toFixed(1)}d</text></>}
      {points.map((p, i) => { const d = { '--enter-delay': `${Math.min(i * 9, 520)}ms` }; return (p.y > ymax
        ? <polygon key={i} className="enter" points={`${px(p.x)},${py(p.y) - 6} ${px(p.x) - 5},${py(p.y) + 2} ${px(p.x) + 5},${py(p.y) + 2}`}
          style={{ fill: (p.color), cursor: onPick ? 'pointer' : 'default', ...d }}
          onMouseEnter={e => setHov({ p, x: e.clientX, y: e.clientY })} onMouseLeave={() => setHov(null)} onClick={() => onPick?.(p)} />
        : <circle key={i} className="enter" cx={px(p.x)} cy={py(p.y)} r={p85 != null && p.y > p85 ? 4.5 : 3.4}
          fillOpacity={p85 != null && p.y > p85 ? 0.95 : 0.55} strokeWidth="1"
          style={{ fill: (p.color), stroke: (p85 != null && p.y > p85 ? p.color : 'none'), cursor: onPick ? 'pointer' : 'default', ...d }}
          onMouseEnter={e => setHov({ p, x: e.clientX, y: e.clientY })} onMouseLeave={() => setHov(null)}
          onClick={() => onPick?.(p)} />) })}
      {off.length > 0 && <text x={L + 4} y={T + 10} style={{ font: `600 10px ${MONO}`, fill: RED }}>▲ {off.length} above the scale — up to {Math.max(...off.map(p => p.y)).toFixed(0)}d</text>}
    </svg>
    {hov && <div style={{ ...tip, left: Math.min(hov.x + 12, window.innerWidth - 320), top: hov.y - 52 }}>
      <b style={{ font: `600 11px ${MONO}`, color: hov.p.color }}>{hov.p.label}</b> · {hov.p.y.toFixed(1)}d · {hov.p.type}
      <div style={{ font: `400 10px ${MONO}`, color: DIM }}>{dfmt(hov.p.x)}{hov.p.sub ? ' · ' + hov.p.sub : ''}</div>
    </div>}
  </div>
}

export function Lines({ series, labels, height = 190, yFmt = v => v, threshold }) {
  const [hov, setHov] = useState(null)
  const W = 640, H = height, L = 34, R = 10, T = 12, B = 22
  const all = series.flatMap(s => s.values.map(v => v.y)).filter(v => v != null)
  if (!all.length) return <div style={{ padding: 22, textAlign: 'center', font: `400 12px ${BODY}`, color: DIM }}>No data.</div>
  const ymax = Math.max(...all, threshold?.at || 0) * 1.15 || 1
  const n = Math.max(1, labels.length - 1)
  const px = i => L + (i / n) * (W - L - R)
  const py = v => H - B - (v / ymax) * (H - T - B)
  const path = vals => vals.map((v, i) => (v.y == null ? null : `${i === 0 || vals[i - 1]?.y == null ? 'M' : 'L'} ${px(i)} ${py(v.y)}`)).filter(Boolean).join(' ')
  return <div style={{ position: 'relative' }}>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[0, 0.5, 1].map((f, i) => <g key={i}>
        <line x1={L} x2={W - R} y1={py(ymax * f)} y2={py(ymax * f)}  style={{ stroke: (AX) }} />
        <text x={L - 5} y={py(ymax * f) + 3} textAnchor="end" style={{ font: `500 9px ${MONO}`, fill: DIM }}>{yFmt(+(ymax * f).toFixed(1))}</text>
      </g>)}
      {threshold && <><line x1={L} x2={W - R} y1={py(threshold.at)} y2={py(threshold.at)} strokeDasharray="4 4" strokeWidth="1.2"  style={{ stroke: (threshold.color || RED) }} />
        <text x={W - R} y={py(threshold.at) - 4} textAnchor="end" style={{ font: `600 9px ${MONO}`, fill: threshold.color || RED }}>{threshold.label}</text></>}
      {series.map((s, si) => <g key={si}>
        <Draw duration={560} delay={si * 130}>
          <path d={path(s.values)} fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"  style={{ stroke: (s.color) }} />
        </Draw>
        {s.values.map((v, i) => v.y != null && <circle key={i} cx={px(i)} cy={py(v.y)} r="3.2" strokeWidth="2"
          onMouseEnter={e => setHov({ x: e.clientX, y: e.clientY, txt: `${labels[i]} · ${s.label}: ${yFmt(v.y)}${v.note ? ' · ' + v.note : ''}` })} onMouseLeave={() => setHov(null)}  style={{ fill: 'var(--bg-base)', stroke: (s.color) }} />)}
      </g>)}
      {labels.map((l, i) => (labels.length <= 8 || i % 2 === 0) && <text key={i} x={px(i)} y={H - 6} textAnchor="middle" style={{ font: `500 9px ${MONO}`, fill: DIM }}>{l}</text>)}
    </svg>
    {hov && <div style={{ ...tip, left: Math.min(hov.x + 12, window.innerWidth - 300), top: hov.y - 40 }}>{hov.txt}</div>}
  </div>
}

export function StackedCols({ rows, keys, colors, labels, height = 200, valueOf, onPick, pctMode = true }) {
  const [hov, setHov] = useState(null)
  if (!rows.length) return <div style={{ padding: 22, textAlign: 'center', font: `400 12px ${BODY}`, color: DIM }}>No delivered work yet.</div>
  const W = 640, H = height, T = 10, B = 20, L = 6
  const cw = (W - L * 2) / rows.length
  return <div style={{ position: 'relative' }}>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto', display: 'block' }}>
      {rows.map((r, ri) => {
        const vals = keys.map(k => valueOf(r, k) || 0)
        const tot = vals.reduce((a, b) => a + b, 0)
        const max = pctMode ? tot : Math.max(...rows.map(x => keys.reduce((a, k) => a + (valueOf(x, k) || 0), 0)))
        let acc = 0
        return <g key={ri} className="enter" style={{ '--enter-delay': `${Math.min(ri * 55, 400)}ms` }}>
          {keys.map((k, ki) => {
            const v = vals[ki]
            if (!v || !max) return null
            const h = (v / max) * (H - T - B)
            const y = H - B - acc - h
            acc += h
            return <rect key={k} x={L + ri * cw + cw * 0.16} y={y} width={cw * 0.68} height={Math.max(1, h)} rx="1"
              style={{ fill: (colors[ki]), cursor: onPick ? 'pointer' : 'default' }}
              onMouseEnter={e => setHov({ x: e.clientX, y: e.clientY, txt: `${labels[ri]} · ${k}: ${v.toFixed(1)}${tot ? ` (${Math.round(v / tot * 100)}%)` : ''}` })}
              onMouseLeave={() => setHov(null)} onClick={() => onPick?.(r, k)} />
          })}
          <text x={L + ri * cw + cw / 2} y={H - 6} textAnchor="middle" style={{ font: `500 9px ${MONO}`, fill: DIM }}>{labels[ri]}</text>
        </g>
      })}
    </svg>
    {hov && <div style={{ ...tip, left: Math.min(hov.x + 12, window.innerWidth - 260), top: hov.y - 40 }}>{hov.txt}</div>}
  </div>
}

export function Split({ active, wait, height = 8, showLabels }) {
  const tot = (active || 0) + (wait || 0) || 1
  return <div>
    <div style={{ display: 'flex', height, borderRadius: 5, overflow: 'hidden', background: 'var(--bg-surface-hover)' }}>
      <div title={`mine (In Progress): ${(active || 0).toFixed(1)}d`} style={{ width: `${(active || 0) / tot * 100}%`, background: 'var(--green)' }} />
      <div title={`waiting (review / QA / release): ${(wait || 0).toFixed(1)}d`} style={{ width: `${(wait || 0) / tot * 100}%`, background: 'var(--amber)' }} />
    </div>
    {showLabels && <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, font: `500 9px ${MONO}` }}>
      <span style={{ color: GREEN }}>mine {(active || 0).toFixed(1)}d</span>
      <span style={{ color: GOLD }}>waiting {(wait || 0).toFixed(1)}d</span>
    </div>}
  </div>
}

export function Spark({ values, color = BB, w = 64, h = 18 }) {
  const v = values.filter(x => x != null)
  if (v.length < 2) return <span style={{ font: `400 10px ${MONO}`, color: DIM }}>—</span>
  const max = Math.max(...v), min = Math.min(...v)
  const rng = max - min || 1
  const pts = values.map((x, i) => x == null ? null : [(i / (values.length - 1)) * w, h - ((x - min) / rng) * (h - 2) - 1]).filter(Boolean)
  return <svg width={w} height={h} style={{ display: 'block' }}>
    <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" strokeWidth="2" strokeLinejoin="round"  style={{ stroke: (color) }} />
    <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2"  style={{ fill: (color) }} />
  </svg>
}

export const TYPE_COLORS = { bug: RED, defect: RED, story: BB, feature: BB, task: STEEL, 'sub-task': STEEL, epic: PURPLE, improvement: GREEN }
export const typeColor = t => TYPE_COLORS[String(t || '').toLowerCase()] || GOLD
