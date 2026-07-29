# Live context-usage pill (`extractTokenBudget`)

**Category:** Chat & Permissions

- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A pure function extracting token-budget/context-window state from streaming events, driving a composer-adjacent pill showing live "how close to compaction" status.
- **Where to add**: `server/chat-ws.mjs`; pill in `ChatSection.jsx`; same numbers fed into `UsagePanel.jsx`.
- **Caveats**: AGPL-3.0-or-later — small/pure enough to reimplement rather than copy.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `072-pure-function-insight-rule-registry-pattern.md` — Pure-function insight-rule registry pattern

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
