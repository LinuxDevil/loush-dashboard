# Event-driven query-cache invalidation

**Category:** Live/Real-time Infrastructure

- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Maps typed SSE "something changed" frames to specific cache-key invalidations, removing polling intervals.
- **Where to add**: new `src/lib/resourceCache.js`, wired to the live-events hook above
- **Caveats**: No LICENSE file on CAST. Do this only after the live-event-bus feature ships.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `040-jsonl-filesystem-watcher-sse-live-event-bus.md` — JSONL filesystem-watcher → SSE live event bus (prerequisite; ship this first)

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
