# INTEGRATION — tool-flow diagrams (070) and the insight-rule registry (072)

Nothing here is wired into the running app: every file added is new, and no existing file was
edited. This document is the wiring instruction, the field-provenance evidence behind every insight
rule, and the upstream data defects that have to be fixed before the rules can say things they are
currently not allowed to say.

## What was added

| File | What it is |
| --- | --- |
| `src/lib/sankey.js` | Pure layout math: `sankeyLayout`, `orchestrationLayout`, `linksFromSequences`, `findCycles`. No React, no d3, no `d3-sankey` (not installed, and not added). |
| `src/ui/FlowDiagram.jsx` | SVG renderer. Exports `ToolFlowSankey`, `OrchestrationDAG`, and a default `FlowDiagram` stacking both. |
| `lib/insight-rules/index.mjs` | Registry (`RULES`), engine (`runInsightRules`, `runInsightRulesForAll`), and `missingFieldsFor`. |
| `lib/insight-rules/types.mjs` | The `Insight` type, `SEVERITY`, `validateInsight`, `makeContext`. |
| `lib/insight-rules/stats.mjs` | `median` / `pctl` / `ratio` / `peersOf`, all null-disciplined. |
| `lib/insight-rules/cache-read-collapse.mjs` | Rule (comparative): cache-read share far below the project's own median. |
| `lib/insight-rules/tool-error-rate.mjs` | Rule (comparative): session error rate above the project's pooled rate. |
| `lib/insight-rules/cost-per-output.mjs` | Rule (comparative): $ per 1k output tokens above the project median. |
| `lib/insight-rules/error-tool-concentration.mjs` | Rule (**no peers needed**): this session's failures are concentrated in one tool. |
| `test/lib/sankey.test.mjs` | 25 tests. |
| `test/lib/insight-rules.test.mjs` | 35 tests. |

`node --test` → 446 pass, 0 fail (60 new; the suite was 386 before). `npx vite build` succeeds, and `git status` shows
`package.json` / `package-lock.json` untouched — no dependency was added.

---

## Field provenance — what was actually verified on this machine

Every rule is grounded in a field confirmed present in real transcripts. The scan was **recursive**
over `~/.claude/projects/**/*.jsonl`, which matters: 31 of the 32 files live under a nested
`subagents/` directory and a shallow glob finds one file out of thirty-two.

**Corpus: 32 files, 5,525 JSONL records, 0 unparsable, spanning 2026-07-29 → 2026-07-30.**

| Field (JSONL) | Records | Feeds session field |
| --- | ---: | --- |
| `sessionId` | 5,525 | `sessionId` |
| `timestamp` | 5,103 | `first` / `last` / `durationMs` |
| `cwd`, `gitBranch` | 4,995 | `proj` / `project` / `branch` |
| `message.usage.input_tokens` | 2,965 | `in` |
| `message.usage.output_tokens` | 2,965 | `out` |
| `message.usage.cache_creation_input_tokens` | 2,965 | (cost model) |
| `message.usage.cache_read_input_tokens` | 2,965 | `cacheRead` |
| `content[].type === 'tool_use'` | 1,668 | `toolCalls`, `toolUsesByTool` |
| `content[].type === 'tool_result'` | 1,668 | — |
| `tool_result.is_error === true` | 66 | `errors`, `errorsByTool` |

Tool-name distribution observed (1,668 calls): `Bash` 1195, `Edit` 174, `Write` 160, `Read` 70,
`Agent` 31, `TaskUpdate` 15, `TaskCreate` 11, `SendMessage` 5, `Grep` 2, `AskUserQuestion` 2,
`ToolSearch` 2, `Skill` 1.

Error attribution observed (66 failures, **100% resolved** to a tool via
`tool_result.tool_use_id` → `tool_use.id`): `Bash` 50, `Edit` 11, `Write` 3, `Read` 2. There were
zero unattributable failures, which is why `error-tool-concentration` is allowed to exist.

### A rule that was written and then deleted

`compaction-thrash` (compactions per hour vs the project median) was implemented and removed.
`isCompactSummary` occurs **once** in the entire 5,525-record corpus, `type: 'summary'` occurs
**zero** times, and the one compaction that did happen is marked
`type: 'system', subtype: 'compact_boundary'` — a shape `server/index.mjs`'s counter
(`j.isCompactSummary || j.type === 'summary'`) only catches by luck. A rule needing ≥2 compactions
plus a ≥5-session peer baseline could not fire even once here. Per the brief, a rule that silently
never fires is worse than an absent one, so it is absent. If `compact_boundary` counting is added
server-side and the base rate turns out to be non-trivial, the rule is ~60 lines and the shape is in
git history.

### Two things this corpus says about the engine's own assumptions

1. **`/api/sessions` filters out `isAgent` files**, and 31 of the 32 transcripts here are subagent
   files. On this machine the endpoint therefore yields **one** session, so all three comparative
   rules abstain with `insufficient-peer-baseline`. That is correct behaviour, not a bug — but it is
   why `error-tool-concentration` is deliberately non-comparative. Consider passing subagent
   sessions as peers explicitly (they carry the same usage/tool/error fields) if you want the
   comparative rules to speak on a young install.
2. **`in` is tiny and `cache_read` is enormous** in real data (main session: `in` 3,292 vs
   `cacheRead` 622,056,148). `cache-read-collapse` divides by `in + cacheRead`, so healthy sessions
   land near 100% and the 25-point gap threshold only trips on a genuine collapse.

---

## 072 — wiring the insight registry

The rules are dependency-free ESM with no Node builtins, so they import cleanly from
`server/index.mjs` **or** straight into a React section through Vite.

```js
import { runInsightRules, missingFieldsFor } from '../../lib/insight-rules/index.mjs'

const { sessions } = await api.get('/api/sessions?days=30&limit=200')
const r = runInsightRules(sessions[0], sessions)
```

### Session fields each rule requires

Rules take everything they need off the `session` object — none of them import an analysis module.
`RULES[].needs` declares this in code, and `missingFieldsFor(session)` reports the gaps before you
run anything, so an unwired field shows up as a wiring gap rather than as a permanently quiet rule.

| Rule | Needs on `session` | Peers? | Wired today by `/api/sessions`? |
| --- | --- | --- | --- |
| `cache-read-collapse` | `proj`, `in`, `cacheRead` | yes | **yes** |
| `tool-error-rate` | `proj`, `toolCalls`, `errors` | yes | yes, but `errors` is 0-for-unknown (defect 2) |
| `cost-per-output` | `proj`, `cost`, `out` | yes | **yes** |
| `error-tool-concentration` | `errorsByTool`, `toolUsesByTool` | **no** | **no — see below** |

`errorsByTool` / `toolUsesByTool` already exist server-side: `failStats()` computes them per file as
`rec.toolErrs` and `rec.toolUses`. Putting them on the row is two lines in the `/api/sessions` map:

```js
errorsByTool: fr ? fr.toolErrs : null,      // null, not {} — see defect 2
toolUsesByTool: fr ? fr.toolUses : null,
```

`null` matters: `{}` would read as "measured, and no tool ever errored".

### What the UI MUST render

`runInsightRules` returns `{ insights, failures, abstentions, complete, bounds }`. Three of those are
not optional:

1. **`bounds.failureNote`** — when a rule throws, the list is short *because a rule broke*, not
   because the session was clean. Gate a warning banner on `complete === false`.
2. **`bounds.note`** — if you pass `opts.limit`, say so (`showing 2 of 4 insights`).
3. **`abstentions`** (at minimum behind a disclosure) — "could not measure" and "measured, and it is
   fine" are different facts, and every rule reports which one applies.

### Adding a rule

One file, one registry entry:

```js
export default function myRule(session, allSessions, ctx) {
  if (!measurable(session)) return ctx.abstain('reason-slug')   // returns null
  …
  return { id, rule: id, severity, title, detail, n, evidence: {…}, falsifiableAs: '…' }
}
```

`evidence` and `falsifiableAs` are enforced by `validateInsight`, as is `n` whenever `evidence`
contains a key matching `/rate|pct|share|per/`. A rule returning a shape that fails those checks is
reported in `failures` as `kind: 'invalid-insight'` — a named rule bug, not a silent drop.

---

## 070 — wiring the flow diagrams

### Tool-flow Sankey

`/api/flow` already returns the needed shape:

```js
import { ToolFlowSankey } from '../ui/FlowDiagram.jsx'

const links = data.observed.map(e => ({ source: e.from, target: e.to, value: e.count }))
<ToolFlowSankey links={links} nodes={data.nodes} nodeCap={20} linkCap={60} />
```

`data.nodes` can carry the same id under two kinds — that is exactly the duplicate-node case the
layout merges, and the merge count is printed on the diagram.

For a single session, feed raw sequences instead:

```js
import { blocksToPlan } from '../lib/plan.js'
const seq = blocksToPlan(blocks).map(s => s.tool_to_call).filter(Boolean)
<ToolFlowSankey sequences={[seq]} />
```

This is where self-loops actually bite: with `Bash` at 1,195 of 1,668 observed calls, `Bash → Bash`
is the single largest edge in this corpus, and an unguarded layout drops it entirely.

### Orchestration DAG

**No endpoint produces this shape yet.** `OrchestrationDAG` wants
`[{ session, agent, subagent, tool, outcome, value }]`, any stage nullable. It can be derived
client-side from the same blocks `PlanGraph` already receives (`Agent` appears 31 times in this
corpus, so the agent/subagent layers are populated in real data):

```js
const steps = blocksToPlan(blocks)                       // src/lib/plan.js
const records = steps.flatMap(s => s.subplan
  ? s.subplan.map(c => ({ session: sessionId, agent: s.description.split(':')[0], subagent: null, tool: c.tool_to_call, outcome: c.isError ? 'error' : 'ok' }))
  : [{ session: sessionId, agent: null, subagent: null, tool: s.tool_to_call, outcome: s.isError ? 'error' : 'ok' }])
```

Do **not** substitute `'main'` (or any other plausible label) for a missing `agent`/`subagent`. The
layout counts and reports missing stages (`unknownByLayer`, `unknownNote`) and dashes the edges that
bridge them; a fabricated `main` would turn "we never observed an agent" into "the agent was main".

### What the renderer prints, and why none of it is optional

* the node/link cap — `showing 20 of 47 tools and 60 of 210 flows`, plus which tools were cut;
* cycles — a banner naming the back edges, and the back edges still drawn (dashed);
* self-loops — a `↻n` badge on the node, because the edge has no ribbon;
* merged duplicate node ids and summed duplicate edges;
* per-layer caps on the DAG, printed per column.

The banner renders even when nothing was truncated (`showing all 12 tools and 18 flows`). A notice
that only appears sometimes trains readers to stop looking for it.

---

## Upstream data defects the rules work around

In `server/index.mjs`; **not** changed here, since no existing file was edited. Each launders
"unknown" into a plausible number, and each costs a rule its ability to speak.

### 1. `/api/sessions` — `cacheReadPct: cacheIn ? f.cr / cacheIn : 0`

A session with no cache accounting reports `0`, indistinguishable from "measured, and it really was
0%". `cache-read-collapse` therefore ignores `cacheReadPct` and recomputes from `in` + `cacheRead`,
abstaining when that denominator is zero.
**Fix:** emit `cacheReadPct: null` when `cacheIn === 0`.

### 2. `/api/sessions` — `errors: fr ? … : 0` (and `compactions: fr?.compactions || 0`)

With no forensics record, the row says `errors: 0`: "we never looked" reads as "there were none".
`tool-error-rate` requires a real number and honours an explicit `errorsMeasured: false`, but it
cannot tell the two apart from the current payload.
**Fix:** emit `errors: null` when `fr` is absent, or add `errorsMeasured: Boolean(fr)`.

### 3. `/api/sessions` does not expose the per-tool breakdown

`failStats()` computes `rec.toolErrs` and `rec.toolUses` and throws them away at the row boundary.
`error-tool-concentration` — the only rule that works without a peer baseline, and therefore the only
one that can say anything on a young install — cannot run until they are on the row. See the two
lines above.

### 4. `durationMs: Math.max(0, f.last - f.first)`

Wall clock over the transcript, so an idle session looks long. No rule currently divides by it (the
one that did was deleted), but anything that starts to should print the caveat rather than treat it
as active time.

### 5. `cost` is an estimate, not an invoice

`entryCost()` prices tokens from a hard-coded per-model table (`PRICE_PER_M`; this corpus is
`claude-opus-5` 2,814 records and `claude-sonnet-5` 151). `cost-per-output` labels this in
`evidence.costSource` — keep that label visible wherever the dollar figure is rendered.
