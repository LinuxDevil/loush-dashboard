# Real ⌘K global search palette

**Category:** UI, Viewers & Editor Integration

- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A debounced (200ms) search endpoint spanning sessions/agents/plans/memories, paired with a cmdk-based command palette with skeleton loading states and `aria-live="polite"` result-count region.
- **Where to add**: upgrade existing `QuickActions` component; new `/api/search` endpoint in `server/index.mjs`
- **Caveats**: No LICENSE file on CAST. Generate the nav-items list from the live route table, not a hardcoded array.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
