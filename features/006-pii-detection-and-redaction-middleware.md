# PII detection and redaction middleware

**Category:** Security, Governance & Access Control

- **Source**: Claude Code Dashboard / "CSI" (RESEARCH_MERGED.md, Feature inventory `pii-detector.ts`; Recommended adoptions)
- **What**: A middleware applying 9 regex patterns to detect PII (API keys, etc.) in response content and redact matches right-to-left so index offsets stay valid, applied wherever transcript content reaches a client response.
- **Where to add**: new `lib/pii.mjs`; called from `server/index.mjs`, especially the usage/session/forensics readers and any `ChatSection.jsx` SSE stream
- **Caveats**: MIT-licensed. Research flags CSI's `ipv4`/`email` patterns as over-broad — make those two opt-in rather than defaults.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `039-anonymized-data-export-csv-json-path-prompt-stripped.md` — should reuse this middleware so non-anonymized exports are also redacted

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
