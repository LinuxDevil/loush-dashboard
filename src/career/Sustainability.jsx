import React from 'react'
import { MONO, BODY, ACCENT, MUTE, INK, GREEN, RED, PURPLE, LINE, Badge, LoadingPanel } from './theme.jsx'
import { Card, Btn, Empty, Headline } from './charts.jsx'
import { useApi, copy } from './data.jsx'

// item 15 — sustainability early-warning. TEAM-AGGREGATE ONLY.
//
// This component renders NO per-person row, NO drilldown, and NO count of people — not even when the
// payload happens to carry one. The min-N floor lives in the endpoint (server-team.mjs), not here; when
// it suppresses, we say SO, plainly. A suppressed cell is never rendered as a zero, because a zero is a
// claim about the team and "we do not have enough people to say" is not.
//
// Deliberately no "{ }" copy-raw button: the raw payload carries a contributor count, and this panel's
// whole contract is that a headcount is never disclosed here.
export default function Sustainability() {
  const { data, loading, error } = useApi('/api/team/sustainability')

  if (loading && !data) return <LoadingPanel label="Bucketing PR timestamps by week…" tiles={2} />
  if (error || data?.available === false && data?.error) return <Card title="Sustainability"><Empty tone={RED}>Unavailable — {error || data?.error}</Empty></Card>

  // ── the suppression state. This is the contract working, not a bug. ──
  if (data?.suppressed || data?.available === false) {
    return (
      <Card title="Sustainability — team signal" tone={PURPLE}>
        <Headline tone={PURPLE} icon="🔒">Suppressed — this team is below the minimum of {data.minN} contributing engineers.</Headline>
        <div style={{ font: `400 12.5px ${BODY}`, color: MUTE, marginTop: 10, lineHeight: 1.6 }}>
          {data.reason}
          <br /><br />
          Below the floor, any weekly share would be traceable to individuals — so the endpoint returns nothing rather than
          something that could be pointed at a person. <b style={{ color: INK }}>This is not a zero, and it is not an error.</b> It
          is the guarantee holding: there is no per-person view here and no drilldown, and the endpoint physically cannot produce one.
        </div>
      </Card>
    )
  }

  const { weeks = [], teamWipMedian, firing, opener, note } = data || {}
  const live = weeks.filter(w => !w.suppressed)
  const maxShare = Math.max(0.3, ...live.map(w => w.outsideHoursShare || 0))

  return (
    <Card title="Sustainability — team signal" tone={firing ? RED : undefined}>
      <Headline tone={firing ? RED : GREEN} icon={firing ? '⚠' : '✓'}>
        {firing
          ? 'Signal is firing: an unusual share of PRs is landing outside working hours, two weeks running, while WIP sits above 4.'
          : 'No sustained off-hours signal. Team WIP median ' + (teamWipMedian ?? '—') + '.'}
      </Headline>
      {opener && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 12, padding: '10px 12px', background: '#f851491a', border: `1px solid #f8514933`, borderRadius: 8 }}>
          <div style={{ flex: 1, font: `400 12.5px ${BODY}`, color: INK, lineHeight: 1.5 }}>{opener}</div>
          <Btn onClick={() => copy(opener, '1:1 opener copied')}>⧉ copy the opener</Btn>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 110, marginTop: 18 }}>
        {weeks.map(w => (
          <div key={w.week} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
            {w.suppressed ? (
              <div title={`${w.week}: suppressed — below the min-N floor`}
                style={{ width: '100%', height: 8, borderRadius: 2, background: `repeating-linear-gradient(45deg, ${LINE}, ${LINE} 3px, transparent 3px, transparent 6px)` }} />
            ) : (
              <div title={`${w.week}: ${Math.round(w.outsideHoursShare * 100)}% outside hours · ${Math.round(w.weekendShare * 100)}% weekend`}
                style={{ width: '100%', height: `${Math.max(3, (w.outsideHoursShare / maxShare) * 100)}%`, background: w.outsideHoursShare > 0.25 ? RED : ACCENT, borderRadius: '3px 3px 0 0' }} />
            )}
            <span style={{ font: `400 8.5px ${MONO}`, color: MUTE, whiteSpace: 'nowrap' }}>{w.week.slice(-3)}</span>
          </div>
        ))}
      </div>
      <div style={{ font: `400 10.5px ${BODY}`, color: MUTE, marginTop: 10, lineHeight: 1.6 }}>
        Share of PR events landing outside 08:00–19:00. <span style={{ color: MUTE }}>Hatched weeks are suppressed — below the min-N floor, so nothing is claimed about them.</span>
        <br />{note}
      </div>
    </Card>
  )
}
