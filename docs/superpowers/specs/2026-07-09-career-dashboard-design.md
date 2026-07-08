# Career Dashboard — Design Spec

**Date:** 2026-07-09
**Status:** Approved for planning
**Author:** Ali Mohammad (with Claude)

## 1. Purpose

A personal **career-development dashboard** for an individual senior/staff engineer, built as a
new full-screen shell inside the existing AI-Dashboard app (alongside the Claude, Cursor, and
Engineering-Metrics dashboards). It answers, in one place:

- What are my skills, and what am I lacking?
- What am I working on right now; what's pending, what needs testing (my side), what's in progress?
- Charts & analysis of my work; how many bugs came from my work; what my work session looks like.
- What should I focus on (from analysis of tasks, PRs, commits, `/insights`)?
- What am I learning now / will learn (measurable goals)?
- What is my current workflow (from analysis of how I use Claude), and what I can do better?
- For each current task: recommended approach and next steps.
- How to optimize my engineering metrics, and what I can learn from my tasks.

It also folds in the **Claude Code `/insights`** output on a per-project basis, and reuses data
already computed by the Claude, Cursor, and Engineering-Metrics dashboards.

### Framework grounding (from research)

- **SPACE** — the only mainstream framework aimed at the *individual*: Satisfaction/well-being,
  Performance, Activity, Communication/collaboration, Efficiency/flow. Anchors the work-session,
  focus, flow, and workflow panels. Wellbeing signals to surface: WIP count, context-switching,
  after-hours activity, sustainable pace.
- **DORA** — delivery/quality (deploy freq, lead time, change-fail rate, MTTR). Anchors the
  quality/bugs panel and "optimize my metrics."
- **Competency matrix (IC1–IC6, 1–5 scale)** — anchors skills, "what I'm lacking," and learning.
- **Brag document / promo packet** — research is unanimous that an auto-seeded work log is the
  single highest-leverage artifact for a senior/staff engineer. Anchors the Brag/Work Log panel.

Sources:
- SPACE vs DORA: https://www.swarmia.com/blog/comparing-developer-productivity-frameworks/ , https://getdx.com/blog/space-metrics/
- Competency matrix (IC1–IC6): https://sprad.io/resources/software-engineer-skill-matrix-competency-framework-by-level-ic1-ic6-behaviors-examples-template-3914c
- Brag documents / promo packets: https://jvns.ca/blog/brag-documents/ , https://staffeng.com/guides/promo-packets/ , https://blog.pragmaticengineer.com/work-log-template-for-software-engineers/
- Burnout / flow / sustainable pace: https://www.hatica.io/blog/can-deep-work-solve-dev-burnout/

## 2. Architecture

Follows the existing multi-dashboard pattern exactly (`?dash=cursor`, `?dash=eng`):

- **Shell:** `src/CareerDashboard.jsx` — full-screen, rendered from `src/App.jsx` when
  `dash === 'career'`. A top-chip button and `goDash('career')` entry added next to the existing
  `⇄ Cursor` / `⇄ Eng Metrics` chips.
- **Server:** `server-career.mjs`, a module exporting a `mount(app, deps)` function called from
  `server.mjs` (same shape as `server-eng.mjs` / `server-cursor.mjs`). Reuses shared transcript /
  git / project helpers already in `server.mjs` where exported; re-implements only what's missing.
- **Compute model:** **cached snapshot**. `GET /api/career/snapshot` returns the whole computed
  model from an in-memory cache; `POST /api/career/refresh` rebuilds it. The frontend filters
  (project / time range / month) client-side. Mirrors `server-eng.mjs` `/snapshot` + `/refresh`.
- **Recommendation engine:** **hybrid**. Deterministic heuristics compute instantly and ship in the
  snapshot. A per-panel `✨ Analyze` button calls a new `POST /api/career/analyze` endpoint that runs
  a real `claude -p` pass (like Team Designer / Task Board `analyze`) for deeper narrative advice;
  results are cached in `career.json` keyed by panel + input hash so re-opening is free.

### 2.1 Data sources

| Source | Path / origin | Feeds |
|---|---|---|
| `/insights` facets | `~/.claude/usage-data/facets/<session-id>.json` | goal, outcome, user_satisfaction, claude_helpfulness, session_type, friction_counts, primary_success, brief_summary |
| `/insights` session-meta | `~/.claude/usage-data/session-meta/<session-id>.json` | project_path, duration, tool_counts, languages, git_commits/pushes, tokens, user_interruptions, user_response_times, first_prompt |
| `/insights` narrative | `~/.claude/usage-data/report.html` (latest `report-*.html`) | At-a-Glance (working / hindering / quick wins / ambitious), wins, horizon, suggested CLAUDE.md, features & patterns to try |
| Transcripts | `~/.claude/projects/**/*.jsonl` | flow/deep-work blocks, activity, workflow (fallback when usage-data absent) |
| Git | project repos | commits, churn, language histogram |
| Task Board / Jira | `~/.claude/taskboard.json` + Eng snapshot | pending / to-test / in-progress, cycle time |
| PRs & bugs | `~/.claude/bugs.json`, review findings (`ReportFindings` in transcripts) | DORA quality, "bugs I created" |
| Cursor + Eng snapshots | existing `/api/cursor/*`, `/api/eng/snapshot` | cross-tool activity, team quality metrics |
| `career.json` (authored) | `~/.claude/career.json` | competency ratings, learning goals, OKRs, courses, ownership, feedback, tech radar, manual brag entries, project registry, cached AI analyses |

**Join model:** `session-meta` and `facets` share `session_id` → joined per session, then grouped by
`project_path`. This IS the per-project `/insights` numeric backbone; the HTML is parsed only for the
AI-written narrative. When `usage-data` is missing/stale, panels degrade gracefully to transcript-derived
equivalents and label themselves as such.

### 2.2 Projects model

The dashboard is **project-aware**. A project registry lives in `career.json`:

- **Auto-discovery:** on refresh, every distinct `project_path` seen in `session-meta` is offered as a
  project. The user confirms/keeps a curated set (add/remove), so noise projects don't clutter the view.
- Each project row aggregates: its `/insights` facets + git + taskboard tickets + Cursor/Eng metrics
  into one growth view. An **"All projects"** roll-up is the default scope, with a project dropdown
  (same control pattern as EngDashboard/InsightsSection).

### 2.3 Persistence

Single sidecar `~/.claude/career.json`, written with the app's existing **versioned-write + backup**
convention (like `taskboard.json`, `team-designs.json`). Shape (top level):

```
{
  version, updatedAt,
  projects: [{ id, path, label, active, owned }],
  competency: { levelSelfAssessed, ratings: { [area]: { level, score1to5, note } } },
  learning: { now: [goal], next: [goal] },          // goal = { id, title, measure, target, progress, links[] }
  okrs: [{ id, objective, krs: [{ id, text, metricRef, target, current }] , quarter }],
  courses: [{ id, title, provider, url, status, progress, linkedGoalId }],
  ownership: [{ id, system, role, since, notes }],
  feedback: [{ id, date, source, text, tag: 'strength'|'growth', linkedArea }],
  techRadar: [{ id, tech, ring: 'adopt'|'trial'|'assess'|'hold', note }],
  brag: [{ id, date, title, impact, evidence, source: 'auto'|'manual', links[] }],
  insightsRaw: { reportParsedAt, atAGlance, wins, horizon, suggestedClaudeMd, features, patterns },
  analyses: { [panelKey]: { inputHash, at, markdown } },
  // gamification (see 3.2) — all awards idempotent by event id
  xpLedger: [{ id, at, kind, xp }],
  quests: [{ id, title, source, measure, target, xpReward, status, acceptedAt, completedAt }],
  badges: [{ id, earnedAt }],
  personalBests: { bestFlowWeek, lowestBugRatio, longestStreak, mostKrsInQuarter }
}
```

## 3. Panels

Each panel is a self-contained component in `src/career/` (one file per panel) consuming a slice of
the snapshot. Every panel maps to at least one hard requirement.

| # | Panel | Component | Hard requirement | Primary data |
|---|---|---|---|---|
| 1 | **Me / Now** | `MePanel.jsx` | current level; what I'm doing right now | running sessions (transcripts, 5-min window), self-set IC level, streak, active focus |
| 2 | **Competency Matrix** | `CompetencyPanel.jsx` | skills; what I'm lacking | IC1–IC6 × competency grid, 1–5 self-rating **evidenced** by langs/PRs/commit areas; low/aspirational cells → "lacking" |
| 3 | **Work Session & Flow** (SPACE) | `FlowPanel.jsx` | what my work session looks like | session shape, deep-work blocks, WIP count, context-switch rate, after-hours %, day×hour heatmap, response-time distribution (from session-meta) |
| 4 | **Quality** (DORA) | `QualityPanel.jsx` | bugs from my work; optimize metrics | bugs.json + review findings attributed to me, outcome distribution & friction from facets, change-fail proxy, lead time |
| 5 | **Tasks** | `TasksPanel.jsx` | pending / to-test / in-progress + recommended approach + next steps | Task Board + Jira; per-task heuristic reco; `✨ Analyze` for deep advice |
| 6 | **Focus & Growth** | `FocusPanel.jsx` | what to focus on; do better; learn from tasks | heuristic ranked focus list synthesized from panels 2–5,7 + facets friction; `✨ Analyze` narrative |
| 7 | **Workflow** | `WorkflowPanel.jsx` | current workflow (Claude analysis); optimize | tool mix, session_type mix, one-shot vs iterative, interruption rate, `claude_helpfulness`, friction types (from facets); observed Flow-graph path |
| 8 | **Learning** | `LearningPanel.jsx` | now learning / will learn (measurable) | editable goals w/ progress; courses; tech radar |
| 9 | **OKRs & Objectives** | `OkrPanel.jsx` | (added) | editable OKRs; KRs auto-track a `metricRef` against panels 3/4/7 |
| 10 | **Brag / Work Log** | `BragPanel.jsx` | promo/review prep | auto-seeded from merged PRs / closed tickets / releases + `/insights` wins; manual entries; **export promo packet** (markdown) |
| 11 | **Influence & Ownership** | `InfluencePanel.jsx` | staff+ signal (added) | ADRs/design docs authored, mentorship (reviews for others), talks/writing/OSS; systems owned |
| 12 | **Feedback** | `FeedbackPanel.jsx` | grounds "lacking" / "do better" | captured feedback tagged strength/growth, linkable to competency areas |
| 13 | **`/insights` (per project)** | `InsightsProjectPanel.jsx` | include /insights output | joined facets+session-meta grouped by project + parsed narrative from report.html |
| 14 | **Gamification** | `GamePanel.jsx` | growth motivation / engagement | career level & XP, quests, skill tree, streaks, achievements, personal bests — see 3.2 |

### 3.1 Heuristic recommendation rules (examples, deterministic)

- Quality: if attributed bug ratio rose >X% vs prior period → focus item "shore up tests / verification".
- Workflow: if `friction_counts.wrong_approach` is top-2 → "front-load explicit constraints" tip.
- Flow: if after-hours % > threshold or WIP > N → sustainability warning.
- Tasks: per ticket, next step derived from its board column + age vs SLA (reuse EngDashboard's
  per-ticket "move by DATE" recommendation logic).
- Competency: any area with real evidence (commits/PRs) but low self-rating → "under-credited";
  aspirational area with no evidence → "gap to close" (feeds Learning).

Each heuristic emits a small structured object `{ severity, area, message, evidenceRefs }` so the Focus
panel can rank them and the `✨ Analyze` prompt can expand the top few.

### 3.2 Gamification (panel 14)

Rewards **career growth**, not raw activity (the Claude Overview already gamifies activity — this is
deliberately different). Reuses the Overview gamification primitives (level ring, streak chip, badge grid).

- **Career Level & XP** — a single level with XP from *growth events*, each worth fixed XP:
  competency cell leveled up, learning goal completed, course finished, KR closed, OKR closed,
  brag entry logged, design doc / ADR recorded, mentorship (review for another) recorded. Level curve
  `n = ceil(sqrt(xp / 100))` (tunable). The XP ledger is derived on refresh from real events, with a
  `career.json` `xpLedger` recording one-time awards so completed events aren't double-counted.
- **Quests** — any Focus heuristic item or Learning goal can be **accepted as a quest**
  `{ id, title, source, measure, target, xpReward, status, acceptedAt, completedAt }` stored in
  `career.json`. Progress auto-tracks its `measure` against the live snapshot (e.g. "bug ratio < 5%");
  completing it awards XP and can unlock a badge. Turns "what should I focus on" into actionable goals.
- **Skill Tree** — the competency matrix rendered as a tree: each competency is a node, its ring fills
  with `(evidence + selfRating)`, and higher-IC tiers are locked until prerequisites reach a threshold.
  Purely a visualization over panel 2 data + `career.json` ratings; no new persistence.
- **Streaks** — three: **coding streak** (days with session activity, from transcripts/session-meta),
  **learning streak** (days a learning goal advanced or a course logged progress), **brag-log streak**
  (consecutive days a brag entry was added — encodes the research-backed 5-min/day habit). Today-idle
  doesn't break a streak (matches existing Overview streak rule).
- **Achievements / badges** — computed live from real data, stored (once earned) in `career.json`
  `badges[]`. Initial set: *First Design Doc, Mentor (reviewed ≥N others' PRs), OKR Closer,
  Zero-Regression Sprint (a period with 0 attributed bugs), Deep-Work Champion (≥N deep-work blocks in a
  week), IC-Level Reached, Polyglot (shipped in ≥N languages), Quest Streak, Course Graduate*.
- **Personal bests** — "leaderboard vs past self": best flow week, lowest bug ratio, longest streak,
  most KRs closed in a quarter. Derived from snapshot history within the loaded window; no warehouse.

XP/quests/badges live in `career.json` (added to the shape in 2.3): `xpLedger[]`, `quests[]`, `badges[]`,
`personalBests{}`. All awards are idempotent (keyed by event id) so a refresh never double-grants.

## 4. API surface (`server-career.mjs`)

- `GET  /api/career/snapshot` → full computed model (from cache).
- `POST /api/career/refresh` → rebuild snapshot (rescans usage-data, git, taskboard, bugs, cursor/eng).
- `GET  /api/career/config` / `POST /api/career/config` → read/write `career.json` authored sections.
- `POST /api/career/analyze` `{ panelKey, payload }` → `claude -p` narrative, cached by input hash.
- `GET  /api/career/promo-packet` → assembled markdown export (brag + competency + metrics).

All writes go through the existing backup+version helper. Server binds localhost only (inherited).

## 5. Error handling & degradation

- Missing `~/.claude/usage-data/` → panels 3/4/7/13 fall back to transcript-derived metrics and show a
  "run `/insights` for richer analysis" hint; no crash.
- Malformed/partial facet or session-meta JSON → skip that session, count it in a `skipped` tally shown
  in the refresh result (no silent truncation).
- `report.html` absent or schema-changed → numeric panels unaffected; narrative panel shows "no parsed
  narrative; paste or re-run /insights".
- `claude -p` failure/timeout on Analyze → surface the error inline, keep heuristic output.
- `career.json` absent → created on first write from a documented default skeleton.

## 6. Testing

- **Parsers** (facets, session-meta, report.html) — unit tests over the real sample report and a
  malformed fixture; assert join-by-session_id and group-by-project_path, and graceful skip.
- **Heuristic rules** — table-driven tests: given a synthetic snapshot slice, assert the expected
  focus items and severities.
- **Snapshot builder** — integration test with a tmp `usage-data` + `career.json` fixture asserting the
  assembled model shape.
- **API** — supertest-style checks that endpoints return the documented shapes and that writes are
  backed up + versioned.
- **Frontend** — smoke render of `CareerDashboard` with a mocked snapshot; each panel renders without
  throwing on empty data.

## 7. Out of scope (YAGNI)

- No external integrations beyond files already on disk (no live Jira/GitHub API calls beyond what the
  Eng dashboard already does; PRs come via existing snapshot).
- No multi-user / team rollups — this is a single-person view (the Eng dashboard covers team).
- No editing of `/insights` source data; the dashboard is read-only over usage-data.
- No historical time-series persistence beyond what snapshots already expose; trend = current vs prior
  period within the loaded data, not a new metrics warehouse.

## 8. Reuse map (don't rebuild)

- Transcript parsing, running-session detection, git commit counts, language histograms → helpers in
  `server.mjs` / Projects section.
- Day×hour heatmap, one-shot/correction rates → `InsightsSection.jsx`.
- Per-ticket "move by DATE" recommendation, board ordering, paginated tables → `EngDashboard.jsx`.
- Cursor/Eng cross-tool metrics → existing `/api/cursor/*`, `/api/eng/snapshot`.
- `claude -p` analyze pattern, versioned writes, backups → Team Designer / Task Board / server backup helper.
- Design system (fonts, PANEL glass style, accent) → existing dashboards; Career gets its own accent to
  stay visually distinct while consistent.
