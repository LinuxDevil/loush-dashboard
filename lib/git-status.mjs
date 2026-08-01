// lib/git-status.mjs — parse `git status --porcelain=v1 -z` into structured entries.
//
// WHY A BYTE PARSER AND NOT `.split('\n')`
//
// `-z` output is NUL-separated, and that is the whole point of asking for it: in the newline format
// git C-quotes any path containing a space, a quote, a newline or a non-ASCII byte
// (`"a\"b.txt"`, `"caf\303\251"`), so a newline parser has to un-quote — and un-quoting wrong
// means a file is renamed, staged or committed under the WRONG NAME. With `-z` the path is emitted
// raw. So this parser consumes a Buffer and splits on 0x00. Decoding to a JS string first would
// destroy any path that is not valid UTF-8 (Linux paths are bytes, not text) — one round trip
// through `toString('utf8')` turns those bytes into U+FFFD and the name is unrecoverable.
//
// THE RENAME TRAP (the bug this file exists to not have)
//
// A rename/copy record consumes TWO NUL-terminated fields, in this order — verified against
// git 2.43 with `od -c`:
//
//     "R  new \"q\" name.txt" NUL "old name.txt" NUL
//
// i.e. the NEW path is in the status record and the ORIGINAL path is the field AFTER it. Consume one
// field instead of two and every subsequent entry shifts by one: the next file's path is read as a
// status record, the record after that becomes a path, and the whole listing is quietly wrong rather
// than visibly broken. That is why `rename-missing-origin` is a hard parse failure below — a
// truncated rename record is not something to guess past.
//
// CONFLICTS ARE NOT MODIFICATIONS
//
// Porcelain v1 has exactly seven unmerged XY pairs: DD AU UD UA DU AA UU. They are NOT decomposable
// into "index status" + "worktree status" — in `UD`, the `D` does not mean "deleted in the worktree",
// it means "deleted by them". Reporting `UD` as an ordinary delete, or `AA` as an ordinary add, tells
// the user a file is ready to stage when in fact staging it would resolve a conflict by silently
// picking a side. So for a conflicted entry `indexStatus`/`worktreeStatus` are NULL and `conflict`
// carries the truth. (House rule 1: unknown is a value — here, "there is no plain index status".)
//
// Never throws: every malformed input returns `{ok:false, reason, at}`.

/** The seven unmerged states, and what each one actually means. Not a modification. */
export const UNMERGED_STATES = Object.freeze({
  DD: { label: 'both deleted', ours: 'deleted', theirs: 'deleted' },
  AU: { label: 'added by us', ours: 'added', theirs: 'unmerged' },
  UD: { label: 'deleted by them', ours: 'unmerged', theirs: 'deleted' },
  UA: { label: 'added by them', ours: 'unmerged', theirs: 'added' },
  DU: { label: 'deleted by us', ours: 'deleted', theirs: 'unmerged' },
  AA: { label: 'both added', ours: 'added', theirs: 'added' },
  UU: { label: 'both modified', ours: 'modified', theirs: 'modified' },
})

const CODE_NAMES = Object.freeze({
  ' ': null, M: 'modified', T: 'typechange', A: 'added', D: 'deleted',
  R: 'renamed', C: 'copied', U: 'unmerged', '?': 'untracked', '!': 'ignored',
})

/** Every bound this parser imposes. Reported on every result so a cap is never silent. */
export const STATUS_LIMITS = Object.freeze({
  maxEntries: 5000,      // a 200k-file `git add .` must not render 200k DOM rows
  maxPathBytes: 4096,    // PATH_MAX; longer is flagged, never dropped
})

const NUL = 0x00
const SP = 0x20

/**
 * Decode one path field. Returns the bytes verbatim alongside the best-effort string so a caller
 * that must act on the path (stage it, open it) can use the exact bytes, while the UI shows text.
 */
function decodePath(buf) {
  const text = buf.toString('utf8')
  // If re-encoding does not reproduce the original bytes the name is not UTF-8; `text` now contains
  // U+FFFD and is NOT the file's name. Say so rather than pretending the string is the path.
  const lossy = !Buffer.from(text, 'utf8').equals(buf)
  return {
    path: lossy ? null : text,
    pathDisplay: text,
    pathBytesBase64: buf.toString('base64'),
    pathBytes: buf.length,
    pathEncoding: lossy ? 'invalid-utf8' : 'utf8',
    pathOversize: buf.length > STATUS_LIMITS.maxPathBytes,
  }
}

/**
 * Parse the `## ...` branch header emitted by `git status --branch`.
 * Ahead/behind are null when git did not report them (no upstream, or detached) — never 0.
 */
export function parseBranchHeader(line) {
  const s = String(line == null ? '' : line)
  if (!s.startsWith('##')) return { ok: false, reason: 'not-a-branch-header' }
  const body = s.slice(2).trim()
  const out = {
    ok: true, branch: null, upstream: null, ahead: null, behind: null,
    detached: false, noCommitsYet: false, raw: body,
  }
  // "HEAD (no branch)" — detached. The branch NAME is genuinely unknown here, so it stays null.
  if (/^HEAD \(no branch\)/.test(body)) { out.detached = true; return out }
  let rest = body
  const noCommits = /^No commits yet on (.+)$/.exec(body)
  if (noCommits) { out.noCommitsYet = true; rest = noCommits[1] }
  const track = /\s\[(.+)\]$/.exec(rest)
  if (track) {
    rest = rest.slice(0, track.index)
    const a = /ahead (\d+)/.exec(track[1]); if (a) out.ahead = Number(a[1])
    const b = /behind (\d+)/.exec(track[1]); if (b) out.behind = Number(b[1])
    if (/gone/.test(track[1])) out.upstreamGone = true
  }
  // `...` separates local from upstream. A branch name may not contain `...`, git forbids it.
  const dots = rest.indexOf('...')
  if (dots >= 0) { out.branch = rest.slice(0, dots); out.upstream = rest.slice(dots + 3) }
  else out.branch = rest.trim() || null
  // Upstream present means ahead/behind ARE known and simply zero; without one they stay unknown.
  if (out.upstream && !out.upstreamGone) { if (out.ahead == null) out.ahead = 0; if (out.behind == null) out.behind = 0 }
  return out
}

/**
 * @param {Buffer|string} input raw stdout of `git status --porcelain=v1 -z [--branch]`.
 * @param {{maxEntries?:number}} [opts]
 * @returns {{ok:true, entries:object[], branch:object|null, counts:object, truncated:boolean,
 *            limits:object, warnings:string[]} | {ok:false, reason:string, at?:number}}
 *          Never throws.
 */
export function parsePorcelainV1Z(input, opts = {}) {
  let buf
  if (Buffer.isBuffer(input)) buf = input
  else if (typeof input === 'string') buf = Buffer.from(input, 'utf8')
  else return { ok: false, reason: 'input-must-be-buffer-or-string', limits: STATUS_LIMITS }

  const maxEntries = Number.isFinite(opts.maxEntries) && opts.maxEntries > 0 ? opts.maxEntries : STATUS_LIMITS.maxEntries
  const limits = { ...STATUS_LIMITS, maxEntries }
  const warnings = []

  if (buf.length === 0) {
    return { ok: true, entries: [], branch: null, counts: emptyCounts(), truncated: false, limits, warnings }
  }

  // Guard against being handed NEWLINE-separated output by mistake. Without this check the first
  // record would parse as one enormous path containing every other record — a clean repo and a
  // 300-file repo would both render as "1 changed file", which is worse than an error.
  if (!buf.includes(NUL) && buf.includes(0x0a)) {
    return { ok: false, reason: 'input-not-nul-separated', hint: 'pass -z output, not newline output', limits }
  }

  // Split on NUL. git TERMINATES every field with a NUL (it does not separate with one), so there is
  // no trailing empty element to strip. Bytes left over after the last NUL are an unterminated final
  // record — kept, because a truncated stream should still show what it did contain, and an empty
  // field anywhere is a malformed record rather than something to skip past.
  const fields = []
  let start = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === NUL) { fields.push(buf.subarray(start, i)); start = i + 1 }
  }
  if (start < buf.length) fields.push(buf.subarray(start))

  const entries = []
  let branch = null
  let truncated = false
  let i = 0

  for (; i < fields.length; i++) {
    const f = fields[i]
    if (f.length === 0) return { ok: false, reason: 'empty-record', at: i, limits }

    // `--branch` header, always first when present.
    if (f.length >= 2 && f[0] === 0x23 && f[1] === 0x23) {
      const parsed = parseBranchHeader(f.toString('utf8'))
      branch = parsed.ok ? parsed : null
      if (!parsed.ok) warnings.push('unparseable-branch-header')
      continue
    }

    if (f.length < 3) {
      return { ok: false, reason: 'record-too-short', at: i, recordBase64: f.toString('base64'), limits }
    }
    const x = String.fromCharCode(f[0])
    const y = String.fromCharCode(f[1])
    if (f[2] !== SP) {
      return { ok: false, reason: 'malformed-record-separator', at: i, xy: x + y, recordBase64: f.toString('base64'), limits }
    }
    if (!(x in CODE_NAMES) || !(y in CODE_NAMES)) {
      return { ok: false, reason: 'unknown-status-code', at: i, xy: x + y, limits }
    }

    if (entries.length >= maxEntries) {
      // House rule 2: stop, but SAY that we stopped and at what bound.
      truncated = true
      break
    }

    const xy = x + y
    const isRenameOrCopy = x === 'R' || x === 'C' || y === 'R' || y === 'C'
    const p = decodePath(f.subarray(3))

    let orig = null
    if (isRenameOrCopy) {
      // THE TWO-FIELD RULE. If the origin field is missing the stream is truncated; consuming one
      // field would shift every following entry, so this is fatal rather than best-effort.
      if (i + 1 >= fields.length) {
        return { ok: false, reason: 'rename-missing-origin', at: i, xy, path: p.pathDisplay, limits }
      }
      i += 1
      const of = fields[i]
      if (of.length === 0) return { ok: false, reason: 'rename-empty-origin', at: i, xy, limits }
      orig = decodePath(of)
    }

    const conflict = UNMERGED_STATES[xy] || null
    const untracked = xy === '??'
    const ignored = xy === '!!'

    entries.push({
      xy, x, y,
      ...p,
      // For a conflict these are deliberately null — see the header. Callers branch on `conflicted`.
      indexStatus: conflict ? null : (untracked || ignored ? null : CODE_NAMES[x]),
      worktreeStatus: conflict ? null : (untracked || ignored ? null : CODE_NAMES[y]),
      // Two INDEPENDENT columns: a file can be both staged and unstaged (e.g. "MM").
      staged: !conflict && !untracked && !ignored && x !== ' ',
      unstaged: !conflict && !untracked && !ignored && y !== ' ',
      untracked,
      ignored,
      conflicted: Boolean(conflict),
      conflict: conflict ? { code: xy, ...conflict } : null,
      renamed: x === 'R' || y === 'R',
      copied: x === 'C' || y === 'C',
      origPath: orig ? orig.path : null,
      origPathDisplay: orig ? orig.pathDisplay : null,
      origPathBytesBase64: orig ? orig.pathBytesBase64 : null,
    })
  }

  const counts = emptyCounts()
  counts.total = entries.length
  for (const e of entries) {
    if (e.conflicted) counts.conflicted++
    if (e.staged) counts.staged++
    if (e.unstaged) counts.unstaged++
    if (e.untracked) counts.untracked++
    if (e.ignored) counts.ignored++
    if (e.renamed) counts.renamed++
    if (e.copied) counts.copied++
    if (e.pathEncoding === 'invalid-utf8') counts.nonUtf8Paths++
  }
  if (counts.nonUtf8Paths) warnings.push('non-utf8-paths-present')

  return { ok: true, entries, branch, counts, truncated, limits, warnings }
}

function emptyCounts() {
  return { total: 0, staged: 0, unstaged: 0, untracked: 0, ignored: 0, conflicted: 0, renamed: 0, copied: 0, nonUtf8Paths: 0 }
}
