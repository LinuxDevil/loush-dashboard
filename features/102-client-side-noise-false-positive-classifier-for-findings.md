# Client-side noise/false-positive classifier for findings

**Category:** Bugs, Quality & Reliability

- **Source**: claude-code-security-review (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Port `HardExclusionRules` (~120 lines of regex families covering 7 deterministic exclusion categories) to JavaScript so a Loush user can re-run/tune noise-suppression locally, independent of Anthropic's built-in opinions.
- **Where to add**: new `src/lib/finding-filters.js`, used by `BugsSection.jsx`
- **Caveats**: MIT-licensed, attribution required. Do this only after the findings-ingestion feature exists.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `100-security-findings-ingestion-into-bugs-with-confidence-exclusion-audit.md` — Security-findings ingestion into Bugs, with confidence/exclusion audit trail (prerequisite; ship this first)

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
