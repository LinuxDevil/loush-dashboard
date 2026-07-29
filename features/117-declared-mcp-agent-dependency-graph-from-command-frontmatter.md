# Declared MCP/agent dependency graph from command frontmatter

**Category:** Capability Ledger, Frameworks, Skills & Setup

- **Source**: SuperClaude Framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: An `mcp-servers: []` / `personas: []` frontmatter convention enabling a "broken dependency" check and MCP-level ROI ("you have X installed; only 2 commands reference it and neither has fired").
- **Where to add**: `server/index.mjs`'s `overviewItems()` (carry `fm['mcp-servers']`/`fm.personas` through), rendered in `FlowSection.jsx`/`PlanGraph.jsx` and cross-checked in `McpSection.jsx`.
- **Caveats**: None noted; adopt the frontmatter convention in Loush's own authoring templates too.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `118-will-not-negative-boundary-section-in-agent-authoring-templates.md` — `Will Not:` negative-boundary section in agent authoring templates

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
