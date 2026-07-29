# Offline prompt-complexity / cost-tier classifier

**Category:** Context Explorer & Prompt/Model Insight

> **Status: implemented, but NOT calibrated.** `lib/complexity.mjs` + tests (38). 32
> inspectable dimensions (22 keyword + 10 structural), sigmoid + confidence, and the momentum
> carry-forward. `scoreTurn()` returns a per-dimension breakdown whose contributions sum
> exactly to the raw score, so the classification is evidence rather than a bare number. Empty
> or unscoreable input returns `tier: null`, and `tierDistribution()` counts unknown separately
> so it cannot inflate `simple`.
>
> **The thresholds are untuned heuristics and currently misclassify.** Spot-checked after
> integration: "what is the capital of France?" comes back `standard`, and confidence sits at
> 0.29-0.49 across every input tried. Before any user-facing claim is built on this — and the
> headline use is "you paid Opus rates for N simple-tier turns last month" — the boundaries
> need fitting against real transcripts. Do not ship a tier distribution from these defaults as
> an empirical result; the module header says the same.

- **Source**: manifest (RESEARCH_MERGED.md, Feature inventory `scoring/config.ts`, `sigmoid.ts`; Recommended adoptions)
- **What**: A 32-dimension request scorer (22 keyword + 10 structural dimensions) feeding a sigmoid+confidence function that classifies a turn into a tier (`simple|standard|complex|reasoning`), with a "momentum" mechanism carrying the prior turn's tier forward.
- **Where to add**: new `lib/complexity.mjs`, consumed when building `/api/usage`/`/api/insights` in `server/index.mjs`; rendered in `InsightsSection.jsx` and a prompt-quality section
- **Caveats**: MIT — safe to copy directly. Research calls this "the highest-value idea in the whole survey" — enables claims like "you paid Opus rates for 340 simple-tier turns last month."

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
