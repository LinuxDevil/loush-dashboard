
import { open, readFile, stat } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'

export const DEFAULT_MAX_CACHED_FILES = 64
export const DEFAULT_MAX_BYTES_PER_READ = 8 * 1024 * 1024

// ponytail: one cap, on the one array where bounding it costs nothing. Revisit only if stats()
export const DEFAULT_MAX_MALFORMED_PER_FILE = 1000

const errorOf = err => ({
  code: err?.code ?? 'UNKNOWN',
  message: err?.message ?? String(err),
})

const FIRST_SIGHT_NEW = 'new'
const FIRST_SIGHT_EVICTED = 'evicted'
const FIRST_SIGHT_UNKNOWN = 'unknown'

export function createTailer({
  maxCachedFiles = DEFAULT_MAX_CACHED_FILES,
  maxBytesPerRead = DEFAULT_MAX_BYTES_PER_READ,
  maxMalformedPerFile = Number(process.env.DASHBOARD_MAX_MALFORMED_PER_FILE) || DEFAULT_MAX_MALFORMED_PER_FILE,
} = {}) {
  if (!(maxCachedFiles > 0)) throw new TypeError('maxCachedFiles must be a positive number')
  if (!(maxBytesPerRead > 0)) throw new TypeError('maxBytesPerRead must be a positive number')
  if (!(maxMalformedPerFile > 0)) throw new TypeError('maxMalformedPerFile must be a positive number')

  const files = new Map()

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
    malformedDropped: 0,
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
    parse: null,
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
      fh = await open(file, 'r')
    } catch (err) {
      counters.errors++
      return {
        ...emptyResult(file, state),
        ok: false,
        lines: null,
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
          state.offset = size
          skippedBytes = size
        }
      } else {
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

        const text = state.carry + state.decoder.write(buf)
        const parts = text.split('\n')
        state.carry = parts.pop() ?? ''
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
      return { ok: true, file, records: state.parse.records, malformed: state.parse.malformed, malformedDropped: state.parse.malformedDropped, maxMalformedPerFile, size, mtimeMs, cached: true, error: null }
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
    let malformedDropped = 0
    const rows = text.split('\n')
    for (let i = 0; i < rows.length; i++) {
      const line = rows[i].endsWith('\r') ? rows[i].slice(0, -1) : rows[i]
      if (line === '') continue
      try {
        records.push(JSON.parse(line))
      } catch (err) {
        malformed.push({ index: i, line, error: errorOf(err) })
        if (malformed.length > maxMalformedPerFile) {
          malformed.shift()
          malformedDropped++
          counters.malformedDropped++
        }
      }
    }

    state.parse = { mtimeMs, size, records, malformed, malformedDropped }
    return { ok: true, file, records, malformed, malformedDropped, maxMalformedPerFile, size, mtimeMs, cached: false, error: null }
  }

  function stats() {
    let carriedBytes = 0
    for (const s of files.values()) carriedBytes += Buffer.byteLength(s.carry, 'utf8')
    return {
      files: files.size,
      maxCachedFiles,
      maxBytesPerRead,
      maxMalformedPerFile,
      carriedBytes,
      ...counters,
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
