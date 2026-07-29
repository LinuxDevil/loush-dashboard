# Delegation-savings metric (haiku vs sonnet re-pricing), labeled as modeled

**Category:** Cost, Pricing & Usage Accounting

- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Re-prices haiku-model sessions at sonnet rates to compute `savedUSD = max(0, sonnetEquivalent − actualHaiku)`, plus a haiku-utilization percentage across sessions.
- **Where to add**: `src/sections/InsightsSection.jsx`
- **Caveats**: No LICENSE file on CAST. Explicitly a counterfactual — label as "modeled" with assumptions stated inline.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
