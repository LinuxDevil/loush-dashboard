// Gamification — outcomes-only XP (spec §3.2 Goodhart guard). XP is granted for COMPLETED
// outcomes only (KR/OKR/goal/course/competency-level/quest). Logging a brag/decision/retro/lesson
// grants nothing. Badges use escaped-only bug ratio. Streaks read persisted rollup.activityDays
// so they survive session-window rotation.

const OUTCOME = new Set(['kr', 'okr', 'goal', 'course', 'competency-level', 'quest'])
const MEANINGFUL_PR_MIN = 5   // don't hand out a clean-sprint badge on a 0/1-PR window

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
  return out
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
