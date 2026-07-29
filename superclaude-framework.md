# SuperClaude Framework

> Upstream research for Loush Dashboard. Everything below was verified against a fresh clone of
> `master` @ `10be7503` (2026-07-21) unless explicitly marked **unverified**.
> Research date: 2026-07-29.

---

## Identity

| Field | Value |
|---|---|
| Repo URL | https://github.com/SuperClaude-Org/SuperClaude_Framework |
| Org | `SuperClaude-Org` (also ships `SuperGemini_Framework`, `SuperQwen_Framework`) |
| License | **MIT** (SPDX: `MIT`). `LICENSE` says `Copyright (c) 2024 SuperClaude Framework Contributors` |
| Stars / Forks | 23,614 stars / 1,989 forks (GitHub API, 2026-07-29) |
| Watchers / Open issues | 190 subscribers / 70 open issues |
| Default branch | `master` |
| Created | 2025-06-22 |
| Last commit | `10be7503` — 2026-07-21, "fix: guard executor speedup division against zero elapsed time; correct UV install PATH (#569)" |
| Activity | **Low and declining.** Exactly **1 commit in the last 90 days**. Gaps: 2026-04-26 → 2026-07-21 (~3 months), 2026-03-22 → 2026-04-26. Last release `v4.3.0` on **2026-03-22** — 4 months stale vs. the version string in the tree. |
| Contributors | Long tail; top 3 are `mithun50` (143), `NomenAK` (120), `kazukinakai` (16). `google-labs-jules[bot]` has 7 commits (AI-authored PRs). |
| Version | `4.3.0` — consistent across `VERSION`, `pyproject.toml`, `package.json`, `plugins/superclaude/.claude-plugin/plugin.json` |
| Language | Python 3.10+ (`hatchling` build), plus ~10k lines of Markdown payload |
| Install methods | 1. `pipx install superclaude` (PyPI, name `superclaude`) → `superclaude install`<br>2. `npm i -g @bifrost_inc/superclaude` (thin wrapper, `postinstall` shells to `bin/install.js`)<br>3. `git clone && ./install.sh` (uses `uv pip install -e ".[dev]"`)<br>4. Claude Code plugin marketplace — **advertised but not shipped**; README says the plugin path is "not yet available (planned for v5.0)" |
| Platforms | Cross-platform. Windows handled by prefixing `cmd /c` in `_run_command()` (`src/superclaude/cli/install_mcp.py:120`). Extra `docs/getting-started/windows-installation.md`. |
| Homepage | https://superclaude.netlify.app/ |

**Adoption reality check.** npm `@bifrost_inc/superclaude`: **207 downloads in the last month**
(2026-06-25 → 2026-07-24, npm registry API). PyPI download counts: **unverified** — pypistats and
pepy both refused the request (429/401) during this research. 207 npm installs/month against 23.6k
stars is a ~114:1 star-to-install ratio on that channel; PyPI is the primary channel so this is not
the whole picture, but it is a signal.

---

## The problem it solves

Claude Code ships with generic defaults. A team that wants repeatable behaviour has to hand-write
its own `CLAUDE.md`, its own slash commands, its own subagent definitions, and figure out which MCP
servers are worth wiring up. That is genuinely weeks of fiddling, and most of it is not novel work —
everyone converges on roughly the same set (a security reviewer, an architect, a research agent, a
"brainstorm requirements before coding" mode).

SuperClaude is a **pre-baked opinionated default set**: 30 slash commands, 20 subagent personas,
7 "behavioural modes", 8 MCP server recipes, and a body of behavioural rules — installed with one
command. Its own framing: a *"meta-programming configuration framework"* that works *"through
behavioral instruction injection"* (README.md:86).

The secondary problem it attacks is **token cost of context**: several of its features
(`--token-efficient` mode, `/sc:index-repo`, the AIRIS gateway) exist purely to reduce how much of
the context window the framework itself (and the codebase) consumes.

---

## Value proposition

**What is genuinely valuable:**

1. **A curated default set, at zero marginal thought.** 20 agent files with a consistent
   Triggers / Mindset / Focus Areas / Key Actions / Outputs / **Boundaries (Will / Will Not)**
   template is a real artifact. The `Will Not` section in particular is good prompt engineering that
   most hand-rolled agents omit.
2. **The command frontmatter schema.** `mcp-servers: []` and `personas: []` in every command file is
   a *declared dependency graph* between commands, MCP servers, and agents. Nothing native in Claude
   Code records this. It is machine-readable and directly useful to a dashboard (see Adoptions).
3. **`docs/user-guide/claude-code-integration.md`.** An honest, current, self-critical map of every
   SuperClaude feature to its Claude Code extension point, *including its own gaps*
   ("This is a significant gap — many SuperClaude commands could be reimplemented as proper Claude
   Code skills"). Rare candour for a 23k-star repo.
4. **The reflexion/metrics JSONL schemas** (`docs/memory/WORKFLOW_METRICS_SCHEMA.md`,
   `docs/memory/reflexion.jsonl.example`). Well-specified, local-first, append-only, privacy-preserving
   by design. These are borrowable ideas independent of the framework.

**Where the 23k stars overstate it:**

1. **The star count does not match usage.** 207 npm installs/month (verified above). 1 commit in 90
   days. 70 open issues. The repo has the shape of something starred by many and run by few.
2. **The docs describe a product that no longer exists.** `docs/developer-guide/technical-architecture.md:111-135`
   and `docs/getting-started/installation.md:296` describe a `~/.claude/CLAUDE.md` with `@FLAGS.md`
   `@RULES.md` `@MODE_*.md` imports and *"~200KB"* of behavioural instruction files in `~/.claude/`.
   **The v4.3.0 installer writes none of that.** `install_commands.py` copies only `commands/*.md` and
   `agents/*.md`. `MODE_*.md`, `RULES.md`, `FLAGS.md`, `PRINCIPLES.md`, and the `MCP_*.md` docs are
   packaged but **never installed to `~/.claude`**. The "7 behavioural modes" headline number in the
   README does not correspond to anything the installer places on disk.
3. **The advertised install path does not work.** README:112 concedes the plugin system is "not yet
   available (planned for v5.0)". `PLUGIN_INSTALL.md` is untranslated Japanese and hardcodes a
   maintainer's personal path (`/Users/kazuki/github/superclaude/`).
4. **The self-reported metrics are unverifiable.** "94% token reduction (58K → 3K)" is a *frontmatter
   description string* in `commands/index-repo.md`, not a measurement. "98% token reduction" for the
   AIRIS gateway is a third-party marketing claim copied into a Python dict
   (`install_mcp.py:23`). "2-3x faster, 30-50% fewer tokens" (README:170) has no cited methodology.
   `QUALITY_COMPARISON.md` benchmarks the framework's own Python-vs-TypeScript port — not any effect
   on coding outcomes.

**The critical takes found in the wild:**

- **Stanislav Silin, Brightgrove (2026-04-21)** — the sharpest critique. He splits command output
  into "grounded" (toolchain-verifiable) vs "fantasy", and puts most of SuperClaude in the latter.
  On `spec-panel`: *"The spec is real, the reviewers are fiction. Fantasy."* On `reflect`:
  *"Self-grading, fantasy."* His general definition: *"Fantasy is output that looks fine, sounds
  fine, uses the right vocabulary"* with no connection to the real system. His structural argument is
  that SuperClaude concentrates effort exactly where LLMs are weakest — planning, orchestration,
  self-assessment.
  → This lands hard on `estimate`, `spec-panel`, `business-panel`, `reflect`, and arguably
  `confidence-check` (a model scoring its own readiness).
- **Steven Gonsalvez, DEV Community** — measured, not damning. *"Every instruction in your CLAUDE.md
  eats context window."* and *"the framework approach trades context efficiency for behavioural
  consistency."* He also raises the fit problem: *"it's designed for someone else's workflow."*
  He credits the star count as evidence it "hits the right defaults for a lot of people."
- **vibecodinghub review (2026)** — *"does not replace Claude Code, does not remove model costs, and
  does not excuse weak review habits."* Positions it as an opinionated workflow layer, not a product.
- **Hacker News** — essentially no discussion. HN Algolia returns 4 low-score submissions
  (6, 2, 2, 1 points, all 0 comments) and two passing critical comments. There is no HN consensus
  because there was no HN conversation. Notable given the star count.
- **Reddit r/ClaudeAI** — searched; no substantive SuperClaude-specific thread surfaced. **Unverified**
  whether one exists behind Reddit's search gating.

**Net read for us.** The philosophy is contestable and the maintenance is thin. But *its artifacts are
on real users' disks*, and a dashboard whose thesis is "observe and audit what's installed" must be
able to see them. The value to Loush is 80% "understand their artifacts", 20% "port their code".

---

## Feature inventory

| Feature | What it does | Where in the code (file/dir) | Depends on |
|---|---|---|---|
| `superclaude` CLI | Click group: `install`, `mcp`, `update`, `install-skill`, `doctor`, `version` | `src/superclaude/cli/main.py` (271 ln) | `click>=8`, `rich>=13` |
| Command installer | Copies `*.md` → `~/.claude/commands/sc/`, non-recursive, `shutil.copy2`, skip-unless-`--force` | `src/superclaude/cli/install_commands.py:12-89` | filesystem only |
| Agent installer | Copies `*.md` (minus `README.md`) → `~/.claude/agents/` **flat** | `src/superclaude/cli/install_commands.py:192-260` | filesystem only |
| Skill installer | `copytree` one named skill → `~/.claude/skills/<name>/` | `src/superclaude/cli/install_skill.py:12-56` | filesystem only |
| Source-dir resolution | Prefers `<pkg>/commands`, falls back to `plugins/superclaude/commands` for source checkouts | `install_commands.py:92-122`, `:165-189` | — |
| MCP installer | Shells out to `claude mcp add --transport … --scope … -- <cmd>`; 8-server registry; interactive numeric picker; prompts for API keys with `hide_input=True` | `src/superclaude/cli/install_mcp.py` (771 ln), registry at `:35-95` | `claude` CLI, Node ≥18, `uv` (Serena) |
| AIRIS MCP Gateway | Optional Docker-Compose gateway installed to `~/.superclaude/airis-mcp-gateway/`, SSE at `localhost:9400`, health-polled 6× | `install_mcp.py:165-425` | Docker, `curl` |
| SHA-256 pinning | `_verify_file_integrity()` for downloaded compose/config — **both pins are currently `None`, so verification is skipped** | `install_mcp.py:126-155`, pins at `:27,29` | `hashlib` |
| `doctor` | 3 health checks: pytest plugin loaded, skills present, package importable | `src/superclaude/cli/doctor.py` (147 ln) | pytest |
| 30 slash commands | Markdown prompt bodies with YAML frontmatter | `plugins/superclaude/commands/*.md`, mirrored at `src/superclaude/commands/*.md` | Claude Code command loader |
| 20 agent personas | Markdown subagent system prompts | `plugins/superclaude/agents/*.md`, mirrored at `src/superclaude/agents/*.md` | Claude Code subagent loader |
| 7 behavioural modes | Markdown mode descriptions — **never installed to `~/.claude`** | `plugins/superclaude/modes/MODE_*.md` | nothing; inert unless pasted |
| Core rule files | `RULES.md` (286 ln), `FLAGS.md` (132 ln), `PRINCIPLES.md` (60 ln), `RESEARCH_CONFIG.md` (445 ln), `BUSINESS_SYMBOLS.md`, `BUSINESS_PANEL_EXAMPLES.md` — **never installed** | `plugins/superclaude/core/*.md` | nothing |
| 6 skills | `SKILL.md` + optional `.ts` | `plugins/superclaude/skills/*/` | Claude Code skills loader |
| Hooks | `SessionStart` (command), `Stop` (prompt), `PostToolUse` on `Write\|Edit` (prompt) | `plugins/superclaude/hooks/hooks.json`, `src/superclaude/hooks/hooks.json` | plugin install only |
| Session-init script | Prints git status, token-budget reminder, "core services" banner | `plugins/superclaude/scripts/session-init.sh` | bash, git |
| pytest plugin | Auto-registered via `[project.entry-points.pytest11]`; fixtures `confidence_checker`, `self_check_protocol`, `reflexion_pattern`, `token_budget`, `pm_context`; auto-markers by directory | `src/superclaude/pytest_plugin.py`, `pyproject.toml:[project.entry-points.pytest11]` | pytest ≥7 |
| ConfidenceChecker | 5 weighted checks (25/25/20/15/15) → 0.0–1.0; ≥0.9 proceed / 0.7–0.89 offer options / <0.7 stop | `src/superclaude/pm_agent/confidence.py` (364 ln) | filesystem heuristics |
| SelfCheckProtocol | Post-implementation validation / hallucination red-flags | `src/superclaude/pm_agent/self_check.py` (249 ln) | — |
| ReflexionPattern | Error → known-solution lookup in `docs/memory/solutions_learned.jsonl`; falls back to grep; optional mindbase HTTP | `src/superclaude/pm_agent/reflexion.py` (383 ln) | local JSONL |
| TokenBudgetManager | `simple`/`medium`/`complex` → 200/1000/2500 token caps | `src/superclaude/pm_agent/token_budget.py` (85 ln) | — |
| ParallelExecutor | Dependency-graph → parallel groups → `ThreadPoolExecutor` | `src/superclaude/execution/parallel.py` (341 ln) | stdlib |
| ReflectionEngine / SelfCorrection | Post-hoc reflection + retry loop | `src/superclaude/execution/reflection.py` (400 ln), `self_correction.py` (426 ln) | — |
| Metrics analysis | Weekly aggregation + A/B significance test over `workflow_metrics.jsonl` | `scripts/analyze_workflow_metrics.py` (331 ln), `scripts/ab_test_workflows.py` (310 ln) | `scipy` (dev extra) |
| Plugin builder | Assembles `plugins/superclaude/` payload | `scripts/build_superclaude_plugin.py` (97 ln) | — |
| Framework sync | Syncs `src/` ↔ `plugins/` copies | `scripts/sync_from_framework.py` (959 ln) | — |
| Legacy cleanup | Removes `~/.claude/plugins/superclaude@superclaude`, `superclaude.json`, and the `enabledPlugins` entry from `settings.json`; backs up to `~/.claude-superclaude-backup-<ts>/` | `scripts/uninstall_legacy.sh` | python3, bash |
| Tests | 136 tests across `tests/unit/` + `tests/integration/` | `tests/` | pytest |

---

## On-disk artifact shape

**This is the section CapabilityLedger must implement against.**

### What v4.3.0 actually writes

There are three install channels and they land in different places. A user may have artifacts from
more than one.

#### Channel A — `superclaude install` (pip/pipx/npm; the documented default)

```
~/.claude/
├── commands/
│   └── sc/                       ← NOTE: a SUBDIRECTORY, not flat
│       ├── agent.md
│       ├── analyze.md
│       ├── brainstorm.md
│       ├── … (30 files total)
│       └── workflow.md
└── agents/                       ← flat, NOT namespaced
    ├── backend-architect.md
    ├── business-panel-experts.md
    ├── … (20 files total)
    └── technical-writer.md
```

- Commands target: `Path.home()/".claude"/"commands"/"sc"` (`install_commands.py:25`).
  Overridable with `--target`.
- Agents target: `Path.home()/".claude"/"agents"` (`install_commands.py:204`). **No namespace
  subdirectory** — the 20 agent files sit directly alongside the user's own agents. This is a real
  collision hazard and the single biggest attribution problem for any auditing tool.
- Copy is `shutil.copy2` (preserves mtime **from the wheel**, not install time — see Gotchas).
- Existing files are **skipped silently** unless `--force`.
- `README.md` is excluded from the agents copy but **not** from commands (commands filter `README`
  only in the *listing* helpers, `install_commands.py:139,159` — the copy loop at `:46` globs all
  `*.md`).

#### Channel B — `superclaude install-skill <name>`

```
~/.claude/skills/
└── <skill-name>/
    ├── SKILL.md
    └── confidence.ts            (confidence-check only)
```

`copytree` of the whole skill dir (`install_skill.py:52`). Available skills: `brainstorm`,
`confidence-check`, `deep-research`, `pm`, `token-efficiency`, `troubleshoot`. **Only installable one
at a time, by explicit name** — there is no "install all skills".

#### Channel C — Claude Code plugin (present in-tree, not yet published)

```
~/.claude/plugins/superclaude@superclaude/       (marketplace-managed)
├── .claude-plugin/plugin.json
├── .mcp.json
├── commands/*.md      agents/*.md     skills/*/SKILL.md
├── modes/MODE_*.md    core/*.md       mcp/MCP_*.md + mcp/configs/*.json
├── hooks/hooks.json   scripts/session-init.sh   examples/
```
plus `~/.claude/settings.json` gaining `"enabledPlugins": { "superclaude@superclaude": true }`.
Confirmed by what `scripts/uninstall_legacy.sh` cleans up.

#### Channel D — MCP servers

SuperClaude **never writes MCP config directly**. It shells out:

```
claude mcp add --transport stdio --scope user [-e KEY=VAL] <name> -- <cmd> <args...>
```
(`install_mcp.py:565-585`). Net effect on disk is whatever the Claude CLI does — i.e.
`~/.claude.json` `mcpServers` for `--scope user`, project `.mcp.json` for `--scope project`.
`--scope user` is the CLI default (`main.py:109`).

The `.json` files under `mcp/configs/` are **reference snippets that the installer never reads**:

```json
// src/superclaude/mcp/configs/tavily.json
{
  "tavily": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://mcp.tavily.com/mcp/?tavilyApiKey=${TAVILY_API_KEY}"],
    "env": { "TAVILY_API_KEY": "${TAVILY_API_KEY}" }
  }
}
```
Note the shape: **bare server object, no `mcpServers` wrapper.** Anything parsing these must not
assume the standard envelope.

AIRIS gateway additionally creates a directory *outside* `~/.claude` entirely:
```
~/.superclaude/airis-mcp-gateway/
├── docker-compose.yml
├── mcp-config.json
└── .env                  ← contains HOST_WORKSPACE_DIR, TAVILY_API_KEY (plaintext)
```

#### What it does **NOT** write (contradicting its own docs)

- **No `~/.claude/CLAUDE.md`.** No `@FLAGS.md` / `@RULES.md` / `@MODE_*.md` import block.
  `docs/developer-guide/technical-architecture.md:111-135` describes this; the v4.3.0 code does not
  do it. The v3 `setup/services/claude_md` that did was deleted (`DELETION_RATIONALE.md:30`).
- **No modes on disk.** `MODE_*.md` is packaged but has no install path outside the plugin channel.
- **No `~/.claude/*.md` flat behavioural files.** `docs/getting-started/installation.md:296` still
  claims `~/.claude/*.md` ≈ 200KB. Stale.
- **No hooks** via the pip channel. `hooks.json` is plugin-only.
- **No uninstall.** There is no `superclaude uninstall`. `scripts/uninstall_legacy.sh` only removes
  the *plugin* channel and two legacy JSON files — it does not touch `~/.claude/commands/sc/` or the
  20 files in `~/.claude/agents/`.

### Frontmatter schemas

**Agents** (all 20 identical, `plugins/superclaude/agents/*.md`):
```yaml
---
name: security-engineer
description: Identify security vulnerabilities and ensure compliance with security standards and best practices
category: quality
---
```
Exactly three keys. `category` ∈ {`engineering`, `quality`, `analysis`, `communication`,
`business`, `specialized`, `meta`, `discovery`} — a **SuperClaude extension**, not native Claude Code.
Notably **absent**: `tools`, `allowed-tools`, `model`, `effort`. Every SuperClaude agent therefore
inherits full default tool access.

Agent body template (stable across all 20 — this regularity is exploitable):
```markdown
# <Title>

> **Context Framework Note**: This agent persona is activated when Claude Code users type
> `@agent-<x>` patterns or when <domain> contexts are detected. …

## Triggers
## Behavioral Mindset
## Focus Areas
## Key Actions
## Outputs
## Boundaries
**Will:**  …
**Will Not:** …
```
Median agent length: **48 lines** (12 of 20 are exactly 48). Outliers: `pm-agent.md` 692 ln,
`socratic-mentor.md` 291 ln, `business-panel-experts.md` 247 ln, `deep-research-agent.md` 184 ln,
`self-review.md` 33 ln.

**Commands** (`plugins/superclaude/commands/*.md`):
```yaml
---
name: implement
description: "Feature and code implementation with intelligent persona activation and MCP integration"
category: workflow
complexity: standard
mcp-servers: [context7, sequential, magic, playwright]
personas: [architect, frontend, backend, security, qa-specialist]
---
```
Keys: `name`, `description`, `category`, `complexity`, `mcp-servers`, `personas`. All six are
SuperClaude extensions beyond Claude Code's native `description` / `argument-hint` / `allowed-tools`.
- `category` ∈ {`utility`, `workflow`, `orchestration`, `session`, `special`, `analysis`, `command`}
- `complexity` ∈ {`low`, `basic`, `standard`, `enhanced`, `advanced`, `high`, `meta`}
- `mcp-servers` / `personas` are **declared dependency edges** — the single most valuable machine-
  readable thing in the whole repo.
- **No `$ARGUMENTS` anywhere.** Not one of the 30 commands uses Claude Code's argument substitution.
- `name` is inconsistent: mostly bare (`implement`), sometimes prefixed (`sc:index-repo`,
  `sc:recommend`, `sc:agent`) — so name-based matching must tolerate both.

**Skills** (`plugins/superclaude/skills/*/SKILL.md`):
```yaml
---
name: Confidence Check
description: Pre-implementation confidence assessment (≥90% required). Use before starting any
  implementation to verify readiness with duplicate check, architecture compliance, official docs
  verification, OSS references, and root cause identification.
---
```
Two keys only. Note `name: Confidence Check` (title-cased with a space) while the *directory* is
`confidence-check` — name and directory disagree. Other five skills use lowercase kebab matching the
dir. Descriptions are well-written ("Use when…" trigger phrasing) — these would score well on our
`specificityOf()`.

**Modes** (`plugins/superclaude/modes/MODE_*.md`) — **inconsistent**. Only
`MODE_DeepResearch.md` has frontmatter:
```yaml
---
name: MODE_DeepResearch
description: Research mindset for systematic investigation and evidence-based reasoning
category: mode
---
```
The other six have **no frontmatter at all** — they open with `# Brainstorming Mode` and a
`**Purpose**:` line. Structure is `## Activation Triggers` / `## Behavioral Changes` / `## Outcomes`.

**Plugin manifest** (`plugins/superclaude/.claude-plugin/plugin.json`):
```json
{
  "name": "superclaude",
  "version": "4.3.0",
  "description": "AI-enhanced development framework for Claude Code — 30 commands, 20 agents, 7 modes, …",
  "author": { "name": "SuperClaude Org", "url": "https://github.com/SuperClaude-Org" },
  "license": "MIT",
  "commands": "./commands/",
  "agents":   "./agents/",
  "skills":   "./skills/",
  "hooks":    "./hooks/hooks.json",
  "mcpServers": "./.mcp.json"
}
```

**Hooks** (`plugins/superclaude/hooks/hooks.json`) — three events, two handler types:
```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command",
      "command": "${CLAUDE_PLUGIN_ROOT}/scripts/session-init.sh", "timeout": 10000 }] }],
    "Stop": [{ "hooks": [{ "type": "prompt",
      "prompt": "Before ending, check if there are uncommitted changes or incomplete tasks. …" }] }],
    "PostToolUse": [{ "matcher": "Write|Edit", "hooks": [{ "type": "prompt",
      "prompt": "Verify the edit was correct: check for syntax errors, missing imports, …" }] }]
  }
}
```
The `PostToolUse` prompt hook fires an extra model turn on **every single Write/Edit** — a real,
unmeasured token cost that our Hooks section could surface.

**Memory / metrics artifacts** (project-relative, `docs/memory/` in the *user's* repo):

`solutions_learned.jsonl` / `reflexion.jsonl` — one JSON object per line:
```json
{"ts":"2025-10-17T09:23:15+09:00","task":"implement JWT authentication",
 "mistake":"JWT validation failed with undefined secret",
 "evidence":"TypeError: Cannot read property 'verify' of undefined at validateToken",
 "rule":"Always verify environment variables are set before implementing authentication",
 "fix":"Added JWT_SECRET to .env file and validated presence in startup",
 "tests":["Check .env.example for required vars","Add env validation to app startup"],
 "status":"adopted"}
```

`workflow_metrics.jsonl` — schema fully specified in `docs/memory/WORKFLOW_METRICS_SCHEMA.md`:
```json
{"timestamp":"2025-10-17T01:54:21+09:00","session_id":"abc123def456","task_type":"typo_fix",
 "complexity":"light","workflow_id":"progressive_v3_layer2","layers_used":[0,1,2],
 "tokens_used":650,"time_ms":1800,"files_read":1,"sub_agents":[],"success":true,
 "user_feedback":"satisfied","confidence_score":0.85,"hallucination_detected":false,
 "error_recurrence":false}
```
Required: `timestamp`, `session_id`, `task_type`, `complexity`, `workflow_id`, `layers_used`,
`tokens_used`, `time_ms`, `success`. Also `patterns_learned.jsonl` and dated
`docs/mistakes/<test-name>-<YYYY-MM-DD>.md` files.

Note the schema doc **claims** these are written automatically ("All recording is automatic, no user
action required") but there is **no code in the repo that appends to `workflow_metrics.jsonl`** —
the only writer described is a Python snippet inside the schema *documentation*. The checked-in
`workflow_metrics.jsonl` contains a single hand-made `"session_id": "test_initialization"` record.
Treat this as an unimplemented spec.

### Gotchas for a parser

1. **`~/.claude/commands/sc/` is nested.** Any scanner that does a single non-recursive
   `readdirSync` on `~/.claude/commands` sees one directory entry named `sc` and no `.md` files.
   *(This is exactly what `server/index.mjs` does today — see Overlap.)*
2. **`~/.claude/agents/` is flat and unnamespaced.** 20 SuperClaude files intermix with the user's
   own. Attribution requires content sniffing. Reliable markers: the exact string
   `> **Context Framework Note**:` in the body, and the presence of a `category:` frontmatter key.
3. **Two malformed command files.**
   - `commands/agent.md` has a **closing `---` but no opening one** — the file starts with
     `name: sc:agent`. Any `/^---\n…\n---/` frontmatter regex (ours included) returns `{fm:{}}` and
     dumps 3 lines of raw YAML into the prompt body.
   - `commands/business-panel.md` puts its frontmatter inside a ```` ```yaml ```` fence *after* an
     `# /sc:business-panel` heading — also invisible to a frontmatter parser.
4. **CRLF line endings** on the command/agent `.md` files as checked out on Windows. Our `parseFM`
   already handles `\r?\n`; a stricter parser would not.
5. **mtime is the wheel's mtime, not install time** (`shutil.copy2`). Any "installed N days ago"
   heuristic keyed on mtime will read these as older than they are — which pushes them toward a
   DEAD verdict prematurely in our ledger. Prefer directory ctime or a sentinel.
6. **Duplicate agents.** `deep-research.md` and `deep-research-agent.md` are two separate agents with
   near-identical purposes; both install.
7. **`doctor` looks for the wrong file.** `doctor.py:107` detects skills by
   `(item / "implementation.md").exists()` but every shipped skill uses `SKILL.md`. `superclaude
   doctor` therefore reports "No skills installed (optional)" even when skills are installed.
8. **Duplicated payload.** `src/superclaude/{commands,agents,modes,core,mcp,skills}` and
   `plugins/superclaude/{…}` are near-identical copies kept in sync by
   `scripts/sync_from_framework.py`. `src/` has two extra MCP docs (`MCP_Airis-Agent.md`,
   `MCP_Mindbase.md`) and two extra configs the plugin lacks — the copies have already drifted.

---

## Agent / command / mode rosters

### Agents (20) — `~/.claude/agents/*.md`

| File | Category | One-line purpose |
|---|---|---|
| `backend-architect.md` | engineering | Backend systems: data integrity, security, fault tolerance |
| `business-panel-experts.md` | business | 9-thinker business panel (Christensen, Porter, Drucker, Godin, Kim & Mauborgne, Collins, Taleb, Meadows, Doumont) |
| `deep-research-agent.md` | analysis | Comprehensive research with adaptive strategies |
| `deep-research.md` | analysis | External knowledge gathering (near-duplicate of the above) |
| `devops-architect.md` | engineering | Infrastructure/deploy automation, reliability, observability |
| `frontend-architect.md` | engineering | Accessible, performant UI |
| `learning-guide.md` | communication | Teach programming concepts progressively |
| `performance-engineer.md` | quality | Measurement-driven bottleneck elimination |
| `pm-agent.md` | meta | Self-improvement executor: documents work, analyses mistakes, maintains KB (692 ln — by far the largest) |
| `python-expert.md` | specialized | Production-grade Python, SOLID |
| `quality-engineer.md` | quality | Test strategy + edge-case detection |
| `refactoring-expert.md` | quality | Tech-debt reduction, clean code |
| `repo-index.md` | discovery | Repository indexing / codebase briefing |
| `requirements-analyst.md` | analysis | Vague ideas → concrete specifications |
| `root-cause-analyst.md` | analysis | Hypothesis-driven root cause investigation |
| `security-engineer.md` | quality | Vulnerability + compliance analysis |
| `self-review.md` | quality | Post-implementation validation / reflexion partner (33 ln, thinnest) |
| `socratic-mentor.md` | communication | Discovery learning via strategic questioning |
| `system-architect.md` | engineering | Scalable architecture, long-term decisions |
| `technical-writer.md` | communication | Audience-tailored technical docs |

### Commands (30) — `~/.claude/commands/sc/*.md`, invoked as `/sc:<name>`

| Command | Category / complexity | One-line purpose |
|---|---|---|
| `/sc:agent` | orchestration | Session controller; auto-launches at session start (malformed frontmatter) |
| `/sc:analyze` | utility / basic | Quality, security, performance, architecture analysis |
| `/sc:brainstorm` | orchestration / advanced | Socratic requirements discovery |
| `/sc:build` | utility / enhanced | Build/compile/package with error handling |
| `/sc:business-panel` | — | Multi-expert business analysis (malformed frontmatter) |
| `/sc:cleanup` | workflow / standard | Dead-code removal, structure optimisation |
| `/sc:design` | utility / basic | Architecture, APIs, component interfaces |
| `/sc:document` | utility / basic | Component/function/API docs |
| `/sc:estimate` | special / standard | Time/effort/complexity estimates |
| `/sc:explain` | workflow / standard | Explain code, concepts, behaviour |
| `/sc:git` | utility / basic | Git ops with generated commit messages |
| `/sc:help` | utility / low | List all `/sc` commands (148 ln, includes flag reference) |
| `/sc:implement` | workflow / standard | Feature implementation with persona activation |
| `/sc:improve` | workflow / standard | Systematic quality/perf/maintainability improvements |
| `/sc:index-repo` | — | Repository index; claims "94% token reduction (58K → 3K)" |
| `/sc:index` | special / standard | Project documentation + knowledge base |
| `/sc:load` | session / standard | Load project context (Serena MCP) |
| `/sc:pm` | orchestration / meta | PM agent; declares all 8 MCP servers (592 ln) |
| `/sc:recommend` | utility | Recommends which `/sc` command to use (1005 ln — largest file in the payload) |
| `/sc:reflect` | special / standard | Task reflection/validation (Serena MCP) |
| `/sc:research` | command / advanced | Deep web research (Tavily) |
| `/sc:save` | session / standard | Persist session context (Serena MCP) |
| `/sc:sc` | — | Dispatcher: `/sc [command]` |
| `/sc:select-tool` | special / high | MCP tool selection by complexity score |
| `/sc:spawn` | special / high | Meta task orchestration + delegation |
| `/sc:spec-panel` | analysis / enhanced | Simulated expert spec review (427 ln) |
| `/sc:task` | special / advanced | Complex task execution + delegation |
| `/sc:test` | utility / enhanced | Test execution + coverage reporting |
| `/sc:troubleshoot` | utility / basic | Diagnose code/build/deploy issues |
| `/sc:workflow` | orchestration / advanced | PRD → structured implementation workflow |

### Modes (7) — `plugins/superclaude/modes/MODE_*.md`, **not installed by the pip path**

| Mode | Activation | Purpose |
|---|---|---|
| `MODE_Brainstorming` | `--brainstorm`, `--bs`; vague-request keywords | Collaborative discovery mindset |
| `MODE_Business_Panel` | `/sc:business-panel` | 9-expert business analysis engine (334 ln) |
| `MODE_DeepResearch` | `/sc:research`; research keywords | Systematic evidence-based investigation (only mode with frontmatter) |
| `MODE_Introspection` | `--introspect` | Meta-cognitive self-reflection with 🤔🎯⚡📊💡 markers |
| `MODE_Orchestration` | multi-tool ops; >75% resource use; >3 files | Tool-selection optimisation, parallel thinking |
| `MODE_Task_Management` | `--task-manage`, `--delegate`; >3 steps | Hierarchical tasks with persistent memory |
| `MODE_Token_Efficiency` | `--uc`, `--ultracompressed`; context >75% | Symbol-compressed output, claims 30-50% reduction |

### Skills (6) — `~/.claude/skills/<name>/SKILL.md`
`brainstorm`, `confidence-check` (+`confidence.ts`, 124 ln), `deep-research`, `pm`,
`token-efficiency`, `troubleshoot`. Five of six duplicate a MODE file's content in skill form —
the mid-migration state their own gap analysis admits to.

### Flags (~25) — documented in `core/FLAGS.md`, never installed
Mode: `--brainstorm --introspect --task-manage --orchestrate --token-efficient`.
MCP: `--c7/--context7 --seq/--sequential --magic --morph --serena --play/--playwright
--chrome/--devtools --tavily --frontend-verify --all-mcp --no-mcp`.
Depth: `--think` (~4K tok) `--think-hard` (~10K) `--ultrathink` (~32K).
Execution: `--delegate [auto|files|folders]`, and others.
**These are prose in an uninstalled file.** Nothing parses them; the model would have to have read
`FLAGS.md` to honour them, and by the pip path it never does.

---

## UX and interaction design

**Interaction model.** Three layers, only the first two of which actually reach the user by default:

1. *Explicit invocation* — the user types `/sc:implement …` or `@agent-security …`. Claude Code
   resolves the file and injects it. Deterministic; this works.
2. *Descriptive auto-activation* — agents are selected by Claude Code's own matching against the
   `description` frontmatter. SuperClaude's descriptions are well-written for this.
3. *Flag/mode activation* — `--brainstorm`, `--ultrathink`, etc. **This layer is broken on the pip
   install path**, because the file that defines what the flags mean (`core/FLAGS.md`) is never
   installed. The model sees `--brainstorm` as an unexplained token.

**Installer TUI.** `install.sh` is a well-made bash script: colour-coded `print_step/success/warning`
helpers, a 5-phase structure (prereqs → package → commands → verify → next steps), `--yes` for
non-interactive, and a `confirm()` with sane defaults. Prereq checks are real (Python ≥3.10 parsed
from `python3 --version`, UV auto-install offer with PATH fixup, Node ≥18 major-version parse).
`superclaude mcp` renders a box-drawing card for the AIRIS gateway and a numbered list for the 8
individual servers, accepting `g` / `0` / comma-separated indices. API keys are prompted with
`hide_input=True`. `--dry-run` prints the exact `claude mcp add` line.

Genuinely good bits: `superclaude install --list` shows `✅ installed` / `⬜ not installed` per
command by diffing against `~/.claude/commands/sc/`. That is precisely the "what did I actually
install" affordance a CLI should have — and it is the CLI-shaped ancestor of our CapabilityLedger.

**Where users get lost:**

- **Documentation describes a different product.** A user following
  `docs/getting-started/installation.md` will `head ~/.claude/CLAUDE.md` and find nothing. Multiple
  troubleshooting steps in `docs/developer-guide/testing-debugging.md` (`grep "@import"
  ~/.claude/CLAUDE.md`) are checks against a file the installer no longer creates.
- **Two install paths with different capabilities, no signposting.** pip gives you commands+agents.
  The plugin path gives you commands+agents+skills+hooks+MCP. Nothing tells a pip user they are
  missing hooks and modes.
- **`PLUGIN_INSTALL.md` is in Japanese** and hardcodes `/Users/kazuki/github/superclaude/`.
- **`superclaude doctor` lies about skills** (looks for `implementation.md`, files are `SKILL.md`).
- **No uninstall.** Removing SuperClaude means manually deleting `~/.claude/commands/sc/` and
  hand-picking 20 files out of a shared `~/.claude/agents/`.
- **`/sc:recommend` is a 1005-line meta-command** whose existence is an admission that 30 commands
  are not discoverable. That is a design smell: needing a recommender for your command palette.
- **No feedback loop.** Nothing tells the user which of the 30 commands or 20 agents they have ever
  actually used. ← *This is the gap Loush's CapabilityLedger exists to fill.*

---

## Architecture

Four layers, loosely coupled:

**1. Distribution.** `hatchling` builds a wheel from `src/superclaude`, with
`[tool.hatch.build.targets.wheel.force-include]` also stuffing `src` → `superclaude/_src` and
`plugins` → `superclaude/_plugins`. Console script `superclaude = superclaude.cli.main:main`.
An npm package (`@bifrost_inc/superclaude`) wraps the Python one via `postinstall`.

**2. Installer (thin).** `cli/install_commands.py` + `install_skill.py` are ~400 lines of
`glob("*.md")` + `shutil.copy2` + skip-if-exists. Source resolution is a two-priority probe
(`<pkg>/commands`, then `<repo>/plugins/superclaude/commands`) so the same code works installed or
from a checkout. `cli/install_mcp.py` is a registry dict plus a `subprocess` wrapper around the
`claude` CLI — it deliberately does **not** own MCP config format, which is the right call.

**3. Payload (the actual product).** ~9,700 lines of Markdown across
`commands/ agents/ modes/ core/ mcp/ skills/ examples/`, duplicated between `src/superclaude/` and
`plugins/superclaude/` and kept in sync by `scripts/sync_from_framework.py` (959 lines — a large
script whose only job is to fight a duplication the architecture created).

**4. Python runtime (mostly orthogonal).** `pm_agent/` + `execution/` register as a **pytest plugin**
via `[project.entry-points.pytest11]`, exposing fixtures (`confidence_checker`, `token_budget`,
`reflexion_pattern`, …) and markers. This is a genuinely separate product from the Markdown payload —
it runs in the user's *test suite*, not in Claude Code. Nothing in the Markdown layer calls it and
nothing in it reads the Markdown layer. 136 tests cover this half; the Markdown half is untested by
construction.

**Behavioural-instruction-injection model.** The claim is "behavioral instruction injection"
(README:86). Mechanically, in v4.3.0, it is entirely **Claude Code's own file-loading**:
- command `.md` → injected when the user types `/sc:<name>`
- agent `.md` → injected when Claude Code's subagent matcher picks it, or on `@agent-<name>`
- skill `SKILL.md` → injected by the skills loader
There is **no runtime, no interceptor, no wrapper process**. SuperClaude writes files into
directories Claude Code already reads. The v3 model — a `~/.claude/CLAUDE.md` with `@`-imports that
pulled `RULES.md`/`FLAGS.md`/`MODE_*.md` into *every* session — was the actual "injection", and it
was deleted (`DELETION_RATIONALE.md`). What remains is per-invocation, not always-on. That is
*better* for context cost and *worse* for the framework's own claims about modes and flags.

**How it claims to measure success** — four mechanisms, none externally validated:
- **`workflow_metrics.jsonl`** (`docs/memory/WORKFLOW_METRICS_SCHEMA.md`): a rigorous 15-field
  per-execution schema with a documented weekly-review and 80/20 A/B allocation process, promotion
  rules gated on `p < 0.05` and success rate ≥95%. Analysis scripts exist
  (`analyze_workflow_metrics.py`, `ab_test_workflows.py`, uses `scipy`). **But nothing writes the
  file.** The spec is real; the instrumentation is not.
- **ConfidenceChecker** (`pm_agent/confidence.py`): 5 weighted checks → a 0–1 score, gate at 0.9.
  Self-assessed by the model/heuristics — Silin's "self-grading, fantasy" critique applies.
- **ReflexionPattern**: tracks "error recurrence rate <10%, solution reuse >90%" as *docstring
  targets*, not measurements.
- **Marketing numbers in frontmatter**: "94% token reduction (58K → 3K)",
  "98% token reduction", "2-3x faster / 30-50% fewer tokens". No methodology published for any.

---

## Notable code worth stealing

| File path | What it does | Why it's good | Port difficulty |
|---|---|---|---|
| `src/superclaude/cli/install_commands.py:125-162` (`list_available_commands` / `list_installed_commands`) | Diffs shipped vs. installed and renders `✅ installed` / `⬜ not installed` | The exact "did what I paid for actually land" question, answered in 40 lines. CLI-shaped ancestor of CapabilityLedger. | **Easy** — 30 lines of JS in `server/index.mjs` |
| `plugins/superclaude/agents/*.md` (the Triggers / Mindset / Focus / Actions / Outputs / **Boundaries** template) | Uniform agent authoring template with an explicit `Will Not:` section | The `Will Not` block is the highest-leverage part of an agent prompt and almost nobody writes one. 20 worked examples, MIT-licensed. | **Easy** — copy as an Authoring/PromptStudio template |
| Command frontmatter `mcp-servers: []` + `personas: []` | Declares each command's MCP and agent dependencies | Turns a flat capability list into a **graph**. Nothing native records this. Directly feeds a d3 dependency view. | **Easy** to parse; **Medium** to visualise |
| `docs/memory/WORKFLOW_METRICS_SCHEMA.md` | 15-field per-execution JSONL schema + weekly review + A/B promotion rules (`p<0.05`, success ≥95%) | A serious, local-first, privacy-preserving telemetry design that matches our zero-telemetry thesis exactly. We already *have* the data (transcripts) they never instrumented. | **Medium** — schema is free, deriving the fields from `.jsonl` transcripts is the work |
| `docs/memory/reflexion.jsonl.example` schema (`ts/task/mistake/evidence/rule/fix/tests/status`) | Structured "mistake → rule → fix → tests" ledger | Clean, small, append-only. `evidence` + `tests` fields are the parts that make it non-fantasy. | **Easy** — it's a schema |
| `scripts/ab_test_workflows.py` (310 ln) | Two-variant significance test over a JSONL metric log | Ready-made statistics for "did this config change help?". Python, so reference not port. | **Medium** — reimplement in JS or shell out |
| `scripts/uninstall_legacy.sh` | Backs up to `~/.claude-superclaude-backup-<ts>/` before removing; uses Python for JSON surgery on `settings.json`; prints "Official Claude Code files were NOT touched" | Exactly the backup-then-mutate discipline our `backup()` already follows. The explicit reassurance line is good UX copy. | **Easy** — pattern, not code |
| `src/superclaude/cli/install_mcp.py:126-155` (`_verify_file_integrity`) | SHA-256 verification of downloaded config, with `None` = skip | Right shape for a supply-chain check on any config we fetch. (Note: upstream has both pins set to `None`.) | **Easy** |
| `src/superclaude/execution/parallel.py` (341 ln) | Dependency graph → parallel groups → `ThreadPoolExecutor`, with `Task.can_execute(completed)` | Clean, small, well-typed dependency-group scheduler. Relevant to Flow/Workflows if we ever run steps. | **Medium** — Python→JS, but the algorithm is 60 lines |
| `install.sh` phase structure + `confirm()` | 5-phase installer with colour helpers, `--yes`, prereq version parsing | Good model for a Loush "install this framework for me" flow driven from SetupSection. | **Medium** |
| `docs/user-guide/claude-code-integration.md` | Feature → Claude Code extension point → gap, for all 8 integration surfaces | The best single map of Claude Code's extension surface I found in any third-party repo. Useful as a **checklist of what Loush should be able to see**. | **Easy** — reference doc |

**Do not port:** the `src/` ↔ `plugins/` duplication + `sync_from_framework.py`; the
`/sc:recommend` 1005-line meta-command; the AIRIS gateway coupling (Docker + a third-party
`localhost:9400` service + plaintext API keys in `~/.superclaude/.../.env`).

---

## Gaps and weaknesses

1. **Docs describe v3, code is v4.** The `~/.claude/CLAUDE.md` `@import` architecture is documented in
   at least 6 files and implemented in none. Users following the docs troubleshoot a phantom.
2. **Modes and flags are undeliverable on the primary install path.** 7 modes and ~25 flags are
   README headline features; the pip installer places zero of the files that define them.
3. **Metrics are specified, not instrumented.** No writer for `workflow_metrics.jsonl`; the
   analysis and A/B scripts have no input.
4. **All performance claims are self-reported and un-methodologised.** "94%", "98%", "2-3x", "30-50%".
5. **Maintenance is thin.** 1 commit / 90 days; last release 4 months old; 70 open issues;
   effectively 2 primary contributors; `google-labs-jules[bot]` among the top contributors.
6. **Two malformed command files** (`agent.md` missing opening `---`, `business-panel.md` fenced
   frontmatter) shipped in a tagged release. Suggests nothing validates the payload in CI.
7. **`doctor` checks for `implementation.md`; skills ship `SKILL.md`.** The health check cannot pass.
8. **No uninstall, and agents install unnamespaced.** Removal requires manually identifying 20 files
   in a directory shared with the user's own agents.
9. **No `$ARGUMENTS` in any of 30 commands** — leaves Claude Code's argument substitution unused.
10. **Agents declare no `tools`/`allowed-tools`/`model`.** All 20 inherit full default tool access;
    a "security reviewer" persona has unrestricted `Bash` and `Write`.
11. **Duplicated payload has already drifted** (`src/` has 2 MCP docs + 2 configs the plugin lacks).
12. **The "fantasy" critique is structurally sound.** `estimate`, `spec-panel`, `business-panel`,
    `reflect`, and `confidence-check` all produce output no toolchain can falsify.
13. **Supply chain.** `install.sh` pipes `curl … | sh` for UV. The AIRIS path downloads a
    `docker-compose.yml` from a third-party repo's `main` branch with SHA pinning present in code but
    **set to `None`**, then runs `docker compose up -d`.
14. **API keys land in plaintext** in `~/.superclaude/airis-mcp-gateway/.env` and are passed as
    `-e KEY=value` on a `claude mcp add` argv (visible in process listings).
15. **Untested payload.** 136 tests all target the Python half. Not one asserts that a shipped
    command file has parseable frontmatter.

---

## Overlap with Loush Dashboard

| Their feature | Our equivalent section (or NONE) | Who does it better | Note |
|---|---|---|---|
| `install --list` (shipped vs installed) | **CapabilityLedger** (`src/sections/CapabilityLedger.jsx`, `server/index.mjs:capabilityLedger()`) | **Loush, decisively** | They show installed/not. We show installed × *actually fired* × token cost × DEAD/COLD/NEW/HOT verdict. Theirs is inventory; ours is ROI. |
| 30 command `.md` files | **Library / Customize / Authoring** | Them (content), us (management) | We can enable/disable/archive per file; they can only `--force` overwrite. But **we currently cannot see them at all** — see below. |
| 20 agent `.md` files | **Library / CapabilityLedger / Customize** | Loush (we see them) | These land flat in `~/.claude/agents/` so our existing flat scan **does** pick them up — as 20 unattributed rows with no hint they came from SuperClaude. |
| 6 skills | **Library / CapabilityLedger** | Loush | `~/.claude/skills/<name>/SKILL.md` matches our `nested: true` shape exactly. Works today. |
| 8 MCP server recipes + installer | **Mcp** (`src/sections/McpSection.jsx`, `server/index.mjs` `mcpServers` read/write on `~/.claude.json`) | **Split** | They *install* MCP servers (we don't offer a catalogue); we *inspect and toggle* them (they can't). Their `MCP_*.md` docs are a ready-made description corpus for our Mcp section. |
| `hooks.json` (SessionStart / Stop / PostToolUse) | **Hooks** (`src/sections/HooksSection.jsx`) | Loush | We render and manage hooks; they only ship a static file. Their `PostToolUse` prompt-hook-on-every-edit is exactly the kind of hidden cost our Hooks section should price. |
| `core/RULES.md`, `PRINCIPLES.md` | **Governance** (`src/sections/GovernanceSection.jsx`), `server/constitution.mjs` | Loush | Ours is enforced/tracked; theirs is an uninstalled markdown file. Their 🔴/🟡/🟢 priority tiers + "Conflict Resolution Hierarchy" is a good rubric to borrow. |
| 7 behavioural modes | **NONE** | Them (concept only) | We have no notion of a "mode". Given they don't install them either, low priority — but if a user has the plugin channel, we should surface them. |
| `core/FLAGS.md` (~25 flags) | **NONE** | Them (concept only) | Nothing on either side executes these. |
| `workflow_metrics.jsonl` schema | **Insights / UsagePanel / ForensicsSection** — partially | **Loush, by a wide margin** | They specified telemetry and never wrote it. We derive real numbers from `~/.claude/projects/**/*.jsonl` that already exist. Their *schema* is worth adopting as an output format. |
| `reflexion.jsonl` (mistake→rule→fix) | **NONE** (closest: `server/memory.mjs`, BugsSection) | Them (concept) | Genuinely novel and small. A "Lessons" surface reading `docs/memory/*.jsonl` from the joined repo would be a real addition. |
| ConfidenceChecker (pre-implementation gate) | **PromptQuality / PromptStudio** — adjacent, not equivalent | Split | Ours scores prompt *text*; theirs scores task *readiness*. Different axes. Their 5-check rubric is portable to PromptStudio as a pre-flight checklist. |
| `/sc:index-repo` (repo → compact brief) | **ContextExplorerSection / WorkingSet** | Loush | We already join transcripts to repos on disk. |
| `doctor` (3 health checks) | **SetupSection** (`server/setup.mjs`), **ReliabilitySection** | Loush | Ours checks more and is not broken. |
| Plugin manifest / `enabledPlugins` | **Customize** (`customizePlugins()`, `server/index.mjs:418-425`) | Loush | We already read `settings.json.enabledPlugins` and toggle it. |
| ParallelExecutor / dependency graph | **Flow / PlanGraph** | Split | Ours visualises; theirs executes. Different products. |

### The concrete integration bug this research surfaced

`server/index.mjs:155-159` defines commands as `nested: false` and
`overviewItems()` (`:600-615`) / `/api/res/:kind` (`:178-193`) iterate
`fs.readdirSync(~/.claude/commands)` **one level deep**, mapping each entry to
`itemFile()` → `<dir>/<name>.md`.

With SuperClaude installed, `~/.claude/commands/` contains a single **directory** named `sc`.
The loop derives `name = "sc"`, computes `~/.claude/commands/sc.md`, finds it missing, and `continue`s.

**Result: all 30 SuperClaude commands are invisible to Library, Customize, Overview and
CapabilityLedger.** Their 20 agents *are* visible (flat dir) but appear as anonymous rows. So today
the ledger under-reports a SuperClaude user's installed surface by 30 items, and the fire-matching
logic at `:2860-2867` — which already correctly strips the `sc:` prefix via
`full.split(':').pop()` — never gets a chance to run because the command names were never registered.

Nested command directories are a standard Claude Code namespacing convention, not a SuperClaude
quirk. This is a general bug that SuperClaude merely exposes.

Secondary: `SKIP_DIRS` in the artifacts walker (`server/index.mjs:497`) contains `'plugins'`, so a
plugin-channel SuperClaude install is invisible to ArtifactsSection too.

---

## Recommended adoptions

Ranked by value-per-effort. **Bold** = "make our dashboard understand their artifacts"
(higher leverage); *italic* = "port their code".

---

**1. Recurse into command/agent subdirectories.** — effort **S**

- Take: nothing. Fix our own scanner.
- Lands in: `server/index.mjs` — `KINDS` (:149-165), `itemFile()` (:166), `/api/res/:kind` (:178),
  `overviewItems()` (:600).
- Change: walk `~/.claude/commands/**` and `~/.claude/agents/**`, deriving the display name as the
  path relative to the scope dir with `/` → `:` (so `sc/implement.md` → `sc:implement`). This
  matches how Claude Code namespaces nested commands and how the user types them.
- Unlocks: **30 previously invisible capabilities appear in Library, Customize, Overview and the
  Ledger.** The existing fire-matcher at `:2864` already handles the `sc:` prefix, so ROI verdicts
  light up for free. Also fixes every *other* user with a namespaced command folder.
- This is the single highest-value item in this document.

**2. Framework attribution — "who installed this?"** — effort **M**

- Take: their file signatures, not their code.
- Lands in: new `server/frameworks.mjs`; surfaced as a `source` column in `CapabilityLedger.jsx`
  (add to `COLS`) and a filter chip in `LibrarySection.jsx`.
- Detection rules for SuperClaude specifically:
  - commands under `~/.claude/commands/sc/`
  - agents whose body contains `> **Context Framework Note**:` **or** whose frontmatter has a
    `category:` key alongside exactly `name`+`description`
  - `~/.claude/skills/{confidence-check,pm,deep-research,token-efficiency,troubleshoot,brainstorm}/`
  - `settings.json.enabledPlugins["superclaude@superclaude"]`
  - presence of `~/.superclaude/airis-mcp-gateway/`
  - `superclaude` on `$PATH` → `superclaude --version` for the installed version
- Unlocks: the ledger can say *"SuperClaude v4.3.0 costs you N tok/session; 27 of its 50 capabilities
  have never fired"*. That is a headline no other tool can produce, and it is the CapabilityLedger
  thesis applied to a whole framework rather than a single file.

**3. Artifact lint — flag malformed frontmatter.** — effort **S**

- Take: nothing; the two broken SuperClaude files are the test fixtures.
- Lands in: `server/index.mjs` `parseFM()` (:139) already returns `{fm:{}}` on failure — propagate a
  `fmMissing` / `fmError` flag through `overviewItems()` into the Ledger and Library rows.
- Rules worth checking: no opening `---`; frontmatter inside a code fence; YAML parse error
  (we already capture `_parse_error`); `name` disagreeing with filename/dirname
  (SuperClaude's `confidence-check` skill: `name: Confidence Check`).
- Unlocks: a broken command silently does nothing today. Surfacing "this file's frontmatter didn't
  parse — Claude Code is treating 3 lines of YAML as prompt text" is immediately actionable, and
  it is exactly the kind of thing only a tool that reads the files can tell you.

**4. Adopt their command frontmatter as a dependency graph.** — effort **M**

- Take: the `mcp-servers: []` / `personas: []` convention (schema, not code).
- Lands in: `server/index.mjs` `overviewItems()` — carry `fm['mcp-servers']` and `fm.personas`
  through as `declaredMcp` / `declaredAgents`; render in `FlowSection.jsx` / `PlanGraph.jsx` (we
  already have d3) and cross-check in `McpSection.jsx`.
- Unlocks: two new questions. (a) *"This command declares `serena` but you don't have `serena`
  installed"* — a real broken-dependency check. (b) *"You have `morphllm` installed; only 2 commands
  reference it and neither has fired"* — MCP-level ROI, which our ledger currently can't do because
  MCP servers have no declared consumers. Also: adopt the convention in our own Authoring templates.

**5. Steal the agent authoring template, especially `Will Not:`.** — effort **S**

- *Port their content* (MIT, and we have the author's permission).
- Lands in: `src/sections/AuthoringSection` / `PromptStudio.jsx` as a new agent template; and
  `scoreItem()` in `server/index.mjs:557` as a scoring signal — award points for an explicit
  negative-boundary section (`Will Not` / `Never` / `Do not`), which currently only
  `specificityOf()` partially rewards.
- Unlocks: better agents authored in Loush, and a scoring dimension that measures something real
  (constraint specificity) rather than markdown formatting.

**6. Read `docs/memory/*.jsonl` from the joined repo → a "Lessons" surface.** — effort **M**

- Take: the `reflexion.jsonl` schema (`ts/task/mistake/evidence/rule/fix/tests/status`) and the
  `docs/mistakes/<name>-<date>.md` convention.
- Lands in: `server/memory.mjs` (extend), surfaced in `InsightsSection.jsx` or `BugsSection.jsx`.
- Unlocks: for the (probably small) set of users running the PM agent, we render their accumulated
  mistake→rule ledger. More importantly the schema is good enough to adopt as **our own** output
  format for lessons we derive from transcripts — which we can actually populate, and they can't.

**7. Emit our derived metrics in their `workflow_metrics.jsonl` schema.** — effort **M**

- Take: `docs/memory/WORKFLOW_METRICS_SCHEMA.md` (spec only — there is no implementation to port).
- Lands in: a new export in `server/index.mjs` alongside `/api/usage`; consumed by
  `InsightsSection.jsx` / `UsagePanel.jsx`.
- Unlocks: we already parse `tokens_used`, `time_ms`, `success`, `sub_agents`, `session_id` and
  `files_read` out of real transcripts. Emitting them in a published schema makes our data
  interoperable with their (unwritten) analysis scripts, and gives Insights a defensible field list
  rather than an ad-hoc one. **Do not** adopt their `task_type`/`complexity` taxonomy — it's
  keyword-matched and partly in Japanese.

**8. Framework-aware install/uninstall in SetupSection.** — effort **L**

- *Port the shape of* `install.sh` (5-phase, `confirm()`, `--yes`) and `uninstall_legacy.sh`
  (backup-to-timestamped-dir before mutate — which our `backup()` at `server/index.mjs:131` already
  does).
- Lands in: `server/setup.mjs`, `src/sections/SetupSection.jsx`.
- Unlocks: one-click "install SuperClaude" and — more valuable, because upstream has none —
  **a working uninstall** that removes `~/.claude/commands/sc/` plus the 20 attributable agent files,
  with backup and dry-run, reusing the exact `/api/capabilities/archive` path
  (`server/index.mjs:2911`) the Ledger already uses.
- Gate this on items 1–2 shipping first; managing a framework you can't see is backwards.

**9. Price the `PostToolUse` prompt hook.** — effort **S**

- Take: nothing; just make HooksSection show it.
- Lands in: `src/sections/HooksSection.jsx`, `customizeHooks()` in `server/index.mjs`.
- Unlocks: a `type: "prompt"` hook on `Write|Edit` costs an extra model turn per edit. If we can
  count `Write`/`Edit` tool calls from transcripts (we already do — `server/index.mjs:1030-1043`
  tallies `a.tools`), we can quote a real per-session cost for a hook the user forgot they enabled.
  That is the CapabilityLedger idea extended to hooks, and nobody does it.

**10. `_verify_file_integrity` pattern for any fetched config.** — effort **S**

- *Port the pattern* from `install_mcp.py:126-155`.
- Lands in: wherever SetupSection/Mcp would fetch remote configs.
- Unlocks: supply-chain hygiene. Worth noting in our docs that upstream ships this function with
  both hash constants set to `None` — we should ship pins, or not ship the fetch.

---

### Deliberately not adopted

- The 7 modes / 25 flags. Upstream doesn't install them; they're prose.
- `/sc:recommend`. A 1005-line command recommender is a symptom, not a feature — a dashboard with
  search and usage data is the right answer.
- AIRIS gateway. Docker + third-party `localhost:9400` + plaintext keys in `~/.superclaude/.env`
  is squarely against our local-first, minimal-surface thesis.
- Their pytest plugin. It's a separate product that runs in the user's test suite; no dashboard hook.
- `estimate` / `spec-panel` / `business-panel`. Silin's "fantasy" argument applies and we have no
  way to ground them.

---

## Sources

**Primary (verified against clone of `master` @ `10be7503`, 2026-07-21):**
- https://github.com/SuperClaude-Org/SuperClaude_Framework
- `README.md`, `CHANGELOG.md`, `LICENSE`, `VERSION`, `pyproject.toml`, `package.json`, `MANIFEST.in`,
  `setup.py`, `install.sh`, `PLUGIN_INSTALL.md`, `DELETION_RATIONALE.md`, `QUALITY_COMPARISON.md`
- `src/superclaude/cli/{main,install_commands,install_mcp,install_skill,doctor}.py`
- `src/superclaude/pm_agent/{confidence,reflexion,self_check,token_budget}.py`
- `src/superclaude/execution/{parallel,reflection,self_correction}.py`
- `plugins/superclaude/{.claude-plugin/plugin.json,.mcp.json,hooks/hooks.json,scripts/session-init.sh}`
- `plugins/superclaude/{agents,commands,modes,core,skills,mcp}/`
- `scripts/{uninstall_legacy.sh,ab_test_workflows.py,analyze_workflow_metrics.py,sync_from_framework.py}`
- `docs/user-guide/claude-code-integration.md`, `docs/developer-guide/technical-architecture.md`,
  `docs/getting-started/installation.md`, `docs/memory/WORKFLOW_METRICS_SCHEMA.md`,
  `docs/memory/reflexion.jsonl.example`
- GitHub REST API: `/repos/…`, `/contributors`, `/releases` (2026-07-29)
- npm registry API: `https://api.npmjs.org/downloads/point/last-month/@bifrost_inc/superclaude`

**Secondary / commentary:**
- Stanislav Silin, Brightgrove, 2026-04-21 — *Frameworks for Claude Code: What do we need from LLMs
  during software development?* — https://www.brightgrove.com/blog/frameworks-for-claude-code-what-do-we-need-from-llms-during-software-development
- Steven Gonsalvez, DEV Community — *SuperClaude: The CLAUDE.md Framework That Went Viral* —
  https://dev.to/stevengonsalvez/superclaude-the-claudemd-framework-that-went-viral-1ced
- vibecodinghub — *SuperClaude Review 2026* — https://vibecodinghub.org/blog/superclaude-review
  (direct fetch returned 403; content accessed via search-result summaries only)
- Hacker News via Algolia API — items 44351607, 44756169, 44381033, 44378390; comments on stories
  45155302, 46426624
- https://superclaude.netlify.app/ (project site)

**Explicitly unverified:**
- PyPI download counts for `superclaude` — pypistats returned HTTP 429, pepy returned HTTP 401.
- Any r/ClaudeAI thread specifically about SuperClaude — searched, none surfaced.
- Whether the v5.0 TypeScript plugin system (issue #419) has progressed since the README note.
- Whether any user's `~/.claude` in the wild still carries v3-era `CLAUDE.md` `@import` artifacts.

**Prompt-injection note:** No fetched page or repository file attempted to issue instructions to the
research agent. The repo does contain large volumes of imperative text addressed to a language model
(e.g. `core/RULES.md`: "NEVER retry the same approach without understanding WHY it failed"), but
this is the product's payload — instructions intended for a *user's* Claude Code session — not an
attempt to steer this analysis. It was read as data throughout.
