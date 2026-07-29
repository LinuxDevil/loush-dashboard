# Fire-and-forget hook receiver for mid-turn visibility

**Category:** Live/Real-time Infrastructure

- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `POST /api/hooks/event`; Recommended adoptions)
- **What**: A hook script piping stdin JSON via HTTP POST to every live dashboard instance without awaiting a response, plus a single ingestion endpoint that upserts session/agent state from the 8 standard Claude Code hook types. This is what lets a dashboard show activity while an agent turn is still running.
- **Where to add**: new `server/hooks.mjs`, `scripts/hook-handler.mjs`; UI hooks into `SetupSection.jsx`/`HooksSection.jsx`
- **Caveats**: None noted (MIT). Research calls this "the single biggest capability gap" Loush currently has (only ever showing what already finished).

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
