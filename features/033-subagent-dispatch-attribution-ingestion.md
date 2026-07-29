# Subagent dispatch attribution ingestion

**Category:** Cost, Pricing & Usage Accounting

- **Source**: Claude Code Usage Dashboard / phuryn (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Detects subagent records via `isSidechain`/`agentId`/`/subagents/` path signals, extracts dispatch metadata, and buckets auto-compaction separately — answering "which subagent type costs the most."
- **Where to add**: `collectUsage()` in `server/index.mjs` (add `isSubagent`/`agentId` per entry plus a parallel `agents` map), surfaced in `RunsSection.jsx` or `UsagePanel.jsx`.
- **Caveats**: MIT; complements (doesn't replace) `CapabilityLedger`'s always-on-load measurement.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
