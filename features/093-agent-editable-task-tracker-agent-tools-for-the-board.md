# Agent-editable task tracker (agent tools for the board)

**Category:** Tickets, Planning & Delivery

- **Source**: Nimbalyst (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Exposes `tracker_create` / `tracker_update` / `tracker_list` / `tracker_link_session` as agent-callable tools so the agent maintains the same board humans see, cross-referenced to the session that worked each item.
- **Where to add**: new tool endpoints in `server/` plus `BoardSection.jsx` / `PlanGraph.jsx`.
- **Caveats**: None noted.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
