# SPEC — Governance and checklists

Implementation spec derived from `sdlc-build-frameworks.md` (research on `dlowenth/claude-code-build-framework`
and `krzemienski/claude-code-builder`) and `_SYNTHESIS.md` §1 D4, §7 Cluster D, §8 Tier 1.4 / 2.1.

Written 2026-07-29. **No upstream re-research was done for this document.** The upstream facts are taken
from the research files as committed. Everything about *our* code was verified by reading the files in this
checkout, and every claim about our code carries a `path:line`. Where our code contradicts the research, our
code wins and the disagreement is stated.

**Headline: of the 75 freeze-audit items, 58 have a concrete mechanical inspection against a real
checkout — 18 fully automatic, 40 partial (machine narrows, human closes). 17 are irreducibly human or
need a live database we do not have.** Counting the fully-mechanical *halves* of six split items, **24
items can be decided outright by a machine**. Of the 58, 48 are Medium confidence or better and are worth
building; the remaining 10 are Low confidence and must return `unknown` rather than a verdict. The full
item-by-item table is in [Auto-checkable audit items](#auto-checkable-audit-items).

**One upstream claim corrected by verification:** the research flagged the 14-event hook taxonomy as
needing confirmation. It was confirmed — and it undercounts. Anthropic's official hooks reference
(`https://code.claude.com/docs/en/hooks.md`) documents **30** hook events. Our picker has 9. Detail in
feature 6.

Licence note carried from `_SYNTHESIS.md` §5: both source repos are MIT with a `LICENSE` file verified
present. Any file that ports their checklist text must carry the copyright notice and attribution in its
header. That is a hard requirement of feature 2, not a nicety.

---

## Contents

1. [Route every config write through `track()` — fixes D4](#1-route-every-config-write-through-track--fixes-d4)
2. [The freeze audit as checklist data](#2-the-freeze-audit-as-checklist-data)
3. [Auto-check audit items against a real `.claude/` and checkout](#3-auto-check-audit-items-against-a-real-claude-and-checkout)
4. [Security tier 0–3 classifier with auto-escalation](#4-security-tier-03-classifier-with-auto-escalation)
5. [Three new `HOOK_LIBRARY` entries, including our first `PreCompact`](#5-three-new-hook_library-entries-including-our-first-precompact)
6. [Hook event picker: 9 → 30 events (verified)](#6-hook-event-picker-9--30-events-verified)
7. [Skill and plugin content audit](#7-skill-and-plugin-content-audit)
8. [Structured acceptance criteria and the review-rubric gate](#8-structured-acceptance-criteria-and-the-review-rubric-gate)

Then: [Auto-checkable audit items](#auto-checkable-audit-items) · [The checklist component](#the-checklist-component) ·
[Not worth taking](#not-worth-taking) · [Open questions for the maintainer](#open-questions-for-the-maintainer)

---

## 1. Route every config write through `track()` — fixes D4

**D4 reproduces, and it is wider than the research said.**

Verified in this checkout:

- `track()` is defined at `server/index.mjs:1724-1731`. It reads the previous content, writes the new
  content, and appends `{id, ts, author, machine, scope, file, summary, approvedBy, prev, content}` to
  `~/.claude/dashboard-versions.jsonl` (`server/index.mjs:1719`). That append is the *only* thing that
  populates Governance → Versions and Governance → Audit log (`/api/gov/versions`, `server/index.mjs:1735`).
- `PUT /api/hooks` (`server/index.mjs:339-350`) reads the settings file, mutates `settings.hooks`, calls
  `backup(file)` (`server/index.mjs:131`), then `fs.writeFileSync` at `:348`. **It never calls `track()`.**
- The same defect exists in three more places the research did not name:
  - `PUT /api/settings` — `server/index.mjs:351-359`, `fs.writeFileSync` at `:357`, no `track()`.
  - `POST /api/customize/toggle` for `kind === 'plugins'` — `server/index.mjs:468-476`, write at `:474`.
  - `POST /api/customize/toggle` for `kind === 'hooks'` — `server/index.mjs:477-491`, write at `:489`.
    (The `mcp` branch at `:459-467` writes `~/.claude.json`, also untracked — same class, see DoD.)

**The honesty violation is literal, and there are two of them.**

- Governance → Audit log renders, when the log is empty:
  `empty — every dashboard config write lands here` (`src/sections/GovernanceSection.jsx:177`).
  Versions renders `no tracked changes yet — edits made through the dashboard appear here`
  (`GovernanceSection.jsx:80`). Both are false while `PUT /api/hooks` exists: the Hooks editor Save button
  (`src/sections/HooksSection.jsx:63`) is a dashboard config write that does not land there.
- Governance → Approvals renders
  `global config edits take effect only after review · project edits apply directly but are logged`
  (`GovernanceSection.jsx:116`). This is also false. `SETTINGS_FILES.user` (`server/index.mjs:329`) is
  `~/.claude/settings.json` — the *same path* `settingsFileFor('global')` returns (`server/index.mjs:1335`).
  So `PUT /api/hooks {scope:'user'}` edits global config directly, with no proposal, while
  `POST /api/hooks/install {scope:'global'}` correctly routes through `propose()`
  (`server/index.mjs:1760`, called at `:3704`). Two doors into the same file, one guarded, one not.

**Customer need.** The person who edited a hook by hand in the Hooks tab, then a week later opens
Governance → Versions to find out what changed and when, and to roll it back. They get nothing. Today they
work around it by digging through `~/.claude/dashboard-backups` (`server/index.mjs:48`) — timestamped file
copies with no summary, no author, no diff pairing, and no rollback button. The rollback endpoint
(`POST /api/gov/rollback`, `server/index.mjs:1749`) can only roll back things `track()` recorded, so
hand-edited hooks are the one category of change that is *not* reversible from the UI.

**Value to Loush.** This is a correctness fix on a promise we print on screen, and `_SYNTHESIS.md` §8 Tier 0
says corrections ship before feature work. It is also load-bearing for features 2 and 3: the checklist state
store (see [The checklist component](#the-checklist-component)) is written through `track()`, and if `track()`
is not the universal write path, checklist attestations inherit the same hole.

**How the upstream repo does it today.** It does not. `dlowenth/claude-code-build-framework` has no code and
no state at all (`sdlc-build-frameworks.md` §A: "There is no code", 6 tracked markdown files). Its
`security-framework.md` §6 *specifies* an immutable audit log — a `security_audit_log` table with
append-only RLS (INSERT and SELECT policies only, UPDATE/DELETE denied by absence) plus an 8-row
what-to-log table. We already have the append-only file version of that, working, at
`server/index.mjs:1722`. We are ahead of them on this; we just have four routes that skip it.

**How we implement it here.**

1. In `PUT /api/hooks` (`server/index.mjs:339-350`), replace the `backup()` + `fs.writeFileSync` pair with
   `track(file, JSON.stringify(settings, null, 2), { scope, summary })`. `track()` already does
   `mkdirSync` + `writeFileSync`, so lines `:347-348` are deleted, not adapted. Keep `backup()` — it is a
   separate safety net and the response still returns `{backup}`, which the UI flashes at
   `HooksSection.jsx:63`.
2. Scope translation. `/api/hooks` speaks `user|project|local` (`server/index.mjs:328-332`); Governance
   speaks `global|<absolute project dir>` — the Audit row renders
   `v.scope === 'global' ? 'global' : v.scope.split('/').pop()` (`GovernanceSection.jsx:172`) and the
   Versions scope filter is populated from `/api/harness` scopes (`GovernanceSection.jsx:26`, server side
   `server/index.mjs:1433-1437`). Add one mapper next to `SETTINGS_FILES`:
   `user → 'global'`, `project|local → PROJECT`. Without it these entries render with a scope label the
   filter cannot select, which is a new small dishonesty.
3. Close the second door. `PUT /api/hooks` with `scope === 'user'` must take the same branch
   `POST /api/hooks/install` takes at `server/index.mjs:3704`: call `propose(file, content, summary)` and
   return `{ok:true, proposed:<id>}`. `HooksSection.jsx` `save()` (`:60-64`) then needs the same message
   the Library install path already shows —
   `'global change proposed — approve it in Governance → Approvals'` (`HooksSection.jsx:226`). If we decide
   direct global hook edits should stay direct, then `GovernanceSection.jsx:116` has to be reworded instead.
   **Pick one; do not ship both texts.** (See open question O1.)
4. Same treatment for `PUT /api/settings` (`:351-359`) and both `POST /api/customize/toggle` write branches
   (`:474`, `:489`). The `mcp` branch (`:465`) writes `~/.claude.json`, which is not a settings file but is
   still user config the dashboard mutates — track it with `scope:'global'` and summary
   `enable/disable MCP server <name>`.

Effort is small because the sink already exists: `track()` is called from 6 places today including
`writeBoard` (`server/index.mjs:4088`) and `PUT /api/hub/file` (`:1714`).

**Effort.** S. Four call sites, one scope mapper, one UI string, three tests.

**Risks and unknowns.**
- `track()` stores full `prev` and `content` per entry. `~/.claude/settings.json` is small, so growth is
  negligible; but `POST /api/customize/toggle` can be clicked rapidly from the Customize grid, and each
  click will now append a full settings snapshot. Mitigation: none needed at our scale — but note
  `/api/gov/versions` already caps its response at the last 300 entries (`server/index.mjs:1742`), so a
  chatty writer can push older config history off the *displayed* list while it remains in the file. Worth
  a follow-up, not a blocker.
- Routing `scope:'user'` through `propose()` changes the meaning of the Save button. That is a behaviour
  change, not a bug fix, and needs the maintainer's call (O1).
- `backup()` at `server/index.mjs:131` and `track()` now both fire per write. Confirm `backup()` does not
  throw on a first-ever write of a missing file before assuming the order is safe.

**Definition of done.**
- Editing hooks in any scope from the Hooks tab produces a new row in Governance → Versions within one
  refresh, with a non-empty `summary`, the correct `scope` label, and a working `undo` button.
- Governance → Audit log contains that row and it survives an export (`GovernanceSection.jsx:162-165`).
- `POST /api/gov/rollback` with `{to:'prev'}` on that row restores the previous `hooks` block byte-for-byte.
- Null/empty state: with a genuinely empty `dashboard-versions.jsonl`, both empty-state strings
  (`GovernanceSection.jsx:80` and `:177`) are now *true statements*. Add a test asserting that after
  `PUT /api/hooks`, `PUT /api/settings`, and each `POST /api/customize/toggle` branch, `readVersions()`
  length increased by exactly 1 — the test is the honesty guarantee, not the string.
- A test in `test/server/` (house pattern: `test/server/setup-config.test.mjs`) enumerates every
  `fs.writeFileSync` target under `~/.claude` reachable from an Express route and asserts it is either in a
  known-untracked allowlist (backups, eval-run logs, caches) or goes through `track()`. This is what stops
  D4 recurring; the four fixes alone do not.

---

## 2. The freeze audit as checklist data

**Customer need.** Someone about to ship. They want to know whether they are done, and today they have
nothing in this app to tell them. The dashboard has **no checklist or scorecard component anywhere** —
verified: the closest thing is `s.outputChecklist` in `src/company/AtomsSection.jsx:138-146`, which renders
a `DataTable` with a hardcoded `☐` glyph (`:141`) that is not clickable, holds no state, is sourced from
`.wakeel/constitution` repo JSON, and is behind the `Company_Tools` flag (`lib/eng-config.mjs:185-189`,
gate at `src/App.jsx:224`). So the current workaround is a checklist in Notion, or nothing.

**Value to Loush.** `_SYNTHESIS.md` §7 Cluster D calls this "the cheapest high-value port in the batch",
and §8 Tier 1.4 sizes it S. It is pure data: the 75 items are extracted verbatim in
`sdlc-build-frameworks.md` §A ("The 75-item production-readiness freeze audit"), already numbered 1–75,
already categorised. Rendering it is nearly free and it is the substrate features 3 and 4 stand on. It also
gives us our first reusable checklist primitive, which we will need again for the 44-item plugin checklist,
the 81 tier items, and repo B's acceptance criteria.

**How the upstream repo does it today.** One flat ungrouped markdown list of `- [ ]` bullets at
`claude.md:2293-2372`, closing with a required literal verdict token — `READY TO FREEZE` or
`READ-ONLY PLAN` (`claude.md:2376-2379`). Nothing validates it; a human reads it and self-attests. The
research is blunt that this is the gap: "it is markdown, not software … *This is precisely the gap we fill*"
(`sdlc-build-frameworks.md` §A Gaps #1). It also has no stable IDs, so items cannot be referenced or diffed
(Gaps #4), and the count is hand-maintained across versions (Gaps #8).

**How we implement it here.**

1. New file `src/data/checklists/freeze-audit.js` — this creates the `src/data/` convention; we have none
   today (verified: no `src/data` directory). Header carries the MIT notice and
   `Copyright (c) 2026 Doug Lowenthal` per `_SYNTHESIS.md` §5 and §9.
   Each item:
   ```js
   { id: 'FA-017', n: 17, category: 'Architecture',
     text: 'No page file exceeds ~200 lines — decomposed into components (per Section 17.2)',
     appliesTo: ['react'],        // generic | react | node | web | supabase | claude-code
     minTier: 0,                  // filled in by feature 4
     check: 'page-file-size' }    // null when nothing is mechanical; see feature 3
   ```
   `n` preserves source order; `id` is stable and is what state is keyed by. `appliesTo` is what lets us
   hide the ~20 Supabase/Discord/Railway items the research identifies (#5–#12, #54–#56, #59) without
   deleting them.
2. New shared component `src/ui/Checklist.jsx` — see [The checklist component](#the-checklist-component)
   for the full spec. It lives in `src/ui/` beside `tabs.jsx`, `charts.jsx`, `Skeleton.jsx`, for the reason
   stated in the header of `src/ui/tabs.jsx:1-3`: shared primitives must not live inside a routable section.
3. New server module `server/checklists.mjs`, mounted from `server/index.mjs` the way
   `mountPromptCheck` (`server/promptcheck.mjs:120`) and `mountConstitution` (`server/constitution.mjs:149`)
   are. Endpoints: `GET /api/checklists/:id?project=` returns items + state + (feature 3) auto results;
   `POST /api/checklists/:id/item` sets one item's human state.
4. New Governance tab. `src/sections/GovernanceSection.jsx:14` is a literal array —
   `['Versions','Approvals','Audit log','Drift','Batch ops']`. Add `'Freeze audit'` and one line
   `{tab === 'Freeze audit' && <FreezeAudit />}` beside `:15-19`. The component itself goes in the same
   file, which is the house style there (`Versions`, `Approvals`, `Audit`, `BatchOps`, `Drift` are all
   local).
5. Verdict token, ported literally: the tab header renders `READY TO FREEZE` or `READ-ONLY PLAN` with the
   arithmetic beside it. Rules in [The checklist component](#the-checklist-component).

No new dependencies. The only external state is one JSON file (below).

**Effort.** S. Data entry plus one component. The 75 rows are already in
`sdlc-build-frameworks.md` §A in table form and transcribe mechanically; `appliesTo` and `check` are the only
judgement calls, and the research already names which ~20 are stack-specific.

**Risks and unknowns.**
- Transcription fidelity. The items must be copied verbatim; paraphrasing them makes our list a different
  artifact and breaks the MIT attribution story. Guard with a test that asserts item count === 75 and that
  every `id` is unique and sequential — the research notes upstream's own count is doc-drift-prone
  (Gaps #8), and ours should not be.
- ~20 items are meaningless outside Supabase/Discord/Railway. If we render them by default the list reads
  as someone else's tool — the exact failure mode `src/App.jsx:206-208` records us having already made once
  with the company sections. Default `appliesTo` filter must exclude non-matching stacks, with the count of
  hidden items visible.
- Item text references upstream sections ("per Section 17.2") that do not exist for our users. Keep them —
  altering the text breaks verbatim — but render them in tertiary colour with a footnote saying which
  document they point into.

**Definition of done.**
- Governance → Freeze audit renders 75 items grouped by category, with per-item state persisted across a
  server restart.
- Stack filter hides the Supabase/Discord/Railway items by default and shows `N hidden (stack filter)`.
- The verdict token renders, and its arithmetic is visible next to it — never a bare percentage
  (`_SYNTHESIS.md` §6: "never render a percentage without its denominator visible").
- Null/empty state: on a project with no state file and no auto-check run, the tab shows
  `75 items · 0 attested · 75 unchecked` and the verdict `READ-ONLY PLAN — 75 items not yet reviewed`. It
  must **not** show `0%` complete or a red bar; unchecked is unknown, not failure. That is the same rule
  `src/sections/QualitySection.jsx:135-141` already applies to design drift ("cannot detect drift yet …
  an empty drift list is not an all-clear").
- A test asserts the data file has exactly 75 items with unique ids and that no item text was modified from
  the research extract (checksum the concatenated text).

---

## 3. Auto-check audit items against a real `.claude/` and checkout

**This is the differentiator.** `_SYNTHESIS.md` §7 Cluster D: "The differentiating move is not rendering
the 75 items — it is auto-checking a subset against a real `.claude/` directory. The landscape scan found
config-linting-that-checks-behaviour has **zero** entries across 690 projects." §8 Tier 2.1 sizes it M.

**Customer need.** Same person as feature 2, one step later. They have a 75-item list and no appetite to
verify 75 things by hand, so they tick them optimistically or abandon the list. What they actually want is
for the machine to do the boring 51 and hand them the 24 that need a human. Today they do this by grepping
their own repo ad hoc, or not at all.

**Value to Loush.** It converts a copied artifact into ours. It is also the natural extension of what this
app already is: `server/fe.mjs:9-11` states the app's one distinguishing property — "It is the only thing in
the app that answers a question about YOUR CODE rather than about your harness". The freeze audit auto-check
is the second thing. And several checks are not new code at all — see reuse below.

**How the upstream repo does it today.** It does not, and it says so implicitly: `security-framework.md`
has "no verification story for the security tier. Nothing checks that a Tier 2 project actually has a
`credential_registry` table" (`sdlc-build-frameworks.md` §A Gaps #9). The closest upstream thing is
`post_tool_use.py` (`claude.md:1879-1949`), which does three warn-only checks after the fact: a >200-line
file warning scoped to paths containing `/pages/`, a shell-out to `npm audit --audit-level=high --json`
with a 30s timeout, and a lockfile-presence check. Those are three of ours, done reactively per tool call
instead of on demand across the repo.

**How we implement it here.**

`server/checklists.mjs` gains a check registry: `CHECKS = { [checkId]: (ctx) => Result }` where
`ctx = { project, claudeDir, settings, gitignore, pkg, git }` and
`Result = { state: 'pass'|'fail'|'unknown'|'n/a', evidence: string, reason?: string }`.
`reason` is required whenever `state === 'unknown'` — that is what makes unknown honest rather than lazy.

Each check is a pure function over already-read context so it is unit-testable without a repo, matching the
`export function isIgnored(gitignoreText, basename)` shape at `server/setup.mjs:113` (pure, takes the text,
tested).

Directly reusable, already in the codebase — this is why the effort is M and not L:

| Need | Already exists |
|---|---|
| Read `.claude/{skills,commands,agents}` per scope | `KINDS[...].dirs()` — `server/index.mjs:151-161` |
| Read settings across user/project/local | `SETTINGS_FILES` — `server/index.mjs:328-332` |
| `.gitignore` membership | `isIgnored()` — `server/setup.mjs:113-119` |
| Run git in a project | `gitB(project, args)` — `server/index.mjs:4128` |
| Secret regexes | `secret-scan-pre-write` command — `server/index.mjs:3672-3673` (`AKIA[0-9A-Z]{16}`, `-----BEGIN … PRIVATE KEY`, `password\s*=\s*['"]…`) |
| Analytics event inventory (audit #44) | `GET /api/analytics/registry` — consumed at `src/sections/QualitySection.jsx:41`; scans source for `.track` / `.capture` / `logEvent` / `trackEvent` / `recordEvent` (`QualitySection.jsx:88`) |
| Enabled plugin list (audit #37) | `customizePlugins()` — `server/index.mjs:420-425` |
| MCP server list (audit #51) | `customizeMcp()` — `server/index.mjs:412-418` |
| Source-file walk with import graph | `server/fe.mjs` (`SOURCE_EXTS`, `:40`) |
| CI workflow path resolution (audit #71) | `ciWorkflowPath()` — `server/index.mjs:3710` |

New endpoint `GET /api/checklists/freeze-audit/auto?project=<dir>` runs every registered check and returns
`{ [itemId]: Result }`. It is recomputed on every request — no persisted auto state, per the
"recompute from files every read" rule in `server/fe.mjs:18-19`. Cache with the `(mtime,size)` pattern only
if it measures slow; `npm audit` (item #60) is the only network-touching check and must be opt-in behind an
explicit button, returning `unknown` with `reason: 'not run — needs network'` otherwise.

The UI change is small: `Checklist.jsx` already renders an auto column; this feature fills it.

**Effort.** M. Roughly 48 check functions across the whole set; each is 5–20 lines, and the first wave is
11 of them. Ship in three waves:
(a) **`.claude/` + git only — items 19, 20, 21, 22, 23, 37, 38, 44, 45, 47, 57.** No stack knowledge, no
build, no network, no database. Proves the loop end to end and is the differentiating set on its own.
(b) **Repo structure — 17, 46, 48–53, 59, 61, 63, 71, 72, 74, 75.** Needs a stack guess and file
conventions.
(c) **Heuristic partials and the slow checks — 60 (`npm audit`), 62 (`node_modules`), 64 (`npm pack`), 2, 7,
10–16, 27, 33, 35, 36, 42, 43, 56, 58, 68, 73.** The ten Low-confidence ones listed in the rollup ship
wired to `unknown` until they earn a verdict.

**Risks and unknowns.**
- **Precision over recall, always.** A check that fails on a correct repo will get the whole feature turned
  off. Every heuristic check must be tuned so false *passes* are acceptable and false *failures* are near
  zero; where that is not achievable, the check returns `unknown` with the reason, not `fail`.
- Windows. `_SYNTHESIS.md` §9 records CAST hardcoding `'/'` and checking the POSIX executable bit, and
  says: use `path.sep`, "report `executable: null` rather than faking a pass". Every path check here must
  use `path.sep`/`path.join`; `git check-ignore` behaviour differs, so prefer our own `isIgnored()`.
- `npm audit` (item #60) needs network and can be slow or rate-limited. Never let it block the page; never
  render a stale or failed audit as pass.
- Items #62 (post-install scripts) and #63 (build artifact) need `node_modules/` and `dist/` respectively.
  Absent → `unknown` with reason, never `pass`.
- Item #66 has two possible subjects — the project's runtime LLM calls, and the model tier used in our own
  Claude Code sessions for this project. The second is checkable from data we already aggregate
  (`/api/gov/costs` `byModel`, rendered at `src/sections/ReliabilitySection.jsx:359-364`) but it answers a
  different question than the item asks. See open question O4.
- Conflict semantics. When a human ticked an item and the machine then fails it, we must not silently
  overwrite either. Rendering rule is in [The checklist component](#the-checklist-component).

**Definition of done.**
- Wave (a) is done when, on a project that has a `.claude/` directory, the Freeze audit tab shows a machine
  verdict beside **11** items with no human action. The feature as a whole is done at **24**. Every verdict
  carries an evidence string naming the exact file or command that produced it (e.g.
  `.claude/settings.local.json not matched by any .gitignore line`).
- Every `unknown` result renders as `—` in tertiary colour with its reason on hover, is excluded from the
  pass denominator, and is counted separately in the header.
- On a project with **no** `.claude/` directory at all, every `.claude/`-dependent check returns `unknown`
  with `reason: 'no .claude/ directory in this project'` and the header reads
  `0 auto-passed / 0 auto-failed / 11 unknown / 64 manual`. It must **not** report 11 failures. A project
  that was never audited is not a failing project — this is the same distinction
  `src/sections/QualitySection.jsx:133-141` already draws for a code-generated design baseline.
- Unit tests: each check function is called with a synthetic `ctx` covering pass / fail / unknown, using
  fixtures under `test/fixtures/` (the directory exists).
- A pass over an intentionally-perfect fixture repo yields zero `fail` results. A pass over an
  intentionally-broken one yields the expected set. Both committed.

---

## 4. Security tier 0–3 classifier with auto-escalation

**Customer need.** The person deciding how much security process this project deserves. Today they either
apply everything (and stop) or nothing. Nothing in our app classifies a project by sensitivity —
`sdlc-build-frameworks.md` Overlap table: our equivalent is **NONE**.

**Value to Loush.** It makes the 75-item list adaptive rather than one-size-fits-all, and it adds 81 more
items of pure data at near-zero cost. It is also a new axis for us entirely: per-project risk classification.

**How the upstream repo does it today.** `security-framework.md`, 605 lines, four tiers with additive
inheritance (`:14-19` for the tier table, `:21-25` for inheritance). Auto-escalation rules at `:34-47` are,
per the research, "the best part, and it is pure data": eight data triggers force Tier 2+ (financial
credentials, bank data, brokerage connections, health records, legal docs with client PII, SSN/government
IDs, credentials for other systems, data whose exposure causes measurable financial or legal harm); *any*
external system via MCP server, plugin, or API forces Tier 1+; a connected system holding PII forces Tier 2+
**regardless of whether the project itself stores that data**; ability to move money forces Tier 3.
Per-control item counts, counted programmatically by the researcher: §3 Network Allowlist 3 · §4 Credentials
10 · §5 Action Tiers 4 · §6 Audit Logging 4 · §7 Supply Chain 4 · §8 Session 4 · §9 AI Agent Security 6 ·
§10 Canary 2 · §12 Plugin/Skill 44 — 81 total.

**How we implement it here.**

1. `src/data/checklists/security-tiers.js` — tier definitions, the inheritance map, the auto-escalation
   trigger lists, and the 81 items with ids `ST-001`…`ST-081`, each carrying `minTier` and `control`
   (the framework section it came from).
2. Backfill `minTier` onto the 75 freeze-audit items. Per the research, the 75 base items *are* Tier 0 —
   so all 75 get `minTier: 0` and the 81 layer on top. No re-judgement needed.
3. A tier picker rendered above the checklist: four radio options plus the auto-escalation questions as
   checkboxes. Answering any escalation question raises `effectiveTier` and **locks** the radio at or above
   that value with the triggering answer named inline — the escalation is the point; letting someone
   un-escalate by clicking a radio destroys it.
4. Two things we can auto-answer rather than ask: "connects to any external system via MCP server or
   plugin" is directly readable from `customizeMcp()` (`server/index.mjs:412-418`) and `customizePlugins()`
   (`:420-425`) plus the project's `.mcp.json`. If either is non-empty, the Tier 1+ trigger is
   pre-answered and shown as *derived*, with the server names listed as evidence. That is a small, real
   instance of the same auto-check thesis as feature 3.
5. `src/ui/Checklist.jsx` takes `tier` and renders items above the effective tier in a collapsed
   `not required at Tier N (21 items)` group — see [The checklist component](#the-checklist-component) for
   why they collapse rather than vanish.

**Effort.** S for the data if we take only the tier table + escalation rules + the 5 small control blocks
(§3, §5, §6, §7, §8, §10 = 21 items). M once the 44-item §12 plugin/skill checklist is included, which is
the bulk of the 81 and is mostly manual attestation. Recommend shipping the 21 first and the 44 with
feature 7.

**Risks and unknowns.**
- The research reproduced §12's structure and counts but not all 44 item texts verbatim
  (`sdlc-build-frameworks.md` gives the sub-checklist breakdown: Component Inventory 4, Source Verification
  4, Permissions Audit 5, Data Flow Mapping 3, Credential Handling 4, Auditability 4, Compliance
  Verification 3, §12.3 six scan patterns, plus 11 rollup items). **We do not have those 44 texts in hand.**
  Getting them means going back to the source repo. Marked **unverified** — do not scaffold 44 empty rows.
- Tier controls are prose specs, not tests. We can render them and track attestation; we cannot verify most
  of them (upstream can't either — their Gaps #9). Do not imply otherwise in the UI.
- Escalation locking is a UX opinion. Someone will want to override. Provide an explicit "override with
  reason" that records the reason in the state file — never a silent downgrade.

**Definition of done.**
- Picking Tier 2 makes 21+ additional items appear, grouped by control, each labelled with its source
  section.
- Answering an escalation trigger raises the tier, names the trigger inline, and cannot be undone by
  clicking a lower radio.
- The MCP/plugin trigger is pre-answered from real config and lists the server names it found.
- Null/empty state: with no tier chosen, the tier panel reads `no security tier declared` and the checklist
  shows only the 75 base items with a note that tier-conditional items are hidden until a tier is declared.
  It must not default to Tier 0 silently — an undeclared tier is unknown, and rendering unknown as
  "Minimal" would be the highest-consequence honesty violation in this whole spec.

---

## 5. Three new `HOOK_LIBRARY` entries, including our first `PreCompact`

**Customer need.** Someone who wants the agent stopped from doing a specific bad thing and does not want to
write a hook script. `HOOK_LIBRARY` (`server/index.mjs:3669-3682`) has exactly 5 entries today —
`block-prod-file-edit`, `secret-scan-pre-write`, `require-tests-before-stop`, `log-tool-usage`,
`truncate-tool-result` — covering three events (PreToolUse, Stop, PostToolUse). **Zero `PreCompact`
entries**, despite `PreCompact` being in our picker (`src/sections/HooksSection.jsx:11`).

**Value to Loush.** Library goes 5 → 8 and covers a new event. Zero new architecture: the install path
(`POST /api/hooks/install`, `server/index.mjs:3693-3707`) already does pattern resolution, dedupe by exact
command string (`:3701`), scope routing, and `propose()`/`track()`.

**How the upstream repo does it today.** Four Python scripts embedded as fenced blocks inside `claude.md` —
there is no `hooks/` directory in the repo (`sdlc-build-frameworks.md` §A hooks section). `pre_tool_use.py`
(`claude.md:1816-1877`) has three rules:

1. `rm -rf /` blocking — two literal substring comparisons (`"rm -rf /" in command` or `"rm -rf /*"`).
2. Supply-chain warning on installs of packages absent from `approved-packages.json` — warn only, does not
   block.
3. Block `Write`/`Edit` where `file_path.endswith("CLAUDE.md")` or `("prd.md")` — message
   `Blocked: <file> is a governing document. Propose changes to project owner per Section 22.5.`

The research's honest read, which I am adopting: **rule 1 is near-cosmetic** — it misses `rm -rf ~`,
`rm -rf .`, `rm -fr /`, double-space, and every variable-indirection form; our own
`git-guardrails-claude-code` skill is strictly better. **Rule 3 is the genuinely novel idea**: treat the
governing documents as immutable to the agent. `pre_compact.py` (`claude.md:1980-2009`) always injects a
reminder that phase gates are in effect and the agent must stop for approval after the current phase, and
adds a second reminder to re-read `STATE.md`/`CONTEXT.md` when `STATE.md` exists.

**How we implement it here.** Three entries appended to `HOOK_LIBRARY`, written in Node (matching all five
existing entries — no Python dependency introduced):

1. `protect-governing-docs` — PreToolUse, matcher `Edit|Write`. Blocks writes whose `file_path` basename is
   in a parameterised list, default `['CLAUDE.md','AGENTS.md','prd.md']`. Exit 2 with a message naming the
   file. Parameterised via the existing `params` mechanism (`resolvePattern`, `server/index.mjs:3685-3692`)
   — that mechanism currently serves only `truncate-tool-result`, so this is its second consumer and a
   good test of it. Note the interaction with the app's own `RULE_TARGETS()` (`server/index.mjs:395-401`),
   which lists the same governing files: installing this hook makes those files agent-immutable while
   remaining human-editable and dashboard-editable via `PUT /api/hub/file` (`:1707`, which is tracked).
2. `phase-gate-precompact` — PreCompact, matcher `''`. Emits `additionalContext` re-stating the phase-gate
   rule, and, if `STATE.md` exists in cwd, a second line telling the agent to re-read `STATE.md` and
   `CONTEXT.md` after compaction. Our first `PreCompact` entry.
3. `supply-chain-install-warn` — PreToolUse, matcher `Bash`. Parses the command for
   `npm install|npm i|pnpm add|bun add <pkg>`, strips the version range, and warns (exit 0, stderr) when the
   package is not in `approved-packages.json`. Warn-only, exactly as upstream — turning it into a block
   would make it the most annoying thing in the library.

**Do not port `rm -rf` rule 1** — see [Not worth taking](#not-worth-taking).

**Effort.** S. Three data entries in an existing array plus one `resolvePattern` branch.

**Risks and unknowns.**
- Hook commands in `HOOK_LIBRARY` are single-line `node -e "…"` strings with heavy escaping (see
  `:3671`, `:3673`). Three levels of quoting, and the dry-run runner spawns `sh -c`
  (`server/index.mjs:3644`) — on Windows that requires a `sh` on PATH. Test each new entry through
  `POST /api/hooks/dryrun` on Windows before shipping.
- `PreCompact` payload shape is not something we have exercised. Our dry-run harness synthesises
  `{hook_event_name, tool_name, tool_input, cwd, session_id}` (`server/index.mjs:3643`) which is a
  PreToolUse-shaped payload; a PreCompact hook receives different fields. **Unverified** what those fields
  are — confirm against the official hooks reference before writing the handler, and extend the dry-run
  payload builder per event.
- Upstream's hook security rules (`claude.md:2011-2018`) set a **<500ms** budget. Our dry-run already
  returns `ms` (`server/index.mjs:3656`, rendered at `HooksSection.jsx:170`). Cheap win: assert the three new
  entries dry-run under 500ms and surface the threshold in the Health tab.

**Definition of done.**
- Library tab shows 8 patterns; installing `phase-gate-precompact` writes a `PreCompact` block into the
  chosen scope's settings and appears in the Hooks editor list.
- Each new pattern dry-runs successfully from the Dry-run tab on Windows and macOS, with a measured `ms`
  under 500.
- Installing any of the three into `global` produces a proposal in Governance → Approvals (existing
  behaviour, `server/index.mjs:3704`) and, once approved, a tracked version.
- Null/empty state: unchanged — Library renders from a static array, so it is never empty. But
  `phase-gate-precompact`'s own runtime behaviour must degrade honestly: with no `STATE.md` present it emits
  only the phase-gate line and says nothing about state files that do not exist.

---

## 6. Hook event picker: 9 → 30 events (verified)

**The research flagged this as needing verification. It was verified, and the finding changed.**

`EVENTS` at `src/sections/HooksSection.jsx:11` has 9 entries: `PreToolUse`, `PostToolUse`,
`UserPromptSubmit`, `Stop`, `SubagentStop`, `SessionStart`, `SessionEnd`, `PreCompact`, `Notification`.

The research reported upstream claiming 14 events (`claude.md:1754-1769`) and listed five we lack:
`PostToolUseFailure`, `PermissionRequest`, `SubagentStart`, `TeammateIdle`, `TaskCompleted` — flagged
**unverified**, with `TeammateIdle`/`TaskCompleted` described as Agent-Teams-gated.

Verification against Anthropic's official hooks reference (`https://code.claude.com/docs/en/hooks.md`,
fetched 2026-07-29) returns **30 documented event names**:

`SessionStart`, `Setup`, `UserPromptSubmit`, `UserPromptExpansion`, `PreToolUse`, `PermissionRequest`,
`PermissionDenied`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Notification`, `MessageDisplay`,
`SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `Stop`, `StopFailure`, `TeammateIdle`,
`InstructionsLoaded`, `ConfigChange`, `CwdChanged`, `FileChanged`, `WorktreeCreate`, `WorktreeRemove`,
`PreCompact`, `PostCompact`, `Elicitation`, `ElicitationResult`, `SessionEnd`.

All five events the research flagged are real and documented, including `TeammateIdle` and `TaskCompleted`.
Per the same fetch, **no hook event is gated behind an experimental flag** — the experimental caveat in the
docs attaches to *agent-type hooks* (a hook type, not an event). So upstream's `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`
env var in their `settings.json` block (`claude.md:1776-1808`) is not required to register `TeammateIdle`.

**We are missing 21 events, not 5.** Notably `PostCompact` (pairs with the `PreCompact` we already have),
`FileChanged` and `ConfigChange` (directly relevant to our Drift and Governance surfaces), and
`PermissionDenied` (relevant to `_SYNTHESIS.md` §8 Tier 2.3, the permission-prompt work).

**Customer need.** Someone adding a hook via the `+ add` button (`HooksSection.jsx:77-87`). It `prompt()`s
with the event list and *rejects anything not in `EVENTS`* (`:79`). So our picker does not merely omit 21
events — it actively blocks a user from adding a valid one. The workaround is to hand-edit the JSON in the
CodeMirror pane, which works, but the guided path lies about what is possible.

**Value to Loush.** S-effort correctness. Also unblocks feature 5's `PreCompact` sibling and future work on
`FileChanged`.

**How the upstream repo does it today.** A 14-row markdown table with an "enforcement use" column
(`claude.md:1754-1769`). Incomplete, as now established.

**How we implement it here.** Replace the array at `HooksSection.jsx:11` with the 30 documented names in
the docs' order. Group them in the `+ add` prompt (or replace `prompt()` with a `<select>` — the current
`prompt()` listing 30 names in one line is unusable). `EVENTS` is consumed in two places:
`:11` (add-hook validation, `:79`) and the Dry-run event `<select>` (`:159`); both improve automatically.

Also extend the dry-run payload builder (`server/index.mjs:3643`) so non-tool events do not receive a
`tool_name`/`tool_input` pair that their handlers will not find — see the risk in feature 5.

**Effort.** S for the array; S/M with a grouped picker and per-event dry-run payloads.

**Risks and unknowns.**
- Event availability may depend on the installed Claude Code version. A user on an older build who
  registers `PostToolBatch` gets a hook that silently never fires. Mitigation: show the events we have
  actually *observed firing* — `GET /api/hooks/health` already counts firings per event from transcripts
  (`server/index.mjs:3659-3665`, rendered `HooksSection.jsx:189-198`) — as a "seen in your transcripts"
  badge. That turns a docs list into a measurement, which is our whole thesis. It is also the honest way to
  present the other 21: documented, never observed here.
- The per-event payload shapes are **unverified** by me beyond the event names themselves. Do not write
  event-specific dry-run payloads from guesswork; fetch the schema per event first.

**Definition of done.**
- The Dry-run event selector lists all 30 documented events; `+ add` accepts any of them.
- Each event carries a badge: firing count from `/api/hooks/health`, or `not seen in your transcripts` —
  never `0`, because zero observed firings for a never-installed hook is not a measurement of anything.
- Null/empty state: with no transcripts at all, `/api/hooks/health` already returns
  `no hook firings found in transcripts` (`HooksSection.jsx:198`); the badges must show `—`, not `0`.

---

## 7. Skill and plugin content audit

**Customer need.** Someone who installed a plugin or a skill from the internet and has no way to know what
it tells the agent to do. We have no scanner. `_SYNTHESIS.md` §10 notes two surveyed projects ship READMEs
containing text written to be executed by a reading agent — this is a live problem, not a theoretical one.

**Value to Loush.** Perfectly aligned with local-first / zero-telemetry: we scan files on disk and nothing
leaves the machine. And per `_SYNTHESIS.md` §4, "every crowded category is a counter; every empty one is a
judgement" — this is a judgement.

**How the upstream repo does it today.** `security-framework.md` §12 (Tier 1+) is the largest checklist in
the repo at 44 items, distinguishing *capability inputs* (plugins — grant the ability to act) from
*knowledge inputs* (skills — shape reasoning), with a stated risk gradient across five component types:
skills (passive, no execution) → tools (moderate, AI-initiated) → hooks/scripts (highest, system-initiated
and silent) → commands (user-triggered but may install persistent hooks). §12.3 gives six scan patterns
over skill instruction text: content that exposes credentials · bypasses governance or security-tier
controls · transmits data to undeclared endpoints · suppresses logging or audit trails · grants broader tool
access than needed ("use any available tool") · conflicts with the declared security tier. It explicitly
states internally-authored skills are **not** exempt, because the AI cannot distinguish malice from careless
wording.

**How we implement it here.** New `GET /api/security/skill-audit` in `server/checklists.mjs` (or its own
module), scanning `~/.claude/skills/**/*.md` and `<project>/.claude/skills/**` — both roots already
enumerated by `KINDS.skills.dirs()` (`server/index.mjs:151`) — plus `.claude/commands`, `.claude/agents`,
and every `hooks` command string in all three settings scopes (the *highest*-risk component per their
gradient, and the one we can read most precisely because we already parse it at `customizeHooks()`,
`server/index.mjs:427-436`).

Six pattern families, one per §12.3 rule, each producing findings shaped
`{category, severity, summary, file, line}` — deliberately the same shape `Reviews()` already renders
(`src/sections/QualitySection.jsx:227-235`), so the UI is a new tab in `QualitySection.jsx:26` and almost
no new rendering code.

**Effort.** M.

**Risks and unknowns.**
- False positives are the whole risk. A skill legitimately *about* credentials will trip the credential
  pattern. Findings must be advisory, severity-graded, and dismissible — never a blocking gate.
- The 44 §12 checklist item texts are **not in our possession** (see feature 4 risks). Ship the six scan
  patterns first; they are fully specified in the research. The 44-item attestation checklist is a separate,
  later, data-entry job.
- We would be scanning skills including our own installed ones. That is correct per upstream's
  no-exemption rule, but expect noise from large skill libraries on first run.

**Definition of done.**
- The tab lists findings per file with the six categories, and a per-finding dismiss that persists.
- Null/empty state: with zero skills on disk, `no skills found to scan — checked ~/.claude/skills and
  <project>/.claude/skills`. With skills present and no findings, `12 skills scanned · no findings` —
  the count of what was scanned is mandatory, so "clean" is distinguishable from "did not look".

---

## 8. Structured acceptance criteria and the review-rubric gate

**Salvage only.** Repo B (`krzemienski/claude-code-builder`) **does not work end-to-end**. The research
verified: `agents/test_generator.py` is imported but does not exist so v1 cannot be imported at all;
`src/claude_code_builder_v2/__init__.py` is missing; the v2 `query()` call is wrong twice over; every agent's
`get_allowed_tools()` returns `[]` so Claude would have zero tools even on the happy path; 4 of 7 v2 phases
are dead branches; `tests/` contains only `__init__.py` and `make test` prints "passed" unconditionally
(`Makefile:48-53`); `.mcp.json` declares five fabricated npm package names; and the v3 documents present
fabricated telemetry as real results. Take two data structures and nothing else.

**Customer need.** (a) Someone using our Ticket section, who gets acceptance criteria as a markdown blob
they cannot tick, filter, or export per item. (b) Someone using Quality → Review loop, who gets a list of
findings with no verdict — no answer to "is this mergeable".

**Value to Loush.** (a) turns AC into checklist items, reusing the same component features 2–4 build.
(b) turns a findings list into a pass/fail gate, consistent with the Reliability CI gate
(`src/sections/ReliabilitySection.jsx:234`). Our findings are real, parsed from real reviews
(`QualitySection.jsx:227-235` renders `{category, summary, file, line, verdict, outcome}`); their rubric is a
definition with no data. The two are complementary, and the combination is better than either.

**How the upstream repo does it today.**
- `AcceptanceCriterion`, `src/claude_code_builder/core/models.py:330-360` —
  `{criterion_id ("FC001"), description, test_type, test_steps[TestStep{description, expected_result,
  validation_method, automated}], expected_result, validation_method, test_data_requirements[], priority,
  automated}`, bucketed by `AcceptanceCriteria` into functional / performance / security / integration.
  **Unused in their code** — no acceptance generator exists — but well-formed.
- Review rubric, `src/claude_code_builder/agents/review_agent.py` — an 8-point checklist (`:191-199`), a
  5-rule static-analysis table (`:245-282`: line >88 chars → warning, bare `except:` → warning,
  `TODO`/`FIXME` → warning, `eval(`/`exec(` → **error**, `pickle.loads` → warning), and a numeric gate
  (`:357-367`): `score>=80 and security_issues==0` → approved; `>=60 and <=2 security issues` →
  needs_revision; else rejected — with penalties `min(security*5, 30) + min(perf*3, 20)`.

**How we implement it here.**
- The rubric lands as data in `src/data/rubrics/code-review.js` and a computed score in `Reviews()`
  (`src/sections/QualitySection.jsx:166`) over findings we already parse. The rendering precedent is
  `DIMENSIONS` at `server/promptcheck.mjs:18-27` — **our only existing rubric structure**: an array of
  `[name, baselineScore]` pairs, seeded with the user's own self-scores, each dimension rendering as
  `{name, score, complexity, example:{quote, where}, optimize}` (`promptcheck.mjs:29-37`). Reuse that shape;
  do not invent a second rubric idiom.
- The 5 static-analysis rules are Python-specific. Take rule 4 (`eval(`/`exec(` → error) and the
  TODO/FIXME rule, both of which generalise; drop the line-length and `pickle` rules.
- `AcceptanceCriterion` lands in `src/sections/TicketSection.jsx`'s `CriteriaTab`, upgrading `META` from
  markdown-blob artifacts to structured items. **Verify the current `META` shape before starting** — the
  research cites `TicketSection.jsx:406` with two artifact kinds (`ac`, `tests`) stored as markdown, which
  I did not re-verify in this pass. Marked **unverified**.

**Effort.** S/M for the rubric gate. M for structured AC — it converts blob storage to item storage and
touches the generate / save / JIRA-comment paths.

**Risks and unknowns.**
- The numeric gate's thresholds (80/60) and penalty coefficients (5/3, capped 30/20) are unsourced numbers
  from a repo that has never run. `_SYNTHESIS.md` §6 is explicit: never repeat their numbers as validated.
  Ship the *structure* with our own thresholds, calibrated against our own historical findings, and show the
  arithmetic.
- Their `quality_score` starts at 100 and subtracts. Our findings have no severity on the transcript path
  (only the `runReviews` path has `f.severity`, `QualitySection.jsx:205`). So the gate is computable only
  for `review.json` runs, not for all parsed passes. Render the gate as `—` for passes where severity is
  absent; do not impute a severity.
- Structured AC is a data migration for anyone with existing markdown artifacts. Needs a read-both /
  write-new path, not a hard cutover.

**Definition of done.**
- Quality → Review loop shows a verdict chip per `review.json` run computed from the rubric, with the
  arithmetic expanded on click (findings counted, penalties applied, threshold shown).
- Runs lacking severity data render the verdict as `—` with `severity not recorded for this pass`, never as
  approved.
- Null/empty state: with zero review runs, the existing string
  `no review runs found — run /code-review or /security-review in a session and results land here`
  (`QualitySection.jsx:238`) stays, and no score is rendered at all — not `0`, not `100`.

---

## Auto-checkable audit items

All 75 items from `sdlc-build-frameworks.md` §A, in source order. "Mechanically checkable?" is
**Yes** (a machine can decide it outright), **Partial** (a machine produces a real signal that narrows the
work; a human closes it), or **No** (irreducibly human, or needs a live database / deployment we cannot
reach).

Confidence is confidence *in the check*, not in the item: how likely the inspection is to be right when it
says `pass` or `fail`. Anything below Medium should return `unknown` rather than `fail` in practice.

Item text is abbreviated for width; the canonical verbatim text lives in `src/data/checklists/freeze-audit.js`.

| Item # | Item text | Mechanically checkable? | What we would inspect | Confidence of the check |
|---|---|---|---|---|
| 1 | Architecture matches approved plan | No | Requires a plan artifact and human judgement | — |
| 2 | All PRD open questions resolved (PRD §17) | Partial | Locate `prd.md`; scan §17 for `[INFERRED]`, `[SUGGESTED]`, unresolved `- [ ]` markers; count them | Medium — detects presence, cannot judge resolution quality |
| 3 | Category-1 human setup confirmed; `.env` populated and verified against `.env.example` | Partial | The `.env` half is fully mechanical: parse keys from `.env.example` and `.env`, report missing/extra. Human confirmation is not | High for the `.env` half, No for the rest |
| 4 | Authorization boundaries enforced at data layer | No | Needs live DB and semantics | — |
| 5 | Table-level GRANTs on all public tables with RLS | No | Needs live Postgres | — |
| 6 | First-login RLS handles unlinked `auth_user_id` | No | Needs live DB | — |
| 7 | No RLS policies contain subqueries on `auth.users` | Partial | Text scan of `supabase/migrations/**/*.sql` for `CREATE POLICY` blocks containing `auth.users` | Medium — catches committed migrations only; misses dashboard-applied policies (which is item #55) |
| 8 | Edge Functions deployed with correct JWT verification flag | Partial | Grep deploy scripts / CI / `package.json` scripts for `--no-verify-jwt` and list which functions it is applied to | Low — deployment state is not on disk |
| 9 | Edge Functions deployed from committed, tagged code on main | Partial | `git status --porcelain` empty + current branch + `git describe --tags` present | Low — proves the repo state, not what was deployed |
| 10 | `getSession()` default; `getUser()` not in routine auth flows | Partial | Count `getUser(` call sites in client source, excluding server/admin dirs; list them for review | Medium |
| 11 | Two-effect auth init; no async inside `onAuthStateChange` | Partial | Find `onAuthStateChange(` call sites whose callback is `async` or whose body contains `await` | Medium — high precision, this is a syntactic property |
| 12 | `TOKEN_REFRESHED` does not trigger redundant DB lookups | Partial | Find `TOKEN_REFRESHED` handlers; flag if the handler body contains a query/fetch call | Low |
| 13 | React context provider values referentially stable (`useMemo`) | Partial | Find `<X.Provider value={{` and `value={[` object/array literals not wrapped in `useMemo`/`useCallback` | Medium-High — syntactic and well-defined |
| 14 | No `useCallback` dep arrays include context objects | Partial | Collect identifiers bound from `useContext(...)`, then flag any that appear in a `useCallback` dep array | Medium |
| 15 | No `useEffect` with API calls has unstable deps | Partial | `useEffect` bodies containing `fetch(`/`axios.`/`api.` whose dep array contains an object/array literal or a locally-constructed object | Low-Medium |
| 16 | No auth diagnostic logging prefixes in production code | Partial | Grep for `console.log`/`console.debug` whose first argument matches an auth-ish prefix (`[AUTH]`, `auth:`, `AUTH —`) | Medium — needs the project's prefix convention as config |
| 17 | No page file exceeds ~200 lines | **Yes** | Line-count every file under a configurable page glob (default `**/pages/**`, `**/app/**/page.*`, `**/routes/**`); fail listing each file over the threshold | **High** — fully deterministic; threshold configurable |
| 18 | No duplicated feature implementations across pages | Partial | Token-shingle near-duplicate detection across page files, reporting pairs over a similarity threshold | Low — reports candidates, not verdicts |
| 19 | Custom subagents in `.claude/agents/` for Full Build | **Yes** | `.claude/agents/*.md` present and non-empty; additionally report whether `security-reviewer`, `component-checker`, `test-coverage` exist. Reuses `KINDS.agents.dirs()` (`server/index.mjs:161`) | **High** |
| 20 | Hook enforcement scripts in `.claude/hooks/` with `pre_tool_use` guardrails active | **Yes** | `.claude/hooks/` exists and is non-empty **and** the resolved settings contain ≥1 `PreToolUse` entry whose command references a file in it | **High** — both halves are file facts |
| 21 | Hooks do not log sensitive data or make unauthorized network calls | Partial | Static scan of every hook command string (all three scopes, via `customizeHooks()`, `server/index.mjs:427-436`) plus every file under `.claude/hooks/`, for `process.env`, `printenv`, `env`, `curl`, `wget`, `fetch(`, `http.request`, `net.`, `requests.` | Medium-High for detection; cannot prove absence |
| 22 | `.claude/settings.json` committed with auto-mode permissions and hooks active | **Yes** | File exists; `git ls-files --error-unmatch` confirms tracked; `settings.hooks` non-empty; `settings.permissions.defaultMode` present | **High** |
| 23 | `.claude/settings.local.json` is in `.gitignore` | **Yes** | `isIgnored(gitignoreText, '.claude/settings.local.json')` — helper already exists and is already tested (`server/setup.mjs:113-119`). Note it is deliberately literal; also test the basename form | **High** |
| 24 | Tenant isolation proven | No | Needs live multi-tenant data | — |
| 25 | No recursive authorization logic | No | Needs semantics | — |
| 26 | No unused schema artifacts | Partial | Cross-reference table/type names in migrations against occurrences in source; report unreferenced | Low |
| 27 | No commented-out production code | Partial | Find runs of ≥3 consecutive comment lines whose stripped content parses as code-ish (`;`, `=>`, `function `, `return `, `const `) | Medium |
| 28 | No orphaned triggers or functions | No | Needs live DB | — |
| 29 | No duplicated business logic | Partial | Same shingle detection as #18, scoped outside page dirs | Low |
| 30 | Manual isolation tests passed | No | Human attestation by definition | — |
| 31 | Manual role boundary tests passed | No | Human attestation by definition | — |
| 32 | Role-based test cases in `tests/role-tests.md` and passing | Partial | File exists and contains ≥1 case-shaped heading or list item. "Passing" is not on disk | **High** for existence, No for passing |
| 33 | Playwright e2e passing for all routes and core journeys | Partial | `@playwright/test` in `package.json`; spec files present; parse the most recent `test-results/*.json` / `playwright-report/` for failures; compare discovered router paths against spec titles for coverage gaps | Medium — report freshness matters; a stale green report must read `unknown` |
| 34 | Self-audit loop completed — all PRD AC verified | Partial | Count AC items in `prd.md` §18; report how many are referenced by a test name or commit message | Low |
| 35 | `STATE.md` exists, all phases complete with approval dates | Partial | File exists; parse phase rows; fail if any row lacks a date or is not marked complete | Medium-High — depends on their table format being kept |
| 36 | `CONTEXT.md` exists with decisions for all UI phases | Partial | File exists and non-empty; cross-check its phase headings against `STATE.md`'s phase list | Medium |
| 37 | Plugins reviewed/installed before build; documented in `lessons-learned.md` | Partial | `customizePlugins()` (`server/index.mjs:420-425`) gives the enabled plugin names; check each appears in `lessons-learned.md` | Medium — genuinely mechanical, and a nice one |
| 38 | Selected framework installed and design phase completed | Partial | Detect framework markers on disk: `superpowers*` skills under `.claude/skills` or `~/.claude/skills`, `.planning/` (GSD), `bmad/` (BMAD). Report which, or none | Medium for install; No for "design phase completed" |
| 39 | Privileged actions logged | No | Needs runtime behaviour | — |
| 40 | No production data deleted during dev/test | No | Needs DB audit trail | — |
| 41 | Debug mode toggles correctly, no leak when off | No | Needs runtime behaviour | — |
| 42 | Error handling covers all network calls and async ops | Partial | Count `fetch(`/`axios.`/`await` call sites not inside a `try` block and without a `.catch(`; list them | Medium — real signal, noisy on some idioms |
| 43 | Error tracking configured for production | Partial | Dependency present (`@sentry/*`, `bugsnag`, `rollbar`) **and** an init call in source **and** its DSN key present in `.env.example` — all three | Medium-High |
| 44 | Feature adoption tracking events implemented for key features | Partial | **Already built.** `GET /api/analytics/registry?project=` scans source for `.track` / `.capture` / `logEvent` / `trackEvent` / `recordEvent` (`src/sections/QualitySection.jsx:41,88`) and returns events, call sites and taxonomy drift. "Key features" is the human part | **High** for presence of instrumentation |
| 45 | Env vars documented and no hardcoded secrets | **Yes** | Run the existing secret regexes (`server/index.mjs:3672-3673`: `AKIA[0-9A-Z]{16}`, `-----BEGIN [A-Z ]*PRIVATE KEY`, `password\s*=\s*['"][^'"]{6,}`) over all tracked source files | **High** for detection |
| 46 | `.env.example` exists, committed, documents all vars with grouping/descriptions/source instructions | Partial | Exists + `git ls-files` tracked = mechanical. Grouping/descriptions = every key preceded by a `#` comment line and ≥1 group-header comment | **High** for existence, Medium for documentation quality |
| 47 | `.env.example` in sync with actual env var usage | **Yes** | Extract `process.env.X`, `import.meta.env.X`, `Deno.env.get('X')`, `os.environ['X']` from source; diff both directions against `.env.example` keys. Report missing and stale | **High** — one of the strongest checks in the list |
| 48 | Setup guide in `docs/resources/` for every external service in the stack | Partial | Derive the service set from dependencies + `.env.example` key prefixes + `.mcp.json` servers; check `docs/resources/<service>-setup-guide.md` exists for each | Medium-High — depends on a naming convention we would have to state |
| 49 | No setup guide contains actual API keys, secrets, or credentials | **Yes** | Same secret regexes as #45, over `docs/resources/**` | **High** |
| 50 | All setup guides have all three categories completed | **Yes** | Each guide contains the three category headings and ≥1 list item under each | **High** — pure structure |
| 51 | All MCP/CLI connections scoped to the new project — no unscoped or production connections | Partial | Read `.mcp.json` and `customizeMcp()` (`server/index.mjs:412-418`); flag server args/env containing `prod`, `production`, or a path outside the project | Medium |
| 52 | All setup guides cross-reference related guides | **Yes** | Each guide under `docs/resources/` contains ≥1 relative markdown link to another file in that directory | **High** |
| 53 | `docs/resources/README.md` index exists with Category 1/2/3 checklists | **Yes** | File exists; contains the three headings; ≥1 `- [ ]` under each | **High** |
| 54 | Migration files match current schema state | No | Needs live DB | — |
| 55 | No schema drift — no direct dashboard modifications to prod RLS/functions/triggers | No | Needs live DB comparison | — |
| 56 | Database backup tier declared in PRD; PITR flagged | Partial | Grep `prd.md` for a backup/PITR declaration line | Medium — presence only |
| 57 | Git repository clean, with descriptive commit history | Partial | Clean: `gitB(project, ['status','--porcelain'])` (`server/index.mjs:4128`) empty — fully mechanical. Descriptive: share of subjects ≥ N chars and not matching `^(wip\|fix\|update\|stuff\|asdf\|.)$` | **High** for clean, Medium for descriptive |
| 58 | `lessons-learned.md` reviewed; fold-back items flagged | Partial | File exists, non-empty, and its mtime is at or after the most recent tag/release commit date | Medium |
| 59 | `.npmrc` with `force=true` exists in project root | **Yes** | Read `.npmrc`, look for `force=true` | **High** — trivial; tag `appliesTo: ['node','railway']` since it is a Windows→Railway workaround, not a general rule |
| 60 | `npm audit` shows no high or critical vulnerabilities | **Yes** (network) | `npm audit --json`, read `metadata.vulnerabilities.high` and `.critical` — same call upstream's `post_tool_use.py` makes | **High** when it runs; must return `unknown` (not `pass`) offline or on timeout |
| 61 | All dependency versions pinned in lockfiles; lockfiles committed | **Yes** | A lockfile exists (`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` / `bun.lockb`), `git ls-files` confirms tracked, and no `package.json` dependency range is `*` or `latest` | **High** |
| 62 | No dependencies with post-install scripts unless approved | Partial | Walk `node_modules/*/package.json` for `scripts.preinstall\|install\|postinstall`; diff against an approved list | Medium-High when `node_modules` is present; `unknown` otherwise |
| 63 | Build artifact contains no source maps, debug files, `.env` files, or credentials | **Yes** | Scan `dist/` / `build/` / `out/` for `*.map`, `.env*`, `*.pem`, `*.key`, `*.p12`; also check `package.json` `files` and `.npmignore` | **High** when a build dir exists; `unknown` otherwise |
| 64 | `npm pack --dry-run` reviewed; artifact size within baseline | Partial | `npm pack --dry-run --json`, compare `size`/`entryCount` to a stored baseline in the checklist state | Medium — needs a baseline we record on first run |
| 65 | Auto-remediation changelog is clean | No | Depends on an artifact convention we do not share | — |
| 66 | LLM calls use appropriate model tier per task | Partial | Two readings — see risk in feature 3. Repo-side: grep source for model id literals and flag `opus` in files whose names/contents suggest mechanical work. Harness-side: `/api/gov/costs` `byModel` already shows model mix per project (`src/sections/ReliabilitySection.jsx:359-364`) | Low repo-side, Medium harness-side |
| 67 | No LLM calls for tasks that should be deterministic scripts | No | Requires judging what should be deterministic | — |
| 68 | LLM API calls include rate limit handling (backoff + jitter) | Partial | In files importing an LLM SDK, look for `maxRetries`, `p-retry`, `backoff`, `retry`, or an explicit `429` branch | Medium |
| 69 | LLM cost logging in place for runtime API calls | Partial | At LLM call sites, look for reads of `usage.input_tokens` / `usage.output_tokens` / `total_cost_usd` or a logging call in the same function | Low-Medium |
| 70 | Bulk operations resumable with checkpoint/resume | No | Requires semantics | — |
| 71 | Nightly security audit configured | **Yes** | Scan `.github/workflows/*.yml` (path helper exists: `ciWorkflowPath()`, `server/index.mjs:3710`) and `.gitlab-ci.yml` for a `schedule:` cron whose job runs an audit / CodeQL / `npm audit` step | **High** |
| 72 | Crawl policy: `robots.txt`, meta robots, and `X-Robots-Tag` all noindex/nofollow | **Yes** | Three file facts: `public/robots.txt` contains a `Disallow: /`; the HTML head contains `<meta name="robots" content="noindex`; a response header is set in server middleware / `vercel.json` / `netlify.toml` / `_headers`. Report per-layer | **High** for layers 1–2, Medium for layer 3 (many places to set a header) |
| 73 | Debug-mode URLs excluded at all three layers and absent from sitemap | Partial | Given the debug route prefix as config: present in `robots.txt` `Disallow`, guarded by a noindex meta, and absent from `sitemap.xml` | Medium — needs the prefix declared |
| 74 | SEO structure: semantic HTML, meta tags, Open Graph, JSON-LD on public pages | Partial | Presence half is mechanical: `<meta name="description">`, `og:title`, `og:image`, `<script type="application/ld+json">`. Semantic-HTML half is a ratio heuristic (`<main>/<nav>/<header>/<section>/<article>` vs raw `<div>`) | **High** for the meta half, Low for semantics |
| 75 | SEO/structured data managed via a shared utility, not scattered | **Yes** | Count distinct files containing `og:` / `ld+json` / `document.title =`; more than one non-utility file → fail, listing them | Medium-High |

### Rollup

Each of the 75 rows carries exactly one label. The three sets are disjoint and sum to 75.

| Verdict | Count | Items |
|---|---|---|
| **Yes** — machine decides outright | **18** | 17, 19, 20, 22, 23, 45, 47, 49, 50, 52, 53, 59, 60, 61, 63, 71, 72, 75 |
| **Partial** — real machine signal, human closes | **40** | 2, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 21, 26, 27, 29, 32, 33, 34, 35, 36, 37, 38, 42, 43, 44, 46, 48, 51, 56, 57, 58, 62, 64, 66, 68, 69, 73, 74 |
| **No** — human attestation or live-DB only | **17** | 1, 4, 5, 6, 24, 25, 28, 30, 31, 39, 40, 41, 54, 55, 65, 67, 70 |

Two derived numbers matter for planning:

- **24 items can be decided outright** — the 18 `Yes` rows plus six `Partial` rows whose mechanical half is
  itself complete and shippable: **3** (`.env` vs `.env.example` key diff), **32** (file exists),
  **44** (instrumentation present, via the endpoint we already have), **46** (exists and git-tracked),
  **57** (working tree clean), **62** (post-install script scan). In each of those six the *remaining* half
  is genuinely human and stays a manual tick.
- **48 of the 58 checkable items are Medium confidence or better** and are worth building. The ten Low /
  Low-Medium ones — **8, 9, 12, 15, 18, 26, 29, 34, 69**, and the semantics half of **74** — should be
  written but wired to return `unknown` with their reason rather than a verdict, until we have evidence they
  do not produce false failures. Item **66** is Low on its repo-side reading and Medium on its harness-side
  reading; see open question O4.

**The first wave is 11 items that need nothing but `.claude/` and git**: 19, 20, 21, 22, 23, 37, 38, 44, 45,
47, 57. No stack knowledge, no build, no network, no database. That set alone is the
"config-linting-that-checks-behaviour" category `_SYNTHESIS.md` §7 Cluster D reports as having **zero**
entries across 690 catalogued projects.

The single strongest check in the list is **#47** — `.env.example` versus actual `process.env` usage, both
directions. It is fully deterministic, stack-agnostic across Node/Deno/Python, catches a real and common
bug, and nothing else in the ecosystem surfaces it in a dashboard.

---

## The checklist component

We have none. `src/company/AtomsSection.jsx:138-146` renders a `DataTable` with a decorative `☐` and no
state, behind the `Company_Tools` flag. This spec builds the real one, in `src/ui/Checklist.jsx`, beside the
other shared primitives — for the reason `src/ui/tabs.jsx:1-3` records: shared presentation must not live
inside a routable section.

### Data shape

Item definition (static, in `src/data/checklists/*.js`, never written at runtime):

```js
{
  id: 'FA-020',                 // stable, referencable, diffable — upstream has no IDs (their Gaps #4)
  n: 20,                        // source order, preserved for provenance
  category: 'Agent config',
  text: 'Hook enforcement scripts created in `.claude/hooks/` with pre_tool_use guardrails active …',
  appliesTo: ['claude-code'],   // generic | react | node | web | supabase | claude-code
  minTier: 0,                   // 0–3; feature 4
  check: 'hooks-dir-active',    // key into CHECKS, or null when nothing is mechanical
  source: { doc: 'claude.md', section: '21', line: 2312 },  // provenance, rendered as a footnote
}
```

Human state (persisted):

```js
{ state: 'checked' | 'not-applicable',   // only these two are ever stored
  at: 1753800000000, by: 'ali', note: 'covered by CI instead' }
```

Auto state (never persisted): `{ state: 'pass'|'fail'|'unknown'|'n/a', evidence, reason }`, recomputed on
every read.

### Storage — and the argument for the location

We have no database and should not acquire one for this. `_SYNTHESIS.md` §8 Tier 3.5 flags a durable store
as an L-effort decision that "makes us stateful, weigh it" — this feature must not be the thing that forces
it.

**Location: `~/.claude/dashboard-checklists.json`, written through `track()`.**

Three reasons, each with a precedent in this codebase:

1. **The precedent is exact.** `BOARD_FILE = ~/.claude/taskboard.json` (`server/index.mjs:4075`) is a
   JSON state file of user-authored records, and `writeBoard` is literally
   `track(BOARD_FILE, JSON.stringify(b, null, 2), { summary: 'update task board' })`
   (`server/index.mjs:4088`). Siblings: `harness-evals.json` (`:1942`), `harness-profiles.json` (`:2019`),
   `context-bundles.json` (`:3400`), `dashboard-meta.json` (`:556`), `fe-worksheet.json`
   (`server/fe.mjs:35`, described there as "inside the existing `~/.claude` jail"). This is a solved,
   consistent pattern.
2. **Going through `track()` gives us versioning, diff, rollback and the audit log for free** — and it is
   the same guarantee feature 1 restores. Checklist attestations are exactly the kind of record that should
   be immutable and attributable: `track()` already stamps `author`, `machine`, `ts`
   (`server/index.mjs:1729`).
3. **It is attestation, not source.** A tick means "I, on this machine, at this time, assert this". That is
   a property of the person and the moment, not of the repository. Putting it in the repo invites merge
   conflicts on a file whose conflicts are meaningless.

**The counter-argument, honestly:** a freeze audit is a team artifact, and a team wants it committed next to
the code it describes. Two answers: (a) `~/.claude/` is already where our shareable bundles live —
`LIBRARY_DIR = ~/.claude/harness-library` (`server/index.mjs:2044`) backs Governance → Drift's baseline
bundles (`GovernanceSection.jsx:267,271`), which are explicitly designed to be exported and compared across
machines; the same export path serves here. (b) Ship an explicit "export attestation to
`<project>/.claude/freeze-audit.json`" button in v2 rather than making the in-repo file the source of truth.
Flagging as open question O2 — it is a product call, not a technical one.

Shape:

```jsonc
{ "freeze-audit": {
    "/Users/ali/work/app": {
      "tier": 2, "tierLocked": true, "tierReasons": ["connects to external system via MCP"],
      "items": { "FA-020": { "state": "checked", "at": 1753800000000, "by": "ali" },
                 "FA-059": { "state": "not-applicable", "at": 1753800100000, "by": "ali",
                             "note": "not a Railway deploy" } } } } }
```

Keyed by checklist id, then absolute project dir — the same key `/api/harness` scopes use
(`server/index.mjs:1437`, `scopes.push({ id: dir, … })`), so the project picker at
`src/sections/QualitySection.jsx:10-20` drops straight in.

### Per-item state

Six visible states. Only two are stored; the rest are derived on every render.

| State | Stored? | Glyph | Colour | Counted in |
|---|---|---|---|---|
| `unchecked` | no (absence) | `☐` | tertiary | `unchecked` |
| `checked` | **yes** | `☑` | text-primary | `attested` |
| `not-applicable` | **yes** | `⊘` | tertiary | `n/a` — removed from every denominator |
| `auto-passed` | no | `✓` | green | `auto-passed` |
| `auto-failed` | no | `✗` | red | `auto-failed` |
| `auto-unknown` | no | `—` | tertiary + reason | `unknown` — **its own bucket, never merged into fail** |

Precedence and conflict:

- Auto state and human state are **rendered side by side in two columns**, never collapsed into one verdict.
  This is the whole point: the machine's opinion and the human's assertion are different facts.
- `not-applicable` suppresses the auto check entirely (the check does not run; the row shows `⊘` and the
  note). This is the only case where human state overrides.
- `checked` + `auto-failed` is a **conflict row**: amber left border, both glyphs, and the text
  `attested by ali on 2026-07-14 · machine disagrees: <evidence>`. We do not un-tick their box and we do not
  hide the failure. The verdict token treats a conflict as a failure. This case is the reason the two
  columns exist.
- `unchecked` + `auto-passed` counts as satisfied for the verdict, with the row labelled
  `auto` rather than a name — attribution stays honest about who asserted what.

### Tier-conditional items: appearing and disappearing

- Items carry `minTier`. `effectiveTier = max(declaredTier, ...escalationTriggers)`.
- Items with `minTier > effectiveTier` render in a **collapsed group** headed
  `not required at Tier 1 — 60 items (Tier 2: 21 · Tier 3: 39)`, not removed from the DOM and not deleted
  from the file. Collapsing rather than vanishing keeps the denominator honest: a reader can always see how
  much of the framework their tier declaration excluded. Silently shrinking a checklist from 156 items to 75
  with no visible trace is precisely the "0% → 56% → 95.4% on identical data" failure `_SYNTHESIS.md` §6
  warns about, applied to counts instead of percentages.
- Lowering the tier **never deletes stored state**. Items that go out of scope keep their `checked` records;
  raising the tier again restores them with their original timestamps. The state file is append-in-spirit;
  the only destructive operation is an explicit per-item "clear attestation".
- Raising the tier introduces items as `unchecked` — never as `auto-failed`, never counted against the
  previous verdict retroactively. The verdict recomputes and the header shows
  `tier raised to 2 · 21 new items · verdict recomputed`.
- Auto-escalation triggers are shown with their source: `Tier ≥1 because: MCP servers configured
  (context7, memory)`. Derived triggers carry the evidence; answered ones carry `answered by ali`.

### Rendering "unknown" without rendering it as failure

This is the rule the rest of the component exists to serve, and we already apply it elsewhere:
`src/sections/QualitySection.jsx:133-141` refuses to call an empty drift list an all-clear —
"a code-generated baseline cannot disagree with the code it was generated from, so an empty drift list is
not an all-clear — it is 'no measurement was possible'". `server/fe.mjs:16-18`: "NULL IS NOT ZERO. Every
field that has no data is `null` and renders as '—'. A dashboard that shows a green 0% when it has never
read a file is lying."

Concretely:

1. **Unknown has its own glyph, its own colour, and its own counter.** It is never folded into fail, never
   folded into pass, never rendered as `0`, and never rendered as an empty cell that a reader could mistake
   for "nothing wrong".
2. **Every unknown carries a `reason` string, and the reason is required by the check contract** — the
   registry rejects a `Result` with `state:'unknown'` and no `reason`. Reasons are concrete and actionable:
   `no .claude/ directory in this project`, `npm audit not run — needs network`, `no dist/ directory —
   run a build first`, `no .env.example to compare against`, `playwright report is 31 days old`.
3. **Unknowns are excluded from the pass denominator and reported separately.** The header is a sentence,
   not a bar:
   `75 items · Tier 1 · 24 auto-passed · 3 auto-failed · 9 unknown · 11 attested · 28 unchecked · 0 n/a`.
   Every number is a count with a visible total. No percentage appears without both numerator and
   denominator adjacent (`_SYNTHESIS.md` §6).
4. **The verdict token names its unknowns.** `READY TO FREEZE` requires: zero `auto-failed`, zero conflict
   rows, and every applicable item either `checked`, `not-applicable`, or `auto-passed`. Unknowns block it
   by default, and the token renders as
   `READ-ONLY PLAN — 3 failed, 9 unknown (5 need network, 4 need a build)`. A "waive unknowns" toggle is
   allowed, but then the token must render as `READY TO FREEZE (9 unknowns waived)` — the waiver is part of
   the verdict, permanently, and is stored with the attestation.
5. **A check that throws returns `unknown` with the error message as the reason.** It never returns `fail`.
   An exception in our scanner is a fact about our scanner, not about the user's repo.

### Reuse surface

The same component serves: the 75 freeze-audit items (feature 2), the 81 tier items (feature 4), the 44-item
plugin/MCP checklist (feature 7), and repo B's structured acceptance criteria (feature 8) — where an
`AcceptanceCriterion` maps onto the item shape with `check: null` and its `test_steps[]` rendered as the
expandable detail. Building it once, properly, is what makes those three follow-ons S-effort instead of M.

---

## Not worth taking

- **Upstream's `rm -rf` blocking rule as written.** Two literal substring comparisons (`"rm -rf /"`,
  `"rm -rf /*"`), missing `rm -rf ~`, `rm -rf .`, `rm -fr /`, extra whitespace, and every
  variable-indirection form. The research calls it "nearly cosmetic". Our `git-guardrails-claude-code` skill
  is strictly better. Port the *idea* of governing-document protection (feature 5), not this rule.
- **The `~200`-line file ceiling as a universal rule.** Keep it as item #17 with a configurable threshold
  and a page-directory glob, because as a *check* it is cheap and deterministic. Do not adopt it as a
  house rule: `claude.md` itself is 2472 lines, and their own `post_tool_use.py` only enforces it on paths
  containing `/pages/` — the rule contradicts its author's practice and its own implementation.
- **Repo B's SDK-driving code, cost tracker, resume implementation, and stage machine.** Verified broken:
  unimportable v1, `query()` called wrongly twice over, `ClaudeAgentOptions` built and discarded, zero tools
  per agent, four dead phase branches, `resume` that calls `build()` without `setup()`. Our PlanGraph
  (`src/sections/PlanGraph.jsx`, `src/lib/plan.js`) models real execution from real transcripts; their stage
  machine is a 7-branch `if/elif` with 4 dead branches. Their cost tracker's `track_usage()` has no callers
  and always reports zero.
- **Any number from repo B's v3 documents.** `_SYNTHESIS.md` §6 and the research both record fabricated
  telemetry presented as real results for a system that has never run. Do not repeat these numbers in our UI
  or docs, even as illustration.
- **Repo B's `.mcp.json`.** Five fabricated npm package names. Not a source of anything.
- **The 20 Supabase/Discord/Railway-specific audit items as default-visible content** (#5–#12, #54–#56,
  #59 and neighbours). Keep them in the data with `appliesTo` tags; hide them unless the stack matches.
  Rendering someone else's stack by default is the exact mistake `src/App.jsx:206-208` records us already
  having made once and reversed.
- **Upstream's mandatory PRD-first waterfall and the full 20-section PRD template.** Out of scope here, and
  `_SYNTHESIS.md` §7 Cluster F records ccpm's own tracker (#975) reporting the equivalent as too rigid for
  small fixes. If we ever want it, it belongs in Ticket, not Governance.
- **A database for checklist state.** See the storage argument above. `~/.claude/*.json` through `track()`
  is sufficient, has five precedents in this codebase, and keeps `_SYNTHESIS.md` §8 Tier 3.5 an open
  decision rather than one this feature forces.
- **New dependencies.** Nothing in this spec needs one. Everything is `node:fs`, `node:path`,
  `node:child_process` (`spawnSync` for git/npm, already used at `server/index.mjs:4128`), and React —
  all already present.

---

## Open questions for the maintainer

**O1 — Should `PUT /api/hooks {scope:'user'}` propose instead of write?** `SETTINGS_FILES.user`
(`server/index.mjs:329`) and `settingsFileFor('global')` (`:1335`) are the same path, so the Hooks editor
currently edits global config directly while the Library install path proposes for the same file
(`:3704`). Governance → Approvals prints "global config edits take effect only after review"
(`GovernanceSection.jsx:116`). One of the two must change. Proposing is the honest fix but makes the Save
button no longer save, which is a real UX regression for a single-user local tool. **My recommendation:**
propose, and change the Save button label to "Propose" when scope is `user`. Your call.

**O2 — Where should checklist attestations live?** `~/.claude/dashboard-checklists.json` (my
recommendation, argued above) or `<project>/.claude/freeze-audit.json` (committable, shareable, but
merge-conflict-prone and outside the `~/.claude` jail every other state file respects)? If the answer is
"both eventually", the export button is the v2 shape.

**O3 — What is the threshold and page-glob for item #17?** Upstream says ~200 lines and only enforces it
under `/pages/`. Our own `GovernanceSection.jsx` is 302 lines and `ReliabilitySection.jsx` is 370. If we
ship the check with upstream's defaults, this repo fails its own audit. Suggest: threshold configurable per
project, default 400, glob defaulting to the project's detected router directory, and a first-run
"calibrate from current repo" that shows the distribution before you pick.

**O4 — Which question is item #66 asking?** "LLM calls use appropriate model tier per task" can mean the
project's own runtime LLM calls (grep-able, low confidence) or the model mix in *our* Claude Code sessions
for that project (already computed — `/api/gov/costs` `byModel`, `ReliabilitySection.jsx:359-364`, high
confidence but answering a different question). Shipping the second under the first item's text would be
dishonest. Options: split into two items with distinct text, or ship only the repo-side check.

**O5 — Do we go back to the source repos for the 44 §12 plugin/skill checklist item texts?** The research
gives their structure and counts but not the verbatim text of all 44
(`sdlc-build-frameworks.md`, §12 breakdown). Feature 7 can ship the six §12.3 scan patterns without them.
Scaffolding 44 empty rows would be worse than not shipping them.

**O6 — Do we want the `unknown` waiver at all?** It is the one place in the design where a user can make a
verdict say `READY TO FREEZE` without the machine agreeing. It is labelled and stored, so it is honest —
but the strictest reading of our own rules says the token should simply never be reachable while unknowns
exist. I lean toward keeping the waiver because `npm audit` offline is a legitimate unknown that should not
permanently block a freeze; you may disagree.

**O7 — Should the auto-check run automatically on tab open, or behind a button?** Most checks are fast file
reads. Two are not: `npm audit` (network) and any check touching `node_modules`. Proposal: fast checks run
on open, slow ones render as `unknown — click to run` with an explicit trigger. Confirming this is the right
default before building, because "the tab hung for 40 seconds" is how a feature gets turned off.

**O8 — How much of the 30-event hook list do we surface?** All 30 are officially documented, but surfacing
21 events nobody in this codebase has ever fired risks turning a useful 9-item picker into a wall. Proposal
in feature 6 is to show all 30 with a "seen in your transcripts" count from `/api/hooks/health`, sorted
observed-first. Confirm.

---

## Provenance

- Upstream facts: `sdlc-build-frameworks.md` (repos cloned at `eb91e2a` and `3804a9b`), `_SYNTHESIS.md`
  §1 D4, §7 Cluster D, §8 Tier 1.4 and 2.1. Not re-researched for this document.
- Hook event list: verified 2026-07-29 against `https://code.claude.com/docs/en/hooks.md`. This is the one
  place where I went to a primary source rather than the research files, because the research explicitly
  flagged it as requiring confirmation.
- Everything about our code: read in this checkout on branch `research/upstream-ecosystem-analysis`,
  cited by `path:line`.
- Marked **unverified** in this document: the `PreCompact` and per-event hook payload shapes; the current
  `META` artifact shape in `src/sections/TicketSection.jsx`; the verbatim text of the 44 §12
  plugin/skill checklist items.
- Licence: both source repos MIT with verified `LICENSE` files (`_SYNTHESIS.md` §5). Ported checklist text
  must carry `Copyright (c) 2026 Doug Lowenthal` and the MIT notice in the header of
  `src/data/checklists/*.js`.
