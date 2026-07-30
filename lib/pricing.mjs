
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
  { match: 'claude-sonnet-4-5', from: '2025-09-29', in: 3, out: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },
  { match: 'claude-opus-4-1', from: '2025-08-05', in: 15, out: 75, cacheRead: 1.5, cacheWrite5m: 18.75, cacheWrite1h: 30 },
  { match: 'claude-haiku-4-5', from: '2025-10-01', in: 1, out: 5, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 },
  // `from` is the date a rate can first apply, set only where the model id itself carries the
  // snapshot date or the release is unambiguous. A GUESSED `from` would push real spend into
  // "unpriced" and quietly shrink a total — worse than having no window at all.
  // Older generations still appear in historical transcripts. Without them every past turn on
  // these models prices as unknown, and an unpriced turn drops out of a total that then reads as
  // complete — the exact understatement this table exists to prevent.
  { match: 'claude-3-5-haiku', in: 0.8, out: 4, cacheRead: 0.08, cacheWrite5m: 1, cacheWrite1h: 1.6 },
  { match: 'claude-3-5-sonnet', in: 3, out: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },
  { match: 'claude-3-opus', in: 15, out: 75, cacheRead: 1.5, cacheWrite5m: 18.75, cacheWrite1h: 30 },
]

let TABLE = DEFAULT_PRICE_TABLE

export const setPriceTable = rules => { TABLE = Array.isArray(rules) && rules.length ? rules : DEFAULT_PRICE_TABLE }
export const getPriceTable = () => TABLE

const utcDay = at => { const d = new Date(at); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) }

/** The matching table rule, before any intro-window substitution — so a caller can ask about the
 * rule's own metadata (validity window) rather than only its numbers. */
export const ruleFor = model => {
  if (typeof model !== 'string' || !model) return null
  for (const r of TABLE) if (r.id === model) return r
  for (const r of TABLE) if (r.match && model.includes(r.match)) return r
  return null
}

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

/**
 * Token counts from either shape this repo carries: a raw transcript `usage` block, or the short
 * form collectUsage stores (`in`/`out`/`cr`/`cc`). One normaliser rather than two call sites each
 * guessing, because the two shapes disagree about names for the same number.
 *
 * `cacheWriteSplit` records whether the 5m/1h split was OBSERVED. That distinction is the whole
 * reason this returns an object: an assumed split and a measured one produce the same numbers and
 * are not the same claim.
 */
export function normalizeTokens(entry) {
  if (!entry || typeof entry !== 'object') return null
  const isNum = v => typeof v === 'number' && Number.isFinite(v) && v >= 0
  const n = v => (isNum(v) ? v : 0)
  const u = entry.usage && typeof entry.usage === 'object' ? entry.usage : entry
  const cc = u.cache_creation
  const has5m = cc && isNum(cc.ephemeral_5m_input_tokens)
  const has1h = cc && isNum(cc.ephemeral_1h_input_tokens)
  const totalWrite = isNum(u.cache_creation_input_tokens) ? u.cache_creation_input_tokens : n(entry.cc)
  return {
    input: isNum(u.input_tokens) ? u.input_tokens : n(entry.in),
    output: isNum(u.output_tokens) ? u.output_tokens : n(entry.out),
    cacheRead: isNum(u.cache_read_input_tokens) ? u.cache_read_input_tokens : n(entry.cr),
    cacheWrite: n(totalWrite),
    cacheWrite5m: has5m ? cc.ephemeral_5m_input_tokens : (isNum(entry.cc5) ? entry.cc5 : null),
    cacheWrite1h: has1h ? cc.ephemeral_1h_input_tokens : (isNum(entry.cc1h) ? entry.cc1h : null),
    cacheWriteSplit: !!(has5m || has1h || isNum(entry.cc5) || isNum(entry.cc1h)),
  }
}

/**
 * Cost of one entry, as a RESULT rather than a number.
 *
 * `entryCost` above returns a bare number and yields 0 for a model with no rate, which is only
 * safe because its callers check `rateFor` themselves first. That is a footgun to hand anyone
 * else: an unpriced turn and a genuinely free turn are indistinguishable in a bare 0, and they
 * sum into a total that looks measured. This returns `cost: null` plus a `reason` instead, and
 * flags `estimated` when the cache-write tier had to be assumed rather than read.
 */
export function priceEntry(entry, opts = {}) {
  const tokens = normalizeTokens(entry)
  if (!tokens) return { ok: false, cost: null, reason: 'no-entry', estimated: false, assumptions: [], rate: null, model: null }
  const at = opts.at ?? entry?.t ?? entry?.timestamp ?? null
  const model = opts.model ?? entry?.model ?? entry?.message?.model ?? null
  if (!model) return { ok: false, cost: null, reason: 'no-model', estimated: false, assumptions: [], rate: null, model: null }

  let rule = ruleFor(model)
  let familyGuess = null
  if (!rule && opts.allowFamilyFallback) {
    // Opt-in only. Guessing a rate from the family name is defensible when a caller has asked for
    // a best-effort total and knows what it is getting; it is NOT defensible as a default, which
    // is why rateFor still returns null and this never fires unless requested. The result is
    // flagged estimated so a guess cannot be mistaken for a table hit.
    const fam = /opus/i.test(model) ? 'opus' : /sonnet/i.test(model) ? 'sonnet' : /haiku/i.test(model) ? 'haiku' : /fable/i.test(model) ? 'fable' : null
    if (fam) { rule = TABLE.find(r => typeof r.match === 'string' && r.match.includes(fam)) || null; if (rule) familyGuess = fam }
  }
  if (!rule) return { ok: false, cost: null, reason: 'unknown-model', estimated: false, assumptions: [], rate: null, model }
  // A rule can carry a start date. An entry from before it is not priceable at that rule's rate,
  // and is a DIFFERENT failure from "we have never heard of this model" — one means the table is
  // incomplete, the other means the entry predates what the table can speak to.
  if (rule.from && at != null) {
    const day = utcDay(at)
    if (day && day < rule.from) return { ok: false, cost: null, reason: 'no-rate-at-time', estimated: false, assumptions: [], rate: null, model, at }
  }
  if (rule.from && at == null) return { ok: false, cost: null, reason: 'unknown-time', estimated: false, assumptions: [], rate: null, model }
  const r = familyGuess ? rule : rateFor(model, at)
  if (r == null) return { ok: false, cost: null, reason: 'unknown-model', estimated: false, assumptions: [], rate: null, model }

  const assumptions = []
  if (familyGuess) {
    // maxUnderstatementUsd is 0 because the direction of a family guess is unknown — it may
    // overstate as readily as understate. Claiming a bound would invent precision.
    assumptions.push({ field: 'rate', assumed: `${familyGuess}-family`, why: `"${model}" is not in the price table; the ${familyGuess} family rate was used because the caller opted into a family fallback`, maxUnderstatementUsd: 0 })
  }
  let w5 = tokens.cacheWrite5m ?? 0
  let w1h = tokens.cacheWrite1h ?? 0
  if (!tokens.cacheWriteSplit && tokens.cacheWrite > 0) {
    // No observed split, so a tier has to be picked and the two tiers bill differently. The choice
    // is named AND the size of the possible error is computed, because "estimated" without a
    // magnitude tells a reader to distrust the number without telling them by how much.
    const cheap = Math.min(r.cacheWrite5m, r.cacheWrite1h)
    const dear = Math.max(r.cacheWrite5m, r.cacheWrite1h)
    if (UNTIERED_KEY === 'cacheWrite1h') { w1h = tokens.cacheWrite; w5 = 0 } else { w5 = tokens.cacheWrite; w1h = 0 }
    const chosen = UNTIERED_KEY === 'cacheWrite1h' ? r.cacheWrite1h : r.cacheWrite5m
    assumptions.push({
      field: 'cacheWriteTier',
      assumed: UNTIERED_CACHE_WRITE_TIER,
      why: 'the entry reports a cache-write total with no 5m/1h split, so a tier had to be chosen',
      maxUnderstatementUsd: (tokens.cacheWrite * (chosen === cheap ? dear - cheap : 0)) / 1e6,
    })
  }
  const cost = (tokens.input * r.in + tokens.output * r.out + tokens.cacheRead * r.cacheRead
    + w5 * r.cacheWrite5m + w1h * r.cacheWrite1h) / 1e6
  return { ok: true, cost, reason: null, estimated: assumptions.length > 0, assumptions, rate: r, model, tokens }
}

export function dedupeTurns(records) {
  const turns = new Map()
  let noId = 0
  for (const r of records) turns.set(r.id ? `id:${r.id}` : `n:${noId++}`, r)
  return [...turns.values()]
}
