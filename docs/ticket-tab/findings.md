# Ticket tab — codebase findings

Date: 2026-07-27
Status: verified against source, not agent-reported

Everything below was read out of the repository directly. Each claim carries a `file:line` so it can
be re-checked rather than trusted. These findings constrain the design; several of them overturn
assumptions that a first pass at this feature would have made.

---

## 1. The feature is ~40% already built, in the wrong place

`server/eng.mjs` already fetches a ticket and already generates acceptance criteria and test cases.

| Piece | Where | What it does |
|---|---|---|
| `ticketDetail(cfg, key)` | `server/eng.mjs:1221` | `GET /issue/{key}?expand=renderedFields,changelog` → summary, type, status, description, comments, status/assignee/Sprint history, and linked PRs (with changed file paths + commit subjects). 10-minute TTL cache. |
| `GEN.ac` / `GEN.tests` | `server/eng.mjs:1237-1238` | The generation prompts. |
| `genPrompt(kind, d)` | `server/eng.mjs:1240` | Assembles ticket + comments + PR context into the prompt. |
| `claudeMarkdown(prompt)` | `server/eng.mjs:1244` | `spawnSync('claude', ['-p', …, '--output-format','json'])`. |
| Artifact store | `server/eng.mjs:1191-1193` | `eng-artifacts.json`, keyed by JIRA key, with `inputHash` + `edited`. |
| Routes | `server/eng.mjs:1419-1450` | `GET /api/eng/ticket/:key`, `POST …/generate`, `PUT …/artifact`. |

**The problem is reachability, not capability.** The only UI for this is `TicketDetail` at
`src/sections/EngDashboard.jsx:592` — a 560px overlay drawer opened by clicking a row in the Sprint
analytics board. Reaching that row requires a fully configured project *and* a completed
`snapshotAll()`, which the module's own comment at `server/eng.mjs:987` describes as **"~65s of live
JIRA + GitHub"**. There is no way to type a ticket key and go.

That is the real gap, and it is a much narrower and more defensible one than "build a ticket tab".

**1a. The 65-second cost is inside `ticketDetail` itself — so a key-first tab does NOT fix it for
free.** This is the finding that most changes the build. `server/eng.mjs:1228`:

```js
const snap = await snapshot(cfg).catch(() => null)
const prsRaw = (snap?.prs || []).filter(p => p.ticket === key)
```

`ticketDetail` awaits a **full project snapshot** purely to attach linked-PR context. Any new tab
that calls the same function pays the same ~65 seconds on a cold cache. The proposal's single
strongest justification — "type a key and go" — is therefore *not delivered* by adding a tab; it is
delivered by making that `snapshot()` call opportunistic. Serve ticket content, comments and history
immediately, attach PR context only when the snapshot is already warm, and label it honestly when it
is not (honesty rule 1, `README.md:375` — "not measured" and "measured, and it is zero" are
different facts).

**1b. `cfgFor` silently guesses the project.** `server/eng.mjs:1194`:

```js
const cfgFor = key => { const projs = loadProjects(); return projs.find(p => p.key === (key || '').toUpperCase()) || projs[0] }
```

The `|| projs[0]` fallback means a key belonging to a non-default project resolves against the wrong
config — wrong JIRA host, wrong repo — with no error. For a key-first entry point, where the key is
the *only* input, this becomes the primary failure path rather than an edge case. The project must
be derived from the key prefix.

## 1c. There is already a second, much larger ticket pipeline

`server/index.mjs` carries a full agent workflow over its own notion of a ticket:

| Route | Line | Stage |
|---|---|---|
| `POST /api/board/tickets/:id/analyze` | `:4237` | agent explores the codebase, proposes a breakdown |
| `POST …/breakdown` | `:4255` | accept a possibly hand-edited breakdown → child tickets |
| `POST …/start` | `:4310` | provisions a git worktree, runs a dev agent |
| `POST …/review` · `…/fix` · `…/qa` · `…/release` | `:4313`, `:4347`, `:4411`, `:4463` | the rest of the pipeline |

The proposed "generate a system design plan" step is materially `analyze` with a different prompt.
Building it in isolation creates **two unrelated ticket objects** — a JIRA one and a board one — that
know nothing about each other. Whatever gets built must hand off to this pipeline rather than
compete with it.

## 1d. The repo has a documented history of deleting exactly this kind of tab

`README.md:411-414`: five adversarial audits found **"32,757 LOC across 4 separate SPA shells and 81
leaf panels serving about 4 real jobs"**, with 48% of frontend modules having exactly one commit, and
names the cause: *"The repo's characteristic verb was demote, not delete, which is how 81 panels
accumulated."* `README.md:448` records the correction: **~15,300 lines and 100 endpoints removed**.

`src/App.jsx:48-110` currently defines 13 top-level sections. A 14th whose first steps duplicate two
existing surfaces is the textbook next entry on that list. This is not an argument against building
it — it is the bar it has to clear: the tab must be the *fastest* path to a ticket, and it must
produce an artifact that **outlives the tab**.

## 2. Three real bugs in the code that already exists

**2a. Hand-editing permanently disables the staleness check.** `withStale`
(`server/eng.mjs:1423`) reads:

```js
!art[kind].edited && art[kind].inputHash !== hashOf(genPrompt(kind, d))
```

and the PUT handler at `server/eng.mjs:1448` sets `edited: true` without ever refreshing
`inputHash`. So the moment you improve a generated artifact by hand — the moment it becomes
*worth keeping* — it can never be flagged stale again. The better the artifact, the less it is
monitored. That is backwards, and it silently violates honesty rule 2 in `README.md:378` ("no green
tick over an absent source").

**2b. The staleness hash over-fires.** `genPrompt` (`server/eng.mjs:1242`) interpolates `d.status`,
every comment body, and per-PR commit subjects fetched live via `gh pr view` (`prCommits`,
`server/eng.mjs:1211`). So a To-Do → In Progress transition, a teammate's "+1" comment, or one new
commit flips the artifact to "⚠ ticket changed since this was generated"
(`src/sections/EngDashboard.jsx:705`) while the actual requirement is untouched. High-frequency
false positives train the user to ignore the badge, which destroys the signal for the case that
matters. It should hash the requirement — `summary + description` — not the whole prompt.

**2c. The generator cannot read any repository.** `claudeMarkdown` (`server/eng.mjs:1245`) is:

```js
spawnSync('claude', ['-p', prompt, '--output-format', 'json'], { timeout: 180_000, … })
```

No `cwd`, and no permission flag. It is the **only** `claude` spawn site in this repo that passes
neither — compare `server/index.mjs:915`, `:1052`, `:1960`, and `runAgent` at `:4114`, all of which
pass `cwd` and most of which pass `--dangerously-skip-permissions`. It therefore inherits the
dashboard's own working directory and, in `-p` mode without a permission flag, cannot complete tool
calls that need permission. It is a text-in / text-out box by construction.

This matters enormously for the design-generation step: a design produced by an agent that cannot
read the codebase is autocomplete with a JIRA prompt attached.

**2d. Comment bodies are silently rendered as `"[object Object]"`.** The most damaging of the four,
because it corrupts the input to every generated artifact rather than just a display.

`server/eng.mjs:1227`:

```js
const comments = (rf.comment?.comments || iss.fields.comment?.comments || [])
  .map(c => ({ …, body: htmlToText(c.body) }))
```

Jira Cloud REST v3 returns comment bodies as **ADF** (Atlassian Document Format — a ProseMirror JSON
tree, `{type:'doc', version:1, content:[…]}`). `expand=renderedFields` renders `description` to HTML
but **does not render comment bodies**; the documented way to get HTML for a comment is
`expand=renderedBody` on the comments endpoint, which this code never calls. So `c.body` is a JSON
object, and `htmlToText` (`server/eng.mjs:1198`) begins with `String(html)`.

Reproduced locally:

```
ADF body  -> "[object Object]"
HTML body -> "The retry must be idempotent."
```

Because `genPrompt` (`server/eng.mjs:1242`) interpolates `d.comments.map(c => …c.body)` into the
generation prompt, **every AC and test plan generated to date was produced from
`- Alice: [object Object]` for each comment.** On a thin ticket the comment thread is usually the
most requirement-dense content available, so this quietly removes the best input the generator has —
and it does so invisibly, because the output still looks confident and well-formed.

Fix: walk the ADF tree to text (a ~40-line recursive walker over `content[]`, honouring `text`,
`paragraph`, `bulletList`/`listItem`, `codeBlock`, `table`, `heading`, and `hardBreak`), and keep
`htmlToText` only for the `renderedFields.description` path. Detect which one you have by checking
`body?.type === 'doc'` rather than guessing.

## 3. Two capabilities already exist that make the hard steps buildable

A first pass at this feature would conclude that "generate a system design against my repo" and
"show how data flows between the files" are blocked on config the app does not have. Both are wrong.

**3a. The local checkout is already resolvable.** `localCloneOf(repo)` at `server/index.mjs:3218`:

```js
function localCloneOf(repo) {
  const [owner, name] = repo.split('/')
  let dirs = []
  try { dirs = Object.keys(readClaudeJson().projects || {}).filter(d => d !== HOME && fs.existsSync(d)) } catch {}
  for (const d of dirs) { const o = originOf(d); if (o && o.replace(/\.git$/, '').endsWith(`${owner}/${name}`)) return d }
  return dirs.find(d => path.basename(d) === name) || null
}
```

It maps a GitHub `owner/name` slug to a local checkout by matching git `origin` remotes across every
registered project directory, with a basename fallback. `projects.json` **already carries
`githubRepo`** per project (`projects.example.json`, and `normalizeProject` at
`server/eng.mjs:66`). So the repo path needs no new configuration field — it is derivable today.

**3b. A real import graph already exists.** `server/fe.mjs:128` exports
`buildImportGraph(sources, fileSet, aliasRoot)`, alongside `extractImports` (`:81`) and
`resolveSpecifier` (`:105`), which handle relative imports, `@/` and `~/` aliases, index resolution,
implicit extensions and dynamic `import()`. So "how data flows between these files" can be
**derived from actual imports** for files that exist, instead of being invented by a model.

This splits the files/data-flow step cleanly into **verified** (the file exists; here are its real
importers and imports) and **predicted** (the plan says this file will be created). That split is
exactly what honesty rule 2 demands, and it turns the weakest-looking step into one that produces a
genuine finding: *"this design proposes creating four files, one of which already exists."*

**3c. The right generation primitive already exists.** `runAgent` at `server/index.mjs:4109`:

```js
function runAgent({ cwd, prompt, model, timeoutMs = 1800_000, resume }) { … }
```

Async `spawn`, real `cwd`, `--dangerously-skip-permissions`, a 30-minute default timeout, plus
`sessionId` capture (enabling `claude --resume`), and `cost` / `turns` accounting. It is strictly
the correct primitive for a design run and it is already written and in use.

## 4. Constraints that shape the build

- **`docs/` is gitignored but `docs/superpowers/**` is tracked.** `.gitignore:21` lists `docs/`, yet
  `git ls-files docs/superpowers/` returns all six spec and plan files — they were force-added.
  Anything this feature writes into `docs/` needs `git add -f` or it will silently never be committed.
- **No graph library exists.** `package.json` dependencies are react, react-dom, d3, marked, yaml,
  express, and codemirror packages. The closest prior art is `src/sections/PlanGraph.jsx` — 364 lines
  of absolutely-positioned node `div`s over an SVG bezier edge layer with an arrow marker and a 340px
  inspector panel. It is **read-only**: no pan, no zoom, no editing.
- **Every colour must be a CSS variable.** `src/styles.css:1-8` states it outright: the light theme is
  a pure variable swap, so a raw hex anywhere breaks it. `prefers-reduced-motion` kills all animation
  (`src/styles.css:666`) and is described as "not negotiable".
- **The artifact store is a single flat JSON rewritten whole on every save** (`writeArtifacts`,
  `server/eng.mjs:1192`), with no versioned write and no backup.
- **Generated artifacts currently have no exit.** `TicketDetail` offers only edit / generate /
  regenerate (`src/sections/EngDashboard.jsx:692-710`) — no copy, no download, no post-to-JIRA — even
  though `useCopy` is already in scope at `:598` and `src/eng/Export.jsx:24-28` implements copy-markdown,
  copy-as-Slack and download-`.md` in the same app.

## 5. What these findings imply

1. The tab's justification is **reachability** — key-first entry with no snapshot dependency — plus
   the steps that genuinely do not exist yet (design, diagram, files/data-flow). It should not be
   pitched as adding AC/test generation, which exists.
2. Design generation must run through `runAgent` with `cwd = localCloneOf(githubRepo)`, not through
   `claudeMarkdown`. Without a real `cwd` the marquee deliverable is not worth building.
3. The files view must distinguish verified from predicted, and say "not configured" when no local
   checkout resolves — never guess.
4. The three staleness/generation bugs above should be fixed as part of this work, because the new
   feature inherits all of them.
