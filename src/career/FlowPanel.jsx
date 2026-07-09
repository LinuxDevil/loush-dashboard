import React from 'react'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'
const Bars = ({ title, obj }) => {
  const rows = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const max = Math.max(1, ...rows.map(r => r[1]))
  return (
    <div style={PANEL}>
      <div style={{ font: `600 12px ${MONO}`, color: '#7a716a', textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      {rows.length ? rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 8 }}>
          <div style={{ width: 120, font: `400 11px ${MONO}`, color: '#cbb' }}>{k}</div>
          <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}><div style={{ width: `${v / max * 100}%`, height: '100%', background: ACCENT, borderRadius: 3 }} /></div>
          <div style={{ width: 34, textAlign: 'right', font: `500 11px ${MONO}`, color: '#7a716a' }}>{v}</div>
        </div>
      )) : <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>no data</div>}
    </div>
  )
}
export default function FlowPanel({ snap }) {
  const f = snap.flow || {}
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ ...PANEL, flex: 1 }}><div style={{ font: `700 24px ${HEAD}`, color: (f.afterHoursPct > 0.35 ? '#f2a2c4' : '#e5dbd2') }}>{Math.round((f.afterHoursPct || 0) * 100)}%</div><div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>after-hours sessions</div></div>
        <div style={{ ...PANEL, flex: 1 }}><div style={{ font: `700 24px ${HEAD}`, color: (f.wip > 4 ? '#f2a2c4' : '#e5dbd2') }}>{f.wip || 0}</div><div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>work in progress</div></div>
      </div>
      <Bars title="Session types" obj={f.sessionTypes} />
      <Bars title="Tool mix" obj={snap.workflow?.tools} />
    </div>
  )
}
