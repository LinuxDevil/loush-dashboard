# Frontend + Product Feature Map — for ADP Roadmap

Scope: `dashboard/src/*.jsx`, `dashboard/src/{career,eng,cursor,game}/`, and the product docs
(CONTEXT.md, README.md, OS-ROADMAP.md). Backend (`server-*.mjs`, `career-*.mjs`) covered separately.

---

## Product vision (from the docs)

A **local web UI to observe and manage the real files that power a Claude Code setup** — "not a mock;
every write goes to actual config files, with a timestamped backup taken first." It is the
**observability + config-control plane** for agentic development — the piece the reference projects
(agentic-os, claude-os, trinity) lack. The OS-ROADMAP frames it as the seed of a "Claude OS": close
**Gap A (persistent semantic memory / recall)** and **Gap B (autonomy — scheduled `claude -p` runs
landing in the Inbox)** cheaply, reusing context-mode (SQLite+FTS5), native `~/.claude/memory/`,
cron/launchd, and `claude -p`. No leaderboards, no per-engineer surveillance.

**The two data planes** (server-enforced, not a UI toggle):
- **Plane A — work artifacts** (JIRA, GitHub PRs, reviews, CI, bugs). Team-visible, safe per-person. → Delivery + `work` half of Inbox.
- **Plane B — harness telemetry** (transcripts, tokens, cost, session hours). One machine's private data, self-only, forever. → Harness + Capabilities + `harness` half of Inbox.
- Only join is `/api/roi`, which drops author/assignee before aggregating (cohorts only). No leaderboard, ever.

Explicitly deleted: the whole **gamification layer** (XP/levels/streaks/badges) — the metric rewarded
thrashing. The four-shell portal collapsed: **Eng folded into Delivery**; Cursor + Career demoted to a
sidebar-footer "switch dashboard" menu. Two hard rules: never auto-send a nudge; never ingest another
engineer's transcripts.

**Design system**: dark-first, warm (`#0d0b0a` base, clay-orange `#d97757` accent, glassy blurred panels).
Space Grotesk / IBM Plex Sans / IBM Plex Mono.

**Shell** (`App.jsx`): left sidebar of top-level SECTIONS (some are `<Hub>` tab-groups); topbar refresh
chip recomputes the current section's server-cached aggregates (no tokens). Sections lazy-mount on first
visit. `?dash=cursor|career` swaps the whole shell. Inbox badge polls every 60s with desktop/Slack notify.

---

## 1. ADP-aligned sections (the core platform)

These map directly onto ADP layers/paths. Grouped as they appear in the sidebar.

### Overview  — *landing*
- **Sees**: "What needs a human today." Five delivery tiles (in-flight + over-budget count, shipped-30d + 12wk sparkline, cycle p50/p90 + delta, at-risk commitments, review queue + oldest wait). Cross-repo CI strip, capability-ROI headline, 4 harness KPIs, top projects (ranked by sessions), recent sessions, recalled memory. Never renders a fabricated zero.
- **ADP concept**: cross-layer executive rollup — golden-path health + validation + capability ROI in one glance.
- **Interactivity**: read-only; every tile deep-links into its explaining section.

### Inbox  — *attention queue*
- **Sees**: every item needing a decision, severity-sorted, with `work`/`harness` plane chips (both on). Work items: PRs past 24/48h review SLA, tickets past stage budget, ≥3 QA cycles, rework re-entry, stale JIRA vs merged PR, red main. Also a **Daily digest** tab and a **Notifications** tab (desktop + Slack webhook, pushed every 60s).
- **ADP concept**: observability → human-in-the-loop attention routing; the designated **fleet view** for future scheduled runs (Gap B target).
- **Interactivity**: actionable — **nudge** (copies a ready-to-send line, *never sends*), snooze 24h, open deep link, clear (`POST /api/inbox/done`).

### Delivery  (folds in the whole **Eng** app)  — *golden-path delivery metrics*
- **Sees**: tabs — Engineering (Attention Queue, Review flow w/ PR pickup-time + size distributions, Quality, Investment, Predictability, Epics, CI, Load, Board, Members, OKRs, Export), Idea→prod funnel (working-days per stage, p50/p90, lead−cycle = wait time), DORA (deploy freq + lead time vs Google elite/high/med/low bands; CFR + MTTR shown as honest "no data source" cards), AI ROI (cohort-only $/point paired with rework-rate guardrail), 1:1 prep.
- **ADP concept**: golden paths + delivery observability (flow efficiency, DORA, predictability); Plane A.
- **Interactivity**: read-only analytics; Export produces reports.

### Capabilities  (`<Hub>`)  — *capability layer / registry*
- **ROI ledger** (`CapabilityLedger`): name / always-on tok / fires 30d/90d / last fired / tok-per-fire / verdict (DEAD/COLD/HOT). Headline "you pay N tok/session for M capabilities — K never fired." **Archive rows** → dry-run first, backed up, reversible.
- **Skills / Commands / Agents** (`ResourceSection`): list, edit (CodeMirror), preview (parsed frontmatter + rendered md + "what triggers this"), create-from-template, delete — the real `~/.claude/{skills,commands,agents}` files.
- **Flow** (`FlowSection`): see below.
- **Inventory (linter)** + **Customize**: static frontmatter lint (demoted to authoring aid), CLAUDE.md/settings editing.
- **ADP concept**: the capability/tool registry + capability-ROI economics; capability CRUD.
- **Interactivity**: full CRUD on real config files + archive actions (backed up/reversible).

### Flow (Flow Graph)  — *golden-path topology*
- **Sees**: SVG orchestration topology entry → skills/commands → agents → MCP. Toggle **defined** (parsed from bodies) vs **observed** (real transcript invocations, edge width = frequency). Click a node to isolate up/downstream; flags dead ends, cycles, most-traveled path. Scope-aware.
- **ADP concept**: golden-path / orchestration visualization — the literal graph of how work flows through capabilities.
- **Interactivity**: read-only, interactive graph exploration.

### Harness  (`<Hub>`)  — *context / execution / config / identity+security*
- **Sessions**: sortable ledger — real per-session $, out tok, cache-read %, duration, tool calls, compactions, errors; copy `claude --resume`, reveal in Finder, open raw. Keyboard layer (`/ j k y ↵`).
- **Context Explorer**: replay any session's context-window occupancy turn-by-turn (fresh/cache-write/cache-read from Anthropic usage blocks) vs 200k/1M budget, with detected `/compact` resets.
- **Forensics**: failure signatures grouped+counted ("bitten you 181 times"), context pressure by tool (median/p90, HOG flag) with **cap-this-tool** (installs PostToolUse hook), hook blast radius (firings/blocks).
- **Usage**: token/cost activity, model mix, harness health score + regression, cache-TTL waste, anomalies, month-end cost projection.
- **Config** (`HarnessSection`): edit `~/.claude/settings.json`.
- **Governance**: identity/security governance over config.
- **Team baseline**: harness baseline + per-repo drift (`/api/gov/team`, baseline/export/sync).
- **Reliability**: see below. **Library**, **MCP**: capability/connector management.
- **ADP concept**: the execution + context engineering layer (Sessions/Context/Forensics/Usage) + identity/security/governance (Config/Governance/Team baseline); Plane B.
- **Interactivity**: mostly read-only telemetry, but **installs hooks** (cap-tool), edits config, syncs governance baselines — action-capable.

### Reliability  — *validation gates*
- **Sees**: eval suites; **CI eval gate** generates the GitHub Action/GitLab CI config that runs the eval suite headlessly on PRs touching `.claude/`, with a configurable merge-blocking pass-rate threshold; CI runs shown inline via `gh`, tagged CI vs manual; dry-run preview before writing.
- **ADP concept**: validation / eval gates — the quality gate on capability changes.
- **Interactivity**: generates + writes CI config (dry-run first).

### Quality  — *validation: analytics + design drift*
- **Sees**: 3 tabs — **Analytics events** (live registry of `.track/.capture/logEvent` calls w/ file:line, naming + taxonomy validation against `.claude/analytics-taxonomy.json`, uncommitted-diff drift check), **Design drift** (code components vs `.claude/design-manifest.json`: missing/prop-drift/undocumented + Figma frame links + Figma MCP), and a third quality tab.
- **ADP concept**: validation gates for instrumentation + design-system conformance.
- **Interactivity**: read-only checks + drift detection (can bootstrap taxonomy from code).

### MCP / Library / Hooks / Governance (supporting harness config)
- **MCP** (`McpSection`): MCP server config management.
- **Library** (`LibrarySection`): reusable harness assets.
- **Hooks** (`HooksSection`): real Claude Code hooks as first-class config — per-scope add/remove, **matcher tester** (live regex vs sample tool), **dry-run** (runs command with sample payload → allow/BLOCK/latency), **health** (firings by event from transcripts), one-click **pattern library** (block-prod-file-edit, secret-scan-pre-write, require-tests-before-stop, log-tool-usage).
- **Governance** (`GovernanceSection`): governed-path rules, identity/security.
- **ADP concept**: capability/connector registry + identity/security/automation policy.
- **Interactivity**: full CRUD + dry-run testing; installs real hooks.

### Constitution  — *verified knowledge base*
- **Sees**: aggregate insights + a D3 citation graph over a repo's `.wakeel/constitution` knowledge base (verified repo knowledge). Shared by Claude + Cursor shells.
- **ADP concept**: grounded knowledge / context layer — verified, citation-backed repo truth.
- **Interactivity**: read-only exploration.

### Memory (Memory Recall)  — *persistent semantic memory (Gap A)*
- **Sees**: "Ask your past self" — semantic recall over `~/.claude/memory/` (context-mode SQLite+FTS5). The OS-ROADMAP **Phase-1, build-first** panel.
- **ADP concept**: persistent semantic memory / context layer — the strategic gap the product is closing.
- **Interactivity**: query interface (ask questions of past context).

### Atoms  — *grounded project Q&A*
- **Sees**: multi-tab — feature catalog, **grounded search** ("ask the project… e.g. what happens when a sale creates…"), attestation triage, over a repo's `.wakeel/constitution` atom files. Every answer sentence must cite an atom id. Shared by Claude + Cursor shells.
- **ADP concept**: grounded RAG / knowledge-retrieval layer with citation enforcement (anti-hallucination).
- **Interactivity**: interactive Q&A; attestation review actions.

---

## Workflows Hub  (`<Hub>`)  — *agentic execution + validation loop*

The clearest **end-to-end agentic golden path** in the app.

- **Quick Actions** (`QuickActions`): one-click launchers (Explain repo, Find dead code, Init CLAUDE.md, Feedback, etc.).
- **Task Board** (`BoardSection`): agentic kanban per project (`~/.claude/taskboard.json`, every write versioned). Paste JIRA → ticket; **✂ analyze** proposes editable sub-ticket breakdown (real `claude -p`). **▸ Start** creates an isolated git worktree branch + runs a headless dev agent → Code Review. Review/QA/Release are **manual triggers**: review agent returns severity-tagged findings (auto-fix loop capped at 3 → Blocked); clean review auto-provisions a preview env; QA agent derives AC + test cases, executes, and auto-files failing cases as linked bug sub-tickets.
- **Loush Runs** (`RunsSection`): loush agent-run history/monitoring.
- **Quality** (`QualitySection`): (also reachable standalone — see above).
- **Bugs** (`BugsSection`): triage workspace (`~/.claude/bugs.json`) — paste trace/log/link, auto-extracts file paths/functions/frames, **auto-bisect**, regression-test generator, copyable `gh pr create`.
- **ADP concept**: execution layer + validation gates as an orchestrated loop (plan → build in worktree → review → QA → release), with human-triggered gates.
- **Interactivity**: **highest** — launches real headless agents, creates worktrees, runs `claude -p`, provisions preview envs, files tickets. Action-heavy.

---

## Chat Hub  (`<Hub>`)  — *live agent + prompt intelligence*

- **Chat** (`ChatSection`): talk to Claude Code live.
- **Insights** (`InsightsSection` / Chat Insights): Stats tab (chats, one-shot rate, cost/chat, day×hour heatmap, correction/abandon/reuse rates, leaderboards); Duplicate-prompts tab (exact + fuzzy Jaccard clusters with **save as command** / **send to Prompt Studio**, similarity slider, filters).
- **ADP concept**: interactive execution surface + prompt/capability-authoring feedback loop.
- **Interactivity**: Chat is fully interactive; Insights has save-as-command / send-to-studio actions.

## Authoring / Figma / Artifacts (authoring + design-to-code)

- **Authoring** (`PromptStudio`): prompt studio — compose/iterate prompts (receives dupes from Chat Insights).
- **Figma Capture** (`FigmaCaptureSection`): fetch a Figma frame (screenshot + node tree) into the repo as a Capture, annotate with design-system component mappings. Design-to-code on-ramp.
- **Artifacts** (`ArtifactsSection`): view rendered agent output artifacts (renderer picked per artifact type); paginated 60/page.
- **ADP concept**: capability authoring + design-to-code path + execution output surface.
- **Interactivity**: authoring is write-heavy; Figma Capture writes annotated captures; Artifacts is a viewer.

## Projects

- **Projects** (`ProjectsSection`): per-project cards — Live-now (transcript within 5min, pulsing, 30s refresh), session count, per-project token usage, most-used model, last-active, **GSD progress bar** (from `.planning/ROADMAP.md` checked/unchecked), and the project's own skills/commands/agents/MCP (expandable). Current project highlighted; deleted-but-remembered flagged. Git commit counts + language chips.
- **ADP concept**: workspace / project registry — per-project capability + activity inventory.
- **Interactivity**: read-only overview with deep links.

## Labs  (`<Hub>`, experimental — "demos, not delivery data")

- **Mindwalk** (`MindwalkSection`): iframes a React/Three.js 3D UI served from a Go binary (`/api/mindwalk/serve`), source = claude|cursor.
- **Agent Squads** (`TeamsSection`): agent-team demo.
- **Squad Designer** (`TeamDesigner`): compose a team (members: brief, model, agent type, IO, artifacts, tasks, skills, MCP, ADRs). Live config checklist + **✦ AI review** (real `claude -p` scoring each member keep/just-a-prompt/unnecessary/merge, derives IO contracts + collaboration map + risks, ~cents). "Launch team" hands kickoff prompt to Chat. **⚡ Enable agent teams** writes the experimental env flag to global settings.json (versioned).
- **ADP concept**: multi-agent orchestration design (experimental) — the "compose a squad" future path.
- **Interactivity**: Squad Designer runs real `claude -p` review + writes settings; Mindwalk is a viewer.

---

## 2. Career dashboard  (`src/career/`, `?dash=career`)

Personal career-development shell (self-only, never rolled up/exported, no manager view). Reads
`~/.claude/usage-data/{facets,session-meta}`, taskboard, bugs; writes `~/.claude/career.json` (versioned).
Seven headline panels; the directory holds ~40 panel components. Bug counts = escaped defects only.

- **Overview / Me·Now** (`OverviewPage`, `PersonPacket`, `PulsePanel`): identity + **Friction pulse** (weekly 1-tap 1–5 self-report + 12-entry sparkline — the *only* self-reported signal).
- **Tasks** (`TasksPanel`, `DecisionPanel`, `Commitments`): tasks + recommendation + risk + acted-on.
- **Flow / SPACE** (`FlowPanel`, `FlowBottleneck`, `FocusPanel`, `EffortMix`, `AllocationPanel`, `Sustainability`).
- **Quality / DORA** (`QualityPanel`, `CiHealth`, `ReviewFlow`, `ReviewsPanel`).
- **Insights / project** (`InsightsProjectPanel`, `OwnershipMap`, `InfluencePanel`, `LearningPanel`, `LessonsPanel`).
- **Brag + retro + promo** (`BragPanel`, `TicketRetroPanel`, `CompetencyPanel`, `OkrPanel`).
- **1:1 Prep + log** (`OneOnOnePanel`, `FeedbackPanel`, `Commitments`).
- Economics: `TicketEconomics`, `RunEconomics`, `HarnessROI`, `EstimationPanel`, `Analyze`, `Omnibox` (cmd-k), `CareerGame`, `TeamBoard`.
- **ADP concept**: individual delivery observability + growth (SPACE/DORA at IC level); not a platform layer per se but the self-facing lens on delivery + harness ROI.
- **Interactivity**: mostly read-only; writes `career.json` (friction pulse, 1:1 log, feedback, decisions/commitments).

## 3. Eng dashboard  (`src/eng/` — now folded into Delivery)

No longer a separate shell; renders as the **Delivery > Engineering** tabs. Components:
`AttentionQueue`, `ReviewFlow`, `Quality`, `Investment`(implied), `Predictability`, `Epics`, `CI`,
`Load`, `MemberInsights`, `Compare`, `Provenance`, `TimeLens`, `Export`, `CmdK`, plus `ui.jsx`,
`urlState.js`, `memberMetrics.mjs`, `reports.js`.
- **ADP concept**: team-wide delivery observability + golden-path flow metrics (Plane A). The genuinely team-wide data.
- **Interactivity**: read-only analytics; Export/reports; CmdK navigation; TimeLens/Compare for time-range analysis.

## 4. Cursor dashboard  (`src/cursor/`, `?dash=cursor`, `CursorDashboard.jsx`)

Parses Cursor's local SQLite DB ("first load reads a 2 GB sqlite file"). Panels via `charts.jsx`
(DataTable, Facts, StackedBar, Bars): sessions trend, per-day spend (cents), model usage (calls),
AI-accept rate, blame/tools/join, bubbles. Each panel has a **[{ }] Raw** link → NDJSON dump of the
backing rows (`/api/cursor/export?kind=…`, local plane only).
- **ADP concept**: cross-tool (Cursor) harness telemetry — same observability posture applied to a second agent tool; local-plane, self-only.
- **Interactivity**: read-only; raw-row export links.

## 5. Everything else

- **Game** (`src/game/`: `useGame.js`, `GameStats`, `AchievementGrid`, `UnlockToast`, `anim.jsx`, `primitives.jsx`, `index.js`): remnants of the **deleted gamification layer** (XP/streak/badges). The docs state `Gamification.jsx` was removed and this was demoted; treat as legacy/dead-ish. Not part of the ADP model.
- **ActivityTimeline** (`ActivityTimeline.jsx`): shared timeline widget.
- **Shared UI primitives**: `<Hub>` (tab group), `Overview`, `Loading`/`ChartSkel`, chart libs (`charts.jsx` in career/cursor/eng). Not sections.

---

## ADP-layer coverage summary

| ADP layer / path | Already represented by |
|---|---|
| **Context engineering** | Harness → Context Explorer, Usage; Memory Recall |
| **Persistent memory (Gap A)** | Memory (Phase-1 build-first), context-mode backing |
| **Capability registry + ROI** | Capabilities Hub (ROI ledger, Skills/Commands/Agents CRUD), Projects |
| **Execution** | Chat, Workflows (Task Board headless agents + worktrees), Loush Runs, Sessions |
| **Golden paths / orchestration** | Flow Graph (defined vs observed), Squad Designer (Labs), Workflows loop |
| **Validation / eval gates** | Reliability (CI eval gate), Quality (analytics + design drift), Workflows review/QA gates |
| **Identity / security / governance** | Harness → Governance, Config, Team baseline; Hooks (policy) |
| **Observability** | Overview, Inbox, Delivery/Eng (DORA + flow), Forensics, Cursor telemetry |
| **Grounded knowledge / RAG** | Constitution (citation graph), Atoms (grounded Q&A) |
| **Autonomy / cadence (Gap B)** | *Not yet built* — roadmap Phase 2: Scheduler → Inbox loop |

**Total top-level sidebar sections**: 15 (Overview, Inbox, Delivery, Projects, Chat, Workflows,
Capabilities, Harness, Constitution, Memory, Figma Capture, Authoring, Hooks, Artifacts, Labs) +
2 alternate shells (Career, Cursor). Roughly 40+ distinct panel/section components across `src/` and subdirs.
