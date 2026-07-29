# Anthropic official GitHub-native automation

> Research status: COMPLETE. Sections A, B, C and the shared sections are all filled.
> Facts not verified against a primary source are explicitly marked `unverified`.
> Research date: 2026-07-29.

## A. claude-code-action — Identity

| Field | Value | Source |
|---|---|---|
| Repo | https://github.com/anthropics/claude-code-action | GitHub API |
| License | **MIT** (SPDX `MIT`), `LICENSE` at repo root | `license.spdx_id` = `MIT` |
| Description (API) | *null* — the repo has no GitHub description set | API |
| `action.yml` name | "Claude Code Action v1.0" | `action.yml` |
| Created | 2025-05-19 | API |
| Last push | 2026-07-25T01:37:40Z | API |
| Stars / forks | 8,489 / 2,008 | API, 2026-07-29 |
| Open issues+PRs | 640 | API |
| Primary language | TypeScript (runs on **Bun**, not Node) | API + `action.yml` |
| Default branch | `main` | API |
| Latest tag | `v1.0.183` (`be7b93b190`, 2026-07-25) | tags API |
| Latest commit | `be7b93b190` — "chore: bump Claude Code to 2.1.220 and Agent SDK to 0.3.220" | commits API |
| Versioning | Rolling `v1.0.N` patch tags, ~daily. A floating `v1` release exists ("Claude Code GitHub Action v1.0", published 2025-08-26) and is the tag most workflows pin to. There is no `v2`. | releases API |
| Marketplace | Composite action with `branding: { icon: "at-sign", color: "orange" }`, so it is Marketplace-publishable. `homepage` is null; **unverified** whether it is actually listed on GitHub Marketplace (Marketplace page not fetched). | `action.yml` |

Notable identity facts:

- The repo **vendors a second action**: `base-action/` (its own `action.yml`, `LICENSE`,
  `MIRROR_DISCLAIMER.md`). `base-action` is the thin "just run Claude Code" wrapper;
  the root action is the GitHub-aware orchestration layer on top of it.
- A third action lives at `agent-approval-check/` (Python, `agent_approval_check.py`) with
  `agent-identities.example.yaml`.
- Release cadence is tied to Claude Code CLI releases: nearly every tag is
  `chore: bump Claude Code to 2.1.N and Agent SDK to 0.3.N`. **The action version is
  effectively a pointer at a Claude Code CLI version.** That matters for us: if we ingest
  its output we are ingesting a moving target.

### Repo layout (real paths, from `git/trees/main?recursive=1`, 202 files)

```
action.yml                      # root composite action (the one users reference)
base-action/action.yml          # inner "run Claude Code" action
base-action/src/run-claude.ts   # CLI subprocess path
base-action/src/run-claude-sdk.ts # Agent SDK path
base-action/src/execution-file.ts # writes the execution log artifact
src/entrypoints/prepare.ts      # context gathering + trigger check
src/entrypoints/run.ts          # main entrypoint invoked by action.yml
src/entrypoints/collect-inputs.ts
src/entrypoints/format-turns.ts # renders the turn log into markdown
src/entrypoints/update-comment-link.ts
src/entrypoints/post-buffered-inline-comments.ts
src/entrypoints/cleanup-ssh-signing.ts
src/modes/detector.ts           # auto-detects tag vs agent mode
src/modes/tag/index.ts          # @claude-mention mode
src/modes/agent/index.ts        # prompt-driven automation mode
src/github/validation/trigger.ts      # trigger phrase / label / assignee matching
src/github/validation/actor.ts        # human vs bot
src/github/validation/permissions.ts  # write-permission check
src/github/operations/branch.ts       # branch creation
src/github/operations/branch-cleanup.ts
src/github/operations/comment-logic.ts
src/github/operations/comments/create-initial.ts
src/github/operations/comments/update-claude-comment.ts
src/github/operations/comments/update-with-branch.ts
src/github/utils/sanitizer.ts         # strips content before it reaches the model
src/github/utils/actor-filter.ts
src/github/utils/image-downloader.ts
src/mcp/github-comment-server.ts        # MCP: post/update PR-issue comments
src/mcp/github-file-ops-server.ts       # MCP: commit files via API (signed commits)
src/mcp/github-inline-comment-server.ts # MCP: inline review comments
src/mcp/github-actions-server.ts        # MCP: read CI logs/jobs
src/mcp/inline-comment-buffer.ts
src/utils/branch-template.ts
docs/{setup,usage,configuration,custom-automations,security,faq,
      capabilities-and-limitations,cloud-providers,migration-guide,
      experimental,solutions}.md
examples/{claude,claude-wif,ci-failure-auto-fix,issue-triage,
          issue-deduplication,manual-code-analysis,pr-review-comprehensive,
          pr-review-filtered-authors,pr-review-filtered-paths,
          test-failure-analysis,agent-approval-check}.yml
github-app-manifest.json        # the manifest behind /install-github-app
docs/create-app.html            # GitHub App creation helper page
```

## A. The problem it solves

Claude Code is a local terminal tool. The action moves the same agent onto a GitHub runner so
it can be invoked by GitHub events instead of by a human at a keyboard. README framing:
"answer questions and implement code changes" on GitHub PRs and issues.

Concretely it solves four things:

1. **Invocation without a terminal.** A teammate types `@claude fix the flaky test` in a PR
   comment and an agent run happens. No local install, no repo checkout.
2. **Context assembly.** `src/github/data/fetcher.ts` + `formatter.ts` pull the issue/PR body,
   comments, review comments, diff, and changed files, then format them into the prompt. This
   is the bulk of the value — it is a GitHub-context-to-prompt compiler.
3. **A safe write path back into GitHub.** Rather than giving the agent a PAT and hoping, it
   ships four purpose-built MCP servers that expose exactly the GitHub mutations it is
   supposed to be able to make (comment, inline comment, commit files, read CI).
4. **Auth and provider plumbing** for API key / OAuth token / workload identity federation /
   Bedrock / Vertex / Foundry.

What it is explicitly **not**: a review bot with a findings database, a cost dashboard, or a
scheduler. It is stateless per run. Every run's memory of itself is a comment and, optionally,
an execution JSON file on an ephemeral runner. **That statelessness is exactly the gap Loush
fills.**

## A. Trigger and permission model

### Mode auto-detection (`src/modes/detector.ts`, `src/modes/{tag,agent}/index.ts`)

v1 removed the `mode` input. There are two modes, selected automatically:

| Mode | Selected when | Behaviour |
|---|---|---|
| **tag** | No `prompt` input; a trigger phrase / label / assignee matched | Creates a tracking comment, gathers full GitHub context, responds by editing that comment |
| **agent** | `prompt` input is non-empty | Runs the given prompt. **No trigger check at all** — see below. Does not create a tracking comment unless `track_progress: true` |

`track_progress: true` forces tag-mode tracking-comment behaviour on `pull_request`
(opened, synchronize, ready_for_review, reopened) and `issues` (opened, edited, labeled,
assigned) events.

### Trigger matching (`src/github/validation/trigger.ts`, verbatim logic)

The very first branch is decisive:

```ts
// If prompt is provided, always trigger
if (prompt) { return true; }
```

So **supplying `prompt:` bypasses trigger matching entirely.** Beyond that, the checks in
order:

| # | Event | Condition |
|---|---|---|
| 1 | `issues.assigned` | `payload.assignee.login === assignee_trigger` (leading `@` stripped) |
| 2 | `issues.labeled` | `payload.label.name === label_trigger` (exact string equality, default `claude`) |
| 3 | `issues.opened` | trigger phrase in **issue body OR issue title** |
| 4 | `pull_request` | trigger phrase in **PR body OR PR title** |
| 5 | `pull_request_review` (submitted/edited) | trigger phrase in `payload.review.body` |
| 6 | `issue_comment` / `pull_request_review_comment` | trigger phrase in `payload.comment.body` |

The phrase match is **not a substring match**. It is:

```ts
new RegExp(`(^|\\s)${escapeRegExp(triggerPhrase)}([\\s.,!?;:]|$)`, "i")
```

i.e. word-boundary-ish, case-insensitive, requiring whitespace/start before and
whitespace/`.,!?;:`/end after. `@claude,` triggers; `@claudecode` and `email@claude` do not.
The result is written to the step output `contains_trigger`.

**Ingestion note for Loush:** we can reproduce this exact regex client-side to predict/explain
"why didn't Claude fire on this comment?" in the Inbox section. That is a genuinely common
support question and cheap for us to answer.

### Actor / permission gates (`src/github/validation/actor.ts`, `permissions.ts`)

Layered, all must pass:

1. **Human check** — bots are rejected unless the login matches `allowed_bots` (comma list or
   `*`). Default `""` = no bots. Docs warn allowed bots are **not** permission-checked.
2. **Write-permission check** — the triggering actor must have `write` (or admin) on the repo.
   Bypassed only via `allowed_non_write_users`, which itself only works when `github_token` is
   passed explicitly.
3. **Comment filtering** — `include_comments_by_actor` / `exclude_comments_by_actor` control
   which comments enter the *prompt context* (not who can trigger). Exclusion wins.
4. **Sanitization** (`src/github/utils/sanitizer.ts`) — before content reaches the model the
   action strips HTML comments, invisible characters, markdown image alt text, hidden HTML
   attributes, and HTML entities. Docs concede "new bypass techniques may emerge."

### Workflow `permissions:` block required

From `docs/security.md`, the Claude GitHub App (`github.com/apps/claude`) requests:

| Permission | Level | Status |
|---|---|---|
| Contents | Read & Write | **Used** — reading files, creating branches |
| Pull requests | Read & Write | **Used** |
| Issues | Read & Write | **Used** |
| Discussions | Read & Write | Requested, not yet used |
| Actions | Read | Requested, not yet used by the App (but `additional_permissions: actions: read` unlocks the `github_ci` MCP server for the workflow token) |
| Checks | Read | Requested, not yet used |
| Workflows | Read & Write | Requested, not yet used |

At the workflow level the common set is `contents: write`, `pull-requests: write`,
`issues: write`, plus `actions: read` if you want CI-log access and `id-token: write` if you
use workload identity federation or cloud OIDC.

### `pull_request_target` / `workflow_run` guidance

`docs/security.md` is explicit: do **not** check out an untrusted head ref into the workspace
root before the action, because those events run with base-repo secrets. Recommended pattern
is to check out the base ref at the root and the head ref into a subdirectory passed via
`claude_args: "--add-dir pr-head"`.

### Prompt-injection hardening when `allowed_non_write_users` is set

- Best-effort scrub of Anthropic / cloud / GitHub Actions secrets from subprocess envs
  (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, set `0` to opt out)
- On Linux with bubblewrap available, PID-namespace isolation for subprocesses
- `CLAUDE_CODE_SCRIPT_CAPS` JSON caps per-script invocation counts, e.g.
  `{"edit-issue-labels.sh":2}`
- Docs warn against a PAT here: a static token "does not rotate between runs" and could be
  recovered over time via injection.

## A. Full inputs and outputs table

Source of truth: `action.yml` at `anthropics/claude-code-action@main` (tag `v1.0.183`),
fetched 2026-07-29. This is **every** declared input, verbatim defaults.

### Root action inputs (37)

#### Triggering / actor filtering

| Input | Default | What it does |
|---|---|---|
| `trigger_phrase` | `@claude` | Phrase searched for in comment bodies and issue bodies to fire tag mode. |
| `assignee_trigger` | *(none)* | Assignee username that fires the action (e.g. `claude`). |
| `label_trigger` | `claude` | Label name that fires the action. **Note: this has a non-empty default**, so labelling an issue `claude` triggers the action even if you never configured it. |
| `allowed_bots` | `""` | Comma-separated bot usernames allowed to trigger, or `*` for all. Empty = no bots. Docs carry an explicit warning that `*` on public repos lets external Apps invoke it with attacker-controlled prompts. |
| `allowed_non_write_users` | `""` | Comma-separated usernames (or `*`) permitted to trigger **without repo write permission**. Only works when `github_token` is supplied. Triggers extra sandboxing (bubblewrap + socat + env scrubbing) — see cost/security below. |
| `include_comments_by_actor` | `""` | Allow-list of actors whose comments are included in the context Claude sees. Supports wildcards (`*[bot]`). Empty = include all. |
| `exclude_comments_by_actor` | `""` | Deny-list of actors whose comments are stripped from context. Exclusion wins over inclusion. |
| `track_progress` | `"false"` | Forces tag mode + a tracking comment for `pull_request` (opened, synchronize, ready_for_review, reopened) and `issues` (opened, edited, labeled, assigned) events. **This is the switch that makes the action emit a machine-readable progress comment on non-mention events.** |

#### Branching / commits

| Input | Default | What it does |
|---|---|---|
| `base_branch` | *(repo default branch)* | Base/source branch for new branches. |
| `branch_prefix` | `claude/` | Prefix for branches Claude creates. Docs note `claude-` for a dash format. |
| `branch_name_template` | `""` | Template. Variables: `{{prefix}}`, `{{entityType}}`, `{{entityNumber}}`, `{{timestamp}}`, `{{sha}}`, `{{label}}`, `{{description}}`. `{{label}}` = first label on the issue/PR (falls back to `{{entityType}}`); `{{description}}` = first 5 words of the title in kebab-case. Effective default: `{{prefix}}{{entityType}}-{{entityNumber}}-{{timestamp}}`. Implemented in `src/utils/branch-template.ts`. |
| `use_commit_signing` | `"false"` | When true, commits go through the GitHub API (`src/mcp/github-file-ops-server.ts`) so they get GitHub's verified-signature badge. When false, Claude uses plain `git`. |
| `ssh_signing_key` | `""` | SSH private key for signing. **Takes precedence over `use_commit_signing`.** Cleaned up by a post-step (`src/entrypoints/cleanup-ssh-signing.ts`). |
| `bot_id` | `41898282` | GitHub user ID used as the git author. Comment in `action.yml` says this is Claude's bot ID, cross-referenced to `src/github/constants.ts`. (41898282 is the well-known `github-actions[bot]` numeric ID.) |
| `bot_name` | `claude[bot]` | GitHub username used as the git author. **This is the string to filter on when ingesting commits/comments.** |

#### Prompt / Claude Code configuration

| Input | Default | What it does |
|---|---|---|
| `prompt` | `""` | The instructions. Direct prompt or a template. Supplying this is what selects *agent mode*. |
| `settings` | `""` | Claude Code settings — either a JSON string or a path to a settings JSON file. |
| `claude_args` | `""` | Raw passthrough of extra CLI args to the Claude CLI. This is the escape hatch that carries `--model`, `--max-turns`, `--allowedTools`, `--json-schema`, `--mcp-config`, `--system-prompt` etc. **Anthropic moved per-feature inputs into this single string in v1**, which is why the input list is shorter than you'd expect. |
| `plugins` | `""` | Newline-separated Claude Code plugin names, e.g. `code-review@claude-code-plugins`. |
| `plugin_marketplaces` | `""` | Newline-separated marketplace Git URLs to install plugins from. |
| `path_to_claude_code_executable` | `""` | Use a pre-existing Claude Code binary instead of installing one. Documented as debug-only. |
| `path_to_bun_executable` | `""` | Same for Bun. |

#### Auth / provider

| Input | Default | What it does |
|---|---|---|
| `anthropic_api_key` | *(none)* | Anthropic API key. Not needed for Bedrock/Vertex/Foundry. |
| `claude_code_oauth_token` | *(none)* | Claude Code OAuth token — the Pro/Max subscription path, alternative to an API key. |
| `anthropic_federation_rule_id` | *(none)* | Workload-identity-federation rule ID (`fdrl_...`). With `anthropic_organization_id`, the action exchanges the workflow's **GitHub OIDC token** for Claude API creds instead of using a static key. Requires `id-token: write`. |
| `anthropic_organization_id` | *(none)* | Anthropic org UUID for WIF. |
| `anthropic_service_account_id` | *(none)* | Service account (`svac_...`) the federated token acts as. |
| `anthropic_workspace_id` | *(none)* | Workspace (`wrkspc_...`) for WIF. Optional if the rule targets one workspace. |
| `anthropic_oidc_audience` | `https://api.anthropic.com` (documented default) | Audience requested on the GitHub OIDC token. |
| `github_token` | *(none)* | GitHub token with repo + PR permissions. Optional if using the GitHub App. When omitted, the action mints an App token and **revokes it in a post-step**. |
| `use_bedrock` | `"false"` | Route to Amazon Bedrock with OIDC. |
| `use_vertex` | `"false"` | Route to Google Vertex AI with OIDC. |
| `use_foundry` | `"false"` | Route to Microsoft Foundry with OIDC. |
| `additional_permissions` | `""` | Extra GitHub permissions to request, e.g. `actions: read`. `actions: read` is what unlocks the CI-log-reading MCP server (`src/mcp/github-actions-server.ts`). |

#### Output / comment behaviour

| Input | Default | What it does |
|---|---|---|
| `use_sticky_comment` | `"false"` | Reuse a single comment for all issue/PR updates instead of posting a new one per run. **Relevant to us: sticky = stable comment ID to poll; non-sticky = one comment per run, better for a run timeline.** |
| `classify_inline_comments` | `"true"` | Buffers inline review comments that lack `confirmed=true`, then classifies them (real review finding vs. test/probe) and posts them **after the session ends**. Set `false` for the old immediate-post behaviour. Implemented in `src/mcp/inline-comment-buffer.ts` + `src/entrypoints/post-buffered-inline-comments.ts`. This is Anthropic's own false-positive filter for review noise. |
| `include_fix_links` | `"true"` | Adds "Fix this" links in PR review feedback that deep-link into Claude Code with the issue context. |
| `display_report` | `"false"` | Write the Claude Code Report into the **GitHub Step Summary**. Carries a warning that this puts Claude-authored content in the summary. |
| `show_full_output` | `"false"` | Dump the full JSON output including **all tool results**. `action.yml` warns these "may contain secrets, API keys" and are publicly visible in Actions logs. |

#### Undeclared but referenced

- `action.yml` sets `MODE: ${{ inputs.mode }}` in the run step's `env:`, but **`mode` is not a declared input** in v1. It is a v0 leftover; `src/modes/detector.ts` now auto-detects. Passing `mode:` yields an "unexpected input" warning.

### Root action outputs (5) — the machine-readable surface

| Output | Value | Why it matters for ingestion |
|---|---|---|
| `execution_file` | Path to the Claude Code execution output file | A JSON turn log on the runner. Written by `base-action/src/execution-file.ts`. Contains the message/turn stream — the same shape as a transcript. **Only reachable if the workflow uploads it as an artifact**; it is not pushed anywhere by default. |
| `branch_name` | The branch Claude created for this execution | Directly joinable to our Delivery section via the branches API. |
| `github_token` | The token the action used (Claude App token if minted) | Not useful to us; revoked in a post-step. |
| `structured_output` | JSON string of all structured fields, populated when `--json-schema` is passed in `claude_args`. Consumers use `fromJSON(steps.id.outputs.structured_output).field_name`. | **The single most important lever for Loush.** It lets a workflow author define an arbitrary JSON schema and have Claude fill it, then we ingest that JSON rather than scraping prose. |
| `session_id` | The Claude Code session ID, usable with `--resume` | A join key. If the same session ID also appears in a local `~/.claude/projects/**/*.jsonl` transcript, that is a direct CI↔local join. **Unverified** whether CI-side session IDs ever land in a local transcript — they almost certainly do not, since the runner is ephemeral. |

### `base-action` inputs

`base-action/action.yml` is a separate, simpler action. Its inputs are passed by the root
action as `INPUT_*` env vars, visible in the root `action.yml` run step:
`INPUT_PROMPT_FILE` (`${{ runner.temp }}/claude-prompts/claude-prompt.txt`),
`INPUT_SETTINGS`, `INPUT_EXPERIMENTAL_SLASH_COMMANDS_DIR`
(`${{ github.action_path }}/slash-commands`), `INPUT_PATH_TO_CLAUDE_CODE_EXECUTABLE`,
`INPUT_PATH_TO_BUN_EXECUTABLE`, `INPUT_SHOW_FULL_OUTPUT`, `INPUT_PLUGINS`,
`INPUT_PLUGIN_MARKETPLACES`, plus `DISPLAY_REPORT`.

Note the prompt is materialised as a **file on disk** at
`$RUNNER_TEMP/claude-prompts/claude-prompt.txt`, not passed as an argv string.

### Environment variables the action forwards (not inputs, but configuration surface)

Set these at job level or via `$GITHUB_ENV`; the composite action explicitly re-exports them
because a composite step's `env:` block shadows job-level env:

- Anthropic: `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`
- Bedrock: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`, `ANTHROPIC_BEDROCK_BASE_URL`
- Vertex: `ANTHROPIC_VERTEX_PROJECT_ID`, `CLOUD_ML_REGION`, `GOOGLE_APPLICATION_CREDENTIALS`, `ANTHROPIC_VERTEX_BASE_URL`, `VERTEX_REGION_CLAUDE_3_5_HAIKU`, `VERTEX_REGION_CLAUDE_3_5_SONNET`, `VERTEX_REGION_CLAUDE_3_7_SONNET`
- Foundry: `ANTHROPIC_FOUNDRY_RESOURCE`, `ANTHROPIC_FOUNDRY_BASE_URL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`
- MCP: `MCP_TIMEOUT`, `MCP_TOOL_TIMEOUT`, `MAX_MCP_OUTPUT_TOKENS`
- **Telemetry (important for us):** `CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_METRIC_EXPORT_INTERVAL`, `OTEL_LOGS_EXPORT_INTERVAL`, `OTEL_RESOURCE_ATTRIBUTES`
- Sandboxing: `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` (set to `0` to opt out), `CLAUDE_CODE_SCRIPT_CAPS`

**The OTEL passthrough is a real alternative ingestion path**: Claude Code emits cost and
token metrics over OTLP, and the action forwards the config. Loush could stand up an OTLP
receiver in `server/` and get CI cost telemetry without scraping any comments. That said it
breaks the local-first/zero-telemetry thesis unless the collector is the user's own box.

### Composite step order (runtime shape)

1. `oven-sh/setup-bun@0c5077e...` pinned to bun `1.3.14` (skipped if `path_to_bun_executable`)
2. Optional custom-bun PATH setup
3. `bun install --production` inside `$GITHUB_ACTION_PATH`
4. Optional: `apt-get install bubblewrap socat` + `sysctl kernel.apparmor_restrict_unprivileged_userns=0` (only when `allowed_non_write_users != ''` on Linux; `continue-on-error: true`)
5. Optional: pin a copy of the bun binary to `$GITHUB_ACTION_PATH/bin/bun` for post-steps
6. **`bun run src/entrypoints/run.ts`** — the actual work
7. `always()`: re-prepend `/usr/bin`,`/bin` and blank out `LD_PRELOAD`/`NODE_OPTIONS`/`DYLD_*`
8. `always()`: cleanup SSH signing key
9. `always()`: `post-buffered-inline-comments.ts` (unless `classify_inline_comments: false`)
10. `always()`: `DELETE /installation/token` to revoke the minted App token

## A. What it writes back

This is the ingestible state. Five distinct artefacts, in descending order of usefulness to
Loush.

### 1. The tracking comment (the primary artefact)

**Initial body**, from `src/github/operations/comments/common.ts` → `createCommentBody()`:

```
Claude Code is working… <img src="https://github.com/user-attachments/assets/5ac382c7-e004-429b-8e35-7feb3e8f9c6f" width="14px" height="14px" style="vertical-align: middle; margin-left: 4px;" />

I'll analyze this and get back to you.

[View job run](https://github.com/{owner}/{repo}/actions/runs/{runId})
[View branch](https://github.com/{owner}/{repo}/tree/{branch})
```

The `[View branch]` line is appended only for **issues**, not PRs (`update-with-branch.ts`).
The spinner `<img>` src is a stable constant (`SPINNER_HTML`) — a reliable "run in progress"
marker.

**Final body**, from `src/github/operations/comment-logic.ts` → `updateCommentBody()`. Exact
template:

```
**Claude finished @{username}'s task in {D}** —— [View job]({jobUrl}) • [`{branch}`]({branchUrl}) • [Create PR ➔]({prUrl})

---
{claude's actual response markdown}
```

On failure:

```
**Claude encountered an error after {D}** —— [View job]({jobUrl})

```
{errorDetails}
```

---
{body content}
```

Parsing rules derived from the source:

- Header is one of exactly two prefixes: `**Claude finished @` or `**Claude encountered an error`.
  **These two strings are the success/failure signal.** There is no other status field.
- Duration `{D}` is `` `${minutes}m ${seconds}s` `` when >= 60s else `` `${seconds}s` ``,
  computed as `Math.round(duration_ms / 1000)`. **Rounded to whole seconds — sub-second
  precision is lost in the comment.**
- The separator between header and links is a literal em-dash pair: `" —— "`. Links are
  joined with `" • "`.
- Header and body are separated by `\n\n---\n`.
- `{username}` is the trigger user, or falls back to the first `@mention` found in the body,
  or the literal string `user`.
- The `[Create PR ➔]` link is a **prefilled compare URL**, not a created PR:
  `{server}/{owner}/{repo}/compare/{base}...{claudeBranch}?quick_pull=1&title=...&body=...`
  It is only added when `compareCommitsWithBasehead` shows `total_commits > 0` or changed files.

> **Critical finding for our Delivery/Runs section: `total_cost_usd` is NOT in the comment.**
> `src/entrypoints/update-comment-link.ts` reads `total_cost_usd`, `duration_ms`, and
> `duration_api_ms` from the execution file into an `executionDetails` object — but
> `updateCommentBody()` only ever consumes `duration_ms`. `total_cost_usd` and
> `duration_api_ms` are parsed and then dropped. **Scraping PR comments gives you duration and
> success/failure but never cost.** Cost requires the execution file (below) or OTEL.

**Identifying the comment via the API.** Two different bot IDs appear in the codebase and they
disagree:

| Location | Constant | Value |
|---|---|---|
| `src/github/constants.ts` | `CLAUDE_APP_BOT_ID` | `41898282` (this is `github-actions[bot]`'s well-known ID) |
| `src/github/constants.ts` | `CLAUDE_BOT_LOGIN` | `"claude[bot]"` |
| `src/github/operations/comments/create-initial.ts` | local `CLAUDE_APP_BOT_ID` | `209825114` |
| `action.yml` | `bot_id` input default | `41898282` |

`create-initial.ts` uses its own `209825114` for sticky-comment lookup, and additionally
matches `user.type === "Bot" && user.login.toLowerCase().includes("claude")` or an exact body
match. **For robust ingestion, match on `user.type === "Bot"` + login containing `claude`, or
on the header regex — do not hard-code a numeric ID.**

The comment ID is exported as a step output `claude_comment_id` (written to `$GITHUB_OUTPUT`).

### 2. Inline review comments

Posted via the `github_inline_comment` MCP server, tool `create_inline_comment`
(`src/mcp/github-inline-comment-server.ts`). Since `classify_inline_comments` defaults to
`true`, comments **without `confirmed=true` are buffered** (`src/mcp/inline-comment-buffer.ts`)
and only flushed after the session by the `always()` post-step
`src/entrypoints/post-buffered-inline-comments.ts`, which classifies each as a real review
finding vs. a test/probe. `docs/usage.md` states the classifier runs "via Haiku".

These land as normal PR review comments (`path`, `line`, `body`) reachable via
`GET /repos/{o}/{r}/pulls/{n}/comments`. **They are the closest thing the action has to
structured findings** — but they carry no severity, category, or ID, just prose.

Per `docs/capabilities-and-limitations.md`, Claude **cannot submit a formal PR review** and
**cannot approve PRs**.

### 3. Commits and branches

Branch naming (`src/utils/branch-template.ts`), default template
`{{prefix}}{{entityType}}-{{entityNumber}}-{{timestamp}}` with `prefix` default `claude/`, e.g.
`claude/issue-123-20260729-...`. **A `claude/` prefix glob on the branches API is a clean,
cheap way for Loush to enumerate agent-authored work without parsing any comments.**

Branch behaviour (`docs/capabilities-and-limitations.md`):

- Triggered on an **issue** → always creates a new branch
- Triggered on an **open PR** → pushes directly to the existing PR branch
- Triggered on a **closed PR** → creates a new branch

Commits go one of two ways:
- `use_commit_signing: false` (default) → plain `git` CLI, unsigned, author =
  `bot_name`/`bot_id` (`claude[bot]` / `41898282`)
- `use_commit_signing: true` → via `github_file_ops` MCP server tools `commit_files` /
  `delete_files` (`src/mcp/github-file-ops-server.ts`), which use the GitHub API so commits
  show as **verified**
- `ssh_signing_key` → git CLI with SSH signing, takes precedence

`src/github/operations/branch-cleanup.ts` **deletes the branch if Claude produced no commits**,
so an empty run leaves no branch behind. Good hygiene, but it means "branch exists" is a
proxy for "run produced changes".

**No PR is created automatically.** `docs/security.md` is explicit: Claude commits to a branch
and provides a link to the PR creation page; a human must click it.

### 4. The execution file — `claude-execution-output.json`

Path: `${RUNNER_TEMP}/claude-execution-output.json` (constant `EXECUTION_FILENAME` in
`base-action/src/execution-file.ts`), surfaced as the `execution_file` output.

It is `JSON.stringify(messages, null, 2)` of the raw Claude Code stream-json message array.
Verified shape from `test/fixtures/sample-turns.json`:

```jsonc
[
  { "type": "system", "subtype": "init", "session_id": "...",
    "tools": ["Task","Bash","Read","Edit","Write","mcp__github__..."],
    "mcp_servers": [{ "name": "github", "status": "connected" }] },

  { "type": "assistant",
    "message": {
      "id": "msg_sample123", "type": "message", "role": "assistant",
      "model": "claude-test-model",
      "content": [ { "type": "text", "text": "..." },
                   { "type": "tool_use", "id": "tool_call_1", "name": "Read",
                     "input": { "file_path": "..." } } ],
      "stop_reason": "tool_use", "stop_sequence": null,
      "usage": { "input_tokens": 100, "cache_creation_input_tokens": 0,
                 "cache_read_input_tokens": 50, "output_tokens": 75 }
    },
    "session_id": "..." },

  { "type": "user",
    "message": { "content": [ { "type": "tool_result", "tool_use_id": "tool_call_1",
                                "content": "...", "is_error": false } ] } },

  { "type": "result",
    "total_cost_usd": 0.0347,
    "duration_ms": 18750,
    "result": "Successfully removed debug print statement..." }
]
```

**This is the single most valuable artefact for Loush, and it is nearly the same shape as the
local `~/.claude/projects/**/*.jsonl` transcripts we already parse.** Differences:

- It is a **JSON array in one file**, not newline-delimited JSONL.
- `message.id` and `message.usage` are present on assistant messages — so our existing
  dedupe-by-`message.id` token counting applies directly. (`requestId` is **unverified** here;
  it does not appear in the fixture.)
- The final `type: "result"` element carries `total_cost_usd` — which, per the sibling
  research, we cannot get from local transcripts at all. **Ingesting CI execution files is
  therefore the only file-based way Loush ever sees real `total_cost_usd`.**
- `duration_api_ms` is read by `update-comment-link.ts`, so it exists on real result objects
  even though the fixture omits it.

**Catch:** the file lives on the ephemeral runner. Nothing uploads it. A workflow must add
`actions/upload-artifact` pointed at `${{ steps.claude.outputs.execution_file }}` for it to
survive. Loush would then fetch it via
`GET /repos/{o}/{r}/actions/runs/{run_id}/artifacts` → download zip. **This is the single
highest-value integration and it requires a one-line workflow change by the user.**

### 5. Structured output

When `claude_args` includes `--json-schema '{...}'`, the validated JSON is exposed as the
`structured_output` action output (a JSON string; consumers use `fromJSON()`). Composite
actions cannot expose dynamic outputs, so everything is bundled into that one string.

This is the mechanism to make the action emit **exactly the schema Loush wants** — e.g. a
findings array with severity and file/line — rather than us scraping prose. A workflow step
can then `gh api` it into a comment or an artifact.

### Not written back

- No **check run** or commit status is created by the action itself. The workflow's own job
  status is the only check. (`Checks: Read` is requested by the App but listed as not yet used.)
- No SARIF.
- No labels (unless the prompt tells Claude to set them via `gh`).
- `display_report: true` optionally writes the report to the **GitHub Step Summary**
  (`$GITHUB_STEP_SUMMARY`), retrievable via the Actions API job-summary endpoint. Default off.

## A. Cost and rate-limit behaviour

### What controls cost

There is **no cost cap input**. Cost is controlled indirectly:

| Lever | Where | Effect |
|---|---|---|
| `--max-turns N` | `claude_args` (was the deprecated `max_turns` input) | Hard cap on agent turns — the main runaway guard |
| `--model` | `claude_args` (was `model`) | Sonnet vs Opus vs Haiku |
| fallback model | `claude_args` / `settings` (was `fallback_model`) | Degrade instead of fail |
| `--allowedTools` / `--disallowedTools` | `claude_args` | Fewer tools ⇒ fewer turns |
| `exclude_comments_by_actor` | input | Drops bot noise from the prompt ⇒ smaller input tokens |
| trigger scoping | `label_trigger`, path filters in workflow `on:` | Fewer runs |
| GitHub Actions job `timeout-minutes` | workflow | Wall-clock backstop; kills the run, no graceful cost report |

`docs/usage.md` shows the migration: `max_turns: "10"` → `claude_args: "--max-turns 10"`.

### What reports cost

- `total_cost_usd` and `duration_ms` land in the **final `type: "result"` element of the
  execution file**. That is the authoritative per-run figure.
- They are read into `executionDetails` in `update-comment-link.ts` — **and `total_cost_usd` is
  then discarded**; only duration reaches the comment. (See A/What-it-writes-back.)
- OTEL: the action forwards `CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_METRICS_EXPORTER`,
  `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_METRIC_EXPORT_INTERVAL`, etc. So Claude Code's native
  cost/token metrics can be pushed to a collector. This is the only *push*-based cost path.
- Nothing aggregates cost across runs. There is no per-repo or per-org spend view in the action.

### Rate limits

- Rate limiting is entirely the upstream API's concern (Anthropic API, Bedrock, Vertex,
  Foundry). The action has `base-action/src/retry.ts` and `src/utils/retry.ts` for retries,
  but exposes **no rate-limit input** and surfaces no rate-limit state in its output.
- Consistent with the sibling research: rate-limit status is only available via the Claude Code
  **statusLine stdin payload**, which does not exist in CI. **So a CI run cannot tell you how
  much of your rate limit it consumed.** Only `total_cost_usd` is available.
- With `claude_code_oauth_token` (Pro/Max subscription), runs consume the user's subscription
  limits rather than API credits — a distinct and much-complained-about failure mode, since a
  busy repo can exhaust a personal plan.

### Cost multipliers worth knowing

- Every `@claude` mention on a PR re-reads the **entire** PR context (body, all comments,
  diff). Long threads get monotonically more expensive per invocation.
- `classify_inline_comments: true` adds an extra classification model call per buffered
  comment (Haiku, so cheap, but non-zero).
- `bun install --production` + Claude Code install run on every job — runner-minutes cost, not
  token cost.

## A. Feature inventory

| Feature | What it does | Where in the code | Depends on |
|---|---|---|---|
| Mode auto-detection | Picks tag vs agent mode from event + presence of `prompt` | `src/modes/detector.ts`, `src/modes/tag/index.ts`, `src/modes/agent/index.ts` | GitHub event payload |
| Trigger matching | Word-boundary regex on comment/body/title; label & assignee equality | `src/github/validation/trigger.ts` | `trigger_phrase`, `label_trigger`, `assignee_trigger` |
| Actor gating | Rejects bots unless allow-listed; requires repo write permission | `src/github/validation/actor.ts`, `permissions.ts` | `allowed_bots`, `allowed_non_write_users`, GitHub token |
| Comment actor filtering | Include/exclude actors' comments from prompt context, `*[bot]` wildcard | `src/github/utils/actor-filter.ts` | `include_comments_by_actor`, `exclude_comments_by_actor` |
| Context fetching | Pulls issue/PR, comments, review comments, diff, changed files via GraphQL/REST | `src/github/data/fetcher.ts`, `src/github/api/queries/github.ts` | GitHub token |
| Context formatting | Renders the above into the prompt text | `src/github/data/formatter.ts`, `src/create-prompt/index.ts` | fetcher |
| Prompt injection sanitizer | Strips HTML comments, invisible chars, image alt text, hidden attrs, entities | `src/github/utils/sanitizer.ts` | — |
| **Config restore from base ref** | Restores `CLAUDE.md`, `CLAUDE.local.md`, `.claude/`, `.mcp.json`, `.claude.json`, `.gitmodules`, `.ripgreprc`, `.husky` from the **base** branch so a PR cannot inject agent instructions; snapshots the PR's versions to `.claude-pr/` and adds that to `.git/info/exclude` | `src/github/operations/restore-config.ts` (`SENSITIVE_PATHS`, `CLAUDE_PR_EXCLUDE_PATTERN`) | git checkout |
| Image download | Fetches images attached to comments so Claude can see screenshots | `src/github/utils/image-downloader.ts` | GitHub token |
| Tracking comment lifecycle | Create → update with branch → final result | `src/github/operations/comments/{create-initial,update-with-branch,update-claude-comment}.ts`, `src/entrypoints/update-comment-link.ts` | `issues: write` |
| Comment body rendering | The `**Claude finished @x's task in Ns** —— [View job]…` format | `src/github/operations/comment-logic.ts` → `updateCommentBody()` | execution file for duration |
| Sticky comments | Reuse one comment across runs, found by bot ID / bot-login-contains-claude / body match | `create-initial.ts` (local `CLAUDE_APP_BOT_ID = 209825114`) | `use_sticky_comment` |
| Branch creation & templating | `{{prefix}}{{entityType}}{{entityNumber}}{{timestamp}}{{sha}}{{label}}{{description}}` | `src/github/operations/branch.ts`, `src/utils/branch-template.ts` | `contents: write` |
| Empty-branch cleanup | Deletes the branch if no commits were produced | `src/github/operations/branch-cleanup.ts` | `contents: write` |
| MCP: comment server | Tool `update_claude_comment` (namespace `mcp__github_comment__`) | `src/mcp/github-comment-server.ts`, registered in `install-mcp-server.ts` | always on in tag mode |
| MCP: inline comment server | Tool `create_inline_comment` (`mcp__github_inline_comment__`) | `src/mcp/github-inline-comment-server.ts` | PR context |
| MCP: file ops server | Tools `commit_files`, `delete_files` — API-based commits ⇒ verified signatures | `src/mcp/github-file-ops-server.ts` | `use_commit_signing: true` |
| MCP: CI server | Tools `get_ci_status`, `get_workflow_run_details`, `download_job_log` (`mcp__github_ci__`) | `src/mcp/github-actions-server.ts` | **`additional_permissions: actions: read`** — errors out without it |
| MCP: upstream github server | Full GitHub MCP (`mcp__github__`) | registered in `install-mcp-server.ts` | allowedTools opt-in |
| Path validation for file ops | Prevents writes outside the workspace | `src/mcp/path-validation.ts` | — |
| Inline-comment buffering + classification | Holds unconfirmed inline comments, classifies real-review vs test/probe (docs say via Haiku), flushes post-session | `src/mcp/inline-comment-buffer.ts`, `src/entrypoints/post-buffered-inline-comments.ts` | `classify_inline_comments` (default true) |
| "Fix this" deep links | Adds links opening Claude Code locally with the finding context | prompt construction; `include_fix_links` | — |
| Structured outputs | `--json-schema` → validated JSON → `structured_output` action output | `base-action/src/parse-sdk-options.ts`, run entrypoints | `claude_args` |
| Execution file | Writes `$RUNNER_TEMP/claude-execution-output.json`, sets `execution_file` output | `base-action/src/execution-file.ts` | `RUNNER_TEMP` |
| Turn formatting | Renders the turn log to markdown (for step summary) | `src/entrypoints/format-turns.ts`, fixtures in `test/fixtures/sample-turns*.` | `display_report` |
| Commit signing (API) | Verified commits through GitHub API | `src/mcp/github-file-ops-server.ts` | `use_commit_signing` |
| Commit signing (SSH) | git CLI signing, supports rebase etc.; key cleaned up post-run | `src/entrypoints/cleanup-ssh-signing.ts` | `ssh_signing_key`, `bot_id`, `bot_name` |
| Auth: API key / OAuth | Static credential | `base-action/src/validate-env.ts` | secrets |
| Auth: workload identity federation | Exchanges GitHub OIDC token for Claude API creds; one exchanged credential shared across spawned processes (fix in `b00a3414fd`) | `base-action/src/workload-identity.ts` | `id-token: write`, `anthropic_federation_rule_id` + `anthropic_organization_id` |
| Auth: Bedrock / Vertex / Foundry | Provider routing via env | `action.yml` env block | `use_bedrock` / `use_vertex` / `use_foundry` |
| Plugin installation | Installs marketplaces then plugins before the run | `base-action/src/install-plugins.ts` | `plugins`, `plugin_marketplaces` |
| SDK vs CLI execution | Two execution paths | `base-action/src/run-claude.ts` (CLI), `base-action/src/run-claude-sdk.ts` (Agent SDK) | — |
| Subprocess hardening | env scrub, bubblewrap PID namespace, per-script call caps | `action.yml` steps + CLI | `allowed_non_write_users`, `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, `CLAUDE_CODE_SCRIPT_CAPS` |
| App token revocation | `DELETE /installation/token` in an `always()` post-step | `action.yml` final step | minted App token |
| Agent approval check | Separate action verifying which agent identity approved something | `agent-approval-check/agent_approval_check.py`, `agent-identities.example.yaml` | opt-in |
| Retry | Retries transient failures | `base-action/src/retry.ts`, `src/utils/retry.ts` | — |

### How it reads CLAUDE.md

Two mechanisms, and the second is the interesting one:

1. The Claude Code CLI loads `CLAUDE.md` normally from the working directory. The action's
   generated prompt ends with the literal instruction, from `src/create-prompt/index.ts`:
   "Follow the repo's CLAUDE.md file for project-specific guidelines".
2. **`src/github/operations/restore-config.ts` restores agent-config files from the base ref
   before the run.** `SENSITIVE_PATHS = [".claude", ".mcp.json", ".claude.json", ".gitmodules",
   ".ripgreprc", "CLAUDE.md", "CLAUDE.local.md", ".husky"]`. The PR's own versions are copied
   to `.claude-pr/` (added to `.git/info/exclude`) so Claude can *review* them without
   *obeying* them. The file documents why `.git/`, `.gitconfig`, `.bashrc`, `.vscode`/`.idea`
   are deliberately excluded from this list.

This is a genuinely good idea and directly relevant to Loush's Governance section: **a PR that
edits `CLAUDE.md` is a governance event**, and the base-vs-head divergence is exactly what a
Governance panel should surface.

## A. Gaps and weaknesses

1. **Stateless. No history, no aggregation.** Each run is an isolated comment. There is no
   per-repo view of "how many @claude runs this month, costing what, with what success rate."
   This is the core gap and the core opportunity for Loush.
2. **Cost is written to the comment's data source and then thrown away.**
   `update-comment-link.ts` parses `total_cost_usd` into `executionDetails` and
   `updateCommentBody()` never reads it. Anyone scraping comments for spend gets nothing.
3. **The execution file is not persisted.** It sits in `$RUNNER_TEMP`, which is destroyed with
   the runner. Capturing it requires the user to add an `upload-artifact` step. The action does
   not do this or suggest it in `action.yml`.
4. **No structured findings format.** Review output is prose in a comment plus prose inline
   comments. No severity, no rule ID, no SARIF, no dedupe key. Compare to (B), which does have
   a schema. Cross-run "is this the same finding as last time?" is impossible without an LLM.
5. **No check runs.** The App requests `Checks: Read` but the docs say it is "not yet actively
   used." So there is no first-class pass/fail signal on the commit — only the workflow job
   status, which is green even when Claude's *advice* is negative.
6. **Cannot submit formal PR reviews or approve** (deliberate, security). So its output never
   participates in branch protection / required-review gating.
7. **`label_trigger` defaults to `claude`** — a non-empty default on a trigger input. Adding a
   `claude` label to any issue in a repo with this workflow fires a paid agent run. Easy to
   trip accidentally.
8. **`prompt` short-circuits all trigger validation** (`if (prompt) return true`). Actor
   permission checks still run, but the trigger layer is bypassed, which surprises people who
   assume `trigger_phrase` still gates an agent-mode workflow.
9. **Inconsistent bot-ID constants.** `constants.ts` says `41898282`; `create-initial.ts` uses
   a local `209825114`. Downstream consumers cannot rely on either.
10. **Rounded duration only.** The comment reports whole seconds; `duration_api_ms` (the
    model-time vs wall-time split, which is the interesting number for diagnosing slow runs) is
    never surfaced anywhere user-visible.
11. **Version churn.** ~daily `v1.0.N` tags tracking Claude Code CLI releases. The floating
    `v1` tag moves under you. Any parser we write against comment text is exposed to this.
12. **Bun, not Node.** The action installs Bun 1.3.14 on every run. Irrelevant to ingestion,
    but it means we cannot trivially reuse their TypeScript in our plain-ESM Node server
    without a build step.
13. **Prompt-injection surface remains.** Docs admit sanitization is best-effort and "new
    bypass techniques may emerge." The `allowed_bots: '*'` + public repo combination is called
    out as letting external Apps invoke the action with attacker-controlled prompts.
14. **Runner-minute cost is invisible.** Bun install + Claude Code install + `bun install
    --production` happen every run, on top of token cost. Nothing reports the split.
15. **No native scheduling or backlog.** Cron workflows work, but there is no queue, no
    dedupe of concurrent `@claude` mentions on the same PR, and no "one run at a time" guard
    beyond GitHub's own concurrency groups.

## B. claude-code-security-review — Identity

| Field | Value | Source |
|---|---|---|
| Repo | https://github.com/anthropics/claude-code-security-review | GitHub API |
| License | **MIT** (SPDX `MIT`), `LICENSE` at repo root, `Copyright (c) 2025 Anthropic` | `license.spdx_id` = `MIT`, `LICENSE` |
| Description (API) | "An AI-powered security review GitHub Action using Claude to analyze code changes for security vulnerabilities." | API |
| `action.yml` name | "Claude Code Security Reviewer", `author: 'Anthropic'` | `action.yml` |
| Created | 2025-08-04 | API |
| Last push | **2026-02-11T18:01:23Z** | API |
| Stars / forks | 5,677 / 609 | API, 2026-07-29 |
| Open issues+PRs | 78 | API |
| Primary language | Python (the scanner) + Node 18 (the PR-comment script) | API + `action.yml` |
| Default branch | `main` | API |
| Tags | **none — `/tags` returns an empty array.** No releases, no `v1`. | tags API |
| Latest commit | `0c6a49f1fa` — "Merge pull request #55 from Eduard-Voiculescu/main", 2026-02-11 | commits API |
| Versioning | **There is no versioning.** Every documented usage is `anthropics/claude-code-security-review@main`. The only pinning available is a raw commit SHA. | README, `docs/`, action.yml error text |
| Marketplace | `branding: { icon: 'shield', color: 'red' }`. `homepage` is null, `topics` is empty. **Unverified** whether it is listed on GitHub Marketplace. | `action.yml`, API |
| Blog post | https://www.anthropic.com/news/automate-security-reviews-with-claude-code (linked from README; not fetched) | README |

Notable identity facts, and the contrast with (A) is stark:

- **The repo is effectively dormant.** Last push 2026-02-11; research date 2026-07-29. That is ~5.5 months
  of no commits, against (A)'s ~daily `v1.0.N` cadence. The two most recent commits are housekeeping
  (`Pin all versions of any uses:` in the workflows and `action.yml`, and a merge of an external PR).
- **No tags means `@main` is the only supported reference.** Anthropic's own README, both `docs/` pages
  and the action's own error-message example all say `@main`. Combined with a stale `main`, the surface
  is stable in practice — but a consumer pinning `@main` has no way to know it moved.
- The repo is small: **42 paths total**, 13 of which are `test_*.py`. `size` is 61 KB.
- The `/security-review` slash command shipped in Claude Code is **the same product with a different
  output contract** — this repo carries the canonical `.claude/commands/security-review.md`.

### Repo layout (real paths, from `git/trees/main?recursive=1`, 42 entries)

```
action.yml                          # the composite action
LICENSE                             # MIT, (c) 2025 Anthropic
README.md
__init__.py                         # empty package marker at repo root
pytest.ini
.claude/commands/security-review.md # the /security-review slash command (markdown output variant)
.github/workflows/sast.yml          # the repo scanning itself
.github/workflows/test-claudecode.yml
claudecode/github_action_audit.py   # main() — the whole GH Action pipeline
claudecode/prompts.py               # get_security_audit_prompt()
claudecode/findings_filter.py       # HardExclusionRules + FindingsFilter
claudecode/claude_api_client.py     # ClaudeAPIClient — the per-finding LLM filter
claudecode/json_parser.py           # parse_json_with_fallbacks / extract_json_from_text
claudecode/constants.py             # DEFAULT_CLAUDE_MODEL, exit codes, timeouts
claudecode/logger.py
claudecode/audit.py                 # 219-byte shim
claudecode/requirements.txt
claudecode/evals/{README.md,eval_engine.py,run_eval.py}
claudecode/test_*.py                # 13 test modules
docs/custom-filtering-instructions.md
docs/custom-security-scan-instructions.md
examples/custom-false-positive-filtering.txt
examples/custom-security-scan-instructions.txt
scripts/comment-pr-findings.js      # the ONLY thing that writes to GitHub
scripts/comment-pr-findings.bun.test.js
scripts/package.json
```

## B. The problem it solves

(A) is a general-purpose agent that happens to run on GitHub. (B) is a **single-purpose SAST replacement**
with a fixed prompt, a fixed output schema and a fixed post-processing pipeline. It exists because
pattern-matching SAST tools produce more noise than signal, and because a model that can read the
surrounding code can answer "is this reachable?" in a way `grep`-shaped rules cannot.

Concretely:

1. **Diff-scoped review.** It fetches the PR's unified diff (`Accept: application/vnd.github.diff`),
   strips generated files and excluded directories, and instructs the model to consider only security
   implications *newly added by this PR*. This is the thing traditional SAST is worst at — most SAST
   tools re-report the whole repo on every PR.
2. **A machine-readable finding record.** Unlike (A), the model is required to emit JSON with
   `file`, `line`, `severity`, `category`, `description`, `exploit_scenario`, `recommendation` and
   `confidence`. This is the schema Loush wants. (A) has nothing comparable.
3. **An explicit false-positive budget.** Four separate suppression stages (documented below), plus a
   >80%-confidence instruction in the prompt itself. The design premise is stated in the prompt: better
   to miss theoretical issues than flood the report.
4. **Findings land where the reviewer is looking** — as inline review comments on the changed lines,
   in a single formal PR review, each with 👍/👎 reactions pre-seeded for feedback.

What it is explicitly **not**: it is not gated. The action never fails the job (see gaps), never
produces a check run, never emits SARIF, and never opens to GitHub Advanced Security. It is also
**not hardened**: the README states plainly that the action "is not hardened against prompt injection
attacks" and recommends requiring approval for external contributors.

## B. Finding schema

**This is the section that matters for ingestion.** A finding mutates through four representations
before it reaches GitHub. All four are reproduced verbatim from source.

### 1. What the model is told to emit (`claudecode/prompts.py`)

The prompt ends with a hard instruction — "Your final reply must contain the JSON and nothing else" —
and this literal schema block:

```jsonc
{
  "findings": [
    {
      "file": "path/to/file.py",
      "line": 42,
      "severity": "HIGH",
      "category": "sql_injection",
      "description": "User input passed to SQL query without parameterization",
      "exploit_scenario": "Attacker could extract database contents by manipulating the 'search' parameter ...",
      "recommendation": "Replace string formatting with parameterized queries using SQLAlchemy or equivalent",
      "confidence": 0.95
    }
  ],
  "analysis_summary": {
    "files_reviewed": 8,
    "high_severity": 1,
    "medium_severity": 0,
    "low_severity": 0,
    "review_completed": true,      // <- trailing comma in the source prompt
  }
}
```

Field-level facts:

| Field | Type | Notes for ingestion |
|---|---|---|
| `file` | string | Repo-relative path. Not validated against the diff at this stage. |
| `line` | integer | Single line, **no range, no column, no end-line**. |
| `severity` | `"HIGH"` \| `"MEDIUM"` \| `"LOW"` | Uppercase by convention only — nothing enforces it. The exit-code check does `f.get('severity','').upper() == 'HIGH'`, so it tolerates case drift. The prompt says to report HIGH and MEDIUM only. |
| `category` | string | **Free-form snake_case, no enum.** `sql_injection`, `xss`, … are examples, not a closed set. There is no rule ID and no CWE mapping anywhere in the repo. |
| `description` | string | Prose. Also the text the hard-exclusion regexes are matched against. |
| `exploit_scenario` | string | Prose. |
| `recommendation` | string | Prose. |
| `confidence` | float **0.0–1.0** | Per the prompt's CONFIDENCE SCORING block; below 0.7 must not be reported. |

Two quirks worth knowing before you write a parser:

- **The schema Anthropic shows the model is not itself valid JSON** — there is a trailing comma after
  `"review_completed": true,`. It lives inside a Python f-string, so it is never parsed; it is prompt
  text. But it means the model is being shown malformed JSON as its target.
- **`title` is not in the schema, yet `HardExclusionRules` reads `finding.get('title', '')`.** Dead
  field. Do not expect it.

### 2. Extraction (`github_action_audit.py::_extract_security_findings`)

Claude Code is invoked as:

```
claude --output-format json --model <DEFAULT_CLAUDE_MODEL> --disallowed-tools 'Bash(ps:*)'
```

with the prompt on **stdin** (explicitly to dodge `argument list too long`), `cwd=repo_dir`.

Extraction is strict and single-path: the top-level object must be the Claude Code wrapper and must
have a `result` key; `result` must be a string; that string is re-parsed by
`parse_json_with_fallbacks` (direct `json.loads` → ```` ```json ```` fence → ```` ``` ```` fence →
balanced-brace scan); and the parsed object must contain `findings`. If any step fails, the function
returns the empty shell, with `review_completed: false` as the only tell:

```json
{ "findings": [],
  "analysis_summary": { "files_reviewed": 0, "high_severity": 0, "medium_severity": 0,
                        "low_severity": 0, "review_completed": false } }
```

A comment in the source states the direct (unwrapped) format is not supported.

### 3. Enrichment and exclusion records (`findings_filter.py`)

Every **kept** finding gets one added key. The original fields are untouched:

```jsonc
{
  "...": "all original fields",
  "_filter_metadata": {
    "confidence_score": 8,          // 1–10 integer from the filter model
    "justification": "Clear SQL injection vulnerability with specific exploit path"
  }
}
```

> **Ingestion trap: a kept finding carries two different confidence numbers on two different scales.**
> `finding.confidence` is a **0.0–1.0 float** from the scan prompt. `finding._filter_metadata.confidence_score`
> is a **1–10 integer** from the filter prompt. They are not the same measure and are never reconciled.
> When the filter fails open, `confidence_score` is set to the float `10.0` (not the int `10`).

**Excluded** findings are wrapped, and there are *three* shapes in the same array:

```jsonc
// (a) hard-rule exclusion — findings_filter.py
{ "finding": { /* original */ }, "index": 3,
  "exclusion_reason": "Generic DOS/resource exhaustion finding (low signal)",
  "filter_stage": "hard_rules" }

// (b) LLM exclusion — findings_filter.py
{ "finding": { /* original */ }, "confidence_score": 3,
  "exclusion_reason": "…or 'Low confidence score: 3'",
  "justification": "…", "filter_stage": "claude_api" }

// (c) directory exclusion — github_action_audit.py::apply_findings_filter
{ /* the BARE finding object, no wrapper, no filter_stage */ }
```

Shape (c) is appended raw (`directory_excluded_findings.append(finding)`), so
`excluded_findings_details` is a heterogeneous array. **Any parser must key off the presence of
`filter_stage` rather than assuming a uniform wrapper.**

### 4. The final artefact — `claudecode-results.json`

`main()` prints exactly this to stdout with `json.dumps(output, indent=2)`; `action.yml` redirects
stdout to `claudecode/claudecode-results.json` and then copies it to `${{ github.workspace }}/claudecode-results.json`.

```jsonc
{
  "pr_number": 123,
  "repo": "owner/repo",
  "findings": [ /* kept findings, each carrying _filter_metadata */ ],

  // NOTE: this is the MODEL's self-reported summary, taken from `results`, i.e. PRE-filter.
  "analysis_summary": {
    "files_reviewed": 8, "high_severity": 1, "medium_severity": 0,
    "low_severity": 0, "review_completed": true
  },

  "filtering_summary": {
    "total_original_findings": 7,
    "excluded_findings": 5,
    "kept_findings": 2,
    "filter_analysis": {
      "total_findings": 7,
      "kept_findings": 2,
      "excluded_findings": 5,
      "hard_excluded": 3,
      "claude_excluded": 2,
      "exclusion_breakdown": { "Generic DOS/resource exhaustion finding": 2,
                               "Finding in Markdown documentation file": 1 },
      "average_confidence": 7.5,        // null when no LLM scores were collected
      "runtime_seconds": 41.2,
      "directory_excluded_count": 0
    },
    "excluded_findings_details": [ /* the three shapes above */ ]
  }
}
```

> **Do not read counts from `analysis_summary`.** It is the model's own pre-filter self-report and
> disagrees with `filtering_summary` by design. `filtering_summary.filter_analysis` is the truthful
> accounting. Note also that `exclusion_breakdown` keys are derived as
> `exclusion_reason.split('(')[0].strip()` — i.e. the reason string with its parenthetical dropped —
> so the key set is stable but is not an enum you can rely on across versions.

**Failure shape.** On any error path `main()` prints `{"error": "<message>"}` *instead of* the object
above and exits 1 or 2. `action.yml` detects this with `jq -e '.error'` and sets `findings_count=0`.
So an errored scan and a clean scan are indistinguishable from the action's outputs alone — you must
read the JSON.

### 5. Files, outputs and the artifact

| Thing | Value |
|---|---|
| Full results | `${{ github.workspace }}/claudecode-results.json` (copied from `claudecode/claudecode-results.json`) |
| Findings only | `${{ github.workspace }}/findings.json` — produced by `jq '.findings // []'`, so a **bare array** of kept findings, each with `_filter_metadata` |
| Stderr log | `${{ github.workspace }}/claudecode-error.log` |
| Artifact | name `security-review-results`, paths `findings.json`, `claudecode-results.json`, `claudecode-error.log`, `retention-days: 7`, `if-no-files-found: ignore` |
| Action output `findings-count` | `jq -r '.findings \| if . == null then 0 else length end'` — kept findings only |
| Action output `results-file` | the literal string `claudecode/claudecode-results.json` — **relative to `$GITHUB_ACTION_PATH`, not the workspace.** The declared output path does not resolve from a consumer's job. Use the workspace copy. |

**Unlike (A), the artifact is uploaded by default** (`upload-results` defaults `'true'`, and the step is
`if: always()`). No workflow edit is needed. Loush can pull it straight from
`GET /repos/{o}/{r}/actions/runs/{run_id}/artifacts` → download zip → `claudecode-results.json`.
**This is the single cheapest high-value ingestion in either repo.**

### 6. How findings surface as PR comments (`scripts/comment-pr-findings.js`)

One Node 18 script, invoked with `GITHUB_TOKEN` set, shelling out to `gh api` via `spawnSync`.

**Field resolution per finding** (note the Semgrep-shaped fallbacks — vestigial, but they mean the
script tolerates a foreign finding shape):

```js
const file     = finding.file || finding.path;
const line     = finding.line || (finding.start && finding.start.line) || 1;
const message  = finding.description || (finding.extra && finding.extra.message) || 'Security vulnerability detected';
const severity = finding.severity || 'HIGH';
const category = finding.category || 'security_issue';
```

Findings whose `file` is not in `GET /pulls/{n}/files?per_page=100` are **silently dropped**
(`console.log('File … not in PR diff, skipping')`).

**Exact comment body** (`\n` shown as line breaks; the trailing sections are conditional):

```
🤖 **Security Issue: {message}**

**Severity:** {severity}
**Category:** {category}
**Tool:** ClaudeCode AI Security Analysis

**Exploit Scenario:** {exploit_scenario}

**Recommendation:** {recommendation}
```

The `Exploit Scenario` block is emitted only if `finding.exploit_scenario` (or
`finding.extra.metadata.exploit_scenario`) is truthy; likewise `Recommendation`.
**The `confidence` / `confidence_score` values never reach the comment.**

**Posting mechanism.** One formal review, not loose comments:

```jsonc
POST /repos/{owner}/{repo}/pulls/{number}/reviews
{
  "commit_id": "<payload.pull_request.head.sha>",
  "event": "COMMENT",
  "comments": [ { "path": "src/db.py", "line": 42, "side": "RIGHT", "body": "🤖 **Security Issue: …" } ]
}
```

`event: 'COMMENT'` — advisory, never `APPROVE` or `REQUEST_CHANGES`. **This is a genuine difference
from (A), which per its docs cannot submit a formal PR review at all.** If the review POST throws
(commonly because a line is outside diff context) it falls back to one
`POST /pulls/{n}/comments` per finding.

**Reactions.** For every comment created, the script posts `+1` and then `-1` to
`/pulls/comments/{id}/reactions` (or `/issues/comments/{id}/reactions`). So each finding arrives with
👍/👎 pre-seeded as a one-click feedback affordance. A third-party guide claims Anthropic harvests
these reaction counts after merge to tune the reviewer — **unverified**, no code in this repo does that.

**Idempotency / dedupe.** Before posting, it fetches `GET /pulls/{n}/comments` and filters for
`comment.user.type === 'Bot' && comment.body.includes('🤖 **Security Issue:')`. **If even one exists,
the entire run posts nothing** — including genuinely new findings from a later commit.

> **The ingestion selector for Loush is the literal string `🤖 **Security Issue:` at the start of a
> PR review comment body.** It is stable, unique, and appears in exactly one place in the codebase.
> Parse the four `**Label:** value` lines out of the body and you have severity, category, tool,
> exploit scenario and recommendation without touching the artifact. Combine both: comments give you
> line anchoring and human reactions; the artifact gives you `confidence`, `_filter_metadata` and the
> full excluded-findings audit trail.

### Not produced

- **No SARIF.** Nothing in the repo emits or mentions SARIF, and there is no code-scanning upload step.
- **No check run, no commit status.** And see gaps — the job stays green regardless.
- **No dedupe key / fingerprint.** No rule ID, no CWE, no stable finding hash. Cross-run identity has to
  be reconstructed (file + line + category + normalised description is the best available key).
- **No labels, no issues, no PR creation.**

## B. Rule set / prompt strategy and false-positive handling

### Vulnerability classes examined

The prompt names five groups; the README advertises ten. Both lists, and the discrepancy, matter:

| Prompt group (`prompts.py`) | Members |
|---|---|
| Input Validation | SQL injection, command injection, XXE, template injection, NoSQL injection, path traversal |
| Authentication & Authorization | auth bypass logic, privilege escalation, session management flaws, JWT vulnerabilities, authorization bypass |
| Crypto & Secrets Management | hardcoded keys/passwords/tokens, weak crypto, improper key storage, randomness issues, certificate-validation bypass |
| Injection & Code Execution | RCE via deserialization, pickle injection, YAML deserialization, eval injection, XSS (reflected/stored/DOM) |
| Data Exposure | sensitive data logging/storage, PII violations, API endpoint leakage, debug info exposure |

`custom-security-scan-instructions` injects an extra block **immediately after Data Exposure**
(`{custom_categories_section}` in the f-string), so custom categories extend rather than replace.

> **Contradiction worth recording.** The README lists "Supply Chain: Vulnerable dependencies,
> typosquatting risks" and "Business Logic Flaws: Race conditions, TOCTOU" among detected classes.
> The default filter instructions in `claude_api_client.py` explicitly forbid both: outdated
> third-party libraries are "managed separately", and theoretical race conditions must not be reported.
> The scan prompt does not mention supply chain at all. **The README oversells the class coverage.**

### Prompt structure

Single user prompt, built by `get_security_audit_prompt(pr_data, pr_diff, include_diff, custom_scan_instructions)`,
delivered on stdin. Sections in order:

1. Role line — senior security engineer reviewing PR #N by title
2. `CONTEXT:` — repo full name, author, changed-file count, additions, deletions
3. `Files modified:` — bullet list of `f['filename']`
4. `PR DIFF CONTENT:` — the full unified diff in a fenced block
5. `OBJECTIVE:` — security-only, **newly added by this PR only**, do not comment on pre-existing issues
6. `CRITICAL INSTRUCTIONS:` — 4 rules; rule 1 is the confidence gate ("Only flag issues where you're >80% confident of actual exploitability"); rule 4 is a 3-item exclusion list
7. `SECURITY CATEGORIES TO EXAMINE:` — the five groups + custom injection point
8. Note that local-network-only exploitability can still be HIGH
9. `ANALYSIS METHODOLOGY:` — Phase 1 repository context research, Phase 2 comparative analysis vs existing patterns, Phase 3 vulnerability assessment / data-flow tracing
10. `REQUIRED OUTPUT FORMAT:` — the JSON schema above
11. `SEVERITY GUIDELINES:` — HIGH / MEDIUM / LOW definitions
12. `CONFIDENCE SCORING:` — 0.9–1.0 / 0.8–0.9 / 0.7–0.8 / below 0.7 don't report
13. `FINAL REMINDER:` — HIGH and MEDIUM only
14. `IMPORTANT EXCLUSIONS - DO NOT REPORT:` — a **second**, longer 5-item exclusion list
15. Closing: begin analysis, then the JSON-only instruction

Phase 1 is the whole differentiator versus regex SAST: the model is told to read the repo's existing
security frameworks and sanitization patterns *before* judging the diff.

**Prompt-size handling.** A warning is printed above 1 MB. If Claude Code returns
`{"type":"result","subtype":"success","is_error":true,"result":"Prompt is too long"}`, the runner
returns the sentinel `PROMPT_TOO_LONG` and `main()` rebuilds the prompt with `include_diff=False`,
substituting a note telling the model to use file-exploration tools instead. **A large PR is therefore
silently reviewed without its diff.** Nothing in the output records that this happened.

**Retries.** `NUM_RETRIES = 3` on non-zero exit, with `time.sleep(5*attempt)` — so 0 s, then 5 s, then
fail. A comment says exponential backoff was skipped deliberately to keep runtime reasonable.
`subtype: "error_during_execution"` retries once. Unparseable stdout retries once.

### The false-positive pipeline — five stages

Anthropic's noise control is layered. Stages 1–4 run in the action; stage 0 is a gate most users never
notice.

**Stage 0 — the run gate (`action.yml`, `actions/cache`).**
A cache entry keyed `claudecode-{repository_id}-pr-{number}-{sha}` with `restore-keys` on the PR prefix
holds a `.claudecode-marker/marker.json` reservation. If that marker restores and
`run-every-commit != 'true'`, `enable_claudecode` is set to `false` and **the entire scan, comment step
and all, is skipped**. The log line says this exists "to avoid false positives". The `run-every-commit`
input description warns that re-running on many commits increases false positives.

> **Consequence, and it is not stated in the README: by default the action scans a PR exactly once — on
> the first commit that triggers it — and never again.** Everything pushed afterwards is unreviewed.
> Combined with the comment-dedupe in stage 5, a PR gets at most one security review in its lifetime.

**Stage 1 — in-prompt suppression.** Two exclusion lists inside the audit prompt (DOS/service
disruption, secrets on disk, rate limiting; then DOS again, secrets on disk again, rate limiting again,
memory/CPU exhaustion, and un-proven input-validation gaps). Free; costs nothing.

**Stage 2 — `HardExclusionRules` (deterministic regex, `findings_filter.py`).**
Matched against `f"{title} {description}".lower()` — note `title` is always empty, so effectively
**description only**, and never against `category`. Evaluated in this order; first match wins and
returns the exclusion reason string:

| # | Check | Pattern family | Reason string |
|---|---|---|---|
| 0 | `file.lower().endswith('.md')` | — | `Finding in Markdown documentation file` |
| 1 | `_DOS_PATTERNS` (3) | `denial of service\|dos attack\|resource exhaustion`, `(exhaust\|overwhelm\|overload).*(resource\|memory\|cpu)`, `(infinite\|unbounded).*(loop\|recursion)` | `Generic DOS/resource exhaustion finding (low signal)` |
| 2 | `_RATE_LIMITING_PATTERNS` (4) | missing/lack of/no rate limit, rate limiting missing/required, implement/add rate limit, unlimited requests/calls/api | `Generic rate limiting recommendation` |
| 3 | `_RESOURCE_PATTERNS` (5) | resource/memory/file leak potential, unclosed resource/file/connection, close/cleanup/release resource, potential memory leak, database/thread/socket/connection leak | `Resource management finding (not a security vulnerability)` |
| 4 | `_OPEN_REDIRECT_PATTERNS` (3) | open redirect, unvalidated redirect, redirect attack/exploit/vulnerability, malicious redirect | `Open redirect vulnerability (not high impact)` |
| 5 | `_REGEX_INJECTION` (3) | regex/regular expression injection, ~ denial of service, ~ flooding | `Regex injection finding (not applicable)` |
| 6 | `_MEMORY_SAFETY_PATTERNS` (9) — **only when the file extension is not in `{.c,.cc,.cpp,.h}`** | buffer/stack/heap overflow, oob read/write/access, out-of-bounds, memory safety/corruption, use-after-free / double-free / null-pointer-dereference, segfault, bounds check, integer overflow/underflow/conversion, arbitrary memory read | `Memory safety finding in non-C/C++ code (not applicable)` |
| 7 | `_SSRF_PATTERNS` (1) — **only when the extension is `.html`** | `ssrf\|server-side request forgery` | `SSRF finding in HTML file (not applicable to client-side code)` |

All patterns are `re.IGNORECASE` *and* matched against an already-lowercased string (redundant).
Note the extension test builds `file_ext` from the last dot in the path, so an extensionless file gets
`file_ext = ''` and is treated as non-C/C++, i.e. memory-safety findings are dropped there too.

**Stage 3 — per-finding LLM adjudication (`claude_api_client.py`).**
`ENABLE_CLAUDE_FILTERING` is hardcoded to `'true'` in `action.yml`, so this always runs in the Action
(it defaults *off* when you drive the module directly). **One Anthropic API call per surviving
finding** — this is a real cost multiplier, and it is a second model on top of the Claude Code run.

- Model: `DEFAULT_CLAUDE_MODEL` = `os.environ.get('CLAUDE_MODEL') or 'claude-opus-4-1-20250805'`.
- Timeout 180 s (`DEFAULT_TIMEOUT_SECONDS`), `DEFAULT_MAX_RETRIES = 3`, `max_tokens = PROMPT_TOKEN_LIMIT = 16384`.
- Rate-limit backoff: `min(30, 5 * (retries + 1))` on 429; 2 s on timeout; 1 s otherwise.
- System prompt: a security expert filtering false positives, told to keep recall high while improving
  precision, and to answer with JSON only.
- User prompt = PR context + the filtering instruction block + a 1–10 confidence rubric + the finding
  as pretty JSON + **the entire contents of the finding's file**, read via `_read_file` (resolved
  against `REPO_PATH`, UTF-8 with latin-1 fallback). The docstring claims the file is formatted with
  line numbers; **the implementation returns raw content with no numbering.** So the model is asked to
  judge `"line": 42` against an unnumbered file.
- Default filtering block (overridable wholesale by `false-positive-filtering-instructions`):
  **16 HARD EXCLUSIONS**, **4 SIGNAL QUALITY CRITERIA**, **17 PRECEDENTS**. The precedents are the
  interesting part — they encode real opinions: env vars and CLI flags are trusted inputs; UUIDs are
  unguessable; React is XSS-safe absent `dangerouslySetInnerHTML`; client-side JS cannot have SSRF or
  path traversal; missing audit logs are not a vulnerability; user content in an AI system prompt is
  not a vulnerability; MEDIUM findings only if obvious and concrete.
- Required response, verbatim from the prompt:
  ```json
  { "original_severity": "HIGH", "confidence_score": 8, "keep_finding": true,
    "exclusion_reason": null, "justification": "Clear SQL injection vulnerability with specific exploit path" }
  ```
- **The pipeline fails open, twice.** (i) If a per-finding call fails or its JSON won't parse, the
  finding is *kept* with `confidence_score: 10.0` and `justification: "Claude API failed: <err>"`.
  (ii) `validate_api_access()` probes with a hardcoded `claude-3-5-haiku-20241022`, `max_tokens: 10`;
  if that probe fails, LLM filtering is disabled for the whole run and everything from stage 2 passes
  through with `confidence_score: 10.0` and `justification: "Claude filtering disabled"`.
  **So `confidence_score == 10.0` is ambiguous: it means "real 10", "API broke", or "filter off".
  The `justification` string is the only disambiguator.** Ingest it.
- Note the filter model never returns a number below the keep threshold as a *decision* — `keep_finding`
  is the decision, `confidence_score` is advisory, and nothing in `findings_filter.py` thresholds on it.

**Stage 4 — directory exclusion.** `_is_finding_in_excluded_directory` re-applies `EXCLUDE_DIRECTORIES`
to the survivors, catching findings that name a file outside the scanned set. Excluded records are
appended bare (shape (c) above) and counted in `directory_excluded_count`.

**Stage 5 — comment dedupe** (in `comment-pr-findings.js`, described in the schema section): any
pre-existing `🤖 **Security Issue:` bot comment suppresses the whole posting step.

### The `/security-review` slash command uses a different strategy

`.claude/commands/security-review.md` is the same content with three changes worth noting, because it
is what most Loush users will actually have run locally:

- **Markdown output, not JSON.** `# Vuln N: <CATEGORY>: \`file:line\`` followed by bullet lines
  `* Severity:`, `* Description:`, `* Exploit Scenario:`, `* Recommendation:`. Loush would need a
  second, looser parser for this shape.
- **Explicit subagent fan-out.** Step 1: one sub-task finds vulnerabilities. Step 2: **one parallel
  sub-task per finding** re-runs the false-positive instructions. Step 3: drop anything with
  confidence < 8. This is the same two-model architecture as the Action, implemented with `Task`
  instead of the Anthropic API.
- **A longer, drifted exclusion list** — 17 hard exclusions (with a numbering bug: two entries labelled
  `16.`), adding regex injection, regex DoS, "no findings in documentation files", and "a lack of audit
  logs is not a vulnerability". `allowed-tools` is locked to read-only git plus `Read, Glob, Grep, LS, Task`,
  and the filtering block explicitly forbids using bash or writing files.

## B. Feature inventory

| Feature | What it does | Where in the code | Depends on |
|---|---|---|---|
| Once-per-PR run gate | Cache-backed `.claudecode-marker/marker.json` reservation; skips the whole scan on later commits | `action.yml` steps *Check ClaudeCode run history* / *Determine ClaudeCode enablement* / *Reserve ClaudeCode slot* | `actions/cache@0057852`, `run-every-commit` |
| PR metadata fetch | `GET /pulls/{n}` + `GET /pulls/{n}/files?per_page=100`, projected to a fixed dict | `github_action_audit.py::GitHubActionClient.get_pr_data` | `GITHUB_TOKEN` |
| Unified diff fetch | Same URL with `Accept: application/vnd.github.diff` | `…::get_pr_diff` | `GITHUB_TOKEN` |
| Generated-file stripping | Splits on `^diff --git` and drops sections containing `@generated`, `Code generated by OpenAPI Generator`, `Code generated by protoc-gen-go` | `…::_filter_generated_files` | — |
| Directory exclusion | Prefix and `/dir/`-anywhere matching, applied to both the file list and the diff | `…::_is_excluded` | `exclude-directories` |
| Audit prompt construction | The whole security prompt incl. custom-category injection | `prompts.py::get_security_audit_prompt` | `custom-security-scan-instructions` |
| Claude Code invocation | `claude --output-format json --model … --disallowed-tools 'Bash(ps:*)'`, prompt on stdin | `…::SimpleClaudeRunner.run_security_audit` | `npm i -g @anthropic-ai/claude-code`, `ANTHROPIC_API_KEY` |
| `ps` hardening | Blocks `Bash(ps:*)` so the agent cannot enumerate processes (added 2025-11-25) | same | — |
| Retry + prompt-too-long fallback | 3 attempts; on `Prompt is too long` rebuild without the diff | `…::run_security_audit`, `…::main` | — |
| Tolerant JSON parsing | direct parse → ```json fence → ``` fence → balanced-brace scan | `json_parser.py` | — |
| Finding extraction | Requires the CC wrapper `result` string containing `findings` | `…::_extract_security_findings` | — |
| Hard exclusion rules | 7 deterministic regex families + a Markdown-file rule, with C/C++ and HTML extension conditions | `findings_filter.py::HardExclusionRules` | — |
| Per-finding LLM filter | One Anthropic API call per finding, with the whole file as context | `claude_api_client.py::analyze_single_finding` | `ENABLE_CLAUDE_FILTERING` (hardcoded true), `ANTHROPIC_API_KEY` |
| Custom FP instructions | Replaces the entire default 16/4/17 block | `…::_generate_single_finding_prompt`, `docs/custom-filtering-instructions.md` | `false-positive-filtering-instructions` |
| Fail-open filtering | Keeps the finding with `confidence_score: 10.0` on API failure or when filtering is off | `findings_filter.py::filter_findings` | — |
| Filter statistics | `FilterStats` dataclass → `filter_analysis` block | `findings_filter.py::FilterStats` | — |
| Results artifact | Uploads `findings.json`, `claudecode-results.json`, `claudecode-error.log` | `action.yml` *Upload scan results* (`if: always()`) | `upload-results` (default `true`) |
| Findings count output | `jq` over the results file | `action.yml` *Run ClaudeCode scan* | `jq` |
| PR review posting | One `POST /pulls/{n}/reviews` with `event: COMMENT`, `side: RIGHT` inline comments | `scripts/comment-pr-findings.js` | `pull-requests: write`, `gh` CLI |
| Per-comment fallback | Individual `POST /pulls/{n}/comments` if the review POST fails | same | — |
| Feedback reactions | Posts `+1` and `-1` to each created comment | `…::addReactionsToComment` / `addReactionsToReview` | — |
| Comment dedupe | Any existing `🤖 **Security Issue:` bot comment suppresses posting | same | — |
| Comment silencing | `SILENCE_CLAUDECODE_COMMENTS` env short-circuit — **wired but always `'false'`** | `action.yml` + `comment-pr-findings.js` | dead code path |
| Eval harness | Runs the scanner against any `owner/repo#N` using git worktrees off a single base clone | `claudecode/evals/{run_eval,eval_engine}.py` | `gh`, git 2.20+ |
| Slash command | Same review as a Claude Code `/security-review`, markdown output, subagent fan-out | `.claude/commands/security-review.md` | Claude Code |

## B. Gaps and weaknesses

1. **It cannot fail a build.** `main()` exits 1 when any kept finding is HIGH — but `action.yml` swallows
   it (`|| CLAUDECODE_EXIT_CODE=$?`) and only emits `::warning::`. No check run, no commit status, no
   `REQUEST_CHANGES`. **A HIGH-severity finding leaves the PR fully green.** This is the single biggest
   gap and the clearest thing Loush can add on top.
2. **By default it reviews a PR once, ever.** The cache-marker gate (stage 0) plus the comment dedupe
   (stage 5) mean commit 2 onwards is neither scanned nor commented. Neither behaviour is in the README.
3. **The repo is dormant.** No push since 2026-02-11, no tags, no releases; `@main` is the only
   documented ref. Any parser we write is stable *for now* precisely because nothing is happening.
4. **`claudecode-timeout` appears to be inert.** `action.yml` exports `CLAUDE_TIMEOUT`, but
   `SimpleClaudeRunner` is constructed with no `timeout_minutes` and nothing reads `CLAUDE_TIMEOUT`;
   the effective timeout is the constant `SUBPROCESS_TIMEOUT = 1200` (20 min), which merely coincides
   with the documented default. Setting the input to 40 looks like it should work and does not.
5. **`claude-model` reaches only the filter, and only by accident.** `CLAUDE_MODEL` is read once at
   import time into `DEFAULT_CLAUDE_MODEL` in `constants.py`; the `action.yml` default for the input is
   `''`, while the README documents the default as `claude-opus-4-1-20250805`. The two disagree.
6. **The `results-file` output is wrong for consumers.** It is `claudecode/claudecode-results.json`,
   relative to `$GITHUB_ACTION_PATH`. The usable copy is at the workspace root.
7. **Two incompatible confidence scales on the same object** (0–1 `confidence`, 1–10
   `_filter_metadata.confidence_score`), and `10.0` is overloaded to mean "filter failed" or "filter off".
8. **Heterogeneous `excluded_findings_details`** — three record shapes in one array, one of them
   unwrapped.
9. **Fails open by design.** A dead API key, a 429 storm, or a parse failure yields *more* findings, not
   fewer. Silent: nothing in the output says "filtering did not run" except the `justification` string.
10. **Cost is invisible.** No `total_cost_usd`, no token counts, no per-run spend anywhere in the output.
    The action runs Opus for the scan *and* one Opus call per finding for filtering, and reports neither.
    (A) at least writes cost into an execution file. (B) discards it entirely.
11. **No fingerprint, no rule ID, no CWE.** `category` is free-form model output. Cross-run finding
    identity is unrecoverable without heuristics.
12. **A large PR is silently downgraded.** On `Prompt is too long` the diff is dropped and the model is
    told to go read files instead. Nothing records that the review ran degraded.
13. **The hard-exclusion regexes match prose, not structure.** They run over `description` only. A real
    SQL-injection finding whose description mentions an "unbounded loop" is dropped as DOS noise, and a
    finding that avoids the vocabulary sails through. This is a keyword filter guarding an LLM.
14. **The filter model is shown an unnumbered file and asked about a line number.** `_read_file`'s
    docstring promises line numbers; the code returns raw content.
15. **Explicitly not prompt-injection hardened.** The README says so and points at GitHub's
    "require approval for all external contributors" setting as the mitigation. Note the workflow needs
    `pull-requests: write`; two 2026 write-ups (Microsoft Security Blog, Mallory) cover CI/CD credential
    exposure in the *other* Claude Code GitHub action — **not fetched, not verified against this repo.**
16. **Python + Node 18 + `gh` + `jq` + a global npm install on every run.** Heavier per-run setup than
    (A), and none of it is cached.
17. **No aggregation.** Same core gap as (A): every run is an island. No trend, no "this finding was
    also raised on PR #88", no suppression list that survives a run.
18. **README overstates coverage** (supply chain, TOCTOU) relative to what the prompt asks for and the
    filter permits.

## C. Agent SDK substrate

> Sources for this section are the official docs. `https://docs.claude.com/en/api/agent-sdk/<page>`
> serves an HTML shell whose `<link rel="canonical">` and `<link rel="alternate" type="text/markdown">`
> both point at `https://code.claude.com/docs/en/agent-sdk/<page>`; the markdown mirrors below were
> fetched from that canonical host. Same content, same publisher.

### What it actually is

`@anthropic-ai/claude-agent-sdk` is the Claude Code agent loop as a library, in TypeScript and Python
only. It is **not** the Anthropic Messages API — the docs draw a four-way distinction between the Agent
SDK (runs the loop in your process), the Claude Code CLI (interactive terminal), the Client SDK (you
implement the loop), and Managed Agents (Anthropic hosts the loop and the sandbox).

Important architectural fact for us: **the SDK still spawns a Claude Code subprocess.** It bundles a
native binary per platform as an optional dependency (`@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe`
on Windows), so you do not install Claude Code separately, and `pathToClaudeCodeExecutable` overrides it.
The SDK version tracks the bundled CLI version 1:1 (SDK v0.3.191 ⇒ CLI v2.1.191) — the same coupling
(A) exhibits in its release notes. So the SDK is a **managed subprocess plus a bidirectional control
protocol**, not an in-process model client.

### Node entry points

```ts
import {
  query, startup, tool, createSdkMcpServer,
  listSessions, getSessionMessages, getSessionInfo, renameSession, tagSession,
  resolveSettings,
} from "@anthropic-ai/claude-agent-sdk";
```

`query()` is the primary one:

```ts
function query({
  prompt,
  options
}: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query;
```

`startup(params?: { options?, initializeTimeoutMs? }): Promise<WarmQuery>` pre-spawns the subprocess and
completes the initialize handshake so the first real query does not pay spawn cost (default
`initializeTimeoutMs` 60000). For a dashboard server that wants a sub-second first response, this is the
one to call on boot.

### Streaming

`Query extends AsyncGenerator<SDKMessage, void>` — you `for await` it and get messages as they arrive:
`system` (init), `assistant`, `user`, `stream_event` partials (`includePartialMessages: true`), and a
terminating `result`. Compare with `spawnSync('claude', ['-p', …, '--output-format','json'])`, which is
what `server/eng.mjs` already does at ~line 1336 in `claudeMarkdown()`: that blocks the request handler
and hands you one blob at the end. The generator form is what makes a live Runs/Chat panel possible
without polling.

The `result` message is the richest per-run record either repo exposes:

```ts
type SDKResultMessage =
  | { type: "result"; subtype: "success"; uuid; session_id; duration_ms; duration_api_ms;
      is_error; api_error_status?; num_turns; result; stop_reason; ttft_ms?; ttft_stream_ms?;
      user_message_uuid?; request_sent_wall_ms?; total_cost_usd; usage; modelUsage;
      permission_denials; structured_output?; deferred_tool_use?; terminal_reason?; … }
  | { type: "result"; subtype: "error_max_turns" | "error_during_execution"
        | "error_max_budget_usd" | "error_max_structured_output_retries"; …; errors: string[]; … };
```

Both arms carry `total_cost_usd`, `usage`, `modelUsage` and `permission_denials`, so a failed run still
reports its spend. `terminal_reason` is an enum (`"completed"`, `"max_turns"`, `"budget_exhausted"`,
`"prompt_too_long"`, `"api_error"`, …) — a real status field, which is exactly what (A)'s comment
scraping cannot give us. Caveat from the cost-tracking page: `total_cost_usd` is a **client-side
estimate** computed from a bundled price table, not authoritative billing, and `modelUsage` (not `usage`)
is the field that counts subagent tokens.

### Session control

This is the part that lands directly in Loush, because the SDK's session store *is* the store we already
read. The sessions doc states the on-disk path as
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` and notes that moving that file to another host
(with a matching `cwd`) is how you resume elsewhere.

| API | Signature / field | Use |
|---|---|---|
| `listSessions(options?)` | `Promise<SDKSessionInfo[]>`; options `{ dir?, limit?, includeWorktrees? }` (`includeWorktrees` default `true`) | Enumerate past sessions. Returns `sessionId`, `summary`, `lastModified`, `fileSize`, `customTitle`, `firstPrompt`, `gitBranch`, `cwd`, `tag`, `createdAt`. Sorted `lastModified` desc. |
| `getSessionMessages(sessionId, options?)` | `Promise<SessionMessage[]>`; options `{ dir?, limit?, offset? }` | Paged transcript read. Each message: `type` (`"user"\|"assistant"`), `uuid`, `session_id`, `message` (raw payload), `parent_tool_use_id`, `parent_agent_id`. |
| `getSessionInfo` / `renameSession` / `tagSession` | — | Metadata read + the `/rename` and tag mutations. |
| `options.resume` / `resumeSessionAt` / `forkSession` / `continue` | strings / booleans | Resume by session ID, resume at a specific message UUID, fork to a new ID instead of continuing, or continue the most recent conversation. |
| `options.sessionId` / `persistSession` | `string` / `boolean` (default `true`) | Pin a UUID for the session; `persistSession: false` disables disk persistence entirely (session cannot be resumed). |
| `options.sessionStore` | `SessionStore` (alpha) | Mirror transcripts to an external backend so any host can resume. Paired with `sessionStoreFlush: 'batched' \| 'eager'` and `loadTimeoutMs`. |

**`parent_tool_use_id` and `parent_agent_id` are the subagent-nesting join keys** — the thing that makes
a nested run tree renderable. Loush's Sessions/Runs sections currently reconstruct this by hand from
JSONL.

Live session control on the `Query` handle:

```ts
interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<SDKControlInterruptResponse | undefined>;
  rewindFiles(userMessageId: string, options?: { dryRun?: boolean }): Promise<RewindFilesResult>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  applyFlagSettings(settings): Promise<void>;
  initializationResult(): Promise<SDKControlInitializeResponse>;
  reinitialize(): Promise<SDKControlInitializeResponse>;
  supportedCommands(): Promise<SlashCommand[]>;
  supportedModels(): Promise<ModelInfo[]>;
  supportedAgents(): Promise<AgentInfo[]>;
  mcpServerStatus(): Promise<McpServerStatus[]>;
  getContextUsage(): Promise<SDKControlGetContextUsageResponse>;
  accountInfo(): Promise<AccountInfo>;
  reconnectMcpServer(name): Promise<void>;
  toggleMcpServer(name, enabled): Promise<void>;
  setMcpServers(servers): Promise<McpSetServersResult>;
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
  stopTask(taskId: string): Promise<void>;
  close(): void;
}
```

`getContextUsage()` returns the same breakdown `/context` shows interactively — per category, per skill,
per tool. `mcpServerStatus()` is a live feed for our McpSection. `supportedCommands()`/`supportedAgents()`
are exactly what our Library/Harness panels enumerate from disk today. **All of these are read-only
introspection we currently derive by parsing files.**

Note `interrupt()`, `setPermissionMode()`, `setModel()` and `applyFlagSettings()` are **streaming-input
mode only** — i.e. you must pass an `AsyncIterable<SDKUserMessage>` as the prompt, not a string.

### Permission callbacks — `canUseTool`

The permission evaluation order is documented as six steps: **hooks → deny rules → ask rules →
permission mode → allow rules → `canUseTool`**. `canUseTool` is the last resort, not a universal gate.

```ts
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    toolUseID: string;
    agentID?: string;
    requestId: string;
  }
) => Promise<PermissionResult | null>;

type PermissionResult =
  | { behavior: "allow"; updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[]; toolUseID?: string }
  | { behavior: "deny"; message: string; interrupt?: boolean; toolUseID?: string };
```

Facts that will bite an implementer:

- **Auto-approved tools never reach the callback.** Anything matched by an `allowedTools` entry, a
  settings allow rule, `acceptEdits` or `bypassPermissions` skips it. A bare entry like `"Read"`
  auto-approves every `Read`; a scoped one like `Bash(ls *)` only auto-approves matching calls.
  For a check that must run on **every** tool call, the docs say use a `PreToolUse` hook instead.
- The SDK detects the footgun: as of v2.1.198 it emits a Node process warning with code
  `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` when your callback is unreachable
  (`bypassPermissions`, or bare `allowedTools` entries). Listen with `process.on('warning', …)`.
- **Returning `null` blocks the tool forever** unless your app already sent the `control_response`
  out-of-band echoing `requestId`. Permission prompts do not time out.
- `AskUserQuestion`, MCP tools flagged `requiresUserInteraction`, and org-`ask` connector tools reach the
  callback **even when an allow rule matches** — except in `dontAsk`, which denies them.
- `PermissionMode` is `"default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto"`.
  For a headless dashboard-driven agent the docs' recommended shape is
  `{ allowedTools: [...], permissionMode: "dontAsk" }` — an explicit tool surface with a hard deny
  instead of a silent reliance on `canUseTool` being absent. `bypassPermissions` additionally requires
  `allowDangerouslySkipPermissions: true`.
- **`allowedTools` does not constrain `bypassPermissions`** — unlisted tools fall through to the mode and
  get approved. Use `disallowedTools` to actually block.
- Subagents inherit the parent mode, and `bypassPermissions` / `acceptEdits` / `auto` **cannot be
  overridden per subagent**.

### Other `Options` worth naming for a dashboard server

`maxBudgetUsd` (stop when the client-side cost estimate hits a USD value → `subtype: "error_max_budget_usd"`),
`maxTurns`, `abortController`, `cwd`, `additionalDirectories`, `env` (**replaces** the subprocess env, so
spread `process.env`), `model` / `fallbackModel`, `outputFormat: { type: 'json_schema', schema }`
(structured outputs — the SDK analogue of (A)'s `--json-schema`), `hooks`, `agents`
(programmatic subagent definitions), `mcpServers` + `strictMcpConfig`, `settingSources` (pass `[]` to
ignore user/project/local settings), `systemPrompt` (`{ type: 'preset', preset: 'claude_code', append }`),
`sandbox`, `enableFileCheckpointing` (enables `rewindFiles`), `spawnClaudeCodeProcess` (run the CLI in a
container/VM), `stderr`, `skills`, `plugins`.

### How it differs from shelling out to the `claude` CLI

| Concern | `spawnSync('claude', ['-p', …, '--output-format','json'])` — what Loush does today | Agent SDK |
|---|---|---|
| Output | One JSON blob after the run completes; handler blocked | `AsyncGenerator<SDKMessage>`, incremental, with optional partial-message events |
| Mid-run control | None. Kill the process. | `interrupt()`, `setPermissionMode()`, `setModel()`, `applyFlagSettings()`, `stopTask()`, `close()` |
| Permissions | Whatever `--allowedTools` / settings say, decided before launch | Six-step flow with a runtime `canUseTool` callback and in-process `PreToolUse` hooks |
| Hooks | Shell commands configured in settings | JavaScript functions in your process, with typed inputs per `HookEvent` |
| MCP | Separate processes / config files | `createSdkMcpServer()` + `tool()` run **in-process**; `setMcpServers()` swaps them live |
| Sessions | Parse `~/.claude/projects/**/*.jsonl` yourself | `listSessions()` / `getSessionMessages()` over the same store, plus `resume` / `forkSession` / `resumeSessionAt` |
| Cost | Read `total_cost_usd` out of the `-p` JSON if present | `result.total_cost_usd` + `modelUsage` per model + `maxBudgetUsd` as a hard stop |
| Startup latency | Full spawn every call | `startup()` pre-warm; `WarmQuery` |
| Introspection | Shell out again for each question | `getContextUsage()`, `mcpServerStatus()`, `supportedCommands/Models/Agents()`, `accountInfo()` |
| Dependency footprint | Whatever `claude` the user already has | An npm dep plus a bundled platform binary; SDK version pinned to a CLI version |
| Language | Any | TypeScript / Python only (the docs say to run the CLI as a subprocess from other languages) |
| Licence | — | **Not open source.** Anthropic Commercial Terms (see licensing section) |

For Loush specifically: we are plain ESM JavaScript with no TypeScript. The TS SDK is consumable from
plain JS (it ships types, not a TS-only API), so `import { query } from '@anthropic-ai/claude-agent-sdk'`
works in `server/*.mjs` unchanged. The real costs are (a) a new dependency that pulls a platform-specific
native binary, (b) a commercial-terms licence where everything else in our stack is permissive, and
(c) tying our server to a CLI version.

## Overlap with Loush Dashboard

| Their feature | Our equivalent section | Who does it better | Note |
|---|---|---|---|
| (A) `@claude` tracking comment on a PR | **Delivery** | Them (they write it, we can only read it) | Our win is *aggregating* them; theirs is one comment per run with no history. |
| (A) branch creation with `claude/` prefix | **Delivery** | Even | We already list PRs/branches via `gh` in `server/eng.mjs`; a `claude/` glob is a free "agent-authored work" filter. |
| (A) execution file (`total_cost_usd`, turn stream) | **Runs** | Us, if we can get the file | Same shape as the local transcripts we already parse — but it is not uploaded by default. |
| (A) `structured_output` via `--json-schema` | **Runs** / **Quality** | Them | It lets a workflow emit *our* schema. Nothing on our side competes. |
| (A) OTEL cost/token export | **Runs** | Them (push) vs us (pull) | Conflicts with our zero-telemetry stance unless the collector is the user's own box. |
| (A) config restore from base ref (`CLAUDE.md`, `.claude/`, `.mcp.json`) | **Governance** | Them | Base-vs-head divergence on agent config is a governance event we don't currently detect. |
| (A) trigger-phrase regex / "why didn't Claude fire?" | **Inbox** | Us | Trivial to reimplement client-side; genuinely useful and they offer no UI for it. |
| (A) inline-comment classification (Haiku, real-review vs probe) | **Quality** | Them | An FP filter we don't have. |
| (B) structured finding records (`file`,`line`,`severity`,`category`,…) | **Bugs** | Them | This is the schema we want. We have no scanner; we have a place to put findings. |
| (B) `🤖 **Security Issue:` PR review comments | **Bugs** (+ **Inbox** for the unread queue) | Them for authoring, **us for triage** | They post once and never revisit. We can track state, age, recurrence. |
| (B) `security-review-results` artifact | **Bugs** | Us | Uploaded by default, 7-day retention, contains the full excluded-findings audit trail. |
| (B) excluded-findings audit trail (`filter_stage`, `exclusion_reason`) | **Quality** | Us | Nobody surfaces *what was suppressed and why*. That is a dashboard feature, not a CI feature. |
| (B) filter statistics (`hard_excluded`, `claude_excluded`, `average_confidence`, `runtime_seconds`) | **Quality** / **Runs** | Us | Per-run only on their side; a trend line is ours to build. |
| (B) 👍/👎 reactions on findings | **Bugs** | Them for capture, us for use | Reaction counts are readable via the GitHub API and are a free human-labelled precision signal. |
| (B) severity → build gate | **NONE** | Neither — nobody does it | They exit 1 and the action swallows it. Genuine open ground. |
| (B) SARIF / code scanning | **NONE** | Neither | Neither repo emits SARIF. |
| (B) once-per-PR run gate | **Inbox** | Us | We can detect "PR has 6 commits, one security review from commit 1" and flag it. |
| (B) `/security-review` slash-command runs (local) | **Runs** / **Sessions** | Us | Local runs already land in `~/.claude` transcripts we parse. Their markdown report is in the transcript. |
| (C) `listSessions()` / `getSessionMessages()` | **Sessions** / **Runs** | Even — same data, different door | Same `~/.claude/projects/**/*.jsonl` store. Their API adds `gitBranch`, `tag`, `customTitle`, `parent_agent_id`. |
| (C) `canUseTool` runtime approvals | **NONE** (would be new) | Them | We have no agent-execution surface today; this is what one would be built on. |
| (C) `getContextUsage()`, `mcpServerStatus()`, `supportedAgents()` | **Harness** / **Mcp** / **Library** | Them | We derive these from files; the SDK reports them live and authoritatively. |
| (C) `maxBudgetUsd` | **Runs** | Them | A hard cost cap. Neither (A) nor (B) has one. |
| Cross-run aggregation, history, trend, spend | **Overview / Runs / Quality** | **Us, uncontested** | Confirmed again: all three upstream things are stateless per run. |

## Recommended adoptions

Ranked by (value ÷ effort). The load-bearing distinction: **ingesting their output costs us one parser
and buys a whole section; porting their code costs us a language boundary and buys us a scanner we then
have to pay for.** Ingestion wins everywhere except items 6 and 7.

**1. Ingest `claudecode-results.json` from the `security-review-results` artifact. — INGEST. Effort S.**
Lands in `server/eng.mjs` (new function beside the `gh()` helper at ~line 455) and
`src/sections/BugsSection.jsx`.
`gh api /repos/{o}/{r}/actions/runs/{id}/artifacts` → find `security-review-results` → download zip →
read `claudecode-results.json`. Map `findings[]` straight onto our Bugs model:
`file`/`line`/`severity`/`category`/`description`/`exploit_scenario`/`recommendation`,
plus `_filter_metadata.confidence_score` and `justification`.
**Unlocks:** a real Bugs section with structured, line-anchored, severity-graded findings — the first
findings data Loush has ever had. Uploaded by default, so zero user configuration. Watch the 7-day
retention: we must poll, not backfill.

**2. Parse `🤖 **Security Issue:` PR review comments. — INGEST. Effort S.**
Lands in `server/eng.mjs` (extend the existing PR GraphQL/REST fetch) and `src/sections/BugsSection.jsx`.
Filter `GET /pulls/{n}/comments` on `user.type === 'Bot'` + body prefix, then split the four
`**Label:** value` lines. Also read `reactions.+1` / `reactions.-1` per comment.
**Unlocks:** findings even when the artifact has expired, plus a **human-labelled precision metric** —
👎 count over total findings, per repo, over time. That number is the single most interesting thing
either repo produces and nobody displays it. Belongs in Quality.

**3. Surface the excluded-findings audit trail. — INGEST. Effort S.**
Lands in `src/sections/QualitySection.jsx`, fed by the same ingest as #1.
Render `filtering_summary.filter_analysis` (`hard_excluded`, `claude_excluded`, `directory_excluded_count`,
`exclusion_breakdown`, `average_confidence`, `runtime_seconds`) and let a user expand
`excluded_findings_details`. Key off `filter_stage` — remember three record shapes, one unwrapped.
**Unlocks:** "what did the scanner throw away, and was it right?" — the question every security team asks
and no CI tool answers. Also exposes the fail-open case: `justification` containing `Claude API failed`
or `Claude filtering disabled` means the run was unfiltered, and we should badge it.

**4. Detect the once-per-PR gate and the comment-dedupe blind spot. — INGEST (derived). Effort S.**
Lands in `src/sections/InboxSection.jsx` with a helper in `server/eng.mjs`.
If a PR has >1 commit after the SHA of its only security review comment, the later commits were never
scanned. Same check for (A): count `@claude` mentions vs runs.
**Unlocks:** a genuinely novel Inbox card — "PR #412: 7 commits, 1 security review (commit 1). 6 commits
unreviewed." Neither upstream repo can tell you this; it only exists once you keep history.

**5. Ingest the (A) execution file for cost. — INGEST. Effort M.**
Lands in `server/eng.mjs` + `src/sections/RunsSection.jsx`.
Requires the user to add one `actions/upload-artifact` step pointed at
`${{ steps.claude.outputs.execution_file }}`. Then the final `type: "result"` element gives
`total_cost_usd` and `duration_ms` — the only file-based route to real CI cost.
**Unlocks:** CI spend in Runs. Effort is M only because of the required workflow edit; ship a
copy-pasteable snippet in SetupSection.

**6. Port `HardExclusionRules` to JS as a client-side noise classifier. — PORT. Effort M.**
Lands in a new `src/lib/finding-filters.js`, used by `src/sections/BugsSection.jsx`.
~120 lines of regex in `findings_filter.py`, mechanically translatable (Python `re` → JS `RegExp`, all
`IGNORECASE` → `i`). MIT-licensed, attribution required.
**Unlocks:** letting a Loush user re-run the suppression locally with *their* thresholds against the
*unfiltered* set — i.e. undo Anthropic's opinions without re-running the scan. Also gives us the same
noise vocabulary for findings arriving from anywhere else. Do this only after #1 and #3 exist.

**7. Adopt the Agent SDK for in-dashboard agent runs. — PORT (dependency). Effort L.**
Lands in a new `server/agent.mjs`, replacing the `spawnSync('claude', ['-p', …])` pattern in
`server/eng.mjs` (~line 1336, `claudeMarkdown()`), with UI in `src/sections/RunsSection.jsx` /
`ChatSection.jsx`.
Do it for `canUseTool` + streaming + `maxBudgetUsd`, not for parity. **Decide the licence question
first** — the SDK is under Anthropic Commercial Terms, not MIT, which is a different posture from the
rest of the stack. A cheaper half-step: adopt only `listSessions()` / `getSessionMessages()` as a
cross-check on our own JSONL parser (effort S, same dependency question).

**8. Governance: flag PRs that touch agent config. — INGEST (derived, idea borrowed). Effort S.**
Lands in `src/sections/GovernanceSection.jsx`.
Reuse (A)'s `SENSITIVE_PATHS` list (`.claude`, `.mcp.json`, `.claude.json`, `.gitmodules`, `.ripgreprc`,
`CLAUDE.md`, `CLAUDE.local.md`, `.husky`) as a path filter over the PR file list we already fetch.
**Unlocks:** "this PR changes what the agent is allowed to do" as a first-class governance event.
The idea is theirs; the code is four lines of ours.

**Explicitly not recommended:** porting the Python scanner (`github_action_audit.py` +
`claude_api_client.py`) into `server/`. It would put a Python dependency and a per-finding Opus call
inside a local-first, zero-telemetry dashboard, and duplicate a thing the user's CI already runs.

## Licensing and branding notes

**(A) `anthropics/claude-code-action`** — MIT (`license.spdx_id` = `MIT`), `LICENSE` at repo root.
The vendored `base-action/` has its own `LICENSE` and a `MIRROR_DISCLAIMER.md`.

**(B) `anthropics/claude-code-security-review`** — MIT (`license.spdx_id` = `MIT`), single `LICENSE` at
repo root reading `Copyright (c) 2025 Anthropic`, standard MIT text with the usual
"as is, without warranty" disclaimer.

MIT terms, factually: use, copy, modify, merge, publish, distribute, sublicense and sell are permitted;
the sole condition is that **the copyright notice and the permission notice be included in all copies or
substantial portions of the Software**. So if we port `HardExclusionRules` (adoption #6) we must carry
`Copyright (c) 2025 Anthropic` and the MIT permission text in that file. Loush's own licence is
unchanged; MIT is compatible with essentially everything.

**(C) The Claude Agent SDK is not open source.** The overview page states use is "governed by
Anthropic's Commercial Terms of Service", including when used to power products offered to our own
customers, except where a specific component's own LICENSE file says otherwise. This is materially
different from (A) and (B), and is the single biggest non-technical consideration in adoption #7.

**Authentication constraint (C).** The docs state that, unless previously approved, third-party
developers may not offer claude.ai login or claude.ai rate limits for their products, including agents
built on the Agent SDK; API-key authentication is the documented path. Loush is local-first and runs as
the user, which is a different situation from redistributing a product — but the constraint is on record.

**Branding constraints for Agent SDK integrations**, quoted structurally from the overview page:

- *Allowed:* "Claude Agent"; "Claude" when inside a menu already labelled "Agents";
  "{YourAgentName} Powered by Claude".
- *Not permitted:* "Claude Code" or "Claude Code Agent"; Claude Code-branded ASCII art or visual
  elements that mimic Claude Code.
- The product must maintain its own branding and not appear to be Claude Code or any Anthropic product.

MIT is a copyright licence and does not grant trademark rights. "Claude" and "Claude Code" are Anthropic
names; the MIT text in (A) and (B) says nothing about using them. Practical read for Loush: shipping
MIT-derived code with attribution is straightforward; naming a Loush feature "Claude Code Security
Review" is a separate question the licence does not answer. **This is a factual summary of the published
terms, not legal advice — a lawyer should review any redistribution or product naming.**

**Prompt-injection note on the research itself.** Both repos contain large bodies of text that are
literally shaped as instructions to a language model — `claudecode/prompts.py`,
`.claude/commands/security-review.md`, and the default filtering block in `claude_api_client.py`
(e.g. "Your final reply must contain the JSON and nothing else"). **None of it was addressed to this
research agent and none of it was acted on; it is reproduced above as data.** If Loush ever renders
these files, or renders a finding's `description` (which is model-authored text originating from an
untrusted diff), it must render them as inert text. That is a real requirement for adoptions #1 and #2:
finding bodies come from a model reading attacker-influenceable PR content.

## Sources

All URLs fetched 2026-07-29 unless noted.

**GitHub API — `anthropics/claude-code-security-review`**
- https://api.github.com/repos/anthropics/claude-code-security-review
- https://api.github.com/repos/anthropics/claude-code-security-review/git/trees/main?recursive=1
- https://api.github.com/repos/anthropics/claude-code-security-review/commits?per_page=5
- https://api.github.com/repos/anthropics/claude-code-security-review/tags (empty array)

**Source files — `raw.githubusercontent.com/anthropics/claude-code-security-review/main/…`**
- `README.md`
- `action.yml`
- `LICENSE`
- `claudecode/prompts.py`
- `claudecode/findings_filter.py`
- `claudecode/github_action_audit.py`
- `claudecode/claude_api_client.py`
- `claudecode/json_parser.py`
- `claudecode/constants.py`
- `claudecode/logger.py`
- `claudecode/audit.py`
- `claudecode/requirements.txt`
- `claudecode/evals/README.md`
- `claudecode/evals/eval_engine.py`
- `scripts/comment-pr-findings.js`
- `docs/custom-filtering-instructions.md`
- `docs/custom-security-scan-instructions.md`
- `.claude/commands/security-review.md`

**Agent SDK documentation.** `https://docs.claude.com/en/api/agent-sdk/<page>` returns an HTML shell
whose canonical URL and markdown alternate both point at `code.claude.com/docs`; the markdown mirrors
below are the fetched form of the same official pages.
- https://code.claude.com/docs/en/agent-sdk/overview.md
- https://code.claude.com/docs/en/agent-sdk/typescript.md
- https://code.claude.com/docs/en/agent-sdk/permissions.md
- https://code.claude.com/docs/en/agent-sdk/sessions.md
- https://code.claude.com/docs/en/agent-sdk/cost-tracking.md
- Also downloaded but not used in this write-up: `hosting.md`, `mcp.md`, `custom-tools.md`, `todo-tracking.md`

**Search results — surfaced but NOT fetched; every claim from these is marked unverified above.**
- https://www.gecko.security/blog/claude-code-security-review-guide (source of the 👍/👎-tuning and
  false-positive-rate claims)
- https://www.microsoft.com/en-us/security/blog/2026/06/05/securing-ci-cd-in-agentic-world-claude-code-github-action-case/
- https://www.mallory.ai/stories/019e9363-2aa4-769c-8bc7-258d5518fb6b
- https://devops.com/anthropic-adds-automated-security-reviews-to-claude-code/
- https://github.com/anthropics/claude-code/issues/65596 and /issues/72256 (safeguard false positives on
  security-review workflows — different repo, cited only as context)
- https://www.anthropic.com/news/automate-security-reviews-with-claude-code (linked from the README)

**Our own repo, for grounding the adoption targets**
- `server/eng.mjs` (the `gh()` `spawnSync` helper at ~line 455; `claudeMarkdown()`'s
  `spawnSync('claude', ['-p', …])` at ~line 1336)
- `src/sections/` (BugsSection, InboxSection, QualitySection, RunsSection, DeliverySection,
  GovernanceSection, McpSection, HarnessSection, LibrarySection, SessionsSection)
