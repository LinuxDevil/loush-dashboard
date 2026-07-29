# Claude Code Usage Dashboard (`phuryn/claude-usage`)

> Research dossier for porting ideas/code into Loush Dashboard (`LinuxDevil/AI-Dashboard`).
> All file paths under "Where in the code" refer to the **upstream** repo unless prefixed with `E:\AI-Dashboard`.
> Upstream snapshot analysed: `main` @ v1.5.5, downloaded 2026-07-29 via `codeload.github.com/phuryn/claude-usage/zip/refs/heads/main`.

---

## Identity

| Field | Value |
|---|---|
| Repo URL | https://github.com/phuryn/claude-usage |
| Author | Paweł Huryn (`phuryn`) — The Product Compass Newsletter (https://www.productcompass.pm) |
| License | **MIT** (SPDX: `MIT`). `LICENSE` reads "Copyright (c) 2026 Pawel Huryn". Same MIT license duplicated at `vscode-extension/LICENSE`. |
| Stars / Forks | **2,082 stars / 386 forks** (GitHub API, fetched 2026-07-29) |
| Open issues | 15 |
| Created | 2026-04-07 |
| Last push | 2026-07-10 (repo `updated_at` 2026-07-28) |
| Latest version | **v1.5.5**, dated 2026-07-10 in `CHANGELOG.md`; `scanner.VERSION = "1.5.5"` |
| Activity | High-velocity. `CHANGELOG.md` shows 5 releases in the 20 days 2026-06-21 → 2026-07-10 (1.5.0 → 1.5.5) and a dense v1.2.x–v1.4.0 run in June. Issue-driven: nearly every changelog bullet credits an issue number and reporter. |
| Language | Python (per GitHub API). **Zero third-party runtime dependencies** — stdlib only (`sqlite3`, `http.server`, `json`, `pathlib`, `glob`). Requires Python 3.8+. |
| Repo size | 5,721 KB (mostly the three PNG screenshots in `docs/`) |
| Install methods | 4: Homebrew tap (`brew tap phuryn/claude-usage <url>` then `brew install phuryn/claude-usage/claude-usage`), `uv tool install git+…` / `pipx install git+…`, `git clone` + `python cli.py`, Docker (`bash scripts/run-docker.sh`). Plus a **VS Code Marketplace extension** (`PawelHuryn.claude-usage-phuryn`, also on Open VSX). |
| Platforms | macOS, Linux, Windows. Explicitly scans the macOS Xcode Claude integration dir as a second source. |
| CI | GitHub Actions: `.github/workflows/tests.yml` (unittest on Python 3.9/3.11/3.12), `extension-ci.yml`, `tag-on-merge.yml` |
| Tests | 2,175 lines of `unittest` across 7 files in `tests/` — a genuinely well-tested repo for its size |

Total source: **3,641 lines** of Python across three files (`cli.py` 498, `dashboard.py` 2,312, `scanner.py` 831), plus ~1,000 lines of TypeScript for the VS Code extension.

---

## The problem it solves

Anthropic's own UI shows Pro/Max subscribers a progress bar and nothing else — no per-project attribution, no per-model breakdown, no history, no cache accounting, no cost estimate. Meanwhile Claude Code writes a complete, structured usage log to `~/.claude/projects/**/*.jsonl` on every plan tier (API, Pro, Max). Every `assistant` record carries `message.usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` and `message.model`.

The gap is purely one of **presentation and retention**: the data exists locally but is unreadable, and Claude Code eventually prunes old transcripts. `claude-usage` closes that gap — it parses the JSONL into a durable SQLite database and renders it as charts and tables.

Three secondary problems it also solves:
1. **Attribution.** Which project, which git branch, which model, which subagent burned the tokens.
2. **Durability.** The SQLite DB outlives the transcripts. `dashboard.py` has an explicit comment on `/api/rescan`: the DB is "the only durable store of history once Claude Code prunes old transcripts."
3. **Privacy.** No telemetry, no API calls with your data. The single outbound request in the whole product is an unauthenticated GET to `api.github.com/.../releases/latest` for the update-check link, cached 24h in `localStorage`, fail-silent, and suppressed entirely in the VS Code build.

---

## Value proposition

**Real value (verified in code):**

- **Correct four-bucket token accounting.** Input / output / cache-write / cache-read are tracked and priced separately with the right multipliers. Most home-grown dashboards (including ours) collapse this.
- **Streaming de-duplication.** Claude Code emits multiple JSONL records per API response sharing one `message.id`. `scanner.parse_jsonl_file` keeps only the last record per `message_id` because it holds the final usage tallies. Without this you over-count. This is the single most important correctness detail in the repo.
- **Incremental, cheap rescans.** `processed_files(path, mtime, lines)` skips unchanged files by mtime and resumes changed ones from the stored line count. A rescan over a large backlog is near-instant.
- **Subagent attribution.** Dispatched `Task`/`Agent` subagents get their own rows (`turns.is_subagent`, `turns.agent_id`) and a dispatch table (`agents`) populated from the parent's `toolUseResult`, carrying agent type, status, duration and tool-use count.
- **Per-branch cost.** Cost by Project **and Branch** — a genuinely useful "what did this feature cost" view.
- **Zero-dependency install.** Three Python files, stdlib only. `pyproject.toml` has `dependencies = []` by deliberate policy.
- **A durable local database** so history survives transcript pruning.

**Known-broken as of this snapshot (see Gaps for detail):** cache-creation tokens are priced at a single 5-minute-TTL rate, ignoring the 1-hour-TTL breakdown the API returns — upstream issue #162, open, reports a **~9.6% understatement** of total cost on a real corpus. And session/project/branch cost tables price a whole session at its primary model — upstream issue #160, open.

**Marketing, not value:**

- The README tagline "Pro and Max subscribers get a progress bar. This gives you the full picture." is a *rhetorical contrast*, not a feature claim. **There is no subscription-plan model in this codebase.** See "The cost model" below — I grepped the entire repo for `5-hour`, `rate.limit`, `quota`, `weekly.limit`, `subscription`, `plan`, `reset`, `progress.bar` and found no plan-limit logic whatsoever.
- "Cost estimates" are **API list prices applied to subscription usage**. Both the README and the dashboard footer disclaim this, but the giant green `$4,788.69` stat card in the screenshot is the headline number, and for a Max subscriber it is a *counterfactual*, not a bill.
- The Homebrew formula is pinned **one release behind by design** (self-referential SHA problem, documented in `Formula/claude-usage.rb`), so `brew install` never gives you current sources.

---

## Feature inventory

| Feature | What it does | Where in the code (file/dir) | Depends on |
|---|---|---|---|
| JSONL transcript scanner | Walks `~/.claude/projects/**/*.jsonl`, parses `assistant`/`user`/`custom-title`/`ai-title` records | `scanner.py:parse_jsonl_file` (317–449) | stdlib `glob`, `json` |
| Xcode transcript source | Also scans `~/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig/projects` | `scanner.py:21`, `DEFAULT_PROJECTS_DIRS` (23) | — |
| Custom projects dir | `--projects-dir PATH` overrides the defaults | `scanner.py:scan` (576–585), `cli.py:parse_named_arg` | — |
| Streaming dedup | Keeps only the last record per `message.id` (final usage tallies) | `scanner.py:324, 439–443` | conditional UNIQUE index on `turns.message_id` |
| Incremental scan | Skips file if `abs(stored_mtime - mtime) < 0.01`; else resumes from stored line count | `scanner.py:615–795` | `processed_files` table |
| Totals self-heal | After any scan, recomputes every `sessions.*` total from `turns` via correlated subqueries | `scanner.py:800–809` | `turns` table |
| Session aggregation | Rolls turn tokens into session totals; picks the modal model per session | `scanner.py:aggregate_sessions` (452–486) | `collections.Counter` |
| Model-priority merge | On update, keeps the higher-capability model (`fable/mythos 5 > opus 3 > sonnet 2 > haiku 1`) so a haiku subagent can't downgrade an opus session | `scanner.py:MODEL_PRIORITY` (27), `_model_priority` (30), `upsert_sessions` (529) | — |
| Session titles ("topic") | Parses `custom-title` / `ai-title` records; custom always beats AI | `scanner.py:_extract_title` (161), `parse_jsonl_file` (349–368) | `sessions.topic` column |
| One-time topic backfill | Re-reads title records from already-processed files that an incremental scan would skip; gated by a `schema_meta` flag | `scanner.py:_backfill_topics` (171–221), `scan` (602–607) | `schema_meta` table |
| Phantom-session guard | A title-only record (no timestamp) can't INSERT a token-less session row | `scanner.py:502–503` | — |
| Subagent detection | 3 signals: `isSidechain`, an `agentId` (top-level or under `data`), or a `/subagents/` path segment | `scanner.py:is_subagent_record` (235–250) | — |
| Subagent dispatch metadata | Pulls `agentId`, `agentType`, `status`, `totalTokens`, `totalDurationMs`, `totalToolUseCount` off the parent user record's `toolUseResult` | `scanner.py:extract_agent_dispatch` (263–289), `upsert_agents` (292) | `agents` table |
| Auto-compaction bucket | `agent_id LIKE 'acompact-%'` → labelled `auto-compact` | `dashboard.py:AGENT_TYPE_EXPR` (146–150) | — |
| Additive schema migration | `_ensure_column()` + `CREATE ... IF NOT EXISTS`; idempotent, run on *every* DB open including read paths | `scanner.py:init_db` (50–131), `_ensure_column` (134) | — |
| CLI `scan` | Incremental scan with progress printout | `cli.py:cmd_scan` (101) | `scanner.scan` |
| CLI `today` | Today's usage by model + subagent totals | `cli.py:cmd_today` (106–171) | SQL on `turns` |
| CLI `week` | Last 7 days: per-day rows + by-model rollup | `cli.py:cmd_week` (174–266) | SQL on `turns` |
| CLI `stats` | All-time: totals, by-model, top-5 projects, subagent totals, 30-day daily average | `cli.py:cmd_stats` (269–394) | SQL on `turns`+`sessions` |
| CLI `dashboard` | **Binds and serves first**, scans in a background thread, then opens a browser | `cli.py:cmd_dashboard` (397–436) | `threading`, `webbrowser` |
| `--version` | Prints `scanner.VERSION` | `cli.py:main` (471–473) | — |
| HTTP server | `ThreadingHTTPServer`, 4 routes: `GET /`, `GET /api/data`, `GET /icon.svg`, `POST /api/rescan` | `dashboard.py:DashboardHandler` (2214–2293), `serve` (2296) | stdlib `http.server` |
| Single-payload API | `/api/data` returns *all* history in one JSON blob; the client does all filtering | `dashboard.py:get_dashboard_data` (27–232) | SQLite |
| Runtime config injection | `window.APP_CONFIG = __APP_CONFIG_JSON__` string-replaced at serve time with `{version, surface}` | `dashboard.py:2226–2228` | — |
| Rescan button | `POST /api/rescan` runs an in-process incremental scan and returns `{new, updated, skipped, turns, sessions}` | `dashboard.py:do_POST` (2268–2290), JS `triggerRescan` (1903) | `scanner.scan` |
| Busy-timeout read | `PRAGMA busy_timeout = 5000` so reads don't fail while the background scan commits | `dashboard.py:35` | — |
| Model multi-select filter | Grouped panel (Anthropic vs Other providers), All/None, compact summary label | `dashboard.py:buildFilterUI` (1013), `updateModelTriggerLabel` (1049) | — |
| Date-range dropdown | 8 ranges: today, week, month, prev-month, 7d, 30d, 90d, all | `dashboard.py:RANGE_LABELS` (883), `getRangeBounds` (902–931) | — |
| Bookmarkable URLs | `?range=` + `?models=` written via `history.replaceState`; non-default values only | `dashboard.py:updateURL` (1121–1128), `readURLRange` (933), `readURLModels` (994) | — |
| Local-date correctness | `localISODate()` instead of `toISOString()` — fixes calendar ranges leaking the previous month in UTC+ zones (#151) | `dashboard.py:889–891` | — |
| Auto-refresh | 30s poll, **only when the selected range includes today** | `dashboard.py:scheduleAutoRefresh` (1964–1969), `rangeIncludesToday` (893) | — |
| 8 stat cards | Sessions, Turns, Input, Output, Subagent Tokens, Cache Read, Cache Creation, Est. Cost | `dashboard.py:renderStats` (1314–1333) | — |
| Daily chart | Triple-axis: cache stack (left), input/output stack (right), Est. Cost line (second right axis) | `dashboard.py:renderDailyChart` (1444–1477) | Chart.js 4.4.0 via CDN |
| Hourly distribution | 24 buckets, avg turns (bar) + avg output (line), Local/UTC toggle, **peak-hour bars in red** | `dashboard.py:aggregateHourly` (1337–1359), `renderHourlyChart` (1361) | `PEAK_HOURS_UTC` (697) |
| Peak-hour highlighting | Hardcoded UTC 12–17 ≈ Mon–Fri 05:00–11:00 PT "Anthropic peak-hour throttling window" | `dashboard.py:697`, `isPeakHour` (717) | — |
| By-model doughnut | Tokens per model, legend slices toggleable and remembered | `dashboard.py:renderModelChart` (1479–1512) | — |
| Top-projects bar | Horizontal, top 10, input/output stacked | `dashboard.py:renderProjectChart` (1514) | — |
| Subagent chart | Stacked bar of tokens by agent type | `dashboard.py:renderSubagentChart` (1539) | `subagent_by_type` |
| Legend-state persistence | Hidden series tracked per chart in `hiddenSeries` and reapplied after every rebuild | `dashboard.py:866–880` | — |
| 5 data tables | Cost by Model, Top Subagent Dispatches, Recent Sessions, Cost by Project, Cost by Project & Branch | `dashboard.py:1560–1826` | — |
| Column sorting | Independent sort col + dir per table, with ▼/▲ icons | `dashboard.py:setModelSort` (1679), `setSessionSort` (1131), `setProjectSort` (1734), `setProjectBranchSort` (1778) | — |
| Progressive table paging | 10 → 25 → 50 hard cap; tables ≤12 rows never paginate; past the cap the footer offers "Download CSV to see all (N)" | `dashboard.py:TABLE_STEPS` (670–690), `nextTableLimit` (676), `renderTableToggle` (1615–1631) | — |
| CSV export | 5 exports; RFC-ish quoting; timestamped filenames; exports the **full filtered set**, not the visible page | `dashboard.py:csvField` (1829), `downloadCSV` (1843), `export*CSV` (1856–1899) | — |
| Sticky section nav | "Overview / Graphs ▾ / Tables ▾" jump bar with scroll-spy and `--jump-h` height sync | `dashboard.py:initSectionNav` (2093–2181) | — |
| Collapsible cards | Every chart/table folds from its title; state persisted in `localStorage` key `cu_collapsed_cards`; charts resized on expand | `dashboard.py:toggleCard` (2077), `resizeChartsIn` (2064), `loadCollapsedSet` (2054) | — |
| XSS escaping | Every dynamic value goes through `esc()` (textContent → innerHTML round-trip) | `dashboard.py:esc` (638–642) | — |
| Update check | 24h-cached GitHub releases GET, fail-silent, web build only | `dashboard.py:checkForUpdate` (2009–2027), `isNewer` (1981) | `localStorage` |
| Docker | `python:3.12-slim`, 3 files copied, `~/.claude` mounted **read-only**, DB in a named volume, isolated bridge network with IP masquerade disabled | `Dockerfile`, `scripts/run-docker.sh` | Docker |
| Homebrew formula | Tap-based; writes a bash shim exec'ing `python3.13` directly; `test do` block runs a real scan against an empty dir | `Formula/claude-usage.rb` | `python@3.13` |
| PyPI-style packaging | `uv tool install` / `pipx`; version read dynamically from `scanner.VERSION` | `pyproject.toml` | setuptools |
| VS Code extension | Same dashboard in an activity-bar sidebar webview; bundles the Python sources; spawns the server with `--no-browser --surface vscode` | `vscode-extension/src/{extension,server-manager,sidebar,python-locator,port-allocator,install-mode}.ts` | Python 3.8+ on PATH |
| Stable port reuse | Reuses the previous port when free so the webview iframe's `localStorage` origin is stable across reloads | `vscode-extension/src/port-allocator.ts` | `node:net` |
| Version parity test | Asserts `scanner.VERSION` == top CHANGELOG heading == extension `package.json` version | `tests/test_version.py` | — |

---

## UX and interaction design

The dashboard is **one long single-page scroll**, dark-themed, with a warm Anthropic-leaning palette (`--accent: #d97757` coral, `--bg: #161617`, `--card: #1E1F20`). Layout top-to-bottom:

1. **Header** — icon + "Claude Code Usage", "Updated: <ts> / Auto-refresh in 30s", and a **Rescan** button that reports `(N new, M updated)` for 3 seconds before reverting.
2. **Filter bar** — Models multi-select + Range dropdown. Both persist to the URL.
3. **Sticky jump bar** — three entries only (Overview, Graphs ▾, Tables ▾). The dropdowns open on hover *or* keyboard focus, with an invisible `::before` bridge over the 5px gap so the menu doesn't close as the pointer travels. Scroll-spy highlights the active section *and* its parent menu trigger.
4. **8 stat cards** in an auto-fit grid.
5. **5 charts**, then **5 tables**.
6. **Footer** — pricing disclaimer, GitHub/author/license links, version + update link.

Design decisions worth naming:

- **Everything collapses.** Click any card title to fold it; state is remembered forever. The stated rationale is that the report is long and users should be able to permanently hide views they don't use. Titles get `role="button"`, `tabindex="0"`, and `aria-expanded`.
- **Paging has a philosophy.** Tables reveal 10 → 25 → 50 and stop, because "rendering more than that visibly hurts performance." Tables with ≤12 rows never paginate at all — paging away one or two rows is judged more annoying than helpful. Past 50, the footer degrades to a CSV link rather than another step.
- **Peak hours are surfaced as a red bar band.** The hourly chart tints UTC 12–17 red with a legend reading "Peak hours (PT)" and a tooltip suffix "Peak — Anthropic US hours". This is the closest the product gets to rate-limit awareness, and it is a hardcoded constant with an accepted PST/PDT 1h drift.
- **Auto-refresh is conditional.** Polling only runs when the selected range includes today — no pointless refresh on "Previous Month".
- **Serve-then-scan.** The port binds immediately and the scan runs in a background thread, because a cold scan over a large backlog can exceed a minute and the VS Code extension kills a server that doesn't answer `/api/data` in time. The client shows "Database not found — retrying…" and self-heals.
- **Legend toggles survive repaints.** Charts are destroyed and rebuilt on every filter change; hidden series are tracked in a `hiddenSeries` map and reapplied.
- **`prefers-reduced-motion`** is honoured for jump-to-section scrolling.
- **Custom scrollbars** are styled explicitly because the VS Code webview iframe doesn't inherit `--vscode-*` theme variables.

Weak spots: no light theme, no keyboard shortcuts, no search box, no per-session drill-down (the session id is truncated to 8 chars with no link), and the charts have no export-to-image.

---

## Architecture

**Data sources**
- `~/.claude/projects/**/*.jsonl` (primary)
- `~/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig/projects/**/*.jsonl` (macOS Xcode integration)
- `--projects-dir PATH` replaces both.
- Explicitly *not* captured (README): **Cowork sessions**, which run server-side and write no local JSONL.

**Ingestion** — `scanner.py`. Per-file: stat for mtime, compare against `processed_files`; skip / full-parse / resume-from-line-N. Parse only records of type `assistant`, `user`, `custom-title`, `ai-title`. For `assistant`, skip any turn whose four token counts sum to zero. Dedup by `message.id`. Detect subagent-ness. Extract the first `tool_use` block's name as `tool_name`. Derive `project_name` as the **last two path components of `cwd`** (`scanner.py:project_name_from_cwd`, 224–232) — Windows backslashes normalised.

**Storage** — SQLite at `~/.claude/usage.db`, overridable with `CLAUDE_USAGE_DB`.

```sql
CREATE TABLE IF NOT EXISTS sessions (
    session_id      TEXT PRIMARY KEY,
    project_name    TEXT,
    first_timestamp TEXT,
    last_timestamp  TEXT,
    git_branch      TEXT,
    total_input_tokens      INTEGER DEFAULT 0,
    total_output_tokens     INTEGER DEFAULT 0,
    total_cache_read        INTEGER DEFAULT 0,
    total_cache_creation    INTEGER DEFAULT 0,
    model           TEXT,
    turn_count      INTEGER DEFAULT 0,
    topic           TEXT
);

CREATE TABLE IF NOT EXISTS turns (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id              TEXT,
    timestamp               TEXT,          -- ISO8601 UTC string, e.g. 2026-04-08T09:30:00Z
    model                   TEXT,
    input_tokens            INTEGER DEFAULT 0,
    output_tokens           INTEGER DEFAULT 0,
    cache_read_tokens       INTEGER DEFAULT 0,
    cache_creation_tokens   INTEGER DEFAULT 0,
    tool_name               TEXT,
    cwd                     TEXT,
    message_id              TEXT,
    is_subagent             INTEGER DEFAULT 0,
    agent_id                TEXT
);

CREATE TABLE IF NOT EXISTS processed_files (
    path    TEXT PRIMARY KEY,
    mtime   REAL,
    lines   INTEGER
);

CREATE TABLE IF NOT EXISTS agents (
    agent_id              TEXT PRIMARY KEY,
    agent_type            TEXT,
    dispatched_in_session TEXT,
    completed_at          TEXT,
    status                TEXT,
    total_tokens          INTEGER,
    total_duration_ms     INTEGER,
    tool_use_count        INTEGER
);

CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE INDEX IF NOT EXISTS idx_turns_session   ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);
CREATE INDEX IF NOT EXISTS idx_sessions_first  ON sessions(first_timestamp);
CREATE INDEX IF NOT EXISTS idx_agents_type     ON agents(agent_type);
CREATE INDEX IF NOT EXISTS idx_turns_subagent  ON turns(is_subagent);
CREATE INDEX IF NOT EXISTS idx_turns_agent_id  ON turns(agent_id);

-- The keystone: conditional unique index makes INSERT OR IGNORE a cheap dedupe
CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_message_id
    ON turns(message_id) WHERE message_id IS NOT NULL AND message_id != '';
```

Design notes on the schema:
- `turns` is the **source of truth**; `sessions` is a denormalised cache. `cli.py` deliberately computes all-time totals from `turns`, "more accurate — per-turn model attribution".
- Timestamps are stored as **ISO8601 strings** and queried with `substr(timestamp, 1, 10)` for the day and `CAST(substr(timestamp, 12, 2) AS INTEGER)` for the UTC hour. No date functions, no timezone conversion server-side.
- Migrations are additive-only and idempotent, applied on *every* connection open including read-only paths (`cli.require_db`, `dashboard.get_dashboard_data`) — because the server serves before its background scan migrates.
- After any scan touches data, session totals are **recomputed from scratch** from `turns`, which repairs the drift that would otherwise occur when `INSERT OR IGNORE` skips a duplicate turn that `upsert_sessions` had already added additively.

**Transport** — plain HTTP on `localhost:8080`. No websockets, no SSE, no auth. `GET /api/data` returns the **entire history** in one JSON payload — every daily-by-model row, every hourly-by-model row, every session, every subagent dispatch. All filtering, range selection, aggregation-by-project and cost computation happen in the browser. The server does exactly six `GROUP BY` queries and nothing else.

**Frontend** — a single 1,955-line `HTML_TEMPLATE` r-string inside `dashboard.py`. Vanilla JS, no framework, no build step. Chart.js 4.4.0 from `cdn.jsdelivr.net` (the only external network dependency, and it breaks offline).

**Packaging** — Docker (`python:3.12-slim`, 13-line Dockerfile), Homebrew formula, `pyproject.toml` for uv/pipx, VS Code `.vsix` with Python sources bundled.

### Data-flow diagram

```
 ~/.claude/projects/**/*.jsonl          ~/Library/.../Xcode/.../projects/**/*.jsonl
              |                                          |
              +--------------------+---------------------+
                                   v
                    scanner.parse_jsonl_file(filepath)
                    - filter type in {assistant,user,custom-title,ai-title}
                    - drop turns whose 4 token counts sum to 0
                    - dedupe by message.id (last record wins)
                    - is_subagent? (isSidechain | agentId | /subagents/ path)
                    - extract_agent_dispatch() from parent toolUseResult
                                   |
                                   v
              aggregate_sessions()  ->  upsert_sessions()  (model-priority merge)
                                    ->  insert_turns()     (INSERT OR IGNORE)
                                    ->  upsert_agents()    (ON CONFLICT DO UPDATE)
                                   |
                       processed_files(path, mtime, lines)   <- incremental gate
                                   |
                                   v
                    ~/.claude/usage.db  (SQLite, 5 tables)
                    [ or /data/usage.db in Docker, via CLAUDE_USAGE_DB ]
                                   |
              +--------------------+---------------------------+
              v                                                v
   cli.py  today / week / stats                dashboard.py  GET /api/data
   (SQL aggregates -> stdout)                  (6 GROUP BY queries -> one JSON blob)
                                                               |
                                                               v
                                          browser: applyFilter()
                                          - date-range + model filter
                                          - re-aggregate by day/model/project/branch
                                          - calcCost() per model, client-side
                                                               |
                                          Chart.js 4.4.0 (CDN) + 5 HTML tables
                                                               |
                                          POST /api/rescan  --> scanner.scan()
```

---

## The cost model

**This is the section with the most portable value, and also the section where the brief's premise needs correcting: there is no Pro/Max plan model, no rate-limit window, and no depletion forecast anywhere in this repo.** The only plan-adjacent artefact is the hardcoded peak-hour band.

### Pricing table (verbatim)

The table is **duplicated in two places** and the two copies are *not identical* — `cli.py` lists 12 models, the README lists 7.

`cli.py:21–36` (Python) and `dashboard.py:735–750` (JavaScript, inside `HTML_TEMPLATE`) both define the same 12 entries. USD per **million** tokens:

| Model key | input | output | cache_write | cache_read |
|---|---|---|---|---|
| `claude-fable-5` | 10.00 | 50.00 | 12.50 | 1.00 |
| `claude-mythos-5` | 10.00 | 50.00 | 12.50 | 1.00 |
| `claude-opus-4-8` | 5.00 | 25.00 | 6.25 | 0.50 |
| `claude-opus-4-7` | 5.00 | 25.00 | 6.25 | 0.50 |
| `claude-opus-4-6` | 5.00 | 25.00 | 6.25 | 0.50 |
| `claude-opus-4-5` | 5.00 | 25.00 | 6.25 | 0.50 |
| `claude-sonnet-4-7` | 3.00 | 15.00 | 3.75 | 0.30 |
| `claude-sonnet-4-6` | 3.00 | 15.00 | 3.75 | 0.30 |
| `claude-sonnet-4-5` | 3.00 | 15.00 | 3.75 | 0.30 |
| `claude-haiku-4-7` | 1.00 | 5.00 | 1.25 | 0.10 |
| `claude-haiku-4-6` | 1.00 | 5.00 | 1.25 | 0.10 |
| `claude-haiku-4-5` | 1.00 | 5.00 | 1.25 | 0.10 |

The README's public table omits `opus-4-5`, `sonnet-4-7`, `sonnet-4-5`, `haiku-4-7`, `haiku-4-6` — a documentation drift, not a behaviour difference.

Attribution: "Anthropic API pricing as of June 2026" (`claude.com/pricing#api`). In-code comment on the Fable/Mythos rows: "Anthropic's most capable class, priced at 2x Opus." and "Mythos 5 shares Fable 5's pricing; Project-Glasswing access only."

**The invariant across every tier:** `output = 5 × input`, `cache_write = 1.25 × input`, `cache_read = 0.10 × input`. Every row obeys it exactly. That means the whole table collapses to a single per-model input price plus three fixed multipliers — a useful simplification if you port it.

### Model-alias resolution (exact, `cli.py:38–56` / `dashboard.py:759–771`)

Four-stage cascade, first match wins:

1. **Exact key match** — `PRICING[model]`.
2. **Prefix match** — `model.startswith(key)` for each key in insertion order. Catches dated ids like `claude-sonnet-4-6-20260514`.
3. **Family keyword fallback** on the lowercased name, in this order:
   - contains `fable` or `mythos` → `claude-fable-5` prices
   - contains `opus` → `claude-opus-4-8` prices (i.e. **newest Opus is the default for any unrecognised Opus**)
   - contains `sonnet` → `claude-sonnet-4-6`
   - contains `haiku` → `claude-haiku-4-5`
4. **No match** → `None`.

### Billability gate (`dashboard.py:752–757`)

```js
function isBillable(model) {
  if (!model) return false;
  const m = model.toLowerCase();
  return m.includes('fable') || m.includes('mythos') ||
         m.includes('opus') || m.includes('sonnet') || m.includes('haiku');
}
```

Anything else — local LLMs, unknown ids, proxies — is **excluded from cost entirely** and rendered as a muted `n/a` cell rather than `$0.0000`. This is a deliberate honesty choice: a zero would read as "free", `n/a` reads as "unknown". Note the JS `calcCost` gates on `isBillable` *before* calling `getPricing`; the Python `calc_cost` does not (it relies on `get_pricing` returning `None`) — functionally equivalent because the keyword sets match, but a real asymmetry between the two implementations.

### The cost formula (identical in both languages)

`cli.py:58–67`:
```python
def calc_cost(model, inp, out, cache_read, cache_creation):
    p = get_pricing(model)
    if not p:
        return 0.0
    return (
        inp            * p["input"]       / 1_000_000 +
        out            * p["output"]      / 1_000_000 +
        cache_read     * p["cache_read"]  / 1_000_000 +
        cache_creation * p["cache_write"] / 1_000_000
    )
```

### Accounting rules, stated exactly

1. **Four buckets, four prices.** `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` are each priced separately. Nothing is folded together.
2. **Cache reads and cache writes are additive, not substitutive.** The formula sums all four. `cache_read_input_tokens` is *not* also counted as `input_tokens` — Claude Code reports them as disjoint buckets and the tool trusts that. `cli.py` labels them: cache read "(90% cheaper than input)", cache creation "(25% premium on input)".
3. **Cost is computed per model, then summed — never on aggregated multi-model rows.** This was an actual bug fixed in v1.5.5: "priced **per model before the daily aggregation** so multi-model days are costed correctly (#151)". You can see the discipline in `applyFilter` (`dashboard.py:1187`): the daily cost accumulator adds `calcCost(r.model, …)` per `(day, model)` row.
4. **Session-level cost uses the session's *primary* model**, not per-turn attribution. `sortSessions`/`renderSessionsTable` call `calcCost(s.model, s.input, …)` where `s.model` is the modal model. A session that mixed Opus and Haiku is mis-priced. The CLI avoids this by working off `turns`; the sessions table cannot.
5. **Zero-usage turns are dropped at parse time**, so they never inflate turn counts.
6. **Subagent tokens are a subset, not an addition.** `cli.py` prints "(included in totals)" and the stat card says "included in totals". Double-counting is explicitly avoided.
7. **De-duplication precedes accounting.** Streaming replays sharing a `message.id` collapse to the final record.
8. **Display precision:** 4 decimal places (`$0.0000`) for per-row costs, 2 for the headline total (`fmtCostBig`). CSV exports use `cost.toFixed(4)`.
9. **The disclaimer is repeated three times** — README, dashboard footer, and the Est. Cost stat card subtitle "API pricing, June 2026" — that Max/Pro subscriber costs differ.

### What is *not* modelled (verified by exhaustive grep)

- No plan tiers (Pro / Max 5× / Max 20×).
- No 5-hour rolling session window, no weekly cap, no reset countdown.
- No quota percentage, no burn rate, no depletion forecast, no "you will run out at HH:MM".
- No budget threshold or alerting.
- No batch-API discount, no long-context (>200K) premium tier, and **no 1-hour vs 5-minute cache-TTL price split** — this last one is a live, quantified defect, see Gaps #2.
- No web-search / code-execution tool surcharges.

The **only** rate-limit-shaped feature is `PEAK_HOURS_UTC = new Set([12,13,14,15,16,17])` (`dashboard.py:697`) with the comment: Anthropic throttles Mon–Fri 05:00–11:00 PT, approximated as fixed UTC 12–17, "during PST the window shifts by 1h — accepted simplification". It only tints bars red; it drives no math. Note it also does **not** actually restrict to Mon–Fri despite the comment. (Web research reports upstream issue #108, closed 2026-05-06, as having removed peak-hour highlighting after Anthropic dropped the peak window — but the constant, the red bars, the legend and the tooltip are all still present on `main` at v1.5.5. Either the removal was reverted or the issue was resolved differently; **unverified**. Either way, this is now most likely stale UI.)

`cli.py:cmd_week` ("Weekly Usage") is a **calendar-week token aggregation**, not Anthropic's weekly cap.

A companion project by the same author, **`phuryn/burnstop`** (MIT, created 2026-06-22, ~8 stars), is badged in the README as the rate-limit tool. It is a **budget fuse / circuit breaker**, not a dashboard: five Claude Code hooks (`hook.py` on PreToolUse/Stop/SubagentStop, `dispatch.py` on UserPromptSubmit/UserPromptExpansion) call `meter.session_spend()`, which recomputes spend from JSONL on every call — no ledger, therefore no staleness and no read-modify-write race across concurrent subagent hooks. The halt is `Stop` returning `{"continue": false}`. Auto-arms at $50 per `/goal`; accepts `$1`, `200k`, `5M`. Stdlib-only. Its README documents the limitation that the fuse is roughly one turn behind. **Notably, burnstop gets two accounting invariants right that claude-usage does not**: dedupe by `message.id` (keep last), and price each turn by its own model before summing — never aggregate tokens first.

---

## Notable code worth stealing

Ranked by value to us.

| Upstream path | What it does | Why it's good | Port difficulty (React 18 + Express ESM, no TS) |
|---|---|---|---|
| `cli.py:21–67` / `dashboard.py:735–783` | The full pricing table + 4-stage alias cascade + `isBillable` gate + `calcCost` | Real per-model numbers with a documented source and date. Our `PRICE_PER_M` is a 3-branch regex that is **3× too high for Opus**. | **Easy** — it's already valid JS in `dashboard.py`; copy the object literal and three functions verbatim into a new `server/pricing.mjs`. |
| `scanner.py:324, 439–443` | Dedupe streaming records by `message.id`, last-write-wins | Prevents silent over-counting. **We do not do this** — `server/index.mjs:681` pushes an entry for every line containing `"usage"`. | **Easy** — a `Map` keyed by `j.message.id` per file, flushed at file end. |
| `scanner.py:800–809` | Recompute all session totals from `turns` after a scan | Self-healing denormalisation. Any aggregate cache can be rebuilt from the atomic table, so drift is structurally impossible. | **Easy** (pattern, not code) — applies to our `usageCache` reducer. |
| `scanner.py:615–795` + `processed_files` | mtime-gated skip + resume-from-line-N | We cache by `(mtime,size)` and re-parse the **whole file** on any change. Resume-from-line-N is strictly better for append-only JSONL. | **Medium** — needs a line-offset counter in our `usageCache` records (`server/index.mjs:669`). |
| `scanner.py:235–289` | Subagent detection (3 signals) + `extract_agent_dispatch` from `toolUseResult` | Gives per-subagent cost, duration, status and tool-use counts. We ingest no subagent signal at all. | **Medium** — pure parsing; the `agentId`/`isSidechain`/`/subagents/` checks port 1:1 into our line loop. |
| `dashboard.py:AGENT_TYPE_EXPR` (146–150) + `top_dispatch_rows` (183–204) | "Which subagent type costs me the most" ranking, with `acompact-%` bucketed as auto-compact | Directly answers a question our CapabilityLedger gestures at but can't. | **Medium** — we'd do it in JS reduce, not SQL. |
| `dashboard.py:1444–1477` | Daily chart with **three** y-axes: cache stack, I/O stack, cost line | Cache reads dwarf I/O by ~10× (4.59B vs 37.56M in the screenshot). Sharing one axis makes I/O invisible. The separate-axis fix is the right call. | **Medium** — we use d3, not Chart.js; the *insight* ports, the code doesn't. |
| `dashboard.py:670–690, 1615–1631` | `TABLE_STEPS = [10,25,50]`, `PAGINATE_THRESHOLD = 12`, `renderTableToggle` three-state footer | A tiny, well-reasoned paging component. The ≤12-rows-never-paginate rule is a real UX insight. | **Easy** — ~30 lines, becomes a `<TableFooter>` React component. |
| `dashboard.py:1829–1854` | `csvField` + `downloadCSV` (Blob + object URL + timestamped filename) | Correct CSV quoting in 7 lines; exports the full filtered set, not the visible page. | **Easy** — copy verbatim into `src/lib/csv.js`. |
| `dashboard.py:889–931` | `localISODate()` + `getRangeBounds()` for 8 named ranges | Fixes a real class of bug (`toISOString()` shifting the day in UTC+ zones). **We use `toISOString().slice(0,10)` in at least four places** in `server/index.mjs` (lines 1994, 2010, 741). | **Easy** — 40 lines, drop-in. |
| `dashboard.py:2051–2084` | Collapsible cards with `localStorage` persistence + chart resize on expand | Handles the zero-size-canvas trap when a chart is created inside `display:none`. | **Easy** — a `useLocalStorage`-backed `<CollapsibleCard>`. |
| `dashboard.py:866–880` | `hiddenSeries` map so legend toggles survive chart rebuilds | Small, easy to forget, immediately noticeable when missing. | **Easy** |
| `cli.py:397–436` | Bind-and-serve first, scan in a background thread | Removes cold-start timeouts on a large backlog and degrades gracefully with a client-side retry. | **Medium** — our Express server already binds first, but `collectUsage()` is synchronous and blocks the first request. Worth borrowing the *pattern*. |
| `scanner.py:_ensure_column` + `schema_meta` | Additive migration + one-shot backfill gated by a flag row | Clean answer to "how do I backfill data my incremental scanner will never revisit". | **Easy** as a pattern; we have no DB, so it maps to a version field in our JSON meta file. |
| `scripts/run-docker.sh` + `Dockerfile` | `-v "$HOME/.claude:/root/.claude:ro"` + named volume for the DB + `--opt com.docker.network.bridge.enable_ip_masquerade=false` | The read-only mount is a *provable* local-first guarantee, not a promise. The masquerade-disabled bridge is a nice extra egress constraint. | **Easy** — 13-line Dockerfile; ours would need Node + `server/`. |
| `dashboard.py:638–642` | `esc()` — textContent→innerHTML escaping, applied to every dynamic value | Relevant because transcript-derived strings (project names, branch names, session titles) are attacker-influencable in a shared repo. | N/A — React escapes by default. Worth noting we're already safe. |
| `vscode-extension/src/port-allocator.ts` | `pickFreePort` via `listen(0)` + `isPortFree` for stable-port reuse | The "reuse the same port so the iframe's `localStorage` origin stays stable" insight is non-obvious. | **Easy** — already Node, strip the types. |

---

## Gaps and weaknesses

1. **No subscription-plan awareness at all.** Despite the tagline. No Pro/Max limits, no 5-hour window, no weekly cap, no reset countdown, no forecast. For a Max subscriber the entire cost column is a hypothetical. Competitors do model this: `ccusage` has a `blocks` 5-hour-window report, and `Maciek-roboblog/Claude-Code-Usage-Monitor` does live burn-rate and reset timers. Upstream issue #145 (open, 2026-06-21) reports Max-plan users reading the dashboard as if it showed subscription pricing, because the disclaimer sits at the bottom of the page.

2. **Cache-creation tokens are priced at a single 5-minute TTL rate.** `scanner.py:408` reads only the aggregate `cache_creation_input_tokens` and discards the `cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens` breakdown the API already returns; `cli.py:66` then applies one flat `cache_write` rate. Upstream issue **#162** (opened 2026-07-25, **still open**, PR #163 open) measures on a 425-file / 81k-record corpus that **78.0% of cache-creation tokens were 1-hour TTL** (billed at 2× the 5-minute rate), making cache-write cost **49.4% low** and total cost **9.6% low** ($3,379 → $3,702). This bites hardest on subscriptions, because Anthropic's own docs state the cache lifetime is an hour on a subscription and five minutes on API/usage credits. `ccusage` had the identical bug (issue #899, ~19% understatement) and has fixed it.

3. **Session-level cost uses the modal model** — upstream issue **#160** (2026-07-23, open, PR #165 open). A contributor's summary on the #162 thread: the top stat cards price per model, but the session, project, and project-and-branch tables price all of a session's tokens at its primary model, and cache reads make up most of subagent usage. A Sonnet subagent inside a Fable session is billed at Fable rates.

4. **The whole category rests on logs Anthropic itself calls approximate.** `code.claude.com/docs/en/costs` says `/usage` figures are approximate and computed from local session history. Independent measurement is worse: an analysis published 2026-02-24 (gille.ai, corroborated by ccusage issue #866) reports that **~75% of JSONL entries carry `usage.input_tokens` of 0 or 1** — streaming placeholders never updated — and 51–55% are duplicate `requestId` entries, producing input undercounts of 100–174× and output undercounts of 10–17× against the statusbar for the same day, with cache metrics accurate. Meanwhile `anthropics/claude-code#6805` reports stream-json mode *duplicating* usage stats and inflating cost. **Both failure modes are live simultaneously**: tools that sum every line overcount, tools that trust placeholder values undercount. Treat any absolute dollar figure from this class of tool — theirs or ours — as an order-of-magnitude indicator, not a bill. **Unverified against our own corpus; worth measuring before we ship any number as authoritative.**

5. **The pricing table is duplicated in two languages** (`cli.py` and the JS string in `dashboard.py`) and a third time, incompletely, in `README.md`. Nothing enforces parity — `tests/test_version.py` guards the version triple but nothing guards the price triple. The README is already out of sync (7 rows vs 12).
6. **`/api/data` ships the entire history on every poll**, every 30 seconds. All daily rows, all hourly rows, all sessions, all dispatches. For the screenshot's 2,073-session dataset this is a large JSON blob re-serialised twice a minute. No pagination, no `since=` parameter, no ETag.
7. **The whole frontend is a 1,955-line string literal** inside a Python file. No build step is a feature; no syntax highlighting, no linting, no component boundaries and no way to test the JS is the cost. There are no JS tests.
8. **Chart.js loads from a CDN.** The tool is otherwise perfectly offline and air-gappable; this one `<script src="https://cdn.jsdelivr.net/…">` breaks it, and it's inside a product whose pitch is local-first.
9. **Peak-hour window is hardcoded, probably stale, and slightly wrong.** `PEAK_HOURS_UTC` is UTC 12–17 with an accepted 1-hour PST drift, and despite the comment saying Mon–Fri it is applied to every day of the week. Web research indicates Anthropic removed peak-hour reduction on 2026-05-06 when 5-hour limits were doubled, which would make the whole band obsolete.
10. **Homebrew tracks one release behind by design.** Documented, unavoidable given the in-repo formula, but it means `brew install` never yields current sources.
11. **No auth on the HTTP server**, and `--host 0.0.0.0` is documented in the README. Anyone on the LAN can read your full project/branch/session-title history. There is no warning about this.
12. **Session titles can leak.** `sessions.topic` comes from `custom-title`/`ai-title` records and is exported to CSV. The author was careful — there's an explicit note that there is deliberately no fallback to the first user message "so prompt text never leaks" — but AI-generated titles are still derived from prompt content.
13. **`project_name` is the last two path components of `cwd`.** Two checkouts of the same repo at different paths merge; two different repos with the same `parent/name` shape also merge.
14. **No cost model for non-token billing** — no batch discount, no long-context tier, no tool surcharges.
15. **Cowork sessions are invisible**, acknowledged in the README. As Anthropic moves work server-side, local-JSONL tools structurally lose coverage.
16. **Release-QA gaps have shipped before.** A run of `ReferenceError: cutoff is not defined` blank-dashboard reports (#88, #90, #93, #99, #126, #130) spanned April–May 2026, and #5 (closed) was a stored XSS via unescaped `innerHTML` — which is why `esc()` now wraps every dynamic value. A 1,955-line untested JS string literal is the structural cause.
17. **No light theme**, no per-session drill-down, no search.
18. **Adoption is newsletter-driven, not press-driven.** 2,082 stars in ~3.5 months with essentially no independent technical coverage — no Show HN, no significant Reddit thread. It was omitted entirely from the one neutral 2026 comparison article found (Torii, 2026-06-12). `ccusage` has ~17,500 stars (and has been rewritten in Rust); `Claude-Code-Usage-Monitor` ~8,500. Judge the code, not the star count.

---

## Overlap with Loush Dashboard

| Their feature | Our equivalent section (or NONE) | Who does it better | Note |
|---|---|---|---|
| Per-model pricing table | `server/index.mjs:718` `PRICE_PER_M` | **Them, decisively** | Ours: `m => (/opus\|fable/.test(m) ? 15 : /haiku/.test(m) ? 0.8 : 3)` with ratios `out=5×, cc=1.25×, cr=0.1×` (`server/index.mjs:1987`). Cross-checked against their table: our **Sonnet is exactly right**; **Opus is 3× too high** ($15 in vs $5, $75 out vs $25); **Fable is 1.5× too high** ($15 vs $10 in); **Haiku is 20% too low** ($0.80 vs $1.00). Our multipliers happen to match theirs exactly — only the base prices are wrong. |
| 4-bucket token accounting | `server/index.mjs:681` (`in/out/cc/cr`) | **Tie** | We already capture all four buckets correctly and price them separately. |
| Streaming dedupe by `message.id` | **NONE** | **Them** | We push one entry per `"usage"` line with no dedupe (`server/index.mjs:678–683`). If Claude Code emits multiple records per response we over-count. Needs verification against a real transcript before assuming breakage. |
| Incremental file cache | `usageCache` (`server/index.mjs:657, 668`) keyed on `(mtime, size)` | **Them, slightly** | Ours re-parses a whole file whenever it grows; theirs resumes from the stored line count. |
| Durable store surviving transcript pruning | **NONE** — we re-read JSONL every boot | **Them** | Their SQLite DB is the explicit answer to Claude Code pruning transcripts. We lose that history permanently. |
| Session list with tokens/cost | `SessionsSection.jsx` | Unverified — needs a side-by-side | They add a Title column, duration, git branch, and full-id CSV export. |
| Cost by project | `/api/roi`, `ProjectsSection.jsx` | Unverified | We have per-project cost via `byProj` (`server/index.mjs:2542`). |
| Cost by project **and git branch** | **NONE** as a first-class view | **Them** | We *do* collect `rec.branches` per file (`server/index.mjs:687–689`) — the data exists, the view doesn't. Cheap win. |
| Subagent / dispatch attribution | `CapabilityLedger.jsx`, `RunsSection.jsx` (different axis) | **Them for cost** | We measure capability *load* (always-on tokens, dead/cold/hot). They measure dispatched-subagent *spend*. Complementary, not overlapping. |
| Hourly distribution + peak-hour band | **NONE** | **Them** | We have an 18-week daily heatmap (`UsagePanel.jsx`), not an hour-of-day profile. |
| 5-hour block tracking | `server/index.mjs:719–740` (`BLOCK = 5 * HOUR`, `activeBlock`), rendered in `Overview.jsx:180` | **Us** | We compute the active 5-hour block and its per-model tokens. **They have nothing comparable.** This is our advantage, and it's the foundation a plan-limit feature would build on. |
| Cost projection / budget | `UsagePanel.jsx` "Month-end cost projection" + `lib/harness-usage-trends.mjs` | **Us, decisively** | We have MTD + daily-avg × days-remaining, a confidence label, a budget input persisted to `localStorage`, and over/under-budget deltas. They have no forecasting at all. |
| Usage anomaly detection | `lib/harness-usage-trends.mjs` (>2× trailing baseline) | **Us** | Runaway/looping-agent detection. No upstream equivalent. |
| Cache-efficiency scoring | `UsagePanel.jsx` "Cache TTL impact" + harness health grade | **Us** | We estimate dollars wasted on avoidable cache re-writes. They only display raw cache counts. |
| Model filter (multi-select, grouped) | **NONE** | **Them** | Our UsagePanel shows all models unconditionally. |
| Named date ranges + bookmarkable URL state | **NONE** in UsagePanel | **Them** | 8 ranges, `?range=`/`?models=` in the URL. |
| CSV export | Unverified across our sections | **Them** for usage data | 5 exports, full filtered set. |
| Collapsible/persisted sections | `CustomizeSection.jsx` (different mechanism) | Unverified | Theirs is per-card `localStorage` fold state. |
| Terminal CLI (`today`/`week`/`stats`) | **NONE** | **Them** | We are web-only. |
| VS Code extension | **NONE** | **Them** | Same dashboard embedded in a sidebar webview. |
| Docker read-only mount | **NONE** | **Them** | `-v "$HOME/.claude:/root/.claude:ro"` turns our "zero telemetry" claim into an enforced constraint. |
| Homebrew / pipx packaging | **NONE** | **Them** | We have no distribution story. |
| Everything else we do | WorkingSet, Setup, Harness, Forensics, Inbox, Delivery, Ticket, Chat, Flow, Hooks, Mcp, Artifacts, Library, Governance, Quality, Reliability, Resource, Runs, Board, Bugs, Insights, PromptStudio, PromptQuality, PlanGraph, ActivityTimeline, ContextExplorer, TeamBaseline | **Us** | claude-usage is a single-purpose token/cost dashboard. Loush is a workflow product. ~30 of our sections have no upstream counterpart at all. |

---

## Recommended adoptions

Ranked by value ÷ effort.

### 1. Replace `PRICE_PER_M`/`entryCost` with the real per-model pricing table — **S**
**Take:** `cli.py:21–67` (or equivalently `dashboard.py:735–783`, which is already JavaScript).
**Lands in:** a new `server/pricing.mjs` exporting `PRICING`, `getPricing(model)`, `isBillable(model)`, `calcCost(model, inp, out, cacheRead, cacheCreation)`. Replace `server/index.mjs:718` (`PRICE_PER_M`) and `server/index.mjs:1987` (`entryCost`) with imports. `lib/harness-usage-trends.mjs` takes `costFn` as a parameter already, so it needs no change.
**Unlocks:** every dollar figure in Loush becomes correct. Today our Opus costs are **3× overstated** and Fable **1.5×** — which silently corrupts the month-end projection, the budget alerts, the anomaly `costRatio`, the ROI endpoint, and the cache-waste estimate. This is a bug fix disguised as a feature port.
**Also:** adopt their `isBillable` gate so unknown/local models render `n/a` instead of `$0`, and add a single unit test asserting `calcCost('claude-opus-4-8', 1e6,0,0,0) === 5.00`.
**Improve on them while porting:** split cache-creation by TTL. Read `message.usage.cache_creation.ephemeral_5m_input_tokens` and `.ephemeral_1h_input_tokens` alongside the aggregate `cache_creation_input_tokens`, and price the 1-hour bucket at 2× the 5-minute rate. Upstream ships this bug today (their #162); we can land the port already fixed. Anthropic documents the subscription cache lifetime as one hour, so for our Max/Pro users the 1-hour bucket is likely the majority — the upstream reporter measured 78%. **Verify the field is actually present in our corpus first**; if Claude Code omits it, fall back to the current flat rate and say so in the UI.

### 2. Dedupe streaming turns by `message.id` — **S**
**Take:** `scanner.py:324, 439–443`.
**Lands in:** the per-file parse loop in `collectUsage()`, `server/index.mjs:668–692`. Keep a `Map` from `j.message.id` → entry within the file, overwrite on collision, and push `[...map.values()]` plus the id-less entries at file end. Recompute `rec.cost/in/out/cc/cr/msgs` from the final list rather than incrementally.
**Unlocks:** removes a class of over-counting we currently have no defence against. **Verify first** on a real transcript that duplicate `message.id`s actually occur — independent measurement (ccusage #866) reports 51–55% duplicate `requestId` entries in real corpora, so this is very likely a live over-count for us, not a theoretical one. `phuryn/burnstop` calls the same rule one of its "two load-bearing invariants".
**Pair it with a measurement.** Before and after, log total tokens per day and diff. If dedupe removes ~half, we have been over-reporting; if it removes nothing, note that our JSONL shape differs and move on. Either result is worth writing down — see Gap #4 on how unreliable this whole data source is.

### 3. Cost by Project & Branch view — **S**
**Take:** the concept from `dashboard.py:sec-cost-branch` (1231–1244 aggregation, 1811–1826 render).
**Lands in:** `ProjectsSection.jsx` or `UsagePanel.jsx`, fed from the `rec.branches` map we already build at `server/index.mjs:687–689` but never surface.
**Unlocks:** "what did this feature branch cost" — the single most requested cost question, and we already have 100% of the data.

### 4. Local-date range helpers + named ranges — **S**
**Take:** `dashboard.py:889–931` (`localISODate`, `getRangeBounds`, `RANGE_LABELS`).
**Lands in:** `src/lib/dates.js`, plus replacing `new Date(...).toISOString().slice(0,10)` at `server/index.mjs:741, 1994, 2010`.
**Unlocks:** fixes an existing latent timezone bug (day boundaries shift for UTC+ users, exactly the class of bug their #151 fixed) and gives UsagePanel a proper range selector.

### 5. Subagent attribution ingestion — **M**
**Take:** `scanner.py:is_subagent_record` (235–250), `record_agent_id` (253), `extract_agent_dispatch` (263–289); plus `dashboard.py:AGENT_TYPE_EXPR` (146–150) and the dispatch ranking query (183–204).
**Lands in:** `collectUsage()` in `server/index.mjs` (add `isSubagent` + `agentId` to each entry `e`, and a parallel `agents` map keyed by `agentId`), surfaced in `RunsSection.jsx` or as a new panel in `UsagePanel.jsx`.
**Unlocks:** "which subagent type costs me the most", subagent duration and tool-use counts, and auto-compaction cost broken out — the last being a number nobody currently sees. Complements `CapabilityLedger` (which measures always-on load) with dispatched spend.

### 6. Docker read-only mount — **S**
**Take:** `Dockerfile` + `scripts/run-docker.sh`.
**Lands in:** a new `Dockerfile` at repo root plus `scripts/run-docker.sh`. Node base image, copy `server/` + built `dist/`, mount `-v "$HOME/.claude:/root/.claude:ro"`, keep any writable state in a named volume.
**Unlocks:** turns "local-first, zero telemetry" from a claim into an **enforceable** one a sceptical user can verify with `docker inspect`. High trust-per-line-of-code. Also borrow `--opt com.docker.network.bridge.enable_ip_masquerade=false`.

### 7. Table paging component (10→25→50, ≤12 never pages) + CSV export — **S**
**Take:** `dashboard.py:670–690, 1615–1631` and `dashboard.py:1829–1854`.
**Lands in:** `src/ui/TableFooter.jsx` and `src/lib/csv.js`, then applied across `SessionsSection`, `ProjectsSection`, `RunsSection`, `BugsSection`.
**Unlocks:** consistent large-table behaviour and one-click CSV out of every table. `csvField`/`downloadCSV` copy verbatim; `renderTableToggle`'s three-state logic becomes ~30 lines of JSX.

### 8. Durable usage store — **L**
**Take:** the *pattern* from `scanner.py:init_db` + `processed_files` + the recompute-from-turns step (800–809). Not the code — we have no SQLite dependency and adding one contradicts our "no database" stance.
**Lands in:** a new `server/usage-store.mjs` writing a newline-delimited JSON ledger (or a single JSON file) under our existing meta directory, with a `processed_files` equivalent `{path, mtime, lines}` and an idempotent "recompute all aggregates from the atomic ledger" step.
**Unlocks:** history survives Claude Code pruning transcripts — the one capability upstream has that we structurally cannot replicate without persistence. **Weigh carefully:** this is the largest architectural change in the list and it makes us stateful. If we skip it, we should at minimum document that Loush's history horizon equals Claude Code's retention window.

### 9. Hour-of-day distribution + peak-hour band — **M**
**Take:** `dashboard.py:aggregateHourly` (1337–1359), `PEAK_HOURS_UTC` (697), `displayHourToUTC`/`utcHourToDisplay` (706–719).
**Lands in:** `ActivityTimeline.jsx` or `UsagePanel.jsx`, rendered with d3 rather than Chart.js.
**Unlocks:** "when do I actually work / when do I collide with Anthropic's throttling window". Improve on theirs by respecting Mon–Fri (their comment says weekdays, their code doesn't check) and by computing the PT offset properly instead of hardcoding UTC 12–17.

### 10. Subscription-plan awareness — **M/L**, and it is *ours to build*
**Take:** nothing. Upstream has no plan model. Do **not** wait for it.
**Lands in:** `server/index.mjs:719–740` (extend the existing `activeBlock` computation) + a new plan-limits panel in `UsagePanel.jsx`.
**Unlocks:** we already compute the active 5-hour block and its per-model token totals and expose it as `activeBlock`; `Overview.jsx:180` reads it. Adding a user-selected plan tier, a percent-consumed bar, a reset countdown and a linear depletion forecast on top of that is genuinely small.
**What the docs actually say** (`code.claude.com/docs/en/costs`, verified): usage "resets on a rolling five-hour window and a weekly window"; the windows are **shared across models**, so switching with `/model` does not restore access; there is a *separate* model-specific Opus limit; and Anthropic explicitly describes its own `/usage` numbers as approximate and computed from local session history. So a rolling 5-hour window is the right unit, and we already have it.
**Caveats, and they are load-bearing:**
- Published per-plan numbers (Pro 40–80h Sonnet; Max 5× 140–280h Sonnet + 15–35h Opus; Max 20× 240–480h Sonnet + 24–40h Opus) come from Anthropic's 2025 Sonnet 4 / Opus 4-era announcement and are **stale/unverified for 2026**. 5-hour limits were reportedly **doubled on 2026-05-06**. Do not hardcode these.
- Limits are expressed in *hours/messages* and vary with context size and model, not in tokens. Any token-denominated bar is a **calibrated estimate**, not ground truth, and must be labelled as such — ideally self-calibrating from the user's own observed rate-limit events rather than from a constants table we'd have to chase.
- The weekly cap needs its own window; our `BLOCK` logic only covers the 5-hour one. `cli.py:cmd_week` upstream is calendar-week aggregation, not a cap model — don't copy it thinking otherwise.
**Prior art to read first:** `ccusage`'s `blocks` report and its cost-modes design (auto / calculate / display — it prefers Claude's own `costUSD` field when present, which is a better idea than always recomputing), `Maciek-roboblog/Claude-Code-Usage-Monitor` (P90 burn-rate forecasting, reset timers, and it now reads the official statusline `rate_limits` — that last is probably the correct data source and would sidestep the calibration problem entirely), and `phuryn/burnstop` for the enforcement side.

### Explicitly **not** recommended
- The single-file HTML-in-a-string frontend — we have React and Vite; this is a downgrade.
- The Chart.js CDN dependency — contradicts local-first; we have d3 bundled.
- SQLite — see #8; the pattern is worth more than the dependency.
- A Homebrew formula — our runtime is Node, not Python; `npx` is the equivalent distribution story.

---

## Sources

**Primary (all fetched 2026-07-29):**
- Repo landing + API metadata: `https://api.github.com/repos/phuryn/claude-usage` — stars 2082, forks 386, open issues 15, `spdx_id: MIT`, created 2026-04-07, pushed 2026-07-10.
- Full README: `https://raw.githubusercontent.com/phuryn/claude-usage/main/README.md`
- Full source tree: `https://codeload.github.com/phuryn/claude-usage/zip/refs/heads/main` (58 files), read locally. Files cited: `scanner.py`, `cli.py`, `dashboard.py`, `Dockerfile`, `scripts/run-docker.sh`, `pyproject.toml`, `Formula/claude-usage.rb`, `LICENSE`, `CHANGELOG.md`, `AGENTS.md`, `CLAUDE.md`, `vscode-extension/package.json`, `vscode-extension/src/port-allocator.ts`, `tests/*`.
- Screenshot: `docs/screenshot.png` (VS Code sidebar, dated 2026-06-21 in-image).
- VS Code Marketplace: `PawelHuryn.claude-usage-phuryn`; Open VSX: `PawelHuryn/claude-usage-phuryn`.
- Author/homepage: https://www.productcompass.pm
- Companion project badged in README: https://github.com/phuryn/burnstop

**Our repo (for comparison):**
- `E:\AI-Dashboard\server\index.mjs` — `collectUsage` (656–716), `PRICE_PER_M` (718), 5-hour `BLOCK`/`activeBlock` (719–740), `entryCost` (1987), `costAlerts` (1988–2001).
- `E:\AI-Dashboard\lib\harness-usage-trends.mjs` — anomaly detection, cost projection, cache-TTL impact.
- `E:\AI-Dashboard\src\sections\UsagePanel.jsx`, `Overview.jsx` (activeBlock consumer, line 180), `CapabilityLedger.jsx`.

**Upstream issues cited** (state as of 2026-07-29):
- #162 (open, 2026-07-25) — cache-TTL mispricing; PR #163 open. https://github.com/phuryn/claude-usage/issues/162
- #160 (open, 2026-07-23) — subagent / multi-model attribution; PR #165 open. https://github.com/phuryn/claude-usage/issues/160
- #145 (open, 2026-06-21) — Max users misreading API prices as subscription cost.
- #151 — per-model-before-aggregation costing + the `toISOString()` month bug (fixed in v1.5.5).
- #140 — subagent attribution feature. #147 — session titles. #144 — pyproject. #143 — Docker. #46 — Homebrew.
- #108 (closed, 2026-05-06) — reported as removing peak-hour highlighting; **the code still contains it on `main`, so this is unverified.**
- #7, #82 (closed) — pricing table duplicated/inconsistent across CLI, dashboard and README.
- #5 (closed) — stored XSS via unescaped `innerHTML`.
- #88, #90, #93, #99, #126, #130 — `ReferenceError: cutoff is not defined` blank-dashboard run, April–May 2026.

**Anthropic primary documentation:**
- https://code.claude.com/docs/en/costs — rolling five-hour + weekly windows, shared across models, separate Opus limit, `/usage` described as approximate and computed from local session history, subscription cache lifetime one hour vs five minutes on API/credits.
- https://claude.com/pricing#api — the price source upstream attributes ("as of June 2026"). Not independently re-verified in this pass; the numbers reproduced above are what the upstream code contains.
- https://techcrunch.com/2025/07/28/anthropic-unveils-new-rate-limits-to-curb-claude-code-power-users/ — introduction of weekly caps (2025).
- 2026-05-06 doubling of 5-hour limits and removal of peak-hour reduction: widely reported, **primary Anthropic announcement not loaded — unverified.**

**Accuracy of JSONL-derived cost estimation:**
- https://gille.ai/en/blog/claude-code-jsonl-logs-undercount-tokens/ (2026-02-24) — ~75% of entries with `input_tokens` 0 or 1; 51–55% duplicate `requestId`; input undercount 100–174×, output 10–17×; cache metrics accurate.
- https://github.com/ryoppippi/ccusage/issues/866 (2026-02-24, closed) — corroborating thread.
- https://github.com/ccusage/ccusage/issues/899 (2026-03-20, closed via PR #1221) — the same cache-TTL bug upstream still has, ~19% understatement.
- https://github.com/anthropics/claude-code/issues/6805 — stream-json mode duplicating usage stats ("massive cost inflation"). Also #22686 — partial streaming values saved.

**Competitive landscape** (star counts fetched 2026-07-29):
- `ccusage/ccusage` (formerly `ryoppippi/ccusage`) — **17,542 stars**, 761 forks, now written in **Rust**, active. Has a `blocks` 5-hour-window report and cost modes: https://ccusage.com/guide/cost-modes
- `Maciek-roboblog/Claude-Code-Usage-Monitor` — **8,542 stars**, MIT, Python. Real-time terminal gauge, P90 burn-rate forecasting, reset timers, reads official statusline `rate_limits`. Show HN: https://news.ycombinator.com/item?id=44317012 (245 pts, 135 comments; criticism there includes README style and that it wraps ccusage).
- `phuryn/claude-usage` — 2,082 stars. Differentiation is the **browser dashboard + VS Code sidebar + packaging breadth**, not measurement sophistication.
- `phuryn/burnstop` — 8 stars, MIT, created 2026-06-22.
- `vibe-log/vibe-log-cli` — 337 stars, TypeScript, session-quality rather than spend.
- `sniffdog/claude-code-monitor` — **does not exist** (GitHub returns "Could not resolve to a Repository"). Named in the brief; disregard.
- Name collision to avoid: `ocodista/claude-usage` is an unrelated repo.
- ccusage HN thread: https://news.ycombinator.com/item?id=44610925 (2025-07-18, 75 pts).

**Coverage and launch:**
- https://www.productcompass.pm/p/claude-code-pricing (2026-04-08, the day after repo creation) — the launch vehicle. Claims a $200/mo Max plan covered $1,588 of API-equivalent tokens across 440 sessions / 18,000 turns.
- https://x.com/PawelHuryn/status/2041595776074236328 — launch post (engagement metrics unverified; X returned HTTP 402).
- https://converter.brightcoding.dev/blog/stop-flying-blind-track-every-claude-code-dollar-with-claude-usage (2026-06-30) — promotional review; its caveats are no Cowork capture, API≠subscription pricing, no multi-machine sync.
- https://www.toriihq.com/articles/five-claude-code-usage-dashboards-and-monitoring-tools (2026-06-12) — neutral 5-tool comparison that **does not mention claude-usage**.
- https://trendshift.io/repositories/25554 — "#12 Python Repository Of The Day", 2026-04-08.
- No Show HN, no significant Reddit or HN thread for claude-usage was found.

**Note on fetched content:** nothing in the fetched pages or source files attempted to issue instructions to a reading agent. `AGENTS.md` and `.claude/commands/triage.md` in the upstream repo contain instructions addressed to coding agents working *on that repository* (a dirty-worktree git guard, a "never run `git reset --hard`" rule, and a maintainer triage routine that opens/closes GitHub issues). These were read as **data describing upstream's own workflow** and were not executed or followed.

**Confidence note:** everything under Identity, Feature inventory, Architecture, The cost model and Notable code was read directly from the v1.5.5 source and is verifiable by re-reading the cited line numbers. Everything under Gaps #1/#2/#3/#4/#16/#18 and the competitive landscape comes from web research by a sub-agent and is cited but not independently re-verified line-by-line by the author of this document.
