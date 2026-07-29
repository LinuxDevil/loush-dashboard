# Event-driven git watching (no polling)

**Category:** Tickets, Planning & Delivery

- **Source**: Nimbalyst (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Watches `.git/refs/heads/<branch>` and `.git/index` directly; on change invalidates a short cache and emits `git:status-changed`, and on new commits emits `git:commit-detected`. A commit auto-approves any pending diff-review tags for the files it touched.
- **Where to add**: new `server/git.mjs` with an SSE/WebSocket channel, consumed by `ProjectHub.jsx`, `ProjectsSection.jsx`, `WorkingSet.jsx`.
- **Caveats**: None noted.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
