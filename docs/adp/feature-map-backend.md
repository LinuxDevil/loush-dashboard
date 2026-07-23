# Backend Feature Map — ADP Roadmap Input

Scope: all `server*.mjs`, `career-*.mjs`, and config files under `dashboard/`.
Backend is an Express monolith (`server.mjs`) that mounts domain routers (`mount*(app)`) and pulls in pure, testable `career-*` compute modules. Two hard data planes run through everything: **Plane A** = work artifacts (JIRA/GitHub/CI — team-visible, operational-only, no evaluative scores) and **Plane B** = harness telemetry (transcripts/tokens/cost/sessions — self-only, one machine). This boundary is structural, not policy, and shapes what any agentic feature is allowed to emit.

ADP stage tags: **TRIGGER** (kicks off work), **RETRIEVE** (gathers context), **VALIDATE** (checks/gates), **DEPLOY** (applies/ships), **OBSERVE** (monitors/measures), **REMEDIATE** (fixes/recommends). "none" = pure compute/util with no direct agentic role.

Total modules mapped: **37** (14 `server*.mjs` + 23 `career-*.mjs` + 3 config files).

---

## 1. Core Server / Governance (server.mjs)

### server.mjs — dashboard host + governance/ops control plane
The monolith. Serves static UI + ~80 routes. Far more than a router: it hosts agent orchestration, an evals/governance engine, and a runs/approval pipeline.
- **Key endpoints:**
  - Resources CRUD: `/api/res/:kind` (+`/item`) GET/PUT/POST/DELETE — generic store for skills/agents/etc.
  - Chat: `/api/chat/complete`, `/api/chat/upload`, `/api/chat/sessions`, `DELETE /api/chat/:id`
  - **Team agent orchestration:** `/api/team`, `/api/team/agent`, `POST /api/team/message`, `/api/team/interrupt`, `/api/team/shutdown`, `/api/team/plan`
  - **Actions:** `POST /api/actions/run`, `GET /api/actions` — runnable operations
  - Harness config: `/api/harness`, `/api/harness/raw`, `POST /api/harness/verify`
  - Hub (session/file browse): `/api/hub`, `/api/hub/session`, `/api/hub/file`
  - **Governance/evals:** `/api/gov/versions`, `/api/gov/rollback`, `/api/gov/approvals`, `/api/gov/dryrun`, `/api/gov/failures`, `/api/gov/trace`, `/api/gov/evals` (+`/run`), `/api/gov/costs`, `/api/gov/profiles` (+`/apply`), `/api/gov/bundle/export|import`, `/api/gov/baseline`, `/api/gov/drift` (+`/sync`), `/api/gov/recs` (+`/dismiss`), `/api/gov/team`
  - Inbox/digest: `/api/inbox/done`, `/api/digest`
  - Observability: `/api/capabilities`, `/api/forensics`, `/api/sessions`, `/api/context/:sessionId`, `/api/roi`
  - Design/analytics drift: `/api/analytics/drift`, `/api/design/drift`, `/api/design/manifest`
  - Reviews/board/runs: `/api/reviews`, `/api/board` (+tickets CRUD), `/api/runs`, `/api/runs/events`, `/api/runs/artifact`, `POST /api/runs/approve`, `/api/meta`
- **Data sources:** `~/.claude` dir & transcripts, local JSON stores (evals, profiles, board, runs), spawned `claude` processes, downstream mounted routers.
- **Agentic relevance:** **TRIGGER + VALIDATE + DEPLOY + OBSERVE + REMEDIATE** — the single strongest agentic surface. `actions/run`, team agent messaging, `gov/evals/run`, `gov/rollback`, `runs/approve`, drift + recommendations all map directly to ADP stages.

---

## 2. Source Integrations (Plane A ingest)

### server-eng.mjs — JIRA/GitHub/CI engineering snapshot (Plane A owner)
Fetches & caches (2h TTL) the org's work artifacts; the single source other modules join against.
- **Key endpoints:** `/api/eng/projects` (CRUD), `/api/eng/creds`, `/api/eng/snapshot`, `POST /api/eng/refresh`, `/api/eng/triage` (+dismiss), `/api/eng/ci`, `/api/eng/bug-ownership`, `/api/eng/ticket/:key` (+`/generate`, `/transition`, `/artifact`, `/edit-review`).
- **Data sources:** JIRA API, GitHub (`gh`/octokit), CI, `projects.json`, `.claude`.
- **Agentic relevance:** **RETRIEVE + DEPLOY** — primary context fetcher; `ticket/generate` and `ticket/:key/transition` write back to JIRA (DEPLOY). Exports `engSnapshot` reused everywhere.

### career-import-github.mjs — GitHub PR/review-footprint import
Quarantined (never throws) transform of `gh` fixture JSON into review reciprocity + PR-lifecycle shape.
- **Exports:** `importGithub({ ghJson, resolved })`.
- **Data sources:** `gh api search/issues?reviewed-by:@me`, `gh pr list`.
- **Agentic relevance:** **RETRIEVE**.

### career-import-jira.mjs — JIRA issue import
Quarantined transform of pasted/imported JIRA issues into the snapshot ticket shape.
- **Exports:** `importJira({ issues, resolved })`.
- **Data sources:** JIRA issues (paste/API).
- **Agentic relevance:** **RETRIEVE**.

### career-identity.mjs — cross-source identity resolution
Maps one person across email / GitHub login / JIRA accountId so joins attribute correctly.
- **Exports:** `resolveIdentity`, `matchesMe`, `warnIfNoMatch`.
- **Data sources:** config identity block.
- **Agentic relevance:** none (foundational util).

---

## 3. Career Analytics (Plane B — self-only growth)

### server-career.mjs — career/growth dashboard router
Composes all `career-*` compute modules into a personal growth snapshot + promo/1:1 tooling.
- **Key endpoints (~40):** `/api/career/snapshot`, `/api/career/refresh`, `/api/career/config`, `/api/career/focus/act`, imports (`/import/github|jira|calendar|domain`), `/api/career/digest`, `POST /api/career/analyze`, `/api/career/kpi-link`, `/api/career/brag`, `/api/career/retro`, `/api/career/pulse`, `/api/career/story-so-far`, `/api/career/promo-packet`, `/api/career/okr/close-kr`, `/api/career/quest/:id/done`, lessons (`/harvest`, POST, `/:id/discard`), `/api/career/retro-tickets`, `/api/career/retro/:ticketId`, `/api/career/ticket-economics`, `/api/career/harness-roi`, `/api/career/run-economics`, `/api/career/lookup`, packet endpoints, `/api/career/brief`, `/api/career/one-on-one`.
- **Data sources:** all career modules, `server-team`, `server-cursor`, local config store, spawned `claude`.
- **Agentic relevance:** **RETRIEVE + OBSERVE + REMEDIATE** — aggregates context, tracks metrics, and `analyze`/`focus/act`/`lessons` produce recommended actions.

### career-snapshot.mjs — snapshot builder + rollup
Assembles the period snapshot and maintains the persisted weekly time-series.
- **Exports:** `buildSnapshot`, `updateRollup`, `periodWindow`, `priorPeriod`.
- **Agentic relevance:** **RETRIEVE** (assembles context state).

### career-analyze.mjs — on-demand LLM coaching
Spawns `claude -p` with panel-specific coach prompts; hash-cached; degrades to heuristic note. Never runs on snapshot build.
- **Exports:** `analysisKey`, `runAnalyze`.
- **Data sources:** spawned `claude` CLI.
- **Agentic relevance:** **REMEDIATE** (generates concrete next-action advice).

### career-heuristics.mjs — focus-item derivation
Deterministic "what to work on" items from the snapshot.
- **Exports:** `focusItems(snapshot)`.
- **Agentic relevance:** **REMEDIATE** (surfaces actionable focus).

### career-lessons.mjs — lessons pipeline (harvest→distill→graduate)
Recurring-theme harvest → weekly distill (Analyze) → apply/verify with auto- or manual-graduation; ~5 active cap.
- **Exports:** `harvestCandidates`, `distill`, `evaluateLesson`, `addLesson`, `ACTIVE_CAP`.
- **Data sources:** PR findings, escaped bugs, ticket AC gaps.
- **Agentic relevance:** **OBSERVE + REMEDIATE** (learns from failures, produces verified improvement checks).

### career-okr.mjs — metric-linked OKRs
KRs auto-track via a dotted `metricRef` path resolved live against the snapshot.
- **Exports:** `krClosed`, `resolveKrCurrent` (dotted-path lookup).
- **Agentic relevance:** **OBSERVE** (auto-tracks goal progress).

### career-retro.mjs — per-ticket retrospective
Composes ticket history + PRs + bugs + (only-if-branch-confident) sessions.
- **Exports:** `ticketRetro`.
- **Agentic relevance:** **OBSERVE** (post-hoc analysis).

### career-attribution.mjs — bug attribution
Splits escaped-vs-caught bugs; blame + ticket-branch + culprit-commit rules.
- **Exports:** `attributeBugs`, `attributeBugsWithBlame`.
- **Agentic relevance:** **OBSERVE**.

### career-blame.mjs — git-blame bug origin map
Computes `{bugId → introducingAuthorEmail}` once at import (no subprocess on refresh).
- **Exports:** `blameMapForBugs`.
- **Data sources:** `git blame` via spawnSync.
- **Agentic relevance:** **OBSERVE**.

### career-domain.mjs — domain/ownership map from git log
Parses `git log` to shape which areas of code a person owns.
- **Exports:** `parseGitLog`, `shapeDomain`, `computeDomain`.
- **Data sources:** `git log` via spawnSync.
- **Agentic relevance:** **RETRIEVE**.

### career-allocation.mjs — time-split analytics
Buckets sessions into deepWork/reviews/design/ops vs an intended target; computes drift.
- **Exports:** `computeAllocation`.
- **Data sources:** sessions + GitHub review footprint.
- **Agentic relevance:** **OBSERVE**.

### career-meetings.mjs — meeting analytics (G5)
Pure stats from imported calendar events (server can't call Calendar MCP directly).
- **Exports:** `meetingStats`.
- **Data sources:** calendar events via `/api/career/import/calendar`.
- **Agentic relevance:** **OBSERVE**.

### career-digest.mjs — weekly digest (G10)
Deterministic weekly digest from snapshot + time-series. No LLM, no cron (scheduler gated).
- **Exports:** `weeklyDigest`.
- **Agentic relevance:** **OBSERVE**.

### career-review-insights.mjs — team-health review insights
Reciprocity, bus factor, reviewer footprint from already-imported GitHub data. Team-framed, never a personal score.
- **Exports:** `reviewInsights` (reviewsGiven/reviewsReceived).
- **Agentic relevance:** **OBSERVE**.

### career-insights.mjs — transcript/usage parsing
Parses usage data & derives sessions from transcripts; ticket links; per-project grouping.
- **Exports:** `parseUsageData`, `sessionCost`, `ticketLinksFrom`, `deriveSessionsFromTranscripts`, `groupByProject`.
- **Data sources:** `.claude` transcripts (Plane B).
- **Agentic relevance:** **RETRIEVE**.

### career-usage-trends.mjs — daily trend analytics
Cache-TTL impact, anomaly detection, cost projection over transcript entries.
- **Exports:** trend/anomaly/projection fns.
- **Agentic relevance:** **OBSERVE**.

### career-insights-report.mjs — /insights report.html parser
QUARANTINED parse of the undocumented insights report; every export wrapped to never throw.
- **Exports:** `parseReportNarrative`.
- **Agentic relevance:** **RETRIEVE**.

### career-health.mjs — usage health + regression
Cost/hidden-turn health and regression detection over usage entries.
- **Exports:** `computeUsageHealth`, `computeRegression`.
- **Agentic relevance:** **OBSERVE** (regression = degradation signal).

### career-harness.mjs — harness ROI/friction score
Scores harness effectiveness per project from sessions + repo probe vs a friction baseline.
- **Exports:** `harnessScore`.
- **Agentic relevance:** **OBSERVE**.

### career-config.mjs — versioned config store
Migrating (v4) config store — defaults, migrate, `makeStore`.
- **Exports:** `CONFIG_VERSION`, `defaultConfig`, `migrate`, `makeStore`.
- **Agentic relevance:** none (persistence util).

---

## 4. Game / Gamification (Plane B — self-only)

### server-game.mjs — XP engine (outcomes-only, self-only)
Rebuilt XP engine: XP for outcomes only, never message count; self-vs-own-trailing-mark only; never team-scoped.
- **Key endpoints:** `/api/game`, `POST /api/game/seen`.
- **Data sources:** `server-eng` snapshot (filtered to `me`), `.claude`.
- **Agentic relevance:** **OBSERVE**.

### career-gamify.mjs — XP/levels/streaks/achievements compute
Pure gamification math consumed by both the game and career routers.
- **Exports:** `awardXp`, `levelBand`, `computeStreaks`, `evaluateAchievements`, `questDone`, `badgeProgress`, `personalBests`.
- **Agentic relevance:** **OBSERVE**.

---

## 5. Cursor Integration

### server-cursor.mjs — Cursor telemetry (Plane B, read-only)
Reads Cursor's `state.vscdb` via the `sqlite3` CLI (mode=ro, no npm dep). All fails soft. Defines the plane rule.
- **Routes:** `/api/cursor/*`.
- **Exports:** `cursorSnapshot`, `cursorAiLines`, `blameRows`, `windowOf`, `inWin`, `weekKey`, `pct`.
- **Data sources:** Cursor `state.vscdb` sqlite.
- **Agentic relevance:** **RETRIEVE + OBSERVE**.

### server-cursor-join.mjs — local self-only join engine (Plane B)
Joins one spine (session→commit→branch→ticket→PR/JIRA) from this machine's Cursor DB + git checkouts against the cached eng snapshot. A join, not a fetch.
- **Exports:** `joinRows(win)`; `mountCursorJoin`.
- **Data sources:** Cursor DB, local git, eng snapshot cache.
- **Agentic relevance:** **RETRIEVE**.

### server-cursor-team.mjs — Cursor Admin API team plane (Plane A exception)
The one Cursor module allowed multi-person data: reads Cursor Admin (org billing) API + roster; emits only 3 administrative facts per email.
- **Routes:** `/api/cursor/team`.
- **Data sources:** Cursor Admin API, `projects.json`.
- **Agentic relevance:** **OBSERVE**.

---

## 6. Memory / Constitution / Atoms

### server-memory.mjs — memory file browser/search
Serves the YAML-frontmatter memory files (projects, recent, search, file).
- **Key endpoints:** `/api/memory/projects`, `/api/memory/recent`, `/api/memory/search`, `/api/memory/file`.
- **Data sources:** local memory dir (YAML/markdown).
- **Agentic relevance:** **RETRIEVE** (agent long-term memory).

### server-constitution.mjs — constitution insights + citation graph
Reads a repo's `.wakeel/constitution` knowledge base; aggregate insights + D3 citation graph; flags tech-debt markers. Read-only, fails soft.
- **Key endpoints:** `/api/constitution/repos`, `/api/constitution/insights`, `POST /api/constitution/export`, `/api/constitution/artifact`.
- **Data sources:** `.wakeel/constitution/*`, `~/.claude.json` project list, Cursor workspace storage.
- **Agentic relevance:** **RETRIEVE + VALIDATE** (grounding source; debt/migration flags).

### server-atoms.mjs — grounded "ask-the-project" atoms API
Feature catalog + grounded search + attestation triage over `.wakeel/constitution` atom files. In-memory index rebuilt on folder mtime change. Answers must cite atom ids only (no outside knowledge).
- **Key endpoints:** `/api/atoms/index`, `/api/atoms/reviewed` (GET/POST), `POST /api/atoms/explain` (spawns `claude`).
- **Data sources:** constitution atom files (`atoms/ingest.mjs`), spawned `claude`.
- **Agentic relevance:** **RETRIEVE + VALIDATE** (grounded RAG with citation enforcement + attestation triage).

---

## 7. Team (Plane A)

### server-team.mjs — team work-artifact board (Plane A boundary owner)
Structurally incapable of carrying telemetry. Operational, alphabetical (no ranking).
- **Key endpoints:** `/api/team/board`, `/review-flow`, `/funnel`, `/effort`, `/commitments`, `/ownership`, `/sustainability`, `/ci`, `POST /api/team/pr/:num/request-review`, `POST /api/team/pr/:num/comment`.
- **Exports:** `engSnapshot`, `teamBoard`, `reviewFlow`; default `mountTeam`.
- **Data sources:** eng snapshot (JIRA/GitHub/CI).
- **Agentic relevance:** **OBSERVE + DEPLOY** (`request-review`/`comment` write back to GitHub).

---

## 8. Figma & Mindwalk (visualization / capture)

### server-figma-capture.mjs — Figma frame capture + annotation store
Captures a frame (screenshot + node tree + metadata) and stores component-mapping annotations for design-to-code.
- **Key endpoints:** `/api/figma-capture/catalog`, `/project-components`, `/:slug`, `/:slug/screenshot`, `POST /:slug/annotations`, `POST /:slug/context`.
- **Data sources:** Figma (via MCP/capture), local capture files.
- **Agentic relevance:** **RETRIEVE** (design context for implementation agents).

### server-mindwalk.mjs — 3D session replay (child process)
Runs the `mindwalk` Go binary as a child process on a fixed port and iframes its UI; transcodes Cursor composers into Claude-shaped JSONL for the Cursor source.
- **Key endpoints:** `/api/mindwalk/status`, `POST /api/mindwalk/serve`, `POST /api/mindwalk/stop`.
- **Data sources:** Claude/Codex JSONL, Cursor `state.vscdb` (transcoded), spawned `mindwalk` binary.
- **Agentic relevance:** **OBSERVE** (session visualization).

---

## 9. Config Files

- **config.json** — dashboard runtime config.
- **projects.json** — project/repo roster + engineer mapping (consumed by eng/team/cursor-team planes).
- **package.json** — scripts & deps (Express-based; `yaml`, spawns `claude`/`gh`/`sqlite3`/`git`/`mindwalk` as external processes; no heavy service deps — most integrations are CLI/subprocess).

---

## ADP Stage Rollup

| Stage | Strongest modules |
|---|---|
| TRIGGER | server.mjs (`actions/run`, team agent messaging, `gov/evals/run`) |
| RETRIEVE | server-eng, server-atoms, server-constitution, server-memory, server-cursor(+join), career-snapshot/insights, career-import-*, server-figma-capture |
| VALIDATE | server.mjs (`gov/dryrun`, `gov/approvals`, evals), server-atoms (citation enforcement), server-constitution (debt flags) |
| DEPLOY | server.mjs (`runs/approve`, `gov/rollback`, profiles apply), server-eng (`ticket/generate`, `transition`), server-team (`request-review`, `comment`) |
| OBSERVE | server.mjs (`forensics`, `roi`, `analytics/drift`), most career-* analytics, career-health/harness/usage-trends, game modules |
| REMEDIATE | server.mjs (`gov/recs`), career-analyze, career-heuristics, career-lessons |
