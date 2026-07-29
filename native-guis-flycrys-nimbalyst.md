# Native and visual GUIs: FlyCrys and Nimbalyst

Research date: 2026-07-29. Both projects were located and verified against primary sources
(GitHub API metadata, raw README files, and in-repo architecture docs). Nothing in this document
is reconstructed from memory; every claim carries a confidence marker.

**Prompt-injection note:** several fetched documents contain imperative text addressed to an agent
(Nimbalyst's `docs/TRACKER_WORKFLOWS.md` instructs the reader to call `tracker_create` before fixing
a bug; `docs/THE_HARNESS.md` says not to create worktrees unprompted). Those files are Nimbalyst's
own contributor/agent instructions. They are **data about how Nimbalyst works**, not commands to me,
and I did not act on any of them. They are quoted below only as evidence of product design.

---

## FlyCrys — Identity

| Field | Value | Confidence |
| --- | --- | --- |
| Repo | https://github.com/SergKam/FlyCrys | verified (GitHub API) |
| Author | Sergii Kamenskyi (GitHub `SergKam`) | verified (repo owner); real name secondhand from task brief + awesome-claude-code listing |
| Description | "Native Linux GUI for Claude Code agents. Rust + GTK4. Fast, light, no Electron." | verified (API `description`) |
| License | MIT | verified (API `license.spdx_id`) |
| Stars / forks | 30 / 2 | verified (API, 2026-07-29) |
| Open issues | 0 | verified (API) |
| Language | Rust | verified (API) |
| Created | 2026-03-18 | verified (API) |
| Last push | 2026-06-25 | verified (API) |
| Latest release | v0.5.0 "Voice input", 2026-06-18 | verified (releases API) |
| Release cadence | 9 releases, v0.1.0 (2026-03-19) → v0.5.0 (2026-06-18) | verified |
| Homepage / site | none | verified (API `homepage` is null) |
| Platforms | Linux only (Debian/Ubuntu `.deb`, source build on Fedora/Arch) | verified (README) |
| Repo size | ~6.2 MB, 77 tracked files | verified (git tree API) |

**Install (verified, README):**
```bash
curl -fsSLo /tmp/flycrys.deb https://github.com/SergKam/FlyCrys/releases/latest/download/flycrys_amd64.deb
sudo apt install /tmp/flycrys.deb
```
Requires the Claude Code CLI (`npm install -g @anthropic-ai/claude-code`) plus GTK4, VTE4,
WebKitGTK 6.0 and libsoup 3.0.

**What I could not verify:** no download counts, no user-base figures, no roadmap document I could
read (`docs/todo.md` exists in the tree but I did not fetch it), and no Reddit/Show HN announcement
thread. Searches for a Reddit or HN launch post returned nothing attributable — see Sources. The
project appears to be a solo effort with a small audience (30 stars); treat it as a well-built
reference implementation, not a widely-validated product.

## FlyCrys — The problem it solves

Stated by the author in the README, first person (verified). He has used Linux exclusively for 30
years, and when Claude Code became his daily driver the terminal-only workflow hit walls he
enumerates: no image preview, no file tree visible while the agent works, no markdown rendering
without switching to a browser, and no way to juggle multiple project streams without a mess of
terminal tabs. He explicitly did not want Cursor or "anything Electron-based" (verified quote,
9 words).

The secondary problem is a platform gap. The README claims FlyCrys is the "Only native Linux GUI for
Claude Code" (verified quote, 7 words), noting Opcode uses a webview and Claude Desktop skips Linux
entirely. I did not independently audit that claim against every competitor; treat the *uniqueness*
as the author's assertion (secondhand), while the *nativeness of FlyCrys itself* is verified from
the Cargo dependency list.

## FlyCrys — Value proposition

The framing is unusually disciplined and worth stealing rhetorically. From the README (verified):
FlyCrys is not an IDE and does not edit files — agents do. It gives you a workspace to manage that
workflow. The value pillars as stated:

- **Native GTK4** — follows system theme, integrates with GNOME, minimal resources (verified claim).
- **Workspace-oriented, not a chat wrapper** — tree, viewer, terminal and git panel wired together.
- **Agent profiles** — preconfigured Security, Research and Default agents with custom system
  prompts and tool restrictions.
- **Zero cost** — no subscription, no API proxy; it drives your own Claude Code CLI.
- **Single binary** — one `cargo build`, one `.deb`. Starts in under a second.

The startup-time and resource claims are the author's (secondhand — I ran no benchmark), but they
are plausible given the stack: a Rust binary linking system GTK4 has no Node runtime to boot.

## FlyCrys — Feature inventory

| Feature | What it does | Evidence (URL/screenshot/code) | Confidence |
| --- | --- | --- | --- |
| Four-pane workspace | Tree left, viewer center, agent chat right, terminal bottom | README "Why this exists"; `docs/screenshot-workspace.png` | verified |
| Agent profiles | Named profiles with system prompt, allowed tool list, model | `src/models/agent_config.rs` (struct below) | verified (code) |
| Tool restriction enforcement | Each allowed tool passed as `--allowedTools <tool>` to the CLI | `src/services/cli/claude.rs:671-673` | verified (code) |
| Permission routing | `--permission-prompt-tool stdio` routes tool-permission + AskUserQuestion decisions into the GUI | `src/services/cli/claude.rs:659-660` | verified (code) |
| Streaming protocol | `-p --output-format stream-json --verbose --include-partial-messages --input-format stream-json` | `src/services/cli/claude.rs:648-654` | verified (code) |
| Session resume / fork | `--resume <id>`, and `--fork-session` when cloning a workspace tab | `src/services/cli/claude.rs:680-684`; README workspace section | verified (code) |
| Model + effort selection | `--model`, `--effort` flags from profile config | `src/services/cli/claude.rs:675-678` | verified (code) |
| AskUserQuestion cards | Claude's multiple-choice questions answered inline as in-chat cards | README; `docs/screenshot-features.png` | verified (documented + screenshot) |
| Pause / resume / stop | Agent process lifecycle control | README chat section; `resume()` at `claude.rs:809` | verified |
| Streaming markdown chat | Tables, code blocks, lists, blockquotes rendered live in WebKitGTK | README; `pulldown-cmark` + `webkit6` in Cargo table | verified |
| Inline tool calls | Tool calls shown inline with spinners | README | verified (documented) |
| Image attachments | Clipboard paste or file picker; drag files/folders into prompt | README | verified (documented) |
| Bookmarks | Reusable saved prompts | README; `src/bookmark_dialog.rs` | verified |
| Clickable file paths | Paths in agent responses open in the viewer | README | verified (documented) |
| Token/cost status bar | Token usage and session cost shown in status bar | README | verified (documented) |
| Slash command discovery | Reads `~/.claude/commands/`, `~/.claude/skills/`, project `.claude/`, and installed plugins | README; `src/services/skills.rs` | verified |
| Skills/commands CRUD | Full create/read/update/delete dialog | README; `src/skills_dialog.rs`; `docs/screenshot-skills.png` | verified |
| File tree | Lazy-loading, MIME icons, inotify live refresh preserving expand state | README; `src/tree.rs`, `src/watcher.rs` | verified |
| Project-wide search | Filters across project; results carry full tree context menu + "Show in Tree" | README; screenshot caption | verified |
| Git status coloring | Colors files *and ancestor folders* in the tree; separate git status panel | README; `src/git_status.rs`, `src/git_panel.rs` | verified |
| Three-state viewer | Segmented toggle: Source / Preview / Diff | README; `src/textview.rs` | verified |
| Syntax highlighting | ~50 languages via syntect, plus bundled TS/TSX, TOML, Dockerfile grammars | README; `assets/syntaxes/*` | verified |
| In-view find bar | Ctrl+F, incremental highlight-all, match counter, Enter/Shift+Enter stepping | README; `src/find_bar.rs`; screenshot shows "1 of 6" | verified |
| Tabbed terminal (Run Panel) | Multiple VTE shells per workspace, `[+]` creates `bash(N)`, drag-reorder | README; `src/run_panel.rs`, `src/terminal.rs` | verified |
| Background task tabs | Auto-creates a task tab when Claude runs `run_in_background`; streams the task file | README | verified (documented) |
| Task status indicators | running / completed / failed, driven by Claude's `task_notification` events | README | verified (documented) |
| Lazy terminal construction | VTE terminals only built on first focus; scrollback persisted per tab | README | verified (documented) |
| Multi-tab workspaces | One tab per project, tabs on top; lazy tab loading at startup | README; `src/workspace.rs` | verified |
| Tab context menu | Rename, Clone (forks agent session), Open session in Claude CLI, Open folder | README | verified (documented) |
| Session persistence | Window size, pane positions, open files, agent sessions restored | README; `src/services/storage.rs` | verified |
| Desktop notifications | Fires when agents finish | README | verified (documented) |
| Voice input | Headline feature of v0.5.0 | release v0.5.0 title; `src/services/voice.rs` | verified |
| Light/dark theme toggle | Terminal colors adapt too | README; `src/config/theme.rs` | verified |

**The agent profile struct (verified, `src/models/agent_config.rs`, full file):**
```rust
/// Agent profile configuration — stored in ~/.config/flycrys/agents/
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AgentConfig {
    pub name: String,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    #[serde(default)]
    pub model: Option<String>,
}
```
That is the entire concept: four fields, one JSON file per profile in a config directory. This is
the single cheapest idea in either project to copy.

## FlyCrys — UX and interaction design

**Layout.** A fixed four-region frame, not a dockable workspace: workspace tabs across the top,
file tree left, viewer center, agent chat right, Run Panel bottom. Pane positions persist across
restarts. The rigidity is the point — the author's thesis is that a Claude Code GUI needs exactly
these four surfaces and nothing else, because the agent does the editing.

**The viewer is read-first.** A three-state segmented toggle switches Source / Preview / Diff for
the same file. This is a good pattern for us: it means "diff" is not a separate screen or modal, it
is a *view mode of the file you are already looking at*. Markdown renders in WebKitGTK, images
preview with scaling, and git diffs render with highlighting — all in the same center pane.

**Chat-to-file navigation is bidirectional.** File paths in agent responses are clickable and open
in the viewer; conversely you can drag files and folders from the tree onto the agent input, and
right-click a tree node to "Add to Chat". The Run Panel adds a third direction: right-click a
terminal tab header gives "Add Selected to Chat", so terminal output flows into the prompt. Search
results are first-class — the README notes they behave like the tree (single-click opens,
double-click reveals, right-click gives the same menu plus "Show in Tree"). That symmetry between
search results and tree nodes is a small, high-value detail most tools get wrong.

**Interruption model.** The agent is a process you can pause, resume and stop. Combined with
session resume across restarts and tab-level Clone (which forks the underlying Claude session via
`--fork-session`), the mental model is "an agent session is a durable, forkable object", not "a
chat log". Cloning a tab to explore a divergent path is the poor-man's worktree — cheaper than
Nimbalyst's real worktrees and worth noting as a middle option.

**Permission UX.** This is the most interesting interaction detail. Rather than blanket
`--dangerously-skip-permissions`, FlyCrys passes `--permission-prompt-tool stdio` and handles the
control protocol itself. A code comment (verified, `claude.rs:498-499`) says every other
tool-permission request is auto-allowed immediately, preserving the previous skip-permissions
behavior. So in practice: `AskUserQuestion` is intercepted and rendered as an interactive card the
user answers inline, while ordinary tool permissions are auto-approved. It is a *selective*
interception — the GUI grabs only the decisions where a human adds value. There is also a deliberate
denial path where the AskUserQuestion permission is denied with a directive message
(`claude.rs:780`) so the CLI re-routes the question into the GUI's card renderer.

**Background work is visible.** When Claude launches a `run_in_background` command, a task tab
appears automatically showing the command, a separator, then streamed output, with a ⏳/✓/✗ status
glyph driven by Claude's `task_notification` events. Background work never disappears into a void.

## FlyCrys — Architecture

Single Rust binary, no IPC layer, no server, no web stack except the WebKit widget used purely as a
rendering surface for chat and markdown.

| Crate | Purpose | Confidence |
| --- | --- | --- |
| `gtk4` 0.10 | UI toolkit | verified (README table) |
| `webkit6` 0.5 | Chat rendering, markdown preview | verified |
| `vte4` 0.9 | Embedded terminal | verified |
| `syntect` 5 | Syntax highlighting | verified |
| `pulldown-cmark` 0.12 | Markdown → HTML | verified |
| `notify` 6 | Filesystem watcher (inotify) | verified |
| `serde` / `serde_json` | Config persistence and CLI protocol | verified |

Module organisation (verified from the git tree): `src/services/cli/claude.rs` is the CLI process
driver and the largest single concern (~29 KB); `src/ui/agent_panel/` splits into `chat_factory`,
`event_handler`, `slash_popover` and `state`; `src/models/` holds the serde types
(`agent_config`, `app_config`, `bookmark`, `chat`, `slash_command`, `workspace_config`);
`src/services/` holds `git`, `platform`, `skills`, `storage`, `voice`. Tests exist for
`agent_config`, `agent_event`, `chat_history`, `highlight`, `markdown`, `session` — modest but real.
CI and release workflows are present under `.github/workflows/`.

Integration is entirely through the official CLI's documented streaming JSON protocol. There is no
API proxy and no key handling, which is why "zero cost" holds. Config lives in
`~/.config/flycrys/`, agent profiles as individual files under `agents/`.

## FlyCrys — Gaps and weaknesses

- **Linux-only, and that is architectural.** GTK4 + VTE4 + WebKitGTK is not a portable stack in
  practice. Nothing here ships to macOS or Windows without a rewrite. (verified)
- **Small and solo.** 30 stars, 2 forks, 0 open issues, one visible author. Zero open issues on a
  4-month-old project usually means "no users filing them", not "no bugs". (verified metadata,
  interpretation mine)
- **Slowing cadence.** Five releases in the first two weeks, then v0.3.0 (April), v0.4.0 (June),
  v0.5.0 (June 18), last push June 25. A month of silence as of this writing. Not abandoned, but not
  the daily churn of Nimbalyst. (verified)
- **No editing.** By design it does not edit files. If you want to fix a typo the agent introduced,
  you leave the app. The viewer is read-only. (verified from README)
- **Permissions are effectively auto-allow.** Despite routing through
  `--permission-prompt-tool stdio`, the code comment says non-AskUserQuestion requests are
  auto-allowed to preserve skip-permissions behavior. The tool-restriction story therefore rests
  entirely on the `--allowedTools` allowlist at spawn time, not on interactive gating. Anyone
  copying the "Security profile" idea should understand it is a *launch-time* restriction.
  (verified from code comments)
- **No diff approval.** There is a git diff *view*, but no accept/reject of agent edits. (verified)
- **No tests around the CLI driver.** The largest and riskiest module has no dedicated test file in
  `tests/`. (verified from tree; possible in-file `#[cfg(test)]` modules I did not read)

---

## Nimbalyst — Identity

| Field | Value | Confidence |
| --- | --- | --- |
| Repo | https://github.com/nimbalyst/nimbalyst | verified (GitHub API) |
| Site | https://nimbalyst.com/ ; docs at https://docs.nimbalyst.com/ | verified (API `homepage`, README) |
| Authors | Greg Hinkle (CTO, GitHub `ghinkle`), Karl Wirth (CEO), Jordan Bentley | Hinkle verified as HN submitter + GitHub user; full founder list secondhand (search results, Crunchbase) |
| Company | Stravu | secondhand (search results, Crunchbase) |
| Lineage | Successor to Crystal (`stravu/crystal`), deprecated Feb 2026 | strong-secondhand: `stravu/crystal` repo title reads "(Crystal is now Nimbalyst)"; Feb 2026 date from search snippet, not verified |
| License | MIT (repo). Sync server is a separate project. | verified (API + `LICENSING.md`) |
| Stars / forks | 1,339 / 188 | verified (API, 2026-07-29) |
| Open issues | 479 | verified (API) |
| Language | TypeScript | verified (API) |
| Created | 2025-10-30 | verified (API) |
| Last push | 2026-07-28 (one day before research) | verified (API) |
| Latest release | v0.71.3, 2026-07-28 | verified (releases API) |
| Release cadence | Near-daily: v0.70.2 → v0.71.3 in the seven days to 2026-07-28 | verified |
| Repo size | ~58 MB | verified (API) |
| Platforms | macOS 12+ (arm64 + x64), Windows 10+, Linux AppImage; iOS + Android companions | verified (README download table) |
| Community | Discord, GitHub Discussions, public roadmap project board | verified (README links) |

**Install (verified, README):** prebuilt downloads per platform from GitHub releases — macOS `.dmg`
(separate Apple Silicon and Intel builds), Windows `.exe`, Linux `.AppImage`. Build from source is
`npm install`, then `cd packages/electron && npm run dev`. Auto-update is built in with **stable**
and **alpha** release channels, switchable under Settings → Advanced → Release Channel; fresh
installs default to stable.

**Licensing nuance worth flagging.** The repo's `LICENSING.md` (verified, fetched) says only: MIT
for this repository, sync server is a separate project, contact `legal@nimbalyst.com`. However the
Show HN post description reportedly states the local app is MIT and free while team collaboration
features are AGPL and will be paid (**secondhand** — this came from the HN page summary, and the
AGPL/paid claim is *not* corroborated by `LICENSING.md`). For our purposes: the code we would copy
is MIT and unambiguous. The collaboration/sync layer is the part with a commercial future, and I
would not build on it.

**What I could not verify:** download counts, active user numbers, funding, and the exact Crystal
deprecation date. I also did not read the extension marketplace's hosting terms.

## Nimbalyst — The problem it solves

Coding agents produce artifacts that are not code — plans, specs, diagrams, data models, task lists —
and the terminal is a bad place to review any of them. Meanwhile agent *sessions* have become the
unit of work, and there is no UI for managing many of them at once.

Nimbalyst attacks both. The README's self-description (verified quote, 14 words): "a free,
open-source, local, interactive visual editor & session/task manager for developers, product
managers, designers, builders." Note the audience list — this is deliberately not a developer-only
tool, which is why the artifact formats skew toward mockups, diagrams and data models rather than
just code.

The deeper insight, which our project should internalise: if the agent and the human edit the *same
files on disk*, and those files are markdown/CSV/Excalidraw/mermaid rather than a proprietary
database, then "collaboration with an agent" reduces to "a good editor plus a good diff". The README
calls this **Open** storage (verified): content and status in markdown, workflow in slash commands,
plain files on disk or in git.

## Nimbalyst — Value proposition

- **Visual co-editing across seven formats**, each with WYSIWYG editing and agent integration.
- **Red/green diff approval** for every agent change, in the *native view of the format* — not as a
  unified text diff.
- **Session and task management** as first-class UI: kanban, parallel sessions, search/resume,
  bidirectional session↔file linking.
- **Real git workflow**: worktrees, AI commit messages, PR review mode, embedded Ghostty terminal.
- **Extensible**: every editor including built-ins goes through the same `EditorHost` contract, so
  third-party editors are genuinely first-class rather than second-tier plugins.
- **Agent-agnostic**: Codex, Claude Code, Opencode (alpha), Copilot (alpha).
- **Mobile companion** for reviewing and unblocking agents away from the desk.

## Nimbalyst — Feature inventory

| Feature | What it does | Evidence (URL/screenshot/code) | Confidence |
| --- | --- | --- | --- |
| Red/green WYSIWYG diff approval | Agent edits land on disk, are detected, and shown as accept/reject diffs in the format's own editor | `docs/FILE_WATCHER_DIFF_SYSTEM.md` (full flow diagram) | verified (design doc) |
| PreToolUse hook tagging | Hook snapshots original file content before the agent's tool runs | `docs/FILE_WATCHER_DIFF_SYSTEM.md`; impl at `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` | verified (doc); impl file not read |
| One-pending-tag-per-file constraint | DB partial unique index prevents duplicate pending tags | `docs/FILE_WATCHER_DIFF_SYSTEM.md` | verified (doc) |
| Consecutive-edit coalescing | Multiple edits to one file show original→latest, not first→second | `docs/FILE_WATCHER_DIFF_SYSTEM.md` §Key Features | verified (doc) |
| Markdown WYSIWYG editor | Lexical-based rich text for `.md`/`.txt` — tables, images, code blocks | README; `docs/EXTENSION_ARCHITECTURE.md` §Current Editor Types | verified |
| Monaco code editor | VS Code-style editing for `.ts`/`.js`/`.json` etc. | `docs/EXTENSION_ARCHITECTURE.md` | verified |
| CSV / spreadsheet editor | RevoGrid with formulas, sorting, filtering; cell-level diff | `docs/EXTENSION_ARCHITECTURE.md`; hook override example mentions "cell-level CSV diff with phantom rows" | verified |
| Excalidraw editor | `.excalidraw` whiteboard diagrams | README; `docs/EXTENSION_ARCHITECTURE.md` | verified |
| Mermaid editor | Diagram-as-code editing | README features list | verified (documented) |
| Mockup editor | `.mockup.html` visual HTML mockups with annotations | README; `docs/EXTENSION_ARCHITECTURE.md` | verified |
| Data model editor | `.datamodel` visual Prisma schema editor (DataModelLM) | `docs/EXTENSION_ARCHITECTURE.md` | verified |
| `EditorHost` contract | Uniform lifecycle interface for all editors, built-in and third-party | `docs/EXTENSION_ARCHITECTURE.md` (interface quoted below) | verified (code in doc) |
| `useEditorLifecycle` hook | One hook handling load/save/echo-detection/watch/diff/theme | `docs/EXTENSION_ARCHITECTURE.md`; `packages/extension-sdk/README.md` | verified |
| Editor→chat selection chips | Editor reports current selection; chat renders removable chips fed into next prompt | `docs/EXTENSION_ARCHITECTURE.md` §Reporting the current selection | verified (API documented) |
| AI tool document-access modes | `filesystem` / `editor-read` / `editor-write` per tool, controls whether an editor mounts | `docs/EXTENSION_ARCHITECTURE.md` table | verified |
| Extension SDK package | `@nimbalyst/extension-sdk` — types, `createExtensionConfig()` Vite helper, bundle validation, Tailwind helpers | `packages/extension-sdk/README.md` | verified |
| Extension AI tools | Extensions register `ExtensionAITool[]` with name, description, scope, JSON input schema, handler | `packages/extension-sdk/README.md` | verified (code sample) |
| Host-provided editors as externals | Extensions import `MonacoEditor`/`MarkdownEditor` from runtime at zero bundle cost | `packages/extension-sdk/README.md` | verified |
| `createReadOnlyHost` | Synthesizes a host for embedded read-only preview panes | `packages/extension-sdk/README.md` | verified |
| Extension marketplace | Astro website editor, visual git log, mindmap, slides, 3D object editor | README + `extension-marketplace-dark.png`; `packages/marketplace` | verified |
| Tracker reference components | `TrackerReferencePicker` / `TrackerReferenceChip` let extensions link data to tracker items | `packages/extension-sdk/README.md` | verified |
| Session kanban | Sessions organised on a kanban board | README + `sessions-kanban-dark.webp` | verified |
| Session↔file bidirectional links | Link sessions to files and files to sessions; group files touched by a session | README | verified (documented) |
| Task tracker | Agent can create/edit/move/execute tasks; humans see and edit the same items | README; `docs/TRACKER_WORKFLOWS.md` (`tracker_create`, `tracker_update`, `tracker_list`, `tracker_link_session`) | verified |
| Git worktrees | Create isolated worktree per session (Cmd+Alt+W), multiple sessions per worktree, merge, rebase, squash modal, pre-flight conflict detection, archiving, pinning, renaming | `docs/FEATURE_INVENTORY.md` §Git Worktrees | verified (doc) |
| "Resolve with Agent" | Hands a broken git state to the agent to fix | `docs/FEATURE_INVENTORY.md` | verified (doc) |
| GitRefWatcher | Watches `.git/refs/heads/<branch>` and `.git/index`; zero polling | `docs/GIT_INTEGRATION.md` | verified (doc) |
| Commit auto-approves diffs | Detecting a commit marks pending review tags for those files as reviewed | `docs/GIT_INTEGRATION.md` §Auto-Approve | verified (doc) |
| AI commit messages | Generated commit messages; interactive commit proposal widget; auto-commit toggle | README; `docs/FEATURE_INVENTORY.md` | verified |
| PR review mode | GitHub PR list/conversation/files-changed/commits/checks; approve+merge in-app via `gh` CLI, no stored tokens | `docs/FEATURE_INVENTORY.md` §Pull Request Review Mode | verified (doc) |
| Embedded terminal | Ghostty | README | verified (documented) |
| Super Loops | Autonomous iterative agent loop, dedicated worktree per loop, learnings carried in `progress.json`, pause/resume/stop | `docs/FEATURE_INVENTORY.md` §Super Loops | verified (doc) |
| Blitz | Parallel AI sessions across multiple worktrees; model-named "model blitzes" | `docs/FEATURE_INVENTORY.md` §Blitz | verified (doc) |
| Meta-agent tools | `create_session`, `spawn_session`, `send_prompt`, `notify_user`, `respond_to_prompt`, `get_session_status`, `get_session_result`, `list_spawned_sessions`, `list_worktrees` | `docs/FEATURE_INVENTORY.md`; `docs/THE_HARNESS.md` | verified (doc) |
| Teammate sub-agents | Sidebar with status/elapsed/tool count, click-to-scroll to spawn point, inter-agent messaging, plan approval flow | `docs/FEATURE_INVENTORY.md` §Multi-Agent | verified (doc) |
| E2E collaboration ("Share to Team") | Encrypted yJS rooms; extensions opt in via manifest flag + `CollabCodec` + `useCollaborativeEditor` | `docs/EXTENSION_ARCHITECTURE.md` §collaboration | verified (doc) |
| Mobile app | Session dashboard, voice/text replies, swipe-through visual diff review, task queueing, push notifications | README §Mobile App | verified (documented) |
| Telemetry with opt-out | PostHog anonymous analytics; opt out in Settings → Advanced → Analytics | README; `docs/ANALYTICS_GUIDE.md` | verified |
| Post-opt-out retention ping | A `nimbalyst_session_start` event still fires per app start via a force-opted-in client | `docs/ANALYTICS_GUIDE.md:191` | verified (doc) — see Gaps |
| Auto-update + release channels | Stable / alpha channels, switchable in settings | README §Auto-Updates | verified |
| Agent support | Codex, Claude Code, Opencode (alpha), Copilot (alpha) | README | verified |

## Nimbalyst — UX and interaction design

This is the section that matters for us. Four mechanisms are worth understanding precisely.

### 1. The red/green diff approval model

The design is counterintuitive and better than what we would have invented. Full flow, verified from
`docs/FILE_WATCHER_DIFF_SYSTEM.md`:

1. The agent requests an Edit/Write tool.
2. A **PreToolUse hook** reads the current file content and stores a "tag" in local history:
   `{content, sessionId, status: 'pending'}`.
3. The tool executes. **No interception, no blocking** — the agent writes straight to disk.
4. The **file watcher** sees the change and checks for a pending tag.
5. If a tag exists, the editor enters **diff mode**: it loads the *tagged* (old) content, applies a
   diff old→new, and shows Accept/Reject.
6. Accept keeps disk content and marks the tag `reviewed`. Reject **restores the tagged content to
   disk** and marks the tag `reviewed`.

The stated key principle (verified quote, 8 words): "The AI always sees the accepted state." Because
files are written to disk immediately, the agent's context matches reality and it never stalls
waiting on a human. Approval is a *post-hoc, human-paced* review layer, not a gate in the agent's
loop. Reject is implemented as a restore-from-snapshot, i.e. an undo, not a veto.

Their own comparison table (verified) explains why they rejected the obvious alternative of an MCP
`applyDiff` tool: the watcher approach works with any file modification including bash commands and
manual edits, the agent uses natural Edit/Write tools, multi-file edits are naturally supported, and
there is no extra MCP server layer. The failure mode they name for MCP is that the agent might use
Edit instead of applyDiff and slip past review entirely.

Two implementation details are load-bearing and easy to get wrong:

- **Ordering.** The watcher must check for pending AI tags *before* the time-based
  "skip if <2000 ms since our own save" autosave heuristic. Otherwise consecutive agent edits inside
  the autosave window get swallowed. (verified, §Critical Implementation Details)
- **Lock release.** Diff updates are wrapped in `setTimeout(..., 0)` to release the file-watcher lock
  immediately so subsequent changes are not blocked. A `processingFileChangeRef` lock prevents
  concurrent processing of duplicate watcher events. (verified)

Conflict/edge-case handling (verified §Edge Cases): consecutive edits update the existing diff rather
than stacking (the DB's partial unique index enforces one pending tag per file, latest edit wins);
tab switching preserves diff mode via a persisted ref; and tags survive session end, so a user can
accept or reject on reopen days later. Separately, committing a file from *any* source (Nimbalyst
UI, CLI, VS Code) auto-marks its pending tags as reviewed — committing is treated as implicit
approval (verified, `docs/GIT_INTEGRATION.md` §Auto-Approve).

Crucially, "red/green WYSIWYG" means the diff is rendered **in the format's own editor**, not as
unified text. The `EditorHost` contract has `onDiffRequested`/`onDiffCleared` callbacks, and
`useEditorLifecycle` returns a `diffState` with `accept`/`reject` callbacks, so each editor renders
change presentation natively — the CSV editor does cell-level diff with "phantom rows" for
insertions (verified phrase from the doc's override example). A markdown diff shows struck-through
red prose and green inserted prose inside rendered text; a spreadsheet diff colors cells.

### 2. The editor contract

Verified, quoted from `docs/EXTENSION_ARCHITECTURE.md`:

```typescript
interface EditorHost {
  loadContent(): Promise<string>;      // Load file content on mount
  saveContent(content: string): void;  // Save when user saves
  setDirty(dirty: boolean): void;      // Track unsaved changes
  onFileChanged(callback): void;       // Handle external file changes
  onSaveRequested(callback): void;     // Subscribe to save events
  onThemeChanged(callback): void;      // Subscribe to theme changes
  onDiffRequested?(callback): void;    // AI edit diff mode
  onDiffCleared?(callback): void;      // Diff mode dismissed
}
```

Eight methods. That is the entire surface every editor — Lexical, Monaco, RevoGrid, Excalidraw,
DataModelLM, and every marketplace extension — implements. The stated architectural commitment
(verified): the extension system is the foundation for all future development, and every editor type
will ultimately be provided through extensions.

The most transferable design rule is about state ownership (verified): content state **never** lives
in the hook or in React state. The host interacts with the editor through pull/push callbacks —
`applyContent` pushes content *into* the editor (on load or external change), `getCurrentContent`
pulls it *out* (on save). This is why the same contract works for library-managed editors
(Excalidraw, Three.js — callbacks hit an imperative API via refs), store-managed editors (Mindmap,
DataModelLM — callbacks hit a Zustand store), and read-only ones (PDF, SQLite — `applyContent` only,
no `getCurrentContent`). `useEditorLifecycle` also handles **echo detection**: it ignores file-change
notifications caused by its own saves, which is the classic bug in any watch-plus-autosave system.

### 3. Editor selection as prompt context

An editor can push the user's current selection to the chat via
`host.setEditorContextItems([{id, label, description, icon, data, includeData}])`. The chat renders
each as a **removable chip above the input**, and includes the non-dismissed items' descriptions in
the next prompt. Passing `null`/`[]` clears it; a new push resets dismissals; selection clears
automatically when the tab closes. Structured `data` is opt-in via `includeData` and is stripped if
cyclic, non-JSON, or over 32 KiB — so descriptions must stand alone. (all verified)

This is the cleanest "how do I tell the agent what I'm looking at" API I have seen: it works for
text selections, diagram nodes, spreadsheet cells and CAD objects through one interface, and the
chips make the implicit context *visible and revocable* before the prompt is sent.

### 4. Sessions, worktrees, kanban

Sessions are the primary object: created in parallel, optionally isolated in a git worktree
(Cmd+Alt+W), searchable, resumable, arranged on a kanban board, and linked bidirectionally to the
files they touched. Worktree lifecycle is fully modelled — merge into base, rebase onto base, squash
commit modal, pre-flight conflict detection, archiving with background cleanup, pinning, renaming,
and an onboarding modal. Multiple sessions can share one worktree. "Resolve with Agent" hands a bad
git state back to an agent.

Two higher-order patterns sit on top: **Super Loops** (an autonomous iterative loop with a dedicated
worktree, learnings carried forward in `progress.json`, and a progress panel showing phase, iteration
count, learnings and blockers with pause/resume/stop) and **Blitz** (the same prompt run in parallel
across several worktrees, including "model blitzes" titled by model name — i.e. compare Sonnet vs
Opus on the same task).

Notably, their own agent instructions say the default is **not** to create worktrees unprompted, only
when the user explicitly asks (verified, `docs/THE_HARNESS.md:299`). And their own retrospective
admits worktrees are "powerful but underused because creating one is a UI action" (verified quote,
9 words, `THE_HARNESS.md:475`), proposing a `/worktree-this` command instead. That is a useful
warning for us: worktree UI is expensive to build and users do not reach for it.

### 5. Mobile review loop

The iOS/Android companion is designed around one job: unblock agents. Session dashboard shows which
agents need you versus which are still working; you reply by text or voice and the agent resumes
immediately; visual diffs are reviewed by **swiping through changes and tapping to approve**; you can
queue the next tasks so agents do not sit idle; push notifications fire when an agent needs you.
(verified from README). The swipe-to-approve gesture is the diff-approval model reduced to its
minimum viable interaction, which is good evidence the model itself is sound.

## Nimbalyst — Architecture

TypeScript/Electron monorepo on npm workspaces (npm 7+). Verified package list from the GitHub API:

`android`, `browser-extension`, `cli`, `collab-adapters`, `collab-protocol`, `electron`,
`extension-sdk`, `extension-sdk-docs`, `extensions`, `ios`, `marketplace`, `opencode-plugin`,
`runtime`, `shared`.

README describes the major ones (verified): `packages/ios` native SwiftUI app; `packages/electron`
desktop app; `packages/runtime` cross-platform runtime services (AI, sync, Lexical editor);
`packages/collab-protocol` wire-format types shared with the sync server; `packages/extension-sdk`
extension development kit; `packages/extensions` built-in extensions.

Process split (verified from docs): the **main** process owns `GitRefWatcher`, `GitStatusService`,
`HistoryManager` (diff tags) and the SQLite-ish `document_history` table via a DB worker; the
**renderer** owns `TabEditor` (file watcher + diff mode), editors, and the extension host. IPC events
like `git:status-changed`, `git:commit-detected` and `history:pending-count-changed` propagate state.
State management uses Jotai (`docs/JOTAI.md` exists). Built with Electron, Lexical (Meta), React,
Monaco and Excalidraw (verified, README acknowledgments).

Git integration is **strictly event-driven with no polling** — a 30-second poll was removed on
2026-01-23 and the doc contains an explicit instruction not to reintroduce `setInterval` for git
status (verified). `GitStatusService` keeps a 5-second cache as a de-duplication safety net,
invalidated immediately by the watcher; the doc is emphatic that the cache is not a polling
mechanism. Because it watches git's own internal files, it detects operations from any tool, not just
its own UI.

Documentation depth is exceptional: 60+ files under `docs/`, including `ARCHITECTURE_DIAGRAMS.md`,
`DATABASE_SCHEMA.md`, `IPC_GUIDE.md`, `ERROR_HANDLING.md`, `STATE_PERSISTENCE.md`, `THE_HARNESS.md`,
`E2E_TESTING.md` and `PLAYWRIGHT.md`. E2E tests exist for the diff system specifically
(`packages/electron/e2e/ai/consecutive-edits-diff-update.spec.ts`, verified reference).

## Nimbalyst — Gaps and weaknesses

- **Telemetry is on by default, and opt-out is not total.** After opting out, a single
  `nimbalyst_session_start` event still fires on every app start via a `sessionTracker` PostHog
  instance that is **force-opted-in**, to count unique installations (verified,
  `ANALYTICS_GUIDE.md:191`). They document it and call it a "transparent retention ping", and it
  excludes PII, file contents, paths, keys and document content — but for our zero-telemetry thesis
  this is a hard incompatibility. If we copy any analytics code, we must strip this. Their own
  consent module at least **fails closed** (consent denied until the setting resolves from main),
  which is the right default and worth copying.
- **479 open issues** against 1,339 stars. High velocity, high churn; near-daily releases with alpha
  and stable channels suggests real instability. (verified metadata, interpretation mine)
- **Electron.** ~58 MB repo, the whole Chromium/Node cost, and the exact thing FlyCrys was built to
  avoid. Not a criticism of their choice — it is what buys them Windows, macOS, Linux and a
  consistent editor stack — but it is the opposite trade-off.
- **Sync server is closed.** The Cloudflare Worker behind `wss://sync.nimbalyst.com` is a separate,
  non-public project. Share-to-Team depends on infrastructure we cannot self-host from this repo.
  (verified, `LICENSING.md` + README)
- **Licensing of the team tier is ambiguous** in-repo. The AGPL/paid claim appears only in the HN
  post description (secondhand) and is absent from `LICENSING.md`. Anyone relying on it should ask.
- **Surface area is enormous.** Seven editors, worktrees, PR review, Super Loops, Blitz, meta-agents,
  teammates, marketplace, mobile, collaboration. Their own harness doc concedes worktrees are
  underused. Feature breadth is a liability we should not imitate wholesale.
- **The diff model requires a hook.** It depends on Claude Code's PreToolUse hook to snapshot
  pre-edit content. Without a hook (or an equivalent), you lose the "original" side of the diff and
  can only diff against last-known-content — weaker but, as noted below, still workable for us.

---

## Overlap with Loush Dashboard

Our sections are in `src/sections/` (34 files) with shared viewers in `src/ui/viewers.jsx` and the
Express API in `server/*.mjs`. Current dependencies: React 18, Vite, Express, d3, `marked`,
`@uiw/react-codemirror` (+ lang-html/javascript/json/markdown), `yaml`.

| Their feature | Our equivalent section (or NONE) | Who does it better | Note |
| --- | --- | --- | --- |
| Red/green WYSIWYG diff approval (Nimbalyst) | **NONE** | Nimbalyst, decisively | Our `Viewer` in `src/ui/viewers.jsx` renders but never diffs. This is the single biggest gap and the top adoption. |
| Three-state Source/Preview/Diff viewer toggle (FlyCrys) | `src/ui/viewers.jsx` `Viewer` — has Source/Preview equivalents, no Diff | FlyCrys | Cheap to add; makes diff a view mode rather than a new screen. |
| Markdown rendering | `ArtifactsSection` + `viewers.jsx` (`marked`) | Tie for read-only; Nimbalyst for editing | We render markdown; they *edit* it WYSIWYG via Lexical. |
| Markdown WYSIWYG editing | **NONE** | Nimbalyst | We have CodeMirror (source editing), not rich-text. |
| CSV rendering | `viewers.jsx` `parseCSV` + `DataTable` | We render, they edit | We already parse and table CSVs — a cell-level diff overlay is a short hop from `DataTable`. |
| Code viewing | `viewers.jsx` `CodeView` (CodeMirror, readOnly) | Nimbalyst (Monaco, editable) | Ours is read-only by explicit choice. |
| JSON viewing | `viewers.jsx` `JsonView` | Tie | — |
| Live JSX preview | `viewers.jsx` `JsxLive` | **Us** | Neither FlyCrys nor Nimbalyst has a live component preview in what I read. |
| Mermaid editing | **NONE** | Nimbalyst | We have no mermaid dependency at all. |
| Excalidraw editing | **NONE** | Nimbalyst | Heavy; low priority for us. |
| Data model / Prisma editor | **NONE** | Nimbalyst | Out of scope. |
| Editor→chat selection chips | **NONE** (we have `ChatSection`) | Nimbalyst | High value, low cost, and it fits our Artifacts↔Chat seam exactly. |
| Session kanban | `BoardSection` + `SessionsSection` | Probably tie — needs a side-by-side | We have both a board and a sessions view; the missing piece is that our board is not driven by *sessions as cards*. |
| Task tracker the agent can edit | `BoardSection`, `PlanGraph` | Nimbalyst | Theirs exposes `tracker_create`/`tracker_update`/`tracker_list`/`tracker_link_session` as agent tools. |
| Session↔file bidirectional links | `WorkingSet`, `ContextExplorerSection` | Close; likely them | We join transcripts to repos on disk, which is the same raw material. |
| Git worktree management UI | **NONE** | Nimbalyst — but see note | Their own docs say worktrees are underused because creating one is a UI action. Low ROI for us. |
| Git status in file tree | `ProjectHub` / `ProjectsSection` (partial) | Both of them | FlyCrys colors ancestor folders too — a nice touch. |
| Event-driven git watching (no polling) | Unknown in `server/*.mjs` | Nimbalyst | Watching `.git/refs/heads/<branch>` and `.git/index` is a trick we can copy verbatim in Express. |
| AI commit messages / commit widget | **NONE** | Nimbalyst | — |
| PR review mode | **NONE** | Nimbalyst | Large; out of scope. |
| Embedded terminal | **NONE** | Both | A web app cannot do this natively — see honesty note in adoptions. |
| Tool-restricted agent profiles | `CustomizeSection`, `HarnessSection`, `GovernanceSection` | FlyCrys (simpler, shipped) | 4-field JSON struct → `--allowedTools`. Trivially portable. |
| Slash command / skill discovery from `~/.claude` | `LibrarySection`, `HooksSection`, `McpSection` | Likely **us** | We already read `~/.claude`; FlyCrys reads commands, skills, project `.claude/`, and plugins. |
| Skills/commands CRUD UI | `LibrarySection` / `PromptStudio` (partial) | Needs comparison | FlyCrys has a full CRUD dialog. |
| Extension SDK | **NONE** | Nimbalyst | The `EditorHost` contract is portable; the packaging/marketplace is not worth it for us. |
| Background task tracking with ⏳/✓/✗ | `RunsSection`, `ActivityTimeline` | Needs comparison | FlyCrys auto-creates a tab per `run_in_background` and streams the task file. |
| Token/cost in status bar | `UsagePanel`, `InsightsSection` | Probably **us** | We have a dedicated usage panel; they have a status-bar line. |
| Multi-agent / teammates | `FlowSection`, `HarnessSection` | Nimbalyst | Theirs includes inter-agent messaging and a plan-approval flow. |
| Mobile companion | **NONE** | Nimbalyst | But we are a *web app* — we get responsive mobile nearly free, which is our structural advantage. |
| Telemetry | **NONE — zero by design** | **Us** | Their opt-out still emits a retention ping. Our zero-telemetry stance is a genuine differentiator. |
| Local-first, no proxy | Our thesis | Tie — all three are local-first | FlyCrys drives the user's own CLI; Nimbalyst is local except Share-to-Team. |

## Recommended adoptions

Ranked by value-per-unit-effort. Effort is S (≤1 day), M (2–5 days), L (>1 week).

### 1. File-watcher diff approval — the core mechanism. Effort: M
**Take:** Nimbalyst's PreToolUse-tag → write-through → watch → diff → accept/reject architecture,
including the two non-obvious details (check pending tags *before* the autosave time heuristic;
release the watcher lock via `setTimeout(…, 0)`) and the one-pending-tag-per-file uniqueness rule.
**Lands in:** new `server/history.mjs` (tag store + watcher, mirroring their `HistoryManager`);
`src/ui/viewers.jsx` (diff rendering); `src/sections/ArtifactsSection.jsx` (accept/reject UI).
**Unlocks:** the single most valuable idea in either project. It makes agent edits reviewable without
blocking the agent, works for edits from *any* source including bash and manual edits, and needs no
MCP server. Adopt their principle verbatim: the agent always sees the accepted state, so reject is
an undo (restore snapshot to disk), not a veto.
**Honest caveat:** the full design needs a Claude Code PreToolUse hook to capture pre-edit content.
We can ship a degraded-but-useful v1 without hooks by snapshotting on file-open and on each accepted
review, diffing disk-vs-last-known. Add the hook later for exactness. Since we already read
`~/.claude`, wiring a hook is a natural follow-up, not a blocker.

### 2. Source / Preview / Diff as a three-state view toggle. Effort: S
**Take:** FlyCrys's segmented toggle in the viewer.
**Lands in:** `src/ui/viewers.jsx` (`Viewer`), surfaced in `ArtifactsSection`.
**Unlocks:** the UI shell for #1 at near-zero cost, and it improves the Artifacts section immediately
even before diffing works. Critically it establishes that diff is a *mode of the file you are already
reading*, not a separate destination.

### 3. Editor→chat selection chips. Effort: S
**Take:** `setEditorContextItems([{id, label, description, icon, data, includeData}])` → removable
chips above the chat input → descriptions injected into the next prompt. Copy the guardrails too:
opt-in structured data, 32 KiB cap, strip cyclic/non-JSON, descriptions must stand alone, clear on
tab close.
**Lands in:** `src/ui/viewers.jsx` (emit selection), `src/sections/ChatSection.jsx` (chips + prompt
assembly), possibly a small shared atom in `src/lib/`.
**Unlocks:** the Artifacts↔Chat seam we do not currently have. Makes implicit context explicit and
revocable before sending. Works uniformly for text, table cells and (later) diagram nodes.

### 4. Tool-restricted agent profiles. Effort: S
**Take:** FlyCrys's four-field profile — `{name, system_prompt, allowed_tools[], model}` — one JSON
file per profile, each allowed tool passed as a separate `--allowedTools` argument, plus `--model`
and `--effort`.
**Lands in:** `src/sections/CustomizeSection.jsx` or `HarnessSection.jsx` for the editor;
`server/setup.mjs` or a new `server/profiles.mjs` for storage and spawn-arg assembly; surfaced in
`GovernanceSection`.
**Unlocks:** the "Security / Research / Default" persona pattern for a few hours of work. Be honest
in our UI about what it is: a **launch-time allowlist**, not interactive gating — which is exactly
what FlyCrys's own code comments concede.

### 5. Event-driven git watching with zero polling. Effort: S–M
**Take:** watch `.git/refs/heads/<branch>` and `.git/index`; on change invalidate a short (5 s) cache
and emit `git:status-changed`; on commit, diff the commit and emit `git:commit-detected`. Adopt their
rule against `setInterval` for git status.
**Lands in:** new `server/git.mjs` with an SSE or WebSocket channel; consumed by `ProjectHub`,
`ProjectsSection`, `WorkingSet`.
**Unlocks:** instant, accurate git state that reflects operations from *any* tool — CLI, VS Code, or
our own UI — with lower CPU than polling. Pairs with #1 via their best small idea: **a commit
auto-approves pending diffs for the committed files.**

### 6. Cell-level CSV diff. Effort: M
**Take:** RevoGrid-style cell diff with "phantom rows" for insertions, rendered in the table itself.
**Lands in:** `src/ui/viewers.jsx` — we already have `parseCSV` and `DataTable`, so the data path
exists.
**Unlocks:** proves the "diff in the format's native view" thesis in a second format, which is what
separates real WYSIWYG diff from a text diff with extra steps. Do this only after #1 ships.

### 7. Mermaid rendering, then mermaid diffing. Effort: M
**Take:** mermaid as a first-class artifact type.
**Lands in:** `src/ui/viewers.jsx` (add a `mermaid` branch beside the `md` branch), new dependency.
**Unlocks:** agents emit mermaid constantly and we currently render it as a fenced code block. Note
we already have d3 and a `PlanGraph`, so we have graph-rendering competence in-house — evaluate
rendering mermaid ourselves versus adding the dependency.

### 8. An `EditorHost`-shaped internal contract. Effort: M
**Take:** the eight-method contract and — more importantly — the state-ownership rule: content never
lives in React state; the host pushes via `applyContent` and pulls via `getCurrentContent`. Include
echo detection (ignore watcher events caused by our own saves).
**Lands in:** `src/ui/viewers.jsx` refactor plus a new `src/lib/editorHost.js`.
**Unlocks:** every subsequent viewer (mermaid, CSV diff, Excalidraw) gets diff mode, watching and
theming for free. **Do not build a packaged extension SDK, marketplace, or externals system** — that
is L-plus effort with no payoff at our scale. Take the interface, skip the distribution.

### 9. Sessions-as-kanban-cards. Effort: M
**Take:** sessions as the card type on the board, with bidirectional session↔file links and
search/resume.
**Lands in:** `src/sections/BoardSection.jsx` + `SessionsSection.jsx`, joined via `WorkingSet`.
**Unlocks:** we already have the raw material — `~/.claude` transcripts joined to repos on disk. This
is mostly a re-presentation of data we hold, not new plumbing.

### 10. Agent-editable task tracker. Effort: M
**Take:** expose `tracker_create` / `tracker_update` / `tracker_list` / `tracker_link_session`
equivalents as tools so the agent maintains the board humans read.
**Lands in:** `server/` (new tool endpoints) + `BoardSection` / `PlanGraph`.
**Unlocks:** the board stops being a manual artifact. Their `tracker_link_session` cross-reference is
the detail that makes it useful — every item points at the session that worked it.

### Explicitly NOT recommended

- **Worktree management UI.** L effort, and Nimbalyst's own harness doc admits worktrees are
  underused precisely because creating one is a UI action. If we want the capability, expose a
  `/worktree-this`-style command, not a panel.
- **Extension marketplace / packaged SDK.** L+. No third-party ecosystem to serve.
- **Excalidraw and visual data-model editors.** L. Far from our thesis.
- **Any telemetry code.** Their opt-out still emits a retention ping. Zero telemetry is a
  differentiator we should keep and say out loud. The one thing worth copying is their
  consent-**fails-closed** pattern, if we ever add anything optional.
- **PR review mode, Super Loops, Blitz.** Each is a product unto itself.

### What a web app structurally cannot copy — be honest

- **Embedded terminal (VTE4/Ghostty).** We cannot embed a real PTY the way a native app does. A
  browser terminal means xterm.js over a WebSocket to an Express-spawned PTY — doable, but it is a
  security surface (arbitrary shell exec exposed on a local HTTP port) and a meaningfully different
  bargain. Do not treat FlyCrys's terminal as a checklist item to match.
- **Sub-second cold start and a single binary.** Irreducibly native. Our equivalent virtue is *no
  install at all*.
- **System integration.** GTK theme following, GNOME integration, desktop notifications, system MIME
  icons, native file-manager and default-app handoff, global keyboard shortcuts, OS-level file
  drag-and-drop from outside the browser. We get degraded versions at best (Web Notifications API
  needs permission; no cross-app drag).
- **Direct inotify.** The browser cannot watch the filesystem. Everything watch-related must live in
  `server/*.mjs` and be pushed to the client over SSE/WebSocket. This affects adoptions #1 and #5 —
  budget for the transport, which neither upstream project needed to build.

**What we do that they cannot:** zero install, zero telemetry, instant remote access over the LAN,
responsive mobile for free (Nimbalyst had to build and ship two native apps to get what our
media queries give us), and a d3 visual vocabulary (`PlanGraph`, `charts.jsx`) that neither has. Our
`JsxLive` component preview appears to have no counterpart in either project.

---

## Sources

**Fetched and read in full:**
- https://github.com/SergKam/FlyCrys — repo landing page (via search result summary)
- https://raw.githubusercontent.com/SergKam/FlyCrys/main/README.md — full README
- https://raw.githubusercontent.com/SergKam/FlyCrys/main/src/models/agent_config.rs — full file
- https://raw.githubusercontent.com/SergKam/FlyCrys/main/src/services/cli/claude.rs — grepped for CLI flags, permissions, session handling
- https://raw.githubusercontent.com/nimbalyst/nimbalyst/main/README.md — full README
- https://raw.githubusercontent.com/nimbalyst/nimbalyst/main/LICENSING.md — full file
- https://raw.githubusercontent.com/nimbalyst/nimbalyst/main/docs/FILE_WATCHER_DIFF_SYSTEM.md — full, primary source for diff approval
- https://raw.githubusercontent.com/nimbalyst/nimbalyst/main/docs/GIT_INTEGRATION.md — full
- https://raw.githubusercontent.com/nimbalyst/nimbalyst/main/docs/TRACKER_WORKFLOWS.md — full
- https://raw.githubusercontent.com/nimbalyst/nimbalyst/main/packages/extension-sdk/README.md — full
- https://raw.githubusercontent.com/nimbalyst/nimbalyst/main/docs/EXTENSION_ARCHITECTURE.md — first 150 lines read in full; remainder grepped
- https://raw.githubusercontent.com/nimbalyst/nimbalyst/main/docs/FEATURE_INVENTORY.md — §§ Multi-Agent, Git Worktrees, Super Loops, Blitz, Git Integration, PR Review, File Management
- https://raw.githubusercontent.com/nimbalyst/nimbalyst/main/docs/ANALYTICS_GUIDE.md — grepped for opt-out/consent/PII
- https://raw.githubusercontent.com/nimbalyst/nimbalyst/main/docs/THE_HARNESS.md — grepped for worktree
- https://news.ycombinator.com/item?id=47962230 — Show HN: Nimbalyst, submitter `ghinkle`, 8 points

**Downloaded but only partially consulted:** `docs/FILE_WATCHING_AND_CHANGE_TRACKING.md`,
`docs/AGENT_PERMISSIONS.md`, `docs/EDITOR_STATE.md`, `docs/SESSION_HIERARCHY.md`,
`docs/PLANNING_SYSTEM.md`, `docs/FILE_TYPE_HANDLING.md` (all from the same raw.githubusercontent.com
`nimbalyst/nimbalyst/main/docs/` path).

**GitHub API (authenticated via `gh`):**
- `repos/SergKam/FlyCrys`, `repos/SergKam/FlyCrys/releases`, `repos/SergKam/FlyCrys/git/trees/main?recursive=1`
- `repos/nimbalyst/nimbalyst`, `repos/nimbalyst/nimbalyst/releases`, `repos/nimbalyst/nimbalyst/contents/{docs,packages,packages/extension-sdk,packages/extension-sdk/src}`

**Referenced but not fetched:**
- https://nimbalyst.com/ , https://docs.nimbalyst.com/ , https://nimbalyst.com/about/ , https://nimbalyst.com/crystal/
- https://github.com/stravu/crystal (title confirms "Crystal is now Nimbalyst")
- https://news.ycombinator.com/item?id=48108137 (second Show HN)
- https://github.com/hesreallyhim/awesome-claude-code/issues/1761 (Nimbalyst listing)
- Screenshots referenced in READMEs but not visually inspected: FlyCrys `docs/screenshot-workspace.png`, `docs/screenshot-features.png`, `docs/screenshot-skills.png`; Nimbalyst `.github/assets/nimbalyst-hero-files-dev-dark.png`, `sessions-kanban-dark.webp`, `developers-dark.webp`, `extension-marketplace-dark.png`. Their captions were read from the README and are cited as documented, not as visually verified.

**Searches that returned nothing useful:**
- "FlyCrys Reddit r/ClaudeAI OR r/linux native GUI Claude Code Sergii Kamenskyi" — no Reddit thread, no HN post, no personal blog or announcement for FlyCrys surfaced. The only corroborating third-party listing is `awesome-claude-code`. **FlyCrys appears to have no launch announcement I could locate.** Its author's real name is not verified from a primary source I fetched.
- No FlyCrys project website exists (GitHub API `homepage` is null).
- No Nimbalyst Reddit thread was located; the HN post I fetched has only 8 points and minimal author commentary — it did not address origins, architecture, diff approval, or telemetry.

**Secondhand claims, explicitly labelled:**
- Founder list (Wirth/Hinkle/Bentley), the Evergage/Salesforce background, Stravu as the company, and the February 2026 Crystal deprecation date — all from search-result summaries, not from a primary page I fetched.
- The claim that team collaboration features are AGPL and paid — from the HN post description only; contradicted by silence in `LICENSING.md`.
- FlyCrys's "only native Linux GUI for Claude Code" and its sub-second startup / minimal resource claims — the author's own assertions; not benchmarked or independently audited.
