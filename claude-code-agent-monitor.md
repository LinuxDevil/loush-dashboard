# Claude Code Agent Monitor (CCAM)

> Upstream research for porting ideas/code into Loush Dashboard (`LinuxDevil/AI-Dashboard`).
> Researched 2026-07-29 against commit `94bfddeeca902cd05617b8ff90716e1ebc15e374` (master, 2026-07-26), release `v1.4.6`.
> Method: full shallow clone + read of the actual source, plus GitHub API, HN Algolia, and web search. Every file path below was verified in the checkout.

---

## Identity

| Field | Value |
| --- | --- |
| Repo URL | https://github.com/hoangsonww/Claude-Code-Agent-Monitor |
| Landing page | https://hoangsonww.github.io/Claude-Code-Agent-Monitor/ |
| npm package name | `agent-dashboard` v1.4.6 (`private: true` — **not published to npm**) |
| Author | Son Nguyen (`hoangsonww`, `hoangson091104@gmail.com`; commits also as "David Nguyen" / "dav nguyxn") |
| License | **MIT** (exact SPDX: `MIT`). `LICENSE` text is verbatim standard MIT; copyright line reads `Copyright (c) 2026 - Now, Son Nguyen`. Every plugin under `plugins/*/.claude-plugin/plugin.json` and the VS Code extension also declare MIT. |
| Stars / Forks | 855 stars, 193 forks (GitHub API, 2026-07-29) |
| Open issues | 24 |
| Repo size | ~85 MB (~70 MB checked out; dominated by `images/`, `fonts/`, `wiki/`, and 3 committed `.vsix` binaries) |
| Default branch | `master` |
| Created | 2026-03-05 |
| Last push | 2026-07-28; last commit on master 2026-07-26 |
| Activity level | **Very high and sustained.** GitHub participation stats show ~8–74 commits/week for the last 21 consecutive weeks (recent weeks: 33, 36, 68, 64). 10 tagged releases from v1.0.0 (2026-03-05) to v1.4.6 (2026-07-27) — roughly one minor per month. |
| Bus factor | **1.** `hoangsonww` has 638 of ~672 contributions. Next contributors: `Doccy008` (9), `linkvapeluckyman` (6), `claude` (5), `CharlesSong` (5); 11 others with 1–2. |
| Primary language | TypeScript (client only). **Server is plain CommonJS JavaScript**, not TS. |
| Node requirement | `>=20.0.0` |
| Install method | `git clone` → `npm run setup` → `npm run install-hooks` → `npm run dev` / `npm start`. Also: Docker/Podman (`docker compose up`), prebuilt Electron desktop app (macOS `.dmg`, Windows NSIS + portable), devcontainer, Helm/Kustomize/Terraform for k8s. No `npm i -g` path (package is `private`), though `npm run link-cli` symlinks the `ccam` binary. |
| Platforms | macOS, Windows, Linux; containers; Kubernetes. Windows is second-class in one specific place — `server/lib/session-liveness.js` has no Windows probe implementation and returns `available: false`. |
| Files / LOC | 842 tracked files. `server/` ≈ 46k LOC (incl. tests), `client/` ≈ 78k LOC (incl. a 12.5k-line committed snapshot file). |

---

## The problem it solves

**In its own framing** (README, `ARCHITECTURE.md`): Claude Code runs agents and subagents that spawn, work, block, and finish invisibly in a terminal. CCAM describes itself as a real-time monitoring dashboard that hooks Claude Code's native hook system to give "instant visibility into sessions, tool usage, and subagent orchestration." The README's own security note is the sharpest statement of what it touches: the server "reads transcripts, exports all data, and can spawn `claude`" (`.env.example`, ~15 words).

**In plain terms:** it is an *ops console for your own agent fleet*. The pain it targets:

1. **You cannot see what a running agent is doing.** A subagent spawned in the background emits no visible output; you find out it failed when the parent finishes.
2. **You cannot see what it cost.** Claude Code does not surface per-session dollar spend against your own pricing assumptions.
3. **Subagent tool calls are invisible.** Claude Code fires no hooks for tools called *inside* a subagent — the data only exists in per-subagent JSONL files. CCAM backfills these by parsing the transcripts.
4. **Sessions get stuck in unknown states.** Escape-cancelled turns and Ctrl-C'd sessions emit no terminating hook, so naive trackers leave sessions "active" forever.
5. **Multi-machine work is fragmented.** If you drive Claude on a dev box over SSH and run the dashboard on a laptop, history lives in two places.

**Who the user is:** an individual power user (or a very small team) running many concurrent Claude Code sessions on their own machines, who wants live status, cost accountability, and post-hoc forensics. It is explicitly *not* a hosted team-analytics SaaS — it binds `127.0.0.1` by default and stores nothing off-machine.

---

## Value proposition

### Real, hard-to-get-elsewhere value

- **Hook-based *live* state, not just post-hoc log reading.** CCAM installs 8 Claude Code hook types (`PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `Notification`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`) via `scripts/install-hooks.js`, so the UI reflects tool-call granularity *while the agent is mid-turn*. Transcript-only tools (like ours) cannot see a `PreToolUse` before the tool returns.
- **A genuinely good fire-and-forget hook handler.** `scripts/hook-handler.js` (112 lines) writes the HTTP body and exits **without awaiting the response**. This is the fix for the "Claude Code hangs on running hooks" failure mode, and it fans out to every live dashboard discovered via a port-discovery file. This is the single most reusable idea in the repo.
- **Subagent tool attribution.** On every `SubagentStop`, `scanAndImportSubagents` (in `scripts/import-history.js`) parses `subagents/agent-*.jsonl`, pairs `tool_use` blocks to `tool_result` by `tool_use_id`, and synthesizes `PreToolUse`/`PostToolUse` events. This recovers data Claude Code never emits.
- **Incremental transcript reading.** `server/lib/transcript-cache.js` caches by `(mtimeMs, size)` and on growth reads only `[bytesRead, size)` in fixed chunks, splitting on `0x0A`. The README claims ~50× speedup on long sessions (unverified benchmark, but the mechanism is sound and the cache is bounded at 200 entries with tail-capped arrays).
- **A pricing engine with time-limited introductory rates.** `server/db.js` `DEFAULT_PRICING` + `applyIntroPricing()` + `server/routes/pricing.js:calculateCost(tokenRows, pricingRules, asOf)`. Usage on/before `intro_until` prices at the intro rate, after at standard — so historical cost stays correct across a price change. Tokens are bucketed by `(model, speed, inference_geo, service_tier)` in `server/lib/token-usage.js` because all four move the rate.
- **Watchdog recovery for lost hooks.** `server/routes/hooks.js` runs `watchdogCheck()` and `livenessReap()` on a 15 s timer, and `server/lib/session-liveness.js` shells out to `ps`/`lsof` to ask "is any live `claude` process in this cwd?" It is **fail-safe**: if it cannot get a trustworthy answer (Windows, containers, missing binaries, `DASHBOARD_LIVENESS_PROBE=0`) it returns `available: false` and the caller changes nothing. That design discipline is worth copying verbatim.
- **Remote SSH multi-machine mirroring.** `server/lib/remote-sync.js` scp-mirrors a remote `~/.claude/projects` into a sandboxed staging dir and runs it through the *same* importer, tagging rows with `sessions.source`. No secrets stored — auth defers to the host's SSH stack.
- **Zero third-party CDN requests.** Fonts self-hosted via `@fontsource`, ReDoc bundle served from `node_modules` not a CDN, Mermaid vendored into `wiki/`. Verified in `server/index.js` and `server/lib/redoc.js`.

### Marketing that outruns the substance — be skeptical

- **"855 stars" ≠ community traction.** Community discussion is essentially **nil**. The only HN submission (Algolia `objectID` 48019302, 2026-05-05, by `pramodbiligiri`) scored **1 point with 0 comments**. There are no blog posts, reviews, or Reddit threads I could find. Note: web search repeatedly surfaced HN item `47602986` ("Show HN: Real-time dashboard for Claude Code agent teams", 77 pts, 28 comments) as if it were this project — **it is not**; that is a different project ("Agents Observe") by user `simple10`. Do not cite it as evidence about CCAM.
- **The feature count is inflated by surface area, not depth.** 10 plugins × 53 skills × 30 slash commands sounds enormous, but each skill is a short markdown file that mostly `curl`s the local API. `plugins/ccam-analytics/bin/ccam-stats` is a bash script piping `jq`. This is breadth-as-marketing.
- **Documentation volume is not documentation quality.** `README.md` is 2,308 lines / 197 KB; `ARCHITECTURE.md` is 223 KB; there are 4 translated READMEs, a `wiki/`, a 366 KB generated `openapi.yaml`, and `llms.txt`. Much of it is generated or duplicated, and some is already stale (see Gaps).
- **"Real-time" is real, but the frontend has no caching layer at all.** Every page owns its own `useState` and refetches; `Dashboard.tsx` polls every 10 s *in addition to* the WebSocket. That's belt-and-braces, not sophistication.
- **The "11-section Workflows page" is the genuine crown jewel** and is undersold relative to the plugin marketplace. Only 6 of its 13 components actually use d3; the rest are hand-rolled SVG/divs.

**Net:** the value is concentrated in maybe 15 files of the ~842. Those 15 are excellent. The rest is a very large, very actively maintained, single-author surface area.

---

## Feature inventory

| Feature | What it does | Where in the code (file/dir) | Depends on |
| --- | --- | --- | --- |
| **Hook ingestion endpoint** | `POST /api/hooks/event`; single write path for all 8 hook types; upserts session+agent, writes event, extracts tokens, evaluates alerts, broadcasts | `server/routes/hooks.js` (1536 ln) | Express, SQLite, `websocket.js`, `lib/alerts.js`, `lib/workflow-ingest.js` |
| **Fire-and-forget hook handler** | Stdin JSON → HTTP POST to every live dashboard, exits without awaiting response; dedupes by data-dir | `scripts/hook-handler.js` (112 ln) | `server/lib/server-info.js` discovery file |
| **Hook installer** | Writes 8 hook entries into `~/.claude/settings.json` with absolute handler path; container-detection guard (issue #193) | `scripts/install-hooks.js` (179 ln) | `server/lib/claude-home.js` |
| **Server-port discovery** | Publishes live port to `~/.claude/.agent-dashboard.json` with PID liveness; lets handler find non-4820 servers | `server/lib/server-info.js` | fs |
| **SQLite persistence + migrations** | 12 tables, ~25 indexes, long inline `ALTER TABLE`/table-rebuild migration chain | `server/db.js` (1503 ln) | `better-sqlite3` (optionalDependency) |
| **Pure-JS SQLite fallback** | Runs when `better-sqlite3` native build fails | `server/compat-sqlite.js` | — |
| **Prepared-statement layer** | ~150 named prepared statements exported as `stmts` | `server/db.js` L1200–1500 | SQLite |
| **WebSocket broadcast** | `/ws`, 64 KB max payload, 30 s ping/pong heartbeat with `terminate()`, Host-allowlist + token check on upgrade | `server/websocket.js` (~120 ln) | `ws` |
| **Transcript cache (incremental JSONL)** | `(mtime,size)` cache key; incremental byte-range read; extracts tokens, compactions, API errors, turn durations, thinking counts, usage extras; LRU-bounded at 200 entries, arrays tail-capped | `server/lib/transcript-cache.js` (793 ln) | fs, `lib/token-usage.js` |
| **Token bucketing** | Normalizes `usage` into `(model, speed, inference_geo, service_tier)` buckets shared by live + import paths | `server/lib/token-usage.js` | — |
| **History importer** | Streams every `~/.claude/projects/**/**.jsonl` into sessions/agents/token_usage; `--dry-run`, `--project`, `--reconcile-tokens`; also exported as a module for startup auto-import | `scripts/import-history.js` (2734 ln) | `lib/transcript-cache.js`, `lib/claude-home.js` |
| **Subagent tool attribution** | Parses `subagents/agent-*.jsonl`, pairs `tool_use`↔`tool_result` by `tool_use_id`, synthesizes Pre/PostToolUse events | `scanAndImportSubagents` in `scripts/import-history.js` | JSONL |
| **Continuous project sync** | `fs.watch` + mtime cache + coalesced periodic sweep so projects created after startup appear | `startSessionSync` in `server/index.js` | fs |
| **Session watchdog** | 15 s timer; detects API errors at transcript tail, recovers Esc-cancelled turns, completes exited sessions | `watchdogCheck()` in `server/routes/hooks.js` L1182 | transcript cache |
| **Process liveness probe** | `ps`/`lsof` to find live `claude` processes + cwds; fail-safe `available:false` on Windows/containers | `server/lib/session-liveness.js` (116 ln) | `ps`, `lsof` |
| **Stale-session sweep** | Marks sessions abandoned after `DASHBOARD_STALE_MINUTES` (default 180) | `server/index.js` + `hooks.js` `STALE_MINUTES` | — |
| **Awaiting-input detection** | Regex on `Notification` payloads to distinguish "blocked on you" from "finished responding"; persists `awaiting_reason` | `WAITING_INPUT_PATTERN` in `server/routes/hooks.js` L36 | — |
| **Agent/session state machines** | Agent: `waiting ↔ working ↔ error` + `completed`; Session: `active(waiting flag) ↔ error` + `completed`/`abandoned` | `server/routes/hooks.js`, README L523–582 | — |
| **Auto session naming** | Derives a human session name from the first user message; `isAutoSessionName` / `applyFirstUserDescriptor` guard against clobbering renames | `server/routes/hooks.js` L196–300 | `extractFirstUserText` in transcript-cache |
| **Pricing engine** | 20 default model patterns with `%` wildcards; input/output/cache-read/cache-write-5m/1h/fast tiers; time-limited intro rates via `intro_until` | `server/db.js` `DEFAULT_PRICING` + `applyIntroPricing()`; `server/routes/pricing.js:calculateCost` | SQLite `LIKE` matching |
| **Daily cost rollup** | Per-day cost from daily token rows | `calculateDailyCosts` in `server/routes/pricing.js` L199 | pricing rules |
| **Compaction tracking** | Detects `/compact` from transcripts, creates compaction agents/events, periodic backfill scanner | `server/routes/hooks.js` + `transcript-cache.js` | JSONL |
| **Workflow-tool ingestion** | Parses on-disk run journals `workflows/wf_<runId>.json` + `subagents/workflows/<runId>/agent-*.jsonl` for fleets that emit **no hooks**; handles live (in-flight) and completed runs | `server/lib/workflow-ingest.js` (807 ln) | fs, `claude-home.js` |
| **Workflow API** | Orchestration/tool-flow/collaboration/effectiveness/patterns/delegation/error-propagation/concurrency/complexity/compaction datasets + runs + drill-in | `server/routes/workflows.js` (846 ln) | `workflows` table |
| **Alerts engine** | 4 rule types: `event_pattern` (with N-in-window), `inactivity`, `status_duration`, `token_threshold`; per-scope cooldown dedup; event-driven + periodic sweep | `server/lib/alerts.js` | SQLite `alert_rules`/`alert_events` |
| **Webhook registry** | 14 declarative providers (Slack, Discord, Teams/AdaptiveCard, Google Chat, Mattermost, Rocket.Chat, Telegram, PagerDuty, Opsgenie, Splunk On-Call, Zapier, Make, n8n, Pipedream) + generic JSON with optional HMAC | `server/lib/webhook-providers.js` (501 ln), `server/lib/webhooks.js` | `fetch` |
| **Webhook delivery log** | Persisted deliveries with pruning; secrets never returned to client | `server/db.js` `webhook_deliveries`, `server/routes/webhooks.js` | — |
| **Web Push (VAPID)** | Generates/loads VAPID keys, broadcasts to subscribers, prunes invalid subs; works with tab backgrounded | `server/lib/push.js`, `server/routes/push.js`, `client/src/lib/push.ts` | `web-push` |
| **Run Claude (spawn subprocess)** | Spawns `claude` from the browser; headless one-shot and multi-turn conversation (stdin stays open, follow-ups piped as stream-json); `--resume <id>` | `server/lib/run-spawner.js` (525 ln), `server/routes/run.js` | `cross-spawn` |
| **stream-json line parser** | Reassembles arbitrarily chunked stdout into NDJSON envelopes; malformed lines reported, never thrown | `server/lib/stream-json-parser.js` (40 ln) | — |
| **Run history persistence** | Mirrors every spawn/status transition to SQLite (in-memory handles are reaped after 5 min) | `server/lib/dashboard-runs.js`, `dashboard_runs` table | — |
| **Claude Config Explorer (read)** | Read-only discovery of skills, subagents, commands, output styles, plugins, marketplaces, MCP servers, hooks, settings, memory, keybindings, statusline, hook scripts | `server/lib/cc-discovery.js` (831 ln), `server/routes/cc-config.js` | fs |
| **Claude Config Explorer (write)** | Create/overwrite/delete on **low-risk text surfaces only** (skills, agents, commands, output styles, CLAUDE.md, per-project memory). Plugins/MCP/hooks/settings.json deliberately read-only to avoid races with the live CLI | `server/lib/cc-mutate.js` (535 ln) | fs |
| **Timestamped config backups** | Every write/delete first copies to `<root>/cc-config-backups/<type>/<name>.<ts>.bak` (whole tree for dirs); memory backups in a dotted subdir so Claude Code won't load them | `createBackup()` in `server/lib/cc-mutate.js` L194 | fs |
| **Config file watcher** | Recursive `~/.claude/` watch + `~/.claude.json`; debounced `cc_config_changed` broadcast | `server/lib/cc-watcher.js` | fs.watch |
| **Remote SSH sources** | scp-mirror remote `~/.claude/projects` (or `wsl.exe`+`tar` for WSL) into per-source staging, re-import via the same importer, tag `sessions.source`; background poller | `server/lib/remote-sync.js` (1129 ln), `server/routes/remote-sources.js` | ssh/scp, host `~/.ssh/config` |
| **Data scope filter** | `?sources=local,src_abc` narrows every aggregate; dynamic SQL only on the filtered path so the default costs nothing | `server/lib/source-filter.js`, `server/lib/scoped-stats.js` | SQLite |
| **Export / restore** | Full-dataset JSON export and idempotent non-destructive re-import (consolidate several machines into one DB) | `server/lib/data-transfer.js`, `server/routes/import.js` | — |
| **Safe archive extraction** | `.zip/.tar/.tar.gz/.tgz/.gz` upload import; every entry validated against path traversal; symlinks/devices/hardlinks skipped | `server/lib/archive.js` | `adm-zip`, `tar`, `multer` |
| **Update notifier** | Non-blocking `git fetch`, fork/branch-aware comparison to `origin|upstream/master|main|HEAD`; surfaces exact `git pull && npm run setup` command. **Never self-pulls.** | `server/lib/update-check.js`, `server/update-scheduler.js`, `client/src/components/UpdateNotifier.tsx` | git |
| **Prometheus metrics** | `GET /api/metrics` in text-exposition format | `server/routes/metrics.js` | — |
| **Grafana + Prometheus stack** | 4 auto-provisioned dashboards; **two independent install paths** — npm-native (downloads official binaries into `monitoring/.bin/`) and Docker | `monitoring/` (25 files) | Node 20+ or Docker |
| **OpenAPI + Swagger + ReDoc** | 82 paths / 100 operations, 19 tag groups; generated `openapi.yaml` (366 KB); Swagger UI at `/api/docs`, ReDoc at `/api/redoc` served from `node_modules` | `server/openapi.js` (2932 ln) + `server/openapi-extra/*` (6 files), `scripts/generate-openapi-yaml.js` | `swagger-ui-express`, `redoc`, `js-yaml` |
| **Security hardening** | Loopback-only bind by default, loopback CORS, Host-header allowlist (anti DNS-rebinding), optional bearer/`x-dashboard-token`/`?token=` gate on `/api/*` and WS upgrade (GHSA-gr74-4xfh-6jw9) | `server/lib/security.js`, `server/index.js` | — |
| **`ccam` CLI** | ~30 commands in 9 groups; **zero dependencies**; hand-rolled SGR colors honoring `NO_COLOR`/`FORCE_COLOR`; **offline handlers** that read SQLite directly when the server is down; interactive REPL with tab completion + persisted history where each line runs as a child process | `bin/ccam.js` (2391 ln) | node builtins only |
| **MCP server** | 29 `dashboard_*` tools across 7 domains; 3 transports (stdio / Streamable HTTP + legacy SSE / REPL); read-only by default with `MCP_DASHBOARD_ALLOW_MUTATIONS` and `MCP_DASHBOARD_ALLOW_DESTRUCTIVE` gates + `confirmation_token` for wipe; rejects non-local dashboard hosts at startup | `mcp/src/**` (40 files) | `@modelcontextprotocol/sdk`, `zod` |
| **Plugin marketplace** | 10 plugins / 53 skills / 13 agents / 30 slash commands / 3 hooks.json / 3 bash tools / 1 `.mcp.json` | `plugins/*`, `.claude-plugin/marketplace.json` | local API at :4820 |
| **Electron desktop app** | macOS `.dmg` + Windows NSIS/portable; embeds `server/index.js` **in-process** (no child, no IPC); **adopts an already-running healthy server** on the preferred port instead of double-binding; tray with live snapshot rows; open-at-login; recovers real shell `PATH` so `claude` is findable under launchd | `desktop/src/*.ts` (10 files, 2755 LOC) | Electron 35, `better-sqlite3` |
| **VS Code extension** | Activity-bar webview "Monitor Control Center" + 4 commands; plain JS, no build step | `vscode-extension/extension.js`, `sidebar.js` | vsce |
| **Statusline** | Python renderer: model, user, cwd (`~`-collapsed), git branch, color-coded context bar, token counts. **Always exits 0** so it can never block Claude Code | `statusline/statusline.py` (136 ln) | Python 3.6+ |
| **PWA (×3)** | Independent service workers + manifests for dashboard, landing page, and wiki; assets cache-first, HTML network-first | `client/public/sw.js`, `sw.js`, `wiki/sw.js` | — |
| — **Frontend** — | | | |
| **Dashboard page** | Monitor tab (6 stat cards, nested subagent tree auto-expanding parents of working children, activity feed sized by `ResizeObserver`) + Health tab (composite health ring: `0.4×success + 0.25×cacheHit + 0.25×(100−errRate) + 0.1×(100−heap%)`) | `client/src/pages/Dashboard.tsx` (1514 ln) | — |
| **Kanban board** | Agents view (4 columns) / Sessions view (5 columns), choice persisted, per-column client pagination | `client/src/pages/KanbanBoard.tsx` (531 ln) | — |
| **Sessions list** | Server-paginated (`limit`/`offset`), 300 ms-debounced server-side `q` across id/name/cwd, status + cwd filters, remote-source labels | `client/src/pages/Sessions.tsx` (538 ln) | `/api/sessions` |
| **Session detail** | 3 tabs (agents / conversation / timeline) lazily mounted then **kept alive via `hidden`** so switching never refetches | `client/src/pages/SessionDetail.tsx` (1172 ln) | — |
| **Activity feed** | Live event stream with **pause + buffered-event counter badge**, full filter set, batched pagination preserving page size, origin labels | `client/src/pages/ActivityFeed.tsx` (590 ln) | eventBus |
| **Analytics page** | 4 sub-tabs; all charts hand-written SVG in-file: GitHub-style `Heatmap`, `Sparkline`, `CostTrendLine`, `BarRow`, `DonutChart`, plus chart-shaped skeletons | `client/src/pages/Analytics.tsx` (1473 ln) | none (no d3) |
| **Workflows page** | 13 composed visualizations; DAG node click cross-filters the Sankey; scatter click drives drill-in; per-section "What / How to read / Why" popovers | `client/src/pages/Workflows.tsx` (606 ln) + `client/src/components/workflows/*` (13 files) | d3, d3-sankey |
| **Orchestration DAG** | Custom 5-layer layout (sessions → main → subagent → compaction → outcome) with structural edge fallbacks; d3 only for rendering; **tooltips written imperatively to `tipRef.current.style`** to bypass React re-render | `client/src/components/workflows/OrchestrationDAG.tsx` (1084 ln) | d3 |
| **Tool execution Sankey** | True `d3-sankey` with explicit handling for self-loops/duplicate node refs; `ResizeObserver`-responsive | `client/src/components/workflows/ToolExecutionFlow.tsx` (672 ln) | d3-sankey |
| **Collaboration network** | d3 force graph: `manyBody(-800)`, `forceCollide(r+30)`, weak `forceX/Y(0.03)`, draggable nodes | `client/src/components/workflows/AgentCollaborationNetwork.tsx` (644 ln) | d3 |
| **Model delegation flow** | Two-column layout, models bucketed into `opus/sonnet/haiku/other` families each with its own gradient | `client/src/components/workflows/ModelDelegationFlow.tsx` (538 ln) | d3 (DOM only) |
| **Other workflow charts** | Complexity scatter, compaction histogram (d3); concurrency timeline, error propagation, subagent effectiveness, patterns, stats, runs panel, drill-in (plain React/SVG) | `client/src/components/workflows/*.tsx` | — |
| **Conversation viewer** | Loads session/subagent JSONL; combines **three** freshness mechanisms — WS subscription + visibility-gated polling + manual refresh (because text-only turns fire no `PreToolUse` until `Stop`) | `client/src/components/conversation/ConversationView.tsx` (496 ln) | — |
| **Hand-written markdown renderer** | Fenced code, headings, lists, task lists, blockquotes, tables, inline formatting → **React element tree, no `dangerouslySetInnerHTML`** | `client/src/components/conversation/MarkdownContent.tsx` (514 ln) | none |
| **Hand-written syntax highlighter** | 9 tokenizers (JS/TS, Python, JSON, Shell, HTML/XML, CSS, SQL, YAML, Diff) on a shared regex-rule engine + identifier-refinement pass; ~30 language aliases; unknown language degrades to one `plain` token | `client/src/lib/highlight.ts` (1088 ln) | none |
| **TUI segment parser** | Parses Claude TUI tag markup in user messages (caveats, command invocations, stdout/stderr, system reminders) and strips leaked ANSI/SGR escapes | `client/src/components/conversation/tuiSegments.ts` (191 ln) | none |
| **Event title builder** | **Structural, not table-driven** — a new MCP server renders fine with no code change. Produces `Github · create pull request · Fix flaky test`, `Bash · git commit - …`, `Edit · src/App.tsx (all)` | `client/src/lib/event-grouping.ts` (852 ln) | none |
| **Agent origin breadcrumb** | Walks `parent_agent_id` to root → `main › coder › explorer`, cycle-guarded with a `seen` Set; drops a segment identical to its predecessor | `agentOriginLabel`/`buildOriginLabel` in `event-grouping.ts` | none |
| **Event summary panel** | `{icon, headline, bullets}` per event; `countHunks(structuredPatch)`, `firstEnclosingContext()` pulls the enclosing function from a hunk header; returns `null` when nothing useful exists | `client/src/lib/event-summary.ts` (663 ln) | none |
| **Per-tool event renderers** | Bash→Terminal+output, Edit→UnifiedDiff from `structuredPatch`, Read/Write→line-numbered code, Grep→match list, Glob→file list; unknown tools fall back to JSON | `client/src/components/event-views/tool-views.tsx` (469 ln) + `primitives.tsx` (458 ln) | none |
| **Locale-aware formatters** | `fmt` (1.5K/2.4M/1.2B, `NaN`→"0"), `fmtCost`, `timeAgo`, `formatDuration`, `shortModel` (`claude-opus-4-7-20260101`→`opus-4-7`), `formatModelName` with brand map | `client/src/lib/format.ts` (571 ln) | i18next `Intl` locale |
| **Event bus (global realtime store)** | 147-line singleton, `Set<Handler>`, synchronous in-order dispatch; consumed via `useSyncExternalStore` | `client/src/lib/eventBus.ts` | none |
| **WebSocket hook** | Duplicate-socket guard (StrictMode double-mount), handler-in-ref (no stale closures), capped backoff `min(500·2^n, 3000)`, instant reconnect on focus/online/visibilitychange, nulls handlers before `close()` | `client/src/hooks/useWebSocket.ts` (201 ln) | none |
| **Data-scope store** | `useSyncExternalStore` store, localStorage-persisted; `applyScope()` in `api.ts` injects `?sources=` into every scoped GET so scope changes narrow the whole app with no prop drilling | `client/src/lib/dataScope.ts` (188 ln) + `api.ts` | none |
| **Sidebar connection modal** | Stats in **refs not state** (avoids re-renders): event count, all-time peak/sec, 60-entry timestamp ring, per-type counts, last 8 events; hand-drawn SVG sparkline from `bucketEventsPerSecond`; persisted + resettable | `client/src/components/Sidebar.tsx` (1101 ln) | none |
| **Loading skeletons** | `Skeleton`, `StatValueSkeleton`, `TextSkeleton`, `TableRowSkeleton`, `CardSkeleton`; stated policy: never flash `-`/`0` a user could misread as data | `client/src/components/Skeleton.tsx` (170 ln) | Tailwind |
| **Custom form primitives** | `Select` (arrow nav, flips near viewport bottom), `Checkbox` (`role="checkbox"`), `ConfirmModal` (focus→Cancel, Tab trap, Escape, focus restore), `DateTimePicker`, `Tip` (cursor-following portal), `FieldHelp` | `client/src/components/*.tsx` | none |
| **i18n** | i18next + react-i18next + browser detector; 4 locales (en/zh/vi/ko) × 15 namespaces = 60 JSON files, statically bundled; `nonExplicitSupportedLngs` so `en-US`→`en`; parity test | `client/src/i18n/` | i18next |
| **Splash screen** | Once per tab (`sessionStorage`), time-aware greeting, random tagline pair, CSS-only constellation + animated hexagon brand mark; opaque from first paint | `client/src/components/SplashScreen.tsx` (467 ln) | none |
| **Tabby the cat mascot** | 8 moods derived from the live WS stream; **pure reducer** `reduceTabby(state,msg,now)` + `deriveMood(state,now)` (sleeps after 3 min, "stuck" after 10 min); injected `rand` for deterministic tests; AssistiveTouch-style drag via Pointer Capture snapping to the nearest edge, offset stored as a viewport **fraction**; local intent matcher with handoff to the Run page | `client/src/components/Tabby/` (11 files: `brain.ts` 409, `useTabbyPosition.ts` 212, `CatAvatar.tsx` 296, `tabby.css` 412, …) | eventBus only |
| **Dev-port orchestrator** | Probes **both IP families** for a free port (defeats the SSH `LocalForward` failure where Node's wildcard listen "succeeds" and every Vite proxy request `ECONNRESET`s) | `scripts/dev.js` (141 ln) | — |
| **Seed data** | Additive + idempotent by default (3 stable fixtures incl. a waiting-on-input session); `--full` random; `--reset` removes only fixtures. **Never deletes non-fixture data.** | `scripts/seed.js` (634 ln) | — |
| **Destructive wipe guard** | `--yes` required; `--backup` snapshots DB first; **no flags = dry run printing counts** | `scripts/clear-data.js` (135 ln) | — |
| **Self-dogfooded Claude config** | 6 path-scoped `.claude/rules/*`, 3 review subagents, 6 skills incl. a mandatory doc-sync skill with a `doc-map.md`; mirrored for Codex (`.codex/`, `AGENTS.md`) | `.claude/`, `.agents/`, `.codex/` | — |
| **Git hooks** | Husky pre-commit: Prettier staged files → re-stage → **full test suite with one retry**, commit aborted on failure; commitlint on `commit-msg` | `.husky/pre-commit`, `.githooks/commit-msg` | husky, commitlint |
| **Test suite** | 45 server test files, ~15 client test files incl. a committed 12.5k-line screen snapshot, 9 MCP test files, 1 desktop smoke test | `server/__tests__/`, `client/src/**/__tests__/`, `mcp/__tests__/` | `node --test`, vitest |
| **Deployment infra** | Helm chart (12 templates, 4 value sets), Kustomize base + 3 overlays + blue-green/canary strategies, Terraform (5 modules × aws/gcp/azure/oci), 7 bash ops scripts, GH Actions + GitLab CI | `deployments/` (~110 files) | — |

---

## UX and interaction design

**Layout.** Fixed left rail (`w-60` expanded / `w-[4.25rem]` collapsed, `transition-[width] duration-200`) with the main column offset by an inline `marginLeft` rather than a grid. Nine nav items with Lucide icons: Dashboard, Kanban, Sessions, Activity, Analytics, Workflows, CC Config, Run, Settings. Only the nav section scrolls, and **chevron up/down buttons appear when it overflows** so users don't hunt for a 6px scrollbar. Collapse state persists to `localStorage["sidebar-collapsed"]`. `Layout.tsx` uses `overflow-x-clip` rather than `hidden` specifically so descendant `position: sticky` still works — a small detail that shows real polish.

**Navigation model.** `react-router-dom` v6, one nested layout route, 11 routes, all eagerly imported (no code splitting). There is deliberately **no `/alerts` route** — alerts were folded into Settings as a tabbed Rules/Channels/Activity control center. Settings itself uses a sticky TOC over anchored sections (`#pricing`, `#hooks`, `#remote-sources`, `#tabby`, …).

**Information density.** High, and mostly earned. The Dashboard uses a `ResizeObserver` to compute how many agent/activity rows fit the viewport instead of a fixed count. `SessionDetail` packs six tile counters plus tool bars, subagent breakdown, a stacked token-flow strip and an event-type pill cloud above the fold. The Health tab renders a composite score ring with an explicit published weighting (`0.4×success + 0.25×cacheHit + 0.25×(100−err) + 0.1×(100−heap)`) — showing the formula rather than an opaque grade is the right call.

**Color/status semantics.** There is exactly one theme: dark. No `darkMode` config, no `dark:` variants, no CSS custom properties, no theme switcher. The design token set is 53 lines (`client/tailwind.config.js`): a `surface-0..5` ramp from `#06060a` to `#2a2a3d`, `border`/`border-light`, and indigo `accent` (`#6366f1`). Everything else is literal Tailwind palette utilities — emerald for success, red for error, amber for warning. Six component classes in `client/src/index.css` (`.card`, `.card-hover`, `.btn-primary`, `.btn-ghost`, `.badge`, `.input`) carry most of the visual identity. Status is conveyed by `StatusBadge.tsx`, which pulses for active states and nests a **"why waiting" chip** driven by the server's `awaiting_reason` (needs input / turn done / at prompt / interrupted) — this is the best small idea in the whole UI: it turns an ambiguous yellow dot into an actionable sentence.

**Empty states.** A shared `EmptyState` (`{icon, title, description, action}`) used in 8 places, plus bespoke inline empties in every workflow chart, `EmptyStream({isLive})` in Run, and a local `Empty()` in CcConfig. Charts never render an axis with no data.

**Loading.** `Skeleton.tsx` exports 5 variants used across 9 files, and `Analytics.tsx` adds chart-*shaped* skeletons (`ChartCardSkeleton`, `AnalyticsChartsSkeleton`) so the page never flashes an empty or zeroed chart. The file's stated policy — never flash `-` or `0` that a user could misread as real data — is **the same "honesty rule" Loush already has**, independently arrived at. `animate-pulse` honors `prefers-reduced-motion` natively.

**Real-time behavior.** Single WebSocket to `/ws`, published into a module-level `eventBus`, consumed by every page via `useSyncExternalStore`. Pages additionally poll (Dashboard every 10 s) and **deduplicate optimistic WS inserts by event id** to survive the WS-vs-poll race. `ActivityFeed` has a pause toggle with a badge counting buffered events while paused. Reconnect is instant on window focus / `online` / `visibilitychange`, with capped exponential backoff otherwise. The Sidebar footer opens a connection-stats modal with a live throughput sparkline, all-time peak events/sec, and the last 8 events — a genuinely nice "is this thing on?" affordance.

**Notifications.** Three layers: (1) Web Push via VAPID, server-relayed so it arrives with the tab backgrounded or the browser closed, falling back to `registration.showNotification` then bare `new Notification`; (2) in-app modals for updates; (3) toasts — but **only on the CcConfig page** (5 s auto-dismiss). Everywhere else errors are inline text. That inconsistency is a real gap. Preferences are read from localStorage **on every message**, so a Settings toggle takes effect instantly without a reload.

**Onboarding.** No tour, no wizard. There is a splash screen once per tab: a time-aware greeting (morning/afternoon/evening/"working late"), a randomly-chosen tagline+subtext pair, and a CSS-only animated hexagon node-graph over a constellation field. It holds 2.5 s then fades 600 ms, and clicking anywhere skips it. It is opaque from first paint so the app never flashes empty. Discoverability otherwise relies on per-chart `ChartInfoPopover`s ("What / How to read / Why") on the Workflows page and `FieldHelp` "(?)" popovers on dense settings forms — both good patterns.

**Keyboard.** Thin. Exactly one global chord: **⌘B / Ctrl+B** toggles Tabby. **⌘↵** submits in Run. The Run slash-command autocomplete supports ↑/↓/Enter/Tab/Escape with fuzzy subsequence matching. **Escape closes** consistently across ~10 modals and popovers. `ConfirmModal` does focus management properly (focus lands on *Cancel*, Tab is trapped, focus is restored on close). A skip-to-content link is the first focusable element in `Layout.tsx`. There is **no command palette and no `?` shortcut help** — a notable miss for a keyboard-heavy audience.

**Mobile.** Weak; this is desktop-first and honest about it in code if not in the README (which claims "Responsive Design ... mobile-friendly layouts"). Only ~96 responsive utility usages across 17 files, almost all grid-column counts. The sidebar is `fixed` with **no mobile drawer, no hamburger, and no breakpoint that hides it**, and `<main>` always carries a hard 15rem/4.25rem left margin. Charts scale via `ResizeObserver` + `viewBox`, but the shell does not reflow for phones. Treat the responsive claim as marketing.

**From screenshots** (`images/`, 38 PNGs — `dashboard.png`, `board.png`, `analytics.png`, `workflows.png`, `dynamicworkflows-*.png`, `session-conversation.png`, `tabby.png`, `macos.png`, `windows_app.png`, `statusline.png`, `grafana.png`, `swagger.png`, `redoc.png`, `setup_win_wizard*.png`): consistent near-black surfaces with indigo accents, card-based composition, generous chart real estate, and a visible mascot in the bottom-right. The workflow screenshots show the DAG and Sankey at full width with layer labels and separators — they read as legible, not decorative.

**What specifically feels good and why:**
1. The **"why waiting" chip** — converts status ambiguity into an action.
2. **Chart-shaped skeletons** — preserves layout and refuses to imply zero.
3. **Imperative tooltips on the DAG** (written straight to `style`) — hovering a 1000-node graph never triggers a React render.
4. **Tab state kept alive via `hidden`** in SessionDetail — switching tabs is free.
5. **Pause-with-buffer-count** on the activity feed — you can read without losing the stream.
6. **`applyScope()` in the API client** — one global scope control narrows every number in the app with zero prop drilling.

---

## Architecture

**Data sources (four, all local or SSH-local):**
1. Claude Code hook events (live, push) — the only true real-time source.
2. `~/.claude/projects/**/*.jsonl` main transcripts (tokens, compactions, API errors, turn durations, thinking counts).
3. `~/.claude/projects/<enc-cwd>/<sessionId>/subagents/agent-*.jsonl` (+ `.meta.json`) — subagent-internal tool calls that emit no hooks.
4. `.../workflows/wf_<runId>.json` run journals + `subagents/workflows/<runId>/agent-*.jsonl` — Workflow-tool fleets that emit no hooks.
Plus: `~/.claude/` config surfaces (read + limited write), and remote machines' `~/.claude/projects` mirrored over scp.

**Storage.** SQLite at `~/.claude/agent-dashboard/dashboard.db` (or `$DASHBOARD_DATA_DIR`). `better-sqlite3` is an **optionalDependency** with a pure-JS fallback in `server/compat-sqlite.js`, so a failed native build degrades rather than breaks. 12 tables: `sessions`, `agents`, `events`, `token_usage`, `model_pricing`, `workflows`, `alert_rules`, `alert_events`, `webhook_targets`, `webhook_deliveries`, `push_subscriptions`, `dashboard_runs`, `remote_sources`. Migrations are an imperative chain of guarded `ALTER TABLE` / table-rebuild blocks inline in `server/db.js` — no migration framework and no version table beyond ad-hoc probes.

**Transport.** WebSocket (`ws`) for server→client push only; the client never sends over WS. REST for everything client→server. **No SSE** except inside the MCP HTTP transport (legacy `/sse` + `/messages`). Client also polls on intervals as a safety net.

**Frontend state.** No react-query, no SWR, no redux, no zustand, no React Context. Two hand-rolled `useSyncExternalStore` stores (`eventBus.ts` for realtime, `dataScope.ts` for scope) plus per-page `useState` + `useEffect` + `useCallback`. **No response caching at all.**

**Build tooling.** Root is CommonJS (`"type": "commonjs"`) with no build step for the server. Client is Vite 6 + TypeScript (`tsc -b && vite build`) → `client/dist`, served statically by Express in production with a deliberate cache policy (hashed `/assets/` immutable; `index.html`/`sw.js`/`manifest.json` must-revalidate). Prettier + Husky + commitlint. Tests: `node --test` (server, MCP) and vitest (client).

```
                        ┌───────────────────────────────────────────┐
                        │            Claude Code CLI                │
                        └───────────────────────────────────────────┘
                             │ (8 hook types)          │ writes
                             ▼                         ▼
              scripts/hook-handler.js          ~/.claude/projects/**
              ── stdin JSON ──                   ├── <sess>.jsonl
              ── POST, DO NOT AWAIT ──           ├── subagents/agent-*.jsonl
              ── fan-out to every live ──        └── workflows/wf_<id>.json
                 dashboard via                              │
                 ~/.claude/.agent-dashboard.json            │
                             │                              │
                             │        ┌─────────────────────┼──────────────────────┐
                             │        │                     │                      │
                             ▼        ▼                     ▼                      ▼
                 ┌──────────────────────────┐   ┌────────────────────┐  ┌────────────────────┐
                 │ POST /api/hooks/event    │   │ transcript-cache   │  │ workflow-ingest    │
                 │ server/routes/hooks.js   │◀──│ incremental read   │  │ run journals +     │
                 │  • upsert session/agent  │   │ (mtime,size) cache │  │ inner-agent jsonl  │
                 │  • write event row       │   │ tokens/compaction/ │  └────────────────────┘
                 │  • extract tokens        │   │ APIError/duration  │             │
                 │  • evaluate alerts       │   └────────────────────┘             │
                 │  • ingest workflows      │             ▲                        │
                 └──────────────────────────┘             │                        │
                             │                            │                        │
        ┌────────────────────┼────────────────────────────┴────────────────────────┘
        │                    ▼
        │        ┌──────────────────────────────────────────┐
        │        │  SQLite  ~/.claude/agent-dashboard/*.db   │
        │        │  sessions agents events token_usage       │
        │        │  workflows alerts webhooks runs pricing   │
        │        └──────────────────────────────────────────┘
        │                    │                    ▲
        │                    │                    │  scripts/import-history.js
        │                    │                    │  (startup + rescan + upload
        │                    │                    │   + remote-sync via scp)
        │                    ▼                    │
        │        ┌────────────────────────┐  ┌──────────────────────┐
        │        │ REST  /api/* (82 paths)│  │ remote-sync.js (SSH) │
        │        │ + scoped-stats.js when │  │ mirrors peer machines│
        │        │   ?sources= is present │  └──────────────────────┘
        │        └────────────────────────┘
        │                    │
        ▼                    ▼
 ┌──────────────┐   ┌─────────────────────────────────────────────┐
 │ websocket.js │   │  React 18 + Vite client                     │
 │ broadcast()  │──▶│  useWebSocket ─▶ eventBus (useSyncExternal) │
 │ 30s ping     │   │  per-page useState + 10s poll + dedupe by id│
 └──────────────┘   │  dataScope ─▶ applyScope() ─▶ every GET     │
        │           └─────────────────────────────────────────────┘
        │
        ├──▶ watchdogCheck() / livenessReap()  every 15s  (ps/lsof, fail-safe)
        ├──▶ alerts sweep ─▶ webhook-providers ─▶ Slack/Discord/PagerDuty/…
        ├──▶ web-push (VAPID) ─▶ browser, even when backgrounded
        ├──▶ GET /api/metrics ─▶ Prometheus ─▶ Grafana (4 dashboards)
        └──▶ run-spawner.js ─▶ spawn `claude` ─▶ stream-json ─▶ WS ─▶ Run page
```

---

## Notable code worth stealing

Ported into **React 18 + Express, plain ESM, no TypeScript**. "Easy" = mostly mechanical (strip types / `require`→`import`). "Medium" = needs adaptation to our data model. "Hard" = needs infrastructure we don't have.

| # | File | What it does | Why it is good | Port difficulty |
| --- | --- | --- | --- | --- |
| 1 | `scripts/hook-handler.js` (112 ln) | Reads hook JSON on stdin, POSTs to every live dashboard, **exits without awaiting the response**; dedupes by data-dir; fails silently | This is the difference between hooks that are free and hooks that make Claude Code visibly hang. Also the port-discovery-file pattern is clean | **Easy** — zero deps, CommonJS→ESM is trivial. We have no hook receiver yet, so pair with #2 |
| 2 | `scripts/install-hooks.js` (179 ln) | Idempotently writes 8 hook entries into `~/.claude/settings.json`; refuses to install from inside a container onto a bind-mounted host `~/.claude` | We already write config with backups; this is the exact shape of the hook-install we'd need, container guard included | **Easy/Medium** — must reconcile with our existing Setup/Hooks writer and backup convention |
| 3 | `client/src/lib/event-grouping.ts` (852 ln) | Turns raw hook/transcript events into human row titles. **Structural, not table-driven** — new MCP servers/CLIs render fine with no code change. `humanizeMcpServer` collapses consecutive duplicate tokens (`github_github`→`Github`) and preserves camel case (`GitLab`). `parseShellHeadline` uses a `SUBCOMMAND_BINARIES` set so you get `git commit`, not `git` | The single highest value-per-line file in the repo. Zero dependencies (imports one type). Directly upgrades our Sessions/ActivityTimeline/Forensics rows | **Easy** — delete type annotations, done |
| 4 | `client/src/lib/event-summary.ts` (663 ln) | `{icon, headline, bullets}` per event. `countHunks(structuredPatch)` → `{hunks, added, removed}`; `firstEnclosingContext()` extracts the enclosing function/class from a hunk header. **Returns `null` when nothing useful exists** | The `null`-not-fake-summary behavior is exactly our honesty rule. `firstEnclosingContext` is a free upgrade to WorkingSet's per-edit display | **Easy** |
| 5 | `client/src/lib/highlight.ts` (1088 ln) | Complete from-scratch syntax highlighter: 9 tokenizers on a shared regex-rule engine + an identifier-refinement pass; ~30 language aliases; unknown language → one `plain` token so it never throws | Zero dependencies, ~35 KB, no Prism/Shiki/highlight.js. Emits tokens + Tailwind classes, so it works with any styling. Includes diff add/del tinting | **Easy** — self-contained. Would let us render code in Forensics/WorkingSet/Chat without adding a dep |
| 6 | `client/src/lib/eventBus.ts` (147) + `client/src/hooks/useWebSocket.ts` (201) | Module-level pub/sub + the socket hook. Duplicate-socket guard for React 18 StrictMode double-mount, handler-in-ref (no stale closures), capped backoff `min(500·2^n, 3000)`, instant reconnect on focus/online/visibilitychange, nulls handlers before `close()` | **We have no websockets today.** This is a complete, battle-tested 350-line answer with every real-world footgun already handled. The StrictMode guard alone saves a day | **Easy** — this is the highest-leverage single adoption |
| 7 | `server/lib/transcript-cache.js` (793 ln) | `(mtimeMs, size)` cache key; on growth reads only `[bytesRead, size)` in chunks splitting on `0x0A`; handles truncation and same-size-different-mtime (compaction rewrite); LRU-bounded at 200 entries; arrays tail-capped with a 2× watermark; 64 MB single-line hard cap | We re-read whole JSONL files today. This is the direct fix, and the correctness cases (truncation, rewrite, unbounded arrays) are ones we'd hit and get wrong | **Medium** — CJS→ESM plus adapting the extractor to what our sections need. The caching skeleton ports as-is |
| 8 | `server/lib/session-liveness.js` (116 ln) | `ps`/`lsof` probe for live `claude` processes and their cwds. **Fail-safe:** Windows / containers / missing binaries / env kill-switch all return `available:false` and the caller must change nothing | The design discipline is the point: never let an unavailable probe be read as a negative answer. This is our "null is never 0" rule applied to process state | **Easy/Medium** — needs a Windows implementation to be useful to us at all (upstream has none) |
| 9 | `server/lib/cc-mutate.js` `createBackup()` (L152–210) | Timestamped backup before **every** write/delete: `<root>/cc-config-backups/<type>/<name>.<ts>.bak`, whole-tree copy for dirs. Memory backups go in a **dotted subdir** so Claude Code won't load `.bak` files as memory | We already do timestamped backups; the dotted-subdir trick (keeping backups inert to the tool that reads the dir) is a bug we probably have | **Easy** — a 60-line convention to adopt into our config writers |
| 10 | `server/lib/webhook-providers.js` (501 ln) | 14 providers described **declaratively**: label, family, credential fields, URL resolution, auth headers, payload formatter. The client renders the whole settings form from `GET /api/webhooks/providers` | Adding a provider is a data change with **zero UI change**. Secrets are never returned to the client — URLs are masked and re-entered | **Medium** — clean pattern, but we need an alerts/notification concept first (Inbox/Reliability) |
| 11 | `server/lib/alerts.js` | 4 rule types (`event_pattern` with N-in-window, `inactivity`, `status_duration`, `token_threshold`); event-driven + periodic sweep; per-scope cooldown dedup | The cooldown-dedup-per-scope design is the part people get wrong. Feeds Inbox/Reliability | **Medium** |
| 12 | `client/src/lib/dataScope.ts` (188 ln) + `applyScope()` in `api.ts` | A ~90-line `useSyncExternalStore` store, localStorage-persisted, whose value is auto-injected as `?sources=` into every scoped GET | A global filter that narrows every number in the app with no prop drilling. Maps perfectly onto a Loush "which project/repo am I looking at" scope | **Easy** |
| 13 | `client/src/components/conversation/MarkdownContent.tsx` (514) + `tuiSegments.ts` (191) | Markdown → **React element tree**, never `dangerouslySetInnerHTML`. `tuiSegments` parses Claude TUI tag markup (caveats, command invocations, captured stdout/stderr, system reminders) and strips leaked ANSI escapes | We use `marked` + presumably `innerHTML`. This removes an XSS surface on content we don't control. `tuiSegments` solves a problem we definitely have in Chat/Forensics | **Medium** — swapping our `marked` usage touches several sections |
| 14 | `client/src/components/event-views/tool-views.tsx` (469) + `primitives.tsx` (458) | Per-tool renderers: Bash→terminal+output, Edit→unified diff from `structuredPatch`, Read/Write→line-numbered code, Grep→match list, Glob→file list; unknown tools degrade to JSON | Turns an event log into something readable. The unknown-tool fallback means it never breaks on new tools | **Medium** — needs our own event shape wired in; the primitives port cleanly |
| 15 | `server/lib/token-usage.js` + `DEFAULT_PRICING`/`applyIntroPricing()` in `server/db.js` + `calculateCost()` in `server/routes/pricing.js` | Bucket tokens by `(model, speed, inference_geo, service_tier)`; wildcard pattern pricing; **time-limited intro rates** so historical cost stays correct across a price change | Our UsagePanel almost certainly prices at today's rate. `asOf`-correct pricing is a real correctness win, and the bucketing dimensions are non-obvious | **Medium** — the table + calc port easily; reconciling with our existing usage math is the work |
| 16 | `server/websocket.js` (~120 ln) | `ws` server on `/ws`, 64 KB max payload, 30 s ping/pong with `terminate()` on miss, Host-allowlist + token check **on the upgrade** (Express middleware doesn't run there) | The "middleware doesn't run on WS upgrades" gotcha is exactly the bug we'd ship. Pairs with #6 | **Easy** |
| 17 | `client/src/components/workflows/ToolExecutionFlow.tsx` (672 ln) | True `d3-sankey` with explicit handling for self-loops and duplicate node refs (which d3-sankey silently collapses); `ResizeObserver`-responsive | We already use d3. Tool→tool transition flow is a Flow/Insights feature we don't have. The self-loop handling is the non-obvious part | **Medium** — add `d3-sankey`, strip types |
| 18 | `client/src/components/workflows/OrchestrationDAG.tsx` (1084 ln) | Custom 5-layer DAG layout with structural edge fallbacks; **imperative tooltips written to `tipRef.current.style`** so hover never re-renders the chart | Directly applicable to our PlanGraph. The imperative-tooltip trick is a general d3+React performance pattern worth adopting everywhere | **Medium/Hard** — 1084 lines and tightly coupled to their node taxonomy; steal the layout + tooltip patterns, not the file |
| 19 | `client/src/components/Skeleton.tsx` (170) + `ChartCardSkeleton` in `Analytics.tsx` | 5 skeleton variants; chart-*shaped* skeletons so a loading chart never looks like a zeroed chart | This is our honesty rule extended from values to charts — a gap we probably have | **Easy** |
| 20 | `client/src/components/StatusBadge.tsx` (178 ln) | Agent/session badges with a nested **"why waiting" chip** from `awaiting_reason` (needs input / turn done / at prompt / interrupted) | Turns an ambiguous status dot into an actionable statement. Best small UX idea in the repo | **Easy** (component) / **Medium** (we'd need to derive `awaiting_reason`, which requires hook events) |
| 21 | `client/src/lib/format.ts` (571 ln) | `fmt` (`NaN`/`Infinity`→"0", <1000 verbatim, negatives unabbreviated), `fmtCost`, `timeAgo`, `shortModel` (`claude-opus-4-7-20260101`→`opus-4-7`), `formatModelName` with a brand map | The edge cases are all already handled. `formatModelName` alone is worth taking | **Easy** |
| 22 | `server/lib/archive.js` | `.zip/.tar/.tar.gz/.tgz/.gz` extraction with every entry validated against traversal; symlinks/devices/hardlinks **skipped, not extracted** | If we ever accept an upload, this is the correct implementation and we would otherwise get it wrong | **Easy** |
| 23 | `server/lib/security.js` + `hostGuard`/`tokenGuard` in `server/index.js` | Loopback bind default, loopback CORS, **Host-header allowlist (anti DNS-rebinding)**, optional token on `/api/*` and WS upgrade | Written in response to a real CVE (GHSA-gr74-4xfh-6jw9). Our Express server has the same exposure profile — reads transcripts, writes config | **Easy** — and arguably we should do this regardless of anything else here |
| 24 | `bin/ccam.js` (2391 ln) | Zero-dependency CLI; `COMMAND_GROUPS` is the single source of truth for help, REPL help, tab completion, and unknown-command detection; **offline handlers read SQLite directly when the server is down**; REPL runs each line as a child process so a crash can't kill the shell | The one-array-drives-everything pattern and the offline-degradation idea are both excellent. We have no CLI | **Medium** — the patterns port; the 2391 lines don't |
| 25 | `client/src/components/Tabby/brain.ts` (409) + `quips.ts` + `intents.ts` | Pure framework-free mood reducer `reduceTabby(state, msg, now)` + `deriveMood(state, now)`; `pickQuip(key, rand = Math.random)` with **injected randomness for deterministic tests** | Regardless of whether we want a cat, this is a textbook "pure core, imperative shell" split, and the injected-`rand` testability trick is free | **Medium** — the pattern is Easy; the mascot is a product decision |
| 26 | `scripts/dev.js` (141 ln) | Probes **both IP families** for a free port before starting, defeating the SSH `LocalForward` case where Node's wildcard listen "succeeds" but every proxy request `ECONNRESET`s | An obscure bug that costs an afternoon when you hit it | **Easy** |
| 27 | `statusline/statusline.py` (136 ln) | Claude Code statusline: model, user, cwd, git branch, color-coded context bar, tokens. **Always exits 0** so it can never block Claude Code | Small, useful, and the exit-0 discipline is the whole trick. (Note the shipped wrapper has a hardcoded personal path — see Gaps) | **Easy** — or rewrite in Node in ~80 lines |
| 28 | `server/lib/scoped-stats.js` | Source-scoped variants of every aggregate, built dynamically **only on the filtered path** so the unscoped default keeps using prepared statements and pays nothing | The "don't tax the common case for a rare feature" instinct is good architecture | **Medium** |
| 29 | `server/lib/workflow-ingest.js` (807 ln) | Ingests Workflow-tool fleets from on-disk run journals + inner-agent transcripts — agents that emit **no hooks at all** | Only relevant if we start tracking Workflow-tool runs, but it's the only implementation of this I've seen | **Hard** — deeply coupled to Claude Code's on-disk workflow layout |
| 30 | `server/lib/remote-sync.js` (1129 ln) | scp-mirror remote `~/.claude/projects` into sandboxed staging, re-import through the same importer, tag `sessions.source`; WSL path via `wsl.exe`+`tar`; no secrets stored | Multi-machine is a genuine gap for us too, and reusing one importer for both paths is the right design | **Hard** — 1129 lines, lots of SSH edge cases, and needs `sessions.source` plumbed through everything |

---

## Gaps and weaknesses

**Where Loush is better**
- **Repo-grounded analysis.** CCAM reads transcripts and Claude config. It never opens the *repository* — no import graph, no blast radius, no test-coverage join, no rework ranking. Our WorkingSet has no analogue upstream, and it is the harder half of the problem.
- **Delivery-system integration.** No JIRA, no GitHub, no CI. `DeliverySection`/`TicketSection` have no counterpart.
- **Prompt engineering surfaces.** No PromptStudio, PromptQuality, Library, CapabilityLedger, TeamBaseline, Governance equivalents.
- **Zero build step for the server.** Ours is plain ESM you can edit and run. CCAM's client requires `tsc -b && vite build`, and the desktop/MCP workspaces add native `better-sqlite3` and a TS build.
- **Derived-state honesty.** CCAM's numbers come out of SQLite, which is a *derived* store built by an importer with its own bugs. Our numbers come from the files on every read. When CCAM's importer is wrong, the dashboard is confidently wrong; there is no `--verify` mode, only `--reconcile-tokens`.

**What it does not do**
- No repository/code analysis of any kind.
- No mobile layout (the sidebar is unconditionally `fixed` with a hard main-column margin; the README's "Responsive Design" claim is not supported by the CSS).
- No light theme, no theming at all.
- No command palette, no `?` shortcut help; one global keyboard chord total.
- No code splitting — all 11 routes eagerly imported, so first paint carries the whole app (incl. d3, d3-sankey, and all 60 i18n JSON files statically bundled).
- No client-side response caching — every page refetches on mount and polls.
- Toasts exist on exactly one page; everywhere else errors are inline text.
- No multi-user/auth model beyond a single shared `DASHBOARD_TOKEN`.
- No `/alerts` route despite alerts being a headline feature (folded into Settings).

**Technical debt (verified in the checkout)**
- **Bus factor 1** — 638 of ~672 contributions from one person.
- **`statusline/statusline-command.sh` ships a hardcoded personal path**: it invokes `python3 "C:/Users/nguyens6/.claude/statusline.py"`. Broken for every user until edited; an inline comment acknowledges it.
- **Stale generated doc-comments.** `scripts/expand-ts-module-docs.py` injected ~60-line `MODULE_GUIDE` blocks into most TS files, embedding the author's absolute macOS paths (`/Users/davidnguyen/WebstormProjects/...`). Real code often starts around line 55–110. This is noise in every file you'd want to port.
- **Broken Helm chart metadata** — `deployments/helm/agent-monitor/Chart.yaml` `home`/`sources`/`icon`/maintainer point at `github.com/davidnguyen/...`, not the real repo.
- **`CITATION.cff` says `version: "1.1.0"`** while `package.json` says 1.4.6.
- **MCP tool-count drift** — `mcp/src/tools/index.ts` documents 29 tools; the `TOOL_DOMAINS` map in `mcp/src/index.ts` lists only 26, so the three remote-source tools fall through to `domain: "unknown"` in REPL mode. The README says "25 tools." Three different numbers.
- **MCP registration is duplicated by hand** — `mcp/src/transports/tool-collector.ts` independently re-implements the registrations for REPL mode and, per its own comment, "must be kept in sync by hand."
- **`server/openapi.js` is 2932 lines** of hand-maintained spec plus six `openapi-extra/*` override files (another ~7900 lines) — ~11k lines of API description maintained separately from the routes. Guaranteed to drift.
- **Migrations are an imperative `ALTER TABLE` chain** inline in `db.js` with try/catch probes and full table rebuilds — no framework, no version table, no down-migrations.
- **A committed 12,560-line Vitest snapshot** (`client/src/pages/__tests__/__snapshots__/screens.snapshot.test.tsx.snap`) will churn on every UI change.
- **Committed binaries** — three `.vsix` files in `vscode-extension/`, ~38 PNGs, 11 WOFF2 fonts, a vendored `mermaid.min.js`. This is why a 842-file repo is 85 MB.
- **A leftover session artifact** is committed: `.superpowers/brainstorm/1542-1774533799/` including a `state/server.pid`.
- **Windows liveness probe is missing entirely** — `session-liveness.js` returns `available:false` on Windows, so a whole class of stuck-session recovery silently doesn't work there.

**Scaling limits**
- Single-file SQLite with `better-sqlite3` (synchronous). Fine for one user; the 15 s watchdog + 30 s session sync + remote pollers all contend on the same handle.
- `scripts/import-history.js` is 2734 lines and re-walks the project tree; startup import on a large `~/.claude` is a cold-start cost.
- The transcript cache is bounded at 200 entries — beyond that you thrash back to full reads.
- Every page refetches with no cache; the Dashboard polls every 10 s regardless of WS health.
- Alert rules are loaded and evaluated per-event in-process; no queue, no backpressure.
- Prometheus metrics are exposed but the app itself has no internal tracing or slow-query visibility.

**Ecosystem reality check.** 855 stars with 193 forks is a healthy-looking ratio, but there is no discussion trail: 1 HN point / 0 comments, no blog posts, no reviews found. Open issues are mostly the author's own roadmap items filed on day one (#2, #4–#10 all dated 2026-03-05). Treat it as one very productive person's tool that got starred, not as a project with a user community you can lean on.

---

## Overlap with Loush Dashboard

| Their feature | Our equivalent section (or NONE) | Who does it better | Note |
| --- | --- | --- | --- |
| Live hook-event ingestion (8 hook types) | **NONE** (`HooksSection` inspects hooks, doesn't receive them) | **Them, decisively** | We are transcript-only, so we can never show mid-turn state. Biggest capability gap. |
| WebSocket push + reconnect | **NONE** (no websockets today) | **Them** | `useWebSocket.ts` + `eventBus.ts` = ~350 lines that close this entirely. |
| Session list / detail | `SessionsSection`, `ActivityTimeline` | Roughly even | They have server pagination + debounced server-side search; we join to repos. |
| Event timeline with per-tool renderers | `ActivityTimeline`, `ForensicsSection` | **Them** on rendering | Their `tool-views.tsx` + `event-grouping.ts` are better than generic rows. |
| Conversation/transcript viewer | `ChatSection`, `ForensicsSection` | **Them** | Hand-rolled markdown (no `innerHTML`), TUI-tag parsing, ANSI stripping, collapsible tool blocks. |
| Syntax highlighting | (via CodeMirror) | Even, different trade-off | CodeMirror is heavier but editable; their `highlight.ts` is 35 KB read-only with zero deps. |
| Subagent hierarchy tree | `SessionsSection`, `PlanGraph` | **Them** | Auto-expands ancestors of a working subagent; cycle-guarded breadcrumb walk. |
| Subagent tool attribution from JSONL | **NONE** | **Them** | Recovers tool calls Claude Code never emits hooks for. Pure transcript work — we *could* do this. |
| Kanban status board | `BoardSection` | Unclear — need to compare | Theirs is agent/session status only, no work items. |
| Cost / token analytics | `UsagePanel`, `ResourceSection` | **Them on pricing correctness** | Time-limited intro rates + `(model,speed,geo,tier)` bucketing. We likely price at today's rate. |
| Activity heatmap / trends | `InsightsSection`, `UsagePanel` | Even | Theirs is hand-written SVG, no dep. |
| Orchestration DAG | `PlanGraph` | **Them** | 5-layer layout + imperative tooltips. Ours is d3 already, so this ports. |
| Tool-transition Sankey | **NONE** | **Them** | We have d3; `d3-sankey` is one dep away. Would land in `FlowSection`/`InsightsSection`. |
| Agent collaboration force graph | **NONE** | **Them** | |
| Error propagation / concurrency timeline | `ReliabilitySection`, `BugsSection` | Unclear | Theirs is derived from workflow data we don't collect. |
| Workflow-tool fleet ingestion | `FlowSection`, `RunsSection` | **Them** | Only implementation of this I've seen. Hard to port. |
| Claude config explorer (read) | `SetupSection`, `HooksSection`, `McpSection`, `LibrarySection`, `CapabilityLedger` | **Us** — we have this spread across 5 focused sections | Theirs is one 3687-line page with 12 tabs. Ours is better factored. |
| Claude config mutation + backups | `SetupSection`, `CustomizeSection` | Even | We already do timestamped backups. **Steal their dotted-subdir trick** so `.bak` files stay inert. |
| Alerts engine | `InboxSection`, `ReliabilitySection` | **Them** | 4 rule types with per-scope cooldown dedup; we have no rule engine. |
| Webhook fan-out (14 providers) | **NONE** | **Them** | Declarative registry — adding a provider needs no UI change. |
| Web Push notifications | **NONE** | **Them** | Works with the tab closed. |
| Spawn/resume Claude from the UI | `ChatSection`, `RunsSection`, `QuickActions` | Unclear — need to compare | Their stream-json line parser is 40 clean lines regardless. |
| Repo/code analysis (imports, blast radius, coverage, rework) | `WorkingSet` (flagship), `QualitySection` | **Us, decisively** | They have literally nothing here. |
| JIRA / GitHub / CI delivery | `DeliverySection`, `TicketSection` | **Us** | Nothing upstream. |
| Prompt engineering / quality | `PromptStudio`, `PromptQuality`, `Library` | **Us** | Nothing upstream. |
| Governance / capability ledger / team baseline | `GovernanceSection`, `CapabilityLedger`, `TeamBaseline` | **Us** | Nothing upstream. |
| Multi-machine (SSH) history | `ProjectsSection`, `ProjectHub` | **Them** | We are single-machine. |
| Global data-scope filter | `ProjectHub`, `CustomizeSection` | **Them** on mechanism | `applyScope()` auto-injecting into every GET is cleaner than prop drilling. |
| Prometheus metrics + Grafana | **NONE** | **Them** | Probably out of scope for local-first, zero-telemetry. |
| MCP server exposing the dashboard | `McpSection` (we *inspect* MCP) | **Them** | Different thing: they let an agent query the dashboard. |
| CLI (`ccam`) | **NONE** | **Them** | Zero-dep, with offline SQLite fallback. |
| Desktop app / VS Code extension / statusline | **NONE** | **Them** | Distribution surface we don't have. |
| i18n (4 locales) | **NONE** (English only) | **Them** | 60 JSON files, statically bundled. |
| Loading skeletons / never-render-fake-zero | (our "honesty rules") | Even — **independently converged** | They extend it to chart-shaped skeletons; worth matching. |
| Security hardening (loopback, Host allowlist, token) | Unverified in our repo | **Them** | Written after a real CVE. We have the same exposure profile. |
| Persistence model | SQLite derived store | **Us for honesty, them for speed** | Their numbers can be confidently wrong if the importer is; ours are recomputed. Their transcript cache is the way to get speed without giving that up. |

---

## Recommended adoptions

Ranked by (value × confidence) ÷ effort. Effort: **S** ≈ ≤1 day, **M** ≈ 2–5 days, **L** ≈ >1 week.

1. **WebSocket transport + event bus** — **S**
   Take `client/src/hooks/useWebSocket.ts` + `client/src/lib/eventBus.ts` + `server/websocket.js` almost verbatim (strip types, CJS→ESM).
   *Lands in:* new `src/lib/eventBus.js`, `src/hooks/useWebSocket.js`, `server/websocket.mjs`, wired in `server/index.mjs` and `src/App.jsx`.
   *Unlocks:* live updates everywhere without polling; prerequisite for #2, #6, #9. The StrictMode duplicate-socket guard and the focus/online/visibilitychange reconnect are the parts we'd otherwise get wrong.

2. **Hook receiver + fire-and-forget hook handler** — **M**
   Port `scripts/hook-handler.js`, `scripts/install-hooks.js`, and a slimmed `POST /api/hooks/event`. Keep our backup convention on the `settings.json` write.
   *Lands in:* new `server/hooks.mjs`, `scripts/hook-handler.mjs`, plus `SetupSection`/`HooksSection` for install/status UI.
   *Unlocks:* **the single biggest capability gap** — mid-turn visibility. Today we can only ever show what already finished. Also gives us `awaiting_reason`, which powers #7.

3. **Event title + summary + per-tool renderers** — **S/M**
   `event-grouping.ts` and `event-summary.ts` are Easy (S). `tool-views.tsx` + `primitives.tsx` are M because they need our event shape.
   *Lands in:* `src/lib/eventGrouping.js`, `src/lib/eventSummary.js`, `src/components/eventViews/`; consumed by `ActivityTimeline`, `SessionsSection`, `ForensicsSection`.
   *Unlocks:* raw JSONL rows become readable. `firstEnclosingContext()` (enclosing function from a diff hunk header) is a direct upgrade to WorkingSet's per-edit display. Highest value-per-line in the whole upstream repo.

4. **Incremental transcript cache** — **M**
   Port `server/lib/transcript-cache.js`'s caching skeleton: `(mtime,size)` key, byte-range incremental read, truncation + same-size-different-mtime handling, LRU bound, tail-capped arrays.
   *Lands in:* new `server/transcriptCache.mjs`, used by every section that reads `~/.claude/projects`.
   *Unlocks:* keeps our "recompute from files every read" honesty rule while removing its cost. This is how we scale to large histories without adopting a derived store.

5. **Security hardening** — **S**
   `server/lib/security.js` + `hostGuard`/`tokenGuard`: loopback bind default, loopback-only CORS, Host-header allowlist (anti DNS-rebinding), optional token on `/api/*` and the WS upgrade.
   *Lands in:* `server/index.mjs` + new `server/security.mjs`.
   *Unlocks:* closes the same exposure they had a CVE for. Our server reads transcripts and writes config — same profile. Do this regardless of everything else.

6. **Alerts engine + webhook registry** — **M/L**
   `server/lib/alerts.js` (4 rule types, per-scope cooldown dedup) then `server/lib/webhook-providers.js` (declarative, 14 providers).
   *Lands in:* `server/alerts.mjs`, `server/webhooks.mjs`; UI in `InboxSection` (feed) + `ReliabilitySection` (rules) + `CustomizeSection` (channels).
   *Unlocks:* Inbox stops being a passive list. Note the declarative registry means new providers are a data change with no UI work.

7. **Status semantics: the "why waiting" chip + chart-shaped skeletons** — **S**
   `StatusBadge.tsx`'s nested reason chip and `Skeleton.tsx` + `ChartCardSkeleton`.
   *Lands in:* `src/components/` shared primitives, used across Sessions/Board/Overview/Runs.
   *Unlocks:* status becomes actionable rather than ambiguous, and our honesty rule extends from values to charts. The reason chip depends on #2 for real data — until then, derive what we can from transcripts and render `null` (not "unknown") otherwise.

8. **Global data-scope store** — **S**
   `client/src/lib/dataScope.ts` + the `applyScope()` auto-injection in `api.ts`.
   *Lands in:* `src/lib/dataScope.js` + our fetch wrapper; surfaced in `ProjectHub`/`CustomizeSection`.
   *Unlocks:* one control narrows every number in the app with zero prop drilling — directly useful for "which repo/project am I looking at."

9. **Pricing correctness: token bucketing + time-limited rates** — **M**
   `server/lib/token-usage.js` bucketing by `(model, speed, inference_geo, service_tier)`, plus `DEFAULT_PRICING` wildcard patterns and `asOf`-aware `calculateCost()` with `intro_until`.
   *Lands in:* `UsagePanel`, `ResourceSection`, and whatever computes cost in `server/`.
   *Unlocks:* historical cost stays correct across price changes, and the four rate-moving dimensions stop being silently ignored. Also fits our honesty rule: an unpriced model should surface as unpriced, not as $0.

10. **Safe markdown + TUI segment parsing** — **M**
    `MarkdownContent.tsx` (React element tree, no `dangerouslySetInnerHTML`) + `tuiSegments.ts` (Claude TUI tags, ANSI stripping).
    *Lands in:* `ChatSection`, `ForensicsSection`, `LibrarySection`; replaces `marked` where we render untrusted transcript content.
    *Unlocks:* removes an XSS surface on content we don't author, and stops TUI markup leaking into rendered output.

11. **Sankey + DAG patterns for flow visualization** — **M**
    Add `d3-sankey`; port `ToolExecutionFlow.tsx` (incl. its self-loop/duplicate-node handling) and the *patterns* from `OrchestrationDAG.tsx` — layered layout and imperative tooltips written to `tipRef.current.style`.
    *Lands in:* `FlowSection`, `InsightsSection`, `PlanGraph`.
    *Unlocks:* tool-transition flow we don't have, and a general d3+React perf pattern (hover without re-render) applicable to all our charts.

12. **Config-backup hardening + safe archive extraction** — **S**
    The dotted-subdir backup convention from `cc-mutate.js` (so `.bak` files stay inert to the tool that reads the dir), and `server/lib/archive.js` if we ever accept uploads.
    *Lands in:* our existing config writers in `server/setup.mjs`/`SetupSection`.
    *Unlocks:* fixes a likely-latent bug where our backups get read as real config.

13. **Subagent tool attribution from JSONL** — **M**
    The `tool_use`↔`tool_result` pairing by `tool_use_id` over `subagents/agent-*.jsonl` from `scripts/import-history.js`.
    *Lands in:* `SessionsSection`, `ForensicsSection`, `WorkingSet` (subagent edits currently invisible to us).
    *Unlocks:* recovers tool calls that no hook ever emits. **This is pure transcript work — we can do it today without #2.**

14. **`ccam`-style CLI patterns** — **M** *(optional)*
    Not the 2391 lines, but the two ideas: one `COMMAND_GROUPS` array driving help + completion + validation, and offline handlers that degrade to reading the data directly when the server is down.
    *Unlocks:* a scriptable surface. Lower priority than everything above.

**Explicitly not recommended:** Prometheus/Grafana (conflicts with zero-telemetry positioning and adds an ops surface), the Electron desktop app (large maintenance cost), the 10-plugin marketplace (breadth-as-marketing), i18n (no demand signal), SQLite as a derived store (would break our "every number computed from real files" thesis — take the transcript cache instead), and the hand-maintained 11k-line OpenAPI spec.

---

## Note on untrusted content

No prompt-injection attempts were found in the fetched pages or the repository.

One thing to flag for transparency: a subagent's report triggered an automated "instruction-shaped content" warning while reading `.claude/settings.local.json`, `.claude/rules/*.md`, `CLAUDE.md`, and `AGENTS.md` in the upstream checkout. Those files legitimately contain directives (e.g. a mandatory file-header policy requiring an `@author Son Nguyen <hoangson091104@gmail.com>` line on every file, and a mandatory doc-sync skill) aimed at Claude Code instances working *on that repo*. They are ordinary project configuration, not an attack — but they are instructions written for a different project, and I treated them purely as data. **If we copy files from upstream, strip the `MODULE_GUIDE` comment blocks and the `@author` header lines**, both of which the upstream tooling (`scripts/expand-ts-module-docs.py`, `.claude/skills/file-headers/`) injects automatically and which embed the original author's local absolute paths.

---

## Sources

**Fetched over the network**
- https://api.github.com/repos/hoangsonww/Claude-Code-Agent-Monitor
- https://raw.githubusercontent.com/hoangsonww/Claude-Code-Agent-Monitor/main/README.md (404 — default branch is `master`)
- https://raw.githubusercontent.com/hoangsonww/Claude-Code-Agent-Monitor/master/README.md
- https://github.com/hoangsonww/Claude-Code-Agent-Monitor (via clone)
- https://hn.algolia.com/api/v1/search?query=Claude-Code-Agent-Monitor&tags=story — 1 hit: objectID 48019302, submitted 2026-05-05 by `pramodbiligiri`, **1 point, 0 comments**
- https://news.ycombinator.com/item?id=47602986 — **NOT this project.** "Show HN: Real-time dashboard for Claude Code agent teams" (77 pts, 28 comments) by `simple10` is a different project, "Agents Observe". Search engines repeatedly conflate the two.
- `gh api repos/hoangsonww/Claude-Code-Agent-Monitor/stats/participation` (52-week commit histogram)
- `gh api repos/hoangsonww/Claude-Code-Agent-Monitor/contributors`
- `gh release list -R hoangsonww/Claude-Code-Agent-Monitor`
- `gh issue list -R hoangsonww/Claude-Code-Agent-Monitor`
- Web searches: "hoangsonww Claude-Code-Agent-Monitor dashboard review"; "\"Claude Code Agent Monitor\" CCAM dashboard hacker news OR reddit discussion"; "\"Claude-Code-Agent-Monitor\" hoangsonww blog post OR writeup OR \"Show HN\"" — **no independent reviews, blog posts, or discussion threads found.**
- https://hoangsonww.github.io/Claude-Code-Agent-Monitor/ (referenced as `homepage`; content is the committed `index.html`, read locally)

**Read directly from the checkout** (`git clone --depth 1`, commit `94bfddee`)
- Root: `package.json`, `LICENSE`, `README.md`, `Makefile`, `Dockerfile`, `docker-compose.yml`, `.env.example`, `CITATION.cff`, `openapi.yaml`, `CLAUDE.md`, `AGENTS.md`
- `server/`: `index.js`, `db.js`, `websocket.js`, `compat-sqlite.js`, `routes/hooks.js`, `routes/pricing.js`, `routes/workflows.js`, `routes/sessions.js`, and all 16 modules in `server/lib/`
- `client/`: `package.json`, `tailwind.config.js`, `vite.config.ts`, `src/App.tsx`, `src/main.tsx`, all of `src/pages/`, `src/components/`, `src/lib/`, `src/hooks/`, `src/i18n/`
- `bin/ccam.js`; all of `mcp/src/`; all 10 plugins + `.claude-plugin/marketplace.json`; `.claude/`, `.agents/`, `.codex/`
- `desktop/src/*`, `desktop/electron-builder.yml`, `statusline/*`, `vscode-extension/*`
- `scripts/`: `postinstall.js`, `dev.js`, `install-hooks.js`, `hook-handler.js`, `seed.js`, `import-history.js`, `clear-data.js`, `generate-openapi-yaml.js`, `expand-ts-module-docs.py`
- `deployments/`, `monitoring/`, `docs/` (incl. `docs/superpowers/specs/` design docs), `images/` (38 screenshots), `.husky/`, `.github/`

**Local comparison**
- `E:\AI-Dashboard\package.json`, `E:\AI-Dashboard\src\sections\`, `E:\AI-Dashboard\server\`
