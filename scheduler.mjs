// Gap B — the L2→L3 unlock: a cadence loop that runs jobs unattended and drops results into the
// existing attention Inbox. No new UI, no new deps: one in-process setInterval over the long-lived
// server, reusing runAgent() for `claude -p` jobs and the wired /api/career/digest for digest jobs.
//
// GUARDRAILS (autonomy additions, per ADP-PLAN.md):
//  - `enabled` defaults FALSE — the loop is opt-in, never on by first boot.
//  - Outputs are INFO-ONLY inbox items (plane:'harness', self-only). Nothing is auto-sent anywhere —
//    no Slack, no nudge field; the human reads the Inbox. (copy-for-human rule holds.)
//  - No cross-engineer / plane-A writes here. The default job (digest) runs NO LLM and only reads.
//  - Agent jobs run `claude -p` which CAN edit files — they exist but must be added explicitly by the
//    user. Blast radius = the job's cwd. Kill switch = set enabled:false (halts the next tick).
//  - `remediate` jobs (item 6 / L4a) are PROPOSE-ONLY: they map an SLO-breach signal to the exact
//    reversible command and drop it in the Inbox for a human. No autonomous execute on a shared repo.
//  - `dispatch` jobs (item 5) auto-START board tickets sitting in a trigger stage — the human curates
//    the board (the queue), the job just removes the manual ▸Start click. Every run still goes through
//    the SAME startTicket path → worktree + tracked run, gated at code-review / runs/approve. Bounded by
//    a per-tick maxDispatch and a daily cost ceiling that HALTS dispatch. Opt-in: not in DEFAULT jobs.
import fs from 'node:fs'
import path from 'node:path'

const TICK_MS = 60_000 // check every minute; jobs fire on their own cadenceMin
const DEFAULT_MAX_RETRIES = 2   // per-job, overridable via job.maxRetries
const RETRY_DELAY_MS = 5 * 60_000 // ponytail: fixed 5-min backoff, not exponential — add if a job needs it

// Item 4 (durable runs) — decide when a job runs next. Pure so it's unit-testable; the tick loop just
// applies the result. A transient failure retries after RETRY_DELAY_MS instead of parking a whole
// cadence away; once retries are exhausted (or on success) it parks the full cadence and resets.
export function nextSchedule({ ok, attempt = 0, maxRetries = DEFAULT_MAX_RETRIES, cadenceMs, ts }) {
  if (!ok && attempt < maxRetries) {
    const a = attempt + 1
    return { lastRun: ts - cadenceMs + RETRY_DELAY_MS, attempt: a, retry: a } // fire again ~5 min from now
  }
  return { lastRun: ts, attempt: 0, retry: 0 }
}

export function schedulerPaths(CLAUDE) {
  return { CONFIG: path.join(CLAUDE, 'dashboard-scheduler.json'), OUT: path.join(CLAUDE, 'dashboard-scheduler-out') }
}
const DEFAULT = { enabled: false, jobs: [{ id: 'weekly-digest', kind: 'digest', label: 'Weekly career digest', cadenceMin: 10080 }] }

export function readSchedulerConfig(CLAUDE) {
  try { return { ...DEFAULT, ...JSON.parse(fs.readFileSync(schedulerPaths(CLAUDE).CONFIG, 'utf8')) } } catch { return { ...DEFAULT } }
}
export function writeSchedulerConfig(CLAUDE, cfg) {
  const clean = { enabled: !!cfg.enabled, jobs: Array.isArray(cfg.jobs) ? cfg.jobs : DEFAULT.jobs }
  fs.writeFileSync(schedulerPaths(CLAUDE).CONFIG, JSON.stringify(clean, null, 2))
  return clean
}

// Latest result per job, read live by the inbox collector. One file per job so a job's newest run
// overwrites its previous (no unbounded growth).
function writeOut(CLAUDE, jobId, result) {
  const { OUT } = schedulerPaths(CLAUDE)
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, jobId.replace(/[^\w.-]/g, '_') + '.json'), JSON.stringify(result, null, 2))
}

// Inbox collector: surface each job's latest result. info on success, error on failure. Info-only,
// harness plane — the human decides what to do; the scheduler never acts on these itself.
export function schedulerInbox(CLAUDE) {
  const { OUT } = schedulerPaths(CLAUDE)
  const items = []
  let files = []
  try { files = fs.readdirSync(OUT).filter(f => f.endsWith('.json')) } catch { return items }
  for (const f of files) {
    let r; try { r = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')) } catch { continue }
    items.push({
      key: 'sched:' + r.jobId + ':' + r.ts, kind: 'scheduler', plane: 'harness', section: 'workflows',
      severity: r.ok ? 'info' : 'error', ts: r.ts,
      text: `scheduled ${r.label || r.jobId} ${r.ok ? 'ran' : (r.retry ? `failed, retrying (${r.retry})` : 'failed')}${r.summary ? ' — ' + r.summary : ''}${r.error ? ' — ' + r.error : ''}`.slice(0, 200),
    })
    // Item 6: each proposed remediation is its own actionable line (copy-for-human — nothing auto-runs).
    for (const [i, p] of (r.proposals || []).entries())
      items.push({ key: `sched:remedy:${r.jobId}:${r.ts}:${i}`, kind: 'recommendation', plane: 'harness', section: p.section || 'reliability',
        severity: p.severity || 'warning', ts: r.ts, text: `remediation proposed (${p.signal}): ${p.action}`.slice(0, 200) })
  }
  return items
}

// Item 5 — decide which board tickets to auto-dispatch this tick. Pure so it's testable; the job glue
// does the fetches. Cost ceiling HALTS everything; otherwise take up to `max` tickets in the trigger
// stage (never blocked ones). Already-running / dep-blocked / WIP are re-checked server-side by startTicket.
export function dispatchPlan({ tickets = [], stage = 'backlog', max = 1, project = null, todayUSD = 0, ceiling = 0 }) {
  if (ceiling && todayUSD >= ceiling) return { held: `daily cost ceiling reached ($${todayUSD.toFixed(2)} ≥ $${ceiling})`, ids: [] }
  let c = tickets.filter(t => t.stage === stage && !t.blocked)
  if (project) c = c.filter(t => t.project === project)
  return { held: null, ids: c.slice(0, Math.max(1, Number(max) || 1)).map(t => t.id) }
}

async function runDispatchJob(port, job) {
  const get = (p) => fetch(`http://localhost:${port}${p}`, { signal: AbortSignal.timeout(15_000) }).then(r => r.json())
  const ceiling = Number(job.dailyCeilingUSD) || 0
  const todayUSD = ceiling ? (await get('/api/gov/costs?days=1').catch(() => ({}))).todayUSD || 0 : 0
  const board = await get('/api/board')
  const plan = dispatchPlan({ tickets: board.tickets, stage: job.triggerStage || 'backlog', max: job.maxDispatch, project: job.project, todayUSD, ceiling })
  if (plan.held) return `held — ${plan.held}`
  if (!plan.ids.length) return `nothing in "${job.triggerStage || 'backlog'}" to dispatch`
  const started = []
  for (const id of plan.ids) {
    const r = await fetch(`http://localhost:${port}/api/board/tickets/${id}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20_000) })
    const j = await r.json().catch(() => ({}))
    started.push(r.ok ? `${id} ✓` : `${id} ✗ ${j.error || r.status}`) // startTicket's own guards (running/deps/WIP) surface here
  }
  return `dispatched ${started.filter(s => s.endsWith('✓')).length}/${plan.ids.length}: ${started.join(', ')}`.slice(0, 160)
}

// Item 6 (L4a) — the policy engine: map an SLO-breach signal to the reversible verb that fixes it.
// Input is the EXISTING inbox signals (kind:'eval' = harness eval regression, kind:'ci' = red main) so
// the breach thresholds live in ONE place (the inbox collectors), not re-derived here. PROPOSE-ONLY:
// it emits the exact reversible command for a human to run. Auto-EXECUTE on a shared repo is deliberately
// NOT wired — it contradicts this app's copy-for-human invariant (server.mjs header) and is a real
// deploy/incident decision, not a scheduler default. Arming it is a separate, explicit build.
export function remediationPlan(items = []) {
  const props = []
  for (const it of items) {
    if (it.kind === 'eval' && it.severity === 'error') // 0% pass = a clear harness regression (partial dips stay propose-nothing)
      props.push({ signal: 'eval-regression', verb: 'gov-rollback', severity: 'error', section: 'governance',
        reason: it.text, action: 'restore last-good harness config — Governance → Versions → rollback' })
    else if (it.kind === 'ci') { // red main (plane A / shared repo)
      const repo = String(it.key || '').replace('ci:red:', '')
      props.push({ signal: 'red-main', verb: 'git-revert', severity: 'error', section: 'delivery', repo,
        reason: it.text, action: `review the culprit commit, then: git -C <${repo}> revert --no-edit HEAD && git push` })
    }
  }
  return props
}

async function runRemediateJob(port) {
  const items = await fetch(`http://localhost:${port}/api/inbox`, { signal: AbortSignal.timeout(15_000) }).then(r => r.json()).catch(() => [])
  const proposals = remediationPlan(Array.isArray(items) ? items : items.items || [])
  const summary = proposals.length
    ? `${proposals.length} SLO breach${proposals.length === 1 ? '' : 'es'} → proposed: ${[...new Set(proposals.map(p => p.verb))].join(', ')} (propose-only)`
    : 'no SLO breaches — nothing to remediate'
  return { summary, proposals }
}

async function runDigestJob(port) {
  const r = await fetch(`http://localhost:${port}/api/career/digest`, { signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error('digest endpoint ' + r.status)
  const d = await r.json()
  const dd = (n, v) => v == null ? '' : ` (${v >= 0 ? '+' : ''}${v})`
  return `week ${d.week ?? '?'}: ${d.xp} xp${dd('xp', d.xpDelta)}, ${d.sessions} sessions${dd('s', d.sessionsDelta)}, ${Math.round((d.oneShotRate || 0) * 100)}% one-shot · ${d.wins?.length || 0} wins, ${d.focus?.length || 0} focus items`
}

// One job → one result record. Never throws to the tick loop; failures are recorded as items.
async function runJob(job, deps) {
  const base = { jobId: job.id, kind: job.kind, label: job.label || job.id, ts: Date.now() }
  try {
    if (job.kind === 'digest') return { ...base, ok: true, summary: await runDigestJob(deps.port) }
    if (job.kind === 'dispatch') return { ...base, ok: true, summary: await runDispatchJob(deps.port, job) }
    if (job.kind === 'remediate') { const { summary, proposals } = await runRemediateJob(deps.port); return { ...base, ok: true, summary, proposals } }
    if (job.kind === 'agent') {
      if (!job.prompt || !job.cwd) throw new Error('agent job needs prompt + cwd')
      const r = await deps.runAgent({ cwd: job.cwd, prompt: job.prompt, model: job.model, timeoutMs: job.timeoutMs || 900_000 })
      if (r.error) throw new Error(r.error)
      return { ...base, ok: true, summary: (r.result || '').slice(0, 160), cost: r.cost || 0 }
    }
    throw new Error('unknown job kind: ' + job.kind)
  } catch (e) { return { ...base, ok: false, error: String(e.message || e).slice(0, 200) } }
}

export function startScheduler(deps) {
  const { CLAUDE, log = () => {} } = deps
  const inFlight = new Set() // per-job concurrency guard — a slow job never double-fires or overlaps itself
  const tick = async () => {
    const cfg = readSchedulerConfig(CLAUDE)
    if (!cfg.enabled) return
    const now = Date.now()
    for (const job of cfg.jobs || []) {
      if (job.enabled === false || inFlight.has(job.id)) continue
      const cadenceMs = Math.max(1, Number(job.cadenceMin) || 0) * 60_000
      if (job.lastRun && now - job.lastRun < cadenceMs) continue
      inFlight.add(job.id)
      runJob(job, deps).then(result => {
        // re-read + persist so a config edit mid-run isn't clobbered
        const c = readSchedulerConfig(CLAUDE)
        const j = (c.jobs || []).find(x => x.id === job.id)
        if (j) {
          const sched = nextSchedule({ ok: result.ok, attempt: j.attempt, maxRetries: job.maxRetries, cadenceMs, ts: result.ts })
          j.lastRun = sched.lastRun; j.attempt = sched.attempt
          result.retry = sched.retry // surfaced in the inbox text
          writeSchedulerConfig(CLAUDE, c)
        }
        writeOut(CLAUDE, job.id, result)
        log(`[scheduler] ${job.id} ${result.ok ? 'ok' : `FAILED: ${result.error}${result.retry ? ` (retry ${result.retry})` : ' (giving up until next cadence)'}`}`)
      }).finally(() => inFlight.delete(job.id))
    }
  }
  const timer = setInterval(() => { tick().catch(e => log('[scheduler] tick error ' + e.message)) }, TICK_MS)
  timer.unref?.() // don't hold the process open for the scheduler alone
  log(`[scheduler] started (enabled=${readSchedulerConfig(CLAUDE).enabled}, tick=${TICK_MS / 1000}s)`)
  return timer
}
