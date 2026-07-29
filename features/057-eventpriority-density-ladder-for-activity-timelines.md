# `EventPriority` density ladder for activity timelines

**Category:** Sessions, Transcripts & Forensics

- **Source**: context-mode (RESEARCH_MERGED.md, Feature inventory `src/types.ts`; Recommended adoptions)
- **What**: A four-level priority enum (`LOW: 1, NORMAL: 2, HIGH: 3, CRITICAL: 4`) used to filter/budget which events are shown in a long session view.
- **Where to add**: `src/sections/ActivityTimeline.jsx`, `SessionsSection.jsx` as a density control
- **Caveats**: Elastic License 2.0 — reimplement independently, the enum concept is trivial to redo from scratch.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
