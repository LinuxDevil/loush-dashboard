// Git worktree lifecycle + attribution (feature 090). READ ONLY.
//
// What this is for: the dashboard already correlates `~/.claude/projects/**/*.jsonl` sessions
// to repos on disk. Every session record carries a `cwd`. If that cwd sits inside a linked
// worktree rather than the main checkout, we can say WHICH WORKTREE an agent run executed in —
// a claim the agent harness itself never records, so nothing upstream can self-report it.
//
// Deliberately absent: create / remove / prune. Those mutate a user's repository and a wrong
// `git worktree remove --force` destroys uncommitted work. Nothing in this file writes.
//
// Three rules this codebase enforces, applied here:
//
//  1. "Unknown is a value." listWorktrees() never answers `[]` for a question it could not ask.
//     A missing git binary, a directory that is not a repo, and a repo with genuinely one
//     worktree are three different answers, and every one of them is distinguishable by
//     `status` + `reason` + `code`. Conflating "we could not look" with "there is nothing
//     there" is the specific bug this codebase keeps hunting.
//
//  2. No silent caps. Every bound below (spawn timeout, stdout maxBuffer, the parent-directory
//     ascent limit in detectWorktree) is reported when it is hit, never absorbed.
//
//  3. Parsing never throws. Malformed porcelain returns whatever parsed, with the lines we did
//     not understand preserved on the entry rather than dropped on the floor.
//
// Subprocess policy: git is always invoked via spawnSync with an argv ARRAY and an explicit
// `cwd`. Never a shell string — a repo path or a branch name must never be able to become a
// command. `shell: true` is never set, on any platform.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// Matches server/index.mjs's WIN constant. Only used for path CASE folding and separator
// normalisation; we never enable `shell` for it.
const WIN = process.platform === 'win32'

// ---------------------------------------------------------------------------------------------
// 1. parseWorktreeList — pure. No filesystem, no subprocess, no throwing.
// ---------------------------------------------------------------------------------------------

// Real `git worktree list --porcelain` output (git 2.43.0), captured from a scratch repo with a
// main checkout, a linked branch worktree, a detached worktree whose directory was then deleted,
// and a locked worktree:
//
//     worktree /tmp/wt/main
//     HEAD cba4d719f9560267c8506f901a280943678b8bdb
//     branch refs/heads/master
//
//     worktree /tmp/wt/detached
//     HEAD cba4d719f9560267c8506f901a280943678b8bdb
//     detached
//     prunable gitdir file points to non-existent location
//
//     worktree /tmp/wt/locked
//     HEAD cba4d719f9560267c8506f901a280943678b8bdb
//     branch refs/heads/locked-branch
//     locked testing
//
// and for a bare repository — note there is no HEAD line at all:
//
//     worktree /tmp/wt/barerepo.git
//     bare
//
// Shape notes that drive the parser:
//  · Records are separated by a blank line; the final record is followed by one too, but we do
//    not depend on that (a truncated stream still yields its last entry).
//  · An attribute is `label` alone (bare, detached, locked-with-no-reason) or `label value`.
//  · `locked` and `prunable` may or may not carry a reason. Presence is the signal; the reason
//    is extra. `locked` with no reason is what `git worktree lock` without --reason produces.
//  · `branch` is a full ref (refs/heads/feature/x). Branch names contain slashes, so only the
//    literal `refs/heads/` prefix is stripped for the convenience `branchName` field.

const LOCK_UNSET = null

const emptyEntry = () => ({
  path: null,
  head: null,
  branch: null,       // full ref as git printed it, e.g. "refs/heads/feature/x"
  branchName: null,   // same with a leading "refs/heads/" removed; null when detached or bare
  bare: false,
  detached: false,
  locked: false,
  lockReason: LOCK_UNSET,   // null means "locked with no reason given" OR "not locked" — read `locked` first
  prunable: false,
  prunableReason: LOCK_UNSET,
  unparsed: [],       // lines inside this record we did not recognise, kept verbatim
})

/**
 * Parse `git worktree list --porcelain` output.
 *
 * @param {string} porcelainOutput
 * @returns {Array<object>} one entry per worktree, in git's own order (main checkout first).
 *
 * Pure and total: any input at all — null, a number, half a record, Windows CRLF endings,
 * a stray line before the first `worktree` — produces an array. Never throws, never caps.
 * A record with no `worktree` line has no identity and is skipped; every other unrecognised
 * line lands in that entry's `unparsed` so a reader can see what we ignored.
 */
export function parseWorktreeList(porcelainOutput) {
  if (typeof porcelainOutput !== 'string' || porcelainOutput === '') return []

  const out = []
  let cur = null
  const flush = () => { if (cur && cur.path != null) out.push(cur); cur = null }

  // \r is stripped so git-for-windows' CRLF output parses identically to POSIX output.
  for (const raw of porcelainOutput.split('\n')) {
    const line = raw.replace(/\r+$/, '')
    if (line === '') { flush(); continue }

    const sp = line.indexOf(' ')
    const label = sp === -1 ? line : line.slice(0, sp)
    const value = sp === -1 ? '' : line.slice(sp + 1)

    if (label === 'worktree') {
      flush()
      cur = emptyEntry()
      // A `worktree` line with no path is malformed; the entry stays identity-less and is
      // dropped at flush() rather than surfacing as a worktree at path "".
      cur.path = value === '' ? null : value
      continue
    }

    // Attributes before the first `worktree` line belong to no record — there is nothing to
    // attach them to, and attaching them to the next record would misreport that worktree's
    // branch or lock state. They are dropped. Git never emits this; the branch exists so a
    // prefix of garbage cannot shift the parse of everything after it.
    if (!cur) continue

    switch (label) {
      case 'HEAD':
        cur.head = value || null
        break
      case 'branch':
        cur.branch = value || null
        cur.branchName = value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : (value || null)
        break
      case 'bare':
        cur.bare = true
        break
      case 'detached':
        cur.detached = true
        break
      case 'locked':
        cur.locked = true
        cur.lockReason = value === '' ? null : value
        break
      case 'prunable':
        cur.prunable = true
        cur.prunableReason = value === '' ? null : value
        break
      default:
        // Forward compatibility: a future git may add attributes. Keep them rather than
        // pretending the record was fully understood.
        cur.unparsed.push(line)
    }
  }
  flush()
  return out
}

// ---------------------------------------------------------------------------------------------
// 2. detectWorktree — is this directory inside a linked worktree?
// ---------------------------------------------------------------------------------------------

// How many parent directories we will climb looking for a `.git`. Reported, never silent:
// exhausting it yields status 'unknown' with reason 'ascend-limit', not a confident "no".
export const MAX_ASCEND = 64

const unknown = (code, reason, extra = {}) =>
  ({ isWorktree: null, kind: null, gitDir: null, mainRepo: null, name: null, code, reason, ...extra })

/**
 * @param {string} dir absolute or relative path to a directory
 * @param {{maxAscend?: number}} [opts]
 * @returns {{isWorktree: boolean|null, kind: string|null, gitDir: string|null,
 *            mainRepo: string|null, name: string|null, code: string, reason: string,
 *            root?: string}}
 *
 * `isWorktree === null` means UNKNOWN — we could not tell. It is never a stand-in for false.
 *   true  → kind 'linked': `dir` (or an ancestor) is a linked worktree.
 *   false → kind 'main' (an ordinary checkout), 'bare', 'submodule', or 'none' (no repo found).
 *   null  → kind null, with `code` naming why we could not answer.
 *
 * The mechanic: a linked worktree's `.git` is a FILE, not a directory, containing exactly
 * `gitdir: <path>` — e.g. `gitdir: /repo/.git/worktrees/feat-x`. That path's `worktrees/<name>`
 * tail is what distinguishes a worktree from a submodule, whose `.git` file is the same shape
 * but points at `<super>/.git/modules/<name>`. Both are `.git` files; only the middle segment
 * tells them apart, and treating a submodule as a worktree would attribute every submodule
 * session to a worktree that does not exist.
 */
export function detectWorktree(dir, opts = {}) {
  if (typeof dir !== 'string' || dir.trim() === '') {
    return unknown('bad-input', 'detectWorktree requires a non-empty directory path')
  }
  const maxAscend = Number.isInteger(opts.maxAscend) && opts.maxAscend >= 0 ? opts.maxAscend : MAX_ASCEND
  let cur = path.resolve(dir)

  for (let steps = 0; steps <= maxAscend; steps++) {
    const dotGit = path.join(cur, '.git')
    let st
    try {
      st = fs.lstatSync(dotGit)
    } catch (err) {
      const code = err && err.code
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        st = null // nothing here; keep climbing
      } else if (code === 'EACCES' || code === 'EPERM') {
        return unknown('permission-denied', `cannot stat ${dotGit}: ${code}`, { root: cur })
      } else {
        return unknown('stat-failed', `cannot stat ${dotGit}: ${code || err.message}`, { root: cur })
      }
    }

    if (st && st.isDirectory()) {
      // An ordinary (non-linked) checkout. Definitively not a worktree — a real answer.
      return {
        isWorktree: false, kind: 'main', gitDir: dotGit, mainRepo: cur, name: path.basename(cur),
        code: 'main', reason: `${dotGit} is a directory — ordinary checkout, not a linked worktree`,
        root: cur,
      }
    }

    if (st && (st.isFile() || st.isSymbolicLink())) {
      let text
      try { text = fs.readFileSync(dotGit, 'utf8') }
      catch (err) {
        const code = err && err.code
        if (code === 'EACCES' || code === 'EPERM') return unknown('permission-denied', `cannot read ${dotGit}: ${code}`, { root: cur })
        return unknown('read-failed', `cannot read ${dotGit}: ${code || err.message}`, { root: cur })
      }
      const parsed = parseGitFile(text, cur)
      if (!parsed.gitDir) {
        return unknown('unparsable-git-file', `${dotGit} is a file but has no "gitdir:" line (${JSON.stringify(text.slice(0, 120))})`, { root: cur })
      }
      const linked = linkedWorktreeFrom(parsed.gitDir)
      if (linked) {
        return {
          isWorktree: true, kind: 'linked', gitDir: parsed.gitDir, mainRepo: linked.mainRepo,
          name: linked.name, code: 'linked',
          reason: `${dotGit} points at ${parsed.gitDir}`,
          root: cur,
        }
      }
      if (/(^|[\\/])modules([\\/]|$)/.test(parsed.gitDir)) {
        return {
          isWorktree: false, kind: 'submodule', gitDir: parsed.gitDir, mainRepo: null,
          name: path.basename(cur), code: 'submodule',
          reason: `${dotGit} points into a modules/ directory — this is a submodule, not a worktree`,
          root: cur,
        }
      }
      // A `.git` file that is neither worktree- nor submodule-shaped. We know it is a repo of
      // some kind, but not what, so the worktree question is unknown rather than "no".
      return unknown('unrecognised-gitdir', `${dotGit} points at ${parsed.gitDir}, which has no worktrees/ or modules/ segment`, { gitDir: parsed.gitDir, root: cur })
    }

    const parent = path.dirname(cur)
    if (parent === cur) {
      return {
        isWorktree: false, kind: 'none', gitDir: null, mainRepo: null, name: null,
        code: 'not-a-repo', reason: `no .git found in ${path.resolve(dir)} or any parent up to the filesystem root`,
      }
    }
    cur = parent
  }

  // Bound hit. Reported, not swallowed — see rule 2 at the top of this file.
  return unknown('ascend-limit', `stopped after ${maxAscend} parent directories without finding a .git (raise opts.maxAscend to look further)`, { root: cur })
}

/**
 * Parse the body of a linked worktree's `.git` file. Exported because the porcelain-free
 * detection primitive is useful on its own (and testable without a filesystem).
 *
 * @param {string} text contents of a `.git` FILE
 * @param {string} [baseDir] directory the file lives in, used to resolve a relative gitdir —
 *        `git worktree add --relative-paths` (git 2.48+) writes `gitdir: ../.git/worktrees/x`.
 * @returns {{gitDir: string|null, relative: boolean}}
 */
export function parseGitFile(text, baseDir) {
  if (typeof text !== 'string') return { gitDir: null, relative: false }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r+$/, '')
    const m = /^gitdir:(.*)$/.exec(line)
    if (!m) continue
    // Trimmed, not lazily matched: `gitdir:   ` (whitespace only) must read as "no target",
    // and a regex that lets `.+?` claim a space reports a gitdir of " ".
    const target = m[1].trim()
    if (target === '') return { gitDir: null, relative: false }
    const isAbs = path.isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target)
    if (isAbs) return { gitDir: target, relative: false }
    return { gitDir: baseDir ? path.resolve(baseDir, target) : target, relative: true }
  }
  return { gitDir: null, relative: false }
}

/**
 * Given `<repo>/.git/worktrees/<name>`, recover `<repo>` and `<name>`.
 * Returns null when the path is not worktree-shaped.
 *
 * Two layouts to survive:
 *   non-bare: /repo/.git/worktrees/feat-x   → mainRepo /repo
 *   bare:     /repo.git/worktrees/feat-x    → mainRepo /repo.git  (there is no .git segment
 *                                             to strip; the bare repo dir IS the git dir)
 */
function linkedWorktreeFrom(gitDir) {
  const norm = gitDir.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = norm.split('/')
  // Scan from the right: the LAST `worktrees` segment wins, because a repository may itself
  // live under a directory innocently named "worktrees".
  const i = parts.lastIndexOf('worktrees')
  if (i === -1 || i !== parts.length - 2) return null // must be .../worktrees/<name>
  const name = parts[parts.length - 1]
  if (!name) return null
  const container = parts.slice(0, i).join('/') || '/'   // the git dir itself
  const mainRepo = path.basename(container) === '.git' ? path.dirname(container) : container
  return { name, mainRepo }
}

// ---------------------------------------------------------------------------------------------
// 3. listWorktrees — the only function here that runs a subprocess.
// ---------------------------------------------------------------------------------------------

export const GIT_TIMEOUT_MS = 10_000
export const GIT_MAX_BUFFER = 16 * 1024 * 1024   // 16 MiB of porcelain is ~150k worktrees

/**
 * @param {string} repoDir directory to run git in
 * @param {{gitBin?: string, timeoutMs?: number, maxBuffer?: number, spawn?: Function}} [opts]
 *        `spawn` is an injection point for tests only; it defaults to node's spawnSync and is
 *        called with exactly the same (bin, argv-array, options) triple.
 * @returns {{status: 'ok', worktrees: Array<object>, argv: string[]}
 *          |{status: 'unknown', code: string, reason: string, argv: string[], stderr?: string}}
 *
 * There is no third shape. `status: 'ok'` means git answered and we parsed its answer — a
 * one-element `worktrees` array is a real repo with exactly one worktree. Every failure is
 * `status: 'unknown'` with a `code` a caller can branch on and a `reason` a caller can print.
 * We never return `{status:'ok', worktrees: []}` for a question we failed to ask, and git
 * itself never legitimately returns zero worktrees for a real repository.
 *
 * codes: bad-input · dir-missing · not-a-directory · permission-denied · git-missing ·
 *        spawn-failed · timeout · output-truncated · not-a-repo · git-error · empty-output
 */
export function listWorktrees(repoDir, opts = {}) {
  const gitBin = typeof opts.gitBin === 'string' && opts.gitBin ? opts.gitBin : 'git'
  const timeout = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : GIT_TIMEOUT_MS
  const maxBuffer = Number.isFinite(opts.maxBuffer) ? opts.maxBuffer : GIT_MAX_BUFFER
  const run = typeof opts.spawn === 'function' ? opts.spawn : spawnSync
  const args = ['worktree', 'list', '--porcelain']
  const argv = [gitBin, ...args]

  if (typeof repoDir !== 'string' || repoDir.trim() === '') {
    return { status: 'unknown', code: 'bad-input', reason: 'listWorktrees requires a non-empty directory path', argv }
  }

  // Pre-flight the directory. spawnSync reports a MISSING CWD with the same ENOENT it reports
  // for a missing binary, and "git is not installed" must never be confused with "that folder
  // is gone" — they lead a user to completely different fixes.
  try {
    const st = fs.statSync(repoDir)
    if (!st.isDirectory()) return { status: 'unknown', code: 'not-a-directory', reason: `${repoDir} is not a directory`, argv }
  } catch (err) {
    const code = err && err.code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { status: 'unknown', code: 'dir-missing', reason: `${repoDir} does not exist (${code})`, argv }
    if (code === 'EACCES' || code === 'EPERM') return { status: 'unknown', code: 'permission-denied', reason: `cannot stat ${repoDir}: ${code}`, argv }
    return { status: 'unknown', code: 'spawn-failed', reason: `cannot stat ${repoDir}: ${code || err.message}`, argv }
  }

  let r
  try {
    // argv ARRAY, explicit cwd, no shell — on any platform, including Windows.
    r = run(gitBin, args, { cwd: repoDir, encoding: 'utf8', timeout, maxBuffer })
  } catch (err) {
    return { status: 'unknown', code: 'spawn-failed', reason: `spawning ${gitBin} threw ${(err && err.code) || (err && err.message)}`, argv }
  }
  if (!r || typeof r !== 'object') {
    return { status: 'unknown', code: 'spawn-failed', reason: `${gitBin} produced no result object`, argv }
  }

  const stderr = String(r.stderr || '').trim()

  if (r.error) {
    const code = r.error.code || ''
    if (code === 'ENOENT') {
      return { status: 'unknown', code: 'git-missing', reason: `git binary ${JSON.stringify(gitBin)} not found on PATH (ENOENT) — no worktree information could be read`, argv, stderr }
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { status: 'unknown', code: 'permission-denied', reason: `cannot execute ${JSON.stringify(gitBin)}: ${code}`, argv, stderr }
    }
    if (code === 'ETIMEDOUT') {
      return { status: 'unknown', code: 'timeout', reason: `${gitBin} exceeded the ${timeout}ms timeout`, argv, stderr }
    }
    if (code === 'ENOBUFS') {
      // A reported bound, per rule 2. Partial porcelain is not returned as if it were complete.
      return { status: 'unknown', code: 'output-truncated', reason: `git produced more than the ${maxBuffer}-byte maxBuffer; the list would be incomplete so none is returned (raise opts.maxBuffer)`, argv, stderr }
    }
    return { status: 'unknown', code: 'spawn-failed', reason: `${gitBin} failed: ${code || r.error.message}`, argv, stderr }
  }

  // status === null means killed — by the timeout, or by a signal.
  if (r.status === null || r.status === undefined) {
    const why = r.signal ? `killed by signal ${r.signal}` : `exceeded the ${timeout}ms timeout`
    return { status: 'unknown', code: 'timeout', reason: `${gitBin} ${why}`, argv, stderr }
  }

  if (r.status !== 0) {
    if (/not a git repository/i.test(stderr)) {
      return { status: 'unknown', code: 'not-a-repo', reason: `${repoDir} is not inside a git repository (git exit ${r.status})`, argv, stderr }
    }
    if (/permission denied|dubious ownership/i.test(stderr)) {
      return { status: 'unknown', code: 'permission-denied', reason: `git refused to read ${repoDir}: ${stderr || `exit ${r.status}`}`, argv, stderr }
    }
    return { status: 'unknown', code: 'git-error', reason: `git exited ${r.status}: ${stderr || '(no stderr)'}`, argv, stderr }
  }

  const stdout = String(r.stdout || '')
  const worktrees = parseWorktreeList(stdout)
  if (worktrees.length === 0) {
    // git exited 0 but named no worktree. Every real repository has at least the main one, so
    // this is a broken answer, not an empty one — and an empty array here is exactly the lie
    // this module exists to avoid.
    return { status: 'unknown', code: 'empty-output', reason: `git exited 0 but listed no worktrees — output was ${JSON.stringify(stdout.slice(0, 200))}`, argv, stderr }
  }
  return { status: 'ok', worktrees, argv }
}

// ---------------------------------------------------------------------------------------------
// 4. attributeSession — which worktree did this session's cwd live in?
// ---------------------------------------------------------------------------------------------

/**
 * Normalise a path for comparison: forward slashes, no trailing separator, case-folded on
 * Windows (and on request).
 *
 * Windows handling is deliberately shallow but real: separators are unified and comparison is
 * case-insensitive, which covers `C:\Users\me\repo` vs `C:/Users/me/repo/`. NOT handled:
 * 8.3 short names (PROGRA~1), substituted drives, `\\?\` prefixes, and UNC-vs-mapped-drive
 * aliasing — two spellings of the same directory through those mechanisms will not match, and
 * we return null rather than guessing. On POSIX, comparison is exact and case-sensitive, since
 * two paths differing only in case genuinely are two directories there.
 */
export function normalizeForCompare(p, { caseInsensitive = WIN } = {}) {
  if (typeof p !== 'string' || p === '') return null
  let s = p.replace(/\\/g, '/')
  s = s.replace(/\/{2,}/g, (m, off) => (off === 0 ? m : '/'))  // collapse inner runs, keep a UNC lead
  if (s.length > 1) s = s.replace(/\/+$/, '')
  return caseInsensitive ? s.toLowerCase() : s
}

const isUnder = (child, parent) =>
  child === parent || child.startsWith(parent.endsWith('/') ? parent : parent + '/')
  // The trailing-separator check is load-bearing: without it `/repo/app-v2` matches the
  // worktree `/repo/app`, and every session in a sibling directory gets attributed to the
  // wrong branch.

/**
 * @param {string} cwd a session's recorded working directory
 * @param {Array<object>|{worktrees: Array<object>}} worktrees entries from parseWorktreeList /
 *        listWorktrees (the whole `{status:'ok', worktrees}` result is accepted too)
 * @param {{caseInsensitive?: boolean, includeBare?: boolean}} [opts]
 * @returns {object|null} the SAME entry object from the input list, or null.
 *
 * Longest path prefix wins: nested worktrees are legal (`/repo` and `/repo/wt/feat`), and the
 * deepest containing worktree is the one the session actually ran in. Ties — two entries with
 * the same normalised path — resolve to the first in git's order, which is the main checkout.
 *
 * Returns null, never a best guess. An unmatched cwd means the session ran outside every
 * worktree we know about (a different repo, a deleted checkout, a path from another machine),
 * and inventing an attribution there would put a branch name next to a run that never touched
 * it — worse than a blank cell, because a blank cell is legible as "we don't know".
 *
 * Bare entries are excluded by default: a bare repository has no working tree, so no session
 * can have run "in" it. Pass `includeBare: true` to consider them anyway.
 */
export function attributeSession(cwd, worktrees, opts = {}) {
  const list = Array.isArray(worktrees) ? worktrees
    : (worktrees && Array.isArray(worktrees.worktrees) ? worktrees.worktrees : null)
  if (!list || list.length === 0) return null

  const caseInsensitive = opts.caseInsensitive ?? WIN
  const target = normalizeForCompare(cwd, { caseInsensitive })
  if (!target) return null

  let best = null
  let bestLen = -1
  for (const wt of list) {
    if (!wt || typeof wt.path !== 'string') continue
    if (wt.bare && !opts.includeBare) continue
    const p = normalizeForCompare(wt.path, { caseInsensitive })
    if (!p) continue
    if (!isUnder(target, p)) continue
    if (p.length > bestLen) { best = wt; bestLen = p.length }  // strict >: first entry wins a tie
  }
  return best
}
