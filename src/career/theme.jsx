import React from 'react'
import { Draw, CountUp } from '../game/index.js'
// Devtool palette — Linear / Vercel / GitHub Actions inspired

// Animate a value ONLY when it is a real, finite number. Strings ("$1.2k", "47%", "3.2d") and the honest
// '—' / null / 'suppressed' states render verbatim — a CountUp must never turn a null into a counting-up 0.
const Num = ({ v }) => (typeof v === 'number' && Number.isFinite(v))
  ? <CountUp value={v} decimals={Number.isInteger(v) ? 0 : 1} />
  : <>{v ?? '—'}</>
export const BG = '#0d1117'          // near-black page
export const PANEL_BG = '#161b22'    // slightly lighter panel
export const LINE = '#30363d'        // hairline border
export const INK = '#e6edf3'         // off-white primary
export const MUTE = '#8b949e'        // muted gray secondary
export const GREEN = '#3fb950'
export const RED = '#f85149'
export const PURPLE = '#bc8cff'
export const ACCENT = '#58a6ff'      // links / IDs / active

export const HEAD = "'Space Grotesk', sans-serif"
export const BODY = "'IBM Plex Sans', sans-serif"
export const MONO = "'IBM Plex Mono', monospace"

export const PANEL = { background: PANEL_BG, border: `1px solid ${LINE}`, borderRadius: 10, padding: '16px 18px' }

// low-contrast pill badge
export function Badge({ children, tone = 'mute' }) {
  const map = { mute: [MUTE, '#8b949e22'], accent: [ACCENT, '#58a6ff1f'], green: [GREEN, '#3fb9501f'], red: [RED, '#f851491f'], purple: [PURPLE, '#bc8cff1f'] }
  const [fg, bg] = map[tone] || map.mute
  return <span style={{ font: `500 10.5px ${MONO}`, color: fg, background: bg, border: `1px solid ${fg}33`, borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>{children}</span>
}

// thin progress track
export function Bar({ v, max = 1, color = ACCENT, h = 6 }) {
  return (
    <div style={{ flex: 1, height: h, background: LINE, borderRadius: 999, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, (v / (max || 1)) * 100)}%`, height: '100%', background: color, borderRadius: 999 }} />
    </div>
  )
}

export const Stat = ({ label, val, tone }) => (
  <div style={{ ...PANEL, padding: '14px 16px', flex: 1, minWidth: 130 }}>
    <div style={{ font: `600 24px ${MONO}`, color: tone || INK, letterSpacing: '-0.5px' }}><Num v={val} /></div>
    <div style={{ font: `400 11px ${BODY}`, color: MUTE, marginTop: 2 }}>{label}</div>
  </div>
)

// ── Chart primitives — same TYPES the Claude/Eng dashboards use, in the devtool skin ──────

// colored +/- delta chip
export function Delta({ v, suffix = '', invert = false }) {
  if (v == null || v === 0) return <span style={{ font: `500 11px ${MONO}`, color: MUTE }}>—</span>
  const good = invert ? v < 0 : v > 0
  return <span style={{ font: `500 11px ${MONO}`, color: good ? GREEN : RED }}>{v > 0 ? '↑' : '↓'}{Math.abs(v)}{suffix}</span>
}

// sparkline — one polyline, no axes
export function Sparkline({ data = [], color = ACCENT, w = 120, h = 30, fill = true }) {
  const nums = data.map(Number).filter(n => !Number.isNaN(n))
  if (nums.length < 2) return <svg width={w} height={h} />
  const max = Math.max(...nums, 1), min = Math.min(...nums, 0)
  const rng = max - min || 1
  const pts = nums.map((n, i) => [i / (nums.length - 1) * w, h - ((n - min) / rng) * (h - 4) - 2])
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const id = 'sg' + color.replace('#', '')
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      {fill && <><defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <polygon points={`0,${h} ${line} ${w},${h}`} fill={`url(#${id})`} /></>}
      <Draw duration={480}><polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></Draw>
    </svg>
  )
}

// GitHub-style activity heatmap. days = [{date, v}] (chronological). weeks columns × 7 rows.
export function Heatmap({ days = [], color = ACCENT, cell = 11, gap = 3 }) {
  const max = Math.max(1, ...days.map(d => d.v || 0))
  const cols = []
  for (let i = 0; i < days.length; i += 7) cols.push(days.slice(i, i + 7))
  const shade = v => v <= 0 ? LINE : `color-mix(in srgb, ${color} ${18 + Math.round((v / max) * 82)}%, ${PANEL_BG})`
  return (
    <div style={{ display: 'flex', gap, overflowX: 'auto' }}>
      {cols.map((wk, i) => (
        <div key={i} style={{ display: 'grid', gap, gridTemplateRows: `repeat(7, ${cell}px)` }}>
          {wk.map((d, j) => <div key={j} title={`${d.date}: ${d.v || 0}`} style={{ width: cell, height: cell, borderRadius: 2, background: shade(d.v || 0) }} />)}
        </div>
      ))}
    </div>
  )
}

// donut progress ring with centered label
export function Ring({ value = 0, size = 62, stroke = 7, color = ACCENT, label, sub }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, value)))
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={LINE} strokeWidth={stroke} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
        </svg>
        {label != null && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', font: `600 ${size > 54 ? 15 : 12}px ${MONO}`, color: INK }}>{label}</div>}
      </div>
      {sub && <div style={{ font: `400 10.5px ${BODY}`, color: MUTE, textAlign: 'center' }}>{sub}</div>}
    </div>
  )
}

// KPI tile: value + optional delta + caption + optional sparkline
export function Tile({ label, value, sub, delta, deltaSuffix, invertDelta, spark, sparkColor = ACCENT, tone, minWidth = 150 }) {
  return (
    <div style={{ ...PANEL, padding: '13px 16px', flex: 1, minWidth, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ font: `500 10.5px ${BODY}`, color: MUTE, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ font: `600 23px ${MONO}`, color: tone || INK, letterSpacing: '-0.5px' }}><Num v={value} /></span>
        {delta != null && <Delta v={delta} suffix={deltaSuffix} invert={invertDelta} />}
      </div>
      {sub && <div style={{ font: `400 11px ${BODY}`, color: MUTE }}>{sub}</div>}
      {spark && <div style={{ marginTop: 4 }}><Sparkline data={spark} color={sparkColor} w={160} h={26} /></div>}
    </div>
  )
}

// compact dark table. columns: [{key,label,align?,render?(row),width?}]
export function MiniTable({ columns = [], rows = [], empty = 'no data', onRowClick, maxHeight = 420 }) {
  if (!rows.length) return <div style={{ font: `400 12px ${MONO}`, color: MUTE }}>{empty}</div>
  return (
    <div style={{ overflow: 'auto', maxHeight }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', font: `400 12px ${BODY}` }}>
        <thead><tr>{columns.map(c => <th key={c.key} style={{ textAlign: c.align === 'right' ? 'right' : 'left', font: `500 10.5px ${MONO}`, color: MUTE, textTransform: 'uppercase', letterSpacing: '0.6px', padding: '6px 10px', borderBottom: `1px solid ${LINE}`, position: 'sticky', top: 0, background: PANEL_BG, whiteSpace: 'nowrap' }}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? row.key ?? i} onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ borderBottom: `1px solid ${LINE}`, cursor: onRowClick ? 'pointer' : 'default' }}
              onMouseEnter={e => e.currentTarget.style.background = '#ffffff08'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {columns.map(c => <td key={c.key} style={{ textAlign: c.align === 'right' ? 'right' : 'left', color: INK, padding: '7px 10px', whiteSpace: c.wrap ? 'normal' : 'nowrap', maxWidth: c.width, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.render ? c.render(row) : row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// spinning ring (relies on global @keyframes crSpin, injected by CareerDashboard)
export function Spinner({ size = 15, color = ACCENT }) {
  return <span style={{ display: 'inline-block', width: size, height: size, border: `2px solid ${LINE}`, borderTopColor: color, borderRadius: '50%', animation: 'crSpin 0.7s linear infinite' }} />
}

// subtle "updating…" chip shown while SWR revalidates cached data
export function Updating({ show }) {
  if (!show) return null
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: `400 11px ${MONO}`, color: MUTE }}><Spinner size={11} /> updating…</span>
}

// first-load skeleton for an eng/usage-gated page (pulsing tiles + label)
export function LoadingPanel({ label = 'Loading…', tiles = 4 }) {
  const pulse = { background: PANEL_BG, border: `1px solid ${LINE}`, borderRadius: 10, animation: 'crPulse 1.4s ease-in-out infinite' }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, font: `400 12px ${MONO}`, color: MUTE }}><Spinner /> {label}</div>
      <div style={{ display: 'flex', gap: 16 }}>{Array.from({ length: tiles }).map((_, i) => <div key={i} style={{ ...pulse, height: 74, flex: 1, animationDelay: `${i * 0.12}s` }} />)}</div>
      <div style={{ ...pulse, height: 180 }} />
      <div style={{ ...pulse, height: 200 }} />
    </div>
  )
}

// section header used inside panels
export function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
      <div style={{ font: `600 13px ${HEAD}`, color: INK }}>{children}</div>
      <div style={{ flex: 1 }} />
      {right}
    </div>
  )
}
