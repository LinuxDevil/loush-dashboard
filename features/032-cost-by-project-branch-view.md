# Cost by Project & Branch view

**Category:** Cost, Pricing & Usage Accounting

- **Source**: Claude Code Usage Dashboard / phuryn (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A dedicated table/view breaking down cost and token spend by project and git branch together.
- **Where to add**: `src/sections/ProjectsSection.jsx` or `UsagePanel.jsx`, fed from `rec.branches` already computed in `server/index.mjs` but not currently surfaced.
- **Caveats**: MIT; purely a rendering gap, data already collected.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
