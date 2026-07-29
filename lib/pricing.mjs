// Model pricing. Kept apart from server/index.mjs so it can be exercised directly by tests —
// a silent error here is invisible in the UI but wrong on every dollar figure in the product.
//
// This module is PURE: no fs, no network, no clock of its own. The server injects the user's
// edited table with setPriceTable() after reading it off disk; tests import this file directly.
//
// Every rate is USD per 1,000,000 tokens OF THAT CATEGORY. The five categories are listed per
// model rather than derived from the input rate. The previous implementation derived them
// (output 5x, cache-write 1.25x, cache-read 0.1x) and the cache-write ratio is only right for
// the 5-minute tier — the 1-hour tier is 2x input, not 1.25x. Since 61.9% of cache-creation
// tokens in the transcripts this was written against are 1-hour, the derived model understated
// total spend by ~10%.
//
// Rates below are the published Anthropic list prices as of 2026-07-29. A model with no rule
// here prices as null, on purpose — see PRICE_PER_M.

export const RATE_KEYS = ['in', 'out', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h']

// A rule matches a model id by exact `id` or by substring `match`. Resolution order, first
// match wins:
//   1. every rule carrying an `id`, in table order — string equality
//   2. every rule carrying a `match`, in table order — substring test
// Exact-before-substring means one dated snapshot can be given its own rate without having to
// be hoisted above a generic rule, and a generic rule can never shadow a specific one.
//
// Substring rather than regex: this table crosses a trust boundary (PUT /api/pricing) and a
// user-supplied regex is a ReDoS surface for no expressive gain. The old table's /opus/,
// /sonnet/ etc. were substring tests in all but name — and were the bug: /opus/ priced
// opus-4-8 and opus-5 identically, /sonnet/ collapsed sonnet-5 and sonnet-4-6. The `match`
// values below are full aliases, so `claude-haiku-4-5` still catches the dated
// `claude-haiku-4-5-20251001` while `claude-opus-4-8` cannot catch `claude-opus-4-7`.
//
// intro_until (YYYY-MM-DD, UTC, inclusive) + intro rates express time-limited introductory
// pricing: usage on or before that day prices at the intro rate, after it at the standard
// rate. Each day's usage is therefore priced at the rate in effect on that day, which is
// correct for historical records and stays correct as the cutoff passes.
// ponytail: one cutoff per rule, not a general rate history. A second price change means a
// second rule with a date range — upgrade to an array of {from, to, rates} if that day comes.
export const DEFAULT_PRICE_TABLE = [
  { match: 'claude-fable-5', in: 10, out: 50, cacheRead: 1, cacheWrite5m: 12.5, cacheWrite1h: 20 },
  { match: 'claude-opus-5', in: 5, out: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  { match: 'claude-opus-4-8', in: 5, out: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  // Not present in the transcripts this table was measured against, but the app's own Run Claude
  // model picker offers Opus 4.7 — without a rule here a session spawned from this dashboard
  // would price as unpriced, i.e. $0, which reads on screen as "free" rather than "no rate".
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

// The injection point. The server calls this once at boot with whatever the user has stored,
// and again on every edit. Passing null/[] restores the code defaults rather than leaving the
// product with no rates at all, so a cleared table reads as "reset", never as "$0".
export const setPriceTable = rules => { TABLE = Array.isArray(rules) && rules.length ? rules : DEFAULT_PRICE_TABLE }
export const getPriceTable = () => TABLE

const utcDay = at => { const d = new Date(at); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) }

// The rate set in effect for `model` at time `at` (ms epoch / Date / ISO), or null if we hold
// no rate for it. An absent `at` prices at the standard rate — the rate that is in effect for
// every day except a bounded window in the past, and the one that will still be in effect
// tomorrow. It is a choice, not a coincidence: guessing the intro rate would silently
// under-bill anything whose timestamp we lost.
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

// null, not a default. The previous implementation fell through to Sonnet's rate for anything
// it did not recognise, so a local model or a newly released one was billed at $3/M without
// anything on screen saying so.
//
// This returns the INPUT rate — the base figure, kept for callers that reason about the price
// of a token in the abstract. Anything computing an actual cost should use entryCost, which
// applies all five categories.
export const PRICE_PER_M = (model, at) => rateFor(model, at)?.in ?? null

export const isPriced = model => PRICE_PER_M(model) != null

// Where a usage record carries no cache-creation tier breakdown, its whole cache-creation
// total is attributed to this tier. This is not a guess about the data: it is exactly what
// this file did before tiers existed, so pre-tier callers and fixtures keep their previous
// numbers to the cent. Measured across all 894 transcripts on the machine this was written
// for, it fired on 0 of 31,162 records — every one carries
// usage.cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens. FALLBACKS counts every time
// it does fire, so "we assumed" can never be read off a screen as "we measured".
export const UNTIERED_CACHE_WRITE_TIER = '5m'
const UNTIERED_KEY = UNTIERED_CACHE_WRITE_TIER === '1h' ? 'cacheWrite1h' : 'cacheWrite5m'
export const FALLBACKS = { untieredCacheWrite: 0 }

// Split a cache-creation total into its 5m / 1h parts. `five` and `oneHour` are whatever the
// caller has — either number present means the record is tiered and the pair is authoritative
// (verified: flat total === 5m + 1h on 31,162 of 31,162 records). Neither present means the
// documented fallback above, counted.
export function splitCacheWrite(total, five, oneHour) {
  const t = total || 0
  if (typeof five === 'number' || typeof oneHour === 'number') return { cc5: five || 0, cc1h: oneHour || 0 }
  if (t > 0) FALLBACKS.untieredCacheWrite++
  return UNTIERED_KEY === 'cacheWrite1h' ? { cc5: 0, cc1h: t } : { cc5: t, cc1h: 0 }
}

// An unpriced model contributes 0 rather than NaN, which would poison every downstream sum.
// Callers are expected to surface the unpriced model list alongside the total so a reader can
// tell "nothing was spent" apart from "we hold no rate for this".
export const entryCost = e => {
  const r = rateFor(e.model, e.t)
  if (r == null) return 0
  const { cc5, cc1h } = splitCacheWrite(e.cc, e.cc5, e.cc1h)
  return ((e.in || 0) * r.in + (e.out || 0) * r.out + (e.cr || 0) * r.cacheRead
    + cc5 * r.cacheWrite5m + cc1h * r.cacheWrite1h) / 1e6
}

// The cache-write and cache-read $/M that applied to one entry — the write rate blended across
// whatever tier split the entry actually carries. For callers reasoning about the gap between
// writing the cache and reading it (lib/harness-usage-trends.mjs) rather than about a total.
// An entry with no tier fields uses the same tier entryCost would have used; the fallback
// counter is deliberately not touched here, so one entry can never be counted twice.
// Unpriced → zeros, the same "we hold no rate" escape hatch as entryCost.
export const entryCacheRates = e => {
  const r = rateFor(e.model, e.t)
  if (r == null) return { write: 0, read: 0 }
  const c5 = e.cc5 || 0, c1h = e.cc1h || 0, tot = c5 + c1h
  return {
    write: tot ? (c5 * r.cacheWrite5m + c1h * r.cacheWrite1h) / tot : r[UNTIERED_KEY],
    read: r.cacheRead,
  }
}

// A streaming assistant turn is appended to the transcript repeatedly as it grows, and every
// one of those records carries the same message.id with cumulative usage numbers. Folding them
// all in counts the same turn many times over — measured across real transcripts, 47.8% of
// usage records were repeats and the cost total came out 2.12x high.
//
// Keeps the last record per id (it holds that turn's final numbers) while preserving the
// position of the first sighting, so chronological order survives without a re-sort. Records
// with no id cannot be grouped and are each kept on their own key rather than collapsing
// unrelated turns together.
export function dedupeTurns(records) {
  const turns = new Map()
  let noId = 0
  for (const r of records) turns.set(r.id ? `id:${r.id}` : `n:${noId++}`, r)
  return [...turns.values()]
}
