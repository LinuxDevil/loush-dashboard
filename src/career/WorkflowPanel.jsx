import React from 'react'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'
import Analyze from './Analyze.jsx'

const Bars = ({ title, obj, color = ACCENT }) => {
  const rows = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const max = Math.max(1, ...rows.map(r => r[1]))
  return <div style={{ marginTop: 8 }}>
    <div style={{ font: `600 11px ${MONO}`, color: '#7a716a', marginBottom: 4 }}>{title}</div>
    {rows.length ? rows.map(([k, v]) => <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
      <div style={{ width: 140, font: `400 10.5px ${MONO}`, color: '#cbb' }}>{k}</div>
      <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}><div style={{ width: `${v / max * 100}%`, height: '100%', background: color, borderRadius: 3 }} /></div>
      <div style={{ width: 30, textAlign: 'right', font: `500 10.5px ${MONO}`, color: '#7a716a' }}>{v}</div>
    </div>) : <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>no data</div>}
  </div>
}
const pct = n => `${Math.round((n || 0) * 100)}%`

export default function WorkflowPanel({ snap }) {
  const w = snap.workflow || {}
  const gh = snap.github?.reviewFootprint
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[['one-shot rate', pct(w.oneShotRate)], ['interrupts / session', (w.interruptRate || 0).toFixed(1)], ['top friction', w.topFriction || '—']].map(([l, v]) =>
          <div key={l} style={{ ...PANEL, padding: '14px 18px', flex: 1, minWidth: 130 }}>
            <div style={{ font: `700 20px ${HEAD}`, color: '#e5dbd2' }}>{v}</div>
            <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{l}</div>
          </div>)}
      </div>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT }}>How I work with Claude</div>
        <Bars title="Friction (what slows me down)" obj={w.friction} color="#f2a2c4" />
        <Bars title="Session types" obj={w.sessionTypes} />
        <Bars title="Perceived helpfulness" obj={w.helpfulness} color="#5fd39a" />
        <Bars title="Tool mix" obj={w.tools} />
        {gh && <div style={{ font: `400 12px ${MONO}`, color: '#9a8f86', marginTop: 10 }}>Review footprint: {gh.prsReviewed} PRs reviewed · mentorship for {Object.keys(gh.reviewedForOthers || {}).length} teammates</div>}
        <Analyze panelKey="workflow" payload={{ oneShotRate: w.oneShotRate, interruptRate: w.interruptRate, topFriction: w.topFriction, friction: w.friction, helpfulness: w.helpfulness }} label="✨ Analyze — what to change" />
      </div>
    </div>
  )
}
