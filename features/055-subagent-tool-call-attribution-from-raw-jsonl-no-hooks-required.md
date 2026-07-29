# Subagent tool-call attribution from raw JSONL (no hooks required)

**Category:** Sessions, Transcripts & Forensics

- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `scanAndImportSubagents`; Recommended adoptions)
- **What**: Parses `subagents/agent-*.jsonl` files and pairs `tool_use` with `tool_result` events by `tool_use_id` to reconstruct tool calls that never fire any hook event.
- **Where to add**: `SessionsSection`/`ForensicsSection`/`WorkingSet` transcript parsing
- **Caveats**: None noted (MIT). Doable today without the hook-receiver feature.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
