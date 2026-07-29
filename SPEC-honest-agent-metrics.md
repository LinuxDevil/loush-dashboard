# Honest agent metrics — implementation spec

> Turns `ciscoittech-claude-agent-framework.md` and `_SYNTHESIS.md` §6 / §8 (2.6, 2.7) into shippable
> work. Written 2026-07-29 against this checkout. Every implementation step below is grounded in a
> file I opened; every claim about transcript shape was verified against real JSONL on this machine
> and is labelled as such.
>
> **The thesis.** The upstream project markets four performance numbers, none of which survive
> inspection (`_SYNTHESIS.md:162-181`). Every one of them is a number *we* can compute honestly,
> because we read transcripts and they read a hook payload that does not carry the field they parse
> (`ciscoittech-claude-agent-framework.md:603-608`). This spec is the inversion: the same metrics,
> measured, each rendered with a visible denominator.
>
> **Non-negotiable.** Do not render "97%", "3-6x", or any figure from `_SYNTHESIS.md:166-172`
> anywhere in our UI or docs, including as a comparison. Compute ours or say nothing.
>
> **Licensing.** Upstream has no LICENSE file; GitHub reports NOASSERTION
> (`ciscoittech-claude-agent-framework.md:15`, `_SYNTHESIS.md:148`). The maintainer's permission
> covers us. Per `_SYNTHESIS.md:373`, every file that ports upstream logic carries a header recording
> the permission and the NOASSERTION state. Only feature 4 below ports upstream *content* (three
> rubric tables); the rest are original implementations of an idea.

---

## What I verified myself, and why it changes the plan

Before specifying anything I ran the parsers' assumptions against the real corpus on this machine
(`~/.claude/projects`, 120 main-thread transcripts + 1,164 subagent transcripts, read-only). Three
results contradict the research file and one of our own code paths. **Trust these over the research.**

| Finding | Measured | Consequence |
|---|---|---|
| **Claude Code writes one content block per JSONL line.** | 1,215 `Task`/`Agent` `tool_use` blocks across 120 main transcripts. Assistant records containing **≥2 `tool_use` blocks in one `message.content[]`: zero.** | `ciscoittech-claude-agent-framework.md:175-176` says to find "assistant messages whose `message.content[]` contains two or more `tool_use` blocks". Against our on-disk format that returns nothing, ever. Fan-out must be detected by grouping **across lines** on `message.id`. Our loop at `server/index.mjs:898` has the same latent assumption. |
| **Fan-out is real and detectable once you group correctly.** | 697 distinct `message.id` groups carrying Task calls; **223 of them hold ≥2 Task calls** (largest: 13). | Feature 5 has a real population to measure. Without the `message.id` grouping it has a population of zero. |
| **A `tool_use` record's `timestamp` is a completion-time write, not a dispatch time.** | Sampled a 13-Task group: every `tool_use` line and its matching `tool_result` line are **10–40 ms apart** (13/13 pairs). A second group (3 `Agent` calls) shows the same 8–19 ms gap. | `ciscoittech-claude-agent-framework.md:177-181` computes child duration as `tool_result.timestamp − tool_use.timestamp`. On our data that is ~0.02 s for every child. **The research's procedure yields a garbage number.** Child duration must come from the subagent transcript's own first/last timestamps. |
| **Subagent transcripts cover nearly all Task calls.** | 1,036 distinct Task `tool_use` ids; **1,032 have a `subagents/*.meta.json` sidecar carrying `toolUseId`** (99.6%). | The correct measurement path exists and is already half-wired at `server/index.mjs:900-905`. |
| **Coverage is not total, and the gap matters.** | One verified fan-out (`msg_01XHXvyg…`, 3 Task ids): two children have transcripts (189.4 s, 235.7 s spans), one has none. | A fan-out group with any unresolved child must report `efficiency: null`, not a number computed over the children that happened to be readable. Dropping the missing child silently biases the ratio. |

Those spans are a feasibility check on n=1 group. They are **not** a product number and nothing in
this spec proposes rendering them.

---

## 1. Honest context-reduction metric

**Customer need.** A developer with 30–60 installed skills, agents, commands and MCP servers has no
idea what that inventory costs them per session. Today they find out by watching `/context` in a
terminal, or they never find out. The upstream project's entire pitch is aimed at this pain and
answers it with a number about somebody else's hypothetical repo.

**Value to Loush.** This is the one headline where we can beat the whole category on *correctness*
rather than features. "You defer 94% of your installed capability surface — 14.2k always-on of 238k
installed" is falsifiable because both numbers are on screen. Per `_SYNTHESIS.md:178-180`, that
visible denominator *is* the differentiator.

**How the upstream repo does it today, and what they got wrong.** `README.md` claims "Context Size
250KB+ → <10KB, 97% smaller". Everything is wrong with it:

- No benchmark harness, no measurement script, no recorded before/after anywhere in the tree
  (`ciscoittech-claude-agent-framework.md:87-88`).
- The arithmetic does not close: 10/250 is **96.0%**, not 97% (`:91-94`). To reach 97 the baseline
  must be ~333KB. The number is rounded marketing, not computed.
- The 250KB denominator is an **assumed strawman** — a hypothetical user who inlined their codebase.
  No real install was measured (`:95-96`).
- The only real number in the vicinity, "currently 8KB" at `context-engineering.md:274`, is a
  self-report of their own `.claude/` folder compared against nothing (`:97-100`).

**The lesson:** a percentage whose denominator is assumed is not a measurement, it is a rhetorical
device. `_SYNTHESIS.md:174-176` records the same failure mode ending worse — context-mode's ADR-0004
shows a displayed savings figure moving 0% → 56% → 95.4% across three releases **on identical data**,
purely from formula changes.

**How we implement it here.**

The data already exists. `server/index.mjs:2881-2882` sets `alwaysOnTokens: i.descTokens` and
`fullTokens: i.fullTokens` per capability; `server/index.mjs:616-617` computes those from the
frontmatter `description` and the whole file respectively, via `tokens()` at `:558`
(`Math.ceil(len/4)` — a documented heuristic). `CapabilityLedger.jsx:27-29` already renders both
columns. Nothing new needs to be parsed.

1. **New pure function in `lib/harness-metrics.mjs`** — beside `contextPressure()`, matching its
   shape exactly (that module already returns a `denominator` string at `:96` so the client cannot
   relabel the ratio; do the same here):

   ```
   contextDeferral({ rows })  →
     { alwaysOnTokens, deferredTokens, installedTokens,
       deferredPct,            // null unless every row contributed to BOTH sides
       counted, excluded,      // { skills, commands, agents } vs { mcp, plugins }
       denominator: 'sum of full file token counts for skills, commands and agents only — '
                  + 'excludes MCP tool schemas and plugin bodies, which we do not measure',
       basis: 'chars/4 estimate' }
   ```
   `deferredPct = 1 - alwaysOn / installed`, and **`null` whenever `installed <= alwaysOn` or
   `excluded` is non-empty in a way that changes the sign of the answer** — see Risks.

2. **`capabilityLedger()` (`server/index.mjs:2849-2908`)** adds the result to `headline`. It already
   computes `alwaysOn` at `:2896`; add `installed = sum(rows, r => r.fullTokens)` alongside it.

3. **`CapabilityLedger.jsx:86-104` headline panel** gains one line under the existing "You pay N tok
   on every session…" sentence:

   > `14.2k always-on · 238k installed · 94% deferred`
   > with a hover naming the denominator string verbatim, exactly as
   > `ForensicsSection.jsx:135` does for `shareOfToolBytes`.

4. **The exclusions must be on screen, not in a tooltip only.** MCP servers are pushed with
   `descTokens: 0` (`server/index.mjs:634`) and plugins with `descTokens: 0, fullTokens: 0`
   (`:639`). An MCP server's tool schemas *are* always-on context; recording 0 means our numerator is
   too small and the deferral percentage is **flattering**. Render a literal count:
   `"excludes 6 MCP servers and 3 plugins — we do not measure their always-on cost"`.

**Effort.** S/M. The arithmetic and the pure function are a couple of hours. The exclusion accounting
and the null rules are most of the work.

**Risks and unknowns.**

- **The numerator is a lower bound.** `descTokens` counts only the frontmatter `description`
  (`server/index.mjs:616`). The real system-prompt listing also carries the name and structural
  framing per capability. Unquantified; do not claim precision beyond "estimate".
- **The MCP hole is the big one.** `server/index.mjs:1579` uses a hardcoded `estTokens: 600` per MCP
  server for the ProjectHub budget, flagged `est: true` and rendered with a `~` at
  `ProjectHub.jsx:150`. That constant is **not measured** and must not be quietly folded into this
  metric to make the denominator look complete. Either exclude MCP and say so, or measure it (see
  Open questions).
- **`tokens()` is chars/4** (`server/index.mjs:558`). Same basis as `CHARS_PER_TOKEN`
  (`lib/harness-metrics.mjs:65`). Label it, do not upgrade it as part of this feature.
- **D3 interacts with this.** `_SYNTHESIS.md:33` records that our command scanner walks one level
  deep, so nested command/skill dirs are invisible. Both sides of this ratio are computed from
  `overviewItems()`, so an invisible capability is missing from numerator *and* denominator — the
  ratio survives, the absolute numbers do not. Ship the absolutes with a "scanned N of ? dirs" note
  or fix D3 first.

**Definition of done.**

- `deferredPct` renders only when `alwaysOnTokens > 0 && installedTokens > alwaysOnTokens`; otherwise
  the whole line renders as `—` with "not enough installed capability to compute a deferral".
- **Empty state:** a fresh install with zero capabilities shows "no skills, agents or commands
  installed — nothing to defer", not `0%` and not `100%`.
- Both raw token counts are on screen next to the percentage, always.
- The excluded-kinds count is visible without hovering.
- The denominator string is served from the server, not authored in JSX (same discipline as
  `server/index.mjs:3010`).
- A `test/lib/context-deferral.test.mjs` case pins: normal case, zero-install case, and the case
  where every installed item is MCP (must be `null`, not `0%`).

---

## 2. Manifest and capability-path validation

**Customer need.** A user whose `settings.json` references a hook script that was renamed, or whose
`.mcp.json` points at a binary that is no longer installed, gets a silent partial failure — the hook
never fires, the MCP server never connects, and nothing tells them. Today they discover it when a
guardrail they believe is protecting them turns out not to be.

**Value to Loush.** `ciscoittech-claude-agent-framework.md:648` calls this a category where
**neither** we nor upstream has anything, and `_SYNTHESIS.md:241-243` notes the landscape scan found
**zero** entries across 690 projects doing config-linting-that-checks-behaviour. It is cheap,
demoable, and closes a loop nobody closes.

**How the upstream repo does it today, and what they got wrong.** `REGISTRY.json` is their central
index — a coordinator resolves capability paths through it at runtime. I resolved all 36 paths:
**8 are dangling** (`ciscoittech-claude-agent-framework.md:364-375`), so a coordinator following the
manifest fails to `Read` roughly 22% of the time. Worse, their own `test_v2_structure.py` asserts
that registry *sections* exist and that doc line counts fall in ranges — **it never resolves a single
path** (`:377-379`).

**The lesson:** a self-test that checks the shape of the manifest instead of the existence of what it
points at will pass forever while the product is broken. Do not write that test.

**How we implement it here.**

We have four manifests and validate none of them:

| Manifest | Where we read it | What is a path |
|---|---|---|
| `settings.json` hooks | `server/index.mjs:333` (`/api/hooks`), `:1626-1628` (trigger map) | `hooks[event][].hooks[].command` — extract the script/binary |
| `~/.claude.json` + `.mcp.json` mcpServers | `server/index.mjs:1570-1574` | `config.command` (stdio) or `config.url` (http) |
| agent frontmatter | `server/index.mjs:600-621` via `parseFM` | `tools` / `allowed-tools` entries naming `mcp__<server>__…` |
| bundle imports | `server/index.mjs:2077-2088` | `b.rules` / `b.skills` / `b.agents` relative paths |

1. **New `server/manifest.mjs`** exporting a pure `validateManifests({ settings, mcpServers, agents, skills, projectRoot })` returning
   `[{ source, key, declared, kind: 'file'|'binary'|'url'|'mcp-ref', status: 'ok'|'missing'|'unresolvable', detail }]`.
   Pure so it is testable; all `fs` calls are injected as a `resolve` callback.
2. **Path extraction from hook commands is the only hard part.** A command is a shell string
   (`server/index.mjs:3671-3677` shows ours are `node -e "…"` and `sh -c '…'`). Extract the first
   token; if it is an interpreter (`node`, `python`, `sh`, `bash`, `pwsh`), take the first subsequent
   argument that looks like a path *and is not a `-e`/`-c` inline script*. **When the shape is not
   recognised, emit `status: 'unresolvable'` — never `'ok'` and never `'missing'`.** Guessing here is
   how a validator starts lying.
3. **Windows.** Per `_SYNTHESIS.md:367-369`, use `path.sep`, and report `executable: null` rather
   than faking a POSIX exec-bit pass. `mcp__<server>__tool` references resolve against the merged
   `mcpServers` key set, not the filesystem.
4. **Surface: a sixth tab in `GovernanceSection.jsx:14`** — `['Versions','Approvals','Audit log','Drift','Manifests','Batch ops']` — one table, grouped by source, `missing` rows red, `unresolvable` amber, each row showing the declared string verbatim and the absolute path we tried.
5. **`/api/gov/manifests?project=…`**, alongside `/api/gov/drift` at `server/index.mjs:2105`.
6. Also fold the result into `LibrarySection` bundle rows: a bundle whose declared files no longer
   resolve should say so before someone imports it into a second repo.

**Effort.** S.

**Risks and unknowns.**

- Hook commands are arbitrary shell. Expect a meaningful `unresolvable` rate; that is the honest
  answer, and the UI must make `unresolvable` visibly different from `ok`.
- `$CLAUDE_PROJECT_DIR` and `~` expansion in hook commands — resolve both, and treat any other `$VAR`
  as `unresolvable` rather than expanding from our own `process.env`.
- Do **not** attempt to execute anything to prove it works. `/api/hooks/dryrun`
  (`server/index.mjs:3640`) already exists for that and is explicitly user-initiated.

**Definition of done.**

- Every declared path in all four manifests appears in the table with one of three statuses.
- **Empty state:** a project with no hooks, no MCP servers and no bundles renders "no manifests
  declare a path in this scope — nothing to validate", not "✓ all valid".
- A deliberately broken fixture (hook command pointing at a deleted file) is caught by
  `test/lib/manifest-validate.test.mjs`, and a fixture with an unparseable command is asserted to
  return `unresolvable`, **not** `ok`.
- No row claims `ok` for a path we did not actually stat.

---

## 3. Tool efficiency

**Customer need.** A developer whose sessions keep compacting does not know which tool is burning the
context. `ForensicsSection` already tells them which tool produces the most *bytes*
(`server/index.mjs:2980`, `ForensicsSection.jsx:135`), but not which tool produces the most bytes
*per useful result*. A `Grep` that returns 40k chars and errors half the time is a different problem
from a `Read` that returns 40k chars and always works.

**Value to Loush.** `ciscoittech-claude-agent-framework.md:638` is blunt that this is the one metric
where **they** beat us on design. It is also nearly free: the walker already computes both inputs.

**How the upstream repo does it today, and what they got wrong.** `schema.sql` defines
`v_tool_efficiency` — tokens per *successful* call — plus `v_tool_stats` (`:398-399`). The view
design is genuinely good. The implementation is dead: `observe_task_end.py:32` reads
`tool_result.get('usage', {})`, but Claude Code's PostToolUse hook payload for `Task` **does not
carry token usage**, so `tokens_input/output/cached` default to 0, the
`if tokens_input or …` guard skips the insert, and the token half of their observability records
nothing in real use (`:603-608`). That is also why `TEST_RESULTS.md`'s "100% PASS (13/13)" is CRUD
against fabricated fixtures with a hand-written "Tokens: 700" (`:118-121`).

**The lesson:** they shipped a metric whose numerator is structurally unobtainable from their data
source, and their test suite proved the *database* worked instead of proving the *number* existed.

**How we implement it here — and where we must diverge from their metric.**

`failStats()` (`server/index.mjs:1807-1883`) already keeps everything except the tokens:

- `idName[c.id] = { name, path }` at `:1846` — the `tool_use` → `tool_result` join.
- `rec.toolUses[name]` at `:1847` — calls per tool.
- `rec.toolErrs[name]` at `:1868` — failed calls per tool (gated on `c.is_error`).
- `rec.bytes[name]` at `:1860` — total result characters per tool.

So `successes = toolUses[n] - toolErrs[n]` and `charsPerSuccess = bytes[n] / successes` need **no new
parsing at all** — and half the aggregation is written too. `/api/gov/failures`
(`server/index.mjs:1897-1905`) already sums `toolUses` and `toolErrs` across sessions and emits
`{ name, uses, errors, rate }` behind a `uses >= 3` minimum-n guard (`:1905`). `/api/forensics`
(`:2969-2975`) already sums `r.bytes` over the same `failStats()` records. **Feature 3 is the join of
two loops that both already exist.**

**We cannot copy their headline metric verbatim, and must not pretend to.** Token usage in the
transcript is per *assistant message* (`message.usage`, read at `server/index.mjs:675-681`), not per
tool call. With one content block per line (verified above) a message often carries one tool_use, but
the `usage` block covers the whole request, not that block. Dividing a message's tokens among its
tool calls would be a fabricated attribution — exactly the failure mode this whole document exists to
avoid. **Ship characters, and an explicitly-labelled token estimate at `CHARS_PER_TOKEN`
(`lib/harness-metrics.mjs:65`), never a measured per-call token count.**

1. **Extend `contextPressure()` in `lib/harness-metrics.mjs:74`** — it already receives `bytesByTool`
   and `sizesByTool`; add `usesByTool` and `errsByTool`, and return per tool:
   `calls`, `errors`, `successes`, `successRate` (null when `calls === 0`),
   `charsPerSuccess` (null when `successes === 0`), `estTokensPerSuccess` (labelled estimate).
2. **`/api/forensics` (`server/index.mjs:2969-2975`)** already aggregates `r.bytes` and `r.sizes` per
   tool; add `r.toolUses` and `r.toolErrs` to the same loop (2 lines) and pass all four into
   `contextPressure()`. Keep the `uses >= 3` minimum-n guard that `/api/gov/failures:1905` already
   applies — and render the guard, so a tool absent from the table reads as "too few calls", not
   "no errors".
3. **Surface in `InsightsSection`**, per Tier 2's Insights placement — a new "Tool cost per useful
   result" panel next to `Stats`. Columns: Tool · Calls · Errors · Success rate · chars/success
   (est. tok). Sorted by `charsPerSuccess` descending.
4. `HarnessSection` gets nothing new here; it is a config surface, not an analytics one.

**Effort.** S.

**Risks and unknowns.**

- `is_error` is the only failure signal we have. A tool that returns a "no matches found" body with
  `is_error: false` counts as a success. That is arguably correct, but state it in the panel caption.
- `rec.sizes` is sample-capped at 300 per tool per file (`server/index.mjs:1862`) — medians only.
  `rec.bytes` is a full sum and is the right numerator. Do not compute `charsPerSuccess` from
  `sizes`.
- `?` is a real tool name in this data: `idName[c.tool_use_id]` misses when a `tool_result` predates
  its `tool_use` in a resumed/truncated file (`:1856-1857`). Keep the `?` bucket visible rather than
  folding it into another tool.

**Definition of done.**

- `successRate` and `charsPerSuccess` are `null` (rendered `—`) when the denominator is zero. No
  `Math.round((x || 0) * 100)` — that idiom is called out at `InsightsSection.jsx:11-13` as the one
  that "laundered every honest null".
- Calls and errors are rendered as raw counts **in adjacent columns**, so the rate has its
  denominator on screen (the pattern `ForensicsSection.jsx:198-200` already uses for `blockRate`).
- **Empty state:** no tool results in the window → "no tool results recorded in this range", not a
  table of zeros.
- No column anywhere claims measured tokens per call.

---

## 4. Deterministic complexity score, specialist map and escalation gates

**Customer need.** A developer with 23 skills and 11 agents installed against a 900-line repo has no
signal that they are over-configured, and a developer with a 40-table schema and no data-aware agent
has no signal that they are under-configured. `_SYNTHESIS.md:238` and
`ciscoittech-claude-agent-framework.md:642` both say the same thing: **we have literally nothing
prescriptive.** Today the user guesses.

**Value to Loush.** Our first opinionated feature. `_SYNTHESIS.md:128` frames the strategic argument:
every crowded category in the ecosystem is a *counter*, every empty one is a *judgement*, and
judgement is the half worth defending.

**How the upstream repo does it today, and what they got wrong.** The rubrics are good and are, per
`_SYNTHESIS.md:238`, "the only real value in that repo":

- 0-6 additive complexity score over size / tech / integration, banding to MINIMAL / BASIC / FULL
  (`SIMPLICITY_ENFORCEMENT.md:169-196`, quoted at `ciscoittech-claude-agent-framework.md:446-456`).
- A 13-row directory-pattern → specialist map (`SYSTEM_GENERATOR_PROMPT.md:95-118`, `:424-443`).
- Numeric escalation gates: >5 tables, >10 endpoints, >20 components, >40% coverage, >5 parallel
  tasks (`SIMPLICITY_ENFORCEMENT.md:199-225`, `:458-466`).

What they got wrong is not the rubric, it is the execution: **there is no code.**
`SYSTEM_GENERATOR_PROMPT.md` is ~350 lines of prose a human pastes into Claude Code; "detection"
means the model reading files and reasoning (`:405-408`). There is no parser, no scorer, nothing
deterministic. Consequently the generator is unversioned and non-deterministic — two runs on the same
repo produce different systems, with no lockfile, no diff and no regeneration path (`:624-625`).

**The lesson:** they wrote down countable evidence and then asked a language model to count. We have
the filesystem. Count it.

**How we implement it here.**

`server/fe.mjs` already walks repos: `walkRepo()` at `:332-358` returns `{ files, sources, truncated }`,
`classify(rel)` at `:56-64` buckets into source/test/story/style/doc, `SOURCE_EXTS`/`IGNORE_DIRS` at
`:40-45`, and `repoIndex()` at `:370-381` caches for 60 s. This is the whole substrate.

1. **New `lib/complexity.mjs`**, pure, no I/O, mirroring `lib/harness-metrics.mjs`'s discipline
   (weights exported, inputs returned alongside the score, `null` on insufficient data):

   ```
   export const SIZE_BANDS = [[1000,0],[10000,1],[Infinity,2]]      // LOC
   export const TECH_BANDS = [[1,0],[3,1],[Infinity,2]]             // distinct languages
   export const INTEGRATION_BANDS = [[0,0],[2,1],[Infinity,2]]      // external deps/services
   export const SETUP_BANDS = { 0:'MINIMAL', 1:'MINIMAL', 2:'BASIC', 3:'BASIC', 4:'FULL', 5:'FULL', 6:'FULL' }
   export const SPECIALIST_MAP = [ /* the 13 rows, verbatim, with an upstream-provenance header */ ]
   export const ESCALATION_GATES = [ /* >5 tables, >10 endpoints, >20 components, >20 test files */ ]
   export function complexityScore({ loc, languages, integrations }) → { score, parts, band } | null
   ```
   `parts` carries each axis's raw input and awarded points so the UI can show the arithmetic, the
   way `WorkingSet.jsx:163,180` shows the rework rank's.

2. **Counting inputs, honestly.** LOC and language mix come from `walkRepo` + `classify`.
   Integrations come from `package.json` dependency count (and `requirements.txt` / `go.mod` /
   `Cargo.toml` when present). **`walkRepo` caps at `WALK_CAP` and returns `truncated`
   (`server/fe.mjs:335,337`); when `truncated` is true the score must be `null`, not a low score.**
   A partial census that renders as "MINIMAL" is the exact class of lie this document is about.

3. **The gates need counts we do not have and must not invent.** ">5 tables" and ">10 endpoints" are
   not derivable from a file walk. Ship only the gates whose evidence we can actually count from the
   walk — components (files under `components/` classified `source`), test files
   (`isTestFile`, `server/fe.mjs:53`), migration files, SQL files. **Render the uncountable gates as
   greyed rows reading "we cannot count this from the filesystem"** rather than omitting them, so the
   rubric stays legible and the gap is explicit. `>40% coverage` is not countable at all — drop it.

4. **Surfaces.** `ProjectHub` gets a "Repo shape vs installed capability" card: the score with its
   arithmetic, the band, the installed counts from `capabilityLedger()`, and any specialist-map row
   whose directory signal is present while no installed capability plausibly covers it.
   `CapabilityLedger` gets one line joining the band to the DEAD count it already computes
   (`server/index.mjs:2894`).

**Effort.** S for the score alone; M with the specialist map and the recommendation join.

**Risks and unknowns.**

- The specialist-map join ("you have `migrations/` but nothing that looks DB-aware") requires
  matching a directory signal to installed capabilities by name/description keyword. That is a
  **heuristic**; label it one, exactly as `WorkingSet` labels its rank. Never phrase it as a defect.
- The upstream guard — "Detection alone does not justify creating a specialist"
  (`ciscoittech-claude-agent-framework.md:444`) — must survive the port into UI copy. A directory
  signal is a prompt to think, not a recommendation to install.
- `walkRepo` skips dotfile directories (`server/fe.mjs:342`), so `.claude/` is not in the file
  census. Correct for the score; make sure nobody later "fixes" it.
- Effort is honest at M because the recommendation join, not the scoring, is where the time goes.

**Definition of done.**

- Score renders with its three raw inputs and per-axis points visible without hovering.
- `truncated` walk → score renders `—` with "repo too large to census (capped at N files)".
- **Empty state:** a project with no source files → "nothing to score", not `0/6 MINIMAL`.
- Uncountable gates are visibly greyed and labelled, not hidden.
- `test/lib/complexity.test.mjs` pins each band boundary and the truncation-nulls-the-score rule.
- Ported rubric constants carry a header naming the upstream file, the maintainer's permission, and
  the NOASSERTION licence state.

---

## 5. Real parallel-efficiency measurement

**Customer need.** A developer who has started fanning out subagents has no idea whether it is
helping. They pay a token multiplier for parallelism (Anthropic's own multi-agent writeup puts
multi-agent at ~15x chat token usage, `ciscoittech-claude-agent-framework.md:141-145`) and get back a
wall-clock saving they cannot see. Today the only available answer is a vendor's arithmetic.

**Value to Loush.** `_SYNTHESIS.md:323` (Tier 2.7) and
`ciscoittech-claude-agent-framework.md:667-678` both call this the single most compelling number we
could show. It answers "is my agent setup actually saving me time?" with data, and **it is the one
metric in this document that no other project in the 690-project survey can compute**, because it
requires transcripts nobody else reads.

**How the upstream repo does it today, and what they got wrong.** `AGENT_PATTERNS.md:688`
"Performance Benchmarks" claims 3x / 4.3x / 6.7x / 2.4x. Look at the Sequential column: 90 = 3×30,
150 = 5×30, 300 = 10×30. **Every sequential baseline is `agent_count × 30 s`**
(`ciscoittech-claude-agent-framework.md:112-116`). Nothing was timed; a constant was assumed and
multiplied. `CLAUDE_AGENT_FRAMEWORK.md:406` repeats the same table with the same constant. And the
table shows only the upside — it never mentions that fan-out multiplies token spend, which
`:143-145` calls the single most misleading thing in their README.

**The lesson:** the "baseline" column is where fake benchmarks hide. A ratio is only as real as its
denominator, and here the denominator was a constant times a count.

**How we implement it here.** Note this diverges materially from the procedure in
`ciscoittech-claude-agent-framework.md:174-182`, for the reasons measured at the top of this file.

1. **Parser change A — carry `message.id`, `uuid`, `parentUuid`, `isSidechain`.**
   `scanTranscripts()` (`server/index.mjs:2299-2406`) already parses every line and already extracts
   Task/Agent invocations at `:2379`. Bump the cache version (`rec.v !== 3` at `:2312` → `4`) and
   record, for each Task/Agent `tool_use`: `{ t, kind:'agent', name, toolUseId: c.id, msgId: j.message?.id, uuid: j.uuid, parentUuid: j.parentUuid, isSidechain: !!j.isSidechain }`.
   The cache-version bump is what forces a re-walk; skipping it ships a half-populated field.

2. **Parser change B — index the subagent sidecars.** `historyEvents()` at
   `server/index.mjs:900-905` already reads `<sessionId>/subagents/*.meta.json` and joins on
   `link.toolUseId`. Lift that into a reusable `subagentIndex()` returning
   `toolUseId → { file, agentType, description, first, last, msgs }`, where `first`/`last` are the
   min/max `timestamp` in the child transcript. Cache by `(mtime,size)` exactly as `scanCache` does.

3. **Fan-out detection — group across lines.** For each session, bucket Task/Agent invocations by
   `msgId`. A bucket of size ≥2 is a fan-out. **Do not look for two `tool_use` blocks in one
   `message.content[]`; that shape does not occur** (0 of 1,215 verified). Exclude buckets where
   `isSidechain` is true, so a subagent's own fan-out is attributed to its own thread rather than
   double-counted into the parent's.

4. **Spans from children, not from the parent's timestamps.**
   `childDuration = child.last - child.first` from the subagent transcript.
   `span = max(child.last) - min(child.first)` across the bucket.
   `efficiency = Σ(childDuration) / span`.
   **Every child in the bucket must resolve to a transcript.** If any does not (4 of 1,036 measured),
   the group yields `{ efficiency: null, reason: 'unresolved-child', resolved, total }` and is
   reported in a coverage line, not silently dropped.

5. **New `lib/parallel-metrics.mjs`**, pure, taking already-parsed records — same shape as
   `lib/harness-metrics.mjs`, with a `denominator` string:
   `'sum of child subagent wall-clock spans divided by the wall-clock span of the fan-out; a perfectly sequential batch scores 1.0'`.

6. **Surface in `InsightsSection`** (per Tier 2.7's placement): the **distribution**, not a single
   headline — count of fan-outs, median efficiency, the 1.0 reference line, and the honest
   counterweight upstream omits: **tokens spent inside the fan-out window**, from
   `collectUsage()` entries (`server/index.mjs:681`) falling in the span. Speed-up and token cost on
   the same card or neither.

**Effort.** M. Higher than the research's estimate, because steps 2 and 4 are new work that
`ciscoittech-claude-agent-framework.md:669-674` assumed away.

**Risks and unknowns.**

- **Child `first`/`last` bound the child's *logged activity*, not its dispatch-to-return latency.**
  Queueing before the first logged line is invisible. This makes efficiency a **lower bound** — an
  error in the conservative direction, but it must be stated in the caption, not buried.
- Background agents (`run_in_background`) return an ack immediately and continue afterwards. Their
  child transcript still has real spans, but the parent "fan-out" framing is weaker. Detect and
  segment them; do not average them with foreground fan-outs. **Unverified** whether the input
  carries a reliable flag in older records — check before shipping, and exclude rather than guess.
- Clock skew is not a factor (single machine), but resumed sessions duplicate lines: I measured 1,215
  Task blocks resolving to 1,036 distinct ids. **Dedupe by `toolUseId` before grouping**, or a
  13-child fan-out reads as 26. This is D1 (`_SYNTHESIS.md:31`) in a new place.
- Sessions with zero fan-outs are the common case. The feature must be invisible rather than empty
  for those users.

**Definition of done.**

- Fan-out count, median efficiency, and per-group efficiency are all `null`-safe; a group with an
  unresolved child never contributes a number.
- Coverage is stated on the card: "47 fan-outs · 45 fully resolved · 2 excluded (missing child
  transcript)".
- The 1.0 reference is drawn, so a user can see that 1.1 is noise.
- Token spend inside the fan-out window renders on the same card. Ship both or ship neither.
- **Empty state:** "no fan-outs recorded — every agent call in this range ran on its own", not `1.0x`
  and not a hidden panel.
- `test/lib/parallel-metrics.test.mjs` pins: perfectly sequential → 1.0; two fully-overlapping equal
  children → 2.0; any unresolved child → `null`; duplicate `toolUseId` → counted once.
- The caption says "lower bound" and says why.

---

## 6. Retroactive run expectations with an explainable 0-100 score

**Customer need.** A team lead who has agreed "a bugfix run should invoke a reviewer and produce a
test artifact" has no way to know whether that actually happened — not for the next run, and
certainly not for the last ninety days. Today they spot-check, or they trust.

**Value to Loush.** This is the structural asymmetry. Upstream validates **live**, going forward,
through hooks that must be installed first. We read transcripts that already exist, so we can define
a contract today and score **the past** against it
(`ciscoittech-claude-agent-framework.md:579,680-687`). They cannot do that, and neither can anything
else in the survey. It also lands in the section where `_SYNTHESIS.md:317` already wants
auto-checking.

**How the upstream repo does it today, and what they got wrong.** The design is the best code in
their repo. `task_expectations` (`schema.sql:57-75`) is a declarative contract: a regex
`task_pattern` → `expected_agents[]`, `expected_files[]`, `required_artifacts[]`, `max_duration_ms`,
`max_tokens`, `max_cost_usd`. `validate_execution.py` turns violations into
`{type, expected, actual}` and scores `(passed/total)*100` — dead simple and fully explainable, every
lost point naming a rule (`ciscoittech-claude-agent-framework.md:578-579`).

What is wrong is what it runs on. The scorer reads the same observability DB whose token columns are
dead (`:603-608`), so any expectation touching `max_tokens` or `max_cost_usd` silently compares
against 0 and passes. And validation is a `PostToolUse` hook (`:553`) — it only ever sees runs that
happen after you install it, in a subsystem that ships disabled by default (`:489-490`).

**The lesson:** an explainable score computed over silently-zeroed inputs is worse than no score,
because the explanation makes it look audited.

**How we implement it here.**

1. **Contract store.** JSON at `~/.claude/harness-expectations.json`, written through `track()` so
   edits land in the audit log — the pattern `/api/gov/evals` uses at `server/index.mjs:1951-1952`,
   and the fix for D4 (`_SYNTHESIS.md:34`) applied from the start rather than retrofitted.
   Schema, ported from theirs and trimmed to what we can actually observe:

   ```jsonc
   { "id": "...", "match": { "promptPattern": "regex", "flow": "…|null", "project": "…|null" },
     "expect": { "agents": [], "toolsUsed": [], "filesTouched": ["glob"], "artifacts": ["glob"],
                 "maxDurationMs": null, "maxToolErrors": null },
     "enabled": true }
   ```

2. **Deliberate omissions.** `max_tokens` and `max_cost_usd` are **not** in v1. Our token figures are
   real but D1/D2 (`_SYNTHESIS.md:31-32`) are open, and a contract that fails a run on a number we
   know is inflated is upstream's mistake with better plumbing. Add them after Tier 0 lands.

3. **Retroactive evaluator, `server/expectations.mjs`.** Everything it needs is already parsed by
   `scanTranscripts()`:
   - session prompts → `rec.prompts` (`server/index.mjs:2367`) for `promptPattern`;
   - agents invoked → `rec.invocations` kind `agent` (`:2379`);
   - tools used → `rec.toolCalls` / `failStats().toolUses` (`:1847`);
   - files touched → `rec.files` (`:2390`) and `rec.edits` (`:2362`);
   - tool errors → `failStats().toolErrs` (`:1868`);
   - duration → `rec.first` / `rec.last` (`:2333`).
   Output per (contract × session): `{ checks, passed, violations: [{type, expected, actual}], score }`
   with `score = passed / checks * 100`, and **`score: null` when `checks === 0`** — a contract that
   matched but asserted nothing must not read 100.

4. **Surface: a "Expectations" panel inside `GovernanceSection`**, sibling to `Drift`
   (`GovernanceSection.jsx:262-302` is the layout to copy: pick a scope, see rows, act per row).
   Each contract shows: matched sessions, median score, and the violation histogram — *which rule*
   fails most often. Clicking a violation opens the session.

5. **The differentiator must be in the copy.** The panel header states the window explicitly:
   "scored against the last 90 days of transcripts — no instrumentation, nothing installed".

**Effort.** M.

**Risks and unknowns.**

- **Retroactive scoring is retrospective judgement.** A run from before the contract existed did not
  know the rule. Show the contract's `createdAt` on every row and separate "scored before this
  contract existed" from "scored after"; do not let a historical score read as a violation of an
  agreement nobody had made.
- `promptPattern` is user-authored regex over prompt text. Cap execution and reject
  catastrophic-backtracking patterns at save time rather than at evaluation time.
- Prompt matching finds the *session*, but a session contains many tasks. v1 scopes a contract to a
  whole session and says so; per-task scoping needs the `parentUuid` chain from feature 5 and should
  wait for it.
- `rec.files` is capped at 500 and `rec.edits` at 400 (`server/index.mjs:2362,2390`). A
  `filesTouched` expectation evaluated against a truncated list can produce a false violation —
  **when the cap is hit, that check must return `null`, not `fail`**.

**Definition of done.**

- Every violation names the rule, the expected value and the actual value — no bare score anywhere.
- `score` is `null` when `checks === 0` or when any check was skipped for truncation, and the row
  says which.
- Contract `createdAt` is visible on every scored row.
- **Empty state:** no contracts defined → an explanation and a "create one from this session" action,
  not an empty table. No contracts *matched* → "no session in this window matched this pattern",
  distinct from "matched, scored 0".
- Contract writes appear in `Governance → Audit log` (i.e. they go through `track()`).
- `test/lib/expectations.test.mjs` pins: zero-checks → `null`; truncation → `null`; a violation's
  `{type, expected, actual}` shape.

---

## The denominator rule

`_SYNTHESIS.md:174-180` states it: never render a percentage without its denominator visible, citing
context-mode's ADR-0004, where a displayed savings figure went **0% → 56% → 95.4% across three
releases on identical data**, purely from formula changes. That is the exposure our own derived stats
carry.

We have the rule written down already, in two places, and we do not apply it evenly.
`server/fe.mjs:16-19` states the doctrine — *"NULL IS NOT ZERO … `n` travels with every aggregate …
NO MAGIC WEIGHTS IN THE DARK"* — and `lib/harness-metrics.mjs:96` and `server/index.mjs:3010` ship a
`denominator` string with the payload specifically so the client cannot relabel the ratio.
`TicketSection.jsx:628` refuses to render a percentage at all on the grounds that "there is no
denominator, and a fabricated one is a lie with pixels."

**Audit result: of 26 derived percentage/ratio render sites, 12 show no denominator at all, 6 show it
only on hover or only in prose, and 8 show it inline.**

Legend — **VISIBLE**: the denominator is a number on screen at the point of render. **PARTIAL**: named
in prose or a tooltip, or implied by a documented scale, but not a number the eye can pair with the
percentage. **MISSING**: not available to the reader anywhere near the number.

| # | Render site | Stat | Computed at | Denominator | State |
|---|---|---|---|---|---|
| 1 | `src/sections/InsightsSection.jsx:91` | one-shot rate | `server/index.mjs:2555` | `sess.length` — shown in a *different* KPI tile, unlabelled as the denominator | **MISSING** |
| 2 | `src/sections/InsightsSection.jsx:96` | prompt reuse | `server/index.mjs:2558` | total duplicate-eligible prompt occurrences; the sub-line shows `dupClusters`, a **different** number | **MISSING** |
| 3 | `src/sections/InsightsSection.jsx:97` | correction rate | `server/index.mjs:2557` | `pr.length` (prompts in range) | **MISSING** |
| 4 | `src/sections/InsightsSection.jsx:98` | abandonment | `server/index.mjs:2556` | `sess.length` | **MISSING** |
| 5 | `src/sections/Overview.jsx:144` | CI failure rate | `server/index.mjs:3807` | `done.length` (completed runs) | **MISSING** |
| 6 | `src/sections/InboxSection.jsx:211` | eval pass rate | `server/index.mjs:2839` | mean of per-run pass rates — a mean of means; neither run count nor task count shown | **MISSING** |
| 7 | `src/sections/ReliabilitySection.jsx:187` | per-run eval pass rate | `server/index.mjs:1979` | tasks in *that* run; only the current task count is shown, once, above | **MISSING** |
| 8 | `src/sections/DeliverySection.jsx:145` | unattributed spend | `server/index.mjs:3188` | total AI spend. Sub-line literally reads "the honest denominator" without printing it | **MISSING** |
| 9 | `src/sections/UsagePanel.jsx:107` | cache-TTL best efficiency | `lib/harness-usage-trends.mjs:30`, served via `server/index.mjs:786` | rolling-window cache-eligible tokens | **MISSING** |
| 10 | `src/sections/UsagePanel.jsx:107` | cache-TTL worst efficiency | same | same | **MISSING** |
| 11 | `src/sections/CapabilityLedger.jsx:248` | lint score % | `server/index.mjs:560-578` | additive heuristic out of 100; weights not shown | **MISSING** |
| 12 | `src/sections/CapabilityLedger.jsx:251` | specificity % | `server/index.mjs:581-589` | additive heuristic out of 100; weights not shown | **MISSING** |
| 13 | `src/sections/DeliverySection.jsx:183,186` | cohort rework rate | `server/index.mjs:3158` | `n` in the cell's `title`, and inline only when `n<5` (`DeliverySection.jsx:128-133`) | PARTIAL |
| 14 | `src/sections/SessionsSection.jsx:124` | cache-read % | `server/index.mjs:3038` | named in prose in the tooltip, no number | PARTIAL |
| 15 | `src/sections/HarnessSection.jsx:172` | harness health `/100` | `server/index.mjs` harness health | "/100" is drawn; the check set is not, only the top 2 failures | PARTIAL |
| 16 | `src/sections/ProjectHub.jsx:100` | project health `/100` | `server/index.mjs:1645-1646` | findings list *is* rendered lower down and the hint says "drives the N/100 score" | PARTIAL |
| 17 | `src/sections/UsagePanel.jsx:66` | health factor scores | `/api/usage` health | sub-lines give each factor's raw ratio; the weighting is not shown | PARTIAL |
| 18 | `src/sections/ProjectHub.jsx:111` | always-on vs soft cap | `server/index.mjs:1589,1659` | `"N% of Xk soft cap"` — but the **numerator contains two hardcoded constants** (see below) | PARTIAL |
| 19 | `src/sections/ForensicsSection.jsx:135,144` | share of tool bytes | `lib/harness-metrics.mjs:84` | explicit `denominator` string, tooltip on both the headline and the column | VISIBLE |
| 20 | `src/sections/ForensicsSection.jsx:200` | hook block rate | `server/index.mjs:2998` | `Fired` and `Blocks` are adjacent columns | VISIBLE |
| 21 | `src/sections/ReliabilitySection.jsx:74` | tool error rate | `server/index.mjs:1889-1894` (`/api/gov/failures`) | renders `errors/uses · N%` | VISIBLE |
| 22 | `src/sections/DeliverySection.jsx:143` | rework rate (headline) | `server/index.mjs:3191` | "N of M shipped tickets bounced back" | VISIBLE |
| 23 | `src/sections/DeliverySection.jsx:95` | queue share of cycle | client-side | `gap` and `cycP50` are both rendered in days inches away | VISIBLE |
| 24 | `src/sections/HarnessSection.jsx:250` | context window used | client-side | "Xk of Yk in use" beside the ring | VISIBLE |
| 25 | `src/sections/UsagePanel.jsx:68-70` | cache / context efficiency | `/api/usage` | states the ratio basis **and** names the estimate: "assumes N tok/turn — an estimate, editable in settings" | VISIBLE |
| 26 | `src/sections/ProjectsSection.jsx:172` | GSD progress | client-side | "GSD done/total · N%" | VISIBLE |

Two findings from the audit worth more than the count:

**A. Row 18 is the one that would have become our own ADR-0004.** The "always-on context" numerator
at `server/index.mjs:1589` sums `contributors` whose `mode === 'always'`, and two of those
contributors are constants, not measurements: `systemPrompt: 2100` and `toolDefs: 1700` from
`HARNESS_DEFAULTS` (`server/index.mjs:1319`), plus `estTokens: 600` per MCP server
(`server/index.mjs:1579`). Change either constant and every "% of soft cap" in `ProjectHub` and
`HarnessSection` moves, on identical data. To the credit of whoever wrote it, they are flagged
`est: true` and render a `~` (`ProjectHub.jsx:150`) — that is the mitigation, and it is why this is
PARTIAL rather than a defect. **Feature 1 must not inherit these constants**, and the mitigation
should be strengthened: print the constant's value in the hover, so a change to it is visible as a
change to the number.

**B. Rows 11 and 12 are the ones to fix first, because they sit in the section this spec extends.**
`CapabilityLedger`'s own footer already does the honest thing in prose — *"This is a linter, not a
metric"*, with the bands spelled out (`CapabilityLedger.jsx:258-261`). The percentages above it do
not carry that. Feature 1 adds a *third* percentage to the same component; adding it without fixing
11 and 12 puts a rigorously-denominated number next to two undenominated ones and teaches the reader
that our percentages are decorative.

**Proposed rule, to adopt as Tier 0.5 (`_SYNTHESIS.md:296` item 0.5 is exactly this):**

1. Any endpoint returning a ratio returns `{ value, n, of, denominator }`, not a bare number. The
   `denominator` string is authored **server-side**, next to the arithmetic — the pattern already
   established at `lib/harness-metrics.mjs:96` and `server/index.mjs:3010`.
2. A shared `<Pct>` component renders `value` and `n / of` together and renders `—` when
   `value == null`. Ratios cannot be rendered by hand-rolled `Math.round(x * 100) + '%'`. A grep for
   that idiom across `src/sections` and `src/ui` returns 27 lines once bar-widths and
   `Math.min(100, …)` clamps are excluded; the 26 rows above are the subset rendering a *derived
   statistic* rather than a config value or a slider read-out.
3. `Math.round((x || 0) * 100)` is banned outright. `InsightsSection.jsx:11-13` already names it as
   "the idiom that laundered every honest null".
4. Any number derived from a constant that is not measured carries the constant's value in its
   hover, not just an `est` marker.

---

## Transcript fields required

Verified present in real records on this machine (top-level keys of an assistant record:
`parentUuid, isSidechain, message, requestId, type, uuid, timestamp, userType, entrypoint, cwd,
sessionId, version, gitBranch`; `message` keys: `model, id, type, role, content, stop_reason,
stop_sequence, stop_details, usage, diagnostics`).

| Field | Needed by | Already parsed? | Where the change lands |
|---|---|---|---|
| `timestamp` | 5, 6 | ✅ `server/index.mjs:680`, `:2332` | — |
| `type` | all | ✅ `:1267`, `:2364`, `:2368` | — |
| `cwd`, `gitBranch` | 6 | ✅ `:2334-2335` | — |
| `message.model` | 3 (labelling only) | ✅ `:675` | — |
| `message.usage.*` | 1 (cross-check), 5 (token counterweight) | ✅ `:681` | — |
| `message.content[].type === 'tool_use'`, `.id`, `.name` | 3, 5, 6 | ✅ `:679`, `:898`, `:1844`, `:2371` | — |
| `message.content[].input.subagent_type` | 5, 6 | ✅ `:1039`, `:2379` | — |
| `message.content[].input.file_path` | 6 | ✅ `:1845`, `:2374` | — |
| `tool_result.tool_use_id` | 3 | ✅ `:1271`, `:1856` | — |
| `tool_result.is_error` | 3 | ✅ `:1834`, `:1867` | — |
| `toolUseResult.structuredPatch`, `.filePath` | 6 | ✅ `:694`, `:2354` | — |
| `attachment.type === 'hook_*'` | 2 (context only) | ✅ `:2338-2351` | — |
| **`message.id`** | **5 — the only way to detect fan-out** | ❌ | `scanTranscripts()` `server/index.mjs:2379`; bump `rec.v` at `:2312` from 3 → 4 |
| **`uuid` / `parentUuid`** | 5 (thread stitching), 6 (future per-task scoping) | ❌ | same record, same bump |
| **`isSidechain`** | 5 — excludes a subagent's own fan-out from the parent's | ❌ | same record, same bump |
| **`requestId`** | Tier 0.1 dedupe (`_SYNTHESIS.md:292`), and feature 5 needs the same dedupe | ❌ | `collectUsage()` `server/index.mjs:681`; bump `rec.v` at `:667` from 2 → 3 |
| **subagent `*.meta.json` → `toolUseId`, `agentType`, `description`** | 5 — the real child-duration source | ⚠️ read ad hoc at `:900-905`, not indexed | lift into a cached `subagentIndex()` beside `scanTranscripts()` |
| **subagent transcript `first` / `last` timestamps** | 5 — child wall-clock | ❌ | new, in `subagentIndex()` |
| `toolUses` / `toolErrs` / `bytes` per tool | 3 | ✅ `:1847`, `:1868`, `:1860` — **only needs plumbing out of `failStats()` into `/api/forensics`** | `server/index.mjs:2969-2975` |

**Two rules for the parser work.** Both cache-version bumps are mandatory — `scanCache` and
`usageCache` key on `(v, mtime, size)` (`:2312`, `:667`), so adding a field without bumping `v`
leaves every already-cached file silently missing it. And per `_SYNTHESIS.md:96`, Anthropic
documents transcript *location and layout, zero field names*; the SDK type is a deliberately opaque
`[k: string]: unknown`. Every new field read must degrade to `null` when absent, never to `0`.

---

## Not worth taking

- **Any of their numbers.** 97%, 96%, 3-6x, 60x, "100% PASS (13/13)". Not in the UI, not in docs, not
  as a "compared to" (`_SYNTHESIS.md:348`).
- **Their hook-based token capture.** It parses a `usage` field the Task-tool PostToolUse payload does
  not carry (`ciscoittech-claude-agent-framework.md:603-608`). Our transcript reading is correct and
  needs no instrumentation. Do not install their hooks to "cross-check" — there is nothing to check
  against.
- **Their agent file format.** Pseudo-frontmatter (bold key-value lines in the body) with real
  metadata externalised to `REGISTRY.json` (`:268-295`). Strictly worse than the native YAML
  frontmatter `parseFM` already reads at `server/index.mjs:608`. Importing their agents would need a
  conversion step that produces a file Claude Code cannot load anyway.
- **The 12 shipped agent definitions.** Ten of twelve are named `framework-*` — architect/engineer of
  their framework, not of your software (`:614-617`). No reusable domain content.
- **`test_v2_structure.py` as a model.** It asserts doc line-count ranges. Line counts are not
  behaviour; see feature 2.
- **The best-practice ingestion loop** (`/ingest-best-practice <URL>`). L effort, needs network
  fetching that cuts against our local-first positioning, and `_SYNTHESIS.md:379` notes two projects'
  READMEs contain text written to be executed by a reading agent — this feature would walk straight
  into that. Defer indefinitely.
- **Their `logfire_helper.py` cloud backend.** Contradicts the whole product thesis.
- **`max_tokens` / `max_cost_usd` in run expectations, for now.** Not because the idea is bad — see
  feature 6 step 2. Revisit once Tier 0.1 and 0.2 land.
- **Copying `v_tool_efficiency`'s numerator literally.** Tokens per call are not attributable from
  our data. Feature 3 ships characters and a labelled estimate instead.
- **A "context reduction vs typical setup" comparison.** There is no typical setup we have measured.
  That is precisely the strawman that produced 97%.

---

## Open questions for the maintainer

1. **A LICENSE file.** GitHub reports NOASSERTION; the README's MIT sentence is the only licensing
   artifact in the tree (`ciscoittech-claude-agent-framework.md:15`). Your permission covers us, but
   anyone auditing our repo later will find NOASSERTION upstream. Would you commit an actual
   `LICENSE`? `_SYNTHESIS.md:152-154` notes four of the sixteen researched projects have the same
   gap — a one-line fix that makes provenance defensible without relying on a private email.

2. **Do you want the 97% and 3-6x claims corrected upstream?** We will not repeat them, but they are
   still on your README, and the arithmetic (10/250 = 96.0%) is self-refuting on inspection. Happy to
   send the analysis if it is useful; equally happy to leave it alone.

3. **Do you know `observe_task_end.py` records nothing?** `tool_result.get('usage', {})` reads a field
   the Task-tool hook payload does not provide, so the `if tokens_input or …` guard skips
   `insert_metrics` every time. If you have a corpus where it *did* populate, we would genuinely like
   to see it — it would mean the payload shape differs by version, which changes what we can rely on.

4. **The 8 dangling `REGISTRY.json` paths** (`:364-375`) — intentional forward-declarations for
   unwritten files, or drift? It changes whether feature 2 should treat a dangling manifest entry as
   an error or as a warning.

5. **Permission to port the three rubrics verbatim** — the 0-6 complexity score
   (`SIMPLICITY_ENFORCEMENT.md:169-196`), the 13-row directory→specialist map
   (`SYSTEM_GENERATOR_PROMPT.md:95-118`), and the numeric escalation gates
   (`SIMPLICITY_ENFORCEMENT.md:199-225`) — into deterministic JS, with attribution in the file
   header. These are the parts of the repo we think are genuinely good, and we would rather credit
   them explicitly than paraphrase them into deniability.

6. **Did you ever measure a real sequential baseline?** If a single timed sequential-vs-parallel run
   exists in any form, it is more useful to us than the whole table — it would give feature 5 a
   sanity check on data from outside this machine.

### Open questions for us, not the maintainer

- **MCP always-on cost.** Feature 1's denominator excludes MCP tool schemas because we record
  `descTokens: 0` (`server/index.mjs:634`) and ProjectHub uses a hardcoded `600`
  (`server/index.mjs:1579`). Is there a first-party way to read the actual injected schema size? If
  not, the exclusion is permanent and must stay visible in the UI forever, not just in v1.
- **Background agents in fan-out detection.** Whether older records carry a reliable
  `run_in_background` signal is **unverified**. Confirm before shipping feature 5; exclude rather
  than guess.
- **`usage-data/session-meta/` and `facets/`** (`_SYNTHESIS.md:83-97`) may already contain
  first-party per-session tool-error and interruption counts that feature 6 currently derives.
  Tier 3.2 gates on cross-version verification; if it lands first, feature 6's evaluator should read
  those instead of re-deriving.
