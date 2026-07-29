# Anonymized data export (CSV/JSON, path/prompt-stripped)

**Category:** Cost, Pricing & Usage Accounting

- **Source**: Claude Code Dashboard / "CSI" (RESEARCH_MERGED.md, Feature inventory `routes/export.ts`; Recommended adoptions)
- **What**: A dedicated `/api/export/anonymized` mode that strips project paths, prompt text, and branch names, alongside RFC-style CSV quote-escaping.
- **Where to add**: new `server/export.mjs`; surfaced from `UsagePanel.jsx`
- **Caveats**: MIT. Combine with the PII-redaction feature above so non-anonymized exports are also redacted.

---

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `006-pii-detection-and-redaction-middleware.md` — PII detection and redaction middleware

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
