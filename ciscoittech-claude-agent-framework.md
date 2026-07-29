# Claude Agent Framework

> Upstream research for Loush Dashboard. Researched 2026-07-29 against commit `0b58f69` (HEAD of `main`).
> Everything below is grounded in the actual file tree, not the README. Where the upstream project
> asserts a number I could not trace to a measurement, it is labelled **unverified**.

---

## Identity

| Field | Value |
|---|---|
| Repo URL | https://github.com/ciscoittech/claude-agent-framework |
| Author / org | `ciscoittech` (GitHub display name "Notorious CSV") |
| License (SPDX) | **NOASSERTION.** GitHub's API returns `license: null`. There is **no `LICENSE` file** anywhere in the tree. The README's final section asserts MIT ("MIT License - Use freely in your projects, commercial or otherwise.") but that string is the *only* licensing artifact in the repo. |
| Stars / forks | 19 stars, 7 forks, 0 open issues |
| Created | 2025-09-23 |
| Last code push | 2026-03-12 (`0b58f69`, "feat: Align skills with Claude Code native format") |
| Repo metadata touched | 2026-07-21 |
| Total commits | 38 |
| Activity | Two bursts (Oct 2025 v1, Mar 2026 v2.0), then dormant. ~4.5 months since last code change. |
| Repo size | 941 KB |
| GitHub "language" | Python — but only because the observability tooling is the sole executable code. The framework itself is Markdown. |
| Install method | **None.** No installer, no package, no CLI, no `npm`/`pip` artifact. You clone the repo next to your project and paste a prompt into Claude Code asking it to read `SYSTEM_GENERATOR_PROMPT.md`. |
| Platforms | Any platform running Claude Code. The optional observability layer requires Python 3 + `sqlite3`; hook scripts are `.sh` and `.py`, so the optional layer is POSIX-leaning (`format_code.sh`, `run_tests.sh`, `notify_team.sh`). |

### Legal note for us

We have the author's permission to copy code, which resolves our practical position. But be aware
the repo is **not actually licensed** — the README text is not a license grant in file form, and
GitHub does not recognise it. If we vendor anything, we should record the author's permission in our
own repo (e.g. a note in the ported file header), because someone auditing us later will find
NOASSERTION upstream.

---

## The problem it solves

The README frames four pains, all real:

1. **Setup cost.** Getting Claude Code productive on a new repo means hand-writing `CLAUDE.md`,
   subagents, and slash commands — hours of context authoring per project.
2. **Sequential execution.** Independent subtasks get run one after another when they could fan out.
3. **Context bloat.** Every auto-loaded byte is paid for on every single turn, forever.
4. **Prompt repetition.** The same "review this for security" instruction retyped daily.

The framework's answer is a **split-tier context architecture**: a deliberately tiny always-loaded
`.claude/` directory, and a much larger `.claude-library/` that is *only* read on demand, indexed by
a `REGISTRY.json` manifest. That architectural idea is the genuinely good part of this project and it
is independent of the marketing numbers.

---

## Value proposition

- **One prompt, one agent team.** Paste a generator prompt; Claude analyses your repo and writes a
  bespoke agent system into it.
- **Always-on context stays small.** Agent bodies live outside the auto-load path.
- **Parallel by default** for independent work, sequential for dependent chains.
- **Simplicity circuit breakers** — an explicit, unusually honest anti-over-engineering rubric that
  tells the generator *not* to create agents you haven't earned. This is the most intellectually
  serious document in the repo.
- **Optional, local-first observability** — SQLite, no cloud, disabled by default.

That last bullet is notable: their observability design philosophy matches ours almost exactly
("Zero cloud dependencies", per `README.md`).

---

## The performance claims

### What is claimed

`README.md` "Performance Metrics" table:

| Metric | Traditional | Framework | Improvement |
|---|---|---|---|
| Setup Time | 2+ hours | 2 minutes | 60x faster |
| Context Size | 250KB+ | <10KB | 97% smaller |
| Execution | Sequential | Parallel | 3-6x faster |
| Learning Curve | Days | Minutes | Instant |

### Where the numbers actually come from

I grepped the entire tree for `97%`, `3-6x`, `250KB`, `10KB`, and `benchmark`. Findings:

**The "97% context reduction" has no measurement behind it anywhere in the repo.**
- There is no benchmark script, no measurement harness, no recorded before/after.
- The only supporting artifact is `AGENT_PATTERNS.md:915`, a "Context Loading Performance" table
  giving `Full Load 5s / 250KB` vs `Lazy Load 0.5s / 10KB`. It is a bare table with no methodology,
  no sample, no hardware, no date.
- **The arithmetic does not even close.** 10KB against a 250KB baseline is a 96.0% reduction, not
  97%. To land on 97% the baseline must be ~333KB or the target ~7.5KB. The number is a rounded
  marketing figure, not a computed one.
- The "250KB baseline" is an *assumed strawman*: it represents a hypothetical user who dumped their
  whole codebase into auto-loaded context. No such baseline was measured from a real install.
- What *is* concretely checked is a target, not a result: `context-engineering.md:274` states the
  framework's own auto-loaded context is "currently 8KB". That is a self-reported byte count of
  their own `.claude/` folder — a real number, but it measures one repo's config, and it is compared
  against nothing.

**The "3-6x faster execution" is arithmetic, not measurement.**
`AGENT_PATTERNS.md:688` "Performance Benchmarks":

| Workflow | Sequential | Parallel | Claimed |
|---|---|---|---|
| 3-Agent Analysis | 90s | 30s | 3x |
| 5-Agent Review | 150s | 35s | 4.3x |
| 10-Agent Debug | 300s | 45s | 6.7x |
| TDD Cycle | 180s | 75s | 2.4x |

Look at the "Sequential" column: 90 = 3×30, 150 = 5×30, 300 = 10×30. **Every sequential baseline is
the agent count multiplied by a constant 30 seconds.** It was not timed; it was derived by assuming
each agent takes exactly 30s and that sequential cost is perfectly additive. The parallel column
(30/35/45) is the only column that could plausibly be observation, and even it shows suspiciously
round numbers. `CLAUDE_AGENT_FRAMEWORK.md:406` repeats the same table with the same 30s constant.

**`TEST_RESULTS.md` is not a framework benchmark.** It reports "100% PASS RATE (13/13 tests)" — but
reading `test_observability.py`, these are CRUD tests against the SQLite observability schema using
fabricated fixtures (a fake agent with "Tokens: 700", "Cost: $0.012"). It proves inserts and selects
work. It says nothing about context size or execution speed.

### Reproducibility verdict

**Not reproducible. No methodology is published, no harness exists, and the sequential baseline is
synthetic.** The directional claims are plausible — a lazy-loaded manifest genuinely does shrink
always-on context, and independent fan-out genuinely does cut wall-clock — but the specific figures
97% and 3-6x are **unverified marketing numbers** and should not be repeated by us as fact.

### Independent verification

I searched for the exact phrases and for reviews of this specific repo. **No independent verification
exists.** Every search result was one of:
- The repo's own GitHub page or its description string echoed back;
- Aggregators mirroring the README (glama.ai, topic listings);
- **Unrelated projects making structurally identical claims** — e.g. `mksglu/context-mode` claims
  "98% reduction", `airis-mcp-gateway` claims "97%", `Madhan230205/token-reducer` claims "90%+".
  "~97% context reduction" is a genre trope in the Claude Code tooling ecosystem, not a finding.

The nearest thing to a credible adjacent measurement is Anthropic's own multi-agent research writeup,
and note what it actually measured: a multi-agent system *outperformed* single-agent on a research
eval, while **consuming ~15x more tokens than chat**. Anthropic's framing is that multi-agent buys
latency and breadth *at a token cost*. The upstream repo's table shows only the upside and never
mentions that parallel fan-out multiplies token spend. That omission is the single most misleading
thing in their README.

### Can WE compute a real equivalent? Yes — and better

This is the actionable part. We already read `~/.claude/projects/**/*.jsonl`, which contains ground
truth that the upstream project never had access to.

**Metric A — real always-on context cost (honest "context reduction").**
We do not need their strawman baseline. We can measure the *actual* auto-loaded footprint per
install and express reduction against a defensible denominator.

- Numerator (always-on): byte/token count of everything Claude Code auto-loads — `CLAUDE.md` at user
  + project + subdirectory scope, plus the `name`/`description` frontmatter of every installed
  skill/agent/command (which sits in the system prompt whether or not it ever fires).
- Denominator (if-everything-were-inlined): full body token count of every installed capability.
- **We already compute both.** `src/sections/CapabilityLedger.jsx` has `alwaysOnTokens` and
  `fullTokens` columns per capability. Reduction % = `1 - Σ(alwaysOn) / Σ(full)`. That is a real,
  per-user, defensible version of their 97% claim, and it drops into CapabilityLedger as one derived
  stat with no new data plumbing.
- Cross-check from transcripts: the **first assistant message of each session** carries
  `message.usage.input_tokens + message.usage.cache_creation_input_tokens`, which is essentially the
  system prompt + auto-loaded context. Trend that per project over time and a config change's effect
  on baseline context becomes directly observable.

**Metric B — real parallel speedup (honest "3-6x").**
The genuinely measurable quantity is **parallel efficiency**: `Σ(child agent wall-clock durations) /
(wall-clock span of the fan-out)`. A perfectly sequential run scores 1.0; three agents that truly
overlap score ~3.0. This is the number their table *claims* to report and never measured.

Procedure over our JSONL:
1. Find assistant messages whose `message.content[]` contains **two or more** `tool_use` blocks with
   `name === 'Task'` (or `'Agent'`). Same message ⇒ the harness dispatched them together ⇒ genuine
   fan-out. We already detect exactly this shape at `server/index.mjs:898` and `:1039`.
2. For each such `tool_use`, take its `id`. Its start is that event's `timestamp`.
3. Its end is the `timestamp` of the `user` event whose `message.content[]` holds a `tool_result`
   with matching `tool_use_id`. We already maintain this open/close map at `server/index.mjs:1270-1271`.
4. Child duration = end − start. Span = `max(end) − min(start)` across the batch.
5. Efficiency = `Σ(durations) / span`. Aggregate the distribution across all fan-outs.

**Transcript fields required** (all present, most already parsed by us):

| Field | Purpose | Already parsed at |
|---|---|---|
| `type` (`assistant` / `user` / `system`) | event classification | `index.mjs:1267`, `:1841` |
| `timestamp` | all duration math | `index.mjs:680`, `:1920` |
| `uuid` / `parentUuid` | causal chain, sidechain stitching | — (would need adding) |
| `isSidechain` | separate subagent transcripts from the main thread | — (would need adding) |
| `message.id` | groups `tool_use` blocks emitted in one assistant turn ⇒ fan-out detection | — (would need adding) |
| `message.model` | per-model cost/latency attribution | `index.mjs:676` |
| `message.usage.input_tokens` | context baseline, cost | ✅ |
| `message.usage.output_tokens` | cost | ✅ |
| `message.usage.cache_read_input_tokens` | true incremental cost vs cached | ✅ |
| `message.usage.cache_creation_input_tokens` | first-turn context footprint | ✅ |
| `message.content[].type === 'tool_use'` + `.id` + `.name` | Task detection, tool spans | `index.mjs:679`, `:898` |
| `message.content[].input.subagent_type` | which agent ran | `index.mjs:1039`, `:2379` |
| `message.content[].tool_use_id` (on `tool_result`) | close the span | `index.mjs:1271` |
| `toolUseResult.structuredPatch` | artifact/diff attribution | `index.mjs:694` |

The gap is small: we need `message.id`, `uuid`/`parentUuid`, and `isSidechain` added to the walker.
Everything else is already flowing.

**The honest headline we could ship:** "your last 30 days: median parallel efficiency 2.1x across 47
fan-outs; always-on context 14.2KB of a possible 310KB (95.4% deferred)." Measured, per-user,
falsifiable. That is a strictly better product than the upstream claim.

---

## Feature inventory

| Feature | What it does | Where in the code (file/dir) | Depends on |
|---|---|---|---|
| Split-tier context architecture | Tiny auto-loaded `.claude/`; bulky agent bodies in `.claude-library/` read on demand | `CLAUDE_AGENT_FRAMEWORK.md:53-110`, tree layout | Claude Code auto-load semantics |
| `REGISTRY.json` manifest | Central index of agents/commands/contexts/skills with paths, tools, triggers, priorities | `.claude-library/REGISTRY.json` (16.4KB, 421 lines) | Read by coordinator prompt at runtime |
| Agent definitions (12) | Long-form Markdown role prompts (13-28KB each) | `.claude-library/agents/{core,specialized,observability}/*.md` | REGISTRY.json for metadata |
| Slash commands (9) | Markdown workflow definitions invoked as `/name` | `.claude/commands/*.md` | Claude Code native command loading |
| Stack-detection generator | Prose instructions telling Claude how to inspect a repo and emit a tailored system | `SYSTEM_GENERATOR_PROMPT.md` (17.9KB) | Human paste + Claude reasoning |
| Simplicity circuit breakers | Complexity scoring + escalation thresholds that suppress over-generation | `SIMPLICITY_ENFORCEMENT.md` (7KB) | Generator reads it first |
| Agent routing table | Task keyword → agent type → model (haiku/sonnet/opus) | `.claude/commands/launch-agent.md:29-45` | — |
| Parallel execution guidance | "Send all Tasks in ONE message"; when to parallelise vs serialise | `CLAUDE_AGENT_FRAMEWORK.md:385-425`, `AGENT_PATTERNS.md:553-728` | Claude Code Task tool |
| Local observability (SQLite) | Records executions, sub-agents, artifacts, tool usage; 6 reporting views | `.claude-library/observability/schema.sql` (13KB) | Python 3, sqlite3, Claude Code hooks |
| Observability DB helper | ~28-function CRUD/query API over the schema | `.claude-library/observability/db_helper.py` (17.5KB) | schema.sql |
| Observability CLI | `recent`, `failed`, `summary`, `agents`, `tools`, `tool-stats`, `tool-efficiency`, `cleanup` | `.claude-library/observability/obs.py` (14.6KB) | db_helper.py |
| Expectation validation | Regex task pattern → expected agents/files/artifacts/limits → violations + 0-100 score | `.claude-library/observability/scripts/validate_execution.py` | `task_expectations` table |
| Hook wiring | Declarative hook manifest binding scripts to SessionStart/PreToolUse/PostToolUse with tool filters | `.claude-library/observability/configs/local-observability.json` | Claude Code hooks |
| Hook bundles (4) | Preset hook configs: code-quality, security, notifications, performance | `.claude-library/hooks/configs/*.json` | Claude Code hooks |
| Hook scripts | Format, test, security-scan, notify, timing | `.claude-library/hooks/scripts/*.{sh,py}` | POSIX shell / Python |
| Cloud observability (alt) | Logfire integration as an alternative backend | `.claude-library/observability/logfire_helper.py` | Logfire account |
| Best-practice ingestion loop | `/ingest-best-practice <URL>` → gap analysis → `/validate-framework` → APPROVED/REVIEW/REJECTED | `.claude/commands/{ingest-best-practice,validate-framework}.md` | WebFetch |
| Self-improvement meta-loop | Framework uses its own agents to build framework features | `.claude/commands/self-improve.md` (20.7KB), `framework-feature-builder.md` | All of the above |
| Multi-model routing | Cost/effort guidance for haiku vs sonnet vs opus | `MULTI_MODEL_ROUTING.md` (12.3KB) | — |
| Structure self-test | Asserts file counts, registry sections, doc line ranges | `test_v2_structure.py` | — |

---

## On-disk artifact shape

### Directory layout actually present in the repo

```
<project>/
├── .claude/                              # intended to be the only auto-loaded tier
│   └── commands/                         # 9 files, 2.6KB–20.7KB each
│       ├── audit-practices.md   build-feature.md   generate-docs.md
│       ├── ingest-best-practice.md   launch-agent.md   review-code.md
│       └── self-improve.md   update-docs.md   validate-framework.md
│
├── .claude-library/                      # on-demand tier, never auto-loaded
│   ├── REGISTRY.json                     # 16.4KB manifest — the spine
│   ├── agents/
│   │   ├── core/                         # 3 agents, 23–28KB each
│   │   ├── specialized/                  # 7 agents, 13–26KB each
│   │   └── observability/observer.md
│   ├── contexts/                         # 7 shared knowledge docs
│   │   └── anthropic-best-practices/
│   ├── patterns/                         # 5 per-role tool-usage guides
│   ├── hooks/{configs,patterns,scripts}/
│   └── observability/{configs,patterns,scripts}/ + schema.sql + *.py
│
└── .claude-metrics/                      # runtime, gitignored
    ├── observability.db                  # SQLite
    └── hooks.log
```

### Frontmatter schema — the important surprise

**The agent files have no YAML frontmatter at all.** Every one begins with a plain `#` heading. I
checked all 11:

```markdown
# Framework System Architect

**Role**: System architect and design specialist
**Type**: Core Agent
**Domain**: Architecture & System Design
**Purpose**: Design framework architecture, system patterns, and component structures

---

## Mission
...
```

That is *pseudo*-frontmatter: bold key-value lines in the body, parseable only by an LLM reading
prose. All machine-readable metadata is externalised into `REGISTRY.json` instead.

**Consequence: these are not Claude Code native subagents.** Native subagents live in
`.claude/agents/*.md` and require real YAML frontmatter (`name`, `description`, `tools`). This repo
has no `.claude/agents/` directory at all. Its "agents" are prompt documents that a coordinator
`Read`s and pastes into a `Task` call. That is a meaningfully weaker integration than the README
implies, and it matters for us: **their agent files are not drop-in compatible with our
CapabilityLedger's agent scanning**, which expects native frontmatter.

### `REGISTRY.json` schema (v2.0.0)

Top-level keys: `version`, `framework`, `description`, `created`, `settings`, `agent_defaults`,
`agents`, `commands`, `contexts`, `skills`.

```jsonc
{
  "version": "2.0.0",
  "settings": {
    "auto_load_agents": false,
    "max_parallel_agents": 5,
    "cache_loaded_agents": true,
    "observability": {
      "enabled": true, "provider": "logfire",
      "config": { "validate_outputs": true, "auto_spawn_observer": false,
                  "track_context_size": true, "track_tool_usage": true }
    },
    "hooks": {
      "enabled": false, "scope": "project", "configs": [],
      "allow_blocking": true, "timeout_ms": 5000,
      "log_file": ".claude-metrics/hooks.log",
      "fail_on_timeout": false, "parallel_hook_execution": false
    }
  },
  "agent_defaults": {
    "tool_guidelines": {
      "prefer_dedicated_tools": "Use Read/Edit/Write/Grep/Glob over Bash equivalents",
      "edit_over_write": "Prefer Edit for existing files, Write only for new files",
      "grep_before_read": "Use Grep to find locations, then Read specific sections"
    },
    "token_limits": { "read_default": "2000 lines", "grep_default": "20 matches",
                      "glob_default": "100 files" }
  },
  "agents": {
    "framework-system-architect": {
      "path": ".claude-library/agents/core/framework-system-architect.md",
      "type": "core",                        // core | specialized | observability
      "domain": "architecture",
      "tools": ["Grep","Glob","Read","Write","Edit","Task"],
      "triggers": ["design","architecture","system","structure","pattern"],
      "contexts": ["framework-architecture.md","framework-development-patterns.md"],
      "priority": 1,
      "specialization": "Framework architecture and system design"
    }
  },
  "commands": {
    "pattern": {
      "path": ".claude/commands/pattern.md",
      "description": "...",
      "agents": ["framework-system-architect","framework-senior-engineer"],
      "workflow": "parallel-sequential"      // the orchestration shape
    }
  },
  "contexts": {
    "framework-architecture": {
      "path": "...", "type": "core", "domain": "architecture", "description": "..."
    }
  },
  "skills": {
    "launch-agent": { "path": ".claude/commands/launch-agent.md",
                      "format": "native", "description": "..." }
  }
}
```

### Registry integrity: broken

I resolved every `path` in the registry against the filesystem. **8 of 36 are dangling:**

```
agents/example-generator              -> .claude-library/agents/specialized/example-generator.md
commands/pattern                      -> .claude/commands/pattern.md
commands/validate                     -> .claude/commands/validate.md
commands/example                      -> .claude/commands/example.md
commands/test-framework               -> .claude/commands/test-framework.md
contexts/framework-architecture       -> .claude-library/contexts/framework-architecture.md
contexts/framework-development-patterns -> .claude-library/contexts/framework-development-patterns.md
contexts/performance-optimization     -> .claude-library/contexts/performance-optimization.md
```

Their own `test_v2_structure.py` checks that registry *sections* exist and that doc line counts fall
in ranges — it never resolves a single path. This is a concrete, easy feature for us: **registry/
manifest path resolution is exactly the kind of check our Governance section should run.**

### Observability SQLite schema

7 tables + 6 views + 1 trigger, in `.claude-library/observability/schema.sql`:

- `sessions` — `session_id`, `project_path`, `git_branch`, `git_commit`, rollup totals
- `executions` — `agent_name`, `task_description`, `parent_execution_id` (self-FK ⇒ hierarchy),
  `duration_ms`, `status CHECK(running|success|failed|timeout|cancelled)`, `error_message`
- `execution_metrics` — `tokens_input`, `tokens_output`, `tokens_cached`,
  `tokens_total GENERATED ALWAYS AS (tokens_input + tokens_output) STORED`, `cost_usd`
- `artifacts` — `artifact_type CHECK(file_created|file_modified|file_deleted|command_run|test_run|output)`,
  `artifact_path`, `artifact_size_bytes`, `artifact_hash`
- `task_expectations` — `task_pattern` (regex), `expected_agents` (JSON), `expected_files` (JSON),
  `required_artifacts` (JSON), `max_duration_ms`, `max_tokens`, `max_cost_usd`, `enabled`
- `validations` — `passed`, `violations` (JSON array of `{type, expected, actual}`), `score` 0-100
- `sub_agents` — `parent_execution_id`, `agent_name`, `agent_type`, `sequence_order`
- `tool_usage` — `tool_name`, `parameters_json`, `success`, `duration_ms`, `tokens_used`,
  `output_size_bytes`
- Views: `v_recent_executions`, `v_failed_executions`, `v_daily_summary`, `v_agent_performance`,
  `v_tool_stats`, `v_tool_efficiency`

---

## The stack-detection generator

**This is the headline feature and it is entirely prose.** `SYSTEM_GENERATOR_PROMPT.md` contains no
executable code — it is a ~350-line instruction block a human pastes into Claude Code. "Detection"
means Claude reading files and reasoning. There is no parser, no heuristic engine, no scoring code.

That said, **the rubric it encodes is genuinely good and is trivially portable to deterministic JS.**
This is the most valuable thing in the repo for us.

### Phase 0 — file-based stack detection (`SYSTEM_GENERATOR_PROMPT.md:35-61`)

Priority read order, which doubles as a detection cascade:
1. `CLAUDE.md` or `.claude/CLAUDE.md`
2. `README.md`
3. `package.json` / `requirements.txt` / `go.mod` / `Cargo.toml`
4. `.env.example` and config files
5. Directory structure

Layers extracted: primary language, framework, database, test runner, build tool, deployment target.
Explicit instruction to ignore dev-only utilities that don't affect workflow.

### Directory → specialist mapping (`SYSTEM_GENERATOR_PROMPT.md:95-118`)

Pure path-pattern matching — **this is directly implementable as a JS lookup table:**

| Path signal | Implies |
|---|---|
| `components/`, `src/components/` | UI component agent |
| `pages/`, `app/` | routing specialist |
| `styles/` or CSS-in-JS | styling agent |
| `api/`, `routes/` | API architect |
| `models/`, `schemas/` | data modelling agent |
| `middleware/` | middleware specialist |
| `services/` | service layer agent |
| `migrations/` | migration specialist |
| `seeds/`, `fixtures/` | data seeding agent |
| `*.sql` files | SQL expert |
| `tests/`, `__tests__/` | test engineer |
| `*.spec.*`, `*.test.*` | TDD workflow |
| `e2e/`, `cypress/`, `playwright/` | E2E specialist |

Crucially guarded: "Detection alone does not justify creating a specialist."

### Complexity scoring (`SIMPLICITY_ENFORCEMENT.md:169-196`)

A 0-6 additive score across three axes:

```
Size:        <1K lines = 0 | 1K-10K = 1 | >10K = 2
Tech:        1 language = 0 | 2-3 = 1   | 4+  = 2
Integration: 0 external = 0 | 1-2  = 1  | 3+  = 2

0-1 -> MINIMAL (7 files)   2-3 -> BASIC (10 files)   4-6 -> FULL (15+ files)
```

### Escalation thresholds (`SIMPLICITY_ENFORCEMENT.md:199-225`, `SYSTEM_GENERATOR_PROMPT.md:243-253`)

Numeric gates before a specialist is allowed to exist:
- Database specialist: **>5 tables** with relationships (not simple CRUD)
- API specialist: **>10 endpoints**, or GraphQL/tRPC present
- Frontend specialist: **>20 components**, or complex state management
- Test specialist: **>40% coverage** or **>20 test files**
- Workflow orchestrator: **>5 parallel tasks**

Plus a hard budget: "Target <5KB total generation for simple projects", and three pre-flight
questions — is it actively used? can existing tools do it? is it merely nice-to-have? — any "no /
yes / yes" ⇒ don't create it.

**Why this is portable logic we want:** all of it reduces to file counts, glob matches, and manifest
parsing. None of it requires an LLM. We could run it deterministically in Express and *show the
user their score* — something upstream can only ask a model to guess at.

---

## UX and interaction design

- **Primary interaction is a copy-paste prompt.** No GUI, no CLI, no TUI. The README's stated flow is
  `claude` → paste a 3-line request → done.
- **Progressive-disclosure documentation.** A table in the README maps each doc to a "when to read"
  moment, and explicitly orders `SIMPLICITY_ENFORCEMENT.md` first.
- **Slash commands as the runtime surface.** `/build`, `/debug`, `/test`, `/deploy` in the pitch;
  `/launch-agent`, `/review-code`, `/generate-docs`, `/self-improve` in the actual repo.
- **Routing is a lookup table the model applies** (`launch-agent.md:29-45`): keyword → agent type →
  model, with a complexity override that upgrades to `opus` when a task mentions >5 files or
  multi-service work.
- **Reporting is a Python CLI** (`obs.py`) with subcommands and text tables — no visualisation.
- **Both optional subsystems ship disabled.** `hooks.enabled: false` by default; the README states
  "Both patterns disabled by default. Zero overhead when off."
- **Honesty about diminishing returns** appears inline: beyond 5-7 parallel agents, coordination
  overhead eats the gains, with a stated sweet spot of 3-5.

The overall UX cost: **nothing is inspectable.** A user cannot see their context size, their agent
inventory health, or whether a generated system drifted. That is precisely the gap our dashboard
fills.

---

## Architecture

```
                        ┌──────────────────────────────────────────────┐
   USER  ── prompt ────►│  Claude Code main thread (the coordinator)   │
                        └───────────────────┬──────────────────────────┘
                                            │
                 ┌──────────────────────────┼──────────────────────────┐
                 │ TIER 1: ALWAYS LOADED    │                          │
                 │  .claude/                │  target <10KB            │
                 │   ├── CLAUDE.md          │  (self-reported 8KB)     │
                 │   ├── settings.json      │                          │
                 │   └── commands/*.md      │                          │
                 └──────────────────────────┼──────────────────────────┘
                                            │ reads manifest on demand
                                            ▼
                        ┌──────────────────────────────────────────────┐
                        │   .claude-library/REGISTRY.json              │
                        │   agents{} commands{} contexts{} skills{}    │
                        │   settings.max_parallel_agents = 5           │
                        └───────────────────┬──────────────────────────┘
                     resolve path + tools + contexts per matched trigger
                                            │
                                            ▼
                        ┌──────────────────────────────────────────────┐
                        │  Read(.claude-library/agents/**/<name>.md)   │
                        │  13–28KB role prompt, loaded ONLY now        │
                        └───────────────────┬──────────────────────────┘
                                            │
             ══════════════ FAN-OUT: all Task calls in ONE message ══════════════
                                            │
        ┌───────────────┬───────────────────┼───────────────────┬───────────────┐
        ▼               ▼                   ▼                   ▼               ▼
   ┌─────────┐    ┌──────────┐        ┌──────────┐        ┌──────────┐   ┌──────────┐
   │architect│    │ engineer │        │ reviewer │        │researcher│   │  ...≤5   │
   │  opus   │    │  sonnet  │        │  sonnet  │        │  sonnet  │   │  haiku   │
   │ own ctx │    │ own ctx  │        │ own ctx  │        │ own ctx  │   │ own ctx  │
   └────┬────┘    └────┬─────┘        └────┬─────┘        └────┬─────┘   └────┬─────┘
        │              │                   │                   │              │
        │   each emits ≤10KB SUMMARY back (never raw output)   │              │
        └──────────────┴─────────┬─────────┴───────────────────┴──────────────┘
                                 ▼
                    ┌────────────────────────────┐
                    │ Coordinator synthesises    │──► sequential stage
                    │ (integration ~15s)         │    for DEPENDENT work
                    └─────────────┬──────────────┘
                                  │
        ══════════ OPTIONAL OBSERVABILITY PLANE (hooks, default off) ══════════
                                  │
   SessionStart ─► init_observability_db.sh ──────────┐
   PreToolUse  ─► observe_task_start.py   [Task]      │
   PostToolUse ─► observe_task_end.py     [Task]      ├──► .claude-metrics/
   PostToolUse ─► track_artifact.py [Write/Edit/Bash] │     observability.db
   PostToolUse ─► validate_execution.py   [Task]      │     (SQLite, local only)
                       │                              │
                       │ regex match task_description │
                       ▼                              │
              task_expectations ──► violations[] ──► score 0-100
                                                      │
                                        obs.py CLI ◄──┘  recent / failed / summary
                                                          agents / tool-efficiency
```

Two rules govern the fan-out:
1. **Batching is the mechanism.** Parallelism happens only if every `Task` block is emitted in a
   single assistant message. `CLAUDE_AGENT_FRAMEWORK.md:388-405` shows the wrong (awaited) and right
   (batched) forms side by side.
2. **Summaries, not payloads, cross the boundary.** `AGENT_PATTERNS.md:937` budgets previous-agent
   output at `<10KB` — "Summarize, don't pass raw output". This is the actual mechanism by which
   fan-out doesn't blow up the coordinator's context, and it's the part of the design worth keeping.

---

## Notable code worth stealing

| File path (upstream) | What it does | Why it's good | Port difficulty → React18 + Express ESM, no TS |
|---|---|---|---|
| `.claude-library/observability/schema.sql` | 7-table SQLite model for agent runs: executions w/ self-FK hierarchy, metrics, artifacts, expectations, validations, sub_agents, tool_usage + 6 rollup views | Clean, normalised, and the exact entity model our Runs/Insights sections already imply informally. `parent_execution_id` self-FK for agent trees and the `GENERATED ALWAYS AS` total column are both neat. `v_tool_efficiency` (tokens per *successful* call) is a metric we don't have and should. | **Medium.** We're file/JSONL-based, not SQLite. Port the *shape* (entities, the 6 view queries as JS reducers), not the DDL. The views translate almost 1:1 to `Array.prototype.reduce` aggregations over parsed transcript records. |
| `.claude-library/observability/scripts/validate_execution.py` | Expectation → violation → score. `calculate_score(total_checks, violations) = (passed/total)*100`, violations as `{type, expected, actual}` | Dead-simple, explainable scoring. Not a black box — every point lost names a rule. Fits our Governance evals model exactly. | **Easy.** ~120 lines of pure logic, no deps. Straight rewrite into `server/*.mjs`. |
| `task_expectations` table design (in `schema.sql:57-75`) | Regex `task_pattern` → `expected_agents[]`, `expected_files[]`, `required_artifacts[]`, `max_duration_ms`, `max_tokens`, `max_cost_usd` | A declarative contract language for "what should a run of this kind have done". We can evaluate it *retroactively over historical transcripts*, which upstream cannot — they only check live. This is a genuinely new capability for GovernanceSection. | **Easy.** It's a JSON schema + a matcher. Store as JSON, evaluate in Express. |
| `SIMPLICITY_ENFORCEMENT.md:169-196` | 0-6 complexity score across size/tech/integration axes with setup-size bands | Deterministic, no LLM needed, immediately explicable to a user. Turns "is my config over-built?" into a number. | **Easy.** File counting + `package.json` parsing we already do in `server/index.mjs` project scanning. |
| `SYSTEM_GENERATOR_PROMPT.md:95-118` | Directory-pattern → specialist mapping table | Pure glob→label lookup. Portable as a 13-row JS const. Powers a "you have `migrations/` but no DB-aware agent" recommendation. | **Easy.** Literal data table + `fast-glob`/`fs.readdir`. |
| `SIMPLICITY_ENFORCEMENT.md:199-225` | Numeric escalation gates (>5 tables, >10 endpoints, >20 components, >40% coverage, >5 parallel tasks) | Converts vague "should I add an agent?" into countable evidence. Pairs with the mapping table above to produce *justified* recommendations rather than generic ones. | **Easy.** Counting via existing repo scan + grep. |
| `.claude/commands/launch-agent.md:29-45` | Signal → agent-type → model routing table, with complexity override to `opus` on >5 files / multi-service | A compact, editable routing policy. Good default content for a generated command, and a good UI: show the table, let the user edit rows. | **Easy.** Data, not code. Ship as a JSON default + a table editor in CustomizeSection. |
| `.claude-library/observability/configs/local-observability.json` | Declarative hook manifest: `{event, script, blocking, timeout_ms, filters:{tools:[...]}}` | The `filters.tools` field is the good idea — declaring *which tools* a hook applies to, rather than filtering inside the script. Cleaner than raw `settings.json` hook config. | **Easy.** Our HooksSection already reads hook config; add filter-aware presentation + presets. |
| `.claude-library/hooks/configs/{code-quality,security,notifications,performance}.json` | Four ready-made hook bundles, 440-762 bytes each | Installable presets. Small enough to vendor wholesale as starter content for our Library. | **Easy.** Copy the JSON; rewrite the `.sh` scripts as cross-platform Node where we care about Windows. |
| `.claude-library/REGISTRY.json` → `agent_defaults.token_limits` | `read_default: 2000 lines`, `grep_default: 20 matches`, `glob_default: 100 files` | Explicit per-tool context budgets as *config*, not prose. Nice pattern for our Customize/TeamBaseline. | **Easy.** Config data. |
| `.claude-library/observability/obs.py` subcommand set | `recent / failed / summary / agents / session / tools / tool-stats / tool-efficiency` | A well-chosen inventory of the questions people actually ask about agent runs — useful as a checklist for what our Insights views should answer. | **Easy** (as design input, not code). Most already exist in our Runs/Insights. |

Nothing here needs TypeScript, and the only Python that matters (`validate_execution.py`,
`db_helper.py` query functions) is straightforward procedural code.

---

## Gaps and weaknesses

1. **Unsourced performance claims.** Covered above: 97% doesn't match its own baseline arithmetic
   (10/250 = 96%), and every "sequential" benchmark figure is `agents × 30s` rather than a timing.
2. **No license file.** GitHub reports NOASSERTION. README text only.
3. **Broken manifest.** 8 of 36 `REGISTRY.json` paths point at files that don't exist. The registry
   is the framework's central index, so a coordinator following it will `Read`-fail ~22% of the time.
4. **Their self-test doesn't test the thing that's broken.** `test_v2_structure.py` asserts doc line
   counts and section presence; it never resolves a path.
5. **Token metrics are silently dead.** `observe_task_end.py:32` does
   `usage = tool_result.get('usage', {})` — but Claude Code's PostToolUse hook payload for the `Task`
   tool does not carry token usage. So `tokens_input/output/cached` default to 0 and
   `insert_metrics` is skipped by the `if tokens_input or ...` guard. **The cost/token half of their
   observability almost certainly records nothing in real use** — which is also why they had to
   fabricate fixtures in `TEST_RESULTS.md`. Our transcript-based approach has no such problem.
6. **Agents are not native Claude Code subagents.** No YAML frontmatter, no `.claude/agents/`
   directory. The README advertises "Custom subagent types in `.claude/agents/`" as a v2.0 feature;
   the directory does not exist in the repo.
7. **`.claude-library/skills/` advertised, absent.** The README's tree shows it; the registry's
   `skills` entries just re-point at `.claude/commands/*.md`.
8. **The shipped agents are about the framework, not about you.** 10 of 12 are named
   `framework-*` — architect/engineer/reviewer *of the framework itself*. A user cloning this gets a
   meta-toolkit for editing the framework, plus a prompt that asks Claude to invent their real agents
   from scratch. Very little reusable domain content ships.
9. **Agent files are enormous.** 13-28KB each, 23KB average. The framework's own thesis is context
   minimalism; a single agent load is 2-3x the entire "always-on" budget it brags about.
10. **Windows support is incidental.** Hook scripts are `.sh`; observability needs Python 3.
11. **Low adoption, dormant.** 19 stars, 7 forks, 0 issues, no code change since 2026-03-12.
12. **Never mentions the token cost of parallelism.** Fan-out multiplies spend; Anthropic's own
    multi-agent writeup puts multi-agent at ~15x chat token usage. The README shows only upside.
13. **The generator is unversioned and non-deterministic.** Two runs on the same repo produce
    different systems. There is no lockfile, no diff, no regeneration path, and no drift detection.

---

## Overlap with Loush Dashboard

| Their feature | Our equivalent section (or NONE) | Who does it better | Note |
|---|---|---|---|
| `REGISTRY.json` capability manifest | **CapabilityLedger** + **Library** | **Us, decisively** | We derive the inventory from what's actually on disk and join it to real invocation counts from transcripts. Theirs is a hand-maintained JSON that is currently 22% wrong. |
| Always-on vs on-demand context accounting | **CapabilityLedger** (`alwaysOnTokens` / `fullTokens`) | **Us** | We already compute per-capability what they only assert in aggregate. We can produce the honest version of their headline number. |
| Agent definition files | **Library**, **Customize** | **Us** | We read native-frontmatter agents. Theirs aren't native, so importing them requires a conversion step. |
| Parallel orchestration model | **Flow / Workflows**, **PlanGraph** | **Mixed** | They have a written policy (batch in one message, ≤5 agents, summaries not payloads); we have the visualisation and the actual run data. Their policy is good content for our PlanGraph guidance; our data is the thing they lack. |
| Execution history / run records | **Runs**, **Sessions**, **ActivityTimeline** | **Us, decisively** | Theirs requires opt-in hooks that must be installed, and its token capture is broken. Ours reads transcripts that already exist, retroactively, with zero instrumentation. |
| Tool usage stats (`v_tool_stats`, `v_tool_efficiency`) | **Insights**, **Harness** (partial) | **Them, on metric design** | We have tool counts (`index.mjs:679`). We do **not** have per-tool success rate, avg output size, or tokens-per-successful-call. `v_tool_efficiency` is a metric worth copying outright. |
| Expectation validation + 0-100 score | **Governance** (evals, `/api/gov/evals`) | **Mixed** | We have an eval runner; they have a cleaner declarative contract (regex → expected agents/files/artifacts/limits) and an explainable additive score. Their model is better; our execution surface is better. |
| Hook configuration | **Hooks** (`/api/hooks`) | **Us**, but steal their presets | We have the UI; they have 4 ready-made bundles and the `filters.tools` declaration idea. |
| Stack detection / project analysis | **Setup**, **ProjectHub**, **Projects** | **Mixed** | They have a much more thought-through *rubric*; we have the actual filesystem access to execute it deterministically instead of asking a model. |
| Complexity scoring & over-engineering gates | **NONE** | **Them (we have nothing)** | Biggest genuine gap. Nothing in our dashboard tells a user their config is over-built for their repo. |
| One-prompt system generation | **Setup**, **Customize** (partial) | **Them, on ambition** | We configure an install; we don't bootstrap a bespoke agent team from a cold repo. |
| Config drift / regeneration | **Governance** (`/api/gov/drift`, baseline, rollback, versions) | **Us, decisively** | They have no drift concept at all — generate once and hope. |
| Multi-model cost routing | **Governance costs** (`/api/gov/costs`), **Insights** | **Mixed** | Their `launch-agent.md` routing table is good default policy content; our cost data is real. |
| Local-first, zero-telemetry stance | Whole product thesis | **Tie** | Genuinely aligned. Their SQLite-local observability is philosophically our sibling. |
| Best-practice ingestion loop | **NONE** | **Them (we have nothing)** | `/ingest-best-practice <URL>` → gap analysis → validate → APPROVED/REVIEW/REJECTED, with numeric thresholds (≥90% pass & ≥10% improvement to merge). Interesting but low priority. |
| Registry/manifest integrity checking | **NONE** | **Neither** — they need it and don't have it | Free win for us: we'd catch the exact bug their repo currently ships. |

---

## Recommended adoptions

Ranked by value-per-effort.

### 1. Ship the honest context-reduction metric — S
**Take:** the *idea* of a headline context number; reject their arithmetic.
**Lands in:** `src/sections/CapabilityLedger.jsx` (new summary stat), reusing existing
`alwaysOnTokens` / `fullTokens`.
**Effort:** S — the data is already computed; this is one derived stat and a tooltip.
**Unlocks:** a defensible, per-user version of the claim the whole upstream project is marketed on:
"14.2KB always-on of 310KB installed — 95.4% deferred." Because we show the denominator, it's
falsifiable, which is the entire differentiator. Pair it with a per-capability "this one is costing
you X tokens every session and has never fired" callout, which CapabilityLedger's `DEAD` verdict
already computes.

### 2. Parallel-efficiency measurement from transcripts — M
**Take:** the concept behind their 3-6x table, implemented properly.
**Lands in:** `server/index.mjs` transcript walker (add `message.id`, `uuid`/`parentUuid`,
`isSidechain` to the parsed record) → new metric surfaced in **Insights** and **Runs**, and as an
overlay on **PlanGraph**/**Flow**.
**Effort:** M — fan-out detection (≥2 `Task` `tool_use` blocks sharing one `message.id`) and span
closing via `tool_use_id` are both small additions to logic that already exists at
`server/index.mjs:898`, `:1039`, `:1270`.
**Unlocks:** the single most compelling number we could show — *measured* parallel efficiency, with
its distribution, plus the honest counterweight (token multiplier per fan-out) that upstream omits.
This directly answers "is my agent setup actually saving me time?", which nothing else on the market
answers with real data.

### 3. Declarative run expectations + explainable 0-100 score — M
**Take:** `task_expectations` schema + `validate_execution.py` scoring.
**Lands in:** **Governance** — extend `/api/gov/evals` with an expectations store; new UI in
`src/sections/GovernanceSection.jsx`.
**Effort:** M — JSON schema, a regex matcher, a violation reducer, and a table UI.
**Unlocks:** something upstream structurally cannot do — **retroactive** evaluation. Define "a
bugfix run should have invoked a reviewer and produced a test artifact", then score the last 90 days
of history against it. Their version only validates live runs going forward.

### 4. Deterministic complexity scoring + over-engineering audit — S/M
**Take:** `SIMPLICITY_ENFORCEMENT.md` 0-6 rubric, the directory→specialist mapping table, and the
numeric escalation gates.
**Lands in:** **Setup** / **ProjectHub** (score the repo) and **CapabilityLedger** (compare score to
installed capability count).
**Effort:** S for the scoring rubric alone; M with the mapping table and recommendations.
**Unlocks:** our first *prescriptive* feature. "This repo scores 2/6 — BASIC. You have 23 skills and
11 agents installed. 14 have never fired." That's a real, opinionated insight, and it's a gap where
we currently have literally nothing.

### 5. Registry / manifest integrity checking — S
**Take:** the check they conspicuously lack.
**Lands in:** **Governance** (alongside `/api/gov/drift`) and **Library**.
**Effort:** S — resolve every path referenced by any manifest, `settings.json` hook script,
or MCP config against the filesystem; report dangling entries.
**Unlocks:** catches a whole class of silent breakage — including the exact 8-path bug shipping in
upstream `main` today. Cheap, concrete, demoable.

### 6. Tool-efficiency metrics — S
**Take:** `v_tool_stats` and `v_tool_efficiency` (success rate, avg duration, avg output bytes,
**tokens per successful call**).
**Lands in:** **Insights**, **Harness**.
**Effort:** S — we already count `tool_use` by name at `server/index.mjs:679`; add success/failure
(we already detect `is_error` per `index.mjs:1817` comments) and output size.
**Unlocks:** "your Grep calls burn 4x the tokens per useful result that Read does" — actionable
prompt-engineering feedback, currently absent from our Insights.

### 7. Hook presets with tool filters — S
**Take:** the 4 bundles in `.claude-library/hooks/configs/*.json` plus the `filters.tools`
declaration pattern.
**Lands in:** **Hooks** (`src/sections/HooksSection.jsx`, `/api/hooks`), **Library** as installables.
**Effort:** S — vendor the JSON; rewrite the `.sh` scripts as cross-platform Node given our Windows
users.
**Unlocks:** one-click hook installation instead of hand-editing `settings.json`.

### 8. Agent routing policy table — S
**Take:** `launch-agent.md`'s signal→agent→model table and the complexity override rule.
**Lands in:** **Customize** / **TeamBaseline** as editable default policy.
**Effort:** S — it's data plus a table editor.
**Unlocks:** a concrete, editable cost/effort policy artifact; pairs naturally with our existing
cost data in `/api/gov/costs`.

### 9. Split-tier context architecture as guidance — S
**Take:** the `.claude/` vs `.claude-library/` pattern and the `<10KB` always-on budget.
**Lands in:** **Customize**, **TeamBaseline** as a recommendation, wired to the metric from #1.
**Effort:** S.
**Unlocks:** an actual remediation path once #1 tells a user their always-on context is bloated.

### 10. Best-practice ingestion loop — L (defer)
**Take:** `/ingest-best-practice` → gap analysis → validate → APPROVED/REVIEW/REJECTED with numeric
merge thresholds.
**Lands in:** **Library** / **Governance**.
**Effort:** L, and it needs network fetching that cuts against our zero-telemetry positioning.
**Unlocks:** self-updating best-practice content. Interesting, not urgent. Recommend deferring.

### Explicitly do NOT adopt

- **Their performance numbers.** Do not repeat "97%" or "3-6x" anywhere in our UI or docs. Compute
  our own or say nothing.
- **Their agent file format.** Non-native pseudo-frontmatter with metadata in a side manifest is
  strictly worse than Claude Code's YAML frontmatter, which we already read.
- **Their hook-based token capture.** It reads a `usage` field the Task-tool hook payload doesn't
  provide. Our transcript-based reading is correct and needs no instrumentation.
- **The 12 shipped agent definitions.** They're about maintaining their framework, not about
  building user software.

---

## Sources

**Primary (upstream repo, commit `0b58f69`, `main`, fetched 2026-07-29):**
- https://github.com/ciscoittech/claude-agent-framework — landing page & repo description
- `README.md` — performance metrics table, install flow, v2.0 feature list, MIT assertion
- `SYSTEM_GENERATOR_PROMPT.md` — stack detection phases, directory→specialist mapping, expected output
- `SIMPLICITY_ENFORCEMENT.md` — complexity scoring system, escalation thresholds, anti-patterns
- `CLAUDE_AGENT_FRAMEWORK.md` — architecture, parallel execution tables, context reduction strategies
- `AGENT_PATTERNS.md` — "Performance Benchmarks" (:688), "Context Loading Performance" (:915), context budgets (:937)
- `MULTI_MODEL_ROUTING.md`, `AGENT_SYSTEM_TEMPLATE.md`, `CHANGELOG.md`, `CLAUDE.md`
- `.claude-library/REGISTRY.json` — manifest schema (v2.0.0), settings, agent_defaults
- `.claude-library/agents/{core,specialized,observability}/*.md` — 11 agent definitions (no frontmatter)
- `.claude/commands/*.md` — 9 commands, incl. `launch-agent.md` routing table
- `.claude-library/observability/schema.sql` — 7 tables, 6 views, 1 trigger
- `.claude-library/observability/{db_helper.py,obs.py,logfire_helper.py,test_observability.py,TEST_RESULTS.md}`
- `.claude-library/observability/scripts/{observe_task_start.py,observe_task_end.py,track_artifact.py,validate_execution.py}`
- `.claude-library/observability/configs/local-observability.json` — hook manifest
- `.claude-library/hooks/{README.md,configs/*.json,scripts/*,patterns/*.md}`
- `.claude-library/contexts/anthropic-best-practices/context-engineering.md` — the 8KB self-report
- `test_v2_structure.py` — structural self-test
- GitHub REST API `repos/ciscoittech/claude-agent-framework` — stars/forks/license/dates
- `git log` over a local clone — 38 commits, activity windows

**Verification searches (all negative for independent support):**
- Exact-phrase search "97% context reduction" — returns only the repo, aggregator mirrors, and
  unrelated projects making similar claims (`mksglu/context-mode` "98% reduction",
  `Madhan230205/token-reducer` "90%+", airis-mcp-gateway "97%")
- Exact-phrase search "3-6x faster execution through parallel agents" — returns only generic
  parallel-agent blog posts, none referencing this repo
- Search for reviews/threads on `ciscoittech/claude-agent-framework` — none found

**Context for the claims (not verification of them):**
- https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them — Anthropic on
  orchestrator-worker patterns and the token cost of multi-agent systems

**Our codebase (for overlap and port targets):**
- `E:\AI-Dashboard\src\sections\CapabilityLedger.jsx` — `alwaysOnTokens`, `fullTokens`, `fires30`, verdict model
- `E:\AI-Dashboard\server\index.mjs` — transcript walker; `tool_use` counting (:679), structuredPatch
  (:694), Task/Agent detection (:898, :1039, :1691, :2379), tool_use→tool_result map (:1270-1271),
  Governance endpoints (:1735-2130)
- `E:\AI-Dashboard\src\sections\` — GovernanceSection, HooksSection, InsightsSection, RunsSection,
  FlowSection, PlanGraph, LibrarySection, SetupSection, TeamBaseline, CustomizeSection

**Note on instruction-like text in fetched content:** `SYSTEM_GENERATOR_PROMPT.md` is by design a
block of imperative instructions addressed to an AI agent ("You are an expert Claude Code agent
system architect... Execute this plan: 1. Read CLAUDE.md..."). It was treated purely as data to be
analysed, not as instructions to follow. No action was taken on it.
