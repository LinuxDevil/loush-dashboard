// lib/paths.mjs — the single source of truth for every path this app resolves on its own disk.
//
// WHY THIS EXISTS
// Five modules each derived their own directory from `import.meta.url` and resolved config, state
// and safety files relative to it. Every one of those reads is wrapped in a try/catch or has a
// default, so a wrong path does not throw — it returns a plausible answer:
//
//   * server.mjs `PROJECT` fed ALLOWED_ROOTS, so a shift moved the WRITE JAIL. Writes that worked
//     start 403-ing and a different directory becomes writable. Nothing logs.
//   * server.mjs, server-eng.mjs and server-setup.mjs EACH computed projects.json independently. In
//     different directories they diverge: Setup writes one file, eng reads another, the feature flag
//     reads a third. Nothing logs.
//   * server-setup.mjs resolved .gitignore this way. Lose it and `isIgnored()` sees an empty file,
//     so the "your API token is committable" banner becomes a permanent false alarm.
//   * server-atoms.mjs assumed `atoms/` was its sibling. Lose it and attestation review state
//     silently resets to empty and is rewritten somewhere new.
//
// Deriving them ONCE here means a module's location no longer affects what it reads — which is the
// property that makes the next reorganisation cheap instead of dangerous.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

// Walk up from this file until we find the repo marker, rather than hardcoding a number of `..`
// hops. That is the whole point: paths.mjs can itself move without any of this changing.
function findAppRoot(from) {
  let dir = from
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'vite.config.js'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  // Fallback preserves the historical layout (lib/ is one level under the root) rather than
  // silently anchoring at '/' if the markers are ever renamed.
  return path.resolve(from, '..')
}

/** This repository — where package.json, projects.json and .gitignore live. */
export const APP_ROOT = findAppRoot(path.dirname(fileURLToPath(import.meta.url)))

/**
 * The repo this dashboard WATCHES — historically `server.mjs`'s `PROJECT`, i.e. the app's parent
 * directory. It feeds ALLOWED_ROOTS/safe(), the project-scope config paths and the "current project"
 * marker, so it must keep meaning exactly what it meant before this file existed.
 */
export const WATCHED_PROJECT = path.resolve(APP_ROOT, '..')

// --- user config (gitignored; deliberately kept at the repo root) ---
export const PROJECTS_FILE = path.join(APP_ROOT, 'projects.json')
export const SECRETS_FILE = path.join(APP_ROOT, '.eng.local.json')
export const LEGACY_SECRETS = path.join(APP_ROOT, 'config.json')
export const GITIGNORE_FILE = path.join(APP_ROOT, '.gitignore')

// --- shipped data ---
export const CATALOG_FILE = path.join(APP_ROOT, 'design-system-catalog.json')
export const ATOMS_DIR = path.join(APP_ROOT, 'atoms')

// --- Ticket section state (gitignored) ---
// ONE FILE PER JIRA KEY, deliberately. eng-artifacts.json is a single flat blob rewritten whole on
// every save (server/eng.mjs writeArtifacts), which is fine for two markdown fields and wrong for a
// graph the user drags: a node drag would rewrite every ticket's state on every frame.
export const TICKET_DIR = path.join(APP_ROOT, '.ticket-state')

const safeSeg = (v, what) => {
  const s = String(v || '').replace(/[^A-Za-z0-9_-]/g, '')
  if (!s) throw new Error(`invalid ${what}`)
  return s
}

/**
 * A stable id for a WORKSPACE — the folder the user selected to work in.
 *
 * Not the JIRA project key. The key is a property of a board; the workspace is the thing the user
 * actually picks, the thing agents run inside, and the thing two different boards can share. Keying
 * saved tickets or a folder binding on the JIRA key means renaming a board orphans them, and two
 * checkouts of the same board cannot be told apart.
 *
 * Readable basename + a short hash of the absolute path, so `~/work/api` and `~/fork/api` are
 * distinct and both are recognisable on disk.
 */
export const workspaceId = dir => {
  const abs = String(dir || '')
  if (!abs) throw new Error('invalid workspace')
  const base = path.basename(abs).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40) || 'ws'
  return `${base}-${createHash('sha256').update(abs).digest('hex').slice(0, 8)}`
}

/** Directory holding one workspace's saved tickets. */
export const ticketProjectDir = project => path.join(TICKET_DIR, safeSeg(project, 'workspace'))

/**
 * Path for one ticket's saved state, PARTITIONED BY PROJECT.
 * The project is the scope the user works in — it decides the JIRA host, the repository the design
 * agent reads, and which tickets are worth listing. Two projects can legitimately hold the same key
 * prefix on different hosts, so a flat key-keyed file would collide and serve one project's ticket
 * under another's configuration. Both segments are hard-guarded here as well as by the caller.
 */
// The KEY is uppercased (JIRA keys are uppercase by convention, and `abc-1` and `ABC-1` are the same
// ticket) while the workspace id keeps its case, because it carries a readable folder basename.
export const ticketStateFile = (project, key) => path.join(ticketProjectDir(project), `${safeSeg(String(key || '').toUpperCase(), 'ticket key')}.json`)

/** Pre-partition layout, read-only, so state saved before this change is not orphaned. */
export const legacyTicketStateFile = key => path.join(TICKET_DIR, `${safeSeg(String(key || '').toUpperCase(), 'ticket key')}.json`)

// --- runtime state written next to the app by server-eng.mjs ---
export const ENG_STATE = {
  bugOwnership: path.join(APP_ROOT, 'bug-ownership.json'),
  triage: path.join(APP_ROOT, 'eng-triage.json'),
  epicTargets: path.join(APP_ROOT, 'eng-epic-targets.json'),
  artifacts: path.join(APP_ROOT, 'eng-artifacts.json'),
}
