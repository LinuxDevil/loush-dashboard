# Claude OS — Roadmap

> You already built the OS. The dashboard **is** it: the observability + config control plane
> that agentic-os, claude-os, and trinity all lack. This roadmap adds the two capabilities they
> have that you don't — **memory recall** and **cadence/autonomy** — using infra you already run,
> not new stacks.

## The thesis

| Pillar | Reference project | Do you have it? |
|---|---|---|
| Work surface (task/life mgmt by conversation) | agentic-os | ✅ GSD / `.planning` — **don't rebuild** |
| Observability + config control | *(nobody)* | ✅ **This dashboard** — your moat |
| Persistent semantic memory | claude-os | ⚠️ Stats only, no recall — **Gap A** |
| Autonomy / 24-7 cadence | trinity | ⚠️ Observe-only, can't launch — **Gap B** |

Goal: close Gap A and Gap B **cheaply**, by reusing `context-mode` (SQLite+FTS5), native
`~/.claude/.../memory/`, `cron`/`launchd`, and `claude -p`. No Redis, no Docker fleet, no OTel.

---

## Build order

### Phase 1 — Memory Recall panel  ← build first
**Why first:** highest value-per-hour, zero new infra, turns read-only stats into "ask my past self."

- New sidebar section `Memory` (`server-memory.mjs` + `src/MemorySection.jsx`).
- Query two existing sources: `context-mode` FTS5 index + `~/.claude/projects/**/memory/*.md`.
- UI: search box → ranked past decisions/insights with source + date + project.
- Auto-surface: on Overview, show "relevant memories" for the active project.
- **Reuse:** transcript parser + sidecar-meta patterns already in `server.mjs`.
- **Effort:** ~1 day. **Ship, then stop and use it for a week before Phase 2.**

### Phase 2 — Scheduler → Inbox loop  ← only if Phase-1 gate passes
**Gate:** you can name **3 real tasks** you'd run unattended. Can't? Skip — YAGNI.

- New section `Scheduled` (`server-schedule.mjs` + `src/ScheduleSection.jsx`).
- Writes `cron`/`launchd` entries that fire `claude -p "<prompt>"` per project.
- Results land in the **existing Inbox** — that's already your fleet view. No new observability.
- Track each run's transcript (you already parse these) for cost + outcome.
- **Effort:** ~1–2 days. **Reuse Inbox; do not build a new dashboard for runs.**

### Phase 3 — Cross-project learning (optional polish)
- Surface "patterns from Project A that apply to Project B" using the same memory index.
- Only if Phase 1 proves the recall index is good. Otherwise cut.

---

## Explicitly NOT building (YAGNI ledger)

| Skipped | Add when |
|---|---|
| Docker-isolated agent containers | You run >5 concurrent scheduled agents |
| Agent-to-agent delegation / fleet graph | A single agent provably can't do a real task |
| Redis pub-sub real-time memory | FTS5 latency measurably hurts (it won't at your scale) |
| OpenTelemetry → Grafana/Datadog | You need to share metrics with a team |
| Markdown "life OS" surface | Never — GSD already covers planning |
| Tamper-evident audit trail | You have a compliance requirement (transcripts already log everything) |

---

## Definition of done

- **Phase 1:** I can search "what did I decide about X" in the dashboard and get a dated, sourced answer. → *This is the whole win. Everything after is optional.*
- **Phase 2:** a scheduled `claude -p` run completes overnight and its result is waiting in my Inbox.

## One-line pitch (for when you write this up)

> Everyone else built the AI that *does the work*. This is the one that tells you whether your
> AI setup is actually working — and now it remembers, and it can run without you.
