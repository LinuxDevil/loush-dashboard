# Sub-agent plan for the CCAM port

> Companion to `PORT-CCAM-FEATURES.md`. Written 2026-07-29.
> Scoped so that agents running at the same time never touch the same file.

---

## Finding that reshapes C1

`server/index.mjs:813` reads cache-creation as one flat number:

```js
cc: u.cache_creation_input_tokens || 0
```

But the transcripts on this machine carry the tier split, and it is not academic — a real sample
from today's session:

```
"cache_creation":{"ephemeral_1h_input_tokens":43319,"ephemeral_5m_input_tokens":0}
```

**Every one of those 43,319 tokens is 1-hour cache write, and we price all of them at the 5-minute
rate.** 5 m cache write is 1.25× input; 1 h is 2×. On a 1 h-TTL session we are understating
cache-write cost by ~60%, silently, with no field on screen admitting it.

So C1 is not just "add a rate table". It is: **capture a field we are currently discarding, then
price it.** The extractor change (`server/index.mjs:813`, and the sibling reads at `:1235` and
`:1692`) is part of C1, not a follow-up.

Also confirmed, for scoping: `lib/pricing.mjs` has exactly one importer (`server/index.mjs:46`),
`collectUsage()` has 17 call sites all inside `server/index.mjs`, and `test/lib/pricing.test.mjs`
asserts the current ratio model and **will break by design**.

---

## The two choke points

Everything below is arranged around these. They are the only reason a parallel plan can go wrong.

| File | Why | Rule for agents |
|---|---|---|
| `server/index.mjs` (5298 lines, ~190 routes) | Nearly every work item wants a route here | **No agent adds a route body here.** Substantial work goes in a new `server/<name>.mjs` and is mounted with one line — the convention `access.mjs`, `atoms.mjs`, `ticket.mjs`, `memory.mjs` already follow. Only *one agent per wave* may edit this file at all. |
| `src/App.jsx` (nav registration) | B2, B3, C2, C3, B5 all want a view | Nav entries are 1–3 lines. **One agent per wave** touches it; everyone else builds their section and reports the line to add. |

No git worktrees. With file ownership assigned up front the agents are disjoint, and merging a
5 k-line file back from four worktrees costs more than it saves.

---

## Contract carried in every agent prompt

Five bullets, verbatim, non-negotiable. This repo has strong documented stances that an agent
without them will cheerfully violate:

1. **Ponytail is active.** Ladder first: does it need to exist → stdlib → native → existing dep →
   one line → minimum code. Mark deliberate simplifications `// ponytail:` with the ceiling named.
2. **`null` is not `0`, and "unknown" is a value.** See `lib/pricing.mjs` (unpriced model → `null`,
   never a fallback rate), `src/sections/InsightsSection.jsx:12` (`pct` renders `—` for null),
   `server/hooks-receiver.mjs` ("UNKNOWN IS A VALUE"). Never let "not measured" render as zero.
3. **No silent caps.** Every bound is a named constant, reported in the response, with a counter.
4. **You own these files and no others.** Need something outside your list? Report the exact edit;
   do not make it.
5. **`node --test` passes before you report.** Tests mirror source at `test/<path>.test.mjs`.

---

## C1 — pricing

**It does not fan out.** The chain is: know the real rates → capture the tier → price it → persist
it → edit it → audit it. Each link needs the previous one's shape. Splitting it into five agents
buys zero wall-clock and costs five handoffs.

### Agent R — recon *(read-only, `Explore`, runs alone, first)*

Answers what nobody should guess at. No edits.

- Which models actually appear in `~/.claude/projects/**/*.jsonl` on this machine, and at what
  volume? The table must cover reality, not the price list.
- Is `cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens` present on **every** usage block, or
  only recent ones? If older records carry only the flat total, the tier is *unknowable* for them —
  and per contract bullet 2, that needs a third state, not an assumption.
- Does `historyEvents()` attribute a subagent's cost as the session total (the bug CCAM calls out)?
  Cite the lines either way.
- Where does an editable table belong given existing convention — `config.json`, `readMeta()` /
  `META_FILE`, or a new file? Report what each is already used for.
- Enumerate every client surface that renders a dollar figure, with file:line.

Output: a findings file. Nothing else.

### Agent M — implementation *(`general-purpose`, after R)*

Owns, in this order:

| Step | Files |
|---|---|
| a. Capture the tier | `server/index.mjs` — `:813`, `:1235`, `:1692` only |
| b. Rate table + date-aware pricing + intro rates | `lib/pricing.mjs`, `test/lib/pricing.test.mjs` |
| c. Persist + expose | new `server/pricing-store.mjs` + **one** mount line in `server/index.mjs` |
| d. Subagent own-cost fix | `server/index.mjs`, `historyEvents()` region |

Must preserve: `PRICE_PER_M → null` for unpriced models (strictly better than CCAM's behaviour —
do not lose it in the rewrite), and `dedupeTurns` (that one is load-bearing: 47.8% of usage records
are repeats, cost came out 2.12× high without it).

Must decide, not assume: what an entry with a flat `cc` and no tier split costs. If R found such
records, the answer is a declared third state, not "assume 5 m".

### Agent U — Setup editor *(`general-purpose`, after M freezes the route)*

Owns `src/sections/SetupSection.jsx` only. Per-model 4-rate rows, a `YYYY-MM-DD` promo cutoff, and
per-category intro prices. Empty date clears intro rates. Raw model ids here, never formatted.

### Agent A — adversarial cost audit *(read-only, after M)*

The one extra agent worth spending, because C1's entire premise is that the numbers are wrong:
pick two real sessions, recompute cost **by hand from the raw JSONL** without using
`lib/pricing.mjs`, and diff against `/api/sessions`. Report the delta before and after M's change.
If the before-delta isn't roughly the ~60% cache-write gap predicted above, one of us is wrong and
that needs to surface before the UI ships.

**C1 total: 4 agents, 3 waves** (R → M → U ∥ A).

---

## Phases 1–7

Format: agent — files it owns — who it can run beside.

### Wave 1 · phase 1 — 2 agents, fully parallel
| Agent | Owns | Notes |
|---|---|---|
| **C5** model names | new `src/lib/modelName.js` + its test + the ~6 render sites R enumerated | Pure function. Do not touch the pricing editor's raw ids. |
| **B6** tail-cap | `lib/transcript-tail.mjs` + test | Named constant, reported count, per contract bullet 3. |

Zero overlap. Genuinely an afternoon.

### Wave 2 · phase 2 — 1 agent
**B1** session names + search/paging. Owns `collectUsage()` and the `/api/sessions` route in
`server/index.mjs`, plus `src/sections/SessionsSection.jsx`. Sole `server/index.mjs` holder this
wave. Name precedence: explicit title → ai-title → first user prompt (truncated, tool-result and
slash-command noise skipped) → short id. Derive once in `collectUsage()`; every later consumer
reads it.

### Wave 3 · phase 3 — 1 agent
**C2** Session Detail. Assembly: new view composing `ContextExplorerSection`, `ActivityTimeline`,
`ChatSection` behind a tile-counter header, plus the waiting-for-input banner off the hook
receiver's `status` / `statusSince`. Owns the new files + the `src/App.jsx` nav line. Explicitly
**must not** rewrite the three components it composes — if one needs a prop, add the prop.

### Wave 4 · phase 4 — 2 agents, parallel
| Agent | Owns |
|---|---|
| **B2** Kanban toggle | `src/sections/LiveSection.jsx` only. It already derives `thinking/waiting/idle/error/unknown` — this is a render toggle, not a new pipeline. Plus the `awaiting_reason` chip (`features/069`). |
| **B3** Health tab | `src/sections/Overview.jsx` + new `server/health.mjs`, one mount line. Reweighted ring (drop heap%), three gauges, subagent-effectiveness bars. **Link** to the existing tool/model charts in `UsagePanel`; do not rebuild them. No storage donut. No 5 s refresh. |

B3 is the sole `server/index.mjs` toucher (one line). B2 touches no shared file.

### Wave 5 · phase 5 — 2 agents, parallel with one rule
| Agent | Owns |
|---|---|
| **C3** Activity Feed | new `server/activity.mjs` + `src/sections/ActivityFeed.jsx` + the nav line |
| **C4** Alerts (half) | new `server/alerts.mjs`, evaluation hook in `server/hooks-receiver.mjs`, sweep in `lib/scheduler.mjs`, panel in `SetupSection.jsx` |

Rule: **C3 owns `src/App.jsx`; C4 owns `SetupSection.jsx`.** Each mounts its own module with one
line in `server/index.mjs` — the only real contention, and it is two non-adjacent single lines.
Land C3's mount first, then C4's.

C4 scope guard, restated because it is the most over-buildable item on the list: four condition
types, cooldown dedup, in-app acknowledge, **one generic webhook POST**. No provider registry.
Evaluate after the ingest write — alerting must never slow or fail hook delivery.

### Wave 6 · phase 6 — 4 agents, fully parallel *(best fan-out on the roadmap)*
| Agent | Owns | Shared file? |
|---|---|---|
| **B5** config tabs | `src/sections/ResourceSection.jsx` / `HarnessSection.jsx` + new `server/cc-extra.mjs` (output styles, marketplaces, keybindings, statusline) + backup-before-edit + `fs.watch` → existing SSE | one mount line |
| **C7** wf journals | `src/sections/RunsSection.jsx` + the `workflows/wf_*.json` reader | none |
| **C8** statusline | `scripts/statusline.mjs` — standalone | none |
| **C9** update check | small; `server/setup.mjs` + `SetupSection.jsx` | — |

Collision: B5 and C9 both want `SetupSection.jsx`-adjacent surfaces, and C4 (wave 5) already
edited it. Give **C9 the `SetupSection.jsx` edit** and have B5 stay in the Capabilities/Harness
sections. C8 and C7 are hermetic.

### Wave 7 · phase 7 — 2 agents, parallel
| Agent | Owns |
|---|---|
| **B4** Run Claude | `src/sections/ChatSection.jsx` — context/token meter (reuse the `in/cc/cr/out` extraction `ContextExplorerSection` already does) + cwd defaults to `$HOME` + the three pickers. **Skip** typewriter smoothing and `flushSync`; our SSE path doesn't have React 18's batching problem in that shape. |
| **C6** charts | `src/sections/UsagePanel.jsx` + new `server/flowstats.mjs`. Three charts only: tool Sankey, error propagation, compaction histogram. `d3` is already a dep — add no chart library. |

---

## Totals

**18 agents across 10 waves.** Fan-out is 1–4 per wave and is capped by file ownership, not by
appetite — waves 2 and 3 are single-agent because the work genuinely is a chain.

| Wave | Agents | |
|---|---|---|
| 1–3 | R → M → U ∥ A | C1 pricing |
| 4 | C5 ∥ B6 | phase 1 |
| 5 | B1 | phase 2 |
| 6 | C2 | phase 3 |
| 7 | B2 ∥ B3 | phase 4 |
| 8 | C3 ∥ C4 | phase 5 |
| 9 | B5 ∥ C7 ∥ C8 ∥ C9 | phase 6 |
| 10 | B4 ∥ C6 | phase 7 |

Only agent **A** exists to check other agents. Everything else is checked by `node --test` and by
reading the diff — a standing reviewer agent per wave is exactly the kind of scaffolding the
ladder says to skip until something actually slips through.
