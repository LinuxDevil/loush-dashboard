# Immutable audit event schema + resource lineage graph

**Category:** Security, Governance & Access Control

- **Source**: C / AgentBreeder (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: An `AuditEvent` record with denormalized `resource_name` (readable after the resource is deleted) and a free-form JSON `details` column, paired with a `ResourceDependency` edge table for impact analysis ("what depends on this prompt/hook/MCP server?").
- **Where to add**: whatever backs `GET /api/gov/*` today, feeding the existing "Audit log" tab in `GovernanceSection.jsx`; render lineage edges with the existing d3 setup used by `PlanGraph.jsx`.
- **Caveats**: Apache-2.0, schema/pattern only (their in-memory service implementation is flagged as not durable — don't copy that part).

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
