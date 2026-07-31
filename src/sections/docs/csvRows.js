// RFC 4180 CSV → rows, the exact inverse of `csvField` in lib/csv.mjs (doubled `""` is one literal
// quote; `,` and newlines inside quotes are data). lib/csv.mjs is the serialiser and has no parser,
// and it is not this brief's file to extend, so the reader lives here — next to its only caller —
// with its escaping rules pinned to that one implementation rather than invented afresh.

/** @returns {string[][]} rows, ragged rows included; a trailing newline does not add an empty row. */
export function parseCsvRows(text) {
  const rows = []
  let row = [], cur = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') { cur += c; continue }
      if (text[i + 1] === '"') { cur += '"'; i++ } else quoted = false
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (c !== '\r') cur += c
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows.filter(r => r.length > 1 || r[0] !== '')
}
