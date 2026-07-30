// Idempotent progress comments.
//
// Both comment paths in server/eng.mjs post unconditionally, so running a sync twice leaves two
// comments on a real ticket that a real team reads. This makes the operation idempotent by
// carrying identity in the comment itself: an HTML marker naming the ticket and the hash of the
// body that produced it.
//
// Three outcomes, and the third is the one that makes this worth having:
//   · create — no marked comment exists yet
//   · update — one exists and the body changed
//   · skip   — one exists and the body is byte-identical, so editing it would only churn the
//              "edited" timestamp and push a notification at everyone watching
//
// And one refusal. If the existing comments could not be read, the safe move is NOT to post: a
// blind post is exactly the double-post this exists to prevent, and it is outward-facing — other
// people see it. The caller is told why rather than getting a silent duplicate.

import crypto from 'node:crypto'

export const MARKER_PREFIX = 'loush:progress'

/** The six sections, in the order they are rendered. Fixed so a reader learns the shape once. */
export const SECTIONS = [
  ['status', 'Status'],
  ['done', 'Completed'],
  ['inProgress', 'In progress'],
  ['blocked', 'Blocked'],
  ['next', 'Next'],
  ['evidence', 'Evidence'],
]

export const bodyHash = s => crypto.createHash('sha256').update(String(s ?? ''), 'utf8').digest('hex').slice(0, 12)

/** `<!-- loush:progress key=ABC-1 hash=... -->` — the identity a later sync matches on. */
export function buildMarker(key, hash) {
  return `<!-- ${MARKER_PREFIX} key=${String(key || '').replace(/[^\w-]/g, '')} hash=${hash} -->`
}

/**
 * Read a marker out of a comment body. Returns null for anything unmarked, so a human's comment
 * is never mistaken for ours and overwritten.
 */
export function parseMarker(body) {
  // The hash is matched loosely rather than as strict hex. It is only ever compared for equality,
  // and a parser that refuses to recognise a marker it does not like the shape of would report
  // "no existing comment" — which is a double-post, the exact failure this module prevents.
  const m = /<!--\s*loush:progress\s+key=([\w-]*)\s+hash=([\w-]*)\s*-->/i.exec(String(body ?? ''))
  return m ? { key: m[1], hash: m[2] } : null
}

/**
 * Render the fixed six-section body.
 *
 * A section with no content renders as an explicit "none" rather than being dropped. A missing
 * heading and an empty one read identically to a human — both look like the tool had nothing to
 * say — but they mean different things: "nothing is blocked" is information, "we did not check
 * for blockers" is not. Sections given `null` say so.
 */
export function renderProgress(key, data = {}) {
  const lines = [`## Progress — ${key}`, '']
  for (const [field, title] of SECTIONS) {
    lines.push(`### ${title}`)
    const v = data[field]
    if (v == null) lines.push('_not determined_')
    else if (Array.isArray(v)) lines.push(v.length ? v.map(x => `- ${x}`).join('\n') : '_none_')
    else {
      const s = String(v).trim()
      lines.push(s || '_none_')
    }
    lines.push('')
  }
  const body = lines.join('\n').trimEnd()
  return { body, hash: bodyHash(body) }
}

/** A rendered body plus its marker, ready to post. */
export function withMarker(key, data) {
  const { body, hash } = renderProgress(key, data)
  return { body: `${body}\n\n${buildMarker(key, hash)}`, hash }
}

/**
 * Decide what to do given the comments already on the ticket.
 *
 * @param {Array|null} existing  comment list, or null/undefined if they could not be read
 * @param {string} key
 * @param {string} hash          hash of the body about to be posted
 * @param {{idOf?: Function, bodyOf?: Function}} [opts] accessors for the provider's comment shape
 */
export function planSync(existing, key, hash, opts = {}) {
  // Not "no comments" — "we do not know". Posting here is the double-post this module exists to
  // prevent, so it is refused with a reason rather than attempted.
  if (existing == null) return { action: 'refuse', reason: 'existing-comments-unreadable', detail: 'cannot tell whether a progress comment is already there, and posting blind is how duplicates happen' }
  if (!Array.isArray(existing)) return { action: 'refuse', reason: 'existing-comments-unreadable', detail: 'the comment list was not an array' }

  const idOf = opts.idOf || (c => c?.id ?? null)
  const bodyOf = opts.bodyOf || (c => c?.body ?? '')

  const mine = []
  for (const c of existing) {
    const m = parseMarker(bodyOf(c))
    if (m && m.key === String(key)) mine.push({ id: idOf(c), hash: m.hash })
  }
  if (!mine.length) return { action: 'create', reason: 'no-existing-progress-comment' }

  // More than one marked comment means an earlier run posted blind, or someone copied ours. The
  // newest is updated and the rest are named, so the duplicates are visible rather than quietly
  // left behind for a reader to trip over.
  const target = mine[mine.length - 1]
  const duplicates = mine.slice(0, -1).map(x => x.id)

  if (target.hash === hash) {
    return { action: 'skip', reason: 'unchanged', commentId: target.id, duplicates, detail: 'the rendered body is byte-identical — editing would notify watchers for nothing' }
  }
  return { action: 'update', reason: 'changed', commentId: target.id, duplicates, previousHash: target.hash }
}
