import React from 'react'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'
const pct = n => Math.round((n || 0) * 100) + '%'
export default function QualityPanel({ snap }) {
  const q = snap.quality || {}
  const best = snap.rollup?.personalBests?.lowestBugRatio
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ ...PANEL, flex: 1 }} title="Escaped defects only: bugs linked to my ticket-branches or blamed to my commits, ÷ my merged PRs. Review findings are NOT counted here.">
          <div style={{ font: `700 24px ${HEAD}` }}>{pct(q.changeFailProxy)}</div>
          <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>change-fail (escaped) · ⓘ</div>
        </div>
        <div style={{ ...PANEL, flex: 1 }} title="Findings caught in review on my diffs ÷ my merged PRs. A SEPARATE signal — trending down means my self-verification is improving. Never part of change-fail.">
          <div style={{ font: `700 24px ${HEAD}`, color: '#8ec8ff' }}>{pct(q.defectDensityCaughtInReview)}</div>
          <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>caught in review · ⓘ</div>
        </div>
        <div style={{ ...PANEL, flex: 1 }}><div style={{ font: `700 24px ${HEAD}`, color: ACCENT }}>{best == null ? '—' : pct(best)}</div><div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>personal best (lowest)</div></div>
      </div>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Attributed escaped bugs</div>
        {(q.attributed || []).length ? q.attributed.map(a => <div key={a.id} style={{ font: `400 12px ${MONO}`, padding: '3px 0' }}>• {a.id} <span style={{ color: '#7a716a' }}>({a.rule})</span></div>)
          : <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>none attributed this window</div>}
        {(q.unattributed || []).length ? <div style={{ font: `400 11px ${MONO}`, color: '#7a716a', marginTop: 8 }}>{q.unattributed.length} unattributed (not counted against you)</div> : null}
      </div>
    </div>
  )
}
