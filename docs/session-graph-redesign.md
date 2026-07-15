# Session-Graph Visualization — Redesign Spec

Synthesis of a 4-agent design pipeline: brainstorm → design critique → data-completeness audit → visual QA.
Current renderer: `src/PlanGraph.jsx` (+ `src/plan.js` data model, `src/ChatSection.jsx` `buildBlocks`).

## The core decision
**One `PlanGraph` shell, two canvas bodies.** The shell keeps state, drill stack, detail panel, and diagnosis (all mode-independent, ~60% of the code). Only the canvas branches:
- **Plan mode** — real sparse DAG → keep the absolute-positioned node-link graph, just shrink cards (CW 180 / CH 108).
- **Activity mode** — a linear, time-ordered trace → replace the card grid with a **flow-laid vertical trace-timeline** (not absolute-positioned; this is what makes sticky headers work).

Rejected: two separate renderers (duplicates the shared 60%), force-directed layout (jitters on live update, hairballs), unified single renderer (makes linear data pay graph-layout cost).

## Activity timeline anatomy
- **Turn bands**: collapsible sections, sticky header `▸ Turn 3 · 12 actions · 8.4s · $0.021` (duration/cost from the `turn-end`/`usage` data). Header bg blurred so rows scroll under it. Verify `position:sticky` resolves against the `maxHeight:70vh` panel, not the page.
- **Rows** (~30px, flow-laid): `[rail tick] [glyph] label(mono) ···· [dur dim] [status dot]`. One continuous 2px left rail is the "thread" — **no bezier edges** in activity mode (order = vertical position). Bezier edges stay in plan mode where deps are real.
- **Subagents**: inline-expand only small subplans (≤8 actions, indent + agent-hue left border); larger/deeper → keep drill-to-fullscreen + breadcrumb (already built).
- **Live**: in-flight row shows a pulsing `running` dot; timeline auto-follows newest (respect `prefers-reduced-motion`).

## No JSON dumps — widget per type
Remove all three `JSON.stringify`/`<pre>` sites in `PlanGraph.jsx` (mcp body, chip body, Params). Detail panel becomes schema-aware, dispatching on `tool_to_call` and value shape:

| Data | Widget |
|---|---|
| Bash params | shell block, dim `❯` prompt, mono, wrapped; timeout/bg as pills |
| Read params | file-path chip + "lines 200–260" pill |
| Edit params | **inline mini-diff** — `-` old on error-tint, `+` new on ok-tint, clamped 2 lines |
| Write params | file-path chip + "N lines" + first 2 lines collapsed |
| Grep/Glob | pattern in mono search pill + flag pills |
| Task/Agent | agent-hue `◆` + subagent_type + action count; prompt collapsed |
| Skill / MCP | hued chip; mcp config → kv table (not stringified) |
| tool result | `structuredPatch` → **diff viewer** (colored hunks, line nums, `overflow-x:auto`); stdout/stderr → shell blocks; `is_error` → error-hued header + `▲` |
| usage/tokens | stacked micro-bar (input/output/cache tints) + `$` figure — never a kv dump |
| AskUserQuestion | decision card: question + option pills, chosen filled with `✓` |
| Task/TaskUpdate | todo tracker: `○` pending / `◐` in-progress (pulse) / `●` done |
| thinking block | italic dim agent-tinted block, `✳` glyph, collapsed 2 lines, off by default |
| nested object | kv table; nested → `{N keys}` pill, expands ≤3 deep, then "copy raw" |
| long string | 2-line clamp + faded edge + `⌄ show` |

The only surviving `JSON.stringify` is a `⧉ copy raw` button → clipboard, never rendered to screen.

## Color system (one warm-dark family)
Keep: skill `#d97757`, rule `#e5a03a`, mcp `#3fb96a`, tool `#5eb3f6`, agent `#a78bfa`, ink `#f6efe9`.
Add status (desaturated, warm, harmonized — only `error` is a genuinely new hue):
```
ok       #4fb477   (or reuse mcp green)
running  #e0b341   (amber — ONLY ever shown animated, to distinguish from warn/rule)
warn     #e5a03a   (reuse rule; warn & rule never co-occur on the status channel)
error    #e06c5a   (NEW warm coral — same family as skill terracotta, not a browser red)
```
Rules:
- **Hue never alone** — always paired with a glyph + mono label (colorblind-safe).
- **Channels ≤3 per row**: glyph = tool identity (`❯`Bash `▤`Read `✎`Edit `＋`Write `⌕`Grep `◆`Agent `/`Skill `⬡`MCP `✳`thinking), hue = category, status dot = outcome. Nothing else colored on the row (duration/cost stay dim mono).
- **Contrast fix**: bump meaningful dim text `#8a807a` → `#a2988f`; render mcp green text ≥11px/500 weight.
- Tints reuse existing formula: `${hue}12–18` fill, `${hue}30–40` border.

## Maximalism without clutter — 3 tiers
The user wants to see everything; everything-at-once is clutter. Show it all, tiered:
- **Tier 1 (row glance)**: turn · glyph · category hue · label · status dot · duration. Nothing else.
- **Tier 2 (detail panel, on click)**: header → params widget → result/diff → usage micro-bar → chips → copy-raw. Step's thinking block here if present.
- **Tier 3 (docked lanes, one open at a time via a right tab strip)**: Cost/token lane · Files-touched · Todo tracker · Decision log · Thinking-trace toggle.

### Build order
**First cut (build now — kills the dumps, high value, stays clean):**
1. Schema-aware detail panel + all params widgets.
2. Result/diff viewer incl. `structuredPatch` + `is_error` highlight.
3. Status colors + status dot + row anatomy.
4. Turn bands + sticky headers + timestamps→duration.
5. Diagnosis findings carry `step_id`s → click-to-highlight rows.
6. Files-touched panel (cheap to derive, high signal).

**Second cut:** cost/token lane + per-step usage micro-bar · thinking-trace toggle · todo tracker · decision log · live pulsing dot + auto-follow.

**Third cut (behind toggles, only when non-nominal):** model/gitBranch/cwd drift ribbon · stop_reason / API-error / hook markers.

**Cut entirely:** per-row duration bars (no per-tool timing in the data), flamegraph, order-vs-dependency toggle, minimap, result-size tag, load-more (raise CAP instead).

## Data plumbing required (all present in transcript, currently dropped)
`blocksToPlan`/`buildBlocks` must carry through, per step: `result` + `is_error`, `message.usage` (tokens/cost/cache), `timestamp`, `message.model`, `stop_reason`, and `toolUseResult` (esp. `structuredPatch`, stdout/stderr). `historyEvents` must stop filtering out `thinking` blocks and (for hook/system markers) relax the user/assistant-only filter. `diagnoseSession` must emit the `step_id`s each finding refers to. `server.mjs` `collectUsage` already parses `usage` + `structuredPatch` — reuse it as the template.

## Red flags to prevent
1. **Diff/stdout is the new dump risk** — hard-clamp code/diff/stdout to ~12 lines + "show all", force `overflow-x:auto`, never auto-expand.
2. **One docked lane open at a time** — tab strip is exclusive; no tiling.
3. **`running` amber vs `warn` amber** — running is *only* ever animated; static amber = warn. If you can't animate, use pulsing `tool` blue for running.
4. **Empty states** — "no parameters" in dim text, never an empty `{}` block (reads as broken).
5. **Detail panel shows FULL command** — don't reuse `shortArg`'s 60-char truncation there.
