import React, { useState } from 'react'
import { toCsv, PAGE_TIERS, NEVER_PAGINATE_BELOW } from '../../lib/csv.mjs'

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

/**
 * Paging with a selectable size and a CSV download.
 *
 * Two behaviours that are the point rather than decoration:
 *   · a table shorter than NEVER_PAGINATE_BELOW does not paginate at all — controls on a
 *     nine-row table are friction with no benefit.
 *   · the CSV covers the WHOLE filtered set, not the visible page. Exporting what happens to be
 *     on screen produces a file that silently disagrees with its own row count, which is the
 *     kind of quiet wrongness that gets pasted into a report.
 *
 * @param {object[]} items    already-filtered rows
 * @param {string}   filename download name, without extension
 * @param {string[]} [columns] column order for the CSV; defaults to the union of row keys
 */
export function useTable(items, filename = 'export', columns) {
  const rows = Array.isArray(items) ? items : []
  const [size, setSize] = useState(PAGE_TIERS[0])
  const [page, setPage] = useState(0)
  const paginate = rows.length > NEVER_PAGINATE_BELOW
  const per = paginate ? size : rows.length || 1
  const pages = Math.max(1, Math.ceil(rows.length / per))
  const p = Math.min(page, pages - 1)
  const slice = paginate ? rows.slice(p * per, (p + 1) * per) : rows

  const download = () => {
    const csv = toCsv(rows, columns)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `${filename}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const footer = rows.length === 0 ? null : (
    <div className="pager" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {paginate && (
        <>
          <button className="mini" disabled={p === 0} onClick={() => setPage(p - 1)}>‹ prev</button>
          <span className="pager-info">{p * per + 1}–{Math.min(rows.length, (p + 1) * per)} of {rows.length}</span>
          <button className="mini" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>next ›</button>
          <select value={size} onChange={e => { setSize(Number(e.target.value)); setPage(0) }} title="rows per page">
            {PAGE_TIERS.map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </>
      )}
      {!paginate && <span className="pager-info">{rows.length} row{rows.length === 1 ? '' : 's'}</span>}
      {/* Named with the full count so it is obvious the file is not just this page. */}
      <button className="mini" style={{ marginLeft: 'auto' }} onClick={download}>
        download CSV ({rows.length})
      </button>
    </div>
  )
  return { slice, footer, download, size, setSize }
}
