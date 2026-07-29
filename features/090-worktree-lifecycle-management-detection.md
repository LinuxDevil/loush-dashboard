# Worktree lifecycle management + detection

**Category:** Tickets, Planning & Delivery

- **Source**: ccpm (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: One-worktree-per-epic convention, `git worktree list` parsing, prune/force-remove recovery recipes, and a `--no-ff` merge + remove + branch-delete + archive cleanup sequence. Includes a detection primitive parsing a `.git` file's `gitdir:` line.
- **Where to add**: new `server/worktree.mjs`; surfaced in a project-hub section for list/create/remove, and in `RunsSection.jsx` to show which worktree each agent run executed in
- **Caveats**: MIT-licensed. Showing which worktree a session actually ran in is something ccpm cannot self-report — flagged as a real differentiator.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
