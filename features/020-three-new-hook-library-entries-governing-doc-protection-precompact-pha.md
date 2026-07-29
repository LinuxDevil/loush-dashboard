# Three new hook-library entries (governing-doc protection, PreCompact phase-gate, install warnings)

**Category:** Security, Governance & Access Control

- **Source**: A. claude-code-build-framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: (a) a PreToolUse hook blocking writes to `CLAUDE.md`/`prd.md`/`AGENTS.md`; (b) a PreCompact hook that re-injects phase-gate/re-read-`STATE.md` reminders (Loush currently has zero PreCompact hook-library entries); (c) a PreToolUse Bash hook warning on installs of packages not in an approved list.
- **Where to add**: `HOOK_LIBRARY` in `server/index.mjs`.
- **Caveats**: MIT. Port to Node rather than Python; their `rm -rf` blocking rule is weak — Loush's existing `git-guardrails-claude-code` skill is already better, don't replace it.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
