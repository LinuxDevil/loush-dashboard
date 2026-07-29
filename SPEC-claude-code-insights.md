# SPEC — adoptions from `claude-code-insights` (yahav10/claude-code-dashboard)

> Implementation spec derived from `claude-code-insights.md` (upstream research) and `_SYNTHESIS.md`
> (cross-project rulings), grounded against this repo at `de03dd5`.
> Upstream is MIT, single author, dormant since 2026-03-06. **This is code-mining, not a dependency** —
> their stack (Vue 3 + Pinia + ECharts + Fastify + better-sqlite3) is entirely disjoint from ours
> (React 18 + d3 + Express + plain ESM, no TypeScript). Vendor what we take; do not track upstream.
> Every ported file must carry a header recording the author's permission and the MIT license
> (`_SYNTHESIS.md` §9).

**What I read in this repo before writing this.** `server/index.mjs` (4,777 lines — the three transcript
walkers at `:657`, `:1807`, `:2299`, the pricing at `:718`/`:1987`, the chat driver at `:866`–`:1024`,
the response cache at `:110`–`:121`, the safety jail at `:124`–`:130`), `server/setup.mjs` (372 lines),
`src/App.jsx` (497 lines, `BASE_SECTIONS` at `:50`), `src/sections/ChatSection.jsx` (440 lines),
`src/sections/HarnessSection.jsx` (466 lines), `README.md` §Honesty rules, `package.json`, `test/`.

**Three discrepancies between the research file and our code, resolved in favour of the code:**

1. The research (`claude-code-insights.md:394`) says *"We claim zero telemetry; they enforce it"* and
   recommends a network guard as a straight win. **Our code makes deliberate outbound calls**:
   JIRA (`server/eng.mjs:220,242,257,1510,1589`; `server/setup.mjs:335`), Slack webhooks
   (`server/index.mjs:3428,3442`), MCP server probes to user-configured URLs (`server/index.mjs:292`),
   an arbitrary user-supplied URL fetch (`server/index.mjs:2278`), Figma (`server/figma-capture.mjs:124`)
   and Storybook (`scripts/refresh-design-catalog.mjs:136,139`). A blanket localhost-only guard would
   break Delivery, Ticket, Setup, MCP and Company Tools on the first request. Feature 2 below is
   therefore an **allowlist-and-audit** guard, not a block-everything guard.
2. The research recommends porting tool-name enrichment (`Skill` → `Skill(name)`) as adoption #11.
   **We already do better**: `scanTranscripts()` at `server/index.mjs:2378-2380` emits structured
   `{kind:'skill'|'agent'|'mcp', name}` invocation records at parse time. Dropped — see *Not worth taking*.
3. The research says our `PRICE_PER_M` overstates Opus by 3×. Confirmed at `server/index.mjs:718`
   (`/opus|fable/ → 15`) and `:1987`. But `_SYNTHESIS.md` §8 assigns that fix to **Tier 0.2** with
   phuryn's exact table as the source, ahead of all feature work. It is not specced here — see
   *Not worth taking* — to avoid two agents shipping two pricing tables.

Features are ordered by value ÷ effort, highest first.

---

### 1. PII redaction as a shared, opt-in-by-caller utility

**Customer need** — Ali runs the dashboard on a shared screen: a demo, a pairing session, a recorded
walkthrough (`docs/screenshots/showcase.mp4` is committed to this repo and was filmed against real
transcripts). Search (`/api/search`, `server/index.mjs:2573`) returns 60-to-220-character snippets
of **raw prompt text, raw assistant text, raw bash commands and raw diff hunks** — `snip()` at `:2586`
slices the stored string and hands it straight to the client. Forensics (`:2940`) surfaces the first
240 characters of tool error text verbatim (`rec.errs` at `:1872`). If a session ever contained
`export ANTHROPIC_API_KEY=sk-ant-…`, `psql postgres://user:pass@host`, or a customer's email address,
those characters are already sitting in `~/.claude/projects/**/*.jsonl` and this app renders them.
Today the workaround is "don't demo Search", which is the same as not having the feature.

**Value to Loush** — This is the missing precondition for three things we already want: (a) the
showcase/tour scripts (`scripts/showcase.mjs`, `scripts/shots.mjs`) can be run against a real install
without a manual pre-flight scrub; (b) the anonymised export in feature 4 needs a redactor before it
can be honest; (c) it lets the README make a claim it currently cannot — that the dashboard will not
splash a credential across the screen. It plugs into `SessionsSection`, `ForensicsSection`, the Search
results in `Palette`/`Hub`, and `ChatSection`'s SSE stream. We have **no redaction anywhere today**;
`_SYNTHESIS.md` ranks this Tier 1.6.

**How the upstream repo does it today** — `apps/server/src/middleware/pii-detector.ts`, ~60 lines,
zero imports, 14 tests. Nine named regex patterns (`api_key`, `openai_key`, `anthropic_key`, `email`,
`ipv4`, `aws_key`, `jwt`, `private_key`, `password_assignment` per the research inventory). `detectPII(text)`
returns `{found, matches: [{type, start, end, value}]}` — **offsets, not a redacted string**. `redactPII`
then walks the match list **right-to-left** (descending `start`) and splices each replacement in, so
every earlier match's offsets stay valid even though the replacement token `[REDACTED:<type>]` has a
different length than the matched text. Left-to-right replacement is the bug almost every hand-rolled
redactor ships; this is the one non-obvious correctness detail in the file, and it is why the upstream
tests are worth reading before writing ours.

Two gotchas their author hit and did not fix (`claude-code-insights.md:357,364`):
- Their `api_key` pattern `(?:sk-|pk-|rk-|ak-)[a-zA-Z0-9]{20,}` **overlaps** `openai_key` and
  `anthropic_key`, so a single Anthropic key produces two overlapping matches; right-to-left splicing
  then nests one replacement inside the other and produces garbage like `[REDACTED:[REDACTED:api_key]]`.
- They wire the redactor into a Fastify `onSend` hook (`middleware/privacy.ts`) that JSON-parses,
  deep-walks and re-stringifies **every** API response body. With `ipv4` and `email` always on, code
  snippets, version strings and log lines containing dotted quads get mangled, and it is the hot path
  on large session-detail payloads.

**How we implement it here** — New `lib/pii.mjs`, pure ESM, zero dependencies, exporting
`detectPII(text, opts)` and `redactPII(text, opts)` where `opts = { patterns: ['api_key', …] }`.
Ported design, ported right-to-left splice; **two corrections to their version**:
- Resolve overlaps before splicing: sort matches by `start` ascending then `end` descending, drop any
  match fully contained in its predecessor, then reverse and splice. This kills the nesting bug.
- Split patterns into `CREDENTIAL_PATTERNS` (default-on: `anthropic_key`, `openai_key`, `aws_key`,
  `jwt`, `private_key`, `password_assignment`, generic `sk-`/`pk-` keys) and `IDENTITY_PATTERNS`
  (default-**off**: `email`, `ipv4`). The over-redaction the upstream author shipped is exactly the
  kind of silent data corruption our honesty rules forbid, and a mangled bash command is a wrong
  answer, not a safe one.

Call sites — **not** a global response hook. Express has no `onSend`, and wrapping `res.json` globally
would collide with the TTL response cache at `server/index.mjs:111-121`, which already monkey-patches
`res.json` and stores the **post-patch** body. Redact at the point of extraction instead, so the cached
value is the redacted value:
- `server/index.mjs:2586` — `snip()` in `/api/search`, wrap the returned snippet.
- `server/index.mjs:1872` — `rec.errs.push({… text: …})` in `failStats()`, redact before storing.
  Note this is inside the mtime-keyed `failCache`, so bump the cache version `v: 3` → `v: 4` or stale
  entries survive the change unredacted.
- `server/index.mjs:2362,2367,2370,2376` — the `edits`/`prompts`/`texts`/`cmds` pushes in
  `scanTranscripts()`; same cache-version bump on `v: 3` at `:2316`.
- `server/index.mjs:3065` — `firstUserPrompt()` for the Context Explorer header.
- `server/index.mjs:885` — `readTranscript()`, feeding `historyEvents()` → `ChatSection`'s replay.
  **Live** chat output (`chatBroadcast` at `:871`) is deliberately left alone by default: the user is
  looking at their own live session and truncating it would break tool arguments.

Client: a single toggle in `CustomizeSection` writing `meta.redaction = {credentials: true, identity: false}`
through the existing `readMeta`/`META_FILE` path (`server/index.mjs:556`), read server-side per request.
No new nav entry, no `App.jsx` change.

Tests: `test/lib/pii.test.mjs` under the existing `node --test` runner. Port the 14 upstream cases,
add three of our own — the overlapping-key nesting case, an offset-validity case (two matches where
the first replacement is longer than the match), and a "code snippet with a dotted quad survives
untouched with identity patterns off" case.

**Effort** — **S.** The module is ~80 lines and pure. The real work is the six call sites and the two
cache-version bumps, all mechanical. No new dependency: it is regex over strings.

**Risks and unknowns**
- The cache-version bumps force a full re-parse of every transcript on next boot. On a large
  `~/.claude/projects` that is a visible one-off cold start. Acceptable, but must be called out in the
  commit message.
- False positives are a correctness risk in the opposite direction from a leak: a redacted bash command
  in Search is a *wrong search result*. Mitigation is the default-off identity patterns plus a per-hit
  UI affordance (below).
- **Must verify first:** that the response cache (`respCache`, `:110`) cannot serve a body captured
  before the toggle flipped. It clears on any non-GET (`:112`), and the toggle write is a PUT, so this
  should already hold — confirm rather than assume.
- Unverified: whether any of our transcripts actually contain credentials. Do not claim a leak was
  found; claim the class of leak is now closed.

**Definition of done**
- `lib/pii.mjs` exports `detectPII` and `redactPII`; `node --test` passes with ≥17 cases including the
  overlap and offset-validity cases.
- With credential redaction on, a transcript line containing `sk-ant-api03-XXXX…` renders as
  `[REDACTED:anthropic_key]` in Search, Forensics and the Context Explorer header.
- With identity patterns off (the default), a bash command containing `127.0.0.1` and a diff hunk
  containing an email address render **byte-identical** to today.
- A redacted snippet is visually marked (a `dim` `[REDACTED:type]` token, not a silent deletion) — a
  hidden redaction is indistinguishable from missing data and would violate honesty rule 1.
- **Empty/null state:** if a search hit's snippet is *entirely* redacted, the row still renders with
  its session id, timestamp and file list, and the snippet slot reads `— (redacted)`. It is never
  dropped from the result set and never rendered as an empty string, because "this hit exists but you
  may not see it" and "there is no hit" are different facts.

---

### 2. Network egress guard — allowlist, audit, and an honest claim

**Customer need** — Ali's README says the zero-config half of the app needs "no network"
(`README.md:113`), and `_SYNTHESIS.md` §2 records that three unrelated upstream projects independently
pointed at our weak security posture. Today that claim is an assertion a reader has to take on faith
while the same process holds a JIRA API token (`.eng.local.json`, 0600, written by
`server/setup.mjs:127`) and can `fetch()` any URL a request body names (`server/index.mjs:2278`). The
person who hurts is the engineer who wants to run this at work and has to answer "does it phone home?"
to someone who will not accept "read the source". Today they read the source, or they don't run it.

**Value to Loush** — Converts a marketing sentence into an enforced, auditable invariant, and gives
`GovernanceSection` a panel that no surveyed project has: *every outbound connection this process made,
with its destination and whether it was expected*. That is a direct expression of our local-first thesis
and it is ~50 lines. `_SYNTHESIS.md` ranks this Tier 1.7. It also happens to be the cheapest possible
detector for a supply-chain incident: a transitive dependency that starts dialling out shows up in the
audit list the first time it tries.

**How the upstream repo does it today** — `apps/server/src/middleware/network-guard.ts`, imported as
the **first statement** of `apps/server/src/main.ts:1-2`, before any other import. It monkey-patches
`net.Socket.prototype.connect`, handling both call signatures (`connect(options[, cb])` and
`connect(port, host[, cb])`), checks the resolved host against a four-entry allowlist
(`127.0.0.1`, `localhost`, `::1`, `0.0.0.0`), and for anything else logs the attempt into an in-memory
audit array and destroys the socket. The import-order detail is the whole trick: any module that
captured a reference to `connect` before the patch is invisible to it, so the patch has to run before
the first `import`.

Their own claim does not survive their code (`claude-code-insights.md:62,361`): they ship an Agent
feature that calls the Anthropic API via the Claude Agent SDK, which reaches the network from a spawned
`claude` CLI **child process** — an in-process socket patch cannot intercept that. Their SECURITY.md
says "the network guard remains active during agent execution", which is true of the parent and false
of what a reader infers. **We must not repeat that framing.** The guard is also bypassable in-process
by `dns`, raw `http2`, `dgram`, and native addons; it raises the bar, it is not a sandbox.

**How we implement it here** — New `lib/network-guard.mjs`, and the **first line** of
`server/index.mjs`, above `import express from 'express'` at `:1`. Node hoists all `import`
declarations, so a top-level `import './lib/network-guard.mjs'` placed first is sufficient — but this
must be **verified empirically** (test below), not assumed, and the file needs a comment saying why
its position is load-bearing or the next tidy-up will reorder it.

Shape:
- `EXPECTED` is a set of host predicates, not a constant: loopback always; plus `cfg.jiraHost` and each
  configured project's `jiraHost` from `loadEngConfig(PROJECTS_FILE)`; plus `hooks.slack.com`; plus
  `api.github.com` (the `gh` CLI is a child process and unaffected, but our own code may grow a call);
  plus the host of each configured MCP server URL from `~/.claude.json`; plus, for the duration of one
  request only, the host of a user-typed URL passed to `/api/preview` (`:2278`) and the Figma/Storybook
  hosts when Company Tools is on. The predicate list is rebuilt when `respCache` is cleared by a write
  (`:112`), which is already the "config may have changed" signal.
- Default mode is **`audit`**, not `block`: record `{t, host, port, expected, stack}` in a capped ring
  buffer (500 entries) and let the connection proceed. `block` mode is opt-in via
  `meta.egress = 'block'`. Shipping block-by-default would turn a mis-derived allowlist into "Delivery
  is broken and no error explains why", which is a worse failure than the one we are preventing.
- New route `GET /api/gov/egress` → `{mode, allowlist: [...], attempts: [...], unexpected: N}`.
  Add to `HEAVY_TTL`? **No** — it is cheap and staleness would be actively misleading here.
- Client: a panel in `src/sections/GovernanceSection.jsx` (302 lines, already the home for approvals,
  failures and costs). No `App.jsx` change — Governance is already a tab inside the `harness` Hub
  (`src/App.jsx:167`).

**The claim we are allowed to make**, and the exact wording to put in the README: *"This process makes
no outbound connection except to hosts you configured — JIRA, Slack, your MCP servers — and it shows
you every attempt. The `claude` CLI we spawn for Chat, Quick Actions and Ticket is a separate process
that talks to Anthropic on your behalf; this guard does not and cannot cover it."* We spawn `claude`
in five places (`server/index.mjs:919, 1056, 1964, 3488, 3712`). Saying so plainly is the differentiator;
saying "zero outbound connections" is the upstream's mistake.

**Effort** — **S.** ~60 lines for the guard, ~20 for the route, ~40 for the panel. The allowlist
derivation is the only fiddly part.

**Risks and unknowns**
- **Must verify first:** that a top-level `import` at the head of `server/index.mjs` really does patch
  before `express`/`undici` capture `connect`. Write `test/lib/network-guard.test.mjs` that imports the
  guard, then imports something that dials out, then asserts the attempt was recorded. If it does not
  hold, the fallback is a tiny `server/boot.mjs` that imports the guard and then `./index.mjs`, with
  `npm run dev` pointed at it — a `package.json` change, so flag it to the maintainer rather than
  doing it silently.
- `fetch()` in Node is `undici`, which may or may not route through `net.Socket.prototype.connect`
  depending on version. **Unverified.** The test above is what settles it. If undici bypasses the patch,
  the guard covers less than advertised and the README wording must shrink accordingly — this is
  precisely the upstream's failure and we must not inherit it.
- The stack capture per attempt costs something. Cap it (`Error.captureStackTrace` with
  `stackTraceLimit` temporarily lowered) and only for *unexpected* hosts.
- Windows: nothing here is path-dependent, so no `path.sep` concerns.

**Definition of done**
- `lib/network-guard.mjs` exists, is imported first in `server/index.mjs`, and carries a comment
  explaining that its position is load-bearing.
- A test proves an outbound connection to a non-allowlisted host is recorded (and, in `block` mode,
  destroyed) — evidence, not assertion.
- `GET /api/gov/egress` returns the mode, the derived allowlist, and the attempt list.
- The Governance panel shows the allowlist and the attempt table, with unexpected hosts flagged.
- **Empty/null state:** with no attempts recorded, the panel reads *"no outbound connection attempted
  since this server started (uptime Nm)"* — **not** "0 connections" and not a green tick. Honesty rule 2:
  a clean bill of health requires having read something, and an audit buffer that has been running for
  40 seconds has read almost nothing. The uptime is the visible denominator (honesty rule 4).
- If the undici verification fails, the README wording is narrowed in the same PR. We do not ship a
  claim wider than the mechanism.

---

### 3. Byte-offset transcript tailing — watch sessions started in other terminals

**Customer need** — Ali starts a long refactor in a terminal (`claude` in iTerm), then opens the
dashboard to watch it. The dashboard shows **nothing live**. `ChatSection` only streams chats *it*
spawned: `/api/chat` (`server/index.mjs:909`) spawns a child, and `/api/chat/:id/events` (`:944`) is an
SSE feed of that child's stdout. A session started anywhere else exists only as a `.jsonl` file that
gets re-read from scratch whenever some aggregate endpoint happens to run. The only live signal we have
for a foreign session is `ACTIVE_MS = 5 * 60_000` (`:798`) — a binary mtime check used at `:836` to
count "running" sessions. We cannot say what it is doing, only that it did *something* in the last five
minutes. Today the workaround is to alt-tab to the terminal, which is what the dashboard exists to
avoid.

**Value to Loush** — `_SYNTHESIS.md` §7 Cluster A names live session state as *the cluster where we are
weakest*, and this is the enabling primitive for all of it. It feeds `Overview`'s "what needs a human
today" (a session blocked on a permission prompt is the single most actionable signal), `RunsSection`,
and `ActivityTimeline`. It is also the same primitive Tier 2.2 needs. Nothing else in this spec unlocks
as many downstream features.

**How the upstream repo does it today** — `apps/server/src/routes/live.ts:68-96`, `readNewLines()`.
A module-level `Map<filePath, byteOffset>`. Per tick, for each `.jsonl`: `statSync` for the size; if the
file is **newly seen**, record its current size and read nothing; otherwise `openSync` + `readSync` of
exactly `size - offset` bytes from `offset`, split on newlines, update the offset. The "first sight →
record the size, don't replay" rule is the load-bearing detail: without it, the first SSE client to
connect gets every historical line of every transcript in one burst.

Around it: a 1.5 s `setInterval` that starts on the first SSE client and stops when the last leaves;
`message:new` / `session:active` / `session:idle` / `stats:tick` events; a 30 s heartbeat; and a
`TodoWrite` extractor (`live.ts:180-192`) that pulls the `todos` array out of live `TodoWrite` tool
calls into a task-progress stream.

Their gotchas: `findJsonlFiles` **re-walks the entire `~/.claude/projects` tree every 1.5 s**
(`claude-code-insights.md:356`) — do not port the cadence. `live.ts:98-104` carries a *private*
`estimateCost` hard-coding 3/15 that disagrees with their own cost engine — do not port it at all.
`live.ts:51` derives a project name with `.replace(/^\//, '')`, which produces wrong labels on Windows.

**How we implement it here** — New `lib/tail.mjs`: `createTailer()` returning `{ tick(files), reset(file) }`
over a `Map<path, {offset, ino, size}>`, plus the newly-seen rule. Pure, no I/O policy of its own, so it
is unit-testable against a temp file. Truncation/rotation safety that upstream lacks: if
`size < offset`, or the inode changed, drop the offset and treat the file as newly seen — a compaction
that rewrites a transcript must not be read as a mountain of new lines.

Server, in `server/index.mjs` next to the existing SSE plumbing:
- Reuse the walker shape already at `:660`/`:2302`/`:1810` for discovery, but on a **separate, slower
  cadence** than the tail: re-walk the tree every 15 s, tail the known file list every 2 s. Their
  1.5 s full re-walk is the mistake; the walk is the expensive half.
- New route `GET /api/live` (SSE), modelled on `/api/chat/:id/events` at `:944-952`: `res.writeHead`
  with `text/event-stream`, an immediate `': connected\n\n'` to flush headers, a listener set, and
  `req.on('close', …)` to deregister. Start the interval on the first listener, clear it on the last —
  copy that discipline from upstream, it is correct.
- Events: `{type:'line', sessionId, proj, cwd, kind, …}` for each newly-appended record we care about
  (assistant text, tool_use name, tool_result error flag), `{type:'status', sessionId, state}` and a
  30 s `{type:'ping'}`. Fields come from the same JSONL shapes the three walkers already parse
  (`j.type`, `j.message.content[].type`, `j.timestamp`, `j.cwd`, `j.gitBranch`, `j.toolUseResult`).
  Redact through `lib/pii.mjs` (feature 1) before broadcasting.
- **Do not** put a cost number on this stream. That is where upstream grew its second, wrong pricing
  table, and our pricing is being corrected separately under Tier 0.2.

Client: a new `src/sections/LiveSection.jsx` holding an `EventSource('/api/live')` in a ref, an events
array in state capped at 200 (upstream's cap; it is the right order of magnitude), and auto-scroll that
**pauses when the user scrolls up** and surfaces a "jump to latest" button — that interaction is the
best UX idea in `docs/application-overview.md` and costs ten lines. Mount it as a tab inside the
existing `chat` Hub in `src/App.jsx:104-112`, alongside Chat and Insights: `{ label: 'Live', el: <LiveSection /> }`.
No new top-level nav entry — the sidebar is already 14 items.

**Effort** — **M.** The tailer is S. The SSE route is S (we have the pattern). The section, the
interaction polish, and getting the two cadences and the listener lifecycle right is where the M comes
from. Realistically 1–2 days.

**Risks and unknowns**
- **Must verify first:** that Claude Code appends to the transcript *promptly* rather than buffering
  until turn end. If it flushes only at turn boundaries, this is a per-turn feed, not a live one, and
  the section's framing must say so. Test by tailing a real session by hand.
- Windows file locking: `openSync`/`readSync` on a file another process holds open for append. Node on
  Windows generally allows this, but it is **unverified here** and this repo runs on Windows 11.
  Test before building the UI on top.
- `ino` is `0` on some Windows filesystems, weakening rotation detection; fall back to the
  `size < offset` check, which is enough for the truncation case that actually occurs.
- An idle dashboard left open all day holds an SSE connection and a 2 s interval. Ensure the interval
  really stops on last-listener-close; a leaked interval that walks the FS forever is a laptop-battery
  bug.

**Definition of done**
- `lib/tail.mjs` has tests covering: newly-seen file yields zero lines; append yields exactly the
  appended lines; truncation resets rather than replaying; a partial trailing line is buffered, not
  emitted split.
- Starting `claude` in a terminal outside the dashboard produces visible events in the Live tab within
  ~2 s of each appended record.
- Closing the last browser tab stops the interval (assert via a log line or a test hook, not by eye).
- The feed is redacted by the same `lib/pii.mjs` settings as Search.
- **Empty/null state:** with no transcripts appended since connect, the panel reads *"connected —
  nothing has appended since you opened this tab (Nm)"*, with the connect time as the visible
  denominator. Never "0 events", never a spinner that implies work is happening. If the SSE connection
  drops, the panel says *"disconnected"* explicitly rather than silently freezing at the last event —
  a frozen feed that looks live is a fabricated fact.

---

### 4. Redacted and anonymised export

**Customer need** — Ali wants to put "here's what six weeks of agent-assisted work actually cost and
where the tools failed" in a writeup, or hand it to a teammate evaluating the harness. Every number in
this app is currently trapped behind a localhost UI: there is **no export path anywhere** in
`server/index.mjs` (the only `/api/gov/bundle/export` at `:2058` exports *config*, not usage). The
workaround is screenshots, which cannot be aggregated, or reading numbers off the screen into a
spreadsheet, which introduces transcription errors into the one thing this app is supposed to be
honest about. And a raw export is not shareable: `/api/sessions` rows (`:3035-3046`) carry `cwd`,
`transcript` (an absolute path containing the user's username), `branch` and a `resume` command string.

**Value to Loush** — Makes the dashboard's output portable without leaking the repo names, branch names
and home directory that make it un-shareable. Pairs with feature 1: the non-anonymised export is
credential-redacted, the anonymised one additionally drops identity. Surfaces from `UsagePanel` and
`TeamBaseline`, both already tabs in the `harness` Hub (`src/App.jsx:165,168`).

**How the upstream repo does it today** — `apps/server/src/routes/export.ts`: three endpoints — CSV
(with correct RFC-style quote escaping, the part people get wrong), JSON, and `/api/export/anonymized`,
which drops project paths, first prompts and git branch names before serialising. The anonymised
variant is the genuinely reusable idea; the CSV quoting is the genuinely reusable *code*.

**How we implement it here** — New `server/export.mjs`, mounted like the other route modules
(`mountExport(app, {...})`, following the `mountSetup` pattern at `server/index.mjs:61`).
`GET /api/export?format=csv|json&scope=sessions|usage|tools&anonymize=1&days=N`.

Data comes from functions that already exist — no new parsing:
- `scope=sessions` → the row shape built at `:3030-3047`.
- `scope=usage` → `collectUsage()` daily series, the same fold `/api/usage` does at `:743-751`.
- `scope=tools` → `toolTotals` from `collectUsage()` plus `toolErrs` from `failStats()`.

`anonymize=1` drops `cwd`, `transcript`, `resume`, `branch`, and replaces `proj`/`project` with a
stable `sha256(proj).slice(0,6)` — stable so a reader can still tell two rows are the same project,
opaque so they cannot tell which. Their path-hashing idea, lifted from `middleware/privacy.ts`.
Without `anonymize=1` the export still runs through `redactPII` from feature 1.

CSV writer: port their quoting rule (wrap in `"` if the value contains `,`, `"`, `\n` or `\r`; double
any embedded `"`), as ~10 lines in `server/export.mjs` with tests. No dependency.

Client: a download button in `src/sections/UsagePanel.jsx` (166 lines) and `TeamBaseline`, with an
explicit "anonymise" checkbox and a one-line description of exactly which fields are dropped —
listed, not summarised, so the user can check the claim.

**Effort** — **S.** All the data functions exist; this is a serialiser plus a route plus two buttons.
Depends on feature 1 for the non-anonymised path.

**Risks and unknowns**
- A CSV of every session for 90 days can be a few MB. Cap `days` and stream rather than building one
  string, or accept the cap and say so.
- Excel will mangle a leading `=` in an exported prompt snippet into a formula. Prefix any cell
  starting with `=`, `+`, `-`, `@` with `'`. Their exporter does not do this.
- **Must verify first:** whether `proj` (the mangled directory name at `:665`) is already
  reconstructible into a real path by a reader. It is `path` with `[\\/:._]` → `-` (`:767`, `mangle`),
  which is *lossy but often guessable* (`-Users-ali-work-payments`). Hashing it is therefore load-bearing,
  not decorative.

**Definition of done**
- `GET /api/export?scope=sessions&format=csv&anonymize=1` returns a CSV with no absolute path, no
  branch name, no readable project name, and no `resume` command anywhere in the body — asserted by a
  test that greps the output for `os.homedir()` and for each configured project path.
- CSV quoting round-trips a value containing a comma, a quote and a newline (test).
- Formula-injection prefixes applied (test).
- The UI lists the exact dropped fields next to the checkbox.
- **Empty/null state:** an export over a window with no sessions produces a file with the **header row
  present and zero data rows**, plus a `# no sessions in this window (N days ending YYYY-MM-DD)` comment
  line — not an empty file and not a 404. An empty file is indistinguishable from a failed download.

---

### 5. Incremental append parsing for the three transcript walkers

**Customer need** — Ali has one long-running session and hits refresh. We re-read the entire
transcript **three times**, in full, because one line was appended. `collectUsage()` keys its cache on
`{mtime, size}` (`server/index.mjs:667`) and on any change rebuilds `rec` from
`fs.readFileSync(f,'utf8').split('\n')` (`:671`). `failStats()` does the same at `:1816`/`:1832`.
`scanTranscripts()` does the same at `:2312`/`:2324`. For a session that has been appended to all day,
the cost of "what changed" grows with the total file size, not the delta. The symptom the user sees is
the section-refresh chip (`src/App.jsx:427`) sitting on "cached · Nm old" and a refresh that takes
seconds on a big corpus.

**Value to Loush** — Every panel behind `HEAVY_TTL` (`server/index.mjs:102-109` — twenty-four endpoints)
gets cheaper, and the staleness window can be shortened without making refresh slower. It reuses
`lib/tail.mjs` from feature 3, so the marginal cost is low once that exists. `_SYNTHESIS.md` Tier 2.2
covers the same ground from CCAM's angle (`(mtime,size)` key + byte-range reads, truncation-safe);
this is that item implemented against our three real walkers.

**How the upstream repo does it today** — They *didn't*, and that is the instructive part. Their
indexer (`services/indexer.ts:96-156`) does the mtime-diff correctly — skip unchanged files, batch the
changed ones in groups of 4, `Promise.allSettled` so one corrupt JSONL cannot abort the run, one SQLite
transaction per batch — but then **re-parses each changed file in full and deletes+reinserts all its
message rows** (`claude-code-insights.md:355`). Their live path solved the append problem with byte
offsets; their index path never picked it up. Two things worth taking from the indexer regardless:
`Promise.allSettled` per batch (blast-radius bounding), and the per-batch transaction boundary — which
maps onto "commit the sidecar once per batch" in feature 6's terms rather than once per file.

**How we implement it here** — Each of the three walkers becomes: if `size > rec.size` and
`mtime` changed and the first N bytes are unchanged → read only `[rec.size, size)` and **fold the new
lines into the existing `rec`**; otherwise full re-parse. Every one of the three accumulators is
already resumable — they are sums, counters, capped arrays and `Math.max` over timestamps — which is
why this works at all and is worth stating explicitly in a comment, because a future non-resumable
field (a median, a percentile) would silently break it.

Concretely:
- `collectUsage()` (`:657`): `rec.entries.push`, `rec.out +=`, `rec.first ||=`, `rec.last = Math.max`,
  `rec.branches[br]` — all resumable. Bump `v: 2` → `v: 3`.
- `failStats()` (`:1807`): counters plus `rec.errs`/`rec.big` capped arrays — resumable, **except**
  `idName` (the `tool_use.id` → `{name, path}` map at `:1828`) and `lastErrTool` (`:1829`), which are
  per-parse locals. A `tool_result` in the new tail may reference a `tool_use` from the already-parsed
  prefix. **Persist `idName` and `lastErrTool` into `rec`** or the tail loses tool attribution — this
  is the one genuine trap in the whole feature. Bump `v: 3` → `v: 4`.
- `scanTranscripts()` (`:2299`): counters, capped arrays, `touched` Set. `touched` is a per-parse local
  at `:2320` and `lastSkill` at `:2322` is a carry-forward heuristic — both must move into `rec`.
  Bump `v: 3` → `v: 4`.

Guard: keep a `headHash` (sha256 of the first 4 KB) in `rec`. If it differs, the file was rewritten
(compaction), so full re-parse. `size < rec.size` → full re-parse. This is the truncation-safety upstream
lacks and CCAM has.

**Effort** — **M.** The mechanism is small; the `idName`/`lastSkill`/`touched` carry-forward is subtle,
and it touches the three most load-bearing functions in the file. Needs a fixture-driven test per walker
that asserts *"full parse of A+B == parse of A then tail of B"* — that identity is the entire
correctness argument and it should be the test, not a manual check.

**Risks and unknowns**
- A partial trailing line at the moment we read (the CLI mid-write). `lib/tail.mjs` must hold back the
  bytes after the last `\n` and prepend them next tick. This is already in feature 3's DoD.
- If the identity test fails on any walker, **do not ship that walker's tail path** — fall back to full
  re-parse for it. Two of three is a real win; a wrong-but-fast number is not.
- The `v` bumps mean a one-off full re-parse of everything on the first boot after deploy.
- Unverified: whether Claude Code ever rewrites a transcript in place other than at compaction. The
  `headHash` guard makes that question non-load-bearing, which is why it is there.

**Definition of done**
- All three walkers have a `test/server/<walker>-incremental.test.mjs` asserting the full-parse ==
  incremental-parse identity over a fixture built from `test/fixtures/`.
- Truncating a fixture mid-run triggers a full re-parse, not a corrupt fold (test).
- `idName`-dependent attribution (a `tool_result` in the tail referencing a `tool_use` in the prefix)
  still attributes the error to the right tool and file (test) — this is the regression that would
  otherwise be invisible until someone noticed Forensics blaming `?`.
- **Empty/null state:** unchanged from today. If a transcript is unreadable, the walker's existing
  `catch {}` still yields a `rec` and the file simply contributes nothing — but the incremental path
  must not turn a read failure into a *stale-but-plausible* rec. On any read error, invalidate the
  cache entry rather than keeping the last-good fold, so the number is absent rather than quietly wrong.

---

### 6. JSONL record-type census — know what we drop on the floor

**Customer need** — Nobody feels this one directly, which is why it is last among the shippable items.
The person who hurts is Ali six weeks from now, when a Claude Code release adds or renames a record
type and a number quietly goes flat. Anthropic documents transcript **location and layout and zero
field names** (`_SYNTHESIS.md` §3); the SDK type is `[k: string]: unknown`; issue #53516 asking for a
stable schema is open and unanswered. Our three walkers each match on a hand-picked set of shapes
(`j.type === 'user'|'assistant'`, `j.attachment.type.startsWith('hook_')`, `j.toolUseResult.structuredPatch`,
`j.isCompactSummary`, `j.type === 'summary'`) and silently ignore everything else. We cannot currently
answer "what fraction of lines do we understand?" — which is exactly the visible-denominator question
honesty rule 4 demands of every derived stat.

**Value to Loush** — Two things. (a) A cheap, permanent regression detector: if the share of
unrecognised lines jumps after a CLI upgrade, we find out from a number rather than from a chart that
went flat. (b) It is the **verification gate** `_SYNTHESIS.md` §3 requires before Tier 3.1/3.2
(reading `file-history/` and `usage-data/` for exact rework counts) can be built — those are the highest-
leverage items in the whole research body, and they are gated on knowing the on-disk shapes are stable
across versions. This is the cheapest way to start collecting that evidence now.

**How the upstream repo does it today** — `packages/shared-types/src/session.ts` is a Zod discriminated
union over **eight** record types: `user`, `assistant`, `tool_use`, `tool_result`, `queue-operation`,
`system`, `file-history-snapshot`, `progress`. The research calls it *"the best single artifact
documenting the real Claude Code JSONL format"* — as documentation, since we will not add Zod. Their
reader (`packages/session-parser/src/jsonl-reader.ts`) streams, strips the BOM, caps a line at 10 MB,
`safeParse`s each line and **counts skipped lines instead of throwing**, returning `skippedLines` so the
UI can be honest about it. That last decision is the one that fits our honesty rules exactly.

Our landscape agent's independent survey (37,378 JSONL lines, 220 transcripts) found **13 distinct
top-level `type` values** where the SDK union covers 3 (`_SYNTHESIS.md` §3). So the upstream union is
better than the SDK and still incomplete. Treat it as a starting checklist, not a spec.

**How we implement it here** — A small script, not a section: `scripts/jsonl-census.mjs`, run with
`node scripts/jsonl-census.mjs`. Walks `~/.claude/projects` with the same walker shape as
`server/index.mjs:660`, and per line records the top-level `type`, and for `type:'system'` the
`subtype`, and whether *any* of our three walkers would have extracted something from it. Prints a
table: `type | subtype | lines | % of corpus | consumed-by`.

It writes nothing to `~/.claude` and calls no API. The output goes in a doc note under `docs/` —
**created only when a human runs the script and pastes real numbers**, never generated speculatively.

Two derived metrics upstream computes that we may be missing, which the census will settle either way:
- `file-history-snapshot` records are how they count *files modified*. We derive files-touched from
  `tool_use` input paths and `toolUseResult.filePath` (`server/index.mjs:2354,2374`), which is a
  different denominator.
- `system` with `subtype: 'compact_boundary'` is how they count compactions. We count
  `j.isCompactSummary || j.type === 'summary'` (`server/index.mjs:1840`). If both markers exist we may
  be double-counting or under-counting; the census tells us which, and that number feeds
  `ForensicsSection` and the session rows at `:3041`.

**Effort** — **S.** ~80 lines, read-only, no route, no UI, no dependency.

**Risks and unknowns**
- The census reflects *one machine's* corpus. It cannot prove a type does not exist, only that we have
  not seen it. The output must say so.
- Cross-version verification (`_SYNTHESIS.md` §11 item 4) needs the script run against transcripts from
  more than one CLI version. We probably have that in `~/.claude` history already — worth checking via
  the `cli_version`-shaped fields the upstream schema documents, but **unverified** whether our
  transcripts carry one.

**Definition of done**
- `scripts/jsonl-census.mjs` runs read-only against `~/.claude/projects` and prints the table.
- The output includes an explicit **"lines not consumed by any walker: N (X% of M)"** row — the
  denominator is `M`, printed, per honesty rule 4.
- It answers definitively whether `file-history-snapshot` and `system/compact_boundary` appear in our
  corpus, and whether our compaction count double-counts.
- **Empty/null state:** if `~/.claude/projects` is missing or empty, the script exits with a clear
  message naming the path it looked for. It never prints a table of zeros — a zeroed census would read
  as "we understand 100% of nothing".

---

### 7. Tool permission gate — risk tiers, approval prompt, and dropping `--dangerously-skip-permissions`

**Customer need** — We pass `--dangerously-skip-permissions` in **five** places:
`server/index.mjs:916` (Chat), `:1056` (Quick Actions), `:1964` (the scheduler's task runner),
`:3488` (the prompt-quality rubric run) and `:3712` (the harness eval runner, inside a generated
`node -e` string). `_SYNTHESIS.md` §2 states the consequence plainly: *"our posture is worse than the
project we were reviewing"* — a project that shipped a CVSS 9.8 unauthenticated RCE. Concretely: Ali
opens Chat, points it at a repo, and asks a question. The agent decides to `rm -rf` a build directory,
or `git reset --hard`, or `curl | sh` a fix it found. There is no gate. The current mitigation is the
ALLOWED_ROOTS write jail at `server/index.mjs:124-130` — which constrains **our own** endpoints and has
no bearing on what the spawned `claude` child does. The workaround today is "run Chat only against
repos you're willing to lose", which nobody actually does.

**Value to Loush** — Lets us run agents from the dashboard in *default* permission mode instead of
pre-accepting everything, with a human gate on high-risk tools. `_SYNTHESIS.md` Tier 2.3 assigns the
core pattern to siteboon; the contribution from `claude-code-insights` is the **risk classification**
and the **Promise-resolve loop shape**. It is the highest-value behavioural idea in this research file
and the only one that changes what the product is allowed to do rather than what it shows.

**How the upstream repo does it today** — Two pieces.
`classifyToolRisk` (`apps/server/src/routes/agent.ts:39-45`): three tiers, read-only tools → `low`;
`Edit`/`Write`/`NotebookEdit` → `medium`; **everything else → `high`**. Default-deny-shaped: an unknown
tool is high risk, not low. That default is the whole design and it is four lines.

The loop (`routes/agent.ts:430-471`): the Claude Agent SDK's `canUseTool` callback returns a Promise.
Their handler sends a `permission:request` message over the WebSocket carrying the tool name, its JSON
input and the risk tier, stores the Promise's `resolve` in a pending map keyed by request id, and
returns. The browser renders a full-screen modal (risk badge green/orange/red, tool name, params in a
code block, Deny/Allow, Escape to close — spec in `docs/application-overview.md`), and the user's click
POSTs `allow`/`deny` back, which looks up and calls the stored `resolve`. That is it: **a Promise that
a UI click resolves.** The shape is transport-agnostic; only the round-trip needs a client→server channel.

**How we implement it here — and the reason this is last.** Our transport is **not** theirs. We spawn
the `claude` CLI as a child process with `--input-format stream-json --output-format stream-json`
(`server/index.mjs:916`) and stream its stdout as SSE. We do not use the Claude Agent SDK, so
**`canUseTool` is not available to us**. There are two candidate mechanisms and **neither is verified**:

- **(a) `--permission-prompt-tool`** — a documented Claude Code CLI flag that routes permission
  requests to a named MCP tool. We would stand up a tiny local MCP server exposing an `approve` tool,
  which blocks on our pending-approval map. **Unverified:** the flag's exact name, its argument shape,
  and whether it is honoured in `-p`/stream-json mode on the installed CLI version.
- **(b) `control_request` over stream-json** — the stream-json protocol carries bidirectional control
  messages, which is plausibly how the SDK implements `canUseTool` over a subprocess. **Unverified:**
  whether the CLI emits a permission control request on stdout and accepts a control response on
  stdin, and what the message shape is.

I loaded the `claude-api` skill to check. It documents the Messages API and Managed Agents and states
explicitly that it *"does not generate Claude Agent SDK code"*, pointing to `code.claude.com/docs/en/agent-sdk`.
It confirms the Agent SDK is a separate package that ships permissions, but says nothing about the CLI
flag or the stream-json control channel. **So: step zero of this feature is a spike, not code.**

The spike (half a day, do it before estimating the rest): run
`claude -p --input-format stream-json --output-format stream-json --verbose` against a scratch repo
with a prompt that forces a `Bash` call, **without** `--dangerously-skip-permissions`, and capture every
line of stdout. If a permission request appears, we have mechanism (b) and its exact shape. If the
process instead hangs or exits, try `--permission-prompt-tool` and check `claude --help`. Write the
findings into this file before building.

Assuming a mechanism exists, the implementation:
- `lib/tool-risk.mjs` — port `classifyToolRisk` verbatim, default-deny. Extend their read-only set with
  the tools our transcripts actually show: `Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch`,
  `TodoWrite`, `Task`. Keep `Bash` in `high` regardless of the command string — parsing a shell command
  to decide whether it is safe is the classic mistake, and their three-line default is better than a
  clever parser.
- `server/index.mjs`, in the `chats` map at `:866`: add `chat.pending = new Map()` holding
  `{id, tool, input, risk, resolve}`. On a permission request from the child, `chatBroadcast` a
  `{type:'permission:request', …}` event — the SSE feed already reaches the client and `ChatSection`
  already appends every event to state (`src/sections/ChatSection.jsx:279-283`).
- New route `POST /api/chat/:id/permission` → `{requestId, decision:'allow'|'deny', remember?:boolean}`.
  Express, sits next to `/api/chat/:id/message` at `:953`. **This is why we do not need WebSockets** —
  the research file already reaches this conclusion (`claude-code-insights.md:443`) and it is right:
  one small POST is the whole client→server channel.
- `remember: true` appends the tool pattern to the `permissions.allow` list via the harness patch path
  that `HarnessSection` already drives (`src/sections/HarnessSection.jsx:69,97-100` — `patch('permissions', lists)`
  → `PATCH /api/harness`). That reuse is the point: the approval UI writes to the same config the
  Harness section edits, so a remembered rule is visible and revocable where the user already looks.
- `src/sections/ChatSection.jsx`: a `permission` block kind in `buildBlocks()` (`:16-52`) and a modal
  rendered from the newest unresolved request — risk badge coloured with the existing
  `var(--green)`/`var(--amber)`/`var(--red)` tokens, tool name, `JSON.stringify(input, null, 2)` in a
  code block, Deny/Allow, Escape closes as Deny. No `App.jsx` change; Chat is already a section
  (`src/App.jsx:99-112`).
- Drop `--dangerously-skip-permissions` from `:916` (Chat) and `:1056` (Quick Actions) once the gate
  works. **Leave `:1964`, `:3488` and `:3712` alone in this feature** — the scheduler, the rubric run
  and the eval runner are unattended by design; there is nobody to click Allow. They need a separate
  decision (a restrictive `--allowedTools` allowlist is the likely answer) and pretending otherwise
  would ship a hang.

**Effort** — **L.** The spike is S but gates everything. If mechanism (b) exists and is clean, the rest
is M. If neither mechanism works in `-p` mode, this becomes "adopt the Agent SDK for Chat", which is a
new dependency and a rewrite of the chat driver — genuinely L, and a decision for the maintainer, not
an implementation detail.

**Risks and unknowns**
- **The mechanism is unverified. This is the whole risk.** Do not schedule this feature before the spike.
- A hung approval blocks the child process indefinitely. Needs a timeout that auto-denies with a visible
  reason, plus a "session waiting on you" state — which is exactly what feature 3's live status is for.
- Dropping `--dangerously-skip-permissions` will make Chat *feel* worse before it feels better: prompts
  the user did not previously see. The `remember` path is what makes that survivable, so it is not
  optional polish.
- CLI version drift: whatever mechanism we find is undocumented-adjacent and can change. Detect the
  capability at runtime and fall back to the current behaviour **with a visible banner** saying
  permission prompts are unavailable on this CLI version — never fall back silently to
  skip-permissions, which would be a security regression disguised as a graceful degradation.

**Definition of done**
- The spike's findings are written into this file (or a sibling doc) with the captured stream-json lines
  as evidence, before any implementation lands.
- `lib/tool-risk.mjs` has tests, including "an unknown tool name classifies as `high`".
- A Chat session that triggers a `Bash` call renders the modal and blocks until the user decides.
- Deny returns control to the agent with a denial reason rather than killing the session.
- `remember` writes a rule visible in `HarnessSection`'s permission lists, and revoking it there takes
  effect on the next session.
- `--dangerously-skip-permissions` is gone from `:916` and `:1056`; the three unattended runners are
  explicitly documented as still using it, with a linked follow-up.
- **Empty/null state:** if the CLI does not support the mechanism, `ChatSection` shows a persistent
  amber banner — *"permission prompts unavailable on CLI vN; this session runs with permissions
  skipped"* — naming the detected version. The absence of a gate is stated, never implied by silence.

---

## The durable-store decision

**The gap is narrower than "we have no database".** We already do mtime-keyed memoization in three
places (`server/index.mjs:656`, `:1806`, `:2298`), and it works: an unchanged transcript is not
re-parsed within a process lifetime. The two real gaps are (a) **that memo dies on restart**, so
`npm run dev` — which runs under `node --watch` (`package.json`) and therefore restarts on **every
server file save** — pays a full cold parse of the entire corpus; and (b) an *append* invalidates the
whole entry, which is feature 5's problem and is solved without any store at all.

So the question is only: *should the parse cache survive a restart?*

**What we gain.** Cold start stops being O(all transcripts). On a development loop where the server
restarts dozens of times an hour, that is the single biggest latency win available to us. It also makes
`HEAVY_TTL` (`server/index.mjs:102`) less load-bearing — several of those 300–600 s TTLs exist because
recomputation is expensive, not because the data is slow-moving.

**What we give up, and it is not nothing.** We become stateful. Today every number this app shows is
derived, on demand, from files the user can independently inspect — that is not incidental, it is the
product thesis (`README.md:1-11`). The moment a persisted cache exists, four new failure modes arrive:
a stale entry that outlives the file it described; a schema change that silently reads old rows as new
ones (exactly the trap the `v:` fields already guard in memory, now with a much longer lifetime); a
corrupt store that has to be detected rather than assumed; and a support question that begins "the
number is wrong" and now has a second possible cause. Every one of those is a *fabricated fact* risk,
which is the specific thing the honesty rules exist to prevent. A wrong-but-persistent number is worse
than a slow-but-correct one, and this project has explicitly chosen that trade before.

**The three options.**

*Nothing.* Keep the in-memory memo, ship feature 5's incremental parsing, and accept cold-start cost.
Zero new failure modes. The cold start is the dev-loop cost, which is real but is paid by one person on
one machine. **This is the option that best matches the current thesis.**

*JSON/NDJSON sidecar.* A file under `~/.cache/loush-dashboard/parse-cache.ndjson` (or, more consistently
with everything else we write, `~/.claude/dashboard-parse-cache.ndjson`, alongside `dashboard-meta.json`
at `server/index.mjs:556` and `dashboard-backups` at `:48`). One line per transcript:
`{path, mtime, size, headHash, v, summary}`. Write on a debounce, never per file. Read at boot; any row
whose `mtime`/`size`/`headHash`/`v` disagrees with disk is discarded, not repaired — the same
invalidation rule the in-memory version already uses, so there is no new correctness model to reason
about, only a longer lifetime for the same one. Zero dependencies, no native build, trivially
inspectable and trivially deletable, and it degrades to "nothing" by `rm`-ing one file. It captures most
of the win at a fraction of the risk. **Caveat:** the full `rec` for every transcript is not small —
`rec.entries` alone is one object per assistant message. Persist the *aggregates and the capped arrays*,
not `entries`; a sidecar that is 200 MB and has to be parsed at boot has reinvented the problem.

*`node:sqlite`.* Built into Node (we are on **v26.2.0**, verified), so no native build and no dependency
line in `package.json`. Real indexes, real transactions, partial reads. The costs: it sets a hard Node
floor where today `package.json` sets none; it is a meaningfully larger surface (schema, migrations,
query layer); and it invites scope creep from "cache" to "database", which is where the upstream's
`COALESCE(x, 0)` habit lives.

**`better-sqlite3` is out**, and not on preference. It is a native build whose install failures the
upstream's own README documents (`claude-code-insights.md:370`) — their troubleshooting table admits
`pnpm install` fails without an `onlyBuiltDependencies` entry. Our `package.json` has eleven runtime
dependencies, all pure JS. Adding a compiled module to a project whose pitch is "clone it and run it"
is a bad trade for a cache. (Note we *do* already shell out to a `sqlite3` binary in
`server/promptcheck.mjs:87` — but that is a read-only query against someone else's existing DB, which
is a far weaker commitment than owning a schema.)

**If we adopt a schema, port theirs; never port their queries.** Their three-table shape (`sessions`,
`messages`, `session_stats`, reproduced in full at `claude-code-insights.md:167-223`) is a reasonable
starting point, and their 20-line `PRAGMA table_info` → `ALTER TABLE ADD COLUMN` migration helper
(`db/schema.ts:72-93`) is genuinely elegant for an additive-only derived cache. But their query layer
`COALESCE(...,0)`s missing data into zeros — *the exact thing our honesty rules forbid*
(`_SYNTHESIS.md` "Explicit do-not-adopt"). Keep the columns; return `null`. Also fix, if we take the
schema: `file_path` is unindexed yet looked up per file per startup (O(n) scan), `sessions.id` is the
JSONL basename so two files with the same basename in different project dirs silently collide on the
primary key, and there is no orphan cleanup anywhere — delete a project's transcripts and their rows
inflate every aggregate forever.

**Recommendation: ship feature 5 first, then re-measure, then JSON sidecar if the number justifies it.
Not `node:sqlite`, and not yet.**

Reasoning. Feature 5 (incremental append parsing) and the durable store solve *different* problems, and
feature 5 solves the one that hurts during normal use — the one that makes a refresh slow while you
work. The durable store only helps the **first** parse after a restart. We do not currently know how
long that first parse takes on a real corpus, and committing to statefulness on an unmeasured number is
how a project acquires a subsystem it does not need. So: build feature 5, then time a cold boot with
`node --watch` on the maintainer's actual `~/.claude`. If it is under two or three seconds, do nothing —
the correct amount of persistence is zero. If it is ten seconds or more, the sidecar pays for itself on
the dev loop alone, and it is a day's work with one new failure mode (a stale row), guarded by the same
`{mtime, size, headHash, v}` tuple we already trust in memory.

Reach for `node:sqlite` only if a *second* requirement appears that a sidecar genuinely cannot serve —
querying across sessions without loading everything into memory, or a corpus large enough that the
sidecar itself is slow to parse. Adopting it today would be buying a query engine to solve a boot-time
problem. `_SYNTHESIS.md` rates this Tier 3.5, "L — makes us stateful, weigh it", and the weighing comes
out: **not yet, and measure first.**

---

## Not worth taking

- **Per-model pricing table** (research adoption #2). Real and important — our `PRICE_PER_M` at
  `server/index.mjs:718` charges Opus/Fable at $15/M input and their table says $5, so we overstate
  recent Opus by 3×, and it poisons `entryCost` (`:1987`), the cache-savings math in
  `lib/harness-usage-trends.mjs`, `/api/roi` and every budget alert. But `_SYNTHESIS.md` §8 makes it
  **Tier 0.2**, a correction to land before feature work, sourced from phuryn's exact table (which
  `_SYNTHESIS.md` §1 rates higher-confidence than this project's). Specced elsewhere. Two agents
  shipping two pricing tables is worse than either shipping one.
- **`COALESCE(..., 0)` in their query layer.** Renders missing data as zero. Explicitly on the
  do-not-adopt list; direct violation of honesty rule 1. If we ever take their schema, we take the
  columns and return `null`.
- **Their dual private `estimateCost` helpers** (`routes/live.ts:98-104`, `routes/agent.ts:86-92`).
  Hard-coded 3/15, opus 15/75, haiku 0.8/4 — disagreeing with their own cost engine *and* wrong for
  Opus 4.5/4.6. This is a bug to avoid importing, and the reason feature 3 deliberately puts no cost
  number on the live stream.
- **Their ten insight rules.** Shallow and partly tautological — `abandoned-session` fires on any
  session with ≤2 messages. Ours (`InsightsSection`, `QualitySection`, `ReliabilitySection`) are deeper.
- **Their insight *registry shape*** (research adoption #7). The `Rule = ({session, allSessions}) => Insight | null`
  contract plus an `ALL_RULES` array is genuinely cleaner than our ad-hoc analysis. But it is a
  refactor of working code, not a feature — no user is blocked by it — and it competes for the same
  attention as feature 7, which changes what the product may do. Revisit when a fourth or fifth rule
  needs adding to `InsightsSection` and the ad-hoc shape starts to hurt.
- **Tool-name enrichment at write time** (research adoption #11). We already do better:
  `scanTranscripts()` at `server/index.mjs:2378-2380` emits structured
  `{kind:'skill'|'agent'|'mcp', name, src}` records at parse time, which is strictly more information
  than their `Skill(brainstorming)` string that a downstream `LIKE 'Skill(%'` has to re-parse.
  This contradicts the research file's ranking; the code wins.
- **`InfoTooltip` on every metric** (research adoption #8). Right instinct, wrong owner. It overlaps
  `_SYNTHESIS.md` Tier 0.5 ("audit every derived stat for a visible denominator") and is better done as
  part of that audit than as a component ported from a Vue app using `@floating-ui/vue` — a dependency
  we would have to replace anyway.
- **Vue 3 / Pinia / ECharts / Fastify / TanStack.** Wrong stack. We have React/d3/Express and no reason
  to churn. Their `useAgentSocket` composable maps cleanly to a React hook, but feature 7 concludes we
  need one POST endpoint, not a WebSocket, so even that is moot.
- **"Zero outbound connections" as marketing copy.** We would inherit a claim we cannot defend while
  spawning `claude` five times, and — unlike them — we also call JIRA, Slack, MCP servers and Figma
  by design. Feature 2 ships the narrower claim that is actually true.
- **Their `/api/browse` directory picker.** They allow `$HOME` *or* `/tmp` while the error message says
  "Access restricted to home directory", and `isWithinHome` uses a case-sensitive `startsWith`, which is
  fragile on Windows. We already have project-folder picking in `TicketSection` and `ProjectsSection`,
  and our `safe()` jail at `server/index.mjs:125-130` is tighter.
- **Zod.** Their `shared-types/session.ts` union is the most useful artifact in the repo, but as
  *documentation* (feature 6 uses it as a checklist). Adding Zod for schema validation of a format
  Anthropic explicitly says is internal and unstable would be a dependency in service of false
  precision.

---

## Open questions for the maintainer

1. **Feature 7 is gated on an unverified mechanism.** Do you want the half-day spike
   (`--permission-prompt-tool` vs. stream-json `control_request`) scheduled now, or should feature 7 sit
   until someone hits the failure it prevents? Note the current state — five `--dangerously-skip-permissions`
   call sites — is one the synthesis calls worse than the CVE-shipping project we reviewed.
2. **If neither CLI mechanism works**, feature 7 becomes "adopt `@anthropic-ai/claude-agent-sdk` for
   Chat" — a new runtime dependency and a rewrite of `server/index.mjs:909-973`. Is that acceptable in
   principle, or is "no new deps" a hard line that makes the answer "keep skip-permissions and document
   it loudly"?
3. **Durable store: what is the actual cold-boot number** on your `~/.claude`? I recommend measuring
   after feature 5 lands rather than before, but you may already know. If it is under ~3 s, my
   recommendation is to do nothing at all.
4. **Where should a parse-cache sidecar live** if we build one — `~/.cache/loush-dashboard/` (upstream's
   convention, XDG-ish, and wrong on Windows without a fallback) or `~/.claude/dashboard-parse-cache.ndjson`
   alongside `dashboard-meta.json` (`server/index.mjs:556`) and `dashboard-backups` (`:48`)? I lean to
   the latter for consistency, but it does mean writing one more file into `~/.claude`, and the README
   currently leans on "we only read your transcripts".
5. **PII redaction defaults.** I propose credential patterns on, identity patterns (email, IPv4) off,
   because over-redaction corrupts search results. Do you agree, or should the default be maximally
   conservative on the theory that a demo is more likely than a search?
6. **Network guard mode.** Ship in `audit` (log, allow) or `block` (destroy the socket)? I propose audit
   first so a mis-derived allowlist cannot silently break Delivery, with block as a one-line opt-in once
   the allowlist has been observed correct for a week.
7. **Live section placement.** I put it as a tab inside the existing `chat` Hub (`src/App.jsx:104-112`)
   rather than a 15th sidebar entry. If live session state is as central as `_SYNTHESIS.md` Cluster A
   suggests, it may deserve top-level placement next to Overview — that is a product call, not an
   implementation one.
8. **Cache-version bumps.** Features 1 and 5 both bump the `v:` field on all three walker caches, forcing
   a one-off full re-parse on the first boot after deploy. Fine, or should they be sequenced so users
   pay it once rather than twice?
