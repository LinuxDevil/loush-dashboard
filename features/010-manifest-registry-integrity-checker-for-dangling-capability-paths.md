# Manifest/registry integrity checker for dangling capability paths

**Category:** Security, Governance & Access Control

- **Source**: Claude Agent Framework / ciscoittech (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Resolves every path referenced by any manifest (`REGISTRY.json`-style), `settings.json` hook script, or MCP config against the actual filesystem and reports dangling/broken entries — catching silent breakage (the research notes the upstream framework itself currently ships an 8-path bug of exactly this kind on its own main branch).
- **Where to add**: alongside existing `/api/gov/drift` in Governance; surfaced in a Library section
- **Caveats**: Same no-LICENSE/permission-recorded caveat.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
