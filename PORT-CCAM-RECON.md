# C1 pricing — recon findings

> Agent R, 2026-07-29. **Exhaustive scan**: all 894 `.jsonl` under `~/.claude/projects` (627 MB),
> 31,162 usage records after per-file `dedupeTurns()` by `message.id`. No sampling.
> Corpus 2026-06-07 → 2026-07-29.

## What this means for the implementation

1. The tier split is on **100%** of records (31,160/31,160 with `cc>0`), and `flat === 5m + 1h` on
   **31,162/31,162**. No "unknown" third state is needed for this corpus — keep a documented 5 m
   fallback for foreign data; it executes on 0 records here.
2. ~~The error is real and one-sided: **$8,241.27 → $9,057.50, +$816.23 (+9.90%)** understated.~~
   **Superseded — see the audit section below.** This figure isolated the cache-tier bug while
   holding the old $15/M Opus base rate constant. That base rate was itself two generations
   stale, and correcting it dominates: the corpus total *falls* 58%.
3. **61.9%** of cache-creation tokens are 1 h, and the split is a *perfect partition*: subagent
   transcripts are 100% 5 m, main transcripts are 100% 1 h.
4. `lib/harness-usage-trends.mjs:44` holds a **second, untested copy** of the `1.25×`/`0.1×`
   ratios. Fixing only `lib/pricing.mjs` leaves `cacheTtl.wasteCost` wrong.
5. **The bigger accuracy bug is not the tier.** Per-session cost *excludes* subagents
   (`!f.isAgent`, 9 call sites) while global totals *include* them — and 47.6% of records are
   subagent records. Two different totals on the same screen.

---

---

## Audit (post-implementation, independent recompute)

Run after the rewrite landed, pricing the whole corpus twice: the **old** way with the ratio model
hand-transcribed from git `HEAD` (not imported, so a bug in the new module cannot flatter it), and
the **new** way through `lib/pricing.mjs`. 907 files, 31,330 deduped records.

| | total |
|---|---|
| old model (stale $15/M Opus base, one cache-write rate) | **$8,334.91** |
| new model (real per-model rates, 5 m/1 h tiers, intro rates) | **$3,471.52** |
| delta | **−$4,863.38 (−58.35%)** |

**The dashboard has been overstating spend by ~2.4×.** Two errors pointed in opposite directions
and the larger one was hidden:

- **Base rates two generations stale.** Opus is $5/M input, not $15 — it dropped with the 4.7
  generation. `lib/pricing.mjs` still carried $15. This overstated Opus, which is 78% of the
  corpus by tokens.
- **Cache-write tier collapsed.** 1 h writes priced at the 5 m rate. This understated everything.

The tier fix is visible in isolation on exactly the two models whose base rate did *not* change,
and it matches this document's own predictions to two decimals — which cross-validates both passes:

| model | old | new | Δ | predicted above |
|---|---|---|---|---|
| `claude-sonnet-4-6` | $12.83 | $14.94 | **+16.5%** | +16.50% |
| `claude-haiku-4-5` | $5.36 | $5.38 | **+0.4%** | +0.31% |
| `claude-opus-4-8` | $6,366.03 | $2,326.46 | −63% | (base rate 15 → 5) |
| `claude-sonnet-5` | $443.68 | $304.25 | −31% | (intro rate $2/$10 now applied) |

Re-confirmed independently: tier split present on **31,330/31,330** records, 0 untiered; 1 h share
**61.8%**; the partition is exact — subagent rows 48,636,668 5 m / **0** 1 h, main rows **0** 5 m /
78,558,493 1 h; **no** model prices as `null`.

`claude-opus-4-7` and `claude-opus-4-6` were added to the table beyond the six models in the
corpus: the app's own Run Claude model picker offers Opus 4.7, so a session spawned from this
dashboard would otherwise have priced as unpriced — i.e. rendered $0, which reads as "free" rather
than "no rate held".

---

## Q1. Model inventory

| model | records | total tokens | `PRICE_PER_M` | first → last |
|---|---|---|---|---|
| `claude-opus-4-8` | 18,336 | 2,602,931,428 | 15 | 06-07 → 07-27 |
| `claude-sonnet-5` | 8,121 | 1,055,689,478 | 3 | 07-01 → 07-28 |
| `claude-opus-5` | 2,442 | 341,526,614 | 15 | 07-24 → 07-29 |
| `claude-fable-5` | 1,534 | 243,131,722 | 15 | 07-05 → 07-28 |
| `claude-haiku-4-5-20251001` | 479 | 21,082,427 | 1 | 06-07 → 07-14 |
| `claude-sonnet-4-6` | 250 | 19,136,981 | 3 | 06-26 → 07-02 |

**Zero ids price as `null`** — the four regexes match everything present. `<synthetic>` is filtered
at `server/index.mjs:809`.

The gap is not coverage, it is **flattening**: `/opus/` collapses `opus-4-8` and `opus-5`;
`/sonnet/` collapses `sonnet-5` and `sonnet-4-6`. And `/fable/ → 15` is the rate the source comment
itself flags as unverified (`lib/pricing.mjs:10`) — it carries **$758, 8.4% of total spend**.

`server/index.mjs:902` computes `unpricedModels` and ships it at `:921` — **no file in `src/`
reads it.** The contract promised in `lib/pricing.mjs:23-25` ("surface the unpriced model list
alongside the total") is unhonoured.

**Verdict:** 0 unpriced, but generations are conflated and one rate is unverified; the honesty
escape hatch is computed and dropped on the floor.

## Q2. Cache tier coverage

- `cache_creation_input_tokens > 0`: **31,160**
- of those, carrying the nested split: **31,160 (100.0%)**
- carrying only the flat total: **0**
- split group date range: **2026-06-07 → 2026-07-29** (the entire corpus)
- `flat === 5m + 1h`: **0 mismatches / 31,162**

**Verdict:** never unknowable here — measured, not assumed. Keep a documented 5 m fallback for
transcripts older than the corpus; it is provably dead code on this machine.

## Q3. 1 h prevalence

| tier | tokens | share |
|---|---|---|
| `ephemeral_5m` | 47,885,986 | 38.1% |
| `ephemeral_1h` | 77,839,062 | **61.9%** |

Not a mix — a **clean partition by transcript type**:

| | files | records | 5 m tokens | 1 h tokens |
|---|---|---|---|---|
| subagent (`*/subagents/*.jsonl`) | 566 | 14,840 | 47,890,828 | **0** |
| main session | 328 | 16,324 | **0** | 77,839,660 |

Dollar impact of pricing 1 h at 2× instead of 1.25×:

| model | current | corrected | Δ |
|---|---|---|---|
| `claude-opus-4-8` | $6,366.03 | $6,979.37 | +9.63% |
| `claude-opus-5` | $750.92 | $843.10 | +12.28% |
| `claude-fable-5` | $662.46 | $758.34 | +14.47% |
| `claude-sonnet-5` | $443.68 | $456.37 | +2.86% |
| `claude-sonnet-4-6` | $12.83 | $14.94 | +16.50% |
| `claude-haiku-4-5` | $5.36 | $5.38 | +0.31% |
| **total** | **$8,241.27** | **$9,057.50** | **+$816.23 / +9.90%** |

Sonnet-5's small delta is an artifact of it being mostly a subagent model (all-5 m). Opus carries
the error.

## Q4. Subagent cost attribution

`historyEvents()` — `server/index.mjs:1398-1415`. Emits
`{ type, message, parent_tool_use_id, toolUseResult, timestamp }` (`:1392`) — **no usage, no
tokens, no cost anywhere in it or in `readTranscript()`**.

**We do not share CCAM's bug.** A subagent is given neither its own cost nor the session total,
because no cost is attributed at all. `ChatSection.jsx:44,74` shows `total_cost_usd` straight off
the CLI `result` event — the CLI's own figure, independent of `lib/pricing.mjs`.

`walkJ` (`:786`) recurses unconditionally, so every `subagents/*.jsonl` is parsed and tagged
`isAgent` (`:845`). Not double-counted, not excluded — **split, inconsistently**:

- **Included** (reads `all.entries`): `costSaved :900`, `cacheWasteCost :913`, `buildDailyUsage
  :914`, `computeUsageHealth :922`, `/api/gov/costs :2500,:2516`, `/api/chatstats :3046-3048`,
  `/api/roi :3324,:3341`, board run cost `:5188`.
- **Excluded** (reads `all.files`, filters `!f.isAgent`): `:903, :906, :968, :1259, :3030, :3374,
  :3536, :3580, :4168`.

The perfect 5 m/1 h partition in Q3 is direct evidence there is no double-count — if subagent usage
were echoed into the parent transcript, main files would carry 5 m tokens, and they carry zero.

**Verdict:** per-session rows silently omit 14,839 of 31,162 records' worth of cost while the
global KPI includes them.

## Q5. Where the editable rate table belongs

- **`config.json`** (gitignored) — `jiraAPIKey`, `email`. JIRA credentials only.
- **`projects.json`** (gitignored) — JIRA host, work calendar, story points, team emails.
- **`readMeta()` / `META_FILE`** — `server/index.mjs:666-668`, `~/.claude/dashboard-meta.json`.
  Free-form per-user blob already holding `tags`, `freezeAuditTicked`, `baselines`,
  `recsDismissed`, `inboxDone`, `notify`, `teamHarness`, pins. Written at ~12 sites, already
  injected into a mounted module at `:102`. Nothing cost-related today.

**Recommendation: `dashboard-meta.json` via `readMeta()`/`writeMeta()`.** A rate table is user
state, not repo config, and this is already the per-user store with a working read/write pair.

INFERRED constraint: keep `lib/pricing.mjs` **pure** — it has no `fs` import and is imported
directly by `test/lib/pricing.test.mjs:3`. Inject rates or add an explicit setter the server calls
after `readMeta()`; do not make the pure module read disk.

## Q6. Client dollar surfaces

**Fed by `entryCost()` — meaning changes:**
`InsightsSection.jsx:201` · `UsagePanel.jsx:29,88-93,95-97,109` · `SessionsSection.jsx:19` ·
`InboxSection.jsx:208,213` · `App.jsx:296` · `ReliabilitySection.jsx:354,362` ·
`BoardSection.jsx:257,270` (via `server/index.mjs:5082-5084`, `r.cost` from `:5188`) ·
`PlanGraph.jsx:171`

**From the CLI's own `total_cost_usd` — will NOT change:**
`ChatSection.jsx:44,74` · `TicketSection.jsx:630,646,668` · `RunsSection.jsx:67,75` ·
`QuickActions.jsx:33,131` · `ReliabilitySection.jsx:250-252`

**Verdict:** 8 surfaces move, 5 do not — and after the fix the two families will **visibly
disagree on the same screen**, because CLI-reported cost is already tier-correct. (That
disagreement is itself the proof the fix landed.)

## Q7. What breaks

**`test/lib/pricing.test.mjs`**
- `:31` `near(entryCost(entry({ cc: 1e6 })), 3.75)` — the only assertion encoding the cache-write
  ratio. Survives only if an entry with no tier fields falls back to 5 m/1.25×.
- `:5` the `entry()` helper builds `{ model, in, out, cc, cr }` with no tier fields, used by every
  `entryCost` test (`:22, :29-32, :72`) — tier fields must be optional.
- `:8-10` `PRICE_PER_M(m)` returning a bare number — breaks on any signature change.
- `:16-18` the `null` contract and `:22-26` unpriced → `0` never `NaN` — **must survive verbatim**;
  a user-supplied table must not introduce a default.
- `:38-74` `dedupeTurns` — untouched.

**Transitive**
- `lib/harness-usage-trends.mjs:44` — `weightedDelta += (p * 1.25 - p * 0.1) * w`, a **second
  hardcoded copy** of the ratios outside `lib/pricing.mjs`, feeding `UsagePanel.jsx:109`. **No test
  file exists for it.** Silently stays wrong unless changed deliberately.
- `test/server/eng-privacy.test.js:10` — `BANNED` includes `price|pricing|cost|usd|spend`. A rates
  endpoint must **not** live under `/api/eng/*` or `:70` fails.
- `test/lib/harness-health.test.mjs:14` and `test/lib/scheduler-dispatch.test.mjs:25-28` inject
  their own cost functions — unaffected, correctly.

**Verdict:** one assertion genuinely at risk; the real hazard is the untested duplicate at
`harness-usage-trends.mjs:44` that no test will catch.
