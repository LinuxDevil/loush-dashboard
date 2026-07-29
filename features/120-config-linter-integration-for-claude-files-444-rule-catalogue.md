# Config-linter integration for `.claude` files (444-rule catalogue)

**Category:** Capability Ledger, Frameworks, Skills & Setup

- **Source**: Claude Code ecosystem landscape scan — `agent-sh/agnix` (RESEARCH_MERGED.md, Top 15 missed projects)
- **What**: A cross-platform Rust linter/LSP with 444 validation rules across CLAUDE.md, SKILL.md, hooks, and MCP configs, with autofixes, shippable as a single binary.
- **Where to add**: `SetupSection.jsx`, `GovernanceSection.jsx`, `HooksSection.jsx`, `McpSection.jsx` — shell out to the `agnix` binary and render its diagnostics.
- **Caveats**: Apache-2.0 (also dual MIT/Apache-2.0) — shelling out to the binary avoids any code-copying question.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
