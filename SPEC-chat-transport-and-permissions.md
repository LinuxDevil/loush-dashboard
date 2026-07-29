# Implementation spec — chat transport and permission prompts

> Turns `siteboon-claude-code-ui.md` + `_SYNTHESIS.md` §2/§5/§7-A/§8 into shippable work.
> Every implementation step below is grounded in our code, cited `path:line`.
> Research date of the upstream material: 2026-07-29. Spec written against our tree at
> `de03dd5` on `research/upstream-ecosystem-analysis`.

---

## Licensing constraint

**Read this before writing a line of code.**

`siteboon/claudecodeui` is **AGPL-3.0-or-later with AGPL §7 additional terms**, and its `NOTICE`
states that contributions by authors other than Siteboon made before commit `004135ef` (2026-03-27)
**remain GPL-3.0** — Siteboon relicensed only its own copyright and **cannot** relicense the rest.
`_SYNTHESIS.md:145` ranks it **the highest licensing risk in the batch**.

Loush Dashboard is **MIT** (`package.json:9`). AGPL copyleft triggers on *network use*, which is
precisely what a self-hosted web dashboard is. A maintainer's emailed permission covers Siteboon's
copyright only; it demonstrably does not cover the pre-`004135ef` third-party GPL-3.0 code that
`NOTICE` explicitly carves out.

**What this means for every feature below, without exception:**

1. **No code is copied.** Not a function, not a file, not "the same 20 lines with the types
   stripped". Everything specced here is described as *behaviour and protocol shape*, and we write
   the implementation ourselves against that description.
2. **Ideas, protocol shapes, field names and architectural patterns are not restricted** by
   copyright. "Four inbound verbs named `chat.send`/`chat.abort`/`chat.subscribe`/
   `chat.permission-response`" is a design; adopting it is fine.
3. **Specifically excluded from adoption**, because the temptation to paste is highest and the value
   of pasting is lowest: `extractTokenBudget()`, `filterImagesToUploadStore()`, and the
   `chat-run-registry.service.ts` ring buffer. All three are small enough to write from the
   behavioural description in one sitting. Features 2, 4 and 5 below describe the behaviour and
   deliberately do **not** reproduce their code.
4. **Their pre-TypeScript tags (`v1.12.0` and earlier) are worse, not better.** Those tags carry a
   GPL-3.0 `LICENSE` alongside a `package.json` that says `"MIT"` — the ambiguity is greater, not
   less. Do not use them as a shortcut.
5. **No attribution obligation is incurred** by taking designs, and we should not imply one. If we
   ever *do* paste (we should not), AGPL §7b requires a prominent
   `CloudCLI UI (https://github.com/siteboon/claudecodeui)` notice in every copy and derivative, and
   §7c forbids presenting a modified version as the original. That obligation would propagate to
   the whole of Loush. **That is the reason the answer is "write our own".**

There is one further reason this is easy to honour: **the central mechanism in this spec is not
theirs.** Their permission triad is built on the Agent SDK's `canUseTool`. Section
"The permission model, in detail" establishes, by direct experiment against our installed CLI, that
we should implement it a different way entirely — one they wrote down as a TODO and never shipped.
We are not porting their code; we are solving our problem with a mechanism they identified.

---

## The central finding

**Our security posture is worse than the project we reviewed.**

`server/index.mjs:916` spawns the chat driver with `--dangerously-skip-permissions`. Every message
a user sends from the Chat section runs a fully unsandboxed agent with the operator's own
privileges, in a project directory of the user's choosing, with no prompt, no allow-list and no
record of what it was permitted to do. The same flag appears at `server/index.mjs:1056` (Quick
Actions), `server/index.mjs:1964`, `server/index.mjs:3488`, and in both agent shapes in
`lib/agent.mjs:27` and `lib/agent.mjs:55`.

siteboon's `canUseTool` + `waitForToolApproval` + remember-this-rule triad is the fix.
**Porting it closes OUR gap. It is not adding their feature.** `_SYNTHESIS.md:73-75` states this
plainly, and it is the reason the permission work is Feature 1 rather than ranked by effort.

The aggravating context, from `server/index.mjs:4771`: we call `app.listen(PORT)` with **no host
argument**, so the dashboard binds every interface, not loopback — and it has **no authentication of
any kind**. `server/index.mjs:3640-3651` (`POST /api/hooks/dryrun`) hands a client-supplied string
to `spawn('sh', ['-c', command])` by design, as a hook-testing convenience. Unauthenticated,
LAN-reachable, arbitrary command execution is structurally the same defect as CVE-2026-31975. That
is out of scope for this spec, but it is not out of scope for the release that ships it — see
"Open questions".

---

# Features

Ordered by value ÷ effort, with the permission triad first because it is a security fix and
ranking a security fix by convenience is how you get a CVE.

---

### 1. Browser-rendered tool permission prompts

**Customer need.** A developer opens Chat, points it at a real client repository, and asks for a
refactor. Today the agent can `rm -rf`, `git push --force`, `curl | sh`, or read `~/.ssh` and put
it in a file, and the first the user knows is when they read the transcript afterwards. What they
do today is one of two things: they don't use the Chat section for anything that matters and go
back to the terminal — where Claude Code *does* prompt them — or they use it and quietly accept a
risk they haven't been shown. Both are bad, and the second is worse because our UI never told them
the guard rails were off.

**Value to Loush.** It is the difference between a dashboard we can honestly recommend pointing at
a work repository and one we cannot. It also produces the first real input to **Governance** and
**CapabilityLedger**: an actual stream of allow/deny decisions with tool names, arguments and
timestamps, instead of inference from transcripts. Today those sections have no permission data at
all because no permission events exist.

**How the upstream repo does it today.** `server/claude-sdk.js` passes a `canUseTool` callback into
the Agent SDK's `query()`. When the model wants a tool, the SDK invokes the callback, which returns
a promise; the gateway emits a `permission_request` frame to the browser and parks the promise in a
pending map keyed by `requestId`. A `chat.permission-response` frame (`{requestId, allow,
updatedInput, message, rememberEntry}`) resolves it. Normal tools auto-deny after 55 s; the
interactive tools `AskUserQuestion` and `ExitPlanMode` wait forever. "Allow + remember" appends a
rule such as `Bash(npm test:*)` to the **in-memory, run-scoped** allow-list, matched by
`matchesToolPermission()`. Pending requests survive a refresh because the `chat_subscribed` frame
carries `pendingPermissions`. Their own code comment at `claude-sdk.js:522` concedes the design's
hole: in `auto` and `bypassPermissions` modes the SDK resolves approval *before* `canUseTool` runs,
so interactive prompts never reach the UI — and records the fix as *"move to a `PreToolUse` hook"*.
They never did.

**How we implement it here.** We take their fix, not their code. Full design in
"The permission model, in detail" below; the shape:

- Delete `--dangerously-skip-permissions` from `server/index.mjs:916`. **Verified by experiment**
  (CLI 2.1.220): this alone does not produce prompts — the CLI silently denies the tool with a
  synthetic `tool_result` error and the model gives up. Removing the flag is necessary and
  insufficient. It is also, usefully, **fail-closed by default**.
- New `server/permissions.mjs` owning: the pending-request map, the rule store, and two routes
  (`POST /api/permission/ask`, called by the hook; `POST /api/chat/:id/permission/:requestId`,
  called by the browser).
- New `lib/permission-hook.mjs`, a tiny standalone script Claude Code executes as a `PreToolUse`
  hook. It reads the hook payload on stdin, POSTs it to `http://127.0.0.1:${DASH_PORT}/api/
  permission/ask`, blocks on the response, and writes a `permissionDecision` to stdout.
- The hook is registered per-run via a dashboard-managed settings file, not by editing the user's
  `~/.claude/settings.json`. We already have the safe-write machinery (`backup()` at
  `server/index.mjs:131`, `SETTINGS_FILES` at `server/index.mjs:329-331`, `PUT /api/hooks` at
  `server/index.mjs:339`) and we deliberately do **not** use it here — see the "settings scope"
  decision in the detailed section.
- `chatBroadcast()` (`server/index.mjs:871`) gains a synthetic `{type:'permission_request', ...}`
  event, so the prompt rides the SSE stream we already have. No transport change is required for
  this feature — that is the point of recommending SSE in the transport section.
- `src/sections/ChatSection.jsx` renders the modal. `buildBlocks()` (`ChatSection.jsx:16`) gains
  `permission_request` / `permission_resolved` cases so the decision is part of the permanent
  transcript, not a transient overlay.

**Effort.** M. Roughly: 180 lines `server/permissions.mjs`, 60 lines `lib/permission-hook.mjs`,
140 lines of React. **Zero new npm dependencies** — this is the main reason to prefer the hook route
over adding `@anthropic-ai/claude-agent-sdk`.

**Risks and unknowns.**
- The hook mechanism is a Claude Code feature whose payload shape is documented but whose stability
  across CLI versions is not guaranteed. Mitigation: the failure mode of a schema change is a hook
  that can't parse its input — which must exit non-zero and therefore **deny**. Test against the
  installed CLI version at startup and surface a banner if the probe fails.
- A hook fires per *tool call*, not per *turn*. A 40-tool run means 40 prompts unless rules absorb
  them. The rule system is not a nicety; without it the feature is unusable. Ship them together.
- **Unverified:** whether `permissionDecision: "ask"` does anything useful in `-p` headless mode. We
  only need `allow` and `deny`, both verified. Do not build on `ask`.
- **Unverified:** whether subagent (`Task`) tool calls fire `PreToolUse` in the parent session's
  hook context. If they do not, subagent tool use is ungated — which would be a serious hole and
  must be checked before we claim the feature is complete.
- Users with their own `PreToolUse` hooks in `~/.claude/settings.json` will now have two hooks on
  the same event. Claude Code runs both; a `deny` from either wins. That is the correct precedence
  and should be documented rather than worked around.

**Definition of done.**
- `grep -rn "dangerously-skip-permissions" server/ lib/` returns **zero** hits in the interactive
  chat path. Remaining hits, if any, are in one-shot generators and each carries a comment naming
  why the interactive path does not apply.
- Asking the agent to write a file in a fresh project shows a modal naming the tool, the target
  path, and a diff-or-preview of the argument; the file on disk is **unchanged** until the operator
  clicks.
- Clicking Deny produces a visible `✗ denied — Write ~/x.txt` line in the transcript, and the
  transcript records the denial permanently (survives detach/reattach).
- Killing the dashboard server mid-prompt causes the tool to be **denied**, not allowed. Verified by
  test, not by inspection.
- **Null/empty state:** with no rules saved, the Rules panel reads *"No saved rules. Every tool call
  will ask."* — not an empty table and not a zero. If the hook could not be installed for the run,
  the composer shows a persistent *"Permission prompts unavailable — this session is running
  unguarded"* banner rather than silently reverting to skip-permissions.

---

### 2. Server-side containment for chat attachments

**Customer need.** Nobody asks for this. The person who hurts is the one who finds out later that a
web page open in the same browser could POST a 300 MB body to their dashboard, or that an `@path`
reference in a message handed the model a file outside the project. Today they have no defence and
no way to know.

**Value to Loush.** Closes a real hole for a day's work, and it is a precondition for ever telling
anyone the dashboard is safe to run on a work machine. `_SYNTHESIS.md:69` flags exactly this class:
*"We write real user config from unauthenticated localhost endpoints."*

**How the upstream repo does it today.** `filterImagesToUploadStore()` in
`chat-websocket.service.ts` re-validates, server-side, that every attachment path is a **direct
child** of `~/.cloudcli/assets` — no subdirectories, no traversal, no absolute paths elsewhere —
because the provider runtime base64-encodes whatever path it is handed. The research file calls it
the best-written trust boundary in that repo. Notably, they do **not** `realpath()` their project
file routes, and a symlink defeats their `startsWith` check there; we should not replicate that
half.

**How we implement it here.** Our upload route is `server/index.mjs:1011-1019`: it accepts
`express.raw({type:'*/*', limit:'300mb'})`, sanitises the *filename*
(`path.basename(...).replace(/[^\w.-]/g,'_')`) and writes into `~/.claude/chat-uploads`. The
filename is handled; the **read-back path is not checked at all**, because there is no read-back —
the returned absolute path is pasted into the message text as `@path` at
`src/sections/ChatSection.jsx:186`, and the CLI resolves it with the operator's privileges.

- Add `containedPath(candidate, root)` to a shared module: `path.resolve` both, then
  `fs.realpathSync.native` the root **and** the candidate's parent, then require
  `resolved.startsWith(realRoot + path.sep)`. Doing the `realpath` is the part siteboon skipped;
  doing it on the *parent* lets us validate a path before the file exists.
- Apply it in `POST /api/chat/upload` to the written path, and in
  `POST /api/chat/:id/message` (`server/index.mjs:953`) to every `@`-reference that resolves to an
  absolute path, rejecting with 400 and a named reason.
- Drop the raw body limit from 300 MB to 25 MB, configurable via env. 300 MB is not a considered
  number; it is the number that made the first test pass.
- `@`-references produced by the file autocomplete (`kind=files`, `server/index.mjs:978`) are
  already repo-relative and must stay relative — validate against the chat's `cwd`, which the server
  already holds (`chat.cwd`, `server/index.mjs:921`) and must never take from the client.

**Effort.** S. ~50 lines plus tests.

**Risks and unknowns.** `fs.realpathSync.native` on Windows resolves 8.3 short names and drive
substitutions, which is what we want, but it throws on a non-existent path — hence validating the
parent. Junctions and `\\?\` prefixed paths need a test case each. Low risk overall.

**Definition of done.** A test posts `../../.ssh/id_rsa` and `C:\Windows\System32\config\SAM` as
`@`-references and both are rejected with a 400 naming the reason. A legitimate in-project
reference still works. Upload of a 30 MB file is rejected with *"attachment too large (30 MB) —
limit is 25 MB"*, not a silent truncation or a 500.

---

### 3. Graceful interrupt — abort the turn, keep the session

**Customer need.** The agent starts doing the wrong thing — wrong file, runaway loop, obviously
misread instruction. The user wants to stop it and say "no, not that". Today the only control is the
**stop session** button (`ChatSection.jsx:316-319` → `DELETE /api/chat/:id` →
`server/index.mjs:1020-1024` → `child.kill()`). That kills the whole CLI process: the conversation
ends, the composer disables (`ended`, `ChatSection.jsx:324`), and continuing means starting a new
chat and resuming by session id. So the user watches the wrong thing finish, because interrupting
costs more than waiting.

**Value to Loush.** Turns a hammer into a control. It is also the cheapest visible improvement in
this document, and it is a prerequisite for the permission modal being pleasant — "deny" should be
able to be followed by "and here's what I actually meant" in the same session.

**How the upstream repo does it today.** `abortClaudeSDKSession()` in `server/claude-sdk.js` calls
`queryInstance.interrupt()` on the Agent SDK query object, then emits a synthetic terminal
`complete` frame so the UI can never be left "thinking" forever. Every run terminates with exactly
one `complete`, built by a single function, de-duplicated by the run registry.

**How we implement it here.** We have no `queryInstance` — we own a raw child process
(`server/index.mjs:919`). Two mechanisms, in preference order:

1. **The permission channel already is an interrupt.** Once Feature 1 ships, a pending permission
   prompt is a natural stop point: `Deny and redirect` resolves the hook with `deny` plus a
   `permissionDecisionReason` carrying the user's correction, which the model receives as tool
   feedback and acts on. This is strictly better than killing anything and costs almost nothing on
   top of Feature 1.
2. **`POST /api/chat/:id/abort`** for the no-pending-prompt case. **Unverified** whether the CLI
   honours an interrupt control message on stdin in `--input-format stream-json` mode; our probe did
   not test it. Verify first. If it does not, the honest fallback is to keep `child.kill()` but
   **relabel and re-scope the UI**: the existing button becomes *"End session"* and there is no
   mid-turn abort until we have the mechanism. Do not ship a button labelled "stop" that ends the
   session.

Either way, add the terminal-frame invariant now: `chatBroadcast` emits exactly one
`{type:'closed'}` per chat, guarded by a flag on the chat record, mirroring the one-shot `ended`
guard already written for the same reason in `lib/agent.mjs:75-76`. That comment
(*"Node emits BOTH 'error' and 'exit' for some failures"*) documents a bug we already hit once; the
chat path at `server/index.mjs:938-939` still has it unguarded and can emit `closed` twice.

**Effort.** S — but gated on a verification spike of maybe two hours.

**Risks and unknowns.** The whole of mechanism 2 is unverified. Ship mechanism 1 regardless; it is
independent.

**Definition of done.** Mid-turn, the user can stop the current action and send a new instruction
**in the same session** — session id unchanged, transcript continuous, composer never disabled.
The transcript shows `⊘ interrupted by you` at the stop point. If the verification spike fails,
DoD instead is: the button reads "End session", its tooltip says the session cannot be resumed
in-place, and no code claims otherwise.

---

### 4. Monotonic `seq` + bounded replay + `Last-Event-ID`

**Customer need.** A user starts a long run, switches Wi-Fi, closes the laptop, or just leaves the
tab for ten minutes. Today the browser's `EventSource` silently reconnects, our server replays
**every event from index 0** (`server/index.mjs:949`), and the client **appends** them to state it
already has (`src/sections/ChatSection.jsx:280`, `setEvents(prev => [...prev, ev])`). The transcript
duplicates. There is no de-dupe, no `id:` line, and `Last-Event-ID` is neither sent nor read.
`server/ticket.mjs:848-858` has the identical shape and the identical defect.

This is not a missing feature copied from upstream — **it is a live bug in our code, verified by
reading it**, and the research file's claim that "a refresh mid-run loses live frames" is not quite
right: we lose nothing, we duplicate everything. Trust the code.

Second problem: `chat.events` (`server/index.mjs:872`) grows without bound for the life of the
process, seeded with up to 200 history events (`server/index.mjs:893`) plus every live event
forever.

**Value to Loush.** Correctness of the thing users look at. Plus it makes two browser tabs on one
session work, and it is the precondition for stable session URLs (Feature 6) being useful.

**How the upstream repo does it today.** `chat-run-registry.service.ts` assigns a monotonic `seq`
per run, keeps a 5,000-event ring buffer with 5-minute post-completion retention, and exposes
`replayEvents(sessionId, lastSeq)`. The client sends `{sessionId, lastSeq}` in a `chat.subscribe`
frame and receives exactly what it missed. If the buffer no longer covers `lastSeq`, the client
falls back to a REST read of the transcript as the authority — no dedup heuristics, no guessing.

**How we implement it here.** The mechanism is theirs; the plumbing is ours and is *simpler*,
because SSE has a standard replay protocol built in and WebSocket does not (see the transport
section).

- `chatBroadcast` (`server/index.mjs:871`) assigns `ev._seq = ++chat.seq` before push.
- The SSE writer emits an `id:` line: `` res.write(`id: ${ev._seq}\ndata: ${JSON.stringify(ev)}\n\n`) ``.
  The browser then sends `Last-Event-ID` on every automatic reconnect **with no client code at
  all** — this is native `EventSource` behaviour, not something we build.
- `GET /api/chat/:id/events` (`server/index.mjs:944`) reads `req.headers['last-event-id']`, and
  replays only `events` with `_seq >` that value.
- `chat.events` becomes a bounded ring: keep the last 5,000, and track `firstSeq`. If
  `lastEventId < firstSeq` the buffer has rotated past the client; respond with a single
  `{type:'replay_gap', from, to}` event and let `ChatSection` re-fetch the session transcript from
  disk via the existing history path (`historyEvents`, `server/index.mjs:891`) as the authority.
  Falling back to the file is exactly right for us — unlike siteboon, **the transcript on disk is
  our home turf**.
- Client side, `attach()` (`ChatSection.jsx:273`) keeps `setEvents([])` for a fresh attach, and
  handles `replay_gap` by refetching rather than appending.
- Do the same in `server/ticket.mjs:387` and `:854`. Better: extract one `sseStream(res, store)`
  helper and use it in both, since they are the same nine lines twice.

**Effort.** M. Small diff, but it touches two streaming call sites and needs a reconnect test
harness (kill the socket, assert no duplicate blocks).

**Risks and unknowns.** `Last-Event-ID` is only sent by the browser on *its own* automatic
reconnect, not when JS constructs a new `EventSource`. Feature 6 (stable session URLs) will want
explicit resume-from-seq too, so also accept `?lastSeq=` as a query parameter and treat the header
as the default. Any proxy between browser and server that buffers SSE will break replay; we bind
localhost, so this is a non-issue today and a documented constraint tomorrow.

**Definition of done.** A test opens a chat, streams 50 events, forcibly drops the connection,
streams 50 more, and asserts the client ends with exactly 100 blocks — not 150. Killing and
restarting the dashboard server mid-run shows *"connection lost — reload to resume from the
transcript"*, not a silently truncated transcript that looks complete. **Null/empty state:** a chat
with zero events shows *"No messages yet"*, and the run registry reports `0 buffered` rather than
hiding the row.

---

### 5. Live context-budget pill

**Customer need.** The user is 90 minutes into a session and does not know whether the next message
triggers compaction. They find out when it happens, mid-thought. Today our **UsagePanel** answers
this historically and in aggregate; nothing answers it *now*, for *this* session.

**Value to Loush.** One number, continuously visible, that changes a decision the user is actually
making ("start fresh or keep going?"). It also lets live and historical accounting share one
formula instead of drifting apart.

**How the upstream repo does it today.** `extractTokenBudget()` reads `message.usage`, sums
`input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens`, falls back
to `modelUsage` when absent, and divides by a `CONTEXT_WINDOW` env value defaulting to 160,000.
The result rides a `status`/`token_budget` frame into a composer pill with a click-through
breakdown. The research file's point is that summing **cache tokens** is the part everyone gets
wrong.

**How we implement it here.** We already have the raw material and throw it away. Our probe output
confirms the shape on CLI 2.1.220: every `assistant` event carries
`message.usage.{input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens}`,
and the terminal `result` event carries a cumulative `usage` plus a `usage.iterations[]` array.
`buildBlocks` already grabs `ev.message.usage` and attaches it to the first tool block
(`ChatSection.jsx:33`, with a correct comment about avoiding double-count), then never uses it.

- Write `contextBudget(events)` in `lib/` as a pure function: last-assistant-message usage summed
  across all four fields, over a context window resolved from the model name.
- Render as a pill in the chat head next to the existing model chip (`ChatSection.jsx:399`).
- `_SYNTHESIS.md:178-180` is binding here: **never render a percentage without its denominator
  visible.** The pill reads `48k / 200k` with the percentage as secondary, never a bare `24%`.
- Wire the same function into **UsagePanel** so one formula serves both.
- Deduplicate by `message.id` when summing across events — `_SYNTHESIS.md:292` (Tier 0.1) already
  requires this fix elsewhere; do it once, here, in shared code.

**Effort.** S. ~60 lines and a wire-up.

**Risks and unknowns.** The context window per model is **not** in the stream — our probe's
`system/init` event lists tools and model but no window size. Hardcoding a table is a maintenance
liability and exactly the kind of invented number `_SYNTHESIS.md:166-176` warns about. **If we
cannot source the window honestly, render absolute tokens only and no percentage.** A correct
absolute number beats a confident fraction with a guessed denominator.

**Definition of done.** The pill updates within one event of each assistant turn and matches a
hand-computed sum from the raw JSONL for a recorded session. Before the first assistant message it
reads `— / 200k`, not `0%`. If the model is unrecognised it reads `48k tokens` with no denominator
and a tooltip saying the window for that model is unknown — it does **not** fall back to a default
window and present the result as a percentage.

---

### 6. Stable app session ids

**Customer need.** A user finds something in **WorkingSet** or **Forensics**, opens it in Chat, and
wants to send the link to a colleague or just bookmark it. They can't. `POST /api/chat` returns
`Math.random().toString(36).slice(2,10)` (`server/index.mjs:920`) — an 8-character id that exists
only in server memory and dies with the process (the comment at `server/index.mjs:864-865` says so
outright). The real Claude session id only appears once the CLI emits `system/init`
(`server/index.mjs:932`; consumed at `ChatSection.jsx:325-327`), so there is nothing stable to link
to before the first message even in principle.

**Value to Loush.** Deep links, browser history, and cross-section hand-off that survives a reload.
The `chat-open` event bridge (`ChatSection.jsx:295-305`) already exists precisely because sections
want to hand sessions to each other; today the hand-off evaporates on refresh.

**How the upstream repo does it today.** `ChatSessionWriter` allocates a CloudCLI-native session id
up front via `POST /api/providers/sessions`. The browser **only ever** sees that id. The
provider-native id — the JSONL filename, the `--resume` argument — never leaves the server; every
outbound frame is remapped, and `session_created` is swallowed into a DB mapping update. The result
is a stable `/session/:id` URL from before the first message. The security property is a bonus and
worth keeping: a client cannot name a provider session it was not given.

**How we implement it here.** Same idea, no database — we have none and should not acquire one for
this (`_SYNTHESIS.md:336` weighs a durable store as an L-effort decision of its own).

- A JSON index at `~/.claude/dashboard-sessions.json`: `{appId: {cwd, providerSessionId, model,
  createdAt, lastSeenAt}}`, written through the existing `backup()` helper
  (`server/index.mjs:131`).
- `POST /api/chat` allocates and returns the **app id** only. When `system/init` arrives
  (`server/index.mjs:932`) the server records the provider id in the index and does **not** forward
  it as an identity the client can act on.
- Keep the client's ability to *display* the Claude session id — it is genuinely useful for
  `claude --resume` in a terminal, and hiding it would be worse for our users than for theirs. The
  rule we adopt is narrower and sufficient: **never accept a provider session id, `cwd` or project
  path from the client as authority.** Resolve all three server-side from the app id. Today
  `POST /api/chat` takes `cwd` straight from the request body (`server/index.mjs:910`) and
  `resume` likewise — that is the part to change.
- Route as `#/chat/:appId` in `src/App.jsx`; `attach()` learns to resolve an app id whose in-memory
  chat is gone by re-spawning against the recorded provider session id.

**Effort.** M.

**Risks and unknowns.** Making the dashboard hold persistent state is a real architectural step
(`_SYNTHESIS.md:336`). This index is deliberately the smallest possible version — one file, one
map, rewritable and disposable. If it is missing or corrupt, sessions still work; only deep links
degrade. Build it that way explicitly.

**Definition of done.** Copy the URL before sending a single message, close the tab, reopen the URL:
the session is there and continues. Delete the index file: chat still works, deep links show
*"This session link is no longer available — the dashboard's session index was reset"*, not a
crash and not a blank pane.

---

### 7. Live session discovery via a filesystem watcher

**Customer need.** A user runs Claude Code in a terminal, then switches to the dashboard to see it.
The session is not there until they reload — and in **Sessions**, **ActivityTimeline** and
**Overview** they cannot tell a stale view from a quiet system. `_SYNTHESIS.md:197-198` puts our
state bluntly: a binary `ACTIVE_MS = 5*60_000` mtime check that cannot express *"this session is
blocked waiting on you"* — the single most actionable signal, identified independently by two
projects in the batch.

**Value to Loush.** The dashboard stops being a snapshot. This serves the local-first thesis more
directly than anything else in this document: our whole claim is that we read the real files, and
right now we read them once.

**How the upstream repo does it today.** `sessions-watcher.service.ts` chokidar-watches
`~/.claude/projects` (and the Cursor/Codex/OpenCode equivalents), debounces 500 ms with a 2 s
max-wait, and broadcasts **per-session deltas** (`session_upserted`) rather than full snapshots.
Delta-not-snapshot is the right call and is the part worth taking.

**How we implement it here.** With **no new dependency**. chokidar is the obvious choice and the
research recommends it, but `node:fs.watch(dir, {recursive:true})` covers our case on Windows (our
primary platform, per `_SYNTHESIS.md:367`) and macOS. **Recursive watch is not supported on Linux**
— there, fall back to the existing polled read and say so in the UI rather than silently degrading.
Adding a dependency to paper over one platform is not justified against a dependency list of eleven
runtime packages (`package.json:16-28`); revisit if Linux becomes a supported target.

- New `server/watch.mjs`: watch `~/.claude/projects`, debounce 500 ms / 2 s max-wait, emit
  `{type:'session_upserted', sessionId, cwd, mtime}` deltas.
- Expose at `GET /api/live/events` as SSE, reusing the `sseStream` helper extracted in Feature 4.
- Pair it with Stargx's status thresholds (`_SYNTHESIS.md:194`): >60 s idle; <15 s + `tool_use`
  = thinking; <15 s + `text` = **waiting on you**; 15–60 s = idle. That last state is the whole
  point.

**Effort.** S/M.

**Risks and unknowns.** `fs.watch` on Windows can emit duplicate and phantom events; the debounce
absorbs this but the handler must be idempotent. Watching a directory with thousands of project
folders has a cost we have not measured — measure before shipping, and cap the watch set.

**Definition of done.** Start a session in a terminal; it appears in the dashboard within two
seconds with no reload. A session waiting on a permission prompt is labelled **waiting on you**,
distinctly from idle. **Null/empty state:** on Linux the panel says *"Live updates are unavailable
on this platform — showing a snapshot from <time>"*, with a manual refresh, and never presents
stale data as live.

---

### 8. iOS keyboard viewport fix

**Customer need.** Honestly assessed: **nobody's, today.** We bind localhost with no auth and no
TLS; there is no supported way to reach this dashboard from a phone, and this spec actively
recommends against creating one. Listed because it appeared in the ranked contributions, and
because if we ever ship a mobile surface it is fourteen lines that nobody gets right on the first
attempt.

**How the upstream repo does it today.** `AppContent.tsx:190-203` computes
`kb = window.innerHeight - visualViewport.height`, writes it to a `--keyboard-height` CSS variable,
and sets the root container's `bottom` from it. The code carries an explicit warning **not** to
listen to `scroll`, because iOS mutates `offsetTop` during ordinary scrolling and the container
bounces. That warning is the actual value of the item — it is a bug someone shipped, hit, and
documented.

**How we implement it here.** `src/App.jsx` and `src/styles.css`, from the description above. It is
too small and too generic to be anyone's protected expression, but write it from behaviour anyway.

**Effort.** S.

**Risks and unknowns.** Untestable without a physical iOS device. Do not claim it works from a
simulator.

**Definition of done.** Deferred. **Do not schedule this until a mobile access story exists.**
Recording it here so it is not rediscovered later.

---

## The permission model, in detail

This is the most important section in this document.

### What we established by experiment

Everything below rests on three probes run against **Claude Code CLI 2.1.220** on Windows, spawning
the CLI exactly as `server/index.mjs:916` does, minus `--dangerously-skip-permissions`. These
results are empirical, not read from documentation, and they should be re-verified when the CLI
major version changes.

**Probe 1 — remove the flag, no hook.** The model called `Write`. The CLI returned a synthetic
`tool_result` with `is_error: true`:

> `Claude requested permissions to write to …\hello.txt, but you haven't granted it yet.`

The model then gave up: *"I don't have permission to write to that file."* The turn ended
`result/success` with `system/post_turn_summary` carrying `status_category: "blocked"`,
`needs_action: "approve the write request"`.

**There is no `control_request` / `can_use_tool` frame on the CLI's stream-json protocol.** The
Agent SDK's `canUseTool` is not reachable from a raw CLI spawn. Removing the dangerous flag alone
does not give us prompts — it gives us silent denials. This contradicts the natural reading of the
research file's recommendation, and our code wins.

**Probe 2 — a blocking `PreToolUse` hook.** A hook registered on `Write|Edit|Bash` that reads its
payload, stalls six seconds, then returns
`{hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"allow", permissionDecisionReason:"…"}}`.
Result: the CLI **waited**, then the `Write` **succeeded** — the same call that Probe 1 denied. The
hook's stdin payload contained exactly what a permission modal needs:

```
session_id · transcript_path · cwd · prompt_id · permission_mode · effort ·
hook_event_name · tool_name · tool_input · tool_use_id
```

The CLI also emitted `system/hook_started`, `system/hook_progress` and `system/hook_response`
events on the stream we already consume.

**A blocking `PreToolUse` hook is a working `canUseTool`.** With no new npm dependency. This is the
fix siteboon wrote into a code comment at `claude-sdk.js:522` and never shipped.

**Probe 3 — hook timeout.** Same hook, but stalling 60 s against a hook `timeout` of 8 s. The
timeout elapsed, no decision arrived, and the tool was **denied** with the identical message from
Probe 1. The file was not written.

**The architecture fails closed by construction**, because the CLI's baseline behaviour in the
absence of an explicit `allow` is denial. We are not building a deny path and hoping it holds; we
are building an *allow* path on top of a system that already denies. That is the correct direction
for a security control, and it is the single strongest argument for this design over adding the
Agent SDK.

### The approval round-trip

```
model wants a tool
   │
   ▼
Claude Code fires PreToolUse ──► lib/permission-hook.mjs (child process, blocks)
                                      │  POST /api/permission/ask
                                      │  {tool_name, tool_input, tool_use_id, cwd, session_id}
                                      ▼
                          server/permissions.mjs
                                      │  1. resolve chat from session_id (server-side; never
                                      │     trust a chat id from the hook payload)
                                      │  2. evaluate saved rules  ──► auto-decision, no UI
                                      │  3. else park a promise in pending[requestId]
                                      │  4. chatBroadcast({type:'permission_request', …})
                                      ▼
                          existing SSE stream  (server/index.mjs:871)
                                      ▼
                          ChatSection modal ── operator clicks
                                      │  POST /api/chat/:id/permission/:requestId
                                      │  {decision:'allow'|'deny', reason?, remember?}
                                      ▼
                          promise resolves ──► hook writes permissionDecision to stdout, exits 0
                                      ▼
                          Claude Code proceeds or denies; either way
                          chatBroadcast({type:'permission_resolved', …})
```

Two properties to preserve deliberately:

- **The `permission_request` event is synthesised by our server from the hook's POST body**, not
  parsed out of the CLI stream. `system/hook_started` tells us a hook fired but carries no
  `tool_input`, so it is insufficient to render a modal. Use it only as a liveness cross-check.
- **The hook is a separate process with no shared memory.** Its only channel to us is loopback HTTP.
  That is a feature: it means the blocking wait costs us nothing but a parked promise, and a
  dashboard crash cannot leave a tool authorised.

### What the modal shows

Ordered by what a person needs to make the decision in under three seconds:

1. **Risk tier badge** (below), colour-coded, first — before the tool name.
2. **The tool, and the thing it acts on**, resolved and absolute: `Write → E:\client-repo\src\
   auth.js`. Never a truncated relative path; the whole risk is usually *where*.
3. **The argument, rendered per tool** — this is where siteboon's per-tool renderer registry idea
   earns its keep, and `ChatSection.jsx` already has the beginnings of one in `Block`
   (`ChatSection.jsx:68-95`):
   - `Bash` → the command, monospaced, unelided, with the `cwd` it will run in.
   - `Write` → target path, whether the file exists, and byte count.
   - `Edit` → a real diff of old vs new string.
   - `WebFetch` / `WebSearch` → the full URL, host highlighted.
   - Anything else → pretty-printed JSON.
4. **Whether this is inside the project.** A one-line verdict: *"inside E:\client-repo"* or, in
   warning colour, *"OUTSIDE the project directory"*. Computed with the same `containedPath()`
   helper from Feature 2. Path-escape is the single most common way a benign-looking call is not
   benign.
5. **Three buttons and a text field:** `Allow once` · `Allow and remember…` · `Deny`, plus an
   optional *"tell Claude why"* field whose contents become `permissionDecisionReason` — verified in
   Probe 2 to reach the model.
6. **A countdown** to the auto-deny, as a number of seconds, not a bar. The user must be able to
   tell an expiring prompt from a stuck one.

### Risk classification tiers

Tiers drive the badge, the default timeout, and — critically — **what "remember" is allowed to do**.

| Tier | Name | Examples | Timeout | Remember allowed? |
|---|---|---|---|---|
| **0** | Read-only, in-project | `Read`, `Glob`, `Grep`, `NotebookRead` inside `cwd` | auto-allow, no prompt | n/a — never prompts |
| **1** | Low | `TodoWrite`, `Task`, `Skill`, `WebSearch` | 120 s | yes, broad rules ok |
| **2** | Write, in-project | `Write`, `Edit`, `NotebookEdit` under `cwd` | 120 s | yes, path-scoped only |
| **3** | Execute / network | `Bash`, `WebFetch`, all `mcp__*` | 120 s | yes, **exact-prefix only** |
| **4** | Escaping or destructive | any path outside `cwd`; `Bash` matching `rm -rf`, `git push --force`, `curl`/`wget` piped to a shell, `sudo`, credential paths (`.ssh`, `.aws`, `.env`, keychains) | 60 s | **no — never rememberable** |

Notes that matter more than the table:

- **Tier 0 auto-allow is a product decision, not a security one.** Reads are not harmless — a read
  can exfiltrate via a later tool call. It is here because a prompt per `Read` makes the feature
  unusable, and because our threat model is *"the operator did not intend this"*, not *"the model is
  adversarial"*. It must be **switchable off** in Setup, and the setting must be visible in
  Governance. Reads outside `cwd` are Tier 4 regardless.
- **Tier 4 exists to be un-rememberable.** The failure mode of any allow-list is a user clicking
  "remember" on the one call that mattered. Denying that click is the whole design.
- Tier assignment is computed server-side in `server/permissions.mjs`, never supplied by the hook
  payload and never by the client. The rule table lives in one exported function so Governance can
  render it and a test can assert it.

### "Remember this rule" — what it persists and where

siteboon's rules are **run-scoped and in-memory**: an approved `Bash(npm test:*)` lasts until the
run ends. That is a defensible default and it is where we start, but it is not what a user means
when they click "remember" for the fourth time in a week.

We implement **three scopes**, and the modal makes the user choose explicitly — a dropdown on the
`Allow and remember…` button, defaulting to the narrowest:

| Scope | Lives in | Survives |
|---|---|---|
| **This session** | in-memory, on the chat record | until the CLI process exits (default) |
| **This project** | `~/.claude/dashboard-permissions.json`, keyed by `cwd` | restarts |
| **Everywhere** | same file, under a `global` key | restarts; requires a typed confirmation |

Decisions, all deliberate:

- **We do not write to the user's `~/.claude/settings.json` `permissions.allow` array.** It is
  tempting — it is the native mechanism, and `PUT /api/hooks` (`server/index.mjs:339`) already
  writes settings safely with a backup. Two reasons not to: a rule written there silently applies to
  the user's **terminal** sessions too, which is a scope escalation they did not ask for; and it
  would make the dashboard responsible for not corrupting the file that governs all their Claude
  Code use. Our file, our blast radius. Governance should *show* native `permissions.allow` entries
  alongside ours, read-only, so the user sees the whole picture in one place.
- **Rule syntax mirrors the native one** — `Bash(npm test:*)`, `Write(src/**)`, `WebFetch(https://
  docs.anthropic.com/*)` — because users already know it and we want to offer "promote this rule
  into your real settings" later.
- **Matching is prefix-and-glob, never regex.** A user-supplied regex is a denial-of-service and a
  correctness trap. `Bash(git *)` must not match `git push --force` — glob the *argv prefix*, and
  require Tier-4 patterns to fail the match even when a broader rule would allow them. **Tier 4
  beats every rule.**
- **Every rule records its provenance**: who approved it, when, the exact tool call that prompted
  it, and the session id. Governance renders this as an audit trail. A rule with no story behind it
  is one nobody can safely revoke.
- **Revocation is one click** in Governance, and takes effect on the next tool call — rules are read
  from disk per evaluation, not cached for the life of the process.

### Timeout, disconnect, and failing closed

Four failure modes, each with a defined behaviour:

**1. The operator does not answer.** The pending promise resolves to `deny` at the tier timeout,
and the hook returns a deny decision with reason *"no response from the dashboard operator"*. The
modal is replaced in the transcript by `✗ auto-denied after 120 s`. Verified in Probe 3 that a
missing decision also denies, so this is belt-and-braces: even if our timer fails, the hook's own
`timeout` in the settings file denies at the outer bound.

**Two timeouts, and the inner one must be shorter.** The hook's settings `timeout` is the outer
bound (set to tier timeout + 30 s); our in-hook deadline is the inner one. If the inner fires we
emit an explicit deny *with a reason the model can read*; if only the outer fires the model gets the
generic "you haven't granted it yet" and less to work with. Prefer the informative path.

**2. The browser disconnects.** The prompt stays pending server-side until its timeout — it is not
cancelled, because the user may be reconnecting. On reconnect, the replay from Feature 4 delivers
the `permission_request` event again and the modal reappears with the **remaining** time, not a
fresh countdown. This is siteboon's `pendingPermissions`-on-`chat_subscribed` behaviour, obtained
for free from the `seq` replay rather than as a special case. If no browser reconnects before the
timeout, it denies.

**3. The dashboard server dies.** The hook's POST fails or its socket closes. **The hook must treat
any transport failure as `deny`** — never as allow, never as "no opinion". It exits 0 with an
explicit deny decision so the model gets a clear reason; if it cannot even do that, the CLI's own
default denies. Confirmed in Probe 3. This is the property to test explicitly and regression-test
forever.

**4. The hook cannot be installed.** If we cannot write the run's settings file, we **do not start
the chat**. We do not fall back to `--dangerously-skip-permissions`, and we do not start unguarded
with a warning the user will click past. The Chat section shows *"Cannot start: permission prompts
could not be enabled"* with the underlying error. A security control with a silent fallback is not
a security control.

The general rule, worth stating once so it can be pointed at in review: **there is no code path in
which the absence of a decision produces an allow.** Every `allow` must be traceable to either an
explicit operator click or a matched, persisted, provenance-carrying rule.

### Settings scope for the hook

The hook is registered in a **dashboard-owned settings file passed per-run**, not merged into the
user's `~/.claude/settings.json`. Rationale: the user's own hooks stay untouched, uninstalling the
dashboard leaves nothing behind, and a crashed dashboard cannot leave a blocking hook wired into
every terminal session the user starts — which would hang their normal Claude Code use. That last
failure mode is severe enough on its own to settle the question.

**Unverified and must be checked in the first hour of implementation:** the precise flag and
precedence for supplying a settings file to a `-p` run in CLI 2.1.220 (`--settings` appears in
`claude --help`; our probes used a project-scope `.claude/settings.json` in a temp directory, which
we do **not** want to write into the user's real repository). If no per-run mechanism works, the
fallback is a project-scope file written through `backup()` and removed on session end — worse, and
it needs an explicit cleanup path for crashes.

---

## Transport: SSE vs WebSocket

**Recommendation: stay on SSE. Do not adopt WebSocket.** Implement `seq` + replay with `id:` lines
and `Last-Event-ID`, per Feature 4.

The research file ranks "replace SSE with WebSocket + `seq` replay" as its #1 adoption
(`siteboon-claude-code-ui.md:800`). I disagree, and the disagreement is not about taste.

**The `seq` + replay design does not require WebSocket. It is native to SSE and bolted onto
WebSocket.** SSE has a replay protocol in the specification: the server emits `id:` lines, and on
reconnect the browser automatically sends `Last-Event-ID`. siteboon had to *build* `chat.subscribe`
with a `lastSeq` array, a client-side reconnect timer, and a synthetic `websocket_reconnected`
frame — 343 lines of registry plus 193 lines of context — to reconstruct in WebSocket what
`EventSource` gives away. Their design is excellent *given* their choice of transport. We do not
share that choice, and adopting the workaround along with the mechanism would be cargo-culting.

Concretely, Feature 4 over SSE is: one `id:` line in the writer, one header read in the handler, one
ring buffer. **Zero client-side reconnect code**, because the browser owns reconnection.

**What WebSocket would actually buy us**, honestly:

- *Client→server messages on the same connection.* We do not need this. Sends already go over
  `POST /api/chat/:id/message` (`server/index.mjs:953`) and work fine. Permission responses are a
  POST too, and — importantly — a permission response is a **rare, discrete, consequential** action.
  A request/response with a status code and an error path is the right shape for it. Multiplexing it
  onto a socket frame makes error handling worse, not better.
- *Lower per-message overhead.* Irrelevant at our volume, on loopback.
- *Binary frames.* We have no binary need.

**What WebSocket would cost us:**

- **A new runtime dependency (`ws`)** against a list of eleven (`package.json:16-28`). Not
  justified by the above.
- **Rewriting two working SSE call sites** — `server/index.mjs:944` and `server/ticket.mjs:848` —
  plus their clients, to reach the same place Feature 4 reaches by adding a line to each.
- **A new attack surface, of exactly the kind that produced the worst CVE in the batch.**
  CVE-2026-31975 (CVSS 9.8, unauthenticated RCE) lived in siteboon's WebSocket upgrade path: a
  hardcoded fallback JWT secret, a `verifyClient` that checked a signature but never confirmed the
  user existed, and command injection in the handler downstream. Express middleware does not apply
  to a WebSocket upgrade; every guard has to be re-implemented on a path most developers test less.
  We currently have **no** authentication to re-implement, which sounds like it makes this moot and
  in fact makes it worse: the day we add auth, an SSE endpoint inherits it from middleware and a WS
  upgrade does not.

**If we ever do add WebSocket** — for a shell, or for genuine bidirectional need — these are
non-negotiable, and they are drawn from what actually went wrong upstream:

1. Authenticate at the **upgrade**, not the first message.
2. Never accept a session id, project path or provider id from the client as authority; resolve all
   three server-side. (We violate this today at `server/index.mjs:910` even over HTTP — fix it there
   first, per Feature 6.)
3. Bind `127.0.0.1` explicitly. Their `.env.example` defaulted to `0.0.0.0` and that default is half
   of why their RCE mattered. **We currently have the same defect**: `app.listen(PORT)` at
   `server/index.mjs:4771` has no host argument and therefore binds all interfaces. Fix this
   regardless of transport — it is a one-word change and it is the highest-value line in this
   document.
4. Never put a token in the query string. Theirs lands in proxy and access logs.

**The one thing SSE genuinely costs us**, stated plainly: a browser limit of six concurrent HTTP/1.1
connections per origin. Each open chat holds one. With the live-session watcher (Feature 7) that is
two long-lived streams before the user opens a second chat tab. Mitigations in order: run Vite's dev
proxy and the API over HTTP/2 where available (limit rises to ~100), and multiplex the watcher and
chat streams onto one `/api/events` endpoint with a `topic` field if we ever exceed it. Neither is
needed today. **Revisit this recommendation if we ship more than three concurrent live streams per
page** — that is the trigger condition, and it is the only one.

---

## Not worth taking

- **The integrated shell (`node-pty` + xterm).** Out of scope by instruction, and independently
  correct: it is the largest security surface in their product, it voids their own headline
  "all tools disabled by default" claim because the PTY has no allow-list, and `node-pty` is a
  native module needing per-platform build handling on Windows — our primary platform. It is also
  the least aligned with an analysis-first dashboard.
- **`shengyanlin/claude-overlay` and screen capture generally.** On the do-not-install list
  (`_SYNTHESIS.md:346`). Defaults to `bypassPermissions` with a blanket allow, home-directory `cwd`,
  no redaction, ingesting every pixel on screen. Also note its README embeds a literal
  `claude "Set up Claude Overlay for me: clone …"` directive — agent-directed instruction text in a
  fetched page. It was treated as data here and must be treated as data anywhere we ingest it.
- **WebSocket as a transport.** See above. This is the ranked #1 recommendation of the research
  file and I am declining it on the evidence.
- **The Agent SDK (`@anthropic-ai/claude-agent-sdk`) as a way to get `canUseTool`.** It is the
  obvious route and it is the wrong one for us: a substantial new dependency, a rewrite of a working
  spawn path (`server/index.mjs:919`, `lib/agent.mjs`), and it inherits the exact hole siteboon
  documented — in `auto` and `bypassPermissions` modes the SDK resolves approval before `canUseTool`
  runs. The hook route is verified working, fails closed, and costs no dependency. *If* a future CLI
  removes blocking-hook support, revisit — that is the trigger, and nothing else is.
- **A database (`better-sqlite3`) for the session mapping.** A JSON index covers it at our scale.
  `_SYNTHESIS.md:336` independently flags the native build and documented install failures.
- **`chokidar`.** `fs.watch` covers Windows and macOS. See Feature 7 for the Linux caveat and the
  condition under which this changes.
- **Their permission *storage* location.** They keep the allow-list in their own SQLite DB, not in
  `~/.claude/settings.json`, and their README's claim to "extend Claude Code rather than sit
  alongside it" is not true of permissions. We are making the same split for better-argued reasons
  (see "Remember this rule") — but we should not repeat their marketing.
- **Every performance and efficiency number from any project in the batch.** `_SYNTHESIS.md:180`:
  never repeat them in our UI or docs. Every checkable one failed.

---

## Open questions for the maintainer

Ordered by how much they block work.

1. **`app.listen(PORT)` at `server/index.mjs:4771` binds all interfaces, and we have no auth.**
   Combined with `POST /api/hooks/dryrun` (`server/index.mjs:3640-3651`), which passes a
   client-supplied string to `spawn('sh', ['-c', command])` by design, any device on the LAN has
   unauthenticated arbitrary command execution as your user. This is structurally CVE-2026-31975.
   **Should the loopback bind ship before or alongside this spec?** My recommendation is *before*,
   as a standalone one-line fix, because it is not contingent on anything here.
2. **Tier 0 auto-allow for reads: default on or default off?** On makes the feature usable; off is
   the defensible security position. I have specced *on, with a visible switch*. This is a product
   judgement, not an engineering one, and it should be yours.
3. **Do the four non-chat `--dangerously-skip-permissions` sites come with us?**
   `server/index.mjs:1056` (Quick Actions), `:1964`, `:3488`, and both shapes in `lib/agent.mjs`
   (`:27`, `:55`) run unattended generators where a blocking prompt has no operator to answer it.
   Options: leave them (and document why), give them a **non-interactive rule-only** evaluation with
   no UI fallback and a hard deny on miss, or run them under a restrictive static allow-list.
   I lean to the second. Quick Actions in particular is user-initiated and arguably *is*
   interactive.
4. **Is the permission decision log a first-class Governance artifact?** If yes, it wants a retained
   on-disk log with rotation, and that is the first thing the dashboard persists that a user might
   need for compliance. If no, it lives in the transcript and dies with it. Affects Feature 1's
   scope.
5. **Confirmation of the licensing position.** This spec assumes the emailed permission is
   **not relied upon** and that we take designs only. If there is a written permission naming
   specific files and extending to MIT relicensing, that changes nothing in this document — the hook
   design is better than theirs anyway — but it should be recorded either way, per
   `_SYNTHESIS.md:373`.
6. **Do we support Linux as a first-class platform?** Feature 7's watcher degrades there.
   `_SYNTHESIS.md:367` implies Windows-primary. A yes means budgeting for `chokidar` after all.

---

## Verification appendix

Facts in this document are one of three kinds. Treat them accordingly.

**Verified by reading our code** (cited inline): the `--dangerously-skip-permissions` call sites;
the SSE replay-all-then-append duplication defect at `server/index.mjs:949` +
`ChatSection.jsx:280`, duplicated at `server/ticket.mjs:854`; unbounded `chat.events`; the 300 MB
unbounded-path upload; `child.kill()` as the only interrupt; the random 8-char session id; the
all-interfaces bind; the unguarded double-`closed` emission at `server/index.mjs:938-939`.

**Verified by experiment** against CLI **2.1.220** on Windows, spawning as `server/index.mjs:916`
does: no `control_request` permission channel exists on the stream-json protocol; a blocking
`PreToolUse` hook grants a tool the CLI would otherwise deny; a hook timeout denies; the hook stdin
payload carries `tool_name`, `tool_input`, `tool_use_id`, `cwd`, `session_id`, `permission_mode`;
`assistant` events carry the four `usage` fields and `result` carries `usage.iterations[]`.
**Re-run these probes on any CLI major version bump.** They are the foundation of Feature 1.

**Explicitly unverified** — do not build on these without checking: interrupt-on-stdin in
stream-json mode; the per-run settings-file flag and its precedence; whether subagent (`Task`) tool
calls fire `PreToolUse` in the parent's hook context; whether `permissionDecision: "ask"` is
meaningful in headless mode; per-model context-window sizes (not present in `system/init`);
`fs.watch` cost against a large `~/.claude/projects`.
