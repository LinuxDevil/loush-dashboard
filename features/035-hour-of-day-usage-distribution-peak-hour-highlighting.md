# Hour-of-day usage distribution + peak-hour highlighting

**Category:** Cost, Pricing & Usage Accounting

- **Source**: Claude Code Usage Dashboard / phuryn (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A 24-bucket hour-of-day chart with local/UTC toggle and a highlighted "peak-hour" band.
- **Where to add**: `ActivityTimeline.jsx` or `UsagePanel.jsx`.
- **Caveats**: MIT. Note Anthropic reportedly removed peak-hour reduction on 2026-05-06 — verify relevance before shipping, and restrict the band to weekdays with a real timezone offset (upstream doesn't).

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
