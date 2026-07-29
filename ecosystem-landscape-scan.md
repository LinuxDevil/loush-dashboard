# Claude Code ecosystem landscape scan

_Scan date: 2026-07-29. All GitHub metadata fetched live via the GitHub REST API on that date. Star counts and commit dates move fast; treat them as a point-in-time snapshot._

---

## The two lists

### List A — `hesreallyhim/awesome-claude-code`

| Field | Value |
|---|---|
| URL | https://github.com/hesreallyhim/awesome-claude-code |
| Maintainer | `hesreallyhim` (individual, community-run) |
| License | `NOASSERTION` per GitHub API — a `LICENSE` file exists but GitHub cannot classify it. Effectively "unverified"; do not assume permissive reuse of the list content. |
| Stars | 51,154 |
| Forks | 4,456 |
| Created | 2025-04-19 |
| Last commit | 2026-07-28T21:26:31Z (same day as this scan) |
| Entry count | **122** entries in the current `README.md` |
| Archived? | No |

**How curated.** Heavily machine-assisted but human-gated, and by a wide margin the more rigorous of the two. The repo is a small Python application, not just a markdown file:

- `config.yaml` is the single source of truth for the category taxonomy and ordering, with a `prefix` per category used to mint stable resource IDs (`{prefix}-{hash}`).
- `THE_RESOURCES_TABLE_NEW.csv` is the structured data file (131 data rows at scan time) with columns: `ID, Display Name, Category, Sub-Category, Link, Author Name, Author Link, Active, Date Added, Last Checked, Description, Stale`.
- `generate_readme.py` + `templates/README.template.md` regenerate the README from the CSV; entries sort alphabetically by display name within a category.
- Submissions arrive through a GitHub issue form (`.github/ISSUE_TEMPLATE/recommend-resource.yml`), whose category dropdown is auto-synced from `config.yaml` by `scripts/sync_issue_form.py`. Workflows validate, format, and open PRs (`resources/create_resource_pr.py`, `.github/workflows/validate-new-issue.yml`).
- A "repo ticker" pipeline (`ticker/fetch_repo_ticker_data.py`) periodically refreshes stars/last-commit and renders SVG badges.
- Descriptions are long, opinionated, and evaluative — they read like a reviewer actually installed the thing. Many call out engineering quality, test counts, and security posture explicitly.

**Important caveat: this is a relaunched list.** The README states the current iteration was launched to highlight resources that were _not_ on the previous iteration. Its own words, attributed to the README: "legacy resources will be migrated to the new format." The pre-relaunch list is frozen under `README_ALTERNATIVES/` (`README_CLASSIC.md`, `README_AWESOME.md`, `README_EXTRA.md`, `README_FLAT_ALL_AZ.md`), pinned to legacy commit `29755104e1f1`. **The 122 current entries are therefore not the full historical list.** The archived `README_CLASSIC.md` alone yields ~201 additional parseable entries (older taxonomy: Agent Skills, Workflows & Knowledge Guides, Tooling, Status Lines, Hooks, Slash-Commands, CLAUDE.md Files, Alternative Clients, Official Documentation). Anything you remember seeing on this list months ago and cannot find today is probably in the archive, not deleted.

**Category taxonomy (current, from `config.yaml`, in render order):**
Start Here · From Anthropic · Documentation, Knowledge & Learning (sub: Obsidian) · Research & Scientific Inquiry · Providers, Runtime & Integration Infrastructure · Remote Control, Notifications & Voice I/O · Alternative Clients · Status Lines · Design & UI/UX · Writing & Prose Quality · Creative Media · Infrastructure & DevOps · Security · Multi-Agent Orchestration · Skills · Memory & Context Persistence · Observability & Monitoring (subs: Session Monitors, Usage & Cost, Observability) · Linting

### List B — `jqueryscript/awesome-claude-code`

| Field | Value |
|---|---|
| URL | https://github.com/jqueryscript/awesome-claude-code |
| Maintainer | `jqueryscript` (runs scriptbyai.com) |
| License | CC0-1.0 |
| Stars | 483 |
| Forks | 488 |
| Created | 2025-07-13 |
| Last commit | 2026-07-27T17:08:50Z |
| Entry count | **598** entries |
| Homepage | https://www.scriptbyai.com/claude-code-resource-list/ |
| Archived? | No |

**How curated.** Breadth-first and lightly curated. The repo is three files: `README.md`, `LICENSE`, and a logo. There is no data file, no generator, no CSV, no validation pipeline. Entries are one-liners in a fixed shape: `- [**name**](url) - (N ⭐) - description`. The list carries a dated `Changelog` section (most recent: July 28, 2026 — "Added 16 Agent Skills and related Claude Code resources") and is sorted by star count descending within each category. `Contribution Guidelines` reads, attributed to the README, "**Under Construction**".

**Two accuracy caveats, both self-declared.** The README states, attributed: "Star counts are static and represent the numbers at the time the resource was recorded." So the star figures in list B are stale by construction. Second, the list contains at least one genuine duplicate-under-two-orgs (`codeburn` listed at both `getagentseal/codeburn` and `AgentSeal/codeburn` with identical text) and at least one entry whose label and URL disagree (`opensync` pointing at `LKbaba/Claude-code-ChatInWindows`). Treat descriptions as unverified.

**Category taxonomy:**
Official Resources · Agents & Orchestration · Agent Skills · Claude Plugins · Tools & Utilities · IDE & Editor Integrations · Clients & GUIs · Infrastructure & Proxies · Usage & Observability · SDKs & Development Kits · Guides & Learning · Alternatives to Claude Code

### Overlap

Deduplicating by normalised GitHub URL across both current READMEs:

| Measure | Count |
|---|---|
| Unique projects across both lists | **690** |
| List A only | 105 |
| List B only | 555 |
| On both lists | 30 |

The 4.3% overlap is the headline. These two lists are almost disjoint. List A is a deep, reviewed sample of ~120 things; list B is a broad index of ~600. Reading only one of them gives you a badly skewed picture of the ecosystem — which is exactly why this scan was worth doing.

**Coverage of our already-researched set.** Of the 19 projects flagged as under separate research, 13 appear somewhere in these lists (see the `In our research set?` column below). Notably **absent from both lists**: `ek33450505/claude-code-dashboard` (CAST), `Stargx/claude-code-dashboard`, `yahav10/claude-code-dashboard`, `ciscoittech/claude-agent-framework`, `dlowenth/claude-code-build-framework`, and "Claude Code Builder". That is a meaningful signal: several of the dashboards we are deep-diving have no curated-list presence at all, so the curators either have not seen them or did not rate them.

How the lists rate the ones they do carry:
- `hoangsonww/Claude-Code-Agent-Monitor` — list A, **Observability & Monitoring / Session Monitors**. Given a full evaluative writeup; list A calls out that it keeps data local (loopback-only). This is the strongest placement any of our researched dashboards gets.
- `siteboon/claudecodeui` — on **both** lists (A: Alternative Clients; B: Clients & GUIs).
- `SergKam/FlyCrys`, `nimbalyst/nimbalyst` — list A, Alternative Clients.
- `anthropics/claude-code-action`, `anthropics/claude-code-security-review` — both lists, under the official/Anthropic buckets.
- `phuryn/claude-usage` — list B only, Usage & Observability, 1.8k ⭐ (stale count).
- `uppinote20/claude-dashboard` — list B only, Claude Plugins.
- `SuperClaude_Framework`, `automazeio/ccpm`, `mksglu/claude-context-mode`, `numman-ali/openskills` — list B only, Tools & Utilities / Agent Skills.
- "manifest" matched `mnfst/manifest` in list B, but that is a backend framework and is almost certainly a **false positive** against whatever "manifest" our research set means. Flagging rather than asserting.

---

## Full inventory

690 unique entries, deduplicated across both current READMEs by normalised URL. `A:` prefix = present in list A (hesreallyhim) under that category; `B:` = list B (jqueryscript). Rows showing both were on both lists. Descriptions are the lists' own words, trimmed and de-marked-up; they are **not** independently verified except for the 15 profiled below.

Note: this table covers the two **current** READMEs. It does not include the ~201 additional entries frozen in list A's `README_ALTERNATIVES/README_CLASSIC.md` archive.

| Category | Project | URL | One-line | In our research set? |
|---|---|---|---|---|
| A: Alternative Clients | Cate | https://github.com/0-AI-UG/cate | A cross-platform desktop IDE built on an infinite zoomable canvas, where editors, terminals, browsers, and docs float in freeform space instead of tabs — and ships skills that let Claude... | No |
| A: Alternative Clients | Claude Overlay | https://github.com/shengyanlin/claude-overlay | A frameless, always-on-top floating chat window for Claude Code on Windows. It captures every monitor and lets Claude read the screen to answer questions in context, and drives the user's... | No |
| A: Alternative Clients | FlyCrys | https://github.com/SergKam/FlyCrys | A native Linux GUI for Claude Code agents built in Rust + GTK4 — single binary, no Electron, starts in under a second — with a file tree, syntax-highlighted viewer, markdown preview, embe... | Yes |
| A: Alternative Clients | Nimbalyst | https://github.com/nimbalyst/nimbalyst | A visual workspace for building with Claude Code (and Codex) where you and the agent co-edit *visually* — markdown, mockups, mermaid, Excalidraw, CSV, and data models — approving the agen... | Yes |
| A: Alternative Clients | Sidekick for Max | https://github.com/cesarandreslopez/sidekick-for-claude-max | A VS Code extension and standalone terminal dashboard that adds visibility and AI conveniences on top of your Claude Max subscription — inline completions, code transforms, AI commit mess... | No |
| A: Alternative Clients | Vibeyard | https://github.com/elirantutia/vibeyard | A cross-platform desktop IDE that wraps Claude Code sessions with a swarm mode (parallel agents in a grid), a real-time session inspector (cost, tokens, tool-usage, context), multiple iso... | No |
| A: Alternative Clients &middot; B: Clients & GUIs | CloudCLI (Claude Code UI) | https://github.com/siteboon/claudecodeui | A web and mobile PWA for driving Claude Code (and Cursor/Codex/Gemini) from any device — file explorer, git, integrated shell, and full session management that reads and writes your real... | Yes |
| A: Creative Media | capcut-cli | https://github.com/renezander030/capcut-cli | A zero-dependency Node CLI (and Claude Code plugin/skill) that lets the agent edit CapCut / JianYing video projects programmatically — inspect timelines, build drafts, add text/audio, wor... | No |
| A: Creative Media | motion-skills | https://github.com/iart-ai/motion-skills | An open-source collection of ~50 motion-graphics, animation, and video skills across 14 installable packs — kinetic typography, data-driven charts, explainers, TikTok/Reels, web/WebGL ani... | No |
| A: Creative Media | Vox director skill | https://github.com/Alisa0808/vox-director | Vox Director is an open-source skill that turns a one-line topic into a finished Vox-style paper-collage explainer or ad video. It automates the full pipeline — script, collage keyframes,... | No |
| A: Creative Media &middot; B: Tools & Utilities | claude-replay | https://github.com/es617/claude-replay | An outstanding, creative library that converts Claude Code session transcripts into self-contained, embeddable HTML replays - interactive playback with speed control, a local editor, coll... | No |
| A: Design & UI/UX | Snip | https://github.com/rixinhahaha/snip | A visual whiteboard between you and your agent: Claude renders diagrams, HTML, or UI components through Snip instead of describing them in text, you approve or annotate directly on the ou... | No |
| A: Design & UI/UX | StyleSeed | https://github.com/bitjaru/styleseed | A design engine that takes a different tack from "feed the model more tokens": it teaches design *judgment* — ~74 rules pros carry but never write down ("the refined black isn't #000, it'... | No |
| A: Design & UI/UX | UI Craft | https://github.com/educlopez/ui-craft | A deep design-engineering skill that makes agents "design like they have taste" by default, layered so you can just install it, drive it with 22 single-lens commands, or wire its determin... | No |
| A: Design & UI/UX &middot; B: Agent Skills | Dev Browser | https://github.com/SawyerHood/dev-browser | A browser-automation plugin/skill that lets Claude Code drive a browser to test and verify its own work — full Playwright API plus pixel- and DOM-level computer-use toolsets, connecting t... | No |
| A: Documentation, Knowledge & Learning | Bloom | https://github.com/Li-Evan/Bloom | A self-contained Claude Code skill that turns Benjamin Bloom's "2-sigma" tutoring research into a personal AI tutor: it generates a structured syllabus, teaches one lesson at a time, and... | No |
| A: Documentation, Knowledge & Learning | cc-thinking-skills | https://github.com/tjboudreaux/cc-thinking-skills | A collection of installable thinking-framework skills with a meta-router, notable for publishing a replication-gated evaluation instead of unsupported quality claims. | No |
| A: Documentation, Knowledge & Learning | claude-code-android | https://github.com/ferrumclaudepilgrim/claude-code-android | A thorough, device-tested guide and toolkit for running Claude Code natively on Android via three paths (Termux, proot-Ubuntu, and the Android Virtualization Framework), with a verificati... | No |
| A: Documentation, Knowledge & Learning | cxpak | https://github.com/Barnett-Studios/cxpak | A code-intelligence Claude Code plugin and MCP server (Rust, single binary, 43 languages) that builds a typed dependency graph and packs token-budgeted, annotated context bundles for any... | No |
| A: Documentation, Knowledge & Learning | Dive into Claude Code | https://github.com/VILA-Lab/Dive-into-Claude-Code | A research-lab systematic analysis of the Claude Code codebase whose headline finding — overwhelmingly infrastructure rather than model — reframes Claude Code as a harness. | No |
| A: Documentation, Knowledge & Learning | MDXG Redline | https://github.com/oubakiou/mdxg-redline | A Claude Code skill plus single-file HTML tool that closes the human-review loop on AI-written docs: a person leaves inline comments in the browser, which export as structured JSON keyed... | No |
| A: Documentation, Knowledge & Learning | NotebookLM MCP | https://github.com/roomi-fields/notebooklm-mcp | A mature MCP server (plus a 33-endpoint REST API) that drives Google NotebookLM for citation-backed Q&A and full Studio generation (audio, video, infographics, reports), with multi-accoun... | No |
| A: Documentation, Knowledge & Learning | RAG Learning Academy | https://github.com/TakaGoto/rag-learning-academy | A multi-agent Claude Code learning environment for mastering Retrieval-Augmented Generation, with 20 specialist agents, 22 slash commands, and a 9-module hands-on curriculum that runs zer... | No |
| A: Documentation, Knowledge & Learning | showreel | https://github.com/HeyRenan/showreel | A Claude Code plugin that turns CSS selectors + text into finished visual documentation — annotated screenshots, flow GIFs/MP4s, terminal recordings, and before/after composites — placing... | No |
| A: Documentation, Knowledge & Learning / Obsidian | agentcairn | https://github.com/ccf/agentcairn | Long-term, cross-project memory for AI coding agents. Your own Obsidian vault as the source of truth. Daemonless and without opaque databases, your memory belongs to you. | No |
| A: Documentation, Knowledge & Learning / Obsidian | Bedrock | https://github.com/iurykrieger/claude-bedrock | A Claude Code plugin that turns an Obsidian vault into a structured second brain via 8 skills, building an entity-typed (actors/people/teams/topics…) Zettelkasten graph with bidirectional... | No |
| A: Documentation, Knowledge & Learning / Obsidian | Librarian | https://github.com/ngmeyer/librarian-mcp | A standalone MCP server that gives Claude a markdown second-brain over any Obsidian vault or folder of `.md` files, with trigram search, auto-wikilinks on write, and real graph analytics... | No |
| A: Documentation, Knowledge & Learning / Obsidian &middot; B: Tools & Utilities | claude-obsidian | https://github.com/AgriciDaniel/claude-obsidian | Self-organizing AI second brain for Obsidian + Claude Code. Claude reads any source, links it, and files it into one connected knowledge graph of plain Markdown. Based on Karpathy's LLM W... | No |
| A: From Anthropic | Building Effective Agents | https://www.anthropic.com/research/building-effective-agents | Anthropic's foundational taxonomy of agent patterns — prompt chaining, routing, orchestrator-workers, and evaluator-optimizer — and when to use each. | No |
| A: From Anthropic | Claude Code Best Practices | https://code.claude.com/docs/en/best-practices | Anthropic's canonical guide to working effectively with Claude Code: the agentic-loop mental model, CLAUDE.md guidance, and workflow patterns. | No |
| A: From Anthropic | Claude Code Cheatsheet | https://support.claude.com/en/articles/14553413-claude-code-cheatsheet | Anthropic's official Claude Code cheatsheet — a quick reference for the core vocabulary (session, context window, CLAUDE.md), built-in slash commands, and keyboard shortcuts. | No |
| A: From Anthropic | Effective Context Engineering for AI Agents | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | Anthropic's guide to curating the context window — compaction, just-in-time retrieval, and note-taking — the discipline underlying effective long-horizon agent use. | No |
| A: From Anthropic | How Claude Code Works | https://code.claude.com/docs/en/how-claude-code-works | The official conceptual explainer of Claude Code's agentic loop, tools, and context window, and how skills, hooks, and subagents layer on top. | No |
| A: From Anthropic | How We Built Our Multi-Agent Research System | https://www.anthropic.com/engineering/multi-agent-research-system | A practical account of orchestrator and subagent coordination, prompt design, and evaluation that maps directly to Claude Code's subagents and agent teams. | No |
| A: From Anthropic | Steering Claude Code: Skills, Hooks, Rules, Subagents and More | https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more | A framework for choosing which extension mechanism to reach for, organized around deterministic-versus-probabilistic control and context isolation. | No |
| A: From Anthropic &middot; B: Official Resources | Agent Skills | https://github.com/anthropics/skills | Anthropic's official repository for Agent Skills — the SKILL.md format, a skill template, and example skills, the same format Claude Code loads natively. | No |
| A: From Anthropic &middot; B: Official Resources | Claude Code Security Review | https://github.com/anthropics/claude-code-security-review | An official AI-powered security-review GitHub Action that uses Claude to analyze pull-request diffs for vulnerabilities. | Yes |
| A: From Anthropic &middot; B: Official Resources | Official Plugin Directory | https://github.com/anthropics/claude-plugins-official | Anthropic's official, curated directory of high-quality Claude Code plugins, installable from within Claude Code. | No |
| A: From Anthropic &middot; B: Tools & Utilities | Claude Code GitHub Action | https://github.com/anthropics/claude-code-action | The official GitHub Action for running Claude Code in CI: mention @claude in issues and pull requests to delegate code changes, reviews, and fixes. | Yes |
| A: Infrastructure & DevOps | otelcol-doctor | https://github.com/s3onghyun/otelcol-doctor | A focused, vendor-neutral skill that writes, fixes, and *validates* OpenTelemetry Collector configs — encoding the Collector's real footguns (memory_limiter/batch ordering, core-vs-contri... | No |
| A: Infrastructure & DevOps &middot; B: Agent Skills | terraform-skill | https://github.com/antonbabenko/terraform-skill | A best-practices skill that teaches the agent to write safer Terraform and OpenTofu through a diagnose-first workflow, failure-mode routing, LLM-mistake checklists, and a feature-version... | No |
| A: Linting | agents-md-cookbook | https://github.com/Taiizor/agents-md-cookbook | The tested, tool-agnostic AGENTS.md kit — verified templates, a CI linter, and migrators from .cursorrules/CLAUDE.md/Copilot/Windsurf/Cline/Aider. | No |
| A: Linting | agnix | https://github.com/agent-sh/agnix | The linter and LSP for AI coding assistants — validates CLAUDE.md, AGENTS.md, SKILL.md, hooks, and MCP config, with autofixes and IDE plugins. | No |
| A: Linting | BlockWatch | https://github.com/mennanov/blockwatch | A language-agnostic linter (Rust) that keeps co-dependent code, docs, and config in sync, with a Claude Code plugin skill. | No |
| A: Linting | Ctxlint | https://github.com/ctxlint/Ctxlint | A CLI linter for AI agent context files that catches stale references, dead commands, and hardcoded secrets, with a modular tested rule set. | No |
| A: Linting | Schliff | https://github.com/Zandereins/schliff | Deterministic quality scorer for AI agent instruction files — 8-dimension scoring with security, multi-format (SKILL.md, CLAUDE.md, .cursorrules, AGENTS.md), anti-gaming detection, zero d... | No |
| A: Linting | Upkeep | https://github.com/wei18/Upkeep | Upkeep — an AI audit crew for your repo. Catches docs/spec/asset drift with evidence; output-only. Claude Code plugin/skill + reusable CI workflow. | No |
| A: Memory & Context Persistence | Callimachus | https://github.com/BetaBots-LLC/callimachus | One local, searchable index of your AI coding-agent history Claude Code, Codex, Cursor, Gemini & more. Keyword + semantic search, MCP server, CLI & VS Code extension. | No |
| A: Memory & Context Persistence | capy | https://github.com/serpro69/capy | 🦫 Privacy-first virtualization layer for LLM context with MCP protocol for tool access. | No |
| A: Memory & Context Persistence | Claude Mnemonic | https://github.com/lukaszraczylo/claude-mnemonic | Memory management and retrieval for Claude Code | No |
| A: Memory & Context Persistence | fable | https://github.com/grooverLab/fable | High-fidelity transcript memory for Claude Code — index every session, recall byte-identical, search, prune, compose. Local-first, stdlib-only, MCP. | No |
| A: Memory & Context Persistence | Hivemind | https://github.com/activeloopai/hivemind | Hivemind turns your traces into reusable skills across agents | No |
| A: Memory & Context Persistence | MAMA | https://github.com/jungjaehoon-lifegamez/MAMA | Always-on companion for Claude that remembers your decisions and their evolution. Local-first memory using SQLite + transformers.js embeddings. | No |
| A: Memory & Context Persistence | presence | https://github.com/sara-star-quant/presence | Per-repo memory, outcome telemetry, and a calibrated-confidence gate for Claude Code, with MCP and AGENTS.md projections so other AI coding tools can read its context. Notes survive sessi... | No |
| A: Memory & Context Persistence | roampal-core | https://github.com/roampal-ai/roampal-core | Outcome-based persistent memory MCP server for Claude Code and OpenCode. Good advice promoted, bad advice demoted. pip install roampal. | No |
| A: Memory & Context Persistence | Selvedge | https://github.com/masondelan/selvedge | Long-term memory for AI-coded codebases. A git blame for AI agents — but for the why. MCP server that captures the agent's reasoning live, in context, as each change is made. Local SQLite... | No |
| A: Multi-Agent Orchestration | Agent Collab Skills | https://github.com/WenyuChiou/agent-collab-skills | Claude Code marketplace for multi-agent collaboration — task splitter, output reconciler, adversarial debate, shared memory, acceptance gate. Composes with codex-delegate / gemini-delegate. | No |
| A: Multi-Agent Orchestration &middot; B: Agents & Orchestration | gstack | https://github.com/garrytan/gstack | Garry Tan's (Y Combinator) Claude Code setup and "open source software factory" for managing the development lifecycle end-to-end. Includes a set of agents and in-depth skills/tools along... | No |
| A: Observability & Monitoring / Observability | agents-observe | https://github.com/simple10/agents-observe | A real-time Claude Code observability dashboard installed as a plugin: it registers hooks across the full session lifecycle (tool calls, subagent start/stop, task and permission events) a... | No |
| A: Observability & Monitoring / Observability &middot; B: Tools & Utilities | Multi-Agent Observability | https://github.com/disler/claude-code-hooks-multi-agent-observability | A real-time dashboard that captures Claude Code hook events across concurrent agents — tracing every tool call, task handoff, and lifecycle event through a Bun/SQLite/WebSocket/Vue stack,... | No |
| A: Observability & Monitoring / Observability &middot; B: Usage & Observability | Claude Code Observability Stack | https://github.com/ColeMurray/claude-code-otel | A Dockerized OpenTelemetry-to-Grafana observability stack for Claude Code that implements Anthropic's observability guidance, surfacing session activity, performance, token usage, and cos... | No |
| A: Observability & Monitoring / Session Monitors | c9watch | https://github.com/minchenlee/c9watch | A macOS menu-bar app (and companion JSON CLI, built from one Rust/Tauri binary) that auto-discovers running Claude Code sessions by scanning OS processes and shows live working / needs-at... | No |
| A: Observability & Monitoring / Session Monitors | cctop | https://github.com/stefanprodan/cctop | A live top-style terminal TUI that lists every running Claude Code session with process stats, busy/idle state, context size, model, and git branch, plus a live sub-agent and sub-process... | No |
| A: Observability & Monitoring / Session Monitors | Claude Code Agent Monitor | https://github.com/hoangsonww/Claude-Code-Agent-Monitor | A self-hosted real-time dashboard that monitors Claude Code agent activity via its native hooks — live sessions, subagent orchestration trees, tool-call timelines, and per-session status... | Yes |
| A: Observability & Monitoring / Session Monitors | Claude Status | https://github.com/gmr/claude-status | A native macOS menu-bar app with desktop widgets showing the live state of every running Claude Code session — active, waiting-for-input, compacting, or idle — across many terminals and I... | No |
| A: Observability & Monitoring / Session Monitors | claude-control | https://github.com/sverrirsig/claude-control | A native macOS Electron dashboard that auto-discovers running Claude Code CLI sessions and shows live per-session status, git changes, PR checks, and conversation previews across repos an... | No |
| A: Observability & Monitoring / Session Monitors | claude-status-bar | https://github.com/m1ckc3s/claude-status-bar | A tiny, hook-driven macOS menu-bar indicator of Claude Code's live turn status — an animated icon while thinking or running a tool, a dot when awaiting permission, and an elapsed-turn tim... | No |
| A: Observability & Monitoring / Session Monitors | so-agentbar | https://github.com/sotthang/so-agentbar | A native macOS menu-bar app that watches Claude Code and OpenAI Codex CLI session logs in real time and shows each running session's live status, tokens, and cost, with subagent grouping... | No |
| A: Observability & Monitoring / Usage & Cost | AgentWatch | https://github.com/mishanefedov/agentwatch | Local-only observability for AI agents on your machine. One timeline across coding and non-coding agents. | No |
| A: Observability & Monitoring / Usage & Cost | cc-costline | https://github.com/Ventuss-OvO/cc-costline | Enhanced statusline for Claude Code — see your 7d/30d spend at a glance | No |
| A: Observability & Monitoring / Usage & Cost | cc-probeline | https://github.com/labzink/cc-probeline | See where it leaks, stop paying for it — a live Claude Code status line that prices every turn, your subagents, cache rebuilds, plus limits, context and git. | No |
| A: Observability & Monitoring / Usage & Cost | CCDash | https://github.com/zihenghe04/CCDash | Open-source unified usage dashboard for Claude — track tokens, quota, costs across Claude Code, claude.ai & API in one panel. 开源 Claude 全平台用量监控面板，聚合 Claude Code / claude.ai / API 数据，适用于 P... | No |
| A: Observability & Monitoring / Usage & Cost | ccusage | https://github.com/ccusage/ccusage | A zero-install CLI (npx ccusage) that analyzes Claude Code token usage and cost from local JSONL logs — daily, monthly, per-session, and 5-hour-block breakdowns, a live monitoring mode, a... | No |
| A: Observability & Monitoring / Usage & Cost | ccvitals | https://github.com/educlopez/ccvitals | The prettiest statusline for Claude Code — pure bash, never blocks your prompt. Usage quota, context window, git status & more. | No |
| A: Observability & Monitoring / Usage & Cost | claude-code-status-bar | https://github.com/briansmith80/claude-code-status-bar | Configurable status bar for Claude Code: usage limits with pacing markers, context window, git state, live activity, session cost, and 8 colour themes. Pure bash, zero dependencies. | No |
| A: Observability & Monitoring / Usage & Cost | ClaudeBar | https://github.com/tddworks/ClaudeBar | A macOS menu-bar app that surfaces remaining usage quota for Claude, Codex, Gemini, Copilot, and other AI coding providers at a glance, with burn-rate, dollar-balance, and reset-countdown... | No |
| A: Observability & Monitoring / Usage & Cost | Claumon | https://github.com/fabioconcina/claumon | Claude Code dashboard for Pro/Max users: live rate-limit gauges, calibrated usage forecasts, session costs, memory browser. Single binary, zero config. | No |
| A: Observability & Monitoring / Usage & Cost | goccc | https://github.com/backstabslash/goccc | Fast, zero-dependency cost calculator and customizable statusline for Claude Code. Breakdowns by model, day, project, and branch. Lightweight, single binary, no runtime needed. | No |
| A: Observability & Monitoring / Usage & Cost | Pacer | https://github.com/EricAndrechek/Pacer | Native macOS app for tracking Claude Code usage — tokens, cost, rate-limit pacing, per-project breakdowns. SwiftUI + SwiftData. | No |
| A: Observability & Monitoring / Usage & Cost | toktrack | https://github.com/mag123c/toktrack | Ultra-fast token & cost tracker for LLM Token Usage (e.g. Claude Code) | No |
| A: Providers, Runtime & Integration Infrastructure | chrome-cdp-ex | https://github.com/EndeavorYen/chrome-cdp-ex | A zero-dependency Claude Code skill (68 commands) that connects to your *real* Chrome — logged-in tabs, cookies, live page state — to give the agent a perception layer: layout, visible st... | No |
| A: Providers, Runtime & Integration Infrastructure | claude-code-wsl2-setup | https://github.com/congmnguyen/claude-code-wsl2-setup | A focused collection of documented scripts that fix the most painful Claude Code papercuts on WSL2 + Windows Terminal — clipboard screenshot paste via a Go daemon, Windows notifications o... | No |
| A: Providers, Runtime & Integration Infrastructure | Flue | https://github.com/SFKislev/Flue | A tiny bridge that lets Claude Code drive desktop software — Photoshop, Premiere, Blender, Unity, InDesign, Office, 13 apps total — by writing one-time scripts against each app's own auto... | No |
| A: Providers, Runtime & Integration Infrastructure | llm-router | https://github.com/ypollak2/llm-router | A local-first router that sits under Claude Code (and Codex/Gemini CLI) and sends each prompt to the cheapest capable model, with three-layer token compression and automatic provider fall... | No |
| A: Providers, Runtime & Integration Infrastructure | OpenWeb | https://github.com/openweb-org/openweb | An agent-native skill that accesses 90+ websites by calling their underlying APIs directly (typed JSON in, JSON out) instead of screenshotting and parsing the DOM, with auth auto-resolved... | No |
| A: Providers, Runtime & Integration Infrastructure | SPARDA | https://github.com/zyx77550/sparda | Converts a running Express or FastAPI app into an MCP server by AST-parsing its routes and injecting a marked, byte-for-byte-removable `/mcp` router, so the agent can operate your live ap... | No |
| A: Remote Control, Notifications & Voice I/O | ai-agent-notifier | https://github.com/DevinoSolutions/ai-agent-notifier | A zero-dependency, cross-platform notifier that fires a desktop toast and a free phone push (via ntfy) the moment Claude Code (or Codex/Cursor/Gemini) finishes a task or needs input, wire... | No |
| A: Remote Control, Notifications & Voice I/O | Claude Threads | https://github.com/anneschuth/claude-threads | Streams a locally-running Claude Code session live into a Slack or Mattermost thread so a whole team can watch, type, and approve actions together — "screen-sharing for AI pair programmin... | No |
| A: Remote Control, Notifications & Voice I/O | dictate | https://github.com/vimalk78/dictate | Local, offline voice-to-text for Claude Code on Linux built on faster-whisper, with a warm daemon for instant transcription, system-wide push-to-talk, a voice-enabled editor, and per-proj... | No |
| A: Remote Control, Notifications & Voice I/O | Lockpaw | https://github.com/sorkila/lockpaw | A native-Swift macOS menu-bar app (10 MB, no Electron) that covers and input-locks your screen with one hotkey while your agents keep running, then makes the locked screen glow when Claud... | No |
| A: Remote Control, Notifications & Voice I/O | Telegram-Claude (tg-claude) | https://github.com/Imolatte/tg-claude | A feature-rich Telegram bot that turns your machine into a remote Claude Code terminal driven from your phone: streaming tool progress, voice input, a git panel, Mac remote control, and 3... | No |
| A: Remote Control, Notifications & Voice I/O | WhatsApp Channel Plugin | https://github.com/Rich627/whatsapp-claude-plugin | Connects WhatsApp as a native Claude Code channel via Baileys linked-device (no bot token or API keys), with bidirectional messaging, full media, voice transcription, remote tool approval... | No |
| A: Research & Scientific Inquiry | AI Research Skills | https://github.com/WenyuChiou/ai-research-skills | A catalog of 15 Claude Code skills mapped to 8 research-workflow stages (literature → gap analysis → design → drafting → reviewer response), where each stage emits an explicit YAML/Markdo... | No |
| A: Research & Scientific Inquiry | My Claude Code Setup | https://github.com/pedrohcgs/claude-code-my-workflow | A ready-to-fork Claude Code template for academics using LaTeX/Beamer + R. Multi-agent review, quality gates, adversarial QA, and replication protocols. Great use of orchestration pattern... | No |
| A: Security | Agent Guard | https://github.com/JeongJaeSoon/agent-guard | Real-time secret-leak guardrails for AI coding agents (Claude Code, Codex), Git hooks, and CI. | No |
| A: Security | aicontainer | https://github.com/stefanoginella/aicontainer | Sandboxed devcontainer for running Claude Code, Codex, and OpenCode in bypass / auto-approve mode. | No |
| A: Security | Airut | https://github.com/airutorg/airut | Airut is a system for running Claude Code tasks from email and Slack. It handles workspace provisioning, container isolation, network sandboxing, session persistence, and cleanup — a secu... | No |
| A: Security | authsome | https://github.com/agentrhq/authsome | Credential gateway for AI agents. Log in once via Oauth2 or API Key. Every agent stays authenticated — headless, no SaaS, agents never see your credentials. | No |
| A: Security | Brood Box | https://github.com/stacklok/brood-box | CLI tool for running coding agents inside hardware-isolated microVMs | No |
| A: Security | Claude Code Safety Guard | https://github.com/inoX-Network/claude-code-safety-guard | 3-level override system for Claude Code - prevents destructive system operations. Born from a real incident. | No |
| A: Security | Cleat | https://github.com/cleatdev/cleat | Give the agent a cage, not your keys. One-command Docker sandbox for AI coding agents: full autonomous permissions, per-project isolation, your host stays untouched. | No |
| A: Security | Code on Incus | https://github.com/mensfeld/code-on-incus | Give each AI agent its own isolated machine with root, Docker, and systemd. Active defense detects and stops threats automatically.. | No |
| A: Security | compass | https://github.com/dshakes/compass | Developer-grade Claude Code + Codex configuration: cost-tiered subagents, workflow commands, guardrail hooks, MCP parity, and an installable plugin/marketplace. | No |
| A: Security | GouvernAI | https://github.com/Myr-Aya/GouvernAI-claude-code-plugin | Runtime guardrails for Claude Code. Auto-approve what's safe, gate what's risky, block what's dangerous. Dual enforcement, full audit trail. MIT. | No |
| A: Security | machine | https://github.com/katspaugh/machine | One isolated Lima VM per GitHub project — sandboxed Claude Code/Codex, Docker, Node, signed git | No |
| A: Security | Node9 | https://github.com/node9-ai/node9-proxy | The Execution Security Layer for the Agentic Era. Providing deterministic "Sudo" governance and audit logs for autonomous AI agents. | No |
| A: Security | SkilLock | https://github.com/skills-lock/skil-lock | Pin AI Skill behavior. Block unapproved drift in CI. See exactly what changed in every PR. | No |
| A: Security &middot; B: Agent Skills | SkillSpector | https://github.com/NVIDIA/SkillSpector | Security scanner for AI agent skills. Detect vulnerabilities, malicious patterns, and security risks. | No |
| A: Security &middot; B: Claude Plugins | Claude Code Safety Net | https://github.com/kenryu42/claude-code-safety-net | A coding agent CLI hook that acts as a safety net, catching destructive git and filesystem commands before they execute. Supports Codex, Claude Code, OpenCode, Gemini CLI, Copilot CLI, Ki... | No |
| A: Skills | fable-mode | https://github.com/mrtooher/fable-mode | A Claude skill that activates Fable-style agentic behavior: explicit multi-stage planning, sub-agent delegation, and self-verification. | No |
| A: Start Here | andrej-karpathy-skills | https://github.com/multica-ai/andrej-karpathy-skills | A drop-in CLAUDE.md distilling four behavioral guidelines for LLM-assisted coding into Claude Code — a low-friction quick win. Karpathy-inspired, derived from Andrej Karpathy's public not... | No |
| A: Start Here | Claude Code Hooks: Complete Guide | https://hidekazu-konishi.com/entry/claude_code_hooks_complete_guide.html | A thorough walkthrough of every hook event, when each fires, the two return channels, common anti-patterns, and copy-ready settings.json examples. | No |
| A: Start Here | Claude Code: Everything You Need to Know | https://github.com/wesammustafa/Claude-Code-Everything-You-Need-to-Know | A conceptual, mental-models-first primer that explains what Claude Code is and how its agentic loop works, then layers setup, prompt-engineering workflows, skills, hooks, MCP, subagents,... | No |
| A: Start Here | claude-howto | https://github.com/luongnv89/claude-howto | A structured, chapter-based getting-started guide for Claude Code with a self-assessment quiz and a ten-module progressive learning path — slash commands, memory, skills, subagents, MCP,... | No |
| A: Start Here | explore-claude-code | https://github.com/LukeRenton/explore-claude-code | An interactive click-through of an annotated Claude Code project where every file and folder — CLAUDE.md, settings.json, rules, commands, skills, agents, hooks, plugins, and .mcp.json — i... | No |
| A: Start Here | Writing a Good CLAUDE.md | https://www.humanlayer.dev/blog/writing-a-good-claude-md | An essay on CLAUDE.md craft: instruction-budget reasoning, progressive disclosure, and the test of whether Claude would err without a given line. | No |
| A: Start Here &middot; B: Guides & Learning | Claude Code Guide | https://github.com/zebbern/claude-code-guide | A current single-page reference for Claude Code: install, environment variables, slash commands, MCP, hooks, and subagents, kept in sync with the official changelog. | No |
| A: Status Lines | claude-code-personalities | https://github.com/kumamaki/Claude-Code-Personalities | A delightfully different status line: 30+ kaomoji text-faces that react in real time to what Claude is doing — context-aware personas by file type, and a frustration-escalation system whe... | No |
| A: Status Lines | claudinho | https://github.com/arturogarrido/claudinho | 2026 World Cup live scores in your terminal, Claude Code statusline & MCP. No API keys. | No |
| A: Status Lines &middot; B: Usage & Observability | claude-statusbar | https://github.com/leeguooooo/claude-code-usage-bar | The most complete Claude Code status line: 5-hour and 7-day rate-limit usage with reset countdowns and *learned* end-of-window projections, context window, prompt-cache-expiry countdown,... | No |
| A: Writing & Prose Quality | naming | https://github.com/glacierphonk/naming | A Claude Code skill for naming products, SaaS tools, brands, and projects via a structured metaphor-driven process — naming brief, metaphor exploration, candidate generation, anti-slop fi... | No |
| A: Writing & Prose Quality &middot; B: Agent Skills | Avoid AI Writing | https://github.com/conorbronsdon/avoid-ai-writing | A portable writing skill that audits and rewrites prose to remove "AI-isms" — 49+ pattern categories and a tiered word-replacement vocabulary, with detect / rewrite / edit-in-place modes,... | No |
| B: Agent Skills | 9arm-skills | https://github.com/thananon/9arm-skills | Agent skills loaded by Claude Code. | No |
| B: Agent Skills | academic-humanizer | https://github.com/AIScientists-Dev/academic-humanizer | Academic writing skill for revising research text into clearer, more natural prose while preserving technical meaning. | No |
| B: Agent Skills | academic-paper-skills | https://github.com/lishix520/academic-paper-skills | Claude Code framework for planning and writing academic papers with strategist and composer skills. | No |
| B: Agent Skills | academic-research-skills | https://github.com/Imbad0202/academic-research-skills | Academic Research Skills for Claude Code: research → write → review → revise → finalize. | No |
| B: Agent Skills | Acontext | https://github.com/memodb-io/Acontext | Agent Skills used as a memory layer for context engineering and self-learning agent workflows. | No |
| B: Agent Skills | add-skill | https://github.com/vercel-labs/add-skill | Install agent skills onto your coding agents from any git repository. | No |
| B: Agent Skills | adhd | https://github.com/UditAkhourii/adhd | A skill for coding agents. Tree-of-thought with pruning, built on the Claude & Codex Agent SDK. | No |
| B: Agent Skills | advertising-skills | https://github.com/realkimbarrett/advertising-skills | Advertising Skills for Open Claw, Claude Code & AI agents. | No |
| B: Agent Skills | agent-rules-books | https://github.com/ciembor/agent-rules-books | AGENTS.md rules and skills for Codex, Cursor, Claude Code, Gemini CLI, and related coding agents. | No |
| B: Agent Skills | agent-skill-creator | https://github.com/FrancyJGLisboa/agent-skill-creator | Skill for turning repeatable workflows into reusable AI agent skills. | No |
| B: Agent Skills | agent-skills | https://github.com/addyosmani/agent-skills | Production-grade engineering skills for AI coding agents. | No |
| B: Agent Skills | agent-skills | https://github.com/vercel-labs/agent-skills | A collection of skills for AI coding agents. Skills are packaged instructions and scripts that extend agent capabilities. | No |
| B: Agent Skills | agent-skills | https://github.com/WordPress/agent-skills/ | Expert-level WordPress knowledge for AI coding assistants - blocks, themes, plugins, and best practices. | No |
| B: Agent Skills | Agent-Skills | https://github.com/MicrosoftDocs/Agent-Skills | Microsoft and Azure Agent Skills that give coding assistants structured expertise from Microsoft Learn documentation. | No |
| B: Agent Skills | agent-skills | https://github.com/elastic/agent-skills | Official Elastic skills for AI agents that work with Elastic products and workflows. | No |
| B: Agent Skills | Agent-Skills-for-Context-Engineering | https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering | A comprehensive collection of Agent Skills for context engineering, multi-agent architectures, and production agent systems. | No |
| B: Agent Skills | agent-skills-standard | https://github.com/HoangNguyen0403/agent-skills-standard | Agent Skills standards and best-practice packs for programming languages, frameworks, and common development workflows. | No |
| B: Agent Skills | agent-sprite-forge | https://github.com/0x0funky/agent-sprite-forge | Agent Skill for generating 2D sprite sheets and map, transparent PNG frames, and animated GIFs from prompts. | No |
| B: Agent Skills | agent-toolkit | https://github.com/softaworks/agent-toolkit | A curated collection of skills for AI coding agents. | No |
| B: Agent Skills | agent-toolkit-for-aws | https://github.com/aws/agent-toolkit-for-aws | AWS-supported MCP servers, skills, and plugins for agents that build on AWS. | No |
| B: Agent Skills | agentkits-marketing | https://github.com/aitytech/agentkits-marketing | Marketing automation skills and agent workflows for Claude Code, Cursor, GitHub Copilot, and compatible AI assistants. | No |
| B: Agent Skills | agents-best-practices | https://github.com/DenisSergeevitch/agents-best-practices | Provider-neutral agent skill for Codex, Claude Code, and other AI coding tools. | No |
| B: Agent Skills | agents-cli | https://github.com/google/agents-cli | The CLI and skills that turn any coding assistant into an expert at creating, evaluating, and deploying AI agents on Google Cloud. | No |
| B: Agent Skills | ai-copywriter | https://github.com/mikiarlo3/ai-copywriter | Copywriting skill with marketing knowledge and a human tone. | No |
| B: Agent Skills | ai-legal-claude | https://github.com/zubair-trabzada/ai-legal-claude | AI legal assistant skill for contract review, legal research, and compliance workflows. | No |
| B: Agent Skills | ai-marketing-claude | https://github.com/zubair-trabzada/ai-marketing-claude | A comprehensive marketing analysis and automation skill system for Claude Code. | No |
| B: Agent Skills | AI-research-SKILLs | https://github.com/Orchestra-Research/AI-research-SKILLs | Visual Skills Pack for Obsidian: generate Canvas, Excalidraw, and Mermaid diagrams from text with Claude Code. | No |
| B: Agent Skills | AI-research-SKILLs | https://github.com/sanyuan0704/code-review-expert | A comprehensive code review skill for AI agents. | No |
| B: Agent Skills | ai-sales-team-claude | https://github.com/zubair-trabzada/ai-sales-team-claude | Sales workflow system for Claude Code with prospect research, lead qualification, outreach, proposals, and pipeline reports. | No |
| B: Agent Skills | AlphaGBM/skills | https://github.com/AlphaGBM/skills | Real-data options intelligence skills for AI agents, with Claude Code and Cursor support. | No |
| B: Agent Skills | andrej-karpathy-skills | https://github.com/forrestchang/andrej-karpathy-skills | A single CLAUDE.md file to improve Claude Code behavior, derived from Andrej Karpathy's observations on LLM coding pitfalls. | No |
| B: Agent Skills | android-reverse-engineering-skill | https://github.com/SimoneAvogadro/android-reverse-engineering-skill | Claude Code skill to support Android app's reverse engineering. | No |
| B: Agent Skills | antfu's skills | https://github.com/antfu/skills | Anthony Fu's curated collection of agent skills. | No |
| B: Agent Skills | Anthropic-Cybersecurity-Skills | https://github.com/mukul975/Anthropic-Cybersecurity-Skills | 753+ structured cybersecurity skills for AI agents. | No |
| B: Agent Skills | anysearch-skill | https://github.com/anysearch-ai/anysearch-skill | Unified real-time search engine skill for AI agents. | No |
| B: Agent Skills | Apify Agent Skills | https://github.com/apify/agent-skills | Production-grade web scraping and automation skills for AI coding agents. | No |
| B: Agent Skills | app-onboarding-questionnaire | https://github.com/adamlyttleapps/claude-skill-app-onboarding-questionnaire | Claude Code skill for designing questionnaire-style app onboarding flows based on subscription app conversion patterns. | No |
| B: Agent Skills | app-store-connect-cli-skills | https://github.com/rorkai/app-store-connect-cli-skills | Skills for automating App Store Connect, TestFlight, deployment, and related asc CLI workflows. | No |
| B: Agent Skills | app-store-preflight-skills | https://github.com/truongduy2611/app-store-preflight-skills | AI agent skill that scans iOS and macOS projects for App Store rejection risks before submission. | No |
| B: Agent Skills | Apple-Hig-Designer | https://github.com/axiaoge2/Apple-Hig-Designer | A Claude Code Skill for designing professional interfaces following Apple Human Interface Guidelines. | No |
| B: Agent Skills | archify | https://github.com/tt-a1i/archify | Agent skill for generating architecture diagrams with dark and light themes plus PNG, JPEG, WebP, and SVG export. | No |
| B: Agent Skills | architecture-diagram-generator | https://github.com/Cocoon-AI/architecture-diagram-generator | Generate beautiful dark-themed system architecture diagrams as standalone HTML/SVG files. | No |
| B: Agent Skills | aso-skills | https://github.com/Eronred/aso-skills | AI agent skills for App Store Optimization and app growth workflows. | No |
| B: Agent Skills | Auto-claude-code-research-in-sleep | https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep | Lightweight Markdown-only skills for autonomous ML research. | No |
| B: Agent Skills | autocli-skill | https://github.com/nashsu/autocli-skill | Claude Code and agent skill for fetching real-time web data across many platforms through a Chrome login session. | No |
| B: Agent Skills | automotive-skills-suite | https://github.com/jherrodthomas/automotive-skills-suite | Installable Claude skills for automotive engineering, diagnostics, safety, and service workflows. | No |
| B: Agent Skills | autoresearch | https://github.com/uditgoenka/autoresearch | Turn Claude Code into a relentless improvement engine. | No |
| B: Agent Skills | awesome-design-skills | https://github.com/bergside/awesome-design-skills | Design skill directory for agentic tools, covering DESIGN.md and SKILL.md files for Claude Design, Codex, Cursor, and related AI tools. | No |
| B: Agent Skills | awesome-dfir-skills | https://github.com/tsale/awesome-dfir-skills | A curated collection of DFIR skills and workflows for InfoSec practitioners. | No |
| B: Agent Skills | awesome-pm-skills | https://github.com/menkesu/awesome-pm-skills | Product-management skill collection for research, planning, prioritization, launch work, and stakeholder communication. | No |
| B: Agent Skills | aws-agent-skills | https://github.com/itsmostafa/aws-agent-skills | AWS cloud engineering skills for Claude Code across 18 core AWS services. | No |
| B: Agent Skills | Axiom | https://github.com/CharlesWiltgen/Axiom | Battle-tested Claude Code skills for modern xOS (iOS, iPadOS, watchOS, tvOS) development. | No |
| B: Agent Skills | azure-skills | https://github.com/microsoft/azure-skills | Microsoft agent plugin with skills and MCP server configurations for Azure development scenarios. | No |
| B: Agent Skills | banana-claude | https://github.com/AgriciDaniel/banana-claude | AI image generation skill for Claude Code with a creative-director workflow powered by Gemini. | No |
| B: Agent Skills | baoyu-design | https://github.com/JimLiu/baoyu-design | Run Claude Design locally as an Agent Skill. | No |
| B: Agent Skills | BFL Agent Skills | https://docs.bfl.ai/api_integration/skills_integration | Reusable capabilities that teach AI agents how to work with FLUX models. | No |
| B: Agent Skills | bioSkills | https://github.com/GPTomics/bioSkills | SKILLS.md files for bioinformatics work with agents such as Claude Code. | No |
| B: Agent Skills | blader | https://github.com/blader/claude-code-continuous-learning-skill | A Claude Code skill for autonomous skill extraction and continuous learning. Have Claude Code get smarter as it works. | No |
| B: Agent Skills | book-to-skill | https://github.com/virgiliojr94/book-to-skill | Turn any technical book PDF into a Claude Code skill — ready to study, reference, and use while you work. | No |
| B: Agent Skills | Browserbase Skills | https://github.com/browserbase/skills | Browserbase's official collection of agent skills to access the web. | No |
| B: Agent Skills | callstackincubator | https://github.com/callstackincubator/agent-skills | A collection of agent-optimized React Native skills for AI coding assistants. | No |
| B: Agent Skills | caveman | https://github.com/JuliusBrussee/caveman | A Claude Code skill/plugin and Codex plugin that makes agent talk like caveman — cutting ~75% of output tokens while keeping full technical accuracy. | No |
| B: Agent Skills | cc-design | https://github.com/ZeroZ-lab/cc-design | High-fidelity HTML design and prototype guidance skill for AI agents. | No |
| B: Agent Skills | cc-skills-golang | https://github.com/samber/cc-skills-golang | A collection of Golang agentic skills that works. | No |
| B: Agent Skills | cheat-on-content | https://github.com/XBuilderLAB/cheat-on-content | A skill that turns every post into a calibrated experiment. | No |
| B: Agent Skills | chops | https://github.com/Shpigford/chops | macOS app for browsing, organizing, and using AI agent skills. | No |
| B: Agent Skills | chrisbanes skills | https://github.com/chrisbanes/skills | Skills for Kotlin, Jetpack Compose, and Android development. | No |
| B: Agent Skills | chrome-cdp-skill | https://github.com/pasky/chrome-cdp-skill | Give your AI agent access to your live Chrome session — works out of the box, connects to tabs you already have open. | No |
| B: Agent Skills | claude-ads | https://github.com/AgriciDaniel/claude-ads | Comprehensive paid advertising audit & optimization skill for Claude Code. | No |
| B: Agent Skills | claude-blog | https://github.com/AgriciDaniel/claude-blog | Claude Code blog skill suite with sub-skills, agents, and quality gates for SEO-focused and AI-citation-ready publishing workflows. | No |
| B: Agent Skills | Claude-BugHunter | https://github.com/elementalsouls/Claude-BugHunter | A Claude Code skill bundle for bug hunting and external red-team work — 71 skills, 15 slash commands, 681 disclosed-report patterns curated across 24 core vulnerability classes, plus ente... | No |
| B: Agent Skills | Claude-Code-Game-Studios | https://github.com/Donchitos/Claude-Code-Game-Studios | Turn Claude Code into a full game dev studio — 49 AI agents, 72 workflow skills, and a complete coordination system mirroring real studio hierarchy. | No |
| B: Agent Skills | claude-code-plugins-plus-skills | https://github.com/jeremylongshore/claude-code-plugins-plus-skills | 270+ Claude Code plugins with 739 agent skills. | No |
| B: Agent Skills | claude-code-skill-factory | https://github.com/alirezarezvani/claude-code-skill-factory | Toolkit for building and deploying Claude Skills, code agents, slash commands, and LLM prompts. | No |
| B: Agent Skills | claude-code-skills | https://github.com/daymade/claude-code-skills | Marketplace-style collection of production-ready Claude Code skills for development workflows. | No |
| B: Agent Skills | claude-code-skills | https://github.com/levnikolaevich/claude-code-skills | Plugin suite and bundled MCP servers for delivery workflows, codebase audits, documentation, performance optimization, and remote SSH work. | No |
| B: Agent Skills | claude-code-skills | https://github.com/whawkinsiv/claude-code-skills | Complete software development lifecycle skills optimized for non-technical founders building SaaS applications with AI tools (Lovable, Replit, Claude Code). | No |
| B: Agent Skills | claude-code-tresor | https://github.com/alirezarezvani/claude-code-tresor | Claude Code collection with autonomous skills, expert agents, slash commands, and reusable prompts for development workflows. | No |
| B: Agent Skills | claude-code-voice-skill | https://github.com/abracadabra50/claude-code-voice-skill | Skill to talk to Claude about your projects over the phone. | No |
| B: Agent Skills | claude-cs | https://github.com/nbashaw/claude-cs | A Claude Code skill that helps you build custom customer support automation for your company. | No |
| B: Agent Skills | claude-deep-research-skill | https://github.com/199-biotechnologies/claude-deep-research-skill | Deep research skill for Claude Code with a phased pipeline, source credibility scoring, and validation checks. | No |
| B: Agent Skills | claude-design-engineer | https://github.com/Dammyjay93/claude-design-engineer | Design engineering for Claude Code. Craft, memory, and enforcement for consistent UI. | No |
| B: Agent Skills | claude-office-skills | https://github.com/tfriedel/claude-office-skills | Office document creation and editing skills for Claude Code - PPTX, DOCX, XLSX, and PDF workflows with automation support. | No |
| B: Agent Skills | Claude-OSINT | https://github.com/elementalsouls/Claude-OSINT | Paired Claude skills for OSINT work, with recon modules, search patterns, and investigation workflows. | No |
| B: Agent Skills | claude-real-video | https://github.com/HUANGCHIHHUNGLeo/claude-real-video | Claude Code skill for real-video generation workflows, including planning, prompts, and production steps. | No |
| B: Agent Skills | Claude-Red | https://github.com/SnailSploit/Claude-Red | A curated library of offensive security skills designed for the Claude skills system. | No |
| B: Agent Skills | claude-scientific-skills | https://github.com/K-Dense-AI/claude-scientific-skills | A set of ready to use scientific skills for Claude. | No |
| B: Agent Skills | claude-seo | https://github.com/AgriciDaniel/claude-seo | Universal SEO skill for Claude Code. Comprehensive SEO analysis for any website or business type. | No |
| B: Agent Skills | claude-skill-aso-appstore-screenshots | https://github.com/adamlyttleapps/claude-skill-aso-appstore-screenshots | Claude skill for planning and producing App Store screenshot sets for ASO. | No |
| B: Agent Skills | claude-skill-homeassistant | https://github.com/komal-SkyNET/claude-skill-homeassistant | Claude Code skill to supercharge and manage all Home Assistant workflows. | No |
| B: Agent Skills | claude-skills | https://github.com/alirezarezvani/claude-skills | A Collection of Skills for Claude Code and Claude AI for real-world Usage. | No |
| B: Agent Skills | claude-skills | https://github.com/Jeffallan/claude-skills | 66 Specialized Skills for Full-Stack Developers. | No |
| B: Agent Skills | claude-skills-llm-council | https://github.com/aiwithremy/claude-skills-llm-council | Claude Code skill that routes decisions through a council of AI advisors with peer review. | No |
| B: Agent Skills | claude-skills-supercharged | https://github.com/jefflester/claude-skills-supercharged | A "supercharged" implementation of Claude Code Skills — using Haiku prompt analysis/critical skill scoring and skill auto-injection for friction-free, context-driven workflows. | No |
| B: Agent Skills | Claude-to-IM-skill | https://github.com/op7418/Claude-to-IM-skill | Bridge Claude Code / Codex to IM platforms — chat with AI coding agents from Telegram, Discord, or Feishu/Lark. | No |
| B: Agent Skills | claude-trading-skills | https://github.com/tradermonty/claude-trading-skills | Claude Code skills for equity investors and traders, including market research and analysis workflows. | No |
| B: Agent Skills | Claudeception | https://github.com/blader/Claudeception | A Claude Code skill for autonomous skill extraction and continuous learning. Have Claude Code get smarter as it works. | No |
| B: Agent Skills | cloudflare-skill | https://github.com/dmmulroy/cloudflare-skill | Comprehensive Cloudflare platform reference docs for AI/LLM consumption. | No |
| B: Agent Skills | code-review-skill | https://github.com/awesome-skills/code-review-skill | Comprehensive code review skill for Claude Code, covering React, Vue, Rust, TypeScript, TanStack Query, and related stacks. | No |
| B: Agent Skills | codebase-to-course | https://github.com/zarazhangrui/codebase-to-course | A Claude Code skill that turns any codebase into a beautiful, interactive single-page HTML course for non-technical vibe coders. | No |
| B: Agent Skills | codex-ppt-skill | https://github.com/ningzimu/codex-ppt-skill | GPT-Image-2 PPT generator skill for creating image-based slide decks. | No |
| B: Agent Skills | COG-second-brain | https://github.com/huytieu/COG-second-brain | A self-evolving second brain for Claude Code, Cursor, Kiro, Gemini CLI, and Codex, with AI skills, worker agents, and a people CRM. | No |
| B: Agent Skills | comet | https://github.com/rpamis/comet | Agent skill harness for phase-guarded automation from idea to implementation. | No |
| B: Agent Skills | context-engineering-kit | https://github.com/NeoLabHQ/context-engineering-kit | Hand-crafted Claude Code skills for improving agent output quality, with compatibility across OpenCode, Cursor, Gemini CLI, and related tools. | No |
| B: Agent Skills | csv-data-summarizer-claude-skill | https://github.com/coffeefuelbump/csv-data-summarizer-claude-skill | A Claude Skill that automatically analyzes uploaded CSV files — generating summary statistics, detecting missing data, and creating quick visualizations using Python and pandas. | No |
| B: Agent Skills | ctf-skills | https://github.com/ljagiello/ctf-skills | Agent skills for solving CTF challenges - web exploitation, binary pwn, crypto, reverse engineering, forensics, OSINT, and more. | No |
| B: Agent Skills | Day1Global-Skills | https://github.com/star23/Day1Global-Skills | Agent skills for U.S. stocks, macro markets, and crypto research. | No |
| B: Agent Skills | Deep-Research-skills | https://github.com/Weizhena/Deep-Research-skills | Structured deep research skill for Claude Code, OpenCode, and Codex, with human-in-the-loop controls for research workflows. | No |
| B: Agent Skills | design-engineer-auditor-package | https://github.com/kylezantos/design-engineer-auditor-package | A Claude Code skill for motion design audits, trained on Emil Kowalski, Jakub Krehel, and Jhey Tompkins. | No |
| B: Agent Skills | designer-skills | https://github.com/Owl-Listener/designer-skills | Designer skills, commands, and templates for agentic design workflows. | No |
| B: Agent Skills | Dimillian Skills | https://github.com/Dimillian/Skills | A collection of reusable development skills for Apple platforms, GitHub workflows, refactoring, diff review swarms, bug investigation swarms, code review, React performance work, and skil... | No |
| B: Agent Skills | dotnet-skills | https://github.com/Aaronontheweb/dotnet-skills | Claude Code skills and sub-agents for .NET developers. | No |
| B: Agent Skills | drawio-skill | https://github.com/Agents365-ai/drawio-skill | Generate draw.io diagrams from natural language — 6 presets, vision self-check + up to 5-round refinement, codebase-to-diagram, 10,000+ official shapes & 321 AI/LLM brand logos. | No |
| B: Agent Skills | dzhng/skills | https://github.com/dzhng/skills | Personal collection of Claude Code skills for repeatable engineering and knowledge-work tasks. | No |
| B: Agent Skills | ECC | https://github.com/affaan-m/ECC | Agent harness optimization system with skills, memory, security practices, and research-first workflows for Claude Code, Codex, OpenCode, Cursor, and related tools. | No |
| B: Agent Skills | effective-html | https://github.com/plannotator/effective-html | Agent skill for elegant and simple html plans, architecture diagrams, or whatever else you can think of. | No |
| B: Agent Skills | elevenlabs skills | https://github.com/elevenlabs/skills | ElevenLabs skill collection for building agents that work with speech, sound effects, music, transcription, and text-to-speech workflows. | No |
| B: Agent Skills | emilkowalski/skills | https://github.com/emilkowalski/skills | Design engineering skills for AI coding agents. | No |
| B: Agent Skills | evals-skills | https://github.com/hamelsmu/evals-skills | Skills for AI evaluation workflows and the AI Evals for Engineers course. | No |
| B: Agent Skills | excalidraw-diagram-skill | https://github.com/coleam00/excalidraw-diagram-skill | Skill to give Claude Code (and any coding agent) the ability to generate beautiful and practical Excalidraw diagrams. | No |
| B: Agent Skills | Expo-Skills | https://github.com/expo/skills | A collection of AI agent skills for working with Expo projects and Expo Application Services. | No |
| B: Agent Skills | female-portrait-director | https://github.com/liyue-aigc/female-portrait-director | Modular Codex Skill for developing detailed AI female-portrait prompts. | No |
| B: Agent Skills | finance-skills | https://github.com/himself65/finance-skills | A collection of skills for AI financial analysis and trading. | No |
| B: Agent Skills | Firecrawl Skills | https://docs.firecrawl.dev/sdks/cli | An easy way for AI agents such as Claude Code, Antigravity and OpenCode to use Firecrawl through the CLI. | No |
| B: Agent Skills | fireworks-tech-graph | https://github.com/yizhiyanhua-ai/fireworks-tech-graph | Claude Code skill for generating production-quality SVG+PNG technical diagrams. | No |
| B: Agent Skills | Flutter Agent Skills | https://github.com/flutter/skills | A collection of skills providing tailored instructions for happy path Flutter app development workflows. | No |
| B: Agent Skills | flyai-skill | https://github.com/alibaba-flyai/flyai-skill | FlyAI agent skill repository. | No |
| B: Agent Skills | frontend-slides | https://github.com/zarazhangrui/frontend-slides | A Claude Code skill for creating stunning, animation-rich HTML presentations. | No |
| B: Agent Skills | garden-skills | https://github.com/ConardLi/garden-skills | ConardLi's open-source Skills collection, featuring web design, knowledge retrieval, image generation, and more. | No |
| B: Agent Skills | gc-minimal-zine-poster | https://github.com/LiamGvchi/gc-minimal-zine-poster | Codex skill for generating quiet, minimal zine-style editorial poster prompts and images. | No |
| B: Agent Skills | gemini-skills | https://github.com/google-gemini/gemini-skills | Skills for the Gemini API, SDK and model/agent interactions. | No |
| B: Agent Skills | Generative-Media-Skills | https://github.com/SamurAIGPT/Generative-Media-Skills | Multi-modal Generative Media Skills for AI Agents (Claude Code, Cursor, Gemini CLI). | No |
| B: Agent Skills | geo-seo-claude | https://github.com/zubair-trabzada/geo-seo-claude | GEO-first SEO skill for Claude Code. Comprehensive AI search optimization for any website — citability scoring, AI crawler analysis, brand authority, schema markup, platform-specific opti... | No |
| B: Agent Skills | getsentry/skills | https://github.com/getsentry/skills | Agent Skills used by the Sentry team for development work. | No |
| B: Agent Skills | godogen | https://github.com/htdt/godogen | Claude Code skills that build complete Godot 4 projects from a game description. | No |
| B: Agent Skills | Google Agent Skills | https://github.com/google/skills | Agent Skills for Google products and technologies. | No |
| B: Agent Skills | google-ai-mode-skill | https://github.com/PleasePrompto/google-ai-mode-skill | Claude Code skill for free Google AI Mode search with citations. | No |
| B: Agent Skills | GPT-Image2-Skill | https://github.com/wuyoscar/GPT-Image2-Skill | GPT Image 2 prompt gallery, image prompt library, agentic skill, and CLI for OpenAI image generation/editing. | No |
| B: Agent Skills | gpt_image_2_skill | https://github.com/wuyoscar/gpt_image_2_skill | GPT Image 2 prompt gallery, image prompt library, agentic skill, and CLI for OpenAI image generation/editing. | No |
| B: Agent Skills | graphify | https://github.com/safishamsi/graphify | AI coding assistant skill (Claude Code, Codex, OpenCode, OpenClaw, Factory Droid, Trae). | No |
| B: Agent Skills | gsap-skills | https://github.com/greensock/gsap-skills | Official AI skills for GSAP. These skills teach AI coding agents how to correctly use GSAP (GreenSock Animation Platform), including best practices, common animation patterns, and plugin... | No |
| B: Agent Skills | gtm-engineer-skills | https://github.com/onvoyage-ai/gtm-engineer-skills | Claude Code skill for website AEO and GEO audits, with checks for AI search visibility, structured data, and framework-specific fixes. | No |
| B: Agent Skills | guard-skills | https://github.com/amElnagdy/guard-skills | Quality-gate skills that catch AI-generated failure modes in code, tests, and documentation. | No |
| B: Agent Skills | guizang-ppt-skill | https://github.com/op7418/guizang-ppt-skill | A Claude Code Skill that turns prompts into horizontal-swipe magazine-style HTML decks. | No |
| B: Agent Skills | guizang-social-card-skill | https://github.com/op7418/guizang-social-card-skill | Claude Code / Codex skill — generate Xiaohongshu carousels & WeChat 21:9+1:1 cover pairs. | No |
| B: Agent Skills | hack-skills | https://github.com/yaklang/hack-skills | Practical hacking skills for AI agents working on security research and offensive security workflows. | No |
| B: Agent Skills | hallmark | https://github.com/Nutlope/hallmark | Anti-AI-slop design skill for Claude Code, Cursor, and Codex. | No |
| B: Agent Skills | happy-claude-skills | https://github.com/iamzhihuix/happy-claude-skills | A collection of practical skill plugins designed for Claude Code. | No |
| B: Agent Skills | html-ppt-skill | https://github.com/lewislulu/html-ppt-skill | HTML PPT Studio — AgentSkill with 24 themes, 31 layouts, 20+ animations for building professional HTML presentations. | No |
| B: Agent Skills | huggingface skills | https://github.com/huggingface/skills | Give your agents the power of the Hugging Face ecosystem. | No |
| B: Agent Skills | humanizer | https://github.com/blader/humanizer | A Claude Code skill that removes signs of AI-generated writing from text, making it sound more natural and human. | No |
| B: Agent Skills | hyperframes | https://github.com/heygen-com/hyperframes | Write HTML. Render video. Built for agents. | No |
| B: Agent Skills | improve | https://github.com/shadcn/improve | Use your most capable model to audit your codebase and write plans for cheaper models to execute. | No |
| B: Agent Skills | internet-court-skill | https://github.com/internet-court/internet-court-skill | Agent Skill for natural-language mandates, delegated permissions, payments, escrow, and dispute resolution. | No |
| B: Agent Skills | ios-simulator-skill | https://github.com/conorluddy/ios-simulator-skill | iOS Simulator skill for Claude Code that helps agents build, run, and interact with apps while preserving token context. | No |
| B: Agent Skills | jakubkrehel/skills | https://github.com/jakubkrehel/skills | Agent skills for interface animation, UI polish, accessibility, and product writing. | No |
| B: Agent Skills | kill-ai-slop | https://github.com/yetone/kill-ai-slop | Field guide and Agent Skill for finding and removing AI-generated visual and copywriting clichés. | No |
| B: Agent Skills | kotlin-agent-skills | https://github.com/Kotlin/kotlin-agent-skills | AI agent skills for projects that use the Kotlin language. | No |
| B: Agent Skills | langchain-skills | https://github.com/langchain-ai/langchain-skills | LangChain skills repository for agent workflows and LangChain project work. | No |
| B: Agent Skills | last30days-skill | https://github.com/mvanhorn/last30days-skill | Claude Code skill that researches any topic across Reddit + X from the last 30 days, then writes copy-paste-ready prompts. | No |
| B: Agent Skills | learning-opportunities | https://github.com/DrCatHicks/learning-opportunities | A Claude or Codex skill for deliberate skill development during AI-assisted coding. | No |
| B: Agent Skills | lenny-skills | https://github.com/RefoundAI/lenny-skills | Product management skill collection based on Lenny's Podcast, covering hiring, user research, strategy, shipping, and related PM workflows. | No |
| B: Agent Skills | logo-generator-skill | https://github.com/op7418/logo-generator-skill | Professional SVG logo generator with high-end showcase presentations. | No |
| B: Agent Skills | loopy | https://github.com/Forward-Future/loopy | Practical AI-agent loops and an installable skill for finding, adapting, and designing repeatable agent workflows. | No |
| B: Agent Skills | lottie | https://github.com/diffusionstudio/lottie | Generate production-ready Lottie animations with Claude Code or Codex. | No |
| B: Agent Skills | make-interfaces-feel-better | https://github.com/jakubkrehel/make-interfaces-feel-better | Interface design skill based on the "Details that make interfaces feel better" article. | No |
| B: Agent Skills | manim_skill | https://github.com/adithya-s-k/manim_skill | Agent skills for Manim to create 3Blue1Brown style animations. | No |
| B: Agent Skills | Manus Skills | https://manus.im/blog/manus-skills | Manus' official agent skills. | No |
| B: Agent Skills | markdown-viewer skills | https://github.com/markdown-viewer/skills | Opinionated skills for AI coding agents to create stunning diagrams and visualizations directly in Markdown. | No |
| B: Agent Skills | marketingskills | https://github.com/coreyhaines31/marketingskills | Marketing skills for Claude Code and AI agents. CRO, copywriting, SEO, analytics, and growth engineering. | No |
| B: Agent Skills | material-3-skill | https://github.com/hamen/material-3-skill | Material Design 3 skill for Claude Code, with components, design tokens, theming, responsive layout, and MD3 audit support. | No |
| B: Agent Skills | mattpocock skills | https://github.com/mattpocock/skills | Skills for Real Engineers. | No |
| B: Agent Skills | mcp_excalidraw | https://github.com/yctimlin/mcp_excalidraw | MCP server and Claude Code skill for Excalidraw — programmatic canvas toolkit to create, edit, and export diagrams via AI agents with real-time canvas sync. | No |
| B: Agent Skills | medical-research-skills | https://github.com/aipoch/medical-research-skills | Agent skills for medical research tasks, including protocol design, data analysis, evidence review, and academic writing. | No |
| B: Agent Skills | Memento-Skills | https://github.com/Memento-Teams/Memento-Skills | Agent skills that help agents design and refine other agents. | No |
| B: Agent Skills | memU | https://github.com/NevaMind-AI/memU | Personal memory for agents with fast retrieval, self-evolving skills, and lower context cost. | No |
| B: Agent Skills | meta_skilld | https://github.com/Dicklesworthstone/meta_skilld | Rust CLI for managing Claude Code skills: indexing, building, bundling, and sharing. | No |
| B: Agent Skills | MiniMax-AI/skills | https://github.com/MiniMax-AI/skills | Development skills for AI coding agents. | No |
| B: Agent Skills | moai-adk | https://github.com/modu-ai/moai-adk | Spec-first agentic development kit for Claude Code, with agents, skills, TDD and DDD quality gates, multilingual project support, and a Go CLI. | No |
| B: Agent Skills | modern-web-guidance | https://github.com/GoogleChrome/modern-web-guidance | Google Chrome guidance for modern web development, with a companion site for current web platform recommendations. | No |
| B: Agent Skills | n8n-skills | https://github.com/czlonkowski/n8n-skills | n8n skillset for Claude Code to build flawless n8n workflows. | No |
| B: Agent Skills | nano-banana-pro-prompts-recommend-skill | https://github.com/YouMind-OpenLab/nano-banana-pro-prompts-recommend-skill | Claude Code / Cursor skill to recommend from 6000+ Nano Banana Pro image prompts. | No |
| B: Agent Skills | napkin | https://github.com/blader/napkin | A Claude Code skill that gives the agent persistent memory of its mistakes via a per-repo markdown scratchpad. | No |
| B: Agent Skills | native-feel-skill | https://github.com/yetone/native-feel-skill | An Agent Skill for designing cross-platform desktop apps that feel native — distilled from Raycast's 2.0 deep-dive and reverse engineering of Raycast Beta.app. | No |
| B: Agent Skills | next-skills | https://github.com/vercel-labs/next-skills | Agent skills for common Next.js workflows. | No |
| B: Agent Skills | notebooklm-skill | https://github.com/PleasePrompto/notebooklm-skill | Use this skill to enable Claude Code to communicate directly with your Google NotebookLM notebooks. | No |
| B: Agent Skills | NotFair | https://github.com/nowork-studio/NotFair | Open-source Claude Code skills for SEO, GEO, Google Ads, Meta Ads. | No |
| B: Agent Skills | nothing-design-skill | https://github.com/dominikmartn/nothing-design-skill | A Claude Code skill for generating UI in the Nothing design language. Monochrome, typographic, industrial. | No |
| B: Agent Skills | nuxt-skills | https://github.com/onmax/nuxt-skills | Vue, Nuxt, and NuxtHub skills for AI coding assistants. | No |
| B: Agent Skills | NVIDIA skills | https://github.com/NVIDIA/skills | AI agent skills published by NVIDIA. | No |
| B: Agent Skills | obsidian-skills | https://github.com/kepano/obsidian-skills | Claude Skills for use with Obsidian. | No |
| B: Agent Skills | opc-skills | https://github.com/ReScienceLab/opc-skills | Agent Skills for solopreneur workflows, including AI tooling, SEO, GEO, and operations tasks. | No |
| B: Agent Skills | paper2code | https://github.com/PrathamLearnsToCode/paper2code | Agent skill for turning arXiv papers into working code implementations. | No |
| B: Agent Skills | planning-with-files | https://github.com/OthmanAdi/planning-with-files | Claude Code skill implementing Manus-style persistent markdown planning — the workflow pattern behind the $2B acquisition. | No |
| B: Agent Skills | playwright-skill | https://github.com/lackeyjb/playwright-skill | Claude Code Skill for browser automation with Playwright. Model-invoked - Claude autonomously writes and executes custom automation for testing and validation. | No |
| B: Agent Skills | pm-claude-skills | https://github.com/mohitagw15856/pm-claude-skills | Product-management skill pack with Agent Skills, subagents, and slash commands for Claude, ChatGPT, Gemini, Cursor, Codex, and Hermes. | No |
| B: Agent Skills | power-bi-agentic-development | https://github.com/data-goblin/power-bi-agentic-development | Power BI and Microsoft Fabric skills, subagents, and hooks for semantic models, DAX, TMDL, reports, and dashboards. | No |
| B: Agent Skills | ppt-image-first | https://github.com/NyxTides/ppt-image-first | Codex, Claude Code, and OpenCode skill for image-first PowerPoint workflows. | No |
| B: Agent Skills | Pretty-mermaid-skills | https://github.com/imxv/Pretty-mermaid-skills | To provide AI with Mermaid chart rendering capability, supporting both SVG and ASCII output formats. | No |
| B: Agent Skills | Product-Manager-Skills | https://github.com/deanpeters/Product-Manager-Skills | Product Management skills framework built on battle-tested methods for Claude Code, Cowork, Codex, and AI agents. | No |
| B: Agent Skills | prompt-master | https://github.com/nidhinjs/prompt-master | A Claude skill that writes the accurate prompts for any AI tool. | No |
| B: Agent Skills | qiaomu-anything-to-notebooklm | https://github.com/joeseesun/qiaomu-anything-to-notebooklm | Claude skill for processing WeChat articles, web pages, YouTube videos, PDFs, Markdown, and search queries into NotebookLM-ready materials. | No |
| B: Agent Skills | qmd-skill | https://github.com/levineam/qmd-skill | A Codex/Clawd skill definition for qmd (Quick Markdown Search). | No |
| B: Agent Skills | remotion-dev/skills | https://www.remotion.dev/docs/ai/skills | Create videos programmatically. | No |
| B: Agent Skills | Research-Paper-Writing-Skills | https://github.com/Master-cai/Research-Paper-Writing-Skills | Skill package for ML/CV/NLP paper writing, curated and adapted from Prof. Peng Sida's open notes for Codex, Claude Code, and Gemini. | No |
| B: Agent Skills | ResumeSkills | https://github.com/Paramchoudhary/ResumeSkills | Career and job-search skills for resume writing, ATS optimization, interview preparation, and applications. | No |
| B: Agent Skills | reverse-skill | https://github.com/zhaoxuya520/reverse-skill | Reverse engineering and authorized penetration testing skill for AI coding agents. | No |
| B: Agent Skills | rust-skills | https://github.com/actionbook/rust-skills | Rust Developer AI Assistance System — Meta-Problem-Driven Knowledge Indexing. | No |
| B: Agent Skills | sanyuan-skills | https://github.com/sanyuan0704/sanyuan-skills | Expert code review skill: SOLID, security, performance, error handling, boundary conditions. | No |
| B: Agent Skills | science-skills | https://github.com/google-deepmind/science-skills | Google DeepMind science skills for agentic scientific workflows. | No |
| B: Agent Skills | scientific-agent-skills | https://github.com/K-Dense-AI/scientific-agent-skills | A set of ready to use Agent Skills for research, science, engineering, analysis, finance and writing. | No |
| B: Agent Skills | second-brain-skills | https://github.com/coleam00/second-brain-skills | Claude Skills that turn Claude Code into a second-brain workspace. | No |
| B: Agent Skills | security-audit-skill | https://github.com/cloudflare/security-audit-skill | Cloudflare coding-agent skill for multi-phase security audits with independently verified, machine-readable findings. | No |
| B: Agent Skills | seedance-prompt-skill | https://github.com/songguoxs/seedance-prompt-skill | A Claude Code custom skill that turns Claude into a professional AI video prompt engineer for ByteDance's Seedance 2.0 (鍗虫ⅵ) video generation platform. | No |
| B: Agent Skills | seedance2-skill | https://github.com/dexhunter/seedance2-skill | Skill to create best prompts for generating videos with seedance2.0 | No |
| B: Agent Skills | self-learning-skills | https://github.com/Kulaxyz/self-learning-skills | Self-learning skill pack that helps coding agents capture lessons from past work and reuse them in later sessions. | No |
| B: Agent Skills | Semia | https://github.com/berabuddies/Semia | Security audit tooling for reviewing AI agent skills before they are used in agent workflows. | No |
| B: Agent Skills | SenseNova-Skills | https://github.com/OpenSenseNova/SenseNova-Skills | Modular SenseNova skills for building AI-powered office assistants and productivity workflows. | No |
| B: Agent Skills | sickn33 | https://github.com/sickn33/antigravity-awesome-skills | The Ultimate Collection of 130+ Agentic Skills for Claude Code/Antigravity/Cursor. | No |
| B: Agent Skills | skill-codex | https://github.com/skills-directory/skill-codex | Claude Code skill for delegating prompts to Codex. | No |
| B: Agent Skills | skill-threat-modeling | https://github.com/fr33d3m0n/skill-threat-modeling | Code-First Deep Risk Analysis Skill for Claude Code - 8-Phase Workflow with Security design review, STRIDE Threat modeling, PenTest and attack chain analysis, Software compliance assessment. | No |
| B: Agent Skills | skill.color-expert | https://github.com/meodai/skill.color-expert | Agent skill for color science, accessibility checks, palette generation, pigment mixing, and historical color theory. | No |
| B: Agent Skills | SkillClaw | https://github.com/AMAP-ML/SkillClaw | Agentic evolver for creating and improving agent skills collectively. | No |
| B: Agent Skills | SkillForge | https://github.com/tripleyak/SkillForge | The ultimate meta-skill for generating best-in-class Claude Code skills. | No |
| B: Agent Skills | skillkit | https://github.com/rohitg00/skillkit | Portable skill toolkit for installing, translating, and sharing skills across Claude Code, Cursor, Codex, Copilot, and other coding agents. | No |
| B: Agent Skills | skillpack | https://github.com/CreminiAI/skillpack | Tooling for packaging and deploying local AI agents and reusable skill packs for teams. | No |
| B: Agent Skills | skills | https://github.com/microsoft/skills | Skills, MCP servers, Custom Agents, Agents.md for SDKs to ground Coding Agents. | No |
| B: Agent Skills | skills-for-fabric | https://github.com/microsoft/skills-for-fabric | Skills and MCP systems for using Microsoft Fabric from CLI, VS Code, Claude, and related agent workflows. | No |
| B: Agent Skills | slavingia/skills | https://github.com/slavingia/skills | Claude Code skills based on The Minimalist Entrepreneur by Sahil Lavingia. | No |
| B: Agent Skills | social-media-research-skills | https://github.com/ScrapeCreators/social-media-research-skills | Social-media research skills for AI agents powered by ScrapeCreators. | No |
| B: Agent Skills | social-media-skills | https://github.com/charlie947/social-media-skills | Agent skills for planning, writing, and managing social media content. | No |
| B: Agent Skills | solana-dev-skill | https://github.com/solana-foundation/solana-dev-skill | Claude Code skill for modern Solana development. | No |
| B: Agent Skills | solid-skills | https://github.com/ramziddin/solid-skills | AI agent skill for writing senior-engineer quality code through SOLID principles, TDD, and clean architecture. | No |
| B: Agent Skills | stitch-skills | https://github.com/google-labs-code/stitch-skills | A library of Agent Skills designed to work with the Stitch MCP server. | No |
| B: Agent Skills | stop-slop | https://github.com/hardikpandya/stop-slop | A skill file for removing AI tells from prose. | No |
| B: Agent Skills | story-to-handdrawn-video | https://github.com/gnipbao/story-to-handdrawn-video | Agent skill that turns Chinese stories or ordered images into hand-drawn diary-comic animations. | No |
| B: Agent Skills | Superpowers | https://github.com/obra/superpowers | Give Claude Code superpowers with a comprehensive skills library of proven techniques, patterns, and tools. | No |
| B: Agent Skills | Swift-Agent-Skills | https://github.com/nowork-studio/toprank | A curated directory of open-source AI agent skills for Swift and Apple platform development. | No |
| B: Agent Skills | Swift-Concurrency-Agent-Skill | https://github.com/AvdLee/Swift-Concurrency-Agent-Skill | Expert Swift Concurrency guidance for AI coding agents working on Swift projects. | No |
| B: Agent Skills | swift-ios-skills | https://github.com/dpearson2699/swift-ios-skills | Agent Skills for iOS, Swift, SwiftUI, and modern Apple framework development. | No |
| B: Agent Skills | SwiftUI-Agent-Skill | https://github.com/twostraws/SwiftUI-Agent-Skill | SwiftUI agent skill for Claude Code, Codex, and other AI tools. | No |
| B: Agent Skills | SwiftUI-Agent-Skill | https://github.com/AvdLee/SwiftUI-Agent-Skill | Agent Skill guidance for building SwiftUI apps with current best practices. | No |
| B: Agent Skills | taste-skill | https://github.com/Leonxlnx/taste-skill | A collection of skills that improve how AI tools write frontend code. | No |
| B: Agent Skills | text-to-cad | https://github.com/earthtojake/text-to-cad | An open source harness for generating CAD models. | No |
| B: Agent Skills | threejs-skills | https://github.com/CloudAI-X/threejs-skills | A curated collection of Three.js skill files that provide Claude Code with foundational knowledge for creating 3D elements and interactive experiences. | No |
| B: Agent Skills | translate-book | https://github.com/deusyu/translate-book | Claude Code skill that translates full books in PDF, DOCX, or EPUB format with parallel subagents. | No |
| B: Agent Skills | tutor-skills | https://github.com/bevibing/tutor-skills | Claude Code skill that turns PDFs, documents, and codebases into Obsidian study vaults. | No |
| B: Agent Skills | ui-design-brain | https://github.com/carmahhawwari/ui-design-brain | UI component knowledge skill for agents, with layout patterns and design-system conventions for interface work. | No |
| B: Agent Skills | ui-skills | https://github.com/ibelick/ui-skills | A growing set of skills to polish interfaces built by agents. | No |
| B: Agent Skills | ui-ux-pro-max-skill | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill | An AI SKILL that provide design intelligence for building professional UI/UX multiple platforms. | No |
| B: Agent Skills | Understand-Anything | https://github.com/Lum1104/Understand-Anything | Claude Code skills that turn any codebase into an interactive knowledge graph you can explore, search, and ask questions about (Multi-platform e.g., Codex are supported). | No |
| B: Agent Skills | vibe-security-skill | https://github.com/raroque/vibe-security-skill | Security audit skill for finding common vulnerabilities in apps built with AI coding assistants. | No |
| B: Agent Skills | Vibe-Skills | https://github.com/foryourhealth111-pixel/Vibe-Skills | An all-in-one AI skills package. | No |
| B: Agent Skills | vibecosystem | https://github.com/vibeeval/vibecosystem | An AI software-team system for Claude Code with agents, skills, hooks, and self-learning workflow support. | No |
| B: Agent Skills | VibeSec-Skill | https://github.com/BehiSecc/VibeSec-Skill | This skill helps Claude write secure code and prevent common vulnerabilities. | No |
| B: Agent Skills | video-shotcraft | https://github.com/Vincentwei1021/video-shotcraft | Claude Code and Codex skill for creating cinematic product videos with Remotion shot recipes and templates. | No |
| B: Agent Skills | visual-explainer | https://github.com/nicobailon/visual-explainer | Agent skill + prompt templates that generate rich HTML pages for visual diff reviews, architecture overviews, plan audits, data tables, and project recaps. | No |
| B: Agent Skills | vue-skills | https://github.com/vuejs-ai/skills | Agent skills for Vue 3 development. | No |
| B: Agent Skills | vue-skills | https://github.com/hyf0/vue-skills | Agent skills for Vue 3 development. | No |
| B: Agent Skills | Waza | https://github.com/tw93/Waza | Engineering habits you already know, turned into skills Claude can run. | No |
| B: Agent Skills | web-quality-skills | https://github.com/addyosmani/web-quality-skills | Agent Skills for optimizing web quality based on Lighthouse and Core Web Vitals. | No |
| B: Agent Skills | webgpu-claude-skill | https://github.com/dgreenheck/webgpu-claude-skill | A Claude skill for developing WebGPU applications with Three.js. | No |
| B: Agent Skills | wondelai/skills | https://github.com/wondelai/skills | Agent skills for Claude Code and agentskills.io-compatible coding agents. | No |
| B: Agent Skills | x-article-publisher-skill | https://github.com/wshuyi/x-article-publisher-skill | Claude Code skill for publishing Markdown articles to X (Twitter) Articles. | No |
| B: Agent Skills | x-research-skill | https://github.com/rohunvora/x-research-skill | X/Twitter research skill for Claude Code and OpenClaw. | No |
| B: Agent Skills | Xcode-Build-Optimization-Agent-Skill | https://github.com/AvdLee/Xcode-Build-Optimization-Agent-Skill | An Agent Skill helping you to optimize Xcode incremental and clean builds by running benchmarks and optimizing build settings. | No |
| B: Agent Skills &middot; B: Agent Skills | diagram-design | https://github.com/supabase/agent-skills | Thirteen editorial diagram types for Claude Code. Self-contained HTML + SVG. No shadows, no Mermaid-slop. | No |
| B: Agent Skills &middot; B: Agent Skills | Kami | https://github.com/ericosiu/ai-marketing-skills | Good content deserves good paper. | No |
| B: Agent Skills &middot; B: Agent Skills | nano-image-generator-skill | https://github.com/lxfater/nano-image-generator-skill | A Claude Code skill for generating images using Gemini 3 Pro Preview (Nano Banana Pro). | No |
| B: Agent Skills &middot; B: Agent Skills | skills | https://github.com/trailofbits/skills | Trail of Bits Claude Code skills for security research, vulnerability detection, and audit workflows. | No |
| B: Agent Skills &middot; B: Agent Skills | synalinks-skills | https://github.com/numman-ali/n-skills | Claude skills for Synalinks. | No |
| B: Agent Skills &middot; B: Agent Skills | Youtube-clipper-skill | https://github.com/op7418/Youtube-clipper-skill | Download videos, generate semantic chapters, clip segments, translate subtitles to bilingual format, and burn subtitles into videos. | No |
| B: Agent Skills &middot; B: Tools & Utilities | huggingface skills | https://github.com/numman-ali/openskills | Universal skills loader for AI coding agents. | Yes |
| B: Agents & Orchestration | agent-flow | https://github.com/patoles/agent-flow | Real-time visualization of Claude Code agent orchestration — see your agents think, branch, and coordinate as they work. | No |
| B: Agents & Orchestration | Agent-Fusion | https://github.com/krokozyab/Agent-Fusion | A multi-agent orchestration system that enables Claude Code, Codex CLI, Amazon Q Developer, and Gemini Code Assist to collaborate bidirectionally through intelligent task routing and cons... | No |
| B: Agents & Orchestration | AgentCheck | https://github.com/devlyai/AgentCheck | Local AI-powered code review agents for Claude Code. | No |
| B: Agents & Orchestration | agents | https://github.com/wshobson/agents | A collection of production-ready subagents for Claude Code. | No |
| B: Agents & Orchestration | agents | https://github.com/contains-studio/agents | A comprehensive collection of specialized AI agents designed to accelerate and enhance every aspect of rapid development. | No |
| B: Agents & Orchestration | agentsys | https://github.com/agent-sh/agentsys | Automation toolkit with plugins, agents, skills, and slash commands for Claude Code, OpenCode, Codex, Cursor, and Kiro. | No |
| B: Agents & Orchestration | ai-maestro | https://github.com/23blocks-OS/ai-maestro | Agent orchestration dashboard with memory search, code graph queries, agent-to-agent messaging, and skills support. | No |
| B: Agents & Orchestration | awesome-claude-agents | https://github.com/vijaythecoder/awesome-claude-agents | Supercharge Claude Code with a team of specialized AI agents that work together to build complete features, debug complex issues, and handle any technology stack with expert-level knowledge. | No |
| B: Agents & Orchestration | awesome-claude-code-agents | https://github.com/hesreallyhim/awesome-claude-code-agents | A curated list of awesome Claude Code Sub-Agents. | No |
| B: Agents & Orchestration | bux | https://github.com/browser-use/bux | A 24/7 Claude Code agent with Browser Harness, on any box you own. | No |
| B: Agents & Orchestration | Citadel | https://github.com/SethGammon/Citadel | An agent orchestration harness for Claude Code. It coordinates multiple AI agents in parallel, persists memory across sessions, and routes your intent to the cheapest execution path autom... | No |
| B: Agents & Orchestration | claude-agents | https://github.com/iannuttall/claude-agents | Custom subagents to use with Claude Code. | No |
| B: Agents & Orchestration | claude-agents | https://github.com/tddworks/claude-agents | A collection of specialized AI agents for Claude Code that enhance software development workflows with focused expertise in specific domains. | No |
| B: Agents & Orchestration | claude-code-agents | https://github.com/vizra-ai/claude-code-agents | Meet 59 specialized AI agents that supercharge your development workflow. | No |
| B: Agents & Orchestration | claude-code-merge-queue | https://github.com/funador/claude-code-merge-queue | Local merge queue for coordinating parallel Claude Code agents and landing their work in a controlled order. | No |
| B: Agents & Orchestration | claude-code-sub-agents | https://github.com/lst97/claude-code-sub-agents | Collection of specialized AI subagents for Claude Code for personal use. | No |
| B: Agents & Orchestration | claude-code-subagents | https://github.com/0xfurai/claude-code-subagents | A comprehensive collection of 100+ production-ready development subagents for Claude Code. | No |
| B: Agents & Orchestration | claude-code-subagents | https://github.com/NicholasSpisak/claude-code-subagents | A collection of specialized AI agent personas designed to work seamlessly with Claude Code's Task tool, providing expert-level assistance across the full spectrum of software development... | No |
| B: Agents & Orchestration | claude-code-subagents-collection | https://github.com/davepoon/claude-code-subagents-collection | A comprehensive collection of specialized AI subagents for Claude Code, designed to enhance development workflows with domain-specific expertise. | No |
| B: Agents & Orchestration | claude-code-unified-agents | https://github.com/stretchcloud/claude-code-unified-agents | A comprehensive collection of specialized Claude Code sub-agents combining the best features from multiple community repositories. | No |
| B: Agents & Orchestration | claude-delegator | https://github.com/jarrodwatts/claude-delegator | Delegate tasks to Codex GPT 5.2 directly from within Claude Code. | No |
| B: Agents & Orchestration | claude-squad | https://github.com/smtg-ai/claude-squad | Manage multiple AI terminal agents, including Claude Code, Aider, Codex, OpenCode, and Amp. | No |
| B: Agents & Orchestration | claude-sub-agent | https://github.com/zhsama/claude-sub-agent | AI-driven development workflow system built on Claude Code Sub-Agents. | No |
| B: Agents & Orchestration | claude-subconscious | https://github.com/letta-ai/claude-subconscious | A background agent that whispers to Claude Code. A subconcious agent that watches your sessions, reads your files, builds up memory over time, and whispers guidance back. | No |
| B: Agents & Orchestration | claude-user-memory | https://github.com/irenicj/claude-user-memory | A comprehensive Claude user memory system that enables intelligent, automatic orchestration of 12 specialized AI agents for Claude Code CLI. | No |
| B: Agents & Orchestration | claude_code_agent_farm | https://github.com/Dicklesworthstone/claude_code_agent_farm | A powerful orchestration framework that runs multiple Claude Code (cc) sessions in parallel to systematically improve your codebase. | No |
| B: Agents & Orchestration | ClaudeCodeAgents | https://github.com/darcyegb/ClaudeCodeAgents | A set of useful QA agents for Claude Code. | No |
| B: Agents & Orchestration | ClaudeNightsWatch | https://github.com/aniketkarne/ClaudeNightsWatch | Autonomous task execution system for Claude CLI that monitors your usage windows and executes predefined tasks automatically. | No |
| B: Agents & Orchestration | deepclaude | https://github.com/aattaran/deepclaude | A Claude Code skill for generating UI in the Nothing design language. Monochrome, typographic, industrial. | No |
| B: Agents & Orchestration | dotclaude | https://github.com/FradSer/dotclaude | A comprehensive development environment with specialized AI agents for code review, security analysis, and technical leadership. | No |
| B: Agents & Orchestration | GLM-skills | https://github.com/zai-org/GLM-skills | Official skills for the GLM family of models. | No |
| B: Agents & Orchestration | herdr | https://github.com/ogulcancelik/herdr | Agent multiplexer that lives in your terminal. | No |
| B: Agents & Orchestration | infinite-agentic-loop | https://github.com/disler/infinite-agentic-loop | An experimental project demonstrating Infinite Agentic Loop in a two-prompt system using Claude Code. | No |
| B: Agents & Orchestration | multi-agent-squad | https://github.com/bijutharakan/multi-agent-squad | Production-ready multi-agent orchestration framework for Claude Code. | No |
| B: Agents & Orchestration | omnigent | https://github.com/omnigent-ai/omnigent | A meta-harness for all your AI agents. | No |
| B: Agents & Orchestration | OpenAgents | https://github.com/OpenAgentsInc/openagents | Seamlessly integrate Claude Code's AI development capabilities across desktop and mobile with real-time synchronization. | No |
| B: Agents & Orchestration | openakita | https://github.com/openakita/openakita | Open-source AI assistant framework with skills and agent workflows. | No |
| B: Agents & Orchestration | Pika-Skills | https://github.com/Pika-Labs/Pika-Skills | A collection of open-source skills for AI coding agents (Claude Code, OpenClaw, etc.) powered by the Pika Developer API. | No |
| B: Agents & Orchestration | ralph-claude-code | https://github.com/DmitrySolana/ralph-claude-code | Autonomous AI development loop for Claude Code with intelligent exit detection. | No |
| B: Agents & Orchestration | raptor | https://github.com/gadievron/raptor | Turns Claude Code into a general-purpose AI offensive/defensive security agent. | No |
| B: Agents & Orchestration | roborev | https://github.com/kenn-io/roborev | Continuous background code review database for agents, work faster and smarter with accountability for every line of generated code. | No |
| B: Agents & Orchestration | seo-geo-claude-skills | https://github.com/aaron-he-zhu/seo-geo-claude-skills | 20 SEO & GEO skills for Claude Code, Cursor, Codex, and 35+ AI agents. Keyword research, content writing, technical audits, rank tracking. | No |
| B: Agents & Orchestration | seomachine | https://github.com/TheCraigHewitt/seomachine | A specialized Claude Code workspace for creating long-form, SEO-optimized blog content for any business. | No |
| B: Agents & Orchestration | Specialized AI Agents | https://github.com/Dimillian/Claude | This directory contains specialized AI agent definitions used by Claude Code to handle complex, domain-specific tasks. | No |
| B: Agents & Orchestration | sub-agents | https://github.com/webdevtodayjason/sub-agents | A simple Manager for adding Claude Code Sub Agents with hooks and custom slash commands. | No |
| B: Agents & Orchestration | sub-agents.directory | https://github.com/ayush-that/sub-agents.directory | A curated collection of 100+ sub-agent prompts and MCP servers for Claude Code. | No |
| B: Agents & Orchestration | visual-claude | https://github.com/thetronjohnson/visual-claude | A browser coding agent interface for selecting elements and sending instructions directly to Claude Code. | No |
| B: Agents & Orchestration &middot; B: Agents & Orchestration | claude-code-heavy | https://github.com/gtrusler/claude-code-heavy | Multi-agent research orchestration using Claude Code. | No |
| B: Agents & Orchestration &middot; B: Tools & Utilities | Claude-Flow | https://github.com/ruvnet/claude-flow | An enterprise-grade AI orchestration platform that revolutionizes how developers build with AI. | No |
| B: Agents & Orchestration &middot; B: Tools & Utilities | Severance | https://github.com/blas0/Severance | A semantic memory system designed for Claude Code. | No |
| B: Alternatives to Claude Code | crush | https://github.com/charmbracelet/crush | The glamourous AI coding agent for your favourite terminal. | No |
| B: Alternatives to Claude Code | gemini-cli | https://github.com/google-gemini/gemini-cli | An open-source AI agent that brings the power of Gemini directly into your terminal. | No |
| B: Alternatives to Claude Code | grok-cli | https://github.com/superagent-ai/grok-cli | An open-source AI agent that brings the power of Grok directly into your terminal. | No |
| B: Alternatives to Claude Code | OpenAI Codex CLI | https://github.com/openai/codex | Lightweight coding agent that runs in your terminal. | No |
| B: Alternatives to Claude Code | opencode | https://github.com/anomalyco/opencode | The open source AI coding agent. | No |
| B: Alternatives to Claude Code | pi | https://github.com/earendil-works/pi | A minimal terminal coding harness. | No |
| B: Alternatives to Claude Code | qwen-code | https://github.com/QwenLM/qwen-code | A command-line AI workflow tool adapted from Gemini CLI, optimized for Qwen3-Coder models with enhanced parser support & tool support. | No |
| B: Claude Plugins | adversarial-spec | https://github.com/zscole/adversarial-spec | A Claude Code plugin that iteratively refines product specifications by debating between multiple LLMs until all models reach consensus. | No |
| B: Claude Plugins | arscontexta | https://github.com/agenticnotetaking/arscontexta | Claude Code plugin that generates individualized knowledge systems from conversation. | No |
| B: Claude Plugins | call-me | https://github.com/ZeframLou/call-me | Minimal plugin that lets Claude Code call you on the phone. | No |
| B: Claude Plugins | cartographer | https://github.com/kingbootoshi/cartographer | Claude Code plugin that maps and documents codebases of any size using parallel AI subagents. | No |
| B: Claude Plugins | claude-code | https://github.com/laravel/claude-code | A collection of Claude Code plugins tailored for PHP / Laravel development. | No |
| B: Claude Plugins | claude-code-plugin | https://github.com/browserbase/claude-code-plugin | Browserbase plugin for Claude Code - Use cloud browsers with Claude Code instead of local Chrome. | No |
| B: Claude Plugins | claude-dashboard | https://github.com/uppinote20/claude-dashboard | Comprehensive status line plugin for Claude Code with context usage, API rate limits, and cost tracking | Yes |
| B: Claude Plugins | claude-forge | https://github.com/sangrokjung/claude-forge | Claude Code plugin framework with agents, commands, skills, and security hooks. | No |
| B: Claude Plugins | claude-hud | https://github.com/jarrodwatts/claude-hud | A Claude Code plugin that shows what's happening - context usage, active tools, running agents, and todo progress. | No |
| B: Claude Plugins | claude-review-loop | https://github.com/hamelsmu/claude-review-loop | Claude Code plugin: automated code review loop with Codex. | No |
| B: Claude Plugins | claude-workflow-v2 | https://github.com/CloudAI-X/claude-workflow-v2 | Universal Claude Code workflow plugin with agents, skills, hooks, and commands. | No |
| B: Claude Plugins | design-plugin | https://github.com/0xdesign/design-plugin | A Claude Code plugin that helps you make confident UI design decisions through rapid iteration. | No |
| B: Claude Plugins | ensue-skill | https://github.com/mutable-state-inc/ensue-skill | A persistent knowledge tree that grows with you - what you learn today enriches tomorrow's reasoning. | No |
| B: Claude Plugins | fablize | https://github.com/fivetaku/fablize | Claude Code plugin that changes Opus behavior with a Fable-inspired response style. | No |
| B: Claude Plugins | hackingtool-plugin | https://github.com/AKCodez/hackingtool-plugin | 183+ pentesting & OSINT tools from Z4nzu/hackingtool. | No |
| B: Claude Plugins | harness | https://github.com/revfactory/harness | A meta-skill that designs domain-specific agent teams, defines specialized agents, and generates the skills they use. | No |
| B: Claude Plugins | hello2cc | https://github.com/hellowind777/hello2cc | Native-first Claude Code plugin for third-party models with silent Agent model injection and output styles. | No |
| B: Claude Plugins | homunculus | https://github.com/humanplane/homunculus | A Claude Code plugin that watches how you work, learns your patterns, and evolves itself to help you better. | No |
| B: Claude Plugins | interface-design | https://github.com/Dammyjay93/interface-design | Design engineering for Claude Code. Craft, memory, and enforcement for consistent UI. | No |
| B: Claude Plugins | pg-aiguide | https://github.com/timescale/pg-aiguide | MCP server and Claude plugin for Postgres skills, documentation, and database guidance. | No |
| B: Claude Plugins | plugins-for-claude-natives | https://github.com/team-attention/plugins-for-claude-natives | A collection of Claude Code plugins for power users who want to extend Claude Code's capabilities beyond the defaults. | No |
| B: Claude Plugins | ponytail | https://github.com/DietrichGebert/ponytail | Makes your AI agent think like the laziest senior dev in the room. | No |
| B: Claude Plugins | ralph-wiggum-marketer | https://github.com/muratcankoylan/ralph-wiggum-marketer | A Claude Code Plugin that provides an autonomous AI copywriter. | No |
| B: Clients & GUIs | 1code | https://github.com/21st-dev/1code | Best UI for Claude Code with local and remote agent execution. | No |
| B: Clients & GUIs | ccmate-release | https://github.com/djyde/ccmate-release | A GUI for Claude Code. | No |
| B: Clients & GUIs | Claude in a Box | https://github.com/juancgarza/claude-in-a-box | A ChatGPT Canvas-style interface for Claude Code running in E2B sandboxes. | No |
| B: Clients & GUIs | claude-code-costs | https://github.com/philipp-spiess/claude-code-costs | Analyze your Claude Code conversation costs with interactive visualizations. | No |
| B: Clients & GUIs | claude-code-viewer | https://github.com/d-kimuson/claude-code-viewer | A full-featured web-based Claude Code client that provides complete interactive functionality for managing Claude Code projects. | No |
| B: Clients & GUIs | Claude-Code-Web-GUI | https://github.com/binggg/Claude-Code-Web-GUI | Browse, view and share your Claude Code sessions - runs entirely in browser, no server required! | No |
| B: Clients & GUIs | claude-code-webui | https://github.com/DevAgentForge/claude-code-webui | A web-based Claude Code that runs on desktop, mobile phones, and iPads. | No |
| B: Clients & GUIs | claude-run | https://github.com/kamranahmedse/claude-run | A beautiful web UI for browsing Claude Code conversation history. | No |
| B: Clients & GUIs | claudia | https://github.com/getAsterisk/claudia | A powerful GUI app and Toolkit for Claude Code - Create custom agents, manage interactive Claude Code sessions, run secure background agents, and more. | No |
| B: Clients & GUIs | Claudiatron | https://github.com/Haleclipse/Claudiatron | A Powerful Claude Code GUI Desktop Application. | No |
| B: Clients & GUIs | clui-cc | https://github.com/lcoutodemos/clui-cc | A lightweight, transparent desktop overlay for Claude Code on macOS. Clui CC wraps the Claude Code CLI in a floating pill interface with multi-tab sessions, a permission approval UI, voic... | No |
| B: Clients & GUIs | CodePilot | https://github.com/op7418/CodePilot | A native desktop GUI for Claude Code — chat, code, and manage projects visually. | No |
| B: Clients & GUIs | codexia | https://github.com/milisp/codexia | Lightweight agent workstation for Codex CLI and Claude Code with scheduling, worktree control, remote control, and skills management. | No |
| B: Clients & GUIs | companion | https://github.com/The-Vibe-Company/companion | Open-source Claude Code / Codex Web UI. | No |
| B: Clients & GUIs | cui | https://github.com/BMPixel/cui | A web UI for Claude Code agents. | No |
| B: Clients & GUIs | happy | https://github.com/slopus/happy | Mobile and Web client for Claude Code, with realtime voice, encryption and fully featured. | No |
| B: Clients & GUIs | Sniffly | https://github.com/chiphuyen/sniffly | Claude Code dashboard with usage stats, error analysis, and sharable feature. | No |
| B: Clients & GUIs | t3code | https://github.com/pingdotgg/t3code | A minimal web GUI for coding agents. | No |
| B: Clients & GUIs | vibe-kanban | https://github.com/BloopAI/vibe-kanban | Get 10X more out of Claude Code, Gemini CLI, Codex, Amp and other coding agents. | No |
| B: Clients & GUIs &middot; B: Usage & Observability | Claude-code-ChatInWindows | https://github.com/LKbaba/Claude-code-ChatInWindows | A Native UI for Windows That Makes Claude Code Instantly Better! | No |
| B: Guides & Learning | agent-rules | https://github.com/steipete/agent-rules | Rules and knowledge to work better with agents such as Claude Code or Cursor. | No |
| B: Guides & Learning | claude-code-hooks-mastery | https://github.com/disler/claude-code-hooks-mastery | A resource for mastering Claude Code hooks. | No |
| B: Guides & Learning | claude-code-is-programmable | https://github.com/disler/claude-code-is-programmable | Scale your compute with Claude Code as a programmable agentic coding tool. | No |
| B: Guides & Learning | claude-code-mastery | https://github.com/TheDecipherist/claude-code-mastery | Complete Claude Code guide covering CLAUDE.md, hooks, skills, MCP servers, and commands. | No |
| B: Guides & Learning | claude-code-mcpinstall | https://github.com/undeadpickle/claude-code-mcpinstall | Easy guide to installing Claude Code MCPs globally on your machine. | No |
| B: Guides & Learning | claude-code-showcase | https://github.com/ChrisWiles/claude-code-showcase | Comprehensive Claude Code project configuration example with hooks, skills, agents, commands, and GitHub Actions workflows. | No |
| B: Guides & Learning | claude-code-system-prompt | https://github.com/matthew-lim-matthew-lim/claude-code-system-prompt | Claude Code's system prompt. | No |
| B: Guides & Learning | claude-code-tips | https://github.com/ykdojo/claude-code-tips | 45 tips for getting the most out of Claude Code, from basics to advanced - includes a custom status line script, cutting the system prompt in half, using Gemini CLI as Claude Code's minio... | No |
| B: Guides & Learning | claudecode-best-practices | https://github.com/rosmur/claudecode-best-practices | A collection of best practices and procedures for using Claude Code. | No |
| B: IDE & Editor Integrations | Claude-Autopilot | https://github.com/benbasha/Claude-Autopilot | VS Code/Cursor extension for automating Claude Code tasks with intelligent queuing, batch processing, and auto-resume. | No |
| B: IDE & Editor Integrations | claude-code-chat | https://github.com/andrepimenta/claude-code-chat | Beautiful Claude Code Chat Interface for VS Code. | No |
| B: IDE & Editor Integrations | claude-code-ide.el | https://github.com/manzaltu/claude-code-ide.el | Claude Code IDE for Emacs provides native integration with Claude Code CLI through the Model Context Protocol (MCP). | No |
| B: IDE & Editor Integrations | claude-code.el | https://github.com/stevemolitor/claude-code.el | Claude Code Emacs integration. | No |
| B: IDE & Editor Integrations | claude-code.nvim | https://github.com/greggh/claude-code.nvim | Seamless integration between the Claude Code AI assistant and Neovim. | No |
| B: IDE & Editor Integrations | claudecode.nvim | https://github.com/coder/claudecode.nvim | A Claude Code Neovim IDE Extension. | No |
| B: IDE & Editor Integrations | getspecstory | https://github.com/specstoryai/getspecstory | Extensions for GH Copilot, Cursor, and Claude Code. | No |
| B: IDE & Editor Integrations | minuet-ai.nvim | https://github.com/milanglacier/minuet-ai.nvim | Code completion as-you-type from popular LLMs including OpenAI, Gemini, Claude, Ollama. | No |
| B: IDE & Editor Integrations | n8n-nodes-claudecode | https://github.com/holt-web-ai/n8n-nodes-claudecode | Bring the power of Claude Code directly into your n8n automation workflows! | No |
| B: Infrastructure & Proxies | 9router | https://github.com/decolua/9router | Routes Claude Code, Codex, Cursor, Cline, and other coding agents to dozens of model providers with automatic fallback. | No |
| B: Infrastructure & Proxies | agentapi | https://github.com/coder/agentapi | An HTTP API for Claude Code, Goose, Aider, and Codex. | No |
| B: Infrastructure & Proxies | anthropic-proxy | https://github.com/maxnowack/anthropic-proxy | A proxy server that converts Anthropic API requests to OpenAI format and sends them to OpenRouter, used to use Claude Code with OpenRouter. | No |
| B: Infrastructure & Proxies | castari-proxy | https://github.com/castar-ventures/castari-proxy | Use Claude Agent SDK and Claude Code with other providers/models. | No |
| B: Infrastructure & Proxies | ccflare | https://github.com/snipeship/ccflare | The ultimate Claude API proxy with intelligent load balancing across multiple accounts. | No |
| B: Infrastructure & Proxies | ccNexus | https://github.com/lich0821/ccNexus | A smart API endpoint rotation proxy for Claude Code. | No |
| B: Infrastructure & Proxies | claude-balancer | https://github.com/snipeship/claude-balancer | A load balancer proxy for multiple Claude OAuth accounts with automatic failover, request tracking, and web dashboard. | No |
| B: Infrastructure & Proxies | claude-code-kimi-groq | https://github.com/fakerybakery/claude-code-kimi-groq | A basic proxy to use Kimi K2 on Claude Code through Groq. | No |
| B: Infrastructure & Proxies | claude-code-mcp | https://github.com/steipete/claude-code-mcp | Claude Code as a one-shot MCP server to have an agent in your agent. | No |
| B: Infrastructure & Proxies | claude-code-nexus | https://github.com/KroMiose/claude-code-nexus | Seamlessly forward Claude Code requests to any OpenAI-compatible API service with smart model mapping, streaming support, deployed on Cloudflare Worker. | No |
| B: Infrastructure & Proxies | claude-code-open | https://github.com/Davincible/claude-code-open | Claude Code with any LLM provider (OpenRouter, Gemini, Kimi K2). | No |
| B: Infrastructure & Proxies | claude-code-proxy | https://github.com/1rgs/claude-code-proxy | Run Claude Code on OpenAI models. | No |
| B: Infrastructure & Proxies | claude-code-proxy | https://github.com/fuergaosi233/claude-code-proxy | A Claude Code to OpenAI API Proxy. | No |
| B: Infrastructure & Proxies | claude-code-proxy | https://github.com/seifghazi/claude-code-proxy | Proxy that captures and visualizes in-flight Claude Code requests and conversations. | No |
| B: Infrastructure & Proxies | claude-gemini-bridge | https://github.com/tkaufmann/claude-gemini-bridge | Intelligent integration between Claude Code and Google Gemini for large-scale code analysis. | No |
| B: Infrastructure & Proxies | claude-gemini-mcp-slim | https://github.com/cmdaltctr/claude-gemini-mcp-slim | A lightweight integration that brings Google's Gemini AI capabilities to Claude Code through MCP (Model Context Protocol). | No |
| B: Infrastructure & Proxies | claude-historian | https://github.com/Vvkmnn/claude-historian | An MCP server for Claude Code conversation history. | No |
| B: Infrastructure & Proxies | claude_code-gemini-mcp | https://github.com/RaiAnsar/claude_code-gemini-mcp | Connect Claude Code with Google's Gemini AI for powerful AI collaboration. | No |
| B: Infrastructure & Proxies | Claudify | https://github.com/neno-is-ooo/claudify | Use Claude Code as an LLM provider with your subscription flat fee instead of pay-per-token API keys. | No |
| B: Infrastructure & Proxies | codemcp | https://github.com/ezyang/codemcp | Coding assistant MCP for Claude Desktop. | No |
| B: Infrastructure & Proxies | Context-Gateway | https://github.com/Compresr-ai/Context-Gateway | An agentic proxy that enhances any AI agent workflow with instant history compaction and context optimization tools. | No |
| B: Infrastructure & Proxies | copilot-api | https://github.com/ericc-ch/copilot-api | Turns GitHub Copilot into an OpenAI/Anthropic API compatible server, usable with Claude Code. | No |
| B: Infrastructure & Proxies | gemini-for-claude-code | https://github.com/coffeegrind123/gemini-for-claude-code | A Python program allowing the use of Claude Code with Google's Gemini models. | No |
| B: Infrastructure & Proxies | kimi-cc | https://github.com/LLM-Red-Team/kimi-cc | Use Kimi's latest model (kimi-k2-0711-preview) to drive Claude Code. | No |
| B: Infrastructure & Proxies | mcp-claude-code | https://github.com/SDGLBL/mcp-claude-code | MCP implementation of Claude Code capabilities and more. | No |
| B: Infrastructure & Proxies | open-connector | https://github.com/oomol-lab/open-connector | Auth gateway that connects SaaS APIs to AI agents through SDK, CLI, MCP, HTTP, and OpenAPI access. | No |
| B: Infrastructure & Proxies | y-router | https://github.com/luohy15/y-router | A Simple Proxy enabling Claude Code to work with OpenRouter. | No |
| B: Infrastructure & Proxies | zen-mcp-server | https://github.com/BeehiveInnovations/zen-mcp-server | The power of Claude Code + Gemini / OpenAI / Grok / OpenRouter / Ollama / Custom Model working as one. | No |
| B: Official Resources | claude-code | https://github.com/anthropics/claude-code | Claude Code is an agentic coding tool that lives in your terminal, understands your codebase, and helps you code faster by executing routines. | No |
| B: Official Resources | claude-code-sdk-python | https://github.com/anthropics/claude-code-sdk-python | The official Python SDK for Claude Code. | No |
| B: Official Resources | claude-cookbooks | https://github.com/anthropics/claude-cookbooks | A collection of notebooks/recipes showcasing some fun and effective ways of using Claude. | No |
| B: Official Resources | defending-code-reference-harness | https://github.com/anthropics/defending-code-reference-harness | Skills for threat modeling, scanning, triage, patching, plus an autonomous scanning harness you can /customize. | No |
| B: Official Resources | financial-services | https://github.com/anthropics/financial-services | Reference agents, skills, and data connectors for the financial-services workflows. | No |
| B: Official Resources | knowledge-work-plugins | https://github.com/anthropics/knowledge-work-plugins | Open source repository of plugins primarily intended for knowledge workers to use in Claude Cowork & Claude Code. | No |
| B: SDKs & Development Kits | claude-code-api-rs | https://github.com/ZhangHanDong/claude-code-api-rs | A high-performance Rust implementation of an OpenAI-compatible API gateway for Claude Code CLI. | No |
| B: SDKs & Development Kits | Claude-Code-Development-Kit | https://github.com/peterkrueck/Claude-Code-Development-Kit | A personal Claude Code Development Kit. | No |
| B: SDKs & Development Kits | claude-code-requirements-builder | https://github.com/rizethereum/claude-code-requirements-builder | A tool for building Claude Code requirements. | No |
| B: SDKs & Development Kits | claude-code-sdk-ts | https://github.com/instantlyeasy/claude-code-sdk-ts | Configure models, enable tools, stream events, then fetch text, JSON, run details or token stats in one call via .asText() or .allowTools('Read', 'Write'). | No |
| B: SDKs & Development Kits | claude-code-typescript-hooks | https://github.com/bartolli/claude-code-typescript-hooks | Fast, intelligent quality checks for different project types. | No |
| B: SDKs & Development Kits | dotai | https://github.com/udecode/dotai | The ultimate AI development stack, including Claude Code, Task Master, and Curso. | No |
| B: SDKs & Development Kits | vibekit | https://github.com/superagent-ai/vibekit | A simple SDK for safely running Codex, Gemini CLI, and Claude Code in a secure sandbox. | No |
| B: Tools & Utilities | agent-of-empires | https://github.com/njbrake/agent-of-empires | Claude Code, OpenCode, Mistral Vibe, Codex CLI, Gemini CLI Coding Agent Terminal Session manager via tmux and git Worktrees. | No |
| B: Tools & Utilities | asm | https://github.com/luongnv89/asm | Universal skill manager for AI coding agents. | No |
| B: Tools & Utilities | async-code | https://github.com/ObservedObserver/async-code | Use Claude Code or CodeX CLI to perform multiple tasks in parallel with a Codex-style UI, functioning as a personal codex or cursor-background agent. | No |
| B: Tools & Utilities | cc-mirror | https://github.com/numman-ali/cc-mirror | Create multiple isolated Claude Code variants with custom providers (Z.ai, MiniMax, OpenRouter, LiteLLM) | No |
| B: Tools & Utilities | cc-monitor-rs | https://github.com/ZhangHanDong/cc-monitor-rs | Real-time Claude Code usage monitor with native UI built using Rust and Makepad. | No |
| B: Tools & Utilities | cc-monitor-worker | https://github.com/cometkim/cc-monitor-worker | Claude Code monitoring with Cloudflare Workers & Workers Analytics Engine. | No |
| B: Tools & Utilities | cc-sessions | https://github.com/GWUDCAP/cc-sessions | An opinionated extension set for Claude Code (hooks, subagents, commands, task/git management infrastructure) | No |
| B: Tools & Utilities | ccguard | https://github.com/pomterre/ccguard | Automated enforcement of net-negative LOC, complexity constraints, and quality standards for Claude code. | No |
| B: Tools & Utilities | ccheckpoints | https://github.com/p32929/ccheckpoints | A checkpoint system for Claude Code CLI that automatically tracks your coding sessions. | No |
| B: Tools & Utilities | ccmanager | https://github.com/kbwo/ccmanager | Claude Code / Gemini CLI / Codex CLI Session Manager. | No |
| B: Tools & Utilities | ccmate | https://github.com/djyde/ccmate | Configure your Claude Code without pain. | No |
| B: Tools & Utilities | CCPlugins | https://github.com/brennercruvinel/CCPlugins | Claude Code Plugins that actually save time. Built by a dev tired of typing please act like a senior engineer in every conversation. | No |
| B: Tools & Utilities | ccpm | https://github.com/automazeio/ccpm | Project management system for Claude Code using GitHub Issues and Git worktrees for parallel agent execution. | Yes |
| B: Tools & Utilities | cctrace | https://github.com/jimmc414/cctrace | Export Claude Code chat sessions into markdown and XML. | No |
| B: Tools & Utilities | ccundo | https://github.com/RonitSachdev/ccundo | Integrates seamlessly with Claude Code to provide granular undo functionality by reading directly from Claude Code's session files. | No |
| B: Tools & Utilities | cipher | https://github.com/campfirein/cipher | An opensource memory layer specifically designed for coding agents. | No |
| B: Tools & Utilities | Claude Code Tamagotchi | https://github.com/Ido-Levi/claude-code-tamagotchi | A digital friend that lives in your Claude Code statusline and keeps you company while you build cool stuff. | No |
| B: Tools & Utilities | claude-agent-server | https://github.com/forayconsulting/gemini_cli_skill | A Claude Code skill enabling Claude to use Gemini 3 Pro via Gemini CLI. | No |
| B: Tools & Utilities | claude-blocker | https://github.com/T3-Content/claude-blocker | Block distracting websites unless Claude Code is actively running inference. | No |
| B: Tools & Utilities | claude-canvas | https://github.com/dvdsgl/claude-canvas | A TUI toolkit that gives Claude Code its own display. | No |
| B: Tools & Utilities | claude-cmd | https://github.com/kiliczsh/claude-cmd | Claude Code Commands Manager. | No |
| B: Tools & Utilities | claude-code-auto-memory | https://github.com/severity1/claude-code-auto-memory | Claude Code plugin that automatically maintains CLAUDE.md files. | No |
| B: Tools & Utilities | claude-code-base-action | https://github.com/anthropics/claude-code-base-action | A Claude Code base action. | No |
| B: Tools & Utilities | claude-code-boost | https://github.com/yifanzz/claude-code-boost | Hook utilities for Claude Code with intelligent auto-approval. | No |
| B: Tools & Utilities | claude-code-configs | https://github.com/Matt-Dionis/claude-code-configs | A comprehensive collection of production-grade Claude Code configurations, specialized agents, and automation workflows for optimizing AI-assisted development. | No |
| B: Tools & Utilities | claude-code-container | https://github.com/tintinweb/claude-code-container | A Docker container for running Claude Code in "dangerously skip permissions" mode. | No |
| B: Tools & Utilities | claude-code-containers | https://github.com/ghostwriternr/claude-code-containers | Use Claude Code on Cloudflare to solve GitHub issues. | No |
| B: Tools & Utilities | claude-code-hooks | https://github.com/karanb192/claude-code-hooks | A growing collection of useful Claude Code hooks. Copy, paste, customize.. | No |
| B: Tools & Utilities | claude-code-log | https://github.com/daaain/claude-code-log | A Python CLI tool that converts Claude Code transcript JSONL files into readable HTML format. | No |
| B: Tools & Utilities | claude-code-personal-assistant | https://github.com/c0dezli/claude-code-personal-assistant | AI personal assistant setup for Claude Code. | No |
| B: Tools & Utilities | claude-code-prompt-improver | https://github.com/severity1/claude-code-prompt-improver | Intelligent prompt improver hook for Claude Code. Type vibes, ship precision. | No |
| B: Tools & Utilities | Claude-Code-Remote | https://github.com/JessyTsui/Claude-Code-Remote | Control Claude Code remotely via email. Start tasks locally, receive notifications when Claude completes them, and send new commands by simply replying to emails. | No |
| B: Tools & Utilities | claude-code-sandbox | https://github.com/textcortex/claude-code-sandbox | Run Claude Code safely in local Docker containers without having to approve every permission. | No |
| B: Tools & Utilities | claude-code-settings | https://github.com/feiskyer/claude-code-settings | Claude Code settings and commands for vibe coding. | No |
| B: Tools & Utilities | claude-code-spec-workflow | https://github.com/Pimzino/claude-code-spec-workflow | Automated Kiro-style Spec workflow for Claude Code. Transform feature ideas into complete implementations through Requirements → Design → Tasks → Implementation. | No |
| B: Tools & Utilities | claude-code-specs-generator | https://github.com/kellemar/claude-code-specs-generator | A documentation and context management system for AI-assisted development, inspired by Amazon's Kiro IDE. | No |
| B: Tools & Utilities | claude-code-studio | https://github.com/arnaldo-delisio/claude-code-studio | Transform Claude Code into a complete development studio with 40+ specialized AI agents, MCP integrations, and enterprise-grade workflows. | No |
| B: Tools & Utilities | claude-code-templates | https://github.com/davila7/claude-code-templates | A CLI tool for configuring and monitoring Claude Code. | No |
| B: Tools & Utilities | claude-code-test-runner | https://github.com/firstloophq/claude-code-test-runner | An automated E2E natural language test runner built on Claude Code. | No |
| B: Tools & Utilities | claude-code-thinking-patch | https://github.com/aleks-apostle/claude-code-thinking-patch | Make Claude Code's thinking blocks visible by default without pressing ctrl+o. | No |
| B: Tools & Utilities | claude-code-transcripts | https://github.com/simonw/claude-code-transcripts | Tools for publishing transcripts for Claude Code sessions. | No |
| B: Tools & Utilities | claude-code-voice | https://github.com/mckaywrigley/claude-code-voice | Hands-free voice control for Claude Code on macOS. | No |
| B: Tools & Utilities | claude-cognitive | https://github.com/GMaN1911/claude-cognitive | Working memory for Claude Code - persistent context and multi-instance coordination. | No |
| B: Tools & Utilities | Claude-Command-Suite | https://github.com/qdhenry/Claude-Command-Suite | Professional slash commands for Claude Code that provide structured workflows for software development tasks, including code review and feature implementation. | No |
| B: Tools & Utilities | claude-commands | https://github.com/badlogic/claude-commands | Global Claude Code commands and workflows. | No |
| B: Tools & Utilities | claude-config-editor | https://github.com/gagarinyury/claude-config-editor | A lightweight web tool that helps you clean and optimize your Claude Code/Desktop config files (.claude.json). | No |
| B: Tools & Utilities | claude-context-local | https://github.com/FarhanAliRaza/claude-context-local | Code search MCP for Claude Code. Make entire codebase the context for any coding agent. Embeddings are created and stored locally. No API cost. | No |
| B: Tools & Utilities | claude-context-mode | https://github.com/mksglu/claude-context-mode | An MCP server that sits between Claude Code and these outputs. 315 KB becomes 5.4 KB. 98% reduction. | Yes |
| B: Tools & Utilities | claude-hub | https://github.com/claude-did-this/claude-hub | Deploy Claude Code as a fully autonomous GitHub bot. | No |
| B: Tools & Utilities | claude-island | https://github.com/farouqaldori/claude-island | Claude Code notifications without the context switch. | No |
| B: Tools & Utilities | claude-mem | https://github.com/thedotmack/claude-mem | A Claude Code plugin that automatically captures everything Claude does during your coding sessions, compresses it with AI (using Claude's agent-sdk), and injects relevant context back in... | No |
| B: Tools & Utilities | claude-memory-compiler | https://github.com/coleam00/claude-memory-compiler | Give Claude Code a memory that evolves with your codebase. | No |
| B: Tools & Utilities | claude-modular | https://github.com/oxygen-fragment/claude-modular | Production-ready modular Claude Code framework with 30+ commands, token optimization, and MCP server integration. | No |
| B: Tools & Utilities | claude-powerline | https://github.com/Owloops/claude-powerline | Beautiful vim-style powerline statusline for Claude Code. | No |
| B: Tools & Utilities | claude-prune | https://github.com/DannyAziz/claude-prune | A fast CLI tool for pruning Claude Code sessions. | No |
| B: Tools & Utilities | claude-select | https://github.com/aeitroc/claude-select | A unified launcher for Claude Code that lets you interactively choose which LLM backend to use. | No |
| B: Tools & Utilities | claude-self-reflect | https://github.com/ramakay/claude-self-reflect | Claude forgets everything. This fixes that. | No |
| B: Tools & Utilities | claude-sessions | https://github.com/iannuttall/claude-sessions | Custom slash commands for Claude Code that provide comprehensive development session tracking and documentation. | No |
| B: Tools & Utilities | claude-setup | https://github.com/AizenvoltPrime/claude-setup | A comprehensive configuration setup for Claude Code with Model Context Protocol (MCP) servers, custom commands, and automated workflows. | No |
| B: Tools & Utilities | claude-simone | https://github.com/Helmi/claude-simone | A project management framework for AI-assisted development with Claude Code. | No |
| B: Tools & Utilities | claude-thermos | https://github.com/izeigerman/claude-thermos | Keeps a Claude session warm between tasks. | No |
| B: Tools & Utilities | claude-token-efficient | https://github.com/drona23/claude-token-efficient | One CLAUDE.md file. Keeps Claude responses terse. Reduces output verbosity on heavy workflows. Drop-in, no code changes. | No |
| B: Tools & Utilities | claudebox | https://github.com/RchGrav/claudebox | A Claude Code Docker Development Environment for running Claude AI's coding assistant in a fully containerized, reproducible environment. | No |
| B: Tools & Utilities | claudecode-macmenu | https://github.com/PiXeL16/claudecode-macmenu | A Mac Menu for Claude Code that notifies when Claude is done and shows insights. | No |
| B: Tools & Utilities | ClaudeForge | https://github.com/alirezarezvani/ClaudeForge | A CLAUDE.md Generator and Maintenance tool for for Claude Code to create high-quality CLAUDE.md instruction files — aligned with Anthropic's best practices for Claude Code. | No |
| B: Tools & Utilities | ClaudeUsageBar | https://github.com/Artzainnn/ClaudeUsageBar | Track your Claude.ai usage right from your Mac menu bar. | No |
| B: Tools & Utilities | clawgod | https://github.com/0Chencc/clawgod | Claude Code companion tool for agent sessions, workflows, and local control. | No |
| B: Tools & Utilities | codegraph | https://github.com/colbymchenry/codegraph | Local code knowledge graph for Claude Code, Codex, Gemini, Cursor, OpenCode, Antigravity, Kiro, and Hermes Agent. | No |
| B: Tools & Utilities | commands | https://github.com/wshobson/commands | A collection of production-ready slash commands for Claude Code. | No |
| B: Tools & Utilities | conductor | https://conductor.build/ | Run a bunch of Claude Codes in parallel. | No |
| B: Tools & Utilities | context-forge | https://github.com/webdevtodayjason/context-forge | CLI tool that scaffolds context engineering documentation for Claude Code projects. | No |
| B: Tools & Utilities | context-infrastructure | https://github.com/grapeot/context-infrastructure | Context and memory system for AI coding agents with persistent memory, personal rules, skills, and scheduled observations. | No |
| B: Tools & Utilities | Continuous Claude | https://github.com/AnandChowdhary/continuous-claude | Run Claude Code in a continuous loop, autonomously creating PRs, waiting for checks, and merging. | No |
| B: Tools & Utilities | Continuous-Claude-v2 | https://github.com/parcadei/Continuous-Claude-v2 | Context management for Claude Code. Hooks maintain state via ledgers and handoffs. MCP execution without context pollution. Agent orchestration with isolated context windows. | No |
| B: Tools & Utilities | crystal | https://github.com/stravu/crystal | Run multiple Claude Code AI sessions in parallel git worktrees. | No |
| B: Tools & Utilities | ctx | https://github.com/ctxrs/ctx | Local search for coding-agent history across Claude Code, Codex, Cursor, and related tools. | No |
| B: Tools & Utilities | engram | https://github.com/nagisanzenin/engram | Learning engine for Claude Code and Codex that records patterns from previous sessions and turns them into reusable guidance. | No |
| B: Tools & Utilities | flashbacker | https://github.com/agentsea/flashbacker | Claude Code state management with session continuity and AI personas, subagents and agent discussion. | No |
| B: Tools & Utilities | headroom | https://github.com/headroomlabs-ai/headroom | Compresses tool outputs, logs, files, and retrieval chunks before they reach the language model. | No |
| B: Tools & Utilities | headroom | https://github.com/chopratejas/headroom | Compresses tool outputs, logs, files, and retrieval chunks before they enter an agent context. | No |
| B: Tools & Utilities | laravel-claude-code-setup | https://github.com/laraben/laravel-claude-code-setup | One-command setup for AI-powered Laravel development with Claude Code and MCP servers. | No |
| B: Tools & Utilities | looper | https://github.com/ksimback/looper | Visual planning tool for review-gated Claude Code agent loops before they run. | No |
| B: Tools & Utilities | manifest | https://github.com/mnfst/manifest | Connects agents and coding harnesses with different model providers through one manifest. | Yes |
| B: Tools & Utilities | medusa | https://github.com/Pantheon-Security/medusa | AI-first security scanner for repositories, secrets, hooks, permissions, and agent skills. | No |
| B: Tools & Utilities | meridian | https://github.com/markmdev/meridian | Zero-config Claude Code setup with enforced task scaffolding, structured memory, persistent context after compaction, plug-in code standards, optional TDD mode, and zero behavior changes... | No |
| B: Tools & Utilities | Observal | https://github.com/BlazeUp-AI/Observal | A sandboxed artifactory and analytics platform for your AI development stack. | No |
| B: Tools & Utilities | OpenContext | https://github.com/0xranx/OpenContext | Personal context store for Codex, Claude, OpenCode, and other agents, with skills, tools, search, and a desktop GUI. | No |
| B: Tools & Utilities | peon-ping | https://github.com/PeonPing/peon-ping | Warcraft III Peon voice notifications (+ more!) for Claude Code, Codex, IDEs, and any AI agent. | No |
| B: Tools & Utilities | recall | https://github.com/raiyanyahya/recall | Offline durable memory for Claude Code that reduces repeated project explanation across sessions. | No |
| B: Tools & Utilities | recall | https://github.com/zippoxer/recall | Full-text search and resume for Claude/Codex conversations. | No |
| B: Tools & Utilities | rins_hooks | https://github.com/rinadelph/rins_hooks | Universal Claude Code hooks collection with cross-platform installer. | No |
| B: Tools & Utilities | run-claude-docker | https://github.com/icanhasjonas/run-claude-docker | Run claude code in somewhat safe and isolated yolo mode. | No |
| B: Tools & Utilities | shotgun-alpha | https://github.com/shotgun-sh/shotgun-alpha | Codebase-aware spec engine for Cursor, Claude Code & Lovable. | No |
| B: Tools & Utilities | skill-scanner | https://github.com/cisco-ai-defense/skill-scanner | Security Scanner for Agent Skills. | No |
| B: Tools & Utilities | skillhub-desktop | https://github.com/skillhub-club/skillhub-desktop | Desktop app for managing agent skills in one place. | No |
| B: Tools & Utilities | skills-manager | https://github.com/xingkongliang/skills-manager | A lightweight desktop app to manage, sync, and organize AI agent skills across 15+ coding tools. | No |
| B: Tools & Utilities | skillshare | https://github.com/runkids/skillshare | Sync skills across all AI CLI tools with one command and simplify team sharing. | No |
| B: Tools & Utilities | smart-ralph | https://github.com/tzachbon/smart-ralph | Claude Code plugin for spec-driven development with smart compaction and Ralph-style autonomous loops. | No |
| B: Tools & Utilities | spec-based-claude-code | https://github.com/papaoloba/spec-based-claude-code | Implementation of a Spec-Driven Development workflow in Claude Code using custom slash commands. | No |
| B: Tools & Utilities | storybloq | https://github.com/Storybloq/storybloq | Cross-session context tool for Claude Code with a CLI, MCP server, and /story skill for tickets, handovers, and roadmaps. | No |
| B: Tools & Utilities | SuperClaude | https://github.com/NomenAK/SuperClaude | A configuration framework that enhances Claude Code with specialized commands, cognitive personas, and development methodologies. | No |
| B: Tools & Utilities | SuperClaude | https://github.com/gwendall/superclaude | Supercharge your GitHub workflow with Claude AI. | No |
| B: Tools & Utilities | SuperClaude_Framework | https://github.com/SuperClaude-Org/SuperClaude_Framework | A configuration framework that enhances Claude Code with specialized commands, cognitive personas, and development methodologies. | Yes |
| B: Tools & Utilities | tdd-guard | https://github.com/nizos/tdd-guard | Automated TDD enforcement for Claude Code. | No |
| B: Tools & Utilities | tweakcc | https://github.com/Piebald-AI/tweakcc | Command-line tool to customize your Claude Code styling. | No |
| B: Tools & Utilities | Understand-Anything | https://github.com/Egonex-AI/Understand-Anything | Codebase understanding tool that turns repositories into searchable, explainable knowledge graphs. | No |
| B: Tools & Utilities | vibecode-pro-max-kit | https://github.com/withkynam/vibecode-pro-max-kit | Spec-driven coding harness that keeps project memory and implementation context organized for AI agents. | No |
| B: Tools & Utilities | win-claude-code | https://github.com/somersby10ml/win-claude-code | Claude Code for Windows: No WSL. No Docker. Just code. | No |
| B: Tools & Utilities &middot; B: Infrastructure & Proxies | claude-code-router | https://github.com/musistudio/claude-code-router | Use Claude Code as the foundation for coding infrastructure, allowing you to decide how to interact with the model while enjoying updates from Anthropic. | No |
| B: Tools & Utilities &middot; B: Tools & Utilities | claude-on-rails | https://github.com/obie/claude-on-rails | A development framework for Ruby on Rails developers using Claude Code, inspired by SuperClaude. | No |
| B: Usage & Observability | agentacct | https://github.com/mikehasa/agentacct | Local-first work intelligence for coding agents, based on read-only session logs. | No |
| B: Usage & Observability | agentlytics | https://github.com/f/agentlytics | Analytics dashboard for AI coding agents including Claude Code, Cursor, Windsurf, VS Code Copilot, Zed, Antigravity, OpenCode, and Command Code. | No |
| B: Usage & Observability | cc-statusline | https://github.com/chongdashu/cc-statusline | Transform your Claude Code experience with a beautiful, informative statusline. | No |
| B: Usage & Observability | cccost | https://github.com/badlogic/cccost | Instrument Claude Code to track actual token usage and cost. | No |
| B: Usage & Observability | ccglass | https://github.com/jianshuo/ccglass | See what your coding agent (Claude Code, Codex, Kimi) sends to the model — local proxy + web dashboard. | No |
| B: Usage & Observability | CCometixLine | https://github.com/Haleclipse/CCometixLine | A high-performance Claude Code statusline tool written in Rust with Git integration and real-time usage tracking. | No |
| B: Usage & Observability | CCSeva | https://github.com/Iamshankhadeep/ccseva | A beautiful macOS menu bar app for tracking your Claude Code usage in real-time. | No |
| B: Usage & Observability | ccstatusline | https://github.com/sirmalloc/ccstatusline | A customizable status line formatter for Claude Code CLI that displays model info, git branch, token usage, and other metrics in your terminal. | No |
| B: Usage & Observability | ccusage | https://github.com/ryoppippi/ccusage | A CLI tool for analyzing Claude Code usage from local JSONL files. | No |
| B: Usage & Observability | claude-code-leaderboard | https://github.com/grp06/claude-code-leaderboard | This CLI automatically monitors your token usage and posts your stats to the leaderboard after each Claude Code session. | No |
| B: Usage & Observability | claude-code-monitor | https://github.com/onikan27/claude-code-monitor | Real-time dashboard for monitoring multiple Claude Code sessions from a CLI and mobile web UI on macOS. | No |
| B: Usage & Observability | claude-code-ui | https://github.com/KyleAMathews/claude-code-ui | A real-time dashboard for monitoring Claude Code sessions across multiple projects. | No |
| B: Usage & Observability | Claude-Code-Usage-Monitor | https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor | A real-time Claude Code usage monitor with predictions and warnings. | No |
| B: Usage & Observability | claude-doctor | https://github.com/millionco/claude-doctor | Diagnostic tool for reviewing Claude Code sessions and finding problems in local agent workflows. | No |
| B: Usage & Observability | Claude-Monitor | https://github.com/RISCfuture/Claude-Monitor | A menulet that tracks your Claude Code token usage. | No |
| B: Usage & Observability | claude-pulse | https://github.com/nikitadoudikov/claude-pulse | Live Claude Code dashboard for token use, context health, tool calls, session recovery, and mobile approvals. | No |
| B: Usage & Observability | claude-statusline | https://github.com/luongnv89/claude-statusline | Customize the status line in Claude Code. | No |
| B: Usage & Observability | claude-task-viewer | https://github.com/L1AD/claude-task-viewer | A web-based Kanban board for viewing Claude Code tasks. | No |
| B: Usage & Observability | claude-usage | https://github.com/phuryn/claude-usage | A local dashboard for tracking your Claude Code token usage, costs, and session history. | Yes |
| B: Usage & Observability | ClaudeCodeStatusLine | https://github.com/daniel3303/ClaudeCodeStatusLine | Custom status line for Claude Code showing model, tokens, rate limits, and git info in real-time. | No |
| B: Usage & Observability | codeburn | https://github.com/getagentseal/codeburn | See where your AI coding tokens go. Interactive TUI dashboard for Claude Code, Codex, and Cursor cost observability. | No |
| B: Usage & Observability | codeburn | https://github.com/AgentSeal/codeburn | See where your AI coding tokens go. Interactive TUI dashboard for Claude Code, Codex, and Cursor cost observability. | No |
| B: Usage & Observability | CodexBar | https://github.com/steipete/CodexBar | Show usage stats for OpenAI Codex and Claude Code, without having to login. | No |
| B: Usage & Observability | pyccsl | https://github.com/wolfdenpublishing/pyccsl | Python Claude Code Status Line (PyCCSL, pronounced "pixel"). | No |
| B: Usage & Observability | tokentab | https://github.com/sequilade/tokentab | CLI for calculating Claude Code, Codex, and Gemini CLI session costs by model, project, and day. | No |
| B: Usage & Observability | tokentap | https://github.com/jmuncor/tokentap | Intercept LLM API traffic and visualize token usage in a real-time terminal dashboard. | No |

---

## Category heat map

Raw counts per category, per list.

**List A (hesreallyhim, 122 current entries)**

| Count | Category |
|---:|---|
| 15 | Security |
| 12 | Observability & Monitoring / Usage & Cost |
| 11 | From Anthropic |
| 9 | Documentation, Knowledge & Learning |
| 9 | Memory & Context Persistence |
| 7 | Start Here |
| 7 | Alternative Clients |
| 7 | Observability & Monitoring / Session Monitors |
| 6 | Providers, Runtime & Integration Infrastructure |
| 6 | Remote Control, Notifications & Voice I/O |
| 6 | Linting |
| 4 | Documentation… / Obsidian |
| 4 | Design & UI/UX |
| 4 | Creative Media |
| 3 | Status Lines |
| 3 | Observability & Monitoring / Observability |
| 2 | Research & Scientific Inquiry |
| 2 | Writing & Prose Quality |
| 2 | Infrastructure & DevOps |
| 2 | Multi-Agent Orchestration |
| 1 | Skills |

**List B (jqueryscript, 598 entries)**

| Count | Category |
|---:|---|
| 283 | Agent Skills |
| 118 | Tools & Utilities |
| 52 | Agents & Orchestration |
| 29 | Infrastructure & Proxies |
| 29 | Usage & Observability |
| 24 | Claude Plugins |
| 21 | Clients & GUIs |
| 10 | Guides & Learning |
| 9 | Official Resources |
| 9 | IDE & Editor Integrations |
| 7 | SDKs & Development Kits |
| 7 | Alternatives to Claude Code |

### What is crowded

**1. Skills / prompt packs — catastrophically crowded.** 283 of list B's 598 entries (47%) are Agent Skills. List A responded to exactly this by shrinking Skills to a **single** entry, which is a deliberate curatorial statement: the category is so saturated that individual entries stopped being informative. Anything we build that is essentially "a bundle of markdown instructions" is invisible.

**2. Cost/token counters and status lines — extremely crowded, and converging.** Combining list A's Usage & Cost (12) + Status Lines (3) with list B's Usage & Observability (29) gives ~40 entries doing near-identical work: read local JSONL, multiply tokens by a pricing table, render a number. List A's own description of the statusline field, attributed, calls it "a sea of metrics bars" and "a very crowded field." The market leaders are decided: `ccusage` (17.5k ⭐), `ccstatusline` (12k ⭐), `codeburn` (9k ⭐), `Claude-Code-Usage-Monitor` (8.5k ⭐). **Do not compete here on cost arithmetic alone.**

**3. Live session monitors — crowded and heavily macOS-native.** List A's Session Monitors (7) is dominated by Swift/SwiftUI menu-bar apps and Tauri/Electron desktop shells (`c9watch`, `Claude Status`, `claude-control`, `claude-status-bar`, `so-agentbar`) plus one TUI (`cctop`). They all answer one question: *which of my running sessions needs attention right now?* This is a real-time, process-table problem. It is **not** the problem Loush Dashboard solves, and the platform skew (macOS menu bar) means a cross-platform web dashboard is not really substituting for them.

**4. Multi-agent orchestration frameworks.** 52 in list B. Also saturated, also not our lane.

### What is thin or empty

**1. Observability proper — only 3 entries in list A.** `agents-observe`, `claude-code-otel`, and disler's `claude-code-hooks-multi-agent-observability`. All three are *event-stream* systems: hooks fire → HTTP POST → SQLite → WebSocket → UI. All three require a running collector daemon and (two of three) Docker. **Nobody in this bucket does retrospective analysis of transcripts already on disk.**

**2. Linting / config validation — 6 entries, and all of them are file linters.** `agnix`, `Ctxlint`, `Schliff`, `agents-md-cookbook`, `BlockWatch`, `Upkeep`. They check whether your CLAUDE.md/SKILL.md/hooks/MCP config is *syntactically* valid. **None of them close the loop back to behaviour** — nobody says "your CLAUDE.md rule X is being violated in 40% of your actual sessions."

**3. Code-outcome analysis — essentially empty.** Across 690 entries, the only projects that connect agent activity to *what happened to the code* are `millionco/claude-doctor` (behavioural anti-patterns from transcripts), `masondelan/selvedge` (17 ⭐, reasoning-per-change), and `mikehasa/agentacct` (usage↔work joins with confidence labels). Nothing does import-graph blast radius, rework ranking, or test-coverage joins. **This is the gap.**

**4. Config *writing* — almost nobody.** `ccexp` previews config files; `agnix` autofixes lint violations; `claude-code-templates` installs templates. But a dashboard that safely *edits* live `settings.json` / hooks / MCP config with backups is not represented as a category at all.

**5. JIRA/GitHub/CI delivery joins — zero.** No entry in either list joins Claude Code session history to ticket systems or CI. Our Delivery and Ticket sections have no competitor in these lists.

**6. Windows.** The Session Monitors bucket is macOS-first; `agentacct` explicitly supports Windows only via WSL. A cross-platform Node/Express + browser dashboard is genuinely differentiated on reach.

### Where the gap is

The ecosystem has thoroughly solved **"how many tokens did that cost"** and **"which session is blocked right now."** It has barely touched **"was the work any good, and what did it do to my repo."** Every crowded category is a *counter*; every empty category is a *judgement*. Loush Dashboard's WorkingSet thesis — rework rank, blast radius via import graph, test coverage on touched files — sits squarely in the empty half, and after reading 690 entries I found no direct competitor for it.

---

## Top 15 missed projects — profiles

Selected for relevance to a local-first observability/telemetry/config dashboard over Claude Code, excluding everything already under separate research. Every profile below is written from the repo's own README and live GitHub API metadata fetched 2026-07-29 — not from the list one-liners.

Port-effort key: **S** = a day or less (read a file format, copy a formula). **M** = a week-ish (a new section or a substantial rewrite of an existing one). **L** = architectural (new dependency class, new runtime, or a data model change).

---

### 1. `daaain/claude-code-log` — the schema authority

| | |
|---|---|
| URL | https://github.com/daaain/claude-code-log |
| Stars | 1,173 |
| License | MIT |
| Last commit | 2026-07-28 (active, same day as scan) |
| Language | Python |

**What it does.** A CLI (`uvx claude-code-log@latest --open-browser`) that converts `~/.claude/projects/**/*.jsonl` into readable HTML and Markdown, plus a TUI browser. Features include a zoomable interactive timeline, cross-session summary matching, token usage per message and per session, runtime message-type filtering, detail levels (`full|high|low|minimal|user-only`), and natural-language date filtering.

**Why it matters to US.** The HTML output is not the point. **This repo is the single most valuable artefact I found in the entire scan**, because of what ships alongside it:

- `claude_code_log/models.py` — 2,321 lines of **Pydantic models** covering every transcript entry type, with field-level comments explaining Claude Code's own quirks.
- `dev-docs/messages.md` (1,066 lines) — a written specification of every message type, its discriminating condition, and its rendering.
- `dev-docs/message-hierarchy.md`, `dev-docs/application_model.md`, `dev-docs/dag.md` — the parent/child DAG reconstruction problem written up properly.
- `dev-docs/messages/claude-code/` — **72 real captured example files** (`.json` + `.jsonl` pairs) organised as `user/`, `assistant/`, `system/`, and `tools/` (44 tool examples: Bash, Edit, Read, Task, AskUserQuestion, Artifact, BashOutput, …), each with both a `tool_use` and a `tool_result` example, and error variants.

There is no official Anthropic schema for this format (see the schema section). This repo is the closest thing the community has to one, and it is maintained daily.

**Maps to our sections.** Sessions, Forensics, ContextExplorer, ActivityTimeline, WorkingSet — everything downstream of transcript parsing. It is a *reference*, not a port target.

**Port effort: S** — as a schema reference, immediate value for zero code. **M** if we adopt its DAG-reconstruction logic (parentUuid chains with structural passthrough entries) for our session tree, which we should.

---

### 2. `ccusage/ccusage` — the cost arithmetic everyone else copies

| | |
|---|---|
| URL | https://github.com/ccusage/ccusage |
| Stars | 17,542 |
| License | MIT (root `LICENSE` is a pointer to `apps/ccusage/LICENSE`; GitHub reports `NOASSERTION` because of that indirection) |
| Last commit | 2026-07-28 |
| Language | Rust (migrated from TypeScript) |

**What it does.** `npx ccusage` — zero-install CLI that reads local JSONL and reports daily / monthly / per-session / 5-hour-block token and cost breakdowns, with a live monitor mode and JSON output. Now a Rust workspace with per-agent adapters (`rust/adapters/{claude,codex,gemini,copilot,opencode,kimi,…}`) sharing a common JSONL loader.

**Why it matters to US.** Two specific, portable pieces of knowledge:

1. **The deduplication key.** `rust/adapters/claude/src/lib.rs` dedupes usage records by hashing `message.id` + `requestId` (`usage_dedupe_hash(message_id, request_id)`), with a separate sidechain-aware variant. Without this you double-count tokens, because the same assistant message can appear more than once across resumed/branched sessions. If our UsagePanel does not do this, its numbers are wrong.
2. **The `iterations` array.** The same file parses `message.usage.iterations[]`, filtering on `type == "advisor_message"` to attribute sub-model usage separately. Confirmed present in local transcripts (see schema section). Naive parsers that only read `message.usage.input_tokens` miss this entirely.

It also maintains a models.dev-derived pricing lock (`nix/tools/models-dev-gen/`) rather than hardcoding prices — the right pattern for a "null is never rendered as 0" project, because an unknown model yields *no* cost rather than a wrong one.

**Maps to our sections.** UsagePanel, Sessions, Insights.

**Port effort: S** for the dedupe key and iterations handling (both are small, well-defined algorithms). **M** if we adopt an external pricing table with graceful unknown-model handling.

---

### 3. `mikehasa/agentacct` — our thesis, already shipped, in Python

| | |
|---|---|
| URL | https://github.com/mikehasa/agentacct |
| Stars | 518 |
| License | MIT |
| Last commit | 2026-07-28 |
| Language | Python |

**What it does.** `pipx install agentacct; agentacct onboard` starts a dashboard on `127.0.0.1:8765` that reads Claude Code and Codex session logs read-only and joins them to "Tasks" with recorded work steps and machine checks.

**Why it matters to US.** This is the **closest philosophical competitor in the entire 690**, and it is uncomfortably close. Its README, attributed, promises "**Private by design**" and a dashboard that "never leaves your machine," with no phone-home telemetry, no account, no cloud sync, and no provider API key. Beyond that it does three things we should study hard:

- **Provenance labels on every number.** Token counts are labelled `client_reported`; costs are explicitly marked pricing-table *estimates*, "never invoices."
- **Confidence-labelled joins.** Every usage↔work join carries `exact`/`high`/`medium`/`low`, and the README states the principle directly, attributed: "Missing attribution beats wrong attribution."
- **Evidence tiers.** A passing test is `Verified`; an agent's own claim stays labelled `Agent reported`.

That last point is the same instinct as our "null is never rendered as 0," taken further — they don't just refuse to fake a number, they grade the confidence of every derived one. We should steal the vocabulary.

Differences that leave us room: it is Python + pipx (heavier install), it is **WSL-only on Windows**, its dashboard is deliberately zero-JavaScript (so no d3, no interactive import graph), and it does not do code-structure analysis — no import graph, no blast radius, no coverage join.

**Maps to our sections.** Overview, UsagePanel, WorkingSet, Quality, Delivery, TeamBaseline.

**Port effort: M** — the confidence/provenance labelling model is a cross-cutting change to how we render every metric, not a single section.

---

### 4. `davila7/claude-code-templates` — the 30k-star incumbent nobody flagged

| | |
|---|---|
| URL | https://github.com/davila7/claude-code-templates |
| Stars | 29,958 |
| License | MIT |
| Last commit | 2026-07-28 |
| Language | Python (mixed; distributed via npm) |

**What it does.** GitHub's own one-line description, attributed: "CLI tool for configuring and monitoring Claude Code." It ships several modes behind one npx entrypoint: `--analytics` (real-time session monitoring with live state detection and performance metrics), a Conversation Monitor (mobile-optimised live view of Claude responses), and `--plugins` (a Plugin Dashboard for marketplaces, installed plugins, and permission management).

**Why it matters to US.** This is the **single largest project in the ecosystem that overlaps our scope** — config + monitoring + plugin management in one tool — and it was not on our research list. At 30k stars with daily commits and corporate sponsorship (Vercel OSS, Neon, Bright Data, Z.AI badges in the README), it is the default answer many people will already have installed. We need to know precisely what its analytics view does and does not compute before claiming any of it as novel. Its plugin/permission dashboard overlaps our Setup, Mcp, Hooks, and Governance sections directly.

Caveat worth noting honestly: it is a very broad tool (templates + agents + commands + MCP + analytics), which usually means each surface is shallower than a dedicated one. Unverified until someone runs it.

**Maps to our sections.** Setup, Hooks, Mcp, Governance, Library, ProjectHub, Sessions.

**Port effort: L** to match its breadth; **S** to differentiate from it (we don't need to match a template marketplace).

---

### 5. `simonw/claude-code-transcripts` — careful parsing, and a warning

| | |
|---|---|
| URL | https://github.com/simonw/claude-code-transcripts |
| Stars | 1,643 |
| License | Apache-2.0 |
| Last commit | 2026-02-12 — **~5.5 months stale** |
| Language | Python |

**What it does.** Converts Claude Code session files (JSON or JSONL) to paginated, mobile-friendly HTML. Four commands: `local` (picker over `~/.claude/projects`), `web` (via the Claude API), `json` (a specific file), `all` (browsable archive of everything). Generates an `index.html` with a timeline of prompts **and commits**, plus `page-NNN.html` pages. Supports `--repo OWNER/NAME` for commit links (auto-detected), and `--gist` upload.

**Why it matters to US.** Two things. First, Simon Willison writes up his reverse-engineering publicly — his post "A new way to extract detailed transcripts from Claude Code" (2025-12-25) is a primary source on the format. Second, the **prompt-and-commit timeline** is precisely the join our ActivityTimeline and Delivery sections are built on, and it's the only place in either list I saw it done.

The cautionary half: the README carries a prominent warning that its `web` commands are broken, attributed, "due to changes to the unofficial and undocumented APIs that these commands were using" (issue #77). That is a live demonstration of the risk our whole product carries — **we depend on undocumented local formats, and they change.** The local JSONL commands still work; only the web-API path broke. Worth citing internally when arguing for defensive parsing.

**Maps to our sections.** ActivityTimeline, Delivery, Sessions, Forensics.

**Port effort: S** for the prompt↔commit timeline concept.

---

### 6. `es617/claude-replay` — session replay as a shareable artefact

| | |
|---|---|
| URL | https://github.com/es617/claude-replay |
| Stars | 776 |
| License | MIT |
| Last commit | 2026-07-24 |
| Language | JavaScript, **zero dependencies** |

**What it does.** Turns agent session logs into a **single self-contained HTML file** with interactive playback (speed control), collapsible tool-call and thinking blocks, bookmarks/chapters, a file-activity sidebar, multiple themes, and **secret redaction before export**. `--serve --watch` gives live monitoring. Also ships a web editor UI and a Docker image that mounts `~/.claude/projects` read-only.

**Why it matters to US.** Three reasons, in order:

1. **It documents the multi-agent transcript locations** in a table: Claude Code `~/.claude/projects/<project>/`, Cursor `~/.cursor/projects/<project>/agent-transcripts/<id>/`, Codex `~/.codex/sessions/<date>/`, Gemini `~/.gemini/tmp/<projectHash>/chats/`, Kimi `~/.kimi-code/sessions/<project>/<session>/agents/<name>/wire.jsonl`. Free multi-agent roadmap.
2. **Secret redaction before export** is a feature we currently lack and will need the moment anyone wants to share anything out of Loush Dashboard. This is a solved problem we can copy rather than invent.
3. **File activity sidebar** — which files were touched, click to jump to the tool call — is a lightweight cousin of WorkingSet, and validates that the interaction pattern reads well.

Zero dependencies and plain JS makes it unusually easy to read for a React+Vite codebase. It is also careful about framing: the README states, attributed, "Community tool — not affiliated with or endorsed by Anthropic."

**Maps to our sections.** Sessions, WorkingSet, Artifacts, Forensics.

**Port effort: M** for an embedded replay view; **S** for the redaction pass alone.

---

### 7. `stefanprodan/cctop` — the read-only discipline, done right

| | |
|---|---|
| URL | https://github.com/stefanprodan/cctop |
| Stars | 126 |
| License | Apache-2.0 |
| Last commit | 2026-07-26 |
| Language | TypeScript (single Bun binary, **zero npm dependencies**) |

**What it does.** A `top`-style TUI listing every running Claude Code session with PID, memory, CPU, uptime, busy/idle state, context size, model, host app, project, git branch, and last prompt — plus a live sub-agent tree and each session's sub-processes with **open and orphaned TCP ports**. Can `SIGTERM` a runaway session or free ports held by a leftover dev server. Press `h` for a session-history dashboard: per-day token chart, recent sessions, breakdowns by model, tool/MCP, and project.

**Why it matters to US.** Written by Stefan Prodan (Flux/FluxCD maintainer), and the engineering discipline shows. The README states its data contract explicitly, attributed: it "reads only `~/.claude` and the process table, spawns no processes," and the only files it writes are its own prefs and usage cache under `~/.claude/cctop/`. That is our thesis stated as an invariant, by someone with a track record.

Concretely portable:
- **Breakdowns by tool/MCP** in the history view — we compute tool counts but the MCP-server dimension is a cheap, high-signal addition to Insights and Mcp.
- **Orphaned port detection.** Agents leave dev servers running. Nobody else in either list surfaces this, and it's a real daily annoyance. Strong candidate for QuickActions.
- Its `--capture-usage` trick: it piggybacks on the Claude Code statusline hook to persist account-wide 5h/7d rate-limit stats to `~/.claude/cctop/usage.json`, because that data is only available on the statusline stdin payload. **That is the only supported way to get rate-limit data**, and it's worth knowing.

**Maps to our sections.** Sessions, Runs, Resource, Reliability, Mcp, QuickActions, Insights.

**Port effort: M** — process-table reading from Express on Windows is real work; the tool/MCP breakdown alone is **S**.

---

### 8. `disler/claude-code-hooks-multi-agent-observability` — the canonical hook-event reference

| | |
|---|---|
| URL | https://github.com/disler/claude-code-hooks-multi-agent-observability |
| Stars | 1,500 |
| License | **None declared** (GitHub reports no license) |
| Last commit | 2026-02-08 — **~5.5 months stale** |
| Language | Python (hooks) + Bun/Vue |

**What it does.** Architecture, in its own README's words: `Claude Agents → Hook Scripts → HTTP POST → Bun Server → SQLite → WebSocket → Vue Client`. Captures every Claude Code hook event across concurrent agents with session tracking, event filtering, and live updates. You copy its `.claude` directory into your project root.

**Why it matters to US.** It is the reference implementation everyone else in the observability bucket riffs on, and its `.claude/settings.json` hook wiring is the best worked example of registering every lifecycle event at once. Our Hooks section should be able to *generate* that wiring.

But read it as a **contrast case, not a port target**: it requires `uv`, Bun, a running server, an `ANTHROPIC_API_KEY`, and copying files into every project you want observed. It also has no license, which means we cannot legally copy code from it — only learn from the design. And it has been untouched for 5.5 months while Claude Code shipped a lot of changes.

The strategic read: **hook-based collection is opt-in, prospective, and invasive. Transcript-based collection is zero-setup and retrospective.** We already have every session on disk without having installed anything. That is a genuine advantage and we should say so out loud in our positioning.

**Maps to our sections.** Hooks, Harness, ActivityTimeline, Runs.

**Port effort: S** (design study only — no license to copy from).

---

### 9. `simple10/agents-observe` — hook observability as a plugin

| | |
|---|---|
| URL | https://github.com/simple10/agents-observe |
| Stars | 629 |
| License | MIT |
| Last commit | 2026-07-22 |
| Language | TypeScript |

**What it does.** The modern successor to disler's design, packaged properly: `claude plugin marketplace add simple10/agents-observe` then `claude plugin install agents-observe`. Auto-starts an MCP server, registers hooks across the session lifecycle, streams to a local React UI on `localhost:4981` backed by SQLite, with filtering, parent/subagent hierarchy, full session replay, per-model token stats and cost breakdowns. Ships `/observe status|debug|logs|restart|view|stats` skills.

**Why it matters to US.** This is the **best-packaged distribution model** in the observability bucket and worth copying wholesale as a delivery mechanism: a Claude Code plugin marketplace entry that installs hooks, starts a server, and exposes slash commands for its own diagnostics. `/observe debug` as a self-troubleshooting command is a genuinely good idea for a tool whose failure mode is "the data isn't showing up."

It also documents the plugin data-directory convention precisely: `$CLAUDE_PLUGIN_DATA`, which Claude Code names `<plugin>-<marketplace>`, landing at `~/.claude/plugins/data/agents-observe-agents-observe/`. Useful if we ever ship as a plugin.

Cost of entry: it **requires Docker**, plus Node and Bash. That is a hard sell versus our `npm run dev`.

**Maps to our sections.** Hooks, Harness, Runs, Sessions, Setup.

**Port effort: M** to ship Loush Dashboard as a plugin with slash-command diagnostics.

---

### 10. `jianshuo/ccglass` — ground truth on what actually gets sent

| | |
|---|---|
| URL | https://github.com/jianshuo/ccglass |
| Stars | 644 |
| License | MIT |
| Last commit | 2026-07-09 |
| Language | JavaScript |

**What it does.** A local logging reverse-proxy plus web dashboard. `ccglass claude` starts a proxy, points Claude Code at it via `ANTHROPIC_BASE_URL`, launches it, and opens a dashboard showing every request in real time: **the full system prompt, every tool schema, the complete message history, token/cache/cost numbers, and a turn-to-turn diff**. Supports Claude Code, Codex, OpenCode, Kimi, Bedrock, Ollama, LM Studio, OpenRouter and more.

**Why it matters to US.** This is the only project in either list that sees the **actual wire payload**, and its README explains exactly why that is hard: these CLIs are Node/native apps that ignore `HTTP_PROXY`/`HTTPS_PROXY`, so Charles and mitmproxy never see the traffic, and fetch-patching breaks on updates. ccglass sidesteps TLS entirely — the client does HTTPS to the real API itself; you intercept only the plain HTTP hop to localhost. No CA certs, no pinning.

For our **ContextExplorer** this is decisive information: the transcript on disk is *not* the same thing as the context window sent to the model. System prompt, tool schemas, and cache boundaries are only visible at the wire. If ContextExplorer claims to show "what the model saw," we should either adopt this technique or be explicit that we show the transcript, not the request.

The **turn-to-turn diff** — what changed in the context between turns — is the single best feature idea I found for ContextExplorer.

**Maps to our sections.** ContextExplorer, PromptStudio, PromptQuality, Harness.

**Port effort: L** (a proxy is a new runtime component and an env-var mutation of the user's setup) — but **S** to adopt the turn-to-turn context-diff *visualisation* over transcript data we already have.

---

### 11. `millionco/claude-doctor` — behavioural forensics, and the closest thing to our Insights

| | |
|---|---|
| URL | https://github.com/millionco/claude-doctor |
| Stars | 609 |
| License | **None declared** |
| Last commit | 2026-04-15 — **~3.5 months stale** |
| Language | TypeScript |

**What it does.** `npx claude-doctor` analyses `~/.claude/` transcripts for behavioural anti-patterns and generates rules for CLAUDE.md/AGENTS.md from your own history. It defines named, thresholded signals:

*Structural:* `edit-thrashing` (same file edited 5+ times in one session), `error-loop` (3+ consecutive tool failures without changing approach), `excessive-exploration` (read-to-edit ratio above 10:1), `restart-cluster` (multiple sessions started within 30 minutes), `high-abandonment-rate` (most sessions have fewer than 3 user messages).

*Behavioural:* `correction-heavy` (20%+ of user messages start with "no"/"wrong"/"wait"), `keep-going-loop`, `repeated-instructions` (same instruction rephrased within 5 turns, Jaccard >60%), `negative-drift`, `rapid-corrections` (user responds within 10s), `high-turn-ratio`.

*Lexical:* AFINN-165 sentiment scoring with custom agent tokens (`undo`, `revert`, `wrong`, `broken`).

Modes: `--rules` (paste-ready CLAUDE.md rules), `--save` (writes `model.json` baselines + `guidance.md`), `--json`, `-p <project>`.

**Why it matters to US.** These are **ready-made, concretely-thresholded metric definitions** for Forensics, Quality, Insights, and PromptQuality — the hardest part of building those sections is deciding what to measure, and this repo has already done it and shipped the thresholds. `edit-thrashing` is essentially our rework rank stated in transcript terms; we can validate our WorkingSet rework metric against it.

The `--rules` loop — analyse history, emit CLAUDE.md rules — is the **closed feedback loop that the entire Linting category is missing** (see heat map). Combining it with our Governance section (which already writes config with backups) would produce something genuinely new: *observe behaviour → propose rule → write it to real config with a timestamped backup.*

Caveats: no license (design study only, cannot copy code), and 3.5 months stale.

**Maps to our sections.** Forensics, Insights, Quality, PromptQuality, Governance, WorkingSet.

**Port effort: M** — the signal definitions are S each, but there are eleven of them plus a sentiment pass.

---

### 12. `agent-sh/agnix` — the linter/LSP for everything in `.claude`

| | |
|---|---|
| URL | https://github.com/agent-sh/agnix |
| Stars | 370 |
| License | Apache-2.0 (README badges advertise dual MIT/Apache-2.0) |
| Last commit | 2026-07-27 |
| Language | Rust |

**What it does.** A linter and LSP for AI-assistant config with, per its README, **444 rules** across Claude Code, Codex CLI, OpenCode, Cursor, and Copilot — validating CLAUDE.md, SKILL.md, hooks, and MCP configs, with autofixes. Ships as npm (`agnix`) and crates.io (`agnix-cli`), a GitHub Action, and editor plugins for VS Code, JetBrains, Neovim, and Zed. Has a hosted playground.

**Why it matters to US.** Our Setup, Governance, Hooks, and Mcp sections all read and write these exact files. agnix is the most complete public enumeration of **what "valid" means** for each of them. Even if we never run it, its rule catalogue is a specification of the config surface we edit — and if we shell out to it (it's a single Rust binary, cross-platform, Apache-2.0), we get 444 validations essentially free and can render the diagnostics in Governance.

Its stated motivation is also a good argument for our Setup section: misconfigured skills silently do nothing. The README cites Vercel research that skills invoke at 0% without correct syntax (link in README; the underlying claim is theirs, unverified by me).

**Maps to our sections.** Setup, Governance, Hooks, Mcp, Quality, Library.

**Port effort: S** to shell out and render diagnostics; **L** to reimplement.

---

### 13. `nyatinte/ccexp` — config discovery, and a warning about staleness

| | |
|---|---|
| URL | https://github.com/nyatinte/ccexp |
| Stars | 270 |
| License | MIT |
| Last commit | 2025-11-08 — **~8.5 months stale** |
| Language | TypeScript (React Ink) |

**What it does.** An interactive split-pane TUI for discovering, previewing, and managing Claude Code config: CLAUDE.md files, slash commands, subagents. Live search, markdown preview with syntax highlighting, copy content/path, open in default app.

**Why it matters to US.** Its value is the **discovery rules**, which are an explicit inventory of where Claude Code config lives:

- Memory: `CLAUDE.md` (project), `CLAUDE.local.md` (local overrides, gitignored — and the README flags it as deprecated, linking Anthropic's memory docs), `~/.claude/CLAUDE.md` (user).
- Commands: `.claude/commands/**/*.md` (project), `~/.claude/commands/**/*.md` (user).
- Subagents: `.claude/agents/**/*.md` (project) — plus the user-level equivalent.

That is exactly the file set our Setup, Library, and Customize sections must enumerate, with the project/user precedence made explicit. Cheap to validate our own globs against.

**Honest caveat:** 8.5 months without a commit, in an ecosystem that shipped plugins, skills, and marketplaces in that window. It is a **reference for the stable parts of the config layout**, not a live dependency. Its own discovery list is already missing `.claude/skills/` and `.claude/plugins/`.

**Maps to our sections.** Setup, Library, Customize, ProjectHub.

**Port effort: S**.

---

### 14. `sirmalloc/ccstatusline` — the statusline payload, and the rate-limit data source

| | |
|---|---|
| URL | https://github.com/sirmalloc/ccstatusline |
| Stars | 12,063 |
| License | MIT |
| Last commit | 2026-07-25 |
| Language | TypeScript |

**What it does.** The dominant statusline for Claude Code — widget-based, powerline support, themes, gradients, TUI configurator. Its changelog is a de-facto field guide to what is *available* to a statusline: `Compaction Counter` (counts explicit `compact_boundary` markers with trigger splits and tokens reclaimed), `Cache Hit Rate` / `Cache Read` / `Cache Write` widgets with turn and session scopes, `Extra Usage Used` / `Extra Usage Utilization` / `Extra Usage Remaining` (monthly pay-as-you-go overage, with the billing currency reported by the usage API), `Tokens Input`/`Tokens Output` that "prefer cumulative transcript metrics before falling back to context-window totals", and `terminal_width` supplied to custom-command widgets via stdin JSON.

**Why it matters to US.** Three concrete takeaways:

1. **`compact_boundary` is a first-class marker.** Our Sessions/ContextExplorer should count compactions and show tokens reclaimed. Confirmed in the schema section — Claude Code writes `system` entries with `compactMetadata` containing `preTokens`, `postTokens`, `trigger`, `durationMs`.
2. **Cache hit rate is a first-class metric with turn and session scopes.** We have the raw fields (`cache_read_input_tokens`, `cache_creation_input_tokens`) but likely aren't surfacing the ratio. Cheap, high-signal addition to UsagePanel.
3. **Rate-limit and overage data does not live in the transcript.** ccstatusline fetches it from a usage API and caches it (`~/.cache/ccstatusline/git-cache` for git; a separate usage cache). Combined with cctop's `--capture-usage` statusline trick, the conclusion is firm: **a pure filesystem reader cannot show rate-limit percentages.** If our UsagePanel shows quota, it must either install a statusline hook or leave it null — which our "null is never rendered as 0" rule already handles correctly.

Also of operational interest: it caches git command output with TTL plus `.git/HEAD`/`.git/index` mtime checks, and passes `--no-optional-locks` to avoid `index.lock` races. Our server does git work on the same repos the agent is using — we should adopt `--no-optional-locks`.

**Maps to our sections.** UsagePanel, Sessions, ContextExplorer, Customize, Setup, Harness.

**Port effort: S** for cache-hit-rate and compaction metrics; **S** for the git-lock fix.

---

### 15. `nikitadoudikov/claude-pulse` — the closest UX competitor

| | |
|---|---|
| URL | https://github.com/nikitadoudikov/claude-pulse |
| Stars | 235 |
| License | MIT |
| Last commit | 2026-07-19 |
| Language | JavaScript, **zero dependencies**, Node >= 18 |

**What it does.** A local dashboard watching every Claude Code and Codex session. Live spend by hour/day/week, **context fill per session**, **full-text search across everything you have ever run**, lost-session recovery, scheduled messages that fire when your limit resets, and Allow / Allow all / Deny tool approvals that follow you to desktop, phone, and (on macOS) a native notch strip compiled from ~100 lines of Swift. Plus a gamified profile: rank, streak, achievements, GitHub-style activity heatmap, all computed from local logs.

**Why it matters to US.** Same architecture as ours — read the files Claude Code already writes, no account, no telemetry, zero deps — and it has real press (its README cites XDA Developers coverage). Two features we don't have and should:

- **Full-text search across all history.** Our Sessions/ContextExplorer would benefit enormously and we have the corpus already.
- **Lost-session recovery.** Surfacing sessions that ended abnormally so you can resume them is a genuinely useful, purely-local capability.

Where we differ, and it matters: claude-pulse is a *usage and liveness* dashboard with delightful chrome. It does not touch the repo. No import graph, no coverage, no config writing, no JIRA/CI. **The overlap is the shell, not the substance** — but its polish sets the bar for what "a local dashboard for Claude Code" is expected to feel like, and its notch/mobile approval flows are a reminder that we have no mobile story.

**Maps to our sections.** Sessions, UsagePanel, Overview, ActivityTimeline, ContextExplorer, Inbox, QuickActions.

**Port effort: M** for full-text search over the transcript corpus; **S** for lost-session detection.

---

## Transcript JSONL schema references

**Priority deliverable.** Findings come from three independent tiers, in descending order of authority: (1) official Anthropic documentation; (2) code Anthropic ships; (3) community parsers and a direct empirical survey of real transcripts on this machine.

### Tier 1 — What Anthropic officially documents

**Canonical docs host is `code.claude.com/docs/en/*`.** Both `docs.anthropic.com/en/docs/claude-code/*` and `docs.claude.com/en/docs/claude-code/*` HTTP-301 redirect to it.

**The location and layout ARE documented. The field format is NOT — and is explicitly declared internal.**

`https://code.claude.com/docs/en/sessions#where-transcripts-are-stored` states, attributed to Anthropic's docs:

> "transcripts are stored as JSONL at `~/.claude/projects/<project>/<session-id>.jsonl`"

> "Each line is a JSON object for a message, tool use, or metadata entry."

and that `<project>` is the working directory path with non-alphanumeric characters replaced by `-`. That is the entire extent of official format documentation — three facts, **zero field names**.

`https://code.claude.com/docs/en/claude-directory#application-data` documents the directory layout:

| Path under `~/.claude/` | Documented contents |
|---|---|
| `projects/<project>/<session>.jsonl` | "Full conversation transcript: every message, tool call, and tool result" |
| `projects/<project>/<session>/subagents/` | Subagent conversation transcripts, removed with the parent |
| `projects/<project>/<session>/tool-results/` | "Large tool outputs spilled to separate files" |
| `projects/<project>/memory/` | Auto memory |

Path encoding example given: `/home/user/.claude/projects/-home-user-work-my-repo`.

**The stability disclaimer is explicit.** Same `sessions` page, attributed:

> "The entry format is internal to Claude Code and changes"

…between versions, the sentence continues, so scripts parsing these files can break on any release. The docs direct readers to `/export`, `claude -p --output-format json|stream-json`, `claude -p --resume <session-id>`, or the Agent SDK's `getSessionMessages()` / `listSessions()` instead.

**One correctness caveat that directly affects us.** `https://code.claude.com/docs/en/hooks#common-input-fields` states, attributed:

> "The transcript file is written asynchronously and may lag the in-memory conversation"

So a transcript read may omit the current turn's most recent messages. **Any "live" view we build off the JSONL is eventually-consistent by design.** We should never present a tailing read as authoritative for the in-flight turn.

**A public request for exactly what we want is open and unanswered.** `https://github.com/anthropics/claude-code/issues/53516` — "Stable, documented schema for `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` line types", opened 2026-04-26, still open, labeled `stale`. All 6 comments are from non-affiliated users; no Anthropic-employee reply. Non-exhaustive check of the wider tracker, so an employee comment elsewhere is unverified.

### Tier 2 — What Anthropic ships in code

**No official TypeScript types or JSON Schema exist for transcript lines.**

- `@anthropic-ai/claude-code` (v2.1.220) ships exactly one `.d.ts` — `sdk-tools.d.ts` (~149 KB), auto-generated from JSON Schema but covering **tool inputs/outputs only** (`BashInput`, `FileEditInput`, …). Nothing about line structure.
- `github.com/anthropics/claude-code` contains zero `.d.ts` files and zero paths containing `transcript` or `jsonl`. It is an issue tracker / plugins / changelog repo — no CLI source.
- `@anthropic-ai/claude-agent-sdk` (v0.3.220) ships `sdk.d.ts`, `sdk-tools.d.ts`, `bridge.d.ts`, `browser-sdk.d.ts` — no JSON Schema.

The one SDK type that maps to a transcript line exists **specifically to avoid describing the format**. From `sdk.d.ts` (~line 4874), marked `@alpha`:

```ts
export declare type SessionStoreEntry = {
    type: string;
    uuid?: string;
    timestamp?: string;
    [k: string]: unknown;
};
```

Its doc comment states, attributed: "That union is CLI-internal and not part of the SDK API surface", and instructs adapters to treat entries as pass-through blobs, with `JSON.stringify`/`JSON.parse` round-tripping as the only required invariant.

The sanctioned read path, `getSessionMessages()`, returns `SessionMessage` whose payload is `message: unknown` and whose `type` union covers only `'user' | 'assistant' | 'system'` — **3 of the ~13 on-disk types we actually observe.**

**By contrast, two adjacent schemas ARE fully documented**, and both are far more stable footing:

**statusLine stdin payload** — `https://code.claude.com/docs/en/statusline#available-data`. Note there is **no** `hook_event_name` here (that is hooks-only).

- Top level: `cwd`, `session_id`, `session_name`, `prompt_id`, `transcript_path`, `version`, `exceeds_200k_tokens`, `fast_mode`
- `model.{id, display_name}`
- `workspace.{current_dir, project_dir, added_dirs, git_worktree}`, `workspace.repo.{host, owner, name}`
- `output_style.name`
- `cost.{total_cost_usd, total_duration_ms, total_api_duration_ms, total_lines_added, total_lines_removed}`
- `context_window.{total_input_tokens, total_output_tokens, context_window_size, used_percentage, remaining_percentage}`, `context_window.current_usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`
- `effort.level` (`low|medium|high|xhigh|max`), `thinking.enabled`
- **`rate_limits.five_hour.{used_percentage, resets_at}`, `rate_limits.seven_day.{...}`**
- `vim.mode`, `agent.name`, `pr.{number, url, review_state}`, `worktree.{name, path, branch, original_cwd, original_branch}`

Documented as possibly absent: `session_name`, `prompt_id`, `workspace.git_worktree`, `workspace.repo`, `effort`, `vim`, `agent`, `pr`, `worktree`, `rate_limits`.

**This confirms the rate-limit conclusion**: 5h/7d quota data is delivered on the statusLine payload and is **not** in the transcript. A pure filesystem reader cannot compute it. `cctop` exploits exactly this by piping the statusline stdin through `cctop --capture-usage`.

**Hook JSON input/output** — `https://code.claude.com/docs/en/hooks#common-input-fields`.

Common input on every event: `session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode` (`default|plan|acceptEdits|auto|dontAsk|bypassPermissions`), `effort.level`, `hook_event_name`. Subagent contexts add `agent_id`, `agent_type`.

| Event | Additional input fields |
|---|---|
| PreToolUse | `tool_name`, `tool_input`, `tool_use_id` |
| PostToolUse | + `tool_result`, `tool_result_is_error` |
| UserPromptSubmit | `user_input`, `user_input_tokens` |
| Notification | `notification_type`, `message` |
| Stop | `last_assistant_message` |
| SubagentStop | `last_assistant_message`, `agent_id`, `agent_type` |
| PreCompact | `compaction_trigger` (`manual|auto`) |
| SessionStart | `source` (`startup|resume|clear|compact|fork`), `model`, `agent_type`, `session_title` |
| SessionEnd | `exit_reason` (`clear|resume|logout|prompt_input_exit|bypass_permissions_disabled|other`) |

Universal output: `continue`, `stopReason`, `suppressOutput`, `systemMessage`, `terminalSequence`. Exit codes: `0` = stdout parsed as JSON, `2` = blocking error, other = non-blocking. `hookSpecificOutput` shapes — PreToolUse: `{hookEventName, permissionDecision: "allow"|"deny"|"ask"|"defer", permissionDecisionReason, additionalContext, updatedInput}`; PostToolUse: `{hookEventName, additionalContext, updatedToolOutput}`; UserPromptSubmit/Stop/SubagentStop: `{hookEventName, additionalContext}`; SessionStart: `{hookEventName, additionalContext, initialUserMessage, watchPaths, sessionTitle, reloadSkills}`.

### Tier 3a — The best community reference: `daaain/claude-code-log`

Absent an official schema, **`daaain/claude-code-log` is the de-facto community specification** and is maintained daily. Four artefacts, all MIT:

1. **`claude_code_log/models.py`** — 2,321 lines of Pydantic models with field-level commentary.
2. **`dev-docs/messages.md`** — 1,066 lines mapping every input type to its rendering, with the classification conditions written out.
3. **`dev-docs/message-hierarchy.md`**, **`dev-docs/dag.md`**, **`dev-docs/application_model.md`** — the parent/child DAG reconstruction problem.
4. **`dev-docs/messages/claude-code/`** — 72 captured real example files (`.json` + `.jsonl` pairs): 8 `user/`, 3 `assistant/`, 4 `system/`, and **44 `tools/`** covering both `tool_use` and `tool_result` (and error) variants for Bash, Edit, Read, Task, AskUserQuestion, Artifact, BashOutput and more.

Its core Pydantic shapes:

```python
class BaseTranscriptEntry(BaseModel):
    parentUuid: Optional[str];  isSidechain: bool;  userType: str
    cwd: str;  sessionId: str;  version: str;  uuid: str;  timestamp: str
    isMeta: Optional[bool];  agentId: Optional[str];  gitBranch: Optional[str]
    teamName: Optional[str];  spawnedAgentId: Optional[str]   # spawnedAgentId is synthetic (loader-set)

class UserTranscriptEntry(BaseTranscriptEntry):
    type: Literal["user"];  message: UserMessageModel
    toolUseResult: Optional[Union[str, list, dict]];  sourceToolUseID: Optional[str]

class AssistantTranscriptEntry(BaseTranscriptEntry):
    type: Literal["assistant"];  message: AssistantMessageModel;  requestId: Optional[str]

class SummaryTranscriptEntry(BaseModel):
    type: Literal["summary"];  summary: str;  leafUuid: str;  cwd: Optional[str]

class AiTitleTranscriptEntry(BaseModel):
    type: Literal["ai-title"];  aiTitle: str;  sessionId: str

class SystemTranscriptEntry(BaseTranscriptEntry):
    type: Literal["system"];  content, subtype, level: Optional[str]
    hasOutput: Optional[bool];  hookErrors: Optional[list[str]];  hookInfos: Optional[list[dict]]
    preventedContinuation: Optional[bool];  compactMetadata: Optional[dict]   # preTokens, postTokens, trigger, durationMs

class QueueOperationTranscriptEntry(BaseModel):
    type: Literal["queue-operation"]
    operation: Literal["enqueue","dequeue","remove","popAll"]
    timestamp, sessionId: str;  content: Optional[Union[list, str]]
```

Content blocks:

```python
TextContent        = {type: "text", text: str}
ThinkingContent    = {type: "thinking", thinking: str, signature: Optional[str]}
ToolUseContent     = {type: "tool_use", id: str, name: str, input: dict}
ToolResultContent  = {type: "tool_result", tool_use_id: str,
                      content: Union[str, list[dict]], is_error: Optional[bool],
                      agentId: Optional[str]}
ImageContent       = {type: "image", source: {type: "base64", media_type: str, data: str}}

AssistantMessageModel = {id, type: "message", role: "assistant", model: str,
                         content: list[ContentItem], stop_reason, stop_sequence, usage}
UsageInfo             = {input_tokens, cache_creation_input_tokens,
                         cache_read_input_tokens, output_tokens,
                         service_tier, server_tool_use}
```

Two decoding rules worth stealing verbatim:

- **`agentId` is membership, `spawnedAgentId` is causation.** `agentId` says *whose transcript this entry belongs to*; `spawnedAgentId` (synthetic, set by the loader) says *which sub-agent this entry spawned*, resolved from `subagents/agent-<id>.meta.json` (`toolUseId`) or the trunk's `toolUseResult.agentId`. Without both, nested agent→agent spawns cannot be linked.
- **User-text sub-classification is by flag and tag, not by type.** `isMeta: true` → slash command; `<command-name>` tags → slash command; `<local-command-stdout>` → command output; `<bash-input>` → bash input; compacted conversation → compacted summary; `queue-operation` with `operation: "remove"` → user steering (out-of-band input while the agent works).

### Tier 3b — Direct empirical survey (this machine, 2026-07-29)

To validate and extend the above I parsed **37,378 lines across the 220 most-recently-modified transcripts** in `~/.claude/projects/` and extracted **key names and discriminator values only** — no message content. Claude Code version range is whatever wrote these files; treat as a July 2026 snapshot.

**Top-level `type` values observed (13, vs. 3 in the SDK union):**

| `type` | Lines |
|---|---|
| `assistant` | 21,010 |
| `user` | 12,155 |
| `attachment` | 1,297 |
| `last-prompt` | 976 |
| `queue-operation` | 805 |
| `custom-title` | 529 |
| `system` | 305 |
| `mode` | 209 |
| `pr-link` | 54 |
| `bridge-session` | 14 |
| `permission-mode` | 13 |
| `file-history-snapshot` | 3 |
| `file-history-delta` | 1 |

Plus `summary` and `ai-title` documented by `claude-code-log` but not present in this sample.

**Envelope fields present on essentially every message entry:** `parentUuid`, `uuid`, `sessionId`, `timestamp`, `cwd`, `gitBranch`, `version`, `isSidechain`, `userType`, `entrypoint`, `agentId`, `requestId` (assistant), `promptId` (user), `sourceToolAssistantUUID`.

**Attribution fields — undocumented anywhere, and valuable.** These let you attribute a turn to its origin without inference:

| Field | Occurrences |
|---|---|
| `attributionAgent` | 13,243 |
| `attributionSkill` | 3,599 |
| `attributionPlugin` | 3,119 |
| `attributionMcpServer` | 2,203 |
| `attributionMcpTool` | 2,203 |

**Usage / token fields (on `message.usage`, assistant entries):**

```
message.usage.input_tokens
message.usage.output_tokens
message.usage.cache_read_input_tokens
message.usage.cache_creation_input_tokens
message.usage.cache_creation.ephemeral_5m_input_tokens
message.usage.cache_creation.ephemeral_1h_input_tokens
message.usage.service_tier                 # observed: "standard"
message.usage.inference_geo
message.usage.speed
message.usage.server_tool_use.web_search_requests
message.usage.server_tool_use.web_fetch_requests
message.usage.iterations[]                 # per-iteration nested usage
message.usage.iterations[].type            # observed: "message"; ccusage also handles "advisor_message"
message.usage.iterations[].model
message.usage.iterations[].{input_tokens, output_tokens,
                            cache_read_input_tokens,
                            cache_creation_input_tokens,
                            cache_creation.ephemeral_{5m,1h}_input_tokens}
message.diagnostics.cache_miss_reason.{type, cache_missed_input_tokens}
message.stop_reason      # observed: tool_use, end_turn, stop_sequence, null
message.stop_details     # present, observed null in this sample
message.model            # e.g. claude-opus-4-8, claude-opus-5, claude-sonnet-5,
                         #      claude-haiku-4-5-20251001, "<synthetic>"
```

**`message.usage.iterations[]` is the trap.** Summing only `message.usage.input_tokens` under-counts when a turn had multiple inference iterations. And `message.diagnostics.cache_miss_reason` is a *cache-efficiency signal nobody in either list surfaces*.

**`toolUseResult` — the rich, undocumented payload on user entries.** Present on 3,616 of 12,155 user lines. Selected paths:

*File edits (Edit/Write) — the WorkingSet goldmine:*
```
toolUseResult.filePath
toolUseResult.oldString / newString / replaceAll
toolUseResult.originalFile            # full pre-edit content
toolUseResult.userModified            # bool — did the human hand-edit after the agent?
toolUseResult.structuredPatch[]       # unified-diff hunks
toolUseResult.structuredPatch[].oldStart / oldLines / newStart / newLines / lines
```
`structuredPatch` appeared on 784 entries; **this gives exact added/removed line counts per edit without re-diffing the repo**, and `userModified` is a direct human-correction signal.

*Reads:*
```
toolUseResult.file.{filePath, content, numLines, startLine, totalLines,
                    truncatedByTokenCap, type, base64, originalSize}
toolUseResult.file.dimensions.{originalWidth, originalHeight, displayWidth, displayHeight}
```

*Bash:* `stdout`, `stderr`, `interrupted`, `isImage`, `noOutputExpected`, `returnCodeInterpretation`, `backgroundTaskId`, `backgroundCwdHint`, `timedOutAfterMs`

*Git (structured!):*
```
toolUseResult.gitOperation.commit.{kind, sha}
toolUseResult.gitOperation.push.branch
toolUseResult.gitOperation.branch.{action, ref}
```
Claude Code **already structures git operations for you** — no need to parse `git` stdout to know a commit or push happened. Directly usable by Delivery and ActivityTimeline.

*Sub-agent (Agent/Task) results — a free per-subagent rollup:*
```
toolUseResult.{agentId, agentType, resolvedModel, prompt, status, resumedAgentId, totalDurationMs, totalTokens, totalToolUseCount}
toolUseResult.toolStats.{bashCount, editFileCount, readCount, searchCount,
                         otherToolCount, linesAdded, linesRemoved}
toolUseResult.usage.{…same shape as message.usage, incl. iterations[]}
```

*Search:* `filenames`, `numFiles`, `numLines`, `totalMatches`, `truncated`, `countIsComplete`, `matches`, `query`
*Other:* `questions[]`/`answers` (AskUserQuestion), `task.{id,subject}`, `taskId`, `statusChange.{from,to}`, `mode`, `updatedFields`, `pin.{id,name,ref}`, `total_deferred_tools`

**`attachment` entries (1,297) — out-of-band harness events.** `attachment.type` values observed:

`task_reminder` (492) · `deferred_tools_delta` (230) · `skill_listing` (225) · `queued_command` (106) · `hook_additional_context` (55) · `command_permissions` (41) · `mcp_instructions_delta` (37) · `edited_text_file` (31) · `agent_listing_delta` (30) · `hook_success` (29) · `read_truncation_notice` (11) · `date_change` (4) · `directory` (3) · `file` (2) · `auto_mode` (1)

With fields including `attachment.hookEvent` (`SessionStart`, `PostToolUse`), `attachment.hookName` (`SessionStart:startup`, `PostToolUse:Edit`, `PostToolUse:Write`), `attachment.{stdout, stderr, exitCode, durationMs, command}`, `attachment.{addedLines, addedNames, removedNames, readdedNames, addedTypes, removedTypes}`, `attachment.{skillCount, itemCount, allowedTools, pendingMcpServers, needsAuthMcpServers}`, `attachment.toolUseID`.

**Hook execution results are in the transcript.** `attachment.type: "hook_success"` with `stdout`/`stderr`/`exitCode`/`durationMs` means **we can show hook reliability and latency retrospectively, with no collector daemon**. This is a direct, concrete capability for our Hooks and Reliability sections that nothing in either list does.

**Other discriminators observed:** `entrypoint` ∈ {`claude-desktop`, `cli`} · `userType` = `external` · `subtype` ∈ {`stop_hook_summary`, `turn_duration`, `local_command`, `api_error`, `informational`, `scheduled_task_fire`} · `level` ∈ {`suggestion`, `info`, `error`, `notice`} · `operation` ∈ {`enqueue`, `dequeue`, `remove`} · `effort` ∈ {`high`, `medium`} · `content_block.caller.type` = `direct` · content block types ∈ {`tool_use`, `tool_result`, `thinking`, `text`, `image`}.

### Tier 3c — The sidecar files, and an undocumented first-party goldmine

Confirmed on disk, corroborating the official `claude-directory` page:

```
~/.claude/projects/<slug>/<sessionId>.jsonl                              # trunk transcript
~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.jsonl         # subagent transcript
~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.meta.json     # {agentType, description, spawnDepth, toolUseId}
~/.claude/projects/<slug>/<sessionId>/tool-results/<id>.txt              # spilled large tool outputs
```

`agent-<id>.meta.json` carries exactly four keys — `agentType`, `description`, `spawnDepth`, `toolUseId` — and `spawnDepth` gives us nesting depth for free.

**And then there are three stores nobody in either list appears to touch:**

**1. `~/.claude/usage-data/session-meta/<sessionId>.json`** — a **first-party, pre-computed per-session rollup written by Claude Code itself**. 51 files present locally. Keys:

```
session_id, project_path, start_time, duration_minutes, transcript_mtime
first_prompt
input_tokens, output_tokens
user_message_count, assistant_message_count
user_message_timestamps, user_response_times, message_hours
user_interruptions
files_modified, lines_added, lines_removed, languages
git_commits, git_pushes
tool_counts, tool_errors, tool_error_categories
uses_mcp, uses_task_agent, uses_web_fetch, uses_web_search
```

This is, essentially, **half of our Overview and Insights sections already computed and sitting on disk**. `lines_added`/`lines_removed`/`files_modified`/`languages`/`tool_error_categories`/`user_interruptions` are precisely the metrics we derive by hand.

**2. `~/.claude/usage-data/facets/<sessionId>.json`** — Claude Code's own **LLM-derived qualitative assessment** of each session:

```
session_id, session_type, underlying_goal, goal_categories, brief_summary,
outcome, primary_success, claude_helpfulness,
user_satisfaction_counts, friction_counts, friction_detail
```

Observed `friction_counts` keys include `buggy_code`; `goal_categories` include `warmup_minimal`. This is a *sentiment and outcome grade per session, generated locally*. `millionco/claude-doctor` reimplements a cruder version of this with AFINN sentiment scoring; the first-party version is already there.

**3. `~/.claude/file-history/<sessionId>/<fileHash>@vN`** — **versioned snapshots of every file the agent touched**, numbered `@v1`, `@v2`, `@v3`. This is the checkpoint/rewind store. It is a direct, exact source for **rework rank** — the number of versions per file per session *is* the churn count, no diffing required.

**Also present, less exotic:** `~/.claude/sessions/<pid>.json` — a live process registry with `{sessionId, pid, procStart, cwd, entrypoint, version, kind, name, nameSource, peerProtocol, startedAt}`, which is the supported-ish way to enumerate *running* sessions without scanning the process table. And `~/.claude/history.jsonl` — a flat prompt history with `{display, pastedContents, project, sessionId, timestamp}`.

**Caveats on all three.** Undocumented, version-dependent, and present on this machine's Claude Code build; `usage-data/` also contains `report.html`, suggesting it backs a built-in usage report feature that may be gated or may change. **Verify presence before depending on any of it, and render null when absent.** But if it is broadly present, it is the highest-leverage unexploited data source in the ecosystem.

### Practical guidance for us

1. **Parse defensively and version-tolerantly.** Anthropic says the format changes; `simonw/claude-code-transcripts` is a live example of a tool broken by exactly that. Treat unknown `type` values as skippable structural entries (the `PassthroughTranscriptEntry` pattern in `claude-code-log`) rather than errors, so a new record type never blanks a whole session.
2. **Prefer documented surfaces where equivalent data exists.** Hook input and statusLine stdin are documented and stable; the transcript is not. Rate limits and `cost.total_cost_usd` are *only* available on the statusLine payload.
3. **Never present a tail-read as live truth** — the file lags in-memory state, per Anthropic's own hooks docs.
4. **Dedupe usage by `message.id` + `requestId`** (the `ccusage` key), and sum `message.usage.iterations[]`, not just the top-level usage.
5. **Mine `toolUseResult`.** `structuredPatch`, `userModified`, `gitOperation`, and `toolStats` are the richest unexploited fields in the file, and all four map straight onto WorkingSet.

---

## Where Loush Dashboard is differentiated

Honest assessment after reading 690 entries plus 15 repos in depth.

### Things we thought were unique that are NOT

- **"Local-first, zero telemetry."** This is table stakes, not a differentiator. `agentacct` promises "Private by design", "no phone-home telemetry, no account, no cloud sync"; `cctop` "reads only `~/.claude` and the process table, spawns no processes"; `claude-pulse` is "read only, no account, no telemetry"; `ccusage` "Runs entirely locally". Every serious tool in this space says it. We should state it as a baseline and stop treating it as the pitch.
- **"Reads `~/.claude/projects/**/*.jsonl`."** Dozens of tools do this. It is the ecosystem's default data source.
- **Token and cost computation.** ~40 tools, four of them with 8k–17.5k stars. `ccusage` has better cost arithmetic than we are likely to build. We should consider *matching its numbers* a correctness requirement rather than a feature.
- **Session browsing and transcript rendering.** `claude-code-log`, `claude-code-transcripts`, `claude-replay`, `claude-pulse` all do it, several better than a Sessions tab.
- **Live session status / "which agent needs me".** Seven dedicated tools in list A alone, most of them native macOS. We will not win this.
- **Hook-event observability.** `agents-observe` and disler's system own this pattern.
- **Config file discovery and linting.** `ccexp`, `agnix` (444 rules), `Ctxlint`, `Schliff`.

### Things that appear genuinely differentiated

**1. Joining transcript history to code structure.** WorkingSet's combination — files an agent edited × rework rank × blast radius via import graph × test coverage — has **no analogue anywhere in 690 entries**. The nearest neighbours are `claude-doctor`'s `edit-thrashing` signal (churn count only, no graph), `claude-replay`'s file-activity sidebar (a list, no analysis), and `selvedge` at 17 stars (reasoning capture, no structure). Nobody builds an import graph. Nobody joins to coverage. This is the moat and everything else should be positioned around it.

**2. Retrospective-by-default, zero-setup collection.** Every observability tool in the lists is *prospective*: install hooks, run a collector, copy a `.claude` directory, start Docker, then wait for data. We read what is already on disk and can show you six months of history the first time you open it. That framing — "no instrumentation, full history, today" — is not being made by anyone and it is our strongest positioning line.

**3. Reading back hook execution results from the transcript.** `attachment.type: "hook_success"` with `stdout`/`stderr`/`exitCode`/`durationMs` means we can report hook reliability and latency **without a collector**. The entire hook-observability category requires a daemon to get this. We can get it from a file read. Nobody does this.

**4. The undocumented first-party stores.** `usage-data/session-meta/` (pre-computed per-session code metrics), `usage-data/facets/` (first-party outcome/friction grading), and `file-history/<session>/<hash>@vN` (versioned file snapshots = exact rework counts). I found **no evidence any project in either list reads any of these.** If they are broadly present across installs, this is a durable advantage — and `file-history` in particular makes our rework rank exact rather than inferred.

**5. Writing config safely with timestamped backups.** Linters validate; template tools install; nobody edits live `settings.json` / hooks / MCP config as a first-class, reversible operation. Combined with `claude-doctor`'s "observe behaviour → propose CLAUDE.md rule" loop, the round trip *observe → propose → write with backup → re-observe* is unclaimed territory.

**6. Delivery joins (JIRA / GitHub / CI) and the Ticket section.** Zero entries in either list join agent sessions to ticket systems or CI. `simonw/claude-code-transcripts` does prompts↔commits and that is the entire state of the art. Our Delivery and Ticket sections have no competitor here.

**7. "Null is never rendered as 0."** Rare, though not unique — `agentacct` goes further with `exact`/`high`/`medium`/`low` confidence labels and `Verified` vs `Agent reported` evidence tiers. We should adopt their vocabulary rather than claim the idea.

**8. Cross-platform reach.** The session-monitor field is macOS-native; `agentacct` is WSL-only on Windows. A browser-based Node/Express dashboard works everywhere, and this scan was itself run on Windows 11.

### The honest strategic read

Our *shell* — a local web dashboard over `~/.claude` — is a commodity, and `claude-pulse` and `agentacct` occupy it well. Our *substance* — the join between agent history and the repo's actual structure and quality — is genuinely empty ground. Every section that is a counter (UsagePanel, Sessions, Overview) should aim for *correct and unsurprising*, borrowing `ccusage`'s arithmetic outright. Every section that is a judgement (WorkingSet, Quality, Forensics, Insights, Delivery, Governance) is where the differentiation lives and where the effort belongs.

---

## Recommended additions to the research queue

Ranked by expected value of a dedicated deep dive.

1. **`daaain/claude-code-log`** — https://github.com/daaain/claude-code-log — Read `models.py`, all of `dev-docs/`, and the 72 example messages end to end, then diff against our parser. This is the schema reference we said we needed and it is better than anything official. Highest value per hour in this entire report.
2. **`davila7/claude-code-templates`** (29,958 ⭐) — https://github.com/davila7/claude-code-templates — The largest overlapping incumbent, and we had not flagged it. Actually run `--analytics`, `--plugins`, and the conversation monitor and record precisely what they compute. Our positioning claims are unsafe until someone does.
3. **`mikehasa/agentacct`** — https://github.com/mikehasa/agentacct — Closest philosophical competitor. Deep dive its confidence-labelling and evidence-tier model; likely the single best idea to import.
4. **`ccusage/ccusage`** — https://github.com/ccusage/ccusage — Read `rust/adapters/claude/src/lib.rs` and the models.dev pricing pipeline. Treat matching its per-session totals as a correctness test for UsagePanel.
5. **`millionco/claude-doctor`** — https://github.com/millionco/claude-doctor — Eleven thresholded behavioural signals, ready to implement. No license: study, do not copy. Also the `--rules` feedback loop for Governance.
6. **The first-party stores** (`~/.claude/usage-data/session-meta/`, `usage-data/facets/`, `file-history/`) — not a repo, but the highest-leverage item on this list. Verify presence across Claude Code versions and platforms, then design Overview/Insights/WorkingSet around them with null-safe fallbacks. **Do this before item 5** if resources are tight — it may make several of `claude-doctor`'s signals unnecessary.
7. **`jianshuo/ccglass`** — https://github.com/jianshuo/ccglass — Specifically its turn-to-turn context diff, and a decision on whether ContextExplorer should ever claim to show "what the model saw."
8. **`stefanprodan/cctop`** — https://github.com/stefanprodan/cctop — Tool/MCP usage breakdowns, orphaned-port detection, and the `--capture-usage` statusline trick for rate limits.
9. **`sirmalloc/ccstatusline`** (12,063 ⭐) — https://github.com/sirmalloc/ccstatusline — Cache-hit-rate and compaction metrics; the statusLine widget catalogue as a spec for what a Claude Code UI is expected to show; the `--no-optional-locks` git fix.
10. **`nikitadoudikov/claude-pulse`** — https://github.com/nikitadoudikov/claude-pulse — Full-text search across all history, and lost-session recovery. Sets the UX bar.
11. **`agent-sh/agnix`** (444 rules, Apache-2.0) — https://github.com/agent-sh/agnix — Evaluate shelling out to it and rendering diagnostics in Governance/Setup. Cheap, large payoff.
12. **`es617/claude-replay`** — https://github.com/es617/claude-replay — Secret redaction before export (we will need this), and the multi-agent transcript location table.
13. **`simple10/agents-observe`** — https://github.com/simple10/agents-observe — As a *distribution* study: shipping Loush Dashboard as a Claude Code plugin with `/observe`-style self-diagnostic slash commands.
14. **`BetaBots-LLC/callimachus`** (30 ⭐, AGPL-3.0) — https://github.com/BetaBots-LLC/callimachus — Rust, keyword + semantic search over multi-agent history with an MCP server. Note **AGPL** — study only. Relevant if we pursue search.
15. **`masondelan/selvedge`** (17 ⭐, MIT) — https://github.com/masondelan/selvedge — "A git blame for AI agents — but for the why." Tiny but conceptually adjacent to WorkingSet; worth 30 minutes.
16. **`getagentseal/codeburn`** (8,998 ⭐, MIT) — https://github.com/getagentseal/codeburn — Cost across 31 tools/agents. Competitive awareness for UsagePanel.
17. **`f/agentlytics`** (553 ⭐) — https://github.com/f/agentlytics — Multi-agent analytics across 8 coding tools; useful if we ever go beyond Claude Code.
18. **`L1AD/claude-task-viewer`** (663 ⭐, MIT) — https://github.com/L1AD/claude-task-viewer — Kanban over Claude Code tasks; directly comparable to our Board section.
19. **The legacy archive** — https://github.com/hesreallyhim/awesome-claude-code/tree/main/README_ALTERNATIVES — ~201 further entries under the old taxonomy (Hooks, Slash-Commands, CLAUDE.md Files, Workflows). Worth a targeted pass on the **Hooks** and **CLAUDE.md Files** sections, which have no equivalent category in the current list.
20. **`ColeMurray/claude-code-otel`** (480 ⭐, MIT, last commit 2025-06-17 — **13 months stale**) — https://github.com/ColeMurray/claude-code-otel — Low priority and clearly abandoned, but it encodes Anthropic's OpenTelemetry metric names for Claude Code, which is a stable, documented surface worth knowing for Harness.

---

## Sources

**The two lists**
- https://github.com/hesreallyhim/awesome-claude-code — README.md, `config.yaml`, `THE_RESOURCES_TABLE_NEW.csv`, `README_ALTERNATIVES/{README_CLASSIC,README_AWESOME,README_EXTRA,README_FLAT_ALL_AZ}.md`, repo file tree, all fetched 2026-07-29
- https://github.com/jqueryscript/awesome-claude-code — README.md and repo file tree, fetched 2026-07-29
- GitHub REST API `repos/{owner}/{repo}`, `.../commits`, `.../readme`, `.../license`, `.../git/trees/{branch}?recursive=1` for all metadata quoted

**Official Anthropic documentation** (canonical host `code.claude.com`; `docs.anthropic.com` and `docs.claude.com` 301-redirect to it)
- https://code.claude.com/docs/en/sessions#where-transcripts-are-stored — transcript location, path encoding, and the "format is internal" disclaimer
- https://code.claude.com/docs/en/sessions#access-conversations-from-scripts — sanctioned alternatives
- https://code.claude.com/docs/en/claude-directory#application-data — `~/.claude/` layout, `subagents/`, `tool-results/`, `memory/`
- https://code.claude.com/docs/en/statusline#available-data — full statusLine stdin schema
- https://code.claude.com/docs/en/hooks#common-input-fields — hook input/output schema, and the async-lag caveat
- https://code.claude.com/docs/en/headless#get-structured-output — `--output-format json|stream-json`
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/llms.txt — full docs index (179 pages), confirming no transcript-format page exists
- https://github.com/anthropics/claude-code/issues/53516 — open, unanswered request for a documented transcript schema

**Anthropic-shipped code**
- `@anthropic-ai/claude-code` v2.1.220 — `sdk-tools.d.ts` (tool I/O only)
- `@anthropic-ai/claude-agent-sdk` v0.3.220 — `sdk.d.ts`, incl. the `SessionStoreEntry` opaque type and its `@alpha` doc comment
- https://github.com/anthropics/claude-code — repo tree (no `.d.ts`, no schema files)

**Community parsers and profiled repos** (all fetched 2026-07-29)
- https://github.com/daaain/claude-code-log — `claude_code_log/models.py`, `dev-docs/messages.md`, `dev-docs/message-hierarchy.md`, `dev-docs/application_model.md`, `dev-docs/messages/claude-code/**`
- https://github.com/ccusage/ccusage — `rust/adapters/claude/src/lib.rs`, repo tree
- https://github.com/mikehasa/agentacct · https://github.com/davila7/claude-code-templates · https://github.com/simonw/claude-code-transcripts · https://github.com/es617/claude-replay · https://github.com/stefanprodan/cctop · https://github.com/disler/claude-code-hooks-multi-agent-observability · https://github.com/simple10/agents-observe · https://github.com/jianshuo/ccglass · https://github.com/millionco/claude-doctor · https://github.com/agent-sh/agnix · https://github.com/nyatinte/ccexp · https://github.com/sirmalloc/ccstatusline · https://github.com/nikitadoudikov/claude-pulse
- https://simonwillison.net/2025/Dec/25/claude-code-transcripts/ — referenced by `claude-code-transcripts` as background; not independently read for this scan (**unverified**)

**Primary empirical evidence**
- Direct survey of `~/.claude/` on the scan machine (Windows 11, 2026-07-29): 37,378 JSONL lines across the 220 most-recently-modified transcripts of 1,257 present; plus inspection of `projects/<slug>/<session>/subagents/`, `projects/<slug>/<session>/tool-results/`, `usage-data/session-meta/` (51 files), `usage-data/facets/`, `file-history/`, `sessions/`, and `history.jsonl`. **Key names and discriminator values only were extracted; no message content was read into this report.**

**Notes on trust**
- List B's star counts are static by the list's own admission and are stale; every star figure in the profiles above was re-fetched live from the GitHub API instead.
- List A's `NOASSERTION` license means its content is not verified as reusable; the inventory above reproduces short descriptive one-liners for research purposes only.
- No page or repository fetched during this scan attempted to inject instructions into the research process. One automated harness warning fired on the schema sub-report, triggered by the literal string `bypassPermissions` — which is a legitimate documented enum value of the hooks `permission_mode` field, not an injection attempt.
