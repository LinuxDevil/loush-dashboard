# Anthropic official GitHub-native automation

> Research status: IN PROGRESS (written incrementally). Sections marked TODO are not yet
> filled. Facts not verified against a primary source are explicitly marked `unverified`.
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

TODO

## B. The problem it solves

TODO

## B. Finding schema

TODO

## B. Rule set / prompt strategy and false-positive handling

TODO

## B. Feature inventory

TODO

## B. Gaps and weaknesses

TODO

## C. Agent SDK substrate

TODO

## Overlap with Loush Dashboard

TODO

## Recommended adoptions

TODO

## Licensing and branding notes

TODO

## Sources

TODO
