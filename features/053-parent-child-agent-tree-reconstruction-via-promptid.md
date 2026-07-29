# Parent→child agent-tree reconstruction via promptId

**Category:** Sessions, Transcripts & Forensics

- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: 200ms after a subagent JSONL file appears, reads its `promptId` and scans sibling session files for a matching `promptId` to reconstruct a real parent→child agent tree from otherwise-flat transcript files.
- **Where to add**: `src/sections/PlanGraph.jsx`, `ActivityTimeline.jsx`
- **Caveats**: No LICENSE file on CAST. Fix the original's race-condition sleep and O(files×100 lines) scan — cache the `promptId → agentId` map per session directory instead of re-scanning.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
