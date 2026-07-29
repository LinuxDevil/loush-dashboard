# Cross-provider error taxonomy

**Category:** Context Explorer & Prompt/Model Insight

> **Status: implemented.** `lib/error-taxonomy.mjs` + tests. 12 categories with a `retryable`
> flag; classification order is `error.type` -> HTTP status -> `stop_reason` -> message text ->
> `is_error` envelope -> unknown at confidence 0. `unknown` is `retryable: null`, not `false`,
> so it never reads as "a real bug".
>
> Evidence discipline matters here: only tool-level errors could be confirmed against real
> transcripts on this machine (there were zero provider API errors to check against). Every
> provider-prose pattern is tagged `speculative` in the source and exposed via
> `patternEvidence()` so the tags cannot quietly rot into uniform "confirmed".

- **Source**: manifest (RESEARCH_MERGED.md, Feature inventory `error-taxonomy.ts`; Recommended adoptions)
- **What**: A normalized classification of provider-side errors (rate limits vs real failures vs auth errors), enabling "37% of your failed turns were rate limits, not bugs."
- **Where to add**: `src/sections/ReliabilitySection.jsx`, `BugsSection.jsx`, fed by error entries already present in parsed JSONL
- **Caveats**: MIT, safe to copy directly.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
