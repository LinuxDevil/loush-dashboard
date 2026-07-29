# Pure-function insight-rule registry pattern

**Category:** UI, Viewers & Editor Integration

- **Source**: Claude Code Dashboard / "CSI" (RESEARCH_MERGED.md, Feature inventory insights-engine; Recommended adoptions)
- **What**: An `Insight` engine built as an array of pure rule functions `(session, allSessions) => Insight | null`, sorted by severity, so adding a new insight is one small testable file plus an array entry.
- **Where to add**: `InsightsSection.jsx` + new `lib/insight-rules/` directory
- **Caveats**: MIT. Take only the *shape*, not CSI's actual 10 rules (assessed as shallow/tautological).

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
