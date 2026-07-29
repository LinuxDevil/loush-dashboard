# SPEC — access model and page capture

Implementation spec derived from `niche-agent-sdk-products.md` and `_SYNTHESIS.md`. No upstream
project was re-researched for this document; every upstream claim below is carried from that
research, and every implementation claim is grounded in a file in this repo that was read while
writing this.

Written against branch `research/upstream-ecosystem-analysis`, 2026-07-29.

---

## Licensing constraint

**Read this before anyone opens an editor.**

| Project | Licence on disk | What we may do |
|---|---|---|
| `ericshang98/Perfect-Web-Clone` | **None.** README carries an MIT shields.io badge; there is no `LICENSE` file, `GET /contents/LICENSE` 404s, and the GitHub API reports `license: null` | **Do not copy any of their source.** A badge is not a grant. Reimplement from the documented schema shapes only. Pasting their Python — even one model class — requires the author's **permission in writing, naming the licence** |
| `punt-labs/beadle` | **MIT**, `LICENSE` file present and verified | Code may be ported with attribution. We are not porting code here — we are implementing their published design (`DESIGN.md` DES-012), which is the cheaper path anyway since their Go does not map onto our Express |
| `agentbreeder/agentbreeder` | **Apache-2.0**, `LICENSE` file present and verified | Code may be ported with attribution and the NOTICE requirements Apache-2.0 imposes. We are taking schemas and a decision order, not code |

Loush is MIT (`package.json`). `_SYNTHESIS.md` §5 records that **four** of the surveyed projects
advertise an MIT licence they have not actually granted, Perfect-Web-Clone among them, and
recommends a short email asking each to commit a real `LICENSE` file. That email is worth sending
before Feature 3 starts, because Feature 3 is the one whose reference implementation is the
unlicensed repo.

§5's supply-chain rule applies to all of this: **copy from a git checkout, never a hosted
installer.**

Practical consequence for Feature 3: the schema field names in this document (`CSSData`,
`StyleSummary`, `analyze_sections`, and their members) are read from the research notes as a
*description of a data shape*. Field names are facts about an interface, not creative expression,
and we are re-deriving the implementation. Nobody should have their Python open while writing
`server/page-capture.mjs`.

---

## Features, ordered by value ÷ effort

| # | Feature | From | Effort | Why it sits here |
|---|---|---|---|---|
| 1 | Governance primitives — audit schema, reason strings, verb set, gate placement | agentbreeder | **S** | Small, purely additive, and it is the vocabulary Feature 2 needs. Doing it second means a migration |
| 2 | The rwx access matrix, retargeted to (profile, project) | beadle | **M** | Highest raw value in the document — it is the frame the §2 security hole belongs in — but genuinely M, and the upstream reference is partly unimplemented |
| 3 | Live-page style capture | Perfect-Web-Clone | **M** | Unlocks the Figma-vs-shipped diff, which is a materially better product on an existing UI surface. Costs a browser binary |
| 4 | Source-query endpoints for large artifacts | Perfect-Web-Clone | **S** endpoints / **M** rewiring | S to build, but the payoff is a direction rather than a visible capability, and it is dead code without a converted caller |

---

### 1. Governance primitives — audit schema, reason strings, verbs, gate placement

**Customer need.**
Someone running Loush across several repos opens **Governance → Audit log** and wants to answer
"who changed `maxTurns` on project X, when, and why was that allowed?" Today they can answer the
first three and not the fourth. The Audit tab (`src/sections/GovernanceSection.jsx:151-181`) does
not query an audit endpoint at all — it re-queries `/api/gov/versions`
(`GovernanceSection.jsx:155`). The audit log *is* the version list. So:

- Every row is a **file write**. There is no row type for a decision. Approving a proposal
  (`server/index.mjs:1769-1779`) mutates `dashboard-approvals.json` and, if approved, calls
  `track()` — a **rejection leaves no trace in the audit stream at all**. The only decision-shaped
  row we write is the synthetic `PROPOSED: …` entry at `server/index.mjs:1765`.
- There is no action verb, no resource type, and no reason. `track()`
  (`server/index.mjs:1724-1731`) records `{id, ts, author, machine, scope, file, summary,
  approvedBy, prev, content}`. `summary` is a free-text string written by ~30 different call sites.
- There is no way to ask "what depends on this skill?" `LibrarySection`, `ResourceSection`,
  `McpSection` and `CapabilityLedger` list things; nothing connects them.

Today the workaround is grep over `~/.claude/dashboard-versions.jsonl`.

**Value to Loush.**
Cheap, and it makes the audit log answerable rather than merely chronological. It also fixes a real
gate-placement bug (below) and gives Feature 2 a vocabulary so that shipping the matrix does not
require a rename pass across Governance three weeks later. `_SYNTHESIS.md` §7 Cluster D rates our
audit log as "exists and is shipped" against beadle's "invariant statement" — we are ahead on
shipping and behind on schema. This closes that.

**How the upstream repo does it today.**
`agentbreeder/agentbreeder`, Apache-2.0, verified from source in the research:

- `VALID_ACTIONS = {read, use, write, deploy, publish, admin}`. The load-bearing choice is
  splitting **`use`** from **`read`**: `read` = see the prompt text, `use` = invoke it in a run.
  Collapsing them makes "your team may run this agent but may not read its system prompt"
  inexpressible.
- Default grant tables: `_OWNER_ACTIONS = [read, use, write, deploy, publish, admin]`,
  `_TEAM_ACTIONS = [read, use]`; other teams get `read`; unauthenticated gets nothing. Two ideas
  worth stealing — **owner-deploy still requires approval**, and **visibility is the default,
  capability is not**.
- `check_permission(db, user_email, resource_type, resource_id, action) -> (bool, str)` resolves
  direct user → group → team **and returns a human-readable reason with every decision**
  (`"Direct user permission"`, `"Group permission via group {id}"`).
- `AuditEvent` (`api/models/audit.py`): `id, actor(idx), actor_id, action(idx), resource_type(idx),
  resource_id, resource_name, team, details(JSON), ip_address, created_at(idx)`. The detail worth
  copying is **`resource_name` denormalised** — the row stays readable after the resource it
  describes is deleted.
- `ResourceDependency`: `(source_type, source_id, source_name) → (target_type, target_id,
  target_name)` plus `dependency_type`, unique on the four-tuple, indexed both directions. An
  impact-analysis graph in one table.
- `check_deploy_approved()` sits **between RBAC and provisioning**, so nothing is allocated and no
  credential is minted for an unapproved agent. Generalised: *put the approval gate before the
  first irreversible or resource-allocating step, not before the last one.* Admin bypass exists and
  the bypass is itself audited.

**REAL BUG IN THEIRS — do not inherit.** `rbac_service.check_permission()` iterates
`TeamService._memberships`, a **class-level in-memory dict** (with an in-line comment
acknowledging it). Team-derived permissions are therefore not durable across processes. Our
equivalent temptation is a module-level `Map` in the new code. **Rule: the access/audit layer reads
its JSON from disk on every decision, with at most an mtime-keyed memo** — the pattern already used
at `server/constitution.mjs:148` and `server/figma-capture.mjs:88-96`. Authoritative state never
lives only in a process.

**How we implement it here.**

1. **Extend `track()`** (`server/index.mjs:1724`) with optional `{action, resourceType,
   resourceName, reason, details}`. Defaults keep every existing call site working: `action:
   'write'`, `resourceType` derived from the path (`settings`, `rules`, `skill`, `agent`, `mcp`,
   `manifest`, `other`), `resourceName: path.basename(file)`. Add `kind: 'version'`.
2. **Add `audit(event)`** beside `appendVersion` (`server/index.mjs:1722`) — appends to the same
   `dashboard-versions.jsonl` with `kind: 'decision'`, `prev: null`, `content: null`. Call it from:
   approve **and reject** (`server/index.mjs:1769-1779`), profile apply
   (`server/index.mjs:2039`), batch apply (`server/index.mjs:3369`), rollback
   (`server/index.mjs:1749`), and — once Feature 2 lands — every denial.
3. **Filter by kind** in `GET /api/gov/versions` (`server/index.mjs:1735`) so the Versions tab does
   not start showing decision rows, and add `GET /api/gov/audit` with `action` / `resourceType` /
   `q` filters. The Audit tab (`GovernanceSection.jsx:151`) switches to the new endpoint.
4. **Verb set, mapped honestly to us.** `read` = surface a project's file or transcript content;
   `use` = invoke without mutating (apply a profile to a scope, run a batch **dry run**, create a
   capture); `write` = mutate a config file through `track()`; `publish` = export a bundle into
   `~/.claude/harness-library` (`server/index.mjs:2064`) for sharing to another machine; `admin` =
   edit the access matrix, clear state. **`deploy` has no natural referent in our app** — see Open
   Questions.
5. **Gate placement — a concrete bug this rule finds.** `POST /api/batch`
   (`server/index.mjs:3369-3381`) applies `plan.apply()` across every target in one loop with no
   approval step. The "you must dry-run first" rule exists **only in the client**: it is the
   `disabled` prop on the Apply button (`GovernanceSection.jsx:243`,
   `disabled={!result?.dryRun || …}`). Any direct POST bypasses it. Batch apply is our first
   irreversible multi-target write, so by agentbreeder's rule that is exactly where the gate
   belongs. Fix: the server records a dry-run token per `(op, targets, params)` hash; a
   `dryRun:false` call without a matching recent token returns 409 with a reason string, and the
   refusal is audited.
6. **Lineage.** New `~/.claude/dashboard-lineage.jsonl`, edges
   `{sourceType, sourceId, sourceName, targetType, targetId, targetName, dependencyType, ts}`.
   Seed from what we already compute rather than a new scanner: the `/api/hub` graph edges
   (`server/index.mjs:1668`, rendered today by `src/sections/ProjectHub.jsx:74`), skill→project
   copies from batch `enable-skill` (`server/index.mjs:3344`), bundle→project imports
   (`server/index.mjs:2082`), baseline→project (`server/index.mjs:2115`). We already ship d3, so
   rendering is a small job once the edges exist.

**Effort: S.** Additive to one function and ~6 call sites, one new endpoint, one new file format.
No schema migration because there is no schema — it is JSONL.

**Risks and unknowns.**
- **Conflating two logs.** `dashboard-versions.jsonl` is simultaneously the version store (it holds
  full `prev` and `content`, `server/index.mjs:1729`) and the audit log. Adding decision rows to it
  makes it a third thing. The `kind` discriminator is the mitigation, but every existing reader
  must be updated in the same commit or the Versions tab shows garbage.
- **File growth.** `readVersions()` (`server/index.mjs:1732`) reads and parses the whole file on
  every governance request, then `.slice(-300)`. Decision rows increase row count without the
  content payload, so this gets worse slowly rather than quickly. Not urgent; worth a note.
- **Back-fill temptation.** Rows written before this change have no `action`. Do not infer one.
- **Unverified:** whether any user's `dashboard-versions.jsonl` is already large enough for the
  full-file parse to be noticeable. Nobody has measured it.

**Definition of done.**
- `GET /api/gov/audit?action=&resourceType=&q=` returns decision and version rows with the new
  columns. Rows written before the upgrade render `action` / `reason` as `—`, never a back-filled
  guess (project honesty rule, `CONTRIBUTING.md:44`).
- Approving **and rejecting** a proposal each append exactly one decision row carrying a non-empty
  `reason`. Verified by reading the JSONL, not the UI.
- `POST /api/batch {dryRun:false}` with no matching server-recorded dry run returns 409 with
  `{error, reason}`, and the refusal appears in the audit log.
- The Audit tab has action / resource-type filters. With zero matching rows it renders
  *"no governance decisions recorded yet — decisions appear here from the first approval or batch
  apply"*, not an empty table that reads as "nothing has happened".
- `GET /api/gov/lineage` with no edges returns `[]` and the UI says *"no lineage recorded yet"*. It
  never draws an empty graph.
- `test/server/gov-audit.test.mjs`: a legacy `track()` call still produces a readable row; a
  decision row is excluded from `/api/gov/versions`; a rejection produces an audit row.

---

### 2. The rwx access matrix, retargeted to (profile, project)

**Customer need.**
Two people, both real:

*(a) The multi-repo user.* Their `~/.claude.json` lists a dozen project directories, some of which
are client checkouts or a production infra repo. `GET /api/projects` (`server/index.mjs:817`) lists
all of them. `PUT /api/hub/file` (`server/index.mjs:1707-1716`) accepts **any** path under **any**
of those roots and writes it. `POST /api/batch` (`server/index.mjs:3369`) writes into every checked
target. `POST /api/chat` (`server/index.mjs:903-918`) accepts **any `cwd` that exists on disk** —
not even restricted to known projects — and spawns `claude` there with
`--dangerously-skip-permissions` (`server/index.mjs:916`). Today the user's only control is
remembering not to click the wrong thing.

*(b) The user on a network.* `app.listen(PORT, …)` (`server/index.mjs:4771`) is called **with no
host argument**, so Express binds `0.0.0.0`. Every endpoint above — all unauthenticated — is
reachable from any other machine on the same LAN. Today the workaround is to not run the dashboard
on untrusted networks, which nobody does because nobody knows.

**Value to Loush.**
`_SYNTHESIS.md` §2 records that three unrelated projects independently pointed at this hole, and
that **our posture is worse than siteboon's** — a project that shipped a CVSS 9.8 unauthenticated
RCE in March 2026. The loopback bind and token guard are the *fix*. The access matrix is the
*model* that makes the fix explicable and extends it from "is this request from me?" to "may this
project be touched at all, by anyone, ever?" Those are different questions and collapsing them is
exactly the mistake beadle refuses to make.

Secondarily: it gives every existing section one place to ask "may I?", which today is nowhere, and
it is far cheaper to add before the section count grows than after.

**How the upstream repo does it today.**
`punt-labs/beadle`, MIT, `DESIGN.md` DES-012, verified from source in the research.

```
permissions[identity_email][contact] → "rwx" | "rw-" | "r--" | "---"
```

The permission lives on the **pair**, not on either entity. `r` = beadle reads the message and
surfaces it to the owner, **no autonomous action**. `w` = may compose and send replies. `x` = may
execute instructions from this contact.

Five rules:

1. **Orthogonality.** Transport trust answers "is this message authentic?"; the rwx cell answers
   "given it is authentic, what should the agent do?" **Both must pass.** An unverified message
   from an `rwx` contact must not be executed; an authenticated message from an `r--` contact must
   not trigger autonomous action.
2. **No inheritance.** Every cell explicit. No propagation between identities, no implicit
   override.
3. **Whitelist default.** Unlisted or unset ⇒ `---`. `CheckPermission()` returns no-access when
   nothing is stored.
4. **Per-bit enforcement points.** `r` on `list_messages` (subject redacted, sender/date/trust still
   shown), `read_message`, `download_attachment`. `w` on `send_email` — **all** recipients must have
   write.
5. **Scope limit.** The matrix governs inbound message handling only. It does **not** govern
   address-book CRUD: any identity may add or remove contacts regardless of permissions. Beadle
   deliberately did not conflate "what should the agent do with mail from this person" with "who
   may edit the address book".

Also worth carrying: the **redacted listing** — messages from senders without `r` still appear with
sender, date and trust level, subject hidden. That is what makes the model discoverable instead of
confusing.

**⚠ CAVEAT — we would be implementing a design, not porting working code.**
This must be said plainly because it changes the risk profile:

- **beadle's `x` is not enforced.** `DESIGN.md` DES-012 states the execute bit is defined but not
  wired, because it "requires instruction parsing infrastructure". The headline permission bit is
  design, not runtime.
- **Command-signature verification is an admitted stub.** Their README says so in those words;
  today their only real gate is transport trust.
- The repo is 3 stars, 0 forks, self-labelled `beta`, with a "Working Backwards — hypothesis"
  badge. **No external review of this security model exists.**

So: there is no running reference implementation to diff our behaviour against, and no third party
has stress-tested the model. Budget for getting the enforcement points wrong on the first pass, and
treat the first release as a control we verify by test rather than a control we trust.

**How we implement it here.**

*New file* `server/access.mjs`, mounted alongside the other route modules at
`server/index.mjs:53-61` — but **before** every route it guards, because Express middleware order is
the enforcement order. It exports the route surface (`/api/access/*`) and a
`check(profile, project, bit) → {allowed, reason}` used both directly and as a middleware factory.

*Store:* `~/.claude/dashboard-access.json`, written `0600` via the same pattern as the Figma token
file (`server/figma-capture.mjs:20`, `:187`).

```jsonc
{
  "version": 1,
  "mode": "off" | "enforcing",
  "activeProfile": "local",
  "profiles": { "local": { "label": "This machine", "note": "" } },
  "permissions": {
    "local": {
      "/Users/you/code/dashboard": "rwx",
      "/Users/you/code/client-repo": "r--"
    }
  }
}
```

*UI:* a sixth tab in `src/sections/GovernanceSection.jsx:14` — the tab list is a literal array
(`['Versions','Approvals','Audit log','Drift','Batch ops']`), so this is a two-line change plus a
component, exactly as the research predicted. Rows are projects from `/api/projects`, columns are
r/w/x, cells cycle on click. Each row shows the resolved string and the **reason** from Feature 1.

*Bits, mapped to named enforcement points in our code:*

| Bit | Our meaning | Enforced at |
|---|---|---|
| `r` | The dashboard may return this project's file contents and transcript bodies | `GET /api/hub/file` (`server/index.mjs:1699`), `GET /api/hub` (`:1668`), `/api/fe/*` (Working Set, `server/fe.mjs`), `GET /api/constitution/artifact` (`server/constitution.mjs:179`), `GET /api/figma-capture/:slug` (`server/figma-capture.mjs:210`) |
| `w` | The dashboard may write files into this project | **`track()` itself** (`server/index.mjs:1724`) — see below — plus the non-`track` writers: `POST /api/figma-capture/:slug/annotations` (`server/figma-capture.mjs:227`) and `…/context` (`:236`), `POST /api/figma-capture/create` (`:192`) |
| `x` | The dashboard may spawn a process whose `cwd` is inside this project | `POST /api/chat` (`server/index.mjs:903`), the plan driver (`:1056`), the batch agent runner (`:1964`), the eval/team reviewer (`:3488`), and `git` invocations such as `currentBranch()` (`server/figma-capture.mjs:31`) |

*The choke-point insight, and it is a genuine improvement on beadle.* Beadle enforces per-tool,
which means the completeness of the model equals the diligence of whoever added the last tool. We
have something they do not: **`track()` is already the single funnel for every config write in the
app** — 30-odd call sites route through `server/index.mjs:1724`. Enforcing `w` inside `track()`
gives near-complete coverage from one edit. Do the same for `x` by introducing one
`spawnInProject(project, argv, opts)` helper and converting the five `spawn` sites to it.

**Reads have no such funnel.** There is no `read()` choke point; `r` will therefore be enforced
per-route and will be less complete than `w` and `x`. Say so in the UI copy. Claiming otherwise
would be the exact failure mode `_SYNTHESIS.md` §6 warns about.

*Redacted listing.* A project without `r` still appears in `/api/projects` with `path`, `name`,
`exists`, `sessions` and `commits`, but `usage`, `skills`, `commands`, `agents` and `mcp` become
`null` and the row gains `access: "---"`. Note the honest limitation: `/api/projects`
(`server/index.mjs:817-860`) aggregates transcript usage into `byProj` *before* it serialises, so
redaction happens at output, not at read. The data is still computed in-process. That is fine for
the threat model (a LAN attacker never sees it) and wrong for a "the dashboard never reads that
project" claim. Do not make the second claim.

*Two-dimensional trust, retargeted.* beadle's transport trust becomes our **request trust**:
`(bound to loopback) AND (token matches, when a token is configured)`. Both dimensions must pass,
exactly as DES-012 requires. A request from `192.168.x.x` fails regardless of matrix state; a
loopback request to a `---` project fails regardless of trust. Both live in `server/access.mjs` so
there is one file to read when someone asks "what protects this app?" This is where §2's fix
lands concretely: `app.listen(PORT, '127.0.0.1')` at `server/index.mjs:4771`, plus a
`timingSafeEqual` token compare.

*The matrix does not govern its own editing.* `PUT /api/access` is gated by request trust **only** —
never by the matrix. This is beadle's rule 5 carried over verbatim in spirit, and it has a second
justification here: a user who locks themselves out of every project must still be able to unlock.
Every matrix edit is audited via Feature 1.

**Effort: M.** One new server module, one new tab, five `spawn` conversions, one `track()` change,
plus the loopback/token work. The tail is enforcement-point completeness, not any single hard part.

**Risks and unknowns.**
- **"Profile" is already taken.** `~/.claude/harness-profiles.json` (`server/index.mjs:2019`) means
  "harness preset", is served at `/api/gov/profiles` (`:2026`), and is consumed by the Scaffolder in
  `src/sections/ProjectsSection.jsx:47`. Two things called "profile" inside the same Governance
  screen is a usability bug we would be creating deliberately. Recommendation: the on-disk and API
  key is `actor`; the UI says "Access profile". See Open Questions — this needs a decision, not a
  guess.
- **A third permission concept.** `settings.json` already has a `permissions` block that
  `harnessResolve` surfaces (`server/index.mjs`, dry-run `pick()`), and Claude Code has its own
  permission prompts. A user seeing "permissions" in three places will conflate them. UI copy must
  say *"this controls what the dashboard may do — it does not change Claude Code's own
  permissions"*.
- **Path matching on Windows.** Matrix lookup is prefix matching over absolute paths. `PUT
  /api/hub/file` already does this (`server/index.mjs:1709-1711`) with `startsWith(root +
  path.sep)`. On win32, case-insensitivity, 8.3 short names and UNC prefixes make that fragile.
  Normalise through `path.resolve` and lowercase on win32 before lookup. **Unverified:** whether any
  real `~/.claude.json` contains a trailing-separator or UNC project path.
- **Enforcement completeness is the whole value.** A matrix that guards 80% of write paths is worse
  than no matrix, because it produces confidence. The choke-point design is the mitigation; a test
  that greps for `spawn(` outside `spawnInProject` is the backstop.
- **Nothing here defends against a local attacker with disk write access.** They can edit
  `dashboard-access.json`. This is a usability and network-exposure control, not a sandbox. Do not
  let the README imply otherwise.

**Definition of done.**
- A sixth tab named **Access** renders in `GovernanceSection.jsx`.
- With no `~/.claude/dashboard-access.json` on disk, the tab renders *"Access control is off —
  every project in ~/.claude.json is fully readable and writable by this dashboard"*, names the file
  that would be created, and offers a single **Turn on** button. It does **not** render an empty
  grid.
- **Turn on** shows a diff of the seed grant (every currently-known project → `rwx`) and writes only
  after confirmation. No working install silently breaks.
- A project added to `~/.claude.json` **after** enforcement is on resolves `---` with reason
  `"not in the access matrix (default deny)"`.
- With a project at `r--`: `PUT /api/hub/file` inside it returns 403 `{error, reason}`; a decision
  row lands in the audit log; the project still appears in `/api/projects` with name and path and
  `access:"---"`, with `skills`/`commands`/`agents`/`mcp`/`usage` as `null` (**not** `[]` or `0`).
- With that project at `rw-`: `POST /api/chat` with a `cwd` inside it returns 403; with `rwx` it
  succeeds.
- `POST /api/batch` targeting a mix reports `skipped: permission denied (r--)` per denied target and
  still applies to the permitted ones. Partial application is always reported per target.
- Corrupting `dashboard-access.json` to invalid JSON makes every project resolve `---`, shows the
  parse error and the file path in a banner, and **no endpoint 500s**.
- `PUT /api/access` still succeeds when every project is `---`.
- Server logs its bind address at startup; a request from a non-loopback interface is refused.
- `test/server/access.test.mjs` covers: default-off; seed-on-enable; unknown project = `---`;
  parse-error = fail-closed (asserting it does **not** fall back to `off`); matrix edit ungated;
  `track()` refuses a write to a `r--` project.

---

### 3. Live-page style capture

**Customer need.**
A designer/engineer pair using **Figma Capture** (behind the `Company_Tools` flag,
`server/index.mjs:86-90`). Today they paste a Figma link, we fetch the node tree and a rendered PNG
(`server/figma-capture.mjs:106-130`), they annotate regions with design-system component mappings
(`src/company/FigmaCaptureSection.jsx:90`, `:229`), and we write a `context.md`
(`server/figma-capture.mjs:24-28`, `:236`) that guides Claude when implementing the design.

What they cannot do is check whether the **shipped page** matches. Our only drift check is
`designDrift()` (`server/index.mjs:3992-4018`), which compares component **names**, **prop names**
and **whether a `variant` prop exists** between `.claude/design-manifest.json` and a regex scan of
source files (`scanComponents`, `server/index.mjs:3947-3972`). It never renders anything. So *"the
primary button is the wrong blue and 4px too tall"* is completely invisible to us. Today the
workaround is: screenshot both, eyeball them, argue in Slack.

**Value to Loush.**
It turns Figma Capture from *"here is the design"* into *"here is where the build drifted from the
design"* — a materially better product on the same UI surface and in the same capture folder. The
overlap table in the research is blunt about the gap: nothing in our stack segments a page into
named blocks with bounding boxes, and on structured CSS extraction they beat us "clearly". It also
gives Loush the only design-side ↔ implementation-side join found anywhere in the 690-project
landscape scan.

**How the upstream repo does it today.**
`ericshang98/Perfect-Web-Clone` — **licence unresolved, see the top of this file.** Verified from
`backend/extractor/models.py` and `backend/json_storage/section_analyzer.py` in the research:

- `CSSData` — `stylesheets[{url, content, is_inline}]`, `animations[{name, keyframes[],
  source_stylesheet}]`, `transitions[{property, duration, timing_function, delay}]`,
  `variables[{name, value, scope}]`, `pseudo_elements[{selector, pseudo, styles, content}]`,
  `media_queries{}`.
- `StyleSummary` — value→usage-count histograms for `colors`, `background_colors`, `font_families`,
  `font_sizes`, `margins`, `paddings`, `display_types`, `position_types`.
- `InteractionData` — `hover_states` / `focus_states` / `active_states`, each an
  `InteractionState{selector, state, styles, screenshot}`.
- `ThemeDetectionResult` — `{support, current_mode, has_significant_difference, detection_method ∈
  css_media|class_toggle|color_scheme|none, css_variables_diff_count, color_diff_count,
  image_diff_count}`.
- `analyze_sections(raw_html, dom_tree)` → `{type: "simple"|"single-page"|"multi-section"
  (≤2 / 3–5 / >5 sections), sections:[{section_name, tag, class, index, bounds}]}`. It takes the
  **direct children of body/root** as candidates and derives a name from tag + class + index. A
  heuristic, not a parser — the same posture as the `ponytail:` comment at
  `server/figma-capture.mjs:53-54`.

Driven by Playwright + headless Chromium.

**Why `StyleSummary` matters more than it looks:** the top 12 entries of `colors` +
`font_families` + `font_sizes` + `paddings` *is* the page's de-facto design system, in a few hundred
tokens. It converts an unbounded page into a bounded, prompt-sized artifact. That is the trick.

**How we implement it here.**

*New file* `server/page-capture.mjs`, mounted inside the **same** `COMPANY_TOOLS` gate at
`server/index.mjs:87-89`, next to `mountFigmaCapture(app)`. It is the other half of Figma Capture
and inherits the same org-specific, off-by-default posture — including the property the README
calls out, that with the flag off the routes are never registered so a stale client gets a real 404.

*Storage:* into the **existing** capture folder — `<repo>/.claude/figma-captures/<slug>/page.json`
and `page.png`, beside `capture.json` / `screenshot.png` / `annotations.json`
(`server/figma-capture.mjs:13-14`, `:202-205`). `GET /api/figma-capture/list`
(`server/figma-capture.mjs:164-175`) already keys listing on `capture.json` existing, so a page
capture attached to an existing slug appears with a one-field change (`pageCaptured: true`). Page
capture **requires** an existing slug; posting to an unknown slug is a 404 with a reason. That keeps
the listing invariant intact.

*The dependency argument, made honestly.* A headless browser is normally a significant new
dependency. Here it is less than it looks and more than nothing:

- **`playwright@^1.62.0` is already in `devDependencies`** (`package.json`) and already imported at
  `scripts/shots.mjs:14` and `scripts/showcase.mjs:9` (`import { chromium } from 'playwright'`). So
  the npm package is not new.
- **The browser binary is new for end users.** Today only contributors regenerating README
  screenshots have run `npx playwright install chromium` (~150MB). That download is a real cost.

Therefore:

- `server/page-capture.mjs` imports playwright **lazily inside the handler**
  (`await import('playwright')`). A missing package or missing browser can never break server boot
  or any other route.
- `GET /api/page-capture/status` returns `{available:false, reason:"chromium is not installed — run
  npx playwright install chromium"}`, and the UI renders that sentence and that command instead of a
  Capture button. Not-installed is a **stated reason**, never a greyed-out mystery and never a zero.
- **Do not move playwright to `dependencies` in the first cut.** Keep it a devDependency plus a lazy
  import, so `npm install` for a normal user is unchanged. Revisit only if this graduates out of
  `Company_Tools`.

*Phase 1 — do this first; it is most of the value for a fraction of the cost.* One
`page.evaluate()` returning `StyleSummary` + `CSSData.variables` + `CSSData.media_queries` +
`analyze_sections`. All of it is `getComputedStyle` over a bounded `querySelectorAll('*')` plus a
walk of `document.styleSheets`. No per-element screenshots, bounded output. Cap the element count
(5000, mirroring `MAX_FILES_SCANNED = 6000` at `server/figma-capture.mjs:51`) and **record the cap
and whether it was hit in the artifact**, so a truncated capture is never mistaken for a complete
one.

*Phase 2 — only if Phase 1 earns it.* `CSSData.stylesheets` raw text (large — write to a sibling
file, never into `page.json`), `pseudo_elements`, `animations` / `transitions`, theme detection.

*Leave for later or never:* `InteractionState` with a base64 screenshot per selector. That is where
artifact size explodes and the drift payoff is smallest.

*Cross-origin stylesheets* throw on `.cssRules` access. Record them as `{url, blocked:true}` rather
than dropping them, and show the blocked count. The artifact must say what it could not read.

*Safety.* The target URL is user-typed and usually `http://localhost:xxxx`, but the fetched page is
**untrusted data**. Fresh browser context per capture, no persisted cookies or storage state, and
nothing in captured content is ever treated as an instruction.

**Effort: M.** Phase 1 is a few dozen lines of extraction plus a route and a status endpoint; the
tail is the degradation paths and the artifact-honesty fields.

**Risks and unknowns.**
- **Browser binary acquisition.** ~150MB, per-platform, and a corporate Windows machine may block
  the download outright. Degrades to `available:false` with the reason. This is the single biggest
  adoption risk.
- **Captures are only comparable if the capture conditions match.** Record `viewport`,
  `deviceScaleFactor`, `colorScheme` and `url`, and **refuse to diff two captures whose viewports
  differ** — offer to recapture instead of silently producing meaningless deltas.
- **A capture is a point in time against a running dev server.** Server down is
  `{available:true, error:"could not reach <url>"}` — an error with a reason, not an empty capture.
- **`analyze_sections` is a heuristic** over body's direct children, by the upstream author's own
  framing. Never present `section_name` as authoritative.
- **`page.screenshot({fullPage:true})` does not do what it looks like on apps with a scroll
  container** — our own `scripts/shots.mjs:6-12` documents exactly this trap for this codebase and
  the fix (grow the viewport, shoot normally). Whatever we capture, reuse that knowledge.
- **Unverified:** whether the `Company_Tools` cohort will accept the browser download at all; that
  is a product question, not an engineering one.

**Definition of done.**
- `GET /api/page-capture/status` returns `{available, reason}`. With chromium absent, the UI shows
  the reason and the exact install command — no disabled button without an explanation.
- `POST /api/page-capture {repo, slug, url, viewport}` writes `page.json` + `page.png` into the
  existing `<repo>/.claude/figma-captures/<slug>/`, and `/api/figma-capture/list` rows gain
  `pageCaptured`.
- Posting to a slug with no `capture.json` returns 404 with a reason.
- `page.json` always carries `capturedAt`, `url`, `viewport`, `deviceScaleFactor`, `colorScheme`,
  `elementsScanned`, `elementCap`, `truncated`, and `blockedStylesheets[]`.
- A page that yields no matched elements writes `truncated`/`blocked` reasons and the UI states
  them. It never writes an empty histogram that reads as *"this page uses no colours"*.
- Two captures with mismatched viewports cannot be diffed; the UI says why and offers recapture.
- `test/server/page-capture.test.mjs` unit-tests the histogram reducer and the section classifier
  over fixture input **without launching a browser** — the extraction body is written as a pure
  function so this is possible.
- With `Company_Tools` off, `/api/page-capture/*` returns 404 (verified, matching the existing gate
  behaviour the README documents).

---

### 4. Source-query endpoints for large artifacts

**Customer need.**
Anyone who asks Claude a question about a large local artifact. Our `.jsonl` transcripts already
have this shape of problem — `scanTranscripts()` and the response cache at `server/index.mjs:103`
exist precisely because whole-artifact processing is expensive. Feature 3's `page.json` will be the
same problem in a new place: the upstream extraction it derives from is roughly 200KB. Today the
options are "paste it all" or "paste a slice and hope".

**Value to Loush.**
Perfect-Web-Clone's README frames the failure honestly: a fully extracted page exceeds practical
context limits, and *"the solution isn't smarter agents — it's task distribution"*. Category 10 of
their tool registry (`list_saved_sources`, `get_source_overview`, `query_source_json`) exists so
**the 200KB extraction never enters the prompt** — the agent asks the store questions instead of
reading the store. That is a cleaner answer to context bloat than anything the context-mode class of
tool markets, and `_SYNTHESIS.md` §6 records that those marketed reduction percentages do not
survive checking (context-mode's own `ADR-0004` shows a displayed saving going 0% → 56% → 95.4% on
identical data, purely from formula changes). Query-instead-of-read has no percentage to inflate,
because nothing is being compressed.

Also worth noting for our own information architecture: their ten tool categories are **functional
roles, not source modules**, and categories 7–9 form a ladder — Preview *observes*, Diagnostics
*interprets*, Self-Healing *loops*. We do not want the self-healing loop (we are read-only over
transcripts by design), but the grouping principle is directly applicable to `McpSection` and
`CapabilityLedger`, which today list tools with no functional grouping.

**How we implement it here.**
Three endpoints over artifacts we already write to disk:

- `GET /api/source/list` — captures, transcripts, bundles, with ids and byte sizes.
- `GET /api/source/overview?id=` — shape, counts and top-N, under a **hard byte budget** asserted in
  a test.
- `POST /api/source/query {id, path, limit}` — a dot/bracket path into the JSON plus a limit.

Then convert at least one caller: the `/figma-capture` skill and the Ticket design agent
(`server/ticket.mjs`) cite a source id instead of pasting the artifact.

**Effort: S** for the endpoints, **M** for rewiring callers.

**Risks and unknowns.**
- **It is an agent-facing API in an otherwise UI-facing app.** Without a converted consumer it is
  dead code with a maintenance cost. Do not ship it without one.
- Path-query syntax is a small language; keep it to dot/bracket and refuse anything else rather than
  growing a query DSL.
- **Unverified:** whether any of our current artifacts are actually large enough to hurt. Measure
  before building — this is the one feature in the document that could turn out to be solving a
  problem we do not yet have.

**Definition of done.**
- `GET /api/source/overview` output for our largest existing capture is under a stated byte budget,
  and that budget is asserted in `test/server/source-query.test.mjs`.
- `POST /api/source/query` on a missing path returns `{found:false, reason}` — never `null`, never
  `{}`.
- With no artifacts on disk, `/api/source/list` returns `[]` and any UI surface says *"no saved
  sources yet"*.
- At least one real caller cites a source id instead of inlining an artifact, demonstrated in a
  diff.

---

## The access model, in full

### The matrix

```
permissions[profile][projectPath] → "rwx" | "rw-" | "r--" | "---"
```

Two entities, and the permission lives on the **pair**, not on either one — beadle's central
structural choice, carried intact.

- **Profile** — who the dashboard is operating as. In a default install there is exactly one,
  seeded as `local`. *(Naming: `harness-profiles.json` at `server/index.mjs:2019` already owns the
  word "profile" in this app. See Open Questions #1.)*
- **Project** — an absolute directory path, the same identity `/api/projects`
  (`server/index.mjs:817`) and `~/.claude.json` already use.

Bit semantics, per named enforcement point in our code:

| Bit | Meaning here | Enforced at |
|---|---|---|
| `r` | Surface this project's contents — file bodies, transcript bodies, resolved harness | `GET /api/hub/file` (`server/index.mjs:1699`), `GET /api/hub` (`:1668`), `/api/fe/*`, `GET /api/constitution/artifact` (`server/constitution.mjs:179`), `GET /api/figma-capture/:slug` (`server/figma-capture.mjs:210`) |
| `w` | Write files into this project | **`track()`** (`server/index.mjs:1724`) as the funnel, plus the three non-`track` writers in `server/figma-capture.mjs:192, 227, 236` |
| `x` | Spawn a process with `cwd` inside this project | `POST /api/chat` (`server/index.mjs:903`, which today accepts **any existing directory** and passes `--dangerously-skip-permissions` at `:916`), `:1056`, `:1964`, `:3488`, and `git` at `server/figma-capture.mjs:31` |

**What "may execute" gates in OUR app, specifically.** This is the bit worth being precise about,
because it is the one beadle never wired. For us `x` is not abstract: it is the answer to *"may the
dashboard start a `claude` process, with permissions disabled, with its working directory inside
this repo?"* Today the answer is unconditionally yes for any directory that exists on disk
(`server/index.mjs:904-916`). With `x`, a project at `rw-` can be browsed and configured but can
never be the cwd of a spawned agent. That is a control a real user would actually want for a client
checkout, and it is the strongest argument in this document for building the matrix at all.

### Where it is stored

`~/.claude/dashboard-access.json`, mode `0600`, written with the same env-or-file pattern as the
Figma token (`server/figma-capture.mjs:20`, `:187`). Read from disk on every decision with an
mtime-keyed memo (`server/constitution.mjs:148`, `server/figma-capture.mjs:88-96`). **Never held
authoritatively in a module-level variable** — that is the agentbreeder `TeamService._memberships`
bug, and it is easy to reproduce by accident.

### Default-deny, without breaking a working install

Whitelist default `---` is correct and would be actively hostile if applied on upgrade to a user
who already has twelve working projects. The resolution:

- **First run with no file:** `mode: "off"`. Every project resolves `rwx` with reason `"access
  control is off (single-user default)"`. Nothing changes for anyone.
- **Turning it on:** a one-time seed grants `rwx` to every project currently in `~/.claude.json`,
  shown as a diff and written only on confirmation.
- **After that:** every **new or unknown** project resolves `---` with reason `"not in the access
  matrix (default deny)"`.

So the whitelist default applies exactly where it earns its keep — things the user has not yet seen
— and never retroactively.

**No inheritance.** Every cell explicit. A project's parent directory being `rwx` grants a
subdirectory nothing. Beadle's rule 2, kept, and it is the rule most likely to be argued away during
implementation ("surely a monorepo root should imply its packages"). It should not: the point of no
inheritance is that reading one cell tells you the whole answer.

### How it interacts with the unauthenticated-localhost problem in §2

`_SYNTHESIS.md` §2 records three unrelated projects each shipping a control we lack, and concludes
that our posture is worse than siteboon's — the project that shipped a CVSS 9.8 unauthenticated RCE.
The concrete facts in our code: `app.listen(PORT, …)` at `server/index.mjs:4771` passes no host, so
Express binds all interfaces; `PUT /api/hub/file` (`:1707`), `POST /api/batch` (`:3369`) and `POST
/api/chat` (`:903`) all write or execute with no authentication of any kind.

The matrix does not fix that, and it is important to be exact about why: **the matrix answers a
different question.** Beadle's rule 1 — orthogonality — is the whole point. Two dimensions, both
must pass:

| Dimension | Question | Our implementation |
|---|---|---|
| **Request trust** (beadle: transport trust) | Is this request from the person sitting at this machine? | Loopback-only bind + `timingSafeEqual` token compare when a token is configured |
| **Access permission** (beadle: the rwx cell) | Given it is, may this project be touched at all? | The matrix |

An off-LAN request to an `rwx` project fails. A loopback request to a `---` project fails. Neither
substitutes for the other, and collapsing them is the mistake beadle explicitly refuses to make.

Both live in `server/access.mjs`, so "what protects this app?" has exactly one file as its answer.
**Recommendation: ship the loopback bind and token guard first, independently.** It is the actual
§2 fix, it is Tier-0-shaped, and it does not need the matrix. The matrix is the frame that explains
it afterwards and extends it — not a prerequisite. (See Open Questions #7.)

### How it fails closed

- **File missing** → `mode: "off"`, everything `rwx`. This is the *only* open failure mode, and it
  is deliberate: absence means "never configured", which for a fresh single-user install is the
  truthful state.
- **File present but unparseable** → resolve `mode: "enforcing"` and every project `---`, with
  reason `"access file unreadable — failing closed"`. The UI shows the parse error and the file
  path. **Do not fall back to `off` on a parse error** — that would make corrupting one file an
  escalation path, which is worse than any problem this feature solves.
- **File present, project absent from it** → `---`.
- **Unknown or malformed bit string** → `---`, with the malformed value quoted in the reason.
- **Every denial is audited** (Feature 1), with its reason string.
- **`PUT /api/access` is never gated by the matrix** — only by request trust. Beadle's rule 5, and
  our own lockout-recovery requirement. A user whose matrix is entirely `---` must still be able to
  fix it.

### How it degrades for a single-user install who wants none of this

This matters more than the feature does. A local-first dashboard that nags you about permissions on
your own laptop, for your own files, is a worse product than one with no permissions at all. The
design must make "I don't want this" a first-class, zero-friction state, and it does:

1. **Off is the default and stays the default.** No file on disk means `mode:"off"` means
   everything `rwx`. Fresh installs and every existing install behave exactly as they do today. No
   migration, no prompt, no first-run wizard.
2. **No banner, no badge, no nag.** With access control off, nothing outside the Access tab changes:
   no lock icons on project cards, no "unprotected" warning on Overview, no dot in the nav. The
   feature is invisible until sought. The precedent is right there in the README — `Company_Tools`
   is *"hidden from everyone by default — there is no nav entry, no route, and no hint that the
   feature exists"*, written after shipping someone else's tools to everyone.
3. **The Access tab is honest when off.** It says *"Access control is off — every project in
   ~/.claude.json is fully readable and writable by this dashboard"*, names the file it would
   create, and offers one button. That sentence is genuinely useful even to someone who will never
   turn it on: it tells them what the dashboard can currently do.
4. **Turning it on never breaks a working install** — the seed grants `rwx` to everything already
   known, previewed as a diff.
5. **Turning it off is one click and is not destructive** — `mode` flips to `"off"`, the matrix is
   retained, so re-enabling restores the previous grants.
6. **One profile is the norm.** The profile dimension collapses to a single row in the UI unless a
   second profile exists. Nobody sees a two-dimensional grid for a one-dimensional problem.

Point 6 is worth flagging as a design smell rather than hiding: **if the honest answer is that there
will only ever be one profile, then the second dimension is ceremony and the right design is a flat
per-project rwx list.** That is Open Question #2 and it is the biggest fork in this document.

---

## Figma-vs-shipped drift

The concrete payoff of Feature 3 against the Figma Capture tool we already ship.

### Where it lands

A third view in `src/company/FigmaCaptureSection.jsx`, per capture slug. Left: the design side from
`capture.json`. Right: the implementation side from `page.json`. Both already live in the same
folder (`server/figma-capture.mjs:13-14`), so there is no new storage concept and no new picker.

### The three diffs, in order of what they cost

**1. Token census — cheapest, ship first, needs nothing else.**

Compare `StyleSummary` histograms from `page.json` against the design-system catalog we already
load — `design-system-catalog.json` (`CATALOG_FILE` in `lib/paths.mjs`), served at
`server/figma-capture.mjs:145-147` and consumed by the component picker at
`src/company/FigmaCaptureSection.jsx:429`.

> Shipped page uses **14** distinct font sizes; the catalog declares **7**.
> Off-scale: `13px` (41 uses), `15px` (12 uses), `27px` (2 uses).
> Off-palette: `#3B7DD8` (18 uses) — nearest catalog token `--blue-600 #3A7BD5`.

This needs no change to the Figma side at all and is, per unit of effort, the most useful thing in
this document.

**2. Geometry diff — moderate.**

`capture.json.nodeTree` is a flat list of `{id, name, x, y, w, h}` with coordinates relative to the
captured root (`server/figma-capture.mjs:100-104`, `:115-117`), which matches how the cropped PNG is
framed. `annotations.json` entries carry `region {x, y, w, h}`
(`server/figma-capture.mjs:26`). `page.json.sections[].bounds` gives the shipped side. Scale by
(page width ÷ figma frame width), then match each annotated region to the best-overlapping section:

> **Header** — design 1440×88, shipped 1440×**96** (+8px)
> **Sidebar** — design x=0 w=240, shipped x=0 w=**256** (+16px)
> **Footer** — in the design, **no matching section in the shipped page**

**3. Palette/typography diff against the design — needs a change to `figma-capture.mjs` first.**

**This is a load-bearing limitation and it must not be glossed.** `flattenNode()`
(`server/figma-capture.mjs:100-104`) keeps **only** `{id, name, x, y, w, h}`. It discards `fills`,
`strokes`, `style` (typography), `effects` and everything else the Figma API returns. So a
design-side colour or type comparison is **not possible against captures we have already taken** —
the data was never stored. Extending `flattenNode` is a small change; migrating or re-fetching
existing `capture.json` files is the actual work, and it is Open Question #6.

### What the diff catches

- Colours used on the page that are not in the catalog, with use counts.
- Type sizes off the declared scale, and how many elements use each.
- Spacing values off the grid (`margins` / `paddings` histograms).
- Sections present in the design and absent from the build, and vice versa.
- Width, height and offset deltas at section granularity.
- Viewport mismatch — a design frame at 1440 compared against a page captured at 1280.
- A region annotated to a design-system component whose rendered element carries none of that
  component's class names — i.e. "you reimplemented the button instead of importing it".
- Theme support declared on the design side but absent in the build (Phase 2, via
  `ThemeDetectionResult`).

Critically, all of that is **orthogonal to what `designDrift()` already checks**
(`server/index.mjs:3992`). That function compares component names, prop names and variant-prop
presence between a manifest and a regex scan of source text. It is a *structural* check over source
code. This is a *visual* check over a rendered page. Neither subsumes the other, and both can be
true at once: the component exists with the right props (structural pass) and renders 8px too tall
in the wrong blue (visual fail).

### What it cannot catch

- **Which side is wrong.** The Figma frame may be stale. The diff reports a difference, never a
  verdict. Any UI copy calling one side "correct" is a bug.
- **Intentional divergence.** A deliberate redesign reads as drift. There is no "accepted" state in
  this spec; adding one is a follow-on.
- **Semantic equivalence.** `#3B7DD8` vs `--blue-600` needs a nearest-token heuristic, and the
  heuristic will be wrong sometimes. Show the distance, do not assert a match.
- **Anything finer than a top-level section.** `analyze_sections` walks body's direct children.
  A wrong border-radius on one card inside a grid is invisible to the geometry diff, though it may
  show in the token census as an off-scale value.
- **Interaction and animation.** Perfect-Web-Clone's own author states plainly that complex
  animations do not extract perfectly, and we are deferring `InteractionState` entirely.
- **Content.** Real data versus lorem versus an empty state renders as geometry drift that is not
  drift.
- **Responsive behaviour beyond the captured viewport.** One capture is one viewport. Diffing
  captures at different viewports is refused by design (Feature 3 DoD).
- **Anything on a page it cannot render** — auth walls, pages behind a VPN, a dev server that is not
  running. Those are stated errors, not empty results.
- **Whether the annotation mapping is right.** The whole geometry diff hangs off human-drawn regions
  and human-chosen component names in `annotations.json`.

---

## Not worth taking

- **NanoClaw's container isolation.** `_SYNTHESIS.md` §8 rejects it explicitly — *"wrong scale for
  local-first single-user"* — and the research agrees: we are a localhost Express process reading
  the user's own files on the user's own machine. Docker, mount allowlists, egress lockdown and a
  credential-injecting proxy solve a threat model we do not have, at the cost of a Docker dependency
  and our local-first thesis. The one salvageable crumb (a fail-closed allowlist file outside the
  project root) is covered better by Feature 2.
  **On the isolation claim itself:** third-party blogs assert micro-VM / hypervisor-level isolation;
  the repo's own `docs/SECURITY.md` describes **Docker containers**. Trust the repo.
- **beadle's four-level transport trust** (Proton E2E headers, `gpg --verify` exit codes,
  `multipart/signed` detection). Meaningful only for messages arriving from strangers; every input
  we handle is a local file the user already owns. Keep the *two-dimensional* idea, drop the four
  levels — we have two states, trusted request and not.
- **beadle's GPG-signed append-only audit log.** It is a stated design invariant in their
  `ARCHITECTURE.md`, not an implementation anyone read. Signing our JSONL with a key stored on the
  same disk proves nothing against an attacker who can write that disk, and it would let us claim
  "tamperproof" in a README. Do not.
- **beadle's glob contacts** (`*@github.com`). The analogue would be glob project paths, which is
  inheritance wearing a hat, and inheritance is the rule Feature 2 most needs to keep.
- **agentbreeder's `check_permission()` team-membership path.** Verified bug: it reads
  `TeamService._memberships`, an in-memory class dict, so team-derived permissions are not durable
  across processes. Take the resolution *order* and the *reason string*; never take in-memory
  authority.
- **agentbreeder's service principals, principal groups, A2A registry, LiteLLM key minting, budget
  caps, compliance scans and the Go sidecar.** All presuppose multi-tenant infrastructure —
  Postgres, Redis, a LiteLLM proxy, optionally Neo4j/Vault/K8s. At single-user scale they are
  ceremony. Only the schemas and the decision order transfer.
- **agentbreeder's own docs where they contradict its code.** `ARCHITECTURE.md` claims eight ACL
  asset types including `knowledge_base`; `VALID_RESOURCE_TYPES` has seven and no `knowledge_base`.
  Read the code.
- **Perfect-Web-Clone's multi-agent orchestrator, BoxLite sandbox, three-tier memory and
  self-healing loop.** We are read-only over transcripts by design; that is a choice, not a gap.
- **`InteractionState` with a base64 screenshot per selector.** Where artifact size explodes and
  drift value is lowest.
- **Any code copied verbatim from Perfect-Web-Clone**, until the licence question is settled in
  writing. Take the schema, write the code.
- **Any performance or reduction percentage from any of the three projects.** `_SYNTHESIS.md` §6:
  every checkable headline number in the surveyed set failed on inspection. Do not repeat them in
  our UI or docs, and do not render a percentage of our own without its denominator visible.

---

## Open questions for the maintainer

1. **"Profile" is already taken.** `~/.claude/harness-profiles.json` (`server/index.mjs:2019`)
   means "harness preset", is served at `/api/gov/profiles`, and feeds the Scaffolder
   (`src/sections/ProjectsSection.jsx:47`). Feature 2 would put a second, unrelated "profile" in the
   same Governance section. Rename the access dimension to `actor`/`operator`, or rename harness
   profiles to "presets"? This blocks the on-disk schema.

2. **What is the second profile actually for?** *(The biggest fork in this document.)* A single-user
   local install has exactly one actor. The profile dimension only earns its keep if there is a real
   second one — a shared machine, a "restricted" mode you switch into before screen-sharing, or an
   agent-vs-human distinction. If the honest answer is "there isn't one", the correct design is a
   flat per-project rwx list with no profile dimension, which is materially simpler and still
   delivers the entire `x`-gates-`spawn` payoff. Beadle needed two dimensions because they genuinely
   have many identities and many contacts. Do we?

3. **`deploy` has no referent in our app.** The nearest thing is batch-apply-across-projects. Map it
   there, or carry five verbs and document the omission?

4. **Server-side dry-run requirement on `POST /api/batch`.** Today the rule is a client-side
   `disabled` prop (`src/sections/GovernanceSection.jsx:243`). Enforcing it server-side is the
   correct gate placement but is a behaviour change for anyone scripting the endpoint. Ship it?

5. **Is a ~150MB chromium download acceptable for `Company_Tools` users?** The alternative is
   driving an existing browser MCP, which needs no dependency but cannot run unattended and cannot
   be tested in CI. This decides Feature 3's shape.

6. **`flattenNode()` discards fills and typography** (`server/figma-capture.mjs:100-104`). Extending
   it changes `capture.json`'s shape. Do existing captures get migrated, re-fetched on open, or read
   behind a version check? Without a decision, the design-side half of the palette diff cannot ship.

7. **Ship the loopback bind + token guard independently of the matrix?** It is the actual
   `_SYNTHESIS.md` §2 fix, it is Tier-0-shaped, and it does not depend on Feature 2.
   **Recommendation: yes, first.** Confirm.

8. **Licence emails.** §5 lists four projects advertising an MIT licence they have not granted, with
   `ericshang98/Perfect-Web-Clone` — Feature 3's reference — among them. Send the "please commit a
   LICENSE file" note before Feature 3 starts?

9. **Where does the `r` bit stop?** Feature 2 enforces `w` and `x` at choke points and `r`
   per-route, which means `r` will be less complete. Is partial read enforcement worth shipping, or
   does `r` wait until there is a read funnel? Shipping a bit that is 70% enforced may be worse than
   not shipping it.

10. **Does the audit log stay one file?** Feature 1 puts decision rows into
    `dashboard-versions.jsonl` alongside version rows carrying full `prev`/`content`
    (`server/index.mjs:1729`). One file with a `kind` discriminator is simpler; two files keep the
    version store from growing on every denial. Unmeasured either way.
