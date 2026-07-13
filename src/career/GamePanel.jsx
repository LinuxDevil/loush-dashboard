import React, { useEffect, useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, BODY, ACCENT, MUTE, INK, GREEN, PURPLE, Tile, Ring, Bar, Badge, SectionTitle } from './theme.jsx'
import { useUsage, useEngSelf } from './data.jsx'
import { levelBand } from '../../career-gamify.mjs'

const BADGE_LABEL = {
  'first-design-doc': 'First Design Doc', 'mentor-5': 'Mentor ≥5', 'okr-closer': 'OKR Closer',
  'zero-regression-sprint': 'Zero-Regression Sprint', 'deep-work-champion': 'Deep-Work Champion',
  'ic-level-reached': 'IC Level Reached', 'course-graduate': 'Course Graduate', 'quest-streak': 'Quest Streak',
  'impact-trader': 'Impact Trader', 'needle-mover': 'Needle Mover', 'ai-pair-master': 'AI Pair Master',
  'prolific-author': 'Prolific Author', 'keystone': 'Keystone', 'decision-driver': 'Decision Driver',
}
const PROGRESS_LABEL = {
  'mentor-5': 'Mentor ≥5', 'quest-streak': 'Quest Streak',
  'course-graduate': 'Course Graduate', 'zero-regression-sprint': 'Zero-Regression Sprint',
  'impact-trader': 'Impact Trader', 'ai-pair-master': 'AI Pair Master',
  'prolific-author': 'Prolific Author', 'decision-driver': 'Decision Driver',
}
// derived from live eng metrics (recomputed each refresh, not persisted XP) — cosmetic recognition only
function engBadges(dora = {}) {
  const out = []
  if (dora.cycleMedian > 0 && dora.cycleMedian <= 3) out.push('Quick Cycle')
  if (dora.estAcc >= 85) out.push('Sharp Estimator')
  if (dora.prReviewRounds > 0 && dora.prReviewRounds <= 1.5) out.push('Clean PRs')
  return out
}

// outcomes-only XP (spec §3.2): no points for logging — only completed KR/OKR/goal/course/level/quest.
export default function GamePanel({ snap, reload }) {
  const g = snap?.game || { xp: 0, level: 0, streaks: {}, badges: [], badgeProgress: [], quests: [], personalBests: {} }
  const pb = g.personalBests || {}
  const { data: usage } = useUsage()
  const { data: eng } = useEngSelf()
  const [busyQuest, setBusyQuest] = useState(null)

  const { level, bandLo, bandHi, toNext } = levelBand(g.xp || 0)
  const ringVal = bandHi > bandLo ? Math.min(1, Math.max(0, ((g.xp || 0) - bandLo) / (bandHi - bandLo))) : 0

  // personal-best "beaten just now" — stash last-seen fastest cycle; toast the moment it improves
  useEffect(() => {
    const c = eng?.dora?.cycleMedian
    if (!(c > 0)) return
    const k = 'career-game:pb-cycle'
    const prev = Number(localStorage.getItem(k))
    if (!prev || c < prev) { localStorage.setItem(k, String(c)); if (prev) toast(`🏆 New personal best — fastest cycle ${c}d`, 'success') }
  }, [eng?.dora?.cycleMedian])

  const completeQuest = async (q) => {
    setBusyQuest(q.id)
    try { const r = await api.post(`/api/career/quest/${q.id}/done`); toast(`✅ ${q.title} — +XP (total ${r.xp})`, 'success'); await reload?.() }
    catch (e) { toast(e.message, 'error') }
    finally { setBusyQuest(null) }
  }

  const openQuests = (g.quests || []).filter(q => !q.done)
  const doneQuests = (g.quests || []).filter(q => q.done)
  const liveBadges = engBadges(eng?.dora)

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div style={{ ...PANEL, display: 'flex', gap: 18, alignItems: 'center' }}>
          <Ring value={ringVal} label={`L${level}`} sub={`${g.xp} XP`} color={ACCENT} size={68} />
          <div>
            <div style={{ font: `600 13px ${HEAD}`, color: INK }}>Level {level}</div>
            <div style={{ font: `400 11px ${MONO}`, color: MUTE, marginTop: 2 }}>{toNext} XP to L{level + 1}</div>
            <div style={{ font: `400 11px ${BODY}`, color: MUTE, marginTop: 2 }}>outcomes only — no XP for logging</div>
          </div>
        </div>
        <Tile label="coding streak" value={`${g.streaks?.coding || usage?.streak || 0}🔥`} sub={`${usage?.activeDays ?? '—'} active days`} tone={GREEN} />
        <Tile label="learning streak" value={`${g.streaks?.learning || 0}d`} sub="courses & goals" tone={PURPLE} />
        {eng?.dora && <Tile label="shipped (90d)" value={eng.dora.throughput90} sub="tickets delivered" tone={ACCENT} />}
      </div>

      <div style={PANEL}>
        <SectionTitle right={`${openQuests.length} open`}>Quests</SectionTitle>
        {(g.quests || []).length === 0
          ? <div style={{ font: `400 12px ${BODY}`, color: MUTE }}>No quests. Seed them in career config under <code>quests</code> — each <code>{'{ id, title, xp }'}</code> awards outcome XP when marked done.</div>
          : <div style={{ display: 'grid', gap: 8 }}>
            {openQuests.map(q => (
              <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                <div style={{ font: `500 13px ${BODY}`, color: INK }}>{q.title} <span style={{ color: MUTE, font: `400 11px ${MONO}` }}>+{q.xp} XP</span></div>
                <button onClick={() => completeQuest(q)} disabled={busyQuest === q.id}
                  style={{ font: `500 11px ${MONO}`, color: busyQuest === q.id ? MUTE : ACCENT, background: '#1f6feb14', border: `1px solid #1f6feb44`, borderRadius: 7, padding: '5px 10px', cursor: busyQuest === q.id ? 'default' : 'pointer' }}>
                  {busyQuest === q.id ? '…' : 'mark done'}
                </button>
              </div>
            ))}
            {doneQuests.map(q => (
              <div key={q.id} style={{ font: `400 12px ${BODY}`, color: MUTE }}>✅ {q.title} <span style={{ font: `400 11px ${MONO}` }}>+{q.xp} XP</span></div>
            ))}
          </div>}
      </div>

      <div style={PANEL}>
        <SectionTitle>Badges</SectionTitle>
        {g.badges?.length
          ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{g.badges.map(b => <Badge key={b} tone="accent">{BADGE_LABEL[b] || b}</Badge>)}</div>
          : <div style={{ font: `400 12px ${BODY}`, color: MUTE }}>None yet — badges are earned by outcomes (ship a design doc, close an OKR, a zero-escaped sprint).</div>}

        {liveBadges.length > 0 && <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ font: `400 10px ${MONO}`, color: MUTE }}>live ·</span>
          {liveBadges.map(b => <Badge key={b} tone="mute">{b}</Badge>)}
        </div>}

        {(g.badgeProgress || []).length > 0 && <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <div style={{ font: `400 10px ${MONO}`, color: MUTE }}>almost there</div>
          {g.badgeProgress.map(p => (
            <div key={p.id} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', font: `400 11px ${MONO}`, color: INK }}>
                <span>{PROGRESS_LABEL[p.id] || p.id}</span><span style={{ color: MUTE }}>{p.have}/{p.need}</span>
              </div>
              <Bar v={p.have} max={p.need} color={ACCENT} />
            </div>
          ))}
        </div>}
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

      {eng?.dora && <div style={PANEL}>
        <SectionTitle right="last 90 days">Recap</SectionTitle>
        <div style={{ font: `400 12.5px ${BODY}`, color: INK, lineHeight: 1.6 }}>
          Shipped <b style={{ color: ACCENT }}>{eng.dora.throughput90}</b> tickets ·
          median cycle <b style={{ color: ACCENT }}>{eng.dora.cycleMedian}d</b> ·
          <b style={{ color: eng.dora.escapedBugs ? INK : GREEN }}> {eng.dora.escapedBugs}</b> escaped bugs ·
          longest streak <b style={{ color: ACCENT }}>{pb.longestStreak ?? 0}d</b> · now <b style={{ color: ACCENT }}>Level {level}</b>.
        </div>
      </div>}
    </div>
  )
}
