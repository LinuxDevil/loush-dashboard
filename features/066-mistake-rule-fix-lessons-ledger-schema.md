# Mistake→rule→fix "Lessons" ledger schema

**Category:** Context Explorer & Prompt/Model Insight

- **Source**: SuperClaude Framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A structured JSONL schema (`ts`/`task`/`mistake`/`evidence`/`rule`/`fix`/`tests`/`status`) for an accumulated mistake→rule→fix history, plus a companion `docs/mistakes/<name>-<date>.md` convention.
- **Where to add**: extend `server/memory.mjs`; surfaced in `InsightsSection.jsx` or `BugsSection.jsx`
- **Caveats**: MIT. Worth adopting as Loush's own output format since Loush can actually populate it — upstream never shipped an implementation.

---

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
