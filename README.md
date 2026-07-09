# Claude Code Dashboard

**Design system**: dark-first, warm (base `#0d0b0a` with clay/violet radial glows; glassy panels `rgba(28,24,21,0.55)` + blur; clay-orange accent `#d97757`). Type: Space Grotesk (headings/stats), IBM Plex Sans (body), IBM Plex Mono (labels/identifiers/data). Fonts load from Google Fonts (offline falls back to system fonts). Lists over ~10 items paginate (Inventory 15/page, Projects 9, resource lists 20, artifacts 60, CSV/JSON tables 100).

**Extra metrics parsed from transcripts** (all cached per-file by mtime): tool-call counts per tool (from `tool_use` blocks), lines added/removed (from Edit-tool `structuredPatch` diffs), sessions in 30d, recent sessions, per-project 14-day sparklines, and estimated cache savings (cache-read tokens × 90% of the model's input price — an estimate, labeled as such). Project cards add git commit counts (`git rev-list --count`) and language chips (file-extension histogram, 10-min cache).

Local web UI to view and manage the real files that power your Claude Code setup. Not a mock — every write goes to the actual config files, with a timestamped backup taken first.

## Start

```
cd dashboard && npm run dev
```

Opens http://localhost:5177 (frontend, Vite) proxying to the API on :5178 (Express). First time only: `npm install`.

## Sections — what they read/write

| Section | Reads / writes | Notes |
|---|---|---|
| **Overview** | reads everything below + `~/.claude/projects/**/*.jsonl` (session transcripts); writes only `~/.claude/dashboard-meta.json` (tags) | Stat tiles: current **5-hour usage window** (tokens/messages in the active block, per-model split, time until reset — blocks computed ccusage-style: 5h windows hour-floored at first activity), **most-used models** across all sessions, always-loaded context cost, biggest on-invoke item. Inventory of skills/commands/agents/templates/MCP/plugins with: **Ctx always** (description tokens paid every session), **Ctx on invoke** (full file tokens when triggered, ~4 chars/token), **Level** (poor <45 / good 45–69 / excellent 70–89 / perfect ≥90 — static heuristic: frontmatter completeness, trigger clarity, structure, size), **Specificity** (how precisely the description says when to trigger), auto **groups** (gsd/loush/ticket… prefixes) and click-to-edit **tags** stored in the sidecar meta file — never written into your skill files. First load parses ~360MB of transcripts (a few seconds); a per-file mtime cache makes later loads instant. |
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
| **Career dashboard** | `⇄ Career` top-chip / `?dash=career` | Personal career-development shell: seven panels (Me/Now, Tasks + reco + risk + acted-on, Flow/SPACE, Quality/DORA, Insights/project, Brag + retro + promo, 1:1 Prep + log). Reads `~/.claude/usage-data/{facets,session-meta}`, taskboard, bugs. Writes `~/.claude/career.json` (versioned). Bug counts: escaped defects only (review findings tracked separately). Refresh: incremental (mtime-cached). |
| **Chat Insights** | sidebar → Chat Insights | Stats tab: chats, one-shot rate, cost/chat, day×hour heatmap, correction/abandon/reuse rates, leaderboards. Duplicate prompts tab: exact+fuzzy (Jaccard) clusters with **save as command** / **send to Prompt Studio** actions; similarity slider, project + time filters. |
| **Inbox** | sidebar → Inbox | One queue: sessions waiting on input, pending approvals, budget alerts, failed evals, error recommendations. Also: Daily digest tab (shipped commits, spend, drift, attention items) and Notifications tab (desktop + Slack webhook; the server pushes new error/warning items every 60s while running). Sidebar shows an open-count badge. |
| **Team designer** | Agent Teams → 🛠 Team designer | Compose a team (members with brief, model, agent type, inputs/outputs, artifacts, initial tasks, skills, MCP connectors, ADRs). Live static config checklist, plus **✦ AI review**: a real `claude -p` pass that scores the design, gives per-member verdicts (keep / **just-a-prompt** / unnecessary / merge), derives IO contracts, artifacts, task lists, per-member skills/connectors/ADRs, the collaboration map, and risks (costs a few cents). "Launch team" hands the kickoff prompt to Chat. Designs persist in `~/.claude/team-designs.json`. The **⚡ Enable agent teams** button writes the experimental env flag to global settings.json (versioned; takes effect next CLI session). |
| **Bugs** | sidebar → Bugs | Bug triage workspace (`~/.claude/bugs.json`): paste a trace/log/link — file paths, functions and stack frames auto-extracted. **Auto-bisect** runs real `git bisect` against your repro command and surfaces the culprit commit + author + diffstat. **Root-cause session** prefills Chat with the trace, `@suspect-files` and `git blame` context. Marking fixed records the active config version; regression-test generator and a copyable `gh pr create` command included. Filter by project/severity/status/age. |
| **Hooks (extended)** | sidebar → Hooks | Real Claude Code hooks as first-class config: visual per-scope list with add/remove, **matcher tester** (live regex vs sample tool), **dry-run** (runs the actual command with a sample tool-call payload on stdin → allow/BLOCK/latency), **health** (firings by event parsed from transcripts, blocks observed), and a one-click **pattern library** (block-prod-file-edit, secret-scan-pre-write, require-tests-before-stop, log-tool-usage). |
| **CI eval gate** | Reliability → CI gate | Generates the GitHub Action / GitLab CI config that runs the eval suite headlessly on PRs touching `.claude/` (evals copied into the repo), with a configurable merge-blocking pass-rate threshold. CI runs shown inline via `gh`, tagged CI vs manual. Dry-run preview before writing. |
| **Quality** | sidebar → Quality | Three tabs. **Analytics events** (28): live registry of tracking calls (`.track/.capture/logEvent/…`) with file:line, naming-convention + taxonomy validation (`.claude/analytics-taxonomy.json`, bootstrappable from code), and an uncommitted-diff drift check so bad event names never land. **Design drift** (29): diffs code components vs `.claude/design-manifest.json` (missing-in-code / prop-drift / undocumented, Figma frame links) + Figma MCP call budget from transcripts; feeds Recommendations. **Review loop** (30): /review & /security-review history parsed from `ReportFindings` calls in transcripts — findings with fixed/dismissed outcomes, per-finding source (main vs subagent), and a recurring-finding detector that recommends a blocking hook. |
| **Task Board** | sidebar → Task Board | Agentic kanban per project (`~/.claude/taskboard.json`, every write versioned). Paste JIRA content → ticket; **✂ analyze** proposes an editable sub-ticket breakdown (real `claude -p` pass). **▸ Start** creates an isolated git worktree branch under `~/.claude/board-worktrees/` and runs a headless dev agent; done → Code Review (idle). **Review / QA / Release are always manual triggers**: review agent returns severity-tagged findings (auto-fix loop capped at 3 → Blocked), clean review auto-provisions the **preview env** (per-project plug-in command; first printed URL becomes the QA base URL; build failure → Blocked; idle teardown). QA agent derives AC + test cases from the ticket + changed files, executes them, and **auto-files failing cases as linked bug sub-tickets** with evidence + exact commit. Release = human gate: per-repo **merge queue** with rebase-first, conflict → Blocked with hunks (or require-PR mode that only hands you a `gh pr create`). **Blocked** is first-class — distinct from idle-waiting, shows the agent's own question, reply inline to resume the same session (`--resume`), surfaces in Inbox as an error. **Agent teams** (dev/review/QA model + instructions, versioned) and **pipeline templates** (custom stages, WIP limits, versioned — in-flight tickets keep the version they started on) configured in the Setup tab. Deps (blocks/blocked-by) enforced at start; stacked branches base on their blocker's branch; overlapping-file conflict warnings across in-flight branches. Every run logs its **context handoff** (what was passed vs deliberately excluded — e.g. QA never sees review findings unless opted in). |
| **Task Board analytics** | Task Board → analytics | All computed live from ticket history/runs: funnel + column counts, avg/p90 time-in-column, cycle p50/p90, throughput per day, bug ratio (QA bugs ÷ released), QA-cycles-per-ticket distribution, blocked-time by reason, per-team and per-model quality tables (released, cycle, bug ratio, findings, escalations, human touches, cost), cost by stage (dev/review/QA), cost per released vs sunk in unreleased, stale regression-case detector. |
| **⌘K palette** | anywhere | Jump to any section/project/skill/agent/MCP server, run actions (evals, scaffolder), full-text search across chat prompts (3+ chars). |
| **Scaffolder** | Projects → "+ Scaffold harness" | Pick a profile and/or clone another project's setup; dry-run preview, then writes `.claude/settings.json`, starter CLAUDE.md, chosen skills, and registers the project in `~/.claude.json`. |
| **Batch ops** | Governance → Batch ops | Set a settings field / enable-disable a skill / push a CLAUDE.md rule / sync drift across many projects at once. Dry-run required before apply; every write versioned. |
| **Quick capture** | Chat, hover any message → ⤴ | Promote a message to a command, skill, Prompt Studio entry, or note (`~/.claude/notes/`). |
| **Pins & resume** | Chat session lists → ☆ | Pin/label sessions (stored in dashboard-meta.json with the config version active at pin time); pinned surface on Overview and resume in one click. |
| **Context bundles** | Library → Context bundles | Named sets of file refs/URLs/notes (`~/.claude/context-bundles.json`); "Load in chat" prefills a session prompt with `@ref` lines. |

## Creating & editing

**+ New** opens a right-side drawer with type-specific fields (skills: name/description/argument-hint/allowed-tools; agents add tools/model/color; MCP: transport, command/args/env or URL). **Edit fields** on any detail view opens the same drawer prefilled from the parsed frontmatter — saving rewrites only the frontmatter block in the on-disk conventions (quoted strings, YAML lists, inline agent tools) and preserves the markdown body, including unsaved inline-editor changes. The body itself is still edited inline with the CodeMirror editor.

## Gamification (Overview)

- **Setup health ring** — average quality score of all scored items, colored by band.
- **Pilot level** — XP from all-time assistant messages (level n = n²·50 msgs) with progress to next level.
- **Streak** — consecutive days with session activity (today idle doesn't break it) + total active days.
- **Achievements** — 10 badges computed from live data (Skill Collector, Hook Master, Perfectionist, Context Saver, …). All client-side, nothing stored.
- **Charts** — 30-day daily output-token bars, model usage bars, quality distribution. Single accent hue for magnitude; level colors reserved for the quality bands.

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
server.mjs           Express API (CRUD, backups, MCP test-connect, artifact scan)
src/App.jsx          sidebar + section switch
src/ResourceSection  generic skills/commands/agents CRUD + preview
src/McpSection       server list, JSON editor, live test-connect
src/HooksSection     per-scope hook summary + JSON editor
src/ArtifactsSection grid, filters, viewer actions
src/viewers.jsx      per-type renderers
```
