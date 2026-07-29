# Task decomposition generator with dependency + file-scope metadata

**Category:** Tickets, Planning & Delivery

- **Source**: ccpm (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Given an epic/spec, decompose it into numbered task files carrying `depends_on`, `parallel`, `conflicts_with` arrays and a `Size: XS/S/M/L/XL` estimate, capped at ≤10 tasks.
- **Where to add**: `server/ticket.mjs` as a new generator alongside existing `ac`/`design-plan`/`tests` generators; rendered in `TicketSection.jsx`, graph view in `PlanGraph.jsx`
- **Caveats**: MIT-licensed. Called "the single biggest capability gain available from ccpm" — Loush's version can be grounded in the real checkout (naming actual files) where ccpm can only guess.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
