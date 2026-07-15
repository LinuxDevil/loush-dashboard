import React from 'react'
import { PANEL, PANEL_BG, LINE, HEAD, MONO, BODY, ACCENT, MUTE, INK, GREEN, RED, PURPLE } from './theme.jsx'
import { copy, copyJson } from './data.jsx'
import { Draw, CountUp } from '../game/index.js'

const jiraUrl = i => i.host ? `https://${i.host}/browse/${i.key}` : null

// ── the trust primitives ─────────────────────────────────────────────────────────────────────
// Every panel ends in the raw payload. An engineer who can reproduce a number in a terminal argues
// with the data instead of dismissing the dashboard.
export function Btn({ onClick, children, tone = ACCENT, title, disabled }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={{
      font: `600 11px ${MONO}`, color: disabled ? MUTE : tone, background: 'transparent',
      border: `1px solid ${disabled ? LINE : tone + '55'}`, borderRadius: 6, padding: '3px 8px',
      cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap',
    }}>{children}</button>
  )
}
// "Copy nudge" — the ONLY shape a nudge takes in this app. No auto-ping, ever.
export const Nudge = ({ text, label = '⧉ copy nudge' }) => <Btn onClick={() => copy(text, 'nudge copied — you send it')}>{label}</Btn>

// Panel with a title, an optional right slot, and the raw-JSON escape hatch.
export function Card({ title, sub, right, json, children, tone, style }) {
  return (
    <div style={{ ...PANEL, ...(tone ? { borderColor: tone + '55' } : null), ...style }}>
      {(title || right || json) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div>
            <div style={{ font: `600 13px ${HEAD}`, color: INK }}>{title}</div>
            {sub && <div style={{ font: `400 11px ${MONO}`, color: MUTE, marginTop: 2 }}>{sub}</div>}
          </div>
          <div style={{ flex: 1 }} />
          {right}
          {json !== undefined && <Btn tone={MUTE} onClick={() => copyJson(json)} title="copy this panel's raw payload">{'{ }'}</Btn>}
        </div>
      )}
      {children}
    </div>
  )
}

// Where the server says "not configured" / "suppressed" / "low coverage", render THAT. Never a zero.
export function Empty({ children, tone = MUTE }) {
  return <div style={{ font: `400 12px ${BODY}`, color: tone, lineHeight: 1.5 }}>{children}</div>
}

// prior-period ± chip. dir 'down' = lower is better.
export function Cmp({ cur, prev, unit = '', dir = 'up', label }) {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return null
  const abs = +(cur - prev).toFixed(2)
  if (abs === 0) return <span style={{ font: `500 11px ${MONO}`, color: MUTE }}>= {label || 'prior'}</span>
  const good = dir === 'down' ? abs < 0 : abs > 0
  return (
    <span title={`prior period: ${prev}${unit}`} style={{ font: `500 11px ${MONO}`, color: good ? GREEN : RED }}>
      {abs > 0 ? '↑' : '↓'}{Math.abs(abs)}{unit} {label ? <span style={{ color: MUTE }}>{label}</span> : null}
    </span>
  )
}

// 100% stacked bar. segs = [{key, value, color}]
export function Stacked({ segs = [], height = 12, legend = true }) {
  const total = segs.reduce((a, s) => a + (s.value || 0), 0) || 1
  return (
    <div>
      <div style={{ display: 'flex', height, borderRadius: 999, overflow: 'hidden', background: LINE }}>
        {segs.filter(s => s.value > 0).map(s => (
          <div key={s.key} title={`${s.key}: ${s.value} (${Math.round(s.value / total * 100)}%)`} style={{ width: `${s.value / total * 100}%`, background: s.color }} />
        ))}
      </div>
      {legend && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 7, font: `400 11px ${MONO}`, color: MUTE }}>
          {segs.filter(s => s.value > 0).map(s => <span key={s.key}><span style={{ color: s.color }}>●</span> {s.key} {Math.round(s.value / total * 100)}%</span>)}
        </div>
      )}
    </div>
  )
}

// horizontal labelled bars. rows = [{label, value, color?, sub?, onClick?}]
export function HBars({ rows = [], unit = '', labelWidth = 150, max: maxIn, empty = 'no data' }) {
  if (!rows.length) return <Empty>{empty}</Empty>
  const max = maxIn || Math.max(1, ...rows.map(r => r.value || 0))
  return (
    <div>
      {rows.map(r => (
        <div key={r.label} onClick={r.onClick} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6, cursor: r.onClick ? 'pointer' : 'default' }}>
          <div title={r.label} style={{ width: labelWidth, font: `400 11px ${MONO}`, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</div>
          <div style={{ flex: 1, height: 8, background: LINE, borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, (r.value / max) * 100)}%`, height: '100%', background: r.color || ACCENT, borderRadius: 999 }} />
          </div>
          <div style={{ width: 84, textAlign: 'right', font: `500 11px ${MONO}`, color: MUTE, whiteSpace: 'nowrap' }}>{r.sub ?? `${r.value}${unit}`}</div>
        </div>
      ))}
    </div>
  )
}

// One sentence, big, with the number in it. The only "headline" shape in this dashboard.
export function Headline({ children, tone = INK, icon }) {
  return (
    <div style={{ font: `500 14px ${BODY}`, color: tone, lineHeight: 1.5 }}>
      {icon ? <span style={{ marginRight: 8 }}>{icon}</span> : null}{children}
    </div>
  )
}

// tiny project-key tag  (AIR / TRN)
export function ProjTag({ k }) {
  return <span style={{ font: `600 9.5px ${MONO}`, color: MUTE, background: '#ffffff0d', border: `1px solid ${LINE}`, borderRadius: 4, padding: '1px 5px', letterSpacing: '0.5px' }}>{k}</span>
}

// header count pills — "4 engineers"  "18 in progress"
export function HeaderPills({ items }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {items.filter(Boolean).map(([v, label, color], i) => (
        <span key={i} style={{ font: `400 12px ${MONO}`, color: MUTE, background: PANEL_BG, border: `1px solid ${LINE}`, borderRadius: 999, padding: '4px 11px' }}>
          <b style={{ color: color || INK, fontWeight: 600 }}>{v}</b> {label}
        </span>
      ))}
    </div>
  )
}

// role chip on a card — Dev / QA / Now
function RoleChip({ label, name, c }) {
  return <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', font: `400 10px ${MONO}`, color: MUTE }}>
    <span style={{ color: c, fontWeight: 600 }}>{label}</span>{name || '—'}
  </span>
}

// one kanban ticket card
function BoardCard({ i }) {
  const risk = i.rec?.atRisk
  return (
    <a href={jiraUrl(i)} target="_blank" rel="noreferrer" style={{
      display: 'block', textDecoration: 'none', background: PANEL_BG,
      border: `1px solid ${risk ? '#f8514955' : LINE}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ font: `600 12px ${MONO}`, color: ACCENT }}>{i.key}</span>
        <ProjTag k={i.project} />
        <span style={{ flex: 1 }} />
        <span style={{ font: `400 10.5px ${MONO}`, color: risk ? RED : MUTE }}>{i.inCurrent}d{risk ? ' ⚠' : ''}</span>
      </div>
      <div style={{ font: `400 12px ${BODY}`, color: INK, margin: '6px 0', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{i.summary}</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <RoleChip label="Dev" name={i.devAssignee?.name?.split(' ')[0]} c={ACCENT} />
        <RoleChip label="QA" name={i.qaAssignee?.name?.split(' ')[0]} c={GREEN} />
        <RoleChip label="Now" name={i.assignee?.name?.split(' ')[0]} c={PURPLE} />
        <span style={{ flex: 1 }} />
        <span style={{ font: `500 10px ${MONO}`, color: MUTE }}>{i.pts ? `${i.pts} pt` : '—'}</span>
      </div>
    </a>
  )
}

// kanban board — columns keyed by status, each a list of cards
export function Kanban({ columns }) {
  return (
    <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>
      {columns.map(col => (
        <div key={col.title} style={{ minWidth: 250, flex: '1 0 250px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: col.color || ACCENT }} />
            <span style={{ font: `600 12px ${HEAD}`, color: INK }}>{col.title}</span>
            <span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{col.items.length}</span>
          </div>
          <div style={{ maxHeight: 560, overflowY: 'auto', paddingRight: 2 }}>
            {col.items.length ? col.items.map(i => <BoardCard key={i.key} i={i} />)
              : <div style={{ font: `400 11px ${MONO}`, color: MUTE, padding: '8px 0' }}>—</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

// smooth Catmull-Rom → bezier path for the trend line
function smoothPath(pts) {
  if (pts.length < 2) return ''
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

// area+line trend chart with headline value + delta.  series = [{label, value}]
export function TrendChart({ series = [], title, unit = 'd', color = ACCENT, invertDelta = true, height = 200 }) {
  const vals = series.map(s => s.value)
  const cur = vals[vals.length - 1] ?? 0, prev = vals[0] ?? 0
  const deltaPct = prev ? Math.round(((cur - prev) / prev) * 100) : 0
  const good = invertDelta ? deltaPct < 0 : deltaPct > 0
  const W = 640, H = height, padX = 8, padTop = 16, padBot = 26
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals), rng = max - min || 1
  const pts = series.map((s, i) => [padX + (i / Math.max(1, series.length - 1)) * (W - padX * 2), padTop + (1 - (s.value - min) / rng) * (H - padTop - padBot)])
  const line = smoothPath(pts)
  const area = line ? `${line} L${pts[pts.length - 1][0]},${H - padBot} L${pts[0][0]},${H - padBot} Z` : ''
  return (
    <div style={PANEL}>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 4 }}>
        <div style={{ font: `600 13px ${HEAD}`, color: INK }}>{title}</div>
        <div style={{ flex: 1 }} />
        <div style={{ font: `400 11px ${MONO}`, color: MUTE }}>{series[0]?.label} → {series[series.length - 1]?.label}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ font: `600 30px ${MONO}`, color, letterSpacing: '-1px' }}>{Number.isFinite(cur) ? <CountUp value={cur} decimals={Number.isInteger(cur) ? 0 : 1} suffix={unit} /> : `${cur}${unit}`}</div>
        {series.length > 1 && <div style={{ font: `500 12px ${MONO}`, color: good ? GREEN : RED }}>{deltaPct > 0 ? '↑' : '↓'} {Math.abs(deltaPct)}% vs {series[0]?.label}</div>}
      </div>
      {series.length > 1 ? (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ marginTop: 8, overflow: 'visible' }}>
          <defs><linearGradient id="trendfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.22" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
          <path d={area} fill="url(#trendfill)" />
          <Draw duration={620}>
            <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill={PANEL_BG} stroke={color} strokeWidth="2" />)}
          </Draw>
          {series.map((s, i) => <text key={i} x={pts[i][0]} y={H - 8} textAnchor="middle" style={{ font: `400 10px ${MONO}`, fill: MUTE }}>{s.label}</text>)}
        </svg>
      ) : <div style={{ font: `400 12px ${MONO}`, color: MUTE, marginTop: 12 }}>not enough history yet</div>}
    </div>
  )
}

// "where time goes" — stacked active/waiting bar + per-status horizontal bars
export function WhereTimeGoes({ statusDays = {}, statusColor = {}, statusKind = {}, active = 0, waiting = 0 }) {
  const total = active + waiting || 1
  const rows = Object.entries(statusDays).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const max = Math.max(1, ...rows.map(r => r[1]))
  const fmt = n => n >= 100 ? Math.round(n) : n.toFixed(1)
  return (
    <div style={PANEL}>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 12 }}>
        <div style={{ font: `600 13px ${HEAD}`, color: INK }}>Where time goes</div>
        <div style={{ flex: 1 }} />
        <div style={{ font: `400 11px ${MONO}`, color: MUTE }}>working days · from JIRA</div>
      </div>
      <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ width: `${active / total * 100}%`, background: GREEN }} />
        <div style={{ width: `${waiting / total * 100}%`, background: '#e3b341' }} />
      </div>
      <div style={{ display: 'flex', gap: 16, font: `400 11px ${MONO}`, color: MUTE, marginBottom: 14 }}>
        <span><span style={{ color: GREEN }}>●</span> Active {fmt(active)}d</span>
        <span><span style={{ color: '#e3b341' }}>●</span> Waiting {fmt(waiting)}d</span>
      </div>
      {rows.map(([status, v]) => (
        <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
          <div style={{ width: 130, font: `400 11px ${MONO}`, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{status}</div>
          <div style={{ flex: 1, height: 8, background: LINE, borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: `${v / max * 100}%`, height: '100%', background: statusColor[status] || (statusKind[status] === 'active' ? GREEN : '#e3b341'), borderRadius: 999 }} />
          </div>
          <div style={{ width: 60, textAlign: 'right', font: `500 11px ${MONO}`, color: MUTE }}>{fmt(v)}d</div>
        </div>
      ))}
    </div>
  )
}

// intra-page sub-tab strip
export function SubTabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${LINE}`, marginBottom: 4 }}>
      {tabs.map(t => (
        <button key={t} onClick={() => onChange(t)} style={{
          font: `${active === t ? 600 : 400} 12.5px ${BODY}`, color: active === t ? INK : MUTE,
          background: 'transparent', border: 'none', borderBottom: `2px solid ${active === t ? ACCENT : 'transparent'}`,
          padding: '8px 12px', cursor: 'pointer', marginBottom: -1,
        }}>{t}</button>
      ))}
    </div>
  )
}
