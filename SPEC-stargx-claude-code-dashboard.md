# Implementation spec — adoptions from Stargx/claude-code-dashboard

> Turns `stargx-claude-code-dashboard.md` (research) + `_SYNTHESIS.md` (rulings) into shippable work
> against **this** repo. Every step below names a file I actually read at
> `research/upstream-ecosystem-analysis`. Every number attributed to "our corpus" was measured on this
> machine on 2026-07-29 with throwaway scripts, not estimated.
>
> Upstream is MIT (`Copyright (c) 2025 Cold Beam Games`), 4 commits on one day, dead since 2026-03-09.
> Per `_SYNTHESIS.md` §9: **port and own the code, do not track upstream**, and record the license in
> the header of every ported file.

## Measurements this spec rests on

Run against `~/.claude/projects` on the dev machine, 2026-07-29:

| Fact | Value |
|---|---|
| Transcript files | 1,277 (`.jsonl`), 475.8 MB total |
| Of which subagent transcripts | 1,159 |
| Subagent `.meta.json` sidecars | 1,157 |
| Usage-bearing events (`message.usage` + `message.model`) | 86,572 |
| Usage events carrying `message.id` | 86,572 (100%) |
| Distinct `message.id` values | 33,893 |
| All-time cost as `/api/usage` computes it **today** | **$22,535.50** |
| Same corpus, deduped per file by `message.id` | **$8,968.45** (2.51× lower) |
| Same corpus, deduped per file **and** across files | **$7,615.42** (2.96× lower than today) |
| Input-token inflation today | 2.33× · output-token inflation 2.02× |
| `usage.iterations[]` array lengths observed | 46,084 events of length 1, 7 of length 0. **Never >1.** |
| Top-level transcript `type` values seen (25 newest files) | `assistant`, `user`, `queue-operation`, `attachment`, `last-prompt`, `custom-title`, `system`, `pr-link`. **No `progress`.** |
| Lines carrying `permissionMode` | 21 of 2,507 — all `type: "user"`, all `promptSource: "sdk"`, all `bypassPermissions` |
| Lines carrying `agentId` | 2,170 of 2,507 |
| Files with mtime < 5 min / < 30 min / < 24 h | 14 / 15 / 63 |
| Warm full read+decode of all 1,277 files | 1,185 ms |
| Tail-only 8 KB read of all 1,277 files | 201 ms |
| Intra-session gap between consecutive timestamped events | p50 721 ms · p90 7.2 s · p95 13.2 s · p99 59 s |
| Share of those gaps > 15 s / > 60 s | 4.2% / 1.0% |

Two of these change how the features below are written, so they are stated up front:

1. **The dedupe bug is real and it is the biggest number in this document.** The research called it
   "suspected"; it is now confirmed and quantified. Every dollar and token figure this app renders is
   roughly 2.5–3× too high.
2. **Stargx's 15 s / 60 s thresholds are empirically well-calibrated for our transcripts too** —
   96% of intra-session event gaps are under 15 s, 99% under 60 s. Adopting their constants verbatim
   (as `_SYNTHESIS.md` §8 Tier 1.1 rules) is defensible on our own data, not just on their say-so.

## Discrepancies between the research file and our code (our code wins)

- Research overlap table: *"Context-window usage bar — our equivalent: NONE"*. **Wrong.** We ship
  `GET /api/context/sessions` and `GET /api/context/:sessionId` (`server/index.mjs:3070-3102`) plus
  `src/sections/ContextExplorerSection.jsx`, and our denominator is already model-aware
  (`BIG_CTX = 1_000_000` / `STD_CTX = 200_000`, `server/index.mjs:3055,3096`) — strictly better than
  upstream's hardcoded 200 K. The gap is **live**, not the bar. Feature 4 is scoped accordingly.
- Research recommendation #8: *"port their hardened `open-folder`"*. **Already done.**
  `POST /api/artifacts/reveal` (`server/index.mjs:533-539`) uses `execFile` with an argv array on all
  three platforms and runs the path through `safe()` (`server/index.mjs:125-130`), which is a stricter
  allowlist than upstream's bare `existsSync`. Nothing to port. Listed under *Not worth taking*.
- Research cites `collectUsage()` at `server/index.mjs:660-716`; it is actually **657-716**. Minor.
- `_SYNTHESIS.md` Tier 0.1 includes "sum `usage.iterations[]`". On our corpus that is a **no-op**:
  46,084 of 46,091 events have exactly one iteration and the top-level `usage` equals it. Not a
  contradiction of the ruling — an empirical refinement, noted in feature 1.

---

## 1. Deduplicated usage ledger (per `message.id`)

**Customer need** — A developer opens Harness ▸ Sessions to answer "did that refactor cost me
$4 or $40?", sets a monthly budget in Harness ▸ Usage, and gets a budget alert. Today all three
answers are wrong by ~2.5×. There is no workaround: the numbers are wrong everywhere they appear, so
the user's current behaviour is either to trust a wrong number or — once they compare it against
`/usage` in the CLI and see the mismatch — to stop trusting the whole app. The app's stated thesis is
"every number computed from real files"; a 2.5× inflation is the single most damaging thing in it.

**Value to Loush** — Restores correctness under `/api/usage`, `/api/sessions`, `/api/roi`,
`/api/gov/costs`, `UsagePanel.jsx`, `SessionsSection.jsx`, `Overview.jsx`'s 5-hour block tile, the
month-end projection (`projectMonthEnd`), the anomaly detector (`detectDailyAnomalies`), cache-waste
cost and `costSaved`. This is `_SYNTHESIS.md` Tier 0.1 — a correction, not a feature, and it gates
everything else in this document that renders a number.

**How the upstream repo does it today** — `watcher.js:25` holds
`seenMessageIds: Map<sessionId, Map<messageId, {in, out, cacheCreate, cacheRead}>>`. On every
assistant event (`watcher.js:114-133`) it looks up the previous tuple for that `message.id` and adds
only `Math.max(0, curr - prev)` per field, then stores the new tuple. The domain knowledge being
bought: **Claude Code re-emits the same `message.id` across multiple JSONL lines as a response
streams, and the `usage` object on each line is cumulative, not incremental.** Naively summing
overcounts. The `Math.max(0, …)` clamp additionally makes it robust to out-of-order and replayed
lines. Gotchas their author hit and we inherit: their `turnCount` (`watcher.js:169-171`) has *no*
message-id guard and over-counts as a result, and their tail-offset race (`watcher.js:245`) can
re-process bytes — token totals survive precisely because this ledger dedupes them, everything else
in their session record does not.

**How we implement it here** — `server/index.mjs`, inside `collectUsage()` (`:657-716`).

- The per-file parse loop at `:671-701` pushes one entry per usage-bearing line at `:681-682` and
  accumulates `rec.out += e.out` etc. at `:683-684`. Add a `const seen = new Map()` scoped to the
  per-file rebuild (i.e. declared next to `const rec = {…}` at `:669`), keyed on
  `j.message.id` — 100% of our usage events carry it, so no fallback key is needed; if it is ever
  absent, treat the line as its own key using `j.uuid` rather than dropping it.
- Replace the raw `u.*` reads with deltas: `inΔ = Math.max(0, u.input_tokens - prev.in)`, same for
  `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`. Store
  `{in: Math.max(prev.in, u.input_tokens), …}` back into `seen`. Push the **delta** as the entry, and
  carry `msgId` on the entry object so step 3 can work.
- Do **not** drop zero-delta lines from `rec.entries` blindly — `tc` (tool-call counting, `:678-679`)
  and `rec.toolCalls` are counted per *line* today. Count `tc` only on the **first** sighting of a
  `message.id` in the file, otherwise the same `tool_use` block is counted once per re-emission.
  Same for `rec.msgs`: increment on first sighting only, so "messages" means messages.
- Cross-file duplication is separate and smaller: 1,519 of 33,893 distinct `message.id`s appear in
  more than one transcript (resumed/forked sessions copy prior history forward), worth a further
  15.1% of cost. Handle it at the **merge** step (`:705`, `all.entries.push(...rec.entries)`) with a
  module-level `Set` of seen ids for that call, filtering entries in ascending `t` order — first
  sighting wins. Leave the per-file `rec.cost` / `rec.out` / `rec.in` totals **un**-cross-deduped:
  `/api/sessions` (`:3022-3050`) legitimately reports what that session's own file contains. Emit
  both, and label the aggregate as deduped.
- Bump the cache version at `:667` from `rec.v !== 2` to `!== 3` and update the comment at `:668`;
  `usageCache` is in-memory so no on-disk migration exists, but the version guard is the honest
  signal. `respCache` (`:110`) holds `/api/usage` for 120 s and `/api/roi` for 600 s — a server
  restart clears it, so no extra invalidation code is needed.
- Extract the delta logic into `lib/usage-ledger.mjs` (`export function usageDelta(seen, msgId, usage)`)
  so `test/lib/usage-ledger.test.mjs` can cover it the same way `test/lib/harness-metrics.test.mjs`
  covers `lib/harness-metrics.mjs`. No new dependency.
- `usage.iterations[]`: on our corpus, summing it is a no-op (see measurements). Read the top-level
  `usage` fields as today. Add a one-line comment recording that iterations was checked and found to
  be length ≤ 1 across 46,091 events, so the next reader does not re-litigate it.
- UI: no component changes required. But `SessionsSection.jsx:143-146` currently claims *"$ is real:
  each entry is priced from its own model and token counts"* — that sentence is what makes this a
  correctness bug rather than a rounding quibble, and it should stay true after the fix.

**Effort** — **S.** ~40 lines in one function plus a small extracted lib and one test file. No API
shape change, no client change, no new dependency. The care is in the three counters that must move to
"first sighting only" (`tc`, `rec.msgs`, and the tool-name histogram at `:679`), not in the arithmetic.

**Risks and unknowns**
- **Every historical number in the app moves by ~2.5× overnight.** If anyone has screenshots, budget
  thresholds, or a saved `dash-monthly-budget` in `localStorage`
  (`UsagePanel.jsx:34`), those become meaningless. A user's $200 budget will suddenly read as
  comfortably under. This needs to be called out in the UI once — see Definition of done.
- Cross-file dedupe changes `/api/usage` totals but not `/api/sessions` rows, so the two will no
  longer sum to each other. That is *correct* but it looks like a bug. The sessions table footer must
  say so.
- The clamp `Math.max(0, curr - prev)` silently absorbs genuinely decreasing counters. Log nothing,
  but verify during implementation that decreases are rare — if they are common, the cumulative
  assumption is wrong for some event class and this needs re-derivation.
- **Must verify first:** that the delta ledger keyed on `message.id` alone matches keying on
  `message.id + requestId`. I measured both: $8,906 vs $8,907 across the corpus — a 0.01% difference.
  Use `message.id` alone and keep the code simpler; re-check if that gap ever widens.
- The five-hour block computation (`:729-740`) filters `entries` by timestamp. Deltas keep the
  timestamp of the line they came from, so block membership is unaffected. Confirm by eye.

**Definition of done**
- `test/lib/usage-ledger.test.mjs` passes under `npm test`, covering: three lines sharing one
  `message.id` with cumulative usage sum to the largest, not the sum; a decreasing counter contributes
  0, not a negative; an event with no `message.id` is counted once and not dropped.
- A fixture-based test under `test/fixtures/` asserts that a transcript with a known duplicate pattern
  produces exactly one `msgs` increment and one `toolCalls` increment per logical message.
- `GET /api/usage` on the dev corpus reports a total cost within 1% of $7,615 rather than $22,535.
- `GET /api/sessions` rows still sum per-file (un-cross-deduped) and the panel footer in
  `SessionsSection.jsx` states that session rows are per-transcript and the Usage totals are deduped
  across resumed sessions, so the two intentionally differ.
- Empty/null state: a transcript with zero usage-bearing lines yields `cost: null`, not `0`, and the
  session row renders `—`. A model with no price entry must not silently price as Sonnet — that is
  Tier 0.2's job, but this change must not make it harder, so `entryCost` (`:1987`) keeps taking the
  model string and any `null` it returns must propagate as `null` through the delta path.

---

## 2. `waiting-on-you` session status and a Live board

**Customer need** — Concrete scenario, and it is this machine's own scenario: 14 transcripts were
touched in the last five minutes on the dev box, across four git worktrees. Some of those agents are
mid-tool-call; at least one has finished speaking and is blocked on a human answer. Today the only
way to find out which is to alt-tab through terminal tabs one at a time. Loush's answer today is a
binary `ACTIVE_MS = 5 * 60_000` mtime check (`server/index.mjs:798`) surfaced as a `running` /
`runningAgents` **count** in `/api/projects` (`:835-837`) — it can say "3 sessions are running" and
nothing more. It cannot say which one is waiting for you. The cost of not knowing is pure wall-clock:
an agent that finished 8 minutes ago and is waiting is 8 minutes of nothing happening.

**Value to Loush** — This is `_SYNTHESIS.md` Tier 1.1 and the one axis where the synthesis says
upstream beats us decisively. It is also the only genuinely *present-tense* view in an app that is
otherwise entirely retrospective, which makes it a new kind of screen rather than a better version of
an existing one. It plugs the hole between Overview ("what needs a human today") and Sessions ("what
did I spend") — "what needs a human **right now**".

**How the upstream repo does it today** — `deriveStatus(session)` at `watcher.js:209-230`, called at
**request time** (not ingest time) from `GET /api/sessions` (`watcher.js:279-329`), so freshness is
always relative to `Date.now()` at the poll and a session goes idle with no event needed to push it
there. The algorithm, verbatim:

```
no lastEventAt                                     -> 'idle'
elapsed = Date.now() - lastEventAt
elapsed > 60_000                                   -> 'idle'
any of last 3 recentLog entries is type 'error'    -> 'error'
elapsed < 15_000:
    lastEventType == 'assistant':
        lastContentTypes includes 'tool_use'       -> 'thinking'
        lastContentTypes includes 'text'           -> 'waiting'
        lastContentTypes includes 'thinking'       -> 'thinking'
    lastEventType == 'progress'                    -> 'thinking'
    lastEventType == 'user'                        -> 'thinking'
otherwise                                          -> 'idle'
```

Plus an `idle-stale` tier applied at the API layer (`watcher.js:317-321`): status `idle` **and**
`lastEventAt` before local midnight. The whole product is those five lines: **the last assistant
content block being `tool_use` means still working; being `text` means it has spoken and is now
blocked on you.**

The presentation is as load-bearing as the algorithm. Status is encoded **three times** on each card
(`public/index.html:91-95, 111-134`): a 3 px left border colour, a dot with a `pulse` keyframe that
animates **only** for `thinking` (1.5 s) and `waiting` (2 s), and an uppercase text pill. Motion means
live; static means not. Plus opacity as a depth cue — `idle` cards at `0.7`, `idle-stale` at `0.35` —
so stale sessions recede rather than disappear. It degrades correctly for colour-blind users because
hue, motion and text all carry the same signal.

List algebra at `watcher.js:296-327` is what makes it usable on a machine with history: active
sessions always shown; idle sessions deduped to the newest per project label; idle dropped entirely
for any label that already has an active session; sorted active-today-first then alphabetically.

Gotchas their author hit: the `error` branch is **dead code** — no path in `processEvent` ever writes
`{type: 'error'}` into `recentLog`, so the red border/dot/pill can never fire. `CLAUDE.md:117-121`
specifies a 10 s active window and the shipped code uses 15 s. Poll failures are swallowed
(`public/index.html:470`) and `lastFetch` is captured but never rendered (`:461,468`), so a dead
backend looks like a calm dashboard.

**How we implement it here**

Server — new `GET /api/live` in `server/index.mjs`, **not** added to `HEAVY_TTL` (`:102-109`): a
present-tense endpoint must never be served from a 60-second cache.

- Candidate set: walk `~/.claude/projects` for `.jsonl` and keep only files with
  `Date.now() - st.mtimeMs < LIVE_WINDOW` (start at 15 min). On this corpus that is **15 files**, so
  the endpoint costs a `readdir` walk plus 15 tail reads. Do not call `collectUsage()` — it reads
  476 MB.
- For each candidate, read the **last ~16 KB** with `fs.openSync` + `fs.readSync` from
  `st.size - len`, split on `\n`, discard the first (possibly partial) fragment, and parse lines from
  the end backwards until the first line with a `timestamp`. That yields `lastEventAt`,
  `lastEventType` (`j.type`), and `lastContentTypes` (`j.message.content.map(c => c.type)` when it is
  an array). Measured cost of tailing *every* file in the corpus is 201 ms; 15 files is noise.
- New pure module `lib/session-status.mjs` exporting `deriveStatus({lastEventAt, lastEventType, lastContentTypes, now})`
  with upstream's constants as named exports (`ACTIVE_WINDOW_MS = 15_000`, `IDLE_CUTOFF_MS = 60_000`).
  Tested in `test/lib/session-status.test.mjs`. Honesty adaptations, both required by
  `_SYNTHESIS.md`'s framing:
  - `lastEventAt` absent → return `'unknown'`, **not** `'idle'`. `'unknown'` renders as `—` with an
    explanatory tooltip, never as a status pill implying we checked and found nothing.
  - Drop the `'error'` branch entirely. It is dead upstream and we have no event that would feed it;
    porting dead code that renders a red border is worse than not porting it. Our error signal already
    exists in `failStats()` and `/api/forensics` and belongs there.
  - Keep the `'progress'` branch out too: no `progress` event type exists in our corpus (measured).
    Add a comment saying so, with the date, so it can be revisited if Claude Code adds one.
- Also derive, per session: `cwd` and `gitBranch` from the same tailed lines (**last** value wins, not
  upstream's sticky-first — we already track branch properly elsewhere and a mid-session branch switch
  is normal here); `project` label via the existing `mangle()` reverse-lookup used at `:3028-3029`;
  `sessionId` from `path.basename(f, '.jsonl')`; `isAgent` from `f.includes('subagents')`.
- Port the list algebra from `watcher.js:296-327` as `lib/session-status.mjs#collapseIdle(sessions)`:
  keep every non-idle session; for idle ones keep only the newest per project label; drop idle
  entirely for a label that has a live session. Sort live-first, then by `lastEventAt` desc. This is
  the difference between a useful board and 63 cards.
- Path splitting: use `path.sep` / `split(/[\\/]/)`, never upstream's `split('/')` — that is the
  Windows bug visible in their own screenshot, and we are a Windows-primary dev environment
  (`server/index.mjs:47` `const WIN = process.platform === 'win32'`).

Client — new `src/sections/LiveSection.jsx`.

- State: `const [d, setD] = useState(null)`, `useEffect` with `api.get('/api/live')` on mount and a
  `setInterval` at 3000 ms cleared on unmount — the same shape as `App.jsx:344-381`'s inbox poll and
  `SidebarFoot`'s 20 s poll (`App.jsx:234-248`). No WebSocket; consistent with our stack and with
  upstream's explicit non-goal.
- **Fix their staleness bug rather than inherit it:** keep `lastOk` in state, and if two consecutive
  polls fail, render a banner saying the dashboard server is not answering. A frozen board must never
  look like a calm board.
- Card visual: reuse our existing tokens — `var(--green)` for `thinking`, `var(--amber)` for
  `waiting`, `var(--text-tertiary)` for `idle`, and `—` for `unknown`. Encode status three times
  (border-left, dot, pill) exactly as upstream does, add the pulse keyframe to `src/styles.css` next
  to the existing animation utilities, and use opacity `0.7` / `0.35` for the idle tiers. Do **not**
  copy their palette; do **not** load their fonts.
- Actions on each card, all of which already exist: `resumeHere` — dispatch `chat-open` +
  `nav-chat`, copied from `SessionsSection.jsx:46-50`; `reveal` via
  `POST /api/artifacts/reveal`; open the raw transcript via `/api/artifacts/download`.
- Navigation: add to `BASE_SECTIONS` in `src/App.jsx:50` as a **top-level** entry with
  `id: 'live'`, `kicker: 'Live'`, placed immediately after `overview` — it answers a more urgent
  question than Working Set. It must not be buried in the Harness hub (`App.jsx:153-175`) alongside
  nine retrospective panels. Note that `App.jsx:440-448` only mounts visited sections, so the 3 s poll
  costs nothing until the user opens the tab, and continues while another tab is on screen — that is
  desirable here and should be left as is.
- Optional follow-on, not in scope for this feature: a live count badge on the nav entry, using the
  same `nav-badge` mechanism as the inbox (`App.jsx:403`).

**Effort** — **M.** The status function and the collapse algebra are ~60 lines of pure, tested code.
The endpoint is ~70 lines. The section is a new file of ~200 lines with no new primitives. The M is
earned by the tail-reader (partial-line handling at the buffer boundary) and by the visual language
needing to look like Loush rather than like a port.

**Risks and unknowns**
- **Flapping in the 15–60 s dead band.** Upstream resolves that whole band to `idle`. Measured on our
  corpus, 4.2% of intra-session event gaps exceed 15 s and 1.0% exceed 60 s — so roughly 3% of the
  time a genuinely working session will show as `idle` for a few seconds. This is acceptable and it is
  the ruling, but the `idle` pill's tooltip must say *"no transcript activity for over 15 s — a long
  model call can look like this"*. Do not invent a fourth state to paper over it.
- The mtime prefilter and the timestamp of the last line are two different clocks. A transcript whose
  last line is old but whose mtime is fresh (e.g. an editor touched it) will enter the candidate set
  and then correctly derive `idle`. Harmless, but do not use mtime as `lastEventAt`.
- Files > 2 MB exist (33 of them). A 16 KB tail is ~30–100 lines, which is plenty, but a single
  pathological line longer than 16 KB (a large `tool_result`) would leave the tail unparseable. Fall
  back to widening the read to 256 KB once before giving up, then report `unknown`.
- **Must verify first:** that a session sitting at a permission prompt (which we would want to read as
  `waiting`) actually leaves `assistant` + `["text"]` as the last line, and not `assistant` +
  `["tool_use"]` with the tool never executing. In our chat driver we pass
  `--dangerously-skip-permissions` (`server/index.mjs:916`) so no local transcript will show that
  state — this needs checking against an interactive CLI session, not an SDK one.
- Subagent transcripts outnumber main ones 1,159 to 118 here. If they are not filtered or grouped, the
  board is all subagents. Feature 5 makes that a nested rollup; until then, filter `isAgent` out of
  the top-level card list.

**Definition of done**
- `test/lib/session-status.test.mjs` covers every branch of `deriveStatus` including: `assistant` +
  `["text"]` at 5 s → `waiting`; `assistant` + `["tool_use"]` at 5 s → `thinking`; `user` +
  `["tool_result"]` at 5 s → `thinking`; anything at 30 s → `idle`; anything at 90 s → `idle`; missing
  `lastEventAt` → `unknown`.
- `collapseIdle` has a test proving that a project with one live and three idle sessions renders one
  card, and a project with three idle and none live renders exactly one.
- `GET /api/live` responds in under 150 ms on the dev corpus and its response contains no field
  derived from `collectUsage()`.
- With no session touched in the last 15 minutes, the section renders **"no sessions active in the
  last 15 minutes"** — not an empty grid, and not a zero count presented as a metric.
- A session whose last event cannot be parsed renders status `unknown` with `—` and a tooltip naming
  the reason. It is never shown as `idle`, and never as a green dot.
- Killing the dashboard server while the tab is open produces a visible "not answering" banner within
  two poll intervals.

---

## 3. Permission-mode risk badge on live sessions

**Customer need** — Someone starts a session with `--dangerously-skip-permissions` for a throwaway
task, gets distracted, and comes back three hours later to a long-running agent still running with
every guardrail off, in a repo they care about. Today there is no surface anywhere in Loush that says
"a session is running with permissions bypassed **right now**". We report `permissionMode` only for
*agent configuration files* (`server/index.mjs:1226` — `m.planModeRequired ? 'plan' : m.permissionMode || 'default'`),
which is a static property of an agent definition, not a fact about a live process. The user's
workaround today is remembering what they typed.

**Value to Loush** — A governance signal on live state, which `GovernanceSection.jsx` currently
cannot produce. It costs almost nothing once feature 2 exists, and it is the kind of fact that
justifies a "Live" tab existing at all: not just "busy/idle" but "busy/idle **and unsafe**".

**How the upstream repo does it today** — `watcher.js:102` captures `event.permissionMode` onto the
session record (sticky-first-value, like their `cwd` and `gitBranch`). The frontend
(`public/index.html:369-373`, CSS at `:143-144`) renders a red **YOLO** pill for `bypassPermissions`
and a yellow **AUTO-EDIT** pill for `acceptEdits`, and nothing at all otherwise. Two words, two
colours, top-right of the card next to the status pill. The non-obvious part is that it is read out of
the *transcript*, not out of any settings file — so it reflects what the running process is actually
doing rather than what the config says it should do.

**How we implement it here** — this is where our data diverges from theirs and the honest
implementation is different.

- Measured: `permissionMode` appears on **21 of 2,507** recent lines, exclusively on `type: "user"`
  events that also carry `promptSource: "sdk"` and `origin: {kind: …}`. Every one was
  `bypassPermissions` — which is expected, because those are transcripts of *this dashboard's own*
  `POST /api/chat` driver, which passes `--dangerously-skip-permissions` at `server/index.mjs:916`.
  **Whether an ordinary interactive `claude` session writes `permissionMode` at all is unverified.**
- Therefore: in the `/api/live` tail reader (feature 2), scan the tailed lines for the most recent
  `j.permissionMode` and emit `permissionMode: 'bypassPermissions' | 'acceptEdits' | 'plan' | 'default' | null`.
  `null` means **not stated in this transcript**, and it must not be rendered as `default`. A missing
  field is not a safe default; it is an unknown, and our rules say unknown renders as unknown.
- Client, `LiveSection.jsx`: red `YOLO` pill for `bypassPermissions`, amber `AUTO-EDIT` for
  `acceptEdits`, a neutral `PLAN` chip for `plan`, nothing rendered for `default`, and a dim `?` chip
  with tooltip *"this transcript does not record a permission mode"* for `null`. Use `var(--red)` /
  `var(--amber)` / `var(--violet)`, matching the chip styling already used in
  `SessionsSection.jsx:121` and `Overview.jsx:274`.
- Take the **last** value seen, not upstream's sticky-first: permission mode is changeable mid-session
  via `/permissions`, and reporting a three-hour-old value as current is exactly the staleness bug
  called out in the research (`watcher.js:93-100`).
- Second landing spot, independently shippable: a counter in `GovernanceSection.jsx` reading the same
  `/api/live` payload — "N of M live sessions are running with permissions bypassed". Do **not** put
  it in `HarnessSection.jsx`; that section is about configuration, and this is about processes.

**Effort** — **S.** ~10 lines in the tail reader, ~15 in the card, ~20 for the Governance counter.
The only real work is deciding — and documenting — that absent means unknown.

**Risks and unknowns**
- **Must verify first:** whether an interactive (non-SDK) `claude` session emits `permissionMode` in
  its transcript at all. If it does not, this badge will only ever light up for sessions the dashboard
  itself spawned, which is close to useless and the feature should be dropped rather than shipped as a
  field that is always `null`. Check by running one interactive session in each mode and grepping its
  transcript. This is a **gate**, not a caveat.
- If `permissionMode` proves unavailable, the fallback is `~/.claude/settings.json` +
  `.claude/settings.local.json` `defaultMode`, which we already read elsewhere — but that is
  *configuration*, not live state, and would have to be labelled as such. Do not silently substitute
  one for the other.
- A red YOLO badge on a session the dashboard itself started (via Chat) is technically correct but
  reads as the app accusing itself. It should still show — and `_SYNTHESIS.md` §2 flags our own
  `--dangerously-skip-permissions` as a real posture problem, so making it visible is a feature.

**Definition of done**
- A live session started by `POST /api/chat` shows a red `YOLO` pill.
- A session whose transcript records no `permissionMode` shows the dim `?` chip and its tooltip. It
  never shows `DEFAULT` and never shows nothing-that-implies-safe.
- `GovernanceSection.jsx` shows "N of M live sessions bypassing permissions"; with zero live sessions
  it shows "no live sessions" rather than "0 of 0".
- The verification gate above is recorded in the PR description with the actual transcript evidence.

---

## 4. Live context-window occupancy per session

**Customer need** — A long session compacts without warning, and the user loses the working context
mid-task; they find out afterwards from the compaction count in Sessions
(`SessionsSection.jsx:93-95`). What they want is 30 seconds of notice so they can wrap up the current
thought, commit, or start a fresh session deliberately. Today Loush can replay context occupancy for a
session **after the fact** (Harness ▸ Context Explorer) but has no live reading, and Overview's
compaction signal is retrospective by construction.

**Value to Loush** — Turns an existing, already-correct derivation into a present-tense one. We are
unusually well positioned: `server/index.mjs:3053-3054` already documents that
`e.in + e.cc + e.cr` on a turn **is** the total prompt size the model saw, and `:3096` already picks
the denominator model-aware (`/\[1m\]/i.test(lastModel) || peak > STD_CTX ? BIG_CTX : STD_CTX`). This
feature is mostly plumbing an existing correct number into feature 2's card.

**How the upstream repo does it today** — Backend stores `lastTurnInputTotal = input + cacheCreation + cacheRead`
of the latest assistant message (`watcher.js:136`). Frontend divides by a hardcoded `200_000`, clamps
to 100, and colour-ramps at 50% (yellow) and 80% (red) (`public/index.html:326-335`). The concept is
right and cheap. Two things about it are wrong for us and both are on the synthesis do-not-adopt list:
the denominator is hardcoded and wrong for 1 M-context models, and — worse — when
`lastTurnInputTotal` is missing the frontend silently falls back to `session.tokensIn`, the
**lifetime** input total (`public/index.html:340`), producing a confident, meaningless, usually-pegged
bar. That is the mirror image of our "null is never rendered as 0" rule and must not be copied.

**How we implement it here**

- In the `/api/live` tail reader (feature 2), the tailed window will usually contain at least one
  assistant line carrying `message.usage`. From the most recent one, emit
  `contextTokens = in + cache_creation + cache_read` and `model`. If no usage-bearing line is in the
  tail, emit `contextTokens: null` — **do not widen the read looking for one, and do not substitute
  any lifetime figure.**
- Hoist the budget rule out of the `/api/context/:sessionId` handler (`server/index.mjs:3096`) into
  `lib/context-budget.mjs` — `export const contextBudget = (model, peak) => …` with `BIG_CTX` /
  `STD_CTX` moved alongside it (`:3055`) — and call it from both the existing endpoint and `/api/live`.
  This is a refactor of code we already trust, not new logic, and it prevents the two paths drifting.
  Add `test/lib/context-budget.test.mjs`.
- Client, `LiveSection.jsx`: a thin bar under the card meta, `width: clamp(0, contextTokens / budget)`,
  ramped `var(--green)` → `var(--amber)` at 50% → `var(--red)` at 80% (upstream's ramp, our tokens).
  Label it `142k / 200k · 71%`. **The denominator is always visible** — `_SYNTHESIS.md` §6's rule,
  which we already honour for WorkingSet's rank tooltip and for `contextPressure`'s `denominator`
  field (`server/index.mjs:3010`).
- When `contextTokens` is `null`, render the words **"context unknown"** in place of the bar. Not an
  empty bar, not a 0% bar, not a grey bar at full width.

**Effort** — **M.** The arithmetic is trivial and the budget function already exists. The M is the
refactor of `/api/context/:sessionId` to share it plus its test, and the discipline of the null path.
If the refactor is skipped it is an S, but then two copies of the budget rule exist and one will rot.

**Risks and unknowns**
- The last usage-bearing line in a 16 KB tail may be several turns old if the session is mid-tool-call
  with large results. The reading would then be stale by a turn or two — acceptable for a pressure
  gauge, but the tooltip should say "as of the last completed assistant turn", not "now".
- `contextBudget`'s `peak > STD_CTX` heuristic needs a `peak` we do not have in the live path (we have
  one turn, not the series). Pass `contextTokens` as the peak; the effect is that a session which has
  exceeded 200 K is treated as a 1 M-context session, which is the same inference the existing
  endpoint makes.
- Compaction resets occupancy sharply. The bar will drop by 60%+ in one poll. That is correct and
  should be left alone; the Context Explorer already labels those events (`:3090`).
- **Must verify first:** that the model string in live transcripts carries the `[1m]` marker the
  budget rule keys on. If it does not, every 1 M session will be measured against a 200 K denominator
  and show as pegged.

**Definition of done**
- `lib/context-budget.mjs` exists with tests, and both `/api/context/:sessionId` and `/api/live` call
  it — verified by there being exactly one occurrence of `1_000_000` in `server/`.
- A live card shows `<used> / <budget> · <pct>%` with the denominator always rendered.
- A card whose tail contains no usage line renders **"context unknown"**, and a test or manual check
  confirms no code path substitutes a lifetime token total.
- The existing Context Explorer behaviour is unchanged (same budget for the same session before and
  after the refactor).

---

## 5. Live subagent rollup

**Customer need** — On this machine there are 1,159 subagent transcripts against 118 main-session
transcripts. When a developer fans out four agents onto a task, `/api/projects` tells them
`runningAgents: 4` (`server/index.mjs:836`) and nothing else — not what any of them is doing, not
which one has finished, not which one has been stuck for twenty minutes. Today the way to find out is
to open Chat, find the Task node, and expand it, which only works for the session the dashboard itself
is driving.

**Value to Loush** — Converts a bare integer into "what are my agents doing right now", and closes
the gap between `RunsSection.jsx` (our own scheduled runs) and Claude Code's own fan-out. It also
completes feature 2 — without it, either the board is dominated by subagent cards or subagents are
invisible.

**How the upstream repo does it today** — `watcher.js:174-197`: any event carrying `event.agentId`
(excluding ids starting with `acompact`) creates or updates a subagent record; the task description is
captured from the **first user message, truncated to 120 characters**; output tokens are summed when
`stop_reason` appears; status is `Date.now() - eventTs < 15_000 ? 'thinking' : 'idle'`
(`watcher.js:184-185`). The API returns **only currently-`thinking` subagents**, sorted by
`lastEventAt` desc (`watcher.js:285-287`) — the active-only filter is the right default and is the
actual insight here. Rendered as a plain one-line-per-agent list inside the parent card.

**How we implement it here** — our plumbing is better than theirs and should be used instead of the
`agentId` heuristic for the task string.

- We already resolve subagent transcripts by directory: `<projects>/<mangled>/<sessionId>/subagents/*.jsonl`
  with a `*.meta.json` sidecar per agent, stitched into Chat history at `server/index.mjs:899-906`.
  Measured, that sidecar contains
  `{agentType, worktreePath, worktreeBranch, description, toolUseId, spawnDepth}` — i.e. the **real
  task description**, the agent type, and the parent linkage, rather than upstream's first-120-chars
  guess. There are 1,157 of them on this machine.
- In `/api/live`: for each live main session, list `<sessionId>/subagents/`, read each `.meta.json`
  (cheap, small, cacheable by mtime), and tail each sibling `.jsonl` exactly as in feature 2 to get
  `lastEventAt` and a status via the same `deriveStatus`. Attach as `session.subagents[]`.
- Adopt upstream's active-only default: return only subagents whose status is not `idle`, with a
  `idleSubagents: <count>` alongside so the card can say "+3 finished" without listing them. Do not
  return a `thinking`-only list and then render a count that came from somewhere else.
- Use `agentId` (present on 2,170 of 2,507 lines) only as a **cross-check**, not as the primary key:
  if a tailed subagent line's `agentId` disagrees with the filename, prefer the filename and note it.
  Reconciling the two signals is what the research recommends and the directory signal is the one we
  already trust everywhere else.
- Client: nested list inside the parent card in `LiveSection.jsx` — `agentType` in mono, `description`
  truncated to one line with the full text in `title`, a status dot, and elapsed time. `spawnDepth > 1`
  gets an indent. `worktreeBranch` shown as a chip when present, since that is genuinely useful for
  the worktree-per-agent workflow this repo uses.

**Effort** — **M.** The meta-sidecar read and the per-subagent tail are straightforward, but the fan
factor is real: a session with 12 subagents means 13 tail reads, and a poll every 3 s. Needs a small
per-file `(path, mtime, size) -> parsed tail` memo — the same shape as `usageCache` (`:656`) and
`scanCache` (`:2298`) — so unchanged files are not re-read on every poll.

**Risks and unknowns**
- Poll amplification: worst observed here is one session with many concurrent agents. Cap the number
  of subagents tailed per session (say 20, newest first) and report the overflow count honestly rather
  than silently truncating.
- `.meta.json` is undocumented, first-party, and can change without notice — same caveat as
  `_SYNTHESIS.md` §3 attaches to `file-history/` and `usage-data/`. Degrade to `agentType: null` and a
  filename-derived label if a field is missing; never fabricate a description.
- Subagents that finish do not write a terminal marker we have verified. "Finished" and "stuck" both
  look like "no events for a while". **Must verify first** whether a `SubagentStop` hook attachment or
  a final `stop_reason` reliably marks completion; if not, the honest label for a quiet subagent is
  `idle`, not `done`.
- `acompact*` agent ids: upstream excludes them explicitly. Check whether our directory layout
  surfaces compaction agents the same way and exclude them if so.

**Definition of done**
- A parent card shows its non-idle subagents with real `description` text from `.meta.json`, and a
  `+N finished` count for the rest.
- A session with no `subagents/` directory renders nothing extra — not "0 subagents".
- A `.meta.json` that is missing or unparseable yields a card row labelled by filename with
  `agentType` shown as `—`, and does not break the parent card.
- The tail memo is proven to prevent re-reads: with no filesystem changes, two consecutive
  `/api/live` calls perform zero `readFileSync` calls against subagent transcripts.

---

## 6. Incremental (byte-offset) transcript reads

**Customer need** — This is an internal-quality need with an external symptom: section loads that
stall. `collectUsage()` (`server/index.mjs:657-716`) is called by `/api/usage`, `/api/projects`,
`/api/sessions`, `/api/context/*`, `/api/roi` and `/api/gov/costs`. It has a per-file
`(mtime, size)` cache (`:667`) so unchanged files are skipped — but any file that has grown by one
line is re-read and re-parsed **in full**. The corpus here is 475.8 MB across 1,277 files and a warm
full read costs 1,185 ms; the active session is exactly the file that changes on every poll, and it is
often one of the 33 files over 2 MB. The user-visible symptom is the staleness chip in the topbar
(`App.jsx:421-428`) sitting on "cached · Nm old" because recomputation is expensive enough to want
caching in the first place.

**Value to Loush** — Makes a 3-second live poll affordable alongside the existing aggregates, and
shortens every usage-derived endpoint's cold path. This is `_SYNTHESIS.md` Tier 2.2 (credited there to
CCAM's `(mtime,size)` + byte-range cache, which we already half-have); Stargx's contribution is the
concrete offset mechanism and, more usefully, the two bugs their version has.

**How the upstream repo does it today** — `watcher.js:24, 233-257`: a `Map<path, offset>`;
`fs.statSync` then early-return if `size <= offset`; `fs.createReadStream(path, {start: offset})`;
on `end`, set the offset to `stat.size`. Split the buffer on `\n`, `JSON.parse` each line, swallow
failures. Fed by a chokidar watch (`watcher.js:332-354`, `depth: 4`, `awaitWriteFinish` 300 ms
stability / 100 ms poll, `ignoreInitial: false` so it back-fills on boot), filtered to `.jsonl` with
any basename containing `compact` skipped.

**The two bugs are the valuable part of this port:**
1. `stat` is captured *before* the stream opens, and `createReadStream` is given a `start` but **no
   `end`** — so it reads to the *current* EOF, which may exceed the captured `stat.size`. The offset
   is then set to the stale `stat.size`, so bytes written during the read are processed **and
   re-processed** next time (`watcher.js:245`). Their token totals survive only because the msg-id
   ledger dedupes them; `recentLog` and `turnCount` do not.
2. A partial JSON line straddling the read boundary fails `JSON.parse`, is silently swallowed
   (`watcher.js:252-254`), and the offset has already advanced past it — **that line is lost
   forever**. `awaitWriteFinish` narrows the window; it does not close it. There is no carry-over
   buffer.

**How we implement it here**

- No chokidar. We do not need a watcher: our reads are already demand-driven behind `respCache`
  (`:110-121`) and feature 2's poll. Adding a filesystem watcher would be a new dependency and a new
  failure mode for no benefit. Take the offset mechanism, not the ingestion architecture.
- In `collectUsage()`, change the cache record (`:669`) from "rebuild wholly when `(mtime, size)`
  changes" to "extend when the file has only **grown**":
  - Keep `rec.size` as the byte offset already consumed, plus `rec.tail` — the trailing bytes after
    the last `\n` — carried forward so a straddling line is completed rather than lost. This is the
    fix for bug 2.
  - On a cache hit where `st.size > rec.size` **and** `st.mtimeMs >= rec.mtime`, open the file,
    `fs.readSync` the range `[rec.size, st.size)` with an explicit end — the fix for bug 1 — prepend
    `rec.tail`, split on `\n`, keep the final fragment as the new `rec.tail`, and fold the complete
    lines into the existing `rec` accumulators.
  - If `st.size < rec.size` (truncation, or a compaction rewrite), discard the record and do a full
    rebuild. Never try to be clever about a shrinking file.
  - Bump the record version again (`rec.v`).
- The `seen` map from feature 1 must be **persisted on `rec`**, not re-created per read, or the
  incremental path cannot compute deltas against messages seen in an earlier chunk. That is the
  ordering dependency: **feature 1 ships first, and feature 6 is written against its data structure.**
  Cap it — a `Map` of 33,893 ids is fine, but prune ids not seen in the last N lines if a single file
  ever grows pathologically.
- Same treatment for `scanCache` / `scanTranscripts()` (`:2298-2410`) is *possible* but should be a
  separate change; that function accumulates capped arrays (`rec.edits` at 400, `rec.hookEvents` at
  800) whose caps interact with incremental appends in ways that need their own thought. Out of scope
  here — noted so it is a deliberate omission rather than an oversight.
- Skip files whose basename contains `compact`, matching upstream's filter (`watcher.js:346-348`) —
  but verify first that such files exist in our corpus before adding a filter for nothing.

**Effort** — **M.** ~60 lines in one function, but they are the most correctness-sensitive 60 lines in
the server: a boundary bug here silently corrupts every number downstream, and it is exactly where the
upstream author got it wrong twice. Needs fixture tests that append to a file between reads.

**Risks and unknowns**
- Our existing `(mtime, size)` cache already captures most of the win for *unchanged* files. The
  incremental path only helps files that grow — which, on a live poll, is the interesting one, but on
  a cold `/api/usage` it is zero help. Do not oversell the perf gain; measure before and after with
  the same script used for the numbers at the top of this document.
- mtime granularity on Windows (NTFS, and worse on network drives) can equal or lag the write. If
  `st.mtimeMs` has not advanced but `st.size` has, prefer size as the trigger. **Must verify first**
  on the target filesystem.
- A file rewritten in place at the same size (compaction) is invisible to both mtime and size checks
  in the worst case. Accept it — the existing cache already has this exposure — but note it.
- If a future change introduces a second reader with its own offsets, the two will drift. Keep the
  offset inside `usageCache`, not in a module-level `Map<path, offset>` as upstream has it.

**Definition of done**
- A fixture test writes a transcript, calls the read path, appends two lines (one of them split across
  the append boundary by writing a partial line first), calls again, and asserts the totals equal a
  clean full-parse of the final file — i.e. **no line lost, no line double-counted**.
- A truncation test: shrink the file and assert a full rebuild happens and totals match a fresh parse.
- Measured: `/api/usage` on a corpus where one 2 MB file has grown by 5 lines re-parses ~5 lines, not
  2 MB. Assert via a counter, not a stopwatch.
- No behaviour change to any endpoint response shape.

---

## Not worth taking

- **Their 0.25× cache-creation multiplier** (`watcher.js:143`). Wrong by 5×; Anthropic bills cache
  writes at 1.25× input. Our `entryCost` (`server/index.mjs:1987`) already uses `1.25`. Explicitly on
  `_SYNTHESIS.md`'s do-not-adopt list and correctly so.
- **CDN-loaded React and Google Fonts** (`public/index.html:7-8, 295-296`). Breaks offline use, leaks
  request metadata to two third parties, and contradicts the zero-telemetry claim we make. We already
  bundle React via Vite. Nothing from their frontend gets copied verbatim; only the *visual grammar*
  (triple encoding, opacity tiers, pulse-only-when-live) is reused, expressed in our own tokens.
- **4-decimal cost display** (`public/index.html:308`, `watcher.js:291`). False precision on top of a
  3-model price table with a Sonnet fallback. We render 2 dp and should keep doing so.
- **The lifetime-`tokensIn` fallback in the context bar** (`public/index.html:340`). Renders unknown
  as a plausible number — the exact inversion of our honesty rule. Feature 4 renders "context unknown"
  instead.
- **`extractActiveFiles`** (`watcher.js:66-78`) — takes `input.command` as a filename source and
  `path.basename()`s space-free bash tokens, which is where the `bknlb8cuf.output` junk in their own
  screenshot comes from. `WorkingSet.jsx` and `/api/fe/*` do this properly against the real repo.
- **Their `POST /api/open-folder`** (`watcher.js:263-277`). Already implemented, and better:
  `POST /api/artifacts/reveal` (`server/index.mjs:533-539`) uses `execFile` with argv arrays on all
  three platforms *and* gates the path through `safe()` (`:125-130`), which upstream has no equivalent
  of. Their version would open any existing path on the machine.
- **The `error` status** (`watcher.js:217`, CSS at `public/index.html:93,118,132`). Dead code upstream
  — no path ever writes an `error` entry into `recentLog`. We have real error data in `failStats()`
  and `/api/forensics`; porting a red pill that can never light is worse than nothing.
- **The `progress` branch of `deriveStatus`** (`watcher.js:225`). No `progress` event type exists in
  our corpus (measured across 2,507 lines in the 25 newest transcripts). Omitted with a dated comment
  rather than carried as speculative code.
- **Sticky-first-value `cwd` / `gitBranch`** (`watcher.js:93-100`). We already keep a per-branch cost
  and output ledger (`server/index.mjs:687-689`). Their version reports a stale branch forever after a
  mid-session switch, with no staleness indicator.
- **Their 30-entry `recentLog` ring buffer** (`watcher.js:59-64, 146-159`). 120-character snippets.
  `ChatSection.jsx` and `ForensicsSection.jsx` are full transcript readers.
- **`turnCount`** (`watcher.js:169-171`). Increments on every assistant event bearing a `stop_reason`
  with no message-id guard, so it over-counts exactly where their token path does not. Our `msgs`
  counter gets the dedupe fix in feature 1 instead.
- **Their hardcoded 200 K context denominator** (`public/index.html:329`). We already do this
  model-aware at `server/index.mjs:3096`.
- **No-build-step architecture.** Genuinely lower install friction for a 888-line tool. We have ~35
  sections and CodeMirror; a bundler is not the thing to remove.
- **Sub-second full-array polling with no ETag** (`public/index.html:473-477`). Fine at their scale.
  Feature 2 polls at 3 s against a payload of ≤15 sessions and does not call `collectUsage()`, which
  is the part that actually matters.

## Open questions for the maintainer

1. **Does an interactive `claude` session write `permissionMode` into its transcript?** Every one of
   the 21 occurrences on this machine came from an SDK-driven session (`promptSource: "sdk"`) — i.e.
   from this dashboard's own chat driver. If interactive sessions never emit it, **feature 3 should be
   dropped**, not shipped as a permanently-`null` field. This is the only hard gate in the document.
2. **Do we want cross-file dedupe at all?** It is a further 15.1% off the cost total and it is
   arguably more correct (a resumed session copies prior history forward; the API was not called
   twice). But it makes `/api/usage` totals stop summing to `/api/sessions` rows, which will look like
   a bug to anyone who adds them up. My recommendation is yes-with-a-label; your call.
3. **What should the app say, once, about the ~2.5× correction?** Historical screenshots, any saved
   `dash-monthly-budget`, and anyone's mental model of "my Claude spend" all shift. A one-time banner?
   A line in the README? Nothing at all? Silently changing every number by 2.5× is itself a small
   honesty problem.
4. **Should `/api/live` exist as a separate endpoint, or should `/api/sessions` grow a `?live=1`
   mode?** I specced a separate endpoint because `/api/sessions` is in `HEAVY_TTL` at 120 s
   (`server/index.mjs:107`) and a present-tense view must never be cached — but that means two
   endpoints over overlapping data. The alternative is excluding `?live=1` from the cache key, which
   is subtler and easier to get wrong.
5. **How does a subagent's completion actually appear in its transcript?** Without a reliable terminal
   marker, feature 5 cannot distinguish "finished" from "stuck", and both will read as `idle`. If
   `SubagentStop` hook attachments are reliably present, the rollup gets meaningfully better.
6. **Is `.meta.json` stable enough to build a UI on?** It is undocumented and first-party — the same
   risk class `_SYNTHESIS.md` §3 flags for `file-history/` and `usage-data/`. It is much better data
   than upstream's first-120-chars heuristic, but it can vanish in a Claude Code release.
7. **What is the right `LIVE_WINDOW`?** I specced 15 minutes for the candidate set, which yields 15
   files here versus 63 at 24 hours. Upstream shows everything and leans on the `idle-stale` opacity
   tier to push history back. Ours is cheaper; theirs preserves more context. Worth one round of
   looking at both.
8. **Do we ever want the `idle-stale` (pre-local-midnight) tier?** It only matters if the board shows
   sessions older than `LIVE_WINDOW`. Deferred out of feature 2; trivial to add if question 7 lands on
   a longer window. Note that their local-midnight boundary would need `localISODate()` rather than
   `toISOString()` — `_SYNTHESIS.md` Tier 1.8 records that we have the timezone bug in ≥3 places
   already, so do not add a fourth.
