# Dashboard plan

## 1. Run-command primitive (BUILT ✓)

Shipped as **Workflows → Quick Actions** (`src/QuickActions.jsx` + `/api/actions/*` in server.mjs):
- `POST /api/actions/run` `{cmd, cwd, args}` — one-shot `claude -p "/cmd"` in the chosen project,
  stored in the existing `chats` map so the existing `/api/chat/:id/events` SSE streams it. Cap: 3
  concurrent runs. On exit: per-run **analysis** (cost, duration, turns, tool counts, files touched,
  skills / agents / MCP invoked — a first slice of §2) + an Inbox item (finished = info, failed = error).
- UI: project picker, buttons (Review branch, Security review, Simplify, Init CLAUDE.md) + free-form
  `/any-command`, runs list, and an output window reusing Chat's block renderer with the analysis on top.

Original spec (kept for reference):

### spec

The one primitive that makes every "quick action" button nearly free: run a headless
`claude -p '/<command>'` against a selected project/branch, stream its output, and drop the
result into Inbox when done. Every action button becomes: pick command + context → POST.

### Server (`server.mjs`)

- `POST /api/run-command`
  - body: `{ cmd: string, cwd: string, args?: string }` — `cmd` is a slash command
    (`/code-review`, `/security-review`, `/simplify`, `/verify-ac`, …), `cwd` is the project dir.
  - validate `cwd` is a known project (from `~/.claude.json` → projects); reject otherwise.
  - spawn `claude -p "<cmd> <args>"` with `cwd`, capture stdout/stderr.
  - return `{ runId }` immediately; keep the child in an in-memory `runs` map.
  - ponytail: in-memory map, no DB. Persist to `~/.claude/command-runs.json` only if runs
    need to survive a server restart — add when someone actually loses a run.
- `GET /api/run-command/:runId/stream` — SSE (or chunked) of the child's stdout as it arrives.
- On child exit: write an Inbox item `{ type:'command-run', cmd, cwd, exitCode, ts, tail }`
  reusing the existing Inbox store so it shows in the badge + notifications.

Notes:
- one shared spawn helper; buttons differ only by `cmd`. No per-command server code.
- cap concurrent runs (e.g. 3) — reject with 429 above that. `// ponytail: global cap, per-project cap if it matters`.
- surface a non-zero exit as an Inbox error (feeds the existing error/notification push).

### Client

- shared `useCommandRun(cmd, cwd)` hook: POST → open stream → render spinner + live log panel.
- reusable `<RunActionButton cmd label />` that reads the current project/branch from context.
- first buttons to prove it (short diffs, fast, no browser): **Review branch** `/code-review`,
  **Security review** `/security-review`, **Simplify** `/simplify`.
- later, contextual buttons where the dashboard already holds the args:
  Task Board ticket → `/verify-ac`, `/loush-test-cases`; Bug → `/loush-bug-fix`;
  project without CLAUDE.md → `/init`.

### Done when
- clicking **Review branch** on a project card spawns the review, streams output live, and
  leaves an Inbox item on completion. Add one button beyond `/code-review` to prove the
  primitive is command-agnostic.

---

## 2. Per-chat "what was applied + impact" (DISCUSS — scope before building)

Goal: for a given session/chat, show what skills / commands / agents / MCP servers / hooks /
rules were in play, WHEN they were invoked, and their impact — plus a per-chat analysis.

Feasibility is already proven by existing parsers (Flow Graph "observed", Hooks health,
Edit `structuredPatch` line counts). Most of this is re-slicing existing data per-session.

### Cheap — reuse parsers we already have (do first)
- **Invocation timeline**: skills/commands/agents/MCP calls for one session, in order, with
  timestamps and count. Flow Graph "observed" already extracts these from `tool_use` blocks
  (`Skill` tool + `mcp__*` names + slash-command expansions) — scope it to one `sessionId`.
- **Hooks fired**: which hooks ran, per event, in this session. Hooks health already parses
  firings from system messages — filter to the session.
- **Impact (heuristic)**: bucket tool calls / files edited / lines +/- / tokens between one
  invocation and the next. Attribution is approximate (a skill colors everything after it) —
  label it "activity after invocation", not "caused by". Lines +/- already come from
  `structuredPatch`; tokens from usage blocks.

### Medium — new but bounded
- **Rules that applied**: not a per-call event. It's "what was loaded into context at start" —
  the cwd project's CLAUDE.md + global CLAUDE.md + any imports. Show as an always-on context
  panel with token cost (Overview already computes always-loaded context cost), not a timeline.

### Skip / defer (YAGNI)
- **ADRs**: not a Claude Code transcript concept. They only exist if the Team designer /
  Task Board recorded them. Only wire "which ADRs applied" if we have an ADR store to match
  against — otherwise there's nothing in the transcript to detect. Defer until ADRs are real.
- Exact causal impact attribution per skill — undecidable from transcripts. Don't pretend to.

### Per-chat analysis
Drill-down of the existing (aggregate) Chat Insights, scoped to one session:
tools used, files touched, cost, duration, correction/abandon/reuse signals, outcome
(one-shot? resumed? abandoned?). Mostly the Chat Insights computations filtered to one session.

### Open questions
- Where does this live — a detail view off Chat Insights, or a tab on the session/pin view?
- Timeline granularity: every tool call, or collapse to skill/agent/MCP boundaries only?
- Is heuristic impact ("activity after X") clear enough, or does labeling it that way mislead?

---

## 3. Agent Teams — takeaways from docs.agentteams.live/guide/beginner-workflow

Their model: project selector → team editor (roles/models/worktrees) → task board
(Todo / In Progress / Review / Done / **Approved**) → task detail (logs + diff + approve / request fixes).
We already have most of it (Team designer, Task Board with worktrees + review/QA agents + merge queue,
Teams inbox/interrupt/shutdown). Worth adopting:

- **Pre-launch git baseline check** (cheap, do it): before Task Board ▸ Start or Team launch, run
  `git status --short` and warn if the tree is dirty — "know which files were already changed so
  review after agents edit is safe." One warning banner, not a blocker.
- **Approve / request-fixes on the task detail** (medium): their Done → Approved distinction = an
  explicit human sign-off per task with a "request fixes" path that reopens the same agent session.
  We have the Release human gate at the pipeline level; adding per-task approve/request-fixes on the
  ticket detail (reusing our Blocked-reply `--resume` mechanism) closes the loop.
- **Goal-quality nudge in the launch prompt** (cheap): their first-goal template = scope + boundaries
  + verification command ("keep edits inside X, run <build cmd> before marking done"). Add a hint/
  placeholder in Team designer's kickoff prompt and Task Board ticket analyze.
- **Keep-team-small guidance**: already covered — Team designer's AI review flags unnecessary/
  just-a-prompt members. No work needed.

Skip: their four-surface layout (we have equivalents), separate runtime selector (we're claude-only).

---

## 4. Gap analysis — agent runners, AI chats + Cursor import (researched 2026-07-06)

Compared against Conductor, Vibe Kanban, Nimbalyst, Claude Squad and current AI-chat UX.
Already covered (no work): parallel worktree runs, kanban orchestration, inbox/notifications,
prompt library, pins, full-text chat search, streaming render, model picker, cost analytics.

### Missing — worth adding, ranked
1. **Human diff review per run/ticket (HIGH)** — the core loop of Conductor/Vibe Kanban is
   run agent → *see the diff in the UI* → approve/merge. We run review *agents* but never show
   the human the actual diff. Add a diff viewer (git diff vs base, per Task Board ticket and per
   Quick Action run) + approve/request-fixes buttons (ties into §3's per-task gate).
2. **Steer a running action (MED)** — Quick Action runs are one-shot; Conductor-class tools let
   you interject. Lazy path: reuse chat's `--input-format stream-json` so a run's window gets the
   same input bar (a run becomes a chat that started with a command).
3. **Session branching (MED)** — fork a chat from any message (`claude --resume <id> --fork-session`
   with truncated history). AI-chat table stakes in 2026; useful for "retry from here with a fix".
4. **Multi-model same-prompt compare (LOW)** — run one prompt across 2 models side-by-side in Chat.
   Niche for a code tool; only if someone asks twice.

### Skip
- Mobile/remote approval app (Nimbalyst) — different product.
- Multi-runtime (Codex/Gemini runners) — we're claude-only by design.
- Cloud VM execution — local-first is the point of this dashboard.

### Cursor import (feasible — verified locally)
`~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (2.0 GB, SQLite):
`cursorDiskKV` holds `composerData:*` (1,010 sessions: createdAt/lastUpdatedAt/name/conversationMap/
codeBlockData) + `bubbleId:*` (83k messages). 64 workspaces map to project paths via
`workspaceStorage/*/workspace.json`. Read with `sqlite3` CLI in `mode=ro` (no new npm dep, no lock
contention with a running Cursor).

### Decision: separate Cursor dashboard, NOT mixed in (2026-07-06) — BUILT ✓

Shipped: `server-cursor.mjs` (mounted in server.mjs) + `src/CursorDashboard.jsx` + topbar
`⇄ Cursor` toggle in App.jsx (`?dash=cursor`). Verified live: 1,011 sessions / 82.5k messages /
183 active days; warm endpoints 2–4ms (snapshot cached by DB mtime with a 60s TTL floor — a
running Cursor touches the DB constantly). Schema notes learned during build:
- `composerHeaders` table is EMPTY in current Cursor builds — sessions come from
  `composerData:*` blobs; workspace mapping from the blob's `workspaceIdentifier` (newer
  sessions) with fallback to each workspace DB's `composer.composerData → allComposers`.
- ~55% of (older) sessions have no recoverable workspace → shown as "(unknown workspace)".
- Insights (duplicate prompts) needs a full blob scan — own cache, slow first hit only.

A **top-bar toggle** switches the whole app between two dashboards: **Claude** (everything that
exists today, untouched) and **Cursor** (its own sections, its own data). No blended stats, no
Cursor rows inside Claude views.

- **Routes fully separate**: everything Cursor lives under `/api/cursor/*`
  (`/api/cursor/overview`, `/api/cursor/projects`, `/api/cursor/sessions`,
  `/api/cursor/session/:id`, `/api/cursor/insights`). Zero changes to existing endpoints.
- **Toggle in the topbar** (`App.jsx`): `mode: 'claude' | 'cursor'` in state + URL param
  (`?dash=cursor`) so it survives refresh. Cursor mode renders its own SECTIONS list;
  sidebar swaps accordingly. Claude mode = exactly today's app.
- **Cursor sections (v1, read-only)**:
  - *Overview* — sessions, messages, active days, day×hour heatmap
  - *Projects* — per-workspace (from `workspaceStorage/*/workspace.json` folder paths):
    session count, last active, messages
  - *Sessions* — list (name, createdAt, message count) → detail view rendering the
    conversation from `composerData` / `bubbleId` blobs
  - *Insights* — duplicate prompts, busiest hours, files most touched (from codeBlockData)
- **Reader**: `sqlite3` CLI spawn in `mode=ro` (macOS-bundled, no npm dep, no lock contention).
  Query only needed keys; cache aggregates keyed by DB mtime (same pattern as transcript cache).
  Parser fails soft — schema is undocumented and shifts between Cursor versions.
- No write features in v1 — Cursor's DB is theirs; we only read.
- No cost display — blobs carry no reliable pricing (counts, not $).

---

## 5. Cursor parity — bring the Claude-dashboard features to Cursor mode (2026-07-06) — BUILT ✓

Shipped: Capabilities (skills/rules/commands/agents list + edit/create/delete, token accounting),
MCP (global + per-project, JSON edit + live JSON-RPC test — tester shared with the Claude side),
Context (always vs on-invoke, per-project filter), Quick Actions (`cursor-agent -p` headless runs
via the shared `/api/actions` plumbing with `runner:'cursor'`; needs one-time `cursor-agent login`).
Writes are backup-first and path-guarded to `~/.cursor/**` + known workspace `.cursor/**` (verified:
traversal attempts → 403). Fun fact found while testing: ct-web-flights pays ≈9.2k tokens of
always-on context per chat, 5.4k of it one `wakeel.mdc` alwaysApply rule.

Feature-by-feature mapping (Claude → Cursor). Already done: Overview, Projects (+per-project
usage & harness), Sessions (+chat analysis), Insights.

| Claude feature | Cursor equivalent | Verdict |
|---|---|---|
| Skills CRUD + token accounting | `~/.cursor/skills/*/SKILL.md`, `~/.cursor/skills-cursor/` (83+19 found) | BUILD |
| Agents CRUD | `~/.cursor/agents/*.md` (31 found) | BUILD |
| Commands CRUD | `.cursor/commands/*.md` per project (2 projects) | BUILD |
| — (Cursor-specific) | Rules `.cursor/rules/*.mdc` (11 projects, 24 files) | BUILD |
| MCP editor + live test | `~/.cursor/mcp.json` (7 servers) + project `.cursor/mcp.json` (9) | BUILD — reuse Claude's MCP tester (generic JSON-RPC) |
| Loaded-context cost (Ctx always / on invoke) | alwaysApply rules + AGENTS.md + .cursorrules + skill/rule descriptions = always; bodies = on invoke | BUILD |
| Quick Actions (headless runs + live window) | `cursor-agent -p --output-format stream-json` (CLI verified on machine) | BUILD v1: launch + streamed output; analysis later |
| Hooks / Flow graph / Task Board / Bugs / Governance / Evals / Teams | no Cursor equivalent (hooks/flow) or Claude-runner-specific (board/bugs) | SKIP |
| Inbox / Artifacts | low value for read-mostly Cursor mode | SKIP |

Architecture stays split: new endpoints under `/api/cursor/*` only; writes get the same
timestamped-backup treatment as the Claude side. Path guard: writes allowed only inside
`~/.cursor/**` or a known workspace folder's `.cursor/**` / `AGENTS.md`.
`cursor-agent` runs reuse the existing `/api/actions` plumbing with a `runner: 'cursor'` param.
