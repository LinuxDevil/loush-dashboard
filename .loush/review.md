# PR Review — claude/merge-md-output-files-wwp0k3
**Ticket:** none — the spec is `docs/odysseus-port/{1,2,3,4}.md` plus `docs/plan-odysseus-features.md`
**Head SHA:** 0f8a09a1e09d57e755833db8863350e6b860c17a
**Reviewed at:** 2026-07-31T15:09:44+03:00
**Diff range:** 4d9922e..0f8a09a (excluding the unrelated `main` merge 6e8897b)
**Skills:** graphify degraded (no Skill tool exposed in this agent context — used grep/glob/git instead) · ponytail degraded (minimality judged manually)

## Summary

This is strong, unusually well-reasoned work. Every module carries a written security model, the
licence audit is genuinely thorough, and the four briefs are implemented close to the letter — the
blind property in Compare, the run-state-on-the-server design in Research, and the
returns-text-never-writes shape of `ai-edit` are all real and mostly enforced rather than merely
asserted in comments. Test coverage is above this repo's norm (16 + 16 + 5 + 7 tests).

It is not mergeable yet. The docs path guard has a proven escape (a **dangling** symlink inside the
root passes every check and the subsequent `writeFileSync` follows it, creating a file outside the
root — verified, not theorised), and the research lifecycle has a state where a killed or crashed
run reports `done`. Both are exactly the invariants the briefs single out as the ones worth
engineering against, and both sit in the blind spot of the existing tests. Six findings block; the
rest are quality.

## Findings

### 🔴 Blockers

#### 🔴 A dangling symlink inside the docs root defeats the path guard, and `PUT` writes through it
- **Severity:** Critical
- **Axis:** security
- **Scope:** file
- **File:** server/docs.mjs:76-118 (`realOrNearest`, `resolveDocPath`), exploited at server/docs.mjs:219-227
- **Problem:** `realOrNearest` walks up to the *deepest existing ancestor*, and `fs.realpathSync`
  throws `ENOENT` for a symlink whose target does not exist. So for `root/note.md → /outside/pwned.md`
  (target absent), `realpathSync(root/note.md)` throws, the walk falls back to `root`, and the
  function returns the **lexical** path `root/note.md`. `isInside` then passes, and `resolveDocPath`
  returns `{ok:true}`. `PUT /api/docs/file` calls `fs.writeFileSync(t.abs, …)`, which opens with
  `O_CREAT|O_WRONLY` and *follows the symlink*, creating the file at the target outside the root.
  Verified against the real export:

  ```
  guard verdict: {"ok":true,"abs":".../probe/root/note.md","rel":"note.md","ext":"md"}
  outside dir now: [ 'pwned.md' ]
  content of outside/pwned.md: ESCAPED
  ```

  Live symlinks are all correctly refused (`a.md`, `dir/new.md`, `dir/exists.md` → `symlink-escapes-root`),
  which is why the test at test/server/docs.test.mjs:59 passes and misses this: it only builds
  symlinks with existing targets. The extension check does not help — the `ext` comes from the link
  name inside the root, not the target, so `note.md → ~/.zshenv` passes. Overwriting a *pre-existing*
  outside file is not possible (that target resolves and is caught), but arbitrary file *creation*
  outside the root is, and creating `~/.zshenv`/`~/.bash_profile` where none exists is code
  execution on the next shell. A dangling symlink in a docs tree is not exotic: git checkouts carry
  symlinks, and `DASH_DOCS_ROOT` can point at any repo.
- **Fix:** `lstat` the resolved leaf and refuse it outright when `isSymbolicLink()` — `listDocs`
  already skips symlinks (server/docs.mjs:130), so a symlink is never a file this feature offers,
  and there is no legitimate case to preserve. Belt-and-braces on the write itself: open with
  `fs.openSync(abs, fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW)`
  instead of `writeFileSync`. Add the dangling case to test/server/docs.test.mjs:59 — the assertion
  that currently exists would not have caught this.

#### 🔴 A research run killed by timeout or exiting non-zero reports `done`
- **Severity:** Required
- **Axis:** correctness
- **Scope:** cross-file
- **Files:** lib/agent.mjs, server/research.mjs
- **Problem:** `spawnAgent`'s timeout handler (lib/agent.mjs:61) kills the child and records
  nothing; the subsequent `exit` handler (lib/agent.mjs:77-80) calls `finish({code, error: null})`.
  `server/research.mjs:212` then does `onExit: ({ error }) => finish(r, { error })` — it discards
  `code` entirely. So in `finish` (server/research.mjs:157-167), `error` is null and `r.cancelled`
  is false, giving `status = 'done'`; the only thing that downgrades it is a *missing* report file.
  A run killed at the 30-minute timeout, or one whose CLI died non-zero, that had already written
  even a partial `report.md`, is served as `done:false → done:true` with a truncated report. That is
  precisely the failure mode brief 3 names ("a cancelled run must not read as complete") and the
  test at test/server/research.test.mjs:25 does not reach it — it exercises `researchView` on a
  hand-built object, never the `finish` transition.
- **Fix:** in `spawnAgent`, have the timeout set a flag and pass it on: `finish({code, error: 'timeout after …'})`
  (mirroring what `runAgent` already does at lib/agent.mjs:21). In `research.mjs`, take `code` as
  well and treat a non-zero/`null` exit code as an error status. Add a test that drives `finish`
  through a non-zero exit with a report file present.

#### 🔴 Deleting a running research run recreates the directory it just deleted
- **Severity:** Required
- **Axis:** correctness
- **Scope:** file
- **File:** server/research.mjs:274-283 (delete) with server/research.mjs:85-95 (`writeMeta`)
- **Problem:** `DELETE /api/research/:id` kills the child, drops the run from `runs`, `rmSync`s the
  directory and answers `{ok:true}`. But the killed child's `exit` still fires `finish(r, …)`, which
  calls `writeMeta(r)` — and `writeMeta` does `fs.mkdirSync(p.dir, {recursive:true})` followed by
  `writeFileSync(p.meta, …)`. The directory and `meta.json` come back milliseconds after the delete
  succeeded, so `GET /api/research` lists the run again (as `cancelled`) and the UI shows an entry
  the user just deleted and cannot delete permanently while the child is dying.
- **Fix:** mark the run deleted (`r.deleted = true`) before killing, and have `finish`/`writeMeta`
  return early for a deleted run. Awaiting child exit before `rmSync` would also work but makes the
  handler slow and racy for a child that ignores SIGTERM.

#### 🔴 A failed pane's raw error text de-anonymises it before the vote
- **Severity:** Required
- **Axis:** security
- **Scope:** file
- **File:** server/compare.mjs:73-81 (`view`), surfaced at src/sections/CompareSection.jsx:149
- **Problem:** `view()` is careful to null out `model`, `cost`, `ms` and `turns` until a vote exists —
  and then ships `error: p.error || null` unconditionally. That string is whatever `runAgent`
  scraped off the CLI's stderr/stdout (lib/agent.mjs:31, a 1200-char slice), and CLI failures name
  the model they were invoked with (unknown/unavailable/quota'd model names, `--model <x>` echoes).
  The UI prints it verbatim: `this model failed: {p.error}`. One typo'd or unavailable model in the
  set and the pane is labelled for the user before they vote. Brief 2 makes this the whole point of
  the feature, and test/server/compare.test.mjs:144 only asserts the errored pane *exists* — it does
  not assert the error text withholds the name.
- **Fix:** before the vote, replace the error with a fixed non-identifying string
  (`error: voted ? p.error : (p.error ? 'this model failed' : null)`), keeping the real text for
  after the reveal. Extend test/server/compare.test.mjs:144 to assert the pre-vote payload contains
  no model name anywhere, e.g. `assert.ok(!JSON.stringify(body).includes(model))`.

#### 🔴 The ai-edit tool refusal is a denylist over an extensible tool surface
- **Severity:** Required
- **Axis:** security
- **Scope:** cross-file
- **Files:** server/docs.mjs, lib/agent.mjs
- **Problem:** `EDIT_TOOLS = ['Write','Edit','MultiEdit','NotebookEdit','Bash','Task']`
  (server/docs.mjs:50) is passed as `--disallowedTools` while the child still runs with
  `--dangerously-skip-permissions` (lib/agent.mjs:15-16). It covers the built-in write tools, but a
  denylist has to enumerate everything that will ever exist: any configured MCP server exposes
  `mcp__<server>__<tool>` names that are not in the list and can write files (a filesystem or
  editor MCP is the common case), and `SlashCommand` can reach arbitrary behaviour indirectly. The
  endpoint's guarantee is stated as absolute in three places (the module header, the `wrote: false`
  field, ProposalReview.jsx's "nothing has been written"), and the whole document is already in the
  prompt, so the agent needs *no* tools at all.
- **Fix:** invert it — add an `allowedTools` passthrough to `runAgent` and call ai-edit with an
  empty/near-empty allowlist, which is default-deny and needs no maintenance as the tool surface
  grows. Keep `disallowedTools` if other callers want it. The existing assertion at
  test/server/docs.test.mjs:149 checks the argv contains the denied names; point it at the allowlist
  instead.

#### 🔴 Two quick clicks in the file list can save one document's text over another
- **Severity:** Required
- **Axis:** correctness
- **Scope:** file
- **File:** src/sections/DocsSection.jsx:78-89
- **Problem:** `open()` sets `setSel(path)` and then resolves `api.get('/api/docs/file?path=…')`
  with no check that `sel` is still that path. Open a large doc A, click doc B while A is in flight,
  B resolves first, then A's response lands and calls `setSaved(d.text); setBuf(d.text)` — the
  editor now shows A's text while `sel` is B and `dirty` is false. `save()` PUTs `buf` to `sel`,
  writing A's content into B. This is the one bug the file's own header says it exists to prevent
  ("silently dropping a buffer is the one bug that loses writing the user cannot get back"), and
  the response already carries `d.path` to guard with.
- **Fix:** ignore a stale response — `.then(d => { if (d.path !== path) return; … })` — or track a
  request token in a ref and compare on resolve.

### 🟡 Suggestions

#### 🟡 Tool results are still truncated to 400 chars, so the disclosure cannot show the full result
- **Severity:** Optional
- **Axis:** correctness
- **Scope:** file
- **File:** src/ui/chatBlocks.jsx:36
- **Problem:** brief 1 item 4 exists because "the remainder is unreachable"; the CSS clip is
  correctly gone (src/styles.css, `.chat-tool-result` now `max-height:340px; overflow:auto`), but
  `b.result = short(c.content, 400)` still caps the *data* at 400 characters before it reaches the
  `<details>` body. Opening a tool call still cannot show you the thing you opened it for. The cap
  is pre-existing (carried over unchanged from ChatSection.jsx), so this is a half-fixed AC rather
  than a regression.
- **Fix:** keep the 400-char form for the collapsed summary and store the full (or a far larger,
  e.g. 20k) string for the body — `b.summary = short(c.content, 400); b.result = full` — so the
  scroll cap in CSS is the only limit the reader hits.

#### 🟡 A cancelled run's forced finish never escalates the kill, and drops the handle
- **Severity:** Optional
- **Axis:** correctness
- **Scope:** file
- **File:** server/research.mjs:262-272, with the eviction at server/research.mjs:173-174
- **Problem:** `cancel` sends one SIGTERM and force-finishes after 5s. A child that ignores SIGTERM
  keeps running — burning tokens and possibly still writing `report.md` — while the run is marked
  terminal, and `finish`'s eviction can then remove it from `runs` entirely, so nothing holds the
  handle and it can never be cancelled again. The comment acknowledges half of this ("a child that
  never exits must not leave the run reading as running") but the remedy only fixes the *label*.
- **Fix:** in the 5s timer, `child.kill('SIGKILL')` before `finish`, and skip eviction for a run
  whose child is still `alive`.

#### 🟡 The research SSE retries a 404 once a second, forever
- **Severity:** Optional
- **Axis:** correctness
- **Scope:** file
- **File:** src/sections/ResearchSection.jsx:59-66
- **Problem:** `GET /api/research/:id/events` 404s when there is no live run
  (server/research.mjs:249). `es.onerror` treats every `CLOSED` state the same and reschedules after
  1000 ms with no cap and no status check, so attaching to an item that the client's list still
  calls `running` but the server no longer holds (server restart, eviction) becomes an endless 1 Hz
  request loop for as long as the section is mounted.
- **Fix:** cap the retries with a backoff, and stop on a terminal response — re-fetch
  `/api/research/:id` on failure and give up once its status is not `running`.

#### 🟡 An AI edit against a dirty buffer proposes against the file on disk
- **Severity:** Optional
- **Axis:** correctness
- **Scope:** cross-file
- **Files:** src/sections/DocsSection.jsx, server/docs.mjs
- **Problem:** `runAiEdit` (src/sections/DocsSection.jsx:91-99) sends `path` + `selText` taken from
  the *buffer*, while the server builds the prompt and the returned text from `whole = readFileSync(t.abs)`
  (server/docs.mjs:240-268). With unsaved edits the two disagree: a selection of freshly typed text
  gets a confusing `409 selection-not-in-file`, and a whole-document edit returns disk-based text
  whose diff, if accepted, silently reverts everything the user had not saved. The diff does show it,
  but only to a reader who notices unrelated hunks.
- **Fix:** either send the buffer as the document body and have the endpoint edit what it is given,
  or disable the AI-edit bar while `dirty` with a "save first" reason. The second is a one-line
  change and matches the file's stated data-loss stance.

#### 🟡 `c.text.trim()` is unguarded and can take the whole transcript down
- **Severity:** Optional
- **Axis:** correctness
- **Scope:** file
- **File:** src/ui/chatBlocks.jsx:48
- **Problem:** `if (c.type === 'text' && c.text.trim())` throws `TypeError` on a `text` content
  block with a null/absent `text` — which is what a partial or malformed stream event looks like.
  `buildBlocks` runs during render in three sections, so one such event blanks the screen. The line
  immediately below it guards exactly this for thinking (`String(c.thinking ?? '').trim()`), so the
  inconsistency looks accidental.
- **Fix:** `String(c.text ?? '').trim()`, matching the line below.

#### 🟡 Compare blocks the HTTP request for up to 30 minutes with no cap on the prompt
- **Severity:** Optional
- **Axis:** performance
- **Scope:** file
- **File:** server/compare.mjs:128-142, server/compare.mjs:98-112
- **Problem:** `runAgent` is called without `timeoutMs`, so it inherits the 30-minute default, and
  six of them run concurrently under one `Promise.all` holding the response open. `parseRequest`
  validates model count, duplicates and `cwd` but never bounds `prompt` length, so an arbitrarily
  large prompt is multiplied by six spawns. Research and Docs both set explicit caps
  (`MAX_QUESTION`, `MAX_INSTRUCTION_CHARS`, `AI_TIMEOUT_MS`); Compare is the outlier.
- **Fix:** add a `MAX_PROMPT` bound in `parseRequest` and pass an explicit `timeoutMs` to `runAgent`.

#### 🟡 The report is read whole into memory before being capped
- **Severity:** Optional
- **Axis:** performance
- **Scope:** file
- **File:** server/research.mjs:241
- **Problem:** `fs.readFileSync(p.report, 'utf8').slice(0, REPORT_CAP)` reads the entire file first
  and only then applies the 2 MB cap. The file is written by an agent, so its size is not bounded by
  anything this code controls.
- **Fix:** `statSync` first and refuse or stream-truncate past the cap, or read a bounded number of
  bytes with `fs.openSync`/`fs.readSync`.

#### 🟡 The `ai-edit` handler has no `try`/`catch` around its awaits
- **Severity:** Optional
- **Axis:** architecture
- **Scope:** file
- **File:** server/docs.mjs:230-273
- **Problem:** it is an `async` Express 4 handler, so any rejection becomes an unhandled rejection
  rather than a 500 — fatal under Node's default. `runAgent` currently always resolves, so this is
  latent, not live; `server/compare.mjs` wraps every async handler, which makes the omission look
  unintentional.
- **Fix:** wrap the body in `try`/`catch` and `bad(res, 500, e.message)`, as Compare does.

### 💭 Nits

#### 💭 `cwd` in research is checked for existence but not for being a directory
- **Severity:** Nit
- **Axis:** correctness
- **Scope:** file
- **File:** server/research.mjs:185
- **Problem:** `fs.existsSync(req.body.cwd) ? req.body.cwd : os.homedir()` accepts a *file* path,
  which surfaces later as an async `ENOTDIR` on the spawn rather than a 400. `server/compare.mjs:108-110`
  gets this right (`isAbsolute` + `statSync().isDirectory()`).
- **Fix:** reuse Compare's two-line check.

#### 💭 The NOTICE audit lists neither ResearchSection.jsx nor the two new stylesheets
- **Severity:** FYI
- **Axis:** readability
- **Scope:** global
- **Problem:** NOTICE enumerates the files where Odysseus source *was* read and then names the files
  that deliberately are not on that list (`chatBlocks.jsx`, `CompareSection.jsx`, `compare.css`).
  `src/sections/ResearchSection.jsx`, `src/styles/research.css` and `src/styles/docs.css` appear in
  neither list, although brief 3 permitted reading `static/js/research/`. Their headers don't claim a
  reading either way. For a document that presents itself as an audit, the silence is the gap.
- **Fix:** add them to the second list explicitly, as CompareSection.jsx does in its own header.

#### 💭 TOCTOU between the path guard and the write
- **Severity:** FYI
- **Axis:** security
- **Scope:** file
- **File:** server/docs.mjs:212-227
- **Problem:** `resolveDocPath` validates, then `mkdirSync`/`writeFileSync` act on the path string;
  a component swapped for a symlink in between is not re-checked. It needs a local writer inside the
  root, so it is a much narrower threat than the dangling-symlink finding above — but the
  `O_NOFOLLOW` fix suggested there closes both, which is why it is worth doing that way.
- **Fix:** covered by the `O_NOFOLLOW` open in the Critical finding.

#### 💭 Comparison JSON writes are not atomic, and two votes can race
- **Severity:** FYI
- **Axis:** correctness
- **Scope:** file
- **File:** server/compare.mjs:92-95, server/compare.mjs:160-170
- **Problem:** `write()` truncates in place, so a crash mid-write leaves a half file (the list route
  does swallow it, at server/compare.mjs:149). `vote` does read → check → write with no lock, so two
  simultaneous votes both pass the `already voted` check and the last write wins. Single local user,
  so this is a note rather than a defect.
- **Fix:** write to `<id>.json.tmp` and `renameSync` over the target.

## Acceptance Criteria Coverage

### Brief 1 — chat message rendering
| Criterion | Status |
|-----------|--------|
| `thinking` block rendered as a collapsed `<details>`, violet tokens | ✅ |
| `redacted_thinking` renders as a labelled placeholder, never empty | ✅ |
| Per-message `who · time` header, omitted when `ts` is null | ✅ |
| `.chat-msg.assistant { max-width: 100% }`, user stays at 78% | ✅ |
| Tool results become expandable `<details>`, body is the **full** result | ⚠️ Partial — CSS clip removed, but `short(c.content, 400)` still caps the data |
| Streaming placeholder replaces `✦ working…` | ✅ |
| `SessionCostPill({ blocks })` exported, ChatSection left unwired | ✅ |
| No new deps, no `:root` token changes | ✅ |
| `MessageLog` keeps the `gap` warning | ✅ — `requestedFrom`→`from` mapping is done correctly in ChatSection.jsx:190 |
| Export names/signatures preserved for other importers | ✅ — QuickActions.jsx repointed, ChatSection.jsx:377 still works |

### Brief 2 — Compare
| Criterion | Status |
|-----------|--------|
| Six routes match the documented contract | ✅ |
| `Promise.all` over models; an errored model still gets a pane | ✅ |
| `mapping` withheld until a vote lands | ⚠️ Partial — mapping/model/cost/ms/turns all correctly withheld, but the raw `error` string leaks the model (🔴 above) |
| `id` validated against `/^[a-z0-9]{6,12}$/` before path use | ✅ |
| `models` non-empty, ≤ 6 strings, rejected otherwise | ✅ (also de-duplicated) |
| `synthesize` refused with 409 before a vote | ✅ |
| Panes side by side + tabs for narrow viewports, Markdown.jsx | ✅ |
| Reveal names + cost/latency/turns after voting; past list | ✅ |
| `ponytail:` comment records the skips | ✅ |

### Brief 3 — Deep Research
| Criterion | Status |
|-----------|--------|
| Seven routes match the documented contract | ✅ |
| Run state server-side, keyed by id; survives remount | ✅ |
| `createRun`/`emit`/`replayFrom`; `?fromSeq` resume | ✅ |
| Gap frame sent when the gap cannot be served | ✅ server-side and rendered client-side |
| Report + `meta.json` under `~/.claude/dashboard-research/<id>/` | ✅ |
| `id` validated against `/^[a-z0-9]{6,12}$/` | ✅ |
| Prompt requires inline citations with URLs | ✅ — the strongest part of the file |
| `cancel` kills the child; a cancelled run never reads as complete | ⚠️ Partial — cancel is correct, but a *timed-out or non-zero-exit* run does read as `done` (🔴 above) |
| Show cancelled and errored runs as such | ✅ |
| `ponytail:` comment records the skips | ⚠️ The skips are recorded in the module header prose, not as a `ponytail:`-prefixed comment (they are in `compare.mjs`, `CompareSection.jsx` and `DocsSection.jsx`) |
| `DELETE` removes the run and its report | ❌ Missing for a *running* run — the directory is recreated (🔴 above) |

### Brief 4 — Documents
| Criterion | Status |
|-----------|--------|
| Four routes match the documented contract | ✅ |
| Every path resolved against one root, segment-wise containment (`/root-evil` case) | ✅ |
| Absolute paths and `..` components refused before resolution | ✅ |
| Symlinks that leave the root rejected | ❌ Live symlinks yes; **dangling** symlinks escape (🔴 Critical above) |
| `PUT` writes only inside the root | ❌ Same escape |
| `ai-edit` returns text and never writes | ⚠️ Partial — the endpoint never writes, but the model's denylist is bypassable via MCP tools (🔴 above) |
| Request and file sizes capped | ✅ (2 MB file, 1 KB path, 2 K instruction, 20 K selection, `express.json` limit 10 MB accommodates them) |
| CodeMirror with language by extension | ✅ |
| `.md`/`.html` preview via marked + DOMPurify, never raw `dangerouslySetInnerHTML` | ✅ — `.md` via the shared Markdown.jsx, `.html` sanitised in DocPreview.jsx with an equivalent config; no XSS sink found in the preview path |
| `.csv` as a table | ✅ (new RFC-4180 reader in `csvRows.js`, correctly the inverse of `lib/csv.mjs`) |
| AI edit → accept/reject diff | ✅ |
| Unsaved-changes indicator; buffer not lost on file switch without warning | ⚠️ Partial — the confirm and `beforeunload` guard are there, but the stale-response race can swap the buffer silently (🔴 above) |
| `ponytail:` comment records the skips | ✅ |

## Figma Fidelity

No Figma design — skipped. `.loush/meta.json` does not exist and the task explicitly states there is
no design; the four briefs specify the UI in prose and existing tokens, and the new CSS uses only
pre-existing custom properties as required.

## Notes on method

- graphify was unavailable in this context (no Skill tool exposed), so call sites and consumers were
  located with grep/git rather than a graph. `chatBlocks.jsx`'s three importers, the `gap` frame
  plumbing across `chat-protocol.mjs` → `index.mjs`/`research.mjs` → `ChatSection.jsx`/`ResearchSection.jsx`,
  and `lib/agent.mjs`'s callers were each traced by hand.
- The Critical finding was confirmed by executing `resolveDocPath` against a purpose-built fixture
  in the scratchpad, not inferred from reading. Nothing in the repo was modified.
- The full test suite was not run, per instruction. No `node --test` run was needed — the two
  coverage gaps were established by reading the fixtures the tests build.
- Absence of unit tests is not a finding here; the four suites are good. What is worth saying is
  that the two blocking defects both fall in the gap between what the tests construct and what
  production does: the symlink test only builds live links, and the cancelled-run test never drives
  `finish`.
