// Where the model rate table lives when it is not the code default, and the two routes that
// read and write it.
//
// lib/pricing.mjs is pure and knows nothing about disk. This is the half that does: it reads
// the stored table out of ~/.claude/dashboard-meta.json at boot, hands it to setPriceTable(),
// and hands it over again whenever the user edits it. Code table is the seeded default;
// stored rules, if any, replace it wholesale.
//
// dashboard-meta.json rather than config.json or projects.json: a rate table is per-user
// state, like tags and baselines and pins, not repo configuration and not a credential.
//
// NOT mounted under /api/eng/* — test/server/eng-privacy.test.js bans the field names
// price|pricing|cost|usd|spend on that surface, and rightly so. This is the opposite kind of
// endpoint and belongs on its own path.
import { DEFAULT_PRICE_TABLE, RATE_KEYS, setPriceTable } from '../lib/pricing.mjs'

export const MAX_RULES = 200
const MAX_MATCH_LEN = 200
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// This is a trust boundary: everything below is untrusted input from a PUT body, and a
// malformed rate that gets stored is a wrong dollar figure on every screen until someone
// notices. Reject with a reason rather than coercing — a silently-repaired rate is the same
// class of bug as a silent fallback rate.
const rateSet = (o, where) => {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return `${where} must be an object`
  for (const k of RATE_KEYS) {
    const v = o[k]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return `${where}.${k} must be a finite number >= 0`
  }
  return null
}

export function validateRules(rules) {
  if (!Array.isArray(rules)) return 'rules must be an array'
  if (rules.length > MAX_RULES) return `rules must hold at most ${MAX_RULES} entries`
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i], at = `rules[${i}]`
    if (!r || typeof r !== 'object' || Array.isArray(r)) return `${at} must be an object`
    const hasId = 'id' in r && r.id != null, hasMatch = 'match' in r && r.match != null
    if (hasId === hasMatch) return `${at} must carry exactly one of "id" (exact model id) or "match" (substring)`
    const sel = hasId ? r.id : r.match
    if (typeof sel !== 'string' || !sel.trim() || sel.length > MAX_MATCH_LEN)
      return `${at}.${hasId ? 'id' : 'match'} must be a non-empty string of at most ${MAX_MATCH_LEN} characters`
    const bad = rateSet(r, at)
    if (bad) return bad
    if (r.intro_until != null || r.intro != null) {
      if (typeof r.intro_until !== 'string' || !DATE_RE.test(r.intro_until))
        return `${at}.intro_until must be a YYYY-MM-DD date and is required alongside intro`
      const badIntro = rateSet(r.intro, `${at}.intro`)
      if (badIntro) return badIntro
    }
  }
  return null
}

// Only the fields the pricing module reads are persisted. An editor is free to POST extra
// keys; they are dropped rather than stored, so the file cannot accumulate a second, shadow
// schema that nothing honours.
const pick = r => {
  const out = {}
  if (r.id != null) out.id = r.id; else out.match = r.match
  for (const k of RATE_KEYS) out[k] = r[k]
  if (r.intro_until != null) {
    out.intro_until = r.intro_until
    out.intro = {}
    for (const k of RATE_KEYS) out.intro[k] = r.intro[k]
  }
  return out
}

const stored = meta => {
  const p = meta?.pricing
  return p && Array.isArray(p.rules) && p.rules.length && !validateRules(p.rules) ? p : null
}

// The response body, and the request body for PUT. One shape both ways so an editor can round
// trip what it was given:
//   { rules: [...], source: 'default' | 'stored', updatedAt: <ms epoch> | null }
const payload = meta => {
  const s = stored(meta)
  return {
    rules: s ? s.rules : DEFAULT_PRICE_TABLE,
    source: s ? 'stored' : 'default',
    updatedAt: s?.updatedAt ?? null,
  }
}

// Called at mount and after every successful write. Anything that has already priced entries
// against the old table is stale the moment this runs, which is what onChange is for.
export function applyStoredRates(readMeta) {
  const s = stored(readMeta())
  setPriceTable(s ? s.rules : null)
  return s ? 'stored' : 'default'
}

export default function mountPricing(app, { readMeta, writeMeta, onChange } = {}) {
  applyStoredRates(readMeta)

  app.get('/api/pricing', (req, res) => res.json(payload(readMeta())))

  // PUT { rules: [...] } replaces the table. PUT { rules: null } clears the override and
  // restores the code defaults — the reset button, without a second endpoint.
  app.put('/api/pricing', (req, res) => {
    const rules = req.body?.rules
    const meta = readMeta()
    if (rules === null) {
      delete meta.pricing
    } else {
      const bad = validateRules(rules)
      if (bad) return res.status(400).json({ error: bad })
      if (!rules.length) return res.status(400).json({ error: 'rules must not be empty — send rules: null to reset to defaults' })
      meta.pricing = { rules: rules.map(pick), updatedAt: Date.now() }
    }
    writeMeta(meta)
    applyStoredRates(readMeta)
    onChange?.()
    res.json(payload(readMeta()))
  })
}
