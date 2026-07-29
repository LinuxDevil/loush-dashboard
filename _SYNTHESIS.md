# Upstream research synthesis

Orchestrator comparison across 16 researched projects. Sources are the sibling files in this
directory; every claim here traces to one of them. Written 2026-07-29.

**Status:** 15 of 16 research files complete. `anthropic-official-github.md` is partial — section A
(claude-code-action) is finished; sections B (security-review finding schema) and C (Agent SDK) are
stubs. The agent died on a monthly spend limit, not on a research dead-end.

---

## 0. The headline

The research was commissioned to find features to copy. It found those, but the highest-value
findings are of three other kinds, and they should be actioned first:

1. **Four defects in our own code**, three of which corrupt numbers we display as fact.
2. **A structural blind spot**: our discovery layer misses config that exists on disk.
3. **Three undocumented first-party data stores** that no project in a 690-entry survey reads —
   the only finding here that constitutes a durable moat rather than catch-up.

Feature adoption is section 6 onward. Sections 1–3 are corrections and should not wait for a
roadmap decision.

---

## 1. Defects in our own code, found by comparison

| # | Defect | Where | Impact | Found by | Confidence |
|---|--------|-------|--------|----------|------------|
| D1 | Token records never deduped by `message.id` (+`requestId`) | `server/index.mjs:681` `collectUsage()` | Independent measurement reports 51–55% duplicate entries in real corpora. Every token and cost figure inflated. | Stargx, phuryn, landscape-scan, insights (4 independent) | High — 4 sources, exact mechanism named |
| D2 | `PRICE_PER_M` wrong per model | `server/index.mjs:718` | Opus **3× too expensive**, Fable 1.5× too expensive, Haiku 20% too cheap. Sonnet correct by coincidence. Feeds month-end projection, budget alerts, anomaly `costRatio`, `/api/roi`, cache-waste estimate. | phuryn (exact table), insights (corroborating) | High — exact numbers from two sources |
| D3 | Command scanner walks only one level deep | `server/index.mjs:155` (`KINDS`), `:600` (`overviewItems()`) | All 30 SuperClaude commands invisible to Library, Customize, Overview, CapabilityLedger. Silent — the ledger looks complete. | superclaude | High — path verified against installer behaviour |
| D4 | `PUT /api/hooks` bypasses `track()` | hooks route | Manual hook edits never reach the audit log, while Governance's empty state claims they do. An honesty-rule violation in our own terms. | sdlc-frameworks | High |

**Related, unconfirmed:** openskills resolves skills from four directories — `.agent` then `.claude`,
project then global. If we don't scan `.agent/skills`, that is D3's sibling. Two independent
blind spots in the same layer suggests **discovery, not analysis, is our weak subsystem**.

### D2 has a better fix than "correct the table"

`uppinote20` reads `cost.total_cost_usd` **supplied directly by Claude Code**. We have been
estimating a number that is available exactly. Same for rate limits: `stdin.rate_limits.{five_hour,seven_day}`.

The catch, from the landscape scan: those fields exist **only on the statusLine stdin payload**, not
in transcript files. A pure filesystem reader genuinely cannot get them.

So the correct fix is three-part, not one-part:
- Where the exact figure is reachable, use it.
- Where it is not, estimate with a corrected table.
- Label which is which in the UI. This is exactly our null-not-zero rule extended to
  "measured vs. estimated" — and it turns a bug fix into a differentiator, since no surveyed
  project distinguishes the two.

### Sanity check on the whole cost category

Anthropic's own docs call `/usage` figures approximate; a 2026-02 analysis measured JSONL input
undercounts of 100–174×. Before shipping any dollar figure as authoritative, validate against our
own corpus. Recommend: treat dollars as indicative, and say so.

---

## 2. Security posture

Three unrelated projects independently pointed at the same hole.

| Source | Their control | Our state |
|--------|---------------|-----------|
| CAST | `controlGate.ts` — 404 disabled / 503 unconfigured / 403 bad token, `timingSafeEqual`; 9-line `safeResolve` traversal guard | We write real user config from unauthenticated localhost endpoints |
| CCAM | loopback bind + Host allowlist + token guard, written after a real CVE | Same exposure profile |
| siteboon | `canUseTool` + `waitForToolApproval` + remember-rule triad | We pass `--dangerously-skip-permissions` in the chat driver (`server/index.mjs:909`) |

The siteboon item deserves emphasis: **our posture is worse than the project we were reviewing**,
and that project shipped a CVSS 9.8 unauthenticated RCE in March 2026. Porting their permission
triad is closing our gap, not adding their feature.

---

## 3. The strategic find

From `ecosystem-landscape-scan.md`, after surveying 690 deduplicated projects:

| Store | Contents | Why it matters |
|-------|----------|----------------|
| `usage-data/session-meta/` | Pre-computed `lines_added`/`removed`, `files_modified`, `tool_errors`, `interruptions` | Metrics we currently derive, available first-party |
| `usage-data/facets/` | **Claude's own outcome and friction grading** | A quality signal nobody surfaces |
| `file-history/<session>/<hash>@vN` | Versioned file snapshots | **Exact** rework counts |

**No project among the 690 appears to read any of them.**

The third goes straight at WorkingSet's flagship metric. Our rework rank is currently — and
correctly — labelled a heuristic. These snapshots would make it a measurement. That is the single
highest-leverage item in this entire body of research.

**Caveat:** undocumented first-party stores can change without notice, and Anthropic explicitly
states the transcript format is internal and changes. Verify across versions before building on it,
and degrade to the current heuristic when absent.

### On the transcript schema generally

- Anthropic documents transcript **location and layout, zero field names**. The SDK type is a
  deliberately opaque `[k: string]: unknown`. Issue #53516 requests a stable schema — open, unanswered.
- Best community reference: **`daaain/claude-code-log`** — 2,321 lines of Pydantic models, 1,066
  lines of written spec, 72 captured real messages incl. 44 tool shapes, maintained daily.
- Our landscape agent's own empirical survey (37,378 JSONL lines, 220 transcripts) found **13
  top-level `type` values** where the SDK union covers 3.
- High-value undocumented fields: `toolUseResult.structuredPatch[]`, `.userModified` (**the human
  corrected the agent** — a quality signal we have no equivalent for), `.gitOperation.commit.sha`,
  `.toolStats`, `attributionSkill`/`attributionPlugin`/`attributionMcpServer`.

---

## 4. Where we actually stand in the landscape

Honest version, from the 690-project survey:

**Not differentiated.** "Local-first, zero telemetry" is table stakes — every project claims it.
Cost/token counting is the most crowded category in the ecosystem (~40 entries, four with 8k–17.5k★),
and we are currently *worse* than several of them (D1, D2).

**Genuinely differentiated:**
- Code-structure join — import graph, blast radius, coverage. Nobody else opens the repository.
- Retrospective, zero-setup collection — no daemon, no hooks required to see history.
- Safe config *writing* with backups. Category has **0** other entries.
- JIRA/GitHub/CI joins. Category has **0** other entries.
- Reading hook results from `attachment.type: "hook_success"` without a daemon.

**The shape of the gap:** every crowded category is a *counter*; every empty one is a *judgement*.
WorkingSet sits in the empty half. That is the thesis worth defending — and it argues against
spending effort on cost-dashboard parity beyond correctness.

**Incumbent we missed:** `davila7/claude-code-templates`, ~30k★, "CLI tool for configuring and
monitoring Claude Code" — overlaps Setup/Hooks/Mcp/Governance/Sessions directly. Appears on neither
of the two curated lists I targeted. Warrants its own research pass.

---

## 5. Licensing — read before copying anything

The email permission covers the copying. It does not tell us what attribution to carry, and in one
case it may not cover the code at all.

| Project | Advertised | Actually on disk | Action |
|---------|-----------|------------------|--------|
| siteboon/claudecodeui | AGPL-3.0-or-later | AGPL + §7 terms; **pre-`004135ef` third-party contributions stay GPL-3.0** — Siteboon cannot relicense them | **Highest risk.** Loush is MIT. Take designs and protocol shapes; get any code paste in writing, per-file |
| mksglu/context-mode | — | **Elastic-2.0** since 2026-03-03 (commit `a482980`). Source-available, not open source | Permission must name ELv2. Prefer taking schemas/formulas over code |
| ek33450505 (CAST) | MIT badge | **No LICENSE file.** `license: null`, `/license` 404 | Ask author to commit a real MIT LICENSE |
| ciscoittech | MIT (README text) | **No LICENSE file.** NOASSERTION | Same. Record permission in ported file headers |
| ericshang98/Perfect-Web-Clone | MIT badge | **No LICENSE file.** `license: null` | Same |
| Stargx, phuryn, uppinote20, hoangsonww, nimbalyst, FlyCrys, ccpm, openskills(Apache-2.0), manifest, agentbreeder(Apache-2.0), dlowenth, krzemienski | MIT/Apache | Verified present | Clean. Carry attribution |

**Pattern:** four projects advertise MIT they have not actually granted. Worth a short email asking
each to commit a LICENSE file — cheap, and it makes provenance defensible without relying on a
private email thread.

**Supply chain:** ccpm issue #1016 reports the v1 `curl | bash` installer deployed a Monero miner and
SSH backdoor; the agent verified that command *was* in the project's own docs. Vector is gone in v2.
**Rule for all 16: copy from a git checkout, never a hosted installer.**

---

## 6. Claim reliability — a scoring note

Five projects publish headline performance numbers. Every one that was checkable failed:

| Claim | Reality | Source |
|-------|---------|--------|
| ciscoittech "97% context reduction" | 10KB vs an *assumed* 250KB strawman. Arithmetic gives 96%. No benchmark harness exists. | ciscoittech |
| ciscoittech "3–6× faster" | Sequential baseline is literally `agent_count × 30s`. Assumed, never timed. | ciscoittech |
| context-mode "98% reduction" | Benchmark measures a human-written per-fixture summariser. Their own `BENCHMARK.md` says 96% overall, 82% lossless, rows as low as 13%. Runtime `bytes_avoided` uses hardcoded constants (8192 curl / 16384 WebFetch). | context-and-skills |
| SuperClaude "94% / 98% / 2–3×" | Self-reported frontmatter strings, no methodology | superclaude |
| ccpm efficiency metrics | No eval harness or data in repo. HN: "These numbers are hallucinated, aka lies" (moconnor) | ccpm |

**Cautionary document worth reading in full:** context-mode's `ADR-0004` records their displayed
savings percentage going 0% → 56% → 95.4% across three releases **on identical data**, purely from
formula changes. That is the failure mode our own derived stats are exposed to.

**Direct implication:** never render a percentage without its denominator visible. We already do
this for WorkingSet's rank tooltip. Extend it to every derived stat — and never repeat any of the
numbers above in our UI or docs.

---

## 7. Feature overlap — where the 16 projects cluster

Grouped by what they compete on, so we adopt once rather than 16 times.

### Cluster A — Live session state (we are weakest here)

| Project | Mechanism | Notable |
|---------|-----------|---------|
| CCAM | **8 Claude Code hook types** → HTTP receiver | Sees mid-turn state. `hook-handler.js` POSTs and exits **without awaiting** — the fix for Claude Code hanging on hooks |
| CAST | chokidar → SSE → query invalidation | 256KB tail-only reads, 30s idle detection, 8-min staleness sweep, 15-message replay |
| Stargx | Request-time derivation from JSONL | Exact thresholds: >60s idle; <15s+`tool_use` thinking; <15s+`text` **waiting**; 15–60s always idle |
| siteboon | WS with per-run `seq` + 5,000-event replay buffer | Client reconnects with `lastSeq`, gets exactly what it missed |

**Our state:** binary `ACTIVE_MS = 5*60_000` mtime check. We cannot express "this session is blocked
waiting on you" — the single most actionable signal, identified independently by Stargx and CCAM.

**Adopt:** Stargx's status thresholds (S, no new infra) → CCAM's WebSocket+eventBus (S, already
handles StrictMode double-mount, stale closures, capped backoff) → siteboon's `seq` replay (M) →
CCAM's hook receiver (M, the only route to true mid-turn state).

### Cluster B — Cost and token accounting (crowded; we need correctness, not parity)

phuryn (2,082★), uppinote20, CAST, Stargx, insights all price tokens. Consensus model:
`output = 5×input`, `cache_write = 1.25×input`, `cache_read = 0.10×input`. Stargx's 0.25× cache
multiplier is **wrong** — do not port.

**Adopt:** corrected pricing table as `lib/pricing.mjs` with an explicit `unpriced` state (S) →
`message.id`+`requestId` dedupe (S) → prefer harness-supplied `total_cost_usd` where reachable (S/M).
**Do not** chase their dashboards; we already beat them on projection, budget alerts, anomaly
detection, cache-efficiency and the 5-hour block.

### Cluster C — Config/capability inventory (our CapabilityLedger's territory)

SuperClaude, openskills, claude-code-templates(unresearched), CAST, ciscoittech all write or read
`~/.claude` artifacts.

**Key insight, consistent across all of them:** *making our dashboard understand their artifacts*
beats *porting their code*, every time.

**Adopt:** fix D3 nested-dir scanning (S) → framework attribution so the ledger prices SuperClaude as
a unit (M) → adopt SuperClaude's `mcp-servers: []` / `personas: []` frontmatter as a dependency graph
(M, feeds Flow/PlanGraph, unlocks MCP-level ROI) → frontmatter lint (S; two SuperClaude files ship
malformed YAML that nothing validates) → openskills' `.openskills.json` provenance sidecar (S).

**Gotcha:** SuperClaude's installer uses `shutil.copy2`, preserving the *wheel's* mtime. Our
mtime-based NEW/DEAD verdicts will mis-age every one of its files. Needs a sentinel.

### Cluster D — Governance, checklists, permissions (we have no checklist component at all)

| Source | Artifact | State |
|--------|----------|-------|
| dlowenth | **75-item freeze audit, extracted verbatim** + Tier 0–3 with 81 tier-conditional items | Pure data. Cheapest high-value port in the batch |
| agentbreeder | Action verbs `{read,use,write,deploy,publish,admin}`; three-tier resolution returning a **reason string**; `AuditEvent` schema; `ResourceDependency` lineage | Real code, near-zero adoption |
| beadle | rwx matrix: `permissions[identity][contact]`, r=surface, w=reply, x=execute, default `---`, no inheritance, transport trust AND permission must both pass | Design is sound; **`x` not actually enforced yet** |
| ciscoittech | 0–6 complexity score, 13-row directory→specialist map, numeric gates (>5 tables, >10 endpoints, >20 components) | Rubrics are the only real value in that repo |

**The differentiating move** is not rendering the 75 items — it is **auto-checking a subset against a
real `.claude/` directory**. The landscape scan found config-linting-that-checks-behaviour has
**zero** entries across 690 projects. That closes the loop nobody else closes, and it is exactly our
local-first thesis.

### Cluster E — Diff approval and editing (Nimbalyst owns this)

Nimbalyst's model is inverted from the obvious design and better for it: agent writes to disk
immediately (no blocking); a PreToolUse hook snapshots pre-edit content as a "tag"; the file watcher
sees the change, finds the tag, enters diff mode; reject restores the snapshot. Principle: *the AI
always sees the accepted state.*

Load-bearing details: check pending tags **before** the 2000ms autosave-skip heuristic; release the
watcher lock via `setTimeout(…, 0)`; a DB partial unique index enforces one pending tag per file so
consecutive edits coalesce original→latest.

They explicitly rejected an MCP `applyDiff` tool because agents bypass it with plain Edit. The
watcher approach also catches bash and manual edits.

Best cheap idea: **a git commit auto-approves pending diffs** for those files, from any tool.

**Cost for us:** neither upstream had to build the transport. Every watcher must live in
`server/*.mjs` behind SSE. Budget for that. A degraded v1 is possible without hooks by diffing
disk-vs-last-known.

### Cluster F — Planning and decomposition (ccpm owns this; clean split)

*"It plans richly and observes nothing; we observe richly and plan thinly."*

Their best idea is small: task frontmatter carrying `depends_on` / `parallel` / `conflicts_with` —
the metadata triple that makes scheduling computable. Their tracking is 14 bash scripts reading only
local files, zero `gh` calls, zero tokens.

**Their worst bug, which we are structurally immune to:** agents falsely reported as running,
because run state is a markdown file the agent writes *about itself*. We have ground truth in
transcripts. Do not adopt self-reported state under any circumstance.

**Adopt:** dependency-aware ready/blocked queue (S, ~40 lines against data we already fetch) →
decomposition-with-dependencies as a fourth generator in `server/ticket.mjs` (M; our checkout
grounding makes our version strictly better than theirs). **Do not** adopt their mandatory PRD
waterfall — their own tracker (#975) reports it as too rigid for small fixes.

---

## 8. Prioritised adoption plan

Ordered by (correctness first) → (value ÷ effort) → (strategic moat).

### Tier 0 — Corrections. Do before any feature work.

| # | Item | Lands in | Effort |
|---|------|----------|--------|
| 0.1 | Dedupe usage by `message.id`+`requestId`; sum `usage.iterations[]` | `server/index.mjs:681` | S |
| 0.2 | Corrected pricing → new `lib/pricing.mjs`, explicit `unpriced` state | `server/index.mjs:718` + callers | S |
| 0.3 | Recurse nested command/skill dirs; add `.agent/` roots | `server/index.mjs:155,600` | S |
| 0.4 | Route `PUT /api/hooks` through `track()` | hooks route | S |
| 0.5 | Audit every derived stat for a visible denominator | Insights, CapabilityLedger, Overview | S |

### Tier 1 — High value, low effort.

| # | Item | From | Lands in | Effort |
|---|------|------|----------|--------|
| 1.1 | Session status thresholds incl. **waiting-on-you** | Stargx | new `LiveSection.jsx` + `/api/live` | S/M |
| 1.2 | Hook health as filesystem fact (resolve→stat→exec bit→failures→grade) | CAST | HooksSection | S |
| 1.3 | Control gate + `safeResolve` traversal guard | CAST/CCAM | `server/index.mjs` | S |
| 1.4 | 75-item freeze audit as data | dlowenth | GovernanceSection | S |
| 1.5 | `history.jsonl` as clean prompt corpus | uppinote20 | PromptQuality, Insights | S |
| 1.6 | PII redactor (~60 lines, zero deps, 14 tests) | insights | `server/` shared | S |
| 1.7 | Network guard patching `net.Socket.prototype.connect` pre-import | insights | `server/index.mjs` | S |
| 1.8 | `localISODate()` — we have the `toISOString()` TZ bug in ≥3 places | phuryn | `lib/` | S |
| 1.9 | Dependency-aware ready/blocked queue | ccpm | `server/eng.mjs`, Inbox/Board | S |
| 1.10 | Subagent-internal tool calls via `tool_use_id` pairing | CCAM | Harness, Forensics | S/M |

### Tier 2 — Substantial, worth it.

| # | Item | From | Lands in | Effort |
|---|------|------|----------|--------|
| 2.1 | **Auto-check audit items against real `.claude/`** | dlowenth + ours | Governance | M |
| 2.2 | Transcript cache: `(mtime,size)` key + byte-range reads, truncation/compaction safe | CCAM | `server/index.mjs` | M |
| 2.3 | Permission prompts — `canUseTool` + approval + remember-rule; drop `--dangerously-skip-permissions` | siteboon | ChatSection | M |
| 2.4 | WebSocket + eventBus (StrictMode, backoff, focus/online reconnect) | CCAM | client | S/M |
| 2.5 | Framework attribution in the ledger | SuperClaude | CapabilityLedger | M |
| 2.6 | Honest context-reduction metric with visible denominator | ciscoittech(inverted) | CapabilityLedger | S/M |
| 2.7 | Parallel efficiency = Σ(child durations)/fan-out span | ciscoittech(inverted) | Insights | M |
| 2.8 | Task decomposition w/ dependency + file-scope metadata | ccpm | `server/ticket.mjs`, PlanGraph | M |
| 2.9 | Diff approval v1 (disk-vs-last-known, no hooks) | Nimbalyst | Artifacts | M |
| 2.10 | rwx access matrix retargeted to (profile, project) | beadle | Governance + `server/access.mjs` | M |

### Tier 3 — Strategic, verify first.

| # | Item | Why | Effort |
|---|------|-----|--------|
| 3.1 | **Read `file-history/<session>/<hash>@vN`** → exact rework counts | Converts WorkingSet's flagship heuristic into a measurement. Nobody else does this. | M, gated on cross-version verification |
| 3.2 | Read `usage-data/session-meta/` + `facets/` | First-party metrics incl. Claude's own friction grading | M, same gate |
| 3.3 | Hook receiver for true mid-turn state | Only route to live data; the non-awaiting POST is the key trick | M |
| 3.4 | Configurable widget/section registry (`getData → T\|null`) | 42-widget reference design; our `BASE_SECTIONS` is hardcoded. `null`-means-disappear *is* our honesty rule as an interface | L |
| 3.5 | Durable store — JSON sidecar first, `node:sqlite` fallback | We already do mtime memoization; real gap is restart persistence. Avoid `better-sqlite3` (native build, documented install failures) | L — makes us stateful, weigh it |

### Explicit do-not-adopt

- Stargx's 0.25× cache multiplier (wrong by 5×); their unpkg/Google-Fonts CDN frontend (breaks
  offline + our telemetry claim); their lifetime-token fallback in the context bar.
- insights' query layer — `COALESCE(...,0)` renders missing data as zero. Port schema, not queries.
- CAST's page-level components (dead without their `cast.db`) — port primitives only.
- ccpm's self-reported agent run state; their mandatory PRD waterfall.
- NanoClaw's container isolation — wrong scale for local-first single-user.
- `shengyanlin/claude-overlay` — do not port **or install**. Defaults to `bypassPermissions` with a
  blanket allow, home-dir cwd, no redaction, ingesting every pixel on screen.
- Any performance number from section 6.
- Nimbalyst's telemetry client (a session-start retention ping fires per launch via a force-opted-in
  client despite opt-out). Their consent-fails-closed *pattern* is worth copying; the client is not.

### Needs your decision, not mine

**Undocumented `api.anthropic.com/api/oauth/usage`** (uppinote20) gives Max-only weekly caps.
Anthropic's Feb 2026 consumer terms bar subscription OAuth credentials in "any other product, tool,
or service". ~3,200 repos use it with no reported enforcement; nothing public resolves the
plugin case. A web dashboard is a weaker "inside Claude Code" claim than a plugin. **Recommendation:
leave it out.** The five-hour block we already compute covers most of the need.

---

## 9. Porting hygiene

- Copy from a git checkout, never a hosted installer (ccpm #1016).
- Strip CCAM's generated `MODULE_GUIDE` comment blocks and `@author` lines — they embed the author's
  macOS paths in most files.
- Windows: CAST hardcodes `'/'` path splitting and checks the POSIX executable bit; uppinote20's
  `countUntrackedLines` needs a POSIX shell and silently undercounts. Use `path.sep`; report
  `executable: null` rather than faking a pass.
- Vendor everything. Six of the sixteen are dormant (Stargx 4 commits one day; CAST since 2026-07-05;
  insights since 2026-03-06; ciscoittech since 2026-03-12; openskills since 2026-01-18;
  SuperClaude 1 commit in 90 days). Do not track upstream.
- Record the author's permission and the license state (§5) in the header of every ported file.

## 10. Ecosystem-hygiene note

Two projects' READMEs contain text written to be executed by a reading agent
(`shengyanlin/claude-overlay` embeds a literal `claude "Set up Claude Overlay for me…"` directive).
Both were treated as data and not acted on. Worth knowing when we add any feature that fetches and
summarises third-party repos.

---

## 11. Research still owed

1. `anthropic-official-github.md` sections B (security-review finding schema) and C (Agent SDK) —
   died on spend limit, section A complete.
2. `davila7/claude-code-templates` (~30k★) — unflagged incumbent overlapping five of our sections.
3. `daaain/claude-code-log` — the authoritative transcript schema reference.
4. Cross-version verification of the three first-party stores (§3).
5. Phase 2: per-project implementation specs (16 agents, blocked on spend limit).
