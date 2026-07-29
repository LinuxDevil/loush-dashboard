# Cost estimation module with per-model/cache-tier rates

**Category:** Cost, Pricing & Usage Accounting

- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Notable code worth stealing; Recommended adoptions)
- **What**: A ~50-line module providing a per-model `{input, output, cacheWrite, cacheRead}` USD/M-token pricing table with family-prefix fallback.
- **Where to add**: new `server/cost.mjs`; consumed by `src/sections/UsagePanel.jsx`, `Overview.jsx`, `InsightsSection.jsx`
- **Caveats**: No LICENSE file on CAST (permission to copy already obtained per research — record it).

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `028-corrected-per-model-pricing-table-10-entry-4-rate.md` — Corrected per-model pricing table (10-entry, 4-rate)
- `029-real-per-model-pricing-table-with-an-unpriced-state.md` — Real per-model pricing table with an "unpriced" state

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
