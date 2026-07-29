# Structured acceptance-criteria schema for tickets

**Category:** Tickets, Planning & Delivery

- **Source**: B. Claude Code Builder (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: An `AcceptanceCriterion` schema with stable IDs, `test_steps[]`, a `test_type` enum, `validation_method`, `priority`, and `automated` flag, grouped into a 4-bucket structure — replacing free-text acceptance-criteria blobs with tickable, filterable, exportable structured items.
- **Where to add**: `TicketSection.jsx`'s `CriteriaTab`, upgrading `META` artifact storage from markdown blobs to structured items.
- **Caveats**: MIT. This is a data-model migration touching generate/save/JIRA-comment paths — plan for that surface area.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
