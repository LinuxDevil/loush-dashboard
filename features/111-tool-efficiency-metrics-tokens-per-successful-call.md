# Tool-efficiency metrics (tokens-per-successful-call)

**Category:** Capability Ledger, Frameworks, Skills & Setup

- **Source**: Claude Agent Framework / ciscoittech (RESEARCH_MERGED.md, Feature inventory `v_tool_efficiency`; Recommended adoptions)
- **What**: Per-tool-name success rate, average duration, average output size, and tokens-per-successful-call — "your Grep calls burn 4x the tokens per useful result that Read does."
- **Where to add**: `InsightsSection.jsx`, `HarnessSection.jsx`; extends existing tool-use-by-name counting in `server/index.mjs`
- **Caveats**: Same no-LICENSE/permission-recorded caveat.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
