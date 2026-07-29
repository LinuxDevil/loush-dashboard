# Empirical skill/agent description-quality linter

**Category:** Capability Ledger, Frameworks, Skills & Setup

- **Source**: manifest (RESEARCH_MERGED.md, ADR-0002 findings; Recommended adoptions)
- **What**: A linter encoding empirically-tested findings about which prompt vocabulary degrades tool selection — `MANDATORY`/`NEVER`/`Do NOT`/`blocked`/`NON-NEGOTIABLE` measurably hurt compliance, "blocked"→"redirected" flipped a tested model's capitulation rate from 6/6 to 0/6, ✅/❌ emoji bullets tokenize inconsistently across model families — plus a recommended five-part description template (`headline / WHEN / WHEN NOT / RETURNS / EXAMPLE`).
- **Where to add**: extend `scoreItem(fm, body, kind)` and `specificityOf` in `server/index.mjs`; surface in `CapabilityLedger.jsx` and a prompt-quality section
- **Caveats**: Take the findings, not code — manifest is MIT so even direct code use would be safe.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
