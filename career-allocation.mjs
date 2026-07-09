// Actual time split derived from sessions (+ GitHub review footprint when present) vs an intended target.
// Buckets: deepWork (long uninterrupted coding), reviewsMentorship (GitHub reviews), designStrategy
// (planning/architecture sessions), opsInterrupts (interrupt-heavy/short sessions). Pure + testable.
const BUCKETS = ['deepWork', 'reviewsMentorship', 'designStrategy', 'opsInterrupts']
const DESIGN = new Set(['design', 'architecture', 'planning', 'research'])

function bucketForSession(s) {
  if ((s.user_interruptions || 0) > 2) return 'opsInterrupts'
  const cats = Array.isArray(s.goal_categories) ? s.goal_categories : Object.keys(s.goal_categories || {})
  if (cats.some(c => DESIGN.has(String(c).toLowerCase())) || s.session_type === 'planning') return 'designStrategy'
  return 'deepWork'
}

export function computeAllocation({ sessions = [], github = null, target = null } = {}) {
  const units = { deepWork: 0, reviewsMentorship: 0, designStrategy: 0, opsInterrupts: 0 }
  for (const s of sessions) units[bucketForSession(s)]++
  units.reviewsMentorship += github?.reviewFootprint?.prsReviewed || 0

  const total = BUCKETS.reduce((t, b) => t + units[b], 0) || 1
  const actual = {}; for (const b of BUCKETS) actual[b] = Math.round(units[b] / total * 100)

  // drift: per-bucket (actual - target); a bucket under half its target for the window is a warning.
  const drift = {}
  if (target) for (const b of BUCKETS) {
    const tgt = target[b] || 0
    drift[b] = { delta: actual[b] - tgt, warn: tgt > 0 && actual[b] < tgt / 2 }
  }
  return { target, actual, drift }
}
