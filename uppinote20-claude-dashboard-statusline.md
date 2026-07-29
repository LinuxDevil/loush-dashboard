# claude-dashboard (uppinote20)

> Upstream research for Loush Dashboard. Target is a Claude Code **terminal status-line plugin**, not a web dashboard.
> All facts below were read from the repository source at commit `fb4e06e` (tarball of `main`, fetched 2026-07-29).
> Where something could not be verified it is marked **unverified**.

---

## Identity

| Field | Value |
|---|---|
| Repo URL | https://github.com/uppinote20/claude-dashboard |
| Docs site | https://claude-dashboard.uppinote.dev (Astro + Starlight, source in `website/`) |
| Author | `uppinote` / GitHub `uppinote20` (user id 67043631) |
| License | **MIT** (SPDX: `MIT`). `LICENSE` reads "Copyright (c) 2026 uppinote". `package.json` and `.claude-plugin/plugin.json` both declare `"license": "MIT"`. |
| Stars / Forks | 533 stars, 58 forks (as of 2026-07-29) |
| Open issues | 1 |
| Created | 2026-01-05 |
| Last commit / push | 2026-07-22 (`chore: bump version to v1.30.1`) |
| Activity | ~391 commits, 62 pull requests (open+closed), 50 tags with matching GitHub releases (drafted by `release-drafter`). Release cadence ~1–3 per month: v1.26.2 (2026-05-13), v1.27.0 (05-23), v1.28.0 (05-26), v1.29.0 (05-30), v1.30.0 (07-04), v1.30.1 (07-22). Actively maintained. |
| Contributors | 6 — `uppinote20` (382 commits) plus `woogii-marc` (2), `maenwi` (2), `Horacehxw` (1), `OmbraRD` (1), `wangkezun` (1). Effectively a single-author project. |
| Language / stack | TypeScript 5 (strict), ESM, Node 18+. Built with esbuild into a single bundled file. **Zero runtime dependencies** — Node built-ins only. Dev deps: `@types/node`, `esbuild`, `typescript`, `vitest`. |
| Install method | Claude Code plugin marketplace: `/plugin marketplace add uppinote20/claude-dashboard` → `/plugin install claude-dashboard` → `/claude-dashboard:setup`. Manual: `git clone` into `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/claude-dashboard`. |
| Distribution trick | `dist/index.js` (129 KB) and `dist/check-usage.js` (67 KB) are **committed to the repo** so plugin users never run a build step (`CLAUDE.md`: "dist/index.js is committed"). |
| Platforms | macOS, Linux, Windows. Platform-specific code: macOS credentials come from Keychain via `security find-generic-password`; Linux/Windows read `.credentials.json`. `/claude-dashboard:setup-alias` supports zsh/bash and PowerShell. **Caveat:** `scripts/utils/git.ts` `countUntrackedLines()` shells out to `sh -c "... \| xargs -0 cat \| wc -l"`, which will not work on stock Windows without a POSIX shell — the function swallows the error and returns 0. |
| i18n | English + Korean (`locales/en.json`, `locales/ko.json`), auto-detected from `LANG`/`LC_ALL`/`LC_MESSAGES`. |
| Tests | Vitest, 19 test files under `scripts/__tests__/`. `widgets.test.ts` alone is 92 KB; `transcript-parser.test.ts` is 36 KB. Test coverage is unusually strong for a plugin of this size. |
| CI | `.github/workflows/`: `claude.yml`, `claude-code-review.yml`, `release-drafter.yml`, `release.yml`. |
| Funding | Ko-fi and Buy Me A Coffee links in README. |

---

## The problem it solves

Claude Code's built-in status line shows almost nothing. Users on Pro/Max subscriptions have three separate resource meters they cannot see while working:

1. **Context window** — how close the current conversation is to compaction.
2. **Subscription rate limits** — the 5-hour and 7-day usage windows that gate a Max/Pro plan, and when they reset.
3. **Cost** — session spend and daily spend against a personal budget.

Beyond that, a Claude Code session generates a lot of state that is invisible mid-flight: which tools are running, how many subagents are in flight, todo progress, cache hit rate, uncommitted diff size, which slash command started this turn.

And for people who juggle multiple AI CLIs (Claude Code, OpenAI Codex CLI, Gemini CLI, z.ai/GLM), there is no single place to answer "which one do I still have quota on?"

claude-dashboard compresses all of that into 1–6 terminal lines that redraw on every Claude Code turn, plus a `/claude-dashboard:check-usage` command that answers the multi-CLI question directly with a recommendation.

---

## Value proposition

- **Glanceable telemetry at zero interaction cost.** The status line is already on screen; no window switch, no browser tab.
- **The only widget set that reads Anthropic's real subscription rate limits.** Both from Claude Code stdin (`rate_limits.five_hour` / `.seven_day`) and, for Max-only model-scoped weekly caps, from the undocumented `https://api.anthropic.com/api/oauth/usage` endpoint.
- **Multi-CLI quota arbitrage.** Claude + Codex + Gemini + z.ai in one view, with a "use this one next" recommendation.
- **Fully composable.** 42 registered widgets, arbitrary line composition, a single-character preset DSL (`"MC$R|BDO"`), 9 themes, 4 separators, per-widget disable list.
- **Fails silently and correctly.** Every widget returns `null` to disappear; a failed widget is logged and skipped, never crashes the line. Three-tier caching plus negative caching keeps the per-render cost near zero.
- **Local-first, no telemetry.** No runtime dependencies, no phone-home. It reads local files and calls only the vendor APIs whose credentials are already on the machine.

---

## Widget catalogue

42 widget IDs are registered in `scripts/widgets/index.ts` (35 source files; several files export multiple widgets that share one `getData`).

Notation: **stdin** = the JSON Claude Code pipes into the status-line command (typed as `StdinInput` in `scripts/types.ts`). **transcript** = the session `transcript.jsonl` at `stdin.transcript_path`. **API** = a network call.

### Core

| Widget | What it shows | Data source | Computation | Worth porting to a web panel? |
|---|---|---|---|---|
| `model` (`widgets/model.ts`) | `◆ Opus(X) ↯` — short model name, effort badge, fast-mode mark | `stdin.model.id/.display_name` + `${CLAUDE_CONFIG_DIR\|~/.claude}/settings.json` (`effortLevel`, `fastMode`), env `CLAUDE_CODE_EFFORT_LEVEL` | `shortenModelName()` maps display name → Opus/Sonnet/Haiku/Fable by substring. Effort badge map `{max:'MAX', xhigh:'X', high:'H', medium:'M', low:'L'}`; default `high` when unset. Badge hidden for Haiku. `↯` only when Opus + `fastMode`. settings.json cached by `(path, mtime)`. | **Yes, small.** Effort level + fast mode are not in our transcripts; reading `settings.json` is 10 lines. Good for a "Harness/Setup" fact row. |
| `context` (`widgets/context.ts`) | `████░░░░░░ 45% 90K/200K` | `stdin.context_window` | Prefers the official `used_percentage` from stdin; falls back to `calculatePercent(inputTokens, contextSize)` where `inputTokens = input + cache_creation + cache_read` (output excluded). `contextSize` defaults 200000. Color: ≤50 safe / ≤80 warning / >80 danger. | **Yes.** The "official percentage first, computed second" precedence is the correct rule and is easy to get wrong. |
| `contextBar` / `contextPercentage` / `contextUsage` | Bar only / % only / `90K/200K` only | same `getData` as `context` | Derived-widget pattern: three widget objects share one `getContextData`, differ only in `render`. | **Yes — the pattern more than the widget.** Lets one data fetch back several UI atoms. |
| `cost` (`widgets/cost.ts`) | `$1.25` | `stdin.cost.total_cost_usd` | `formatCost` → `$x.xx`. Returns `0` rather than null. | Already covered by our UsagePanel. |
| `projectInfo` (`widgets/project-info.ts`) | `📁 repo (src/api) (main* ↑3↓1) 🌳 wt:feat` | `stdin.workspace.current_dir/.project_dir`, `stdin.worktree`, and 4 `git` subprocesses | Parallel `rev-parse --abbrev-ref HEAD`, `status --porcelain` (→ `*` dirty suffix), `rev-list --left-right --count @{u}...HEAD` (→ ahead/behind), `remote get-url origin`. Remote URL normalised SSH→HTTPS and turned into an **OSC8 terminal hyperlink** to `/tree/{branch}`. All four cached together for 5 s keyed on cwd. | **Yes.** The 5 s combined git cache + SSH→HTTPS normaliser are directly liftable. |

### Rate limits

| Widget | What it shows | Data source | Computation | Worth porting to a web panel? |
|---|---|---|---|---|
| `rateLimit5h` (`widgets/rate-limit.ts`) | `5h: 42% (1h23m)` | `stdin.rate_limits.five_hour` first; else `GET https://api.anthropic.com/api/oauth/usage` | `Math.round(utilization)`; `formatTimeRemaining(resets_at)`. **This is the only widget that surfaces an API failure** — returns `{isError:true}` so exactly one ⚠️ appears rather than four. Returns `null` entirely when `isZaiProvider()`. | **Yes — highest value item in the whole repo.** This is a data source we do not have. |
| `rateLimit7d` | `7d: 69%` | `stdin.rate_limits.seven_day` or API `seven_day` | same | **Yes.** |
| `rateLimit7dSonnet` | `7d-S: 23%` | API `seven_day_sonnet` only (never in stdin) | Max plan only. **Deprecated ~2026-06** — the source comment says Anthropic merged the Sonnet weekly bucket into the unified weekly limit at the Sonnet 5 launch, so the field returns `null` and the widget self-hides. Kept registered so old configs don't break. | No — dead field. |
| `rateLimit7dFable` | `7d-F: 18%` | API only, and only from the generic `limits[]` array | `findWeeklyScopedLimit(d.limits, 'Fable')` scans for `{kind:'weekly_scoped', scope.model.display_name:'Fable', percent, resets_at}`. Note the array uses `percent`, the flat fields use `utilization`. | **Yes, as part of the API client.** Shows the response shape is evolving toward a generic array. |

### Session

| Widget | What it shows | Data source | Computation | Worth porting to a web panel? |
|---|---|---|---|---|
| `sessionId` / `sessionIdFull` (`widgets/session-id.ts`) | `🔑 abc12345` / full UUID | `stdin.session_id` | `slice(0,8)`. Shared `getData`. | Low value; we already key by session. |
| `sessionName` (`widgets/session-name.ts`) | `» feature-auth` | `stdin.session_name` first, else transcript `customTitle` field | Prefers stdin ("zero-cost") over transcript parse. Truncated to 20 chars. | **Yes, small.** The `/rename` title lives in transcript `customTitle` — useful for our Sessions list. |
| `sessionDuration` (`widgets/session-duration.ts`) | `⏱ 1h23m` | `stdin.cost.total_duration_ms`, else file `~/.cache/claude-dashboard/sessions/{id}.json` | Falls back to a self-managed start-time file created with `open(path,'wx')` (O_EXCL) so concurrent processes cannot disagree on start time. Files GC'd after 7 days. | Partially — stdin field is the real find. |
| `lastPrompt` (`widgets/last-prompt.ts`, `utils/history-parser.ts`) | `💬 14:32 Fix the auth bug…` | **`${CLAUDE_CONFIG_DIR\|~/.claude}/history.jsonl`** — not the transcript | Tail-reads the **last 16 KB only**, reverse-scans lines for the first entry whose `sessionId` matches, reads `display`. Expands `[Pasted text #N ...]` placeholders from `pastedContents[N].content`. Whitespace collapsed, truncated to 60 chars. Cached by `(path, fileSize)`. | **Yes, high value.** `history.jsonl` contains *only genuine user input* — no skill/command expansions, no tool results. That is a cleaner prompt corpus than transcripts for PromptStudio/PromptQuality. |
| `configCounts` (`widgets/config-counts.ts`) | `CLAUDE.md: 2, AGENTS.md: 1, Rules: 3, MCP: 4, Hooks: 2, +Dirs: 1` | filesystem + `stdin.workspace.added_dirs` | `CLAUDE.md` = existence of `./CLAUDE.md` + `./.claude/CLAUDE.md`. `AGENTS.md` = `./AGENTS.md` + count of `*.md` in `./.claude/agents/`. Rules = file count in `./.claude/rules/`. Hooks = file count in `./.claude/hooks/`. MCPs = sum of `Object.keys(mcpServers)` across `./.claude/mcp.json`, `getClaudeJsonPath()` (`~/.claude.json` or `$CLAUDE_CONFIG_DIR/.claude.json`), and `~/.config/claude-code/mcp.json`. All in `Promise.all`. 30 s cache keyed on `(projectDir, claudeJsonPath)` — the resolved `.claude.json` path is in the key so an env switch cannot serve the wrong account's counts. | **Yes.** This is a compact "harness inventory" and the three-location MCP merge is exactly the enumeration our Mcp/Hooks sections need. |

### Activity (all read the transcript)

| Widget | What it shows | Data source | Computation | Worth porting to a web panel? |
|---|---|---|---|---|
| `toolActivity` (`widgets/tool-activity.ts`) | `⚙️ Read(app.ts), Bash(npm test) +2 (12 done)` | transcript | `runningToolIds` = `tool_use` block ids minus ids that have seen a `tool_result`. `completedToolCount` is an incrementing counter (deliberately not a Set — memory). Shows first 2 running + `+N`. `extractToolTarget()` renders `Read/Write/Edit → basename(file_path)`, `Glob/Grep → pattern` (≤20), `Bash → command` (≤25). | **Yes.** `extractToolTarget` is a tiny, high-signal function worth copying verbatim into our transcript parser. |
| `agentStatus` (`widgets/agent-status.ts`) | `🤖 Agent: code-explorer: find auth… +1` | transcript | Tracks `tool_use` blocks named `Task`: `activeAgentIds` set, `completedAgentCount`. Name = `input.subagent_type`, description = `input.description` truncated to 20. | **Yes.** Subagent fan-out tracking. |
| `todoProgress` (`widgets/todo-progress.ts`) | `✓ Write the parser [3/5]` | transcript | `extractTodoOrTaskProgress()` = new Tasks API first (`TaskCreate`/`TaskUpdate` tool calls, applied only when the `tool_result` returns), falling back to the last completed `TodoWrite` input. `normalizeTaskStatus()` maps `not_started→pending`, `running→in_progress`, `complete\|done→completed`. | **Yes.** The Tasks-API-then-TodoWrite fallback and the status normaliser are both non-obvious and will bite us otherwise. |
| `slashCommand` (`widgets/slash-command.ts`) | `🎯 /superpowers:brainstorming` | transcript | Regex `/<command-name>([^<]+)<\/command-name>/` on user text blocks. Set when a user text entry carries the tag; cleared when a user entry has *genuine plain text* and no tag. Explicitly does **not** clear on `tool_result`-only user entries, nor on string payloads starting with `<` (which are `<local-command-stdout>` / `<local-command-caveat>` system injections). | **Yes, high value.** Attributing turns to the slash command / skill that started them is exactly what a "which skill did this work" panel needs, and the two false-clear traps are documented here. |
| `agentMode` (`widgets/agent-mode.ts`) | `👤 my-coder · 🤖 code-explorer` | `stdin.agent.name`, `stdin.agent_type` | Identity of *this* session (custom agent via `/agent`, or the subagent type it was dispatched as). Distinct from `agentStatus`. | Yes, small. |

### Analytics / insights

| Widget | What it shows | Data source | Computation | Worth porting to a web panel? |
|---|---|---|---|---|
| `burnRate` (`widgets/burn-rate.ts`) | `🔥 5.2K/min` | `stdin.context_window.current_usage` + session elapsed | `(input + output + cache_creation + cache_read) / elapsedMinutes`. `minMinutes = 0`, so it shows `0/min` at session start instead of hiding. Guards `Number.isFinite` and `>= 0`. | Yes — trivially. |
| `tokenSpeed` (`widgets/token-speed.ts`) | `⚡ 67 tok/s` | `stdin.context_window.total_output_tokens`, `stdin.cost.total_api_duration_ms` | `outputTokens / (apiDurationMs/1000)`. Note: divides by **API** time, not wall time — this is generation speed, not throughput. | **Yes.** Correct denominator choice is the insight. |
| `cacheHit` (`widgets/cache-hit.ts`) | `📦 85%` | `stdin.context_window.current_usage` | `cache_read / (cache_read + input + cache_creation) * 100`, clamped [0,100]. **Output tokens are excluded from the denominator.** Colour is inverted: `getColorForPercent(100 - hit)` so high = green. | **Yes.** Both the exact denominator and the colour inversion are the kind of thing that is wrong in every naive implementation. |
| `depletionTime` (`widgets/depletion-time.ts`) | `⏳ ~2h30m to 5h` | `ctx.rateLimits.five_hour.utilization` + session elapsed minutes | `utilizationPerMinute = utilization / elapsedMinutes`; `minutesToLimit = (100 - utilization) / utilizationPerMinute`. Bails when: utilization `< 1`, elapsed is 0, rate `< 0.01 %/min` (`MIN_UTILIZATION_RATE`), result non-finite/negative, or result `> 24*60` min (`MAX_DISPLAY_MINUTES`). Hard-codes `limitType: '5h'` — despite the type allowing `'7d'`, the 7-day branch is never taken. **Explicitly documented as an approximation**: it assumes 100 % of the window's utilization came from this session, which is wrong if the session started mid-window or other sessions run concurrently. | **Yes, with the caveat surfaced.** The four bail-out guards are the whole value; a naive "time to limit" produces nonsense numbers constantly. |
| `performance` (`widgets/performance.ts`) | `🟢 72%` | `stdin.context_window.current_usage` + session elapsed | `cacheHitRate = cache_read / (input + cache_creation + cache_read) * 100`; `outputRatio = output / (all four) * 100`; **`score = round(cacheHitRate*0.6 + outputRatio*0.4)`**, clamped [0,100]. Badge: 🟢 ≥70, 🟡 ≥40, 🔴 below. (Elapsed minutes is fetched and null-checked but does not enter the formula.) | **Maybe.** The weights are arbitrary and undefended, but a single composite "efficiency" tile is a good Overview idea. |
| `tokenBreakdown` (`widgets/token-breakdown.ts`) | `📊 In 30K · Out 8K · W 5K · R 20K` | `stdin.context_window.current_usage` | Straight passthrough of the 4 counters; hides when total is 0; hides individual parts that are 0. | Yes — but a stacked bar beats text in a web UI. |
| `forecast` (`widgets/forecast.ts`) | `📈 $1.25 → ~$8.40/h` | `stdin.cost.total_cost_usd` + session elapsed (`minMinutes = 1`) | `hourlyCost = (totalCost / elapsedMinutes) * 60`. Colour: >$10/h danger, >$5/h warning, else safe. | **Yes.** One-liner, high perceived value. |
| `budget` (`widgets/budget.ts`, `utils/budget.ts`) | `💵 $5.20 / $15.00 (35%)` | `stdin.cost.total_cost_usd` + `~/.cache/claude-dashboard/budget.json` + config `dailyBudget` | **Delta accumulation**: the state file holds `{date, dailyTotal, sessions:{[sessionId]: lastSeenCost}}`. Each render computes `delta = max(0, sessionCost - lastSeen)`, adds it to `dailyTotal`, stores the new `sessionCost`. This is what makes it safe to call on every single render without double-counting. Resets when `date !== today` (UTC `toISOString().slice(0,10)`). Zero-cost sessions are skipped so the map stays bounded. Concurrent callers in the same render are deduped through a shared `pendingRecordDaily` promise. Thresholds: ⚠️ at 80 %, 🚨 at 95 %. | **Yes — top-3 item.** The delta ledger is the correct way to do cross-session daily cost without re-reading every transcript, and it is ~60 lines. |
| `todayCost` (`widgets/today-cost.ts`) | `💰 Today: $4.83` | same `recordCostAndGetDaily()` as `budget` | Same ledger, no limit comparison. Hides at `<= 0`. | Yes — comes free with `budget`. |
| `apiDuration` (`widgets/api-duration.ts`) | `API 45%` | `stdin.cost.total_api_duration_ms` / `total_duration_ms` | `round(api/total*100)`, capped at 100. Warning colour above 70 %. Answers "is this session API-bound or tool-bound?". | **Yes.** Cheap and genuinely diagnostic. |

### Multi-CLI

| Widget | What it shows | Data source | Computation | Worth porting to a web panel? |
|---|---|---|---|---|
| `codexUsage` (`widgets/codex-usage.ts`, `utils/codex-client.ts`) | `🔷 gpt-5-codex │ 5h: 30% (2h) │ 7d: 45%` | `~/.codex/auth.json` → `GET https://chatgpt.com/backend-api/wham/usage` with `Authorization: Bearer tokens.access_token` and `ChatGPT-Account-Id: tokens.account_id` | Presence of `~/.codex/auth.json` is the install probe. Response gives `plan_type` and `rate_limit.primary_window` / `.secondary_window` (`used_percent`, `reset_at` epoch seconds). Model resolution is a 3-tier chain: regex on `~/.codex/config.toml` (`^model\s*=\s*["']…["']`) → `codex-model-cache.json` validated by config mtime → last resort **spawn `codex exec '1+1='` and regex `^model:\s*(.+)$` out of the header**, with a 5-minute negative backoff on failure. On API failure returns `{isError:true}` rather than null so a ⚠️ shows. | Only if we want multi-CLI. The `codex exec` model probe is a hack worth knowing about but not copying. |
| `geminiUsage` / `geminiUsageAll` (`widgets/gemini-usage.ts`, `utils/gemini-client.ts`) | `💎 gemini-2.5-pro 60% (4h)` / all buckets | `~/.gemini/oauth_creds.json` (or macOS Keychain service `gemini-cli-oauth`, account `main-account`) → `POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` | Full OAuth refresh flow against `https://oauth2.googleapis.com/token` with a **hard-coded `client_id` and `client_secret`** (the public gemini-cli client) and a 5-minute expiry buffer; refreshed creds are written back to `oauth_creds.json`. Project id resolved via `v1internal:loadCodeAssist`, cached 5 min per token hash. Response `buckets[]` give `modelId`, `remainingFraction`, `resetTime`; **`usedPercent = round((1 - remainingFraction) * 100)`**. Current-model bucket chosen by `bucket.modelId.includes(model)` where model comes from `~/.gemini/settings.json`. | Only if we want multi-CLI. Note the hard-coded secret. |
| `zaiUsage` (`widgets/zai-usage.ts`, `utils/zai-api-client.ts`) | `🟠 GLM │ 5h: 42% │ 1m: 15%` | env `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` → `GET {origin}/api/monitor/usage/quota/limit` | Provider detected purely from `ANTHROPIC_BASE_URL` containing `api.z.ai` (→ zai) or `bigmodel.cn` (→ zhipu). Response `data.limits[]` filtered by `type`: `TOKENS_LIMIT` → 5 h, `TIME_LIMIT` → monthly MCP. `parseUsagePercent()` tries, in order, `percentage`, then `currentValue/(currentValue+remaining)`, then `currentValue/usage`. When z.ai is active, **all four `rateLimit*` widgets return `null`** so the two quota systems are never mixed. | Only if we want multi-CLI. The mutual-exclusion pattern is worth noting. |

### Info / status

| Widget | What it shows | Data source | Computation | Worth porting to a web panel? |
|---|---|---|---|---|
| `linesChanged` (`widgets/lines-changed.ts`) | `+156 -23` | `git diff HEAD --shortstat` + untracked file line count | Regex `(\d+) insertion` / `(\d+) deletion`, plus `git ls-files --others --exclude-standard -z \| xargs -0 cat \| wc -l` for untracked lines, summed into `added`. 10 s cache keyed on cwd; failure caches `null` too (so an empty repo with no HEAD doesn't retry every render). | **Yes.** The "untracked files count as added lines" refinement is the part everyone misses. |
| `tagStatus` (`widgets/tag-status.ts`) | `🏷️ v1.2.3+5` | `git describe --tags --abbrev=0 --match <pattern> HEAD` then `git rev-list --count <tag>..HEAD` | One glob pattern → at most one tag (most recent reachable from HEAD). Patterns from config `tagPatterns`, default `["v*"]`. 30 s cache keyed on `(cwd, patterns.join('\|'))`. Hides when nothing matches. | **Yes.** "Commits since last release tag" is a real Delivery metric and this is 40 lines. |
| `outputStyle` (`widgets/output-style.ts`) | `concise` | `stdin.output_style.name` | Returns null when name is missing or `'default'`. | Yes, trivial. |
| `vimMode` (`widgets/vim-mode.ts`) | `NORMAL` / `INSERT` | `stdin.vim.mode` | Present only when vim mode is on, so the widget self-hides. INSERT green, NORMAL dim. | No — terminal-only concept. |
| `version` (`widgets/version.ts`) | `v2.1.77` | `stdin.version` | Passthrough. | Yes, trivial — pins which Claude Code produced a session. |
| `peakHours` (`widgets/peak-hours.ts`) | `Peak (3h17m)` / `Off-Peak (23h9m)` | **system clock only** — no network | Pacific time derived via `Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hourCycle:'h23',hour,minute,weekday})` + `formatToParts`. Peak = weekday (Mon–Fri) and `5 <= hour < 11` PT. Countdown to next transition handles Fri→Mon (3 days), Sat→Mon (2), Sun→Mon (1). Credits [PeakClaude](https://github.com/pforret/PeakClaude). | **Yes, cheap.** Zero-cost heuristic for "expect slower/limited service now". No timezone library needed. |

---

## Themes

Themes are defined in `scripts/utils/colors.ts` as a `Record<ThemeId, ThemeColors>`. There are **9**. Every theme fills the same 18 semantic slots, so widgets never reference a raw colour:

```
Styles:        dim, bold
Semantic:      model, folder, branch, safe, warning, danger, secondary, accent, info
Progress bar:  barFilled, barEmpty
Direct ANSI:   red, green, yellow, blue, magenta, cyan, white, gray
```

A module-level singleton (`activeTheme`, set once at startup via `setTheme(config.theme)`) means widgets call `getTheme()` with no prop drilling. `getColorForPercent(p)` returns `safe` ≤50, `warning` ≤80, else `danger`.

Two themes use 256-colour codes; the other seven use 24-bit truecolor (`\x1b[38;2;R;G;B m`).

### `default` — pastel, xterm-256 palette

| Role | ANSI 256 |
|---|---|
| model / info | `38;5;117` (pastel cyan) |
| folder / warning / accent | `38;5;222` (pastel yellow) |
| branch | `38;5;218` (pastel pink) |
| safe | `38;5;151` (pastel green) |
| danger | `38;5;210` (pastel red) |
| secondary | `38;5;249` (pastel gray) |
| barFilled / barEmpty | `32` green / `90` gray |

The docs site renders these as approximately `#87d7ff`, `#ffd787`, `#afd7af`, gray `#808080`.

### `minimal` — monochrome

All roles collapse to white `\x1b[37m` or gray `\x1b[90m`; `danger` is bold white `\x1b[1;37m`; `safe` and `barEmpty` are gray. Every direct-ANSI colour is remapped to white except `gray`.

### `catppuccin` (Mocha)

| Role | Hex |
|---|---|
| model / blue | `#89b4fa` |
| folder / yellow | `#f9e2af` |
| branch | `#f5c2e7` |
| safe / green / barFilled | `#a6e3a1` |
| warning / accent | `#fab387` (peach) |
| danger / red | `#f38ba8` |
| secondary / gray | `#7f849c` (overlay1) |
| info | `#74c7ec` (sapphire) |
| barEmpty | `#585b70` (surface2) |
| magenta | `#cba6f7` · cyan `#94e2d5` · white `#cdd6f4` |

### `catppuccinLatte` (light-mode terminals)

| Role | Hex |
|---|---|
| model / blue | `#1e66f5` |
| folder / yellow | `#df8e1d` |
| branch | `#ea76cb` |
| safe / green / barFilled | `#40a02b` |
| warning / accent | `#fe640b` (peach) |
| danger / red | `#d20f39` |
| secondary / gray | `#8c8fa1` (overlay1) |
| info | `#209fb5` (sapphire) |
| barEmpty | `#bcc0cc` (surface1) |
| magenta | `#8839ef` (mauve) · cyan `#179299` (teal) · white/text `#4c4f69` |

### `dracula`

| Role | Hex |
|---|---|
| model / blue | `#bd93f9` |
| folder / accent | `#ffb86c` |
| branch / magenta | `#ff79c6` |
| safe / green / barFilled | `#50fa7b` |
| warning / yellow | `#f1fa8c` |
| danger / red | `#ff5555` |
| secondary / gray | `#6272a4` (comment) |
| info / cyan | `#8be9fd` |
| barEmpty | `#44475a` (current line) |
| white | `#f8f8f2` |

### `gruvbox`

| Role | Hex |
|---|---|
| model | `#d79921` |
| folder / warning / accent / yellow | `#fabd2f` |
| branch / magenta | `#d3869b` |
| safe / green / barFilled | `#b8bb26` |
| danger / red | `#cc241d` |
| secondary / gray | `#a89984` |
| info / blue | `#83a598` |
| barEmpty | `#504945` |
| cyan `#8ec07c` · white `#ebdbb2` |

### `nord`

| Role | Hex |
|---|---|
| model / cyan | `#88c0d0` (frost) |
| folder / warning / yellow | `#ebcb8b` |
| branch / magenta | `#b48ead` |
| safe / green / barFilled | `#a3be8c` |
| danger / red | `#bf616a` |
| secondary / gray | `#4c566a` (polar night) |
| accent | `#d08770` (orange) |
| info / blue | `#81a1c1` (frost) |
| barEmpty | `#434c5e` |
| white | `#eceff4` |

### `tokyoNight`

| Role | Hex |
|---|---|
| model / blue | `#7aa2f7` |
| folder / warning / yellow | `#e0af68` |
| branch / magenta | `#bb9af7` |
| safe / green / barFilled | `#9ece6a` |
| danger / red | `#f7768e` |
| secondary / gray | `#565f89` (comment) |
| accent | `#ff9e64` (orange) |
| info / cyan | `#7dcfff` |
| barEmpty | `#3b4261` |
| white | `#a9b1d6` |

Docs site uses page background `#1a1b26` for this theme; all other dark themes are previewed on `#1e1e2e`, Latte on `#eff1f5`.

### `solarized` (dark)

| Role | Hex |
|---|---|
| model / blue | `#268bd2` |
| folder / warning / yellow | `#b58900` |
| branch / magenta | `#d33682` |
| safe / green / barFilled | `#859900` |
| danger / red | `#dc322f` |
| secondary / gray | `#586e75` (base01) |
| accent | `#cb4b16` (orange) |
| info / cyan | `#2aa198` |
| barEmpty | `#073642` (base02) |
| white | `#fdf6e3` |

### Separators

`SEPARATOR_CHARS` in `colors.ts`: `pipe: '│'` (default), `space: ' '`, `dot: '·'`, `arrow: '›'`. The rendered separator string is memoised (`cachedSeparator`), invalidated by `setTheme`/`setSeparatorStyle`. `space` renders as two literal spaces; the others render as `' ' + dim + char + RESET + ' '`.

### Icons

`scripts/utils/emoji.ts` is a single-source `ICON` map. Every value carries a trailing U+FE0F variation selector to force emoji presentation over the monochrome glyphs bundled in Nerd Fonts / JetBrains Mono. Non-emoji typographic symbols (`◆ ✓ ↑ ↓ → ↯`) are deliberately excluded because VS-16 has no effect on them, and stay inline in the widgets.

---

## Configuration model

### File location

`~/.claude/claude-dashboard.local.json` — **deliberately not** relocated by `CLAUDE_CONFIG_DIR`. `statusline.ts` documents why: setup always writes there, so following the env var would silently reset an existing multi-account user's dashboard to defaults. Claude Code's *own* files (`settings.json`, `.credentials.json`, `history.jsonl`, `.claude.json`) **do** follow `CLAUDE_CONFIG_DIR` via `utils/config-dir.ts`.

### Schema (`Config` in `scripts/types.ts`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `language` | `'en' \| 'ko' \| 'auto'` | `'auto'` | `auto` reads `LANG`/`LC_ALL`/`LC_MESSAGES`, `ko*` → Korean, else English |
| `plan` | `'pro' \| 'max'` | `'max'` | Gates `rateLimit7dSonnet` / `rateLimit7dFable`, and whether the API is called at all alongside stdin |
| `displayMode` | `'compact' \| 'normal' \| 'detailed' \| 'custom'` | `'compact'` | |
| `lines` | `WidgetId[][]` | — | Used only when `displayMode === 'custom'`. Outer array = lines, inner = widget order |
| `disabledWidgets` | `WidgetId[]` | `[]` | Filtered out of any mode; lines that become empty are dropped |
| `theme` | `ThemeId` | `'default'` | |
| `separator` | `'pipe' \| 'space' \| 'dot' \| 'arrow'` | `'pipe'` | |
| `preset` | `string` | — | Single-character DSL. When present it **overrides `displayMode` to `custom`** and regenerates `lines` |
| `dailyBudget` | `number` | — | USD. Presence is what enables the `budget` widget |
| `tagPatterns` | `string[]` | `['v*']` | Globs for `tagStatus` |
| `cache.ttlSeconds` | `number` | `300` | TTL for **all** API clients (Anthropic, Codex, Gemini, z.ai) |

`DEFAULT_CONFIG` is `{language:'auto', plan:'max', displayMode:'compact', cache:{ttlSeconds:300}}`. Note the README example shows `"cache": {"ttlSeconds": 60}` while the code default is 300 and `CLAUDE.md` says "60-second API cache" — **the docs are internally inconsistent here; 300 is what the code ships.**

### Preset shorthand DSL

`PRESET_CHAR_MAP` maps one char → one widget; `|` separates lines; unknown characters are silently skipped; empty lines are dropped.

```
M model   C context  b contextBar  % contextPercentage  # contextUsage
$ cost    R 5h       7 7d          S 7dSonnet           f 7dFable
P projectInfo  I sessionId  D sessionDuration  J sessionName  K configCounts
T toolActivity A agentStatus g agentMode  O todoProgress  / slashCommand
B burnRate  Q tokenSpeed  E depletionTime  H cacheHit  F performance
N tokenBreakdown  W forecast  U budget  @ todayCost
X codexUsage  G geminiUsage  Z zaiUsage
L linesChanged  Y outputStyle  V version  ? lastPrompt  m vimMode
a apiDuration  p peakHours  t tagStatus
```

Example: `"preset": "MC$R|BDO"` → line 1 `[model, context, cost, rateLimit5h]`, line 2 `[burnRate, sessionDuration, todoProgress]`.

### Display presets (`DISPLAY_PRESETS`)

Additive — each mode keeps earlier widgets in the same position and appends lines.

```
compact  (1 line):  model, context, cost, rateLimit5h, rateLimit7d, rateLimit7dSonnet, rateLimit7dFable, zaiUsage
normal   (2 lines): + projectInfo, sessionId, sessionDuration, burnRate, todoProgress
detailed (6 lines): + line2 gains sessionName, tokenSpeed, depletionTime
                      line3: configCounts, toolActivity, agentStatus, cacheHit, performance
                      line4: tokenBreakdown, forecast, budget, todayCost
                      line5: codexUsage, geminiUsage, linesChanged, outputStyle, version, peakHours
                      line6: lastPrompt, vimMode, apiDuration, tagStatus
```

`zaiUsage` and the `rateLimit*` family are in the same line and are mutually exclusive by provider, so exactly one set renders.

### Setup flow (`commands/setup.md`)

`/claude-dashboard:setup` is a **markdown slash command executed by Claude itself**, not a script — this is the notable design choice. Allowed tools are `Read, Write, Bash(node:*), Bash(cat:*), Bash(mkdir:*), Bash(ls:*), Bash(sort:*), Bash(tail:*), AskUserQuestion`.

- **Direct mode**: `/claude-dashboard:setup <displayMode> <language> <plan> ["line1|line2"]`.
- **Interactive mode** (no args): Claude drives `AskUserQuestion`.
  - Turn 1 batches 4 questions (display mode, language, plan, theme). Each display-mode option carries a `markdown` field containing a **literal ASCII preview of the resulting status line** — the user picks by looking at the output, not by reading widget names.
  - Turn 2 (custom only) builds line-by-line: Step A picks *categories* (4 max, because `AskUserQuestion` allows 4 options), Step B multi-selects widgets within each category (paginated "Cost & Limits (1/2)"), Step C asks "add another line?". A `placed` set is maintained across lines so already-used widgets vanish from later menus, and a category with nothing left is omitted entirely.
  - Turn 3 asks whether to hide widgets → `disabledWidgets`.
- **Registration**: a one-liner globs `$CFGDIR/plugins/cache/claude-dashboard/claude-dashboard/*/dist/index.js`, `sort -V | tail -1` to pick the newest version, then rewrites `settings.json.statusLine = {type:'command', command:'node <path>'}`.
- `/claude-dashboard:update` re-points that path after a plugin upgrade. `/claude-dashboard:setup-alias` writes a `check-ai` shell alias (zsh/bash/PowerShell).

### Caching

Four independent layers.

**1. Config cache** (`statusline.ts`) — parsed config held in-process, invalidated by `stat().mtimeMs`.

**2. In-memory API cache** — `Map<tokenHash, CacheEntry<T>>` per client. `CacheEntry` is a discriminated union: `{data:T, timestamp, isError?:false} | {data:null, timestamp, isError:true}`. Error entries expire after `NEGATIVE_CACHE_SECONDS = 30` regardless of the configured TTL, so a transient failure doesn't lock out a good response for 5 minutes but also doesn't cause a retry storm.

**3. Cross-process file cache** (`utils/file-cache.ts`) — `~/.cache/claude-dashboard/`, dir mode `0o700`, files `0o600`. Filenames: `cache-{tokenHash}.json` (Anthropic), `codex-usage-{hash}.json`, `gemini-usage-{hash}.json`, `zai-usage-{hash}.json`, plus `codex-model-cache.json` and `budget.json`. `tokenHash` = first 16 hex chars of SHA-256 of the OAuth token, which is what gives free multi-account isolation. No locking — "first writer wins, concurrent writes are idempotent". Its stated purpose: narrow the stampede window from *every cache miss* to *the first cache miss per TTL window across all processes*, so a user with 6 terminals open doesn't pay 6× the API cost on restart.

**4. The 1-hour layer.** `STALE_CACHE_TTL_SECONDS = 3600` and `CACHE_CLEANUP_AGE_SECONDS = 3600` are the two "1 hour" constants:
- *Stale-while-error*: when a live fetch fails and the negative cache is set, the client falls back to reading the file cache with a **3600 s** TTL instead of the configured one — so the status line keeps showing the last-known-good rate limits for up to an hour rather than flashing ⚠️.
- *Cleanup*: `cleanupExpiredCache()` sweeps `~/.cache/claude-dashboard/` and unlinks any `.json` whose filename starts with one of `CLEANABLE_PREFIXES` (`cache-`, `codex-usage-`, `gemini-usage-`, `zai-usage-`) and whose mtime is older than 3600 s. Files outside those prefixes (e.g. `codex-model-cache.json`, `budget.json`) are deliberately left alone. The sweep is fire-and-forget after every `saveFileCache`, throttled in-process to once per `CLEANUP_INTERVAL_MS = 3_600_000`.

**5. Request deduplication** — `pendingRequests: Map<key, Promise>` in every client. Concurrent callers with the same token hash share one in-flight promise.

**6. Widget-local module caches** — `projectInfo` 5 s, `linesChanged` 10 s, `configCounts` 30 s, `tagStatus` 30 s, Gemini project id 5 min, macOS Keychain 10 s (with a 60 s backoff after a failure so macOS doesn't repeatedly prompt), Codex `codex exec` model probe 5 min negative backoff.

**7. Incremental transcript parsing** — `utils/transcript-parser.ts` caches `{path, size, data}` and, when the file has only grown, `open()`s at the previous byte offset and parses only the delta into the existing `ParsedTranscript`. A full re-parse happens only on first load or when the file shrank (truncation). Running tools, agents, tasks and the last `TodoWrite` are maintained incrementally in `processEntries()` so every extractor is O(1)–O(k), not O(file).

### How rate limits are actually read — the important bit

`statusline.ts` runs a three-branch strategy:

```
stdinLimits = parseStdinRateLimits(stdin)      // stdin.rate_limits.{five_hour,seven_day}
                                               // epoch seconds → ISO string
if (!stdinLimits)          rateLimits = await fetchUsageLimits(ttl)          // full API fallback
else if (plan === 'max')   rateLimits = { ...stdinLimits,
                                          seven_day_sonnet: api?.seven_day_sonnet ?? null,
                                          seven_day_fable:  api?.seven_day_fable  ?? null }
else                       rateLimits = stdinLimits                          // no network at all
```

So **Pro users on a recent Claude Code never make a network call** — Claude Code itself now hands the 5 h and 7 d windows to the status line. The API is only needed for (a) older Claude Code / before the first API response of a session, and (b) Max-only model-scoped weekly buckets.

The API call itself (`utils/api-client.ts`):

- `GET https://api.anthropic.com/api/oauth/usage`
- Headers: `Accept: application/json`, `Content-Type: application/json`, `User-Agent: claude-dashboard/{VERSION}`, `Authorization: Bearer {oauthAccessToken}`, `anthropic-beta: oauth-2025-04-20`
- 5 s `AbortController` timeout.
- Token source: macOS Keychain `security find-generic-password -s "Claude Code-credentials" -w` → JSON → `claudeAiOauth.accessToken`; elsewhere `${CLAUDE_CONFIG_DIR|~/.claude}/.credentials.json` → same path.
- **429 handling**: reads `retry-after`; retries exactly once if `retry-after * 1000 <= 10000`, otherwise gives up.
- **403 handling**: falls back to spawning `curl` as a subprocess with the same headers. The comment explains why — Node 20+ on Linux gets 403 from this endpoint because undici's TLS fingerprint differs from curl/wget/Python. This is a real, non-obvious portability landmine for anyone re-implementing this in Node.
- Response parsing: flat fields `five_hour`, `seven_day`, `seven_day_sonnet` each validated to `{utilization:number, resets_at:string|null}`; `seven_day_fable` extracted from the generic `limits[]` array by `{kind:'weekly_scoped', scope.model.display_name:'Fable'}` where the percentage key is `percent`, not `utilization`.

This endpoint is **undocumented and unversioned** apart from the `anthropic-beta: oauth-2025-04-20` opt-in header. Treat it as unstable.

---

## Architecture

**Entry point.** `settings.json.statusLine = {type:'command', command:'node .../dist/index.js'}`. Claude Code spawns that process on every turn, pipes a JSON blob on stdin, and prints stdout verbatim. A single bundled ESM file, no dependencies, cold-started per render — which is exactly why every layer of this codebase is about caching.

**Widget contract** (`scripts/widgets/base.ts`):

```ts
interface Widget<T extends WidgetData = WidgetData> {
  readonly id: WidgetId;
  readonly name: string;
  getData(ctx: WidgetContext): Promise<T | null>;   // null ⇒ widget disappears
  render(data: T, ctx: WidgetContext): string;      // pure, sync
}
```

`WidgetContext = { stdin, config, translations, rateLimits }`. The strict getData/render split is what makes 42 widgets testable — `widgets.test.ts` is 92 KB of pure-function assertions.

**Orchestration** (`scripts/widgets/index.ts`): a `Map<WidgetId, Widget>` registry; `getLines(config)` resolves preset → lines and filters `disabledWidgets`, dropping lines that become empty; each line renders its widgets with `Promise.all` (so a git call and an API call overlap); each `renderWidget` is individually try/caught — a throwing widget is `debugLog`ged and skipped. Empty outputs are filtered before joining with the separator; empty lines are filtered before joining with `\n`.

**Error philosophy** — three tiers: (1) widget returns `null` → silently absent; (2) widget throws → caught in `renderWidget`, skipped; (3) `main()` throws → prints a lone `⚠️`. Only `rateLimit5h` deliberately surfaces `{isError:true}`, so an API outage produces one warning glyph, not four.

### Data flow

```
                     Claude Code turn
                            │  spawns: node dist/index.js
                            ▼
                    ┌───────────────┐
   stdin JSON ─────▶│  statusline   │
   (model, context, │     .ts       │
    cost, rate_     └───┬───────┬───┘
    limits, vim,        │       │
    agent, worktree,    │       │ loadConfig()  ~/.claude/claude-dashboard.local.json
    session_id,         │       │              (mtime-cached, preset→lines)
    transcript_path,    │       │
    version, ...)       │       └──▶ setTheme() / setSeparatorStyle() / getTranslations()
                        │
                        │ rate limits: stdin first, API only if missing or plan=max
                        ▼
              ┌──────────────────────┐
              │  formatOutput(ctx)   │
              └──────────┬───────────┘
                         │  per line: Promise.all(widgets)
      ┌──────────────────┼─────────────────────────────────────┐
      ▼                  ▼                 ▼                   ▼
 ┌─────────┐      ┌─────────────┐   ┌────────────┐     ┌──────────────┐
 │ stdin-  │      │ transcript  │   │ filesystem │     │ network      │
 │ only    │      │ .jsonl      │   │  + git     │     │ clients      │
 │ widgets │      │ (incr.      │   │            │     │              │
 │         │      │  byte-      │   │ settings   │     │ anthropic    │
 │ cost    │      │  offset     │   │ .json      │     │ oauth/usage  │
 │ context │      │  parse)     │   │ .claude    │     │ chatgpt wham │
 │ vimMode │      │             │   │  .json     │     │ cloudcode-pa │
 │ version │      │ toolActivity│   │ mcp.json   │     │ z.ai quota   │
 │ token   │      │ agentStatus │   │ rules/     │     └──────┬───────┘
 │  Speed  │      │ todoProgress│   │ hooks/     │            │
 │ apiDur  │      │ sessionName │   │ agents/    │      ┌─────▼──────────────────┐
 │ cacheHit│      │ slashCommand│   │            │      │ mem Map<tokenHash>     │
 │ tokenBrk│      └─────────────┘   │ git: branch│      │  ├ 30 s negative cache │
 └─────────┘                        │  ahead/beh │      │  └ ttlSeconds (300)    │
      │           ┌──────────────┐  │  shortstat │      ├────────────────────────┤
      │           │ ~/.cache/    │  │  describe  │      │ ~/.cache/claude-       │
      │           │ claude-      │  │  rev-list  │      │  dashboard/cache-*.json│
      │           │ dashboard/   │  │ (5/10/30 s │      │  (cross-process,       │
      │           │  sessions/   │  │  caches)   │      │   3600 s stale-        │
      │           │  budget.json │  └────────────┘      │   fallback, hourly GC) │
      │           └──────────────┘                      └────────────────────────┘
      │                  │                  │                     │
      └──────────────────┴──────────────────┴─────────────────────┘
                         │  each widget: getData() → T | null
                         ▼
                    render(data, ctx) → ANSI string
                         │  join(separator) per line, join('\n')
                         ▼
                   stdout → terminal status line
```

The `check-usage` entry point (`scripts/check-usage.ts` → `dist/check-usage.js`) reuses the same four clients with a fixed 60 s TTL, fans them out with `Promise.all`, and renders either a boxed ANSI report or `--json`. Its `calculateRecommendation()` collects every CLI's 5-hour percentage into `candidates[]`, sorts ascending, and names the lowest as the CLI to use next (Claude is excluded when the z.ai provider is active).

---

## Notable code worth stealing

Difficulty is rated for porting into **React 18 + Express, plain ESM, no TypeScript**.

| File | What it does | Why it's good | Port difficulty |
|---|---|---|---|
| `scripts/utils/api-client.ts` | Anthropic OAuth usage client: credential lookup, SHA-256 token-hash cache key, memory → file → network tiers, 30 s negative cache, 3600 s stale-while-error fallback, single 429 retry gated on `retry-after ≤ 10 s`, **curl subprocess fallback on 403** | This is the single piece of functionality Loush cannot currently produce at all, and it is written defensively enough to survive an unstable undocumented endpoint. The 403/TLS-fingerprint fallback in particular is knowledge you only get by shipping. | **Medium.** Strip types, drop `~35` lines. It's already Node built-ins only. Lives naturally as `server/rateLimits.mjs` with an Express route. Main risk is that the endpoint is undocumented and may change. |
| `scripts/utils/credentials.ts` | macOS Keychain (`security find-generic-password -s "Claude Code-credentials" -w`) with 10 s TTL cache and a **60 s backoff after failure so macOS stops re-prompting**; Linux/Windows `.credentials.json` with `(path, mtime)` cache | The 60 s keychain backoff is a UX detail nobody thinks of until users complain about permission dialogs. `(path, mtime)` rather than `mtime` alone is correct for `CLAUDE_CONFIG_DIR` switching. | **Easy.** ~90 lines, mechanical de-typing. Server-side only. Handle the token as a secret — never send it to the browser. |
| `scripts/utils/file-cache.ts` | Generic cross-process file cache: `{data, timestamp}` envelope, 0700/0600 modes, prefix-allowlisted hourly GC throttled in-process | Lockless, tiny, correct. Solves the N-terminals-stampede problem with about 100 lines and no dependency. | **Easy.** Drops straight into `server/` as a shared cache primitive for anything we currently recompute per request. |
| `scripts/utils/budget.ts` | Daily cost ledger with **per-session delta accumulation** (`delta = max(0, sessionCost - lastSeen)`), UTC date rollover, zero-cost session skipping, concurrent-call dedup via a shared promise | The delta ledger is the correct answer to "aggregate today's spend across sessions without rescanning every transcript". ~60 lines. Directly enables budget alerts. | **Easy.** Becomes `server/budget.mjs` + a `dailyBudget` field in our settings. |
| `scripts/utils/transcript-parser.ts` | Incremental JSONL parse by byte offset; O(1) extractors for running tools / active agents / task+todo progress / active slash command; `extractToolTarget()`; `normalizeTaskStatus()`; Tasks-API-with-TodoWrite-fallback; `<command-name>` detection with the two false-clear guards | This is the most battle-tested transcript reader in the ecosystem — 36 KB of tests behind it. The slash-command state machine (don't clear on `tool_result`-only entries; don't clear on `<local-command-stdout>`) is exactly the kind of bug we would ship and then spend a day on. | **Medium.** Our server already reads `~/.claude/projects/**/*.jsonl`; the byte-offset incrementality and the extractors are the parts to lift. Watch out: their cache is a single-file singleton, ours must be keyed per project/session. |
| `scripts/utils/history-parser.ts` | Reads the **last 16 KB** of `~/.claude/history.jsonl`, reverse-scans for a session's most recent `display` entry, expands `[Pasted text #N]` from `pastedContents`, caches by `(path, fileSize)` | Points at a data source we may not be using at all: `history.jsonl` is the record of *actual typed user input*, free of skill expansions and tool noise. Tail-reading a fixed window instead of the whole file is the right shape for a hot path. | **Easy.** ~100 lines. Feeds PromptStudio / PromptQuality with a much cleaner prompt corpus. |
| `scripts/widgets/peak-hours.ts` | Pacific-time peak-window detection using only `Intl.DateTimeFormat(...).formatToParts` + weekday arithmetic including Fri/Sat/Sun→Mon | Zero dependencies, zero network, correct across DST, ~80 lines total. | **Easy.** Pure function; works unchanged in the browser. |
| `scripts/widgets/project-info.ts` | Four git subprocesses in one `Promise.all` behind a 5 s cwd-keyed cache; `normalizeGitUrl()` SSH→HTTPS; OSC8 hyperlink helper | The combined cache is the point — naive implementations spawn 4 processes per render. `normalizeGitUrl` handles `git@host:path`, `ssh://git@host/path` and `https://user:token@host/path.git` in two regexes. | **Easy.** `execGit` uses `git --no-optional-locks`, which is the right flag for a read-only observer and easy to forget. |
| `scripts/widgets/tag-status.ts` + `lines-changed.ts` | `describe --tags --abbrev=0 --match <glob> HEAD` then `rev-list --count tag..HEAD`; `diff HEAD --shortstat` plus untracked-file line counting | "Commits since last release tag" and "uncommitted lines including new files" are two Delivery metrics we can add for ~80 lines. Caching `null` on failure (empty repo, no HEAD) avoids retry loops. | **Easy**, except `countUntrackedLines` uses `sh -c … xargs … wc -l` — on Windows that must be reimplemented in Node (`ls-files --others -z` → read files → count `\n`). |
| `scripts/widgets/index.ts` + `base.ts` + `types.ts` `PRESET_CHAR_MAP`/`parsePreset` | The whole widget-registry pattern: id → `{getData, render}`, per-widget try/catch, `Promise.all` per line, `disabledWidgets` filter, `lines` composition, single-char preset DSL | This is the reference design for a user-configurable Overview grid. `getData` returning `null` as the universal "hide me" is a very clean contract. | **Medium.** In React this becomes `{id, name, useData(), Render}` in a registry module, driven by a persisted `lines`/`disabledWidgets` config. The preset DSL is a fun power-user feature but optional. |
| `scripts/utils/colors.ts` | 9 themes × 18 semantic roles, singleton `getTheme()`, `getColorForPercent()` 50/80 thresholds | The **semantic role vocabulary** (`model / folder / branch / safe / warning / danger / secondary / accent / info / barFilled / barEmpty`) is the transferable asset, not the ANSI codes. Port it as CSS custom properties. | **Easy.** Nine ready-made, correctly-sourced palettes → `:root[data-theme=...]` blocks. Hex values are all in this document. |
| `scripts/utils/formatters.ts` | `formatTokens` (1.5K / 150K / 1.5M with a ≥10 switch from 1-decimal to rounded), `formatCost`, `formatTimeRemaining` (`3d2h` / `2h30m` / `45m`), `formatDuration`, `shortenModelName`, `clampPercent`, `truncate`, `osc8Link` | Boring and exactly right. The `value >= 10 ? round : toFixed(1)` rule is why their numbers never jitter between `9.9K` and `10.0K`. | **Easy.** Copy nearly verbatim into `src/lib/`. |
| `scripts/utils/emoji.ts` | Single `ICON` map with mandatory U+FE0F, documented exclusion list for `Emoji=No` symbols, plus a registry-invariant test (`emoji.test.ts`) | Not applicable to a web UI's rendering, but the *pattern* — one icon module plus a test asserting every entry conforms — is worth mirroring. | N/A (terminal-specific). |
| `commands/setup.md` | Setup as a Claude-executed markdown command with `AskUserQuestion`, ASCII previews per option, category-paginated multi-select, and a `placed` set that removes already-used widgets from later menus | A genuinely clever configuration UX. The ASCII preview per option ("pick by what it looks like") is directly translatable to a live-preview panel in our Customize section. | **Medium** as a UI concept; the markdown-command mechanism itself doesn't apply to a web app. |

---

## Gaps and weaknesses

**Correctness / honesty**

- `depletionTime` assumes 100 % of the 5-hour window's utilization came from the current session. With two terminals open, or a session started mid-window, the number is simply wrong. The source says so; the status line does not. It also hard-codes `limitType: '5h'` while the type advertises `'5h' | '7d'` — the 7-day branch is unreachable dead code.
- `performance`'s `0.6 × cacheHit + 0.4 × outputRatio` is an arbitrary composite with no stated justification. A high output ratio is not obviously "efficient". The widget also fetches `elapsedMinutes`, null-checks it, and then never uses it.
- `budget.js` rolls the day over on **UTC** (`new Date().toISOString().slice(0,10)`) while the user's spending day is local. Users west of UTC will see the budget reset mid-afternoon.
- `cacheHit` excludes output tokens from its denominator while `performance` includes them in its `outputRatio` denominator — two adjacent widgets using two different totals.

**Security / supply chain**

- `scripts/utils/gemini-client.ts` hard-codes an OAuth `client_id` **and `client_secret`** (lines 39–40). These are the public gemini-cli client credentials, so this is not a credential leak in the classic sense, but embedding a literal `GOCSPX-…` string in a public repo is a pattern we should not copy, and it will trip secret scanners.
- The core value proposition depends on `https://api.anthropic.com/api/oauth/usage`, which is **undocumented, unversioned, and gated behind a beta header**. There is no contract; Anthropic can change or remove it without notice. The `seven_day_sonnet` field already went `null` once (~2026-06). Anyone porting this inherits that fragility.
- **Policy risk on that endpoint — read this before porting it.** Anthropic's February 2026 consumer-terms update states that using Free/Pro/Max OAuth credentials "in any other product, tool, or service — including the Agent SDK" violates the Consumer ToS, and server-side enforcement shipped in January 2026 returning *"This credential is only authorized for use with Claude Code…"*. claude-dashboard reads a consumer OAuth token out of Claude Code's Keychain entry / `.credentials.json` and calls the API from a **separate process** under `User-Agent: claude-dashboard/{VERSION}`. Whether a read-only usage query issued by a Claude Code *plugin* is inside or outside that wording is genuinely unresolved — a GitHub code search for the endpoint + beta header returns ~3,200 hits across the ecosystem (ccseva, claudeline, ClaudeCodeStatusLine, claude-meter, ccmeter, ccburn, claudemon, xbar-plugins …), and no project has been publicly reported as revoked. But no one has obtained a clear answer either, and I found zero public ToS discussion of this specific case. Two consequences for us: (a) this is an accepted-risk decision, not a technical one; (b) a Loush web dashboard is a *further* step removed from "inside Claude Code" than a status-line plugin is.
- Relatedly: the honest `User-Agent` costs them quota. `anthropics/claude-code` issue #31637 documents that this endpoint aggressively 429s and that `User-Agent: claude-code/<version>` is what lands you in the generous bucket. The issue was **closed as "not planned" with no Anthropic engagement**. claude-dashboard's own troubleshooting docs tell users to "wait 60 seconds for cache refresh" — that is this problem.
- The 403→`curl` fallback silently shells out to whatever `curl` is on `PATH`, passing a bearer token on the argv (visible in `ps` on multi-user machines).
- `fileCachePath()` explicitly documents that it does **not** sanitise against `../` traversal and relies on callers using template strings. That's fine here, but it's a sharp edge to carry across.

**Portability**

- `countUntrackedLines()` requires `sh`, `xargs`, `cat`, `wc`. On stock Windows it fails and silently returns 0, so `linesChanged` undercounts. README claims Windows support without qualification.
- Keychain path assumes one Claude Code entry. The README itself admits that with `CLAUDE_CONFIG_DIR` multi-account on macOS, "rate-limit API calls use whichever OAuth token the Keychain holds" — i.e. multi-account is only partly supported on macOS.

**Docs / project hygiene**

- `CLAUDE.md` line 83 points at `docs/ENGINEERING_HANDBOOK.md`, and ~40 source files carry `@handbook X.Y` markers referencing its sections. **That file is not in the repository** (there is no `docs/` directory; `.gitignore` excludes `.private/`). Every handbook cross-reference in the published source is a dangling pointer.
- `CLAUDE.md` and parts of the README are written in Korean while the rest is English.
- Cache TTL is documented three ways: README example `60`, `CLAUDE.md` prose "60-second API cache", code default `300`.
- `CLAUDE.md`'s widget list and `DISPLAY_PRESETS` snippet are stale relative to `types.ts` (missing `rateLimit7dFable` in the presets block).
- Bus factor 1: 382 of 391 commits are from one author.

**Scope**

- It is a status line. There is no history, no trend, no cross-session comparison, no charts, no drill-down — by design. Every widget is "right now". Any question of the form "how did this change over the last week" is out of scope, which is precisely the space a web dashboard occupies.

---

## Overlap with Loush Dashboard

Loush facts below were verified against `E:\AI-Dashboard` source, not assumed.

Headline: **we already cover ~70 % of their widget surface, usually with more depth. The uncovered 30 % is where the value is** — and it clusters in exactly three places: subscription rate limits (we have no equivalent data source at all), `history.jsonl` as a prompt corpus (we never open the file), and live per-turn attribution (slash command, agent identity, api-time share).

| Their widget | Our equivalent section (or NONE) | Who does it better | Note |
|---|---|---|---|
| `rateLimit5h` / `rateLimit7d` / `rateLimit7dFable` | **NONE** | **Them, uncontested** | Verified: no `oauth/usage`, no `rate_limit`, no `five_hour`/`seven_day`, no `anthropic-beta` anywhere in our repo. Our only "5-hour block" (`server/index.mjs:727-740`) is *inferred from transcript timestamps* — it is a billing-window bucket, not a quota reading. We literally cannot answer "how much of my Max plan is left". |
| `depletionTime` | **NONE** | Them | Needs rate limits first; meaningless without them. |
| `apiDuration` | **NONE** | Them | We have session duration and tool counts but never compute API-wait share. Cheap, diagnostic ("API-bound vs tool-bound"). |
| `tokenSpeed` | **NONE** | Them | tok/s over *API* time. We have output tokens and duration in `collectUsage()` but never divide them. |
| `tagStatus` | **NONE** | Them | Confirmed: no `git tag`, no `git describe` anywhere in our repo despite very extensive git use (worktrees, blame, bisect, merge). "Commits since last release tag" is a Delivery metric we're missing. |
| `peakHours` | **NONE** | Them | Zero-cost, zero-network heuristic. |
| `sessionName` | **NONE** | Them | We never read the transcript `customTitle` field, so `/rename`d sessions show as raw ids in `SessionsSection`. |
| `agentMode` | **NONE** | Them | `stdin.agent.name` / `agent_type` are status-line-only inputs; the transcript equivalent would need finding. |
| `model` effort level / fast mode | Partial — `HarnessSection` (model routing), `SessionsSection` (model column) | Them for effort/fast | We read `~/.claude/settings.json` already (`server/index.mjs:329`) but never surface `effortLevel` / `fastMode`. One-line addition to Harness. |
| `outputStyle`, `version`, `vimMode` | **NONE** | Them (trivially) / N/A for vimMode | `version` is worth having — it pins which Claude Code produced a session. |
| `codexUsage` / `geminiUsage` / `zaiUsage` / `check-usage` | **NONE** | Them | Confirmed zero references to codex/gemini/z.ai/openai in our source. Their genuine differentiator vs the whole statusline field. Conflicts with our Claude-only scope — a deliberate choice, not a gap. |
| `lastPrompt` | `InsightsSection`, `PromptStudio`, `PromptQuality` — but sourced from `~/.claude/projects/**/*.jsonl` | **Us on analysis, them on source** | We never open `~/.claude/history.jsonl` (verified: zero references). That file holds *only genuine typed user input* — no skill expansions, no `<command-name>` injections, no tool results. Our duplicate-prompt jaccard in `InsightsSection` and our 8-dimension `PromptQuality` rating are both running on a dirtier corpus than necessary. |
| `slashCommand` | `FlowSection` ("Observed flow" from transcripts) | **Them on precision** | We show prompt→skill/command/agent flow, but they have an explicit per-turn state machine with the two false-clear guards (`tool_result`-only entries; `<local-command-stdout>` injections). Our Flow almost certainly mis-attributes turns for the same reasons. |
| `todoProgress` | `PlanGraph`, `ActivityTimeline` | **Us on display, them on parsing** | They handle the **new Tasks API** (`TaskCreate`/`TaskUpdate`, applied only on `tool_result`) with `TodoWrite` fallback and a `normalizeTaskStatus()` mapping `not_started/running/complete/done`. If we only read `TodoWrite`, newer sessions show nothing. |
| `toolActivity` | `ChatSection`, `ActivityTimeline`, `ForensicsSection` | **Us historically, them live** | Their `extractToolTarget()` (Read/Write/Edit→basename, Glob/Grep→pattern, Bash→command) is a nice label helper we can lift. Their incremental byte-offset parse is the technique we should copy into `collectUsage()`/`scanTranscripts()`. |
| `agentStatus` | `ChatSection` (subagent nesting via `toolUseId`), `PlanGraph` | **Us** | We link subagents into a tree; they count them. |
| `context` / `contextBar` / `contextPercentage` / `contextUsage` | `ContextExplorerSection`, `UsagePanel` (context efficiency) | **Us, clearly** | Our per-turn occupancy replay (fresh vs cache-read vs compaction, `in + cc + cr` as prompt size) is strictly more than a single bar. One thing to steal: they prefer Claude Code's **official** `used_percentage` over their own computation when present. |
| `cacheHit` | `UsagePanel` (cache efficiency), `SessionsSection` (cache-read %) | **Us** | Worth aligning on their exact denominator — `cache_read / (cache_read + input + cache_creation)`, output excluded. |
| `tokenBreakdown` | `UsagePanel`, `ContextExplorerSection` | **Us** | We have the same four counters and can chart them. |
| `burnRate` | `UsagePanel` (trends), `lib/harness-usage-trends.mjs` | **Us** | Ours is trend-aware; theirs is a session average. |
| `performance` (composite badge) | `UsagePanel` harness-health grade, `lib/harness-health.mjs` | **Us** | Ours is a graded multi-factor health score with strict null discipline. Theirs is an undefended `0.6·cacheHit + 0.4·outputRatio`. Their idea worth keeping is the *single glanceable tile*. |
| `forecast` (hourly $) | `UsagePanel` month-end projection (`projectMonthEnd`, `lib/harness-usage-trends.mjs`) | **Us on horizon, them on immediacy** | We project to month-end with a confidence level; we have no "$/h right now". Both are useful and they're ~5 lines apart. |
| `budget` / `todayCost` | `costAlerts()` (`server/index.mjs:1988`) reading `harness.budgets.dailyUSD` from `~/.claude/settings.json`; sidebar chip in `App.jsx:231-269`; `/api/gov/costs` | **Roughly even, different mechanism** | We already have daily caps with 80 %/100 % thresholds. **Their delta ledger (`utils/budget.ts`) is the better mechanism** for a per-render hot path; ours recomputes from transcripts each time, which is fine server-side but means our daily total inherits our pricing approximation. |
| `cost` | `SessionsSection` (real $ per session), `UsagePanel`, `/api/gov/costs` | **Them on accuracy, us on everything else** | Uncomfortable finding: they read Claude Code's own authoritative `cost.total_cost_usd`. We *derive* cost from `PRICE_PER_M` (`server/index.mjs:718`) — a three-bucket regex (`opus\|fable`→$15, `haiku`→$0.8, else $3) with global cache multipliers (`entryCost`, `:1987`) commented as "anthropic-ish". Every dollar figure in Loush is an approximation; theirs is exact. |
| `projectInfo` | `ProjectsSection`, `SessionsSection` (branch from transcript `gitBranch`) | **Us on breadth, them on freshness** | We read branch from the transcript field, not from git — correct for historical rows, stale for "what am I on right now". Their 4-call-in-one 5 s git cache and `normalizeGitUrl()` SSH→HTTPS are both liftable. |
| `linesChanged` | `WorkingSet` / `server/fe.mjs` (from `structuredPatch`), `git status --porcelain` at `fe.mjs:365` | **Different questions, both right** | Ours = *lines the agent edited* (deliberate: "git only kept the attempt that survived"). Theirs = *uncommitted diff incl. untracked files*. We don't currently show the second one, and "how big is the pile I haven't committed" is a legitimate WorkingSet column. |
| `configCounts` | `CustomizeSection`, `McpSection`, `HooksSection`, `CapabilityLedger` | **Us, by a wide margin** | They count CLAUDE.md/AGENTS.md/rules/MCPs/hooks; we enumerate each item, price it in always-on tokens, score its ROI, and can toggle it off for real. Worth stealing: their **three-location MCP merge** (`./.claude/mcp.json` + `~/.claude.json` or `$CLAUDE_CONFIG_DIR/.claude.json` + `~/.config/claude-code/mcp.json`) — we read `~/.claude.json` and project scope, so the XDG path may be a blind spot. |
| `sessionId` / `sessionIdFull` / `sessionDuration` | `SessionsSection` | **Us** | We already key everything by session and show duration. |
| Themes (9) | `src/styles.css` + `useTheme()` in `App.jsx:274-285` | **Us on architecture, them on catalogue** | We have a disciplined CSS-variable token system (`--green/--red/--amber/--blue/--violet/--orange/--pink`, each with `-solid`/`-bg`) with a no-raw-hex rule and anti-FOUC bootstrapping — but exactly **two** themes, `dark` and `light`. They ship 9 named palettes. Their palettes drop straight into our existing token slots. |
| Widget layout / preset DSL | `CustomizeSection` — **but that toggles Claude Code capabilities, not dashboard layout** | **Them, uncontested** | Verified: no widget registry, no layout persistence, no grid config in Loush. Section order is a hardcoded `BASE_SECTIONS` array (`App.jsx:50-206`); the only `widget` in our tree is `src/ui/planWidgets.jsx` (per-tool param renderers, unrelated). Their `{id, getData, render}` registry + `lines[][]` + `disabledWidgets` is the reference design for a configurable Overview. |
| Multi-account (`CLAUDE_CONFIG_DIR`) | **NONE** | Them | Every one of our `~/.claude` reads is hardcoded to `homedir()`. Their `getClaudeConfigDir()` / `getClaudeJsonPath()` pair is 30 lines and would make us multi-account-correct. |

---

## Recommended adoptions

Ranked by (value to Loush) ÷ (effort), with the ToS caveat priced in.

### 1. `history.jsonl` as the clean prompt corpus — **S**

- **Take:** `scripts/utils/history-parser.ts` wholesale — tail-read the last 16 KB, reverse-scan by `sessionId`, expand `[Pasted text #N]` from `pastedContents`, cache by `(path, fileSize)`. Generalise it from "last prompt" to "all prompts for a session/project".
- **Lands in:** new `server/history.mjs`; consumed by `InsightsSection` (duplicate-prompt jaccard), `PromptQuality` (`server/promptcheck.mjs`), `PromptStudio`, and `SessionsSection` (a "last prompt" preview column).
- **Unlocks:** every prompt-quality number we publish stops being contaminated by skill expansions, `<command-name>` tags and tool results. This is the single cheapest accuracy win available. Also add `getClaudeConfigDir()` at the same time so it's multi-account-correct from day one.

### 2. Transcript-parser hardening: incremental parse + Tasks API + slash-command attribution — **M**

- **Take:** from `scripts/utils/transcript-parser.ts` — (a) byte-offset incremental parsing, (b) `extractTodoOrTaskProgress()` with the `TaskCreate`/`TaskUpdate`-applied-on-`tool_result` machine and `normalizeTaskStatus()`, (c) the `<command-name>` state machine including *both* false-clear guards, (d) `extractToolTarget()`.
- **Lands in:** `server/index.mjs` (`collectUsage` `:657`, `scanTranscripts` `:2299`, `readTranscript` `:877`), feeding `FlowSection`, `PlanGraph`, `ActivityTimeline`, `ChatSection`, `WorkingSet`.
- **Unlocks:** correct todo/task progress on modern sessions (we may be blind to the Tasks API entirely), correct per-turn skill/command attribution in Flow, and a cheaper hot path — our per-file mtime+size caches still re-parse a whole file when one line is appended.

### 3. Cross-process file cache + negative caching + request dedup — **S**

- **Take:** `scripts/utils/file-cache.ts` (≈100 lines) plus the `CacheEntry` discriminated union, `NEGATIVE_CACHE_SECONDS = 30`, `STALE_CACHE_TTL_SECONDS = 3600` stale-while-error, and the `pendingRequests: Map<key, Promise>` dedup pattern.
- **Lands in:** new `server/lib/file-cache.mjs`; wired behind the `respCache` middleware (`server/index.mjs:102-121`) and the `engSnap`/`ciCache` snapshot caches (`:2625`, `:3817`).
- **Unlocks:** our caches die with the process and `engSnap` has a 90 s cold-start wait; a `{data, timestamp}` file envelope survives restarts. Negative caching + stale-while-error is exactly what our JIRA/`gh` snapshot path needs — right now a `gh` failure blanks the Delivery section instead of showing the last good snapshot.

### 4. Anthropic subscription rate limits — **M** *(gated on a policy decision, not a technical one)*

- **Take:** `scripts/utils/api-client.ts` + `scripts/utils/credentials.ts` — token from Keychain/`.credentials.json`, SHA-256 token-hash cache key, `GET /api/oauth/usage` with `anthropic-beta: oauth-2025-04-20`, 5 s timeout, single 429 retry gated on `retry-after ≤ 10 s`, **curl fallback on 403** (the Node/undici TLS-fingerprint issue), flat-field parsing plus `findWeeklyScopedLimit(limits[], 'Fable')`.
- **Lands in:** new `server/ratelimits.mjs` → `/api/limits`; tiles in `Overview.jsx` and `UsagePanel.jsx`; a sidebar chip next to the existing budget chip in `App.jsx:231-269`.
- **Unlocks:** the one question Loush currently cannot answer — "how much of my plan is left, and when does it reset" — plus `depletionTime`. It would replace our timestamp-inferred 5-hour block with a real reading.
- **Do not ship this without an explicit decision.** See Gaps: Anthropic's Feb 2026 consumer terms bar using subscription OAuth credentials "in any other product, tool, or service", and this endpoint aggressively 429s non-`claude-code` user agents. ~3,200 repos do it anyway with no reported enforcement. A web dashboard is a weaker "inside Claude Code" claim than a plugin is. **Recommend: build it behind an off-by-default setting with the risk stated in the UI, or defer.** Never send the token to the browser.

### 5. Widget registry + configurable Overview — **L**

- **Take:** the pattern from `scripts/widgets/base.ts` + `index.ts` + `types.ts` — `{id, name, getData → T|null, render}`, per-widget try/catch, `Promise.all` per row, `lines: WidgetId[][]`, `disabledWidgets`, and (optionally) the single-char preset DSL.
- **Lands in:** new `src/lib/widgets/registry.js` + `src/sections/Overview.jsx`; layout persisted through the existing `/api/customize` plumbing (`server/index.mjs:365-500`) so it sits beside `CustomizeSection` rather than duplicating it.
- **Unlocks:** the first genuinely personalizable surface in Loush. Our section list is a hardcoded `BASE_SECTIONS` array; every user sees the same Overview. Their `getData → null ⇒ widget disappears` contract is the cleanest way to make tiles self-hiding when data is absent — which matters a lot for us, since half our tiles depend on JIRA/`gh` being configured.
- Steal the setup UX too: `commands/setup.md` shows each layout option with a **literal ASCII preview of the result**. In a web UI that's a live preview panel, and it is strictly better than a list of widget names.

### 6. Nine theme palettes into our existing tokens — **S**

- **Take:** the hex values from `scripts/utils/colors.ts` (all reproduced in the Themes section above) and the **semantic role vocabulary** (`model / folder / branch / safe / warning / danger / secondary / accent / info / barFilled / barEmpty`).
- **Lands in:** `src/styles.css` as additional `:root[data-theme='catppuccin']` … blocks; `useTheme()` in `App.jsx:274-285` becomes a select instead of a toggle; the `index.html` anti-FOUC script needs no change beyond accepting more values.
- **Unlocks:** 9 themes for roughly the cost of typing. Our token architecture is already the right shape — we're just short of palettes. Note `catppuccinLatte` is the light-mode one and maps onto our existing `light` slot.

### 7. Formatters, `peakHours`, `tagStatus`, `apiDuration`, `tokenSpeed`, hourly `forecast` — **S each, batch them**

- **Take:** `scripts/utils/formatters.ts` (`formatTokens` with the `≥10 ? round : toFixed(1)` anti-jitter rule, `formatCost`, `formatTimeRemaining`, `formatDuration`, `truncate`, `clampPercent`); `widgets/peak-hours.ts` (pure `Intl.DateTimeFormat` Pacific-time logic, no deps); `widgets/tag-status.ts` (`git describe --tags --abbrev=0 --match` + `rev-list --count`); the three one-line metrics.
- **Lands in:** `src/lib/format.mjs` (shared with server); a peak-hours tile in `Overview.jsx`; tag distance in `DeliverySection.jsx`; `apiDuration` + `tokenSpeed` as columns in `SessionsSection.jsx`; `$/h` beside the month-end projection in `UsagePanel.jsx`.
- **Unlocks:** consistent number formatting across the app, our first release-cadence metric (we use git heavily but have **zero** tag integration), and three genuinely diagnostic session columns for ~40 lines total.

### 8. `CLAUDE_CONFIG_DIR` support — **S**

- **Take:** `scripts/utils/config-dir.ts` — `getClaudeConfigDir()` and the subtle `getClaudeJsonPath()` (which moves *inside* the config dir when the env var is set, unlike everything else), plus the practice of putting the resolved path into cache keys so an env switch can't serve another account's data.
- **Lands in:** the `~/.claude` path constants in `server/index.mjs` (`:43`, `:329-331`, `SETTINGS_FILES`, `ALLOWED_ROOTS` at `:124`), `server/memory.mjs`, `server/promptcheck.mjs`.
- **Unlocks:** multi-account users. Every one of our reads is currently hardcoded to `homedir()`. Also fixes a latent cache-poisoning bug we'd hit the moment we added it naively.

### 9. Cost accuracy — **M** *(not their code, but their code exposed it)*

- **Observation, not an adoption:** they show exact dollars because Claude Code hands them `cost.total_cost_usd`. Our `PRICE_PER_M` (`server/index.mjs:718`) is three regex buckets and `entryCost` (`:1987`) uses global cache multipliers self-described as "anthropic-ish". Every $ in Sessions, UsagePanel, CapabilityLedger, `/api/gov/costs` and the budget chip inherits that error.
- **Lands in:** a real per-model pricing table in `lib/`, ideally with cache-write/cache-read rates per model, plus reading any authoritative cost field present in transcript entries before falling back to computation.
- **Unlocks:** the CapabilityLedger ROI verdicts and budget alerts become defensible numbers rather than estimates. Worth doing before we surface cost to anyone but ourselves.

### 10. Multi-CLI (Codex / Gemini / z.ai) — **L, and probably decline**

- **Take (if ever):** `codex-client.ts` (`~/.codex/auth.json` → `chatgpt.com/backend-api/wham/usage`), `gemini-client.ts` (`cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota`), `zai-api-client.ts`, plus `check-usage.ts`'s `calculateRecommendation()`.
- **Assessment:** this is their strongest differentiator against every other statusline project, and it is the thing nobody has written up. It is also a straight contradiction of Loush's Claude-only scope, inherits three more undocumented endpoints, and `gemini-client.ts` carries a hard-coded OAuth `client_secret`. **Recommend declining** unless multi-CLI becomes a product goal — at which point the mutual-exclusion pattern (z.ai active ⇒ all Anthropic limit widgets return `null`) is the design to copy.

---

## Sources

**Primary (all read directly, tarball of `main` @ `fb4e06e`, 2026-07-29)**

- Repo: https://github.com/uppinote20/claude-dashboard
- `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `LICENSE`, `package.json`, `tsconfig.json`, `vitest.config.ts`
- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
- `commands/setup.md`, `commands/check-usage.md`, `commands/update.md`, `commands/setup-alias.md`
- `scripts/statusline.ts`, `scripts/check-usage.ts`, `scripts/types.ts`, `scripts/version.ts`, `scripts/build.js`
- `scripts/widgets/*.ts` (all 35 files)
- `scripts/utils/*.ts` (all 22 files)
- `locales/en.json`, `locales/ko.json`
- `website/src/content/docs/reference/config-schema.md`, `.../reference/widget-reference.md`, `.../guides/themes.md`
- GitHub REST API: `/repos/uppinote20/claude-dashboard`, `/commits`, `/releases`, `/tags`, `/contributors`, `/pulls`

**Referenced by upstream**

- PeakClaude (basis for `peakHours`): https://github.com/pforret/PeakClaude
- Docs site: https://claude-dashboard.uppinote.dev
- OSC8 hyperlink spec cited in `formatters.ts`: https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda

**Third-party coverage — sparse. Read this before assuming social proof.**

Despite 533 stars there is **no Hacker News submission, no findable Reddit thread, no X/Twitter presence, and no English-language blog post or newsletter** covering this project. Visibility comes almost entirely from the author's own Threads account plus auto-generated directory listings.

- https://www.threads.com/@uppinote20/post/DTJZURtEwYT — author's launch post (Korean, Jan 2026): 126 likes, 49 comments, 16.2K views. The largest single piece of organic engagement anywhere.
- https://www.threads.com/@uppinote20/post/DUExSbngML3 — author's v1.4.1 announcement adding the Codex widget; describes reverse-engineering Codex's usage endpoint.
- https://wikidocs.net/342468 — "클로드 코드 사용량 보기: claude-dashboard 플러그인", a chapter in the Korean WikiDocs book *LLM부터 Agent까지*. An install walkthrough. The closest thing to a genuine third-party writeup that exists.
- https://www.openclaw.kr/boards/free/posts/claude-dashboard-h259e — Korean community forum post (2026-02-07, 245 views); essentially a README paraphrase.
- https://github.com/jqueryscript/awesome-claude-code — one auto-generated line entry (line 451).
- https://www.claudepluginhub.com/plugins/uppinote20-claude-dashboard — README-scraped directory listing; no ratings or install counts.
- https://uppinote.dev/ — author's site ("AI Engineer at a semiconductor company by day, indie hacker by night").

**Notable absence.** https://yigitkonur.com/research/claude-code-statuslines-compared is the most thorough survey of this category (~30 projects, three tiers: ccstatusline, claude-powerline, CCometixLine, cship, claude-hud, claudeline in Tier 1). **claude-dashboard is not mentioned once.** Neither is it in Joe Njenga's "I Tested Every Claude Code Statusline Plugin" (Medium, paywalled) nor felipeelias.github.io/2026/03/17/claude-statusline.html nor claudelog.com's ccstatusline page.

⚠️ Search-engine summaries repeatedly attributed **false** facts to this project — "pure bash, no dependencies beyond jq" (it is TypeScript with an esbuild step) and "10 themes, zero API calls" (9 themes, and it does call the Anthropic API). Do not trust aggregator blurbs for this repo.

**On the OAuth usage endpoint (context for adoption #4)**

- https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/202 — best technical writeup of the endpoint; confirms it is undocumented and that `User-Agent: claude-code/<version>` gets the generous rate-limit bucket. Lists independent discoverers. No ToS discussion.
- https://github.com/anthropics/claude-code/issues/31637 and https://github.com/anthropics/claude-code/issues/31021 — "endpoint aggressively rate limits", persistent 429s with no `Retry-After`. #31637 closed as "not planned", no Anthropic engagement.
- https://docs.moltis.org/anthropic-oauth.html — Anthropic OAuth "locked to Claude Code and Claude.ai only"; server-side enforcement from Jan 2026; credentials revocable without notice.
- https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/ — Feb 2026 terms update.
- https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/ and https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use — same policy change.
- https://github.com/agentclientprotocol/claude-agent-acp/issues/337 — an ecosystem project working through the fallout.

**Nothing found (searched, empty)**

Hacker News (multiple queries; the ecosystem has many statusline Show HNs — Claudoro, claudeline, claudedash, ccmeter — but not this one), r/ClaudeAI, r/ClaudeCode, X/Twitter, GeekNews/news.hada.io (the "Show GN: Claude Code Status Bar" post there is a *different* project, `kangraemin/claude-status-bar`), velog/tistory/brunch.
