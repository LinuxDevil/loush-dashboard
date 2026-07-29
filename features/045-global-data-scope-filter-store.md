# Global data-scope filter store

**Category:** Live/Real-time Infrastructure

- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `dataScope.ts`; Recommended adoptions)
- **What**: A single client-side store that narrows every aggregate query by project/source with automatic query-param injection into the fetch wrapper.
- **Where to add**: new `src/lib/dataScope.js`
- **Caveats**: None noted (MIT).

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
