// stats.mjs — the small numeric helpers the rules share.
//
// NULL DISCIPLINE, same as lib/harness-health.mjs: an unmeasurable quantity is `null`, never 0 and
// never a plausible-looking default. `median([])` is null, not 0 — a 0 baseline would make every
// session an outlier against it, which is how a panel ends up screaming on a fresh install.

export const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Percentile of a COPY of the input — sorting the caller's array in place is a real bug we inherited. */
export function pctl(arr, p) {
  const a = (Array.isArray(arr) ? arr : []).map(num).filter(v => v != null).sort((x, y) => x - y)
  if (!a.length) return null
  return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))]
}
export const median = a => pctl(a, 0.5)

export function mean(arr) {
  const a = (Array.isArray(arr) ? arr : []).map(num).filter(v => v != null)
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null
}

/** Ratio that refuses to invent a value: a zero or unknown denominator yields null, not 0 and not Infinity. */
export function ratio(numerator, denominator) {
  const n = num(numerator), d = num(denominator)
  if (n == null || d == null || d === 0) return null
  return n / d
}

/** Peers = other sessions in the same project. Same-project only: cache behaviour, error rates and
 *  cost-per-token all differ enormously between a docs repo and a compiler, so a cross-project
 *  baseline manufactures outliers out of nothing but repo choice. */
export function peersOf(session, allSessions, predicate = () => true) {
  if (!session || !Array.isArray(allSessions)) return []
  const key = session.proj ?? session.project ?? null
  return allSessions.filter(s => {
    if (!s || typeof s !== 'object') return false
    if (s === session) return false
    if (s.sessionId != null && s.sessionId === session.sessionId) return false
    const k = s.proj ?? s.project ?? null
    // A session with no project cannot be shown to be a peer, so it is not treated as one.
    if (key == null || k == null || k !== key) return false
    return predicate(s)
  })
}

export const round = (v, dp = 3) => (v == null ? null : +v.toFixed(dp))
