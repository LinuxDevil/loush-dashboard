# INTEGRATION-contracts.md

Wiring required for three new library modules. Nothing outside `lib/` and `test/lib/` was modified,
so none of this is live yet — this file is the list of edits someone else has to make, and the
guarantees those edits must not break.

| Module | Purpose | Public entry points |
| --- | --- | --- |
| `lib/contracts.mjs` | Declared contract for external file shapes, checked against real samples | `checkAll()`, `formatReport()`, `checkTranscriptRecords()`, `checkJsonDocs()`, `findTranscripts()`, `CONTRACT` |
| `lib/repo-complexity.mjs` | Deterministic 0–6 rubric + over-engineering audit | `complexityOf()`, `gatherRepoEvidence()`, `scoreComplexity()`, `auditOverEngineering()`, `deriveObservationWindow()`, `RUBRIC` |
| `lib/context-reduction.mjs` | Honest per-user always-on vs deferred savings | `computeContextReduction()`, `fromCapabilityLedger()`, `formatReduction()` |

All three are pure-ish, non-throwing, and dependency-free (`node:fs`, `node:path`, `node:os` only).

---

## 1. Non-negotiable rendering rules for whoever wires these into the UI

Each module can return "unknown". **The UI must be able to render unknown.** If the front end does
`{value}%` or `{count} skills unused`, these modules become worse than the numbers they replace,
because the caveat lives in a field the UI dropped.

| Field | When it is `null` | The UI must render |
| --- | --- | --- |
| `report.ok` | nothing could be checked | "could not check" + `sourcesNotChecked[].reason`. **Never a green tick.** |
| `complexity.score` | repo unreadable | the `reason`, not `0` |
| `complexity.dimensions[].points` | that dimension's evidence unreadable | "not measured", and the score as `score/scoreOutOf` — **not `/6`** |
| `audit.noRecordedInvocationCount` | no observation window | `audit.because`, not `0` |
| `reduction.reductionPct` | either side unmeasured | `reduction.because`, not `0%` and not `—` |

Two more that are not nullable but are equally load-bearing:

- `audit.headline` already contains "0 are proven unused". **Do not shorten it to the punchy version.**
  The number without the window and the disclaimer is an accusation the data cannot support.
- `reduction.reductionPct` must never be displayed without `numerator`, `denominator` and
  `coverage`. `formatReduction()` does this correctly; copy its shape.

Any `bounds` array with entries means the result describes a *sample*, not the whole. Surface it.

---

## 2. `lib/contracts.mjs` — boot check

**Recommended wiring:** a startup call in `server/index.mjs`, plus an endpoint.

```js
import { checkAll, formatReport } from '../lib/contracts.mjs'

const contractReport = checkAll()            // never throws; safe at module scope
if (contractReport.ok === false) console.error(formatReport(contractReport))
else if (contractReport.ok === null) console.warn(formatReport(contractReport))  // could-not-check
app.get('/api/contracts', (req, res) => res.json(contractReport))
```

`checkAll()` reads ~5,000 transcript records on this machine in ~150 ms. If that is too slow for
boot, call it lazily behind the endpoint — but **do not** shrink the sample to make it fast without
also surfacing the resulting `bounds` entry, or you reintroduce the shallow-glob problem this module
exists to fix.

### The contract is grounded, not guessed

Declared from (a) 4,658 records across 30 real transcripts on this machine and (b) a grep of `lib/`
and `server/` for actual field accesses. Every field carries `readBy` naming its call sites; drift on
a field this repo reads is `level: 'error'`, drift on one nobody reads is `level: 'warn'`.

### Discovery must stay recursive

`~/.claude/projects/*/*.jsonl` finds **1** file on this machine. The recursive walk finds **29–31**;
the rest are subagent transcripts under `<session-id>/subagents/`. `findTranscripts()` reports
`shallowGlobWouldFind` and `missedByShallowGlob` so the gap is visible.

> **Checked, and fine:** `server/index.mjs:2313` `scanTranscripts()` uses a recursive `walkS`, so the
> existing code already sees the nested subagent transcripts. No fix needed there. `findTranscripts()`
> matches its behaviour deliberately, and adds bounds reporting plus the shallow-glob comparison so a
> future refactor that flattens the walk shows up as a number rather than as quietly smaller metrics.

### Verified behaviour on this machine (2026-07-30)

| Source | Result |
| --- | --- |
| Transcript JSONL | **ok** — 4,921 records, 31 files, 0 malformed |
| `~/.claude.json` | **ok** — 1 sample; 15 undeclared top-level keys listed (informational) |
| `~/.claude/settings.json` | **could-not-check** — the file does not exist here |

That third row is the headline behaviour. The overall verdict is `ok: true` with
`sourcesNotChecked: [settingsJson]`; it is never `ok` for a source that was never read.

---

## 3. `lib/repo-complexity.mjs`

### Rubric

Six dimensions, 1 point each, thresholds declared in `RUBRIC`:

| Dimension | Measured from | Threshold |
| --- | --- | --- |
| `breadth` | source-file count (excl. `node_modules`, `.git`, `dist`, `build`, …) | ≥ 100 files |
| `languageMix` | distinct source extensions | ≥ 3 |
| `dependencyLoad` | `package.json` deps + devDeps | ≥ 10 |
| `structuralDepth` | max path depth of a counted source file | ≥ 5 segments |
| `automation` | CI workflows + npm scripts + build configs | ≥ 6 |
| `testSurface` | `*.test.*` / `*.spec.*` / under `test*/` | ≥ 10 |

Determinism is enforced by sorted directory traversal and the absence of `Date.now()` /
`Math.random()` / mtime from the scoring path. A test stubs both globals and asserts the score is
byte-identical. Time enters only `auditOverEngineering`, and only as an explicit parameter.

**Suggested wiring:** `GET /api/complexity?project=<abs path>` calling `complexityOf(project)`.

### Audit — required inputs

`auditOverEngineering({ installed, invocations, window, recordCompleteness })`.

- `installed`: `[{ kind, name, installedAt, alwaysOnTokens }]`. `server/index.mjs overviewItems()`
  already produces `{ kind, name, mtime, descTokens, fullTokens }` — map `mtime → installedAt`,
  `descTokens → alwaysOnTokens`.
- `invocations`: `[{ kind, name, t }]`. `server/index.mjs scanTranscripts().invocations` already has
  this shape. **Also merge `~/.claude.json → skillUsage[name].lastUsedAt`**, which the existing code
  does not read and which records fires the transcripts may not cover.
- `window`: build it with `deriveObservationWindow({ invocationTimes, transcriptTimes, firstStartTime })`.
  **Do not substitute a default 30/90-day window.** If the timestamps are missing, the window is
  unknown and the audit correctly returns `null` rather than a count.
- `recordCompleteness`: `'complete' | 'partial' | 'unknown'`. Pass `'partial'` — transcripts rotate,
  live on other machines, and `skillUsage` only ever lists capabilities that *have* fired.

`provenUnusedCount` is hard-wired to `0`. It is not a placeholder to be filled in later; nothing in
either data source can evidence a non-event.

---

## 4. `lib/context-reduction.mjs`

### Existing data: PRESENT — reuse it, but not all of it

`alwaysOnTokens` / `fullTokens` **already exist** in this repo.

- **Producer:** `server/index.mjs:2892`, inside `capabilityLedger()` — rows of
  `{ kind, name, scope, alwaysOnTokens, fullTokens, fires30, fires90, ... }`, served at
  `GET /api/capabilities`.
- **Consumers today:** `src/sections/CapabilityLedger.jsx`, `src/sections/Overview.jsx:197`.
- **Underlying measurement:** `hubListSkills()` (`server/index.mjs:1512`) sets
  `descTokens = tokens(description)` and `fullTokens = tokens(entire SKILL.md)`, where
  `tokens = s => Math.ceil(s.length / 4)` (`server/index.mjs:569`).

`fromCapabilityLedger(ledgerJson, { userId, snapshot, tokenCounting })` consumes that shape directly.

**Suggested wiring:** `GET /api/context-reduction` →

```js
fromCapabilityLedger(capabilityLedger(), {
  userId: readJson(CLAUDE_JSON, {}).oauthAccount?.accountUuid ?? null,
  snapshot: { at: Date.now(), source: 'GET /api/capabilities' },
  tokenCounting: { method: 'ceil(chars/4) heuristic — server/index.mjs:569', exact: false },
})
```

### What must NOT be used as the denominator

`hubResolve()`'s `alwaysOn` total (`server/index.mjs:1600`) sums `contributors`, which include:

- `{ name: 'system prompt', tokens: 2100, est: true }` — a constant from `HARNESS_DEFAULTS`
  (`server/index.mjs:1330`), not a measurement of this user's system prompt;
- `{ kind: 'mcp', estTokens: 600 }` — a flat 600-token guess **per MCP server**
  (`server/index.mjs`, `hubResolve`), with no `fullTokens` counterpart at all.

Both are flagged `est: true` in the source and then summed alongside measured file sizes. Dividing by
a total containing guesses produces an impressive figure with uncomputable error bars — the exact
failure mode this module refuses. `computeContextReduction` excludes `estimated: true` items from
*both* sides by default; `includeEstimated: true` is available and stamps `basis: 'partly-estimated'`.

### What the percentage IS a percentage of

> `(fullTokens − alwaysOnTokens) / fullTokens`, summed over the capabilities whose **both** token
> counts were measured, for one user, at one snapshot time.

`denominator` = what those same capabilities would cost per session if all were loaded in full.
It is **not** the context window, **not** observed session usage, **not** a bill. `denominatorMeans`
carries that sentence in the returned object so it cannot be separated from the number.

### If you want a *stronger* claim, this is what must be recorded

The current figure is a **static token-cost ratio** — a property of the installed capability set, not
of behaviour. It answers "what does deferral save per session in principle", not "what did it save
you last month". For the behavioural version, none of these exist today and all would need recording:

1. **Per-session realised context.** For each session: the always-on token total actually in context,
   and which capabilities actually loaded in full. Derivable in principle from the `system` /
   `attachment` records plus `message.usage.cache_creation_input_tokens`, but nothing currently
   attributes those tokens to a named capability.
2. **A counterfactual baseline.** "What would this session have cost with everything always-on" is
   unobservable — nobody runs it. It must be *computed* per session from the capability set as it
   existed *at that session's time*, which requires capability install/uninstall history. Today only
   the current `SKILL.md` mtime exists; an edit overwrites it and the history is gone.
3. **Exact token counts.** `ceil(chars/4)` is a heuristic. The *ratio* is largely robust to it (the
   same bias sits in numerator and denominator), but absolute token figures are not, and should stay
   labelled `exact: false` until a real tokenizer is wired in.
4. **A stated window.** A behavioural metric needs `{ start, end }` from the sessions it covers, and
   must exclude sessions that predate a capability's install.

Until 1–3 exist, present this as what it is: a per-session structural saving from deferred loading,
at a snapshot, over the measured subset.

---

## 5. Verified results on this machine (2026-07-30)

| Metric | Result |
| --- | --- |
| Complexity of this worktree | **5 / 6** (all six dimensions measurable) |
| — met | breadth 151≥100, languageMix 5≥3, dependencyLoad 15≥10, structuralDepth 7≥5, testSurface 39≥10 |
| — not met | automation 5 < 6 (1 CI workflow + 3 npm scripts + 1 build config) |
| Skills installed under `~/.claude/skills` | 12 |
| Recorded skill invocations | 2 (both `claude-api`) |
| Observation window | **1.52 days** — flagged `tooShortForHabitClaims` |
| Inventory completeness | **DEMONSTRABLY INCOMPLETE** — `claude-api` fired but is not on local disk |
| Context reduction | **96.4 % = 31,430 / 32,597 tok/session**, measured, 12/12 capabilities |

The `claude-api` mismatch is a genuine finding, not a bug: managed and plugin-supplied skills are not
present under `~/.claude/skills`, so any inventory built by listing that directory is incomplete.
`auditOverEngineering` surfaces this as `unmatchedInvocations` and downgrades `inventoryCompleteness`
rather than silently discarding the invocation. **Whoever wires the audit up should extend the
`installed` inventory to include plugin/managed skills before the "no recorded invocation" count is
shown to anyone.**

---

## 6. Tests

`node --test` — **86 new tests, all passing; 472 in the full suite, 0 failures.**

- `test/lib/contracts.test.mjs` — 27
- `test/lib/repo-complexity.test.mjs` — 33
- `test/lib/context-reduction.test.mjs` — 26

Each asserts an honesty property, not a happy path: zero samples ⇒ `could-not-check`; a missing side
⇒ `null` + reason; the complexity score is byte-stable across ten runs and under stubbed
`Date.now`/`Math.random`; declared-optional absence is never drift; malformed input never throws.

The real-file tests in `contracts.test.mjs` **skip with an explicit message** when no Claude Code
files exist, and the skip message states that the test asserted nothing. They never pass vacuously.
