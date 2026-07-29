# SPEC — context and skills tooling

Implementation spec derived from `context-and-skills-tooling.md` (research on `mksglu/context-mode`,
`numman-ali/openskills`, `mnfst/manifest`) and `_SYNTHESIS.md` §5–§8. Every implementation step below
is grounded in a file in this repo that was read while writing this document; citations are
`path:line` against the tree at `research/upstream-ecosystem-analysis`.

Nothing here has been implemented. This is a spec.

---

## Licensing constraint

**Read this before writing a line of any feature below.**

| Project | Licence | What we may take |
|---|---|---|
| `mksglu/context-mode` | **Elastic-2.0** since 2026-03-03, commit `a482980` (was MIT before) | **Schemas, formulas, findings and table shapes only.** No source. |
| `numman-ali/openskills` | Apache-2.0, full text (`LICENSE` is the 638-byte short form, which is why GitHub reports NOASSERTION) | Code may be copied with attribution. **Vendor it** — the project is dormant. |
| `mnfst/manifest` | MIT, clean and GitHub-detected | Code may be copied with attribution. Safest of the three. |

**Elastic License 2.0 is source-available, not open source.** It is not OSI-approved and it is not
compatible with this repo's MIT licence (`package.json:"license": "MIT"`). ELv2 forbids providing the
software to third parties as a managed service and forbids circumventing licence-key functionality.
A verbal or emailed "go ahead" from the author does **not** relicense their file headers: any
permission we rely on must be in writing and must **name ELv2 explicitly**, and even then a
MIT-licensed repo carrying ELv2-derived source is a licence-compatibility problem we would be
choosing to own.

Facts, formats and formulas are not copyrightable. Schemas and measured findings are. So:

- **Features 2, 6 and 8 below touch context-mode.** They take a *table shape* (`tool_calls(session_id,
  tool, calls, bytes_returned)`), a *finding* (ADR-0002's A/B result on forbidding language), an
  *ADR's cautionary history* (ADR-0004), and a *documented list of where 17 harnesses keep their
  config*. Each is described in prose here and must be **reimplemented from this spec**, not
  transcribed from their tree. Do not clone their repo into this one. Do not paste from
  `src/session/db.ts`, `hooks/core/routing.mjs`, `src/search/unified.ts` or `bin/statusline.mjs`.
- **Features 1 and 5 touch openskills (Apache-2.0).** Code may be copied. If any is, vendor it under
  `lib/` with the Apache-2.0 notice and the upstream commit sha in the file header, and do not track
  upstream — the project has had **zero commits since 2026-01-18** and its "is this maintained?"
  issue (#94) is unanswered.
- **Feature 3 is manifest (MIT).** Weights, boundaries and the tier vocabulary may be copied
  verbatim, with an MIT attribution header on `lib/complexity.mjs`.
- **Feature 7 is manifest (MIT).** Same.

### Two rules that apply to every feature, from `_SYNTHESIS.md` §6

1. **Never render a percentage without its denominator visible.** context-mode's `ADR-0004` records
   their displayed savings figure going **0% → 56% → 95.4% across three releases on identical user
   data**, purely from formula changes. That is the failure mode every derived stat in this app is
   exposed to. We already hold this line in `lib/harness-metrics.mjs:96` (`denominator:` string
   shipped in the payload so the client cannot re-label it) and at `server/index.mjs:3010`. Extend
   it, never relax it.
2. **Never repeat "98%", "96%", "82%", or any context-mode savings figure in our UI, our README, our
   marketing copy or our tooltips** — including as a comparison ("they claim 98%…"). Their own
   `BENCHMARK.md` overall row is 96% with rows as low as 13%, and their statusline hardcodes
   `saves ~98% of context window` at four call sites as a fallback when analytics fail to load
   (their issue #894). Quoting any of it launders their number through our credibility.

---

# Features

Ordered by value ÷ effort. Each is independently shippable.

---

### 1. Skill discovery blind spot — `.agent/**`, provenance, and the `AGENTS.md` skills block

**Customer need.**
Someone who has installed skills with `openskills`, or with any of the competing loaders that
adopted the same convention (`skillpm`, `antfu/skills-npm`, `vercel-labs/skills`), opens
Capabilities → ROI ledger and sees a number that is **wrong**, with no indication that it is wrong.
Their skills are in `.agent/skills/`, we only look in `.claude/skills/`, so those skills are absent
from the inventory *and* their always-on description tokens are absent from the budget. Today the
user's only recourse is to notice the count is short and distrust the whole panel.

Second half of the same need: for the skills we *do* see, the ledger's DEAD verdict
(`src/sections/CapabilityLedger.jsx:18`) says "never fired, and old enough that it has had the
chance". A user looking at a DEAD row cannot tell whether it is something they wrote, something a
plugin installed, or something they cloned from `anthropics/skills` eight months ago and forgot. The
verdict is an accusation with no lead attached.

**Value to Loush.**
Correctness first: our budget number is simply false for openskills users, and a dashboard whose
headline number is silently wrong for a whole class of user is worse than one that says "unknown".
Beyond that, `SKILL.md` + the four-directory resolution order + a provenance sidecar are the de-facto
commons of this space — betting on those three is safe even though openskills itself is dormant.
Provenance turns "DEAD — archive it?" into "installed from `anthropics/skills` on 2025-11-04, never
fired in 61 sessions since — archive it?", which is a decision a user can actually make.

**How the upstream repo does it today.**
openskills' `src/utils/dirs.ts` resolves skills from four directories, first match wins, deduped by
directory name (`src/utils/skills.ts` `findAllSkills()`):

```
1. ./.agent/skills/     (project, universal)
2. ~/.agent/skills/     (global,  universal)
3. ./.claude/skills/    (project, claude)
4. ~/.claude/skills/    (global,  claude)
```

`location` is reported `'project'` if `dir.includes(process.cwd())`, else `'global'` — a fragile
heuristic (see Risks). Discovery follows symlinks via `isDirectoryOrSymlinkToDirectory`
(`src/utils/skills.ts:12-28`) so local dev checkouts can be linked in.

Each installed skill directory gets a provenance sidecar, `.openskills.json`
(`src/utils/skill-metadata.ts`):

```ts
export const SKILL_METADATA_FILE = '.openskills.json';
export type SkillSourceType = 'git' | 'github' | 'local';
export interface SkillSourceMetadata {
  source: string;          // as typed by the user, e.g. "anthropics/skills"
  sourceType: SkillSourceType;
  repoUrl?: string;
  subpath?: string;
  localPath?: string;
  installedAt: string;     // ISO-8601
}
```

And `sync` writes an always-on block into the project's `AGENTS.md`
(`src/utils/agents-md.ts:23-62`) carrying every skill's name + description + location inside
`<skills_system priority="1">` → `<available_skills>` → repeated `<skill><name>…</name>
<description>…</description><location>…</location></skill>`, wrapped in a ~700-byte fixed `<usage>`
preamble. The rewrite is idempotent: replace `<skills_system>…</skills_system>`, else the
`<!-- SKILLS_TABLE_START -->…<!-- SKILLS_TABLE_END -->` comment pair, else append. Reverse parse is
`/<skill>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/skill>/g`.

**How we implement it here.**

*(a) The four directories.* Today `KINDS.skills.dirs()` at `server/index.mjs:151` returns exactly two
entries — `~/.claude/skills` and `<WATCHED_PROJECT>/.claude/skills` — and `hubResolve` hardcodes the
same two at `server/index.mjs:1540`. **We do not scan `.agent/**` anywhere in this repo; grepping
`server/`, `lib/` and `src/` for `.agent` returns nothing.** Add the two universal roots to both
call sites, in openskills' order (project-universal, global-universal, project-claude,
global-claude), and add a `root` field (`'.agent'` | `'.claude'`) to every emitted item so the UI can
say where it came from. Same change to `customizeRes('skills')` (`server/index.mjs:371-394`) so
Customize can toggle them, and to `overviewItems()` (`server/index.mjs:600-622`) so they reach the
ledger via `capabilityLedger()` (`server/index.mjs:2850`).

*(b) First-wins dedup.* `hubResolve` already surfaces a duplicate-skill finding at
`server/index.mjs:1636` ("duplicate skill … exists in global and project scope — project wins"). Once
there are four roots the same finding must name the winning root, and `hubListSkills`
(`server/index.mjs:1492`) must dedupe by directory name across roots rather than concatenating —
today `server/index.mjs:1540` concatenates and relies on the finding to explain the duplicate. Keep
the finding; make the dedup real, and keep the shadowed entry in the payload as
`shadowedBy: <path>` so the panel can show it rather than silently dropping it.

*(c) Provenance.* In `hubListSkills` (`server/index.mjs:1492-1505`), after reading `SKILL.md`, read
`.openskills.json` from the same directory if present, and emit
`provenance: { source, sourceType, repoUrl, subpath, installedAt }` or `provenance: null`. Thread it
through `overviewItems()` → `capabilityLedger()` rows (`server/index.mjs:2879-2889`), which already
carry `installedAt: i.mtime`. **Where a real `installedAt` exists, prefer it over mtime** — mtime is
documented as a lower bound at `lib/harness-metrics.mjs:22-25` and at `server/index.mjs:610-611`, and
a real install date makes `sessionsSince()` (`lib/harness-metrics.mjs:41`) and therefore the
NEW/DEAD verdict correct instead of merely safe. Emit
`installedAtSource: 'sidecar' | 'mtime' | null` alongside it; the ledger must be able to say which.
We already have a provenance vocabulary for bundles at `server/index.mjs:2048`
(`{ author, machine, project, createdAt }`) rendered at `src/sections/LibrarySection.jsx:147` —
reuse the rendering idiom, not the shape.

*(d) The `AGENTS.md` skills block.* `AGENTS.md` is already in the rules stack
(`server/index.mjs:399` for Customize, `server/index.mjs:1527` for `hubResolve`) and its whole token
count already flows into `alwaysOn` at `server/index.mjs:1584,1589`. So the *tokens are counted* —
what is missing is **attribution**: a user with a 4 KB `<skills_system>` block sees "AGENTS.md 1.1k
tok" and cannot tell that most of it is skill metadata generated by a tool. Parse the block with the
regex above, and split the `AGENTS.md` contributor into two rows: `AGENTS.md (prose)` and
`AGENTS.md → <available_skills> (N skills)`, the latter carrying the per-skill breakdown. Skills
found only in that block (installed, then the directory moved or deleted) get a row with
`onDisk: false` — that is a real, reportable inconsistency and should raise a `hubResolve` finding
(`server/index.mjs:1633` `F()`).

*(e) UI.* Add `['root', 'Root']`, `['source', 'From']` and `['installedAt', 'Installed']` to
`COLS` in `src/sections/CapabilityLedger.jsx:26-30`; render `source` as the raw `source` string with
`repoUrl` as the `title`, and `—` when `provenance` is null. Extend the DEAD tooltip
(`src/sections/CapabilityLedger.jsx:18`) to mention provenance when present. Show the root chip next
to the existing scope chip (`src/sections/CapabilityLedger.jsx:166`).

**Effort.** S. Roughly: 2 lines in `KINDS`, ~15 lines in `hubListSkills`, ~30 lines for the
`AGENTS.md` block parser, ~20 lines of dedup, three UI columns.

**Risks and unknowns.**
- openskills' own issue **#84** reports `--universal` installing to `.agent/` while parts of their
  docs say `.agents/`. We should scan `.agent/skills` (the code's behaviour) and **not** `.agents/`
  unless we see it on a real disk. Note it as unverified rather than scanning both and inflating the
  inventory.
- Their `location` heuristic `dir.includes(process.cwd())` misclassifies when `$HOME` is a prefix of
  cwd, and on Windows where case and separators differ. **Do not port it.** We already know each
  root's scope statically from `KINDS[kind].dirs()` — keep deriving scope from the root, not from a
  string test.
- Their issue **#92**: repos containing `examples/**/SKILL.md` produce phantom skills. Our
  `hubListSkills` reads only immediate children of the skills root (`server/index.mjs:1495-1497`), so
  we are not exposed today. `_SYNTHESIS.md` §8 Tier 0.3 wants nested-dir recursion; **if that lands,
  it must not recurse into `examples/`, `node_modules/`, `.git/` or any directory below the first
  `SKILL.md` found.** Depth cap of 2 and an exclusion list.
- `.openskills.json` has no schema version and no integrity check. Treat every field as optional,
  validate `installedAt` parses as a date, and fall back to `provenance: null` on any parse failure
  rather than half-populating a row.
- Unverified: whether any real machine we can test on actually has an `.agent/skills` tree. The
  feature must be demonstrable on a synthetic fixture under `test/fixtures/`.
- `WATCHED_PROJECT` (`lib/paths.mjs`) is a single directory, not the per-request `project` query
  param that `hubResolve` takes. `KINDS.skills.dirs()` is therefore already only correct for the
  watched repo. Adding roots does not fix that; do not pretend it does.

**Definition of done.**
- A fixture project with a skill in `.agent/skills/<name>/SKILL.md` appears in `/api/capabilities`,
  `/api/overview`, `/api/customize` and `/api/hub` with `root: '.agent'`.
- The same skill's `descTokens` is included in `hubResolve`'s `alwaysOn`
  (`server/index.mjs:1589`) — assert the number changes by exactly that amount.
- A skill present in **both** `.agent/skills` and `.claude/skills` appears **once**, with the
  `.agent` copy winning and `shadowedBy` pointing at the `.claude` path, and raises exactly one
  duplicate finding naming both roots.
- A skill dir containing `.openskills.json` renders a `From` cell with the `source` string; one
  without renders `—`, **not** "unknown", "local", or a blank cell.
- A project with an `AGENTS.md` containing a `<skills_system>` block shows two budget contributors
  instead of one, and their token counts sum to the single old number (assert equality).
- A project with `AGENTS.md` and **no** `<skills_system>` block shows exactly the old single
  contributor — no empty "0 skills" row.
- A machine with no `.agent` directory anywhere produces byte-identical `/api/capabilities` output to
  before the change. This is the regression that matters.
- Unit tests in `test/lib/` for the `<available_skills>` parser: block present, block absent,
  comment-pair-only variant, malformed/unclosed block (must return `[]`, not throw).

---

### 2. Where the context window actually went — measured per-tool accounting

**Customer need.**
A user watching their session hit compaction for the third time in an afternoon wants to know *what
filled the window*. Today ContextExplorer shows them the height of the curve
(`src/sections/ContextExplorerSection.jsx:118-136`) — accurate, real, and mute about composition.
Harness → Config shows a per-tool byte table (`server/index.mjs:3007-3015`) but it is an
all-sessions rollup over a *different denominator* (tool-result bytes only,
`lib/harness-metrics.mjs:96`) and it is not joined to the session the user is looking at. So the
honest answer to "why did this session compact" is currently: open the transcript and read it.

The decision this blocks is concrete: **should I install a context-saving tool at all?** If a user's
top consumer is `Read` of their own source files, a sandbox that executes tool work in a subprocess
saves them nothing. If it is `WebFetch` and `Bash`, it might save a lot. Nobody in this landscape can
answer that question for them, including the tools selling the answer.

**Value to Loush.**
This is our single most defensible position in the whole survey and the reason this research was
worth doing. **We measure; they estimate.** Everything else on this list is parity or catch-up.
See "Measured vs estimated context" below for the full argument and the panel spec.

**How the upstream repo does it today.**
context-mode persists a per-session per-tool table (`src/session/db.ts:827-877`):

```sql
CREATE TABLE IF NOT EXISTS tool_calls (
  session_id TEXT NOT NULL, tool TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0,
  bytes_returned INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, tool)
);
```

`bytes_returned` is real — it is the bytes their `ctx_*` tools actually printed. The companion column
`session_events.bytes_avoided` is not: `hooks/core/routing.mjs` writes `bytesAvoided: 8192` for a
curl/wget Bash command (line 779, source comment "typical curl/wget HTTP body"), `16384` for a denied
`WebFetch` (line 886, "typical web page body bytes prevented"), and `st.size` for a `Read` of a file
over 50,000 bytes (line 859) — the last of which overstates the counterfactual because Claude Code's
`Read` truncates by default. Their displayed percentage (ADR-0004) is
`(1 - max(1, bytesReturned) / (bytesAvoided + bytesReturned)) * 100`, i.e. a ratio whose numerator is
measured and whose denominator is a constant times a counter. Their token figure is `bytes / 4`
(`src/session/analytics.ts:1385`), a flat divisor rather than a tokenizer — the same 4 chars/token
heuristic we use at `server/index.mjs:558` and `lib/harness-metrics.mjs:65`, and we label ours as an
estimate at `server/index.mjs:3009`.

**We take the table shape and nothing else.** `(session_id, tool, calls, bytes_returned)` is the
right unit of attribution. We take no formula, no constant, and no percentage.

**How we implement it here.**
We already compute this. `failStats()` builds, per transcript file, `rec.bytes[toolName]` (total
tool-result characters), `rec.sizes[toolName]` (a 300-sample cap for medians), `rec.big` (results
≥20,000 chars, top 20), and `rec.toolUses[toolName]` (call counts) — `server/index.mjs:1844-1873` —
keyed by `rec.sessionId` at `server/index.mjs:1824`. That *is* `tool_calls(session_id, tool, calls,
bytes_returned)`, already on disk, derived from the transcript, with no hooks and no estimation. It
is currently only ever summed across sessions at `server/index.mjs:2969-2975` and handed to
`contextPressure()`.

1. **Server.** In `/api/context/:sessionId` (`server/index.mjs:3081-3102`), find the matching
   `failStats()` record by `sessionId` and add a `byTool` block built with the existing
   `contextPressure()` helper (`lib/harness-metrics.mjs:74`) so the `denominator` string travels with
   it. Add `calls` from `rec.toolUses`, and `biggest` from `rec.big` (already sorted and capped).
   Nothing new is parsed; this is a join.
2. **The measured denominators.** Emit three numbers per session, each independently true and each
   labelled:
   - `promptTokensPeak` — `max(in + cc + cr)` over turns. Already computed at
     `server/index.mjs:3094`. **Measured, from Anthropic's own usage block.**
   - `promptTokensSum` — `sum(in + cc + cr)` over turns: what the session cost in prompt tokens
     across its life. Measured.
   - `toolResultChars` / `toolResultEstTokens` — tool-result bytes and the ÷4 estimate.
     `contextPressure()` already returns both plus `charsPerToken` (`lib/harness-metrics.mjs:91-97`).
   Emit `toolShareOfPeak = toolResultEstTokens / promptTokensPeak` **only** as a field named
   `estToolTokensOverMeasuredPeak`, with a `caveat` string in the payload explaining that the
   numerator is a character-count estimate and the denominator is a measured token count, so the
   ratio mixes units and is a floor, not a share. If that caveat cannot fit in the UI, **do not ship
   the ratio** — ship the two absolute numbers side by side. Two honest numbers beat one dishonest
   percentage; that is the whole lesson of ADR-0004.
3. **Client.** In `src/sections/ContextExplorerSection.jsx`, add a `ToolBand` component under the
   existing SVG (after `src/sections/ContextExplorerSection.jsx:136`), before the explanatory
   footnote at `:145`. Reuse the `Bars` idiom from `src/sections/InsightsSection.jsx:57-73` rather
   than inventing a chart. Rows: tool name · calls · total chars · est tokens · median · p90 · a
   `hog` marker where `contextPressure` set it. Clicking a row filters the `biggest` list below it.
4. **Rollup.** Harness → Config already renders the all-sessions version
   (`server/index.mjs:3004-3017`). Add a "worst sessions by tool-result bytes" list next to the
   existing `worstSessions` (which ranks by compactions, `server/index.mjs:3014`) and link each row
   into ContextExplorer for that session id.
5. **ChatSection** re-uses `ContextTimeline` (`src/sections/ChatSection.jsx:6`) — the new band must
   be a separate exported component, not spliced into `ContextTimeline`, or it will appear in a
   surface that has no `byTool` data.

**Effort.** S/M. The measurement exists; this is a join, a payload addition and one component.

**Risks and unknowns.**
- **Unit mixing is the whole risk.** Prompt size is measured in *tokens* from `usage`; tool results
  are counted in *characters* from the transcript. `lib/harness-metrics.mjs:52-64` documents exactly
  this class of bug in the previous version of this panel ("Characters were presented as if they were
  tokens"). Every field name must carry its unit: `Chars`, `EstTokens`, `Tokens`. No bare `size`.
- A tool result that entered the context window and was then compacted away still counted toward the
  window at the time. A tool result whose call is *after* the last usage-bearing turn did not. We are
  not modelling time-ordering. State this in the panel: the band is "what tool results this session
  produced", not "what is in the window right now". Do not call it a share of the current window.
- `rec.sizes` is capped at 300 samples per tool per file (`server/index.mjs:1862`), so medians are
  from a sample. `contextPressure` returns `results: sizes.length` — surface it, so the median has a
  visible n.
- Subagent transcripts are separate files (`f.includes('subagents')`, `server/index.mjs:709`). A
  parent session's tool bytes do not include its subagents' bytes, and subagent context is a separate
  window anyway. Exclude them and say so; do not silently merge.
- `failStats()` and `collectUsage()` each walk `~/.claude/projects/**` independently
  (`server/index.mjs:1810` and `:660`) with separate caches. Joining them in one handler doubles the
  cold-start walk for that route. `/api/context/:sessionId` has **no** `HEAVY_TTL` entry
  (`server/index.mjs:102-109`) — add one (60s) or the join runs on every replay click.
- Unverified: whether `RESULT_TEXT` (`server/index.mjs:1830`) captures image and binary tool results
  faithfully. A screenshot result is not well described by `.length`. Where the result content is not
  a string or an array of text parts, count it as `null` and show `unmeasured` rather than a
  `JSON.stringify` length.

**Definition of done.**
- `/api/context/:sessionId` returns `byTool: []` with a `denominator` string and a `charsPerToken`
  field for every session; a session with zero tool calls returns `byTool: []` and the panel renders
  "no tool results recorded in this session", **not** an empty chart and not "0%".
- A tool with no recorded result sizes shows `—` for median and p90, never `0` — the bug
  `lib/harness-metrics.mjs:58` was written to prevent.
- The band's total chars equals `sum(rec.bytes)` for that session id, asserted in a test against a
  fixture transcript in `test/fixtures/`.
- No percentage is rendered anywhere in the panel without a visible denominator or an explicit
  mixed-units caveat next to it.
- Peak context, turns and compaction counts on the existing KPI row
  (`src/sections/ContextExplorerSection.jsx:108-116`) are unchanged by this feature — assert it.
- The word "saved", "savings", "avoided" or "reduction" appears nowhere in the payload or the UI. We
  do not have a counterfactual and we do not invent one.

---

### 3. Offline complexity scorer — `lib/complexity.mjs`

**Customer need.**
A user paying Opus rates has no way to see which of their turns needed Opus. Insights
(`src/sections/InsightsSection.jsx:117`) shows cost by model and cost by project; neither answers
"how much of this was 'fix the typo' and 'run the tests'". Prompt Quality
(`src/sections/PromptQuality.jsx`) answers a related question but costs a `claude -p` call to do it
(`server/promptcheck.mjs:109`), is cached to disk and only recomputed on an explicit refresh
(`server/promptcheck.mjs:128`), samples 120 prompts (`server/promptcheck.mjs:46`), and returns
opaque 1–10 scores that cannot be traced to a phrase in a prompt. There is nothing in this app that
is deterministic, offline, per-turn, and explainable.

**Value to Loush.**
It is the highest-value idea in the survey and it is MIT. A deterministic, offline, fully-inspectable
score over transcripts we already parse gives us: a per-turn tier estimate, a cost-vs-complexity
insight, an explanation panel showing *which dimension fired and why*, and a second, cheap, always-on
input to PromptQuality that does not require spawning `claude`. It runs in the same process, adds no
dependency, and produces the same answer every time it runs — which after ADR-0004 is a feature, not
a detail.

**How the upstream repo does it today.**
`packages/backend/src/scoring/` scores a request across **32 dimensions** — 22 keyword dimensions
matched with a trie (`keyword-trie.ts`) and 10 structural dimensions
(`dimensions/structural-dimensions.ts`) — weights them, applies a momentum carry-forward from the
prior turn (`momentum.ts`), pushes the result through a sigmoid (`sigmoid.ts`) and maps it to a tier.
Full config from `packages/backend/src/scoring/config.ts`:

Keyword dimensions:

| Dimension | Weight | Direction |
|---|---|---|
| simpleIndicators | 0.08 | **down** |
| formalLogic | 0.07 | up |
| technicalTerms | 0.07 | up |
| multiStep | 0.07 | up |
| analyticalReasoning | 0.06 | up |
| codeGeneration | 0.06 | up |
| codeReview | 0.05 | up |
| domainSpecificity | 0.05 | up |
| creative | 0.03 | up |
| questionComplexity | 0.03 | up |
| agenticTasks | 0.03 | up |
| imperativeVerbs | 0.02 | up |
| outputFormat | 0.02 | up |
| relay | 0.02 | **down** |
| webBrowsing, dataAnalysis, imageGeneration, videoGeneration, socialMedia, emailManagement, calendarManagement, trading | **0.00** | up — specificity detection only, no complexity weight |

Structural dimensions (no keywords):

| Dimension | Weight |
|---|---|
| tokenCount | 0.05 |
| expectedOutputLength | 0.04 |
| toolCount | 0.04 |
| nestedListDepth | 0.03 |
| conditionalLogic | 0.03 |
| constraintDensity | 0.03 |
| conversationDepth | 0.03 |
| codeToProse | 0.02 |
| repetitionRequests | 0.02 |

Boundaries and confidence:

```ts
boundaries: { simpleMax: -0.1, standardMax: 0.08, complexMax: 0.35 },
confidenceK: 8, confidenceMidpoint: 0.15, confidenceThreshold: 0.45,
```

Tiers (`packages/shared/src/tiers.ts`), ordered `simple 0 < standard 1 < complex 2 < reasoning 3`,
with their shipped user-facing descriptions:

| Tier | Description (verbatim from `TIER_DESCRIPTIONS`) |
|---|---|
| simple | Heartbeats, greetings, and low-cost tasks that any model can handle. |
| standard | General-purpose requests that need a good balance of quality and cost. |
| complex | Tasks requiring high quality, nuance, or multi-step reasoning. |
| reasoning | Advanced reasoning, planning, and critical decision-making. |
| default | Handles every request when complexity routing is off; final fallback otherwise. |

Nine specificity categories (`packages/shared/src/specificity.ts`), an axis independent of tier:
`coding`, `web_browsing`, `data_analysis`, `image_generation`, `video_generation`, `social_media`,
`email_management`, `calendar_management`, `trading`.

**How we implement it here.**

1. **New file `lib/complexity.mjs`**, plain ESM, zero dependencies, pure functions only — matching
   the shape of `lib/harness-metrics.mjs` (which exists specifically so arithmetic can be pinned by
   tests, `lib/harness-metrics.mjs:1-3`). MIT attribution header naming `mnfst/manifest`, the file
   the weights came from, and the date. Exports:
   ```
   scoreComplexity(text, { toolCount, conversationDepth, priorTier }) ->
     { raw, tier, confidence, confident, dimensions: [{ name, weight, direction, hits, contribution }],
       specificity: [{ category, hits }] }
   ```
   `dimensions` is the explanation: every dimension that fired, what matched, and how much it moved
   the score. This is the part that makes it defensible — a user can disagree with a specific rule
   rather than with a black box.
2. **Keyword matching.** Their `keyword-trie.ts` is an optimisation for a request-path budget
   (<2 ms). Our path is a batch over cached transcripts. Start with a compiled `RegExp` per dimension
   built once at module load. If profiling shows it matters, build a trie later. Do not port a data
   structure we do not need.
3. **Structural dimensions from what we already have.** `collectUsage()` per-entry records
   (`server/index.mjs:681`) carry `tc` (tool calls in the turn) → `toolCount`; the entry index within
   `f.entries` → `conversationDepth`; `scanTranscripts()` prompts (`server/index.mjs:2367`) carry the
   user text, capped at 500 chars — **that cap is a problem** (see Risks). `tokenCount`,
   `nestedListDepth`, `conditionalLogic`, `constraintDensity`, `expectedOutputLength`, `codeToProse`
   and `repetitionRequests` are all computed from the prompt text alone.
4. **Wiring.** `/api/chatstats` (`server/index.mjs:2518`) already walks prompts and already has a
   `HEAVY_TTL` of 600s (`server/index.mjs:104`). Add a `complexity` block: tier histogram, cost per
   tier (join to `entryCost` per turn), the `confident` fraction, and the top contributing dimensions
   overall. Render in `src/sections/InsightsSection.jsx` as a fourth KPI row plus a per-tier bar,
   using the existing `Kpi` (`src/sections/InsightsSection.jsx:47`) and `Bars`
   (`src/sections/InsightsSection.jsx:57`).
5. **PromptQuality.** Add an offline "Complexity mix" panel above the eight model-rated dimensions
   in `src/sections/PromptQuality.jsx:75`, available with **no** refresh and no `claude` call — which
   also fixes the current cold state where an un-refreshed user sees eight hardcoded baseline
   self-scores (`server/promptcheck.mjs:18-37`) and nothing measured.

**Effort.** M. The weights and boundaries are given; the work is 22 keyword lists (manifest ships
them; they are MIT and copyable), 9 structural scorers, the sigmoid, and the wiring.

**Risks and unknowns.**
- **English-only, keyword-based.** `_SYNTHESIS.md` and the research both flag this. It will mis-score
  non-English prompts and unusual phrasing. The `confidenceThreshold: 0.45` gate exists for exactly
  this: **below threshold we must render `unclassified`, not a tier.** `unclassified` is a legitimate
  and frequent answer; the panel must show its share prominently, not hide it in a footnote.
- **Structurally biased upward.** Only `simpleIndicators` (0.08) and `relay` (0.02) carry negative
  weight against 0.61 of positive weight. Expect a distribution skewed toward `complex`. Before
  shipping any cost claim, hand-label 50 turns from our own transcripts and report the confusion
  matrix in the PR. If it does not beat "always say standard", ship the explanation panel and hold
  the cost claim.
- **The 500-char prompt cap** at `server/index.mjs:2367` truncates the input the scorer sees, which
  will systematically depress `tokenCount`, `constraintDensity` and `nestedListDepth` on long
  prompts — the exact prompts most likely to be `complex`. Either raise the cap for a dedicated
  scoring pass, or compute the structural dimensions during the `scanTranscripts` walk where the full
  text is in hand, and cache them on `rec` (bump `rec.v` from 3, `server/index.mjs:2312`).
- **Momentum** (`momentum.ts`) carries the prior turn's tier forward. Manifest needs it because
  flapping changes which model serves the next request. We are describing history, not routing it.
  **Ship without momentum in v1** and note it — adding it later changes historical scores, which is
  exactly the ADR-0004 failure mode (same data, different number, different release). If it is ever
  added, version the scorer and label the version in the payload.
- **We must never present the tier as a routing recommendation.** We have no model-routing surface,
  no way to enforce one, and telling someone "use Haiku for this" from a keyword score would be the
  most confident wrong thing in the app. It is a description of prompt shape.
- Unverified: manifest's keyword *lists* were not reproduced in the research, only the dimension
  names and weights. They must be read from `packages/backend/src/scoring/dimensions/keyword-dimensions.ts`
  in an MIT checkout before implementation. If they are unavailable, the weights are useless on their
  own — say so and stop, rather than inventing our own keyword lists and shipping them under
  manifest's weights.

**Definition of done.**
- `lib/complexity.mjs` exists with zero imports and is covered by `test/lib/complexity.test.mjs`:
  every boundary crossing pinned (`-0.1`, `0.08`, `0.35`), the confidence sigmoid pinned at
  `k=8, midpoint=0.15`, and `confidence < 0.45 → tier: null, label: 'unclassified'`.
- The same input produces the same output across runs and across processes. A golden-file test with
  20 real prompts, committed, so any weight change shows as a diff.
- Empty prompt, whitespace-only prompt and a prompt of 50,000 chars all return a result rather than
  throwing.
- The Insights panel shows the `unclassified` share as a first-class bar, and shows nothing at all
  (not a zeroed chart) when there are fewer than 20 scored turns in range.
- Clicking a tier bar shows the dimension breakdown for a sample turn: dimension name, what matched,
  and its signed contribution.
- No cost-saving claim, no dollar figure attached to a tier, and no model recommendation ships in
  this feature.

---

### 4. Prompt- and description-authoring lint rules from ADR-0002

**Customer need.**
A user writes a skill description, or a PromptStudio prompt, containing `MANDATORY:`, `NEVER`,
`Do NOT` and ✅/❌ bullets, believing that emphatic language makes the model comply. Our current
authoring feedback rewards them for it: `specificityOf()` at `server/index.mjs:588` explicitly adds
**+10 points** for matching `/do not|don't|never|only|instead of/i` in a description. We are
currently scoring in the wrong direction against the only A/B evidence in this landscape.

**Value to Loush.**
`scoreItem()` (`server/index.mjs:560`) is honestly self-labelled as a "static-analysis heuristic, not
an LLM judge", and `src/sections/CapabilityLedger.jsx:258` tells the user in bold that it is a
linter, not a metric. Good. But a linter whose rules have empirical backing is strictly better than
one whose rules are guesses, and this is the one place in the survey where someone ran the
experiment.

**How the upstream repo does it today.**
context-mode's `docs/adr/0002-tool-description-style.md` mandates a five-part template for all 11 of
their `ctx_*` tool descriptions:

```text
<1-line headline, <= 120 chars, imperative-positive>

WHEN:
  - <bulleted positive trigger conditions>

WHEN NOT:
  - <bulleted positive disambiguation from sibling tools>

RETURNS:
  <what the agent sees back, 1-3 lines>

EXAMPLE: <one canonical call with realistic params>
```

The ADR reports it is backed by "38 A/B trials across 6 empirical probes on Haiku and Sonnet", with
two findings:
- **Forbidding language degrades tool selection on some models.** On Opus 4.6, the word **"blocked"
  caused capitulation 6/6 times vs 0/6 for "redirected"** — the same instruction, one word changed.
  `MANDATORY:`, `NEVER` and `blocked` are named as the offending class.
- **✅/❌ emoji bullets tokenize inconsistently across Llama and Gemini families.**

**Reliability caveat, and it is not small.** `TOOL-DESCRIPTIONS-AUDIT.md` — the document ADR-0002
cites as the record of its 38 trials — was **verified absent from their repo tree at `main`**. The
findings are the maintainer's claims, not independently checkable results. Per `_SYNTHESIS.md` §6,
every checkable claim this project published failed when checked. We should adopt these as
**hypotheses worth surfacing**, phrased as such.

**How we implement it here.**

1. **Remove the wrong rule.** Delete the `/do not|don't|never|only|instead of/i` +10 clause at
   `server/index.mjs:588`. It is the only rule in the file that we now have contrary evidence
   against.
2. **Add rules, as advisory notes rather than score deltas.** Extend `scoreItem()`
   (`server/index.mjs:560`) to return `{ score, notes: [] }` where each note is
   `{ rule, severity: 'info'|'warning', text, evidence }`. Rules:
   - `forbidding-language` — `/\b(MANDATORY|NEVER|ALWAYS|DO NOT|NON-NEGOTIABLE|blocked|forbidden)\b/`
     in a description or body → warning, with the exact wording: *"one upstream project's A/B trials
     found forbidding vocabulary degraded tool selection; 'redirected' outperformed 'blocked'. Their
     supporting audit file is not published, so treat this as a hypothesis."*
   - `emoji-bullets` — `/^\s*[✅❌⚠️🚫]/m` → info, "tokenizes inconsistently across model families".
   - `template-shape` — description or body lacks a WHEN / WHEN NOT split → info, with the five-part
     template offered as a fixable suggestion.
   - `no-example` — no `EXAMPLE:` and no fenced block in the body → info.
   Returning notes instead of points keeps the number stable while the advice is new — a score that
   silently changes meaning is the ADR-0004 failure again, in our own house.
3. **Surface.** `src/sections/CapabilityLedger.jsx` `Inventory` renders the score at
   `src/sections/CapabilityLedger.jsx:246-250`; add a notes count cell that expands to the list.
   The same `scoreItem()` output already flows into `overviewItems()` (`server/index.mjs:609`) and
   into `hubResolve` findings, so PromptStudio can reuse it without new plumbing.
4. **PromptStudio** gets the same lint on its prompt bodies via the shared function.

**Effort.** S. One deletion, four regexes, one return-shape change, one cell.

**Risks and unknowns.**
- The evidence is unverifiable (audit file absent). Every note must carry that qualification in its
  user-visible text. **Do not report it as established fact.** If we cannot phrase a rule honestly in
  one sentence in the UI, do not ship that rule.
- The finding is model- and version-specific ("Opus 4.6"). Prompt-following behaviour changes between
  model releases; a rule that was true in one release may be wrong in the next. Date-stamp the rules
  in the source comment.
- `scoreItem()`'s return type is consumed at `server/index.mjs:609`, `:628` and `:2872` — changing it
  from a number to an object touches three call sites. Small, but check all three.
- Removing the +10 at `server/index.mjs:588` changes every `specificity` value already on screen.
  That is a visible, unexplained shift for existing users. Note it in the release note; do not do it
  silently.

**Definition of done.**
- A skill whose description contains `NEVER` produces exactly one `forbidding-language` note, and
  that note's text contains the words "hypothesis" or "unverified".
- A skill with a clean description produces `notes: []` and the UI renders nothing — no "0 issues"
  badge, no green check.
- `specificityOf()` no longer awards points for forbidding vocabulary; a unit test pins the new
  value for a fixture description that previously scored +10 higher.
- Score values for a corpus of fixture skills are unchanged by this feature except for the removed
  clause — asserted in a test, so nobody can slip a scoring change in under the notes work.

---

### 5. Price the third disclosure level — `references/`, `scripts/`, `assets/`

**Customer need.**
A user trims their always-on budget by shortening skill descriptions, then a single skill invocation
pulls in 33 KB of `references/` and their session compacts anyway. Our ledger told them the skill
costs `descTokens` always and `fullTokens` on invoke
(`src/sections/CapabilityLedger.jsx:27-28`, `server/index.mjs:2881-2882`) — and `fullTokens` is
`tokens(content)` of `SKILL.md` alone (`server/index.mjs:617`). Everything under the skill directory
is invisible to the budget.

**Value to Loush.**
`_SYNTHESIS.md` §7 Cluster C's key insight is that *making our dashboard understand their artifacts
beats porting their code*. The Anthropic skill format is explicitly three-level, and we price two of
the three. Closing that is a small change to a number people already trust. It also happens to be
the exact object both upstream projects are arguing about: context-mode's own benchmark has a row
"Skill references (4 files), 33.2 KB → 2,412 B", and openskills' answer to the same problem is to
keep descriptions in `AGENTS.md` and load bodies on demand.

**How the upstream repo does it today.**
openskills documents the format in `examples/my-first-skill/references/skill-format.md`:

```
my-skill/
├── SKILL.md              # required, "Under 5,000 words"
├── references/           # loaded into context selectively
├── scripts/              # executable, "can be run without loading to context"
└── assets/               # used in output, "not loaded to context"
```

Three-level progressive disclosure: (1) `name` + `description`, always in context; (2) `SKILL.md`,
loaded when relevant; (3) resources, loaded as needed. Their `read` command
(`src/commands/read.ts`) dumps the whole `SKILL.md` with no truncation — the "under 5,000 words"
guidance is the only thing keeping it cheap, and nothing enforces it.

**How we implement it here.**
`/api/res/:kind/item` already walks a skill directory and returns every non-`SKILL.md` file as
`assets` (`server/index.mjs:202-210`). Reuse that walk in `hubListSkills`
(`server/index.mjs:1492-1505`) and in `overviewItems()` (`server/index.mjs:600-622`) to produce:

- `refTokens` — `sum(tokens(file))` for `references/**` (loadable into context)
- `scriptBytes` / `scriptCount` — `scripts/**` (executable, **not** priced in tokens — the format
  says they run without loading, so pricing them would overstate)
- `assetBytes` / `assetCount` — `assets/**` (not loaded, not priced)
- `otherTokens` — any loadable `.md`/`.txt` outside those three directories

Add `refTokens` as a ledger column between `fullTokens` and `fires30`
(`src/sections/CapabilityLedger.jsx:27-28`), labelled `Refs (max)` with a tooltip: *"upper bound —
references load selectively, so this is what the skill could cost, not what it did"*. Add
`onInvokeMax = fullTokens + refTokens` to `hubResolve`'s budget block
(`server/index.mjs:1659`, which today is `skills.reduce((s, x) => s + x.fullTokens, 0)`) as a
**second, separately-labelled** figure — do not silently inflate the existing `onInvoke`.

Add a `hubResolve` finding (`server/index.mjs:1633`) for any skill whose `SKILL.md` exceeds ~5,000
words, quoting the format's own guidance.

**Effort.** S.

**Risks and unknowns.**
- `refTokens` is genuinely an upper bound. Nothing in the transcript tells us which reference files a
  given invocation actually read — a `Read` of a path under a skill directory would, and we already
  index touched paths at `server/index.mjs:2374` (`touched`). **A follow-up could measure this
  exactly**: intersect `rec.files` with skill directory paths and report actual reference loads per
  invocation. That is the honest version and it is not much harder; it is scoped out of v1 only to
  keep this feature S.
- Symlinked reference directories could walk outside the skill root. The existing `walkA`
  (`server/index.mjs:204`) does not guard against this. Add a resolve-and-prefix check (the same
  shape as `safe()` at `server/index.mjs:125`) with a depth cap, or a symlinked `references/` →
  `~/` will try to token-count a home directory.
- Binary assets must not be run through `tokens()` (`server/index.mjs:558` is `length / 4` on a
  string). Size-classify by extension; count bytes, not tokens, for anything not plainly text.

**Definition of done.**
- A skill with a `references/` directory shows a non-zero `Refs (max)`; one without shows `—`, not
  `0`.
- `scripts/` and `assets/` contribute **zero** tokens and are reported as counts and bytes only.
- The existing `onInvoke` total at `server/index.mjs:1659` is numerically unchanged; `onInvokeMax` is
  a new, separately-labelled field.
- A skill directory containing a symlink to `$HOME` completes the walk without recursing into it, in
  a test.
- A `SKILL.md` over 5,000 words raises exactly one finding naming the file and its word count.

---

### 6. Harness config-location map

**Customer need.**
A user running Cursor, Codex or Copilot CLI alongside Claude Code sees a dashboard that knows about
one of them. Harness → Config and Setup can only report what they know where to look for.

**Value to Loush.**
context-mode maintains adapters for 17 harnesses (`src/adapters/`: claude-code, codex, copilot-cli,
vscode-copilot, jetbrains-copilot, cursor, gemini-cli, kimi, kiro, omp, openclaw, opencode, pi,
qwen-code, zed, antigravity, antigravity-cli) plus a `configs/<platform>/` tree and a 56,264-byte
`docs/platform-support.md`. That is a free, maintained map of **where every harness keeps its config,
hooks and MCP registration** — research we would otherwise do ourselves.

**How the upstream repo does it today.**
`src/adapters/base.ts` + `types.ts` define the contract, `src/adapters/detect.ts` sniffs which
harness is running, and each adapter writes that harness's own config dialect from
`configs/<platform>/`.

**How we implement it here.**
**Read their docs; write our own table.** This is ELv2 source. Produce a new
`lib/harness-locations.mjs` — a plain data table of
`{ harness, displayName, configPaths[], mcpPath, hooksPath, platform }` — populated from their
`docs/platform-support.md` as a *reference*, verified against each harness's own public
documentation where reachable, with a `verified: true|false|'unread'` field per row so the UI can
distinguish "we checked" from "we copied a claim". Consume it in `/api/harness`
(`server/index.mjs:1431` area) for detection, and in `src/sections/SetupSection.jsx`.

We already do a fragment of this for Cursor: `server/promptcheck.mjs:78-84` hardcodes the
platform-specific Cursor `User` directory three ways. That logic should move into the new table
rather than being duplicated a fourth time.

**Effort.** S for the table plus detection. The value is proportional to how many harnesses we
actually verify.

**Risks and unknowns.**
- Their own issue tracker reports platform-specific breakage in their adapters: #901 (Windows dual
  install trees), #993 (PowerShell hook missing `&`), #873 (OMP install misses routing instructions).
  Their map is not authoritative. `verified: false` rows must render differently.
- Detecting a harness's config file is not detecting that the harness is *used*. Report "config
  found at <path>", never "you use Cursor".
- We are read-only. This feature must not write any other harness's config.
- Windows paths: `_SYNTHESIS.md` §9 flags that several upstream projects hardcode `'/'` splitting.
  Use `path.sep` and `path.join` throughout; this repo runs on Windows.

**Definition of done.**
- `lib/harness-locations.mjs` exports a frozen array; every row has an explicit `verified` value and
  no row claims `true` without a citation in a comment.
- `/api/harness` reports detected harnesses with their config paths; a machine with only Claude Code
  reports exactly one and the panel does not render an empty "other harnesses" section.
- `server/promptcheck.mjs` imports the Cursor path from the table instead of computing it inline.
- No write path anywhere in this feature.

---

### 7. `ModelRoute` and the tier vocabulary for Library profiles

**Customer need.**
Library → Profiles already renders `p.harness.modelRouting[0].model` as a "plan: <model>" chip
(`src/sections/LibrarySection.jsx:61`) and profiles are free-form JSON edited in a CodeMirror pane
(`src/sections/LibrarySection.jsx:79`). There is no schema, no validation, and no vocabulary — a typo
in a profile is discovered when it is applied.

**Value to Loush.**
Modest. manifest gives us a clean, MIT, well-thought-out vocabulary for exactly this: a `ModelRoute`
value type with defined equality, and a four-tier ladder with shipped user-facing descriptions. It
pairs naturally with feature 3 — once we can score a turn's tier we can display "your `plan` profile
routes to Opus; 61% of the turns it ran were `simple`" — but only as an observation.

**How the upstream repo does it today.**
`packages/shared/src/model-route.ts`:

```ts
export interface ModelRoute {
  provider: string;      // "anthropic", "openai", …
  authType: AuthType;    // "api_key" | subscription | local …
  model: string;         // "claude-haiku-4-5-20251001"
  keyLabel?: string | null;  // which credential, when several exist
}
```

Equality is case-insensitive on `provider` and normalises `keyLabel` (trim, lowercase, empty → null),
with a documented lossless bidirectional mapping to a legacy `(model, provider, authType)` triple.
Their relational model splits `override_route` (what the human pinned) from `auto_assigned_route`
(what the system chose) per `(agent, tier)`, so a UI can show divergence — the single best idea in
their schema. Their `TIERS`, `TIER_SLOTS` and `TIER_DESCRIPTIONS` are reproduced under feature 3.

**How we implement it here.**
Add `lib/model-route.mjs` (MIT header, attribution) exporting `TIERS`, `TIER_DESCRIPTIONS`,
`normalizeRoute()` and `routesEqual()`. Validate `harness.modelRouting[]` entries against it in
`readProfiles()` / `PUT /api/gov/profiles`, and render the tier description as the `title` on the
existing chip at `src/sections/LibrarySection.jsx:61`. Adopt the `override` vs `auto` distinction
where a profile pins a model that differs from the resolved harness default: show both.

Do **not** adopt: the Postgres schema, the gateway, `tier_assignments`, `specificity_assignments`,
`header_tiers`, autofix, or the subscription-passthrough providers (see "Not worth taking").

**Effort.** M — mostly because touching profile validation risks breaking a working save path.

**Risks and unknowns.**
- We have no multi-provider concept anywhere in this app. `PRICE_PER_M` (`server/index.mjs:718`) is a
  three-branch regex on the model name. Introducing a `provider` field with nothing to route means
  carrying a vocabulary we do not use. Consider shipping only `TIERS` + `TIER_DESCRIPTIONS` and
  deferring `ModelRoute` until something needs it.
- Adding validation to `PUT /api/gov/profiles` can reject profiles a user already has on disk.
  Validate-and-warn before validate-and-reject.
- Unverified: what `harness.modelRouting` entries actually look like in existing profiles on a real
  machine. Read one before writing a validator against it.

**Definition of done.**
- `lib/model-route.mjs` exists with MIT attribution and unit tests for `routesEqual()` case and
  `keyLabel` normalisation.
- An existing profile that does not match the schema still loads, still applies, and shows a
  non-blocking warning naming the field.
- Tier chips show the verbatim `TIER_DESCRIPTIONS` text as a tooltip.
- No behaviour change to `POST /api/gov/profiles/apply`.

---

### 8. Ranked local search — FTS5 + BM25 + RRF (design only, not scheduled)

**Customer need.**
`/api/search` (`server/index.mjs:2573`) is a case-insensitive substring scan over prompts, assistant
texts, bash commands and edits, returning hits in reverse order with a 60/160-char window
(`server/index.mjs:2586`). No stemming, no ranking, no phrase handling. A user searching "auth
refactor" finds nothing if they wrote "refactoring authentication".

**Value to Loush.**
Real, but this is the largest and least urgent item on the list, and it competes with
`_SYNTHESIS.md` §8 Tier 3.5 (durable store), which is flagged there as "L — makes us stateful, weigh
it". Recorded here for completeness because the design is genuinely good.

**How the upstream repo does it today.**
context-mode chunks markdown by heading with code blocks kept intact, writes chunks to a SQLite FTS5
virtual table with Porter stemming and **titles weighted 5×** (`src/store.ts`), then queries with
**two parallel FTS5 strategies** — a Porter-tokenizer index and a trigram-tokenizer index — merged by
**Reciprocal Rank Fusion**, followed by a proximity rerank and a Levenshtein fuzzy correction pass
(`src/search/unified.ts`). Output over 100 KB is auto-externalised into the index and replaced by a
pointer message (`src/truncate.ts`). Content DBs older than 14 days are garbage-collected at startup.
The multi-writer story is WAL + `busy_timeout`, no `EXCLUSIVE` pragma (their ADR-0001).

The portable part is the *retrieval design*: porter + trigram in parallel, RRF to merge, title
boost, chunk on headings, keep code blocks intact. None of that is code we need to copy, and all of
it is ELv2 code we must not copy.

**How we implement it here — if we ever do.**
Node 22's built-in `node:sqlite` supports FTS5 and adds **no dependency**, which matters: this repo
has 11 runtime dependencies (`package.json`) and no native modules. `better-sqlite3` — which
context-mode uses and ships a repair script for (`scripts/heal-better-sqlite3.mjs`) — is explicitly
ruled out by `_SYNTHESIS.md` §8 Tier 3.5 for its native build failures. An index at
`~/.claude/dashboard-search.db`, rebuilt incrementally off the `(mtime, size)` cache keys the
transcript walkers already use (`server/index.mjs:1816`, `:2312`, `:667`), keyed by
`(sessionId, lineNo)`, would slot behind the existing `/api/search` contract without changing its
response shape.

**Effort.** L. Do not schedule until features 1–5 have shipped.

**Risks and unknowns.**
- It makes us stateful. Everything in this app today is derived-on-read from files we do not own; an
  index is the first thing we would have to keep correct, invalidate, and repair.
- Transcripts are append-only until they are compacted or truncated; incremental indexing must handle
  a file shrinking, not just growing.
- `node:sqlite` FTS5 availability across the Node versions our users run is **unverified**. Check
  before committing to the design.
- A stale index answering confidently is exactly the failure class this whole document is about.
  Every search result must carry its index timestamp, and a stale index must degrade to the current
  substring scan rather than serving old data.

**Definition of done.**
- Not defined. This item is a recorded design, not a scheduled feature. If it is scheduled, it gets
  its own spec.

---

## Measured vs estimated context

This is the section that matters. Everything above is table stakes; this is the argument.

### What we have that they structurally cannot

Anthropic writes a `usage` block on every assistant turn into
`~/.claude/projects/**/*.jsonl`. `collectUsage()` reads it at `server/index.mjs:675-681`:

```js
const u = j.message?.usage, model = j.message?.model
const e = { t, model, proj, in: u.input_tokens || 0, out: u.output_tokens || 0,
            cc: u.cache_creation_input_tokens || 0, cr: u.cache_read_input_tokens || 0, tc }
```

`in + cc + cr` on a turn **is** the total prompt size the model saw for that turn. The three fields
are not three different things to be summed hopefully — they are Anthropic's split of the *same
total* into fresh, cache-write and cache-read. No reconstruction, no counterfactual, no estimate.
That is stated in the source at `server/index.mjs:3053-3054` and again in the client at
`src/sections/ContextExplorerSection.jsx:6-8`, and it is the number plotted at
`src/sections/ContextExplorerSection.jsx:94` and reported at `server/index.mjs:3089`.

context-mode cannot produce this number, and the reason is architectural rather than accidental. They
sit **inside the loop**, at the `PreToolUse` hook, deciding whether a tool call should be redirected
— *before the tool has run and before any turn has completed*. At that moment the size of the next
prompt does not exist yet. So they estimate it, and `hooks/pretooluse.mjs:204` says so in a source
comment: an "estimated `bytes_avoided`" emitted before the tool ever runs. The estimates are
`8192` for a curl/wget Bash command and `16384` for a denied `WebFetch`
(`hooks/core/routing.mjs:779,886`), with only the `Read`-of-a-large-file case using a real file size
(`:859`) — and even that overstates, because Claude Code's `Read` truncates by default, so the whole
file was never going to enter the window.

Their displayed percentage then divides a measured numerator by a partly-fabricated denominator:

```
Without = bytesAvoided + bytesReturned      // bytesAvoided is largely constants
With    = max(1, bytesReturned)             // real
pct     = (1 - With / Without) * 100
```

A ratio built that way cannot look bad. And what is *not* subtracted is the tax: their own routing
block injected into `CLAUDE.md` (4,748 B), a 16,683-byte main `SKILL.md`, seven `ctx_*` skill files,
11 MCP tool descriptions, and each ~400–700-byte redirect prose string that does enter the window.
On a small task the fixed tax could exceed the saving, and their formula would still report a high
percentage.

We are **outside the loop, after the fact**, reading the harness's own accounting. That is a strictly
weaker position for *changing* anything and a strictly stronger one for *knowing* anything. It is
also why their four open issues on this exact subject (#950 part-greater-than-whole in a single
render, #894 statusline stuck on a hardcoded literal, #874 `bytes_avoided` always 0 on one adapter,
#893 "confusing/misleading `ctx stats`", closed) are not bugs we can inherit — we have no
`bytes_avoided` column to get wrong.

And the cautionary tale is theirs, in their own words. `ADR-0004` records the displayed percentage
reading **0%, then 56%, then 95.4% across three releases on identical user data**, purely from
formula changes. Same disk, same sessions, three answers. The same ADR records that on the reporter's
machine 84% of `eventDataBytes` was 496 duplicate copies of one `CLAUDE.md` captured across resume
cycles, and that the schema's `data_hash` dedup column "is populated but unused by the formula".

**We do not get to feel superior about this.** Our numbers are derived too. What protects us is not
better intentions; it is the rule at `lib/harness-metrics.mjs:96` — ship the denominator in the
payload so the client cannot re-label the number — and the fact that the previous version of our own
context panel made exactly this mistake, documented at `lib/harness-metrics.mjs:50-64`: a "share"
that was the share of tool-result characters, rendered under a heading about the context window.
That got caught. The next one will only get caught if the rule holds.

### What the panel looks like

Lands in `src/sections/ContextExplorerSection.jsx`, below the existing timeline SVG (after `:136`),
above the explanatory footnote (`:145`). Three stacked parts.

**Part A — the measured line (already shipped, unchanged).**
Peak context, turns, compactions (`:108-116`) and the per-turn curve (`:118-136`). Header keeps its
current framing: *"real per-turn context occupancy · plane: this machine only"* (`:56`).

**Part B — where the tool results went (new).**

```
Tool results produced by this session                        measured from transcript
────────────────────────────────────────────────────────────────────────────────────
Read          ████████████████████████░░░░░░   412 KB   ~103k est tok   38 calls
                                                        median 4.1 KB · p90 31 KB (n=38)
Bash          ██████████░░░░░░░░░░░░░░░░░░░░   171 KB    ~43k est tok   96 calls  ⚑ hog
                                                        median 1.2 KB · p90 22 KB (n=96)
Grep          ████░░░░░░░░░░░░░░░░░░░░░░░░░░    64 KB    ~16k est tok   22 calls
WebFetch      ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░    31 KB     ~7k est tok    4 calls
────────────────────────────────────────────────────────────────────────────────────
denominator: tool-result bytes only — excludes system prompt, CLAUDE.md, user turns
             and assistant output.  tokens are an estimate at 4 chars/token.
```

The `denominator` and `charsPerToken` strings are printed **from the payload**
(`lib/harness-metrics.mjs:96`, `:93`), not retyped in JSX. `⚑ hog` is `contextPressure`'s existing
`hog` flag (median ≥ 20,000 chars, `lib/harness-metrics.mjs:88`). `n=` is `results`, so the median
carries its sample size, and the 300-sample cap (`server/index.mjs:1862`) is disclosed in the
tooltip.

**Part C — the two numbers, side by side, never divided.**

```
Measured peak prompt        Tool-result bytes this session
147,204 tokens              678 KB  ≈ 170k tokens (estimated at 4 chars/token)
from usage.input_tokens     from tool_result content length
+ cache_creation + cache_read
```

Two boxes. Different provenance labels. **No arrow between them, no percentage, no "of".** They are
different units measured different ways over different time spans — the tool bytes accumulate across
the whole session while the peak is one turn — and the honest presentation is adjacency, not
arithmetic. If a later version wants a ratio, it ships with the mixed-units caveat visible in the
same viewport as the number, or it does not ship.

**Empty and null states, per our honesty rules.**
- Session with no tool calls → *"no tool results recorded in this session"*. Not an empty chart, not
  `0%`.
- Tool with no sampled sizes → `—` for median and p90. Never `0` (`lib/harness-metrics.mjs:58,86`).
- Non-text tool result (image, binary) → counted in `calls`, `unmeasured` in bytes, with a footnote
  giving the count of unmeasured results. Never `JSON.stringify().length`.
- No sessions with ≥2 usage turns → the existing message at
  `src/sections/ContextExplorerSection.jsx:73` ("no replayable sessions (need ≥2 turns with usage)")
  already does this correctly. Match its tone.

**What the panel must never say.** No "saved". No "avoided". No "reduction". No "would have been". No
percentage of a window we did not measure the composition of. We have no counterfactual — we cannot
know what the session would have cost with a different toolchain — and the entire point of this
feature is that we did not invent one.

---

## Not worth taking

- **`openskills/src/utils/yaml.ts`.** Their `extractYamlField` is `new RegExp('^' + field + ':\\s*(.+?)$', 'm')`
  — the `m` flag matches anywhere in the file, so a `description:` line inside a fenced code block in
  the body wins. It handles no quoting, no folded or block scalars (`description: >`), and no
  frontmatter delimiters. Our `parseFM` (`server/index.mjs:139-145`) anchors on
  `/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/`, parses the captured block with the real `yaml` package
  (already a dependency), and surfaces failures as `{ _parse_error }` rather than an empty string.
  Ours is correct; theirs is not. **Do not port.**
- **`PreToolUse` interception** — rewriting Bash, denying WebFetch. Contradicts read-only, which is
  our thesis, and their issues #911 and #946 report their injected framing tripping Claude Code's own
  auto-mode classifier and blocking *other* plugins' subagent dispatches. It is the part of their
  product with the worst bug-to-feature ratio, and it is also the part they sell.
- **Any `bytes_avoided`-style estimate.** No hardcoded byte constants for "what a tool would have
  returned". If we cannot measure it, we do not print it.
- **Their statusline.** `bin/statusline.mjs` renders the literal `saves ~98% of context window` at
  lines 240, 254, 331 and 375 whenever analytics fail to load (`_analytics = null` on the catch path
  at line 59). Their own issue #894 puts it best: a plausible-but-fake number shown forever is worse
  than an honest "stats unavailable". That is a design rule for us, not a feature.
- **`bytes / 4` as a token count presented as a token count.** We use the same 4 chars/token
  heuristic (`server/index.mjs:558`, `lib/harness-metrics.mjs:65`) — the difference is that ours is
  labelled `estTokens` and ships `charsPerToken` with it. Keep that discipline; do not adopt a
  divisor that presents as a measurement.
- **manifest's Docker + PostgreSQL + NestJS runtime.** A 211 MB monorepo and a database, against a
  Vite app that reads files. Take `scoring/`, `tiers.ts` and `model-route.ts`; take nothing that
  needs a container.
- **manifest's subscription-passthrough providers.** 18 flows routing consumer ChatGPT Plus / Claude
  Max / Copilot subscriptions through a gateway for programmatic use, very likely contrary to those
  providers' terms. Not our problem to solve and not something to mirror or endorse in a dashboard.
- **manifest's autofix ("Phoenix") and the MPS parameter catalogue.** MPS is a genuinely good
  pattern — one `applicability` field instead of ad-hoc `disabledWhen`/`conflictsWith`/`ui` keys —
  but we have exactly one provider and 443 lines of working form in `src/sections/SetupSection.jsx`.
  Revisit if a second provider ever appears; do not build a catalogue for a catalogue of one.
- **openskills' install/update/remove lifecycle.** `git clone` + `cpSync`, no lockfile, no checksum,
  no semver, and their own issue #81 asks for a `skill.json` that never arrived. Our Customize toggle
  (`server/index.mjs:446-460` → `lib/customize-toggle.mjs`) is reversible and backed up. Different
  jobs; theirs is the one we do not want.
- **Tracking any of the three upstreams.** openskills is dormant (zero commits since 2026-01-18).
  Vendor what we take, pin the commit sha in a file header, and stop.
- **Every performance number in the research.** 98%, 96%, 82%, 70–90%, "~1 KB for 20 skills". Not in
  our UI, not in our README, not in a comparison table, not as a quote.

---

## Open questions for the maintainer

1. **Do we have written permission from `mksglu`, and does it name ELv2?** The brief says permission
   exists. `_SYNTHESIS.md` §5 says it "may not cover the code at all" for the ELv2 case. This spec is
   written on the assumption that **we take no context-mode source** and only reimplement schemas and
   findings from prose. If there is a written, ELv2-naming permission, features 6 and 8 get cheaper.
   If there is not, nothing here changes — which is deliberate. Confirm which world we are in.

2. **Feature ordering: is correctness-first the right call?** I put the `.agent/**` blind spot ahead
   of the flagship context panel because it is a *wrong number* rather than a *missing number*, and
   `_SYNTHESIS.md` §8 lists `.agent/` roots under Tier 0 ("Corrections. Do before any feature work").
   If the priority is the differentiator narrative, swap 1 and 2 — they do not depend on each other.

3. **Do you want the mixed-units ratio at all?** Feature 2 deliberately ships two absolute numbers
   side by side rather than "tool results are N% of your window", because the numerator is a
   character estimate and the denominator is a measured token count. A ratio would be a better
   headline and a worse number. I have specified the honest version. Overrule me explicitly if you
   want the ratio, and it ships with the caveat inline.

4. **Manifest's keyword lists — do we have an MIT checkout?** The research reproduced the 32
   dimension names, all weights, the boundaries and the confidence constants, but **not** the keyword
   lists inside `dimensions/keyword-dimensions.ts`. Weights without keyword lists are unusable.
   Either someone pulls that file from an MIT checkout, or feature 3 stops at the structural
   dimensions (9 of 32, weights summing to 0.29) and says so. Inventing our own keyword lists and
   shipping them under manifest's weights would produce a scorer that is neither theirs nor
   validated.

5. **Should feature 3 ship a cost claim in v1?** "You paid Opus rates for 340 simple-tier turns" is
   the compelling line and it depends entirely on the classifier being right. The scorer is
   structurally biased upward (0.61 of positive weight against 0.10 of negative) and English-only. I
   have specified: ship the explanation panel, hold the cost claim until a hand-labelled 50-turn
   confusion matrix beats the "always standard" baseline. Confirm that gate.

6. **Are we willing to become stateful for search (feature 8)?** It is the only item here that
   changes what kind of program this is. `_SYNTHESIS.md` §8 Tier 3.5 flags the same decision and does
   not resolve it. Recorded, not scheduled, pending your call.

7. **Is there a real `.agent/skills` tree to test against?** Feature 1's DoD is written against a
   synthetic fixture. If nobody on the team actually uses openskills, the feature is correct and
   entirely unexercised — which is fine, but it should be a conscious choice rather than a discovery
   made later.

8. **Does removing the +10 for forbidding language (feature 4, `server/index.mjs:588`) need a release
   note?** It silently changes every `specificity` value currently on screen. I have specified a
   release note. Confirm, or specify a migration.

---

## Provenance of this document

Read while writing: `context-and-skills-tooling.md`; `_SYNTHESIS.md` §5–§8;
`src/sections/ContextExplorerSection.jsx`, `src/sections/CapabilityLedger.jsx`,
`src/sections/LibrarySection.jsx`, `src/sections/McpSection.jsx`,
`src/sections/InsightsSection.jsx`, `src/sections/PromptQuality.jsx`; `server/index.mjs`;
`server/promptcheck.mjs`; `lib/harness-metrics.mjs`; `lib/paths.mjs`; `package.json`;
`src/App.jsx` (nav placement).

Claims about upstream repositories are second-hand — they come from `context-and-skills-tooling.md`,
which fetched them live on 2026-07-29. No upstream source was re-fetched for this spec. Where the
research and our code disagreed, our code won; the `AGENTS.md` budget-blind-spot claim in the
research (`context-and-skills-tooling.md`, Overlap table) is one such case — `AGENTS.md` *is* already
in our rules stack (`server/index.mjs:399,1527`) and its tokens *are* already in `alwaysOn`
(`server/index.mjs:1584,1589`), so feature 1(d) is scoped to attribution rather than to counting.
