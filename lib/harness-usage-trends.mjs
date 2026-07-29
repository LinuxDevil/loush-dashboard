const dayKey = t => new Date(t).toISOString().slice(0, 10)

// ---------- cache TTL impact ----------
export function buildDailyCacheMap(entries) {
  const map = {}
  for (const e of entries) {
    const dk = dayKey(e.t)
    const d = (map[dk] ||= { read: 0, creation: 0 })
    d.read += e.cr || 0; d.creation += e.cc || 0
  }
  const sortedDates = Object.keys(map).sort()
  return { map, sortedDates }
}

export function rollingCacheEfficiency(map, sortedDates) {
  let bestEff = 0, worstEff = 1
  const series = []
  for (let i = 0; i < sortedDates.length; i++) {
    let read = 0, create = 0
    for (let j = Math.max(0, i - 6); j <= i; j++) { read += map[sortedDates[j]].read; create += map[sortedDates[j]].creation }
    const eff = (read + create) > 0 ? read / (read + create) : 0
    if (eff > bestEff) bestEff = eff
    if (eff > 0 && eff < worstEff) worstEff = eff
    series.push({ date: sortedDates[i], pct: Math.round(eff * 100) })
  }
  return { bestEffPct: Math.round(bestEff * 100), worstEffPct: Math.round((worstEff === 1 ? 0 : worstEff) * 100), series }
}

export function cacheWasteCost(entries, rateFn, bestEff) {
  let totalRead = 0, totalCreate = 0, weightedDelta = 0, totalWeight = 0
  for (const e of entries) {
    const { write, read } = rateFn(e)
    const w = (e.cc || 0) + (e.cr || 0)
    if (write || read) { weightedDelta += (write - read) * w; totalWeight += w }
    totalRead += e.cr || 0; totalCreate += e.cc || 0
  }
  const avgPriceDelta = totalWeight > 0 ? weightedDelta / totalWeight : 0
  const excessCreation = Math.max(0, totalCreate - (totalRead + totalCreate) * (1 - bestEff))
  return { excessCreation, wasteCost: excessCreation * avgPriceDelta / 1e6, avgPriceDelta }
}

// ---------- anomaly detection ----------
const WINDOW = 7, MULTIPLIER = 2, MIN_BASELINE_DAYS = 3, TOKEN_FLOOR = 1e6, COST_FLOOR = 1

export function buildDailyUsage(entries, costFn) {
  const map = {}
  for (const e of entries) {
    const dk = dayKey(e.t)
    const d = (map[dk] ||= { tokens: 0, cost: 0 })
    d.tokens += (e.in || 0) + (e.out || 0) + (e.cc || 0) + (e.cr || 0)
    d.cost += costFn(e) || 0
  }
  return { map, sortedDates: Object.keys(map).sort() }
}

export function detectDailyAnomalies(map, sortedDates) {
  const anomalies = []
  for (let i = 0; i < sortedDates.length; i++) {
    const start = Math.max(0, i - WINDOW), n = i - start
    if (n < MIN_BASELINE_DAYS) continue
    let tokSum = 0, costSum = 0
    for (let j = start; j < i; j++) { tokSum += map[sortedDates[j]].tokens; costSum += map[sortedDates[j]].cost }
    const tokenBaseline = tokSum / n, costBaseline = costSum / n
    const day = map[sortedDates[i]]
    const tokenSpike = tokenBaseline > 0 && day.tokens > MULTIPLIER * tokenBaseline && day.tokens >= TOKEN_FLOOR
    const costSpike = costBaseline > 0 && day.cost > MULTIPLIER * costBaseline && day.cost >= COST_FLOOR
    if (!tokenSpike && !costSpike) continue
    anomalies.push({
      date: sortedDates[i], tokens: day.tokens, cost: +day.cost.toFixed(2),
      tokenRatio: tokenBaseline > 0 ? +(day.tokens / tokenBaseline).toFixed(1) : 0,
      costRatio: costBaseline > 0 ? +(day.cost / costBaseline).toFixed(1) : 0,
      kind: tokenSpike && costSpike ? 'both' : tokenSpike ? 'tokens' : 'cost',
    })
  }
  return anomalies.reverse()
}

// ---------- month-end cost projection ----------
const shiftDay = (iso, delta) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10) }
const daysInMonth = (y, m) => new Date(y, m, 0).getDate()

export function projectMonthEnd(dailyCostMap, todayISO, monthlyBudget) {
  const m = todayISO.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const [, y, mo, d] = m.map(Number)
  let windowSum = 0, sampleDays = 0
  for (let i = 0; i < 7; i++) {
    const v = dailyCostMap[shiftDay(todayISO, -i)]
    if (typeof v === 'number' && v > 0) { windowSum += v; sampleDays++ }
  }
  const dailyAvg = windowSum / 7
  const monthPrefix = todayISO.slice(0, 7) + '-'
  let monthToDate = 0
  for (const k of Object.keys(dailyCostMap)) if (k.startsWith(monthPrefix) && k <= todayISO) monthToDate += dailyCostMap[k] || 0
  const dim = daysInMonth(y, mo), daysRemaining = dim - d
  const projected = monthToDate + dailyAvg * daysRemaining
  const confidence = sampleDays >= 5 ? 'high' : sampleDays >= 3 ? 'low' : 'none'
  const hasBudget = typeof monthlyBudget === 'number' && monthlyBudget > 0
  return {
    projected: +projected.toFixed(2), monthToDate: +monthToDate.toFixed(2), dailyAvg: +dailyAvg.toFixed(2),
    daysRemaining, daysInMonth: dim, sampleDays, confidence,
    diff: hasBudget ? +(projected - monthlyBudget).toFixed(2) : null,
    overBudget: hasBudget ? projected > monthlyBudget : false,
  }
}
