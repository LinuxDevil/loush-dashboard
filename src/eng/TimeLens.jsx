import React from 'react'
import { BODY, MONO, DIM, sel, inp } from './ui.jsx'

// §3 — ONE time window. Every panel reads it. This is a TIME FILTER, not a persona/lens/role switcher:
// it never changes WHAT is on screen, only WHEN. The OKR tab's private Q3/Q4 toggle is deleted — it swapped
// objective definitions while the measures still came from the month-filtered set, mislabelling every %.
const DAY = 86400000
const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1).getTime()
const startOfQuarter = d => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime()

export const WINDOWS = ['sprint', '14d', '30d', 'month', 'quarter', 'custom']
const LABELS = { sprint: 'Active sprint', '14d': 'Last 14d', '30d': 'Last 30d', month: 'This month', quarter: 'This quarter', custom: 'Custom' }

// resolve {id,label,from,to} — `sprints` is the server's sprint list (used only to find the active one)
export function resolveWindow(id, sprints, from, to) {
  const now = Date.now(), d = new Date(now)
  if (id === 'custom' && from && to) return { id, label: `${from} → ${to}`, from: Date.parse(from), to: Date.parse(to) + DAY - 1, custom: true }
  if (id === 'sprint') {
    const s = (sprints || []).find(x => /active/i.test(x.state || '')) || (sprints || [])[0]
    if (s?.startDate) return { id, label: s.name, from: Date.parse(s.startDate), to: Date.parse(s.completeDate || s.endDate || now), sprint: s }
    return { id: '30d', label: LABELS['30d'] + ' (no active sprint)', from: now - 30 * DAY, to: now }
  }
  if (id === '14d') return { id, label: LABELS[id], from: now - 14 * DAY, to: now }
  if (id === 'month') return { id, label: d.toLocaleString([], { month: 'long', year: 'numeric' }), from: startOfMonth(d), to: now }
  if (id === 'quarter') return { id, label: `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`, from: startOfQuarter(d), to: now }
  return { id: '30d', label: LABELS['30d'], from: now - 30 * DAY, to: now }
}
// the previous window of the same length — every delta on this dashboard is against this, not "last month"
export const prevWindow = w => ({ from: w.from - (w.to - w.from), to: w.from })

// a ticket lands in the window when it went live in it; an unshipped ticket is "now" and never filtered out
export const shippedIn = (w, i) => {
  const t = Date.parse(i.liveAt || i.closedAt || 0)
  return !!t && t >= w.from && t <= w.to
}
export const createdIn = (w, i) => { const t = Date.parse(i.created || 0); return !!t && t >= w.from && t <= w.to }
export const prIn = (w, p) => { const t = Date.parse(p.mergedAt || p.createdAt || 0); return !!t && t >= w.from && t <= w.to }

export function TimeLens({ value, from, to, onChange, sprints, resolved }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 2px 2px 8px', borderRadius: 9, background: 'rgba(142,200,255,0.07)', border: '1px solid rgba(142,200,255,0.16)' }}>
      <span style={{ font: `500 9px ${MONO}`, letterSpacing: '0.06em', color: '#6f8199', textTransform: 'uppercase' }}>window</span>
      <select value={value} onChange={e => onChange({ win: e.target.value })} style={{ ...sel, border: 'none', background: 'transparent' }}>
        {WINDOWS.map(w => <option key={w} value={w} disabled={w === 'sprint' && !(sprints || []).length}>{LABELS[w]}</option>)}
      </select>
    </div>
    {value === 'custom' && <>
      <input type="date" value={from || ''} onChange={e => onChange({ from: e.target.value })} style={{ ...inp, width: 132, padding: '5px 8px', fontFamily: MONO, fontSize: 11 }} />
      <input type="date" value={to || ''} onChange={e => onChange({ to: e.target.value })} style={{ ...inp, width: 132, padding: '5px 8px', fontFamily: MONO, fontSize: 11 }} />
    </>}
    {resolved && <span style={{ font: `400 10px ${MONO}`, color: DIM, whiteSpace: 'nowrap' }}>{resolved.label}</span>}
  </div>
}
