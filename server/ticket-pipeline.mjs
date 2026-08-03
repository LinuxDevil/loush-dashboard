/**
 * The ticket pipeline's runner — spec §3 and §5.
 *
 * The architecture is `server/autopilot.mjs`'s, wholesale and for its reasons: a 20s POLLER rather
 * than a chain of callbacks (the manifest is a file and a `claude -p` child outlives the request),
 * and every step it takes is the SAME loopback HTTP endpoint the button in the UI hits, so a guard
 * — already running, a refused run, a stage with no implementation — applies identically whether a
 * person or the ticker pressed it.
 *
 * What it does NOT copy is autopilot's logic. The order lives in `lib/stage-graph.mjs` as declared
 * data; `nextAction` reads it and nothing here encodes a sequence.
 *
 * Two rules that are load-bearing rather than tidy:
 *   - `running` is passed to `nextAction`. A run writes its status only when it FINISHES, so
 *     mid-run the stage still reads as "no status" and the next tick would start it a second time.
 *     The doubled stages would be the paid ones.
 *   - The poller never re-runs anything. `ok`, `failed`, `unavailable`, `skipped` — and stale — are
 *     all terminal to it. There is deliberately no "retry the failed ones" convenience: its absence
 *     is what bounds a full pipeline to one execution of each stage, ever, unless a human clicks.
 */

import fs from 'node:fs'
import path from 'node:path'

import { PORT } from './dashboard-core.mjs'
import { cfgFor } from './eng.mjs'
import { normalizeKey, repoFor, workspaceById } from './ticket.mjs'
import { entry, readManifest, writeManifest } from '../lib/dossier.mjs'
import { STAGES as GRAPH, nextAction, pendingPremarks, refusedRun, staleStages } from '../lib/stage-graph.mjs'
import { dossierCache } from '../lib/paths.mjs'
import { createTailer } from '../lib/transcript-tail.mjs'

const TICK_MS = 20_000
const KEY = k => String(k || '').toUpperCase()
const DECL = new Map(GRAPH.map(s => [s.stage, s]))

// ---------------------------------------------------------------------------------------------
// The stage registry
// ---------------------------------------------------------------------------------------------

/**
 * Where implementations are looked up, rather than imported.
 *
 * Static imports would make a stage module that has not been written yet a server that will not
 * boot. Later phases add `decompose` and the remaining route stages, so a missing module has to be
 * an ordinary, explainable outcome — an `unavailable` entry naming what is missing — and never a
 * crash. Modules that DO load are memoised; the ones that do not are retried, so a module landing
 * on disk is picked up without a restart.
 */
const MODULE_FILES = ['./stages/jira.mjs', './stages/figma.mjs', './stages/sheet.mjs', './stages/repo.mjs', './stages/agents.mjs', './stages/decompose.mjs']
const loaded = new Map()   // file → {STAGES}
const loadFailed = new Map()   // file → why, for the reason text

async function loadModules() {
  for (const file of MODULE_FILES) {
    if (loaded.has(file)) continue
    try { loaded.set(file, await import(file)); loadFailed.delete(file) }
    catch (e) {
      // "not written yet" and "written, but broken" are different problems for whoever reads the
      // reason, so the message is kept rather than flattened to "missing".
      loadFailed.set(file, e?.code === 'ERR_MODULE_NOT_FOUND' ? 'not on disk yet' : String(e?.message || e).slice(0, 200))
    }
  }
}

/** `{fn}` for a stage that can run, or `{reason}` in words for one that cannot. */
export async function stageImpl(name) {
  await loadModules()
  for (const mod of loaded.values()) {
    const fn = mod?.STAGES?.[name]
    if (typeof fn === 'function') return { fn }
  }
  const notes = [...loadFailed].map(([f, why]) => `${f.replace('./stages/', '')} (${why})`)
  return {
    reason: `the \`${name}\` stage has no implementation on this server: no module under server/stages/ exports it${notes.length ? ` — ${notes.join(', ')}` : ''}`,
  }
}

// ---------------------------------------------------------------------------------------------
// Run state — on the SERVER, keyed by ticket
// ---------------------------------------------------------------------------------------------

/**
 * Runs in flight and the tickets the poller is advancing.
 *
 * Server-side because `src/App.jsx`'s `refresh()` bumps a `tick` that is part of the section key, so
 * a refresh remounts the section — client-owned run state would be torn down mid-run — and because
 * the child process outlives the request that started it either way.
 *
 * `auto` is in memory on purpose: a restart stops the auto-advance, and nothing is lost, because
 * every stage's status is already on disk. Pressing Run again resumes from exactly where it stopped.
 */
const runs = new Map()   // `<ws>:<KEY>:<stage>` → {startedAt, stage, kind}
const auto = new Map()   // `<ws>:<KEY>` → {wsId, key, stopped}

const runKey = (wsId, key, stage) => `${wsId}:${KEY(key)}:${stage}`
const autoKey = (wsId, key) => `${wsId}:${KEY(key)}`
const runningStages = (wsId, key) => GRAPH.map(s => s.stage).filter(s => runs.has(runKey(wsId, key, s)))

// ---------------------------------------------------------------------------------------------
// The one place the manifest is written
// ---------------------------------------------------------------------------------------------

/**
 * Merge one stage's entry into the manifest — the runner owns every manifest write, so a stage
 * returning a bad entry can never corrupt another stage's.
 *
 * `provenance.premark` is applied in the SAME write: a stage naming another it can already prove is
 * unavailable (spec §3). Writing them here rather than on the next tick means the poller can never
 * attempt a premarked stage in the window between the request and the write.
 */
function commit(repoDir, key, e) {
  const m = readManifest(repoDir, key)
  const next = { ...m, stages: { ...m.stages, [e.stage]: e } }
  // `repo` is where the tracked/untracked verdict is discovered, and downstream stages read it off
  // the manifest to mark their own artifacts (spec §6).
  if (e.stage === 'repo' && e.status === 'ok') next.tracked = e.tracked !== false
  for (const p of pendingPremarks(next)) {
    next.stages[p.stage] = entry({
      stage: p.stage, status: p.status, tracked: next.tracked !== false,
      reason: `${p.reason} — recorded by the \`${p.from}\` stage, which can already prove it`,
    })
  }
  return writeManifest(repoDir, key, next)
}

// ---------------------------------------------------------------------------------------------
// Running one stage
// ---------------------------------------------------------------------------------------------

const ctxFor = (ws, key, repoDir) => ({
  repoDir, cacheDir: dossierCache(ws.id, key), key, cfg: ws.jira ? cfgFor(ws.jira.key) : null,
  manifest: readManifest(repoDir, key),
})

/**
 * Start one stage. Returns `[httpStatus, body]` so the guards read as one list, and so the poller
 * and the UI button go through exactly the same door.
 *
 * The stage itself runs AFTER the response: an agent stage takes minutes, and holding the request
 * open for it would make the button look broken and the poller's tick block on it. Every outcome
 * lands in the manifest, which is what both the UI and the next tick read.
 *
 * `impl` is a TEST SEAM, not part of the contract — the same one `jira.mjs` and `agents.mjs` use.
 * The route never passes it; a test does, because the guard being proved here is "a stage in flight
 * is not started again", which needs a run that stays in flight.
 */
export async function startStage(ws, key, stage, { impl: override } = {}) {
  const decl = DECL.get(stage)
  if (!decl) return [404, { error: `"${stage}" is not a pipeline stage` }]

  const repo = repoFor(ws)
  if (!repo.dir) return [400, { error: repo.reason }]

  const id = runKey(ws.id, key, stage)
  if (runs.has(id)) return [409, { error: `${stage} is already running for ${KEY(key)} — refusing to start a second run of the same stage` }]

  const before = readManifest(repo.dir, key)

  // A refused run halts everything (spec §6): the workspace is where the manifest GOES, so there is
  // nowhere for a later stage's output to land. The stage that raised it is exempt — re-running it
  // is the only way a human can clear the refusal.
  const refused = refusedRun(before)
  if (refused && refused.stage !== stage) {
    return [409, { error: `the run for ${KEY(key)} is halted: ${refused.reason}`, refusesRun: refused, detail: `re-run \`${refused.stage}\` once that is fixed` }]
  }

  // G1. The human ends the grilling, always — it is a session, not a run, and a button that started
  // one would be the agent deciding it was satisfied.
  if (decl.kind === 'human') {
    return [409, { error: `\`${stage}\` is a human gate, not a run — it is ended by a person, never started here`, blockedOnHuman: true }]
  }

  const impl = override ? { fn: override } : await stageImpl(stage)
  if (!impl.fn) {
    // Terminal, and honest about why. `unavailable` with a reason is a first-class outcome that
    // still lets the rest of the pipeline proceed (spec §2).
    const e = entry({ stage, status: 'unavailable', reason: impl.reason, tracked: before.tracked !== false })
    return [200, { ok: true, entry: commit(repo.dir, key, e).stages[stage] }]
  }

  const run = { id, wsId: ws.id, key: KEY(key), stage, kind: decl.kind, startedAt: Date.now() }
  runs.set(id, run)
  ;(async () => {
    try {
      const e = await impl.fn(ctxFor(ws, key, repo.dir), {})
      commit(repo.dir, key, e)
    } catch (err) {
      // A stage that throws is a bug in the stage rather than an outcome it foresaw — but the run
      // still has to become terminal, or the poller retries it every 20 seconds forever.
      try {
        commit(repo.dir, key, entry({
          stage, status: 'failed', tracked: before.tracked !== false,
          reason: `the ${stage} stage threw instead of returning an entry: ${String(err?.message || err).slice(0, 300)}`,
        }))
      } catch { /* the manifest is unwritable; the next read simply shows no status */ }
    } finally { runs.delete(id) }
  })()

  return [200, { ok: true, started: stage, kind: decl.kind, startedAt: run.startedAt }]
}

// ---------------------------------------------------------------------------------------------
// The poller
// ---------------------------------------------------------------------------------------------

/**
 * One step for one enrolled ticket, or null. Exported so the runner is testable without a clock —
 * `post` and `lookup` are the two seams, and the poller passes neither.
 */
export async function step(t, { post = loopback, lookup = workspaceById } = {}) {
  const ws = lookup(t.wsId)
  if (!ws) { t.stopped = { reason: 'nothing-runnable', detail: `the workspace ${t.wsId} is no longer open` }; return null }
  const repo = repoFor(ws)
  if (!repo.dir) { t.stopped = { reason: 'nothing-runnable', detail: repo.reason }; return null }

  const manifest = readManifest(repo.dir, t.key)
  const inFlight = runningStages(t.wsId, t.key)
  const act = nextAction(manifest, inFlight)

  if (act.do === 'stop') {
    // `nothing-runnable` while a run is in flight just means "not yet". Everything else is a real
    // stop, and the reason is kept so the page can say which of the three it was.
    if (act.reason === 'nothing-runnable' && inFlight.length && !act.refusesRun) return act
    t.stopped = act
    return act
  }

  if (act.do === 'skip') {
    commit(repo.dir, t.key, entry({ stage: act.stage, status: 'skipped', reason: act.reason, tracked: manifest.tracked !== false }))
    return act
  }

  await post(t, act.stage)
  return act
}

/**
 * The step, taken as an HTTP call on loopback. This is the property worth protecting: the poller
 * owns no privileged path into a stage, so it cannot get past a guard the button cannot.
 */
async function loopback(t, stage) {
  try {
    await fetch(`http://127.0.0.1:${PORT}/api/ticket/${encodeURIComponent(t.key)}/stages/${encodeURIComponent(stage)}/run?workspace=${encodeURIComponent(t.wsId)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    // A 4xx here is a guard doing its job. The next tick re-reads the manifest and either finds the
    // door open or does not — there is nothing to report and nothing to retry.
  } catch { /* server mid-restart; try again next tick */ }
}

async function tick() {
  for (const t of auto.values()) {
    if (t.stopped) continue
    // One step per ticket per tick (`autopilot.mjs:70-72`). The manifest this loop read is already
    // stale for this ticket, and chasing the next step is how you get two runs started.
    try { await step(t) } catch { /* one bad ticket must not stop the others */ }
  }
}

// ---------------------------------------------------------------------------------------------
// The live view (spec §5)
// ---------------------------------------------------------------------------------------------

const tailer = createTailer()

/**
 * Where an agent stage streams. Coupled by convention to `server/stages/agents.mjs`, which writes
 * `<cacheDir>/<stage>.stream.jsonl` — the log is deliberately in the disposable half, because it is
 * a transcript of a run and not something to review in a pull request.
 */
const transcriptFor = (wsId, key, stage) => path.join(dossierCache(wsId, key), `${stage}.stream.jsonl`)

const RESULT_CAP = 20_000
const capContent = c => {
  if (typeof c === 'string') return c.length > RESULT_CAP ? c.slice(0, RESULT_CAP) + `\n… (${c.length - RESULT_CAP} more chars)` : c
  try { const s = JSON.stringify(c); return s.length > RESULT_CAP ? s.slice(0, RESULT_CAP) + '…' : c } catch { return c }
}
/**
 * A stream record, trimmed for transport — the same bound `board.mjs:709` applies, for the same
 * reason: one `Read` of a large file is megabytes, and a 2s poll would ship them again every time.
 */
function trimRecord(j) {
  if (!j || typeof j !== 'object') return null
  const base = { type: j.type, timestamp: j.timestamp || null, parent_tool_use_id: j.parent_tool_use_id || null }
  if (j.type === 'result') return { ...base, duration_ms: j.duration_ms, total_cost_usd: j.total_cost_usd }
  if (!j.message) return null
  const m = j.message
  const content = Array.isArray(m.content)
    ? m.content.map(c => (c?.type === 'tool_result' ? { ...c, content: capContent(c.content) } : c))
    : m.content
  return { ...base, message: { role: m.role, model: m.model, usage: m.usage, content } }
}

/**
 * The tail of one stage's agent run.
 *
 * `offset` is a RECORD index rather than a byte offset — the client treats it as opaque and this
 * way a record can never be split across two polls. Liveness comes from the server's `runs` map and
 * never from a caller's snapshot: this panel once showed "live, 1m 40s" for a finished run because
 * it trusted a stale hint.
 */
export async function liveView(wsId, key, stage, { offset = 0, file: clientFile } = {}) {
  const r = runs.get(runKey(wsId, key, stage))
  const running = r ? { kind: r.stage, startedAt: r.startedAt } : null
  const file = transcriptFor(wsId, key, stage)

  if (!fs.existsSync(file)) {
    return {
      running, file: null, offset: 0, events: [], atEnd: true,
      // The difference between slow and broken, and the only thing on screen that says so.
      note: running
        ? 'the agent has started but has not written its transcript yet'
        : `no \`${stage}\` agent session has run for ${KEY(key)} yet`,
    }
  }

  const out = await tailer.read(file)
  if (!out.ok) return { running, file, offset: 0, events: [], atEnd: true, note: `the transcript could not be read: ${out.error?.message || 'unknown error'}` }

  const records = out.records || []
  let from = Number(offset) || 0
  if (clientFile !== file || from > records.length || from < 0) from = 0
  const events = records.slice(from).map(trimRecord).filter(Boolean)

  return {
    running, file, offset: records.length, events: events.slice(-300), atEnd: true,
    // A stage that started and produced nothing must say so in words — a silent empty panel reads
    // as "there was nothing to do" (spec §5).
    note: records.length ? null : running
      ? 'the agent has started but has not written its transcript yet'
      : `the \`${stage}\` agent ran but its transcript is empty — it produced no output at all`,
  }
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

export default function mountTicketPipeline(app) {
  const resolve = (req, res) => {
    const key = normalizeKey(req.params.key)
    if (!key) { res.status(400).json({ error: `"${req.params.key}" is not a JIRA key — expected something like ABC-1234` }); return null }
    const asked = req.query.workspace || req.body?.workspace
    if (!asked) { res.status(400).json({ error: 'a project is required — select one before opening a ticket' }); return null }
    const ws = workspaceById(String(Array.isArray(asked) ? asked[0] : asked))
    if (!ws) { res.status(404).json({ error: `"${asked}" is not one of your open projects` }); return null }
    if (!ws.jira) { res.status(400).json({ error: `${ws.name} is not linked to a JIRA board yet`, detail: 'choose which board its tickets come from, next to the project name' }); return null }
    return { key, ws }
  }

  // ---- the whole state of one run, rebuilt from the manifest on every read (spec §3, resumption) ----
  app.get('/api/ticket/:key/pipeline', (req, res) => {
    const r = resolve(req, res); if (!r) return
    const repo = repoFor(r.ws)
    if (!repo.dir) return res.json({ key: r.key, workspace: r.ws.id, available: false, reason: repo.reason })

    const manifest = readManifest(repo.dir, r.key)
    const inFlight = runningStages(r.ws.id, r.key)
    const staleBy = new Map(staleStages(manifest).map(s => [s.stage, s]))
    const a = auto.get(autoKey(r.ws.id, r.key))

    res.json({
      key: r.key, workspace: r.ws.id, available: true, dir: repo.dir,
      // Not polish: it is the only thing separating deliberate degradation from an artifact that
      // reads as durable and is not (spec §6).
      tracked: manifest.tracked !== false,
      auto: { on: !!a && !a.stopped, stopped: a?.stopped || null },
      next: nextAction(manifest, inFlight),
      refusesRun: refusedRun(manifest),
      stages: GRAPH.map(s => {
        const run = runs.get(runKey(r.ws.id, r.key, s.stage))
        return {
          stage: s.stage, kind: s.kind, hard: s.hard, soft: s.soft,
          entry: manifest.stages[s.stage] || null,
          running: run ? { startedAt: run.startedAt } : null,
          stale: staleBy.get(s.stage) || null,
        }
      }),
      staleStages: [...staleBy.keys()],
    })
  })

  // ---- the one door. The poller calls exactly this, on loopback ----
  app.post('/api/ticket/:key/stages/:stage/run', async (req, res) => {
    const r = resolve(req, res); if (!r) return
    const [status, body] = await startStage(r.ws, r.key, req.params.stage)
    res.status(status).json(body)
  })

  // ---- auto-advance: stages 1–10 unattended, then the grilling gate stops it ----
  app.post('/api/ticket/:key/pipeline/auto', async (req, res) => {
    const r = resolve(req, res); if (!r) return
    const id = autoKey(r.ws.id, r.key)
    if (req.body?.on === false) { auto.delete(id); return res.json({ ok: true, auto: { on: false, stopped: null } }) }
    const t = { wsId: r.ws.id, key: r.key, stopped: null }
    auto.set(id, t)
    await step(t)   // the first step is immediate; a 20s wait for the first row reads as broken
    res.json({ ok: true, auto: { on: !t.stopped, stopped: t.stopped } })
  })

  // ---- the live tail (spec §5), same response shape as `board.mjs:729-741` ----
  app.get('/api/ticket/:key/stages/:stage/live', async (req, res) => {
    const r = resolve(req, res); if (!r) return
    if (!DECL.has(req.params.stage)) return res.status(404).json({ error: `"${req.params.stage}" is not a pipeline stage` })
    res.json(await liveView(r.ws.id, r.key, req.params.stage, { offset: Number(req.query.offset) || 0, file: req.query.file }))
  })

  // ---- stop one stage's agent. The session id survives, so the run stays resumable ----
  app.post('/api/ticket/:key/stages/:stage/stop', async (req, res) => {
    const r = resolve(req, res); if (!r) return
    const stage = req.params.stage
    if (!runs.has(runKey(r.ws.id, r.key, stage))) return res.status(404).json({ error: `no ${stage} run is in flight for ${r.key}` })
    // The kill handle belongs to whichever module spawned the child, so it is fetched rather than
    // held here — and a module that is not on this server yet is a 404, not a crash.
    let killed = false
    try {
      const mod = await import('./stages/agents.mjs')
      const run = mod.RUNS?.get(mod.runId(r.key, stage))
      if (run) { run.kill(); killed = true }
    } catch { /* no agent module on this server */ }
    res.json({ ok: true, killed })
  })

  let busy = false
  const timer = setInterval(async () => {
    if (busy) return
    busy = true
    try { await tick() } finally { busy = false }
  }, TICK_MS)
  timer.unref()
  return timer
}
