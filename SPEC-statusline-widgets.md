# SPEC — statusline widget adoptions

Implementation spec derived from `uppinote20-claude-dashboard-statusline.md` (research on
[uppinote20/claude-dashboard](https://github.com/uppinote20/claude-dashboard), MIT, read at `fb4e06e`)
and constrained by the rulings in `_SYNTHESIS.md` §1, §7, §8.

**No new upstream research was done for this document.** Every upstream claim traces to the research
file. Every implementation claim traces to a file in this repo that I opened; citations are
`path:line`. Where our code and the research disagree, our code wins and I say so.

---

## Why a status line is the right source for an Overview

A status line is a dashboard compressed to one terminal row. Its widget list is therefore not a
feature list — it is a **prioritised answer to "what does a working developer want to see without
asking"**, ranked by a maintainer who had 80 columns to spend. That is exactly the question
`src/sections/Overview.jsx` exists to answer, and our Overview currently answers it with a fixed set
of five delivery tiles + four usage KPIs (`Overview.jsx:190`, `:206-216`) that were chosen by us, not
by a user.

### The widget contract *is* our honesty rule, expressed as an interface

Upstream's contract (research §Architecture) is:

```ts
interface Widget<T> {
  readonly id: WidgetId;
  readonly name: string;
  getData(ctx): Promise<T | null>;   // null ⇒ the widget disappears
  render(data: T, ctx): string;      // pure, sync
}
```

The load-bearing clause is `null ⇒ the widget disappears`. Not "renders 0". Not "renders a dash".
Not "renders `—` but still occupies its slot in a grid that implies the slot matters". **Absent data
removes the claim from the screen entirely.**

We already believe this, and we already say so in three places, in three different ad-hoc ways:

- `src/sections/Overview.jsx:9-10` — `Num` refuses to animate a non-number, with the comment "a
  suppressed / not-configured / stale value is `—`, never a fake 0".
- `src/sections/InsightsSection.jsx:11-13` — `pct` returns `—` for null, with the comment that
  `Math.round((x || 0) * 100)` "made 'not measured' and 'measured, and it is zero' indistinguishable
  — the idiom that laundered every honest null".
- `src/sections/Overview.jsx:93-98` — the whole delivery block is replaced by a "not configured" card
  when `/api/eng/snapshot` reports unavailable, with the line "Nothing is fabricated here: no
  snapshot, no numbers."

Three implementations of one rule, enforced by convention and code review. The `getData → T | null`
contract turns that convention into a type. A widget that cannot compute its number returns `null`
and is *structurally unable* to render a zero. That is the strongest argument for the registry in
§"The configurable Overview" below, and it is a stronger argument than configurability is.

Note also which of our three implementations is the honest one: only the third (`:93-98`) actually
*removes* the block. The other two substitute `—` in a tile that still takes up a slot, which is
halfway — the user still counts nine tiles and assumes nine measurements exist. Upstream's rule is
the stricter one and it is the one we should converge on.

### Effort scale used below

| Rating | Meaning |
|---|---|
| **S** | under half a day; one file, no new endpoint or one trivial one |
| **S–M** | about a day; one new module + one call site |
| **M** | 2–4 days; new endpoint(s), new parsing, new UI |
| **L** | over a week; touches architecture, needs a design decision first |

Features are ordered by value ÷ effort. Each is independently shippable — none depends on an earlier
one landing, except where explicitly stated.

---

## 1. `history.jsonl` as the clean prompt corpus

**Customer need.** Loush publishes four judgements about *how the user writes prompts*: the 8-dimension
Prompt Quality score (`src/sections/PromptQuality.jsx:43-80`, rubric in `server/promptcheck.mjs:18-27`),
the duplicate-prompt clusters and their "save as command" promotion path
(`src/sections/InsightsSection.jsx:149-213`), the "most-reused prompts" list
(`InsightsSection.jsx:135-142`), and the prompt-quality summary panel on the landing page
(`Overview.jsx:287-311`). All four read prompts out of session transcripts under
`~/.claude/projects/**/*.jsonl` — a stream that also contains skill expansions, `<command-name>`
injections, `<local-command-stdout>` blocks and tool results. We filter that noise with two string
prefixes: `server/promptcheck.mjs:44` drops anything starting with `<` or `/`, and
`server/index.mjs:2367` drops anything starting with `<` or `[Request interrupted`. Anything the
harness injected that does not begin with those characters is currently being scored as if the user
typed it. Today the user works around this by discounting the score.

**Value to Loush.** `_SYNTHESIS.md` §8 Tier 1.5 ranks this as the single cheapest accuracy win in the
entire research body. `~/.claude/history.jsonl` is the record of *genuine typed user input only*.
I verified the file exists on this machine (182 entries, 73 KB) and confirmed its shape directly:
every line has exactly five keys — `display` (the typed text), `pastedContents` (an object keyed by
paste number), `timestamp` (epoch **milliseconds**, not an ISO string), `project` (the absolute cwd,
e.g. a Windows path with backslashes) and `sessionId`. Note `project` is a bonus the research does
not mention: upstream only ever matches on `sessionId`, but `project` gives us per-project attribution
for free without going through the `mangle()` directory-name transform at `server/index.mjs:830`.

**How the upstream repo does it today.** `scripts/utils/history-parser.ts` powers one widget,
`lastPrompt`. It tail-reads the **last 16 KB only**, reverse-scans lines for the first entry whose
`sessionId` matches, reads `display`, expands `[Pasted text #N ...]` placeholders from
`pastedContents[N].content`, collapses whitespace and truncates to 60 chars. Cached by
`(path, fileSize)`.

**How we implement it here.**

- New `server/history.mjs` exporting `readHistory({ since, project, sessionId, limit })`. Generalise
  upstream from "last prompt" to "all prompts", so drop the 16 KB tail — 73 KB is nothing to a
  server that already reads every transcript in `~/.claude/projects` on each `collectUsage()` call
  (`server/index.mjs:657-716`). Keep upstream's `(path, size, mtime)` cache key; our existing caches
  use exactly this shape (`usageCache` at `:656`, `scanCache` at `:2298`).
- Port the `[Pasted text #N]` expansion verbatim. On this machine every `pastedContents` is `{}`, so
  the expansion path is **unverified against real data** — write it defensively and treat a missing
  key as "leave the placeholder text in place", never as an exception.
- Rewrite `claudePrompts()` in `server/promptcheck.mjs:46-75` to call it. Keep the transcript walk as
  a labelled fallback for when `history.jsonl` is absent or yields fewer than the 5 prompts the
  refresh route already requires (`promptcheck.mjs:132`).
- Add `source: 'history' | 'transcripts'` to the `/api/promptcheck` payload and render it in
  `PromptQuality.jsx` next to the existing `cached · <date> · N prompts` line (`:70-72`).
- Feed `/api/dupes` and `/api/chatstats` (consumed at `InsightsSection.jsx:80` and `:156`) from the
  same module. Their inputs come from `scanTranscripts()`'s `all.prompts` (`server/index.mjs:2393`);
  switch that specific consumer, not the whole scan — `scanTranscripts` also builds the search index
  and the invocation graph, which still need the transcript stream.

**Effort. S.** One new ~120-line module, one rewritten function, two call sites, one badge.

**Risks and unknowns.**

- **Retention is unknown.** 182 entries is small for a machine with this much transcript history. I
  could not determine whether Claude Code rotates, caps or trims `history.jsonl` — **unverified**.
  If it is capped, this is a *recent-prompts* corpus, not a complete one, which changes what
  `/api/dupes` over a 365-day window can honestly claim. Measure the oldest `timestamp` against the
  oldest transcript entry before switching the long-window consumers over.
- `project` is a raw absolute path; our transcript-derived project keys are mangled
  (`server/index.mjs:830`). The join needs `mangle(h.project)`, and needs to survive a Windows path.
- The file is undocumented first-party state and can change shape without notice
  (`_SYNTHESIS.md` §3). Validate the five keys per line and skip lines that fail, the way
  `collectUsage` already skips unparseable lines (`:690`).
- Adding a second corpus means the Prompt Quality score will move on the next refresh. That is the
  point, but it should be announced in the UI rather than silently changing a number the user has
  been watching.

**Definition of done.**

- `GET /api/promptcheck?source=claude` returns `promptSource: 'history'` on a machine with
  `history.jsonl`, and `'transcripts'` on one without.
- The Prompt Quality header renders which corpus produced the score, and the sampled count.
- Feeding a transcript containing a `<command-name>`-tagged turn and a `<local-command-stdout>` block
  yields zero prompts from those turns under the history source.
- **Null/empty state:** with no `history.jsonl` and no transcripts, `/api/promptcheck` still returns
  the existing baseline seed (`promptcheck.mjs:29-37`) with `available: false`, and the Overview panel
  keeps its current `baseline — refresh in Authoring` label (`Overview.jsx:293`). With
  `history.jsonl` present but empty, `promptSource` is `'history'`, `sampled: 0`, and the refresh
  route returns its existing "not enough to analyze" 400 (`promptcheck.mjs:132`) — never a fabricated
  score.

---

## 2. Task and todo progress extraction — we currently have none

**Customer need.** "What is the agent actually working through right now, and how far in is it" has
no answer anywhere in Loush that is derived from transcripts. Today the user reads the raw chat
transcript, or looks at the live stream in Chat and counts.

**Value to Loush.** This is a genuine blind spot, not a quality gap. I verified it: there is **no
`TodoWrite`, `TaskCreate` or `TaskUpdate` parsing anywhere in `server/`**. The only occurrences of
those strings in the whole tree are decorative — a glyph map at `src/sections/PlanGraph.jsx:231`
(`TaskCreate: '☑', TaskUpdate: '☑', TodoWrite: '☑'`) that renders those tool calls *if they arrive on
the live chat stream*, and `server/index.mjs:497`, where `SKIP_DIRS` explicitly excludes the `todos`
directory from a filesystem walk. `scanTranscripts()` records invocations for `Skill`, `Task`/`Agent`
and `mcp__*` (`server/index.mjs:2378-2380`) and nothing else. So for any session the user ran in their
own terminal, PlanGraph and ActivityTimeline see plan structure only when the plan happened to be
emitted through our `PLAN_SCHEMA_RULE` JSON DAG (`server/index.mjs:868-870`) — which only applies to
chats *we* spawned.

**How the upstream repo does it today.** `extractTodoOrTaskProgress()` in
`scripts/utils/transcript-parser.ts` tries the new Tasks API first — `TaskCreate` / `TaskUpdate` tool
calls, **applied only when the matching `tool_result` returns**, so an optimistically-issued update
that failed does not move the progress bar — and falls back to the last completed `TodoWrite` input.
`normalizeTaskStatus()` maps `not_started → pending`, `running → in_progress`,
`complete | done → completed`.

**How we implement it here.**

- Extend the single walk in `scanTranscripts()` (`server/index.mjs:2324-2388`). It already iterates
  `j.message.content` for `tool_use` blocks at `:2369-2386` and already has `j.toolUseResult` in hand
  at `:2353` — both halves of the pairing are on the same pass. Add a `rec.tasks` accumulator keyed
  by tool-use id.
- Port `normalizeTaskStatus` verbatim into `lib/` — it is a four-entry map and getting it wrong makes
  new sessions look empty rather than looking broken.
- Apply a `TaskUpdate` only when its `tool_result` has been seen. Our loop is single-pass and
  in-order, so hold pending updates in a `Map` keyed by `tool_use.id` and flush on the matching
  result, the same way we already pair subagent transcripts by `toolUseId`
  (`server/index.mjs:900-905`).
- Bump the `scanCache` version from `v: 3` (`:2312`, `:2316`) to `v: 4` so every cached record
  re-parses once. This is the established mechanism; `usageCache` does the same at `:667`.
- Surface as a `tasks` array on `/api/sessions` rows (`server/index.mjs:3022-3051`) and as
  `✓ <current task> [n/m]` in the Overview "Recent sessions" panel (`Overview.jsx:236-260`).

**Effort. S–M.** One accumulator in a loop we already run, one normaliser, one cache bump, two render
sites.

**Risks and unknowns.**

- The exact `TaskCreate`/`TaskUpdate` input shape is **unverified against our own corpus** — it comes
  from the research, not from a file I opened. Before shipping, grep the local transcript corpus for
  `"name":"TaskCreate"` and confirm the field names; if the corpus has zero hits, ship the
  `TodoWrite` path first and leave the Tasks branch behind a shape check.
- Transcript field names are undocumented and Anthropic states the format is internal
  (`_SYNTHESIS.md` §3). Any unrecognised status must map to `null`, never to `pending`.
- Re-parsing every cached transcript once on deploy adds a one-time cost to the first
  `/api/sessions` and `/api/flow` call. Both already sit behind `respCache` TTLs
  (`server/index.mjs:104-107`).

**Definition of done.**

- A session whose transcript contains `TodoWrite` shows its last completed todo list, with counts.
- A session whose transcript contains `TaskCreate`/`TaskUpdate` shows Tasks-API progress, and a
  `TaskUpdate` whose `tool_result` never arrived does **not** advance the count.
- A status string outside the known set renders as unknown, not as `pending`.
- **Null/empty state:** a session with neither tool shows no task row at all — the row is absent, not
  `0/0`. A session with a todo list where every item is `pending` shows `[0/5]`, which is a real
  measurement and must be distinguishable from the absent case.

---

## 3. Slash-command attribution with the two false-clear guards

**Customer need.** "Which skill or slash command actually drove this piece of work" is the question
FlowSection and the ROI ledger exist to answer, and it is the question that decides whether a
capability gets kept or disabled in `CustomizeSection`. Today the answer is a heuristic that the code
itself admits to.

**Value to Loush.** `server/index.mjs:2321-2322` carries the comment: *"ponytail: 'src' attribution =
last Skill invoked since the user's prompt — a heuristic, not a real call graph"*. The variable is
`lastSkill`, set when a `Skill` tool call is seen (`:2378`) and reset to `null` on any user prompt
(`:2367`). That means: a turn started by `/superpowers:brainstorming` is attributed to whatever
`Skill` tool fired inside it, or to nothing at all; and every capability's "fires" count in the ROI
ledger inherits that. Upstream has the precise version, and — more valuable — has the two documented
traps.

**How the upstream repo does it today.** `widgets/slash-command.ts` runs a state machine over user
entries: regex `/<command-name>([^<]+)<\/command-name>/` sets the active command. It is cleared only
when a user entry carries *genuine plain text* and no tag. It explicitly does **not** clear on
`tool_result`-only user entries, and does **not** clear on string payloads beginning with `<`, which
are `<local-command-stdout>` / `<local-command-caveat>` system injections rather than user speech.
Those two guards are the entire difference between correct and plausible-looking attribution.

**How we implement it here.**

- Add the `<command-name>` regex and the state machine to the same `scanTranscripts()` user-entry
  branch at `server/index.mjs:2364-2367`. That branch already skips text starting with `<`, so guard
  (b) is half-implemented by accident — but it skips those entries entirely rather than
  *deliberately not clearing on them*, which happens to produce the right behaviour today only
  because `lastSkill` is reset on the line above by a different condition. Make the intent explicit.
- Guard (a) — `tool_result`-only user entries — is **not** handled today: `:2364` checks
  `j.type === 'user' && !j.isMeta && j.message`, then computes `text` from text blocks only, so a
  `tool_result`-only entry yields empty text and falls through without clearing. Verify that reading
  and add a test, because it is currently correct by construction rather than by decision.
- Emit `cmd` alongside `src` on each invocation record (`:2378-2380`) so FlowSection can distinguish
  "invoked by the user's slash command" from "invoked by a skill that was itself invoked".
- Keep `lastSkill` — the two answer different questions. Do not replace one heuristic with another;
  add the measured field beside it and label which is which.

**Effort. S.** One regex, one state variable, one extra field on an existing record, one cache bump
(fold into Feature 2's `v: 4` if both ship together).

**Risks and unknowns.**

- The `<command-name>` tag shape is from the research; **unverified against our corpus**. Grep for it
  before building the UI on it. If it is absent from local transcripts, this feature is a no-op and
  should be dropped rather than approximated.
- Attribution changes will move numbers in the ROI ledger. Ship it with the denominator visible, per
  `_SYNTHESIS.md` §6.

**Definition of done.**

- A transcript turn preceded by a `<command-name>` tag reports that command on its invocations.
- A `tool_result`-only user entry in the middle of that turn does not clear the attribution.
- A `<local-command-stdout>` injection does not clear the attribution.
- A subsequent genuine plain-text user prompt does clear it.
- **Null/empty state:** turns with no tag report `cmd: null` and FlowSection renders them under an
  explicit "no command attributed" bucket — not folded into the most recent command, and not counted
  toward any capability's fire count.

---

## 4. Measured-vs-estimated cost, and the labelling that goes with it

**Customer need.** Every dollar figure in Loush — Sessions (`server/index.mjs:3035`), the budget
alerts (`:1988-2002`), the sidebar budget chip (`src/App.jsx:241-243`), `/api/gov/costs`
(`:2003-2016`), Insights cost KPIs (`InsightsSection.jsx:92`) — is an estimate presented in the same
typeface as a fact. The user has no way to know which numbers are measured.

**Value to Loush.** `_SYNTHESIS.md` §1 makes this a ruling, not a suggestion, and gives the exact
three-part fix. Two facts from our own code sharpen it:

1. Our estimator is `PRICE_PER_M = m => (/opus|fable/.test(m) ? 15 : /haiku/.test(m) ? 0.8 : 3)`
   (`server/index.mjs:718`) — three regex buckets — combined with `entryCost`
   (`:1987`) whose multipliers are commented, verbatim, "anthropic-ish".
2. **We already read exact cost, in four places, and throw it away for aggregation.**
   `lib/agent.mjs:41`, `server/index.mjs:1032`, `:1972`, `:3500` and `server/ticket.mjs:385` all read
   `total_cost_usd` off the `result` event of a `claude -p` stream we spawned ourselves. So for every
   run *the dashboard drove*, we have the authoritative figure. For sessions the user ran in their own
   terminal, we do not, and cannot — which is the constraint `_SYNTHESIS.md` §1 states: those fields
   exist only on the statusLine stdin payload, never in transcript files. **Do not engineer around
   this.** There is no filesystem path to `cost.total_cost_usd` for a terminal session.

The differentiator is not a better estimate. It is that no surveyed project distinguishes measured
from estimated at all, and we already have both kinds on screen.

**How the upstream repo does it today.** `widgets/cost.ts` reads `stdin.cost.total_cost_usd` and
formats it. It is exact because Claude Code hands it over, and only because of that. Notably, that
widget returns `0` rather than `null` when the field is missing — the one place upstream breaks its
own contract, and the one behaviour here we should not copy.

**How we implement it here.**

- New `lib/pricing.mjs` with a per-model table (input / output / cache-write / cache-read), and an
  explicit `unpriced` return for any model id the table does not know. `_SYNTHESIS.md` §7 Cluster B
  gives the consensus ratios (`output = 5×input`, `cache_write = 1.25×input`,
  `cache_read = 0.10×input`) which our `entryCost` already uses — so the fix is the *per-model rates*,
  not the ratios.
- Every cost value gains a sibling `costBasis: 'measured' | 'estimated' | 'unpriced'`. `collectUsage`
  (`:657-716`) sets `estimated`; anything sourced from a `total_cost_usd` result event sets
  `measured`; an unknown model sets `unpriced` and the cost is `null`, not `0`.
- Render the basis. A `~` prefix on estimated dollars and a tooltip naming the model table is enough;
  `unpriced` renders `—`.
- **Do not** aggregate a measured and an estimated figure into one total without labelling the mix.
  If a 30-day cost sums 3 measured runs and 400 estimated turns, say so.

**Effort. S–M.** One new module, mechanical edits to `entryCost` callers, a badge in three UIs.

**Risks and unknowns.**

- Correct per-model rates must come from a primary source (Anthropic's pricing page) at
  implementation time — I am not carrying numbers across from the research, and `_SYNTHESIS.md` §6
  is explicit that no researched project's figures should be repeated.
- Our totals will change, in some cases by 3×. Announce it; do not let a chart silently re-baseline
  (the `context-mode` ADR-0004 failure mode named in `_SYNTHESIS.md` §6).
- `unpriced` will make some existing totals drop. That is correct and must not be papered over with a
  fallback rate.

**Definition of done.**

- `/api/sessions` rows carry `costBasis`; a run driven through `/api/chat` reports `measured`.
- A transcript with a model id absent from `lib/pricing.mjs` returns `cost: null, costBasis:
  'unpriced'`, and the Sessions row shows `—`.
- The budget chip states whether today's spend is measured, estimated, or mixed.
- **Null/empty state:** with no priced entries at all, `costAlerts()` returns `todayUSD: null` and the
  chip renders "no priced usage today" — never `$0.00`, which today it would (`:1993`, `usd` starts
  at `0` and stays there).

---

## 5. The cheap diagnostics batch: API-time share, generation speed, $/h, cache-hit denominator

**Customer need.** "Is this session waiting on the model or waiting on tools?", "how fast is it
generating?", "what is this costing me *right now*?" Today the user has session duration and token
counts in Sessions (`server/index.mjs:3022-3051`) and must divide them mentally.

**Value to Loush.** Four one-line metrics over data `collectUsage()` already has, and one correctness
alignment. Each is a few lines; batching them is what makes the batch worth a ticket.

**How the upstream repo does it today.**

- `apiDuration`: `round(cost.total_api_duration_ms / cost.total_duration_ms * 100)`, capped at 100,
  warning colour above 70 %. Answers API-bound vs tool-bound.
- `tokenSpeed`: `total_output_tokens / (total_api_duration_ms / 1000)`. Divides by **API** time, not
  wall time — this is generation speed, not throughput. That denominator choice is the whole insight.
- `forecast`: `(total_cost_usd / elapsedMinutes) * 60`, with `minMinutes = 1` so it cannot divide by
  a near-zero elapsed.
- `cacheHit`: `cache_read / (cache_read + input + cache_creation) * 100` — **output tokens excluded
  from the denominator** — clamped to [0,100], with the colour deliberately inverted so high is green.
- `peakHours`: pure `Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles', …}).formatToParts`
  + weekday arithmetic; peak = Mon–Fri, 05:00–11:00 PT. No network, no dependency, DST-correct.

**How we implement it here.**

- `apiDuration` and `tokenSpeed` need API duration, which transcripts do not carry — so they are
  available **only** for runs we drove, where `duration_ms` and `usage` are on the `result` event
  (`server/index.mjs:1032`). Compute them there, attach to the run record, and render them in Runs and
  in `/api/sessions` rows *only for those sessions*, with the rest returning `null`. Do not
  substitute wall-clock duration (`durationMs` at `:3040`, computed as `last - first`) — that answers
  a different question and would be exactly the kind of laundering `InsightsSection.jsx:11-13`
  warns about.
- Hourly `$/h` sits beside the existing month-end projection from `lib/harness-usage-trends.mjs`
  (`projectMonthEnd`, called at `server/index.mjs:780`). Inherits `costBasis` from Feature 4.
- Align our cache-efficiency denominator with upstream's. We compute `cacheReadPct` as
  `f.cr / (f.in + f.cc + f.cr)` at `server/index.mjs:3035-3036` — which already excludes output and
  already matches upstream exactly. **Verified: no change needed.** Record that in a comment so the
  next person does not "fix" it by adding output to the denominator; upstream's own `performance`
  widget makes precisely that mistake against its neighbouring `cacheHit` widget (research §Gaps).
- `peakHours` as a small Overview tile: `src/lib/format.mjs`, pure function, no dependency.

**Effort. S.** Four small computations, one comment, one tile.

**Risks and unknowns.**

- `peakHours` encodes Anthropic's Pacific-time peak window as of the research date. It is a
  heuristic about someone else's capacity planning and can silently become wrong. Label it as a
  heuristic in the tile, with the window stated, or skip it.
- `apiDuration`/`tokenSpeed` covering only dashboard-driven runs will look like a bug to a user
  looking at a Sessions table where most rows are blank. The column header must say why.

**Definition of done.**

- A run started from Chat shows API-time share and tok/s; a session run in the user's own terminal
  shows `—` in those columns with a header tooltip explaining that Claude Code does not write API
  duration to transcripts.
- `$/h` appears next to the month-end projection and carries the same `costBasis` badge.
- The cache-denominator comment exists at `server/index.mjs:3035`.
- **Null/empty state:** every one of these renders `—` when its input is missing. `tokenSpeed` with
  zero API duration renders `—`, not `Infinity` and not `0`.

---

## 6. Cross-process file cache with negative caching and stale-while-error

**Customer need.** When `gh` or JIRA hiccups, the Delivery section goes blank and the Overview shows
its "not configured" card (`Overview.jsx:93-98`) even though a perfectly good snapshot was on screen
sixty seconds ago. The user reloads and waits.

**Value to Loush.** Our caching is entirely in-process. `respCache` is a `Map` cleared on any write
(`server/index.mjs:110-112`), `usageCache` (`:656`) and `scanCache` (`:2298`) are `Map`s keyed by
`(mtime, size)`, `gitCache` (`:799`) is a 10-minute `Map`. All four die with the process. A restart
therefore pays the full cold-start cost, and a transient upstream failure has no last-good state to
fall back to.

**How the upstream repo does it today.** `scripts/utils/file-cache.ts`: a `{data, timestamp}` envelope
in `~/.cache/claude-dashboard/`, directory mode `0700`, files `0600`, filenames prefixed by kind. No
locking — "first writer wins, concurrent writes are idempotent". Alongside it:
`CacheEntry` is a discriminated union `{data, timestamp, isError: false} | {data: null, timestamp,
isError: true}`; error entries expire after `NEGATIVE_CACHE_SECONDS = 30` regardless of the configured
TTL; on a live failure the client falls back to the file cache with `STALE_CACHE_TTL_SECONDS = 3600`
rather than showing an error; a `pendingRequests: Map<key, Promise>` dedupes concurrent callers; and
a prefix-allowlisted GC sweeps files older than an hour, throttled in-process to once per hour.

**How we implement it here.**

- New `server/lib/file-cache.mjs`. Store under `path.join(CLAUDE, 'cache', 'dashboard')` — note
  `~/.claude/cache` already exists on this machine, so pick a subdirectory rather than colonising it.
  Do **not** write outside the existing allowed roots (`ALLOWED_ROOTS`, `server/index.mjs:124-130`);
  `CLAUDE` is already root #1.
- Port the prefix allowlist for GC. Upstream's own `fileCachePath()` documents that it does not
  sanitise `../`; ours must, because `safe()` at `:125-130` is the established pattern in this
  codebase and there is no reason to have a second path-building function that skips it.
- Wire behind the snapshot caches first — the eng snapshot and CI cache are the ones whose failure is
  user-visible — then behind `respCache` (`:111-121`).
- Add the negative-cache + stale-while-error semantics as *separate* states in the payload:
  `{ ok, stale: true, at }` so the UI can render "showing the snapshot from 12 minutes ago —
  `gh` is failing" instead of either a lie or a blank.

**Effort. S–M.** ~120 lines plus wiring. The semantics are the work, not the file I/O.

**Risks and unknowns.**

- Persisting a cache across restarts makes us stateful in a way we are not today — `_SYNTHESIS.md`
  §8 Tier 3.5 flags this as a decision worth weighing. Mitigate by making every cached payload
  reconstructible from disk, so deleting the cache directory is always safe and always correct.
- Windows file modes: `0700`/`0600` are advisory on Windows and will not enforce anything. Do not
  claim the cache is protected; state that it inherits the user profile's ACL.
- A stale snapshot rendered without an unmistakable staleness marker is worse than a blank one. The
  marker is not optional polish; it is the feature.

**Definition of done.**

- Killing and restarting the server serves the previous eng snapshot immediately, marked with its
  age, and refreshes in the background.
- Forcing a `gh` failure keeps the last good snapshot on screen for up to an hour with a visible
  staleness banner, then falls back to the existing "not configured / unavailable" card.
- Two concurrent requests for the same key issue one upstream fetch.
- Deleting `~/.claude/cache/dashboard` causes a cold rebuild and no error.
- **Null/empty state:** with no cache file and a failing upstream, the response is
  `{ available: false, reason }` and the Overview renders the existing not-configured card
  (`Overview.jsx:93-98`) — never an empty chart, never zeros.

---

## 7. Incremental byte-offset transcript parsing

**Customer need.** Section loads get slower as transcript history grows, and the "refresh" chip in
the topbar (`src/App.jsx:421-428`) has to be pressed and waited on.

**Value to Loush.** Our caches are keyed on `(mtime, size)` — `usageCache` at `server/index.mjs:667`
and `scanCache` at `:2312` — so appending a single line to an active session's transcript invalidates
the whole record and re-reads and re-parses the entire file with
`fs.readFileSync(f, 'utf8').split('\n')` (`:671`, `:2324`). For an active session this happens on
every turn, for the whole file, twice (both scans walk the same corpus independently).

**How the upstream repo does it today.** `scripts/utils/transcript-parser.ts` caches
`{path, size, data}` and, when the file has only *grown*, `open()`s at the previous byte offset and
parses only the delta into the existing `ParsedTranscript`. A full re-parse happens only on first load
or when the file shrank (truncation / compaction). Running tools, agents, tasks and the last
`TodoWrite` are maintained incrementally in `processEntries()`, so each extractor stays O(k) in the
delta rather than O(file).

**How we implement it here.**

- Extract the shared walk into `server/lib/transcript-scan.mjs` with an explicit
  `{ path, size, offset, state }` record. Both `collectUsage` and `scanTranscripts` become consumers
  that supply reducers; today they duplicate a directory walk (`:660` and `:2302`) and a line loop.
- Grow path: `size > cached.size` → read bytes `[cached.size, size)` and reduce only those lines,
  carrying a partial-line remainder across reads. Shrink or `mtime` change without growth → full
  re-parse. This is the correctness-critical branch: compaction rewrites transcripts.
- **Do not** make the cache a single-file singleton the way upstream does. Ours is per-file and must
  stay per-file — we scan a whole corpus, upstream scans one active session. The research flags this
  exact hazard.
- The reducers must stay associative over line batches. Our accumulators
  (`rec.entries`, `rec.tools`, `rec.first`/`rec.last`, `rec.branches`) already are; the caps
  (`rec.edits.length < 400` at `:2362`, `rec.texts.length < 400` at `:2370`) are order-dependent and
  will now cap on the *first* 400 rather than a re-derived 400. That is the same behaviour, but
  verify it.

**Effort. M.** This is a refactor of the two hottest functions in the server. It should be done after
Features 2 and 3, so their new extractors are written once against the new shape.

**Risks and unknowns.**

- Compaction/truncation handling is the whole risk. A wrong shrink check silently drops history and
  every downstream number quietly shrinks. Add a test with a file that shrinks.
- UTF-8 multi-byte sequences can straddle a read boundary. Use a `Buffer` and a decoder that carries
  state, not `readFileSync(…, 'utf8')` on a slice.
- Windows line endings: our existing loops split on `\n` and tolerate a trailing `\r` because
  `JSON.parse` does. Preserve that.

**Definition of done.**

- Appending one line to a 10 MB transcript and re-calling `/api/usage?fresh=1` parses only the
  appended bytes (assert via an instrumented counter, not a stopwatch).
- Truncating a transcript triggers a full re-parse and produces the same totals as a cold start.
- `/api/usage` and `/api/sessions` return byte-identical payloads before and after the refactor on a
  static corpus.
- **Null/empty state:** a zero-byte or unparseable transcript yields a record with zero entries and is
  excluded from `recentSessions` by the existing `f.msgs > 0` filter (`:768`) — it does not appear as
  a session with 0 tokens.

---

## 8. Two git facts we do not have: distance from last tag, and the uncommitted pile

**Customer need.** "How much has shipped since the last release?" and "how big is the pile I have not
committed?" Delivery answers neither.

**Value to Loush.** Verified: the only `git rev-list` in the tree is a commit *count* for the
Projects list (`server/index.mjs:805`), and there is no `git describe` anywhere. WorkingSet measures
*lines the agent edited* from `structuredPatch` (`server/index.mjs:691-699`, `:2352-2362`) — a
deliberate and different question, as the research notes. Neither answers "what is uncommitted right
now".

**How the upstream repo does it today.** `tagStatus`: `git describe --tags --abbrev=0 --match <glob>
HEAD` then `git rev-list --count <tag>..HEAD`, rendering `v1.2.3+5`; patterns configurable, default
`["v*"]`; 30 s cache keyed on `(cwd, patterns)`; hides when nothing matches. `linesChanged`:
`git diff HEAD --shortstat` parsed by regex, **plus untracked-file line counts folded into
`added`** — the refinement everyone misses; 10 s cwd-keyed cache that caches `null` on failure too,
so an empty repo with no HEAD does not retry every render. All git calls use
`git --no-optional-locks`, which is the correct flag for a read-only observer.

**How we implement it here.**

- Both go in `repoInfo()` (`server/index.mjs:801-816`), which already spawns git per directory behind
  a 10-minute cache. Follow upstream and cache the *failure* too — an empty repo currently re-spawns
  git on every miss.
- Add `--no-optional-locks` to the existing `rev-list` call at `:805` while we are there.
- **Windows.** Upstream's `countUntrackedLines()` shells out to
  `sh -c "git ls-files --others --exclude-standard -z | xargs -0 cat | wc -l"`, swallows the failure,
  and returns `0`. On this user's machine (`win32`, `WIN` is checked at `server/index.mjs:47`) that is
  a silent undercount presented as a measurement — the exact failure mode this codebase exists to
  avoid. Reimplement in Node: `git ls-files --others --exclude-standard -z`, split on `\0`, read each
  file, count `\n`. Cap the file count and total bytes, and if the cap is hit return `null` with a
  reason rather than a partial count. `_SYNTHESIS.md` §9 names this specific function as a porting
  hazard.
- Render tag distance in `DeliverySection`, uncommitted pile as a WorkingSet column.

**Effort. S–M.** Two git invocations, one Node reimplementation of a shell pipeline, two render sites.

**Risks and unknowns.**

- A repo with no tags matching the pattern must hide the tag chip, not show `+0`.
- Reading every untracked file to count lines is unbounded on a repo with a large untracked
  `node_modules`-adjacent directory. `--exclude-standard` respects `.gitignore`, which handles the
  common case, but the cap is still required.
- Tag patterns are per-project config; we have `readMeta()`/`META_FILE` (`server/index.mjs:556-557`)
  for exactly this kind of preference. Default `v*`.

**Definition of done.**

- A repo with tags shows `<tag>+<n commits>`; a repo with none shows no chip at all.
- The uncommitted-lines count includes untracked files **on Windows**, verified against a manual
  count on a repo with one tracked edit and one new file.
- An empty repo with no HEAD returns `null` once and does not re-spawn git for the cache lifetime.
- **Null/empty state:** every value here is `null`-not-`0` on failure. A repo where git is
  unavailable renders `—` with the reason in a tooltip; it never renders `+0 -0`, which would read as
  "clean".

---

## 9. Session identity facts: `/rename` title, Claude Code version, output style, effort and fast mode

**Customer need.** The Sessions ledger and the Overview "Recent sessions" panel
(`Overview.jsx:236-260`) identify sessions by project name and raw UUID. A user who renamed a session
with `/rename` sees the rename nowhere. A user diagnosing an odd session cannot see which Claude Code
version or which effort level produced it.

**Value to Loush.** Small, but these are the cheapest possible improvements to a screen the user looks
at constantly, and one of them (version) is the only way to explain "why did that session behave
differently".

**How the upstream repo does it today.** `sessionName` prefers `stdin.session_name` and falls back to
the transcript's `customTitle` field. `version` is a passthrough of `stdin.version`. `outputStyle`
reads `stdin.output_style.name` and returns `null` for missing or `'default'`. `model` reads
`effortLevel` / `fastMode` from `${CLAUDE_CONFIG_DIR|~/.claude}/settings.json` plus
`CLAUDE_CODE_EFFORT_LEVEL`, with the settings file cached by `(path, mtime)`.

**How we implement it here.**

- `customTitle` is the only one reachable from a transcript. Pick it up in the `scanTranscripts()`
  walk and expose it as `title` on `/api/sessions` rows (`server/index.mjs:3022-3051`), falling back
  to the existing project + id display. Note `/api/pins` rows already render `p.label || p.title ||
  p.sessionId` (`Overview.jsx:245`) — the field name is already in the UI's vocabulary.
- `effortLevel` / `fastMode` come from `~/.claude/settings.json`, which we already read at
  `server/index.mjs:637` and `:421` via `SETTINGS_FILES.user` (`:328-332`). Surface in
  `HarnessSection` as current-configuration facts, **not** as per-session facts — they describe the
  harness now, not the harness that produced a past session, and presenting them per-row would be a
  fabrication.
- `version` and `outputStyle` are statusLine-stdin-only per the research. Check whether the
  transcript carries a version field before speccing any UI — if it does not, drop them.

**Effort. S.**

**Risks and unknowns.**

- `customTitle`'s location in the transcript is **unverified** — grep the corpus first.
- Whether transcripts carry a Claude Code version is **unverified**. If not, this reduces to
  `customTitle` + the two settings facts.

**Definition of done.**

- A session renamed with `/rename` shows its title in Sessions and in the Overview recent-sessions
  panel.
- Harness config shows effort level and fast mode when set, and shows nothing when unset — not
  "default", which would be a guess about Claude Code's internal fallback.
- **Null/empty state:** a session with no `customTitle` keeps the current project + id display; no
  placeholder title is invented.

---

## 10. Configurable Overview backed by a widget registry

**Customer need.** Every user sees the same Overview. A user without JIRA and `gh` sees a
not-configured card in the top fold (`Overview.jsx:93-98`) — which the code comments at
`src/App.jsx:59-61` already acknowledge as a problem serious enough to have re-ordered the whole
sidebar around it. A user who does not care about delivery cannot demote it. Today the workaround is
scrolling.

**Value to Loush.** This is `_SYNTHESIS.md` §8 Tier 3.4, rated **L** and gated on the argument being
worth it. The full argument is in §"The configurable Overview" below; the short version is that the
`getData → T | null` contract is worth adopting for the honesty property alone, and configurability is
a secondary benefit that arrives nearly free once the registry exists.

**How the upstream repo does it today.** `scripts/widgets/index.ts` is a `Map<WidgetId, Widget>`.
`getLines(config)` resolves a preset to `lines: WidgetId[][]`, filters `disabledWidgets`, and drops
lines that become empty. Each line renders with `Promise.all` so a git subprocess and an API call
overlap. Each `renderWidget` is individually try/caught: a throwing widget is logged and skipped.
Empty outputs are filtered before joining. Config lives in a JSON file with `lines`,
`disabledWidgets`, `displayMode`, and a single-character preset DSL. Setup is a markdown slash command
in which each layout option carries a literal ASCII preview of the resulting status line — the user
picks by looking at the output, not by reading widget names.

**How we implement it here.**

- New `src/lib/widgets/registry.js`: `{ id, name, group, useData, Render }`. `useData` returns
  `T | null`; `null` means the host renders nothing at all for that widget — no tile, no `—`, no slot.
- New `src/ui/WidgetHost.jsx`: maps a row of ids to components, wraps each in an error boundary
  (upstream's per-widget try/catch), and drops rows that end up empty.
- `Overview.jsx` becomes a thin host over a default layout. The five DeliveryTiles (`:63-119`), the
  CI strip (`:122-154`), the capability headline (`:193-204`), the four usage KPIs (`:206-216`), Top
  projects, Recent sessions, Memory (`:263-285`) and Prompt quality (`:287-311`) each become a
  registered widget. All are already independently-fetching, independently-rendering blocks — this is
  mostly moving code, not rewriting it.
- Persist layout in `readMeta()` / `META_FILE` (`server/index.mjs:556-557`), which is our existing
  user-preferences store (already holds tags, pins, team harness). A new `meta.overview = { rows:
  string[][], disabled: string[] }`. No new endpoint shape needed beyond a GET/PUT pair alongside the
  existing `/api/tags` (`:645-653`).
- Editor UI sits in `CustomizeSection` as an eighth category. Note the scope collision: today
  `CustomizeSection` toggles *Claude Code capabilities* (`CATS` at `CustomizeSection.jsx:10-18`), and
  a toggle there changes what Claude loads (`:174-176`). Dashboard layout is a different kind of
  thing. Either give it a clearly separated panel with different copy, or put it behind an "edit
  layout" affordance on the Overview itself. Do not let "disable" mean two things in one screen.
- Take the live preview from upstream's setup command. In a web UI, the ASCII preview becomes the
  actual Overview rendering behind the editor.

**Effort. L.** Two weeks-ish including the editor. Sequence: registry + host + default layout that
renders identically to today (shippable on its own and valuable on its own) → persistence →
reordering → editor.

**Risks and unknowns.**

- **The refactor can silently change what the Overview shows.** Land step 1 with a byte-comparison of
  the rendered default layout against the current page before touching anything else.
- `BASE_SECTIONS` (`src/App.jsx:50-206`) is a different structure — top-level *navigation*, with
  section-level comments explaining ordering decisions (`:59-61`, `:86-88`, `:131-132`, `:176-178`).
  **Do not make navigation configurable in this work.** Those comments are design rationale for a
  deliberate information architecture; making the sidebar user-sortable throws them away for a benefit
  nobody asked for. Scope this to the Overview grid.
- Configurability is a support surface: a user who hides a tile and forgets will report the data as
  missing. Mitigate with a persistent "N widgets hidden" affordance.

**Definition of done.**

- Step 1: `Overview.jsx` renders through the registry and is visually identical to the current page.
- A widget whose `useData` returns `null` renders **nothing** — asserted by a test that the DOM
  contains no node for that widget id, not merely that it contains `—`.
- A widget that throws is skipped, is logged, and does not break the rest of the page.
- Layout survives a reload and a server restart.
- Hiding every widget in a row removes the row; hiding all widgets shows a single explicit empty
  state that offers to restore defaults.
- **Null/empty state:** on a machine with nothing configured — no JIRA, no `gh`, no transcripts — the
  Overview shows the small set of widgets that can actually compute, plus one honest card explaining
  what is missing. It does not show ten empty tiles.

---

## Widget triage

All 42 registered widget ids (40 from `PRESET_CHAR_MAP` plus the two derived widgets `sessionIdFull`
and `geminiUsageAll`). "Data source" uses the research's notation: **stdin** = the statusLine JSON
payload, **transcript** = the session `.jsonl`, **API** = a network call.

| Widget | Data source | Do we already have it? (which section) | Worth porting? | Effort |
|---|---|---|---|---|
| `model` | stdin + `settings.json` | Partial — Harness config, Sessions model column. Effort/fast mode: **no** (`server/index.mjs:637` reads settings but not these keys) | Yes, effort + fast mode only (Feature 9) | S |
| `context` | stdin `context_window` | Yes, deeper — ContextExplorer replays per-turn occupancy (`server/index.mjs:3052+`) | No. Steal only the "prefer the official percentage over ours" precedence rule | S |
| `contextBar` | derived from `context` | Yes — ContextExplorer | No | — |
| `contextPercentage` | derived from `context` | Yes — ContextExplorer | No | — |
| `contextUsage` | derived from `context` | Yes — ContextExplorer | No. But the *derived-widget pattern* (one `getData`, three `render`s) is the registry idea (Feature 10) | — |
| `cost` | stdin `cost.total_cost_usd` | Partial — we estimate (`server/index.mjs:718`, `:1987`); exact only for runs we drove (`lib/agent.mjs:41`) | **Yes** — as the measured/estimated split (Feature 4). The exact field is unreachable for terminal sessions | S–M |
| `projectInfo` | stdin + 4 git subprocesses | Partial — Projects section; branch comes from the transcript `gitBranch` field (`server/index.mjs:687`), stale for "right now" | Maybe. The combined 5 s git cache and SSH→HTTPS normaliser are liftable | S |
| `rateLimit5h` | stdin `rate_limits` else API | **No.** Our 5-hour block (`server/index.mjs:727-740`) is inferred from transcript timestamps — a billing-window bucket, not a quota reading | **Maintainer decision** — see below. Unreachable from the filesystem | M |
| `rateLimit7d` | stdin / API | No | Same decision | M |
| `rateLimit7dSonnet` | API only | No | **No** — dead field, returns `null` since ~2026-06 | — |
| `rateLimit7dFable` | API `limits[]` only | No | Same decision as `rateLimit5h`; no independent value | — |
| `sessionId` | stdin | Yes — Sessions (`server/index.mjs:3033`) | No | — |
| `sessionIdFull` | derived from `sessionId` | Yes — Sessions, and the `--resume` string (`:3047`) | No | — |
| `sessionDuration` | stdin, else own start-time file | Yes — `durationMs` (`server/index.mjs:3040`) | No | — |
| `sessionName` | stdin, else transcript `customTitle` | **No** — renamed sessions show raw ids | Yes (Feature 9) | S |
| `configCounts` | filesystem | Yes, far deeper — CapabilityLedger prices each item; Customize toggles them | No. **Except** the three-location MCP merge: upstream reads `./.claude/mcp.json` + `~/.claude.json` + `~/.config/claude-code/mcp.json`; we read the first two (`server/index.mjs:838-839`, `:413-414`). The XDG path may be a blind spot — verify | S |
| `toolActivity` | transcript | Yes historically — Chat, Forensics, `rec.toolCalls` (`:2372`) | Partly — `extractToolTarget()` (Read/Write/Edit→basename, Glob/Grep→pattern, Bash→command) is a good label helper | S |
| `agentStatus` | transcript `Task` blocks | Yes, deeper — we link subagents into a tree by `toolUseId` (`server/index.mjs:900-905`); they count them | No | — |
| `agentMode` | stdin `agent.name` / `agent_type` | No | No — stdin-only, no transcript equivalent found | — |
| `todoProgress` | transcript Tasks API → TodoWrite | **No.** Zero parsing anywhere; `SKIP_DIRS` even excludes `todos` (`server/index.mjs:497`); `PlanGraph.jsx:231` has glyphs only | **Yes — Feature 2.** Biggest genuine blind spot in this list | S–M |
| `slashCommand` | transcript `<command-name>` | Partial — `lastSkill` heuristic, self-labelled as such (`server/index.mjs:2321-2322`) | **Yes — Feature 3.** The two false-clear guards are the value | S |
| `burnRate` | stdin + elapsed | Yes, deeper — `lib/harness-usage-trends.mjs`, trend-aware | No | — |
| `tokenSpeed` | stdin output tokens / API duration | No | Yes, for dashboard-driven runs only (Feature 5) | S |
| `depletionTime` | rate limits + elapsed | No | **No** — depends on rate limits, and upstream's own version assumes all quota came from this session; its `'7d'` branch is dead code | — |
| `cacheHit` | stdin `current_usage` | Yes — `cacheReadPct` (`server/index.mjs:3035-3036`), and our denominator already matches theirs exactly | No change. Add a comment locking the denominator (Feature 5) | S |
| `performance` | stdin, composite | Yes, better — `lib/harness-health.mjs` graded score | **No** — theirs is an undefended `0.6·cacheHit + 0.4·outputRatio` that fetches elapsed minutes and never uses them | — |
| `tokenBreakdown` | stdin `current_usage` | Yes — UsagePanel, ContextExplorer, same four counters (`server/index.mjs:681`) | No | — |
| `forecast` | cost / elapsed × 60 | Partial — we project to month-end (`projectMonthEnd`, `:780`) but have no `$/h` | Yes (Feature 5) | S |
| `budget` | cost + ledger file + `dailyBudget` | Yes — `costAlerts()` (`server/index.mjs:1988-2002`), sidebar chip (`App.jsx:241-243`), 80 %/100 % thresholds | Mechanism no (we are server-side, they are per-render). **Do not copy their UTC rollover** — it resets a Western user's day mid-afternoon | — |
| `todayCost` | same ledger | Yes — `todayUSD` (`:2001`) | No | — |
| `apiDuration` | stdin API/total duration | No | Yes, for dashboard-driven runs only (Feature 5) | S |
| `codexUsage` | `~/.codex/auth.json` → ChatGPT API | No | **No** — contradicts our Claude-only scope; adds an undocumented endpoint | — |
| `geminiUsage` | Gemini OAuth → Google API | No | **No** — same, plus upstream hard-codes an OAuth `client_secret` | — |
| `geminiUsageAll` | derived from `geminiUsage` | No | **No** | — |
| `zaiUsage` | `ANTHROPIC_BASE_URL` → z.ai quota | No | **No.** Their provider mutual-exclusion pattern is worth remembering if we ever add providers | — |
| `linesChanged` | `git diff --shortstat` + untracked | Different question — WorkingSet counts *agent-edited* lines from `structuredPatch` (`server/index.mjs:691-699`) | Yes, as a second column: "uncommitted pile" (Feature 8). **Must be reimplemented in Node for Windows** | S–M |
| `tagStatus` | `git describe` + `rev-list` | **No** — no `git describe` anywhere in the tree | Yes (Feature 8) | S |
| `outputStyle` | stdin `output_style.name` | No | Only if a transcript field exists — **unverified** | S |
| `vimMode` | stdin `vim.mode` | No | **No** — terminal-only concept | — |
| `version` | stdin `version` | No | Only if a transcript field exists — **unverified**. Would pin which Claude Code produced a session | S |
| `peakHours` | system clock only | No | Yes, cheap — but label it a heuristic about someone else's capacity (Feature 5) | S |
| `lastPrompt` | **`~/.claude/history.jsonl`** | **No** — we never open the file. Verified: zero references in the tree | **Yes — Feature 1, the highest value ÷ effort item here.** Not for the widget; for the corpus | S |

---

## The configurable Overview

**The question.** Our section list is a hardcoded array — `BASE_SECTIONS` at `src/App.jsx:50-206`,
plus `COMPANY_SECTION` (`:212-226`) appended by `sectionsFor(features)` (`:227`) when a flag is on.
Overview's contents are likewise hardcoded JSX (`src/sections/Overview.jsx:188-316`). Upstream has a
`Map<WidgetId, Widget>` registry and a persisted `lines: WidgetId[][]`. Should we have one?

**What a registry looks like here.** Concretely:

```js
// src/lib/widgets/registry.js
export const WIDGETS = new Map([
  ['delivery.inFlight', {
    id: 'delivery.inFlight',
    name: 'In flight',
    group: 'Delivery',
    useData: () => { /* returns null when the eng snapshot is unavailable */ },
    Render: ({ data }) => <Kpi … />,
  }],
  …
])
```

and a host that maps `meta.overview.rows` to components, wraps each in an error boundary, and drops
rows that render nothing. The candidate widgets already exist as separable blocks in `Overview.jsx`:
`DeliveryTiles` (`:63-119`), `CiStrip` (`:122-154`), the capability headline (`:193-204`), four usage
KPIs (`:206-216`), Top projects (`:219-235`), Recent sessions (`:236-260`), Memory (`:263-285`),
Prompt quality (`:287-311`). Each already fetches independently in the mount effect (`:167-178`) and
each already has its own conditional render. The registry mostly formalises a structure that is
already latent in the file.

**What it costs.**

- The migration itself: a week to move eight blocks behind an interface without changing what renders,
  plus a byte-level comparison to prove it.
- Persistence and an editor: another week, including the scope collision with `CustomizeSection`,
  where "disable" currently means "change what Claude loads" (`CustomizeSection.jsx:174-176`) and
  would now also mean "hide a dashboard tile".
- A permanent support surface: hidden widgets that users forget they hid.
- A permanent constraint on Overview design: once tiles are user-orderable, we lose the ability to
  make the layout itself argue something. The comments in `App.jsx:59-61` and `Overview.jsx:12-27`
  are that argument written down — Working Set sits under Overview *specifically because* Overview's
  top fold is a not-configured card for anyone without JIRA and `gh`; the gamification layer was
  deleted rather than made optional because "one product decision away from a per-engineer
  leaderboard, at which point every number on this screen stops being trusted"
  (`src/App.jsx:40-44`). A configurable dashboard is a dashboard with no opinion.

**The position I would argue: adopt the contract, defer the configurability.**

The registry's two properties are separable, and they are worth very different amounts.

*The contract is worth a lot.* `getData → T | null`, where `null` removes the widget from the DOM, is
our honesty rule with a compile-time-ish enforcement point. Right now that rule is three separate
conventions (`Overview.jsx:9-10`, `InsightsSection.jsx:11-13`, `Overview.jsx:93-98`) held together by
code review and a comment that names the exact idiom that broke it before —
`Math.round((x || 0) * 100)`, "the idiom that laundered every honest null". A registry makes the
failure structurally impossible for anything on the Overview: a widget with no data returns `null`
and the host never calls its renderer, so there is no code path in which a fabricated zero can be
produced. That is worth the migration on its own, and it ships without any editor UI, any persistence,
or any user-visible change at all. It is the strongest single argument in this entire spec.

*Configurability is worth much less than it looks.* The stated need — "a user without JIRA sees a
not-configured card in the top fold" — is better solved by the contract than by a preferences screen:
if `DeliveryTiles.useData` returns `null` when the snapshot is unavailable, the card disappears and the
next widget moves up. No configuration required, and the user does not have to discover a settings
panel to fix a first-run experience. Most of what a layout editor would be used for is
*self-hiding done manually*.

So: **do the registry, ship it invisible, and let the null contract do the work.** Add persistence and
an editor only if, after living with a self-hiding Overview for a while, there is still a concrete
complaint that ordering solves. That converts Feature 10 from an L into an M for the part that
matters, and leaves the L part unspent until it is justified.

One more thing worth stealing regardless of that decision: upstream's setup command shows each layout
option with a **literal ASCII preview of the resulting status line** — the user picks by looking at
output rather than reading widget names. If we ever build the editor, the preview is the actual
Overview rendering, and it should be the primary interface rather than a checkbox list.

---

## Needs a maintainer decision

**The `api.anthropic.com/api/oauth/usage` endpoint.** This is a decision for the maintainer, not an
adoption, and it is stated here separately rather than inside a feature list because it is not a
technical question.

**What it would give us.** The one thing Loush genuinely cannot answer: *how much of my Max/Pro plan
is left, and when does it reset.* Our nearest equivalent — the 5-hour block at
`server/index.mjs:727-740` — is inferred from transcript timestamps. It is a billing-window bucket,
not a quota reading, and it is presented in the Overview's first usage KPI as "5h output" with
"resets in …" (`Overview.jsx:207-208`), which is honest about what it measures but is not the number
the user actually wants.

**The terms question, plainly.** Anthropic's February 2026 consumer-terms update states that
Free/Pro/Max OAuth credentials may not be used "in any other product, tool, or service — including
the Agent SDK". Server-side enforcement shipped in January 2026 returning *"This credential is only
authorized for use with Claude Code…"*. Using this endpoint means reading a consumer OAuth token out
of Claude Code's Keychain entry or `.credentials.json` and calling the API from a separate process
under our own User-Agent. Whether a read-only usage query counts as "another product, tool, or
service" is **genuinely unresolved**: the research found ~3,200 repos doing it, no publicly reported
enforcement action, and zero public discussion of this specific case. A local web dashboard is a
*weaker* "inside Claude Code" claim than a status-line plugin is.

Two further facts that bear on the decision:

- The endpoint is undocumented, unversioned, and gated behind `anthropic-beta: oauth-2025-04-20`. Its
  `seven_day_sonnet` field already went permanently `null` once (~2026-06). There is no contract.
- It aggressively 429s callers whose User-Agent is not `claude-code/<version>`
  (`anthropics/claude-code` issue #31637, closed as "not planned" with no Anthropic engagement). The
  only way to get the generous bucket is to misrepresent the client, which makes the terms question
  worse rather than better.

**Recommendation: leave it out.** This matches `_SYNTHESIS.md` §8, which states it directly: *"A web
dashboard is a weaker 'inside Claude Code' claim than a plugin. **Recommendation: leave it out.** The
five-hour block we already compute covers most of the need."*

**If the maintainer decides otherwise**, the only acceptable shape is:

- Off by default, behind an explicit setting the user must turn on, with the terms question stated in
  the UI at the point of enabling — not in a README.
- The token never leaves the server. No endpoint returns it; the browser sees percentages only. This
  matches the existing credential discipline in `server/setup.mjs`, where secret values are never
  returned and the client only learns `set: true|false` (`server/index.mjs:59-61`).
- Our own honest User-Agent. If that means 429s, the feature degrades to `null` and the tile
  disappears — which the null contract already handles correctly.
- The tile must be labelled as reading an undocumented endpoint that can break or be withdrawn.

Everything downstream of that endpoint — `depletionTime` in particular — inherits the same decision
and should not be specced separately.

---

## Not worth taking

| Item | Why not |
|---|---|
| `depletionTime` | Assumes 100 % of the 5-hour window's utilization came from the current session — wrong with two terminals open or a session started mid-window. Its `limitType` is hard-coded to `'5h'` while the type advertises `'7d'`, making that branch dead code. And it needs rate limits first, which we are recommending against. |
| `performance` composite badge | `0.6 × cacheHitRate + 0.4 × outputRatio` with no stated justification; a high output ratio is not obviously efficiency. It also fetches and null-checks elapsed minutes and never uses them. `lib/harness-health.mjs` already gives a graded multi-factor score with null discipline. Keep their *idea* of one glanceable tile; not their formula. |
| Their `budget` UTC rollover | `new Date().toISOString().slice(0,10)` rolls the spending day at UTC midnight; a user west of UTC sees the budget reset mid-afternoon. `_SYNTHESIS.md` §8 Tier 1.8 flags that we already have this bug in ≥3 places — do not import a fourth. Our `costAlerts()` at `server/index.mjs:1990` and `:1994` uses exactly this idiom and should be fixed, not copied. |
| `cost` returning `0` when the field is missing | The single place upstream violates its own `null`-means-disappear contract. Ours must return `null`. |
| `countUntrackedLines` as written | Requires `sh`, `xargs`, `cat`, `wc`; fails on stock Windows and silently returns `0`. Our user runs Windows (`server/index.mjs:47`). Port the *idea*, reimplement the mechanism in Node (Feature 8). |
| `rateLimit7dSonnet` | Dead field since ~2026-06. |
| `vimMode` | Terminal-only concept with no web analogue. |
| Multi-CLI: `codexUsage`, `geminiUsage`, `geminiUsageAll`, `zaiUsage`, `check-usage` | Their strongest differentiator and a straight contradiction of Loush's Claude-only scope. Adds three more undocumented endpoints; `gemini-client.ts` hard-codes an OAuth `client_secret` that will trip secret scanners. Decline. |
| The 403 → `curl` subprocess fallback | Passes a bearer token on the argv, visible in `ps`. Moot if we decline the endpoint; if we ever do not, this specific mitigation must be redesigned. |
| The single-char preset DSL (`"MC$R\|BDO"`) | Charming in a JSON config file for terminal users. In a web app with a live preview it is strictly worse than clicking. |
| Making `BASE_SECTIONS` user-orderable | Out of scope for the widget registry. The ordering comments at `src/App.jsx:59-61`, `:86-88`, `:131-132`, `:176-178` are recorded design decisions; user-sorting discards them for no stated need. |
| Nine theme palettes | Not in my assigned scope, and cheap enough to be nobody's blocker. Noted only so it is not lost: our token architecture (`src/styles.css:10-84`, light theme at `:84`) is already the right shape and the hex values for all nine palettes are in the research. `catppuccinLatte` maps onto our existing `light` slot. Our `useTheme()` (`src/App.jsx:274-285`) is a two-value toggle that would need to become a select, and the anti-FOUC script (`index.html:18-20`) would need to accept more values. |

---

## Open questions for the maintainer

1. **Does `~/.claude/history.jsonl` get rotated or capped?** 182 entries on this machine against a
   much longer transcript history suggests it might. This decides whether Feature 1 can back the
   long-window `/api/dupes` queries or only the recent-prompt ones. Measurable locally: compare the
   oldest `timestamp` in the file against the oldest transcript entry.
2. **Do our local transcripts actually contain `TaskCreate`/`TaskUpdate`, `<command-name>`,
   `customTitle`, and any Claude Code version field?** Features 2, 3 and 9 are specced from the
   research, not from a file I opened. A grep over `~/.claude/projects` answers all four in minutes
   and could delete a feature.
3. **The OAuth usage endpoint — yes or no?** See §"Needs a maintainer decision". Nothing downstream of
   it should be built until this is answered, and the recommendation is no.
4. **Registry now, editor later — agreed?** §"The configurable Overview" argues for adopting the
   `getData → T | null` contract as an invisible refactor and deferring persistence and the layout
   editor. That converts Feature 10's valuable half into an M. If the maintainer wants the editor,
   the scope collision with `CustomizeSection` (where "disable" means "change what Claude loads")
   needs deciding first.
5. **Is the XDG MCP path (`~/.config/claude-code/mcp.json`) a real blind spot for us?** Upstream merges
   three locations; we read two (`server/index.mjs:838-839`, `:413-414`). One `ls` answers it.
6. **How aggressively should we correct existing dollar figures?** Feature 4 will move totals, in some
   cases substantially. Silent re-baselining is the exact failure `_SYNTHESIS.md` §6 warns about. Is a
   one-time in-app notice acceptable, or should old and new be shown side by side for a period?
7. **Should `peakHours` ship at all?** It encodes a guess about Anthropic's capacity planning that can
   go stale without any signal. Cheap to build, but it is a claim we cannot verify.

---

## Attribution

Upstream: [uppinote20/claude-dashboard](https://github.com/uppinote20/claude-dashboard), **MIT**,
Copyright (c) 2026 uppinote. License verified present per `_SYNTHESIS.md` §5. Per `_SYNTHESIS.md` §9,
any ported file must carry the author's permission and the license state in its header, and code must
be copied from a git checkout rather than a hosted installer.
