# ADP Level 4 — Fully Autonomous

> Self-initiating agents that respond directly to telemetry signals with no human trigger.
> An SLO breach, error spike, or metric anomaly kicks off diagnosis → fix → validate → rollback
> autonomously. This is the golden-path **Observe → Remediate** stages at full maturity:
> the move from "3am human paging" to "automated rollback/remediation on breach."

---

## 1. What L4 means for THIS platform — and the honesty check

L4 as literally defined targets **production/runtime telemetry**: a live SLO breach in a deployed
service self-initiates an autonomous fix-or-rollback. **This platform does not own that surface.**
It is a **local dev-workflow control plane** over two planes — Plane A (JIRA/GitHub/CI work artifacts)
and Plane B (harness transcripts/tokens/cost) — and every "observability" feature it has today is
**dev-workflow telemetry** (DORA, flow, forensics, ROI, drift, usage anomalies), not application
runtime telemetry. There is no prod-signal ingestion, no SLO/alert source, and no self-initiation.

So the honest split:

- **Literal prod-runtime L4 (SLO breach on a deployed app → auto-rollback of a production deploy):
  ASPIRATIONAL / OUT OF SCOPE.** It requires systems the platform does not own or sit inside —
  a prod metric source (Datadog/Grafana/OpenTelemetry), an alerting/error-budget layer, and a
  position in the CD/incident path. The platform runs on a laptop, not in the prod request path.

- **A genuine in-scope L4 ANALOG exists** if we narrow the domain to the runtime the platform
  *does* own — **the agent harness/fleet and the dev golden path**. The platform already computes
  breach-like signals (red main, cycle-time p90 blowout, escaped-bug spike, eval-gate regression,
  harness cost/anomaly, capability drift) and already owns reversible remediations (config rollback,
  revert a harness-authored PR). Self-initiating on *those* signals is realistic and cheap. That is
  the defensible L4 story for this product: **autonomous remediation of dev-workflow / harness SLO
  breaches**, not production incident response.

Recommendation: present L4 in two tiers — **L4a (in-scope, dev-workflow autonomy)** as the buildable
target, and **L4b (prod-runtime autonomy)** as aspirational and explicitly gated on owning/integrating
external prod systems.

---

## 2. Existing primitives reusable toward L4

The remediation *muscles* already exist; what is missing is the self-initiation nervous system.

| Primitive | Where | L4 role |
|---|---|---|
| **gov/rollback** | `server.mjs` `/api/gov/rollback` (+ Capabilities archive, dry-run, backed-up, reversible) | The autonomous **rollback/fix** action. Already reversible + versioned — the safest possible autonomous verb. |
| **recs** | `server.mjs` `/api/gov/recs` (+ dismiss) | Diagnosis → **proposed fix** generation. The seed of an autonomous remediation proposal. |
| **forensics correlation** | `server.mjs` `/api/forensics`; Harness → Forensics | **Diagnosis**: failure signatures grouped+counted, context-pressure/HOG flags, hook blast radius — the "what broke and why" step. |
| **anomaly / regression detectors** | `career-usage-trends` (anomaly, cost projection), `career-health` (`computeRegression`) | The **breach/anomaly detector** — already exists, over harness telemetry (Plane B). |
| **evals as definition-of-done** | `server.mjs` `gov/evals`(+`/run`); Reliability CI eval gate | **Validate the fix before it counts as remediated.** Merge-blocking pass-rate = machine DoD. |
| **governance identity/security** | Harness → Governance; `career-identity` | Signed actor + policy scope for any self-initiated action; audit identity. |
| **career-lessons** | `career-lessons.mjs` (harvest→distill→graduate) | Learn-from-failure loop that produces **verified improvement checks** — closes the autonomy loop over time. |
| **Task Board autonomous loop** | Workflows → `BoardSection` | Headless agent in an isolated worktree → review → QA, with an **auto-fix loop capped at 3 → Blocked**. Proven bounded-autonomy execution + a working guardrail pattern. |
| **Inbox (fleet view)** | `Inbox` section | The designated **landing surface for scheduled/self-initiated runs** (Gap B target) and human override queue. |
| **Actions / team orchestration / runs-approve** | `server.mjs` `actions/run`, `/api/team/*`, `runs/approve`, `runs/events` | The **trigger + deploy + human-gate** plumbing an autonomous run would drive. |

---

## 3. Layer coverage — present vs gaps

### Tooling Layer
- **Present:** CI/CD eval gate (Reliability generates the merge-blocking GH/GitLab action); Resource
  plane (isolated worktrees + auto-provisioned preview envs); Quality/Security (analytics + design
  drift, hooks policy).
- **Observability — PRESENT BUT WRONG DOMAIN:** everything is dev-workflow telemetry (DORA, flow,
  forensics, ROI, usage anomalies). **Datadog / Grafana / OpenTelemetry are named in the target
  architecture but NOT wired in.** No prod metrics/traces/logs.

### Path Definitions Layer (… Observe → Remediate)
- **Observe: present** for dev-workflow (Overview tiles, Inbox SLA breaches, DORA bands, Forensics,
  usage anomaly/regression) — **polled/batch for display, not an alert stream.**
- **Remediate: present but human-triggered** (recs, rollback, lessons, Task Board review/QA/release
  are manual gates). Nothing self-initiates.

### Agent Infrastructure Layer
- **Harness (context/capability/execution/evaluation): present and mature.**
- **Governance (identity/security/observability + cost/token economics + definition-of-done): present**
  — including reversible rollback and recs. This is the strongest foundation for safe autonomy.

### The large gaps
1. **Production telemetry ingestion** — none. No prod metric/trace/log source; no OTel/Datadog/Grafana pipe.
2. **Alerting / SLO source** — none. No SLO definitions, no error budgets, no alert webhooks. Closest
   analogs (Inbox SLA cards, DORA bands, anomaly detectors) are thresholds computed on a 60s poll /
   refresh, not a real-time alert bus.
3. **Self-initiation trigger** — none. Everything is human-clicked or polled-for-display. Gap B
   (scheduler → Inbox) is the cadence primitive but is **unbuilt**, and even as specced it lands a
   digest for a human — it does not auto-execute a remediation.
4. **Autonomous remediation policy + guardrails** — partial. Bounded auto-fix (cap 3) and reversible
   rollback exist, but there is **no policy engine** mapping "signal X → allowed autonomous action Y
   without a human," and no blast-radius controls bound to a live signal.

---

## 4. Gaps to fully own L4 (realistic, cheap-first)

**Cheap / in-scope — build the dev-workflow L4 analog (L4a):**
1. **Signal bus.** Normalise the detectors that already exist (usage-trends anomaly, `career-health`
   regression, Inbox SLA/red-main, eval-gate regression, capability/design/analytics drift) into a
   single internal signal stream that something can *subscribe* to — not just render.
2. **Build Gap B (scheduler → Inbox), then let it self-initiate.** Cron/launchd + `claude -p` is
   already the planned, cheap autonomy substrate. Extend it from "produce a digest" to "on signal S,
   spawn a bounded remediation run." The Inbox stays the fleet view + override queue.
3. **Define dev-SLOs + error-budget thresholds** over signals the platform already computes (e.g.
   eval pass-rate ≥ threshold; main green; harness cost within window). This is config, not new data.
4. **Autonomous policy map (start with the two safest verbs):**
   - eval-gate regression on a `.claude/` change → **auto `gov/rollback` to last-good version** (already reversible, backed up).
   - red main caused by a **harness-authored** PR → auto-revert that PR (Plane A write, self-owned).
   Everything else stays propose-only (recs → Inbox) until trust is earned.

**Expensive / aspirational — needs systems the platform does not own (L4b):**
5. **Real prod telemetry + alert ingestion.** A webhook receiver for Datadog/Grafana/OTel/PagerDuty
   and being placed in the prod incident path. This is an integration + operational-position change,
   not a feature toggle.
6. **Production rollback authority.** Auto-rolling-back a *production deployment* requires owning (or
   being trusted by) the CD system and a prod metric source. Out of scope for a local dev control
   plane unless the product deliberately expands into prod-runtime.

---

## 5. Governance & safety unique to full autonomy

Autonomy removes the human trigger, so every human-in-the-loop safety must be re-encoded as policy:

- **Blast radius.** Autonomous verbs are whitelisted and ordered by reversibility: config rollback
  first (reversible + backed up), then revert-of-a-harness-authored-PR. **Never** autonomous
  team-wide Plane A writes, and **never** any autonomous action that emits evaluative Plane B data
  into Plane A — the server-enforced two-plane boundary still holds.
- **Kill switch.** A global versioned "disable autonomy" flag (reuse the settings.json env-flag
  pattern already used to gate agent teams), plus per-signal enable/disable. Default off.
- **Cost ceilings.** Governance already owns cost/token economics (run-economics, harness ROI).
  Enforce per-run and per-window token/cost ceilings; an autonomous run that would exceed its ceiling
  halts and routes to Inbox instead.
- **Human override.** Every self-initiated action lands in the **Inbox** with its full trace and a
  one-click undo (`gov/rollback` / the `gsd-undo` pattern). Bounded auto-fix stays capped (the
  Task Board cap-of-3 → Blocked precedent). Nothing runs unattended without a reversal path.
- **Audit + DoD.** Every run is signed with governance identity, fully traced (`gov/trace`),
  dry-run-previewed and versioned. **Definition-of-done = the eval suite passes** — a fix is not
  "remediated" until evals go green; otherwise it auto-rolls-back and escalates.
- **The two hard product rules are inviolable under autonomy:** never auto-send a nudge to a human
  (copy-for-human only), and never ingest another engineer's transcripts. Autonomy may act on
  self-owned config and self-authored code, not on people.
