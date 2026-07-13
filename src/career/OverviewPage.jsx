import React from 'react'
import { PANEL, HEAD, MONO, BODY, ACCENT, MUTE, INK, GREEN, PURPLE, RED, Tile, Ring, Heatmap, Bar, Badge, SectionTitle, Spinner, Updating } from './theme.jsx'
import { HeaderPills, WhereTimeGoes } from './charts.jsx'
import { useUsage, useEngSelf, timeAllocation } from './data.jsx'
import { levelBand } from '../../career-gamify.mjs'

const k = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n || 0)

// Compact gamification hero for the Overview main screen — clicks through to the full Game tab.
function GameStrip({ game = {}, onOpenGame }) {
  const { level, bandLo, bandHi, toNext } = levelBand(game.xp || 0)
  const ringVal = bandHi > bandLo ? Math.min(1, Math.max(0, ((game.xp || 0) - bandLo) / (bandHi - bandLo))) : 0
  const openQuests = (game.quests || []).filter(q => !q.done).length
  return (
    <div onClick={onOpenGame} title="Open the Game tab"
      style={{ ...PANEL, display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', cursor: onOpenGame ? 'pointer' : 'default' }}>
      <Ring value={ringVal} label={`L${level}`} sub={`${game.xp || 0} XP`} color={ACCENT} size={60} />
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ font: `600 14px ${HEAD}`, color: INK }}>Level {level}</div>
        <div style={{ font: `400 11px ${MONO}`, color: MUTE, marginTop: 2 }}>{toNext} XP to L{level + 1} · outcomes only</div>
      </div>
      <StripStat icon="🔥" v={`${game.streaks?.coding || 0}d`} label="coding streak" tone={GREEN} />
      <StripStat icon="📚" v={`${game.streaks?.learning || 0}d`} label="learning" tone={PURPLE} />
      <StripStat icon="🏅" v={game.badges?.length || 0} label="badges" tone={ACCENT} />
      {openQuests ? <StripStat icon="🎯" v={openQuests} label="open quests" tone={INK} /> : null}
      {onOpenGame ? <span style={{ font: `600 11px ${MONO}`, color: ACCENT }}>♜ Game →</span> : null}
    </div>
  )
}
const StripStat = ({ icon, v, label, tone }) => (
  <div style={{ textAlign: 'center' }}>
    <div style={{ font: `700 15px ${HEAD}`, color: tone || INK }}>{icon} {v}</div>
    <div style={{ font: `400 9px ${MONO}`, color: MUTE }}>{label}</div>
  </div>
)

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

export default function OverviewPage({ snap, onOpenGame }) {
  const me = snap.me || {}, streak = snap.rollup?.streaks?.coding || snap.game?.streaks?.coding || 0
  const f = snap.flow || {}
  const top = (snap.focus || []).slice(0, 4)
  const { data: usage, revalidating: usageReval } = useUsage()
  const { data: eng, loading: engLoading, revalidating: engReval } = useEngSelf()

  const daily = usage?.daily || []
  const heat = daily.map(d => ({ date: d.date, v: (d.msgs || 0) + (d.tools || 0) }))
  const spark = daily.slice(-30).map(d => d.out || 0)
  const kpi = usage?.kpis || {}
  const ai = snap.ai || {}, impact = snap.impact || { movedCount: 0, linkedCount: 0 }, hist = snap.rollup?.history || []
  const meet = snap.meetings, dom = snap.domain
  const d = eng?.dora
  const alloc = eng?.issues ? timeAllocation(eng.issues) : null

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* gamification hero */}
      <GameStrip game={snap.game} onOpenGame={onOpenGame} />

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
        {/* G1 AI-code-share — commits via a Claude session ÷ PR commits; sub folds in Cursor's real line counts. */}
        <Tile label="AI code share" value={ai.codeShare == null ? '—' : `${Math.round(ai.codeShare * 100)}%`}
          sub={ai.codeShare == null ? 'import GitHub' : `${ai.aiCommits}/${ai.prCommits} commits${ai.cursorLines ? ` · +${k(ai.cursorLines)} cursor` : ''}`} tone={PURPLE} />
        {/* G5 meetings — decision vs status split (imported calendar) */}
        {meet && <Tile label="meetings" value={`${meet.hours}h`} sub={`${meet.decisionCount} decision · ${meet.droveDecisions} drove`} />}
        {/* G4 domain — code areas you own + keystone (bus-factor) count */}
        {dom && <Tile label="domains owned" value={dom.areas?.length || 0} sub={`${dom.keystones?.length || 0} keystone`} tone={GREEN} />}
        {/* G2 business-impact — KPIs moved / linked to shipped work */}
        <Tile label="business impact" value={`${impact.movedCount}/${impact.linkedCount}`} sub="KPIs moved / linked"
          tone={impact.movedCount > 0 ? GREEN : undefined} />
        {/* ★ growth curve — weekly XP trend from the persisted time-series */}
        {hist.length > 1 && <Tile label="growth (xp)" value={hist[hist.length - 1].xp} sub={`${hist.length}-week trend`} spark={hist.map(h => h.xp)} />}
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
