
export function pctl(arr, p) {
  const a = (arr || []).filter(v => v != null && Number.isFinite(v)).sort((x, y) => x - y)
  if (!a.length) return null
  const idx = (a.length - 1) * p
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  return lo === hi ? a[lo] : +(a[lo] + (a[hi] - a[lo]) * (idx - lo)).toFixed(3)
}

export function stat(values) {
  const a = (values || []).filter(v => v != null && Number.isFinite(v))
  return {
    n: a.length,
    p50: pctl(a, 0.5), p85: pctl(a, 0.85), p90: pctl(a, 0.9),
    min: a.length ? Math.min(...a) : null, max: a.length ? Math.max(...a) : null,
    sum: a.length ? a.reduce((x, y) => x + y, 0) : null,
  }
}
export const of = (rows, f) => stat((rows || []).map(f))
export const pos = v => (v > 0 ? v : null)

export const MIN_N = 5
export const thin = s => !s || s.n < MIN_N

export const fx = (n, d = 1) => (n == null || !Number.isFinite(n) ? '—' : Number(n).toFixed(d))
export const days = (n, d = 1) => (n == null ? '—' : fx(n, d) + 'd')
export const pct = (n, d = 0) => (n == null ? '—' : fx(n, d) + '%')

export const spread = (s, u = 'd') => (s.n ? `p50 ${fx(s.p50)}${u} · p85 ${fx(s.p85)}${u} · p90 ${fx(s.p90)}${u}` : 'no data')

export function delta(cur, prev, inv = true) {
  if (cur?.p50 == null || prev?.p50 == null) return null
  const d = +(cur.p50 - prev.p50).toFixed(2)
  return { d, txt: `${d >= 0 ? '+' : ''}${fx(d)}`, good: inv ? d <= 0 : d >= 0 }
}
