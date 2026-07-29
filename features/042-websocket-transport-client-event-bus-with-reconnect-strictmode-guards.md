# WebSocket transport + client event bus (with reconnect/StrictMode guards)

**Category:** Live/Real-time Infrastructure

- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A WebSocket-based live-update transport plus a client event bus, including a StrictMode duplicate-socket guard and reconnect triggered on focus/online/visibilitychange events.
- **Where to add**: new `src/lib/eventBus.js`, `src/hooks/useWebSocket.js`, `server/websocket.mjs`
- **Caveats**: None noted (MIT).

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
