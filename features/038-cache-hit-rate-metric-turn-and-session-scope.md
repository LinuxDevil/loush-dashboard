# Cache-hit-rate metric (turn and session scope)

**Category:** Cost, Pricing & Usage Accounting

- **Source**: Claude Code ecosystem landscape scan — `sirmalloc/ccstatusline` (RESEARCH_MERGED.md, Top 15 missed projects)
- **What**: Surfacing `cache_read_input_tokens / (cache_read + cache_creation + regular input)` as an explicit ratio metric at both per-turn and per-session scope.
- **Where to add**: `UsagePanel.jsx`.
- **Caveats**: MIT; cheap derived-metric addition, raw fields already exist.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
