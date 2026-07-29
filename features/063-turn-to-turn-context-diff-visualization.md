# Turn-to-turn context diff visualization

**Category:** Context Explorer & Prompt/Model Insight

- **Source**: Claude Code ecosystem landscape scan — `jianshuo/ccglass` (RESEARCH_MERGED.md, Top 15 missed projects)
- **What**: A diff view showing exactly what changed in the model's context between consecutive turns (system prompt, tool schemas, message history) — described in the research as "the single best feature idea I found for ContextExplorer."
- **Where to add**: `src/sections/ContextExplorerSection.jsx`, computed over transcript data Loush already parses (no full wire-level proxy needed).
- **Caveats**: MIT. The full proxy-based wire capture (ccglass's own approach) is high-effort/new-runtime-component — lower priority than the diff visualization alone over existing transcript data.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
