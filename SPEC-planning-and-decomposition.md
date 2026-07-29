# Implementation spec — planning and decomposition

> Turns the `ccpm.md` research note plus `_SYNTHESIS.md` §7 Cluster F into shippable work.
> Written 2026-07-29 against the tree at `research/upstream-ecosystem-analysis`. Every file path and
> line number below was read in this checkout, not inferred from the research note.

## Why this document exists

`_SYNTHESIS.md:267` states the split in one line: *"It plans richly and observes nothing; we observe
richly and plan thinly."* ccpm decomposes work into a dependency-annotated task set and can then see
nothing about whether that work is happening. We read JIRA changelogs, GitHub PRs, CI runs, git
worktrees and Claude Code transcripts — and then hand the user a flat list with no answer to "what
can I start right now?".

This spec closes the planning gap without importing the blindness.

### Version provenance of every borrowed idea

ccpm was rewritten on 2026-03-18 (`ccpm.md:27`). **v2** (`main`) is a 27-file Agent Skill; **v1**
(branch `v1`) is the 100-file `/pm:*` system that every third-party writeup describes. Each feature
below names which version its source lives in. Where they disagree, v2 wins unless noted.

### Supply-chain rule, non-negotiable

`ccpm.md:815` and `_SYNTHESIS.md:156`: the v1 installer command `curl -sSL https://automaze.io/ccpm/install | bash`
— **documented in ccpm's own `install/README.md:6` and `README.md:395`** — deployed an XMRig Monero
miner and an unlabelled `ssh-ed25519` key appended to `~/.ssh/authorized_keys`. The maintainer
attributes it to a domain redirect rather than the repo; that attribution is **unverified**. The
code is MIT and fine to read. **Copy from a git checkout only. Never run any installer, hosted or
otherwise, from this project or any of the other fifteen.**

### Three corrections to the research note, found by reading our own code

The task brief says to trust our code over the research where they disagree. Three rows of
`ccpm.md`'s overlap table (`ccpm.md:866–888`) are wrong about us, and the spec below is built on the
corrected picture:

| `ccpm.md` claim | Reality in this tree |
|---|---|
| "Git worktree lifecycle (create/assign/merge/cleanup) — **NONE**" (`ccpm.md:879`) | `ensureWorktree()` at `server/index.mjs:4142` creates one worktree **per board ticket** under `~/.claude/board-worktrees` (`server/index.mjs:4076`), on branch `<prefix><id>`, and stacks a dependent ticket's branch on its blocker's branch (`server/index.mjs:4149-4150`). `DELETE /api/board/tickets/:id` removes it (`server/index.mjs:4207`). **Our isolation is per-ticket and enforced by git; theirs is per-epic and advisory** (`ccpm.md:576-587`). We are ahead here, not behind. |
| "Conflict handling between parallel agents — **NONE**" (`ccpm.md:881`) | `conflictScan()` at `server/index.mjs:4131-4141` diffs each in-flight ticket's branch against the project base and reports real overlapping file paths. It is rendered as the `⚠ overlap` chip at `src/sections/BoardSection.jsx:55`. Ours is **measured from git**; theirs is a file-glob declared in a markdown file by a model. |
| "Epic → task decomposition … Their `conflicts_with` + file-glob concept has no analogue anywhere in our codebase" (`ccpm.md:870`) | Board tickets already carry `deps` (`server/index.mjs:4184`), `/api/board` derives `depBlocked` (`server/index.mjs:4166`), and `POST /api/board/tickets/:id/analyze` (`server/index.mjs:4213-4230`) already asks an agent for `[{title, desc, deps}]`. What is genuinely missing is **file scope**, **an explicit parallel/sequential verdict**, and any of this reaching JIRA/GitHub work rather than only the local Task Board. |

The real gap is narrower and sharper than the note claims. That is good news: the features below are
smaller than the research implies.

### Where things may land, and where they may not

`server/eng.mjs:1-23` defines two data planes as a structural boundary, and
`test/server/eng-privacy.test.js` asserts it statically. Anything added under `/api/eng/*` is
**PLANE A** — JIRA/GitHub/CI artifacts only, no transcript-derived field, and no key matching the
banned regex at `test/server/eng-privacy.test.js:10` (`token`, `cost`, `session`, `duration_ms`,
`spend`, …). Anything that spawns an agent or holds a `sessionId` is **PLANE B** and belongs in
`server/ticket.mjs` or `server/index.mjs`. Feature 1 is plane A. Feature 4 is plane B. Getting that
backwards fails the test suite, by design.

---

## 1. Dependency-aware ready / blocked queue

**Customer need.** An engineer opens the Inbox (`src/sections/InboxSection.jsx`) and gets a flat,
severity-sorted list of things that are *wrong*: PRs with no review, tickets past budget, a red main
(`server/index.mjs:2661-2703`). Nothing answers the first question of the working day — *"of the
things assigned to me that are not done, which ones can I actually start right now, and which are
waiting on something else?"* Today they answer it by opening JIRA, reading each ticket's Links
panel by eye, and remembering which blockers closed. On a board of 40 open tickets that is a
five-minute manual graph traversal, repeated daily, and it is wrong whenever someone closes a
blocker without telling anyone.

**Value to Loush.** This is the cheapest real capability in the whole research corpus, because
**the data is already fetched, already computed, already on the wire, and consumed by nothing.**
`server/eng.mjs:378-382` builds a full link graph off `fields.issuelinks` —
`{key, dir, type, rel, status}` per link — and ships it on every issue at `server/eng.mjs:389`. A
grep across `src/`, `server/` and `lib/` finds **zero consumers** of `issue.links`. The comment on
line 377 even says so: *"issuelinks are fetched today and used only to resolve linkedKey — keep the
whole graph (blocker matrix)"*. Someone already paid for this data and left the note. This feature
is cashing it in.

**How the upstream repo does it today.** ccpm **v2**, `skill/ccpm/references/scripts/next.sh` (61
lines) and `blocked.sh` (67 lines) — `ccpm.md:749-753`. They glob `.claude/epics/*/[0-9]*.md`, grep
`status` / `depends_on` / `parallel` out of YAML frontmatter, and partition open tasks into "ready"
(no unmet dependency) and "blocked" (with the specific still-open blockers named). Zero `gh` calls,
zero tokens, instant. `ccpm.md:752` is right about why it is good: the answer's *shape* is correct
— a filtered actionable set, not a list of everything.

Two things we must **not** copy: their frontmatter parsing is `grep | sed` with no YAML parser
(`ccpm.md:857`), which silently corrupts on quoted colons; and their dependency arrays are rewritten
in place during GitHub sync (`ccpm.md:251`), a two-phase rename that `ccpm.md:765` warns will corrupt
dependency arrays if the ordering is wrong. We need neither, because our identifiers are JIRA keys
and never change.

**How we implement it here.**

1. New pure function in `server/eng.mjs`, next to `epicRollup()` (`server/eng.mjs:919`), signature
   `readyQueue(issues)`. No I/O, no `gh`, no `fetch` — it runs over the `issues` array
   `computeSnapshot()` already has in hand.
2. Blocker edges come from three sources, in precedence order:
   - `i.links` where `norm(l.rel)` is `is blocked by` / `blocks` (the JIRA link types), giving a
     directed edge. Treat `dir === 'inward'` + `rel: 'is blocked by'` as "this issue depends on
     `l.key`". Any other `rel` is ignored — do not guess at `relates to`.
   - `i.parent` (`server/eng.mjs:410`): a child does not block its parent, but a parent that is
     `Done` while children are open is a data-quality signal, not a dependency. Surface it as a
     warning, not an edge.
   - Board tickets: `deps` on `taskboard.json` tickets (`server/index.mjs:4184`), joined by
     `jiraKey` (`server/index.mjs:4185`) when one is set. This is what makes the queue span both
     systems.
3. Resolution rule, and it is the whole design: a blocker is **unmet** when the linked issue is
   present in the snapshot and `!blocker.live`. A blocker we have **never seen** — a key from a
   project that is not configured, or one outside the `updated >= -180d` JQL window at
   `server/eng.mjs:69` — is `unknown`, **not** met. Rendering an unresolvable blocker as "clear"
   would be honesty-rule 1 (`README.md:422`) in its exact original form: turning "not measured" into
   a green light.
4. Return shape (plane-A safe — no banned key names):
   ```js
   {
     ready:   [{ key, project, summary, status, assignee, pts, ageWorkDays, parallelWith: [key…] }],
     blocked: [{ key, …, blockedBy: [{ key, status, live, source: 'jira'|'board' }] }],
     unknownBlockers: [{ key, blocker, reason: 'outside the configured projects' }],
     cycles:  [[key, key, …]],
     counts:  { ready: n, blocked: n, unknown: n },
   }
   ```
5. Cycle detection: reuse the exact guard shape from `src/lib/plan.js:165-180` — a `visiting` set,
   return depth 0 on re-entry. Do not throw. A JIRA board with a circular blocker link is a
   real-world occurrence; the queue must still render, with the cycle named. ccpm declares circular
   dependencies "an error to be checked before finalizing" (`ccpm.md:240`) and then does nothing
   about it.
6. Wire into `derive()` at `server/eng.mjs:1056` as `queue: readyQueue(issues)`. It is then on
   `/api/eng/snapshot`, in the 2-hour cache (`server/eng.mjs:1005`) and in the disk warm-start
   (`server/eng.mjs:1009`) for free — no new endpoint, no new fetch, no new TTL.
7. UI, Inbox: a new section above the item list in `src/sections/InboxSection.jsx`, inside the
   existing `work` plane (`src/sections/InboxSection.jsx:73-76`). Two columns, "Ready to start" and
   "Blocked", each row deep-linking to `jiraLink(i)`. Blocked rows name their blockers with the
   blocker's current status inline.
8. UI, Board: `src/sections/BoardSection.jsx` already renders a `🔒 deps` chip at line 56 from
   `depBlocked`. Extend it to show the blocking titles on hover and to grey the `▸ Start` control,
   matching the server-side refusal already at `server/index.mjs:4252-4253`.

**Effort.** **S** — ~50 lines in `server/eng.mjs`, ~70 lines of JSX across two sections. No new
dependency, no new network call, no new cache.

**Risks and unknowns.**
- **Unverified:** the exact `rel` strings JIRA returns for blocker links on the operator's instance.
  `server/eng.mjs:381` reads `l.type?.outward` / `l.type?.inward` verbatim, and link-type names are
  configurable per JIRA site. Mitigation: match case-insensitively on `/block/`, and emit the set of
  distinct `rel` values actually observed into `provenance` (`server/eng.mjs:1111`) so a site using
  different names is diagnosable rather than silently empty.
- The 800-issue hard cap at `server/eng.mjs:262` and the 180-day JQL window mean the blocker graph is
  necessarily partial on a large board. That is what `unknownBlockers` is for. It must be visible in
  the UI, not swallowed.
- Board↔JIRA join is by `jiraKey`, which is nullable (`server/index.mjs:4185`). Tickets without one
  simply do not join; they must not be dropped from the board-side queue.

**Definition of done.**
- `readyQueue()` has unit tests covering: met blocker, unmet blocker, unknown blocker, a 2-cycle, a
  3-cycle, an issue with no links at all, and a board ticket joined by `jiraKey`.
- `test/server/eng-privacy.test.js` passes unchanged — the new payload introduces no banned key.
- With zero open issues the Inbox renders **"nothing is open — this is an empty board, not a clear
  runway"**, never "0 blocked" as a green state (honesty rule 2, `README.md:425`).
- With issues open but no blocker links anywhere, the panel renders **"no blocker links found on
  these N tickets — this board does not use JIRA issue links, so 'ready' here means 'not done',
  nothing stronger"**, and the ready column is labelled accordingly. A board that does not link
  blockers must not receive a fabricated all-clear.
- Every `blockedBy` entry shows the blocker's own status string, so the user can see *why* it is
  still unmet.
- `unknownBlockers` is rendered, with its reason, not filtered out.
- No new `gh` or `fetch` call appears in a cold `/api/eng/snapshot` trace.

---

## 2. Repo-write identity guard

**Customer need.** A user configures a project in `projects.json`, flips `"writes": true`, and posts
a generated test plan to JIRA or a comment to a PR. If the `githubRepo` or `jiraProjectKey` in that
config points somewhere they did not intend — a fork, a template, a colleague's repo left over from
a copied config file — the write lands there, publicly, under their own credentials, and cannot be
recalled.

This is not hypothetical. `ccpm.md:557` documents the outcome: ccpm's upstream issue tracker contains
**dozens of strangers' epics** — `#981` "Epic: Comprehensive Invoice Management and Reimbursement
System (fapiao)", `#982`–`#990`, `#935`–`#945`, `#1018`–`#1020` — because users cloned the template
and left `origin` pointing at `automazeio/ccpm`. Their agents then filed a full epic breakdown into
someone else's public repository. **We infer write targets from local config in exactly the same
way.**

**Value to Loush.** Our `writes` flag (`server/eng.mjs:74`) is a boolean: *may I write?* It never
asks *am I writing where the user thinks I am?* The four write paths —
`server/eng.mjs:1480` (`gh pr comment`), `:1489` (`gh pr edit --add-reviewer`), `:1498` (JIRA
transition), `:1580` (JIRA comment) — all derive their target from `cfgFor()`/`cfgForTicket()`
(`server/eng.mjs:1210-1212`) with no identity assertion. Adding one converts a boolean permission
into a checked one, and it is the cheapest irreversible-mistake prevention available anywhere in
this codebase.

**How the upstream repo does it today.** ccpm **v2**, prepended to every GitHub write in
`references/conventions.md` and `references/sync.md` (`ccpm.md:546-555`):

```bash
remote_url=$(git remote get-url origin 2>/dev/null || echo "")
if [[ "$remote_url" == *"automazeio/ccpm"* ]]; then
  echo "❌ Cannot write to the CCPM template repository."; exit 1
fi
```

Take the **principle**, not the string. Their check hardcodes one blocklisted repo; ours should be an
allowlist assertion, which is strictly stronger.

**How we implement it here.**

1. New helper in `server/eng.mjs`, beside `ghAvailable()` (`server/eng.mjs:459`):
   ```js
   function assertWriteTarget(cfg, kind)  // kind: 'github' | 'jira'
   ```
   For `github`: run `gh repo view <cfg.githubRepo> --json nameWithOwner,isTemplate,viewerPermission`
   through the existing `gh()` wrapper (`server/eng.mjs:454`). Refuse when `nameWithOwner` does not
   case-insensitively equal `cfg.githubRepo`, when `isTemplate` is true, or when `viewerPermission`
   is `READ` or `NONE`. Memoize per repo for the process lifetime, like `ghLoginMemo`
   (`server/eng.mjs:462-470`).
   For `jira`: assert the resolved `cfg.jiraHost` matches the host the credentials actually
   authenticate against — `whoAmI()` (`server/eng.mjs:474-484`) already resolves the JIRA identity;
   extend it to carry the site host and compare.
2. Call it in all four write routes, **after** the existing `cfg.writes` check and **before** the
   `gh`/`fetch` call. On refusal return `403` with the same error shape already used at
   `server/eng.mjs:1483` — a message that names the configured target, the resolved target, and the
   exact file to fix (`projects.json`).
3. A `dry-run` mode is worth having: `?check=1` on any write route returns the resolution result
   without writing. It costs three lines and makes the guard testable from the UI.

**Effort.** **S** — one helper (~35 lines), four call sites, one memo.

**Risks and unknowns.**
- `gh repo view` is a network call on a path that is currently local-only. Memoize hard, and treat a
  network failure as **refuse**, not allow: a write is irreversible and the whole point of the guard
  is the case where you cannot be sure.
- `viewerPermission` values are **unverified** against the operator's `gh` version. Match on the
  documented enum and treat an unrecognised value as refuse.
- This will be mildly annoying the first time it fires on a legitimately unusual setup (SSO-gated
  org, repo renamed upstream). The error message must therefore name the exact override, and there
  must be one: a `"trustTarget": true` per-project escape hatch in `projects.json`, documented in
  `projects.example.json`.

**Definition of done.**
- All four write routes refuse when the resolved GitHub `nameWithOwner` differs from the configured
  `githubRepo`, with a message naming both.
- With `gh` unauthenticated, writes refuse with the existing `GH_UNAUTHED` message
  (`server/eng.mjs:1032`) rather than a new confusing one.
- With no project configured at all, the existing 400 at `server/eng.mjs:1482` still fires first —
  the guard adds a case, it does not reorder the existing ones.
- A test asserts refusal on template repos and on `viewerPermission: 'READ'`.
- `projects.example.json` documents `trustTarget`, and the README's write-gate section mentions the
  guard.

---

## 3. Zero-token local status index

**Customer need.** A cold `/api/eng/snapshot` is *"~65s of live JIRA + GitHub"* by the module's own
admission (`server/eng.mjs:988`). We already mitigate this with a disk warm-start
(`server/eng.mjs:1009-1018`) and a 2-hour TTL. But every question about *local* planning state —
what is on the board, which tickets have a design document, which have acceptance criteria, what is
blocked by what — currently rides on that same snapshot or on ad-hoc reads scattered across three
modules. On a plane, on a bad hotel connection, or with an expired JIRA token, the user gets
`available: false` for questions whose answers are sitting on their own disk.

**Value to Loush.** `_SYNTHESIS.md:270` calls ccpm's tracking layer out specifically: *"Their
tracking is 14 bash scripts reading only local files, zero `gh` calls, zero tokens."* `ccpm.md:89`
calls it *"the most defensible engineering idea in the project."* It is, and we half-have it already
— `ccpm.md:878` correctly observes that our whole server is deterministic by
design. What we lack is one place that answers the local questions **without touching the network at
all**, and can therefore be trusted to work when everything else is degraded.

**How the upstream repo does it today.** ccpm **v2**, `skill/ccpm/references/scripts/*.sh` — 14
scripts, 1,187 lines total (`ccpm.md:356-375`). `status.sh` (42), `next.sh` (61), `blocked.sh` (67),
`in-progress.sh` (74), `standup.sh` (86), `epic-status.sh` (90), `validate.sh` (96). Every one reads
only `.claude/epics/*/[0-9]*.md` and greps frontmatter; `ccpm.md:538` confirms **no `gh` calls at
all**. Progress is `closed_task_files / total_task_files`.

Port the **discipline** — a network-free tier with its own route — not the scripts. Bash is the wrong
language for us (`ccpm.md:47-51` documents their Windows second-class status, issues `#963` and
`#973`), and their frontmatter grep is the parsing bug at `ccpm.md:857`.

**How we implement it here.**

1. New module `server/planindex.mjs`, exporting `localIndex()`. It reads, and only reads:
   - `~/.claude/taskboard.json` via the existing reader (`readBoard()`, used at
     `server/index.mjs:4161`) — stages, `deps`, `conflictRisk`, `branch`, `worktree`, `jiraKey`.
   - The per-ticket state files under `TICKET_DIR` — `readState()` shape at `server/ticket.mjs:73`,
     enumerated the way `listKeys()` already does at `server/ticket.mjs:93-121`. Gives `doc`,
     `graph.nodes.length`, `fetchedAt`, cached `ticket.summary`/`status`.
   - `eng-artifacts.json` (`readArtifacts()`, `server/eng.mjs:1196`) — which tickets have AC / tests.
   - The **disk** snapshot at `~/.claude/eng-snapshot.json` (`server/eng.mjs:1006`), read directly
     and **labelled with its `writtenAt`**, never refreshed from here.
2. New route `GET /api/plan/index`. Contract: **this route never opens a socket.** Enforce it with a
   test that stubs `fetch` and `spawnSync` to throw, calls the handler, and asserts a 200.
3. Payload answers the five questions their scripts answer, over our data:
   `status` (counts by board stage), `next` (feature 1's `ready`, restricted to what is resolvable
   locally), `blocked`, `inProgress` (board tickets whose stage is in-flight), `validate`
   (integrity: a board ticket whose `worktree` path no longer exists on disk; a ticket state whose
   `doc.path` is gone; a `jiraKey` pointing at an unconfigured project — the same class of check as
   ccpm's `validate.sh`).
4. Every field carries its own age. `eng-snapshot.json` may be up to 14 days old before it is
   scrapped (`server/eng.mjs:1008`); the payload must say how old the copy it read was, per source.
5. Surface it as the fallback path for the Inbox's work plane: when `/api/eng/snapshot` returns
   `available: false`, render the local index with an explicit *"offline — from local files, JIRA
   last read <age> ago"* banner, instead of the current empty state.

**Effort.** **S/M** — ~150 lines of new module, one route, one UI fallback branch. All four readers
already exist; this composes them.

**Risks and unknowns.**
- Scope discipline. The temptation is to make this a second snapshot. It is not: it answers **local**
  questions and reports the age of anything it inherited. If a number cannot be computed from disk,
  it is `null` with a reason, never estimated.
- Reading `eng-snapshot.json` from a second module means two readers of one file format. Extract the
  read into `lib/` so `SNAP_SCHEMA` (`server/eng.mjs:1007`) is checked in exactly one place.
- Plane discipline: `server/planindex.mjs` reads `taskboard.json` and ticket state, which are plane-B
  adjacent (they reference agent runs). It must therefore live **outside** `/api/eng/*` — hence
  `/api/plan/*` — and must not be imported by `server/eng.mjs`. The one-way dependency rule at
  `server/ticket.mjs:3-5` applies identically.

**Definition of done.**
- A test stubs all network primitives to throw and asserts `GET /api/plan/index` returns 200.
- Every section of the payload carries `sourceAge` in ms, and `null` where a source is absent.
- With no board, no saved tickets and no snapshot on disk, the route returns 200 with every section
  `null` and a `reason` per section — not `{}`, not zeros.
- The Inbox offline banner names which source it is showing and how old it is.
- `validate` reports at least: missing worktree directory, missing design document, `jiraKey`
  pointing at an unconfigured project. Each with the exact path or key.

---

## 4. Task decomposition with dependency and file-scope metadata

**Customer need.** A user opens `TRN-1234` in the Ticket section, generates acceptance criteria and a
design document grounded in the real checkout, and then… stops. `src/sections/TicketSection.jsx:225`
offers four tabs — Ticket, Criteria, Design, Files — and the pipeline ends at *"here is what to
build"*. To turn that into work they hand it to the Task Board
(`POST /api/ticket/:key/board`, `server/ticket.mjs:898-928`), which creates **one** ticket, and then
run `/analyze` (`server/index.mjs:4213-4230`) which asks a model for `[{title, desc, deps}]` from
the **ticket title and description only** — a second, ungrounded pass that discards the design
document, the acceptance criteria, and the file-level component graph the design run already
produced. The user then hand-edits the proposal in a cramped inline form
(`src/sections/BoardSection.jsx:114-130`) and accepts it.

So we ask a model to guess a breakdown twice, ungrounded, after having already computed a grounded
component-and-file graph. That is the gap.

**Value to Loush.** `_SYNTHESIS.md:277-279` ranks this as the second ccpm adoption and says why:
*"decomposition-with-dependencies as a fourth generator in `server/ticket.mjs` (M; our checkout
grounding makes our version strictly better than theirs)."*

**The "strictly better" claim is not marketing, and it is worth stating precisely, because it is the
argument for building this at all.**

ccpm's task files declare `conflicts_with: []` and their stream analyses declare `Files: src/db/*`
(`ccpm.md:196-204`, `ccpm.md:279-290`). Both are **written by a model that has never opened the
repository**. `ccpm.md:882` is explicit: *"ccpm's PRD/epic generation is ungrounded — it writes from
the conversation, not from the code."* Nothing checks the glob. `ccpm.md:587` concedes the
consequence: isolation is *advisory*, and a violation is discovered at merge time.

We have a machine that checks exactly this claim, and it is already written and already shipping.
`GET /api/ticket/:key/files` (`server/ticket.mjs:1073-1135`) takes the file scopes off the design
graph, walks the real repository with `indexRepo()` (`server/ticket.mjs:1141-1164`), builds a real
import graph via `buildImportGraph()` (`server/ticket.mjs:1162`), and sorts every claimed path into
**verified** / **planned-edit** / **planned-new**. It already emits the two warnings that matter:
`missing-file` — *"the design says it will modify X, which does not exist"* (`server/ticket.mjs:1103`)
— and `exists-already` (`server/ticket.mjs:1108`). It reports `importers: null` rather than `0` for a
file with no source to parse (`server/ticket.mjs:1105`).

So: **ccpm's file scopes are assertions; ours are assertions we have already built the validator
for.** A decomposition generator here inherits that validator for free. Their version discovers an
overlapping scope at `git merge`; ours discovers it before an agent starts.

**How the upstream repo does it today.** ccpm **v2**, `skill/ccpm/references/structure.md`
(`ccpm.md:188-240`). Task files carry:

```yaml
depends_on: []            # issue numbers that must close first
parallel: true            # may run concurrently with non-conflicting tasks
conflicts_with: []        # issue numbers touching the same files
```

plus `Size: XS/S/M/L/XL`, an `## Acceptance Criteria` checklist and a batching strategy by epic size
(`ccpm.md:225`). Two constraints from `references/plan.md` are worth stealing verbatim
(`ccpm.md:186`): **"aim for ≤10 tasks total, prefer simplicity over completeness"** and **"look for
ways to leverage existing functionality before creating new code."** Both are explicit anti-bloat
guards on the model, and both already have siblings in our prompts —
`server/prompts/design-plan.md:34` says *"Prefer reusing what exists over adding"* and
`server/prompts/ac.md:32` caps criteria at about ten.

The **v1** `<N>-analysis.md` parallel-stream artifact (`ccpm.md:263-302`) is the richer format, with
per-stream file globs, coordination points and a with/without wall-time comparison. **Do not take
the wall-time comparison.** `_SYNTHESIS.md:169` records ciscoittech's identical "3–6× faster" claim
being computed from an assumed sequential baseline, and `_SYNTHESIS.md:172` records ccpm's own
efficiency numbers as having no harness or data. A "58% efficiency gain" printed from a model's
guess at stream hours is exactly the fabricated derived statistic honesty rule 4 (`README.md:430`)
forbids.

**Do not take the mandatory PRD waterfall.** `ccpm.md:837` quotes issue `#975` from their own
tracker: the workflow is *"rigid and slow"*, small fixes do not fit an epic-shaped flow, so you
either build a whole epic for a typo or step outside the tool. `ccpm.md:831` quotes HN's tmvphil on
the deeper failure: *"Such a linear breakdown doesn't work when implementation reveals you need X'
instead of X"*. Decomposition here is **optional and incremental**: a fourth generate button next to
three existing ones, usable on any ticket at any time, re-runnable, hand-editable, and never a gate
on anything.

**How we implement it here.**

1. **New prompt file** `server/prompts/decompose.md`, loaded through the existing `promptFile()`
   (`server/ticket.mjs:410-413`) with the same refuse-on-unreadable behaviour as
   `designPrompt()` (`server/ticket.mjs:417`) — a degraded prompt must fail loudly, not silently
   produce ungrounded output.
2. **Fourth kind** in `POST /api/ticket/:key/generate` (`server/ticket.mjs:604`): change the
   validation at line 607 from `['ac', 'tests']` to `['ac', 'tests', 'decompose']`, and the prompt
   selection at line 641 accordingly. Everything else on that route already does what we need:
   - runs with `cwd: repo.dir` so the model can grep the real tree (`server/ticket.mjs:668`);
   - refuses a duplicate in-flight generation of the same kind (`server/ticket.mjs:622-628`);
   - respects `MAX_CONCURRENT` (`server/ticket.mjs:629-634`);
   - stamps `groundedIn: repo.repo` and `reqHash` so staleness works (`server/ticket.mjs:674-683`);
   - is **read-only** — `writesRepo` is design-only (`server/ticket.mjs:364`), so no per-repo lock
     and no staging file.
3. **Feed it what we already have.** The route already passes prior AC into the `tests` prompt
   (`server/ticket.mjs:645`, `:661`). Do the same for `decompose`, plus two more inputs ccpm cannot
   supply:
   - the **design document** body, if `readState(...).doc` exists (`server/ticket.mjs:693-700`);
   - the **component graph** node/file list, serialised the way the design-chat prompt already does
     at `server/ticket.mjs:1015-1016`.
   A decomposition that has read the design's own file table cannot invent a different one.
4. **Store it as structured data, not only markdown.** `ac` and `tests` are markdown blobs in
   `eng-artifacts.json` and that is right for prose. A task set is a graph. Persist it on the ticket
   state file (`server/ticket.mjs:73` `EMPTY`) as a new `tasks` key — same atomic
   `writeState` (`server/ticket.mjs:83-91`) — and also render a markdown view for copy/post. Schema
   is specified in §"The decomposition artifact format" below.
5. **Validate every file scope on arrival.** Reuse the `/files` machinery: after parsing, run each
   task's `files[]` through `indexRepo(repo.dir)` and mark each path `verified` / `planned-new` /
   `claimed-modify-but-absent`. Compute `conflictsWith` **from the intersection of scopes**, not from
   the model's opinion. This is the inversion of ccpm's design: they ask the model to declare
   conflicts; we **derive** conflicts and let the model's declaration be a checkable hypothesis.
   Report disagreement — a task the model marked `parallel: true` that our intersection shows
   overlapping is a warning the user should see.
6. **UI.** A fifth tab in `src/sections/TicketSection.jsx:225` — `['Ticket', 'Criteria', 'Design',
   'Files', 'Tasks']`. The Tasks tab renders a table (task, size, depends on, parallel, file scope,
   verified/new) plus a dependency-depth column layout reusing `planLayout()`
   (`src/lib/plan.js:165`), which already does depth-with-cycle-guard over a `dependencies` array.
   Rows are editable; edits persist through the same rev-guarded pattern as the design graph PUT
   (`server/ticket.mjs:958-975`).
7. **Board handoff becomes plural.** Extend `POST /api/ticket/:key/board`
   (`server/ticket.mjs:898-928`) with an optional `tasks` mode: instead of one board ticket, create a
   parent plus N children carrying `deps` — which `POST /api/board/tickets` already accepts
   (`server/index.mjs:4175`, `:4184`) and `/api/board/tickets/:id/breakdown` already does for the
   `/analyze` flow (`server/index.mjs:4236-4242`). **Reuse `breakdown`; do not write `taskboard.json`
   directly** — the self-fetch note at `server/ticket.mjs:916-918` explains why.
   With `deps` populated, `startTicket()`'s existing refusal (`server/index.mjs:4252-4253`),
   `depBlocked` (`server/index.mjs:4166`) and stacked-branch basing
   (`server/index.mjs:4149-4150`) all light up with no further work. This is the payoff: our
   scheduling primitives already exist and have had nothing to schedule.

**Effort.** **M** — one prompt file, ~120 lines of server (parse + validate + persist), ~220 lines of
new tab, ~40 lines extending the board handoff. Largest single item in this spec.

**Risks and unknowns.**
- **Prompt quality is the whole feature.** `ccpm.md:783` says the artifact format is trivial and a
  *good* generator needs a well-tuned prompt plus repo grounding. Budget for iteration; the prompt is
  a file precisely so it can be tuned without a deploy (`server/prompts/design-plan.md:2`).
- **Parsing.** The design run already parses a fenced YAML block out of model prose
  (`parseGraph`, `server/ticket.mjs:809`) with a stored-raw retry path
  (`server/ticket.mjs:942-955`). Use the same shape and the same retry. Do not invent a second
  parsing strategy.
- **A design run costs minutes.** `DESIGN_TIMEOUT` is 30 minutes (`server/ticket.mjs:765`);
  generation is 15 (`server/ticket.mjs:663`). Decomposition should be closer to generation. It
  reads a tree it has been handed a map of.
- **Over-decomposition.** ccpm's ≤10 guidance exists for a reason and HN's review-bottleneck
  critique (`ccpm.md:830`) is the honest counter-argument to parallelism generally: a human reviews
  one change stream at a time. Cap at 8 in the prompt and state the cap in the UI.
- **Unverified:** whether a model handed the design document *and* the graph *and* the AC will
  produce a materially better breakdown than `/analyze`'s title+description prompt. It should, but
  nobody has measured it. Ship the two side by side before deleting `/analyze`.

**Definition of done.**
- `POST /api/ticket/:key/generate` with `kind: 'decompose'` returns a task set; the same route with
  an unreadable `server/prompts/decompose.md` returns 500 and generates nothing.
- Every task's file scope is classified against the real repository, and a task claiming to modify a
  file that does not exist produces the same `missing-file` warning shape as
  `server/ticket.mjs:1103`.
- `conflictsWith` is **derived** from scope intersection; where the model's `parallel` claim
  disagrees with the derived overlap, the UI shows both and marks the disagreement.
- With no design document and no AC, the generator still runs, and the artifact is labelled
  *"decomposed from the ticket text and the repository only — no design document existed"*. It is
  not blocked, and it does not pretend to grounding it lacks.
- With a workspace whose folder no longer exists (`repoFor()` reason at `server/ticket.mjs:297`),
  the tab renders that reason and offers no generate button — matching
  `src/sections/TicketSection.jsx:473-478`.
- Empty state: a ticket with no task set renders *"no breakdown yet — generate one from the ticket
  and the repository"*, never an empty table implying zero tasks.
- Board handoff creates parent + N children with `deps` wired, and `▸ Start` on a child with an
  unmet dep is refused by `server/index.mjs:4252` without any change to that function.
- No number in the Tasks tab is a model-supplied duration, hour count, or efficiency percentage.

---

## 5. Planned-scope overlap matrix

**Customer need.** Two tickets are about to be worked in parallel. Today the only way to learn they
touch the same files is `conflictScan()` (`server/index.mjs:4131-4141`), which diffs **branches** —
so it can only answer once both agents have already written code. By then the cost of the collision
is already sunk.

**Value to Loush.** Once feature 4 exists, every planned task carries a validated file scope. The
same set intersection that `conflictScan` performs over `git diff --name-only` output can be run over
*planned* scopes, before a branch exists. That is the honest version of ccpm's `conflicts_with`, and
it is a straight extension of code we already have.

**How the upstream repo does it today.** ccpm **v1**, `ccpm/rules/agent-coordination.md`
(`ccpm.md:576-606`): file-level partitioning declared in `<N>-analysis.md`, a pre-modify
`git status --porcelain <file>` check with a 30-second sleep-and-retry, a designated owner for shared
files (types, config, `package.json`), and `## Coordination Needed` blocks in stream files acting as
an async message bus. The stated principles are good — *fail fast, humans resolve conflicts, never
`--force`* — and honest about their limits.

**Be honest about theirs, since this is worktree-adjacent.** ccpm's isolation is **per-epic, not
per-agent** (`ccpm.md:576`): all N agents share one worktree and one branch `epic/<name>`, and
nothing in git prevents an agent writing outside its glob — `ccpm.md:587` calls the isolation
"advisory". **Ours is already stronger and we should not regress it**: `ensureWorktree()`
(`server/index.mjs:4142-4158`) gives every board ticket its own worktree and branch, so two agents
physically cannot write the same working copy. This feature adds *foresight*, not isolation — we
have isolation.

**How we implement it here.**

1. Generalise `conflictScan()` into a pure helper in `lib/` taking two `Set<path>` and returning the
   intersection, so the same function serves branch-derived and plan-derived scopes.
2. New derived field on the board payload: `plannedOverlap`, computed over tickets that have a task
   scope but no branch yet. Distinguish it from `conflictRisk` in the payload **and** in the UI —
   `⚠ overlap` (measured, from git) vs `◇ planned overlap` (predicted, from scopes). Never merge
   them into one chip; one is a fact and the other is a forecast.
3. Do **not** port the pre-modify `git status` poll or the sleep-and-retry. It is a runtime
   coordination mechanism for agents sharing a branch, which our per-ticket worktrees make
   unnecessary.

**Effort.** **S**, after feature 4. Pure set logic plus one payload field and one chip.

**Risks and unknowns.**
- Precision. Planned scopes are coarser than diffs; overlap on a shared barrel file or a config file
  will be noisy. Mitigate with the designated-owner idea from `ccpm.md:601`: allow one task to be
  marked owner of a shared path, which suppresses the warning for the others.
- Predicted overlap is a forecast and must be labelled one. `_SYNTHESIS.md:178`: never render a
  derived figure without its basis visible.

**Definition of done.**
- Planned and measured overlap are separate fields and separate chips with distinct labels.
- Hovering a planned-overlap chip lists the exact shared paths and which tasks claim them.
- With no task scopes anywhere, the field is `null` and the UI shows nothing — not "0 conflicts".

---

## 6. Idempotent write-back protocol

**Customer need.** A user generates acceptance criteria and posts them to JIRA
(`POST /api/eng/ticket/:key/comment`, `server/eng.mjs:1580-1598`). They regenerate, post again. Now
the ticket has two long comments and no reader can tell which is current. There is no dedup, no
marker, and no way to tell from the JIRA side whether a comment came from this dashboard at all.

**Value to Loush.** Small, and it makes every write path safer to use — which in turn makes the
`writes: true` opt-in less frightening. It also creates a machine-readable trail we can read back
later to reconstruct when an artifact was published.

**How the upstream repo does it today.** ccpm **v2**, `references/sync.md` (`ccpm.md:512-531`): a
fixed six-section comment skeleton, plus two-layer dedup — a `last_sync` timestamp in frontmatter
(re-sync within 5 minutes prompts for confirmation) and an HTML marker
`<!-- SYNCED: <datetime> -->` written into local files recording what has already been posted.
`ccpm.md:770` correctly identifies this as the cheapest correct solution to idempotent push against
an append-only remote log.

**How we implement it here.**

1. Append a marker to the posted body: `<!-- loush:<key>:<kind>:<reqHash> -->`. We already compute
   `reqHash` (`server/eng.mjs:1314`) — it hashes the *requirement*, not the prompt, for exactly the
   reason described at `server/eng.mjs:1307-1313`. Markdown comments survive `markdownToAdf`
   (`server/eng.mjs:1591`) — **verify this before relying on it**; if ADF drops HTML comments, use a
   visible trailing line instead and say so.
2. Record `postedAt` + `postedHash` on the artifact in `eng-artifacts.json` when a post succeeds.
3. Before posting, if `postedHash === reqHash(d)` and `postedAt` is under 24h old, return `409` with
   the existing comment's URL (`server/eng.mjs:1596` already builds it) and require an explicit
   `force: true`. The UI's existing `confirm()` at `src/sections/TicketSection.jsx:431` becomes an
   informed one.
4. Same treatment for `POST /api/eng/pr/:num/comment` (`server/eng.mjs:1480`).

**Effort.** **S** — ~40 lines across two routes plus the artifact store.

**Risks and unknowns.**
- **Unverified:** whether `markdownToAdf` (`lib/adf.mjs`) preserves HTML comments. `server/eng.mjs:1578-1579`
  notes v3 comment bodies accept neither HTML nor markdown — the body must be an ADF document. Test
  this first; the fallback is a visible provenance line, which is arguably better anyway.
- Do not adopt their five-minute confirm heuristic. A hash comparison is exact; a timer is a guess.

**Definition of done.**
- Posting the same unchanged artifact twice within 24h returns 409 with a link to the existing
  comment, unless `force: true`.
- Posting after the requirement changed (different `reqHash`) proceeds without a prompt.
- A ticket with no prior post shows no dedup state and posts normally.
- `postedAt` is displayed in the Criteria tab footer next to the existing generation provenance line
  (`src/sections/TicketSection.jsx:494-501`).

---

## 7. GitHub epic / task label ingestion

**Customer need.** A team that runs any epic-labelled workflow on GitHub — ccpm's or one of the
several tools that copy its conventions — has structure in their issue labels that Delivery cannot
see. Our epic rollup (`server/eng.mjs:919-957`) groups strictly by JIRA `parent`
(`server/eng.mjs:927`), so a GitHub-only or mixed team gets no rollup at all.

**Value to Loush.** Lowest value-per-effort item in this spec, listed because the brief names it and
because knowing the conventions is cheap even if we never build the ingestion. `_SYNTHESIS.md:221`
states the governing principle for this whole cluster: *"making our dashboard understand their
artifacts beats porting their code, every time."*

**How the upstream repo does it today.** ccpm **v2**, `references/scripts/init.sh` (`ccpm.md:483-508`),
verified against their live label list:

| Label | Colour | Applied to |
|---|---|---|
| `epic` | `#0E8A16` | epic issues |
| `task` | `#1D76DB` | task issues |
| `epic:<name>` | default | both — created **implicitly** by first use, never by `init.sh` |
| `feature` | default | epic issues, alongside `epic` |
| `bug` | `#d73a4a` | bug-report-flow issues |
| `in-progress` | default | added by `gh issue edit --add-label` when work starts |

Full sets on creation: epic → `epic,epic:<name>,feature`; task → `task,epic:<name>`; bug →
`bug,epic:<epic_name>`. Parent→child links use the optional `gh` extension `yahsan2/gh-sub-issue`
(`ccpm.md:58`), degrading to a markdown task-list in the epic body when absent. Epic bodies carry
`- [ ] #<number>` checkboxes flipped to `- [x]` on close (`ccpm.md:532`).

**Two hard warnings.**
1. **Do not port their issue-creation shell.** `ccpm.md:848`: open issues `#1022` (v2 uses the wrong
   `gh-sub-issue` syntax) and `#1024` (`gh issue create --json` is not a flag that command supports)
   mean **the v2 sync path is believed broken and has been for four months**. `_SYNTHESIS.md:344`
   lists it under explicit do-not-adopt. If we ever create issues, re-derive from `gh` docs.
2. `epic:<name>` and `feature` are never explicitly created (`ccpm.md:501`), so an ingester must not
   assume they exist as declared labels.

**How we implement it here.** Read-only, and read-only forever:
1. Extend the PR GraphQL query (`server/eng.mjs:491`) — or add a sibling issues query — to fetch
   issue labels. It is one more field on a query we already run, the same trick documented at
   `server/eng.mjs:486`.
2. In `epicRollup()` (`server/eng.mjs:919`), add a second grouping source: issues sharing an
   `epic:<name>` label, merged with the JIRA `parent` grouping. Keep them distinguishable in the
   payload (`groupedBy: 'jira-parent' | 'github-label'`) so the UI can say where a group came from.
3. Nothing writes a label. Ever. `ccpm.md:557` is the reason.

**Effort.** **M** — GraphQL change plus rollup restructuring plus provenance plumbing, against a
convention no known user of ours currently follows.

**Risks and unknowns.**
- **Unverified:** whether any Loush user runs a labelled epic workflow on GitHub at all. This may be
  speculative work. Ship features 1–6 first and revisit only on a real request.
- Merging two grouping sources risks double-counting an issue that is both a JIRA child and a
  labelled GitHub task. Key on the JIRA key where one exists, label group otherwise.

**Definition of done.**
- A repo with no `epic` labels produces exactly the rollup it produces today — no behaviour change.
- Every group carries `groupedBy`, rendered in the UI.
- No code path writes, creates or edits a GitHub label.
- The existing `epicRollup` tests in `test/server/eng-privacy.test.js` still pass.

---

## Ground truth vs self-report

This is our structural advantage and the reason ccpm's worst bug cannot happen to us — provided we
keep it deliberately.

### Their failure

ccpm issue **`#955`, "Constantly having to restart agents"** (`ccpm.md:838`): the system reports
agents as running when they are not, and the user has to repeatedly tell it *"there are no running
agents"* to unstick it. The mechanism is stated plainly in the research note:

> Because "which agents are running" is tracked in a **markdown file the agent itself writes**,
> there is no ground truth — `execution-status.md` is a claim, not an observation.

`ccpm.md:853` generalises it: *"Progress percentages, `status:` fields, and 'active agents' are all
written by the agent about itself. Nothing derives state from observable reality (processes, git log,
CI)."* `_SYNTHESIS.md:273-275` rules on it: **"Do not adopt self-reported state under any
circumstance."**

This is not a bug they can patch. It is what happens when the only writer of the state is the thing
the state describes.

### Why we are immune, concretely

We have four independent observers, none of which is the agent's own opinion of itself:

| Observer | Where | What it proves |
|---|---|---|
| The child process handle | `server/ticket.mjs:341-354` `inFlight()` | `run.child.alive === false` ⇒ the run is over, whatever it last claimed. A run past `expiresAt` is force-marked done with the message *"the agent exited without reporting a result"*. |
| Transcript mtime | `server/index.mjs:798` `ACTIVE_MS`, walked at `:836` | A `.jsonl` under `~/.claude/projects/**` touched in the last 5 minutes is a session that actually emitted something. Nobody has to say so. |
| Transcript content | `server/index.mjs:891` `historyEvents()` | The real tool calls, in order, from the harness's own log. `server/ticket.mjs:375-384` rolls the same stream into tool count and files-read — *"Read 23 files in server/"* is evidence, not a claim. |
| Git | `server/index.mjs:4129` `changedFiles()`, `:4131` `conflictScan()` | What was actually written to which files on which branch. |

The strongest of these is the first, and it is worth naming why. `inFlight()`'s doc comment
(`server/ticket.mjs:329-340`) makes the design explicit: *"A lock needs a way to be wrong."* Liveness
is checked against the child process where there is one, and against a wall-clock expiry otherwise —
because *"a spawn that errors without an exit event, a child killed out from under the server, a
handler that throws before its `finally` — any of those leaves an entry that is forever 'in
flight'."* That paragraph is the precise fix for ccpm `#955`, written before we knew ccpm `#955`
existed.

### Where we are exposed, and the rule that closes it

**We are not fully clean.** `scanRuns()` (`server/index.mjs:4639-4671`) reads `.loush/<ticket>/state.json`
— `phase`, `phase_status`, `retries` — and that file is **written by the flow about itself**. Line
4654-4656 derives `status` from `state.phase_status` with no liveness cross-check. A `loush` flow
killed mid-run leaves `phase_status: "running"` on disk forever, and `/api/runs` will report it as
running, and `/api/inbox` will raise it (`server/index.mjs:2744-2750`). **That is ccpm `#955` in our
codebase.** The `events.jsonl` terminal-event check at line 4652 catches clean exits; it cannot catch
a kill.

The rule, stated so it can be enforced in review:

> **A field describing whether work is happening must never come from a file written by the worker,
> unless it is reconciled against an independent observation before it is displayed.**

Applied:
1. **Reconcile `scanRuns()`.** Cross-check `status: 'running'` against the mtime of `events.jsonl`
   (already stat'd at `server/index.mjs:4660`) using the same `ACTIVE_MS` threshold as
   `server/index.mjs:798`. A run claiming `running` whose events file has not been touched in five
   minutes is reported as `stale-claim`, not `running`. The self-report is *kept and shown* — it is
   evidence of intent — but it does not get to be the answer.
2. **Feature 4 inherits the rule.** A decomposition artifact records *plan*, never *progress*. The
   task set may carry `status` only where that status is derived: from the linked board ticket's
   stage (`server/index.mjs:4198-4201`, itself stamped by the server on real transitions), from the
   JIRA status in the snapshot, or from a merged PR. **No `progress: 45%` field may ever be written
   by a model into a task file.** ccpm computes epic progress as
   `closed_task_files / total_task_files` (`ccpm.md:539`) over files a model wrote; ours comes from
   `epicRollup()` (`server/eng.mjs:946`) over real tracker state.
3. **Feature 3 inherits it too.** `localIndex()`'s `inProgress` section reads board stages, which the
   server stamps — not any agent's description of itself.

### What it buys us

Three things ccpm structurally cannot have:

- **A run list that is right after a crash.** Kill the server mid-run, restart, and `inFlight()`
  reaps the corpse on the next call. `warmBoot()` (`server/eng.mjs:1357-1369`) rebuilds cache state
  from disk without ever trusting a status claim.
- **Evidence the plan was grounded.** `groundedIn` (`server/ticket.mjs:681`) and the
  `prContextLoaded` flag (`server/eng.mjs:1550`) record what the generator could actually see. The UI
  renders the difference (`src/sections/TicketSection.jsx:498-500`): *"read `owner/repo`"* versus
  *"from the ticket text only — not checked against any code"*. ccpm has no equivalent because every
  ccpm artifact is ungrounded.
- **The fix for their bug, as a product.** `ccpm.md:880` puts it precisely: *"They spawn agents and
  have no way to see them (hence `#955`). We read `~/.claude/projects/**/*.jsonl` and can see agent
  activity for real. Our observation layer is the exact fix for their worst bug."* Anyone running
  ccpm — 8,296 stars' worth — is a user for whom our Runs and Working Set sections answer a question
  their own tool cannot.

Keeping it is a review discipline, not a feature: **when adding any field that says work is
happening, name the observation it derives from, in a comment, at the site.**

---

## The decomposition artifact format

The schema for feature 4. Designed so it round-trips with what `server/eng.mjs` and the Task Board
already do, and so no field is a model's self-assessment of progress.

### Where it lives

**Primary store:** the per-ticket state file, `ticketStateFile(workspaceId, key)`, written by
`writeState()` (`server/ticket.mjs:83-91`) — atomic tmp+rename, one file per key per workspace. Add
one key to the `EMPTY` shape at `server/ticket.mjs:73`:

```js
const EMPTY = key => ({ v: 1, key, rev: 0, cwd: null, doc: null, graph: null, chat: null,
                        warnings: [], run: null, ticket: null, fetchedAt: null,
                        files: null, filesAt: null,
                        tasks: null })          // ← new
```

Rationale: the task set is a graph with an edit history and a rev counter, exactly like `graph`. It
is not prose. `eng-artifacts.json` stores markdown blobs keyed by JIRA key
(`server/eng.mjs:1195-1197`) and is the wrong shape — but a **rendered markdown view** is also
written there under `kind: 'decompose'`, so the existing copy / download / post-to-JIRA controls in
`src/sections/TicketSection.jsx:456-464` work with no changes.

**Deliberately not stored in the user's repo.** The design *document* is written into the repo by the
agent so it outlives this app (`server/ticket.mjs:16-17`); a task set is scheduling state, belongs to
the tracker, and would be a merge-conflict generator in a shared checkout. ccpm puts everything in
`.claude/epics/` in the consuming project (`ccpm.md:98-119`); that is a consequence of having no
application, not a design we should copy.

### Schema

```jsonc
{
  "v": 1,
  "rev": 3,                          // bumped by every write; If-Match guarded like the design graph
  "genAt": "2026-07-29T10:14:22Z",
  "model": "claude-opus-5",
  "groundedIn": "LinuxDevil/AI-Dashboard",   // null if no checkout was resolved
  "basis": {                          // what the generator could actually see — never inferred later
    "designDoc": "docs/superpowers/specs/2026-07-29-trn-1234-design.md",  // or null
    "graphNodes": 7,                  // 0 if no component graph existed
    "acPresent": true,
    "reqHash": "sha256:…"             // eng.mjs reqHash(d) — staleness, same as ac/tests
  },
  "cap": 8,                           // the prompt's task cap, recorded so the number is auditable
  "tasks": [
    {
      "id": "stripe-client",          // semantic slug, stable across regeneration. NEVER a number.
      "title": "Stripe client setup",
      "intent": "one or two sentences of scope",
      "size": "S",                    // XS|S|M|L|XL — model's estimate, labelled as such. No hours.
      "dependsOn": ["config-schema"], // slugs of tasks that must finish first
      "parallel": true,               // MODEL'S CLAIM. Checked against derivedConflicts below.
      "files": [
        { "rel": "server/stripe.mjs",  "change": "create", "state": "planned-new" },
        { "rel": "server/index.mjs",   "change": "modify", "state": "verified" },
        { "rel": "server/billing.mjs", "change": "modify", "state": "absent" }   // ← warning
      ],
      "covers": ["AC-1", "AC-3"],     // acceptance-criterion ids, when AC exist
      "graphNodes": ["stripe-client"],// design-graph node slugs this task implements
      "boardTicketId": "tk1a2b3c",    // set on handoff; null before
      "jiraKey": null,                // set if this task ever becomes its own JIRA issue
      "githubIssue": null             // reserved; nothing writes it today
    }
  ],
  "derivedConflicts": [               // COMPUTED, not model-supplied
    { "a": "stripe-client", "b": "webhook-handler", "files": ["server/index.mjs"] }
  ],
  "warnings": [
    { "code": "missing-file",   "task": "stripe-client", "detail": "claims to modify server/billing.mjs, which does not exist" },
    { "code": "exists-already", "task": "stripe-client", "detail": "claims to create server/stripe.mjs, which already exists — treated as modify" },
    { "code": "parallel-disputed", "task": "stripe-client", "detail": "marked parallel, but shares server/index.mjs with webhook-handler" },
    { "code": "cycle", "detail": "stripe-client → webhook-handler → stripe-client" }
  ],
  "edited": false                     // presentation only — NEVER a staleness suppressor
}
```

### Field notes, each with its reason

- **`id` is a semantic slug, never a number.** Identical to the design-graph rule at
  `server/ticket.mjs:441` (*"semantic, stable across regenerations. NEVER a number"*), and it is what
  lets `mergeGraph`-style reconciliation work across regenerations. It also sidesteps ccpm's most
  dangerous mechanic entirely: they rename `001.md` → `1235.md` and rewrite every `depends_on` array
  from sequential to real issue numbers (`ccpm.md:251`, `ccpm.md:763-765`), a two-phase rewrite whose
  own documentation warns that getting the order wrong corrupts dependency arrays. Slugs never
  renumber, so that failure mode does not exist here.
- **`size` is XS–XL and there are no hours.** ccpm's task template carries `Hours: N`
  (`ccpm.md:217`) and their analysis artifact carries `estimated_hours` and a
  `parallelization_factor` (`ccpm.md:268-269`). A model-guessed hour count that then feeds a
  computed "58% efficiency gain" (`ccpm.md:299`) is precisely the fabricated derived statistic
  `_SYNTHESIS.md:174-180` warns about, using context-mode's ADR-0004 as the cautionary case.
  Story-point → days conversion already exists here and is **org config**, not a model output
  (`estDaysFromPts`, `server/eng.mjs:142-152`).
- **`parallel` is the model's claim; `derivedConflicts` is the truth.** They are separate fields on
  purpose. When they disagree, `parallel-disputed` fires and the UI shows both. This is the inversion
  of ccpm's design and the whole "strictly better" argument from feature 4.
- **`files[].state`** is exactly the three-way classification `GET /api/ticket/:key/files` already
  produces (`server/ticket.mjs:1099-1118`): `verified`, `planned-new`, `absent`. Reuse the vocabulary
  and the code; do not invent a fourth term.
- **`covers`** mirrors the `Covers` column already required of the test-plan generator
  (`server/prompts/tests.md:23`), so AC → tasks → tests is one traceable chain.
- **No `status` and no `progress`.** By the rule in the previous section. Live status is joined at
  render time from `boardTicketId` → board stage, or `jiraKey` → snapshot issue.

### Round-tripping with JIRA

`server/eng.mjs` is a **reader** of JIRA structure and a *very* narrow writer: exactly two write
paths exist, a transition (`server/eng.mjs:1498`) and a comment (`server/eng.mjs:1580`), both gated
on `cfg.writes` (`server/eng.mjs:74`). There is no issue-creation path and this spec does not add
one.

So the round trip is:

- **Out (today, no new code):** render the task set to markdown and post it as a single comment via
  the existing comment route. `markdownToAdf` (`server/eng.mjs:1591`) handles the conversion; feature
  6 makes it idempotent. The comment is one artifact, one place, easy for a human to supersede.
- **Out (optional, later):** if a user creates sub-tasks in JIRA by hand, they paste each key into
  the corresponding task's `jiraKey`. From that moment the task inherits real status through the
  snapshot — `computeIssue` (`server/eng.mjs:349-413`) already gives us `status`, `statusKind`,
  `live`, `prNums`, `rec`. Nothing new is fetched.
- **In:** if the tasks become real JIRA issues with `is blocked by` links, feature 1's `readyQueue()`
  picks up the dependency graph **from JIRA**, and the local `dependsOn` becomes a cross-check rather
  than the source of truth. Divergence between the two is a `warnings` entry, not a silent overwrite.
- **Never:** we do not create JIRA issues, do not rename anything, do not rewrite dependency arrays.
  ccpm's filename-is-the-primary-key trick (`ccpm.md:256`) is elegant for a system with no database
  and no identifiers of its own. We have both.

### Round-tripping with GitHub

`server/eng.mjs` shells to `gh` at exactly one place — `gh()` at `server/eng.mjs:454`,
`spawnSync('gh', args)` with a 60s timeout and a 64MB buffer — used by `fetchPRs()`
(`server/eng.mjs:496`), `ciFor()`, `prCommits()` (`server/eng.mjs:1231`), `ghLogin()`
(`server/eng.mjs:463`) and the two PR write routes. All reads are GraphQL against
`prQuery` (`server/eng.mjs:491`); the query text itself is shipped in `provenance`
(`server/eng.mjs:1111`) and offered to the user as a copyable `gh` command
(`ghCommandFor`, `server/eng.mjs:493`) — a good habit this spec preserves.

- **Out:** nothing. **We do not create GitHub issues.** `_SYNTHESIS.md:344` and `ccpm.md:848` both
  rule against porting their creation path: `#1022` (wrong `gh-sub-issue` syntax) and `#1024`
  (`gh issue create --json` is not a real flag) have left the v2 sync path broken for four months, in
  the critical path of their headline feature.
- **In:** the link a task acquires to GitHub is the one we already derive — a PR whose head branch or
  title contains the JIRA key, matched by `cfg.ticketRegex` at `server/eng.mjs:508`. Once a task has
  a `jiraKey` and someone opens a branch named for it, `prNums` (`server/eng.mjs:411`) attaches the
  PR with no new code at all.
- **Board bridge:** `boardTicketId` links a task to a board ticket, which owns the real branch and
  worktree (`server/index.mjs:4144-4145`). That is where a task becomes code, and it is enforced by
  git rather than declared in a file.

---

## Not worth taking

Each entry names the source and the specific reason.

1. **Self-reported agent run state** (`execution-status.md`, `updates/<N>/execution.md`;
   `ccpm.md:304`, `ccpm.md:632-633`). Cause of their issue `#955`. `_SYNTHESIS.md:344` rules it out
   explicitly. We have four independent observers; see the section above. We must also *stop* doing
   the one instance of it we already do, in `scanRuns()`.
2. **The mandatory PRD → epic → task waterfall as a gate** (`ccpm.md:84`, `ccpm.md:123-240`). Their
   own issue `#975` reports it as too rigid and slow for small fixes (`ccpm.md:837`); HN's tmvphil
   identifies the deeper failure — the plan does not survive implementation (`ccpm.md:831`). Take the
   artifacts, refuse the mandate. Feature 4 is a button, not a stage.
3. **Their GitHub issue-creation shell** (`references/sync.md` steps 1–2). Broken on `main` for four
   months: `#1022`, `#1024`, `gh issue create --json` is not a supported flag (`ccpm.md:848`).
4. **Anything from a hosted installer** (`ccpm.md:815-822`, `_SYNTHESIS.md:156-158`). The v1
   `curl | bash` was in their own docs and deployed a miner and an SSH backdoor.
5. **Every headline performance number** — "89% less context switching", "75% fewer bugs", "3×
   faster", "100% eval vs 27.7% baseline" (`ccpm.md:826`). No harness, no dataset, no methodology
   anywhere in the repo. HN's moconnor: *"These numbers are hallucinated, aka lies."*
   `_SYNTHESIS.md:180` forbids repeating any of them in our UI or docs. This spec quotes none.
6. **`parallelization_factor` and the with/without wall-time comparison** (`ccpm.md:268`,
   `ccpm.md:296-299`). A percentage computed from a model's guess at stream hours. Same failure mode
   as `_SYNTHESIS.md:169-176`.
7. **Model-supplied `Hours: N` on tasks** (`ccpm.md:217`). We have an org-configured story-point
   table (`server/eng.mjs:142-152`) and measured working-time durations
   (`lib/eng-config.mjs` via `workDays`, `server/eng.mjs:117`). A guessed hour count next to a
   measured one devalues both.
8. **Per-epic shared-branch worktrees** (`ccpm.md:569-587`). Their model is one worktree and one
   branch per epic, with N agents committing concurrently and isolation enforced only by a prompt
   instruction. Ours is one worktree and one branch per board ticket
   (`server/index.mjs:4142-4158`), enforced by git. Adopting theirs is a downgrade.
9. **The pre-modify `git status --porcelain` poll with sleep-and-retry** (`ccpm.md:600`). A runtime
   coordination hack for agents sharing a working copy. Our per-ticket worktrees make it moot.
10. **The `bash-worktree-fix.sh` hook** (`ccpm.md:609`, v1 only). Genuinely the best-engineered file
    in their repo, and `ccpm.md:795` is right that the detection primitive is ~20 lines of Node. But
    the *hook* reimplements a Claude Code feature and we have no equivalent interception point. If we
    ever need worktree detection, write the 20 lines; do not port the 200.
11. **Their frontmatter parsing** (`grep | sed`, no YAML parser — `ccpm.md:857`). Silently corrupts on
    quoted colons and multi-line values.
12. **Task-file renaming to issue numbers** (`ccpm.md:256`, `ccpm.md:763`). Elegant for a system with
    no identifiers; we have JIRA keys, board ids and semantic slugs, and their own docs warn the
    two-phase rewrite corrupts dependency arrays if mis-ordered.
13. **GitLab support as a blocker.** Their `#588` has been open since 2025-09 with a community fork
    never merged (`ccpm.md:844`). Noted only so nobody proposes matching their scope here.
14. **The five-minute `last_sync` confirm heuristic** (`ccpm.md:529`). Feature 6 takes the marker and
    the idea; a hash comparison is exact where a timer is a guess.

---

## Open questions for the maintainer

1. **Feature 7 — is there a user?** The GitHub epic/task label ingestion is speculative. Do any
   Loush users run a labelled epic workflow on GitHub, or is JIRA `parent` the only grouping that
   matters? If the latter, cut feature 7 and stop at six.
2. **Does `markdownToAdf` preserve HTML comments?** Feature 6's dedup marker depends on it, and
   `server/eng.mjs:1578-1579` says v3 comment bodies must be ADF documents. If comments are stripped,
   do you prefer a visible provenance line on every posted artifact, or dedup state kept only
   locally in `eng-artifacts.json`?
3. **What JIRA link-type names does your instance actually use?** Feature 1 matches on
   `/block/i` against `l.rel` (`server/eng.mjs:381`). If your board uses a custom link type for
   dependencies, name it and it becomes config rather than a regex.
4. **Should `/analyze` survive?** Feature 4 supersedes `POST /api/board/tickets/:id/analyze`
   (`server/index.mjs:4213-4230`) with a strictly better-grounded generator. Run both for a while, or
   replace immediately? The Board's inline proposal editor
   (`src/sections/BoardSection.jsx:114-130`) would need to point at the new artifact either way.
5. **Is `scanRuns()`'s self-report a bug to fix now, or a known limitation?** The reconciliation in
   the Ground-truth section is ~15 lines and closes our one instance of ccpm `#955`. It also changes
   what `/api/runs` and `/api/inbox` report for stuck flows, which is a visible behaviour change. Fix
   it as part of this work, or file it separately?
6. **How hard is the write-target guard allowed to be?** Feature 2 treats a network failure during
   verification as *refuse*. That means an offline user with `writes: true` cannot post. Is
   fail-closed correct here, or should an offline verification fall back to a
   name-comparison-only check against `git remote get-url origin`?
7. **Task cap.** ccpm says ≤10 (`ccpm.md:186`); this spec proposes 8 on the review-bottleneck
   argument (`ccpm.md:830`). Is 8 right for your team, and should it be configurable per project in
   `projects.json` alongside `storyPointDays`?
8. **Attribution.** `_SYNTHESIS.md:150` confirms ccpm's MIT LICENSE is genuinely present and
   `_SYNTHESIS.md:373` asks that every ported file carry the author's permission and licence state in
   its header. Nothing in this spec is a code paste — every feature is a re-derivation against our
   own modules — but `server/prompts/decompose.md` will be *conceptually* derived from
   `references/structure.md`. Carry an attribution line in it?

---

## Suggested sequencing

Not a mandate — features are independently shippable — but the dependency-aware order is:

1. **Feature 2** (write guard) — safety first, and it is a day.
2. **Feature 1** (ready/blocked queue) — highest value per line in the corpus, no dependencies.
3. **Feature 3** (local index) — reuses feature 1's `readyQueue()`.
4. **Feature 4** (decomposition) — the substantial one.
5. **Feature 5** (planned overlap) — needs feature 4's scopes.
6. **Feature 6** (idempotent write-back) — independent; slot in anywhere.
7. **Feature 7** (label ingestion) — only on a real request.

The `scanRuns()` reconciliation from the Ground-truth section should ride along with whichever
feature ships first. It is the one place where our own code does the thing we are refusing to adopt.
