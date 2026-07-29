# Sensitive-path PR flag (governance event on agent-config changes)

**Category:** Security, Governance & Access Control

- **Source**: claude-code-action (RESEARCH_MERGED.md, Recommended adoptions, via claude-code-security-review section)
- **What**: Reuse the action's `SENSITIVE_PATHS` list (`.claude`, `.mcp.json`, `.claude.json`, `.gitmodules`, `.ripgreprc`, `CLAUDE.md`, `CLAUDE.local.md`, `.husky`) as a filter over a PR's changed-file list already fetched by our GitHub integration, flagging "this PR changes what the agent is allowed to do" as a first-class governance event.
- **Where to add**: `src/sections/GovernanceSection.jsx`, `server/eng.mjs`
- **Caveats**: None noted (MIT).

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
