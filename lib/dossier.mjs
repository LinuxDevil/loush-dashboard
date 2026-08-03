// The dossier manifest — one entry per pipeline stage, living in the TARGET repo and git-tracked.
//
// Storage is two halves (spec §2): `docs/<KEY>/` in the target repo holds everything worth reviewing
// in a PR, and `.ticket-state/<ws>/<KEY>/cache/` holds raw fetches that are cheap to get again. The
// manifest sits in the repo half and points at both, so a machine wipe costs a re-fetch and nothing
// else.

import fs from 'node:fs'
import path from 'node:path'

const STATUSES = ['ok', 'unavailable', 'failed', 'skipped']

const dossierDir = (repoDir, key) => path.join(repoDir, 'docs', String(key || '').toUpperCase())

/**
 * One manifest entry.
 *
 * `unavailable` is a first-class outcome — grilling proceeds without a Figma file. But an
 * unexplained one is exactly what this contract exists to prevent: two AC generators already wrote
 * the same slot, one of them unable to read the repo, with nothing on screen telling them apart. So
 * any status other than `ok` must carry a reason, and an unrecognised status is refused rather than
 * stored for a downstream reader to guess at.
 */
export function entry({ stage, status, reason, fetchedAt, sourceUrl, artifacts, provenance, tracked } = {}) {
  if (!stage) throw new Error('a manifest entry needs a stage')
  if (!STATUSES.includes(status)) throw new Error(`unknown status "${status}" — expected one of ${STATUSES.join(' | ')}`)
  if (status !== 'ok' && !reason) throw new Error(`status "${status}" for stage "${stage}" needs a reason — an unexplained non-ok status is what this contract exists to prevent`)
  return {
    stage,
    status,
    reason: reason || null,
    fetchedAt: fetchedAt || new Date().toISOString(),
    sourceUrl: sourceUrl || null,
    artifacts: artifacts || [],
    provenance: provenance || null,
    tracked: tracked !== false,
  }
}

const EMPTY = key => ({ v: 1, key: String(key || '').toUpperCase(), stages: {} })

/** Never throws: a missing manifest and a manifest half-written by a killed process read the same. */
export function readManifest(repoDir, key) {
  try { return { ...EMPTY(key), ...JSON.parse(fs.readFileSync(path.join(dossierDir(repoDir, key), 'manifest.json'), 'utf8')) } }
  catch { return EMPTY(key) }
}

/** tmp-file + rename, so a crash mid-write leaves the previous manifest intact (`ticket.mjs:55-63`). */
export function writeManifest(repoDir, key, manifest) {
  const dir = dossierDir(repoDir, key)
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, 'manifest.json')
  const tmp = target + '.tmp'
  const out = { ...EMPTY(key), ...manifest, key: EMPTY(key).key }
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2))
  fs.renameSync(tmp, target)
  return out
}
