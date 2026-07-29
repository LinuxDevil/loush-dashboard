# Permission-mode risk badges on live sessions

**Category:** Live/Real-time Infrastructure

- **Source**: Claude Code Dashboard (Stargx) (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Reads the session's `permissionMode` event field and renders a red "YOLO" badge for `bypassPermissions` or a yellow "AUTO-EDIT" badge for `acceptEdits`, live, per running session.
- **Where to add**: the Live session board, `GovernanceSection.jsx`, `HarnessSection.jsx`.
- **Caveats**: MIT.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `048-live-now-session-board-with-waiting-thinking-idle-status.md` — Live "Now" session board with waiting/thinking/idle status

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
