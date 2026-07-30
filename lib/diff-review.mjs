// lib/diff-review.mjs — snapshot-before-edit, then accept/reject the resulting diff.
//
// WHAT THIS IS
// A tag store. A "tag" is a pending review: {file, original, latest}. Something (a PreToolUse hook,
// a file watcher, or the editor's open event) hands us the file's content BEFORE an agent writes it;
// something hands us the content AFTER; the human sees one diff and says accept or reject.
//
// THE THREE WAYS THIS GOES WRONG, AND WHAT WE DO ABOUT THEM
//
// 1. TWO PENDING TAGS FOR ONE FILE. If a second snapshot opens a second review while the first is
//    still pending, two reviewers hold two different "originals" for the same path. Accept one and
//    reject the other and the file lands in a state neither reviewer looked at; reject both and the
//    second write wins silently. So: at most one pending review per file, enforced in `snapshot`.
//
// 2. CONSECUTIVE EDITS STACKING. An agent that edits one file five times in a turn must produce ONE
//    review (original → latest), not five. Five stacked reviews mean the human approves change 3
//    against a base that no longer exists, and "reject" on any but the last is meaningless. So:
//    `recordEdit` coalesces into the open review, keeping the FIRST original and the LAST content.
//
// 3. REJECT DESTROYING A LATER CHANGE. Reject means "write `original` back". If the file on disk is
//    no longer what we showed in the diff — the user saved in their editor, a formatter ran, another
//    agent wrote — then writing `original` back silently deletes work that was never reviewed. This
//    is the only operation here that can lose data, so it is the only one that refuses: we compare
//    the current disk content against the `latest` we presented, and on mismatch we return
//    {ok:false, reason} and write NOTHING. Overriding is an explicit, separately-named argument.
//
// DEGRADED MODE
// With a PreToolUse hook we observe the true pre-edit content. Without hooks the best available
// "original" is whatever we last snapshotted — on file-open, or at the last accepted review — and
// between then and now anything could have happened. That original is a GUESS. Every review carries
// `degraded` and `originalConfidence` ('observed' | 'inferred' | 'unknown') plus a reason, and the
// UI is expected to say so, because "reject and restore the original" means something much weaker
// when the original is inferred.

import fsDefault from 'node:fs'
import { createHash } from 'node:crypto'

export const CONFIDENCE = { OBSERVED: 'observed', INFERRED: 'inferred', UNKNOWN: 'unknown' }
// Bound on content we hash/diff per file. Reported on the review, never silent: a 40MB minified
// bundle would otherwise stall the diff and the human would see a spinner, not a cap.
export const MAX_CONTENT_BYTES = 4_000_000
// Bound on diff hunks returned. Reported.
export const MAX_DIFF_LINES = 4000

const sha = s => createHash('sha256').update(s == null ? '\0null' : String(s)).digest('hex').slice(0, 16)

/**
 * @param {object} [io]
 * @param {(p:string)=>(string|null)} [io.readFile] returns null when the file does not exist
 * @param {(p:string,c:string)=>void}  [io.writeFile]
 * @param {()=>number} [io.now]
 * @param {'hooks'|'degraded'} [io.mode] whether a pre-edit hook is actually installed
 */
export function createDiffReviewStore(io = {}) {
  const readFile = io.readFile || (p => { try { return fsDefault.readFileSync(p, 'utf8') } catch { return null } })
  const writeFile = io.writeFile || ((p, c) => fsDefault.writeFileSync(p, c))
  const now = io.now || (() => Date.now())
  // Default is 'degraded'. Claiming hook-grade confidence we have not been told we have would make
  // every `originalConfidence: 'observed'` a lie by default — the exact failure this field exists
  // to prevent.
  const mode = io.mode === 'hooks' ? 'hooks' : 'degraded'

  const pendingByFile = new Map() // file -> review
  const resolved = []             // accepted/rejected, newest last
  const baseline = new Map()      // file -> {content, at, source} — last content we believe is agreed
  let seq = 0

  const cap = content => {
    if (typeof content !== 'string') return { content: null, capped: null }
    if (content.length <= MAX_CONTENT_BYTES) return { content, capped: null }
    return { content: content.slice(0, MAX_CONTENT_BYTES), capped: { droppedChars: content.length - MAX_CONTENT_BYTES, limit: MAX_CONTENT_BYTES, note: 'content truncated for review; the diff below is NOT the whole file' } }
  }

  const view = r => r && ({
    id: r.id, file: r.file, status: r.status,
    originalHash: r.original == null ? null : sha(r.original),
    latestHash: r.latest == null ? null : sha(r.latest),
    originalConfidence: r.originalConfidence,
    originalConfidenceReason: r.originalConfidenceReason,
    degraded: r.degraded,
    degradedReason: r.degradedReason,
    coalescedEdits: r.coalescedEdits,
    editLines: r.editLines,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
    caps: r.caps,
    isNewFile: r.original == null,
  })

  /**
   * Record the pre-edit content of a file and open (or join) a pending review.
   * `via`: 'hook' (true pre-edit content), 'open' (file-open snapshot), 'accept' (post-accept
   * baseline), 'watcher' (we noticed a change and are reconstructing).
   */
  function snapshot(file, content, opts = {}) {
    if (typeof file !== 'string' || !file) return { ok: false, reason: 'snapshot requires a non-empty file path' }
    const via = opts.via || (mode === 'hooks' ? 'hook' : 'open')
    const { content: c, capped } = cap(content == null ? null : String(content))

    const existing = pendingByFile.get(file)
    if (existing) {
      // RULE 1: never a second pending review for the same file. The first original is the one the
      // human is being shown, and it is the older, safer restore point — keep it.
      return {
        ok: true,
        coalesced: true,
        reviewId: existing.id,
        review: view(existing),
        reason: `a pending review (${existing.id}) already covers ${file}; kept its original snapshot rather than opening a second review with a different "original"`,
      }
    }

    const r = {
      id: `rev-${++seq}`,
      file,
      original: c,
      latest: c,
      status: 'pending',
      coalescedEdits: 0,
      editLines: [],
      createdAt: now(), updatedAt: now(),
      caps: capped ? { original: capped } : {},
      ...confidenceFor(via),
    }
    pendingByFile.set(file, r)
    return { ok: true, coalesced: false, reviewId: r.id, review: view(r) }
  }

  function confidenceFor(via) {
    if (via === 'hook') return { degraded: false, degradedReason: null, originalConfidence: CONFIDENCE.OBSERVED, originalConfidenceReason: 'captured by a pre-edit hook — this is the exact content the agent overwrote' }
    if (via === 'open' || via === 'accept') return { degraded: true, degradedReason: 'no pre-edit hook installed — running in degraded (file-open / post-accept snapshot) mode', originalConfidence: CONFIDENCE.INFERRED, originalConfidenceReason: `original is the last content we snapshotted (via ${via}); anything that changed the file between that snapshot and the agent's edit is already folded into this diff and is NOT distinguishable from the agent's work` }
    return { degraded: true, degradedReason: 'change detected after the fact with no prior snapshot', originalConfidence: CONFIDENCE.UNKNOWN, originalConfidenceReason: 'we never saw this file before it changed — there is no original to restore. Reject is unavailable for this review.' }
  }

  /**
   * Record post-edit content. RULE 2: coalesces into the open review for this file, so N consecutive
   * edits produce ONE original→latest diff.
   */
  function recordEdit(file, content, opts = {}) {
    if (typeof file !== 'string' || !file) return { ok: false, reason: 'recordEdit requires a non-empty file path' }
    const { content: c, capped } = cap(content == null ? null : String(content))
    let r = pendingByFile.get(file)
    if (!r) {
      // No pending review: either the first edit under hooks (snapshot should have run — say so) or
      // degraded mode noticing a change. Fall back to the last known baseline as the original, and
      // label the confidence honestly rather than presenting the baseline as observed truth.
      const base = baseline.get(file)
      const via = base ? 'watcher-baseline' : 'watcher'
      r = {
        id: `rev-${++seq}`, file,
        original: base ? base.content : null,
        latest: c, status: 'pending', coalescedEdits: 0, editLines: [],
        createdAt: now(), updatedAt: now(), caps: capped ? { latest: capped } : {},
        ...(base
          ? { degraded: true, degradedReason: `no pre-edit snapshot for ${file}; used the last accepted baseline as the original`, originalConfidence: CONFIDENCE.INFERRED, originalConfidenceReason: `original is the baseline recorded at ${base.at} via ${base.source}, not observed pre-edit content` }
          : confidenceFor('watcher')),
      }
      pendingByFile.set(file, r)
      return { ok: true, coalesced: false, reviewId: r.id, review: view(r), reason: base ? 'opened a review from the last accepted baseline' : 'opened a review with NO original — reject cannot restore this file' }
    }
    r.latest = c
    r.coalescedEdits++
    r.updatedAt = now()
    if (opts.line != null) r.editLines.push(opts.line)
    if (capped) r.caps.latest = capped
    return { ok: true, coalesced: true, reviewId: r.id, review: view(r), reason: `coalesced into the existing pending review for ${file}: one original→latest diff, not ${r.coalescedEdits + 1} stacked reviews` }
  }

  function pending(file) { return view(pendingByFile.get(file)) || null }
  function listPending() { return [...pendingByFile.values()].map(view) }
  function history() { return resolved.map(r => ({ ...view(r), resolvedAt: r.resolvedAt, resolution: r.resolution })) }
  function get(id) {
    const r = [...pendingByFile.values(), ...resolved].find(x => x.id === id)
    return r ? view(r) : null
  }

  /** The reviewable diff: original → latest, as one unit. */
  function diff(id) {
    const r = [...pendingByFile.values(), ...resolved].find(x => x.id === id)
    if (!r) return { ok: false, reason: `no review with id ${id}` }
    const d = lineDiff(r.original ?? '', r.latest ?? '')
    return {
      ok: true, id: r.id, file: r.file,
      hunks: d.hunks, added: d.added, removed: d.removed,
      caps: { ...(d.capped ? { diff: d.capped } : {}), ...r.caps },
      degraded: r.degraded, degradedReason: r.degradedReason,
      originalConfidence: r.originalConfidence, originalConfidenceReason: r.originalConfidenceReason,
      coalescedEdits: r.coalescedEdits,
      isNewFile: r.original == null,
    }
  }

  /** Accept: keep `latest` and make it the new baseline (this is also the degraded-mode re-snapshot). */
  function accept(id) {
    const r = pendingByFile.get(fileOf(id))
    if (!r || r.id !== id) return { ok: false, reason: `no pending review with id ${id}` }
    pendingByFile.delete(r.file)
    r.status = 'accepted'; r.resolution = 'accepted'; r.resolvedAt = now()
    resolved.push(r)
    baseline.set(r.file, { content: r.latest, at: r.resolvedAt, source: 'accepted-review' })
    return { ok: true, id: r.id, file: r.file, status: 'accepted', newBaselineHash: r.latest == null ? null : sha(r.latest), degraded: r.degraded }
  }

  /**
   * Reject: restore `original`. THE DANGEROUS PATH.
   *
   * Refuses when the file on disk is not what we showed in the diff, because writing `original`
   * over an unreviewed later change destroys it with no record. Refuses when there is no original
   * to restore. `opts.force` overrides only the first of those, and only when the caller has told
   * the human what they are about to lose.
   */
  function reject(id, opts = {}) {
    const r = pendingByFile.get(fileOf(id))
    if (!r || r.id !== id) return { ok: false, reason: `no pending review with id ${id}` }

    if (r.original == null && r.originalConfidence === CONFIDENCE.UNKNOWN)
      return { ok: false, reason: `review ${id} has no original snapshot for ${r.file} — we first saw this file after it had already changed, so there is nothing to restore. Rejecting would require deleting the file, which is not the same thing.`, code: 'no-original' }

    const onDisk = readFile(r.file)
    const expected = r.latest
    if (onDisk !== expected) {
      const changedAfter = onDisk != null && expected != null && sha(onDisk) !== sha(expected)
      return {
        ok: false,
        code: onDisk == null ? 'file-missing' : 'changed-since-snapshot',
        reason: onDisk == null
          ? `${r.file} no longer exists on disk; restoring the original would re-create a file someone deleted. Nothing was written.`
          : `${r.file} changed since the diff you are looking at was captured (disk ${sha(onDisk)} ≠ reviewed ${sha(expected)}). Restoring the original would silently destroy that later change. Nothing was written.`,
        file: r.file,
        diskHash: onDisk == null ? null : sha(onDisk),
        reviewedHash: expected == null ? null : sha(expected),
        changedAfter,
        recovery: 'Re-read the file and re-open the review (snapshot + recordEdit), or call reject(id, {force:true}) only after showing the human exactly what the force would discard.',
        forceAvailable: true,
      }
    }

    if (opts.force && onDisk === expected) { /* force is a no-op on the agreeing path; kept explicit */ }
    writeFile(r.file, r.original ?? '')
    pendingByFile.delete(r.file)
    r.status = 'rejected'; r.resolution = 'rejected'; r.resolvedAt = now()
    resolved.push(r)
    baseline.set(r.file, { content: r.original, at: r.resolvedAt, source: 'rejected-review-restore' })
    return {
      ok: true, id: r.id, file: r.file, status: 'rejected', restoredHash: sha(r.original ?? ''),
      degraded: r.degraded,
      ...(r.degraded ? { warning: `restored an INFERRED original (${r.originalConfidenceReason}) — this may not be exactly the pre-edit content` } : {}),
    }
  }

  /** Force-reject: the same operation with the disk check explicitly waived, and it says so. */
  function rejectForce(id, acknowledgement) {
    const r = pendingByFile.get(fileOf(id))
    if (!r || r.id !== id) return { ok: false, reason: `no pending review with id ${id}` }
    if (acknowledgement !== 'discard-later-changes')
      return { ok: false, reason: 'rejectForce requires the literal acknowledgement "discard-later-changes"; it exists so a force cannot happen by passing a truthy flag', code: 'acknowledgement-required' }
    if (r.original == null && r.originalConfidence === CONFIDENCE.UNKNOWN)
      return { ok: false, reason: `review ${id} has no original snapshot — force cannot invent one`, code: 'no-original' }
    const onDisk = readFile(r.file)
    writeFile(r.file, r.original ?? '')
    pendingByFile.delete(r.file)
    r.status = 'rejected'; r.resolution = 'rejected-forced'; r.resolvedAt = now()
    resolved.push(r)
    baseline.set(r.file, { content: r.original, at: r.resolvedAt, source: 'forced-restore' })
    return { ok: true, id: r.id, file: r.file, status: 'rejected', forced: true, discardedHash: onDisk == null ? null : sha(onDisk), discardedChars: onDisk == null ? 0 : onDisk.length, warning: 'a later, unreviewed change was overwritten' }
  }

  function fileOf(id) { for (const [f, r] of pendingByFile) if (r.id === id) return f; return null }

  /** Degraded-mode entry point: snapshot on file-open so there is SOME original before the agent runs. */
  function noteFileOpened(file) {
    const content = readFile(file)
    baseline.set(file, { content, at: now(), source: 'file-open' })
    return { ok: true, file, hasContent: content != null, degraded: mode !== 'hooks', note: mode === 'hooks' ? 'hooks are installed; this baseline is belt-and-braces' : 'degraded mode: this file-open snapshot is the best "original" available and may already be stale' }
  }

  function status() {
    return {
      mode,
      degraded: mode !== 'hooks',
      degradedReason: mode !== 'hooks' ? 'no pre-edit hook configured — originals are inferred from file-open / post-accept snapshots, so every "original" is a best guess, not an observation' : null,
      pending: pendingByFile.size,
      resolvedCount: resolved.length,
      limits: { contentBytes: MAX_CONTENT_BYTES, diffLines: MAX_DIFF_LINES },
    }
  }

  return { snapshot, recordEdit, pending, listPending, history, get, diff, accept, reject, rejectForce, noteFileOpened, status }
}

// --- minimal line diff (LCS). Bounded, and it says when it hit the bound. -------------------------
export function lineDiff(a, b) {
  const A = String(a).split('\n'), B = String(b).split('\n')
  let capped = null
  // Quadratic LCS on huge files would hang the server; above the bound we degrade to a whole-file
  // replace hunk and SAY so, rather than returning a plausible-looking partial diff.
  if (A.length + B.length > MAX_DIFF_LINES) {
    capped = { limit: MAX_DIFF_LINES, lines: A.length + B.length, note: 'file too large for a line-level diff; showing a whole-file replacement instead' }
    return { hunks: [{ type: 'replace', removed: A.length, added: B.length, aStart: 1, bStart: 1 }], added: B.length, removed: A.length, capped }
  }
  const n = A.length, m = B.length
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const ops = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push({ t: '=', a: i, b: j }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: '-', a: i, line: A[i] }); i++ }
    else { ops.push({ t: '+', b: j, line: B[j] }); j++ }
  }
  while (i < n) { ops.push({ t: '-', a: i, line: A[i] }); i++ }
  while (j < m) { ops.push({ t: '+', b: j, line: B[j] }); j++ }
  const hunks = []
  let cur = null
  for (const op of ops) {
    if (op.t === '=') { cur = null; continue }
    if (!cur) { cur = { type: 'change', aStart: (op.a ?? i) + 1, bStart: (op.b ?? j) + 1, removedLines: [], addedLines: [] }; hunks.push(cur) }
    if (op.t === '-') cur.removedLines.push(op.line); else cur.addedLines.push(op.line)
  }
  return { hunks, added: ops.filter(o => o.t === '+').length, removed: ops.filter(o => o.t === '-').length, capped }
}
