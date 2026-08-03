import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { accept, agendaFrom, blockedBy, gaps, grilling, proposal, turn } from '../../server/stages/grilling.mjs'
import { entry, writeManifest } from '../../lib/dossier.mjs'

/**
 * The agent is STUBBED in every test here, and deliberately so — twice over.
 *
 * The obvious reason is cost: a real `claude` call in a unit test is a paid, slow, non-deterministic
 * dependency. The one that matters more is that no test in this file may simulate the agent
 * answering its own questions. The rule under test is that a human ends the grilling, so a stub that
 * decides it is satisfied would be testing the feature's own failure mode and calling it a pass.
 * Every stub here asks a question and stops; the only thing that ever ends a session is `grilling()`.
 */

const KEY = 'ABC-1234'
const made = []
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }) })

const AC = `# Acceptance criteria

## Acceptance criteria

1. It works.

## Unspecified — needs an answer

- Which timezone do the cutoffs use?
- What happens to an in-flight order at cutover?

## Notes

Nothing else.
`

/** A workspace's repo + cache dirs, with the manifest stages the caller asks for. */
function fixture({ ac = true, ticket = true, extra = {} } = {}) {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grill-repo-'))
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grill-cache-'))
  made.push(repoDir, cacheDir)
  fs.mkdirSync(path.join(repoDir, 'docs', KEY), { recursive: true })
  fs.writeFileSync(path.join(repoDir, 'docs', KEY, 'ticket.md'), '# ABC-1234\n\nDo the thing.\n')
  if (ac) fs.writeFileSync(path.join(repoDir, 'docs', KEY, 'ac.md'), AC)

  const stages = { ...extra }
  if (ticket) stages.ticket = entry({ stage: 'ticket', status: 'ok', artifacts: [`docs/${KEY}/ticket.md`] })
  if (ac) stages.ac = entry({ stage: 'ac', status: 'ok', artifacts: [`docs/${KEY}/ac.md`], provenance: { groundedIn: 'repo' } })
  const manifest = writeManifest(repoDir, KEY, { stages })
  return { repoDir, cacheDir, key: KEY, manifest, ctx: { repoDir, cacheDir, key: KEY, manifest } }
}

const adrs = repoDir => { try { return fs.readdirSync(path.join(repoDir, 'docs', KEY, 'adr')).sort() } catch { return [] } }

/**
 * An agent that asks a question and writes the ADR for the answer it was just given — the incremental
 * write the prompt demands, done where the real agent would do it. It never decides it is finished.
 */
function askingAgent(repoDir, { sessionId = 'sess-1', onCall } = {}) {
  let n = 0
  return async ({ prompt, resume }) => {
    n++
    onCall?.({ n, prompt, resume })
    // The ADR for the PREVIOUS answer lands before this question goes out, which is the ordering the
    // whole two-tier story rests on.
    if (n > 1) {
      fs.mkdirSync(path.join(repoDir, 'docs', KEY, 'adr'), { recursive: true })
      fs.writeFileSync(path.join(repoDir, 'docs', KEY, 'adr', `00${n - 1}-decision.md`), `# 00${n - 1}. Decision\n\n## Decision\n\nAnswered.\n`)
    }
    return { result: `Question ${n}?`, sessionId, cost: 0.01, turns: 1 }
  }
}

// ---- the gate ----

test('ac unavailable makes grilling skipped, with a reason naming ac', async () => {
  const f = fixture({ ac: false, extra: { ac: entry({ stage: 'ac', status: 'unavailable', reason: 'no ticket description to write criteria from' }) } })

  assert.match(blockedBy(f.manifest), /`ac` is unavailable/)

  const e = await grilling(f.ctx)
  assert.equal(e.stage, 'grilling')
  assert.equal(e.status, 'skipped')
  assert.match(e.reason, /`ac` is unavailable/)
  assert.match(e.reason, /no ticket description/, 'the upstream reason is carried, not flattened to "unavailable"')

  // And a turn cannot be taken either — the gate is one rule, checked in one place.
  const t = await turn(f.ctx, { text: '' }, { run: async () => assert.fail('the agent must not be called behind a closed gate') })
  assert.equal(t.blocked, true)
  assert.match(t.error, /`ac` is/)
})

test('a missing soft input is a visible gap, not a block', async () => {
  const f = fixture({ extra: { figma: entry({ stage: 'figma', status: 'failed', reason: 'the file key 404d' }) } })
  assert.equal(blockedBy(f.manifest), null)
  const g = gaps(f.manifest)
  assert.ok(g.some(x => x.stage === 'figma' && /404/.test(x.reason)))
  assert.ok(g.some(x => x.stage === 'tests'), 'a stage that never ran is a gap too')
})

// ---- the seeded agenda ----

test('the agenda is ac.md\'s "Unspecified — needs an answer" section, and stops at the next heading', () => {
  const a = agendaFrom(AC)
  assert.match(a, /Which timezone/)
  assert.match(a, /in-flight order/)
  assert.doesNotMatch(a, /Nothing else/, 'the section ends at the next ## heading')
  assert.equal(agendaFrom('# no such section\n'), null)
})

test('the opening prompt carries the agenda verbatim', async () => {
  const f = fixture()
  let seen = null
  await turn(f.ctx, { text: '' }, { run: async ({ prompt }) => { seen = prompt; return { result: 'Q1?', sessionId: 's' } } })
  assert.match(seen, /Which timezone do the cutoffs use\?/)
  assert.match(seen, /never the one who decides the grilling is finished/i)
})

// ---- resume, not restart ----

test('a turn persists {sessionId, cwd} and the next turn passes resume', async () => {
  const f = fixture()
  const calls = []
  const run = askingAgent(f.repoDir, { sessionId: 'sess-abc', onCall: c => calls.push(c) })

  await turn(f.ctx, { text: '' }, { run })
  const stored = JSON.parse(fs.readFileSync(path.join(f.cacheDir, 'grilling.session.json'), 'utf8'))
  assert.equal(stored.sessionId, 'sess-abc')
  assert.equal(stored.cwd, f.repoDir)

  await turn(f.ctx, { text: 'UTC.' }, { run })
  assert.equal(calls[0].resume, undefined, 'the opening turn has nothing to resume')
  assert.equal(calls[1].resume, 'sess-abc', 'the second turn resumes the same session rather than restarting it')
  assert.equal(calls[1].prompt, 'UTC.', 'a resumed turn sends the human\'s answer, not the whole preamble again')
})

// ---- ADRs, incrementally ----

test('an ADR is on disk after each turn, not only at the end', async () => {
  const f = fixture()
  const run = askingAgent(f.repoDir)

  await turn(f.ctx, { text: '' }, { run })
  assert.deepEqual(adrs(f.repoDir), [], 'nothing is decided before the first answer')

  const t2 = await turn(f.ctx, { text: 'UTC.' }, { run })
  assert.deepEqual(adrs(f.repoDir), ['001-decision.md'], 'the first answer is on disk before the second question is asked')
  assert.deepEqual(t2.wrote, [`docs/${KEY}/adr/001-decision.md`], 'and the turn reports what landed, verified from disk')

  const t3 = await turn(f.ctx, { text: 'It drains.' }, { run })
  assert.deepEqual(adrs(f.repoDir), ['001-decision.md', '002-decision.md'])
  assert.deepEqual(t3.decisions, [`docs/${KEY}/adr/001-decision.md`, `docs/${KEY}/adr/002-decision.md`])
})

test('killing the process mid-session loses no ADR — the repo half is the record', async () => {
  const f = fixture()
  const run = askingAgent(f.repoDir)
  await turn(f.ctx, { text: '' }, { run })
  await turn(f.ctx, { text: 'UTC.' }, { run })

  // The "kill": nothing in memory survives, and tier 2 is wiped as a session store expiring would.
  fs.rmSync(f.cacheDir, { recursive: true, force: true })

  const e = await grilling({ ...f.ctx, cacheDir: f.cacheDir })
  assert.equal(e.status, 'ok')
  assert.deepEqual(e.artifacts, [`docs/${KEY}/adr/001-decision.md`], 'the decision survives a total loss of the session store')
})

// ---- the two tiers of resume ----

test('a resume with a dead session id reports the lost-context tier rather than silently restarting', async () => {
  const f = fixture()
  const run = askingAgent(f.repoDir, { sessionId: 'sess-dead' })
  await turn(f.ctx, { text: '' }, { run })
  await turn(f.ctx, { text: 'UTC.' }, { run })   // writes 001, so there is a decision to survive

  const calls = []
  const dead = async ({ prompt, resume }) => {
    calls.push({ prompt, resume })
    if (resume) return { error: 'No conversation found with session ID sess-dead' }
    return { result: 'Where were we — question again?', sessionId: 'sess-new' }
  }

  const t = await turn(f.ctx, { text: 'It drains.' }, { run: dead })
  assert.ok(t.contextLost, 'the loss is reported, not swallowed')
  assert.match(t.contextLost, /no longer in the session store/)
  assert.match(t.contextLost, /DECISIONS are safe/, 'and it names which tier survived')
  assert.equal(calls.length, 2, 'exactly one retry — the resume, then a stated fresh start')
  assert.equal(calls[1].resume, undefined)
  assert.match(calls[1].prompt, /lost its conversational context/, 'the new session is TOLD it is a cold start')
  assert.match(calls[1].prompt, new RegExp(`docs/${KEY}/adr/001-decision.md`), 'and is pointed at the decisions it must not re-litigate')
  assert.ok(t.question, 'the turn still produces a question — degraded, not broken')
})

// ---- the human ends it, and only the human ----

test('grilling is only ever ended by a call a person makes, and says what it recorded', async () => {
  const f = fixture()
  const run = askingAgent(f.repoDir)
  await turn(f.ctx, { text: '' }, { run })
  await turn(f.ctx, { text: 'UTC.' }, { run })

  // Nothing so far wrote the manifest entry: while it is absent, `nextAction` reports
  // blocked-on-human, which is the pause the gate exists to create.
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.repoDir, 'docs', KEY, 'manifest.json'), 'utf8')).stages.grilling, undefined)

  const e = await grilling({ ...f.ctx, manifest: f.manifest })
  assert.equal(e.status, 'ok')
  assert.match(e.reason, /ended by the human after 1 answer/)
  assert.equal(e.artifacts.length, 1)
})

test('a grilling ended with nothing written says so loudly rather than reading as a clean pass', async () => {
  const f = fixture()
  const e = await grilling(f.ctx)
  assert.equal(e.status, 'ok')
  assert.match(e.reason, /NO decisions were written/)
})

// ---- G2 ----

const TASKS = `# Decomposition

## 1. Add the endpoint

- files: server/x.mjs
- depends_on:
- size: S

## 2. Wire the UI

- files: src/y.jsx
- depends_on: 1
- size: M
`

function g2fixture() {
  const f = fixture()
  fs.writeFileSync(path.join(f.repoDir, 'docs', KEY, 'decompose.md'), TASKS)
  const cache = path.join(f.cacheDir, 'files.json')
  fs.writeFileSync(cache, JSON.stringify({ files: ['server/x.mjs', 'src/y.jsx'], truncated: false }))
  const manifest = writeManifest(f.repoDir, KEY, {
    stages: {
      ...f.manifest.stages,
      repo: entry({ stage: 'repo', status: 'ok', artifacts: [cache] }),
      decompose: entry({ stage: 'decompose', status: 'ok', artifacts: [`docs/${KEY}/decompose.md`], provenance: { groundedIn: 'repo' } }),
      'blast-radius': entry({ stage: 'blast-radius', status: 'ok', provenance: { counts: { 'server/x.mjs': 40 } } }),
    },
  })
  return { ...f, manifest, ctx: { ...f.ctx, manifest } }
}

test('the proposal carries validateTasks findings and blast radius, and nothing is accepted yet', () => {
  const f = g2fixture()
  const p = proposal(f.ctx)
  assert.equal(p.available, true)
  assert.equal(p.validation.counts.tasks, 2)
  assert.equal(p.validation.filesChecked, true, 'checked against the real checkout, so "no overlap" means something')
  assert.equal(p.blastRadius.provenance.counts['server/x.mjs'], 40)
  assert.equal(p.accepted, false)
})

test('nothing is written to docs/<KEY>/N.md before the accept call', async () => {
  const f = g2fixture()
  const sink = path.join(f.repoDir, 'docs', KEY, '1.md')

  proposal(f.ctx)
  await turn(f.ctx, { text: '' }, { run: askingAgent(f.repoDir) })
  await grilling(f.ctx)
  assert.equal(fs.existsSync(sink), false, 'proposing, grilling and ending it write no sub-ticket')

  // The accept call is separate and explicit, and the human's inline edit is what it accepts.
  let ran = null
  const edited = TASKS.replace('Wire the UI', 'Wire the UI properly')
  const [status] = await accept({ id: 'ws' }, KEY, { md: edited, ctx: f.ctx }, {
    startStage: async (_ws, _key, stage) => {
      ran = stage
      fs.writeFileSync(sink, '# 1\n')
      return [200, { ok: true, started: stage }]
    },
  })
  assert.equal(status, 200)
  assert.equal(ran, 'subtickets', 'the accepted list is handed to the subtickets stage, through the runner\'s own door')
  assert.match(fs.readFileSync(path.join(f.repoDir, 'docs', KEY, 'decompose.md'), 'utf8'), /Wire the UI properly/, 'the human\'s edit is what got accepted')
  assert.equal(fs.existsSync(sink), true)
})

test('accept surfaces a missing subtickets stage as a reason, never a crash', async () => {
  const f = g2fixture()
  // Exactly what the runner returns for a stage no module on this server exports.
  const [status, body] = await accept({ id: 'ws' }, KEY, { md: TASKS, ctx: f.ctx }, {
    startStage: async () => [200, { ok: true, entry: entry({ stage: 'subtickets', status: 'unavailable', reason: 'the `subtickets` stage has no implementation on this server' }) }],
  })
  assert.equal(status, 200)
  assert.equal(body.entry.status, 'unavailable')
  assert.match(body.entry.reason, /no implementation on this server/)
})

test('an empty decomposition is refused rather than accepted into silence', async () => {
  const f = g2fixture()
  const [status, body] = await accept({ id: 'ws' }, KEY, { md: '   ', ctx: f.ctx }, { startStage: async () => assert.fail('must not run') })
  assert.equal(status, 400)
  assert.match(body.error, /empty decomposition/)
})

test('there is no split to accept before decompose has run', () => {
  const f = fixture()
  const p = proposal(f.ctx)
  assert.equal(p.available, false)
  assert.match(p.reason, /`decompose` is not run/)
})
