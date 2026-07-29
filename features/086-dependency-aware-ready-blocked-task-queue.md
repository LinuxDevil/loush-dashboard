# Dependency-aware ready/blocked task queue

**Category:** Tickets, Planning & Delivery

- **Source**: ccpm (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Partitions open tasks into "ready" (no unmet dependencies) vs "blocked" (named unmet deps), computed from `depends_on`/`parallel`/`conflicts_with` frontmatter metadata.
- **Where to add**: `server/eng.mjs` as a derived view over existing GitHub/JIRA issue data; surfaced in `InboxSection.jsx` and `BoardSection.jsx`
- **Caveats**: MIT-licensed. Do not adopt ccpm's "self-reported execution state" pattern — Loush already has ground truth from transcripts.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
