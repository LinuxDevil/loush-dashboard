import React from 'react'
import { PANEL, MONO, BODY, ACCENT, MUTE, INK, GREEN, PURPLE, RED, Tile, Heatmap, Bar, Badge, SectionTitle, Spinner, Updating } from './theme.jsx'
import { HeaderPills, WhereTimeGoes } from './charts.jsx'
import { useUsage, useEngSelf, timeAllocation } from './data.jsx'

const k = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n || 0)

const MiniBars = ({ title, obj, color = ACCENT }) => {
  const rows = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const max = Math.max(1, ...rows.map(r => r[1]))
  return (
    <div style={PANEL}>
      <SectionTitle>{title}</SectionTitle>
      {rows.length ? rows.map(([key, v]) => (
        <div key={key} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
          <div style={{ width: 120, font: `400 11px ${MONO}`, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{key}</div>
          <Bar v={v} max={max} color={color} />
          <div style={{ width: 40, textAlign: 'right', font: `500 11px ${MONO}`, color: MUTE }}>{v}</div>
        </div>
      )) : <div style={{ font: `400 11px ${MONO}`, color: MUTE }}>no data</div>}
    </div>
  )
}

export default function OverviewPage({ snap }) {
  const me = snap.me || {}, streak = snap.rollup?.streaks?.coding || snap.game?.streaks?.coding || 0
  const f = snap.flow || {}
  const top = (snap.focus || []).slice(0, 4)
  const { data: usage, revalidating: usageReval } = useUsage()
  const { data: eng, loading: engLoading, revalidating: engReval } = useEngSelf()

  const daily = usage?.daily || []
  const heat = daily.map(d => ({ date: d.date, v: (d.msgs || 0) + (d.tools || 0) }))
  const spark = daily.slice(-30).map(d => d.out || 0)
  const kpi = usage?.kpis || {}
  const d = eng?.dora
  const alloc = eng?.issues ? timeAllocation(eng.issues) : null

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* header pills */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <HeaderPills items={[
          d && [d.openNow, 'open tickets', ACCENT],
          d && [d.throughput90, 'shipped / 90d', GREEN],
          [`${streak}🔥`, 'streak', undefined],
          [(eng?.prs || []).length || '—', 'PRs', PURPLE],
        ]} />
        {engLoading && !d && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: `400 11px ${MONO}`, color: MUTE }}><Spinner size={11} /> loading JIRA…</span>}
        <Updating show={(engReval || usageReval) && !!d} />
      </div>

      {/* KPI grid — Claude activity + Eng delivery, with deltas */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {d && <Tile label="cycle time (median)" value={`${d.cycleMedian}d`} sub={`avg ${d.cycleAvg}d`} />}
        {d && <Tile label="est accuracy" value={`${d.estAcc}%`} sub="story-point vs actual" tone={GREEN} />}
        {d && <Tile label="change-fail" value={`${Math.round(d.changeFailRate * 100)}%`} sub={`${d.escapedBugs} escaped`} tone={d.changeFailRate > 0.15 ? RED : GREEN} />}
        <Tile label="lines (7d)" value={`+${k(kpi.lines7d?.add || 0)}`} sub={`−${k(kpi.lines7d?.del || 0)}`} tone={GREEN} />
        <Tile label="cost saved" value={`$${kpi.costSaved ?? 0}`} sub="prompt cache" tone={PURPLE} />
        <Tile label="sessions (30d)" value={kpi.sessions30 ?? me.sessionCount ?? '—'} sub="output" spark={spark} />
      </div>

      {/* activity heatmap */}
      {heat.length > 0 && (
        <div style={PANEL}>
          <SectionTitle right={<span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{usage?.activeDays ?? 0} active · {usage?.streak || 0}-day streak</span>}>Activity — last 18 weeks</SectionTitle>
          <Heatmap days={heat} />
        </div>
      )}

      {/* where time goes + focus */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {alloc ? <WhereTimeGoes {...alloc} /> : <MiniBars title="Session types" obj={f.sessionTypes} />}
        <div style={PANEL}>
          <SectionTitle>What to focus on</SectionTitle>
          {top.length ? top.map(x => (
            <div key={x.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 0', font: `400 12px ${BODY}`, color: INK }}>
              <Badge tone={x.severity === 'high' ? 'red' : x.severity === 'med' ? 'accent' : 'mute'}>{x.severity}</Badge>
              <span>{x.message}</span>
            </div>
          )) : <div style={{ font: `400 12px ${MONO}`, color: MUTE }}>nothing flagged — clean run</div>}
          <div style={{ display: 'flex', gap: 16, marginTop: 10, paddingTop: 10, borderTop: `1px solid #21262d` }}>
            <div><div style={{ font: `600 18px ${MONO}`, color: f.afterHoursPct > 0.35 ? PURPLE : INK }}>{Math.round((f.afterHoursPct || 0) * 100)}%</div><div style={{ font: `400 10.5px ${BODY}`, color: MUTE }}>after-hours</div></div>
            <div><div style={{ font: `600 18px ${MONO}`, color: f.wip > 4 ? PURPLE : INK }}>{f.wip || 0}</div><div style={{ font: `400 10.5px ${BODY}`, color: MUTE }}>WIP</div></div>
            {d && <div><div style={{ font: `600 18px ${MONO}`, color: INK }}>{d.reworkAvg}</div><div style={{ font: `400 10.5px ${BODY}`, color: MUTE }}>rework/ticket</div></div>}
          </div>
        </div>
      </div>

      {/* tool + model mix */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <MiniBars title="Tool mix" obj={snap.workflow?.tools} />
        <MiniBars title="Model mix" obj={Object.fromEntries(Object.entries(usage?.perModel || {}).map(([m, v]) => [m.replace(/^claude-|-\d.*$/g, ''), v.msgs]))} color={PURPLE} />
      </div>
    </div>
  )
}
