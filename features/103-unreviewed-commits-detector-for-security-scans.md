# Unreviewed-commits detector for security scans

**Category:** Bugs, Quality & Reliability

- **Source**: claude-code-security-review (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: By counting commits after the SHA of the only security-review comment on a PR, surface "PR #412: 7 commits, 1 security review (commit 1). 6 commits unreviewed" — something neither upstream tool can show because it requires kept history.
- **Where to add**: `InboxSection.jsx` with a helper in `server/eng.mjs`
- **Caveats**: None noted (MIT); a derived insight, not a code port.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `005-local-only-security-hardening-loopback-bind-host-header-allowlist-opti.md` — Local-only security hardening (loopback bind, Host-header allowlist, optional token gate)

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
