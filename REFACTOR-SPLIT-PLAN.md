# Refactor: splitting files over 500 lines

> Status: 2 of 12 steps done (`server/dashboard-core.mjs`, `lib/security-findings.mjs`).
> **All line numbers below predate the repo-wide comment sweep and are stale.**
> Locate every symbol by name (grep), never by line number.

---

# Split plan — files over 500 lines

Scanned all tracked non-md code files (`git ls-files`, excluding md/json/lock/svg/css and media). 24 hits over 500 lines; 3 are media/fixtures, 3 are test files. **18 real source files.** No untracked file is over 500 lines.

Four sub-agents analysed them in parallel. Per-file detail lives in the section plans:

| Section | File |
|---|---|
| server/index.mjs | [split-01-server-index.md](split-01-server-index.md) |
| other server modules | [split-02-server-rest.md](split-02-server-rest.md) |
| lib/ | [split-03-lib.md](split-03-lib.md) |
| src/ (React) | [split-04-src.md](split-04-src.md) |

## Verdicts

**Split (10 files)**

| File | Lines | → |
|---|---|---|
| server/index.mjs | 5358 | ~8 route modules + shared core (see granularity note) |
| server/eng.mjs | 1599 | 3: core + `lib/eng-analytics.mjs` + `server/eng-github.mjs` |
| server/hooks-receiver.mjs | 706 | 2: extract `lib/dash-instances.mjs` (~125) |
| lib/event-grouping.mjs | 886 | 3: `tool-call-summary.mjs` + `diff-context.mjs` + facade |
| lib/lessons.mjs | 800 | 2: facade + `lessons-derive.mjs` |
| lib/security-findings.mjs | 722 | 2: facade + `security-findings-filter.mjs` |
| src/sections/TicketSection.jsx | 926 | 2: `ticket/DesignTab.jsx` + `ticket/shared.jsx` |
| src/sections/EngDashboard.jsx | 919 | 2: `eng/Board.jsx` + `eng/ProjectConfig.jsx` |
| src/sections/GovernanceSection.jsx | 516 | 2: `governance/VersionHistory.jsx` + `governance/Ops.jsx` |
| src/company/FigmaCaptureSection.jsx | 511 | 2: extract `company/figma-editor.jsx` |

**Leave alone (8 files)** — over 500 lines but cohesive; splitting costs more than it buys:

- `server/ticket.mjs` (1170) — one feature, and ~20 source-regex assertions in `test/server/ticket.test.mjs` are hard-coupled to this exact path
- `server/fe.mjs` (577) — one feature, already internally organised
- `lib/freeze-audit.mjs` (1054) — one audit engine; ITEMS+CHECKS joined by id on every call
- `lib/complexity.mjs` (664) — one scorer; constants calibrated as a set
- `lib/todos.mjs` (624) — deliberately one shared client/server model
- `lib/capability-provenance.mjs` (593) — explicitly "one module, same bytes" by design
- `src/App.jsx` (586) — mostly a routing table with load-bearing comments
- `src/sections/TodosSection.jsx` (563) — six already-decoupled flat components

**Test files** (`test/lib/freeze-audit.test.mjs` 630, `security-findings.test.mjs` 595, `lessons.test.mjs` 508) — not splitting. Long test files are fine; every split below preserves the existing public entry points via facade re-exports so no test file has to move.

## Granularity note on server/index.mjs

The sub-agent proposed 21 modules. That's too many — take its seam analysis but merge into ~8 route modules of 400–700 lines each, grouped by dashboard area (inventory, insights+usage, teams+hub, harness, governance, inbox+bugs+prompts, ci-quality+board, chat+projects-live), plus the one genuinely load-bearing extraction: `server/dashboard-core.mjs` (~180 lines of shared safe/backup/track/propose/readMeta/readJson primitives). Do `dashboard-core.mjs` first — nothing else can move until it exists.

## Order

> **Run [COMMENT-REMOVAL-PLAN.md](COMMENT-REMOVAL-PLAN.md) first.** Stripping comments drops 6 of these files under 500 lines and cancels the `FigmaCaptureSection.jsx` split outright. It also shrinks every remaining target (index.mjs 5363→4830, eng.mjs 1599→1346, ticket.mjs 1170→855). Re-run the scan after the sweep before executing anything below.

1. `server/dashboard-core.mjs` — unblocks everything else in index.mjs
2. lib splits (event-grouping, lessons, security-findings) — pure functions, facade-preserving, lowest risk, tests prove them immediately
3. src splits — independent of the server work, verifiable in the browser
4. `server/eng.mjs` + `hooks-receiver.mjs` — self-contained
5. index.mjs route modules — one commit per module, `npm test` between each

Steps 2 and 3 can run in parallel with each other.

## Risks

- **Shared mutable module-level state in index.mjs** (`usageCache`, `failCache`, `scanCache`, `verifyResults`, `boardRuns`, `ciCache`, `chats`). Each Map needs exactly one owning module; every other module imports the Map or an accessor. Re-declaring one silently forks the cache into two disagreeing copies.
- **Source-text-regex tests.** `test/server/ticket.test.mjs` asserts exact code fragments exist at specific paths. Grep the test suite for the file path before moving any code — this is what killed the ticket.mjs split.
- **Circular imports in the lib facades.** For security-findings, duplicate the two tiny bound constants in the filter module rather than importing them back from the facade.
- **`ColumnsBoard`/`IssueTip` in EngDashboard.jsx** are used by three routes (Overview, Sprint, Members). The new `eng/Board.jsx` must export both.

---

# Split plan: server/index.mjs (5358 lines)

Read in full (6 chunks). Sibling modules studied: `eng.mjs`, `ticket.mjs`, `hooks-receiver.mjs`,
`pricing-store.mjs`, `fe.mjs`.

## The established convention (do not deviate)

- One file per feature area, default export `mount<Name>(app, deps)` that calls `app.get/post/...`
  directly on the passed `app`. Deps the module can't import itself (because importing them would
  create a cycle back through index.mjs) are passed as a second `{ }` argument — e.g.
  `mountFe(app, { scanTranscripts, failStats, backup })`, `mountTodos(app, { scanTranscripts,
  failStats, track, backup })`, `mountAccess(app, { track })`.
- Pure/shared logic that multiple server modules need lives in `lib/*.mjs`, never imported from
  `index.mjs` itself. `ticket.mjs`'s own comment states the reason explicitly: "moved to
  lib/clone.mjs so server modules can use it without importing this file (which mounts them, so
  the dependency would be a cycle)." Same story for `lib/agent.mjs`, `lib/paths.mjs`.
- Named exports for anything another server module or a test imports (`ticket.mjs` exports
  `normalizeKey`; `pricing-store.mjs` exports `MAX_RULES`, `validateRules`, `applyStoredRates`).
- Route paths, response shapes and the two-plane (work vs harness) labelling are load-bearing and
  must not change during a mechanical split.

## The one thing that makes this split hard

`index.mjs` isn't a few huge functions — it's ~35 independent route groups (matching the ~30
`src/sections/*.jsx` files) that all reach into the **same pile of module-level primitives**:
`safe()`, `backup()`, `track()`, `propose()`, `readMeta()/writeMeta()`, `readJson()`,
`readClaudeJson()`, `tokens()`, `mangle()`, plus the constants `HOME/CLAUDE/CLAUDE_JSON/PROJECT`.
Almost every route touches at least one of these. None of the sibling modules had to solve this
at this scale because they each own a narrower slice (eng.mjs = JIRA/GitHub, ticket.mjs = one
ticket's design doc).

**Consequence for the plan:** step 0 must extract those primitives into a new
`server/dashboard-core.mjs` *before* anything else moves. Every other extraction imports from
`dashboard-core.mjs` (never from `index.mjs`), exactly like `ticket.mjs` importing from
`lib/clone.mjs` instead of `index.mjs`.

---

## Step 0 (prerequisite) — `server/dashboard-core.mjs` (~180 lines)

**Moves in** (from the listed line ranges):
- L63–71: `HOME, CLAUDE, CLAUDE_JSON, PROJECT, WIN, BACKUPS, PORT`
- L194–214: `safe()`, `backup()`, `parseFM()`
- L346–349: `readClaudeJson()`
- L667–669: `META_FILE, readMeta(), writeMeta()`
- L675: `tokens()`
- L1691–1692: `mangle()`, `readJson()`
- L2286–2334: `VERSIONS_FILE, APPROVALS_FILE, AUTHOR, appendVersion(), track(), readVersions(),
  readApprovals(), writeApprovals(), propose()`

**Exports:** everything above, named.

**index.mjs keeps:** the `const app = express()` bootstrap, security middleware wiring,
`installNetworkGuard`, and imports `dashboard-core.mjs` like every other module will.

**Why first:** `track()`/`propose()`/`safe()`/`readMeta()` are called from governance, harness,
board, bugs, prompts, scaffolding, batch ops — i.e. from nearly every module below. Extracting
them once, first, means every subsequent step is a clean cut instead of a re-negotiation of what
counts as "core" each time.

**Testable on its own:** `npm test` should be green with zero behavior change — this step only
moves code, no route changes. Add nothing new.

---

## Extraction order (each step independently committable + testable)

For each: target path, what moves (source line ranges from the pre-split file), exported
surface, mount-time deps it needs.

### 1. `server/inventory.mjs` (~480 lines)
**Moves:** L216–339 (KINDS, listItemNames/itemFile/itemRoot/scopeDir/walkFlatKind/flatName,
`kindGuard`, `/api/res/*`), L340–425 (`/api/mcp/*`, `mcpTest`), L427–473 (`/api/hooks` raw +
`/api/settings`), L474–605 (Customize: `customizeRes/Rules/Mcp/Plugins/Hooks/All`,
`RULE_TARGETS`, `hookKey`, `/api/customize`, `/api/customize/toggle`), L607–664 (`/api/artifacts/*`).
**Exports:** `KINDS`, `itemFile`, `scopeDir` (needed by `overview-capabilities.mjs` and
`quick-utils.mjs`'s scaffold skill-copy).
**Feeds:** `CustomizeSection.jsx`, `LibrarySection.jsx`.
**Deps:** `dashboard-core.mjs` (`safe, backup, parseFM, tokens, CLAUDE, PROJECT, readClaudeJson,
CLAUDE_JSON, WIN`), `toggleOffFile` from `lib/customize-toggle.mjs` (already imported at top).

### 2. `server/overview-capabilities.mjs` (~230 lines)
**Moves:** L677–786 (`scoreItem, levelOf, specificityOf, groupOf, overviewItems, /api/overview,
/api/tags`), L3411–3502 (`capabilityLedger()`, `/api/capabilities`, `/api/capabilities/archive`).
**Exports:** `overviewItems` (used by `harness-library.mjs`'s recs).
**Feeds:** `Overview.jsx`, `CapabilityLedger.jsx`.
**Deps:** `inventory.mjs` (`KINDS, itemFile, scopeDir`), `scanTranscripts` from
`transcript-scan.mjs`, `lib/harness-metrics.mjs` (`capabilityVerdict, tokPerFire,
sessionsSince`), `dashboard-core.mjs`.

### 3. `server/transcript-scan.mjs` (~330 lines)
**Moves:** L998–1011 (`analysisTailer, parsedRecords`), L999–1005 (`transcriptsSince`),
L2373–2455 (`failCache, failStats, errSig, median`), L2864–2972 (`scanCache, scanTranscripts`).
**Exports:** `scanTranscripts`, `failStats`, `transcriptsSince`, `parsedRecords`, `median`, `errSig`.
This is the shared parse layer — the single most-imported module in the new tree.
**Feeds:** nothing directly; every "insights" route builds on this.
**Deps:** `lib/transcript-tail.mjs` (`createTailer`), `dashboard-core.mjs` (`CLAUDE`).

### 4. `server/usage.mjs` (~330 lines)
**Moves:** L789–993 (`usageCache, collectUsage, parentSessionPath, rollUpSubagents,
/api/usage`), L1013–1041 (`/api/worktrees`), L3586–3616 (`/api/sessions`), L3618–3668
(Context Window Explorer: `/api/context/sessions`, `/api/context/:sessionId`).
**Exports:** `collectUsage` (imported by nearly everything below: projects, live, harness,
inbox, roi, board cost-join, teams).
**Feeds:** `UsagePanel.jsx`, `ContextExplorerSection.jsx`.
**Deps:** `dashboard-core.mjs`, `lib/pricing.mjs`, `lib/harness-usage-trends.mjs`,
`lib/harness-health.mjs`, `lib/worktree.mjs`, `transcript-scan.mjs` (for `failStats` in
`/api/sessions`).

### 5. `server/insights.mjs` (~500 lines)
**Moves:** L1060–1097 (`/api/session/events`, `/api/lessons`), L1183–1262 (`/api/complexity`,
`/api/errors`), L2456–2474 (`/api/gov/failures`), L2975–3050 (`/api/flow`), L3052–3134
(`/api/dupes`, `/api/chatstats`), L3135–3184 (`/api/search`), L3504–3584 (`/api/forensics`).
**Feeds:** `FlowSection.jsx`, `InsightsSection.jsx`, `PromptQuality.jsx` (dupes).
**Deps:** `transcript-scan.mjs` (all of it), `usage.mjs` (`collectUsage`, for chatstats),
`lib/complexity.mjs`, `lib/error-taxonomy.mjs`, `lib/event-grouping.mjs`, `lib/lessons.mjs`,
`lib/harness-metrics.mjs` (`contextPressure`), `inventory.mjs` (`itemFile` for overview items in
`/api/flow` node bodies — actually `/api/flow` reads skill/command/agent files directly via
`fs`, not through `inventory.mjs`; verify no import needed here).

### 6. `server/projects-live.mjs` (~180 lines)
**Moves:** L1264–1359 (`LIVE_TAIL_BYTES, lastSignals, /api/live`), L1361–1428 (`gitCache,
repoInfo, /api/projects`).
**Feeds:** `ProjectsSection.jsx`, `LiveSection.jsx`.
**Deps:** `usage.mjs` (`collectUsage`), `dashboard-core.mjs` (`readClaudeJson, mangle`),
`lib/testdetect.mjs`, `lib/session-status.mjs`. Needs `hooksReceiver.getLiveState` passed in as
a mount dep from index.mjs (`mountLive(app, { hooksReceiver })`).

### 7. `server/chat.mjs` (~260 lines)
**Moves:** L1430–1687 (`chats Map, chatBroadcast, PLAN_SCHEMA_RULE, readTranscript,
historyEvents, /api/chat*, /api/actions*, analyzeRun, /api/chat/sessions`), L4125–4138
(`/api/chat-review` — same "record accept/reject" pattern, small enough to fold in here rather
than its own file).
**Feeds:** the in-app Chat UI, `QuickActions.jsx`.
**Deps:** `dashboard-core.mjs` (`CLAUDE, WIN, mangle, track`), `memory.mjs`'s
`retrieveContext` (already imported at top of index.mjs — pass through or import directly, it's
already a sibling module so a direct import is fine and matches convention).

### 8. `server/teams.mjs` (~400 lines)
**Moves:** L1688–1879 (agent-teams board: `listTeams, readInboxes, findTranscript,
transcriptStats, teamState, inboxAppend, /api/team, /api/team/agent, /api/team/message,
/api/team/interrupt, /api/team/shutdown, /api/team/plan`), L4013–4069 (`/api/team/flag,
/api/team/designs, /api/team/design/review`).
**Feeds:** `TeamsSection.jsx`.
**Deps:** `dashboard-core.mjs` (`CLAUDE, mangle, readJson, track`), spawns `claude` CLI directly.

### 9. `server/harness.mjs` (~500 lines)
**Moves:** L1880–1996 (`HARNESS_DEFAULTS, GUARDRAIL_DEFS, settingsFileFor, claudeMdFor,
leafPaths, getPath, deepMerge, harnessResolve`), L1997–2044 (`verifyResults,
/api/harness, /api/harness/raw (get+put), /api/harness/verify, PATCH /api/harness`),
L2348–2370 (`/api/gov/dryrun` — reuses `harnessResolve`, belongs beside it).
**Exports:** `harnessResolve`, `HARNESS_DEFAULTS`, `settingsFileFor`, `deepMerge`, `leafPaths`,
`getPath`, `verifyResults` (read by `hub.mjs`).
**Feeds:** `HarnessSection.jsx`.
**Deps:** `dashboard-core.mjs`, `usage.mjs` (`collectUsage`, for `usedTokens`).

### 10. `server/hub.mjs` (~260 lines)
**Moves:** L2046–2234 (`readIf, splitSections, hubListSkills, hubListAgents, hubResolve`),
L2235–2283 (`/api/hub, /api/hub/session, /api/hub/file GET+PUT`).
**Feeds:** `ProjectHub.jsx`.
**Deps:** `harness.mjs` (`harnessResolve, verifyResults`), `dashboard-core.mjs` (`track,
readClaudeJson, tokens, mangle`).

### 11. `server/governance.mjs` (~420 lines)
**Moves:** L2302–2323 (`/api/gov/versions, /api/gov/versions/:id, /api/gov/rollback` — the
version-history read side; `track`/`readVersions`/`appendVersion` themselves are in
`dashboard-core.mjs`, only the routes move), L2324–2345 (`/api/gov/approvals GET,
/api/gov/approvals/:id`), L2508–2550 (`DEFAULT_EVALS, evalRuns, activeEvals,
/api/gov/evals GET/PUT, /api/gov/evals/run`), L2552–2582 (`costAlerts, /api/gov/costs`),
L2584–2607 (`DEFAULT_PROFILES, readProfiles, /api/gov/profiles GET/PUT,
/api/gov/profiles/apply`).
**Exports:** `costAlerts` (used by `inbox.mjs`), `readProfiles`.
**Feeds:** `GovernanceSection.jsx` (versions / evals / costs / profiles tabs).
**Deps:** `dashboard-core.mjs`, `usage.mjs` (`collectUsage`), `lib/pricing.mjs` (`entryCost`),
`harness.mjs` (`deepMerge`, for profile-apply merge).

### 12. `server/harness-library.mjs` (~330 lines)
**Moves:** L2609–2662 (`exportBundle, /api/gov/bundle/export, /api/gov/library,
/api/gov/bundle/import`), L2663–2691 (`driftFor, syncDriftField, /api/gov/baseline,
/api/gov/drift, /api/gov/drift/sync`), L2692–2726 (`/api/gov/recs, /api/gov/recs/dismiss`),
L3767–3845 (`driftVs, /api/gov/team, /api/gov/team/baseline, /api/gov/team/export,
/api/gov/team/sync` — same bundle/drift machinery, one repo vs many).
**Feeds:** `GovernanceSection.jsx` (library / drift / recs tabs), `LibrarySection.jsx`.
**Deps:** `dashboard-core.mjs`, `hub.mjs` (`hubResolve`, `hubListSkills`, `hubListAgents`),
`lib/clone.mjs` (`localCloneOf`), `ci-quality.mjs` (`reviewData`, for recurring-finding recs) —
**note:** this creates `harness-library.mjs → ci-quality.mjs`; make sure `ci-quality.mjs` does
not import back from `harness-library.mjs` (it shouldn't need to).

### 13. `server/prompts.mjs` (~150 lines)
**Moves:** L2727–2860 (`PLAN_FIRST, OUTPUT_EXPECT, AC_DEFAULT, assemblePrompt, scorePrompt,
/api/prompts*`).
**Feeds:** `PromptStudio.jsx`, `PromptQuality.jsx`.
**Deps:** `dashboard-core.mjs` (`readJson`/`track`-adjacent file helpers), none from other new
modules — this one is fully self-contained. Good early/independent extraction.

### 14. `server/inbox.mjs` (~380 lines)
**Moves:** L3186–3220 (`engMod, engSnap, loadEngSnapshot, engSnapshot`), L3221–3270
(`workItems`), L3272–3359 (`inboxItems, /api/inbox GET/POST done`), L3378–3409 (`/api/digest`),
L3670–3765 (`/api/roi`), L3982–4011 (`/api/notify*`, slack-push `setInterval`).
**Exports:** `engSnapshot` (used by `ci-quality.mjs`'s `engProjectList`/CI health — actually
`engProjectList` does its own dynamic import of `eng.mjs`; keep as-is, don't force a shared
import just to save one line).
**Feeds:** `InboxSection.jsx`, `DeliverySection.jsx` (roi).
**Deps:** `dashboard-core.mjs`, `usage.mjs` (`collectUsage`), `governance.mjs` (`costAlerts`),
`governance.mjs` (`evalRuns`), `board.mjs` (`readBoard`, `boardRuns` — for blocked/idle board
items), `loush-runs.mjs` (`scanRuns`), `lib/scheduler.mjs` (`schedulerInbox`). This module has
the widest fan-in of any extracted module — it is deliberately the last thing computed on every
poll, pulling a status line from every other domain. Expect it to need the most mount-time deps.

### 15. `server/quick-utils.mjs` (~150 lines)
**Moves:** L3847–3887 (`scaffoldFiles, /api/scaffold`), L3889–3947 (`batchPlan, /api/batch`),
L3949–3963 (`/api/pins`), L3965–3971 (`/api/ctxbundles`), L3973–3980 (`/api/notes`).
**Rationale for grouping:** none of these five share logic, but each is 10–40 lines of
CRUD-over-a-JSON-file with no cross-cutting concern — giving each its own file would be exactly
the "dozen tiny modules" this plan is told to avoid. If a reviewer would rather split `/api/pins`
+ `/api/ctxbundles` + `/api/notes` (trivial, ~35 lines total) away from `/api/scaffold` +
`/api/batch` (which do touch `driftFor`/`syncDriftField` from `harness-library.mjs` via
`batchPlan`'s `sync-drift` op), that's a reasonable amendment — flagging it rather than deciding
it unilaterally.
**Deps:** `dashboard-core.mjs`, `inventory.mjs` (`itemFile`, `scopeDir` for skill-copy in
scaffold), `harness.mjs` (`readProfiles`... actually `readProfiles` lives in `governance.mjs`
per #11 — fix cross-ref when implementing), `harness-library.mjs` (`driftFor, syncDriftField`).

### 16. `server/bugs.mjs` (~170 lines)
**Moves:** L4073–4123 (`BUGS_FILE, readBugs, writeBugs, parseTrace, /api/bugs GET/POST/PATCH/DELETE`
— note the POST handler also pushes a linked ticket into the board, see landmine below),
L4140–4196 (`bisects Map, /api/bugs/:id/bisect, /api/bugs/:id/context`).
**Feeds:** `BugsSection.jsx`.
**Deps:** `dashboard-core.mjs`, `board.mjs` (`readBoard, writeBoard, projCfg` — a new bug
auto-creates a `type:'bug'` board ticket; this coupling is real, not incidental, see landmines).

### 17. `server/hooks-native.mjs` (~90 lines)
**Moves:** L4198–4224 (`/api/hooks/test, /api/hooks/dryrun`), L4225–4249 (`/api/hooks/health,
truncateCmd, HOOK_LIBRARY`), L4250–4273 (`resolvePattern, /api/hooks/library,
/api/hooks/install`).
**Feeds:** `HooksSection.jsx`. Deliberately separate from `hooks-receiver.mjs` (live ingest) —
this module is about *authoring/testing* hooks, that one is about *observing* them fire.
**Deps:** `dashboard-core.mjs` (`settingsFileFor` — actually that's in `harness.mjs`, import
from there), `transcript-scan.mjs` (`scanTranscripts`, for `/api/hooks/health`).

### 18. `server/ci-quality.mjs` (~430 lines)
**Moves:** L4275–4331 (`ciWorkflowPath, ciYaml, /api/ci/status, /api/ci/generate`),
L4332–4426 (`ghAvailable, engProjectList, repoRuns, repoCI, ciCache, ciHealth, /api/ci/runs,
/api/ci/health, /api/ci/rerun`), L4428–4509 (analytics registry: `scanTracking, caseOf,
analyticsRegistry, /api/analytics/*`), L4511–4610 (design drift: `scanComponents,
manifestStatus, designDrift, /api/design/drift, /api/design/manifest`), L4612–4638
(`reviewData, /api/reviews`).
**Exports:** `designDrift`, `reviewData` (both consumed by `harness-library.mjs`'s
`/api/gov/recs`), `engProjectList`, `ciHealth` (consumed by `inbox.mjs`'s CI-red inbox item —
wait, that's currently inline in `inboxItems()` via a direct `ciHealth(...)` call at L3335;
`inbox.mjs` will need to import `ciHealth` from here — another real cross-module edge, noted
below).
**Feeds:** `QualitySection.jsx`.
**Deps:** `dashboard-core.mjs`, `usage.mjs`... actually none needed here beyond fs/git/gh
shell-outs. This is the largest of the "quality" modules; if it ends up over 500 lines once
actually cut (my line-range arithmetic is approximate), split along its clear internal seam:
CI (workflow gen + cross-repo health) vs. analytics+design (instrumentation + Figma drift) — two
files, `server/ci-quality.mjs` and `server/analytics-drift.mjs`.

### 19. `server/board.mjs` (~510 lines) — genuinely resists further splitting
**Moves:** L4640–5147, in full: `DEFAULT_STAGES, DEFAULT_BOARD, readBoard, writeBoard, projCfg,
tkt, stamp, blockT, pct, extractJson, boardRuns, loushRunEmit, loushRunState, recordRun,
teamStage, gitB, changedFiles, conflictScan, ensureWorktree`, every `/api/board/*` route
(tickets CRUD, analyze/breakdown, start/review/fix, preview start/stop, qa, release,
unblock, teams/pipelines/config, analytics).
**Exports:** `readBoard`, `writeBoard`, `projCfg`, `boardRuns` (needed by `bugs.mjs` and
`inbox.mjs`).
**Why it should NOT be split further:** this is one state machine (backlog → in-progress →
code-review → fixing → ready-for-qa → qa-running → bug-reported → ready-for-release →
released, plus a blocked side-state) implemented as a sequence of stage-transition handlers that
all share `readBoard/writeBoard/tkt/stamp/blockT` and the same `board.json` file. Splitting it by
stage (e.g. "dev-stage.mjs" vs "qa-stage.mjs") would multiply the shared-state problem this
whole plan exists to avoid, for a file that's already just over the 500-line target — not worth
it. Leaving it as the one deliberately-oversized module, flagged rather than silently ignored.
**Deps:** `dashboard-core.mjs`, `usage.mjs` (`collectUsage`, board analytics cost), `lib/agent.mjs`
(`runAgent`).

### 20. `server/loush-runs.mjs` (~190 lines)
**Moves:** L5149–5329 (`projectDirs, loushSafe, eventsCache, normalizeEvent, readEvents,
runDir, asMs, computeVerdict, scanRuns, joinRunCost, /api/runs*`).
**Exports:** `scanRuns`, `projectDirs` (the latter also useful to `harness-library.mjs`'s team
repo scan, currently duplicated inline there via `readClaudeJson().projects` — leave the
duplication alone during the mechanical split; consolidating it is a separate, non-mechanical
cleanup).
**Feeds:** `RunsSection.jsx`.
**Deps:** `dashboard-core.mjs`, `usage.mjs` (`collectUsage`, cost join), `lib/agent.mjs`
(`runAgent`), `lib/run-verdict.mjs` (`verdictFrom`).

---

## What stays in `index.mjs` (target: ~350–400 lines)

- Imports (now importing ~20 new `server/*.mjs` files instead of inlining their logic; the
  import list gets *longer*, not shorter — this is expected and fine, it mirrors the existing
  `import mountEng from './eng.mjs'` style already at the top).
- The "TWO DATA PLANES" doc comment (L49–61) — it's the orienting comment for the whole file;
  keep it in `index.mjs` and consider copying a short pointer to it into `dashboard-core.mjs`.
- `const app = express()`, `securityMiddleware()`, `express.json()`, `installNetworkGuard` block
  (L73–87).
- All the `mount*(app, {...})` calls (existing ones plus ~18 new ones), in mount order.
- `companyToolsEnabled()`/`engineeringEnabled()` + `/api/features` (L121–162) — these gate which
  mounts happen, so they have to stay where the mounting happens.
- The response-cache middleware (`HEAVY_TTL`, `respCache`, L168–190) — it's generic
  path-based middleware registered once, before all routes; it does not need to move and doesn't
  care which file a route handler lives in. Any module that calls `respCache.clear()` today
  (`archive`, `/api/gov/team/baseline`) needs that capability passed in as a mount dep, e.g.
  `mountOverviewCapabilities(app, { clearRespCache: () => respCache.clear() })`.
- The final error-handling middleware, `app.listen(...)`, `publishInstance`, the boot-time
  `engSnapshot(true)` warm-up, `startScheduler(...)`, and the `SIGINT`/`SIGTERM` shutdown block
  (L5336–5358) — these are top-level side effects tied to process lifecycle; they must not move
  into a module that could theoretically be imported twice or in a different order.
- `/api/meta`, `/api/scheduler` (GET/PUT) — two one-line passthroughs, not worth a module.

Rough arithmetic: ~35 lines imports + ~90 lines two-planes comment/constants/app-setup + ~40
lines mount calls (existing) + ~40 lines new mount calls + ~40 lines feature flags + ~25 lines
response cache + ~25 lines error handler/listen/shutdown ≈ **300–350 lines**. Under the 400
target.

---

## Landmines

1. **Shared mutable module-level state is the main hazard, not circular imports per se.** Maps
   like `usageCache`, `failCache`, `scanCache`, `gitCache`, `teamTokCache`, `eventsCache`,
   `verifyResults`, `ciCache`, `chats`, `boardRuns`, `previews`, `mergeLocks`, `bisects`,
   `activeEvals`, `slackNotified` must each have exactly one owning module. Any other module that
   needs to read one (e.g. `inbox.mjs` reading `board.mjs`'s `boardRuns`) must import the Map (or
   an accessor) from the owner — never re-declare a `new Map()` with the same name in two files,
   which would silently split the cache into two and reintroduce the exact "two numbers that
   disagree on the same screen" bug class this codebase's own comments warn about elsewhere
   (see the `rollUpSubagents` comment at L878–892).

2. **Circular-import risk is real and specific, not generic.** The one converging point is:
   `board.mjs` ↔ `bugs.mjs` (bug creation writes a board ticket; nothing in board.mjs needs
   bugs.mjs back — safe, one direction). `harness-library.mjs` → `ci-quality.mjs` (recs need
   `reviewData`/`designDrift`) — confirm `ci-quality.mjs` never needs anything from
   `harness-library.mjs` back (it doesn't, per the read). `hub.mjs` → `harness.mjs` (one
   direction, safe). Keep dependency arrows one-directional; if a genuine two-way need shows up
   during implementation, the fix is the existing pattern — hoist the shared bit into a `lib/*`
   file, the same move already made for `lib/clone.mjs` and `lib/agent.mjs`.

3. **Top-level side effects that must not move:** the slack-notification `setInterval` (currently
   L4001–4011, → `inbox.mjs`) and the preview-idle-teardown `setInterval` (L4946–4950, →
   `board.mjs`) both start running the instant their module is imported. As long as each module
   is imported exactly once (via its single `mount*` call in `index.mjs`), this is fine — but it
   means these two modules are not safe to import for, say, a unit test that just wants a pure
   helper out of them, without also starting a timer. Note it; don't fix it as part of this split.

4. **`readJson()` and the temporal-dead-zone bug already documented in the file.**
   `companyToolsEnabled()`/`engineeringEnabled()` (L121–150) have a comment explaining they
   deliberately inline their own `readLocal()` instead of calling the real `readJson()`/
   `readClaudeJson()`, because those are `const` declarations later in the file and calling them
   from a function defined earlier hits the TDZ. Once `readJson`/`readClaudeJson` are real
   **imports** at the top of `index.mjs` (via `dashboard-core.mjs`), this hazard disappears —
   the TDZ only existed because of same-file ordering. Do not "fix" `companyToolsEnabled` to use
   the shared helper as part of this mechanical split (scope creep); just be aware the guard
   comment will become stale and could be revisited afterward.

5. **`engMod` lazy dynamic `import('./eng.mjs')`** (L3196–3198, L4335–4337, L4392) is a
   deliberate pattern to avoid a hard top-level cycle risk with `eng.mjs`, even though
   `index.mjs` already statically imports `eng.mjs` today. When this logic moves to `inbox.mjs`
   and `ci-quality.mjs`, keep the dynamic `import()` as-is in both places — do not "simplify" it
   to a static import.

6. **`HEAVY_TTL` cache keys are literal route path strings** (`/api/overview`, `/api/usage`,
   etc.). They must keep matching exactly regardless of which file now defines the handler for
   that path — Express doesn't care, but a future refactor renaming a route must update
   `HEAVY_TTL` in `index.mjs` too, which is easy to miss once the handler lives elsewhere. Worth
   a one-line comment in `index.mjs` pointing at this when the split lands.

7. **Import order inside `index.mjs` still matters for one thing:** `mountHooksReceiver(app)`
   must run before anything that reads `hooksReceiver.getLiveState()` (today: `/api/live`, moving
   to `projects-live.mjs`) is *called* — but since Express handlers are closures invoked at
   request time, not at mount time, this is actually fine as long as `hooksReceiver` itself is
   passed as a mount dependency and captured in the closure. No real ordering constraint here
   beyond "mount it and pass the returned object down" — flagging only because it looked like a
   hazard at first glance and is worth confirming false-alarm status during implementation.

---

## Suggested commit sequence

1. `dashboard-core.mjs` extraction (step 0). Zero behavior change. `npm test`.
2. `prompts.mjs` (fully self-contained, zero cross-module deps — cheapest possible first real
   cut, validates the mechanical process before tackling anything with fan-out).
3. `transcript-scan.mjs` (foundational for #4, #5, #17).
4. `usage.mjs` (depends on #3 only lightly — for `/api/sessions`).
5. `inventory.mjs`.
6. `overview-capabilities.mjs` (depends on #3, #5).
7. `insights.mjs` (depends on #3, #4).
8. `projects-live.mjs` (depends on #4).
9. `harness.mjs` (depends on #4).
10. `hub.mjs` (depends on #9).
11. `governance.mjs` (depends on #4, #9).
12. `chat.mjs`, `teams.mjs` (independent of each other and of everything above except core).
13. `bugs.mjs`, `board.mjs` together (mutually referencing — land in one commit or `board.mjs`
    first with `bugs.mjs` stubbed, then `bugs.mjs`).
14. `hooks-native.mjs`.
15. `ci-quality.mjs`.
16. `harness-library.mjs` (depends on #10, #15).
17. `loush-runs.mjs`.
18. `inbox.mjs` last (depends on #4, #11, #13, #15, #17 — the widest fan-in, so it can only be
    cut once everything it reads from already has a stable home).
19. `quick-utils.mjs` (depends on #5, #16).
20. Final pass: trim `index.mjs` to just imports + mounts + app bootstrap + shutdown; re-run
    `npm test` and manually hit `/api/features`, `/api/overview`, `/api/board`, `/api/inbox` to
    confirm the mount order still produces working responses (no automated route-smoke-test
    exists today per the repo's `test/` layout — this is a manual gate, note it doesn't need to
    become automated as part of this ticket, but flag the gap to whoever executes the plan).

Each numbered step: extract, add the new `mount*` call to `index.mjs`, delete the moved lines,
run `npm test`, commit. `test/server/eng-privacy.test.js`'s static assertion that `eng.mjs` never
imports `ticket.mjs` is the closest existing precedent for a test that would catch a wrong-way
import — worth adding an equivalent guard (e.g. `board.mjs` never imports `bugs.mjs`) once the
split is done, but that's a follow-up, not part of the mechanical move itself.

---

## What genuinely should NOT be split further

- **`board.mjs`** (~510 lines) — one state machine, argued above. Slightly over the 500-line
  target; better than fragmenting a single pipeline across files that would all need the same
  `readBoard/writeBoard/tkt/stamp/blockT` primitives passed around.
- **`inbox.mjs`** — not because it's large (it isn't, ~380 lines) but because its entire job is
  to summarize every other domain into one severity-sorted list. It will always have the widest
  import list in the tree; that's the shape of an aggregator, not a code smell to engineer away.
- The five one-off CRUD routes grouped into `quick-utils.mjs` — each is too small to justify its
  own file (`/api/pins` is 12 lines including both handlers), and none of them share logic with
  each other, so there's no "natural" sub-grouping to extract them into instead of one grab-bag.

---

# Split plan — server/eng.mjs, server/ticket.mjs, server/hooks-receiver.mjs, server/fe.mjs

Read in full. All four are mounted from `server/index.mjs` (5358 lines, out of scope) via:
```
import mountEng from './eng.mjs'            // mountEng(app)                       — line 88
import mountTicket from './ticket.mjs'       // mountTicket(app)                    — line 89
import { mountHooksReceiver, publishInstance, unpublishInstance } from './hooks-receiver.mjs'
                                              // mountHooksReceiver(app) at listen() — line 97, 5341, 5355
import mountFe from './fe.mjs'               // mountFe(app, { scanTranscripts, failStats, backup }) — line 100
```
`server/index.mjs` also dynamically `import('./eng.mjs')` three times at runtime (lines 3197, 4336, 4392) to reuse `snapshotAll`/`projectList`/(optionally)`ciHealth` without a fresh HTTP round trip — any rename of those exports breaks index.mjs silently (no static analyzer will catch it, it's an `engMod.foo` property read behind a `typeof === 'function'` guard).

Module convention observed in `server/`: each file's job is "mount routes for one API surface"; a `server/X.mjs` exports `default function mountX(app, deps)` plus whatever named helpers a sibling module legitimately reuses (e.g. `ticket.mjs` imports `ticketDetail, cfgFor, ...` from `eng.mjs`, and `buildImportGraph, SOURCE_EXTS, IGNORE_DIRS` from `fe.mjs`). Pure/config logic that doesn't touch Express lives in `lib/*.mjs` (`lib/eng-config.mjs`, `lib/eng-metrics.mjs`, `lib/adf.mjs`, `lib/paths.mjs`, `lib/design-schema.mjs`, `lib/agent.mjs`, `lib/clone.mjs`). Any split should keep that shape: pure logic → `lib/`, route wiring stays in `server/`.

---

## 1. server/eng.mjs (1599 lines) — SPLIT into 3 extractions + a leaner core

One line per concern, in file order:
- §0 projects config (33–108): `projects.json` load/save, `normalizeProject`, `loadProjects`, `upsertProject`, `projectList`, `cfgFor`/`cfgForTicket`/`firstProject` (the last three actually live at 1210–1214).
- working-time/percentile/story-point/status-model utils (110–174): thin wrappers over `lib/eng-config.mjs`, plus `ACTIVE`/`WAITING`/`DONE`/`kindOf`/`colorFor`.
- JIRA client + per-issue metrics (176–451): auth (`creds`, `acliProfile`, `jiraAuth`), `jira()`/`resolveFields`/`jiraIssues`, `statusSegments`/`computeIssue`/`recFor`, bug-ownership overrides.
- GitHub client (452–616): `gh`/`ghAvailable`/`ghLogin`/`whoAmI`, `prQuery`/`GQL`/`fetchPRs`, CI health (`ciFor`, `ciCache`).
- **Analytics** (618–985 + OKRS 1158–1188): `triage`, `reviewFlow`, `quality`, `investment`, `sprintStats`, `epicRollup`, `loadStats`, `OKRS`. All pure functions of `(issues, prs, members, ci)` — this is already the module's declared public API (see the named-export list at 1346).
- Snapshot cache/orchestration (987–1157, 1353–1370): disk persistence, `computeSnapshot`, `snapshotAll`, `snapFor`, `warmBoot`.
- **Ticket detail + AI artifact generation** (1190–1343): `ticketDetail`, `artifactsFor`/`reqHash`/`readArtifacts`/`writeArtifacts`, `genPrompt`/`claudeMarkdown`, HTML/ADF rendering.
- Routes (1371–1599): `mountEng(app)`.

This file is not "one job wearing a trenchcoat" — it is genuinely five distinguishable jobs (project config, JIRA client, GitHub client, delivery analytics, per-ticket AI generation) held together only by the fact that `computeSnapshot()` calls all of them once each. At 1599 lines a reader trying to check one metric formula (say, `sprintStats`) has to first get past two unrelated HTTP clients. That's the "hold too much at once" case the brief calls out — split it.

### Target layout

**`lib/eng-analytics.mjs`** (new, ~450 lines) — `triage`, `reviewFlow`, `quality`, `investment` (+ `DEFAULT_BUCKETS`/`effortBuckets`/`bucketOf`/`BUCKETS`), `sprintStats` (+ `sprintNamesAt`), `epicRollup`, `loadStats`, `OKRS`, plus the triage/epic-target stores they read (`readTriage`/`writeTriage`/`TRIAGE_FILE`, `readEpicTargets`/`writeEpicTargets`/`EPIC_FILE` — these move *with* the functions that read them, since `triage()` calls `readTriage()` and `epicRollup()` calls `readEpicTargets()` internally; `writeTriage`/`writeEpicTargets` are only called from `mountEng`'s routes, so they need to be exported back).
  - Imports `escapeRateSeries`/`estAccuracy`/`busFactor` directly from `lib/eng-metrics.mjs` (not via eng.mjs).
  - **Landmine**: `triage`/`epicRollup`/`loadStats` currently close over `workDays`/`addWorkTime`/`offHours`/`isWeekend`/`weekKey`/`WORKDAY_MS_OF`, which are eng.mjs-local wrappers around `lib/eng-config.mjs`'s `*With(work, …)` functions bound to a live `WORK()` accessor (`engCfg().work`, itself backed by `PROJECTS_FILE`). Do **not** import these wrappers back from `eng.mjs` — that creates a cycle (`eng.mjs` → `lib/eng-analytics.mjs` → `eng.mjs`). Instead, `lib/eng-analytics.mjs` imports the `*With` functions and `loadEngConfig`/`PROJECTS_FILE` directly (same imports `eng.mjs` already has at the top) and re-derives its own 6-line `WORK()`/`workDays`/etc. accessor — a small, deliberate duplication, not a shared closure.
  - `eng.mjs` then does `export { triage, reviewFlow, quality, investment, sprintStats, epicRollup, loadStats, readTriage } from '../lib/eng-analytics.mjs'` so the existing public export list (line 1346) and `test/server/eng-privacy.test.js` (which imports these seven names straight from `server/eng.mjs` and asserts no plane-B field ever appears in their output) keep working with **zero test changes**.

**`server/eng-github.mjs`** (new, ~165 lines) — `BOT`, `gh`/`ghAvailable`/`ghLogin`, `prQuery`/`GQL`/`ghCommandFor`/`reviewerLogin`/`fetchPRs`, `ciFor`/`ciCache`/`CI_FILE_TTL`/`ghJSON`.
  - **Landmine**: `ciCache` is read/written directly by `eng.mjs`'s disk-persistence code (`loadDisk`/`persistDisk`, lines 1016 & 1024: `ciCache.set(k, …)`, `pick(ciCache)`). Export `ciCache` itself (not just `ciFor`) so the snapshot-cache section in `eng.mjs` can still reach into it.
  - **Landmine**: `whoAmI()` (471–484) is a *composite* of both clients — it calls `ghLogin()` (moves) and `jira(await jiraAuth(firstProject()), '/myself')` (stays). Leave `whoAmI` itself in `eng.mjs` core; it becomes a 10-line function that imports `ghLogin` from the new file. Don't try to relocate it into either client.
  - `GQL` is read by `computeSnapshot`/`snapshotAll` for the `provenance.graphql` field — export it and import back into core.

**`server/eng.mjs`** (core, remaining ≈ 980 lines) — projects config, working-time/status utils, JIRA client + per-issue compute, ticket detail + AI generation, snapshot cache/orchestration, routes. Still the biggest file after the split, but it is now one coherent story — "fetch JIRA, fetch GitHub (via the extracted client), compute analytics (via the extracted lib), cache it, serve it" — rather than five unrelated ones.

### Extraction order (each step independently committable)
1. `lib/eng-analytics.mjs` — pure functions, zero shared mutable state with the rest of the file beyond the triage/epic-target JSON stores that move with them. Lowest risk, highest value (this is the piece a reader actually wants isolated).
2. `server/eng-github.mjs` — export `ciCache` alongside `ciFor`/`GQL`; update `eng.mjs`'s `loadDisk`/`persistDisk`/`computeSnapshot`/`snapshotAll` to import from it. Verify `test/server/eng-privacy.test.js` still passes unmodified (it should — it never touches GitHub-specific code).
3. *(Optional, lower priority, not recommended unless the team wants to push further)*: pulling `ticketDetail`+artifact-generation out is tempting (it has its own comment banner and its own export line at 1351 for `ticket.mjs`'s benefit) but `ticketDetail`/`snapWarm` read the snapshot cache's `snaps` Map and call `refresh()` directly — extracting it verbatim creates a cycle back into `eng.mjs` (core needs `ticketDetail`, `ticketDetail` needs `snaps`/`refresh` from core). Doing this properly means threading `{ snaps, refresh, SNAP_TTL }` in as parameters, which is a real code change, not a mechanical move — skip it unless eng.mjs's size keeps growing.

### Landmines specific to eng.mjs
- `FIELDS` (per-project JIRA custom-field cache, `Map`), `snaps` (the 2h snapshot cache with disk persistence), `ticketCache`, and `ciCache` are four separate module-level mutable caches. Each invalidation site (`POST /api/eng/projects`, `PUT /api/eng/projects/:key`, `POST /api/eng/creds`, bug-ownership edits, epic-target edits, JIRA transitions) touches 1–2 of them by hand (`snaps.delete(key); FIELDS.delete(key)`, etc.) — there is no single "invalidate everything for project X" helper. Any refactor must preserve every one of these call sites exactly; grep for `.delete(` / `.clear(` before touching cache ownership.
- `snaps` is a subclassed `Map` (`delete`/`clear` overridden to `queueMicrotask(persistDisk)`) — do not replace it with a plain `Map` during a refactor, that silently breaks disk persistence.
- `test/server/ticket.test.mjs` does two raw-source `fs.readFileSync('server/eng.mjs')` regex checks (no banned import of `lib/agent.mjs`/`lib/clone.mjs`; the exact `const cfgFor = key => { const k = String(key ?? '').toUpperCase(); … }` line). Keep `cfgFor` physically in `server/eng.mjs` (don't move it to a satellite file) or update that test in the same commit.
- `test/server/eng-privacy.test.js` is behavioral, not source-regex — safe against internal reorganization as long as the seven analytics functions keep the same names/shapes.
- `index.mjs`'s three `engMod ||= await import('./eng.mjs')` call sites read `engMod.snapshotAll`, `engMod.projectList`, `engMod.ciHealth` off the *default namespace object* — as long as `eng.mjs` keeps re-exporting these names (directly or via `export … from`), this keeps working untouched.

---

## 2. server/ticket.mjs (1170 lines) — LEAVE ALONE (borderline; the honest reason is the test suite, not the code)

The file bundles three phases of one feature ("the key-first Ticket section"): (a) ticket fetch/state/workspace management, (b) AC/test generation via `claude -p`, (c) the design/diagram sub-feature (graph editing, SSE-streamed agent runs, chat-proposes-ops, mermaid export, files verification). (b) and (c) share a single concurrency budget (`MAX_CONCURRENT = 2`, one `runs` Map, one `inFlight()`) — a design run and a generation run compete for the same two slots — so they are not cleanly independent even though they feel like separate features.

That alone would tip me toward recommending a split (design is the natural seam, ~470 lines: `designPrompt`, `indexRepo`, `isIgnored`, and every `/api/ticket/:key/design/*` + `/api/ticket/:key/files` route). What changes the recommendation is **`test/server/ticket.test.mjs`**: it contains **~20 separate `fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')` calls**, each asserting a regex against the raw source text — covering both halves of the file (staging-path promotion, the `pending`-vs-`graph` regeneration gate, the board-handoff two-way link, the chat route's session-pointer-only write, `cfgFor` coercion, the design prompt's citation requirements, etc.). This is a legitimate but *file-path-coupled* test style: it doesn't care what the code does, it cares that specific fragments exist verbatim in `server/ticket.mjs`. Moving the design routes to a new file would break something like 12–15 of these assertions, each needing its `readFileSync` target repointed to match wherever the corresponding code actually landed — a mechanical but error-prone chore roughly the same size as the split itself, for a file that (unlike `eng.mjs`) is still one narrative rather than several unrelated ones.

**Verdict: leave alone.** If `ticket.mjs` keeps growing and this gets revisited, the design sub-feature (routes at lines 690–1136, `runs`-map machinery at 314–398, `designPrompt` at 415–459, `indexRepo`/`isIgnored` at 1139–1170) is the correct seam — but budget the test-file rewrite as part of the same change, not an afterthought, and note that `MAX_CONCURRENT`/`inFlight`/`runs` would need to move to a small shared module (e.g. `lib/ticket-runs.mjs`) imported by both the generation route (stays) and the design routes (move), since they share one concurrency budget.

### Landmines noted for the record (not actioned)
- `resolve`/`resolveWs` (470–510) are defined as closures inside `mountTicket` but never reference `app` — they could be hoisted to module scope and exported today with no behavior change, which would be a prerequisite for ever splitting the design routes out.
- `ticket.mjs` already imports `buildImportGraph, SOURCE_EXTS, IGNORE_DIRS` from `./fe.mjs` (one server route file importing from a sibling route file, bypassing `lib/`). Pre-existing, not introduced by this analysis — worth a mention if `fe.mjs`'s pure helpers ever move to `lib/`, since `ticket.mjs`'s `indexRepo` (1139–1164) duplicates `fe.mjs`'s `walkRepo`/`buildImportGraph` join in a sync (not async) form.

---

## 3. server/hooks-receiver.mjs (706 lines) — SPLIT into 2 (clean, low-risk)

The file's own comments say it outright: "The only fs use in this module is the port registry at the bottom" and the top-level imports (`fs`, `os`, `path`) are declared **mid-file at line 619**, immediately before the port-registry section starts — not at the top of the file, because the hook-ingest half (lines 1–580) uses none of them (by design: the trust-boundary section states `node:child_process is not imported at all` and no field ever touches the filesystem). That is about as clear a "two unrelated jobs, physically adjacent" signal as a codebase can give.

- **Job A** (1–580): live hook-event ingest — sanitizing/whitelisting/rate-limiting an unauthenticated POST endpoint, an in-memory session store, the live-view GET, `mountHooksReceiver(app)`.
- **Job B** (582–706): a `~/.claude/loush-dashboard-instances.json` registry so the hook script (spawned with no knowledge of which port the dashboard is on) can discover it — `publishInstance`/`unpublishInstance`/`readInstances`/`resolveTargets`.

No shared state between them (verified: Job A never references `instancesFile`/`publishInstance`/etc.; Job B never references `store`/`sessions`). Zero risk beyond updating import sites.

### Target
**`lib/dash-instances.mjs`** (new, ~125 lines) — everything currently at lines 619–706 (`DEFAULT_DASH_PORT`, `MAX_INSTANCES`, `claudeDir`, `instancesFile`, `readInstances`, `publishInstance`, `unpublishInstance`, `resolveTargets`), verbatim.

`server/hooks-receiver.mjs` keeps everything else (~580 lines — still a touch over 500, but it's one job; not worth fragmenting further).

### Extraction order
1. Move lines 582–706 to `lib/dash-instances.mjs` unchanged (including its local `fs`/`os`/`path` imports).
2. Update the three call sites:
   - `server/index.mjs` (line 19): `import { mountHooksReceiver } from './hooks-receiver.mjs'` + `import { publishInstance, unpublishInstance } from '../lib/dash-instances.mjs'`.
   - `scripts/hook-handler.mjs` (line 50): `import { resolveTargets } from '../lib/dash-instances.mjs'`. This is a genuine improvement, not just a rename — today a standalone script depends on a `server/` module, which is backwards; moving the registry to `lib/` fixes that layering smell as a side effect.
   - `test/server/hooks-receiver.test.mjs` (lines 4–8): split its one `import { … } from '../../server/hooks-receiver.mjs'` into two imports, one per file (`resolveTargets`, `DEFAULT_DASH_PORT`, `MAX_INSTANCES` move to the `lib/dash-instances.mjs` import; everything else stays).
3. Delete the now-dead `fs`/`os`/`path` imports from `hooks-receiver.mjs` — after the move, the remaining file should have zero filesystem imports, which is a nice confirmation the split is clean (it also makes the trust-boundary comment at the top of the file literally true again, rather than "true except for the bit at the bottom").

### Landmine
- `test/server/hooks-receiver.test.mjs` imports both halves from one line today — must not be forgotten when moving; it's the only test file that reaches into these internals (`normalizeEvent`, `applyEvent`, `resolveTargets`, etc.).

---

## 4. server/fe.mjs (577 lines) — LEAVE ALONE

577 lines is only ~15% over the ~500 target, and the file is a single, well-scoped feature ("join agent transcript history to the codebase's import graph") that is already internally organized with its own section banners: pure helpers (1–320: `classify`, `extractImports`, `resolveSpecifier`, `buildImportGraph`, `reworkScore`, `aggregateFiles`, `coverageOf`, `isOrphanCandidate`, `buildTimeline`, `contextBundle` — all exported, all reused by `test/server/fe-workingset.test.js` directly) vs. IO/mount (322–577: `walkRepo`, git-dirty check, `mountFe(app, deps)`). That internal seam already gives a reader the option to read only the half they need; there's no reason to force it into two files for a 77-line overage.

**Verdict: leave alone.** One thing worth flagging rather than acting on: `server/ticket.mjs` imports `buildImportGraph, SOURCE_EXTS, IGNORE_DIRS` straight from `server/fe.mjs` (see §2 above) instead of from a `lib/` module — if `fe.mjs`'s pure-helpers half ever does get extracted (e.g. because a third consumer shows up), that's the moment to also fix `ticket.mjs`'s import to point at the new `lib/` location instead of leaving a `server/` → `server/` cross-import in place.

---

## Summary

| file | verdict | why |
|---|---|---|
| `server/eng.mjs` (1599) | split into 3 (extract `lib/eng-analytics.mjs`, `server/eng-github.mjs`; core ~980 lines) | 5 distinguishable jobs (project config, JIRA client, GitHub client, analytics, AI ticket-detail) glued only by one orchestration call; analytics extraction is pure & already named-exported, GitHub client is a distinct external system |
| `server/ticket.mjs` (1170) | leave alone | genuinely one feature (fetch→generate→design), and `test/server/ticket.test.mjs` hard-couples ~20 regex assertions to this exact file path across its whole breadth — splitting costs as much as it saves unless the test file is rewritten in lockstep |
| `server/hooks-receiver.mjs` (706) | split into 2 (extract `lib/dash-instances.mjs`, ~125 lines) | the file's own comments and its mid-file import statement already mark two unrelated jobs (unauthenticated event ingest vs. a port-discovery file registry) with zero shared state |
| `server/fe.mjs` (577) | leave alone | one cohesive feature, only ~15% over target, already internally organized into pure-helpers vs. IO |

**Biggest risk overall**: source-text-regex tests (`test/server/ticket.test.mjs`'s ~20 `readFileSync` assertions, plus 2 in the same file targeting `server/eng.mjs`) that assert exact code fragments exist in a specific file path. Any code motion — even a change nobody would call "the split" — has to be checked against these before it's mechanical. That's the concrete reason `ticket.mjs` is left alone despite its size, and the concrete reason `eng.mjs`'s `cfgFor` line has to stay put even though it would otherwise be a natural fit for a projects-config module.

---

# Split plan — lib/ files >500 lines

Method: read each file fully, grepped `server/`, `src/`, `lib/`, `test/` for importers. All seven
files have exactly one test file (`test/lib/<name>.test.mjs`, plus `complexity-calibration.test.mjs`
for complexity.mjs) and are imported from at most one server module (`server/index.mjs`, except
`todos.mjs` which is also imported by `server/todos.mjs` and, transitively, by the browser via
`src/lib/todos.js`'s `export * from '../../lib/todos.mjs'`).

Verdicts: 2 split, 5 leave alone.

---

## 1. lib/freeze-audit.mjs (1054 lines) — LEAVE ALONE

**Importers:** `server/index.mjs` imports only `auditRepo`. `test/lib/freeze-audit.test.mjs` imports
nearly everything: `ITEMS, CHECKS, CATEGORIES, STACK_TAGS, STATUSES, MANUAL_REASONS, SCAN_LIMITS,
applicableItems, auditRepo, verdictFor, envExampleKeys`.

**Why leave it alone:** the file *is* one job — run the freeze-audit checklist against a checkout —
built from a checklist table (`ITEMS`, ~100 lines, a verbatim port of an upstream MIT-licensed
75-item list, license/attribution in the header) and ~30 small check functions each tied to an
`itemId`, joined by `auditRepo`. The header explicitly frames it as "two things live here" but they
are not independent: `runCheck`/`auditRepo` fold check results back onto `ITEMS` by id on every call,
and the checklist is meaningless without the checks that verify it. Most of the 1054 lines is
deliberate prose (every check documents *why* it returns `manual`/`unknown`/`partial` rather than a
false pass) — the actual logic per check is 5–15 lines. Splitting `ITEMS` into its own file would be
low-risk (it's pure data) but buys nothing: `applicableItems`/`auditRepo` need it immediately, the
license attribution would have to travel with it, and the test file already reaches into both halves
together. Not worth the file-count increase.

**If it ever needs to happen:** extract `ITEMS`, `CATEGORIES`, `STACK_TAGS`, `applicableItems` (lines
98–197) verbatim into `lib/freeze-audit-items.mjs` (carries the upstream license note), have
`freeze-audit.mjs` import and re-export them. Zero test changes since the facade path is unchanged.
Not recommended now.

**Landmines:** the `ITEMS` text is upstream-licensed verbatim ("port, not source" — item *text* must
not be edited). `SCAN_LIMITS` bounds are referenced by three different checks; don't let a future
split duplicate them out of sync.

---

## 2. lib/event-grouping.mjs (886 lines) — SPLIT into 3

**Importers:** `server/index.mjs` imports only `groupEvents`. Test imports:
`summarizeToolCall, firstEnclosingContext, countHunks, groupEvents, parseShellHeadline, shortPath`.

**Why split:** the file bundles three genuinely unrelated algorithms that only share the fact that
`groupEvents` calls into two of them:
  1. **Per-tool-call rendering** — `RENDERERS` dispatch table (Read/Edit/Bash/Grep/…, lines 310–526),
     `parseShellHeadline`, `shortPath`, `urlHost`, `clip`/`bytes`/`countLines`, `summarizeToolCall`,
     `extractToolUseBlock`. Job: "describe one tool call as a title/summary/detail". ~230 lines.
  2. **Diff-context matching** — `DECLARATION_PATTERNS`, `NOT_A_NAME`, `declarationName`,
     `normalizeHunk`, `firstEnclosingContext`, `countHunks`. Job: "given a diff hunk, guess the
     enclosing function name, or admit you can't." Completely different domain (regex-matching
     source-code declarations across ~6 languages) from (1) or (3). ~150 lines.
  3. **The grouping/collapsing engine** — `groupEvents`, `collapseItems`, `blocksOf`, `resultIdOf`,
     `parentIdOf`, `targetOf`, `roleOf`. Job: "turn a flat transcript into a nested, deduplicated
     timeline." ~260 lines.

This is exactly the "parsing + scoring + formatting bundled together" shape the brief calls out: (1)
is a formatter, (2) is a pattern-matching parser, (3) is a grouping/aggregation engine. They compose
(groupEvents calls summarizeToolCall and firstEnclosingContext) but don't need to live in one file.

**Target paths / what moves:**
- `lib/tool-call-summary.mjs` — lines ~41–56 (`clip`), 60–68 (`shortPath`), 70–77 (`bytes`,
  `countLines`), 85–125 (`SUBCOMMAND_BINARIES`, `parseShellHeadline`), 127–135 (`urlHost`), 294–521
  (`extractToolUseBlock`, `needle`, `RENDERERS`, `summarizeToolCall`). Exports: `shortPath`,
  `parseShellHeadline`, `SUBCOMMAND_BINARIES`, `extractToolUseBlock`, `summarizeToolCall`.
- `lib/diff-context.mjs` — lines 154–260 (`NOT_A_NAME`, `MODIFIERS`, `DECLARATION_PATTERNS`,
  `declarationName`, `normalizeHunk`, `firstEnclosingContext`), 264–280 (`countHunks`). Exports:
  `firstEnclosingContext`, `countHunks`.
- `lib/event-grouping.mjs` (facade, ~300 lines) — keeps `groupEvents`, `collapseItems` and the small
  private helpers (`blocksOf`, `resultIdOf`, `parentIdOf`, `targetOf`, `roleOf`), imports
  `summarizeToolCall` from `tool-call-summary.mjs` and `firstEnclosingContext`/`countHunks` from
  `diff-context.mjs`, and re-exports `summarizeToolCall`, `firstEnclosingContext`, `countHunks`,
  `parseShellHeadline`, `shortPath` so every current import path (server + test) is unchanged.

**Extraction order:** `diff-context.mjs` first (no dependencies on anything else in the file), then
`tool-call-summary.mjs` (also self-contained), then wire `event-grouping.mjs` to import both and
re-export. One-way dependency graph, no cycle risk: the two leaf modules never import from the
facade.

**Landmines:** `MAX_NEEDLE`/`MAX_PREVIEW` belong to tool-call-summary only; `MAX_SCAN_LINE` belongs to
diff-context only — no constant is actually shared between the three concerns, which is what makes
this split cheap. `RENDERERS.Bash_tool = RENDERERS.Bash` etc. aliasing must move with the RENDERERS
table. Test file imports all six functions directly from `event-grouping.mjs` — as long as the facade
re-exports them, **no test changes needed**.

---

## 3. lib/lessons.mjs (800 lines) — SPLIT into 2

**Importers:** `server/index.mjs` imports `deriveLessons, SIGNALS`. Test imports:
`LESSON_STATUS_IDS, SIGNALS, DEFAULT_DERIVE_OPTS, validateLesson, normalizeEvidence, serializeLesson,
parseLessonsJsonl, deriveLessons`.

**Why split:** two distinct jobs, cleanly separated by the file's own section banners:
  1. **Schema / validation / serialization** (lines 1–280): `LESSON_STATUSES`, `LESSON_FIELDS`,
     `normalizeEvidence`, `validateLesson`, `serializeLesson`, `parseLessonsJsonl`. This is "what is a
     valid lesson record and how do you read/write one as JSONL" — no transcript-analysis logic at
     all.
  2. **Derivation** (lines 281–800, the file's own "the valuable half"): `DECLINE_PATTERNS`,
     `CORRECTION_STRONG/WEAK`, `SIGNALS`, `DEFAULT_DERIVE_OPTS`, `jaccard`, `deriveLessons` and its
     four signal passes. This is a transcript-mining engine that happens to *produce* objects the
     schema half can validate.

Same shape as event-grouping: a data model + an analysis engine that only touch at one call
(`deriveLessons` calls `validateLesson` once per candidate, at the very end, to build the final
object). 520 of the 800 lines are the derivation engine; the schema half is genuinely reusable on its
own (e.g. a "human writes a lesson by hand" UI would only need `validateLesson`/`serializeLesson`,
never the signal-detection heuristics).

**Target paths / what moves:**
- `lib/lessons.mjs` (facade, keeps schema — lines 1–280): `LESSON_STATUSES`, `LESSON_STATUS_IDS`,
  `LESSON_FIELDS`, `LESSON_META_FIELDS`, `normalizeEvidence`, `validateLesson`, `serializeLesson`,
  `parseLessonsJsonl`, plus the tiny shared predicates `isObj`/`isStr`/`trimmed`/`isIsoish`.
- `lib/lessons-derive.mjs` — lines 285–800: `DECLINE_PATTERNS`, `CORRECTION_STRONG`,
  `CORRECTION_WEAK`, `EDIT_TOOLS`, `SIGNALS`, `DEFAULT_DERIVE_OPTS`, `jaccard`/`tokens`, `blocksOf`,
  `userText`, `resultText`, `targetOf`, `deriveLessons`. Imports `validateLesson` (and `isIsoish` — see
  landmine below) from `lib/lessons.mjs`.
- `lessons.mjs` re-exports `SIGNALS`, `DEFAULT_DERIVE_OPTS`, `deriveLessons` from
  `lessons-derive.mjs` so `server/index.mjs`'s and the test's import paths are unchanged.

**Extraction order:** move the schema half first (it has zero outgoing dependencies on the derivation
half), then move derivation and point its one import (`validateLesson`) back at `lessons.mjs`.
One-way dependency (derive → schema), no cycle.

**Landmines:** `isObj`/`isStr`/`isIsoish`/`trimmed` are private one-line helpers used in *both*
halves. Don't invent a shared-utils file for four one-liners — either duplicate them in
`lessons-derive.mjs` (recommended: they're stable and trivial) or export them as an internal (not part
of the tested public API) surface from `lessons.mjs`. `DECLINE_PATTERNS` is calibrated against
verbatim strings observed in real transcripts on this machine (documented in the header) — must not
be "cleaned up" while moving. The evidence-grounding rule ("a lesson with no evidence is never
emitted") is enforced in the derive half's final assembly loop — make sure the split doesn't let a
future edit route a candidate around `validateLesson`.

---

## 4. lib/security-findings.mjs (722 lines) — SPLIT into 2

**Importers:** `server/index.mjs` imports `parseResultsJson, applyFilters, hardExclusionRules`. Test
imports: `parseResultsJson, parseReviewComments, hardExclusionRules, applyFilters, fileExtension,
findingKey, REVIEW_COMMENT_MARKER, PRE_SEEDED_REACTION_BASELINE`.

**Why split:** the file's own header says it plainly: "Two pure parsers plus a client-side noise
classifier." That's three things, and unlike `capability-provenance.mjs` (below) there is no "they
all read the same bytes" reason to keep them together — the classifier (`applyFilters`) explicitly
operates on an already-normalized finding array from *either* source, or from a caller's own
unfiltered set ("re-run noise suppression locally... with the user's own choices rather than one
vendor's"). Checked actual coupling: `fileExtension` is used *only* by the classifier's `RULES`
table; `findingKey`/`normalizeFinding` are used *only* by the two parsers. The two halves don't call
into each other at all — they're independent pipeline stages glued together only by both operating on
"a finding."

**Target paths / what moves:**
- `lib/security-findings.mjs` (facade + ingestion, ~500 lines): shared helpers (`isObj`, `str`, `num`,
  `excerpt`, `malformedEntry`), `findingKey`, `normalizeFinding`, `normalizeFilterStats`,
  `normalizeExcludedRecord`, `parseResultsJson`, `LABELS`, `labelValue`, `parseReviewComments`,
  `FAIL_OPEN_SIGNATURES`, `REVIEW_COMMENT_MARKER`, `PRE_SEEDED_REACTION_BASELINE`,
  `ID_DESCRIPTION_CHARS`, `MAX_RAW_EXCERPT`.
- `lib/security-findings-filter.mjs` (~220 lines): `C_LIKE_EXTENSIONS`, `fileExtension`, `RULES`,
  `hardExclusionRules`, `applyFilters` — including the full Anthropic MIT license block that
  currently sits at the top of `security-findings.mjs` (lines 9–39), which must move with
  `hardExclusionRules`/`RULES` since that's the code it's attributing.
- `security-findings.mjs` re-exports `hardExclusionRules`, `applyFilters`, `fileExtension` from the
  new filter module so every import path (server + test) is unchanged.

**Extraction order:** filter module first (it has zero dependency on the parsers), then wire the
facade to import and re-export from it.

**Landmine — avoid a real circular import:** `applyFilters`'s returned `bounds` object echoes
`ID_DESCRIPTION_CHARS`/`MAX_RAW_EXCERPT`, which conceptually belong to the parse half. Do **not**
have the filter module import them back from the facade (facade → filter → facade is a real ESM
cycle, fragile even though technically supported) — just redeclare the two numeric literals in
`security-findings-filter.mjs` with a one-line comment tying them to the facade's constants. Two
numbers, low risk of drift, avoids the cycle entirely.

**Other landmine:** the "port, not diffed character-for-character" honesty note about
`hardExclusionRules` (the regex bodies are reconstructed from a research doc, not verified against
upstream byte-for-byte) must travel with the rule table, not get lost in the move.

---

## 5. lib/complexity.mjs (664 lines) — LEAVE ALONE

**Importers:** `server/index.mjs` imports `classifyConversation, tierDistribution`.
`test/lib/complexity.test.mjs` and `test/lib/complexity-calibration.test.mjs` between them import
essentially the whole surface: `DIMENSIONS, DIMENSION_COUNT, TIERS, TIER_RANK, TIER_ANCHOR,
BOUNDARIES, CONFIDENCE, MOMENTUM_WEIGHT, MAX_SCAN_CHARS, WEIGHT_BUDGET, tierFor, boundaryDistance,
computeConfidence, maxTier, scoreTurn, classifyConversation, tierDistribution`.

**Why leave it alone:** this is a single scorer with one job (score a turn's complexity, 0..1, into a
tier) whose own design principle is "every dimension is inspectable" — the 32-entry `DIMENSIONS`
table, the `BOUNDARIES`/`CONFIDENCE`/`TIER_ANCHOR` constants, and `scoreTurn` are calibrated *together*
(the file's comments explicitly cross-reference each other: BOUNDARIES was refit against a labelled
fixture set, CONFIDENCE was then re-derived "alongside BOUNDARIES", TIER_ANCHOR "is chosen ... using
`BOUNDARIES.simpleMax`"). Splitting the dimension table from the scoring loop would separate values
that must change in lockstep. The heavy prose (rationale for every weight and threshold) accounts for
much of the 664 lines, not logic bulk. Nothing here is multiple unrelated concerns — it's one
concern, extensively justified.

**Landmines (for whoever touches this file, split or not):** `BOUNDARIES`, `CONFIDENCE`, and
`TIER_ANCHOR` are calibrated as a set against `test/fixtures/complexity-labelled.mjs` — changing any
`DIMENSIONS` weight invalidates all three and requires rerunning the calibration test.

---

## 6. lib/todos.mjs (624 lines) — LEAVE ALONE

**Importers:** `server/todos.mjs` imports 13 exports (`STATUSES, STATUS_IDS, PERIODS, isStatus,
dayKey, isDayKey, dayStart, dayEnd, normalizeTodo, applyPatch, partitionByDate, dayStats, groupByPath,
suggestFromActivity, normalizeRel, rollForward, insights, timeInStages, carriedDays`). `src/lib/todos.js`
does `import { dayKey, isDayKey } from '../../lib/todos.mjs'; export * from '../../lib/todos.mjs'` —
i.e. the whole module is re-exported to the browser. `src/ui/todoParts.jsx` reaches directly for
`progressOf, statusMeta, stepStatus, humanMs, timeInStages`; `src/ui/TodoDock.jsx` and
`TodosSection.jsx` reach for the day-key/status helpers. Test imports nearly the full surface (~29
exports) in one file.

**Why leave it alone:** the header states the design intent directly — three consumers (Express
route, full-screen board+tree, floating drawer, two of which are browser-side) need the *same* answer
to "what stage/day/directory does this belong to," so the model is deliberately one dependency-light
file imported identically by server and client. The sub-sections (stages, day-keys, path-utils,
record CRUD, views, activity-suggestion join, roll-over, stage-timing, period insights) look like
many concerns, but the boundary that would matter most — "client-safe" vs "server-only" — doesn't
line up cleanly: `timeInStages`/`humanMs` (nominally "analytics") are used directly by the client's
`todoParts.jsx`, while `insights`/`suggestFromActivity` (also "analytics") are server-only in
practice (the client calls `todoApi.insights()`, an HTTP endpoint, never the function). A split along
either axis would either separate genuinely coupled code (day-keys are used by literally everything)
or produce two files with no clean client/server line. The single test file exercising ~29 exports
together also reads as "this is one unit," not "these are accidentally glued."

**Worth flagging separately (not a lib split, a different cleanup):** `src/lib/todos.js`'s
`export * from '../../lib/todos.mjs'` re-exports server-analytics functions
(`suggestFromActivity`, `rollForward`, `insights`) into the client bundle's module graph. Whether that
actually ships extra bytes depends on whether Vite/Rollup tree-shakes the unused named exports —
worth a bundle-analyzer check, but that's a bundling question, not a reason to fragment the lib file.

**If this file keeps growing:** the cleanest future seam, if ever needed, is `insights` +
`periodRange` + the `stageIntervals`/`stageDurations` pair (the period-rollup/analytics report, ~180
lines, lines 391–624) into `lib/todos-insights.mjs`, since `insights()` alone is the single largest
function (~110 lines) and the most report-shaped (day/week/month aggregation) rather than
record-shaped. Not warranted today.

---

## 7. lib/capability-provenance.mjs (593 lines) — LEAVE ALONE

**Importers:** `server/index.mjs` imports `detectFramework, lintFrontmatter, declaredDependencies,
checkDependencies` (not `analyzeCapability` — the server composes the four pieces itself). Test
imports nearly everything: `detectFramework, lintFrontmatter, declaredDependencies, checkDependencies,
analyzeCapability, expectedNameFromPath, namespacedName, normalizeDependencyName, parseFrontmatter,
HEAD_SCAN_LINES, MAX_SCAN_BYTES`.

**Why leave it alone:** the file's own header gives the strongest possible justification for staying
one module: "built as one module because all three [features 115/116/117] read the same bytes."
Unlike `security-findings.mjs`, where the parse and filter stages never call each other, here
`analyzeCapability()` genuinely composes framework-attribution + frontmatter-lint + dependency-check
over a *single* file read, and `detectFramework`/`lintFrontmatter` both need the same
`parseFrontmatter()` / path-segment helpers (`expectedNameFromPath`, `segments`, `stripSuffixes`,
`slug`). Splitting would mean either duplicating those shared primitives three times or introducing
exactly the kind of cross-file wiring the author explicitly chose not to do. At 593 lines it's barely
over the threshold, and a large fraction is the (correctly cautious) "never invent a fact" commentary
per feature. No split warranted.

**Landmines:** `FM_DELIM` (the frontmatter delimiter regex) is declared "byte-for-byte" identical to
`server/index.mjs`'s own `parseFM` on purpose — if `server/index.mjs` is ever refactored to import
this module's `parseFrontmatter` instead of keeping its own copy, that's a separate, larger change
than anything in scope here.

---

## Summary table

| file | verdict | reason |
|---|---|---|
| freeze-audit.mjs | leave alone | one audit engine; ITEMS+CHECKS are joined by id on every call |
| event-grouping.mjs | **split into 3** | formatter + diff-parser + grouping-engine, no shared constants |
| lessons.mjs | **split into 2** | schema/serialization vs. transcript-mining engine, one-way dependency |
| security-findings.mjs | **split into 2** | header says "two parsers + a classifier"; classifier never called by parsers |
| complexity.mjs | leave alone | one scorer; constants calibrated together, would break if separated |
| todos.mjs | leave alone | deliberately one shared model for 3 consumers; no clean client/server line |
| capability-provenance.mjs | leave alone | explicitly "one module because all three read the same bytes" |

All four proposed new files (`tool-call-summary.mjs`, `diff-context.mjs`, `lessons-derive.mjs`,
`security-findings-filter.mjs`) are consumed only via facade re-exports from their current entry
point, so **no test file needs to change** for either split.

---

# Split plan — src/ large files (read-only analysis, no edits made)

Conventions observed before proposing anything:
- Big sections that grew a genuinely separate sub-feature get a **sibling top-level directory**
  named after the domain, not a nested folder under `src/sections/`: `src/ticket/` holds
  `DesignCanvas.jsx`, `DesignChat.jsx`, `RederivePreview.jsx`, `useGraphEditor.js`, `tidy.js` for
  `TicketSection.jsx`; `src/eng/` holds ~20 files (`AttentionQueue.jsx`, `ReviewFlow.jsx`,
  `Quality.jsx`, `MemberInsights.jsx`, `ui.jsx`, `charts.jsx`, `stats.js`, `urlState.js`, …) for
  `EngDashboard.jsx`; `src/company/` holds four sibling section files.
- `src/ui/*.jsx` (`Drawer`, `Palette`, `tabs.jsx`, `todoParts.jsx`, `planWidgets.jsx`, `charts.jsx`,
  `Skeleton.jsx`, `TodoDock.jsx`, `anim.jsx`, `viewers.jsx`) is reserved for components with a
  **second real caller today** — nothing is pre-emptively promoted there.
- `src/eng/ui.jsx` is the shared presentational kit for the whole eng/Delivery sub-app (`Card`,
  `CardHead`, `H1`, `Kpi`, `DataTable`, `TicketLink`, `PrBadge`, `Checks`, `useCopy`, style tokens
  `HEAD/BODY/MONO/GREEN/GOLD/RED/…`, `miniBtn/primaryBtn/inp/sel`). Anything extracted out of
  `EngDashboard.jsx` should keep importing from it rather than duplicating tokens.
- Sections are registered in `src/App.jsx`'s `BASE_SECTIONS`/`COMPANY_SECTION` arrays by `id` and
  wired into `NAV_GROUPS`; none of the six target files need a routing change — the split is
  internal to each file/module, the default export and its public props stay the same.
- `src/styles.css` classes referenced by these files (`.hx`, `.hx-2a`, `.hx-2`, `.drawer-overlay`,
  `.drawer`, `.skel`, `.tabs`, `.chip`, `.md`, `.mini`) are **generic, global utility classes**, not
  scoped to file structure — none of them break when code moves between files.

---

## 1. `src/sections/TicketSection.jsx` (926 lines) — **split into 2 files**

Four tabs (Ticket / Criteria / Design / Files) behind one shell that picks a workspace + ticket key.
The Design tab is a mini-app on its own: a run-lifecycle (`EventSource` streaming, cancel, retry),
a graph editor (`useGraphEditor`, undo/redo keybinding), two view modes (Canvas/Outline), a node
inspector, and a chat panel — none of which the other three tabs touch.

**Move** (lines are from the current file):
- `DesignTab` (516–745), `Outline` (750–781), `Inspector` (783–876), `Label` (877)
  → **`src/ticket/DesignTab.jsx`** (new, default export `DesignTab`, named export `Outline` if
  anything outside ever needs it — nothing does today, so just default-export `DesignTab`).
  This is the single biggest, most self-contained lump (~360 lines) and it already depends on
  three siblings in `src/ticket/` (`DesignCanvas.jsx`, `DesignChat.jsx`, `RederivePreview.jsx`,
  `useGraphEditor.js`) — moving it *into* that directory is completing an existing pattern, not
  inventing one.
- The tiny shared kit used by **both** the tab shell and `DesignTab` — `MONO`, `HEAD`, `BODY`,
  `PANEL`, `mini` (style tokens, lines 19–21), `Empty`, `Sec`, `NotReady`, `Banner` (presentational,
  lines 57–74 and 511), `fdt`, `elapsed`, `money`, `copyText` (formatters, lines 23–25, 42–55)
  → **`src/ticket/shared.jsx`** (new). Extracting this avoids a circular import between
  `TicketSection.jsx` and the new `DesignTab.jsx` (both need `Sec`/`Empty`/`PANEL`/etc.), and it is
  exactly the "presentational bits with no second caller yet" case — stays inside `ticket/`, does
  **not** go to `src/ui/`.

**Stays in `TicketSection.jsx`**: the workspace/ticket picker shell, `TicketRail`, `SavedCard`,
`TicketTab`, `CriteriaTab`, `FilesTab`, `normalizeKey` (mirrors a server function, keep it next to
the thing that mirrors it), and the default export. That leaves roughly ~565 lines — still the
biggest of the six, but now one concern per file instead of a shell plus a mini-app.

**Landmines**
- `DesignTab` currently reads `useGraphEditor`, `RederivePreview`, `DesignChat`, `DesignCanvas`,
  `TYPES` from `'../ticket/...'` — after the move these become same-directory imports (`./...`).
  Trivial, but a plain "move the function" pass will leave the old relative paths broken.
- `CriteriaTab` (stays) also calls `copyText` — make sure it imports it from the new
  `ticket/shared.jsx` rather than losing it.
- No shared *state* crosses the tab boundary (each tab fetches its own data from `t`/`onUpdate`),
  so there's no prop-drilling landmine here — the tabs were already decoupled.

**Verify**: dev server → Ticket tab (`?dash=claude`, nav "Ticket"), open any JIRA key, switch to the
Design tab, run/regenerate a design, confirm undo/redo (⌘Z) and the chat panel still work, then
switch back to Criteria/Files to confirm nothing else regressed.

---

## 2. `src/sections/EngDashboard.jsx` (919 lines) — **split into 2 files**

This is a small SPA-within-the-SPA with its own URL-state router (`useUrlState`) and ~14 routes.
Roughly half of those routes are *already* extracted into `src/eng/*.jsx` (CI, Load, Export,
Compare, Epics, Investment, Predictability, Quality, ReviewFlow, AttentionQueue, MemberInsights).
The remaining ~460 lines are the routes/pieces that never got moved: `Sprint`/board rendering,
the ticket-detail drawer, and the add/edit-project modal. Splitting these out finishes a pattern
this codebase already committed to, rather than starting a new one.

**Move — the board/ticket-detail cluster** (lines 368–719: `colsFor`, `IssueTip`, `TipRow`,
`BoardCard`, `RoleChip`, `ColumnsBoard`, `sprintStats`, `Sprint`, `insightsFor`, local `Sec`,
`TicketDetail`) plus the three top-level consts they alone use — `BOARD_ORDER` (44), `accColor`
(46), `WAITING` (60) — confirmed by grep to have **no other call site** in the file
→ **`src/eng/Board.jsx`**. Export `Sprint` as default, and named-export `ColumnsBoard`, `IssueTip`
(both are also used by `Overview`, at line 363, and by `Members`' `DataTable` render at line 552 —
so those two call sites become `import { ColumnsBoard, IssueTip } from '../eng/Board.jsx'`).

**Move — config/empty-state chrome** (lines 812–919: `ROLES`, `ProjectConfig`, `CredsForm`,
`Loading`, `LoadingOverlay`, `NotWired`) → **`src/eng/ProjectConfig.jsx`**. Zero shared state with
the rest of the file — pure "add/edit a project" modal plus the three loading/empty placeholders
used by the top-level `shell()`.

**Stays in `EngDashboard.jsx`**: the shell/router (`EngDashboard` default export), `useMe`,
`TopBar`, `Overview`, `Okrs`, `Members`, plus `onTeam`, `SP_DAYS`/`estDaysOf`/`stageBudget`, `MONTHS`
— all confirmed (by grep) to be used *only* inside things that are staying. Reduces the file to
roughly ~450–480 lines.

**Landmines**
- `marked` (the markdown lib import at the top) is used **only** inside `TicketDetail` — drop the
  import from `EngDashboard.jsx` entirely once `Board.jsx` takes it, don't leave a dead import.
- `IssueTip` and `ColumnsBoard` are the one real piece of cross-route sharing in this file — moving
  `Sprint` without also exporting these two would break `Overview` and `Members`. Both are covered
  above; just don't split `Board.jsx` any further (e.g. don't also pull `IssueTip` into its own
  file) or you reintroduce the same cross-import problem one level down.
- `common` (the props bag built at line 150: `{ snap, S, issues, prs, members, win, shipped,
  active, prsFor, onOpenTicket, reload }`) is spread into `Overview`, `Sprint`, `Members`, `Okrs` —
  this is pre-existing prop drilling, not something the split makes worse, since `Sprint` still
  receives it via `{...common}` from the same call site, just now importing the component from a
  different file.

**Verify**: dev server → Delivery tab (this mounts `EngDashboard` via `?dash=eng` compatibility or
the Delivery nav item) → Overview (board at the bottom), Board (Sprint route), click a card to open
`TicketDetail`, Members (hover a ticket for `IssueTip`), Projects → "+ Add project" for
`ProjectConfig`.

---

## 3. `src/App.jsx` (586 lines) — **leave alone**

It is a routing table plus shell chrome, exactly the case the task called out. `BASE_SECTIONS` /
`COMPANY_SECTION` (54–275, ~220 lines) is declarative route data — an array of `{id, label, icon,
kicker, title, el}` — padded with real, load-bearing prose comments explaining *why* each section
sits where it does (these comments are the design rationale for the nav structure and are worth
keeping attached to the data they explain). The only executable logic is `groupSections`/
`sectionsFor` (two small pure functions), `SidebarFoot` (~40 lines, single caller), `useTheme`
(~12 lines, single caller), and the `App` component itself (~220 lines, mostly JSX for the sidebar/
topbar/toast shell with no reusable sub-parts — nothing here has, or plausibly gets, a second
caller). Splitting `BASE_SECTIONS` into its own file would separate the route data from the
comments justifying it for no reduction in real complexity, and `SidebarFoot`/`useTheme` are each
one call site — extracting them would be splitting to hit a line count, which the task explicitly
says not to do.

If anything, the one edge worth flagging rather than acting on: `SidebarFoot` polls `/api/harness`
and `/api/gov/costs` every 20s independent of the rest of the shell — fine as is, just note it if a
future change wants that behavior elsewhere.

**Verify**: n/a — no change proposed.

---

## 4. `src/sections/TodosSection.jsx` (563 lines) — **leave alone**

Genuinely one screen with three views over the same day's data (`Board`, `Tree`, `Insights`) plus
capture (`QuickAdd`) and provenance (`Suggest`) panels, and it *already* delegates its heavy
lifting: `TodoCard`/`Check`/`StageChip` live in `src/ui/todoParts.jsx`, and all the date/status/
grouping logic (`useTodoDay`, `groupByPath`, `statusMeta`, `dayKey`, `shiftDay`, …) lives in
`src/lib/todos.js`. What's left in this file is presentation only: `DayBar`, `QuickAdd`, `Board`,
`Tree` (+ its `Group` sub-component), `Insights`, `Suggest`, and the `TodosSection` shell — six
smallish, single-purpose local components (40–130 lines each) with no shared local state beyond
what's already passed down from the one `useTodoDay`/`useSelectedDay` call in the shell. There is no
single sub-part heavy enough to justify its own file without fragmenting the "one day, several
views of it" story the file's own header comment describes. This is the "don't split just to hit a
number" case — 563 lines of six flat, decoupled, already-small components reads faster in one file
than spread across three.

If this ever needs to shrink, `Insights` (177 lines, self-contained, fetches its own `/api/todos
insights` and takes only `date`/`root`) is the one piece that *could* move to its own file cleanly
later — flagging it, not recommending it now.

**Verify**: n/a — no change proposed.

---

## 5. `src/sections/GovernanceSection.jsx` (516 lines) — **split into 2 files**

Seven fully independent tabs (`Versions`, `Approvals`, `Access`, `Freeze audit`, `Audit log`,
`Drift`, `Batch ops`), each with its own state and its own `api.get`/`api.post` calls — no shared
state between tabs beyond the `useScopes()` hook (used by `Versions`, `Drift`, `BatchOps`) and the
`Tabs` shell. They group naturally into two families along what they're *about*:

**Move — "config change history"** (`Versions` 32–95, `Approvals` 97–151, `Audit` 365–395 — all
three read/diff/approve/rollback versioned config and all three use `DiffView`)
→ **`src/governance/VersionHistory.jsx`** (new sibling directory, matching the `ticket/`/`eng/`
pattern — not nested under `sections/`).

**Move — "operational controls"** (`Access` 158–261, the `FA_STATUS`/`FreezeAudit` pair 263–363,
`BATCH_OPS`/`BatchOps` 397–474, `Drift` 476–516, plus the shared `useScopes` hook at 26–30 since
three of these four consume it) → **`src/governance/Ops.jsx`**.

**Stays in `GovernanceSection.jsx`**: just the tab switcher (the current default export, ~15 lines)
plus its imports — effectively becomes a thin router matching the shape `EngDashboard.jsx`'s route
dispatch already has.

**Landmines**
- `useScopes` is a genuine two-family straddle: `Versions` (family 1) also calls it. Duplicating a
  4-line hook into both files is cheaper and safer than adding a third shared file for one hook —
  do that rather than creating `src/governance/shared.js` for a single 4-line function.
- All seven tabs import `Tabs`, `DiffView`, `lineDiff` from `../ui/tabs.jsx` and `useDebounced` from
  `../lib/hooks.js` — both files need the same imports duplicated; no risk here, just don't forget
  either file needs its own copy of these import lines.
- No prop drilling risk: the parent passes nothing to any tab (`tab === 'Versions' && <Versions />`
  takes zero props) — the split is purely mechanical.

**Verify**: dev server → Governance tab (top-level nav) → click through all seven tabs; specifically
exercise `Versions`' compare-two-and-diff flow and `Access`'s permission-bit toggling, since those
are the two tabs with the most internal state.

---

## 6. `src/company/FigmaCaptureSection.jsx` (511 lines) — **split into 1 file**

One coherent feature (annotate a Figma/page Capture) with one genuinely large, stateful piece —
`Editor` (113–317, ~205 lines: drag-to-annotate canvas, node-snapping, resize handles, persist/
generate-context actions) plus its two direct helpers `ComponentPicker` (30–88) and
`AnnotationForm` (90–111), which exist *only* to serve `Editor` and have no other caller.

**Move**: `ComponentPicker`, `AnnotationForm`, `Editor`, and the shared `nodeAt` helper (16–25, used
only by `Editor`'s click-to-snap logic) → **`src/company/figma-editor.jsx`** (sibling file, same
directory — this feature has no second caller anywhere else in the app per grep, so it does **not**
qualify for `src/ui/` under the "second caller today" rule; it stays co-located with the section
that owns it, same flat-file pattern `company/` already uses for its four sections).

**Stays in `FigmaCaptureSection.jsx`**: `CreatePageCaptureForm`, `CreateCaptureForm`, `CaptureList`,
`BranchChip`, `FigmaTokenBar`, and the default export/shell (repo picker, token bar, list-vs-editor
switch). That's the "browse captures" half of the feature versus the "annotate one capture" half —
a real seam, not an arbitrary line cut. Leaves ~300 lines in the main file, ~210 in the new one.

**Landmines**
- `Dim`, the style tokens (`MONO`, `HEAD`, `SANS`, `PANEL`, `ACCENT`), all need to be shared between
  the two files — duplicate them (they're one-liners) rather than adding a third file; this mirrors
  the `useScopes` call above (single small shared pieces are cheaper duplicated than centralized).
- `Editor` receives `catalog` as a prop from the section shell (fetched once in the default export
  via `/api/figma-capture/catalog`) — this is the one piece of state crossing the new file boundary;
  it already comes in as a prop today, so nothing changes, just confirm the prop still threads
  through `slug ? <Editor repo={repo} slug={slug} catalog={catalog} .../> : ...` after the move.

**Verify**: dev server → Company tools → Figma Capture (flag-gated, needs `companyTools` in
`projects.json`) → pick a repo, open an existing Capture (or create one if `FIGMA_TOKEN` is set),
confirm drag-to-annotate, node snapping, and "generate context.md" still work.

---

## Suggested extraction order (each step independently committable)

1. **GovernanceSection** → `governance/VersionHistory.jsx` + `governance/Ops.jsx` (lowest risk: zero
   shared state, seven already-isolated tabs).
2. **FigmaCaptureSection** → `company/figma-editor.jsx` (low risk: one clean seam, one prop crossing
   the boundary).
3. **TicketSection** → `ticket/shared.jsx` then `ticket/DesignTab.jsx` (do the shared-kit file first
   so `DesignTab.jsx` has something to import from on its first commit).
4. **EngDashboard** → `eng/ProjectConfig.jsx` (fully standalone) then `eng/Board.jsx` (touches two
   other call sites — `Overview` and `Members` — so do it once `ProjectConfig` is safely landed).
5. `App.jsx` and `TodosSection.jsx`: no action.

After each step: `npm run build` (or the project's existing type/lint check) to catch missed import
path updates, then the per-file dev-server check listed above.

---

# Split plan — src/sections/SetupSection.jsx (read-only analysis, no edits made)

Read first: `split-04-src.md` (same session) for the conventions this plan follows — sibling
top-level dirs only for genuinely separate sub-features, `src/ui/*.jsx` reserved for components
with a *second real caller today*, small shared style-token objects get duplicated rather than
centralized into a third file, sections register in `src/App.jsx` by `id` and none of these splits
need a routing change.

`SetupSection.jsx` is registered at `src/App.jsx:30` (import) and `:211` (`el: <SetupSection />`)
under the Setup nav item — confirmed via grep, no other file imports anything from it.

---

## Verdict: **split into 1 file** (`ModelPricing`) — everything else stays

663 lines, comments already stripped. Shape: three tiny shared helpers (`Field`, `Section`, `Dot`,
lines 18–36, ~19 lines) plus eight independent "one settings card" components, each owning its own
`useState`/`api.get`/`api.put` and taking either no props or just `{ d, reload }` from the parent's
single `/api/setup` fetch: `Paths` (38–66), `SetupSection` default export/shell (68–94),
`Credentials` (97–197), `Projects` (199–281), `WorkWeek` (284–328), `StoryPoints` (331–365),
`OrgTools` (368–428), `Notifications` (431–462), `ModelPricing` (465–663).

This is the same shape as `TodosSection.jsx` (563 lines, "leave alone" in split-04) — a flat list of
small, decoupled, single-purpose cards with no cross-component state, just more of them. Seven of
the eight cards are 27–101 lines each: genuinely too small to be worth their own file, and splitting
them out would fragment the "everything this app needs to configure, in one place" story the file's
own default export tells (`Credentials` → `Projects` → `WorkWeek` → `StoryPoints` → `OrgTools` →
`Notifications` → `ModelPricing` → `Paths`, read top to bottom).

`ModelPricing` (465–663, ~199 lines including its own module consts `RATE_KEYS`, `RATE_LABEL`,
`rateInp`, `blankRule`) is the one exception — it's ~30% of the file on its own, and unlike the
other seven cards it takes **zero props**: it fetches its own `/api/pricing` and `/api/usage`,
manages its own promo-rate editing state, and shares no data with `d`/`reload` from the parent at
all. It is pricing-rate administration, a different concern from "org config" (credentials/projects/
work week/notifications), and it's the single largest lump — same shape as the `Editor` extraction
from `FigmaCaptureSection` in split-04 (one clean seam, one self-contained mini-feature).

**Move**: `RATE_KEYS`, `RATE_LABEL`, `rateInp`, `blankRule`, `ModelPricing` (465–663)
→ **`src/sections/ModelPricing.jsx`** (new, default export `ModelPricing`). Flat file directly in
`src/sections/`, matching the existing non-`*Section.jsx` pattern already used there (`Overview.jsx`,
`PlanGraph.jsx`, `UsagePanel.jsx`, `ProjectHub.jsx` — PascalCase component files with no `Section`
suffix, sitting beside the `*Section.jsx` files). Does **not** qualify for `src/ui/` — no second
caller anywhere in the app per grep.

**Stays in `SetupSection.jsx`**: `Field`, `Section`, `Dot`, `emails`, the style tokens (`MONO`,
`HEAD`, `RED`, `GOLD`, `GREEN`, `DIM`, `ACCENT`, `card`, `inp`, `btn`, `primary`, `danger`, `DAYS`),
`Paths`, the default export/shell, `Credentials`, `Projects`, `WorkWeek`, `StoryPoints`, `OrgTools`,
`Notifications`. That leaves ~470 lines — the "org config" half of the feature, one concern per file.

**Landmines**
- `ModelPricing` uses `Section`, `card`, `inp`, `btn`, `primary`, `danger`, `MONO`, `RED`, `GOLD`,
  `DIM` from the top of the file — it does **not** use `Field`, `ACCENT`, `HEAD`, or `DAYS` (checked
  by grep against lines 465–663), so those four don't need to travel. `SetupSection.jsx` still needs
  all of them for the other seven cards, so nothing is removed from the original file's token block.
- These tokens can't just be re-imported from `SetupSection.jsx` into `ModelPricing.jsx` — that would
  be a circular import (`SetupSection.jsx` already imports `ModelPricing` by default to render it in
  its JSX at line ~90), the exact problem split-04 flagged for `TicketSection`/`DesignTab`. Since this
  is only one extraction and the tokens are one-liners (plus `Section`, ~11 lines), **duplicate**
  `MONO`, `RED`, `GOLD`, `DIM`, `card`, `inp`, `btn`, `primary`, `danger`, and `Section` into
  `ModelPricing.jsx` rather than inventing a third shared file for one caller — this mirrors the
  `useScopes`-duplication and `Dim`/style-token-duplication precedents already used twice in split-04.
  Do not centralize; do not skip the duplication and reach for a circular import instead.
- `rateInp` (module-level, `{ ...inp, font: ..., padding: ..., textAlign: 'right' }`) is defined
  right above `ModelPricing` today and used only inside it — moves as-is, no rename needed.
- No prop-drilling risk: `ModelPricing` takes no props today and won't after the move; the parent
  call site becomes `<ModelPricing />` from a new default import, textually identical to today.
- `src/styles.css` has no classes keyed to this file's structure (it's all inline `style={}` objects,
  same as the rest of the file) — nothing in `styles.css` needs touching.

**Verify**: dev server → Setup nav item → scroll to "Model pricing" (last card before Paths),
confirm the rate table renders, edit a rate and Save, toggle a promo-rate row open (▸/▾) and confirm
the intro-rate sub-table still shows/hides and saves, then scroll up to confirm Credentials/
Projects/Work week/Story points/Company tools/Notifications above it are unaffected.

## Extraction order

Single step, independently committable: create `src/sections/ModelPricing.jsx` with the duplicated
tokens + moved code, replace the in-file `ModelPricing` definition in `SetupSection.jsx` with
`import ModelPricing from './ModelPricing.jsx'`. Then `npm run build` (or the project's lint/type
check) to confirm no dangling references to `RATE_KEYS`/`RATE_LABEL`/`rateInp`/`blankRule` were left
behind in `SetupSection.jsx`, then the dev-server check above.
