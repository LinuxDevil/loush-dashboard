# Browser-rendered permission prompts (replace `--dangerously-skip-permissions`)

**Category:** Chat & Permissions

- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A `canUseTool` callback that awaits a promise while a permission-request banner is shown in the browser, with a 55-second timeout for normal tools and infinite wait for `AskUserQuestion`/`ExitPlanMode`, plus an "allow + remember" action that appends a rule to the session's live allow-list.
- **Where to add**: `server/chat-ws.mjs` (see WebSocket protocol below) + a new permission banner in `src/sections/ChatSection.jsx`; resulting allow/deny events surfaced in `GovernanceSection.jsx` and `CapabilityLedger.jsx`.
- **Caveats**: AGPL-3.0-or-later — port the design, not the code, get written permission first if pasting anything. **Flagged in the research as the highest-integrity fix in this whole document, since Loush's chat currently runs fully unsandboxed via `--dangerously-skip-permissions`.**

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `081-websocket-chat-protocol-with-seq-based-replay.md` — WebSocket chat protocol with seq-based replay (shares server/chat-ws.mjs)

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
