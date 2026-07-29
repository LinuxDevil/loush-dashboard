# Config-discovery precedence rules (project vs user, deprecated paths)

**Category:** Capability Ledger, Frameworks, Skills & Setup

- **Source**: Claude Code ecosystem landscape scan — `nyatinte/ccexp` (RESEARCH_MERGED.md, Top 15 missed projects)
- **What**: An explicit enumeration of where Claude Code config lives and its precedence: `CLAUDE.md` (project) vs `CLAUDE.local.md` (deprecated local override) vs `~/.claude/CLAUDE.md` (user); same pattern for commands and subagents.
- **Where to add**: validate/document against Loush's own glob patterns in `SetupSection.jsx`, `LibrarySection.jsx`, `CustomizeSection.jsx`, `ProjectHub.jsx`.
- **Caveats**: MIT, but the source is ~8.5 months stale and missing `.claude/skills/`/`.claude/plugins/` — treat as reference for the stable parts only, verify against current docs.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
