import React, { useMemo } from 'react'
import DOMPurify from 'dompurify'
import Markdown from '../../ui/Markdown.jsx'
import { CodeView, DataTable } from '../../ui/viewers.jsx'
import { parseCsvRows } from './csvRows.js'

// Preview of the CURRENT BUFFER, not of the file on disk — the point of a writing surface is seeing
// what you just typed. That also decides how HTML is rendered: the buffer is not on disk, so there
// is no URL to hand an iframe, and it must be sanitised in-process instead.
//
// `.md` goes through src/ui/Markdown.jsx, which is the app's one marked+DOMPurify path. `.html` is
// already HTML, so it skips marked and is sanitised directly. The options below mirror
// Markdown.jsx's — it does not export them and it is not this brief's file to change — and they are
// the load-bearing part: `marked` has not sanitised its output since v5, and raw HTML off disk may
// have been written by an agent that was asked to read a hostile file.
const PURIFY_OPTS = {
  USE_PROFILES: { html: true },
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|ftp|tel|#|\/|\.\/|\.\.\/)/i,
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'script'],
  FORBID_ATTR: ['style', 'srcset', 'formaction', 'form'],
}

export default function DocPreview({ text, ext }) {
  const html = useMemo(
    () => (ext === 'html' || ext === 'htm' ? DOMPurify.sanitize(text, PURIFY_OPTS) : ''),
    [text, ext])
  const rows = useMemo(() => (ext === 'csv' ? parseCsvRows(text) : null), [text, ext])

  if (ext === 'md' || ext === 'markdown') return <Markdown source={text} className="md pad" />
  if (ext === 'html' || ext === 'htm') return <div className="md pad" dangerouslySetInnerHTML={{ __html: html }} />
  if (ext === 'csv') return rows?.length
    ? <DataTable header={rows[0]} rows={rows.slice(1)} />
    : <p className="muted center" style={{ padding: 20 }}>empty csv</p>
  // Nothing to preview beyond the text itself — say so rather than showing an empty pane.
  return <CodeView content={text} ext={ext} />
}
