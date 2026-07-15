// §2 — the ONLY statistics module. `avg()` used to be the whole toolbox; the mean is the number
// that hides the escalation. Everything a VP might paste into a deck comes from here: p50/p85/p90 + n.
// Percentile: linear interpolation between order statistics (same convention as the server's pctl()).

export function pctl(arr, p) {
  const a = (arr || []).filter(v => v != null && Number.isFinite(v)).sort((x, y) => x - y)
  if (!a.length) return null
  const idx = (a.length - 1) * p
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  return lo === hi ? a[lo] : +(a[lo] + (a[hi] - a[lo]) * (idx - lo)).toFixed(3)
}

// the shape every KPI on this dashboard is built from. n is always carried — a p90 over 3 tickets is a rumour.
export function stat(values) {
  const a = (values || []).filter(v => v != null && Number.isFinite(v))
  return {
    n: a.length,
    p50: pctl(a, 0.5), p85: pctl(a, 0.85), p90: pctl(a, 0.9),
    min: a.length ? Math.min(...a) : null, max: a.length ? Math.max(...a) : null,
    sum: a.reduce((x, y) => x + y, 0),
  }
}
export const of = (rows, f) => stat((rows || []).map(f))
// a duration of 0 is not a duration — it is a ticket that never entered the stage (QA-only items, tickets
// closed straight from the backlog). Counting them drags the median to 0.0d and the KPI lies quietly.
export const pos = v => (v > 0 ? v : null)

export const MIN_N = 5                    // below this every percentile renders grey
export const thin = s => !s || s.n < MIN_N // "not enough data to argue with"

export const fx = (n, d = 1) => (n == null || !Number.isFinite(n) ? '—' : Number(n).toFixed(d))
export const days = (n, d = 1) => (n == null ? '—' : fx(n, d) + 'd')
export const pct = (n, d = 0) => (n == null ? '—' : fx(n, d) + '%')

// p50 · p85 · p90 as one string, for a tile subtitle
export const spread = (s, u = 'd') => (s.n ? `p50 ${fx(s.p50)}${u} · p85 ${fx(s.p85)}${u} · p90 ${fx(s.p90)}${u}` : 'no data')

// delta between two stats on p50 — down is good for durations
export function delta(cur, prev, inv = true) {
  if (cur?.p50 == null || prev?.p50 == null) return null
  const d = +(cur.p50 - prev.p50).toFixed(2)
  return { d, txt: `${d >= 0 ? '+' : ''}${fx(d)}`, good: inv ? d <= 0 : d >= 0 }
}
