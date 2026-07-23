# ADP Level 3 — Humans as Orchestrators

> Roadmap detail for the dashboard app. Input: `feature-map-backend.md`, `feature-map-frontend.md`.
> Level 3 is the level this platform is **closest to reaching but has not built** — the substrate
> exists, the autonomy loop (Gap B) does not.

---

## 1. What Level 3 means here

At Level 3 the human stops supervising one batch of work at a time and instead **orchestrates a fleet
of agents that run unattended over time**. Long-running tasks and bug fixes execute in the background —
kicked off on a **schedule** (cron/launchd cadence) or **triggered by an incoming ticket** — implement
and validate themselves through the golden path, and surface only when a human decision is required. The
human's job shifts from "run this task now and watch it" (Level 2) to "curate a queue, set the cadence,
and approve at the gates" — watching an Inbox, not a terminal.

Concretely for this app, L3 = the **Dispatch Work** stage (triage a JIRA ticket into a runnable unit of
work) and **Issue Remediation** stage (a reported bug becomes a fix) both firing **without a human
clicking Start**, feeding long-lived **Implement → Validate** loops whose outcomes land in the **Inbox**.

---

## 2. Which existing features already serve L3 (partial)

Most of L3 is **NOT built** — every existing "run" in the platform is human-triggered. What exists today
is the *substrate* a scheduler would drive, plus one genuinely event-triggered surface (CI). Being honest:
nothing here runs itself on a cadence yet.

**Dispatch substrate (manual today):**
- **`server-eng.mjs`** — `/api/eng/triage` (+dismiss), `/api/eng/ticket/:key/generate` and `/transition`
  already turn a JIRA ticket into a triaged, generatable, transitionable unit of work and write back to
  JIRA. This is the Dispatch primitive — it just waits for a human to invoke it.
- **`career-import-jira.mjs`** / **`career-import-github.mjs`** — quarantined ingest of JIRA issues and
  GitHub PR/review footprint into the snapshot shape. The intake half of Dispatch.
- **Workflows → Task Board** (`BoardSection`) — paste JIRA → **✂ analyze** proposes editable sub-tickets
  via real `claude -p`; **▸ Start** creates an isolated worktree branch and runs a headless dev agent.
  This is the Dispatch→Implement hand-off — but Start is a button, not a trigger.

**Implement / Validate loop substrate (manual triggers):**
- **Workflows → Task Board** review/QA/release chain — review agent returns severity-tagged findings with
  an **auto-fix loop capped at 3 → Blocked**, clean review auto-provisions a preview env, QA agent derives
  AC + test cases, executes, and **auto-files failing cases as linked bug sub-tickets**. The Implement/
  Validate loop already exists and already self-remediates within a run; it is only ever *started* by hand.
- **Loush Runs** (`RunsSection`) + `server.mjs` `/api/runs`, `/api/runs/events`, `/api/runs/artifact`,
  `POST /api/runs/approve` — run history, an event stream, artifact capture, and an approval gate. This is
  the monitoring + gating spine a fleet would report into.
- **Reliability → CI eval gate** — the one genuinely **event-triggered** piece: generates CI config that
  runs the eval suite headlessly on PRs touching `.claude/`, merge-blocking below a threshold. Unattended
  validation already happens here, driven by a PR event rather than a human.

**Remediation substrate (manual today):**
- **Workflows → Bugs** (`BugsSection`) — paste trace/log/link → auto-extract frames, **auto-bisect**,
  regression-test generator, copyable `gh pr create`. The Issue Remediation engine — minus the trigger.
- **`career-analyze.mjs`** (spawns `claude -p` coaching), **`career-heuristics.mjs`** (focus items),
  **`career-lessons.mjs`** (harvest→distill→graduate improvement checks), and `server.mjs` `/api/gov/recs`
  — produce recommended next actions. Remediation *advice*, not yet remediation *execution on a cadence*.

**Fleet view (built, waiting for a fleet):**
- **Inbox** (`/api/inbox/done`, digest + notifications, 60s poll, desktop/Slack) — explicitly documented as
  "the designated **fleet view** for future scheduled runs (**Gap B target**)." The destination is built;
  nothing schedules work into it yet.
- **`career-digest.mjs`** — deterministic weekly digest, explicitly "**no cron (scheduler gated)**." A
  cadence-shaped output blocked on the missing scheduler.

---

## 3. Layer coverage (present vs missing)

### Tooling Layer
| Component | Present | Missing for L3 |
|---|---|---|
| Dev Control Plane | `server.mjs` (`actions/run`, team orchestration, `runs/approve`), Task Board, Bugs | A **scheduler/trigger surface** that dispatches without a human click |
| Integration / Delivery (CI-CD) | Reliability CI eval gate (event-triggered), `eng/ticket/transition`, `team/pr request-review` writeback | Ticket/webhook → run enqueue; auto-open PR at end of an unattended run |
| Resource Plane | Task Board **worktree per run**, preview-env auto-provision, spawned `claude -p` | Durable worker pool / concurrency limits for many concurrent long-lived runs |
| Quality & Security | Reliability evals, Quality (analytics + design drift), Hooks (policy), review/QA gates | Gate policy applied **automatically** to unattended runs (dry-run + approval before writeback) |
| Observability | Inbox (fleet view), Loush Runs + `runs/events`, Forensics, Overview | Per-scheduled-run status/health rollup; "what did the fleet do overnight" view |

### Path Definitions Layer (Dispatch → … → Remediate)
- **Dispatch** — primitives present (`eng/triage`, `eng/ticket/generate`, Board paste-JIRA + analyze),
  **manual only**. Missing: the trigger.
- **Retrieve** — fully present (eng snapshot, atoms/constitution, memory, career-import-*). Not the gap.
- **Implement** — present as headless dev agent in a worktree, **manual Start**. Missing: unattended launch.
- **Validate** — strongest present layer (CI eval gate is already event-driven; review/QA auto-fix loop
  capped at 3). Missing: same gates auto-applied to scheduled runs.
- **Promote / Deploy** — `runs/approve`, `gov/rollback`, `ticket/transition`, PR writeback present.
  Missing: auto-advance through these under an approval policy.
- **Observe** — Inbox / Loush Runs / Forensics present.
- **Remediate** — Bugs engine + lessons + recs present, **manual only**. Missing: bug event → auto-run.

### Agent Infrastructure Layer
- **Harness — context / capability / execution / evaluation**: context (Memory, Constitution, Atoms),
  capability (Capabilities Hub + ROI), execution (headless `claude -p`, worktrees, Loush Runs), and
  evaluation (Reliability, evals) are all present. **The one missing harness piece is the *execution
  runtime for unattended, long-lived, scheduled runs*** — durability, retry, and cadence.
- **Governance — identity / security / observability**: identity resolution, Governance/Config, Team
  baseline, Hooks policy, and the two hard product rules are present. Missing: a **per-scheduled-run audit
  trail and identity** (which cadence/trigger launched this run, under whose authority) and enforcement that
  every unattended writeback passes the approval gate.

---

## 4. Gaps to fully own L3 (cheap-first)

The center of gravity is **Gap B — Autonomy/cadence**: the **Scheduler → Inbox loop**. Everything below is
sequenced cheapest-first, reusing what already exists rather than building new runtime.

**Gap 1 — Scheduler → Inbox loop (Gap B core). CHEAPEST.**
Reuse **cron/launchd + `claude -p`** (already the roadmap's Phase 2 plan). A launchd/cron entry runs a
triage prompt on a cadence, writes results as Inbox items. The Inbox already polls every 60s and already
notifies — **no new UI required** beyond surfacing "scheduled run" items. `career-digest` is already
"scheduler gated," so it becomes the first cadence output. Deliverable: one job + a writer that appends to
the Inbox store. This alone moves the platform from L2 to the threshold of L3.

**Gap 2 — Background execution runtime.**
Today a "run" lives only as long as the Task Board Start invocation. Add a thin **durable job layer** over
the existing `/api/runs` + `runs/events` spine: a queue, a worker that launches the existing headless dev
agent in its worktree, status/retry, and concurrency caps. Cheap because the agent, worktree, event stream,
and approval endpoint already exist — this is persistence + a loop around them, not new agent logic.

**Gap 3 — Ticket-triggered dispatch.**
`server-eng.mjs` already fetches/caches JIRA on a 2h TTL and exposes `/api/eng/refresh` + `/api/eng/triage`.
Wire triage output into the scheduler (Gap 1) so a **new/changed ticket enqueues a run** (Gap 2) instead of
waiting for a human to paste it into the Board. Cheapest form: poll on the existing refresh cadence and diff;
a webhook is the later upgrade. Reuse `eng/ticket/generate` for the sub-ticket breakdown.

**Gap 4 — Unattended remediation.**
The Bugs engine (auto-bisect, regression-test, `gh pr create`) and the Task Board review/QA auto-fix loop
(capped at 3 → Blocked) already self-heal *within* a run. Let a **bug/CI-red event trigger** them without a
click. Must run behind the two hard product rules and the approval gate: **never auto-send a nudge — always
copy-for-human**; **never ingest another engineer's transcripts**; every JIRA/GitHub writeback goes through
`runs/approve` / `gov/dryrun` first. Unattended means *unattended up to the gate*, not unsupervised shipping.

**Cross-cutting — per-run governance.**
Extend Governance/identity so each scheduled or triggered run carries **which trigger launched it and under
whose authority**, and record it in the run audit trail. Cheap to add alongside Gap 2's job records.

---

## 5. Exit criteria — graduate to Level 4

L3 is **owned** (and L4 — agents self-directing the fleet — becomes the next frontier) when all hold:

1. **Cadence is real**: scheduled `claude -p` runs fire on cron/launchd and reliably land in the Inbox;
   `career-digest` and a daily triage run are live on a schedule, not gated. (Gap B closed.)
2. **Ticket → run is unattended**: a new/changed JIRA ticket auto-dispatches (triage → sub-tickets →
   worktree → headless implement) with **no human Start**; the human appears only at the approval gate.
3. **Runs are durable**: long-lived background runs survive, retry, report status, and honor concurrency
   caps — the fleet keeps working across restarts, visible in Loush Runs / Inbox.
4. **Remediation closes the loop unattended**: a reported bug or red main triggers auto-bisect →
   regression test → proposed fix → PR-ready, stopping at the approval gate.
5. **Governance holds under autonomy**: every unattended writeback passes dry-run/approval; each run has a
   trigger identity and audit trail; the two hard rules (copy-for-human nudges, no foreign transcripts) are
   enforced structurally, not by convention.
6. **Human orchestrates a fleet, not a task**: the daily interaction is triaging the Inbox queue and
   setting cadence/policy — supervising many concurrent runs, never one terminal.

**Boundary to L4**: at L3 the *human* still decides what enters the queue and approves each gate. L4 begins
when agents **self-select and self-prioritize** what to work on (choosing tickets, spawning sub-fleets,
tuning their own cadence) with the human moving from orchestrator to policy-setter.
