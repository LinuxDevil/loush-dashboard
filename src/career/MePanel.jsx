import React from 'react'
import { PANEL, HEAD, MONO, BODY, ACCENT, MUTE, INK, GREEN, PURPLE, Tile, Heatmap, Sparkline, SectionTitle, Badge } from './theme.jsx'
import { useUsage, useEngSelf } from './data.jsx'

const k = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n || 0)

export default function MePanel({ snap }) {
  const me = snap.me || {}, streak = snap.rollup?.streaks?.coding || snap.game?.streaks?.coding || 0
  const top = (snap.focus || []).slice(0, 3)
  const { data: usage } = useUsage()
  const { data: eng } = useEngSelf()

  const daily = usage?.daily || []
  const heat = daily.map(d => ({ date: d.date, v: (d.msgs || 0) + (d.tools || 0) }))
  const spark = daily.slice(-30).map(d => d.out || 0)
  const kpi = usage?.kpis || {}

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* headline tiles */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Tile label="running now" value={me.runningNow?.length || 0} sub={me.runningNow?.[0]?.project?.split('-').pop() || 'idle'} />
        <Tile label="coding streak" value={`${streak}🔥`} sub={`${usage?.activeDays ?? '—'} active days`} tone={GREEN} />
        <Tile label="sessions (window)" value={me.sessionCount || 0} sub={`${kpi.sessions30 ?? '—'} in last 30d`} />
        {eng?.dora && <Tile label="open tickets" value={eng.dora.openNow} sub={`${eng.dora.throughput90} shipped / 90d`} tone={ACCENT} />}
      </div>

      {/* claude activity KPIs + sparkline */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Tile label="lines (7d)" value={`+${k(kpi.lines7d?.add || 0)}`} sub={`−${k(kpi.lines7d?.del || 0)} removed`} tone={GREEN} />
        <Tile label="tool calls today" value={kpi.toolCallsToday || 0} sub={`${k(kpi.toolCallsTotal || 0)} all-time`} />
        <Tile label="cost saved (cache)" value={`$${kpi.costSaved ?? 0}`} sub={`${k(kpi.cacheReadTok || 0)} cached tok`} tone={PURPLE} />
        <Tile label="output tokens (30d)" value={k(daily.slice(-30).reduce((s, d) => s + (d.out || 0), 0))} sub="rolling" spark={spark} />
      </div>

      {/* activity heatmap */}
      {heat.length > 0 && (
        <div style={PANEL}>
          <SectionTitle right={<span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{usage?.streak || 0}-day streak</span>}>Activity — last 18 weeks</SectionTitle>
          <Heatmap days={heat} />
        </div>
      )}

      {/* focus */}
      <div style={PANEL}>
        <SectionTitle>What to focus on</SectionTitle>
        {top.length ? top.map(f => (
          <div key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0', font: `400 12px ${BODY}`, color: INK }}>
            <Badge tone={f.severity === 'high' ? 'red' : f.severity === 'med' ? 'accent' : 'mute'}>{f.severity}</Badge>
            <span>{f.message}</span>
          </div>
        )) : <div style={{ font: `400 12px ${MONO}`, color: MUTE }}>nothing flagged — clean run</div>}
      </div>
    </div>
  )
}
