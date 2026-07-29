# Frontmatter linting for malformed skill/command files

**Category:** Capability Ledger, Frameworks, Skills & Setup

- **Source**: SuperClaude Framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Flags commands/skills whose YAML frontmatter fails to parse or disagrees with the filename — surfacing "this file's frontmatter didn't parse, Claude Code is treating it as prompt text."
- **Where to add**: `server/index.mjs`'s `parseFM()`, propagating an `fmMissing`/`fmError` flag through `overviewItems()` into `CapabilityLedger.jsx` and `LibrarySection.jsx` rows.
- **Caveats**: None noted.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
