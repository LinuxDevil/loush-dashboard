# Tiered security framework (0–3) with auto-escalation

**Category:** Security, Governance & Access Control

- **Source**: A. claude-code-build-framework (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Four security tiers with additive inheritance and auto-escalation rules (e.g. any MCP/plugin usage → Tier 1+, money movement → Tier 3), backing 81 tier-conditional audit items across network allowlisting, credentials, action tiers, audit logging, supply chain, session security, agent security, canary detection, and plugin/skill validation.
- **Where to add**: `src/data/checklists/security-tiers.js` + a "Security tier" tab (or sub-tab of the Freeze Audit tab) in `GovernanceSection.jsx`.
- **Caveats**: MIT.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
