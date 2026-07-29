# SPEC — CAST (`ek33450505/claude-code-dashboard`) adoptions

Implementation spec derived from `cast-claude-code-dashboard.md` and constrained by `_SYNTHESIS.md`
sections 1, 2, 7 and 8. Written 2026-07-29 against our code at `research/upstream-ecosystem-analysis`.

**Governing constraints, applied throughout:**

- **Port primitives, not pages.** `_SYNTHESIS.md:343` puts CAST's page-level components on the
  explicit do-not-adopt list — they are dead without `~/.claude/cast.db`, which we will never have.
  Every feature below is a function, a route, or a component. No CAST view is proposed.
- **Windows first.** CAST hardcodes `'/'` path splitting and gates on the POSIX executable bit
  (`_SYNTHESIS.md:367-369`). The user runs Windows. Every port below uses `path.sep` and reports
  `executable: null` where the concept does not exist. Never fake a pass.
- **Vendor, do not track.** CAST is dormant (last commit 2026-07-05) and has **no LICENSE file** —
  `license: null`, `/license` returns 404, the MIT claim is a static badge only
  (`cast-claude-code-dashboard.md:17`, `_SYNTHESIS.md:147`). Every ported file carries a header
  recording the source path, the commit era, and that permission was given by email while the repo
  itself grants no license.
- **Our code wins over the research file.** Three discrepancies found and recorded inline below.

**Discrepancies between the research file and our actual code** (our code trusted in all three):

| Research claim | Reality in our code |
|---|---|
| "Cost in dollars \| NONE \| **Them** \| No rate table anywhere in our server." (`cast-…:356`) | **False.** `server/index.mjs:1987` `entryCost()` already prices input, output, cache-write **and** cache-read with exactly CAST's multipliers (`out ×5`, `cc ×1.25`, `cr ×0.1`). What we lack is a correct *base rate per model* and an `unpriced` state — see feature 3. |
| "Path-traversal guard \| Unverified in our code \| **Them**" (`cast-…:377`) | **We have one.** `server/index.mjs:125-130` `safe()` resolves and asserts `startsWith(root + path.sep)` against `ALLOWED_ROOTS`. It is `safeResolve` with a three-root jail, and it is already `path.sep`-correct. The gap is *coverage*, not existence — see feature 1. |
| CAST's `promptId` sibling-scan for parent-agent attribution is "worth stealing" (`cast-…:313`) | We already do this **better**. `server/index.mjs:900-905` reads the `.meta.json` sidecar's `toolUseId` and matches it to the parent's `Task` tool-call `id` — an explicit link, not a 200ms-sleep-plus-heuristic-scan. Rejected below. |

---

## 1. Authenticated write gate + loopback bind

**Customer need** — Ali runs `npm run dev` on his Windows laptop and joins the office wifi or a
coffee-shop network. `server/index.mjs:4771` is `app.listen(PORT, () => …)` with **no host
argument**, so Express binds every interface, not loopback. There is no CORS middleware, no helmet,
no `Host` check, and no token anywhere in the file — verified by grep: the only matches for
`token` in `server/index.mjs` are about *usage* tokens. Meanwhile there are **135 write routes**
across `server/*.mjs`. Anyone on the same network segment can:

- `PUT /api/settings` — overwrite `~/.claude/settings.json` wholesale (`index.mjs:351-359`)
- `PUT /api/setup/credentials` — write JIRA/GitHub tokens into the secrets file (`server/setup.mjs:313`)
- `POST /api/mcp` — add an MCP server config to `~/.claude.json` (`index.mjs:266`)
- `POST /api/hooks/install` — install a `PreToolUse` command hook that runs on every tool call
- `POST /api/chat` — spawn `claude` with `--dangerously-skip-permissions` (`index.mjs:916`) in an
  **attacker-chosen `cwd`** (`index.mjs:910-919`). That is remote code execution, one POST deep.

Today the mitigation is "nobody knows the port." That is not a mitigation.

**Value to Loush** — This is `_SYNTHESIS.md` **Tier 1.3**, and section 2 names it as a hole three
unrelated projects pointed at independently. It also buys the honest version of a claim we already
make: `src/App.jsx:40-49` and the plane-B banner at `index.mjs:27-39` describe this app as a
privacy boundary. A boundary that any LAN peer can write through is a comment, not a boundary.
Shipping this turns "local-first" from a value statement into an enforced property, and gives us a
defensible read-only-by-default story.

**How the upstream repo does it today** — `server/middleware/controlGate.ts`, 74 lines
(`cast-…:292-293`). Four behaviours, in order:

1. Safe methods (`GET`, `HEAD`, `OPTIONS`) always pass. Reads are never gated.
2. Control disabled → **404**, not 403. Deliberate: a 403 confirms the endpoint exists; a 404 hides
   it. Scanning tells you nothing.
3. Enabled but no token configured → **503**. Fail-closed: a missing config never degrades to open.
4. Token present but wrong → **403** via `crypto.timingSafeEqual`. The non-obvious detail
   (`cast-…:293`, their lines 32-33): on a **length mismatch** they call `timingSafeEqual(ab, ab)` —
   comparing a buffer with itself — purely so the length-mismatch path costs the same wall-clock
   time as the compare path. `timingSafeEqual` throws on unequal lengths, so the naive early-return
   leaks length through timing.

Mounted on 12 surfaces from their `server/index.ts:82-93`, plus `express-rate-limit` at 5/min for
destructive routes and 10/min for seed routes, with **no limit on reads** (`cast-…:134`).

Their client side sends `X-Dashboard-Token` via a separate `controlFetch` wrapper, leaving the plain
read `apiFetch` untouched (`cast-…:263`).

**How we implement it here** —

- New `server/control-gate.mjs` exporting `controlGate(opts)` — an Express middleware, de-typed
  from theirs. Config from env: `DASH_CONTROL=off|on` (default `on` for a local single-user app,
  so we do not break the current experience) and `DASH_TOKEN`. When `DASH_CONTROL=on` and
  `DASH_TOKEN` is unset, generate a token at boot, write it to
  `~/.claude/dashboard-backups/.dash-token` with mode `0o600`, and **print it to the console** —
  the Vite dev client reads it from a new `GET /api/control/handshake` that answers only to
  requests whose socket address is loopback (`req.socket.remoteAddress` in `::1`/`127.0.0.1`).
  That keeps zero-config local use working while closing the LAN path.
- Mount **once, globally**, immediately after `app.use(express.json(...))` at `index.mjs:52` and
  **before** `mountEng`/`mountTicket`/`mountSetup` (`index.mjs:53-61`), so all 135 write routes are
  covered including the sub-mounted ones. A single global mount is strictly safer than CAST's
  12-surface enumeration, which is exactly the kind of list that drifts.
- Change `index.mjs:4771` to `app.listen(PORT, '127.0.0.1', …)`. Add a `Host`-header allowlist
  (`localhost`, `127.0.0.1`, `[::1]`, plus `DASH_HOST_ALLOW`) to defeat DNS rebinding — a loopback
  bind alone does not stop a malicious page in the user's own browser from POSTing to
  `http://localhost:5178`. This is the CCAM half of `_SYNTHESIS.md:70`; take both, they are ten
  lines together.
- Client: `src/lib/api.js` — the `req()` helper already branches on `opts` being present
  (`opts` is set for PUT/PATCH/POST/DELETE and absent for GET). Add the token header inside that
  same `opts &&` branch, so reads stay header-free and nothing else changes. Fetch the token once
  from `/api/control/handshake` at boot in `App.jsx`'s existing `/api/features` effect
  (`App.jsx:299-304`) and stash it in a module variable next to `freshUntil`.
- No new dependency. Rate limiting is deliberately **out of scope** — `express-rate-limit` would be
  a new dep for a single-user localhost app where the gate already closes the actual hole.

**Effort** — **M**. The middleware is a day; the audit of what breaks is the rest. Every write path
in the client must carry the header, and there are write calls in `SetupSection`, `HooksSection`,
`McpSection`, `CustomizeSection`, `GovernanceSection`, `ResourceSection`, `BoardSection`,
`TicketSection`, `ChatSection` and more. Because they all route through `src/lib/api.js`, the
change is one file — but each needs a smoke test.

**Risks and unknowns** —

- **The handshake endpoint is the new weak point.** If it answers non-loopback requests it hands the
  token to the attacker and the whole gate is theatre. It must check the socket peer address, not
  the `Host` header or `X-Forwarded-For`. Must be unit-tested with a non-loopback socket stub.
- **Windows:** `app.listen(PORT, '127.0.0.1')` on Windows does **not** also bind `[::1]`. A browser
  resolving `localhost` to IPv6 first will fail to connect. Verify: either bind `'localhost'` (Node
  binds both families for that hostname on recent versions — **must be checked on our Node
  version**) or listen twice. This is the single most likely thing to break the app on the target
  platform, and it must be verified before merge.
- The Vite dev proxy (`vite.config.js` → `http://localhost:5178`) runs server-side inside Vite and
  will still reach a loopback-bound API. Confirm the proxy's own bind (Vite defaults to loopback;
  `--host` would re-expose the whole thing through the proxy).
- `POST /api/chat` deserves a second control beyond the gate: validate `cwd` against the configured
  project roots. Out of scope here, but note it — the gate makes it authenticated, not safe.
- Contradicts nothing in the synthesis. Complements `_SYNTHESIS.md:319` (siteboon permission triad,
  Tier 2.3) — that removes `--dangerously-skip-permissions`, this stops strangers reaching it.

**Definition of done** —

- `curl` to `http://<lan-ip>:5178/api/meta` from another machine **fails to connect** (bind), and
  `curl -H 'Host: evil.example' http://127.0.0.1:5178/api/meta` returns **403** (Host allowlist).
- `PUT /api/settings` without a token returns **404** when `DASH_CONTROL=off`, **503** when on and
  unconfigured, **403** with a wrong token, and **200** with the right one.
- `GET /api/usage` returns 200 in all four states. Reads are never gated.
- A `node --test` file at `test/server/control-gate.test.mjs` asserts all four codes plus the
  loopback-only handshake, in the style of `test/server/setup-config.test.mjs`.
- The token is never rendered in the UI and never appears in any response body other than the
  loopback handshake.
- **Empty/null state:** when `DASH_CONTROL=off`, the UI shows no security chip at all — it does not
  show a green "secured" badge. Absent protection renders as absent, not as a reassuring default.

---

## 2. Hook wiring health — resolve, stat, grade

**Customer need** — Ali has a `PreToolUse` hook in `~/.claude/settings.json` pointing at
`~/.claude/scripts/guard-prod.sh`. Last month he renamed the script. The hook still appears, exactly
as configured, in our Hooks section — `src/sections/HooksSection.jsx:104-116` renders every entry
from `GET /api/hooks` as a row with its command in mono. It looks healthy. It has not fired since
the rename. Claude Code fails the hook silently and keeps going.

Today he finds out by opening the Dry-run tab (`HooksSection.jsx:131-177`), selecting the hook from
the dropdown, and clicking run — a manual, one-hook-at-a-time check that nobody performs on a hook
they believe is working. There is no signal anywhere that says "this hook's script does not exist."

**Value to Loush** — `_SYNTHESIS.md` **Tier 1.2**, and the research calls it "the single
most-underrated feature in the repo" (`cast-…:93`). It converts our Hooks section from a config
dump into a diagnostic, and it is the one thing on the CAST list we lack **entirely**. It also feeds
the Inbox: a broken hook is exactly the kind of "harness" plane item `/api/inbox` exists to raise.

Critically, **we have a better failure source than CAST does.** They join `hook_failures` from
`cast.db`, populated by their own hook scripts. We parse hook execution attachments straight out of
the transcripts: `server/index.mjs:2336-2351` reads `j.attachment` where `type` starts with `hook_`
and already extracts `hookName`, `hookEvent`, `exitCode`, `durationMs`, `blocked` and a `reason`
string. That is ground truth from Claude Code itself, with **no CAST dependency**. Their feature
needs their database; ours needs nothing.

**How the upstream repo does it today** — `server/routes/hooks.ts:117-197` (`cast-…:130, 289-290`):

1. Read every hook command from `settings.json` + `settings.local.json`.
2. Extract the **script token** from the command string by matching `/\.(sh|py|js|ts|mjs)$/` against
   whitespace-split tokens — i.e. find the first argument that looks like a script path. This
   deliberately handles `python3 ~/.claude/x.py --flag` and `bash ./y.sh`.
3. Expand a leading `~`, and resolve a relative path against `~/.claude`.
4. `fs.stat` it: record `exists`, and `executable` as `(st.mode & 0o111) !== 0`.
5. Join `hook_failures` from `cast.db`: `MAX(timestamp)` and `COUNT(*)` per hook.
6. Grade: **red** if missing or not executable; **yellow** if a failure was recorded within 24h;
   **green** otherwise.

They also parse `~/.claude/hookify.*.local.md` YAML frontmatter (`event`, `description`,
`conditions`) as a second source of hook definitions (`cast-…:131`).

The gotcha their author hit is the one we inherit: **step 4 is POSIX-only**. On Windows there is no
executable bit; `st.mode & 0o111` returns a value derived from the read-only attribute, so it will
cheerfully report `true` for a `.txt` file. This is why `_SYNTHESIS.md:367-369` says report
`executable: null` rather than faking a pass.

**How we implement it here** —

- New `lib/hook-health.mjs` — pure, so it is testable the way `lib/harness-health.mjs` is:
  `resolveScriptPath(command, { home, claudeDir })` → `{ script, kind }` and
  `gradeHook({ exists, executable, lastFailureAt, failureCount, now })` → `'green'|'amber'|'red'`.
  Windows behaviour lives here: when `process.platform === 'win32'`, `executable` is **`null`** and
  the grade never uses it. Instead, on Windows we grade on a *known-interpreter* check — the command
  either names an interpreter we can find on `PATH` (`node`, `python`, `sh`, `bash`, `pwsh`) or the
  script has a known executable extension (`.cmd`, `.bat`, `.ps1`, `.exe`). Anything else is
  reported as `runnable: null` — unknown, not failing.
- Extend `GET /api/hooks/health` in `server/index.mjs:3659-3665`. **Do not create a new route.** The
  name is already taken by firing counts, and the response is already TTL-cached at
  `index.mjs:105` (`'/api/hooks/health': 600_000`). Add a `wiring: [...]` array alongside the
  existing `byEvent`/`blocks`/`total`/`sessions`/`note` keys, so the existing Health tab and the
  cache entry keep working untouched. Each row:

  ```
  { scope, event, matcher, command, script, resolvedFrom,
    exists: true|false|null,        // null = no script token found in the command
    executable: true|false|null,    // null on Windows — always
    runnable: true|false|null,      // Windows interpreter check
    lastFailureAt: <ms>|null, failureCount: <n>, lastReason: <string>|null,
    grade: 'green'|'amber'|'red'|'unknown' }
  ```

  Sources: `SETTINGS_FILES` (`index.mjs:328-332`) for the definitions — all three scopes, same shape
  the existing `GET /api/hooks` returns; `scanTranscripts().hookEvents` (`index.mjs:2398`) for the
  failure join, matching on `hookEvent` + the `tool` suffix that `index.mjs:2343-2344` already
  splits out of `at.hookName`. Note `scanTranscripts()` is already called by this exact handler
  (`index.mjs:3660`), so the join costs nothing new.
- Client: `src/sections/HooksSection.jsx` `Health()` (lines 179-213). Add a **Wiring** panel above
  the existing firings chart, since "is it wired" precedes "how often did it fire". One row per
  hook: grade dot, event, matcher badge (reusing the existing `.badge project` / `.badge user`
  classes from lines 108), resolved script path in mono, and a right-hand status cell. Use the
  StatusPill from feature 4 once that lands; until then use the same `var(--green)` /
  `var(--amber)` / `var(--red)` tokens the file already uses at line 42.
- No `App.jsx` navigation change — `hooks` is already a top-level section (`App.jsx:194`).
- **Explicitly skip** their `hookify.*.local.md` parsing. It is a CAST convention, not a Claude Code
  feature; nothing on this machine writes those files.

**Effort** — **S**. `lib/hook-health.mjs` is ~80 lines. The route change is ~40. The panel is ~50.
The Windows branch is the only thinking required, and it is a `platform === 'win32'` fork with a
documented answer. All three inputs (`SETTINGS_FILES`, `scanTranscripts`, `fs.statSync`) already
exist in the handler.

**Risks and unknowns** —

- **Windows executable bit — the headline risk.** `fs.statSync().mode` on Windows returns a
  synthesized mode where the owner-execute bit is **not** meaningful. We must never render a green
  "executable" tick from it. Enforced by making `executable` literally `null` on `win32` in
  `lib/hook-health.mjs`, with a unit test asserting that.
- **Script-token extraction is a heuristic and will miss cases.** Our own `HOOK_LIBRARY`
  (`index.mjs:3669-3682`) is entirely `node -e "…"` inline one-liners with **no script file at
  all** — five of five patterns. CAST's regex finds nothing in those. The correct output is
  `exists: null` with a grade of `unknown` and a label "inline command — nothing to stat", not
  `red`. Getting this wrong would paint our own shipped hook library red, which would be a
  spectacular own-goal. This is the case to write the first test for.
- The `hookName` → hook-definition join is fuzzy. Claude Code's attachment carries a hook *name*
  (`index.mjs:2343`), and settings carry a *command*. If the shapes do not line up on real data,
  the failure join degrades to per-event rather than per-hook. **Verify against a real transcript
  before building the join**; if per-hook is not reachable, ship exists/runnable only and show
  failures as `null`, not `0`.
- `~` expansion: our commands may use `%USERPROFILE%` on Windows. Handle it, or report `unknown`.

**Definition of done** —

- A hook whose script was deleted shows a **red** dot and the resolved path it looked for.
- A hook that is an inline `node -e` one-liner shows **unknown / "inline command"** — never red,
  never green.
- On Windows the executable column reads **"unknown (Windows)"** for every file-backed hook. It is
  never a tick and never a cross.
- A hook with a recorded non-zero exit in the last 24h shows **amber** with the timestamp and the
  captured reason string.
- With no hooks configured in any scope, the panel shows "no hooks configured in user, project or
  local scope" — not an empty table and not "0 healthy".
- `failureCount` is rendered as `—` when the transcript join could not be made, and as `0` only
  when the join succeeded and genuinely found zero. **Null is never rendered as 0.**
- `test/lib/hook-health.test.mjs` covers: POSIX exec bit set/unset, `win32` → `executable === null`,
  inline command → `exists === null`, `~` expansion, relative resolution against `~/.claude`, and
  the 24h amber boundary.

---

## 3. Model-keyed rate table with `lastVerified` and an explicit `unpriced` state

**Customer need** — `src/sections/SessionsSection.jsx:142-146` tells the user, in print, that
"**$ is real**: each entry is priced from its own model and token counts." The pricing behind that
sentence is `server/index.mjs:718`:

```js
const PRICE_PER_M = m => (/opus|fable/.test(m) ? 15 : /haiku/.test(m) ? 0.8 : 3)
```

Three regex buckets and a default. Per `_SYNTHESIS.md:32`, this makes Opus **3× too expensive**,
Fable 1.5× too expensive and Haiku 20% too cheap, with Sonnet correct by coincidence. Worse than
the wrong numbers is the silent default: **any model name we have never seen** — a new release, a
`claude-*-preview`, a third-party id — is priced as Sonnet and rendered as a confident dollar
figure. The user has no way to know which of the numbers on the Sessions ledger, the Usage
projection, the budget alert and `/api/roi` are measurements and which are the fallback.

**Value to Loush** — This is `_SYNTHESIS.md` **Tier 0.2**, a correction, and it is *already owned*
by that tier — I am not re-proposing the numeric fix. What CAST contributes and phuryn does not is
the **table structure**: exact-model-id keys, a family-prefix fallback, and (the research's own
suggestion, `cast-…:281`) shipping rates as JSON with a `lastVerified` date so the UI can render
"rates as of \<date\>" instead of implying live pricing. Tier 0.2 says "explicit `unpriced` state"
without saying what the module looks like; this is that shape.

`entryCost` at `index.mjs:1987` — `(in·P + out·P·5 + cc·P·1.25 + cr·P·0.1)/1e6` — **already matches
the cross-project consensus multipliers** in `_SYNTHESIS.md:206-208` exactly. The multiplier model
is correct and stays. Only the base-rate lookup changes. This is a much smaller job than the
research file implies (`cast-…:356` claims we have no rate table at all — wrong).

**How the upstream repo does it today** — `server/utils/costEstimate.ts`, 48 lines, zero
dependencies, one pure function (`cast-…:280-281`). A `Record<modelId, {input, output, cacheWrite,
cacheRead}>` in USD per million tokens, keyed by **exact model id**. Lookup order:

1. Exact id hit.
2. Family-prefix scan — `claude-sonnet` matches `claude-sonnet-4-6`.
3. Final hardcoded Sonnet default.

They declare `~/.claude/config/model-pricing.json` the authoritative source and treat the TypeScript
table as a hand-synced mirror (`cast-…:209`). They do **not** read that file at runtime, which is
the drift risk their own architecture note admits to.

Non-obvious detail worth buying: they store four independent rates per model rather than deriving
output/cache from input via multipliers. That matters because the ratios are *not* constant across
the lineup — assuming `output = 5×input` is right for the current models and is an assumption, not
a law. Storing four numbers means a future model with a different ratio does not silently corrupt.

**How we implement it here** —

- New `lib/pricing.mjs` (the exact filename `_SYNTHESIS.md:293` asks for) exporting:
  - `RATES` — imported from a sibling `lib/pricing.json` carrying `{ lastVerified: '2026-07-29',
    source: '<url>', models: { '<exact-id>': { input, output, cacheWrite, cacheRead } } }`.
  - `rateFor(model)` → `{ rate, matched: 'exact'|'family'|null }`. **No Sonnet default.** Where
    CAST falls back to Sonnet, we return `null`. That single change is the difference between their
    design and our honesty rule.
  - `costOf(entry)` → `{ usd, priced: true|false, model, matched }`.
- Rewrite `entryCost` (`index.mjs:1987`) to call `costOf`, keeping the same call signature so the
  eight existing call sites (`:684, :689, :776, :784, :2540, :2542, :2818, :2835, :4682`) do not
  change. An unpriced entry contributes **0 to the dollar sum and 1 to an `unpriced` counter** that
  rides alongside every total.
- `PRICE_PER_M` (`index.mjs:718`) survives only as the `priceFn` argument
  `lib/harness-usage-trends.mjs:34` expects; re-express it as `m => rateFor(m).rate?.input ?? null`
  and make `cacheWasteCost` skip null rather than substitute.
- Every response that carries a dollar figure gains `pricing: { lastVerified, unpricedEntries,
  unpricedModels: [...] }`. Concretely: `/api/usage` (`index.mjs:781-794`), `/api/sessions`
  (`:3048`), `/api/gov/costs` (`:2003`), `/api/roi` (`:3108`).
- Client: `src/sections/UsagePanel.jsx` — add "rates as of \<lastVerified\>" as the `muted` span in
  the Month-end projection `panel-head` (line 84), matching the existing muted-subtitle idiom used
  at lines 104 and 118. `src/sections/SessionsSection.jsx` — amend the "$ is real" paragraph
  (lines 142-146) to say what it now actually is, and render an amber row-level marker when a
  session contains unpriced entries.
- No `App.jsx` change. No new dependency — JSON import via `fs.readFileSync` in the same style as
  `readJson` (`index.mjs:1125`).

**Effort** — **S**. The module is ~50 lines, the JSON is data entry, and `entryCost` keeps its
signature so the blast radius is one function plus four response shapes. The *numbers* themselves
come from Tier 0.2's research (phuryn's exact table), not from CAST.

**Risks and unknowns** —

- **Where the rates come from is Tier 0.2's problem, not this feature's.** This feature ships the
  container and the `unpriced` semantics. If it lands first with CAST's stale numbers we have moved
  the bug, not fixed it. Sequence: land Tier 0.2's table into this container, or land them together.
- `_SYNTHESIS.md:55-59` is a real caution: Anthropic's own `/usage` figures are approximate and a
  2026-02 analysis measured JSONL input undercounts of 100–174×. Even a perfect rate table produces
  an indicative number. The `lastVerified` label helps; it does not make the figure authoritative.
  Do not upgrade any copy from "estimated" to "actual" on the back of this.
- `_SYNTHESIS.md:42-53` notes `cost.total_cost_usd` is supplied exactly by Claude Code but only on
  the statusLine stdin payload, not in transcripts. `costOf` should carry a `source:
  'estimated'|'reported'` field from day one so that path can be filled later without another
  migration.
- Windows: none. Pure arithmetic.

**Definition of done** —

- A transcript entry with an unrecognised model id renders as **`—` with an "unpriced" chip**, never
  as `$0.00`.
- Session and total dollar figures state how many entries were unpriced whenever that count is
  non-zero.
- The Usage panel shows "rates as of 2026-07-29" next to every dollar figure.
- `rateFor('claude-sonnet-9-9')` returns `matched: 'family'`; `rateFor('gpt-4')` returns
  `{ rate: null, matched: null }`.
- `test/lib/pricing.test.mjs` asserts exact hit, family hit, no-match-returns-null, and that
  `costOf` on an unpriced entry returns `{ usd: 0, priced: false }` — with a separate assertion that
  no caller sums `usd` without also reading `priced`.

---

## 4. One status vocabulary — five tones, including the missing amber

**Customer need** — A Loush run finishes. `lib/run-verdict.mjs:7-15` computes its verdict:
`NEEDS-HUMAN`, `BLOCKED`, `PASSING`, or `null`. Read line 12-14 closely — a run that is **done** and
has **blocking Critical/Required findings**, but whose review `decision` is not `REQUEST_CHANGES`,
falls past the `BLOCKED` branch at line 11, fails `done && !blocking` at line 13, and returns
**`null`** at line 14, whose own comment reads "running / unknown — no verdict yet". A finished run
with critical findings is displayed as *still running*. There is no state in our vocabulary for
"finished, but not clean."

More broadly: 58 separate uses of `var(--amber)` across `src/sections/*.jsx`, each section deciding
independently what amber means. `RunsSection.jsx:302` has a `VERDICT` colour map;
`HooksSection.jsx:169` inlines its own `/BLOCK/.test()` ternary; `SessionsSection.jsx:12` defines
local `RED`/`GOLD`/`GREEN` constants. There is no `StatusPill` and no `toneFor` anywhere in `src/`
(verified by grep).

**Value to Loush** — CAST's `toneFor` gives us one vocabulary across 16 top-level sections, and
specifically the **partial-success tone we do not have**. Their `includes('concern')` →
`DONE_WITH_CONCERNS` → amber rule (`cast-…:173`) is the exact shape of the `verdictFrom` gap above.
Fixing the vocabulary and fixing that null-verdict bug are the same piece of work.

**How the upstream repo does it today** — `src/components/StatusPill.tsx`, 57 lines
(`cast-…:166-173, 307-308`). A single `toneFor(status)` mapping a status *string* to one of five
tones, by substring match on a lowercased input:

- `live` (accent, **pulsing** dot) — running / in_progress / active / dispatched
- `success` (emerald) — done / completed / pass / ok
- `warning` (amber) — anything **containing** "concern", plus warning / retry / pending / queued
- `danger` (rose) — blocked / failed / error / abandoned / killed
- `neutral` (muted) — everything else

Two details make it good rather than merely tidy. First, **the pulse is reserved for `live` alone** —
so motion on the page always means "something is happening right now", and the eye learns it.
Second, `motion-reduce:animate-none` is honoured, so the pulse is not an accessibility liability.
The substring-match-before-exact-match ordering is what lets `DONE_WITH_CONCERNS` land on amber
rather than on `success` via the `done` rule — order matters and is easy to get wrong.

**How we implement it here** —

- New `src/ui/StatusPill.jsx` exporting `toneFor(status)` and a default `<StatusPill status=… />`.
  `toneFor` is copied verbatim in logic, including the concern-before-done ordering. Class maps
  become our CSS variables: `live` → `var(--accent)`, `success` → `var(--green)`, `warning` →
  `var(--amber)`, `danger` → `var(--red)`, `neutral` → `var(--text-secondary)`. Pulse via a
  keyframe in `styles.css` guarded by `@media (prefers-reduced-motion: reduce)`.
- Add `null`/`undefined` → a sixth rendering: **`—` with tone `neutral` and the title "no verdict
  recorded"**. CAST has no such case because their statuses come from a NOT NULL column. Ours come
  from `verdictFrom` returning null, and rendering that as neutral-grey-with-a-dash is our honesty
  rule at the component level.
- Extend `lib/run-verdict.mjs`: add a `DONE-WITH-FINDINGS` return between lines 12 and 13 for
  `done && blocking`, so the "finished but not clean" run stops reporting as running. This is a
  **behaviour change to a tested pure function** — `test/lib/run-verdict.test.mjs` exists and must
  be extended, not just kept green.
- Adopt in `RunsSection.jsx` (replacing the `VERDICT` map at :302), `ReliabilitySection.jsx`,
  `QualitySection.jsx`, `BoardSection.jsx`, `DeliverySection.jsx`, and the new Hooks wiring panel
  from feature 2. Migrate incrementally — the component is additive, so a half-migrated app is not
  broken, just inconsistent.
- No `App.jsx` change; no new dependency.

**Effort** — **S** for the component and `run-verdict` change; **M** if the migration of all
consumers is counted as one unit. Recommend shipping the component plus three consumers
(`RunsSection`, `HooksSection` wiring, `ReliabilitySection`) and treating the rest as follow-on.

**Risks and unknowns** —

- The `DONE-WITH-FINDINGS` verdict changes what `RunsSection.jsx:73` counts as "needs approval" and
  what `:255` offers for batch approval. Verify no run silently leaves the approval queue.
- Substring matching is greedy by nature. A status literally containing "error" inside a benign word
  would go danger. Low risk given our status strings are a closed set from `verdictFrom` and the
  eng snapshot, but the test should pin the precedence order explicitly.
- Windows: none.

**Definition of done** —

- `toneFor(null)` returns `neutral` and the pill renders `—`, not "unknown" and not a green tick.
- A run that is done with Critical findings renders `DONE-WITH-FINDINGS` in amber, not blank.
- Only `live` pills animate, and they stop animating under `prefers-reduced-motion: reduce`.
- At least three sections import the shared pill and define zero local status colour maps.
- `test/lib/run-verdict.test.mjs` gains a case for done+blocking+non-REQUEST_CHANGES asserting the
  new verdict, and a `toneFor` precedence test pins concern-before-done.

---

## 5. Roll subagent tokens into the parent session

**Customer need** — Ali runs a session that delegates almost everything to subagents — the normal
shape of work in this repo. He opens **Harness ▸ Sessions** and the row shows `$0.40` and 12k output
tokens for four hours of work. The real spend was ten times that, sitting in the subagent
transcripts. He concludes the ledger is broken, or worse, believes the number.

Verified in our code: `server/index.mjs:3030` filters `files.filter(f => !f.isAgent && …)` —
subagent files are **excluded from the session list entirely**, and their tokens are never added to
the parent. `isAgent` is set at `:709` as `f.includes('subagents')`. The subagent entries *are*
counted in the global totals (`collectUsage` pushes every file's entries into `all.entries` at
`:705`), so `/api/usage` totals and `/api/sessions` per-row sums **disagree with each other** by
however much was delegated. Both are rendered as fact.

**Value to Loush** — Fixes the most-viewed dollar figure in the app. Also a prerequisite for feature
3 being worth anything: per-session model attribution is meaningless when the models that did the
work are in files we skip. Lands in `SessionsSection`, `/api/roi` and the Overview cost tiles.

**How the upstream repo does it today** — `server/parsers/sessions.ts:90-137` (`cast-…:301-302`).
Walking `<session>/subagents/*.jsonl`, they add each child's `input`/`output`/`cache_creation`/
`cache_read` into the parent's totals, and count model occurrences across parent **and** children to
elect a **dominant model** by assistant-message frequency, with a `candidateModel` single-pass
fallback (the first model seen) added later as a performance fix.

**The detail that is actually worth the money** is a comment, not code: `analytics.ts:152-154`
explicitly notes that `agent_runs` costs are **not** added on top of the JSONL roll-up, because the
roll-up already includes subagent usage. Double-counting is the obvious trap and they hit it. Our
equivalent trap is `/api/usage`: if we roll subagent tokens into parents *and* keep pushing subagent
entries into `all.entries`, every global total doubles for delegated work.

**How we implement it here** —

- In `collectUsage()` (`index.mjs:657-716`), after the per-file loop, build a parent index. Our
  layout is `~/.claude/projects/<proj>/<sessionId>.jsonl` and
  `~/.claude/projects/<proj>/<sessionId>/subagents/<agent>.jsonl` — the parent session id is the
  **directory name two levels up** from a subagent file. Derive it with `path.sep`-based splitting
  of `path.relative(base, f)`, never a hardcoded `'/'`. This is the exact line CAST gets wrong
  (`sse.ts:138`, `_SYNTHESIS.md:367`).
- Add to each parent entry in `all.files`: `childCost`, `childOut`, `childIn`, `childCc`, `childCr`,
  `childMsgs`, `childCount`, plus a `rolled` boolean. **Keep `cost`/`out` as the parent's own
  figures** and add `costWithChildren` as a separate field. Two named numbers beat one ambiguous
  one, and it makes the double-count trap impossible to fall into silently.
- `/api/sessions` (`:3030-3047`): keep filtering `!f.isAgent` for row selection, but emit both
  `cost` (own) and `costTotal` (own + children) plus `subagents: <count>`. Totals at `:3048` sum
  `costTotal`.
- Leave `/api/usage` (`:720`) reading `all.entries` **unchanged** — it already counts every file
  exactly once, which is correct. Add a `node --test` assertion that
  `sum(files.costTotal for non-agent) === sum(all.entries costs)` so any future roll-up change that
  double-counts fails a test rather than shipping.
- Dominant model: add `dominantModel` per parent, elected by assistant-message frequency across
  parent + children, with the first-seen model as fallback. Surface it as a column in
  `SessionsSection.jsx` `COLS` (:17-22), which currently has no model column at all.
- Client: `SessionsSection.jsx` — a `Subagents` column and a `$` column that shows `costTotal` with
  the own-cost in the title attribute.

**Effort** — **S/M**. The roll-up is ~30 lines inside a function we already own. The M comes from
the double-count audit: `entryCost` is called at nine sites and every one needs checking against the
new fields.

**Risks and unknowns** —

- **Windows path derivation is the whole risk.** `path.relative(base, f).split(path.sep)` is already
  the idiom at `:665` and `:2309` — follow it exactly. A hardcoded `'/'` here produces silently
  empty roll-ups on Windows, which looks identical to "no subagents", i.e. it fails the honest way
  by accident and the dishonest way by design.
- Must verify the on-disk layout against a real `~/.claude/projects` tree before coding. Our
  `historyEvents` (`:900`) assumes `path.join(dir, sessionId, 'subagents')`, which supports the
  two-levels-up rule — but confirm there is no deeper nesting for nested subagents. If a subagent
  spawns a subagent, decide whether it rolls to the grandparent or the parent, and say which.
- Sessions whose parent transcript no longer exists (deleted, or the subagent outlived it) must be
  reported as orphans, not silently dropped and not attributed to an arbitrary parent.

**Definition of done** —

- A session that delegated 90% of its work shows a `$` figure within a few percent of the sum of its
  subagent transcripts.
- The Sessions total and the Usage total for the same window agree to the cent, asserted by a test.
- `subagents` renders `0` when the subagents directory exists and is empty, and `—` when the
  directory could not be read. **Unknown is not zero.**
- Orphaned subagent transcripts appear in a labelled "unattributed" total rather than vanishing.

---

## 6. Transcript contract guard

**Customer need** — Anthropic documents the transcript's location and layout and **zero field
names**; the SDK type is a deliberately opaque `[k: string]: unknown`, and issue #53516 asking for a
stable schema is open and unanswered (`_SYNTHESIS.md:100-102`). We read at least two dozen
undocumented fields: `message.usage.cache_creation_input_tokens`, `toolUseResult.structuredPatch`,
`toolUseResult.filePath`, `j.gitBranch`, `j.cwd`, `j.isMeta`, `j.attachment.hookName`,
`attachment.exitCode`, `c.input.subagent_type`, and more. Every parse in `collectUsage`
(`index.mjs:670-702`) and `scanTranscripts` (`:2323-2389`) is wrapped in a bare `try {} catch {}`.

When Claude Code renames one of those fields, nothing throws. The counters simply stop incrementing
and every chart in the app renders a confident **zero**. Ali sees "0 hook firings this week" and
concludes his hooks are idle. There is no signal that distinguishes "measured zero" from "the field
moved."

**Value to Loush** — This is the code-level enforcement of the honesty rules the whole product is
built on. `_SYNTHESIS.md:178-180` says never render a percentage without its denominator; this is
the same principle one layer down — never render a count without evidence the field it came from
still exists. The research calls it "the highest-leverage *idea* in the repo even though the literal
code doesn't transfer" (`cast-…:287`), and it is the one CAST idea that gets *more* valuable for us
than for them, because their source is a schema they control and ours is a format Anthropic
explicitly reserves the right to change.

**How the upstream repo does it today** — `server/utils/schemaGuard.ts` (`cast-…:94, 286`). A single
module declares `EXPECTED_SCHEMA` — every (table, column) pair any route reads, 16 tables — and
diffs it against `PRAGMA table_info` at boot, warning loudly on drift. A gating contract test
(`server/__tests__/schemaContract.test.ts`) asserts the same thing in CI.

The reasoning is the transferable part: **because every route wraps its SQL in try/catch, drift
would otherwise surface as a confidently-wrong zero on a card.** That is verbatim our failure mode,
arrived at independently. The v2.6.0 release exists largely to repair this coupling
(`cast-…:346`), so the guard is battle-scarred rather than theoretical.

The SQL does not transfer — we have no database. The declaration-plus-boot-check-plus-test triangle
does.

**How we implement it here** —

- New `server/contracts.mjs` declaring, as data, every external field we depend on, grouped by
  source and tagged with the reader:

  ```js
  export const TRANSCRIPT_CONTRACT = [
    { path: 'message.usage.input_tokens',  type: 'number', readBy: 'collectUsage',   required: true },
    { path: 'message.usage.cache_creation_input_tokens', type: 'number', readBy: 'collectUsage', required: true },
    { path: 'toolUseResult.structuredPatch', type: 'array', readBy: 'scanTranscripts', required: false },
    { path: 'attachment.hookName',         type: 'string', readBy: 'scanTranscripts', required: false },
    // …
  ]
  export const SETTINGS_CONTRACT = [ /* hooks, permissions, enabledPlugins */ ]
  export const CLAUDE_JSON_CONTRACT = [ /* mcpServers, projects */ ]
  ```

- `verifyContracts({ sampleLines, settings, claudeJson })` → `{ ok, missing: [...], seen: {...} }`.
  Sampling, not full scan: read the **last 500 lines of the three most recently modified
  transcripts** — enough to observe the common shapes, cheap enough for boot. A `required` field
  absent from all samples is drift; an optional field absent is merely unobserved and is reported
  as `unobserved`, not `missing`.
- Call it once inside the `app.listen` callback (`index.mjs:4771-4777`), next to the existing
  `engSnapshot` warm-up, and `console.warn` a loud block on drift — same place, same idiom.
- Expose `GET /api/contracts` returning the last verification result. Surface it in
  **Harness ▸ Governance** (`App.jsx:167`) as a "data contract" panel — that section already owns
  drift and approvals, so no new nav entry.
- `test/server/contracts.test.mjs`, in the style of `test/server/fe-workingset.test.js`, runs
  `verifyContracts` against a committed fixture transcript under `test/fixtures/`. This is the
  gating half: a fixture updated to a new format fails the test before it fails a user.
- No new dependency. Path resolution is the `getPath` reducer that already exists at
  `index.mjs:1347`.

**Effort** — **M**. The module and the boot hook are a day. Enumerating the fields honestly is the
real work — it means re-reading `collectUsage`, `scanTranscripts`, `readTranscript`, `failStats`,
`server/fe.mjs` and `server/memory.mjs` and writing down what each actually touches. That
enumeration has standalone value even before the guard runs.

**Risks and unknowns** —

- **Sampling can lie.** A field genuinely absent from three recent sessions (no hooks fired this
  week, so no `attachment.hookName`) is not drift. This is why `required` vs `optional` must be
  decided per field with care, and why the honest output for an optional field is `unobserved`. A
  guard that cries wolf gets muted, and a muted guard is worse than none.
- The contract is a second place to update when we add a reader. Mitigated by the test: adding a
  reader without a contract entry does not fail, but changing a field without updating both does.
  Accept that asymmetry rather than trying to auto-derive the contract from the source.
- Windows: none — pure string paths into parsed JSON. Use `os.homedir()`, which we already do.
- Scope discipline: this is a **warning** system. It must never block boot or degrade a response.
  If `verifyContracts` throws, the server logs and continues.

**Definition of done** —

- Renaming `cache_creation_input_tokens` in a fixture makes `test/server/contracts.test.mjs` fail
  with the field name in the message.
- Boot prints a single-line OK, or a multi-line block naming each missing field and its `readBy`.
- `GET /api/contracts` distinguishes **`missing`** (required, absent from all samples) from
  **`unobserved`** (optional, absent) from **`ok`**. The Governance panel renders those as three
  different things and never collapses them to a pass/fail tick.
- With no transcripts on disk at all, the panel reads "no transcripts sampled — contract not
  verified", not "0 problems".

---

## 7. Incremental tail reads for transcript parsing

**Customer need** — Every append to a transcript invalidates our per-file cache and forces a full
re-read of the file. `collectUsage` keys on `(mtime, size)` at `index.mjs:667` and on a miss does
`fs.readFileSync(f, 'utf8').split('\n')` at `:671` — the **entire file**, every time, for a
single appended line. `scanTranscripts` does the identical thing at `:2312` and `:2324`. A long
session produces a multi-megabyte JSONL; on the active session this happens on every 120-second
`/api/usage` TTL expiry (`index.mjs:103`), and on `/api/sessions`, `/api/roi`, `/api/forensics`,
`/api/flow` and `/api/search` behind their own TTLs.

Today Ali's symptom is that the Sessions and Working Set sections get slower the longer he works —
exactly backwards from what a session monitor should do — and the refresh chip in the topbar
(`App.jsx:421-428`) sits on "cached · Nm old" because recomputing is expensive enough that he does
not click it.

**Value to Loush** — This is the CAST half of `_SYNTHESIS.md` **Tier 2.2** ("Transcript cache:
`(mtime,size)` key + byte-range reads, truncation/compaction safe", credited to CCAM). We already
have the `(mtime,size)` key; what is missing is the byte-range read. It is also a hard prerequisite
for feature 8 — a watcher that full-reads on every append is worse than polling.

**How the upstream repo does it today** — `server/watchers/sse.ts:86-135`, `readTail` /
`readLastLine` (`cast-…:283-284`). `fs.openSync`, `readSync` starting at `size - maxBytes` with
`maxBytes = 256 KB`, then **discard the first line in the buffer** because it is almost certainly a
partial record — the offset landed mid-line. Fall back to a full read only when the tail contained
no parseable line at all (a single JSONL entry larger than 256 KB, which happens with big tool
results).

The research is blunt about why this matters: "this is the difference between a watcher that works
on a 40 MB transcript and one that pins a core."

**How we implement it here** —

- New `lib/tail.mjs` exporting `readTailLines(file, { maxBytes = 262144, fromOffset })`. Two modes:
  - **Tail mode** (CAST's) — last N bytes, drop the leading partial line, full-read fallback.
  - **Resume mode** (ours, and the better one for a cache) — given the previous cached `size`, read
    only `[prevSize, newSize)`. No partial-line ambiguity at the *start* because the previous read
    ended on a newline boundary; carry any trailing partial line in the cache record.
- Extend the `usageCache` record (`index.mjs:669`) and `scanCache` record (`:2315`) with
  `parsedTo: <byteOffset>` and `pending: '<partial line>'`, and bump the version tags (`v: 2` → `3`,
  `v: 3` → `4`) so stale records are discarded rather than misread.
- On a cache hit where `st.size > rec.parsedTo` **and** `st.size >= rec.parsedTo` held monotonically,
  parse only the delta and merge into the existing record. On any other change — size **shrank**, or
  mtime moved without size growing — fall back to a full re-read.
- **Compaction and truncation are the correctness case, not an edge case.** Claude Code compacts
  transcripts; a compaction rewrites the file and the size can shrink or grow with entirely
  different content. The shrink case is easy (size went down → full read). The dangerous case is a
  rewrite that lands on a *larger* size, where a delta read would parse garbage as new entries. Guard
  with a cheap fingerprint: store the first 256 bytes of the file in the cache record and re-read
  and compare them before trusting the delta. Mismatch → full read.
- No client change. No new dependency — `node:fs` `openSync`/`readSync`/`closeSync`.

**Effort** — **M**. `lib/tail.mjs` itself is S. The M is the incremental-merge logic in two
different cache records with different accumulator shapes (`collectUsage` sums scalars;
`scanTranscripts` pushes into capped arrays at `:2349`, `:2362`, `:2376` — those caps interact
badly with incremental appends and must be revisited).

**Risks and unknowns** —

- **The capped arrays are a real trap.** `scanTranscripts` caps `hookEvents` at 800, `edits` at 400,
  `cmds` at 400, `texts` at 400. Under a full re-read those caps take the *first* N of the file.
  Under incremental append they would take the first N ever seen and then silently stop — same
  numbers, different meaning, no visible change. Decide explicitly: either keep first-N (and
  document that incremental preserves it) or switch to last-N. Do not leave it accidental.
- Windows: `fs.readSync` with an explicit position is fine on Windows, but file locking is not. A
  transcript being written by a running `claude` process may be open with a share mode that makes
  a read fail with `EBUSY`. Our current `readFileSync` inside `try {} catch {}` swallows that today.
  The new path must swallow it identically and **fall back to the cached record**, not to zero.
- Must verify empirically that transcript appends are strictly append-only between compactions
  before enabling resume mode. Until verified, ship tail mode only. Write "unverified" in the code
  comment rather than assuming.

**Definition of done** —

- Appending one line to a 40 MB transcript causes a read of that line's bytes, not 40 MB — asserted
  by a test that spies on `readSync` byte counts.
- Truncating, rewriting, or compacting a fixture transcript produces the **same parsed result** as a
  cold full read, asserted by a test.
- A locked/unreadable file leaves the previous cached numbers in place and marks the file
  `stale: true` in the response, rather than contributing zeros.
- `/api/usage` totals are byte-identical before and after the change on a fixture corpus.

---

## 8. Filesystem change detector for live session state

**Customer need** — Ali kicks off a long agent run and switches to the dashboard. Nothing moves.
`ACTIVE_MS = 5 * 60_000` (`index.mjs:798`) means a session is "running" if its transcript was
touched in the last five minutes — a binary, five-minute-granularity guess. The only live plumbing
in the entire app is per-chat: `chats` Map, `chatBroadcast` and `GET /api/chat/:id/events`
(`index.mjs:866-875, 944-952`), which streams **only** sessions the dashboard itself spawned. A
session started in a terminal is invisible until a TTL expires and he clicks refresh. The client
polls `/api/inbox` on a 60s `setInterval` (`App.jsx:376`) and `/api/harness` on a 20s one
(`App.jsx:246`), which is the whole of our "live".

**Value to Loush** — `_SYNTHESIS.md:197-198` names this our weakest cluster. Note carefully what
this feature is and is not: the synthesis's Cluster A adoption order is *Stargx's status thresholds
→ CCAM's WebSocket+eventBus (Tier 2.4) → siteboon's `seq` replay → CCAM's hook receiver*. **CAST's
SSE transport is not on that list.** What CAST uniquely contributes is the **server-side change
detector over `~/.claude/projects`** — the thing that turns a file append into an event at all.
CCAM's transport carries events; CCAM's hooks are a different source. Neither watches the
filesystem.

So this feature is scoped to the **detector only**, emitting into an in-process event bus. Whether
that bus reaches the browser over SSE or CCAM's WebSocket is Tier 2.4's decision, and this must not
pre-empt it.

**How the upstream repo does it today** — `server/watchers/sse.ts` (`cast-…:112-118`). chokidar on
`PROJECTS_DIR` with `depth: 4`, ignoring `**/tool-results/**` and `**/node_modules/**`; on
add/change it reads only the file tail (feature 7) and broadcasts. Layered on top: a 30s per-file
idle debounce that, on expiry, scans the last 20 then 50 lines bottom-up for a terminal status and
otherwise emits `stale`; a 60s sweep marking sessions unseen for 8 minutes as `session_stale`; a 15s
heartbeat; and a **replay of the last 15 messages tagged `historical: true`** to every new
connection, so a second browser tab is not a blank screen (`cast-…:180`).

Their author's gotchas, all worth buying:

- Timers must be cleared on `SIGTERM`/`SIGINT` (`sse.ts:610-619`) or the process will not exit.
- `broadcast()` writes synchronously to every client with **no `res.writableEnded` check and no
  backpressure** — one stalled client blocks the loop (`cast-…:337`). Fix while porting.
- The SSE route hardcodes `Access-Control-Allow-Origin: http://localhost:5173` while the rest of the
  app honours `CORS_ORIGIN` — change the port and live updates silently stop (`cast-…:338`).
- The README claims exponential backoff reconnect; `useLive.ts:33` is a flat `setTimeout(connect,
  3000)` (`cast-…:102`). Do not repeat the claim.
- `sse.ts:138` splits paths on a hardcoded `'/'` — the Windows-breaking line.

**How we implement it here** —

- New `server/watch.mjs` exporting `startWatcher({ dir, onChange })` and a tiny `EventEmitter` bus.
  **No chokidar.** `fs.watch(dir, { recursive: true })` supports recursive mode natively on
  **Windows** and macOS (and Linux since Node 20) — our target platform is the well-supported one.
  This avoids a new dependency entirely, which matters given the "vendor, do not track" rule.
  Verify recursive support on our exact Node version before building; if it is unavailable, the
  fallback is a 3s `readdir`+`stat` sweep of the project directories, which is still cheaper than
  full-file re-reads and needs no dependency either.
- Debounce raw events (`fs.watch` fires 2-3 times per write on Windows) at 200ms per path. Ignore
  anything not ending `.jsonl`. Derive `{ proj, sessionId, isAgent }` from
  `path.relative(base, file).split(path.sep)` — the idiom already at `:665` and `:2309`. **Never
  `'/'`.**
- On change, use `lib/tail.mjs` from feature 7 to read only the delta and emit a typed frame:
  `{ type: 'session_changed', proj, sessionId, isAgent, at, lastEntry }`.
- Port the **idle-completion and staleness layer** with one change: CAST scans for
  `Status: DONE|DONE_WITH_CONCERNS|BLOCKED|NEEDS_CONTEXT`, which is a CAST agent-prompt convention
  and will never appear in our transcripts. Replace the regex with the honest test: a session with
  no new entry for N minutes emits `session_idle`, and **we do not claim it completed**, because
  transcripts carry no session-end record. CAST's explicit `stale` fallback — refusing to guess — is
  the part worth copying; the regex is not.
- Wire the bus to invalidate the server-side `respCache` (`index.mjs:110-121`) for the affected
  URLs. That alone is worth shipping before any transport work: the topbar chip stops saying
  "cached · 9m old" for data that changed nine minutes ago.
- **Stop at the bus.** Do not add a `/api/events` route in this feature. Tier 2.4 chooses the
  transport. If SSE wins, the existing `chatBroadcast` pattern (`:871-875`) is the template, plus
  the fixes above: `res.writableEnded` guard, 15s heartbeat, replay-last-N tagged `historical`,
  and real exponential backoff **with jitter and a cap** on the client — which CAST claims and does
  not have.
- Client: none in this feature.

**Effort** — **L**. The watcher itself is S/M, but it is the first long-lived background process in
this server and brings a class of problems we have never had: lifecycle, shutdown, debounce
correctness, cache-invalidation fan-out, and a test story for something asynchronous and
filesystem-dependent. It also depends on feature 7 to be worth doing. Ship 1-7 first.

**Risks and unknowns** —

- **`fs.watch` recursive on Windows has known quirks**: it can miss events under heavy churn, it
  reports the changed path relative to the watched directory (not absolute), and on some volumes
  (network shares, some virtualized filesystems) recursive mode silently does nothing. Must be
  verified on the user's actual `~/.claude` location. If it proves unreliable, the sweep fallback is
  the answer — **not** adding chokidar, which has the same underlying OS limitations plus a
  dependency.
- The watcher makes `node --watch server/index.mjs` (our `npm run dev` script) restart-happy if it
  ever writes into a watched directory. It must not write anything.
- Handle count: watching `~/.claude/projects` recursively on a machine with years of transcripts may
  exceed OS limits. Measure before shipping; scope the watch to directories modified in the last N
  days if needed.
- Contradicts nothing on the do-not-adopt list, but **do not let this grow into CAST's SSE page**.
  The moment it starts carrying `agent_spawned` / `routing_event` / `db_change_*` frames, it is
  reimplementing a CAST view for a database we do not have.

**Definition of done** —

- Appending to a transcript emits exactly one `session_changed` frame within 500ms, on Windows.
- The relevant `respCache` entries are invalidated, and the topbar staleness chip reads "fresh"
  after a background change without a manual refresh.
- Deleting a transcript emits a removal frame and does not throw.
- `SIGINT` exits the process cleanly with no lingering timers or watchers.
- Sessions with no new entry for the idle window are reported as **`idle`**, never as `complete` or
  `done` — because nothing on disk says a session ended.
- With `~/.claude/projects` absent, the watcher logs once and stays dormant; no section renders a
  "0 live sessions" tile. It renders "watcher not started — no projects directory".

---

## Not worth taking

**`parseTimestamp` (`src/utils/time.ts:12-18`)** — CAST's three-line regex converts SQLite's
space-format `'2026-07-02 18:54:34'` to ISO `'…T…Z'`, and their CHANGELOG credits it with fixing a
whole bug class (`cast-…:304-305`). **We have no SQLite and no space-format timestamp source.**
Transcripts carry ISO-8601 with `T`, and we otherwise use `mtimeMs` numbers. The literal function
solves a problem we do not have. The *audit* it implies is real — `index.mjs:742`
`dayOf = t => new Date(t).toISOString().slice(0, 10)` buckets by **UTC** day and feeds the daily
series, the streak, the anomaly detector and the month-end projection, so anyone west of UTC sees
their evening work land on tomorrow. But that is a different bug (local-vs-UTC, not format), and it
is already owned as `_SYNTHESIS.md` **Tier 1.8** (`localISODate()`, credited to phuryn, "we have the
`toISOString()` TZ bug in ≥3 places"). Adopting CAST's function would not fix it. Do Tier 1.8.

**Parent-agent attribution via `promptId` (`sse.ts:210-249`, research #12)** — CAST waits 200ms
after a subagent transcript appears, reads its `promptId`, then scans sibling files' first 100 lines
for a match. Their own research calls the sleep "a race-condition band-aid" and the scan
`O(files × 100 lines)` per spawn. **We already solve this properly**: `index.mjs:900-905` reads the
`.meta.json` sidecar's `toolUseId` and matches it against the parent's `Task`/`Agent` tool-call `id`
collected at `:897-898`. That is an explicit link written by Claude Code, not a heuristic. Porting
CAST's version would be a downgrade.

**`server/parsers/workLog.ts` (research #15)** — parses `## Work Log` markdown sections into
`{items, filesRead, filesChanged, decisions, codeReviewerResult, testWriterResult}`. The parser is
fine; the input does not exist. `## Work Log` is a CAST agent-prompt convention, produced because
CAST's own agents are instructed to emit it. Nothing in our harness writes it. Porting it gives us a
function that returns empty for every file on disk — the exact "port a page, not a primitive"
failure `_SYNTHESIS.md:343` warns about. If we later want a self-reported `filesChanged` cross-check
for WorkingSet, the cheaper route is our own `structuredPatch` extraction, which is already there at
`index.mjs:2354-2362` and is ground truth rather than self-report.

**Delegation savings in dollars (`analytics.ts:233-310`, research #13)** — re-prices haiku sessions
at sonnet rates and reports the difference as savings. Their guard (excluding opus/sonnet sessions
so the baseline never exceeds actual) is honest, but the metric remains a **counterfactual**: it
assumes the haiku work would have succeeded identically on sonnet. `_SYNTHESIS.md:174-180` documents
exactly this failure mode — context-mode's displayed savings went 0% → 56% → 95.4% on identical data
purely from formula changes. We already carry one such number and label it brutally
(`SessionsSection.jsx:89-92`: "an estimate × an estimate against a counterfactual that never
happened, that only ever goes up"). Adding a second is moving the wrong way. The **haiku utilisation
percentage** half is a real measurement, but it is one number and does not justify the port.

**The SQLite explorer, agent reliability tables (7 anomaly types), eval-harness view, executive
summary, quality gates, incidents, routines and injection log** — all require `cast.db`, all on the
do-not-adopt list at `_SYNTHESIS.md:343`. Not evaluated further.

**`src/utils/agentPersonalities.ts`** — 18 KB of 8×10 pixel-art sprites and taglines. The research's
own verdict is "charming, zero information value" (`cast-…:469`). Agreed.

**Global search + cmdk command palette (research #10)** — genuinely better than what we have, but
out of scope for this spec: it is not in the CAST contribution list I was assigned, we already ship
`src/ui/Palette.jsx` wired at `App.jsx:450`, and `cmdk` would be a new dependency. Worth a separate
evaluation against our existing palette rather than a port.

**Rate limiting (`express-rate-limit`)** — a new dependency to solve a problem the control gate
(feature 1) already closes for a single-user localhost app. Revisit only if we ever bind non-loopback
deliberately.

---

## Open questions for the maintainer

1. **Loopback bind vs. deliberate LAN access.** Feature 1 assumes the dashboard should be loopback
   only. Do you ever open it from your phone or a second machine on the same wifi? If yes, the gate
   still ships but the bind stays open and the token becomes mandatory rather than optional.

2. **Default for `DASH_CONTROL`.** Shipping `on` by default is the safe choice and adds a handshake
   step to a tool that currently needs zero setup. Shipping `off` by default preserves the
   experience and protects nobody until someone reads the docs. I have specced `on`. Confirm.

3. **`~/.claude/projects` subagent layout.** Feature 5 derives the parent session id as the
   directory two levels above a `subagents/*.jsonl` file, inferred from `index.mjs:900`. Does a
   subagent that spawns its own subagent nest deeper? If so: does its cost roll to its immediate
   parent or to the root session? I could not resolve this from the code.

4. **`attachment.hookName` ↔ `settings.json` command join.** Feature 2's failure count depends on
   matching a hook execution attachment back to the specific configured hook. I could not verify
   from the code alone whether `hookName` (`index.mjs:2343`) carries enough to identify *which*
   `hooks[event][i].hooks[j].command` fired, or only the event and tool. If it is only the event,
   the wiring panel shows failures per event and `null` per hook. Which do you prefer?

5. **Capped arrays under incremental parsing.** `scanTranscripts` caps `hookEvents` at 800, `edits`
   at 400, `cmds` at 400, `texts` at 400 (`index.mjs:2349-2376`). Under a full re-read those are the
   *first* N in the file. Feature 7 changes when the cap is hit. Should incremental parsing preserve
   first-N (matching today's behaviour) or switch to last-N (more useful, changes existing numbers)?

6. **CAST licensing.** CAST has no `LICENSE` file — `license: null`, `/license` 404, MIT is a static
   badge only (`_SYNTHESIS.md:147`). The synthesis recommends asking the author to commit a real MIT
   LICENSE so provenance does not rest on a private email thread. Has that email been sent? Every
   ported file here will carry a provenance header either way; I need to know what it should say.

7. **`fs.watch` recursive on this machine.** Feature 8's no-new-dependency argument rests on
   `fs.watch(dir, { recursive: true })` working against your actual `~/.claude` path on Windows.
   If that directory lives on a network share or a virtualized volume, recursive watching may
   silently do nothing. I could not test this from here — it needs one 10-line script run on the
   target machine before feature 8 is scheduled.

8. **Sequencing against Tier 0.** Features 3 and 5 both touch cost numbers, and `_SYNTHESIS.md`
   Tier 0.1 (dedupe by `message.id`+`requestId`) and Tier 0.2 (corrected rates) touch the same code
   at `index.mjs:681` and `:718`. Landing them independently means three separate changes to the
   same twenty lines and three separate "the dollar figures moved" moments. Recommend batching
   0.1 + 0.2 + feature 3 + feature 5 as one cost-correctness release with a single changelog entry.
   Confirm that is acceptable.
