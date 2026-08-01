// usage-buckets.mjs — bucket usage by (model, speed, inference_geo, service_tier) and total the cost
// of each bucket using lib/pricing.mjs. No pricing arithmetic lives here; this file only groups.
//
// Two things make this more than a groupBy:
//
//  1. The dimensions are frequently absent. Across the 2,352 real usage records under
//     ~/.claude/projects in this checkout, `speed` is missing on 707 of them (30%) and
//     `inference_geo` is the literal string "not_available" on all of them. Both are unknown, and
//     the count of each is reported rather than folded into a default bucket.
//  2. A bucket whose model has no published rate has an unknown cost. It surfaces with `cost: null`,
//     and its tokens are excluded from the priced total but counted in the coverage figures — so the
//     headline dollar number can never be read as covering usage it does not cover.

import { priceEntry as entryCost } from './pricing.mjs'

export const UNKNOWN = 'unknown'

// Values that are present but mean "we do not know". Treated as unknown, yet tracked apart from an
// absent field: a provider that reports "not_available" told us something; a missing key did not.
const SENTINELS = new Set(['not_available', 'unknown', 'unspecified', 'n/a', ''])

export const DIMENSIONS = ['model', 'speed', 'inference_geo', 'service_tier']

/** Classify one dimension value into {label, state}. state ∈ known | sentinel | absent | malformed. */
export function classifyDimension(value) {
  if (value === undefined || value === null) return { label: UNKNOWN, state: 'absent' }
  if (typeof value !== 'string') {
    // A number or object here means the transcript schema moved. Do not stringify it into a bucket
    // key that looks like a real tier — say the shape was wrong.
    return { label: UNKNOWN, state: 'malformed', raw: typeof value }
  }
  const v = value.trim()
  if (SENTINELS.has(v.toLowerCase())) return { label: UNKNOWN, state: 'sentinel', raw: v }
  return { label: v, state: 'known' }
}

const keyOf = d => DIMENSIONS.map(k => d[k].label).join('|')

/**
 * Bucket usage entries and total cost per bucket.
 *
 * @param {Array} entries records from transcript-records.usageRecords(), or any objects carrying
 *   {model, speed, inference_geo, service_tier, usage|in/out/cc/cr, t}
 * @param {{at?, allowFamilyFallback?, overrides?, limit?, minEntries?}} [opts]
 *   `at` overrides the per-entry timestamp used to pick a rate period (default: the entry's own `t`,
 *   which is the correct choice — usage is priced at the rate in force when it was spent).
 */
export function bucketUsage(entries, opts = {}) {
  const list = Array.isArray(entries) ? entries : []
  const buckets = new Map()
  const dimStats = {}
  for (const d of DIMENSIONS) dimStats[d] = { known: 0, sentinel: 0, absent: 0, malformed: 0 }

  let skipped = 0
  const assumptionCounts = {}

  for (const e of list) {
    if (!e || typeof e !== 'object') { skipped++; continue }
    const dims = {}
    for (const d of DIMENSIONS) {
      const src = d === 'model' ? (e.model ?? e.message?.model) : (e[d] ?? e.usage?.[d])
      dims[d] = classifyDimension(src)
      dimStats[d][dims[d].state]++
    }
    const key = keyOf(dims)
    let b = buckets.get(key)
    if (!b) {
      b = {
        key,
        model: dims.model.label, speed: dims.speed.label,
        inference_geo: dims.inference_geo.label, service_tier: dims.service_tier.label,
        dimensionStates: Object.fromEntries(DIMENSIONS.map(d => [d, dims[d].state])),
        unknownDimensions: DIMENSIONS.filter(d => dims[d].state !== 'known'),
        entries: 0, pricedEntries: 0, unpricedEntries: 0, estimatedEntries: 0,
        tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
        _cost: 0, unpricedReasons: {}, assumptions: [], firstAt: null, lastAt: null,
      }
      buckets.set(key, b)
    }
    b.entries++
    b.tokens.input += e.in ?? 0
    b.tokens.output += e.out ?? 0
    b.tokens.cacheWrite += e.cc ?? 0
    b.tokens.cacheRead += e.cr ?? 0
    const t = e.t ?? null
    if (typeof t === 'number' && Number.isFinite(t)) {
      b.firstAt = b.firstAt === null ? t : Math.min(b.firstAt, t)
      b.lastAt = b.lastAt === null ? t : Math.max(b.lastAt, t)
    }

    const c = entryCost(e, { ...opts, at: opts.at ?? e.t ?? e.timestamp, model: e.model })
    if (c.ok) {
      b.pricedEntries++
      b._cost += c.cost
      if (c.estimated) b.estimatedEntries++
      for (const a of c.assumptions) {
        assumptionCounts[a.field] = (assumptionCounts[a.field] || 0) + 1
        let agg = b.assumptions.find(x => x.field === a.field && x.assumed === a.assumed)
        if (!agg) { agg = { field: a.field, assumed: a.assumed, why: a.why, entries: 0, maxUnderstatementUsd: 0 }; b.assumptions.push(agg) }
        agg.entries++
        agg.maxUnderstatementUsd += a.maxUnderstatementUsd
      }
    } else {
      b.unpricedEntries++
      b.unpricedReasons[c.reason] = (b.unpricedReasons[c.reason] || 0) + 1
    }
  }

  let rows = [...buckets.values()].map(b => {
    // cost is null unless EVERY entry in the bucket was priced. A bucket where 3 of 10 entries had no
    // rate has a partial number, and a partial number rendered as "cost" is a lie by omission — so it
    // is exposed as `partialCost` under a name that cannot be mistaken for the whole.
    const complete = b.unpricedEntries === 0 && b.pricedEntries > 0
    for (const a of b.assumptions) a.maxUnderstatementUsd = +a.maxUnderstatementUsd.toFixed(10)
    const out = {
      ...b,
      priced: complete,
      cost: complete ? b._cost : null,
      partialCost: complete ? null : (b.pricedEntries > 0 ? b._cost : null),
      costReason: complete ? null : (b.pricedEntries > 0 ? 'some-entries-unpriced' : (Object.keys(b.unpricedReasons)[0] ?? 'no-entries-priced')),
      estimated: b.estimatedEntries > 0,
    }
    delete out._cost
    return out
  })

  rows.sort((a, b) => (b.cost ?? b.partialCost ?? 0) - (a.cost ?? a.partialCost ?? 0) || b.entries - a.entries)

  const bounds = []
  if (typeof opts.minEntries === 'number' && opts.minEntries > 1) {
    const dropped = rows.filter(r => r.entries < opts.minEntries)
    if (dropped.length) bounds.push({
      bound: 'minEntries', limit: opts.minEntries, droppedBuckets: dropped.length,
      droppedEntries: dropped.reduce((s, r) => s + r.entries, 0),
      droppedPricedUsd: +dropped.reduce((s, r) => s + (r.cost ?? r.partialCost ?? 0), 0).toFixed(10),
      effect: 'these buckets are omitted from buckets[] — their dollars are still inside totals below',
    })
    rows = rows.filter(r => r.entries >= opts.minEntries)
  }
  const allRows = [...buckets.values()]
  if (typeof opts.limit === 'number' && opts.limit >= 0 && rows.length > opts.limit) {
    const cut = rows.slice(opts.limit)
    bounds.push({
      bound: 'limit', limit: opts.limit, totalBuckets: rows.length, shown: opts.limit,
      hiddenBuckets: cut.length, hiddenEntries: cut.reduce((s, r) => s + r.entries, 0),
      hiddenPricedUsd: +cut.reduce((s, r) => s + (r.cost ?? r.partialCost ?? 0), 0).toFixed(10),
      effect: 'buckets beyond the limit are not listed — their dollars are still inside totals below',
    })
    rows = rows.slice(0, opts.limit)
  }

  const pricedEntries = allRows.reduce((s, r) => s + r.pricedEntries, 0)
  const unpricedEntries = allRows.reduce((s, r) => s + r.unpricedEntries, 0)
  const usd = allRows.reduce((s, r) => s + r._cost, 0)
  const unpricedReasons = {}
  for (const r of allRows) for (const [k, v] of Object.entries(r.unpricedReasons)) unpricedReasons[k] = (unpricedReasons[k] || 0) + v
  const maxUnderstatementUsd = allRows.reduce((s, r) => s + r.assumptions.reduce((x, a) => x + a.maxUnderstatementUsd, 0), 0)

  const unknownDimensionEntries = Object.fromEntries(
    DIMENSIONS.map(d => [d, dimStats[d].sentinel + dimStats[d].absent + dimStats[d].malformed]),
  )

  return {
    buckets: rows,
    bucketCount: allRows.length,
    totals: {
      entries: list.length,
      skippedEntries: skipped,
      pricedEntries,
      unpricedEntries,
      // Named `pricedUsd`, never `usd`, because it is the total of the priced subset only.
      pricedUsd: pricedEntries ? usd : null,
      basis: 'sum over priced entries only; unpriced entries contribute no dollars and are NOT counted as $0',
      coverage: list.length ? +(pricedEntries / list.length).toFixed(4) : null,
      complete: list.length > 0 && unpricedEntries === 0 && skipped === 0,
      unpricedReasons,
      // Estimated must reflect BOTH sources of modelling — an assumed cache tier and a guessed rate.
      // Deriving it from maxUnderstatementUsd alone reported `estimated:false` for a total built
      // entirely out of family-regex rates, which is the exact mislabel rule 4 exists to prevent.
      estimated: maxUnderstatementUsd > 0 || allRows.some(r => r.estimatedEntries > 0),
      estimatedEntries: allRows.reduce((s, r) => s + r.estimatedEntries, 0),
      maxUnderstatementUsd: +maxUnderstatementUsd.toFixed(10),
      assumptionCounts,
    },
    dimensions: {
      stats: dimStats,
      unknownEntries: unknownDimensionEntries,
      unknownBuckets: allRows.filter(r => r.unknownDimensions.length > 0).length,
      label: UNKNOWN,
      note: 'unknown is a distinct label, not a default value; "sentinel" means the record said not_available, "absent" means the field was missing',
    },
    bounds,
  }
}
