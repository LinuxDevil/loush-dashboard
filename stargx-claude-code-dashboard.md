# Claude Code Dashboard (Stargx)

> Upstream research for porting ideas/code into Loush Dashboard (`LinuxDevil/AI-Dashboard`).
> All facts below were read from the actual source at `main`, not from the README, unless noted.
> Where README and code disagree, **the code wins and the disagreement is flagged**.

---

## Identity

| Field | Value |
|---|---|
| Repo URL | https://github.com/Stargx/claude-code-dashboard |
| Author (GitHub) | `Stargx` |
| Author (commits) | `Steve Hunt` |
| Author (package.json / copyright) | `Cold Beam Games` |
| License | **MIT** (exact SPDX: `MIT`). `LICENSE` line 3: `Copyright (c) 2025 Cold Beam Games` |
| Stars / Forks | **10 stars, 2 forks** (GitHub API, fetched 2026-07-29) |
| Open issues | 0 |
| Created | 2026-03-09T15:37:30Z |
| Last commit (`pushed_at`) | **2026-03-09T17:06:47Z** |
| Total commits | **4 — all on 2026-03-09** |
| Repo size | 98 KB |
| Primary language (GitHub) | HTML |
| Default branch | `main` |
| Topics / homepage | none / none |

### Commit log (complete)

| SHA | Date | Message |
|---|---|---|
| `e7c7eda` | 2026-03-09 | Fix command injection vulnerability in open-folder endpoint |
| `29f205f` | 2026-03-09 | Fix screenshot filename case in README |
| `51f9bb5` | 2026-03-09 | Add dashboard screenshot to README |
| `83f9665` | 2026-03-09 | Initial release — Claude Code Dashboard v1.0 |

**Activity assessment: dead / single-session project.** The entire repo was written and published in
roughly 90 minutes on one day and never touched again (~4.5 months stale as of 2026-07-29). The
`updated_at` field of 2026-07-08 reflects stargazer/metadata activity, not code. There is no CI, no
tests, no issue templates, no CONTRIBUTING, no changelog, no `docs/` directory.

### Install method

```bash
git clone https://github.com/Stargx/claude-code-dashboard.git
cd claude-code-dashboard
npm install
npm start          # => "node watcher.js"
# open http://localhost:3001
```

Not published to npm — `package.json` has no `bin`, no `files`, no `publishConfig`. Git clone is the
only install path. Requires Node.js v18+ and Claude Code writing JSONL transcripts.

### Platforms

Claims Windows, macOS, Linux. **Windows support is partially broken** — see
[Gaps and weaknesses](#gaps-and-weaknesses); the project-label derivation splits on `/` only, so on
Windows the card title renders the entire absolute path. This is visible in the author's own
`Screenshot.png` (labels read `C:\aWork\SVN_Repository\game\BeatHazardArcade`).

### Complete file tree (9 files, that is the whole project)

| Path | Bytes | Role |
|---|---|---|
| `watcher.js` | 12,602 | **Entire backend** — watcher, parser, pricing, status, Express API (366 lines) |
| `public/index.html` | 16,655 | **Entire frontend** — CSS + React-via-CDN, single file (522 lines) |
| `CLAUDE.md` | 6,223 | Original project brief / spec handed to Claude Code |
| `README.md` | 3,058 | Docs |
| `LICENSE` | 1,072 | MIT |
| `Screenshot.png` | 82,711 | Single screenshot |
| `package.json` | 592 | 2 prod deps |
| `package-lock.json` | 29,909 | Lockfile |
| `.gitignore` | 65 | — |

`package.json` essentials: `"type": "commonjs"`, `dependencies: { chokidar: "^5.0.0", express: "^5.2.1" }`,
`scripts: { start: "node watcher.js" }`.

---

## The problem it solves

Claude Code has no cross-session visibility. A developer running 2–4 concurrent Claude Code sessions in
separate terminal tabs must alt-tab to answer three questions:

1. **Which session is actually working right now vs. sitting waiting for my input?** The single most
   valuable signal — a session in `waiting` state is burning wall-clock time doing nothing while the
   human's attention is elsewhere.
2. **What am I spending, in total, across all of them?** Per-session cost exists nowhere in the CLI;
   combined cost across terminals exists nowhere at all.
3. **How close is each session to context exhaustion?** No warning before a compaction event.

The author's own framing in `CLAUDE.md` (line 6-7) is blunt about scope: a "master control panel for
power users" running a handful of instances. `CLAUDE.md` line 171 states the design constraint
plainly — attributed quote: "This is a personal dev tool first."

This is a **real, narrow, unmet need**, and it is a genuinely different problem from the one Loush
Dashboard solves. Loush is retrospective/analytical (what happened across my history, joined to repos
on disk). Stargx is a **present-tense liveness monitor** (what is happening in the last 15 seconds).

---

## Value proposition

### Real value

- **Sub-minute liveness across terminals.** The `thinking` / `waiting` distinction, refreshed every
  2s, is the core product. Nothing else in the repo matters as much.
- **Correct incremental token accounting.** The per-`message.id` delta ledger (`watcher.js:118-133`)
  correctly handles Claude Code's habit of re-emitting the *same* assistant message id multiple times
  with *cumulative* usage counters. Naively summing `usage` across events overcounts badly. This is
  the single most technically valuable idea in the repo.
- **Byte-offset tailing.** Never re-reads a transcript from the top; keeps a `path -> byte offset`
  map and streams only the new bytes. Cheap enough to run continuously.
- **Context-window pressure bar.** `lastTurnInputTotal / 200_000`, colour-coded. Crude but it is the
  only pre-compaction early warning in any of these tools.
- **Genuinely tiny.** 888 lines of source, 2 production dependencies, zero build step. The whole
  thing is auditable in one sitting — which matters a lot for a tool that reads your transcripts.
- **Idle-session collapsing** (`watcher.js:296-312`): only the most recent idle session per project
  label is shown, and idle sessions are suppressed entirely for projects that have an active session.
  Small touch, big difference to signal-to-noise on a machine with months of history.

### Marketing that does not survive contact with the source

- **"Correct per-model pricing"** (README, Features). The table has **exactly 3 models** and the
  cache-creation multiplier is **wrong by 5×** (uses 0.25× input; Anthropic bills cache writes at
  1.25× input). Every unmatched model silently bills at Sonnet rates. See
  [Feature inventory](#feature-inventory).
- **"Configuration: set the `PORT` environment variable"** (README). **False.** `watcher.js:333` is
  `const PORT = 3001;` — `process.env.PORT` is never read anywhere in the file. `PORT=8080 npm start`
  does nothing.
- **The README's own pricing snippet is stale.** It shows keys `claude-sonnet-4-20250514` /
  `claude-opus-4-20250514`; the shipped code uses `claude-opus-4-6` / `claude-sonnet-4-6` /
  `claude-haiku-4-5`. Anyone following the README to "update pricing" edits keys that do not exist.
- **"No cloud services. Just a Node.js process reading local files."** The *backend* is local-only,
  true. But `public/index.html` loads React and ReactDOM from **unpkg.com** (lines 295-296) and fonts
  from **fonts.googleapis.com** (lines 7-8). Every dashboard load makes three third-party requests
  and leaks your IP + timing to two CDNs. It also simply does not work offline. **This directly
  conflicts with Loush's zero-telemetry thesis and must be vendored if we port any of the frontend.**
- **"Cross-platform"** — see the Windows label bug.
- **"Active tools"** (repo description). There is no tool-level view; tool names appear only as
  strings inside the collapsible log feed.

---

## Feature inventory

| Feature | What it does | Where in the code (file/dir) | Depends on |
|---|---|---|---|
| JSONL directory watch | Recursive chokidar watch of `~/.claude/projects`, `depth: 4` (reaches `projects/hash/session/subagents/*.jsonl`), `awaitWriteFinish` 300 ms stability / 100 ms poll, `ignoreInitial: false` so it back-fills on boot | `watcher.js:332-354` | `chokidar@^5`, `os.homedir()` |
| File filter | Only `.jsonl`; skips any basename containing `compact` | `watcher.js:346-348` | — |
| Byte-offset tailing | `fileOffsets: Map<path, offset>`; `fs.statSync` → early-return if `size <= offset`; `createReadStream(path, { start: offset })`; sets offset to `stat.size` on `end` | `watcher.js:233-257` | `fs` |
| Line-by-line JSON parse | Splits buffer on `\n`, `JSON.parse` per line, malformed lines swallowed silently | `watcher.js:246-255` | — |
| Event-type ignore list | Drops `file-history-snapshot`, `queue-operation`, `last-prompt`; drops events with no `timestamp` | `watcher.js:82,85` | — |
| Session state map | In-memory `Map<sessionId, session>`; 21-field session object; **no persistence, all state lost on restart** | `watcher.js:23,27-57` | — |
| Per-model pricing table | 3 models, USD per 1M tokens (see exact table below) | `watcher.js:8-12` | — |
| Pricing lookup | `model.includes(key)` substring scan; **falls back to Sonnet for anything unmatched, including unknown/future models** | `watcher.js:14-20` | — |
| Incremental token ledger | `seenMessageIds: Map<sessionId, Map<msgId, {in,out,cacheCreate,cacheRead}>>`; adds only `Math.max(0, curr - prev)` per field | `watcher.js:25,114-133` | — |
| Cost computation | `in*P_in + out*P_out + cacheCreate*P_in*0.25 + cacheRead*P_in*0.10`, all `/1e6`; recomputed from running totals on every assistant event | `watcher.js:139-144` | pricing table |
| Cost rounding | `Math.round(cost * 10000) / 10000` at API boundary (4 dp) | `watcher.js:291` | — |
| Context-window estimate | Backend stores `lastTurnInputTotal = in + cacheCreate + cacheRead` of the latest assistant msg; frontend divides by hardcoded `200_000` and clamps to 100 | `watcher.js:136`; `public/index.html:326-329` | — |
| Context bar colour ramp | `>80% red`, `>50% yellow`, else blue | `public/index.html:331-335` | CSS vars |
| Session status heuristic | 5-branch recency + content-type rules (exact thresholds below) | `watcher.js:209-230` | `lastEventAt`, `lastEventType`, `lastContentTypes` |
| `idle-stale` tier | Applied at API layer: status `idle` **and** `lastEventAt` before local midnight → `idle-stale` | `watcher.js:317-321` | — |
| Turn counting | Increments on any assistant message carrying a `stop_reason` | `watcher.js:169-171` | — |
| Active-files extraction | Scans `tool_use` blocks for `input.file_path \|\| input.path \|\| input.command`, rejects strings containing a space, `path.basename()`, unions with existing, caps at 10 | `watcher.js:66-78,161-165` | `path` |
| Recent log feed | Ring buffer capped at 30 entries; types `tool` / `think` (120-char text snippet) / `user` (120-char); rendered newest-first, collapsed by default | `watcher.js:59-64,146-159,199-206`; `public/index.html:442-455` | — |
| Subagent tracking | Any event with `event.agentId` not starting with `acompact` creates/updates a subagent record; task captured from first user message (120 chars); output tokens summed on `stop_reason` | `watcher.js:174-197` | `agentId` field |
| Subagent status | `Date.now() - eventTs < 15_000` → `thinking`, else `idle` | `watcher.js:184-185` | — |
| Subagent exposure filter | **Only `thinking` subagents are returned** by the API, sorted by `lastEventAt` desc | `watcher.js:285-287` | — |
| Git branch capture | First non-empty `event.gitBranch` wins (sticky, never updated after) | `watcher.js:98-100`; rendered `public/index.html:366` | Claude Code writing `gitBranch` |
| Permission-mode badges | `bypassPermissions` → red **YOLO**; `acceptEdits` → yellow **AUTO-EDIT**; nothing otherwise | `watcher.js:102`; `public/index.html:369-373`, CSS `:143-144` | `event.permissionMode` |
| Project label derivation | First non-empty `event.cwd`; `cwd.split('/')` → last 2 segments joined by `/` — **`/` only, breaks on Windows** | `watcher.js:93-97` | — |
| Idle-session collapsing | Active sessions always shown; idle deduped to newest-per-label; idle dropped entirely if that label has an active session | `watcher.js:296-312` | — |
| Sort order | Sessions active today first, then alphabetical by label | `watcher.js:313-327` | — |
| `GET /api/sessions` | Returns the whole derived array; the only read endpoint | `watcher.js:279-329` | Express |
| `POST /api/open-folder` | `existsSync` guard, then `execFile` (array args, no shell): win32 `explorer` w/ `/`→`\` swap, darwin `open`, else `xdg-open` | `watcher.js:263-277` | `child_process` |
| Click-to-open UX | Project label click POSTs cwd; on failure strikes through the label and sets a tooltip | `public/index.html:346-362` | above endpoint |
| Static file serving | `express.static('public')` | `watcher.js:261` | Express |
| Port-in-use guard | Catches `EADDRINUSE`, prints a hint, `process.exit(1)` | `watcher.js:359-365` | — |
| Frontend polling | `setInterval(fetchSessions, 2000)`, errors swallowed silently, cleared on unmount | `public/index.html:473-477` | — |
| Header aggregates | active/total session count, summed output tokens, summed cost | `public/index.html:479-503` | — |
| Empty state | "No sessions detected" + hint | `public/index.html:507-511` | — |
| Number/time formatting | `K`/`M` abbreviation, `$x.xxxx`, relative `timeAgo`, `en-GB` HH:MM | `public/index.html:301-324` | — |
| Styling | Dark terminal theme, 11 CSS custom properties, IBM Plex Mono, `auto-fill minmax(420px, 1fr)` grid, pulse keyframe on active dots | `public/index.html:9-290` | Google Fonts CDN |

### Exact pricing table (verbatim, `watcher.js:8-12`)

```js
const PRICING = {
  'claude-opus-4-6':   { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6': { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5':  { input: 0.80,  output: 4.00 },
};
```

USD per 1,000,000 tokens. Lookup is `model.includes(key)` (`watcher.js:16-18`); the default for
`null` model **and** for any unmatched model is `claude-sonnet-4-6` (`watcher.js:15,19`).

Cache multipliers are not in the table — they are inlined in the cost formula (`watcher.js:143-144`):

| Component | Multiplier applied | Anthropic's actual ratio | Verdict |
|---|---|---|---|
| Input | `1.00 × input` | 1.0× | correct |
| Output | `1.00 × output` | 1.0× | correct |
| Cache **creation** | `0.25 × input` | **1.25× input** | **wrong, 5× undercount** |
| Cache **read** | `0.10 × input` | 0.1× | correct |

Loush's `entryCost` (`server/index.mjs:1987`) already uses `1.25` for cache creation and is therefore
**more accurate than upstream on this axis**. Do not port their multiplier.

### Exact status-detection thresholds (verbatim logic, `watcher.js:209-230`)

```
deriveStatus(session):
  no lastEventAt                                          -> 'idle'
  elapsed = Date.now() - lastEventAt
  elapsed > 60_000 ms                                     -> 'idle'
  any of last 3 recentLog entries has type 'error'        -> 'error'
  elapsed < 15_000 ms:
      lastEventType == 'assistant':
          lastContentTypes includes 'tool_use'            -> 'thinking'
          lastContentTypes includes 'text'                -> 'waiting'
          lastContentTypes includes 'thinking'            -> 'thinking'
      lastEventType == 'progress'                         -> 'thinking'
      lastEventType == 'user'                             -> 'thinking'
  otherwise                                               -> 'idle'
```

Then at the API layer (`watcher.js:317-321`):
```
status == 'idle' AND (no lastEventAt OR lastEventAt < today 00:00 local) -> 'idle-stale'
```
And for subagents (`watcher.js:184-185`): `elapsed < 15_000` → `thinking`, else `idle`.

**Threshold summary:** `15_000 ms` = active window; `60_000 ms` = idle cutoff; the 15–60 s band always
resolves to `idle`; `error` looks back exactly 3 log entries; `idle-stale` boundary is local midnight;
context window denominator is `200_000` tokens.

Note `CLAUDE.md:117-121` specifies **10 s** for the active window; the shipped code uses **15 s**. The
brief also lists an `error` event type that `processEvent` never actually produces — no code path ever
writes `{ type: 'error' }` into `recentLog`, so **the `error` status is dead code and can never fire**.

---

## UX and interaction design

Single-screen, zero-navigation, zero-configuration. There are no tabs, no routes, no settings, no
filters, no search, no date range. You open localhost:3001 and the whole product is visible.

**Layout.** Fixed header bar (title + pulsing green dot + three aggregate stats) above a responsive
card grid (`repeat(auto-fill, minmax(420px, 1fr))`), max-width 1400px. Every session is a card.

**The status language is the product.** Status is encoded **three times redundantly** on each card,
which is why it reads at a glance from across the room:
1. Left border colour (3 px): green `thinking` / yellow `waiting` / red `error` / orange `idle` /
   border-grey `idle-stale`
2. A dot next to the title, **animated with a `pulse` keyframe only for `thinking` (1.5 s) and
   `waiting` (2 s)** — motion means "this session is live"; static means it is not
3. An uppercase text pill in the top-right

Plus **opacity as a depth cue**: `idle` cards drop to `0.7`, `idle-stale` to `0.35`
(`public/index.html:94-95`). Stale sessions visually recede rather than disappear. This is a nice
touch — it preserves context without competing for attention.

**Card anatomy** (top to bottom): project label + git branch → permission badge + status pill →
2×3 meta grid (Model, Cost, Output, Cache Read, Turns, Last Event) → context-window bar with % →
blue file tags → subagent list → `+ Show log (30)` toggle.

**Interactions — there are exactly two.** Click the project label to open the folder in the OS file
manager; click `+ Show log` to expand the 30-entry feed. That is the complete interaction surface.
Expansion state is local `useState` per card, so **it resets on... nothing, actually** — the 2 s poll
replaces the `sessions` array but React reconciles by `key: s.sessionId`, so expanded cards stay
expanded across refreshes. Correct by construction.

**Honest failure feedback.** If `open-folder` 404s, the label gets `text-decoration: line-through`
and a tooltip naming the missing path (`public/index.html:353-357`). Small, but it is exactly the
"don't lie to the user" instinct Loush's honesty rules encode.

**Refresh model.** Poll every 2 s, `.catch(() => {})` — if the backend dies the UI silently freezes on
the last good data with no indication. `lastFetch` state is captured but **never rendered**
(`public/index.html:461,468`), so there is no "last updated" or staleness indicator. A real gap.

**From the author's own screenshot**, two UX problems are directly visible:
- Card titles show full Windows paths (`C:\aWork\SVN_Repository\game\BeatHazardArcade`) instead of the
  intended two-segment label.
- A file tag reads `bknlb8cuf.output` — junk produced by `extractActiveFiles` falling back to
  `input.command` and taking its basename. The file-tag list is noisy.
- Git branch renders as `HEAD` (detached-HEAD sessions) with no special handling.

---

## Architecture

**Data sources.** Exactly one: `~/.claude/projects/**/*.jsonl` (`watcher.js:332`). No git shelling-out,
no `~/.claude.json`, no settings files, no repo scanning, no network. Git branch, cwd, permission mode
and Claude Code version are all read **out of the transcript events themselves**, not from disk — the
tool never touches the repos it reports on.

**Ingestion.** chokidar recursive watch (depth 4, `awaitWriteFinish`) → on `add`/`change`, extension +
`compact` filter → `processFile` stats the file, early-returns if not grown, streams only bytes from
the stored offset → split on `\n` → `JSON.parse` per line → `processEvent` folds into an in-memory Map.
Because `ignoreInitial: false`, the whole history back-fills on startup, which is what produces the
`$103.8129` all-time total in the screenshot.

**Storage.** None. Pure in-memory `Map`s (`sessions`, `fileOffsets`, `seenMessageIds`). Restarting
`watcher.js` re-reads every transcript from byte 0 and rebuilds everything. There is no database, no
cache file, no snapshot. For a few dozen sessions this is fine; it is O(all history) at every boot.

**Transport.** Plain HTTP polling. One `GET /api/sessions` every 2 s, returning the full array —
no deltas, no ETag, no `Cache-Control`, no compression, no pagination. Plus one `POST /api/open-folder`
side-effect endpoint. **No WebSockets, by explicit design** (`CLAUDE.md:151` lists WebSocket push under
Non-Goals). Derivation (`deriveStatus`, idle collapsing, sorting, rounding) happens **at request time**,
not at ingest time — so status is always computed against `Date.now()` at the moment of the poll, which
is what makes the freshness correct despite the coarse transport.

**Frontend state.** React 18 UMD from CDN, `React.createElement` calls (no JSX → no build step, no
Babel). Two components total: `Dashboard` (owns `sessions`, `lastFetch`) and `SessionCard` (owns
`expanded`). Server is the single source of truth; the client does zero derivation beyond formatting
and the context-window percentage. No router, no state library, no memoisation.

**Tooling.** None. No bundler, no transpiler, no linter, no formatter, no test runner, no CI, no
type-checking. `npm start` is `node watcher.js`.

```
                    Claude Code CLI instances (N terminals)
                                   |
                                   | append JSONL
                                   v
             ~/.claude/projects/<project-hash>/<session-uuid>.jsonl
             ~/.claude/projects/<project-hash>/<uuid>/subagents/*.jsonl
                                   |
                                   | fs events (chokidar, depth 4,
                                   |   awaitWriteFinish 300ms/100ms)
                                   v
                    +------------------------------------+
                    |  processFile()      watcher.js:233 |
                    |  fileOffsets: path -> byte offset  |
                    |  read ONLY [offset .. EOF]         |
                    +------------------------------------+
                                   | one JSON object per line
                                   v
                    +------------------------------------+
                    |  processEvent()     watcher.js:80  |
                    |   - cwd/branch/permMode (sticky)   |
                    |   - usage delta per message.id     |
                    |     (seenMessageIds ledger)        |
                    |   - cost recompute (PRICING)       |
                    |   - activeFiles / recentLog(30)    |
                    |   - subagents[agentId]             |
                    +------------------------------------+
                                   |
                                   v
                    +------------------------------------+
                    |  sessions: Map<sessionId, state>   |
                    |  ** in-memory only, no persistence |
                    +------------------------------------+
                                   |
                                   | GET /api/sessions  (request-time derivation)
                                   |   deriveStatus() -> thinking/waiting/idle/idle-stale
                                   |   idle collapsing + sort + 4dp cost rounding
                                   v
                    +------------------------------------+
                    |  Express 5   :3001  (hardcoded)    |
                    |  + express.static('public')        |
                    |  + POST /api/open-folder -> execFile|
                    +------------------------------------+
                                   ^
                                   | poll every 2000 ms (no WS)
                                   |
                    +------------------------------------+
                    |  public/index.html                 |
                    |  React 18 UMD  <- unpkg.com  (!)   |
                    |  IBM Plex Mono <- gstatic    (!)   |
                    |  Dashboard -> SessionCard[]        |
                    +------------------------------------+

(!) = third-party network dependency; conflicts with Loush zero-telemetry thesis
```

---

## Notable code worth stealing

Ranked by value to us.

### 1. Per-`message.id` incremental usage ledger — `watcher.js:25, 114-133`

**What it does.** Keeps `Map<sessionId, Map<messageId, {in,out,cacheCreate,cacheRead}>>` and adds only
`Math.max(0, curr - prev)` for each field on every assistant event.

**Why it's good.** Claude Code emits multiple JSONL events carrying the *same* `message.id` as a
response streams/continues, and the `usage` object on each is **cumulative, not incremental**. Summing
`usage` across events double-counts. The `Math.max(0, ...)` clamp also makes it robust to out-of-order
or replayed lines. This is the one piece of real domain knowledge in the repo.

**Relevance to us:** `server/index.mjs:681-684` pushes one entry per assistant event and sums
`rec.out += e.out` with **no message-id dedup**. If Claude Code re-emits cumulative usage for a message
id, our `/api/usage`, `/api/roi`, cost totals, and `ReliabilitySection` numbers are **inflated**. This
is worth verifying against a real transcript regardless of whether we port anything else.

**Port difficulty: Easy.** ~15 lines, pure function of the event stream, no deps, no React.

### 2. Byte-offset incremental tailing — `watcher.js:24, 233-257`

**What it does.** `Map<path, offset>`; `statSync` → skip if `size <= offset`; `createReadStream({ start: offset })`.

**Why it's good.** Turns "re-parse every transcript" into "parse the new bytes". Our `collectUsage()`
(`server/index.mjs:660-716`) re-walks and re-reads **every** `.jsonl` under `~/.claude/projects` on
each call. On a machine with months of history that is the dominant cost of several of our endpoints.

**Port difficulty: Easy** for the mechanism itself (~20 lines, `fs` only). **Medium** to wire into
`collectUsage`, which currently assumes a stateless full re-read and would need a persistent accumulator.
Note their implementation has a correctness bug (below) — port the idea, fix the boundary handling.

### 3. `deriveStatus()` — request-time status derivation — `watcher.js:209-230`

**What it does.** Maps `(elapsed, lastEventType, lastContentTypes)` to
`thinking | waiting | idle | idle-stale`.

**Why it's good.** Two things. First, the **`thinking` vs `waiting` distinction** — derived from whether
the last assistant content block was a `tool_use` (still working) or `text` (has spoken, now blocked on
you). That is the highest-value bit of information in the whole product and it costs 5 lines. Second,
**it is computed at request time, not at ingest time**, so freshness is always relative to `Date.now()`
at the poll — a session that goes quiet transitions to idle with no event needed to push it there.

**Relevance to us:** our only liveness notion is `ACTIVE_MS = 5 * 60_000` mtime comparison
(`server/index.mjs:798, 836`) — a binary running/not-running at 5-minute granularity. We cannot
distinguish "Claude is working" from "Claude is waiting for me", which is precisely the actionable
distinction.

**Port difficulty: Easy** as a pure function. **Medium** end-to-end, because we must also capture
`lastEventType` / `lastContentTypes` per session during ingest, which we do not currently retain.

### 4. Idle-session collapsing and ranking — `watcher.js:296-327`

**What it does.** Active sessions always shown; idle sessions deduped to the newest per project label;
idle suppressed entirely for labels that already have an active session; sorted active-today-first then
alphabetically.

**Why it's good.** This is what makes the view usable on a machine with hundreds of historical sessions
instead of a wall of dead cards. It is pure list algebra over the session array.

**Port difficulty: Easy.** ~25 lines, no deps.

### 5. Redundant status encoding + opacity depth — `public/index.html:91-95, 111-134`

**What it does.** Border colour + pulsing dot + text pill, all three; plus opacity `0.7` / `0.35` for
idle / stale tiers.

**Why it's good.** Glanceable from across a room, and it degrades gracefully for colour-blind users
because motion and text carry the same signal as hue. The opacity tiering keeps stale context on screen
without letting it compete. Cheap, well-judged visual design.

**Port difficulty: Easy.** CSS only; adapt to our existing custom-property theme. Do **not** copy their
palette wholesale — match Loush tokens.

### 6. `POST /api/open-folder` — cross-platform reveal — `watcher.js:263-277`

**What it does.** `existsSync` guard, then `execFile` with **array args and no shell** — `explorer`
(win32, `/`→`\`), `open` (darwin), `xdg-open` (else).

**Why it's good.** This is the post-fix version (commit `e7c7eda`, "Fix command injection vulnerability
in open-folder endpoint"). Using `execFile` with an argv array rather than `exec` with an interpolated
string is the correct fix and worth copying as a pattern.

**Caveat:** still lacks a `Host`-header check, so a DNS-rebinding attacker could drive it; and it will
open *any* existing path on the machine, not just known project roots. If we port it, **allowlist
against our configured project roots** (`projects.example.json` / our resolved project list).

**Port difficulty: Easy.** ~15 lines. Express 4 (ours) vs Express 5 (theirs) makes no difference here.

### 7. Context-window pressure bar — `watcher.js:136` + `public/index.html:326-335`

**What it does.** `lastTurnInputTotal = input + cacheCreation + cacheRead` of the most recent assistant
message, divided by a hardcoded `200_000`, colour-ramped at 50%/80%.

**Why it's good.** Correct *concept* — the last turn's total input **is** the live context occupancy,
and it is the only pre-compaction warning available. Cheap to compute.

**Why it needs work before we ship it.** The 200 K denominator is hardcoded in the frontend and is
wrong for 1 M-context models; and the frontend silently falls back to `session.tokensIn` (the
*lifetime* input total) when `lastTurnInputTotal` is absent (`public/index.html:340`) — which produces a
meaningless, usually-pegged-at-100% bar. **That fallback violates our honesty rules and must be dropped
in favour of rendering "unknown".**

**Port difficulty: Medium.** Logic is trivial; making the window size model-aware and honest about
unknowns is the actual work.

### 8. Subagent liveness rollup — `watcher.js:174-197, 285-287`

**What it does.** Keys subagents off `event.agentId` (excluding `acompact*`), captures the task string
from the first user message, sums output tokens, and **returns only currently-`thinking` subagents**.

**Why it's good.** "What are my agents doing right now" as a one-line-per-agent list. The
active-only filter is the right default. We already locate subagent transcripts
(`server/index.mjs:836, 1157-1165`) but only ever count them.

**Port difficulty: Medium.** Depends on `agentId` appearing on events; our existing subagent handling
is directory-based (`subagents/` path matching), so this is a second, complementary signal to reconcile.

---

## Gaps and weaknesses

**Correctness**

1. **Cache-creation cost undercounted 5×.** `0.25 × input` where Anthropic bills `1.25 × input`
   (`watcher.js:143`). Every displayed cost is low, and the error scales with cache-heavy workloads.
2. **Tail-offset race → duplicate log entries.** `processFile` captures `stat` *before* opening the
   stream, then `createReadStream(path, { start: offset })` with **no `end`** — so it reads to the
   *current* EOF, which may exceed the captured `stat.size`. It then sets the offset to the stale
   `stat.size` (`watcher.js:245`). Bytes written during the read are processed **and re-processed** on
   the next change. Token totals survive (the msg-id ledger dedups them), but `recentLog` and
   `turnCount` do not.
3. **Lines straddling the offset boundary are lost forever.** A partial JSON line at the end of a read
   fails `JSON.parse`, is silently swallowed (`watcher.js:252-254`), and the offset has already advanced
   past it. `awaitWriteFinish` reduces the window but does not close it. There is no carry-over buffer.
4. **Windows label bug.** `event.cwd.split('/')` (`watcher.js:95`) — backslash paths never split, so
   `slice(-2).join('/')` returns the entire absolute path. Visible in the project's own screenshot.
   Fix is `split(/[\\/]/)`.
5. **`error` status is unreachable.** `deriveStatus` looks for `recentLog` entries of type `error`
   (`watcher.js:217`), but no code path ever creates one. The red border, red dot, and red pill
   (`public/index.html:93,118,132`) are all dead CSS.
6. **`turnCount` over-counts.** Incremented on every assistant event bearing a `stop_reason`
   (`watcher.js:169-171`) with no message-id guard — the same logical turn can increment it more than
   once, unlike the token path which *is* deduped.
7. **Sticky-first-value fields.** `cwd`, `gitBranch` and `label` are set once and never updated
   (`watcher.js:93-100`). Switch branches mid-session and the dashboard keeps showing the old one,
   with no staleness indicator.
8. **Unknown models silently bill as Sonnet** (`watcher.js:19`). No "unknown model" surface. A repo of
   Opus work under an unrecognised id reports ~1/5 of true cost, presented with 4-decimal confidence.
9. **Noisy active-files.** `input.command` is used as a filename source and space-free bash tokens get
   `path.basename()`'d into file tags (`watcher.js:71-72`) — hence `bknlb8cuf.output` in the screenshot.

**Honesty / presentation** — relevant because Loush's thesis is the opposite

10. **Costs shown to 4 decimals** (`public/index.html:308`) despite a 3-model table, a Sonnet fallback,
    and a wrong cache multiplier. False precision.
11. **Context bar falls back to lifetime `tokensIn`** when `lastTurnInputTotal` is missing
    (`public/index.html:340`) — renders a confidently wrong percentage rather than "unknown".
    **Directly contrary to our "null is never rendered as 0" rule** (this is its mirror image: unknown
    rendered as a plausible number).
12. **No staleness indicator.** Poll failures are swallowed (`public/index.html:470`) and `lastFetch` is
    tracked but never rendered. A dead backend looks like a calm dashboard.

**Architecture / operations**

13. **`PORT` env var documented but not implemented** (`watcher.js:333`). Documentation bug.
14. **No persistence.** All state lost on restart; full history re-parsed from byte 0 every boot.
15. **Full-array polling.** Entire session array serialised every 2 s regardless of change; no ETag,
    no compression, no deltas. Fine at 14 sessions, wasteful at 200.
16. **Third-party CDN dependencies** (unpkg ×2, Google Fonts ×2 — `public/index.html:7-8, 295-296`).
    Breaks offline use and leaks request metadata, contradicting the README's local-first framing.
17. **Unpinned React** — `react@18` from unpkg resolves to whatever unpkg serves. Not reproducible.
18. **No `Host`-header / CSRF protection** on `POST /api/open-folder`. `execFile` is safe from shell
    injection post-fix, but DNS rebinding could still drive folder-opening on the user's machine.
19. **Hardcoded 200 K context window** in the frontend; wrong for 1 M-context models.
20. **Zero tests, zero CI, zero linting.** 888 lines with no automated verification of any kind.
21. **Abandoned.** 4 commits, one day, ~4.5 months cold. No maintainer to upstream fixes to — port and
    own the code rather than depending on it.

---

## Overlap with Loush Dashboard

| Their feature | Our equivalent section (or NONE) | Who does it better | Note |
|---|---|---|---|
| Live multi-session board, 2 s refresh | **NONE** — `SessionsSection.jsx` is historical browse; `ProjectHub.jsx` shows binary running counts | **Them, decisively** | Our only liveness is `ACTIVE_MS = 5*60_000` mtime (`server/index.mjs:798`). No present-tense board exists. |
| `thinking` vs `waiting` status | **NONE** | **Them** | We cannot express "blocked on the human". Highest-value gap. |
| `idle-stale` tier (pre-midnight) | Partially `ActivityTimeline.jsx` | Them | Cheap, well-judged noise reduction. |
| Per-model pricing table | `server/index.mjs:718` `PRICE_PER_M` regex | **Us on structure, them on shape** | Ours: `/opus\|fable/→15, /haiku/→0.8, else 3` — input-only, regex, no output prices. Theirs: explicit table with output prices but only 3 models. Neither is good; **merge**. |
| Cost formula | `entryCost` (`server/index.mjs:1987`) | **Us** | Ours uses cache-write `1.25×` (correct); theirs `0.25×` (wrong). Ours derives output as `5×` input, theirs uses real per-model output prices. Ours is more correct, theirs is more principled. |
| Per-`message.id` usage dedup | **NONE** | **Them** | `server/index.mjs:681-684` sums with no msg-id guard — **suspected over-count in our numbers**. |
| Byte-offset incremental tailing | **NONE** | **Them** | `collectUsage()` (`server/index.mjs:660`) full-re-reads every transcript per call. |
| Context-window usage bar | **NONE** | **Them** (concept only) | We compute `hiddenPerTurn` from `HARNESS_DEFAULTS.context.alwaysLoadedBudget` (`server/index.mjs:771`) but render no live occupancy bar. |
| Active subagents, live | `server/index.mjs:836` counts `runningAgents`; `:1157-1165` resolves agent transcripts | **Them on presentation, us on plumbing** | We find subagents but only count them; no live task list. |
| Active files per session | `WorkingSet.jsx` (flagship) | **Us, overwhelmingly** | Theirs is a basename heuristic that emits junk like `bknlb8cuf.output`. Ours joins real repo state. |
| Git branch display | `server/index.mjs:687, 2335` — branch-level cost/output ledger | **Us** | We already aggregate cost *per branch*; they only display a sticky string. |
| Permission-mode badges (YOLO/AUTO-EDIT) | `server/index.mjs:1226` — from agent meta, not live session | **Them for live sessions** | We surface `permissionMode` for agent configs; not as a live per-session risk badge. |
| Recent log feed (30, expandable) | `ChatSection.jsx`, `ForensicsSection.jsx` | **Us** | Ours is a full transcript reader; theirs is a 120-char ring buffer. |
| Click project → open folder | `ProjectsSection.jsx` / `ProjectHub.jsx` | Roughly equal | Their `execFile` array-arg pattern is worth copying verbatim. |
| Cost aggregates header | `UsagePanel.jsx`, `ReliabilitySection.jsx` (`byDay`/`byProj`/`byModel` usd) | **Us, overwhelmingly** | We have budgets, alerts, month-end projection, cache-waste, anomaly detection. |
| Cache-read savings | `costSaved` (`server/index.mjs:764`), `cacheTtl` block | **Us** | They only display raw cache-read tokens. |
| Session dedup / collapsing | **NONE** | **Them** | Useful list algebra we lack. |
| No build step | We use Vite + `concurrently` | Them for install friction, **us for capability** | Not worth changing; our 35 sections need a bundler. |
| Persistence | Neither persists derived state | Tie | Both rebuild from transcripts. |
| Tests / CI | `test/` + `node --test` | **Us** | They have none. |
| Zero third-party network calls | Our thesis; they load unpkg + Google Fonts | **Us** | **Anything ported from their frontend must be de-CDN'd.** |
| Retrospective analytics, ROI, JIRA/PR join, prompt quality, governance, forensics | 35 sections | **Us — not remotely comparable** | Upstream has 1 view. Different product. |

**Summary of the overlap.** Loush is a superset on everything retrospective and analytical. Upstream
beats us on exactly one axis — **present-tense liveness** — and on three reusable ingest mechanics
(msg-id dedup, byte-offset tailing, status derivation). There is no strategic threat here; there is a
missing view and three good algorithms.

---

## Recommended adoptions

Ranked by value-per-effort.

### 1. Per-`message.id` usage dedup — and audit whether we are over-counting today — **S**

- **Take:** `watcher.js:114-133` verbatim logic (`Map<msgId, {in,out,cc,cr}>`, add `Math.max(0, curr - prev)`).
- **Lands in:** `server/index.mjs` `collectUsage()` around lines 676-690.
- **Unlocks:** correctness of every cost/token number we render — `/api/usage`, `/api/roi`,
  `UsagePanel.jsx`, `ReliabilitySection.jsx`, budget alerts, `costSaved`, month-end projection.
- **Do this first even if we adopt nothing else.** Start by writing a test against a real transcript
  fixture to confirm whether duplicate `message.id`s with cumulative usage actually occur; if they do,
  our published numbers are inflated and that is a correctness bug in the flagship value claim
  ("every number computed from real files").

### 2. A "Live" / "Now" session board — **M**

- **Take:** `deriveStatus()` (`watcher.js:209-230`), the idle-collapsing + sort algebra
  (`watcher.js:296-327`), and the triple-encoded status visual language
  (`public/index.html:91-95, 111-134`).
- **Lands in:** new `src/sections/LiveSection.jsx` (or fold into `SessionsSection.jsx` as a "Now" tab);
  new `GET /api/live` in `server/index.mjs`; ingest must start retaining `lastEventType` and
  `lastContentTypes` per session.
- **Effort note:** the pure functions are trivial; the work is retaining the two new per-session fields
  during ingest and adding a 2 s poll (`setInterval` in the section, cleared on unmount — no WebSocket
  needed, consistent with our no-WS stance).
- **Unlocks:** the one thing we genuinely cannot do today — telling the user *which session is waiting
  on them right now*. Highest user-visible payoff in this document.
- **Honesty adaptation:** render `unknown` rather than `idle` when `lastEventAt` is absent.

### 3. Merge the pricing tables — **S**

- **Take:** the *shape* of `PRICING` (`watcher.js:8-12`) — explicit per-model `{input, output}`.
  **Reject** their `0.25` cache-creation multiplier; keep our `1.25`.
- **Lands in:** `server/index.mjs:718` (`PRICE_PER_M`) and `:1987` (`entryCost`), promoted to a shared
  table — good candidate for a new `lib/pricing.mjs`.
- **Unlocks:** real per-model output pricing instead of our `output = 5 × input` approximation, and a
  place to represent **"unknown model"** explicitly instead of silently defaulting to Sonnet rates.
- **Honesty adaptation:** an unmatched model must produce a `null` cost that renders as "unpriced",
  **not** a Sonnet-priced guess. This is exactly our "null is never rendered as 0" rule, and both our
  current regex and their table violate it today.

### 4. Byte-offset incremental tailing — **M**

- **Take:** `fileOffsets` mechanism (`watcher.js:233-257`), **with the boundary bugs fixed** — pass an
  explicit `end` to `createReadStream`, and carry the trailing partial line forward in a per-file
  buffer instead of discarding it.
- **Lands in:** `server/index.mjs:660-716` (`collectUsage`), plus a module-level accumulator.
- **Unlocks:** `collectUsage` stops being O(all history) per call; makes a 2 s live poll affordable and
  speeds up every usage-derived endpoint.
- **Sequencing note:** do this *after* #2, because the live board is what makes the performance
  actually matter.

### 5. Context-window pressure bar — **M**

- **Take:** `lastTurnInputTotal = in + cacheCreate + cacheRead` (`watcher.js:136`) and the 50/80 colour
  ramp (`public/index.html:331-335`).
- **Lands in:** the new live board (#2) and/or `WorkingSet.jsx`; `ResourceSection.jsx` is the natural
  home for a historical version.
- **Unlocks:** pre-compaction warning — "this session is at 76% and about to compact".
- **Honesty adaptations (both mandatory):** make the denominator model-aware rather than a hardcoded
  `200_000`, and **drop their lifetime-`tokensIn` fallback** (`public/index.html:340`) — render
  "unknown" when `lastTurnInputTotal` is absent.

### 6. Permission-mode risk badges on live sessions — **S**

- **Take:** `event.permissionMode` capture (`watcher.js:102`) + YOLO / AUTO-EDIT badge rendering
  (`public/index.html:369-373`).
- **Lands in:** the live board (#2); `GovernanceSection.jsx` for the policy/audit view;
  `HarnessSection.jsx` for config-level reporting.
- **Unlocks:** at-a-glance "one of my sessions is running with permissions bypassed **right now**" —
  a governance signal we currently only surface for agent configs (`server/index.mjs:1226`), not live
  sessions.

### 7. Live subagent rollup — **M**

- **Take:** `agentId`-keyed tracking + first-user-message task capture + active-only filter
  (`watcher.js:174-197, 285-287`).
- **Lands in:** live board (#2) and `RunsSection.jsx`.
- **Unlocks:** "what are my agents doing right now" instead of our current bare `runningAgents` count
  (`server/index.mjs:836`).
- **Note:** reconcile the `agentId`-event signal with our existing directory-based subagent discovery
  (`server/index.mjs:1157-1165`) — they are complementary, not redundant.

### 8. Hardened `open-folder` — **S**

- **Take:** `execFile`-with-array-args platform switch (`watcher.js:263-277`).
- **Lands in:** `server/index.mjs`, reusable from `ProjectsSection.jsx` / `ProjectHub.jsx`.
- **Unlocks:** safe cross-platform "reveal in file manager".
- **Harden beyond upstream:** allowlist the target against our configured project roots, and add a
  `Host`-header check (upstream has neither; DNS rebinding can drive their endpoint).

### Explicitly do not adopt

- Their `0.25` cache-creation multiplier — ours is correct, theirs is wrong by 5×.
- CDN-loaded React and Google Fonts (`public/index.html:7-8, 295-296`) — violates zero-telemetry and
  offline use. Vendor anything we take.
- 4-decimal cost display on approximate pricing — false precision.
- The `input.command` → `path.basename()` active-files heuristic — produces junk; our `WorkingSet.jsx`
  is far better.
- Their sticky-first-value `cwd`/`gitBranch` handling — we already track branch properly and
  per-branch.

---

## Sources

**Primary (source read verbatim, `main` @ `e7c7eda`, fetched 2026-07-29)**

- Repo landing page — https://github.com/Stargx/claude-code-dashboard
- `README.md` — https://raw.githubusercontent.com/Stargx/claude-code-dashboard/main/README.md
- `watcher.js` (366 lines, read in full) — https://raw.githubusercontent.com/Stargx/claude-code-dashboard/main/watcher.js
- `public/index.html` (522 lines, read in full) — https://raw.githubusercontent.com/Stargx/claude-code-dashboard/main/public/index.html
- `CLAUDE.md` (176 lines, read in full) — https://raw.githubusercontent.com/Stargx/claude-code-dashboard/main/CLAUDE.md
- `LICENSE` — https://raw.githubusercontent.com/Stargx/claude-code-dashboard/main/LICENSE
- `package.json` — https://raw.githubusercontent.com/Stargx/claude-code-dashboard/main/package.json
- `Screenshot.png` (viewed) — https://raw.githubusercontent.com/Stargx/claude-code-dashboard/main/Screenshot.png
- Repo metadata — https://api.github.com/repos/Stargx/claude-code-dashboard
- File tree — https://api.github.com/repos/Stargx/claude-code-dashboard/git/trees/main?recursive=1
- Commit history — https://api.github.com/repos/Stargx/claude-code-dashboard/commits

**Our codebase (for comparison)**

- `E:\AI-Dashboard\server\index.mjs` — `PRICE_PER_M` (:718), `entryCost` (:1987), `collectUsage` (:660-716),
  `ACTIVE_MS` (:798, :836), `gitBranch` ledger (:687, :2335), `permissionMode` (:1226),
  subagent transcript resolution (:1157-1165)
- `E:\AI-Dashboard\src\sections\` — 35 section components
- `E:\AI-Dashboard\package.json` — deps and scripts

**Third-party coverage**

Two web searches (project name + author + "Cold Beam Games"; project name + "Show HN"/reddit/review)
returned **no reviews, blog posts, forum threads, or writeups about this specific project**. Searches
surfaced only the repo itself plus unrelated same-category tools (`onikan27/claude-code-monitor`,
`hoangsonww/Claude-Code-Agent-Monitor`, `dlupiak/claude-session-dashboard`,
`mukul975/claude-team-dashboard`, `ek33450505/claude-code-dashboard`). At 10 stars with no external
discussion, **there is no community reception to report — this is unverified rather than negative.**

**Prompt-injection note:** no fetched page, README, source comment, or `CLAUDE.md` section contained
text attempting to instruct or redirect the researching agent. `CLAUDE.md` is a project brief written
by the author *for their own* Claude Code session (it contains developer instructions such as "do this
first, before any code"); those are **historical build instructions addressed to a past session, not
directives to us**, and were treated purely as documentary evidence of design intent.
