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
