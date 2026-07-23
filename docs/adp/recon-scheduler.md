# Recon — Gap B Scheduler (cron/launchd + `claude -p` → Inbox)

Read-only recon of `/Users/ali.mohammad/learnspace/loushai/dashboard/`. Goal: know the exact
touchpoints for a scheduled job that runs `claude -p` on a cadence and writes results INTO the Inbox.

Bottom line: there is **no existing scheduler of any kind** (no cron, launchd, setInterval-timer job,
or config for it). The `claude -p` spawn pattern, the inbox item shape, and the digest content all
already exist and are directly reusable. A scheduler is a genuinely new, additive piece.

---

## 1. Inbox — data source, item shape, write path

### Frontend
- `src/InboxSection.jsx` — three tabs: **Inbox** / **Daily digest** / **Notifications**.
  - `Inbox` component: `GET /api/inbox`, polls every 30s (`setInterval(load, 30_000)`). Dedupes by `key`.
    Filters client-side by two plane chips (`work` / `harness`, both ON by default). Clearing/snoozing an
    item calls `POST /api/inbox/done`.
  - `Digest` component: `GET /api/digest?days=N` (usage/cost digest — see §3, distinct from career digest).

### Backend — the inbox is ASSEMBLED ON READ, not stored
There is **no inbox JSON store / DB**. `GET /api/inbox` recomputes items every call. So a scheduled job
does **not** "insert an inbox row" — it produces some artifact that one of the existing collectors turns
into an item. The two clean ways to make a scheduled result appear in the inbox:
  1. Have the job create an **approval** (`readApprovals()` → `status: 'proposed'`), a **board** entry,
     or write a file a collector already scans; OR
  2. Add a small new collector inside `inboxItems()` that reads the job's own output file.

Key code (all in `server.mjs`):
- `server.mjs:2583` `async function inboxItems()` — builds the array from many sources:
  approvals, `costAlerts()`, `evalRuns()`, live `chats` (quick-action runs), `readBoard()` tickets,
  library recommendations, then `items.push(...workItems(snap))` (delivery risk, §5), then CI-red.
- `server.mjs:2626` `for (const i of items) i.plane ||= 'harness'` — **default plane is `harness`**;
  `workItems()` and CI explicitly set `plane: 'work'`. This is where the two-plane boundary is stamped.
- `server.mjs:2643` done/snooze state read from `readMeta().inboxDone`.
- `server.mjs:2657` `app.get('/api/inbox')` — filters by optional `?plane=`.
- `server.mjs:2663` `app.post('/api/inbox/done')` — `{key, done}` clears, `{key, snoozeHours}` snoozes;
  persisted to `dashboard-meta.json` (see below).

### Inbox item schema (the shape every collector pushes)
```js
{
  key,        // string, stable & unique — dedupe + done-state key (e.g. 'appr:<id>', 'ci:red:<repo>')
  kind,       // 'approval'|'budget'|'eval'|'action'|'session'|'board'|'recommendation'|'review'|'ticket'|'ci'|...
  severity,   // 'error' | 'warning' | 'info'   (sort order: error→warning→info, then ts desc)
  text,       // human-readable line shown in the row
  ts,         // epoch ms
  section,    // routing hint for onNav: 'governance'|'reliability'|'workflows'|'delivery'|'board'|'library'|...
  plane,      // 'work' | 'harness'  (omit → defaults to 'harness' at server.mjs:2626)
  // optional, work-items add: link, owner, nudge (COPY-only text), ageWorkDays, cycles, ...
}
```
Runtime-added by `inboxItems()` return: `done`, `snoozedUntil` (from `inboxDone`).

### Meta store (the only persisted inbox state)
- `server.mjs:504` `const META_FILE = path.join(CLAUDE, 'dashboard-meta.json')` (i.e. `~/.claude/dashboard-meta.json`).
- `server.mjs:505` `readMeta()` — `JSON.parse(readFileSync)` or `{ tags: {} }`.
- Written via `fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))` (see `/api/inbox/done`).
- Relevant keys already in meta: `inboxDone`, `recsDismissed`, `notify` (`{desktop, slackWebhook}`),
  `tags`, `baselines`, `teamHarness`. **A scheduler config key would naturally live here too**, or in a
  new dedicated file — see §4.

---

## 2. `claude -p` invocation pattern (REUSE THIS — do not invent a new one)

Three call sites, all `spawn` from `node:child_process` (imported `server.mjs:5`:
`import { spawn, exec, execFile, spawnSync } from 'node:child_process'`). `const WIN = process.platform === 'win32'` (`server.mjs:39`) is passed as `shell: WIN`.

### Canonical reusable helper — `runAgent()` (`server.mjs:2536`-ish, ~line 2536+)
```js
function runAgent({ cwd, prompt, model, timeoutMs = 1800_000, resume }) {
  return new Promise(resolve => {
    const args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions']
    if (model) args.push('--model', model)
    if (resume) args.push('--resume', resume)
    const child = spawn('claude', args, { cwd, env: process.env, shell: WIN })
    let out = '', err = ''
    const timer = setTimeout(() => { try { child.kill() } catch {}; resolve({ error: 'timeout ...' }) }, timeoutMs)
    child.stdout.on('data', d => out += d)
    child.stderr.on('data', d => err += d)
    child.on('error', e => { clearTimeout(timer); resolve({ error: e.message }) })
    child.on('exit', () => {
      clearTimeout(timer)
      try {
        const j = JSON.parse(out)                        // --output-format json → one JSON blob
        const blocked = /^BLOCKED:\s*(.+)/m.exec(j.result || '')
        resolve({ result: j.result || '', blocked: blocked?.[1] || null,
                  cost: j.total_cost_usd || 0, turns: j.num_turns || 0,
                  sessionId: j.session_id || null, ms: j.duration_ms || 0 })
      } catch { resolve({ error: (err || out).slice(0, 1200) || 'no output from claude' }) }
    })
  })
}
```
This is the one to reuse: `Promise`-based, JSON output, cost/turns/sessionId captured, timeout+kill.
`runAgent` is not exported — the scheduler either imports a refactored copy or duplicates the tiny helper.

### Other two spawn sites (same pattern, different output-format)
- `server.mjs:~/api/actions/run` (quick actions): streams `--output-format stream-json --verbose`, keeps
  the child in a live `chats` Map, SSE to the UI. Cursor variant uses `spawn('cursor-agent', ['-p', prompt, '--output-format','stream-json','-f'], ...)`. Global cap of 3 concurrent action runs.
- `server.mjs:~/api/team/design/review`: inline `spawn('claude', ['-p', rubric, '--output-format','json','--dangerously-skip-permissions'], { cwd: HOME, env: process.env, shell: WIN })`, 180s timeout, parses `j.result` as JSON.

Common invariants: binary `claude`, first args `-p <prompt>`, `--output-format json` (batch) or
`stream-json` (live), `--dangerously-skip-permissions`, `{ cwd, env: process.env, shell: WIN }`,
`setTimeout` kill guard. **The scheduler should call `runAgent`-style batch (json), not stream.**

---

## 3. career-digest — the "first cadence output", confirmed gated

- `career-digest.mjs` — pure function `export function weeklyDigest(snap = {})`. Deterministic, **no LLM**.
  Top-of-file comment is the confirmation of the gated-scheduler status:
  > `// G10 weekly digest. ... No LLM, no cron — the scheduler half of the roadmap stays gated; this is the digest CONTENT on demand.`
- Output shape (all numeric deltas week-over-week, plus two string arrays):
  ```js
  { week, xp, xpDelta, sessions, sessionsDelta, oneShotRate, oneShotDelta,
    changeFail, changeFailDelta, aiCodeShare, movedKpis, droveDecisions, keystones,
    wins: string[], focus: string[] }
  ```
- Wired to a route already: `server-career.mjs:20` `import { weeklyDigest }`, `server-career.mjs:329`
  `app.get('/api/career/digest', ...)` → `res.json(weeklyDigest(cache || build()))`. On-demand only.
- Note the naming clash: `GET /api/digest` in `server.mjs:2676` is a **different** thing (usage/cost digest
  over `?days=N` from `collectUsage()`); the career digest is `GET /api/career/digest`. The scheduler's
  "first cadence" = the **career** weekly digest content, which is ready to be produced on a timer.

So a scheduler MVP: on cadence, compute `weeklyDigest(snapshot)` (no `claude -p` needed for this one),
persist it, and surface it as an inbox item (`section:'career'`, `plane:'harness'`).

---

## 4. Existing scheduler / cron / config — NONE exists

- **No cron / launchd / job runner.** grep for `cron|launchd|setInterval|schedul|cadence` matched only:
  - `.claude/launch.json` (editor launch config, unrelated to job scheduling),
  - two `setInterval` uses in `server.mjs` that are **poll loops, not a scheduler**:
    the inbox→Slack push (`setInterval(async () => { ... inboxItems() ... }` guarded by `notify.slackWebhook`)
    and the 30s client poll in `InboxSection.jsx`.
- **Runtime config** — `config.json` at repo root is tiny and NOT a general config file:
  ```json
  { "jiraAPIKey": "<secret>", "email": "ali.mohammad@almosafer.com" }
  ```
  (Read by the eng/jira layer.) It is NOT where per-feature runtime state lives.
- **De-facto runtime state store** = `~/.claude/dashboard-meta.json` via `readMeta()` /
  `fs.writeFileSync(META_FILE, ...)` (§1). This is where a `scheduler` key (`{ enabled, jobs:[{id,cmd,cadence,cwd,model,lastRun,plane}] }`) fits with zero new plumbing — or a dedicated
  `~/.claude/dashboard-scheduler.json` if you want it isolated from user-cleared inbox state.
- **Server boot point** — `server.mjs:~end` (`app.listen(PORT, ...)`, `PORT = process.env.DASH_PORT || 5178`):
  ```js
  app.listen(PORT, () => {
    console.log(`[claude-dashboard] API on http://localhost:${PORT}`)
    engSnapshot(true).then(...).catch(() => {})   // warms plane-A at boot
  })
  ```
  A scheduler would boot here (start its interval/timer loop after listen, same place `engSnapshot(true)`
  is kicked off). **In-process `setInterval` timer is the lazy correct choice** — matches the existing
  Slack-push loop; no launchd/cron plist needed unless persistence across dashboard restarts is required.
- **Launch** — `package.json` `"dev": "concurrently -k \"node --watch server.mjs\" \"vite --open\""`,
  `"start": "npm run dev"`. Single long-lived node process → an in-process scheduler just works.

---

## 5. Guardrails to respect (all confirmed in code)

1. **Never auto-send; nudge = copy-for-human.** `server.mjs:31` (header):
   `// * No auto-nudge / auto-ping: every "nudge" this server emits is a line of text for a human to send.`
   and `InboxSection.jsx`: `// "Nudge" COPIES a line for a human to send. It never sends anything. ...
   permanent.` → The scheduler must NEVER message anyone; it only produces inbox items / copy text.
2. **No cross-engineer transcript ingestion (plane B self-only, forever).** `server.mjs:24-28` header:
   plane B (transcripts/tokens/cost/session times) reads ONLY the local `~/.claude` of the viewer; no
   endpoint takes a user/machine/engineer param; no per-person aggregate. Enforced structurally by
   never accepting such params. Also asserted in `test/eng-privacy.test.js`, `test/team-privacy.test.js`,
   `test/career-transcripts.test.mjs`. → Scheduled `claude -p` jobs must run against the local machine
   only; never fan out over other engineers' transcripts.
3. **Two-plane boundary is stamped in the payload.** `server.mjs:2626` `i.plane ||= 'harness'`;
   `work` is set only by `workItems()` / CI collectors reading team-visible artifacts. The single
   permitted cross-plane join is `/api/roi` at cohort level (drops author before aggregating,
   `server.mjs:29-30`). → A scheduled digest/insight is `plane:'harness'`.

---

## Minimal change plan for a NEW scheduler file

Reuse everything above; add one small module.

- **New file `scheduler.mjs`** exporting `startScheduler({ runAgent, inboxEmit, readMeta, writeMeta })`:
  - reads `readMeta().scheduler` (`{ enabled, jobs:[{ id, cadence, cmd|kind, cwd, model, lastRun }] }`);
    if absent/`enabled:false`, no-op.
  - single `setInterval` (e.g. 60s tick) that checks each job's `cadence` vs `lastRun`; when due, either
    (a) compute `weeklyDigest(...)` (no spawn) for the career cadence, or (b) call `runAgent({cwd,prompt,model})`.
  - on result: write to `~/.claude/dashboard-scheduler-out/<jobId>.json` (or push an approval), update
    `lastRun` in meta.
- **Refactor** `runAgent` in `server.mjs` to be exported (or pass it into `startScheduler`) so the spawn
  pattern is shared, not duplicated.
- **New collector** inside `inboxItems()` (`server.mjs:2583`): read the scheduler output files and push
  items `{ key:'sched:<jobId>:<ts>', kind:'digest', severity:'info', section:'career', plane:'harness', text, ts }`.
  (Everything already defaults to `plane:'harness'`, satisfying guardrail 3.)
- **Boot** `startScheduler(...)` inside the existing `app.listen(PORT, ...)` callback, next to `engSnapshot(true)`.
- **Config UI** (optional): a `/api/scheduler` GET/PUT pair persisting `meta.scheduler`, mirroring the
  `/api/notify` GET/PUT pattern (`server.mjs:~/api/notify`).
- **Guardrails**: jobs run with `cwd` = a local project only; output is `plane:'harness'`; never send —
  results land in the inbox as copy/info only.
