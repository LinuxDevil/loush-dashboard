import fs from 'node:fs'
import path from 'node:path'

const TICK_MS = 60_000
const DEFAULT_MAX_RETRIES = 2
const RETRY_DELAY_MS = 5 * 60_000 // ponytail: fixed 5-min backoff, not exponential — add if a job needs it

export function nextSchedule({ ok, attempt = 0, maxRetries = DEFAULT_MAX_RETRIES, cadenceMs, ts }) {
  if (!ok && attempt < maxRetries) {
    const a = attempt + 1
    return { lastRun: ts - cadenceMs + RETRY_DELAY_MS, attempt: a, retry: a }
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

function writeOut(CLAUDE, jobId, result) {
  const { OUT } = schedulerPaths(CLAUDE)
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, jobId.replace(/[^\w.-]/g, '_') + '.json'), JSON.stringify(result, null, 2))
}

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
    for (const [i, p] of (r.proposals || []).entries())
      items.push({ key: `sched:remedy:${r.jobId}:${r.ts}:${i}`, kind: 'recommendation', plane: 'harness', section: p.section || 'reliability',
        severity: p.severity || 'warning', ts: r.ts, text: `remediation proposed (${p.signal}): ${p.action}`.slice(0, 200) })
  }
  return items
}

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
    started.push(r.ok ? `${id} ✓` : `${id} ✗ ${j.error || r.status}`)
  }
  return `dispatched ${started.filter(s => s.endsWith('✓')).length}/${plan.ids.length}: ${started.join(', ')}`.slice(0, 160)
}

export function remediationPlan(items = []) {
  const props = []
  for (const it of items) {
    if (it.kind === 'eval' && it.severity === 'error')
      props.push({ signal: 'eval-regression', verb: 'gov-rollback', severity: 'error', section: 'governance',
        reason: it.text, action: 'restore last-good harness config — Governance → Versions → rollback' })
    else if (it.kind === 'ci') {
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
  const inFlight = new Set()
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
        const c = readSchedulerConfig(CLAUDE)
        const j = (c.jobs || []).find(x => x.id === job.id)
        if (j) {
          const sched = nextSchedule({ ok: result.ok, attempt: j.attempt, maxRetries: job.maxRetries, cadenceMs, ts: result.ts })
          j.lastRun = sched.lastRun; j.attempt = sched.attempt
          result.retry = sched.retry
          writeSchedulerConfig(CLAUDE, c)
        }
        writeOut(CLAUDE, job.id, result)
        log(`[scheduler] ${job.id} ${result.ok ? 'ok' : `FAILED: ${result.error}${result.retry ? ` (retry ${result.retry})` : ' (giving up until next cadence)'}`}`)
      }).finally(() => inFlight.delete(job.id))
    }
  }
  const timer = setInterval(() => { tick().catch(e => log('[scheduler] tick error ' + e.message)) }, TICK_MS)
  timer.unref?.()
  log(`[scheduler] started (enabled=${readSchedulerConfig(CLAUDE).enabled}, tick=${TICK_MS / 1000}s)`)
  return timer
}
