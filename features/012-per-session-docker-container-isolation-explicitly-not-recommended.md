# Per-session Docker container isolation — explicitly NOT recommended

**Category:** Security, Governance & Access Control

> **Status: rejected — do not implement.** Per-session Docker containers with fixed mounts
> solve a multi-tenant hosting problem; this is a single-user localhost process. All of the
> complexity, none of the benefit.
>
> Its one portable idea was salvaged into `011`: the access policy is stored at
> `~/.claude/dashboard-access.json`, never inside a project, so a repo cannot widen its own
> access by editing a file within itself.

- **Source**: B1 / NanoClaw (RESEARCH_MERGED.md, Feature inventory)
- **What**: One long-lived Docker container per session with 9 fixed mounts, mount allowlists, symlink-traversal defense, and fail-closed defaults. Flagged as wrong threat model for a local-first single-user tool.
- **Where to add**: Not directly applicable — do not adopt wholesale. The one salvageable piece (a fail-closed allowlist file outside the project root listing which repo roots may be read) folds into the rwx Access tab idea above.
- **Caveats**: Explicitly NOT recommended per the research.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `011-two-dimensional-trust-model-transport-trust-rwx-permission-matrix.md` — Two-dimensional trust model (transport trust + rwx permission matrix)

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
