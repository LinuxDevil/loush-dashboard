# ADP Plan — Agentic Development Platform for Claude

> Where this dashboard sits on the ADP maturity model, what already covers each level, and the cheap-first path forward.
> Video reference: https://www.youtube.com/watch?v=jfM9aNBAX-o
> Detail per area: [`feature-map-backend.md`](./feature-map-backend.md), [`feature-map-frontend.md`](./feature-map-frontend.md), [`level-1.md`](./level-1.md), [`level-2.md`](./level-2.md), [`level-3.md`](./level-3.md), [`level-4.md`](./level-4.md)

## TL;DR — current position

**This dashboard is the observability + config-control plane for a Claude Code agentic-dev setup**, not the editor itself. Every write hits real config files with backups, on a server-enforced two-plane boundary (Plane A = JIRA/GitHub/CI work artifacts, team-safe / Plane B = harness telemetry, self-only).

| Level | Definition | Status |
|-------|-----------|--------|
| **L1** Human-in-the-loop | Inline assistant, human reviews every output | ✅ **Owned** (control plane strong; grounding not wired into Chat) |
| **L2** Human-on-the-loop | Parallel agents + automated validation gates | 🟡 **Substrate built** (Workflows Hub does it; no single verdict, no batch approve) |
| **L3** Humans as orchestrators | Continuous background/scheduled unattended runs | 🟠 **Closest real target, NOT built** — blocked on Gap B (Scheduler→Inbox) |
| **L4** Fully autonomous | Self-initiating on production telemetry | 🔴 **Aspirational as-defined**; realistic only as narrowed dev-workflow analog (L4a) |

**One-line roadmap:** finish L2 wiring (cheap) → build Gap B scheduler to unlock L3 (the real prize) → L4a is a stretch reusing existing rollback/recs primitives; literal L4b (prod incidents) is out of scope until we own prod systems.

---

## The ADP as 3 layers (our coverage)

The video's architecture is 3 layers. Here's what we already have vs. what's thin, cutting across all levels:

### 1. Tooling Layer (the foundation)
- **Dev Control Plane** — ✅ GitHub/JIRA via CLI (gh, acli), server-eng, career-import-*, server-team (PR review/comment write-back).
- **Integration & Delivery (CI/CD)** — 🟡 Reliability writes real GH Action / GitLab CI running the eval suite with merge-blocking threshold. No artifact registry / deploy pipeline of our own.
- **Resource Plane** — 🟡 Git worktrees + preview envs per Workflows run. No cloud/K8s provisioning (nor needed — this is local-first).
- **Quality & Security** — ✅ Hooks (matcher tester/dry-run), Quality drift, Atoms/Constitution grounded RAG, eval gates.
- **Observability** — ✅ for **dev-workflow** telemetry (DORA, forensics, ROI, drift, usage-trends). 🔴 **no production/runtime telemetry** (no Datadog/Grafana/OTel wired).

### 2. Path Definitions Layer (golden paths)
| Stage | Covered by | Maturity |
|-------|-----------|----------|
| Dispatch Work | server-eng triage, career-import-jira, Task Board ✂analyze | 🟡 manual trigger only |
| Retrieve Context | Harness config, Context Explorer, Memory, Atoms, Constitution, Figma Capture | ✅ (but not auto-injected into Chat — see L1 gap) |
| Implement Change | Workflows Task Board → worktree + headless dev agent (`claude -p`) | ✅ |
| Validate Change | Review (severity + 3-cycle auto-fix cap), QA (AC+tests), Reliability CI gate | ✅ the hybrid "iterate-until-converge" path exists |
| Promote Change | Governance dry-run→approve→version→rollback, `/api/runs/approve` | 🟡 one-at-a-time, no batch/auto-merge |
| Deploy System | — | 🔴 write-backs manual; no canary/rollout |
| Observation | Overview, Delivery/Eng, Forensics, usage-trends anomaly, career-health | ✅ dev-workflow scope |
| Issue Remediation | Bugs engine (auto-bisect, regression-test, gh pr create), career-analyze/heuristics/lessons | 🟡 all missing the *trigger* |

### 3. Agent Infrastructure Layer
- **Harness** — Context ✅ / Capability ✅ (Skills/Commands/Agents CRUD, Library, MCP) / Execution ✅ (worktrees, isolation) / **Evaluation** 🟡 (eval suite + CI gate exist; no per-request eval).
- **Governance** — Identity ✅ / Security ✅ (secrets, hooks, reversible backed-up writes) / Observability ✅ (cost/token, DoD via evals). This plane is a genuine strength and the safety backbone for higher levels.

---

## Level-by-level

### L1 — Human-in-the-loop ✅ Owned
**Here:** human drives, agent assists one request at a time; dashboard authors capabilities/prompts, shapes context, grounds answers, shows every session for review. Nothing runs unattended (no auto-nudges).

**Already covers it:** Chat + Quick Actions (live assist), PromptStudio/Authoring + Capabilities CRUD + Library/MCP (author what the assistant can do), Harness Config + Context Explorer + Memory (context engineering), Atoms + Constitution + Figma Capture (grounding), Hooks + Sessions/Forensics (gate + review).

**Top gaps (all cheap):**
1. Grounded retrieval **not wired into Chat** — Atoms/Constitution/Memory are separate tabs. Have `/api/chat/complete` prepend top hits so inline answers cite sources.
2. No per-output **review trail** — add a lightweight JSON store (like board/bugs) so "review every output" is recorded, not implicit.
3. No **default safety hook** installed out-of-box — ship one (block-prod-file-edit / secret-scan-pre-write) on first run.

**Exit to L2:** grounded inline assist + recorded review trail + authored→observed capability round-trip + a default guardrail shown blocking.

### L2 — Human-on-the-loop 🟡 Substrate built
**Here:** human supervises a batch instead of driving steps. N tickets = N headless agents in parallel worktrees; each change hits a deterministic/hybrid gate (build/lint/eval/AC/review-severity) and iterates until it converges or hits a cap; human only approves promotion.

**Already covers it:** Workflows Hub → Task Board (▸Start = worktree + headless agent per ticket; ✂analyze fans a ticket into parallel sub-tickets — **this IS parallel execution**), Review/QA gates (severity + 3-cycle auto-fix cap → Blocked = the iterate-until-converge loop), Reliability CI eval gate (the deterministic merge-blocking gate), Governance dry-run→approve→rollback + Inbox fleet view.

**Top gaps:**
1. Gates are **separate surfaces** — no single aggregated per-run verdict (PASSING / BLOCKED / NEEDS-HUMAN). Cheapest, highest leverage; mostly wiring.
2. **No batch approval** — `runs/approve` is one-at-a-time; add multi-select "approve all converged" in Inbox/Runs. This is the definitional L2 shift (human = batch supervisor).
3. **No zero-touch happy path** — dispatch is a per-ticket click; deploy write-backs manual. Need auto-dispatch in / gated auto-merge out.

**Exit to L3:** one-verdict runs, batch-approve default, zero-touch happy path, bounded observable fleet, measured convergence rate.

### L3 — Humans as Orchestrators 🟠 The real target — NOT built
**Here:** long-running tasks + bug fixes run unattended, dispatched on a cadence (cron/launchd) or triggered by an incoming ticket, feeding self-validating Implement→Validate loops that surface only at approval gates. Human curates an Inbox queue and sets cadence. **The substrate exists; the autonomy loop does not — every run today is human-triggered.**

**Partially covers it:** Inbox (built explicitly as the fleet view / Gap B target — destination exists, nothing schedules into it), server-eng triage + career-import-jira (dispatch primitives waiting for a trigger), Task Board + Loush Runs + `/api/runs/approve` (the implement/validate loop + monitoring spine, button-started only), Reliability CI (the ONE genuinely event-triggered piece), Bugs engine (remediation minus the trigger), career-digest ("no cron — scheduler gated").

**Top gaps:**
1. **Scheduler→Inbox loop (Gap B — cheapest, unlocks the level):** cron/launchd + `claude -p` writing results into the existing Inbox. No new UI. career-digest is the first cadence output.
2. **Background execution runtime:** a durable job/queue/worker layer over the existing `/api/runs` + runs/events spine (persistence + retry + concurrency around the worktrees/agents that already exist).
3. **Ticket-triggered dispatch:** wire eng/triage (already polling JIRA on 2h TTL) into the scheduler so a new/changed ticket auto-enqueues a run; unattended remediation (Bugs + review/QA loop) fires on bug/red-main events — all behind the two hard rules and the `runs/approve` gate.

**Exit to L4:** cadence real, ticket→run unattended, runs durable, remediation closes the loop, governance holds under autonomy, human orchestrates a fleet not a task. **L4 boundary = agents self-select what to work on rather than the human curating the queue.**

### L4 — Fully Autonomous 🔴 Aspirational (L4b) / narrowly realistic (L4a)
**Here (as defined):** self-initiating agents respond to production telemetry with no human trigger — breach → diagnose → fix → validate → rollback. "3am paging → auto-rollback."

**Honest scope:** literal prod-runtime L4 is **out of scope** — this is a dev-workflow control plane; its "observability" is DORA/forensics/ROI/drift/usage, **not app runtime**. Datadog/Grafana/OTel are in the target arch but unwired. Reframe as:
- **L4a (in-scope, cheap-ish):** autonomous remediation on **dev-workflow / harness** SLO-breach signals we already compute.
- **L4b (aspirational):** prod-incident autonomy — gated on owning external prod systems + a CD/incident path we don't have.

**Reusable primitives toward L4a:** `gov/rollback` (reversible, backed-up autonomous verb), `recs` (proposed fix), forensics correlation (diagnosis), usage-trends anomaly + career-health regression (breach detector), evals as machine definition-of-done + Reliability CI gate, governance identity/security (signed + audited), career-lessons (learn loop), Task Board bounded auto-fix cap-3, Inbox (fleet view + override).

**Biggest gaps:** (1) production telemetry ingestion — none; (2) alerting/SLO source — none (only polled threshold cards); (3) self-initiation trigger — none (Gap B unbuilt, and even specced it only lands a digest); (4, partial) no policy engine mapping signal→allowed autonomous action.

**Cheap-first L4a path:** normalise existing detectors into a signal bus → let the Gap B scheduler self-initiate **bounded** runs → define dev-SLOs/error-budgets over metrics already computed → whitelist the **2 safest verbs** (eval-gate regression → auto `gov/rollback`; red main from a harness-authored PR → auto-revert). Everything else stays propose-only.

---

## Roadmap — cheap-first, ordered

1. ✅ **Finish L1 grounding** — `retrieveContext()` prepends curated-memory hits to the model's copy of each Chat turn (viewers see clean text) with `[memory:<name>]` citations; Chat review-trail JSON store + accept/reject buttons; safety-hook Inbox nudge (propose, not silent global write). *Shipped.*
2. ✅ **Close L2 wiring** — `run-verdict.mjs` (pure, tested) → one PASSING/BLOCKED/NEEDS-HUMAN verdict; `?verdict=` filter; `POST /api/runs/approve-batch` + "approve all converged" bar. *Shipped.*
3. ✅ **Gap B: Scheduler→Inbox** — `scheduler.mjs`: in-process cadence loop, reuses `runAgent` / `/api/career/digest`; results are info-only harness-plane Inbox items; `GET/PUT /api/scheduler` + toggle UI. Opt-in (default off = kill switch). *Shipped — the L2→L3 unlock.*
4. ✅ **Durable run runtime** — `nextSchedule()` (pure, tested): bounded retry-with-backoff on job failure (retries ~5 min out, caps at `maxRetries`, then parks a cadence). Concurrency (`inFlight`) + persistence (`lastRun`) already held. *Shipped — no queue/worker layer needed (YAGNI).*
5. ✅ **Ticket-triggered dispatch** — `dispatch` job kind + `dispatchPlan()` (pure, tested): auto-starts board tickets in a trigger stage via the existing `startTicket` path → worktree + tracked run, gated at code-review/`runs/approve`. Bounded by `maxDispatch` + a daily cost ceiling (`/api/gov/costs`) that halts dispatch; concurrency/dedup free from `startTicket`'s own guards. *Shipped (full auto-dispatch of the human-curated queue).*
6. ✅ **L4a policy engine — PROPOSE-ONLY** — `remediate` job kind + `remediationPlan()` (pure, tested): maps the existing SLO-breach signals (`kind:'eval'` regression, `kind:'ci'` red-main) to the exact reversible verb (`gov-rollback` / `git-revert`) and drops the command in the Inbox for a human. **Autonomous execute on a shared repo is deliberately NOT wired** — it contradicts the app's copy-for-human invariant (`server.mjs` header) and is a real deploy/incident decision, not a scheduler default. Arming it is a separate, explicit build behind per-verb enable + one-click undo. *Shipped as the detector+policy layer; the trigger stays a human's.*
7. 🔴 **L4b** — still parked, and genuinely unbuildable today: it needs production/runtime telemetry (Datadog/Grafana/OTel) and an owned deploy/incident path, neither of which exists in this dev-workflow control plane. Not skipped for effort — there is nothing to wire it to. Revisit when prod systems are in scope.

**Guardrails honored across 3–6:** kill switch (scheduler + per-job `enabled`), cost ceiling that halts runs, self-only harness plane, never auto-send, and — for L4a — no autonomous write to a shared repo. Every autonomous action lands in the Inbox with its trace.

## Guardrails (inviolable at every level)
- **Two-plane boundary** stays server-enforced: Plane A (work artifacts, team-safe, operational-only) vs Plane B (harness telemetry, self-only). No evaluative per-engineer scores.
- **Never auto-send a nudge** — always copy-for-human.
- **Never ingest another engineer's transcripts.**
- Autonomy additions (L3/L4a) require: reversibility-ordered blast radius, versioned **kill switch** + per-signal enable, **cost/token ceilings** that halt runs, every autonomous action lands in Inbox with full trace + one-click undo, eval-pass as definition-of-done.
