# 2 — Compare: blind side-by-side model testing and synthesis — DONE

**Status: done**

## What was implemented

`server/compare.mjs` runs one prompt against up to six models through the existing
`runAgent` from `lib/agent.mjs` (`Promise.all`, one pane per model, a failed model becomes a pane
carrying its `error` rather than being dropped), shuffles the models onto labels A…F with a
permutation, and persists one JSON file per comparison under `~/.claude/dashboard-compare/<id>.json`.
The blind property is enforced in a single `view()` function: no read serves the label→model mapping,
the per-pane model name, or the per-pane cost/latency/turns until a vote is recorded.
`src/sections/CompareSection.jsx` is the one-component UI — prompt box, project selector, comma
separated model list, N panes rendered with `src/ui/Markdown.jsx`, a vote button per pane, reveal
with the scoreboard, a synthesise button and the past-comparisons list.

## API as implemented

```
POST   /api/compare            {cwd, prompt, models:[...]}  → {id}
GET    /api/compare                                          → [{id, prompt, at, models:<count>, voted}]
GET    /api/compare/:id                                      → {id, prompt, cwd, at, voted, vote, synthesis,
                                                                panes:[{label, text, error, model, cost, ms, turns}],
                                                                mapping?}     // key ABSENT until voted
POST   /api/compare/:id/vote   {label}                       → {ok:true, vote:{label,model,at}, mapping}
POST   /api/compare/:id/synthesize  {model?}                 → {text, model, cost, ms, at}
DELETE /api/compare/:id                                      → {ok:true}
```

Deliberate decisions inside that shape:

- **Pre-vote, `model`/`cost`/`ms`/`turns` are served as `null`, and `mapping` is absent entirely.**
  The brief's contract lists `cost/ms/turns` on the pane, so the keys stay in the payload for a
  stable client shape — but the *values* are withheld with the name. Opus and Haiku are told apart
  by price and latency alone, so serving the numbers before the vote de-anonymises the panes as
  thoroughly as printing the name. Asserted in the test.
- `GET /api/compare` returns `models` as a **count**, never the names: the list is read before
  voting too.
- Vote twice → **409**. Unknown label → **400** naming the valid labels. Synthesise before a vote →
  **409** (the synthesis is written by a named model, so producing it would reveal one). Synthesise
  when every model errored → **409**.
- `synthesize` defaults to the **voted winner's** model and accepts an optional `{model}` override.
- `:id` is validated against `/^[a-z0-9]{6,12}$/` in `fileFor()`, which is the only place a path is
  built, so every route that takes an id is covered. Ids are `randomBytes(5).toString('hex')`.
- `POST /api/compare` blocks until every model answers. v1 is non-streaming — `runAgent` is buffered
  and returns no handle, so there is nothing to poll and no partial pane to show. Same shape as the
  existing `await runAgent(...)` handlers in `server/ticket.mjs`.
- `cwd` must be an absolute path to an existing directory. `dashboard-core.safe()` was **not** used:
  it restricts paths to `~/.claude`, and `cwd` here is a user repo.

## Files changed

- `server/compare.mjs` — the whole feature server-side: six routes, label permutation, blind `view()`,
  JSON-file persistence, request validation.
- `src/sections/CompareSection.jsx` — one component: run form, N panes via `Markdown.jsx` with
  `Tabs` from `src/ui/tabs.jsx` as the narrow-viewport control, vote/reveal/synthesise, history list.
- `src/styles/compare.css` — pane grid driven by an inline `--cmp-n`, pane/stat/badge/row styles, and
  the `max-width: 900px` block that collapses the panes to one tab at a time.
- `test/server/compare.test.mjs` — new. 16 tests, all passing.

## Odysseus source consulted

`/Users/ali.mohammad/learnspace/loushai/odysseus/routes/compare/compare_routes.py` was read while
writing **`server/compare.mjs`**, which therefore carries the attribution header required by NOTICE
clause 1, plus the §5(a) statement of what changed (two models over streaming chat sessions bound to
per-user model endpoints → N models through the local `claude` CLI; upstream's endpoint/api-key
ownership scoping dropped as having no analogue here).

`static/js/compare/*` was **not** read. `CompareSection.jsx` and `compare.css` were written from the
capability description and `docs/compare.webm`, and say so in their headers using the
`lib/chat-protocol.mjs` wording, so clause 1 does not attach to them.

## Deviations and notes

- **`useFetch` does not exist in this repo.** The rule "use `useState` and `useFetch`" was satisfied
  as far as it applies: all local state is `useState`, and fetching goes through `src/lib/api.js`
  (`api.get/post/del`) inside `useEffect`, which is what every other section does.
- **Error styling uses `--accent`, not `--red`.** The brief restricted CSS to
  `--bg-* --text-* --border-* --accent --r-card --r-ctl --mono`; `--red` exists in `styles.css` but
  is outside that list. `.cmp-err` is therefore marked by a monospace face and an `--accent` left
  rule. One line in `compare.css` flips it to `--red` if that restriction was only about not
  inventing tokens.
- **One component in the section file.** The brief allows exactly three files, so a `<Pane>`
  sub-component had nowhere to live without breaking the one-component-per-file rule. The file is
  180 lines.
- **A test file was created** (`test/server/compare.test.mjs`) even though this agent normally does
  not write tests: the sub-ticket's "## Test" section names the file and requires the blind
  assertion, and the lead's brief repeated it.
- The model list is a comma-separated text input with a `opus, sonnet` default — no catalogue, per
  the skip list.
- Skips are recorded in a `ponytail:` comment at the top of both `server/compare.mjs` and
  `CompareSection.jsx`: no provider probes, no model catalogue, no ELO, no streaming panes.

## Degraded tooling

`graphify` and `ponytail` were **not available** as skills in this agent's toolset — ran degraded.
Context was gathered with grep/read against the named similar-pattern files (`server/todos.mjs`,
`test/server/todos.test.mjs`, `src/sections/PromptStudio.jsx`, `src/sections/LibrarySection.jsx`,
`src/ui/tabs.jsx`, `src/ui/Markdown.jsx`, `src/lib/api.js`), and minimality was judged manually.
`docs/loush-orchestrator-contract.md` does not exist anywhere in this worktree or the parent
checkout, so the contract could not be read; the dependency gate was satisfied by inspection —
brief 2 lists no dependencies and all three owned files were present as wired stubs.

## Verification

- `node --check server/compare.mjs` — clean.
- `node --test test/server/compare.test.mjs` — **16/16 pass**.
- `npx vite build` — succeeds, 755 modules.
- Dev server not started; full `npm test` not run, per the brief.

## Needs review

- The pre-vote nulling of `cost`/`ms`/`turns` is stricter than the literal contract line. If the
  intent was to show the numbers while hiding only names, one `view()` line reverses it — but the
  blind property is weaker for it.
- The default synthesis model being the vote winner is a judgement call, not something the brief
  specified.
- A run holds the HTTP request open for as long as the slowest model takes (up to `runAgent`'s
  30-minute timeout). Acceptable for a local tool and consistent with `server/ticket.mjs`; it is the
  first thing streaming would fix.

```json
{ "sub_ticket": "2", "status": "complete",
  "files_changed": ["server/compare.mjs", "src/sections/CompareSection.jsx", "src/styles/compare.css", "test/server/compare.test.mjs", "docs/odysseus-port/2-done.md"],
  "ac_covered": ["POST/GET/GET:id/vote/synthesize/DELETE routes", "Promise.all over runAgent with error panes", "mapping withheld until vote (asserted)", "id validated against /^[a-z0-9]{6,12}$/ (asserted)", "models 1..6 non-empty array validated", "synthesize 409 before vote", "persistence to ~/.claude/dashboard-compare/<id>.json", "panes via Markdown.jsx + tabs.jsx for narrow viewports", "vote button per pane, reveal cost/latency/turns", "past comparisons list", "skips noted in ponytail: comment", "test/server/compare.test.mjs"],
  "ac_not_covered": [],
  "notes": "graphify/ponytail skills unavailable — ran degraded; pre-vote cost/ms/turns nulled as well as model names, which is stricter than the contract line" }
```
