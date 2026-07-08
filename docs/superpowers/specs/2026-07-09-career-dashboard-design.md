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
  on in a given month. This is the criterion most easily graded generously from memory, so it is made
  **self-measuring**: every Focus item carries an **"acted on" mark** the author sets when it lands, and
  "acted on" has a **defined evidence bar** — a ticket picked up, a lesson accepted, or a harness fix
  applied, each **traceable to that specific Focus item** (the mark stores the linked ref). **During the
  Phase-1 gate specifically, the only reachable evidence type is "a ticket picked up (or task approach
  followed), traceable to the Focus item"** — lesson-accepted and harness-fix-applied are Phase-2+ artifacts
  that won't exist at gate time, so the gate must not depend on them. The Phase-1 gate review then reads (c)
  **out of the dashboard, not out of memory** — the entire thesis of this project applied to its own
  evaluation.

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
| PRs & bugs | `~/.claude/bugs.json`, review findings (`ReportFindings` in transcripts) | change-fail proxy from **escaped** attributed bugs; review findings feed the **separate** caught-in-review signal (rule §2.5) |
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
convention. **Minimize manual feeding** (§4 rule).

**Identity mapping (defined, not assumed).** Every attribution rule and cross-source join depends on knowing
which git author / GitHub / Jira / Confluence / Slack identity is "me." This is resolved **once** into the
`identity` block below and is the single source of truth for "mine." It is **validated on every import**: an
import that matches **zero** of my identities warns loudly (likely a misconfigured handle) rather than
returning a quietly-empty (and therefore silently-wrong) result. The resolver is unit-tested alongside the
attribution function, including the common two-git-emails case.

**Schema migration (backups protect against corruption, not drift).** On load, if `version` < current: run
ordered migration steps in sequence, write the migrated file back, and retain the pre-migration file as a
backup. If `version` is **newer** than this build understands: **refuse to write** and warn (an older build
must not clobber a newer schema). Covered by a test: load a v1 fixture, assert the migrated shape. The shape
below is versioned and expected to change across phases (§11.D adds collections mid-flight).

Shape:

```
{
  version, updatedAt,
  identity: { gitEmails: [], githubHandle, jiraAccountId, confluenceUser, slackUserId },
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
  retros: [{ id, weekOf, worked, didnt, change }],
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

**Escaped defects vs caught-in-review are different things and must never be summed.** Change-fail rate is
a DORA measure of *escaped* failures; a finding caught before merge is the review process *working*.
Conflating them creates a perverse incentive — more rigorous reviews would inflate the "bugs from my work"
number — so they are two separate signals.

- **Attributed bug (escaped) — counts as mine** iff at least one of: (1) it is linked (taskboard/Jira) to a
  ticket whose branch I authored; (2) a `bugs.json` entry whose auto-bisect culprit commit is authored by me
  (author matched via the identity block §2.3, not a single email). These feed the **change-fail proxy** =
  (attributed bugs + reverts on my commits) ÷ (my merged PRs) over the window.
- **Defect density caught in review — a SEPARATE signal, never in the change-fail numerator.**
  `ReportFindings` findings of severity ≥ *warning* on a diff I authored are counted on their own axis.
  Trending **down** means my self-verification is improving — genuinely useful, shown as its own metric, and
  explicitly excluded from the bug ratio, the quality badge, and the personal best.
- Attribution is **surfaced, never silent**: each counted bug lists which rule matched. Unattributable
  bugs go to an "unattributed" bucket, not to me. The rule is centralized in one function, unit-tested
  (including a test asserting review findings do NOT move the change-fail proxy).
- **Consequence — the rollup draws from this function, by construction.** `rollup.quarterlyBugRatio` and the
  **Zero-Regression** badge now mean **escaped-only** by definition. The rollup writer MUST source its bug
  counts from this centralized attribution function — never from `bugs.json` directly or any pre-§2.5-split
  path — so caught-in-review findings can't leak into a persisted historical number where they'd be invisible
  and permanent.
- **Phase-2 upgrade (§11.A):** once the GitHub import lands, rule (2) is augmented by **blame-based
  attribution** — link a bug-fix PR back to the PR that introduced the fixed lines via `git blame`,
  retiring the fuzzy `bugs.json` proxy and making the Quality panel trustworthy.

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
| 6 | **Brag / Work Log** | `BragPanel.jsx` | promo/review prep | **auto-seeded** from merged PRs / closed tickets / releases / `/insights` wins; manual add optional. Includes a 3-line **weekly retro** capture (worked / didn't / change) that feeds Analyze + the brag streak, and a **story-so-far** half-page narrative export + promo-packet export |
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

Each heuristic emits `{ severity, area, message, evidenceRefs, actedOn }`. **These recommendation items
exist in Phase 1** — surfaced inline in Tasks (recommended approach / risk-to-commitments), Quality (focus),
and Me/Now — and each carries the **"acted on" mark** that §1.1(c) is measured by. The dedicated **Focus &
Growth panel (Phase 2)** only *ranks and expands* the same items with `✨ Analyze`; it is not where they
first appear. Any item can be **accepted as a quest** (Phase 3). The gate in §1.1(c) therefore reads out of
Phase-1 panels, not out of a Phase-2 panel.

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

**Amended by §11.D (deliberate):** the external-source and learning-loop work adds a small set of further
persisted structures — `imports` (pointers to on-disk export files, not the data itself), `lessons`
(curated, human-approved), `ticketLinks` (a join cache), and `retros`. These are curated/cache/pointer
data, not a time-series warehouse; the "no warehouse" principle stands.

## 8. Testing

- **Parsers** (facets, session-meta, quarantined report.html) — unit tests over the real sample report + a
  malformed fixture; assert join-by-session_id, group-by-project_path, graceful skip, and that a report.html
  parse failure yields empty narrative without touching numeric output.
- **Bug attribution (§2.5)** — table-driven: each rule branch + the unattributed bucket, **plus a test that
  review findings do NOT move the change-fail proxy** (escaped vs caught-in-review stay separate).
- **Identity resolver (§2.3)** — matches across the two-git-emails case; a zero-match import **warns** rather
  than returning empty.
- **Schema migration (§2.3)** — load a v1 fixture → assert migrated shape; a newer-than-current version is
  refused, not clobbered.
- **Lesson graduation (§11.B)** — a structured `check` auto-graduates when its metric meets target over the
  window; a free-text `check` can only be graduated manually.
- **Heuristics / allocation drift / risk-to-commitments** — synthetic snapshot slices → expected items.
- **Rollup** — streak survives a window that no longer contains older activity days; bests are monotonic.
- **Snapshot builder** — integration over tmp `usage-data` + `career.json`; asserts incremental skip.
- **API** — documented shapes; writes backed up + versioned.
- **Frontend** — smoke render of each panel on empty data without throwing.

## 9. Out of scope (YAGNI)

- **Phase 1** takes no external integrations beyond files already on disk (PRs via existing Eng snapshot).
  External sources (GitHub/Jira/Confluence/Slack) arrive **Phase 2+** and remain **read-only batch imports
  dropped to disk** (§11.A) — never live write-back, never a synchronous API dependency in a panel render.
- No multi-user/team rollups (Eng dashboard owns team).
- No editing of `/insights` or imported source data (read-only over usage-data + imports).
- Phase 3 panels are provisional; do not pre-build.

## 10. Reuse map (don't rebuild)

- Transcript parsing, running-session detection, git counts, language histograms → `server.mjs` / Projects.
- Day×hour heatmap, one-shot/correction rates → `InsightsSection.jsx`.
- Per-ticket "move by DATE", board ordering, paginated tables → `EngDashboard.jsx`.
- Cursor/Eng cross-tool metrics → existing `/api/cursor/*`, `/api/eng/snapshot`.
- `claude -p` analyze, versioned writes, backups → Team Designer / Task Board / server backup helper.
- Overview gamification primitives (level ring, streak, badge grid) → Overview.
- Design system → existing dashboards; Career gets its own accent for distinct-but-consistent identity.

## 11. Addendum — External Data Sources & the Learning Loop

Added in review. The through-line: the value of external sources is **cross-referencing**, not more
panels. Each source alone is activity; joined, they measure **influence and impact** — what senior/staff is
actually assessed on. The learning loop then closes the circuit from "what happened" to "what I'll do
differently." All of this is Phase 2+ (see §11.C); none of it precedes the Phase-1 gate.

### 11.A External data sources (read-only, batch-imported to disk, each behind a quarantined parser)

**Architectural conditions (hard, same rigor as §2.4):** all four sources are **read-only**; imports are
**batch exports/API pulls dropped to disk** (files-on-disk architecture); **each source lands behind its own
quarantined parser** — a Slack export-format change must never break the Quality panel; each import is a
**snapshot input, not a new persistence layer** (only the pointer + lastAt persist, §11.D); tokens handled
properly; **nothing ever writes back** to these systems.

- **GitHub — first priority.** Adds the **review footprint** the spec is blind to: PRs I reviewed, comment
  depth, how often my comments led to changes, whose code I review (mentorship), and **how often I'm
  requested as reviewer** (the org's own expert signal — pure staff evidence). Plus PR lifecycle on my own
  work: time-to-first-review, review rounds/PR, size distribution (4-round PRs = scoping/communication
  growth signal; PRs unreviewed for days = a 1:1 team topic). **Closes the bug-attribution gap** →
  blame-based rule (upgrades §2.5).
- **Jira — second.** Beyond pending/in-progress: **cycle time per phase** (where my tickets stall),
  **estimate vs actual** (systematic underestimation of a work type = concrete "get better" item),
  **reopened-ticket rate** (cleaner change-fail signal than bugs), and **class of work** — epics I drive vs
  tasks handed to me, tickets I filed vs received. **Originated-vs-assigned trending up over quarters is one
  of the clearest promotion narratives that exists** → feeds the ladder-gap panel (§3, panel 8).
- **Confluence — third.** The Influence panel's missing evidence base: docs authored / substantially
  edited, comment threads resolved, and **view/link counts by others** (the line between a diary entry and
  organizational influence). Runbooks/onboarding = glue work invisible everywhere else. **Auto-seeds
  brag-log candidates** ("RFC on X viewed 40× across 3 teams").
- **Slack — last, and constrained.** Most valuable: **unrecorded mentorship/expertise** — questions
  answered in help channels, threads where I unblocked someone, incidents I jumped into, how often I'm
  tagged when my domain breaks. Also honest SPACE wellbeing: after-hours messages / interrupt-driven days
  measured where interrupts actually happen. **Hard Goodhart rule:** Slack data may feed **only** the brag
  log, the interrupt/wellbeing view, and expertise signals — **never a volume metric**. Prefer saved
  messages and reactions-received on substantive answers over raw activity.

**Two cross-source composites:**
1. **"True impact" join** for the brag log: Jira epic → its GitHub PRs → its Confluence design doc → the
   Slack announcement thread. **One brag entry per shipped initiative with all four receipts attached** —
   promo-packet generator at full power.
2. **"Where my time actually goes" reconciliation:** Claude sessions + GitHub review activity + Jira
   transitions + Slack interrupt bursts → one actual-vs-intended split (§3 panel 12). Any single source lies
   about time; four triangulate it.

### 11.B The learning loop

Frames everything as **deltas against my own baseline**; a fine session/ticket needs no lesson.

1. **Per-project Flow & Harness profile.** Make the Flow panel per-project (group-by `project_path`, already
   present) and add a **harness score**: how well is each project set up for effective AI-assisted work?
   Inputs: CLAUDE.md presence/quality (and whether applied `/insights` suggestions), sessions ending in
   verification vs untested, friction rate vs my cross-project baseline, one-shot success, interruption/
   correction rate, tool-mix health. Output: score + top 2–3 fixes ("no CLAUDE.md, 2.3× baseline friction,
   sessions rarely run tests"). Applied-fix state is **re-detected from the repo each refresh** (§11.D), not
   stored. **Harness improvements are legitimate quest material** (a Phase-3 forward-reference) — the rare
   metric where improving the number genuinely improves the work — but the harness panel **renders its score
   and fixes standalone** and must carry **no build dependency on quest code**; quests, when they arrive,
   consume harness output, not the reverse.
2. **Per-session "actual vs better."** Cheap deterministic heuristics catch pattern-level misses (many
   interruptions + `wrong_approach` → constraints not front-loaded; long session, no commits, unclear
   outcome → no checkpointing; hand-fixing output → verification missing). Deeper counterfactual is an
   **on-demand `✨ Analyze`** over the transcript, **never automatic**. Rules: **≤3 findings/session**, only
   for sessions that **deviate from my baseline**. Headline meta-metric: **repeat-friction rate** (same
   friction recurring in the same project) — the truest measure of learning vs logging.
3. **Per-ticket retro.** For each closed ticket compose Jira history (cycle time by phase, estimate vs
   actual, reopens) + its PRs (rounds, comments, size) + later-attributed bugs + AI sessions that touched
   it. **Linkage rule:** ticket IDs in branch names/commits; sessions matched by ticket ID in first prompt
   or working branch. **Where linkage fails, show the retro without session data rather than guessing** — a
   wrong join poisons trust.
4. **Lessons engine — a pipeline, not a panel.**
   - **Harvest** candidates (each with evidence links): recurring PR-review themes on my code (not one-off
     nitpicks), bugs traced to my changes (defect class: edge case / concurrency / misread AC), ticket AC
     vs shipped (late AC = requirements-reading lesson), session friction patterns, weekly retro lines.
   - **Distill:** a **weekly** (not per-event) `✨ Analyze` clusters candidates into themes and drafts
     lessons in a fixed shape **situation → pattern → rule → check**. Example: "Vague-AC tickets (situation)
     cost a review round in 4 of last 6 (pattern) → confirm AC with reporter before starting (rule) →
     checked by: review rounds on vague-AC tickets drop (check)." **A lesson without a measurable check is a
     fortune cookie.** Nothing enters the list without explicit approve/edit/discard.
     **The `check` must be structured, not prose** — a machine cannot evaluate "review rounds drop." It has
     the same shape as a KR: `check: { metricRef, comparator, target, window }`. Free-text is a fallback
     **only**, and a free-text-checked lesson is **manual-graduate only** (it can never auto-graduate). This
     keeps the engine's core mechanic — verification — from silently degrading into a journal.
   - **Apply & verify:** active lessons resurface contextually — matching project shows it in Me/Now,
     matching ticket flags it in Tasks. Each structured check is tracked against the live snapshot: pattern
     stops (metric meets target over its window) → lesson **auto-graduates to "internalized"** (badge-worthy);
     pattern recurs while active → **red flag for a 1:1** (rule wrong or environmental). **Cap ~5 active
     lessons** — twenty active is zero active.

**Psychological design rule (whole loop):** findings are deltas vs my own baseline; **graduated lessons are
celebrated as loudly as new ones are raised**; **repeat-friction trending down is the headline**. A
dashboard that opens with a list of failures gets closed in week two.

### 11.C Sequencing (amends the §3 phase plan)

- **Phase-2 gate unchanged, now concrete:** nothing here starts until the Phase-1 six-panel core (+ 1:1
  Prep) has **survived four weeks of real use** against §1.1.
- **Phase 2:** GitHub import (review footprint + blame-based attribution — upgrades already-built panels),
  then Jira (cycle time + originated-vs-assigned). **Harness score per project ships alongside Phase 2** —
  pure `/insights` regrouping, no new linkage.
- **Phase 3:** Confluence, then Slack (under the §11.A hard constraint). **Ticket retros** once GitHub+Jira
  linkage is proven; **Lessons pipeline last** — it only works fed by everything above; lessons from thin
  data are horoscopes. Per-session AI critique stays on-demand only.

### 11.D New persistence (extends §2.3; amends §7 deliberately)

```
imports:     { github: {lastAt, path}, jira: {...}, confluence: {...}, slack: {...} },
harness:     computed per project in snapshot — NO persistence. "Applied fixes" are RE-DETECTED from the
             repo each refresh (CLAUDE.md exists, sessions run tests, etc.), because a stored flag claims you
             did the fix, not that it's still true,
lessons:     [{ id, status:'draft'|'active'|'internalized'|'discarded',
                situation, pattern, rule,
                check: { metricRef, comparator, target, window } | { freeText },  // freeText ⇒ manual-graduate only
                evidenceRefs[], createdAt, graduatedAt }],
retros:      [{ id, weekOf, worked, didnt, change }],
ticketLinks: { [ticketId]: { prIds[], sessionIds[], confidence } }
```

All writes through the existing versioned-write + backup helper; all awards and imports **idempotent**.
