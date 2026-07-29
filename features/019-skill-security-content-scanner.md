# Skill security content scanner

**Category:** Security, Governance & Access Control

- **Source**: A. claude-code-build-framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Six scan patterns run over skill instruction text to flag skills that expose credentials, bypass governance, transmit to undeclared endpoints, suppress logging, grant excessive tool access, or conflict with the declared security tier — including a rule that internally-authored skills are not exempt.
- **Where to add**: new `/api/security/skill-audit` endpoint in `server/index.mjs` scanning `~/.claude/skills/**/*.md` and project `.claude/skills/`, surfaced as a tab in `src/sections/QualitySection.jsx`.
- **Caveats**: MIT. Entirely local-first.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
