# CI-run cost ingestion via execution file

**Category:** Cost, Pricing & Usage Accounting

- **Source**: claude-code-security-review / claude-code-action (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: When a workflow uploads the action's `execution_file` as a build artifact, the final `type: "result"` JSON element contains `total_cost_usd` and `duration_ms` — the only file-based way to get real CI agent-run cost.
- **Where to add**: `server/eng.mjs` + `src/sections/RunsSection.jsx`; ship a copy-pasteable `upload-artifact` snippet in `SetupSection.jsx`
- **Caveats**: Requires an extra workflow step; MIT.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
