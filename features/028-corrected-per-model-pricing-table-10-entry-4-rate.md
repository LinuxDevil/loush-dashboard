# Corrected per-model pricing table (10-entry, 4-rate)

**Category:** Cost, Pricing & Usage Accounting

- **Source**: Claude Code Dashboard / "CSI" (RESEARCH_MERGED.md, Feature inventory `cost-engine/src/pricing.ts`; Recommended adoptions)
- **What**: A 10-entry per-model pricing table (4 rates each) with regex matching and fallback, used to replace a flat/incorrect pricing constant.
- **Where to add**: new `lib/pricing.mjs`, replacing existing flat-rate constants; consumed by `UsagePanel`, `Overview`
- **Caveats**: MIT. Research notes Loush's current numbers reportedly overstate certain models by ~3x.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `029-real-per-model-pricing-table-with-an-unpriced-state.md` — Real per-model pricing table with an "unpriced" state

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
