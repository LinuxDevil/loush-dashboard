# Implementation spec — adoptions from `hoangsonww/Claude-Code-Agent-Monitor`

> Turns `claude-code-agent-monitor.md` (research) + `_SYNTHESIS.md` (rulings) into shippable work,
> grounded in our actual code. Written 2026-07-29.
> Upstream license: **MIT**, verified present (`_SYNTHESIS.md:150`). Carry attribution in every
> ported file. Strip upstream's generated `MODULE_GUIDE` blocks and `@author` lines
> (`_SYNTHESIS.md:365`) — they embed the author's macOS absolute paths.

## What the synthesis assigned to this project

| Synthesis ruling | Item | Spec feature below |
|---|---|---|
| Tier 1.3 | Control gate + traversal guard (CAST/CCAM) | **1** |
| Tier 1.10 | Subagent-internal tool calls via `tool_use_id` pairing | **2** |
| Tier 2.2 | Transcript cache: `(mtime,size)` key + byte-range reads | **4** |
| Tier 2.4 | WebSocket + eventBus | **5** — *adopted as SSE, see the flagged note* |
| Tier 3.3 | Hook receiver for true mid-turn state | **7** |
| §7 overlap table | Honesty rules — independent convergence, "worth matching" | **6** |
| *(unranked in the synthesis)* | Event grouping / event summary | **3** — see note |

**Two places where I am not silently following the synthesis. Both are flagged in-line:**

1. **Feature 5 uses SSE, not WebSocket.** Tier 2.4 says "WebSocket + eventBus". We already run
   Server-Sent Events in two production paths with zero dependencies
   (`server/index.mjs:947`, `server/ticket.mjs:852`, consumed by `src/sections/ChatSection.jsx:277`
   and `src/sections/TicketSection.jsx:535`). `ws` would be a new server dependency and would need
   `ws: true` added to the Vite proxy (`vite.config.js:8`), which today proxies `/api` only. The
   *valuable* part of Tier 2.4 is the client discipline — StrictMode double-mount guard, handler-in-ref,
   capped backoff, reconnect on focus/online/visibilitychange — and every bit of that is
   transport-agnostic. I take all of it and keep our transport. If the maintainer wants literal
   WebSocket, say so and it's a ~1 day swap behind the same `eventBus` interface.
2. **Feature 3 (event titles/summaries) is not in the synthesis' tier list at all.** The research
   file ranks it #3 of its 14 recommendations and calls `event-grouping.ts` "the single highest
   value-per-line file in the repo" (`claude-code-agent-monitor.md:293`). It is not on the
   do-not-adopt list either. I'm proposing it as an *unranked addition* rather than pretending it
   carries a tier.

## Discrepancies between the research file and our code

The research was written against an older read of our repo. Where they disagree, our code wins:

- **"We use `marked` + presumably `innerHTML`"** (`claude-code-agent-monitor.md:303`) — `marked` is
  in `package.json` but I found **no `dangerouslySetInnerHTML` in any transcript-rendering path**.
  `src/sections/ActivityTimeline.jsx` and `ChatSection.jsx` build React element trees from parsed
  blocks. Their `MarkdownContent.tsx` port (research #13) is therefore **not** the XSS fix they
  advertise for us. Dropped — see *Not worth taking*.
- **"Subagent tool attribution — NONE" (`:382`).** Partly wrong. `historyEvents()`
  (`server/index.mjs:891–908`) already stitches subagent transcripts into the Chat view by reading
  `subagents/*.meta.json` and matching `link.toolUseId` to the parent's `Task` `tool_use` id. And
  `failStats()` (`server/index.mjs:1828–1873`) already pairs `tool_use`→`tool_result` by
  `tool_use_id` via its `idName` map. What we're actually missing is narrower and more valuable —
  see Feature 2.
- **"Security hardening — unverified in our repo" (`:409`).** Now verified: we bind every interface
  (`server/index.mjs:4771` is a bare `app.listen(PORT, …)`), no CORS policy, no Host check, no auth.
  Path jailing *does* exist (`safe()` at `server/index.mjs:125`, plus per-route root checks at
  `:1703` and `:1711`), so the `safeResolve` half of Tier 1.3 is largely already done.
- **Corpus scale, measured on this machine (not in either document):** `~/.claude/projects` holds
  **1,278 `.jsonl` files / 454 MB**, of which **1,159 files / 290 MB (64%) are subagent
  transcripts**. Largest single transcript is 6.9 MB. Every effort estimate below assumes that
  scale.

---

## 1. Bind to loopback, allowlist the Host header, optional token gate

**Customer need** — Today you run `npm run dev` in a café or on a corporate LAN. `app.listen(PORT)`
at `server/index.mjs:4771` passes no host, so Node binds `0.0.0.0` and port 5178 is reachable from
every device on that subnet with no credential of any kind. What's behind it: `GET /api/sessions`
(every transcript path, cwd, git branch and dollar figure), `GET /api/artifacts/download?path=…`
(`:532` — file read, jailed to `~/.claude` but that's where your transcripts live),
`PUT /api/hooks` (`:339` — writes a shell command into `~/.claude/settings.json` that Claude Code
then executes on your machine), and `POST /api/chat` (`:909`) which spawns `claude` with
`--dangerously-skip-permissions` (`:916`) in a cwd of the caller's choosing. That last pair is
remote code execution for anyone on the LAN. Separately, a malicious web page you happen to visit
can DNS-rebind its own hostname to `127.0.0.1`, at which point the browser treats our API as
same-origin and CORS stops protecting anything. What people do today: nothing, because nothing
tells them the port is open. There is no setting, no warning, and no mention in `SetupSection`.

**Value to Loush** — This is the gate on ever telling a colleague "just run it." Every one of our
differentiators (`_SYNTHESIS.md:121-126` — safe config *writing* with backups, repo joins, JIRA/CI
joins) is a write surface, so our exposure grows with every feature we ship. `_SYNTHESIS.md:63-76`
records three unrelated projects pointing at this same hole and notes our posture is *worse* than
siteboon's — a project that shipped a CVSS 9.8 unauthenticated RCE. Lands as a status row in
`SetupSection` alongside the existing credential-state rows, which already render
`{set: true|false, source}` without echoing values (`server/setup.mjs:153-165`).

**How the upstream repo does it today** — `server/lib/security.js` plus `hostGuard`/`tokenGuard`
wired into `server/index.js`. Four independent controls, written in response to a real advisory
(GHSA-gr74-4xfh-6jw9):
1. **Loopback bind by default.** `127.0.0.1` unless explicitly overridden by env.
2. **Loopback-only CORS.** Origin must be a loopback origin; everything else gets no CORS headers.
3. **Host-header allowlist.** The anti-DNS-rebinding control, and the non-obvious one — CORS does
   not save you once the attacker's DNS resolves to your loopback address, because then it *is*
   same-origin. Comparing `req.headers.host`'s hostname against a fixed allowlist does.
4. **Optional token** accepted as `Authorization: Bearer`, `x-dashboard-token`, or `?token=`, gating
   `/api/*` **and the WebSocket upgrade separately**. The gotcha their author hit and documents:
   *Express middleware does not run on an HTTP upgrade*, so a guard mounted with `app.use` silently
   does not protect `/ws`. They re-check Host and token inside the `upgrade` handler in
   `server/websocket.js`.

**How we implement it here** — New `server/security.mjs` (plain ESM, zero deps), exporting
`hostGuard(allowlist)`, `tokenGuard(token)` and `bindHost()`.

- `server/index.mjs`: mount both guards as the **first** `app.use`, above `express.json` at `:52`
  and above the `respCache` middleware at `:111` — a rejected request must never populate the
  response cache.
- `server/index.mjs:4771`: `app.listen(PORT, BIND, …)` where
  `const BIND = process.env.DASH_BIND || '127.0.0.1'`.
- Host allowlist compares **hostname only, port ignored**: `localhost`, `127.0.0.1`, `::1`, `[::1]`,
  plus a comma-separated `DASH_HOST_ALLOW`. Port must be ignored because the Vite dev proxy
  (`vite.config.js:8`) forwards the browser's `Host: localhost:5177` unchanged (`changeOrigin`
  defaults to false), so a naive `host === 'localhost:5178'` check breaks `npm run dev` on day one.
- Token gate is **opt-in and off by default** (`DASH_TOKEN` unset ⇒ `tokenGuard` is a pass-through).
  Turning it on with no way to supply the token from the browser would brick the app; the client
  reads it from `localStorage['dash-token']` in `src/lib/api.js`'s `req()` (`:6-25`) and sets an
  `x-dash-token` header. `EventSource` cannot set headers, so the two SSE routes
  (`server/index.mjs:944`, `server/ticket.mjs:852`) must also accept `?token=` — this is exactly the
  `?token=` escape hatch upstream ships, and the reason it exists.
- No new API route. New read-only field on the **existing** `GET /api/meta` (`:4768`):
  `{ bind, hostAllow, tokenSet: boolean }` — `tokenSet` only, never the value, matching the
  `server/setup.mjs` secret rule verbatim.
- `SetupSection` renders it as a row: bind address, whether a token is set, and a warning when
  `bind !== '127.0.0.1'`.
- No `App.jsx` nav change — Setup already exists (`src/App.jsx:198-205`).

**Effort** — **S.** ~120 lines of new server code plus three small edits. The only fiddly part is
the SSE/token interaction, and there are exactly two SSE routes. No data model changes, no UI beyond
one status row.

**Risks and unknowns**
- Must verify the Vite proxy's Host forwarding empirically before shipping the allowlist; if
  `changeOrigin` has a different default in Vite 5 than I believe, the check needs `localhost:5178`
  too. **Verify first, do not assume.**
- Binding loopback breaks anyone currently reaching the dashboard from a phone or another machine on
  purpose. That is a behaviour change, so `DASH_BIND` must be documented in the README in the same
  commit.
- Windows: `::1` vs `127.0.0.1` binding differs; verify both `http://localhost:5178` and
  `http://127.0.0.1:5178` still work after the change.
- `--dangerously-skip-permissions` at `:916` is a *separate* hole (synthesis Tier 2.3, siteboon's
  job). Closing the network does not close that, and this spec must not be read as having fixed it.

**Definition of done**
- `netstat`/`ss` shows the listener on `127.0.0.1:5178`, not `0.0.0.0:5178`.
- A request with `Host: evil.example.com` to `/api/sessions` returns **403** with a body naming the
  Host header as the reason; the same request with `Host: localhost:5178` returns 200.
- With `DASH_TOKEN` set, `/api/sessions` without a token returns **401**; the SSE routes accept
  `?token=`; the browser app works after the token is stored.
- With `DASH_TOKEN` unset, every existing route behaves exactly as before (regression pass over
  Overview, Sessions, Chat, Ticket).
- `GET /api/meta` returns `tokenSet: false` and **never** a token value.
- **Empty/null state:** when the token is unset, Setup shows `token — not set` and an explanatory
  line. It must **not** show a green tick, a `0`, or a masked `••••` implying a value exists.
  `bind` is a real string read from the server; if the server does not report it (older build),
  Setup renders `unknown`, never `127.0.0.1` as an optimistic default.

---

## 2. Roll subagent transcripts up to their parent session

**Customer need** — You spend an afternoon on one big task. Claude fans out to twenty subagents.
You open **Harness → Sessions** to see what it cost, and the row says $1.40. The real number is
several times that, and nothing on the screen hints at it. `GET /api/sessions`
(`server/index.mjs:3030`) filters `!f.isAgent`, and `isAgent` is `f.includes('subagents')`
(`:709`). On this machine that filter discards **1,159 of 1,278 transcript files and 290 MB of
454 MB — 64% of the corpus, all of which carries real `usage` blocks** (I counted 80 usage lines in
a single subagent file). The same exclusion is in `/api/context/sessions` (`:3074`),
`recentSessions` (`:768`) and `sessions30` (`:765`). Meanwhile Working Set *does* count subagent
edits, but files them under a `sessionId` of `agent-a053603c4a95a2132`
(`scanTranscripts` at `:2402` takes `path.basename(f, '.jsonl')`), so its "sessions" column
over-counts and you cannot click through from an edit to the conversation that caused it. Today
people work around this by opening the raw JSONL.

**Value to Loush** — This is a **correctness** fix in the same family as `_SYNTHESIS.md`'s D1/D2,
not a feature: three of our sections currently display numbers that are wrong by a large,
unstated margin. It lands in `SessionsSection`, `ForensicsSection`, `WorkingSet` and `UsagePanel`,
and it is the precondition for any honest per-session cost claim. It also gives us a real
delegation tree, which is the data `PlanGraph` already knows how to draw
(`src/sections/PlanGraph.jsx:79` already has an "open subagent graph" drill-in).

**How the upstream repo does it today** — `scanAndImportSubagents` in `scripts/import-history.js`.
On every `SubagentStop` hook it parses `subagents/agent-*.jsonl`, pairs `tool_use` blocks to
`tool_result` blocks by `tool_use_id`, and **synthesizes** `PreToolUse`/`PostToolUse` events that
Claude Code never emitted — because Claude Code fires no hooks for tools called *inside* a subagent
(`claude-code-agent-monitor.md:42`). The pairing is the whole trick: a `tool_result` arrives on a
later `user`-typed line with only the id to connect it back to the call. They also walk
`parent_agent_id` to the root to build a `main › coder › explorer` breadcrumb, **cycle-guarded with
a `seen` Set**, dropping any segment identical to its predecessor
(`agentOriginLabel` in `client/src/lib/event-grouping.ts`). The cycle guard is the gotcha — a
malformed or truncated meta file can otherwise hang the walk.

**How we implement it here** — We can do better than upstream, because on-disk reality gives us the
link *exactly* rather than by pairing. **Verified on this machine**, every line inside
`~/.claude/projects/<proj>/<parentSessionId>/subagents/agent-<id>.jsonl` carries:

```
sessionId: "24d387ff-8e01-45ad-a6f5-4352ab225f23"   <- the PARENT session id, verbatim
agentId:   "a053603c4a95a2132"
isSidechain: true
cwd, gitBranch, requestId, promptId,
attributionAgent: "general-purpose", attributionMcpServer, attributionMcpTool
```

and the sibling `agent-<id>.meta.json` carries
`{agentType, description, toolUseId, parentAgentId, spawnDepth, worktreePath?}`. So the parent link
is a **field, not a heuristic** — no `tool_use_id` pairing needed for attribution (we still need
pairing for *results*, and `failStats()` already does it at `server/index.mjs:1856`).

- `server/index.mjs`, `collectUsage()` (`:657`): in the per-file record (`rec`, `:669`) add
  `parentSessionId` and `agentId`, read from the first line that carries `sessionId` when the file
  path contains `subagents`. Add `agentType`/`description`/`parentAgentId`/`spawnDepth` from the
  sibling `.meta.json` (one `readFileSync` per subagent file, cached in the same `(mtime,size)`
  record so it is paid once).
- `server/index.mjs`, `scanTranscripts()` (`:2299`): same two fields onto `rec` and onto every
  pushed `all.edits` / `all.sessions` entry (`:2399`, `:2402`).
- `GET /api/sessions` (`:3022`): stop dropping subagents. Instead group `files` by
  `f.parentSessionId ?? sessionId`, and return per row:
  `{ cost, out, in, cacheRead, toolCalls, msgs }` **split into `own` and `subagents`**, plus
  `subagentCount` and a `subagents: [{agentId, agentType, description, cost, out, toolCalls,
  spawnDepth, first, last}]` array. `totals.cost` then finally means what the header says.
  Response shape is additive — existing keys keep their meaning as the *rolled-up* value, and the
  new `own`/`subagents` split is what makes the change auditable rather than a silent number jump.
- `server/fe.mjs` `harvest()` (`:396-411`): `cwdOf` is built from `all.sessions` keyed by
  `sessionId` (`:400`). Key it by `parentSessionId ?? sessionId` so a subagent edit resolves to its
  parent's cwd, and carry `parentSessionId` onto each edit so `repoList`'s `x.sessions.add()`
  (`:424`) counts real sessions rather than agent ids.
- `src/sections/SessionsSection.jsx`: add an `Agents` column (`subagentCount`, `—` when zero) and
  make the row expandable to the `subagents` array. The `COLS` table at `:17-22` is the one place
  to edit; `fmtTok`/`fmtDur` already exist.
- No new route, no `App.jsx` change — Sessions is already a Hub item under Harness
  (`src/App.jsx:162`).

**Effort** — **M.** The server changes are small and mechanical (~150 lines across three files), but
`/api/sessions`, `/api/context/sessions`, `/api/usage`'s `recentSessions`/`sessions30`, and
`server/fe.mjs`'s repo attribution all consume `isAgent` and all shift meaning at once. That is four
call sites to re-reason about plus a client column. The honest cost is in verifying nothing
double-counts, not in typing.

**Risks and unknowns**
- **Double counting is the main failure mode.** If a subagent's `usage` is already reflected in the
  parent transcript, rolling up inflates rather than corrects. I did **not** verify this. It must be
  checked before shipping: take one session, sum parent-only usage, sum subagent usage, and compare
  against `claude`'s own reported cost for that session if reachable. If they overlap, the split
  presentation still ships but the roll-up total does not.
- `.meta.json` field names (`toolUseId`, `parentAgentId`, `spawnDepth`) are **undocumented
  first-party format**. `_SYNTHESIS.md:95-97` warns these change without notice. Every read must be
  optional-chained and degrade to `null`, never to a default.
- `spawnDepth: 2` entries exist on this machine (nested subagents). The parent walk must be
  cycle-guarded with a `seen` Set exactly as upstream does, and depth-capped.
- Response size: a session with 40 subagents returns a much larger row. Cap the `subagents` array
  and state the cap.

**Definition of done**
- For a known session with subagents, `GET /api/sessions` returns `cost` ≥ the pre-change value,
  and `own.cost + subagents.cost === cost` to 4 decimal places.
- `subagentCount` is present on every row; a session with none shows `subagentCount: 0` and the UI
  renders **`—`**, not `0` — consistent with the existing `{r.compactions || '—'}` idiom at
  `src/sections/SessionsSection.jsx:127`.
- **Empty/null state:** if a subagent's `.meta.json` is missing or unparseable, `agentType` and
  `description` are **`null`** and the row renders `unknown agent` — never `"general-purpose"` as a
  fallback and never an empty string that reads as "no type". If `parentSessionId` cannot be read
  from any line, the file falls back to today's behaviour (its own id) and is flagged
  `orphan: true` rather than being silently attached to an arbitrary parent.
- `WorkingSet`'s per-repo `sessions` count drops (it was counting agent ids) and the drill-in from a
  file to its session opens the *parent* conversation.
- A regression check that `/api/usage` totals are unchanged — that endpoint already counted every
  file including subagents (`collectUsage` has no `isAgent` filter), so it must **not** move.

---

## 3. Human event titles and per-event summaries

**Customer need** — Open **Harness → Forensics** or the Activity timeline after a long run. Rows
read `Bash · git commit -m "fix flaky test in useWebSocket…"` at best, and
`mcp__github__create_pull_request · {"owner":"…","repo":"…"}` at worst. Our
`shortArg()` (`src/lib/plan.js:29-40`) takes the first of `command|pattern|prompt|description|url`
and clips it to 60 chars; `toolName()` (`:41`) turns `mcp__github__create_pull_request` into
`create_pull_request` and loses the server. For an `Edit` we render the file path and nothing about
the change, so scanning a 200-action session for "where did it touch auth" means opening each row.
Today people scroll, or give up and open the raw transcript via the `raw` button
(`src/sections/SessionsSection.jsx:134`).

**Value to Loush** — Every row in `ActivityTimeline`, `ForensicsSection`, `PlanGraph` and
`ChatSection` gets more readable for one shared pure module and zero new data. The specific piece
worth buying is `firstEnclosingContext()` — it reads the enclosing function or class out of a diff
hunk header — which upgrades `WorkingSet`'s per-edit display from "file changed" to "changed
`collectUsage`", against `structuredPatch` data we **already parse** (`server/index.mjs:2354-2362`
keeps 24 hunk lines per edit; `server/fe.mjs` consumes them).

**How the upstream repo does it today** — `client/src/lib/event-grouping.ts` (852 lines) and
`client/src/lib/event-summary.ts` (663 lines), both zero-dependency.
- **Structural, not table-driven.** There is no map of known tools; a new MCP server or CLI renders
  correctly with no code change. That is the property worth copying, and the reason the file has
  survived their churn.
- `humanizeMcpServer` collapses consecutive duplicate tokens (`github_github` → `Github`) while
  preserving intentional camel case (`GitLab` stays `GitLab`).
- `parseShellHeadline` uses a `SUBCOMMAND_BINARIES` set so `git commit -m …` yields `git commit`,
  not `git` — without the set you either always take one token (useless for git/npm/docker) or
  always take two (wrong for `ls -la`).
- Output shape: `Github · create pull request · Fix flaky test`, `Edit · src/App.tsx (all)`.
- `event-summary.ts` returns `{icon, headline, bullets}` — and **returns `null` when there is
  nothing useful to say**, rather than emitting a filler summary. Their author arrived at our
  honesty rule independently (`claude-code-agent-monitor.md:294`).
- `countHunks(structuredPatch)` → `{hunks, added, removed}`; `firstEnclosingContext()` pulls the
  function/class name out of the `@@ … @@ <context>` trailer of a hunk header.

**How we implement it here** — Extend `src/lib/plan.js` rather than adding a parallel module; it is
already the shared "how do I describe a tool call" file imported by
`src/sections/ActivityTimeline.jsx:2` and used by `PlanGraph` via `blocksToPlan`.

- New exports in `src/lib/plan.js`: `eventTitle(block) -> {source, action, detail}` and
  `eventSummary(block) -> {icon, headline, bullets} | null`. `toolName`/`shortArg` stay exported and
  become thin wrappers so nothing breaks.
- Port `humanizeMcpServer`, `parseShellHeadline` + `SUBCOMMAND_BINARIES`, `countHunks` and
  `firstEnclosingContext` — strip TypeScript annotations, that is the whole port
  (`claude-code-agent-monitor.md:293` rates it *Easy*).
- Consumers: `src/sections/ActivityTimeline.jsx` `classify()` (`:20-32`) swaps its ad-hoc string
  building for `eventTitle`. `src/sections/ForensicsSection.jsx` uses it for failure-signature rows.
  `src/sections/WorkingSet.jsx` uses `firstEnclosingContext` on the `hunk` string already carried by
  `scanTranscripts`' edit records (`server/index.mjs:2362`).
- **Client-only. No new API route, no server change, no `App.jsx` change.** That is why it is cheap.
- `structuredPatch` hunk headers must survive to the client. Today `rec.edits[].hunk` keeps the
  first 24 lines joined and clipped to 600 chars (`:2360-2362`) — verify the `@@` header line is
  among them; if `structuredPatch[].lines` excludes headers, `firstEnclosingContext` needs
  `oldStart`/`oldLines` plus a source lookup instead, which is a different and larger job.

**Effort** — **S** for `eventTitle` + the shell/MCP humanizers (self-contained, testable with
`node --test`, no data changes). **M** if `firstEnclosingContext` turns out to need hunk headers we
are not currently keeping. Spec them as two commits so the S part ships regardless.

**Risks and unknowns**
- The `@@`-header question above is the one real unknown and gates half the value. **Verify first**
  by dumping one `toolUseResult.structuredPatch` from a real transcript.
- Upstream's functions assume their event shape. Ours is `{kind, name, input, result, isError, ts,
  toolResult}` (`src/lib/plan.js:60-76`). This is an adapter layer, not a copy-paste, so budget for
  a small shim.
- Being structural means it will occasionally produce an odd title for a tool nobody anticipated.
  That is the trade for never breaking on a new tool; the fallback must be today's behaviour, not a
  blank.

**Definition of done**
- `node --test` covers: `mcp__github__create_pull_request` → `Github · create pull request`;
  `github_github_*` → `Github` (single); `GitLab` preserved; `git commit -m "x"` → `git commit`;
  `ls -la` → `ls`; `npm run build` → `npm run`.
- `ActivityTimeline` rows for MCP and Bash calls are visibly shorter and name the server/subcommand.
- **Empty/null state:** `eventSummary` returns **`null`** — not `{headline: ''}` and not a
  placeholder — when the block carries nothing summarisable, and every consumer renders nothing at
  all in that case. An `Edit` whose `structuredPatch` is absent shows the file path with **no** hunk
  counts, never `0 added / 0 removed`.

---

## 4. Incremental transcript reads (`(mtime,size)` key + byte-range)

**Customer need** — First load of Forensics after a long Claude session takes seconds and the tab
janks. `/api/forensics` (`server/index.mjs:2940`) calls `failStats()` **and** `scanTranscripts()`,
each of which walks the entire `~/.claude/projects` tree and calls
`fs.readFileSync(f, 'utf8').split('\n')` on every file whose `(mtime,size)` changed
(`:1832`, `:2324`). On this machine that tree is **454 MB across 1,278 files**. The pathology is
that a live session's transcript changes on *every turn*, so the file you care about most is the one
that gets fully re-read most often — a 6.9 MB transcript re-parsed from byte 0 to answer a question
about the 400 bytes that were just appended. Today people click refresh and wait, or they see the
`cached · 12m old` chip (`src/App.jsx:427`) and accept stale numbers because refreshing is slow.

**Value to Loush** — This is what lets us keep our actual thesis. `_SYNTHESIS.md:410` puts it
precisely: their numbers come from a derived SQLite store that can be confidently wrong; ours are
recomputed from files on every read. The transcript cache is *how you get their speed without
adopting their store*, and Tier 3.5 explicitly warns against becoming stateful. It also removes the
main argument anyone will make for adding a database. Touches every section that reads transcripts:
Overview, Sessions, Forensics, Working Set, Usage, Insights, Context Explorer.

**How the upstream repo does it today** — `server/lib/transcript-cache.js` (793 lines). The cache
skeleton, which is the part worth taking:
- Key on `(mtimeMs, size)`, exactly as our five caches already do
  (`server/index.mjs:110, 656, 799, 1174, 1806, 2298, 4599`).
- **On growth** (same file, larger size, later mtime) read only `[bytesRead, size)` in fixed chunks,
  splitting on `0x0A`, and carry the partial trailing line into the next read.
- **Truncation** (size shrank) → full re-read. **Same size, different mtime** → full re-read; this
  is the compaction-rewrite case and it is the one everybody gets wrong, because a naive
  size-only check reports "unchanged" on a file that was rewritten in place.
- **64 MB hard cap on a single line** so one pathological record cannot exhaust memory.
- **LRU-bounded at 200 entries**, and the accumulated arrays inside each entry are tail-capped with
  a 2× watermark so a long-lived session cannot grow an unbounded array of events.
- Known limit their author accepted: past 200 entries you thrash back to full reads
  (`claude-code-agent-monitor.md:362`).

**How we implement it here** — New `server/transcriptCache.mjs` exporting one function:

```js
// cb(line) is called once per complete JSON line, in file order, for NEW bytes only.
// Returns the caller's own accumulator record, or null if unchanged since last call.
readIncremental(file, { version, init, onLine })
```

- The three existing walkers keep their own record shapes and versioning (`rec.v`) and just swap
  their read loop: `collectUsage()` (`server/index.mjs:667-703`), `failStats()` (`:1816-1878`),
  `scanTranscripts()` (`:2312-2391`). Each already has a `v` bump convention — this is a `v` bump.
- **Non-negotiable constraint from our own code:** `failStats` and `scanTranscripts` accumulate
  *stateful* per-file structures across lines — `idName[c.tool_use_id]` (`:1846`), `lastErrTool`
  (`:1829`), `lastSkill` (`:2322`), `touched` (`:2320`). An incremental read must persist those in
  the cached record too, or resuming mid-file will drop every `tool_result` whose `tool_use` was in
  the already-read prefix. `collectUsage` is stateless per line and is the safe first target.
  **Ship `collectUsage` first, alone, and measure.**
- Bound each cache: an LRU cap (upstream uses 200; with 1,278 files ours should be higher — measure)
  and tail caps on the arrays that already have ad-hoc caps
  (`rec.errs.length < 400` at `:1872`, `rec.hookEvents.length < 800` at `:2349`,
  `rec.edits.length < 400` at `:2362`). Those caps become part of the cache contract instead of
  scattered magic numbers.
- No API change, no client change, no `App.jsx` change. Purely a swap under existing endpoints.

**Effort** — **M.** The cache module itself is maybe 120 lines. The work is the three call sites,
the per-file resume state above, and proving output is byte-identical before and after. It is
mechanical but it must not be rushed: this code produces every number in the app.

**Risks and unknowns**
- **The resume-state problem is the real risk** and is the reason this is M and not S. Get it wrong
  and error counts silently drop. Mitigation: a `--verify` script that runs both paths over the real
  corpus and diffs the aggregates. Build the harness before the optimisation.
- Windows `mtimeMs` resolution: two writes inside the same tick can produce identical `(mtime,size)`.
  Our current code has this bug too, so it is not a regression, but incremental reads make the
  consequence worse (stale tail instead of stale whole file). Consider also comparing a cheap
  content hash of the last 512 bytes.
- The transcript format is undocumented and Anthropic states it changes (`_SYNTHESIS.md:100-101`).
  Chunked line splitting must never throw on a malformed line — match upstream's
  `stream-json-parser.js` discipline: report and skip, never throw.
- Actual speedup is **unverified**. Upstream claims ~50× and the research file explicitly flags that
  as an unbenchmarked claim (`claude-code-agent-monitor.md:57`). Do not repeat their number
  (`_SYNTHESIS.md:180`); measure ours and publish the denominator.

**Definition of done**
- A verification script proves `collectUsage()` output is **identical** (deep-equal) between full-read
  and incremental paths over the whole 1,278-file corpus.
- Wall-clock for a warm `/api/forensics?fresh=1` after one new turn in an active session is recorded
  before and after, in the commit message, with the corpus size stated as the denominator.
- Truncating a transcript, and rewriting one in place at the same size, both trigger a full re-read
  and produce correct output (two explicit tests).
- Memory: the cache is bounded; a 30-minute soak reading a growing transcript does not grow RSS
  without limit.
- **Empty/null state:** an unreadable or mid-write transcript yields a record with the fields it
  could not compute set to **`null`**, and the endpoints that consume it keep rendering `—`, not
  `0`. A file that produced zero usable lines must be distinguishable from a file with zero tokens.

---

## 5. One live event bus for the client (over SSE)

> **Deviation from Tier 2.4, stated up front:** the synthesis says "WebSocket + eventBus". I am
> taking the eventBus and the entire client reconnect discipline, over our existing SSE transport,
> and adding no dependency. Reasoning is in the header of this document. If the maintainer wants
> WebSocket specifically, the `eventBus` interface below is the seam that makes it a swap.

**Customer need** — Two concrete versions. (a) You leave the dashboard open on a second monitor
while Claude works. Nothing moves. Overview, Sessions and Working Set are all TTL-cached
(`server/index.mjs:102-109` — 300s, 120s, 600s) and the topbar chip tells you the number you are
reading is `cached · 9m old` (`src/App.jsx:427`); to see the current state you click refresh and
wait for the walkers. (b) The Inbox badge polls every 60 s (`src/App.jsx:376`) and the sidebar
harness strip polls every 20 s (`:247`), so we already pay for polling — badly, on a fixed timer
that fires whether or not anything changed. What people do today: they alt-tab to the terminal,
which is the thing the dashboard is supposed to replace.

**Value to Loush** — It is the prerequisite for Feature 7 (there is no point receiving hook events
if nothing can push them to the browser), and it retires two polling loops on its own. It also fixes
a real bug class we will otherwise ship: `src/App.jsx:333-338`'s `refresh()` bumps `tick`, which is
in the section key at `:442`, so **every section remounts on refresh** — any component that owns its
own `EventSource` gets torn down mid-stream. `server/ticket.mjs:308-310` documents having hit
exactly this and worked around it with replay-then-live SSE. A module-level bus outside React's
lifecycle is the general fix.

**How the upstream repo does it today** — `client/src/lib/eventBus.ts` (147 lines) and
`client/src/hooks/useWebSocket.ts` (201 lines). The value is entirely in the footguns already
handled:
- `eventBus` is a **module-level singleton** — a `Set<Handler>` with synchronous in-order dispatch,
  consumed through `useSyncExternalStore`. Being module-level is what makes it survive remounts.
- **Duplicate-socket guard** for React 18 StrictMode's double-mount in dev. Without it you open two
  connections and process every event twice. The research file rates this alone as saving a day.
- **Handler kept in a ref**, so a reconnect never calls a stale closure over old props.
- **Capped exponential backoff** `min(500 · 2^n, 3000)`.
- **Instant reconnect on `focus` / `online` / `visibilitychange`** — the thing that makes it feel
  alive when you come back to the tab, rather than waiting out a backoff.
- **Handlers nulled before `close()`** so teardown cannot fire a final spurious event.
- Server side they pair it with 64 KB max payload, a 30 s ping/pong heartbeat that `terminate()`s a
  dead peer, and Host+token checks **inside the upgrade handler** because Express middleware does
  not run there.
- Their client also keeps polling as a belt-and-braces safety net and **dedupes optimistic pushes by
  event id** to survive the push-vs-poll race. Copy the dedupe; it is cheap and it is the bug.

**How we implement it here**
- New `src/lib/eventBus.js`: `subscribe(fn)`, `publish(ev)`, `getSnapshot()`, plus
  `useBusEvents(filterFn)` built on `useSyncExternalStore`. Zero deps, ~90 lines.
- New `src/lib/liveStream.js`: one module-level `EventSource` to a new
  `GET /api/live` (see below), owning the reconnect discipline listed above — StrictMode guard,
  capped backoff, `focus`/`online`/`visibilitychange` reconnect, handlers nulled before `close()`,
  dedupe by `ev.id`. `EventSource` auto-reconnects natively, which handles part of this, but its
  retry is uncapped-server-controlled and it does not reconnect eagerly on focus, so the wrapper
  still earns its place.
- New route `GET /api/live` in `server/index.mjs`, modelled on the existing SSE writer at `:944-952`
  (`text/event-stream`, `cache-control: no-cache`, an immediate `: connected` comment to flush
  headers, listener `Set`, `req.on('close')` cleanup). Payload envelope:
  `{ id, t, kind: 'session'|'inbox'|'harness'|'hook', ... }`. Heartbeat: a `:ping` comment every
  30 s, matching upstream's interval and keeping proxies from idling the connection out.
  Must accept `?token=` (Feature 1).
- v1 emitters, no new data sources: (a) `respCache.clear()` at `server/index.mjs:112` already fires
  on **every** write — publish a `{kind:'invalidate'}` there and the client can drop its own
  section state instead of showing stale numbers; (b) the inbox poll at `src/App.jsx:344-381` moves
  server-side and pushes `{kind:'inbox', open}`.
- `src/App.jsx`: start the stream once at app level (near the existing `useEffect` at `:299`), and
  replace the 60 s inbox `setInterval` (`:376`) and the 20 s `SidebarFoot` interval (`:246`) with
  bus subscriptions. **No nav change** — this is infrastructure, not a section.

**Effort** — **S/M.** The bus and the wrapper are ~200 lines of well-understood code. The route is a
copy of an existing one. The M part is being disciplined about *not* rewiring every section at once:
v1 is the transport plus two subscribers, and everything else keeps working exactly as it does now.

**Risks and unknowns**
- Vite dev proxy already carries SSE for `/api/chat/:id/events` in production use, so the transport
  is proven here — but `/api/live` is long-lived and idle, unlike a chat stream, so the heartbeat
  needs verifying through the proxy specifically.
- SSE over HTTP/1.1 is subject to the 6-connections-per-origin limit. We already open one per active
  chat and one per ticket design run; adding a permanent third is fine, but this caps how far we can
  take "an EventSource per feature" and argues for exactly one shared stream. Enforce that.
- `respCache.clear()` runs on every non-GET (`:112`) including trivial ones; publishing an
  invalidate on each could produce a chatty stream. Debounce.
- If Feature 1 ships first, `EventSource` cannot send headers — the `?token=` path must exist or
  this route 401s with the token gate on. These two features are coupled; sequence them together.

**Definition of done**
- Exactly **one** `EventSource` to `/api/live` exists with the app open, verified in devtools
  Network, including under React StrictMode in dev.
- Killing the server and restarting it reconnects within one backoff cycle, and switching browser
  tabs away and back reconnects immediately rather than waiting out a backoff.
- Clicking topbar refresh (which remounts every section, `src/App.jsx:442`) does **not** tear down or
  duplicate the stream.
- The inbox badge updates without a 60 s wait, and `src/App.jsx`'s inbox `setInterval` is deleted,
  not merely disabled.
- **Empty/null state:** while the stream is disconnected, anything driven by it renders its
  **last known value with a visible "disconnected" marker**, or `—` if it never had one. It must
  never render `0` for "we have no connection", and the inbox badge must **disappear** rather than
  show `0` when the count is unknown.

---

## 6. Chart-shaped skeletons and null-safe chart axes

**Customer need** — Our loading story is one shared `Skeleton` (`src/ui/Skeleton.jsx`) — a row of
grey tiles plus grey bars — used behind Sessions (`SessionsSection.jsx:78`), Forensics and Hooks.
For a table that is fine. For the chart-heavy panels (`UsagePanel`, `InsightsSection`, `FlowSection`,
`src/ui/charts.jsx`) the page reflows when real content arrives, and — the part that actually
matters — a chart whose data has not loaded is at risk of rendering as a *drawn chart with a flat
line at zero*, which a person reads as "I used nothing this week." That is the exact failure our
honesty rules exist to prevent, and we enforce it rigorously on the server
(`server/fe.mjs:461`, `server/fe.mjs:174`, `server/eng.mjs:307`, `server/ticket.mjs:1104` all
document null-not-zero) while the client has no equivalent rule for charts.

**Value to Loush** — The synthesis' §7 overlap table records that CCAM **independently converged on
our honesty rule** and then extended it one step further than we have — from values to chart shapes
— and calls it "worth matching". This is the cheapest possible way to close a gap in our own stated
principle, and it is a principle we advertise.

**How the upstream repo does it today** — `client/src/components/Skeleton.tsx` (170 lines) exports
five variants: `Skeleton`, `StatValueSkeleton`, `TextSkeleton`, `TableRowSkeleton`, `CardSkeleton`.
`Analytics.tsx` adds `ChartCardSkeleton` / `AnalyticsChartsSkeleton` — skeletons shaped like the
chart that is coming, so the layout does not jump and the reader is never shown an axis.
The file carries a **stated policy in a comment**: never flash a `-` or `0` a user could misread as
data. Separately, "charts never render an axis with no data"
(`claude-code-agent-monitor.md:181`) — the empty state replaces the chart entirely rather than
drawing an empty one. `animate-pulse` honours `prefers-reduced-motion` natively; our CSS must do
this explicitly.

**How we implement it here**
- Extend `src/ui/Skeleton.jsx` with named exports `ChartSkeleton({height, bars})`,
  `StatValueSkeleton` and `TableRowSkeleton`. Default export stays as-is so no existing call site
  changes.
- Add `EmptyChart({title, reason})` to `src/ui/charts.jsx` — renders the panel chrome and a sentence
  saying what is missing, and **no axes**. Every chart component gains an early return for
  `data == null` (unknown → `EmptyChart`) that is distinct from `data.length === 0`
  (known-and-empty → "no activity in this window", which *is* a fact).
- Consumers: `UsagePanel`, `InsightsSection`, `FlowSection`, and Overview's tiles.
- Add `@media (prefers-reduced-motion: reduce) { .skel { animation: none } }` to `src/styles.css`.
- Put the policy in a comment at the top of `src/ui/Skeleton.jsx`, in our own words, the way
  `server/fe.mjs:461` does. The comment is load-bearing — it is what makes the next person keep it.
- No server change, no route, no `App.jsx` nav change.

**Effort** — **S.** ~150 lines of presentational code, no data model, no server. It is a wide but
shallow change: the count of chart call sites is the only cost.

**Risks and unknowns**
- Requires auditing every chart for whether it currently distinguishes `null` from `[]`. Some
  probably do not, and fixing that is where the change stops being purely cosmetic. Budget for it.
- Sizing skeletons to match real charts means duplicating a height constant; put it in one place or
  the layout jump comes back the first time a chart is resized.

**Definition of done**
- No chart in the app renders axes, gridlines or a zero-line while its data is `null`.
- Throttling the network to slow-3G and loading Usage/Insights shows chart-shaped placeholders that
  do not reflow when data arrives (visually verified, before/after screenshots in the PR).
- `prefers-reduced-motion: reduce` stops the shimmer.
- **Empty/null state:** three states are visually distinct and no two are conflated —
  **loading** (skeleton), **unknown/unavailable** (`EmptyChart` with a reason sentence, mirroring
  `server/fe.mjs:445-451`'s `{available:false, reason, detail}` shape), and **known-zero**
  ("no activity in this window", which may legitimately draw an empty range). A `0` may only appear
  where zero was measured.

---

## 7. Hook receiver for mid-turn state

**Customer need** — Everything this dashboard knows is **already over**. Transcripts are written as
turns complete, so a session that has been thinking for 90 seconds, or one that is *blocked waiting
for you to answer a permission prompt*, is indistinguishable from one that finished. Our only
liveness signal is `ACTIVE_MS = 5 * 60_000` — a binary "transcript touched in the last 5 minutes"
(`server/index.mjs:798`, used at `:836`). So: you kick off three sessions across three repos, go
make coffee, come back, and cannot tell which one is working, which is stuck on a prompt, and which
died twenty minutes ago. You alt-tab through three terminals. `_SYNTHESIS.md:196-198` names
"this session is blocked waiting on you" as the single most actionable signal in the whole survey,
identified independently by two projects, and records that we cannot express it.

**Value to Loush** — It is the only route to true mid-turn state (`_SYNTHESIS.md:334`), and it is
the one capability gap where the research says upstream beats us "decisively"
(`claude-code-agent-monitor.md:375`). It would justify a new `LiveSection` — which
`_SYNTHESIS.md:302` (Tier 1.1) already anticipates — and it feeds the "why waiting" chip that the
research calls the best small UX idea in the whole upstream repo. It is also the one feature here
that requires the user to install something, which is why it is **last** despite high value: our
zero-setup, retrospective collection is a stated differentiator (`_SYNTHESIS.md:123`) and this must
be strictly additive to it, never a precondition.

**How the upstream repo does it today**
- `scripts/hook-handler.js` (112 lines) — reads the hook JSON on stdin, POSTs it, and **exits
  without awaiting the response**. This is the whole trick and the reason it is safe: Claude Code
  runs hooks synchronously and blocks the turn on them, so a hook that waits on a dead HTTP server
  makes Claude Code visibly hang. Their handler also fans out to *every* live dashboard discovered
  via a port-discovery file, dedupes by data-dir, and fails silently. The research file calls this
  "the single most reusable idea in the repo" (`claude-code-agent-monitor.md:55`).
- `server/lib/server-info.js` publishes the live port to `~/.claude/.agent-dashboard.json` with a
  PID liveness check, so the handler finds a server on a non-default port.
- `scripts/install-hooks.js` (179 lines) idempotently writes 8 hook entries into
  `~/.claude/settings.json` with an absolute handler path, and **refuses to install from inside a
  container onto a bind-mounted host `~/.claude`** (their issue #193).
- `POST /api/hooks/event` in `server/routes/hooks.js` is the single write path for all 8 hook types.
- `WAITING_INPUT_PATTERN` (`server/routes/hooks.js:36`) regexes the `Notification` payload to
  separate "blocked on you" from "finished responding", persisting an `awaiting_reason` — which is
  what `StatusBadge.tsx` renders as the "why waiting" chip.
- **Escape-cancelled turns and Ctrl-C'd sessions emit no terminating hook**, so a naive receiver
  leaves sessions "active" forever. Their answer is `watchdogCheck()` on a 15 s timer plus a
  `ps`/`lsof` liveness probe (`server/lib/session-liveness.js`) that is **fail-safe**: on Windows,
  in containers, or with the binaries missing it returns `available: false` and *the caller changes
  nothing*. That discipline is our null-not-zero rule applied to process state, and it is the part
  to copy verbatim. Note their Windows probe does not exist at all — ours would have to be written
  (`claude-code-agent-monitor.md:357`), and we are a Windows-primary shop.

**How we implement it here** — We already have most of the scaffolding, which is why this is M and
not L.

- **Handler:** new `scripts/hook-handler.mjs`. Read stdin to end, `POST` to
  `http://127.0.0.1:${port}/api/hooks/event`, **do not await**, `process.exit(0)` immediately.
  Always exit 0, no matter what — same discipline as upstream's statusline
  (`claude-code-agent-monitor.md:317`). A hook that can fail a turn is worse than no hook.
- **Port discovery:** write `~/.claude/.loush-dashboard.json` `{port, pid, startedAt}` at
  `server/index.mjs:4771` and unlink on exit. Handler reads it; if the PID is dead, it does nothing.
- **Receiver:** new `server/hooks-receive.mjs` mounted alongside the existing mounts at
  `server/index.mjs:53-61`, exposing `POST /api/hooks/event` and `GET /api/live/sessions`. State is
  an **in-memory `Map`, deliberately not persisted** — the durable record stays the transcripts, per
  `_SYNTHESIS.md:336`'s warning about becoming stateful. On restart we lose live state and fall back
  to transcripts, which is the honest degradation.
- **Install UX:** extend the existing `HOOK_LIBRARY` (`server/index.mjs:3669-3682`) with a
  `dashboard-live` entry whose command is `node <abs>/scripts/hook-handler.mjs`, and let the
  existing `POST /api/hooks/install` (`:3693`) write it. That path **already** routes global writes
  through `propose()` and project writes through `track()`, so we inherit our backup and audit
  convention for free, and the user sees it in `HooksSection`'s Library tab
  (`src/sections/HooksSection.jsx:21`). This is strictly better than porting upstream's installer.
  **Note:** `PUT /api/hooks` at `:339` bypasses `track()` — that is defect D4 in
  `_SYNTHESIS.md:34` and should be fixed before we add another hook-writing path.
- **UI:** a `Live` tab at the top of the Harness hub (`src/App.jsx:160-174`), showing one row per
  live session with a status and an `awaiting_reason` chip. Subscribes to Feature 5's bus. No new
  top-level nav entry — Harness already exists and this belongs with Sessions.
- **Liveness reconciliation, Windows-first:** a sweep that marks a session `unknown` (not
  `completed`, not `active`) when hooks stop arriving without a `Stop`. Port upstream's fail-safe
  contract exactly — if the probe cannot answer, `available: false` and **change nothing**. Windows
  needs its own probe (`tasklist`/`Get-CimInstance Win32_Process`); until it exists, the probe
  reports `available: false` and we show `unknown`, never `completed`.

**Effort** — **M.** The handler is ~60 lines and the receiver ~250. The real cost is the state
machine (`waiting ↔ working ↔ error`, plus `completed`/`abandoned`/`unknown`), the missing-terminator
problem, and a Windows liveness probe that upstream never wrote. Gated on Feature 5.

**Risks and unknowns**
- **Cannot regress the zero-setup story.** Every section must behave exactly as today with no hook
  installed. The Live tab must present as an *optional upgrade*, never as a broken screen.
- Hook latency is a real user-visible cost. `HooksSection`'s own dry-run
  (`server/index.mjs:3640`) exists precisely to measure this — measure our handler with it and
  publish the number before recommending installation.
- Escape-cancelled and Ctrl-C'd sessions emit no terminator. Without the reconciliation sweep, the
  Live tab will confidently show stale "working" sessions — which is worse than showing nothing.
  **The sweep is not optional; it ships in the same commit.**
- Writing to `~/.claude/settings.json` races the live CLI, which reads it. Upstream's answer is a
  container guard plus idempotent writes; we already back up (`backup()` at `server/index.mjs:131`)
  and gate global writes through `propose()`. Verify Claude Code tolerates a settings rewrite
  mid-session.
- Two dashboards on two ports both installing hooks: our discovery file is single-slot where
  upstream's fans out. Single-slot with last-writer-wins is acceptable for v1 but must be stated,
  not discovered.

**Definition of done**
- With no hook installed, every existing screen renders identically to today, and the Live tab shows
  an explicit "hook not installed" state with a one-click install button — **not** an empty table,
  and **not** a `0 live sessions` counter.
- With the hook installed, starting a Claude session makes a row appear in the Live tab within 2
  seconds without a manual refresh.
- Answering a permission prompt flips the row's `awaiting_reason` chip from "needs input" to working.
- `POST /api/hooks/event` returns before doing any work, and a `node scripts/hook-handler.mjs`
  invocation against a **stopped** server exits 0 in under 100 ms.
- Killing a session with Ctrl-C moves its row to `unknown` (with an explanatory tooltip) within one
  sweep interval — **never** to `completed`, which we did not observe.
- **Empty/null state:** `awaiting_reason` is `null` when we have no `Notification` to derive it from,
  and the UI renders **no chip**, not "unknown reason" and not "ready". Where the liveness probe is
  unavailable (Windows without a probe, containers), the row shows `liveness: unavailable` and the
  session status is **left unchanged** — the probe's inability to answer is never rendered as a
  negative answer.

---

## Not worth taking

- **`MarkdownContent.tsx` as an XSS fix** (research #13, `:303`). Its premise — that we render
  transcript content through `marked` into `innerHTML` — does not hold: I found no
  `dangerouslySetInnerHTML` in any transcript-rendering path. We build React element trees already.
  Porting a 514-line renderer to fix a bug we do not have is negative value. **`tuiSegments.ts`
  (191 lines) is a different matter** — parsing Claude's TUI tag markup and stripping leaked ANSI
  escapes is a real problem we plausibly have; it is small and separable and worth revisiting on its
  own if anyone actually sees ANSI leakage in Chat or Forensics.
- **`highlight.ts`** (1,088-line from-scratch syntax highlighter, research #5). We already ship
  CodeMirror with four language modes (`package.json`) and use it in `HooksSection` and elsewhere.
  Adding a second, worse, read-only highlighter to avoid a dependency we already pay for is backwards.
- **SQLite / any derived store.** Upstream's own research entry rejects it for us
  (`claude-code-agent-monitor.md:487`) and `_SYNTHESIS.md:336` (Tier 3.5) flags it as a stateful-ness
  decision. Our numbers are recomputed from files on every read; that is the thesis
  (`_SYNTHESIS.md:410`). Feature 4 is how we get the speed without the store.
- **Prometheus + Grafana** (25 files, two install paths). Conflicts with local-first / zero-telemetry
  and adds an ops surface for a single-user tool.
- **Electron desktop app, VS Code extension, `ccam` CLI, MCP server, the 10-plugin marketplace,
  i18n (60 JSON files, 4 locales).** All distribution surface with no demand signal. The research
  file itself calls the plugin marketplace "breadth-as-marketing" (`:66`).
- **The 11k-line hand-maintained OpenAPI spec.** `claude-code-agent-monitor.md:352` — maintained
  separately from the routes and guaranteed to drift. Their own repo already shows three different
  tool counts in three places (`:350`).
- **`remote-sync.js` (SSH multi-machine)** and **`workflow-ingest.js`**. Both rated Hard, both
  ~800–1,100 lines, and both coupled to infrastructure and on-disk layouts we do not have. Revisit
  only if multi-machine becomes a real request.
- **Webhook registry + alerts engine** (research #10, #11). Genuinely good design — the declarative
  provider registry means adding a provider is a data change with no UI work — but they are
  `M`/`M/L` and land in `InboxSection`/`ReliabilitySection`, which is a product decision about
  whether Inbox becomes active rather than passive. Out of scope for this spec; not rejected.
- **The Tabby mascot.** The pure-reducer + injected-`rand` testability pattern
  (`claude-code-agent-monitor.md:315`) is genuinely worth internalising. The cat is a product
  decision nobody has asked for.
- **Any performance number from upstream.** Their "~50× speedup" is explicitly flagged as an
  unverified benchmark (`:57`), and `_SYNTHESIS.md:164-180` documents that every checkable headline
  claim in this survey failed. Do not restate it in our UI, docs, or commit messages.

## Open questions for the maintainer

1. **Is subagent `usage` already reflected in the parent transcript?** This gates Feature 2's
   roll-up: if there is overlap, rolling up inflates instead of correcting. I could not settle it by
   reading and did not want to guess. It needs one session measured end to end.
2. **Do `structuredPatch[].lines` include the `@@ … @@` hunk header?** If not,
   `firstEnclosingContext()` (the most valuable single function in Feature 3) needs a source lookup
   instead of a header parse, which changes that feature from S to M.
3. **WebSocket or SSE?** I chose SSE and stated why. If the intent behind Tier 2.4 was specifically
   `ws` — for bidirectional traffic later, or to match upstream exactly — say so now, before the
   `eventBus` interface calcifies.
4. **Does the token gate need to work at all, or is loopback enough?** Feature 1 ships the gate
   opt-in and off by default. If nobody will ever set `DASH_TOKEN`, the SSE `?token=` plumbing and
   the client header handling are dead weight and should be dropped, leaving bind + Host allowlist.
5. **How far does "zero setup" bind us?** Feature 7 requires installing a hook. I have specced it as
   strictly additive with a full transcript-only fallback, but if installing anything is off the
   table on principle, Feature 7 should be cut rather than built and hidden.
6. **What is the acceptable cold-start budget for `/api/forensics`?** Feature 4's effort is
   proportional to how much of the walker set we convert. Converting `collectUsage` alone is
   materially cheaper than converting `failStats` and `scanTranscripts`, which carry per-file resume
   state. A target number would let us stop at the cheap one.
7. **Should `PUT /api/hooks` (`server/index.mjs:339`) be routed through `track()` before Feature 7
   adds another hook-writing path?** That is defect D4 (`_SYNTHESIS.md:34`), owned by the Tier 0
   corrections, not by this spec — but Feature 7 makes it worse, so sequencing matters.
