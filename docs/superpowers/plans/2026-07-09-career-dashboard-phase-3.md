# Career Dashboard — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

> **GATE — Phase 3 is PROVISIONAL.** Per spec §3 and §11.C, build a panel here **only if** the Phase-1 gate passed **and** a concrete need for that specific panel has appeared. Do not pre-build the whole phase. The spec explicitly bets half of it is never needed. Each task below is independently skippable.

> **Depth calibration (honest):** these are task-level plans — exact files, interfaces, ordered steps, test assertions — with full code where determinable. Confluence/Slack import parsers are **pinned to fixtures captured in Task 0**, same discipline as Phase 2. The Lessons pipeline is specified precisely (its structured `check` and graduation logic are fully defined) but sits on top of everything above, so it is sequenced last.

**Goal:** Motivation & social layer + the learning loop's deep components: Confluence + Slack imports (constrained), per-ticket retros, the Lessons pipeline, Gamification (outcomes-only), OKRs, Influence & Ownership, and Feedback (active request + capture).

**Architecture:** New pure modules `career-import-confluence.mjs`, `career-import-slack.mjs`, `career-retro.mjs`, `career-lessons.mjs`, `career-gamify.mjs`; new panels in `src/career/`. Extends `career.json` (`lessons`, `ticketLinks`, `xpLedger`, `quests`, `badges`, `okrs`, `ownership`, `feedback`, `feedbackRequests`).

**Tech Stack:** Same as Phases 1–2.

## Global Constraints

- Inherits **all Phase-1 + Phase-2 Global Constraints**.
- **Slack is hard-constrained (spec §11.A):** Slack data may feed **only** the brag log, the interrupt/wellbeing view, and expertise signals — **never a volume metric**. Prefer saved messages + reactions-received on substantive answers over raw counts. A test must assert no Slack-derived count reaches a displayed metric other than these three.
- **Gamification rewards outcomes only (spec §3.2, Goodhart guard):** XP for completed KR/OKR/goal/course/competency-level/quest **only**. **No XP for logging** a brag/decision/retro/lesson entry. A test must assert a "logged entry" event grants 0 XP.
- **Lessons: a structured `check` is required for auto-graduation (spec §11.B).** `check:{metricRef,comparator,target,window}` auto-graduates; a free-text `check` is **manual-graduate only**. **Cap ~5 active lessons.**
- **Ticket-retro linkage: show without session data rather than guess (spec §11.B).** A wrong join is worse than a missing one.
- **Psychological framing (spec §11.B):** findings are deltas vs the author's own baseline; graduated lessons celebrated as loudly as new ones raised; repeat-friction-trending-down is the headline. Panels must not open on a wall of failures.
- All awards/imports **idempotent** (keyed by event id).

---

### Task 0: Capture Confluence + Slack export fixtures

**Files:** `test/fixtures/confluence/pages.json`, `test/fixtures/slack/export.json` (redact real content; keep structure).

- [ ] **Step 1:** Export/capture Confluence page metadata you authored/edited (title, author, lastUpdated, viewCount if available, links). Save to fixture.
- [ ] **Step 2:** Capture a Slack export slice covering: your saved messages, reactions received on your messages, and help-channel threads you replied in. Redact bodies to a token but keep fields. Save to fixture.
- [ ] **Step 3:** Commit fixtures. These are the parser contracts.

---

### Task 1: Confluence import (influence evidence)

**Files:** Create `career-import-confluence.mjs`; Test `test/career-confluence.test.mjs`.

**Interfaces:** `importConfluence({ pages, resolved })` → never throws; `{ authored:[{title,url,views,links}], edited:[...], threadsResolved, bragCandidates:[{title,evidence}], error? }`. View/link counts distinguish diary from influence (spec §11.A); high-view docs auto-seed brag candidates.

- [ ] **Step 1:** Failing test over the fixture: authored counts pages where author==me; a page with high views produces a brag candidate; garbage → `{error}`.
- [ ] **Step 2–4:** Implement quarantined `parse()`; server `POST /api/career/import/confluence` drops to disk + persists `imports.confluence`; brag candidates flow into the Phase-1 Brag panel candidate list.
- [ ] **Step 5:** Commit `feat(career): Confluence influence import (quarantined)`.

---

### Task 2: Slack import (constrained expertise + wellbeing)

**Files:** Create `career-import-slack.mjs`; Test `test/career-slack.test.mjs`.

**Interfaces:** `importSlack({ export, resolved })` → never throws; `{ expertise:{ questionsAnswered, unblockedThreads, taggedForDomain, savedAnswers, reactionsReceived }, wellbeing:{ afterHoursMessages, interruptBurstDays }, bragCandidates:[], error? }`. **No raw volume metric is exported** — only the three allowed sinks.

- [ ] **Step 1:** Failing test: asserts the returned object exposes ONLY expertise/wellbeing/bragCandidates and that a raw "messageCount" field is absent; a substantive answer with reactions becomes a brag candidate.
- [ ] **Step 2–4:** Implement quarantined parser honoring the hard constraint; server import drops to disk + persists `imports.slack`.
- [ ] **Step 5:** Commit `feat(career): Slack expertise+wellbeing import (volume-metric-free, quarantined)`.

---

### Task 3: Per-ticket retro

**Files:** Create `career-retro.mjs`; Test `test/career-retro.test.mjs`; panel `src/career/TicketRetroPanel.jsx`.

**Interfaces:** `ticketRetro({ ticket, prs, bugs, sessions, ticketLinks })` → `{ cycleByPhase, estimateVsActual, reopened, escapedBugs, sessionsShown:boolean }`. **Linkage rule:** ticket IDs from branch names/commits; sessions matched by ticket ID in first prompt or working branch. **If linkage confidence is low, `sessionsShown=false` and the retro renders without session data** (never a guessed join).

- [ ] **Step 1:** Failing test: a ticket with a confident session link shows sessions; a ticket with no reliable link renders with `sessionsShown===false` and omits session data (not fabricated).
- [ ] **Step 2–4:** Implement; persist resolved links in `ticketLinks` with a `confidence`. Panel lists closed tickets → click → composed retro.
- [ ] **Step 5:** Commit `feat(career): per-ticket retro with honest linkage`.

---

### Task 4: Lessons pipeline — harvest → distill → apply/verify

**Files:** Create `career-lessons.mjs`; Test `test/career-lessons.test.mjs`; panel `src/career/LessonsPanel.jsx`.

**Interfaces:**
- `harvestCandidates({ prFindings, escapedBugs, ticketAcGaps, sessionFriction, retros })` → `[{ theme, evidenceRefs[] }]` (recurring themes only, not one-offs).
- `distill({ candidates, runAnalyze })` → draft `lessons[]` in shape `{situation,pattern,rule,check}` via a **weekly** Analyze pass; `check` structured `{metricRef,comparator,target,window}` when derivable, else `{freeText}`.
- `evaluateLesson(lesson, snapshot)` → `'recurring'|'cleared'|'pending'`; a **structured** check that meets target over its window → auto-graduate to `internalized`; a **free-text** check never auto-graduates; a cleared→recurring flip flags a 1:1.
- Enforce **cap ~5 active**; nothing enters the list without explicit approve/edit/discard.

- [ ] **Step 1:** Failing tests: (a) a structured check meeting target auto-graduates; (b) a free-text check does NOT auto-graduate; (c) the active cap rejects a 6th active lesson; (d) harvest ignores one-off findings.
- [ ] **Step 2–4:** Implement; server routes: `POST /api/career/lessons/harvest` (weekly), `POST /api/career/lessons/:id/approve|discard`, and lesson evaluation folded into `build()`. Active lessons resurface in Me/Now (matching project) and Tasks (matching ticket).
- [ ] **Step 5:** Commit `feat(career): lessons pipeline (structured check, auto-graduation, ≤5 active)`.

---

### Task 5: Gamification (outcomes-only XP)

**Files:** Create `career-gamify.mjs`; Test `test/career-gamify.test.mjs`; panel `src/career/GamePanel.jsx`.

**Interfaces:**
- `awardXp(config, events)` → `{ xpLedger, level }` where `events` are **outcome** events only (KR/OKR/goal/course/competency-level/quest completed). `level = ceil(sqrt(totalXp/100))`. Idempotent by event id.
- `computeStreaks(rollup, todayIso)` → coding/learning/brag-log streaks from persisted `rollup.activityDays` (survives window rotation).
- `evaluateAchievements(snapshot, config)` → earned badge ids (First Design Doc, Mentor≥N, OKR Closer, Zero-Regression Sprint [escaped-only], Deep-Work Champion, IC-Level Reached, Polyglot, Course Graduate, Quest Streak).
- `personalBests(rollup)` → best flow week, lowest bug ratio (escaped-only), longest streak, most KRs/quarter.

- [ ] **Step 1:** Failing tests: (a) a "brag entry logged" event grants 0 XP; (b) a "KR closed" event grants XP once and is idempotent on replay; (c) Zero-Regression badge uses escaped-only bug ratio; (d) streak survives a snapshot window that no longer contains older activity days.
- [ ] **Step 2–4:** Implement; skill-tree is a visualization over the Competency panel (Phase-2 T7) — no new persistence. Quests consume Focus items (Phase-1/2) — quest code depends on Focus output, never the reverse.
- [ ] **Step 5:** Commit `feat(career): gamification — outcomes-only XP, escaped-only badges, rotation-proof streaks`.

---

### Task 6: OKRs & Objectives

**Files:** panel `src/career/OkrPanel.jsx`; Modify `server-career.mjs`.

**Interfaces:** `config.okrs=[{id,objective,quarter,krs:[{id,text,metricRef,target,current}]]`. Each KR's `metricRef` auto-tracks against snapshot panels 3/4/10 (flow/quality/allocation). Closing a KR emits an outcome XP event (Task 5). Renders progress rings per KR from live `current` vs `target`.

- [ ] **Step 1:** Panel with add-OKR/add-KR, `metricRef` picker (enumerated snapshot metrics), live progress.
- [ ] **Step 2:** KR close → XP event; verify via preview (a KR wired to `quality.changeFailProxy` shows live current).
- [ ] **Step 3:** Commit `feat(career): OKRs with metric-linked KRs feeding XP`.

---

### Task 7: Influence & Ownership

**Files:** panel `src/career/InfluencePanel.jsx`.

**Interfaces:** Composes: ADRs/design docs (from Decision Log `becameAdr` [Phase-2 T11] + Confluence authored [T1]), mentorship (GitHub reviews-for-others [Phase-2 T1] + Slack unblocked-threads [T2]), talks/writing/OSS (manual `config.ownership`/entries), systems owned (`config.ownership`). Read-mostly, auto-seeded from existing imports.

- [ ] **Step 1:** Panel aggregating the above into influence categories with evidence links; manual add for talks/OSS/owned-systems.
- [ ] **Step 2:** Verify via preview (a graduated decision + a high-view Confluence doc + reviews-for-others appear as influence evidence).
- [ ] **Step 3:** Commit `feat(career): Influence & Ownership (auto-seeded from imports)`.

---

### Task 8: Feedback (active request + capture)

**Files:** panel `src/career/FeedbackPanel.jsx`; Modify `server-career.mjs`.

**Interfaces:** `config.feedback=[{id,date,source,text,tag,linkedArea]]` (capture) + `config.feedbackRequests=[{id,askedOf,topic,trigger,status,requestedAt,receivedAt}]` (active nudge). After a project ships / design review lands (detected from taskboard/GitHub), the snapshot suggests "ask [reviewer/PM/peer] for feedback on X"; the panel tracks whether you did. Solicited feedback becomes growth-area evidence (spec §11-review notes).

- [ ] **Step 1:** Add `snap.feedbackNudges` in `buildSnapshot` (from recently-released tickets + merged PRs with reviewers). Snapshot test: a released ticket produces a nudge.
- [ ] **Step 2:** Panel: nudge list with "mark asked / received"; capture list tagged strength/growth linkable to a competency area.
- [ ] **Step 3:** Verify via preview; commit `feat(career): Feedback requests (active nudge) + tagged capture`.

---

## Self-Review

**Spec coverage (Phase 3 / §11):** Confluence influence (T1), Slack constrained (T2), per-ticket retro honest-linkage (T3), Lessons pipeline structured-check + ≤5 active (T4), Gamification outcomes-only + rotation-proof streaks + escaped-only badges (T5), OKRs metric-linked (T6), Influence & Ownership auto-seeded (T7), Feedback active-request (T8). Provisional-gate stated at top; each task independently skippable.

**Hard constraints re-asserted as tests:** Slack volume-metric absence (T2 step1), XP-for-logging = 0 (T5 step1a), structured-vs-free-text graduation (T4 step1a/b), honest linkage (T3 step1), escaped-only badges (T5 step1c).

**Depth note:** import parsers are fixture-pinned (T0) with failing-first tests and `{error}` degradation; the Lessons `check` structure and graduation rules are fully specified, not deferred.
