// Incremental transcript tailing + parse cache (FEATURE_OPPORTUNITIES 044 + 046).
//
// One primitive, not two: "read only what was appended since last time" and "don't re-parse a
// file that hasn't changed" are the same per-file state — an offset, a carry buffer, and an
// (mtime, size) stamp. Splitting them means two sources of truth for whether a file moved.
//
// The central hazard is that these JSONL files are appended to *while we read them*. Every
// defence below exists because of that:
//   - we open first and fstat the open handle, then read an explicit byte range, so growth
//     between stat and read cannot be double-read (the upstream stat-then-open race);
//   - a read that ends mid-line keeps the fragment in a per-file carry buffer instead of
//     dropping it (upstream loses these lines outright);
//   - a UTF-8 sequence split across a read boundary is held by a per-file StringDecoder, so a
//     multi-byte character straddling an append does not decode to U+FFFD;
//   - shrinkage or an inode change means the file was replaced, not appended to.
//
// Honesty rules this module follows:
//   - Unknown is a value. An unreadable file returns `ok: false` with `lines: null` and the real
//     errno. It never returns `[]`, because "permission denied" must not look like "no new data".
//   - No silent caps. Every bound (bytes per read, LRU size) is reported in the return value and
//     in stats(), with the amount left behind.
//   - tail() returns RAW LINES and does not parse them. That is deliberate: one malformed line in
//     a live-appended file must not cost the caller the other 999. Callers that want parsing use
//     read(), which parses per line and returns the failures explicitly in `malformed` rather than
//     throwing or silently discarding them.

import { open, readFile, stat } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'

export const DEFAULT_MAX_CACHED_FILES = 64
export const DEFAULT_MAX_BYTES_PER_READ = 8 * 1024 * 1024 // 8 MiB

const errorOf = err => ({
  code: err?.code ?? 'UNKNOWN',
  message: err?.message ?? String(err),
})

// Why a whole class of "why is this the first time we're seeing this file": the answer changes what
// a caller should do. A genuinely new file legitimately starts at EOF; a file whose state we threw
// away under LRU pressure means we have a gap we cannot quantify. Reporting both as `firstSight`
// with no reason would hide real data loss behind a normal-looking result.
const FIRST_SIGHT_NEW = 'new'
const FIRST_SIGHT_EVICTED = 'evicted'
const FIRST_SIGHT_UNKNOWN = 'unknown'

export function createTailer({
  maxCachedFiles = DEFAULT_MAX_CACHED_FILES,
  maxBytesPerRead = DEFAULT_MAX_BYTES_PER_READ,
} = {}) {
  if (!(maxCachedFiles > 0)) throw new TypeError('maxCachedFiles must be a positive number')
  if (!(maxBytesPerRead > 0)) throw new TypeError('maxBytesPerRead must be a positive number')

  // Insertion-ordered Map used as the LRU: touching a file deletes and re-sets its key, so the
  // oldest live key is always the first one iterated.
  const files = new Map()

  // Bounded memory of what we evicted, so a later tail() of an evicted file can say *why* it lost
  // its offset. Bounded memory of evictions is itself lossy, and we say so rather than guessing.
  const evictedPaths = new Set()
  const evictionMemoryCap = Math.max(maxCachedFiles * 2, 16)
  let evictionMemoryLossy = false

  const counters = {
    evictions: 0,
    parseCacheHits: 0,
    parseCacheMisses: 0,
    bytesRead: 0,
    linesEmitted: 0,
    readCapHits: 0,
    resets: 0,
    errors: 0,
  }

  const newState = () => ({
    offset: 0,
    carry: '',
    decoder: new StringDecoder('utf8'),
    mtimeMs: null,
    size: null,
    ino: null,
    dev: null,
    seen: false,
    parse: null, // { mtimeMs, size, records, malformed }
  })

  const rememberEviction = path => {
    if (evictedPaths.size >= evictionMemoryCap) {
      const oldest = evictedPaths.values().next().value
      evictedPaths.delete(oldest)
      evictionMemoryLossy = true
    }
    evictedPaths.add(path)
  }

  const evictIfNeeded = () => {
    while (files.size > maxCachedFiles) {
      const oldest = files.keys().next().value
      files.delete(oldest)
      rememberEviction(oldest)
      counters.evictions++
    }
  }

  const touch = (path, state) => {
    files.delete(path)
    files.set(path, state)
    evictIfNeeded()
  }

  const firstSightReason = path => {
    if (evictedPaths.has(path)) return FIRST_SIGHT_EVICTED
    return evictionMemoryLossy ? FIRST_SIGHT_UNKNOWN : FIRST_SIGHT_NEW
  }

  const stateFor = path => {
    const existing = files.get(path)
    if (existing) {
      touch(path, existing)
      return existing
    }
    const fresh = newState()
    touch(path, fresh)
    return fresh
  }

  // Read exactly [start, end) from an already-open handle. fh.read() is allowed to return short,
  // so we loop; a short read that never advances means the file shrank under us mid-read, which is
  // the same rotation case handled above — we stop rather than spin.
  const readRange = async (fh, start, end) => {
    const want = end - start
    const buf = Buffer.allocUnsafe(want)
    let filled = 0
    while (filled < want) {
      const { bytesRead } = await fh.read(buf, filled, want - filled, start + filled)
      if (bytesRead <= 0) break
      filled += bytesRead
    }
    return filled === want ? buf : buf.subarray(0, filled)
  }

  const emptyResult = (file, state, over) => ({
    ok: true,
    file,
    lines: [],
    bytesRead: 0,
    offset: state.offset,
    size: state.size,
    mtimeMs: state.mtimeMs,
    reset: false,
    truncated: false,
    pendingBytes: 0,
    partialBytes: Buffer.byteLength(state.carry, 'utf8'),
    firstSight: false,
    firstSightReason: null,
    skippedBytes: 0,
    rewriteSuspected: false,
    error: null,
    ...over,
  })

  async function tail(file, { fromStart = false } = {}) {
    const state = stateFor(file)

    let fh
    try {
      // Open BEFORE stat, and stat the handle rather than the path. Everything after this point
      // refers to the exact inode we hold open, so a rotation racing this call cannot make us read
      // the range of one file out of a different one.
      fh = await open(file, 'r')
    } catch (err) {
      counters.errors++
      return {
        ...emptyResult(file, state),
        ok: false,
        lines: null, // not [] — an unreadable file must not be mistakable for "nothing new"
        error: errorOf(err),
      }
    }

    try {
      const st = await fh.stat()
      const size = Number(st.size)
      const mtimeMs = st.mtimeMs

      const firstSight = !state.seen
      let reset = false
      let skippedBytes = 0

      if (firstSight) {
        state.ino = st.ino
        state.dev = st.dev
        state.seen = true
        if (!fromStart) {
          // Rule 046: on first sight of a file, record its size — don't replay its whole history.
          state.offset = size
          skippedBytes = size
        }
      } else {
        // Rotation shows up two ways: the file got shorter than what we already consumed, or the
        // path now points at a different inode of the same or greater length. Either way the byte
        // at `offset` is not the byte we left off at, so continuing would emit spliced garbage.
        const shrank = size < state.offset
        const swapped = st.ino && state.ino && (st.ino !== state.ino || st.dev !== state.dev)
        if (shrank || swapped) {
          reset = true
          counters.resets++
          state.offset = 0
          state.carry = ''
          state.decoder = new StringDecoder('utf8')
          state.ino = st.ino
          state.dev = st.dev
        }
      }

      // Same size, different mtime, offset already at EOF: the file may have been rewritten in
      // place to the identical length. We cannot tell that from a bare `touch`, so we refuse to
      // guess — we neither re-emit (which would duplicate) nor stay silent about the ambiguity.
      // The parse cache in read() *does* treat this as a hard invalidation, because there re-doing
      // the work is free of side effects.
      const rewriteSuspected =
        !firstSight && !reset && size === state.offset && state.mtimeMs != null && mtimeMs !== state.mtimeMs

      const available = Math.max(0, size - state.offset)
      const capped = available > maxBytesPerRead
      const toRead = capped ? maxBytesPerRead : available
      const end = state.offset + toRead
      if (capped) counters.readCapHits++

      let lines = []
      let bytesRead = 0
      if (toRead > 0) {
        const buf = await readRange(fh, state.offset, end)
        bytesRead = buf.length
        state.offset += bytesRead
        counters.bytesRead += bytesRead

        // decoder.write() holds back an incomplete multi-byte sequence at the end of the chunk;
        // carry holds back an incomplete *line*. Both are needed: a cap boundary or an append
        // boundary can land in the middle of either.
        const text = state.carry + state.decoder.write(buf)
        const parts = text.split('\n')
        state.carry = parts.pop() ?? '' // trailing fragment — never emitted, always carried forward
        lines = parts.map(l => (l.endsWith('\r') ? l.slice(0, -1) : l)).filter(l => l !== '')
        counters.linesEmitted += lines.length
      }

      state.size = size
      state.mtimeMs = mtimeMs

      return emptyResult(file, state, {
        lines,
        bytesRead,
        offset: state.offset,
        size,
        mtimeMs,
        reset,
        truncated: capped,
        // What the cap left unread. Non-zero `pendingBytes` means this result is INCOMPLETE and
        // the caller should tail() again immediately; it is not "all there was".
        pendingBytes: capped ? available - toRead : 0,
        partialBytes: Buffer.byteLength(state.carry, 'utf8'),
        firstSight,
        firstSightReason: firstSight ? firstSightReason(file) : null,
        skippedBytes,
        rewriteSuspected,
      })
    } catch (err) {
      counters.errors++
      return { ...emptyResult(file, state), ok: false, lines: null, error: errorOf(err) }
    } finally {
      await fh.close().catch(() => {})
    }
  }

  // Whole-file parse with an (mtime, size) cache. Size alone is not a version: a transcript can be
  // rewritten to the same length (a redaction pass, an editor save), so mtime has to be part of the
  // key or we would serve stale records forever.
  async function read(file) {
    const state = stateFor(file)

    let st
    try {
      st = await stat(file)
    } catch (err) {
      counters.errors++
      return { ok: false, file, records: null, malformed: null, size: null, mtimeMs: null, cached: false, error: errorOf(err) }
    }

    const size = Number(st.size)
    const { mtimeMs } = st
    const hit = state.parse && state.parse.size === size && state.parse.mtimeMs === mtimeMs
    if (hit) {
      counters.parseCacheHits++
      return { ok: true, file, records: state.parse.records, malformed: state.parse.malformed, size, mtimeMs, cached: true, error: null }
    }
    counters.parseCacheMisses++

    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (err) {
      counters.errors++
      return { ok: false, file, records: null, malformed: null, size, mtimeMs, cached: false, error: errorOf(err) }
    }

    const records = []
    const malformed = []
    const rows = text.split('\n')
    for (let i = 0; i < rows.length; i++) {
      const line = rows[i].endsWith('\r') ? rows[i].slice(0, -1) : rows[i]
      if (line === '') continue
      try {
        records.push(JSON.parse(line))
      } catch (err) {
        // Per-line, not per-file. A half-written last line is normal in a file being appended to;
        // losing the other 4,000 records over it would be absurd. The failure is reported, not
        // swallowed, so a caller can tell "no bad lines" from "we hid some".
        malformed.push({ index: i, line, error: errorOf(err) })
      }
    }

    state.parse = { mtimeMs, size, records, malformed }
    return { ok: true, file, records, malformed, size, mtimeMs, cached: false, error: null }
  }

  function stats() {
    let carriedBytes = 0
    for (const s of files.values()) carriedBytes += Buffer.byteLength(s.carry, 'utf8')
    return {
      files: files.size,
      maxCachedFiles,
      maxBytesPerRead,
      carriedBytes,
      ...counters,
      // Eviction bookkeeping is itself bounded; when it overflows we can no longer say whether a
      // first sight is new or a re-sighting, and firstSightReason becomes 'unknown'.
      evictionMemory: { known: evictedPaths.size, cap: evictionMemoryCap, lossy: evictionMemoryLossy },
    }
  }

  function forget(file) {
    return files.delete(file)
  }

  function clear() {
    files.clear()
    evictedPaths.clear()
    evictionMemoryLossy = false
  }

  return { tail, read, stats, forget, clear }
}
