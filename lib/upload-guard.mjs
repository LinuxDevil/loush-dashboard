// Containment and quota for chat file uploads.
//
// The upload route writes a client-supplied name into a shared directory and hands the absolute
// path back, which the client then pastes into a prompt as `@/path`. Two separate things have to
// hold, and only one of them is about path traversal:
//
//   1. The written file must land inside the upload directory. `path.basename` alone is the usual
//      answer and is nearly right, but it is a string operation — it does not know about symlinks,
//      NUL bytes, or a name that basenames to `.` or `..`. The containment check here is done on
//      the RESOLVED path, which is the only form that can actually be compared.
//   2. The directory must not grow without bound. The route accepted 300 MB per request with no
//      limit on how many requests, so a chat window was an unauthenticated disk-fill primitive.
//
// Every refusal carries a reason and every applied bound is reported, because an upload that
// silently vanishes looks to the user like the model ignoring their file.

import fs from 'node:fs'
import path from 'node:path'

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024        // per file
export const MAX_DIR_BYTES = 500 * 1024 * 1024          // whole upload directory
export const MAX_NAME_LENGTH = 120

/**
 * Reduce a client-supplied filename to something safe to join.
 *
 * Returns null rather than a fallback string when nothing usable survives: a name that sanitises
 * to nothing is a signal worth passing up, not something to paper over with "file".
 */
export function safeName(raw) {
  if (typeof raw !== 'string') return null
  // A NUL truncates the path at the syscall boundary, so `a.txt\0.png` can become `a.txt`.
  // Strip control characters before anything else looks at the string.
  const base = path.basename(raw.replace(/[\u0000-\u001f\u007f]/g, ''))
  if (!base || base === '.' || base === '..') return null
  const cleaned = base.replace(/[^\w.-]/g, '_').replace(/^\.+/, '')
  if (!cleaned) return null
  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned
  // Truncate the stem, keep the extension — a name long enough to hit this is still allowed to
  // be recognisable, and the extension is what the CLI uses to decide how to read it.
  const ext = path.extname(cleaned).slice(0, 16)
  return cleaned.slice(0, MAX_NAME_LENGTH - ext.length) + ext
}

/** Bytes currently held in the upload directory, and the file list, oldest first. */
export function dirUsage(dir) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return { bytes: 0, files: [] } }
  const files = []
  for (const e of entries) {
    if (!e.isFile()) continue
    const p = path.join(dir, e.name)
    try {
      const st = fs.statSync(p)
      files.push({ path: p, name: e.name, bytes: st.size, mtime: st.mtimeMs })
    } catch {}   // vanished between readdir and stat — not an error, just not there
  }
  files.sort((a, b) => a.mtime - b.mtime)
  return { bytes: files.reduce((n, f) => n + f.bytes, 0), files }
}

/**
 * Decide where an upload may be written, or why it may not be.
 *
 * @param {string} dir       upload directory (absolute)
 * @param {string} rawName   client-supplied filename
 * @param {number} size      byte length of the body
 * @param {{maxBytes?: number, maxDirBytes?: number, now?: number}} [opts]
 * @returns {{ok: true, path: string, name: string, evict: Array, freed: number} |
 *           {ok: false, reason: string, limit?: number, size?: number}}
 */
export function planUpload(dir, rawName, size, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES
  const maxDirBytes = opts.maxDirBytes ?? MAX_DIR_BYTES
  if (!Number.isFinite(size) || size <= 0) return { ok: false, reason: 'empty-upload' }
  if (size > maxBytes) return { ok: false, reason: 'file-too-large', limit: maxBytes, size }
  // A single file larger than the whole quota can never be stored, however much is evicted.
  if (size > maxDirBytes) return { ok: false, reason: 'exceeds-quota', limit: maxDirBytes, size }

  const name = safeName(rawName)
  if (!name) return { ok: false, reason: 'unusable-name' }

  const stamp = (opts.now ?? Date.now()).toString(36)
  const target = path.resolve(dir, stamp + '-' + name)
  // Belt and braces after basename+sanitise: compare the resolved path, which is the only form
  // that reflects what the filesystem will actually do.
  const root = path.resolve(dir)
  if (target !== root && !target.startsWith(root + path.sep)) return { ok: false, reason: 'escapes-upload-dir' }

  // Over quota: evict oldest-first until the new file fits. Reported, not silent — the caller
  // tells the client which files were reclaimed.
  const { bytes, files } = dirUsage(dir)
  const evict = []
  let free = maxDirBytes - bytes
  for (const f of files) {
    if (free >= size) break
    evict.push(f)
    free += f.bytes
  }
  if (free < size) return { ok: false, reason: 'exceeds-quota', limit: maxDirBytes, size }
  return { ok: true, path: target, name, evict, freed: evict.reduce((n, f) => n + f.bytes, 0) }
}
