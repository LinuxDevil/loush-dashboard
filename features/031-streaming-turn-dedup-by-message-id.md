# Streaming-turn dedup by `message.id`

**Category:** Cost, Pricing & Usage Accounting

- **Source**: Claude Code Usage Dashboard / phuryn, and ccusage (RESEARCH_MERGED.md, Recommended adoptions; Top 15 missed projects)
- **What**: Keeps only the last record per `message.id` within a file when tallying usage, since the same logical turn can otherwise be counted multiple times as streaming placeholders update. Independent measurement cited in the research reports 51–55% duplicate entries in real corpora.
- **Where to add**: the per-file parse loop in `collectUsage()`, `server/index.mjs`.
- **Caveats**: MIT. Verify on a real transcript first — this is likely a live over-count, not theoretical.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
