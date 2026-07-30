# INTEGRATION-misc.md

Wiring required for three new library modules. **Nothing in this branch edits an existing file** —
`lib/work-log.mjs`, `lib/diff-review.mjs` and `lib/config-lint.mjs` are pure additions with tests,
and none of them is reachable from the server or the UI until the changes below are made.

Contents:

- [Branch note for the coordinator](#branch-note-for-the-coordinator)
- [052 — Work Log as a second files-changed signal](#052--work-log-as-a-second-files-changed-signal)
- [074 — File-watcher diff approval](#074--file-watcher-diff-approval)
- [120 — Config linter](#120--config-linter)
- [Full rule-id inventory (for de-duplication)](#full-rule-id-inventory-for-de-duplication)
- [Things found wrong in existing code](#things-found-wrong-in-existing-code)

---

## Branch note for the coordinator

This worktree was branched from an older commit than the target branch.

- `lib/capability-provenance.mjs` **does not exist here**, so I could not read it and did **not**
  create it. No file of that name is in this branch; there is nothing to collide at merge time.
- Because I could not see the frontmatter-linting code that exists on the target branch, every rule
  in `lib/config-lint.mjs` was derived only from parsers that exist **in this tree** — each rule
  message cites the `server/` or `src/` line it protects. The full id list, with the ones I suspect
  may already exist, is in [the inventory below](#full-rule-id-inventory-for-de-duplication).

---

## 052 — Work Log as a second files-changed signal

**Module:** `lib/work-log.mjs` — `parseWorkLog`, `reconcile`, `crossCheckWorkLog`.

### Why it needs wiring

`server/index.mjs:1051` builds the per-agent files-touched set from tool calls only:

```js
if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(c.name) && c.input?.file_path)
  a.files.add(c.input.file_path)
```

An edit made through `Bash(sed -i …)`, `Bash(cat > f)`, `git apply` or a generated script produces no
such tool call, so it never enters that set. The dashboard reports a smaller change surface than the
run actually had, and the missing files are exactly the shell-mediated ones nobody reviewed.

### Required changes to `server/index.mjs`

1. **Capture assistant text per agent.** The walker at `:1046` iterates `message.content` and only
   looks at `c.type === 'tool_use'`. Also accumulate `c.type === 'text'` into `a.text` (bounded —
   the module caps at `MAX_SOURCE_CHARS` and reports the truncation).
2. **Cross-check where the agent record is finalised** (same block, around `:1051`):

   ```js
   import { crossCheckWorkLog } from '../lib/work-log.mjs'
   // ...
   const x = crossCheckWorkLog(a.text, [...a.files], { cwd: project })
   a.workLog = x.ok ? x.workLog : null
   a.workLogReason = x.ok ? null : x.reason      // MUST be surfaced — see below
   a.filesReconciled = x.ok ? x.reconciliation : null
   ```
3. **Do not fold `claimedOnly` into `a.files`.** `a.files` means "observed via tool call" and must
   keep meaning that. Expose `filesReconciled` alongside it.

### Required changes to the UI

`src/sections/ForensicsSection.jsx` / `RunsSection.jsx` render a files-changed count. Render three
counts, never one:

| bucket | label to use | must not be shown as |
| --- | --- | --- |
| `both` | "changed (corroborated)" | — |
| `claimedOnly` | "agent claims — no tool call seen" | part of "changed" |
| `observedOnly` | "edited but not reported" | part of "the agent said" |

`claimedOnly[i].possibleCauses` carries both readings (Bash-mediated edit vs. a claim that did not
happen) and the data cannot distinguish them. **The UI must show both**, not pick one.

When `workLogReason` is set, show that string. A run with no Work Log must not render as a run with
zero claims — `parseWorkLog` deliberately returns `{ok:false, reason}` rather than empty arrays for
exactly this reason.

`reconciliation.agreementRatio` is `null` when nothing is comparable. Do not render `null` as 100%.

### Optional but recommended

Add a `## Work Log` stanza to the agent prompt templates in `server/prompts/` so agents actually emit
one. `parseWorkLog` accepts both `- Changed: path` bullets and `### Files Changed` sub-headings.

---

## 074 — File-watcher diff approval

**Module:** `lib/diff-review.mjs` — `createDiffReviewStore({ readFile, writeFile, now, mode })`.

The store is I/O-injected and holds no global state, so the server owns one instance per project.

### Required changes to `server/index.mjs`

1. **Instantiate one store per watched project**, and set `mode` honestly:

   ```js
   import { createDiffReviewStore } from '../lib/diff-review.mjs'
   const reviewStores = new Map()
   const storeFor = project => {
     if (!reviewStores.has(project)) reviewStores.set(project, createDiffReviewStore({
       // 'hooks' ONLY if a PreToolUse hook that posts to /api/review/snapshot is actually installed.
       // The default is 'degraded' precisely so we never claim confidence we do not have.
       mode: hasPreEditHook(project) ? 'hooks' : 'degraded',
     }))
     return reviewStores.get(project)
   }
   ```

   `hasPreEditHook` must check the merged settings for a `PreToolUse` hook matching
   `Edit|Write|MultiEdit|NotebookEdit`, using the same `SETTINGS_FILES` map at `:339`. Defaulting to
   `'hooks'` would make every `originalConfidence: 'observed'` a lie.

2. **New endpoints** (all beneath the existing `safe()` write-jail, `lib/paths.mjs` `ALLOWED_ROOTS`):

   | route | calls | notes |
   | --- | --- | --- |
   | `POST /api/review/snapshot` | `snapshot(file, content, {via:'hook'})` | the PreToolUse hook target |
   | `POST /api/review/edit` | `recordEdit(file, content)` | PostToolUse, or the watcher |
   | `GET  /api/review/pending` | `listPending()` | |
   | `GET  /api/review/:id/diff` | `diff(id)` | |
   | `POST /api/review/:id/accept` | `accept(id)` | |
   | `POST /api/review/:id/reject` | `reject(id)` | **may return `{ok:false}` — see below** |
   | `POST /api/review/:id/reject-force` | `rejectForce(id, 'discard-later-changes')` | only after a confirm dialog |
   | `POST /api/review/opened` | `noteFileOpened(file)` | degraded-mode baseline |

   Return `reject`'s refusal as **HTTP 409**, not 500 — it is a correct, expected outcome.

3. **Hook library entry.** `HOOK_LIBRARY` (`server/index.mjs:~3690`) should gain a PreToolUse entry
   matching `Edit|Write|MultiEdit|NotebookEdit` that POSTs the file's current content to
   `/api/review/snapshot`. Installing it is what promotes a project from degraded to hook mode.

### UI contract (non-negotiable)

- **A refused reject must be shown as a refusal, not a failure.** `{code:'changed-since-snapshot'}`
  carries `diskHash`, `reviewedHash` and `recovery`. Show them. Nothing was written; the review is
  still pending and can be re-synced with another `recordEdit`.
- **Force is a separate, confirmed action.** `rejectForce` requires the literal string
  `'discard-later-changes'`; a truthy flag is rejected. Do not paper over that with a checkbox that
  sends `true`.
- **Degraded reviews must say so.** `review.degraded`, `originalConfidence`
  (`observed` / `inferred` / `unknown`) and `originalConfidenceReason` are on both the review and the
  diff. In degraded mode "restore the original" restores a *guess*, and a successful degraded reject
  returns a `warning` field saying so — surface it.
- `originalConfidence === 'unknown'` means reject is unavailable. Disable the button; do not let it
  fail at click time.

---

## 120 — Config linter

**Module:** `lib/config-lint.mjs`. Pure Node, no external binary.

`agnix` is deliberately **not** shelled out to. It is not installed here, and a linter that silently
returns nothing when its binary is missing is indistinguishable from a linter that says your config
is clean.

### Required changes to `server/index.mjs`

```js
import { lintAll, proposedFixes } from '../lib/config-lint.mjs'

app.get('/api/config/lint', (req, res) => {
  const project = req.query.project || PROJECT
  const r = lintAll({
    claudeMd: [path.join(CLAUDE, 'CLAUDE.md'), path.join(project, 'CLAUDE.md'), path.join(project, '.claude', 'CLAUDE.md')],
    projectDirs: [project],
    skillsDirs: [path.join(CLAUDE, 'skills'), path.join(project, '.claude', 'skills')],
    settings: Object.values(SETTINGS_FILES),          // the existing map at server/index.mjs:339
    mcp: [CLAUDE_JSON, path.join(project, '.mcp.json')],
    mcpScopes: [
      { scope: 'global',  file: CLAUDE_JSON, servers: readJson(CLAUDE_JSON, {}).mcpServers },
      { scope: 'project', file: path.join(project, '.mcp.json'), servers: readJson(path.join(project, '.mcp.json'), {}).mcpServers },
    ],
  })
  res.json({ ...r, fixes: proposedFixes(r) })
})
```

### UI contract

- **Render `coverage`, not just `counts`.** `coverage.targetsMissing` and
  `coverage.targetsUnparseable` exist so "0 problems" cannot be shown over files that were never
  read. `coverage.note` says this in words. Also show `coverage.skillsFound` / `skillsParsed` —
  a skills directory is one target but many files.
- **Fixes are proposals.** `proposedFixes()` returns `{applied:false, fixes:[…]}` with `before`/
  `after` text. This module never writes. Any apply button must go through the existing
  `backup(file)` path (`server/index.mjs:~330`) and show the patch first.
- `line: null` always comes with `lineReason` explaining why it is null (whole-file property, absent
  key, or an ambiguous JSON key that the locator refused to guess at). Show the reason rather than a
  blank column.

---

## Full rule-id inventory (for de-duplication)

58 rule ids. Every one cites, in its own message, the line in this tree that it protects.
**"Suspect duplicate"** flags rules a pre-existing frontmatter linter on the target branch plausibly
already covers — I could not see that code, so these are the ones to check first.

### `claude-md/*` — 7 rules

| id | sev | grounded in | suspect duplicate? |
| --- | --- | --- | --- |
| `claude-md/unreadable` | error | file is present but unreadable; the always-on rules are not reaching the model | no |
| `claude-md/empty` | warn | `server/index.mjs:1418` counts an empty file as "create CLAUDE.md" done | no |
| `claude-md/frontmatter-not-supported` | warn | `server/index.mjs:1402` reads CLAUDE.md **raw** — frontmatter is sent as literal text | **yes** — a frontmatter linter may own this |
| `claude-md/oversized` | warn | `alwaysLoadedBudget.softCap = 8000`, `server/index.mjs:1331`; `tokens()` at `:569` | possibly (harness token panels) |
| `claude-md/missing-import` | error | `@path` import target does not exist → silently dropped | no |
| `claude-md/no-headings` | info | `splitSections` at `:151` anchors on `^#{1,3} `; `PlanGraph.jsx:66` needs it | no |
| `claude-md/duplicate-location` | warn | `server/index.mjs:1535-1537` loads `CLAUDE.md` **and** `.claude/CLAUDE.md` as separate layers | no |

### `skill/*` — 11 rules — **highest duplicate risk; check this block first**

| id | sev | grounded in | suspect duplicate? |
| --- | --- | --- | --- |
| `skill/unreadable` | error | file present, unreadable | no |
| `skill/bom` | error | a BOM defeats the `^---` anchor in `parseFM` (`:149`) — frontmatter silently vanishes | **yes** |
| `skill/no-frontmatter` | error | same anchored regex; a leading blank line hides the whole block | **yes** |
| `skill/parse-error` | error | `:151` swallows YAML errors into `_parse_error`; `description` then reads `''` | **yes** |
| `skill/frontmatter-not-mapping` | error | YAML parsing to a scalar/list makes `fm.description` undefined | **yes** |
| `skill/missing-description` | error | `description` **is** the trigger (`:1512`) | **yes** |
| `skill/description-too-long` | warn | 1024-char limit; dashboard shows only 160 (`:1512`) | **yes** |
| `skill/missing-name` | warn | skills are keyed by directory (`:178`), so `name` is documentation only | **yes** |
| `skill/name-mismatch` | error | `itemFile` (`:178`), `:1016`, `:1508` all resolve by directory — a differing `name:` is never used | **yes** |
| `skill/tools-type` | warn | `Array.isArray(x) ? x : String(x\|\|'').split(',')` (`:1521`) | possibly |
| `skill/empty-body` | warn | the body is the instruction text the skill fires into | no |
| `skill/missing-file` | warn | a directory under `skills/` with no `SKILL.md` is loaded by nothing | no |

### `settings/*` + `hook/*` — 14 rules

| id | sev | grounded in | suspect duplicate? |
| --- | --- | --- | --- |
| `settings/unreadable` | error | `GET /api/hooks` (`:348`) reads it unguarded | no |
| `settings/parse-error` | error | `:348` does a bare `JSON.parse` with no try/catch → 500, Hooks panel never loads | no |
| `settings/not-object` | error | every reader does `settings.hooks` / `settings.permissions` | no |
| `settings/disabled-shadow` | warn | the toggle keys on `hookKey` (`:437`); enable copies the disabled entry on top → fires twice | no |
| `hook/root-not-object` | error | `Object.entries(settings.hooks\|\|{})` (`:1382`) | no |
| `hook/unknown-event` | error | events are matched exactly; an unknown key is dead config that looks installed | no |
| `hook/event-not-array` | error | `Array.isArray(matchers) ? matchers : []` (`:1383`) silently drops it; `HooksSection.jsx:66` `.flatMap` throws | no |
| `hook/group-not-object` | error | same readers | no |
| `hook/matcher-type` | error | matcher must be a string | no |
| `hook/bad-matcher-regex` | error | `:3648` **falls back to exact string match** when the regex fails to compile — the hook silently matches one literal tool name | no |
| `hook/matcher-ignored` | info | non-tool events have nothing to match against | no |
| `hook/group-missing-hooks` | error | `(entry.hooks\|\|[])` at `:437`, `:1384`, `HooksSection.jsx:67` | no |
| `hook/entry-not-object` | error | same | no |
| `hook/entry-missing-command` | error | `h.command \|\| h.prompt \|\| ''` (`HooksSection.jsx:67`) renders a blank row that runs nothing | no |
| `hook/command-script-missing` | error | a stale script path fails every matching call; PreToolUse non-zero exit is a BLOCK (`:3667`) | no |
| `hook/no-timeout` | info | a hanging hook stalls every matching tool call | no |
| `hook/bad-timeout` | warn | non-positive/non-numeric timeout is ignored | no |

### `perm/*` — 6 rules

| id | sev | grounded in | suspect duplicate? |
| --- | --- | --- | --- |
| `perm/not-object` | error | `perms[list] \|\| []` (`:1377`) | no |
| `perm/list-not-array` | error | same | no |
| `perm/non-string` | error | `harnessResolve` flags it at `:1378`; `r === pat` can never match | **maybe** — `harnessResolve` already reports this as a "conflict"; if that surface is kept, this rule duplicates it |
| `perm/malformed-rule` | warn | rules matched by exact equality against `Tool` / `Tool(pattern)` (`:1377`) | no |
| `perm/allow-deny-conflict` | error | `:1379` computes the same dupe list; deny wins silently | **maybe** — same overlap as above |
| `perm/duplicate` | info | cosmetic; hides the real rule count | no |

### `mcp/*` — 15 rules

| id | sev | grounded in | suspect duplicate? |
| --- | --- | --- | --- |
| `mcp/unreadable` | error | every declared server is unavailable | no |
| `mcp/parse-error` | error | Claude Code cannot read it → every server silently absent | no |
| `mcp/not-object` / `mcp/servers-not-object` | error | `Object.entries(cj.mcpServers\|\|{})` (`:263`) | no |
| `mcp/entry-not-object` | error | same | no |
| `mcp/stdio-missing-command` | error | listed in the MCP panel (`:263`) but can never start | no |
| `mcp/remote-missing-url` / `mcp/remote-bad-url` | error / warn | no reachable endpoint | no |
| `mcp/mixed-transport` | warn | both `url` and `command`; which wins is not shown anywhere | no |
| `mcp/args-not-array` | error | a string is **not** split into argv — passed as one argument | no |
| `mcp/args-not-strings` | warn | coerced by spawn | no |
| `mcp/env-not-object` / `mcp/env-not-string` | error / warn | process envs hold strings; `null` becomes `"null"` | no |
| `mcp/secret-inline` | warn | the value is returned over `/api` (`:263-265`) and copied into backups | no |
| `mcp/disabled-shadow` | error | the enable path (`:474`) copies the disabled config over the live one | no |
| `mcp/name-collision` | warn | `:1583-1585` pushes both scopes into one list; which connects is not shown | no |

### infrastructure

| id | sev | purpose |
| --- | --- | --- |
| `lint/truncated` | info | emitted when the per-file diagnostic cap (500) is hit — a cap is never silent |

**If de-duplicating:** the `skill/*` block is where overlap is likely, and my `parseFrontmatter`
export is a byte-for-byte behavioural copy of `server/index.mjs:148 parseFM` on purpose (a linter
that parses more leniently than the reader passes files the reader silently drops). If the target
branch already has an equivalent, delete mine and import theirs — but keep whichever one matches
`parseFM` **exactly**, including the `^---\r?\n` anchor.

---

## Things found wrong in existing code

Found while grounding the rules. **None of these are fixed on this branch** — I did not edit any
existing file. Each is reported rather than patched.

1. **`GET /api/hooks` can 500 on a malformed settings file.**
   `server/index.mjs:346-348` reads all three settings files with an unguarded
   `JSON.parse(fs.readFileSync(file, 'utf8'))`. A trailing comma in any of `~/.claude/settings.json`,
   `.claude/settings.json` or `.claude/settings.local.json` takes down the entire Hooks panel with a
   bare 500 — which is the exact failure the comment at `server/index.mjs:254` says was already
   fixed elsewhere. `harnessResolve` (`:1394`) *does* guard the same read and reports it as a
   conflict, so the two paths disagree about the same file. `lintSettings` reports this as
   `settings/parse-error`; the endpoint itself still needs a try/catch.

2. **An invalid hook matcher silently degrades to exact string matching.**
   `server/index.mjs:3648`: `catch (e) { fires = matcher === tool; note = 'invalid regex — fell back
   to exact match' }`. The `note` is returned only from the interactive `/api/hooks/test` endpoint.
   Nothing in the real dispatch path or in the Hooks list tells a user their matcher does not
   compile, so a hook with a typo'd matcher appears installed and quietly matches almost nothing.

3. **The hook enable/disable toggle can duplicate a hook.**
   `server/index.mjs:488-492` moves an entry between `settings.hooks` and `settings._disabledHooks`
   keyed by `hookKey` (`:437`) without checking whether the destination already holds that key. If
   both objects contain the same tuple — reachable by hand-editing, or by a failed write — enabling
   produces two identical entries and the hook then runs twice per matching call. Same shape at
   `:474-475` for `mcpServers` / `_disabledMcpServers`, where the enable path
   (`cj.mcpServers[name] = c`) overwrites a live config with the stale disabled one.

4. **`~/.claude/skills/session-start-hook/SKILL.md` declares `name: startup-hook-skill`.**
   A real finding from running the linter against this machine (`skill/name-mismatch`, error). Every
   lookup in this repo resolves a skill by its **directory** name (`itemFile` at `:178`, and the
   scanners at `:1016` and `:1508`), so the declared name is never used by anything — it only makes
   the file disagree with how it is actually addressed.

5. **`CLAUDE.md` and `.claude/CLAUDE.md` are both loaded with no precedence marker.**
   `server/index.mjs:1535-1537` lists both as separate layers. A project with both pays for both on
   every turn, and when they disagree the model sees the contradiction with nothing indicating which
   is authoritative. Reported as `claude-md/duplicate-location`.

6. **`lib/paths.mjs` is not used by the paths this feature cares about.**
   `CLAUDE`, `PROJECT`, `SETTINGS_FILES` and `CLAUDE_JSON` are all derived inline in
   `server/index.mjs` rather than through `lib/paths.mjs`, which exists specifically to stop that
   divergence (see its header comment). The new endpoints above should go through `paths.mjs`.

7. **(For 052) `a.files` is documented nowhere as tool-call-only.**
   `server/index.mjs:1051` is the sole definition of "files this agent touched", and it structurally
   cannot see Bash-mediated edits. Any UI label reading "files changed" over that set is overstating
   its completeness today, before this feature is wired in.
