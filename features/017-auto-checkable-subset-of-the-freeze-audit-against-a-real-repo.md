# Auto-checkable subset of the freeze audit against a real repo

**Category:** Security, Governance & Access Control

- **Source**: A. claude-code-build-framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Machine-verifiable checks for ~8 of the 75 audit items against a real checkout: `.claude/agents/` non-empty, `.claude/hooks/pre_tool_use.py` exists, `settings.json` has `hooks` + `permissions.defaultMode`, `settings.local.json` gitignored, `.env.example` keys match `process.env` usage, `git status` clean.
- **Where to add**: new `/api/gov/freeze-audit?project=` endpoint in `server/index.mjs`, feeding the Freeze Audit tab with `auto: pass|fail|n-a` alongside manual ticks.
- **Caveats**: MIT. Flagged as the single highest-value differentiator — "nobody else auto-attests a production-readiness checklist against a real repo."

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
