
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { git as gitSafe } from './git-safe.mjs'

const HOME = os.homedir()
const CLAUDE_JSON = path.join(HOME, '.claude.json')

const remoteCache = new Map()
const REMOTE_TTL = 600_000

export function originOf(dir) {
  const hit = remoteCache.get(dir)
  if (hit && Date.now() - hit.t < REMOTE_TTL) return hit.v
  let v = ''
  try { v = (gitSafe(dir, ['remote', 'get-url', 'origin'], { timeout: 3000 }).stdout || '').trim() } catch {}
  remoteCache.set(dir, { t: Date.now(), v })
  return v
}

export function knownRepoDirs() {
  try {
    const j = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8'))
    return Object.keys(j.projects || {}).filter(d => d !== HOME && fs.existsSync(d))
  } catch { return [] }
}

/**
 * The projects you have actually opened a session in — the same set the Projects tab shows.
 * Returned with enough context to choose between two checkouts of the same repo: the origin remote,
 * whether it is a git repo at all, and when it was last touched.
 */
export function listLocalProjects() {
  return knownRepoDirs().map(dir => {
    const origin = originOf(dir)
    let lastActive = null
    try { lastActive = fs.statSync(dir).mtimeMs } catch {}
    return {
      dir,
      name: path.basename(dir),
      origin: origin || null,
      slug: origin ? (origin.replace(/\.git$/, '').match(/[:/]([^/:]+\/[^/]+)$/) || [])[1] || null : null,
      isGit: fs.existsSync(path.join(dir, '.git')),
      lastActive,
    }
  }).sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))
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

export const localCloneOf = repo => resolveClone(repo)?.dir || null
