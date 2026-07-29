# Parallel work-stream analysis artifact

**Category:** Tickets, Planning & Delivery

- **Source**: ccpm (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Produces an analysis document naming parallel work streams, the file globs each stream touches, coordination points, conflict-risk assessment, and a with/without-parallelism wall-time estimate.
- **Where to add**: `server/ticket.mjs` (generator) + `PlanGraph.jsx` (visualize as swimlanes)
- **Caveats**: MIT-licensed. Validate generated file globs against the actual tree to catch overlapping scopes.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
