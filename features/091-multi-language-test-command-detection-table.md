# Multi-language test-command detection table

**Category:** Tickets, Planning & Delivery

- **Source**: ccpm (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A 13-entry marker-to-test-command table (npm, maven, gradle, composer, dotnet, cargo, go, bundler, flutter, swift, ctest, make) that lets a tool say "run this project's tests" against an arbitrary checkout with zero configuration.
- **Where to add**: new `server/testdetect.mjs`, consumed by quality/runs code
- **Caveats**: MIT-licensed; pure data, near-zero risk.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
