# Declarative model-parameter applicability catalogue for settings UI

**Category:** Capability Ledger, Frameworks, Skills & Setup

- **Source**: manifest (RESEARCH_MERGED.md, Feature inventory `provider-params-spec.ts`, `model-parameters-schema.md`; Recommended adoptions)
- **What**: A JSON schema describing which request parameters are valid for a given provider/auth/model combination, with a single `applicability` field replacing ad-hoc `disabledWhen`/`conflictsWith` flags.
- **Where to add**: a new catalogue file under `lib/`, consumed by `SetupSection.jsx` (currently ~443 lines of hand-rolled form) and `server/setup.mjs`; also applicable to `McpSection.jsx`'s per-server env/args
- **Caveats**: MIT-licensed, safe to copy directly.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
