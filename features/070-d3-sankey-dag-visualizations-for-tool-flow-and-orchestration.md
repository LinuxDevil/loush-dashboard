# D3 Sankey / DAG visualizations for tool-flow and orchestration

**Category:** UI, Viewers & Editor Integration

- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `ToolExecutionFlow.tsx`, `OrchestrationDAG.tsx`; Recommended adoptions)
- **What**: A true `d3-sankey` tool-execution flow diagram (self-loop/duplicate-node handling) and a custom 5-layer DAG layout for session→agent→subagent→outcome orchestration.
- **Where to add**: a Flow section, `InsightsSection.jsx`, `PlanGraph.jsx`
- **Caveats**: None noted (MIT); adds a `d3-sankey` dependency.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
