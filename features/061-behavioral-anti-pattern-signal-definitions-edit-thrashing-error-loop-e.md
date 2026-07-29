# Behavioral anti-pattern signal definitions (edit-thrashing, error-loop, etc.)

**Category:** Sessions, Transcripts & Forensics

- **Source**: Claude Code ecosystem landscape scan — `millionco/claude-doctor` (RESEARCH_MERGED.md, Top 15 missed projects)
- **What**: Named, concretely thresholded transcript-derived signals: `edit-thrashing` (same file edited 5+ times in one session), `error-loop` (3+ consecutive tool failures without changing approach), `excessive-exploration` (read-to-edit ratio >10:1), `restart-cluster`, `high-abandonment-rate`, `correction-heavy` (20%+ of user messages start with "no"/"wrong"/"wait"), `repeated-instructions` (Jaccard >60% within 5 turns), plus AFINN-165 sentiment scoring.
- **Where to add**: `ForensicsSection.jsx`, `InsightsSection.jsx`, `QualitySection.jsx`, `PromptQuality.jsx`.
- **Caveats**: No license declared — design/definition study only, do not copy code. Validate against Loush's existing WorkingSet "rework rank" metric.

---

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
