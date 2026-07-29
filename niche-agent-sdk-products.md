# Niche products on the Claude Agent SDK

Research date: 2026-07-29. Researcher: automated agent, working from GitHub API (`gh`), `raw.githubusercontent.com`, and web search.

**Confidence legend used throughout:**

- **verified** — read directly from repo source, README, or GitHub API in this session.
- **secondhand** — asserted by a blog, aggregator, or search summary; not confirmed against the repo.
- **unfound** — searched for, not located.

**One structural correction to the brief.** Target B was framed as one product with two variants. It is
**two unrelated projects by different authors**: `nanocoai/nanoclaw` (the containerised multi-messenger
assistant) and `punt-labs/beadle` (the email-driven Claude Code agent with the rwx address book). Beadle is
not a NanoClaw variant — it shares no code, author, or org, and is written in Go rather than TypeScript.
Both are documented below under B, labelled B1 and B2.

**Prompt-injection note.** No fetched page contained an instruction directed at an AI agent that was acted
upon. Two items are flagged for the record and were treated as data only:

- The Perfect-Web-Clone README contains the marketing line "Learn from it, use it, build upon it"
  (attributed: ericshang98 README). Marketing copy, not an instruction; ignored as a directive.
- `punt-labs/beadle` ships `commands/*.md` and `.claude/agents/*.md` — these are Claude Code slash-command
  and subagent definitions, i.e. files whose entire purpose is to instruct an agent. They were read as
  documentation of beadle's design and none of their instructions were followed.

---

## A / Perfect-Web-Clone (product name "Nexting") — Identity and verification status

**Status: FOUND — verified.**

| Field | Value | Confidence |
|---|---|---|
| Repo | https://github.com/ericshang98/Perfect-Web-Clone | verified |
| Author | `ericshang98` (Eric Shang), associated with Nexting.ai | verified (repo owner); Nexting.ai association secondhand |
| Description | Matches the brief verbatim: "Multi-agent architecture built on Claude Agent SDK with 40+ specialized tools. Clones from CSS & structured blocks—not screenshots" | verified (GitHub API `description`) |
| License | **Ambiguous — see warning below** | verified |
| Stars / forks / open issues | 255 / 23 / 6 | verified (GitHub API, 2026-07-29) |
| Created / last push | 2026-01-06 / 2026-06-18 | verified |
| Archived | No | verified |
| Topics | `ai-agent`, `automation`, `claude-sdk`, `multi-agent`, `nextjs`, `pixel-perfect`, `python`, `web-cloning` | verified |
| Primary language | Python (backend) + TypeScript (frontend) | verified from file tree |

**LICENSE WARNING (verified).** The README carries an `MIT` shields.io badge and a `## License` heading in
its table of contents, but **there is no `LICENSE` file in the repository** (`GET
/repos/.../contents/LICENSE` → 404) and the GitHub API reports `license: null`. A badge is not a licence
grant. Before copying any of this code into `LinuxDevil/AI-Dashboard`, get the author's permission **in
writing, naming the licence**, or reimplement from the documented design rather than the source. This is
the single highest-risk item in this report.

**Sibling repos by the same author** (verified they exist by name via search; contents not fetched):
`ericshang98/perfect-web-clone-skill` (Claude Code Skill packaging) and
`ericshang98/Perfect-Web-Clone-IDE` (MCP server, "clone any website with one command in your IDE").

**Community traction:** no Show HN thread, Reddit thread, or dev.to/Medium post specific to this project was
located. Aggregator listings exist (skillsindex.dev, skillsllm.com, mcpmarket.com, lobehub) but these are
auto-generated directory entries, not reviews. — unfound.

## A / Perfect-Web-Clone — The problem it solves

Cloning a real website with a single-model coding agent fails for a mechanical reason, stated plainly in the
README: a fully extracted page is roughly a 200KB JSON blob, which exceeds practical context limits, and
even when it fits, one agent loses coherence as context fills with DOM and CSS noise. The README's framing:
"The solution isn't smarter agents — it's task distribution" (attributed: Perfect-Web-Clone README).
— verified.

The secondary problem is the input medium. Screenshot-driven tools infer layout from pixels, which produces
hardcoded pixel values, dead interactions, div soup, and no responsive behaviour. The README's comparison
table claims single-model tools break on: 50,000+ line DOM trees, 3,000+ CSS rules, component boundary
detection, responsive breakpoints, and hover/animation states. — verified as claims; the performance
comparison itself is the author's own and was not independently tested.

## A / Perfect-Web-Clone — Value proposition

Read the real source instead of guessing at pixels, then split the resulting data across a coordinator agent
and parallel worker agents so no single context window has to hold it all, and run everything in a sandbox
with a live dev server so the agent can see its own output and self-correct. The README states the honest
limit itself: "Complex animations are still hard to extract perfectly" (attributed: Perfect-Web-Clone
README). — verified.

## A / Perfect-Web-Clone — Feature inventory

| Feature | What it does | Evidence (URL) | Confidence |
|---|---|---|---|
| 40+ tools in 10 categories | Claude-Code-shaped tool surface handed to the agent; see taxonomy below | https://github.com/ericshang98/Perfect-Web-Clone/blob/main/backend/agent/tools/tool_registry.py | verified |
| Playwright extractor service | Headless Chromium; DOM, computed styles, resources, screenshots, network monitoring, phased extraction | .../backend/extractor/extractor_service.py | verified |
| Structured CSS extraction (`CSSData`) | Full stylesheets, `@keyframes`, transitions, CSS variables, pseudo-element styles, media queries | .../backend/extractor/models.py | verified |
| Style frequency histograms (`StyleSummary`) | Maps value → usage count for colors, background colors, font families, font sizes, margins, paddings, display, position | .../backend/extractor/models.py | verified |
| Interaction state capture | `hover` / `focus` / `active` styles per selector, each with an optional base64 screenshot | .../backend/extractor/models.py (`InteractionState`) | verified |
| Light/dark theme detection | `ThemeDetectionResult` with `detection_method` ∈ `css_media` / `class_toggle` / `color_scheme` / `none`, plus diff counts for variables, colors, images | .../backend/extractor/models.py | verified |
| Structured block / section analysis | `analyze_sections()` classifies layout as `simple` / `single-page` / `multi-section` and emits per-section `{section_name, tag, class, index, bounds}` | .../backend/json_storage/section_analyzer.py | verified |
| Tech stack detection | Frameworks, UI libs, utilities, build tools, and styling approach (preprocessor / framework / css-in-js) | .../backend/extractor/models.py (`TechStackData`) | verified |
| Component boundary analysis | `ComponentAnalysisData` + `component_analyzer.py` | .../backend/extractor/component_analyzer.py | verified (file exists; algorithm not read) |
| Multi-agent orchestration | `orchestrator.py`, `worker_agent.py`, `worker_manager.py`, `concurrency_scheduler.py`, `compressor.py` | .../backend/agent/core/ | verified (files exist) |
| Three-tier memory | `short_term.py`, `mid_term.py`, `long_term.py`, `context_injector.py` | .../backend/agent/memory/ | verified (files exist) |
| Self-healing loop | `start_healing_loop` / `verify_healing_progress` / `stop_healing_loop` auto-fix build errors | .../backend/agent/tools/self_healing_tools.py | verified |
| BoxLite sandbox | Micro-VM sandbox; `sandbox_manager.py`, `tool_guard.py`, `replay_recorder.py` | .../backend/boxlite/ and https://github.com/boxlite-ai/boxlite | verified (integration); micro-VM isolation claim secondhand |
| Checkpoint / replay | `checkpoint_store.py` plus committed sample checkpoints and a `replay-viewer.tsx` | .../backend/checkpoint/ | verified |
| Extractor UI | Per-concern tabs: CSS, styles, elements, layout, components, assets, network, resources, tech stack, overview | .../frontend/src/components/extractor/ | verified |
| MCP server | `mcp_server.py` / `mcp_tools.py` expose the toolset over MCP | .../backend/agent/mcp_server.py | verified (files exist) |
| 8-language README | zh, ja, ko, es, pt, de, fr, vi | .../docs/ | verified |
| "Pixel-perfect" output quality | Claimed superiority over Cursor / Claude Code / Copilot | README comparison table | secondhand (author's own claim, untested) |

## A / Perfect-Web-Clone — The transferable idea

**The pattern: a flat, category-partitioned tool registry, paired with a structured extraction schema that
the agent queries rather than swallows.**

### A.1 The tool taxonomy

Verified from `backend/agent/tools/tool_registry.py`. Ten categories, each a plain dict of
`name → callable`, composed into one registry. The design property worth stealing is that the categories are
**functional roles**, not source modules — tools imported from five different files land in the same
category dict when they serve the same purpose.

| # | Category | Tools (verified from registry source and README table) |
|---|---|---|
| 1 | File Operations | `read_file`, `write_file`, `edit_file`, `delete_file`, `rename_file`, `create_directory`, `file_exists` |
| 2 | Search & Discovery | `glob`, `grep`, `ls`, `list_files`, `get_project_structure`, `search_in_file`, `search_in_project` |
| 3 | Task Management | `todo_read`, `todo_write`, `task`, `get_subagent_status` |
| 4 | System Execution | `bash`, `run_command`, `shell` |
| 5 | Network | `web_fetch`, `web_search` |
| 6 | Terminal | `create_terminal`, `switch_terminal`, `kill_terminal`, `list_terminals`, `send_terminal_input`, `get_terminal_output`, `get_terminal_history`, `install_dependencies`, `start_dev_server`, `stop_server` |
| 7 | Preview | `take_screenshot`, `get_console_messages`, `get_preview_dom`, `get_preview_status`, `clear_console` |
| 8 | Diagnostics | `verify_changes`, `diagnose_preview_state`, `analyze_build_error`, `get_comprehensive_error_snapshot`, `get_all_terminals_output`, `get_preview_error_overlay` |
| 9 | Self-Healing | `start_healing_loop`, `verify_healing_progress`, `stop_healing_loop`, `get_healing_status` |
| 10 | Source Query | `list_saved_sources`, `get_source_overview`, `query_source_json` |

Three observations that make this a *design pattern* and not just a list:

1. **Categories 7–9 form a feedback ladder.** Preview *observes* (what does the running app look like?),
   Diagnostics *interprets* (what is wrong?), Self-Healing *loops* (fix and re-check). Most tool inventories
   stop at category 6. The ladder is what turns "an agent with tools" into "an agent that self-corrects."
2. **Category 10 is the context-budget escape hatch.** `query_source_json` exists precisely so the 200KB
   extraction never enters the prompt. The agent asks the store questions instead of reading the store. This
   is the single most reusable idea in the repo.
3. **Naming mirrors Claude Code.** The registry docstring explicitly says it follows Claude Code's naming
   pattern in `snake_case`, and comments map tools to Claude Code's minified internal symbols
   (`glob` → `FJ1`, `grep` → `XJ1`, `web_fetch` → `IJ1`, `todo_read` → `oN`, `todo_write` → `yG`,
   `task` → `cX`). — verified from source comments. Whether those symbols are accurate is not verifiable
   from here, but the intent — make the tool surface feel native to the model — is the point.

### A.2 The CSS / structured-block extraction schema

Verified from `backend/extractor/models.py`. This is the shape our Figma Capture tool should be extracting
from a live page. Field names below are the actual Pydantic model fields.

```
ExtractionResult
├── metadata            PageMetadata
├── screenshot          base64 (current theme)
├── full_page_screenshot base64
├── dom_tree            ElementInfo (recursive)
│     ├── rect          ElementRect  { x, y, width, height, top, right, bottom, left }
│     └── styles        ElementStyles { display, position, float, clear,
│                                       flex_direction, flex_wrap, justify_content,
│                                       align_items, align_content, gap,
│                                       grid_template_columns, grid_template_rows,
│                                       grid_column, grid_row, ... }
├── style_summary       StyleSummary   # value → usage-count histograms
│     ├── colors                Dict[str,int]
│     ├── background_colors     Dict[str,int]
│     ├── font_families         Dict[str,int]
│     ├── font_sizes            Dict[str,int]
│     ├── margins               Dict[str,int]
│     ├── paddings              Dict[str,int]
│     ├── display_types         Dict[str,int]
│     └── position_types        Dict[str,int]
├── css_data            CSSData
│     ├── stylesheets      [ StylesheetContent { url, content, is_inline } ]
│     ├── animations       [ CSSAnimation { name, keyframes[], source_stylesheet } ]
│     ├── transitions      [ CSSTransitionInfo { property, duration, timing_function, delay } ]
│     ├── variables        [ CSSVariable { name, value, scope=":root" } ]
│     ├── pseudo_elements  [ PseudoElementStyle { selector, pseudo, styles, content } ]
│     └── media_queries    Dict[str,str]
├── interaction_data    InteractionData
│     ├── hover_states   [ InteractionState { selector, state, styles, screenshot } ]
│     ├── focus_states   [ ... ]
│     └── active_states  [ ... ]
├── theme               ThemeDetectionResult { support, current_mode,
│                          has_significant_difference, detection_method,
│                          css_variables_diff_count, color_diff_count, image_diff_count }
├── tech_stack          TechStackData { frameworks, ui_libraries, utilities,
│                                       build_tools, styling{preprocessor,framework,css_in_js} }
├── network_data        NetworkData
└── downloaded_resources DownloadedResources
```

And the "structured blocks" half, from `section_analyzer.analyze_sections(raw_html, dom_tree)`:

```
{ "type": "simple" | "single-page" | "multi-section",     # ≤2 / 3–5 / >5 sections
  "sections": [ { "section_name", "tag", "class", "index",
                  "bounds": { "x", "y", ... } } ] }
```

The section walk takes the **direct children of body/root** as candidate blocks, derives a name from tag +
class + index, and falls back from DOM tree to raw-HTML parsing when no tree is available. Deliberately a
heuristic, not a parser — the same posture as the comment in our own `server/figma-capture.mjs`.

**Why the histograms matter more than they look.** `StyleSummary` turns an unbounded page into a bounded,
prompt-sized design-token summary. The top 12 entries of `colors` + `font_families` + `font_sizes` +
`paddings` *is* the page's design system, in maybe 400 tokens. That is the trick to copy.

## A / Perfect-Web-Clone — Architecture

Verified from the file tree and README diagrams.

- **Frontend** (`frontend/`, port 3100): Next.js 15, React 19, TailwindCSS 4, shadcn/ui. Three panes —
  chat panel, Monaco IDE, preview `<iframe>` pointed at the sandbox dev server. `xterm-terminal.tsx` for
  terminal output; `diff-code-editor.tsx` for change review.
- **Backend** (`backend/`, port 5100): FastAPI + Python 3.11 + Playwright. WebSocket transport to the
  frontend (`routes_websocket.py`, `websocket_manager.py`).
- **Agent core** (`backend/agent/core/`): `orchestrator.py` coordinates; `worker_manager.py` /
  `worker_agent.py` fan out; `concurrency_scheduler.py` bounds parallelism; `compressor.py` and
  `message_queue.py` manage context; `conversation_pipeline.py` and `stream_generator.py` handle streaming;
  `task_contract.py` defines the coordinator↔worker contract.
- **Sandbox** (`backend/boxlite/`): BoxLite micro-VM. `tool_guard.py` gates tool calls inside the sandbox;
  `sandbox_manager.py` writes to `/tmp/boxlite-sandboxes/{sandbox_id}/`; a Vite dev server on port 8080
  watches those files and HMRs, and the frontend iframe loads it directly. `replay_recorder.py` records
  sessions for the showcase replay viewer.
- **Extraction pipeline** (`backend/extractor/` + `backend/json_storage/`): Playwright renders → models
  above are populated → `cache_manager.py` caches → `section_analyzer.py` / `visual_layout_analyzer.py`
  produce structured blocks → results saved as JSON that agents query via the Source Query tools.

The README abstracts this to a reusable four-part pattern — **Main Agent + Worker Agents + Tools + Sandbox**
— and explicitly claims it generalises beyond cloning to "automated refactoring, codebase migration,
documentation generation" (attributed: Perfect-Web-Clone README). — verified as a claim.

## A / Perfect-Web-Clone — Gaps and weaknesses

- **No LICENSE file.** Restated because it is disqualifying for copy-paste. — verified.
- **Comments and docstrings are largely Chinese.** `extractor_service.py`, `models.py`, `tool_registry.py`
  all mix Chinese comments with English identifiers. Fine to read, a maintenance cost if vendored into an
  otherwise-English repo. — verified.
- **Committed artefacts.** `backend/data/checkpoints/did-global-cinema-aaf71f95/` ships real session
  checkpoints, and `frontend/public/demo.mp4` plus several MP4s are in-tree. Repo hygiene, and it inflates
  clone size. — verified.
- **Thin tests.** The tree shows exactly one substantive test file (`backend/tests/test_boxlite_tools.py`)
  plus `conftest.py` and a runner. For a 40-tool surface that is very light. — verified.
- **Anthropic-only.** "AI: Claude via Anthropic API" — no model abstraction layer visible. — verified.
- **Animation fidelity is admitted as incomplete** by the author. — verified.
- **Performance claims are self-reported.** The Cursor/Claude Code comparison table has no benchmark behind
  it. — verified that it is unsourced.
- **Two names.** The repo is "Perfect-Web-Clone", the product inside the README is "Nexting". Expect drift
  between repo docs and the hosted product. — verified.

---

## B1 / NanoClaw — Identity and verification status

**Status: FOUND — verified.**

| Field | Value | Confidence |
|---|---|---|
| Repo | https://github.com/nanocoai/nanoclaw | verified |
| Homepage | https://nanoclaw.dev | verified |
| Author / org | `nanocoai` | verified |
| License | MIT | verified (GitHub API) |
| Stars / forks / open issues | 30,389 / 12,872 / 857 | verified (GitHub API, 2026-07-29) |
| Created / last push | 2026-01-31 / 2026-07-28 | verified |
| Topics | `ai-agents`, `ai-assistant`, `claude-code`, `claude-skills`, `openclaw` | verified |
| Language | TypeScript | verified |
| Codebase size | "~4,000 lines of TypeScript vs OpenClaw's ~500,000" | secondhand (BrightCoding / scriptbyai blogs; not counted) |

This is not a niche product — 30k stars and 12.8k forks make it one of the larger agent repos on GitHub. The
fork count exceeding a third of the star count is unusual and suggests it is used as a template.

## B1 / NanoClaw — The problem it solves

Personal AI assistants that talk to your messaging apps need broad access to run useful errands, and the
common design gives them that access behind *application-level* permission checks — a code path that can be
argued past by a well-crafted message. NanoClaw's position is that application-level checks are the wrong
boundary and the OS should be the boundary instead: run each agent in a container that simply cannot see
anything not explicitly mounted. Its `docs/SECURITY.md` states the tradeoff directly: rather than relying on
application-level permission checks, the attack surface is limited by what is mounted. — verified.

The second problem is auditability. A small codebase can be read end-to-end by one person; a 500k-line one
cannot. — the comparison is secondhand, the intent is stated in the repo.

## B1 / NanoClaw — Value proposition

Your own machine, your own containers, one agent group per container, credentials that never enter the
container, and a network that has no route to the internet except through a credential-injecting proxy —
across 13+ messaging channels. — verified from `docs/SECURITY.md`.

## B1 / NanoClaw — Feature inventory

| Feature | What it does | Evidence (URL) | Confidence |
|---|---|---|---|
| Per-session containers | One long-lived Docker container per session, polls that session's DBs, torn down with `--rm` when idle | https://github.com/nanocoai/nanoclaw/blob/main/docs/SECURITY.md | verified |
| `buildMounts` fixed mount table | Exactly 9 fixed mounts per spawn, each with an explicit RW/RO mode; project root never mounted | docs/SECURITY.md | verified |
| Nested read-only config mounts | `container.json`, `CLAUDE.md`, `.claude-fragments` mounted RO *on top of* the RW group dir — agent reads config, cannot edit it | docs/SECURITY.md | verified |
| Mount allowlist | `~/.config/nanoclaw/mount-allowlist.json`, outside the project root, never mounted, not agent-modifiable | docs/SECURITY.md | verified |
| Blocked-pattern denylist | Defaults merged with user list: `.ssh, .gnupg, .gpg, .aws, .azure, .gcloud, .kube, .docker, credentials, .env, .netrc, .npmrc, .pypirc, id_rsa, id_ed25519, private_key, .secret` | docs/SECURITY.md | verified |
| Symlink-traversal defence | `realpathSync` before every allowlist check | docs/SECURITY.md | verified |
| Container-path validation | Must be relative, non-empty, no `..`, no leading `/`, no `:` (blocks Docker `-v` option injection) | docs/SECURITY.md | verified |
| Two-key RW grant | Read-write only if the mount requests `readonly: false` **and** the matched root has `allowReadWrite: true`; otherwise forced RO | docs/SECURITY.md | verified |
| Fail-closed default | No allowlist file ⇒ every additional mount blocked | docs/SECURITY.md | verified |
| User-level trust table | `user_roles` (owner/admin, global or agent-group-scoped) + `agent_group_members` (access gate); unregistered senders fall to each messaging group's `unknown_sender_policy` | docs/SECURITY.md | verified |
| "Messages are untrusted input" | Explicit: even a member's messages are potential prompt injection | docs/SECURITY.md | verified |
| Credential isolation (OneCLI Agent Vault) | Credentials never enter containers; gateway matches by host+path and injects; agents cannot find secrets in env, stdin, files, or `/proc` | docs/SECURITY.md | verified |
| Egress lockdown | Agents on a Docker `--internal` network with no internet route; the OneCLI gateway container is the only reachable hop, aliased as `host.docker.internal`; agent is non-root with no `NET_ADMIN` | docs/SECURITY.md | verified |
| Session isolation | State under `data/v2-sessions/<group>/<session>/` with `inbound.db`, `outbound.db`, `outbox/`, `.claude/`; groups cannot see each other's history | docs/SECURITY.md | verified |
| Messaging channels | WhatsApp, Telegram, Discord, Slack, Microsoft Teams, iMessage, Matrix, Google Chat, Webex, Linear, GitHub, WeChat, email via Resend | README | verified |
| Memory + scheduled jobs | Shared memory tree per group; cron-style jobs | README / repo description | verified (described) |
| Agent swarms | Multiple containerised agents collaborating | BrightCoding blog | secondhand |
| Hypervisor-level / micro-VM isolation | Claimed by third-party blogs; the repo's own SECURITY.md says Docker containers, not micro-VMs | blog vs docs/SECURITY.md | **contradicted** — trust the repo |
| Policy + approval dialogs across 15 apps | VentureBeat piece on a NanoClaw × Vercel launch | https://venturebeat.com/orchestration/... | secondhand |

## B2 / beadle — Identity and verification status

**Status: FOUND — verified. This is the "email-based variant with an rwx address book" from the brief.**

| Field | Value | Confidence |
|---|---|---|
| Repo | https://github.com/punt-labs/beadle | verified |
| Description | "Claude Code via e-mail based on an addressbook with UNIX style rwx permissions per interaction pair." — an exact match to the brief | verified (GitHub API) |
| Author / org | `punt-labs` | verified |
| License | MIT (`LICENSE` file present) | verified |
| Stars / forks | 3 / 0 | verified (GitHub API, 2026-07-29) |
| Created / last push | 2026-02-28 / 2026-07-28 | verified — actively developed |
| Topics | `autonomous-agents`, `beta`, `claude-code-plugin`, `claude-sdk` | verified |
| Language | Go 1.26+ | verified |
| Relationship to NanoClaw | **None.** Different org, language, and architecture. | verified |

Genuinely niche: 3 stars, 0 forks, self-labelled `beta`, and the README carries a "Working Backwards —
hypothesis" badge linking to a PR/FAQ document. Despite that, it is the most rigorously *specified* of the
three: `DESIGN.md` is a numbered ADR log (DES-001 … DES-022+) with dated evidence for each decision.

## B2 / beadle — The problem it solves

Giving an agent a real email address means giving it an inbox that anyone on the internet can write to.
Every message is simultaneously (a) possibly forged and (b) possibly an instruction. Beadle separates those
two questions and refuses to collapse them: *is this message authentic?* is answered by transport trust, and
*given it is authentic, what may the agent do about it?* is answered by identity permissions. The README's
own framing: commands are programs, the daemon is the shell, pipelines are pipes, and GPG signatures are
sudo. — verified.

## B2 / beadle — Value proposition

An agent email address where nothing is implicit: a whitelist address book, four graded levels of transport
trust, and a per-(identity, contact) rwx cell that must independently permit each class of action. Runs on
your machine, credentials from the OS keychain, no third party holding keys. — verified.

## B2 / beadle — Feature inventory

| Feature | What it does | Evidence (URL) | Confidence |
|---|---|---|---|
| Two-dimensional trust | Transport trust **and** identity permission must both pass before autonomous action | https://github.com/punt-labs/beadle/blob/main/DESIGN.md (DES-012) | verified |
| Four-level transport trust | `trusted` (Proton→Proton E2E headers), `verified` (`gpg --verify` exit 0), `untrusted` (non-zero exit), `unverified` (no `multipart/signed`) | DESIGN.md DES-001 | verified |
| rwx permission matrix | `permissions[identity_email][contact] → "rwx" \| "rw-" \| "r--" \| "---"` | DESIGN.md DES-012 | verified |
| Whitelist default | Absent permissions default to `---`; `CheckPermission()` returns no-access | DESIGN.md DES-012 | verified |
| No inheritance between identities | Each matrix cell explicit; no implicit propagation across identities | DESIGN.md DES-012 | verified |
| Redacted listings | `list_messages` shows sender/date/trust for all messages but redacts the subject without `r` — lets the owner discover unknown senders safely | DESIGN.md DES-012 | verified |
| Ungated diagnostic tools | `check_trust`, `verify_signature`, `show_mime` return metadata without body content and are intentionally not permission-gated; `move_message` is identity-local inbox management | DESIGN.md DES-012 | verified |
| Glob contacts | Contact email may be a pattern like `*@github.com`, but only for domain-wide `r--` or `---` | commands/contacts.md | verified |
| 23 MCP tools | List/search/read/reply/send, batch mark & move, attachments, MIME, trust, folders, contacts CRUD, identity, polling | README | verified (README); **`docs/ARCHITECTURE.md` says 18 tools — internal drift** |
| Multi-identity via `ethos` sidecar | Beadle does not own identity; reads `email`/`name`/`handle` from `~/.punt-labs/ethos/identities/<handle>.yaml`; beadle-specific fields live in a namespaced `.ext/beadle.yaml` | DESIGN.md DES-013 | verified |
| Mid-session identity switch | `switch_identity` MCP tool | README | verified |
| Isolated GNUPGHOME per PGP op | Temp dir under `/tmp/bg-*` (short path for the 108-byte Unix-socket limit), keys imported, dir deleted — no keyring pollution from attached keys | DESIGN.md DES-003 | verified |
| Read-only system-keyring bridge | `exportAll()` copies public keys out of `~/.gnupg/` into the temp home; never writes back | DESIGN.md DES-004 | verified |
| Credential chain | OS keychain (macOS `security`; Linux `pass` then `secret-tool`) → mode-600 file → env var; config file holds only connection params; `secret.Get()` rejects `/` and `\`; group/world-readable files rejected | DESIGN.md DES-008, docs/ARCHITECTURE.md | verified |
| Mail-triggered pipelines | Planner decomposes an instruction into a stage list; Claude stages (~45–60s) and CLI stages (ms) mix; data flows as JSON with passthrough side-effect stages | README | verified (described) |
| Claude Code plugin | Slash commands `/inbox` `/mail` `/send` `/contacts` `/beadle`; hooks for two-channel display and session setup | README, commands/ | verified |
| Dual install | Plugin (full) vs standalone MCP (tools only, no commands/hooks); mutually exclusive to avoid double registration | DESIGN.md DES-011 | verified |
| Audit log tamperproof | "Append-only, GPG-signed entries. Only the owner can clear the log." | docs/ARCHITECTURE.md (Design Invariants) | verified as a stated invariant; implementation not read |
| Command-signature enforcement | **Explicitly a stub.** README: signature verification "is currently a stub and is not yet enforced" | README | verified |
| `x` (execute) enforcement | **Not implemented.** "requires instruction parsing infrastructure" | DESIGN.md DES-012 | verified |

## B / The transferable idea — the rwx permission matrix (exact semantics)

This is the item the brief asked to extract precisely. All of the following is **verified** from
`DESIGN.md` DES-012 and `docs/ARCHITECTURE.md`.

**Shape.**

```
permissions[identity_email][contact] → "rwx" | "rw-" | "r--" | "---"
```

Two entities, and the permission lives on the *pair*, not on either one:

- **Identity** — who the agent is operating as (a mailbox). Owned externally (by `ethos`), read-only to
  beadle: `email`, `name`, `handle`.
- **Contact** — who the agent is interacting with. Stored in the address book.

**Bit semantics.**

| Bit | Meaning |
|---|---|
| `r` (read) | Beadle reads the message and surfaces it to the owner. **No autonomous action.** |
| `w` (write) | Beadle may compose and send replies to this contact. |
| `x` (execute) | Beadle may execute instructions/commands from this contact. |

**Worked example, for identity `claude@punt-labs.com`:**

| Contact | Permissions | Effect |
|---|---|---|
| Sam Jackson | `rwx` | Full authority — read, reply, execute tasks |
| Eric | `rw-` | Read and reply, but not execute instructions |
| Vendor X | `r--` | Read only, surface to owner for action |
| Unknown sender | `---` | Default: no permissions (whitelist) |

**The five rules that make it work.**

1. **Orthogonality.** Transport trust answers "is this message authentic?"; the rwx cell answers "given it
   is authentic, what should the agent do?" **Both must pass.** An `unverified` message from an `rwx`
   contact must NOT be executed (identity claim unproven). An authenticated message from an `r--` contact
   must NOT trigger autonomous action (sender lacks authority).
2. **No inheritance.** Sam may grant Eric `rwx` on `sam@example.com` but only `rw-` on
   `claude@punt-labs.com`. Every cell is explicit; there is no implicit propagation and no implicit
   override.
3. **Whitelist default.** Unlisted or unset ⇒ `---`. `CheckPermission()` returns no-access when nothing is
   stored.
4. **Per-bit enforcement points.** `r` is enforced on `list_messages` (subject redacted for senders without
   `r`), `read_message` (permission denied), and `download_attachment` (permission denied). `w` is enforced
   on `send_email` — **all recipients** must have write. `x` is defined but not yet enforced.
5. **Scope limit — this is the subtle one.** The matrix governs *inbound message handling only*. It does
   **not** govern address-book CRUD: any identity may add or remove contacts regardless of permissions. The
   permissions answer "what should the agent do with mail from this person?", not "who may edit the address
   book?" Beadle deliberately did not conflate the two.

**Data model (Go, verbatim field list from DESIGN.md):**

```
Identity {
    name          string   // "Claude"
    email         string   // "claude@punt-labs.com"
    gpg_key_id    string   // signing key for this identity
    config_path   string   // path to this identity's email.json
}

Contact {
    name          string
    email         string
    aliases       []string
    gpg_key_id    string
    notes         string
    permissions   map[string]string  // identity_email → "rwx"
}
```

**Inbound processing algorithm (4 steps, verbatim intent):**

1. Which identity's mailbox am I reading? → "who am I"
2. Who sent this message? → look up contact by sender address
3. What permissions does this contact have for this identity? → gate behaviour
4. Combined with transport trust: act only if **both** identity trust and transport trust are sufficient

**Design invariants worth copying alongside it** (`docs/ARCHITECTURE.md`): *zero agent authority* — the
daemon has no independent decision-making; *preflight before execute* — all permissions validated before any
command runs, no partial execution; *audit log append-only and signed*.

## B / Architecture

**NanoClaw** (verified from `docs/SECURITY.md` and README): a single host Node.js process routes messages
through an entity hierarchy — user → messaging group → agent group → session. Per-session SQLite pairs
(`inbound.db` / `outbound.db`) with single-writer semantics act as the host↔container queue. Container
agent-runners run Bun + the Claude Agent SDK, polling their session DBs. Key files named in the README:
`src/index.ts` (init/polling), `src/router.ts` (inbound routing), `src/delivery.ts` (outbound),
`container/agent-runner/`. Security modules: `src/container-runner.ts` (`buildMounts`),
`src/modules/mount-security/index.ts`. Outbound HTTPS is forced through the OneCLI gateway on a Docker
`--internal` network.

**beadle** (verified from `docs/ARCHITECTURE.md` package map): Go, two binaries.

| Package | Responsibility |
|---|---|
| `cmd/beadle-email/` | CLI + MCP server (`serve`), product and admin commands |
| `cmd/beadle-daemon/` | Mail-triggered mission pipeline runner |
| `internal/channel/` | Channel interface — `Message`, `TrustLevel`, shared contract (email today, Signal planned) |
| `internal/email/` | IMAP client, MIME parser, trust classifier, SMTP/Resend senders |
| `internal/pgp/` | GPG verify/sign via `gpg` CLI in isolated GNUPGHOME |
| `internal/mcp/` | MCP tool definitions and handlers |
| `internal/daemon/` | Planner, spawner, runner, mission/command model, persistence |
| `internal/contacts/` | Address book storage and lookup |
| `internal/identity/` | Resolves which identity beadle operates as |
| `internal/session/` | Reads the ethos session roster |
| `internal/secret/` | Keychain → file → env credential chain |
| `internal/paths/` | Single root for all beadle data (`~/.punt-labs/beadle/`) |

## B / Gaps and weaknesses

**NanoClaw:**

- 857 open issues against 30k stars — a large unresolved surface. — verified.
- Third-party write-ups claim micro-VM / hypervisor-level isolation; the repo's own SECURITY.md describes
  **Docker containers**. Anyone adopting this should trust the repo, not the blogs. — verified contradiction.
- Security depends on a **separate project** (OneCLI Agent Vault) for credential isolation and egress
  control. That is an external dependency in the trust chain. — verified.
- The in-repo SECURITY.md warns it can drift from the canonical version at docs.nanoclaw.dev. — verified.
- The 12.8k forks suggest heavy template use, which means most deployments are un-updated snapshots.
  — inference from fork count.

**beadle:**

- **`x` is unenforced.** The headline permission bit — execute — is defined but not wired. The whole
  execute-authority story is currently design, not runtime. — verified.
- **Command-signature verification is a stub.** The README says so plainly; today the gate is transport
  trust only. — verified.
- Tool-count drift between README (23) and `docs/ARCHITECTURE.md` (18). — verified.
- 3 stars, 0 forks, `beta` topic, "Working Backwards — hypothesis" badge: pre-adoption. No external review
  of the security model exists. — verified.
- Heavily coupled to the author's own ecosystem (`ethos`, `biff`, `vox`, `quarry`, `lux`, `beads`) —
  visible throughout the repo tree. Extracting the permission model means extracting it from that context.
  — verified.
- macOS/Linux only; Proton Bridge is the reference transport, and DES-005 documents that Proton Bridge
  **strips `multipart/signed`** so beadle cannot sign its own outbound mail through it. Self-inflicted by
  the platform choice. — verified.

---

## C / AgentBreeder — Identity and verification status

**Status: FOUND — verified.**

| Field | Value | Confidence |
|---|---|---|
| Repo | https://github.com/agentbreeder/agentbreeder | verified |
| Description | "Define Once. Deploy Anywhere. Govern Automatically. Framework-agnostic platform to build, deploy & govern enterprise AI agents — LangGraph · CrewAI · Claude SDK · OpenAI Agents · Google ADK · AWS · GCP · Azure · K8s · RBAC · A2A · MCP" — matches the brief essentially word-for-word | verified (GitHub API) |
| Homepage | https://www.agentbreeder.io/ | verified |
| PyPI | `agentbreeder` 2.0.1 | verified (search result) |
| License | Apache-2.0 (`LICENSE` file present) | verified |
| Stars / forks / open issues | 4 / 5 / 169 | verified (GitHub API, 2026-07-29) |
| Created / last push | 2026-03-09 / 2026-07-27 | verified — actively developed |
| Size / language | ~13 MB, Python | verified |
| Topics | 20 topics incl. `rbac`, `governance`, `claude-sdk`, `crewai`, `langgraph`, `google-adk`, `openai-agents`, `mcp`, `multi-cloud`, `agentops`, `llmops` | verified |

**Maturity read.** 4 stars but 169 open issues, a `ROADMAP.md`, `GOVERNANCE.md`, `CLA.md`, `TRADEMARK.md`,
26 Alembic migrations, 10 GitHub Actions workflows, and a Helm chart. This is a solo-or-small-team project
with enterprise-shaped scaffolding and near-zero adoption. The docs are ambitious relative to the code — see
Gaps. But the governance code is real and readable, which is what matters for our purposes.

**Note on an automated summary.** A page-summarising model characterised the README as "a fictional product
presented as documentation reference material." That is the summariser's inference, not a finding. The
repository, its migrations, its RBAC service, and its A2A routes are real and were read directly. What is
true is that some README claims (e.g. "96% test coverage") were **not** verified.

**Community traction:** no Show HN thread, Reddit thread, or independent review located. — unfound.

## C / AgentBreeder — The problem it solves

The README's own framing of the pain: "47 AI agents. Nobody knows what they cost, who approved them, or
which ones are still running." (attributed: AgentBreeder README). Agents proliferate across teams and
frameworks; each framework and each cloud brings its own deployment story; governance gets bolted on per
platform or not at all; and nobody can enumerate what exists. Every major vendor's answer requires the agents
to run on that vendor's infrastructure. — verified.

## C / AgentBreeder — Value proposition

One `agent.yaml` deploys to any framework and any cloud, and because every deployment goes through one
pipeline, RBAC, cost attribution, audit, and registry entry happen whether or not anyone opts in. The README's
phrase: governance is "a structural side effect" rather than a bolted-on feature. — verified.

## C / AgentBreeder — Feature inventory

| Feature | What it does | Evidence (URL) | Confidence |
|---|---|---|---|
| 8-step deploy pipeline | parse → RBAC → approval → dependency resolution → build → provision → deploy → health check → register | https://github.com/agentbreeder/agentbreeder/blob/main/ARCHITECTURE.md | verified |
| Three-tier builder | No-code ReactFlow canvas / low-code `agent.yaml` / full-code Python+TS SDK — all compile to one internal format and share one pipeline | ARCHITECTURE.md | verified |
| Platform roles | `admin` / `deployer` / `contributor` / `viewer` with a `ROLE_HIERARCHY` | ARCHITECTURE.md + api/middleware/rbac.py | verified |
| Per-asset ACL | `resource_permissions` table; action set and resource types below | api/services/rbac_service.py, api/models/schemas.py | verified |
| Three-tier permission resolution | `check_permission()` checks direct user → group membership → team membership, returning `(allowed, reason)` | api/services/rbac_service.py | verified |
| Service principals | Non-human identities for CI/CD, roles `deployer`/`contributor`/`viewer` | api/models/schemas.py `VALID_SP_ROLES` | verified |
| Principal groups | Named user sets for bulk ACL assignment (`principal_groups`) | api/services/rbac_service.py | verified |
| Approval queue | `asset_approval_requests` (pending/approved/rejected) with reason surfaced to the submitter | ARCHITECTURE.md | verified |
| Approval gate placement | `engine/governance.py::check_deploy_approved()` runs **between Step 2 (RBAC) and Step 5 (Provision)** — an unapproved agent never provisions cloud resources and never gets a LiteLLM key minted | ARCHITECTURE.md | verified |
| Immutable audit events | `AuditEvent` model, schema below | api/models/audit.py | verified |
| Resource lineage graph | `ResourceDependency` edges between registry resources with `dependency_type` and a uniqueness constraint | api/models/audit.py | verified |
| A2A registry + invoke | `/api/v1/a2a/agents` CRUD, discovery, and invoke; `A2AAgentRegistry`; `AgentInvocationClient` | api/routes/a2a.py | verified |
| A2A agent card | Registered agents carry `agent_card`, `capabilities`, `auth_scheme`, `endpoint_url`, `team` | api/routes/a2a.py | verified |
| MCP server registry | `mcp_servers` table (migrations 007, 022) + `/api/routes/mcp_servers.py` | file tree + alembic | verified |
| Scoped credentials | 4 scope types in `litellm_key_refs`: `user`, `service_principal`, `agent`, `aps_sidecar`; agent containers hold only `APS_URL` + `APS_TOKEN`, never raw LiteLLM creds | ARCHITECTURE.md | verified |
| Budget attribution chain | Every key carries a `team_id` → LiteLLM team; per-team monthly caps enforced at the proxy | ARCHITECTURE.md | verified |
| Platform sidecar (APS) | Single Go binary auto-injected beside any agent declaring `guardrails:` / MCP `tools:` / `a2a:`; bearer auth + guardrails on `:8080`, localhost helpers on `:9090`; enforces ACL before tool exec or RAG search | ARCHITECTURE.md | verified |
| Provider catalog as YAML | New providers = one entry in `engine/providers/catalog.yaml`, no Python class | ARCHITECTURE.md | verified |
| Model lifecycle | `active`/`beta`/`deprecated`/`retired`; daily diff emits `model.added` / `model.deprecated` audit events | ARCHITECTURE.md | verified (documented; lands with issue #163) |
| Compliance scans | `compliance_scans` table + `/api/routes/compliance.py` + CLI `compliance` command | file tree + alembic 021 | verified (exists) |
| Incidents | `incidents` table + agentops service | alembic 020 | verified (exists) |
| Evals | eval tables, `eval_service.py`, `eval-on-pr.yml` workflow, `.github/actions/eval-action` | file tree | verified (exists) |
| Marketplace | marketplace tables + routes + `.claude-plugin/marketplace.json` | file tree, alembic 011 | verified (exists) |
| Auth surface | All 27 route files authenticated; only `/health`, `/auth/login`, `/auth/register`, SSO callbacks are open | ARCHITECTURE.md | verified as claim (not audited route-by-route) |
| Helm chart | One chart deploys Studio + API + migrations on any K8s, toggleable bundled Postgres/Redis | agentbreeder.io | secondhand |
| 96% test coverage | README claim | README | secondhand — **not verified** |

## C / AgentBreeder — The transferable idea (governance primitives)

Five primitives, each small enough to reimplement in our Express server. All **verified from source**.

### C.1 The action verb set

```python
VALID_ACTIONS        = {"read", "use", "write", "deploy", "publish", "admin"}
VALID_RESOURCE_TYPES = {"agent", "prompt", "tool", "memory", "rag", "model", "mcp_server"}
VALID_PRINCIPAL_TYPES= {"user", "team", "service_principal", "group"}
VALID_SP_ROLES       = {"deployer", "contributor", "viewer"}
```

The important choice is separating **`use`** from **`read`**. `read` means "see the prompt text"; `use` means
"invoke it in a run". Most homegrown ACLs collapse those and then cannot express "your team may run this
agent but may not read its system prompt." Also note `publish` (share to the org registry) is distinct from
`deploy` and from `write`.

*Drift flagged:* `ARCHITECTURE.md` says eight asset types including `knowledge_base`; the code's
`VALID_RESOURCE_TYPES` has seven and no `knowledge_base`. Trust the code.

### C.2 Default grant tables

```python
_OWNER_ACTIONS = ["read", "use", "write", "deploy", "publish", "admin"]
_TEAM_ACTIONS  = ["read", "use"]
```

documented as the matrix:

| Principal | read | use | write | deploy | publish | admin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Owner (creator) | yes | yes | yes | requires approval | yes | yes |
| Owner's team | yes | yes | no | no | no | no |
| Other teams | yes | no | no | no | no | no |
| Unauthenticated | no | no | no | no | no | no |

Two things to steal: **owner-deploy still requires approval** (owning a thing does not mean you may ship
it), and **other teams get `read` by default** — visibility is the default, capability is not. That is the
opposite of most enterprise defaults and it is what makes the registry actually populated.

### C.3 Permission resolution order

`check_permission(db, user_email, resource_type, resource_id, action) -> (bool, str)`, resolving in a fixed
order and returning a **human-readable reason** with every decision:

1. Direct user permission → `"Direct user permission"`
2. Group membership → `"Group permission via group {id}"`
3. Team membership → team-derived grant

Returning the reason string alongside the boolean is the cheap, high-value part. It is what makes an audit
log answerable rather than just chronological.

### C.4 The audit event schema

From `api/models/audit.py`, an immutable append-only table:

| Column | Type | Note |
|---|---|---|
| `id` | UUID | pk |
| `actor` | str(255) | who — indexed |
| `actor_id` | UUID, nullable | |
| `action` | str(50) | what — indexed |
| `resource_type` | str(50) | indexed |
| `resource_id` | str(255), nullable | |
| `resource_name` | str(255) | denormalised so the log survives deletion of the resource |
| `team` | str(100), nullable | |
| `details` | JSON | free-form payload |
| `ip_address` | str(45) | IPv6-width |
| `created_at` | timestamptz | indexed, server default |

The `resource_name` denormalisation is the detail worth copying: the audit row stays readable after the
resource it describes is gone.

Paired with it, `ResourceDependency` — a lineage edge table:
`(source_type, source_id, source_name) → (target_type, target_id, target_name)` plus `dependency_type`, with
a uniqueness constraint on the four-tuple and indexes both directions. That is an impact-analysis graph
("what breaks if I delete this prompt?") in one table.

### C.5 The gate-placement principle

`check_deploy_approved()` sits **between RBAC and provisioning**. The consequence is stated explicitly: no
cloud resources are provisioned and no credential is minted for an unapproved agent. Generalised: *place the
approval gate before the first irreversible or resource-allocating step, not before the last one.* Admins
bypass the gate, and every decision — including the bypass — is written to the audit log.

## C / AgentBreeder — Architecture

Verified from `ARCHITECTURE.md` and the file tree.

- **API**: FastAPI, `api/` with `routes/` (a2a, agents, agentops, analytics, approvals, audit, auth,
  builders, compliance, costs, deployments, evals, gateway, git, marketplace, mcp_servers, memory, models,
  orchestrations, playground, prompts, providers, rag, rbac, registry, sandbox, secrets, teams, templates,
  tracing, plus a `v2/` namespace), `services/`, `models/`, `middleware/rbac.py`.
- **Persistence**: SQLAlchemy async + Alembic, 26 migrations. Migration 015 is `rbac_acl_and_approvals`;
  020 `incidents`; 021 `compliance_scans`; 026 creates AgentOps governance tables.
- **Engine**: `engine/` holds the deployers, provider catalog, schema (`runtime-contract-v1`), and
  `governance.py`.
- **Sidecar**: separate top-level Go module (`sidecar/`, `Dockerfile.sidecar`), auto-injected per agent.
- **CLI**: `cli/` with commands including `auth`, `chat`, `compliance`, `context`, `deploy`, `describe`,
  `doctor`; also a Homebrew formula (`Formula/agentbreeder.rb`) and `Dockerfile.cli`.
- **v2 "platform substrate"**: six lettered tracks (F provider catalog, G model lifecycle, H gateways,
  I polyglot runtime contract, J sidecar, K workspace secrets) whose shared rule is that new frameworks,
  clouds, languages, and providers plug in **without changing the deploy pipeline**. v1 `agent.yaml` files
  run unmodified under v2.
- **RAG/memory**: pluggable backends — `pgvector_rag_backend.py` and `neo4j_rag_backend.py`, plus
  `graph_store.py` / `graph_extraction.py`.

## C / AgentBreeder — Gaps and weaknesses

- **169 open issues against 4 stars.** The issue tracker is being used as a project plan, not a bug queue.
  Several verified features are documented as "lands with #163". — verified.
- **Docs run ahead of code.** Confirmed instance: the eight-asset-type ACL claim vs seven in
  `VALID_RESOURCE_TYPES`. Assume other tables are similarly aspirational; read the code before relying on
  anything. — verified.
- **`TeamService` is partly in-memory.** `rbac_service.check_permission()` iterates
  `TeamService._memberships` — a class-level dict, with an in-line comment acknowledging it. Team-derived
  permissions are therefore not durable across processes in that path. A real correctness gap in the
  governance layer. — verified from source.
- **Heavy runtime dependency stack** to get any of it working: Postgres, Redis, LiteLLM proxy, a Go sidecar,
  optionally Neo4j, Vault, and K8s. Nothing here is adoptable wholesale by a local-first Express app — only
  the schemas and the decision order are. — verified from tree.
- **Unverifiable quality claims.** "96% test coverage" was not confirmed. — verified as unconfirmed.
- **Single-vendor-shaped CLA + trademark files** suggest a future commercial layer; Apache-2.0 covers the
  code today but the governance of the project itself is centralised. — verified (files exist).

---

## Overlap with Loush Dashboard

| Their feature | Our equivalent section (or NONE) | Who does it better | Note |
|---|---|---|---|
| A: structured CSS/DOM extraction (`CSSData`, `StyleSummary`) | `server/figma-capture.mjs` (Figma node tree + screenshot + annotations) | **Them, clearly** | We capture design-side truth from Figma; they capture implementation-side truth from a live page. Complementary, not competing — a Figma frame and a live-page extraction of the same screen is a diff we cannot currently produce. |
| A: heuristic component discovery | `figma-capture.mjs` `COMPONENT_EXPORT_RES` regex scan of `.tsx` exports | **Tie** | Both are explicitly regex heuristics over source text. Ours reads the repo; theirs reads the rendered DOM. |
| A: section/block segmentation with bounds | NONE | Them | Nothing in our stack segments a page into named blocks with bounding boxes. |
| A: 10-category tool taxonomy | `McpSection`, `HooksSection`, `CapabilityLedger` — we *inventory* tools, we do not *define* them | Them (as a design pattern) | We have no tool registry of our own; this is a documentation artefact for us, not code to port. |
| A: self-healing loop + sandbox | `RunsSection`, `ReliabilitySection` (observe runs) | Them | We are read-only over transcripts by design. Not a gap we want to close. |
| A: multi-agent orchestrator | `FlowSection` / `PlanGraph` visualise flows; we do not run agents | Them (they execute); **us** (we visualise) | Different jobs. |
| B1: container isolation, mount allowlist | NONE — we are a localhost Express process reading `~/.claude` | Them | Genuinely not applicable at single-user local-first scale. The *allowlist file* shape is mildly interesting for constraining which repos the dashboard may read. |
| B1: credential isolation via proxy | `figma-capture.mjs` token handling (env → `~/.claude/dashboard-figma-token.json`, never echoed back) | **Them** for isolation, **us** for simplicity | Our approach is right for a localhost tool; theirs is right for a container. |
| B1: multi-messenger channels | `InboxSection`, `ChatSection` | Them | Out of scope for a local dashboard. |
| B2: rwx matrix per (identity, contact) | NONE | Them | **The single most transferable idea in this report.** |
| B2: 4-level transport trust | NONE | Them | Only meaningful when messages arrive from outside; our inputs are local files. Not portable. |
| B2: append-only signed audit log | `GovernanceSection` → "Audit log" tab | **Them** (signed, tamperproof) vs **us** (exists and is shipped) | Our audit log is real and running; theirs is an invariant statement. |
| B2: address book with glob patterns | NONE | Them | Directly applicable to our project/repo access story. |
| C: RBAC roles + per-asset ACL | NONE — no principal concept at all | Them | We are single-user; the *vocabulary* is what transfers, not the enforcement. |
| C: approval queue + gate placement | `GovernanceSection` → "Approvals" tab | **Us on shipping, them on rigor** | We have an approvals UI; they have a principled rule about *where* the gate sits. |
| C: immutable audit event schema | `GovernanceSection` → "Audit log" | **Them on schema**, us on it being live | Their column set (`resource_name` denormalised, `details` JSON, indexed actor/action/resource_type) is a strict superset of a minimal log. |
| C: agent/asset registry | `LibrarySection`, `ResourceSection`, `CapabilityLedger`, `McpSection` | **Tie** | We already have registry-shaped sections; theirs adds ACL and lineage columns. |
| C: resource dependency lineage | `PlanGraph` / `FlowSection` (d3) — flow graphs, not dependency graphs | **Them on model**, **us on rendering** | We already ship d3. Their edge table would feed our existing graph renderer almost directly. |
| C: A2A protocol registry | `McpSection` (MCP servers) | Them | We have no agent-to-agent concept. Low value at our scale. |
| C: drift detection | `GovernanceSection` → "Drift" tab | **Us** | They have compliance scans; we have a shipped drift view. |
| C: cost/budget attribution | `UsagePanel`, `InsightsSection` | **Tie** | Theirs is enforcement (proxy-level caps); ours is observation. Ours fits local-first. |
| C: team roles | `TeamBaseline` | Them on model, us on shipping | `TeamBaseline` compares people; it has no permission concept. |
| All three: local-first, zero telemetry | Our thesis | **Us** | beadle is the closest philosophically (own machine, keychain, no third party). NanoClaw is local but depends on an external gateway. AgentBreeder is the opposite of local-first. |

## Recommended adoptions

Ranked by value-per-unit-effort. Nothing here requires copying a single line of anyone's source, which
matters given the licence situation with A.

### 1. The rwx access matrix, as a new "Access" tab in Governance — effort **M**

**Take:** beadle's DES-012 permission model, retargeted from (identity, contact) to **(profile, project)**.

**Lands in:** new `server/access.mjs` + a new tab in `src/sections/GovernanceSection.jsx` (it already has a
five-tab shell — `Versions | Approvals | Audit log | Drift | Batch ops` — so a sixth tab is a two-line
change). Store as JSON under `~/.claude/dashboard-access.json`, same pattern as
`dashboard-figma-token.json`.

**Semantics, mapped to us:**

| Bit | Our meaning |
|---|---|
| `r` | The dashboard may read and display this project's transcripts and repo contents |
| `w` | The dashboard may write into this project (artifacts, captures, `.claude/` files) |
| `x` | The dashboard may run commands against this project (git, ticket tooling, capture creation) |

Keep beadle's five rules intact: whitelist default `---`, no inheritance between profiles, explicit cells,
per-bit enforcement at named call sites, and — critically — **the matrix does not govern its own editing**.
Also keep the redacted-listing idea: a project without `r` still appears in the project list by name and
path, with its contents hidden. That is what makes the model discoverable rather than confusing.

**Unlocks:** a coherent story for the two things we cannot currently express — multi-project safety (a
read-only project you can browse but the dashboard will never `git` against) and the multi-user/shared-device
case. It also gives every existing section one place to ask "may I?", which today is nowhere. And it is the
kind of primitive that is far cheaper to add before the sections multiply than after.

### 2. Live-page structured extraction beside Figma Capture — effort **M/L**

**Take:** A's `CSSData` + `StyleSummary` + section-block schema (the shapes in section A.2, reimplemented —
do not copy their Python).

**Lands in:** a sibling to `server/figma-capture.mjs` — call it `server/page-capture.mjs` — writing into the
same per-repo `.claude/figma-captures/<slug>/` layout so the existing Captures UI picks it up with minimal
change. Playwright is the obvious driver; if we do not want that dependency, a `page.evaluate`-style
extraction script run through an existing browser MCP gets most of `StyleSummary` and `CSSData.variables`.

**Do the cheap half first.** `StyleSummary` alone — value→count histograms for colors, background colors,
font families, font sizes, margins, paddings, display, position — is a few dozen lines over
`getComputedStyle` and yields a prompt-sized design-token summary of any page. Then `CSSData.variables` and
`CSSData.media_queries`. Leave `pseudo_elements`, `animations`, and `InteractionState` screenshots for later;
they are where the effort spikes and the value drops.

**Unlocks:** the diff we cannot do today — Figma frame vs shipped page, on the same screen, in one capture
folder. That turns Figma Capture from "here is the design" into "here is where the build drifted from the
design," which is a materially better product for the same UI surface.

### 3. Upgrade the audit log schema and add a lineage table — effort **S**

**Take:** C's `AuditEvent` column set and `ResourceDependency` edge table.

**Lands in:** whatever backs `GET /api/gov/*` today (found via `GovernanceSection.jsx`; the audit tab already
exists). Add the missing columns — especially **`resource_name` denormalised** so rows stay readable after
deletion, **`details` as free-form JSON**, and indexes on actor / action / resource_type. Add
`check_permission`-style **reason strings** to every governance decision we record.

Then add the lineage edges: `(source_type, source_id, source_name) → (target_type, target_id, target_name,
dependency_type)`. We already ship d3 and already have `PlanGraph`; an impact graph ("what depends on this
prompt / hook / MCP server?") is mostly a rendering exercise once the table exists.

**Unlocks:** an audit log you can actually query, and impact analysis across our existing registry-shaped
sections (`LibrarySection`, `ResourceSection`, `McpSection`, `CapabilityLedger`) — which currently list
things but do not connect them.

### 4. Adopt C's action verbs and gate-placement rule — effort **S**

**Take:** the verb set `{read, use, write, deploy, publish, admin}` — specifically the `read`/`use` split —
as the vocabulary for the Access tab in item 1 and the existing Approvals tab. Plus the rule: *the approval
gate goes before the first irreversible or resource-allocating step*, and *admin bypass is itself audited*.

**Lands in:** `GovernanceSection.jsx` (Approvals), and as documented policy in `docs/`.

**Unlocks:** consistent language across Governance, Access, and the registry sections, and a defensible
answer to "where exactly does approval happen?" — which is currently implicit. Nearly free, and it makes
item 1 land in the right shape rather than needing a vocabulary migration later.

### 5. Document the 10-category tool taxonomy — effort **S**

**Take:** A's category partition, especially the **Preview → Diagnostics → Self-Healing** ladder and the
**Source Query** context-budget pattern.

**Lands in:** `docs/` as a design note, and as an organising principle for `McpSection` /
`CapabilityLedger`, which currently list tools without functional grouping.

**Unlocks:** a better information architecture for our tool-inventory sections, and — the more interesting
one — the Source Query idea applied to us. Our `.jsonl` transcripts have exactly the problem their 200KB
extraction has: too big to read, must be queried. Framing our transcript endpoints as "source query tools an
agent can call" rather than "data the UI renders" is a genuinely different product direction, and this
taxonomy is the cheapest way to think about it.

### Explicitly NOT recommended

- **NanoClaw's container isolation model.** We are a localhost Express process reading the user's own files
  on the user's own machine. Docker, mount allowlists, egress lockdown, and a credential-injecting proxy
  solve a threat model we do not have. Adopting any of it would add a Docker dependency and violate the
  local-first thesis for zero security gain. The one salvageable crumb — a fail-closed allowlist file
  outside the project root, listing which roots may be read — is already covered better by item 1.
- **beadle's four-level transport trust.** Meaningful only for messages arriving from strangers. Every input
  we handle is a local file the user already owns.
- **AgentBreeder's A2A registry, service principals, LiteLLM key minting, budget caps, sidecar.** All
  presuppose multi-tenant infrastructure. At single-user scale they are pure ceremony.
- **Any code copied verbatim from Perfect-Web-Clone**, until the licence question is settled in writing.
  Take the schema, write the code.

---

## Sources

### Fetched and read (all 2026-07-29)

**A — Perfect-Web-Clone**

- https://github.com/ericshang98/Perfect-Web-Clone — GitHub API metadata (`gh api repos/...`)
- https://github.com/ericshang98/Perfect-Web-Clone — full recursive file tree (`git/trees/HEAD?recursive=1`)
- https://raw.githubusercontent.com/ericshang98/Perfect-Web-Clone/main/README.md — full README, incl. the 40+ tool table and architecture diagrams
- https://github.com/ericshang98/Perfect-Web-Clone/blob/main/backend/agent/tools/tool_registry.py
- https://github.com/ericshang98/Perfect-Web-Clone/blob/main/backend/extractor/extractor_service.py
- https://github.com/ericshang98/Perfect-Web-Clone/blob/main/backend/extractor/models.py
- https://github.com/ericshang98/Perfect-Web-Clone/blob/main/backend/json_storage/section_analyzer.py
- `GET /repos/ericshang98/Perfect-Web-Clone/contents/LICENSE` → **404 (no LICENSE file)**

**B1 — NanoClaw**

- https://github.com/nanocoai/nanoclaw — GitHub API metadata
- https://raw.githubusercontent.com/nanocoai/nanoclaw/main/README.md
- https://github.com/nanocoai/nanoclaw/blob/main/docs/SECURITY.md — full security model, mount table, allowlist schema, egress lockdown

**B2 — beadle**

- https://github.com/punt-labs/beadle — GitHub API metadata
- https://github.com/punt-labs/beadle — full recursive file tree
- https://github.com/punt-labs/beadle/blob/main/README.md
- https://github.com/punt-labs/beadle/blob/main/DESIGN.md — DES-001 … DES-013, incl. the full DES-012 rwx model
- https://github.com/punt-labs/beadle/blob/main/docs/ARCHITECTURE.md — package map, trust model, design invariants
- https://github.com/punt-labs/beadle/blob/main/commands/contacts.md — address-book CLI/slash-command surface

**C — AgentBreeder**

- https://github.com/agentbreeder/agentbreeder — GitHub API metadata
- https://github.com/agentbreeder/agentbreeder — full recursive file tree
- https://raw.githubusercontent.com/agentbreeder/agentbreeder/main/README.md
- https://github.com/agentbreeder/agentbreeder/blob/main/ARCHITECTURE.md — v2 substrate, three-tier builder, full Governance section
- https://github.com/agentbreeder/agentbreeder/blob/main/api/services/rbac_service.py
- https://github.com/agentbreeder/agentbreeder/blob/main/api/middleware/rbac.py
- https://github.com/agentbreeder/agentbreeder/blob/main/api/routes/a2a.py
- https://github.com/agentbreeder/agentbreeder/blob/main/api/models/audit.py
- https://github.com/agentbreeder/agentbreeder/blob/main/api/models/schemas.py (RBAC constants)
- https://www.agentbreeder.io/ — via search summary only
- https://pypi.org/project/agentbreeder/2.0.1/ — via search result only

**Our own repo (for comparison)**

- `E:\AI-Dashboard\server\figma-capture.mjs`
- `E:\AI-Dashboard\server\constitution.mjs`
- `E:\AI-Dashboard\src\sections\GovernanceSection.jsx`
- `E:\AI-Dashboard\src\sections\` (full section listing)

### Searches run

**Web searches (WebSearch):**

1. `pixel-perfect web cloning agent Claude Agent SDK multi-agent 40 tools CSS structured blocks` — **hit** (found A immediately)
2. `NanoClaw Claude agents isolated containers multi-messenger AI assistant` — **hit** (found B1)
3. `enterprise agent governance platform framework-agnostic LangGraph CrewAI Claude SDK OpenAI Agents Google ADK RBAC A2A MCP` — partial; returned comparison articles and Microsoft/Kagent/Obot/Lyzr/Kore.ai, **not** the target
4. `NanoClaw github repo email address book rwx permissions Claude Code` — partial; found `nanocoai/nanoclaw` but not the rwx variant
5. `github "agent governance" platform build deploy govern enterprise AI agents LangGraph CrewAI "Claude" "Google ADK" RBAC audit registry open source` — partial; surfaced `microsoft/agent-governance-toolkit`, not the target
6. `"nanoclaw" email channel "address book" permissions read write execute per sender` — **miss** for the rwx model; surfaced only NanoClaw email skills/channels
7. `Claude Code email agent "address book" UNIX rwx permissions per interaction pair github` — **miss**; returned Nylas guides and Claude Code permission docs, nothing on target
8. `open source platform "build, deploy" and govern enterprise AI agents "framework-agnostic" A2A MCP RBAC kubernetes AWS Azure GCP github 2026` — **miss** for the target; surfaced Kagenti, kagent, Obot, AWS MCP Gateway, Microsoft toolkit
9. `"Perfect-Web-Clone" OR "Nexting" ericshang98 Show HN Reddit review` — **no Show HN / Reddit coverage found**; only aggregator listings and sibling repos
10. `"agentbreeder" agent platform review Show HN reddit agentbreeder.io` — **no Show HN / Reddit coverage found**

**GitHub API searches (`gh api search/...`):**

11. `search/repositories?q=agent+governance+enterprise+langgraph+crewai&sort=stars` — **hit**, this is how C was found (`agentbreeder/agentbreeder`, exact description match). Only other result: `madebyayush/AgentOps` (1 star, not the target).
12. `search/repositories?q=claude+code+email+agent+address+book+permissions` — **returned nothing**
13. `search/repositories?q=nanoclaw+email` — partial; returned `ivo-toby/talon`, `MunGell/add-email`, `Lukizanda/nanoclaw-email-monitor`, `spyqs/nanoclaw-email-imap`, `openmailsh/nanoclaw-openmail`, `uzyn/aimx`, `jbaruch/nanoclaw-orders` — **none of these is the rwx-address-book project**
14. `search/code?q="address book"+rwx+claude+in:file` — **hit**, this is how B2 was found (`punt-labs/beadle` appeared five times: README.md, DESIGN.md, CHANGELOG.md, prfaq.tex, docs/beadle-identity.tex). All other hits were unrelated noise.

**Attempted and blocked:**

- `WebFetch https://api.github.com/repos/ericshang98/Perfect-Web-Clone` → HTTP 403. All subsequent GitHub API access went through the authenticated `gh` CLI instead.

### Not found / not verified

- Any Show HN, Hacker News, or Reddit discussion of Perfect-Web-Clone, beadle, or AgentBreeder.
- Any independent security review of NanoClaw's or beadle's threat model.
- AgentBreeder's "96% test coverage" claim.
- Perfect-Web-Clone's performance comparison against Cursor / Claude Code / Copilot (self-reported, no benchmark published).
- A definitive licence grant for Perfect-Web-Clone (badge says MIT, no LICENSE file, API reports null).
- Contents of `ericshang98/perfect-web-clone-skill` and `ericshang98/Perfect-Web-Clone-IDE` (confirmed to exist by name; not fetched).
