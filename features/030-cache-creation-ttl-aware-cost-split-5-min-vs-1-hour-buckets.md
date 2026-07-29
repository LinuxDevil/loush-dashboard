# Cache-creation TTL-aware cost split (5-min vs 1-hour buckets)

**Category:** Cost, Pricing & Usage Accounting

- **Source**: Claude Code Usage Dashboard / phuryn (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Reads `message.usage.cache_creation.ephemeral_5m_input_tokens` and `.ephemeral_1h_input_tokens` separately and prices the 1-hour bucket at 2× the 5-minute rate, since upstream currently underprices this by ~49% on cache-write cost.
- **Where to add**: `server/pricing.mjs` (same module as above), verified first against whether this field is actually present in our transcript corpus.
- **Caveats**: MIT; verify the field exists before shipping — fall back to flat rate and label it if absent.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `029-real-per-model-pricing-table-with-an-unpriced-state.md` — Real per-model pricing table with an "unpriced" state (same server/pricing.mjs module)

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
