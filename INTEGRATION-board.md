# INTEGRATION-board.md — wiring for 093 (agent tracker), 092 (session cards), 045 (data scope)

Three new modules ship as **pure logic plus tests**. No existing file was edited, so nothing is live
yet. This document is the diff that has to be applied by hand, and the reasoning behind each hook so
the wiring does not quietly undo the honesty properties the modules are built around.

| Feature | New files | Tests |
| --- | --- | --- |
| 093 agent-callable tracker | `lib/tracker.mjs` | `test/lib/tracker.test.mjs` (41) |
| 092 sessions as kanban cards | `lib/session-cards.mjs`, `src/ui/SessionCards.jsx` | `test/lib/session-cards.test.mjs` (23) |
| 045 global data-scope filter | `src/lib/dataScope.js`, `src/ui/ScopeBar.jsx` | `test/lib/dataScope.test.mjs` (19) |

Run: `npm test` (469 tests total, all passing). `npx vite build` succeeds with the new JSX.

**Nothing here imports a server module.** `lib/tracker.mjs` and `lib/session-cards.mjs` take their
persistence and their data sources as **injected functions** (`createTracker({read, write, …})`,
`createSessionCardSource({readSessions, readFileActivity})`), so they can be wired to whatever the
board store turns out to be on the target branch without either file changing. The exact interfaces
are specified below.

### Files this branch does not have

This worktree was branched before `server/board.mjs` landed, so that file **was not read and is not
created here** — the adapters exist precisely so it can be wired in without touching these modules.
`src/lib/api.js` and `src/sections/BoardSection.jsx` are both present and were read; the ticket shape,
pipeline-stage handling and the `api.get/post/patch/del` envelope below come from them, and the board
routes in `server/index.mjs` (`/api/board*`, ~line 4171 onwards).

---

## 093 — `lib/tracker.mjs` → the four agent tools

The module is the whole decision layer. A route or an MCP tool handler only has to: read state, call
the function, persist `result.state` **if `result.ok`**, and return the result verbatim to the model.

### The persistence interface you must supply

```js
import { createTracker } from '../lib/tracker.mjs'

const tracker = createTracker({
  // REQUIRED. Returns the persisted tracker state. Sync or async. Any shape — it is normalised
  // defensively, and every repair is reported in result.warnings.
  //   {items: {id: item} | item[], seq: number}
  read: () => toTracker(readBoard()),

  // REQUIRED for anything to be durable. Receives the NEW state. Called only when a mutation
  // actually changed something (a no-op update does not write). If it throws, the result becomes
  // {ok:false, error:'store_write_failed', persisted:false} — never a success that did not happen.
  // Omit it and mutations still compute, but come back with persisted:false and a stated reason.
  write: state => writeBoard(merge(readBoard(), state)),

  now: () => Date.now(),                                  // optional; injectable for tests

  // Optional providers, re-read on EVERY call so the agent always tracks the live human board.
  allowedStatuses: () => pipelineStagesFor(currentProject),   // defaults to TRACKER_STATUSES
  knownProjects:   () => Object.keys(readBoard().projects || {}),

  // Optional — and OMIT IT rather than returning [] when no index is available. [] means
  // "checked, and the session is not there" (verified:false); omitted means "not checked"
  // (verified:null). Those are different claims and the UI renders them differently.
  knownSessionIds: () => new Set(scanTranscripts().sessions.map(s => s.sessionId)),
})

await tracker.tracker_create({ title: '…' })              // → the same envelope the pure fn returns
await tracker.tracker_update({ id, expectedVersion, … })  // + persisted: true|false
await tracker.tracker_list({ status, project, … })        // never writes
await tracker.tracker_link_session({ id, sessionId })
tracker.schemas()                                          // tool descriptions, generated from the rules
```

Contract guarantees, all covered by tests: **no handler ever throws** (a missing/unreadable/
unwritable store returns `store_unavailable` / `store_read_failed` / `store_write_failed` with a
reason); `read()` is called fresh on every mutation, so compare-and-set runs against the live store
rather than a snapshot the caller happens to hold; `write()` is never called for a no-op.

If you prefer to own the read/write yourself, the pure functions are exported unchanged
(`trackerCreate(state, input, opts) → {ok, state, …}`) and `createTracker` is a thin wrapper over
them — use whichever fits the route.

### Board state ↔ tracker state

The human board persists `{tickets: [...]}` in `~/.claude/taskboard.json` (`readBoard()`/`writeBoard()`
in `server/index.mjs`). The tracker works on `{items: {id: item}, seq}`. Adapt at the boundary — do
not fork the file:

```js
import { trackerCreate, trackerUpdate, trackerList, trackerLinkSession, TRACKER_STATUSES } from '../lib/tracker.mjs'

const toTracker = board => ({ items: Object.fromEntries(board.tickets.map(t => [t.id, t])), seq: 0 })
const merge = (board, state) => { board.tickets = Object.values(state.items); return board }
```

Board tickets have no `version` field yet. `normalizeState()` handles that: it assigns `version: 1`
and **reports the repair** in `result.warnings` — the first compare-and-set against a legacy ticket
may therefore report a conflict once. That is intentional and preferable to inventing a version that
pretends the row has been tracked all along.

### Route shape (one per tool)

```js
app.post('/api/board/tracker/:tool', async (req, res) => {
  const fn = tracker['tracker_' + ({ create: 'create', update: 'update', list: 'list', link: 'link_session' }[req.params.tool] || '')]
  if (!fn) return res.status(404).json({ error: 'no such tracker tool' })
  const r = await fn(req.body)
  // 200 even on ok:false — the body IS the explanation, and a bare 400 turns a named, fixable
  // rejection ("unknown_status, allowed: […]") into "Bad Request" by the time src/lib/api.js is done
  // with it. Keep `error` + `reason` in the body; api.js already prefers them over statusText.
  res.json(r)
})
```

The route is this short *because* persistence is injected: read/write/pipeline/session-index all live
in the `createTracker` call above, and the handler has no state logic left to get wrong.

### Tool declarations

`trackerToolSchemas(pipe.stages)` generates the descriptions from the same constants the validators
enforce. Feed those into whatever registers tools (MCP server / agent definition) rather than
hand-writing the text — a description that drifts from the validator is the single biggest cause of
a model looping on the same invalid status.

### What the UI must render

- `result.warnings[]` — every cap that fired, every ignored field. Cheap to show in the ticket
  drawer; without it a truncated description silently reads as complete.
- `version_conflict` — show **both** versions (`expectedVersion` and `actualVersion`) and offer
  re-read-and-reapply. Do not auto-retry with the new version: that is last-write-wins wearing a
  costume.
- `item.unknown.project` — render as a real badge ("unscoped"). `BoardSection.jsx` filters tickets by
  project; an unscoped item is invisible in every project column and must be reachable, e.g. via a
  `project=null` list call, which `trackerList` supports explicitly.

---

## 092 — `lib/session-cards.mjs` → a Sessions board

### The data-source interface you must supply

`/api/sessions` has the cost/timing half; `scanTranscripts()` has `sessions[].files` (the touched-file
half). Nothing joins them today. Both are injected, so this module never imports the server:

```js
import { createSessionCardSource } from '../lib/session-cards.mjs'

const cardSource = createSessionCardSource({
  // REQUIRED. Rows shaped exactly like GET /api/sessions -> sessions[]: at minimum
  // {sessionId, project, cwd, branch, last, cost, durationMs, toolCalls, errors, transcript}.
  // Missing/unusable numeric fields are fine — they become null, never 0.
  readSessions: q => sessionRows({ days: Number(q.days) || 7 }),

  // OPTIONAL — and genuinely omit it when file activity is unavailable. Returning `{}` would assert
  // "every session touched nothing"; omitting it makes every card report "not recorded", which is
  // the truth. Same rule per session: a session that was NOT scanned must be ABSENT from the map,
  // not present with [].
  readFileActivity: () => Object.fromEntries(
    scanTranscripts().sessions.map(s => [s.sessionId, s.files])
  ),
})

app.get('/api/session-cards', async (req, res) =>
  res.json(await cardSource.build(req.query, { now: Date.now() })))
```

`build()` never throws: a failing `readSessions` yields an empty board carrying "EMPTY BECAUSE THE
READ FAILED", and a failing `readFileActivity` degrades every card to `unrecorded`. `result.sourcesOk`
tells the UI which halves are real. `buildSessionCards(sessions, activity, opts)` remains exported for
callers that already hold both datasets.

### Client

`<SessionCards sessions={d.sessions} fileActivity={d.activity} />` renders the columns, the
bidirectional links (click a path → the sessions that touched it) and every cap banner. It can be
dropped into `SessionsSection.jsx` as a second tab beside the existing table.

### Rules the wiring must not break

1. **Never pass `[]` for an unscanned session**, and never stub `readFileActivity` with `() => ({})`
   (see above).
2. `card.fileCount === null` must never be rendered as a number. The component enforces this; a new
   consumer must too.
3. `totals.filesTouched` is summed over measured cards only and carries `filesTouchedBasis` — render
   the basis next to the number, or the number becomes an unqualified claim about all sessions.
4. `CARD_LIMITS.files` (25 per card) and `CARD_LIMITS.sessions` (20 per file) are display caps.
   `fileCount` and `fileIndex[].total` always hold the true totals; show both.

### An upstream cap you inherit

`scanTranscripts()` does `rec.files = [...touched].slice(0, 500)` (`server/index.mjs`) with no flag on
the record. A session that touched 700 files arrives here as 500 with no way to know. Until that is
fixed, a card for such a session under-reports and *cannot say so*. The minimal fix at the source is
to record `filesTruncated: touched.size > 500 ? touched.size : null` alongside, and pass it through as
a card-level warning.

---

## 045 — `src/lib/dataScope.js` → scope every aggregate

### 1. Mount the control

Put `<ScopeBar projects={projects} />` in `App.jsx`'s topbar (next to the existing staleness chip).
It renders the active scope as a sentence at all times, including "all projects and sources (no
filter)" — a filtered page that looks global is a wrong number even when the fetch was perfect.

### 2. Route aggregate reads through the store

`src/lib/api.js` must not be edited, and it does not need to be. Anything that consumes an aggregate
switches from `api.get(url)` to `dataScope.fetch(url, undefined, { scopedParams: [...] })`, which
returns an envelope instead of a bare payload:

```js
useEffect(() => {
  let alive = true
  dataScope.fetch('/api/overview', undefined, { scopedParams: ['project'] }).then(r => {
    if (!alive) return
    if (r.stale) return                 // the old scope's numbers — there is no `data` to render
    if (!r.ok) { toast(r.reason, 'error'); return }
    setData({ ...r.data, scope: r.scope, describe: r.describe })
  })
  return () => { alive = false }
}, [scope.generation])                  // re-fetch on every scope change
```

`fetchImpl` defaults to `globalThis.fetch`. To keep the existing staleness chip, error toast and
`fresh=1` behaviour, pass `api.get` as the implementation instead:
`dataScope.fetch(url, undefined, { fetchImpl: api.get })` — it is called as `impl(url, init)` and its
resolved value becomes `r.data`.

### 3. Declare what each endpoint actually honours

`scopedParams` is the list of query params the endpoint really narrows by. Today only `project` is
read by the express routes (`req.query.project` in `/api/board`, `/api/board/analytics`,
`/api/forensics`, …); there is no `source` dimension server-side yet. Passing `scopedParams` makes the
gap explicit: the result carries `unenforced: ['source']` and `ScopeBar` renders "this panel does not
narrow by source — the numbers below are wider than the heading". Omit `scopedParams` and
`unenforced` is `null`, which the bar renders as "scope enforcement unverified" — unknown, not "fine".

### 4. Render the scope the data was fetched under

Use `<ScopeHeading title="Cost" scope={data.scope} />`, not the *current* scope. Between a scope
change and the next response landing, the current scope and the displayed numbers disagree, and the
heading must follow the numbers.

### 5. Cache interaction

`server/index.mjs` TTL-caches these endpoints (`/api/overview` 300 s, `/api/forensics` 600 s) keyed by
full URL, so scoped URLs cache independently — no change needed. It is also *why* generation
cancellation matters: a cache miss on a 600 s aggregate can easily outlive two scope changes.

---

## Things found in existing code while wiring this

These are observations, not changes — no existing file was touched.

1. **`server/index.mjs` (~2401) `rec.files = [...touched].slice(0, 500)`** — silent per-session cap on
   touched files, with nothing on the record to say it fired. Every consumer (`/api/search`'s
   `?file=` filter, and now session cards) reports a truthful-looking subset.
2. **`/api/search`** returns `files: (s?.files || []).slice(0, 5)` per hit — a second silent cap on top
   of the first.
3. **`GET /api/sessions`** does `limit = Math.min(200, Number(req.query.limit) || 20)` and slices, with
   no `truncated`/`more` flag. `totals.sessions` does hold the full count, so the two can be compared,
   but only by a caller who knows to.
4. **`PATCH /api/board/tickets/:id`** copies `['title','desc','team','model','deps','qa','type']`
   straight from `req.body` with no type validation, and accepts **any** string as `stage`. Because
   `BoardSection.jsx` renders `extra` stages (any stage not in the pipeline) as additional columns, a
   typo'd stage silently creates a new column containing one ticket. This is the human-facing twin of
   the failure `lib/tracker.mjs` guards against, and the same `validateStatus(status, pipe.stages)`
   would fix it.
5. **No versioning on ticket writes.** PATCH is unconditional last-write-wins; the 5 s poll in
   `BoardSection.jsx` plus a background agent run makes a lost edit ordinary rather than rare.
6. **`POST /api/board/tickets`** silently truncates `desc` to 20 000 chars, and `blockT()` truncates
   `reason` to 1 500 — neither reports the truncation to the caller.
7. **`useProjects()` in `BoardSection.jsx`** does `d.scopes.filter(...)` inside `.then()` with a
   `.catch(() => {})`; if the shape ever changes, the section renders "no projects" forever with no
   error anywhere.
