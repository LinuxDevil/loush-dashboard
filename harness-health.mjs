// harness-health.mjs — pure usage-health scoring over this repo's entry shape {t, model, in, out, cc, cr, tc}.
// Plane B: operates only on this machine's own transcript-derived token entries.
//
// NULL DISCIPLINE: a factor with no data reports `na: true` and is DROPPED from the weighted mean;
// if every factor is na, the grade itself is null. It previously returned score:50 for "no data" on
// two of three factors, which fed the mean as if it were a measurement — so a brand-new install
// scored 50/D and a single turn scored 25/F. A grade that says "D" before it has seen anything
// teaches the reader to ignore it exactly when it starts to matter.
const DAY = 86400_000
const clamp100 = v => Math.max(0, Math.min(100, v))
const toGrade = s => (s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 60 ? 'C' : s >= 40 ? 'D' : 'F')

// Weighted 0-100 score. Deliberately narrower than oh-my-hi's 5-factor version: unused-item
// coverage is already owned by the Capabilities ROI ledger, so scoring it again here would just
// be two dashboards disagreeing about the same fact.
const WEIGHTS = { costTrend: 0.4, cacheEfficiency: 0.3, contextEfficiency: 0.3 }

function scoreCostTrend(entries, costFn, now) {
  const d7 = 7 * DAY
  let cur = 0, prev = 0, curN = 0, prevN = 0
  for (const e of entries) {
    const age = now - e.t
    if (age <= d7) { cur += costFn(e); curN++ } else if (age <= d7 * 2) { prev += costFn(e); prevN++ }
  }
  if (prevN === 0 || curN === 0) return { name: 'costTrend', score: null, na: true, weight: WEIGHTS.costTrend, raw: { cur, prev, changePct: null } }
  // PER-TURN rates. This was ((cur/7 - prev/7) / (prev/7)) — the /7 cancels algebraically, leaving a
  // comparison of raw weekly SUMS. That penalises working MORE this week rather than working worse,
  // which is not what "is my harness getting pricier" means.
  const curRate = cur / curN, prevRate = prev / prevN
  const changePct = prevRate === 0 ? 0 : ((curRate - prevRate) / prevRate) * 100
  const score = changePct <= 5 ? 100 : changePct >= 100 ? 0 : 100 - ((changePct - 5) / 95 * 100)
  return { name: 'costTrend', score: Math.round(clamp100(score)), weight: WEIGHTS.costTrend, raw: { cur: +cur.toFixed(2), prev: +prev.toFixed(2), curN, prevN, perTurn: { cur: +curRate.toFixed(4), prev: +prevRate.toFixed(4) }, changePct: Math.round(changePct) || 0 } }
}

function scoreCacheEfficiency(entries) {
  let read = 0, create = 0
  for (const e of entries) { read += e.cr || 0; create += e.cc || 0 }
  const denom = read + create
  if (denom === 0) return { name: 'cacheEfficiency', score: null, na: true, weight: WEIGHTS.cacheEfficiency, raw: { read: 0, create: 0, ratio: null } }
  const ratio = read / denom
  return { name: 'cacheEfficiency', score: Math.round(clamp100(ratio * 100)), weight: WEIGHTS.cacheEfficiency, raw: { read, create, ratio: +ratio.toFixed(3) } }
}

// hidden = always-loaded budget (system prompt + tool defs + CLAUDE.md), paid on every turn.
// 0% hidden of total input → 100, 60%+ hidden → 0.
function scoreContextEfficiency(entries, hiddenPerTurn) {
  // total context per turn = fresh + cache-write + cache-read (what the model actually saw),
  // not just fresh `in` — under heavy caching `in` alone is near-zero and wrongly inflates the ratio.
  const totalContext = entries.reduce((s, e) => s + (e.in || 0) + (e.cc || 0) + (e.cr || 0), 0)
  const totalHidden = hiddenPerTurn * entries.length
  if (totalContext === 0 || !entries.length) return { name: 'contextEfficiency', score: null, na: true, weight: WEIGHTS.contextEfficiency, raw: { ratio: null } }
  const ratio = Math.min(1, totalHidden / totalContext)
  const score = clamp100(100 - (ratio / 0.6) * 100)
  // hiddenPerTurn is an ASSUMED constant (system prompt + tool defs), not a measurement, and it is
  // user-overridable — so two people doing identical work can get different grades. Flagged so the
  // UI can say so rather than presenting it as observed.
  return { name: 'contextEfficiency', score: Math.round(score), weight: WEIGHTS.contextEfficiency, assumed: true, raw: { hiddenPerTurn, totalContext, ratio: +ratio.toFixed(3) } }
}

// Below this many turns the factors are noise, not signal: one turn of 100 input tokens against an
// assumed 3,800-token always-on budget scores 0/F, and a single good day flips it to A. A letter
// grade that swings on n=1 trains the reader to ignore it. No data and not-enough-data are both null.
export const MIN_TURNS_FOR_GRADE = 25

export function computeUsageHealth(entries, costFn, hiddenPerTurn, now = Date.now()) {
  if (!entries || entries.length < MIN_TURNS_FOR_GRADE)
    return { total: null, grade: null, factors: [], reason: 'insufficient-data', n: entries?.length || 0, minN: MIN_TURNS_FOR_GRADE }
  const factors = [scoreCostTrend(entries, costFn, now), scoreCacheEfficiency(entries), scoreContextEfficiency(entries, hiddenPerTurn)]
  let sum = 0, weight = 0
  for (const f of factors) { if (f.na) continue; sum += f.score * f.weight; weight += f.weight }
  if (weight === 0) return { total: null, grade: null, factors, reason: 'no-data' }
  const total = Math.round(clamp100(sum / weight))
  return { total, grade: toGrade(total), factors }
}

// Week-over-week regression: is the harness getting slower/pricier per turn?
export function computeRegression(entries, now = Date.now(), thresholdPct = 15, minSamples = 5) {
  const d7 = 7 * DAY
  const tokOf = e => (e.in || 0) + (e.out || 0) + (e.cc || 0) + (e.cr || 0)
  const cur = { sum: 0, n: 0 }, prev = { sum: 0, n: 0 }
  for (const e of entries) {
    const age = now - e.t
    if (age <= d7) { cur.sum += tokOf(e); cur.n++ } else if (age <= d7 * 2) { prev.sum += tokOf(e); prev.n++ }
  }
  if (cur.n < minSamples || prev.n < minSamples || prev.sum === 0) return { tokensPerTurn: null, regressed: false }
  const curAvg = cur.sum / cur.n, prevAvg = prev.sum / prev.n
  const deltaPct = ((curAvg - prevAvg) / prevAvg) * 100
  const regressed = deltaPct >= thresholdPct
  let cause = null
  if (regressed) {
    // Was `if (age > from || age <= to) continue` — for (0, d7) that is `age > 0 || age <= d7`,
    // true for every entry, so the loop body never ran, rateIn always returned null and `cause` was
    // permanently null. UsagePanel has a render branch for it that could never fire.
    const rateIn = (from, to) => { let r = 0, c = 0; for (const e of entries) { const age = now - e.t; if (age < from || age > to) continue; r += e.cr || 0; c += (e.cr || 0) + (e.cc || 0) }; return c ? r / c : null }
    const curRate = rateIn(0, d7), prevRate = rateIn(d7, d7 * 2)
    if (curRate != null && prevRate != null && (curRate - prevRate) * 100 <= -10) cause = 'cache-hit-rate dropped'
  }
  return { tokensPerTurn: { current: Math.round(curAvg), previous: Math.round(prevAvg), deltaPct: Math.round(deltaPct) }, regressed, cause }
}
