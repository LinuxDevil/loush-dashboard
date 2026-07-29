# Declarative run-expectations schema + explainable 0-100 execution score

**Category:** Security, Governance & Access Control

- **Source**: Claude Agent Framework / ciscoittech (RESEARCH_MERGED.md, Feature inventory `task_expectations`/`validate_execution.py`; Recommended adoptions)
- **What**: A schema mapping a regex task pattern to expected agents/files/artifacts/limits, scored against an actual run to produce a violations list and an explainable 0-100 score. Loush's version can apply this *retroactively* over 90 days of existing transcript history, which upstream can only validate going forward on live runs.
- **Where to add**: extend `/api/gov/evals` with an expectations store; UI in `src/sections/GovernanceSection.jsx`
- **Caveats**: No LICENSE file on this repo — permission recorded per research; record it in the ported file's header.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
