# Multi-language test-command detection table

**Category:** Tickets, Planning & Delivery

> **Status: implemented.** `lib/testdetect.mjs` + tests. 13 ecosystems; `detectAll()` returns
> every match ranked for polyglot repos. npm reads the real `scripts.test` rather than assuming
> `npm test`, and a Makefile with no `test:` target or a CMakeLists that never calls
> `add_test()` is declined outright rather than emitting a command that would vacuously pass.
> An unreadable directory throws instead of returning `[]`, so a permission error cannot
> masquerade as "this project has no tests". Verified against this repo: returns `node --test`.

- **Source**: ccpm (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A 13-entry marker-to-test-command table (npm, maven, gradle, composer, dotnet, cargo, go, bundler, flutter, swift, ctest, make) that lets a tool say "run this project's tests" against an arbitrary checkout with zero configuration.
- **Where to add**: new `server/testdetect.mjs`, consumed by quality/runs code
- **Caveats**: MIT-licensed; pure data, near-zero risk.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
