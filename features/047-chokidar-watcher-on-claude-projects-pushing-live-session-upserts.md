# chokidar watcher on `~/.claude/projects` pushing live session upserts

**Category:** Live/Real-time Infrastructure

- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A debounced (500ms/2s max-wait) filesystem watcher over the transcript directory that pushes delta `session_upserted` events rather than requiring a client poll or full re-scan.
- **Where to add**: `server/index.mjs` (or new `chat-ws.mjs`), consumed by `SessionsSection.jsx`, `ActivityTimeline.jsx`, `InboxSection.jsx`, `Overview.jsx`.
- **Caveats**: AGPL-3.0-or-later — port the debounce/delta design, not source.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `040-jsonl-filesystem-watcher-sse-live-event-bus.md` — JSONL filesystem-watcher → SSE live event bus

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
