# Live "Now" session board with waiting/thinking/idle status

**Category:** Live/Real-time Infrastructure

- **Source**: Claude Code Dashboard (Stargx) (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A `deriveStatus()` state machine classifying each active session as `thinking`/`waiting`/`idle`/`error` from recency and last-content-type signals, plus idle-session collapsing and an `idle-stale` tier for sessions idle since before local midnight.
- **Where to add**: new `src/sections/LiveSection.jsx` (or a "Now" tab in `SessionsSection.jsx`); new `GET /api/live` in `server/index.mjs`; polled every ~2s client-side (no WebSocket needed).
- **Caveats**: MIT. Render `unknown` rather than `idle` when `lastEventAt` is absent, unlike upstream. Flagged as the single highest user-visible payoff item in the whole Stargx research.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
