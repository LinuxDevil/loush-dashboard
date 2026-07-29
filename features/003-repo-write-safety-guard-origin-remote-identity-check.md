# Repo-write safety guard (origin/remote identity check)

**Category:** Security, Governance & Access Control

- **Source**: ccpm (RESEARCH_MERGED.md, Feature inventory; Gaps/Supply-chain incident; Recommended adoptions)
- **What**: Before any write to GitHub/JIRA, validates the inferred remote/repo identity matches expectations, preventing the class of accident where a tool infers the wrong target repo and writes to strangers' issues (which is exactly what happened in ccpm's own upstream issue tracker).
- **Where to add**: `server/eng.mjs`, guarding `/api/eng/pr/:num/comment`, `/api/eng/pr/:num/request-review`, `/api/eng/ticket/:key/transition`, `/api/eng/ticket/:key/comment`
- **Caveats**: MIT-licensed. Note: never copy ccpm's *installer* (the `curl | bash` install path was implicated in an XMRig cryptominer supply-chain compromise, issue #1016) — only copy the plain markdown/bash from a git checkout, never a hosted installer URL.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
