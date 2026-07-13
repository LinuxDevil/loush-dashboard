# Gamification Layer — mapped onto career features

Extends the **existing** engine (`career-gamify.mjs`), does not add a new one.

## The one rule that governs all of this
XP is **outcomes-only** (`OUTCOME = {kr, okr, goal, course, competency-level, quest}`).
Logging activity grants 0 XP — this is the Goodhart guard. So:
- **Activity → badges + personal-bests, never raw XP.**
- **New XP only via quests** (already an outcome type; `questDone` = 15 XP default).
- **Every speed/volume badge is gated on a paired quality signal** (a badge for AI-code
  share requires zero escaped bugs; a meeting badge requires shipping stayed healthy).

Implementation = extend three functions (`evaluateAchievements`, `badgeProgress`,
`personalBests`) + a quest template list + badge metadata in `GamePanel.jsx`. No new
subsystem. G9 below folds the redundant second system in.

---

## New features (G1–G10) → mechanics

| Feature | Badge(s) — gated on quality | Quest (→XP) | Personal best |
|---|---|---|---|
| **G1 AI attribution** | `ai-pair-master` — ≥10 AI-assisted PRs with escaped-ratio 0 (countable). `human-in-loop` — high AI share **and** high one-shot/low-friction | "Review-gate every AI PR this week" | Best AI ROI week; longest clean AI-PR streak |
| **G2 business linkage** | `impact-trader` — ≥5 shipped items linked to a KPI (countable). `needle-mover` — a linked KPI actually moved (all-or-nothing, evidence field) | "Link this quarter's top 3 features to a metric" | Most KPI-linked ships in a quarter |
| **G3 scope classifier** | `boundary-crosser` — ≥3 cross-team contributions (countable). `force-multiplier` — cross-team work **+** reviews-for-others (staff signal) | "Ship one cross-team change" | Most cross-team ships in a quarter |
| **G4 domain/expertise map** | `keystone` — sole expert (bus-factor 1) of ≥1 system. `knowledge-spreader` — reduced your own bus-factor by handing off/documenting (the *healthy* inverse) | "Document a system only you know" | Systems where you're primary owner |
| **G5 meetings** | `decision-driver` — drove ≥N decision meetings. `focus-guardian` — meeting load under target **while shipping stayed on** (paired guard) | "Cut one recurring status meeting" | Lowest meeting-load week with delivery intact |
| **G6 written artifacts** | extend existing `first-design-doc` → `prolific-author` — ≥3 RFCs/design docs authored (countable) | "Publish an RFC" | Most docs authored in a quarter |
| **G7 comms** | — skip. Noisy, low signal (YAGNI) | — | — |
| **G8 finish stubs** | not gamified itself, but **unlocks** existing badges: `findings`/`reverts` feed `zero-regression-sprint`; comment counts feed a real `reciprocator` | — | Populates `bestFlowWeek`, `mostKrsQuarter` (currently always null) |
| **G9 consolidate two game systems** | **SKIP** — validation confirmed the two serve *different dashboards* (career server-XP vs eng localStorage/cosmetic), not a shared defect. Optional: cherry-pick the eng juice (confetti/pet/recap) into `GamePanel` if you want polish — but don't "merge" them | — | — |
| **G10 weekly digest** | `streak-freeze` reward (miss a day without breaking a streak) as a redeemable for kept streaks | Auto-generates next week's quest from the digest | — |

---

## Existing panels → mechanics (confirm / add)

| Panel | Already has | Add |
|---|---|---|
| Quality | `zero-regression-sprint` | `bug-slayer` — fixed ≥N bugs you didn't introduce (needs G8 findings) |
| Reviews | `mentor-5` | `reciprocator` — healthy give/receive ratio (needs real comment counts, G8) |
| OKR | `okr-closer` | `grand-slam` — closed all KRs in a quarter → drives `mostKrsQuarter` PB |
| Competency | `ic-level-reached` | `well-rounded` — min proficiency across **all** ladder dimensions (anti-lopsided) |
| Estimation | — | `calibrated` — estimation accuracy within ±X% over N tickets |
| Delivery | — | `flow-state` — best sustained-flow week → drives `bestFlowWeek` PB |
| Lessons | — | `sage` — graduated ≥N lessons to practice |
| Retro | `bragLog` streak exists | `reflective` — retro streak (add `retroDays` to rollup) |
| Allocation | — | `on-target` — allocation within target N consecutive weeks |
| Learning | `course-graduate`, `quest-streak` | keep |

---

## The backbone the badges need: metric time-series (★)
Validation surfaced a missed gap that gamification quietly depends on: **nothing but
`activityDays` + `quarterlyBugRatio` persists across time.** Personal-bests
(`bestFlowWeek`, `mostKrsQuarter`) and any "improved over last quarter" badge
(`calibrated`, `grand-slam`, trend streaks) are impossible without a persisted
quarterly rollup. So **build the time-series first** — it's the substrate that turns
half these badges from `null` into real. `S–M`.

## Sequencing (lazy path)
1. **★ time-series + G8 first** — persist a quarterly rollup; that alone populates
   `bestFlowWeek`/`mostKrsQuarter` and unlocks/derisks half the badges below for free.
2. Add the **existing-panel badges** (pure `evaluateAchievements` rules on data you
   already have) — cheap, high coverage.
3. Gamify **G1/G2** as those features land (data-ready + highest career value).
4. **G9 consolidation** whenever you touch the panel — kills the redundant second system.
5. G3–G6 badges ship *with* their feature. G7 skipped.

Guardrail restated: no badge or XP rewards raw volume alone — always paired with a
quality/outcome gate. That's what keeps this honest instead of a click-farm.
