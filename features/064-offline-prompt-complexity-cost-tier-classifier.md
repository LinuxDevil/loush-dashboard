# Offline prompt-complexity / cost-tier classifier

**Category:** Context Explorer & Prompt/Model Insight

- **Source**: manifest (RESEARCH_MERGED.md, Feature inventory `scoring/config.ts`, `sigmoid.ts`; Recommended adoptions)
- **What**: A 32-dimension request scorer (22 keyword + 10 structural dimensions) feeding a sigmoid+confidence function that classifies a turn into a tier (`simple|standard|complex|reasoning`), with a "momentum" mechanism carrying the prior turn's tier forward.
- **Where to add**: new `lib/complexity.mjs`, consumed when building `/api/usage`/`/api/insights` in `server/index.mjs`; rendered in `InsightsSection.jsx` and a prompt-quality section
- **Caveats**: MIT — safe to copy directly. Research calls this "the highest-value idea in the whole survey" — enables claims like "you paid Opus rates for 340 simple-tier turns last month."

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
