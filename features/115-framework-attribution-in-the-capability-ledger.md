# Framework attribution in the Capability Ledger

**Category:** Capability Ledger, Frameworks, Skills & Setup

- **Source**: SuperClaude Framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Detects which installed framework a given command/agent/skill came from via file-path signatures, frontmatter shape, and settings.json plugin entries — enabling "SuperClaude v4.3.0 costs you N tokens/session; 27 of its 50 capabilities have never fired."
- **Where to add**: new `server/frameworks.mjs`; a `source` column in `CapabilityLedger.jsx` and a filter chip in `LibrarySection.jsx`.
- **Caveats**: MIT. Detection rules are heuristics, not copied code.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
