// lib/clone.mjs — map a team repo (`owner/name`) to the local checkout on this machine.
//
// PLANE B by content: this reads the Claude Code project registry (`~/.claude.json`), i.e. which
// repositories THIS machine has open. That is local-environment state, not a team work artifact, so
// it must not be imported by server/eng.mjs (plane A). See the header of server/eng.mjs.
//
// WHY THIS EXISTS AS A MODULE
// It lived inside server/index.mjs, which is the mount root that imports every other server module —
// so importing it from one of those modules would be a cycle. Extracting it here is what lets the
// Ticket section run a design agent with the real repository as its cwd. Without a real cwd the
// agent cannot read the codebase, and a "system design" produced without reading the codebase is
// autocomplete with a ticket attached.
//
// The resolution is deliberately evidence-based: match the git `origin` remote, and only fall back
// to a basename match. A directory that merely shares a name is a guess, and callers are told so.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const HOME = os.homedir()
const CLAUDE_JSON = path.join(HOME, '.claude.json')

const remoteCache = new Map() // dir -> {t, v}
const REMOTE_TTL = 600_000

export function originOf(dir) {
  const hit = remoteCache.get(dir)
  if (hit && Date.now() - hit.t < REMOTE_TTL) return hit.v
  let v = ''
  try { v = (spawnSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { timeout: 3000 }).stdout || '').toString().trim() } catch {}
  remoteCache.set(dir, { t: Date.now(), v })
  return v
}

/** Every registered project directory that still exists on disk. */
export function knownRepoDirs() {
  try {
    const j = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8'))
    return Object.keys(j.projects || {}).filter(d => d !== HOME && fs.existsSync(d))
  } catch { return [] }
}

/**
 * Resolve `owner/name` to a local checkout.
 * @returns {{dir: string, how: 'remote'|'basename'} | null} `how` is reported to the UI so a
 *   basename guess is never presented with the same confidence as a matched origin remote.
 */
export function resolveClone(repo) {
  const [owner, name] = String(repo || '').split('/')
  if (!owner || !name) return null
  const dirs = knownRepoDirs()
  for (const d of dirs) {
    const o = originOf(d)
    if (o && o.replace(/\.git$/, '').endsWith(`${owner}/${name}`)) return { dir: d, how: 'remote' }
  }
  const byName = dirs.find(d => path.basename(d) === name)
  return byName ? { dir: byName, how: 'basename' } : null
}

/** Back-compat shape used by server/index.mjs: the directory, or null. */
export const localCloneOf = repo => resolveClone(repo)?.dir || null
