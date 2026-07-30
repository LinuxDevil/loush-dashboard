import { DEFAULT_PRICE_TABLE, RATE_KEYS, setPriceTable } from '../lib/pricing.mjs'

export const MAX_RULES = 200
const MAX_MATCH_LEN = 200
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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

const payload = meta => {
  const s = stored(meta)
  return {
    rules: s ? s.rules : DEFAULT_PRICE_TABLE,
    source: s ? 'stored' : 'default',
    updatedAt: s?.updatedAt ?? null,
  }
}

export function applyStoredRates(readMeta) {
  const s = stored(readMeta())
  setPriceTable(s ? s.rules : null)
  return s ? 'stored' : 'default'
}

export default function mountPricing(app, { readMeta, writeMeta, onChange } = {}) {
  applyStoredRates(readMeta)

  app.get('/api/pricing', (req, res) => res.json(payload(readMeta())))

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
