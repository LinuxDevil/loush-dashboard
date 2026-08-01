// RFC 4180 CSV serialisation, shared by the server's export endpoints and the browser's download
// buttons. It lives in lib/ rather than src/ so there is exactly one escaping implementation.
// Two would drift, and a drifting CSV escaper fails in the worst way available: the file opens
// without complaint in one tool and is silently mis-parsed by another.

const isObj = v => v != null && typeof v === 'object'
export const CSV_EOL = '\r\n' // RFC 4180, and what Excel expects; a bare \n trips some importers.

/**
 * Escape one field.
 *   · nullish and non-finite numbers become empty — a literal "null" or "NaN" is data to a
 *     spreadsheet, not an absence.
 *   · objects are JSON-encoded rather than becoming "[object Object]".
 *   · leading/trailing whitespace forces quoting, because importers otherwise strip it and the
 *     value that comes out is not the value that went in.
 */
export function csvField(value) {
  if (value == null) return ''
  let s
  if (typeof value === 'string') s = value
  else if (typeof value === 'number') s = Number.isFinite(value) ? String(value) : ''
  else if (typeof value === 'boolean' || typeof value === 'bigint') s = String(value)
  else { try { s = JSON.stringify(value) ?? '' } catch { s = '' } }
  if (s === '') return ''
  const needsQuotes = /[",\r\n]/.test(s) || s !== s.trim()
  return needsQuotes ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvRow(cells) {
  return (Array.isArray(cells) ? cells : []).map(csvField).join(',')
}

/**
 * Render rows to CSV.
 * @param {object[]} rows
 * @param {string[]|{columns?:string[], header?:boolean}} [opts]  column order, or an options
 *        object. Columns default to the union of every row's keys in first-seen order, so a
 *        field present on only some rows is never silently dropped.
 */
export function toCsv(rows, opts) {
  const o = Array.isArray(opts) ? { columns: opts } : (isObj(opts) ? opts : {})
  const list = Array.isArray(rows) ? rows : []
  let columns = Array.isArray(o.columns) ? o.columns.filter(c => typeof c === 'string') : []
  if (!columns.length) {
    const seen = [], set = new Set()
    for (const row of list) {
      if (!isObj(row) || Array.isArray(row)) continue
      for (const k of Object.keys(row)) if (!set.has(k)) { set.add(k); seen.push(k) }
    }
    columns = seen
  }
  const lines = []
  if (o.header !== false && columns.length) lines.push(columns.map(csvField).join(','))
  for (const row of list) {
    if (!isObj(row) || Array.isArray(row)) continue
    lines.push(columns.map(c => csvField(row[c])).join(','))
  }
  return lines.join(CSV_EOL) + (lines.length ? CSV_EOL : '')
}

// Progressive page sizes. A short table paginating at all is friction with no benefit, so below
// the floor everything renders; above it the reader steps up rather than being locked to one size.
export const PAGE_TIERS = [10, 25, 50]
export const NEVER_PAGINATE_BELOW = 12
