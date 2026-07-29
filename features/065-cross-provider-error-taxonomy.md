# Cross-provider error taxonomy

**Category:** Context Explorer & Prompt/Model Insight

- **Source**: manifest (RESEARCH_MERGED.md, Feature inventory `error-taxonomy.ts`; Recommended adoptions)
- **What**: A normalized classification of provider-side errors (rate limits vs real failures vs auth errors), enabling "37% of your failed turns were rate limits, not bugs."
- **Where to add**: `src/sections/ReliabilitySection.jsx`, `BugsSection.jsx`, fed by error entries already present in parsed JSONL
- **Caveats**: MIT, safe to copy directly.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
