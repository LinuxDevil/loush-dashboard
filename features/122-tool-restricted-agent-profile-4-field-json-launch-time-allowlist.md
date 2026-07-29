# Tool-restricted agent profile (4-field JSON, launch-time allowlist)

**Category:** Capability Ledger, Frameworks, Skills & Setup

- **Source**: FlyCrys and Nimbalyst (RESEARCH_MERGED.md, Feature inventory `agent_config.rs`; Recommended adoptions)
- **What**: An agent-profile format as a single JSON file (`{name, system_prompt, allowed_tools: [], model}`) per named profile, with each allowed tool passed as a separate `--allowedTools` CLI argument when launching the CLI — "the single cheapest idea in either project to copy."
- **Where to add**: editor UI in `CustomizeSection.jsx` or `HarnessSection.jsx`; storage/spawn-arg assembly in a new `server/profiles.mjs`; surfaced in `GovernanceSection.jsx`
- **Caveats**: FlyCrys/Nimbalyst are MIT-licensed. Be explicit in the UI that this is a launch-time allowlist, not interactive mid-session tool gating.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
