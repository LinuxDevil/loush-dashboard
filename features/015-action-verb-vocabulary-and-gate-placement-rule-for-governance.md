# Action-verb vocabulary and gate-placement rule for governance

**Category:** Security, Governance & Access Control

- **Source**: C / AgentBreeder (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A standard verb set `{read, use, write, deploy, publish, admin}` as the vocabulary for permission/approval UIs, plus the rule that admin bypasses of any gate are themselves audited events.
- **Where to add**: `GovernanceSection.jsx` (Approvals tab) and the new Access tab (from the beadle item), plus documented as policy in `docs/`.
- **Caveats**: Apache-2.0, documentation-level adoption.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `011-two-dimensional-trust-model-transport-trust-rwx-permission-matrix.md` — Two-dimensional trust model (transport trust + rwx permission matrix)

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
