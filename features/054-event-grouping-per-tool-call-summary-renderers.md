# Event grouping / per-tool-call summary renderers

**Category:** Sessions, Transcripts & Forensics

- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `event-grouping.ts`, `tool-views.tsx`; Recommended adoptions)
- **What**: Converts raw JSONL tool-call rows into human-readable titles/summaries per tool type, including `firstEnclosingContext()` which extracts the enclosing function name from a diff hunk header — described as the highest value-per-line idea in the whole CCAM codebase.
- **Where to add**: `src/lib/eventGrouping.js`, `src/lib/eventSummary.js`, `src/components/eventViews/`; consumed by `ActivityTimeline.jsx`, `ForensicsSection.jsx`
- **Caveats**: None noted (MIT).

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
