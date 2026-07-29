# Honest per-tool context-consumption breakdown ("where your window actually went")

**Category:** Context Explorer & Prompt/Model Insight

- **Source**: context-mode (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions, via the manifest comparison section)
- **What**: A real per-session breakdown of prompt-token size per turn and per-tool bytes-returned (grouped by tool name), ranking which tools are the biggest context consumers — instead of context-mode's own hardcoded-constant savings estimate, which the research flags as unreliable.
- **Where to add**: extend the existing `/api/context/:sessionId` handler in `server/index.mjs` to emit a `byTool` aggregate; render as a stacked band in `src/sections/ContextExplorerSection.jsx`, rolled up in `HarnessSection.jsx`
- **Caveats**: Elastic License 2.0 — do NOT copy source code; only the idea/finding is being reused, with an independent implementation.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
