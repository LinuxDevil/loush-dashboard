import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'

// Small chart kit for the Constitution section — glanceable visuals chosen per data type:
// ranking → Bars (horizontal), part-to-whole → StackedBar, progress → Ring,
// sequence → Stepper (step graph), hierarchy → Treemap. Plain SVG + CSS animations,
// d3 only for the treemap layout (already a dependency).
const MONO = "var(--mono)"
const HEAD = "var(--head)"

// one-time keyframes for mount animations
if (typeof document !== 'undefined' && !document.getElementById('atoms-chart-anim')) {
  const s = document.createElement('style')
  s.id = 'atoms-chart-anim'
  s.textContent = `
    @keyframes chartGrowX { from { transform: scaleX(0) } to { transform: scaleX(1) } }
    @keyframes chartFadeUp { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
    @keyframes chartPop { from { opacity: 0; transform: scale(.85) } to { opacity: 1; transform: none } }
    .chart-bar-fill { transform-origin: left; animation: chartGrowX .5s cubic-bezier(.2,.8,.2,1) both }
    .chart-fade { animation: chartFadeUp .35s ease both }
    .chart-pop { animation: chartPop .3s ease both }
  `
  document.head.appendChild(s)
}

// ---------- DataTable: sortable dark table — the structured replacement for text lists ----------
// columns: [{ key, label, render?(row), sortValue?(row), width?, align? }]
export function DataTable({ columns, rows, sort: initialSort, maxHeight = '60vh', onRowClick }) {
  const [sort, setSort] = useState(initialSort || null) // { key, dir: 1|-1 }
  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find(c => c.key === sort.key)
    const val = col?.sortValue || (r => r[sort.key])
    return [...rows].sort((a, b) => { const x = val(a) ?? '', y = val(b) ?? ''; return (x < y ? -1 : x > y ? 1 : 0) * sort.dir })
  }, [rows, sort, columns])
  const th = { position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-surface-active)', font: `600 10px ${MONO}`, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', padding: '7px 10px', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-default)' }
  return (
    <div className="chart-fade" style={{ overflow: 'auto', maxHeight, borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} style={{ ...th, width: c.width, textAlign: c.align || 'left' }}
                onClick={() => setSort(s => s?.key === c.key ? { key: c.key, dir: -s.dir } : { key: c.key, dir: 1 })}>
                {c.label}{sort?.key === c.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.__key ?? i} onClick={onRowClick ? () => onRowClick(r) : undefined}
              style={{ background: i % 2 ? 'var(--bg-surface)' : 'transparent', cursor: onRowClick ? 'pointer' : 'default' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-surface-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = i % 2 ? 'var(--bg-surface)' : 'transparent'}>
              {columns.map(c => (
                <td key={c.key} style={{ padding: '8px 10px', font: `400 11px ${MONO}`, color: 'var(--text-primary)', verticalAlign: 'top', textAlign: c.align || 'left', borderBottom: '1px solid var(--border-subtle)', minWidth: 0 }}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={columns.length} style={{ padding: 12, font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no rows</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Facts: labeled key metrics grid — replaces loose metadata sentences ----------
export function Facts({ items }) {
  return (
    <div className="chart-fade" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(110px, 1fr))`, gap: 8 }}>
      {items.filter(f => f.value != null && f.value !== '').map(f => (
        <div key={f.label} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '9px 12px' }}>
          <div style={{ font: `600 16px ${MONO}`, color: f.color || 'var(--text-primary)' }}>{f.value}</div>
          <div style={{ font: `400 9px ${MONO}`, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>{f.label}</div>
        </div>
      ))}
    </div>
  )
}

// ---------- Ring: radial progress for a single status metric ----------
export function Ring({ value, size = 64, stroke = 7, color = 'var(--green)', label, sub, track = 'var(--bg-surface-active)' }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value ?? 0))
  const [off, setOff] = useState(c)
  useEffect(() => { const t = requestAnimationFrame(() => setOff(c * (1 - v))); return () => cancelAnimationFrame(t) }, [v, c])
  return (
    <div className="chart-pop" style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}  style={{ stroke: (track) }} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={off} style={{ stroke: (color), transition: 'stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)' }} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', font: `600 ${size / 4.2}px ${MONO}`, color: 'var(--text-primary)' }}>
          {label ?? Math.round(v * 100) + '%'}
        </div>
      </div>
      {sub && <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', textAlign: 'center' }}>{sub}</div>}
    </div>
  )
}

// ---------- StackedBar: part-to-whole composition in one line ----------
export function StackedBar({ segments, height = 10, legend = true, style }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  return (
    <div className="chart-fade" style={{ minWidth: 0, ...style }}>
      <div style={{ display: 'flex', height, borderRadius: height / 2, overflow: 'hidden', background: 'var(--bg-surface-hover)' }}>
        {segments.filter(s => s.value > 0).map((s, i) => (
          <div key={i} className="chart-bar-fill" title={`${s.label}: ${s.value}`}
            style={{ width: (s.value / total * 100) + '%', background: s.color, animationDelay: i * 60 + 'ms' }} />
        ))}
      </div>
      {legend && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 5 }}>
          {segments.filter(s => s.value > 0).map((s, i) => (
            <span key={i} style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 2, background: s.color, marginRight: 4 }} />
              {s.label} <b style={{ color: 'var(--text-primary)' }}>{s.value}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Bars: horizontal ranking chart with value labels ----------
export function Bars({ items, max, color = 'var(--blue)', height = 16, onClick, valueLabel = v => v }) {
  const m = max ?? Math.max(...items.map(i => i.value), 1)
  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
      {items.map((it, i) => (
        <div key={it.label} onClick={onClick ? () => onClick(it) : undefined} title={it.hint || it.label}
          style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 200px) 1fr 42px', gap: 8, alignItems: 'center', cursor: onClick ? 'pointer' : 'default' }}>
          <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left' }}>{it.label}</span>
          <div style={{ height, background: 'var(--bg-surface-hover)', borderRadius: height / 2, overflow: 'hidden' }}>
            <div className="chart-bar-fill" style={{ width: Math.max(2, it.value / m * 100) + '%', height: '100%', background: it.color || color, borderRadius: height / 2, animationDelay: i * 40 + 'ms', opacity: 0.9 }} />
          </div>
          <span style={{ font: `600 11px ${MONO}`, color: it.color || color }}>{valueLabel(it.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ---------- Stepper: numbered step graph for a sequential flow ----------
export function Stepper({ steps, accent = 'var(--blue)' }) {
  return (
    <div style={{ display: 'grid', gap: 0 }}>
      {steps.map((s, i) => (
        <div key={i} className="chart-fade" style={{ display: 'grid', gridTemplateColumns: '26px 1fr', gap: 10, animationDelay: i * 50 + 'ms' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, background: accent + '22', border: `1.5px solid ${accent}`, display: 'grid', placeItems: 'center', font: `700 10px ${MONO}`, color: accent, flexShrink: 0 }}>{i + 1}</div>
            {i < steps.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 10, background: "var(--border-default)" }} />}
          </div>
          <div style={{ paddingBottom: i < steps.length - 1 ? 14 : 0, minWidth: 0 }}>
            <div style={{ font: `500 12px var(--body)`, color: 'var(--text-primary)' }}>{s.title}</div>
            {s.sub && <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', marginTop: 2, overflowWrap: 'anywhere' }}>{s.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------- Treemap: folder hierarchy, color = coverage ----------
// dirs: [{dir: 'packages/app/...', sources: [ids]}] — leaf size 1, color by artifact count.
export function CoverageTreemap({ dirs, height = 380 }) {
  const ref = useRef(null)
  const [tip, setTip] = useState(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const width = el.clientWidth || 900
    // build hierarchy from flat dir list — only leaves (dirs with no scanned child) get size
    const set = new Set(dirs.map(d => d.dir))
    const byDir = new Map(dirs.map(d => [d.dir, d.sources.length]))
    const leaves = dirs.filter(d => ![...set].some(o => o !== d.dir && o.startsWith(d.dir + '/')))
    const root = d3.hierarchy(
      d3.group(leaves, d => d.dir.split('/')[1] || 'packages', d => d.dir.split('/')[2] || '·')
    ).count()
    d3.treemap().size([width, height]).paddingInner(2).paddingOuter(3).paddingTop(16).round(true)(root)

    const color = n => n === 0 ? 'var(--red)' : n === 1 ? 'var(--amber)' : n <= 3 ? 'var(--green)' : 'var(--green)'
    const svg = d3.select(el).html('').append('svg').attr('width', width).attr('height', height).style('border-radius', '10px')

    // group headers
    svg.selectAll('.hdr').data(root.descendants().filter(d => d.depth === 1)).join('text')
      .attr('x', d => d.x0 + 4).attr('y', d => d.y0 + 12)
      .attr('font-size', 9).attr('font-family', 'var(--mono)').style('fill', 'var(--text-secondary)')
      .text(d => d.data[0])

    const leaf = svg.selectAll('.leaf').data(root.leaves()).join('g').attr('transform', d => `translate(${d.x0},${d.y0})`)
    leaf.append('rect')
      .attr('width', d => Math.max(0, d.x1 - d.x0)).attr('height', d => Math.max(0, d.y1 - d.y0))
      .attr('rx', 3)
      .style('fill', d => color(byDir.get(d.data.dir) ?? 0))
      .attr('fill-opacity', 0.82)
      .style('stroke', 'var(--bg-inset)')
      .style('cursor', 'pointer')
      .on('mousemove', (e, d) => setTip({ x: e.offsetX, y: e.offsetY, dir: d.data.dir, n: byDir.get(d.data.dir) ?? 0, sources: d.data.sources }))
      .on('mouseleave', () => setTip(null))
      .transition().duration(400).attr('fill-opacity', d => (byDir.get(d.data.dir) ?? 0) === 0 ? 0.95 : 0.75)
    leaf.append('text')
      .attr('x', 4).attr('y', 11)
      .attr('font-size', 8.5).attr('font-family', 'var(--mono)')
      .style('fill', 'var(--bg-surface-active)').attr('pointer-events', 'none')
      .text(d => (d.x1 - d.x0) > 60 && (d.y1 - d.y0) > 14 ? d.data.dir.split('/').pop() : '')
  }, [dirs, height])
  return (
    <div style={{ position: 'relative' }}>
      <div ref={ref} />
      {tip && (
        <div style={{ position: 'absolute', left: Math.min(tip.x + 12, (ref.current?.clientWidth || 600) - 260), top: tip.y + 12, zIndex: 5, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, padding: '8px 10px', maxWidth: 250, pointerEvents: 'none' }}>
          <div style={{ font: `500 11px ${MONO}`, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{tip.dir}</div>
          <div style={{ font: `400 10px ${MONO}`, color: tip.n === 0 ? 'var(--red)' : 'var(--green)', marginTop: 3 }}>
            {tip.n === 0 ? '⚠ zero coverage' : `${tip.n} artifact${tip.n > 1 ? 's' : ''} govern this`}
          </div>
          {tip.sources?.slice(0, 4).map(s => <div key={s} style={{ font: `400 9px ${MONO}`, color: 'var(--text-secondary)' }}>{s}</div>)}
          {tip.sources?.length > 4 && <div style={{ font: `400 9px ${MONO}`, color: 'var(--text-tertiary)' }}>+{tip.sources.length - 4} more</div>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 6, font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>
        {[['var(--red)', 'zero coverage'], ['var(--amber)', '1 artifact'], ['var(--green)', '2–3'], ['var(--green)', '4+']].map(([c, l]) => (
          <span key={l}><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: c, marginRight: 4 }} />{l}</span>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }}>tile = source folder · hover for detail</span>
      </div>
    </div>
  )
}
