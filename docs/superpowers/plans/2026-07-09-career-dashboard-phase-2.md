# Career Dashboard — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

> **GATE — do not start Phase 2 until the Phase-1 four-week success gate passes** (`docs/career-phase1-gate.md`: voluntary weekly use, brag log shortened review prep, ≥1 Focus reco changed behavior). This is a spec-mandated gate (§1.1, §11.C), not a suggestion.

> **Depth calibration (honest):** Phase 1 is fully bite-sized because it executes next. Phase 2 tasks below are complete at *task* granularity — exact files, interfaces, ordered steps, and test assertions — with full code where it's determinable today. The GitHub/Jira import parsers are **pinned to real fixtures you capture in Task 0**: their transform code is written against that captured JSON, because writing per-line parser code against an unseen payload would be fiction. Task 0 removes that unknown before any parser is written.

**Goal:** Add growth-analysis panels (Competency + Expectation-gap, Focus & Growth with `✨ Analyze`, Workflow, Learning + Tech Radar, Time-Allocation, Decision Log) and the first external sources (GitHub review footprint + blame-based attribution, Jira cycle-time + originated-vs-assigned) plus a per-project harness score.

**Architecture:** New pure modules `career-import-github.mjs`, `career-import-jira.mjs`, `career-harness.mjs`, `career-analyze.mjs`; each external import is a **read-only batch drop to disk behind its own quarantined parser** (spec §11.A) — never a synchronous API call in a panel render. New React panels in `src/career/`. Extends `career.json` (`imports`, `competency.ladder`, `timeTarget`, `decisions`, `learning.techRadar`) and the snapshot.

**Tech Stack:** Same as Phase 1. GitHub via the already-authed `gh` CLI (as `server-eng.mjs` does); Jira via the Eng dashboard's existing REST/token path or a manual export drop.

## Global Constraints

- Inherits **all Phase-1 Global Constraints** (no new deps, `track()` writes, localhost, quarantined parsers, escaped-vs-caught split, identity-resolved-once, incremental refresh, career accent `#c9a15a`).
- **Every external source is read-only and writes nothing back.** Imports drop raw JSON to `~/.claude/career-imports/<source>/…` and persist only `{lastAt, path}` in `career.json.imports` (spec §11.A, §11.D).
- **Each import parser is quarantined** exactly like `report.html` (Phase-1 §2.4): its own try/catch; a format change degrades that source to empty, never crashes a panel.
- **Identity is the sole join key** across git/GitHub/Jira (`resolveIdentity`, Phase-1 Task 2); a zero-match import must `warnIfNoMatch`, not silently return empty (spec §2.3).
- **Blame-based attribution augments, never replaces silently** — the §2.5 escaped-vs-caught split is preserved; review findings still never enter change-fail.
- **Harness score has NO persistence and NO quest dependency** — re-detected from the repo each refresh; renders standalone (spec §11.B/D).
- **`✨ Analyze` is on-demand only** — never called on snapshot build; results cached in `career.json.analyses` by input hash (spec §2, §3).

---

### Task 0: Capture real GitHub + Jira fixtures (removes the parser unknown)

**Files:** Create `test/fixtures/github/reviews.json`, `test/fixtures/github/prs.json`, `test/fixtures/jira/issues.json`.

> **PRIVACY — redact before committing (fix).** Raw `gh`/Jira output contains **other people's** names, emails, ticket titles, and review comments. Committed to a repo that ever touches a remote, that is coworker data leaving your machine. Same rule as Phase-3 Task 0: **keep field paths and shapes; tokenize every name/email/title/comment** (e.g. `reviewer-1`, `user1@example.test`, `TICKET-TITLE-1`). **Your own identity fields stay real** — the tests match "mine" on them.

- [ ] **Step 1:** Capture your review footprint and PR lifecycle JSON, then run them through a redaction pass before saving:
  `gh api "search/issues?q=reviewed-by:@me+type:pr" | node scripts/redact-fixture.mjs > test/fixtures/github/reviews.json`
  `gh pr list --author @me --state all --json number,title,createdAt,mergedAt,reviews,additions,deletions,files | node scripts/redact-fixture.mjs > test/fixtures/github/prs.json`
  Write a tiny `scripts/redact-fixture.mjs` that walks the JSON and replaces any key in `{name, login, email, title, body, displayName}` with a stable token (`login→reviewer-N`), **except** values equal to your own handle/emails (from `career.json.identity`), which pass through unchanged.
- [ ] **Step 2:** Capture Jira issues you're involved in (reuse the Eng dashboard's host/token, or export from Jira): a JSON array with `key, fields.status, fields.reporter, fields.assignee, fields.created, changelog.histories[]`. Pipe through the same redactor (tokenize `reporter`/`assignee` displayName/email and `summary`, keep your own). Save to `test/fixtures/jira/issues.json`.
- [ ] **Step 3:** Inspect both — note the exact field paths present. **These fixtures are the contract** every parser test asserts against. Confirm no un-tokenized coworker name/email/title remains (`grep` for a known colleague's name should return nothing).
- [ ] **Step 4:** Commit the redactor + fixtures. `git add scripts/redact-fixture.mjs test/fixtures/github test/fixtures/jira && git commit -m "test(career): capture + redact GitHub/Jira fixtures for phase-2 parsers"`

---

### Task 1: GitHub import — review footprint + PR lifecycle (quarantined)

**Files:** Create `career-import-github.mjs`; Test `test/career-github.test.mjs`.

**Interfaces:**
- `importGithub({ ghJson: { reviews, prs }, resolved })` → **never throws**; returns `{ reviewFootprint:{ prsReviewed, commentsLeftEstimate, reviewedForOthers:Map<author,count>, requestedAsReviewer }, prLifecycle:{ timeToFirstReviewHrs:[], reviewRoundsPerPr:[], sizeBuckets:{} }, error? }`.
- Consumes `resolved` (identity) to separate my PRs from others' and count mentorship (reviews I gave on others' code).

- [ ] **Step 1: Write failing test** over `test/fixtures/github/*.json`: assert `prsReviewed > 0`, `reviewedForOthers` excludes my own handle, `reviewRoundsPerPr` is an array, and that `importGithub` returns `{error}` (not a throw) on `{ ghJson:{reviews:null,prs:null} }`.
- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3: Implement** `career-import-github.mjs`: a `parse()` core (transform the captured JSON into the interface shape) wrapped in `export function importGithub(...) { try { return parse(...) } catch (e) { return { error:e.message, reviewFootprint:{...empty}, prLifecycle:{...empty} } } }`. Write `parse()` against the exact field paths seen in Task 0's fixtures (e.g. `prs[].reviews.length` for rounds, `mergedAt-createdAt` for lifecycle, `reviews[].user.login` for reviewer identity).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Add a server reader in `server-career.mjs`: `POST /api/career/import/github` shells `gh` (like `server-eng.mjs`), drops raw JSON to `~/.claude/career-imports/github/<ts>.json`, updates `imports.github={lastAt,path}` via `store.write`, invalidates cache. Snapshot's `build()` reads the latest dropped file (not a live `gh` call).
- [ ] **Step 6:** Commit `feat(career): GitHub review-footprint + PR-lifecycle import (quarantined)`.

---

### Task 2: Blame-based attribution upgrade (§2.5)

**Files:** Modify `career-attribution.mjs`; Test extend `test/career-attribution.test.mjs`.

**Interfaces:** Add `attributeBugsWithBlame({ bugs, findings, myPrCount, reverts, resolved })` where each `bug` already carries a pre-computed `bug.introducingAuthorEmail` (see the import note below). Rule (2) becomes: bug is mine if the PR/commit that introduced the fixed lines is authored by me. **Review findings remain a separate axis** — reuse the exact Phase-1 `caughtInReview` logic unchanged.

> **PERF — compute `git blame` at IMPORT time, never at snapshot build (fix).** Spec §2.4's warm-refresh target is a hard number; spawning `git blame -L` per fixed line inside `readBugs`/snapshot puts subprocess latency on every refresh. Instead, the GitHub import (Task 1) computes blame **once** when it drops to disk and stores a `{ bugId → introducingAuthorEmail }` map in the dropped file. The snapshot then consumes it as **pure data** — zero subprocess cost on refresh, and consistent with "imports are snapshot inputs" (§11.A). `attributeBugsWithBlame` therefore takes plain data, not a `blameLookup` callback.

- [ ] **Step 1:** Write failing test: a bug with `introducingAuthorEmail` = my email is attributed via rule `blame`; a review finding still does NOT move `changeFailProxy`; a bug with a coworker's introducing email goes to `unattributed`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `attributeBugsWithBlame` reusing the caught-in-review branch verbatim from `attributeBugs`; only the escaped-attribution branch gains the blame rule (pure data, no spawn). Keep `attributeBugs` for the no-GitHub fallback.
- [ ] **Step 4:** Run → PASS. In Task 1's import, add the blame computation (spawn `git blame` once per fixed line during import, memoized per commit) and persist the `bugId→introducingAuthorEmail` map into the dropped file. Snapshot merges that map onto bugs and uses `attributeBugsWithBlame` when a GitHub import is present, else falls back to Phase-1 `attributeBugs`.
- [ ] **Step 5:** Commit `feat(career): blame-based attribution (blame computed at import, pure at refresh)`.

---

### Task 3: Jira import — cycle time, estimate-vs-actual, reopened, originated-vs-assigned

**Files:** Create `career-import-jira.mjs`; Test `test/career-jira.test.mjs` over `test/fixtures/jira/issues.json`.

**Interfaces:** `importJira({ issues, resolved })` → never throws; `{ cycleTimeByPhaseHrs:{[status]:[]}, estimateVsActual:[{key,estimateSp,actualHrs}], reopenedRate, originatedVsAssigned:{ originated, assigned, ratio }, error? }`. `originated` = issues where reporter is me; `assigned` = assignee is me; ratio trends the promotion narrative (spec §11.A).

- [ ] **Step 1:** Failing test: `originatedVsAssigned.originated` counts reporter==me; `reopenedRate` counts status transitions back from a done-category status (from `changelog.histories`); returns `{error}` on garbage.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `parse()` against the Task-0 Jira fixture field paths, wrapped in the quarantine try/catch.
- [ ] **Step 4:** Run → PASS. Server: `POST /api/career/import/jira` (reuse Eng dashboard creds or accept a pasted export), drop to disk, persist `imports.jira`.
- [ ] **Step 5:** Commit `feat(career): Jira cycle-time + originated-vs-assigned import (quarantined)`.

---

### Task 4: Per-project harness score (no persistence)

**Files:** Create `career-harness.mjs`; Test `test/career-harness.test.mjs`.

**Interfaces:** `harnessScore({ project, sessionsForProject, repoProbe })` → `{ score:0..100, fixes:[{id,title,detail}] }`. Inputs (all re-detected, none stored): `repoProbe.hasClaudeMd`, `repoProbe.claudeMdQuality`, session verification rate (sessions ending with a test/typecheck tool run), friction rate vs a passed-in `baselineFrictionRate`, one-shot rate, interruption/correction rate, tool-mix health. `fixes` are the top 2–3 lowest-scoring inputs rendered as advice.

- [ ] **Step 1:** Failing test: a project with no CLAUDE.md and 2× baseline friction scores low and returns a "no CLAUDE.md" fix and a "high friction" fix; a healthy project scores high with no fixes.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement as a pure weighted score over the inputs; `fixes` = inputs below their threshold, sorted by weight. **No `career.json` writes.** `repoProbe` is supplied by the server (re-detects `CLAUDE.md` existence + whether recent sessions ran tests) each refresh.
- [ ] **Step 4:** Run → PASS. Add `snap.projects[].harness = harnessScore(...)` in `buildSnapshot`; renders in the Insights-per-project panel (Phase-1 Task 14) as a score chip + fixes list. **No quest code dependency.**
- [ ] **Step 5:** Commit `feat(career): per-project harness score, re-detected (no persistence)`.

---

### Task 5: `✨ Analyze` endpoint (claude -p, cached by hash)

**Files:** Create `career-analyze.mjs`; Modify `server-career.mjs`; Test `test/career-analyze.test.mjs`.

**Interfaces:** `analysisKey(panelKey, payload)` → stable sha of `{panelKey, payload}`; `runAnalyze({ panelKey, payload, spawn })` → `{ markdown }` (spawns `claude -p` like `server.mjs`'s `runAgent`). Server `POST /api/career/analyze {panelKey, payload}`: return cached `analyses[key]` if present, else run, store `{inputHash,at,markdown}`, return it.

- [ ] **Step 1:** Failing test with an injected fake `spawn` returning canned JSON → asserts `runAnalyze` returns its markdown and `analysisKey` is stable across key-order changes.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `career-analyze.mjs` (hash via `node:crypto`), wire the cached endpoint.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(career): on-demand claude -p analyze with hash cache`.

---

### Task 6: Focus & Growth panel

**Files:** Create `src/career/FocusPanel.jsx`; Modify `src/CareerDashboard.jsx` (add "Focus" tab).

**Interfaces:** Consumes `snap.focus` (already produced Phase-1 Task 6, now with more rules from Task 12). Renders ranked items; each has a `✨ Analyze` button → `POST /api/career/analyze {panelKey:'focus', payload:item}` → shows returned markdown; and the Phase-1 acted-on mark.

- [ ] **Step 1:** Create the panel (list + per-item Analyze that lazy-loads markdown into an expander).
- [ ] **Step 2:** Render for `tab === 'Focus'`.
- [ ] **Step 3:** Verify via preview: items render ranked; clicking Analyze shows a spinner then markdown; error path shows heuristic text still (degradation §6).
- [ ] **Step 4:** Commit `feat(career): Focus & Growth panel with on-demand Analyze`.

---

### Task 7: Competency Matrix + Expectation-gap panel

**Files:** Create `src/career/CompetencyPanel.jsx`; Modify `src/CareerDashboard.jsx`; extend `AUTHORED`/config already covers `competency`.

**Interfaces:** Reads/writes `config.competency` `{ levelSelfAssessed, ratings:{[area]:{level,score1to5,note}}, ladder:[{level,area,expectation,evidenceState,bragLinks[]}] }` via `GET/POST /api/career/config`. Evidence is a **nudge only** — the UI must render ratings and evidence in visually separate zones and never colour a rating cell by evidence (spec §3 panel 8).

- [ ] **Step 1:** Panel: a self-rating grid (editable 1–5 per area) + a "paste your real ladder rows" textarea that parses `level | area | expectation` lines into `ladder[]`, each with a green/yellow/red evidence selector and optional brag links.
- [ ] **Step 2:** Copy rule: a caption states "self-ratings are yours; the evidence tags are nudges, not proof." No cell derives its colour from git/PR evidence.
- [ ] **Step 3:** Render for a new "Competency" tab; save via config POST.
- [ ] **Step 4:** Verify via preview: edit a rating → persists across refresh; paste 3 ladder rows → renders with red/yellow/green tags; "two red rows" summarised at top ("gaps to close").
- [ ] **Step 5:** Commit `feat(career): Competency matrix + pasted-ladder expectation-gap (evidence as nudge only)`.

---

### Task 8: Workflow panel (how I use Claude)

**Files:** Create `src/career/WorkflowPanel.jsx`; Modify `src/CareerDashboard.jsx`.

**Interfaces:** Consumes `snap.workflow` (`topFriction`, `friction`, `tools`) + `snap` session_type/interruption aggregates + `claude_helpfulness` histogram (add to snapshot from facets). Renders friction bars, tool mix, session-type mix, interruption rate, one-shot vs iterative, with a `✨ Analyze` for a narrative "what to change."

- [ ] **Step 1:** Extend `buildSnapshot.workflow` with `helpfulness` and `oneShotRate` (from `session_type` + interruptions). Add a snapshot test asserting the fields exist.
- [ ] **Step 2:** Create the panel (bars + Analyze).
- [ ] **Step 3:** Render for "Workflow" tab; verify via preview.
- [ ] **Step 4:** Commit `feat(career): Workflow panel from /insights facets`.

---

### Task 9: Learning + Tech Radar panel

**Files:** Create `src/career/LearningPanel.jsx`; Modify `src/CareerDashboard.jsx`.

**Interfaces:** Reads/writes `config.learning` `{ now:[goal], next:[goal], techRadar:[{id,tech,ring,note}] }` and `config.courses`. `goal={id,title,measure,target,progress,links[]}`. Tech radar folded here as the "will learn" backlog (rings adopt/trial/assess/hold).

- [ ] **Step 1:** Panel: "Now learning" and "Will learn" goal lists with an editable progress bar; a courses list (title/provider/status/progress); a tech-radar quadrant list.
- [ ] **Step 2:** All edits persist via config POST; a measurable goal requires `measure`+`target` (validate before save).
- [ ] **Step 3:** Render for "Learning" tab; verify via preview (add a goal, bump progress, add a tech to "trial").
- [ ] **Step 4:** Commit `feat(career): Learning + Tech Radar panel`.

---

### Task 10: Time Allocation vs Intended panel

**Files:** Create `src/career/AllocationPanel.jsx`; Modify `src/CareerDashboard.jsx`; add `timeTarget` to `AUTHORED` (already default `null` from Phase-1 T1).

**Interfaces:** `config.timeTarget = { deepWork, reviewsMentorship, designStrategy, opsInterrupts }` (percentages). Snapshot computes **actual** split from session/tool data (deep-work = long uninterrupted coding sessions; reviews = GitHub review activity from Task 1; ops = interrupt-heavy/short sessions). Panel shows target vs actual bars + drift callouts.

- [ ] **Step 1:** Add `snap.allocation = { target, actual, drift }` to `buildSnapshot` (actual derived from sessions + GitHub review footprint when present). Snapshot test: a session set skewed to interrupts yields high `actual.opsInterrupts`.
- [ ] **Step 2:** Panel: set-target form + target-vs-actual bars; a bucket at <½ target for the window renders a drift warning ("zero design work this window").
- [ ] **Step 3:** Render for "Allocation" tab; verify via preview.
- [ ] **Step 4:** Commit `feat(career): Time-allocation vs intended with drift flags`.

---

### Task 11: Decision Log panel

**Files:** Create `src/career/DecisionPanel.jsx`; Modify `src/CareerDashboard.jsx` (`decisions` already in config/AUTHORED).

**Interfaces:** `config.decisions=[{id,date,chose,over,because,revisitWhen,outcome,becameAdr}]`. Panel: add a decision (chose/over/because/revisit-when), list with a quarterly "revisit due" flag (revisitWhen ≤ now and no `outcome`), and a "graduate to ADR" toggle that sets `becameAdr` (feeds Phase-3 Influence).

- [ ] **Step 1:** Panel with add-form + list + revisit-due badge.
- [ ] **Step 2:** Persist via config POST; verify via preview (add a decision with a past revisit date → flagged).
- [ ] **Step 3:** Commit `feat(career): Decision Log with revisit prompts`.

---

### Task 12: Extend heuristics — allocation drift, originated-vs-assigned, competency gap

**Files:** Modify `career-heuristics.mjs`; extend `test/career-heuristics.test.mjs`.

**Interfaces:** Add rules to `focusItems`: allocation bucket <½ target → med "drift"; `originatedVsAssigned.ratio` falling → med "drive more of your own work"; a ladder row `evidenceState==='red'` → high "gap to close: <area>" linking to Learning; competency area with real evidence but low self-rating → low "under-credited".

- [ ] **Step 1:** Failing tests for each new rule (table-driven).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the rules; keep item ids stable (`area:slug`) so acted-on marks persist.
- [ ] **Step 4:** Run → PASS; full `npm test` green.
- [ ] **Step 5:** Commit `feat(career): phase-2 heuristics (allocation, originated-vs-assigned, ladder gaps)`.

---

## Self-Review

**Spec coverage (Phase 2 / §11.C):** GitHub review-footprint + PR lifecycle (T1), blame attribution upgrade §2.5 (T2), Jira cycle-time + originated-vs-assigned (T3), harness score no-persistence §11.B/D (T4), Analyze §3 (T5,T6), Competency+Expectation-gap evidence-as-nudge (T7), Workflow (T8), Learning+Tech Radar (T9), Time-Allocation drift (T10), Decision Log (T11), extended heuristics §3.1 (T12). Fixtures-first (T0) removes the parser unknown.

**Quarantine + identity + escaped-split** carried as Global Constraints and re-asserted in T1/T2/T3.

**Depth note:** import-parser transform code is written against Task-0 fixtures rather than guessed — intentional, not a placeholder; every parser still ships with a failing-first test and a `{error}` degradation path.
