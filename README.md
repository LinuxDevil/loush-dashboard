# Claude Code Dashboard

**Design system**: dark-first, warm (base `#0d0b0a` with clay/violet radial glows; glassy panels `rgba(28,24,21,0.55)` + blur; clay-orange accent `#d97757`). Type: Space Grotesk (headings/stats), IBM Plex Sans (body), IBM Plex Mono (labels/identifiers/data). Fonts load from Google Fonts (offline falls back to system fonts). Lists over ~10 items paginate (Inventory 15/page, Projects 9, resource lists 20, artifacts 60, CSV/JSON tables 100).

**Extra metrics parsed from transcripts** (all cached per-file by mtime): tool-call counts per tool (from `tool_use` blocks), lines added/removed (from Edit-tool `structuredPatch` diffs), sessions in 30d, recent sessions, per-project 14-day sparklines, and estimated cache savings (cache-read tokens × 90% of the model's input price — an estimate, labeled as such). Project cards add git commit counts (`git rev-list --count`) and language chips (file-extension histogram, 10-min cache).

Local web UI to view and manage the real files that power your Claude Code setup. Not a mock — every write goes to the actual config files, with a timestamped backup taken first.

## Start

```
cd dashboard && npm run dev
```

Opens http://localhost:5177 (frontend, Vite) proxying to the API on :5178 (Express). First time only: `npm install`.

## The two data planes

Every panel declares which plane it draws from, and the boundary is enforced in the server, not in policy.

- **Plane A — work artifacts** (JIRA tickets, GitHub PRs, reviews, CI, bugs). Already visible to everyone on the team, therefore safe to show per person. This is the Delivery section and the `work` half of the Inbox.
- **Plane B — harness telemetry** (transcripts, tokens, cost, session hours). **One machine's private data, self-only, forever.** No endpoint accepts a machine or user parameter for transcript data and none ever will. This is the Harness and Capabilities sections and the `harness` half of the Inbox.

The only join between them is `/api/roi`, which **drops the author/assignee field before aggregating** — cohorts only, never a person. There is no "team Claude Code adoption", no tokens-per-engineer, no cost-per-engineer, no active-hours panel, and no leaderboard. That is a boundary, not a preference: measure the work (cycle time, escaped defects, review latency), not the keystrokes.

**There is no view / lens / role switcher anywhere in this app.** The planes are a server-side boundary, not a UI mode — they surface only as two filter chips on the Inbox, both on by default.

## Sections — what they read/write

| Section | Reads / writes | Notes |
|---|---|---|
| **Overview** | `/api/eng/snapshot` (plane A) + `/api/usage`, `/api/ci/health`, `/api/capabilities` (plane B) | Answers one question: *what needs a human today?* Five delivery tiles — **in flight** (+ how many are past their stage budget), **shipped 30d** with a 12-week sparkline, **cycle p50/p90** with a delta vs the previous 30d, **at-risk commitments**, **review queue** with the oldest wait in working days. Every tile links into the section that explains it. Below them: a cross-repo **CI strip** that goes red when a default branch is red, the capability-ROI headline, four harness KPIs, top projects **ranked by sessions** (not by output tokens — that rewarded whichever project made Claude write the most text), recent sessions and recalled memory. If the eng snapshot is not configured it says so; it never renders a fabricated zero. |
| **Inbox** | `/api/inbox`, `POST /api/inbox/done` | Every item that needs a decision, severity-sorted, with two plane chips (**work** / **harness**, both on). Work items: PRs with zero reviews past the 24/48 working-hour SLA, tickets past their stage budget, ≥3 QA cycles, rework re-entry, a JIRA status stale against a merged PR, a red main. Per row: **nudge** (copies a ready-to-send line naming the ticket, who is waiting and how long — *it never sends anything, ever*), **snooze 24h**, **open** (deep link), **clear**. Badge + 60s poll + desktop/Slack notification are wired to this. |
| **Delivery** | `/api/eng/snapshot?project=all` (plane A) | The Engineering Metrics dashboard, **folded into this shell** — the four-shell portal is gone, because the split was the defect: the only genuinely team-wide data in the repo used to sit behind a chip nobody clicked. Tabs: **Engineering** (the whole Eng app: Attention Queue, Review flow, Quality, Investment, Predictability, Epics, CI, Load, Board, Members, OKRs, Export), **Idea → prod funnel** (median working-days per stage over 90d, split queue vs active, p50/p90, headlined by lead time − cycle time = "time it sat waiting on us"), **AI ROI** (cohort only), **1:1 prep**. |
| **Capabilities** | `/api/capabilities`, `POST /api/capabilities/archive` | The **ROI ledger** leads: name / always-on tok / fires 30d / fires 90d / last fired / tok-per-fire / verdict (**DEAD** never fired · **COLD** not in 30d · **HOT**), headlined *"you pay N tok every session for M capabilities — K of them have never fired"*. Select rows → archive: **dry-run first, backed up, reversible** (same versioned write path as everything else). Then Skills / Commands / Agents CRUD, the Flow graph, and — demoted here from the landing page and reframed as an **authoring aid, not a metric** — the Inventory table with its static frontmatter lint. A perfect-scoring skill that never fires is worthless; a scruffy one invoked daily is your most valuable file. |
| **Harness** | transcripts (read-only), `~/.claude/settings.json`, `/api/gov/*` | **Sessions**: sortable ledger with real per-session `$`, out tok, cache-read %, duration, tool calls, compactions, errors; copy `cd <cwd> && claude --resume <id>`, reveal in Finder, open raw. Keyboard layer: `/` focus filter, `j`/`k` move, `y` copy resume, `↵` open. **Forensics**: failure signatures grouped and counted ("this has bitten you 181 times"), context pressure by tool (share of every byte pulled into context, median/p90, HOG flag) with **cap this tool** (installs a PostToolUse hook), and hook blast radius (firings / blocks / block rate / p50-p90 latency) with **disable**. **Usage**: the 18-week output-token heatmap, tool bars and model bars, demoted off the landing page. **Team baseline**: one row per team repo (on-baseline / drifted / never-scaffolded / not-cloned) against a `team-harness.json` committed in a shared repo. Plus Config, Governance, Reliability, Library, MCP. |
| **Labs** | — | Mindwalk (3D repo replay), Agent Squads, Squad Designer. Demos. They cost money per run and they do not outrank delivery data in the sidebar. |
| **Projects** | reads `~/.claude.json` → `projects`, each project's `.claude/{skills,commands,agents}` + `.mcp.json` + `.planning/ROADMAP.md`, and transcripts in `~/.claude/projects/` (read-only) | Card per project Claude Code has opened: **running now** (session/subagent transcript written within the last 5 min — pulsing dot, auto-refreshes every 30s), session count, per-project **token usage** (out / in+cache / messages) attributed from transcripts, most-used model, last-active time, **GSD progress** bar when a `.planning/ROADMAP.md` exists (checked vs unchecked items), and the project's own skills/commands/agents/MCP servers (expandable name lists). The current project is highlighted; deleted-but-remembered projects are flagged. |
| **Skills** | `~/.claude/skills/<name>/SKILL.md` (+ `./.claude/skills` if it exists) | List, edit (CodeMirror), preview (parsed YAML frontmatter + rendered markdown + "what triggers this skill"), create from template, delete. Supporting assets (e.g. `references/*.md`) are listed in the preview. |
| **Prompts / Commands** | `~/.claude/commands/*.md` (+ `./.claude/commands`) | Same CRUD. "Test run" panel substitutes your typed args into `$ARGUMENTS` and shows the exact expanded prompt. |
| **Agents** | `~/.claude/agents/*.md` (+ `./.claude/agents`) | Same CRUD. Preview shows the `tools` list as chips. |
| **MCP Servers** | `~/.claude.json` → `mcpServers` (user scope) and `projects[*].mcpServers` | JSON editor per server. **Test connection** actually speaks MCP: spawns stdio servers / POSTs to http servers with a JSON-RPC `initialize` and reports latency + server name/version. |
| **Hooks** | `~/.claude/settings.json` → `hooks` (user), `./.claude/settings.json` (project), `./.claude/settings.local.json` (local) | Left pane: flattened view of every hook (event, matcher, command, timeout). Right pane: raw JSON editor of the `hooks` block only — the rest of settings.json is preserved untouched. |
| **Artifacts** | read-only scan of `~/.claude` (rename/delete write) | Excluded from the scan: `plugins/`, `node_modules/`, `.git/`, `file-history/`, `paste-cache/`, `telemetry/`, `todos/`, `statsig/`, SQLite/lock files, dotfiles. Cap: 8000 files. |

### Newer sections & global features

| Feature | Where | Notes |
|---|---|---|
| **Flow Graph** | sidebar → Flow Graph | SVG orchestration topology: entry → skills/commands → agents → MCP. Toggle **defined** (parsed from skill/agent bodies) vs **observed** (real invocations from transcripts, edge width = frequency). Click a node to isolate its up/downstream path; flags dead ends (never ran), cycles, and the most-traveled path. Scope-aware. |
| **Career dashboard** | sidebar footer → *switch dashboard* → `⇄ Career` (`?dash=career`) | Personal career-development shell: seven panels (Me/Now, Tasks + reco + risk + acted-on, Flow/SPACE, Quality/DORA, Insights/project, Brag + retro + promo, 1:1 Prep + log). Reads `~/.claude/usage-data/{facets,session-meta}`, taskboard, bugs. Writes `~/.claude/career.json` (versioned). Bug counts: escaped defects only (review findings tracked separately). Refresh: incremental (mtime-cached). |
| **Chat Insights** | sidebar → Chat Insights | Stats tab: chats, one-shot rate, cost/chat, day×hour heatmap, correction/abandon/reuse rates, leaderboards. Duplicate prompts tab: exact+fuzzy (Jaccard) clusters with **save as command** / **send to Prompt Studio** actions; similarity slider, project + time filters. |
| **Inbox — digest & notifications** | sidebar → Inbox | Daily digest tab (shipped commits, spend, drift, attention items) and Notifications tab (desktop + Slack webhook; the server pushes new error/warning items every 60s while running). The Slack push posts to a **channel** — it never @-mentions a person on your behalf. |
| **Team designer** | Labs → Squad Designer | Compose a team (members with brief, model, agent type, inputs/outputs, artifacts, initial tasks, skills, MCP connectors, ADRs). Live static config checklist, plus **✦ AI review**: a real `claude -p` pass that scores the design, gives per-member verdicts (keep / **just-a-prompt** / unnecessary / merge), derives IO contracts, artifacts, task lists, per-member skills/connectors/ADRs, the collaboration map, and risks (costs a few cents). "Launch team" hands the kickoff prompt to Chat. Designs persist in `~/.claude/team-designs.json`. The **⚡ Enable agent teams** button writes the experimental env flag to global settings.json (versioned; takes effect next CLI session). |
| **Bugs** | sidebar → Bugs | Bug triage workspace (`~/.claude/bugs.json`): paste a trace/log/link — file paths, functions and stack frames auto-extracted. **Auto-bisect** runs real `git bisect` against your repro command and surfaces the culprit commit + author + diffstat. **Root-cause session** prefills Chat with the trace, `@suspect-files` and `git blame` context. Marking fixed records the active config version; regression-test generator and a copyable `gh pr create` command included. Filter by project/severity/status/age. |
| **Hooks (extended)** | sidebar → Hooks | Real Claude Code hooks as first-class config: visual per-scope list with add/remove, **matcher tester** (live regex vs sample tool), **dry-run** (runs the actual command with a sample tool-call payload on stdin → allow/BLOCK/latency), **health** (firings by event parsed from transcripts, blocks observed), and a one-click **pattern library** (block-prod-file-edit, secret-scan-pre-write, require-tests-before-stop, log-tool-usage). |
| **CI eval gate** | Reliability → CI gate | Generates the GitHub Action / GitLab CI config that runs the eval suite headlessly on PRs touching `.claude/` (evals copied into the repo), with a configurable merge-blocking pass-rate threshold. CI runs shown inline via `gh`, tagged CI vs manual. Dry-run preview before writing. |
| **Quality** | sidebar → Quality | Three tabs. **Analytics events** (28): live registry of tracking calls (`.track/.capture/logEvent/…`) with file:line, naming-convention + taxonomy validation (`.claude/analytics-taxonomy.json`, bootstrappable from code), and an uncommitted-diff drift check so bad event names never land. **Design drift** (29): diffs code components vs `.claude/design-manifest.json` (missing-in-code / prop-drift / undocumented, Figma frame links) + Figma MCP call budget from transcripts; feeds Recommendations. **Review loop** (30): /review & /security-review history parsed from `ReportFindings` calls in transcripts — findings with fixed/dismissed outcomes, per-finding source (main vs subagent), and a recurring-finding detector that recommends a blocking hook. |
| **Task Board** | sidebar → Task Board | Agentic kanban per project (`~/.claude/taskboard.json`, every write versioned). Paste JIRA content → ticket; **✂ analyze** proposes an editable sub-ticket breakdown (real `claude -p` pass). **▸ Start** creates an isolated git worktree branch under `~/.claude/board-worktrees/` and runs a headless dev agent; done → Code Review (idle). **Review / QA / Release are always manual triggers**: review agent returns severity-tagged findings (auto-fix loop capped at 3 → Blocked), clean review auto-provisions the **preview env** (per-project plug-in command; first printed URL becomes the QA base URL; build failure → Blocked; idle teardown). QA agent derives AC + test cases from the ticket + changed files, executes them, and **auto-files failing cases as linked bug sub-tickets** with evidence + exact commit. Release = human gate: per-repo **merge queue** with rebase-first, conflict → Blocked with hunks (or require-PR mode that only hands you a `gh pr create`). **Blocked** is first-class — distinct from idle-waiting, shows the agent's own question, reply inline to resume the same session (`--resume`), surfaces in Inbox as an error. **Agent teams** (dev/review/QA model + instructions, versioned) and **pipeline templates** (custom stages, WIP limits, versioned — in-flight tickets keep the version they started on) configured in the Setup tab. Deps (blocks/blocked-by) enforced at start; stacked branches base on their blocker's branch; overlapping-file conflict warnings across in-flight branches. Every run logs its **context handoff** (what was passed vs deliberately excluded — e.g. QA never sees review findings unless opted in). |
| **Task Board analytics** | Task Board → analytics | All computed live from ticket history/runs: funnel + column counts, avg/p90 time-in-column, cycle p50/p90, throughput per day, bug ratio (QA bugs ÷ released), QA-cycles-per-ticket distribution, blocked-time by reason, per-team and per-model quality tables (released, cycle, bug ratio, findings, escalations, human touches, cost), cost by stage (dev/review/QA), cost per released vs sunk in unreleased, stale regression-case detector. |
| **⌘K palette — search my past self** | anywhere | Jump to any section/project/skill/agent/MCP server, run actions (evals, scaffolder), and **search everything Claude ever said, ran or edited**: your prompts, assistant text, bash commands and Edit hunks, filterable by kind. The killer filter is the file box — *"only sessions that touched `src/auth.ts`"* answers "what has Claude ever done to this file", which the old prompt-only search literally could not express. `↵` copies the session's `cd <cwd> && claude --resume <id>`. |
| **Scaffolder** | Projects → "+ Scaffold harness" | Pick a profile and/or clone another project's setup; dry-run preview, then writes `.claude/settings.json`, starter CLAUDE.md, chosen skills, and registers the project in `~/.claude.json`. |
| **Batch ops** | Governance → Batch ops | Set a settings field / enable-disable a skill / push a CLAUDE.md rule / sync drift across many projects at once. Dry-run required before apply; every write versioned. |
| **Quick capture** | Chat, hover any message → ⤴ | Promote a message to a command, skill, Prompt Studio entry, or note (`~/.claude/notes/`). |
| **Pins & resume** | Chat session lists → ☆ | Pin/label sessions (stored in dashboard-meta.json with the config version active at pin time); pinned surface on Overview and resume in one click. |
| **Context bundles** | Library → Context bundles | Named sets of file refs/URLs/notes (`~/.claude/context-bundles.json`); "Load in chat" prefills a session prompt with `@ref` lines. |

## Creating & editing

**+ New** opens a right-side drawer with type-specific fields (skills: name/description/argument-hint/allowed-tools; agents add tools/model/color; MCP: transport, command/args/env or URL). **Edit fields** on any detail view opens the same drawer prefilled from the parsed frontmatter — saving rewrites only the frontmatter block in the on-disk conventions (quoted strings, YAML lists, inline agent tools) and preserves the markdown body, including unsaved inline-editor changes. The body itself is still edited inline with the CodeMirror editor.

## What was deleted, and why

The gamification layer is **gone** — deleted, not hidden behind a flag.

- **Pilot Level, the XP bar, the 🔥 streak, the 10 achievement badges, the `Lv N · 🔥Nd` topbar chip.** XP was literally all-time assistant *message count*, so the fastest way to level up was a long, thrashing, unproductive conversation: the metric rewarded exactly the behaviour the tool exists to reduce. And a token-count level plus a streak is one product decision away from a per-engineer leaderboard, at which point every number on the screen stops being trusted. `src/Gamification.jsx` no longer exists.

Demoted rather than deleted:

- **Setup-health ring, the Level/Specificity columns, the Quality distribution panel** → Capabilities, as an authoring aid. All three rendered the same static frontmatter heuristic. That is a linter, not a metric. What replaced it as *the* metric is fires × always-on cost (the ROI ledger).
- **"cache saved $"** → out of the KPI row, down to small type on the Sessions page. It is an estimate (90% of input price) × an estimate (~4 chars/token), measured against a counterfactual that never happened, and it only ever goes up. No decision hangs on it.
- **The Inventory table** → Capabilities. **Tool-usage bars, model bars, the 18-week output-token heatmap** → Harness → Usage. The heatmap is a green-squares clone measuring token volume — a proxy for "was he typing", and the first panel anyone would screenshot to judge someone.
- **Mindwalk, Agent Teams, Team Designer** → one collapsed **Labs** entry.
- **The four-shell portal.** Eng folded in as the Delivery section. Cursor and Career moved out of the topbar into a sidebar-footer *switch dashboard* menu — being one click from an IC's Overview is precisely what made this app feel like it was watching him.

Two things this app will never do: **auto-nudge** (every nudge copies a line for a human to send) and **ingest another engineer's transcripts, tokens or active hours**.

## API — panels' backing data

| Endpoint | What |
|---|---|
| `GET /api/inbox[?plane=work\|harness]` · `POST /api/inbox/done` | Every attention item; `{key,done}` clears, `{key,snoozeHours:24}` defers |
| `GET /api/eng/snapshot?project=all` | The plane-A delivery snapshot (JIRA changelog + GitHub PRs), 2h cache |
| `GET /api/ci/health?days=14` · `POST /api/ci/rerun` | Cross-repo default-branch failure rate, time-to-green, flakes, `mainRed` |
| `GET /api/capabilities` · `POST /api/capabilities/archive` | The ROI ledger; archive is dry-run → backed up → reversible |
| `GET /api/forensics?days=30` | Failure signatures · context pressure by tool · hook blast radius |
| `GET /api/sessions?days=7` | Session ledger with real `$` and a `resume` command per row |
| `GET /api/roi?days=90` | Cohort AI $/shipped-point. Author/assignee dropped before aggregation |
| `GET /api/search?q=&file=&kind=` | Prompts, assistant text, bash commands, Edit hunks; `?file=` = "only sessions that touched this path" |
| `GET /api/gov/team` · `POST /api/gov/team/{baseline,export,sync}` | Team harness baseline + per-repo drift |
| GET /api/cursor/export?kind=sessions\|bubbles\|blame\|tools\|spend\|accept\|join&days=N | Raw NDJSON dump of any Cursor panel's backing rows (local plane only) |

## Backups

Before **any** destructive write (save, delete, rename target overwrite, settings/mcp edits), the current file (or whole skill directory) is copied to:

```
~/.claude/dashboard-backups/<ISO-timestamp>__<full~path~with~tildes>
```

Nothing auto-prunes this directory; clean it out yourself occasionally.

## How the artifact viewer picks a renderer

By file extension, in `src/viewers.jsx`:

- `.md` → rendered markdown (marked)
- `.html` → sandboxed `<iframe sandbox="allow-scripts">` (no same-origin, no top-navigation, no forms)
- `.svg` → rendered via `<img>` (scripts inside the SVG can never execute in an img)
- `.png .jpg .jpeg .gif .webp` → image preview on a checkerboard
- `.csv` → parsed (quote-aware) into a sortable table, first 1000 rows
- `.json` → array-of-objects becomes a sortable table; anything else pretty-printed
- `.jsx .tsx` → live-mounted in a sandboxed iframe using React + Babel standalone from CDN (imports are stripped; needs internet; if no component is found, flip to Source)
- everything else (`.py .js .ts .sh .jsonl …`) → syntax-highlighted read-only CodeMirror with a copy button

Every artifact has a **Rendered / Source** toggle, plus Reveal in Finder, Copy path, Download, Rename, Delete.

Files over 2 MB are not rendered inline (use Download). Text content is fetched via `/api/artifacts/content`, binaries streamed via `/api/artifacts/raw`.

## Risks & mitigations

- **Untrusted HTML/JSX artifacts contain arbitrary code.** They are rendered only inside `sandbox="allow-scripts"` iframes: no cookies/localStorage access to the dashboard origin, no parent-frame access, no navigation. Don't add `allow-same-origin` — that would let a malicious artifact call the dashboard API (which can write to your `~/.claude`).
- **The API can write your real config.** It binds to localhost only and refuses any path outside `~/.claude`, `~/.claude.json`, and this project's `.claude/`. Still: anything running on your machine can hit `localhost:5178`. Don't leave it running on shared machines / don't port-forward it.
- **Hooks/settings edits take effect on the next Claude Code session.** A JSON typo is caught client-side before writing, but a *semantically* wrong hook can block tool calls — the timestamped backup is your undo.
- **JSX live preview loads React/Babel from unpkg** — offline it falls back to a message; use the Source toggle.

## Layout

```
server.mjs               Express API (CRUD, backups, inbox, capabilities, forensics, sessions, roi, search, CI)
server-eng.mjs           plane A: JIRA changelog + GitHub PRs → the delivery snapshot
src/App.jsx              sidebar + section switch + sidebar-footer dashboard menu
src/Overview.jsx         the five delivery tiles + CI strip + harness KPIs
src/InboxSection.jsx     plane chips · nudge (copies, never sends) · snooze 24h
src/DeliverySection.jsx  mounts EngDashboard + funnel + AI ROI + 1:1 prep
src/CapabilityLedger.jsx the ROI ledger (+ the demoted Inventory linter)
src/SessionsSection.jsx  session ledger, real $, keyboard layer
src/ForensicsSection.jsx failure signatures · context pressure · hook blast radius
src/TeamBaseline.jsx     team harness baseline + drift
src/Palette.jsx          ⌘K — search my past self (incl. the `file:` filter)
src/viewers.jsx          per-type artifact renderers
```
