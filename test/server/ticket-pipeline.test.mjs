import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { liveView, startStage, stageImpl, step } from '../../server/ticket-pipeline.mjs'
import { entry, readManifest, writeManifest } from '../../lib/dossier.mjs'
import { dossierCache, TICKET_DIR } from '../../lib/paths.mjs'
import { nextAction } from '../../lib/stage-graph.mjs'

/**
 * `nextAction` is already tested in test/lib/stage-graph.test.mjs and is not retested here. What is
 * under test is the RUNNER: that it passes `running`, that it writes premarks before advancing,
 * that a refusal halts everything, that it never re-drives a terminal stage, and that a stage with
 * no implementation on this server is an explained `unavailable` rather than a crash.
 */

const KEY = 'ABC-1234'
const made = []
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }) })

let n = 0
/** A workspace as `repoFor` sees it: a directory that exists, with a board bound to it. */
function ws({ git = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-'))
  made.push(dir)
  if (git) fs.mkdirSync(path.join(dir, '.git'))
  fs.writeFileSync(path.join(dir, 'README.md'), '# hi\n')
  const id = `pipeline-test-${++n}`
  made.push(path.join(TICKET_DIR, id))
  return { id, dir, name: path.basename(dir), slug: path.basename(dir), jira: { key: 'ABC' } }
}

const manifest = (w, over) => writeManifest(w.dir, KEY, { stages: {}, ...over })
const stages = w => readManifest(w.dir, KEY).stages
const ok = stage => entry({ stage, status: 'ok', fetchedAt: new Date().toISOString() })

/** A ticket as the poller holds it, with the workspace lookup and the loopback call stubbed out. */
function enrolled(w) {
  const posted = []
  const t = { wsId: w.id, key: KEY, stopped: null }
  return { t, posted, run: () => step(t, { post: (_t, stage) => posted.push(stage), lookup: () => w }) }
}

// ---- a stage in flight is not started again ----

test('a stage already running is not started a second time, by the button or by the poller', async () => {
  const w = ws()
  manifest(w)
  let release
  const held = new Promise(r => { release = r })

  const [first] = await startStage(w, KEY, 'ticket', { impl: () => held })
  assert.equal(first, 200, 'the first start is accepted')

  const [second, body] = await startStage(w, KEY, 'ticket', { impl: () => held })
  assert.equal(second, 409, 'the second is refused — the doubled stages would be the paid ones')
  assert.match(body.error, /already running/)

  // And the poller sees the same thing, through `running` rather than through the manifest: the run
  // has written no status yet, so without it `nextAction` would hand back `ticket` again.
  const { posted, run } = enrolled(w)
  const act = await run()
  assert.notEqual(act?.stage, 'ticket')
  assert.ok(!posted.includes('ticket'), 'the poller did not start a second run of a stage in flight')

  release(entry({ stage: 'ticket', status: 'ok' }))
  await new Promise(r => setTimeout(r, 20))
  assert.equal(stages(w).ticket.status, 'ok', 'the status is written when the run FINISHES, not when it starts')
})

// ---- refusesRun halts the whole run ----

test('a refused run halts everything, even with other stages runnable', async () => {
  const w = ws()
  manifest(w, {
    stages: {
      repo: entry({
        stage: 'repo', status: 'failed', reason: `${w.dir} no longer exists on disk`,
        provenance: { refusesRun: 'workspace-vanished' },
      }),
    },
  })

  // `ticket` has no inputs at all, so it is runnable by every rule except this one.
  assert.equal(nextAction({ stages: {} }).stage, 'ticket', 'sanity: ticket is otherwise the next thing to run')

  const { t, posted, run } = enrolled(w)
  await run()
  assert.deepEqual(posted, [], 'nothing was started')
  assert.equal(t.stopped?.refusesRun?.signal, 'workspace-vanished')
  assert.match(t.stopped.refusesRun.reason, /no longer exists on disk/, 'the reason is surfaced, not just the halt')

  const [status, body] = await startStage(w, KEY, 'ticket')
  assert.equal(status, 409, 'the button is refused by the same guard as the poller')
  assert.match(body.error, /halted/)

  // The one exception: re-running the stage that refused is how a human clears it.
  const [reStatus] = await startStage(w, KEY, 'repo', { impl: () => ok('repo') })
  assert.equal(reStatus, 200)
})

// ---- premarks are written before anything advances ----

test('a stage`s premarks are written into the manifest before the poller advances past it', async () => {
  const w = ws({ git: false })
  manifest(w)

  const [status] = await startStage(w, KEY, 'repo')
  assert.equal(status, 200)
  await new Promise(r => setTimeout(r, 50))

  const st = stages(w)
  assert.equal(st.repo.status, 'ok', 'a non-git workspace runs degraded, it does not fail')
  assert.equal(st.repo.tracked, false)
  assert.equal(readManifest(w.dir, KEY).tracked, false, 'the verdict is carried to the manifest so later stages mark themselves')

  const pre = st['blast-radius']
  assert.ok(pre, 'the premarked stage was written in the same transaction as the entry that asked for it')
  assert.equal(pre.status, 'unavailable')
  assert.match(pre.reason, /built_at_commit/)
  assert.match(pre.reason, /`repo`/, 'the reason credits the stage that could prove it')

  // Written means terminal: the poller has an ordinary "has a status" reason never to attempt it.
  const { posted, run } = enrolled(w)
  for (let i = 0; i < 4; i++) await run()
  assert.ok(!posted.includes('blast-radius'), 'a premarked stage is never attempted')
})

// ---- the poller never re-drives a terminal stage ----

test('the poller does not re-run a failed stage, and does not re-run the stages it skipped past', async () => {
  const w = ws()
  manifest(w, {
    stages: {
      ticket: entry({ stage: 'ticket', status: 'failed', reason: 'JIRA would not answer' }),
      repo: ok('repo'),
    },
  })

  const { posted, run } = enrolled(w)
  for (let i = 0; i < 12; i++) await run()

  assert.ok(!posted.includes('ticket'), 'a failed stage is terminal to the poller — a re-run is always a human action')
  assert.ok(!posted.includes('repo'), 'nor does it re-drive one that succeeded')
  assert.equal(new Set(posted).size, posted.length, 'no stage was posted twice')

  // The branch below `ticket` is skipped with a reason NAMING the upstream, not failed.
  const st = stages(w)
  assert.equal(st.links.status, 'skipped')
  assert.match(st.links.reason, /ticket is failed/)
})

test('auto-advance stops at the grilling gate rather than deciding the human is satisfied', async () => {
  const w = ws()
  const all = {}
  for (const s of ['ticket', 'links', 'jira-linked', 'confluence', 'sheet', 'figma', 'repo', 'design-read', 'ac', 'tests']) all[s] = ok(s)
  manifest(w, { stages: all })

  const { t, posted, run } = enrolled(w)
  await run()
  assert.deepEqual(posted, [])
  assert.equal(t.stopped.reason, 'blocked-on-human')
  assert.equal(t.stopped.stage, 'grilling')

  const [status, body] = await startStage(w, KEY, 'grilling')
  assert.equal(status, 409, 'and the button will not start one either')
  assert.equal(body.blockedOnHuman, true)
})

// ---- a stage with no implementation on this server ----

// Originally one test against `blast-radius`, which was unimplemented when this was written. Every
// graph stage now ships a module, which splits it in two — the route and the resolver answer
// differently, and both answers are right:
//
//   * a name the GRAPH does not know is a 404. It is not a stage, so there is no entry to write.
//   * a name the graph knows whose MODULE is missing is a 200 with an `unavailable` entry, because
//     that is a deployment fault the run should record and move past, not an error the caller made.
//
// The second has no reachable fixture while every stage ships, so it is pinned at the resolver. Keep
// both: modules are loaded dynamically, so a rename or a botched export brings the case straight back.
test('a stage no loaded module implements resolves to a reason, not an exception', async () => {
  const impl = await stageImpl('no-such-stage')
  assert.equal(impl.fn, undefined)
  assert.match(impl.reason, /no-such-stage/)
  assert.match(impl.reason, /server\/stages/, 'the reason says where an implementation would come from')
})

test('a stage name the graph does not know is a 404 — it is not a stage, so nothing is recorded', async () => {
  const w = ws()
  manifest(w, { stages: { decompose: ok('decompose') } })
  const [status] = await startStage(w, KEY, 'no-such-stage')
  assert.equal(status, 404)
  assert.equal(stages(w)['no-such-stage'], undefined, 'a typo does not leave an entry behind in the manifest')
})

test('a stage that throws still becomes terminal, so the poller does not retry it forever', async () => {
  const w = ws()
  manifest(w)
  await startStage(w, KEY, 'ticket', { impl: () => { throw new Error('boom') } })
  await new Promise(r => setTimeout(r, 20))
  const e = stages(w).ticket
  assert.equal(e.status, 'failed')
  assert.match(e.reason, /threw instead of returning an entry: boom/)
})

// ---- the live view ----

test('the live route says the agent has started but written nothing yet, rather than showing an empty panel', async () => {
  const w = ws()
  manifest(w)

  const idle = await liveView(w.id, KEY, 'ac')
  assert.equal(idle.running, null)
  assert.equal(idle.file, null)
  assert.match(idle.note, /no `ac` agent session has run/, 'never-run and started-but-silent must read differently')

  let release
  const held = new Promise(r => { release = r })
  await startStage(w, KEY, 'ac', { impl: () => held })

  const live = await liveView(w.id, KEY, 'ac')
  assert.equal(live.running.kind, 'ac')
  assert.ok(live.running.startedAt > 0)
  assert.equal(live.note, 'the agent has started but has not written its transcript yet',
    'this note is the difference between slow and broken')

  release(entry({ stage: 'ac', status: 'ok' }))
  await new Promise(r => setTimeout(r, 20))
})

test('the live view reads the transcript the agent stage writes, and pages it with the offset cursor', async () => {
  const w = ws()
  manifest(w)
  const log = path.join(dossierCache(w.id, KEY), 'ac.stream.jsonl')
  fs.mkdirSync(path.dirname(log), { recursive: true })
  fs.writeFileSync(log, [
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } }),
    JSON.stringify({ type: 'result', duration_ms: 12, total_cost_usd: 0.4 }),
  ].join('\n') + '\n')

  const first = await liveView(w.id, KEY, 'ac')
  assert.equal(first.running, null, 'liveness comes from the run map, never from a file on disk')
  assert.equal(first.events.length, 2)
  assert.equal(first.offset, 2)

  const second = await liveView(w.id, KEY, 'ac', { offset: first.offset, file: first.file })
  assert.deepEqual(second.events, [], 'the cursor does not re-ship what the client already has')
  assert.equal(second.note, null, 'a transcript with records is not annotated')
})

test('an agent that ran and wrote an empty transcript says so in words', async () => {
  const w = ws()
  manifest(w)
  const log = path.join(dossierCache(w.id, KEY), 'design-read.stream.jsonl')
  fs.mkdirSync(path.dirname(log), { recursive: true })
  fs.writeFileSync(log, '')

  const v = await liveView(w.id, KEY, 'design-read')
  assert.equal(v.events.length, 0)
  assert.match(v.note, /produced no output at all/, 'a silent empty panel would read as "nothing to do"')
})
