# Schema/contract drift guard for external file shapes

**Category:** Bugs, Quality & Reliability

- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A declared contract of expected JSONL fields, `settings.json` keys, and `.claude.json` structure, checked at boot against real sample files, warning loudly when Claude Code changes its transcript format, plus an automated contract test.
- **Where to add**: new `server/contracts.mjs`; verified by a `node --test` contract test
- **Caveats**: Take the idea only, not CAST's SQL-specific implementation — Loush has no DB.

---

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
