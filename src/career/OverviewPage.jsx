import React from 'react'
import { PANEL, HEAD, MONO, BODY, ACCENT, MUTE, INK, GREEN, PURPLE, RED, LINE, Tile, Badge, SectionTitle, Spinner, Updating } from './theme.jsx'
import { HeaderPills, WhereTimeGoes, Card, Cmp, Empty, Headline, Btn } from './charts.jsx'
import { useUsage, useEngSelf, useApi, timeAllocation, copy } from './data.jsx'

// Overview — what needs a decision today, and whether the last period's intervention worked.
//
// DELETED here, deliberately, and not behind a flag:
//   · the GameStrip hero (XP is a proxy for a proxy; a level is a leaderboard waiting to happen)
//   · the 18-week activity heatmap and the after-hours % tile (the most weaponizable numbers in the app)
//   · "cost saved (cache)" — an estimate × an estimate against a counterfactual that never happened.
//     Replaced by REAL USD from /api/career/run-economics.
//   · "AI code share" — aiCommits ÷ prCommits is a ratio of two unjoined sets. Replaced by the real
//     session↔ticket join (Harness → ticket economics).
//   · "running now" / "tool calls today" — real-time who-is-typing has zero decision value.
//
// Every tile that CAN carry a prior-period comparison now does: a single-period number cannot tell
// anyone whether anything worked.
export default function OverviewPage({ snap, onGoto }) {
  const { data: usage, revalidating: usageReval } = useUsage()
  const { data: eng, loading: engLoading, revalidating: engReval } = useEngSelf()
  const roi = useApi('/api/career/harness-roi')
  const econ = useApi('/api/career/run-economics?days=30')
  const board = useApi('/api/team/board')
  const review = useApi('/api/team/review-flow')
  const ci = useApi('/api/team/ci?days=30')

  const prior = snap.prior || null
  const d = eng?.dora, pd = eng?.priorDora
  const alloc = eng?.issues ? timeAllocation(eng.issues) : null
  const top = (snap.focus || []).slice(0, 4)
  const spend = econ.data?.spend?.total
  const teamRows = board.data?.rows || []
  const atRisk = teamRows.reduce((a, r) => a + r.atRisk, 0)
  const queue = review.data?.queue?.length ?? null
  const redCi = ci.data?.anyRed

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* ATTENTION — the only thing a landing page owes you */}
      <Card title="Needs a human today" sub={`comparing ${snap.period || 'this period'} against ${prior?.period || 'the prior period'}`}
        json={{ atRisk, queue, redCi }}>
        {/* Never claim "green" while the answer is still in flight — a loading state that renders as a
            clean bill of health is the most dishonest thing a dashboard can do. */}
        <div style={{ display: 'grid', gap: 6 }}>
          {ci.data ? <Line tone={redCi ? RED : GREEN} on={onGoto} to="Team">{redCi ? 'A default branch is RED — that blocks everyone.' : 'CI: every default branch is green.'}</Line> : <Pending>CI status…</Pending>}
          {review.data ? <Line tone={queue ? RED : GREEN} on={onGoto} to="Team">{queue ? `${queue} PRs are past the review SLA with nobody on them.` : 'Review queue: nothing is past the SLA.'}</Line> : <Pending>Review queue…</Pending>}
          {board.data ? <Line tone={atRisk ? RED : GREEN} on={onGoto} to="Team">{atRisk ? `${atRisk} tickets are at risk across ${teamRows.length} engineers.` : 'No ticket is flagged at risk.'}</Line> : <Pending>Team board…</Pending>}
          {roi.data?.dead ? <Line tone={PURPLE} on={onGoto} to="Harness">{roi.data.headline}</Line> : null}
          {econ.data?.worst ? <Line tone={PURPLE} on={onGoto} to="Harness">{econ.data.worst}</Line> : null}
        </div>
      </Card>

      {/* header pills */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <HeaderPills items={[
          d && [d.openNow, 'my open tickets', ACCENT],
          d && [d.throughput90, 'shipped / 90d', GREEN],
          [(eng?.prs || []).length || '—', 'my PRs', PURPLE],
          [teamRows.length || '—', 'engineers on the board', INK],
        ]} />
        {engLoading && !d && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: `400 11px ${MONO}`, color: MUTE }}><Spinner size={11} /> loading JIRA…</span>}
        <Updating show={(engReval || usageReval) && !!d} />
      </div>

      {/* MY DELIVERY — every tile carries its prior period */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {d && <TileCmp label="cycle time (median)" value={`${d.cycleMedian}d`} cur={d.cycleMedian} prev={pd?.cycleMedian} unit="d" dir="down" sub={`avg ${d.cycleAvg}d`} />}
        {d && <TileCmp label="shipped (90d)" value={d.throughput90} cur={d.throughput90} prev={pd?.throughput90} sub="tickets live" tone={GREEN} />}
        {d && <TileCmp label="change-fail" value={`${Math.round(d.changeFailRate * 100)}%`} cur={Math.round(d.changeFailRate * 100)} prev={pd ? Math.round(pd.changeFailRate * 100) : null} unit="%" dir="down" sub={`${d.escapedBugs} escaped`} tone={d.changeFailRate > 0.15 ? RED : GREEN} />}
        {d && <TileCmp label="est accuracy" value={`${d.estAcc}%`} cur={d.estAcc} prev={pd?.estAcc} unit="%" sub="story points vs actual" />}
        {d && <TileCmp label="PR merge time" value={`${d.prMergeDays}d`} cur={d.prMergeDays} prev={pd?.prMergeDays} unit="d" dir="down" sub={`${d.prReviewRounds} review rounds`} />}
        {/* REAL spend — this replaces the "cost saved" tile */}
        <Tile label="Claude spend (30d)" value={spend == null ? '—' : `$${spend >= 1000 ? (spend / 1000).toFixed(1) + 'k' : spend.toFixed(0)}`} sub="real USD, this laptop" tone={PURPLE} />
      </div>

      {/* HARNESS + PERIOD COMPARISON on the career snapshot's own numbers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {alloc ? <WhereTimeGoes {...alloc} /> : <Card title="Where time goes"><Empty>No JIRA issues in this window.</Empty></Card>}
        <Card title="What to focus on" sub={prior ? `vs ${prior.period}` : null} json={snap.focus}>
          {top.length ? top.map(x => (
            <div key={x.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 0', font: `400 12px ${BODY}`, color: INK }}>
              <Badge tone={x.severity === 'high' ? 'red' : x.severity === 'med' ? 'accent' : 'mute'}>{x.severity}</Badge>
              <span>{x.message}</span>
            </div>
          )) : <Empty>Nothing flagged — clean run.</Empty>}
          <div style={{ display: 'flex', gap: 20, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${LINE}`, flexWrap: 'wrap' }}>
            <Mini label="interrupt rate" cur={pct1(snap.workflow?.interruptRate)} prev={pct1(prior?.workflow?.interruptRate)} dir="down" />
            <Mini label="sessions" cur={snap.me?.sessionCount} prev={prior?.me?.sessionCount} />
            {d && <Mini label="rework / ticket" cur={d.reworkAvg} prev={pd?.reworkAvg} dir="down" />}
          </div>
        </Card>
      </div>
    </div>
  )
}

const pct1 = v => v == null ? null : +(v * 100).toFixed(0)

const Pending = ({ children }) => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', font: `400 13px ${BODY}`, color: MUTE }}>
    <Spinner size={11} />{children}
  </div>
)

const Line = ({ children, tone, on, to }) => (
  <div onClick={() => on?.(to)} style={{ display: 'flex', gap: 8, alignItems: 'baseline', font: `400 13px ${BODY}`, color: INK, cursor: on ? 'pointer' : 'default' }}>
    <span style={{ color: tone }}>●</span>{children}
    {on ? <span style={{ font: `500 11px ${MONO}`, color: MUTE }}>→ {to}</span> : null}
  </div>
)

// A Tile that always shows the prior period beside it.
function TileCmp({ label, value, sub, cur, prev, unit = '', dir = 'up', tone }) {
  return (
    <div style={{ ...PANEL, padding: '13px 16px', flex: 1, minWidth: 156, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ font: `500 10.5px ${BODY}`, color: MUTE, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ font: `600 23px ${MONO}`, color: tone || INK, letterSpacing: '-0.5px' }}>{value ?? '—'}</span>
        <Cmp cur={cur} prev={prev} unit={unit} dir={dir} />
      </div>
      {sub && <div style={{ font: `400 11px ${BODY}`, color: MUTE }}>{sub}</div>}
      {prev == null && <div style={{ font: `400 10px ${MONO}`, color: MUTE }}>no prior period</div>}
    </div>
  )
}
const Mini = ({ label, cur, prev, dir }) => (
  <div>
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
      <span style={{ font: `600 17px ${MONO}`, color: INK }}>{cur ?? '—'}</span>
      <Cmp cur={cur} prev={prev} dir={dir} />
    </div>
    <div style={{ font: `400 10.5px ${BODY}`, color: MUTE }}>{label}</div>
  </div>
)
