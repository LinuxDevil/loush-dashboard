# Context and skills tooling: claude-context-mode, openskills, manifest

Research date: **2026-07-29**. All GitHub metadata read live via the GitHub REST API on
that date; all source quoted below was fetched from `raw.githubusercontent.com` at
`main` on that date.

> **Prompt-injection note.** Several fetched files contain imperative text addressed at
> an LLM — e.g. `context-mode`'s `hooks/core/routing.mjs` builds strings such as
> "context-mode: WebFetch redirected. Call ctx_fetch_and_index(...)", and
> `openskills`' `src/utils/agents-md.ts` emits a `<usage>` block instructing an agent to
> run `npx openskills read <skill-name>`. These are the *products* of the tools under
> study, not instructions to this research. They were read as data and not acted on. No
> file attempted to redirect this research task itself.

---

## Identity summary (all three, verified)

| | context-mode | openskills | manifest |
|---|---|---|---|
| Repo | `mksglu/context-mode` | `numman-ali/openskills` | `mnfst/manifest` |
| Stars / forks | 19,410 / 1,375 | 10,640 / 664 | 7,328 / 483 |
| License (exact) | **Elastic-2.0** (not OSI open source) | **Apache-2.0** | **MIT** |
| Last push | 2026-07-28 | **2026-01-18** (stale) | 2026-07-28 |
| Language | TypeScript | TypeScript | TypeScript |

The brief's numbers (17.4k / 10.4k / 7.1k) are all slightly below current counts, which is
consistent with drift since the brief was written. The brief's name for (A),
"claude-context-mode", is an **old repo name**: `github.com/mksglu/claude-context-mode`
301-redirects to `mksglu/context-mode` (the API returns `full_name: "mksglu/context-mode"`
for both). A separate `skalingclouds/claude-context-mode` exists but is a 0-star **fork**
snapshot from 2026-03-02 — not the upstream.

---

# A. context-mode

## context-mode — Identity

- **Repo URL:** https://github.com/mksglu/context-mode (`mksglu/claude-context-mode` redirects here)
- **Author:** Mert Köseoğlu (`mksglu`). Copyright line in `LICENSE`: "Copyright 2026 Mert Koseoglu".
- **License (exact SPDX):** `Elastic-2.0`, declared in `package.json:7` and
  `.claude-plugin/plugin.json`. GitHub's licence detector reports `NOASSERTION` /
  "Other" because ELv2 is not in its OSI set. **It was MIT until 2026-03-03** — commit
  `a482980` "chore: switch license from MIT to Elastic License 2.0 (ELv2)". This matters
  for us: see *Gaps*.
- **Stars / forks / watchers / open issues:** 19,410 / 1,375 / 88 / 117
- **Contributors:** **~112** (API pagination reports 112 pages at 1-per-page)
- **Created:** 2026-02-23. **Last commit:** 2026-07-28 (`06276b9`, "ci: update install stats").
- **Activity:** ≥100 commits in the last 90 days (API page cap hit). Very active. Note
  that a large share of recent HEAD commits are automated `ci: update install stats`.
- **Version:** `1.0.169` (`package.json`)
- **Install:** `/plugin marketplace add mksglu/context-mode` then
  `/plugin install context-mode@context-mode`; or `npm install -g context-mode`; or
  `claude mcp add context-mode -- npx -y context-mode`.
- **Platforms:** 17 claimed. Adapters exist on disk under `src/adapters/` for: claude-code,
  codex, copilot-cli, vscode-copilot, jetbrains-copilot, cursor, gemini-cli, kimi, kiro,
  omp, openclaw, opencode, pi, qwen-code, zed, antigravity, antigravity-cli.
- **Runtime:** Node ≥ 22.5. Deps: `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`,
  `turndown`, `@clack/prompts`, `picocolors`.
- **Could NOT verify:** npm download counts; the "install stats" the CI job writes;
  whether the 17 adapters all actually work (the repo's own issue list has platform-specific
  breakage — #901 Windows, #873 OMP, #993 PowerShell). The `context-mode.com` landing page
  was not fetched.

## context-mode — The problem it solves

From `README.md` (§ The Problem): every MCP tool call dumps raw bytes into the context
window — a Playwright snapshot ~56 KB, twenty GitHub issues ~59 KB, an access log ~45 KB —
and when the harness compacts, the model loses its working state (which files it was
editing, which tasks are open, what the last user instruction was).

Four claimed remedies:
1. **Context saving** — run tool work in a sandboxed subprocess; only `stdout` enters context.
2. **Session continuity** — capture every tool call / edit / error / user decision into
   per-project SQLite; rebuild working state on compaction or `--continue`.
3. **"Think in code"** — the model writes a script that computes the answer instead of
   reading N files into context.
4. **No prose-style enforcement** — explicitly refuses to add brevity prompts, citing
   evidence that aggressive brevity degrades coding benchmarks.

## context-mode — Value proposition (with skepticism)

**The headline: "315 KB becomes 5.4 KB. 98% reduction."** There are actually *two different*
98% numbers in this project, computed by two different mechanisms, and both are weaker than
they look.

### Skepticism 1 — the benchmark measures hand-written summarisers, not a compressor

`tests/ecosystem-benchmark.ts` (26,538 bytes) is the real source of the 315 KB → 5.5 KB
figure. The measurement is exactly this (lines 449–467):

```ts
const rawContent  = readFileSync(filePath, "utf-8");
const rawBytes    = Buffer.byteLength(rawContent, "utf-8");
const result      = await executor.executeFile({ path: filePath, language: scenario.language, code: scenario.code });
const contextBytes = Buffer.byteLength(result.stdout, "utf-8");
const savings      = ((1 - contextBytes / rawBytes) * 100).toFixed(0);
```

The critical variable is `scenario.code`. It is **a human-authored JavaScript summariser
written specifically for that one fixture**, embedded in the scenario literal. Example, the
React-docs scenario (lines 62–70):

```ts
code: `
  const lines = FILE_CONTENT.split("\n");
  const codeBlocks = FILE_CONTENT.match(/```[\s\S]*?```/g) || [];
  ...
  console.log("Lines:", lines.length, "| Sections:", sections.length, "| Code blocks:", codeBlocks.length);
`
```

So the benchmark answers: *"if an expert writes a bespoke script that prints four integers
about this exact file, how much smaller is the output than the file?"* The answer is
trivially ~98%. It does not measure:
- what an LLM would write unprompted for an unseen file,
- the input tokens the model spends *writing* the script,
- the tokens spent on the redirect message that pushed it toward the sandbox,
- whether the four integers were sufficient to answer the user's question.

The nginx access-log row is the tell: **45.1 KB → 155 B, "100%" saved.** 155 bytes cannot
answer an arbitrary question about 500 log lines. This is lossy summarisation reported as
"savings".

### Skepticism 2 — the honest half of the benchmark is buried

`BENCHMARK.md` itself contains the counter-evidence, and the README drops it. Two parts:

| Part | Mechanism | Raw | Context | Savings |
|---|---|---|---|---|
| Part 1 `ctx_execute_file` (lossy summary) | summarise | 315 KB | 5.5 KB | **98%** |
| Part 2 `ctx_index` + `ctx_search` (lossless, exact chunks) | retrieve | 60.3 KB | 11.0 KB | **82%** |
| **Whole file's own overall row** | | **376 KB** | **16.5 KB** | **96%** |

The project's own doc says, verbatim in the file's Overview table, "Overall context savings
**96%**". The README markets the 98% subtotal. And Part 2's per-row range goes down to
**44%** (Supabase Edge Functions) and Part 1 has a **13%** row (Playwright network requests).
`BENCHMARK.md` is admirably candid about *why*: 
`ctx_execute_file` on React docs returns "5 code blocks, 3 sections about cleanup" which it
calls "useless for coding". The 98% path is the path that destroys the information.

### Skepticism 3 — the *runtime* percentage is built on hardcoded constants

The number a user actually sees in `ctx_stats` is computed from a SQLite column
`session_events.bytes_avoided` (`src/session/db.ts:838`). Where does `bytes_avoided` come
from? `hooks/core/routing.mjs` — three sites only:

| Site | Value | Comment in source |
|---|---|---|
| curl/wget in a Bash command (line 779) | `bytesAvoided: 8192` | "8192 byte default — typical curl/wget HTTP body the agent would have spilled" |
| `WebFetch` deny (line 886) | `bytesAvoided: 16384` | "16384 = typical web page body bytes prevented" |
| `Read` of a file > 50,000 bytes (line 859) | `bytesAvoided: st.size` | actual file size |

Two of the three are **fabricated constants**. The third (`st.size`) counts the *whole file*
even though Claude Code's `Read` truncates by default, so the counterfactual is overstated
there too. And `hooks/pretooluse.mjs:204` comments that this is an "estimated `bytes_avoided`"
emitted before the tool ever runs.

The displayed percentage (ADR-0004, ratified 2026-05-24) is:

```
Without = bytesAvoided + bytesReturned
With    = max(1, bytesReturned)
pct     = (1 - With / Without) * 100
```

`bytesReturned` is real (printed `ctx_*` output). `bytesAvoided` is largely invented. A
ratio whose numerator is measured and whose denominator is a constant times a counter will
always look excellent. Note also what is *not* subtracted: the redirect reason strings
themselves — each ~400–700 bytes of prose — do enter the context window and are not counted.

### Skepticism 4 — the maintainers already conceded the metric drifted, twice

`docs/adr/0004-stats-strict-compression-formula.md` is a remarkably honest document that
admits the displayed percentage was wrong for months. Direct evidence from its own table:

| Metric | v1.0.147 | v1.0.148 + old formula | v1.0.148 + ADR-0004 |
|---|---|---|---|
| % kept out | 0% (identity) | 56% | **95.4%** |

The same number was 0%, then 56%, then 95.4% across three releases *on identical user data*,
purely from formula changes. The ADR also records that on the reporter's machine
`eventDataBytes` was 2,136 KB of which **84% was 496 duplicate copies of the same CLAUDE.md**
captured by SessionStart hooks across resume cycles, and that the schema has a `data_hash`
dedup column that "is populated but unused by the formula."

### Skepticism 5 — users report the displayed number is internally contradictory

Open issue **#950** (2026-07-11, v1.0.169, `ctx doctor` all-OK) reports a single `ctx_stats`
render containing a part-greater-than-whole impossibility: "This chat: 2.7 MB kept out" vs
"All your work: 868 KB kept out ... across 19 projects". Same render also shows 1.9 MB and
2.7 MB for the same conversation, and reports "100.0% kept out" for a session in which the
reporter used only native Bash/Read/Edit and never called `ctx_execute`.

Open issue **#894**: the statusline "is permanently stuck on the hardcoded
`context-mode ● saves ~98% of context window` placeholder" because the published `1.0.168`
tarball shipped without `build/` and the renderer swallows the import error. **Verified
directly in source** — `bin/statusline.mjs` contains that exact literal at lines 240, 254,
331 and 375, with `_analytics = null` on the catch path at line 59. The reporter's phrasing
is the right one: *"A plausible-but-fake number shown forever is worse than an honest
'stats unavailable'."*

Open issue **#874**: on the OMP adapter, `bytes_avoided` is **always 0**.

**Verdict.** The *mechanism* (keep bytes out of the window by executing in a subprocess and
indexing into FTS5) is real and sound. The *98% number* is not a measurement; it is a
marketing figure derived from bespoke summarisers on cherry-picked fixtures, backed at
runtime by hardcoded 8 KB/16 KB constants, and it is hardcoded outright in the statusline.
Anything we build should measure the thing context-mode does not: **actual per-turn prompt
size from the transcript.**

### Also: "How to Reproduce" is partly stale

`BENCHMARK.md` § How to Reproduce lists `npm run test:store`, `npm run test:all`, and
`npx tsx tests/live-benchmark.ts`. **None of those three exist**: `package.json` `scripts`
has `test`, `test:watch`, `benchmark`, `test:use-cases`, `test:compare`, `test:ecosystem`;
and the tree has no `tests/live-benchmark.ts`. The fixtures themselves *do* exist
(`tests/fixtures/access.log` 46,216 B, `analytics.csv` 87,517 B, `github-issues.json`
60,310 B, `playwright-snapshot.txt` 57,521 B, …) and `tests/ecosystem-benchmark.ts` exists,
so `npm run test:ecosystem` is the one command that actually reproduces Part 1. 268 test
files under `tests/` — the test suite is genuinely large.

## context-mode — Feature inventory

| Feature | What it does | Where in the code | Depends on |
|---|---|---|---|
| 11 MCP tools | `ctx_execute`, `ctx_execute_file`, `ctx_index`, `ctx_search`, `ctx_fetch_and_index`, `ctx_batch_execute`, `ctx_stats`, `ctx_doctor`, `ctx_upgrade`, `ctx_purge`, `ctx_insight` — verified by counting `registerTool("…")` calls | `src/server.ts` (225,865 B) | `@modelcontextprotocol/sdk` |
| Polyglot sandbox | Spawns an isolated subprocess per call; only stdout returns. 12 runtimes (JS, TS, Python, Shell, Ruby, Go, Rust, PHP, Perl, R, Elixir, C#); Bun auto-detected | `src/executor.ts` (32,513 B), `src/runtime.ts` (28,226 B) | host runtimes on PATH |
| FTS5 knowledge base | Chunk markdown by heading (code blocks kept intact) → SQLite FTS5 virtual table; BM25 + Porter stemming; titles weighted 5× | `src/store.ts` (73,885 B), `src/store-directory.ts` | `better-sqlite3` / `node:sqlite` / `bun:sqlite` |
| RRF hybrid search | Two parallel FTS5 strategies (porter tokenizer + trigram tokenizer) merged by Reciprocal Rank Fusion; then proximity rerank; then Levenshtein fuzzy correction | `src/search/unified.ts`, `src/search/ctx-search-schema.ts` | FTS5 |
| Auto-externalisation | Output > 100 KB is indexed and replaced by a pointer message ("Indexed N sections … Use ctx_search(…)") | `src/truncate.ts`, `src/store.ts` | FTS5 |
| Session capture | Every tool call, edit, git op, error, user decision persisted to per-project SQLite | `src/session/db.ts` (67,346 B), `src/session/extract.ts` (109,384 B), `hooks/posttooluse.mjs` | harness hooks |
| Compaction survival | `PreCompact` builds a priority-filtered snapshot; `SessionStart` rehydrates it | `src/session/snapshot.ts`, `hooks/precompact.mjs`, `hooks/sessionstart.mjs` | `session_resume` table |
| Routing enforcement | `PreToolUse` intercepts Bash/Read/Grep/WebFetch/Agent and rewrites or denies with a redirect message | `hooks/core/routing.mjs` (45,621 B) | `PreToolUse` support in host |
| Progressive throttling | calls 1–3 full results; 4–8 halved + warning; 9+ blocked and redirected to `ctx_batch_execute` | `src/search/flood-guard.ts` | — |
| Cost analytics | Per-model pricing table → dollar figure for "tokens you didn't burn" | `src/session/pricing.ts`, `src/session/model-prices.json` (13,294 B) | — |
| Statusline | Renders savings into the harness statusline (currently broken, see #894) | `bin/statusline.mjs` (14,443 B) | `build/session/analytics.js` |
| Project attribution | Best-effort mapping of an event to a project dir with a 0..1 confidence | `src/session/project-attribution.ts` | — |
| 17 adapters | Per-harness config writer + hook shims | `src/adapters/*`, `configs/*`, `hooks/<platform>/*` | per-harness config format |
| Self-heal / doctor | Rebuilds `better-sqlite3`, repairs partial installs, verifies bundle integrity | `scripts/heal-better-sqlite3.mjs`, `hooks/heal-partial-install.mjs` (27,606 B), `scripts/plugin-cache-integrity.mjs` | — |

## context-mode — Schema / format

### The measurement methodology (this is the portable part)

**1. Benchmark-time formula** (`tests/ecosystem-benchmark.ts:449-467`):

```
rawBytes     = byteLength(fixture file)
contextBytes = byteLength(stdout of a per-fixture summariser script)
savings%     = (1 - contextBytes / rawBytes) * 100
```

**2. Runtime formula** (ADR-0004, implemented around `src/session/analytics.ts:2173-2217`):

```
if (bytesAvoided + bytesReturned == 0)
    emit "No measurable redirect activity captured yet"        // no bar
else
    Without = bytesAvoided + bytesReturned
    With    = max(1, bytesReturned)
    pct     = (1 - With / Without) * 100
    mult    = round(WithoutTokens / WithTokens)
```

**3. Token estimate:** bytes / 4 (`src/session/analytics.ts:1385`,
`totalSavedTokens = (eventDataBytes + bytesAvoided + snapshotBytes) / 4`). A flat divisor,
not a tokenizer.

**4. What each term means (per ADR-0004):**
- `bytesAvoided` — bytes context-mode claims it kept out. **Estimated**, see the constants table above.
- `bytesReturned` — bytes of `ctx_*` output actually printed into context. Real.
- `eventDataBytes` — bytes the hooks wrote into SessionDB. **Explicitly excluded from the
  Section-1 ratio** by ADR-0004, because "they are analytics infrastructure, not bytes that
  ever entered the model's context window." Still included in lifetime totals — which is why
  the lifetime and per-chat numbers disagree (issue #950).
- `snapshotBytes` — bytes of resume snapshots.

**Design lesson for us:** the honest ratio requires a real counterfactual. context-mode has
none, so it invented one. We have a real one — the transcript's own `usage` block.

### SessionDB schema (`src/session/db.ts:827-877`) — directly reusable idea

```sql
CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 2,
  data TEXT NOT NULL,
  project_dir TEXT NOT NULL DEFAULT '',
  attribution_source TEXT NOT NULL DEFAULT 'unknown',
  attribution_confidence REAL NOT NULL DEFAULT 0,
  bytes_avoided INTEGER NOT NULL DEFAULT 0,
  bytes_returned INTEGER NOT NULL DEFAULT 0,
  source_hook TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  data_hash TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS session_meta (
  session_id TEXT PRIMARY KEY, project_dir TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')), last_event_at TEXT,
  event_count INTEGER NOT NULL DEFAULT 0, compact_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS session_resume (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL UNIQUE,
  snapshot TEXT NOT NULL, event_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), consumed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tool_calls (
  session_id TEXT NOT NULL, tool TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0,
  bytes_returned INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, tool)
);
```

`tool_calls(session_id, tool, calls, bytes_returned)` is the single most useful shape here:
**per-tool byte attribution per session**. We can compute exactly that from JSONL with no
hooks and no estimation.

### Event priority ladder (`src/types.ts`)

```ts
export const EventPriority = { LOW: 1, NORMAL: 2, HIGH: 3, CRITICAL: 4 } as const;
```
Used to decide what survives into a resume snapshot when the budget is tight.

### Redirect metadata contract (`hooks/core/routing.mjs` → `hooks/pretooluse.mjs:212`)

PreToolUse cannot safely load native SQLite, so it passes a marker string to PostToolUse:

```
tool:type:bytesAvoided:commandSummary
```

with `type` ∈ {`bash-redirected`, `read-redirected`, `webfetch-redirected`, …}.

### Tool-description template (ADR-0002, mandatory for all 11 `ctx_*` tools)

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

ADR-0002 is backed by "38 A/B trials across 6 empirical probes on Haiku and Sonnet". Two
findings worth stealing for our own capability copy: forbidding language (`MANDATORY:`,
`NEVER`, `blocked`) measurably degrades tool selection on some models — on Opus 4.6 the word
"blocked" caused capitulation 6/6 times vs 0/6 for "redirected" — while ✅/❌ emoji bullets
"tokenize inconsistently across Llama / Gemini families".

### Plugin manifest (`.claude-plugin/plugin.json`)

```json
{
  "name": "context-mode", "version": "1.0.169",
  "license": "Elastic-2.0",
  "mcpServers": { "context-mode": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/start.mjs"] } },
  "skills": "./skills/"
}
```

### Hook registration (`hooks/hooks.json`)

Six lifecycle points: `PreToolUse` (matchers: `Bash`, `WebFetch`, `Read`, `Grep`, `Agent`,
three `mcp__…ctx_*` matchers, and a catch-all `mcp__`), `PostToolUse` (one long alternation
matcher covering `Bash|Read|Write|Edit|NotebookEdit|Glob|Grep|TodoWrite|TaskCreate|TaskUpdate|EnterPlanMode|ExitPlanMode|Skill|Agent|AskUserQuestion|EnterWorktree|mcp__`),
`UserPromptSubmit`, `SessionStart`, `Stop`, `PreCompact`. All invoke
`node "${CLAUDE_PLUGIN_ROOT}/hooks/<name>.mjs"`.

## context-mode — Architecture

```
harness (Claude Code / Codex / Cursor / …)
   │
   ├─ hooks/*.mjs ──────────────► SessionDB (~/.context-mode, SQLite, WAL)
   │    PreToolUse   → routing.mjs: rewrite/deny Bash·Read·Grep·WebFetch·Agent
   │    PostToolUse  → capture event rows + bytes_avoided marker
   │    UserPromptSubmit / Stop → capture decisions & turn ends
   │    PreCompact   → snapshot.ts builds priority-filtered snapshot
   │    SessionStart → rehydrate snapshot into new conversation
   │
   └─ MCP stdio ────► src/server.ts (11 ctx_* tools)
                          ├─ executor.ts   → subprocess per call, stdout only
                          └─ store.ts      → FTS5 (porter + trigram) + RRF + BM25
                                             ~/.context-mode/content/, 14-day GC
```

Notable engineering decisions:
- **Multi-writer SQLite** (ADR-0001): several hook processes and the MCP server write the
  same DB concurrently; WAL + `busy_timeout`, no `EXCLUSIVE` pragma.
- **Bundled hooks**: `hooks/*.bundle.mjs` are esbuild bundles of `src/session/extract.ts`,
  `snapshot.ts`, `db.ts`, `security.ts` — so a hook can run without a node_modules resolve.
  `scripts/assert-bundle.mjs` and `assert-asymmetric-drift.mjs` gate the build against bundle
  drift.
- **Adapter pattern**: `src/adapters/base.ts` + `types.ts` (21,800 B) define the contract;
  `src/adapters/detect.ts` (29,651 B) sniffs which harness is running. Each adapter writes
  that harness's own config dialect (`configs/<platform>/…`).
- **Fail-open**: README §357 states that on an older global binary "the hooks are inert
  (no routing/capture) but they do **not** block your tools".

## context-mode — Gaps and weaknesses

1. **Licence: Elastic-2.0, not open source.** ELv2 forbids providing the software to third
   parties as a managed service and forbids circumventing licence-key functionality. It is
   *not* OSI-approved and is not compatible with a permissively-licensed codebase. Several
   third-party blog posts and aggregator pages still describe it as "MIT" (it was, until
   2026-03-03). **The brief says we have the authors' permission to copy code; that permission
   should be obtained in writing and should name ELv2 explicitly, because a verbal
   "go ahead" does not relicense the file headers.** Safest path: reimplement the *ideas*
   and the *schemas* (facts and formats are not copyrightable), do not paste the code.
2. **The headline metric is unmeasured.** Detailed above. Open issues #950, #894, #893, #874
   are all users saying the numbers don't add up. #893 is closed; #950 and #894 are open as
   of the research date.
3. **Hardcoded fallback string.** `bin/statusline.mjs` renders `saves ~98% of context window`
   at four call sites whenever analytics fail to load. A number the user believes is measured
   is in fact a constant.
4. **Enormous single files.** `src/server.ts` 225,865 B; `src/session/analytics.ts` 129,384 B;
   `src/session/extract.ts` 109,384 B; `src/cli.ts` 89,212 B. Hard to lift a subsystem out.
5. **Context tax not netted out.** The plugin injects an always-on routing block
   (`configs/claude-code/CLAUDE.md`, 4,748 B), a 16,683 B main `SKILL.md`, seven `ctx_*`
   skill files (9,303 B combined), and 11 MCP tool descriptions (≥6,465 B measured across
   the 7 template-literal blocks I could match; the true total is higher). None of that is
   subtracted from "savings". On a small task this fixed tax could exceed the saving.
6. **Aggressive interception.** It denies `WebFetch` outright and rewrites `Bash` commands.
   Issues #911 and #946 report that its injected framing trips Claude Code's own auto-mode
   classifier and gets *other* plugins' subagent dispatches blocked.
7. **Platform breakage.** #901 (Windows dual install trees), #993 (PowerShell hook missing
   `&`), #873 (OMP install misses routing instructions), #874 (OMP `bytes_avoided` always 0).
8. **Data lifecycle is aggressive.** README: "If you don't `--continue`, previous session
   data is deleted immediately". Content DBs older than 14 days are removed at startup.

---

# B. openskills

## openskills — Identity

- **Repo URL:** https://github.com/numman-ali/openskills
- **Author:** Numman Ali (`numman-ali`). `LICENSE` copyright line: "Copyright 2025 OpenSkills Contributors".
- **License (exact SPDX):** `Apache-2.0` — declared in `package.json:"license"`. GitHub
  reports `NOASSERTION` only because `LICENSE` is the 638-byte **short-form Apache notice**,
  not the full 11 KB text, so the detector can't fingerprint it. The intent is unambiguous.
- **Stars / forks / watchers / open issues:** 10,640 / 664 / 57 / 43
- **Contributors:** **2** (verified via `contributors?per_page=100`) — effectively a single-maintainer project.
- **Created:** 2025-10-26. **Last commit:** 2026-01-18 (`57d933a`, "chore: added claude md").
- **Activity: dormant.** **Zero commits in the last 90 days** (API, since 2026-04-29). Latest
  release `v1.5.0`, 2026-01-17. Open issue **#94** (2026-07-23) is literally titled
  "[QUESTION] Is this project still actively maintained?" and had no replies at research time.
- **Install:** `npm i -g openskills`, or `npx openskills …`, or Homebrew (`brew install openskills`,
  formula exists per search results — formula page not fetched).
- **Platforms:** any agent that reads `AGENTS.md`. Named: Claude Code, Cursor, Windsurf,
  Aider, Codex. Node ≥ 20.6.0.
- **Size:** 204 KB repo, 18 source files under `src/`, 9 test files.
- **Could NOT verify:** npm weekly downloads; the Homebrew formula contents; whether the
  maintainer intends to return.
- **Name collision:** there is an unrelated `Geeksfino/openskills` (Rust runtime for Claude
  Skills). The 10.4k-star one in the brief is `numman-ali/openskills`.

## openskills — The problem it solves

Anthropic's Agent Skills are files (`SKILL.md` + `references/` + `scripts/` + `assets/`), but
only Claude Code knows how to discover them, surface their metadata, and load them on demand.
openskills decouples the format from the harness: it installs skills into a known directory
and writes an equivalent `<available_skills>` block into `AGENTS.md`, so *any* agent that
reads `AGENTS.md` gets the same progressive-disclosure behaviour, invoking
`npx openskills read <name>` where Claude Code would call the `Skill` tool.

## openskills — Value proposition (with skepticism)

The claim is modest and largely true: same format, same folder layout, universal loader.
Caveats:

1. **"Progressive disclosure" is only half-real without a Skill tool.** In Claude Code the
   harness decides when to load. Here, the *model* must decide to shell out to
   `npx openskills read`. Nothing enforces it, nothing measures whether it happened, and the
   `<usage>` block's rule "Do not invoke a skill that is already loaded in your context" is a
   request, not a mechanism. Agents that don't reliably run shell commands get nothing.
2. **The "~1 KB for 20 skills vs ~500 KB" figure** cited in third-party writeups (DeepWiki)
   is not in the repo and not benchmarked there. Treat as illustrative. The real number is
   `sum(len(description)) + boilerplate` — the `<usage>` boilerplate in
   `generateSkillsXml` is itself ~700 bytes fixed.
3. **The frontmatter parser is naive.** `src/utils/yaml.ts` is 402 bytes:
   ```ts
   export function extractYamlField(content: string, field: string): string {
     const match = content.match(new RegExp(`^${field}:\\s*(.+?)$`, 'm'));
     return match ? match[1].trim() : '';
   }
   export function hasValidFrontmatter(content: string): boolean {
     return content.trim().startsWith('---');
   }
   ```
   It is **not scoped to the frontmatter block** (the `m` flag matches anywhere in the file),
   does not handle folded/block scalars (`description: >`), quoted values, or a `description`
   line inside a fenced code block in the body. Our `parseFM` in `server/index.mjs:140` uses
   `/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/` and is strictly better. Do **not** port this file.
4. **No `skill.json`, no versioning, no integrity check.** Open issue #81 asks for
   `skill.json`. Install is `git clone` + `cpSync`. There is no lockfile, no checksum, no
   semver. Competing tools (`skillpm`, `antfu/skills-npm`, `vercel-labs/skills`,
   AgentSkills CLI) exist precisely to add npm semantics — this space is fragmenting and
   openskills has stopped moving.
5. **Known unresolved defects:** #84 `--universal` installs to `.agent/` while the docs
   elsewhere say `.agents/`; #92 duplicate skill discovery when a repo contains example or
   mirrored `SKILL.md` files; #87 path-resolution/sandbox conflict for global installs on macOS.

## openskills — Feature inventory

| Feature | What it does | Where in the code | Depends on |
|---|---|---|---|
| `install <source>` | Clone/copy skills from GitHub `owner/repo`, any git URL, or a local path; interactive multi-select; warns on Anthropic-marketplace name collisions; path-traversal guard | `src/commands/install.ts` (17,914 B) | `git` on PATH, `@inquirer/prompts` |
| Source-type detection | `isLocalPath` (`/`, `./`, `../`, `~/`), `isGitUrl` (`git@`, `git://`, `http(s)://`, `.git`), else `owner/repo` | `src/commands/install.ts:23-45` | — |
| Path-traversal guard | `isPathInside(targetPath, targetDir)` resolves both and requires prefix match with separator | `src/commands/install.ts:68-77` | — |
| Provenance record | Writes `.openskills.json` into each installed skill dir | `src/utils/skill-metadata.ts` | — |
| `sync` | Regenerates the `<skills_system>` block in `AGENTS.md` (or `-o <path>`); pre-selects current state | `src/commands/sync.ts`, `src/utils/agents-md.ts` | — |
| `list` | Enumerates skills across 4 search dirs, deduped by name, first-wins | `src/commands/list.ts`, `src/utils/skills.ts` | — |
| `read <names...>` | Prints `Reading: <name>`, `Base directory: <abs path>`, then the whole `SKILL.md` to stdout. Comma-separated names supported | `src/commands/read.ts` | — |
| `update [names...]` | Re-pulls from the recorded source in `.openskills.json` | `src/commands/update.ts` (6,845 B) | `git` |
| `manage` / `remove` | Interactive / scripted removal | `src/commands/manage.ts`, `remove.ts` | — |
| Symlink-aware discovery | `isDirectoryOrSymlinkToDirectory` follows symlinks so local dev checkouts can be linked in | `src/utils/skills.ts:12-28` | — |
| Marketplace conflict list | Hardcoded list of 15 Anthropic marketplace skill names to warn about | `src/utils/marketplace-skills.ts` | — |

## openskills — Schema / format

### 1. `SKILL.md` — the file format (Anthropic's, reproduced exactly)

```markdown
---
name: skill-name           # Required: hyphen-case identifier
description: When to use   # Required: 1-2 sentences, third-person
---

# Skill body

Instructions in imperative/infinitive form.
```

Only `name` and `description` are read by openskills (`src/types.ts` also declares an
optional `context?: string` on `SkillMetadata`, unused by the loader).

Directory layout (`examples/my-first-skill/references/skill-format.md`):

```
my-skill/
├── SKILL.md              # required, "Under 5,000 words"
├── references/           # loaded into context selectively
├── scripts/              # executable, "can be run without loading to context"
└── assets/               # used in output, "not loaded to context"
```

Three-level progressive disclosure, as documented in that reference file:
1. **Metadata** — `name` + `description`, always in context
2. **SKILL.md** — loaded when relevant
3. **Resources** — `references/`, `scripts/`, `assets/`, loaded as needed

### 2. Resolution order (`src/utils/dirs.ts`) — 4 directories, first match wins

```
1. ./.agent/skills/     (project, universal)
2. ~/.agent/skills/     (global,  universal)
3. ./.claude/skills/    (project, claude)
4. ~/.claude/skills/    (global,  claude)
```

`findAllSkills()` dedupes by directory name across all four; `location` is reported as
`'project'` if `dir.includes(process.cwd())`, else `'global'`.

### 3. `.openskills.json` — per-skill provenance sidecar (`src/utils/skill-metadata.ts`)

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

**This is the single most portable artifact in the project.** It is the missing provenance
field in every skill directory on disk: *where did this skill come from and when*.

### 4. The `AGENTS.md` injection block (`src/utils/agents-md.ts:23-62`) — verbatim template

```xml
<skills_system priority="1">

## Available Skills

<!-- SKILLS_TABLE_START -->
<usage>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills:
- Invoke: `npx openskills read <skill-name>` (run in your shell)
  - For multiple: `npx openskills read skill-one,skill-two`
- The skill content will load with detailed instructions on how to complete the task
- Base directory provided in output for resolving bundled resources (references/, scripts/, assets/)

Usage notes:
- Only use skills listed in <available_skills> below
- Do not invoke a skill that is already loaded in your context
- Each skill invocation is stateless
</usage>

<available_skills>

<skill>
<name>pdf</name>
<description>…</description>
<location>project</location>
</skill>

</available_skills>
<!-- SKILLS_TABLE_END -->

</skills_system>
```

Idempotent rewrite strategy (`replaceSkillsSection`): try `<skills_system…>…</skills_system>`;
else the `<!-- SKILLS_TABLE_START -->…<!-- SKILLS_TABLE_END -->` HTML-comment pair; else
append to end of file. Reverse parse (`parseCurrentSkills`) uses
`/<skill>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/skill>/g`.

### 5. TypeScript surface (`src/types.ts`, 397 bytes — the whole domain model)

```ts
export interface Skill { name: string; description: string; location: 'project' | 'global'; path: string; }
export interface SkillLocation { path: string; baseDir: string; source: string; }
export interface InstallOptions { global?: boolean; universal?: boolean; yes?: boolean; }
export interface SkillMetadata { name: string; description: string; context?: string; }
```

### 6. `read` output contract (what an agent sees)

```
Reading: <name>
Base directory: <absolute path to skill dir>

<entire SKILL.md verbatim>

Skill read: <name>
```

Note there is **no description/body split and no truncation** — `read` dumps the whole file.
The "under 5,000 words" guidance is the only thing keeping this cheap, and nothing enforces it.

## openskills — Architecture

Deliberately tiny: a commander-based CLI (`src/cli.ts`, 7 subcommands), pure-`fs` discovery,
`git` shelled out via `execSync`, zero daemon, zero MCP, zero network beyond `git clone`.
Built with `tsup` to `dist/cli.js`; tested with vitest (9 test files, incl.
`tests/integration/e2e.test.ts`). Total production source ≈ 40 KB.

The FAQ states the design thesis plainly: MCP is for dynamic tools, skills are static
instructions plus resources, so no server is required.

Curiosity worth noting: `.github/maintainer/` contains an LLM-maintained state directory
(`config.json`, `state.json`, `decisions.md`, `patterns.md`, `standing-rules.md`,
`index/graph.json`, `index/items.json`, per-issue and per-PR notes). The repo is itself an
experiment in agent-run maintenance — which may explain why activity stopped abruptly.

## openskills — Gaps and weaknesses

1. **Dormant.** No commits since 2026-01-18. Unanswered "is this maintained?" issue.
2. **Naive frontmatter parsing** (see above). Ours is better; don't port `yaml.ts`.
3. **No integrity, versioning, or lockfile.** `git clone` + copy. #81 (read `skill.json`) open.
4. **Enforcement is advisory.** The loader cannot know whether the agent actually ran
   `openskills read`, nor whether a skill fired. No telemetry by design — which is
   philosophically aligned with us, but it means there is no usage signal at all.
5. **Directory naming inconsistency** (#84: `.agent/` vs `.agents/`).
6. **`location` heuristic is fragile:** `dir.includes(process.cwd())` misclassifies when the
   home directory is a prefix of cwd or on case-differing Windows paths.
7. **Discovery collides with real repos** (#92): repos containing `examples/**/SKILL.md`
   produce phantom skills.
8. **Fragmented competition.** `skillpm`, `antfu/skills-npm`, `vercel-labs/skills`,
   AgentSkills CLI, `Geeksfino/openskills` all target the same gap. Betting our parser on
   openskills-specific conventions would be unwise; betting on **`SKILL.md` + the 4-dir
   resolution order + `.openskills.json`** is safe because those are the de-facto commons.

---

# C. manifest

## manifest — Identity

- **Repo URL:** https://github.com/mnfst/manifest
- **Author/org:** MNFST, Inc (`mnfst`). `LICENSE`: "Copyright (c) 2026 MNFST, Inc".
- **License (exact SPDX):** `MIT` — clean, GitHub-detected, no ambiguity. The most
  permissively licensed of the three.
- **Stars / forks / watchers / open issues:** 7,328 / 483 / 26 / 104
- **Contributors:** **44** (verified via `contributors?per_page=100`)
- **Created:** 2022-09-27 — **the repo predates the current product by ~3 years.** Commits
  from 2022-12 reference `publish(caseClient)`; this repo was previously the "Manifest"
  backend-as-a-service (`manifest.build`). It has since **pivoted** to an LLM gateway. Old
  blog posts and star history refer to the previous product.
- **Last commit:** 2026-07-28 (`fa15665`). Very active — ≥100 commits in the last 90 days.
- **Latest release:** `manifest@6.17.1`, 2026-07-28. Changesets-based release train.
- **Status badge:** `beta`.
- **Repo size:** 211,935 KB (211 MB) — a full monorepo with frontend assets.
- **Install:** Docker only. `bash <(curl -sSL https://raw.githubusercontent.com/mnfst/manifest/main/docker/install.sh)`,
  then `http://localhost:2099`; first account created becomes admin. One-click deploys for
  Railway, Render, DigitalOcean, AWS (CloudFormation), GCP (Cloud Run). README states:
  "The old npm-based self-hosting path is no longer supported."
- **Platforms:** anything speaking OpenAI-compatible HTTP. Cloud version at `app.manifest.build`.
- **Stack:** TypeScript monorepo (turbo) — `packages/backend` (NestJS + TypeORM +
  **PostgreSQL**), `packages/frontend`, `packages/shared`, `packages/manifest`.
- **Could NOT verify:** Docker Hub pull counts; the "300+ models / 32 providers / 18
  subscription flows" catalogue (README says catalogues are "discovered dynamically when
  credentials are connected", so the table is explicitly "representative, not exhaustive");
  the hosted service's terms.

## manifest — The problem it solves

An agent or coding harness is normally pinned to one provider and one model. Manifest
inserts an OpenAI-compatible gateway in front of *all* your credentials — API keys,
consumer subscriptions (ChatGPT Plus, Claude Max, Copilot, GLM Coding Plan, …), and local
models (Ollama, LM Studio, llama.cpp) — behind a single endpoint. Send `"model": "auto"` and
Manifest scores the request and routes it to the cheapest model that can handle it, with
fallback chains, full request/response logging, per-dollar cost tracking, limits and
notifications, and an "autofix" path that repairs malformed requests before retrying.

## manifest — Value proposition (with skepticism)

**Important correction to the brief's framing.** The brief describes manifest as connecting
agents and harnesses "through one manifest". **There is no manifest file.** "Manifest" is the
product name. Routing configuration lives in **PostgreSQL tables**, edited through a web
dashboard, and exposed over a REST API — not in a declarative YAML/JSON document you can put
in a repo. If the hope was "a config-model we can display or edit as a file", that hope does
not survive contact with the code. What *is* portable is the **relational schema** and the
**scoring config**, both reproduced below.

Other skepticism:
- **"Cut costs 70–90%"** appears in third-party reviews, not the README, and is
  unsubstantiated in-repo. One of the project's own issues (#1589, a growth/positioning
  issue) shows the team is actively working the marketing angle vs OpenRouter.
- **Routing quality is keyword-based, not semantic.** `packages/backend/src/scoring/config.ts`
  is a weighted bag-of-keywords plus structural heuristics with a sigmoid. It runs in <2 ms
  (per third-party review), which is the point — but "the cheapest model that can handle it"
  is decided by trie matching on words like `"prove"`/`"refactor"`, not by understanding.
  There is a `confidenceThreshold: 0.45` gate, so low-confidence requests presumably fall
  back to a default tier — good design, but it means the headline savings depend entirely on
  how often the classifier is confident *and* right.
- **Subscription routing is legally interesting.** Routing a ChatGPT Plus / Claude Max /
  Copilot *consumer subscription* through a gateway for programmatic use is very likely
  contrary to those providers' terms. The repo ships `docs/providers/subscription-based-providers.md`
  and 18 such flows. Not our problem to solve, but not something we should mirror or endorse
  in a dashboard UI.
- **Beta, and a pivoted repo.** Star count and repo age partly reflect the previous
  backend-framework product. Judge the gateway on its 2026 commit history, not on 7.3k stars.
- **PostgreSQL + Docker is a heavy dependency** relative to our local-first, zero-telemetry,
  read-only posture.

## manifest — Feature inventory

| Feature | What it does | Where in the code | Depends on |
|---|---|---|---|
| OpenAI-compatible endpoint | Single `/v1/chat/completions` (+ `/v1/messages`) in front of every provider; `model: "auto"` triggers routing | `packages/backend/src/routing/proxy/*` | NestJS |
| Complexity routing | Score request → tier ∈ `simple\|standard\|complex\|reasoning`; per-agent toggle `complexity_routing_enabled` | `packages/backend/src/scoring/index.ts`, `config.ts` | keyword trie |
| 32-dimension scorer | 22 keyword dimensions + 10 structural dimensions, weighted, with `direction: 'up' \| 'down'` | `packages/backend/src/scoring/config.ts` (3,568 B) | `keyword-trie.ts` |
| Structural dimensions | tokenCount, nestedListDepth, conditionalLogic, codeToProse, constraintDensity, expectedOutputLength, repetitionRequests, toolCount, conversationDepth | `packages/backend/src/scoring/dimensions/structural-dimensions.ts` | — |
| Momentum | Carries prior-turn tier forward so a conversation doesn't flap between tiers | `packages/backend/src/scoring/momentum.ts` | — |
| Sigmoid + confidence | `computeConfidence`, `scoreToTier`; `confidenceK: 8`, `confidenceMidpoint: 0.15`, `confidenceThreshold: 0.45` | `packages/backend/src/scoring/sigmoid.ts`, `config.ts` | — |
| Specificity routing | Independent axis: 9 task categories, each separately routable | `packages/shared/src/specificity.ts`, `scoring/specificity-detector.ts` | — |
| Tier assignments | Per-agent, per-tier: override route, auto-assigned route, fallback chain, output modality, response mode | `packages/backend/src/entities/tier-assignment.entity.ts` | PostgreSQL |
| Header tiers | Route by inbound HTTP header value | `packages/backend/src/routing/header-tiers/header-tier.service.ts` (12,812 B) | — |
| Fallback chains | `fallback_routes: ModelRoute[]` per tier / per specificity | same entities | — |
| Autofix ("Phoenix") | On a request-side 4xx, send to a healing service, resend the patched request once *before* the fallback chain | `packages/backend/src/routing/autofix/*`, `docs/autofix-self-healing-poc.md` (21,206 B) | external healing svc |
| Custom providers | Any OpenAI- or Anthropic-shaped endpoint, with per-model pricing and context window | `packages/backend/src/entities/custom-provider.entity.ts` | — |
| MPS param catalogue | Declarative JSON describing which request params are valid for a given provider/auth/model, with conditional applicability | `docs/model-parameters-schema.md`, `packages/shared/src/provider-params-spec.ts` (17,006 B) | `modelparams` npm pkg |
| Cost tracking | Per-request dollar accounting, notification rules, limits | `packages/backend/src/entities/request.entity.ts`, `notifications/services/notification-rules.service.ts` | — |
| Full body logs | Success and error bodies retained | `packages/backend/src/entities/agent-message.entity.ts` (8,919 B) | — |
| Error taxonomy | Normalised cross-provider error classification | `packages/shared/src/error-taxonomy.ts` (12,581 B) | — |
| Playground | Side-by-side multi-model comparison runs | `packages/backend/src/entities/playground-run.entity.ts`, `playground-column.entity.ts` | — |
| Caller classification | Identify which agent/harness made the call | `packages/backend/src/routing/proxy/caller-classifier.ts` | — |

## manifest — Schema / format

### 1. `ModelRoute` — the atomic routing unit (`packages/shared/src/model-route.ts`)

```ts
export interface ModelRoute {
  provider: string;      // "anthropic", "openai", …
  authType: AuthType;    // "api_key" | subscription | local …
  model: string;         // "claude-haiku-4-5-20251001"
  keyLabel?: string | null;  // which credential, when several exist
}
```

Equality is case-insensitive on `provider`, and normalises `keyLabel` (trim + lowercase,
empty → null). There is a documented lossless bidirectional mapping to a legacy
`(model, provider, authType)` triple via `legacyToRoute` / `routeToLegacy`.

### 2. Tiers (`packages/shared/src/tiers.ts`)

```ts
export const TIERS = ['simple', 'standard', 'complex', 'reasoning'] as const;
export const DEFAULT_TIER_SLOT = 'default';
export const TIER_SLOTS = [...TIERS, 'default'] as const;
// message-level superset, NOT for the scoring/routing layer:
export const ALL_TIERS = [...TIERS, 'direct', 'playground'] as const;
```

With shipped user-facing descriptions:

| Tier | Description (verbatim from `TIER_DESCRIPTIONS`) |
|---|---|
| simple | Heartbeats, greetings, and low-cost tasks that any model can handle. |
| standard | General-purpose requests that need a good balance of quality and cost. |
| complex | Tasks requiring high quality, nuance, or multi-step reasoning. |
| reasoning | Advanced reasoning, planning, and critical decision-making. |
| default | Handles every request when complexity routing is off; final fallback otherwise. |

### 3. Specificity categories (`packages/shared/src/specificity.ts`)

```ts
export const SPECIFICITY_CATEGORIES = [
  'coding', 'web_browsing', 'data_analysis', 'image_generation', 'video_generation',
  'social_media', 'email_management', 'calendar_management', 'trading',
] as const;
```

### 4. Agent taxonomy (`packages/shared/src/agent-type.ts`)

```ts
export const AGENT_CATEGORIES = ['personal', 'app', 'coding'] as const;
export const AGENT_PLATFORMS = [
  'openclaw','hermes','nanobot','craft','claude-code','opencode',
  'openai-sdk','anthropic-sdk','vercel-ai-sdk','langchain','curl','other',
] as const;
export const PLATFORMS_BY_CATEGORY = {
  personal: ['openclaw','hermes','nanobot','craft','other'],
  app:      ['openai-sdk','anthropic-sdk','vercel-ai-sdk','langchain','other'],
  coding:   ['claude-code','opencode','other'],
};
```

### 5. The routing configuration model (relational, not a file)

```
agents                        (id, name, tenant_id, agent_category, agent_platform,
                               is_active, complexity_routing_enabled, autofix_enabled, is_playground)
  │
  ├─ tier_assignments         UNIQUE(agent_id, tier)
  │     tier                  varchar   ∈ simple|standard|complex|reasoning|default
  │     override_route        jsonb     ModelRoute | null      ← user's explicit pin
  │     auto_assigned_route   jsonb     ModelRoute | null      ← what Manifest chose
  │     fallback_routes       jsonb     ModelRoute[] | null
  │     output_modality       varchar   default 'text'
  │     response_mode         varchar   default 'buffered'
  │
  ├─ specificity_assignments  UNIQUE(agent_id, category)
  │     category              varchar   ∈ the 9 SPECIFICITY_CATEGORIES
  │     is_active             boolean
  │     override_route / auto_assigned_route / fallback_routes / output_modality / response_mode
  │
  ├─ agent_enabled_providers  (agent_id, tenant_provider_id)   ← composite PK, join table
  ├─ agent_model_params       per-agent request-parameter values (validated against MPS)
  └─ agent_api_key            1:1
```

The `override_route` / `auto_assigned_route` split is the interesting bit: the system records
both what it would have chosen and what the human pinned, so a UI can show divergence.

### 6. Custom provider schema (`packages/backend/src/entities/custom-provider.entity.ts`)

```ts
export type CustomProviderApiKind = 'openai' | 'anthropic';
export interface CustomProviderModel {
  model_name: string;
  input_price_per_million_tokens?: number;
  output_price_per_million_tokens?: number;
  context_window?: number;
  price_estimated?: boolean;
}
// entity columns: id, tenant_id, created_by_user_id, name, base_url,
//                 api_kind (default 'openai'), models: CustomProviderModel[], created_at
```

### 7. MPS — Model Parameters Schema (`docs/model-parameters-schema.md`) — **the most portable artifact**

A declarative catalogue describing which request parameters are configurable for a given
`(provider, authType, model)` tuple, including conditional availability:

```json
{
  "provider": "anthropic",
  "authType": "api_key",
  "model": "claude-haiku-4-5-20251001",
  "params": [
    {
      "path": "top_p",
      "type": "number",
      "label": "Top P",
      "description": "Controls nucleus sampling by limiting generation to tokens whose cumulative probability reaches this value.",
      "default": 1,
      "range": { "min": 0, "max": 1, "step": 0.01 },
      "group": "sampling",
      "applicability": {
        "except": [{ "thinking.type": ["adaptive", "enabled"] }, { "temperature": { "not": 1 } }]
      }
    }
  ]
}
```

Documented rules, verbatim in spirit:
- `provider`/`authType`/`model` identify exactly one model route
- `path` is a **dot path** into stored params and outbound request params
- `type` is a *semantic data type, not a UI control kind*
- `values` only for finite choices; `range` for numeric bounds + optional step
- `group` is a semantic grouping for ordering and display
- `applicability` optional; omitted means always available
- explicitly forbidden: ad-hoc `conflictsWith`, `disabledWhen`, `ui`, or provider-specific
  metadata — availability must be expressed through `applicability`

Validator: `isParamApplicability` in `packages/shared/src/provider-params-spec.ts`. The doc
mandates that any schema change update the doc, the shared types, the validator, and the
tests together.

### 8. Complexity scorer config (`packages/backend/src/scoring/config.ts`) — fully reproduced weights

Keyword dimensions (`direction` shown where `down`):

| Dimension | Weight | Dir |
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
| webBrowsing, dataAnalysis, imageGeneration, videoGeneration, socialMedia, emailManagement, calendarManagement, trading | **0** | up (specificity detection only, no complexity weight) |

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

Tier ordering used for `maxTier` merging: `simple 0 < standard 1 < complex 2 < reasoning 3`.

## manifest — Architecture

```
agent / harness (Claude Code, OpenClaw, Hermes, SDK, curl)
        │  OpenAI-compatible HTTP,  model: "auto" | explicit
        ▼
  ┌──────────────────────── Manifest (Docker, :2099) ────────────────────────┐
  │ proxy/ caller-classifier → scoring/ (trie + structural + momentum        │
  │                            + sigmoid → tier, confidence, specificity)    │
  │        │                                                                 │
  │        ├─► tier_assignments / specificity_assignments / header_tiers      │
  │        │      → ModelRoute (provider, authType, model, keyLabel)          │
  │        │      → fallback_routes[]                                         │
  │        ├─► autofix (Phoenix): 4xx → heal request → single resend          │
  │        ├─► agent_model_params validated against MPS catalogue             │
  │        └─► request / agent_message rows: full bodies, tokens, $, tier     │
  │                                    PostgreSQL + NestJS + TypeORM          │
  │ frontend/ (dashboard, playground, cost charts)                            │
  └──────────────────────────────────────────────────────────────────────────┘
        │
        ▼  32 built-in provider connections + custom OpenAI/Anthropic endpoints
```

Deployment: Docker image `manifestdotbuild/manifest`; one-click templates for Railway,
Render, DigitalOcean, AWS CloudFormation, GCP Cloud Run; Heroku/Fly/Coolify/Easypanel/Koyeb
guides. Release management via changesets (`manifest@6.17.1`). Codecov-instrumented CI.

## manifest — Gaps and weaknesses

1. **No file-based configuration.** The routing model is a Postgres schema behind a web UI.
   Not GitOps-able, not versionable in a repo, not something we can read off disk. This is
   the single biggest mismatch with the brief's expectation.
2. **Heavy runtime.** Docker + PostgreSQL + NestJS monorepo (211 MB repo). Antithetical to
   our "read files, join to repos, ship a Vite app" posture.
3. **Beta.** Self-declared.
4. **Keyword-trie classification.** Cheap and explainable, but brittle across languages and
   phrasing. `simpleIndicators` and `relay` are the only negative-weight dimensions, so the
   scorer is structurally biased toward escalating tiers.
5. **Unsubstantiated savings claims** in the surrounding ecosystem (70–90%), absent from
   the README, absent from the repo as a benchmark.
6. **Subscription passthrough is ToS-risky** for the underlying consumer plans.
7. **Repo history is misleading.** 2022 creation date and a fraction of the stars belong to
   a different product (the Manifest backend framework). Anyone benchmarking "7.1k stars =
   mature LLM gateway" is reading the wrong signal.
8. **Cloud-first gravity.** `app.manifest.build`, a "managed Manifest Credits provider"
   landed 2026-07-28 (`c63d378`), booking-page links in the app. The self-hosted path is
   real and MIT, but the product direction is hosted.

---

## Cross-project comparison

| Axis | context-mode | openskills | manifest |
|---|---|---|---|
| **Layer intercepted** | Tool output (inside the agent loop) | Instruction loading (before the loop) | Model selection (below the loop) |
| **Unit of work** | bytes of tool output | a `SKILL.md` directory | one chat-completions request |
| **Mechanism** | MCP server + 6 harness hooks | CLI + a generated `AGENTS.md` block | HTTP gateway + Postgres |
| **State** | per-project SQLite (`~/.context-mode`) | files on disk + `.openskills.json` | PostgreSQL |
| **Config model** | JSON plugin/hook manifests per harness | markdown + YAML frontmatter | relational tables + MPS JSON |
| **Licence** | Elastic-2.0 (source-available) | Apache-2.0 | MIT |
| **Telemetry** | local only (README: "No data is sent to external services") | none | full request logs, local to your instance; cloud version is hosted |
| **Health** | very active, noisy metrics | dormant | very active, beta |

**Where they genuinely overlap:**

- **context-mode ∩ openskills — skills as a context-cost object.** Both treat `SKILL.md` as a
  first-class unit. context-mode *ships* eight skills (`skills/context-mode/SKILL.md` is
  16,683 B with 36 KB of `references/`) and simultaneously *benchmarks* skill prompts as a
  context problem (BENCHMARK.md Part 2 row: "Skill references (4 files), 33.2 KB → 2,412 B").
  So context-mode's answer to "skills are big" is *index them into FTS5 and search*, while
  openskills' answer is *keep descriptions in `AGENTS.md` and load the body on demand*. These
  are the two competing progressive-disclosure strategies, and both projects are effectively
  arguing about the same 30 KB.
- **context-mode ∩ manifest — multi-harness adapters and cost accounting.** Both maintain a
  hand-curated list of harnesses (context-mode's 17 `src/adapters/*`; manifest's
  `AGENT_PLATFORMS`), and both convert tokens to dollars from a bundled price table
  (`src/session/model-prices.json` vs manifest's per-provider pricing and
  `CustomProviderModel.input_price_per_million_tokens`). Both also target OpenClaw and Pi
  explicitly. Neither reads the other's data.
- **openskills ∩ manifest — thin shared surface.** Only the `AGENTS.md` convention: manifest
  ships an `AGENTS.md`/`CLAUDE.md` for its own repo, openskills writes into yours.
- **All three** assume the harness config layer (`~/.claude/`, `AGENTS.md`, MCP JSON) is the
  integration point. **None of them read Claude Code's `~/.claude/projects/**/*.jsonl`
  transcripts** — which is exactly our differentiator and, notably, the only source of
  *measured* context occupancy anywhere in this comparison.

---

## Overlap with Loush Dashboard

| Their feature | Our equivalent section (or NONE) | Who does it better | Note |
|---|---|---|---|
| context-mode: per-turn context occupancy | **ContextExplorer** (`src/sections/ContextExplorerSection.jsx`, `server/index.mjs:3070-3081` `/api/context/*`) | **Us, decisively** | We read `e.in + e.cc + e.cr` from the transcript's own usage block — the actual prompt size the model saw. context-mode estimates with 8 KB/16 KB constants and has four open issues about the result being wrong. |
| context-mode: `ctx_stats` savings % | **NONE** | Neither yet | Their formula is unsound. We could compute an honest one (see Recommended adoptions #1). |
| context-mode: `tool_calls(session_id, tool, calls, bytes_returned)` | **Partial** — `/api/harness`, session ledger at `server/index.mjs:668` tracks per-file $/token/span | **Them, on shape** | Per-tool byte attribution is a table we don't have and can build from JSONL exactly, no hooks. |
| context-mode: session-event capture + resume snapshots | **SessionsSection**, **ActivityTimeline**, **ForensicsSection** | **Us for read, them for write** | They need six hooks to record what Claude Code already writes to JSONL. We just read it. Their `EventPriority` ladder (1–4) is a good idea for our timeline filters. |
| context-mode: routing enforcement (deny WebFetch, rewrite Bash) | **NONE** (we are read-only by design) | **Them** (it's their product) | We should *not* adopt this. Zero telemetry ≠ zero interference, but read-only is our thesis. Note their #911/#946: interception breaks other plugins. |
| context-mode: FTS5 + BM25 + RRF knowledge base | **NONE**; **LibrarySection** is the closest | **Them** | Real engineering. Not obviously needed by a dashboard. |
| context-mode: 17-harness adapter matrix | **HarnessSection** (`src/sections/HarnessSection.jsx`, 466 lines; `/api/harness`) | **Them on breadth, us on honesty** | Their `configs/<platform>/` tree is a free map of where every harness keeps its config. Worth mining for Harness/Setup detection. |
| context-mode: ADR-0002 tool-description template + A/B evidence | **PromptQuality**, **PromptStudio** | **Them** | Their empirical finding (forbidding language degrades tool selection; emoji bullets tokenize badly) is directly usable as a lint rule. |
| context-mode: cost from token counts | **UsagePanel**, **InsightsSection**, `/api/roi` | **Us** | We already do this from real usage blocks; theirs is bytes/4. |
| openskills: `SKILL.md` frontmatter parsing | **CapabilityLedger** (`server/index.mjs:1493-1502` `hubListSkills`, `parseFM` at `:140`) | **Us** | Our `parseFM` is a correct delimited-block parser; their `extractYamlField` is an unscoped `^field:` regex. Do not port it. |
| openskills: 4-directory resolution order + first-wins dedup | **Partial** — we scan `~/.claude/skills` and `<project>/.claude/skills` (`server/index.mjs:150-151, 1540`) | **Them** | We miss `./.agent/skills` and `~/.agent/skills` entirely. Cheap fix, real coverage gain. |
| openskills: `.openskills.json` provenance sidecar | **NONE** | **Them** | We show what a skill costs but not where it came from. Reading this file (when present) is ~10 lines. |
| openskills: `<available_skills>` XML block in `AGENTS.md` | **NONE** | **Them** | If a project uses openskills, the always-on context contributed by skills lives in `AGENTS.md`, and our `alwaysOn` budget (`server/index.mjs:1589`) does not see it. Real blind spot. |
| openskills: `install` / `update` / `remove` lifecycle | **CustomizeSection** toggle (`server/index.mjs:362-455`, rename to `.off`) | **Them for install, us for disable** | Ours is reversible and backed up; theirs is real package management. Different jobs. |
| openskills: progressive-disclosure 3-level model | **CapabilityLedger** `alwaysOnTokens` vs `fullTokens` / `onInvoke` | **Us** | We already price levels 1 and 2 separately. We don't price level 3 (`references/`, which their spec calls "Unlimited"). Gap. |
| manifest: `ModelRoute` + tier/specificity assignments | **NONE**; **CustomizeSection**/**SetupSection** manage config but not model routing | **Them** | We have no multi-provider concept at all. |
| manifest: MPS parameter catalogue | **SetupSection** (`src/sections/SetupSection.jsx`, 443 lines, `/api/setup/*`) | **Them** | MPS is a better pattern than hand-rolled forms for any per-provider parameter UI we ever build. |
| manifest: 32-dimension complexity scorer | **NONE**; **PromptQuality**, **Insights** are adjacent | **Them** | A deterministic, offline, explainable prompt-complexity score is directly runnable over our JSONL. |
| manifest: cost tracking + limits + notifications | **UsagePanel**, **InsightsSection**, `/api/roi`, `/api/usage` | **Us for retrospective, them for live** | We can't enforce limits (read-only); we can *warn*. |
| manifest: full request/response body logs | **ForensicsSection**, **SessionsSection** | **Us** | We already have the whole transcript, for free, with no proxy. |
| manifest: error taxonomy (`error-taxonomy.ts`, 12,581 B) | **ReliabilitySection**, **BugsSection** | **Them** | A normalised cross-provider error classification is a well-shaped artifact to mirror. |
| manifest: agent/platform taxonomy | **HarnessSection** | **Draw** | Their `AGENT_PLATFORMS` / `PLATFORMS_BY_CATEGORY` is a clean vocabulary; ours is implicit. |
| All three: telemetry | Our thesis: local-first, zero telemetry | **Us** | context-mode is local-only too; manifest cloud is not. Worth stating explicitly in our README comparison. |

---

## Recommended adoptions

Ranked by (value to us) × (confidence it's real) ÷ (effort). Licence note up front: **only
manifest (MIT) and openskills (Apache-2.0) are safe to copy code from.** context-mode is
Elastic-2.0 — take the *schemas, formulas and findings* (facts and formats, freely
describable) and write our own implementation.

### 1. Honest per-session context accounting — "where your window actually went" — **S/M**

**Take:** the *idea* of `tool_calls(session_id, tool, calls, bytes_returned)` and the
`Without / With` bar, but with a real measurement instead of a constant.

**Method:** we already have ground truth. For each session in `~/.claude/projects/**/*.jsonl`:
- per-turn prompt size = `usage.input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
  (already computed in ContextExplorer)
- per-tool cost = `sum(len(tool_result content))` grouped by `tool_use.name`, converted to
  tokens by the same estimator we use elsewhere
- rank tools by bytes returned; show the top offenders per session and across all sessions

**Lands in:** `server/index.mjs` — extend the `/api/context/:sessionId` handler (~line 3081)
to emit a `byTool` aggregate; render in `src/sections/ContextExplorerSection.jsx` as a
stacked band under the existing occupancy chart, and surface the all-sessions rollup in
`src/sections/HarnessSection.jsx`.

**Unlocks:** the single most defensible claim we can make against context-mode — *we measure,
they estimate*. It also directly answers issue #950's complaint. And it tells a user whether
installing something like context-mode would even help them: if their top context consumer is
`Read` of source files, a sandbox won't save them anything.

### 2. `AGENTS.md` / `.agent/skills` blind-spot fix for CapabilityLedger — **S**

**Take (Apache-2.0, safe to copy):** openskills' 4-directory resolution order
(`src/utils/dirs.ts`), its first-wins dedup (`src/utils/skills.ts`), its `.openskills.json`
provenance shape (`src/utils/skill-metadata.ts`), and its `parseCurrentSkills` regex
(`src/utils/agents-md.ts`) for reading `<available_skills>` out of an `AGENTS.md`.

**Lands in:** `server/index.mjs` — extend `KINDS.skills.dirs()` (~line 150) and
`hubListSkills` (~line 1493) to also scan `./.agent/skills` and `~/.agent/skills`; add an
`AGENTS.md` contributor to the always-on budget calculation (~line 1589); add a `source` /
`installedAt` column to `/api/capabilities`. Render in
`src/sections/CapabilityLedger.jsx` (new `COLS` entries) and `src/sections/CustomizeSection.jsx`.

**Unlocks:** correctness. Today a project using openskills has skills we do not see and an
always-on `AGENTS.md` block we do not price — our budget number is simply wrong for those
users. Plus provenance ("installed from `anthropics/skills` on 2025-11-04") turns
CapabilityLedger's DEAD verdict from an accusation into an actionable one.

### 3. Offline prompt-complexity / tier classifier — **M**

**Take (MIT, safe to copy):** manifest's `packages/backend/src/scoring/` — the dimension
list, the weights table reproduced above, `boundaries`, `confidenceK/Midpoint/Threshold`,
the tier vocabulary and descriptions from `packages/shared/src/tiers.ts`, and the 9
specificity categories. Port `keyword-trie.ts` and the structural scorers to plain ESM.

**Lands in:** a new `lib/complexity.mjs` (plain ESM, no deps — fits our stack), consumed by
`server/index.mjs` when building `/api/usage` and `/api/insights`; rendered in
`src/sections/InsightsSection.jsx` and `src/sections/PromptQuality.jsx`.

**Unlocks:** "you paid Opus rates for 340 `simple`-tier turns last month" — a concrete,
explainable, entirely local cost insight computed from transcripts we already parse. Every
dimension is inspectable, so the UI can show *why* a turn scored the way it did. This is the
highest-value idea in the whole survey and it is MIT-licensed.

### 4. Skill/agent description linter using ADR-0002's empirical findings — **S**

**Take:** the *findings*, not the code — forbidding vocabulary (`MANDATORY`, `NEVER`,
`Do NOT`, `blocked`, `NON-NEGOTIABLE`) degrades tool selection on some models; "blocked" →
"redirected" flipped Opus 4.6 capitulation from 6/6 to 0/6; ✅/❌ emoji bullets tokenize
inconsistently across Llama/Gemini families; the five-part
`headline / WHEN / WHEN NOT / RETURNS / EXAMPLE` description template.

**Lands in:** `server/index.mjs` `scoreItem(fm, body, kind)` (~line 560) and
`specificityOf` (~line 581) — add rules; surface in `src/sections/CapabilityLedger.jsx` and
`src/sections/PromptQuality.jsx`.

**Unlocks:** our capability scoring currently measures frontmatter completeness. This makes
it measure something with A/B evidence behind it.

### 5. MPS-style declarative parameter catalogue for Setup/Customize — **M**

**Take (MIT):** the MPS JSON shape from `docs/model-parameters-schema.md` and the
`isParamApplicability` validator semantics from `packages/shared/src/provider-params-spec.ts` —
specifically the discipline that `type` is a *semantic data type, not a UI control kind*, and
that conditional availability goes through one `applicability` field rather than ad-hoc
`disabledWhen`/`conflictsWith`/`ui` keys.

**Lands in:** `src/sections/SetupSection.jsx` (443 lines of hand-rolled form today) and
`server/setup.mjs`; a catalogue file under `lib/`.

**Unlocks:** every future settings surface becomes data instead of JSX. Immediately useful
for `src/sections/McpSection.jsx` (per-server env/args) and `CustomizeSection`.

### 6. Harness config-location map — **S**

**Take:** context-mode's `configs/<platform>/` tree and `docs/platform-support.md` (56,264 B)
as a *reference document* for where 17 different harnesses keep their config, hooks and MCP
registration. Read it, don't copy it (ELv2).

**Lands in:** `src/sections/HarnessSection.jsx` + `/api/harness` detection in
`server/index.mjs:1431`; and `src/sections/SetupSection.jsx`.

**Unlocks:** detecting and displaying non-Claude-Code harnesses on the same machine without
doing the discovery research ourselves.

### 7. Cross-provider error taxonomy — **M**

**Take (MIT):** `packages/shared/src/error-taxonomy.ts` (12,581 B) — a normalised
classification of provider errors.

**Lands in:** `src/sections/ReliabilitySection.jsx` and `src/sections/BugsSection.jsx`, fed by
error entries already present in the JSONL.

**Unlocks:** "37% of your failed turns were rate limits, not bugs" — grouping that currently
requires eyeballing transcripts.

### 8. `EventPriority` ladder for the activity timeline — **S**

**Take:** context-mode's `{ LOW: 1, NORMAL: 2, HIGH: 3, CRITICAL: 4 }` and the idea of a
priority-filtered snapshot budget (`src/types.ts`, ADR-0004 context).

**Lands in:** `src/sections/ActivityTimeline.jsx` and `src/sections/SessionsSection.jsx` as a
density control.

**Unlocks:** a long session becomes readable without pagination gymnastics.

### Explicitly NOT recommended

- **Do not adopt PreToolUse interception.** It breaks other plugins (context-mode #911, #946),
  it contradicts our read-only thesis, and it is the part of context-mode with the worst
  bug-to-feature ratio.
- **Do not copy context-mode source.** ELv2. Get any permission in writing, naming ELv2.
- **Do not port `openskills/src/utils/yaml.ts`.** Our `parseFM` is correct; theirs is not.
- **Do not reproduce a "98%" style headline.** The whole point of adoption #1 is that we can
  show a real number instead.

---

## Sources

### Primary — GitHub API (queried 2026-07-29 via authenticated `gh api`)

- `repos/mksglu/context-mode` — metadata, licence, stars/forks, commits, issues, git tree (599 blobs, `truncated: false`)
- `repos/mksglu/claude-context-mode` — resolves to `mksglu/context-mode` (redirect confirmed)
- `repos/skalingclouds/claude-context-mode` — 0-star fork, `fork: true`, pushed 2026-03-02 (not upstream)
- `repos/numman-ali/openskills` — metadata, licence, releases, issues, git tree
- `repos/mnfst/manifest` — metadata, licence, releases, commits (incl. `until=2023-01-01` to confirm the 2022 origin), git tree

### Primary — files fetched from `raw.githubusercontent.com/<repo>/main/...`

**context-mode:** `LICENSE`, `package.json`, `README.md` (94,871 B), `BENCHMARK.md`,
`docs/adr/0001-sessiondb-multi-writer.md`, `docs/adr/0002-tool-description-style.md`,
`docs/adr/0003-routing-deny-reasons.md`, `docs/adr/0004-stats-strict-compression-formula.md`,
`tests/ecosystem-benchmark.ts`, `src/types.ts`, `src/truncate.ts`, `src/server.ts`,
`src/session/db.ts`, `src/session/analytics.ts`, `src/session/pricing.ts`,
`hooks/hooks.json`, `hooks/core/routing.mjs`, `hooks/pretooluse.mjs`, `hooks/posttooluse.mjs`,
`bin/statusline.mjs`, `.claude-plugin/plugin.json`, `skills/context-mode/SKILL.md`,
`configs/claude-code/CLAUDE.md`

**openskills:** `LICENSE`, `package.json`, `README.md`, `AGENTS.md`, `CHANGELOG.md`,
`SECURITY.md`, `src/cli.ts`, `src/types.ts`, `src/commands/{install,sync,update,list,read,manage,remove}.ts`,
`src/utils/{skills,dirs,yaml,agents-md,skill-metadata,skill-names,marketplace-skills}.ts`,
`examples/my-first-skill/SKILL.md`, `examples/my-first-skill/references/skill-format.md`

**manifest:** `LICENSE`, `package.json`, `README.md`, `AGENTS.md`, `CLAUDE.md`,
`docs/model-parameters-schema.md`, `docs/glossary.md`,
`packages/shared/src/{model-route,specificity,agent-type,tiers,providers,index,request-params}.ts`,
`packages/shared/src/subscription/types.ts`,
`packages/backend/src/entities/{agent,tier-assignment,specificity-assignment,custom-provider,agent-enabled-provider}.entity.ts`,
`packages/backend/src/scoring/config.ts`, `packages/backend/src/scoring/index.ts`,
`packages/backend/src/scoring/dimensions/{structural,contextual,keyword}-dimensions.ts`

### Primary — GitHub issues read in full

- mksglu/context-mode **#950** (open) — `ctx_stats` self-contradiction, 2.7 MB vs 868 KB, 100% on a zero-`ctx_execute` session
- mksglu/context-mode **#894** (open) — statusline stuck on hardcoded "saves ~98%", `build/` missing from published 1.0.168
- mksglu/context-mode **#893** (closed) — "Confusing/misleading `ctx stats`"
- mksglu/context-mode **#874** (open) — OMP plugin: `bytes_avoided` always 0
- mksglu/context-mode issue list (open, by comments) — #911, #946, #947, #901, #878, #873, #993, #942, #880
- numman-ali/openskills **#94** (open, no replies) — "Is this project still actively maintained?"
- numman-ali/openskills issue list — #92, #89, #87, #86, #85, #84, #83, #81

### Web searches run

| Query | Outcome |
|---|---|
| `claude-context-mode MCP server github 98% context reduction` | **Hit** — resolved A to `mksglu/context-mode` |
| `openskills universal skills loader AI coding agents github` | **Hit** — resolved B to `numman-ali/openskills` |
| `manifest github connect agents coding harnesses model providers one manifest` | **Hit** — resolved C to `mnfst/manifest` |
| `"context-mode" Elastic License 2.0 not open source claude code plugin controversy` | **Hit** — corroborated the MIT→ELv2 switch and "source-available ≠ open source" framing |
| `mnfst manifest LLM gateway review criticism routing "auto" model router self-hosted` | **Hit** — surfaced third-party reviews; one notes the cost claim is "unsubstantiated in the README" |
| `"openskills" npm skill.json standard "Agent Skills" spec competing loaders 2026` | **Hit** — surfaced the competing-loader landscape (skillpm, skills-npm, vercel-labs/skills, AgentSkills CLI) and the `Geeksfino/openskills` name collision |
| `context-mode mksglu criticism "98%" claim skeptical hacker news reddit` | **Returned nothing usable.** No HN or Reddit thread critiquing the 98% figure was found. Results were the project's own README and mirror sites. The substantive critique in this document comes from the repo's own ADRs, benchmark code and issue tracker, not from external commentary. |
| `openskills numman-ali review critique "SKILL.md" AGENTS.md loader limitations` | **Returned nothing usable.** No critical reviews found — only DeepWiki-generated docs and the project's own README. The "~1 KB for 20 skills" figure circulating in those secondary sources is **not** in the repo and is unverified. |

### Not fetched / could not verify

- `https://context-mode.com` and `https://context-mode.pages.dev` landing pages
- `https://manifest.build/docs` and `app.manifest.build`
- npm download statistics for `context-mode`, `openskills`, `manifest`
- Homebrew formula contents for `openskills`
- Docker Hub pull counts for `manifestdotbuild/manifest`
- context-mode's `docs/platform-support.md` (56,264 B) — identified but not read in full
- `TOOL-DESCRIPTIONS-AUDIT.md` — cited by ADR-0002 as the record of its 38 A/B trials, but
  **verified absent from the repo tree at `main`**. The empirical evidence behind ADR-0002's
  findings is therefore not independently checkable; the findings are reported here as the
  maintainer's claims, not as verified results.
