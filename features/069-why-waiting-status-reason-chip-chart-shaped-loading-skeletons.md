# "Why waiting" status-reason chip + chart-shaped loading skeletons

**Category:** UI, Viewers & Editor Integration

- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `StatusBadge.tsx`, `Skeleton.tsx`; Recommended adoptions)
- **What**: A nested status chip that explains *why* a session/agent is in its current waiting/error state, plus generic chart-shaped skeleton loading placeholders.
- **Where to add**: shared `src/components/` primitives, used across Sessions/Board/Overview/Runs
- **Caveats**: None noted (MIT). Full accuracy depends on the hook-receiver feature; without it, derive what's possible from transcripts and render null rather than guessing.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
