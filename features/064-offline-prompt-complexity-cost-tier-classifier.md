# Offline prompt-complexity / cost-tier classifier

**Category:** Context Explorer & Prompt/Model Insight

> **Status: implemented and calibrated.** `lib/complexity.mjs` + tests (43 across two files). 34
> inspectable dimensions (22 keyword + 12 structural), sigmoid + confidence, and the momentum
> carry-forward. `scoreTurn()` returns a per-dimension breakdown whose contributions sum
> exactly to the raw score, so the classification is evidence rather than a bare number. Empty
> or unscoreable input returns `tier: null`, and `tierDistribution()` counts unknown separately
> so it cannot inflate `simple`.
>
> **Calibrated against a hand-labelled fixture set** (`test/fixtures/complexity-labelled.mjs`,
> 21 prompts). The original boundaries were inherited from a score scale ~10x wider than real
> prompts produce, so `standard` absorbed 74% of turns and `reasoning` was unreachable.
>
> Diagnosis first: the failure was not the boundaries. The keyword lists were general-assistant
> vocabulary ("story, poem, legal, medical"), so `Add a null check to the parser and update the
> test` matched NOTHING and scored below `run the tests`. Fixing that required widening the
> coding vocabulary and adding two structural dimensions — `scopeBreadth` and `clauseCount` —
> because nothing measured how much a turn touches, and that is what separates standard from
> complex. `analyticalReasoning` was raised 0.06 -> 0.11 because complex and reasoning are
> different axes (breadth vs deliberation) and interleaved on one score.
>
> Result on the real corpus: 33/30/19/19 across the four tiers instead of 7/74/11/7, and
> low-confidence turns fell from 50% to 37%. Confidence is now informative too — 0.997 for a
> bare "ok", 0.34 for a genuinely borderline "run the tests".
>
> **Still not proven.** The fixture labels are a judgement call, not user-confirmed ground
> truth, and n=21. Treat tier counts as directional. `test/lib/complexity-calibration.test.mjs`
> asserts the bands stay separated and each boundary stays inside its gap, so a future weight
> change surfaces there rather than silently reshaping the distribution.

- **Source**: manifest (RESEARCH_MERGED.md, Feature inventory `scoring/config.ts`, `sigmoid.ts`; Recommended adoptions)
- **What**: A 32-dimension request scorer (22 keyword + 10 structural dimensions) feeding a sigmoid+confidence function that classifies a turn into a tier (`simple|standard|complex|reasoning`), with a "momentum" mechanism carrying the prior turn's tier forward.
- **Where to add**: new `lib/complexity.mjs`, consumed when building `/api/usage`/`/api/insights` in `server/index.mjs`; rendered in `InsightsSection.jsx` and a prompt-quality section
- **Caveats**: MIT — safe to copy directly. Research calls this "the highest-value idea in the whole survey" — enables claims like "you paid Opus rates for 340 simple-tier turns last month."

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
