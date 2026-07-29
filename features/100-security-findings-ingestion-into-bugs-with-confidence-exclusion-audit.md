# Security-findings ingestion into Bugs, with confidence/exclusion audit trail

**Category:** Bugs, Quality & Reliability

- **Source**: claude-code-security-review (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Ingest `claudecode-results.json` (from the GitHub Actions `security-review-results` artifact) and/or parse the bot's PR review comments (including reactions) to populate a real Bugs section with `file`/`line`/`severity`/`category`/`description`/`exploit_scenario`/`recommendation` plus `filter_analysis` stats (hard-excluded vs Claude-excluded counts, average confidence, fail-open badge).
- **Where to add**: `server/eng.mjs` (new artifact/PR-comment fetchers) + `BugsSection.jsx`; excluded-findings audit trail in `QualitySection.jsx`
- **Caveats**: None noted (MIT). Upstream fails open on filter failure — badge that state, don't silently trust the filtered count.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `102-client-side-noise-false-positive-classifier-for-findings.md` — depends on this feature; ship this one first

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
