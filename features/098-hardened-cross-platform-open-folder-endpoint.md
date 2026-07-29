# Hardened cross-platform "open folder" endpoint

**Category:** Tickets, Planning & Delivery

- **Source**: Claude Code Dashboard (Stargx) (RESEARCH_MERGED.md, Notable code worth stealing; Recommended adoptions)
- **What**: A `POST /api/open-folder` endpoint using `execFile` with array arguments (never a shell string) to reveal a project folder in the OS file manager, per-platform.
- **Where to add**: `server/index.mjs`, reusable from `ProjectsSection.jsx` / `ProjectHub.jsx`.
- **Caveats**: MIT. Harden beyond upstream: allowlist the target path against configured project roots and add a `Host`-header check (upstream has neither).

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
