
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

function findAppRoot(from) {
  let dir = from
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'vite.config.js'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return path.resolve(from, '..')
}

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

export const ticketProjectDir = project => path.join(TICKET_DIR, safeSeg(project, 'workspace'))

/**
 * Path for one ticket's saved state, PARTITIONED BY PROJECT.
 * The project is the scope the user works in — it decides the JIRA host, the repository the design
 * agent reads, and which tickets are worth listing. Two projects can legitimately hold the same key
 * prefix on different hosts, so a flat key-keyed file would collide and serve one project's ticket
 * under another's configuration. Both segments are hard-guarded here as well as by the caller.
 */
export const ticketStateFile = (project, key) => path.join(ticketProjectDir(project), `${safeSeg(String(key || '').toUpperCase(), 'ticket key')}.json`)

/**
 * The DISPOSABLE half of a ticket's dossier — raw fetches only (Figma renders, sheet rows, comment
 * JSON). Gitignored, because it is all re-fetchable and none of it belongs in a PR. The half that is
 * worth reviewing lives in the target repo at `docs/<KEY>/`, which is not under TICKET_DIR and has
 * no helper here on purpose: it is keyed on the workspace's own directory, not on ours.
 */
export const dossierCache = (ws, key) => path.join(ticketProjectDir(ws), safeSeg(String(key || '').toUpperCase(), 'ticket key'), 'cache')

// --- runtime state written next to the app by server-eng.mjs ---
export const ENG_STATE = {
  bugOwnership: path.join(APP_ROOT, 'bug-ownership.json'),
  triage: path.join(APP_ROOT, 'eng-triage.json'),
  epicTargets: path.join(APP_ROOT, 'eng-epic-targets.json'),
  artifacts: path.join(APP_ROOT, 'eng-artifacts.json'),
}
