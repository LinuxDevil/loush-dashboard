# INTEGRATION-cost.md

Wiring needed for the three new modules. **Nothing in this document has been applied** — every file
listed under "Shared files to edit" is off-limits to this change and was left untouched.

New files added by this change:

| File | Purpose |
| --- | --- |
| `lib/pricing.mjs` | `asOf`-aware rate table, `rateFor(model, at)`, `entryCost(entry, opts)` |
| `lib/usage-buckets.mjs` | `bucketUsage(entries, opts)` — 027 |
| `lib/ci-cost.mjs` | `ingestExecutionFile(input, opts)`, `summarizeRuns(records)` — 024 |
| `lib/tool-efficiency.mjs` | `toolEfficiency(records, opts)` — 111 |
| `lib/transcript-records.mjs` | shared JSONL/record handling used by 027 and 111 |
| `test/lib/{pricing,usage-buckets,ci-cost,tool-efficiency}.test.mjs` | 79 tests |

---

## Two premises in the brief that did not match the repo

Both changed the shape of the work, so they are recorded here rather than silently worked around.

1. **`lib/pricing.mjs` did not exist.** The brief said to read it first and not duplicate its
   `rateFor`/`entryCost`. There is no such file. The only pricing in the repo is two lines inside
   `server/index.mjs` (729 and 1998), which are off-limits to edit and cannot be imported anyway —
   `server/index.mjs` binds a listener at import time. `lib/pricing.mjs` was therefore created as a
   new file, and 027 imports it rather than re-deriving the arithmetic.
2. **`lib/context-analysis.mjs` and `lib/event-grouping.mjs` did not exist.** The brief said to reuse
   their record handling. The equivalent is the inline loop in `collectUsage()`
   (`server/index.mjs:668`), also unimportable. `lib/transcript-records.mjs` was created so that 027
   and 111 share one implementation instead of two.

If those files exist on another branch, the correct follow-up is to delete
`lib/transcript-records.mjs` and re-point the two imports; no other change is needed.

---

## Defects found in existing code

These are **reported, not fixed** — all three live in files this change may not edit.

### 1. `server/index.mjs:1998` under-bills 1-hour cache writes by ~38%

```js
const entryCost = e => { const P = PRICE_PER_M(e.model); return (e.in*P + e.out*P*5 + e.cc*P*1.25 + e.cr*P*0.1) / 1e6 }
```

`e.cc` is the aggregate `cache_creation_input_tokens`, charged at `1.25 × input` — the **5-minute**
write rate. One-hour writes bill at `2 × input`. This is not an edge case: in the real transcripts
under `~/.claude/projects` the cache writes are overwhelmingly `ephemeral_1h_input_tokens` (one
sampled request wrote 52,285 1h tokens and zero 5m). Every cost figure the dashboard shows is low.

`lib/pricing.mjs` reads the `cache_creation.ephemeral_5m/1h` split and bills each tier at its own
rate. Pinned by `test/lib/pricing.test.mjs` → *"1h cache writes are billed at the 1h rate"*.

### 2. `server/index.mjs:729` prices unknown models as Sonnet, confidently and wrongly

```js
const PRICE_PER_M = m => (/opus|fable/.test(m) ? 15 : /haiku/.test(m) ? 0.8 : 3)
```

The `else 3` branch means **any** unrecognised model — a new release, a third-party model, a typo, an
empty string — silently produces a $3/M figure indistinguishable from a real one. There is no way for
a caller to learn that the price was invented.

`rateFor()` returns `{ok:false, reason:'unknown-model'}` instead. The family regex is preserved but is
opt-in (`allowFamilyFallback:true`) and always returns `estimated:true`.

### 3. `PRICE_PER_M` has no time dimension

Historical usage is re-priced at today's rate, so a past month's reported cost changes whenever the
table changes. `rateFor(model, at)` selects the rate period in force when the tokens were spent, and
refuses (`no-rate-at-time`) rather than back-extrapolating into a window it has no rate for.

---

## Shared files to edit (not done here)

### `server/index.mjs` — endpoints

All four handlers are read-only and follow the existing `app.get('/api/...')` shape.

```js
import { bucketUsage } from '../lib/usage-buckets.mjs'
import { toolEfficiency } from '../lib/tool-efficiency.mjs'
import { ingestExecutionFile, summarizeRuns } from '../lib/ci-cost.mjs'
import { findTranscripts, readTranscript, usageRecords } from '../lib/transcript-records.mjs'
```

**`GET /api/usage/buckets`** — query: `days`, `limit`, `minEntries`, `estimate=1`.

```js
const { entries } = collectUsage()   // NOTE: see caveat below — collectUsage drops the dimensions
res.json(bucketUsage(entries, { limit: +req.query.limit || 50, allowFamilyFallback: req.query.estimate === '1' }))
```

> **Caveat that must be handled.** `collectUsage()` builds `{t, model, proj, in, out, cc, cr, tc}` and
> throws away `usage.speed`, `usage.inference_geo`, `usage.service_tier` and the
> `cache_creation` 5m/1h split. Fed those entries, `bucketUsage` correctly reports every dimension as
> `unknown` and every cache write as an assumed 5m tier. Either add the four fields to the `e = {...}`
> literal at `server/index.mjs:692` (one-line change, preserves the cache), or call
> `usageRecords(readTranscript(f).records)` from `lib/transcript-records.mjs` for this endpoint.
> The first option is better — it keeps the existing mtime/size cache.

**`GET /api/tools/efficiency`** — query: `minSample`, `limit`.

```js
const records = findTranscripts(path.join(CLAUDE, 'projects')).flatMap(f => readTranscript(f).records)
res.json(toolEfficiency(records, { minSample: +req.query.minSample || 5, limit: +req.query.limit || 25 }))
```

This walks every transcript on each request (~5k records / 14 MB here, well under a second) but has no
caching. If it shows up in profiling, key a cache on file mtime+size exactly as `usageCache` does.

**`POST /api/ci/cost`** — body is the raw `execution_file` artifact.

```js
app.post('/api/ci/cost', express.text({ type: '*/*', limit: '25mb' }), (req, res) => {
  res.json(ingestExecutionFile(req.body, { source: req.query.run || null }))
})
```

`ingestExecutionFile` never throws, so no try/catch is needed — a malformed artifact returns
`{ok:false, reason}` with HTTP 200. **Do not** map `ok:false` to a 4xx: `no-result-element` is a
successful read of a file that has no cost in it, which is a finding the UI needs to show.

**`GET /api/ci/costs`** — roll up stored records with `summarizeRuns(records)`.

### `.github/workflows/*` — artifact capture

The action must upload its `execution_file` for any of this to have input:

```yaml
- uses: anthropics/claude-code-action@v1
  id: claude
- uses: actions/upload-artifact@v4
  if: always()           # a failed run's cost is still a real cost
  with:
    name: claude-execution
    path: ${{ steps.claude.outputs.execution_file }}
```

### `src/App.jsx` — UI hookup

Three panels. The house rule that has to survive into the DOM: **`null` renders as "unknown", never as
`$0.00`.** `(cost ?? 0).toFixed(2)` anywhere in this wiring destroys the entire point of the modules.

1. **Cost by bucket** — table over `buckets[]`, columns model / speed / geo / tier / entries / cost.
   - `priced === false` → render `cost` as an em-dash with `costReason` in the tooltip. Never `$0.00`.
   - `partialCost !== null` → render as `~$X (partial)`; it covers only `pricedEntries` of `entries`.
   - `estimated === true` → estimate badge. Tooltip from `assumptions[].why` +
     `maxUnderstatementUsd`.
   - `unknownDimensions` non-empty → grey the offending cells. They are unknown, not "standard".
   - Header must read **"priced usage only"** when `totals.complete === false`, and show
     `totals.coverage` plus `totals.unpricedReasons`.
   - Render every entry of `bounds[]` as a visible footnote — that array is what makes a truncated
     table reconcile against the totals.

2. **CI run costs** — list over `results[]`.
   - `verified === false` → "cost unknown" + `reason`. A CI run we could not price is not a free run.
   - `resultCount > 1` → show the `multiple-result-elements` bound, which names the chosen element
     and states that the others were not summed.
   - `summarizeRuns().complete === false` → label the total "partial" with the unverified count.

3. **Tool efficiency** — table over `tools[]`.
   - Success rate must be rendered **next to its `n`**, e.g. `95.7% (n=1523)`.
   - `unresolved` gets its own column. Do not fold it into either side of the rate.
   - `lowSample === true` → mark the row (grey / asterisk). **Do not hide it.**
   - `durationEstimated` / `tokensEstimated` are always true — show an estimate marker with
     `durationBasis` / `tokensBasis` as the tooltip. These are especially easy to misread: the
     duration includes model and human latency (`AskUserQuestion` measures at 169 s in real data,
     which is the user thinking, not a slow tool).
   - `orphanResults > 0` → banner saying the window is partial.

---

## Verified against real data

Run against 31 transcripts / 5,114 records under `~/.claude/projects` (recursively — the nested
`<session>/subagents/*.jsonl` dirs hold a large share of the usage and a non-recursive glob misses
them). Both real-data assertions live in the test files and skip cleanly when the directory is absent.

**Confirmed:**

- 5,114 lines parsed, **0 malformed** — the JSONL is clean in this checkout.
- 2,722 billable usage records; every one lands in exactly one bucket, none lost or double-counted.
- Four buckets, and the dimension handling matters in practice:
  - `speed` **absent on 1,018 of 2,722 records (37%)** → labelled `unknown` with state `absent`.
  - `inference_geo` is the literal string `"not_available"` on **all 2,722** → labelled `unknown`
    with state `sentinel`, kept distinct from an absent field.
  - `service_tier` (`standard`) and `model` are present on all records.
- Models are `claude-opus-5` and `claude-sonnet-5`, neither of which is in the shipped rate table, so
  the default result is **`pricedUsd: null`, coverage 0, `unpricedReasons: {unknown-model: 2722}`** —
  not a $0 total and not a confident wrong number. With `allowFamilyFallback:true` the same data
  prices to ~$1,449.65 with every bucket flagged `estimated:true`. That gap is the feature.
- Real records carry the `cache_creation` 5m/1h split, so `maxUnderstatementUsd` is **0** — the
  cache-tier assumption path is exercised by unit tests, not by this data.
- 1,524 tool calls: 1,461 success / 62 failure / **1 unresolved** (the call in flight while the file
  was read). The three states partition exactly. Headline 95.93% over 1,523 resolved; the published
  bracket is 95.87%–95.93%.
- `AskUserQuestion` results really do arrive with **no `is_error` field at all**, confirming that
  treating a missing flag as failure would invent errors.
- `ToolSearch` produced a `meanOutputBytes: null` (non-text result content) rather than a fake 0.
- 4 tools fell below the n=5 sample floor and were **marked, not dropped**.

**Not verified — no data available:**

- **No real `execution_file` artifact exists anywhere in this repo or on this machine**, so
  `lib/ci-cost.mjs` is tested entirely against synthetic fixtures built to the documented shape
  (`type: "result"` with `total_cost_usd`, `duration_ms`, `subtype`, `is_error`, `num_turns`,
  `session_id`). Both the top-level-array and `{events:[…]}` envelopes are handled, but **which one
  the current action version emits is unconfirmed.** Re-check the first real artifact against
  `extractEvents()`.
- The rate table is unverified against a real invoice. It holds no entry for `claude-opus-5` /
  `claude-sonnet-5`; those must be added via `overrides` (or committed to `RATE_TABLE`) by someone
  with the published prices. Until then the honest output for this machine's own usage is "unpriced".
- True tool execution time is **not obtainable**. No `duration`/`elapsed`/`ms` key exists on
  `toolUseResult` in any transcript checked, so `meanDurationMs` is necessarily a timestamp delta and
  is labelled as such.
- No `is_error: true` case was observed on a result whose `content` was a block array, so that
  combination is covered only by unit tests.
