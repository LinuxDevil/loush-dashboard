# Table paging (10→25→50, ≤12 never paginates) + CSV export

**Category:** Cost, Pricing & Usage Accounting

- **Source**: Claude Code Usage Dashboard / phuryn (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A three-tier progressive table-paging pattern paired with a "Download CSV to see all (N)" footer, and CSV export of the full filtered dataset.
- **Where to add**: new `src/ui/TableFooter.jsx` + `src/lib/csv.js`, applied across `SessionsSection.jsx`, `ProjectsSection.jsx`, `RunsSection.jsx`, `BugsSection.jsx`.
- **Caveats**: MIT.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
