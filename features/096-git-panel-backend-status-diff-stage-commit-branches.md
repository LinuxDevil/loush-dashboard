# Git panel backend (status/diff/stage/commit/branches)

**Category:** Tickets, Planning & Delivery

- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A `spawn`-with-argv (never shell-string) git backend parsing `git status --porcelain=v1 -z` including conflict detection, exposing status/diff/stage/unstage/commit/branch routes.
- **Where to add**: new `server/git.mjs`; new `GitSection.jsx`, cross-linked from `DeliverySection.jsx`, `WorkingSet.jsx`, and `TicketSection.jsx`.
- **Caveats**: AGPL-3.0-or-later — reimplement the parser from the documented shape, do not paste source.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
