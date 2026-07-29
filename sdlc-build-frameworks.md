# SDLC and build-governance frameworks

Research date: 2026-07-29. Both repos were cloned and read in full at the commits noted below; every claim here is grounded in a file in those checkouts. Statements I could not verify are marked **unverified**.

Prompt-injection note: nothing in either repo attempted to instruct the reader/agent. `claude.md` and `kickoff-prompt-template.md` are full of imperative second-person text ("You are acting as a senior product architect…", "Do not write code"), but that text is a *template addressed to a future Claude session*, not an instruction to me. I treated it as data throughout. Repo B's `V3_*.md` files contain fabricated telemetry presented as fact — flagged in §B Gaps.

---

## A. claude-code-build-framework — Identity

| Field | Value |
|---|---|
| Repo | https://github.com/dlowenth/claude-code-build-framework |
| Author | `dlowenth` — Doug Lowenthal (name from `LICENSE` copyright line) |
| License | **MIT** (SPDX `MIT`), `Copyright (c) 2026 Doug Lowenthal` |
| Stars / forks / watchers | 8 / 1 / 3 subscribers |
| Open issues | 0 |
| Created | 2026-02-25 |
| Last commit | `eb91e2a` 2026-04-14 — "v2.4 - Context efficiency, plugin/MCP security validation…" |
| Repo `updated_at` | 2026-04-24 |
| Default branch | `main`; single branch, 20 commits, no tags, no releases, no CI, no `.github/` |
| Size | 354 KB |
| Topics | none |
| Doc version | `2.4` (versioning table, `claude.md:2457`) |

**There is no code.** The entire repo is 6 tracked files:

| Path | Lines | What it is |
|---|---|---|
| `claude.md` | 2472 | The master build contract. 24 numbered sections. Contains the freeze audit and all hook source. |
| `security-framework.md` | 605 | Tiered security companion, 13 sections. |
| `kickoff-prompt-template.md` | 369 | The prompt you paste into a fresh Claude chat to generate a project. |
| `prd-template.md` | 663 | Blank PRD, sections 0–19. |
| `README.md` | 192 | Landing page. |
| `LICENSE` / `.gitignore` | 21 / 28 | — |

**Install / platforms:** there is nothing to install. The workflow is manual: open a Claude chat, paste `kickoff-prompt-template.md`, attach the other three `.md` files plus your project context. Prerequisites per README are a Claude Pro/Max/Team/Enterprise subscription, Claude Code, Git+GitHub, Node.js. Platform-agnostic, though the contract is opinionated toward Windows-host → Railway/Linux deploy (it mandates `.npmrc` with `force=true`). `pre_tool_use.py` and friends require Python on PATH.

**Activity:** 20 commits over ~7 weeks (2026-02-25 → 2026-04-14), then quiet for ~3.5 months as of this writing. Versioned v1.0 → v2.4 with a genuinely well-maintained changelog table at `claude.md:2455-2470`. Single author, no external contributors, no issues or PRs. **Unverified:** whether it is still maintained.

**External coverage: none found.** WebSearch for the repo name returns only the GitHub page itself plus unrelated Claude-Code-framework listicles. At 8 stars with 1 fork there are no reviews, threads, or writeups. Treat it as one practitioner's private build contract that happens to be public — which is fine, because what we want from it is the checklist data, not social proof.

### The three frameworks it orchestrates

It does not reimplement these; it sits above them and conditionally rewrites its own rules based on which one is selected.

- **Superpowers** (`obra/superpowers`, Jesse Vincent / Prime Radiant) — a skills library enforcing a multi-phase workflow (brainstorm → spec → plan → TDD → subagent dev → review → finalize). Central bet is test-driven development with a composable skill library. This framework's **default** pick. Note: we already have `superpowers:*` skills installed in this very environment.
- **GSD / Get Shit Done** (`gsd-build/get-shit-done`, TACHES) — lightweight, phase-by-phase incremental planning with adversarial plan verification, atomic git commits per task, and aggressive context-rot prevention (a separate orchestrator per phase rather than one mega-orchestrator). Its own state dir is `.planning/`.
- **BMAD-METHOD** (`bmad-code-org/BMAD-METHOD`, BMad Code) — heaviest option; simulates a 9-agent agile team (Business Analyst, PM, UX Designer, System Architect, Scrum Master, Developer, QA, Tech Writer, Solo Dev) producing audit-grade doc chains. Its own state dir is `bmad/`.

Selection matrix (`claude.md` / README, reproduced verbatim as data):

| Requirements | Simple Project | Complex Project |
|---|---|---|
| Clear, stable | Superpowers + Express | Superpowers + Full Build |
| Unclear, experimental | GSD + Express | GSD + Full Build |
| Locked, compliance-grade | Superpowers + Express | BMAD + Full Build |

---

## A. The problem it solves

The stated thesis (README, "The Problem It Solves"): each existing framework optimizes one axis — Superpowers optimizes process discipline and test quality, GSD optimizes iteration speed under unclear requirements, BMAD optimizes documentation traceability — and **none of them handle security architecture, production deployment, third-party service setup, or stack-specific accumulated lessons.**

Concretely, the gaps it targets:

1. **No security tiering.** None of the three ask "can this app move money?" and scale controls accordingly.
2. **No production-readiness gate.** They help you build; they don't tell you when you're allowed to ship.
3. **Skippable steps.** Without hard gates, open questions get silently resolved by the agent (the framework's term for this is *assumption drift*, `claude.md:67`).
4. **Lessons evaporate.** Every project re-fights the same bugs. The framework's answer is `lessons-learned.md` written during the build and folded back into the master contract after shipping.
5. **Context compaction destroys phase state.** Phase-gate instructions live in conversation history and are lost on compaction — hence `STATE.md` plus a `PreCompact` hook that re-injects the gate rule.
6. **Third-party setup is undocumented dashboard-clicking.** Answered by the three-category setup-guide model.

---

## A. Value proposition

For our purposes the value is almost entirely **portable structured data**, not architecture:

- **A 75-item production-readiness checklist** that is specific, verifiable, and mostly stack-agnostic once the Supabase/Discord items are filtered. This is the single most directly liftable artifact in either repo.
- **A 4-tier security classification with explicit inheritance rules and 81 additional tier-conditional audit items**, plus auto-escalation triggers. This is a genuinely good governance data model.
- **A working `pre_tool_use.py` / `post_tool_use.py` / `stop.py` / `pre_compact.py` hook set** with exact `settings.json` wiring — directly comparable to our `HOOK_LIBRARY`.
- **Four artifact templates** (build contract, PRD, kickoff prompt, open-questions) with a mandatory interactive resolution gate.
- **A defense-in-depth model** (auto-mode classifier → hooks → two-stage review → git) that is a clean mental model for our Governance section.

What it is *not*: it is not software, has no UI, no state, no telemetry, no validation. Nothing enforces the checklist except a human reading it. **That gap is exactly our opportunity** — we are a dashboard, and this is checklist data with no dashboard.

---

## A. The 75-item production-readiness freeze audit

**Fully reachable and reproduced verbatim below.** Source: `claude.md` Section 21 "Freeze Audit Checklist", lines 2293–2372. I counted the `- [ ]` markers programmatically: **exactly 75**, matching the README's claim and the v2.3 changelog entry ("Freeze audit now 75 items", `claude.md:2462`).

Category assignments are **mine** — the source is one flat ungrouped list. I have preserved the original text and original order; the `#` column is the source order. Section references like "(per Section 17.2)" point into `claude.md` itself.

| # | Category | Item |
|---|---|---|
| 1 | Plan & gates | Architecture matches approved plan |
| 2 | Plan & gates | All PRD open questions resolved before build began — no unresolved items in PRD Section 17 |
| 3 | Plan & gates | Category 1 (human-only) setup confirmed complete by human before coding started -- accounts created, new projects created, `.env` populated, verified against `.env.example` |
| 4 | AuthZ / data layer | Authorization boundaries enforced at data layer |
| 5 | AuthZ / data layer | Table-level GRANTs applied to all public tables with RLS (anon + authenticated roles) |
| 6 | AuthZ / data layer | First-login RLS policies handle unlinked auth_user_id state (Discord OAuth fallback — skip if using Clerk) |
| 7 | AuthZ / data layer | No RLS policies contain subqueries on auth.users (use auth.jwt() instead) |
| 8 | Backend / deploy | Edge Functions deployed with correct JWT verification flag (--no-verify-jwt only when function handles auth internally) |
| 9 | Backend / deploy | Edge Functions deployed from committed, tagged code on main branch (per Section 8.6) |
| 10 | Auth client | Client-side auth uses getSession() as default — getUser() not used in routine auth flows (per Section 5.2.2 — skip if using Clerk) |
| 11 | Auth client | Auth initialization uses two-effect pattern — no async operations inside onAuthStateChange (per Section 5.2.3 — skip if using Clerk) |
| 12 | Auth client | TOKEN_REFRESHED events do not trigger redundant DB lookups |
| 13 | React hygiene | React context provider values are referentially stable (useMemo on all context objects) |
| 14 | React hygiene | No useCallback dependency arrays include React context objects (toast, api, etc.) |
| 15 | React hygiene | No useEffect that makes API calls has unstable dependencies that could cause render loops |
| 16 | Code hygiene | No auth diagnostic logging prefixes remain in production code |
| 17 | Architecture | No page file exceeds ~200 lines — decomposed into components (per Section 17.2) |
| 18 | Architecture | No duplicated feature implementations across pages — shared components extracted (per Section 17.3) |
| 19 | Agent config | Custom subagents created in `.claude/agents/` for Full Build projects (security-reviewer, component-checker, test-coverage recommended — per Section 20.3.3) |
| 20 | Agent config | Hook enforcement scripts created in `.claude/hooks/` with pre_tool_use guardrails active (per Section 20.5 — recommended for all projects, required for Full Build) |
| 21 | Agent config | Hooks do not log sensitive data or make unauthorized external network calls (per Section 20.5.4) |
| 22 | Agent config | `.claude/settings.json` committed with auto mode permission configuration and hooks enforcement active (per Section 20.6) |
| 23 | Agent config | `.claude/settings.local.json` is in `.gitignore` |
| 24 | Tenancy | Tenant isolation proven (if applicable) |
| 25 | AuthZ / data layer | No recursive authorization logic |
| 26 | Schema hygiene | No unused schema artifacts |
| 27 | Code hygiene | No commented-out production code |
| 28 | Schema hygiene | No orphaned triggers or functions |
| 29 | Code hygiene | No duplicated business logic |
| 30 | Testing | Manual isolation tests passed |
| 31 | Testing | Manual role boundary tests passed |
| 32 | Testing | Role-based test cases documented in `tests/role-tests.md` and passing (per Section 14.4) |
| 33 | Testing | Playwright end-to-end tests passing for all routes and core user journeys (per Section 14.6 — if applicable) |
| 34 | Plan & gates | Self-audit verification loop completed — all PRD acceptance criteria verified as implemented (per Section 20.1) |
| 35 | Build state | `STATE.md` exists and reflects all phases as complete with approval dates (per Section 20.7) |
| 36 | Build state | `CONTEXT.md` exists with implementation decisions captured for all UI phases (per Section 20.8) |
| 37 | Agent config | Claude Code plugins reviewed and installed before build; installed plugins documented in `lessons-learned.md` |
| 38 | Plan & gates | Selected development framework installed and design/brainstorming phase completed before coding (per Section 20.9) |
| 39 | Audit / logging | Privileged actions logged |
| 40 | Data safety | No production data deleted during development or testing (per Section 12.3) |
| 41 | Error handling | Debug mode toggles correctly and does not leak data when off |
| 42 | Error handling | Error handling covers all network calls and async operations |
| 43 | Observability | Error tracking configured for production (per Section 13.3 — if applicable) |
| 44 | Observability | Feature adoption tracking events implemented for key features (per Section 13.3 — if applicable) |
| 45 | Secrets / env | Environment variables documented and no hardcoded secrets |
| 46 | Secrets / env | `.env.example` exists, is committed, and documents all required variables with grouping, descriptions, and source instructions (per Section 8.3.1) |
| 47 | Secrets / env | `.env.example` is in sync with actual environment variable usage — no missing or stale entries |
| 48 | Setup guides | Setup guide exists in `docs/resources/` for every external service in the tech stack (per Section 8.8) |
| 49 | Setup guides | No setup guide contains actual API keys, secrets, or credentials -- only placeholders |
| 50 | Setup guides | All setup guides have all three categories completed (human-only, automated, post-build refinement) |
| 51 | Setup guides | All MCP/CLI service connections scoped to the specific new project -- no unscoped or production connections |
| 52 | Setup guides | All setup guides cross-reference related guides where setup spans multiple tools |
| 53 | Setup guides | `docs/resources/README.md` index exists with Category 1, 2, and 3 checklists |
| 54 | Schema hygiene | Migration files match current schema state |
| 55 | Schema hygiene | No schema drift — no direct dashboard modifications to production RLS, functions, or triggers (per Section 8.7) |
| 56 | Backup / recovery | Database backup tier declared in PRD — PITR flagged as recommended for production user-facing apps (per Section 8.5) |
| 57 | Git | Git repository is clean with descriptive commit history |
| 58 | Lessons | `lessons-learned.md` reviewed — any items that should be folded into master `claude.md` flagged to project owner |
| 59 | Build / deploy | `.npmrc` with `force=true` exists in project root (required for Windows to Railway cross-platform deploy) |
| 60 | Supply chain | Supply chain: `npm audit` shows no high or critical vulnerabilities (per Section 8.9, security-framework.md Section 7) |
| 61 | Supply chain | Supply chain: all dependency versions pinned in lockfiles, lockfiles committed to Git |
| 62 | Supply chain | Supply chain: no dependencies with post-install scripts unless explicitly approved |
| 63 | Build artifact | Build artifact: no source maps, debug files, `.env` files, or credential files in deployed/published artifact (per Section 8.9) |
| 64 | Build artifact | Build artifact: if publishing to npm, `npm pack --dry-run` reviewed and artifact size within expected baseline |
| 65 | Auto-remediation | Auto-remediation changelog is clean (if applicable) |
| 66 | LLM cost | LLM calls use appropriate model tier per task (no Opus for mechanical tasks) |
| 67 | LLM cost | No LLM calls for tasks that should be deterministic scripts |
| 68 | LLM cost | LLM API calls include rate limit handling (backoff + jitter) |
| 69 | LLM cost | LLM cost logging in place for runtime API calls (if applicable) |
| 70 | LLM cost | Bulk operations are resumable with checkpoint/resume logic (if applicable) |
| 71 | Security ops | Nightly security audit configured (if applicable) |
| 72 | SEO / crawl | Crawl policy enforced: `robots.txt`, meta robots, and `X-Robots-Tag` all set to noindex/nofollow (unless explicitly authorized) |
| 73 | SEO / crawl | Debug mode URLs permanently excluded from indexing at all three layers (robots.txt, meta tag, response header) and never present in sitemap |
| 74 | SEO / crawl | SEO structure in place: semantic HTML, meta tags, Open Graph, JSON-LD on public-facing pages |
| 75 | SEO / crawl | SEO/structured data managed via shared utility (not scattered across components) |

Category rollup: AuthZ/data layer 5, Agent config 6, Setup guides 6, LLM cost 5, SEO/crawl 4, Testing 4, Plan & gates 4, Secrets/env 3, Supply chain 3, React hygiene 3, Auth client 3, Schema hygiene 3, Code hygiene 3, Architecture 2, Build artifact 2, Build state 2, Observability 2, Backend/deploy 2, and 1 each for Tenancy, Data safety, Audit/logging, Error handling ×2, Backup, Git, Lessons, Build/deploy, Auto-remediation, Security ops.

**Portability read:** roughly 20 items are Supabase/Discord/Railway-specific (#5–#12, #54–#56, #59) and would need rewriting or dropping for a generic renderer. The other ~55 are broadly applicable. Items #19–#23 are about Claude Code configuration itself and are *directly* checkable by our dashboard against a real `.claude/` directory — that is the killer feature.

The section closes by requiring the agent to emit a literal verdict token, either `READ-ONLY PLAN` or `READY TO FREEZE` (`claude.md:2376-2379`). That is a clean pass/fail primitive worth copying.

---

## A. The tiered security framework

Source: `security-framework.md` (605 lines, doc v1.1). Four tiers, additive inheritance.

### Tier definitions (verbatim from `security-framework.md:14-19`)

| Tier | Criteria | Example projects |
|---|---|---|
| **Tier 0: Minimal** | Internal tool, no auth, no sensitive data, no external APIs | CLI utilities, internal dashboards, static sites |
| **Tier 1: Standard** | Has auth, stores user data, connects to external APIs, but no financial or health data | SaaS tools, content platforms, project management apps |
| **Tier 2: Elevated** | Handles PII, financial data, health data, legal documents, or connects to accounts the user cares about (social media, email, CRM) | Client portals, CRM integrations, document management, analytics platforms |
| **Tier 3: Critical** | Can move money, access financial accounts, execute trades, manage credentials for high-value systems, or aggregate data whose exposure would cause severe harm | Financial platforms, payment systems, brokerage integrations, wealth management, crypto wallets, credential managers |

### Inheritance — exact control lists

Stated at `security-framework.md:21-25` as section-number inheritance. Expanded here into named controls, with the count of tier-conditional freeze-audit items each control block contributes (counted programmatically from the file — **81 items total** across the framework, on top of the 75 base):

| Tier | Inherits | Controls added at this tier | Framework §§ | Added audit items |
|---|---|---|---|---|
| **0** | — | Base `claude.md` security only: RLS, no hardcoded secrets, `.env` handling | — | 0 (the 75 base items cover Tier 0) |
| **1** | Tier 0 | Threat Modeling · Network Allowlist · Supply Chain Defense · Session Security · Plugin & MCP Security Validation | 2, 3, 7, 8, 12 | 3 + 4 + 4 + 44 = **55** |
| **2** | Tier 1 | Credential Management (registry + tiered encryption) · Action Tier System · Immutable Audit Logging · AI Agent Security · Canary Detection | 4, 5, 6, 9, 10 | 5 + 4 + 4 + 6 + 2 = **21** |
| **3** | Tier 2 | Everything: hardware-key encryption (§4.3–4.6), full ceremony for execution-tier actions, project-type-specific controls (financial / HIPAA / payments / multi-tenant) | all, esp. 4.3-4.6, 11 | 5 |

Per-control audit-item counts, exact: §3 Network Allowlist 3 · §4 Credential Management 10 (5 at Tier 2, 5 at Tier 3) · §5 Action Tiers 4 · §6 Immutable Audit Logging 4 · §7 Supply Chain 4 · §8 Session Security 4 · §9 AI Agent Security 6 · §10 Canary Detection 2 · §12 Plugin & Skill Security 44. §2 Threat Modeling contributes questions, not checkboxes.

### Auto-escalation rules (this is the best part, and it is pure data)

From `security-framework.md:34-47`. **→ Tier 2 or higher, automatically,** if the project handles any of: financial account credentials or tokens · bank account data (balances, transactions, account numbers) · brokerage or trading platform connections · health records (HIPAA) · legal documents with client PII · Social Security numbers or government IDs · passwords or auth credentials for other systems · data whose exposure would cause measurable financial or legal harm.

**→ Tier 1 or higher,** if the project connects to *any* external system via MCP server, plugin, or API integration. **→ Tier 2 or higher** if any connected system contains user PII, client records, financial data, or auth credentials — explicitly *"regardless of whether the project itself stores that data"* (the connection is the attack surface).

**→ Tier 3, automatically,** if the project can initiate transactions, move money, execute trades, or modify external account settings.

### Selected control detail worth porting

**Action Tier System** (§5, Tier 2+) — a 3-row table that is trivially renderable:

| Tier | Risk | Examples | Authentication |
|---|---|---|---|
| Passive | Read-only, no side effects | View dashboards, read reports, browse data | Standard login (password + MFA) |
| Sensitive | Modifies data, changes config, accesses sensitive exports | Edit records, change settings, export PII, connect external accounts | Re-auth within session (password + TOTP), 5-min window |
| Execution | Moves money, executes transactions, irreversible actions | Process payments, execute trades, change API connections, delete accounts, grant admin | Full ceremony (password + TOTP + hardware key), verified within last 60 seconds |

All execution-tier actions must route through a single `executeWithCeremony()` function; no code path may bypass it.

**Tiered credential encryption** (§4.3) — three storage tiers: *Background* (standard Vault, always accessible, low-risk keys) → *Session* (Vault + a key derived via HKDF from a WebAuthn hardware-key signature; decrypted only after a challenge-response ceremony; re-locked on session expiry; dependent jobs queue while locked) → *Execution* (same, plus per-action bounding parameters — max amount, max count, allowed targets, time limit — with auto-termination on parameter breach). Dev/prod split via `CREDENTIAL_SECURITY_MODE=development|production`; in dev the ceremony logs a bypass and proceeds, keeping code paths identical.

**Immutable audit logging** (§6) — a `security_audit_log` table with append-only RLS (INSERT and SELECT policies only; UPDATE/DELETE denied by absence). Ships an 8-row "what to log" table (Authentication, Credential access, Sensitive action, Execution action, Blocked request, External API call, Agent action, Canary trigger) each with trigger and fields-to-capture. Rule: log SHA-256 payload hashes, never payloads; never log credentials, full account numbers, or session tokens.

**Canary detection** (§10) — four canary types: credential canary (fake API key beside real ones), database canary (fake high-value row), agent canary (planted string that must never appear in agent output), DNS canary (fake allowlist domain).

**Plugin & MCP security validation** (§12, Tier 1+) — the largest single checklist in the repo at **44 items**, and the most relevant to us. It distinguishes *capability inputs* (plugins — grant the ability to act) from *knowledge inputs* (skills — shape reasoning), and decomposes a plugin into five component types with a stated risk gradient: skills (passive, no execution) → tools (moderate, AI-initiated) → hooks/scripts (highest, system-initiated and silent) → commands (user-triggered but may install persistent hooks). Sub-checklists: Component Inventory (4), Source Verification (4), Permissions Audit at tool level (5), Data Flow Mapping (3), Credential Handling (4), Auditability (4), Compliance Verification (3), plus §12.3 Skill Security Content Audit (6 scan patterns) and 11 rollup freeze-audit items.

The §12.3 skill-audit scan patterns are directly implementable as static analysis over `~/.claude/skills/**` — scan skill instructions for text that: exposes credentials · bypasses governance/security-tier controls · transmits data to undeclared endpoints · suppresses logging or audit trails · grants broader tool access than needed ("use any available tool") · conflicts with the declared security tier. It explicitly notes internally-authored skills are **not** exempt, because the AI cannot distinguish malice from careless wording.

---

## A. The hooks safety layer

Source: `claude.md` §20.5, lines 1746–2036. **There is no `hooks/` directory in the repo** — every hook is a fenced Python block inside `claude.md`, intended to be written out during project scaffolding to `.claude/hooks/`.

### What `pre_tool_use.py` blocks — the exact rules

Source `claude.md:1816-1877`. It reads the event JSON from stdin, and applies **three** rules:

| # | Matcher | Condition | Action | Exact message |
|---|---|---|---|---|
| 1 | `tool_name == "Bash"` | `"rm -rf /" in command` OR `"rm -rf /*" in command` — plain substring, not regex | **BLOCK** — emits `{"decision":"block","reason":...}` and returns | `Blocked: destructive rm -rf command` |
| 2 | `tool_name == "Bash"` | regex `(?:npm install\|npm i\|pnpm add\|bun add)\s+([^\s&\|;]+)` matches, captured pkg does not start with `-` and is not `.`, `approved-packages.json` exists, and the version-stripped name (`re.split(r'[@^~>=<]', pkg)[0]`) is not in `approved["packages"]` | **WARN only** — emits `{"warning": ...}`, does not block | `SUPPLY CHAIN: '<pkg>' is not in approved-packages.json. Verify: maintainer reputation, download count, last publish date, post-install scripts.` |
| 3 | `tool_name in ("Write","Edit")` | `file_path.endswith(p)` for `p` in `["CLAUDE.md", "prd.md"]` | **BLOCK** | `Blocked: <file> is a governing document. Propose changes to project owner per Section 22.5.` |

Anything else falls through with no output, which Claude Code treats as allow. Honest assessment: **rule 1 is nearly cosmetic** — it is a two-string substring check that misses `rm -rf ~`, `rm -rf .`, `rm  -rf /` (double space), `rm -fr /`, and every variable-indirection form. Rule 3 is the genuinely useful one and is a novel idea we do not have: *treat the governing documents as immutable to the agent.* Rule 2 is a real supply-chain idea implemented as an advisory.

### The other three hooks

- **`post_tool_use.py`** (`claude.md:1879-1949`) — three rules, all warn-only: (a) after `Write`/`Edit`, if the file exists, has >200 lines, and its path contains `/pages/`, warn to decompose per §17.2; (b) after any bash command containing an install verb, shell out to `npm audit --audit-level=high --json` with a 30s timeout and warn if `metadata.vulnerabilities.high > 0 or .critical > 0`; (c) after an install, if none of `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` / `bun.lockb` exists, warn that versions are unpinned.
- **`stop.py`** (`:1952-1978`) — emits `{"reminders":[...]}` if `lessons-learned.md` or `tests/role-tests.md` is missing.
- **`pre_compact.py`** (`:1980-2009`) — the interesting one. Always injects a reminder that phase gates are in effect and that the agent must stop for approval after the current phase; if `STATE.md` exists, adds a second reminder to re-read `STATE.md` and `CONTEXT.md` after compaction. **This is the framework's answer to context compaction eating the phase gate.**

### Wiring into settings.json

`claude.md:1776-1808` gives the hooks block; `:2050-2061` gives the permissions block; `:2063` states explicitly that both go in the same single `.claude/settings.json`. Merged:

```json
{
  "permissions": { "defaultMode": "auto" },
  "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" },
  "hooks": {
    "PreToolUse":  [{ "matcher": "", "hooks": [{ "type": "command", "command": "python .claude/hooks/pre_tool_use.py" }] }],
    "PostToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "python .claude/hooks/post_tool_use.py" }] }],
    "Stop":        [{ "matcher": "", "hooks": [{ "type": "command", "command": "python .claude/hooks/stop.py" }] }],
    "PreCompact":  [{ "matcher": "", "hooks": [{ "type": "command", "command": "python .claude/hooks/pre_compact.py" }] }]
  }
}
```

Note `"matcher": ""` = match all tools. Directory layout is `.claude/{agents,hooks,settings.json}`.

### Hook event taxonomy

`claude.md:1754-1769` lists **14** events, two more than our `EVENTS` array in `src/sections/HooksSection.jsx:11` (which has 9). Theirs: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, plus Agent-Teams-only `TeammateIdle` and `TaskCompleted`. **We are missing `PostToolUseFailure`, `PermissionRequest`, `SubagentStart`, `TeammateIdle`, `TaskCompleted`** — five events. **Unverified** whether all 14 are real in current Claude Code; the last two are documented as Agent-Teams-gated and the middle ones should be confirmed against official docs before we add them to our picker.

### Hook security rules (§20.5.4) — 5 rules, portable as lint checks

1. Never log sensitive data in hook output — no env vars, API keys, or credentials to stdout/logs.
2. Hooks must not make external network calls unless explicitly approved in the PRD.
3. Keep hooks lightweight — they run synchronously and block the pipeline. **Target under 500ms.**
4. Test hooks independently before registering them; invalid JSON output disrupts Claude Code.
5. Hooks supplement, not replace, the build contract.

### Defense in depth (§20.6.1)

Four layers, in firing order: (1) hooks — fire *before* the permission system and can block even under `--dangerously-skip-permissions`; (2) auto-mode classifier — Anthropic-side, blocks destructive ops / exfiltration / prompt injection, escalates to human after 3 consecutive or 20 total denials, terminates in headless; (3) Superpowers two-stage review per task; (4) git as recovery. The doc notes that under bypass permissions, hooks become *the only* automated safety layer.

---

## A. Artifact templates

The kickoff prompt produces exactly four files, in one shot, from raw context (voice-note transcript, notes, whatever).

### 1. Project-specific `claude.md` (build contract)

A *subtractive* derivative of the 2472-line master. `kickoff-prompt-template.md:117-217` specifies precisely what to keep, cut, and adjust. Master structure, 24 sections:

`0` Project Metadata · `1` Core Operating Principles (1.1 Plan-First, 1.2 Security>Velocity, 1.3 Deterministic Execution, 1.4 No Assumption Drift, 1.5 Build Mode, 1.6 Deterministic Over Probabilistic, 1.7 Context Efficiency) · `2` Default Tech Stack + Pre-Approved Dependencies · `3` Tenancy Model · `4` Authorization Enforcement Layers · `5` Backend Architecture · `6` Business Logic Integrity (DRY) · `7` Deterministic Build Order · `8` Environment & Deployment (incl. 8.8 Setup Guides, 8.9 Build Artifact Validation) · `9` Error Handling & Debug · `10` Schema Migration · `11` Notification Architecture · `12` Data Integrity · `13` Performance & Observability · `14` Testing Strategy · `15` Auto-Remediation · `16` Rollback & Recovery · `17` Code Hygiene · `18` LLM Usage & Cost · `19` SEO & Crawl Policy · `20` Claude Code Execution Contract (20.1 DoD, 20.2 Error Recovery, 20.3 Parallel Execution, 20.4 Pre-Branch Checklist, 20.5 Hooks, 20.6 Permissions, 20.7 `STATE.md`, 20.8 Discuss Phase, 20.9 Framework Selection) · `21` **Freeze Audit Checklist** · `22` Claude Best Practices · `23` Kickoff Format · `24` Versioning.

The **never-remove list** (`:186-205`) is itself good governance data — 16 invariants that survive every project, build mode, and framework: plan-first discipline · security>velocity · deterministic over probabilistic · no assumption drift / stop-and-ask · debug mode spec · error handling & UI states · git requirements · Edge Function deploy discipline · schema drift prevention · component architecture rules · feature extraction protocol · data safety in dev/test · code hygiene · reuse over recreation & doc integrity · mid-build error recovery · hook enforcement (`pre_tool_use` minimum) · freeze audit · security tier classification · the versioning table.

### 2. Completed PRD (`prd.md`)

`prd-template.md`, 663 lines, sections 0–19: `0` Document Control (+0.1 Working Canvas Notes) · `1` Product Purpose & Positioning · `2` Goals / Non-Goals / Success Metrics · `3` Users, Personas, Roles · `4` **Permissions Matrix** (capability × role grid) · `5` User Journeys · `6` UX & Design System · `7` Core Modules · `8` Tenancy & System Architecture (incl. Observability, Parallel Execution, Hooks, Permission Config, Development Framework, E2E Testing, Setup Guide Inventory) · `9` Data Model (mandatory) · `10` Security/Compliance/Privacy (10.1 Security Classification, Network Allowlist, Action Tiers, 10.2 Controls, 10.3 Compliance, 10.4 Security Acceptance Tests) · `11` Business Logic & Calculations · `12` Reporting & Exports · `13` NFRs · `14` Environment Variables · `15` Implementation Notes for Claude Code · `15a` LLM Usage & Batch Processing · `16` Milestones (branches into `--- EXPRESS BUILD ---` 3-step vs `--- FULL BUILD ---` phased) · `17` **Assumptions, Non-Assumptions, Open Questions** (+ a "Resolved Decisions" log) · `18` Acceptance Criteria · `19` Change Log · then Kickoff Instructions.

Filling rules: fill everything you can; mark guesses `[INFERRED]`; where context is insufficient, keep the placeholder and add a question to §17; never invent; removed sections keep their number with "Not applicable to this project" so structure stays traceable.

### 3. Claude Code kickoff prompt (`kickoff-prompt.md`)

A ready-to-paste prompt, branching on Express vs Full Build and on Superpowers/GSD/BMAD. Common elements: read `claude.md` and `prd.md` first · state build mode · install framework + Context7 + Frontend Design · generate setup guides · run discuss phase · create `STATE.md`/`CONTEXT.md` · present the Category-1 human checklist and wait · verify `.env` against `.env.example` · create `.claude/agents/` and `.claude/hooks/` · create `.claude/settings.json` with auto mode + hooks · create `.npmrc` with `force=true` · present the freeze audit at the end. Terminates with a fixed closing instruction to confirm receipt and produce the plan without writing code.

### 4. Open questions summary (`open-questions.md`)

Lists: the build mode selected + reasoning · every gap found · every `[INFERRED]` decision and why · every section removed from the master and why · architectural decisions needing input · `[SUGGESTED]` recommendations. **Grouped into 11 fixed categories** — Build Mode, Architecture, Auth Provider, Roles/Permissions, Data Model, Business Logic, Integrations, Observability, UX, Claude.md Customization, Other.

### The Open Questions Resolution Phase (mandatory hard gate)

`kickoff-prompt-template.md:339-352`. After delivering the four files, the model must walk the human through every question interactively using `ask_user_input`, highest-impact first (Architecture → Auth → Data Model, then UX/Observability), then **regenerate all four files** and replace `open-questions.md` with a "Resolved Decisions" log. Final handoff must have zero unresolved items in PRD §17. Skipped entirely for GSD, which discovers requirements incrementally. Stated rationale: unresolved questions become assumption drift, and Claude Code will silently decide them wrongly.

Also notable, `:357`: the model is told **not** to ask clarifying questions before the first draft — drafting is what surfaces the real questions. That is a good product principle for our Ticket section.

### Three-category setup-guide model (§8.8)

Every external service gets `docs/resources/<tool>-setup-guide.md` with exactly three sections: **Category 1 Human-Only** (create account, create a NEW project, copy credentials to `.env` — the only manual work) · **Category 2 Automated** (Claude Code does it via CLI/MCP: schema, auth providers, RLS, Edge Functions, storage buckets — no dashboard clicking) · **Category 3 Post-Build** (custom domains, tier upgrades, security review). Plus a `docs/resources/README.md` index carrying all three checklists. All MCP/CLI connections must be scoped to the new project, never production.

---

## A. Feature inventory

"Where in the code" means where in the markdown — there is no code.

| Feature | What it does | Where | Depends on |
|---|---|---|---|
| 75-item freeze audit | Production-readiness gate; emits `READY TO FREEZE` or `READ-ONLY PLAN` | `claude.md:2293-2379` | §20.1 self-audit loop; `STATE.md`; `security-framework.md` for tier items |
| Tiered security framework | 4 tiers, additive inheritance, auto-escalation, 81 extra audit items | `security-framework.md` (all 605 lines) | PRD §10.1 declaration; kickoff Dimension 3 |
| Security auto-escalation | 8 data triggers → Tier 2+; any MCP/plugin → Tier 1+; money movement → Tier 3 | `security-framework.md:34-47` | — |
| `pre_tool_use.py` | Blocks `rm -rf /`, blocks writes to `CLAUDE.md`/`prd.md`, warns on unapproved installs | `claude.md:1816-1877` | Python; `approved-packages.json`; `.claude/settings.json` |
| `post_tool_use.py` | 200-line warning on `/pages/`, `npm audit` after installs, lockfile-presence check | `claude.md:1879-1949` | Python; npm on PATH |
| `stop.py` | Reminds about `lessons-learned.md` and `tests/role-tests.md` | `claude.md:1952-1978` | — |
| `pre_compact.py` | Re-injects phase-gate rule + `STATE.md`/`CONTEXT.md` re-read before compaction | `claude.md:1980-2009` | `STATE.md`, Full Build |
| Hook event taxonomy | 14 events with enforcement-use column | `claude.md:1754-1769` | — |
| Hook security rules | 5 rules incl. <500ms budget, no network calls, no secret logging | `claude.md:2011-2018` | — |
| Framework auto-selection | 2-dimension assessment → Superpowers / GSD / BMAD × Express / Full | `kickoff-prompt-template.md:21-92`; `claude.md:2197+` | Human override path |
| Build modes | Express (one-shot) vs Full (phased with gates); 7 vs 6 explicit criteria | `kickoff-prompt-template.md:25-44`; `claude.md:78-92` | — |
| Open-questions hard gate | Interactive resolution before handoff; zero unresolved at exit | `kickoff-prompt-template.md:339-352` | `ask_user_input` tool |
| Pre-build hard gate | Human confirms Category-1 setup + `.env` before any code | `claude.md:2425`; audit #3 | Setup guides |
| `STATE.md` | Compaction-proof build state: status, phase history, decisions, blockers | `claude.md:2095-2138` | `pre_compact.py` |
| `CONTEXT.md` / discuss phase | Captures UI/UX implementation decisions before coding | `claude.md:2139-2196` | Superpowers only |
| `lessons-learned.md` | Append-only failure/fix log, folded back into master contract after ship | `claude.md:1484-1496`; audit #58 | — |
| Three-category setup guides | Human-only / automated / post-build split per service, + index | `claude.md:646-819` | MCP/CLI availability |
| Permission config | Auto mode + Agent Teams env flag + hooks in one `settings.json` | `claude.md:2038-2094` | Claude Code ≥ Mar 2026 |
| Defense in depth | 4 layers: hooks → auto-mode classifier → two-stage review → git | `claude.md:2072-2077` | — |
| Custom subagents | `security-reviewer`, `component-checker`, `test-coverage` in `.claude/agents/` | `claude.md:1651-1727` | Full Build |
| Plugin/MCP validation | 44-item checklist, 5 component types, risk gradient | `security-framework.md:442-510` | Tier 1+ |
| Skill content audit | 6 scan patterns over skill instruction text | `security-framework.md:511-528` | Tier 1+ |
| Action tier system | Passive / Sensitive / Execution with auth requirements | `security-framework.md:208-240` | Tier 2+ |
| Tiered credential encryption | Background / Session / Execution; WebAuthn+HKDF; dev bypass flag | `security-framework.md:149-205` | Tier 2+ / Tier 3 |
| Immutable audit logging | Append-only RLS table + 8-row what-to-log table | `security-framework.md:243-284` | Tier 2+ |
| Canary detection | 4 canary types + 4-step response | `security-framework.md:387-408` | Tier 2+ |
| Component architecture | ~200-line file ceiling, extract-then-share protocol | `claude.md:1212-1263` | audit #17, #18 |
| React render stability | Context memoization, no context objects in `useCallback` deps | `claude.md:1179-1211` | audit #13-15 |
| Project-type controls | Financial / HIPAA / payments / multi-tenant specifics | `security-framework.md:411-441` | Tier 3 |

---

## A. Gaps and weaknesses

1. **It is markdown, not software.** Nothing validates, tracks, or enforces the 75 items. A human reads a list and self-attests. There is no tooling, no state, no history, no evidence collection. *This is precisely the gap we fill.*
2. **`pre_tool_use.py`'s destructive-command check is weak.** Two literal substrings. Misses `rm -rf ~`, `rm -rf .`, `rm -fr /`, extra whitespace, `$VAR` indirection, `find -delete`, `git clean -fdx`, `dd`, truncation redirects. Anyone relying on it as *the* safety layer under `--dangerously-skip-permissions` is exposed. Our own `git-guardrails-claude-code` skill is more thorough.
3. **Heavy stack lock-in.** ~20 of 75 items assume Supabase + Discord OAuth + Railway + React. The kickoff prompt does have explicit strip-rules for this, but the master list needs manual filtering before it renders usefully for a generic project.
4. **No machine-readable form.** The checklist is markdown bullets, the tiers are markdown tables. Every consumer must re-parse. There is no JSON/YAML schema, no IDs, no stable keys — so items cannot be referenced, tracked over time, or diffed.
5. **Unverified hook-event list.** 14 events claimed; our picker has 9. At least `PostToolUseFailure`, `PermissionRequest`, and `SubagentStart` need verification against official docs before we copy them.
6. **Single-author, low-adoption, possibly stale.** 8 stars, 1 fork, 0 issues, no external validation, quiet since 2026-04-14. Claims like the auto-mode "0.4% false positive rate" (`claude.md:2069`) are unsourced.
7. **The 200-line file ceiling is arbitrary and self-contradicting** — `claude.md` itself is 2472 lines, and the `post_tool_use.py` check only fires on paths containing `/pages/`.
8. **Freeze-audit item count is doc-drift-prone.** The version table says 67 items at v1.4, 70 at v2.1, 75 at v2.3 — maintained by hand. It happens to be exactly 75 today, but nothing enforces that.
9. **No verification story for the security tier.** Nothing checks that a Tier 2 project actually has a `credential_registry` table. The controls are prose specs, not tests.
10. **`lessons-learned.md` fold-back is fully manual** and depends on the author remembering to do it between projects.

---

## B. Claude Code Builder — Identity

**Repo verified:** https://github.com/krzemienski/claude-code-builder (cloned and read in full). This is the project matching the description "AI-powered Python CLI tool that automates the entire software development lifecycle using the Claude Code SDK" — that string is the repo's own GitHub description.

| Field | Value |
|---|---|
| Author | `krzemienski` |
| License | **MIT** (SPDX `MIT`) |
| Stars / forks | 24 / 4 |
| Open issues | 1 |
| Language | Python |
| Created | 2025-06-12 |
| Last commit | `3804a9b` 2025-11-17 (Merge PR #4) — **quiet ~8 months** |
| Topics | `ai-code-generation`, `anthropic`, `claude`, `claude-code`, `claude-code-sdk`, `opus4` |
| Version | `0.1.0` in `pyproject.toml:3`; v2 CLI hardcodes `2.0.0` at `src/claude_code_builder_v2/cli/main.py:20` |
| Python | `>=3.11,<3.14`; `.python-version` pins `3.11.7` |
| Entry point | `claude-code-builder = "claude_code_builder_v2.cli.main:cli"` (`pyproject.toml:31`) |
| SDK | `claude-agent-sdk` from git `anthropics/claude-agent-sdk-python`, branch `main` (unpinned) |
| Tests | `tests/` contains **one file**: `tests/__init__.py` |

Real git activity is **4 working days**: three commits 2025-06-12, one 2025-06-13, then all of v2 + v3 planning landed in a single burst on 2025-11-17. No `.github/`, no CI.

Install (README): `git clone` → `poetry install` → `npm install -g @modelcontextprotocol/server-*` → `cp .env.example .env`. Note `.env.example` **does not exist** in the repo, and README's `doctor` command does not exist in either CLI.

There are two parallel packages: `src/claude_code_builder/` (v1, deprecated) and `src/claude_code_builder_v2/` (live, per the console-script target). ~15.8K lines of source.

## B. The problem it solves

Stated ambition: take a natural-language spec (up to 150K+ tokens) and drive it all the way to a running, tested, documented application with minimal human intervention — analyzing the spec, architecting via multi-agent collaboration, chunking context to fit the window, and checkpointing so a build can resume after failure rather than restarting and re-paying.

The real problems it names are good ones: (a) specs exceed the context window, so you need semantic chunking with per-phase relevance selection; (b) long builds fail midway and re-running from zero is expensive, so you need checkpoint/resume keyed to a spec hash; (c) a single agent doing everything degrades, so you need role-specialized agents; (d) generated code needs acceptance criteria and review, not just "it ran".

## B. Value proposition

Almost all of the value here is **conceptual, not operational** (see Gaps). What is worth taking:

- The **spec-chunking + per-phase relevance-scoring model** for handling oversized inputs.
- The **checkpoint/resume design keyed to a SHA-256 spec hash**, with an explicit "spec changed, require confirmation" branch.
- The **`AcceptanceCriterion` schema** — the cleanest structured-criteria model I found in either repo.
- The **code-review rubric** — 8 review dimensions, a 5-rule static-analysis table, and a numeric approve/revise/reject gate.
- The **MCP compliance gate** — a phase → required-checkpoint map that fails a build if a required MCP server was never used.

## B. Feature inventory

| Feature | What it does | Where in the code | Depends on | Live? |
|---|---|---|---|---|
| CLI v2 | 5 commands: `build`, `init`, `resume`, `status`, `logs` | `src/claude_code_builder_v2/cli/main.py` | click, rich | yes (entry point) |
| CLI v1 | 7 commands: `build`, `resume`, `analyze`, `validate`, `init`, `config`, `status` | `src/claude_code_builder/cli/main.py` + `cli/commands/*.py` | click | deprecated |
| SDK client manager | Wraps `ClaudeAgentOptions` / `query` / `ClaudeSDKClient` | `src/claude_code_builder_v2/sdk/client_manager.py` | `claude-agent-sdk` | broken (see Gaps) |
| Cost tracker | Per-model $/1M pricing table, usage records, budget check | `src/claude_code_builder_v2/sdk/cost_tracker.py:24-41` | — | dead (`track_usage` has no callers) |
| Hook manager | 5 callback buckets: before/after request, tool call, permission check, error | `src/claude_code_builder_v2/sdk/hook_manager.py:25-31` | — | dead (0 registrations) |
| Tool registry | `@tool`-wrapped `read_file`, `run_command` | `src/claude_code_builder_v2/sdk/tool_registry.py` | SDK `tool` | dead (never instantiated) |
| Progress reporter | Streams chunks, logs every 10th | `src/claude_code_builder_v2/sdk/progress_reporter.py` | — | dead |
| Context manager | 150K budget, semantic/sliding/section chunking, per-phase relevance scoring | `src/claude_code_builder/core/context_manager.py` (1056 lines) | tiktoken **disabled** | v1 only |
| Checkpoint manager | 14-state `MCPCheckpoint` enum + per-phase compliance validation | `src/claude_code_builder/mcp/checkpoints.py` | — | v1 only |
| Resume | Spec-hash validation, skip completed phase IDs | `src/claude_code_builder/core/output_manager.py:308-410` | `.checkpoints/latest_state.json` | v1 only |
| Output manager | 9-subdir project scaffold, git init + initial commit | `src/claude_code_builder/core/output_manager.py:207-282` | gitpython | v1 only |
| Builders | Emit `CLAUDE.md`, `.claude/commands/*.md`, `README/CONTRIBUTING/docs/API.md` | `src/claude_code_builder_v2/builders/*.py` | — | dead (never called) |
| MCP orchestrator | Subprocess start/stop/restart + health loop | `src/claude_code_builder/mcp/orchestrator.py` | npx servers | v1 only |
| Build validator | 4 groups of file-existence checks | `validate_build.py:100-175` | — | standalone script |

## B. The SDLC stage machine

**There is no phase/stage enum.** The stage machine is a hardcoded `if/elif` string dispatch at `src/claude_code_builder_v2/executor/phase_executor.py:94-109`. Seven stage names:

| # | Stage (verbatim) | Agent | Produces (intended) | Actually invoked? |
|---|---|---|---|---|
| 1 | `analyze_specification` | `SpecAnalyzer` | `{"analysis", "specification"}` — summary, complexity, requirements, tech stack, risks, timeline | **yes** |
| 2 | `generate_tasks` | `TaskGenerator` | `{"tasks", "analysis"}` — task list, deps, effort, phase groupings | **yes** |
| 3 | `build_instructions` | `InstructionBuilder` | `{"instructions", "tasks"}` — step-by-step guide, file structure, templates | **yes** |
| 4 | `generate_documentation` | `DocumentationAgent` | `{"documentation"}` | no — dead branch |
| 5 | `generate_tests` | `TestGenerator` | `{"test_specifications"}` | no — dead branch |
| 6 | `review_code` | `CodeReviewer` | `{"review"}` | no — dead branch |
| 7 | `create_acceptance_criteria` | `AcceptanceGenerator` | `{"acceptance_criteria"}` | no — dead branch |

Only stages 1–3 are called, from `src/claude_code_builder_v2/executor/build_orchestrator.py:192-228`.

Supporting enums, `src/claude_code_builder_v2/core/enums.py`: `AgentType` (8 members, :6-16) · `PhaseStatus` = `PENDING, IN_PROGRESS, COMPLETED, FAILED, SKIPPED` (:19-26) · `PermissionMode` = `AUTO, MANUAL, ALWAYS_ALLOW, ALWAYS_DENY` (:29-35, **never used**) · `BuildStatus` = `INITIALIZING, IN_PROGRESS, COMPLETED, FAILED, CANCELLED` (:38-45).

v1's richer lifecycle enum, `src/claude_code_builder/core/enums.py:123-139`, `MCPCheckpoint` (14 members): `PROJECT_INITIALIZED, CONTEXT_LOADED, SPECIFICATION_ANALYZED, TASKS_GENERATED, PHASE_START, BEFORE_IMPLEMENTATION, RESEARCH, TASK_COMPLETE, PHASE_COMPLETE, PHASE_COMPLETED, CODE_GENERATED, TESTS_EXECUTED, CHECKPOINT, BUILD_COMPLETED` (note the duplicate-ish `PHASE_COMPLETE`/`PHASE_COMPLETED`). v1 also has `TaskStatus` (:31-39), `Complexity`, `ProjectType`, `TestType`, `ErrorType`, `RecoveryAction`, `ChunkStrategy`.

**Four mutually inconsistent stage lists exist in the repo** — worth knowing before copying any of them:
- Code (v2): the 7 above.
- Design intent (`claude-code-builder-prd.md:1244-1367`): 6 stages — Specification Analysis → Task Generation → Acceptance Criteria Generation → Custom Instructions Generation → Execute Implementation → Generate Documentation. **This is the best-formed list.**
- v1 runtime: phases are LLM-generated (prompt asks for "approximately 10-15 phases", `agents/task_generator.py:216`), with a 5-phase hardcoded fallback at `:798-827` — Project Setup → Core Implementation → Integration → Testing → Documentation.
- Proposed v3 (`V3_PLAN.md:218-240`), unimplemented: Scaffold → Test → Security → Optimize → Review → Validate → Docs → Deploy.

**Artifacts on disk.** v2 writes essentially nothing — it creates `output_dir/build_{uuid8}/` plus logs, holds all `PhaseResult`s in memory, and has no artifact-persistence call anywhere. v1's layout is real (`core/output_manager.py:207-217`): `src/`, `logs/`, `artifacts/`, `.checkpoints/`, `.memory/`, `docs/`, `tests/`, `logs/api_calls/`, `.claude-code-builder/` — plus `metadata.json`, `artifacts/original_specification.md`, timestamped checkpoints, `.gitignore`, and a `git init` + initial commit.

**How it drives the SDK.** Options are constructed at `sdk/client_manager.py:41-48` (`system_prompt`, `model`, `max_turns`, `allowed_tools`, `permission_mode`, `cwd`) — and **that object is never passed to any SDK call**. The only live path, `query_simple()` (:53-99), builds its own 3-key dict and splats it as kwargs into `query()`, then does `response_text += chunk`. Both are wrong against the real SDK (`query` takes `options=ClaudeAgentOptions`, and yields Message objects, not `str`). Every agent's `get_allowed_tools()` returns `[]`, so even on the happy path Claude would have **no tools** — it is a text-completion pipeline, not an agentic one.

**Context management (v1).** `core/context_manager.py`: budget `max_context_tokens=150000`, `reserve_output_tokens=4000`, effective 146000. `SpecificationChunker` with `max_chunk_tokens=30000` and three strategies (semantic on markdown sections with overlap carry, sliding window, section-based). Per-phase selection scores chunks +10 per required-section title match, +5 per keyword in chunk metadata, +2 per keyword in content (:640-661). Caveat: tiktoken is commented out, so all token counts are `len(text) // 4`; and the phase-keyword table (:664-689) covers 5 phase names that match neither v1's nor v2's actual phases, so it returns `[]` in practice.

**Resume (v1).** `check_resume_capability` (`core/output_manager.py:308-364`) loads `.checkpoints/latest_state.json`, validates subdirs and the saved spec, re-hashes the spec with SHA-256 and compares to `state.spec_hash`; on mismatch returns `can_resume=True, requires_confirmation=True`. Completed phase IDs are then filtered out. **Resume in v2 is fake** — it globs for a `.md`, calls `build()` without `setup()`, and would raise `RuntimeError`; nothing writes the `.ccb_state.json` its `status` command looks for.

**MCP.** `.mcp.json` declares 5 required servers — `context7`, `memory`, `sequential-thinking`, `filesystem`, `git` — but **every package name is fabricated** (`@context/mcp`, `@memory/mcp`, etc.). The real names (`@modelcontextprotocol/server-*`) appear only in README and in v1's `core/config.py:71-124`. As committed, `.mcp.json` cannot start any server.

## B. Gaps

Blunt: **this repo does not work end-to-end.** Concrete, verified blockers:

1. `src/claude_code_builder/agents/test_generator.py` **does not exist** but `agents/__init__.py` imports it → v1 cannot be imported at all.
2. `src/claude_code_builder_v2/__init__.py` is missing.
3. v2's `query()` usage is wrong twice over (kwargs vs `options=`; `str +=` on Message objects) — the first agent call raises.
4. `ClaudeAgentOptions` is built and discarded; `allowed_tools`, `permission_mode`, `cwd` never reach the SDK.
5. All agents expose zero tools → Claude cannot write files even if it ran.
6. v2 persists no build artifacts; `validate_build.py` would fail on any v2 output.
7. Cost/token telemetry is always zero — `track_usage()` has no callers; `--max-cost` is decorative.
8. v2 `resume` calls `build()` without `setup()` → guaranteed `RuntimeError`.
9. `.mcp.json` lists five nonexistent npm packages.
10. 4 of 7 v2 phases and all 3 v2 builders are unreachable code.
11. **Zero tests.** `make test` builds a wheel, prints `--version`, then prints "passed" unconditionally (`Makefile:48-53`). pytest and coverage are configured for a suite that does not exist, and coverage points at the deprecated package.
12. Docs describe commands that exist nowhere (`doctor`, `plugins list`, `templates`, `checkpoints verify`) and flags that are accepted and ignored (`--from-phase`, `--from-task`, `--max-cost`).
13. **v3 is prose only** — three files totalling ~129KB with zero source, every roadmap checkbox unchecked, and *fabricated telemetry* presented as real results (`V3_FEATURE_6:634-639` cites success rates and usage counts for a system that has never run). Treat all v3 numbers as fiction.
14. v1's `spec_analyzer.py:234-245` silently falls back to hardcoded stub values (`"Unknown Project"`, `estimated_hours: 80.0`) when the LLM response isn't fenced JSON.

**Unverified:** whether any build has ever completed end-to-end. No committed build output, logs, or CI exist.

**Maturity verdict:** a prototype scaffold with an unusually large documentation surface. Mine it for its data structures and its chunking/checkpoint *designs*; do not treat any of its code or its performance claims as validated.

## B. Extractable data structures

Ranked by how cleanly they lift out:

1. **`AcceptanceCriterion` schema** — `src/claude_code_builder/core/models.py:330-360`. `AcceptanceCriterion{criterion_id ("FC001"), description, test_type, test_steps[TestStep{description, expected_result, validation_method, automated}], expected_result, validation_method, test_data_requirements[], priority, automated}`; `AcceptanceCriteria` buckets into `functional / performance / security / integration`. Unused in code — no v1 acceptance generator exists — but well-formed.
2. **Code-review rubric** — `src/claude_code_builder/agents/review_agent.py`. Three separable pieces: the output schema (`quality_score` 0-100, `requirements_met/missing`, `code_issues[{type, line, message}]`, `security_concerns`, `performance_concerns`, `best_practices_violations`, `positive_aspects`); an 8-point checklist (:191-199); a 5-rule static-analysis table (:245-282) — line >88 chars → warning, bare `except:` → warning, `TODO`/`FIXME` → warning, `eval(`/`exec(` → **error**, `pickle.loads` → warning; and a numeric gate (:357-367) — `score>=80 and security_issues==0` → approved, `>=60 and <=2` → needs_revision, else rejected, with penalties `min(security*5, 30) + min(perf*3, 20)`.
3. **MCP compliance gate** — `src/claude_code_builder/mcp/checkpoints.py:358-392`. Phase → required-checkpoint map, plus two hard rules ("Memory MCP server was never used", "Filesystem MCP server was never used").
4. **Build-output validation rules** — `validate_build.py:100-175`. Four groups with errors vs warnings distinguished.
5. **Error → recovery map** — `claude-code-builder-prd.md:1561-1570` over `ErrorType` → `RecoveryAction` = `RETRY, RETRY_WITH_BACKOFF, RETRY_WITH_OPTIMIZED_CONTEXT, SKIP_TASK, FAIL_PHASE, RESUME_FROM_CHECKPOINT, MANUAL_INTERVENTION`.
6. **Default slash-command set** — `src/claude_code_builder_v2/builders/command_builder.py:69-100`: `test.md`, `build.md`, `check.md`, `review.md`.
7. **Model pricing table** — `sdk/cost_tracker.py:24-41`. Stale (2024 Claude 3 prices); we have better via our own cost tracking.
8. **v3 gate tables (proposed, never run)** — test-coverage-by-project-type matrix (`V3_PLAN.md:1291-1299`: Library >90%, Web API >80%, CLI >75%, Frontend >70%, Microservice >80%), architecture fitness scoring, testing anti-patterns. Aspirational but the coverage matrix is reasonable.

---

## Overlap with Loush Dashboard

| Their feature | Our equivalent section | Who does it better | Note |
|---|---|---|---|
| A: 75-item freeze audit | **NONE** | Neither — they have the data, we have the renderer | Biggest single gap on our side. We have no checklist/scorecard component at all (`src/company/AtomsSection.jsx:138` renders an `outputChecklist` but it is display-only, company-gated, and sourced from repo JSON). |
| A: Security tiers 0–3 + auto-escalation | **NONE** | Them (only they have it) | Pure data model. Nothing in our app classifies a project by sensitivity. |
| A: 81 tier-conditional audit items | **NONE** | Them | Natural second tab beside the 75. |
| A: `pre_tool_use.py` blocking rules | **Hooks** — `HOOK_LIBRARY`, `server/index.mjs:3669-3682` | **Us, structurally; them, on one rule** | Our library has 5 entries with install-into-scope, dedupe, versioning via `track()`, dry-run execution, and matcher testing. Theirs is 4 scripts in a markdown file. But their "block writes to `CLAUDE.md`/`prd.md`" rule is one we don't have and should. |
| A: `pre_compact.py` phase-gate re-injection | **NONE** | Them | We don't have a `PreCompact` entry in `HOOK_LIBRARY` at all, even though `PreCompact` is in our `EVENTS` array (`HooksSection.jsx:11`). |
| A: 14 hook event types | **Hooks** — `EVENTS` at `HooksSection.jsx:11` (9 events) | Them, on coverage | We're missing `PostToolUseFailure`, `PermissionRequest`, `SubagentStart`, `TeammateIdle`, `TaskCompleted`. Verify before adding. |
| A: Hook security rules (<500ms, no network, no secret logging) | **Hooks** — `GET /api/hooks/health`, `POST /api/hooks/dryrun` | **Us** | We already dry-run hooks and measure. Their 500ms budget is a threshold we could assert against dry-run timings. |
| A: `settings.json` hooks + permissions wiring | **Hooks** — `PUT /api/hooks`, `SETTINGS_FILES` at `server/index.mjs:328-350` | **Us, decisively** | We already read/write all three scopes (`user`/`project`/`local`) with backup. |
| A: Plugin/MCP validation (44 items) + skill content audit (6 patterns) | **NONE** (adjacent: Capabilities/MCP sections, `src/sections/McpSection.jsx`) | Them | The skill scan patterns are implementable as static analysis over `~/.claude/skills/**` — very much in our local-first wheelhouse. |
| A: Defense-in-depth model | **NONE** | Them | Conceptual; renders well as a diagram in Governance. |
| A: `STATE.md` build state | **NONE** (adjacent: Board `~/.claude/taskboard.json`) | Split | Our board is a live kanban with real persistence and versioning; theirs is a markdown file. Different problems. |
| A: `lessons-learned.md` | **NONE** (adjacent: Quality → Review loop) | Split | Our Reviews tab already parses `/code-review` findings with `{category, verdict, outcome}` from transcripts — arguably a better lessons feed, since it's automatic. |
| A: Open-questions gate + 11 categories | **Ticket** — `CriteriaTab`, `META` at `TicketSection.jsx:406` | Them, on the concept | Our `META` has 2 artifact kinds (`ac`, `tests`) stored as markdown blobs. Their open-questions structure with `[INFERRED]`/`[SUGGESTED]` markers is a natural third kind. |
| A: PRD template (20 sections) | **Ticket** (partial) | Them | We generate AC and tests; we don't generate a PRD. |
| A: Permissions matrix (capability × role) | **NONE** | Them | Pure table data. |
| A: Setup guides, 3-category model | **Setup** — `SetupSection.jsx` (443 lines) | **Us, for our scope** | Ours configures *the dashboard*; theirs documents *third-party service setup for a built app*. Barely overlapping. |
| A: Framework auto-selection (Superpowers/GSD/BMAD) | **NONE** | Them | We host `superpowers:*` skills but have no notion of framework selection. |
| A: Build modes (Express/Full) | **NONE** | Them | Criteria lists are clean data. |
| A: Component architecture (~200-line ceiling) | **NONE** (adjacent: Working Set, `server/fe.mjs`) | Split | We track what the agent changed; we don't assert file-size ceilings. |
| B: SDLC stage machine | **PlanGraph** (`src/sections/PlanGraph.jsx`, `src/lib/plan.js`) | **Us, decisively** | We extract a real DAG from real transcripts with dependencies, skills, MCP servers, and tool calls. Theirs is a 7-branch `if/elif` where 4 branches are dead. |
| B: Checkpoint/resume with spec hash | **NONE** | Them (as a design) | We have no resume concept. Their SHA-256-hash-and-confirm design is sound even though the code is broken. |
| B: Context chunking (150K, relevance scoring) | **Context Explorer** (`ContextExplorerSection.jsx`) | **Unverified which** | Need to compare directly; theirs is disabled-tiktoken char-counting, so likely ours. |
| B: Acceptance criteria schema | **Ticket** — `CriteriaTab`, artifacts as `{md}` | Them, on structure | We store markdown blobs; their `AcceptanceCriterion` is properly structured with IDs, steps, and test types. |
| B: Code review rubric + static-analysis rules | **Quality** → Review loop (`QualitySection.jsx:166`) | **Us, on data quality; them, on structure** | Ours is real findings from real reviews. Theirs is a rubric definition. Complementary — their rubric could *grade* our findings. |
| B: Cost tracking | **Reliability** → Costs (`ReliabilitySection.jsx:308`), `/api/gov/costs` | **Us, decisively** | Theirs always reports $0.00. |
| B: Pass/fail eval gate | **Reliability** → Evals + CI gate, `.claude/harness-evals.json` `{name, prompt, expect}` | **Us, decisively** | We have a real runner, a real pass rate, and CI workflow generation. |
| B: Build-output validation | **NONE** (adjacent: Reliability → CI gate) | Split | Trivial file-existence checks; low value. |
| B: Error → recovery map | **Reliability** → Failures | Split | Ours is empirical (real tool error rates); theirs is a prescriptive taxonomy. |
| B: MCP compliance gate (server must be used) | **NONE** (adjacent: `McpSection.jsx`) | Them, as an idea | "Fail if the Memory server was never used" is checkable against our transcripts. |

---

## Recommended adoptions

Ranked by value ÷ effort. **[DATA]** = pure content port, no new architecture — cheapest and highest value.

### 1. **[DATA]** The 75-item freeze audit as a Governance tab — S

**Take:** the full table in §A above, verbatim, with stable IDs (`FA-001`…`FA-075`), my category assignments, an `appliesTo` tag (`generic` | `supabase` | `react` | `claude-code`), and the `READY TO FREEZE` / `READ-ONLY PLAN` verdict token.
**Lands in:** a new `Freeze audit` tab in `src/sections/GovernanceSection.jsx` (add label to the array at L14 + one `{tab === 'Freeze audit' && <FreezeAudit />}` line, component in the same file — house style). Data in a new `src/data/checklists/freeze-audit.js` (this creates the `src/data/` convention; we currently have none).
**Effort:** S. Rendering + filtering + per-project tick state. Persist done-state to `~/.claude/` via `track()` so it lands in Versions/Audit log.
**Unlocks:** our first real checklist surface, and the substrate for everything below.

### 2. **[DATA]** Auto-checkable subset — wire 8 items to real filesystem checks — M

**Take:** items #19–#23, #46, #47, #57 — the ones that are *machine-verifiable against a real checkout*, which is exactly our thesis. Check `.claude/agents/` non-empty · `.claude/hooks/pre_tool_use.py` exists · `.claude/settings.json` has `hooks` + `permissions.defaultMode` · `.claude/settings.local.json` in `.gitignore` · `.env.example` exists and its keys match `process.env` usage · `git status` clean.
**Lands in:** a new `/api/gov/freeze-audit?project=` endpoint in `server/index.mjs`, feeding the tab from #1 with `auto: pass|fail|n-a` beside manual ticks.
**Effort:** M.
**Unlocks:** the differentiator. Nobody else auto-attests a production-readiness checklist against a real repo. This is the feature that makes the port ours rather than a copy.

### 3. **[DATA]** Security tiers 0–3 + auto-escalation + 81 tier items — S/M

**Take:** the tier table, the inheritance map, the auto-escalation trigger lists, and all 81 tier-conditional audit items grouped by control (§3 Network Allowlist 3 · §4 Credentials 10 · §5 Action Tiers 4 · §6 Audit Logging 4 · §7 Supply Chain 4 · §8 Session 4 · §9 Agent Security 6 · §10 Canary 2 · §12 Plugin/Skill 44).
**Lands in:** `src/data/checklists/security-tiers.js` + a `Security tier` tab in Governance (or a sub-tab of #1). A short tier-picker (4 radio options + auto-escalation questions) that filters which items render.
**Effort:** S for the data, M with the picker.
**Unlocks:** per-project risk classification — a genuinely new axis for us, and it makes the 75-item list adaptive rather than one-size-fits-all.

### 4. **[DATA]** Three new entries in `HOOK_LIBRARY` — S

**Take:** (a) `protect-governing-docs` — PreToolUse on `Edit|Write`, blocks writes to `CLAUDE.md`/`prd.md`/`AGENTS.md`, parameterised on the filename list; (b) `phase-gate-precompact` — PreCompact, re-injects phase-gate + re-read-`STATE.md` reminders (we have **zero** PreCompact entries today); (c) `supply-chain-install-warn` — PreToolUse on Bash, warns on installs of packages not in an approved list. Port (a) and (c) to Node, not Python, so they work without a Python dependency; rewrite their `rm -rf` check properly if we add one at all (our `git-guardrails-claude-code` skill is already better).
**Lands in:** `HOOK_LIBRARY` at `server/index.mjs:3669-3682`. Zero new architecture — the install/dedupe/`propose()`/`track()` path already exists.
**Effort:** S.
**Unlocks:** library goes 5 → 8 entries and covers a new event.

### 5. **[DATA]** Skill security content audit as a real scanner — M

**Take:** the 6 scan patterns from `security-framework.md:516-522` (expose credentials · bypass governance · transmit to undeclared endpoints · suppress logging · grant excessive tool access · conflict with security tier), plus the "internally authored skills are not exempt" rule.
**Lands in:** new `/api/security/skill-audit` in `server/index.mjs` scanning `~/.claude/skills/**/*.md` and project `.claude/skills/`, surfaced as a tab in **Quality** (`QualitySection.jsx` L26) — findings render with the same shape as the existing `Reviews()` findings list, so the UI is nearly free.
**Effort:** M.
**Unlocks:** a security feature nobody else in this space has, perfectly aligned with local-first/zero-telemetry — we scan skills on disk, nothing leaves the machine.

### 6. **[DATA]** Structured acceptance criteria in Ticket — M

**Take:** repo B's `AcceptanceCriterion` schema (`core/models.py:330-360`) — IDs, `test_steps[]`, `test_type` ∈ `FUNCTIONAL|PERFORMANCE|SECURITY|INTEGRATION|ACCEPTANCE`, `validation_method`, `priority`, `automated` — and the 4-bucket `AcceptanceCriteria` grouping.
**Lands in:** `src/sections/TicketSection.jsx` `CriteriaTab`, upgrading `META` at L406 from markdown-blob artifacts to structured items.
**Effort:** M — this converts blob storage to item storage and touches the generate/save/JIRA-comment paths.
**Unlocks:** tickable, filterable, exportable AC instead of a wall of markdown; and per-criterion status tracking.

### 7. **[DATA]** Code-review rubric to grade our existing findings — S/M

**Take:** repo B's 8-point checklist, the 5-rule static-analysis table, and the numeric gate (`>=80 & 0 security` → approved; `>=60 & <=2` → needs_revision; else rejected, with the stated penalty formula).
**Lands in:** `QualitySection.jsx` `Reviews()` (L166) as a computed score over findings we *already* parse. Rubric data in `src/data/rubrics/code-review.js`. Precedent for rendering: `src/sections/PromptQuality.jsx` `Dim` + `DIMENSIONS` at `server/promptcheck.mjs:18` — the only existing rubric structure in our repo.
**Effort:** S/M.
**Unlocks:** turns a findings list into a pass/fail gate, consistent with the Reliability CI gate.

### 8. Plugin/MCP validation checklist (44 items) — M

**Take:** the full 44-item checklist plus the 5-component-type risk gradient (skills → tools → hooks/scripts → commands).
**Lands in:** `src/sections/McpSection.jsx` or Capabilities, as a per-server checklist. Partially auto-fillable — we can already inventory what an MCP server exposes.
**Effort:** M. Lower priority than #1–#5 because it's long and much of it is manual attestation.

### 9. Missing hook events in the picker — S

**Take:** `PostToolUseFailure`, `PermissionRequest`, `SubagentStart` (skip `TeammateIdle`/`TaskCompleted` unless Agent Teams is confirmed).
**Lands in:** `EVENTS` at `src/sections/HooksSection.jsx:11`.
**Effort:** S. **Blocked on verification** against official Claude Code docs — do not copy on their word alone.

### 10. Defense-in-depth + framework-selection matrix as explainer content — S

**Take:** the 4-layer model and the 3×2 framework matrix.
**Lands in:** Governance overview copy or a diagram.
**Effort:** S. Low functional value, decent orientation value.

### Explicitly not recommended

- **Repo B's SDK-driving code.** Broken on multiple counts; our PlanGraph already models real execution better than their dead `if/elif`.
- **Repo B's cost tracker.** Stale 2024 pricing, always reports zero. Ours is real.
- **Any repo B v3 claim or metric.** Fabricated telemetry for a system that never ran.
- **Repo A's `rm -rf` blocking rule as written.** Two substring checks; our `git-guardrails-claude-code` skill is strictly better. Port the *idea* of governing-document protection, not that rule.
- **Repo A's Supabase/Discord/Railway-specific audit items** (~20 of 75) — tag them `appliesTo: supabase` and hide by default.

### Sequencing note

#1 → #2 → #3 is one coherent arc: render the checklist, auto-check what we can, then make it tier-adaptive. That arc alone is the highest-value work identified in this research, and it is mostly data entry. #4 is an independent S-effort quick win that can ship in parallel.

---

## Sources

**Primary — repo A** (cloned at `eb91e2a`, 2026-04-14):
- https://github.com/dlowenth/claude-code-build-framework
- `README.md` · `claude.md` (2472 lines; §20.5 hooks at 1746-2036, §20.6 permissions at 2038-2094, §21 freeze audit at 2293-2379, §24 versioning at 2453-2472)
- `security-framework.md` (605 lines; §1 tiers at 10-47, §4 credentials at 124-205, §5 action tiers at 208-240, §6 audit logging at 243-284, §12 plugin/skill security at 442-543)
- `kickoff-prompt-template.md` (369 lines) · `prd-template.md` (663 lines) · `LICENSE`
- `https://api.github.com/repos/dlowenth/claude-code-build-framework` (metadata via `gh api`)

**Primary — repo B** (cloned at `3804a9b`, 2025-11-17):
- https://github.com/krzemienski/claude-code-builder
- `pyproject.toml` · `README.md` · `CLAUDE.md` · `claude-code-builder-prd.md` · `.mcp.json` · `Makefile` · `validate_build.py` · `smoke_test_v2.py`
- `src/claude_code_builder_v2/` — `executor/phase_executor.py:94-109` (stage machine), `executor/build_orchestrator.py:192-228`, `core/enums.py`, `sdk/{client_manager,cost_tracker,hook_manager,tool_registry,progress_reporter}.py`, `builders/*.py`, `cli/main.py`
- `src/claude_code_builder/` — `core/{enums,models,context_manager,output_manager,config}.py`, `mcp/{checkpoints,orchestrator,mock_orchestrator}.py`, `agents/{spec_analyzer,task_generator,review_agent,code_generator}.py`, `cli/commands/*.py`
- `V3_PLAN.md` · `V3_EXECUTIVE_SUMMARY.md` · `V3_FEATURE_6_DYNAMIC_SKILL_GENERATION.md` (all aspirational)
- `https://api.github.com/repos/krzemienski/claude-code-builder`

**Orchestrated frameworks (context only, not read in depth):**
- https://github.com/obra/superpowers — Superpowers, Jesse Vincent / Prime Radiant
- https://github.com/gsd-build/get-shit-done — GSD, TACHES
- https://github.com/bmad-code-org/BMAD-METHOD — BMAD, BMad Code
- https://github.com/upstash/context7 — Context7 MCP
- https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design — Frontend Design
- https://github.com/anthropics/claude-agent-sdk-python — the SDK repo B depends on

**Secondary — framework comparisons** (used only for one-line characterizations of Superpowers/GSD/BMAD; star counts cited there are **unverified**):
- https://www.pulumi.com/blog/claude-code-orchestration-frameworks/
- https://defract.dev/blog/claude-code-skills-frameworks
- https://www.everydev.ai/p/blog-five-claude-code-frameworks-compared-when-to-use-each-when-to-use-none
- https://rexai.top/en/posts/ai-coding-frameworks-comparison-2026/

**Our repo** (mapped for the overlap analysis): `src/App.jsx:50-227` (section registry) · `src/sections/{Governance,Quality,Reliability,Hooks,Setup,Ticket,Board,Inbox}Section.jsx` · `src/sections/PlanGraph.jsx` + `src/lib/plan.js` · `src/company/{Constitution,Atoms}Section.jsx` · `server/index.mjs` (`SETTINGS_FILES` L328-350, `HOOK_LIBRARY` L3669-3682, `inboxItems()` L2708-2794, `BOARD_FILE` L4075) · `server/promptcheck.mjs:18` (`DIMENSIONS`) · `lib/eng-config.mjs:188-190` (`Company_Tools` flag)

**Note on external coverage:** no reviews, blog posts, forum threads, or writeups exist for repo A (8 stars) or repo B (24 stars). Searches returned only the GitHub pages and unrelated listicles. Neither project has third-party validation.

---

*Research conducted 2026-07-29. Both repos MIT-licensed; the user has stated permission from the authors to copy and adapt. Attribution should be preserved when porting checklist content — MIT requires the copyright notice be included with substantial portions.*
