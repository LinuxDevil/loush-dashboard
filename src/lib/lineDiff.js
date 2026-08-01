// src/lib/lineDiff.js — line diff for the viewer's Diff mode (feature 073) and the EditorHost
// `diff` contract member (feature 076).
//
// Two rules shape every decision in here:
//
//   * Unknown is a value. If either side is missing we return `hunks: null` plus a `reason`. We do NOT
//     treat a missing baseline as an empty file — that renders as "every line added", which reads as a
//     real diff and is the single most misleading thing this module could do.
//   * No silent caps. Both limits below (line count, DP cell budget) are reported on the result so the
//     UI can print them. A diff that quietly stops at line 4000 tells the user "no further changes".

export const DIFF_MAX_LINES = 4000
// Full LCS is O(n·m). 1M cells is ~8MB of Int32 and a few tens of ms — past that we degrade to a
// coarse diff rather than freezing the tab, and we say so.
export const DIFF_MAX_CELLS = 1_000_000

const splitLines = s => (s === '' ? [] : s.split('\n'))

/**
 * @param {string|null|undefined} before
 * @param {string|null|undefined} after
 * @returns {{
 *   hunks: Array<{type:'same'|'add'|'del', beforeLine:number|null, afterLine:number|null, text:string}>|null,
 *   reason: string|null,
 *   stats: {added:number, removed:number, unchanged:number}|null,
 *   truncated: {beforeShown:number, beforeTotal:number, afterShown:number, afterTotal:number, limit:number}|null,
 *   degraded: {reason:string}|null,
 * }}
 */
export function computeLineDiff(before, after, opts = {}) {
  const maxLines = Number.isFinite(opts.maxLines) && opts.maxLines > 0 ? Math.floor(opts.maxLines) : DIFF_MAX_LINES
  const maxCells = Number.isFinite(opts.maxCells) && opts.maxCells > 0 ? Math.floor(opts.maxCells) : DIFF_MAX_CELLS
  const none = reason => ({ hunks: null, reason, stats: null, truncated: null, degraded: null })

  // Unknown is a value: no baseline is not "empty baseline".
  if (typeof before !== 'string') return none('no baseline to diff against — nothing has been saved or loaded for this file yet')
  if (typeof after !== 'string') return none('no current content to diff — the editor has not reported its buffer yet')

  let a = splitLines(before)
  let b = splitLines(after)
  const aTotal = a.length, bTotal = b.length
  let truncated = null
  if (aTotal > maxLines || bTotal > maxLines) {
    a = a.slice(0, maxLines)
    b = b.slice(0, maxLines)
    truncated = { beforeShown: a.length, beforeTotal: aTotal, afterShown: b.length, afterTotal: bTotal, limit: maxLines }
  }

  // Trim the identical head and tail first. Real edits touch a few lines in a big file, so this alone
  // usually drops the DP region small enough to stay under the cell budget.
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const aMid = a.slice(head, a.length - tail)
  const bMid = b.slice(head, b.length - tail)

  const hunks = []
  const push = (type, ai, bi, text) => hunks.push({ type, beforeLine: ai, afterLine: bi, text })
  for (let i = 0; i < head; i++) push('same', i + 1, i + 1, a[i])

  let degraded = null
  if (aMid.length * bMid.length > maxCells) {
    // Over budget: report the whole changed region as one delete-then-add block. It is still true —
    // those lines did change — but it is coarser than the user expects, so we name that on the result.
    degraded = { reason: `changed region is ${aMid.length}×${bMid.length} lines, over the ${maxCells.toLocaleString()}-cell diff budget — showing it as one replaced block instead of line-by-line` }
    for (let i = 0; i < aMid.length; i++) push('del', head + i + 1, null, aMid[i])
    for (let j = 0; j < bMid.length; j++) push('add', null, head + j + 1, bMid[j])
  } else {
    for (const op of lcsOps(aMid, bMid)) {
      if (op.type === 'same') push('same', head + op.ai + 1, head + op.bi + 1, aMid[op.ai])
      else if (op.type === 'del') push('del', head + op.ai + 1, null, aMid[op.ai])
      else push('add', null, head + op.bi + 1, bMid[op.bi])
    }
  }

  for (let i = 0; i < tail; i++) {
    const ai = a.length - tail + i, bi = b.length - tail + i
    push('same', ai + 1, bi + 1, a[ai])
  }

  const stats = { added: 0, removed: 0, unchanged: 0 }
  for (const h of hunks) stats[h.type === 'add' ? 'added' : h.type === 'del' ? 'removed' : 'unchanged']++
  return { hunks, reason: null, stats, truncated, degraded }
}

/** Classic LCS backtrack. Only ever called on a region already checked against the cell budget. */
function lcsOps(a, b) {
  const n = a.length, m = b.length
  const w = m + 1
  const dp = new Int32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
  const ops = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: 'same', ai: i, bi: j }); i++; j++ }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { ops.push({ type: 'del', ai: i, bi: null }); i++ }
    else { ops.push({ type: 'add', ai: null, bi: j }); j++ }
  }
  while (i < n) ops.push({ type: 'del', ai: i++, bi: null })
  while (j < m) ops.push({ type: 'add', ai: null, bi: j++ })
  return ops
}

/** One-line human summary. Returns the reason verbatim when there is no diff to summarise. */
export function summariseDiff(d) {
  if (!d || !d.hunks) return d?.reason || 'no diff available'
  const parts = [`+${d.stats.added}`, `−${d.stats.removed}`]
  if (d.truncated) parts.push(`first ${d.truncated.limit} lines only (of ${Math.max(d.truncated.beforeTotal, d.truncated.afterTotal)})`)
  if (d.degraded) parts.push('coarse')
  return parts.join(' · ')
}
