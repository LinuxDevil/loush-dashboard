import React from 'react'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'
export default function MePanel({ snap }) {
  const me = snap.me || {}, streak = snap.rollup?.streaks?.coding || 0
  const top = (snap.focus || []).slice(0, 3)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ ...PANEL, flex: 1 }}><div style={{ font: `700 26px ${HEAD}` }}>{me.runningNow?.length || 0}</div><div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>running now</div></div>
        <div style={{ ...PANEL, flex: 1 }}><div style={{ font: `700 26px ${HEAD}` }}>{streak}🔥</div><div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>day coding streak</div></div>
        <div style={{ ...PANEL, flex: 1 }}><div style={{ font: `700 26px ${HEAD}` }}>{me.sessionCount || 0}</div><div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>sessions in window</div></div>
      </div>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>What to focus on</div>
        {top.length ? top.map(f => <div key={f.id} style={{ font: `400 12px ${MONO}`, color: '#e5dbd2', padding: '4px 0' }}>• [{f.severity}] {f.message}</div>)
          : <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>nothing flagged — clean run</div>}
      </div>
    </div>
  )
}
