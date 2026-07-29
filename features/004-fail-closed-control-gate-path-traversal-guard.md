# Fail-closed control gate + path-traversal guard

**Category:** Security, Governance & Access Control

- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A middleware that returns 404/503/403 by default on write routes unless a constant-time-compared token is presented (fail-closed), plus a `safeResolve(base, ...parts)` helper that returns null if a resolved path escapes its base directory.
- **Where to add**: `server/index.mjs`, mounted on every write route (setup writes, config writes, ticket writes)
- **Caveats**: No LICENSE file on CAST (permission to copy already obtained per research — record it).

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
