# One-click hook installation bundles with tool filters

**Category:** Capability Ledger, Frameworks, Skills & Setup

- **Source**: Claude Agent Framework / ciscoittech (RESEARCH_MERGED.md, Feature inventory hook bundles; Recommended adoptions)
- **What**: Four preset hook configurations (code-quality, security, notifications, performance) declared as JSON with a `filters.tools` field scoping which tools trigger each hook.
- **Where to add**: `HooksSection.jsx`, `/api/hooks`; installable items in a Library section
- **Caveats**: Same no-LICENSE/permission-recorded caveat; rewrite underlying `.sh` scripts as cross-platform Node.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
