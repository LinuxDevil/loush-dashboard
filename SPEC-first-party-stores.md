# SPEC — the three undocumented first-party stores

Implementation spec turning `ecosystem-landscape-scan.md` §"Transcript JSONL schema references" and
`_SYNTHESIS.md` §3 / §8 Tier 3.1–3.2 into shippable work. Written 2026-07-29.

**Scope:** `~/.claude/usage-data/session-meta/`, `~/.claude/usage-data/facets/`,
`~/.claude/file-history/<session>/<hash>@vN`, plus transcript-schema hardening.

---

## 0. Read this before anything else — what the probe found

The assignment's premise is that three undocumented stores exist and that `file-history` converts
WorkingSet's rework rank from a heuristic into a measurement. I re-probed all three on this machine
(Windows 11, 2026-07-29, 1,285 transcripts under `~/.claude/projects`) before writing a line of spec.

**All three stores exist, exactly at the paths the research names, with exactly the key names it
lists.** The research is accurate on presence and shape. It is materially incomplete on **coverage
and freshness**, and that changes what is worth building.

| Finding | Evidence |
|---|---|
| `usage-data/session-meta/` — 51 files, 47 of which match a transcript id | all 27 documented keys present in 51/51 files |
| **`usage-data/` is a one-shot report cache, not a live store** | all 51 session-meta mtimes fall inside a 0.4 s window at 2026-07-08 23:57 local; all 41 facets mtimes inside 0.02 s at 23:57:25; `usage-data/report.html` and `report-2026-07-08-235809.html` both 23:58. **Nothing has been written there in the 21 days since.** |
| `usage-data/facets/` — 41 files, 37 match a transcript id | `claude_helpfulness` and `session_type` absent from 2 of 41 — optional keys confirmed |
| `file-history/` — **2 session directories, 12 snapshot files, corpus-wide** | vs. 1,285 transcripts. Max version observed: `@v3` |
| **The `<hash>@vN` filename does not encode the path.** The path→hash map lives only in the transcript | `type: "file-history-snapshot"` → `snapshot.trackedFileBackups[<path>] = { backupFileName, version, backupTime }` |
| `backupFileName` can be `null` while `version` is set | 4 of 32 tracked-file entries observed — a version exists with no snapshot on disk |
| Path keys are mixed absolute and cwd-relative, with Windows separators | 2 absolute (`C:\Users\…\file.md`), 30 relative (`package.json`, `electron\lib\updater.js`) |
| `structuredPatch` — our current source — covers **99 sessions / 2,076 edit events** | `file-history` covers **2 of those 99 sessions** |
| `toolUseResult.userModified` present on **all 2,076** edit results, `true` on **0** | the field is real; the event has never fired in this corpus |
| `attachment.type: "edited_text_file"` — **79 occurrences**, carries `filename` + `snippet` | the human-edit signal that *does* fire here |
| `toolUseResult.gitOperation.commit` 24 · `.push` 23 · `toolUseResult.toolStats` 238 | all confirmed, all unexploited by us |
| 13 top-level `type` values, 220 most-recent transcripts / 35,807 lines | reproduced the landscape scan's list and rank order exactly — see §Schema reference plan |

**The consequence for the flagship.** `file-history` gives an exact per-file *version counter*, and
that counter is readable **from the transcript alone** — we never need to open the snapshot
directory unless we want file contents. But on real data it exists for 0.16% of sessions and 2% of
sessions that had edits. **It cannot replace the rework rank.** It can decorate the rank with an
exact, second-source count on the rare rows where it exists, and that is what §"The rework-rank
upgrade" specs.

I want to be blunt because the assignment weighted this heavily: **the sentence "these snapshots
would make it a measurement" does not survive contact with the corpus.** The honest version is "these
snapshots make a small, clearly-labelled subset of rows measured, and leave the rest inferred." That
is still worth shipping — it is exactly the measured-vs-estimated distinction `_SYNTHESIS.md:48-53`
argues turns a correctness concern into a differentiator — but it is a labelling feature, not a
replacement of `reworkScore()`.

**A hypothesis worth testing, flagged as unverified.** Every tracked file I found is either outside a
git repo (`C:\Users\recti\Downloads\blossom-grove-….md`, a scratchpad `labels.json`) or a
root-level config in a project (`package.json`, `forge.config.js`, `electron\main.js`). It is
plausible that checkpointing only backs up files git cannot restore. If true, `file-history` is
structurally near-empty for exactly the repo-scoped source files WorkingSet ranks. **Unverified — I
have 5 tracked files, which is not a sample.** See §Open questions.

---

## Features

Ordered by value ÷ effort, with the WorkingSet work weighted up. Each ships independently; feature 1
is a hard dependency for 2, 4, 5 and 6.

Effort scale: **S** ≤ 1 day · **M** 1–3 days · **L** ≥ 1 week.

---

### 1. `lib/claude-stores.mjs` — the store probe and provenance primitive

**Customer need.** Nobody hurts today, because nothing reads these stores. The person who hurts is
the *next* one: whoever ships feature 2 or 4 and gets a support issue reading "the dashboard shows a
number my colleague's machine doesn't have". Today every reader of `~/.claude` in this repo does its
own `fs.existsSync` and swallows failures in a bare `catch {}` (`server/index.mjs:660`, `:1810`,
`:2302`, `:2323`), which is correct for a format that is stable and wrong for one that is not.

**Value to Loush.** This is the module that makes everything downstream safe to ship against an
undocumented format, and it is the only artefact here that is reusable across sections. It also
gives us a shippable UI surface on its own: a "first-party data" row in Setup/Governance that says
what this install actually has.

**How it works today (upstream).** No project among the 690 catalogued reads any of these stores, so
there is no upstream implementation to copy. The nearest pattern is `claude-code-log`'s
`PassthroughTranscriptEntry` (landscape scan §Practical guidance, item 1): unknown shapes are
skippable structural entries, never errors.

**How we implement it here.**
- New `lib/claude-stores.mjs`. Path resolution goes through `lib/paths.mjs` (its header explains
  exactly why five modules deriving their own paths was a defect) — add a `CLAUDE_DIR` export there
  and consume it, rather than repeating `path.join(HOME, '.claude')` as `server/index.mjs:42` does.
- Export one function per store plus an aggregator:
  ```
  probeSessionMeta() → { rung, dir, files, validated, rejected, generatedAt, coverage, sample }
  probeFacets()      → same shape
  probeFileHistory() → same shape, plus { sessions, snapshots }
  probeStores()      → { sessionMeta, facets, fileHistory, probedAt }
  ```
- Every probe returns a **rung** (0–3, defined in §Probe design), never a boolean. `null` for any
  count we could not establish — the rule `src/sections/InsightsSection.jsx:11-13` already states.
- Validators are pure functions over a parsed object, exported separately
  (`validateSessionMeta(obj) → { ok, missing[], wrongType[] }`) so they are testable against
  fixtures without a `~/.claude` on the machine running the tests.
- Memoize on `(dir mtimeMs, file count)` with a 60 s floor, matching the `(mtime,size)` cache key
  idiom at `server/index.mjs:667` and `:2312`.
- New route `GET /api/firstparty/health` returning `probeStores()`. Read-only. No new dependency.
- Render it in Setup as a three-row table: store · rung · files · generated · what we do with it.

**Effort.** S.

**Risks and unknowns.**
- The probe reads up to N files per store on every call. Cap the validation sample at 12 files and
  memoize; `session-meta` is 51 files today but is not bounded by anything we control.
- `file-history` is in `SKIP_DIRS` at `server/index.mjs:497` so the artifacts browser ignores it.
  That is correct and must stay — these are file *contents*, and surfacing them in a file browser
  would leak repository content into a panel that has no business showing it.
- Nothing guarantees `usage-data/` is not repurposed. The probe validates keys, not the directory's
  meaning; a future Claude Code could put a differently-shaped `session-meta` there. Rung 1 covers it.

**Definition of done.**
- `GET /api/firstparty/health` returns all three stores with a rung and a `probedAt`.
- On a machine with **no** `~/.claude/usage-data`, every store reports rung 0 and the Setup row reads
  "not present on this install" — not "0 sessions", not a green tick.
- On a machine where `session-meta` files exist but a required key is missing, the store reports
  rung 1 and the Setup row names the failing key.
- Unit tests in `test/lib/claude-stores.test.mjs` cover: absent dir, empty dir, valid file,
  missing-key file, wrong-type file, unparseable JSON, and the ≥80% quorum boundary.
- No section renders a number sourced from a store below rung 2.

---

### 2. WorkingSet — exact-version overlay and per-row provenance  ⭐ flagship

**Customer need.** A frontend engineer opens WorkingSet mid-ticket and sees `rank 14` against
`src/sections/Foo.jsx`. The tooltip at `src/sections/WorkingSet.jsx:180` shows the arithmetic, and
the footer at `:218` says in bold that the rank is a heuristic, not a measurement. That is honest and
it is also the panel's weakest moment: the user has no way to tell a row we *inferred* from a row we
could *count*. Today they do what everyone does with a score they can't audit — they discount it.

**Value to Loush.** `_SYNTHESIS.md:121-130` argues our empty ground is *judgement*, not counters, and
that WorkingSet sits there. The way you defend a judgement is to show your evidence tier per row.
Nobody in the 690-project survey does this. It is also the cheapest way to keep the honesty promise
while raising confidence: the rank stays a heuristic; the *evidence* becomes visible.

**How it works today (first-party).** Claude Code writes `type: "file-history-snapshot"` entries into
the trunk transcript. Each carries `snapshot.trackedFileBackups`, a **cumulative** map from a file
path to `{ backupFileName, version, backupTime }`. Successive entries in a session repeat and extend
the map — so the *last* such entry in a session carries the highest version per file. The snapshot
bytes live at `~/.claude/file-history/<sessionId>/<backupFileName>`; `backupFileName` is null when a
version was recorded without a stored backup.

The important structural fact: **the version counter is in the transcript.** We already parse every
transcript line in `scanTranscripts()` (`server/index.mjs:2299`). Reading the counter costs one more
branch in a loop we already run. Opening `file-history/` at all is optional and, per §0, mostly
pointless.

**How we implement it here.**

*Parser (`server/index.mjs:2299-2406`, inside the existing `scanCache` v3 record — bump to v4):*
- Add a branch alongside the `structuredPatch` handler at `:2352`:
  ```
  if (j.type === 'file-history-snapshot' && j.snapshot?.trackedFileBackups) → merge into rec.fhVersions
  if (j.type === 'file-history-delta'    && j.trackingPath && j.backup)      → merge single entry
  ```
  `rec.fhVersions` is `{ [pathAsWritten]: { version, backupFileName, backupTime } }`, keeping the
  max `version` per path. Cap at 500 paths, mirroring the `rec.files` cap at `:2390`.
- **Path normalisation is the load-bearing detail.** Keys are mixed absolute and cwd-relative with
  `\` separators. Resolve with `path.resolve(rec.cwd, key)` then normalise separators — `rec.cwd` is
  already captured at `:2334`. A key we cannot resolve to an absolute path is **dropped**, not
  guessed. Count drops and surface the count (see DoD).
- Emit on the session rollup at `:2402` as `fhVersions`, so `mountFe`'s `harvest()`
  (`server/fe.mjs:396`) sees it without a second walk.

*Aggregation (`server/fe.mjs:203-243`, `aggregateFiles`):*
- Per row, sum the max version across the sessions that touched the file:
  `exactVersions = Σ_session max(version)`. This is a count of *stored revisions*, which is a
  different quantity from `edits` (Edit/Write tool calls) and must never be presented as the same
  thing — a single tool call can bump a version, and several can share one.
- Add to the row: `exactVersions` (number or `null`), `exactSessions` (how many of the row's
  sessions had a tracked version), `provenance` ∈ `'measured' | 'inferred'`.
  `provenance = 'measured'` **only** when `exactSessions === sessionCount` — a partially-covered row
  is `'inferred'`, because a version count that is missing for half the sessions is worse than no
  version count at all.
- **`reworkScore()` at `server/fe.mjs:179-193` does not change.** Weights stay
  `{ revisitSession: 3, revisitDay: 2, failure: 2, extraEdit: 1 }`; `null` below
  `REWORK_MIN_SESSIONS` stays. See §"The rework-rank upgrade" for why replacing `extraEdits` with
  `exactVersions` is the wrong move.

*API (`server/fe.mjs:487-514`):*
- Add `provenance: { fileHistory: <rung>, measuredRows: n, totalRows: n, unresolvedPaths: n }` to
  the `/api/fe/workingset` payload, next to the existing `graph` block that already prints its own
  truncation (`:495-502`). Same principle, new subject.

*UI (`src/sections/WorkingSet.jsx`):*
- New column `rev` between `edits` and `sessions`, rendered with the existing null-safe `N()` helper
  at `:34` — `—` when we have no version data, never `0`.
- A one-character provenance marker on the rank cell at `:179`: `▪` measured, nothing for inferred.
  Colour it with `ACCENT`, not green — green reads as "good", and this is "well-evidenced".
- Extend the header line at `:126-130` with `· N of M rows have exact version counts`, using the
  same visible-denominator idiom the graph stats already use.

**Effort.** M. The parser branch is ~20 lines; path normalisation, the aggregation join, the API
field and the column are the rest. Add ~1 day for the fixture corpus (see DoD).

**Risks and unknowns.**
- **Coverage is 2 of 1,285 sessions here.** On most installs this column will be entirely `—`. That
  is an acceptable, honest outcome — but it means the feature's user-visible payoff is small and the
  team should not expect the flagship to change character. Ship it for the provenance framing, not
  the numbers.
- The relationship between "a version bump" and "an edit" is **unverified**. I have not confirmed
  whether a version is created per Edit call, per user turn, or per checkpoint boundary. Until that
  is established the column is labelled `stored revisions`, never `edits`.
- Absolute keys are absolute on the *authoring* machine. A transcript copied from another machine
  yields paths that resolve nowhere; those must drop silently into `unresolvedPaths`, not throw.
- `scanTranscripts` caps `rec.edits` at 400 per transcript (`server/index.mjs:2362`) and `rec.files`
  at 500 (`:2390`). The cap does **not** bite on this corpus — the heaviest session has 217 edits
  across 74 files — but it is a silent truncation of the rank's own input. Worth a follow-up: make
  the cap report itself the way `graph.truncated` does at `server/fe.mjs:498`.
- The trunk transcript may not be the only place snapshot entries land. Subagent transcripts under
  `<session>/subagents/` are walked by the same walker, so their `sessionId` is the *file* basename,
  not the parent session — check that `file-history/<sessionId>` lookups use the parent id. Unverified.

**Definition of done.**
- A file with zero tracked versions shows `—` in `rev` and no provenance marker; the rank is
  unchanged from today, byte for byte.
- A file with tracked versions in every one of its sessions shows the integer and the `▪` marker.
- A file with versions in *some* sessions shows the integer and **no** marker, and its tooltip says
  "version counts missing for k of n sessions".
- The rank tooltip at `:163` and `:180` still shows the full four-term arithmetic, unchanged.
- The footer sentence at `:218` still says the rank is a heuristic. It gains one clause, not a
  contradiction — see §"The rework-rank upgrade".
- Header prints `N of M rows have exact version counts` and, when non-zero, `k paths unresolved`.
- `test/server/fe-workingset.test.js` gains cases for: no fhVersions, full coverage, partial
  coverage, a null `backupFileName`, a Windows relative key, an unresolvable absolute key.
- A fixture transcript containing a real `file-history-snapshot` entry lives under `test/fixtures/`
  with paths scrubbed.

---

### 3. `usage-data/facets/` — Claude's own outcome and friction grade

**Customer need.** Someone reviewing a week of agent work wants to know which sessions went badly.
Today they read `Insights → Stats` and get correction rate, abandonment rate and one-shot rate
(`src/sections/InsightsSection.jsx:91-98`) — three proxies derived from prompt shape. None of them
knows whether the session actually achieved anything.

**Value to Loush.** Claude Code has already graded these sessions with an LLM, locally, for free.
`outcome`, `claude_helpfulness`, `friction_counts` and `user_satisfaction_counts` are a
qualitative signal we cannot derive at any price, and `_SYNTHESIS.md:86` is right that nobody
surfaces it. `millionco/claude-doctor` reimplements a cruder version with AFINN sentiment scoring
(landscape scan §Tier 3c) — we would be showing the first-party grade instead of guessing.

**How it works today (first-party).** `~/.claude/usage-data/facets/<sessionId>.json`, 11 keys.
Verified value vocabularies from 41 files on this machine:
- `outcome` ∈ `fully_achieved · mostly_achieved · partially_achieved · not_achieved · unclear_from_transcript`
- `claude_helpfulness` ∈ `essential · very_helpful · moderately_helpful · unhelpful` (absent in 2/41)
- `session_type` ∈ `single_task · multi_task · iterative_refinement · exploration` (absent in 2/41)
- `primary_success` ∈ `good_debugging · multi_file_changes · good_explanations · proactive_help ·
  correct_code_edits · fast_accurate_search · none`
- `friction_counts` keys ∈ `buggy_code · wrong_approach · user_rejected_action · misunderstood_request`
- `user_satisfaction_counts` keys ∈ `likely_satisfied · satisfied · happy · neutral · unclear ·
  dissatisfied · frustrated`
- `goal_categories` — **effectively free-form**: ~60 distinct keys across 41 files, most occurring
  once (`fix_seed_import`, `configure_auto_update`, `verify_no_work_lost`). Do not build a taxonomy
  chart on this; see §Not worth taking.
- `underlying_goal`, `brief_summary`, `friction_detail` are prose.

**How we implement it here.**
- New tab `Session grades` in `src/sections/QualitySection.jsx` (which already has the `Tabs`
  scaffold at `:26`), backed by `GET /api/quality/facets`.
- The route calls `probeFacets()` from feature 1, joins each facet to the session rollup from
  `scanTranscripts()` on `session_id`, and returns only sessions where both sides exist.
- Two panels: a stacked bar of `outcome` and `claude_helpfulness` over the covered sessions, and a
  friction table (`friction_counts` key × count × sessions), each row expandable to
  `friction_detail` and `brief_summary`.
- **The masthead is the feature.** Because `usage-data/` is a one-shot report cache (§0), the panel
  must state, always and unmissably: `41 sessions graded · generated 8 Jul 2026 · 1,285 sessions on
  disk`. The precedent is `QualitySection.jsx:135-141`, which already refuses to call a
  code-generated baseline an all-clear. Same discipline, different subject.
- Enum values are rendered from a whitelist derived from the vocabularies above. An unrecognised
  value renders verbatim in dim type and is counted in an `unrecognised` bucket — never dropped,
  never coerced.
- Prose fields (`friction_detail`, `brief_summary`, `underlying_goal`, `first_prompt`) are user
  content. They stay local, they are never included in any bundle or export, and they are not sent
  to the model by any code path we add.

**Effort.** M.

**Risks and unknowns.**
- **Staleness is the dominant risk and it is structural.** The store has not been written in 21 days
  on this machine. A user who sees "6 fully achieved" without reading the date will draw a
  conclusion about last week from data about early July. The date must be in the same visual block
  as the numbers, not in a footnote.
- I could not determine what regenerates `usage-data/`. It correlates exactly with
  `report-2026-07-08-235809.html`, so a `/usage`-report command is the obvious candidate —
  **unverified**, and we must not invoke it ourselves (§Not worth taking).
- The grades are LLM-derived, so they carry the failure mode `_SYNTHESIS.md:174-180` warns about:
  a formula change upstream silently changes the number. Never trend these over time; render the
  distribution for a single generation only.
- 4 of 41 facet files reference a session id with no transcript on disk. Those sessions are
  unlinkable; count them, don't hide them.

**Definition of done.**
- With `usage-data/facets` absent: the tab renders one sentence — "Claude Code has not written
  session grades on this install" — and no chart, no zero, no empty axes.
- With facets present: every panel carries `n graded · generated <date> · m sessions on disk`.
- A facet file missing `claude_helpfulness` renders that session as `—` in the helpfulness
  distribution and is excluded from its denominator; the denominator is printed.
- An unrecognised enum value appears verbatim and is counted in `unrecognised`.
- No prose field from `facets/` appears in `contextBundle()` output (`server/fe.mjs:555`) or any
  clipboard/export path.

---

### 4. `usage-data/session-meta/` as a **reconciliation** source, not a data source

**Customer need.** Whoever has to answer "is the dashboard's line count right?" This is currently
unanswerable — we derive `add`/`del` from `structuredPatch` in three places
(`server/index.mjs:691-700`, `:2352-2363`, `server/fe.mjs:215-223`) and have no second opinion.

**Value to Loush.** I compared first-party `session-meta` against our own derivation across the 47
sessions present in both:

| Metric | Agreement |
|---|---|
| `tool_errors` vs our `is_error` count | **46 / 47** |
| `files_modified` vs our distinct `filePath` count | **39 / 47** |
| `lines_added` vs our `structuredPatch` sum | **14 / 47** |

The line counts disagree badly and mostly in one direction — first-party is larger (1037 vs 126;
1885 vs 287; 536 vs 3). The most likely explanation is that a `Write` of a new file has no
`structuredPatch` to sum, so we count near-zero for exactly the largest changes. **That is a defect
in our number, discovered by a store nobody thought to compare against.** One session runs the other
way (0 vs 607), consistent with the first-party file being generated mid-session on 8 Jul.

That makes this store's real value diagnostic. It is a free oracle for a metric we ship.

**How it works today (first-party).** 27 keys, all present in 51/51 files. `lines_added`,
`lines_removed`, `files_modified`, `tool_errors`, `tool_error_categories`, `user_interruptions`,
`git_commits`, `git_pushes`, `languages`, `tool_counts`, plus timing arrays. Methodology
undocumented.

**How we implement it here.**
- A `Reconciliation` panel in `src/sections/ForensicsSection.jsx`, which is already the place where
  we admit what a denominator does and does not include (`:129-136`).
- `GET /api/forensics/reconcile` returns, per session present in both sources, our value, theirs,
  and the delta, for the four comparable metrics.
- Sort by absolute relative delta. Show the agreement rate per metric as a headline.
- **We render both numbers. We never replace ours with theirs.** Their methodology is undocumented;
  adopting an unexplained number to fix an explained one is a trade we cannot audit.
- Immediate follow-up this panel will justify: sum whole-file `Write` results into `add` when
  `structuredPatch` is absent. That is a separate change to `server/index.mjs:2352` and should be
  its own commit, driven by what this panel shows.

**Effort.** M (the panel). The `Write` fix it motivates is S.

**Risks and unknowns.**
- Their generation timestamp (8 Jul) predates the end of some sessions, so a delta may be a
  truncation artefact rather than a disagreement. Show each session's `transcript_mtime` from the
  facet file next to ours, so a stale comparison is visible as stale.
- 47 of 1,285 sessions is a 3.7% sample and it is not random — it is whatever the report run
  covered. Do not extrapolate the agreement rate to the corpus; print `n=47` beside it.
- If we later fix the `Write` gap and agreement jumps, the panel's own numbers change. That is the
  point, but it means the panel must never be screenshotted as a stable claim.

**Definition of done.**
- Panel renders only when `probeSessionMeta()` ≥ rung 2 **and** at least one session id matches;
  otherwise one sentence explaining which condition failed.
- Every metric row prints `agrees in k of n sessions` with `n` visible.
- No dashboard number anywhere changes as a result of this feature landing.
- A session in `session-meta` with no transcript is counted in an `unmatched` figure, displayed.

---

### 5. `toolUseResult.gitOperation` — commits and pushes without parsing `git` stdout

**Customer need.** ActivityTimeline (`src/sections/ActivityTimeline.jsx:20-32`) classifies a
`git commit` into the generic `tool` bucket — `▸ Bash · git commit -m …`. A user scrubbing a session
cannot see where work actually landed.

**Value to Loush.** Claude Code already structures this: `toolUseResult.gitOperation.commit.{kind,sha}`,
`.push.branch`, `.branch.{action,ref}`. 24 commits and 23 pushes confirmed in this corpus. Delivery
and Ticket join sessions to shipped work; a commit SHA straight from the transcript is a
first-class join key we are currently regexing out of shell output or not getting at all.

**How it works today (upstream).** `simonw/claude-code-transcripts` does prompts↔commits and the
landscape scan calls that "the entire state of the art" (§Where Loush is differentiated, item 6).
It parses. We don't have to.

**How we implement it here.**
- In `scanTranscripts()` (`server/index.mjs:2352`, same `tur` object already in hand), push
  `{ t, kind: 'commit'|'push'|'branch', sha, branch, ref }` onto a new `rec.gitOps`, capped at 200.
- Surface on the session rollup at `:2402`; expose via the existing session endpoints.
- New `classify()` case in `ActivityTimeline.jsx` for a `gitOp` node: `⑂ commit a1b2c3d` /
  `⑂ push → main`, styled like the existing `STYLE` map at `:9-17`.
- Feed the SHA into the WorkingSet dossier timeline (`server/fe.mjs:529`) so "prompt → diff → error"
  becomes "prompt → diff → error → **commit**", which is the causal chain that panel exists to show.

**Effort.** S.

**Risks and unknowns.**
- `gitOperation.commit.kind` values are unenumerated. Treat as an opaque string; render it, don't
  branch on it.
- 24 occurrences across 1,285 transcripts is thin. Either the field is new, or it only appears for
  commits made through a particular path. **Unverified.** Absence of the field must never be read as
  "no commit happened" — the timeline keeps showing the Bash node too.
- A SHA is repository-scoped. Do not render it as a link anywhere until Delivery knows the remote.

**Definition of done.**
- A session containing a `gitOperation.commit` renders a distinct timeline node with the short SHA.
- A session whose commits came only through plain `Bash` renders exactly as it does today.
- The dossier timeline shows commit nodes interleaved by timestamp with edits and errors.
- No panel claims a commit count as a total — the number is labelled `commits recorded by the
  harness`, with the caveat in the tooltip.

---

### 6. `toolUseResult.toolStats` — the free per-subagent rollup

**Customer need.** Anyone looking at a `Task`/`Agent` node in ActivityTimeline or Forensics and
wanting to know what the subagent actually did. Today, `ActivityTimeline.jsx:28-30` renders the
subagent's children if the caller passed them, and nothing else.

**Value to Loush.** `toolUseResult.toolStats.{bashCount, editFileCount, readCount, searchCount,
otherToolCount, linesAdded, linesRemoved}` plus `toolUseResult.{totalDurationMs, totalTokens,
totalToolUseCount, agentType, resolvedModel, status}` — 238 occurrences confirmed here. This is a
complete per-subagent cost-and-work summary we currently reconstruct, imperfectly, by walking the
subagent transcript file. `_SYNTHESIS.md:311` already wants subagent-internal tool calls (Tier 1.10);
this is the same data arriving for free.

**How we implement it here.**
- Same `tur` branch in `scanTranscripts()`: when `tur.agentId && tur.toolStats`, push a
  `rec.subagents` entry.
- Render as a summary line on the `agent` node in `ActivityTimeline.jsx` — `◆ Explore · 12 reads,
  3 edits, 4.2k tok, 38s` — collapsed above the existing children.
- Cross-check `linesAdded`/`linesRemoved` against our own subagent-transcript derivation in the
  same reconciliation panel as feature 4.

**Effort.** S.

**Risks and unknowns.**
- `toolStats` counts are the harness's, not ours; they may count differently (see feature 4's
  `lines_added` disagreement). Label as `reported by the harness`.
- `status` values unenumerated. Render verbatim.

**Definition of done.**
- An `Agent`/`Task` node with `toolStats` shows the summary line; one without shows the node exactly
  as today, with no zeros invented.
- Every number on the line is attributed to the harness in the tooltip.

---

### 7. Canonical transcript field reference in-repo

Specified in full in §Schema reference plan. **Effort M.** Ordered last because nothing else is
blocked on it, and first in *importance* for anyone who touches a parser after us.

---

## Probe design

This is the section that makes everything above safe to ship against a format Anthropic explicitly
declares internal and changing (landscape scan §Tier 1, quoting the docs: "The entry format is
internal to Claude Code and changes"). No feature reads a store directly; every feature reads it
through this.

### The four rungs

| Rung | Condition | What the UI shows |
|---|---|---|
| **0 — absent** | directory does not exist, or exists with zero candidate files | One sentence: "Claude Code has not written `<store>` on this install." No chart, no table, no `0`. The section keeps rendering everything that does not depend on the store. |
| **1 — present, unvalidated** | directory exists with files, but the shape quorum failed | One sentence naming what failed: "Found 51 files in `usage-data/session-meta` but could not read them: `lines_added` missing from 44 of 12 sampled." **No number from the store is rendered.** A `report` link dumps the validation result for a bug report. |
| **2 — validated, partial** | quorum passed; store covers some but not all of the relevant population | Numbers render **per row/session that has data**, always beside a visible denominator (`41 of 1,285`). Aggregates over the covered subset only, with `n=` printed. Never an aggregate presented as a total. |
| **3 — validated, current** | quorum passed **and** the store's newest entry is not older than the newest transcript | As rung 2, plus the "generated <date>" caveat may be dropped from row-level tooltips. It stays in the panel masthead regardless. |

On this machine today: `session-meta` = rung 2, `facets` = rung 2, `file-history` = rung 2. **None
reaches rung 3.** A store at rung 3 should be treated as the unusual case, not the design target.

### Detection

Presence is `fs.statSync(dir).isDirectory()` plus a non-empty `readdirSync` filtered to the expected
name pattern:

| Store | Directory | Name pattern |
|---|---|---|
| session-meta | `~/.claude/usage-data/session-meta` | `<uuid>.json` |
| facets | `~/.claude/usage-data/facets` | `<uuid>.json` |
| file-history | `~/.claude/file-history` | directory `<uuid>/`, entries `<hex>@v<N>` |

A file whose name does not match the pattern is counted as `skipped`, never parsed. Both `usage-data`
subdirectories sit beside `report.html`, so name discipline matters.

`file-history` is probed for **presence and consistency only**. Its snapshot files are file contents
from the user's repositories. We stat them and we read their names. **We do not read their bytes**
in any feature in this spec.

### Shape validation

Per store, a pure validator over one parsed object:

```
validateSessionMeta(o):
  required: session_id:string, project_path:string, start_time:string,
            lines_added:number, lines_removed:number, files_modified:number,
            tool_errors:number, user_interruptions:number
  optional: duration_minutes, tool_counts:object, languages:object, git_commits,
            git_pushes, input_tokens, output_tokens, tool_error_categories:object,
            uses_*:boolean, message_hours:array, user_message_timestamps:array,
            user_response_times:array, transcript_mtime:number, first_prompt:string
  → { ok, missing[], wrongType[] }

validateFacets(o):
  required: session_id:string, outcome:string, friction_counts:object,
            user_satisfaction_counts:object
  optional: claude_helpfulness, session_type   ← ABSENT IN 2 OF 41; must not be required
  optional: primary_success, goal_categories, brief_summary, friction_detail, underlying_goal

validateFileHistoryRef(o):   // validates a transcript entry, not a file on disk
  required: type ∈ {file-history-snapshot, file-history-delta}
  snapshot form: snapshot.trackedFileBackups:object, each value
                 { backupFileName: string|null, version:number, backupTime:string }
  delta form:    trackingPath:string, backup:{ backupFileName, version, backupTime }
```

**Quorum rule.** Sample up to 12 files, newest first. The store reaches rung 2 only if **≥80% of the
sampled files validate `ok`**. One malformed file does not disable a store; a systematic shape change
does. Sampling newest-first means a mid-corpus format change is caught rather than diluted.

**Optionality is derived from evidence, not from taste.** `claude_helpfulness` is required-looking
and is absent from 2 of 41 files here. Any key we have not seen in 100% of a real sample goes in
`optional`. When in doubt, optional — a false rung-1 hides a working store.

### Freshness

Rung 3 requires `max(store file mtime) >= max(transcript mtime) - 24h`. On this machine the store is
21 days behind, which is why `usage-data` is pinned at rung 2 and why every panel built on it carries
its generation date. Freshness is computed at probe time and returned as `generatedAt` and
`staleByMs`, both `null` when unknown.

### Fallback ladder in practice — WorkingSet

| Rung | `rev` column | Rank | Header |
|---|---|---|---|
| 0 | column hidden entirely | unchanged | unchanged |
| 1 | column hidden; a dim note reads "file-history present but unreadable — rank is unchanged" | unchanged | unchanged |
| 2 | `—` per row without data; integer + `▪` per fully-covered row | unchanged | `+ N of M rows have exact version counts` |
| 3 | as rung 2 | unchanged | as rung 2 |

**The rank is identical at every rung.** That is the whole design: the store can vanish between two
Claude Code releases and the flagship metric does not move. Only the evidence annotation appears and
disappears. A user who never sees rung 2 loses nothing they had.

### Failure containment

- Every probe and every parse is wrapped so a throw returns a rung, never propagates. This matches
  the existing walkers (`server/index.mjs:2331`, `:1874`) but returns a *diagnosis* instead of
  silence.
- A store that fails validation is cached as failed for the memo window, so a broken store does not
  cost 12 file reads per request.
- `GET /api/firstparty/health` is the one place a user can see why something is missing. Link to it
  from every rung-0 and rung-1 empty state.

---

## The rework-rank upgrade

### What is on screen today

`server/fe.mjs:176-193`:

```
REWORK_WEIGHTS = { revisitSession: 3, revisitDay: 2, failure: 2, extraEdit: 1 }
REWORK_MIN_SESSIONS = 2
score = revisitSessions×3 + revisitDays×2 + failures×2 + extraEdits×1
      where revisitSessions = sessionCount − 1
            revisitDays     = days − 1
            failures        = tool errors attributed to this file
            extraEdits      = edits − sessionCount
      and score = null when sessionCount < 2
```

Rendered at `src/sections/WorkingSet.jsx:163` (column tooltip, symbolic) and `:180` (row tooltip,
with the row's actual numbers substituted). Footer at `:218`: **"Rank is a heuristic, not a
measurement — its inputs are in the row and its arithmetic is on the tooltip."**

### What `file-history` actually offers

A per-file, per-session **stored-revision counter**, readable from
`snapshot.trackedFileBackups[path].version` in the transcript. Exact where it exists. Absent for
98% of sessions that had edits, on the corpus I measured.

### What changes

**Nothing in the arithmetic.** Concretely, we do **not**:

- replace `extraEdits` with `exactVersions`. `extraEdits` is defined over every session; versions
  exist for ~2%. Swapping the term would make the rank incomparable between rows — a file with
  tracked versions and a file without would be scored on different scales while sharing a column.
  That is precisely the failure `_SYNTHESIS.md:174-180` documents from context-mode's `ADR-0004`,
  where a displayed saving went 0% → 56% → 95.4% on identical data through formula changes alone.
- add a fifth weighted term for versions. Same objection, plus it would make the tooltip arithmetic
  five terms long and conditionally four, which breaks the legibility the panel is built on.
- reorder rows by version count. Sorting is the rank's job.

**What is added is an evidence tier, per row.** A new `rev` column and a provenance marker:

| Row state | `rev` | Marker | Row tooltip addition |
|---|---|---|---|
| no tracked versions in any of its sessions | `—` | none | "no stored revisions recorded for this file" |
| tracked versions in **every** session that edited it | integer | `▪` | "N stored revisions recorded by Claude Code across n sessions — an exact count, independent of the rank" |
| tracked versions in **some** sessions | integer | none | "N stored revisions, but version data is missing for k of n sessions — treat as a floor" |

### Exact vs. heuristic, stated precisely

- **Exact:** the number of file versions Claude Code stored for this file in the sessions where it
  tracked the file. It is a count of a thing that happened, read from a record of that thing.
- **Still heuristic:** the rank. Every one of its four terms is a proxy chosen by us —
  `sessionCount − 1` is not "times the agent got it wrong", it is our stand-in for that. Version
  counts do not change this, because a version bump is also not "times the agent got it wrong"; it
  is a checkpoint boundary whose exact trigger we have **not verified** (§0, §Open questions).
- **Not exact and must not be implied:** rework. Neither number measures rework. One measures
  revisiting, the other measures snapshotting.

### The tooltip

The column tooltip at `:163` keeps its current text verbatim and gains a second sentence:

> `revisitSessions×3 + revisitDays×2 + failures×2 + extraEdits×1. Null below 2 sessions — one session
> is work, not rework.`
> `The rev column is separate: it is a count of file versions Claude Code stored, not an input to
> this rank.`

The row tooltip at `:180` keeps its substituted arithmetic **unchanged** and appends the row's
provenance sentence from the table above. The arithmetic stays first and stays on one line. If a
future edit makes it wrap, the provenance sentence is what gets cut, not the arithmetic.

### The footer

`:218` currently reads, in bold: *"Rank is a heuristic, not a measurement."* It stays. It gains one
clause:

> **Rank is a heuristic, not a measurement** — its inputs are in the row and its arithmetic is on the
> tooltip. Where Claude Code stored file versions, the `rev` column shows an exact count beside it;
> that count is evidence, not part of the score.

We are not promoting a heuristic. We are showing our evidence next to it. That is the honest version
of the claim in `_SYNTHESIS.md:91-93`, and it is the version that survives a corpus where the store
covers 2 sessions in 1,285.

---

## Schema reference plan

**Do both.** Vendor a distilled reference *and* generate one from our own corpus. They answer
different questions and neither is sufficient.

### Where it lives

```
docs/transcript-schema.md          ← canonical, hand-maintained, the one source of truth
docs/transcript-schema.observed.md ← generated, never hand-edited
scripts/schema-census.mjs          ← the generator
lib/transcript-fields.mjs          ← the constants parsers import
```

`docs/` exists (it currently holds `screenshots/`). `scripts/` exists. No new dependency.

### 1. Vendored reference — `docs/transcript-schema.md`

Distilled from `daaain/claude-code-log` (MIT; landscape scan §Tier 3a: 2,321 lines of Pydantic
models, 1,066 lines of written spec, 72 captured real messages including 44 tool shapes, maintained
daily). We take the **field table and the decoding rules**, not the code — `models.py` is Python and
useless to a Node parser.

Two decoding rules to carry verbatim, both from the landscape scan §Tier 3a:
- **`agentId` is membership, `spawnedAgentId` is causation.** Without both, nested agent→agent
  spawns cannot be linked.
- **User-text sub-classification is by flag and tag, not by type**: `isMeta: true` → slash command;
  `<command-name>` → slash command; `<local-command-stdout>` → command output; `<bash-input>` →
  bash input; `queue-operation` with `operation: "remove"` → user steering.

Per `_SYNTHESIS.md:362-373` (porting hygiene): vendor, do not track upstream; record the source, the
licence and the fetch date in the file header.

### 2. Generated census — `scripts/schema-census.mjs` → `docs/transcript-schema.observed.md`

Walks `~/.claude/projects`, emits **key names and discriminator values only — never message
content**, exactly the constraint the landscape agent operated under. Output:
top-level `type` histogram · envelope field presence · `message.usage.*` paths · `toolUseResult.*`
paths with occurrence counts · `attachment.type` histogram · enum values for `stop_reason`,
`subtype`, `level`, `entrypoint`, `operation`.

Run it manually, commit the output, date the header. Do not run it on server start.

### 3. The 13 top-level `type` values

Independently reproduced on this machine, 2026-07-29, over the 220 most-recently-modified transcripts
(35,807 lines). Same 13 values and same rank order as the landscape scan (§Tier 3b), with counts
within a percent — two independent runs agreeing is the strongest evidence in this document:

| `type` | this run | landscape scan |
|---|---|---|
| `assistant` | 20,149 | 21,010 |
| `user` | 11,636 | 12,155 |
| `attachment` | 1,261 | 1,297 |
| `last-prompt` | 914 | 976 |
| `queue-operation` | 785 | 805 |
| `custom-title` | 471 | 529 |
| `system` | 287 | 305 |
| `mode` | 209 | 209 |
| `pr-link` | 64 | 54 |
| `bridge-session` | 14 | 14 |
| `permission-mode` | 13 | 13 |
| `file-history-snapshot` | 3 | 3 |
| `file-history-delta` | 1 | 1 |

Plus `summary` and `ai-title`, documented by `claude-code-log` and not present in either sample.

The SDK union covers 3 of these (`user | assistant | system`; landscape scan §Tier 2). Our parsers
must therefore treat every unlisted `type` as a skippable structural entry, never an error — the
`PassthroughTranscriptEntry` pattern.

### 4. `lib/transcript-fields.mjs` — constants, not prose

The failure mode a docs file cannot prevent is a parser drifting from the reference. Export the
values parsers must agree on:

```js
export const KNOWN_TOP_LEVEL_TYPES = new Set([...])   // the 13 above + summary + ai-title
export const PATH_KEYS = ['file_path', 'path', 'notebook_path', 'filePath']
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
export const HOOK_ATTACHMENT_PREFIX = 'hook_'
export const ATTACHMENT_TYPES = new Set([...])         // 15 observed values
```

`PATH_KEYS` is currently a local literal at `server/index.mjs:2306`; `EDIT_TOOLS` is duplicated at
`src/sections/ActivityTimeline.jsx:8`. They are the same knowledge in two places and they will drift.
Import both from here.

### Maintenance rule

`docs/transcript-schema.md` gains a table row per field we actually parse, naming the
`path:line` that parses it. A parser change without a doc change is a review comment. Re-run
`schema-census.mjs` after any Claude Code minor upgrade and diff the observed file — that diff is our
early warning that the format moved.

---

## `userModified` — a new quality signal

### The claim, and what the corpus says

The research calls `toolUseResult.userModified` "the human corrected the agent — a quality signal we
have no equivalent for" (`_SYNTHESIS.md:107-108`). The field is real: it is present on **all 2,076**
Edit/Write results in this corpus. It is **`true` zero times.**

So `userModified` is a well-formed signal with no observations. Building a panel on it today would
produce a permanently empty panel — which our honesty rules handle correctly, but which is not worth
a section on its own.

**What does fire is `attachment.type: "edited_text_file"` — 79 occurrences**, carrying `filename` and
a line-numbered `snippet`. That is Claude Code telling the model "this file changed under you, here
is what it looks like now". Semantically that is the human-correction event, delivered by a different
mechanism. I have **not verified** whether it fires only for human edits or also for edits by other
tools/processes — that distinction decides how strong a claim we can make.

### What to build

**A `Corrections` panel in Forensics, fed by both signals, ranked by file.**

*Data (parser, `server/index.mjs:2352` region — same loop, two new branches):*
- `tur.userModified === true` → `{ t, file: tur.filePath, kind: 'userModified' }`
- `j.attachment?.type === 'edited_text_file'` → `{ t, file: attachment.filename, kind: 'externalEdit' }`.
  **Discard `snippet`** — it is repository content and we do not need it to count events.

*Derived metric — "correction rate":*

```
correctionRate(file) = corrections(file) / agentEdits(file)
```

with `agentEdits` the existing `edits` count from `aggregateFiles` (`server/fe.mjs:216-223`), and the
denominator **printed**, per `_SYNTHESIS.md:296` (Tier 0.5) and the `pct()` rule at
`src/sections/InsightsSection.jsx:11-13`. A file with fewer than 3 agent edits gets `null`, not a
rate — the same "one session is work, not rework" logic that gives `reworkScore` its
`REWORK_MIN_SESSIONS` floor.

*Where it goes:*
- **Forensics** — a `Corrections` table: file · agent edits · corrections · rate · last, sitting
  beside the failure-signature table it rhymes with. A tool error is the agent failing loudly; a
  human correction is the agent failing quietly.
- **WorkingSet dossier** (`server/fe.mjs:529`, `buildTimeline`) — a `correction` node kind in the
  prompt → diff → error timeline, styled like the existing `error` kind at
  `src/sections/WorkingSet.jsx:307`. This is the highest-value placement: "the agent edited this,
  then you fixed it by hand" is the causal chain the dossier exists to show, and git cannot see it.
- **Not** in the rank. Same reasoning as §"The rework-rank upgrade" — a term that exists for a
  fraction of rows cannot enter a score shared by all rows. Revisit only if corrections turn out to
  be near-universal, which this corpus says they are not.

*Two signals, two labels.* `userModified` and `externalEdit` are counted separately and displayed
separately. They are not summed into one "corrections" number until we know they mean the same
thing. The panel's column header says `corrections (2 sources)` with a tooltip splitting them.

**Effort.** S/M — the parser branches are trivial; the honest denominator handling and the dossier
timeline node are the work.

**Risks and unknowns.**
- `userModified` may only be set on a code path that this corpus never exercises — an IDE
  integration, a particular Edit variant. **Unverified.** The panel must be as informative when the
  count is 0 as when it is 50.
- `edited_text_file` may fire for edits by a formatter, a build step, or another agent. Attributing
  it to "the human" would be a claim we cannot support. **The UI must say "changed outside the
  agent", not "you corrected it"**, until this is settled.
- 79 attachments across 1,285 transcripts is thin. Print `n` everywhere.

**Definition of done.**
- With zero corrections in the window, the panel renders: "No out-of-agent edits recorded in the last
  N days across M sessions with edits." Not `0%`, not a green tick, not a hidden panel.
- `userModified` and `externalEdit` counts are shown separately, each with its own denominator.
- A file with fewer than 3 agent edits shows `—` for rate, never a percentage.
- The dossier timeline interleaves correction nodes chronologically with edits and errors.
- No `snippet` content from an `edited_text_file` attachment is stored, returned by any endpoint, or
  written to any cache.
- The word "you" does not appear in any label describing an `externalEdit`.

---

## Not worth taking

- **Reading `file-history` snapshot bytes.** They are repository file contents. We already have
  per-edit diffs from `structuredPatch` with better coverage (2,076 events vs 12 snapshot files), and
  reading them would put user source into a cache and an API response for no metric we don't already
  have. Stat the names, never open the files.
- **Replacing `extraEdits` (or any rank term) with the version count.** §"The rework-rank upgrade"
  gives the argument: incomparable scales across rows, and the exact failure mode
  `_SYNTHESIS.md:174-180` records from context-mode's ADR-0004.
- **Adopting `session_meta.lines_added` as our displayed line count.** It disagrees with our
  derivation in 33 of 47 comparable sessions and its methodology is undocumented. Use it as an
  oracle (feature 4), never as a source. The right fix is our own `Write`-without-`structuredPatch`
  gap.
- **Triggering the report generation that populates `usage-data/`.** It is an undocumented internal
  command, the facets are LLM-derived so it likely costs tokens, and invoking harness internals to
  refresh our own dashboard's inputs is exactly the kind of coupling that breaks on the next release.
  Read what is there; do not create it.
- **Watching `usage-data/` for changes.** It changed once, 21 days ago. A watcher would idle forever.
  Probe on request, memoize, print the date.
- **A `goal_categories` taxonomy chart.** ~60 distinct keys across 41 files, most occurring once
  (`fix_seed_import`, `verify_no_work_lost`, `configure_auto_update`). It is free-form text in a
  dictionary's clothing. `session_type` and `primary_success` are the closed vocabularies; chart
  those.
- **Trending facet grades over time.** LLM-derived, single generation, unknown prompt. A trend line
  across one generation date is a line through one point.
- **A restore/rewind feature on top of `file-history`.** That is `/rewind`, it already exists, and
  `_SYNTHESIS.md:245-264` (Cluster E) has a better-argued design for diff approval that does not
  depend on an undocumented store.
- **`~/.claude/sessions/<pid>.json` for live state, in this spec.** It is real and useful
  (landscape scan §Tier 3c) but it belongs to the live-session work in `_SYNTHESIS.md:188-202`
  (Cluster A), not here. Noting it so it is not lost.

---

## Open questions for the maintainer

1. **What actually triggers a `file-history` version bump?** Per Edit call, per user turn, or per
   checkpoint boundary? Until this is answered the `rev` column is labelled `stored revisions` and
   nothing infers "the agent rewrote this N times" from it. Testable in an afternoon: run a session
   that edits one file five times and count versions.
2. **Does checkpointing skip files git can restore?** Every tracked file I found is either outside a
   repo or a root-level config. If the hypothesis holds, `file-history` is structurally empty for
   the repo-scoped source files WorkingSet ranks, and feature 2's ceiling is near zero. Testable
   with one session editing a tracked source file in a clean repo.
3. **What regenerates `usage-data/`?** It correlates exactly with `report-2026-07-08-235809.html`.
   If it is a user-invoked report command, feature 3's masthead should tell the user how to refresh
   it. If it is automatic on some cadence we haven't hit, the freshness rung logic needs a different
   threshold.
4. **Is `usage-data/` present on macOS and Linux installs?** Everything here is one Windows 11
   machine. Before feature 3 or 4 ships, confirm the paths on at least one other platform — the
   probe handles absence correctly, but a store that only exists on Windows changes whether these
   features are worth documenting.
5. **What sets `userModified: true`?** Zero occurrences in 2,076 opportunities. Either the code path
   is rare or the field is vestigial. If vestigial, feature "userModified" reduces to the
   `edited_text_file` half and should be renamed.
6. **Does `edited_text_file` distinguish a human edit from a formatter or another process?** This
   decides whether the Corrections panel can say "you changed it" or must say "it changed outside the
   agent". We ship the weaker claim until this is answered.
7. **Do subagent transcripts carry `file-history-snapshot` entries under their own session id?** Our
   walker treats the file basename as the session id (`server/index.mjs:2310`), which would make a
   subagent's tracked files look like a separate session to `file-history/<sessionId>`. Unverified.
8. **Do we want `agentacct`'s `exact` / `high` / `medium` / `low` confidence vocabulary** instead of
   this spec's binary `measured` / `inferred`? `_SYNTHESIS.md`'s landscape read (§Where Loush is
   differentiated, item 7) recommends adopting their vocabulary rather than claiming the idea. Four
   tiers is a bigger UI commitment and touches more than these features; worth deciding once, before
   feature 2 sets a precedent in the flagship panel.
9. **`gitOperation` appears 24 times in 1,285 transcripts.** Is the field new, or does it only appear
   for commits made through a specific path? Feature 5's usefulness scales directly with the answer.
10. **The 400-edit / 500-file caps** at `server/index.mjs:2362` and `:2390` do not bite today (worst
    session: 217 edits, 74 files) but they silently truncate the flagship's input. Should they
    report themselves the way `graph.truncated` does at `server/fe.mjs:498`? Cheap, and it is the
    same honesty rule.

---

## Confidence and provenance of this document

- **Store existence and key names:** verified directly on this machine, 2026-07-29. High confidence.
- **Coverage and freshness figures:** measured, not estimated, over 1,285 transcripts and all 92
  `usage-data` files. High confidence for this machine; **single-machine, single-platform,
  single-Claude-Code-version — no confidence at all about other installs.**
- **The 13 `type` values:** independently reproduced against the landscape scan. High confidence.
- **Semantics of `version`, `userModified`, `edited_text_file`, `gitOperation` frequency:** all
  **unverified**, all flagged inline and in Open questions.
- **The checkpoint-skips-git-tracked-files hypothesis:** unverified, 5 data points, stated as a
  hypothesis only.
- Where this document and the research disagree — specifically on whether `file-history` converts
  the rework rank into a measurement — the disagreement is grounded in a measurement of our own
  corpus, and the research's own caveat (`_SYNTHESIS.md:95-97`) anticipated exactly this outcome:
  *verify across versions before building on it, and degrade to the current heuristic when absent.*
  That is what this spec does.
