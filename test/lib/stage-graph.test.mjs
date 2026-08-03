import test from 'node:test'
import assert from 'node:assert/strict'
import { entry } from '../../lib/dossier.mjs'
import { STAGES, nextAction, pendingPremarks, refusedRun, stale, staleStages, upstreamOf, validateGraph } from '../../lib/stage-graph.mjs'

const T0 = Date.parse('2026-08-03T09:00:00.000Z')
const at = min => new Date(T0 + min * 60_000).toISOString()

/** A manifest from `{stage: 'ok'}` / `{stage: ['failed', 'why']}` shorthand. */
const mf = (spec, { fetchedAt = at(-60), provenance } = {}) => ({
  v: 1, key: 'ABC-1',
  stages: Object.fromEntries(Object.entries(spec).map(([stage, v]) => {
    const [status, reason, when] = Array.isArray(v) ? v : [v, v === 'ok' ? null : `${stage} ${v}`]
    return [stage, entry({ stage, status, reason, fetchedAt: when || fetchedAt, provenance })]
  })),
})

/** Every stage `ok`, minus the named ones — the "further along the pipeline" shortcut. */
const allOk = (...without) => mf(Object.fromEntries(
  STAGES.map(s => s.stage).filter(s => !without.includes(s)).map(s => [s, 'ok'])))

// ---- the graph itself ----

test('the shipped graph is a DAG with no unknown stage names', () => {
  assert.deepEqual(validateGraph(), [], 'a typo here strands a stage silently — that is the point of the check')
})

test('an unknown input name is caught', () => {
  const problems = validateGraph([{ stage: 'ac', kind: 'agent', hard: ['tikcet'], soft: [] }])
  assert.match(problems.join(), /unknown stage "tikcet"/)
})

test('a cycle is caught', () => {
  const problems = validateGraph([
    { stage: 'a', kind: 'route', hard: ['b'], soft: [] },
    { stage: 'b', kind: 'route', hard: [], soft: ['a'] },
  ])
  assert.match(problems.join(), /cycle/)
})

test('an unknown kind is caught', () => {
  assert.match(validateGraph([{ stage: 'a', kind: 'wizard', hard: [], soft: [] }]).join(), /unknown kind "wizard"/)
})

test('grilling reads the whole dossier but hard-depends only on ticket and ac', () => {
  const g = STAGES.find(s => s.stage === 'grilling')
  assert.deepEqual(g.hard, ['ticket', 'ac'])
  assert.equal(g.kind, 'human')
})

// ---- nextAction: what it advances ----

test('the first thing on an empty manifest is a route, and it needs no inputs', () => {
  const a = nextAction({ stages: {} })
  assert.equal(a.do, 'run')
  assert.equal(a.stage, 'ticket')
  assert.equal(a.kind, 'route')
})

test('a stage with ANY status recorded is never returned — this is what bounds the token bill', () => {
  for (const status of ['ok', 'failed', 'unavailable', 'skipped']) {
    const m = mf({ ticket: status })
    const a = nextAction(m)
    assert.notEqual(a.stage, 'ticket', `${status} must be terminal to the poller`)
  }
})

test('a stage in flight is neither re-run nor treated as a failure', () => {
  // A run writes its status when it finishes, so "no status" alone would start it a second time.
  const a = nextAction(mf({ ticket: 'ok' }), ['links'])
  assert.equal(a.stage, 'repo', 'links is in flight; repo needs no inputs, so it is the next step')
  const b = nextAction(mf({ ticket: 'ok' }), ['links', 'repo'])
  assert.deepEqual(b, { do: 'stop', reason: 'nothing-runnable' }, 'everything else waits on links')
})

// ---- nextAction: hard vs soft ----

test('a hard input that is not ok yields skipped, naming the upstream', () => {
  const a = nextAction(mf({ ticket: 'ok', links: 'failed' }))
  assert.equal(a.do, 'skip', 'not failed — skipped exists for exactly this')
  assert.equal(a.stage, 'jira-linked')
  assert.match(a.reason, /links/, 'the reason must name the upstream stage')
})

test('a hard input merely pending is not a skip — it has not had its turn', () => {
  const a = nextAction(mf({ ticket: 'ok' }))
  assert.equal(a.do, 'run')
  assert.equal(a.stage, 'links')
})

test('a soft input that is not ok still advances the stage, and is reported as excluded', () => {
  const m = allOk('design-read', 'ac', 'tests', 'grilling', 'decompose', 'blast-radius', 'subtickets')
  m.stages.sheet = entry({ stage: 'sheet', status: 'unavailable', reason: 'no copy deck linked' })
  const a = nextAction(m)
  assert.equal(a.stage, 'design-read')
  assert.equal(a.do, 'run')
  assert.deepEqual(a.passed, ['figma'])
  assert.deepEqual(a.excluded, ['sheet'], 'the caller records this in provenance.handoff.excluded')
})

test('figma unreachable → design-read skipped → ac still runs, with no design context', () => {
  // The worked example from spec §3: a failure halts a branch, not the run.
  let m = allOk('design-read', 'ac', 'tests', 'grilling', 'decompose', 'blast-radius', 'subtickets')
  m.stages.figma = entry({ stage: 'figma', status: 'failed', reason: 'figma.com unreachable' })

  const skip = nextAction(m)
  assert.deepEqual(skip, { do: 'skip', stage: 'design-read', reason: 'figma is failed, and design-read cannot run without it' })

  m.stages['design-read'] = entry({ stage: 'design-read', status: 'skipped', reason: skip.reason })
  const a = nextAction(m)
  assert.equal(a.stage, 'ac', 'design-read is only a SOFT input to ac')
  assert.equal(a.do, 'run')
  assert.deepEqual(a.excluded, ['design-read'])
  assert.deepEqual(a.passed, ['ticket', 'repo', 'sheet', 'confluence'])
})

// ---- nextAction: the three stop reasons ----

test('blocked-on-human: grilling pauses the run indefinitely', () => {
  const m = allOk('grilling', 'decompose', 'blast-radius', 'subtickets')
  assert.deepEqual(nextAction(m), { do: 'stop', reason: 'blocked-on-human', stage: 'grilling' })
})

test('nothing past the human gate is advanced, even though decompose could run', () => {
  // decompose's hard inputs (ticket, repo, ac) are all ok — grilling is only soft to it. The gate is
  // the point: the human ends the grilling, and the poller does not walk around it.
  const m = allOk('grilling', 'decompose', 'blast-radius', 'subtickets')
  assert.notEqual(nextAction(m).stage, 'decompose')
})

test('nothing-runnable: work is outstanding but none of it is startable', () => {
  const m = allOk('decompose', 'blast-radius', 'subtickets')
  assert.deepEqual(nextAction(m, ['decompose']), { do: 'stop', reason: 'nothing-runnable' },
    'both remaining stages hard-depend on the run in flight')
})

test('all-done: every stage has a status', () => {
  assert.deepEqual(nextAction(allOk()), { do: 'stop', reason: 'all-done' })
  const m = allOk()
  m.stages.figma = entry({ stage: 'figma', status: 'failed', reason: 'unreachable' })
  assert.equal(nextAction(m).reason, 'all-done', 'a failed run is still a finished one')
})

test('a manifest that is missing or shapeless does not throw', () => {
  for (const m of [undefined, null, {}, { stages: null }]) {
    assert.equal(nextAction(m).stage, 'ticket')
  }
})

// ---- the two advisory signals (spec §3) ----

test('refusesRun halts the whole run, even with other stages runnable', () => {
  const m = mf({})
  m.stages.repo = entry({
    stage: 'repo', status: 'failed', reason: 'workspace directory no longer exists',
    provenance: { refusesRun: 'workspace-vanished' },
  })
  const a = nextAction(m)
  assert.equal(a.do, 'stop')
  assert.equal(a.reason, 'nothing-runnable', 'the three stop reasons are the whole vocabulary')
  assert.deepEqual(a.refusesRun, { stage: 'repo', signal: 'workspace-vanished', reason: 'workspace directory no longer exists' },
    'the caller needs the reason to surface it')
  assert.equal(refusedRun(m).signal, 'workspace-vanished')

  // `ticket` has no inputs and no status — without the halt it would be returned as the next step.
  assert.equal(nextAction(mf({})).stage, 'ticket')
})

test('an ordinary failed stage does NOT halt the run — only a branch', () => {
  const m = mf({ repo: 'failed' })
  assert.equal(refusedRun(m), null)
  assert.equal(nextAction(m).stage, 'ticket')
})

test('a premarked stage is never returned, before or after the runner writes it', () => {
  const m = allOk('blast-radius', 'subtickets')
  m.stages.repo = entry({
    stage: 'repo', status: 'ok',
    provenance: { premark: { 'blast-radius': { status: 'unavailable', reason: 'no built_at_commit — the workspace is not a git repo' } } },
  })

  assert.deepEqual(pendingPremarks(m), [{
    stage: 'blast-radius', status: 'unavailable',
    reason: 'no built_at_commit — the workspace is not a git repo', from: 'repo',
  }], 'the runner writes these; this only says which')

  const a = nextAction(m)
  assert.equal(a.stage, 'subtickets', 'blast-radius is premarked; subtickets only soft-depends on it')
  assert.deepEqual(a.excluded, ['blast-radius'])

  // Once the runner has written them, the ordinary "has a status" rule takes over.
  for (const p of pendingPremarks(m)) m.stages[p.stage] = entry({ stage: p.stage, status: p.status, reason: p.reason })
  assert.deepEqual(pendingPremarks(m), [], 'applying twice is a no-op')
  assert.equal(nextAction(m).stage, 'subtickets')
})

test('a hard dependant of a premarked stage is not attempted either', () => {
  const m = mf({ ticket: 'ok', repo: 'ok' })
  m.stages.links = entry({
    stage: 'links', status: 'ok',
    provenance: { premark: { figma: { status: 'unavailable', reason: 'no figma link on the ticket' } } },
  })
  const seen = []
  for (let i = 0; i < 6; i++) {
    const a = nextAction(m)
    if (a.do !== 'run') break
    seen.push(a.stage)
    m.stages[a.stage] = entry({ stage: a.stage, status: 'ok' })
  }
  assert.ok(!seen.includes('figma'), 'premarked')
  assert.ok(!seen.includes('design-read'), 'figma is its hard input and has no status yet')
})

// ---- staleness: a badge, never a trigger ----

test('a stale stage is NOT returned by nextAction', () => {
  const m = allOk('grilling', 'decompose', 'blast-radius', 'subtickets')
  m.stages.ac = entry({ stage: 'ac', status: 'ok', fetchedAt: at(0) })
  m.stages.tests = entry({ stage: 'tests', status: 'ok', fetchedAt: at(-10) })   // older than its input
  assert.equal(stale(m, 'tests', { now: T0 }).stale, true, 'the badge is on')
  assert.equal(nextAction(m).stage, 'grilling', 'and the poller ignores it entirely')
})

test('upstream newer reads as a stale badge with a reason in words', () => {
  const m = mf({ ticket: 'ok', repo: 'ok', ac: ['ok', null, at(-4)] })
  m.stages.tests = entry({ stage: 'tests', status: 'ok', fetchedAt: at(-30) })
  const r = stale(m, 'tests', { now: T0 })
  assert.equal(r.stale, true)
  assert.equal(r.reason, 'tests is stale: ac was regenerated 4 minutes ago')
})

test('staleness walks the graph transitively, not just direct inputs', () => {
  assert.ok(upstreamOf('tests').includes('figma'), 'tests ← ac ← design-read ← figma')
  const m = mf({ ticket: 'ok', repo: 'ok', links: 'ok', figma: ['ok', null, at(-2)], ac: ['ok', null, at(-9)] })
  m.stages.tests = entry({ stage: 'tests', status: 'ok', fetchedAt: at(-9) })
  assert.match(stale(m, 'tests', { now: T0 }).reason, /figma was regenerated 2 minutes ago/)
})

test('an upstream that is not ok does not make a stage stale', () => {
  const m = mf({ ticket: 'ok', repo: 'ok', ac: ['ok', null, at(-30)] })
  m.stages.figma = entry({ stage: 'figma', status: 'failed', reason: 'unreachable', fetchedAt: at(0) })
  m.stages.tests = entry({ stage: 'tests', status: 'ok', fetchedAt: at(-20) })
  assert.equal(stale(m, 'tests', { now: T0 }).stale, false)
})

test('a reqHash mismatch means the ticket moved under the artifact', () => {
  const m = mf({ ac: 'ok' }, { provenance: { reqHash: 'aaa' } })
  assert.equal(stale(m, 'ac', { reqHash: 'aaa', now: T0 }).stale, false)
  const r = stale(m, 'ac', { reqHash: 'bbb', now: T0 })
  assert.equal(r.stale, true)
  assert.match(r.reason, /the ticket changed/)
})

test('"cannot tell" is stale: null with a reason — never a false fresh', () => {
  const noHash = stale(mf({ ac: 'ok' }), 'ac', { reqHash: 'aaa', now: T0 })
  assert.equal(noHash.stale, null, 'an artifact written before reqHash existed cannot be compared')
  assert.match(noHash.reason, /before staleness tracked the requirement/)

  const notRun = stale(mf({}), 'ac', { now: T0 })
  assert.equal(notRun.stale, null)
  assert.match(notRun.reason, /has not run/)
})

test('staleStages is what the Re-run stale action lists — badged stages only', () => {
  const m = mf({ ticket: 'ok', repo: 'ok', ac: ['ok', null, at(-4)] })
  m.stages.tests = entry({ stage: 'tests', status: 'ok', fetchedAt: at(-30) })
  const rows = staleStages(m, { now: T0 })
  assert.deepEqual(rows.map(r => r.stage), ['tests'], 'stages that never ran are not stale, they are absent')
  assert.match(rows[0].reason, /ac was regenerated/)
})
