# Handoff — `claude/merge-md-output-files-wwp0k3`

State at the last commit on this branch. Written to be picked up cold in a new session.

## Where things stand

- **1904 tests, 0 failures.** 2 skip locally (running as root bypasses the mode bits the test
  needs); 7 skip with an empty `HOME`, which is what CI looks like. Every skip states its reason
  and asserts nothing — none of them is a vacuous pass.
- `npm test` → `node --test`. `npx vite build` is clean. CI is `npm ci && npm test` on Node 20;
  the lockfile is in sync and nothing server-side uses a post-Node-20 API.
- The dashboard boots and serves. Local run: `npm run dev`, or `DASH_PORT=xxxx node server/index.mjs`.

## What was done

A 124-item backlog (`features/0xx`–`1xx`, deleted from the tree; recoverable via
`git show c545263~1:features/…`). Every item is resolved — built, folded into another item, or
rejected with a recorded reason. The rejections are deliberate and documented in code:

| Item | Why not built |
|---|---|
| `012` per-session Docker isolation | explicitly not recommended by its own spec |
| `080` browser permission prompts | you chose to keep `--dangerously-skip-permissions` |
| `083` app-id ↔ provider-id indirection | the provider session id is the *durable* key here — it is the transcript filename on disk, and pins/forensics/cost all key on it across restarts. Hiding it behind an in-memory id would break pinned sessions. Rationale is in `lib/chat-protocol.mjs`. |
| `120` shelling out to the `agnix` binary | not installed; our own rule catalogue in `lib/config-lint.mjs` instead |

**Not addressed at all: `014`** (immutable audit-event schema + resource lineage graph). It was in
my gap audit but not in the batch you scoped, so it was never picked up.

## The recurring bug class, if you continue this work

Four separate rounds of bugs all had the same shape: **the library was right and the wiring was
wrong**, in a way the library's own tests could not catch.

- `openFolder` is async and wasn't awaited → every call answered 403 with `{}`. *A security control
  that refuses everything looks like it is working.*
- `lintAll()` called with no targets → examined zero files, reported `ok: true`.
- `auditOverEngineering` handed a path string instead of `{installed, invocations, window}` → it
  correctly refused to produce a headline. *A correct refusal on wrong input is the hardest failure
  to spot, because everything looks principled.*
- `planInstall(settings, id)` called as `(id, settings)`; `crossCheckWorkLog` handed a parsed object
  where it wanted raw markdown; UI reading `id`/`name` where the payload has `key`/`label`.

**Read the callee's signature before writing the caller, and exercise the route against a running
server.** Static checks and unit tests passed for every one of these.

## What is verified, and what is not

Verified against real data on this machine: transcript scanning (32 files), usage/pricing
($311.74 at full coverage), tool efficiency (Bash 1416 calls / 95.5%), git status/diff/watch,
config lint (found a real `skill/name-mismatch`), contract check (5905 samples), complexity (320
source files, matching `git ls-files`), tracker CRUD, diff-review coalescing and its refuse-on-
change path, `open-folder` containment.

**Not verified — the honest list:**

1. **The UI is verified by payload-shape comparison, not by rendering.** There is no browser or
   component-test harness in this repo. I can confirm the fields exist and carry real values; I
   cannot confirm the layout is right. The two new screens (Harness → **Health**, Harness →
   **Usage detail**) deserve a five-minute look.
2. **No JIRA or GitHub credentials here**, so every `server/eng.mjs` and `server/ticket.mjs` path
   is verified only to its guard clauses — never against a real backend. The ready/blocked queue,
   the progress-comment sync, and the ticket generators have never run on a real board.
3. **`024` CI-cost ingestion is tested against synthetic fixtures only.** No real `execution_file`
   exists on this machine, so which envelope the action actually emits is unconfirmed.
4. **The price table has never been checked against an invoice.** Rates were reasoned from
   Anthropic's published structure. `lib/pricing.mjs` is the single place to correct them.
5. **DOMPurify is compile-verified, not run.** No jsdom. The XSS tests exercise the sanitiser's
   logic; the browser behaviour of the `rel=noopener` hook is unproven.
6. **Chat cannot start in this container** — `--dangerously-skip-permissions` refuses to run as
   root. Unrelated to this work, but it means the live chat surfaces were never exercised end to end.

## Known-degraded by design (not bugs)

- **Insight rules all abstain.** `/api/sessions` filters out agent transcripts, leaving exactly one
  session here, and three of four rules need a peer baseline (floor of 5–8). The endpoint reports
  *why* each abstained rather than showing a clean "0 insights". With more non-agent sessions they
  will start firing.
- **Diff review runs in `degraded` mode.** Without a `PreToolUse` hook the "original" is inferred
  from the last content seen, not observed before the edit. Every review says so. Wiring the hook
  is what upgrades `originalConfidence` from `inferred` to `observed`.
- **The over-engineering audit reports `provenUnused: 0`** despite 12 capabilities with no recorded
  invocation, because the observation window is 1.93 days. That is deliberate — the count is a
  statement about the record, not about the capabilities.

## Things I would look at next

1. **`PUT /api/artifacts/content` is new and is the only write path I added** (needed to finish the
   `076` editor contract). It reuses the same `safe()` containment as every other artifact route,
   takes a backup, and requires an `expectedMtimeMs` precondition. If you would rather the viewer
   stay read-only, deleting that route and `src/ui/EditableView.jsx` is the whole rollback.
2. **`tokensPerSuccessfulCall` attribution.** The metric ships with its basis and denominator on
   hover, but the attribution choice itself is worth a second opinion.
3. **`014`**, if you want the backlog genuinely empty.
4. **The `~20 bugs` fixed in existing code** (commit `062f34b`) touched board writes, hook
   handling, session reporting and the compaction counter. Worth a skim if any of those surfaces
   behave unexpectedly — particularly the board `PATCH`, which now validates field types and
   accepts an optional `expectedVersion` for compare-and-set.

## Layout

```
lib/            pure logic, all unit-tested        server/wave3.mjs  22 routes (waves 1-3 features)
server/         express routes                      server/wave4.mjs  tracker / insights / reviews / git-watch
src/sections/   screens                             docs/integration/ per-batch wiring notes from the agents
src/ui/         shared components                   test/lib/         node --test, mirrors lib/
```
