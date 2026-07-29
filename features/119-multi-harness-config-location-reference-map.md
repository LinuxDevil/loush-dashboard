# Multi-harness config-location reference map

**Category:** Capability Ledger, Frameworks, Skills & Setup

- **Source**: context-mode (RESEARCH_MERGED.md, `docs/platform-support.md`; Recommended adoptions)
- **What**: A reference table of where 17 different AI coding harnesses (beyond Claude Code) keep config files, hooks, and MCP registrations — usable to detect non-Claude-Code harnesses on the same machine.
- **Where to add**: `HarnessSection.jsx` + harness detection logic in `server/index.mjs`; `SetupSection.jsx`
- **Caveats**: Elastic License 2.0 — read the doc as a reference and independently re-derive the mapping, don't copy verbatim.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
