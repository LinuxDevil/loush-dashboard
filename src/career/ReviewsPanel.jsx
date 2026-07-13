import React from 'react'
import { PANEL, MONO, BODY, ACCENT, MUTE, INK, GREEN, PURPLE, RED, Tile, Badge, Bar, MiniTable, SectionTitle } from './theme.jsx'

// Team-health view of code review — reciprocity and bus factor, not a personal score.
export default function ReviewsPanel({ snap }) {
  const gh = snap.github
  if (!gh || !gh.reviewInsights) return (
    <div style={{ ...PANEL, color: MUTE, font: `400 12px ${MONO}` }}>
      No GitHub data. Run <b style={{ color: ACCENT }}>↻ refresh</b> after a GitHub import to populate review insights.
    </div>
  )
  const { reciprocity = [], busFactor = {}, reviewerStats = [], totals = {} } = gh.reviewInsights
  const ta = gh.reviewTurnaround || { n: 0 }
  const maxRecip = Math.max(1, ...reciprocity.map(p => Math.max(p.given, p.received)))

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Tile label="reviews given" value={totals.given || 0} sub="on others' PRs" tone={GREEN} />
        <Tile label="reviews received" value={totals.received || 0} sub="on my PRs" tone={ACCENT} />
        <Tile label="my review turnaround" value={ta.medianHrs == null ? '—' : `${ta.medianHrs}h`} sub={ta.n ? `median · p90 ${ta.p90Hrs}h · n=${ta.n}` : 'import to enable'} tone={PURPLE} />
        <Tile label="distinct reviewers" value={busFactor.distinctReviewers || 0} sub="who review my code" />
      </div>

      {/* Reciprocity — who I review for vs who reviews me */}
      <div style={PANEL}>
        <SectionTitle right={<span style={{ font: `400 11px ${MONO}`, color: MUTE }}>given ▓ · received ░</span>}>Review reciprocity</SectionTitle>
        {reciprocity.length ? reciprocity.slice(0, 12).map(p => (
          <div key={p.login} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr', gap: 10, alignItems: 'center', padding: '3px 0' }}>
            <span style={{ font: `500 12px ${MONO}`, color: INK, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.login}</span>
            <div title={`${p.given} given`}><Bar v={p.given} max={maxRecip} color={GREEN} /></div>
            <div title={`${p.received} received`}><Bar v={p.received} max={maxRecip} color={ACCENT} /></div>
          </div>
        )) : <div style={{ font: `400 12px ${MONO}`, color: MUTE }}>no review pairs yet</div>}
      </div>

      {/* Bus factor — concentration is a team risk, not a personal one */}
      <div style={PANEL}>
        <SectionTitle>Bus factor</SectionTitle>
        {busFactor.topReviewer ? (
          <div style={{ font: `400 12px ${BODY}`, color: INK, marginBottom: 8 }}>
            <b style={{ color: ACCENT }}>{busFactor.topReviewer.login}</b> reviews {Math.round(busFactor.topReviewer.share * 100)}% of my PRs.
            {busFactor.topReviewer.share > 0.6 ? <span style={{ color: RED }}> — concentrated; spread reviews to de-risk the team.</span> : <span style={{ color: MUTE }}> — healthy spread.</span>}
          </div>
        ) : null}
        {busFactor.soloReviewedAreas?.length ? (
          <div style={{ font: `400 11px ${MONO}`, color: PURPLE }}>
            ⚠ single-reviewer areas: {busFactor.soloReviewedAreas.slice(0, 6).map(a => `${a.area} (${a.only})`).join(' · ')}
          </div>
        ) : <div style={{ font: `400 11px ${MONO}`, color: MUTE }}>every reviewed area has ≥2 reviewers</div>}
      </div>

      {/* Reviewer footprint on my PRs */}
      {reviewerStats.length ? (
        <div style={PANEL}>
          <SectionTitle>Who reviews my code</SectionTitle>
          <MiniTable
            columns={[
              { key: 'login', label: 'reviewer', render: r => <span style={{ font: `500 12px ${MONO}`, color: INK }}>{r.login}</span> },
              { key: 'reviewedMyPrs', label: 'PRs reviewed', align: 'right', render: r => r.reviewedMyPrs },
              { key: 'approvals', label: 'approvals', align: 'right', render: r => r.approvals },
              { key: 'avgRounds', label: 'avg rounds', align: 'right', render: r => <Badge tone={r.avgRounds > 3 ? 'red' : 'mute'}>{r.avgRounds}</Badge> },
            ]}
            rows={reviewerStats} />
          <div style={{ font: `400 10.5px ${BODY}`, color: MUTE, marginTop: 6 }}>
            Team-health signal — avg rounds reflects PR complexity as much as any reviewer. Not a scorecard.
          </div>
        </div>
      ) : null}
    </div>
  )
}
