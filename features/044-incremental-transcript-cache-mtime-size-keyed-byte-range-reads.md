# Incremental transcript cache (mtime+size keyed, byte-range reads)

**Category:** Live/Real-time Infrastructure

- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `transcript-cache.js`; Recommended adoptions)
- **What**: Caches parsed transcript data keyed by `(mtime, size)`, doing incremental byte-range reads on append, handling truncation edge cases, LRU-bounded.
- **Where to add**: new `server/transcriptCache.mjs`, used by every section reading `~/.claude/projects`
- **Caveats**: None noted (MIT).

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
