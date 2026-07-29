// Human-friendly model names for display.
//
// The dashboard reads raw identifiers out of transcripts — `claude-opus-4-8`,
// `claude-haiku-4-5-20251001`, `claude-opus-4-7[1m]` — and four separate screens had each grown
// the same one-liner to tidy them up: `m.replace(/^claude-/, '')`. That turned
// `claude-haiku-4-5-20251001` into `haiku-4-5-20251001`, which is not an improvement anyone would
// choose; it just happened to be the shortest thing to write inline.
//
// DISPLAY ONLY. The result must never be fed back to an API, used as an object key, compared
// against a stored id, or written into a config file. Raw ids stay raw in the places that edit
// configuration — the pricing rules, the harness model selects, agent frontmatter — because
// those values are data, not labels.

// Only families we can name confidently. Anything else falls through and is returned untouched,
// which is the honest outcome: a local or unreleased model should read as its own id, not as a
// guess at what family it might belong to.
const FAMILIES = { claude: 'Claude', gpt: 'GPT', gemini: 'Gemini' }

// A trailing context-window tag, e.g. the `[1m]` on `claude-opus-4-7[1m]`.
const CTX_TAG = /\[(\d+)([mk])\]$/i
// A dated snapshot suffix: `-20251001`. Carries no information a reader wants in a chart label.
const SNAPSHOT = /^\d{8}$/
const NUMERIC = /^\d+$/

// ponytail: one pass, no per-family grammar. Consecutive all-digit segments dot-join into a
// version and every other segment is capitalised in place, which happens to be correct for
// `claude-opus-4-8`, `claude-3-5-sonnet-20241022` and `gemini-2-5-pro` alike. A family whose
// naming needs more than that gets an entry here, not a parser.
export function modelName(id) {
  if (typeof id !== 'string' || !id.trim()) return id
  // Provider-qualified ids: `anthropic.claude-opus-5`, `us.anthropic.claude-opus-5`,
  // `openai/gpt-4o`. The bare id is always the last segment.
  let s = id.trim().split('/').pop().split('.').pop()

  let suffix = ''
  const ctx = s.match(CTX_TAG)
  if (ctx) {
    suffix = ` (${ctx[1]}${ctx[2].toUpperCase()})`
    s = s.slice(0, ctx.index)
  }

  const parts = s.split('-').filter(Boolean)
  const family = FAMILIES[parts[0]?.toLowerCase()]
  // Unrecognised — including bare tier words like `opus` and local models like `llama3-local`.
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

  // Nothing but the family survived (e.g. a bare `claude`) — the raw id says more.
  return out.length > 1 ? out.join(' ') + suffix : id
}

export default modelName
