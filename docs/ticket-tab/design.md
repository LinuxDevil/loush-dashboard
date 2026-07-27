# Ticket tab — design

Date: 2026-07-27
Status: implemented

**Implementation status.** Everything in §4 is built. The five items absent from the first pass —
the re-derive approval gate (§4.1), node add/delete/rename, undo/redo (§4.4), the design chat with
an assistant op list, and the Task Board handoff (§2.4) — landed next, followed by the six that §8
had listed as deliberately skipped: multi-select and marquee, drag-to-connect, keyboard pan/zoom
with a roving tabindex and edge traversal, edge-label editing, cancel-safe staged document writes,
and a per-repository run lock. §8 is now the interaction model; §9 lists what genuinely remains
unbuilt, and it is a much shorter and less load-bearing list than before.
Findings: `findings.md` · References: `references.md`

---

## 1. The problem

**Stated in one sentence:** *I have a JIRA key and the repo checked out, and the only path between
them is to open a browser tab, read the ticket, and re-type its contents into a terminal — this
dashboard knows both facts and connects neither.*

That is a real gap, and it is narrower than "build a ticket cockpit". Everything below is measured
against it.

### What already exists

`server/eng.mjs` already fetches a ticket (`ticketDetail`, `:1221`) and already generates acceptance
criteria and test cases (`GEN.ac`/`GEN.tests`, `:1237`). The gap is **reachability**: the only UI is a
drawer at `EngDashboard.jsx:592`, opened by clicking a row on a board that requires full project
config and a snapshot the code itself documents as *"~65s of live JIRA + GitHub"* (`:987`).

So this work is not "add AC generation". Claiming otherwise would be false.

### The trap that makes a naive version pointless

**The 65 seconds is inside `ticketDetail` itself** (`server/eng.mjs:1228`):

```js
const snap = await snapshot(cfg).catch(() => null)   // ← full project snapshot, just for PR links
```

A new tab calling the same function pays the same cost. **A key-first tab that is not fast is not
worth building**, so making this `await` opportunistic is prerequisite #1, not a nice-to-have.

---

## 2. What three critics said

Three independent critiques were run — on product value, on architecture, and on the deliverables.
Their objections are recorded here rather than paraphrased away, because two of them argue against
building most of this.

### 2.1 The case against (product critic)

> *"This is six features wearing one trench coat, and only the first inch of it is a real problem."*

- Steps 4–5 (editable canvas, design chat) are **not downstream of any stated pain**.
- A second, much larger ticket pipeline already exists — `/api/board/tickets/:id/analyze` →
  `breakdown` → `start` (git worktree + dev agent) → `review` → `qa` → `release`
  (`server/index.mjs:4237-4463`). A standalone design step creates **two unrelated notions of a
  ticket**.
- `README.md:411-414` records five audits that found *"32,757 LOC across 4 SPA shells and 81 leaf
  panels serving about 4 real jobs"* and named the cause: *"the characteristic verb was demote, not
  delete."* 15,300 lines were then deleted. A 14th top-level tab is the textbook next entry.
- Its ranking by value-per-build-cost: **fetch-by-key ≫ design plan ≫ AC ≈ tests (already built) ≫
  files/data-flow ≫ editable canvas.**

### 2.2 The case against (deliverables critic)

> *"Six proposed artifacts, one of which is real."*

- Generated AC that never returns to JIRA is *"a reading aid, not a deliverable"* — and today there is
  **no copy, no download, no post**, even though `src/eng/Export.jsx:24-28` implements all three in
  the same app.
- The user's own gold-standard specs in `docs/superpowers/specs/` contain **zero diagrams**. Where a
  diagram would go, they use a `| Module | Responsibility | Depends on |` table — the same graph in a
  form that diffs, greps and reviews.
- A design of unbuilt code has a half-life of about one working day.

### 2.3 The case for building it properly (architecture critic)

Accepted the feature and specified how to make it survivable. Its decisions are adopted almost
wholesale in §4.

### 2.4 The resolution

The full six-step tab is being built, as scoped by the user. The critics do not change *what* is
built; they change *how*, and every one of their objections maps to a constraint below:

| Objection | Constraint adopted |
|---|---|
| The tab won't be fast | Opportunistic snapshot; ticket renders before PR context resolves |
| It duplicates the Task Board | A **"Send to Task Board"** handoff, not a rival pipeline |
| Artifacts have no exit | Copy / download / **post-to-JIRA**; design doc written into the repo, git-tracked |
| A design of unbuilt code is a guess | Three-tier **verified / planned-edit / planned-new**, never one visual language |
| Diagrams go stale invisibly | Provenance footer + `derivedFromDocSha` divergence banner |
| It'll be a tab nobody opens | A stated kill criterion in §8 |

---

## 3. Non-goals

- Not a rival to the Task Board pipeline. This tab **plans**; the board **executes**.
- Not a general-purpose whiteboard. The canvas edits *this* design graph, nothing else.
- No new runtime dependency (see `references.md` §5).
- No auto-posting to JIRA. Every write is an explicit, gated human action.

---

## 4. Architecture

### 4.1 Two artifacts, disjoint ownership

The central decision. Markdown owns prose; graph JSON owns the diagram; they are joined by
`derivedFromDocSha`, and **divergence is a displayed state, never a silent auto-repair**.

Picking a single canonical artifact fails both ways: markdown-canonical means diagram edits must
round-trip into prose (impossible without loss), graph-canonical throws away the only artifact with a
review audience and a shelf life.

```jsonc
{
  "v": 1,
  "key": "ABC-1234",
  "rev": 7,                          // monotonic — the If-Match token
  "cwd": "/Users/me/code/target",    // from localCloneOf, frozen at generation
  "doc":   { "path": "docs/superpowers/specs/2026-07-27-abc-1234-design.md",
             "sha": "sha256:…", "genAt": "…", "model": "…", "edited": false },
  "graph": {
    "derivedFromDocSha": "sha256:…",
    "nodes": [{
      "id": "ticket-api",            // SEMANTIC SLUG — never an ordinal
      "type": "process",             // process|service|store|decision|external|ui|queue
      "position": { "x": 320, "y": 140 },   // server-owned; model never emits coordinates
      "data": { "label": "Ticket API", "note": "",
                "files": [{ "rel": "server/ticket.mjs", "change": "new" }],
                "origin": "generated" }     // generated|user|assistant
    }],
    "edges": [{ "id": "e:a>b", "source": "…", "target": "…", "label": "PUT graph",
                "data": { "kind": "sync", "origin": "generated", "isStatic": false } }]
  },
  "chat": { "sessionId": "…", "cwd": "…" },   // POINTER ONLY — never the transcript
  "warnings": [{ "code": "edge-dropped", "detail": "…" }]
}
```

**Why semantic slug ids are the most important field:** `src/lib/plan.js` uses ordinal `step_id`,
which is exactly why regenerating a plan today is a total rewrite with no usable diff. Slugs are the
merge key that makes regeneration non-destructive and lets node positions survive it.

**Field names are React Flow's** (`id`/`position`/`data`, `source`/`target`) even though the canvas is
hand-rolled — it costs nothing now and makes a later swap an adapter of ~zero lines.

Sync cases, all resolved as displayed state:

| Event | Behaviour |
|---|---|
| Doc regenerated, graph untouched | new `rev`, graph re-derived, positions carried by slug |
| **Graph edited, then plan regenerated** | graph is **not** replaced; banner + three-way preview (*kept N · added M · dropped K*), user approves |
| **Doc hand-edited, then diagram opened** | `sha` mismatch → `stale` badge + same preview; canvas stays usable |
| Chat proposes a change | assistant emits an **op list**, never a graph; user applies |
| Two tabs open | `If-Match: <rev>` → 409 + reload. Positions exempt (last-write-wins is right for coordinates) |
| Doc deleted from disk | `doc.exists:false`, graph preserved and marked orphaned |

### 4.2 Generation: two runs, not one

`claudeMarkdown` (`server/eng.mjs:1244`) is disqualified three times over: blocking `spawnSync`, a
180s timeout a real design run exceeds, and **no `cwd` and no permission flag**, so it cannot read the
repo at all.

- **Run 1 — long, agentic, streamed.** `spawn` with `cwd = localCloneOf(githubRepo)`,
  `--output-format stream-json`, streamed to the browser over SSE using the machinery already at
  `server/index.mjs:905/940`. It reads the repo and writes the markdown spec **to disk itself**.
  Free-form prose, nothing to parse.
- **Run 2 — short, tool-less, cheap.** Input is the doc text plus the schema; output is the graph
  JSON. Seconds, not minutes, and re-runnable.

That split converts *"the six-minute run produced unparseable JSON, run it again"* into a **retry
button**. Run state lives on the **server**, keyed by ticket — because `src/App.jsx:208` `refresh()`
resets `visited` and bumps `tick`, which is in the key at `:275`, so a refresh click remounts the
section and would tear down a client-owned EventSource mid-run.

### 4.3 Parsing — the highest-risk code in the feature

A ladder, in order, returning `{graph, warnings[]}` and never throwing:

1. `JSON.parse`.
2. Strip fences — `src/lib/plan.js:11` already has the right instinct (last fenced match wins).
3. **Brace-balance scan** honouring string literals and escapes. Do **not** copy `extractJson`
   (`server/index.mjs:4105`, `/\{[\s\S]*\}/`) — that greedy match breaks on any prose containing `}`.
4. **One** repair round-trip with the parse error and offset.
5. Fail closed.

Validation is hand-written (no new dep): require `id` + `data.label`; de-dupe ids; coerce unknown
`type` and **record the coercion**; drop edges whose endpoints don't resolve and **record each drop**;
cap 60 nodes / 120 edges; **reject any model-supplied `position` outright**.

**Failure UX:** an empty canvas reads as *"your design has no components"* — honesty rule 2
(`README.md:378`) violated with pixels. So: **always render the markdown in full**, degrade to
"document without diagram", show a retry strip, and surface dropped edges as chips.

### 4.4 The canvas — hand-rolled, zero new dependencies

d3 7.9.0 already bundles `d3-zoom@3`, `d3-drag@3`, `d3-selection@3` (verified by import in this
environment), giving pan/zoom/drag — the genuinely hard parts — for free. Rendering follows the
proven `PlanGraph.jsx` pattern; diamonds and cylinders become SVG paths. Full reasoning and what is
lost: `references.md` §5.

**Undo/redo is constitutive**, not optional (Shneiderman's third principle) — graph state is an
immutable patch stack from the first commit, because retrofitting undo onto mutable state is a rewrite.

### 4.5 Files and data flow — three tiers, never two

`buildImportGraph` (`server/fe.mjs:128`) resolves specifiers only against files that exist, so it is
structurally incapable of saying anything about unbuilt code.

| Tier | Data | Render |
|---|---|---|
| `verified` | exists; importer edges **real** | solid, full detail |
| `planned-edit` | exists **and** the design changes it | solid outline + badge. **Importer counts are real** — genuine blast radius |
| `planned-new` | does not exist | **dashed**, *"planned — does not exist yet"*. No tick, no coverage, no importer count |

Precedent for the third row is already in-repo: `server/fe.mjs:466` sets `importers: null` for
unwalked files rather than `0`.

**Drawn data flow *between* two planned-new files is cut.** There is no source to parse; rendering
model guesses in the same visual language as a parsed import graph is honesty rule 2 violated with
arrows. Planned-new files appear as a **list**, and the tier boundary is the deliverable: *"this
design proposes creating four files, one of which already exists."*

### 4.6 Module boundaries

New **`server/ticket.mjs`**, mounted alongside the others at `server/index.mjs:50`. Not additions to
`eng.mjs`, which is PLANE A: this feature spawns agents, holds session ids and accrues cost — all
PLANE B by content. Note `claudeMarkdown` (`:1247`) deliberately discards `total_cost_usd` to stay
plane-A-clean; that discipline does not survive a feature where "this run cost $1.40" is legitimately
wanted.

AC and test generation **stay** on `/api/eng/*`, unchanged. The new section calls two APIs.

`localCloneOf` and `runAgent` currently live in `server/index.mjs`; importing them from there would be
a cycle (index is the mount root). Extract to `lib/clone.mjs` and `lib/agent.mjs`.

⚠ **The privacy fence is weaker than advertised** — `test/server/eng-privacy.test.js:60-68` walks only
the return values of seven exported functions, so a new `/api/eng/*` route returning `{sessionId,
cost}` would sail through. Extend it with a static assertion that `server/eng.mjs` imports neither
`lib/agent.mjs` nor `lib/clone.mjs`, turning a convention into an actual check.

---

## 5. Bugs in existing code, fixed as part of this work

The new feature inherits all four. Detail and reproduction in `findings.md` §2.

1. **Comment bodies render as `"[object Object]"`** (`server/eng.mjs:1227`) — ADF objects passed to
   `htmlToText`. This corrupts the *input* to every generated artifact, not just a display. **Fix:**
   an ADF→text walker, selected by `body?.type === 'doc'`.
2. **Hand-editing permanently disables staleness** (`:1423` + `:1448`) — `edited` suppresses the check
   and `inputHash` is never refreshed. **Fix:** refresh the hash on every write; `edited` becomes a
   display flag only.
3. **Staleness over-fires** (`:1242`) — hashes status, comments and live PR commits. **Fix:** hash the
   requirement (`summary + description + issuetype`) only.
4. **`cfgFor` silently guesses the project** (`:1194`) — `|| projs[0]` resolves a key against the wrong
   JIRA host. In a key-first UI this is the primary failure path. **Fix:** derive from the key prefix.

---

## 6. Routes

All `/api/ticket/*` → `server/ticket.mjs`. AC/tests stay on `/api/eng/*`.

### The scope every route takes

Every keyed route carries `?workspace=<id>` — the FOLDER the user selected, not a JIRA project key.
The key's own prefix is never used to pick a scope; it is compared only to warn, because silently
retargeting a pasted key resolves it against the wrong host and runs an agent in the wrong checkout.

Two resolvers, and the difference is load-bearing:

- **`resolveWs`** — a valid key and a folder from the registered set. Everything that only touches
  this machine's own state: reading or editing a graph, forgetting a cached ticket, discarding a
  partial document, listing files.
- **`resolve`** — the above *plus* a linked JIRA board. Only the four routes that actually talk to
  JIRA: the live fetch, generation, a design run and the Task Board handoff.

Getting this wrong is not theoretical — it shipped once. `DELETE /saved` went through the
board-requiring resolver, so a folder whose board link was cleared held saved tickets that could
never be deleted. Pinned by `test/server/ticket.test.mjs`.

| Method | Path | Scope | Notes |
|---|---|---|---|
| `GET` | `/api/ticket/index` | — | workspaces, boards, and the selected workspace's saved tickets |
| `POST` | `/api/ticket/workspace/:id/jira` | folder | link a folder to the board its tickets come from, or clear it |
| `GET` | `/api/ticket/:key` | + board | key-first fetch; disk first, `?fresh=1` to re-fetch |
| `DELETE` | `/api/ticket/:key/saved` | folder | forget one cached ticket — the cache is the user's |
| `POST` | `/api/ticket/:key/generate` | + board | AC/tests, grounded in the selected folder |
| `GET` | `/api/ticket/:key/design` | folder | `{rev, doc, graph, warnings, run}` |
| `POST` | `/api/ticket/:key/design/run` | + board | async spawn, streamed; 429 at the existing run cap |
| `GET` | `/api/ticket/:key/design/events` | — | SSE, replay-then-live |
| `POST` | `/api/ticket/:key/design/extract` | folder | re-run the cheap doc→graph pass — the retry button |
| `POST` | `/api/ticket/:key/design/rederive` | folder | apply/discard the three-way merge preview |
| `PUT` | `/api/ticket/:key/design/graph` | folder | full replace; `If-Match: <rev>`; 409 on mismatch |
| `PATCH` | `/api/ticket/:key/design/layout` | folder | **positions only**, debounced; no precondition |
| `POST` | `/api/ticket/:key/design/ops` | folder | ordered op list from chat; validated; `If-Match` |
| `POST` | `/api/ticket/:key/design/chat` | folder | ask about the graph; returns ops, applies none |
| `GET` | `/api/ticket/:key/files` | folder | `{verified, plannedEdits, plannedNew, stats}` |
| `POST` | `/api/ticket/:key/board` | + board | hand off to the Task Board |

## 7. Storage

`eng-artifacts.json` is wrong here: it is rewritten whole on every save (`:1192`), gitignored, and
unversioned. Instead:

- **One file per key, partitioned by workspace** — `.ticket-state/<workspace-id>/<KEY>.json`, so a
  node drag rewrites ~8 KB, not the corpus. The workspace id is `<basename>-<8 hex of sha256(path)>`,
  so `~/work/api` and `~/fork/api` are distinct and both are recognisable on disk. It is derived
  from the PATH, never from the JIRA key: keying on the board meant renaming it in `projects.json`
  orphaned every saved ticket, and two checkouts of one board could not be told apart.
  The pre-partition flat layout is still read, so nothing saved before this is orphaned.
- **The folder→board link** — `.ticket-state/workspace-jira.json`, one key per workspace. A git
  origin match against `githubRepo` is the first guess; an explicit choice wins and the UI says
  which of the two happened.
- **The design doc goes in the target repo**, git-tracked, written by the agent itself.
  ⚠ If that repo gitignores `docs/` — **as this one does at `.gitignore:21` while tracking 28 files
  under it** — surface *"this path is gitignored; `git add -f` to track it"* and **never run git
  commands on the user's repo silently.**
- **The chat transcript is not stored.** `{sessionId, cwd}` only; the CLI already persists the
  transcript and `historyEvents` (`server/index.mjs:887`) reads it back.

## 8. Canvas interaction model

The canvas is a `listbox` of `option`s with a **roving tabindex** — one Tab stop in, one out — because
there is no ARIA pattern for a node graph and `role="application"` would suppress browse mode
entirely. Every mutation announces through a live region that is also **visible**, so the feedback is
not screen-reader-only trivia.

| | Mouse | Keyboard |
|---|---|---|
| select | click | `Space` toggles · `Enter` opens the inspector |
| multi-select | `Shift`/`⌘` click · `Shift`+drag marquee | `Shift`+arrow extends · `⌘A` all · `Esc` clears |
| move | drag (moves the whole selection, 8px grid) | `Alt`+arrow 8px · `Alt`+`Shift`+arrow 48px |
| connect | drag the handle on a node's right edge | inspector `connect to…` picker |
| traverse | — | arrows follow **edges**, announcing the connection, not just the destination |
| spatial move | — | `g` switches arrows to nearest-node-in-that-direction |
| pan | drag · scroll | `h` `j` `k`… (`i`) |
| zoom | `⌘`/`Ctrl`+scroll | `+` `-` · `0` fit · `1` 100% |
| delete | — | `Delete` / `Backspace`, one undo step for a whole selection |
| undo/redo | toolbar, with depth | `⌘Z` / `⌘⇧Z` |

Arrow keys default to **following connections** rather than moving spatially, because the
relationship is the information a graph carries; `g` switches to geometric when position is what you
actually mean. Focus is always revealed — moving to an off-screen node pans it into view, otherwise
keyboard focus can leave the viewport with no way back.

## 9. What is deliberately NOT built

- **Edge routing around obstacles.** Arrows cross boxes. Focus mode (2-hop dimming) is the
  substitute, and it is cheaper and more legible than routing.
- **A minimap.** The Outline view is a better one, and it has to exist anyway.
- **Auto-layout re-run.** Once a human moves a node, the layout is theirs. A "tidy up" button that
  scrambles it is the fastest way to lose trust. Positions carry by slug through a re-derive.
- **Align / distribute / snap guides.** The 8px grid covers it.
- **Live collaboration.** The `If-Match` 409 flow is the whole multi-user story.
- **A canvas as the default below 900px.** The Outline is forced there — shipping a bad canvas is
  worse than not shipping one.

## 10. Kill criterion

Written down before launch, per `README.md:411-414`:

> If after four weeks fewer than 5 design documents have been generated, or none has been referenced
> by a later session or linked from a PR, delete the design/canvas/chat half and keep only the
> key-first fetch.

And per METR (`references.md` §3.2): **self-reported satisfaction is not evidence.** The measure is
whether the artifacts get used, not whether the tab feels good.
