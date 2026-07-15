import React from 'react'
import { PANEL, MONO, BODY, ACCENT, MUTE, INK, GREEN, RED, Tile, Bar, SectionTitle } from './theme.jsx'
import { useEngSelf } from './data.jsx'

// Estimation calibration — SELF-VIEW ONLY. Always paired with sample size so a single
// off ticket never reads as a trend. estAcc = 100 means estimate == actual.
export default function EstimationPanel() {
  const { data: eng, loading } = useEngSelf()
  if (loading) return <div style={{ ...PANEL, color: MUTE, font: `400 12px ${MONO}` }}>Loading JIRA…</div>
  if (!eng?.accountId) return <div style={{ ...PANEL, color: MUTE, font: `400 12px ${MONO}` }}>JIRA identity unresolved — no estimation data.</div>

  const withEst = (eng.issues || []).filter(i => i.estAcc != null && i.closedAt && !i.isBug)
  // last 6 months, keyed by close month
  const now = new Date(), buckets = []
  for (let m = 5; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1)
    buckets.push({ y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleString('en', { month: 'short' }), accs: [], pts: [] })
  }
  for (const i of withEst) {
    const d = new Date(i.closedAt)
    const b = buckets.find(x => x.y === d.getFullYear() && x.m === d.getMonth())
    if (b) { b.accs.push(i.estAcc); if (i.pts) b.pts.push(i.pts) }
  }
  const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null
  const rows = buckets.map(b => ({ label: b.label, acc: avg(b.accs), n: b.accs.length, pts: b.pts.reduce((s, x) => s + x, 0) }))
  const overall = avg(withEst.map(i => i.estAcc))

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Tile label="estimate accuracy" value={overall == null ? '—' : `${Math.round(overall)}%`} sub={`${withEst.length} sized tickets`} tone={overall != null && overall < 60 ? RED : GREEN} />
        <Tile label="dora estAcc" value={eng.dora?.estAcc != null ? `${eng.dora.estAcc}%` : '—'} sub="all-time avg" />
      </div>

      <div style={PANEL}>
        <SectionTitle right={<span style={{ font: `400 11px ${MONO}`, color: MUTE }}>higher = better sized</span>}>Calibration trend — last 6 months</SectionTitle>
        {rows.map(r => (
          <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '48px 1fr 120px', gap: 10, alignItems: 'center', padding: '4px 0' }}>
            <span style={{ font: `500 12px ${MONO}`, color: MUTE }}>{r.label}</span>
            {r.n ? <Bar v={Math.min(100, r.acc)} max={100} color={r.acc < 60 ? RED : ACCENT} h={8} />
              : <div style={{ font: `400 11px ${MONO}`, color: MUTE }}>—</div>}
            <span style={{ font: `400 11px ${MONO}`, color: INK, textAlign: 'right' }}>
              {r.n ? `${Math.round(r.acc)}% · ${r.n} tkt${r.pts ? ` · ${r.pts}pt` : ''}` : 'no data'}
            </span>
          </div>
        ))}
        <div style={{ font: `400 10.5px ${BODY}`, color: MUTE, marginTop: 8 }}>
          Private to you. Read months with ≥3 tickets as signal; a single ticket is noise, not a trend.
        </div>
      </div>
    </div>
  )
}
