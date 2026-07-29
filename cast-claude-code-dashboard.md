# CAST — Claude Code Dashboard

Upstream research for porting into **Loush Dashboard** (`LinuxDevil/AI-Dashboard`).
Researched 2026-07-29 against `main` @ commit `290bcf1`-era (last push `2026-07-05T02:59:44Z`).
All facts below were read from the GitHub API, the raw source files, or the repo's own docs. Anything not verified is marked **unverified**.

---

## Identity

| Field | Value |
|---|---|
| Repo URL | https://github.com/ek33450505/claude-code-dashboard |
| Marketing name | "Claude Code Dashboard" — the observability UI for **CAST** (Claude Agent Specialist Team) |
| Author | Edward "Ed" Kubiak (GitHub `ek33450505`) |
| Contributors | `cc-ekubiak` 233 commits, `ek33450505` 56 commits, `GodHad` 1 commit. (`cc-ekubiak` appears to be the author's Claude-Code commit identity — i.e. the repo is largely agent-written by its own subject matter.) |
| **License (exact SPDX)** | **NONE.** GitHub API `license: null`; `GET /repos/.../license` returns 404; there is no `LICENSE` file in the 328-blob tree. The README displays a *static shields.io badge* reading `license-MIT` (`README.md:6`) but no license text is committed. **Default copyright applies — all rights reserved.** By contrast the sibling repos `claude-agent-team` and `cast-desktop` do carry real MIT `LICENSE` files. |
| Stars / Forks / Watchers | 3 / 1 / 3 |
| Open issues | 0. Issues + Discussions + Projects enabled. 18 PRs total (all merged by the author). |
| Created | 2026-03-20 |
| Last commit | 2026-07-05 ("Comment out banner image in README") |
| Releases | 9 tags, `v2.0.0` (2026-04-11) → `v2.7.0` (2026-07-05) |
| Version drift | `package.json` says `2.7.0`; the README badge still says `2.6.0` |
| Activity level | **Intense but finished.** Commit histogram over the last 100 commits: Apr 42, May 29, Jun 21, Jul 8. Zero commits in the 3.5 weeks before this research. The author's attention has moved to `compute-atlas` (pushed 2026-07-28) and `claude-agent-team` (pushed 2026-07-23). Treat as **feature-complete/dormant**, not abandoned-broken. |
| Install method | `git clone` → `npm install` → `npm run dev`. **No npm package, no Docker image, no Homebrew tap for this repo** (the sibling packages all have taps; this one says "Clone from GitHub" in the ecosystem table). |
| Platforms | README states **macOS or Linux**, Node 18+ (badge says Node ≥20). **Windows is not supported and will break** — verified in code: `server/watchers/sse.ts:138` does `filePath.replace(PROJECTS_DIR + '/', '')` with a hardcoded forward slash, and `server/routes/hooks.ts:163` gates hook health on the POSIX executable bit `(st.mode & 0o111)`. |
| Languages (bytes) | TypeScript 1,223,551 · HTML 58,728 · Shell 16,123 · CSS 15,868 |
| Size | 328 files, 2,111 KB |

### Companion desktop app — confirmed real

`ek33450505/cast-desktop` **exists as a separate public repo**: Tauri 2, TypeScript, **MIT (real LICENSE file)**, 0 stars, last push 2026-07-03, 12+ releases (latest `v1.2.12`, 2026-06-05), installable via `brew tap ek33450505/homebrew-cast-desktop`. It is a *near-fork* of this dashboard: its `server/` directory mirrors the same files (`parsers/sessions.ts`, `parsers/memory.ts`, `routes/*`, the same `bug-fixes-2026-04-03.test.ts` / `phase975c.test.ts` test names) plus desktop-specific additions — `lsp-sidecar/` (a Bun LSP process), `server/__tests__/paneBindings.test.ts`, `projectFs.test.ts`, `git.test.ts`, and design docs (`docs/design/design-language.md`, `palette-dawn-dusk.md`). So the two products **share a backend lineage**; the web dashboard is the more actively maintained of the two.

### Wider ecosystem (context, not targets)

The author has ~25 CAST-branded repos: `claude-agent-team` (the framework, 8 stars, MIT), `cast-mcp`, `cast-ledger`, `cast-predict`, `cast-memory`, `cast-doctor`, `cast-time`, `cast-claudes_journal`, `cast-security`, `cast-hooks`, `cast-observe`, `cast-dash` (a Python TUI), plus a Homebrew tap repo per package. Star counts across the entire ecosystem are 0–8. **This is a one-person system with essentially no external adoption.**

**Distribution is Homebrew-only.** All nine candidate npm names (`cast-mcp`, `cast-ledger`, `cast-predict`, `cast-memory`, `cast-doctor`, `cast-time`, `cast-claudes_journal`, `cast-desktop`, `claude-code-dashboard`) return 404 on the npm registry; npm maintainer searches for `ek33450505` / `edkubiak` / `edwardkubiak` return zero packages.

### Public reception — effectively none

| Channel | Finding |
|---|---|
| Hacker News | **No results.** Algolia searches for `claude-agent-team` and `claude-code-dashboard` surface nothing referencing this author or CAST. The HN hits under that name belong to an unrelated project (`Stargx/claude-code-dashboard`). |
| Reddit (r/ClaudeAI, r/ClaudeCode) | No threads found via search index. *(Direct reddit.com fetch was blocked in the research environment — read as "not found", not "provably absent".)* |
| X / Twitter | No threads found. The GitHub profile sets no `twitter_username`. |
| dev.to | **Seven self-authored posts existed in April 2026 and have all been deleted** — every one now returns 404, and `dev.to/api/articles?username=edwardkubiak` returns an empty array (verified against a control query). The profile page still loads but shows zero posts. Titles recovered from a Wayback snapshot (2026-04-10) include "I Built an Observability Dashboard for 17 AI Agents — With Those Same Agents" (the article mirrored at `articles/dev-to-cast-dashboard.md`), "Most of your Claude Code agents don't need Sonnet", and "You're spending money on Claude Code and have no idea how much". Peak engagement was **11 reactions**; most had 1–3. |
| Search snippets | Cached summaries of the deleted articles still appear in search results and quote inconsistent figures ("17 agents" vs "23 agents", "CAST v7.4.1" vs "v8"). **These are index artifacts of dead pages — not treated as verified here.** |

**Author (public info only):** Edward Kubiak, Columbus, Ohio; GitHub company field "META Solutions"; 13 followers, 96 public repos, account created Jan 2022; personal site edwardkubiak.com ("Full Stack Developer & AI Systems Engineer"). Repo history shows a 2022 bootcamp cohort (~50 archived tutorial repos) followed by a burst of AI-agent work starting March 2026.

### Competitive context (star counts verified via GitHub API)

| Project | Stars | What it is |
|---|---|---|
| `davila7/claude-code-templates` | 29,958 | CLI for configuring + monitoring Claude Code; category leader |
| `ccusage/ccusage` | 17,542 | `npx ccusage` — token/cost analyzer reading local JSONL. **Closest competitor to adoption #1 below.** |
| `d-kimuson/claude-code-viewer` | 1,264 | Full web-based interactive Claude Code client |
| `chiphuyen/sniffly` | 1,253 | Usage stats + error analysis dashboard |
| `ColeMurray/claude-code-otel` | 480 | OpenTelemetry + Grafana observability stack |
| `NirDiamant/claude-watch` | 55 | Real-time observability dashboard |
| `Stargx/claude-code-dashboard` | 10 | Name-colliding multi-session monitor (had a Show HN, 3 points) |
| **`ek33450505/claude-code-dashboard`** | **3** | The target of this research |

At least four unrelated projects use the exact name "claude-code-dashboard", so the name carries no search distinctiveness.

**What this means for us.** Judge every borrowed line on the code itself — there is no user base that has stress-tested any of it. The upside: the ideas here were arrived at independently and overlap our thesis closely, and the code quality (50 test files, an audit-driven CHANGELOG, a real schema guard) is well above what 3 stars would suggest.

---

## The problem it solves

Running Claude Code with a fleet of subagents is opaque. After a day of work you cannot answer:

1. **Which agents actually fired**, in what order, and did any of them silently fail?
2. **What did it cost** — in dollars, per session, per project, per model tier?
3. **Are the hooks I configured actually running**, or is the script missing / non-executable / erroring on every fire?
4. **Which sessions burned Sonnet/Opus money on work Haiku would have done?**
5. **Did an agent lie about finishing?** (truncated mid-response, missing handoff block, claimed DONE with no diff)

Claude Code writes all of the raw material to `~/.claude/` (JSONL transcripts, `settings.json`, agent markdown) but ships no reader. CAST adds a SQLite write layer (`~/.claude/cast.db`) via hook scripts, and this dashboard is the read layer over both.

The framing in the README is honest about the split: it calls itself the observability layer and says the dashboard "is a read layer over what CAST writes" (`README.md:198`).

---

## Value proposition

**Real value (verified in code):**

- **Dollarized cost from raw transcripts.** `server/utils/costEstimate.ts` has a real per-model rate table including **cache-write and cache-read rates**, which most Claude Code cost tools ignore. Cache tokens are the majority of spend on long sessions; excluding them understates cost badly.
- **A working file-watcher → SSE → cache-invalidation loop.** Not polling-with-extra-steps: chokidar watches `~/.claude/projects/**`, a separate 3s rowid high-watermark poller watches `cast.db`, and the client turns `db_change_*` frames directly into TanStack Query invalidations (`src/api/useDbChangeInvalidation.ts`). No interval refetch anywhere in the hot path.
- **Hook health as a filesystem fact, not a claim.** `/api/hooks/health` resolves each configured hook command to its script path, stats it for existence + executable bit, joins recent `hook_failures`, and returns green/yellow/red. This is the single most-underrated feature in the repo.
- **Schema-drift guard.** `server/utils/schemaGuard.ts` declares every (table, column) the routes read and diffs it against `PRAGMA table_info` at boot. Because every route wraps its SQL in try/catch, drift would otherwise show up as a confidently-wrong zero on a card. This is a genuine "honesty rule" implemented in code.
- **Fail-closed write gate.** `server/middleware/controlGate.ts`: writes 404 when disabled (hides existence), 503 when enabled-but-unconfigured, 403 on bad token via `crypto.timingSafeEqual`. Reads always pass. Mounted on 12 surfaces from `server/index.ts:82-93`.
- **A CHANGELOG that documents real bug classes.** The v2.6.0 entry is a genuinely valuable engineering artifact — see "Notable code worth stealing".

**Marketing, discount it:**

- **"23 specialist agents."** Actual counts in `claude-agent-team`: `agents/core/` has **27** files, `plugin/agents/` has **22**, plus 10 in `agents/archive/`. The number 23 is stale in every README that repeats it.
- **"WCAG 2.1 AA conformance."** There is real a11y work (skip link, `useModalA11y` focus trap, `MotionConfig reducedMotion="user"`, `aria-live` search status, roving nav) — but "conforms to WCAG 2.1 AA" is an *audited* claim and no audit artifact is committed. Read it as "a11y-conscious," not certified.
- **"exponential backoff reconnect"** on the SSE stream (`README.md:403`). **False.** `src/api/useLive.ts:33` is a flat `setTimeout(connect, 3000)`. No backoff, no jitter, no cap.
- **The Swarm page.** Documented across ~15 README lines with a component table. `src/App.tsx:62` redirects `/swarm` → `/`. It was archived in the 2026-07-04 QA close-out and the README was never updated.
- **"Zero telemetry / local-first."** This one is **true and verifiable** — no analytics dependency in `package.json`, no outbound fetch in the server. Same thesis as ours.

---

## Feature inventory

| Feature | What it does | Where in the code (file/dir) | Depends on |
|---|---|---|---|
| Live event stream (SSE) | `/api/events` text/event-stream; broadcasts `session_updated`, `agent_spawned`, `session_complete`, `session_stale`, `routing_event`, `tool_use_event`, `hook_event`, `command_queued`, `heartbeat` (15s), `stale_reconcile`, `db_change_*` | `server/watchers/sse.ts` | chokidar, better-sqlite3, `parsers/workLog.ts` |
| Tail-only JSONL read | Reads last 256 KB of a JSONL on append, drops the partial first line, full-read fallback for oversized entries | `server/watchers/sse.ts:86-135` (`readTail`, `readLastLine`) | fs |
| Idle-completion detection | 30s debounce per file; on expiry scans the last 20 (then 50) lines bottom-up for `Status: DONE\|DONE_WITH_CONCERNS\|BLOCKED\|NEEDS_CONTEXT`, else emits `stale` | `server/watchers/sse.ts:445-485` | — |
| Staleness guard | Every 60s, sessions unseen for 8 min emit `session_stale` once | `server/watchers/sse.ts:568-583` | — |
| Stale reconciliation on connect | On each new SSE connection, queries `agent_runs` for terminal statuses in the last 2h and pushes `doneSessionIds` so the client clears phantom "running" pills | `server/watchers/sse.ts:305-330` | cast.db |
| Parent-agent attribution | 200ms after a subagent JSONL appears, reads its `promptId`, scans sibling files (first 100 lines) for a matching `promptId`, re-broadcasts with `parentAgentId` | `server/watchers/sse.ts:210-249, 417-436` | fs |
| CAST agent-name inference | Regex on the first user message — `/^You are (?:(?:the\|a) CAST \|(?:the\|a) )?\`?([a-z][a-z0-9-]+)\`?(?: agent)?[.\s,]/im` — when the `.meta.json` sidecar says `general-purpose` | `server/watchers/sse.ts:158-206` | fs; per-file memo cache |
| cast.db change watcher | 3s poll of `MAX(rowid)` high-watermarks on `agent_runs`, `sessions`, `routing_events`; emits one event per new row, LIMIT 50; log-once error guard | `server/watchers/castDbWatcher.ts` | better-sqlite3 |
| Query-cache invalidation from SSE | Maps `db_change_agent_run` → invalidate `['cast','agent-runs']` + `['cast','work-log-stream']`, etc. | `src/api/useDbChangeInvalidation.ts` | TanStack Query |
| HTTP hook receiver | `POST /api/hook-events` accepts a Claude Code hook payload and rebroadcasts it as a `hook_event` SSE frame | `server/watchers/sse.ts:356-383` | controlGate |
| Session ingestion | Walks `~/.claude/projects/*/` top-level `.jsonl`, sums `input/output/cache_creation/cache_read` tokens, counts `tool_use` blocks, rolls up `<session>/subagents/*.jsonl` tokens, picks dominant model by assistant-message frequency | `server/parsers/sessions.ts:8-166` | `safeResolve`, `decodeProjectPath` |
| 10s session cache | Full-tree scan memoized 10s, shared by sessions/search/analytics/config routes | `server/parsers/sessions.ts:171-180` | — |
| Cost estimation | Per-model `{input, output, cacheWrite, cacheRead}` USD/M-token table + family-prefix fallback + sonnet default | `server/utils/costEstimate.ts` | — |
| Token aggregation | Session cost map, totals-since, per-model breakdown, top-N sessions by cost, daily breakdown | `server/utils/jsonlTokenTotals.ts` | costEstimate, sessions cache |
| Delegation savings | Re-prices **only haiku sessions** at sonnet rates, `savedUSD = max(0, sonnetEquivalent − actualHaiku)`; plus haiku utilization % across JSONL + `agent_runs` | `server/routes/analytics.ts:233-310` | costEstimate, cast.db |
| Cross-session analytics | Totals, sessions-by-day (90d), by-project, by-model, top-20 tool usage (scans 200 recent sessions), averages, current-billing-month filter | `server/routes/analytics.ts:119-332` | sessions cache |
| Per-agent scorecard | `agent_runs` GROUP BY agent → runs, success rate (`DONE`+`DONE_WITH_CONCERNS`), blocked count, avg cost | `server/routes/analytics.ts:10-39` | cast.db |
| Agent drill-down | Last 50 runs + correlated subquery pulling `dispatch_decisions.prompt_snippet` within +60s of run start as the task summary; per-run truncation flag keyed on `agent_id` | `server/routes/analytics.ts:42-117` | cast.db |
| Hook health | Extracts the script token from each hook command, `~`/relative resolution, stat for exists + `mode & 0o111`, joins `hook_failures` MAX(timestamp)+COUNT, → green/yellow(>24h)/red | `server/routes/hooks.ts:117-197` | settings.json, cast.db |
| Hookify parsing | Also parses `~/.claude/hookify.*.local.md` YAML frontmatter (`event`, `description`, `conditions`) as hook definitions | `server/routes/hooks.ts:37-67` | — |
| Schema-drift guard | 16-table `EXPECTED_SCHEMA` contract vs `PRAGMA table_info`; boot warning + gating contract test | `server/utils/schemaGuard.ts`, `server/__tests__/schemaContract.test.ts` | better-sqlite3 |
| Control gate | 404/503/403 fail-closed write gate with constant-time token compare | `server/middleware/controlGate.ts` | crypto |
| Rate limiting | 5 req/min destructive, 10 req/min seed/castd, none on reads | `server/index.ts:41-68` | express-rate-limit |
| Path-traversal guard | `safeResolve(base, ...parts)` → null if escaped | `server/utils/safeResolve.ts` | path |
| Work Log parser | Parses `## Work Log` sections into `{items, filesRead, filesChanged, codeReviewerResult, testWriterResult, decisions}`; `synthesizeWorkLog` falls back to a `Summary:` line | `server/parsers/workLog.ts` | — |
| Quality gates | `/api/quality-gates` + `/stats` — pass rate, by-agent rate, by-status-line counts, since/until/agent filters | `server/routes/qualityGates.ts` | cast.db |
| Agent reliability (7 tabs) | hallucinations, completeness, code-ref checks, unstaged warnings, truncations, protocol violations, worktree anomalies | `server/routes/agentHallucinations.ts`, `completenessEvents.ts`, `codeRefChecks.ts`, `unstagedWarnings.ts`, `agentTruncations.ts`, `agentProtocolViolations.ts` (via `routes/index.ts`), `worktreeAnomalies.ts`; UI `src/views/AgentReliabilityView.tsx` (27 KB) | cast.db |
| Executive summary | KPI rollup: plans, gate pass-rate, hook failures, cost, equal-length prior-window deltas | `server/routes/executiveSummary.ts`, `src/views/ExecutiveSummaryView.tsx` | cast.db |
| Eval harness results | pass@k per eval / agent / model tier from `eval_runs` | `server/routes/evalRuns.ts`, `src/views/EvalRunsView.tsx` | cast.db |
| SQLite explorer | Read-only paginated browser over allow-listed `cast.db` tables | `server/routes/sqliteExplorer.ts`, `src/views/SqliteExplorerView.tsx` (21 KB) | cast.db |
| Global search (⌘K) | Debounced 200ms search across sessions/agents/plans/memories; cmdk palette with nav-item fallback, skeletons, `aria-live` count | `server/routes/search.ts`, `src/components/CommandPalette.tsx` | cmdk |
| Memory browser | Agent + project memory files, filter by type, inline edit/delete, backup status, consolidation runs | `server/parsers/memory.ts`, `server/routes/memory.ts`, `memoryConsolidation.ts`, `src/views/MemoryView.tsx` | fs, cast.db |
| Agent registry CRUD | Parse agent markdown frontmatter (gray-matter); GET/PUT/POST behind control gate | `server/parsers/agents.ts`, `server/routes/agents.ts` | gray-matter |
| Budget banner | Daily-limit gauge; banner at ≥80% (amber) / over (rose), `role="alert"` | `server/routes/budgetStatus.ts`, `src/components/Layout.tsx:40-71` | cast.db |
| Agent personalities | 8×10 pixel-art sprite grids, neon accent color, ALL-CAPS role title, tagline per agent; 7 archetypes | `src/utils/agentPersonalities.ts` (18 KB) | — |
| Timestamp normalization | Converts SQLite space-format to ISO-UTC before `new Date()`; `timeAgo`, `formatDuration` | `src/utils/time.ts` | — |
| Theme toggle | dark/light, `localStorage['cast-theme']`, system default, no FOUC | `src/state/themeState.tsx` | — |
| Modal a11y | Focus trap + Escape + focus return, reused by palette and mobile drawer | `src/lib/useModalA11y.ts` | — |
| Control dispatch | `POST /api/control/dispatch` spawns a CAST agent via `child_process.spawn`, tracked in `task_queue` | `server/routes/control.ts` | controlGate |
| Cron management | Read/CRUD CAST crontab entries; v2.7.0 pipes to `crontab -` via spawn stdin (no shell) | `server/routes/castdControl.ts` | controlGate |
| Test suite | 30 server test files + 20 frontend test files (Vitest + RTL + supertest), incl. a real-app control-gate wiring test that imports `server/index.ts` | `server/__tests__/`, `src/**/*.test.ts(x)` | vitest |

---

## UX and interaction design

**Layout.** Fixed 208px (`w-52`) left sidebar + top bar + scrollable main. The sidebar has a glass surface, a Framer-Motion scroll-progress bar pinned to its top edge, and a live SSE status footer (pinging green dot / grey dot, "Connected" / "Disconnected"). Nav is grouped into four labeled sections — **Overview** (Dashboard, Executive, Sessions, Analytics), **Observability** (Work Log, Evals, Injection Log, Routines, Hooks, Database), **Reliability** (Failures, Reliability, Incidents), **System** (Memory, Plans, Agents, Outputs, System, Docs). 19 nav items is a lot, but the grouping makes it navigable — worth contrasting with our 30+ flat sections.

**The best single nav detail:** the Hook Failures item carries a live count badge (`99+` cap) driven by `useHookFailuresCount` (`src/components/Sidebar.tsx:139-143`). One number in the chrome tells you your automation is broken without opening anything.

**Active-state animation.** `layoutId="nav-active-pill"` with a spring (`stiffness: 380, damping: 32`) — the active pill physically slides between nav items rather than cutting. Cheap, and it makes the nav feel like one object.

**Density.** Genuinely dense: `text-xs`/`text-[10px]` labels, `px-3 py-2` rows, `tracking-[0.12em]` uppercase group headers. It reads as an ops console, not a marketing dashboard. Tailwind v4 with CSS custom properties (`var(--bg-primary)`, `var(--accent)`, `var(--text-muted)`) throughout — every color is a token, which is why the light/dark toggle works cleanly.

**Status semantics.** `src/components/StatusPill.tsx` maps status strings to five tones with a single function:
- `live` (accent, **pulsing** dot) — running / in_progress / active / dispatched
- `success` (emerald) — done / completed / pass / ok
- `warning` (amber) — anything containing "concern", plus warning / retry / pending / queued
- `danger` (rose) — blocked / failed / error / abandoned / killed
- `neutral` (muted) — everything else

The pulse is reserved for `live` only, and it respects `motion-reduce:animate-none`. **The `DONE_WITH_CONCERNS` → amber mapping via substring match is a nice touch** — a partial success is visually distinct from both a clean pass and a failure. Our Runs/Reliability sections have no equivalent third state.

**Real-time behavior.** Three cooperating mechanisms, and the layering is the clever part:
1. chokidar file events → immediate SSE frames (sub-second, transcript-driven)
2. 3s rowid poll on cast.db → `db_change_*` frames → direct TanStack Query invalidation (structured, cheap)
3. 15s heartbeat to keep proxies from killing the stream; 3s client reconnect on error

New SSE connections get a **replay of the last 15 messages** from the most-recently-active JSONL, tagged `historical: true` so the UI can style them differently. That means opening a second tab is not a blank screen — a detail we don't handle at all.

**Notifications.** `sonner` toasts are a dependency; the durable notification surfaces are the sidebar failure badge and the budget banner. The budget banner sits *above* the top bar (so it pushes content, never overlays), uses `role="alert"`, and shows 4-decimal precision when the amount is under a cent (`Layout.tsx:46-52`) — a small honesty detail matching our "null is never 0" instinct.

**Empty states.** Handled at the route level, not per-widget: every route is wrapped in `<ErrorBoundary>` (`src/App.tsx`) so one broken view cannot kill the shell, and DB-backed routes return `{ gates: [] }` / `{ decisions: [] }` rather than 500 when the table is missing (`server/routes/qualityGates.ts:18-20`). Analytics routes go the other way and return **503 `{error: 'cast.db not available'}`** rather than a fake zero (`analytics.ts:13`) — that is the honest choice and matches our thesis.

**Onboarding.** Weak. There is a `/docs` route (`DocsView.tsx`, 21 KB) but no first-run wizard, no "CAST not detected" guidance in the UI. The README carries all the setup burden. Our `SetupSection` is ahead here.

**Shortcuts.** `⌘K`/`Ctrl+K` toggles the palette via `react-hotkeys-hook` with `enableOnFormTags: true`; ↑↓ navigate, ↵ open, esc close, all rendered as `<kbd>` hints in the palette footer. The top-bar Search button also shows the `⌘K` kbd hint — discoverable, not just documented. **Only one global shortcut exists** — no `g`-prefix navigation, no `?` help sheet.

**Mobile.** Real, not an afterthought. The sidebar becomes an off-canvas drawer below `lg`, with a backdrop-blur overlay, and — the good part — it becomes a *modal dialog only on small screens*: `useModalA11y(sidebarOpen, close)` engages focus-trap + Escape + focus-return exactly when the drawer slides in, and `role="dialog"`/`aria-modal` are applied conditionally (`Layout.tsx:81, 124-126`). Main padding steps `p-4 md:p-6`.

**A11y specifics worth copying:** a visually-hidden "Skip to main content" link that becomes visible on focus; per-route `document.title` from a `ROUTE_TITLES` map (WCAG 2.4.2); `sr-only role="status" aria-live="polite"` announcing search progress and result counts; `aria-labelledby` linking each nav `<ul>` to its group heading; `<main tabIndex={-1}>` as a focus target.

**What feels good and why.** The dashboard commits to being a *console*. Small type, grouped nav, semantic status pills everywhere, a persistent connection indicator, and one live-updating badge in the chrome. Nothing animates except the nav pill and the live dots, so motion always means "something is happening." The failure mode of most dashboards — a wall of cards that all look equally important — is avoided by the four-group nav hierarchy and by reserving the pulse animation for genuinely-live state.

**What doesn't.** 19 nav items + an 11-tab System page is still too much surface for 3 stars' worth of users; the CommandPalette's `NAV_ITEMS` list (`CommandPalette.tsx:21-42`) contains **seven dead routes** (`/activity`, `/dispatch-log`, `/token-spend`, `/quality-gates`, `/knowledge`, `/rules`, `/privacy`) that now only redirect — the palette advertises pages that no longer exist.

---

## Architecture

**Data sources**
- `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` — main session transcripts
- `~/.claude/projects/<encoded-cwd>/<sessionId>/subagents/*.jsonl` + `*.meta.json` sidecars — subagent transcripts and agent identity
- `~/.claude/settings.json` + `settings.local.json` — hook wiring
- `~/.claude/hookify.*.local.md` — alternative hook definitions
- `~/.claude/agents/`, `rules/`, `skills/`, `plans/`, `commands/`, `agent-memory-local/` — markdown + frontmatter
- `~/.claude/cast.db` — SQLite, **written exclusively by CAST hook scripts**, opened `{readonly: true, fileMustExist: true}` by the dashboard
- `~/.claude/config/model-pricing.json` — declared authoritative source for rates (the TS table is a hand-synced mirror)

**Ingestion.** Two independent paths, deliberately not unified:
- *Pull*: `listSessions()` does a full-tree scan; `getCachedSessions()` memoizes it for 10s and is shared by the sessions/search/analytics/config routes.
- *Push*: chokidar (`depth: 4`, ignoring `**/tool-results/**` and `**/node_modules/**`) fires on add/change; only the file **tail** is read.

The key insight: the expensive full scan is never on the hot path, and the hot path never reads a whole file.

**Storage.** The dashboard stores nothing of its own. No dashboard DB, no cache files, no config. `cast.db` schema is owned by CAST's `cast-db-init.sh`; the dashboard performs **zero writes at startup** (this was the headline v2.6.0 fix — its old auto-seed was silently re-adding six columns CAST had dropped, on every boot).

**Transport.** REST for on-demand, one long-lived SSE connection for push. No WebSocket. SSE is one-directional; writes go over normal POST/PUT behind the control gate. Notably `Access-Control-Allow-Origin` is **hardcoded to `http://localhost:5173`** inside the SSE handler (`sse.ts:273`) even though the rest of the app honors `CORS_ORIGIN` — a real bug if you change the port.

**Frontend state model.** TanStack Query v5 is the only server-state store. There is no Redux/Zustand. Two tiny React contexts exist: `SseStateContext` (connection boolean) and `themeState`. Invalidation is event-driven — `useDbChangeInvalidation()` is called once at the `App` root and maps SSE frames to query keys. Routes are `React.lazy` code-split, each wrapped in `ErrorBoundary`. Long lists use `@tanstack/react-virtual`.

**Build tooling.** Vite 6 + `@vitejs/plugin-react`, Tailwind v4 via `@tailwindcss/vite`, TypeScript 5.6 (`tsc -b && vite build`), `tsx watch` for the server in dev, `concurrently` to run both. Production: `node dist/server/index.js` serving static `dist/`. CI is a single GitHub Actions workflow (`.github/workflows/ci.yml`, 405 bytes).

### Data flow

```
 ~/.claude/                                    EXPRESS 5  (:3001)                REACT 19 SPA (:5173)
 ─────────                                     ─────────────────                 ────────────────────
                            ┌──────────────────────────────────────────┐
 projects/                  │  chokidar.watch(PROJECTS_DIR, depth:4)   │
   <proj>/                  │      on add / change / unlink            │
     <sid>.jsonl ──────────▶│           │                              │
     <sid>/subagents/       │           ▼                              │
       agent-*.jsonl ──────▶│   readTail(256KB) → readLastLine()       │
       agent-*.meta.json ──▶│   readAgentMetaCached()                  │
                            │   parseWorkLog() / synthesizeWorkLog()   │
                            │   Status: regex  ·  30s idle timer       │
                            │   8-min staleness sweep (60s interval)   │
                            │           │                              │
                            │           ▼                              │
                            │      broadcast(LiveEvent) ───────────────┼──▶ GET /api/events (SSE)
 cast.db  ─────────────────▶│  castDbWatcher: 3s poll                  │         │  heartbeat 15s
   agent_runs               │    SELECT rowid > lastSeen LIMIT 50      │         │  replay last 15 (historical:true)
   sessions                 │    on agent_runs / sessions /            │         │  stale_reconcile on connect
   routing_events           │       routing_events                     │         ▼
   quality_gates            │           │                              │   useLiveEvents()  ── EventSource
   dispatch_decisions       │           └── db_change_* ───────────────┼──▶ useDbChangeInvalidation()
   hook_failures            │                                          │         │
   eval_runs, incidents...  │                                          │         ▼
                            │  ┌────────────────────────────────────┐  │   queryClient.invalidateQueries()
                            │  │ getCachedSessions()  (10s memo)    │  │         │
 settings.json ────────────▶│  │   listSessions(): full-tree scan   │  │         ▼
 agents/*.md ──gray-matter─▶│  │   → tokens · tools · dominantModel │  │   TanStack Query v5 cache
 rules/ skills/ plans/      │  └──────────────┬─────────────────────┘  │         │
 agent-memory-local/        │                 ▼                        │         ▼
                            │        estimateCost(in,out,cw,cr,model)  │   React Router v6 (lazy + ErrorBoundary)
                            │        jsonlTokenTotals · analytics      │         │
                            │        delegationSavings                 │         ▼
                            │                 │                        │   Views  ── Recharts · react-virtual
                            │  REST GET  ─────┴────────────────────────┼──▶ apiFetch (Vite proxy /api → :3001)
                            │                                          │
                            │  POST/PUT/DELETE ──▶ controlGate ────────┼──◀ controlFetch (X-Dashboard-Token)
                            │     404 disabled · 503 unconfigured      │
                            │     403 bad token (timingSafeEqual)      │
                            │     + express-rate-limit 5/min · 10/min  │
                            │                                          │
                            │  BOOT: logSchemaDrift(getCastDb())       │
                            │        PRAGMA table_info vs              │
                            │        EXPECTED_SCHEMA (16 tables)       │
                            └──────────────────────────────────────────┘
```

---

## Notable code worth stealing

Ordered by value to us. Port difficulty is rated for **React 18 + Express ESM, no TypeScript, no build step for the server**.

### 1. `server/utils/costEstimate.ts` → dollarized cost with cache rates — **Easy**
48 lines, zero dependencies, pure function. Rate table keyed by exact model id with a family-prefix fallback (`claude-sonnet` → `claude-sonnet-4-6`) and a final sonnet default. **Why good:** it prices `cache_creation_input_tokens` and `cache_read_input_tokens` separately (cacheWrite = 1.25× input, cacheRead = 0.1× input), which is where most of the money actually is. **Port:** strip the two type annotations, rename to `.mjs`, done. Consider storing rates in a JSON file with a `lastVerified` date so we can render "rates as of X" rather than implying live pricing.

### 2. `server/watchers/sse.ts:86-135` → `readTail` / `readLastLine` — **Easy**
Reads the last N bytes with `fs.openSync`/`readSync` at `size - maxBytes`, discards the possibly-partial first line, falls back to a full read only when the tail contained no parseable line. **Why good:** this is the difference between a watcher that works on a 40 MB transcript and one that pins a core. Our `readTranscript` in `server/index.mjs` currently reads whole files. **Port:** copy verbatim, drop types.

### 3. `server/utils/schemaGuard.ts` pattern → **contract-declaration guard** — **Easy (adapted)**
We have no SQLite, so don't port the SQL. Port the *idea*: a single module declaring every external field our routes depend on (JSONL entry shapes, `settings.json` keys, `.claude.json` structure), verified at boot against a real sample, warning loudly on drift, and asserted by a test. **Why good:** it is the code-level enforcement of our own "honesty rules" — it converts "silently wrong number" into "loud warning." This is the highest-leverage *idea* in the repo even though the literal code doesn't transfer.

### 4. `server/routes/hooks.ts:117-197` → hook health (exists / executable / last-failed) — **Easy→Medium**
Extracts the script token from a hook command with `/\.(sh|py|js|ts|mjs)$/`, expands `~`, resolves relative against `~/.claude`, stats it, and grades green/yellow/red. **Why good:** a hook wired in `settings.json` whose script was renamed is invisible today; this makes it a red dot. **Port:** Easy for exists; **Medium** because the executable-bit check is POSIX-only — on Windows we'd substitute "is readable + has a known interpreter prefix" and label the executable column `unknown` rather than faking a pass. Lands in our `HooksSection`.

### 5. `server/middleware/controlGate.ts` → fail-closed write gate — **Easy**
74 lines. 404-when-disabled (hides existence), 503-when-unconfigured, 403-on-bad-token, `crypto.timingSafeEqual` with a uniform-timing length-mismatch path, safe methods always pass. **Why good:** we write to real config with timestamped backups — a localhost-only Express server with unauthenticated write endpoints is our biggest latent exposure. **Port:** copy, drop types, mount on our write routes in `server/index.mjs`. Note the subtlety at line 32-33: it calls `timingSafeEqual(ab, ab)` on a length mismatch purely to keep timing uniform.

### 6. `server/utils/safeResolve.ts` → path-traversal guard — **Easy**
9 lines. `path.resolve` then assert `startsWith(base + sep)`. **Why good:** the v2.7.0 CHANGELOG documents the exact bug this fixes — an unvalidated `agentName` let `..` escape and overwrite `settings.json`. We build paths from user-supplied project/session names in several handlers. **Port:** copy verbatim.

### 7. `src/api/useDbChangeInvalidation.ts` + `server/watchers/castDbWatcher.ts` → **event-driven cache invalidation** — **Medium**
The rowid high-watermark poll is SQLite-specific, but the *pattern* transfers directly: a server-side change detector emits typed `change:<resource>` SSE frames; the client maps frame type → cache-key invalidation. **Why good:** it removes every polling interval from the UI while keeping the client dumb. **Port:** Medium — we have no TanStack Query, so we'd need a small `useResource(key, fetcher)` hook with a module-level registry that the SSE handler can invalidate. Worth building once; every section benefits. For our file-based sources the detector is mtime+size per watched path rather than rowid.

### 8. `server/parsers/sessions.ts:90-137` → subagent token roll-up + dominant-model election — **Easy**
Walks `<session>/subagents/*.jsonl`, adds their usage into the parent session's totals, and counts models across parent + children to elect a dominant model (falling back to the first model seen in the same single parse loop — `candidateModel`, added as perf fix P5). **Why good:** without the roll-up, a session that delegated everything reports near-zero tokens. **Critical detail to copy:** `analytics.ts:152-154` explicitly notes that `agent_runs` costs are *not* added on top, because the JSONL roll-up already includes subagent usage — double-counting is the obvious trap here.

### 9. `src/utils/time.ts:12-18` → `parseTimestamp` — **Easy**
Three lines of regex that convert `'2026-07-02 18:54:34'` to `'2026-07-02T18:54:34Z'`. **Why good:** the v2.6.0 CHANGELOG calls this a whole **"timestamp-format bug class"** — lexicographic comparison of mixed ISO-`T` and space-format timestamps made a "15-minute" filter match the entire day (26 phantom active agents), made a "2-hour" SSE window mean "same UTC day," and returned empty gate pass-rates. We mix `mtimeMs` numbers and ISO strings from JSONL; this is a bug we can pre-empt.

### 10. `src/components/StatusPill.tsx` → 5-tone status semantics — **Easy**
57 lines. One `toneFor(status)` function, five tones, pulse reserved for `live`, `motion-reduce` respected. **Why good:** consistent status color across every view without each section inventing its own mapping — and the `includes('concern')` → warning rule gives us the missing "partial success" state. **Port:** we're not on Tailwind, so translate the class maps to our CSS-variable classes; the `toneFor` logic copies verbatim.

### 11. `server/watchers/sse.ts:445-485` → idle-completion + terminal-status extraction — **Medium**
30s per-file debounce; on expiry, scan the last 20 lines bottom-up for `Status: DONE|DONE_WITH_CONCERNS|BLOCKED|NEEDS_CONTEXT`, then widen to the last 50 lines of raw text, else emit `stale`. **Why good:** transcripts have no "session ended" record. This is the only honest way to say a run finished, and the explicit `stale` fallback refuses to guess — exactly our null-is-not-zero discipline applied to state. **Port:** Medium; needs a timer map and shutdown cleanup (they clear timers on SIGTERM/SIGINT at `sse.ts:610-619`).

### 12. `server/watchers/sse.ts:210-249` → parent-agent attribution via `promptId` — **Medium**
When a subagent JSONL appears, wait 200ms, read its `promptId`, scan sibling files' first 100 lines for a matching `promptId` carrying an `agentId`, re-broadcast with `parentAgentId`. **Why good:** this reconstructs the agent *tree* from flat files — directly useful for our `PlanGraph` and `ActivityTimeline`. **Port:** Medium; the 200ms sleep is a race-condition band-aid and the sibling scan is O(files × 100 lines) per spawn, so cache aggressively.

### 13. `server/routes/analytics.ts:233-310` → delegation savings — **Medium**
Re-prices only haiku sessions at sonnet rates; `savedUSD = max(0, sonnetEquivalent − actualHaiku)`. **Why good — and why to be careful:** the code comment is explicit that opus/sonnet sessions are excluded "so the baseline never exceeds the actual mixed-model cost." That's an honest guard. But the metric is still a counterfactual: it assumes the haiku work would have succeeded identically on sonnet. **If we port it, label it "modeled savings" and show the assumption inline** — otherwise it violates our own honesty rules. The **haiku utilization %** half of the same computation is a real measured number and safe to show unqualified.

### 14. `src/lib/useModalA11y.ts` → focus-trap hook — **Easy**
One hook doing focus trap + Escape + focus return, reused by the command palette and the mobile drawer. 2.8 KB. **Port:** copy; strip the generic type parameter.

### 15. `server/parsers/workLog.ts` → structured Work Log extraction — **Easy**
Parses `## Work Log` markdown into `{items, filesRead, filesChanged, decisions, codeReviewerResult, testWriterResult}` by prefix matching (`Read:`, `Wrote:`, `Edited:`, `Decision:`), with a `Summary:`-line fallback. **Why good:** `filesChanged` is a *cheap second signal* for our flagship **WorkingSet** — today we derive edited files from tool-call records; a self-reported list gives us a cross-check and catches edits made via Bash. **Port:** copy; it's pure string work.

### 16. `CHANGELOG.md` v2.6.0/v2.7.0 → **a bug-class checklist, not code** — **Free**
Not code, but arguably the most valuable artifact in the repo. It documents, with root causes: the timestamp-format bug class; a join fanout (`5,891 runs → 9,720 rows` from keying on non-unique `(session_id, agent_type)` instead of `agent_id`); `?limit=-1` bypassing row caps across 14 routes because SQLite treats `LIMIT -1` as unlimited; a `scope_key` producer/consumer mismatch (`'*'` vs `'global'`) hiding a configured budget; a card reporting its 200-row fetch cap as the total; case-sensitive severity comparison rendering badges uncolored. **Every one of these has an analogue in our codebase.** Worth reading once as a self-audit checklist.

---

## Gaps and weaknesses

1. **No license.** No `LICENSE` file; API reports `license: null`; the README's MIT claim is a static badge only. Default copyright = all rights reserved. *We have the author's explicit permission to copy, so this is not a blocker for us — but it must be recorded in our attribution notes, and we should ask the author to commit an actual MIT LICENSE file so the provenance is clean.*
2. **Hard dependency on CAST for most value.** Without `~/.claude/cast.db`, the Agents scorecard, quality gates, reliability tabs, evals, incidents, routines, injection log, executive summary, and DB explorer are all empty or 503. That's the majority of the nav. Only sessions/analytics/hooks/memory work standalone. This is the single biggest reason we should port *primitives*, not *pages*.
3. **Windows-hostile.** `sse.ts:138` hardcodes `'/'` for path splitting; `hooks.ts:163` checks the POSIX executable bit; the README scopes support to macOS/Linux. Our project runs on Windows — every port needs `path.sep` and a Windows branch.
4. **README ↔ code drift.** Documented-but-gone: the Swarm page (redirects to `/`), Managed Agents (removed as dead code in v2.7.0 per its own CHANGELOG, yet still in the README API table), "exponential backoff" SSE reconnect (it's a flat 3s), version badge (2.6.0 vs 2.7.0), "23 agents" (actually 22 or 27 depending on directory).
5. **Dead nav in the command palette.** Seven of 20 `NAV_ITEMS` point at routes that now only redirect.
6. **SSE broadcast is unbounded fan-out.** `broadcast()` writes synchronously to every client with no backpressure handling, no `res.writableEnded` check, and no per-client buffering. A stalled client blocks the loop. Fine at 1–2 tabs; not a general-purpose design.
7. **CORS inconsistency.** The SSE route hardcodes `Access-Control-Allow-Origin: http://localhost:5173` (`sse.ts:273`) while the rest of the app reads `CORS_ORIGIN`. Change `PORT` and live updates silently stop.
8. **CSP deliberately disabled.** `helmet({ contentSecurityPolicy: false })` with an honest comment saying to enable a tuned CSP before exposing beyond localhost. Correct call, but it means the "secure by default" framing has an asterisk.
9. **Full-tree scan does not scale.** `listSessions()` reads *every line of every JSONL* on a cache miss. The 10s memo hides it in dev; on a machine with years of transcripts the first request after each 10s window is expensive. There is no incremental index.
10. **Tool-usage analytics are capped and mislabeled.** `analytics.ts:205` slices to 200 sessions under a comment that says "scan most recent 50 sessions" — and the resulting counts are presented without noting the cap.
11. **Counterfactual metrics presented as fact.** "Delegation savings" in dollars is a model, not a measurement (see item 13 above).
12. **Effectively zero external validation.** 3 stars, 1 fork, 0 issues, 18 PRs all self-merged, 1 outside contributor with 1 commit. No HN, Reddit, or X discussion; no npm presence; the author's seven supporting dev.to articles have all been deleted. Whatever we take must be judged on the code itself, because there is no user base that has stress-tested it.
    - Related risk: **the author appears to be winding down public promotion of CAST** (articles deleted, several component taps archived, attention moved to `compute-atlas`). Do not build a dependency on this repo continuing to exist — vendor what we take, with attribution, rather than tracking upstream.
13. **`.superpowers/brainstorm/` artifacts committed.** Server PID/log files and scratch HTML checked into the repo — cosmetic, but a sign of "committed by an agent, not reviewed."
14. **Dashboard version drift risk against CAST.** The schema guard is a good mitigation, but the dashboard reads a database whose schema is owned by a separate repo on a separate release cadence — v2.6.0 exists almost entirely to repair that coupling.

---

## Overlap with Loush Dashboard

| Their feature | Our equivalent section (or NONE) | Who does it better | Note |
|---|---|---|---|
| Sessions list + JSONL drill-down | `SessionsSection`, `ForensicsSection` | **Tie** | Both read `~/.claude/projects/**/*.jsonl`. They add virtualized timelines + markdown export; we join to repos on disk. |
| Token analytics | `UsagePanel` | **Them** | We count tokens; they price them, including cache-write/cache-read. This is our clearest deficit. |
| Cost in dollars | NONE | **Them** | No rate table anywhere in our server. |
| Model-tier breakdown / delegation savings | `Insights` (partial) | **Them** | Their haiku-utilization % is solid; their $-savings is a counterfactual. |
| Live activity stream | `ActivityTimeline` | **Them** | We have SSE only for chat/ticket streaming (`server/index.mjs:947`). No filesystem watcher, no live event bus. |
| Agent registry + scorecard | `CapabilityLedger`, `HarnessSection` | **Tie** | They add per-agent success rate and avg cost from cast.db; we cover more config surface. |
| Hook definitions | `HooksSection` | **Tie** | Both parse `settings.json`. They also parse `hookify.*.local.md`. |
| **Hook health (exists/executable/last-failed)** | NONE | **Them** | Highest-value small feature they have that we lack entirely. |
| Hook failure log + sidebar badge | `ReliabilitySection` (partial) | **Them** | The persistent count badge in the chrome is the good part. |
| Quality gates (pass rate by agent) | `QualitySection`, `Governance` | **Tie** | Theirs is thinner but backed by real hook-written rows. |
| Agent reliability (7 anomaly types) | `ReliabilitySection`, `BugsSection` | **Them (breadth)** | Truncations, protocol violations, worktree anomalies, code-ref checks are categories we don't model. But all require CAST hooks to populate. |
| Eval results (pass@k) | `PromptQuality` (adjacent) | **Neither** | Different problems: theirs is agent evals, ours is prompt quality. |
| Executive KPI summary | `Overview`, `InsightsSection` | **Tie** | Their equal-length prior-window delta logic is worth copying. |
| Memory browser | `LibrarySection`, `ContextExplorerSection` | **Us** | We have richer context exploration. |
| Plans browser | `PlanGraph` | **Us** | We render a graph; they render a file list with manifest detection. |
| Command palette (⌘K) | `QuickActions` | **Them** | cmdk + debounced global search + `aria-live` results + kbd footer. Ours is a launcher, not a search. |
| Global search across entities | NONE | **Them** | `/api/search` spans sessions, agents, plans, memories. |
| SQLite explorer | NONE | **N/A** | We have no SQLite. Not applicable. |
| Cron / routines | `FlowSection`, `Workflows` | **Us** | Ours is a general workflow model; theirs is crontab CRUD. |
| Incidents log | `BugsSection`, `Forensics` | **Tie** | Theirs is CAST-populated; ours is derived. |
| Outputs (briefings/reports) | `ArtifactsSection` | **Us** | |
| Agent config CRUD | `SetupSection`, `Customize` | **Us** | We write real config with timestamped backups; they write frontmatter behind the control gate. |
| Fail-closed write gate | NONE | **Them** | We write config with no auth gate at all. |
| Path-traversal guard | Unverified in our code | **Them** | Worth an audit on our side. |
| Schema/contract drift guard | NONE | **Them** | Idea transfers even though the SQL doesn't. |
| Theme toggle (dark/light) | `Customize` (partial) | **Them** | Token-based, no FOUC, localStorage-persisted. |
| Mobile responsive shell | Unverified | **Them** | Real off-canvas drawer with conditional modal a11y. |
| **Working set / rework rank / blast radius** | `WorkingSet` (flagship) | **Us — decisively** | They have nothing that joins transcripts to the actual repo: no import graph, no blast radius, no rework ranking, no test-coverage join. |
| **Delivery (JIRA / GitHub / CI)** | `DeliverySection`, `TicketSection` | **Us** | Entirely absent upstream. |
| **Chat / PromptStudio** | `ChatSection`, `PromptStudio` | **Us** | Absent upstream. |
| **Team baseline** | `TeamBaseline` | **Us** | Absent upstream. |
| Local-first, zero telemetry | Core thesis | **Tie** | Same values, independently arrived at. |
| Test coverage of the dashboard itself | ~50 test files | **Them** | 30 server + 20 frontend test files vs our `node --test`. |

---

## Recommended adoptions

Ranked by (value ÷ effort). Effort: **S** ≈ half a day, **M** ≈ 1–3 days, **L** ≈ a week+.

### 1. Cost estimation with cache-token rates — **S**
**Take:** `server/utils/costEstimate.ts` verbatim (de-typed), plus the `getSessionCostMap` / `getModelBreakdown` / `getTopSessions` / `getJsonlDailyBreakdown` shapes from `server/utils/jsonlTokenTotals.ts`.
**Lands in:** new `server/cost.mjs`; consumed by `UsagePanel`, `Overview`, `InsightsSection`.
**Unlocks:** every token number we already compute becomes a dollar number. Cost-per-project, cost-per-session, most-expensive-sessions, daily burn — all fall out of one 50-line module. Ship the rate table as JSON with a `lastVerified` date and render "rates as of &lt;date&gt;" so we never imply live pricing.

### 2. Hook health (exists / executable / last-failed) — **S**
**Take:** `resolveScriptPath` + the health-grading loop from `server/routes/hooks.ts:117-197`.
**Lands in:** `server/index.mjs` (new `/api/hooks/health`) → `HooksSection`.
**Unlocks:** turns our hook list from a config dump into a diagnostic. On Windows, report `executable: null` and label the column "unknown" rather than faking a pass — that *is* our honesty rule.

### 3. Fail-closed control gate + `safeResolve` — **S**
**Take:** `server/middleware/controlGate.ts` and `server/utils/safeResolve.ts`, both near-verbatim.
**Lands in:** `server/index.mjs`, mounted on every write route (setup writes, config writes, ticket writes).
**Unlocks:** closes our biggest latent security gap — we write real user config from unauthenticated localhost endpoints. Also gives us a defensible "read-only by default" story matching our local-first thesis. Pair with a Vitest/node:test port of `server/__tests__/controlGate.test.ts`.

### 4. Status-tone system — **S**
**Take:** `toneFor()` from `src/components/StatusPill.tsx`; retheme the class maps to our CSS variables.
**Lands in:** new `src/components/StatusPill.jsx`; adopt across `RunsSection`, `ReliabilitySection`, `BoardSection`, `QualitySection`, `DeliverySection`.
**Unlocks:** one status vocabulary across 30+ sections, and specifically the missing **partial-success (amber)** state. Pulse reserved for genuinely-live, `motion-reduce` respected.

### 5. `parseTimestamp` + the timestamp bug-class audit — **S**
**Take:** `src/utils/time.ts:12-18` plus a deliberate sweep of our own date comparisons.
**Lands in:** `src/lib/time.js`, used everywhere we compare or render timestamps.
**Unlocks:** pre-empts a bug class their CHANGELOG documents costing them phantom-active-agent counts and empty pass-rates. Cheap insurance; do it while porting anything time-windowed.

### 6. Filesystem watcher → SSE live event bus — **M**
**Take:** the architecture of `server/watchers/sse.ts` — chokidar on `~/.claude/projects` (`depth: 4`, ignore `tool-results`/`node_modules`), `readTail`/`readLastLine` (copy verbatim), the client-replay of the last 15 entries tagged `historical: true`, the 15s heartbeat, and the shutdown timer cleanup. **Skip** the CAST-specific `Status:` regex on the first pass.
**Lands in:** new `server/live.mjs` + `/api/events`; a `src/lib/useLiveEvents.js` hook; first consumers `ActivityTimeline`, `SessionsSection`, `WorkingSet`.
**Unlocks:** the whole dashboard stops being a snapshot. **Fix their bugs while porting:** use `path.sep` not `'/'`; honor `CORS_ORIGIN` on the SSE route; guard `broadcast()` with `res.writableEnded`; implement real exponential backoff with jitter on the client (they claim it and don't have it).

### 7. Event-driven cache invalidation — **M** (do immediately after #6)
**Take:** the pattern from `useDbChangeInvalidation.ts` — typed change frames mapped to cache-key invalidations.
**Lands in:** a small `src/lib/resourceCache.js` (module-level registry + `useResource(key, fetcher)`), wired to the SSE hook.
**Unlocks:** removes polling intervals across sections and keeps components ignorant of *why* they refetched. Our detector is mtime+size per watched path rather than their rowid watermark.

### 8. Contract/drift guard for external file shapes — **M**
**Take:** the *idea* of `schemaGuard.ts`, not its SQL.
**Lands in:** new `server/contracts.mjs` declaring the JSONL entry fields, `settings.json` keys, and `.claude.json` structure our routes depend on; verified at boot against real samples, warning loudly on drift; asserted by a `node --test` contract test.
**Unlocks:** makes our "every number computed from real files" thesis *enforced* rather than aspirational. When Claude Code changes its transcript format, we get a boot warning instead of a silently-wrong chart.

### 9. Subagent token roll-up + dominant-model election — **S→M**
**Take:** `server/parsers/sessions.ts:90-137`, including the `candidateModel` single-pass fallback and — critically — the double-counting warning at `analytics.ts:152-154`.
**Lands in:** our session-scanning code in `server/index.mjs` (the `walkJ` path around line 658).
**Unlocks:** sessions that delegated heavily stop reporting near-zero usage; per-session model attribution becomes trustworthy enough to drive #1.

### 10. Global search + real ⌘K palette — **M**
**Take:** `server/routes/search.ts` shape and `src/components/CommandPalette.tsx` (cmdk, 200ms debounce, `shouldFilter={false}`, skeletons, `sr-only role="status" aria-live="polite"` result count, kbd footer).
**Lands in:** upgrade `QuickActions` from launcher to search; new `/api/search` spanning sessions, projects, files-in-working-set, tickets, prompts.
**Unlocks:** the fastest path through 30+ sections. **Do not copy their `NAV_ITEMS` array** — theirs has seven dead routes; generate ours from the live route table so it cannot drift.

### 11. Structured Work Log parsing — **S**
**Take:** `server/parsers/workLog.ts` verbatim.
**Lands in:** `server/index.mjs` transcript parsing → `WorkingSet` and `ActivityTimeline`.
**Unlocks:** a self-reported `filesChanged` list as a **second, independent signal** for our flagship WorkingSet — cross-checks our tool-call-derived edit list and catches edits made through Bash that we'd otherwise miss.

### 12. Modal a11y hook + skip-link + per-route titles — **S**
**Take:** `src/lib/useModalA11y.ts`, the skip-link from `Layout.tsx:106-111`, and the `ROUTE_TITLES` → `document.title` effect.
**Lands in:** `src/lib/useModalA11y.js`, our app shell.
**Unlocks:** baseline a11y across every modal we already have, for near-zero effort.

### 13. Agent-tree reconstruction via `promptId` — **M**
**Take:** `readSubagentPromptId` + `findParentAgentId` (`sse.ts:210-249`).
**Lands in:** `PlanGraph`, `ActivityTimeline`.
**Unlocks:** a real parent→child agent tree from flat transcript files. Their 200ms sleep is a race band-aid and the sibling scan is O(files × 100 lines) per spawn — cache the `promptId → agentId` map per session directory instead.

### 14. Sidebar live-count badge + grouped nav — **S**
**Take:** the pattern from `Sidebar.tsx:104-157` — four labeled nav groups, `aria-labelledby` per group, and a count badge (`99+` cap) on the failures item.
**Lands in:** our app shell / `CustomizeSection`.
**Unlocks:** with 30+ sections we need grouping more than they do, and a single live count in the chrome that tells you something is broken without navigating.

### 15. Delegation savings — **M**, and **only with a caveat label**
**Take:** `analytics.ts:233-310`.
**Lands in:** `InsightsSection`.
**Unlocks:** haiku-utilization % is a real measured number — ship that unqualified. The dollar "savings" figure is a counterfactual that assumes identical outcomes across model tiers; per our honesty rules it must be labeled "modeled" with the assumption stated inline, or left out.

**Explicitly do not adopt:** the SQLite explorer (we have no DB), the CAST-specific reliability tables (they need CAST hooks to populate), the eval-harness view, `agentPersonalities.ts` (charming 8-bit sprites, zero information value), and their README's own claims — verify each against the code before repeating any of it.

---

## Sources

**Primary — GitHub API (fetched 2026-07-29)**
- `https://api.github.com/repos/ek33450505/claude-code-dashboard` — metadata, `license: null`, stars 3, forks 1, created 2026-03-20, pushed 2026-07-05
- `https://api.github.com/repos/ek33450505/claude-code-dashboard/git/trees/main?recursive=1` — full 328-blob tree, `truncated: false`
- `.../languages`, `.../releases`, `.../contributors`, `.../commits?per_page=100`, `.../pulls?state=all`
- `https://api.github.com/repos/ek33450505/claude-code-dashboard/license` — HTTP 404 (no license file)
- `https://api.github.com/users/ek33450505/repos` — full ecosystem inventory including `cast-desktop`, `claude-agent-team`
- `https://api.github.com/repos/ek33450505/cast-desktop` — MIT, Tauri 2, `v1.2.12`
- `https://api.github.com/repos/ek33450505/claude-agent-team` — MIT, 8 stars; tree used for agent/command/skill/hook counts

**Primary — raw source read in full**
`README.md` · `package.json` · `CLAUDE.md` · `CHANGELOG.md` · `server/index.ts` · `server/watchers/sse.ts` · `server/watchers/castDbWatcher.ts` · `server/utils/costEstimate.ts` · `server/utils/jsonlTokenTotals.ts` · `server/utils/schemaGuard.ts` · `server/utils/safeResolve.ts` · `server/parsers/sessions.ts` · `server/parsers/workLog.ts` · `server/middleware/controlGate.ts` · `server/routes/analytics.ts` · `server/routes/qualityGates.ts` · `server/routes/hooks.ts` · `src/App.tsx` · `src/components/Layout.tsx` · `src/components/Sidebar.tsx` · `src/components/CommandPalette.tsx` · `src/components/StatusPill.tsx` · `src/api/useLive.ts` · `src/api/useDbChangeInvalidation.ts` · `src/utils/time.ts` · `src/utils/agentPersonalities.ts` — all via `raw.githubusercontent.com/ek33450505/claude-code-dashboard/main/<path>`

**Primary — companion framework**
- `raw.githubusercontent.com/ek33450505/claude-agent-team/main/plugin/hooks/hooks.json` — full hook taxonomy across 18 lifecycle events (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `InstructionsLoaded`, `CwdChanged`, `FileChanged`, `PreCompact`, `PostCompact`, `Stop`, `StopFailure`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `TeammateIdle`)

**Secondary — reception research (all "no result" findings are recorded as such, not inferred)**
- HN Algolia search API — queries `claude-agent-team`, `claude-code-dashboard`: no matches referencing this author or CAST
- `https://dev.to/api/articles?username=edwardkubiak` — empty array; individual article URLs return 404
- `https://web.archive.org/web/20260410222824/https://dev.to/edwardkubiak` — snapshot preserving the seven deleted article titles and reaction counts
- `https://registry.npmjs.org/<name>` — 404 for all nine candidate package names; npm maintainer search returns `total: 0`
- `https://api.github.com/users/ek33450505` — author profile fields (location, company, followers)
- GitHub API star counts for the competitive table: `davila7/claude-code-templates`, `ccusage/ccusage`, `d-kimuson/claude-code-viewer`, `chiphuyen/sniffly`, `ColeMurray/claude-code-otel`, `NirDiamant/claude-watch`, `Stargx/claude-code-dashboard`

**Local comparison**
- `E:\AI-Dashboard\server\index.mjs`, `E:\AI-Dashboard\server\*.mjs`, `E:\AI-Dashboard\src\sections\`, `E:\AI-Dashboard\package.json`

**Note on fetched content.** Nothing in the fetched pages or source attempted to issue instructions to a reading agent. All marketing-style claims (feature counts, "WCAG AA", "exponential backoff", the MIT badge) were treated as claims to verify, not facts — discrepancies are recorded under "Value proposition" and "Gaps and weaknesses".
