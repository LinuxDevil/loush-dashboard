# File-history-snapshot and compaction-boundary record parsing

**Category:** Sessions, Transcripts & Forensics

- **Source**: Claude Code Dashboard / "CSI" (RESEARCH_MERGED.md, Feature inventory session.ts record schema; Recommended adoptions)
- **What**: Recognizes `file-history-snapshot` records (a "files modified" count) and `system` records with `subtype: 'compact_boundary'` (context compactions counted) — both cheap, currently-missing derived metrics.
- **Where to add**: add the two derived metrics to session parsing in `server/index.mjs`, surfaced in `WorkingSet`/`ForensicsSection.jsx`
- **Caveats**: MIT-licensed; take as a schema reference, not a code port.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
