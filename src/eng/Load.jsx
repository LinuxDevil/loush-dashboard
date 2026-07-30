import React from 'react'
import { HEAD, BODY, MONO, BB, GREEN, GOLD, RED, DIM, HI, Card, CardHead, Empty, H1, Kpi, fx } from './ui.jsx'
import { Lines } from './charts.jsx'

const band = (v, watch, red) => (v == null ? DIM : v >= red ? RED : v >= watch ? GOLD : GREEN)

export default function Load({ snap }) {
  const L = snap.load || { weeks: [], minN: 5 }
  const weeks = L.weeks || []
  const shown = weeks.filter(w => !w.suppressed)
  const last = shown[shown.length - 1]
  const prev = shown[shown.length - 2]
  const trend = (k) => { const a = shown.slice(-3).map(w => w[k]).filter(v => v != null); return a.length > 1 && a[a.length - 1] > a[0] ? '↑ climbing' : '' }
  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker="team aggregate · 12 weeks" title="Load" right={<span style={{ font: `400 11px ${MONO}`, color: DIM }}>read-only by design</span>} />

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
      <Kpi label="Off-hours PRs" value={last?.offHoursPct == null ? '—' : fx(last.offHoursPct, 0) + '%'} color={band(last?.offHoursPct, 25, 40)}
        sub={`opened outside 10:00–18:00 Sun–Thu · ${trend('offHoursPct') || 'stable'}`} n={last?.contributors}
        delta={last?.offHoursPct != null && prev?.offHoursPct != null ? { txt: `${last.offHoursPct - prev.offHoursPct >= 0 ? '+' : ''}${fx(last.offHoursPct - prev.offHoursPct, 0)}pp`, good: last.offHoursPct <= prev.offHoursPct } : null} />
      <Kpi label="Weekend PRs" value={last?.weekendPct == null ? '—' : fx(last.weekendPct, 0) + '%'} color={band(last?.weekendPct, 10, 20)} sub="opened Fri/Sat" n={last?.contributors} />
      <Kpi label="WIP per engineer" value={L.wipPerEngineer == null ? '—' : fx(L.wipPerEngineer, 1)} color={band(L.wipPerEngineer, 2, 3)} sub={`in-flight tickets ÷ ${L.headcount} engineers`} n={L.headcount} />
    </div>

    <Card>
      <CardHead title="12-week trend" meta={`weekly buckets · cells below n=${L.minN} contributors are suppressed server-side`} />
      {!shown.length ? <Empty text={`Every week is below the n=${L.minN} contributor floor — nothing renders. That is the design, not a bug.`} /> :
        <Lines labels={weeks.map(w => w.week.slice(5))} yFmt={v => v + '%'} threshold={{ at: 40, label: 'intervene', color: RED }}
          series={[
            { label: 'off-hours %', color: GOLD, values: weeks.map(w => ({ y: w.offHoursPct, note: w.suppressed ? `suppressed (n=${w.contributors})` : `${w.prs} PRs` })) },
            { label: 'weekend %', color: RED, values: weeks.map(w => ({ y: w.weekendPct })) },
          ]} />}
      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ font: `400 11px ${BODY}`, color: GOLD }}>● PRs opened outside working hours</span>
        <span style={{ font: `400 11px ${BODY}`, color: RED }}>● PRs opened Fri/Sat</span>
        <span style={{ marginLeft: 'auto', font: `400 10px ${MONO}`, color: DIM }}>{weeks.filter(w => w.suppressed).length} of {weeks.length} weeks suppressed (n&lt;{L.minN})</span>
      </div>
    </Card>

    <Card style={{ borderColor: 'var(--green)' }}>
      <div style={{ font: `400 12px/1.7 ${BODY}`, color: 'var(--text-secondary)' }}>
        <b style={{ color: HI }}>Why there is no per-person column here.</b> {L.note} Sourced from PR open times run through the working-hours engine — never from transcripts, tokens or active hours.
        Below {L.minN} contributors in a week the cell is <b>null before it leaves the server</b>, so a per-engineer breakdown is not reconstructable from this payload, by construction.
        This card has no button on purpose: the earliest burnout signal available deserves a conversation, not a nudge.
      </div>
    </Card>
  </section>
}
