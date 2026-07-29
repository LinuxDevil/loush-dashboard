# Subscription-plan-aware quota bar (5-hour + weekly window)

**Category:** Cost, Pricing & Usage Accounting

- **Source**: phuryn/claude-usage research, flagged as "ours to build" — no upstream implementation exists
- **What**: A plan-tier-aware usage panel showing percent-consumed of the rolling 5-hour window (already computed as `activeBlock`) and a separate weekly cap, self-calibrated from the user's own observed rate-limit events.
- **Where to add**: extend `server/index.mjs`'s existing `activeBlock` computation; new plan-limits panel in `UsagePanel.jsx`.
- **Caveats**: Published per-plan hour figures are stale/unverified — don't hardcode them; token-denominated bars are estimates and must be labeled as such.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
