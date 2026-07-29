# Structured Work Log parser as a second files-changed signal

**Category:** Sessions, Transcripts & Forensics

- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Parses `## Work Log` markdown sections from agent output into `{items, filesRead, filesChanged, codeReviewerResult, testWriterResult, decisions}` — a self-reported files-changed list that cross-checks the tool-call-derived edit list and catches edits made via Bash that tool-call parsing misses.
- **Where to add**: `server/index.mjs` transcript parsing → feeds `WorkingSet`/`ActivityTimeline.jsx`
- **Caveats**: No LICENSE file on CAST — permission recorded per research.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
