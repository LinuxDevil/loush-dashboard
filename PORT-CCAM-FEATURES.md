# Porting `Claude-Code-Agent-Monitor` features — placement plan

> Written 2026-07-29. Grounded in a read of our nav (`src/App.jsx`), our 39 sections
> (`src/sections/`), our ~190 API routes (`server/index.mjs`), and CCAM's directory listing.
> I read **CCAM's feature table, not CCAM's source** — effort estimates below are for building the
> feature in *our* architecture, not for copying their code.
>
> Prior art: `SPEC-claude-code-agent-monitor.md` already took 7 items from this repo in an earlier
> round. Features 2, 3, 4, 5, 6, 7 of that spec are shipped (`features/043`, `044`, `053`, `055`,
> `058`, git log `7e677ad`, `7797e13`, `e563fec`). This document covers the full README table.

---

## The one architectural decision

The two apps store state in opposite ways, and roughly a third of CCAM's feature list exists only
to service *their* choice.

| | CCAM | Us |
|---|---|---|
| Source of truth | SQLite, populated by hook events | `~/.claude/projects/**/*.jsonl` on disk, read per request |
| Liveness | WebSocket push | 2 s poll of the transcript tail (`/api/live`) + in-memory hook receiver for mid-turn only |
| Getting data in | Startup import, re-import, backfill, fs.watch sync, marker gates | Nothing. The files are already there. |
| User state | DB rows | `config.json`, `projects.json`, `atoms/index.json` |

**Do not port the substrate.** No SQLite, no `ws`, no import pipeline. Where a CCAM feature is
interesting, re-derive it from transcripts. This is not a stylistic preference — our
`hooks-receiver.mjs` header already argues it at length ("Persisting it would create a second store
that can disagree with the transcripts and then has to be reconciled"), and `SPEC-...md` §5 already
ruled WebSocket → SSE.

Consequence: **six CCAM features are free** and need zero code — see group A.

---

## A. Free — architecture already covers it. No work.

| CCAM feature | Why it's already true |
|---|---|
| **Auto-Discovery** | Every read walks `~/.claude/projects`. A session exists the moment its file does. |
| **History Import** | There is no import. `collectUsage()` sees all history on every request. |
| **Pre-Existing Session Detection** | Same — a session running before the server started is just a file with a recent mtime. |
| **Continuous Project Sync** | No marker, no watcher, no gap to close. |
| **Subsessions / Resumed Sessions** | No lifecycle rows to reactivate; status is derived fresh (`lib/session-status.mjs`). |
| **Background Agents** ("without premature completion") | We have no completion state machine to get wrong. |
| **Live Updates** (WebSocket) | Settled in `SPEC-...md` §5 → SSE + 2 s poll, shipped. |
| **Compaction Tracking** | `compactions` on `/api/sessions`, boundaries in Context Explorer, `features/058`. |

The only thing worth adding here is a one-line note in the README so nobody re-litigates it.

---

## B. Have it — worth a cheap enhancement

### B1. Sessions → `Harness › Sessions` *(small)*
`src/sections/SessionsSection.jsx` + `GET /api/sessions` exist. Three real gaps:

- **No server-side search.** Add `?q=` (case-insensitive over id / name / cwd) — the walker already
  visits every row.
- **No offset pagination.** Today: `days` window + `limit` cap, no `total`. Add `offset` + `total`.
- **No human-readable name.** *This is the one that matters.* CCAM's precedence — explicit title →
  ai-title → first user prompt (truncated, tool-result/slash noise skipped) — is correct and cheap:
  the first user message is already in the transcript we walk. Derive `name` once in
  `collectUsage()`, then feed it into Sessions, Now, Activity, and the resume picker. Right now
  every one of those surfaces shows a UUID or a project slug.

### B2. Now → Kanban toggle *(small)*
`LiveSection.jsx` already derives exactly CCAM's column set — `thinking / waiting / idle / error /
unknown`. A list ↔ columns toggle is a rendering change in one file, not a new feature.
`features/092` already specs sessions-as-kanban; `features/069` specs the *why-waiting* reason chip.
Take both. Skip CCAM's separate "Agents" vs "Sessions" board split — our agents nest under sessions
already (`PlanGraph`, `ActivityTimeline`).

### B3. Overview → add a **Health** tab *(medium)*
Their Health tab is 8 panels. Four of them we can build from data we already compute; four are
substrate artifacts:

| Panel | Verdict |
|---|---|
| Composite health ring | **Take**, reweighted. Their formula is `0.4 success + 0.25 cache-hit + 0.25 (100−error) + 0.1 (100−heap%)`. Drop heap% (a Node process stat, not a signal about your agents), renormalise the other three. |
| Cache-hit / error-rate / success-rate gauges | **Take** — `cacheReadPct` and `errors` are already on `/api/sessions`. |
| Tool invocation bar chart (top 8) | **Have** — `UsagePanel.jsx`. Move or link, don't rebuild. |
| Model token distribution | **Have** — `UsagePanel.jsx`. |
| Compaction impact stats | **Have** — `ForensicsSection.jsx`. |
| Subagent effectiveness bars | **Take** — new, small; inputs exist in `historyEvents()`. |
| **Storage engine donut** (record distribution) | **Skip.** We have no storage engine. |
| 5 s auto-refresh on every metric | **Skip.** These are day-scale aggregates; a refresh button is honest and cheaper. |

### B4. Run Claude → `Chat › Chat` *(medium, pick two)*
`ChatSection.jsx` + `/api/chat` SSE already do multi-turn, resume, stream-json → blocks, subagent
nesting under `parent_tool_use_id`, tool-aware rendering, plus `PlanGraph` and `ContextTimeline`
which CCAM does *not* have. Of their extras, ranked by value-per-line:

1. **Live context / token meter** — we already extract `in/cc/cr/out` per turn for
   `ContextExplorerSection`. Wiring it to a progress bar during a run is nearly free. Take.
2. **cwd defaults to `$HOME`, not the dashboard repo** — one line, fixes a real footgun (spawned
   agents inheriting this repo's `CLAUDE.md`/`.mcp.json`). Take.
3. Model / effort / permission-mode pickers — take if not already present.
4. Slash-command autocomplete, `@`-file fuzzy search — genuinely nice, genuinely a few hundred
   lines. Defer to a second pass.
5. Active-runs switcher, typewriter smoothing, `flushSync` batching — skip. Cosmetic; our SSE path
   doesn't have React 18's batching problem in the same shape.

### B5. Claude Config Explorer → `Capabilities` + `Harness › Config` *(small)*
Our strongest existing area — `HarnessSection` (settings + permissions), `ResourceSection`
(skills / commands / agents), `McpSection`, `HooksSection`, `LibrarySection`, `CustomizeSection`,
`server/memory.mjs`. Of CCAM's 12 tabs we're missing four, all trivial file reads:

- **Output styles**, **Marketplaces** (plugin counts from each `marketplace.json`),
  **Keybindings** (`~/.claude/keybindings.json`, grouped, `<kbd>` chips), **Statusline** (config +
  script content).

Two more worth taking:
- **Backup-before-edit** on the writable text surfaces (skills / agents / commands / memory) —
  timestamped copy written *outside* the directories Claude Code scans. We already write to some of
  these; the backup discipline is a genuine safety gap.
- **`fs.watch` on `~/.claude/` → existing SSE bus**, so the page refreshes when the CLI installs a
  plugin behind your back. ~30 lines onto transport we already run.

### B6. Transcript cache tail-cap *(trivial)*
Shipped in `SPEC-...md` §4. CCAM's one addition worth stealing: cap growable per-entry arrays
(`TRANSCRIPT_CACHE_MAX_ARRAY_LEN`, default 1000) at both parse and finalize, so a multi-day session
can't grow one cache entry without bound. ~5 lines in `lib/transcript-tail.mjs`.

---

## C. Genuinely missing — build it

### C1. **Cost Tracking / model pricing** → `lib/pricing.mjs` + `Setup › Pricing` *(medium — do this first)*
**The largest real gap on the list.** Our entire pricing model is 4 regexes and three derived
ratios (`output 5×, cache-write 1.25×, cache-read 0.1×`). Every dollar figure in the product —
Sessions, Overview, Delivery, EngDashboard — rides on it. What's missing:

- A real **per-model 4-rate table** (input / output / cache-read / cache-write), not ratios. The 5 m
  vs 1 h cache-write tiers are different prices and we don't model them at all (`features/030`).
- **Time-limited intro rates** (`intro_until` + intro prices), so a launch promo prices historical
  usage correctly on both sides of the cutoff (`features/027`).
- A **pricing editor in Setup** so a new model's rates don't need a code change.
- **Per-subagent own-cost.** CCAM calls out the bug where a subagent card shows the *session* total.
  Worth checking whether `historyEvents()` has the same bug before shipping the fix.

Keep our `PRICE_PER_M → null` honesty (unpriced model contributes 0, surfaced separately). That's
strictly better than CCAM and must survive the rewrite.

Specs already written: `features/023`, `027`, `028`, `029`, `030`.

### C2. **Session Detail page** → new view, reachable from Now / Sessions / Activity *(medium)*
The biggest *UX* gap. Everything CCAM puts on one page, we have — scattered across three sections
that don't know about each other:

- `ContextExplorerSection` — per-turn context occupancy replay
- `ActivityTimeline` — chronological skill/rule/mcp/file/subagent tree with a scrubber
- `ChatSection` — transcript rendering with tool-aware renderers

This is **assembly, not new logic**: one route that takes a `sessionId`, renders a tile-counter
header (events + events/min, tool calls, subagents, compactions, errors, duration) and stacks the
three existing components as tabs. Reuse the `src/ui/Hub.jsx` / `Drawer.jsx` pattern.

Add CCAM's **waiting-for-input banner** here (reason + explanation + how long) — the hook receiver
already knows `status` and `statusSince`.

### C3. **Activity Feed** → `Harness › Activity` *(medium)*
We have per-session (`ActivityTimeline`) but no cross-session "what is happening everywhere" stream.
New: one route that merges recent events across sessions, plus pause/resume, the filter toolbar
(status / event type / tool / session / text / date range), `Load more`, and an origin prefix
(`project › session › subagent` — the chain is already reconstructed, `features/053`).

### C4. **Alerts** → `Setup › Alerts` *(medium — take half)*
Missing entirely, and useful: the hook receiver is exactly the right place to evaluate rules.

- **Take** the four condition types: event pattern (with N-in-window), inactivity, stuck agent,
  token threshold. Evaluate event-driven rules *after* the ingest write (never slow the hook path),
  time-based on the existing scheduler (`lib/scheduler.mjs`).
- **Take** cooldown dedup and an in-app acknowledge list.
- **Skip** the 14-provider webhook registry. We already have `notify.slackWebhook`. A generic POST
  with optional HMAC covers Slack, Discord, Teams, Zapier, n8n and everything else; a provider
  registry is 14 payload formatters to maintain for a single-user local dashboard.

Spec already written: `features/071`.

### C5. **Model name formatting** → `src/lib/modelName.js` *(trivial — cheapest win here)*
We render `claude-opus-4-7-20260101` raw. A ~15-line pure function → "Claude Opus 4.7", handling
`[1m]` context tags, date/`latest` suffixes, and provider prefixes. Used in Sessions, Usage,
Insights, Chat, Overview. Keep raw names in the pricing editor.

### C6. **Workflows charts** → `Harness › Usage` *(medium — take 3 of 11)*
`d3` is already a dependency; `FlowSection` and `PlanGraph` cover the capability DAG. Of CCAM's 11
sections, three answer a question we can't currently answer:

- **Tool execution Sankey** (`features/070`)
- **Error propagation map** (which agent types fail, and what fails after them)
- **Compaction histogram** (sessions by compaction count, with the stat tiles)

Skip the other eight (collaboration network, model delegation flow, concurrency timeline,
complexity scatter, …) — they're chart-count, not insight-count. Skip the i18n tooltip system
entirely (see D).

### C7. **Workflow Runs journal panel** → `Workflows › Loush Runs` *(small)*
Distinct from C6 and actually valuable: `Workflow`-tool fleets emit no hooks and are reconstructed
from `workflows/wf_<runId>.json` on disk. `RunsSection.jsx` already renders loush runs — add the
`wf_*` journals as a second source with the per-agent token / tool-call / duration breakdown.

### C8. **Statusline** *(small)*
Missing. One script: model, context usage, git branch, per-direction tokens, session cost. We
already have both the pricing and the token extraction. Repo already carries
`SPEC-statusline-widgets.md` and `uppinote20-claude-dashboard-statusline.md`.

### C9. **Update Notifier** *(trivial)*
Non-blocking `git fetch` + ahead-count against `origin/HEAD`, surface `git pull && npm install` with
a copy button. ~20 lines. Never self-pull. Low priority but genuinely one line of value per line
of code.

---

## D. Skip — with the reason

| CCAM feature | Why skip |
|---|---|
| **Notifications (Web Push / VAPID)** | A service worker + VAPID keypair + push server so a notification survives *closing the browser* on a loopback-bound single-user dashboard. Desktop `Notification` (we have it) covers backgrounded tabs. Add if this ever runs remotely. |
| **Remote Data Sources (SSH/scp)** | `SessionsSection.jsx:9` already records the stance: *"There is no user/machine parameter and there never will be."* Reversing that is a product decision, not a port. It also drags in SSH transport, staging dirs, a poller, and a per-session origin tag. |
| **UI Localization (en/zh/vi/ko)** | A permanent tax on every string across 12 k lines of JSX, for a single-operator internal tool. |
| **MCP Server (25 tools, 3 transports)** | *Defer, don't reject.* Letting Claude query its own history through the dashboard is a genuinely good idea — but as a stdio server with ~6 tools over routes we already have, not 25 tools across stdio + HTTP+SSE + REPL. Separate decision, separate day. |
| **Plugin Marketplace (10 plugins, 53 skills)** | That's CCAM's distribution strategy, not a dashboard feature. |
| **Seed Data** | Real transcripts exist on the dev machine. |
| **Data export / restore** | Their export exists because their data lives in a DB. Ours *is* files. |
| **Responsive Design** | Not a portable feature; audit ours on its own terms if it's a problem. |
| **Tabby (cat companion)** | Zero engineering argument either way — pure taste. Say the word and it's a day. |

---

## Suggested order

1. **C1 pricing** — every money number in the app is currently wrong-ish.
2. **C5 model names** + **B6 tail-cap** — an afternoon, both.
3. **B1 session names + search/paging** — unblocks C2 and C3 (both want a readable name).
4. **C2 Session Detail** — assembly of three things we already built.
5. **B2 Kanban toggle** + **B3 Health tab** — visible, cheap.
6. **C3 Activity Feed**, **C4 Alerts (half)**.
7. **B5 config tabs**, **C7 wf journals**, **C8 statusline**, **C9 update check** — fill-ins.
8. **B4 Run Claude meter + cwd fix**, then **C6 charts** if there's appetite.

Groups A and D are ~14 of the ~35 features and cost nothing.
