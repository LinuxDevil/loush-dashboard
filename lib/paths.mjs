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

// --- runtime state written next to the app by server-eng.mjs ---
export const ENG_STATE = {
  bugOwnership: path.join(APP_ROOT, 'bug-ownership.json'),
  triage: path.join(APP_ROOT, 'eng-triage.json'),
  epicTargets: path.join(APP_ROOT, 'eng-epic-targets.json'),
  artifacts: path.join(APP_ROOT, 'eng-artifacts.json'),
}
