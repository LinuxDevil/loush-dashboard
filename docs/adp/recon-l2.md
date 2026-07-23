# Recon — L2 wiring (Gap 1: per-run verdict · Gap 2: batch approve)

Read-only recon. Maps `docs/adp/level-2.md` §4 gaps 1 & 2 to exact touchpoints.

## 0. Key surprise / architecture note

There are **two independent "run" universes** in the backend, and they must not be confused:

1. **Task Board tickets** — in `server.mjs` `readBoard()/writeBoard()` state. This is where the
   *review severity gate*, the *3-cycle auto-fix cap → Blocked*, and the *QA AC/test gate* the
   task description references actually run:
   - Review state/findings: `server.mjs:530` (`state = 'Approved'` etc.), findings on `t.findings`.
   - QA gate: `POST /api/board/tickets/:id/qa` `server.mjs:4197`; results on `t.qaResults` (`server.mjs:4230`), AC/test cases with `pass`/`severity`; failed cases auto-file bug sub-tickets (`server.mjs:4231-4241`).
   - 3-cycle cap: enforced in the **loush orchestrator contract** (see §3 below), tracked in
     `state.json.retries`, surfaced as `phase_status: "blocked"`.
   - Analytics already aggregate these per ticket: `/api/board/analytics` `server.mjs:4326`.

2. **Loush runs** — filesystem `.loush/<ticket>/` (`state.json` + `events.jsonl` + `review.json`
   + `approvals.json`) scanned across every known repo. **This is what `RunsSection.jsx` renders
   and what `/api/runs/approve` targets.** `level-2.md` §4 gap 1 explicitly says the verdict goes
   "per run in `/api/runs`", so **the verdict must be computed on the loush-run object, not the
   board ticket.** All the gate inputs needed are present in the loush run dir (see §2).

The two are not wired together today. The verdict work lives entirely in the loush-run path.

## 1. Runs subsystem — file:line map

Backend (all in `/Users/ali.mohammad/learnspace/loushai/dashboard/server.mjs`):

| Concern | Location |
|---|---|
| `projectDirs()` — which repos are scanned | `server.mjs:4396` |
| `loushSafe()` path-traversal guard | `server.mjs:4401` |
| `readEvents()` events.jsonl parse + cache | `server.mjs:4410` |
| `runDir(proj, ticket)` | `server.mjs:4423` |
| **`scanRuns()` — builds the run object** | `server.mjs:4429-4458` |
| `joinRunCost()` — time-window cost estimate | `server.mjs:4461` |
| **`GET /api/runs`** — list + filters (proj/flow/status/ticket) | `server.mjs:4472-4482` |
| `GET /api/runs/events` — tail after `seq` | `server.mjs:4483` |
| `GET /api/runs/artifact` — read one artifact file | `server.mjs:4488` |
| **`POST /api/runs/approve`** — writes `approvals.json` | `server.mjs:4496-4502` |

Frontend:
- `src/RunsSection.jsx` (175 lines) — list, KPIs, per-run Detail + Approval.
- `src/runMetrics.js` — `deriveRunMetrics(events)` (client-side; derives steps/status/`decision`/`findings` from events).
- `src/InboxSection.jsx` — attention queue; blocked runs surface as `/api/inbox` rows (kind `run`), actions are open/snooze/clear/nudge only — **no approve action in the inbox today.**
- `src/api.js` — thin `api.get/post` fetch wrapper; no run-specific helpers.

## 2. The run object shape (output of `scanRuns()`, `server.mjs:4447-4454`)

```
{ proj, projName, ticket, flow, phase, phaseStatus, retries, headSha,
  updatedAt, events (count), startedAt, endedAt, status, hasReview,
  awaitingApproval, cost }
```

- `status` ∈ `running | completed | failed | blocked | unknown`
  (derived at `server.mjs:4444-4446`: terminal event `run.completed`/`run.failed` wins, else
  `phase_status`, else running/unknown).
- `awaitingApproval` = `phase_status === 'blocked' && !exists(approvals.json)` (`server.mjs:4453`).
- `hasReview` = `exists(review.json)` (`server.mjs:4452`).

Source artifacts (schemas from the loush contract, `/Users/ali.mohammad/.claude/agents/loush-orchestrator-contract.md`):

- **`state.json`** (§11, contract:160-174): `phase` (qualify|decompose|implement|verify|pr-review|fix|test|done),
  `phase_status` (running|passed|failed|blocked), `retries` (per-phase int map), `sub_tickets[]`, `head_sha`.
- **`events.jsonl`** (§13, contract:181-205): terminal `run.completed`/`run.failed` carries
  `data:{ status, phases_passed, phases_failed }`; `step.completed` may carry `data:{ decision, findings }`.
- **`review.json`** (§14, contract:212-231): `decision` (APPROVE|REQUEST_CHANGES|COMMENT),
  `findings[].severity` (Critical|Required|Optional|Nit|FYI) — **Critical & Required block; Optional/Nit/FYI do not.**
- **`approvals.json`** (§16, contract:263-266): `{ artifact, decision(approve|revise), comments[] }`.
- **Retry caps** (§15, contract:246-254): build⇄verify **max 3** → STOP + `docs/TICKET-ID/gaps.md` + escalate; resolve-PR **max 5**. Cap-hit leaves `state.json` at the failing phase.

**All three gate signals for a verdict are available in the run dir without touching the board:**
review.json (severity findings), phase_status/terminal event (pass/fail + the 3-cycle→blocked
cap), approvals.json (already-decided). QA/AC coverage lives in `docs/TICKET-ID/*-done.md`
completion blocks (`ac_covered`/`ac_not_covered`, contract:233-239) and `test-cases/test-plan.md`
— reachable via `runDir` but secondary; the primary verdict inputs are review + phase_status.

## 3. GAP 1 — Aggregated per-run verdict

**Compute in `scanRuns()`** where the run object is already assembled (`server.mjs:4447-4454`).
Add one helper and one field; `GET /api/runs` needs no change (it just forwards the object).

Proposed `verdict` ∈ `PASSING | BLOCKED | NEEDS-HUMAN`:

- **NEEDS-HUMAN** — `awaitingApproval` (converged to a gated artifact awaiting sign-off — the promote gate).
- **BLOCKED** — terminal `run.failed`, or `phase_status === 'failed'`, or a retry counter at/over its
  cap (build/verify ≥ 3, resolve-pr ≥ 5) left at a failing phase, or `review.json.decision ===
  'REQUEST_CHANGES'` with any Critical/Required finding and no further auto-fix budget. Terminal dead state.
- **PASSING** — terminal `run.completed` (data.status ok) or `phase === 'done'`/`phase_status === 'passed'`,
  AND (no review.json OR `decision === 'APPROVE'` OR zero blocking findings), AND no cap hit. Promotable.
- Fall through to the existing `status` when signals are absent (e.g. `running` → no verdict yet / `null`).

Minimal change:
1. Add `computeVerdict(dir, state, events, term)` helper near `server.mjs:4429`; read `review.json`
   (parse `decision` + count blocking findings), inspect `state.retries` vs caps, `term`, `awaitingApproval`.
2. Add `verdict: computeVerdict(...)` to the pushed run object at `server.mjs:4447`.
3. (Optional) accept `?verdict=` filter in `GET /api/runs` `server.mjs:4475-4480` (mirror the `status` filter).
4. Frontend: show a verdict badge in the run row (`RunsSection.jsx:159-166`, next to `r.status` at :164)
   and a verdict KPI tile (`Kpis`, `RunsSection.jsx:37-46`). Add a color map alongside `STATUS`
   (`RunsSection.jsx:11`).

## 4. GAP 2 — Batch approve

Today (`server.mjs:4496-4502`): `POST /api/runs/approve` takes `{ proj, ticket, decision, comments,
artifact }` and writes one `approvals.json` into `runDir(proj, ticket)`. Strictly one-at-a-time.
Frontend caller: `Approval.decide()` `RunsSection.jsx:57-60`; the artifact name is derived from
`run.flow` at `RunsSection.jsx:52` (`test-cases`/`jira-implement` → `test-plan`, else `review`).

Minimal change:
1. **Backend** — add `POST /api/runs/approve-batch` beside `server.mjs:4502`, body
   `{ runs: [{ proj, ticket, artifact }], decision, comments }`, looping the exact existing write
   (`fs.writeFileSync(path.join(runDir(...), 'approvals.json'), ...)`). Return per-run ok/error.
   (Even cheaper: fan out client-side over the existing single endpoint — no new route. Trade-off:
   N requests vs 1. Recommend the batch route for atomic UX + one toast.)
2. **Frontend (`RunsSection.jsx`)** — the natural home (Inbox has no approve action):
   - Add `selected` Set state in `RunsSection()` (near `RunsSection.jsx:122-124`).
   - Add a checkbox to each run row (`RunsSection.jsx:157-166`), shown when the run is approvable
     (`r.awaitingApproval`, i.e. verdict `NEEDS-HUMAN`).
   - Add an action bar above `runs.map` (insert around `RunsSection.jsx:153`, after the filter pills):
     **"✓ Approve all converged"** button that selects/acts on every run with
     `verdict === 'NEEDS-HUMAN'` (or `r.awaitingApproval`), deriving each `artifact` name with the
     same rule as `RunsSection.jsx:52`, POSTs the batch, then `load()`.
   - Reuse the artifact-name derivation from `Approval` (`RunsSection.jsx:52`) — factor it to a
     module-level `artifactName(flow)` so both the single and batch paths share it.

## 5. Minimal change plan (order)

1. `server.mjs` — `computeVerdict()` + `verdict` field in `scanRuns()` (Gap 1 backend). ~25 lines.
2. `server.mjs` — `POST /api/runs/approve-batch` (Gap 2 backend). ~10 lines.
3. `RunsSection.jsx` — verdict color map + badge + KPI; `artifactName(flow)` helper; row checkbox +
   "approve all converged" action bar wired to the batch route (Gaps 1 & 2 frontend).
4. (Optional, Gap 6 follow-on) surface `verdict === 'BLOCKED'` runs into `/api/inbox` as severity rows.

No new dependencies. No schema files to add (loush contract §14 is the schema authority). `.loush`
sample dir at `/Users/ali.mohammad/workspace/ct-web-transport/.loush` exists but was empty at recon
time — shapes taken from the contract, which the server code already matches.
