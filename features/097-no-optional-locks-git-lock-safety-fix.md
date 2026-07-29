# `--no-optional-locks` git-lock-safety fix

**Category:** Tickets, Planning & Delivery

- **Source**: Claude Code ecosystem landscape scan — `sirmalloc/ccstatusline` (RESEARCH_MERGED.md, Top 15 missed projects)
- **What**: Passing `--no-optional-locks` to git commands to avoid `index.lock` races when the dashboard's own git reads happen concurrently with agent/CLI git operations on the same repo.
- **Where to add**: any git-shelling code in `server/eng.mjs` / the proposed `server/git.mjs`.
- **Caveats**: MIT.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
