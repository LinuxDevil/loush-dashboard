# Ticket tab — implementation plan

Date: 2026-07-27
Spec: `design.md` · Findings: `findings.md` · References: `references.md`

Sequenced so that **each phase leaves the app working and tested**. Phases 0–2 deliver the whole
value of the "type a key and go" problem; 3–6 add the design half. Nothing later depends on
unreviewed work from earlier.

---

## Phase 0 — Fix what the feature would inherit

The new tab reuses `ticketDetail` and the artifact store. All four bugs in `findings.md` §2 must go
first, or they get inherited and multiplied.

| # | File | Change |
|---|---|---|
| 0.1 | `server/eng.mjs` (new `lib/adf.mjs`) | **ADF→text walker.** `adfToText(node)` recursing `content[]`, handling `text`, `paragraph`, `heading`, `bulletList`/`orderedList`/`listItem`, `codeBlock`, `blockquote`, `panel`, `table`/`tableRow`/`tableCell`/`tableHeader`, `taskList`/`taskItem`, `hardBreak`, `rule`, `mention`, `emoji`, `inlineCard`, `status`, `date`. Unknown types recurse into `content` rather than dropping. Returns `{text, warnings[]}`. |
| 0.2 | `server/eng.mjs:1227` | Select by shape: `body?.type === 'doc' ? adfToText(body).text : htmlToText(body)`. Same for `description`. |
| 0.3 | `server/eng.mjs:1423`,`:1448` | `edited` becomes display-only; refresh `inputHash` on every write. Staleness = hash mismatch, full stop. |
| 0.4 | `server/eng.mjs:1240` | Split `genPrompt` into `reqHash(d)` = `summary + description + issuetype` (hashed) and the full prompt (sent). Staleness keys off `reqHash`. |
| 0.5 | `server/eng.mjs:1194` | `cfgFor(key)` derives the project from the key prefix; **no `projs[0]` fallback** — return `null` and let callers report "unknown project". |
| 0.6 | `server/eng.mjs:1228` | `snapshot()` becomes opportunistic: `snapFresh(cfg)` returns the cached snapshot **only if already warm**, else `null`. `prs` becomes `{loaded:false, prs:[]}` so the client can say "PR context not loaded" rather than "no PRs". |

**Tests** (`test/lib/adf.test.mjs`, `test/server/ticket-stale.test.mjs`): ADF nesting → text; the
`[object Object]` regression pinned explicitly; `edited` no longer suppresses staleness; a status
change does **not** mark stale but a description change does; `cfgFor('XYZ-1')` with no XYZ project
returns null.

## Phase 1 — Extract shared primitives

| # | Change |
|---|---|
| 1.1 | `lib/clone.mjs` ← `originOf`, `remoteCache`, `localCloneOf` from `server/index.mjs:3208-3224`. Plane-B header comment. |
| 1.2 | `lib/agent.mjs` ← `runAgent` from `server/index.mjs:4109`, plus a new streaming `spawnAgent({cwd, prompt, onEvent})` using `--output-format stream-json`. |
| 1.3 | `server/index.mjs` imports both; behaviour unchanged. |
| 1.4 | **Extend `test/server/eng-privacy.test.js`** with a static source assertion that `server/eng.mjs` imports neither `lib/agent.mjs` nor `lib/clone.mjs` — turning the plane convention into a real check. |

## Phase 2 — Key-first fetch (the actual problem)

| # | Change |
|---|---|
| 2.1 | `server/ticket.mjs` — new module, mounted at `server/index.mjs:50`. `GET /api/ticket/:key` → normalize key (uppercase, accept a pasted browse URL), resolve project from prefix, fetch via existing `ticketDetail`, return `{available, reason?, ticket, prContext:{loaded, prs}}`. |
| 2.2 | `src/sections/TicketSection.jsx` — key input, autofocus, ticket render, `Hub` sub-tabs. Reuses `Card`/`CardHead`/`Empty`/`Spinner` from `src/eng/ui.jsx`. |
| 2.3 | `src/App.jsx` — new `BASE_SECTIONS` entry after `delivery`. |
| 2.4 | AC + Tests tabs call the **existing** `/api/eng/ticket/:key/generate`, plus copy / download / post-to-JIRA. |
| 2.5 | `POST /api/eng/ticket/:key/comment` — ADF-serialized, gated on `cfg.writes`, default copy-to-clipboard. |

**Tests:** key normalization (`abc-1`, `ABC-1`, a full browse URL); unconfigured → `available:false`
with a reason and no fabricated fields; markdown→ADF round-trip.

**Checkpoint:** the tab is useful here. If nothing after this shipped, the stated problem is solved.

## Phase 3 — Design generation

| # | Change |
|---|---|
| 3.1 | `server/prompts/design-plan.md` — prompt as a **file**, not a string literal. Enforces the house spec shape (Why · Findings · Module boundaries · What gets deleted · Testing · Risks · Sequencing), requires **Findings to cite `file:line` or a command whose output was read**, requires a File Structure table with `(create)`/`(modify)` per row, and requires unverifiable claims to go in Risks labelled unverified. |
| 3.2 | `POST /api/ticket/:key/design/run` — `spawnAgent` with `cwd = localCloneOf(githubRepo)`; **429 if no clone resolves** with an actionable reason. Honours the existing 3-run cap. Run state server-side, keyed by ticket. |
| 3.3 | `GET /api/ticket/:key/design/events` — SSE, replay-then-live (the `server/index.mjs:940` pattern). |
| 3.4 | Agent writes the doc to `docs/superpowers/specs/<date>-<key>-design.md` in the target repo. Server checks `git check-ignore` and reports "gitignored — `git add -f` to track" **without running git itself**. |

## Phase 4 — Graph extraction

| # | Change |
|---|---|
| 4.1 | `lib/design-schema.mjs` — **pure**, therefore testable: `parseGraph(raw)` (the 5-step ladder incl. the brace-balance scanner), `validateGraph`, `mergeGraph(old, new)` by slug id, `layout(nodes, edges)` (layered + barycentre crossing reduction). |
| 4.2 | `POST /api/ticket/:key/design/extract` — the cheap tool-less second run. One repair retry. |
| 4.3 | `.ticket-state/<KEY>.json` via `lib/paths.mjs`; added to `.gitignore`. |
| 4.4 | `PUT …/design/graph` with `If-Match: <rev>` → 409; `PATCH …/design/layout` positions-only. |

**Tests** (`test/lib/design-parse.test.mjs`, `test/lib/design-merge.test.mjs`): fenced JSON, prose
containing `}`, two objects, truncated output, model-supplied positions rejected, unknown type
coerced **with a warning**, dangling edge dropped **with a warning**, merge preserves positions by
slug, merge reports kept/added/dropped.

## Phase 5 — Canvas, inspector, chat

| # | Change |
|---|---|
| 5.1 | `src/ticket/DesignCanvas.jsx` — d3-zoom/d3-drag over the `PlanGraph.jsx` pattern; 7 node shapes as SVG paths; every colour a CSS variable; no animation under `prefers-reduced-motion`. |
| 5.2 | `src/ticket/Inspector.jsx` — 340px panel: label, note, type, `origin`, linked files, provenance. |
| 5.3 | Undo/redo as an **immutable patch stack** from the first commit. |
| 5.4 | `src/ticket/DesignChat.jsx` — reuses `buildBlocks`/`Block` from `ChatSection.jsx`; resumes by `sessionId`; assistant proposes an **op list** the user applies or rejects. Seeded node-scoped actions, not an empty box. |
| 5.5 | Divergence banner + three-way re-derive preview. |
| 5.6 | Parallel `tree` representation of the same model for screen readers; roving tabindex; arrow-key traversal; every edge gets a text `aria-label`. |

## Phase 6 — Files & data flow

| # | Change |
|---|---|
| 6.1 | `GET /api/ticket/:key/files` — join the plan's file list against `buildImportGraph` over the resolved clone. Emit three tiers. `planned-new` carries `importers: null`, never `0`. |
| 6.2 | `src/ticket/FileFlow.jsx` — verified/planned-edit edges drawn; **planned-new is a list, not a graph**. Contradictions (`create` on an existing file) surface as warnings. |
| 6.3 | "Send to Task Board" → `POST /api/board/tickets` with `project = localCloneOf(...)`, title, and the AC + doc path. |

## Phase 7 — Verify, review, ship

- `npm test` green (baseline is 189; target ≥ 215).
- `npx vite build` — record bundle delta against the 1,578 kB / 488 kB gzip baseline. Target: **no new
  runtime dependency**, so the delta should be only this feature's own code.
- Grep the diff for raw hex — must be zero outside `styles.css`.
- Two independent review agents (design/UX + implementation/bugs); fix findings; push; open PR.

---

## Risks and assumptions

1. **`claude` CLI may be absent in this environment**, so design generation cannot be executed
   end-to-end here. Mitigation: `lib/design-schema.mjs` is pure and fully unit-tested against
   captured/synthetic model output; the spawn path degrades to a labelled error state. **This is the
   largest unverified area and is called out as such rather than claimed working.**
2. **No JIRA credentials here**, so live fetch is untestable. Every endpoint must therefore return
   `available:false` with a reason rather than throwing — which is the repo's existing convention.
3. **`localCloneOf` may resolve nothing**, which is the normal case on a fresh machine. The design tab
   must degrade to "not configured", not to a broken canvas.
4. **Layered layout without dagre** may produce edge crossings on dense graphs. Accepted: barycentre
   ordering handles the common case; the schema uses React Flow field names so adopting a real layout
   engine later is an adapter.
5. **A 6-minute streamed run is the riskiest UX.** Mitigated by streaming tool calls (not a spinner),
   server-side run state surviving the `App.jsx:208` remount, and a cancel button.
