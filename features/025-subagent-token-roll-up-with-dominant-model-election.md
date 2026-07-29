# Subagent token roll-up with dominant-model election

**Category:** Cost, Pricing & Usage Accounting

- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: When rolling up a session's tokens, also sum `<session>/subagents/*.jsonl` token usage into the parent, and elect a "dominant model" for the session by assistant-message frequency rather than just the top-level model.
- **Where to add**: `server/index.mjs` (existing session-walking code)
- **Caveats**: No LICENSE file on CAST — permission recorded per research.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
