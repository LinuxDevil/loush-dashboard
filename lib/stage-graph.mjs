// The pipeline's dependency graph, and the one function that decides what runs next.
//
// The graph is DATA (spec §1's stage table, transcribed). `nextAction` reads it and encodes no order
// of its own, so adding a stage is a row here rather than a branch somewhere.
//
// `nextAction` is pure — no fs, no clock, no network — because it is the only thing standing between
// a free re-fetch and four paid agent runs. Time comes in as `now` where wording needs it.

/**
 * Hard input: the stage cannot run without it, so a non-`ok` upstream makes this stage `skipped`.
 * Soft input: the stage runs without it and records the gap in `provenance.handoff.excluded`.
 */
export const STAGES = [
  { stage: 'ticket', kind: 'route', hard: [], soft: [] },
  { stage: 'links', kind: 'route', hard: ['ticket'], soft: [] },
  { stage: 'jira-linked', kind: 'route', hard: ['links'], soft: [] },
  { stage: 'confluence', kind: 'route', hard: ['links'], soft: [] },
  { stage: 'sheet', kind: 'route', hard: ['links'], soft: [] },
  { stage: 'figma', kind: 'route', hard: ['links'], soft: [] },
  { stage: 'repo', kind: 'route', hard: [], soft: [] },
  { stage: 'design-read', kind: 'agent', hard: ['figma'], soft: ['sheet'] },
  { stage: 'ac', kind: 'agent', hard: ['ticket', 'repo'], soft: ['design-read', 'sheet', 'confluence'] },
  { stage: 'tests', kind: 'agent', hard: ['ac'], soft: ['repo'] },
  { stage: 'grilling', kind: 'human', hard: ['ticket', 'ac'], soft: ['links', 'jira-linked', 'confluence', 'sheet', 'figma', 'repo', 'design-read', 'tests'] },
  { stage: 'decompose', kind: 'agent', hard: ['ticket', 'repo', 'ac'], soft: ['grilling', 'tests'] },
  { stage: 'blast-radius', kind: 'route', hard: ['decompose'], soft: [] },
  { stage: 'subtickets', kind: 'route', hard: ['decompose'], soft: ['blast-radius'] },
]

const BY_STAGE = new Map(STAGES.map(s => [s.stage, s]))
const inputs = s => [...s.hard, ...s.soft]

/**
 * Refuse a malformed graph at import time. A typo in an input name would otherwise strand the stage
 * that depends on it forever — a pipeline that quietly stops two stages short, with no error.
 */
export function validateGraph(graph = STAGES) {
  const byStage = new Map(graph.map(s => [s.stage, s]))
  const problems = []
  for (const s of graph) {
    for (const dep of inputs(s)) if (!byStage.has(dep)) problems.push(`stage "${s.stage}" depends on unknown stage "${dep}"`)
    if (!['route', 'agent', 'human'].includes(s.kind)) problems.push(`stage "${s.stage}" has unknown kind "${s.kind}"`)
  }
  const state = new Map()   // 1 = on the current path, 2 = cleared
  const walk = (name, path) => {
    if (state.get(name) === 2) return
    if (state.get(name) === 1) { problems.push(`cycle: ${[...path.slice(path.indexOf(name)), name].join(' → ')}`); return }
    state.set(name, 1)
    for (const dep of inputs(byStage.get(name) || { hard: [], soft: [] })) if (byStage.has(dep)) walk(dep, [...path, name])
    state.set(name, 2)
  }
  for (const s of graph) walk(s.stage, [])
  return [...new Set(problems)]
}

const bad = validateGraph()
if (bad.length) throw new Error(`stage graph is malformed: ${bad.join('; ')}`)

const stages = manifest => manifest?.stages || {}

/**
 * A stage's `provenance.refusesRun` (spec §3) — the failure was a precondition of the run *existing*,
 * not a missing input to carry on past. Reading it here is pure; it is already in the manifest.
 */
export function refusedRun(manifest) {
  for (const e of Object.values(stages(manifest))) {
    if (e?.provenance?.refusesRun) return { stage: e.stage, signal: e.provenance.refusesRun, reason: e.reason }
  }
  return null
}

/**
 * The `provenance.premark` entries a stage asked for that are not in the manifest yet — a stage naming
 * another it can already prove is unavailable. Pure: the runner writes them, this only says which.
 *
 * An already-written premark does not appear, so applying the list twice is a no-op, and once written
 * the stage is terminal to the poller by the ordinary "has a status" rule.
 */
export function pendingPremarks(manifest) {
  const st = stages(manifest)
  const out = []
  for (const e of Object.values(st)) {
    for (const [stage, mark] of Object.entries(e?.provenance?.premark || {})) {
      if (!st[stage]?.status) out.push({ stage, ...mark, from: e.stage })
    }
  }
  return out
}

/**
 * The single next action for one run.
 *
 * @param {object} manifest        as `lib/dossier.mjs` reads it — `{stages: {<stage>: entry}}`
 * @param {string[]} [running]     stages whose run is in flight. A run writes its status when it
 *                                 finishes, so without this the poller would see "no status" and
 *                                 start it again — `autopilot.mjs:31`'s `boardRuns.has` check.
 * @returns {{do: 'run', stage, kind, passed, excluded} |
 *           {do: 'skip', stage, reason} |
 *           {do: 'stop', reason: 'blocked-on-human'|'nothing-runnable'|'all-done', stage?}}
 *
 * It advances ONLY a stage with no `status` recorded. `ok`, `failed`, `unavailable`, `skipped` — or
 * merely stale — are all terminal to the poller. That one rule bounds a full pipeline to one
 * execution of each stage, ever, unless a human clicks. There is deliberately no "re-run the failed
 * ones" convenience here; its absence is the design.
 */
export function nextAction(manifest, running = []) {
  const st = stages(manifest)
  const inFlight = new Set(running)
  let pending = false

  // A refused run halts everything, not just a branch — the workspace is where the manifest goes, so
  // there is nowhere for a later stage's output to land. Reported as `nothing-runnable` because the
  // three stop reasons are the whole vocabulary; `refusesRun` rides along so the caller can say why.
  const refused = refusedRun(manifest)
  if (refused) return { do: 'stop', reason: 'nothing-runnable', refusesRun: refused }

  // Requested but not yet written by the runner. Honoured here too so a premarked stage is never
  // attempted in the window between the request and the write.
  const premarked = new Set(pendingPremarks(manifest).map(p => p.stage))

  for (const s of STAGES) {
    if (st[s.stage]?.status) continue                    // terminal to the poller, whatever it says
    if (premarked.has(s.stage) || inFlight.has(s.stage)) { pending = true; continue }

    // An upstream with no status yet is not a failure — it simply has not had its turn.
    const waiting = s.hard.filter(d => !st[d]?.status)
    if (waiting.length) { pending = true; continue }

    const broken = s.hard.find(d => st[d].status !== 'ok')
    if (broken) {
      return { do: 'skip', stage: s.stage, reason: `${broken} is ${st[broken].status}, and ${s.stage} cannot run without it` }
    }

    // Soft inputs never block. The caller records the gap in `provenance.handoff.excluded`, which is
    // the only trace that an artifact was generated from less than full context.
    const passed = [...s.hard, ...s.soft.filter(d => st[d]?.status === 'ok')]
    const excluded = s.soft.filter(d => st[d]?.status !== 'ok')

    // G1. The human ends the grilling — the agent never decides it is satisfied, and nothing past
    // this gate is the poller's to advance.
    if (s.kind === 'human') return { do: 'stop', reason: 'blocked-on-human', stage: s.stage }

    return { do: 'run', stage: s.stage, kind: s.kind, passed, excluded }
  }

  return { do: 'stop', reason: pending ? 'nothing-runnable' : 'all-done' }
}

const MIN = 60_000, UNITS = [['day', 86_400_000], ['hour', 3_600_000], ['minute', MIN]]
const ago = (ms, now) => {
  const d = now - ms
  if (!Number.isFinite(d) || d < MIN) return 'just now'
  for (const [name, size] of UNITS) {
    const n = Math.floor(d / size)
    if (n >= 1) return `${n} ${name}${n === 1 ? '' : 's'} ago`
  }
  return 'just now'
}

/** Every stage this one reads, transitively — the walk staleness needs. */
export const upstreamOf = (name, seen = new Set()) => {
  for (const dep of inputs(BY_STAGE.get(name) || { hard: [], soft: [] })) {
    if (seen.has(dep)) continue
    seen.add(dep)
    upstreamOf(dep, seen)
  }
  return [...seen]
}

/**
 * Is this stage's artifact stale, and why in words.
 *
 * Two independent sources (spec §3): the *ticket* moved under the artifact (`reqHash` mismatch), or a
 * *dependency* moved (upstream `fetchedAt` later than mine). Staleness is always a badge — it never
 * deletes, never cascades, and `nextAction` never returns a stage because of it.
 *
 * `stale: null` means "cannot tell", kept from `eng.mjs:1171-1182` in preference to a false "fresh":
 * an artifact written before staleness was tracked cannot be compared, and saying so is the honest
 * answer.
 *
 * @param {object} manifest
 * @param {string} name
 * @param {{reqHash?: string, now?: number}} [opts]  `reqHash` is the ticket's CURRENT hash; omit it
 *                                                   to check only the upstream source.
 */
export function stale(manifest, name, { reqHash, now = Date.now() } = {}) {
  const st = stages(manifest)
  const mine = st[name]
  if (!mine?.status) return { stale: null, reason: `${name} has not run` }

  if (reqHash !== undefined) {
    const had = mine.provenance?.reqHash
    if (had === undefined) return { stale: null, reason: `${name} was generated before staleness tracked the requirement — regenerate to start tracking` }
    if (had !== reqHash) return { stale: true, reason: `${name} is stale: the ticket changed since it was generated` }
  }

  const at = Date.parse(mine.fetchedAt)
  if (Number.isNaN(at)) return { stale: null, reason: `${name} has no readable fetchedAt` }
  for (const dep of upstreamOf(name)) {
    const u = st[dep]
    if (u?.status !== 'ok') continue
    const uAt = Date.parse(u.fetchedAt)
    if (!Number.isNaN(uAt) && uAt > at) return { stale: true, reason: `${name} is stale: ${dep} was regenerated ${ago(uAt, now)}` }
  }
  return { stale: false, reason: null }
}

/**
 * What the *Re-run stale* action and the stage badges need: every stage that is stale or cannot say.
 * A human-triggered path. The poller does not call this.
 */
export function staleStages(manifest, opts = {}) {
  return STAGES
    .map(s => ({ stage: s.stage, ...stale(manifest, s.stage, opts) }))
    .filter(r => r.stale !== false && stages(manifest)[r.stage]?.status)
}
