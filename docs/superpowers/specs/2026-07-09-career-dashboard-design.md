# Career Dashboard — Design Spec

**Date:** 2026-07-09
**Status:** Approved for planning (phased)
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

It also folds in the **Claude Code `/insights`** output per project, reuses data already computed by
the Claude, Cursor, and Engineering-Metrics dashboards, and — added in review — turns the dashboard
from a mirror into a **meeting artifact** (1:1 prep, promo-case assembly, decision record).

### 1.1 Success criteria (Phase 1 gate)

This is a single-user tool; its enemy is abandonment, not bad architecture. Phase 1 is judged solely by:

- **(a) Voluntary weekly use** — the author opens it at least weekly without forcing themselves.
- **(b) Review-prep leverage** — the brag log / story-so-far export materially shortens the next
  review-cycle prep (measured: prep done "from receipts," not memory).
- **(c) Behavior change** — at least one **Focus** recommendation changes what the author actually works
  on in a given month.

If Phase 1 does not hit (a)–(c), we stop and reassess **before** building Phase 2 — not after.

### 1.2 Framework grounding (from research)

- **SPACE** — the only mainstream framework aimed at the *individual*. Anchors work-session, focus, flow,
  workflow, and time-allocation panels. Wellbeing signals: WIP, context-switching, after-hours %,
  sustainable pace. NB: SPACE explicitly warns against **activity metrics becoming targets** — see the
  gamification rule in §3.2 (XP rewards *outcomes*, never *logging*).
- **DORA** — delivery/quality. Anchors the quality/bugs panel and "optimize my metrics."
- **Competency matrix (IC1–IC6, 1–5)** — scaffolding for skills; the **real ladder** (pasted, §3 P2)
  is what promotions are judged against.
- **Brag document / promo packet** — research is unanimous this is the single highest-leverage artifact.
  Built exceptionally well in Phase 1 *before* anything gamified.

Sources: SPACE vs DORA — https://www.swarmia.com/blog/comparing-developer-productivity-frameworks/ ,
https://getdx.com/blog/space-metrics/ · Competency matrix (IC1–IC6) —
https://sprad.io/resources/software-engineer-skill-matrix-competency-framework-by-level-ic1-ic6-behaviors-examples-template-3914c ·
Brag / promo — https://jvns.ca/blog/brag-documents/ , https://staffeng.com/guides/promo-packets/ ,
https://blog.pragmaticengineer.com/work-log-template-for-software-engineers/ · Flow/burnout —
https://www.hatica.io/blog/can-deep-work-solve-dev-burnout/

## 2. Architecture

Follows the existing multi-dashboard pattern (`?dash=cursor`, `?dash=eng`):

- **Shell:** `src/CareerDashboard.jsx` — full-screen, rendered from `src/App.jsx` when `dash === 'career'`;
  a top-chip button + `goDash('career')` added next to `⇄ Cursor` / `⇄ Eng Metrics`.
- **Server:** `server-career.mjs`, exporting `mount(app, deps)` called from `server.mjs` (same shape as
  `server-eng.mjs`). Reuses shared transcript/git/project helpers where exported; re-implements only gaps.
- **Compute model:** cached snapshot. `GET /api/career/snapshot` returns the cached model;
  `POST /api/career/refresh` rebuilds it. Frontend filters (project / range / month) client-side.
- **Recommendation engine:** hybrid. Deterministic heuristics ship in the snapshot instantly; a per-panel
  `✨ Analyze` button hits `POST /api/career/analyze` running a real `claude -p` pass (like Team Designer),
  cached in `career.json` by input hash.

### 2.1 Data sources

| Source | Path / origin | Feeds |
|---|---|---|
| `/insights` facets | `~/.claude/usage-data/facets/<session-id>.json` | goal, outcome, user_satisfaction, claude_helpfulness, session_type, friction_counts, primary_success, brief_summary |
| `/insights` session-meta | `~/.claude/usage-data/session-meta/<session-id>.json` | project_path, duration, tool_counts, languages, git_commits/pushes, tokens, user_interruptions, user_response_times, first_prompt |
| `/insights` narrative | `~/.claude/usage-data/report.html` (latest `report-*.html`) | At-a-Glance, wins, horizon, suggested CLAUDE.md, features & patterns — **quarantined parser, see 2.4** |
| Transcripts | `~/.claude/projects/**/*.jsonl` | flow/deep-work, activity, workflow (fallback when usage-data absent) |
| Git | project repos | commits, churn, language histogram |
| Task Board / Jira | `~/.claude/taskboard.json` + Eng snapshot | pending / to-test / in-progress, cycle time, aging |
| PRs & bugs | `~/.claude/bugs.json`, review findings (`ReportFindings` in transcripts) | DORA quality, attributed bugs (rule in 2.5) |
| Cursor + Eng snapshots | existing `/api/cursor/*`, `/api/eng/snapshot` | cross-tool activity, team quality metrics |
| `career.json` (authored) | `~/.claude/career.json` | all curated state + persisted rollups (2.3) |

**Join model:** `session-meta` ⋈ `facets` on `session_id`, grouped by `project_path` → the per-project
`/insights` numeric backbone. HTML parsed only for narrative.

### 2.2 Projects model

Project-aware. `career.json` holds a registry; on refresh every distinct `project_path` in `session-meta`
is offered, the user curates active projects, and an **"All projects"** roll-up is the default scope.
Each project aggregates its facets + git + taskboard + Cursor/Eng data into one growth view.

### 2.3 Persistence

Single sidecar `~/.claude/career.json`, written with the app's existing **versioned-write + backup**
convention. **Minimize manual feeding** (§4 rule). Shape:

```
{
  version, updatedAt,
  projects: [{ id, path, label, active, owned }],
  // authored / curated
  competency: { levelSelfAssessed, ratings: { [area]: { level, score1to5, note } },
                ladder: [{ level, area, expectation, evidenceState: 'green'|'yellow'|'red', bragLinks[] }] },
  learning: { now: [goal], next: [goal], techRadar: [{ id, tech, ring, note }] }, // goal={id,title,measure,target,progress,links[]}
  okrs: [{ id, objective, quarter, krs: [{ id, text, metricRef, target, current }] }],
  courses: [{ id, title, provider, url, status, progress, linkedGoalId }],
  ownership: [{ id, system, role, since, notes }],
  feedback: [{ id, date, source, text, tag:'strength'|'growth', linkedArea }],
  feedbackRequests: [{ id, askedOf, topic, trigger, status, requestedAt, receivedAt }],
  decisions: [{ id, date, chose, over, because, revisitWhen, outcome, becameAdr }],
  brag: [{ id, date, title, impact, evidence, source:'auto'|'manual', links[] }],
  retros: [{ id, weekOf, worked, didnt, differently }],
  timeTarget: { deepWork, reviewsMentorship, designStrategy, opsInterrupts },   // percentages
  oneOnOnes: [{ id, date, agreedActions:[{text,done}], managerFeedback, growthTopic, briefSnapshot }],
  // derived + cached (idempotent)
  insightsRaw: { reportParsedAt, atAGlance, wins, horizon, suggestedClaudeMd, features, patterns },
  analyses: { [panelKey]: { inputHash, at, markdown } },
  // gamification — outcomes only (§3.2)
  xpLedger: [{ id, at, kind, xp }], quests: [...], badges: [{ id, earnedAt }],
  // persisted scalar rollup (deliberate §7 exception) — NOT a warehouse
  rollup: { activityDays: [isoDate], streaks: {...}, personalBests: {...}, quarterlyBugRatio: {...} }
}
```

### 2.4 Architectural rules (hard)

- **`report.html` parsing is quarantined.** It runs in an isolated module with its own try/catch and
  produces ONLY the `insightsRaw` narrative slice. A schema change or parse failure there **can never**
  affect numeric panels (which read facets/session-meta JSON, a comparatively stable contract). This is a
  build-time boundary, not a runtime hope. The `/insights` file formats are **undocumented internal
  contracts** — treat parser upkeep as ongoing maintenance and version the parser.
- **Refresh is incremental.** Parsed facets/session-meta/transcripts are cached per-file by mtime (the app
  already does this for transcripts); refresh skips unchanged files and only re-parses new/modified ones.
  Git/taskboard/bugs/cursor/eng are cheap re-reads. Target: a warm refresh is sub-second; a cold first
  build is documented as a few-seconds operation. The refresh response reports `{ parsed, skipped, tookMs }`.

### 2.5 Bug attribution rule (load-bearing — defined, not implied)

"Bugs from my work" and the change-fail proxy use a **single, explicit, conservative** rule, shown in UI
with a "how this is counted" tooltip so the number is trustworthy:

- A bug counts as **mine** iff at least one of: (1) it is linked (taskboard/Jira) to a ticket whose branch
  I authored; (2) a `ReportFindings` review finding of severity ≥ *warning* landed on a diff I authored;
  (3) a `bugs.json` entry whose auto-bisect culprit commit is authored by me (git author = configured me).
- **Change-fail proxy** = (attributed bugs + reverts on my commits) ÷ (my merged PRs) over the window.
- Attribution is **surfaced, never silent**: each counted bug lists which rule matched. Unattributable
  bugs go to an "unattributed" bucket, not to me. The rule is centralized in one function, unit-tested.

## 3. Panels (phased)

Each panel is a self-contained component in `src/career/`. **Phasing is explicit** — Phase 1 answers every
hard requirement in §1; later phases are earned by the §1.1 gate.

### Phase 1 — the core (must answer all hard requirements; minimal manual feeding)

| # | Panel | Component | Hard requirement | Feeding |
|---|---|---|---|---|
| 1 | **Me / Now** | `MePanel.jsx` | current level; what I'm doing right now | auto (running sessions, streak) |
| 2 | **Tasks** | `TasksPanel.jsx` | pending / to-test / in-progress + recommended approach + next steps; **risk-to-commitments** flag when in-progress work trends late | auto (taskboard/Jira) + heuristic |
| 3 | **Work Session & Flow** (SPACE) | `FlowPanel.jsx` | what my work session looks like | auto (session-meta/transcripts) |
| 4 | **Quality** (DORA) | `QualityPanel.jsx` | bugs from my work; optimize metrics | auto (bugs/findings, rule §2.5) |
| 5 | **`/insights` (per project)** | `InsightsProjectPanel.jsx` | include /insights output | auto (facets+meta+narrative) |
| 6 | **Brag / Work Log** | `BragPanel.jsx` | promo/review prep | **auto-seeded** from merged PRs / closed tickets / releases / `/insights` wins; manual add optional. Includes a 3-line **weekly retro** capture (worked / didn't / differently) that feeds Analyze + the brag streak, and a **story-so-far** half-page narrative export + promo-packet export |
| 7 | **1:1 Prep** | `OneOnOnePanel.jsx` | *added in review — highest leverage* | **composition** of 1–6: wins since last 1:1, blockers/risks (aging tasks + quality regressions), decisions I need, progress on last-agreed actions, one growth topic. **Persists the meeting**: after each 1:1 log agreed actions + manager feedback; next brief opens with "status of what we agreed." |

### Phase 2 — growth analysis (earned by the §1.1 gate; some curation)

| # | Panel | Component | Requirement | Feeding |
|---|---|---|---|---|
| 8 | **Competency + Expectation-gap** | `CompetencyPanel.jsx` | skills; what I'm lacking; **am I ready for next level** | self-rating grid (manual) **+ pasted real ladder rows** mapped to evidence green/yellow/red with brag links. Evidence is a **nudge only** — copy/visuals never imply it validates a rating |
| 9 | **Focus & Growth** | `FocusPanel.jsx` | what to focus on; do better; learn from tasks | auto (heuristics over 2–4,10) + `✨ Analyze` |
| 10 | **Workflow (how I use Claude)** | `WorkflowPanel.jsx` | current workflow; optimize | auto (facets: tools, session_type, interruptions, friction) |
| 11 | **Learning (+ Tech Radar)** | `LearningPanel.jsx` | now / will learn (measurable); courses | manual goals w/ progress; **tech radar folded here** as the "will learn" backlog |
| 12 | **Time Allocation vs Intended** | `AllocationPanel.jsx` | *added in review* | **target split** (one-time manual) vs actual from session/tool data; drift = early stagnation/burnout signal + concrete 1:1 escalation |
| 13 | **Decision Log** | `DecisionPanel.jsx` | *added in review — records judgment, not outcomes* | manual, lightweight; quarterly "was I right?" review; good entries graduate to ADRs (feeds Influence) |

### Phase 3 — motivation & social (PROVISIONAL: build a panel only if §1.1 passed AND a concrete need appears)

| # | Panel | Component | Notes |
|---|---|---|---|
| 14 | **Gamification** | `GamePanel.jsx` | §3.2 — outcomes-only XP |
| 15 | **OKRs & Objectives** | `OkrPanel.jsx` | KRs auto-track a `metricRef` against panels 3/4/10 |
| 16 | **Influence & Ownership** | `InfluencePanel.jsx` | ADRs/design docs (from Decision Log), mentorship, talks/writing/OSS; systems owned |
| 17 | **Feedback (request + capture)** | `FeedbackPanel.jsx` | **active nudge**: after a project ships / design review lands, suggest "ask [reviewer/PM/peer] for feedback on X" and track whether you did — solicited feedback = growth-area evidence that isn't self-assessment. Plus passive capture tagged strength/growth |

### 3.1 Heuristic recommendation rules (deterministic; examples)

- Quality: attributed bug ratio (rule §2.5) rose >threshold vs prior period → focus "shore up tests".
- Workflow: `friction_counts.wrong_approach` top-2 → "front-load explicit constraints".
- Flow: after-hours % > threshold or WIP > N → sustainability warning.
- Allocation: any target bucket at <½ its target for 2+ periods → drift flag ("zero design work in 2 months").
- Tasks: per-ticket next step from board column + age vs SLA (reuse EngDashboard's "move by DATE" logic);
  in-progress ticket trending late → **risk-to-commitments** (surfaces in 1:1 brief early).
- Competency: real evidence + low self-rating → "under-credited"; ladder row red → "gap to close" (→ Learning).

Each heuristic emits `{ severity, area, message, evidenceRefs }`; Focus ranks them, `✨ Analyze` expands
the top few, and any item can be **accepted as a quest** (Phase 3).

### 3.2 Gamification (Phase 3, panel 14)

Rewards **career growth outcomes**, never activity or logging (SPACE/Goodhart guard). Reuses Overview's
level-ring/streak/badge primitives.

- **XP & Level** — XP only from **completed outcomes**: KR closed, OKR closed, learning goal completed,
  course finished, competency cell leveled up, quest completed. **No XP for logging** a brag/decision/retro
  entry. Curve `n = ceil(sqrt(xp/100))` (tunable). `xpLedger` records one-time idempotent awards.
- **Quests** — a Focus item or Learning goal accepted as a tracked goal with target + XP; progress
  auto-tracks its `measure` against the live snapshot; completion awards XP / may unlock a badge.
- **Skill Tree** — competency matrix as a tree (visualization over panel 8; no new persistence).
- **Streaks** — coding / learning / brag-log streaks. Computed from the **persisted `rollup.activityDays`
  set** (see §7), so they survive data-window rotation. Today-idle doesn't break (Overview rule).
- **Achievements** — live from real data, stored once earned: *First Design Doc, Mentor (≥N reviews for
  others), OKR Closer, Zero-Regression Sprint, Deep-Work Champion, IC-Level Reached, Polyglot, Course
  Graduate, Quest Streak*.
- **Personal bests** — best flow week, lowest bug ratio, longest streak, most KRs/quarter — from the
  persisted `rollup`, so "best" means all-time, not window-limited.

## 4. Manual-panel rule

Every panel that requires manual entry must, at its phase review, either (a) **auto-seed aggressively**
(Brag from PRs/tickets; 1:1 brief from data; competency evidence from git/PRs; allocation from tool data),
or (b) justify its existence against §1.1. Panels that only store hand-typed data with no auto-seed and no
clear leverage are cut, not shipped to rot. Feedback, ownership, courses, and competency self-ratings are
on notice under this rule.

## 5. API surface (`server-career.mjs`)

- `GET  /api/career/snapshot` → full computed model (cache).
- `POST /api/career/refresh` → incremental rebuild; returns `{ parsed, skipped, tookMs }`.
- `GET/POST /api/career/config` → read/write `career.json` authored sections.
- `POST /api/career/analyze` `{ panelKey, payload }` → `claude -p`, cached by input hash.
- `GET  /api/career/promo-packet` and `GET /api/career/story-so-far` → assembled markdown exports.
- `POST /api/career/one-on-one` → persist a 1:1 (agreed actions + feedback) and snapshot the brief.

All writes use the backup+version helper; server binds localhost only.

## 6. Error handling & degradation

- Missing `usage-data/` → panels 3/4/5/10 fall back to transcript-derived metrics with a "run `/insights`
  for richer analysis" hint; no crash.
- Malformed facet/session-meta JSON → skip session, count in `skipped` (no silent truncation).
- `report.html` absent/changed → **numeric panels unaffected** (quarantine §2.4); narrative shows "no
  parsed narrative; re-run /insights".
- `claude -p` failure/timeout → inline error, heuristics remain.
- `career.json` absent → created from documented default skeleton.

## 7. Persistence exception (deliberate)

There is **no metrics time-series warehouse**. The one exception, chosen consciously: a bounded **scalar
rollup** in `career.json.rollup` — an `activityDays` date-set (for streaks) plus a few dozen scalars
(personal bests, per-quarter bug ratio). Streaks and "all-time best" are inherently historical and would be
silently wrong if derived from a limited load window, so they are persisted, not recomputed. This is a few
kB, not a warehouse, and is the only place snapshot outputs are retained across refreshes.

## 8. Testing

- **Parsers** (facets, session-meta, quarantined report.html) — unit tests over the real sample report + a
  malformed fixture; assert join-by-session_id, group-by-project_path, graceful skip, and that a report.html
  parse failure yields empty narrative without touching numeric output.
- **Bug attribution (§2.5)** — table-driven: each rule branch + the unattributed bucket.
- **Heuristics / allocation drift / risk-to-commitments** — synthetic snapshot slices → expected items.
- **Rollup** — streak survives a window that no longer contains older activity days; bests are monotonic.
- **Snapshot builder** — integration over tmp `usage-data` + `career.json`; asserts incremental skip.
- **API** — documented shapes; writes backed up + versioned.
- **Frontend** — smoke render of each panel on empty data without throwing.

## 9. Out of scope (YAGNI)

- No external integrations beyond files on disk (PRs via existing Eng snapshot; no new live Jira/GitHub).
- No multi-user/team rollups (Eng dashboard owns team).
- No editing of `/insights` source data (read-only over usage-data).
- Phase 3 panels are provisional; do not pre-build.

## 10. Reuse map (don't rebuild)

- Transcript parsing, running-session detection, git counts, language histograms → `server.mjs` / Projects.
- Day×hour heatmap, one-shot/correction rates → `InsightsSection.jsx`.
- Per-ticket "move by DATE", board ordering, paginated tables → `EngDashboard.jsx`.
- Cursor/Eng cross-tool metrics → existing `/api/cursor/*`, `/api/eng/snapshot`.
- `claude -p` analyze, versioned writes, backups → Team Designer / Task Board / server backup helper.
- Overview gamification primitives (level ring, streak, badge grid) → Overview.
- Design system → existing dashboards; Career gets its own accent for distinct-but-consistent identity.
