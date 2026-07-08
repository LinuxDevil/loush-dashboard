import React, { useState } from 'react'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'
const Hist = ({ title, obj }) => {
  const rows = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const max = Math.max(1, ...rows.map(r => r[1]))
  return <div><div style={{ font: `600 11px ${MONO}`, color: '#7a716a', margin: '8px 0 4px' }}>{title}</div>
    {rows.map(([k, v]) => <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
      <div style={{ width: 130, font: `400 10.5px ${MONO}`, color: '#cbb' }}>{k}</div>
      <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}><div style={{ width: `${v / max * 100}%`, height: '100%', background: ACCENT, borderRadius: 3 }} /></div>
      <div style={{ width: 30, textAlign: 'right', font: `500 10.5px ${MONO}`, color: '#7a716a' }}>{v}</div>
    </div>)}</div>
}
export default function InsightsProjectPanel({ snap }) {
  const projects = snap.projects || []
  const [sel, setSel] = useState('')
  const p = sel ? projects.find(x => x.path === sel) : null
  const nar = snap.insights?.narrative || {}
  const narEmpty = nar.error || (!nar.wins?.length && !nar.atAGlance?.working)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={PANEL}>
        <select value={sel} onChange={e => setSel(e.target.value)} style={{ font: `500 12px ${MONO}`, background: '#1c1815', color: '#e5dbd2', border: '1px solid #7a716a55', borderRadius: 8, padding: '6px 10px' }}>
          <option value="">All projects ({projects.length})</option>
          {projects.map(x => <option key={x.path} value={x.path}>{x.path} · {x.sessions} sessions</option>)}
        </select>
        {p ? <div><Hist title="Outcomes" obj={p.outcomes} /><Hist title="Friction" obj={p.friction} /><Hist title="Languages" obj={p.languages} /><Hist title="Tools" obj={p.tools} /></div>
          : <div style={{ font: `400 12px ${MONO}`, color: '#7a716a', marginTop: 8 }}>Pick a project to see its /insights breakdown.</div>}
      </div>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>/insights narrative</div>
        {narEmpty ? <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>No parsed narrative — run <code>/insights</code> in Claude Code, then ↻ refresh.</div>
          : <div style={{ display: 'grid', gap: 8 }}>
            {nar.atAGlance?.working && <div style={{ font: `400 12px ${MONO}`, color: '#5fd39a' }}><b>Working:</b> {nar.atAGlance.working}</div>}
            {nar.atAGlance?.hindering && <div style={{ font: `400 12px ${MONO}`, color: '#f2a2c4' }}><b>Hindering:</b> {nar.atAGlance.hindering}</div>}
            {(nar.wins || []).slice(0, 3).map((w, i) => <div key={i} style={{ font: `400 12px ${MONO}` }}>🏆 {w.title}</div>)}
          </div>}
      </div>
    </div>
  )
}
