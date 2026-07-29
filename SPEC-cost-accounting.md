# SPEC — cost and token accounting correctness

> Implementation spec for the cost workstream. Turns `_SYNTHESIS.md` §1 (D1, D2), §7 Cluster B and
> §8 Tier 0 into shippable features, grounded in this repo's files.
> Written 2026-07-29 on branch `research/upstream-ecosystem-analysis`.
>
> **Everything numeric below was measured against a real corpus on this machine**, not inferred from
> upstream research. Where the research and our own data disagree, our data wins and the disagreement
> is called out. See [Evidence](#evidence--what-our-own-corpus-says) for the method.

---

## The one-paragraph version

Every dollar figure this app renders is derived from `entryCost()` (`server/index.mjs:1987`) over
entries built in `collectUsage()` (`server/index.mjs:681`). Both are wrong. `collectUsage()` pushes
one entry per JSONL line containing `"usage"` with no de-duplication, and **61.07% of the usage
records in our corpus are duplicates**. `PRICE_PER_M` (`server/index.mjs:718`) is a three-branch
regex whose Opus price is 3× Anthropic's, whose Fable price is 1.5× and whose Haiku price is 0.8×.
Combined, our all-time cost figure reads **$22,746.67 where the corrected figure is $3,542.14 — a
6.42× overstatement**. That number feeds the budget alert, the month-end projection, the anomaly
detector, the harness grade, the session ledger, `/api/roi`'s `$` per point, and the daily digest.
Two fixes, both small, both mechanical, close it. A third feature — labelling which figures are
*measured* and which are *estimated* — is the part nobody else in the ecosystem has, and we already
have the measured source wired in five places.

---

## Evidence — what our own corpus says

Method: two throwaway Node scripts walked `~/.claude/projects/**/*.jsonl` with exactly the parse gate
`collectUsage()` uses (`line.includes('"usage"')`, then `j.message.usage && j.message.model &&
j.timestamp`, skipping `<synthetic>`), and compared raw against de-duplicated aggregates under three
pricing models. Run 2026-07-29. The corpus grew slightly between runs (87,196 → 87,258 records), so
figures differ in the third significant digit across the table below; nothing material turns on it.

| Measurement | Value |
|---|---|
| Transcript files scanned | 1,283 |
| Usage records parsed (what `collectUsage()` counts today) | 87,258 |
| Records carrying `message.id` | 87,258 / 87,258 — **100%** |
| Records carrying `requestId` | 87,258 / 87,258 — **100%** |
| Distinct `message.id` | 33,972 |
| Distinct `message.id` + `requestId` | 33,933 (identical partition — see D1 note) |
| **Duplicate records** | **51,709 — 61.07%** |
| Duplicate groups where the later record is byte-identical | 35,098 |
| Duplicate groups where the later record differs | 16,611 |
| …of those, later record is **larger** | 16,611 |
| …of those, later record is **smaller** | **0** |
| `message.id`s appearing in more than one *file* | 1,143 |
| Total tokens counted today | 11,212,075,242 |
| Total tokens after global de-duplication | 4,451,890,766 (**2.52× inflation**) |
| `usage.cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens` present | 87,258 / 87,258 — **100%** |
| Rows where `5m + 1h ≠ cache_creation_input_tokens` | **0** |
| 1-hour-TTL share of cache-creation tokens (de-duplicated) | 55,150,492 / 150,056,691 = **36.75%** |
| Records carrying `usage.iterations[]` | 46,324 (53%) |
| Records where `iterations.length > 1` | **0** |
| Records with `isSidechain: true` (subagent) | 73% |
| Records in the last 30 days | 33,475 of 33,972 (98.5%) |

### Cost, decomposed

| Stage | All-time $ | vs. previous |
|---|---:|---|
| What we render today (raw records × `PRICE_PER_M`) | **22,746.67** | — |
| After global de-duplication (D1 fixed, prices still wrong) | 8,069.65 | ÷ 2.82 |
| After corrected per-model prices (D2 fixed, flat cache-write) | 3,253.40 | ÷ 2.48 |
| After 1-hour cache-TTL split (upstream #162 fixed pre-emptively) | **3,542.14** | × 1.089 |
| **Net error of the figure we display** | | **6.42× too high** |

Same comparison on the windows that actually drive alerts:

| Window | Today's figure | Corrected | Error |
|---|---:|---:|---:|
| Last 24h (drives `costAlerts` / `dailyUSD` cap) | $503.58 | $173.86 | 2.90× |
| Last 7d (drives `costProjection.dailyAvg`) | $1,467.63 | $532.04 | 2.76× |
| Last 30d | $7,941.40 | $3,490.05 | 2.28× |
| All time | $22,746.67 | $3,542.14 | 6.42× |

The all-time error is larger than the windowed error because de-duplication bites hardest on older,
fully-streamed sessions. **A user who set a `$20/day` cap is being alerted at roughly $7 of real
spend.** That is the concrete harm.

### Per-model price error, isolated

Both sides de-duplicated, so this table isolates D2 (plus the TTL fix) with D1 held constant:

| Model | De-duped records | Our $ | Corrected $ | Ratio |
|---|---:|---:|---:|---:|
| `claude-opus-5` | 3,047 | 977.14 | 339.32 | **2.88×** |
| `claude-opus-4-8` | 13,349 | 6,089.34 | 2,278.76 | **2.67×** |
| `claude-fable-5` | 900 | 324.37 | 237.39 | **1.37×** |
| `claude-sonnet-5` | 14,893 | 658.92 | 663.32 | 0.99× |
| `claude-sonnet-4-6` | 346 | 8.42 | 9.03 | 0.93× |
| `claude-haiku-4-5-20251001` | 1,437 | 11.45 | 14.32 | **0.80×** |

Directions match `_SYNTHESIS.md` D2 exactly. Magnitudes are below the headline 3×/1.5× because the
TTL correction pushes every row up by ~9%, and because Opus rows carry a heavy cache-read component
priced at 0.10× where the absolute error is smallest.

### Three corrections to the research, from our own data

1. **`usage.iterations[]` is a no-op for us.** `_SYNTHESIS.md` §8 Tier 0.1 says "sum
   `usage.iterations[]`". The field exists on 46,324 of our records but **`length > 1` occurs zero
   times**, and the single element always mirrors the top-level totals exactly. Summing it changes
   nothing today. Implement the summation anyway (it is three lines and future-proofs a schema we do
   not control) but **do not** claim it as a correctness win, and do not gate the release on it.
2. **`requestId` adds nothing as a dedupe key on our corpus** — keying on `message.id` alone and on
   `message.id + '|' + requestId` produce the *identical* partition (33,933 groups both ways). Use
   the compound key anyway as cheap insurance against a future schema where one API call is split
   across message ids, but expect zero measurable delta.
3. **Per-file de-duplication is not enough.** Upstream (`scanner.py:439–443`) dedupes within a file.
   We measured 1,143 `message.id`s that appear in **two or more transcript files** — the fingerprint
   of `claude --resume` / session forking replaying prior history into a new file. Per-file dedupe
   alone still leaves ~4.1% of records double-counted in every global aggregate.

Also worth recording, because it argues for the durable-store idea being real: **98.5% of our
retained records are less than 30 days old.** Claude Code has already pruned the rest. "All time" in
this app currently means "the last month".

---

# Features

Ordered by value ÷ effort. 1 and 2 are the fix; 3–5 are what make it safe and differentiated;
6–9 are the tail.

---

### 1. De-duplicate usage records by `message.id`

**Customer need.** A developer on a Max plan opens Harness → Usage to answer "am I about to blow my
budget". Today the app tells them they have spent $503 in the last 24 hours. The real figure is
$174. What they do about it: they either ignore the number (the common outcome, which makes the whole
panel decorative), or they change their behaviour based on a number that is 2.9× wrong. A user who
set a `$20/day` cap in Reliability → Costs is getting an `error`-level alert at roughly $7 of actual
spend, every day, forever. The alert has trained them to ignore alerts.

**Value to Loush.** This is the single largest correctness defect in the product and it is upstream
of everything else: token counts, cost, the harness grade, the anomaly detector, the 5-hour block,
`/api/roi`. Fixing it also fixes the *tokens* half of the problem for free — 2.52× on every token
figure the app renders, including the Overview KPI tile. It costs no dependency and no schema change,
and we can prove it worked with a number (61.07% → 0%).

**How the upstream repo does it today.** `phuryn/claude-usage` keeps a dict keyed on `message.id`
per file and writes the last record for each key, on the stated reasoning that the final streamed
record carries the final usage tallies (`scanner.py:324, 439–443`). It reinforces this with a
conditional `UNIQUE INDEX ON turns(message_id) WHERE message_id IS NOT NULL`, so `INSERT OR IGNORE`
becomes a second, structural dedupe. `phuryn/burnstop` calls the same rule one of its "two
load-bearing invariants". Neither handles the cross-file case. Our measurement that duplicates only
ever *grow* (16,611 growing, 0 shrinking) independently confirms upstream's keep-last choice is the
correct one.

**How we implement it here.**

Two layers, because our cache is per-file and our aggregates are global.

*Layer A — inside the per-file parse loop, `server/index.mjs:668–701`.* Replace the unconditional
`rec.entries.push(e)` at `:682` with a `Map` keyed on `` `${j.message.id}|${j.requestId || ''}` ``,
last write wins. Records with no `message.id` (none exist today, but the gate must not drop data if
that changes) go to a separate array and are always kept. At end of file, materialise
`rec.entries = [...byKey.values(), ...unkeyed]` and **compute `rec.{in,out,cc,cr,cost,msgs,toolCalls}`
and `rec.branches` from that final list** rather than accumulating them inside the loop at `:683–689`
— accumulating and then de-duplicating would leave the per-file totals still inflated. Bump the cache
version `rec.v` from `2` to `3` (`:667, :669`) so every cached record is invalidated on first boot
after the change; this is already the established idiom in that block.

*Layer B — the global pass, at the end of `collectUsage()`, `server/index.mjs:714`.* After
`all.entries.sort(...)`, collapse `all.entries` on the same key, keeping the last by timestamp. This
is the cross-file replay fix. 33,972 entries is trivial to `Map` over on every call; the existing
`HEAVY_TTL` response cache (`server/index.mjs:107–121`) already absorbs the repeat cost.

*Deliberate asymmetry, and it must be documented in a comment.* `all.files[].{cost,in,out,…}` stays
per-file-de-duplicated only. `/api/sessions` (`:3026–3048`) and `/api/roi` (`:3113–3141`) read those
per-file totals. If session A is forked into session B, both sessions legitimately incurred that
context, so charging both is defensible *per session* — but summing sessions then double-counts.
`/api/sessions` already emits `totals.cost` as a sum of rows (`:3048`); that total must be recomputed
from the globally-de-duplicated entry set, not from the rows, and the table must carry a footnote
naming the discrepancy. Do not silently pick one and hope.

*What not to touch.* `scanTranscripts()` (`:2299`) is a separate walker feeding the capability ledger
and prompt corpus; it counts prompts and invocations, not usage records, and needs no dedupe.

**Effort.** S. ~35 lines in one function plus a cache-version bump. No new dependency.

**Risks and unknowns.**
- Keeping the *last* record is correct only if later records are supersets. Verified on 16,611
  differing pairs, zero counter-examples — but that is one machine's corpus, one Claude Code version.
  The validation plan below re-asserts it as a test on a committed fixture.
- The cache-version bump forces a full re-parse of 1,283 files on first boot. On this machine that
  is a few seconds; on a large corpus it blocks the first `/api/usage`. `collectUsage()` is
  synchronous and called from the request path — this is a pre-existing hazard the bump makes
  briefly worse. Mitigation is out of scope here (it is upstream's serve-then-scan pattern); note it.
- Historical figures will drop by ~2.5–6×. Anyone who wrote down last month's number will think we
  broke something. Ship with a one-line note in the panel's footer for one release.

**Definition of done.**
- `collectUsage()` returns 33,972 entries against the fixture corpus where it previously returned
  87,258, and a `node --test` case in `test/server/` asserts an exact expected count over a committed
  multi-file fixture that contains: a streamed triple sharing one `message.id`, a byte-identical
  duplicate, and the same `message.id` present in two files.
- A second test asserts keep-last: given records for one `message.id` with `output_tokens` 10 then
  120, the surviving entry has 120.
- Records lacking `message.id` are retained, asserted by test.
- **Null/empty state:** a project directory with zero transcripts yields `entries: []` and every
  downstream figure renders `—`, never `$0.00`. Specifically `/api/usage` returns
  `activeBlock: null`, `costProjection: null`, `health.grade: null`; `/api/sessions` returns
  `totals: { cost: null, sessions: 0, out: null }` — *not* `cost: 0`, which today it would emit and
  which reads as "you have spent nothing" rather than "nothing has been measured".
- `/api/usage` payload gains `records: { raw, deduped, duplicatePct }` so the fix is observable from
  the UI and from a curl, not just from a test.

---

### 2. Replace `PRICE_PER_M` with a real pricing table in `lib/pricing.mjs`

**Customer need.** The same developer reads "$6,089 on Opus" in Insights → Cost by model. The real
figure is $2,279. They conclude Opus is unaffordable and route planning work to Sonnet — a decision
made on a number that is 2.67× wrong. Worse, the error is *not uniform across models*: Opus is
overstated, Haiku is understated, Sonnet is right. So the app's model-comparison bar chart — the
whole point of that panel — has the **relative ordering wrong**, which is the one thing a comparison
chart must get right. Today they have no way to notice; nothing on screen says the prices are a
regex.

**Value to Loush.** Cost accounting is the most crowded category in the ecosystem (~40 projects, four
with 8k–17.5k stars, per `ecosystem-landscape-scan.md`). We do not win it on features — we already
beat the field on projection, budget alerts, anomaly detection and the 5-hour block. We currently
*lose* it on being wrong. This restores parity on the one axis where being wrong is disqualifying,
and it is a ~90-line pure module in `lib/` with tests, which is exactly where this repo's conventions
say arithmetic belongs (`CONTRIBUTING.md`: "`lib/` is pure and tested").

**How the upstream repo does it today.** `cli.py:21–36` / `dashboard.py:735–750` hold a 12-entry
table of per-model, per-bucket USD-per-million rates, attributed to "Anthropic API pricing as of June
2026". `cli.py:38–56` resolves a model id through a four-stage cascade: exact key → prefix match →
family keyword (`fable|mythos` → Fable prices, `opus` → newest Opus, `sonnet`, `haiku`) → `None`.
`dashboard.py:752–757` gates on `isBillable()` so unknown/local models render a muted `n/a` rather
than `$0.0000` — a deliberate honesty choice that matches our own rule 1 word for word. Every row of
their table obeys `output = 5× input`, `cache_write = 1.25× input`, `cache_read = 0.10× input`, so
the whole table collapses to one input price per model plus three constants.

**How we implement it here.**

New file `lib/pricing.mjs`, pure, no imports, exporting:

```
INPUT_USD_PER_M      // { 'claude-fable-5': 10, 'claude-opus-4-8': 5, ... } — input price only
MULTIPLIERS          // { output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2.5, cacheRead: 0.10 }
resolveModel(model)  // -> { key, inputUsdPerM, matchedBy: 'exact'|'prefix'|'family', source } | null
entryCost(entry)     // -> { usd: number, priced: true } | { usd: null, priced: false, reason }
PRICING_AS_OF        // '2026-06' — the attribution date, rendered in the UI
```

`entryCost` returns an object, not a number, so "unpriced" is representable. This is the D2 fix and
the honesty fix in one signature. Today `PRICE_PER_M` returns `3` for *any* unrecognised model — a
local Ollama model, a proxy, a typo — silently pricing it as Sonnet. Note that `/opus|fable/` also
misses `mythos` entirely, which would fall through to the Sonnet default at 30% of its real price.

Call sites to convert, all in `server/index.mjs` unless noted:
- delete `PRICE_PER_M` (`:718`) and `entryCost` (`:1987`), import from `lib/pricing.mjs`
- `:684`, `:689` — per-file and per-branch cost accumulation
- `:764` — `costSaved`; currently `(e.cr / 1e6) * PRICE_PER_M(e.model) * 0.9`, i.e. it hardcodes the
  0.9 saving instead of deriving it from `MULTIPLIERS.cacheRead`
- `:775` — `cacheWasteCost(entries, PRICE_PER_M, …)`; `lib/harness-usage-trends.mjs:36–47` takes the
  price function as a parameter and hardcodes `1.25` and `0.1` inline at `:41`. Change it to take the
  `MULTIPLIERS` object so there is exactly one place those constants live.
- `:776`, `:784` — `buildDailyUsage` / `computeUsageHealth`, both already parameterised on `costFn`
- `:1994`, `:2010`, `:2540`, `:2542`, `:2818`, `:2835`, `:3037`, `:4682` — see the blast radius table

**Side effect worth having:** `entryCost` is currently a `const` arrow at `:1987` *used* at `:684`
inside `collectUsage()`. It only works because every call happens after module evaluation. This repo
has already been bitten by exactly that pattern — see the comment at `server/index.mjs:70–74`
documenting a temporal-dead-zone bug that a `catch` turned into a confident wrong answer. Moving
pricing into an imported module removes the hazard.

**On our corpus, 52.8% of records are on models no researched table names.** `claude-sonnet-5`
(14,893 records) and `claude-opus-5` (3,047) do not appear in phuryn's table, which stops at
`opus-4-8` / `sonnet-4-7`. They resolve only via the family-keyword fallback, at `opus` = $5/M and
`sonnet` = $3/M. **Those two prices are unverified.** Do not present them as facts — see
[Open questions](#open-questions-for-the-maintainer) and the `matchedBy: 'family'` flag above, which
exists so the UI can say so.

**Effort.** S for the module and the mechanical call-site swap. Add ~half a day for the UI changes
that `priced: false` now makes possible (see feature 3's DoD and the provenance section).

**Risks and unknowns.**
- The prices are transcribed from upstream's table, attributed to "Anthropic API pricing, June 2026",
  and **not independently re-verified against `claude.com/pricing` in this pass**. They are certainly
  closer than what we ship. Treat `PRICING_AS_OF` as load-bearing metadata, not decoration.
- Subscription users are not billed these prices at all. Reliability → Costs already says so
  (`src/sections/ReliabilitySection.jsx:325`); every other surface does not.
- A model id we cannot resolve now renders `—` instead of a number. Some panels sort or sum on cost
  and will need a `null` guard. That is the point, and it is where regressions will hide.

**Definition of done.**
- `lib/pricing.mjs` exists with a `test/lib/pricing.test.mjs` asserting, at minimum:
  `entryCost({ model: 'claude-opus-4-8', in: 1e6, out: 0, cc: 0, cr: 0 })` → `{ usd: 5.00, priced: true }`;
  the four multipliers exactly; that `claude-sonnet-4-6-20260514` resolves by prefix;
  that `claude-mythos-5` resolves to Fable prices (today's regex misses it);
  that `llama-3-70b` returns `{ usd: null, priced: false }` and **not** `3`.
- `grep -n "PRICE_PER_M" server/ lib/ src/` returns nothing.
- `/api/gov/costs` `byModel` for our corpus shows Opus ≈ $2,279 not $6,089, asserted against a
  committed fixture.
- **Null/empty state:** an unpriced model renders `—` with a hover reading "no published price for
  `<model>` — tokens are counted, cost is not". It never renders `$0.00`. A `byModel` chart
  containing an unpriced model shows the row with a `—` cost cell rather than dropping the row, so
  the tokens do not silently vanish. If *every* model in a window is unpriced, the cost KPI is `—`
  and the panel says "cost unavailable for the models in this window", not "$0.00".

---

### 3. Split cache-creation by TTL — port upstream's bug already fixed

**Customer need.** Nobody is asking for this by name. What they are asking is "why does my cache cost
so much" — and the answer they get is 9% too small, systematically, in the one bucket they have any
control over. The Cache TTL impact panel (`src/sections/UsagePanel.jsx:103–114`) exists specifically
to tell them how much cache re-writes cost. It is understating its own subject.

**Value to Loush.** Upstream ships this bug today (their issue #162, open, PR #163 open, measured
9.6% total understatement); `ccusage` shipped it too (their #899, ~19%) and has since fixed it. We
can land the port **already correct**, which is a concrete, checkable claim of being more accurate
than the 2,082-star reference implementation, on a feature that costs about fifteen lines. Cheapest
credibility in the batch.

**How the upstream repo does it today.** `scanner.py:408` reads only the aggregate
`cache_creation_input_tokens` and discards the `cache_creation.{ephemeral_5m,ephemeral_1h}` breakdown
the API already returns. `cli.py:66` then applies one flat `cache_write` rate. On a 425-file /
81k-record corpus the reporter measured 78.0% of cache-creation tokens as 1-hour TTL, billed at 2×
the 5-minute rate, making their cache-write line 49.4% low and their total 9.6% low.

**How we implement it here.**

`server/index.mjs:681` currently reads `cc: u.cache_creation_input_tokens || 0`. Add two fields:

```
cc5:  u.cache_creation?.ephemeral_5m_input_tokens ?? null,
cc1h: u.cache_creation?.ephemeral_1h_input_tokens ?? null,
```

Keep `cc` as the aggregate — it is what every existing token consumer reads. In `lib/pricing.mjs`,
price cache-creation as `cc5 × 1.25 + cc1h × 2.5` when both are non-null, and fall back to
`cc × 1.25` when either is null, setting `ttlSplit: false` on the returned object so the UI can say
the figure is the conservative one.

**We verified the fields exist before specifying this**, per the research note's own instruction:
present on **87,258 of 87,258 records (100%)**, and `5m + 1h` equals `cache_creation_input_tokens`
exactly on every one of them (zero mismatches). The fallback branch is defensive only.

**Our 1-hour share is 36.75%, not upstream's 78%.** Do not reuse their figure in our copy. The effect
on our corpus is +8.9% on total cost ($3,253.40 → $3,542.14), close to their measured +9.6% despite
the very different split, because their corpus is more cache-write-heavy relative to its total.

The 2.5× multiplier for 1-hour cache-write is `1.25 × 2`, from Anthropic's documented 2× premium for
the 1-hour TTL. **Not independently re-verified in this pass** — mark it `unverified` in the module
comment alongside the price table's `PRICING_AS_OF`.

**Effort.** S. Two parse fields, one branch in `entryCost`, one label.

**Risks and unknowns.**
- The 2× premium is transcribed, not verified. If it is wrong, the error is bounded at ±9% of total —
  smaller than either D1 or D2, and in a bucket we now label.
- `cacheWasteCost` (`lib/harness-usage-trends.mjs:36–47`) computes a blended `avgPriceDelta` of
  `(1.25 − 0.1) × price`. With a TTL split the delta differs per bucket. Either weight it by the
  observed 5m/1h mix or leave it flat and label the panel's figure a lower bound. Flat-and-labelled
  is the smaller change and the honest one; prefer it.

**Definition of done.**
- `entryCost` on a fixture entry with `cc5: 1e6, cc1h: 1e6` at Opus prices returns
  `1e6×5×1.25/1e6 + 1e6×5×2.5/1e6 = 6.25 + 12.50 = 18.75`, asserted by test.
- `/api/usage` exposes `cacheTtl.oneHourPct` (36.75 on our corpus) so the number is visible, not
  buried in the cost.
- **Null/empty state:** when `cache_creation` is absent or partial, `ttlSplit: false` propagates to
  the UI, which appends "5-minute rate assumed" to the Cache TTL panel's subtitle. It does **not**
  silently fall back and present the result as if the split were known. When there are no
  cache-creation tokens at all in the window, the panel reads "no cache writes in this window" rather
  than "0%" — the existing panel would render `0%` today.

---

### 4. Provenance — label every figure `measured` or `estimated`

This is the differentiator. It has its own section below, [Measured vs estimated: the
design](#measured-vs-estimated-the-design), because the API surface needs more room than this
template allows. Summary in template form:

**Customer need.** A user looking at "$0.412" on a Ticket run and "$503.58" on the Usage panel has no
way to know that the first is Claude Code's own billed figure, accurate to the cent, and the second
is our arithmetic over a log Anthropic's own docs call approximate. They trust both equally, or
distrust both equally. Either is wrong.

**Value to Loush.** Across the 16 researched projects, **no project distinguishes exact from
estimated cost.** Every one of them presents a computed number with a footnote disclaimer, usually at
the bottom of the page (upstream's own issue #145 is Max users misreading their estimate as their
bill, precisely because the disclaimer is at the bottom). We already ingest the exact figure in five
places and throw the distinction away. Surfacing it costs one field in the payload and one UI
primitive, and it is the direct extension of the honesty rule the README already stakes the product
on: `null` is never `0`; *estimated* is never *measured*.

**How the upstream repo does it today.** It does not. The closest analogue in the ecosystem is
`ccusage`'s cost modes (`auto` / `calculate` / `display`), which *prefers* Claude's own `costUSD`
field when present but does not tell the reader which mode produced any given cell.

**How we implement it here.** `lib/pricing.mjs` returns a provenance tag; `server/` propagates it;
`src/ui/Money.jsx` renders it. Full spec below.

**Effort.** M — small individually, but it touches ~20 render sites.

**Risks and unknowns.** Visual noise if every dollar sign grows a badge. The design below solves this
by making `estimated` the quiet default and `measured` the marked case, since measured is rarer.

**Definition of done.** In the design section.

---

### 5. Precision and formatting discipline

**Customer need.** `/api/sessions` emits `cost: +f.cost.toFixed(4)` (`server/index.mjs:3037`) —
four decimal places on a figure that is currently 6.42× wrong and, once fixed, still rests on a log
Anthropic calls approximate. Four decimals is a claim of sub-cent accuracy. The user reads
`$0.0417` and believes it.

**Value to Loush.** Free credibility. A number's format is a claim about its precision, and ours
currently over-claims by three orders of magnitude. Also removes a specific thing the brief flags as
not-to-port from Stargx.

**How the upstream repo does it today.** phuryn uses 4 decimals for per-row costs and 2 for the
headline, and exports `cost.toFixed(4)` to CSV. Same over-claim. **Do not port it.**

**How we implement it here.** One formatter in `src/ui/Money.jsx` (feature 4's component):
- estimated figures: 2 decimals, and `< $0.01` renders `<$0.01`, never `$0.0000`
- measured figures (`total_cost_usd`): 3 decimals is defensible — it is what Claude Code reports
- server-side: stop rounding in the payload. `server/index.mjs:3037` should emit the full float and
  let the client format. Rounding at the API boundary means aggregates built from rows accumulate
  rounding error — `:3048` sums already-rounded rows.

Sites: `server/index.mjs:3037` (`toFixed(4)`), `:3048`, `:3146`, `:3159`, `:3181–3188`;
`src/sections/SessionsSection.jsx:122`; `src/sections/UsagePanel.jsx:29, 109, 126`;
`src/sections/InsightsSection.jsx:92, 117, 119`; `src/sections/ReliabilitySection.jsx:331, 355, 362`;
`src/sections/InboxSection.jsx:208, 213`.

Note `src/sections/SessionsSection.jsx:91` renders `'$' + fmtTok(usage.kpis.costSaved)` — running a
dollar value through the *token* formatter, so $1,234 displays as `$1.2k`. That is a separate small
bug in the same family; fix it here.

**Effort.** S.

**Risks and unknowns.** None material. Watch for panels that sort on the rendered string rather than
the numeric field.

**Definition of done.**
- No `toFixed(4)` on any USD value in `server/` or `src/`.
- A cost of `0.0004` renders `<$0.01`, asserted in a component test.
- **Null/empty state:** `null` renders `—`; `0` renders `$0.00` only when there genuinely were priced
  entries summing to zero, which for a non-empty window is essentially impossible and should be
  treated as a bug signal, not a display case.

---

### 6. Local-date day keys

**Customer need.** A user in UTC+3 sees "today's spend" reset at 03:00 local, and a day's costs
attributed to the previous calendar day. They will notice this as "the dashboard's daily numbers do
not match when I actually worked" and will not be able to articulate why.

**Value to Loush.** Small, but it is a *correctness* bug in the same subsystem, it is 40 lines, and
it is already flagged as Tier 1.8 in `_SYNTHESIS.md`. Bundling it with the cost fix means one
regression pass over the daily aggregates instead of two.

**How the upstream repo does it today.** `dashboard.py:889–891` defines `localISODate()` and uses it
everywhere instead of `toISOString()`. They shipped this as a fix for their issue #151, where
calendar ranges leaked the previous month for UTC+ users.

**How we implement it here.** Add `localISODate(t)` to `lib/` (new `lib/dates.mjs`, or alongside
pricing). Replace `new Date(t).toISOString().slice(0, 10)` at `server/index.mjs:742` (`dayOf`, which
feeds the whole daily series, the heatmap, the streak and `costProjection`), `:1990`, `:1994`
(`costAlerts` "today"), `:2010` (`/api/gov/costs` `byDay`), `:2551` (`/api/chatstats` `activeDays`),
`lib/harness-usage-trends.mjs:4` (`dayKey`, feeding cache map, anomalies and month-end projection).
Leave `/api/roi`'s ISO-week helper (`server/index.mjs:3127`) on UTC — it is explicitly UTC-anchored
and consistent with the JIRA side.

**Effort.** S.

**Risks and unknowns.** Changes which day a boundary entry lands in. Anomaly detection compares a day
against a 7-day trailing baseline, so a one-off shift at the changeover could produce a spurious
anomaly on the release day. Acceptable; note it.

**Definition of done.**
- No `toISOString().slice(0, 10)` remains in `server/index.mjs` or `lib/harness-usage-trends.mjs`
  except the deliberately-UTC `wk()` at `:3127`, which carries a comment saying so.
- A test with `TZ=Asia/Riyadh` and an entry at `23:30` local asserts it lands on the local date.
- **Null/empty state:** unchanged — an empty day is absent from the map and renders as a gap, not a
  zero-cost day. `projectMonthEnd` already requires ≥3 sampled days and returns `null` below that;
  that guard must survive the change.

---

### 7. Regression guards for what we already get right

**Customer need.** None directly. This exists so features 1–3 do not quietly regress.

**Value to Loush.** Two of upstream's three open cost bugs are things **we already do correctly**,
and there is nothing in the repo asserting that. Specifically: upstream's issue #160 (sessions,
projects and branches priced at the session's *modal* model) does not apply to us — our `entryCost`
is per-entry and `f.cost` at `server/index.mjs:3037` is a sum of per-entry costs, so a Sonnet subagent
inside an Opus session is already priced correctly. Likewise `/api/gov/costs` (`:2008–2014`) and
`/api/chatstats` (`:2542`) price per entry before aggregating, which is the exact discipline upstream
had to ship a fix for (their #151). Untested invariants get refactored away.

**How the upstream repo does it today.** It does not have these guards, which is why it has these
bugs.

**How we implement it here.** Two tests in `test/lib/pricing.test.mjs`:
- Given a two-entry session, one Opus and one Haiku, assert the session cost equals the sum of the
  two per-model costs and **not** the total tokens priced at either model.
- Given a day with entries from three models, assert `buildDailyUsage`'s daily cost equals the sum
  of per-entry costs.

Plus one in `test/server/`: a golden-file assertion that `collectUsage()` over the committed fixture
produces an exact `{ records, tokens, cost }` triple. Any change to parsing, dedupe or pricing that
moves the number has to move the golden file deliberately.

**Effort.** S.

**Risks and unknowns.** The golden file needs regenerating whenever prices legitimately change. Put
the regeneration command in a comment at the top of the test.

**Definition of done.** Three tests, green, and the golden file committed under `test/fixtures/`.

---

### 8. Surface unknown models instead of guessing

**Customer need.** A user running a local model through a proxy, or on a Claude model newer than our
table, sees a cost. It is fabricated — today every unrecognised model is priced as Sonnet. They have
no way to know.

**Value to Loush.** Directly serves honesty rule 1, and it is the mechanism by which our pricing table
ages gracefully instead of silently rotting. **On our own corpus, 52.8% of de-duplicated records are
on `claude-sonnet-5` / `claude-opus-5`, which resolve only by family-keyword fallback** — so this is
not a hypothetical about exotic setups, it is the majority of our own data.

**How the upstream repo does it today.** `isBillable()` (`dashboard.py:752–757`) gates on the family
keywords and renders a muted `n/a`. Note their Python and JS implementations disagree on whether the
gate runs before or after price lookup — functionally equivalent today, a real asymmetry to avoid
reproducing.

**How we implement it here.** `resolveModel()` already returns `matchedBy`. Add to `/api/usage` a
`pricing: { asOf, models: [{ model, records, matchedBy, inputUsdPerM }] }` block, and render a single
line in the UsagePanel footer: *"N models priced by family fallback — `claude-opus-5` is billed at
the generic Opus rate, which we have not verified."* One line, only shown when
`matchedBy === 'family'` occurs. Allow a per-model price override in the existing global settings
file so a user with a known contract price can correct it without a code change.

**Effort.** S/M — the resolver and payload are S; the settings override adds a write path that must
go through `safe()` + `backup()` per `CONTRIBUTING.md`.

**Risks and unknowns.** A user-supplied override means our "correct" figure becomes user-dependent.
Tag those entries `matchedBy: 'override'` so the provenance layer can show it.

**Definition of done.**
- `/api/usage` carries the `pricing` block; the family-fallback line appears for our corpus (it will,
  for `claude-sonnet-5` and `claude-opus-5`) and disappears when every model matches exactly.
- **Null/empty state:** with no entries, the `pricing.models` array is `[]` and the line is absent —
  not "0 models priced by fallback".

---

### 9. Ingest exact cost and rate limits from the statusLine payload

**Customer need.** "How much of my 5-hour window is left" is the question the Overview 5h tile
gestures at and cannot answer — it shows output tokens and a reset countdown, with no denominator.
Anthropic publishes the answer exactly, as `rate_limits.{five_hour,seven_day}`.

**Value to Loush.** Turns our best-in-class 5-hour block computation (`server/index.mjs:719–740`,
which `_SYNTHESIS.md` confirms no surveyed project matches) from an activity readout into a real
quota gauge, using ground truth rather than a calibrated estimate we would have to chase.

**How the upstream repo does it today.** phuryn has no plan model at all. `uppinote20` reads
`cost.total_cost_usd` and `stdin.rate_limits.{five_hour,seven_day}` from the statusLine stdin
payload. `Maciek-roboblog/Claude-Code-Usage-Monitor` now reads the official statusline `rate_limits`
too.

**How we implement it here.** These fields are **not in transcript files** — a pure filesystem reader
cannot reach them. Reaching them requires installing a statusLine command that writes its stdin to a
sidecar file we then read. That is a config write into `~/.claude/settings.json`, which must go
through `safe()` + `backup()` + `track()`, and it is opt-in by definition: we would be modifying the
user's Claude Code configuration to gain telemetry about them.

**Do not build this as part of the cost-correctness work.** It is a separate product decision with a
consent surface. Specified here so the provenance design (feature 4) has a defined third source and
does not have to be redesigned when this lands.

**Correction to the research, from our code:** `_SYNTHESIS.md` §1 says the exact figure is reachable
"only on the statusLine stdin payload". That is true for *passive* observation. It is **not** the
only source we have. For any run *we* spawn, `claude -p --output-format stream-json` emits a `result`
event carrying `total_cost_usd`, and we already read it in five places:
`server/index.mjs:1032` (quick actions), `:1972` (eval suite), `:3500` (review);
`server/ticket.mjs:385`; `lib/agent.mjs:41`. Those figures are exact today and are being rendered
next to estimates with no distinction. Feature 4 is therefore shippable **now**, without feature 9.

**Effort.** M, and gated on a consent design.

**Risks and unknowns.** Writing a statusLine command into user config to collect data is a posture
change for a product whose pitch is passive observation. Needs the maintainer's call.

**Definition of done.** Out of scope for this spec beyond the provenance contract. If built: the 5h
tile shows `used / limit` with a real denominator when the sidecar exists, and shows exactly what it
shows today — tokens and a countdown, with no invented denominator — when it does not.

---

## The blast radius of D2

Every place a **dollar figure** derived from `PRICE_PER_M` / `entryCost` currently reaches a user.
All are wrong today by the factors in the [Evidence](#evidence--what-our-own-corpus-says) tables
(6.42× all-time, 2.9× on a 24-hour window). Ordered server-first, then the UI that renders each.

### Producers — `server/` and `lib/`

| # | `path:line` | What it computes | Consumed by |
|---|---|---|---|
| P1 | `server/index.mjs:718` | `PRICE_PER_M` — **root of D2** | everything below |
| P2 | `server/index.mjs:1987` | `entryCost` — the formula, **root of D2** | everything below |
| P3 | `server/index.mjs:684` | `rec.cost` per transcript file | `/api/sessions`, `/api/context` |
| P4 | `server/index.mjs:689` | `rec.branches[br].cost` per git branch | `/api/roi` |
| P5 | `server/index.mjs:710` | per-file `cost` exported on `all.files[]` | P3, P4 consumers |
| P6 | `server/index.mjs:764` | `costSaved` — cache-read savings estimate | Sessions KPI |
| P7 | `server/index.mjs:775` | `cacheTtl.wasteCost` via `cacheWasteCost` | Usage panel |
| P8 | `server/index.mjs:776` | `buildDailyUsage(entries, entryCost)` → daily cost map | anomalies, projection |
| P9 | `server/index.mjs:778–780` | `costProjection` — MTD, daily avg, month-end, budget delta | Usage panel |
| P10 | `server/index.mjs:784` | `computeUsageHealth(entries, entryCost, …)` → the **A–F grade** | Usage panel, Overview |
| P11 | `server/index.mjs:787` | `anomalies[].cost` and `costRatio` | Usage panel |
| P12 | `server/index.mjs:1994` | `costAlerts` `todayUSD` — **compared against the user's `dailyUSD` cap** | Reliability, Inbox, recs |
| P13 | `server/index.mjs:1998` | the alert string itself, `'$' + val.toFixed(2)` | Reliability, Inbox |
| P14 | `server/index.mjs:2010–2013` | `/api/gov/costs` `byDay.usd`, `byProj.usd`, `byModel.usd` | Reliability → Costs |
| P15 | `server/index.mjs:2141` | recommendation text embedding the cost alert | Recommendations |
| P16 | `server/index.mjs:2712` | Inbox budget item embedding the cost alert | Inbox |
| P17 | `server/index.mjs:2540` | `/api/chatstats` `cost` | Insights |
| P18 | `server/index.mjs:2542` | `/api/chatstats` `byProj`, `byModel` — **the model comparison chart** | Insights |
| P19 | `server/index.mjs:2561` | `costPerChat` | Insights |
| P20 | `server/index.mjs:2818` | `/api/digest` `byProj[].cost` | Inbox → digest |
| P21 | `server/index.mjs:2835` | `/api/digest` total `cost` | Inbox → digest |
| P22 | `server/index.mjs:3037` | `/api/sessions` per-session `cost`, **`toFixed(4)`** | Sessions table |
| P23 | `server/index.mjs:3048` | `/api/sessions` `totals.cost` (sums already-rounded rows) | Sessions KPI |
| P24 | `server/index.mjs:3131` | `/api/roi` `total` — branch spend | ROI headline |
| P25 | `server/index.mjs:3136–3138` | `/api/roi` `spendByTicket[].cost`, `attributed` | ROI cohorts |
| P26 | `server/index.mjs:3146` | `/api/roi` `trend[].spend` and `perPoint` | Delivery → $ per point |
| P27 | `server/index.mjs:3159` | `/api/roi` `cohort[].medianSpend` | Delivery cohort table |
| P28 | `server/index.mjs:3176–3186` | `/api/roi` `cohortSpend`, `spendPerPoint`, `spendPerPointBasis`, `selfSpendOverTeamPoints`, `attributedPct` | Delivery headline |
| P29 | `server/index.mjs:4682` | `joinRunCost` → per-run `cost` (time-window join) | Runs |
| P30 | `lib/harness-usage-trends.mjs:36–47` | `cacheWasteCost`; **hardcodes `1.25` and `0.1` at `:41`** | P7 |
| P31 | `lib/harness-usage-trends.mjs:53–61` | `buildDailyUsage` daily cost accumulation | P8 |
| P32 | `lib/harness-usage-trends.mjs:78` | anomaly `cost` rounded to 2dp | P11 |
| P33 | `lib/harness-usage-trends.mjs:91–113` | `projectMonthEnd` — projected, MTD, dailyAvg, diff | P9 |
| P34 | `lib/harness-health.mjs:18–32` | `scoreCostTrend` — 40% of the harness grade | P10 |

### Renderers — `src/`

| # | `path:line` | Rendered as | Fed by |
|---|---|---|---|
| R1 | `src/sections/UsagePanel.jsx:29` | `fmtCost` — `$` with 0 decimals | P9 |
| R2 | `src/sections/UsagePanel.jsx:90` | month-end projection headline | P9 |
| R3 | `src/sections/UsagePanel.jsx:92` | MTD + daily avg × days remaining | P9 |
| R4 | `src/sections/UsagePanel.jsx:97` | over/under budget by `$X` | P9 |
| R5 | `src/sections/UsagePanel.jsx:109` | `est. $X spent on cache re-writes` | P7 |
| R6 | `src/sections/UsagePanel.jsx:126` | anomaly `cost` column | P11 |
| R7 | `src/sections/UsagePanel.jsx:52–67` | the A–F grade and `costTrend` factor | P10, P34 |
| R8 | `src/sections/SessionsSection.jsx:19` | `cost` sort column | P22 |
| R9 | `src/sections/SessionsSection.jsx:85` | total spend KPI | P23 |
| R10 | `src/sections/SessionsSection.jsx:86` | `$X median-ish per session` | P23 |
| R11 | `src/sections/SessionsSection.jsx:91` | cache-saved KPI — **also formats $ with `fmtTok`** | P6 |
| R12 | `src/sections/SessionsSection.jsx:122` | per-session `$`, gold above `$20` — **threshold is on a 6× figure** | P22 |
| R13 | `src/sections/InsightsSection.jsx:92` | Cost KPI + `$ / chat` | P17, P19 |
| R14 | `src/sections/InsightsSection.jsx:117` | **Cost by model bars — relative ordering is wrong** | P18 |
| R15 | `src/sections/InsightsSection.jsx:119` | Cost by project bars | P18 |
| R16 | `src/sections/ReliabilitySection.jsx:325` | the only "estimated" disclaimer in the app | — |
| R17 | `src/sections/ReliabilitySection.jsx:331` | Today `$` KPI | P12 |
| R18 | `src/sections/ReliabilitySection.jsx:332` | Daily `$` cap, next to a 2.9×-inflated actual | P12 |
| R19 | `src/sections/ReliabilitySection.jsx:314, 345` | daily `$` bar chart + tooltips | P14 |
| R20 | `src/sections/ReliabilitySection.jsx:352–355` | spend by project | P14 |
| R21 | `src/sections/ReliabilitySection.jsx:359–362` | spend by model | P14 |
| R22 | `src/sections/ReliabilitySection.jsx:342` (alerts block) | budget alert banners | P13 |
| R23 | `src/sections/InboxSection.jsx:208` | digest `cost` line | P21 |
| R24 | `src/sections/InboxSection.jsx:213` | digest per-project `$` | P20 |
| R25 | `src/sections/RunsSection.jsx:67, 75` | `est. cost` KPI across runs | P29 |
| R26 | `src/sections/RunsSection.jsx:190` | per-run `est. cost` (already tooltipped as estimated) | P29 |
| R27 | `src/sections/DeliverySection.jsx:160` | `$ per point` weekly bars + tooltip | P26 |
| R28 | Delivery ROI headline (`$` per point, spend basis) | `spendPerPoint`, `spendPerPointBasis` | P28 |

**28 render sites across 7 sections, fed by 34 producer sites across 3 files.** Every one is
currently wrong. Features 1 and 2 fix all 28 at once because all 28 funnel through P1/P2 — which is
the argument for doing them before anything else in the cost workstream.

### Not affected by D2 — these dollar figures are already exact

These read `total_cost_usd` straight from Claude Code and must **not** be routed through
`lib/pricing.mjs`. They are the `measured` half of feature 4.

| `path:line` | Source |
|---|---|
| `server/index.mjs:1032` → `src/sections/QuickActions.jsx:33, 131` | `result.total_cost_usd` |
| `server/index.mjs:1972, 1980` → `src/sections/ReliabilitySection.jsx:190, 209` | eval-suite `total_cost_usd` |
| `server/index.mjs:3500` | review `total_cost_usd` |
| `server/ticket.mjs:385` → `src/sections/TicketSection.jsx:25, 499, 630, 646, 668` | ticket-run `total_cost_usd` |
| `lib/agent.mjs:41` → `server/index.mjs:4123` → `src/sections/BoardSection.jsx:188, 191, 245, 257, 270` | board-run `total_cost_usd` |
| `src/sections/ChatSection.jsx:44, 74` | streamed `result` event |
| `src/ticket/DesignChat.jsx:57, 100` | design-chat `total_cost_usd` |

### Token counts — wrong from D1 only, 2.52× inflated

D2 does not touch these; D1 does. Listed because the D1 fix will move them and a reviewer needs to
expect it.

| `path:line` | What |
|---|---|
| `server/index.mjs:722–726` | `perModel.{msgs,out,in,cache}` → Usage "most used models" |
| `server/index.mjs:729–739` | **`activeBlock`** — 5-hour block `msgs/out/in`, rendered `src/sections/Overview.jsx:207–208` |
| `server/index.mjs:744` | `daily[].{out,msgs,tools}` → 18-week heatmap, sparklines, streak |
| `server/index.mjs:782` | `totalMsgs` |
| `server/index.mjs:791–792` | `toolCallsTotal`, `cacheReadTok` |
| `server/index.mjs:823–826` | `/api/projects` per-project `out/in/cache/msgs` + 14-day sparkline |
| `server/index.mjs:1399` | live context `usedTokens` — **takes the *last* entry, which today may be a partial streaming record** |
| `server/index.mjs:2011–2013` | `/api/gov/costs` `tok` per day/project/model |
| `server/index.mjs:2560` | `/api/chatstats` `tokIn` / `tokOut` |
| `server/index.mjs:3034–3038` | `/api/sessions` `out`, `in`, `cacheRead`, `cacheReadPct` |
| `server/index.mjs:3074–3077` | `/api/context/sessions` `turns`, `peak` |
| `server/index.mjs:3088–3096` | `/api/context/:id` per-turn series — **duplicates render as extra turns, and the compaction heuristic `total < prev * 0.6` will fire falsely on a partial** |
| `lib/harness-health.mjs:35–58` | cache efficiency + context efficiency — 60% of the harness grade |
| `lib/harness-health.mjs:77–99` | `computeRegression` tokens-per-turn |

The `/api/context` entry deserves emphasis: it is the only place where D1 produces a *qualitatively*
wrong answer rather than a scaled one. A partial streaming record with a small `cache_read` followed
by the full record satisfies `total < prev * 0.6` in reverse and can paint a compaction marker on a
turn where no compaction happened.

---

## Measured vs estimated: the design

The synthesis's claim is that correcting the table is table stakes and *distinguishing* exact from
estimated is the differentiator, because no surveyed project does it. Verified against our own code:
we already hold exact figures in five modules and render them in seven components with no visual or
semantic distinction from estimates. This section specifies the fix.

### The three sources, ranked

| Tier | Source | Where it comes from | Accuracy | Reachable today |
|---|---|---|---|---|
| **1 — measured** | `result.total_cost_usd` from `claude -p --output-format stream-json` | Claude Code's own billing arithmetic | exact, to the cent | **yes** — 5 modules already read it |
| **2 — reported** | `stdin.cost.total_cost_usd` + `rate_limits.{five_hour,seven_day}` on the statusLine payload | Claude Code | exact | **no** — requires a statusLine install (feature 9) |
| **3 — estimated** | `lib/pricing.mjs` over de-duplicated transcript entries | our arithmetic over a log Anthropic documents as approximate | order-of-magnitude | yes — this is everything else |

There is no tier 0. We never see the actual invoice, and for a Pro/Max subscriber tier 3 is a
counterfactual — API list price applied to flat-rate usage. The UI must be able to say that.

### The payload contract

Every cost-bearing field becomes an object rather than a bare number. The field name does not change,
so no consumer breaks structurally — they break *loudly*, on rendering `[object Object]`, which is
the desired failure mode for a change this consequential.

```
{
  usd: 3542.14 | null,
  basis: 'measured' | 'estimated',
  // 'estimated' only:
  pricedRecords: 33972,        // entries that resolved to a price
  unpricedRecords: 0,          // entries counted in tokens, absent from usd
  ttlSplit: true,              // false => cache-creation priced at the flat 5m rate
  familyFallback: ['claude-opus-5', 'claude-sonnet-5'],  // models priced by keyword, unverified
  pricingAsOf: '2026-06',
  // 'measured' only:
  source: 'result.total_cost_usd'
}
```

`usd: null` is the honest empty state and is distinct from `usd: 0`. Rule 1 of the README, applied to
money.

A helper in `lib/pricing.mjs` builds these so no route hand-rolls one:

```
estimated(entries)        -> the object above, basis: 'estimated'
measured(usd, source)     -> { usd, basis: 'measured', source }
```

### The component

`src/ui/Money.jsx` — one component, used at all 28 render sites plus the 7 measured ones.

```
<Money value={payloadObject} size="kpi" | "cell" | "inline" />
```

Rendering rules:

- **Estimated is the quiet default.** No badge, no icon. 2 decimals. `<$0.01` below a cent. The
  numeral is rendered in the same weight as any other number. Estimates are the overwhelming majority
  and badging all of them is visual noise that trains the eye to skip the badge.
- **Measured is the marked case.** A small `✓` glyph before the numeral, and 3 decimals — the extra
  digit is itself the signal, and it is honest because Claude Code reports that precision. Title
  attribute: *"billed figure reported by Claude Code for this run"*.
- **Every estimate carries its provenance in the title attribute**, not in the layout:
  *"estimated — Anthropic list prices as of 2026-06 applied to 33,972 de-duplicated transcript
  records. Subscription users are not billed this."* One hover, the whole story. This is where the
  disclaimer belongs — attached to the number, not at the bottom of the page. Upstream's issue #145
  is precisely the failure of page-bottom disclaimers.
- **Degradations are visible, not silent:**
  - `unpricedRecords > 0` → a superscript `*` after the numeral; title gains *"N records excluded —
    no published price for `<model>`"*. The tokens are still counted; only the dollars are partial.
  - `ttlSplit === false` → title gains *"cache writes priced at the 5-minute rate; the 1-hour split
    was not available"*. The figure is a lower bound and says so.
  - `familyFallback.length > 0` → title gains *"`claude-opus-5` priced at the generic Opus rate —
    unverified"*.
  - `usd === null` → renders `—`. Never `$0.00`, never `$—`, never a zero-height bar.
- **A chart or table mixing bases must say so.** If any row in a table is `measured` and any other is
  `estimated`, the column header gains a `~` prefix and a title reading *"mixed: some rows are
  billed figures, some are estimates"*. Do not average across bases silently.

### Where each surface lands

| Surface | Basis today | Basis after |
|---|---|---|
| Usage panel projection, cache waste, anomalies | estimated, unlabelled | `estimated`, hover-documented |
| Reliability → Costs (all) | estimated, one page-level disclaimer | `estimated`, per-figure |
| Insights cost KPIs and bars | estimated, unlabelled | `estimated` |
| Sessions ledger | estimated at 4dp, unlabelled | `estimated` at 2dp |
| Delivery `$` per point | estimated, unlabelled | `estimated`; the existing cohort caveat stays |
| Runs `est. cost` | estimated, tooltip already says so | `estimated`, tooltip absorbed into `Money` |
| Ticket / Board / Chat / QuickActions / eval runs | **exact, unlabelled** | **`measured` with `✓`** |
| 5-hour block | tokens only, no denominator | unchanged until feature 9; **do not invent a denominator** |

### The one thing this must not become

A confidence percentage, a star rating, or a "cost accuracy score". Those are judgements dressed as
measurements and they violate honesty rule 4 (every heuristic shows its arithmetic). `basis` is a
categorical fact about where a number came from. Keep it categorical.

---

## Validation plan

Run before the change, after the change, and as CI on a committed fixture. The corpus numbers in
[Evidence](#evidence--what-our-own-corpus-says) were produced by exactly the procedure below and
serve as the pre-change baseline for this machine.

### 1. Corpus harness

Add `scripts/audit-usage.mjs` — not a test, a diagnostic, runnable against any real
`~/.claude/projects`. It prints:

```
files, rawRecords, dedupedRecords, duplicatePct
rawTokens, dedupedTokens, inflationX
cost: currentPipeline, afterDedupe, afterPricing, afterTtl
byModel: [{ model, records, matchedBy, oursUsd, correctedUsd, ratio }]
fieldPresence: { messageId%, requestId%, cacheCreationSplit%, iterations%, iterationsMultiCount }
crossFileDuplicateKeys
```

It writes nothing and reads only under `~/.claude`. This is the artifact a sceptical user runs to
check us, and the artifact we run on someone else's corpus before believing our own numbers.

### 2. What a correct result looks like

| Assertion | Expected | Why it proves the fix |
|---|---|---|
| `dedupedRecords` == count of distinct `message.id` | exact equality | dedupe key is being applied |
| `duplicatePct` in 40–70% | 61.07% here; independent measurement reports 51–55% | our corpus is not anomalous |
| every duplicate group's kept record has max tokens | 100% | keep-last is the right rule |
| `iterations` sums equal top-level | 100% (trivially — `length` is always 1) | the iteration path is inert, not broken |
| `5m + 1h == cache_creation_input_tokens` | 100%, 0 mismatches | the TTL split is real, not reconstructed |
| `afterTtl / afterPricing` | 1.05–1.15 | matches upstream's independently measured +9.6% |
| `byModel` ratios | Opus ≈ 2.7×, Fable ≈ 1.4×, Haiku ≈ 0.8×, Sonnet ≈ 1.0× | signs and rough magnitudes match `_SYNTHESIS.md` D2 from a completely different derivation |
| `unpricedRecords` | 0 on this corpus | no silent Sonnet-default pricing remains |
| sum of `/api/sessions` rows vs `/api/usage` total | differ by ≤ the cross-file duplicate share (~4%) | the documented asymmetry, quantified rather than hidden |

### 3. What would indicate the dedupe key is wrong

These are the falsifiers. If any fires, stop and re-derive the key before shipping.

- **Any duplicate group where a later record is *smaller* than an earlier one.** We measured 16,611
  differing groups and **zero** shrinking. A single shrink means records are not monotone appends and
  keep-last silently discards real usage. The audit script must count and print this; a non-zero
  count is a release blocker.
- **`duplicatePct` near 0 on a corpus with real streaming activity.** Would mean `message.id` is
  being assigned per *record* rather than per API response — the key would be an identity function
  and the dedupe a no-op dressed as a fix.
- **`duplicatePct` above ~85%.** Would suggest we are collapsing genuinely distinct API calls. Cross
  check: distinct `requestId` count should track distinct `message.id` count within a few percent
  (on our corpus they are identical). A large divergence means one API call spans multiple message
  ids, and the compound key is then wrong in the *other* direction — it would under-dedupe.
- **De-duplicated `output_tokens` falling below the sum of visible assistant text.** Output tokens
  are the least likely bucket to be replayed; if deduping cuts them by more than ~10% while cutting
  cache-read by ~55%, that asymmetry is expected and fine. If it cuts output by ~55% too, we are
  probably collapsing distinct turns.
- **A session's turn count dropping below its visible user-prompt count.** One assistant response per
  user prompt is a floor. `/api/context/:id` makes this directly inspectable.
- **`crossFileDuplicateKeys` == 0 on a corpus with resumed sessions.** Would mean our cross-file pass
  is not running. On our corpus it is 1,143.

### 4. Regression comparison

Capture `/api/usage`, `/api/gov/costs?days=30`, `/api/sessions?days=7`, `/api/chatstats?days=30` and
`/api/roi?days=90` before and after, and diff. Expected direction of every dollar and token field is
**down**, except `cacheTtl` figures which go **up** by ~9%. Any field that moves the wrong way is a
bug in the change, not in the old code.

### 5. Second corpus

Everything above is one machine. Before publishing any accuracy claim externally, run
`scripts/audit-usage.mjs` on at least one other person's `~/.claude` and confirm `duplicatePct`,
`crossFileDuplicateKeys > 0`, and the 5m/1h field presence. Our 36.75% 1-hour share differs sharply
from upstream's measured 78%, which is itself evidence that this ratio is corpus-specific and must
never be hardcoded.

---

## Not worth taking

- **Stargx's 0.25× cache multiplier.** Wrong by 5× against the consensus `cache_read = 0.10×`, which
  four independent projects agree on and which our own `entryCost` already uses correctly. Copying it
  would break the one part of our formula that is right.
- **Four-decimal costs on estimated figures.** Upstream renders `$0.0000` per row and exports
  `toFixed(4)` to CSV. It is a precision claim the underlying data cannot support. Feature 5 removes
  ours.
- **SQLite as a durable store.** `_SYNTHESIS.md` Tier 3.5 already flags `better-sqlite3`'s native
  build as a documented install-failure source, and adding a database contradicts the repo's stated
  no-DB stance. If durability is wanted later, a JSON-lines sidecar under the existing meta directory
  gets 90% of it with zero dependencies. Not part of this workstream.
- **Upstream's `PEAK_HOURS_UTC` red-bar band.** Hardcoded UTC 12–17, applied to every day despite a
  comment saying Mon–Fri, and probably obsolete since Anthropic reportedly removed peak-hour
  reduction on 2026-05-06. It drives no math. Rendering a stale constant as a factual band is the
  opposite of what this spec is for.
- **Chasing upstream's dashboard features** — model multi-select, named date ranges, CSV export,
  collapsible cards. All fine ideas, none of them correctness, and `_SYNTHESIS.md` §4 is explicit
  that we should not spend effort on cost-dashboard parity beyond correctness. Revisit after 1–3 ship.
- **A `costAccuracy` score or confidence percentage.** Discussed and rejected in the design section
  above: it converts a categorical fact into a fabricated measurement.
- **Priming the pricing table from a network fetch.** Zero-telemetry is a load-bearing product claim.
  A user-editable override (feature 8) solves staleness without an outbound request.

---

## Open questions for the maintainer

1. **What are `claude-opus-5` and `claude-sonnet-5` actually priced at?** They are **52.8% of our
   de-duplicated records** and appear in no researched pricing table. Today they resolve by family
   keyword to $5/M and $3/M. If Opus 5 is priced differently from Opus 4.8, our corrected figure is
   still wrong for the largest single slice of our own data. This is the highest-value unknown in
   the spec. Also unverified: `claude-sonnet-5` at Sonnet 4.6's $3/M.
2. **Should `/api/sessions` per-session cost include cross-file replayed records?** A forked session
   legitimately paid for the context it inherited, so charging both is defensible per session but
   double-counts in any sum. Feature 1 proposes: keep per-session totals inclusive, compute the
   global total exclusively, and state the gap. Confirm that is the call you want.
3. **Do we ship the historical discontinuity quietly or loudly?** Every stored figure a user has
   noted drops 2.5–6×. Options: a one-release footnote, a changelog entry, or nothing. Recommend the
   footnote; it costs one line and it is the difference between "they fixed a bug" and "the numbers
   are unreliable".
4. **Is feature 9 (statusLine install) something we are willing to do at all?** It means writing into
   the user's `~/.claude/settings.json` to gain observability about them. It is the only route to
   exact passive cost and to real rate-limit denominators, and it is a posture change for a product
   whose pitch is passive observation. This is a product call, not an engineering one.
5. **Should the estimate be labelled "API-equivalent" everywhere?** For a Max subscriber every tier-3
   figure is a counterfactual, not a bill — upstream's issue #145 is users misreading exactly this.
   `src/sections/ReliabilitySection.jsx:325` already says it in one place. Making it the default
   phrasing everywhere is more honest and slightly more depressing to read.
6. **Do you want the 2× 1-hour cache-write premium verified before shipping feature 3?** It moves the
   total by ~9% and is transcribed, not verified. Shipping it labelled `unverified` in the module
   comment is defensible; shipping it silently is not.
7. **`scripts/audit-usage.mjs` — ship it in the repo or keep it internal?** Shipping it is a strong
   trust move (it is the tool that proves our numbers, runnable by a sceptic) but it also documents
   how wrong we were. Recommend shipping it.

---

## Appendix — suggested landing order

| Order | Feature | Effort | Ships alone? |
|---|---|---|---|
| 1 | (1) De-duplication | S | yes |
| 2 | (2) `lib/pricing.mjs` | S | yes |
| 3 | (7) Regression guards | S | with 2 |
| 4 | (3) Cache TTL split | S | yes |
| 5 | (5) Precision discipline | S | yes |
| 6 | (6) Local-date keys | S | yes |
| 7 | (4) Provenance layer | M | after 2 |
| 8 | (8) Unknown-model surfacing | S/M | after 2, 4 |
| 9 | (9) statusLine ingest | M | gated on Q4 |

1 and 2 are independent of each other and can land in either order or together. Landing 1 without 2
leaves cost 2.48× high; landing 2 without 1 leaves it 2.82× high. Neither is a stable resting point —
prefer shipping both in one release with the audit script as the evidence.
