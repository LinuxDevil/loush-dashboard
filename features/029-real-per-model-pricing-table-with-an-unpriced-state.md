# Real per-model pricing table with an "unpriced" state

**Category:** Cost, Pricing & Usage Accounting

- **Source**: Claude Code Usage Dashboard / phuryn (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: An explicit `{input, output}` USD-per-1M-token table per model plus an `isBillable()` gate so unrecognized/local models render as "n/a" instead of silently defaulting to another model's price. Cross-checked in the research: Loush's current Opus pricing is 3× overstated, Fable 1.5×.
- **Where to add**: new `server/pricing.mjs` exporting `PRICING`, `getPricing(model)`, `isBillable(model)`, `calcCost(...)`; replace `server/index.mjs`'s `PRICE_PER_M` and `entryCost`.
- **Caveats**: MIT. Flagged as a correctness bug fix — do first, ahead of any new feature in this document.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `030-cache-creation-ttl-aware-cost-split-5-min-vs-1-hour-buckets.md` — extends the same server/pricing.mjs module

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
