# Claude Code Dashboard ("claude-code-insights" / "CSI")

> Upstream research for porting into Loush Dashboard (`LinuxDevil/AI-Dashboard`).
> Researched 2026-07-29 against commit `6cb3691` (repo HEAD, default branch `main`).
> Author has granted us permission to copy/adapt code.

---

## Identity

| Field | Value |
|---|---|
| Repo URL | https://github.com/yahav10/claude-code-dashboard |
| npm package | `claude-code-insights` (https://www.npmjs.com/package/claude-code-insights) |
| Internal name | "CSI" — Claude Session Intelligence (per `docs/application-overview.md`) |
| Author | `tomyahav` — single author, commits signed `tyahav@tremorvideo.com`; npm maintainer `Tommy Ahav <tommyahav@gmail.com>` |
| License | **MIT** (SPDX: `MIT`). `LICENSE` reads "Copyright (c) 2026 Claude Code Dashboard Contributors" |
| Stars / Forks / Watchers | **4 stars, 1 fork, 1 watcher**, 0 open issues (GitHub API, 2026-07-29) |
| Repo created | 2026-02-22 |
| Last commit | **2026-03-06** (`6cb3691`, docs-only README redesign) |
| Last code commit | 2026-02-25 (`570db81`, URL rename + CLI version bump) |
| Activity | **Dormant.** 29 commits total, all by one author, essentially all between 2026-02-17 and 2026-02-25. No commits in ~5 months. |
| Repo size | 334 KB |
| Primary language | GitHub API reports `Vue`; the README badge claims TypeScript. ~18,180 lines across `apps/` + `packages/` |
| Install method | `npx claude-code-insights` or `npm install -g claude-code-insights`; serves `http://localhost:3838` |
| npm versions | 0.1.0 → 0.1.4, all published 2026-02-23 to 2026-02-25. Latest **0.1.4** (2026-02-25) |
| Platforms | Node.js >= 20, pnpm >= 9. Native dep `better-sqlite3` requires a build toolchain. **POSIX-biased** — see Gaps |
| Governance files | `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md` all present |

**Naming caution.** The repo is `claude-code-dashboard`, the npm package is `claude-code-insights`, the docs call it "CSI", and the SQLite cache dir is `claude-code-dashboard`. The same author also ships an unrelated repo `yahav10/claude-insights` (parses Claude Code's built-in `/insights` HTML report). Several other unrelated projects also use "claude code insights". Do not conflate them.

---

## The problem it solves

Claude Code writes every session to `~/.claude/projects/**/*.jsonl` and then never shows it to you again. The transcripts contain per-message token usage, model IDs, tool calls, errors, cache hit data, git branch, cwd, CLI version and permission mode — but the CLI surfaces none of it in aggregate. Concretely, a developer cannot answer:

- What did Claude Code cost me last month, per project and per model?
- Which tools fail most often, and in which sessions?
- Is my prompt cache actually working, or am I re-sending context every turn?
- Which sessions burned 10x the average and why?
- What is happening in the session running right now in another terminal?

CSI's answer: index the JSONL into SQLite once, then serve a Vue SPA of charts over it, plus a live tail and an embedded agent runner. The privacy angle is the other half of the pitch — competing usage trackers ship telemetry, and CSI's differentiator is that it structurally cannot.

---

## Value proposition

**Real value (verified in code):**

1. **Incremental mtime-keyed indexing into SQLite.** `runFullIndex` skips any file whose `mtime` matches the stored `file_mtime` (`services/indexer.ts:97-105`). This is the genuinely reusable idea: a persistent, restart-surviving parse cache.
2. **A correct, explicit per-model pricing table.** `packages/cost-engine/src/pricing.ts` carries four separate rates per model (input, output, cache-read, cache-write) with regex model matching and a documented fallback. This is materially more accurate than ratio-derived pricing.
3. **PII redaction as a pure, dependency-free function.** `middleware/pii-detector.ts` is ~60 lines, no imports, and returns typed match offsets. Directly liftable.
4. **A network guard that is actually a guard.** Monkey-patching `net.Socket.prototype.connect` before any other import (`main.ts:1-2`) is a real enforcement mechanism, not a policy statement.
5. **Byte-offset SSE tailing.** `routes/live.ts` tracks a per-file byte offset and reads only the delta — it never re-parses the whole file to detect new lines.
6. **Tool-name enrichment.** `Skill` → `Skill(brainstorming)` and `Task` → `Task(Explore)` at index time (`indexer.ts:223-237`), which makes skill/subagent analytics possible with a plain `LIKE 'Skill(%'` query.
7. **A permission-gated agent.** `canUseTool` bridges the SDK's approval callback to a browser modal with a risk classification (`routes/agent.ts:39-45, 430-451`).

**Marketing that does not survive reading the code:**

- **"Zero outbound connections"** is in direct tension with the Agent feature, which calls the Anthropic API. The socket patch only covers the dashboard's own Node process; the Claude Agent SDK reaches the API from a spawned `claude` CLI child process, which an in-process `net.Socket` patch cannot intercept. *(The subprocess mechanism is how the SDK is known to work; I did not install `node_modules` to confirm it in this checkout — treat the mechanism as **unverified**, but the contradiction between the two claims is real either way.)*
- **"Zero-trust architecture"** overstates it. It's CSP headers, a localhost bind, a socket patch, and a regex redactor. Good hygiene, not zero-trust.
- **"AI Insights"** are ten hand-written `if` statements over aggregate numbers. No model is involved. Several are near-tautological (`abandoned-session` fires on any session with ≤2 messages).
- **"60+ Vue components"** is accurate by file count but many are thin chart wrappers.
- **CLI flags `--dir` and `--port` do not work.** See Gaps — this is the most consequential gap between the README and the code.

---

## Feature inventory

| Feature | What it does | Where in the code (file/dir) | Depends on |
|---|---|---|---|
| Directory scanner | Recursive walk of `~/.claude/projects`, depth cap 10, skips dotfiles, skips files >500 MB or 0 bytes, refuses to scan outside `$HOME` via `realpathSync` | `apps/server/src/services/scanner.ts` | `fs`, `os` |
| JSONL reader | Streaming line reader, BOM strip, 10 MB per-line cap, Zod `safeParse` per line, counts skipped lines instead of throwing | `packages/session-parser/src/jsonl-reader.ts` | `readline`, Zod |
| Record schema | Discriminated union over 8 record types: user, assistant, tool_use, tool_result, queue-operation, system, file-history-snapshot, progress | `packages/shared-types/src/session.ts` | Zod |
| Session summary builder | Folds records into 26-field summary: tokens, cost, cache hit rate, models, tools, skills, compactions, files modified, thinking blocks, image count, CLI version, permission mode, slug | `packages/session-parser/src/session-builder.ts` | cost-engine |
| Incremental indexer | Skips unchanged files by mtime; batches 4 files; wraps each batch in one SQLite transaction; deletes+reinserts messages per session | `apps/server/src/services/indexer.ts` | better-sqlite3, session-parser |
| Tool-name enrichment | Rewrites `Skill`/`Task` tool names to embed skill name / subagent type | `apps/server/src/services/indexer.ts:223-237` | — |
| SQLite schema + migrations | 3 tables, 4 indexes, WAL; `PRAGMA table_info` based additive column migrations | `apps/server/src/db/schema.ts` | better-sqlite3 |
| Prepared query layer | Parameterized upserts; sort column allowlist map; filter builder | `apps/server/src/db/queries.ts` | better-sqlite3 |
| Cost engine | 10-entry per-model pricing table (4 rates each) + regex matching + fallback; per-message and per-session breakdown | `packages/cost-engine/src/pricing.ts`, `calculator.ts` | — |
| Insights engine | 10 pure rules, `(session, allSessions) => Insight \| null`, sorted critical→warning→info | `packages/insights-engine/src/engine.ts`, `rules/*.ts` | — |
| PII detector/redactor | 9 regex patterns; returns offsets; redacts right-to-left so indices stay valid | `apps/server/src/middleware/pii-detector.ts` | — |
| Privacy middleware | Fastify `onSend` hook; recursive JSON walk; optional path hashing (sha256, 6 hex chars) and content-length substitution | `apps/server/src/middleware/privacy.ts` | `crypto` |
| Network guard | Patches `net.Socket.prototype.connect`, allowlist `127.0.0.1/localhost/::1/0.0.0.0`, records blocked attempts | `apps/server/src/middleware/network-guard.ts` | `net` |
| CSP + headers | `default-src 'self'`, `X-Frame-Options: DENY`, `nosniff` on every request | `apps/server/src/app.ts:29-36` | Fastify |
| REST API (18 endpoints) | health, sessions list/detail/timeline, stats overview/daily/models/tools/skills/costs/cache, insights, export csv/json/anonymized, browse, agent models | `apps/server/src/routes/*.ts` | Fastify |
| Live monitor (SSE) | 1.5 s poll of all JSONL; byte-offset delta read; broadcasts `message:new`, `session:active`, `session:idle`, `stats:tick`, `todos:updated`; 30 s heartbeat; poll stops when last client leaves | `apps/server/src/routes/live.ts` | `fs`, SSE |
| TodoWrite extraction | Pulls `todos` array out of live `TodoWrite` tool calls into a task-progress stream | `apps/server/src/routes/live.ts:180-192` | — |
| Interactive agent (WS) | Claude Agent SDK `query()` driven over WebSocket: start, resume, stream input, interrupt, setModel, setPermissionMode | `apps/server/src/routes/agent.ts` | `@anthropic-ai/claude-agent-sdk`, `@fastify/websocket` |
| Tool permission gate | `canUseTool` → `permission:request` to browser → modal → `allow`/`deny` resolves the SDK promise | `apps/server/src/routes/agent.ts:430-471` | Agent SDK |
| Tool risk classification | 3-tier: read-only→low, Edit/Write/NotebookEdit→medium, everything else→high | `apps/server/src/routes/agent.ts:39-45` | — |
| Directory browser | `/api/browse` — lists subdirectories, refuses outside `$HOME` (and `/tmp`) | `apps/server/src/routes/browse.ts` | `fs/promises` |
| Timeline builder | Gantt events in 3 lanes (user/assistant/tools); duration inferred from next record's timestamp | `packages/session-parser/src/timeline-builder.ts` | — |
| Export | CSV (RFC-style quoting), JSON, and anonymized JSON (drops paths, prompts, branches) | `apps/server/src/routes/export.ts` | — |
| Cache efficiency analytics | Hit rate overall/by-day/by-model; savings estimated as `cache_read × avg_cost_per_token × 0.9` | `apps/server/src/routes/stats.ts` (`/api/stats/cache`) | — |
| Vue SPA — 10 pages | Dashboard, Sessions, SessionDetail, TimelineFull, Live, Agent, Costs, Tools, Insights, Settings | `apps/web/src/pages/*.vue` | Vue 3, Pinia, Vue Router |
| Charts | ECharts: stacked bar, line+area, donut, heatmap, stacked area, custom Gantt, waterfall | `apps/web/src/components/charts/`, `costs/`, `timeline/` | ECharts, vue-echarts |
| Virtualized table | TanStack Vue Table + Vue Virtual; column visibility persisted to `localStorage` (`csi-column-visibility`) | `apps/web/src/components/sessions/SessionTable.vue` | TanStack |
| Theming | 3 themes (dark/light/high-contrast) via `data-theme` on `<html>`; SCSS custom-property tokens | `apps/web/src/assets/styles/_tokens.scss` | SCSS |
| CLI | Commander; validates dir; runs index; resolves static dist; starts server; prints banner; opens browser | `packages/cli/src/index.ts`, `banner.ts` | Commander, `open` |
| Tests | 85 cases across 11 files (Vitest) — heaviest on PII (14) and insight rules (20) | `**/__tests__/*.test.ts`, `tests/e2e/smoke.test.ts` | Vitest |

---

## UX and interaction design

`docs/application-overview.md` (594 lines) is an unusually complete UX spec — ASCII wireframes per page, per-component behavior tables, and the full design-token table. It is the single most valuable file in the repo for our purposes, independent of the code.

**Shell.** Fixed sidebar (240 px expanded / 56 px collapsed, persisted to `localStorage`) + a persistent 4-card KPI bar (Sessions, Total Cost, Total Tokens, Avg Cost/Session) plus a 5th live-status card with a pulsing dot. Each KPI card carries a 3 px colored top accent. Content scrolls under a fixed chrome.

**Patterns worth noting:**

- **Skeleton shimmer** on every data page, not spinners.
- **Error cards with a retry button** wired to the store's `fetch()` — errors are recoverable in-place.
- **Auto-scroll with user override.** Both the live feed and the agent chat auto-scroll to bottom but *pause when the user scrolls up*, surfacing a "Resume" / "Jump to latest" button. The live feed caps at 200 messages.
- **Info tooltips on every cost and cache metric** (`InfoTooltip.vue`, `@floating-ui/vue`). The README calls this out as a feature, and it is a genuine answer to "what does this number mean".
- **Progressive disclosure.** Messages truncate with click-to-expand; insights group by rule with a collapsible session table ("Show all 5 sessions"); tool cards collapse JSON input/output (capped at 2000 chars / 200 px).
- **Risk-colored approval modal.** Full-screen backdrop, risk badge (green/orange/red), tool name, JSON params in a code block, Deny/Allow, Escape to close.
- **Streaming cursor.** A blinking purple `│` during agent generation, driven by `assistant:partial` stream events.
- **Timeline interaction.** Gantt with 3 swim lanes, zoom in/out/reset buttons plus an ECharts DataZoom drag slider, click-for-tooltip, and a "full-screen" route (`/sessions/:id/timeline`).
- **Deterministic accent colors** for skill chips, hashed from the skill name — stable colors across reloads without a palette config.

**Weak spots.** Navigation is a flat 8-item list with no search or command palette. There is no cross-linking from an insight to the underlying *messages* (only to the session). Settings is three controls. No keyboard shortcuts are documented. The theme table includes a high-contrast mode, but no accessibility audit is claimed beyond that.

---

## Architecture

### Data sources

1. `~/.claude/projects/**/*.jsonl` — the only real source. Hard-coded in `scanner.ts:13-15` and again in `live.ts:50, 253, 298`.
2. `~/.cache/claude-code-dashboard/index.db` — derived SQLite index (`db/connection.ts:13`).
3. `$ANTHROPIC_API_KEY` — read only by the Agent SDK, never by CSI code.
4. Arbitrary directories under `$HOME` via `/api/browse`, for the agent's project picker.

> **Doc/code mismatch:** README and SECURITY.md both say the DB lives at `~/.cache/claude-code-insights/index.db`. The code writes `~/.cache/claude-code-dashboard/index.db`. The code wins.

### Ingestion pipeline

Startup-only. `runFullIndex` is called from `main.ts:12` and `cli/src/index.ts:47` and nowhere else. There is no watcher, no re-index endpoint, and no periodic refresh — the analytics half of the app is a snapshot taken at process start. (The live-monitor half is separate and does poll.)

The change-detection strategy:

```
scanClaudeSessions()                     → [{path, mtime, sessionId}]
  for each file:
    getFileMtime(file.path)              → SELECT file_mtime FROM sessions WHERE file_path = ?
    if stored === current  → skip
    else                   → enqueue
  batch enqueued files in groups of 4 (MAX_CONCURRENT_WORKERS)
    parse each (Promise.allSettled — one bad file cannot kill the batch)
    db.transaction(insert whole batch)
```

Note `parseWorkerDirect` — the indexer parses **in-process**, not in worker threads, with an explicit comment: `// Direct in-process parsing (no worker threads) — simpler and works with tsx`. `apps/server/src/workers/parse-worker.ts` still exists but is dead code apart from its exported types.

### SQLite schema (reproduced verbatim from `apps/server/src/db/schema.ts`)

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  project_path    TEXT,
  git_branch      TEXT,
  first_prompt    TEXT,
  message_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT,
  modified_at     TEXT,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  file_path       TEXT NOT NULL,
  file_mtime      INTEGER NOT NULL DEFAULT 0,
  cli_version     TEXT,
  permission_mode TEXT,
  slug            TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type                  TEXT NOT NULL,
  timestamp             TEXT NOT NULL,
  parent_uuid           TEXT,
  model                 TEXT,
  tool_name             TEXT,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd              REAL    NOT NULL DEFAULT 0,
  is_error              INTEGER NOT NULL DEFAULT 0,
  content_preview       TEXT
);

CREATE TABLE IF NOT EXISTS session_stats (
  session_id                  TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  total_input_tokens          INTEGER NOT NULL DEFAULT 0,
  total_output_tokens         INTEGER NOT NULL DEFAULT 0,
  total_cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  total_cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_hit_rate              REAL    NOT NULL DEFAULT 0,
  total_cost_usd              REAL    NOT NULL DEFAULT 0,
  tool_call_count             INTEGER NOT NULL DEFAULT 0,
  error_count                 INTEGER NOT NULL DEFAULT 0,
  models_used                 TEXT    NOT NULL DEFAULT '[]',   -- JSON array
  unique_tools                TEXT    NOT NULL DEFAULT '[]',   -- JSON array
  compaction_count            INTEGER NOT NULL DEFAULT 0,
  files_modified_count        INTEGER NOT NULL DEFAULT 0,
  skills_used                 TEXT    NOT NULL DEFAULT '[]',   -- JSON array
  thinking_block_count        INTEGER NOT NULL DEFAULT 0,
  image_count                 INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_created_at   ON sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_project_path ON sessions(project_path);
CREATE INDEX IF NOT EXISTS idx_messages_session_id   ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp    ON messages(timestamp);
```

**Migration strategy** (`schema.ts:72-93`): no version table, no migration files. A helper reads `PRAGMA table_info(<table>)` and issues `ALTER TABLE ... ADD COLUMN` for any column not present. Additive only — it cannot drop, rename, or backfill. Adequate for an append-only derived cache where the documented reset is `rm ~/.cache/.../index.db`; not adequate for anything with user-authored state.

**Schema observations for our port:**
- `file_path` is *not* indexed and *not* unique, yet `getFileMtime` looks up by it on every scanned file — an O(n) table scan per file per startup.
- `sessions.id` is the JSONL basename, so two files with the same basename in different project dirs collide on the primary key.
- `messages.id` for tool_use rows is the block ID; for others it's `uuid`, falling back to `${sessionId}-${index}`. Mixed identity domains in one PK.
- No `FOREIGN KEY` index on `messages.session_id`… actually there is (`idx_messages_session_id`), but there is no index supporting the `tool_name LIKE 'Skill(%'` queries in `/api/stats/skills`.

### Transport

| Channel | Path | Used for |
|---|---|---|
| REST (JSON) | `/api/*` — 18 endpoints | all analytics reads |
| SSE | `GET /api/live` | live monitor; server polls FS at 1.5 s and pushes deltas |
| WebSocket | `GET /api/agent/ws` | bidirectional agent control (needs client→server, so SSE won't do) |

The WebSocket route is registered inside a nested Fastify plugin scope, with a comment explaining that `@fastify/websocket`'s `onRoute` hook must be active when the route is defined (`app.ts:59-65`) — a real footgun, worth remembering if we ever adopt Fastify.

### Frontend state

Pinia, 10 stores, one per domain (`agent`, `cache`, `costs`, `detail`, `insights`, `live`, `overview`, `sessions`, `settings`, `tools`). Composables wrap the transports: `useApi`, `useSSE`, `useAgentSocket`, `useEChart`, `useMarkdown`. `useAgentSocket` is a clean pattern — it owns the socket lifecycle and a 30 s ping heartbeat, and its `dispatch()` is a pure switch that fans server messages out to typed store handlers.

### Tooling

pnpm workspaces (`apps/*`, `packages/*`, `tests`), TypeScript project references off `tsconfig.base.json`, Vite for web, `tsup` to bundle the CLI, Vitest everywhere, ESLint 10. `scripts/build.sh` builds the SPA and copies `dist/` next to the CLI bundle so `npx` serves a single artifact. Zod schemas in `shared-types` are the declared single source of truth for record shapes.

### Data flow

```
   ~/.claude/projects/**/*.jsonl        $ANTHROPIC_API_KEY
              │                                  │
              │ (A) startup, once                │ (read only by SDK)
              ▼                                  │
   ┌──────────────────────┐                      │
   │ scanner.ts           │  walk, depth<=10     │
   │  → {path,mtime,id}   │  size 0<n<500MB      │
   └──────────┬───────────┘  refuse outside $HOME│
              ▼                                  │
   ┌──────────────────────┐                      │
   │ indexer.ts           │                      │
   │  mtime == stored? ───┼──yes──► SKIP         │
   │        │ no          │                      │
   │        ▼             │                      │
   │  jsonl-reader (Zod)  │                      │
   │  session-builder     │                      │
   │  cost-engine         │                      │
   │  redactPII(preview) ◄┼── pii-detector       │
   │  batch(4) → txn      │                      │
   └──────────┬───────────┘                      │
              ▼                                  │
   ┌──────────────────────────────┐              │
   │ SQLite  ~/.cache/claude-code- │             │
   │         dashboard/index.db    │             │
   │  sessions │ messages │ stats  │             │
   │  WAL, synchronous=NORMAL      │             │
   └──────────┬───────────────────┘              │
              │                                  │
              │ prepared stmts                   │
              ▼                                  ▼
   ┌────────────────────────────────────────────────────────┐
   │ Fastify :3838  (bind 127.0.0.1)                        │
   │   onRequest ─► CSP / nosniff / DENY                     │
   │   onSend    ─► privacy.ts ─► redactPII(whole body)      │
   │                                                         │
   │   REST /api/*      SSE /api/live      WS /api/agent/ws  │
   │        │                │                    │          │
   │        │        (B) poll 1.5s          Agent SDK query()│
   │        │        byte-offset tail       canUseTool ──┐   │
   │        │        of *.jsonl                          │   │
   └────────┼────────────────┼──────────────────────────┼───┘
            │                │                          │
            │   ┌────────────────────────────────┐      │
            │   │ network-guard (net.Socket      │      │
            │   │ .prototype.connect patched     │      │
            │   │ BEFORE all other imports)      │      │
            │   └────────────────────────────────┘      │
            ▼                ▼                          ▼
   ┌────────────────────────────────────────────────────────┐
   │ Vue 3 SPA — Pinia (10 stores) · ECharts · TanStack      │
   │   fetch()          EventSource        WebSocket         │
   │                                       └─► approval modal│
   └────────────────────────────────────────────────────────┘

   (A) analytics path: snapshot at startup ONLY — no watcher, no re-index route
   (B) live path: independent poll loop, starts on first SSE client, stops on last
```

---

## Notable code worth stealing

Difficulty is rated for our target: **React 18 + Vite, Express, plain ESM, no TypeScript.**

| File | What it does | Why it's good | Port difficulty |
|---|---|---|---|
| `apps/server/src/middleware/pii-detector.ts` | 9 regex patterns → `{found, matches[]}`; `redactPII` replaces right-to-left so earlier match offsets stay valid | Zero dependencies, pure, ~60 lines, 14 tests. The right-to-left replacement is the non-obvious correctness detail most implementations get wrong | **Easy** — strip 3 interfaces, done |
| `packages/cost-engine/src/pricing.ts` + `calculator.ts` | Per-model table with 4 independent rates; regex model matching (`/^claude-opus-4[.-]6/` tolerates both `.` and `-`); explicit `FALLBACK_PRICING` | Directly replaces our ratio heuristic. Our `PRICE_PER_M` charges Opus at $15/M input; their table prices Opus 4.5/4.6 at **$5/M** — we are overstating recent Opus cost by 3x | **Easy** — data + 3 pure functions |
| `apps/server/src/services/indexer.ts:96-156` | mtime-diff filter → batch(4) → `Promise.allSettled` → single transaction per batch | The whole incremental strategy in ~60 lines. `allSettled` means one corrupt JSONL cannot abort the run; per-batch transactions bound the blast radius | **Medium** — the pattern is easy; the SQLite half is the work |
| `apps/server/src/db/schema.ts:72-93` | `PRAGMA table_info` → `ALTER TABLE ADD COLUMN` for missing columns | A migration system in 20 lines with no migration files, correct for additive-only derived caches | **Easy** |
| `apps/server/src/routes/live.ts:68-96` (`readNewLines`) | Stores a byte offset per file; `openSync`/`readSync` only the delta; on first sight records current size so history isn't replayed | Correct file-tailing. The "first sight → record size, don't replay" rule is exactly right for a live feed | **Easy** — plain `fs`, no deps |
| `packages/insights-engine/` | `type Rule = (input: {session, allSessions}) => Insight \| null`; `ALL_RULES` array; engine just maps and sorts | Adding a rule = one file + one array entry. Rules are pure and individually testable (20 tests) | **Easy** — drop the types, keep the shape |
| `apps/server/src/services/indexer.ts:223-237` | Rewrites `Skill` → `Skill(<name>)`, `Task` → `Task(<subagent>)` at index time | Pushes the join into the write path so read queries stay a trivial `LIKE`. Cheap trick, big payoff for skill/subagent analytics | **Easy** |
| `apps/server/src/middleware/network-guard.ts` | Patches `net.Socket.prototype.connect`, allowlists 4 local hosts, logs + destroys others, keeps an audit array | ~50 lines that turn "we don't phone home" from a claim into an enforced invariant. Handles both `connect(opts)` and `connect(port, host)` signatures | **Easy** — but see the caveat in Gaps |
| `apps/server/src/middleware/privacy.ts` | Fastify `onSend` hook, recursive JSON walk, key-aware handling (`isPathKey`/`isContentKey`), sha256-6 path hashing | Response-level redaction as a single hook means no route can forget it. Express equivalent is an `res.json` wrapper | **Medium** — Express has no `onSend`; wrap `res.json` |
| `apps/server/src/routes/agent.ts:430-471` | `canUseTool` sends `permission:request` and returns a Promise resolved by the browser's `allow`/`deny` | The cleanest expression of human-in-the-loop tool approval: a Promise that a UI click resolves | **Medium** |
| `apps/server/src/routes/agent.ts:60-82` | `createUserMessageStream` — async generator that yields the first prompt then awaits queued WS messages | The idiomatic way to feed the Agent SDK a live, user-driven input stream instead of a fixed prompt | **Medium** — generator logic is subtle; note the `null`-resolve shutdown path |
| `apps/web/src/composables/useAgentSocket.ts` | Socket lifecycle + 30 s ping + pure `dispatch()` switch fanning to store handlers | Maps 1:1 to a React hook. The message-type switch is a clean protocol boundary | **Medium** — Vue composable → React hook + reducer |
| `packages/shared-types/src/session.ts` | Zod discriminated union over 8 JSONL record types, with a deliberately permissive user-content shape | Best single artifact documenting the real Claude Code JSONL format, including `file-history-snapshot` and `queue-operation` | **Easy as documentation**, Medium as code (we have no Zod) |
| `packages/session-parser/src/jsonl-reader.ts` | Streaming, BOM strip, 10 MB line cap, `safeParse`, counts skips | Never throws on a malformed transcript; returns `skippedLines` so the UI can be honest about it — fits our "honesty rules" | **Easy** |
| `apps/server/src/routes/export.ts` | CSV with correct quote-escaping, plus an anonymized JSON export that drops paths/prompts/branches | The anonymized export is the right primitive for "share my usage stats without leaking my repo" | **Easy** |
| `docs/application-overview.md` | 594-line UX spec: ASCII wireframes, component behavior tables, full token table | Not code, but the highest-value file here. Reusable as a design checklist | **Easy** (reference) |

---

## Gaps and weaknesses

**Functional bugs**

1. **`--dir` and `--port` are dead flags.** `packages/cli/src/index.ts:36-37` sets `process.env.CSI_SCAN_DIR` and `CSI_PORT`. Nothing reads them — a repo-wide grep for both names returns only the assignment site and `.env.example`. `scanner.ts:13-15` hard-codes `~/.claude/projects`. The port *does* work, but only because the CLI passes `port` directly to `app.listen`, not via the env var. The README's troubleshooting table advises `--dir` for custom locations; it has no effect.
2. **`--dir` also can't work by design.** The CLI defaults `--dir` to `~/.claude` and validates *that*, while the scanner reads `~/.claude/projects`. Two different paths.
3. **No orphan cleanup.** There is no `DELETE FROM sessions` anywhere. Delete a project's transcripts and their sessions, messages, and stats stay in the index forever, inflating every aggregate.
4. **`getFileMtime` is an unindexed lookup.** `SELECT file_mtime FROM sessions WHERE file_path = ?` with no index on `file_path`, executed once per scanned file at every startup — O(files × rows).
5. **Session ID collisions.** `sessionId` is the JSONL basename and is the primary key. Same basename under two project directories = silent overwrite.
6. **Two different cost models in one codebase.** `cost-engine` has the accurate per-model table, but `routes/live.ts:98-104` and `routes/agent.ts:86-92` each carry a private `estimateCost` hard-coding 3/15, opus 15/75, haiku 0.8/4. Live and agent costs therefore disagree with indexed costs, and both are wrong for Opus 4.5/4.6 (table says 5/25).
7. **Dead code.** `apps/server/src/workers/parse-worker.ts` is superseded by in-process parsing. `chokidar` is declared as a dependency in both `apps/server/package.json` and `packages/cli/package.json` and is never imported.
8. **`apps/server/src/main.ts` hard-codes port 3838** and ignores `CSI_PORT`, so the non-CLI dev entrypoint can't be moved.

**Architectural limits**

9. **Analytics are a startup snapshot.** No watcher, no re-index endpoint, no polling on the analytics path. Work done after launch is invisible until restart. Given the app also runs an agent that *creates* sessions, this is a real hole.
10. **Full re-parse per changed file.** Any append to a JSONL re-reads the whole file and deletes+reinserts all its message rows. For a long-running session appended to continuously, cost grows with total file size, not delta size — the live path solved this with byte offsets, the index path didn't.
11. **Live monitor re-walks the entire tree every 1.5 s.** `findJsonlFiles` recurses `~/.claude/projects` on every tick.
12. **PII redaction runs on every API response body.** The `onSend` hook JSON-parses, deep-walks, and re-stringifies every payload, running 9 regexes over every string. On large session-detail responses this is the hot path.

**Security caveats (relevant because privacy is the pitch)**

13. **"Zero outbound connections" vs. the Agent.** These cannot both hold. The socket patch protects the dashboard process; the Agent SDK's traffic to `api.anthropic.com` must originate somewhere the patch doesn't reach (a spawned CLI subprocess). SECURITY.md asserts "The network guard remains active during agent execution" — true of the parent process, but it is not what a reader will infer. *(Subprocess mechanism unverified in this checkout.)*
14. **The guard is bypassable in-process.** A monkey-patch on `net.Socket.prototype.connect` doesn't cover `dns`, raw `http2`, `dgram`/UDP, native addons, or any module that captured a reference to `connect` before the patch. It raises the bar; it is not a sandbox.
15. **`/api/browse` allows `/tmp`.** `browse.ts:19` permits `$HOME` *or* `/tmp` despite the error message saying "Access restricted to home directory". Minor, but it contradicts the stated invariant.
16. **PII regexes will over-redact.** The `ipv4` and `email` patterns run over all response strings, so code snippets, log lines, and version strings containing dotted quads get mangled into `[REDACTED:ipv4]`. And `api_key` (`(?:sk-|pk-|rk-|ak-)[a-zA-Z0-9]{20,}`) overlaps `openai_key` and `anthropic_key`, producing overlapping matches that the right-to-left replacement will nest.
17. **The read-only guarantee holds.** I found no write path into `~/.claude` — the only `fs` writes are `mkdirSync` for the cache dir and the SQLite file itself. This claim checks out.

**Portability**

18. **POSIX assumptions.** `isWithinHome` uses `resolved.startsWith(home)` (case-sensitive, fine on Linux/macOS, fragile on Windows where drive-letter case and `C:\Users` vs `c:\users` vary). `live.ts:51` strips a leading `/` with `.replace(/^\//, '')` to derive a project name — that produces wrong labels on Windows. No CI, no Windows testing evident.
19. **`better-sqlite3` is a native module.** The README's own troubleshooting table admits `pnpm install` fails without an `onlyBuiltDependencies` entry. This is the main friction cost of adopting SQLite.

**Project health**

20. **4 stars, 1 author, no commits in ~5 months, no CI workflows, no issues or PRs.** Zero independent reviews, writeups, or discussion found via web search. Treat it as a well-structured personal project to mine, not a dependency to track.

---

## Overlap with Loush Dashboard

| Their feature | Our equivalent section (or NONE) | Who does it better | Note |
|---|---|---|---|
| SQLite index (`index.db`) | **NONE** — we use in-memory `usageCache` Map keyed by file+mtime (`server/index.mjs:656`) + a TTL response cache (`respCache`, `index.mjs:110`) | **Them** | We already have the *mtime-diff idea*; what we lack is persistence across restarts. That's the real delta, and it's smaller than "we have no database" suggests |
| Per-model pricing table | `PRICE_PER_M` ratio heuristic (`server/index.mjs:718, 1987`) | **Them, clearly** | Ours: opus=15, haiku=0.8, else 3, with out=5x/cache-write=1.25x/cache-read=0.1x derived. Theirs: 4 independent rates per model. Ours overcharges Opus 4.5/4.6 by 3x |
| Cache efficiency analytics | `UsagePanel` + `lib/harness-usage-trends.mjs` (`rollingCacheEfficiency`, `cacheWasteCost`, `buildDailyCacheMap`) | **Us** | We have rolling efficiency, TTL waste costing, anomaly detection, and month-end projection. They have hit rate by day/model and a flat 0.9 savings estimate. Interestingly we both use the same `×0.9` savings assumption |
| Session browser table | `SessionsSection` | **Them (UX), tie (data)** | They have TanStack virtual scrolling, 12 toggleable columns persisted to localStorage, and 7 filter dimensions |
| Session detail / messages | `SessionsSection`, `ForensicsSection`, `ContextExplorerSection` | **Us** | We join transcripts to repos on disk; they only show the transcript |
| Gantt timeline (swim lanes, zoom, minimap) | `ActivityTimeline`, `FlowSection`, `PlanGraph` | **Roughly tie** | Theirs is a single polished ECharts Gantt; ours is more varied (d3) but not lane-based-with-zoom |
| Live monitor (SSE, byte-offset tail) | `ChatSection` has SSE; `RunsSection`, `Overview` show activity | **Them, for the tail** | We spawn+stream our own chats; they tail *any* session started elsewhere. The `readNewLines` byte-offset pattern is the piece we're missing |
| TodoWrite → live task progress | **NONE** | **Them** | Extracting the live todo list from `TodoWrite` tool calls is a nice, cheap signal |
| Interactive agent (run Claude from dashboard) | `ChatSection` (spawns child process, SSE, `chats` Map at `server/index.mjs:866`) | **Tie** | We already run Claude from the dashboard. Different transport (our SSE + child process vs their WS + Agent SDK) |
| Tool permission approval modal + risk tiers | **NONE** | **Them** | This is the single most valuable agent-side idea to take |
| Insights rules engine | `InsightsSection`, `QualitySection`, `ReliabilitySection` | **Us on depth, them on structure** | Their 10 rules are shallow; their `Rule = (input) => Insight \| null` + `ALL_RULES` registry shape is cleaner than ad-hoc analysis |
| PII detection / redaction | **NONE** | **Them** | We have no redaction anywhere. Straight gap |
| Network guard (socket patch) | **NONE** | **Them** | We claim zero telemetry; they *enforce* it. Cheap credibility win for our thesis |
| CSP / security headers | **Unverified** — no CSP found in `server/index.mjs` | **Them** | ~6 lines |
| Anonymized export | **NONE** (we have no export path found) | **Them** | Enables sharing stats without leaking repo names |
| Skill / subagent usage analytics | `CapabilityLedger`, `LibrarySection`, `HarnessSection` | **Us** | We track skills/agents/plugins/hooks from config *and* usage; they infer only from tool-call names |
| Tool frequency + error rates | `HarnessSection`, `ReliabilitySection` | **Tie** | |
| Cost forecast (30-day linear) | `UsagePanel` (`projectMonthEnd` in `lib/harness-usage-trends.mjs`) | **Tie** | Both linear projections |
| Themes (dark/light/high-contrast) | `CustomizeSection` | **Unverified** — need to check if we ship high-contrast | Their 3-theme token table is directly liftable |
| Info tooltips on every metric | **NONE / partial** | **Them** | Strong fit with our honesty rules — explain the number, don't just show it |
| Zod record schemas for JSONL | **NONE** (we parse ad-hoc) | **Them, as documentation** | We won't add Zod, but their union is the best available spec of the JSONL format |
| Directory picker (`/api/browse`) | `TicketSection` has project-folder picking; `ProjectsSection`, `ProjectHub` | **Us** | |
| Repo/git joining, working set, tickets, MCP, hooks, governance, board, bugs, prompt studio | **NONE on their side** | **Us, by a mile** | ~20 of our 35 sections have no upstream counterpart. Their scope is "usage analytics"; ours is "your whole harness" |
| "null is never rendered as 0" honesty rule | Their `COALESCE(..., 0)` everywhere in `queries.ts` | **Us** | Their SQL actively converts missing data to 0 — the exact thing our honesty rules forbid. **Do not port their query layer's COALESCE habit** |

---

## Recommended adoptions

Ranked by (value ÷ effort). Effort: **S** ≤ half a day, **M** 1–3 days, **L** ≥ 1 week.

### 1. PII redaction utility — **S**
**Take:** `apps/server/src/middleware/pii-detector.ts` verbatim, minus types.
**Lands in:** new `lib/pii.mjs`; call from `server/index.mjs` wherever transcript content reaches a response — the usage/session/forensics readers and the `ChatSection` SSE stream.
**Unlocks:** we can honestly say the dashboard won't splash an API key across the screen during a screen-share or demo. Also a prerequisite for any export or artifact feature. Keep the right-to-left replacement; fix their over-broad `ipv4`/`email` patterns by making those two opt-in.

### 2. Per-model pricing table — **S**
**Take:** `packages/cost-engine/src/pricing.ts` + `calculator.ts`.
**Lands in:** new `lib/pricing.mjs`; replace `PRICE_PER_M` and `entryCost` in `server/index.mjs:718, 1987`; consumed by `UsagePanel`, `ResourceSection`, `Overview`.
**Unlocks:** correct costs. Our current numbers overstate Opus 4.5/4.6 by ~3x, which silently poisons every cost chart, the cache-savings math in `lib/harness-usage-trends.mjs`, and any budget claim we make. Add our own `fable` entry — their table has no row for it, and our regex already special-cases it.

### 3. Network guard — **S**
**Take:** `apps/server/src/middleware/network-guard.ts`.
**Lands in:** new `lib/network-guard.mjs`, imported as the *first* statement of `server/index.mjs`.
**Unlocks:** turns "local-first, zero telemetry" from a README claim into an enforced invariant, and gives us an audit list of blocked attempts to surface in `GovernanceSection`. **Caveat:** we spawn Claude as a child process for `ChatSection`/`TicketSection`, and children are unaffected — so document the guarantee precisely as "this process makes no outbound connections" and do not repeat their overreach.

### 4. Byte-offset file tailing — **S**
**Take:** `readNewLines` + the `fileOffsets` map from `apps/server/src/routes/live.ts:68-96`, including the "first sight → record size, don't replay history" rule.
**Lands in:** `server/index.mjs` alongside the existing SSE plumbing; feeds `ActivityTimeline`, `RunsSection`, `Overview` live indicators.
**Unlocks:** watching sessions started in *other* terminals, not just ones we spawned. Today we only stream our own children. Keep our existing FS walk cadence rather than their 1.5 s full re-walk.

### 5. Persistent parse cache (the SQLite idea, adapted) — **M**
**Take:** the strategy from `services/indexer.ts:96-156` (mtime-diff → batch → `allSettled` → one transaction) and the schema shape from `db/schema.ts`.
**Lands in:** new `server/index-store.mjs`; `server/index.mjs` swaps `usageCache` reads for it. `UsagePanel`, `Overview`, `SessionsSection`, `InsightsSection` benefit immediately.
**Unlocks:** cold start stops being O(all transcripts). We already do mtime-keyed memoization in-memory — this makes it survive restarts.
**Recommendation on the storage engine:** do **not** reach for `better-sqlite3` first. It's a native build, and the README itself documents install failures. Two lighter options: (a) a JSON/NDJSON sidecar cache under `~/.cache/loush-dashboard/` keyed by `path → {mtime, size, summary}` — this captures ~80% of the win at ~10% of the cost and keeps our zero-native-deps property; (b) `node:sqlite`, built into Node 22+, if we're willing to set a floor. Note we already shell out to a `sqlite3` binary in `server/promptcheck.mjs:87`, so a hard dependency is not unprecedented — but that's read-only against someone else's DB, which is a much weaker commitment.
**Port the schema, not the queries:** their `COALESCE(x, 0)` idiom converts "we don't know" into "zero", which is precisely what our honesty rules forbid. Keep the columns, return `null`.

### 6. Tool permission approval + risk tiers — **M**
**Take:** `classifyToolRisk` (`routes/agent.ts:39-45`) and the `canUseTool`→WS→modal→Promise-resolve loop (`routes/agent.ts:430-471`), plus the `AgentApprovalModal` interaction spec from `docs/application-overview.md`.
**Lands in:** `src/sections/ChatSection.jsx` + the `chats` machinery in `server/index.mjs:866`; also relevant to `TicketSection` and `QuickActions`.
**Unlocks:** we can run agents from the dashboard in default permission mode instead of pre-accepting edits, with a human gate on high-risk tools. This is the highest-value *behavioral* idea in the repo. Note our transport is SSE + child process, not WS + SDK — the approval round-trip needs a client→server channel, so this likely means adding a small POST endpoint rather than adopting WebSockets wholesale.

### 7. Insight rule registry shape — **M**
**Take:** the `Rule = ({session, allSessions}) => Insight | null` contract, the `ALL_RULES` array, and the severity-ordered engine (`packages/insights-engine/`). Take the *shape*, not their 10 rules — ours are deeper.
**Lands in:** `src/sections/InsightsSection.jsx` + a new `lib/insight-rules/` directory; also feeds `QualitySection`, `ReliabilitySection`, `Bugs`.
**Unlocks:** adding a finding becomes one small pure file plus one array entry, each independently testable with `node --test`. Their `InsightGroupCard` (group by rule, collapsible affected-session table, "Show all N") is the right UI for it.

### 8. Info tooltips on every metric — **M**
**Take:** the `InfoTooltip` pattern and the discipline behind it (every cost and cache metric explains itself).
**Lands in:** a shared `src/components/InfoTooltip.jsx`, applied across `UsagePanel`, `Overview`, `ResourceSection`, `TeamBaseline`.
**Unlocks:** direct expression of our honesty thesis — a number the user can't interpret is barely better than a null. Pairs naturally with our "null is never 0" rule: the tooltip is where "not measured" gets explained.

### 9. Anonymized export — **S**
**Take:** `apps/server/src/routes/export.ts`, especially `/api/export/anonymized` (drops project paths, prompts, branch names) and the CSV quote-escaping.
**Lands in:** new `server/export.mjs`; surfaced from `UsagePanel` and `TeamBaseline`.
**Unlocks:** sharing usage stats with a team or in a writeup without leaking repo names or prompts. Combine with #1 so the non-anonymized exports are redacted too.

### 10. JSONL record schema as documentation — **S**
**Take:** `packages/shared-types/src/session.ts` — as a reference document, not as code.
**Lands in:** `docs/` as a note on the real JSONL format; informs the parsers in `server/index.mjs` and `server/memory.mjs`.
**Unlocks:** they handle record types we may be dropping on the floor — `file-history-snapshot` (which is how they count files modified), `queue-operation`, `progress`, and `system` with `subtype: 'compact_boundary'` (how they count compactions). Those two derived metrics — files-modified and compaction-count — are cheap additions to `WorkingSet` and `ForensicsSection`.

### 11. Tool-name enrichment at write time — **S**
**Take:** `indexer.ts:223-237` — rewrite `Skill` → `Skill(<name>)`, `Task` → `Task(<subagent_type>)` during parse.
**Lands in:** wherever we fold transcripts in `server/index.mjs`; benefits `CapabilityLedger` and `HarnessSection`.
**Unlocks:** skill and subagent usage becomes a trivial prefix match instead of a nested lookup into tool inputs. Small, but it's the kind of thing that makes three downstream features easy.

### Explicitly do not adopt

- **Their 10 insight rules** — shallow and partly tautological; ours are better.
- **`COALESCE(..., 0)` in the query layer** — violates our honesty rules.
- **The dual `estimateCost` helpers** in `live.ts`/`agent.ts` — the bug we'd be importing.
- **Vue/Pinia/ECharts/Fastify/TanStack** — wrong stack; we have React/d3/Express and no reason to churn.
- **"Zero outbound connections" as marketing copy** — we'd inherit a claim we can't defend while spawning Claude.

---

## Sources

**Primary (fetched / cloned 2026-07-29):**
- Repo landing page — https://github.com/yahav10/claude-code-dashboard
- GitHub API metadata — https://api.github.com/repos/yahav10/claude-code-dashboard
- Full file tree — https://api.github.com/repos/yahav10/claude-code-dashboard/git/trees/main?recursive=1
- README — https://raw.githubusercontent.com/yahav10/claude-code-dashboard/main/README.md
- Full source, cloned and unshallowed at commit `6cb3691`; all file paths and line numbers cited above were read directly from that checkout.
- npm registry metadata — https://registry.npmjs.org/claude-code-insights

**Key files read in full:** `apps/server/src/{main,app}.ts`; `apps/server/src/db/{schema,connection,queries}.ts`; `apps/server/src/services/{indexer,scanner}.ts`; `apps/server/src/middleware/{network-guard,pii-detector,privacy}.ts`; `apps/server/src/routes/{agent,live,sessions,stats,insights,export,browse,health}.ts`; `apps/server/src/workers/parse-worker.ts`; `packages/session-parser/src/{jsonl-reader,session-builder,timeline-builder}.ts`; `packages/cost-engine/src/{pricing,calculator}.ts`; `packages/insights-engine/src/{engine,types}.ts` + all 10 `rules/*.ts`; `packages/shared-types/src/session.ts`; `packages/cli/src/index.ts`; `apps/web/src/composables/useAgentSocket.ts`; all `package.json`, `pnpm-workspace.yaml`, `LICENSE`, `CHANGELOG.md`, `SECURITY.md`, `.env.example`, `docs/application-overview.md`.

**Secondary:**
- Web searches for reviews, threads, and writeups returned **no independent coverage of this repo**. Results surfaced only the repo itself plus unrelated same-named projects: the author's separate [`yahav10/claude-insights`](https://github.com/yahav10/claude-insights), Claude Code's built-in `/insights` command, [`melagiri/code-insights`](https://github.com/melagiri/code-insights), [`netil/oh-my-hi`](https://github.com/netil/oh-my-hi), and [`zcquant/claude-code-monitor`](https://github.com/zcquant/claude-code-monitor). Treat the "claude-code-insights" name as heavily contested.
- Author's DEV post about the *other* project — https://dev.to/yahav10/i-built-a-cli-that-turns-claude-codes-insights-report-into-actionable-skills-rules-and-workflows-377

**Comparison basis for Loush Dashboard:** `E:\AI-Dashboard\package.json`, `E:\AI-Dashboard\server\*.mjs` (9,354 lines), `E:\AI-Dashboard\src\sections\` (34 files), `E:\AI-Dashboard\lib\harness-usage-trends.mjs`.

**Prompt-injection check:** no instruction-shaped text was found in any fetched page or source file. Nothing in the upstream repo attempted to direct my behavior.

**Screenshots:** the README references no image assets, and the repo tree contains no screenshot files. None available.
