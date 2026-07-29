# SPEC — GitHub CI and security-finding ingestion

> Turns `anthropic-official-github.md` (research) into shippable work against **this** codebase.
> Written 2026-07-29. Every implementation step cites a file and line I actually read in this
> checkout. Where our code disagrees with the research, our code wins and the disagreement is
> called out. Anything I could not verify from source is marked **unverified**.

## The thesis, restated in our terms

`anthropics/claude-code-action` and `anthropics/claude-code-security-review` are **stateless per
run** (research §A gaps 1, §B gaps 17). They write machine-readable state into repositories that
`server/eng.mjs` already talks to through the `gh` CLI (`server/eng.mjs:454`). So the work is
**one parser and a poll**, not a port. Nothing in this spec requires us to run either action on a
user's behalf, and nothing requires a new npm dependency.

---

## Things this codebase already does that the research did not know

These change the design, so they come before the features.

1. **`BugsSection.jsx` is not a findings surface.** It is a local bug tracker over
   `~/.claude/bugs.json` (`server/index.mjs:3508`, `src/sections/BugsSection.jsx:77`) with a
   trace parser, git-bisect runner and root-cause prompt builder. It is plane B / this machine.
   The research assumed CI findings land there. They cannot land there *automatically*: every
   write goes through `writeBugs` → `track()` (`server/index.mjs:3510`), which versions the file
   into the governance audit log. A 10-second poll (`src/sections/BugsSection.jsx:78`) that
   auto-imported findings would write a governance version per poll. **Import into Bugs must be
   an explicit, idempotent, user-initiated action.**

2. **We already parse security findings — from transcripts.** `scanTranscripts()` picks up the
   `ReportFindings` tool call emitted by the native `/review` and `/security-review` slash
   commands (`server/index.mjs:2382-2385`) into
   `{file, line, summary, category, verdict, outcome}`, and `reviewData()`
   (`server/index.mjs:4047-4071`) rolls them into `/api/reviews` with a `recurring` ≥3-passes
   rollup. `src/sections/QualitySection.jsx:166-241` renders them. **This is the natural home for
   CI findings**, not a new section: the row renderer at
   `src/sections/QualitySection.jsx:227-235` already draws `category / summary / file:line`.
   It also means we will hold two finding shapes (local markdown-ish, CI JSON) and the normalised
   shape below has to serve both.

3. **`fetchPRs()` drops PRs with no ticket key.** `server/eng.mjs:508-509` requires the branch or
   title to match `cfg.ticketRegex`. A repo whose PRs are not JIRA-keyed produces an empty
   `snap.prs`. **Security-finding ingestion must key off repo + workflow run + PR number from the
   artifact itself**, never off `snap.prs`, or it silently sees nothing.

4. **Neither CI reader will see a `pull_request` run.** `ciFor()` fetches
   `/actions/runs?branch=${default_branch}` (`server/eng.mjs:570`) and `repoCI()` calls
   `gh run list --branch main` (`server/index.mjs:3777, 3783`). Security-review runs fire on
   `pull_request` and carry the PR head branch. We need a separate, PR-scoped run query.

5. **Both CI readers drop in-flight runs and treat `success` as healthy.**
   `server/eng.mjs:571` filters `r => r.conclusion`; `server/index.mjs:3789` keeps only
   `success|failure`. A security-review job that found a HIGH and still exited 0 is counted as a
   healthy run in both. That is precisely the blind spot in *What we can show that GitHub cannot*.

6. **Our bot filter already protects us.** `BOT` (`server/eng.mjs:453`) excludes
   `github-actions` and any `*[bot]` login, and `realReviews` (`server/eng.mjs:512`) applies it.
   So a security-review `event: COMMENT` review will **not** silence the
   "PR #N has had zero reviews" inbox item (`server/index.mjs:2669`). Verified non-regression —
   no change needed, but do not "fix" `BOT` later without re-checking this.

7. **`test/server/eng-privacy.test.js:10` bans the field names the execution file uses.** The
   `BANNED` regex matches `cost`, `usd`, `spend`, `session`, `sessionid`, `duration_ms`, `tokens`
   anywhere in a `/api/eng/*` payload shape. `total_cost_usd`, `duration_ms` and `session_id`
   from `claude-execution-output.json` all trip it. This is the single hardest constraint on
   feature 9 and is addressed there. **Do not rename fields to dodge the guard** — that is the
   exact failure mode the honesty rules in `README.md:418-452` exist to prevent.

8. **Untrusted text must never reach `marked`.** `marked.parse` + `dangerouslySetInnerHTML` is
   used in five places (`src/sections/ChatSection.jsx:71`, `src/ui/viewers.jsx:128`,
   `src/sections/TicketSection.jsx:493`, `src/sections/ResourceSection.jsx:45`,
   `src/ticket/DesignChat.jsx:99`) and `marked` does not sanitise. A finding's `description`,
   `exploit_scenario` and `recommendation` are **model output derived from an attacker-influenceable
   diff**. Render them as React text nodes, the way
   `src/sections/QualitySection.jsx:230` already does. This is a hard rule, repeated in every DoD.

---

# Features, ordered by value ÷ effort

### 1. Ingest the `security-review-results` artifact

**Customer need.** A team runs `anthropics/claude-code-security-review@main` on PRs. The findings
exist for exactly as long as someone is looking at the PR page. Today, to answer "what security
findings did we get this month, and did anyone act on them?", an engineer opens PRs one at a time
and reads bot comments. There is no list, no history, no state. Our Bugs section says
*"no bugs have been recorded here yet"* (`src/sections/BugsSection.jsx:147`) — which is honest and
also useless, because the findings are sitting in GitHub untouched.

**Value to Loush.** This is the first structured, line-anchored, severity-graded findings data the
dashboard has ever had. It is uploaded **by default** (`upload-results` defaults `'true'`, step is
`if: always()`), so it costs the user zero configuration — unlike every other ingestion in this
spec. Retention is 7 days, which means we are the only place the history will exist after a week.

**How the upstream repo does it today.** `action.yml` redirects the scanner's stdout to
`claudecode/claudecode-results.json`, copies it to `${{ github.workspace }}/claudecode-results.json`,
derives `findings.json` via `jq '.findings // []'`, and uploads all three plus
`claudecode-error.log` as artifact `security-review-results`, `retention-days: 7`,
`if-no-files-found: ignore`. The declared `results-file` output is
`claudecode/claudecode-results.json` *relative to `$GITHUB_ACTION_PATH`* and does not resolve for a
consumer — use the artifact, not the output.

**How we implement it here.**

- New module `server/security-findings.mjs`. It must not import from `server/index.mjs`; it may be
  imported by `server/eng.mjs`. It reuses the shell-out shape of `gh()` (`server/eng.mjs:454`) —
  copy the 4-line helper rather than exporting `gh()`, so `server/eng.mjs`'s export list
  (`server/eng.mjs:1346`) stays a plane-A-only surface.
- Discovery, per configured project with a `githubRepo` (`loadProjects()`, `server/eng.mjs:81`):
  ```
  gh api "/repos/{repo}/actions/artifacts?per_page=100"   →  filter name === 'security-review-results'
                                                              && expired === false
  ```
  Each artifact record carries `workflow_run.id` and `workflow_run.head_sha`. Do **not** enumerate
  runs first — the artifacts endpoint is one call per repo and already carries the join keys.
  `ghJSON()` (`server/eng.mjs:562`) is the exact call shape.
- Download: `gh run download {run_id} --repo {repo} --name security-review-results --dir {tmp}`.
  `gh` extracts the zip itself, so **no zip dependency is added**. `spawnSync` with the same
  `timeout`/`maxBuffer` discipline as `gh()`. Binary must never pass through
  `r.stdout.toString()`. *(The exact `gh run download` flag spelling should be asserted against the
  installed `gh` on first run — `gh()` throws on non-zero status, and a flag rename would surface
  as a hard error, not a silent empty list.)*
- Parse `claudecode-results.json` with the parser specified in **The finding parser** below.
  Also read `claudecode-error.log` if present: a non-empty log next to `"findings": []` is the
  difference between "scan errored" and "scan was clean".
- Persist to a new `ENG_STATE.securityFindings` entry in `lib/paths.mjs:109-114`, alongside
  `bugOwnership` / `triage` / `epicTargets` / `artifacts`. **Persistence is not optional**: the
  artifact expires at 7 days, our snapshot disk cache has a 14-day max age
  (`server/eng.mjs:1008`), and without our own store the history evaporates. Store keyed
  `{repo}#{pr_number}@{run_id}` so a re-run appends rather than overwrites, and record
  `ingestedAt`, `runId`, `headSha`, `artifactExpiresAt`.
- Cache like `ciFor()` does: module-level `Map`, 30-minute TTL (`server/eng.mjs:560-561`), and
  fold into `persistDisk()`'s payload (`server/eng.mjs:1019-1027`) only if you also bump
  `SNAP_SCHEMA` (`server/eng.mjs:1007`) — otherwise leave it in its own file.
- Route: `GET /api/eng/security-findings?project=<key|all>`, mounted in `mountEng`
  (`server/eng.mjs:1371`), modelled on `/api/eng/ci` (`server/eng.mjs:1452-1458`) — its own route
  so it can be polled without dragging a 65-second cold snapshot behind it.
- UI: new tab `'CI security review'` in `src/sections/QualitySection.jsx:26`. Reuse the finding row
  at `src/sections/QualitySection.jsx:227-235` verbatim in shape; add a severity pill using the
  existing `SEV` palette convention from `src/sections/BugsSection.jsx:8`.

**Effort.** **S.** One new server module (~180 lines), one route, one tab. No schema migration,
no new dependency, no user configuration.

**Risks and unknowns.**
- 7-day retention means we **poll, we cannot backfill**. A dashboard that has been off for two
  weeks has a permanent hole. The UI must say so rather than implying a complete history.
- The upstream repo is dormant (last push 2026-02-11, zero tags, zero releases). `@main` is the
  only ref, so the JSON shape is stable *because nothing is happening*, not because it is
  versioned. A single upstream commit can change it with no signal.
- `gh api /actions/artifacts` pagination is capped at 100 here; a busy monorepo could push
  `security-review-results` off the first page. Filter server-side by name is not supported by the
  endpoint — if this bites, walk pages until the oldest record is past our retention window.
- Findings text is model output over an attacker-influenceable diff (see cross-cutting rule 8).

**Definition of done.**
- With `gh` unauthenticated: the tab renders *"gh CLI not authenticated — security findings are
  empty, not zero"*, reusing the wording pattern of `GH_UNAUTHED` (`server/eng.mjs:1032`).
- With `gh` authed and a repo that has never run the action: *"no `security-review-results`
  artifact has ever been produced in this repo — this is an absent scanner, not a clean scan."*
- With a repo that ran it and found nothing: *"1 scan, 0 findings kept"* plus the pre-filter count
  from `filtering_summary`, so a zero is visibly a measured zero.
- With findings: each row shows severity, category, `file:line`, description, and both confidence
  numbers on their own scales (see parser).
- An artifact whose `expired: true` is skipped without an error, and the count of skipped-expired
  runs is shown.
- No finding text passes through `marked`.
- A unit test over a fixture `claudecode-results.json` in `test/fixtures/` asserting the normalised
  shape, including the empty-shell case (`review_completed: false`).

---

### 2. Parse `🤖 **Security Issue:` PR review comments, with reactions

**Customer need.** The artifact expires in 7 days; the comments never do. And the comments carry
something the artifact does not: **a 👍/👎 a human actually clicked**. Today nobody can answer "how
often is our security scanner right?" — the only people who know are the reviewers who thumbed a
comment down and moved on.

**Value to Loush.** Two things. (a) Findings survive artifact expiry, so history is continuous.
(b) A **human-labelled precision signal**: 👎 count ÷ findings, per repo, over time. That number is
the most interesting thing either upstream repo produces and neither of them displays it. It
belongs beside the escape-rate series in `quality()` (`server/eng.mjs:755-812`).

**How the upstream repo does it today.** `scripts/comment-pr-findings.js` posts **one formal
review**: `POST /repos/{o}/{r}/pulls/{n}/reviews` with `event: 'COMMENT'` (never `APPROVE` /
`REQUEST_CHANGES`) and inline comments `{path, line, side: 'RIGHT', body}`. Body template:

```
🤖 **Security Issue: {message}**

**Severity:** {severity}
**Category:** {category}
**Tool:** ClaudeCode AI Security Analysis

**Exploit Scenario:** {exploit_scenario}      ← conditional
**Recommendation:** {recommendation}          ← conditional
```

For every comment created it then posts `+1` and `-1` to `/pulls/comments/{id}/reactions`, so each
finding arrives with both reactions pre-seeded. If the review POST throws it falls back to one
`POST /pulls/{n}/comments` per finding. `confidence` never reaches the comment.

**How we implement it here.**

- The selector is the literal body prefix `🤖 **Security Issue:` on a comment whose
  `user.type === 'Bot'`. It appears in exactly one place upstream and is stable.
- Fetch: `gh api "/repos/{repo}/pulls/{n}/comments?per_page=100"` per PR that has a security-review
  run. **Do not** bolt this onto the GraphQL query at `server/eng.mjs:491` — that query is already
  large, is paginated 6×50 (`server/eng.mjs:501`), and only returns ticket-keyed PRs
  (`server/eng.mjs:508`). A separate REST call scoped to PRs we already know had a scan is cheaper
  and does not inherit the ticket-regex filter.
- Body parse: split on `\n`, match `^\*\*(Severity|Category|Tool|Exploit Scenario|Recommendation):\*\*\s*(.*)$`,
  take the title from `^🤖 \*\*Security Issue: (.*)\*\*$`. Absent optional sections → `null`, never
  `''`. Do not regex the whole body in one shot; the prose fields contain `**`.
- Reactions: read `comment.reactions['+1']` and `['-1']` from the same payload. **Subtract the
  pre-seeded pair**: upstream seeds exactly one of each, so `humanUp = max(0, up - 1)` and
  `humanDown = max(0, down - 1)`. Without this every finding reads as 1 up / 1 down forever, and
  the precision metric is a constant. If either raw count is `0` the seeding did not happen (the
  reaction POST is best-effort) — record `seeded: false` and do not subtract. **This asymmetry is
  the single most likely source of a wrong number in this whole spec.**
- Reconcile with feature 1 by the identity key defined in the parser section. A finding present in
  both sources is one record with two provenances.
- Precision panel in `src/sections/QualitySection.jsx`, next to the findings list. Denominator
  visible, per honesty rule 4 (`README.md:430`) and synthesis §6.

**Effort.** **S.** One fetch, one body parser, one derived ratio.

**Risks and unknowns.**
- **Upstream dedupe means the comment set is incomplete by design.** Before posting, the script
  filters existing bot comments for `🤖 **Security Issue:`; if even one exists, *the entire run
  posts nothing* — including genuinely new findings. So comments are a floor on findings, never a
  count. Label the panel accordingly.
- The 👍/👎-harvesting claim in the research is marked **unverified** and no code in the upstream
  repo does it. Our use of the reactions is our own; do not repeat the claim in the UI.
- Findings whose `file` is not in `GET /pulls/{n}/files` are silently dropped upstream. Artifact
  count > comment count is normal and must not be rendered as an error.
- **Unverified:** whether GitHub's `reactions` object on a review comment includes reactions added
  by the same bot that created it. If it does not, the subtract-the-seed logic is wrong in the
  other direction. Verify against one real comment before shipping the ratio.

**Definition of done.**
- A PR with a security review shows its findings even when the artifact has expired, tagged
  `source: comment`.
- A PR with both shows one merged row tagged `source: artifact+comment`.
- Precision panel shows `N findings · M 👎 · K 👍` with N as a visible denominator, and renders
  `—` (not `0%`) when N is 0 — honesty rule 1 (`README.md:422`).
- A repo with zero bot comments renders *"no security-review comments found on the PRs we can see"*
  and names how many PRs were checked.
- `seeded: false` records are excluded from the ratio and counted separately.

---

### 3. Surface the once-ever scan gate and the green-despite-HIGH job

This is the differentiated feature. Full mechanism is in **What we can show that GitHub cannot**
below; this entry is the shippable slice.

**Customer need.** A tech lead believes every commit on a PR gets a security review, because the
PR page shows a review and a green check. Both beliefs are wrong, and GitHub's UI gives them no way
to find out.

**Value to Loush.** Two Inbox cards that no upstream tool and no GitHub view can produce, because
producing them requires keeping history — the one thing we do and they do not (research §A gap 1,
§B gap 17, synthesis §7 "cross-run aggregation … us, uncontested").

**How the upstream repo does it today.** It does not surface either. The cache-marker gate lives in
`action.yml` (`actions/cache` keyed `claudecode-{repository_id}-pr-{number}-{sha}` with
`restore-keys` on the PR prefix, holding `.claudecode-marker/marker.json`); when it restores and
`run-every-commit != 'true'`, `enable_claudecode` is set false and the whole scan and comment step
are skipped. And `main()` exits 1 on a kept HIGH finding, but `action.yml` swallows it with
`|| CLAUDECODE_EXIT_CODE=$?` and emits only `::warning::`. Neither behaviour is in the README.

**How we implement it here.**

- Helper in `server/security-findings.mjs`:
  `unscannedCommits(repo, prNumber, scanHeadSha)` → `gh api "/repos/{repo}/pulls/{n}/commits?per_page=100"`,
  count commits whose committed date is after the scan's `head_sha` commit. `head_sha` comes from
  the artifact's `workflow_run.head_sha` (feature 1) or from the review's `commit_id` (feature 2).
- Helper `greenDespiteHigh(run, findings)` → `run.conclusion === 'success'` **and** any kept finding
  has `severity.toUpperCase() === 'HIGH'`. (Upstream's own check is
  `f.get('severity','').upper() == 'HIGH'`, so case drift is tolerated — match that.)
- Both become work-plane Inbox items via `workItems()` (`server/index.mjs:2661-2704`), which
  already stamps `plane: 'work', section: 'delivery'` on every row (`server/index.mjs:2664`).
  Add a third source alongside the PR and issue loops. Keys:
  `secscan:stale:{repo}#{n}` and `secscan:green-high:{repo}#{n}@{runId}`.
  Keys must be stable across polls or `/api/inbox/done` (`server/index.mjs:2800`) cannot clear
  them; include the run id on the second so a *new* green-despite-HIGH run reopens.
- `nudge` text (copy-only — `src/sections/InboxSection.jsx:72` is explicit that the dashboard never
  sends anything):
  `"{repo} PR #{n}: the security review ran on commit {sha7} and has not run since. {k} commits have landed after it. The default config scans a PR once, on the first commit."`
- Severity: `warning` for the stale gate, `error` for green-despite-HIGH. `error` shows a red
  badge and feeds the desktop/Slack notifier (`src/sections/InboxSection.jsx:265`).

**Effort.** **S.** Two predicates and two `items.push` calls, on top of features 1 and 2.

**Risks and unknowns.**
- The gate is disabled by `run-every-commit: true`. We cannot read a consumer's workflow inputs
  from the run record. **Unverified** whether the input value is recoverable from the run's
  `inputs`/log without downloading job logs. Until verified, phrase the card as an observation
  ("scanned at commit X, N commits since") rather than a diagnosis ("the gate suppressed it").
  Observed fact, not inferred cause — same discipline as the DORA "no data source" cards
  (`src/sections/DeliverySection.jsx:283-290`).
- `pulls/{n}/commits` caps at 250 commits. Above that, report `>250` rather than a wrong count.
- Force-pushes rewrite SHAs; a scanned SHA that no longer exists on the branch should render
  "scan commit no longer on the branch (force-push?)", not a count.

**Definition of done.**
- A PR with 7 commits and one review at commit 1 produces exactly one `warning` Inbox row reading
  *"6 commits landed after the only security review"*, and clearing it via
  `POST /api/inbox/done` keeps it cleared across a reload.
- A workflow run with `conclusion: success` and a kept HIGH finding produces one `error` row.
- A PR with one commit and one scan produces **no** row.
- Both rows link to the PR and carry a `nudge` string; neither sends anything.
- A repo with no security-review runs at all produces no rows and no error.

---

### 4. Show what the scanner threw away, and whether the filter even ran

**Customer need.** A security lead asks "the scan reported 2 findings — how many did it start with,
and what did it drop?" Nobody can answer. The suppression is invisible in every UI upstream ships.
Worse: when the filter's API key is dead or rate-limited, the pipeline **fails open** and keeps
everything with `confidence_score: 10.0` — and nothing in the output says so except a
`justification` string nobody reads.

**Value to Loush.** "What was suppressed, and was it right?" is a dashboard question, not a CI
question. And the fail-open badge is a correctness fix for a number the user would otherwise
misread: an unfiltered run's findings are not comparable to a filtered run's.

**How the upstream repo does it today.** `filtering_summary.filter_analysis` carries
`total_findings`, `kept_findings`, `excluded_findings`, `hard_excluded`, `claude_excluded`,
`exclusion_breakdown` (keys are `exclusion_reason.split('(')[0].strip()`), `average_confidence`
(null when no LLM scores were collected), `runtime_seconds`, `directory_excluded_count`. The
per-record trail is `excluded_findings_details`, which is **three record shapes in one array** (see
parser). `analysis_summary` is the model's own **pre-filter** self-report and disagrees with
`filtering_summary` by design — do not read counts from it.

**How we implement it here.**

- Same ingest as feature 1; a second panel in the `'CI security review'` tab of
  `src/sections/QualitySection.jsx`.
- Render `filter_analysis` as a strip; expandable list of `excluded_findings_details` grouped by
  `filter_stage` (see parser for the three shapes).
- **Fail-open badge.** If any kept finding's `_filter_metadata.justification` starts with
  `Claude API failed:` → badge *"filtering broke mid-run — these findings are unfiltered"*.
  If it equals `Claude filtering disabled` → *"the false-positive filter did not run at all"*.
  Both are `warning`-coloured, and in both cases the precision ratio from feature 2 must exclude
  that run rather than silently mixing filtered and unfiltered populations — this is honesty rule 5
  (`README.md:432`, "numerator and denominator must describe the same cohort").
- `average_confidence: null` renders `—`, never `0` (honesty rule 1).
- Feed one recommendation into the existing recommendations path the way recurring findings already
  do (`server/index.mjs:2147-2149`), so a repeatedly-fail-open filter is surfaced once, not per run.

**Effort.** **S.** One panel, one badge, fed by an ingest that already exists after feature 1.

**Risks and unknowns.**
- `exclusion_breakdown` keys are derived strings, not an enum. Group by them for display; never
  key persisted state on them.
- The hard-exclusion regexes match `description` prose only (never `category`), so the trail shows
  keyword-level judgements that will sometimes look absurd (a real SQL-injection finding dropped as
  "DOS noise" because its description mentioned an unbounded loop). Present the reason string
  verbatim; do not editorialise it into a verdict.
- A large PR is silently reviewed **without its diff** on `Prompt is too long`, and nothing in the
  output records that. We cannot detect it. Say so in the panel footnote rather than implying the
  scan was complete.

**Definition of done.**
- A run with `hard_excluded: 3, claude_excluded: 2` shows `7 found → 2 kept · 3 hard-excluded ·
  2 filtered out · 0 directory-excluded`, with all three record shapes expandable.
- A run whose findings carry `justification: "Claude filtering disabled"` shows the badge and is
  excluded from the precision ratio, with the exclusion stated.
- A run with `average_confidence: null` renders `—`.
- No `excluded_findings_details` record crashes the renderer regardless of shape.

---

### 5. Flag PRs that change what the agent is allowed to do

**Customer need.** A PR edits `CLAUDE.md` or `.claude/settings.json`. That changes the rules every
future agent run obeys — and it reviews like any other diff, buried among source changes. Nobody on
the team currently gets told.

**Value to Loush.** Governance already tracks our *own* config changes through `track()`. This
extends the same idea to *incoming* config changes in the repos we watch, using a file list we
already fetch.

**How the upstream repo does it today.** `claude-code-action`'s
`src/github/operations/restore-config.ts` restores these paths from the **base** ref before a run,
so a PR cannot inject agent instructions into the run that reviews it:
`SENSITIVE_PATHS = ['.claude', '.mcp.json', '.claude.json', '.gitmodules', '.ripgreprc',
'CLAUDE.md', 'CLAUDE.local.md', '.husky']`. The PR's own versions are copied to `.claude-pr/` so
the agent can *review* them without *obeying* them. It surfaces none of this to a human.

**How we implement it here.** The idea is theirs, the code is ours — no MIT attribution question,
because we are copying a list of filenames, not code.

- `fetchPRs()` already fetches `files(first:30){nodes{path additions deletions}}`
  (`server/eng.mjs:491`) and stores them as `p.files` (`server/eng.mjs:546`). Add a derived
  `p.agentConfigFiles` in the same mapping block.
- Predicate: path equals one of the file entries, or starts with `.claude/` or `.husky/`.
- Emit a `warning` triage record in `triage()` (`server/eng.mjs:659-681`, the PR loop) with
  `kind: 'agent-config'`, which flows to both `/api/eng/triage` and the Inbox for free.

**Effort.** **S.** ~10 lines, no new fetch.

**Risks and unknowns.**
- `files(first:30)` truncates. A PR touching 200 files may hide the config change past the cap.
  Either raise the page size for this check or state the truncation — do not report a clean result
  off a truncated list (honesty rule 2, `README.md:425`).
- Only ticket-keyed PRs are in `snap.prs` (`server/eng.mjs:508`). Non-keyed PRs are invisible here.

**Definition of done.**
- A PR touching `CLAUDE.md` produces one triage record and one Inbox row naming the file.
- A PR touching 30+ files where the check hit the cap says *"file list truncated at 30 — this check
  is incomplete for this PR"* instead of reporting clean.
- A PR touching no agent config produces nothing.

---

### 6. Explain why `@claude` did not fire

**Customer need.** Someone types `@claude fix this` in a PR comment and nothing happens. They ask
in Slack. This is a genuinely common support question, and the answer is almost always a rule
nobody has read: the phrase was not word-bounded, the actor lacks repo write, the actor is a bot,
or the trigger phrase was reconfigured.

**Value to Loush.** Cheap, self-contained, and there is no upstream UI for it at all. Fits the
Inbox's existing "here is what is waiting on you" framing.

**How the upstream repo does it today.** `src/github/validation/trigger.ts` short-circuits on
`if (prompt) { return true; }` — supplying `prompt:` bypasses trigger matching entirely. Otherwise
the phrase match is **not** a substring match:

```ts
new RegExp(`(^|\\s)${escapeRegExp(triggerPhrase)}([\\s.,!?;:]|$)`, "i")
```

`@claude,` triggers; `@claudecode` and `email@claude` do not. Then the actor gates: bots are
rejected unless allow-listed (`allowed_bots`, default `""`), and the actor needs repo `write`
unless `allowed_non_write_users` is set *and* `github_token` was supplied explicitly.

**How we implement it here.** A local checker, not an ingestion. Reproduce that one regex in
`lib/` (our own reimplementation of a two-line published expression, not a code port — no
attribution obligation, but cite the source in a comment). Expose
`POST /api/eng/trigger-check {body, phrase}` returning
`{matches, reason}`. Render as a small tool in the same Quality tab, plus a passive Inbox check:
for open PRs, if a **human** comment contains the phrase as a bare substring but fails the regex,
emit an `info` row *"this comment looks like it was meant to trigger @claude but does not match the
trigger pattern"*.

**Effort.** **S.**

**Risks and unknowns.**
- We cannot see the workflow's configured `trigger_phrase`, `label_trigger` (**non-empty default
  `claude`** — labelling any issue `claude` fires a paid run) or `allowed_bots` without reading the
  workflow file. Default to `@claude` and let the user override in the checker input. Never assert
  "this is why it did not fire" — only "this does not match the default trigger pattern".
- The permission half (actor write access) is not checkable without an extra API call per actor.
  Out of scope for v1; state it as a second possible cause in the copy.
- Comment bodies are fetched already only for ticket-keyed PRs; scope the passive check to those.

**Definition of done.**
- `@claude,` → matches. `@claudecode` → does not match, reason names the trailing-character rule.
  `email@claude` → does not match, reason names the leading-boundary rule.
- The checker states its assumed `trigger_phrase` on screen; the assumption is labelled `assumed`
  per honesty rule 4 (`README.md:430`).
- The passive Inbox row appears only for human comments (`BOT()` filtered, `server/eng.mjs:453`).

---

### 7. Promote a finding to a bug, once

**Customer need.** A finding is real. The engineer wants it in the tracker they actually work from,
with the file, line and repro context already filled in — not retyped.

**Value to Loush.** Closes the loop between the read-only findings list and the existing
root-cause machinery in `BugsSection`: trace frames, `git bisect`
(`server/index.mjs:3576-3604`), and the root-cause prompt builder
(`server/index.mjs:3606-3630`) all become available to a CI security finding.

**How the upstream repo does it today.** It does not. There is no issue creation, no labels, no
state, no dedupe key, no cross-run identity (research §B "Not produced").

**How we implement it here.**

- A `file as bug` button on a finding row. It calls the **existing** `POST /api/bugs`
  (`server/index.mjs:3522`) — no new write path, so the existing Board cross-link
  (`server/index.mjs:3529-3544`) comes free.
- Field mapping is specified in the parser section.
- **Idempotence is mandatory.** Store the finding's identity key on the created bug (a new
  `sourceKey` field on the bug record) and disable the button when a bug with that key exists.
  Without this, the 10-second poll plus an eager user produces duplicate bugs and a governance
  version per duplicate (`server/index.mjs:3510`).
- `intake` gets the raw finding text so `parseTrace()` (`server/index.mjs:3511`) extracts
  `{file, line}` into `frames` — which is what makes Bisect and the root-cause prompt work.

**Effort.** **S/M.** The button and mapping are small; the `sourceKey` field touches the bug schema
and the existing records must degrade (absent `sourceKey` = never auto-matched, never
retro-filled).

**Risks and unknowns.**
- The finding's `file` is repo-relative to the **GitHub repo**; `bug.project` is an **absolute local
  path** (`src/sections/BugsSection.jsx:57`). There is no guaranteed mapping between a configured
  `githubRepo` and a local checkout. Require the user to pick the local project in the dialog;
  do not guess. A wrong guess sends `git bisect` into the wrong repo.
- Severity vocabularies differ: findings are `HIGH|MEDIUM|LOW`, bugs are
  `critical|high|medium|low` (`src/sections/BugsSection.jsx:8`). Map `HIGH→high`, `MEDIUM→medium`,
  `LOW→low`; never invent `critical`.

**Definition of done.**
- Filing a finding creates exactly one bug with `frames` populated from `file:line`.
- Pressing the button twice creates one bug; the second press is disabled and says why.
- Deleting the bug re-enables the button.
- Bugs created before this feature are unaffected and never claimed as sourced from a finding.

---

### 8. Ingest the `claude-code-action` tracking comment

**Customer need.** A team runs `@claude` on PRs. There is no view of "how many agent runs this
month, how many failed, how long they took". Every run's only memory of itself is one comment.

**Value to Loush.** Agent activity becomes a series instead of a scatter of comments. Combined with
the `claude/` branch prefix, it gives us "agent-authored work" as a first-class filter in Delivery.

**How the upstream repo does it today.** One comment per run (or one sticky comment reused, if
`use_sticky_comment: true`). Final body, from
`src/github/operations/comment-logic.ts → updateCommentBody()`:

```
**Claude finished @{username}'s task in {D}** —— [View job]({jobUrl}) • [`{branch}`]({branchUrl}) • [Create PR ➔]({prUrl})

---
{claude's response markdown}
```

or, on failure, `**Claude encountered an error after {D}** —— [View job]({jobUrl})`. **Those two
prefixes are the only status signal that exists.** `{D}` is whole seconds
(`Math.round(duration_ms/1000)`), rendered `Nm Ss` at ≥60s. Separator is a literal `" —— "`; links
joined `" • "`; header and body separated by `\n\n---\n`.

**Critically: `total_cost_usd` is parsed into `executionDetails` and then dropped** —
`updateCommentBody()` only consumes `duration_ms`. Scraping comments gives duration and
success/failure, never cost.

Branches are `{{prefix}}{{entityType}}-{{entityNumber}}-{{timestamp}}` with `branch_prefix`
defaulting to `claude/`, and `branch-cleanup.ts` deletes the branch when no commits were produced.

**How we implement it here.**

- Fetch `gh api "/repos/{repo}/issues/{n}/comments?per_page=100"` for PRs of interest.
- Identify by `user.type === 'Bot'` **and** the header regex — **not** by bot id. The research found
  three disagreeing constants in the upstream codebase (`constants.ts` says `41898282`, which is
  `github-actions[bot]`'s well-known id; `create-initial.ts` uses a local `209825114`; the
  `bot_id` input defaults to `41898282`). Hard-coding any of them is a bug waiting to happen.
- Parse: status from the two prefixes, duration from `{D}` (record it as **whole seconds**,
  because that is all the precision that exists — do not present it as milliseconds), branch and
  job URL from the link row.
- Free join: `claude/` prefix on `p.branch` (`server/eng.mjs:532`) marks agent-authored PRs with no
  parsing at all. Add `p.agentAuthored` in `fetchPRs()`.
- Surface: an "agent runs" strip in Delivery, and `claude/`-branch marking on existing PR rows.

**Effort.** **M.** The parser is exposed to a comment template that moves with a ~daily `v1.0.N`
release cadence, so it needs defensive parsing and a test corpus.

**Risks and unknowns.**
- Comment text is the least stable interface in this spec — ~daily tags, floating `v1` tag.
  Parse defensively; on a parse miss record `status: null` and count misses, never guess.
- Sticky mode (`use_sticky_comment: true`) collapses all runs into one comment, so a run **count**
  is unavailable in that configuration. Detect it (one comment, many edits) and say "run count
  unavailable — sticky comments configured" rather than reporting 1.
- The `[Create PR ➔]` link is a prefilled compare URL, **not a created PR**. Do not count it as one.
- No check run is created by the action, so there is no pass/fail on the commit — only job status.

**Definition of done.**
- A PR with three `@claude` runs shows three rows with status and whole-second durations.
- A failed run renders as failed, sourced from the `encountered an error` prefix.
- A comment that matches neither prefix is counted as `unparsed`, visibly, with the count shown.
- The strip states that cost is not available from this source and points at feature 9.

---

### 9. Ingest the execution file for real CI cost

**Customer need.** "What did the agent cost us in CI last month?" is currently unanswerable. Our
AI-ROI panel (`src/sections/DeliverySection.jsx:119-196`) divides *this machine's* spend by team
output and already says so honestly (`README.md:440-443`). CI spend is a different, missing number.

**Value to Loush.** The `type: "result"` element of `claude-execution-output.json` carries
`total_cost_usd` and `duration_ms`. Per the sibling research this is the **only file-based route to
a real per-run cost figure** — local transcripts do not carry it, and the PR comment throws it away.

**How the upstream repo does it today.** `base-action/src/execution-file.ts` writes
`${RUNNER_TEMP}/claude-execution-output.json` — `JSON.stringify(messages, null, 2)` of the raw
stream-json message array — and exposes the path as the `execution_file` output. **Nothing uploads
it.** `$RUNNER_TEMP` dies with the runner.

**How we implement it here.**

- Requires a **one-line workflow edit by the user**: an `actions/upload-artifact` step pointed at
  `${{ steps.claude.outputs.execution_file }}`. We ship a copy-pasteable snippet — the same
  affordance `CiGate` already provides for eval workflows
  (`src/sections/ReliabilitySection.jsx`, `/api/ci/generate`, `server/index.mjs:3755`). **We
  generate the snippet; we do not run their action.**
- Ingest identically to feature 1 (`gh run download`), then read the final `type: "result"` element.
  The file is a JSON **array**, not JSONL — different from our local transcripts.
- **Plane ruling required, and this is the blocker, not the parsing.**
  `test/server/eng-privacy.test.js:10` bans `cost`, `usd`, `spend`, `session`, `duration_ms` and
  `tokens` from any `/api/eng/*` payload shape. CI cost is a work artifact (the org's CI spend,
  attributable to a repo and a run — not to a person or a machine), so it is legitimately plane A.
  But the guard is name-based and would fire.
  **Recommendation:** amend `test/server/eng-privacy.test.js` with an explicit, commented allowance
  for a named subtree (e.g. `ci.runs[].totalCostUsd`) and a new assertion that the subtree carries
  no actor field. Do **not** rename fields to slip past the regex — the plane header at
  `server/eng.mjs:1-23` is a structural rule, and quietly satisfying its test while violating its
  intent is worse than either honest option. If the maintainer rules CI cost is plane B instead,
  land it in `server/index.mjs` beside `ciHealth()` (`server/index.mjs:3820`) and Runs, and skip
  the test amendment entirely.

**Effort.** **M** — S for the parsing, M because of the required workflow edit and the plane
decision.

**Risks and unknowns.**
- Zero adoption until a user edits their workflow. The panel must distinguish "no execution
  artifacts uploaded — add this step" from "$0 spent".
- `total_cost_usd` is a client-side estimate from a bundled price table, not authoritative billing
  (per the Agent SDK cost-tracking docs). Label it estimated, per synthesis §1's measured-vs-
  estimated rule.
- `duration_api_ms` is read by the upstream comment-link entrypoint so it exists on real result
  objects, but it is absent from the upstream test fixture — treat as optional.
- The action bundles Bun install + Claude Code install on every job; **runner-minute cost is not in
  this file and is not recoverable from it.** Do not present `total_cost_usd` as total run cost.

**Definition of done.**
- With no execution artifacts: *"no execution files uploaded — add this step to your workflow"*
  plus the snippet. Not `$0`.
- With them: per-run cost and duration, labelled `estimated`, with runner minutes explicitly named
  as excluded.
- Either the privacy test carries a commented, asserted allowance, or the feature lives in plane B.
  `npm test` passes with no field renamed to evade a guard.

---

### 10. Port `HardExclusionRules` as a client-side re-filter

**Customer need.** A security lead disagrees with Anthropic's suppression opinions — "memory-safety
findings in non-C/C++ code are not applicable" is wrong for a repo with native bindings. Today the
only way to change the outcome is to reconfigure and re-run the scan.

**Value to Loush.** With feature 4 we hold the *unfiltered* set. Re-running the suppression
client-side with the user's own toggles lets them undo Anthropic's opinions **without re-running
anything**. It also gives us a shared noise vocabulary for findings arriving from anywhere else,
including the transcript-sourced ones we already parse (`server/index.mjs:2382`).

**How the upstream repo does it today.** `claudecode/findings_filter.py::HardExclusionRules` —
8 deterministic checks, first match wins, matched against `f"{title} {description}".lower()`
(`title` is always empty, so effectively description only, and never against `category`):
`.md` files; DOS/resource-exhaustion (3 patterns); rate limiting (4); resource management (5);
open redirect (3); regex injection (3); memory safety (9, **only when the extension is not
`.c/.cc/.cpp/.h`**); SSRF (1, **only when the extension is `.html`**). An extensionless file gets
`file_ext = ''` and is treated as non-C/C++.

**How we implement it here.** New `src/lib/finding-filters.js`, used by the Quality tab. Python
`re` → JS `RegExp`, all `IGNORECASE` → `i`. ~120 lines, mechanical.

**LICENSING — mandatory.** `claude-code-security-review` is **MIT**, `LICENSE` at repo root,
`Copyright (c) 2025 Anthropic`. MIT's sole condition is that the copyright notice and permission
notice be included in all copies or substantial portions. This is a substantial portion.
**The ported file must carry `Copyright (c) 2025 Anthropic` and the full MIT permission text in its
header**, plus the upstream path it came from and the date. Loush is MIT
(`package.json:9`), so licences are compatible and our own licence is unchanged. MIT is a copyright
licence and grants **no trademark rights** — do not name the feature "Claude Code Security Review".
This is a factual reading of published terms, not legal advice.

**Effort.** **M.** Mechanical translation, but eight rule families each need a test.

**Risks and unknowns.**
- These regexes match prose, not structure. Ported faithfully, they will drop real findings whose
  wording happens to include suppressed vocabulary. That is a property of the upstream design, and
  it is the reason to make the toggles visible.
- The `.md` and extension checks split on the last dot; Windows path separators must not break
  them (`path.sep`, per synthesis §9).
- Do this only after features 1 and 4 exist — without the unfiltered set there is nothing to
  re-filter.

**Definition of done.**
- Each of the eight rule families has a test with a matching and a non-matching description.
- A memory-safety finding in `main.c` is kept; the same finding in `main.py` is dropped; the same
  finding in an extensionless file is dropped (matching upstream).
- Toggling a rule off recomputes the list client-side with no refetch.
- The file header carries the Anthropic copyright and the MIT permission text.
- The UI shows "N suppressed by your rules" with N as a visible denominator.

---

## The finding parser

One parser, three input shapes (artifact finding, PR comment, our existing transcript
`ReportFindings` record), one normalised output. Lives in `server/security-findings.mjs`;
the pure functions are unit-testable with no `gh`.

### The normalised record

```js
{
  // identity
  id,              // stable hash — see below
  source,          // 'artifact' | 'comment' | 'artifact+comment' | 'transcript'
  repo,            // 'owner/name'      | null for transcript-sourced
  prNumber,        // integer           | null
  runId,           // workflow run id   | null
  headSha,         // the commit scanned| null

  // the finding itself
  file,            // repo-relative path, verbatim
  line,            // integer | null   — a SINGLE line. No range, no column, no end-line.
  severity,        // 'HIGH' | 'MEDIUM' | 'LOW' | null  (uppercased on read)
  category,        // FREE-FORM string. No enum, no rule id, no CWE anywhere upstream.
  description,     // prose, model-authored, UNTRUSTED
  exploitScenario, // prose | null
  recommendation,  // prose | null

  // the two confidence scales, kept SEPARATE
  scanConfidence,      // 0.0–1.0 float | null   — from the scan prompt
  filterConfidence,    // 1–10 integer  | null   — from the filter model
  filterJustification, // string | null
  filterState,         // 'scored' | 'api-failed' | 'filter-disabled' | 'unknown'

  // human signal (feature 2)
  reactionsUp, reactionsDown, reactionsSeeded,   // nulls when comment not seen

  // provenance
  ingestedAt, artifactExpiresAt, commentId, commentUrl,
}
```

### Reconciling the two confidence scales

**Do not merge them. Do not normalise one onto the other. Do not average them.** They measure
different things:

- `finding.confidence` — **0.0–1.0 float**, from the scan prompt's CONFIDENCE SCORING block
  ("below 0.7 don't report"). It is the *scanner's* belief that the vulnerability is real.
- `finding._filter_metadata.confidence_score` — **1–10 integer**, from a second model
  (`claude-opus-4-1-...` by default) adjudicating false-positive-ness with the whole file as
  context. It is a *reviewer's* belief that the finding is worth reporting.

Nothing upstream reconciles them, and `findings_filter.py` never thresholds on
`confidence_score` — `keep_finding` is the decision, `confidence_score` is advisory. So:

- Store both, in their own units, in their own fields.
- Render both, each with its scale visible: `scan 0.95` and `filter 8/10`. A single blended
  "confidence" number would be a fabricated statistic and would violate honesty rule 4
  (`README.md:430`).
- Sort and filter on `severity` first, then `scanConfidence`. Never sort on a blend.

### The overloaded `10.0`

`confidence_score` arriving as `10.0` means one of three different things, and **only
`justification` disambiguates**:

| `justification` | `filterState` | Meaning | UI treatment |
|---|---|---|---|
| starts with `Claude API failed:` | `api-failed` | The per-finding filter call threw or its JSON would not parse; the finding was **kept by failing open** | Badge the run "filtering broke". `filterConfidence = null` — it is not a 10, it is an absence |
| exactly `Claude filtering disabled` | `filter-disabled` | `validate_api_access()` probe failed; LLM filtering was off for the **entire run** | Badge the run "unfiltered". `filterConfidence = null` |
| anything else | `scored` | A real 10 from the filter model | `filterConfidence = 10` |
| `_filter_metadata` absent | `unknown` | Not a filtered-pipeline record | `filterConfidence = null` |

Also note the type tell: the fail-open paths set the **float** `10.0`, while a genuine score is an
**int**. Use it as corroboration only — JSON round-tripping through JS collapses `10.0` to `10`,
so `justification` remains the authority. Encode this as a function
`filterStateOf(meta)` with a test per row of that table; do not inline the string comparisons.

**Consequence for every derived number:** a run whose `filterState` is `api-failed` or
`filter-disabled` has a *different population* from a filtered run. Exclude such runs from the
precision ratio (feature 2) and from any trend line, and say that you did. Honesty rule 5.

### `excluded_findings_details` — key off `filter_stage`, never the wrapper

The array holds **three shapes**:

```jsonc
// (a) hard-rule exclusion
{ "finding": {...}, "index": 3, "exclusion_reason": "...", "filter_stage": "hard_rules" }

// (b) LLM exclusion
{ "finding": {...}, "confidence_score": 3, "exclusion_reason": "...",
  "justification": "...", "filter_stage": "claude_api" }

// (c) directory exclusion — the BARE finding object, no wrapper, no filter_stage
{ "file": "...", "line": 42, "severity": "HIGH", ... }
```

Parser:

```
for each record r:
  stage = r.filter_stage
         ?? (r.finding ? 'unknown_wrapped' : 'directory')
  finding = r.finding ?? r
  reason  = r.exclusion_reason ?? (stage === 'directory' ? 'Excluded directory' : null)
```

Detect shape (c) by the **absence of `filter_stage` and the presence of finding-shaped keys**
(`file` + `severity`), not by the absence of `finding` alone — a future upstream wrapper without a
stage must fall into `unknown_wrapped` and be shown as unclassified rather than silently treated as
a bare finding. Never assume a uniform wrapper.

### Identity — there is no fingerprint upstream, so we mint one

No rule id, no CWE, no hash exists anywhere in either repo. Cross-run identity has to be
reconstructed. Use:

```
id = sha256([repo, file, line, category.toLowerCase(), normalise(description)].join(' ')).slice(0,16)
normalise = lowercase, collapse whitespace, strip trailing punctuation, take first 200 chars
```

`line` is in the key deliberately: a finding that moved lines is not provably the same finding, and
claiming it is would be a fabricated match. Accept the duplicate; show both and let the human
merge. Record the key on any bug we create (feature 7) so promotion stays idempotent.

### Mapping onto a Bugs row

Target shape is `server/index.mjs:3526`:

| Bug field | From the finding |
|---|---|
| `title` | `` `${category}: ${description}` `` truncated to 120 chars — `category` is free-form, so it is a label, not a type |
| `severity` | `HIGH→high`, `MEDIUM→medium`, `LOW→low`. Never `critical` — the scanner has no such level |
| `project` | **chosen by the user in the dialog.** Never derived from `repo` |
| `status` | `'open'` |
| `intake` | Full text block: `file:line`, severity, category, description, exploit scenario, recommendation, both confidences with their scales, PR link, run link. `parseTrace()` (`server/index.mjs:3511`) extracts `file:line` into `frames` from the `path:line` pattern, which is what makes Bisect and the root-cause prompt work |
| `sourceKey` | the `id` above — new field, absent on pre-existing bugs, never backfilled |

`frames`/`links` are produced by the existing `parseTrace()`; do not hand-build them.

### Mapping onto an Inbox item

Target shape is `workItems()`'s `W(...)` helper (`server/index.mjs:2664`), which stamps
`section: 'delivery', plane: 'work'`:

| Inbox field | Value |
|---|---|
| `key` | `secfind:{repo}#{pr}:{id}` — stable, so `/api/inbox/done` clears permanently |
| `kind` | `'quality'` (an existing icon in `KIND_ICON`, `src/sections/InboxSection.jsx:11`) |
| `severity` | `HIGH → 'error'`, `MEDIUM → 'warning'`, `LOW` → not emitted at all |
| `text` | `` `{repo} PR #{n}: {severity} {category} in {file}:{line}` `` |
| `ts` | the run's `created_at`, not `Date.now()` — a missing `ts` renders "Invalid Date" and NaN-poisons the severity sort (`server/index.mjs:2760` documents exactly this bug) |
| `link` | the review comment URL, else the PR URL |
| `owner` | the PR author. **Never the finding's "author"** — there isn't one, and attributing a model's finding to a person is a plane-A evaluative claim (`server/eng.mjs:5-8`) |
| `nudge` | a copy-only line. Never sends (`src/sections/InboxSection.jsx:72`) |

Only emit Inbox rows for HIGH and MEDIUM. LOW belongs in the list, not in someone's attention queue
— the upstream prompt itself instructs the model to report HIGH and MEDIUM only, so LOW rows are
already off-contract.

### Degradation path when fields are missing

Ordered, and every step ends in a stated absence rather than a substituted value:

| Missing | Behaviour |
|---|---|
| `findings` key absent from the parsed object | Not a results file. Return `null` and record a parse failure with the filename. Do not return an empty findings array — that is indistinguishable from a clean scan |
| top level is `{"error": "..."}` | The scan **errored**. `action.yml` detects this with `jq -e '.error'` and sets `findings_count=0`, so an errored scan and a clean scan are identical from the action's outputs. Record `runState: 'error'` with the message and render it as an error, never as zero findings |
| `analysis_summary.review_completed === false` with `findings: []` | The empty shell from `_extract_security_findings` — extraction failed. `runState: 'extraction-failed'`. Not a clean scan |
| `filtering_summary` absent | `filterState: 'unknown'` for every finding; hide the audit-trail panel entirely rather than rendering zeros |
| `line` absent or non-numeric | `line: null`. Row renders `file` alone. Never default to `1` — the upstream comment script defaults to `1`, which is why comment-sourced findings can carry a fake line. When merging, an artifact `line` beats a comment `line` of exactly `1` |
| `severity` absent | `null`, rendered `—`, sorted last, **never** defaulted to `HIGH` (the upstream comment script defaults to `'HIGH'`; do not inherit that) |
| `category` absent | `null`, rendered `uncategorized`, matching what our transcript parser already does (`server/index.mjs:2384`) |
| `exploit_scenario` / `recommendation` absent | `null`. The section is not rendered. Never `''` |
| `_filter_metadata` absent | `filterConfidence: null`, `filterState: 'unknown'` |
| `average_confidence: null` | `—` |
| comment body does not match the template | Count as `unparsed`, show the count, keep the raw body available behind a disclosure. Never drop silently |
| whole file unreadable / artifact expired | Serve the last persisted copy with its `ingestedAt` and a `stale` flag — the pattern already used by `staleView()` (`server/eng.mjs:1043-1046`) |

Never coerce `null` to `0` anywhere in this path. That is honesty rule 1 (`README.md:422`) and it
is the rule this codebase has broken most often.

---

## What we can show that GitHub cannot

Two behaviours are invisible in the GitHub UI. Both are **only** derivable by keeping history,
which is precisely the axis on which we are uncontested (synthesis §7).

### A. The PR was scanned once, ever

**The mechanism.** `action.yml` reserves a cache entry keyed
`claudecode-{repository_id}-pr-{number}-{sha}` with `restore-keys` on the PR prefix, holding
`.claudecode-marker/marker.json`. If that marker restores and `run-every-commit != 'true'`,
`enable_claudecode` is set to `false` and **the entire scan, comment step included, is skipped**.
Layered on top, `comment-pr-findings.js` refuses to post anything at all if even one
`🤖 **Security Issue:` bot comment already exists.

**Net effect: by default a PR gets at most one security review in its lifetime, on the first commit
that triggered it.** Neither behaviour is in the README.

**Why GitHub cannot show it.** The skipped run is a *successful* workflow run — the steps are
conditioned out, so the job is green and short. The Checks tab shows a passing security review. The
Files tab shows a review comment. Nothing anywhere records "and the eleven commits after that were
never looked at". The only way to see it is to compare the scan's commit against the PR's commit
list — a join across two API surfaces, over time.

**How we surface it.**

1. **Inbox card** (feature 3): `warning`, keyed `secscan:stale:{repo}#{n}`, text
   *"PR #412: 7 commits, 1 security review (commit 1). 6 commits unreviewed."*
2. **A scan-coverage marker on the PR row in Delivery.** `fetchPRs()` already carries
   `p.checks` from `statusCheckRollup` (`server/eng.mjs:529`). Add `p.scanCoverage`:
   `{ scannedSha, commitsSince, coverage: 'full' | 'partial' | 'none' | 'unknown' }`.
   `'unknown'` when we have no scan record — that is the honest default and it must not render as
   `'none'`.
3. **A repo-level number in Quality:** *"of N PRs with a security review, M had commits after the
   scan"*, denominator visible.

**What we must not claim.** We can observe "scanned at commit X, N commits since". We cannot
observe *why* — `run-every-commit: true` would make the same shape legitimate. Word it as an
observation. This is the same discipline as the DORA cards that render `—` with
*"no data source … Not fabricated"* (`src/sections/DeliverySection.jsx:283-290`).

### B. A HIGH finding left the job green

**The mechanism.** `github_action_audit.py::main()` exits **1** when any kept finding has
`severity.upper() == 'HIGH'`. `action.yml` swallows it: `|| CLAUDECODE_EXIT_CODE=$?`, then emits
only `::warning::`. There is no check run, no commit status, no `REQUEST_CHANGES` — the review is
posted with `event: 'COMMENT'`, which is advisory by construction. **A HIGH-severity security
finding leaves the PR fully green.** Research §B gap 1 calls this the single biggest gap and the
clearest thing we can add on top.

**Why GitHub cannot show it.** GitHub's model is: job exit code → check conclusion → merge
protection. The exit code was swallowed *inside* the job, so as far as GitHub is concerned the job
succeeded. Branch protection has nothing to gate on. The severity exists only inside a JSON blob in
an artifact and inside the prose of a review comment. There is no view in GitHub that joins them.

Our own CI readers inherit the same blindness today, which is worth stating plainly:
`ciFor()` keeps only runs with a `conclusion` (`server/eng.mjs:571`) and `repoCI()` keeps only
`success|failure` (`server/index.mjs:3789`); both count this run as healthy, and it feeds
`failureRate` and `mainRed`. **Fixing that is part of this work, not a separate item.**

**How we surface it.**

1. **Inbox card** (feature 3): `error`, keyed `secscan:green-high:{repo}#{n}@{runId}`, text
   *"{repo} PR #412: the security review found 2 HIGH findings and the job passed. The action
   swallows the scanner's exit code, so nothing blocks the merge."* Severity `error` means it also
   reaches the desktop/Slack notifier (`src/sections/InboxSection.jsx:265-274`).
2. **A distinct run state.** Extend the run records in `ciFor()` / `repoCI()` with
   `advisoryFailure: true` for runs that were green but carried a HIGH finding. Render them as a
   third colour — not green, not red. **Do not fold them into `failureRate`**: that ratio means
   "jobs that failed", and quietly redefining it is the mistake `README.md:432-443` catalogues.
   Add a separate, separately-labelled `advisoryFailures` count.
3. **A one-line explainer** on the finding list: *"this scanner never fails a build — the action
   discards its exit code. Nothing here blocked a merge."* Stated once, as fact, so nobody assumes
   a green check means clean.

**Non-goal.** We do **not** offer to fail their build for them. That would mean running or editing
their action on their behalf, which is out of scope by ruling. Surfacing the fact is the product.

---

## Agent SDK: adopt or not

**Verdict: do not adopt now. Keep shelling out to the `claude` CLI. Revisit only if and when we
build an in-dashboard agent-execution surface with runtime permission prompts — and treat the
licence, not the API, as the gating question.**

### What we do today

`server/eng.mjs:1335` — `claudeMarkdown()`:

```js
const r = spawnSync('claude', ['-p', prompt, '--output-format', 'json'], { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 })
```

Its own comment concedes it blocks the handler. `server/index.mjs:3498-3500` does the same shape
for AI review and *already reads* `total_cost_usd` and `duration_ms` off the result blob. Chat runs
a separate driver which — per synthesis §2 — passes `--dangerously-skip-permissions`
(`server/index.mjs:909`).

### What the SDK buys us

- **`maxBudgetUsd`** — a hard client-side cost cap that terminates the run with
  `subtype: "error_max_budget_usd"`. We have no equivalent; `--max-turns` is a proxy at best. This
  is the single most valuable item on the list.
- **Streaming.** `Query extends AsyncGenerator<SDKMessage>`, so a live Runs/Chat panel needs no
  polling and no blocked handler.
- **`canUseTool`** plus in-process `PreToolUse` hooks — a runtime approval gate. This is exactly
  the control synthesis §2 says we are missing and currently *worse* at than the project we
  reviewed.
- **A real status field.** `result.terminal_reason` is an enum
  (`completed`, `max_turns`, `budget_exhausted`, `prompt_too_long`, `api_error`, …). Both result
  arms carry `total_cost_usd`, `usage`, `modelUsage` and `permission_denials`, so a *failed* run
  still reports spend. Nothing we scrape gives us that.
- **Session APIs.** `listSessions()` / `getSessionMessages()` read the same
  `~/.claude/projects/**/*.jsonl` store `scanTranscripts()` already walks
  (`server/index.mjs:2340-2405`), and add `gitBranch`, `tag`, `customTitle`, `parent_agent_id`.
- The TS SDK is consumable from plain JS, so `import { query } from '@anthropic-ai/claude-agent-sdk'`
  works unchanged in our `.mjs` files.

### What it costs

- **It is not open source.** Use is governed by **Anthropic's Commercial Terms of Service**,
  including when used to power products offered to our own customers, except where a component's
  own LICENSE says otherwise. Everything else in our stack is permissive; `package.json:9` says we
  are MIT. This is a materially different posture from the MIT actions in features 1–10 and is the
  biggest non-technical consideration by a wide margin.
- **Branding constraints.** Permitted: "Claude Agent"; "Claude" inside a menu already labelled
  "Agents"; "{YourAgentName} Powered by Claude". **Not permitted: "Claude Code" or "Claude Code
  Agent"**, or Claude Code-branded ASCII art / visual mimicry; the product must keep its own
  branding. Our `package.json:4` description and our README lead with "Claude Code" as the *subject
  we observe*, which is descriptive use, not product naming — but the moment we ship an SDK-backed
  agent, its name is constrained. **A lawyer should review any product naming; this is a summary of
  published terms, not legal advice.**
- **Authentication constraint.** Unless previously approved, third-party developers may not offer
  claude.ai login or claude.ai rate limits for products built on the Agent SDK; API-key auth is the
  documented path. We are local-first and run as the user, which is a different situation from
  redistribution — but the constraint is on record, and it argues against any future "sign in with
  Claude" affordance.
- **A platform-specific native binary** as an optional dependency, and an SDK version pinned 1:1 to
  a bundled CLI version (SDK v0.3.191 ⇒ CLI v2.1.191). We would be tying our server to a CLI
  version the user did not choose, in a project whose whole thesis is reading *the user's own*
  Claude Code installation.
- **It is a managed subprocess anyway.** The SDK spawns a Claude Code subprocess and speaks a
  control protocol to it. It is not an in-process model client. So the architectural distance from
  `spawnSync('claude', …)` is smaller than the API surface suggests.

### The reasoning

1. **The cheap wins are not SDK-shaped.** Every feature in this spec is `gh` + JSON. Zero of them
   need the SDK. Adopting it would not accelerate any of them.
2. **`canUseTool` is not the fix it looks like.** The permission flow is six steps —
   hooks → deny rules → ask rules → permission mode → allow rules → `canUseTool` — and
   **auto-approved tools never reach the callback**. A bare `allowedTools: ["Read"]` entry, or
   `acceptEdits`, or `bypassPermissions`, silently shadows it. (The SDK emits a
   `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` process warning as of v2.1.198 precisely because this trips
   people.) The documented shape for a headless dashboard-driven agent is
   `{ allowedTools: [...], permissionMode: 'dontAsk' }` — an explicit tool surface — and
   for a check on **every** call the docs say use a `PreToolUse` hook. **Our real problem is
   `--dangerously-skip-permissions` in the chat driver (synthesis §2), and that is fixed by not
   passing that flag and wiring a `PreToolUse` hook — neither of which requires the SDK.** Fix the
   posture first; it is free and it is Tier-2 item 2.3 in the synthesis plan.
3. **The session APIs are a cross-check, not a capability.** They read the store we already parse.
   Our landscape survey found 13 top-level `type` values where the SDK union covers 3 — so the SDK
   would give us *less* of the transcript, not more, while adding a commercial-terms dependency to
   the most load-bearing reader in the app.
4. **`maxBudgetUsd` is the one genuine gap** — and it applies to agent runs we *initiate*, which
   today is a narrow surface (`claudeMarkdown()`, the AI-review route, the chat driver). It is a
   real argument, and it is not worth a licence change on its own.

### If it is adopted anyway

- Land it in a **new `server/agent.mjs`**, behind a flag, replacing exactly one call site
  (`claudeMarkdown()`, `server/eng.mjs:1335`) so the blast radius is one function.
- **Cheaper half-step first:** adopt only `listSessions()` / `getSessionMessages()` as a *validator*
  in the test suite for our own JSONL parser. Effort S, same dependency question, and it answers
  empirically whether the SDK sees anything we miss before we bet a runtime on it.
- Record the licence decision in the file header of every SDK-touching file, per synthesis §9
  ("record the author's permission and the license state in the header of every ported file").
- Do not use `bypassPermissions`; note that **`allowedTools` does not constrain `bypassPermissions`**
  — unlisted tools fall through to the mode and get approved. Use `disallowedTools` to actually
  block.

---

## Not worth taking

- **Porting the Python scanner** (`github_action_audit.py` + `claude_api_client.py`). It would put
  a Python runtime and one Opus API call *per finding* inside a local-first, zero-telemetry
  dashboard, and duplicate a thing the user's CI already runs. Ingest their output instead — that
  is the whole thesis.
- **Running either action on the user's behalf.** Out of scope by ruling, and it would make us
  responsible for their CI spend and their prompt-injection surface. The upstream README states
  plainly that the security-review action is **not hardened against prompt injection**.
- **The OTEL push path.** `claude-code-action` forwards `CLAUDE_CODE_ENABLE_TELEMETRY` and the full
  `OTEL_*` set, so CI cost could be pushed to a collector. Standing up an OTLP receiver in
  `server/` breaks the local-first / zero-telemetry thesis unless the collector is the user's own
  box, and it is strictly more infrastructure than `gh run download`. Revisit only if a user asks.
- **Hard-coding any Claude bot id.** Three conflicting constants exist upstream
  (`41898282` in `constants.ts` and as the `bot_id` default — which is actually
  `github-actions[bot]`'s well-known id — versus a local `209825114` in `create-initial.ts`).
  Match on `user.type === 'Bot'` plus a body/header pattern.
- **Reading `analysis_summary` for counts.** It is the model's pre-filter self-report and disagrees
  with `filtering_summary` by design.
- **Trusting the `results-file` action output.** It is `claudecode/claudecode-results.json`,
  relative to `$GITHUB_ACTION_PATH`, and does not resolve from a consumer's job.
- **Emitting SARIF or a check run.** Neither upstream repo does, and producing one would mean
  writing to the user's repo — a `writes: true` gated action at best, and not what a read-mostly
  dashboard should be doing.
- **Blending the two confidence scales into one number.** Covered above; it would be a fabricated
  statistic.
- **A "security score" per repo or per person.** Plane A permits operational facts, not evaluative
  scores (`server/eng.mjs:5-8`), and `test/server/eng-privacy.test.js` exists to keep it that way.

---

## Open questions for the maintainer

1. **Plane ruling on CI cost.** Is `total_cost_usd` from a CI execution file plane A (a work
   artifact — a repo's CI spend, no person attached) or plane B (any cost figure is harness
   telemetry)? Feature 9 is blocked on this, and the answer decides whether
   `test/server/eng-privacy.test.js:10` gets a commented allowance or the feature moves to
   `server/index.mjs`. **My recommendation: plane A with an explicit, asserted allowance** — the
   figure is per-run and per-repo, and hiding it in plane B makes it invisible to the Delivery
   audience that pays for it.

2. **Which section owns CI findings?** I have specified a new tab in `QualitySection` because its
   "Review loop" tab already renders `category / summary / file:line` rows
   (`src/sections/QualitySection.jsx:227-235`), with an explicit promote-to-Bugs action. The
   alternative is a second list inside `BugsSection`. Splitting findings across two sections would
   be worse than either.

3. **Should the two finding sources be merged in the same list?** We will hold transcript-sourced
   findings (`/security-review` run locally, `server/index.mjs:2382`) and CI-sourced findings. Same
   scanner, different output contracts — the slash command emits markdown
   (`# Vuln N: <CATEGORY>: \`file:line\``), the action emits JSON. One list with a source badge, or
   two lists?

4. **Two CI readers, two caches.** `ciFor()` (`server/eng.mjs:563`) and `repoCI()`
   (`server/index.mjs:3781`) independently shell out to `gh` for the same repos with different
   cache TTLs (30 min vs 10 min) and slightly different metrics. `ciHealth()` even checks whether
   `eng.mjs` exports a `ciHealth` and defers to it (`server/index.mjs:3826-3827`), which it does
   not. Should this ingestion consolidate them, or add a third reader and leave the duplication?
   **Recommendation: add the third reader now, file the consolidation separately** — merging two
   caches is not this spec's job.

5. **Do we poll, and how often?** Artifacts expire in 7 days. A dashboard that is off for a week
   has a permanent hole. Options: (a) opportunistic — ingest on section open; (b) fold into the
   existing scheduler (`src/sections/InboxSection.jsx:28-64`, `~/.claude/dashboard-scheduler.json`),
   which is opt-in and default-off. (b) is the honest answer for coverage and the more intrusive
   one. **Recommendation: (a) plus an opt-in (b) job**, with the gap stated in the UI either way.

6. **Reaction seeding — verify before shipping the ratio.** Every finding arrives with one 👍 and
   one 👎 pre-seeded by the upstream script. Feature 2 subtracts them. **Unverified:** whether
   GitHub's `reactions` counts on a review comment include reactions added by the comment's own
   creating bot. One real comment settles it. Until then the precision ratio should ship behind a
   flag or not at all — a wrong precision number is worse than no precision number.

7. **`sourceKey` on bug records.** Feature 7 adds a field to `~/.claude/bugs.json`. Existing bugs
   will not have it and must never be retro-matched. Confirm that is acceptable, and that a schema
   addition to that file does not need a migration note in Governance.

8. **The `run-every-commit` unknown.** We cannot currently tell whether a consumer set
   `run-every-commit: true`, which would make "scanned once" a deliberate configuration rather than
   a blind spot. Is it acceptable to ship the Inbox card as a pure observation
   ("scanned at commit X, N commits since"), or should it be gated on our being able to read the
   workflow file from the repo first?

---

### Prompt-injection note on this document

Both upstream repos contain large bodies of text shaped as instructions to a language model
(`claudecode/prompts.py`, `.claude/commands/security-review.md`, the default filtering block in
`claude_api_client.py`). None of it was addressed to me and none of it was acted on; the fragments
quoted above are reproduced as data. The same applies at runtime: a finding's `description`,
`exploit_scenario` and `recommendation` are model-authored text derived from a diff an attacker may
control. Render them as inert text — never through `marked`, never into a prompt without fencing,
and never as a command.
