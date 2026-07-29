# Compaction-boundary tracking (tokens reclaimed per compaction)

**Category:** Sessions, Transcripts & Forensics

- **Source**: Claude Code ecosystem landscape scan — `sirmalloc/ccstatusline` (RESEARCH_MERGED.md, Top 15 missed projects)
- **What**: Treats `system` transcript entries with `compactMetadata` (`preTokens`, `postTokens`, `trigger`, `durationMs`) as a first-class marker, counting compactions and tokens reclaimed by each.
- **Where to add**: `SessionsSection.jsx` / `ContextExplorerSection.jsx`.
- **Caveats**: MIT. Confirmed present in real transcripts per the research's schema survey.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
