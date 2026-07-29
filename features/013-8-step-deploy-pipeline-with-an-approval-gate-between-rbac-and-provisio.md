# 8-step deploy pipeline with an approval gate between RBAC and provisioning

**Category:** Security, Governance & Access Control

- **Source**: C / AgentBreeder (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: An approval-gate *placement* principle: approval runs strictly between an RBAC check and any resource-provisioning step, so an unapproved agent never gets resources or credentials minted, and admin bypass is itself audited.
- **Where to add**: apply the gate-placement principle (not the full multi-cloud pipeline) to `GovernanceSection.jsx`'s existing Approvals tab.
- **Caveats**: Apache-2.0. Adopt only the vocabulary/gate-placement rule, not the pipeline (presupposes multi-tenant infra Loush doesn't have).

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `015-action-verb-vocabulary-and-gate-placement-rule-for-governance.md` — Action-verb vocabulary and gate-placement rule for governance

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
