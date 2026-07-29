# Byte-offset incremental file tailing

**Category:** Live/Real-time Infrastructure

- **Source**: Claude Code Dashboard "CSI" / Stargx / phuryn (RESEARCH_MERGED.md, Feature inventory `routes/live.ts`; Recommended adoptions, multiple projects)
- **What**: Tracks a per-file byte-offset map and reads only newly appended bytes, with the rule "on first sight of a file, record its size — don't replay its whole history" — enabling live-tailing of sessions started in other terminals.
- **Where to add**: `server/index.mjs` alongside existing SSE plumbing; feeds `ActivityTimeline.jsx`, `RunsSection.jsx`
- **Caveats**: MIT (all sources). Fix the boundary bugs the originals have — pass an explicit `end` to the read stream and carry any trailing partial line forward instead of dropping it (Stargx's own implementation loses partial lines and has a stat-before-open race causing duplicate reads).

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
