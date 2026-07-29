# SPEC — Diff approval and agent profiles

Implementation spec derived from `native-guis-flycrys-nimbalyst.md` (Nimbalyst 1,339★, FlyCrys 30★)
and the rulings in `_SYNTHESIS.md` §7 Cluster E, §8 and the do-not-adopt list. **No upstream project
was re-researched for this document.** Everything below about *our* code was read from the files in
this checkout and is cited `path:line`. Where I could not verify something I wrote "unverified"
rather than guessing.

## What we already have (read, not assumed)

This matters because it changes the effort estimates a lot.

| Thing the design needs | Do we have it? | Where |
| --- | --- | --- |
| LCS line diff, zero deps, with a size guard | **yes** | `src/ui/tabs.jsx:9-25` — `lineDiff()`, bails to a single "file too large to diff" line above 400,000 DP cells |
| Red/green diff renderer | **yes** | `src/ui/tabs.jsx:27-35` `DiffView`, and a second one for `structuredPatch` hunks at `src/ui/planWidgets.jsx:56-76` (with a 14-line clamp + "show all") |
| SSE, replay-then-live | **yes, twice** | `server/index.mjs:944-952` and `server/ticket.mjs:847-854`; client side `src/sections/ChatSection.jsx:277` |
| Broadcast helper | **yes** | `server/index.mjs:871-875` `chatBroadcast` |
| Content-versioning store with `prev` + `content` + rollback | **yes** | `server/index.mjs:1719-1756` — `dashboard-versions.jsonl`, `track()`, `/api/gov/rollback` |
| A write jail | **yes** | `server/index.mjs:124-130` `safe()` over `ALLOWED_ROOTS = [~/.claude, <project>/.claude, ~/.claude.json]` |
| Timestamped backups before any destructive write | **yes** | `server/index.mjs:131-138` `backup()` |
| Repo-root validation from transcript cwds | **yes** | `server/fe.mjs:453` — `root` must equal a repo derived from your own transcripts |
| git shell-out, null-not-empty on failure | **yes** | `server/fe.mjs:360-368` |
| A hook library with one-click install + governance gate | **yes** | `server/index.mjs:3669-3707`, UI at `src/sections/HooksSection.jsx:215-251` |
| A profiles store | **yes, but the wrong shape** | `server/index.mjs:2018-2041` `~/.claude/harness-profiles.json` — settings presets, not spawn args |
| CSV parse + sortable table | **yes** | `src/ui/viewers.jsx:34-46` `parseCSV`, `48-73` `DataTable` |
| **A filesystem watcher** | **no. Nothing anywhere.** | `grep` for `fs.watch`/`chokidar` across `server/*.mjs` returns nothing. Two `setInterval`s exist (`server/index.mjs:3435` Slack notify, `4380` preview teardown); neither watches files. |

**So the one genuinely new piece of infrastructure is the watcher and its SSE channel.** That is the
budget line `_SYNTHESIS.md:261-263` told us to draw, and it is correct: everything else in this spec
is assembly of parts we already own.

Node is v26 in this environment, so `fs.watch(dir, { recursive: true })` is available on Windows,
macOS and Linux with **no new dependency**. We stay inside the existing dep set (d3, marked,
CodeMirror, yaml, express, react).

## Ordering note

The brief requires the no-hooks v1 first, and I have honoured that. Strictly by value ÷ effort,
features **2** and **3** are both S and would score higher. They can ship in parallel or first;
feature 1 is placed first because it is the spine the rest attach to, and because shipping 2 without
1 ships a view mode with only a git-shaped answer.

---

## 1. Diff approval v1 — file watcher, SSE, snapshot store, accept/reject (no hooks)

**Customer need.** Today an agent edits a file in `~/.claude` (a skill, a command, `CLAUDE.md`, a
generated artifact) and the only way to know what changed is to open Artifacts, select the file, and
read the whole thing. `src/sections/ArtifactsSection.jsx:81-82` gives you Rendered and Source — two
views of the *current* state, no view of the *change*. Who hurts: anyone who runs an agent that
rewrites their harness config or their generated docs. What they do today: open a terminal, `git
diff` if the file happens to be in a repo, or diff it by eye. For `~/.claude` specifically there is
no git, so they diff by eye or trust the agent. `WorkingSet` is the closest thing we have and it
only shows *transcript* hunks, truncated to 24 lines / 600 chars at `server/index.mjs:2357-2362` —
useful history, useless for review.

**Value to Loush.** This is the single biggest capability gap the research found
(`native-guis-flycrys-nimbalyst.md:536`). It converts Artifacts from a file browser into a review
surface, and it does so with a model — write-through, review after — that never stalls the agent.
It is also the only feature in this batch that needs new infrastructure, and that infrastructure
(watcher → SSE) is reused by features 4, 6 and 7.

**How the upstream repo does it today.** Nimbalyst: a `PreToolUse` hook snapshots the pre-edit
content as a "tag" `{content, sessionId, status:'pending'}` in a local `document_history` table; the
tool executes with no interception; the renderer's file watcher sees the change, finds the pending
tag, and puts the editor into diff mode showing tagged→disk with Accept/Reject; Accept marks the tag
reviewed, Reject writes the tagged content back to disk. Stated principle: the AI always sees the
accepted state. A DB partial unique index enforces one pending tag per file so consecutive edits
coalesce original→latest. They rejected an MCP `applyDiff` tool because agents bypass it with plain
`Edit`; the watcher also catches bash and manual edits.

**How we implement it here.** v1 drops the hook (feature 5/6 add it back) and uses **disk vs
last-known** as the "original" side.

*Server — new file `server/history.mjs`, mounted next to `mountFe` at `server/index.mjs:58`:*

- `snapshot(absPath)` — read the file, write `{path, content, sha, takenAt, source, sessionId:null,
  status:'pending'}`. Storage location argued in "The snapshot lifecycle" below: one JSON file per
  path under `~/.claude/dashboard-history/<sha256(absPath).slice(0,16)>.json`, plus a small
  `index.json` for the pending list. Follows the `TICKET_DIR` precedent (`lib/paths.mjs:60-66`:
  one file per key, deliberately, because a single blob rewritten whole is wrong for per-item state)
  and the `atoms/reviewed.json` precedent (`server/atoms.mjs:14`).
- A watcher over `~/.claude` using `fs.watch(CLAUDE, { recursive: true })`, filtered by the same
  `SKIP_DIRS`/`SKIP_EXTS` sets already declared at `server/index.mjs:497-498` (export them from a
  shared module rather than copying — `file-history`, `paste-cache`, `shell-snapshots`,
  `dashboard-backups`, `todos`, `statsig`, `telemetry` are all in there and all must stay excluded or
  the watcher will fire constantly on Claude Code's own bookkeeping).
- **Ordering, verbatim from upstream:** on a change event, check for a pending tag on that path
  **before** applying the "skip if <2000 ms since our own write" echo heuristic. Getting this
  backwards swallows consecutive agent edits inside the debounce window.
- **Lock release, verbatim from upstream:** a module-level `processing` Set keyed by path prevents
  concurrent handling of duplicate `fs.watch` events (Windows in particular fires `change` twice per
  write); the diff-state update is scheduled with `setTimeout(..., 0)` so the lock is released
  before subsequent events arrive.
- **One pending tag per file.** We have no DB and therefore no partial unique index. The
  one-file-per-path layout *is* the constraint: a second edit to the same path overwrites
  `{newContent}` and leaves `{content}` (the original) untouched, so consecutive edits coalesce
  original→latest exactly as upstream's index does. This is the reason to key by path rather than by
  event.
- `GET /api/history/events` — SSE, replay-then-live, copied structurally from
  `server/index.mjs:944-952`. Emits `{type:'pending', path, sha, at}` and `{type:'resolved', path,
  verdict}`. Replay = the current pending set, so a remount reattaches (the comment at
  `server/ticket.mjs:310` explains why we do this everywhere).
- `GET /api/history/pending` — plain JSON fallback for clients that never open the stream.
- `GET /api/history/diff?path=` — `{original, current, tag:{takenAt, source}}`. Reuses the 2 MB cap
  from `server/index.mjs:529`; above it returns `{tooLarge:true, bytes}` and the UI says so rather
  than rendering nothing.
- `POST /api/history/accept {path}` — mark reviewed. Disk unchanged.
- `POST /api/history/reject {path}` — `backup(path)` first (`server/index.mjs:131`), then write the
  snapshot back, then mark reviewed. The write must set the echo-suppression timestamp *before*
  writing so the watcher does not treat our own restore as a new agent edit.
- Every path goes through `safe()` (`server/index.mjs:125`). v1 therefore covers `~/.claude` and
  `<project>/.claude` only. **Repo files are out of scope for v1** — see Risks.
- The response cache at `server/index.mjs:111-121` must not be given a TTL entry for any
  `/api/history/*` route; it is also worth noting that any non-GET clears the whole cache
  (`:112`), so accept/reject will incidentally invalidate `/api/overview` etc. That is existing
  behaviour, not a regression, but it means accept/reject is not free.

*Client:*

- `src/sections/ArtifactsSection.jsx` — subscribe to `/api/history/events` with an `EventSource` in
  a `useEffect` (pattern: `src/sections/ChatSection.jsx:277`). Cards in the grid at
  `ArtifactsSection.jsx:64-71` get a pending dot; the header count at `:55` gains "· N pending
  review".
- `src/ui/viewers.jsx` — a new `DiffPane({original, current, ext})`. v1 renders
  `DiffView` from `src/ui/tabs.jsx:27` (unified, red/green, already themed with `--green-bg` /
  `--red-bg`). Native-format diff is feature 7.
- Accept/Reject buttons live in the existing `.actions` row (`ArtifactsSection.jsx:80-88`) beside
  Reveal/Download/Rename, and use the existing `flash()` status line at `:20`/`:90`.

**Effort. M–L.** Split: watcher + snapshot store + SSE ≈ M on its own (this is the transport bill
`_SYNTHESIS.md:261` told us to pay); accept/reject endpoints ≈ S; UI ≈ S because `DiffView` and the
SSE client pattern already exist.

**Risks and unknowns.**
- `fs.watch` recursion over `~/.claude` on a large install. `/api/artifacts` already caps its walk at
  8,000 files (`server/index.mjs:502`); a watcher has no such escape. Mitigation: cap the pending set
  (e.g. 200) and emit an explicit `{type:'overflow'}` the UI renders as "watching stopped: too many
  pending changes" rather than silently dropping.
- Windows duplicate/coalesced `change` events. The `processing` lock handles duplicates; a *missed*
  event is handled by the degradation path in "The snapshot lifecycle".
- **The "original" in v1 is only as good as the last time we snapshotted.** If the dashboard was not
  running when the agent edited, the first change we see has no prior snapshot and there is nothing
  to diff against. v1 must say "no prior snapshot — first seen at <time>" and offer Accept only.
  Do **not** synthesise an empty original and render the whole file as green additions.
- `safe()` confines v1 to `~/.claude`, which is where our artifacts live but is *not* where most
  agent editing happens. This is a real scope limit, stated below in Open questions.
- Editors that write via truncate-then-write can be observed mid-write (zero bytes). Debounce the
  read by ~120 ms and re-stat before snapshotting.

**Definition of done.**
1. With the dashboard running, editing a file under `~/.claude` from *any* source — an agent's Edit
   tool, `echo >> file` in a terminal, or VS Code — produces a pending item in Artifacts within 2 s
   without a page refresh.
2. Selecting it shows a red/green unified diff of original→current.
3. Reject restores the original to disk (verified by `stat` size and content) **and** leaves a file
   in `~/.claude/dashboard-backups/` per `backup()`.
4. Accept leaves disk untouched and clears the pending state.
5. Two consecutive agent edits to the same file produce **one** pending item whose diff spans
   original→latest, not two items and not first→second. (This is upstream's own E2E case,
   `consecutive-edits-diff-update.spec.ts`.)
6. **Null/empty state:** with no pending changes the Artifacts detail pane shows the existing
   "select an artifact" (`ArtifactsSection.jsx:76`) and the Diff tab is *disabled with a reason*
   ("nothing pending for this file"), never an empty green pane. With the watcher unavailable (see
   lifecycle), the header shows "live watching unavailable — showing last known state" and the
   pending count renders `—`, not `0`.
7. A `node --test` case in `test/server/` covering: coalescing, reject-restores-bytes, and
   pending-tag-checked-before-echo-window (the ordering bug, tested directly).

---

## 2. Diff as a third view mode — Rendered / Source / Diff

**Customer need.** Even before feature 1's watcher exists, the question "what changed in this file"
has an answer for two large classes of file and we do not show it: files inside a git repo (`git
diff`), and `~/.claude` config files we ourselves wrote through `track()`, which stores `prev` and
`content` on every version (`server/index.mjs:1729`). Users currently leave the app to answer it.

**Value to Loush.** Establishes that diff is a *mode of the file you are already reading*, not a
separate destination — FlyCrys's segmented Source/Preview/Diff toggle, which the research called out
as cheap and immediately useful (`native-guis-flycrys-nimbalyst.md:587-592`). It is also the exact UI
shell feature 1 fills in, so building it first de-risks feature 1's client work to almost nothing.

**How the upstream repo does it today.** FlyCrys: a three-state segmented control in the centre
viewer switching Source / Preview / Diff for the same file, git diffs rendered with highlighting in
the same pane (`src/textview.rs`).

**How we implement it here.** `src/sections/ArtifactsSection.jsx:14` is `const [raw, setRaw] =
useState(false)` — a boolean feeding `<Viewer item={sel} raw={raw} />` at `:91`. Replace with
`const [mode, setMode] = useState('rendered')` over `'rendered' | 'source' | 'diff'`, and change the
two buttons at `:81-82` into three. `Viewer` at `src/ui/viewers.jsx:108` takes `mode` instead of
`raw` (the `raw` branch is one line, `:126`).

Diff source, in priority order, from a new `GET /api/history/diff`:
1. a pending snapshot (feature 1), if one exists;
2. else, if the path is inside a transcript-derived repo, `git diff -- <path>` via the existing
   `git()` helper shape at `server/fe.mjs:360-362` (`execFile`, 10 s timeout, `null` on failure —
   keep the null-not-empty discipline of `:366`);
3. else, if `readVersions()` (`server/index.mjs:1732`) has an entry for the path, diff
   `prev`→`content` of the newest entry;
4. else `{available:false, reason}`.

**Effort. S.** Three buttons, one prop rename, one endpoint that composes helpers that already exist.

**Risks and unknowns.**
- `/api/artifacts` only enumerates `~/.claude` (`server/index.mjs:517`), which is not a git repo on
  most machines, so path 2 will rarely fire from the Artifacts screen. It fires from WorkingSet's
  dossier, where paths *are* repo paths — which argues for exposing the same viewer there later.
- `readVersions()` reads and parses the whole `dashboard-versions.jsonl` on every call
  (`server/index.mjs:1733`). It is already used by `/api/gov/versions`, so this is not new cost, but
  do not put it on a hot path.

**Definition of done.** Selecting any artifact shows three toggles. For a file with no diff source,
the Diff toggle is **visibly disabled with a tooltip naming the reason** ("not in a git repo, and
this dashboard has no recorded prior version"). No fabricated empty diff. For a `~/.claude` file the
dashboard has edited through `track()`, Diff shows that change. Existing Rendered/Source behaviour is
byte-identical to before.

---

## 3. Agent profiles as a launch-time allowlist

**Customer need.** Every `claude` process this app spawns runs with
`--dangerously-skip-permissions`: `server/index.mjs:916` (Chat and Quick Actions),
`server/atoms.mjs:42` (grounded ask), `server/index.mjs:3712` (the generated CI eval runner). There
is no way to start a session in the app that is *read-only*, or restricted to a named toolset. A user
who wants "let it explore but not write" has to leave the dashboard and run the CLI by hand.

**Value to Loush.** FlyCrys's entire profile concept is four fields
(`native-guis-flycrys-nimbalyst.md:118-130`) and we already own the storage, the UI and the
governance gate — so this is hours, not days. It also gives the Chat model picker
(`src/sections/ChatSection.jsx:341-342`, currently model-only) something meaningful to sit beside.

**How the upstream repo does it today.** `~/.config/flycrys/agents/<name>.json` holding
`{name, system_prompt, allowed_tools[], model}`; each allowed tool is passed as its own
`--allowedTools <tool>` argument (`src/services/cli/claude.rs:671-673`), plus `--model` and
`--effort` (`:675-678`). Their permission routing (`--permission-prompt-tool stdio`) intercepts
`AskUserQuestion` only; a code comment concedes every other permission request is auto-allowed
(`:498-499`). **It is a launch-time allowlist, not interactive gating.**

**How we implement it here.** Do **not** create a parallel store. `~/.claude/harness-profiles.json`
already exists (`server/index.mjs:2019-2025`) with `{name, description, harness}`, is edited as JSON
in `src/sections/LibrarySection.jsx:31-90`, is versioned through `track()`, and is read by
`ProjectsSection` and the command palette. Add one optional key:

```jsonc
{ "name": "research",
  "description": "read-only exploration",
  "harness": { /* unchanged — merged into settings.json by /api/gov/profiles/apply */ },
  "spawn": {                       // NEW — consumed at CLI launch, never written to settings.json
    "systemPrompt": "…",           // → --append-system-prompt
    "allowedTools": ["Read","Grep","Glob"],   // → repeated --allowedTools
    "model": "claude-haiku-4-5"    // → --model
  } }
```

- `server/index.mjs:909-921` (`POST /api/chat`) accepts `profile` in the body, looks it up via
  `readProfiles()` (`:2025`), and builds args: keep `--input-format/--output-format/--verbose`;
  append one `--allowedTools <tool>` per entry; append `--append-system-prompt` with
  `PLAN_SCHEMA_RULE` (`:868`) **plus** the profile prompt — do not replace it or PlanGraph stops
  working; `--model` from `spawn.model` unless the request overrides it (`:918`).
- **When `spawn.allowedTools` is non-empty, drop `--dangerously-skip-permissions`.** Passing both is
  the failure mode that makes the allowlist decorative. Return the exact argv (minus env) in the
  `POST /api/chat` response so the UI can show it.
- `src/sections/LibrarySection.jsx` — render `spawn.allowedTools` as chips beside the existing
  turn/model chips at `:60-62`. The JSON drawer at `:73-90` already edits arbitrary profile JSON, so
  no new editor is needed.
- `src/sections/ChatSection.jsx:341` — a profile `<select>` beside the model `<select>`.

**Honesty requirement (non-negotiable).** The UI must say, in the profile card and again in Chat:
*"A profile restricts which tools the CLI is launched with. It is not an interactive approval prompt
— once launched, permitted tools run without asking."* This is the caveat FlyCrys's own code comments
concede (`claude.rs:498-499`) and `native-guis-flycrys-nimbalyst.md:213-218` records. Interactive
gating is `_SYNTHESIS.md:319` (2.3, siteboon's `canUseTool`) and is a different, larger piece of
work.

**Effort. S.** One optional key, ~25 lines in the spawn path, chips + a select.

**Risks and unknowns.**
- I have **not** verified against the installed CLI whether repeated `--allowedTools` flags union or
  last-wins, nor whether `--allowedTools` and `--dangerously-skip-permissions` conflict or silently
  co-exist. FlyCrys passes them repeated (`claude.rs:671-673`) and that is the only evidence I have.
  **Verify before shipping**; the app's own `/api/hooks/dryrun` machinery is not the right test here,
  a one-off `claude -p --allowedTools Read --allowedTools Grep` is.
- `--effort` is in FlyCrys's arg list; I have not verified it exists on the CLI version we target.
  Leave it out of v1.
- Existing profiles have no `spawn` key. `readProfiles()` returns `DEFAULT_PROFILES` when the file is
  absent (`:2025`); the three defaults are settings-only and must keep working with `spawn` absent.

**Definition of done.** A profile with `spawn.allowedTools: ["Read","Grep","Glob"]` can be selected
in Chat; the started session's argv (shown in the UI) contains the three `--allowedTools` flags and
**not** `--dangerously-skip-permissions`; asking that session to write a file results in a refusal or
permission error visible in the transcript, not a successful write. A profile with no `spawn` key
behaves exactly as today. **Null/empty state:** with no profiles defined, the Chat select shows "no
profiles — default (all tools)" and is not hidden, so the current permissive behaviour is *stated*
rather than implied.

---

## 4. Commit auto-approves pending diffs, and git watching with zero polling

**Customer need.** Once feature 1 exists, pending items accumulate. Committing a file is an
unambiguous statement that you accepted its contents; being made to click Accept afterwards is
busywork that will train people to stop reviewing. Separately, `ProjectsSection.jsx:113` and
`InboxSection.jsx:100` poll every 30 s for state that git changes instantly.

**Value to Loush.** The research calls this the best cheap idea in either project
(`native-guis-flycrys-nimbalyst.md:623`, `_SYNTHESIS.md:259`). It costs a watcher on two well-known
paths and deletes a category of clicks. Watching git's own files means we see commits made from the
CLI, VS Code, or a rebase — not just ones we caused.

**How the upstream repo does it today.** `GitRefWatcher` watches `.git/refs/heads/<branch>` and
`.git/index`; a 30 s poll was removed on 2026-01-23 and `docs/GIT_INTEGRATION.md` carries an explicit
instruction not to reintroduce `setInterval` for git status. `GitStatusService` keeps a 5 s cache as
de-duplication only, invalidated immediately by the watcher. On a detected commit, pending review tags
for the committed files are marked reviewed.

**How we implement it here.** New `server/git.mjs`, or extend `server/history.mjs`:
- `fs.watch` on `<root>/.git/index` and `<root>/.git/refs/heads/` (non-recursive) for each root the
  user has selected. Roots must be validated the way `server/fe.mjs:453` validates them — equal to a
  repo derived from the user's own transcripts. Do not accept an arbitrary path.
- On change: `git rev-parse HEAD`, and if it moved, `git diff-tree --no-commit-id --name-only -r
  HEAD` → mark any matching pending snapshot `reviewed:'auto-commit'` and emit over the feature-1 SSE
  channel. Use the `execFile`+timeout+`null`-on-failure shape at `server/fe.mjs:360-362`.
- Reuse `server/fe.mjs`'s existing 60 s `repoCache` (`:329-331`, `:371-372`) as the de-dup cache and
  invalidate it on the watcher event, instead of adding a second cache. Adopt upstream's rule: **no
  `setInterval` for git state.** (The two existing `setInterval`s at `server/index.mjs:3435` and
  `:4380` are Slack notification and preview teardown — unrelated, leave them.)
- Reject stays manual. Auto-approve is one-directional.

**Effort. S–M.** S for the commit→auto-approve link once feature 1's store exists; the M is replacing
the 30 s polls in `ProjectsSection`/`InboxSection` with a subscription, which is optional.

**Risks and unknowns.**
- Detached HEAD, worktrees and submodules put `.git` somewhere else (a *file*, not a directory).
  Resolve with `git rev-parse --git-dir` rather than joining `.git` by hand.
- Amend/rebase move refs without a new "commit" in the user's mind. Treating a ref move as approval
  of the files in the new HEAD tree is the upstream behaviour and is defensible, but it will
  occasionally auto-approve something the user did not consciously commit. Log it in the resolution
  record (`verdict:'auto-commit'`, with the SHA) so it is auditable.
- v1's `safe()` jail keeps pending snapshots inside `~/.claude`, which is usually **not** a git repo
  — so on day one this feature may have nothing to auto-approve. It becomes load-bearing only once
  the watcher covers repo paths (Open question 1).

**Definition of done.** With a pending snapshot on a file inside a watched repo, `git commit` from a
terminal clears that pending item within 2 s with no click, and the resolution record names the
commit SHA. `git status` state in `ProjectsSection` updates on commit without waiting for the 30 s
poll. **Null/empty state:** if `git` is missing or the root is not a repo, the git-derived fields are
`null` and render `—`, matching `server/fe.mjs:366`'s existing discipline; they must not render as 0
or as a green tick.

---

## 5. `~/.claude/file-history` as an exact pre-edit snapshot source (verification-gated)

**Customer need.** Feature 1's original side is "whatever we last saw", which is wrong whenever the
dashboard was not running. The exact pre-edit content is what makes a diff trustworthy.

**Value to Loush.** **Claude Code already keeps this store, and I verified its layout and key
derivation on this machine during this task.** If it holds up across versions it gives us the exact
original *with no hook installed and no configuration at all* — which is strictly better than
feature 6 for the zero-config thesis, and cheaper.

**What I verified (this machine, today, one file):**
- Layout: `~/.claude/file-history/<sessionId>/<key>@v<N>`, contents = the **full file text**, not a
  diff.
- Key derivation: `key = sha256(<absolute file path>, utf8).hex.slice(0,16)`. Confirmed by
  reproducing `cc10a9cdae9e63c3` from `C:\Users\recti\Downloads\blossom-grove-game-design-document.md`.
- The highest-numbered version was byte-identical in size to the live file (41,231 bytes), i.e.
  versions are **post-write** states, so the "original" for a diff is `v(N-1)`.
- `server/index.mjs:497` already lists `file-history` in `SKIP_DIRS`, so `/api/artifacts` ignores it
  today and the watcher in feature 1 will too. Good — it must stay excluded from the watch set.

**What I did NOT verify — do not build on these without checking:**
- **Version cadence.** That transcript contained 6 `structuredPatch` events against that one file but
  the store held only **2** versions. So versions are *not* one-per-edit. Whether that is retention
  pruning, coalescing, or per-tool-call-type behaviour is **unverified**, and it is the load-bearing
  unknown: if v(N-1) can be several edits stale, the "exact original" claim is false.
- Cross-version stability of the hash (this is `_SYNTHESIS.md:332`'s Tier 3.1 gate, unresolved).
- Whether the path hashed is always absolute and always in the OS's native separator form.
- Retention/GC policy. Only 2 session directories exist here, so it is clearly pruned somehow.

**How we implement it here.** A `resolveOriginal(absPath)` in `server/history.mjs` that, before
falling back to last-known, computes the key, scans `~/.claude/file-history/*/` for `<key>@v*`, takes
the highest `N` whose content ≠ current disk content, and returns it tagged
`source:'file-history', version:N`. Ship it behind a check that compares the *newest* version to the
current file: if they do not match, the store is stale for this file and we fall back rather than
showing a wrong original.

**Effort. S** to implement, **plus a verification task** that must run first: capture N consecutive
agent edits to one file and confirm the store gains N versions. If it does not, this feature
downgrades from "exact original" to "a better-than-nothing original, possibly several edits stale",
and the UI must label it that way.

**Risks and unknowns.** Undocumented, first-party, and can change without notice — the same class of
risk `_SYNTHESIS.md:328-334` puts in Tier 3. Every read must be wrapped so that a schema change
degrades to feature 1's last-known behaviour rather than throwing. Never write into this directory.

**Definition of done.** For a file the agent has edited while the dashboard was **closed**, opening
Artifacts shows a diff whose original side is labelled with its provenance
("original from Claude Code's own file history, v3") and matches the pre-edit content. When the store
has no entry, the label reads "original: last seen by this dashboard at <time>" — provenance is
always shown, never implied. **Null/empty state:** if `~/.claude/file-history` does not exist, this
source is silently skipped and the feature-1 label is used; no error, no empty diff.

---

## 6. `PreToolUse` snapshot hook — the exact original, by our own hand

**Customer need.** Same as feature 5. This is the fallback if feature 5 fails verification, and the
belt to its braces if it passes.

**Value to Loush.** It is upstream's actual mechanism, and unlike feature 5 it is under our control.
We already have the whole delivery mechanism: a curated hook library with descriptions and one-click
install per scope (`server/index.mjs:3669-3707`), a matcher tester
(`src/sections/HooksSection.jsx:27-47`), a dry-run harness (`:131-177`), and a governance gate that
turns a global install into a reviewable proposal (`server/index.mjs:3704` → `propose()` → Governance
→ Approvals).

**How the upstream repo does it today.** `PreToolUse` fires before the Edit/Write tool executes; the
hook reads the current file content and stores it as a pending tag keyed by path. The tool then runs
unimpeded — the hook never blocks.

**How we implement it here.** Add one entry to `HOOK_LIBRARY` (`server/index.mjs:3669`):

- `name: 'snapshot-before-edit'`, `event: 'PreToolUse'`, `matcher: 'Edit|Write|MultiEdit|NotebookEdit'`.
- `command`: a `node -e` one-liner in the same style as the existing entries — read the JSON tool
  call from stdin, take `tool_input.file_path`, `POST` `{path, content, sessionId}` to
  `http://127.0.0.1:${DASH_PORT}/api/history/tag`, **and exit 0 immediately without awaiting the
  response.** That non-awaiting POST is CCAM's trick, recorded at `_SYNTHESIS.md:192` as "the fix for
  Claude Code hanging on hooks", and it is exactly right here: a snapshot hook must never be able to
  stall or block the agent.
- If the dashboard is not running the POST fails and the hook still exits 0. Snapshotting degrades;
  editing never does.
- New `POST /api/history/tag` in `server/history.mjs`: bind **127.0.0.1 only** (the app already
  listens on a local port, `server/index.mjs:49`), validate through `safe()`, and write the snapshot
  with `source:'hook'`, which outranks `file-history` and last-known.
- Surface it in the Hooks → Library grid (`src/sections/HooksSection.jsx:236-247`) with the honest
  description: *"lets the dashboard show exact before/after diffs for agent edits. Never blocks."*

**Effort. S–M.** S for the library entry + receiver. The M risk is the one-liner: the existing
library commands are long escaped `node -e` strings (`server/index.mjs:3671-3677`) and are fiddly to
get right across shells. Note that `/api/hooks/dryrun` at `:3644` spawns `sh -c` — **that will not
work on Windows**, so dry-run testing of this hook is unavailable on Windows today. Flag it; do not
silently ship a dry-run that fails on the platform this repo is being developed on.

**Risks and unknowns.**
- `tool_input.file_path` is the field for `Edit`/`Write`; **unverified** for `MultiEdit` and
  `NotebookEdit`. Handle a missing path by exiting 0 silently.
- Per-call latency. The hook adds a file read plus a fire-and-forget socket write to every edit.
  `/api/hooks/health` explicitly notes latency is not recorded in transcripts
  (`server/index.mjs:3663-3664`), so measure it with dry-run — on a platform where dry-run works.
- Installing to global scope goes through `propose()` and needs approval in Governance
  (`:3704`), which is correct but means "install" is a two-step flow. Say so in the button.

**Definition of done.** Installing the hook from Hooks → Library and running an agent edit produces a
pending item whose original is byte-exact pre-edit content, labelled `source: hook`. Uninstalling the
hook degrades cleanly to feature 5 then feature 1 with a visible provenance label change. Stopping
the dashboard and running an agent edit does **not** error the agent's turn (verified by the turn
completing normally).

---

## 7. Cell-level CSV diff — the first native-format diff

**Customer need.** An agent rewrites a CSV artifact. A unified text diff of a CSV is nearly
unreadable — a one-cell change re-prints the whole row twice, and a column insertion re-prints every
row. Users currently open the file in a spreadsheet to understand it.

**Value to Loush.** It proves the "diff in the format's own view" thesis in a second format, which is
what separates real WYSIWYG diff from a text diff with extra steps
(`native-guis-flycrys-nimbalyst.md:626-630`). The data path already exists: `parseCSV`
(`src/ui/viewers.jsx:34-46`) and `DataTable` (`:48-73`).

**How the upstream repo does it today.** RevoGrid renders cell-level diff with "phantom rows" for
insertions, wired through the `EditorHost`'s `onDiffRequested`/`onDiffCleared` callbacks so the
editor decides its own change presentation.

**How we implement it here.** Parse both sides with `parseCSV`; align rows with the same `lineDiff`
LCS we already have (`src/ui/tabs.jsx:9`) applied to a row key (the joined row string), then for
aligned rows compare cell by cell. Extend `DataTable` with an optional `diff` prop:
`{rowState: 'added'|'removed'|'changed'|'same', cells: Set<colIndex>}` per row, coloured with the
existing `--green-bg`/`--red-bg` variables. Removed rows render as phantom rows (struck, red
background, still occupying a row so alignment reads correctly). `DataTable`'s sort at `:50-59` must
be **disabled while in diff mode** — sorting a diff destroys the alignment that makes it legible.

**Effort. M.** The alignment is the work; rendering is a prop.

**Risks and unknowns.** `parseCSV` is a hand-rolled parser (`:34-46`) that handles quotes and CRLF
but not embedded newlines inside quoted fields in the row-splitting sense — it does, actually, since
`\n` inside a quoted region is appended to `cur`; but it does **not** handle `\r\n` inside quotes
(`:42` drops `\r` unconditionally). Fine for diffing our own artifacts, not fine as a general CSV
diff. Say so if we ever point it at user data. Large CSVs hit the 400,000-cell guard in `lineDiff`
(`:12`) and must fall back to the unified text diff with a visible note.

**Definition of done.** A CSV artifact with a pending change shows a table where changed cells are
highlighted, inserted rows are green, and deleted rows appear as struck phantom rows in position.
Accept/Reject work identically to the text case. **Null/empty state:** an empty CSV keeps the
existing "empty csv" message (`src/ui/viewers.jsx:131`); a CSV too large to align shows the unified
diff *and a line saying why*, not a blank pane.

---

## 8. An `EditorHost`-shaped internal contract

**Customer need.** Internal. Every format we add — CSV diff, mermaid, anything later — currently
re-implements content loading, external-change handling and diff mode from scratch inside
`src/ui/viewers.jsx:108-135`.

**Value to Loush.** Upstream's most transferable design rule, and it is a rule about *state
ownership*, not a plugin system. Take the interface; **explicitly do not build the packaged SDK,
externals system or marketplace** (`native-guis-flycrys-nimbalyst.md:644-646`, `_SYNTHESIS.md:338`).

**How the upstream repo does it today.** An 8-method `EditorHost` interface implemented by every
editor including built-ins, plus a `useEditorLifecycle` hook that handles load/save/echo-detection/
watch/diff/theme. The rule that makes it work: content **never** lives in React state; the host
pushes with `applyContent` and pulls with `getCurrentContent`, which is why one contract serves
Excalidraw (imperative ref), Zustand-backed editors, and read-only viewers alike.

**How we implement it here.** See "The EditorHost contract for us" below. Lands as
`src/lib/editorHost.js` plus a refactor of `src/ui/viewers.jsx`.

**Effort. M**, and it should be done *after* feature 7, not before — one format is not enough
evidence to design an interface, two is.

**Risks and unknowns.** Our viewers are currently read-only by explicit choice
(`src/ui/viewers.jsx:29` passes `readOnly` to CodeMirror). A contract with `getCurrentContent` and
`saveContent` invites making them editable, which is a product decision this spec does not make.
Ship the contract with `getCurrentContent` optional and no save path until someone asks for one.

**Definition of done.** `Viewer` dispatches through the contract; adding a new format requires
implementing the contract and nothing else; the CSV diff from feature 7 is expressed as an
`onDiffRequested` implementation rather than a special case in `Viewer`. No behaviour visible to the
user changes — this is provable by the existing artifact rendering being byte-identical.

---

# The snapshot lifecycle

We have no database. Nimbalyst's `document_history` table and its partial unique index have to be
replaced with something, and the choice matters because it is what enforces coalescing.

## Where snapshots live — the argument

**Chosen: one JSON file per watched path, at
`~/.claude/dashboard-history/<sha256(absPath).slice(0,16)>.json`, plus `index.json` listing pending
keys.**

Rejected alternatives, and why:

- **In-memory only.** Cheapest, and it is what `chats` does (`server/index.mjs:866`, with the honest
  comment at `:864-865` that a restart orphans the view). Rejected: upstream's tags explicitly
  survive session end so a user can accept or reject days later, and that is a real part of the
  value. A pending diff lost on `node --watch` restarting — which happens on every server edit in
  `npm run dev` — would make the feature untrustworthy during its own development.
- **Append to `dashboard-versions.jsonl`** (`server/index.mjs:1719`). Tempting: it already stores
  `{prev, content}` and has rollback. Rejected on three counts: (a) it is an *immutable audit log*
  and pending→reviewed is mutable state, so we would be appending status-change records and
  reconstructing current state by replay; (b) `readVersions()` parses the entire file on every read
  (`:1733`) and agent edits are far more frequent than config changes; (c) it would mix
  dashboard-authored changes with agent-authored ones in a log whose current consumers
  (`/api/gov/versions`, rollback) assume the former.
- **One blob, `dashboard-history.json`.** Rejected for the reason `lib/paths.mjs:60-66` already
  documents for `TICKET_DIR`: a single flat blob rewritten whole on every save is wrong for per-item
  state, and here it also creates a lost-update race between the watcher and a concurrent
  accept/reject.
- **`node:sqlite`.** `_SYNTHESIS.md:336` lists a durable store as Tier 3.5 (L, "makes us stateful,
  weigh it"). Overkill for a bounded pending set. Revisit only if we ever want history across many
  files over months.

Why one file per path: the filename *is* the uniqueness constraint. Two edits to the same path
cannot produce two records, which is precisely what upstream's partial unique index buys, achieved
by the filesystem for free. It also lets a corrupt record be deleted individually.

Record shape:

```jsonc
{ "path": "/abs/path",
  "original": "…full text at snapshot time…",
  "originalSha": "…", "takenAt": 1770000000000,
  "source": "hook" | "file-history" | "last-known",
  "sessionId": "…|null",
  "status": "pending" | "reviewed",
  "verdict": null | "accept" | "reject" | "auto-commit",
  "resolvedAt": null, "resolvedSha": null }
```

## State machine

```
        (dashboard opens file, or watcher first sees it, or hook fires, or file-history read)
                                    │
                                    ▼
                              ┌───────────┐
                              │  TRACKED  │  original recorded, disk == original
                              └─────┬─────┘
                     disk changes   │  (agent Edit / bash / manual / our own restore)
                                    ▼
                          ┌───────────────────┐
              same path   │      PENDING      │◄── consecutive edit: keep `original`,
              edits again │ original != disk  │    refresh only the "current" side.
              ───────────►└───┬───────┬───────┘    NO second record. NO stacking.
                              │       │
              accept / commit │       │ reject
                              ▼       ▼
                        ┌──────────┐  ┌──────────────────────────┐
                        │ REVIEWED │  │ backup() → write original│
                        │ (kept)   │  │ → REVIEWED, disk restored│
                        └──────────┘  └──────────────────────────┘
                              │
                              ▼  next change to this path
                          TRACKED (original := current disk)
```

**When a snapshot is taken.** In priority order, highest wins:
1. `PreToolUse` hook fires (feature 6) — before the write, exact.
2. `~/.claude/file-history` lookup (feature 5) — after the write, exact if the cadence assumption
   holds, otherwise stale-but-labelled.
3. The dashboard reads the file for any reason — the `Viewer` content fetch
   (`src/ui/viewers.jsx:118` → `/api/artifacts/content`, `server/index.mjs:526`) — record it as
   `last-known`.
4. Watcher startup: snapshot nothing eagerly. Snapshotting all of `~/.claude` on boot is expensive
   and mostly useless. Snapshot lazily, on first read or first change.

Provenance travels with the record and is **always rendered in the UI**. "Original" from three
different mechanisms with three different accuracies must not look identical on screen.

**How pending edits coalesce.** Second and subsequent changes to a path with a `pending` record
update nothing but the derived "current" side (which is read from disk on demand, not stored) and
`lastChangeAt`. `original` is immutable until the record is resolved. This yields upstream's
original→latest, and it is enforced structurally by the one-file-per-path layout.

**On reject.** `backup(path)` (`server/index.mjs:131` — writes into `~/.claude/dashboard-backups/`,
so a wrong reject is recoverable) → set the echo-suppression timestamp for that path → write
`original` → `status:'reviewed', verdict:'reject'`. The watcher will see our write; the echo window
plus the pending-tag check (which now finds no pending record) makes it a no-op. **Order matters:
suppress before writing, not after.**

**On accept.** Disk untouched; `status:'reviewed', verdict:'accept', resolvedSha:<current>`. The
record is kept, not deleted — it becomes the `TRACKED` original for the next change, which is what
makes upstream's "the AI always sees the accepted state" true on our side too.

**On git commit.** Feature 4. Any pending record whose path is in the commit's file list flips to
`reviewed`, `verdict:'auto-commit'`, with the SHA recorded. Works for commits from any tool because
we watch git's files, not our own UI.

**On server restart with pending diffs outstanding.** Records are on disk, so they survive. On boot:
rebuild the pending set from `index.json`, and for each pending record **re-stat and re-hash the
current file**:
- file unchanged since `lastSeenSha` → still pending, restore as-is.
- file changed while we were down → still pending, `original` unchanged (correct: it is still the
  original), `current` re-read from disk. Mark `gapDuringDowntime: true` and render "changes may have
  occurred while the dashboard was not running" on that diff.
- file deleted → record moves to `reviewed`, `verdict:'gone'`, and the UI says the file no longer
  exists rather than offering a Reject that would resurrect it. (Offering resurrection is arguably
  useful; it is also surprising. If we do offer it, it must be labelled "recreate this file", not
  "reject".)

This matters more than it sounds: `npm run dev` runs `node --watch server/index.mjs`
(`package.json` scripts), so the server restarts every time anyone edits it.

**How it degrades if the watcher misses an event.** `fs.watch` is not guaranteed. Three layers, all
of which must be *visible* rather than silent:
1. **On selection.** Whenever a user selects an artifact, the content fetch already happens
   (`src/ui/viewers.jsx:115-120`). Compare the fetched content's hash to `lastSeenSha`; a mismatch
   means we missed an event — create or update the pending record right there. This makes the
   common case self-healing at zero cost.
2. **On any `/api/artifacts` list.** The listing already stats every file (`server/index.mjs:512`).
   Compare `mtimeMs` against tracked records and reconcile. Again free.
3. **Explicit failure state.** If `fs.watch` throws or the pending set overflows, emit
   `{type:'degraded', reason}` on the SSE channel and have the UI show "live watching unavailable —
   changes are detected when you open a file" with the pending count rendered as `—`. Per the honesty
   rules already enforced in `src/sections/WorkingSet.jsx:18-22` and `:33-34`, **null is not zero**: a
   `0` in that slot would be a claim that nothing changed, which we would not know.

There is no polling fallback. Layers 1 and 2 are event-driven off user actions we already perform.

---

# The `EditorHost` contract for us

Upstream's interface is 8 methods and its real content is the state-ownership rule. Our version,
against CodeMirror (`@uiw/react-codemirror`, used at `src/ui/viewers.jsx:29` and
`src/sections/HooksSection.jsx:124`) and `marked` (`src/ui/viewers.jsx:128`):

```js
// src/lib/editorHost.js
/**
 * A format adapter. Content NEVER lives in React state in the adapter — the host pushes with
 * applyContent and pulls with getCurrentContent. That single rule is why one shape can serve a
 * CodeMirror instance, a marked-rendered <div>, and a <table>.
 */
export const EditorHostShape = {
  applyContent(text) {},            // host → editor. Load, external change, and diff-mode exit.
  getCurrentContent() {},           // editor → host. OPTIONAL: read-only adapters omit it.
  onDiffRequested({ original, current, meta }) {},  // enter diff mode, native rendering
  onDiffCleared() {},                               // leave diff mode, back to applyContent state
  onExternalChange({ path, sha }) {},// watcher said the file moved under us
  onThemeChanged(theme) {},          // we hardcode theme="dark" today; see note
  supportsNativeDiff: false,         // false ⇒ host renders unified DiffView instead
  setDirty(dirty) {},                // OPTIONAL until anything is editable
}
```

Seven, not eight: upstream's `saveContent` and `onSaveRequested` have no meaning while every viewer
is read-only (`src/ui/viewers.jsx:29` passes `readOnly`). Adding them speculatively is how a contract
rots. They go in the day something is editable.

**Echo detection** lives in the host, not the adapters, exactly as upstream puts it in
`useEditorLifecycle`: the host records `(path, sha, writtenAt)` for every write it causes and ignores
watcher events matching within the window — **after** checking the pending-tag table, never before.

**Theme** is currently hardcoded `theme="dark"` at `src/ui/viewers.jsx:29` and
`src/sections/HooksSection.jsx:124`, while the rest of the app themes through CSS variables
(`--bg-surface`, `--green-bg`, …). `onThemeChanged` is in the shape because the contract should not
bake in a bug, but wiring it is out of scope here.

## Which formats can support a native-format diff

| Ext | Current rendering | Native-format diff? | How |
| --- | --- | --- | --- |
| `csv` | `parseCSV` → `DataTable` (`viewers.jsx:131`) | **Yes** — feature 7 | Row alignment via `lineDiff` on row keys, then per-cell compare; phantom rows for deletions; sorting disabled in diff mode |
| `json` | `JsonView` (`viewers.jsx:75-86`); array-of-objects → `DataTable` | **Yes, partially** | Array-of-objects takes the CSV path. Nested objects: a key-path diff over `KVTable` (`src/ui/planWidgets.jsx:79`) is possible but is a second design; **v1 falls back to unified diff on the pretty-printed text**, which is already what `JsonView` renders (`:82`) |
| `md` | `marked.parse` → `dangerouslySetInnerHTML` (`viewers.jsx:128`) | **No, not honestly** | Nimbalyst does inline red/green *inside rendered prose* because Lexical gives them a node tree. `marked` gives us an HTML string. Diffing rendered HTML strings produces garbage at tag boundaries. `marked.lexer()` returns a token list and a **block-level** diff (which paragraphs/headings/list items changed) is achievable — that is a real feature but it is M on its own and it is not word-level. **v1: unified text diff.** Do not claim WYSIWYG markdown diff. |
| `jsx`/`tsx` | `JsxLive` sandboxed iframe (`viewers.jsx:90-106`) | **No** | A live component preview has no diff representation. Diff falls back to source. Note the iframe needs CDN access (`:89`) and is our one non-local rendering path |
| `js/ts/py/sh/…` | `CodeView` → CodeMirror readOnly (`viewers.jsx:22-32`) | **Not in v1** | CodeMirror can render a diff via decorations, but `@codemirror/merge` is a **new dependency** and is not justified when `DiffView` (`src/ui/tabs.jsx:27`) already renders red/green lines with zero deps. Revisit only if inline word-level diff is asked for by name |
| `html`/`svg` | iframe / `<img>` (`viewers.jsx:129-130`) | **No** | Visual diff of rendered output is an image-diff problem. Falls back to source diff |
| `png/jpg/gif/webp` | `<img>` (`viewers.jsx:122`) | **No** | Would need an image-diff library — a new dep for a case we do not have. Show "binary file — before/after thumbnails" side by side, no diff claim |
| `pdf` | iframe (`viewers.jsx:123`) | **No** | Side-by-side only |

**Default when `supportsNativeDiff === false`: the unified red/green `DiffView` from
`src/ui/tabs.jsx:27`, with a one-line note naming the format's limitation.** The note is the point —
a fallback that does not announce itself as a fallback is how "WYSIWYG diff" becomes a lie.

---

# Not worth taking

- **A worktree management panel.** `_SYNTHESIS.md` and the research both rule against it, and I am
  not arguing the other way: their own `THE_HARNESS.md:475` calls worktrees "underused because
  creating one is a UI action". We would spend L effort to build the exact affordance whose authors
  report it does not get used. If the capability is wanted, it belongs in `HOOK_LIBRARY`-style
  one-click form or a slash command, not a panel. (For the record, we *do* already create worktrees
  programmatically in the release/merge-queue code at `server/index.mjs:4437-4459` — that is
  machinery, not a user-facing panel, and it should stay that way.)
- **Nimbalyst's telemetry client.** `_SYNTHESIS.md:349-350` and
  `native-guis-flycrys-nimbalyst.md:501-508`: after opting out, a `nimbalyst_session_start` event
  still fires per launch from a force-opted-in PostHog instance. Zero telemetry is our
  differentiator. The only thing worth copying is the **consent-fails-closed pattern** (consent
  denied until the setting resolves), if we ever add anything optional.
- **An MCP `applyDiff` tool.** Upstream explicitly rejected it and the reason is decisive: agents use
  plain `Edit` and slip past review. The watcher catches bash and manual edits too.
- **A packaged extension SDK, externals system or marketplace.** L+, no third-party ecosystem to
  serve. Take the contract, skip the distribution.
- **Excalidraw, mermaid, data-model or Lexical WYSIWYG editors** as prerequisites for diff. Each is a
  product. Mermaid rendering is independently interesting (`native-guis-flycrys-nimbalyst.md:632-637`)
  and we have d3 in-house, but it is not on this spec's path.
- **PR review mode, Super Loops, Blitz, mobile companion.** Out of scope. We get responsive mobile
  from media queries, which is the structural advantage worth naming rather than matching.
- **`@codemirror/merge` (or any diff library).** `lineDiff` (`src/ui/tabs.jsx:9-25`) is 16 lines,
  already guards against pathological input, and is already the app's diff everywhere else. A new dep
  needs a use case `lineDiff` cannot serve; word-level intra-line diff would be that case, and nobody
  has asked.
- **Polling anything.** Adopt upstream's rule against `setInterval` for git and file state. The two
  existing intervals are unrelated and stay.

## What a web app structurally cannot copy — stated plainly

- **The browser cannot watch the filesystem.** Every watcher lives in `server/*.mjs` and is pushed
  over SSE. Neither upstream had to build this; it is the main cost in feature 1 and the reason its
  effort is M–L rather than M.
- **No embedded PTY.** FlyCrys embeds VTE4, Nimbalyst embeds Ghostty. Our equivalent would be
  xterm.js over a WebSocket to an Express-spawned shell — arbitrary shell exec on a local HTTP port,
  a meaningfully different security bargain. Not a checklist item to match.
- **No sub-second cold start, no single binary, no system MIME icons, no GTK theme following, no
  cross-app drag-and-drop, no native notifications without a permission prompt.** Our compensating
  virtue is no install at all and LAN access from any device.
- **Accept/Reject can never be as fast as a native keystroke.** Every action is an HTTP round trip.
  This is fine at human review speed; it means we should not promise a keyboard-driven
  swipe-through-changes flow with the latency Nimbalyst's mobile app has.

---

# Open questions for the maintainer

1. **Scope of the watcher: `~/.claude` only, or repo paths too?** `safe()`
   (`server/index.mjs:124-130`) confines writes to `~/.claude`, `<project>/.claude` and
   `~/.claude.json`. That is where our *artifacts* are, but it is not where most agent editing
   happens, and feature 4 (commit auto-approve) is nearly inert without repo coverage. Extending to
   repo roots means a second jail — the `server/fe.mjs:453` model, where a root must equal a repo
   derived from your own transcripts — and it means the dashboard can now **write into your source
   tree** on Reject. That is a genuine expansion of blast radius and it is your call, not mine.
   Recommendation if you say yes: repo paths get Reject only behind a per-root opt-in, and every
   Reject there is `backup()`d and appended to `dashboard-versions.jsonl`.
2. **Is a several-edits-stale "original" acceptable, or must it be exact?** This decides whether
   feature 5 ships before feature 6 or instead of it. If exactness is required, feature 6 (the hook)
   is mandatory and feature 5 is only a fallback for edits made before the hook was installed.
3. **Do you want the `file-history` cadence verified before anything else is built?** It is the one
   cheap experiment that could remove the hook dependency entirely. Roughly: edit one file N times
   in a single session, count the resulting `@vN` files. I found 6 `structuredPatch` events against
   one file and only 2 versions, which is evidence *against* one-version-per-edit but is a single
   observation on a single Claude Code version.
4. **Should Reject be reachable at all for a file the agent is still working on?** Upstream's model
   is post-hoc review at human pace, so a Reject during an active turn writes the old content back
   under the agent's feet and the agent's next `Read` sees it. That is arguably correct ("the AI
   always sees the accepted state") and arguably a footgun. Options: allow it (upstream's answer),
   or disable Reject while the file's session is alive in `chats` (`server/index.mjs:866`, which we
   can check cheaply).
5. **Does the profile allowlist replace `--dangerously-skip-permissions`, or sit beside it?** I have
   specified *replace* when `spawn.allowedTools` is non-empty, because passing both makes the
   allowlist decorative. That changes the behaviour of any session started with a profile, and it
   needs verification against the installed CLI (feature 3, Risks). Confirm the intent.
6. **Where should Diff live besides Artifacts?** `WorkingSet`'s dossier
   (`src/sections/WorkingSet.jsx:313-319`) already renders transcript hunks and is the screen scoped
   to your code. It is the natural second home for a real diff, but it currently shows *history*, not
   *pending review*, and mixing them needs a design decision.
7. **`/api/hooks/dryrun` spawns `sh -c` (`server/index.mjs:3644`) and cannot work on Windows.** This
   predates this spec but blocks testing feature 6's hook on the platform this repo is being
   developed on. Fix as part of feature 6, or file it separately?
8. **Retention.** Reviewed records accumulate in `~/.claude/dashboard-history/`. Cap by count, by
   age, or keep forever? Upstream keeps tags indefinitely (a user can accept or reject days later),
   but they have a database. I'd suggest: keep `pending` forever, prune `reviewed` older than 30 days
   whose content is byte-identical to disk.

---

## Appendix — what was verified during this task

- `~/.claude/file-history/<sessionId>/<sha256(absPath).utf8.hex[0:16]>@v<N>` holds **full file text**.
  Key derivation reproduced exactly (`cc10a9cdae9e63c3`). Newest version byte-size-identical to the
  live file, so versions are post-write states. **Version cadence not verified** — 6 edit events, 2
  versions.
- No filesystem watcher exists anywhere in `server/*.mjs`.
- `lineDiff` + `DiffView` (`src/ui/tabs.jsx:9-35`) already provide zero-dependency red/green diff.
- `harness-profiles.json` (`server/index.mjs:2019`) is a settings-preset store, **not** a spawn-arg
  store — extending it is cheaper than adding a parallel one.
- Every `claude` spawn in this repo passes `--dangerously-skip-permissions`
  (`server/index.mjs:916`, `server/atoms.mjs:42`, `server/index.mjs:3712`).
- Node v26 in this environment ⇒ `fs.watch({recursive:true})` needs no new dependency on any of the
  three platforms.
