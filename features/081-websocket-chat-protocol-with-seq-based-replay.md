# WebSocket chat protocol with `seq`-based replay

**Category:** Chat & Permissions

- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Architecture; Recommended adoptions)
- **What**: A WebSocket chat gateway with four inbound verbs (`chat.send`/`chat.abort`/`chat.subscribe`/`chat.permission-response`), a `kind`-tagged outbound frame envelope, a one-`complete`-per-run invariant, and a per-run monotonic `seq` with a ring-buffer for replaying missed frames after a reconnect.
- **Where to add**: new `server/chat-ws.mjs` replacing the SSE half of `server/index.mjs`, new `src/lib/ws.mjs`, consumed by `ChatSection.jsx`.
- **Caveats**: **AGPL-3.0-or-later, and their CVE-2026-31975 was exactly this layer** — get written permission naming specific files before pasting code. Authenticate at the WebSocket upgrade (not the first message), never trust a client-supplied session/project/provider id, bind `127.0.0.1` only.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `080-browser-rendered-permission-prompts-replace-dangerously-skip-permissio.md` — shares server/chat-ws.mjs with this feature

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
