
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const WIN = process.platform === 'win32'

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------


const LOCK_UNSET = null

const emptyEntry = () => ({
  path: null,
  head: null,
  branch: null,
  branchName: null,
  bare: false,
  detached: false,
  locked: false,
  lockReason: LOCK_UNSET,
  prunable: false,
  prunableReason: LOCK_UNSET,
  unparsed: [],
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

  for (const raw of porcelainOutput.split('\n')) {
    const line = raw.replace(/\r+$/, '')
    if (line === '') { flush(); continue }

    const sp = line.indexOf(' ')
    const label = sp === -1 ? line : line.slice(0, sp)
    const value = sp === -1 ? '' : line.slice(sp + 1)

    if (label === 'worktree') {
      flush()
      cur = emptyEntry()
      cur.path = value === '' ? null : value
      continue
    }

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
        cur.unparsed.push(line)
    }
  }
  flush()
  return out
}

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

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
        st = null
      } else if (code === 'EACCES' || code === 'EPERM') {
        return unknown('permission-denied', `cannot stat ${dotGit}: ${code}`, { root: cur })
      } else {
        return unknown('stat-failed', `cannot stat ${dotGit}: ${code || err.message}`, { root: cur })
      }
    }

    if (st && st.isDirectory()) {
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
  const i = parts.lastIndexOf('worktrees')
  if (i === -1 || i !== parts.length - 2) return null
  const name = parts[parts.length - 1]
  if (!name) return null
  const container = parts.slice(0, i).join('/') || '/'
  const mainRepo = path.basename(container) === '.git' ? path.dirname(container) : container
  return { name, mainRepo }
}

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

export const GIT_TIMEOUT_MS = 10_000
export const GIT_MAX_BUFFER = 16 * 1024 * 1024

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
      return { status: 'unknown', code: 'output-truncated', reason: `git produced more than the ${maxBuffer}-byte maxBuffer; the list would be incomplete so none is returned (raise opts.maxBuffer)`, argv, stderr }
    }
    return { status: 'unknown', code: 'spawn-failed', reason: `${gitBin} failed: ${code || r.error.message}`, argv, stderr }
  }

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
    return { status: 'unknown', code: 'empty-output', reason: `git exited 0 but listed no worktrees — output was ${JSON.stringify(stdout.slice(0, 200))}`, argv, stderr }
  }
  return { status: 'ok', worktrees, argv }
}

// ---------------------------------------------------------------------------------------------
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
  s = s.replace(/\/{2,}/g, (m, off) => (off === 0 ? m : '/'))
  if (s.length > 1) s = s.replace(/\/+$/, '')
  return caseInsensitive ? s.toLowerCase() : s
}

const isUnder = (child, parent) =>
  child === parent || child.startsWith(parent.endsWith('/') ? parent : parent + '/')

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
    if (p.length > bestLen) { best = wt; bestLen = p.length }
  }
  return best
}
