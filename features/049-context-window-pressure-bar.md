# Context-window pressure bar

**Category:** Live/Real-time Infrastructure

- **Source**: Claude Code Dashboard (Stargx) (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Computes `lastTurnInputTotal = in + cacheCreate + cacheRead` for the most recent assistant turn, rendered as a percentage-of-context-window bar with a blue→yellow(>50%)→red(>80%) ramp.
- **Where to add**: the new Live session board and/or `WorkingSet.jsx`; a historical version fits `ResourceSection.jsx`.
- **Caveats**: MIT. Make the denominator model-aware, not a hardcoded 200K; render "unknown" rather than a plausible-looking fallback number when the figure is missing.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `048-live-now-session-board-with-waiting-thinking-idle-status.md` — Live "Now" session board with waiting/thinking/idle status

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
