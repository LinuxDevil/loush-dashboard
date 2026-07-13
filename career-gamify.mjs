// Gamification — outcomes-only XP (spec §3.2 Goodhart guard). XP is granted for COMPLETED
// outcomes only (KR/OKR/goal/course/competency-level/quest). Logging a brag/decision/retro/lesson
// grants nothing. Badges use escaped-only bug ratio. Streaks read persisted rollup.activityDays
// so they survive session-window rotation.

const OUTCOME = new Set(['kr', 'okr', 'goal', 'course', 'competency-level', 'quest'])
const MEANINGFUL_PR_MIN = 5   // don't hand out a clean-sprint badge on a 0/1-PR window
const AI_PAIR_MIN = 10        // meaningful AI-authored commit sample before the AI badge unlocks
const IMPACT_LINK_MIN = 5     // KPI-linked ships for the impact-trader badge
const PROLIFIC_DOC_MIN = 3    // authored design docs / RFCs for the prolific-author badge (G6)
const DROVE_DECISION_MIN = 3  // decision meetings you organized for the decision-driver badge (G5)
const ARTIFACT_TYPES = new Set(['design-doc', 'system', 'oss'])   // ownership entries that count as written artifacts

// Idempotent by event id. Non-outcome events are recorded with xp 0 (so replay stays idempotent)
// but never move the total. level = ceil(sqrt(totalXp/100)).
export function awardXp(config = {}, events = []) {
  const ledger = [...(config.xpLedger || [])]
  const seen = new Set(ledger.map(e => e.id))
  for (const ev of events) {
    if (!ev?.id || seen.has(ev.id)) continue
    seen.add(ev.id)
    const xp = OUTCOME.has(ev.type) ? (ev.xp || 0) : 0
    ledger.push({ id: ev.id, type: ev.type, xp, at: ev.at || null, label: ev.label || '' })
  }
  const total = ledger.reduce((a, e) => a + e.xp, 0)
  return { xpLedger: ledger, level: Math.ceil(Math.sqrt(total / 100)) }
}

// Inverse of level = ceil(sqrt(xp/100)): the [bandLo, bandHi) XP window of the current level plus
// XP-to-next. The panel ring fills within this band instead of a misleading flat xp%100.
export function levelBand(xp = 0) {
  const level = Math.ceil(Math.sqrt(xp / 100))
  const bandLo = level >= 1 ? ((level - 1) ** 2) * 100 : 0
  const bandHi = level >= 1 ? (level ** 2) * 100 : 100
  return { level, bandLo, bandHi, toNext: Math.max(0, bandHi - xp) }
}

// Walk backward over a persisted day-set. today-idle must not break it (start at today if active, else yesterday).
function streakFrom(daySet, todayIso) {
  const days = new Set(daySet || [])
  let n = 0, d = new Date(todayIso + 'T00:00:00Z')
  if (!days.has(todayIso)) d.setUTCDate(d.getUTCDate() - 1)
  while (days.has(d.toISOString().slice(0, 10))) { n++; d.setUTCDate(d.getUTCDate() - 1) }
  return n
}

export function computeStreaks(rollup = {}, todayIso) {
  return {
    coding: streakFrom(rollup.activityDays, todayIso),
    learning: streakFrom(rollup.learningDays, todayIso),
    bragLog: streakFrom(rollup.bragDays, todayIso),
  }
}

// Earned badge ids. Rules are outcome/evidence-based; the escaped-only ratio is snapshot.quality.changeFailProxy.
export function evaluateAchievements(snapshot = {}, config = {}) {
  const out = []
  const q = snapshot.quality || {}
  const comp = config.competency || snapshot.competency || {}
  // First Design Doc — a decision graduated to an ADR or an owned design doc
  if ((config.decisions || []).some(d => d.becameAdr) || (config.ownership || []).some(o => o.type === 'design-doc')) out.push('first-design-doc')
  // Mentor≥N — reviews done for others (Phase-2 GitHub import)
  const reviewedForOthers = Object.values(snapshot.github?.reviewFootprint?.reviewedForOthers || {}).reduce((a, b) => a + b, 0)
  if (reviewedForOthers >= 5) out.push('mentor-5')
  // OKR Closer — at least one KR closed (outcome event in the ledger)
  if ((config.xpLedger || []).some(e => e.type === 'kr' || e.type === 'okr')) out.push('okr-closer')
  // Zero-Regression Sprint — escaped-only ratio is 0 over a meaningful sample
  if ((q.myPrCount || 0) >= MEANINGFUL_PR_MIN && (q.changeFailProxy || 0) === 0) out.push('zero-regression-sprint')
  // Deep-Work Champion — sustained low after-hours with a real flow signal
  if ((snapshot.flow?.afterHoursPct ?? 1) < 0.15 && (snapshot.workflow?.oneShotRate || 0) > 0.5) out.push('deep-work-champion')
  // IC-Level Reached — a self-assessed level is recorded
  if (comp.levelSelfAssessed) out.push('ic-level-reached')
  // Course Graduate — a completed course
  if ((config.courses || []).some(c => c.completed)) out.push('course-graduate')
  // Quest Streak — quests completed
  if ((config.quests || []).filter(qu => qu.done).length >= 3) out.push('quest-streak')
  // G2 Business impact — Impact Trader: ≥N shipped items linked to a business KPI; Needle Mover: a linked KPI actually moved.
  const impact = snapshot.impact || {}
  if ((impact.linkedCount || 0) >= IMPACT_LINK_MIN) out.push('impact-trader')
  if ((impact.movedCount || 0) >= 1) out.push('needle-mover')
  // G1 AI Pair Master — meaningful AI-authored commit volume gated on a ZERO escaped-bug ratio (speed paired with quality).
  const ai = snapshot.ai || {}
  if ((ai.aiCommits || 0) >= AI_PAIR_MIN && (q.myPrCount || 0) >= MEANINGFUL_PR_MIN && (q.changeFailProxy || 0) === 0) out.push('ai-pair-master')
  // G6 Prolific Author — ≥N authored written artifacts (design docs / RFCs / OSS) in the ownership log.
  if ((config.ownership || []).filter(o => ARTIFACT_TYPES.has(o.type)).length >= PROLIFIC_DOC_MIN) out.push('prolific-author')
  // G4 Keystone — you're the primary author of ≥1 code area (bus-factor risk / deep ownership).
  if ((snapshot.domain?.keystones || []).length >= 1) out.push('keystone')
  // G5 Decision Driver — you organized ≥N decision-type meetings (drove the room, not just attended).
  if ((snapshot.meetings?.droveDecisions || 0) >= DROVE_DECISION_MIN) out.push('decision-driver')
  return out
}

// Quest completion → outcome XP event (mirrors krClosed). Default 15 XP if the quest omits its own.
export function questDone(q = {}) {
  return { type: 'quest', id: 'quest:' + q.id, xp: q.xp || 15, at: Date.now(), label: q.title || q.id }
}

// Distance-to-earn for the countable, server-data badges only. Returns [{id, have, need}] for badges
// NOT yet earned, so the panel can show "3/5" pull. Badges gated on non-countable signals (design-doc,
// deep-work, ic-level) are all-or-nothing and omitted here.
export function badgeProgress(snapshot = {}, config = {}) {
  const q = snapshot.quality || {}
  const reviewedForOthers = Object.values(snapshot.github?.reviewFootprint?.reviewedForOthers || {}).reduce((a, b) => a + b, 0)
  const questsDone = (config.quests || []).filter(qu => qu.done).length
  const coursesDone = (config.courses || []).filter(c => c.completed).length
  // clean-sprint: an escaped bug blocks it outright, so progress reads 0 until the ratio is clean
  const cleanPrs = (q.changeFailProxy || 0) === 0 ? (q.myPrCount || 0) : 0
  const linkedCount = (snapshot.impact || {}).linkedCount || 0
  // ai-pair-master: like clean-sprint, an escaped bug blocks it → progress reads 0 until the ratio is clean
  const aiCleanCommits = (q.changeFailProxy || 0) === 0 ? ((snapshot.ai || {}).aiCommits || 0) : 0
  const all = [
    { id: 'mentor-5', have: reviewedForOthers, need: 5 },
    { id: 'quest-streak', have: questsDone, need: 3 },
    { id: 'course-graduate', have: coursesDone, need: 1 },
    { id: 'zero-regression-sprint', have: cleanPrs, need: MEANINGFUL_PR_MIN },
    { id: 'impact-trader', have: linkedCount, need: IMPACT_LINK_MIN },
    { id: 'ai-pair-master', have: aiCleanCommits, need: AI_PAIR_MIN },
    { id: 'prolific-author', have: (config.ownership || []).filter(o => ARTIFACT_TYPES.has(o.type)).length, need: PROLIFIC_DOC_MIN },
    { id: 'decision-driver', have: (snapshot.meetings || {}).droveDecisions || 0, need: DROVE_DECISION_MIN },
  ]
  return all.filter(b => b.have < b.need)
}

export function personalBests(rollup = {}) {
  const pb = rollup.personalBests || {}
  // longest streak: today-anchored current streak, or a persisted best if higher
  const longest = Math.max(pb.longestStreak || 0,
    (rollup.activityDays || []).length ? streakFrom(rollup.activityDays, (rollup.activityDays || []).slice(-1)[0]) : 0)
  return {
    lowestBugRatio: pb.lowestBugRatio ?? null,
    bestFlowWeek: pb.bestFlowWeek ?? null,
    mostKrsQuarter: pb.mostKrsQuarter ?? null,
    longestStreak: longest,
  }
}
