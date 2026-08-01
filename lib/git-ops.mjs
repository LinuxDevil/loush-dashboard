// lib/git-ops.mjs — status / diff / stage / unstage / commit / branch-list, over lib/git-safe.mjs.
//
// EVERY git invocation goes through `git()` from lib/git-safe.mjs. Nothing here spawns a process of
// its own: git-safe is what applies `--no-optional-locks` to reads (so the dashboard never fights the
// user's terminal for `.git/index.lock`), what classifies read vs write, and what turns a lock
// collision into `{locked:true, lock:{path, ageMs, at}}`.
//
// EVERY function returns a structured result and never throws. `locked:true` is a DISTINCT outcome
// from a plain failure: it means the answer is unknown RIGHT NOW because the repo is busy, which the
// UI must render as "busy" — showing "no changes" while another git process holds the index lock is
// the exact failure this batch exists to prevent. (House rule 1: unknown is a value.)
//
// PATH CONTAINMENT
// `stage`/`unstage`/`diff` take client-supplied paths. Containment is checked on the RESOLVED path
// (realpath of the deepest existing ancestor + the remainder), so neither `../../etc/passwd` nor a
// symlink planted inside the tree passes. `.git` itself is refused too — `git add .git/config` would
// be a way to get the dashboard to stage credentials.
//
// No path is ever concatenated into a string. Every git call is an argv array, and every user path
// goes after `--`, so a file literally named `--output=x` is a filename and not an option.

import fs from 'node:fs'
import path from 'node:path'
import { git, gitOut } from './git-safe.mjs'
import { parsePorcelainV1Z, STATUS_LIMITS } from './git-status.mjs'

export const OPS_LIMITS = Object.freeze({
  maxPaths: 500,                     // one request must not build a 100k-argument execve
  maxDiffBytes: 4 * 1024 * 1024,     // a diff larger than this is truncated — and says so
  maxCommitMessageBytes: 64 * 1024,
  maxBranches: 2000,
  gitTimeoutMs: 10_000,
  ...STATUS_LIMITS,
})

/** Uniform shapes so a caller never has to guess which kind of failure it got. */
const err = (reason, extra = {}) => ({ ok: false, locked: false, lock: null, reason, limits: OPS_LIMITS, ...extra })
const fromGit = (r, extra = {}) => ({
  ok: false, locked: Boolean(r.locked), lock: r.lock || null,
  // A locked repo gets ONE canonical reason so every route can branch on it identically, regardless
  // of which of git-safe's wordings ('locked', 'repo-locked', …) it happens to use.
  reason: r.locked ? 'repo-locked' : r.reason,
  stderr: r.stderr, status: r.status, command: r.command, limits: OPS_LIMITS, ...extra,
})

/**
 * Resolve the repository top level for `dir`.
 * Kept here (rather than assumed of git-safe) so this module depends only on `git`/`gitOut`.
 */
export function repoRootOf(dir) {
  const r = git(dir, ['rev-parse', '--show-toplevel'])
  if (!r.ok) {
    if (r.locked) return { ok: false, locked: true, lock: r.lock || null, reason: 'repo-locked' }
    // git exits 128 both for "not a repository" and for an unreadable directory; the stderr tells
    // them apart, and the user needs to know which one it was.
    if (/not a git repository/i.test(r.stderr || '')) return { ok: false, locked: false, reason: 'not-a-git-repo' }
    return { ok: false, locked: false, reason: r.reason || 'repo-root-unknown', stderr: r.stderr }
  }
  const top = (r.stdout || '').trim()
  if (!top) return { ok: false, locked: false, reason: 'no-toplevel' }
  try { return { ok: true, root: fs.realpathSync(top) } } catch { return { ok: true, root: path.resolve(top) } }
}

/**
 * Resolve a repo-relative (or absolute) path and prove it is inside `root`.
 * Checked AFTER realpath, which is what makes both `..` traversal and symlink escape fail.
 * @returns {{ok:true, abs:string, rel:string, exists:boolean} | {ok:false, reason:string, check:string}}
 */
export function resolveInRepo(root, p) {
  if (typeof p !== 'string' || p === '') return { ok: false, reason: 'path-empty', check: 'type' }
  // A NUL truncates the string inside the syscall, so `ok.txt\0/../../etc` could pass a JS-level
  // check and then behave as something else. Refuse rather than sanitise.
  if (p.includes('\0')) return { ok: false, reason: 'path-contains-nul', check: 'nul' }
  const abs = path.resolve(root, p)

  // realpath the deepest ancestor that EXISTS: a path being staged may legitimately not exist any
  // more (staging a deletion), so realpath(abs) alone would ENOENT on valid input.
  let probe = abs
  const tail = []
  for (;;) {
    try { probe = fs.realpathSync(probe); break } catch (e) {
      if (e && e.code !== 'ENOENT') return { ok: false, reason: 'path-unreadable', check: 'realpath', errno: e?.code || null }
      const parent = path.dirname(probe)
      if (parent === probe) return { ok: false, reason: 'path-unresolvable', check: 'realpath' }
      tail.unshift(path.basename(probe))
      probe = parent
    }
  }
  const resolved = tail.length ? path.join(probe, ...tail) : probe

  let realRoot = root
  try { realRoot = fs.realpathSync(root) } catch { /* the caller already proved root is a repo */ }

  // `path.relative` + the '..' test, NOT startsWith: '/home/u/proj-secrets'.startsWith('/home/u/proj')
  // is true, and a prefix match would therefore admit a sibling directory.
  const rel = path.relative(realRoot, resolved)
  if (rel === '') return { ok: false, reason: 'path-is-repo-root', check: 'containment' }
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, reason: 'path-outside-repository', check: 'containment', resolved }
  }
  if (rel.split(path.sep)[0] === '.git') return { ok: false, reason: 'path-inside-git-dir', check: 'git-dir', resolved }

  return { ok: true, abs: resolved, rel: rel.split(path.sep).join('/'), exists: tail.length === 0 }
}

function checkPaths(root, paths) {
  if (!Array.isArray(paths)) return err('paths-must-be-array')
  if (paths.length === 0) return err('paths-empty')
  if (paths.length > OPS_LIMITS.maxPaths) return err('too-many-paths', { given: paths.length, max: OPS_LIMITS.maxPaths })

  const resolved = []
  const refused = []
  for (const p of paths) {
    const r = resolveInRepo(root, p)
    if (r.ok) resolved.push(r)
    else refused.push({ path: typeof p === 'string' ? p : String(p), reason: r.reason, check: r.check })
  }
  // Fail the WHOLE request if any path is refused. Staging part of a batch and reporting success for
  // the rest would leave the user with an index they did not ask for and cannot see.
  if (refused.length) return err('path-refused', { refused })
  return { ok: true, resolved }
}

// ---------------------------------------------------------------------------------------------
// status

/**
 * @param {string} dir
 * @param {{untracked?:'no'|'normal'|'all', includeIgnored?:boolean, maxEntries?:number}} [opts]
 */
export function status(dir, opts = {}) {
  const root = repoRootOf(dir)
  if (!root.ok) return err(root.reason, { locked: Boolean(root.locked), lock: root.lock || null })

  const untracked = ['no', 'normal', 'all'].includes(opts.untracked) ? opts.untracked : 'normal'
  const args = ['status', '--porcelain=v1', '-z', '--branch', `--untracked-files=${untracked}`]
  if (opts.includeIgnored) args.push('--ignored=matching')

  const r = git(root.root, args, { timeout: OPS_LIMITS.gitTimeoutMs })
  if (!r.ok) return fromGit(r, { root: root.root })

  // git-safe hands back a decoded string. `parsePorcelainV1Z` also accepts a Buffer and preserves
  // non-UTF-8 filenames byte-for-byte when given one — see INTEGRATION-git.md, "raw stdout".
  const parsed = parsePorcelainV1Z(r.stdout, { maxEntries: opts.maxEntries })
  if (!parsed.ok) return err('unparseable-status', { parse: parsed, root: root.root })

  return {
    ok: true, locked: false, lock: null, root: root.root,
    entries: parsed.entries, branch: parsed.branch, counts: parsed.counts,
    // House rule 2: the truncation flag AND the modes that produced this listing are both reported,
    // so "12 changes" is never quietly "12 of 4000".
    truncated: parsed.truncated,
    limits: { ...OPS_LIMITS, ...parsed.limits },
    untrackedMode: untracked,
    ignoredIncluded: Boolean(opts.includeIgnored),
    warnings: parsed.warnings,
  }
}

// ---------------------------------------------------------------------------------------------
// diff

/**
 * @param {string} dir
 * @param {{path?:string, paths?:string[], staged?:boolean, contextLines?:number, maxBytes?:number}} [opts]
 */
export function diff(dir, opts = {}) {
  const root = repoRootOf(dir)
  if (!root.ok) return err(root.reason, { locked: Boolean(root.locked), lock: root.lock || null })

  const wanted = opts.paths || (opts.path ? [opts.path] : [])
  let rels = []
  if (wanted.length) {
    const c = checkPaths(root.root, wanted)
    if (!c.ok) return c
    rels = c.resolved.map(x => x.rel)
  }

  const ctx = Number.isInteger(opts.contextLines) && opts.contextLines >= 0 && opts.contextLines <= 50 ? opts.contextLines : 3
  const maxBytes = Number.isFinite(opts.maxBytes) && opts.maxBytes > 0
    ? Math.min(opts.maxBytes, OPS_LIMITS.maxDiffBytes) : OPS_LIMITS.maxDiffBytes

  const args = ['diff', '--no-color', '--no-ext-diff', `--unified=${ctx}`]
  if (opts.staged) args.push('--cached')
  // `--` ends option parsing: everything after it is a pathspec, so a file named `--output=x` is a
  // filename rather than an argument git would act on.
  args.push('--', ...rels)

  // Read up to the HARD cap, not up to `maxBytes`, so `totalBytes` below is the diff's real size and
  // the UI can say "showing 200KB of 3MB" instead of just "200KB".
  const r = git(root.root, args, { timeout: OPS_LIMITS.gitTimeoutMs, maxBuffer: OPS_LIMITS.maxDiffBytes + 1 })
  if (!r.ok) {
    if (/max-?buffer|ENOBUFS/i.test(String(r.reason || ''))) {
      return err('diff-too-large', { truncated: true, bytesLimit: maxBytes, hardLimit: OPS_LIMITS.maxDiffBytes, staged: Boolean(opts.staged) })
    }
    return fromGit(r, { root: root.root })
  }

  const text = r.stdout || ''
  const totalBytes = Buffer.byteLength(text, 'utf8')
  const truncated = totalBytes > maxBytes
  // Slice on a CHARACTER boundary derived from the byte budget: cutting a Buffer mid-codepoint would
  // emit a replacement character at the seam.
  const shown = truncated ? Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8').replace(/�$/, '') : text

  return {
    ok: true, locked: false, lock: null, root: root.root,
    diff: shown,
    bytes: Buffer.byteLength(shown, 'utf8'),
    totalBytes,
    truncated,                 // never a silently short diff
    bytesLimit: maxBytes,
    hardLimit: OPS_LIMITS.maxDiffBytes,
    staged: Boolean(opts.staged),
    contextLines: ctx,
    paths: rels,
    limits: OPS_LIMITS,
  }
}

// ---------------------------------------------------------------------------------------------
// stage / unstage

export function stage(dir, paths) {
  const root = repoRootOf(dir)
  if (!root.ok) return err(root.reason, { locked: Boolean(root.locked), lock: root.lock || null })
  const c = checkPaths(root.root, paths)
  if (!c.ok) return c
  const rels = c.resolved.map(x => x.rel)

  // `-A` so a DELETION is staged as a deletion (plain `git add` would ignore it); `--` so no path
  // can be read as a flag.
  const r = git(root.root, ['add', '-A', '--', ...rels], { write: true, timeout: OPS_LIMITS.gitTimeoutMs })
  if (!r.ok) return fromGit(r, { root: root.root, paths: rels })
  return { ok: true, locked: false, lock: null, root: root.root, staged: rels, count: rels.length, limits: OPS_LIMITS }
}

export function unstage(dir, paths) {
  const root = repoRootOf(dir)
  if (!root.ok) return err(root.reason, { locked: Boolean(root.locked), lock: root.lock || null })
  const c = checkPaths(root.root, paths)
  if (!c.ok) return c
  const rels = c.resolved.map(x => x.rel)

  // In a repository with NO commits yet there is no HEAD to restore from — `git restore --staged`
  // and `git reset HEAD --` both fail with "could not resolve HEAD". Verified against git 2.43.
  // The equivalent there is dropping the entry from the index outright.
  const hasHead = gitOut(root.root, ['rev-parse', '--verify', '--quiet', 'HEAD']) !== null
  const args = hasHead
    ? ['restore', '--staged', '--', ...rels]
    : ['rm', '--cached', '-r', '--quiet', '--', ...rels]

  const r = git(root.root, args, { write: true, timeout: OPS_LIMITS.gitTimeoutMs })
  if (!r.ok) {
    // git < 2.23 has no `restore`. Say so instead of leaving the file staged with a cryptic error.
    if (/is not a git command|unknown option/i.test(r.stderr || '')) {
      return fromGit(r, { root: root.root, reason: 'git-too-old-for-restore', needs: 'git >= 2.23' })
    }
    return fromGit(r, { root: root.root, paths: rels })
  }
  return {
    ok: true, locked: false, lock: null, root: root.root,
    unstaged: rels, count: rels.length,
    // Which mechanism was used is reported, because the two are not equivalent: in a headless repo
    // the file becomes untracked again rather than reverting to a committed version.
    via: hasHead ? 'restore --staged' : 'rm --cached (no HEAD yet)',
    limits: OPS_LIMITS,
  }
}

// ---------------------------------------------------------------------------------------------
// commit

/**
 * @param {string} dir
 * @param {string} message
 * @param {{allowEmpty?:boolean, amend?:boolean}} [opts]
 */
export function commit(dir, message, opts = {}) {
  // Refused BEFORE anything is spawned. `git commit -m ""` either opens an editor or aborts with a
  // version-dependent message; the user gets a confusing failure instead of "a message is required".
  if (typeof message !== 'string') return err('commit-message-required')
  if (message.trim() === '') return err('commit-message-empty')
  if (message.includes('\0')) return err('commit-message-contains-nul')
  const bytes = Buffer.byteLength(message, 'utf8')
  if (bytes > OPS_LIMITS.maxCommitMessageBytes) {
    return err('commit-message-too-long', { max: OPS_LIMITS.maxCommitMessageBytes, given: bytes })
  }

  const root = repoRootOf(dir)
  if (!root.ok) return err(root.reason, { locked: Boolean(root.locked), lock: root.lock || null })

  if (!opts.allowEmpty && !opts.amend) {
    const st = status(root.root)
    if (!st.ok) return st // includes the locked case, unchanged
    if (st.counts.conflicted > 0) return err('unresolved-conflicts', { conflicted: st.counts.conflicted, root: root.root })
    if (st.counts.staged === 0) return err('nothing-staged', { root: root.root })
  }

  // `--cleanup=verbatim`: the message the user typed is the message recorded. `--no-verify` is
  // deliberately NOT set — a repo's commit hooks are the repo's policy, and the dashboard does not
  // get to skip them on the user's behalf.
  const args = ['commit', '--cleanup=verbatim', '-m', message]
  if (opts.allowEmpty) args.push('--allow-empty')
  if (opts.amend) args.push('--amend')

  const r = git(root.root, args, { write: true, timeout: OPS_LIMITS.gitTimeoutMs })
  if (!r.ok) return fromGit(r, { root: root.root })

  const sha = gitOut(root.root, ['rev-parse', 'HEAD'])
  return {
    ok: true, locked: false, lock: null, root: root.root,
    // If HEAD cannot be read back the sha is UNKNOWN — null, not '' — so the UI cannot render a
    // blank link as if it were a commit.
    sha: sha || null,
    shaReason: sha ? null : 'head-unreadable-after-commit',
    amended: Boolean(opts.amend),
    allowEmpty: Boolean(opts.allowEmpty),
    output: r.stdout,
    limits: OPS_LIMITS,
  }
}

// ---------------------------------------------------------------------------------------------
// branches

// US (unit separator). git forbids control bytes in ref names, so this cannot occur inside a field —
// unlike a space or a tab, which a commit subject certainly can contain.
const REF_SEP = '\x1f'

/**
 * List local branches with upstream, head sha and subject.
 * `current` is null when HEAD is detached — that is the honest answer, not a guess at a branch.
 */
export function listBranches(dir, opts = {}) {
  const root = repoRootOf(dir)
  if (!root.ok) return err(root.reason, { locked: Boolean(root.locked), lock: root.lock || null })

  const max = Number.isFinite(opts.max) && opts.max > 0 ? Math.min(opts.max, OPS_LIMITS.maxBranches) : OPS_LIMITS.maxBranches
  const fmt = ['%(refname:short)', '%(objectname)', '%(upstream:short)', '%(committerdate:iso-strict)', '%(HEAD)', '%(subject)'].join(REF_SEP)

  // `for-each-ref` rather than `git branch`: its output is unaffected by column/colour config, and it
  // covers PACKED refs — after `git gc` a branch has no file under .git/refs/heads at all.
  const r = git(root.root, ['for-each-ref', `--format=${fmt}`, `--count=${max + 1}`, '--sort=-committerdate', 'refs/heads/'],
    { timeout: OPS_LIMITS.gitTimeoutMs })
  if (!r.ok) return fromGit(r, { root: root.root })

  const lines = (r.stdout || '').split('\n').filter(l => l !== '')
  const truncated = lines.length > max
  const branches = lines.slice(0, max).map(line => {
    const [name, sha, upstream, date, headMark, subject] = line.split(REF_SEP)
    return {
      name: name || null,
      sha: sha || null,
      upstream: upstream || null,        // null, not '' — "no upstream" is a real, distinct state
      committedAt: date || null,
      current: headMark === '*',
      subject: subject === undefined ? null : subject,
    }
  })

  const sym = git(root.root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { timeout: OPS_LIMITS.gitTimeoutMs })
  const current = sym.ok ? ((sym.stdout || '').trim() || null) : null

  return {
    ok: true, locked: false, lock: null, root: root.root,
    branches, current,
    // Exit status 1 from `symbolic-ref --quiet` means detached; any other failure means we could not
    // ask, which is NOT the same thing and must not be reported as a detached HEAD.
    detached: !sym.ok && sym.status === 1,
    headKnown: sym.ok || sym.status === 1,
    truncated, max, limits: OPS_LIMITS,
  }
}
