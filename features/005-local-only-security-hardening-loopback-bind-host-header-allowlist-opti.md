# Local-only security hardening (loopback bind, Host-header allowlist, optional token gate)

**Category:** Security, Governance & Access Control

- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `security.js`; Recommended adoptions)
- **What**: Binds to loopback by default, restricts CORS to loopback, enforces a Host-header allowlist to prevent DNS-rebinding attacks, and offers an optional bearer/`x-dashboard-token` gate on API routes and the WS upgrade — closing a class of vulnerability CCAM itself had a CVE for (GHSA-gr74-4xfh-6jw9).
- **Where to add**: `server/index.mjs` + new `server/security.mjs`
- **Caveats**: None noted (MIT). Research says do this regardless of anything else, since Loush's server also reads transcripts and writes config.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
