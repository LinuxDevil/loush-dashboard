// lib/git-watch.mjs — event-driven git watching. No polling loop.
//
// WHAT IT WATCHES AND WHY EACH ONE
//   .git/index          — staging. Every `git add` / `git restore --staged` rewrites it.
//   .git/HEAD           — branch SWITCH. `git checkout other` rewrites HEAD and touches nothing else
//                         if the branches point at the same commit, so an index-only watch would
//                         miss the switch entirely.
//   .git/refs/heads/<b> — commits on the current branch.
//   .git/refs/heads     — the DIRECTORY, because the file above is not a stable watch target: git
//                         updates a ref by writing `<ref>.lock` and renaming it over the ref. On
//                         Linux, inotify follows the INODE, so after the first commit the file watch
//                         is attached to a deleted inode and goes permanently silent. The directory
//                         watch is what keeps working. Both are established; either firing is enough.
//   .git/packed-refs    — after `git gc`/`git pack-refs` a branch may have NO file under refs/heads,
//                         and commits then show up only as a packed-refs rewrite.
//
// DEBOUNCE — WHAT IT COMPENSATES FOR
// fs.watch is not a reliable one-event-per-change API. Concretely, all of these are normal:
//   * inotify emits several events for one logical write (`rename` then `change`, or two `change`s
//     for truncate-then-write);
//   * git writes `index.lock`, writes into it, then renames it over `.git/index` — three separate
//     filesystem events for one `git add`;
//   * macOS FSEvents coalesces and re-delivers, and on some platforms the `filename` argument is null;
//   * a single `git commit` touches index, HEAD's ref, and logs within a few milliseconds.
// Without debouncing, one commit fans out into 5–10 `git:status-changed` events and the UI re-runs
// `git status` for each. The debounce window collapses a burst into one settled notification.
//
// A WATCH THAT FAILS IS REPORTED, NEVER SWALLOWED
// This is the whole point of the ticket. If inotify watches are exhausted (ENOSPC), or the platform
// does not support fs.watch on a directory, or `.git` is a file (a linked worktree) that could not be
// resolved — `start()` returns `{ok:false | degraded:true, watches:[...], fallback:'poll'}` and emits
// `watch-error`. Silently watching nothing produces a UI that LOOKS live and is frozen, which is
// strictly worse than a UI the user knows is polling. Callers get `pollIntervalMs` as the suggested
// fallback cadence.

import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { git, gitOut } from './git-safe.mjs'
import { repoRootOf } from './git-ops.mjs'

export const WATCH_DEFAULTS = Object.freeze({
  debounceMs: 120,          // long enough to swallow one git command's event burst
  cacheTtlMs: 1000,         // status cache; invalidated immediately on any watch event
  pollIntervalMs: 3000,     // what a caller should poll at IF watching is unavailable
  maxEventsPerSecond: 50,   // a runaway rebase must not livelock the event loop
})

export const EVENTS = Object.freeze({
  STATUS_CHANGED: 'git:status-changed',
  COMMIT_DETECTED: 'git:commit-detected',
  BRANCH_CHANGED: 'git:branch-changed',
  WATCH_ERROR: 'git:watch-error',
})

/**
 * Read HEAD's sha and branch. Either may legitimately be null — a detached HEAD has no branch and a
 * fresh repo has no sha — so `locked` distinguishes "there is none" from "we could not ask". A
 * locked repo is NOT a detached HEAD, and treating it as one would emit a phantom branch-change.
 */
function readHead(dir) {
  const sym = git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const rev = git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  return {
    branch: sym.ok ? ((sym.stdout || '').trim() || null) : null,
    sha: rev.ok ? ((rev.stdout || '').trim() || null) : null,
    locked: Boolean(sym.locked || rev.locked),
    reason: sym.ok ? null : (sym.locked ? 'repo-locked' : sym.reason),
  }
}

/**
 * Start watching `dir`.
 *
 * @param {string} dir
 * @param {{debounceMs?:number, cacheTtlMs?:number, pollIntervalMs?:number}} [opts]
 * @returns {{ok:boolean, degraded:boolean, reason:string|null, emitter:EventEmitter,
 *            watches:Array<{target:string, path:string, ok:boolean, reason:string|null}>,
 *            gitDir:string|null, root:string|null, head:object, dispose:()=>void,
 *            disposed:boolean, pollIntervalMs:number, fallback:'poll'|null,
 *            on:Function, off:Function, once:Function, invalidate:()=>void, cached:()=>object|null}}
 *          Never throws. `ok:false` means NOTHING is being watched; `degraded:true` means some
 *          targets are watched and some are not — in both cases the caller should poll.
 */
export function watchRepo(dir, opts = {}) {
  const emitter = new EventEmitter()
  const debounceMs = Number.isFinite(opts.debounceMs) && opts.debounceMs >= 0 ? opts.debounceMs : WATCH_DEFAULTS.debounceMs
  const cacheTtlMs = Number.isFinite(opts.cacheTtlMs) && opts.cacheTtlMs >= 0 ? opts.cacheTtlMs : WATCH_DEFAULTS.cacheTtlMs
  const pollIntervalMs = Number.isFinite(opts.pollIntervalMs) && opts.pollIntervalMs > 0 ? opts.pollIntervalMs : WATCH_DEFAULTS.pollIntervalMs
  // An ACTIVE watch holds the event loop open, like every other server resource. `persistent:false`
  // was tempting — it guarantees the process can exit — but it also means that if the watcher is the
  // only thing alive, node drains the loop and the watch stops firing while still reporting ok:true.
  // That is the "looks live, is frozen" failure again, so the handle is persistent and dispose() is
  // the thing that releases it. Pass `persistent:false` if the caller has its own keep-alive.
  const persistent = opts.persistent !== false

  const watchers = []
  const watches = []
  let timer = null
  let disposed = false
  let cache = null // {t, value}

  const base = {
    emitter, watches, pollIntervalMs,
    on: (...a) => (emitter.on(...a), api),
    off: (...a) => (emitter.off(...a), api),
    once: (...a) => (emitter.once(...a), api),
  }

  const api = {
    ...base,
    ok: false, degraded: true, reason: null, fallback: 'poll', locked: false,
    gitDir: null, root: null, head: { branch: null, sha: null },
    get disposed() { return disposed },
    dispose,
    invalidate: () => { cache = null },
    cached: () => (cache && Date.now() - cache.t < cacheTtlMs ? cache.value : null),
    putCache: v => { cache = { t: Date.now(), value: v } },
  }

  function dispose() {
    if (disposed) return
    disposed = true
    if (timer) { clearTimeout(timer); timer = null }
    for (const w of watchers) { try { w.close() } catch { /* already closed; closing twice must not throw */ } }
    watchers.length = 0
    cache = null
    // Remove listeners LAST so a dispose() called from inside a handler still completes, and so no
    // queued fs event can reach a listener after disposal — the leak this test suite checks for.
    emitter.removeAllListeners()
  }

  // A failure this early means NOTHING is watched. It must still be announced on the emitter, not
  // only in the return value: a caller that only subscribes to events would otherwise sit in silence
  // believing it is live. This is the exact "looks live, is frozen" failure the ticket names.
  function bail(reason, extra = {}) {
    api.reason = reason
    api.ok = false
    api.degraded = true
    api.fallback = 'poll'
    setImmediate(() => {
      if (!disposed) emitter.emit(EVENTS.WATCH_ERROR, { reason, watches, failed: [], fallback: 'poll', pollIntervalMs, ...extra })
    })
    return api
  }

  const root = repoRootOf(dir)
  if (!root.ok) {
    api.locked = Boolean(root.locked)
    return bail(root.reason, { locked: Boolean(root.locked) })
  }
  api.root = root.root

  // `.git` may be a FILE containing `gitdir: ...` (linked worktree, submodule), so never assume it is
  // a directory — watching `<root>/.git/index` would then be watching a path that does not exist and
  // the UI would look live while seeing nothing. Ask git where the real git dir is.
  const gitDir = gitOut(root.root, ['rev-parse', '--absolute-git-dir'])
  if (!gitDir) return bail('git-dir-unresolved')
  api.gitDir = gitDir

  let head = readHead(root.root)
  api.head = { branch: head.branch, sha: head.sha }

  const targets = [
    { target: 'index', path: path.join(gitDir, 'index'), dir: false },
    { target: 'HEAD', path: path.join(gitDir, 'HEAD'), dir: false },
    { target: 'refs-heads-dir', path: path.join(gitDir, 'refs', 'heads'), dir: true, recursive: true },
    { target: 'packed-refs', path: path.join(gitDir, 'packed-refs'), dir: false, optional: true },
  ]
  if (head.branch) {
    targets.splice(2, 0, {
      target: 'branch-ref', path: path.join(gitDir, 'refs', 'heads', head.branch), dir: false, optional: true,
    })
  }

  for (const t of targets) {
    try {
      // `recursive` is unsupported on Linux before Node 20; if it throws we retry non-recursively so
      // a nested branch name (feature/x) at least gets its parent directory watched.
      let w
      try {
        w = fs.watch(t.path, { persistent, recursive: Boolean(t.recursive) }, (evt, name) => onFsEvent(t.target, evt, name))
      } catch (e) {
        if (t.recursive && (e?.code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' || e?.code === 'EINVAL')) {
          w = fs.watch(t.path, { persistent }, (evt, name) => onFsEvent(t.target, evt, name))
          watches.push({ target: t.target, path: t.path, ok: true, reason: 'non-recursive-fallback' })
          w.on('error', e2 => reportWatchError(t.target, t.path, e2))
          watchers.push(w)
          continue
        }
        throw e
      }
      // fs.watch emits 'error' asynchronously (e.g. the watched file is deleted). An unhandled
      // 'error' on an EventEmitter THROWS and would take the server down.
      w.on('error', e2 => reportWatchError(t.target, t.path, e2))
      watchers.push(w)
      watches.push({ target: t.target, path: t.path, ok: true, reason: null })
    } catch (e) {
      const code = e?.code || 'unknown'
      const reason = code === 'ENOENT' && t.optional ? 'absent' : `watch-failed:${code}`
      watches.push({ target: t.target, path: t.path, ok: false, reason, optional: Boolean(t.optional) })
    }
  }

  // Establishment verdict. `index` + `HEAD` + (branch ref OR refs/heads dir) is the minimum that can
  // see a stage, a switch and a commit. Anything less and the caller MUST poll.
  const got = new Map(watches.map(w => [w.target, w]))
  const live = t => Boolean(got.get(t)?.ok)
  const essential = live('index') && live('HEAD') && (live('branch-ref') || live('refs-heads-dir'))
  const allEstablished = watches.every(w => w.ok || w.reason === 'absent')

  api.ok = essential
  api.degraded = !allEstablished
  api.fallback = essential && !api.degraded ? null : 'poll'
  if (!essential) api.reason = 'essential-watches-unavailable'
  else if (api.degraded) api.reason = 'partial-watches'

  if (!essential || api.degraded) {
    // Emitted on the next tick so a caller that attaches a listener right after start() still sees it.
    const failed = watches.filter(w => !w.ok && w.reason !== 'absent')
    setImmediate(() => {
      if (!disposed) emitter.emit(EVENTS.WATCH_ERROR, { reason: api.reason, watches, failed, fallback: 'poll', pollIntervalMs })
    })
  }

  function reportWatchError(target, p, e) {
    const w = got.get(target)
    if (w) { w.ok = false; w.reason = `watch-error:${e?.code || 'unknown'}` }
    if (!disposed) emitter.emit(EVENTS.WATCH_ERROR, { reason: 'watch-runtime-error', target, path: p, code: e?.code || null, fallback: 'poll', pollIntervalMs })
  }

  function onFsEvent(target, evt, name) {
    if (disposed) return
    cache = null // invalidate IMMEDIATELY, before the debounce — a read during the window must miss
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; settle(target, evt, name) }, debounceMs)
    // Debounce timers must not hold the process open; a dashboard shutdown should not wait on them.
    if (timer.unref) timer.unref()
  }

  function settle(target, evt, name) {
    if (disposed) return
    const next = readHead(root.root)
    if (next.locked) {
      // The repo is mid-operation. Say the state changed, but do NOT claim a commit or a branch
      // switch we could not verify — that would be inventing a measurement.
      emitter.emit(EVENTS.STATUS_CHANGED, { target, event: evt, file: name || null, headKnown: false, reason: 'repo-locked' })
      return
    }
    const branchChanged = next.branch !== head.branch
    const shaChanged = next.sha !== head.sha
    const prev = head
    head = next
    api.head = { branch: next.branch, sha: next.sha }

    if (branchChanged) {
      emitter.emit(EVENTS.BRANCH_CHANGED, { from: prev.branch, to: next.branch, sha: next.sha, detached: next.branch === null })
    }
    // A commit is a sha move WITHOUT a branch switch. Checking out another branch also moves the sha,
    // and reporting that as "a commit was made" would put phantom commits in the activity feed.
    if (shaChanged && !branchChanged) {
      emitter.emit(EVENTS.COMMIT_DETECTED, { from: prev.sha, to: next.sha, branch: next.branch })
    }
    emitter.emit(EVENTS.STATUS_CHANGED, {
      target, event: evt, file: name || null, headKnown: true,
      branch: next.branch, sha: next.sha, branchChanged, shaChanged,
    })
  }

  return api
}
