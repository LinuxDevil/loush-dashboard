# INTEGRATION — git status/diff/stage/commit (096), event-driven watching (095), open folder (098)

Four new library modules, no existing file touched. Nothing is mounted yet: these are pure libraries
plus a spec for the wiring. This document is the handover — what to mount, where, what the UI should
consume, what I could not verify, and what `lib/git-safe.mjs` does not currently give me.

## Files added

| File | Purpose |
| --- | --- |
| `lib/git-status.mjs` | Parser for `git status --porcelain=v1 -z`. Pure, no I/O, no dependency on git-safe. |
| `lib/git-ops.mjs` | `status` / `diff` / `stage` / `unstage` / `commit` / `listBranches` over `git-safe`. |
| `lib/git-watch.mjs` | `watchRepo(dir)` — `fs.watch` on `.git`, debounced, disposable, emits `git:*` events. |
| `lib/open-folder.mjs` | `openFolder(target, {roots})` — allowlisted reveal-in-file-manager. |
| `test/lib/git-fixture.test.mjs` | Real temp git repos (`git init` in `os.tmpdir()`). Helper module; declares no tests itself — see note at the bottom of the file. |
| `test/lib/git-status.test.mjs` | 26 tests. |
| `test/lib/git-ops.test.mjs` | 26 tests. |
| `test/lib/git-watch.test.mjs` | 15 tests. |
| `test/lib/open-folder.test.mjs` | 27 tests. |

---

## 1. Files referenced in my brief that do not exist in this worktree

My worktree was branched from an older commit. **`lib/git-safe.mjs` is not present here.** I coded
`git-ops.mjs` and `git-watch.mjs` against the API the coordinator stated for the target branch:

```js
import { git, gitOut } from './git-safe.mjs'
git(dir, argsArray, { timeout, maxBuffer, write })
  // -> { ok, stdout, stderr, status, readOnly, locked, lock: { path, ageMs, at }, reason, command }
gitOut(dir, args, opts) // -> trimmed stdout, or null
```

I use only `git` and `gitOut`. I do not use `checkOrigin`, `lockInfo`, `isLockError`,
`READ_COMMANDS` or `normaliseRemote`, so a drift in those does not affect this batch.

No other file from the brief was missing. `lib/git-status.mjs` and `lib/open-folder.mjs` have no
dependency on `git-safe` at all and are fully self-contained.

**Please re-run `node --test` on the target branch before merging.** See §2.

## 2. Which tests I could NOT execute here, and why

`node --test` in this worktree:

```
# tests 442
# pass 440
# fail 2      <- test/lib/git-ops.test.mjs and test/lib/git-watch.test.mjs
                 ERR_MODULE_NOT_FOUND: cannot find lib/git-safe.mjs
```

Both files fail at **import time**, not on an assertion. Everything else passes, including all 481
tests that existed before. Executed and green here:

* `test/lib/git-status.test.mjs` — 26/26
* `test/lib/open-folder.test.mjs` — 27/27
* the pre-existing suite — 428/428

Not executed here: `git-ops.test.mjs` (26) and `git-watch.test.mjs` (15). I did not weaken them and
did not commit a stub — a stub would only test the stub. I did, however, run them **once** against a
throwaway module implementing the coordinator's stated contract, kept entirely outside the repo
(`<scratchpad>/git-safe-verification-shim.mjs`, never copied into any commit), purely to prove my own
logic. Both files passed 41/41 that way, and that run found two real bugs in my code (both fixed,
both listed in §7). Treat that as evidence about **my** modules only — it says nothing about the real
`git-safe.mjs`, so the target-branch run is still the one that counts.

## 3. What `lib/git-safe.mjs` does not currently give me

Listed here because I may not edit it. None of these block the merge; the first is a real
correctness limit.

1. **Raw stdout bytes.** `git()` returns `stdout` as a decoded string. Filenames on Linux are bytes,
   not text, so a path that is not valid UTF-8 (a latin-1 `café.txt`, a file from a Windows archive)
   is already U+FFFD by the time `git-ops.status()` sees it, and the true name is unrecoverable.
   `parsePorcelainV1Z` **accepts a Buffer** and, given one, preserves such paths exactly — it returns
   `path: null` (unknown is a value), `pathBytesBase64` with the real bytes, and
   `pathEncoding: 'invalid-utf8'`. This is proven by a test against a real repo containing such a
   file. To get that fidelity end to end, `git-safe` needs to expose the raw buffer — e.g. a
   `stdoutBuffer` field, or an `{ encoding: 'buffer' }` option. Until then a non-UTF-8 path shows in
   the UI as `caf<?>.txt` and cannot be staged by name.
2. **A stable reason for "output exceeded maxBuffer".** `git-ops.diff()` must distinguish a diff too
   large to read from an ordinary git failure, or it would report a truncated diff as an error. I
   currently pattern-match `/max-?buffer|ENOBUFS/i` on `reason`, which is brittle. A documented
   constant would be better.
3. **The effective limits on the result.** House rule 2 says every bound is reported. I can report my
   own caps but not git-safe's actual timeout/maxBuffer defaults, so `OPS_LIMITS.gitTimeoutMs` is a
   restatement of the value I pass in rather than the one that was applied. Echoing `{timeout,
   maxBuffer}` back on the result would close that gap.
4. **Confirmation of what `write` does.** I pass `{ write: true }` on `add`, `commit`, `restore`,
   `rm`. If git-safe *refuses* a mutating command that lacks the flag, that is a good fail-closed
   property and my calls are already correct. If the flag is only advisory, please say so — I would
   want a read-only assertion at the route layer instead.

---

## 4. Wiring in `server/index.mjs`

Follow the existing convention: a `server/git.mjs` module exporting
`export default function mountGit(app, deps = {})`, imported and called next to the other mounts
(`mountTodos`, `mountAtoms`, …). **I did not create `server/git.mjs`** — it is outside my file
allowlist for this batch.

```js
import mountGit from './git.mjs'            // beside the other mount imports (server/index.mjs:8-17)
// ...
mountGit(app, { projectRoots: () => configuredProjectRoots() })   // beside the other mounts
```

### Routes it should expose

| Method | Route | Library call | Notes |
| --- | --- | --- | --- |
| GET | `/api/git/status?dir=&untracked=` | `status(dir, {untracked, maxEntries})` | Returns `entries`, `branch`, `counts`, `truncated`, `untrackedMode`. |
| GET | `/api/git/diff?dir=&path=&staged=` | `diff(dir, {path, staged, contextLines, maxBytes})` | Response carries `truncated`, `bytes`, `totalBytes`, `bytesLimit`. |
| GET | `/api/git/branches?dir=` | `listBranches(dir)` | `current` is `null` when detached; `detached` says why. |
| POST | `/api/git/stage` `{dir, paths[]}` | `stage(dir, paths)` | |
| POST | `/api/git/unstage` `{dir, paths[]}` | `unstage(dir, paths)` | |
| POST | `/api/git/commit` `{dir, message}` | `commit(dir, message)` | |
| POST | `/api/open-folder` `{path}` | `openFolder(path, {roots})` | **Roots must come from server config, never from the request body.** |
| GET | `/api/git/events?dir=` (SSE) | `watchRepo(dir)` | See §6. |

### Rules the route layer must honour

* **`dir` is client input.** Resolve it against the configured project roots before calling anything
  here — `resolveOpenTarget()` from `open-folder.mjs` is directly reusable for that, or
  `resolveInRepo()` from `git-ops.mjs` if you already have a repo root. The git modules validate
  *paths inside* a repo; they do not decide which repos exist.
* **Never 500 on a refusal.** Every function returns `{ok:false, reason}` and never throws. Map:
  `locked:true` → **409** with `retryAfterMs` (do not delete the lock file, and do not report the
  repo as clean); `path-outside-repository` / `path-inside-git-dir` / `outside-allowed-roots` →
  **403**; `commit-message-empty`, `nothing-staged`, `unresolved-conflicts`, `paths-empty` → **400**;
  `not-a-git-repo` → **404**; `unsupported-platform` → **501**.
* **Pass `truncated` and `limits` through to the client verbatim.** They are the whole point of house
  rule 2; dropping them turns "12 of 4000 changes" back into "12 changes".
* **`POST /api/open-folder` is the highest-risk route in this batch.** It takes a client path and
  launches a program. The `roots` argument is the entire security boundary: source it from
  `projects.json` (the `projects[].dir` entries plus any configured repo roots) on the server.
  An empty roots array is a **refusal**, not a wildcard — `open-folder.mjs` already fails closed, so
  do not "helpfully" substitute `[os.homedir()]` when config is missing.

## 5. Which UI section should consume it

**`src/sections/ProjectHub.jsx`** — it is already the per-repository view and already knows the
selected project's directory, so a "Working tree" card fits there without inventing navigation:

* staged / unstaged / untracked / **conflicted** groups from `status()` — conflicts must render as
  their own group with the `conflict.label` text ("both modified", "deleted by them"), never in the
  modified list, since staging a conflicted file silently resolves it by picking a side;
* stage/unstage buttons per row, the diff in the existing CodeMirror pane, a commit box that stays
  disabled while the message is empty (the backend refuses it anyway — the disable is just courtesy);
* a "busy" state for `locked:true`, and a visible "showing N of M" line whenever `truncated` is true.

`src/sections/ProjectsSection.jsx` is the other consumer: the per-project row is the natural place
for the **Open folder** button, since that list is already built from the configured project roots
that form the allowlist.

## 6. Consuming the watcher (095)

```js
const w = watchRepo(dir)                       // never throws
if (!w.ok || w.degraded) {
  // REQUIRED. w.reason names it, w.fallback === 'poll', w.pollIntervalMs is the suggested cadence,
  // and w.watches lists every target with its own ok/reason.
  startPolling(w.pollIntervalMs)
}
w.on('git:status-changed', …)   // debounced; one per settled change
w.on('git:commit-detected', …)  // sha moved WITHOUT a branch switch
w.on('git:branch-changed', …)   // includes switching between branches at the same commit
w.on('git:watch-error', …)      // also fires when nothing could be established at all
// on SSE disconnect:
w.dispose()                     // idempotent; closes every handle and silences the emitter
```

Two things the route must not skip:

* **Do not ignore `ok:false` / `degraded:true`.** That is the failure the ticket is about: a UI that
  looks live while watching nothing is worse than one the user knows is polling. Surface it as a
  "live / polling" indicator.
* **Always `dispose()`.** The watches are `persistent: true` (they hold the event loop open — a
  non-persistent watch stops firing while still reporting `ok:true` if it is the only handle alive),
  so a leaked watcher keeps the process from exiting. Bind disposal to the SSE `close` event, and
  keep at most one watcher per directory.

## 7. Bugs the tests caught (all fixed, all in code I wrote this session)

1. `unstage` used `git restore --staged`, which fails with `fatal: could not resolve HEAD` in a
   repository with **no commits yet** — verified against git 2.43. It now checks for a resolvable
   HEAD and uses `git rm --cached` there instead, and reports which mechanism it used, because the
   two are not equivalent (without a HEAD the file becomes untracked rather than reverting).
2. `diff` requested only `maxBytes` from git, so a truncated diff came back as a hard failure and
   `totalBytes` was unknowable. It now reads to the hard cap and slices for display, so the UI can
   say "200KB of 3MB".
3. `watchRepo` returned early on a non-repo directory **without emitting `git:watch-error`** — a
   caller subscribed only to events would have sat in silence believing it was live. That is exactly
   the ticket's stated failure mode, in the module meant to prevent it.
4. `fs.watch({persistent: false})` let the event loop drain: the watcher reported `ok:true` and
   stopped delivering events whenever nothing else kept the process alive.

## 8. Notes on existing code (no changes made)

`lib/clone.mjs:32` calls `spawnSync('git', ['-C', dir, 'remote', 'get-url', 'origin'])` directly and
discards every failure into `''` — so "no origin", "not a repo", "git missing" and "timed out" are
all indistinguishable, and it takes no `--no-optional-locks`. It looks like a candidate to move onto
`git-safe`'s `checkOrigin`/`normaliseRemote`, but it is an existing file and out of scope for this
batch.
