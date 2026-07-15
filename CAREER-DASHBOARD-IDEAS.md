# Career Dashboard — Feature Research & Gap Analysis (late 2026)

Goal: oversee your *complete* work in one place. This is reconciled against what the
dashboard **already ships**, so it only lists real gaps.

## The 2026 through-line
AI agents compressed the IC ceiling — shipping features solo is table stakes. The bar
moved to **outcomes, cross-team scope, written artifacts, and influence**. Every
speed/quantitative metric must be paired with a quality/qualitative one, or it just
measures AI throughput. Frameworks: DORA + SPACE + DX Core 4 + an AI-native layer
(adoption, AI code share, complexity-adjusted velocity, quality, ROI).

---

## Already built (do NOT rebuild)
Brag doc • Competency ladder • OKRs/KRs • Estimation accuracy • Reviews (reciprocity,
bus-factor, turnaround) • Allocation vs target • Decisions/ADRs • Lessons • Retros •
1:1 prep • Feedback nudges • Bug attribution / escaped-vs-caught / change-fail proxy •
Gamification (XP/streaks/badges/quests) • Focus heuristics • Memory recall •
promo-packet / story-so-far generators • Claude-session flow analytics.

---

## Validated build order (post-code-review)
A validation agent pressure-tested every gap against the actual code. Verdicts:
- **★ Metric time-series / trend history — BUILD FIRST (missed gap).** Everything is
  computed fresh per request; only `rollup.activityDays` + `quarterlyBugRatio` persist.
  A "career growth" dashboard literally can't draw a growth curve. Also the prerequisite
  that makes G8's `bestFlowWeek`/`mostKrsQuarter` real instead of perpetually `null`.
- **G2 business linkage — BUILD.** Cheapest high value; today `impact` is free-text on
  brag entries only, no structured KPI. Pure manual attach + rollup.
- **G8 stubs — BUILD** (fold into ★). Confirmed literal stubs.
- **G1 AI attribution — BUILD, scoped.** Ship the AI-code-share **ratio**; skip fragile
  session→PR joins (no join key exists between sessions and PRs).
- **G4 domain map — DEFER.** `career-blame.mjs` exists but only feeds bug attribution;
  ownership-by-area map is real import-time work.
- **G6 written artifacts — DEFER** (pull forward only when writing a Staff packet).
- **G3 cross-team — DEFER / redundant.** `InfluencePanel.jsx` already computes cross-team
  fixes + mentorship reviews; a full classifier is marginal.
- **G5 meetings / G10 digest — DEFER.** New connector / roadmap-gated.
- **G9 consolidate — SKIP (my error).** The two systems serve *different dashboards*
  (career server-XP vs eng localStorage/cosmetic) — cosmetic overlap, not a defect.
- **G7 comms — SKIP.** Noisy, low signal.

**Do first: ★ time-series (+G8) → G2 → G1 (ratio-scoped).**

## The real gaps (net-new)

### Tier 1 — high value, data mostly already present
- **G1. AI-work attribution layer.** You already parse Claude transcripts + usage-data
  (tokens, sessions). Missing: linking AI sessions → the PRs/commits they produced, and
  an **AI-code-share %** + **AI ROI** view. The single most 2026-relevant metric, and
  you already have the raw data. `M`.
- **G2. Business-impact linkage.** Attach a business KPI (revenue, conversion, latency,
  cost saved) to each shipped ticket/feature. Turns activity into the impact story a
  promo committee reads. Manual attach + rollup on existing ticket data. `S–M`.
- **G3. Scope / cross-team classifier.** You have originated-vs-assigned; add
  single-team vs cross-team classification from JIRA project/component + PR repo +
  reviewer teams. The Staff signal. `M`.
- **G4. Domain / expertise map (your bus-factor).** Bus-factor today is review-only.
  Add file/system ownership from git blame → where *you* are the expert vs thin.
  Surfaces knowledge concentration + gaps. `M`.

### Tier 2 — genuinely missing data sources (SPACE "Communication")
Your available MCP connectors map exactly onto the missing dimensions:
- **G5. Meeting analytics** (Google Calendar MCP): hours in meetings, decision vs
  status, meetings you drove. SPACE Communication is currently unmeasured. `M`.
- **G6. Written-artifact authorship** (Confluence/Notion MCP): design docs / RFCs
  authored — the currency that actually drives Staff promotions. Decisions panel tracks
  ADRs but not doc authorship. `M`.
- **G7. Comms signals** (Gmail/Slack): volume & responsiveness. Lower priority, noisier. `L`.

### Tier 3 — finish what's already started (cheap wins)
- **G8.** Populate the stubs: bug `findings`/`reverts`, review `commentsLeftEstimate`
  (real comment counts), personal bests `bestFlowWeek`/`mostKrsQuarter`. `S`.
- **G9.** Consolidate the **two parallel gamification systems** (career `GamePanel` vs
  eng `Gamification.jsx`) — redundant XP formulas/badges. Cleanup, not a feature. `S`.
- **G10. Weekly AI digest** (OS-ROADMAP Phase 2 scheduler): a scheduled `claude -p`
  narrative "here's your week + did it move a goal." Gated on the roadmap's own criteria. `M`.

---

## Recommended first three
**G1 AI attribution** (most 2026-relevant, data already there) • **G2 business linkage**
(biggest promo-story gap) • **G8 finish the stubs** (cheap, removes placeholders).

## Sources
SPACE/DORA/DX Core 4: getdx.com/blog/space-metrics · hivel.ai/blog/dora-vs-space-metrics ·
zylos.ai/research/2026-02-07-developer-productivity-metrics — AI-native metrics:
larridin.com developer-productivity-benchmarks-2026 · oobeya.io engineering-metrics-in-the-ai-era ·
faros.ai measuring-engineering-productivity-2026 — Competency: handbook.gitlab.com careers/matrix ·
sprad.io IC1–IC6 — Brag docs: jvns.ca/blog/brag-documents · bragbook.io — Promotion/scope:
developereq.com engineers-guide-to-getting-promoted-2026 · kanenarraway.com getting-to-senior-staff-engineer ·
seangoedecke.com staff-engineer-promotions
