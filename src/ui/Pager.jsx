import React, { useState } from 'react'

export function usePager(items, perPage) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(items.length / perPage))
  const p = Math.min(page, pages - 1)
  const slice = items.slice(p * perPage, (p + 1) * perPage)
  const pager = items.length > perPage ? (
    <div className="pager">
      <button className="mini" disabled={p === 0} onClick={() => setPage(p - 1)}>‹ prev</button>
      <span className="pager-info">{p * perPage + 1}–{Math.min(items.length, (p + 1) * perPage)} of {items.length}</span>
      <button className="mini" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>next ›</button>
    </div>
  ) : null
  return { slice, pager }
}
