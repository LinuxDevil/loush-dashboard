# SPEC — capability discovery

> Implementation spec derived from `superclaude-framework.md` and `_SYNTHESIS.md` (§1 D3, §6, §7
> Cluster C, §8 Tier 0.3), verified line-by-line against our own tree at
> `research/upstream-ecosystem-analysis`. Written 2026-07-29.
>
> **Where our code and the research disagree, our code wins and the disagreement is called out
> explicitly.** Two corrections to the research are recorded in §"Corrections to the record".
>
> **Ruling honoured throughout:** we never repeat upstream's self-reported performance numbers
> ("94%", "98%", "2–3×") in UI or docs. They are frontmatter strings with no methodology
> (`_SYNTHESIS.md:171`). Nothing in this spec renders them.
>
> **Ruling honoured throughout:** per `_SYNTHESIS.md:220-221`, *making our dashboard understand
> their artifacts* beats *porting their code*. Features 1–5 are all "understand"; the only "port"
> items are 7 and 8, and both are schema/content, not code.

---

## Verdict on D3: it reproduces

**D3 reproduces exactly as described, and it is worse than the research says.**

The defect is structural, not a single line. `KINDS.commands.nested = false`
(`server/index.mjs:157`) and `KINDS.agents.nested = false` (`server/index.mjs:162`) drive
`itemFile()` (`server/index.mjs:166-168`), which composes `<scopeDir>/<name>.md`. Every consumer
then does a single non-recursive `fs.readdirSync` and maps each entry through `itemFile()`:

```js
// server/index.mjs:603-606  (overviewItems)
for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
  const name = KINDS[kind].nested ? entry.name : entry.name.replace(/\.md$/, '')
  const file = itemFile(kind, dir, name)
  if (!fs.existsSync(file)) continue
```

With SuperClaude installed, `~/.claude/commands/` holds one directory entry, `sc`. The loop derives
`name = 'sc'`, computes `~/.claude/commands/sc.md`, finds it absent, and `continue`s. Thirty files
vanish with no error, no log line, and no empty state — the ledger renders as if complete. That is
the silent-failure shape the synthesis flagged.

**The research undercounted the blast radius.** It names two sites (`:155`, `:600`). There are
**six** independent copies of the same one-level-deep loop, each of which must be fixed or
deliberately exempted:

| # | Site | Endpoint / consumer | Effect of the bug |
|---|---|---|---|
| 1 | `server/index.mjs:183` | `GET /api/res/:kind` | ResourceSection cannot list or open a namespaced command/agent |
| 2 | `server/index.mjs:375` | `customizeRes()` → `/api/customize` | CustomizeSection cannot toggle one |
| 3 | `server/index.mjs:603` | `overviewItems()` → `/api/overview` | Inventory linter and **CapabilityLedger** never see it |
| 4 | `server/index.mjs:831` | `listDir()` → `/api/projects` | project cards under-report `commands`/`agents` |
| 5 | `server/index.mjs:1004` | `scanCmds()` → `/api/chat/complete` | typing `/sc:` in our Chat input autocompletes nothing |
| 6 | `server/index.mjs:2421` | `/api/flow` node scan | the command is missing from the Flow graph |

Sites 3 and 6 are the expensive ones. Site 3 feeds `capabilityLedger()`
(`server/index.mjs:2850`), so a missing item is not merely hidden — it is **excluded from the
denominator** of the headline sentence at `server/index.mjs:2904` ("you pay N tok every session for
M capabilities"). We under-report cost and present the under-report as a total.

The fire-matcher is genuinely ready for the fix. `server/index.mjs:2864` already computes
`const full = m[1], short = full.split(':').pop()` and tries both, so `/sc:implement` will match a
row named `sc:implement` **or** `implement` the moment the row exists. Confirmed — the research is
right that ROI verdicts light up for free.

---

## Verdict on the sibling bug: confirmed, and there is a third

`grep` for `.agent` across `server/`, `lib/` and `src/` returns only `agentType` / `agentId`
identifiers in the teams code (`server/index.mjs:1210-1284`) and `cols.agent` in
`src/sections/FlowSection.jsx`. **We do not scan `.agent/skills` anywhere, at either scope.**
openskills resolves four directories in order — `./.agent/skills`, `~/.agent/skills`,
`./.claude/skills`, `~/.claude/skills` (`context-and-skills-tooling.md:568-574`) — and we cover
exactly the bottom two. `KINDS.skills.dirs()` (`server/index.mjs:151`) lists precisely those two.

**And a third blind spot, found by inspecting this machine rather than the research: plugin-installed
capabilities.** This is the largest of the three by live count.

Measured on the maintainer's own `~/.claude` today:

| Fact | Value | How measured |
|---|---|---|
| `~/.claude/commands` | **does not exist** | `ls ~/.claude/commands` → ENOENT |
| `~/.claude/agents` | **does not exist** | same |
| `~/.claude/skills` | 43 entries | `ls ~/.claude/skills \| wc -l` |
| `SKILL.md` under `~/.claude/plugins/cache/**` | **28** (14 in `superpowers/6.1.1`, 14 in `superpowers/6.2.0`) | `find … -name SKILL.md \| wc -l` |
| `SKILL.md` under `~/.claude/plugins/marketplaces/**` | 31 | same |
| command `.md` under `~/.claude/plugins/**` | 29, all under `marketplaces/` | `find … -path '*/commands/*.md'` |
| `settings.json.enabledPlugins` | `{"superpowers@claude-plugins-official": true}` | read directly |

So on this machine our capability surface is **43 skills**. The real surface is **43 + 14** — the
14 skills the one enabled plugin actually contributes. Those 14 are not merely mis-priced; they are
absent, and the plugin they come from is rendered as a **single row worth zero tokens**:

```js
// server/index.mjs:637-640  (overviewItems)
for (const [name, on] of Object.entries(settings.enabledPlugins || {}))
  if (on) push('plugins', name.split('@')[0], { scope: 'user', group: 'plugins', descTokens: 0, fullTokens: 0, … })
```

and then dropped from the ledger entirely, because `CAP_KIND` (`server/index.mjs:2848`) enumerates
only `skills / agents / commands / mcp` — `plugins` is filtered out at `server/index.mjs:2872`.
`SKIP_DIRS` (`server/index.mjs:497`) also contains `'plugins'`, so ArtifactsSection skips the tree
as well. Four independent code paths agree to ignore it.

**Our own code already knows these skills fire.** `/api/flow` records an invocation for a skill it
cannot find a definition for and marks it a ghost:

```js
// server/index.mjs:2455
if (!seen.has(to)) addNode(inv.kind, inv.name, { ghost: true }) // used in sessions but not defined in this scope (plugin skills etc.)
```

That comment is a standing admission of this bug, written before the research existed. Invocations
are keyed on `c.input.skill` (`server/index.mjs:2378`), which for a plugin skill is the namespaced
form `superpowers:brainstorming`. Note the asymmetry: commands get prefix-tolerant matching at
`server/index.mjs:2864`; **skills get none**, so a plugin skill can never match a ledger row even
after we start scanning for it.

### The argument the synthesis asked for

`_SYNTHESIS.md:36-38` says two independent blind spots in the same layer would mean discovery, not
analysis, is our weak subsystem. **The evidence supports a stronger claim than that.** There are
three blind spots (nesting, `.agent`, plugins), spread over six duplicated scan loops, and the
duplication is the root cause: there is no single discovery function to fix. Every one of our six
loops re-derives "what is a capability and where does it live" inline. Our *analysis* layer, by
contrast, is factored into testable pure modules (`lib/harness-metrics.mjs`, `lib/pricing`-shaped
helpers) with real unit tests in `test/lib/`. Discovery has **zero** test files and **zero** shared
module. That asymmetry, not any individual missing path, is the defect.

**Therefore feature 1 is not "add a recursive walk" — it is "extract one discovery module, make it
the only walker, and unit-test it."** Every subsequent feature in this spec is a small addition to
that module rather than a seventh copy of the loop.

---

## Corrections to the record

Two claims in `superclaude-framework.md` do not hold against our tree. Recording them so the
research file is not treated as authoritative on our side of the boundary.

1. **"Library" is the wrong section name.** `superclaude-framework.md:693-695` and `:748` say the
   missing commands should appear in "Library". `src/sections/LibrarySection.jsx` is *not* a
   capability browser — it is Profiles / Bundles / Context bundles / Recommendations
   (`src/sections/LibrarySection.jsx:22`). The capability browser and editor is
   `src/sections/ResourceSection.jsx`, mounted per-kind. The affected surfaces are
   **ResourceSection, CustomizeSection, Inventory (in `CapabilityLedger.jsx:198`), CapabilityLedger,
   ProjectsSection and ChatSection autocomplete** — six, not four, and a different set than named.

2. **The mtime gotcha is real but the mechanism in our code is the opposite of "prematurely DEAD".**
   `superclaude-framework.md:434` and `_SYNTHESIS.md:228-229` both say wheel-preserved mtimes push
   files toward a DEAD verdict prematurely. Checked against `capabilityVerdict()`
   (`lib/harness-metrics.mjs:28-32`): a stale-old mtime makes `ageDays` **large**, which *skips* the
   `NEW` branch and lands on `DEAD` — so the conclusion (wrongly DEAD) is right, but "prematurely"
   is the wrong word: the file is judged as though it had had months to fire when it has had days.
   The second-order damage is larger and neither source mentions it: `sessionsSince()`
   (`lib/harness-metrics.mjs:41-45`) uses the same bad timestamp as the window start, so
   `tokPerFire` (`lib/harness-metrics.mjs:35-38`) bills the capability for every session in the
   90-day window rather than the sessions since install. A file installed yesterday is charged 90
   days of always-on tax — **the exact bug the comment at `lib/harness-metrics.mjs:12-21` says was
   already fixed.** `copy2`-style installs silently reintroduce it. Feature 4 addresses this.

---

## 1. Recursive capability discovery (D3)

**Customer need.** A developer who installed any namespaced command pack — SuperClaude's
`~/.claude/commands/sc/` is the 23.6k-star example, but nested command directories are a standard
Claude Code convention, not a SuperClaude quirk — opens our ROI ledger and sees a number that is
confidently wrong. Today they either don't notice (worst case: they act on a total that omits 30
items) or they notice and stop trusting the dashboard. Their workaround is `ls -R ~/.claude/commands`
in a terminal, which is what our product exists to replace.

**Value to Loush.** This is the correctness precondition for the entire CapabilityLedger thesis.
Every headline we print is of the form "you pay N tok for M capabilities"; if M is wrong the product
is wrong. It also converts our biggest liability — *silently* incomplete inventory — into our
differentiator, since inventory completeness is the one thing we can verify from the filesystem.

**How the upstream repo does it today.** SuperClaude's installer copies `*.md` into
`Path.home()/".claude"/"commands"/"sc"` — a namespace subdirectory
(`install_commands.py:25`, per `superclaude-framework.md:187`) — and its agents flat into
`~/.claude/agents/` (`install_commands.py:204`). It offers no reader; the closest thing is
`list_installed_commands()` (`install_commands.py:125-162`), which diffs shipped vs installed by
globbing its own single target directory. We are not porting that; it answers a narrower question
than ours and only for its own files.

**How we implement it here.**

Create `lib/capability-paths.mjs` — a new pure module, no deps, no I/O beyond what is injected —
exporting three functions:

- `walkKind(rootDir, kind)` → `[{ name, file, root, relPath, depth }]`. Recursive. For flat kinds
  (`commands`, `agents`) it collects every `*.md` at any depth and derives
  `name = relPath.replace(/\.md$/, '').split(path.sep).join(':')`, so `sc/implement.md` →
  `sc:implement`. That colon form is how Claude Code namespaces nested commands and how the user
  types them, so it is also what the fire-matcher at `server/index.mjs:2864` already expects. For
  `skills` it collects every directory containing `SKILL.md`, at any depth, with the same
  `/`→`:` naming.
- `nameToRelPath(kind, name)` → inverse mapping, `:`→`path.sep`, plus the `.md` / `SKILL.md` suffix.
- `isSafeCapabilityName(name)` → `/^[\w.-]+(:[\w.-]+)*$/`. Rejects `..`, absolute paths, and
  separators. This is belt-and-braces; `safe()` (`server/index.mjs:125-130`) remains the jail.

Then:

- Rewrite `itemFile()` / `itemRoot()` (`server/index.mjs:166-171`) to call `nameToRelPath()`.
  `safe()` still wraps every write path, so traversal via a crafted `name` stays blocked.
- Replace the loop bodies at `server/index.mjs:183`, `:375`, `:603`, `:831`, `:1004` and `:2421`
  with `walkKind()`. Delete the inline `readdirSync` at each — the point is that six copies become
  zero.
- Loosen the create-name guard at `server/index.mjs:224` from `/^[\w.-]+$/` to
  `isSafeCapabilityName`, and `mkdirSync(path.dirname(file), { recursive: true })` already exists at
  `server/index.mjs:227`, so creating `sc:mycommand` will work without further change.
- Cap recursion depth at 4 and total entries at 2,000 per kind. `~/.claude/commands` is not
  adversarial, but the artifacts walker already carries a hard cap (`server/index.mjs:502`) and
  matching that discipline is cheap.
- **Do not** change `groupOf()` (`server/index.mjs:591-594`). It splits on `[-_]`, so `sc:implement`
  groups as `commands` — correct and unsurprising. Namespace-as-group is feature 5's job.

**Effort.** **S** for the walker and the six call sites; the whole change is ~90 lines added,
~30 deleted. The ~2h of it is the six call sites, not the algorithm.

**Risks and unknowns.**
- *Name collision.* A flat `~/.claude/commands/implement.md` and a nested `sc/implement.md` both
  exist. Under the colon scheme they are `implement` and `sc:implement` — distinct, so no collision.
  But `capabilityLedger()`'s fallback at `server/index.mjs:2866` matches `/implement` to the short
  name, and would credit the fire to the flat one. Acceptable: it is a strict improvement over
  crediting nobody, and the ambiguity is genuinely present in the transcript. Do **not** double-count
  — the existing `else if` at `:2866` already prevents that.
- *Existing tags break.* `readMeta().tags` is keyed `"<kind>:<name>"` (`server/index.mjs:599`,
  `:646`). Nested names contain colons, making `commands:sc:implement` — parseable only if consumers
  split on the *first* colon. Grep shows the key is used as an opaque string everywhere
  (`src/sections/CapabilityLedger.jsx:219`), so this is safe today, but it is a trap for the next
  person. Document it in the `readMeta` comment.
- *Windows separators.* `walkKind` must normalise `\` to `/` before the `:` join, or names differ per
  platform. This is a real bug risk on our primary dev platform and is exactly what the unit test is
  for.
- *Unverified:* whether Claude Code itself renders nested commands as `sc:implement` or `sc/implement`
  in its own palette. Our matcher tolerates both via `split(':').pop()`, so the choice is
  cosmetic — but it should be confirmed before we print the name as if it were canonical.

**Definition of done.**
- `test/lib/capability-paths.test.mjs` exists and passes under `npm test`. It builds a temp tree
  containing `commands/flat.md`, `commands/sc/implement.md`, `commands/deep/a/b.md`,
  `skills/x/SKILL.md`, `skills/ns/y/SKILL.md` and asserts the exact name set
  `['flat','sc:implement','deep:a:b']` and `['x','ns:y']`, on both `/` and `\` separators.
- Round-trip property: for every name returned by `walkKind`, `nameToRelPath` reproduces the file
  path that produced it.
- `GET /api/res/commands` on a tree containing `commands/sc/*.md` returns 30 rows, and
  `GET /api/res/commands/item?scope=user&name=sc:implement` returns its content.
- `GET /api/overview` item count increases by exactly the number of nested files; `GET /api/capabilities`
  `items.length` and `headline.alwaysOnTokens` both increase correspondingly.
- CustomizeSection can toggle `sc:implement` off and the file on disk becomes
  `~/.claude/commands/sc/implement.md.off`.
- ChatSection autocomplete: typing `/sc` offers the namespaced commands.
- **Null/empty state:** when `~/.claude/commands` does not exist at all — the state on this machine
  today — every affected surface renders its existing empty copy and **not** a zero. ResourceSection
  shows `(0)` with the "+ New" affordance; CapabilityLedger's headline must not claim "0 capabilities
  never fired" as a finding. Add an explicit assertion for the missing-directory case; it is the
  common case, not an edge case.

---

## 2. `.agent/` skill roots

**Customer need.** A developer using openskills (10.4k★) installs skills with `--universal` so they
work across Claude Code, Codex and Cursor. Those land in `.agent/skills/`
(`context-and-skills-tooling.md:568-574`). Our dashboard reports their skill inventory as if those
skills do not exist. Today they have no tool that reconciles the two locations — openskills' own CLI
lists them but has no telemetry by design (`context-and-skills-tooling.md:683`), so nobody can tell
them which ones ever fired.

**Value to Loush.** Cheap breadth: it makes us correct for the second-largest skill distribution
convention in the ecosystem, and it is the difference between "reads `~/.claude`" and "reads the
places agent skills actually live". It also removes the *second* of the three blind spots, which is
the point of the argument in §"Verdict on the sibling bug".

**How the upstream repo does it today.** `openskills`' `src/utils/dirs.ts` resolves four
directories, first match wins: `./.agent/skills`, `~/.agent/skills`, `./.claude/skills`,
`~/.claude/skills`. `findAllSkills()` dedupes by directory name across all four and labels
`location` as `'project'` if the directory is under `process.cwd()`, else `'global'`
(`context-and-skills-tooling.md:568-577`). Note their own open defect #84: `--universal` writes
`.agent/` while some docs say `.agents/` (`context-and-skills-tooling.md:514-515, 685`).

**How we implement it here.**

- Extend `KINDS.skills.dirs()` (`server/index.mjs:151`) to four entries in openskills' resolution
  order, each carrying a `root` label: `agent-project` (`PROJECT/.agent/skills`),
  `agent-user` (`~/.agent/skills`), then the existing `project` and `user`.
- Implement first-match-wins dedupe **by skill name** in `walkKind`'s caller, matching
  `findAllSkills()`. A skill present in both `.agent` and `.claude` is one capability, not two —
  double-counting it would inflate `alwaysOnTokens`, which is the sin this whole spec exists to fix.
  Surface the shadowed copy as a `shadowedBy` field rather than a row.
- Because of defect #84, probe **both** `.agent/skills` and `.agents/skills`. Two `existsSync` calls;
  cheaper than being wrong for half their users.
- Extend `ALLOWED_ROOTS` (`server/index.mjs:124`) with `~/.agent` and `PROJECT/.agent`. Without this
  every write path through `safe()` 403s. **This widens the write jail** and is the one genuinely
  security-relevant line in this spec — it must be a deliberate, reviewed diff, not a drive-by.
- Keep `scope` values as they are for the existing two roots so nothing downstream breaks; add
  `root` as a new field.

**Effort.** **S**. The walker from feature 1 does the work; this is configuration plus a dedupe rule
plus one security-relevant constant.

**Risks and unknowns.**
- *`ALLOWED_ROOTS` widening.* Two new writable roots. Mitigation: add them **read-only first** — a
  separate `SCAN_ROOTS` list used by discovery, with `ALLOWED_ROOTS` left alone until someone asks
  to edit a `.agent` skill. Ship the read half in v1; that captures ~all the value.
- *Unverified:* whether `.agent/skills` is loaded by Claude Code itself, or only by openskills'
  `npx openskills read` shim. `context-and-skills-tooling.md:488` says nothing enforces the shim.
  **If Claude Code does not load them, they cost zero always-on tokens and must not be billed as if
  they did.** Until verified, mark these rows `alwaysOnTokens: null` (rendered `—`) rather than
  computing a number — our honest-null rule (`src/sections/Overview.jsx:6-8`) covers exactly this.
  This is a blocking question; see Open questions.

**Definition of done.**
- Unit test: a temp tree with the same skill name in `.agent/skills` and `.claude/skills` produces
  **one** row, sourced from `.agent`, carrying `shadowedBy: '<path>'`.
- `GET /api/res/skills` includes `.agent`-rooted skills with a distinguishable `root`.
- CapabilityLedger shows a `root` chip; `.agent` rows show `—` for always-on tokens with a tooltip
  reading "not confirmed to load into Claude Code context — not counted", not `0`.
- **Null/empty state:** no `.agent` directory anywhere (this machine) → no new rows, no new chip, no
  "0 universal skills" line anywhere. Absence renders as absence.

---

## 3. Plugin-installed capabilities

**Customer need.** Anyone who has installed a Claude Code plugin — the officially blessed
distribution channel — is looking at a dashboard that shows the plugin as one row worth 0 tokens
while it silently contributes N skills, commands and agents to every session. On this machine that
is 14 real skills reported as zero. The user's workaround today is nothing; there is no tool that
prices a plugin.

**Value to Loush.** The largest measured discovery gap we have, and the only one whose fix nobody
else in the 690-project survey ships. It also converts the plugin row from decoration into the first
real answer to "is this plugin worth its context cost?", which is the CapabilityLedger thesis applied
to the unit users actually install and uninstall. Strictly higher value than feature 5, because a
plugin is a first-party unit with a manifest, whereas a framework has to be sniffed.

**How the upstream repo does it today.** SuperClaude ships a plugin payload in-tree
(`plugins/superclaude/.claude-plugin/plugin.json`, `superclaude-framework.md:353-367`) declaring
`commands`, `agents`, `skills`, `hooks` and `mcpServers` as relative paths, but has **not published
it** — README concedes v5.0 (`superclaude-framework.md:86-88`). So for SuperClaude specifically this
channel is currently empty; we are implementing against the *native* Claude Code layout, which we
have on disk here and which the SuperClaude manifest happens to conform to.

**How we implement it here.**

New `server/plugins.mjs`:

- Read `~/.claude/plugins/installed_plugins.json`. Verified shape on this machine: `version: 2`, then
  `plugins: { "<name>@<marketplace>": [{ scope, installPath, version, installedAt, gitCommitSha }] }`.
- **Resolve capabilities only from `installPath`.** Do *not* glob `~/.claude/plugins/cache/**` —
  this machine caches both `superpowers/6.1.1` and `6.2.0`, 14 skills each, and a naive glob returns
  28 for a plugin that contributes 14. Do *not* walk `~/.claude/plugins/marketplaces/**` either: the
  31 `SKILL.md` and 29 command `.md` files there are the **catalogue of installable plugins**, not
  installed capability. Scanning it would inflate the ledger by ~60 phantom rows. This distinction is
  the single most important implementation detail in this feature.
- Cross-check against `settings.json.enabledPlugins` (already read at `server/index.mjs:421`). A
  plugin present in `installed_plugins.json` but `false` in `enabledPlugins` contributes **nothing**
  to context — emit its rows with `enabled: false` and `alwaysOnTokens: 0`, which is a true zero,
  not an honest-null.
- Within `installPath`, read `.claude-plugin/plugin.json` for the declared `commands` / `agents` /
  `skills` sub-paths, falling back to the conventional `commands/`, `agents/`, `skills/` when absent.
  Feed each to `walkKind()` from feature 1.
- Namespace names as `<plugin>:<name>` — matching how Claude Code itself surfaces them
  (`superpowers:brainstorming`) and, critically, matching the `c.input.skill` string our invocation
  scanner already records at `server/index.mjs:2378`.
- **Add prefix-tolerant skill matching to `capabilityLedger()`.** Commands have it at
  `server/index.mjs:2864`; skills have none. Mirror it: try the full namespaced name, then the bare
  name. Without this the 14 new rows all read DEAD despite firing, which would be a worse lie than
  omitting them.
- Add `plugins` handling to `overviewItems()` (`server/index.mjs:637-640`): the plugin row keeps
  `fullTokens: 0` but gains `contributes: { skills: n, commands: n, agents: n }`, and the contributed
  capabilities are pushed as normal rows with `source: '<plugin>@<marketplace>'`.
- Remove `'plugins'` from `SKIP_DIRS` (`server/index.mjs:497`)? **No.** Leave it. ArtifactsSection is
  a file browser and the plugin cache is thousands of files that would blow the 8,000-entry cap at
  `server/index.mjs:502`. Capability discovery goes through `server/plugins.mjs`, not the artifacts
  walker. Record this as a deliberate exemption in the discovery audit, not an oversight.

**Effort.** **M**. New module, one manifest format, plus the ledger matcher change. The
`installPath`-not-glob rule is what keeps it from being **L**.

**Risks and unknowns.**
- *Manifest schema drift.* `installed_plugins.json` carries `"version": 2`. We have one sample. Guard
  with a version check and degrade to "plugins detected but not itemised" rather than guessing at a
  v3 shape. Never silently mis-parse.
- *`scope` field.* Entries carry `scope: "user"`. Unverified whether a project-scoped value exists
  and what it looks like. Treat unknown scopes as user-scope and log once.
- *Attribution to a fire.* A plugin skill and a global skill of the same bare name are
  indistinguishable in the transcript if the harness records the bare form. Prefer the namespaced
  match; only fall back to bare when exactly one candidate exists. When two candidates exist and only
  the bare name was recorded, credit **neither** and mark both `fires: null` with a tooltip — an
  honest null beats a coin flip.
- *Marketplace path stability.* `~/.claude/plugins/{cache,data,marketplaces,installed_plugins.json,known_marketplaces.json}`
  is observed, not documented. If it moves, we degrade to zero plugin rows, which is today's
  behaviour — the failure mode is safe.

**Definition of done.**
- `test/server/plugins.test.mjs` builds a fixture `~/.claude/plugins` with two cached versions of one
  plugin and a populated `marketplaces/` tree, and asserts we return **only** the `installPath`
  version's capabilities — no double-count, no catalogue leakage.
- On this machine, `GET /api/capabilities` returns 14 additional skill rows named
  `superpowers:<skill>`, and at least one of them has `fires90 > 0`.
- The `superpowers` plugin row shows `contributes: { skills: 14 }` instead of a bare zero.
- A plugin listed in `installed_plugins.json` but disabled in `enabledPlugins` contributes rows with
  `enabled: false, alwaysOnTokens: 0`.
- **Null/empty state:** no `~/.claude/plugins` directory, or an unrecognised `version` → no plugin
  rows, and the ledger footer reads "no plugins detected" rather than "0 plugin capabilities". An
  unparseable manifest renders "plugins detected but could not be read" with the path, never a zero.

---

## 4. Install-time provenance sentinel

**Customer need.** A user installs a framework or plugin today and our ledger tells them, within the
hour, that its files are DEAD and offers to archive them. That is an actively harmful
recommendation — the ledger's archive flow deletes files (backed up, but still)
(`server/index.mjs:2911-2936`). The user's only defence is to distrust the verdict, which defeats
the feature.

**Value to Loush.** Every verdict in the ledger and every `tokPerFire` figure keys off a timestamp we
currently take from `fs.statSync().mtimeMs` (`server/index.mjs:613`, consumed at
`server/index.mjs:2877-2878`). Fixing the timestamp fixes the whole column at once. It also protects
the fix already made in `lib/harness-metrics.mjs:12-25` from being silently undone by any installer
that preserves mtimes.

**How the upstream repo does it today.** SuperClaude copies with `shutil.copy2`
(`install_commands.py`, per `superclaude-framework.md:192, 432-434`), which preserves the **wheel's**
mtime — the build timestamp, not the install timestamp. Upstream records install time nowhere. Two
*other* projects solve it properly and give us the schema for free: openskills writes a per-skill
`.openskills.json` sidecar with an ISO-8601 `installedAt` (`context-and-skills-tooling.md:579-593`),
and Claude Code's own `installed_plugins.json` records `installedAt` per plugin (verified on this
machine). The synthesis calls the sidecar "the single most portable artifact in the project"
(`context-and-skills-tooling.md:594-596`) and lists it as a Cluster C adopt (`_SYNTHESIS.md:226`).

**How we implement it here.**

Add `installedAt(kind, file, root)` to `lib/capability-paths.mjs`, resolving in priority order and
returning `{ at, source }` so the provenance is inspectable:

1. `.openskills.json` `installedAt` in the skill directory → `source: 'openskills'`
2. `installed_plugins.json` `installedAt` for the owning plugin → `source: 'plugin-manifest'`
3. directory **birthtime** (`fs.statSync().birthtimeMs`) of the namespace dir (`commands/sc/`) when
   it is non-zero → `source: 'dir-birthtime'`. `copy2` copies file times; `mkdir` still stamps the
   directory at real creation time. This is the mechanism that catches SuperClaude specifically.
4. our own sentinel: a `~/.claude/dashboard-meta.json` `firstSeen` map, keyed `"<kind>:<name>"`,
   written on the first scan that observes a capability → `source: 'first-seen'`. `readMeta()` /
   `META_FILE` already exist (`server/index.mjs:556-557`) and are already written on the tags path
   (`server/index.mjs:651`), so this needs no new file and no new dependency.
5. file mtime → `source: 'mtime'` (today's behaviour, now explicitly the last resort)

Then:

- `overviewItems()` emits `installedAt` and `installedAtSource` alongside the existing `mtime`.
  Keep `mtime` — it is still the right signal for "recently edited".
- `capabilityLedger()` (`server/index.mjs:2877-2878`) uses `installedAt` for both `ageDays` and
  `sessionsSince()`.
- `capabilityVerdict()` gains no new logic; it just receives a truthful `ageDays`.
- Sentinel bootstrap hazard: on the very first run after this ships, `first-seen` would stamp
  *everything* as new, flipping the whole ledger to NEW. Guard it — on a cold `firstSeen` map, do not
  write `firstSeen` for capabilities whose mtime is older than `NEW_CAPABILITY_DAYS`
  (`lib/harness-metrics.mjs:26`); accept the mtime for those and only start sentinel-tracking new
  arrivals. One-line rule, prevents a very visible one-time regression.

**Effort.** **S**. Roughly 60 lines plus a test. The bootstrap guard is the subtle part.

**Risks and unknowns.**
- *`birthtime` portability.* Reliable on NTFS and APFS; on Linux ext4 it is often `0`. The resolver
  must treat `0` and `birthtime > mtime` as "unavailable" and fall through, not trust it.
- *One-time verdict churn.* Some rows will legitimately change verdict when this ships. That is the
  fix working. Add a line to the ledger footer for one release explaining that install dates are now
  measured rather than inferred from file mtime.
- *`dashboard-meta.json` growth.* One key per capability. Negligible; it already holds a tag map.

**Definition of done.**
- `test/lib/capability-paths.test.mjs` covers the resolver: a skill dir with `.openskills.json` wins
  over birthtime; birthtime wins over an mtime that is older than it; `birthtime === 0` falls
  through; a `firstSeen` entry wins over mtime; the cold-start guard does **not** stamp an old file.
- A file whose mtime is backdated 400 days but whose parent directory was created today resolves to
  today, with `installedAtSource: 'dir-birthtime'`, and its verdict is `NEW` rather than `DEAD`.
- CapabilityLedger renders `installedAtSource` in the row tooltip so the number is auditable.
- **Null/empty state:** when every resolver step fails, `installedAt` is `null`,
  `installedAtSource` is `null`, `ageDays` is `null`, `tokPerFire` renders `—` (already handled at
  `src/sections/CapabilityLedger.jsx:172`), and the verdict is **not** `DEAD` — add an
  `UNKNOWN` verdict rather than guessing. `capabilityVerdict()` currently returns `DEAD` when
  `ageDays == null` and `firesAll === 0` (`lib/harness-metrics.mjs:28-32`); that is a verdict
  invented from missing data and it must change.

---

## 5. Framework attribution

**Customer need.** A SuperClaude user's `~/.claude/agents/` contains 20 files installed flat and
unnamespaced (`superclaude-framework.md:180-191`), intermixed with their own. Our ledger shows 20
anonymous rows. The user cannot answer "what is SuperClaude costing me?" or "can I remove it?" —
and upstream ships **no uninstall at all** (`superclaude-framework.md:267-269`), so their real
alternative is hand-picking 20 files out of a shared directory.

**Value to Loush.** Lets the ledger price a framework as a **unit**: "SuperClaude v4.3.0 — 50
capabilities, N tok/session, 27 never fired." No other tool in the surveyed ecosystem can produce that
sentence, because producing it requires both an inventory and real fire counts, and nobody else has
both. `_SYNTHESIS.md:321` ranks this Tier 2.5.

**How the upstream repo does it today.** It does not. Agents install flat with no namespace, and the
only durable signatures are incidental: the exact body string `> **Context Framework Note**:`,
a `category:` frontmatter key alongside exactly `name` + `description`, and the
`~/.claude/commands/sc/` directory itself (`superclaude-framework.md:273-283, 421-423`).

**How we implement it here.**

New `server/frameworks.mjs` exporting `detectFrameworks(items)` — a table of detectors, each
returning `{ id, label, version, confidence, evidence[] }`. Rules are **ordered by strength** and
the evidence list is surfaced in the UI, so a wrong guess is inspectable rather than authoritative:

| Signal | Strength | Source |
|---|---|---|
| `.claude-plugin/plugin.json` `name`+`version` (feature 3) | **definitive** | first-party manifest |
| `.openskills.json` `source` / `repoUrl` (feature 4) | **definitive** | first-party sidecar |
| capability name prefixed `sc:` (i.e. under `commands/sc/`) | strong | `superclaude-framework.md:187` |
| body contains `> **Context Framework Note**:` | strong | `superclaude-framework.md:423` |
| frontmatter keys are exactly `{name, description, category}` | weak — corroborating only | `superclaude-framework.md:273-283` |
| `~/.superclaude/` exists | weak | `superclaude-framework.md:250-256` |

Emit `source` on each ledger row; add `['source', 'Source']` to `COLS`
(`src/sections/CapabilityLedger.jsx:26-30`) and a filter chip alongside the existing verdict chips
(`:109-114`). Add a per-framework roll-up strip above the table reusing the existing headline
component shape.

**Explicitly out of scope:** shelling out to `superclaude --version`. The research suggests it
(`superclaude-framework.md:765`). It executes an arbitrary binary off `$PATH` from an
unauthenticated localhost endpoint, and `_SYNTHESIS.md:63-75` already records that our security
posture is the weak part of this codebase. Read `plugin.json` / the sidecar or report the version as
`null`.

**Effort.** **M**. Detector table is small; the roll-up UI and the confidence/evidence plumbing are
the work.

**Risks and unknowns.**
- *False attribution.* Someone's hand-written agent that happens to use a `category:` key gets tagged
  SuperClaude. Mitigated by never attributing on a weak signal alone, and by rendering
  `confidence` + `evidence` in the tooltip. A user must be able to see *why* we said it.
- *Not-installed-by-us frameworks.* Detection is signature-based and will miss anything unsignatured.
  Unattributed rows must render `—`, never "unknown framework" or a bucket that implies completeness.
- *Do not build the uninstall flow yet.* `superclaude-framework.md:823-833` proposes framework-aware
  install/uninstall (effort L). It is correctly gated behind attribution. Not in this spec.

**Definition of done.**
- Fixture: 20 agent files with the Context Framework Note plus 3 hand-written ones; exactly 20 are
  attributed, and each carries `confidence: 'strong'` and a non-empty `evidence` array.
- CapabilityLedger has a `Source` column and a source filter chip; filtering to one framework yields
  a roll-up: N capabilities, N tok/session, N never fired.
- No performance percentages from upstream appear anywhere in the roll-up. **Enforced by test:**
  assert the rendered strings contain no `94%`, `98%`, `2-3x`, `30-50%`.
- **Null/empty state:** no framework detected → the `Source` column shows `—` for every row and the
  roll-up strip does not render. No "0 frameworks" tile.

---

## 6. Declared dependency graph (`mcp-servers` / `personas`)

**Customer need.** Two questions nobody can answer today. (a) "This command needs the `serena` MCP
server and I don't have it" — the command fails at runtime with a confusing error. (b) "I have
`morphllm` installed, costing context every session — what actually uses it?" MCP servers are the
most expensive always-on items in the ledger and the only kind with **no declared consumers**, so
they can never be ranked by ROI.

**Value to Loush.** Turns our flat capability list into a graph, and gives MCP servers a denominator
they currently lack. Feeds `FlowSection` / `PlanGraph`, where we already run d3 and already compute
`defined` vs `observed` edges (`server/index.mjs:2435-2455`). `_SYNTHESIS.md:224-225` ranks it Tier 2.

**How the upstream repo does it today.** Every SuperClaude command file carries
`mcp-servers: [context7, sequential, magic, playwright]` and
`personas: [architect, frontend, backend, security, qa-specialist]` in frontmatter
(`superclaude-framework.md:306-322`). Nothing in Claude Code records this and nothing in SuperClaude
*reads* it either — it is documentation that happens to be machine-readable. That is the whole
adoption: a schema, zero code.

**How we implement it here.**

- `overviewItems()` (`server/index.mjs:614-619`) carries `declaredMcp = fm['mcp-servers']` and
  `declaredAgents = fm.personas` through, normalised to arrays of strings. Accept both YAML list and
  comma-string forms — `hubListAgents` already does exactly this normalisation for `fm.tools` at
  `server/index.mjs:1509-1511`; reuse the shape.
- `/api/flow` (`server/index.mjs:2435-2443`) gains a third edge class, `declared`, beside the existing
  `defined` (body-mention regex) and `observed` (transcript). Keeping them separate matters: `defined`
  is a heuristic that can false-positive on any 4-character name; `declared` is an author's
  statement. Render them distinguishably.
- New derived findings, both computable from the join:
  - **broken dependency** — `declaredMcp` names a server absent from `readClaudeJson().mcpServers`.
    Surface in `McpSection.jsx` and as an Inbox item.
  - **orphan MCP** — an installed server that no command declares *and* that has no observed
    invocation. This is the MCP-level ROI verdict the ledger cannot currently produce.
- Adopt `mcp-servers` / `personas` in our own command template (`server/index.mjs:158`) so capabilities
  authored in Loush are graph-legible.

**Effort.** **M**. Parsing is trivial; the value is in the two derived findings and the Flow rendering.

**Risks and unknowns.**
- *Adoption is one framework deep.* SuperClaude is the only project we found using these keys, and it
  has 1 commit in 90 days (`superclaude-framework.md:21`). If nobody else adopts, the feature helps
  SuperClaude users only. Mitigation: the *findings* are generic — an orphan-MCP check works from
  observed invocations alone, with declarations merely improving it. **Build the orphan check first;
  it delivers value with zero declarations present.**
- *Persona names are not our agent names.* `personas: [architect, frontend]` refers to SuperClaude's
  internal vocabulary, not the `~/.claude/agents/` filenames (`system-architect`, `frontend-architect`).
  Match by prefix/substring and mark unmatched personas as unresolved. **Do not** silently drop them
  and do not invent an edge.
- *`name` inconsistency.* SuperClaude's `name:` is sometimes bare (`implement`) and sometimes prefixed
  (`sc:index-repo`) (`superclaude-framework.md:324-326`). Always key off the **file path**, never
  `fm.name`.

**Definition of done.**
- A command declaring an uninstalled MCP server produces exactly one Inbox item naming both.
- An installed MCP server with zero declared consumers and zero observed invocations appears in the
  ledger with an explicit "no declared or observed consumer" note — not a silent zero.
- Flow renders `declared` edges distinguishably from `defined` and `observed`, with a legend.
- Unresolved personas are listed as unresolved, with the raw string shown.
- **Null/empty state:** no command in the tree declares anything → the declared-edge legend entry and
  the broken-dependency panel do not render at all. No empty graph, no "0 dependencies".

---

## 7. Frontmatter lint

**Customer need.** A command whose frontmatter does not parse silently does nothing useful — Claude
Code treats the YAML as prompt text. The user sees a command that behaves oddly and has no way to
find out why. Two files in a *tagged release* of the ecosystem's most-starred framework are in this
state: `commands/agent.md` has a closing `---` with no opening one, and `commands/business-panel.md`
fences its frontmatter in a ```` ```yaml ```` block after a heading
(`superclaude-framework.md:425-429`). Nothing in their CI validates the payload
(`superclaude-framework.md:667-668, 683-684`).

**Value to Loush.** Small, and it is the archetype of a finding only a tool that *reads the files*
can produce. It also hardens our own parser: `parseFM()` (`server/index.mjs:139-145`) already returns
`{fm:{}}` on no-match and `{_parse_error}` on YAML failure, and **both signals are currently thrown
away by every caller.** We are already computing the diagnosis and discarding it.

**How the upstream repo does it today.** It does not — that is the finding. Their 136 tests all
target the Python half; not one asserts a shipped command file has parseable frontmatter
(`superclaude-framework.md:683-684`).

**How we implement it here.**

- Extend `parseFM()` to return a `lint` array alongside `fm` and `body`. Rules, each with a stable
  code:
  - `FM_MISSING` — no frontmatter block at all
  - `FM_NO_OPEN` — a `---` line exists later in the file but not at position 0 (catches `agent.md`)
  - `FM_FENCED` — a ` ```yaml ` block containing `name:` or `description:` before any real
    frontmatter (catches `business-panel.md`)
  - `FM_PARSE_ERROR` — promote the existing `_parse_error` from a silently-swallowed key
  - `FM_NAME_MISMATCH` — `fm.name` disagrees with the filename/dirname (SuperClaude's
    `confidence-check` skill declares `name: Confidence Check`, `superclaude-framework.md:336-339`)
  - `FM_NO_DESCRIPTION` — description absent or empty; this is the field that governs whether Claude
    Code ever auto-selects the capability
- Propagate `lint` through `overviewItems()` into ledger and Inventory rows. Render a warning glyph
  in the Inventory `Lint` column (`src/sections/CapabilityLedger.jsx:196, 246-250`) — that column
  already exists and already reads as a linter, so this is a natural home.
- **Do not let a lint failure change a token count or a verdict.** A malformed file still costs
  context. Lint is an annotation, not an input to the ROI maths.

**Effort.** **S**. Pure function, fully unit-testable, no I/O.

**Risks and unknowns.**
- *`FM_NAME_MISMATCH` false positives.* Title-cased display names may be intentional. Emit it as
  `info` severity, not `error`, and never let it gate anything.
- *CRLF.* Our regex already handles `\r?\n` (`server/index.mjs:140`) and SuperClaude's files are CRLF
  on Windows (`superclaude-framework.md:430-431`). The new fenced/no-open detectors must be equally
  tolerant. Test both line endings.

**Definition of done.**
- `test/lib/parse-fm.test.mjs` with six fixtures, one per code, plus a clean control, in both LF and
  CRLF. The `FM_NO_OPEN` and `FM_FENCED` fixtures are transcriptions of the two SuperClaude shapes.
- A malformed command appears in Inventory with a warning glyph and a tooltip naming the code and the
  concrete consequence ("no opening `---` — Claude Code is reading 3 lines of YAML as prompt text").
- Its token counts and ROI verdict are byte-identical to what they were before lint shipped.
- **Null/empty state:** all files clean → no lint column decoration, no summary banner, no "0 issues
  found" badge. Clean is silent.

---

## 8. `Will Not:` boundaries — authoring template and scoring signal

**Customer need.** People writing agents in Loush produce prompts that say what the agent should do
and never what it must refuse. The result is an agent that wanders outside its lane, which the user
experiences as unpredictability rather than as a missing prompt section. Our `scoreItem()` gives them
no hint: it rewards frontmatter completeness and markdown structure and is blind to constraint
quality.

**Value to Loush.** A scoring dimension that measures something real, and 20 MIT-licensed worked
examples we can ship as a template. It also partly answers the standing critique of `scoreItem()`
recorded in its own comment (`server/index.mjs:561`: "static-analysis heuristic, not an LLM judge").

**How the upstream repo does it today.** All 20 SuperClaude agents follow one template — Triggers /
Behavioral Mindset / Focus Areas / Key Actions / Outputs / **Boundaries (`**Will:**` / `**Will
Not:**`)** — with a median length of 48 lines, 12 of 20 exactly 48
(`superclaude-framework.md:286-304`). The research's own assessment is that the `Will Not` block is
the highest-leverage part of an agent prompt and almost nobody writes one
(`superclaude-framework.md:639`). MIT licensed (`superclaude-framework.md:15`).

**How we implement it here.**

- Add an agent template to `ResourceSection`'s `SPECS` / `defaultBody` path
  (`src/sections/ResourceSection.jsx:90`) using the six-section skeleton, with `**Will:**` /
  `**Will Not:**` pre-stubbed. Our own wording throughout — we take the *shape*, not their prose.
- Add to `scoreItem()` (`server/index.mjs:560-579`): `+8` when the body contains an explicit negative
  boundary section (`/^\s*\*{0,2}Will Not|^#{1,3}\s*(Boundaries|Constraints|Non-goals)/mi`). Rebalance
  so the maximum stays 100 — the function already clamps at `server/index.mjs:578`, but a silent clamp
  hides the rebalance. Adjust an existing weight down by 8 rather than relying on the clamp.
- Leave `specificityOf()` (`server/index.mjs:581-590`) alone. It already rewards
  `/do not|don't|never|only|instead of/` **in the description** (`server/index.mjs:588`) — a
  different axis (trigger precision) from body constraints. Do not double-count the same idea.
- Attribute the template's provenance in a comment: SuperClaude, MIT. `_SYNTHESIS.md:138-161` is the
  licensing section; this is the only feature in this spec that copies structure from upstream.

**Effort.** **S**.

**Risks and unknowns.**
- *Score inflation.* Every existing agent's score shifts. Ship the rebalance and the new signal in one
  commit so no release shows scores that moved for an unexplained reason.
- *Gameable.* An empty `## Boundaries` heading scores the points. Require at least one non-empty line
  under the heading. This is a linter, not a judge — say so; the copy at
  `src/sections/CapabilityLedger.jsx:258` already does.

**Definition of done.**
- `test/lib/score-item.test.mjs` asserts the boundary bonus fires on a real `**Will Not:**` block and
  does **not** fire on a bare heading with no content; and asserts a maximal document still scores
  ≤ 100 without relying on the clamp.
- "+ New agent" in ResourceSection produces a body with `**Will:**` / `**Will Not:**` stubs.
- **Null/empty state:** unchanged — an agent with no boundaries section simply scores lower. No new
  warning, no nag.

---

## 9. Adopt `workflow_metrics.jsonl` as an export schema

**Customer need.** Users who want to analyse their own harness data outside our UI have no stable
export. They screenshot our panels or re-parse `~/.claude/projects/**/*.jsonl` themselves.

**Value to Loush.** We already derive every one of the required fields from real transcripts. Emitting
them under a *published* schema makes our numbers interoperable and gives Insights a defensible field
list instead of an ad-hoc one. The inversion is the point and it is worth stating publicly: upstream
specified this telemetry rigorously and **never wrote a single line of it** — the only checked-in
record is a hand-made `"session_id": "test_initialization"` stub
(`superclaude-framework.md:410-414`). We have the data they specified.

**How the upstream repo does it today.** `docs/memory/WORKFLOW_METRICS_SCHEMA.md` specifies 15 fields
with 9 required — `timestamp`, `session_id`, `task_type`, `complexity`, `workflow_id`, `layers_used`,
`tokens_used`, `time_ms`, `success` (`superclaude-framework.md:398-408`) — plus a weekly-review and
A/B promotion process gated on `p < 0.05` and success rate ≥ 95%. The analysis scripts exist and have
no input. Adopt the schema; ignore the implementation.

**How we implement it here.**

- New `GET /api/export/workflow-metrics?days=N`, alongside `/api/usage`. Emits newline-delimited JSON.
- Map from what `scanTranscripts()` / `collectUsage()` already produce: `timestamp`, `session_id`,
  `tokens_used`, `time_ms`, `files_read`, `sub_agents`, `success`.
- **Omit fields we cannot ground.** `task_type` and `complexity` are keyword-matched upstream and
  partly Japanese (`superclaude-framework.md:820-821`); `workflow_id` and `layers_used` describe a
  SuperClaude-internal execution model we do not have; `confidence_score`,
  `hallucination_detected` and `user_feedback` are self-reported. Emitting a fabricated value for any
  of these would violate our own honesty rule more seriously than omitting a required field. Omit
  them, and say so in the endpoint's own metadata header rather than in a doc nobody reads.
- Ship a `_meta` first line declaring `schema: "superclaude/workflow_metrics"`, `schema_version`,
  `fields_omitted: [...]` with a one-line reason each. That header is the feature: it makes the gaps
  machine-readable instead of leaving a consumer to infer them.
- **Do not port** `ab_test_workflows.py` or `analyze_workflow_metrics.py`. They are Python, they need
  `scipy`, and `_SYNTHESIS.md:174-180` is explicit that formula churn on identical data is the failure
  mode we are most exposed to. No new deps.

**Effort.** **M**. The mapping is small; deciding and documenting what we refuse to emit is most of it.

**Risks and unknowns.**
- *Partial-schema interop.* A consumer expecting all 9 required fields gets 6. The `_meta` header is
  the mitigation, and it is honest in a way silently emitting `task_type: "unknown"` would not be.
- *Dead standard.* Upstream has 1 commit in 90 days; this schema may never have another implementer.
  Cost is low and the field list is defensible on its own merits.
- *Privacy.* This is Plane B data (`server/index.mjs:29-38`). The export must be self-only, contain no
  prompt text, and never accept a user/machine parameter. Non-negotiable.

**Definition of done.**
- `GET /api/export/workflow-metrics` returns NDJSON whose first line is the `_meta` header naming every
  omitted field with a reason.
- Every emitted record validates against the upstream field types for the fields present.
- A test asserts the payload contains no prompt text, no file contents, and no user/engineer identifier.
- **Null/empty state:** zero sessions in the window → the `_meta` line alone, plus HTTP 200. Not an
  empty body, not a 404, not a fabricated record.

---

## Discovery audit

Every location our scanners walk, against every location the ecosystem writes to. This table is the
deliverable that prevents the next blind spot; it should be updated in the same commit as any change
to `lib/capability-paths.mjs`.

Evidence column cites our code (`path:line`) or a direct observation on this machine. "Scan?" is our
state **before** this spec ships.

| Path | What lives there | Do we scan it? | Evidence | Fix effort |
|---|---|---|---|---|
| `~/.claude/commands/*.md` | user commands, flat | **Yes** | `server/index.mjs:156` `KINDS.commands.dirs()`; loops at `:183, :375, :603, :1004, :2421` | — |
| `~/.claude/commands/<ns>/**/*.md` | namespaced commands (SuperClaude's `sc/`, 30 files) | **NO — D3** | `KINDS.commands.nested=false` `:157`; `itemFile()` `:166-168`; `continue` at `:606` | S (feature 1) |
| `~/.claude/agents/*.md` | user subagents, flat. SuperClaude's 20 land here unnamespaced | **Yes**, but unattributed | `:161`; `superclaude-framework.md:180-191` | — (feature 5 for attribution) |
| `~/.claude/agents/<ns>/**/*.md` | namespaced subagents | **NO** | `KINDS.agents.nested=false` `:162` — same defect as commands | S (feature 1) |
| `~/.claude/skills/<name>/SKILL.md` | user skills. **43 on this machine** | **Yes** | `:151`, `nested:true` `:152`; `ls ~/.claude/skills \| wc -l` = 43 | — |
| `~/.claude/skills/<ns>/<name>/SKILL.md` | namespaced skills | **NO** | `walkA` at `:204` recurses for *assets* only; the discovery loop at `:603` does not | S (feature 1) |
| `~/.claude/plugins/installed_plugins.json` | v2 registry: `installPath`, `version`, **`installedAt`**, `gitCommitSha` | **NO** | grep for `installed_plugins` across `server/ lib/ src/` → 0 hits | M (features 3, 4) |
| `~/.claude/plugins/cache/<mkt>/<plugin>/<version>/skills/**` | **installed** plugin skills. **28 files on this machine (14 live + 14 stale version)** | **NO** | `find … -name SKILL.md \| wc -l` = 28; `SKIP_DIRS` has `'plugins'` `:497`; `CAP_KIND` omits plugins `:2848` | M (feature 3) |
| `~/.claude/plugins/cache/**/commands/`, `**/agents/` | installed plugin commands/agents | **NO** | 0 on this machine (superpowers ships skills only), but the path is live | M (feature 3) |
| `~/.claude/plugins/marketplaces/**` | **catalogue** of installable plugins: 31 `SKILL.md`, 29 command `.md` | **No — and correctly so** | `find` counts; these are not installed. Scanning would inflate the ledger by ~60 phantom rows | — (deliberate) |
| `~/.claude/settings.json` → `enabledPlugins` | which plugins are active | **Yes** | `customizePlugins()` `:420-425`; `overviewItems()` `:637-640` | — |
| `~/.claude/settings.json` → `hooks` | hook config | **Yes** | `customizeHooks()` `:427-436` | — |
| `~/.claude/templates/*` | templates | **Yes**, flat only | `:623-630`; no recursion, `isFile()` filter at `:625` | S (feature 1, same walker) |
| `~/.claude.json` → `mcpServers` | user MCP servers | **Yes** | `readClaudeJson()` `:246`; `/api/mcp` `:250-256` | — |
| `~/.claude.json` → `projects[].mcpServers` | project MCP servers | **Yes** | `:253-254` | — |
| `~/.claude.json` → `_disabledMcpServers` | our own off-state park | **Yes** (ours) | `:416`, `:461-464` | — |
| `~/.claude/CLAUDE.md` | global always-on rules | **Yes** | `RULE_TARGETS()` `:396`; `hubResolve()` `:1522` | — |
| `~/.claude/projects/**/*.jsonl` | transcripts (all usage/fire data) | **Yes**, recursive | `walkJ` `:660`; `scanTranscripts` `:2302` | — |
| `~/.claude/dashboard-meta.json` | our tags / inbox state / (future) `firstSeen` | **Yes** (ours) | `META_FILE` `:556-557` | — |
| `<project>/.claude/commands/**` | project commands | **Yes**, flat only | `:156`; `listDir(…, false)` `:831`, used `:854` | S (feature 1) |
| `<project>/.claude/agents/**` | project subagents | **Yes**, flat only | `:161`; `:855` | S (feature 1) |
| `<project>/.claude/skills/<name>/SKILL.md` | project skills | **Yes**, one level | `:151`; `:853`; `hubListSkills` `:1492` | S (feature 1) |
| `<project>/.mcp.json` | project MCP servers | **Yes** | `:839`; `:2434` | — |
| `<project>/CLAUDE.md`, `.claude/CLAUDE.md`, `AGENTS.md`, `.cursorrules` | project rules | **Yes** | `RULE_TARGETS()` `:395-401`; `hubResolve()` `:1520-1526` | — |
| `<project>/.agent/skills/**` | openskills universal skills, **project** scope, **resolved first** | **NO — D3's sibling** | grep `\.agent` across `server/ lib/ src/` → only `agentType`/`agentId`; `context-and-skills-tooling.md:568-574` | S (feature 2) |
| `~/.agent/skills/**` | openskills universal skills, **global** scope | **NO** | same | S (feature 2) |
| `<skill>/.openskills.json` | provenance sidecar: `source`, `repoUrl`, **`installedAt`** | **NO** | grep `openskills` → 0 hits; `context-and-skills-tooling.md:579-593` | S (feature 4) |
| `~/.claude/plugins/<p>/.claude-plugin/plugin.json` | plugin manifest: name, version, capability sub-paths | **NO** | grep `CLAUDE_PLUGIN_ROOT` / `plugin.json` in `server/` → 0 hits; `superclaude-framework.md:353-367` | M (feature 3) |
| `~/.claude/plugins/<p>/hooks/hooks.json` | plugin-supplied hooks (e.g. a `PostToolUse` prompt hook on every `Write\|Edit`) | **NO** — we read only `settings.json` hooks | `customizeHooks()` `:427-428` reads `SETTINGS_FILES.user` only; `superclaude-framework.md:369-383` | M — not specced here; see Open questions |
| `~/.superclaude/airis-mcp-gateway/` | third-party gateway, plaintext API keys in `.env` | **No — and correctly so** | outside `~/.claude`; `ALLOWED_ROOTS` `:124`. `superclaude-framework.md:250-256` | — (deliberate; see Not worth taking) |
| `<project>/docs/memory/*.jsonl` | SuperClaude reflexion / metrics ledgers | **No** | `server/memory.mjs` reads `~/.claude/projects/**/memory/*.md` only (`server/memory.mjs:43-48`) | M — not specced here |
| `~/.claude/history.jsonl` | clean prompt corpus | **No** | present on this machine; `_SYNTHESIS.md:306` Tier 1.5 | S — not specced here |
| `~/.claude/file-history/`, `usage-data/` | first-party stores — exact rework counts, Claude's own friction grading | **No** — explicitly skipped | `SKIP_DIRS` `:497` contains both; `_SYNTHESIS.md:332-333` Tier 3 | M, gated — not specced here |

**Reading of the table.** Of 12 capability-bearing locations, we fully cover 5, partially cover 4
(flat-only), and miss 3 entirely. All 3 misses and all 4 partials are in the **same** subsystem, and
every one of them is a variation on "the path is deeper or elsewhere than the loop assumed". Features
1–4 close all seven. The remaining "not specced here" rows are real gaps but belong to other clusters
(hooks, memory, first-party stores) and are already tiered in `_SYNTHESIS.md:298-337`.

---

## Not worth taking

- **The 7 behavioural modes and ~25 flags.** Upstream's own installer places none of the files that
  define them (`superclaude-framework.md:83-85, 260-265, 526-533`). A flag whose definition file is
  never on disk is a token the model cannot interpret. There is nothing on disk for us to discover.
- **`/sc:recommend` (1,005 lines).** A command recommender is a symptom that 30 commands are not
  discoverable (`superclaude-framework.md:574-575`). Our answer is search plus real usage data, which
  we already have. Building a recommender would be adopting their bug.
- **The AIRIS MCP gateway.** Docker Compose fetched from a third party's `main` branch with SHA pins
  present in code but set to `None`, then `docker compose up -d`, plus plaintext API keys in
  `~/.superclaude/airis-mcp-gateway/.env` (`superclaude-framework.md:678-682`). Against our
  local-first, minimal-surface thesis, and it writes outside `~/.claude` entirely.
- **`superclaude --version` shelling out.** Executing a binary off `$PATH` from an unauthenticated
  localhost endpoint, in a codebase whose security posture `_SYNTHESIS.md:63-75` already flags as the
  weak point. Read the manifest or report `null`.
- **Their pytest plugin, `pm_agent/`, `execution/`.** A separate product that runs in the user's test
  suite, not in Claude Code (`superclaude-framework.md:601-606`). No dashboard surface.
- **`ConfidenceChecker` as a metric.** A model scoring its own readiness. Silin's "self-grading,
  fantasy" critique (`superclaude-framework.md:100-106`) applies, and `_SYNTHESIS.md:275` is explicit:
  do not adopt self-reported state under any circumstance. The 5-check *rubric* may be worth something
  to PromptStudio as a human checklist; the score is not.
- **Porting `ab_test_workflows.py` / `analyze_workflow_metrics.py`.** Python, needs `scipy`, and
  `_SYNTHESIS.md:174-180` records a case where displayed savings went 0% → 56% → 95.4% on identical
  data purely from formula changes. We take the schema (feature 9), not the statistics.
- **Any of their headline numbers, anywhere.** "94% token reduction", "98%", "2–3× faster",
  "30–50% fewer tokens" are frontmatter strings and a copied third-party marketing claim
  (`superclaude-framework.md:89-94`; `_SYNTHESIS.md:171`). Feature 5's DoD asserts their absence.
- **Scanning `~/.claude/plugins/marketplaces/**` for capabilities.** ~60 files that look exactly like
  installed capabilities and are not. Called out here because it is the mistake a well-intentioned
  implementer of feature 3 would make.
- **Removing `'plugins'` from `SKIP_DIRS`** (`server/index.mjs:497`). Tempting as a one-line "fix" for
  feature 3. It would push thousands of files at the artifacts walker's 8,000-entry cap
  (`server/index.mjs:502`) and still not produce capability rows. Plugin discovery belongs in a
  manifest-driven module.

---

## Open questions for the maintainer

1. **Does Claude Code load `~/.agent/skills` and `./.agent/skills`, or only openskills' `npx openskills
   read` shim?** Blocking for feature 2's pricing. If those skills never enter the context window, they
   cost 0 always-on tokens and billing them would be a fabrication. Until answered, feature 2 ships
   them as `alwaysOnTokens: null` (`—`). Answerable in ten minutes with a probe skill and one session
   transcript; I have not run it because it would write to your real `~/.claude`.

2. **Should nested capability names render as `sc:implement` or `sc/implement`?** Our fire-matcher
   tolerates both (`server/index.mjs:2864`). The colon form matches how users type the command and how
   plugin skills already appear in transcripts (`server/index.mjs:2378`), which is why feature 1
   chooses it. But it collides visually with our `"<kind>:<name>"` tag keys
   (`server/index.mjs:599`), producing `commands:sc:implement`. Accept the ugliness, or switch tag keys
   to a two-field object?

3. **What is the correct verdict when `installedAt` is unresolvable?** Feature 4 proposes a new
   `UNKNOWN` verdict, because `capabilityVerdict()` currently returns `DEAD` for
   `ageDays == null, firesAll === 0` (`lib/harness-metrics.mjs:28-32`) — a verdict manufactured from
   missing data, next to an archive button. Adding a fifth verdict touches
   `src/sections/CapabilityLedger.jsx:17-22, 93, 109-114` and the headline arithmetic at
   `server/index.mjs:2899-2906`. Confirm before I plan that as **S** rather than **M**.

4. **Is widening `ALLOWED_ROOTS` (`server/index.mjs:124`) to `~/.agent` acceptable?** Feature 2 needs
   it only to *edit* `.agent` skills. I propose a separate read-only `SCAN_ROOTS` for v1 so the write
   jail does not grow. Confirm, or authorise the widening explicitly.

5. **Plugin-supplied hooks are a discovery gap this spec does not close.** `customizeHooks()`
   (`server/index.mjs:427-428`) reads `settings.json` only, so hooks shipped inside a plugin
   (`<plugin>/hooks/hooks.json`) are invisible. SuperClaude's plugin channel ships a `PostToolUse`
   *prompt* hook matching `Write|Edit` (`superclaude-framework.md:369-383`), which fires an extra model
   turn on **every single edit** — an unmeasured cost we could price, since we already tally `Write`/
   `Edit` calls. Should that be a feature 10 here, or does it belong with the Cluster A / hooks work in
   `_SYNTHESIS.md:303`?

6. **Do you want the discovery audit table checked in CI?** A test that walks the table's "Do we scan
   it?" column against `lib/capability-paths.mjs`'s actual root list would make the next blind spot a
   failing test rather than a research project. Cheap, and it is the only mechanism proposed here that
   prevents recurrence rather than fixing an instance.

7. **`_SYNTHESIS.md:6-8` records that `anthropic-official-github.md` is incomplete** — sections B and C
   are stubs because the research agent hit a spend limit. Nothing in this spec depends on them, but if
   section C (Agent SDK) describes additional on-disk capability locations, the audit table is
   incomplete by exactly that much. Worth finishing before treating the table as closed.
