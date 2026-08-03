// Stages 8-10 — `design-read`, `ac`, `tests`.
//
// The agent is ALWAYS stubbed. These are three of the four stages in the pipeline that spend tokens,
// so a test that reached the real `claude` would cost money every time the suite ran — and would be
// non-deterministic on top of it. The seam is `ctx.run`, the same place `jira.mjs` and `sheet.mjs`
// keep theirs.

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { designRead, ac, tests as testsStage } from '../../server/stages/agents.mjs'

const KEY = 'ABC-1234'
const AT = '2026-08-03T09:00:00.000Z'
const LATER = '2026-08-03T10:00:00.000Z'

const made = []
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }) })

const TICKET_MD = '# ABC-1234 — Add a filter\n\nA distinctive-phrase-only-in-the-ticket sentence.\n'
const AC_MD = [
  '## Acceptance criteria',
  '- [ ] AC-1 the filter persists across a reload',
  '',
  '## Unspecified — needs an answer',
  '- [ ] does the filter survive a logout?',
  '',
  '## Notes from the code',
  '- `src/Filter.jsx:12` already has an empty state',
  '',
].join('\n')

/** A stubbed agent run. Records what it was asked, so a test can assert on the prompt it built. */
function agent(out = {}) {
  const calls = []
  const run = async args => {
    calls.push(args)
    if (out.error) return { error: out.error, transcript: args.logFile }
    return {
      result: out.result ?? '## Result\n\nsomething\n',
      cost: 0.41, turns: 6, sessionId: 'sess-1', model: 'claude-opus-5', transcript: args.logFile,
    }
  }
  return { run, calls }
}

/**
 * A workspace with the upstream artifacts already on disk and a manifest that points at them.
 * `stages` is merged over the defaults, so a test names only the upstream it is interested in.
 */
function ctxFor({ stages = {}, tracked = true, run, files = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stages-agents-'))
  made.push(root)
  const repoDir = path.join(root, 'repo')
  const cacheDir = path.join(root, 'cache')
  const docs = path.join(repoDir, 'docs', KEY)
  fs.mkdirSync(docs, { recursive: true })
  fs.writeFileSync(path.join(docs, 'ticket.md'), TICKET_MD)
  fs.writeFileSync(path.join(docs, 'figma-outline.md'), '# outline\n')
  fs.writeFileSync(path.join(docs, 'content.csv'), 'key,copy\ntitle,Filter\n')
  fs.writeFileSync(path.join(docs, 'ac.md'), AC_MD)
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(docs, name), body)

  fs.mkdirSync(cacheDir, { recursive: true })
  const shot = path.join(cacheDir, 'figma-abc-1-1.png')
  fs.writeFileSync(shot, 'png')

  const rel = n => `docs/${KEY}/${n}`
  const base = {
    ticket: { stage: 'ticket', status: 'ok', reason: null, fetchedAt: AT, artifacts: [rel('ticket.md'), path.join(cacheDir, 'ticket.json')], provenance: { groundedIn: 'atlassian', handoff: { passed: [], excluded: [] }, reqHash: 'req-1' } },
    repo: { stage: 'repo', status: 'ok', reason: null, fetchedAt: AT, artifacts: [path.join(cacheDir, 'files.json')], provenance: { fileCount: 3 } },
    figma: { stage: 'figma', status: 'ok', reason: null, fetchedAt: AT, artifacts: [rel('figma-outline.md')], provenance: { groundedIn: 'figma-rest', handoff: { passed: ['links'], excluded: [] }, cache: [shot] } },
    sheet: { stage: 'sheet', status: 'ok', reason: null, fetchedAt: AT, artifacts: [rel('content.csv')], provenance: { groundedIn: 'google-sheets', handoff: { passed: ['links'], excluded: [] } } },
    ac: { stage: 'ac', status: 'ok', reason: null, fetchedAt: AT, artifacts: [rel('ac.md')], provenance: { groundedIn: 'repo', handoff: { passed: ['ticket', 'repo'], excluded: [] }, reqHash: 'req-1' } },
  }
  const merged = { ...base, ...stages }
  for (const [name, v] of Object.entries(stages)) if (v === null) delete merged[name]

  return {
    repoDir, cacheDir, key: KEY, cfg: {}, run, shot,
    manifest: { v: 1, key: KEY, tracked, stages: merged },
  }
}

const artifactBody = (ctx, e) => fs.readFileSync(path.resolve(ctx.repoDir, e.artifacts[0]), 'utf8')

// ---------------------------------------------------------------------------------------------
// The grounding wall, and its opposite
// ---------------------------------------------------------------------------------------------

test('an ungrounded upstream is refused — a wall, not a warning, and no paid run happens', async () => {
  const a = agent()
  // `design-read` is a SOFT input to `ac`. Running anyway and quietly excluding it is exactly the
  // warning the spec refuses: the artifact exists, it is ignored, and nobody is told why.
  const ctx = ctxFor({
    run: a.run,
    stages: { 'design-read': { stage: 'design-read', status: 'ok', reason: null, fetchedAt: AT, artifacts: [`docs/${KEY}/design.md`], provenance: { handoff: { passed: [], excluded: [] } } } },
  })
  const e = await ac(ctx)

  assert.equal(e.status, 'failed')
  assert.equal(a.calls.length, 0, 'the wall stands BEFORE the run — a refusal that still spends tokens is not a refusal')
  assert.match(e.reason, /design-read/)
  assert.match(e.reason, /grounded/i)
  assert.match(e.reason, /re-run/i, 'the reason has to name the stage to regenerate: `ac` is a hard input to grilling, so this is what a human acts on')
  assert.equal(fs.readFileSync(path.join(ctx.repoDir, 'docs', KEY, 'ac.md'), 'utf8'), AC_MD, 'a refused stage writes nothing — the previous artifact is left exactly as it was')
})

test('an ungrounded HARD upstream is refused too', async () => {
  const a = agent()
  const ctx = ctxFor({
    run: a.run,
    stages: { ac: { stage: 'ac', status: 'ok', reason: null, fetchedAt: AT, artifacts: [`docs/${KEY}/ac.md`], provenance: { handoff: { passed: [], excluded: [] } } } },
  })
  const e = await testsStage(ctx)
  assert.equal(e.status, 'failed')
  assert.equal(a.calls.length, 0)
  assert.match(e.reason, /ac /)
})

test('a stale-but-grounded upstream is consumed and recorded, not refused', async () => {
  const a = agent()
  // `ac` is grounded, but `ticket` moved under it — staleness is a badge, never a wall.
  const ctx = ctxFor({
    run: a.run,
    stages: { ticket: { ...ctxFor().manifest.stages.ticket, fetchedAt: LATER } },
  })
  const e = await testsStage(ctx)

  assert.equal(e.status, 'ok', 'stale-but-grounded is consumable — conflating it with ungrounded makes the rule unusable')
  assert.equal(a.calls.length, 1)
  const rec = e.provenance.consumedStale.find(s => s.stage === 'ac')
  assert.ok(rec, 'the consumption is recorded, not silent')
  assert.match(rec.reason, /stale/i)
  assert.match(e.reason, /stale/i, 'and it is visible on the entry without opening provenance')
})

// ---------------------------------------------------------------------------------------------
// Handoff, provenance and the artifact half
// ---------------------------------------------------------------------------------------------

test('a missing soft input is listed in handoff.excluded and the stage still runs', async () => {
  const a = agent({ result: AC_MD })
  const ctx = ctxFor({ run: a.run, stages: { 'design-read': null, sheet: null, confluence: null } })
  const e = await ac(ctx)

  assert.equal(e.status, 'ok', 'a soft input never blocks')
  assert.deepEqual(e.provenance.handoff.passed, ['ticket', 'repo'])
  for (const dep of ['design-read', 'sheet', 'confluence']) {
    assert.ok(e.provenance.handoff.excluded.includes(dep), `${dep} is recorded as excluded`)
  }
  assert.match(e.reason, /generated without/, 'the gap is in words on the entry too')
  assert.match(a.calls[0].prompt, /Not available/, 'and the agent is TOLD what it does not have, so it writes a question instead of a guess')
})

test('ac writes its artifact into docs/<KEY>/ with a path relative to repoDir', async () => {
  const a = agent({ result: AC_MD })
  const ctx = ctxFor({ run: a.run })
  const e = await ac(ctx)

  assert.equal(e.status, 'ok')
  assert.deepEqual(e.artifacts, [`docs/${KEY}/ac.md`])
  assert.ok(!path.isAbsolute(e.artifacts[0]), 'the repo half travels with the clone, so an absolute path in the manifest would name a dir that does not exist on the next machine')
  assert.ok(fs.existsSync(path.resolve(ctx.repoDir, e.artifacts[0])))
  assert.equal(e.provenance.groundedIn, path.basename(ctx.repoDir), 'the repo it could actually read — the field that would have told the two colliding AC generators apart')
  assert.equal(e.provenance.reqHash, 'req-1')
  assert.equal(e.provenance.model, 'claude-opus-5')
  assert.equal(e.provenance.cost, 0.41)
  assert.equal(e.provenance.turns, 6)
  assert.deepEqual(e.provenance.consumedStale, [])
})

test("ac's `## Unspecified` section survives verbatim into the artifact", async () => {
  const a = agent({ result: AC_MD })
  const ctx = ctxFor({ run: a.run })
  const e = await ac(ctx)

  const body = artifactBody(ctx, e)
  assert.match(body, /## Unspecified — needs an answer/, 'that section is the grilling stage\'s agenda — losing it costs the gate its input')
  assert.match(body, /does the filter survive a logout\?/)
  assert.match(a.calls[0].prompt, /## Unspecified — needs an answer/, 'and the prompt that makes it mandatory is passed through as-is')
})

test('a non-git workspace still writes, and carries tracked: false through', async () => {
  const a = agent({ result: AC_MD })
  const ctx = ctxFor({ run: a.run, tracked: false })
  const e = await ac(ctx)

  assert.equal(e.status, 'ok')
  assert.equal(e.tracked, false)
  assert.ok(fs.existsSync(path.resolve(ctx.repoDir, e.artifacts[0])), 'untracked means not reviewable in a PR, not unwritten')
  assert.match(e.reason, /not a git repo/i)
})

// ---------------------------------------------------------------------------------------------
// Failures are entries, never exceptions
// ---------------------------------------------------------------------------------------------

test('an agent timeout yields a non-ok entry rather than throwing', async () => {
  const a = agent({ error: 'timeout after 15min' })
  const ctx = ctxFor({ run: a.run })
  const e = await ac(ctx)   // must not reject

  assert.equal(e.status, 'failed')
  assert.match(e.reason, /timeout after 15min/)
  assert.ok(e.provenance, 'even a run that produced nothing says what it was going to be given')
  assert.deepEqual(e.provenance.handoff.passed, ['ticket', 'repo', 'sheet'])
  assert.ok(e.provenance.handoff.excluded.includes('design-read'))
})

test('a missing hard input is `skipped` naming the upstream, not `failed`', async () => {
  const a = agent()
  const ctx = ctxFor({ run: a.run, stages: { figma: { stage: 'figma', status: 'failed', reason: 'Figma would not answer', fetchedAt: AT, artifacts: [], provenance: null } } })
  const e = await designRead(ctx)

  assert.equal(e.status, 'skipped', 'a broken branch halts a branch, never the run')
  assert.equal(a.calls.length, 0)
  assert.match(e.reason, /figma/)
  assert.match(e.reason, /Figma would not answer/, 'the upstream reason travels, so a human does not have to go and find it')
})

// ---------------------------------------------------------------------------------------------
// The chains that matter
// ---------------------------------------------------------------------------------------------

test('tests is fed the STORED ac.md, not the raw ticket', async () => {
  const a = agent()
  const ctx = ctxFor({ run: a.run })
  const e = await testsStage(ctx)

  assert.equal(e.status, 'ok')
  const prompt = a.calls[0].prompt
  assert.match(prompt, /AC-1 the filter persists across a reload/, 'rows cite AC ids, and an id only means something if the criteria are the ones on disk')
  assert.doesNotMatch(prompt, /distinctive-phrase-only-in-the-ticket/, 'the plan is written against the criteria that were agreed, not against the ticket prose')
  assert.deepEqual(e.artifacts, [`docs/${KEY}/tests.md`])
})

test('tests refuses when the stored criteria cannot be read', async () => {
  const a = agent()
  const ctx = ctxFor({ run: a.run })
  fs.rmSync(path.join(ctx.repoDir, 'docs', KEY, 'ac.md'))
  const e = await testsStage(ctx)

  assert.equal(e.status, 'failed')
  assert.equal(a.calls.length, 0)
  assert.match(e.reason, /ac\.md/)
})

test('design-read is handed the cached screenshots and the copy deck by absolute path', async () => {
  const a = agent()
  const ctx = ctxFor({ run: a.run })
  const e = await designRead(ctx)

  assert.equal(e.status, 'ok')
  assert.deepEqual(e.artifacts, [`docs/${KEY}/design.md`], 'ONE markdown artifact: what the design says')
  const prompt = a.calls[0].prompt
  assert.ok(prompt.includes(ctx.shot), 'the PNGs live in the machine-local cache half, so the path has to be absolute')
  assert.ok(prompt.includes(path.join(ctx.repoDir, 'docs', KEY, 'content.csv')), 'the copy deck is resolved against repoDir')
  assert.match(prompt, /Open questions from the design/, 'all interpretation lives here — the figma stage is a pure fetcher')
  assert.match(e.provenance.groundedIn, /copy-deck/)
  assert.equal(a.calls[0].cwd, ctx.repoDir)
})

test('design-read without a copy deck says so rather than implying the mockup text is confirmed', async () => {
  const a = agent()
  const ctx = ctxFor({ run: a.run, stages: { sheet: null } })
  const e = await designRead(ctx)

  assert.equal(e.status, 'ok')
  assert.ok(e.provenance.handoff.excluded.includes('sheet'))
  assert.match(a.calls[0].prompt, /no copy deck/i)
  assert.doesNotMatch(e.provenance.groundedIn, /copy-deck/)
})
