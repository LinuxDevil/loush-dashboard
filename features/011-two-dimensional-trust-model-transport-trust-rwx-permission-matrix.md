# Two-dimensional trust model (transport trust + rwx permission matrix)

**Category:** Security, Governance & Access Control

- **Source**: B2 / beadle (RESEARCH_MERGED.md, Feature inventory / Project-specific deep dives)
- **What**: Combines a 4-level transport-trust classification with an orthogonal `rwx` permission matrix keyed `permissions[identity][contact] → "rwx"|"rw-"|"r--"|"---"`. Defaults are whitelist-only (`---`), no inheritance between identity cells, and a "redacted listing" mode shows sender/date/trust metadata without exposing gated content.
- **Where to add**: new `server/access.mjs` + a new "Access" tab in `src/sections/GovernanceSection.jsx`, retargeting the matrix from `(identity, contact)` to `(profile, project)`: `r`=dashboard may read/display a project, `w`=may write into it, `x`=may run commands against it. Store as JSON under `~/.claude/dashboard-access.json`.
- **Caveats**: MIT licensed. The 4-level transport-trust part is not portable (only meaningful for messages arriving from strangers over a network) — skip it, per the research's own recommendation.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `012-per-session-docker-container-isolation-explicitly-not-recommended.md` — its salvageable allowlist idea folds into this feature's Access tab
- `015-action-verb-vocabulary-and-gate-placement-rule-for-governance.md` — reuses this feature's new Access tab

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
