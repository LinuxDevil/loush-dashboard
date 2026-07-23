# ADP Level 1 — Human-in-the-Loop

*Input: `feature-map-backend.md`, `feature-map-frontend.md`. Scope: what L1 means for this dashboard, what already covers it, layer coverage, gaps, and exit criteria to L2.*

---

## 1. What L1 means for this platform

At Level 1 the human drives and the agent assists **inline, one request at a time** — single- or short-turn, synchronous, and every output is reviewed by the human before it lands. For this product specifically, the actual inline assisting happens in the editor (Claude Code CLI / Cursor); the dashboard is the **control-and-observability plane around that loop**: it authors the capabilities and prompts the assistant uses, shapes the context each request runs in, grounds answers in verified repo knowledge, and shows every session/output for human review. Nothing here runs unattended — it is explicitly built so "the human decides" (no auto-nudges, no unattended runs at this level).

---

## 2. Existing dashboard features that already serve L1

Cited by name from the maps.

**Interactive assist surface (the request loop itself):**
- **Chat** (`ChatSection`, `/api/chat/complete|upload|sessions`) — live single/short-turn talk to Claude Code. The literal human-in-the-loop assist surface.
- **Quick Actions** (`QuickActions`) — one-click short-turn launchers (Explain repo, Init CLAUDE.md, Find dead code) — assist without composing a prompt.
- **Artifacts** (`ArtifactsSection`) — renders agent output for the human to review before acting on it.

**Authoring the assistant (what it can do per request):**
- **PromptStudio / Authoring** — compose and iterate the prompts that drive each assist.
- **Chat Insights** (`InsightsSection`) — prompt feedback loop: duplicate-prompt clusters with **save-as-command** and **send-to-Prompt-Studio**, turning repeated inline requests into reusable capabilities.
- **Capabilities → Skills / Commands / Agents** (`ResourceSection`, `/api/res/:kind`) — CRUD over the real `~/.claude/{skills,commands,agents}` files the inline assistant invokes; preview shows "what triggers this."
- **Library** (`LibrarySection`) and **MCP** (`McpSection`) — reusable harness assets + connector config that give the inline assistant its tools.

**Shaping the context each request runs in (Harness context config):**
- **Harness → Config** (`HarnessSection`, `/api/harness`, edits `~/.claude/settings.json`) and **Context Explorer** — the context-engineering layer that determines what each inline request sees; Context Explorer replays context-window occupancy turn-by-turn.
- **Memory Recall** (`server-memory.mjs`, `/api/memory/*`) — semantic recall over `~/.claude/memory/` to feed prior context into a request.

**Grounding the assist (accuracy / anti-hallucination):**
- **Atoms** (`server-atoms.mjs`, `/api/atoms/*`) — grounded "ask-the-project" Q&A with **citation enforcement** (answers must cite atom ids, no outside knowledge) + attestation triage.
- **Constitution** (`server-constitution.mjs`) — citation graph over verified `.wakeel/constitution` repo knowledge; the trusted source an inline answer should lean on.
- **Figma Capture** (`server-figma-capture.mjs`) — pulls design context into the repo so an implementation request is grounded in the real frame.

**Gating + reviewing every output (human-in-loop guardrails):**
- **Hooks** (`HooksSection`) — real Claude Code hooks as first-class config with **matcher tester** and **dry-run** (allow/BLOCK/latency); the per-tool gate that catches an output before it lands. Pattern library includes `block-prod-file-edit`, `secret-scan-pre-write`, `require-tests-before-stop`.
- **Sessions / Usage / Forensics** (Harness Hub, Plane B) — per-session cost/tokens/tool-calls/errors and failure signatures; the observability that lets a human review what each assist actually did.

---

## 3. Layer coverage at L1 (present vs thin)

### Tooling Layer
- **Dev Control Plane** — **Strong.** Chat, Authoring, Capabilities CRUD on real files, Config, Hooks, MCP, Library all present.
- **Integration / Delivery (CI-CD)** — **Thin at L1.** Reliability's CI eval gate and Delivery metrics exist but they belong to higher levels; at L1 the human runs and ships manually.
- **Resource Plane** — **Present-lite.** L1 only needs "edit the real config files" (backed up, reversible) — that exists. Worktrees/preview envs are L2+.
- **Quality & Security** — **Partial.** Hooks policy + Atoms citation enforcement + Quality drift checks cover the safety of a single assist; eval-per-request is not wired in.
- **Observability** — **Strong.** Sessions, Usage, Context Explorer, Forensics give full per-request visibility.

### Path Definitions Layer (golden paths)
- **Retrieve Context** — **Strong** (Memory, Atoms, Constitution, Figma Capture).
- **Implement** — **Present** (Chat, Quick Actions) but single-turn only.
- **Validate → Promote → Deploy → Observe → Remediate** — tooling exists but at L1 each is a **separate human-triggered action**, not a path the agent walks. **Dispatch is fully manual** (human types the request). Flow Graph shows the topology of how capabilities connect. Mostly **probabilistic single-turn**; no deterministic chaining yet.

### Agent Infrastructure Layer
- **Harness — context** (Context Explorer, Config, Memory): **Strong.**
- **Harness — capability** (Library, MCP, Skills/Commands/Agents): **Strong.**
- **Harness — execution** (Chat single-turn): **Present**, short-turn only.
- **Harness — evaluation**: **Thin.** Eval suites exist (`/api/gov/evals`) but are not applied to inline assists.
- **Governance — identity/security** (Governance, Hooks, Config): **Present.**
- **Governance — observability** (Sessions, Forensics, Usage): **Strong.**

---

## 4. Gaps to fully own L1 (cheapest first)

The platform already over-covers observability and authoring. The real L1 gaps are in **closing the request loop** — wiring what's authored/grounded into the actual inline assist, and recording the human's review. All are small.

1. **Wire grounded retrieval into Chat.** Atoms/Constitution/Memory are queryable in their own tabs but the inline **Chat doesn't cite them**. Cheapest high-value fix: have `/api/chat/complete` optionally prepend the top Atoms/Memory hits (reuse the existing search endpoints). Makes every inline answer grounded.
2. **Capture per-output review.** L1 requires "human reviews every output before it lands," but Chat has no accept/reject/diff trail. Add a lightweight accept/reject log next to Chat responses (one JSON store, like `board`/`bugs`). Turns "review" from implicit into recorded.
3. **Ship a default L1 safety hook.** The Hooks pattern library exists but nothing is installed out-of-box. Install one sensible default (`block-prod-file-edit` or `secret-scan-pre-write`) on first run so an inline edit can't land somewhere dangerous unreviewed.
4. **Auto-surface recalled memory at request time.** Overview already shows recalled memory; extend that to inject the same recall into the Chat context automatically instead of a manual Memory query.
5. **Verify the save-as-command round-trip.** Chat Insights can "save as command," but there's no confirmation the saved command then fires inline. Cheap: after save, link it in Flow Graph's **observed** view so the human sees it invoked.

---

## 5. Exit criteria to graduate to L2

L2 = the agent takes a **multi-step task with human checkpoints** (the Task Board headless-agent + worktree loop is the L2/L3 hint). Graduate from L1 when:

1. **Grounded inline assist** — Chat answers automatically cite Atoms/Constitution/Memory (gap #1 closed).
2. **Reviewed every output** — every inline output has a recorded accept/reject/diff trail (gap #2 closed).
3. **Authored → observed round-trip** — a capability created in the dashboard is seen firing inline in Flow Graph's observed edges (gap #5 closed).
4. **Config demonstrably shapes assists** — a Harness/Config change shows a measurable effect in Context Explorer / Usage.
5. **Default guardrail in place** — at least one safety hook installed and shown blocking in Forensics/hook health (gap #3 closed).

When these hold, the human can trust a short chain to run under checkpoints rather than approving each keystroke — the entry condition for L2.
