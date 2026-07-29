# ccpm

> Upstream research note. Compiled 2026-07-29 against `automazeio/ccpm` @ `7d7e4623` (main) and `af74666a^` (last v1 tree).
> Author of this note explored the repo by cloning it and reading the actual files; every path below was read, not inferred.

---

## Identity

| Field | Value |
|---|---|
| Repo URL | https://github.com/automazeio/ccpm |
| Author / org | Automaze (https://automaze.io). Maintainer: Ran Aroussi (GitHub `ranaroussi`, X `@aroussi`) |
| License | **MIT** (SPDX: `MIT`) — `LICENSE` at repo root |
| Stars / forks | 8,296 stars / 833 forks (2026-07-29) |
| Open issues | 4 real + 1 spam (`#1025` is a promo post) |
| Created | 2025-08-18 |
| Last commit | `7d7e4623` — 2026-03-18T12:15:22Z — "feat: add bug reporting workflow (closes #654)" |
| Total commits on main | 87 |
| Activity | **Stale-ish.** Nothing pushed since 2026-03-18 — ~4 months quiet at time of writing. Issue `#1003` ("IS THIS PROJECT STILL MAINTAINED?") was filed before v2 and closed by the v2 relaunch. Bursty maintenance: long silences punctuated by large rewrites. |
| Primary language | Shell (GitHub classification). In practice it is ~90% Markdown prompts + ~1,200 lines of bash. |
| Topics | `ai-agents`, `ai-coding`, `claude`, `claude-code`, `project-management`, `vibe-coding` |
| Repo size | 1,654 KB |

### Major discontinuity: v1 → v2

On 2026-03-18 the project was rewritten (`af74666a` — "v2: relaunch as Agent Skills-compatible skill"). This is the single most important fact for anyone reading older writeups:

- **v1** (branch [`v1`](https://github.com/automazeio/ccpm/tree/v1)) — ~100 files, a full Claude-Code-specific `/pm:*` slash command system, 4 custom subagents, 11 rule files, an installer, Chinese docs.
- **v2** (branch `main`) — **27 files**. One Agent Skill (`skill/ccpm/SKILL.md` + 6 reference docs + 14 bash scripts). No slash commands. No custom subagents. No installer.

Branches present: `main`, `v1`, `rc`, `bash-error`.

### Install method

**v2 (current):** clone + symlink. No package manager, no install script.
```bash
git clone https://github.com/automazeio/ccpm.git
ln -s /path/to/ccpm/skill/ccpm .claude/skills/ccpm      # Claude Code
ln -s /path/to/ccpm/skill/ccpm ~/.factory/skills/ccpm   # Factory / Droid
```

**v1 (historical, do not use):** `install/README.md` documented `curl -sSL https://automaze.io/ccpm/install | bash` plus wget and PowerShell (`iwr -useb ... | iex`) variants. That URL was implicated in a supply-chain compromise — see *Gaps and weaknesses*.

### Platforms

Bash-first. All 14 deterministic scripts are `#!/bin/bash` using `grep`/`sed`/`basename`. macOS and Linux are the happy path.

- **Windows is second-class.** Requires Git Bash or WSL. Issue `#963` reports install failure under PowerShell; `#973` reports `$(...)` command-substitution portability failures under zsh.
- `sed -i.bak` is used throughout (the BSD/GNU-compatible form), so at least that is portable.

### Dependencies

| Dependency | Required? | Used for |
|---|---|---|
| `git` (>= worktree support) | Yes | Branches, worktrees, merges |
| `gh` CLI, authenticated | Yes | All GitHub reads/writes |
| `gh` extension `yahsan2/gh-sub-issue` | Optional | Real parent→child sub-issue links. Falls back to markdown task-lists if absent. |
| A GitHub repo | Yes | Issues are the datastore |
| bash, grep, sed, coreutils | Yes | The tracking scripts |
| An Agent Skills–compatible harness | Yes | Claude Code, Codex, OpenCode, Factory, Amp, Cursor (per README) |

**No** package.json, no npm/pip/cargo, no database, no server, no web UI. Zero runtime dependencies beyond the shell and `gh`.

---

## The problem it solves

Four failure modes of agentic coding, stated in `README.md`:

1. **Context evaporates between sessions** — the agent re-derives the same understanding every time, expensively and inconsistently.
2. **Parallel work creates conflicts** — running several agents at once produces collisions when they touch the same files.
3. **Requirements drift** — decisions made verbally in chat override written specs, and nothing records the divergence.
4. **Progress is invisible until the end** — work lives in a chat log nobody else can see, so a human cannot tell what the agent actually did.

The underlying diagnosis is that a chat transcript is a bad database. ccpm's answer is to move project state out of the conversation into two durable places: **markdown files in the repo**, and **GitHub Issues**.

Its second, sharper claim is that **an issue is not an atomic unit of work**. "Implement user authentication" is really five concurrent workstreams (DB, service, API, UI, tests). Traditional tooling forces one agent per issue; ccpm decomposes *below* the issue into streams and runs an agent per stream.

---

## Value proposition

- **Spec-driven, anti-"vibe coding".** The stated rule: every line of code must trace back to a specification. Enforced as a 5-phase discipline — Brainstorm → Document → Plan → Execute → Track.
- **Full traceability chain:** PRD → Epic → Task → Issue → Code → Commit. Each hop leaves a file and/or an issue.
- **GitHub Issues as the shared database.** No new SaaS, no separate PM tool, no GitHub Projects API. Humans and agents read the same state; a human can pick up where an agent stopped.
- **Parallelism as a first-class concept.** Tasks carry `parallel`, `depends_on`, and `conflicts_with` metadata so the system can compute what may run simultaneously.
- **Context firewalling.** Sub-agents absorb implementation detail and return only summaries, so the main conversation stays a conductor rather than drowning in diffs.
- **Deterministic ops cost zero tokens.** Status, standup, search, blocked, next, validate are bash scripts, not LLM calls. This is the most defensible engineering idea in the project.
- **Harness-agnostic (v2).** Conforms to the agentskills.io skill format rather than Claude-Code-only slash commands.

---

## The workflow model

`PRD → Epic → Task → GitHub Issue → Worktree → Merge`

Everything local lives under `.claude/` **in the consuming project** (not in the ccpm checkout):

```
.claude/
├── prds/
│   └── <feature-name>.md              # Product requirement documents
├── epics/
│   ├── <feature-name>/
│   │   ├── epic.md                    # Technical epic
│   │   ├── <N>.md                     # Task files (renamed to GitHub issue number after sync)
│   │   ├── <N>-analysis.md            # Parallel work stream analysis
│   │   ├── github-mapping.md          # Issue number → URL mapping
│   │   ├── execution-status.md        # Active agents tracker
│   │   └── updates/
│   │       └── <issue_N>/
│   │           ├── stream-A.md        # Per-agent progress
│   │           ├── progress.md        # Overall issue progress
│   │           └── execution.md       # Execution state
│   └── archived/
│       └── <feature-name>/            # Completed epics
└── context/                           # Project context docs (separate v1 subsystem)
```

Defined in `skill/ccpm/references/conventions.md`.

### Stage 1 — PRD

**Defined in:** `skill/ccpm/references/plan.md`
**Trigger:** "I want to build X" / "let's plan X"
**Artifact:** `.claude/prds/<feature-name>.md`

The skill is instructed to conduct genuine brainstorming *before writing anything* — asking about problem, users, success criteria, out-of-scope, and constraints. Quality gates before saving: no placeholder text, user stories carry acceptance criteria, success criteria are measurable, out-of-scope is explicit.

```markdown
---
name: payment-integration
description: Stripe subscriptions and one-time charges
status: backlog          # backlog | active | completed
created: 2026-03-18T09:14:22Z
---

# PRD: payment-integration

## Executive Summary
## Problem Statement
## User Stories
## Functional Requirements
## Non-Functional Requirements
## Success Criteria
## Constraints & Assumptions
## Out of Scope
## Dependencies
```

Feature names must be kebab-case; otherwise the skill refuses with a fixed error string.

### Stage 2 — Epic

**Defined in:** `skill/ccpm/references/plan.md` (second half)
**Trigger:** "parse the X PRD"
**Artifact:** `.claude/epics/<feature-name>/epic.md`

```markdown
---
name: payment-integration
status: backlog          # backlog | in-progress | completed
created: 2026-03-18T09:31:02Z
updated: 2026-03-18T09:31:02Z
progress: 0%
prd: .claude/prds/payment-integration.md
github: (will be set on sync)
---

# Epic: payment-integration

## Overview
## Architecture Decisions
## Technical Approach
### Frontend Components
### Backend Services
### Infrastructure
## Implementation Strategy
## Task Breakdown Preview
## Dependencies
## Success Criteria (Technical)
## Estimated Effort
```

Two constraints worth stealing: **aim for ≤10 tasks total, prefer simplicity over completeness**, and **look for ways to leverage existing functionality before creating new code**. These are explicit anti-bloat guards on the LLM.

### Stage 3 — Task decomposition

**Defined in:** `skill/ccpm/references/structure.md`
**Trigger:** "break down the X epic"
**Artifacts:** `.claude/epics/<name>/001.md`, `002.md`, …

```markdown
---
name: Stripe client setup
status: open              # open | in-progress | closed
created: 2026-03-18T09:44:10Z
updated: 2026-03-18T09:44:10Z
github: (will be set on sync)
depends_on: []            # issue numbers that must close first
parallel: true            # may run concurrently with non-conflicting tasks
conflicts_with: []        # issue numbers touching the same files
---

# Task: Stripe client setup

## Description
## Acceptance Criteria
- [ ]

## Technical Details
## Dependencies

## Effort Estimate
- Size: XS/S/M/L/XL
- Hours: N

## Definition of Done
- [ ] Code implemented
- [ ] Tests written and passing
- [ ] Code reviewed
```

Batching strategy by epic size: **<5 tasks** sequential; **5–10** batched into 2–3 groups with parallel Task agents; **>10** dependency analysis first, then max 5 concurrent agents.

A summary block is appended to `epic.md`:

```markdown
## Tasks Created
- [ ] 001.md - Stripe client setup (parallel: true)
- [ ] 002.md - Webhook handler (parallel: true)

Total tasks: 7
Parallel tasks: 5
Sequential tasks: 2
Estimated total effort: 34 hours
```

Circular dependencies are declared an error to be checked before finalizing.

### Stage 4 — GitHub sync

**Defined in:** `skill/ccpm/references/sync.md`
**Trigger:** "sync the X epic to GitHub"

Six steps, each with literal shell in the reference doc:

1. **Create epic issue** — body is the task file with frontmatter stripped via `sed '1,/^---$/d; 1,/^---$/d'`, labelled `epic,epic:<name>,feature`.
2. **Create task sub-issues** — detects `gh extension list | grep -q "yahsan2/gh-sub-issue"`. <5 tasks sequential; ≥5 uses parallel Task agents in batches of 3–4. Labelled `task,epic:<name>`.
3. **Rename task files to issue numbers** — `001.md` → `1235.md`, and rewrite every `depends_on` / `conflicts_with` array from sequential numbers to real issue numbers.
4. **Update frontmatter** — set `github:` URL and `updated:` timestamp on epic and every task.
5. **Create the worktree** — `git checkout main && git pull origin main; git worktree add ../epic-<name> -b epic/<name>`.
6. **Write `github-mapping.md`** — issue number → URL index.

Step 3 is the load-bearing trick: **the local filename becomes the issue number**, so issue #1234 is always file `1234.md`. Lookup is O(1) with no index.

### Stage 5 — Execute

**Defined in:** `skill/ccpm/references/execute.md`
**Trigger:** "start working on issue 42"

First an **analysis** artifact, `.claude/epics/<name>/<N>-analysis.md`:

```markdown
---
issue: 1235
title: Stripe client setup
analyzed: 2026-03-18T10:02:44Z
estimated_hours: 12
parallelization_factor: 2.4
---

# Parallel Work Analysis: Issue #1235

## Overview
## Parallel Streams

### Stream A: Database Layer
**Scope**:
**Files**: src/db/*, migrations/*
**Can Start**: immediately
**Estimated Hours**: 5
**Dependencies**: none

### Stream B: API Layer
**Files**: src/api/*
**Can Start**: after Stream A
**Dependencies**: Stream A

## Coordination Points
### Shared Files
### Sequential Requirements
## Conflict Risk Assessment
## Parallelization Strategy
## Expected Timeline
- With parallel execution: 5h wall time
- Without: 12h
- Efficiency gain: 58%
```

Suggested stream taxonomy: Database / Service / API / UI / Test layer.

Then execution: create `updates/<N>/stream-<X>.md` per stream, launch one `general-purpose` sub-agent per ready stream with a prompt that pins it to a file glob, then `gh issue edit <N> --add-assignee @me --add-label "in-progress"`, then write `updates/<N>/execution.md` listing Active / Queued / Completed streams.

The agent prompt template (verbatim structure from `execute.md`) is worth noting — it is the whole isolation contract:

```
You are working on Issue #<N> in the epic worktree at: ../epic-<name>/
Your stream: <stream_name>
Your scope — files to modify: <file_patterns>

1. Read full task from: .claude/epics/<epic>/<N>.md
2. Read analysis from: .claude/epics/<epic>/<N>-analysis.md
3. Work ONLY in your assigned files
4. Commit frequently: "Issue #<N>: <specific change>"
5. Update progress in: .claude/epics/<epic>/updates/<N>/stream-<X>.md
6. If you need to touch files outside your scope, note it and wait
7. Never use --force on git operations
```

There is also an epic-wide launcher ("start the X epic") that categorises every task as Ready / Blocked / In Progress / Complete and launches agents for all Ready tasks, re-checking after each completion.

### Stage 6 — Merge and close

**Defined in:** `skill/ccpm/references/sync.md` (v2) and `ccpm/commands/pm/epic-merge.md` (v1, more detailed)

Preflight → run tests → merge `--no-ff` → push → remove worktree → delete branch (local + remote) → archive epic dir → close GitHub issues. Detailed in *Worktree model* below.

### Stage 7 — Bug loop (added in the final commit)

**Defined in:** `skill/ccpm/references/sync.md`, section "Reporting a Bug Against a Completed Issue"

A bug found while testing issue #42 becomes a new task file with a `bug_for: 42` frontmatter key, saved as `bug-42-<slug>.md`, then a GitHub issue labelled `bug,epic:<name>` whose body opens with `Fixes / follow-up to #42` so GitHub auto-links. This closes the loop that HN commenters and issue `#975` complained about (see *Gaps*).

---

## Command roster

### v2 (current `main`) — no slash commands

v2 has **zero slash commands**. `skill/ccpm/SKILL.md` carries a long `description` frontmatter field packed with natural-language trigger phrases; the harness fires the skill on intent match. The README's own trigger table:

| What you say | What happens |
|---|---|
| "I want to build X" / "let's plan X" | Brainstorming + PRD creation |
| "parse the X PRD" / "create an epic for X" | PRD → technical epic |
| "break down the X epic" | Epic decomposition into tasks |
| "sync the X epic to GitHub" | Issues created, worktree set up |
| "start working on issue N" | Analysis + parallel agents launched |
| "standup" / "what's our status" | Bash script runs instantly |
| "what's next" / "what's blocked" | Priority queue from project files |
| "close issue N" | Local + GitHub updated |
| "merge the X epic" | Tests, merge, cleanup |

The only invocable units are the **14 bash scripts** in `skill/ccpm/references/scripts/`:

| Script | Purpose | LOC |
|---|---|---|
| `status.sh` | Overall project dashboard | 42 |
| `next.sh` | Open tasks with no unmet dependencies | 61 |
| `prd-status.sh` | PRD pipeline counts | 63 |
| `blocked.sh` | Open tasks with unmet `depends_on` | 67 |
| `help.sh` | Command summary | 71 |
| `search.sh` | Grep across PRDs/epics/tasks | 71 |
| `in-progress.sh` | Active work | 74 |
| `standup.sh` | Daily standup report | 86 |
| `prd-list.sh` | List all PRDs | 89 |
| `epic-status.sh` | Task completion breakdown for one epic | 90 |
| `epic-show.sh` | Epic + its tasks | 91 |
| `epic-list.sh` | List all epics | 94 |
| `validate.sh` | Frontmatter/orphan/link integrity check | 96 |
| `init.sh` | gh auth, install `gh-sub-issue`, create labels, seed CLAUDE.md | 192 |

Total: 1,187 lines of bash.

### v1 (branch `v1`) — the 39-command `/pm:*` roster

This is the command list most third-party articles describe. All files under `ccpm/commands/`.

**Setup**

| Command | Purpose | File |
|---|---|---|
| `/pm:init` | Install deps, gh auth, create labels, seed CLAUDE.md | `ccpm/commands/pm/init.md` → `ccpm/scripts/pm/init.sh` |

**PRD**

| Command | Purpose | File |
|---|---|---|
| `/pm:prd-new` | Launch brainstorming for a new PRD | `ccpm/commands/pm/prd-new.md` |
| `/pm:prd-parse` | Convert PRD to technical implementation epic | `ccpm/commands/pm/prd-parse.md` |
| `/pm:prd-list` | List all PRDs | `ccpm/commands/pm/prd-list.md` |
| `/pm:prd-edit` | Edit an existing PRD | `ccpm/commands/pm/prd-edit.md` |
| `/pm:prd-status` | Show PRD implementation status | `ccpm/commands/pm/prd-status.md` |

**Epic**

| Command | Purpose | File |
|---|---|---|
| `/pm:epic-decompose` | Break epic into task files | `ccpm/commands/pm/epic-decompose.md` |
| `/pm:epic-sync` | Push epic + tasks to GitHub as issues | `ccpm/commands/pm/epic-sync.md` |
| `/pm:epic-oneshot` | Decompose and sync in one operation | `ccpm/commands/pm/epic-oneshot.md` |
| `/pm:epic-list` | List all epics | `ccpm/commands/pm/epic-list.md` |
| `/pm:epic-show` | Display epic and its tasks | `ccpm/commands/pm/epic-show.md` |
| `/pm:epic-status` | Epic progress breakdown | `ccpm/commands/pm/epic-status.md` |
| `/pm:epic-close` | Mark epic complete | `ccpm/commands/pm/epic-close.md` |
| `/pm:epic-edit` | Edit epic details after creation | `ccpm/commands/pm/epic-edit.md` |
| `/pm:epic-refresh` | Recompute epic progress from task states | `ccpm/commands/pm/epic-refresh.md` |
| `/pm:epic-start` | Launch parallel agents in a shared **branch** | `ccpm/commands/pm/epic-start.md` |
| `/pm:epic-start-worktree` | Launch parallel agents in a shared **worktree** | `ccpm/commands/pm/epic-start-worktree.md` |
| `/pm:epic-merge` | Merge completed epic worktree back to main | `ccpm/commands/pm/epic-merge.md` |

**Issue**

| Command | Purpose | File |
|---|---|---|
| `/pm:issue-analyze` | Identify parallel work streams for an issue | `ccpm/commands/pm/issue-analyze.md` |
| `/pm:issue-start` | Begin work with parallel agents from the analysis | `ccpm/commands/pm/issue-start.md` |
| `/pm:issue-sync` | Push local updates as GitHub issue comments | `ccpm/commands/pm/issue-sync.md` |
| `/pm:issue-show` | Display issue and sub-issues | `ccpm/commands/pm/issue-show.md` |
| `/pm:issue-status` | Check issue open/closed state | `ccpm/commands/pm/issue-status.md` |
| `/pm:issue-close` | Mark complete and close on GitHub | `ccpm/commands/pm/issue-close.md` |
| `/pm:issue-reopen` | Reopen a closed issue | `ccpm/commands/pm/issue-reopen.md` |
| `/pm:issue-edit` | Edit issue locally and on GitHub | `ccpm/commands/pm/issue-edit.md` |

**Workflow / reporting**

| Command | Purpose | File |
|---|---|---|
| `/pm:next` | Next priority issue with epic context | `ccpm/commands/pm/next.md` |
| `/pm:status` | Overall project dashboard | `ccpm/commands/pm/status.md` |
| `/pm:standup` | Daily standup report | `ccpm/commands/pm/standup.md` |
| `/pm:blocked` | Show blocked tasks | `ccpm/commands/pm/blocked.md` |
| `/pm:in-progress` | List work in progress | `ccpm/commands/pm/in-progress.md` |

**Sync / maintenance**

| Command | Purpose | File |
|---|---|---|
| `/pm:sync` | Full bidirectional sync with GitHub | `ccpm/commands/pm/sync.md` |
| `/pm:import` | Import existing GitHub issues into the PM system | `ccpm/commands/pm/import.md` |
| `/pm:validate` | Check system integrity | `ccpm/commands/pm/validate.md` |
| `/pm:clean` | Archive completed work (`--dry-run` supported) | `ccpm/commands/pm/clean.md` |
| `/pm:search` | Search across all content | `ccpm/commands/pm/search.md` |
| `/pm:help` | Concise command summary | `ccpm/commands/pm/help.md` |
| `/pm:test-reference-update` | Test the task-renumbering logic used by epic-sync | `ccpm/commands/pm/test-reference-update.md` |

**Non-PM commands**

| Command | Purpose | File |
|---|---|---|
| `/context:create` | Build baseline project context docs in `.claude/context/` | `ccpm/commands/context/create.md` |
| `/context:update` | Refresh context after significant changes | `ccpm/commands/context/update.md` |
| `/context:prime` | Load context files into the current conversation | `ccpm/commands/context/prime.md` |
| `/testing:prime` | Detect test framework, write `.claude/testing-config.md` | `ccpm/commands/testing/prime.md` |
| `/testing:run` | Run tests via test-runner agent, return only essentials | `ccpm/commands/testing/run.md` |
| `/code-rabbit` | Triage CodeRabbit review comments with context awareness | `ccpm/commands/code-rabbit.md` |
| `/prompt` | Escape hatch for prompts too complex for the input box | `ccpm/commands/prompt.md` |
| `/re-init` | Regenerate CLAUDE.md with PM rules | `ccpm/commands/re-init.md` |

**v1 subagents** (`ccpm/agents/`): `parallel-worker.md`, `code-analyzer.md`, `file-analyzer.md`, `test-runner.md`.

**v1 rules** (`ccpm/rules/`): `agent-coordination.md`, `branch-operations.md`, `datetime.md`, `frontmatter-operations.md`, `github-operations.md`, `path-standards.md`, `standard-patterns.md`, `strip-frontmatter.md`, `test-execution.md`, `use-ast-grep.md`, `worktree-operations.md`.

Every command file is a Markdown prompt with `allowed-tools:` frontmatter. Deterministic commands are one-liners that shell out, e.g. `ccpm/commands/pm/blocked.md` is entirely:

```markdown
---
allowed-tools: Bash(bash ccpm/scripts/pm/blocked.sh)
---

Output:
!bash ccpm/scripts/pm/blocked.sh
```

That `allowed-tools` narrowing to a single exact command is a neat least-privilege pattern.

---

## GitHub conventions

### Labels

Created by `init.sh` with exact colors (verified against the live repo's label list):

| Label | Color | Description | Applied to |
|---|---|---|---|
| `epic` | `#0E8A16` | Epic issue containing multiple related tasks | Epic issues |
| `task` | `#1D76DB` | Individual task within an epic | Task issues |
| `epic:<name>` | (default) | Per-epic grouping label, created implicitly by `gh issue create` | Both |
| `feature` | (default) | Applied alongside `epic` | Epic issues |
| `bug` | `#d73a4a` (GitHub default) | | Bug issues from the bug-report flow |
| `in-progress` | (default) | Added by `gh issue edit --add-label` when work starts | Task issues |

Full label sets on creation:
- Epic: `--label "epic,epic:<name>,feature"`
- Task: `--label "task,epic:<name>"`
- Bug: `--label "bug,epic:<epic_name>"`

Note `epic:<name>` and `feature` are **never explicitly created** by `init.sh` — they're created implicitly on first use. `init.sh` only creates `epic` and `task`, and degrades gracefully if it lacks permission.

### Issue structure

- **Epic issue** — title `Epic: <name>`, body = `epic.md` with frontmatter stripped. Body contains a checklist of `- [ ] #<task_number>` entries.
- **Task issue** — title = the task's `name` frontmatter, body = task file with frontmatter stripped (so Acceptance Criteria, Technical Details, Effort Estimate and Definition of Done all land in the issue body).
- **Sub-issues** — real GitHub parent/child links via `gh sub-issue create --parent <epic_number>` when `yahsan2/gh-sub-issue` is installed. Otherwise the epic body's markdown task-list is the only linkage. This is the single most fragile external dependency: open issue `#1022` reports v2's `sync.md` uses the **wrong** `gh-sub-issue` syntax, and `#1024` reports a `gh issue create --json` regression.
- **Bug issue** — body opens with `Fixes / follow-up to #<original_N>` so GitHub renders an auto-link.

### Comment protocol (the agent log)

`issue-sync` posts a structured comment. Fixed section skeleton:

```markdown
## 🔄 Progress Update - <date>

### ✅ Completed Work
### 🔄 In Progress
### 📝 Technical Notes
### 📊 Acceptance Criteria Status
### 🚀 Next Steps
### ⚠️ Blockers

---
*Progress: N% | Synced at <timestamp>*
```

Duplicate-suppression is two-layer:
1. `last_sync` in `progress.md` frontmatter — if synced <5 minutes ago, confirm before proceeding.
2. An HTML marker `<!-- SYNCED: <datetime> -->` written into local files so already-posted content is not re-posted.

On close: a completion comment, then `gh issue close <N>`, then the epic body's checkbox is flipped by pulling the body down, `sed`-ing `- [ ] #<N>` → `- [x] #<N>`, and pushing it back with `gh issue edit --body-file`.

### How state is read back

**Almost entirely from local files, not from GitHub.** This is the design's defining choice.

- Every tracking script (`status.sh`, `next.sh`, `blocked.sh`, `standup.sh`, …) reads `.claude/epics/*/[0-9]*.md` and greps frontmatter. **No `gh` calls at all.** That is what makes them free and instant.
- Epic progress is computed locally: `closed_task_files / total_task_files * 100`.
- GitHub is read only for point lookups: `gh issue view <N> --json state,title,labels,body`.
- The mapping back from an issue number to a local file is the filename itself (`1234.md`), with a fallback grep for `github:.*issues/<N>` in frontmatter.
- `/pm:sync` (v1 only) is the sole bidirectional reconciler. **v2 dropped it** — there is no full re-sync in v2, so local↔GitHub divergence is unrecoverable without manual work.

### Repository safety check

Prepended to every GitHub write operation (`conventions.md` and `sync.md`):

```bash
remote_url=$(git remote get-url origin 2>/dev/null || echo "")
if [[ "$remote_url" == *"automazeio/ccpm"* ]]; then
  echo "❌ Cannot write to the CCPM template repository."
  exit 1
fi
REPO=$(echo "$remote_url" | sed 's|.*github.com[:/]||' | sed 's|\.git$||')
```

This guard exists because it actually happened, repeatedly. The upstream repo's closed-issue list is littered with **other people's epics**: `#981` "Epic: Comprehensive Invoice Management and Reimbursement System (fapiao)" (author `dohogo`), `#982`–`#990` its tasks, `#935`–`#945` a clinical-trials epic, `#1018`–`#1020` a Rust workspace epic. Users cloned the template, kept `origin` pointing at `automazeio/ccpm`, and their agents filed dozens of issues into the upstream repo. **A powerful cautionary tale for any tool that writes to a remote inferred from `git remote`.**

---

## Worktree model

### Lifecycle

| Phase | Command | Notes |
|---|---|---|
| **Create** | `git checkout main && git pull origin main` then `git worktree add ../epic-<name> -b epic/<name>` | Created at epic-sync time (step 5), not at issue-start. Always from a fresh main. |
| **Location** | `../epic-<name>/` — sibling to project root | Keeps the main checkout clean; keeps paths short. |
| **Branch** | `epic/<name>` — **one branch per epic, not per issue** | Explicit best practice in `ccpm/rules/worktree-operations.md`. |
| **Assign** | Sub-agents are told the worktree path in their prompt; `gh issue edit <N> --add-assignee @me --add-label "in-progress"` | Agents are *not* given separate worktrees. |
| **Merge** | `git merge epic/<name> --no-ff -m "Merge epic: <name>"` from main | `--no-ff` preserves epic history as a distinct topology. |
| **Cleanup** | `git worktree remove ../epic-<name>`; `git branch -d epic/<name>`; `git push origin --delete epic/<name>`; `mv .claude/epics/<name> .claude/epics/archived/` | Archive, never delete. |

### Isolation model — the key subtlety

**Isolation is per-epic, not per-agent.** All N agents working an epic share **one** worktree and **one** branch. Isolation between agents is achieved not by git but by **file-glob partitioning declared in `<N>-analysis.md`**:

```yaml
Stream A:
  Files: src/db/*      # Agent A only touches these
Stream B:
  Files: src/api/*     # Agent B only touches these
```

`ccpm/rules/agent-coordination.md` calls the analysis file "the contract". Agents commit into the same branch concurrently; because their file sets are disjoint, git never sees a conflict.

This is a pragmatic choice with a real trade-off: it is cheap (no N worktrees, no N merges) but the isolation is **advisory**. Nothing mechanically prevents an agent from writing outside its glob — only the prompt instruction "Work ONLY in your assigned files".

### Conflict handling

The stated principles (`agent-coordination.md`):

1. File-level parallelism — different files never conflict.
2. Explicit coordination when the same file is needed.
3. Fail fast — surface conflicts immediately, don't be clever.
4. **Human resolution — conflicts are resolved by humans, not agents.** "Never attempt automatic merge resolution."

Mechanisms:

- **Pre-modify check:** `git status --porcelain <file>` before touching a shared file; if dirty, sleep 30 and retry.
- **Designated owner for shared files:** types, config, `package.json` are assigned to one stream; others pull after that stream commits.
- **Coordination requests** written into `stream-A.md` under a `## Coordination Needed` heading with an ETA — an async, file-based message bus between agents.
- **Sync points:** after each commit, before starting a new file, on stream switch, every ~30 min. `git pull --rebase origin epic/<name>`; on non-zero exit, stop and report.
- **On epic merge conflict:** print the conflicted file list from `git diff --name-only --diff-filter=U`, offer three options (resolve manually / `git merge --abort` / ask for help), **preserve the worktree**, and exit 1.
- **Absolute rule, stated in four separate files:** never use `--force` in any git operation.

### The Windows/worktree hook

`ccpm/hooks/bash-worktree-fix.sh` (v1 only, 200 lines of strict POSIX `sh`) is a Claude Code pre-tool-use hook that solves a real problem: the agent's shell cwd drifts out of the worktree. It walks up from `pwd` looking for a `.git` **file** (not directory), parses `gitdir:`, confirms the resolved path contains `/worktrees/`, and if so rewrites the incoming command as `cd '<worktree_root>' && <original>`. It handles CRLF-stripped gitdir files, shell-quote escaping (`foo'bar` → `'foo'"'"'bar'`), trailing `&` background operators, and skips builtins and commands already starting with `cd`. **This is the most carefully engineered file in the whole repo** and it was dropped in v2.

---

## Feature inventory

| Feature | What it does | Where in the code (file/dir) | Depends on |
|---|---|---|---|
| Skill entry point / intent router | Long `description` frontmatter of trigger phrases; routes to one of 5 phase docs | `skill/ccpm/SKILL.md` | Agent Skills–compatible harness |
| File & frontmatter conventions | Directory layout, 4 frontmatter schemas, datetime rule, sed patterns, naming, label list, progress formula | `skill/ccpm/references/conventions.md` | — |
| Guided PRD brainstorming | 5 mandatory questions before writing; quality gates against placeholder text | `skill/ccpm/references/plan.md` | LLM |
| PRD → Epic parsing | Produces technical epic with architecture decisions; ≤10 task guidance | `skill/ccpm/references/plan.md` | Existing PRD file |
| Epic → Task decomposition | Numbered task files with `depends_on` / `parallel` / `conflicts_with`; size-based batching | `skill/ccpm/references/structure.md` | Existing epic.md, Task tool |
| Dependency graph metadata | `depends_on`, `parallel`, `conflicts_with` arrays; circular-dep check | `skill/ccpm/references/structure.md` | — |
| Frontmatter strip for GitHub bodies | `sed '1,/^---$/d; 1,/^---$/d'` | `conventions.md`, `sync.md`, v1 `ccpm/rules/strip-frontmatter.md` | sed |
| Epic sync to GitHub | Epic issue + task sub-issues + file rename + frontmatter update + worktree + mapping file | `skill/ccpm/references/sync.md` | `gh`, optional `gh-sub-issue` |
| Task renumbering to issue IDs | `001.md` → `1235.md`, rewrites dependency arrays to real issue numbers | `sync.md` step 3; v1 `ccpm/commands/pm/test-reference-update.md` | sed, mv |
| GitHub issue mapping index | `github-mapping.md` — issue → URL | `sync.md` step 6 | — |
| Repository safety check | Refuses writes when `origin` is the template repo | `conventions.md`, `sync.md`, `scripts/init.sh` | git remote |
| Parallel stream analysis | `<N>-analysis.md` with streams, file globs, coordination points, conflict risk, timeline | `skill/ccpm/references/execute.md` | LLM, gh issue view |
| Parallel agent launch | One sub-agent per ready stream, scoped by file glob, with a fixed 7-rule prompt | `skill/ccpm/references/execute.md`; v1 `ccpm/agents/parallel-worker.md` | Task/subagent tool |
| Dependency-aware queueing | Streams with unmet deps queued; launched as deps complete | `execute.md`; `ccpm/commands/pm/epic-start.md` | — |
| Epic-wide launcher | Categorises all tasks Ready/Blocked/InProgress/Complete, launches all Ready | `execute.md` "Starting a Full Epic" | Synced epic |
| Per-stream progress files | `updates/<N>/stream-<X>.md` with status frontmatter | `execute.md`, `conventions.md` | — |
| Execution status tracker | `updates/<N>/execution.md` and `epic/execution-status.md` — Active/Queued/Completed | `execute.md` | — |
| Progress comment sync | Structured 6-section GitHub comment + dedup markers | `sync.md` "Issue Sync" | `gh` |
| Issue close + epic checkbox flip | Closes issue, flips `- [ ] #N` → `- [x] #N` in epic body, recomputes progress | `sync.md` "Closing an Issue" | `gh`, sed |
| Epic merge + cleanup | Test detect/run, `--no-ff` merge, worktree remove, branch delete, archive, close issues | `sync.md`; v1 `ccpm/commands/pm/epic-merge.md` | git, gh |
| Multi-language test detection | 13 build systems: npm, maven, gradle, composer, dotnet, cargo, go, bundler, flutter, swift, ctest, make | `ccpm/commands/pm/epic-merge.md` §2 | — |
| Bug report loop | `bug_for:` frontmatter, `bug-<N>-<slug>.md`, auto-linked GitHub bug issue | `skill/ccpm/references/sync.md` | `gh` |
| Agent coordination protocol | Pre-modify `git status` check, designated shared-file owner, `## Coordination Needed` blocks | `ccpm/rules/agent-coordination.md`; condensed into `execute.md` | git |
| Worktree lifecycle rules | Create/work/merge/prune/force-remove recipes + 5 best practices + 3 failure recoveries | `ccpm/rules/worktree-operations.md` | git |
| Worktree cwd-drift hook | POSIX sh pre-tool-use hook rewriting commands to `cd '<worktree>' && …` | `ccpm/hooks/bash-worktree-fix.sh` (v1 only) | Claude Code hooks |
| 14 zero-token tracking scripts | status, standup, next, blocked, in-progress, search, validate, epic-*, prd-* | `skill/ccpm/references/scripts/*.sh` | bash, grep, sed |
| Project init | gh auth, install `gh-sub-issue`, create labels, seed CLAUDE.md, safety check | `skill/ccpm/references/scripts/init.sh` | `gh` |
| State validation | Frontmatter consistency, orphaned files, missing GitHub links, dependency integrity | `skill/ccpm/references/scripts/validate.sh` | bash |
| Project context subsystem | `.claude/context/` baseline docs, refresh, prime-into-conversation | `ccpm/commands/context/*.md` (v1 only) | LLM |
| Test-runner agent | Runs tests, logs verbose output to file, returns only essentials | `ccpm/agents/test-runner.md` (v1 only) | Task tool |
| File-analyzer agent | Summarises verbose files to protect main context | `ccpm/agents/file-analyzer.md` (v1 only) | Task tool |
| Code-analyzer agent | Bug hunting across the codebase | `ccpm/agents/code-analyzer.md` (v1 only) | Task tool |
| CodeRabbit triage | Accepts real bugs/security/leaks, ignores context-unaware style nits | `ccpm/commands/code-rabbit.md` (v1 only) | CodeRabbit |
| Bidirectional GitHub sync | Full local↔GitHub reconciliation | `ccpm/commands/pm/sync.md` (v1 only — **removed in v2**) | `gh` |
| GitHub issue import | Pull existing issues into the local PM system | `ccpm/commands/pm/import.md` (v1 only — **removed in v2**) | `gh` |
| Archive / clean | `--dry-run` archival of completed work | `ccpm/commands/pm/clean.md` (v1 only) | — |
| Least-privilege command tools | `allowed-tools: Bash(bash ccpm/scripts/pm/blocked.sh)` pins one exact command | every `ccpm/commands/pm/*.md` (v1) | Claude Code |
| Path standards linter | Checks/fixes path conventions across command files | `ccpm/scripts/check-path-standards.sh`, `fix-path-standards.sh` (v1) | bash |

---

## UX and interaction design

**There is no UI.** ccpm is a conversational surface plus a terminal. Everything the user "sees" is either LLM chat output or ASCII from a bash script.

**v1 interaction design: explicit verbs.** `/pm:prd-new`, `/pm:epic-sync`, `/pm:issue-start 42`. Discoverable (`/pm:help`), predictable, and each command declares its `allowed-tools`. Cost: 39 commands to learn, and Claude Code's own command-registration changes broke them (issue `#971`: "Can no longer get the /pm: commands to function after updating to CC v2.0.10").

**v2 interaction design: intent detection.** The user says "sync the payment epic" and the harness matches `SKILL.md`'s description. Gains portability across six harnesses and removes the learning curve. Loses determinism — there is no longer a way to say "definitely run exactly this". This trade is the project's biggest open UX question and there is **no substantial public reaction to it that I could find** (v2 shipped 2026-03-18; all the reviews and HN discussion predate it).

Consistent design signatures worth noting:

- **Every operation ends with a suggested next command.** "✅ PRD created … Ready to create technical epic? Say: parse the `<name>` PRD". The workflow is a guided rail, not a menu. This is genuinely good UX and cheap to copy.
- **Emoji-keyed status vocabulary,** used identically everywhere: ✅ done, 🔄 in progress, ⏸ queued/blocked, ❌ error, ⚠️ warning, 📊 summary, 💡 suggestion. It gives grep-able, scannable terminal output.
- **Fixed output blocks.** Both scripts and LLM responses emit a fixed skeleton (e.g. the 6-section progress comment), so output is diffable and parseable.
- **Fail-fast with a remedy.** Errors are always `❌ <what> + <exact command to fix it>`. E.g. "❌ No tasks to sync. Decompose the epic first."
- **Preflight checks are silent.** `context/prime.md` explicitly instructs: don't narrate preflight progress, just do them.
- **Progressive disclosure in v2.** `SKILL.md` is ~80 lines; the harness only loads the one phase reference doc it needs. This keeps the always-resident context small — a deliberate token-budget design.

---

## Architecture

```
                                 ┌───────────────────────────────┐
   HUMAN ──── natural language ──▶│   Agent harness (Claude Code, │
     ▲                            │   Codex, Factory, Amp, …)     │
     │  suggested next command    └───────────────┬───────────────┘
     │                                            │ intent match on
     │                                            │ SKILL.md description
     │                                            ▼
     │                            ┌───────────────────────────────┐
     │                            │  skill/ccpm/SKILL.md (router) │
     │                            └───────────────┬───────────────┘
     │                    ┌───────────────────────┼───────────────────────┐
     │                    │ reasoning path        │                       │ deterministic path
     │                    ▼                       ▼                       ▼
     │        ┌───────────────────────┐  ┌────────────────┐   ┌────────────────────────┐
     │        │ references/plan.md    │  │ execute.md     │   │ references/scripts/*.sh│
     │        │ structure.md          │  │ (agent launch) │   │ status/standup/next/   │
     │        │ sync.md               │  └───────┬────────┘   │ blocked/validate/…     │
     │        └───────────┬───────────┘          │            │  ZERO tokens, no gh    │
     │                    │                      │            └───────────┬────────────┘
     │                    │                      │                        │ reads only
     │                    ▼                      │                        ▼
     │   ┌────────────────────────────────────────────────────────────────────────────┐
     │   │            .claude/  — LOCAL FILES ARE THE SOURCE OF TRUTH                  │
     │   │                                                                            │
     │   │   prds/<name>.md ──parse──▶ epics/<name>/epic.md ──decompose──▶ 001.md …    │
     │   │                                    │                              │        │
     │   │                                    │            (renamed on sync) ▼        │
     │   │                                    │                          1234.md      │
     │   │   epics/<name>/  <N>-analysis.md · github-mapping.md · execution-status.md  │
     │   │                  updates/<N>/{stream-A.md, progress.md, execution.md}       │
     │   └───────────────┬──────────────────────────────────────────┬─────────────────┘
     │                   │ explicit, one-way push (gh CLI)          │ point lookups only
     │                   ▼                                          ▲
     │   ┌────────────────────────────────────────────────────────────────────────────┐
     │   │                    GITHUB ISSUES — shared/team view                         │
     │   │  Epic #1234  labels: epic, epic:<name>, feature                             │
     │   │    body: - [x] #1235   - [ ] #1236   ← checkbox flipped on close            │
     │   │    └── sub-issues (gh-sub-issue ext) ─▶ #1235 labels: task, epic:<name>     │
     │   │                                          comments = agent audit log         │
     │   └────────────────────────────────────────────────────────────────────────────┘
     │                   │
     │                   ▼
     │   ┌────────────────────────────────────────────────────────────────────────────┐
     │   │   WORKTREE  ../epic-<name>/   on branch  epic/<name>   (ONE per epic)       │
     │   │                                                                            │
     │   │    Agent A ── src/db/*    ─┐                                                │
     │   │    Agent B ── src/api/*   ─┼─▶ commits "Issue #1235: <desc>" ──▶ same branch │
     │   │    Agent C ── src/ui/*    ─┘   (disjoint file globs = no git conflict)      │
     │   │                                                                            │
     │   │    isolation = file-glob contract in <N>-analysis.md, NOT git               │
     │   │    conflicts ──▶ agent pauses, reports, HUMAN resolves. never --force.      │
     │   └───────────────────────────────┬────────────────────────────────────────────┘
     │                                   │ git merge --no-ff  +  worktree remove
     │                                   │ + branch delete + archive + close issues
     └───────────────────────────────────▼─────────  main  ────────────────────────────
```

Three architectural commitments, all stated explicitly in the README:

1. **Local files first.** Every operation works on disk for speed; GitHub sync is explicit and controlled, never automatic.
2. **No GitHub Projects API.** Deliberately avoided as complexity; only Issues, labels, and comments are used.
3. **Worktrees for git isolation**, file-globs for agent isolation.

---

## Notable code worth stealing

Ranked by value to us.

### 1. `skill/ccpm/references/scripts/next.sh` + `blocked.sh` — the dependency-aware ready/blocked queue

**What:** Walks `.claude/epics/*/[0-9]*.md`, parses `status`, `depends_on`, `parallel` from frontmatter, and partitions tasks into "ready to start" (open, no unmet deps) vs "blocked" (open, with unmet deps, listing which specific deps are still open).
**Why good:** 61 and 67 lines respectively for a genuinely useful scheduling primitive. Zero LLM cost, instant, deterministic. The whole "what should I do next" question answered by grep. It is also the correct *shape* of answer — not a list of everything, but a filtered actionable set.
**Port difficulty: Easy.** This is 30 lines of Node with `fs.readdirSync` + a frontmatter regex. No bash needed. Lands naturally as an Express route.

### 2. `skill/ccpm/references/conventions.md` — the frontmatter schema contract

**What:** Four YAML frontmatter schemas (PRD / Epic / Task / Progress) with enumerated status values, plus the progress formula, plus the naming rules, all in one 165-line file that every phase doc is told to read first.
**Why good:** It is the data model, written once, in the place the LLM will actually read it. Our Ticket section currently has prompts (`server/prompts/ac.md`, `tests.md`, `design-plan.md`) but no single normative schema document. Having one file that is *the* contract is a pattern, not just a file.
**Port difficulty: Easy.** It is documentation. Adopt the *practice*.

### 3. Task-file renaming to issue number (`sync.md` step 3)

**What:** After creating GitHub issues, rename `001.md` → `1235.md` and rewrite every `depends_on`/`conflicts_with` entry from sequential to real issue numbers.
**Why good:** The filename *becomes* the primary key. No index table, no join, no drift. `.claude/epics/*/1235.md` resolves issue #1235 in one glob. Elegant and very cheap.
**Port difficulty: Easy.** Trivial in Node. The subtlety is the atomic two-phase rewrite (build the full old→new map first, then rewrite bodies, then rename) — get that order wrong and you corrupt dependency arrays.

### 4. Sync dedup: `last_sync` frontmatter + `<!-- SYNCED: <datetime> -->` markers

**What:** Two-layer guard against posting duplicate progress comments — a timestamp check (<5 min → confirm) and an in-file HTML marker recording what has already been pushed.
**Why good:** Idempotent push to an append-only remote log is a real problem, and this is the cheapest correct solution. Directly applicable to our Delivery section's JIRA comment posting.
**Port difficulty: Easy.**

### 5. Repository safety check (`conventions.md` / `sync.md` / `init.sh`)

**What:** Refuse any remote write when `git remote get-url origin` matches the template repo; derive `REPO` by sed-ing the remote URL.
**Why good:** Not for the specific string, but for the *principle*: a tool that writes to a remote inferred from local git config must validate that inference before writing. ccpm learned this the expensive way — dozens of strangers' epics are permanently filed in the upstream repo. We infer repos from disk in exactly the same way.
**Port difficulty: Easy.** Should be a guard in `server/eng.mjs` before any `gh` write path (`/api/eng/pr/:num/comment`, `/api/eng/ticket/:key/transition`).

### 6. `skill/ccpm/references/execute.md` — the parallel stream analysis artifact

**What:** `<N>-analysis.md` — a structured document naming each stream, its file globs, its start condition, its dependencies, plus coordination points, conflict risk, and a computed before/after timeline with an efficiency percentage.
**Why good:** This is the missing artifact between "a ticket" and "work happening". It is a *plan for parallelism*, it is human-reviewable before any agent runs, and it doubles as the isolation contract. Our Ticket section produces AC/tests/design; it does not produce a work-decomposition-with-file-scopes. That is a real gap and this is a good template for filling it.
**Port difficulty: Medium.** The artifact format is trivial; generating a *good* one needs a well-tuned prompt plus repo grounding — which we already have in `server/ticket.mjs`.

### 7. `ccpm/rules/agent-coordination.md` — the file-glob isolation contract

**What:** Advisory file-level partitioning + pre-modify `git status` check + designated owner for shared files + `## Coordination Needed` blocks as an async message bus + "conflicts are resolved by humans, never agents".
**Why good:** A coherent, honest concurrency model that admits its own limits. "Fail fast, human resolution" is the right default and is rarely stated so plainly.
**Port difficulty: Medium.** The rules are prose. Mechanising the `git status` pre-check and the shared-file ownership registry in Express is real work but not hard.

### 8. `ccpm/hooks/bash-worktree-fix.sh` (v1 only)

**What:** 200 lines of strict POSIX sh that detect a linked git worktree by parsing the `.git` *file*'s `gitdir:` pointer and checking for `/worktrees/`, then rewrite the agent's command as `cd '<root>' && <cmd>` with correct shell-quote escaping, CRLF tolerance, background-`&` preservation, and builtin skip-listing.
**Why good:** The most rigorous file in the repo. The worktree-detection routine specifically (`get_worktree_path`) is directly reusable logic — and if we ever add worktree management, we will need exactly this detection.
**Port difficulty: Medium** as a Node port of the detection logic (read `.git`, parse `gitdir:`, test for `/worktrees/`) — that part is ~20 lines. **Hard** as a behavioural hook, because we have no equivalent interception point in our architecture and would be reimplementing a Claude Code feature.

### 9. `ccpm/commands/pm/epic-merge.md` §2 — multi-language test detection

**What:** A 13-branch `if/elif` chain detecting build system by marker file (package.json → npm test, Cargo.toml → cargo test, go.mod → go test ./..., pom.xml → mvn test, and 9 more).
**Why good:** Crude but complete, and exactly the lookup table you'd otherwise write from scratch. Useful for our Runs/ProjectHub sections when we want "run this project's tests" against an arbitrary checkout.
**Port difficulty: Easy.** It is a data table; convert to a JS array of `{marker, command}`.

### 10. Least-privilege command frontmatter (v1, every `ccpm/commands/pm/*.md`)

**What:** `allowed-tools: Bash(bash ccpm/scripts/pm/blocked.sh)` — the tool grant is narrowed to one exact command string.
**Why good:** Correct security posture for agent tooling, expressed declaratively in one line. Relevant to how we scope anything agentic we add.
**Port difficulty: Easy** as a principle; **N/A** as code (Claude-Code-specific).

---

## Gaps and weaknesses

### Supply-chain incident (v1 install path)

Issue **`#1016`** (2026-02-22, reporter `athompson-hoho`, closed as completed) is a detailed disclosure that running the documented v1 installer deployed an XMRig Monero miner plus persistence. Reported indicators: a `moneroocean/` directory, a second miner disguised as `/var/tmp/systemd-logind`, four persistence hooks (crontab `@reboot`, `~/.bashrc`, `~/.profile`, and an unlabelled `ssh-ed25519` key appended to `~/.ssh/authorized_keys`), ~150% CPU and ~13 GB RAM consumed.

Facts I verified directly:
- The command used, `curl -sSL https://automaze.io/ccpm/install | bash`, **was documented in the project's own files** — `install/README.md:6`, `README.md:395`, and both Chinese README copies. The maintainer's first reply was "`https://automaze.io/ccpm/install` is not a thing" (ranaroussi), which is contradicted by the repo's own v1 docs.
- The maintainer's follow-up attributes it to the `automaze.io` URL redirecting to a malicious server (cross-referencing `#1011`) and states the GitHub-hosted script itself was never compromised. **I could not independently verify that attribution** — the domain redirect is no longer reproducible. Treat as the maintainer's account.
- The vector is genuinely gone in v2: no install script, no `automaze.io` URL anywhere in the current tree (verified by grep).

**Implication for us:** the *code* is fine to copy (MIT, plain markdown and bash, all inspectable). The *distribution channel* was the problem. Copy from the git checkout, never from any hosted installer.

### Substantiation of the headline numbers

The README claims "89% less time lost to context switching", "75% reduction in bug rates", "up to 3× faster", and a "100%" eval score vs "27.7%" baseline. There is **no methodology, dataset, harness, or raw output published anywhere in the repo** — no eval directory, no scripts, no results file. On the Show HN thread, commenter **moconnor** wrote: "These numbers are hallucinated, aka lies". The author's own reply gave a far more modest personal anecdote — clearing sessions "10-12 times daily to once or twice" (aroussi). **Verdict: marketing, unsubstantiated.** The eval table added in the final commit is self-reported with no artifacts.

### Structural / conceptual critiques (Show HN, 175 points, 112 comments)

- **Review is the bottleneck, not generation.** Multiple commenters noted a human can realistically review one change stream at a time, so N parallel agents multiply the review burden rather than throughput. **noodletheworld:** "No one I've spoken to is just sitting back writing tickets while agents do all the work".
- **Linear decomposition breaks on contact with implementation.** **tmvphil:** "Such a linear breakdown doesn't work when implementation reveals you need X' instead of X". This is the deepest critique — the PRD→epic→task waterfall assumes the plan survives, and it frequently doesn't.
- **Merge-conflict scaling.** Reported practical ceiling of ~3 parallel feature branches before conflicts become unmanageable — well below the README's "5–8 parallel tasks" and "up to 12 agents".
- **AI-authored README damaged credibility** with several commenters independently.

### Real operator complaints (upstream issue tracker)

- **`#975` "Slow workflow"** (`zacharywhitley`) — found the workflow "rigid and slow"; small fixes (style violations, syntax errors) don't fit the epic-shaped workflow, so you either build a whole epic for a typo or step outside ccpm entirely. **This is the sharpest usability critique in the whole corpus.** The bug-report flow added in the last commit is a partial answer but still produces a full task file + GitHub issue for a one-line fix.
- **`#955` "Constantly having to restart agents"** — the system reports agents running when they are not; the user has to repeatedly say "there are no running agents" to unstick it. Because "which agents are running" is tracked in a **markdown file the agent itself writes**, there is no ground truth — `execution-status.md` is a claim, not an observation. Real design flaw.
- **`#959` "PRD is too eager to proceed"** — brainstorming rushes; only the PRD *name* can be supplied up front; the wall-of-questions format is worse than one-at-a-time.
- **`#969`** — no way to resume an issue the agent got stuck on.
- **`#962`, `#967`, `#991`, `#993`, `#1001`, `#964`** — a persistent cluster of "unclear what this does / how to install / how to upgrade" issues.
- **`#973`** — zsh `$(...)` portability failures. **`#963`** — Windows PowerShell install failure.
- **`#971`** — the `/pm:*` commands stopped working after a Claude Code upgrade. Tight coupling to a fast-moving harness.
- **`#588` "Support GitLab?"** — open since 2025-09, multiple "same question" replies and a community GitLab fork; never merged. **GitHub-only is a hard constraint.**

### Current bugs in v2

Open issues **`#1022`** (sync.md uses wrong `gh-sub-issue` syntax) and **`#1024`** (`gh issue create --json` regression of the previously-fixed `#653`, plus `validate.sh` and `sync.md` disagreeing on `github-mapping.md` frontmatter) mean **the v2 sync path is currently believed broken** and has been for four months with no fix. Note also that the reference docs instruct `gh issue create --json number -q .number`, which is not a flag `gh issue create` supports — that is the `#1024` regression, and it sits in the critical path of the headline feature.

### Architectural gaps

- **No bidirectional sync in v2.** v1's `/pm:sync` and `/pm:import` were dropped. Once local and GitHub diverge (a human edits an issue, or an agent dies mid-sync), there is no reconciliation path.
- **State is self-reported.** Progress percentages, `status:` fields, and "active agents" are all written by the agent about itself. Nothing derives state from observable reality (processes, git log, CI). Directly causes `#955`.
- **No cost/token accounting**, despite spawning up to 5–12 sub-agents. Ironic for a project whose best idea is "don't spend tokens on deterministic work".
- **Advisory isolation.** Nothing enforces the file-glob contract; a misbehaving agent silently violates it.
- **No CI/test/PR integration.** ccpm merges straight to main. There is no PR creation step, no CI gate, no review workflow (issue `#1002` "PR workflows" was closed without one).
- **Frontmatter parsing is `grep | sed`.** No YAML parser. Multi-line values, quoted strings with colons, or nested structures will silently corrupt.
- **Maintenance risk.** Single maintainer, bursty cadence, four months quiet, a broken headline feature, and a prior "is this maintained?" issue.

---

## Overlap with Loush Dashboard

ccpm is the closest thing on the survey list to our Delivery/Ticket axis. The critical distinction: **ccpm is a set of prompts and shell scripts that an agent executes; Loush is a local-first React+Express application that observes and presents.** ccpm *drives* work; we *see* work. That makes most of the overlap complementary rather than competitive — but on decomposition and issue-state it is genuinely head-to-head.

| Their feature | Our equivalent section (file) | Who does it better | Note |
|---|---|---|---|
| PRD authoring via guided brainstorming | **NONE** | ccpm | We have no requirements-capture surface at all. Our pipeline starts at an existing JIRA key. Genuine gap. |
| PRD → technical epic parsing | **NONE** | ccpm | Nothing in `src/sections/` produces an architecture-decision document from a requirement. |
| Epic → task decomposition with `depends_on`/`parallel`/`conflicts_with` | Partial — **PlanGraph** (`src/sections/PlanGraph.jsx`, 364 L) visualises plan structure; **Ticket** (`server/ticket.mjs`, 1170 L) emits AC/tests/design | **ccpm, clearly.** | Our Ticket section grounds output in a real checkout — a capability ccpm lacks. But we produce *documents about one ticket*, not a *dependency-annotated task set*. Their `conflicts_with` + file-glob concept has no analogue anywhere in our codebase. Highest-value thing to take. |
| Parallel work-stream analysis (`<N>-analysis.md`) | **NONE** | ccpm | The single most novel artifact they produce. |
| GitHub Issues as source of truth | **Delivery** (`src/sections/DeliverySection.jsx` + `server/eng.mjs`) | **Loush, for reading; ccpm, for writing.** | We already shell out to `gh` (`server/eng.mjs:455` `spawnSync('gh', …)`, `ghAvailable()` at :459) and expose `/api/eng/snapshot`, `/api/eng/ci`, `/api/eng/triage`. We read PRs, CI, reviews, and JIRA — far richer than their `gh issue view`. But we do not *create* issues; they do. |
| JIRA integration | **Delivery** (`server/eng.mjs` — REST v3, `jiraAuth()` at :204, transitions at `/api/eng/ticket/:key/transition`) | **Loush, decisively.** | ccpm has none and refuses GitLab too (`#588`). Our multi-project JIRA+GitHub+CI model is strictly more capable on the tracker axis. |
| Labels (`epic`, `task`, `epic:<name>`) as the grouping mechanism | Partial — **Board** (`src/sections/BoardSection.jsx`, 438 L), epic targets at `/api/eng/epic-targets` | Even | Different models: they push labels, we consume existing ones. Their flat `epic:<name>` convention is simple and worth noting; we already have an epic-targets concept. |
| Issue comments as agent audit log | Partial — **Delivery** posts PR comments (`/api/eng/pr/:num/comment`) and JIRA comments (`/api/eng/ticket/:key/comment`) | **ccpm** | We can post; they have a *protocol* — a fixed 6-section comment format plus `last_sync` + `<!-- SYNCED -->` dedup. We have neither the format nor the idempotency guard. |
| Structured progress percentage per epic | **Board**, **Delivery** | Even | Theirs: `closed_files / total_files`, self-reported. Ours: derived from real tracker state. Ours is more trustworthy; theirs works offline. |
| Standup / next / blocked / in-progress reports | **Overview** (`src/sections/Overview.jsx`), **Inbox** (`src/sections/InboxSection.jsx`, 279 L), **Delivery** triage (`/api/eng/triage`) | **Loush** | We do this with a real UI over real tracker data. Their version is ASCII from grep. But their *ready-vs-blocked dependency partition* (`next.sh`/`blocked.sh`) is a computation we don't currently do. |
| Zero-token deterministic scripts | Our whole server is this by design (`server/*.mjs`, 9,354 L, all deterministic) | **Loush** | We arrived at the same principle more thoroughly — local-first, zero telemetry, deterministic reads. Strong philosophical alignment; nothing to take. |
| Git worktree lifecycle (create/assign/merge/cleanup) | **NONE** | ccpm | Explicitly identified as one of our three gaps. Their model — one worktree per *epic*, at `../epic-<name>`, branch `epic/<name>` — is simple and proven. |
| Parallel agent orchestration | Partial — **Runs** (`src/sections/RunsSection.jsx`, 314 L) observes runs; **Flow/Workflows** (`src/sections/FlowSection.jsx`, 195 L) | **ccpm launches; Loush observes.** | Complementary, not competing. They spawn agents and have no way to see them (hence `#955`). We read `~/.claude/projects/**/*.jsonl` and can see agent activity for real. **Our observation layer is the exact fix for their worst bug.** |
| Conflict handling between parallel agents | **NONE** | ccpm | Nothing in our codebase models concurrent-agent file contention. |
| Repo-grounded generation (read the checkout, then write) | **Ticket** (`server/ticket.mjs`, `src/sections/TicketSection.jsx` 926 L, `server/prompts/{ac,design-plan,tests}.md`) | **Loush, decisively.** | ccpm's PRD/epic generation is ungrounded — it writes from the conversation, not from the code. Our "pick a project folder, open a JIRA key, get AC/tests/design grounded in that checkout" is strictly better and is our real differentiator. |
| Project/checkout selection | **ProjectHub** (`src/sections/ProjectHub.jsx`, 411 L), **Projects** (`src/sections/ProjectsSection.jsx`) | **Loush** | ccpm has no concept of multiple projects — it is single-repo, cwd-bound. |
| Multi-language test detection & execution | Partial — **Quality**/**Runs** | **ccpm** (for the detection table only) | Their 13-marker lookup table is a useful data asset. |
| Bug loop (bug found → linked issue) | **Bugs** (`src/sections/BugsSection.jsx`), Delivery bug-ownership (`/api/eng/bug-ownership`) | **Loush** | We already model bug ownership across projects. Their `bug_for:` backlink convention is a small nice touch. |
| Context priming / project context docs | **ContextExplorer** (`src/sections/ContextExplorerSection.jsx`), **WorkingSet** (`src/sections/WorkingSet.jsx`), **Memory** (`server/memory.mjs`) | **Loush** | v1's `.claude/context/` is a cruder version of what we already do; v2 dropped it entirely. |
| Slash command roster | **NONE** (we are a dashboard, not a CLI) | N/A | Not applicable. Their v2 dropped it too. |
| Web UI | **NONE on their side** | **Loush** | ccpm's entire output surface is chat + ASCII. This is our structural advantage and the reason porting *their* ideas *into* our UI is the right direction of travel. |

**Summary judgement:** ccpm beats us on three things — requirements decomposition (PRD→epic→task with dependency metadata), parallel work-stream analysis, and worktree/parallel-agent orchestration. We beat it on everything involving reading reality: tracker integration, CI, multi-project, repo-grounded generation, transcript observation, and having a UI at all. The overlap is real but the two systems fail in opposite directions: ccpm plans richly and observes nothing; we observe richly and plan thinly.

---

## Recommended adoptions

Ranked by (value × confidence) ÷ effort.

### 1. Dependency-aware ready/blocked queue — S

**Take:** The logic of `skill/ccpm/references/scripts/next.sh` and `blocked.sh` — partition tasks into "ready" (open, no unmet deps) and "blocked" (open, with named unmet deps), plus the `depends_on` / `parallel` / `conflicts_with` frontmatter triple.
**Lands in:** `server/eng.mjs` as a new derived view over existing JIRA/GitHub data (we already have issue links and epic targets); surfaced in `src/sections/InboxSection.jsx` and `src/sections/BoardSection.jsx`.
**Unlocks:** "What can I actually start right now?" — answered from the dependency graph rather than a flat backlog. This is ~40 lines of Node against data we already fetch, and it is the highest-confidence win here.

### 2. Task decomposition with dependency + file-scope metadata — M

**Take:** `structure.md`'s task file format — specifically `depends_on`, `parallel`, `conflicts_with`, `Size: XS/S/M/L/XL`, and the ≤10-task guidance — plus `plan.md`'s two anti-bloat constraints ("prefer simplicity over completeness", "leverage existing functionality before creating new code").
**Lands in:** `server/ticket.mjs` as a fourth generator alongside `server/prompts/{ac,design-plan,tests}.md` — call it `server/prompts/decompose.md`; rendered in `src/sections/TicketSection.jsx`; graph view in `src/sections/PlanGraph.jsx`.
**Unlocks:** Our Ticket section currently ends at "here's what to build". This makes it end at "here are 6 tasks, 4 parallelisable, with these dependencies and these file scopes" — and because we generate it *grounded in the actual checkout*, our version can name real files where ccpm can only guess. **This is the single biggest capability gain available from ccpm, and it plays directly to our existing advantage.**

### 3. Parallel work-stream analysis artifact — M

**Take:** The `<N>-analysis.md` format from `execute.md` — named streams, file globs per stream, start conditions, coordination points, conflict-risk assessment, and the with/without wall-time comparison.
**Lands in:** `server/ticket.mjs` (generator) + `src/sections/PlanGraph.jsx` (visualise streams as swimlanes) + `src/sections/TicketSection.jsx`.
**Unlocks:** A reviewable plan-for-parallelism before anything runs. Combined with our repo grounding, we can validate the file globs against the actual tree — catching overlapping scopes that ccpm would only discover at merge time. Do this after #2; it depends on having tasks.

### 4. Repo-write safety guard — S

**Take:** The repository safety check pattern from `conventions.md` — validate the inferred remote before any write.
**Lands in:** `server/eng.mjs`, as a guard in front of `/api/eng/pr/:num/comment`, `/api/eng/pr/:num/request-review`, `/api/eng/ticket/:key/transition`, `/api/eng/ticket/:key/comment`.
**Unlocks:** Prevents the exact class of accident that filled ccpm's upstream tracker with strangers' epics. We infer targets from disk the same way they do; the `writes` flag in `server/eng.mjs:74` already gates writes, and this hardens it with an identity assertion rather than just a boolean.

### 5. Idempotent comment-sync protocol — S

**Take:** The fixed 6-section progress-comment format plus the two-layer dedup (`last_sync` timestamp check + `<!-- SYNCED: <datetime> -->` marker).
**Lands in:** `server/eng.mjs` comment paths; UI in `src/sections/DeliverySection.jsx`.
**Unlocks:** Safe, repeatable progress posting to JIRA/GitHub without double-posting — and a machine-parseable comment format we can later read back to reconstruct a timeline.

### 6. Worktree lifecycle management — M

**Take:** `ccpm/rules/worktree-operations.md` wholesale — one worktree per epic at `../epic-<name>` on branch `epic/<name>`, always from fresh main; plus `git worktree list` parsing, prune/force-remove recovery, and the `git merge --no-ff` + remove + delete + archive cleanup sequence. Port `get_worktree_path()` from `ccpm/hooks/bash-worktree-fix.sh` (parse the `.git` file's `gitdir:`, test for `/worktrees/`) as the detection primitive.
**Lands in:** a new `server/worktree.mjs`; surfaced in `src/sections/ProjectHub.jsx` (list/create/remove) and `src/sections/RunsSection.jsx` (which run is in which worktree).
**Unlocks:** Closes one of our three named gaps. Given we already read `~/.claude/projects/**/*.jsonl` and join to repos on disk, **showing which worktree each agent session is actually running in is something ccpm structurally cannot do** — it would fix their `#955` class of bug by observation rather than self-report. Strong differentiator. Note the Windows caveat: `git worktree` is fine on Windows, but do the detection in Node, not bash.

### 7. Multi-language test-command detection table — S

**Take:** The 13-marker detection chain in `ccpm/commands/pm/epic-merge.md` §2, as a JS array of `{marker, command}`.
**Lands in:** `server/index.mjs` or a small `server/testdetect.mjs`; used by Quality/Runs.
**Unlocks:** "Run this project's tests" against an arbitrary checkout without per-project configuration. Pure data, near-zero risk.

### 8. The "suggested next action" UX rail — S

**Take:** The convention that every completed operation ends by naming the next one ("✅ PRD created … Ready to create technical epic? Say: parse the `<name>` PRD"), plus the fail-fast error shape (`❌ <what> + <exact fix>`).
**Lands in:** `src/sections/TicketSection.jsx`, `src/sections/DeliverySection.jsx`, `src/sections/FlowSection.jsx`.
**Unlocks:** Turns a set of independent panels into a guided workflow. Cheap, purely presentational, and it is the thing that makes ccpm feel like a system rather than a toolbox.

### Explicitly do NOT adopt

- **The full PRD→epic waterfall as a mandatory gate.** Issue `#975` and HN's tmvphil both identify the same failure: it is too heavy for small work and too rigid when implementation invalidates the plan. Take the *artifacts*, not the *mandate*. Keep a path for "just fix this typo".
- **Self-reported agent execution state** (`execution-status.md`). This is their worst design flaw (`#955`). We already have ground truth in the transcripts — use it.
- **Their GitHub-issue-creation path** as currently written. `#1022` and `#1024` indicate it is broken; `gh issue create --json` is not a supported flag. Re-derive from `gh` docs rather than copying the shell verbatim.
- **Anything from a hosted installer.** Copy from a git checkout only (see the `#1016` incident).
- **The benchmark claims.** Do not cite "89%" / "3×" / "100% eval" anywhere; they are unsubstantiated.

---

## Sources

**Primary (repo, read directly from a local clone at `7d7e4623` and `af74666a^`)**
- https://github.com/automazeio/ccpm — landing page, README, LICENSE (MIT)
- `skill/ccpm/SKILL.md` — skill router and trigger description
- `skill/ccpm/references/conventions.md` — directory layout, frontmatter schemas, git/label conventions
- `skill/ccpm/references/plan.md` — PRD authoring and PRD→epic parsing
- `skill/ccpm/references/structure.md` — epic→task decomposition
- `skill/ccpm/references/sync.md` — GitHub sync, comment protocol, close, merge, bug loop
- `skill/ccpm/references/execute.md` — stream analysis, parallel agent launch, coordination rules
- `skill/ccpm/references/track.md` — script-first tracking
- `skill/ccpm/references/scripts/*.sh` — 14 scripts, 1,187 lines
- `CHANGELOG.md`, `install/README.md` (v1)
- Branch `v1` (`af74666a^`): `COMMANDS.md`, `README.md` command reference, `ccpm/commands/**` (39 `/pm:*` + 8 others), `ccpm/agents/{parallel-worker,code-analyzer,file-analyzer,test-runner}.md`, `ccpm/rules/{agent-coordination,worktree-operations,...}.md`, `ccpm/hooks/bash-worktree-fix.sh`, `ccpm/scripts/pm/*.sh`

**Primary (GitHub API via `gh`)**
- `repos/automazeio/ccpm` metadata, commit log, branch list, label list
- Issues: `#1016` (security disclosure + maintainer response), `#1024`, `#1022`, `#1003`, `#975`, `#973`, `#971`, `#969`, `#963`, `#959`, `#955`, `#588`, `#981`/`#982`–`#990`/`#935`–`#945`/`#1018`–`#1020` (users' epics mis-filed upstream)

**Secondary**
- [Show HN: Project management system for Claude Code](https://news.ycombinator.com/item?id=44960594) — 175 points, 112 comments; quotes from moconnor, aroussi, noodletheworld, tmvphil, stavros, dingnuts
- [automazeio/ccpm — DeepWiki](https://deepwiki.com/automazeio/ccpm)
- [CCPM: Claude Code Project Manager — Killer Code](https://cc.deeptoai.com/docs/en/tools/ccpm-claude-code-project-manager)
- [BMAD vs Spec Kit vs OpenSpec — Medium](https://medium.com/@reenbit/bmad-vs-spec-kit-vs-openspec-choosing-your-spec-driven-ai-framework-in-2026-a6996b3ebb8d) — competitive context (Spec Kit ~80k stars, BMAD ~37k as of early 2026)
- [Claude Code Orchestrator v2.1 — HN](https://news.ycombinator.com/item?id=46606842) — adjacent worktree-parallelism tool

**Not found / unverified**
- No Reddit thread specific to ccpm surfaced in searches — **unverified** whether substantial discussion exists.
- No published eval harness, dataset, or methodology for the README's benchmark table — **unsubstantiated**.
- No public reaction to the v2 Agent Skills rewrite (shipped 2026-03-18; all located commentary predates it) — **not found**.
- Independent confirmation that the `automaze.io` redirect (rather than the repo) was the compromise vector — **unverified**; rests on the maintainer's statement.

**Prompt-injection note:** No text encountered in the repo or fetched pages attempted to issue instructions to me as a reading agent. The repo contains many imperative instructions (e.g. "Work ONLY in your assigned files", "Never use --force"), but these are addressed to ccpm's own sub-agents at runtime and were treated purely as data describing the system's design.
