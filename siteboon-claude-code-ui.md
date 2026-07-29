# CloudCLI (aka Claude Code UI) — siteboon/claudecodeui

> Upstream research for porting ideas/code into Loush Dashboard (`LinuxDevil/AI-Dashboard`).
> Everything below was read from a shallow clone of `main` at commit `75ff8a5` (2026-07-28) plus
> targeted `gh api` reads of historical tags and deleted files. README claims are marked as such and
> flagged where the code disagrees.
> Research date: 2026-07-29.

**Attribution required by their licence:** CloudCLI UI (https://github.com/siteboon/claudecodeui)

---

## Identity

| Field | Value |
|---|---|
| Repo URL | https://github.com/siteboon/claudecodeui |
| Homepage / product | https://cloudcli.ai · docs at https://cloudcli.ai/docs · legacy marketing page https://claudecodeui.siteboon.ai |
| npm package | `@cloudcli-ai/cloudcli` (bin: `cloudcli`). Formerly `claude-code-ui`, then `@siteboon/claude-code-ui` — the latter now publishes a stub (`redirect-package/package.json`, v2.0.0, `"This package has moved to @cloudcli-ai/cloudcli"`) |
| npm downloads | **~1,775 in the month to 2026-07-24** — a striking gap against 12.9k stars. Desktop installers and `git clone` undercount, but it suggests stars ≫ installs |
| Security advisories | **3 critical CVEs**, all published March 2026 — see [Security posture](#security-posture). No `SECURITY.md` in the repo (verified) |
| Author / owner | Siteboon AI B.V. (GitHub org `siteboon`). Dominant committer `viper151` (480 commits), then `blackmammoth` (126) |
| Licence (current) | **AGPL-3.0-or-later** — `package.json` `"license": "AGPL-3.0-or-later"`, `LICENSE` is the AGPLv3 text **plus Section 7 additional terms** (see below) |
| Licence (history) | GPL-3.0 from the first commit (`5ea0e362`, 2025-06-25) → AGPL-3.0-or-later at `27cd1243` (2026-03-29, "chore: relicense to AGPL-3.0-or-later"); `NOTICE` names `004135ef` (2026-03-27) as the contribution boundary. **Meanwhile `package.json` said `"MIT"` at v1.1.0, v1.5.0 and v1.12.0, and the npm package declared MIT from its first publish (1.8.2, 2025-09-22) until 1.16.4 (2026-02-11, GPL-3.0), then AGPL from 1.27.0 (2026-03-29)** — roughly five months where npm said MIT and the repo said GPL. Deliberate dual-licensing or metadata error is **unverified**. No public controversy found |
| Stars / Forks | **12,941 stars / 1,763 forks** (GitHub API, 2026-07-29) |
| Open issues | 150 |
| Created | 2025-06-25T12:51:12Z |
| Last commit | 2026-07-28T20:47:43Z (`75ff8a5`, "fix: check CLAUDE_CODE_OAUTH_TOKEN in checkCredentials()") |
| Latest release | `v1.36.3`, 2026-07-15 |
| Repo size | 12.4 MB, ~760 commits |
| Languages | TypeScript 2,630 KB · JavaScript 670 KB · CSS 40 KB · HTML 39 KB |
| Default branch | `main` |

### Section 7 additional terms (important — read before copying anything)

The `LICENSE` file appends two AGPL §7 terms:

1. **Attribution requirement (§7b)** — every copy, modified version and derivative work must
   preserve, "reasonably prominent" and not hidden, the notice
   `"CloudCLI UI (https://github.com/siteboon/claudecodeui)"`.
2. **Prohibition of misrepresentation (§7c)** — modified versions must be "clearly and prominently
   marked as such" and must not be presented as the original.

`NOTICE` further states that contributions by *other* authors prior to `004135ef` **remain
GPL-3.0** and are incorporated under GPL §13. In plain terms: Siteboon relicensed only its own
contributions. Third-party GPL-3.0 code is still in the tree and Siteboon cannot relicense it.

> **Legal caveat on "we have permission from the author."** Loush Dashboard is MIT
> (`package.json` line: `"license": "MIT"`). AGPL-3.0 is copyleft that triggers on *network use* —
> exactly what a self-hosted dashboard is. Verbal permission from Siteboon covers Siteboon's
> copyright only; it does **not** cover the pre-`004135ef` third-party GPL-3.0 contributions that
> `NOTICE` explicitly carves out. Before pasting any non-trivial block, get the permission in
> writing, name the specific files, and confirm it extends to relicensing under MIT. Copying *ideas*,
> protocol shapes and architecture is not restricted; copying *code* is. Recommendations below are
> ranked with this in mind — the highest-value items are design patterns, not source.

### Activity assessment

**Very much alive and commercially backed.** 36 minor releases in ~13 months, conventional commits,
`release-it` + commitlint + husky + lint-staged, ESLint 9 with `eslint-plugin-boundaries` enforcing
module architecture, i18n across 9 languages, per-module `README.md` and Mermaid diagrams, unit
tests colocated in `tests/` folders. This is a funded product, not a weekend project.

### Install methods

```bash
npx @cloudcli-ai/cloudcli                       # Node.js v22+, serves http://localhost:3001
npm install -g @cloudcli-ai/cloudcli && cloudcli
npx @cloudcli-ai/cloudcli@latest sandbox ~/proj # experimental Docker microVM sandbox, needs `sbx`
```

Plus an Electron desktop companion (macOS `.dmg` / Windows NSIS, `electron/` dir, `cloudcli://`
protocol handler) and the paid CloudCLI Cloud (README: "Starts at €7/month").

### Platforms

Linux, macOS, Windows. Windows is genuinely handled, not an afterthought:
`server/shared/claude-cli-path.ts` eagerly resolves the executable because the Agent SDK uses raw
`child_process.spawn` which does not follow npm shell wrappers; `buildShellCommand()` emits
PowerShell `if ($LASTEXITCODE -ne 0)` instead of `||`; `cross-spawn` is a dependency;
`postinstall` runs `scripts/fix-node-pty.js`.

---

## The problem it solves

Claude Code is a terminal program. That imposes three concrete limits:

1. **You must be at the machine.** The session lives in a TTY. Close the terminal, lose the session.
2. **No phone.** There is no way to check on, steer, or approve a long-running agent from a couch or
   a train.
3. **The terminal is a bad renderer.** Diffs, file trees, image attachments, git staging and tool
   call trees all render poorly as ANSI text.

CloudCLI puts a web UI in front of the same `claude` process. The critical design decision — and the
one that makes it more than a toy — is that it **does not maintain its own parallel universe**. It
reads and writes the real `~/.claude/projects/*.jsonl` transcripts, the real `~/.claude.json` MCP
config, and the real settings via the Agent SDK's `settingSources: ['project','user','local']`. A
session started in the terminal appears in the web UI and vice versa.

Secondary problem it solves: **multi-agent parity.** The same UI drives Claude Code, Cursor CLI,
Codex and OpenCode behind one normalised message protocol.

---

## Value proposition

### Real value (verified in code)

| Claim | Verification |
|---|---|
| Same sessions as native Claude Code | `sessions-watcher.service.ts` chokidar-watches `~/.claude/projects`, `~/.cursor/projects`, `~/.codex/sessions`, `~/.local/share/opencode` and emits `session_upserted` deltas |
| Same MCP servers | `claude-sdk.js` `loadMcpConfig()` reads `~/.claude.json`, merges global + `claudeProjects[cwd]` servers |
| Same settings | `sdkOptions.settingSources = ['project','user','local']` |
| Resume mid-stream after a page refresh | `chat.subscribe` + per-run `seq` numbering + a 5,000-event replay buffer (`chat-run-registry.service.ts`) |
| Real interrupt | `abortClaudeSDKSession()` calls `queryInstance.interrupt()` on the SDK query |
| Real permission prompts in the browser | `sdkOptions.canUseTool` blocks on a promise resolved by a `chat.permission-response` WS frame |
| Works on a phone | `visualViewport` keyboard handling, `env(safe-area-inset-*)`, bottom tab bar, `manifest.json` + `sw.js`, web push via VAPID |
| Uses your own subscription | The Agent SDK spawns your logged-in `claude` CLI. No key required |

### Marketing (discount it)

- **"Extends Claude Code rather than sitting alongside it"** — true for sessions/MCP/settings, but
  the tool allow-list is CloudCLI's own, stored in its SQLite DB, *not* `~/.claude/settings.json`.
- **"All Claude Code tools are disabled by default"** (README, bold, with a lock emoji). This is a
  UI-layer default in CloudCLI's settings, enforced in `mapCliOptionsToSDK()`/`canUseTool`. It is
  not an OS sandbox, and the **integrated shell bypasses it entirely** — `/shell` spawns a real PTY
  running whatever you type, with no allow-list at all.
- **"Free open source"** with the pricing table and the ☁️ "Try Now" badge above the feature list.
  The OSS repo is real and complete, but the README is also a funnel. The Cloud tier is where team
  sharing, the REST API surface and the n8n node live.
- **Plugin ecosystem "9 plugins"** — all nine are third-party repos of small size; the starter is a
  git submodule that is empty in a plain clone.
- **"12.9k stars"** as a trust signal. Star count is what the Show HN title led with. Against
  ~1,775 npm downloads/month and three critical CVEs in one week of March 2026, stars measure
  reach, not hardening.

---

## Feature inventory

| Feature | What it does | Where in the code (file/dir) | Depends on |
|---|---|---|---|
| Chat with a Claude Code session | Streams a live agent run into a web transcript | `server/claude-sdk.js` (`queryClaudeSDK`), `src/components/chat/view/ChatInterface.tsx` | `@anthropic-ai/claude-agent-sdk` ^0.3.165 |
| Chat WS gateway | 4 inbound message types, `kind`-tagged outbound frames | `server/modules/websocket/services/chat-websocket.service.ts` | `ws` |
| Run registry / replay | Per-run monotonic `seq`, 5,000-event ring buffer, 5-min post-completion retention | `server/modules/websocket/services/chat-run-registry.service.ts` | — |
| App-id ↔ provider-id remap | Frontend only ever sees CloudCLI session ids; provider-native ids stay server-side | `server/modules/websocket/services/chat-session-writer.service.ts` | better-sqlite3 |
| Interrupt | `queryInstance.interrupt()`, plus a synthetic terminal `complete` | `server/claude-sdk.js` `abortClaudeSDKSession()` | Agent SDK |
| Permission prompts | `canUseTool` awaits a promise; 55 s timeout for normal tools, infinite for `AskUserQuestion`/`ExitPlanMode` | `server/claude-sdk.js` (`waitForToolApproval`), `src/components/chat/view/subcomponents/PermissionRequestsBanner.tsx` | — |
| "Remember this rule" | Approval can append e.g. `Bash(npm test:*)` to the live allow-list | `server/claude-sdk.js` `matchesToolPermission()` | — |
| Plan mode | Force-adds `Read/Task/exit_plan_mode/TodoRead/TodoWrite/WebFetch/WebSearch` to allowed tools | `server/claude-sdk.js` `mapCliOptionsToSDK()` | — |
| Effort control | Per-model reasoning-effort selector (v1.36.0) | `src/components/chat/constants/providerEffort.ts`, `claude-sdk.js` `resolveClaudeEffort()` | Agent SDK `effort` |
| Model switching | Model list served at runtime from `GET /api/providers/:provider/models` | `server/modules/providers/services/provider-models.service.ts` (358 lines) | — |
| Context-usage statusline | `status`/`token_budget` frames → pill in the composer, click for a breakdown modal | `claude-sdk.js` `extractTokenBudget()` → `useChatRealtimeHandlers.ts:312` → `TokenUsageSummary.tsx` | `CONTEXT_WINDOW` env (default 160000) |
| Integrated shell | Real PTY, xterm.js with webgl/fit/web-links/clipboard addons | `server/modules/websocket/services/shell-websocket.service.ts`, `src/components/shell/` | `node-pty` ^1.2.0-beta.12 |
| PTY reconnect | Sessions keyed `<projectPath>_<sessionId>[_cmd_<hash>]`, survive socket drop, 30-min kill timeout, 5,000-chunk output replay | same | — |
| Shell auth-URL detection | Strips ANSI, extracts URLs from PTY output, emits `auth_url` once per URL, optional auto-open | same + `server/utils/url-detection.js` | — |
| OSC 52 clipboard bridge | CLI clipboard writes inside the PTY reach the browser clipboard, with a non-HTTPS fallback | `src/components/shell/hooks/useShellTerminal.ts` | `@xterm/addon-clipboard` |
| Mobile terminal selection | Touch-based text selection overlay for xterm | `src/components/shell/utils/mobileTerminalSelection.ts` | — |
| File explorer | Tree, context menu, rename/delete/create, upload w/ progress, image viewer | `src/components/file-tree/view/` (11 files), `server/index.js:603-1071` | — |
| Code editor | CodeMirror 6, 6 languages, minimap, one-dark, markdown preview, media preview | `src/components/code-editor/view/` | `@uiw/react-codemirror`, `@replit/codemirror-minimap` |
| Git panel | status / diff / stage / unstage / commit / branches / checkout / history / commit graph / fetch / pull / push / publish / discard / revert | `server/routes/git.js` (1,634 lines, 22 routes), `src/components/git-panel/view/` | `git` binary |
| AI commit message | Generates a commit message from the staged diff | `server/routes/git.js:988` `/generate-commit-message` | provider CLI |
| Browser use | Playwright browser the agent drives, exposed to it as an MCP server over localhost HTTP with a bearer token | `server/modules/browser-use/`, `server/browser-use-mcp.ts` | Playwright |
| Skills management | List/enable provider skills | `server/modules/providers/list/claude/claude-skills.provider.ts` | — |
| MCP management UI | Add/remove MCP servers per provider | `server/modules/providers/list/*/​*-mcp.provider.ts`, `src/components/mcp/` | — |
| Slash commands | Reads `.claude/commands`, autocompletes, executes | `server/routes/commands.js` (596 lines), `src/components/chat/hooks/useSlashCommands.ts` | — |
| File mentions (`@`) | ripgrep-backed file autocomplete in the composer | `src/components/chat/hooks/useFileMentions.tsx` | `@vscode/ripgrep` |
| Image paste / drop | Clipboard + dropzone → `POST /api/assets/images` → `~/.cloudcli/assets` → base64 blocks | `useChatComposerState.ts:550` `handlePaste`, `server/modules/assets/`, `server/shared/image-attachments.ts` | `multer`, `react-dropzone` |
| Command palette | ⌘K / Ctrl+K | `src/components/command-palette/CommandPalette.tsx` | `cmdk` |
| Session search | Full-text search across all session transcripts | `server/modules/providers/services/session-conversations-search.service.ts` (1,226 lines) | `fuse.js` |
| Web push notifications | VAPID push when a run needs attention or finishes | `server/services/vapid-keys.js`, `server/modules/notifications/`, `public/sw.js` | `web-push` |
| Desktop notifications WS | `/desktop-notifications` socket for the Electron app | `server/modules/notifications/index.ts` | — |
| Voice input / TTS | Mic → transcription proxy; speak replies | `server/voice-proxy.js`, `src/components/chat/hooks/useVoiceInput.ts`, `useTts.ts` | external STT/TTS |
| Plugin system | Git-installed plugins with own frontend tab + Node backend on a local port, proxied via `/plugin-ws/:name` | `server/routes/plugins.js`, `server/utils/plugin-loader.js`, `plugin-process-manager.js`, `plugin-websocket-proxy.service.ts` | — |
| TaskMaster AI | Optional PRD parsing / task planning integration | `server/routes/taskmaster.js` (1,470 lines), `src/components/task-master/` | TaskMaster CLI |
| External agent API | `POST /api/agent` guarded by its own API key, for n8n/webhooks | `server/routes/agent.js` (1,257 lines) | — |
| Auth | Single-user bcrypt(12) + JWT 7d, auto-refresh at half-life via `X-Refreshed-Token` | `server/routes/auth.js`, `server/middleware/auth.js` | `bcrypt`, `jsonwebtoken` |
| i18n | 9 locales | `src/i18n/locales/` | `i18next` |
| PWA | `manifest.json` (standalone, portrait-primary), service worker | `public/manifest.json`, `public/sw.js` | — |
| Electron desktop | Tray/menu-bar companion, tabs, local server installer/launcher | `electron/` (main.js, tabs.js, viewHost.js, localServer.js, serverInstaller.js, cloud.js) | `electron-builder` |
| **Computer use (REMOVED)** | Full-desktop screenshot + mouse/keyboard control + OS accessibility-tree "semantics" adapters | deleted at `6761f31` (2026-06-29); recoverable at parent `35da5d09` | `screenshot-desktop`, `@nut-tree-fork/nut-js` |

---

## UX and interaction design

### Desktop layout

Three zones, dead simple: **persistent left sidebar** (projects → sessions, starred projects, search)
→ **main content** with a tab switcher (Chat / Shell / Files / Git / Browser / plugins) → the tab
body. `AppContent.tsx` renders it as `fixed inset-0 flex` — the page itself never scrolls; only
panes do. Settings is a modal with its own sidebar. ⌘K opens a `cmdk` palette.

The good part: **the sidebar and the streaming pane are independent.** You can switch to another
session while a run continues; the run keeps streaming server-side and the sidebar shows a live
activity indicator per session (`useSessionProtection.ts` tracks a `Map<sessionId, {statusText,
canInterrupt, startedAt}>`, reconciled every 5 s against `GET` running-sessions). This is the single
biggest UX difference from a terminal.

### Mobile / PWA layout

Not a shrunk desktop — a genuinely separate branch:

- `useDeviceSettings({trackPWA})` picks the branch. Desktop gets an inline sidebar; mobile gets a
  full-screen overlay drawer at `w-[85vw] max-w-sm` with a backdrop button that closes on both
  `onClick` and `onTouchStart` (with `preventDefault`, to beat the 300 ms tap delay).
- **Bottom tab bar** (`MobileNav.jsx` in the JSX era) with 40×40 touch targets, and it
  `translate-y-full`s itself away when the input is focused — the keyboard gets the whole screen.
- **iOS keyboard handling is the standout.** Android/Chrome shrinks the layout viewport so
  `inset-0` just works; iOS Safari does not — the keyboard overlays a still-full-height viewport.
  `AppContent.tsx:190-203` uses the Visual Viewport API to compute
  `kb = window.innerHeight - visualViewport.height`, writes it to `--keyboard-height`, and the root
  container sets `style={{ bottom: 'var(--keyboard-height, 0px)' }}`. The code comment explicitly
  warns *not* to listen to `scroll`, because iOS changes `offsetTop` during normal scrolling and the
  container would bounce. That is a bug someone shipped, hit, and then documented.
- `env(safe-area-inset-*)` is threaded through `src/index.css` as CSS variables plus a
  `--mobile-nav-total` composite.
- The terminal gets a bespoke touch-selection manager (`mobileTerminalSelection.ts`) because xterm's
  mouse-driven selection is unusable on touch.
- Web push means you can background the PWA and get pinged when the agent needs a permission.

### Session switching and resume

The session identity model is the cleanest thing in the codebase. The frontend **only ever knows the
app session id** (allocated by `POST /api/providers/sessions`). The provider-native id — the JSONL
filename, the `--resume` argument — never leaves the server. `ChatSessionWriter` remaps every
outbound frame back to the app id and swallows `session_created` into a DB mapping update. Result: a
session has a stable URL (`/session/:id`) from before the first message, so optimistic navigation,
deep links and browser history all work, and swapping providers underneath is invisible.

### Streaming feel

- `WebSocketContext` deliberately exposes a **`subscribe(listener)` callback registry, not React
  state**, with a documented reason: React batches state updates, so a `latestMessage` state slot is
  lossy under a fast token stream. `latestMessage` survives only for low-rate consumers.
- 30 s app-level `ws.ping()` heartbeat, added because Cloudflare (~100 s), ALB (60 s) and nginx
  (60 s) silently kill idle sockets.
- Reconnect after 3 s, then a synthetic client-side `websocket_reconnected` frame so components can
  re-`chat.subscribe` and replay from `lastSeq`.
- Every run terminates with **exactly one** `complete` frame, built by one function
  (`createCompleteMessage`), with the registry de-duplicating and the handler emitting a synthetic
  one if a runtime crashes. Sessions cannot get stuck "thinking" forever.
- Completion plays a sound and flashes the page title (`notificationSound.ts`,
  `pageTitleNotification.ts`).

### Permission prompt handling

A banner in the chat pane, with per-tool custom renderers registered in
`permissionPanelRegistry.ts` (e.g. a dedicated `AskUserQuestionPanel`). Three outcomes: allow, deny,
or **allow + remember**, where remember writes a rule like `Bash(git status:*)` into the live
allow-list for the rest of the run. Pending approvals survive a page refresh because
`chat_subscribed` carries `pendingPermissions`. Normal tools time out after 55 s and auto-deny;
interactive tools (`AskUserQuestion`, `ExitPlanMode`) wait forever, which is correct.

There is an honest caveat in a code comment at `claude-sdk.js:522`: in `auto` and `bypassPermissions`
modes the SDK resolves approval before `canUseTool` runs, so **interactive tools never reach the UI
in those modes** — the model acts on a self-generated answer. They know, and wrote down the fix
(move to a `PreToolUse` hook).

### Empty states and shortcuts

Dedicated components (`ProviderSelectionEmptyState`, `FileTreeEmptyState`,
`GitRepositoryErrorState`, `MainContentStateView`) rather than bare nulls. Shortcuts: ⌘K palette,
⌘/Ctrl+Enter to send (configurable to plain Enter), ⌘S in editor and PRD editor, ⌘/Ctrl+Enter to
commit, Esc to stop.

---

## Architecture

### How it spawns/attaches to Claude Code

**Two completely separate paths**, and conflating them is the main thing to understand:

1. **Chat path — Agent SDK, no PTY.** `server/claude-sdk.js` calls `query({prompt, options})` from
   `@anthropic-ai/claude-agent-sdk`. The SDK spawns the `claude` executable itself; CloudCLI passes
   `pathToClaudeCodeExecutable` (resolved eagerly for Windows) and `env: {...process.env}` (needed
   since SDK 0.2.113 replaced rather than overlaid env). Resume is `sdkOptions.resume = sessionId`.
   The returned `queryInstance` is an async iterable *and* carries `.interrupt()`.
2. **Shell path — real PTY.** `node-pty` spawns a shell and types a constructed command into it,
   e.g. `claude --resume "<id>" || claude` (POSIX) or the PowerShell `$LASTEXITCODE` variant. This
   is a plain terminal; CloudCLI's tool allow-list has no bearing on it.

### WebSocket protocol

One `WebSocketServer` bound to the HTTP server, routed by pathname in
`websocket-server.service.ts`:

| Path | Handler |
|---|---|
| `/ws` | chat |
| `/shell` | PTY |
| `/desktop-notifications` | Electron |
| `/plugin-ws/:name` | proxy to `ws://127.0.0.1:<pluginPort>/ws` |
| anything else | `ws.close()` |

**Auth on upgrade** via `verifyClient` → `websocket-auth.service.ts`: token from `?token=` or the
`Authorization` header, verified, user attached to `request.user`. Failure rejects the handshake.

**Inbound (client → server), `/ws`** — exactly four types, none provider-specific:

```jsonc
{ "type": "chat.send",                "sessionId": "...", "content": "...", "options": { "images": [...], "model": "...", "permissionMode": "...", "effort": "...", "toolsSettings": {...} } }
{ "type": "chat.abort",               "sessionId": "..." }
{ "type": "chat.subscribe",           "sessions": [ { "sessionId": "...", "lastSeq": 42 } ] }
{ "type": "chat.permission-response", "requestId": "...", "allow": true, "updatedInput": {...}, "message": "...", "rememberEntry": "Bash(npm test:*)" }
```

**Outbound (server → client)** — every frame carries `kind`, never `type`. Provider kinds
(`server/shared/types.ts` `MessageKind`):

`text` · `tool_use` · `tool_result` · `thinking` · `stream_delta` · `stream_end` · `error` ·
`complete` · `status` · `permission_request` · `permission_cancelled` · `session_created` ·
`interactive_prompt` · `task_notification`

Gateway kinds added by the WS layer: `chat_subscribed` · `session_upserted` · `loading_progress` ·
`protocol_error`. The client injects a synthetic `websocket_reconnected`.

Envelope (`NormalizedMessage`): `{ id, sessionId, timestamp, provider, kind, seq?, role?, content?,
toolName?, toolInput?, toolId?, toolResult?{content,isError}, text?, tokens?, canInterrupt?,
requestId?, input?, images?, displayText?, commandName?, isLocalCommand?, isCompactSummary? ... }`

Terminal frame, exactly once per run:
`{ kind:"complete", sessionId, actualSessionId, exitCode, success, aborted }`

Errors: `{ kind:"protocol_error", code, error, sessionId, timestamp }` with codes
`SESSION_ID_REQUIRED`, `SESSION_NOT_FOUND`, `UNSUPPORTED_PROVIDER`, `RUN_IN_PROGRESS`,
`NO_ACTIVE_RUN`, `UNKNOWN_MESSAGE_TYPE`, `INTERNAL_ERROR`.

**`/shell` protocol:** inbound `{type:'init', projectPath, sessionId, provider, hasSession,
initialCommand, isPlainShell, forceRestart}`, then `{type:'input', data}` and
`{type:'resize', cols, rows}`. Outbound is `output` chunks plus an `auth_url` event.

Close codes: `4400` invalid plugin name, `4404` plugin not running, `4502` upstream plugin error.

### File access sandboxing

- `/api/projects/:projectId/file`, `.../files/content`, `PUT .../file`: resolve the project root
  from the **DB by id** (never from the client), then
  `if (!resolved.startsWith(path.resolve(projectRoot) + path.sep)) return 403`. Accepts absolute or
  relative `filePath`, both normalised first. **No `realpath()`** — a symlink inside the project
  pointing outside it escapes the check.
- `/api/browse-filesystem` and `/api/create-folder`: gated by `validateWorkspacePath()` against
  `WORKSPACES_ROOT`, with `~` expansion. This one *does* `realpath` the root for comparison.
- Image attachments: `filterImagesToUploadStore()` in `chat-websocket.service.ts` re-validates
  server-side that every image is a **direct child** of `~/.cloudcli/assets` — no subdirectories, no
  traversal, no absolute paths elsewhere — because the provider runtime base64-encodes whatever path
  it is handed. This is the best-written trust boundary in the repo.
- `git.js` uses `spawn('git', [args], {cwd})` with argv arrays throughout — **no shell, no injection**.

### Frontend state

Deliberately un-fancy: React Context for cross-cutting concerns (`AuthContext`, `WebSocketContext`,
`ThemeContext`, `PermissionContext`, `PluginsContext`, `TasksSettingsContext`, `PaletteOpsContext`),
one Zustand-shaped store (`src/stores/useSessionStore.ts`) for the message list, and large custom
hooks per feature (`useChatComposerState` 1,222 lines, `useChatSessionState` 862,
`useChatRealtimeHandlers` 348). No Redux, no react-query. `react-router-dom` v6 for `/session/:id`.

### Data flow

```
 Browser (React 18 + Vite + Tailwind)
   |                                    |                          |
   | HTTP  /api/*  (JWT Bearer)         | WS /ws  (?token=)        | WS /shell
   v                                    v                          v
 +--------------------------------------------------------------------------+
 | Express 4  server/index.js                                               |
 |  validateApiKey -> authenticateToken (JWT, single user, better-sqlite3)  |
 |                                                                          |
 |  createWebSocketServer  (verifyClient authenticates the UPGRADE)         |
 |    /ws    -> chat-websocket.service.ts                                   |
 |               chat.send ---> chatRunRegistry.startRun()                  |
 |                                 |  seq++, 5k ring buffer                 |
 |                                 v                                        |
 |                            ChatSessionWriter  (app id <-> provider id)   |
 |                                 |                                        |
 |                                 v                                        |
 |                            spawnFns[provider]                            |
 |                                 |                                        |
 |    /shell -> shell-websocket.service.ts --> node-pty  ---------------+   |
 |    /plugin-ws/:n -> proxy to 127.0.0.1:<port>                        |   |
 +----------------------------------|-----------------------------------|--+
                                    |                                   |
                                    v                                   v
                    @anthropic-ai/claude-agent-sdk            PTY: `claude --resume <id>`
                                    |                                   |
                                    v                                   |
                          spawns `claude` executable  <-----------------+
                                    |
                                    v
                       ~/.claude/projects/<slug>/*.jsonl
                       ~/.claude.json  (MCP servers)
                                    ^
                                    |  chokidar watch
                       sessions-watcher.service.ts
                                    |
                                    v  broadcast to connectedClients
                            kind: session_upserted
```

---

## Security posture

It exposes a **real shell and a real filesystem over HTTP**. Precisely what it does and does not do:

### Track record: three critical CVEs, all in March 2026

Verified directly against `gh api repos/siteboon/claudecodeui/security-advisories` (2026-07-29):

| CVE | GHSA | Severity | Summary | Published | Patched in |
|---|---|---|---|---|---|
| **CVE-2026-31975** | `GHSA-gv8f-wpm2-m5wr` | **Critical, CVSS 9.8** | **Unauthenticated RCE via WebSocket shell injection** | 2026-03-10 | 1.25.0 |
| CVE-2026-31862 | `GHSA-f2fc-vc88-6w7q` | Critical, CVSS 9.1 | Command injection via git endpoint | 2026-03-09 | 1.24.0 |
| CVE-2026-31861 | `GHSA-7fv4-fmmc-86g2` | Critical (no score recorded) | Shell command injection in git user routes | 2026-03-09 | 1.24.0 |

**CVE-2026-31975 was three chained bugs:** a hardcoded fallback JWT secret
`'claude-ui-dev-secret-change-in-production'` in `server/middleware/auth.js` (CWE-1188) that was
*not* listed in `.env.example`, so most deployments ran with it active; an
`authenticateWebSocket()` that verified the JWT signature but never checked the user existed
(CWE-287); and OS command injection in the WebSocket shell handler (CWE-78). Chained: forge a token
with the public constant → pass WS auth → execute arbitrary commands. Reported 2026-03-02;
discovered by ProjectDiscovery's "Neo" agent, one of 22 zero-days across 13 projects
(https://projectdiscovery.io/blog/everyone-is-finding-vulns-the-hard-part-is-proving-them).

**Both root causes are fixed in the current tree** — `auth.js:6` now reads
`process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret()` (per-install generated), and
`authenticateWebSocket()` does `userDb.getUserById(decoded.userId)` before returning. Git routes now
use `spawn` with argv arrays throughout. Credit where due: the maintainer published the advisories
himself, promptly.

**Other historical incidents:**

- **Issue #269** (2025-12-25, closed) — the published npm tarball shipped
  `server/database/auth.db` containing a **pre-registered `admin` user with an undocumented
  password**, because `.npmignore` was missing. Anyone who `npx`'d it inherited a backdoor account.
- **Issue #1053** (open, 2026-07-21) — a self-hoster reporting an **actual live intrusion**:
  unauthorized external access, API keys they never created, and attempts to exfiltrate Claude
  credentials. Core complaint: nothing binds access to a device the owner approved.
- **Issue #1054** (open, same reporter) — the SSH password-regenerate button reports the feature is
  unsupported, and `server/routes/auth.js` exposes no password-change endpoint, so **a compromised
  credential cannot be rotated**. Also open as #369 ("No way to reset password").
- **Issue #361** (open since 2026-01-31) — no built-in HTTPS/TLS, HTTP only.
- **No `SECURITY.md`** in the repo (verified — `.github/` contains only `ISSUE_TEMPLATE` and
  `workflows`).

None of this appears on the README, the marketing site, or in the Show HN post. **Read the CVE
history as the strongest single argument for the "localhost or Tailscale only" rule below.**

### What it protects

| Control | Where | Notes |
|---|---|---|
| Single-user password auth | `server/routes/auth.js` | bcrypt, 12 salt rounds. `/register` refuses once a user exists, inside a SQLite transaction to close the race |
| JWT on every `/api/*` route | `server/middleware/auth.js` | 7-day expiry, user re-checked in DB on every request, auto-refresh at half-life via `X-Refreshed-Token` |
| JWT on the WS **upgrade** | `websocket-auth.service.ts` | Rejects the handshake, not just the first message |
| Per-installation JWT secret | `appConfigDb.getOrCreateJwtSecret()` | Auto-generated if `JWT_SECRET` is unset — no shipped default secret |
| Optional second factor for API | `validateApiKey` on `/api` | Only active if `API_KEY` env is set |
| Separate key for the external agent API | `validateExternalApiKey` on `POST /api/agent` | Not the user JWT |
| Path containment on file routes | `server/index.js:453/495/553` | `startsWith(projectRoot + sep)`, project root from DB |
| Image-attachment allow-list | `filterImagesToUploadStore()` | Direct children of the assets dir only |
| No shell in git | `server/routes/git.js` | `spawn` with argv arrays |
| Tool allow/deny + permission prompts | `claude-sdk.js` | Default-deny in the chat path |
| Session-id validation for PTY resume | `shell-websocket.service.ts` | `/^[a-zA-Z0-9_.\-:]+$/` |
| Plugin name validation | `plugin-websocket-proxy.service.ts` | Regex, then `close(4400)` |
| XSS hardening in rendered markdown | `dompurify` dependency | — |

### What it does NOT protect

1. **No TLS.** Plain HTTP. `HOST` defaults to `0.0.0.0` in `.env.example` — binds every interface out
   of the box. The JWT crosses the wire in the clear, and in the WS URL as a **query parameter**
   (`?token=…`), so it lands in proxy and access logs.
2. **The shell is unrestricted.** `/shell` spawns a PTY and pipes your keystrokes to it. The
   "all tools disabled by default" story applies only to the SDK chat path. Anyone who reaches the
   shell tab has your user's full shell. This is the single largest exposure.
3. **`bypassPermissions` is one click away.** `skipPermissions` in tool settings maps directly to
   `sdkOptions.permissionMode = 'bypassPermissions'`.
4. **No rate limiting, no lockout, no CAPTCHA** on `/api/auth/login`. Password minimum is **6
   characters**. Offline-brute-forceable over the LAN.
5. **CORS is wide open.** `app.use(cors({exposedHeaders:['X-Refreshed-Token']}))` — no `origin`
   restriction. Mitigated in practice because auth is a `Authorization` header rather than a cookie,
   so classic CSRF does not apply — but any origin can read responses if it obtains a token.
6. **No `realpath()` on the project-file endpoints.** A symlink committed into a repo, pointing at
   `~/.ssh` or `/etc`, defeats the `startsWith` containment check for read *and write*.
7. **No CSP header** observed; `rehype-raw` is enabled in the markdown pipeline (raw HTML passes
   through) with `dompurify` as the only barrier.
8. **50 MB JSON body limit** on every route — trivially memory-abusable by an authenticated client.
9. **Their own docs contradict the code.** `https://cloudcli.ai/docs/remote-server` states
   *"CloudCLI UI does not include built-in authentication"* and tells you to put a reverse proxy with
   auth in front. The code plainly *has* single-user JWT auth. Either the docs are stale or they do
   not consider the built-in auth sufficient for public exposure. Either way, **treat the built-in
   auth as LAN-grade only** — which is also the conservative reading.
10. **Secrets in SQLite.** API keys, credentials and GitHub tokens live in
    `server/modules/database/repositories/{api-keys,credentials,github-tokens}.ts`. Storage-at-rest
    encryption is **unverified** — I did not read the repository implementations.
11. **No password change or rotation.** Confirmed by reading `server/routes/auth.js`: the router
    exposes `/status`, `/register`, `/login`, `/user`, `/logout` and nothing else. If your password
    leaks, your only remedy is to delete the SQLite DB.
12. **`.env.example` still omits `JWT_SECRET`** — the same documentation gap that made
    CVE-2026-31975 exploitable at scale. The fallback is now safe, but the variable is still
    undiscoverable from the example file.

**Net:** designed for `localhost` or a trusted LAN, behind Tailscale or an authenticating reverse
proxy. Exposing port 3001 to the internet is remote code execution as your user, by design — and
once, unintentionally, without even needing a login.

---

## The screen-reading variant

The brief asked about "the screen-reading variant that captures every monitor." There are **two
distinct things**, and they are unrelated.

### (a) CloudCLI's own Computer Use — built, then deleted

CloudCLI shipped a full computer-use module and **removed it on 2026-06-29** in commit `6761f31`
("chore: remove computer use"), between v1.35.0 and v1.35.1. The `optionalDependencies` in the
current `package.json` are the leftovers:

```json
"optionalDependencies": {
  "@nut-tree-fork/nut-js": "^4.2.6",
  "screenshot-desktop": "^1.15.4"
}
```

56 files were deleted. Recoverable at parent commit `35da5d090d584255e0c9d79f29313389ec36f174`:

| Deleted path | What it did |
|---|---|
| `server/modules/computer-use/computer-executor.ts` (242 lines) | `captureScreenshot()` via `screenshot-desktop` → PNG → data URL; `readImageSize()` parses PNG IHDR / JPEG SOF headers **without decoding**; `toMouseSpace()`/`toImageSpace()` map between screenshot pixel space and nut-js logical mouse space |
| `server/modules/computer-use/computer-use.service.ts` (920 lines) | Session/state management for the desktop agent |
| `server/computer-use-mcp.ts` (574 lines) | Exposed the desktop to the agent **as an MCP server** |
| `server/modules/computer-use/semantics/adapters/windows/Program.cs` | A **C# helper process** reading the Windows accessibility tree |
| `server/modules/computer-use/semantics/helpers/macos/CloudCLISemantics.swift` | The macOS Swift equivalent |
| `server/modules/computer-use/desktop-agent-relay.service.ts` (158) + `websocket/services/desktop-agent-websocket.service.ts` | Relayed desktop control to a remote browser session |
| `electron/computerAgent.js` (290) | The Electron-side desktop agent |
| `src/components/computer-use/view/ComputerUsePanel.tsx` | The UI |

Notable: it captured **one image, the default display** (`screenshot({format:'png'})` with no
display argument) — it did *not* enumerate monitors. The genuinely clever part was the "semantics"
layer: rather than only sending pixels, native helpers exposed the OS accessibility tree so the
agent could address real UI elements. That is a materially better design than pixel-only
computer-use, and it is now dead code in a commit.

**Why it matters to us:** the accessibility-semantics idea is portable and unencumbered as an idea.
The code is AGPL and deleted, i.e. unmaintained. Not recommended for adoption.

### (b) `shengyanlin/claude-overlay` — the actual every-monitor tool

**No relationship to siteboon whatsoever** (different author, MIT vs AGPL, Python vs TypeScript,
created 2026-05-31). GitHub code search over `siteboon/claudecodeui` returns **0 hits** for
`desktopCapturer` and `alwaysOnTop`; its 21 `screenshot` hits are all Playwright browser-page
screenshots.

| Field | Value |
|---|---|
| Repo | https://github.com/shengyanlin/claude-overlay |
| Licence | **MIT** |
| Stars / forks | 80 / 10 |
| Created / last commit | 2026-05-31 / 2026-07-23 (`400eb21`, v1.14.0) |
| Languages | Python 500 KB · PowerShell 13 KB · Batch 10 KB |
| Platform | **Windows 10/11 only** — hard Win32 `ctypes` dependency; README asks for cross-platform help |
| Install | `git clone` + `setup.cmd`. Not on PyPI. Needs Python 3.10+ and a logged-in `claude` CLI |

**How it works:**

- **Capture:** Pillow `ImageGrab.grab()`. `win32utils.py:390 enumerate_monitors()` uses
  `EnumDisplayMonitors` + `GetMonitorInfoW`; `claude_overlay.py:3048 _grab_shots()` loops monitors
  and grabs **one image per monitor** with `bbox=m["rect"], all_screens=True`. Prompt is prefixed
  `[Attached: a live screenshot of my screen — monitor 1 (primary), monitor 2.]`.
- **On demand, not continuous.** Captured per message when Auto-shot is on, with a 180 ms debounced
  pre-capture while you type (frames reused up to 6 s old). Long edge capped at 1568 px; saves both
  PNG and JPEG and keeps the smaller. Files in `%TEMP%\claude_overlay_shots\`, last 24 kept.
- **Transport:** base64 `image` blocks inside a streaming user message. Caps: 16 images, 16 MB each,
  32 MB total.
- **No API key:** `worker.py` uses the Python `claude-agent-sdk`, which spawns the user's
  logged-in `claude` CLI. Grepping every `.py` found **zero** occurrences of `ANTHROPIC_API_KEY`,
  `CLAUDE_CODE_OAUTH_TOKEN` or `api.anthropic.com`. It monkey-patches `anyio.open_process` to add
  `CREATE_NO_WINDOW` so no console flashes.
- **Overlay tech:** plain **Tkinter**, not Electron/Tauri. `overrideredirect(True)` for frameless,
  `-topmost` plus a Win32 re-raise, `SetWindowRgn` for rounded corners, `WS_EX_APPWINDOW` for a
  taskbar button, `keyboard.add_hotkey("ctrl+alt+space")` for the global hotkey.
- **Nicest detail:** `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` so the overlay is
  invisible to Teams/Zoom/OBS **and to its own screenshots**, with a `withdraw()` + 150 ms fallback.

**Security posture — worse than CloudCLI's.** `PERMISSION_MODE = "bypassPermissions"` is the
**default** (`config.py:55`) and `worker._allow_tool()` ends in an unconditional
`return PermissionResultAllow()`, because a GUI with no TTY has nowhere to show a prompt.
`WORKING_DIR` defaults to the user's home. Combined with feeding it pixels from every monitor every
turn, that is a **live prompt-injection surface**: any text rendered in any window becomes model
input for a fully autonomous agent with home-directory write access. No redaction, no blurring, no
OCR filtering; screenshots sit unencrypted in `%TEMP%`. Mitigations are user-driven only: an
Auto-shot toggle, a window-only scope, and a Read-only mode (`"plan"` + deny-everything) that is
genuinely well built. The README does disclose this in a "⚠️ Security note".

> **Flagged, not acted on:** the `claude-overlay` README contains a ready-to-paste block beginning
> `claude "Set up Claude Overlay for me: clone https://github.com/shengyanlin/claude-overlay, make
> sure Python 3.10+ is installed (install it if missing)…"`. It is documentation aimed at a human,
> but it is literal agent-directed instruction text embedded in a fetched page. Treated as data.

**Recommendation: do not port.** Windows-only, Tkinter, and it is the mirror image of Loush's
thesis — Loush's value is grounded local *files*; screen pixels are the least grounded input
imaginable, and the injection surface is not worth it. If we ever want Claude to see a screen, the
right shape is a **screen-capture MCP server** the user opts into per-session
(`TheoEwzZer/WinSight-MCP`, `kmoulder/screen-capture-mcp` are MIT prior art), not an always-on
overlay.

---

## Notable code worth stealing

Ranked by value-to-difficulty. **Difficulty is "port into React 18 + Express ESM, no TypeScript."**
Everything here is AGPL — for the pattern-level items you are copying a design, which is fine; for
the paste-level items, see the licence caveat in Identity.

| # | File path (theirs) | What it does | Why it is good | Port difficulty |
|---|---|---|---|---|
| 1 | `server/modules/websocket/services/chat-run-registry.service.ts` (343) | Per-run monotonic `seq`, 5,000-event ring buffer, 5-min post-completion retention, `replayEvents(sessionId, lastSeq)` | Solves resume-mid-stream properly. Client sends `lastSeq`, gets exactly what it missed; if the buffer no longer covers it, it falls back to REST as the authority. No dedup heuristics, no lost tokens | **Easy** — plain data structures, no TS-specific anything. ~150 lines of JS |
| 2 | `server/modules/websocket/services/chat-websocket.service.ts` (409) | The whole 4-verb inbound protocol + `kind`-tagged outbound envelope | Four verbs, one outbound switch, provider-neutral. Protocol errors get their own `kind` so the UI never string-matches to tell "bad request" from "model errored" | **Easy** (as a design). The protocol is worth adopting verbatim |
| 3 | `src/contexts/WebSocketContext.tsx` (193) | Listener-registry `subscribe()` instead of a `latestMessage` state slot; 30 s ping; 3 s reconnect; synthetic `websocket_reconnected` | The comment explains *why* — React batches state updates, so a state slot silently drops frames under a fast stream. This is the bug you would otherwise ship and spend a day finding | **Easy** — strip types, done. ~120 lines |
| 4 | `server/claude-sdk.js` (833) — `canUseTool` + `waitForToolApproval` + `matchesToolPermission` | Browser-rendered permission prompts: promise-blocking `canUseTool`, 55 s timeout for normal tools / infinite for interactive, `AbortSignal` wiring, "remember this rule" appending `Bash(cmd:*)` to the live allow-list | This is the piece Loush is missing entirely (we pass `--dangerously-skip-permissions`). Already plain JS ESM | **Medium** — requires moving Loush from raw-CLI stream-json to the Agent SDK, or reimplementing on the CLI's permission-prompt stream |
| 5 | `server/claude-sdk.js` — `extractTokenBudget()` | Reads `message.usage`, sums `input + cache_creation + cache_read + output`, falls back to `modelUsage`, divides by `CONTEXT_WINDOW` | Correct context accounting including cache tokens, which is what people actually get wrong. Feeds a one-line composer pill | **Easy** — a pure function, ~50 lines, already JS |
| 6 | `src/components/app/AppContent.tsx:190-203` | iOS `visualViewport` → `--keyboard-height` CSS var, with the "do not listen to scroll" warning | ~14 lines that make a web UI usable on an iPhone. Nobody gets this right first try | **Easy** |
| 7 | `server/modules/websocket/services/shell-websocket.service.ts` (539) | PTY keyed `<projectPath>_<sessionId>[_cmd_<hash>]`; socket close does **not** kill the PTY; 30-min timeout; 5,000-chunk output replay on reconnect | Detach/reattach semantics — close the laptop, reopen, the terminal is still there. Plus ANSI-stripping URL detection that surfaces `claude auth login` device URLs as a clickable link | **Medium** — `node-pty` is a native module (`postinstall` fixups needed); the state machine itself is straightforward |
| 8 | `server/modules/websocket/services/chat-session-writer.service.ts` (145) | App session id ↔ provider session id remapping; swallows `session_created` into a DB write | Gives every session a stable URL from before the first message. Enables optimistic navigation, deep links, and swapping providers invisibly | **Medium** — needs a session table; Loush has no DB, but a JSON index file would do |
| 9 | `server/modules/providers/services/sessions-watcher.service.ts` (325) | chokidar on `~/.claude/projects` etc., 500 ms debounce / 2 s max-wait, emits per-session `session_upserted` deltas rather than full snapshots | Loush already reads these transcripts but has no live push. Delta-not-snapshot is the right call at scale | **Easy/Medium** — add `chokidar`, reuse existing parsers |
| 10 | `server/routes/git.js` (1,634, 22 routes) | Complete git UI backend; `spawn('git',[argv],{cwd})` everywhere; `--porcelain=v1 -z` parsing incl. merge-conflict detection | Injection-safe by construction, and the porcelain parser handles the cases people skip (conflicts, renames, ignored) | **Medium** — big but mechanical; already plain JS |
| 11 | `src/components/chat/tools/` — `ToolRenderer.tsx` + `configs/toolConfigs.ts` + `permissionPanelRegistry.ts` | Registry mapping tool name → renderer, with diff viewer, plan display, todo list, subagent grouping via `parentToolUseId` | The registry pattern beats a giant switch. Subagent nesting via `parent_tool_use_id` is exactly what Loush already does manually in `ChatSection.jsx` | **Medium** |
| 12 | `server/modules/websocket/services/chat-websocket.service.ts` — `filterImagesToUploadStore()` | Server-side re-validation that every attachment is a *direct child* of the upload dir | 20 lines, and the comment explains the trust boundary precisely. Loush accepts 300 MB raw uploads at `/api/chat/upload` — this is the missing check | **Easy** |
| 13 | `src/components/shell/hooks/useShellTerminal.ts` | OSC 52 clipboard provider with a non-HTTPS fallback | Makes `claude auth login`'s "press c to copy" work in a browser over plain HTTP. Obscure and hard-won | **Easy** (only if we adopt xterm) |
| 14 | `server/modules/websocket/README.md` | The module's own docs: service map table, Mermaid flowcharts, sequence diagrams, close-code list | Not code — a *practice*. This single file is why the WS layer is comprehensible in ten minutes | **Easy** (write our own) |

### Porting shortcut: use the pre-TypeScript tags

The current tree is TypeScript with `@/` path aliases, `eslint-plugin-boundaries`, and a
service/hook/view split. **`v1.12.0` and earlier are plain `.jsx`/`.js`** and structurally much
closer to Loush:

```
v1.12.0 src/components/  ChatInterface.jsx ClaudeStatus.jsx CodeEditor.jsx CommandMenu.jsx
                         DiffViewer.jsx FileTree.jsx GitPanel.jsx MobileNav.jsx Shell.jsx
                         Sidebar.jsx TokenUsagePie.jsx TodoList.jsx ...
v1.12.0 server/          claude-sdk.js cli.js cursor-cli.js database index.js middleware
                         projects.js routes utils
```

`Shell.jsx` is 648 lines, `FileTree.jsx` 479, `CommandMenu.jsx` 344, `MobileNav.jsx` 73 — all
directly readable as React 18 + Vite. **However**: those tags carry the GPL-3.0 `LICENSE` with the
`"MIT"` `package.json` contradiction, which makes their licence status *more* ambiguous, not less.
Use them as reference reading; take the AGPL current tree as the authoritative design.

---

## Reception, competition, and the commercial picture

### The Show HN was a non-event

The brief assumed there was a discussion to mine. There is not. Verified via the HN Firebase API
(`item/47352564.json`) and Algolia:

- "Show HN: CloudCLI-Web/Mobile UI for Claude Code,Codex and Gemini(8.2k stars)", submitted by
  `simosmik`, **2026-03-12**, **5 points, 1 comment**. The single comment (id `47355623`) is from
  `blackmammoth`, a project contributor, thanking upvoters.
- **Zero security criticism, zero auth discussion, zero alternative comparison** — because there is
  zero discussion. No earlier HN thread for this repo exists (Algolia by URL, by `claudecodeui`, by
  `siteboon`, by `CloudCLI` → exactly one story).
- Timing worth noting: the Show HN went up **two days after** the CVSS 9.8 unauthenticated-RCE patch
  shipped, advertising the star count, mentioning none of it.

**Reddit could not be checked.** `reddit.com` is blocked for both fetch and search from this
environment. Reporting as *could not verify*, not *no discussion exists*.

**Written coverage is promotional, not review.** The one substantial writeup found
(`blog.brightcoding.dev`, 2026-04-25) reads as SEO advertorial — superlatives, favourable comparison
tables, no CVE mention, essentially no downsides. No independent technical review or verifiable
YouTube review was found.

### The competitive threat that actually matters

**Anthropic Remote Control**, launched **2026-02-25**, bridges a local Claude Code session to
claude.ai/code and the mobile apps — first-party, and aimed squarely at CloudCLI's core use case.
The founder's public counter-argument is that Remote Control exposes one *active* session while
CloudCLI auto-discovers everything in `~/.claude`. That is a real distinction, and it is the same
distinction that protects Loush: **the value is in the corpus, not the live socket.**

Others in the space: Happy Coder (MIT, E2E-encrypted mobile), omnara (Apache-2.0, freemium),
claude-code-webui (sugyan, minimal), vibe-kanban (BloopAI), Conductor, Crystal/Nimbalyst (stravu,
git-worktree parallelism), opcode (formerly Claudia, 15k+ stars), Sculptor (Imbue, containerised
parallel agents), Paseo AI, AionUi, Agent Sessions, ServerCC.

### Commercial

cloudcli.ai pricing: **Hobby €7/mo** (1 env, 2 vCPU / 4 GB, SSH, 2-day trial) · **Growth €20/mo**
(5 envs) · **Team €39/mo** (5 envs, 5 seats, roles) · Enterprise custom. No permanent free cloud
tier. You bring your own agent subscription — they sell the environment. Cloud-only
differentiators are managed hosting, persistent environments, team seats/roles and dedicated infra;
the file explorer, git, shell, MCP management and plugin system are all in the OSS build. Operator:
**Siteboon AI B.V.** (Dutch B.V.).

---

## Gaps and weaknesses

0. **A CVSS 9.8 unauthenticated RCE, plus two more criticals, plus a shipped-backdoor npm tarball,
   plus a live user-reported intrusion, plus no way to rotate a leaked password, plus no
   `SECURITY.md`.** All documented in Security posture. The engineering is genuinely good; the
   security *operations* history is not, and none of it is disclosed on any user-facing surface.
1. **No TLS, binds `0.0.0.0` by default, token in the WS query string.** See Security posture. The
   product's own docs tell you to put a reverse proxy in front, which is an admission.
2. **Docs contradict the code on whether auth exists at all.** `cloudcli.ai/docs/remote-server`:
   *"CloudCLI UI does not include built-in authentication."* The code has bcrypt + JWT.
3. **The shell tab voids the "tools disabled by default" promise.** The README's boldest security
   claim covers one of two execution paths.
4. **Interactive tools silently break in `auto`/`bypassPermissions` modes** — the model answers its
   own `AskUserQuestion`. Documented in a code comment; not documented to users.
5. **Historic fake telemetry.** `v1.12.0` `src/components/ClaudeStatus.jsx` displayed a token
   counter that was **invented**: `tokenRate = 30 + Math.random() * 20`, `fakeTokens = elapsed *
   tokenRate`, rendered next to a `⚒` glyph as if real. It is **gone from the current tree** (grep
   for `fakeTokens` returns nothing) — but it shipped, and it is a reason to verify rather than trust
   any number this UI shows.
6. **Symlink escape on project-file endpoints.** `startsWith` without `realpath`.
7. **Login has no rate limiting; 6-character minimum password.**
8. **Scope creep.** TaskMaster (1,470 lines), PRD editor, browser-use, voice, plugins, n8n, Electron,
   Docker sandboxes, Cloud. `server/routes/agent.js` is 1,257 lines; `git.js` 1,634;
   `session-conversations-search.service.ts` 1,226; `useChatComposerState.ts` 1,222. The core is
   excellent; the perimeter is thin.
9. **Deleted computer-use left `optionalDependencies` behind** — `screenshot-desktop` and nut-js are
   still declared and still installed by the desktop packaging script.
10. **Licence archaeology is a mess.** `package.json` MIT vs `LICENSE` GPLv3 across at least three
    tags; the npm package declared MIT for ~5 months while the repo said GPL-3.0; a mid-life
    GPL→AGPL relicence; a `NOTICE` conceding third-party contributions stay GPL; AGPL §7 attribution
    and anti-misrepresentation terms on top. Anyone vendoring this needs counsel, not a blog post.
11. **150 open issues**, including the two unresolved security-operations ones (#1053 intrusion,
    #1054/#369 no password rotation) and #361 (no TLS, open since January).
12. **Stars ≫ installs.** 12.9k stars against ~1,775 npm downloads/month. Desktop installers and
    `git clone` undercount, but the gap is large enough to suggest the star count is reputational
    rather than a usage signal. Treat "12.9k stars" as weak evidence of production hardening.
13. **`plugins/starter` is a git submodule** — empty in a plain `git clone`, which will confuse
    contributors.
14. **Single-user only.** Team features are the paid Cloud tier. Fine as a business model; just know
    the OSS ceiling.

---

## Overlap with Loush Dashboard

> **Correction to the brief.** The task description says Loush cannot "drive a Claude Code session
> from the browser." That is **not accurate** — `server/index.mjs:909` already spawns
> `claude -p --input-format stream-json --output-format stream-json --verbose
> --dangerously-skip-permissions` and streams events to the browser over **SSE** at
> `/api/chat/:id/events`, with model selection, image attachment, `/` and `@` autocomplete, and
> memory-grounded prompt injection. What we lack is not the driving — it is **permission prompts,
> graceful interrupt, reconnect/replay, and stable session URLs.**

| Their feature | Our equivalent section (or NONE) | Who does it better | Note |
|---|---|---|---|
| Drive a Claude Code session from the browser | **ChatSection** + `server/index.mjs:909` | **Theirs** | Ours: `spawn` + SSE, one-way. Theirs: Agent SDK + WS, with abort, replay and permissions |
| Permission prompts in the browser | **NONE** | **Theirs, uncontested** | We pass `--dangerously-skip-permissions`. Biggest single gap |
| Interrupt a run | Partial — `DELETE /api/chat/:id` does `child.kill()` | **Theirs** | `kill()` is a hammer; `queryInstance.interrupt()` is graceful and leaves the transcript consistent |
| Resume mid-stream after refresh | **NONE** | **Theirs, uncontested** | We replay `historyEvents()` on attach but have no `seq`/gap-fill; a refresh mid-run loses live frames |
| Stable session URL before first message | **NONE** | **Theirs** | Ours returns a random 8-char chat id; no deep links |
| Transcript reading / joining to repos on disk | **Sessions, Forensics, ContextExplorer, Flow, ActivityTimeline** | **Ours, clearly** | They read JSONL to render chat. We derive forensics, flow graphs, context analysis, capability ledgers. Different products |
| Live file-watch push of new sessions | **NONE** (we poll / read on request) | **Theirs** | chokidar + debounced `session_upserted` deltas |
| File explorer | **NONE** | **Theirs, uncontested** | 11 components, context menu, upload, image viewer |
| Code editor | Partial — we have CodeMirror in Ticket/Prompt surfaces | **Theirs** | Theirs: 6 languages, minimap, diff, markdown preview, media preview |
| Git integration UI | **NONE** (we shell to `git` in `fe.mjs`, read-only) | **Theirs, uncontested** | 22 routes incl. stage/commit/branch/push |
| Integrated shell / terminal | **NONE** | **Theirs, uncontested** | node-pty + xterm + detach/reattach |
| Mobile / PWA | **NONE** | **Theirs, uncontested** | Manifest, SW, bottom nav, iOS keyboard, web push |
| Model switching | **ChatSection** (`<select>` for new/resumed sessions) | **Tie** | Theirs adds effort control and a runtime-served model list |
| Image paste / attach | **ChatSection** (`/api/chat/upload`, 300 MB raw) | **Theirs** | Ours has no server-side path containment on the attachment. Theirs does |
| Context-usage statusline | **UsagePanel** (aggregate/historical) | **Split** | Theirs: live per-run pill. Ours: deeper historical analysis. Complementary, not competing |
| Slash-command autocomplete | **ChatSection** `/api/chat/complete` | **Tie** | Both read `.claude/commands` + skills |
| `@` file mentions | **ChatSection** (`kind=files`) | **Tie** | Theirs uses ripgrep |
| MCP management | **McpSection** | **Tie** | Both read `~/.claude.json` |
| Hooks management | **HooksSection** | **Ours** | They have no hooks UI |
| Skills/commands/agents toggling | **CustomizeSection** (`.off` rename trick) | **Ours** | Theirs lists skills; ours enables/disables them |
| Session search | Partial — `/api/search` | **Theirs** | 1,226-line dedicated search service + fuse.js |
| Command palette (⌘K) | **QuickActions** | **Theirs** | Theirs uses `cmdk` with a registry |
| Multi-provider (Cursor/Codex/OpenCode) | **NONE** | **Theirs** | Off-thesis for us |
| Auth | **NONE** (local-first, no auth) | **Theirs** — but by design, not accident | Our zero-telemetry local-first thesis means localhost-only. Adding auth is only needed if we add remote access |
| Ticket / JIRA workflow | **TicketSection** (926 lines + `ticket.mjs` 1,170) | **Ours, uncontested** | They have TaskMaster; different shape, and ours is grounded in a chosen checkout |
| Delivery / Quality / Reliability / Governance / TeamBaseline / CapabilityLedger | **Ours** | **Ours, uncontested** | No counterpart at all. This is our actual differentiation |
| Plugin system | **NONE** | **Theirs** | Probably not worth copying |
| Notifications (web push) | **Inbox** (in-app) | **Theirs** for push | Ours is richer in-app |
| Zero telemetry | Both, effectively | **Ours** by explicit thesis | Theirs phones home only for version checks; the Cloud tier is opt-in |

**Summary:** they own the *IDE surface* (files, git, shell, editor, mobile). We own the *analysis
surface* (forensics, delivery, governance, capability, tickets). The overlap is the chat driver, and
theirs is better-engineered on the transport layer while ours is better-grounded in project context.

---

## Recommended adoptions

Ranked by (value to Loush) ÷ (effort × legal risk). Every item is design-level unless flagged
"paste".

### 1. Adopt their WS chat protocol shape — replace SSE with WebSocket + `seq` replay — **M**

- **Take:** the four inbound verbs (`chat.send` / `chat.abort` / `chat.subscribe` /
  `chat.permission-response`), the `kind`-tagged outbound envelope, the one-`complete`-per-run
  invariant, and the per-run `seq` + ring-buffer replay from `chat-run-registry.service.ts`.
- **Lands in:** new `server/chat-ws.mjs` (registry + gateway) replacing the SSE half of
  `server/index.mjs:909-973`; new `src/lib/ws.mjs` mirroring `WebSocketContext`'s subscribe-registry
  pattern; `src/sections/ChatSection.jsx` consumes it.
- **Effort:** M. Adds one dependency (`ws`). ~400 lines total. Protocol is a design, not a paste.
- **Unlocks:** refresh mid-run without losing the stream; two browser tabs on one session; the
  prerequisite for everything below.
- **Do not repeat their mistakes:** CVE-2026-31975 was exactly this layer. If we add a WS gateway,
  (a) authenticate at the **upgrade**, not the first message, (b) never accept a session id, project
  path or provider id from the client — resolve them server-side from our own index, exactly as
  `handleChatSend()` does, and (c) since Loush is localhost-only with no auth, **bind `127.0.0.1`,
  not `0.0.0.0`**, and keep it that way. Their `.env.example` defaults to `0.0.0.0`; that default is
  half of why their RCE mattered.

### 2. Browser-rendered permission prompts — stop using `--dangerously-skip-permissions` — **M/L**

- **Take:** the `canUseTool` / `waitForToolApproval` / `matchesToolPermission` triad from
  `server/claude-sdk.js`, including the 55 s-vs-infinite timeout split and "allow + remember" writing
  `Bash(cmd:*)` into the live allow-list.
- **Lands in:** `server/chat-ws.mjs` + a new permission banner in `src/sections/ChatSection.jsx`;
  surface the resulting allow-rules in **Governance** and **CapabilityLedger**.
- **Effort:** M if we move the chat driver to `@anthropic-ai/claude-agent-sdk` (which also gives us
  `.interrupt()` free); L if we keep raw-CLI stream-json and reimplement.
- **Unlocks:** we can honestly claim safety. Right now every Loush chat runs fully unsandboxed, which
  is a worse posture than the upstream project we are reviewing. **This is the highest-integrity fix
  on the list.** It also feeds Governance real allow/deny events instead of nothing.

### 3. `extractTokenBudget()` → a live context pill — **S**

- **Take:** the pure function (paste-scale, ~50 lines, already plain JS) plus the
  `status`/`token_budget` frame and the `TokenUsageSummary` pill shape.
- **Lands in:** `server/chat-ws.mjs`; pill in `ChatSection.jsx`; wire the same numbers into
  **UsagePanel** so live and historical usage share one accounting.
- **Effort:** S.
- **Unlocks:** "how close am I to compaction" answered live. Correct cache-token accounting, which we
  do not currently do.

### 4. chokidar watcher on `~/.claude/projects` → push `session_upserted` — **S/M**

- **Take:** `sessions-watcher.service.ts`'s debounce shape (500 ms / 2 s max-wait) and delta-not-
  snapshot broadcast.
- **Lands in:** `server/index.mjs` (or the new `chat-ws.mjs`); consumed by **Sessions**,
  **ActivityTimeline**, **Inbox**, **Overview**.
- **Effort:** S/M. One dependency; our parsers already exist.
- **Unlocks:** the dashboard stops being a snapshot. A terminal session started outside Loush appears
  live. Directly serves the local-first thesis.

### 5. Stable app-session-id ↔ provider-session-id mapping — **M**

- **Take:** the `ChatSessionWriter` idea: allocate our own session id up front, keep the Claude
  session id server-side, remap outbound frames, write the mapping when `session_created` arrives.
- **Lands in:** `server/chat-ws.mjs` + a small JSON session index (no DB needed at our scale);
  routes in `App.jsx`.
- **Effort:** M.
- **Unlocks:** deep-linkable `#/chat/:id`, shareable session links inside the team, optimistic
  navigation. Prerequisite for showing a session in **Flow** and **Sessions** before it finishes.

### 6. Server-side attachment path containment — **S**

- **Take:** `filterImagesToUploadStore()` verbatim in spirit (~20 lines).
- **Lands in:** `server/index.mjs:1011` (`/api/chat/upload`) and the message send path.
- **Effort:** S.
- **Unlocks:** closes a real hole — we currently accept a 300 MB raw body and reference files by
  path with no containment check.

### 7. iOS `visualViewport` keyboard fix + `safe-area-inset` variables — **S**

- **Take:** the 14-line effect and the CSS variable convention.
- **Lands in:** `src/App.jsx` and `src/styles.css`.
- **Effort:** S.
- **Unlocks:** Loush becomes usable on a phone at all. Cheapest visible win here.

### 8. Tool-renderer registry for the chat transcript — **M**

- **Take:** the `toolName → renderer` registry pattern and `parentToolUseId` subagent grouping from
  `src/components/chat/tools/`.
- **Lands in:** `src/sections/ChatSection.jsx` (which already hand-nests subagents under `Task`
  tool_use nodes — this formalises it) and reusable in **Forensics** and **ContextExplorer**.
- **Effort:** M.
- **Unlocks:** one renderer set shared by live chat and historical transcript views, instead of two
  divergent code paths.

### 9. Git panel backend — **M/L**

- **Take:** `server/routes/git.js`'s `spawn`-with-argv discipline and its
  `--porcelain=v1 -z` parser (including conflict detection), then only the routes we need:
  status / diff / stage / unstage / commit / branches.
- **Lands in:** new `server/git.mjs`; new `GitSection.jsx`, cross-linked from **Delivery**,
  **WorkingSet** and **Ticket** (which already picks a project folder).
- **Effort:** M for a read-mostly panel, L for the full 22 routes.
- **Unlocks:** WorkingSet and Ticket get to show and stage real changes instead of describing them.

### 10. Integrated shell (node-pty + xterm) with detach/reattach — **L**

- **Take:** the PTY session keying, the do-not-kill-on-socket-close policy, the 5,000-chunk replay,
  and the ANSI-stripping auth-URL detector.
- **Lands in:** `server/shell.mjs` + a new `ShellSection.jsx`.
- **Effort:** L. `node-pty` is a native module needing per-platform build handling — real cost on
  Windows, which is our primary platform.
- **Unlocks:** the last reason to leave the dashboard. **Rank it last**: it is the biggest effort, the
  biggest security surface, and the least aligned with our analysis-first thesis. Do 1–7 first.

### Explicitly not recommended

- **Computer use / screen reading** (either variant). Deleted upstream for a reason; the overlay
  variant is Windows-only Tkinter with `bypassPermissions` by default and a live prompt-injection
  surface. If we ever want it, ship it as an opt-in MCP server, not a built-in.
- **Plugin system, TaskMaster, browser-use, voice, Electron, multi-provider.** Perimeter features
  that would double our maintenance surface without serving the thesis.
- **Pasting large AGPL files.** See the licence caveat. Take designs; write our own code.

---

## Sources

**Primary — source code (shallow clone of `main` @ `75ff8a5`, 2026-07-28, read 2026-07-29):**

- `https://github.com/siteboon/claudecodeui` — README.md, LICENSE, NOTICE, CHANGELOG.md,
  package.json, .env.example, .gitmodules
- `server/index.js`, `server/claude-sdk.js`, `server/middleware/auth.js`, `server/routes/auth.js`,
  `server/routes/git.js`, `server/browser-use-mcp.ts`,
  `server/modules/browser-use/browser-use.service.ts`
- `server/modules/websocket/README.md` and all nine `server/modules/websocket/services/*.ts`
- `server/modules/providers/list/claude/*.ts`,
  `server/modules/providers/services/sessions-watcher.service.ts`
- `server/shared/types.ts` (`MessageKind`, `GatewayEventKind`, `NormalizedMessage`)
- `src/contexts/WebSocketContext.tsx`, `src/components/app/AppContent.tsx`,
  `src/components/chat/**`, `src/components/shell/**`, `src/hooks/useSessionProtection.ts`,
  `src/index.css`, `public/manifest.json`

**Primary — deleted code recovered via `gh api` at parent commit `35da5d09`:**

- `server/modules/computer-use/computer-executor.ts`, `computer-use.service.ts`,
  `server/computer-use-mcp.ts`, `desktop-agent-relay.service.ts`, `electron/computerAgent.js`
- Removal commit: `https://github.com/siteboon/claudecodeui/commit/6761f31a56fe82d82c7e0c079b4891e7d5a81817`

**Primary — historical tags via `gh api .../contents/...?ref=<tag>`:**

- `v1.1.0`, `v1.5.0`, `v1.12.0` — package.json, LICENSE, `src/components/` and `server/` listings,
  `MobileNav.jsx`, `ClaudeStatus.jsx`, `TokenUsagePie.jsx`, `Shell.jsx`, `FileTree.jsx`,
  `CommandMenu.jsx`
- Relicence commit `004135ef` (2026-03-27)

**GitHub API metadata (2026-07-29):** `repos/siteboon/claudecodeui`, `/commits`, `/releases`,
`/tags`, `/languages`, `/contributors`

**Product / docs:**

- https://cloudcli.ai · https://cloudcli.ai/docs · https://cloudcli.ai/docs/remote-server
  (source of the "does not include built-in authentication" statement)
- https://github.com/siteboon/claudecodeui/releases
- https://claudecodeui.siteboon.ai

**Screen-reading variant:**

- https://github.com/shengyanlin/claude-overlay (MIT, Windows, Python/Tkinter) — files
  `claude_overlay.py`, `win32utils.py`, `worker.py`, `modelresolve.py`, `cliupdate.py`, `config.py`
- Runners-up surveyed: `pickle-com/glass`, `sohzm/cheating-daddy`, `screenpipe/screenpipe`,
  `TheoEwzZer/WinSight-MCP`, `kmoulder/screen-capture-mcp`, `gorka2354/shotik`

**Comparison baseline (our repo):** `E:\AI-Dashboard` — `package.json`, `server/index.mjs`
(esp. lines 909–1030), `src/sections/ChatSection.jsx`, `src/sections/TicketSection.jsx`,
`src/App.jsx`

**Security advisories (verified via `gh api repos/siteboon/claudecodeui/security-advisories`):**

- https://github.com/siteboon/claudecodeui/security/advisories/GHSA-gv8f-wpm2-m5wr (CVE-2026-31975,
  CVSS 9.8, unauthenticated RCE)
- https://github.com/advisories/GHSA-7fv4-fmmc-86g2 (CVE-2026-31861)
- https://github.com/siteboon/claudecodeui/security/advisories/GHSA-f2fc-vc88-6w7q (CVE-2026-31862,
  CVSS 9.1)
- https://projectdiscovery.io/blog/everyone-is-finding-vulns-the-hard-part-is-proving-them
  (Cao & Chaddha, 2026-03-20 — discovery provenance)

**Issue tracker:** #269 (npm tarball shipped a pre-seeded admin account), #1053 (live intrusion
report, open), #1054 & #369 (cannot rotate credentials, open), #361 (no TLS, open), #190, #9, #798,
#1042 — all at `https://github.com/siteboon/claudecodeui/issues/<n>`

**Web reception:**

- Show HN `https://news.ycombinator.com/item?id=47352564` — verified via the HN Firebase API
  (`item/47352564.json`): 5 points, 1 comment (from a project contributor). Algolia searches by URL,
  `claudecodeui`, `siteboon` and `CloudCLI` return exactly this one story. **No discussion to mine.**
- https://blog.brightcoding.dev/2026/04/25/cloudcli-the-revolutionary-web-ui-for-ai-coding-agents —
  assessed as SEO advertorial, not review
- https://www.alternativeto.net/software/claude-code-ui/ — competitor listing
- **Reddit: could not verify.** `reddit.com` is blocked for both fetch and search from this
  environment. Absence of findings is not evidence of absence of discussion.

**Competitive context:**

- https://venturebeat.com/orchestration/anthropic-just-released-a-mobile-version-of-claude-code-called-remote
  (Anthropic Remote Control, 2026-02-25)
- https://happy.engineering · https://omnara.com · https://github.com/sugyan/claude-code-webui ·
  https://github.com/BloopAI/vibe-kanban · https://conductor.build ·
  https://github.com/stravu/crystal · https://github.com/winfunc/opcode ·
  https://news.ycombinator.com/item?id=45427697 (Sculptor Show HN)

**Pricing:** https://cloudcli.ai/ (Hobby €7 / Growth €20 / Team €39 per month, read 2026-07-29).
**npm registry:** `registry.npmjs.org` version/licence history for `@siteboon/claude-code-ui` and
`@cloudcli-ai/cloudcli`.

**Prompt-injection flags encountered:** (a) the `shengyanlin/claude-overlay` README embeds a literal
`claude "Set up Claude Overlay for me: clone …"` self-install directive; (b) the CloudCLI
`server/modules/websocket/README.md` contains "Extending This Module" instructions. Both were read
as data. Neither was acted on.
