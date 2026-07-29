# JSONL filesystem-watcher → SSE live event bus

**Category:** Live/Real-time Infrastructure

- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: chokidar-watches `~/.claude/projects`, tail-reads only the last 256KB of an appended JSONL file, and broadcasts typed SSE events with a 15s heartbeat and replay of the last 15 events tagged `historical: true` on new connections.
- **Where to add**: new `server/live.mjs` + `/api/events`; `src/lib/useLiveEvents.js` hook consumed first by `ActivityTimeline`/`WorkingSet`
- **Caveats**: No LICENSE file on CAST — permission recorded per research. Fix real bugs while porting: hardcoded `/` path separator breaks Windows, no `res.writableEnded` guard on broadcast, missing exponential backoff on the client.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `041-event-driven-query-cache-invalidation.md` — builds on top of this feature's SSE events; ship this one first

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
