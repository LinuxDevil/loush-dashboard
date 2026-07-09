import React from 'react'
import { PANEL, HEAD, MONO, ACCENT, Stat } from './theme.jsx'

const BADGE_LABEL = {
  'first-design-doc': 'First Design Doc', 'mentor-5': 'Mentor ≥5', 'okr-closer': 'OKR Closer',
  'zero-regression-sprint': 'Zero-Regression Sprint', 'deep-work-champion': 'Deep-Work Champion',
  'ic-level-reached': 'IC Level Reached', 'course-graduate': 'Course Graduate', 'quest-streak': 'Quest Streak',
}

// outcomes-only XP (spec §3.2): no points for logging — only completed KR/OKR/goal/course/level/quest.
export default function GamePanel({ snap }) {
  const g = snap?.game || { xp: 0, level: 0, streaks: {}, badges: [], personalBests: {} }
  const pb = g.personalBests || {}
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Stat label="level (outcomes only)" val={g.level} />
        <Stat label="total XP" val={g.xp} />
        <Stat label="coding streak" val={`${g.streaks?.coding || 0}d`} />
        <Stat label="learning streak" val={`${g.streaks?.learning || 0}d`} />
      </div>

      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Badges</div>
        {g.badges?.length
          ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{g.badges.map(b =>
              <span key={b} style={{ font: `600 11px ${MONO}`, color: '#0d0b0a', background: ACCENT, borderRadius: 6, padding: '4px 10px' }}>{BADGE_LABEL[b] || b}</span>)}</div>
          : <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>None yet — badges are earned by outcomes (ship a design doc, close an OKR, a zero-escaped sprint).</div>}
      </div>

      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Personal bests</div>
        <div style={{ font: `400 12px ${MONO}`, color: '#9a8f86', display: 'grid', gap: 4 }}>
          <div>lowest escaped-bug ratio: {pb.lowestBugRatio ?? '—'}</div>
          <div>longest streak: {pb.longestStreak ?? 0}d</div>
          <div>best flow week: {pb.bestFlowWeek ?? '—'}</div>
          <div>most KRs / quarter: {pb.mostKrsQuarter ?? '—'}</div>
        </div>
      </div>
    </div>
  )
}
