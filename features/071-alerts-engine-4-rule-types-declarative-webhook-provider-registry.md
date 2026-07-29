# Alerts engine (4 rule types) + declarative webhook-provider registry

**Category:** UI, Viewers & Editor Integration

- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `alerts.js`, `webhook-providers.js`; Recommended adoptions)
- **What**: Four alert-rule types (`event_pattern` with N-in-window, `inactivity`, `status_duration`, `token_threshold`) with per-scope cooldown deduplication, feeding a registry of 14 declarative webhook providers (Slack, Discord, Teams, PagerDuty, etc.).
- **Where to add**: `server/alerts.mjs`, `server/webhooks.mjs`; UI in `InboxSection.jsx` (feed), `ReliabilitySection.jsx` (rules), Customize (channels)
- **Caveats**: None noted (MIT).

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
