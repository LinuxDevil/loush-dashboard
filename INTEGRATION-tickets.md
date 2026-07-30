# INTEGRATION — tickets 094, 112, 113

Everything in this change is **new files only**. No existing file was edited, so nothing here is
wired up yet. This document is the wiring that a follow-up commit has to do, and the list of things
that were missing from the tree when the work was written.

| Ticket | New module | Tests |
|---|---|---|
| 094 — structured acceptance criteria | `lib/acceptance-criteria.mjs` | `test/lib/acceptance-criteria.test.mjs` (20) |
| 112 — hook installation bundles | `lib/hook-bundles.mjs` | `test/lib/hook-bundles.test.mjs` (17) |
| 113 — agent-routing policy | `lib/routing-policy.mjs` | `test/lib/routing-policy.test.mjs` (25) |
| 094 (UI) | `src/ui/criteriaParts.jsx` | covered indirectly; `npx vite build` passes |

---

## Files that do not exist in this worktree

This branch was cut from an older commit than the target branch. The following were referenced by
the brief but are **not present here**, so nothing below imports them by path:

| Missing path | Consequence for this change |
|---|---|
| `lib/complexity.mjs` (exports `classifyConversation`, `tierDistribution`) | 113's complexity override takes the classifier as an **injected parameter** (`opts.classifier`) against a published contract, rather than importing a module it cannot see. See "Wiring 113" below for the one line that connects them. |
| `lib/subagent-rollup.mjs` | Cited as the precedent for labelling modelled numbers. The pattern was applied from the description instead: `modelledCostEffect()` returns `modelled: true` plus an `assumption` string stating what was assumed and that nobody ran it. If the real file uses different key names, rename to match it — one convention, not two. |
| `server/board.mjs` | Not needed by this change, but note `server/ticket.mjs:918` self-`fetch`es `/api/board/tickets`, which presumably lives there. Untestable from this tree. |

An earlier draft of this work created `lib/complexity.mjs` locally. **It was deleted** — a second
classifier that disagreed with the real one is the exact failure 113 was written to prevent, and it
would also have collided at merge.

---

## 094 — wiring the structured acceptance criteria

Today `server/ticket.mjs` stores the AC artifact as a markdown blob at `artifacts[key].ac.md`, and
`server/ticket.mjs:912` concatenates it verbatim into the board hand-off. Nothing needs to change
about that storage on day one — the parser is a **view over the existing blob**, which is what makes
this migration reversible.

**Server (`server/ticket.mjs`)**

1. `import { parseMarkdownCriteria, renderMarkdown } from '../lib/acceptance-criteria.mjs'`.
2. Wherever the AC artifact is served to the client, attach the parse alongside the raw markdown —
   never instead of it:
   ```js
   const parsed = parseMarkdownCriteria(art.ac?.md ?? '')
   res.json({ ...art.ac, structured: parsed.ok ? parsed : null, structuredError: parsed.ok ? null : parsed.reason })
   ```
   Keeping `md` is the rollback: if the parser is ever wrong, the source of truth is untouched.
3. New route to persist ticks, storing **items** next to (not in place of) `md`:
   ```js
   // PUT /api/ticket/:key/ac/items  → { items }
   const md = renderMarkdown(req.body.items)
   if (!md.ok) return res.status(400).json({ error: md.reason })
   writeArtifacts({ ...art, ac: { ...art.ac, md: md.md, items: req.body.items } })
   ```
   `renderMarkdown` round-trips, so `ac.md` stays the canonical artifact and the JIRA comment path at
   line 912 keeps working with **no change at all**.
4. On regeneration, call `diffCriteria(oldItems, newItems)` and return its result. It reports which
   ids vanished and how many of those were ticked. **Do not auto-carry ticks across a lost id** — an
   id changes when the text is edited, and the module cannot tell "edited" from "deleted".

**Client (`src/sections/TicketSection.jsx`)**

`META` at line 406 already treats `ac` and `tests` as one artifact class. Render `<CriteriaPanel>`
from `src/ui/criteriaParts.jsx` in the `ac` branch, falling back to the existing markdown viewer
when `structured` is null:

```jsx
import { CriteriaPanel } from '../ui/criteriaParts.jsx'
// …
{kind === 'ac' && art.structured
  ? <CriteriaPanel parsed={art.structured} onChange={items => saveItems(key, items)} onExport={download} />
  : <MarkdownView md={art.md} />}
```

`src/ui/criteriaParts.jsx` imports `lib/acceptance-criteria.mjs` **directly** (it is dependency-free
and hashes ids with a pure function for exactly this reason). Do not add a `src/lib/` copy — the
server and the browser must agree about which id a criterion has, or a tick lands on the wrong row.

**Properties to preserve if you touch the parser**

- an unparseable line is KEPT as `kind:'unstructured'` with a `reason`, never dropped;
- ids are stable across re-parses of the same content, and change when the text changes (documented
  cost, tested both ways);
- `parse → render → parse` is a fixed point;
- unknown enum values are rejected by name with the allowed set listed;
- fields the markdown never carried (`priority`, `automated`, `validation_method`) are `null` with a
  `field_reasons` entry — never defaulted.

---

## 112 — wiring the hook bundles

The real hook config shape is `settings.hooks[event] = [{ matcher, hooks: [{type, command, timeout}] }]`
(`server/index.mjs:344` reads it, `:356` writes it, `:437` keys it, `:3712` appends to it).
`lib/hook-bundles.mjs` produces exactly that and nothing else — it does no I/O.

**Server (`server/index.mjs`, next to the existing `/api/hooks/*` routes at ~:3694)**

```js
import { listBundles, planInstall, installBundle, uninstallBundle, installedBundles } from '../lib/hook-bundles.mjs'

app.get('/api/hooks/bundles', (req, res) => res.json({ bundles: listBundles(), installed: installedBundles(readJson(settingsFileFor(req.query.scope || 'global'), {})) }))

app.post('/api/hooks/bundles/:id/plan', (req, res) =>
  res.json(planInstall(readJson(settingsFileFor(req.body.scope || 'global'), {}), req.params.id, { overwrite: !!req.body.overwrite })))

app.post('/api/hooks/bundles/:id/install', (req, res) => {
  const file = settingsFileFor(req.body.scope || 'global')
  const r = installBundle(readJson(file, {}), req.params.id, { overwrite: !!req.body.overwrite })
  if (!r.ok) return res.status(409).json(r)          // 409 carries `conflicts`, each naming the existing hook
  const content = JSON.stringify(r.settings, null, 2)
  if ((req.body.scope || 'global') === 'global') return res.json({ ok: true, proposed: propose(file, content, `install hook bundle "${req.params.id}"`) })
  track(file, content, { scope: req.body.scope, summary: `install hook bundle "${req.params.id}"` })
  res.json({ ok: true, installed: r.installed })
})

app.post('/api/hooks/bundles/:id/uninstall', (req, res) => { /* same shape, uninstallBundle */ })
```

Reuse the existing `propose` / `track` split at `:3717-3720`: global config stays the user's to
approve. **Do not add an `{overwrite:true}` default anywhere** — a 409 with named conflicts is the
feature, not an obstacle to route around.

**Client (`src/sections/HooksSection.jsx`)**

A bundle card per `listBundles()` entry, with a one-click install that calls `/plan` first and, on
conflicts, shows the returned `existing.commands` verbatim before offering an Overwrite button.
`plan.coexisting` and `plan.already` should also be shown — they are not blockers but they are
surprises. `uninstallBundle().keptModified` must be rendered: those are hooks the user edited, which
are deliberately left behind.

**Cross-platform note.** Every bundled hook body is `node -e "…"`. `validateBundle()` fails a bundle
containing `sh -c`, a backtick, `$(`, `$VAR` or `%VAR`, and there is a test asserting it. The
existing `require-tests-before-stop` entry in `HOOK_LIBRARY` (`server/index.mjs:3686`) **is** a
`sh -c` script and is a silent no-op on Windows — `code-quality/tests-before-stop` in this bundle is
a drop-in Node replacement for it.

---

## 113 — wiring the routing policy

`lib/routing-policy.mjs` deliberately has **no classifier of its own**. Pass the repo's one in:

```js
import { classifyConversation } from './complexity.mjs'         // exists on the target branch
import { route, checkShadowing, modelledCostEffect } from './routing-policy.mjs'

const r = route(taskText, { classifier: classifyConversation })
```

The contract is published as `CLASSIFIER_CONTRACT`. The classifier may return a complexity level
(`trivial|moderate|complex`), a model tier (`haiku|sonnet|opus`), or an object carrying either.
Because `lib/complexity.mjs` reports a **tier**, `normalizeComplexity()` maps tier→level by position
and **says so** in `override.assumption`. If that mapping is wrong for the real classifier, pass an
adapter returning `{ level }` rather than changing the mapping silently:

```js
const classifier = t => ({ level: myMapping(classifyConversation(t)), reason: 'adapted from classifyConversation' })
```

Behaviours to keep:

- **No classifier injected ⇒ the override does not run**, and the route says
  `override.classifier: 'absent'` with a reason. It never falls back to a private guess.
- A classifier that throws, or returns something unrecognised, is reported as "not classified" —
  never coerced to `moderate`, never treated as simple.
- A task matching no rule gets `DEFAULT_ROUTE` with `isDefault: true` and a reason saying the table
  has a hole. `routeAll().unmatched` is the number to watch.
- **Run `checkShadowing()` in CI or on the settings screen.** It reports rules that can never fire
  and rules that fire for less than they appear to. A shadowed row is never removed from the table
  automatically — it is reported, and the author decides.
- `modelledCostEffect()` ships **no prices**; the caller supplies `{haiku, sonnet, opus}` per-task
  prices or it refuses. Its result carries `modelled: true`, `measured: false`, `is_prediction: false`
  and an `assumption` string. Render it with that label attached, or do not render it. Nothing in
  this module claims the policy saves money, and there is no outcome data in this repo that could
  support such a claim.

Where to surface it: the routing table is an editable policy artifact, so it belongs next to the
other governance surfaces (`src/sections/GovernanceSection.jsx`), with `checkShadowing()` output
rendered as warnings under the table.

---

## Running the tests

```
node --test test/lib/acceptance-criteria.test.mjs test/lib/hook-bundles.test.mjs test/lib/routing-policy.test.mjs
npx vite build      # for src/ui/criteriaParts.jsx
```
