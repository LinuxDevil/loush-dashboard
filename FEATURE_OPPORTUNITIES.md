# Feature Opportunities — What We Can Add, and Where

This document was produced by two research agents that independently mined `RESEARCH_MERGED.md` (our consolidated write-up of 21 upstream Claude Code ecosystem projects) for concrete, adoptable features, and mapped each one to a specific place in this codebase (`src/sections/*.jsx`, `server/*.mjs`, or a new file). Agent 1 covered: claude-code-action, claude-code-security-review, CAST, ccpm, ciscoittech's Claude Agent Framework, Claude Code Agent Monitor (CCAM), claude-code-insights ("CSI"), context-mode, openskills, manifest, and FlyCrys. Agent 2 covered: Nimbalyst, Perfect-Web-Clone/Nexting, NanoClaw, beadle, AgentBreeder, phuryn/claude-usage, claude-code-build-framework, Claude Code Builder, siteboon-claude-code-ui (CloudCLI), Stargx's Claude Code Dashboard, SuperClaude Framework, and the ecosystem landscape scan's "Top 15 missed projects" profiles.

Every entry below cites the upstream project it came from and the `RESEARCH_MERGED.md` section it was pulled from, so you can go read the original research before implementing anything. Nothing here has been built — this is a prioritization input, not a changelog.

## Read this first

**Security finding, not just a feature idea:** several entries below (see "Chat & Permissions") point out that Loush's own chat currently runs fully unsandboxed via `--dangerously-skip-permissions`. That's flagged by the research as worse than the permission model of at least one of the upstream projects surveyed (siteboon's CloudCLI) and is called out as the single highest-integrity fix available in this whole list — read the "Browser-rendered permission prompts" entry before anything else.

**Licensing legend** — check this before copying any code, not just borrowing an idea:

| Tag | Meaning |
|---|---|
| MIT / Apache-2.0 | Safe to copy code directly, with attribution. |
| **AGPL-3.0-or-later (§7 terms)** | siteboon/claudecodeui. Port the *design*, never paste source, without written permission naming specific files. |
| **Elastic License 2.0** | context-mode. Reimplement independently; do not copy source. |
| **No LICENSE file / `license: null`** | CAST, Nexting/Perfect-Web-Clone, ciscoittech's Claude Agent Framework. GitHub reports these as unlicensed regardless of README badges — default is all-rights-reserved. The research notes some authors gave explicit permission to copy; if you rely on that, record it in the ported file's header.
| **No license declared** | claude-doctor (landscape scan). Treat as a design/definitions study only — do not copy code. |

Below, each feature keeps the exact sourcing and "where to add" detail the scanning agents produced.

---

## Security, Governance & Access Control

### CLAUDE.md base-ref config restore (governance guard against PR-injected agent config)
- **Source**: claude-code-action (RESEARCH_MERGED.md, Feature inventory / Identity)
- **What**: Before running, the action restores `CLAUDE.md`, `.claude/`, `.mcp.json`, `.claude.json`, `.gitmodules`, `.ripgreprc`, `.husky` from the base branch (not the PR head), copying the PR's own versions aside to `.claude-pr/` so the agent can review but not obey them. This prevents a PR from smuggling in modified agent instructions.
- **Where to add**: `src/sections/GovernanceSection.jsx` + `server/eng.mjs` (new PR file-list filter using the same `SENSITIVE_PATHS` list)
- **Caveats**: None noted (MIT).

### Sensitive-path PR flag (governance event on agent-config changes)
- **Source**: claude-code-action (RESEARCH_MERGED.md, Recommended adoptions, via claude-code-security-review section)
- **What**: Reuse the action's `SENSITIVE_PATHS` list (`.claude`, `.mcp.json`, `.claude.json`, `.gitmodules`, `.ripgreprc`, `CLAUDE.md`, `CLAUDE.local.md`, `.husky`) as a filter over a PR's changed-file list already fetched by our GitHub integration, flagging "this PR changes what the agent is allowed to do" as a first-class governance event.
- **Where to add**: `src/sections/GovernanceSection.jsx`, `server/eng.mjs`
- **Caveats**: None noted (MIT).

### Repo-write safety guard (origin/remote identity check)
- **Source**: ccpm (RESEARCH_MERGED.md, Feature inventory; Gaps/Supply-chain incident; Recommended adoptions)
- **What**: Before any write to GitHub/JIRA, validates the inferred remote/repo identity matches expectations, preventing the class of accident where a tool infers the wrong target repo and writes to strangers' issues (which is exactly what happened in ccpm's own upstream issue tracker).
- **Where to add**: `server/eng.mjs`, guarding `/api/eng/pr/:num/comment`, `/api/eng/pr/:num/request-review`, `/api/eng/ticket/:key/transition`, `/api/eng/ticket/:key/comment`
- **Caveats**: MIT-licensed. Note: never copy ccpm's *installer* (the `curl | bash` install path was implicated in an XMRig cryptominer supply-chain compromise, issue #1016) — only copy the plain markdown/bash from a git checkout, never a hosted installer URL.

### Fail-closed control gate + path-traversal guard
- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A middleware that returns 404/503/403 by default on write routes unless a constant-time-compared token is presented (fail-closed), plus a `safeResolve(base, ...parts)` helper that returns null if a resolved path escapes its base directory.
- **Where to add**: `server/index.mjs`, mounted on every write route (setup writes, config writes, ticket writes)
- **Caveats**: No LICENSE file on CAST (permission to copy already obtained per research — record it).

### Local-only security hardening (loopback bind, Host-header allowlist, optional token gate)
- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `security.js`; Recommended adoptions)
- **What**: Binds to loopback by default, restricts CORS to loopback, enforces a Host-header allowlist to prevent DNS-rebinding attacks, and offers an optional bearer/`x-dashboard-token` gate on API routes and the WS upgrade — closing a class of vulnerability CCAM itself had a CVE for (GHSA-gr74-4xfh-6jw9).
- **Where to add**: `server/index.mjs` + new `server/security.mjs`
- **Caveats**: None noted (MIT). Research says do this regardless of anything else, since Loush's server also reads transcripts and writes config.

### PII detection and redaction middleware
- **Source**: Claude Code Dashboard / "CSI" (RESEARCH_MERGED.md, Feature inventory `pii-detector.ts`; Recommended adoptions)
- **What**: A middleware applying 9 regex patterns to detect PII (API keys, etc.) in response content and redact matches right-to-left so index offsets stay valid, applied wherever transcript content reaches a client response.
- **Where to add**: new `lib/pii.mjs`; called from `server/index.mjs`, especially the usage/session/forensics readers and any `ChatSection.jsx` SSE stream
- **Caveats**: MIT-licensed. Research flags CSI's `ipv4`/`email` patterns as over-broad — make those two opt-in rather than defaults.

### Outbound-network guard (enforced local-first claim)
- **Source**: Claude Code Dashboard / "CSI" (RESEARCH_MERGED.md, Feature inventory `network-guard.ts`; Recommended adoptions)
- **What**: Patches `net.Socket.prototype.connect` to allowlist only `127.0.0.1`/`localhost`/`::1`/`0.0.0.0`, recording any blocked outbound connection attempt — turning a "local-first, zero telemetry" README claim into an enforced, auditable invariant.
- **Where to add**: new `lib/network-guard.mjs`, imported as the first statement of `server/index.mjs`
- **Caveats**: MIT-licensed. If Loush spawns Claude as a child process anywhere, children are unaffected by this guard — document the guarantee precisely as "this process makes no outbound connections," not a blanket zero-outbound claim.

### Safe markdown rendering without dangerouslySetInnerHTML
- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `MarkdownContent.tsx`; Recommended adoptions)
- **What**: A hand-written markdown renderer (fenced code, headings, lists, task lists, blockquotes, tables, inline formatting) that builds a React element tree directly instead of using `dangerouslySetInnerHTML`, removing an XSS surface on untrusted transcript content; paired with a TUI-tag/ANSI-stripping segment parser.
- **Where to add**: `src/sections/ChatSection.jsx`, `ForensicsSection.jsx`; replaces any `marked`-based rendering of untrusted content
- **Caveats**: None noted (MIT).

### Declarative run-expectations schema + explainable 0-100 execution score
- **Source**: Claude Agent Framework / ciscoittech (RESEARCH_MERGED.md, Feature inventory `task_expectations`/`validate_execution.py`; Recommended adoptions)
- **What**: A schema mapping a regex task pattern to expected agents/files/artifacts/limits, scored against an actual run to produce a violations list and an explainable 0-100 score. Loush's version can apply this *retroactively* over 90 days of existing transcript history, which upstream can only validate going forward on live runs.
- **Where to add**: extend `/api/gov/evals` with an expectations store; UI in `src/sections/GovernanceSection.jsx`
- **Caveats**: No LICENSE file on this repo — permission recorded per research; record it in the ported file's header.

### Manifest/registry integrity checker for dangling capability paths
- **Source**: Claude Agent Framework / ciscoittech (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Resolves every path referenced by any manifest (`REGISTRY.json`-style), `settings.json` hook script, or MCP config against the actual filesystem and reports dangling/broken entries — catching silent breakage (the research notes the upstream framework itself currently ships an 8-path bug of exactly this kind on its own main branch).
- **Where to add**: alongside existing `/api/gov/drift` in Governance; surfaced in a Library section
- **Caveats**: Same no-LICENSE/permission-recorded caveat.

### Two-dimensional trust model (transport trust + rwx permission matrix)
- **Source**: B2 / beadle (RESEARCH_MERGED.md, Feature inventory / Project-specific deep dives)
- **What**: Combines a 4-level transport-trust classification with an orthogonal `rwx` permission matrix keyed `permissions[identity][contact] → "rwx"|"rw-"|"r--"|"---"`. Defaults are whitelist-only (`---`), no inheritance between identity cells, and a "redacted listing" mode shows sender/date/trust metadata without exposing gated content.
- **Where to add**: new `server/access.mjs` + a new "Access" tab in `src/sections/GovernanceSection.jsx`, retargeting the matrix from `(identity, contact)` to `(profile, project)`: `r`=dashboard may read/display a project, `w`=may write into it, `x`=may run commands against it. Store as JSON under `~/.claude/dashboard-access.json`.
- **Caveats**: MIT licensed. The 4-level transport-trust part is not portable (only meaningful for messages arriving from strangers over a network) — skip it, per the research's own recommendation.

### Per-session Docker container isolation — explicitly NOT recommended
- **Source**: B1 / NanoClaw (RESEARCH_MERGED.md, Feature inventory)
- **What**: One long-lived Docker container per session with 9 fixed mounts, mount allowlists, symlink-traversal defense, and fail-closed defaults. Flagged as wrong threat model for a local-first single-user tool.
- **Where to add**: Not directly applicable — do not adopt wholesale. The one salvageable piece (a fail-closed allowlist file outside the project root listing which repo roots may be read) folds into the rwx Access tab idea above.
- **Caveats**: Explicitly NOT recommended per the research.

### 8-step deploy pipeline with an approval gate between RBAC and provisioning
- **Source**: C / AgentBreeder (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: An approval-gate *placement* principle: approval runs strictly between an RBAC check and any resource-provisioning step, so an unapproved agent never gets resources or credentials minted, and admin bypass is itself audited.
- **Where to add**: apply the gate-placement principle (not the full multi-cloud pipeline) to `GovernanceSection.jsx`'s existing Approvals tab.
- **Caveats**: Apache-2.0. Adopt only the vocabulary/gate-placement rule, not the pipeline (presupposes multi-tenant infra Loush doesn't have).

### Immutable audit event schema + resource lineage graph
- **Source**: C / AgentBreeder (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: An `AuditEvent` record with denormalized `resource_name` (readable after the resource is deleted) and a free-form JSON `details` column, paired with a `ResourceDependency` edge table for impact analysis ("what depends on this prompt/hook/MCP server?").
- **Where to add**: whatever backs `GET /api/gov/*` today, feeding the existing "Audit log" tab in `GovernanceSection.jsx`; render lineage edges with the existing d3 setup used by `PlanGraph.jsx`.
- **Caveats**: Apache-2.0, schema/pattern only (their in-memory service implementation is flagged as not durable — don't copy that part).

### Action-verb vocabulary and gate-placement rule for governance
- **Source**: C / AgentBreeder (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A standard verb set `{read, use, write, deploy, publish, admin}` as the vocabulary for permission/approval UIs, plus the rule that admin bypasses of any gate are themselves audited events.
- **Where to add**: `GovernanceSection.jsx` (Approvals tab) and the new Access tab (from the beadle item), plus documented as policy in `docs/`.
- **Caveats**: Apache-2.0, documentation-level adoption.

### 75-item production-readiness freeze audit
- **Source**: A. claude-code-build-framework (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A numbered, categorized 75-item checklist (`FA-001`…`FA-075`) gating production release, emitting a `READY TO FREEZE` or `READ-ONLY PLAN` verdict token.
- **Where to add**: new "Freeze audit" tab in `src/sections/GovernanceSection.jsx`; checklist data in a new `src/data/checklists/freeze-audit.js`; done-state persisted via the existing `track()` mechanism.
- **Caveats**: MIT. ~20 of 75 items are Supabase/Discord/Railway/React-specific — tag them `appliesTo: supabase` and hide by default.

### Auto-checkable subset of the freeze audit against a real repo
- **Source**: A. claude-code-build-framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Machine-verifiable checks for ~8 of the 75 audit items against a real checkout: `.claude/agents/` non-empty, `.claude/hooks/pre_tool_use.py` exists, `settings.json` has `hooks` + `permissions.defaultMode`, `settings.local.json` gitignored, `.env.example` keys match `process.env` usage, `git status` clean.
- **Where to add**: new `/api/gov/freeze-audit?project=` endpoint in `server/index.mjs`, feeding the Freeze Audit tab with `auto: pass|fail|n-a` alongside manual ticks.
- **Caveats**: MIT. Flagged as the single highest-value differentiator — "nobody else auto-attests a production-readiness checklist against a real repo."

### Tiered security framework (0–3) with auto-escalation
- **Source**: A. claude-code-build-framework (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Four security tiers with additive inheritance and auto-escalation rules (e.g. any MCP/plugin usage → Tier 1+, money movement → Tier 3), backing 81 tier-conditional audit items across network allowlisting, credentials, action tiers, audit logging, supply chain, session security, agent security, canary detection, and plugin/skill validation.
- **Where to add**: `src/data/checklists/security-tiers.js` + a "Security tier" tab (or sub-tab of the Freeze Audit tab) in `GovernanceSection.jsx`.
- **Caveats**: MIT.

### Skill security content scanner
- **Source**: A. claude-code-build-framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Six scan patterns run over skill instruction text to flag skills that expose credentials, bypass governance, transmit to undeclared endpoints, suppress logging, grant excessive tool access, or conflict with the declared security tier — including a rule that internally-authored skills are not exempt.
- **Where to add**: new `/api/security/skill-audit` endpoint in `server/index.mjs` scanning `~/.claude/skills/**/*.md` and project `.claude/skills/`, surfaced as a tab in `src/sections/QualitySection.jsx`.
- **Caveats**: MIT. Entirely local-first.

### Three new hook-library entries (governing-doc protection, PreCompact phase-gate, install warnings)
- **Source**: A. claude-code-build-framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: (a) a PreToolUse hook blocking writes to `CLAUDE.md`/`prd.md`/`AGENTS.md`; (b) a PreCompact hook that re-injects phase-gate/re-read-`STATE.md` reminders (Loush currently has zero PreCompact hook-library entries); (c) a PreToolUse Bash hook warning on installs of packages not in an approved list.
- **Where to add**: `HOOK_LIBRARY` in `server/index.mjs`.
- **Caveats**: MIT. Port to Node rather than Python; their `rm -rf` blocking rule is weak — Loush's existing `git-guardrails-claude-code` skill is already better, don't replace it.

### 44-item plugin/MCP validation checklist
- **Source**: A. claude-code-build-framework (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A checklist across five component risk tiers (skills → tools → hooks/scripts → commands) for validating third-party plugins and MCP servers before use.
- **Where to add**: `src/sections/McpSection.jsx` or a Capabilities section, per-server checklist, partially auto-fillable from Loush's existing MCP server inventory.
- **Caveats**: MIT; lower priority (long, largely manual attestation).

### Observe→propose→write closed feedback loop for CLAUDE.md rules
- **Source**: Claude Code ecosystem landscape scan — `millionco/claude-doctor` (RESEARCH_MERGED.md, Top 15 missed projects — profiles)
- **What**: Analyzes historical transcript behavior and emits paste-ready CLAUDE.md/AGENTS.md rules addressing detected anti-patterns (a `--rules` mode).
- **Where to add**: combine with Loush's existing config-writing-with-backup capability in `GovernanceSection.jsx`/`server/constitution.mjs` to produce "observe behavior → propose rule → write it to real config with a timestamped backup."
- **Caveats**: No license declared — design study only, do not copy code.

---

## Cost, Pricing & Usage Accounting

### Cost estimation module with per-model/cache-tier rates
- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Notable code worth stealing; Recommended adoptions)
- **What**: A ~50-line module providing a per-model `{input, output, cacheWrite, cacheRead}` USD/M-token pricing table with family-prefix fallback.
- **Where to add**: new `server/cost.mjs`; consumed by `src/sections/UsagePanel.jsx`, `Overview.jsx`, `InsightsSection.jsx`
- **Caveats**: No LICENSE file on CAST (permission to copy already obtained per research — record it).

### CI-run cost ingestion via execution file
- **Source**: claude-code-security-review / claude-code-action (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: When a workflow uploads the action's `execution_file` as a build artifact, the final `type: "result"` JSON element contains `total_cost_usd` and `duration_ms` — the only file-based way to get real CI agent-run cost.
- **Where to add**: `server/eng.mjs` + `src/sections/RunsSection.jsx`; ship a copy-pasteable `upload-artifact` snippet in `SetupSection.jsx`
- **Caveats**: Requires an extra workflow step; MIT.

### Subagent token roll-up with dominant-model election
- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: When rolling up a session's tokens, also sum `<session>/subagents/*.jsonl` token usage into the parent, and elect a "dominant model" for the session by assistant-message frequency rather than just the top-level model.
- **Where to add**: `server/index.mjs` (existing session-walking code)
- **Caveats**: No LICENSE file on CAST — permission recorded per research.

### Delegation-savings metric (haiku vs sonnet re-pricing), labeled as modeled
- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Re-prices haiku-model sessions at sonnet rates to compute `savedUSD = max(0, sonnetEquivalent − actualHaiku)`, plus a haiku-utilization percentage across sessions.
- **Where to add**: `src/sections/InsightsSection.jsx`
- **Caveats**: No LICENSE file on CAST. Explicitly a counterfactual — label as "modeled" with assumptions stated inline.

### Time-aware pricing with token bucketing across service tiers
- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `token-usage.js`, `DEFAULT_PRICING`; Recommended adoptions)
- **What**: Buckets token usage by `(model, speed, inference_geo, service_tier)` and applies a wildcard-pattern default pricing table with `asOf`-aware rate lookup supporting time-limited intro pricing, so historical cost calculations stay correct across price changes.
- **Where to add**: `src/sections/UsagePanel.jsx`, wherever cost is computed in `server/`
- **Caveats**: MIT. An unpriced model should surface as unpriced, not silently render as $0.

### Corrected per-model pricing table (10-entry, 4-rate)
- **Source**: Claude Code Dashboard / "CSI" (RESEARCH_MERGED.md, Feature inventory `cost-engine/src/pricing.ts`; Recommended adoptions)
- **What**: A 10-entry per-model pricing table (4 rates each) with regex matching and fallback, used to replace a flat/incorrect pricing constant.
- **Where to add**: new `lib/pricing.mjs`, replacing existing flat-rate constants; consumed by `UsagePanel`, `Overview`
- **Caveats**: MIT. Research notes Loush's current numbers reportedly overstate certain models by ~3x.

### Real per-model pricing table with an "unpriced" state
- **Source**: Claude Code Usage Dashboard / phuryn (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: An explicit `{input, output}` USD-per-1M-token table per model plus an `isBillable()` gate so unrecognized/local models render as "n/a" instead of silently defaulting to another model's price. Cross-checked in the research: Loush's current Opus pricing is 3× overstated, Fable 1.5×.
- **Where to add**: new `server/pricing.mjs` exporting `PRICING`, `getPricing(model)`, `isBillable(model)`, `calcCost(...)`; replace `server/index.mjs`'s `PRICE_PER_M` and `entryCost`.
- **Caveats**: MIT. Flagged as a correctness bug fix — do first, ahead of any new feature in this document.

### Cache-creation TTL-aware cost split (5-min vs 1-hour buckets)
- **Source**: Claude Code Usage Dashboard / phuryn (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Reads `message.usage.cache_creation.ephemeral_5m_input_tokens` and `.ephemeral_1h_input_tokens` separately and prices the 1-hour bucket at 2× the 5-minute rate, since upstream currently underprices this by ~49% on cache-write cost.
- **Where to add**: `server/pricing.mjs` (same module as above), verified first against whether this field is actually present in our transcript corpus.
- **Caveats**: MIT; verify the field exists before shipping — fall back to flat rate and label it if absent.

### Streaming-turn dedup by `message.id`
- **Source**: Claude Code Usage Dashboard / phuryn, and ccusage (RESEARCH_MERGED.md, Recommended adoptions; Top 15 missed projects)
- **What**: Keeps only the last record per `message.id` within a file when tallying usage, since the same logical turn can otherwise be counted multiple times as streaming placeholders update. Independent measurement cited in the research reports 51–55% duplicate entries in real corpora.
- **Where to add**: the per-file parse loop in `collectUsage()`, `server/index.mjs`.
- **Caveats**: MIT. Verify on a real transcript first — this is likely a live over-count, not theoretical.

### Cost by Project & Branch view
- **Source**: Claude Code Usage Dashboard / phuryn (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A dedicated table/view breaking down cost and token spend by project and git branch together.
- **Where to add**: `src/sections/ProjectsSection.jsx` or `UsagePanel.jsx`, fed from `rec.branches` already computed in `server/index.mjs` but not currently surfaced.
- **Caveats**: MIT; purely a rendering gap, data already collected.

### Subagent dispatch attribution ingestion
- **Source**: Claude Code Usage Dashboard / phuryn (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Detects subagent records via `isSidechain`/`agentId`/`/subagents/` path signals, extracts dispatch metadata, and buckets auto-compaction separately — answering "which subagent type costs the most."
- **Where to add**: `collectUsage()` in `server/index.mjs` (add `isSubagent`/`agentId` per entry plus a parallel `agents` map), surfaced in `RunsSection.jsx` or `UsagePanel.jsx`.
- **Caveats**: MIT; complements (doesn't replace) `CapabilityLedger`'s always-on-load measurement.

### Table paging (10→25→50, ≤12 never paginates) + CSV export
- **Source**: Claude Code Usage Dashboard / phuryn (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A three-tier progressive table-paging pattern paired with a "Download CSV to see all (N)" footer, and CSV export of the full filtered dataset.
- **Where to add**: new `src/ui/TableFooter.jsx` + `src/lib/csv.js`, applied across `SessionsSection.jsx`, `ProjectsSection.jsx`, `RunsSection.jsx`, `BugsSection.jsx`.
- **Caveats**: MIT.

### Hour-of-day usage distribution + peak-hour highlighting
- **Source**: Claude Code Usage Dashboard / phuryn (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A 24-bucket hour-of-day chart with local/UTC toggle and a highlighted "peak-hour" band.
- **Where to add**: `ActivityTimeline.jsx` or `UsagePanel.jsx`.
- **Caveats**: MIT. Note Anthropic reportedly removed peak-hour reduction on 2026-05-06 — verify relevance before shipping, and restrict the band to weekdays with a real timezone offset (upstream doesn't).

### Subscription-plan-aware quota bar (5-hour + weekly window)
- **Source**: phuryn/claude-usage research, flagged as "ours to build" — no upstream implementation exists
- **What**: A plan-tier-aware usage panel showing percent-consumed of the rolling 5-hour window (already computed as `activeBlock`) and a separate weekly cap, self-calibrated from the user's own observed rate-limit events.
- **Where to add**: extend `server/index.mjs`'s existing `activeBlock` computation; new plan-limits panel in `UsagePanel.jsx`.
- **Caveats**: Published per-plan hour figures are stale/unverified — don't hardcode them; token-denominated bars are estimates and must be labeled as such.

### PostToolUse prompt-hook cost pricing
- **Source**: SuperClaude Framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Recognizing a `type: "prompt"` hook on `Write`/`Edit` costs an extra model turn per edit, priced using existing per-session `Write`/`Edit` tool-call counts.
- **Where to add**: `src/sections/HooksSection.jsx`, `customizeHooks()` in `server/index.mjs`.
- **Caveats**: None noted; extends the Capability Ledger cost-attribution idea to hooks specifically.

### Cache-hit-rate metric (turn and session scope)
- **Source**: Claude Code ecosystem landscape scan — `sirmalloc/ccstatusline` (RESEARCH_MERGED.md, Top 15 missed projects)
- **What**: Surfacing `cache_read_input_tokens / (cache_read + cache_creation + regular input)` as an explicit ratio metric at both per-turn and per-session scope.
- **Where to add**: `UsagePanel.jsx`.
- **Caveats**: MIT; cheap derived-metric addition, raw fields already exist.

### Anonymized data export (CSV/JSON, path/prompt-stripped)
- **Source**: Claude Code Dashboard / "CSI" (RESEARCH_MERGED.md, Feature inventory `routes/export.ts`; Recommended adoptions)
- **What**: A dedicated `/api/export/anonymized` mode that strips project paths, prompt text, and branch names, alongside RFC-style CSV quote-escaping.
- **Where to add**: new `server/export.mjs`; surfaced from `UsagePanel.jsx`
- **Caveats**: MIT. Combine with the PII-redaction feature above so non-anonymized exports are also redacted.

---

## Live/Real-time Infrastructure

### JSONL filesystem-watcher → SSE live event bus
- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: chokidar-watches `~/.claude/projects`, tail-reads only the last 256KB of an appended JSONL file, and broadcasts typed SSE events with a 15s heartbeat and replay of the last 15 events tagged `historical: true` on new connections.
- **Where to add**: new `server/live.mjs` + `/api/events`; `src/lib/useLiveEvents.js` hook consumed first by `ActivityTimeline`/`WorkingSet`
- **Caveats**: No LICENSE file on CAST — permission recorded per research. Fix real bugs while porting: hardcoded `/` path separator breaks Windows, no `res.writableEnded` guard on broadcast, missing exponential backoff on the client.

### Event-driven query-cache invalidation
- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Maps typed SSE "something changed" frames to specific cache-key invalidations, removing polling intervals.
- **Where to add**: new `src/lib/resourceCache.js`, wired to the live-events hook above
- **Caveats**: No LICENSE file on CAST. Do this only after the live-event-bus feature ships.

### WebSocket transport + client event bus (with reconnect/StrictMode guards)
- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A WebSocket-based live-update transport plus a client event bus, including a StrictMode duplicate-socket guard and reconnect triggered on focus/online/visibilitychange events.
- **Where to add**: new `src/lib/eventBus.js`, `src/hooks/useWebSocket.js`, `server/websocket.mjs`
- **Caveats**: None noted (MIT).

### Fire-and-forget hook receiver for mid-turn visibility
- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `POST /api/hooks/event`; Recommended adoptions)
- **What**: A hook script piping stdin JSON via HTTP POST to every live dashboard instance without awaiting a response, plus a single ingestion endpoint that upserts session/agent state from the 8 standard Claude Code hook types. This is what lets a dashboard show activity while an agent turn is still running.
- **Where to add**: new `server/hooks.mjs`, `scripts/hook-handler.mjs`; UI hooks into `SetupSection.jsx`/`HooksSection.jsx`
- **Caveats**: None noted (MIT). Research calls this "the single biggest capability gap" Loush currently has (only ever showing what already finished).

### Incremental transcript cache (mtime+size keyed, byte-range reads)
- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `transcript-cache.js`; Recommended adoptions)
- **What**: Caches parsed transcript data keyed by `(mtime, size)`, doing incremental byte-range reads on append, handling truncation edge cases, LRU-bounded.
- **Where to add**: new `server/transcriptCache.mjs`, used by every section reading `~/.claude/projects`
- **Caveats**: None noted (MIT).

### Global data-scope filter store
- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `dataScope.ts`; Recommended adoptions)
- **What**: A single client-side store that narrows every aggregate query by project/source with automatic query-param injection into the fetch wrapper.
- **Where to add**: new `src/lib/dataScope.js`
- **Caveats**: None noted (MIT).

### Byte-offset incremental file tailing
- **Source**: Claude Code Dashboard "CSI" / Stargx / phuryn (RESEARCH_MERGED.md, Feature inventory `routes/live.ts`; Recommended adoptions, multiple projects)
- **What**: Tracks a per-file byte-offset map and reads only newly appended bytes, with the rule "on first sight of a file, record its size — don't replay its whole history" — enabling live-tailing of sessions started in other terminals.
- **Where to add**: `server/index.mjs` alongside existing SSE plumbing; feeds `ActivityTimeline.jsx`, `RunsSection.jsx`
- **Caveats**: MIT (all sources). Fix the boundary bugs the originals have — pass an explicit `end` to the read stream and carry any trailing partial line forward instead of dropping it (Stargx's own implementation loses partial lines and has a stat-before-open race causing duplicate reads).

### chokidar watcher on `~/.claude/projects` pushing live session upserts
- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A debounced (500ms/2s max-wait) filesystem watcher over the transcript directory that pushes delta `session_upserted` events rather than requiring a client poll or full re-scan.
- **Where to add**: `server/index.mjs` (or new `chat-ws.mjs`), consumed by `SessionsSection.jsx`, `ActivityTimeline.jsx`, `InboxSection.jsx`, `Overview.jsx`.
- **Caveats**: AGPL-3.0-or-later — port the debounce/delta design, not source.

### Live "Now" session board with waiting/thinking/idle status
- **Source**: Claude Code Dashboard (Stargx) (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A `deriveStatus()` state machine classifying each active session as `thinking`/`waiting`/`idle`/`error` from recency and last-content-type signals, plus idle-session collapsing and an `idle-stale` tier for sessions idle since before local midnight.
- **Where to add**: new `src/sections/LiveSection.jsx` (or a "Now" tab in `SessionsSection.jsx`); new `GET /api/live` in `server/index.mjs`; polled every ~2s client-side (no WebSocket needed).
- **Caveats**: MIT. Render `unknown` rather than `idle` when `lastEventAt` is absent, unlike upstream. Flagged as the single highest user-visible payoff item in the whole Stargx research.

### Context-window pressure bar
- **Source**: Claude Code Dashboard (Stargx) (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Computes `lastTurnInputTotal = in + cacheCreate + cacheRead` for the most recent assistant turn, rendered as a percentage-of-context-window bar with a blue→yellow(>50%)→red(>80%) ramp.
- **Where to add**: the new Live session board and/or `WorkingSet.jsx`; a historical version fits `ResourceSection.jsx`.
- **Caveats**: MIT. Make the denominator model-aware, not a hardcoded 200K; render "unknown" rather than a plausible-looking fallback number when the figure is missing.

### Permission-mode risk badges on live sessions
- **Source**: Claude Code Dashboard (Stargx) (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Reads the session's `permissionMode` event field and renders a red "YOLO" badge for `bypassPermissions` or a yellow "AUTO-EDIT" badge for `acceptEdits`, live, per running session.
- **Where to add**: the Live session board, `GovernanceSection.jsx`, `HarnessSection.jsx`.
- **Caveats**: MIT.

### Live subagent rollup (active subagents right now)
- **Source**: Claude Code Dashboard (Stargx) (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Tracks per-`agentId` subagent activity keyed by event stream, capturing the dispatched task from the first user message, filtered to only currently-active subagents.
- **Where to add**: the Live session board and `RunsSection.jsx`; reconcile with Loush's existing directory-based subagent discovery rather than replacing it.
- **Caveats**: MIT.

---

## Sessions, Transcripts & Forensics

### Structured Work Log parser as a second files-changed signal
- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Parses `## Work Log` markdown sections from agent output into `{items, filesRead, filesChanged, codeReviewerResult, testWriterResult, decisions}` — a self-reported files-changed list that cross-checks the tool-call-derived edit list and catches edits made via Bash that tool-call parsing misses.
- **Where to add**: `server/index.mjs` transcript parsing → feeds `WorkingSet`/`ActivityTimeline.jsx`
- **Caveats**: No LICENSE file on CAST — permission recorded per research.

### Parent→child agent-tree reconstruction via promptId
- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: 200ms after a subagent JSONL file appears, reads its `promptId` and scans sibling session files for a matching `promptId` to reconstruct a real parent→child agent tree from otherwise-flat transcript files.
- **Where to add**: `src/sections/PlanGraph.jsx`, `ActivityTimeline.jsx`
- **Caveats**: No LICENSE file on CAST. Fix the original's race-condition sleep and O(files×100 lines) scan — cache the `promptId → agentId` map per session directory instead of re-scanning.

### Event grouping / per-tool-call summary renderers
- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `event-grouping.ts`, `tool-views.tsx`; Recommended adoptions)
- **What**: Converts raw JSONL tool-call rows into human-readable titles/summaries per tool type, including `firstEnclosingContext()` which extracts the enclosing function name from a diff hunk header — described as the highest value-per-line idea in the whole CCAM codebase.
- **Where to add**: `src/lib/eventGrouping.js`, `src/lib/eventSummary.js`, `src/components/eventViews/`; consumed by `ActivityTimeline.jsx`, `ForensicsSection.jsx`
- **Caveats**: None noted (MIT).

### Subagent tool-call attribution from raw JSONL (no hooks required)
- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `scanAndImportSubagents`; Recommended adoptions)
- **What**: Parses `subagents/agent-*.jsonl` files and pairs `tool_use` with `tool_result` events by `tool_use_id` to reconstruct tool calls that never fire any hook event.
- **Where to add**: `SessionsSection`/`ForensicsSection`/`WorkingSet` transcript parsing
- **Caveats**: None noted (MIT). Doable today without the hook-receiver feature.

### File-history-snapshot and compaction-boundary record parsing
- **Source**: Claude Code Dashboard / "CSI" (RESEARCH_MERGED.md, Feature inventory session.ts record schema; Recommended adoptions)
- **What**: Recognizes `file-history-snapshot` records (a "files modified" count) and `system` records with `subtype: 'compact_boundary'` (context compactions counted) — both cheap, currently-missing derived metrics.
- **Where to add**: add the two derived metrics to session parsing in `server/index.mjs`, surfaced in `WorkingSet`/`ForensicsSection.jsx`
- **Caveats**: MIT-licensed; take as a schema reference, not a code port.

### `EventPriority` density ladder for activity timelines
- **Source**: context-mode (RESEARCH_MERGED.md, Feature inventory `src/types.ts`; Recommended adoptions)
- **What**: A four-level priority enum (`LOW: 1, NORMAL: 2, HIGH: 3, CRITICAL: 4`) used to filter/budget which events are shown in a long session view.
- **Where to add**: `src/sections/ActivityTimeline.jsx`, `SessionsSection.jsx` as a density control
- **Caveats**: Elastic License 2.0 — reimplement independently, the enum concept is trivial to redo from scratch.

### Compaction-boundary tracking (tokens reclaimed per compaction)
- **Source**: Claude Code ecosystem landscape scan — `sirmalloc/ccstatusline` (RESEARCH_MERGED.md, Top 15 missed projects)
- **What**: Treats `system` transcript entries with `compactMetadata` (`preTokens`, `postTokens`, `trigger`, `durationMs`) as a first-class marker, counting compactions and tokens reclaimed by each.
- **Where to add**: `SessionsSection.jsx` / `ContextExplorerSection.jsx`.
- **Caveats**: MIT. Confirmed present in real transcripts per the research's schema survey.

### Full-text search across all historical sessions
- **Source**: Claude Code ecosystem landscape scan — `nikitadoudikov/claude-pulse` (RESEARCH_MERGED.md, Top 15 missed projects)
- **What**: Full-text search across every session transcript ever run, not just the currently displayed list.
- **Where to add**: `SessionsSection.jsx` / `ContextExplorerSection.jsx`.
- **Caveats**: MIT.

### Lost/abnormally-ended session recovery detection
- **Source**: Claude Code ecosystem landscape scan — `nikitadoudikov/claude-pulse` (RESEARCH_MERGED.md, Top 15 missed projects)
- **What**: Surfaces sessions that ended abnormally (crashed/killed) so the user can identify and resume them, purely from local transcript state.
- **Where to add**: `SessionsSection.jsx`.
- **Caveats**: MIT.

### Behavioral anti-pattern signal definitions (edit-thrashing, error-loop, etc.)
- **Source**: Claude Code ecosystem landscape scan — `millionco/claude-doctor` (RESEARCH_MERGED.md, Top 15 missed projects)
- **What**: Named, concretely thresholded transcript-derived signals: `edit-thrashing` (same file edited 5+ times in one session), `error-loop` (3+ consecutive tool failures without changing approach), `excessive-exploration` (read-to-edit ratio >10:1), `restart-cluster`, `high-abandonment-rate`, `correction-heavy` (20%+ of user messages start with "no"/"wrong"/"wait"), `repeated-instructions` (Jaccard >60% within 5 turns), plus AFINN-165 sentiment scoring.
- **Where to add**: `ForensicsSection.jsx`, `InsightsSection.jsx`, `QualitySection.jsx`, `PromptQuality.jsx`.
- **Caveats**: No license declared — design/definition study only, do not copy code. Validate against Loush's existing WorkingSet "rework rank" metric.

---

## Context Explorer & Prompt/Model Insight

### Honest per-tool context-consumption breakdown ("where your window actually went")
- **Source**: context-mode (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions, via the manifest comparison section)
- **What**: A real per-session breakdown of prompt-token size per turn and per-tool bytes-returned (grouped by tool name), ranking which tools are the biggest context consumers — instead of context-mode's own hardcoded-constant savings estimate, which the research flags as unreliable.
- **Where to add**: extend the existing `/api/context/:sessionId` handler in `server/index.mjs` to emit a `byTool` aggregate; render as a stacked band in `src/sections/ContextExplorerSection.jsx`, rolled up in `HarnessSection.jsx`
- **Caveats**: Elastic License 2.0 — do NOT copy source code; only the idea/finding is being reused, with an independent implementation.

### Turn-to-turn context diff visualization
- **Source**: Claude Code ecosystem landscape scan — `jianshuo/ccglass` (RESEARCH_MERGED.md, Top 15 missed projects)
- **What**: A diff view showing exactly what changed in the model's context between consecutive turns (system prompt, tool schemas, message history) — described in the research as "the single best feature idea I found for ContextExplorer."
- **Where to add**: `src/sections/ContextExplorerSection.jsx`, computed over transcript data Loush already parses (no full wire-level proxy needed).
- **Caveats**: MIT. The full proxy-based wire capture (ccglass's own approach) is high-effort/new-runtime-component — lower priority than the diff visualization alone over existing transcript data.

### Offline prompt-complexity / cost-tier classifier
- **Source**: manifest (RESEARCH_MERGED.md, Feature inventory `scoring/config.ts`, `sigmoid.ts`; Recommended adoptions)
- **What**: A 32-dimension request scorer (22 keyword + 10 structural dimensions) feeding a sigmoid+confidence function that classifies a turn into a tier (`simple|standard|complex|reasoning`), with a "momentum" mechanism carrying the prior turn's tier forward.
- **Where to add**: new `lib/complexity.mjs`, consumed when building `/api/usage`/`/api/insights` in `server/index.mjs`; rendered in `InsightsSection.jsx` and a prompt-quality section
- **Caveats**: MIT — safe to copy directly. Research calls this "the highest-value idea in the whole survey" — enables claims like "you paid Opus rates for 340 simple-tier turns last month."

### Cross-provider error taxonomy
- **Source**: manifest (RESEARCH_MERGED.md, Feature inventory `error-taxonomy.ts`; Recommended adoptions)
- **What**: A normalized classification of provider-side errors (rate limits vs real failures vs auth errors), enabling "37% of your failed turns were rate limits, not bugs."
- **Where to add**: `src/sections/ReliabilitySection.jsx`, `BugsSection.jsx`, fed by error entries already present in parsed JSONL
- **Caveats**: MIT, safe to copy directly.

### Mistake→rule→fix "Lessons" ledger schema
- **Source**: SuperClaude Framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A structured JSONL schema (`ts`/`task`/`mistake`/`evidence`/`rule`/`fix`/`tests`/`status`) for an accumulated mistake→rule→fix history, plus a companion `docs/mistakes/<name>-<date>.md` convention.
- **Where to add**: extend `server/memory.mjs`; surfaced in `InsightsSection.jsx` or `BugsSection.jsx`
- **Caveats**: MIT. Worth adopting as Loush's own output format since Loush can actually populate it — upstream never shipped an implementation.

---

## UI, Viewers & Editor Integration

### Five-tone status pill system with partial-success state
- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Notable code worth stealing; Recommended adoptions)
- **What**: A single `toneFor()`-style status-to-color/label mapping (5 tones including an amber "partial success" state), with pulse animation reserved for genuinely-live states and respecting `prefers-reduced-motion`.
- **Where to add**: new `src/components/StatusPill.jsx`, applied across `RunsSection.jsx`, `ReliabilitySection.jsx`, `BoardSection.jsx`, `QualitySection.jsx`
- **Caveats**: No LICENSE file on CAST — permission recorded per research.

### Real ⌘K global search palette
- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A debounced (200ms) search endpoint spanning sessions/agents/plans/memories, paired with a cmdk-based command palette with skeleton loading states and `aria-live="polite"` result-count region.
- **Where to add**: upgrade existing `QuickActions` component; new `/api/search` endpoint in `server/index.mjs`
- **Caveats**: No LICENSE file on CAST. Generate the nav-items list from the live route table, not a hardcoded array.

### "Why waiting" status-reason chip + chart-shaped loading skeletons
- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `StatusBadge.tsx`, `Skeleton.tsx`; Recommended adoptions)
- **What**: A nested status chip that explains *why* a session/agent is in its current waiting/error state, plus generic chart-shaped skeleton loading placeholders.
- **Where to add**: shared `src/components/` primitives, used across Sessions/Board/Overview/Runs
- **Caveats**: None noted (MIT). Full accuracy depends on the hook-receiver feature; without it, derive what's possible from transcripts and render null rather than guessing.

### D3 Sankey / DAG visualizations for tool-flow and orchestration
- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `ToolExecutionFlow.tsx`, `OrchestrationDAG.tsx`; Recommended adoptions)
- **What**: A true `d3-sankey` tool-execution flow diagram (self-loop/duplicate-node handling) and a custom 5-layer DAG layout for session→agent→subagent→outcome orchestration.
- **Where to add**: a Flow section, `InsightsSection.jsx`, `PlanGraph.jsx`
- **Caveats**: None noted (MIT); adds a `d3-sankey` dependency.

### Alerts engine (4 rule types) + declarative webhook-provider registry
- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `alerts.js`, `webhook-providers.js`; Recommended adoptions)
- **What**: Four alert-rule types (`event_pattern` with N-in-window, `inactivity`, `status_duration`, `token_threshold`) with per-scope cooldown deduplication, feeding a registry of 14 declarative webhook providers (Slack, Discord, Teams, PagerDuty, etc.).
- **Where to add**: `server/alerts.mjs`, `server/webhooks.mjs`; UI in `InboxSection.jsx` (feed), `ReliabilitySection.jsx` (rules), Customize (channels)
- **Caveats**: None noted (MIT).

### Pure-function insight-rule registry pattern
- **Source**: Claude Code Dashboard / "CSI" (RESEARCH_MERGED.md, Feature inventory insights-engine; Recommended adoptions)
- **What**: An `Insight` engine built as an array of pure rule functions `(session, allSessions) => Insight | null`, sorted by severity, so adding a new insight is one small testable file plus an array entry.
- **Where to add**: `InsightsSection.jsx` + new `lib/insight-rules/` directory
- **Caveats**: MIT. Take only the *shape*, not CSI's actual 10 rules (assessed as shallow/tautological).

### Three-state Source/Preview/Diff viewer toggle
- **Source**: FlyCrys and Nimbalyst (RESEARCH_MERGED.md, Feature inventory / UX and interaction design)
- **What**: A segmented control in the file viewer that switches between raw source, rendered preview, and diff — establishing diff as a mode of the file you're already viewing rather than a separate screen.
- **Where to add**: `src/ui/viewers.jsx` (`Viewer` component), surfaced in `ArtifactsSection.jsx`.
- **Caveats**: FlyCrys is MIT-licensed. None noted.

### File-watcher diff approval (red/green accept/reject)
- **Source**: Nimbalyst (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A PreToolUse hook snapshots a file's content before an agent tool edits it; a filesystem watcher then detects the change and renders an accept/reject diff in the file's native viewer. A DB-level "one pending tag per file" constraint prevents duplicate reviews; consecutive edits to the same file coalesce into a single original→latest diff.
- **Where to add**: new `server/history.mjs` (tag store + watcher) and `src/ui/viewers.jsx` (diff rendering), surfaced in `ArtifactsSection.jsx`. A degraded v1 without hooks can snapshot on file-open/each accepted review and diff disk-vs-last-known.
- **Caveats**: None noted (MIT).

### Cell-level CSV diff with phantom rows
- **Source**: Nimbalyst (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A RevoGrid-based CSV/spreadsheet editor that renders cell-level diffs, including "phantom rows" for inserted rows.
- **Where to add**: `src/ui/viewers.jsx`, extending the existing `parseCSV`/`DataTable` code path.
- **Caveats**: None noted (MIT).

### `EditorHost` uniform viewer lifecycle contract
- **Source**: Nimbalyst (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A shared interface all file-type viewers implement — load/save/echo-detection/watch/diff/theme — where content never lives in React state; the host pushes content via `applyContent` and pulls via `getCurrentContent`, ignoring watcher events caused by its own saves.
- **Where to add**: refactor of `src/ui/viewers.jsx` plus a new `src/lib/editorHost.js`.
- **Caveats**: Adopt the interface only, not their packaged extension SDK/marketplace.

### Editor-to-chat selection chips
- **Source**: Nimbalyst (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: The editor reports the user's current text/cell/node selection as `{id, label, description, icon, data, includeData}`; the chat UI renders these as removable chips above the input, injected into the next prompt. Guardrails: opt-in structured data, 32 KiB size cap, cyclic/non-JSON stripping, clear on tab close.
- **Where to add**: `src/ui/viewers.jsx` (emit selection) and `src/sections/ChatSection.jsx` (chip rendering + prompt assembly).
- **Caveats**: None noted.

### iOS keyboard/viewport fix + safe-area CSS variables
- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A `visualViewport`-based effect that fixes the mobile-Safari on-screen-keyboard layout bug, plus CSS custom properties for `safe-area-inset-*`.
- **Where to add**: `src/App.jsx` and `src/styles.css`.
- **Caveats**: A ~14-line effect, small enough to write independently rather than port from AGPL source. Flagged as the cheapest visible mobile-usability win in the research.

### "Suggested next action" guided-workflow UX rail
- **Source**: ccpm (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Every completed operation ends by naming the exact next command/action to take, plus a consistent fail-fast error format (`❌ <what> + <exact fix>`), turning independent panels into a guided sequence.
- **Where to add**: `src/sections/TicketSection.jsx`, `DeliverySection.jsx`, `FlowSection.jsx`
- **Caveats**: MIT-licensed, purely presentational.

---

## Chat & Permissions

### Browser-rendered permission prompts (replace `--dangerously-skip-permissions`)
- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A `canUseTool` callback that awaits a promise while a permission-request banner is shown in the browser, with a 55-second timeout for normal tools and infinite wait for `AskUserQuestion`/`ExitPlanMode`, plus an "allow + remember" action that appends a rule to the session's live allow-list.
- **Where to add**: `server/chat-ws.mjs` (see WebSocket protocol below) + a new permission banner in `src/sections/ChatSection.jsx`; resulting allow/deny events surfaced in `GovernanceSection.jsx` and `CapabilityLedger.jsx`.
- **Caveats**: AGPL-3.0-or-later — port the design, not the code, get written permission first if pasting anything. **Flagged in the research as the highest-integrity fix in this whole document, since Loush's chat currently runs fully unsandboxed via `--dangerously-skip-permissions`.**

### WebSocket chat protocol with `seq`-based replay
- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Architecture; Recommended adoptions)
- **What**: A WebSocket chat gateway with four inbound verbs (`chat.send`/`chat.abort`/`chat.subscribe`/`chat.permission-response`), a `kind`-tagged outbound frame envelope, a one-`complete`-per-run invariant, and a per-run monotonic `seq` with a ring-buffer for replaying missed frames after a reconnect.
- **Where to add**: new `server/chat-ws.mjs` replacing the SSE half of `server/index.mjs`, new `src/lib/ws.mjs`, consumed by `ChatSection.jsx`.
- **Caveats**: **AGPL-3.0-or-later, and their CVE-2026-31975 was exactly this layer** — get written permission naming specific files before pasting code. Authenticate at the WebSocket upgrade (not the first message), never trust a client-supplied session/project/provider id, bind `127.0.0.1` only.

### Live context-usage pill (`extractTokenBudget`)
- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A pure function extracting token-budget/context-window state from streaming events, driving a composer-adjacent pill showing live "how close to compaction" status.
- **Where to add**: `server/chat-ws.mjs`; pill in `ChatSection.jsx`; same numbers fed into `UsagePanel.jsx`.
- **Caveats**: AGPL-3.0-or-later — small/pure enough to reimplement rather than copy.

### Stable app-session-id ↔ provider-session-id mapping
- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Allocates the dashboard's own session id up front, keeps the underlying Claude session id server-side only, remaps outbound frames — enabling deep-linkable `#/chat/:id` URLs and optimistic navigation.
- **Where to add**: `server/chat-ws.mjs` + a small JSON session index; routes in `App.jsx`.
- **Caveats**: AGPL-3.0-or-later, design-level port only.

### Tool-renderer registry for chat transcripts
- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A `toolName → renderer` lookup registry plus `parentToolUseId`-based subagent grouping, so live chat and historical transcript views share one rendering path.
- **Where to add**: `ChatSection.jsx` (formalizing existing ad-hoc subagent nesting), reused in `ForensicsSection.jsx` and `ContextExplorerSection.jsx`.
- **Caveats**: AGPL-3.0-or-later, pattern only.

### Server-side attachment path containment
- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Validates and constrains uploaded-image/file paths server-side before they're referenced in a prompt, closing a hole where an unbounded-size raw body is accepted with no path containment check.
- **Where to add**: `server/index.mjs`'s `/api/chat/upload` route and the message-send path.
- **Caveats**: AGPL-3.0-or-later, but small enough (~20 lines) to reimplement rather than copy; flagged as closing a real existing gap in Loush.

---

## Tickets, Planning & Delivery

### Dependency-aware ready/blocked task queue
- **Source**: ccpm (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Partitions open tasks into "ready" (no unmet dependencies) vs "blocked" (named unmet deps), computed from `depends_on`/`parallel`/`conflicts_with` frontmatter metadata.
- **Where to add**: `server/eng.mjs` as a derived view over existing GitHub/JIRA issue data; surfaced in `InboxSection.jsx` and `BoardSection.jsx`
- **Caveats**: MIT-licensed. Do not adopt ccpm's "self-reported execution state" pattern — Loush already has ground truth from transcripts.

### Task decomposition generator with dependency + file-scope metadata
- **Source**: ccpm (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Given an epic/spec, decompose it into numbered task files carrying `depends_on`, `parallel`, `conflicts_with` arrays and a `Size: XS/S/M/L/XL` estimate, capped at ≤10 tasks.
- **Where to add**: `server/ticket.mjs` as a new generator alongside existing `ac`/`design-plan`/`tests` generators; rendered in `TicketSection.jsx`, graph view in `PlanGraph.jsx`
- **Caveats**: MIT-licensed. Called "the single biggest capability gain available from ccpm" — Loush's version can be grounded in the real checkout (naming actual files) where ccpm can only guess.

### Parallel work-stream analysis artifact
- **Source**: ccpm (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Produces an analysis document naming parallel work streams, the file globs each stream touches, coordination points, conflict-risk assessment, and a with/without-parallelism wall-time estimate.
- **Where to add**: `server/ticket.mjs` (generator) + `PlanGraph.jsx` (visualize as swimlanes)
- **Caveats**: MIT-licensed. Validate generated file globs against the actual tree to catch overlapping scopes.

### Idempotent progress-comment sync protocol
- **Source**: ccpm (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A fixed 6-section progress-comment format posted to GitHub/JIRA, deduplicated via a `last_sync` frontmatter timestamp plus an HTML marker, so re-running sync never double-posts.
- **Where to add**: `server/eng.mjs` comment-posting paths; UI in `DeliverySection.jsx`
- **Caveats**: MIT-licensed.

### Worktree lifecycle management + detection
- **Source**: ccpm (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: One-worktree-per-epic convention, `git worktree list` parsing, prune/force-remove recovery recipes, and a `--no-ff` merge + remove + branch-delete + archive cleanup sequence. Includes a detection primitive parsing a `.git` file's `gitdir:` line.
- **Where to add**: new `server/worktree.mjs`; surfaced in a project-hub section for list/create/remove, and in `RunsSection.jsx` to show which worktree each agent run executed in
- **Caveats**: MIT-licensed. Showing which worktree a session actually ran in is something ccpm cannot self-report — flagged as a real differentiator.

### Multi-language test-command detection table
- **Source**: ccpm (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A 13-entry marker-to-test-command table (npm, maven, gradle, composer, dotnet, cargo, go, bundler, flutter, swift, ctest, make) that lets a tool say "run this project's tests" against an arbitrary checkout with zero configuration.
- **Where to add**: new `server/testdetect.mjs`, consumed by quality/runs code
- **Caveats**: MIT-licensed; pure data, near-zero risk.

### Sessions-as-kanban-cards with session↔file links
- **Source**: Nimbalyst (RESEARCH_MERGED.md, Feature inventory; UX and interaction design)
- **What**: Sessions represented as kanban cards on a board, bidirectionally linked to the files they touched, with search and resume from the card.
- **Where to add**: `BoardSection.jsx` + `SessionsSection.jsx`, joined via existing `WorkingSet.jsx` data.
- **Caveats**: None noted.

### Agent-editable task tracker (agent tools for the board)
- **Source**: Nimbalyst (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Exposes `tracker_create` / `tracker_update` / `tracker_list` / `tracker_link_session` as agent-callable tools so the agent maintains the same board humans see, cross-referenced to the session that worked each item.
- **Where to add**: new tool endpoints in `server/` plus `BoardSection.jsx` / `PlanGraph.jsx`.
- **Caveats**: None noted.

### Structured acceptance-criteria schema for tickets
- **Source**: B. Claude Code Builder (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: An `AcceptanceCriterion` schema with stable IDs, `test_steps[]`, a `test_type` enum, `validation_method`, `priority`, and `automated` flag, grouped into a 4-bucket structure — replacing free-text acceptance-criteria blobs with tickable, filterable, exportable structured items.
- **Where to add**: `TicketSection.jsx`'s `CriteriaTab`, upgrading `META` artifact storage from markdown blobs to structured items.
- **Caveats**: MIT. This is a data-model migration touching generate/save/JIRA-comment paths — plan for that surface area.

### Event-driven git watching (no polling)
- **Source**: Nimbalyst (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Watches `.git/refs/heads/<branch>` and `.git/index` directly; on change invalidates a short cache and emits `git:status-changed`, and on new commits emits `git:commit-detected`. A commit auto-approves any pending diff-review tags for the files it touched.
- **Where to add**: new `server/git.mjs` with an SSE/WebSocket channel, consumed by `ProjectHub.jsx`, `ProjectsSection.jsx`, `WorkingSet.jsx`.
- **Caveats**: None noted.

### Git panel backend (status/diff/stage/commit/branches)
- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A `spawn`-with-argv (never shell-string) git backend parsing `git status --porcelain=v1 -z` including conflict detection, exposing status/diff/stage/unstage/commit/branch routes.
- **Where to add**: new `server/git.mjs`; new `GitSection.jsx`, cross-linked from `DeliverySection.jsx`, `WorkingSet.jsx`, and `TicketSection.jsx`.
- **Caveats**: AGPL-3.0-or-later — reimplement the parser from the documented shape, do not paste source.

### `--no-optional-locks` git-lock-safety fix
- **Source**: Claude Code ecosystem landscape scan — `sirmalloc/ccstatusline` (RESEARCH_MERGED.md, Top 15 missed projects)
- **What**: Passing `--no-optional-locks` to git commands to avoid `index.lock` races when the dashboard's own git reads happen concurrently with agent/CLI git operations on the same repo.
- **Where to add**: any git-shelling code in `server/eng.mjs` / the proposed `server/git.mjs`.
- **Caveats**: MIT.

### Hardened cross-platform "open folder" endpoint
- **Source**: Claude Code Dashboard (Stargx) (RESEARCH_MERGED.md, Notable code worth stealing; Recommended adoptions)
- **What**: A `POST /api/open-folder` endpoint using `execFile` with array arguments (never a shell string) to reveal a project folder in the OS file manager, per-platform.
- **Where to add**: `server/index.mjs`, reusable from `ProjectsSection.jsx` / `ProjectHub.jsx`.
- **Caveats**: MIT. Harden beyond upstream: allowlist the target path against configured project roots and add a `Host`-header check (upstream has neither).

### Code-review rubric with a numeric pass/fail gate
- **Source**: B. Claude Code Builder (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: An 8-point checklist plus a 5-rule static-analysis table, with a numeric gate (score ≥80 & 0 security issues → approved; ≥60 & ≤2 → needs revision; else rejected).
- **Where to add**: `QualitySection.jsx`'s `Reviews()` component, as a computed score over Loush's existing parsed findings; rubric data in `src/data/rubrics/code-review.js`, following the precedent of `DIMENSIONS` in `server/promptcheck.mjs`.
- **Caveats**: MIT. Port only the rubric data structure, not their SDK-driving code (flagged as dead/broken in this repo).

---

## Bugs, Quality & Reliability

### Security-findings ingestion into Bugs, with confidence/exclusion audit trail
- **Source**: claude-code-security-review (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: Ingest `claudecode-results.json` (from the GitHub Actions `security-review-results` artifact) and/or parse the bot's PR review comments (including reactions) to populate a real Bugs section with `file`/`line`/`severity`/`category`/`description`/`exploit_scenario`/`recommendation` plus `filter_analysis` stats (hard-excluded vs Claude-excluded counts, average confidence, fail-open badge).
- **Where to add**: `server/eng.mjs` (new artifact/PR-comment fetchers) + `BugsSection.jsx`; excluded-findings audit trail in `QualitySection.jsx`
- **Caveats**: None noted (MIT). Upstream fails open on filter failure — badge that state, don't silently trust the filtered count.

### Human-labelled precision metric from reviewer reactions
- **Source**: claude-code-security-review (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Track 👍/👎 reaction counts posted on each finding comment as a per-repo, over-time precision signal — "the single most interesting thing either repo produces and nobody displays."
- **Where to add**: `QualitySection.jsx`, fed by `server/eng.mjs`
- **Caveats**: None noted (MIT).

### Client-side noise/false-positive classifier for findings
- **Source**: claude-code-security-review (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Port `HardExclusionRules` (~120 lines of regex families covering 7 deterministic exclusion categories) to JavaScript so a Loush user can re-run/tune noise-suppression locally, independent of Anthropic's built-in opinions.
- **Where to add**: new `src/lib/finding-filters.js`, used by `BugsSection.jsx`
- **Caveats**: MIT-licensed, attribution required. Do this only after the findings-ingestion feature exists.

### Unreviewed-commits detector for security scans
- **Source**: claude-code-security-review (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: By counting commits after the SHA of the only security-review comment on a PR, surface "PR #412: 7 commits, 1 security review (commit 1). 6 commits unreviewed" — something neither upstream tool can show because it requires kept history.
- **Where to add**: `InboxSection.jsx` with a helper in `server/eng.mjs`
- **Caveats**: None noted (MIT); a derived insight, not a code port.

### Schema/contract drift guard for external file shapes
- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A declared contract of expected JSONL fields, `settings.json` keys, and `.claude.json` structure, checked at boot against real sample files, warning loudly when Claude Code changes its transcript format, plus an automated contract test.
- **Where to add**: new `server/contracts.mjs`; verified by a `node --test` contract test
- **Caveats**: Take the idea only, not CAST's SQL-specific implementation — Loush has no DB.

---

## Capability Ledger, Frameworks, Skills & Setup

### 4-directory skill-discovery resolution + `.openskills.json` provenance
- **Source**: openskills (RESEARCH_MERGED.md, Feature inventory `install.ts`, `skill-metadata.ts`, `dirs.ts`, `skills.ts`; Recommended adoptions)
- **What**: Resolves installed skills across 4 search directories (first-wins dedup), records provenance in a `.openskills.json` sidecar (source repo, install date), and parses an `AGENTS.md`'s `<available_skills>` block.
- **Where to add**: extend `KINDS.skills.dirs()` and `hubListSkills` in `server/index.mjs` to also scan `./.agent/skills` and `~/.agent/skills`; add `source`/`installedAt` columns to `/api/capabilities`; render in `CapabilityLedger.jsx` and `CustomizeSection.jsx`
- **Caveats**: Apache-2.0 — safe to copy code directly. Fixes a real gap: projects using openskills have skills and an always-on `AGENTS.md` block Loush's context-budget math currently doesn't see or price.

### Path-traversal-safe git/local-path skill installer
- **Source**: openskills (RESEARCH_MERGED.md, Feature inventory `install.ts`)
- **What**: An installer that clones/copies skills from a GitHub `owner/repo`, arbitrary git URL, or local path, auto-detecting source type, with an `isPathInside(targetPath, targetDir)` guard, and a hardcoded warning list of 15 Anthropic-marketplace skill names it might collide with.
- **Where to add**: any skill-install flow in `CapabilityLedger.jsx` / `CustomizeSection.jsx`, backed by `server/index.mjs`
- **Caveats**: Apache-2.0, safe to copy directly.

### Empirical skill/agent description-quality linter
- **Source**: manifest (RESEARCH_MERGED.md, ADR-0002 findings; Recommended adoptions)
- **What**: A linter encoding empirically-tested findings about which prompt vocabulary degrades tool selection — `MANDATORY`/`NEVER`/`Do NOT`/`blocked`/`NON-NEGOTIABLE` measurably hurt compliance, "blocked"→"redirected" flipped a tested model's capitulation rate from 6/6 to 0/6, ✅/❌ emoji bullets tokenize inconsistently across model families — plus a recommended five-part description template (`headline / WHEN / WHEN NOT / RETURNS / EXAMPLE`).
- **Where to add**: extend `scoreItem(fm, body, kind)` and `specificityOf` in `server/index.mjs`; surface in `CapabilityLedger.jsx` and a prompt-quality section
- **Caveats**: Take the findings, not code — manifest is MIT so even direct code use would be safe.

### Declarative model-parameter applicability catalogue for settings UI
- **Source**: manifest (RESEARCH_MERGED.md, Feature inventory `provider-params-spec.ts`, `model-parameters-schema.md`; Recommended adoptions)
- **What**: A JSON schema describing which request parameters are valid for a given provider/auth/model combination, with a single `applicability` field replacing ad-hoc `disabledWhen`/`conflictsWith` flags.
- **Where to add**: a new catalogue file under `lib/`, consumed by `SetupSection.jsx` (currently ~443 lines of hand-rolled form) and `server/setup.mjs`; also applicable to `McpSection.jsx`'s per-server env/args
- **Caveats**: MIT-licensed, safe to copy directly.

### Honest, per-user context-reduction headline metric
- **Source**: Claude Agent Framework / ciscoittech (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Copy the *idea* of an "always-on vs deferred" context-savings percentage — not the arithmetic — computed per-user from real always-on vs full-install token counts already tracked, so the claim is falsifiable.
- **Where to add**: `CapabilityLedger.jsx` (new summary stat, reusing existing `alwaysOnTokens`/`fullTokens`)
- **Caveats**: No LICENSE file — permission recorded per research, since GitHub reports the repo as unlicensed.

### Deterministic repo-complexity scoring + over-engineering audit
- **Source**: Claude Agent Framework / ciscoittech (RESEARCH_MERGED.md, Feature inventory `SIMPLICITY_ENFORCEMENT.md`; Recommended adoptions)
- **What**: A 0-6 complexity rubric plus a directory→specialist mapping table and numeric escalation gates, enabling "this repo scores 2/6 — BASIC. You have 23 skills and 11 agents installed. 14 have never fired."
- **Where to add**: a Setup/ProjectHub scoring feature cross-referenced against `CapabilityLedger.jsx`'s installed-capability count
- **Caveats**: Same no-LICENSE/permission-recorded caveat.

### Tool-efficiency metrics (tokens-per-successful-call)
- **Source**: Claude Agent Framework / ciscoittech (RESEARCH_MERGED.md, Feature inventory `v_tool_efficiency`; Recommended adoptions)
- **What**: Per-tool-name success rate, average duration, average output size, and tokens-per-successful-call — "your Grep calls burn 4x the tokens per useful result that Read does."
- **Where to add**: `InsightsSection.jsx`, `HarnessSection.jsx`; extends existing tool-use-by-name counting in `server/index.mjs`
- **Caveats**: Same no-LICENSE/permission-recorded caveat.

### One-click hook installation bundles with tool filters
- **Source**: Claude Agent Framework / ciscoittech (RESEARCH_MERGED.md, Feature inventory hook bundles; Recommended adoptions)
- **What**: Four preset hook configurations (code-quality, security, notifications, performance) declared as JSON with a `filters.tools` field scoping which tools trigger each hook.
- **Where to add**: `HooksSection.jsx`, `/api/hooks`; installable items in a Library section
- **Caveats**: Same no-LICENSE/permission-recorded caveat; rewrite underlying `.sh` scripts as cross-platform Node.

### Agent-routing policy table (signal → agent type → model)
- **Source**: Claude Agent Framework / ciscoittech (RESEARCH_MERGED.md, Feature inventory `launch-agent.md`; Recommended adoptions)
- **What**: A table mapping task keyword/signal to agent type to model tier (haiku/sonnet/opus), plus a complexity-override rule, as an editable cost/effort policy artifact.
- **Where to add**: `CustomizeSection.jsx` / TeamBaseline, as an editable table wired to existing cost data
- **Caveats**: Same no-LICENSE/permission-recorded caveat.

### Recurse into namespaced command/agent subdirectories (bug fix)
- **Source**: SuperClaude Framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: SuperClaude installs commands into `~/.claude/commands/sc/*.md`; Loush's own scanner currently only reads the top level of `~/.claude/commands`/`agents`, so 30 real, installed commands are invisible today.
- **Where to add**: `server/index.mjs` — `KINDS`, `itemFile()`, `/api/res/:kind`, `overviewItems()` — walk `~/.claude/commands/**` and `~/.claude/agents/**`, deriving display names as `sc/implement.md` → `sc:implement`.
- **Caveats**: None noted. Described as the single highest-value item in the whole SuperClaude analysis — fixes a real bug in Loush itself.

### Framework attribution in the Capability Ledger
- **Source**: SuperClaude Framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Detects which installed framework a given command/agent/skill came from via file-path signatures, frontmatter shape, and settings.json plugin entries — enabling "SuperClaude v4.3.0 costs you N tokens/session; 27 of its 50 capabilities have never fired."
- **Where to add**: new `server/frameworks.mjs`; a `source` column in `CapabilityLedger.jsx` and a filter chip in `LibrarySection.jsx`.
- **Caveats**: MIT. Detection rules are heuristics, not copied code.

### Frontmatter linting for malformed skill/command files
- **Source**: SuperClaude Framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Flags commands/skills whose YAML frontmatter fails to parse or disagrees with the filename — surfacing "this file's frontmatter didn't parse, Claude Code is treating it as prompt text."
- **Where to add**: `server/index.mjs`'s `parseFM()`, propagating an `fmMissing`/`fmError` flag through `overviewItems()` into `CapabilityLedger.jsx` and `LibrarySection.jsx` rows.
- **Caveats**: None noted.

### Declared MCP/agent dependency graph from command frontmatter
- **Source**: SuperClaude Framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: An `mcp-servers: []` / `personas: []` frontmatter convention enabling a "broken dependency" check and MCP-level ROI ("you have X installed; only 2 commands reference it and neither has fired").
- **Where to add**: `server/index.mjs`'s `overviewItems()` (carry `fm['mcp-servers']`/`fm.personas` through), rendered in `FlowSection.jsx`/`PlanGraph.jsx` and cross-checked in `McpSection.jsx`.
- **Caveats**: None noted; adopt the frontmatter convention in Loush's own authoring templates too.

### `Will Not:` negative-boundary section in agent authoring templates
- **Source**: SuperClaude Framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A standard agent-persona template section listing what the agent will *not* do, used as both authoring guidance and a scoring signal.
- **Where to add**: a new agent template in the authoring/`PromptStudio.jsx` surface; a new scoring signal in `scoreItem()` in `server/index.mjs`.
- **Caveats**: MIT; the author has given permission to port this content directly per the research.

### Multi-harness config-location reference map
- **Source**: context-mode (RESEARCH_MERGED.md, `docs/platform-support.md`; Recommended adoptions)
- **What**: A reference table of where 17 different AI coding harnesses (beyond Claude Code) keep config files, hooks, and MCP registrations — usable to detect non-Claude-Code harnesses on the same machine.
- **Where to add**: `HarnessSection.jsx` + harness detection logic in `server/index.mjs`; `SetupSection.jsx`
- **Caveats**: Elastic License 2.0 — read the doc as a reference and independently re-derive the mapping, don't copy verbatim.

### Config-linter integration for `.claude` files (444-rule catalogue)
- **Source**: Claude Code ecosystem landscape scan — `agent-sh/agnix` (RESEARCH_MERGED.md, Top 15 missed projects)
- **What**: A cross-platform Rust linter/LSP with 444 validation rules across CLAUDE.md, SKILL.md, hooks, and MCP configs, with autofixes, shippable as a single binary.
- **Where to add**: `SetupSection.jsx`, `GovernanceSection.jsx`, `HooksSection.jsx`, `McpSection.jsx` — shell out to the `agnix` binary and render its diagnostics.
- **Caveats**: Apache-2.0 (also dual MIT/Apache-2.0) — shelling out to the binary avoids any code-copying question.

### Config-discovery precedence rules (project vs user, deprecated paths)
- **Source**: Claude Code ecosystem landscape scan — `nyatinte/ccexp` (RESEARCH_MERGED.md, Top 15 missed projects)
- **What**: An explicit enumeration of where Claude Code config lives and its precedence: `CLAUDE.md` (project) vs `CLAUDE.local.md` (deprecated local override) vs `~/.claude/CLAUDE.md` (user); same pattern for commands and subagents.
- **Where to add**: validate/document against Loush's own glob patterns in `SetupSection.jsx`, `LibrarySection.jsx`, `CustomizeSection.jsx`, `ProjectHub.jsx`.
- **Caveats**: MIT, but the source is ~8.5 months stale and missing `.claude/skills/`/`.claude/plugins/` — treat as reference for the stable parts only, verify against current docs.

### Tool-restricted agent profile (4-field JSON, launch-time allowlist)
- **Source**: FlyCrys and Nimbalyst (RESEARCH_MERGED.md, Feature inventory `agent_config.rs`; Recommended adoptions)
- **What**: An agent-profile format as a single JSON file (`{name, system_prompt, allowed_tools: [], model}`) per named profile, with each allowed tool passed as a separate `--allowedTools` CLI argument when launching the CLI — "the single cheapest idea in either project to copy."
- **Where to add**: editor UI in `CustomizeSection.jsx` or `HarnessSection.jsx`; storage/spawn-arg assembly in a new `server/profiles.mjs`; surfaced in `GovernanceSection.jsx`
- **Caveats**: FlyCrys/Nimbalyst are MIT-licensed. Be explicit in the UI that this is a launch-time allowlist, not interactive mid-session tool gating.

### Structured CSS/DOM extraction for a live-page capture
- **Source**: A / Perfect-Web-Clone ("Nexting") (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A headless-browser extractor producing structured design data from a live page: full stylesheets/`@keyframes`/CSS variables/media queries, value→usage-count histograms for colors/fonts/spacing, hover/focus/active interaction-state capture, light/dark theme detection, and section/block segmentation with bounding boxes.
- **Where to add**: new `server/page-capture.mjs`, sibling to `server/figma-capture.mjs`, writing into the same `.claude/figma-captures/<slug>/` layout so the existing Captures UI picks it up. Start with just the `StyleSummary` histograms over `getComputedStyle`.
- **Caveats**: **No LICENSE file** (README MIT badge is not a real grant). Do not copy code — reimplement the schema/algorithm independently, or get written permission first.

### 10-category agent tool taxonomy (Preview → Diagnostics → Self-Healing ladder)
- **Source**: A / Perfect-Web-Clone (RESEARCH_MERGED.md, Notable code worth stealing)
- **What**: A functional partition of a 40+ tool agent surface into categories including a "Source Query" pattern for querying oversized context rather than dumping it, and a Preview→Diagnostics→Self-Healing capability ladder.
- **Where to add**: documentation in `docs/`, as an organizing principle for `McpSection.jsx` / `CapabilityLedger.jsx`.
- **Caveats**: Design pattern only — do not copy code given the licensing issue above.

---

## Not Recommended / Low Priority (recorded for completeness)

- **Per-session Docker container isolation** (NanoClaw) — wrong threat model for a local-first single-user tool; only the fail-closed allowlist-file idea is worth salvaging (folded into the rwx Access tab above).
- **Isolated GNUPGHOME + read-only keyring bridge pattern** (beadle) — no PGP/email surface exists in Loush; not relevant unless that changes.
- **Packaged extension SDK/marketplace** (Nimbalyst's `EditorHost`) — not worth it at Loush's current scale; adopt the lifecycle interface only.
- **Multi-cloud deploy provisioning pipeline** (AgentBreeder) — presupposes multi-tenant infrastructure Loush doesn't have; only the approval-gate-placement rule is portable.

---

## Sources

Every feature above traces back to `RESEARCH_MERGED.md` (this repo, root). See that file's own "Sources" section for the underlying GitHub repos, commits, and URLs each project profile was built from.
