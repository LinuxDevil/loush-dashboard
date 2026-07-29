# Browser-rendered permission prompts (replace `--dangerously-skip-permissions`)

**Category:** Chat & Permissions

> **Status: declined — do not implement.** Keeping `--dangerously-skip-permissions` is a
> deliberate product decision, not an oversight: a chat that blocks on per-tool permission
> prompts defeats the point of driving agents from a dashboard. Do not "fix" this. The record
> below is kept because the surrounding pieces (the `canUseTool` hook point, the allow-list
> format, the live context pill in `082`) are still useful references, and because a future
> reader should be able to see that the tradeoff was considered rather than missed.
>
> What this decision costs, stated plainly so it stays visible: a chat-initiated agent run can
> take any tool action — including writes and shell commands — with no interactive gate. The
> compensating controls are the ones that bound *what the process can reach* rather than what
> it may do: `005` (loopback bind + Host-header allowlist), `007` (outbound-network guard),
> `085` (attachment path containment), and `011` (per-project rwx access matrix). Those carry
> the security weight here and are worth more attention because this one is off the table.

- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A `canUseTool` callback that awaits a promise while a permission-request banner is shown in the browser, with a 55-second timeout for normal tools and infinite wait for `AskUserQuestion`/`ExitPlanMode`, plus an "allow + remember" action that appends a rule to the session's live allow-list.
- **Where to add**: `server/chat-ws.mjs` (see WebSocket protocol below) + a new permission banner in `src/sections/ChatSection.jsx`; resulting allow/deny events surfaced in `GovernanceSection.jsx` and `CapabilityLedger.jsx`.
- **Caveats**: AGPL-3.0-or-later — port the design, not the code, get written permission first if pasting anything. The research flagged this as its highest-integrity recommendation; that recommendation has been considered and declined, see the status note above.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `081-websocket-chat-protocol-with-seq-based-replay.md` — WebSocket chat protocol with seq-based replay (shares server/chat-ws.mjs)

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
