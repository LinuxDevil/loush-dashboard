
export const RATE_KEYS = ['in', 'out', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h']

// ponytail: one cutoff per rule, not a general rate history. A second price change means a
export const DEFAULT_PRICE_TABLE = [
  { match: 'claude-fable-5', in: 10, out: 50, cacheRead: 1, cacheWrite5m: 12.5, cacheWrite1h: 20 },
  { match: 'claude-opus-5', in: 5, out: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  { match: 'claude-opus-4-8', in: 5, out: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  { match: 'claude-opus-4-7', in: 5, out: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  { match: 'claude-opus-4-6', in: 5, out: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  {
    match: 'claude-sonnet-5', in: 3, out: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6,
    intro_until: '2026-08-31',
    intro: { in: 2, out: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 },
  },
  { match: 'claude-sonnet-4-6', in: 3, out: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },
  { match: 'claude-haiku-4-5', in: 1, out: 5, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 },
]

let TABLE = DEFAULT_PRICE_TABLE

export const setPriceTable = rules => { TABLE = Array.isArray(rules) && rules.length ? rules : DEFAULT_PRICE_TABLE }
export const getPriceTable = () => TABLE

const utcDay = at => { const d = new Date(at); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) }

export const rateFor = (model, at) => {
  if (typeof model !== 'string' || !model) return null
  let rule = null
  for (const r of TABLE) if (r.id === model) { rule = r; break }
  if (!rule) for (const r of TABLE) if (r.match && model.includes(r.match)) { rule = r; break }
  if (!rule) return null
  if (rule.intro && rule.intro_until && at != null) {
    const day = utcDay(at)
    if (day && day <= rule.intro_until) return rule.intro
  }
  return rule
}

export const PRICE_PER_M = (model, at) => rateFor(model, at)?.in ?? null

export const isPriced = model => PRICE_PER_M(model) != null

export const UNTIERED_CACHE_WRITE_TIER = '5m'
const UNTIERED_KEY = UNTIERED_CACHE_WRITE_TIER === '1h' ? 'cacheWrite1h' : 'cacheWrite5m'
export const FALLBACKS = { untieredCacheWrite: 0 }

export function splitCacheWrite(total, five, oneHour) {
  const t = total || 0
  if (typeof five === 'number' || typeof oneHour === 'number') return { cc5: five || 0, cc1h: oneHour || 0 }
  if (t > 0) FALLBACKS.untieredCacheWrite++
  return UNTIERED_KEY === 'cacheWrite1h' ? { cc5: 0, cc1h: t } : { cc5: t, cc1h: 0 }
}

export const entryCost = e => {
  const r = rateFor(e.model, e.t)
  if (r == null) return 0
  const { cc5, cc1h } = splitCacheWrite(e.cc, e.cc5, e.cc1h)
  return ((e.in || 0) * r.in + (e.out || 0) * r.out + (e.cr || 0) * r.cacheRead
    + cc5 * r.cacheWrite5m + cc1h * r.cacheWrite1h) / 1e6
}

export const entryCacheRates = e => {
  const r = rateFor(e.model, e.t)
  if (r == null) return { write: 0, read: 0 }
  const c5 = e.cc5 || 0, c1h = e.cc1h || 0, tot = c5 + c1h
  return {
    write: tot ? (c5 * r.cacheWrite5m + c1h * r.cacheWrite1h) / tot : r[UNTIERED_KEY],
    read: r.cacheRead,
  }
}

export function dedupeTurns(records) {
  const turns = new Map()
  let noId = 0
  for (const r of records) turns.set(r.id ? `id:${r.id}` : `n:${noId++}`, r)
  return [...turns.values()]
}
