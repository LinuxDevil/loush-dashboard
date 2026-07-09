import React from 'react'
import { PANEL, MONO, BODY, ACCENT, MUTE, INK, PURPLE, GREEN, Tile, Bar, Sparkline, SectionTitle } from './theme.jsx'
import { useUsage } from './data.jsx'

const k = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n || 0)

const Bars = ({ title, obj, color = ACCENT }) => {
  const rows = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const max = Math.max(1, ...rows.map(r => r[1]))
  return (
    <div style={PANEL}>
      <SectionTitle>{title}</SectionTitle>
      {rows.length ? rows.map(([key, v]) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', marginBottom: 7, gap: 10 }}>
          <div style={{ width: 130, font: `400 11.5px ${MONO}`, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{key}</div>
          <Bar v={v} max={max} color={color} />
          <div style={{ width: 40, textAlign: 'right', font: `500 11px ${MONO}`, color: MUTE }}>{v}</div>
        </div>
      )) : <div style={{ font: `400 11px ${MONO}`, color: MUTE }}>no data</div>}
    </div>
  )
}

export default function FlowPanel({ snap }) {
  const f = snap.flow || {}
  const { data: usage } = useUsage()
  const daily = usage?.daily || []
  const lineSpark = daily.slice(-30).map(d => d.lines || 0)
  const msgSpark = daily.slice(-30).map(d => d.msgs || 0)
  const kpi = usage?.kpis || {}

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Tile label="after-hours sessions" value={`${Math.round((f.afterHoursPct || 0) * 100)}%`} sub="protect deep-work blocks" tone={f.afterHoursPct > 0.35 ? PURPLE : INK} />
        <Tile label="work in progress" value={f.wip || 0} sub="tickets in-progress" tone={f.wip > 4 ? PURPLE : INK} />
        <Tile label="lines / day (30d)" value={`+${k(kpi.lines7d?.add || 0)}`} sub="7d added" tone={GREEN} spark={lineSpark} sparkColor={GREEN} />
        <Tile label="messages / day (30d)" value={usage?.totalMsgs ? k(usage.totalMsgs) : '—'} sub="total" spark={msgSpark} />
      </div>
      <Bars title="Session types" obj={f.sessionTypes} />
      <Bars title="Tool mix" obj={snap.workflow?.tools} color={PURPLE} />
    </div>
  )
}
