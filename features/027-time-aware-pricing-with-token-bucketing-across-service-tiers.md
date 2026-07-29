# Time-aware pricing with token bucketing across service tiers

**Category:** Cost, Pricing & Usage Accounting

- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `token-usage.js`, `DEFAULT_PRICING`; Recommended adoptions)
- **What**: Buckets token usage by `(model, speed, inference_geo, service_tier)` and applies a wildcard-pattern default pricing table with `asOf`-aware rate lookup supporting time-limited intro pricing, so historical cost calculations stay correct across price changes.
- **Where to add**: `src/sections/UsagePanel.jsx`, wherever cost is computed in `server/`
- **Caveats**: MIT. An unpriced model should surface as unpriced, not silently render as $0.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `028-corrected-per-model-pricing-table-10-entry-4-rate.md` — Corrected per-model pricing table (10-entry, 4-rate)
- `029-real-per-model-pricing-table-with-an-unpriced-state.md` — Real per-model pricing table with an "unpriced" state

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
