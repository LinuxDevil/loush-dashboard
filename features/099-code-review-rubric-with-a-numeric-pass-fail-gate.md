# Code-review rubric with a numeric pass/fail gate

**Category:** Tickets, Planning & Delivery

- **Source**: B. Claude Code Builder (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: An 8-point checklist plus a 5-rule static-analysis table, with a numeric gate (score ≥80 & 0 security issues → approved; ≥60 & ≤2 → needs revision; else rejected).
- **Where to add**: `QualitySection.jsx`'s `Reviews()` component, as a computed score over Loush's existing parsed findings; rubric data in `src/data/rubrics/code-review.js`, following the precedent of `DIMENSIONS` in `server/promptcheck.mjs`.
- **Caveats**: MIT. Port only the rubric data structure, not their SDK-driving code (flagged as dead/broken in this repo).

---

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
