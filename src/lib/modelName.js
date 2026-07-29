
const FAMILIES = { claude: 'Claude', gpt: 'GPT', gemini: 'Gemini' }

const CTX_TAG = /\[(\d+)([mk])\]$/i
const SNAPSHOT = /^\d{8}$/
const NUMERIC = /^\d+$/

// ponytail: one pass, no per-family grammar. Consecutive all-digit segments dot-join into a
export function modelName(id) {
  if (typeof id !== 'string' || !id.trim()) return id
  let s = id.trim().split('/').pop().split('.').pop()

  let suffix = ''
  const ctx = s.match(CTX_TAG)
  if (ctx) {
    suffix = ` (${ctx[1]}${ctx[2].toUpperCase()})`
    s = s.slice(0, ctx.index)
  }

  const parts = s.split('-').filter(Boolean)
  const family = FAMILIES[parts[0]?.toLowerCase()]
  if (!family) return id

  const out = [family]
  let version = []
  for (const p of parts.slice(1)) {
    if (SNAPSHOT.test(p) || p.toLowerCase() === 'latest') continue
    if (NUMERIC.test(p)) { version.push(p); continue }
    if (version.length) { out.push(version.join('.')); version = [] }
    out.push(p.charAt(0).toUpperCase() + p.slice(1))
  }
  if (version.length) out.push(version.join('.'))

  return out.length > 1 ? out.join(' ') + suffix : id
}

export default modelName
