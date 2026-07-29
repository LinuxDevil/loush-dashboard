# CLAUDE.md base-ref config restore (governance guard against PR-injected agent config)

**Category:** Security, Governance & Access Control

- **Source**: claude-code-action (RESEARCH_MERGED.md, Feature inventory / Identity)
- **What**: Before running, the action restores `CLAUDE.md`, `.claude/`, `.mcp.json`, `.claude.json`, `.gitmodules`, `.ripgreprc`, `.husky` from the base branch (not the PR head), copying the PR's own versions aside to `.claude-pr/` so the agent can review but not obey them. This prevents a PR from smuggling in modified agent instructions.
- **Where to add**: `src/sections/GovernanceSection.jsx` + `server/eng.mjs` (new PR file-list filter using the same `SENSITIVE_PATHS` list)
- **Caveats**: None noted (MIT).

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
