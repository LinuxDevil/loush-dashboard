import React from 'react'
import { PANEL, HEAD, MONO, BODY, ACCENT, MUTE, INK, GREEN, PURPLE, Tile, Ring, Badge, SectionTitle } from './theme.jsx'
import { useUsage, useEngSelf } from './data.jsx'

const BADGE_LABEL = {
  'first-design-doc': 'First Design Doc', 'mentor-5': 'Mentor ≥5', 'okr-closer': 'OKR Closer',
  'zero-regression-sprint': 'Zero-Regression Sprint', 'deep-work-champion': 'Deep-Work Champion',
  'ic-level-reached': 'IC Level Reached', 'course-graduate': 'Course Graduate', 'quest-streak': 'Quest Streak',
}

// outcomes-only XP (spec §3.2): no points for logging — only completed KR/OKR/goal/course/level/quest.
export default function GamePanel({ snap }) {
  const g = snap?.game || { xp: 0, level: 0, streaks: {}, badges: [], personalBests: {} }
  const pb = g.personalBests || {}
  const { data: usage } = useUsage()
  const { data: eng } = useEngSelf()
  const xpInLevel = (g.xp || 0) % 100 // ponytail: assume 100 XP / level for the ring fill

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div style={{ ...PANEL, display: 'flex', gap: 18, alignItems: 'center' }}>
          <Ring value={xpInLevel / 100} label={`L${g.level}`} sub={`${g.xp} XP`} color={ACCENT} size={68} />
          <div>
            <div style={{ font: `600 13px ${HEAD}`, color: INK }}>Level {g.level}</div>
            <div style={{ font: `400 11px ${BODY}`, color: MUTE, marginTop: 2 }}>outcomes only — no XP for logging</div>
          </div>
        </div>
        <Tile label="coding streak" value={`${g.streaks?.coding || usage?.streak || 0}🔥`} sub={`${usage?.activeDays ?? '—'} active days`} tone={GREEN} />
        <Tile label="learning streak" value={`${g.streaks?.learning || 0}d`} sub="courses & goals" tone={PURPLE} />
        {eng?.dora && <Tile label="shipped (90d)" value={eng.dora.throughput90} sub="tickets delivered" tone={ACCENT} />}
      </div>

      <div style={PANEL}>
        <SectionTitle>Badges</SectionTitle>
        {g.badges?.length
          ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{g.badges.map(b => <Badge key={b} tone="accent">{BADGE_LABEL[b] || b}</Badge>)}</div>
          : <div style={{ font: `400 12px ${BODY}`, color: MUTE }}>None yet — badges are earned by outcomes (ship a design doc, close an OKR, a zero-escaped sprint).</div>}
      </div>

      <div style={PANEL}>
        <SectionTitle>Personal bests</SectionTitle>
        <div style={{ font: `400 12px ${MONO}`, color: INK, display: 'grid', gap: 5 }}>
          <div>lowest escaped-bug ratio: <span style={{ color: eng?.dora ? GREEN : MUTE }}>{pb.lowestBugRatio ?? (eng?.dora ? `${Math.round(eng.dora.changeFailRate * 100)}% now` : '—')}</span></div>
          <div>longest streak: {pb.longestStreak ?? 0}d</div>
          <div>best flow week: {pb.bestFlowWeek ?? '—'}</div>
          <div>most KRs / quarter: {pb.mostKrsQuarter ?? '—'}</div>
        </div>
      </div>
    </div>
  )
}
