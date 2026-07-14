import React, { useState } from 'react'
import { MONO, BODY, ACCENT, MUTE, INK, GREEN, RED, PURPLE, LINE, Badge, Tile, LoadingPanel } from './theme.jsx'
import { Card, Btn, Nudge, Empty, Headline, HBars } from './charts.jsx'
import { useApi, copy } from './data.jsx'

// item 5 — the funnel including the QUEUE half. If lead time is 42d and cycle time is 0.3d, no amount of
// AI coding speed matters: the work is sitting in a status waiting for a human decision.
export default function FlowBottleneck() {
  const { data, loading, error } = useApi('/api/team/funnel?days=90')
  const [stage, setStage] = useState(null)

  if (loading && !data) return <LoadingPanel label="Replaying 90 days of status changelogs…" tiles={3} />
  if (error || data?.available === false) return <Card title="Stage funnel"><Empty tone={RED}>Funnel unavailable — {error || data?.error}</Empty></Card>

  const { stages = [], radar = [], blockers = [], leadTime = {}, cycleTime = {}, queueWait = {}, n, linksAvailable } = data || {}
  const maxP90 = Math.max(1, ...stages.map(s => s.p90 || 0))
  const shown = stage ? radar.filter(r => r.status === stage) : radar

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card title="Idea → prod — where the time actually goes"
        sub={`p50 / p90 working days per stage · ${n} tickets shipped in the last 90 days`} json={data}>
        <Headline tone={queueWait.p50 > cycleTime.p50 ? RED : INK}>
          Lead time p50 <b>{leadTime.p50}d</b> (p90 {leadTime.p90}d) vs cycle time p50 <b>{cycleTime.p50}d</b>.
          {' '}<span style={{ color: RED }}>{queueWait.p50}d of the median ticket is time it sat waiting on us</span>, not time anyone spent on it.
        </Headline>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '14px 0' }}>
          <Tile label="lead time (created → live)" value={`${leadTime.p50}d`} sub={`p90 ${leadTime.p90}d`} />
          <Tile label="cycle time (active)" value={`${cycleTime.p50}d`} sub={`p90 ${cycleTime.p90}d`} tone={GREEN} />
          <Tile label="queue wait" value={`${queueWait.p50}d`} sub={`p90 ${queueWait.p90}d`} tone={RED} />
        </div>
        <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
          {stages.map(s => (
            <div key={s.stage} onClick={() => setStage(stage === s.stage ? null : s.stage)}
              style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 7, cursor: 'pointer', opacity: stage && stage !== s.stage ? 0.45 : 1 }}>
              <div style={{ width: 150, font: `400 11px ${MONO}`, color: stage === s.stage ? ACCENT : INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.stage}</div>
              <div style={{ flex: 1, position: 'relative', height: 12, background: LINE, borderRadius: 999 }}>
                <div title={`p90 ${s.p90}d`} style={{ position: 'absolute', inset: 0, width: `${(s.p90 / maxP90) * 100}%`, background: '#e3b34155', borderRadius: 999 }} />
                <div title={`p50 ${s.p50}d`} style={{ position: 'absolute', inset: 0, width: `${(s.p50 / maxP90) * 100}%`, background: ACCENT, borderRadius: 999 }} />
              </div>
              <div style={{ width: 130, textAlign: 'right', font: `500 11px ${MONO}`, color: MUTE }}>p50 {s.p50}d · p90 {s.p90}d</div>
              <div style={{ width: 74, textAlign: 'right', font: `500 11px ${MONO}`, color: s.depth > 20 ? RED : MUTE }}>{s.depth} deep</div>
            </div>
          ))}
          <div style={{ font: `400 10.5px ${BODY}`, color: MUTE, marginTop: 8 }}>
            <span style={{ color: ACCENT }}>▬</span> p50 · <span style={{ color: '#e3b341' }}>▬</span> p90 · "deep" = tickets sitting in that status right now. Click a stage to filter the radar below.
          </div>
        </div>
      </Card>

      {/* RADAR — parked longer than the team's own p75 for THAT status */}
      <Card title={`Wait radar — parked past the team's own p75${stage ? ` · ${stage}` : ''}`}
        sub={`${shown.length} tickets sitting longer than this team historically takes in that status`}
        json={radar}
        right={stage ? <Btn tone={MUTE} onClick={() => setStage(null)}>clear filter</Btn> : null}>
        {!shown.length ? <Empty>Nothing is parked past its stage p75.</Empty> : shown.slice(0, 40).map(r => (
          <div key={r.key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderTop: `1px solid ${LINE}` }}>
            <a href={r.url} target="_blank" rel="noreferrer" style={{ font: `600 11.5px ${MONO}`, color: ACCENT, textDecoration: 'none', width: 92 }}>{r.key}</a>
            <Badge tone="purple">{r.status}</Badge>
            <span style={{ font: `500 11px ${MONO}`, color: RED }}>{Math.round(r.inCurrent)}d</span>
            <span style={{ font: `400 11px ${MONO}`, color: MUTE }}>p75 {r.p75}d · {Math.round(r.over)}d over</span>
            <span style={{ flex: 1, minWidth: 180, font: `400 12px ${BODY}`, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.summary}</span>
            <span style={{ font: `400 11px ${MONO}`, color: MUTE }}>waiting on <b style={{ color: INK }}>{r.waitingOn}</b></span>
            <Nudge text={r.nudge} />
          </div>
        ))}
      </Card>

      {/* Cross-team blockers */}
      <Card title="Cross-team blockers" sub="tickets blocked by a ticket owned by another project key" json={blockers}>
        {!linksAvailable ? <Empty>JIRA issue links are not in this snapshot — the blocker matrix cannot be computed. Not zero: unknown.</Empty>
          : !blockers.length ? <Empty>Nothing is blocked across a team boundary right now.</Empty>
          : blockers.map(b => (
            <div key={`${b.blocked}-${b.blocking}`} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '7px 0', borderTop: `1px solid ${LINE}` }}>
              <span style={{ font: `600 12px ${MONO}`, color: INK }}>{b.blocked} <span style={{ color: RED }}>←</span> {b.blocking}</span>
              <span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{b.tickets.length} ticket(s) · {Math.round(b.days)} working days burned</span>
              <span style={{ flex: 1, minWidth: 140, font: `400 11px ${MONO}`, color: MUTE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.tickets.join(', ')}</span>
              <Btn onClick={() => copy(b.escalation, 'escalation copied — paste it in the cross-team channel')}>⧉ copy escalation</Btn>
            </div>
          ))}
      </Card>
    </div>
  )
}
