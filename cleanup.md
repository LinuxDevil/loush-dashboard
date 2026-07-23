# Dashboard tab/feature cleanup plan

Audited via 6 parallel agents reading actual source + API calls (not just names), 2026-07-22.

## 1. Harness hub (10 panels → 6)

- **Merge Usage → Governance/Costs.** Same spend/budget numbers computed twice: `UsagePanel.jsx` from `/api/usage` (localStorage budget), Governance's Costs sub-tab from `/api/gov/costs` (server-persisted `harness.budgets`). Server-persisted is canonical. Fold Usage's month-end projection, cache-TTL waste, anomalies, and token heatmap in as a Governance sub-tab. Usage disappears as a top-level Harness panel.
- **Merge Team Baseline → Governance/Drift.** `TeamBaseline.jsx` is the same baseline/drift/sync machinery as Governance's `Drift.jsx`, just promoted from single-project to git-shared `team-harness.json` across all repos. Add as a "Team" sub-tab next to Drift.
- **Relocate Library out of Harness → Capabilities.** `LibrarySection.jsx` re-lists the same skills/agents (`/api/res/skills`) that Capabilities' Skills/Commands/Agents panels already own individually. Demote Library to just Bundles/Profiles/Context-bundles packaging (export/import), move it under Capabilities (or make it a Governance sub-tab).
- **Keep separate:** Sessions / Context Explorer / Forensics — different grain (per-session ledger, per-turn replay, cross-session aggregate), not duplicates. Just add/keep a "see Forensics" deep link from Sessions' compaction column.
- **Keep separate:** Config (HarnessSection) vs Governance — live-edit surface vs versioning/audit layer on top of it. Correctly split already.
- **Keep separate:** MCP — disjoint config domain (`~/.claude.json` mcpServers), no overlap.
- **Result:** Sessions, Context Explorer, Forensics, Config, Governance (absorbs Usage + Team Baseline), MCP.

## 2. Capabilities hub (7 panels → 6)

- **Merge CapabilityLedger + Inventory** into one Hub entry with an internal tab strip. Both live in `CapabilityLedger.jsx`, hit overlapping data, share the same table/sort/filter pattern, and the file's own comments already call Inventory a "demoted" predecessor kept only as an authoring aid.
- ResourceSection (Skills/Commands/Agents via `kind` prop), FlowSection, and CustomizeSection: no overlap found, keep as-is.
- Minor cleanup: drop the unnecessary `export` on `bundlePrompt` in `LibrarySection.jsx:157` (only used within the same file).

## 3. Workflows hub (one real duplicate)

- **QuickActions' "Runs" list duplicates RunsSection.** `QuickActions.jsx` polls `/api/actions` and renders its own run list/RunWindow; `RunsSection.jsx` polls `/api/runs` with a fuller implementation (filters, KPIs, approvals, timeline detail). Canonical owner: RunsSection. Trim QuickActions to just the launcher buttons + project picker; drop its own run list or fold it in as a `source=actions` filter on RunsSection.
- Board, Quality, Bugs: complementary (different lifecycle stages — pipeline board vs review findings vs filed defects), not duplicated.

## 4. Labs hub (3 items → 2)

- **Drop Squad Designer as a separate Labs entry.** `TeamsSection.jsx` (Agent Squads) already renders `TeamDesigner.jsx` inline as a toggle/mode (`if (designing) return <TeamDesigner .../>`) with a "Team designer" button and empty-state link. The standalone Labs entry is redundant with the toggle that already exists inside Agent Squads. Reach Designer only via that button.
- Result: Labs shrinks to Mindwalk + Agent Squads.

## 5. Overview vs Delivery — de-duplicate the math, not the tabs

Overview's `DeliveryTiles`/`CiStrip` intentionally show a condensed teaser of Delivery (click-through to drill in) — this is a legitimate product decision, not accidental duplication. But the at-risk/cycle-time-percentile/CI-red-branch logic is copy-pasted independently in both files rather than shared. Extract into a common module (e.g. `deliveryMath.js`) imported by both `Overview.jsx` and `DeliverySection.jsx`/`EngDashboard.jsx`, so the two views can't drift out of sync on definitions.

## 6. Career dashboard — flagged, not recommended for merging

`career/ReviewFlow.jsx`, `career/QualityPanel.jsx`, `career/FlowPanel.jsx` conceptually echo `eng/ReviewFlow.jsx`, `QualitySection.jsx`, `FlowSection.jsx` respectively, but are legitimately self-scoped (per-person identity via `useEngSelf()`/`me` param) rather than team-wide — an intentional separate-audience view (Career dashboard was explicitly split out of the topbar for privacy reasons per App.jsx's own comments), not leftover dead code. Real duplication exists at the *implementation* level (each has its own mini design system in `career/theme.jsx`/`career/charts.jsx` instead of reusing `eng/ui.jsx`/`eng/charts.jsx`), worth eventually extracting shared primitives, but not a tab-collapse candidate.

## Non-findings

- No dead/unimported components found in any audited file set, except the one unnecessary `export` above.
- `ProjectHub.jsx` looked orphaned by name (sounds like it belongs under "Projects") but is legitimately mounted inside `HarnessSection.jsx` for per-project harness introspection — distinct from `ProjectsSection.jsx`'s workspace/usage listing. Misleadingly named, not misplaced; worth a rename (e.g. `HarnessProjectView.jsx`) only.
- Inbox vs Delivery, Bugs vs Quality/Inbox, Board vs Delivery(JIRA), ResourceSection reuse, Constitution vs Memory, PromptStudio vs Customize/Flow, Hooks vs Harness verification card, Artifacts standalone, Cursor vs Usage — all checked, no duplication, correctly separated already.

## Net effect

16 top-level tabs → 15 (Labs loses Squad Designer as a separate entry). Harness hub 10 → 6 panels. Capabilities hub 7 → 6 panels. One duplicate run-list dropped from Workflows. No functionality lost — every panel keeps a home, just fewer top-level clicks and no more double-implemented math/data.
