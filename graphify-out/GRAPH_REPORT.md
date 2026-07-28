# Graph Report - .  (2026-07-29)

## Corpus Check
- 153 files · ~395,922 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1457 nodes · 2947 edges · 81 communities (75 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 66 edges (avg confidence: 0.73)
- Token cost: 400,000 input · 112,232 output

## Community Hubs (Navigation)
- AC & Analytics Registry
- Agent Runner & Clone
- Governance & Approvals UI
- Engineering Config
- Ticket Planning UI
- Engineering Snapshot Core
- Editor & Build Dependencies
- Atoms Catalog UI
- Frontend Timeline Aggregation
- Forensics & Artifact Browser UI
- Plan Graph & Cost Panel UI
- Ticket Config Helpers
- Artifacts & MCP UI
- Bugs Section UI
- Backup & Drift Tracking
- Capabilities ROI Ledger
- Run Metrics Hooks
- Investment Rollup Helpers
- Context Explorer UI
- Usage Cost Alerts
- Open Source Governance Docs
- Figma Capture Backend
- App Shell & Sidebar
- Delivery Metrics UI
- Session Plan Extraction
- Scheduler & Remediation
- Board Section UI
- Working Set UI
- Snapshot Loader & GH Commands
- Ingest Index Builder
- Working Set Dashboard Screenshot
- Worktree & Conflict Scan
- Overview Dashboard UI
- Overview Metric Tiles Screenshot
- Company Tools & Credentials Screenshot
- ADF/Markdown Conversion
- GitHub PR Fetching
- Customize Config Groups
- Prompt Quality Checker
- Harness Sessions Screenshot
- Attention Inbox Screenshot
- Work Time & Off-Hours Helpers
- Harness Health Scoring
- Constitution Builder Backend
- Inbox Section UI
- Working Set Dossier Edit Timeline
- Figma Capture UI
- Harness Section UI
- Design Map Builder
- Engineering Quality Metrics
- Memory Mount Backend
- Harness Usage Trends
- Capability Ledger UI
- Constitution Tab Screenshot
- Forensics Panels Screenshot
- Harness Metrics Core
- Run Verdict Logic
- Showcase Recording Script
- Transcript History Helpers
- Constitution Section UI
- Activity Timeline UI
- Customize Section UI
- Hooks Section UI
- Project Hub UI
- Fixture Redaction Script
- Working Set Poster Screenshot
- CI Health Helpers
- Screenshot Capture Script
- Design Drift Scanner
- Customize Toggle & Test
- Work Item URL Helpers
- Design System Repo Package
- Button Component & Story
- Card Component & Story
- IconButton Component & Story
- Icons Component & Story
- Delivery Not-Configured State
- Chat Insights & Sample Report
- Loush Tour Splash

## God Nodes (most connected - your core abstractions)
1. `toast()` - 55 edges
2. `api` - 43 edges
3. `mountTicket()` - 37 edges
4. `mountEng()` - 36 edges
5. `fmtDate()` - 36 edges
6. `Skeleton()` - 23 edges
7. `Verdict classification: DEAD / COLD / NEW / HOT` - 21 edges
8. `readJson()` - 20 edges
9. `mountSetup()` - 20 edges
10. `tildify()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `Claude Code Insights Sample Report Fixture` --semantically_similar_to--> `Chat Insights Feature`  [INFERRED] [semantically similar]
  test/fixtures/report-sample.html → README.md
- `Claude Code Insights Sample Report Fixture` --semantically_similar_to--> `Harness Usage Panel`  [INFERRED] [semantically similar]
  test/fixtures/report-sample.html → README.md
- `spawnAgent()` --indirect_call--> `payload()`  [INFERRED]
  lib/agent.mjs → test/server/eng-privacy.test.js
- `mountFigmaCapture()` --indirect_call--> `slug()`  [INFERRED]
  server/figma-capture.mjs → lib/design-schema.mjs
- `HarnessSection()` --indirect_call--> `g()`  [INFERRED]
  src/sections/HarnessSection.jsx → test/src/tidy.test.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Files Added Per Open-Source Readiness Plan (Group A)** — code_of_conduct_contributor_covenant, contributing_guide, security_policy, github_issue_template_bug_report_template, github_issue_template_feature_request_template, github_pull_request_template_template, github_workflows_ci_workflow [EXTRACTED 1.00]
- **Ticket AC/Design/Tests Generation Prompt Suite** — server_prompts_ac_prompt, server_prompts_design_plan_prompt, server_prompts_tests_prompt [INFERRED 0.85]
- **Capabilities tracked in Loush ROI ledger (141 total)** — docs_screenshots_capabilities_verify_ac, docs_screenshots_capabilities_loush_verifier, docs_screenshots_capabilities_loush_review_fixer, docs_screenshots_capabilities_loush_figma_analyst, docs_screenshots_capabilities_loush_bug_fixer, docs_screenshots_capabilities_loush_test_generator, docs_screenshots_capabilities_loush_code_reviewer, docs_screenshots_capabilities_loush_tester, docs_screenshots_capabilities_loush_implementor, docs_screenshots_capabilities_constitution_scout, docs_screenshots_capabilities_gsd_discuss_phase, docs_screenshots_capabilities_gsd_domain_researcher, docs_screenshots_capabilities_loush_orchestrator_contract, docs_screenshots_capabilities_ticket_context_researcher, docs_screenshots_capabilities_gsd_eval_planner, docs_screenshots_capabilities_gsd_ai_researcher, docs_screenshots_capabilities_gsd_eval_auditor, docs_screenshots_capabilities_ticket_edge_cases, docs_screenshots_capabilities_gsd_debug_session_manager, docs_screenshots_capabilities_ticket_codebase_finder [EXTRACTED 1.00]
- **Ticket-workflow agent family (ticket-* prefix)** — docs_screenshots_capabilities_ticket_context_researcher, docs_screenshots_capabilities_ticket_edge_cases, docs_screenshots_capabilities_ticket_codebase_finder [INFERRED 0.85]
- **GSD workflow agent/skill family (gsd-* prefix)** — docs_screenshots_capabilities_gsd_discuss_phase, docs_screenshots_capabilities_gsd_domain_researcher, docs_screenshots_capabilities_gsd_eval_planner, docs_screenshots_capabilities_gsd_ai_researcher, docs_screenshots_capabilities_gsd_eval_auditor, docs_screenshots_capabilities_gsd_debug_session_manager [INFERRED 0.85]
- **Loush-branded agent family (loush-* prefix)** — docs_screenshots_capabilities_loush_verifier, docs_screenshots_capabilities_loush_review_fixer, docs_screenshots_capabilities_loush_figma_analyst, docs_screenshots_capabilities_loush_bug_fixer, docs_screenshots_capabilities_loush_test_generator, docs_screenshots_capabilities_loush_code_reviewer, docs_screenshots_capabilities_loush_tester, docs_screenshots_capabilities_loush_implementor, docs_screenshots_capabilities_loush_orchestrator_contract [INFERRED 0.85]

## Communities (81 total, 6 thin omitted)

### Community 0 - "AC & Analytics Registry"
Cohesion: 0.02
Nodes (70): AC_DEFAULT, activeEvals, ALLOWED_ROOTS, analyticsRegistry(), app, APPROVALS_FILE, ASSETS_DIR, BACKUPS (+62 more)

### Community 1 - "Agent Runner & Clone"
Cohesion: 0.06
Nodes (67): runAgent(), spawnAgent(), CLAUDE_JSON, HOME, knownRepoDirs(), listLocalProjects(), localCloneOf(), originOf() (+59 more)

### Community 2 - "Governance & Approvals UI"
Cohesion: 0.06
Nodes (52): fmtDate(), useDebounced(), Approvals(), Audit(), BATCH_OPS, BatchOps(), Drift(), GovernanceSection() (+44 more)

### Community 3 - "Engineering Config"
Cohesion: 0.07
Nodes (49): DEFAULT_SP_DAYS, DEFAULT_WORK, dowOf(), invalidateEngConfig(), isWeekendWith(), loadEngConfig(), normalizeDesignSystem(), normalizeToolFlag() (+41 more)

### Community 4 - "Ticket Planning UI"
Cohesion: 0.06
Nodes (37): planLayout(), age(), copyText(), CriteriaTab(), DesignTab(), elapsed(), fdt(), META (+29 more)

### Community 5 - "Engineering Snapshot Core"
Cohesion: 0.09
Nodes (40): ACTIVE, bucketOf(), BUCKETS, ciCache, colorFor(), computeIssue(), DEFAULT_BUCKETS, DONE (+32 more)

### Community 6 - "Editor & Build Dependencies"
Cohesion: 0.05
Nodes (40): @codemirror/lang-html, @codemirror/lang-javascript, @codemirror/lang-json, @codemirror/lang-markdown, concurrently, d3, express, marked (+32 more)

### Community 7 - "Atoms Catalog UI"
Cohesion: 0.09
Nodes (27): Ask(), atomClaimCell(), atomColumns(), AtomsSection(), Catalog(), d3GroupCount(), FILTERS, idxCache (+19 more)

### Community 8 - "Frontend Timeline Aggregation"
Cohesion: 0.13
Nodes (32): aggregateFiles(), buildTimeline(), classify(), CLAUDE, contextBundle(), coverageOf(), dayKey(), dirtyFiles() (+24 more)

### Community 9 - "Forensics & Artifact Browser UI"
Cohesion: 0.10
Nodes (25): react, react, ArtifactBrowser(), ago(), fmtChars(), ForensicsSection(), oversizeWarnHook(), TREND (+17 more)

### Community 10 - "Plan Graph & Cost Panel UI"
Cohesion: 0.09
Nodes (19): ActivityTimeline(), CostPanel(), fmtDur(), fmtTok(), GLYPH, glyphOf(), hueOf(), LANE (+11 more)

### Community 11 - "Ticket Config Helpers"
Cohesion: 0.10
Nodes (30): acliProfile(), artifactsFor(), authErrors(), cfgFor(), cfgForTicket(), claudeMarkdown(), creds(), FIELDS (+22 more)

### Community 12 - "Artifacts & MCP UI"
Cohesion: 0.13
Nodes (18): fmtSize(), ArtifactsSection(), McpSection(), ResourceSection(), RunFiles(), Drawer(), mcpConfigFrom(), mcpValuesFrom() (+10 more)

### Community 13 - "Bugs Section UI"
Cohesion: 0.10
Nodes (23): toast(), age(), Bisect(), BugsSection(), Intake(), PANEL, SEV, STATUS (+15 more)

### Community 14 - "Backup & Drift Tracking"
Cohesion: 0.10
Nodes (27): appendVersion(), backup(), batchPlan(), driftFor(), driftVs(), engSnapshot(), evalRuns(), getPath() (+19 more)

### Community 15 - "Capabilities ROI Ledger"
Cohesion: 0.12
Nodes (25): Capabilities Dashboard (ROI ledger view), constitution-scout (agent, HOT), gsd-ai-researcher (agent), gsd-debug-session-manager (agent), gsd-discuss-phase (skill), gsd-domain-researcher (agent), gsd-eval-auditor (agent), gsd-eval-planner (agent) (+17 more)

### Community 16 - "Run Metrics Hooks"
Cohesion: 0.14
Nodes (19): useVisiblePoll(), deriveRunMetrics(), fmtDur(), relTime(), Approval(), artifactName(), DECISION_COLOR, Detail() (+11 more)

### Community 17 - "Investment Rollup Helpers"
Cohesion: 0.13
Nodes (21): derive(), epicRollup(), investment(), jiraLink(), monthKey(), nameList(), readEpicTargets(), readTriage() (+13 more)

### Community 18 - "Context Explorer UI"
Cohesion: 0.15
Nodes (18): api, ContextExplorerSection(), ContextTimeline(), fmtDate(), fmtTok(), ago(), FlowSection(), fmtN() (+10 more)

### Community 19 - "Usage Cost Alerts"
Cohesion: 0.17
Nodes (22): claudeMdFor(), collectUsage(), costAlerts(), customizeRes(), deepMerge(), entryCost(), exportBundle(), harnessResolve() (+14 more)

### Community 20 - "Open Source Governance Docs"
Cohesion: 0.13
Nodes (21): Contributor Covenant Code of Conduct, Contributing Guide, Bug Report Issue Template, Feature Request Issue Template, Pull Request Template, CI GitHub Actions Workflow, Index HTML Shell, Inline Pre-Paint Theme Script (+13 more)

### Community 21 - "Figma Capture Backend"
Cohesion: 0.18
Nodes (20): cachedProjectComponents(), captureDir(), capturesDir(), COMPONENT_EXPORT_RES, COMPONENT_EXTS, contextMarkdown(), currentBranch(), fetchCapture() (+12 more)

### Community 22 - "App Shell & Sidebar"
Cohesion: 0.13
Nodes (15): App(), BASE_SECTIONS, COMPANY_SECTION, sectionsFor(), useTheme(), forceFresh(), CX, Dim() (+7 more)

### Community 23 - "Delivery Metrics UI"
Cohesion: 0.14
Nodes (16): ACTIVE, CFR_SEGS, d1(), DeliverySection(), DEPLOY_SEGS, deployBand(), Dora(), DORA_BANDS (+8 more)

### Community 24 - "Session Plan Extraction"
Cohesion: 0.21
Nodes (15): blocksToPlan(), diagnoseSession(), extractPlan(), filesTouched(), turnMetrics(), Block(), buildBlocks(), Cap() (+7 more)

### Community 25 - "Scheduler & Remediation"
Cohesion: 0.20
Nodes (15): DEFAULT, dispatchPlan(), nextSchedule(), readSchedulerConfig(), remediationPlan(), runDigestJob(), runDispatchJob(), runJob() (+7 more)

### Community 26 - "Board Section UI"
Cohesion: 0.13
Nodes (11): age(), Analytics(), BoardSection(), Card(), Detail(), lbl(), MODELS, PANEL (+3 more)

### Community 27 - "Working Set UI"
Cohesion: 0.13
Nodes (15): ago(), btn, card, chip, chipOn, Dossier(), FILTERS, ghostBtn (+7 more)

### Community 28 - "Snapshot Loader & GH Commands"
Cohesion: 0.18
Nodes (18): describeWork(), computeSnapshot(), dedupeErrs(), ghCommandFor(), loadDisk(), loadProjects(), persistDisk(), projectList() (+10 more)

### Community 29 - "Ingest Index Builder"
Cohesion: 0.24
Nodes (15): buildIndex(), collectSources(), computeCoverage(), constDir(), loadDemandSignals(), loadSource(), newestMtime(), parseInsufficient() (+7 more)

### Community 30 - "Working Set Dashboard Screenshot"
Cohesion: 0.14
Nodes (17): src/App.jsx (rank 128, still present, has 1 importer), src/EngDashboard.jsx (rank 132, GONE), Filter tabs: Rework / High blast radius / No test / No story / Orphaned / Uncommitted / Everything, Import graph parser (139 source files walked, 256 internal imports resolved, 10 unresolved), Left sidebar navigation (Overview, Working Set, Inbox, Delivery, Ticket, Projects, Chat, Workflows, Capabilities, Harness, Authoring, Hooks, Artifacts, Setup, Company tools), Loush dashboard application (BETA), '37 no story' metric (edited source files with no linked story), '32 no test' metric (source files edited by agent lacking tests) (+9 more)

### Community 31 - "Worktree & Conflict Scan"
Cohesion: 0.23
Nodes (15): blockT(), changedFiles(), conflictScan(), ensureWorktree(), gitB(), loushRunEmit(), loushRunState(), projCfg() (+7 more)

### Community 32 - "Overview Dashboard UI"
Cohesion: 0.20
Nodes (11): ago(), d1(), DeliveryTiles(), fmtDur(), fmtTok(), Overview(), pctl(), PROJ_COLORS (+3 more)

### Community 33 - "Overview Metric Tiles Screenshot"
Cohesion: 0.16
Nodes (14): 5H Output metric tile (296.7k, 458 msgs), Authoring section, dashboard project (68 sessions, 106 commits), demo-web project (154 sessions), Harness status indicator (harness valid, settings schema, backups synced), Lines 7D metric tile (6.6k, +4.7k), Loush (BETA app), Overview Dashboard Screenshot (+6 more)

### Community 34 - "Company Tools & Credentials Screenshot"
Cohesion: 0.20
Nodes (14): Company tools panel (org-specific bundle toggle + identity restriction + design system field), Constitution reader tool, Credentials panel (JIRA host/token/email, write-only, backed by .eng.local.json), Delivery metrics (cycle time, lead time, stage budgets, off-hours/weekend-work flags), .eng.local.json local credentials file, Figma Capture tool (component catalog extraction from design system), GitHub CLI (gh) authentication status indicator, Notifications panel (desktop alerts + Slack webhook) (+6 more)

### Community 35 - "ADF/Markdown Conversion"
Cohesion: 0.22
Nodes (9): adfToText(), bullet(), INLINE, isAdf(), markdownToAdf(), numbered(), decodeEnt(), htmlToText() (+1 more)

### Community 36 - "GitHub PR Fetching"
Cohesion: 0.16
Nodes (14): BOT(), ciFor(), fetchPRs(), gh(), ghAuthed(), ghAvailable(), ghJSON(), median() (+6 more)

### Community 37 - "Customize Config Groups"
Cohesion: 0.14
Nodes (14): customizeAll(), customizeHooks(), customizeMcp(), customizePlugins(), customizeRules(), groupOf(), hookKey(), itemFile() (+6 more)

### Community 38 - "Prompt Quality Checker"
Cohesion: 0.25
Nodes (13): analyze(), CLAUDE, claudePrompts(), clean(), cursorPrompts(), DIMENSIONS, gather(), HOME (+5 more)

### Community 39 - "Harness Sessions Screenshot"
Cohesion: 0.19
Nodes (13): Branch claude/dashboard-value-assessment-lua8b0 (dashboard session, $138.51, 1h47m, 126 tools, 2 errors), Branches DEMO-336.g / DEMO-336.h (app, demo-web, packages sessions), Branch claude/jira-ticket-integration-tab-yi14s0 (13 dashboard sessions, up to $104.81 and 2h14m duration), Cache Saved stat card ($84.5k estimated all time), Compactions stat card (0 context overflow events), Harness Engineering page (sessions, forensics, config & governance), Harness Sessions Dashboard Screenshot, Harness sub-nav tabs (Sessions, Context Explorer, Forensics, Usage, Config, Governance, Team baseline, Reliability, Library, MCP) (+5 more)

### Community 40 - "Attention Inbox Screenshot"
Cohesion: 0.19
Nodes (13): Attention Inbox screen (work + harness), "cached · fresh" refresh toggle (top right), Daily digest tab, "Everything that needs you" summary panel (1 open, Work 0 / Harness 1 counters), Inbox item: "2 recommended safety hooks not installed (block-prod-file-edit, secret-scan-pre-write) — install from Hooks", Sidebar footer status: "harness valid — settings schema, backups synced", Hooks nav item, Inbox tab (+5 more)

### Community 41 - "Work Time & Off-Hours Helpers"
Cohesion: 0.22
Nodes (13): addWorkTimeWith(), dowOfDay(), offHoursWith(), weekKeyWith(), workDaysWith(), workMsWith(), addWorkTime(), isWeekend() (+5 more)

### Community 42 - "Harness Health Scoring"
Cohesion: 0.28
Nodes (9): clamp100(), computeRegression(), computeUsageHealth(), scoreCacheEfficiency(), scoreContextEfficiency(), scoreCostTrend(), toGrade(), WEIGHTS (+1 more)

### Community 43 - "Constitution Builder Backend"
Cohesion: 0.28
Nodes (12): buildInsights(), cache, candidateRepos(), CLAUDE_JSON, collectArtifacts(), constDir(), CURSOR_WS, fm() (+4 more)

### Community 44 - "Inbox Section UI"
Cohesion: 0.18
Nodes (10): d1(), Digest(), fmtTok(), Inbox(), InboxSection(), KIND_ICON, PANEL, PLANES (+2 more)

### Community 45 - "Working Set Dossier Edit Timeline"
Cohesion: 0.20
Nodes (12): src/App.jsx, BugsSection.jsx, Prompt: 'Lets fix all of them.' (2:01:51 AM), FlowSection.jsx, Hub.jsx, InboxSection.jsx, InsightsSection.jsx, LibrarySection.jsx (+4 more)

### Community 46 - "Figma Capture UI"
Cohesion: 0.18
Nodes (4): Editor(), FigmaCaptureSection(), nodeAt(), PANEL

### Community 47 - "Harness Section UI"
Cohesion: 0.18
Nodes (6): HarnessSection(), kTok(), MODEL_HUES, MODELS, PANEL, g()

### Community 48 - "Design Map Builder"
Cohesion: 0.36
Nodes (9): buildMap(), EMPTY_EVIDENCE, enumerateComponents(), harvestStories(), markCollisions(), nodeKey(), normaliseNodeId(), readJson() (+1 more)

### Community 49 - "Engineering Quality Metrics"
Cohesion: 0.27
Nodes (9): busFactor(), escapeRateSeries(), estAccuracy(), MONTH(), quality(), top2Seg(), april, march (+1 more)

### Community 50 - "Memory Mount Backend"
Cohesion: 0.36
Nodes (10): HOME, mountMemory(), parseFM(), PROJ_BASE, projLabel(), retrieveContext(), scoreMem(), searchMemories() (+2 more)

### Community 51 - "Harness Usage Trends"
Cohesion: 0.29
Nodes (9): buildDailyCacheMap(), buildDailyUsage(), cacheWasteCost(), dayKey(), daysInMonth(), detectDailyAnomalies(), projectMonthEnd(), rollingCacheEfficiency() (+1 more)

### Community 52 - "Capability Ledger UI"
Cohesion: 0.29
Nodes (9): ago(), ARCHIVABLE, CapabilityLedger(), COLS, fmtTok(), INV_COLS, Inventory(), LEVEL_COLOR (+1 more)

### Community 53 - "Constitution Tab Screenshot"
Cohesion: 0.28
Nodes (9): Constitution tab (Company tools > constitution & design capture), Export HTML action button, Figma Capture tab, Harness status indicator (harness valid; settings schema, backups synced), Loush (AI Dashboard application), '...or paste a repo path' input field, Company Tools screenshot (Loush app), Sidebar navigation (Overview, Working Set, Inbox, Delivery, Ticket, Projects, Chat, Workflows, Capabilities, Harness, Authoring, Hooks, Artifacts, Setup, Company tools) (+1 more)

### Community 54 - "Forensics Panels Screenshot"
Cohesion: 0.31
Nodes (9): Biggest single results panel (10 worst oversized tool results, mostly Read), ~/.claude/settings.json (PostToolUse hook config), Context pressure panel (tool result byte/token share by tool), Forensics Dashboard (Harness Engineering), Failure signatures panel (60 distinct tool-error signatures ranked by frequency), Harness Engineering tab bar (Sessions, Context Explorer, Forensics, Usage, Config, Governance, Team baseline, Reliability, Library, MCP), Hook blast radius panel (13 hooks fired in 30d, block rate/latency), Read tool error signature: 'File does not exist' (67x, top offender) (+1 more)

### Community 55 - "Harness Metrics Core"
Cohesion: 0.50
Nodes (7): capabilityVerdict(), contextPressure(), median(), pctl(), sessionsSince(), tokPerFire(), capabilityLedger()

### Community 56 - "Run Verdict Logic"
Cohesion: 0.25
Nodes (7): RETRY_CAP, verdictFrom(), asMs(), computeVerdict(), normalizeEvent(), readEvents(), scanRuns()

### Community 57 - "Showcase Recording Script"
Cohesion: 0.42
Nodes (8): click(), main(), run, S, settled(), sleep(), subTabs(), tour()

### Community 58 - "Transcript History Helpers"
Cohesion: 0.22
Nodes (9): findTranscript(), historyEvents(), loushSafe(), mangle(), projectDirs(), readTranscript(), reviewData(), runDir() (+1 more)

### Community 59 - "Constitution Section UI"
Cohesion: 0.36
Nodes (8): ConstitutionSection(), tildify(), ACTIONS, Analysis(), fmtDur(), PANEL, QuickActions(), RunWindow()

### Community 60 - "Activity Timeline UI"
Cohesion: 0.36
Nodes (7): shortArg(), toolName(), ActivityTimeline(), buildTimeline(), classify(), EDIT_TOOLS, STYLE

### Community 61 - "Customize Section UI"
Cohesion: 0.28
Nodes (6): Card(), CATS, CustomizeSection(), DELETABLE, idOf(), META

### Community 62 - "Hooks Section UI"
Cohesion: 0.25
Nodes (4): Editor(), EVENTS, HooksSection(), PANEL

### Community 63 - "Project Hub UI"
Cohesion: 0.25
Nodes (5): kTok(), PANEL, ProjectHub(), SEV, TYPE

### Community 64 - "Fixture Redaction Script"
Cohesion: 0.57
Nodes (6): buildMap(), esc(), loadKeep(), main(), selftest(), SENSITIVE

### Community 65 - "Working Set Poster Screenshot"
Cohesion: 0.47
Nodes (6): Edit/Write structuredPatch blocks (transcript diff source), File change ranking table (path, rank score, edits, files-touched, +/- lines, JIRA refs, last-touched), Left sidebar navigation (Overview, Working Set, Inbox, Delivery, Ticket, Projects, Chat, Workflows, Capabilities, Harness, Authoring, Hooks, Artifacts, Setup, Company tools), Loush product/app, Rank heuristic ("Rank is a heuristic, not a measurement"), Working Set dashboard screenshot (Loush)

### Community 66 - "CI Health Helpers"
Cohesion: 0.33
Nodes (6): ciHealth(), engProjectList(), ghAvailable(), median(), repoCI(), repoRuns()

### Community 67 - "Screenshot Capture Script"
Cohesion: 0.60
Nodes (4): main(), ready(), SHOTS, sleep()

### Community 68 - "Design Drift Scanner"
Cohesion: 0.40
Nodes (5): designDrift(), fileKeyFor(), manifestPath(), manifestStatus(), scanComponents()

### Community 70 - "Work Item URL Helpers"
Cohesion: 0.50
Nodes (4): d1(), jiraUrl(), prUrl(), workItems()

### Community 71 - "Design System Repo Package"
Cohesion: 0.50
Nodes (3): main, name, version

### Community 76 - "Delivery Not-Configured State"
Cohesion: 1.00
Nodes (3): /api/eng/snapshot endpoint, Delivery not-configured banner, no-jira-token configuration state

### Community 77 - "Chat Insights & Sample Report"
Cohesion: 0.67
Nodes (3): Chat Insights Feature, Harness Usage Panel, Claude Code Insights Sample Report Fixture

## Ambiguous Edges - Review These
- `constitution-scout (agent, HOT)` → `loush-orchestrator-contract (agent)`  [AMBIGUOUS]
  docs/screenshots/capabilities.png · relation: conceptually_related_to
- `Working Set dashboard screenshot (Loush)` → `Rank heuristic ("Rank is a heuristic, not a measurement")`  [AMBIGUOUS]
  docs/screenshots/showcase-poster.png · relation: conceptually_related_to

## Knowledge Gaps
- **318 isolated node(s):** `HOME`, `CLAUDE_JSON`, `remoteCache`, `EMPTY_EVIDENCE`, `WEIGHTS` (+313 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `constitution-scout (agent, HOT)` and `loush-orchestrator-contract (agent)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Working Set dashboard screenshot (Loush)` and `Rank heuristic ("Rank is a heuristic, not a measurement")`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `driftVs()` connect `Backup & Drift Tracking` to `AC & Analytics Registry`, `Usage Cost Alerts`?**
  _High betweenness centrality (0.296) - this node is a cross-community bridge._
- **Why does `C` connect `Backup & Drift Tracking` to `Plan Graph & Cost Panel UI`?**
  _High betweenness centrality (0.295) - this node is a cross-community bridge._
- **Why does `api` connect `Context Explorer UI` to `Governance & Approvals UI`, `Ticket Planning UI`, `Atoms Catalog UI`, `Forensics & Artifact Browser UI`, `Plan Graph & Cost Panel UI`, `Artifacts & MCP UI`, `Bugs Section UI`, `Run Metrics Hooks`, `App Shell & Sidebar`, `Delivery Metrics UI`, `Session Plan Extraction`, `Board Section UI`, `Working Set UI`, `Overview Dashboard UI`, `Inbox Section UI`, `Figma Capture UI`, `Harness Section UI`, `Capability Ledger UI`, `Constitution Section UI`, `Customize Section UI`, `Hooks Section UI`, `Project Hub UI`?**
  _High betweenness centrality (0.143) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `mountTicket()` (e.g. with `runView()` and `writesRepo()`) actually correct?**
  _`mountTicket()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `HOME`, `CLAUDE_JSON`, `remoteCache` to the rest of the system?**
  _318 weakly-connected nodes found - possible documentation gaps or missing edges._