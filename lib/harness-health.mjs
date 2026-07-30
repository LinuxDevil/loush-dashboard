const DAY = 86400_000
const clamp100 = v => Math.max(0, Math.min(100, v))
const toGrade = s => (s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 60 ? 'C' : s >= 40 ? 'D' : 'F')

const WEIGHTS = { costTrend: 0.4, cacheEfficiency: 0.3, contextEfficiency: 0.3 }

function scoreCostTrend(entries, costFn, now) {
  const d7 = 7 * DAY
  let cur = 0, prev = 0, curN = 0, prevN = 0
  for (const e of entries) {
    const age = now - e.t
    if (age <= d7) { cur += costFn(e); curN++ } else if (age <= d7 * 2) { prev += costFn(e); prevN++ }
  }
  if (prevN === 0 || curN === 0) return { name: 'costTrend', score: null, na: true, weight: WEIGHTS.costTrend, raw: { cur, prev, changePct: null } }
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

function scoreContextEfficiency(entries, hiddenPerTurn) {
  const totalContext = entries.reduce((s, e) => s + (e.in || 0) + (e.cc || 0) + (e.cr || 0), 0)
  const totalHidden = hiddenPerTurn * entries.length
  if (totalContext === 0 || !entries.length) return { name: 'contextEfficiency', score: null, na: true, weight: WEIGHTS.contextEfficiency, raw: { ratio: null } }
  const ratio = Math.min(1, totalHidden / totalContext)
  const score = clamp100(100 - (ratio / 0.6) * 100)
  return { name: 'contextEfficiency', score: Math.round(score), weight: WEIGHTS.contextEfficiency, assumed: true, raw: { hiddenPerTurn, totalContext, ratio: +ratio.toFixed(3) } }
}

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
    const rateIn = (from, to) => { let r = 0, c = 0; for (const e of entries) { const age = now - e.t; if (age < from || age > to) continue; r += e.cr || 0; c += (e.cr || 0) + (e.cc || 0) }; return c ? r / c : null }
    const curRate = rateIn(0, d7), prevRate = rateIn(d7, d7 * 2)
    if (curRate != null && prevRate != null && (curRate - prevRate) * 100 <= -10) cause = 'cache-hit-rate dropped'
  }
  return { tokensPerTurn: { current: Math.round(curAvg), previous: Math.round(prevAvg), deltaPct: Math.round(deltaPct) }, regressed, cause }
}
