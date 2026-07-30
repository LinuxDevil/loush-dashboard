// One place to run git, with the two safety properties the 13 scattered call sites did not have.
//
// 1. Read commands do not take optional locks.
//
//    `git status`, `git diff` and `git blame` look read-only and are not: they refresh the index,
//    which takes `.git/index.lock`. Two consequences, both of which this codebase can hit, because
//    the board rebases worktrees and bug-triage runs blame while a dashboard poll is in flight:
//    the read fails with "Unable to create '.git/index.lock': File exists", and — worse — a read
//    that wins the race makes a concurrent write fail instead. `--no-optional-locks` tells git to
//    skip exactly these, and it is the fix git ships for this.
//
// 2. A lock collision is reported as a lock collision.
//
//    Without that, the caller sees exit code 128 and a message about a file, which reads like
//    repository corruption rather than "something else is using this repo, try again". One is
//    alarming and wrong; the other is true and actionable.
//
// What this deliberately does NOT do is delete a stale lock file. A lock whose owner is still
// running is the only thing standing between two writers and a corrupt index, and there is no
// reliable way from here to tell "stale" from "busy" — the owning process may be mid-write with
// no CPU time this instant. It is reported, with its age, and a human decides.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Commands that only read. Anything not on this list is treated as a write, so a command added
// later is guarded by default rather than silently unguarded.
export const READ_COMMANDS = new Set([
  'status', 'diff', 'log', 'show', 'blame', 'ls-files', 'ls-tree', 'rev-parse', 'rev-list',
  'check-ignore', 'cat-file', 'shortlog', 'describe', 'name-rev', 'for-each-ref', 'symbolic-ref',
  'count-objects', 'var', 'config',
])

const LOCK_PATTERNS = [
  /Unable to create '(.+?)': File exists/i,
  /another git process seems to be running/i,
  /index\.lock/i,
  /shallow\.lock/i,
]

export const isLockError = text => LOCK_PATTERNS.some(re => re.test(String(text ?? '')))

/**
 * Age of a repository's index lock, or null when there is none.
 * Reported, never removed — see the note at the top of this file.
 */
export function lockInfo(dir) {
  const p = path.join(String(dir ?? ''), '.git', 'index.lock')
  try {
    const st = fs.statSync(p)
    return { path: p, ageMs: Date.now() - st.mtimeMs, at: new Date(st.mtimeMs).toISOString() }
  } catch { return null }
}

/**
 * Run a git command.
 *
 * @param {string} dir     repository directory
 * @param {string[]} args  git arguments, starting with the subcommand (no `-C`)
 * @param {{timeout?: number, maxBuffer?: number, write?: boolean}} [opts]
 *        `write` overrides the READ_COMMANDS classification when a subcommand is used both ways.
 * @returns {{ok, stdout, stderr, status, locked, lock, command, readOnly}}
 *          Never throws — a git failure is data, and every caller here already has an error path.
 */
export function git(dir, args, opts = {}) {
  // A missing directory must be refused, not coerced. `String(null)` and `String(undefined)` used
  // to become `''`, and `git -C ''` runs in the PROCESS's current directory — so a caller passing
  // a null path silently operated on whatever repo the dashboard itself was started in, reporting
  // ok:true. That is the worst possible failure for a module whose whole job is to be explicit
  // about which repository it touched.
  if (typeof dir !== 'string' || dir.trim() === '') {
    return { ok: false, stdout: '', stderr: '', status: null, locked: false, lock: null, command: null,
      readOnly: null, error: 'no-directory',
      reason: `a repository directory is required; got ${dir === null ? 'null' : typeof dir === 'string' ? 'an empty string' : typeof dir}. Refusing rather than defaulting to the current directory.` }
  }
  const argv = (Array.isArray(args) ? args : []).map(String)
  const sub = argv.find(a => !a.startsWith('-')) || ''
  const readOnly = opts.write === true ? false : (opts.write === false ? true : READ_COMMANDS.has(sub))
  // The flag goes before the subcommand — it is a git-level option, not a subcommand one.
  const full = ['-C', String(dir ?? ''), ...(readOnly ? ['--no-optional-locks'] : []), ...argv]

  let r
  try {
    r = spawnSync('git', full, {
      timeout: opts.timeout ?? 30_000,
      maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024,
      encoding: 'utf8',
    })
  } catch (e) {
    return { ok: false, stdout: '', stderr: String(e.message), status: null, locked: false, lock: null, command: full, readOnly, error: 'spawn-failed' }
  }

  const stdout = String(r.stdout ?? '')
  const stderr = String(r.stderr ?? '')
  const ok = r.status === 0
  const locked = !ok && isLockError(stderr)
  return {
    ok, stdout, stderr, status: r.status, readOnly, command: full,
    locked,
    // The lock is only stat'd when one is actually implicated, so the happy path costs nothing.
    lock: locked ? lockInfo(dir) : null,
    // A message a caller can put in front of a person, instead of exit 128 and a path.
    reason: ok ? null
      : locked ? `another git process is using ${dir} — this is contention, not corruption; nothing was changed`
      : r.error?.code === 'ETIMEDOUT' || r.signal ? `git ${sub} timed out after ${opts.timeout ?? 30_000}ms`
      : stderr.trim().split('\n')[0] || `git ${sub} exited ${r.status}`,
  }
}

/** Convenience: stdout of a read command, or null. Never partially-true — a failure gives null. */
export function gitOut(dir, args, opts = {}) {
  const r = git(dir, args, opts)
  return r.ok ? r.stdout.trim() : null
}

/**
 * Check that a repository's `origin` points where the caller expects, before writing to it.
 *
 * The failure this prevents: a dashboard configured against one checkout pushing into a different
 * repository because the folder was re-pointed, or a worktree was reused. Comparison is on the
 * normalised host+path, so `git@github.com:o/r.git`, `https://github.com/o/r` and a trailing slash
 * are the same remote — they genuinely are, and a false mismatch here would block legitimate work,
 * which is how safety checks get switched off.
 *
 * Returns `{ok:false, reason:'no-remote'}` rather than passing when origin cannot be read: unknown
 * is not a match.
 */
export function normaliseRemote(url) {
  let s = String(url ?? '').trim()
  if (!s) return null
  s = s.replace(/\.git$/, '').replace(/\/+$/, '')
  // scp-style: git@host:owner/repo
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(s)
  if (scp) return `${scp[1].toLowerCase()}/${scp[2].replace(/^\/+/, '')}`
  try {
    const u = new URL(s)
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`
  } catch { return s.toLowerCase() }
}

export function checkOrigin(dir, expected) {
  const actual = gitOut(dir, ['remote', 'get-url', 'origin'], { timeout: 5000 })
  if (!actual) return { ok: false, reason: 'no-remote', detail: `${dir} has no readable "origin" remote, so there is nothing to check a write against` }
  if (!expected) return { ok: false, reason: 'no-expectation', actual, detail: 'no expected remote was configured — refusing to assert a match that was never stated' }
  const a = normaliseRemote(actual), e = normaliseRemote(expected)
  if (a !== e) return { ok: false, reason: 'remote-mismatch', actual, expected, detail: `${dir} points at ${actual}, not ${expected} — refusing to write` }
  return { ok: true, actual, expected }
}
