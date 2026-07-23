# ADP Level 2 — Human-on-the-Loop

*Parallel agent execution coupled with automated validation pipelines.*

---

## 1. What L2 means for this platform

At Level 2 the human stops driving each step and starts **supervising a batch**. Multiple
agents run concurrently — each in its own isolated git worktree branch — and every unit of
their output is pushed through a **deterministic (or hybrid) validation gate** before a human
ever looks at it. The human's job shifts from *authoring* to *approving*: they watch a fleet of
in-flight runs, and they act only when a gate blocks, a budget is exceeded, or a run converges
and asks for promotion.

Concretely, L2 is the **"Validate Change" hybrid path**: an agent submits work → the change
hits a deterministic gate (build, lint, eval suite, AC check, review severity threshold) →
the agent iterates against the gate's machine-readable verdict until it converges or hits a
cap → only then does the change surface to a human for a promote/reject decision. The gate,
not the human, is in the fast loop.

This is distinct from L1 (Human-in-the-loop), where the human approves each agent step
inline. At L2 the human is *on* the loop, not *in* it — present, notified, able to intervene,
but not required for forward progress within a run.

---

## 2. Existing features that already serve L2

The platform already ships a near-complete L2 spine. The strongest evidence:

### Parallel agent execution (the "multiple agents at once" half)

- **Workflows Hub → Task Board** (`BoardSection`, `server.mjs` `/api/actions/run`, `/api/runs`,
  `/api/runs/events`): the flagship loop. **▸ Start** *"creates an isolated git worktree branch +
  runs a headless dev agent"*. Each ticket becomes its own worktree + headless `claude` process,
  so N tickets = N agents running in parallel with no shared-index contention. **✂ analyze**
  splits a pasted JIRA ticket into editable sub-tickets (real `claude -p`), which is exactly the
  fan-out that feeds parallel execution.
- **Loush Runs** (`RunsSection`, `/api/runs`, `/api/runs/events`, `/api/runs/artifact`):
  run-history + live monitoring — the batch supervision surface. `runs/events` is an event stream
  the human watches rather than steps through.
- **Team agent orchestration** (`server.mjs` `/api/team`, `/api/team/agent`, `/api/team/message`,
  `/api/team/interrupt`, `/api/team/plan`, `/api/team/shutdown`): multi-agent messaging,
  interrupt, and shutdown — the primitives for driving a batch of agents and cutting one off
  mid-flight.
- **Squad Designer** (`TeamDesigner`, Labs): compose a multi-agent squad (per-member model, agent
  type, IO contracts, tasks, skills, MCP), with **✦ AI review** scoring each member and deriving
  IO contracts + a collaboration map. This is the *design-time* face of parallel execution — how a
  batch of cooperating agents gets specified before launch.

### Automated validation pipelines (the "deterministic gate" half)

- **Workflows Hub review/QA/release gates** (`BoardSection`): after **▸ Start**, the review agent
  *"returns severity-tagged findings (auto-fix loop capped at 3 → Blocked)"* — a **hybrid gate with
  a convergence cap**, the exact L2 iterate-until-converge behavior. A clean review
  *"auto-provisions a preview env"*; the QA agent *"derives AC + test cases, executes, and auto-files
  failing cases as linked bug sub-tickets"* — automated validation that closes the loop by creating
  new work items, no human authoring required.
- **Reliability → CI eval gate** (`server.mjs` `/api/gov/evals`, `/api/gov/evals/run`): *"generates
  the GitHub Action / GitLab CI config that runs the eval suite headlessly on PRs touching
  `.claude/`, with a configurable merge-blocking pass-rate threshold."* This is the deterministic
  CI gate itself — a merge-blocking, headless, thresholded pipeline. CI runs are shown inline via
  `gh`, tagged CI-vs-manual.
- **Quality** (`QualitySection`, `/api/analytics/drift`, `/api/design/drift`, `/api/design/manifest`):
  deterministic drift gates — analytics-event taxonomy validation against
  `.claude/analytics-taxonomy.json` and design-system conformance against
  `.claude/design-manifest.json`. Pure pass/fail checks suitable for a CI gate.
- **Hooks** (`HooksSection`): real PreToolUse/PostToolUse policy hooks with a **matcher tester** and
  **dry-run** (allow / BLOCK / latency) — the deterministic guardrails that run *inside* each agent's
  execution, plus a pattern library (require-tests-before-stop, block-prod-file-edit,
  secret-scan-pre-write) that enforces validation without a human.
- **Atoms / Constitution** (`server-atoms.mjs`, `server-constitution.mjs`): citation-enforced grounded
  answers (answers must cite atom ids only) — a deterministic anti-hallucination gate on retrieval.

### Human-on-the-loop supervision + approval (the "human approves the batch" half)

- **Governance** (`server.mjs` `/api/gov/dryrun`, `/api/gov/approvals`, `/api/gov/versions`,
  `/api/gov/rollback`): **dry-run before write**, an **approvals** queue, versioned changes, and
  **reversible rollback**. This is the batch-approval and safety-net machinery. `runs/approve`
  (`POST /api/runs/approve`) is the literal promote gate.
- **Inbox** (`/api/inbox/done`): severity-sorted attention queue — *"the designated fleet view for
  future scheduled runs."* This is where a supervising human sees "what needs a human today"
  across the whole batch, with nudge / snooze / clear.
- **Capabilities → archive** and Governance actions: destructive/irreversible ops are dry-run first,
  backed up, and reversible — the guardrails that make batch approval safe.

---

## 3. Layer coverage — present vs thin

### Layer 1 — Tooling

| Component | Present | Thin / missing |
|---|---|---|
| **Dev Control Plane** | Strong — Workflows Hub, Task Board, Squad Designer, Chat, team orchestration API | — |
| **Integration / Delivery (CI-CD)** | Strong — Reliability CI eval gate (writes real GH Action / GitLab CI, merge-blocking threshold), `gh`-surfaced CI runs, preview-env auto-provision | Gate is scoped to PRs touching `.claude/`; general app-code CI gate not owned. No automatic PR-open/merge from a converged run. |
| **Resource Plane** | Strong — git worktrees per run, headless `claude -p`, preview envs, spawned processes | Worktree lifecycle (cleanup/quota) and concurrency ceilings not surfaced. |
| **Quality & Security** | Strong — eval suites, Quality drift gates, Hooks policy engine, dry-run, secret-scan pattern | Eval **thresholds are per-suite/manual**; no cross-run aggregate pass/fail policy. |
| **Observability** | Strong — Loush Runs, `runs/events`, Forensics, Overview, Inbox fleet view | Per-run live cost/step telemetry during a batch is thin; forensics is post-hoc. |

### Layer 2 — Path Definitions

| Stage | Present | Thin / missing |
|---|---|---|
| Dispatch | Task Board ▸ Start, `actions/run`, team/plan | Dispatch is human-click; no auto-dispatch of a queued batch. |
| Retrieve | Strong — eng snapshot, Atoms, Constitution, Memory, Figma capture | — |
| Implement | Strong — headless dev agent in worktree | — |
| **Validate** | **Strong — the L2 core**: review severity gate (cap 3), QA AC/test gate, CI eval gate, Quality drift, Hooks | Gates are **separate surfaces**, not one composed pipeline verdict per run. |
| Promote | `runs/approve`, `gov/approvals`, dry-run, rollback | Promote is one-at-a-time; no batch-approve of multiple converged runs. |
| Deploy | `ticket/transition`, `team/request-review`, `team/comment` write-backs | Deploy-on-approve is manual; no gated auto-merge. |
| Observe | Strong | (see Observability above) |
| Remediate | Strong — auto-fix loop, auto-filed bug sub-tickets, `gov/recs`, career-lessons | Remediation cap → "Blocked" is terminal; no auto-escalation routing. |

The **hybrid path is fully expressed**: probabilistic agent work → deterministic gate → bounded
iteration → human promote. What's thin is *composition* — the gates exist but aren't unified into
a single per-run pipeline verdict.

### Layer 3 — Agent Infrastructure

| Component | Present | Thin / missing |
|---|---|---|
| Harness: **context** | Strong — Memory, Context Explorer, Constitution, Atoms | — |
| Harness: **capability** | Strong — Capabilities Hub CRUD, ROI ledger, Flow graph, MCP/Library | — |
| Harness: **execution** | Strong — worktrees, headless agents, Sessions, preview envs | Parallel-execution scheduling/queueing is human-driven. |
| Harness: **evaluation** | Strong — eval suites, `gov/evals/run`, CI gate, review/QA gates | Eval results not fed back as an automatic run-level gate signal. |
| Governance: **identity** | Present — `career-identity`, Governance section, config identity | — |
| Governance: **security** | Strong — Hooks, dry-run, secret-scan, plane A/B enforcement, reversible archive | — |
| Governance: **observability** | Strong — Forensics, Runs, Inbox | Fleet-level (many concurrent runs) dashboards thin. |

---

## 4. Gaps to fully own L2 (cheap-first)

1. **Compose the gates into one per-run verdict** *(cheapest, highest leverage)*. Today review,
   QA, CI-eval, and Quality-drift are separate surfaces. Add a single "validation verdict" object
   per run in `/api/runs` that aggregates each gate's pass/fail + score, so a run has one
   machine-readable state (PASSING / BLOCKED / NEEDS-HUMAN). This is mostly wiring existing outputs
   together.

2. **Batch approval in the Inbox / Runs view**. `runs/approve` is one-at-a-time. Add a
   multi-select "approve all converged" action against the aggregated verdict from gap 1. Turns the
   human from per-run approver into batch supervisor — the definitional L2 shift. Cheap: it's a
   fan-out over the existing approve endpoint.

3. **Auto-dispatch a queued batch**. Dispatch is currently a human ▸ Start click per ticket.
   Let the Task Board launch all "ready" sub-tickets (from ✂ analyze) into parallel worktrees in one
   action, respecting a concurrency ceiling. Reuses existing worktree + headless-agent machinery.

4. **Surface worktree/concurrency lifecycle**. Expose live count of running agents, worktree
   quota, and per-run cost during the batch (not just post-hoc Forensics). Needed so a human can
   supervise a fleet without it running away on cost. Extends `runs/events`.

5. **Gated auto-merge on promote**. Wire `runs/approve` → PR open + auto-merge when all gates pass
   (Deploy stage). Today deploy write-backs (`ticket/transition`, `request-review`) are manual.
   This closes Validate → Promote → Deploy without a second human touch.

6. **Escalation routing on cap/Blocked**. The auto-fix loop terminates at "Blocked" after 3
   cycles. Route Blocked runs into the Inbox as a severity-tagged, human-decision item automatically
   (rather than a terminal dead state). Small change; large supervision-quality win.

---

## 5. Exit criteria — graduate to L3

L3 (Human-in-the-background / fleet autonomy + scheduled cadence) is reachable once L2 is
genuinely batch-supervised. Graduate when:

1. **One-verdict runs**: every run carries a single aggregated validation verdict; no human reads
   individual gate output to know a run's state. *(closes gap 1)*
2. **Batch approve is the default interaction**: humans approve/reject converged runs *in bulk*
   from the Inbox fleet view, not one-by-one. *(closes gaps 2, 6)*
3. **Zero-touch happy path**: a ticket can go Dispatch → Implement → Validate → Promote → Deploy
   with human involvement only at the single promote gate — auto-dispatch in, gated auto-merge out.
   *(closes gaps 3, 5)*
4. **Fleet is observable and bounded**: live concurrency, cost, and worktree quota are visible and
   enforced during a batch; a runaway batch is capped, not discovered later. *(closes gap 4)*
5. **Convergence rate is measured**: the platform reports what fraction of runs converge through the
   gate unaided vs. hit the cap — the metric that tells you autonomy is safe to extend.

The bridge to L3 is **Gap B (autonomy — scheduled `claude -p` runs landing in the Inbox)** from the
OS-ROADMAP: once L2's batch-approval + one-verdict + bounded-fleet criteria hold, a scheduler can
*initiate* the batch (cron/launchd) and the human moves from on-the-loop to on-call. Until then,
dispatch stays human-triggered and the platform is L2.
