import React, { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// One markdown renderer for the whole app, and the only place `dangerouslySetInnerHTML` is
// allowed to touch markdown.
//
// Every call site previously did `dangerouslySetInnerHTML={{ __html: marked.parse(x) }}`, which
// is an XSS sink: marked has not sanitised its output since v5 — the `sanitize` option was
// removed precisely so people would stop assuming it did. That was live on five surfaces, and
// two of them render content nobody here authored:
//
//   · ChatSection renders MODEL OUTPUT. A model can be steered into emitting
//     `<img src=x onerror=...>`, and the payload need only appear in a file it was asked to read.
//   · viewers.jsx renders arbitrary .md files off disk, including ones an agent just wrote.
//
// The fix is DOMPurify rather than a hand-written sanitiser. Sanitising HTML correctly means
// staying ahead of mXSS, namespace confusion and parser round-trip bugs; a bespoke allowlist
// written here would look fine and fail quietly on exactly the input that matters.
//
// `marked` still does the markdown→HTML step. DOMPurify then removes anything that could
// execute, so a malicious document renders as inert text instead of running.

// Links are the one thing that survives sanitising and still surprises people: an <a> that opens
// in a new tab gets `window.opener` access to this page unless it is told not to. This runs once,
// at module load, on the shared DOMPurify instance.
if (typeof window !== 'undefined') {
  DOMPurify.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

const OPTIONS = {
  // Explicit, rather than trusting the default profile to stay as it is across upgrades.
  USE_PROFILES: { html: true },
  // Data URIs are a script vector via SVG, and this app never legitimately needs one inline.
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|ftp|tel|#|\/|\.\/|\.\.\/)/i,
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'script'],
  FORBID_ATTR: ['style', 'srcset', 'formaction', 'form'],
}

export function sanitizeMarkdown(src) {
  if (typeof src !== 'string' || !src) return ''
  let html
  // A parse failure must not take the surrounding screen down with it — markdown here can come
  // from a half-written file an agent is still producing.
  try { html = marked.parse(src) } catch { return '' }
  return DOMPurify.sanitize(html, OPTIONS)
}

/**
 * Renders markdown as sanitised HTML.
 * @param {string} source   markdown text; treated as untrusted regardless of where it came from
 * @param {string} className  wrapper class, defaults to the app's `md` styling
 */
export default function Markdown({ source, className = 'md', style }) {
  const html = useMemo(() => sanitizeMarkdown(source), [source])
  return <div className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />
}
