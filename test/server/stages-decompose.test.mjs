import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { decompose, blastRadius, subtickets, parseAffected, renderSubticket, DESC_CAP } from '../../server/stages/decompose.mjs'
import { entry } from '../../lib/dossier.mjs'

const KEY = 'ABC-1234'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const made = []
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }) })

/**
 * A workspace with the upstream stages already `ok` — the state `decompose` actually runs in.
 * `files` is the checkout the `repo` stage walked, which is what file scopes are validated against.
 */
function ws({ files = ['lib/a.mjs', 'lib/b.mjs', 'src/c.jsx'], truncated = false, stages = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stages-decompose-'))
  made.push(dir)
  const cacheDir = path.join(dir, '.cache')
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.mkdirSync(path.join(dir, 'docs', KEY), { recursive: true })
  fs.writeFileSync(path.join(dir, 'docs', KEY, 'ticket.md'), '# ABC-1234 — do the thing\n')
  for (const f of files) {
    fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true })
    fs.writeFileSync(path.join(dir, f), '\n')
  }
  const filesJson = path.join(cacheDir, 'files.json')
  fs.writeFileSync(filesJson, JSON.stringify({ files, truncated }))

  const manifest = {
    v: 1, key: KEY, tracked: true,
    stages: {
      ticket: entry({ stage: 'ticket', status: 'ok', artifacts: [`docs/${KEY}/ticket.md`], provenance: { groundedIn: 'atlassian', reqHash: 'h1' } }),
      repo: entry({
        stage: 'repo', status: 'ok', artifacts: [filesJson],
        provenance: {
          fileCount: files.length, truncated,
          warnings: truncated ? [{ severity: 'warn', kind: 'checkout-truncated', detail: 'the file walk stopped at the cap, so a "matches nothing in the checkout" finding may be the cap rather than a bad path' }] : [],
        },
      }),
      ac: entry({ stage: 'ac', status: 'ok', artifacts: [`docs/${KEY}/ac.md`], provenance: { groundedIn: 'dashboard' } }),
      ...stages,
    },
  }
  fs.writeFileSync(path.join(dir, 'docs', KEY, 'ac.md'), '# Acceptance criteria\n\n- AC-1 it works\n')
  return { repoDir: dir, cacheDir, key: KEY, cfg: {}, manifest }
}

const agent = md => async () => ({ result: md, cost: 0.1, turns: 3, model: 'claude', sessionId: 's1' })
const tasksOf = e => JSON.parse(fs.readFileSync(path.join(e.__dir, e.artifacts[1]), 'utf8'))
const readTasks = (ctx, e) => JSON.parse(fs.readFileSync(path.resolve(ctx.repoDir, e.artifacts[1]), 'utf8'))
const kinds = t => t.problems.map(p => p.kind)

// ---------------------------------------------------------------------------------------------
// decompose
// ---------------------------------------------------------------------------------------------

const TWO_UNORDERED = `## 1. Add the reader
- size: S
- depends_on: [ ]
- conflicts_with: [ ]
- files: lib/a.mjs

Read the thing.

## 2. Add the writer
- size: S
- depends_on: [ ]
- conflicts_with: [ ]
- files: lib/a.mjs

Write the thing.
`

test('two unordered tasks sharing a file are reported — and the stage still succeeds', async () => {
  const ctx = ws()
  const e = await decompose(ctx, { run: agent(TWO_UNORDERED) })
  assert.equal(e.status, 'ok', 'a validation finding surfaces to the human at G2; it does not fail the stage')
  const t = readTasks(ctx, e)
  const overlap = t.problems.find(p => p.kind === 'undeclared-overlap')
  assert.ok(overlap, `expected an undeclared-overlap finding, got ${kinds(t).join(', ')}`)
  assert.deepEqual(overlap.tasks, [1, 2])
  assert.match(overlap.detail, /lib\/a\.mjs/)
  assert.match(e.reason, /gate G2/)
  assert.equal(t.tasks.length, 2, 'both tasks are kept — the finding is against them, not instead of them')
})

test('a dependency cycle is reported', async () => {
  const ctx = ws()
  const md = `## 1. One
- size: S
- depends_on: [2]
- files: lib/a.mjs

## 2. Two
- size: S
- depends_on: [1]
- files: lib/b.mjs
`
  const e = await decompose(ctx, { run: agent(md) })
  assert.equal(e.status, 'ok')
  const t = readTasks(ctx, e)
  assert.ok(t.problems.find(p => p.kind === 'dependency-cycle'), `expected a cycle, got ${kinds(t).join(', ')}`)
})

test('a malformed heading is reported without losing the other tasks', async () => {
  const ctx = ws()
  const md = `## Add the reader
- size: S
- files: lib/a.mjs

## 2. Add the writer
- size: S
- files: lib/b.mjs
`
  const e = await decompose(ctx, { run: agent(md) })
  assert.equal(e.status, 'ok')
  const t = readTasks(ctx, e)
  assert.equal(t.tasks.length, 1, 'the parseable task survives')
  assert.equal(t.malformed.length, 1)
  assert.match(t.malformed[0].reason, /no task number/)
  assert.ok(t.problems.find(p => p.kind === 'malformed-task'))
  assert.match(e.reason, /1 heading\(s\) could not be parsed/)
})

test('more than MAX_TASKS is reported', async () => {
  const ctx = ws()
  const md = Array.from({ length: 12 }, (_, i) => `## ${i + 1}. Task ${i + 1}\n- size: S\n- files: lib/a.mjs\n`).join('\n')
  const e = await decompose(ctx, { run: agent(md) })
  const t = readTasks(ctx, e)
  const cap = t.problems.find(p => p.kind === 'too-many-tasks')
  assert.ok(cap, `expected too-many-tasks, got ${kinds(t).join(', ')}`)
  assert.match(cap.detail, /capped at 10/)
})

test('the checkout-truncated warning is carried into the findings, above them', async () => {
  const ctx = ws({ truncated: true })
  const md = `## 1. One\n- size: S\n- files: lib/nope.mjs\n`
  const e = await decompose(ctx, { run: agent(md) })
  const t = readTasks(ctx, e)
  assert.equal(t.problems[0].kind, 'checkout-truncated', 'it must come first — it changes how every path finding below it reads')
  assert.ok(t.problems.find(p => p.kind === 'path-not-in-repo'), 'the path finding is still made, just qualified')
})

test('an ungrounded upstream is a wall, and a missing hard input is a skip naming it', async () => {
  const bad = ws({ stages: { ac: entry({ stage: 'ac', status: 'ok', artifacts: [`docs/${KEY}/ac.md`], provenance: { model: 'claude' } }) } })
  const wall = await decompose(bad, { run: agent(TWO_UNORDERED) })
  assert.equal(wall.status, 'failed')
  assert.match(wall.reason, /ungrounded/)

  const missing = ws({ stages: { ac: entry({ stage: 'ac', status: 'failed', reason: 'the agent timed out' }) } })
  const skipped = await decompose(missing, { run: agent(TWO_UNORDERED) })
  assert.equal(skipped.status, 'skipped')
  assert.match(skipped.reason, /ac is failed/)
})

// ---------------------------------------------------------------------------------------------
// blast-radius
// ---------------------------------------------------------------------------------------------

/** A workspace whose `decompose` stage has already produced a task list. */
function withTasks(tasks, opts = {}) {
  const ctx = ws(opts)
  const rel = `docs/${KEY}/decompose.tasks.json`
  fs.writeFileSync(path.join(ctx.repoDir, rel), JSON.stringify({ tasks, malformed: [], problems: [] }))
  ctx.manifest.stages.decompose = entry({ stage: 'decompose', status: 'ok', artifacts: [`docs/${KEY}/decompose.md`, rel], provenance: { groundedIn: 'x' } })
  return ctx
}

/** A graph "exists" for a workspace: `graph.json` present, `manifest.json` listing indexed files. */
function withGraph(ctx, indexed) {
  const dir = path.join(ctx.repoDir, 'graphify-out')
  fs.mkdirSync(dir, { recursive: true })
  // Deliberately not JSON. If the stage ever parses graph.json, this test fails — it is 1.4MB and
  // reading it is exactly what the CLI exists to avoid (spec §1).
  fs.writeFileSync(path.join(dir, 'graph.json'), 'READING THIS FILE IS FORBIDDEN FOR THIS STAGE')
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(indexed))
  return ctx
}

test('blast-radius with no graph is unavailable with a reason, and never builds one', async () => {
  const ctx = withTasks([{ id: 1, title: 'One', dependsOn: [], files: ['lib/a.mjs'] }])
  const e = await blastRadius(ctx, { graphify: () => assert.fail('the CLI must not be called when there is no graph') })
  assert.equal(e.status, 'unavailable')
  assert.match(e.reason, /no graphify graph exists/)
  assert.match(e.reason, /refused rather than built/)
  assert.ok(!fs.existsSync(path.join(ctx.repoDir, 'graphify-out')), 'nothing was built')
})

test('a file with no node in the graph is a reported gap, not "0 importers" — and graph.json is never read', async () => {
  const ctx = withGraph(
    withTasks([{ id: 1, title: 'One', dependsOn: [], files: ['lib/a.mjs', 'lib/b.mjs'] }]),
    { 'lib/a.mjs': { mtime: 1, ast_hash: 'x' } },   // b.mjs was never indexed
  )
  const calls = []
  const e = await blastRadius(ctx, {
    graphify: args => { calls.push(args); return { ok: true, stdout: 'Affected nodes for a.mjs\nDepth: 2\n- eng.mjs [imports_from] server/eng.mjs:L1\n' } },
  })
  assert.equal(e.status, 'ok')
  const out = JSON.parse(fs.readFileSync(path.join(ctx.repoDir, 'docs', KEY, 'blast-radius.json'), 'utf8'))

  assert.equal(out.files.length, 1)
  assert.equal(out.files[0].file, 'lib/a.mjs')
  assert.equal(out.files[0].importers, 1)

  const gap = out.gaps.find(g => g.file === 'lib/b.mjs')
  assert.ok(gap, 'an unindexed file must appear as a gap')
  assert.equal(gap.kind, 'not-indexed')
  assert.match(gap.detail, /unknown, not zero/)
  assert.equal(out.files.find(f => f.file === 'lib/b.mjs'), undefined, 'it must NOT be reported with 0 importers')
  assert.match(e.reason, /UNKNOWN, not zero/)

  assert.equal(calls.length, 1, 'the CLI is only asked about files the graph actually indexed')
  assert.deepEqual(calls[0].slice(0, 2), ['affected', 'a.mjs'], 'node ids are symbol-based, so a file is asked for by basename')
  // A file that is stale relative to the graph is flagged: the recorded mtime is 1970.
  assert.ok(out.stale.find(s => s.file === 'lib/a.mjs'), 'a file changed since indexing is flagged')
})

test('an indexed file the graph has no unique node for is a gap, not zero', async () => {
  const ctx = withGraph(withTasks([{ id: 1, title: 'One', dependsOn: [], files: ['lib/a.mjs'] }]), { 'lib/a.mjs': { mtime: 9e9 } })
  const e = await blastRadius(ctx, { graphify: () => ({ ok: true, stdout: 'No unique node match for a.mjs\n' }) })
  const out = JSON.parse(fs.readFileSync(path.join(ctx.repoDir, 'docs', KEY, 'blast-radius.json'), 'utf8'))
  assert.equal(out.files.length, 0)
  assert.equal(out.gaps[0].kind, 'no-node')
  assert.match(out.gaps[0].detail, /unknown, not zero/)
  assert.equal(e.status, 'ok')
})

test('parseAffected reads the CLI, not the exit code: stderr warnings and a zero answer are distinct', () => {
  assert.deepEqual(parseAffected('No unique node match for zzz.mjs'), { node: false, importers: [] })
  const zero = parseAffected('Affected nodes for index.mjs\nRelations: calls\nDepth: 2\nNo affected nodes found.')
  assert.equal(zero.node, true, 'a matched node with nothing importing it is a real zero')
  assert.equal(zero.importers.length, 0)
  const one = parseAffected('Affected nodes for paths.mjs\nDepth: 2\n- eng.mjs [imports_from] server/eng.mjs:L1')
  assert.deepEqual(one.importers[0], { label: 'eng.mjs', relation: 'imports_from', at: 'server/eng.mjs:L1' })
})

test('the real graphify CLI answers for a real node in this repo', { skip: !fs.existsSync(path.join(REPO, 'graphify-out', 'graph.json')) && 'no graph built for this repo' }, async () => {
  const ctx = withTasks([{ id: 1, title: 'One', dependsOn: [], files: ['lib/paths.mjs'] }])
  // The real graph, linked rather than copied: 1.4MB, and the stage only stats it anyway.
  const dir = path.join(ctx.repoDir, 'graphify-out')
  fs.mkdirSync(dir, { recursive: true })
  for (const f of ['graph.json', 'manifest.json']) fs.symlinkSync(path.join(REPO, 'graphify-out', f), path.join(dir, f))

  const e = await blastRadius(ctx)   // no stub: the real CLI, with its stderr warning on every call
  assert.equal(e.status, 'ok', e.reason)
  const out = JSON.parse(fs.readFileSync(path.join(ctx.repoDir, 'docs', KEY, 'blast-radius.json'), 'utf8'))
  const hit = out.files.find(f => f.file === 'lib/paths.mjs')
  assert.ok(hit, `expected a real answer for lib/paths.mjs, got gaps: ${JSON.stringify(out.gaps)}`)
  assert.ok(hit.importers > 0, 'lib/paths.mjs is imported by several servers')
  assert.ok(hit.sample[0].at, 'each importer carries where it is')
})

// ---------------------------------------------------------------------------------------------
// subtickets — G2
// ---------------------------------------------------------------------------------------------

const ACCEPTED = [
  { id: 1, title: 'Add the reader', size: 'S', dependsOn: [], conflictsWith: [], files: ['lib/a.mjs'], body: 'Read the thing.' },
  { id: 2, title: 'Add the writer', size: 'M', dependsOn: [1], conflictsWith: [], files: ['lib/b.mjs', 'lib/new.mjs'], body: 'Write the thing.' },
]

function withLinks(ctx) {
  const rel = `docs/${KEY}/links.json`
  fs.writeFileSync(path.join(ctx.repoDir, rel), JSON.stringify({ figma: ['https://www.figma.com/file/abc'], sheets: [{ url: 'https://docs.google.com/spreadsheets/d/deck', id: 'deck', gid: '3' }] }))
  ctx.manifest.stages.links = entry({ stage: 'links', status: 'ok', artifacts: [rel], provenance: { groundedIn: 'atlassian' } })
  ctx.manifest.stages.ticket.sourceUrl = 'https://example.atlassian.net/browse/ABC-1234'
  return ctx
}

test('nothing is written to docs/<KEY>/N.md without an accepted list', async () => {
  const ctx = withTasks(ACCEPTED)
  const e = await subtickets(ctx)   // exactly how the RUNNER calls it: no `accepted` in ctx
  assert.equal(e.status, 'skipped')
  assert.match(e.reason, /has not been accepted at gate G2/)
  assert.deepEqual(e.artifacts, [])
  assert.ok(!fs.existsSync(path.join(ctx.repoDir, 'docs', KEY, '1.md')), 'the poller cannot write sub-tickets')
})

test('an accepted split writes loush-format sub-tickets with the parallel-safety invariant on the page', async () => {
  const ctx = withLinks(withTasks(ACCEPTED))
  const e = await subtickets({ ...ctx, accepted: { tasks: ACCEPTED } })
  assert.equal(e.status, 'ok', e.reason)
  assert.deepEqual(e.artifacts, [`docs/${KEY}/1.md`, `docs/${KEY}/2.md`])

  const one = fs.readFileSync(path.join(ctx.repoDir, 'docs', KEY, '1.md'), 'utf8')
  assert.match(one, /# ABC-1234 — 1\. Add the reader/)
  assert.match(one, /## Depends on\n\n- Nothing/)
  assert.match(one, /## Files to modify\n\n- lib\/a\.mjs/)
  assert.match(one, /## Must NOT touch[\s\S]*lib\/b\.mjs/, 'the files another sub-ticket owns — this is what makes parallel worktrees safe')

  const two = fs.readFileSync(path.join(ctx.repoDir, 'docs', KEY, '2.md'), 'utf8')
  assert.match(two, /## Depends on\n\n- 1 — Add the reader/)
  assert.match(two, /## Files to modify\n\n- lib\/b\.mjs/)
  assert.match(two, /## Files to create\n\n- lib\/new\.mjs/, 'a path that matches nothing in the checkout is a file to create')
})

test('a clipped handoff sets capped and drops nothing before the pointers', async () => {
  const ctx = withLinks(withTasks(ACCEPTED))
  fs.writeFileSync(path.join(ctx.repoDir, 'docs', KEY, 'ac.md'), '# AC\n' + 'a'.repeat(DESC_CAP))
  fs.writeFileSync(path.join(ctx.repoDir, 'docs', KEY, 'tests.md'), '# Tests\n' + 'b'.repeat(DESC_CAP))
  ctx.manifest.stages.tests = entry({ stage: 'tests', status: 'ok', artifacts: [`docs/${KEY}/tests.md`], provenance: { groundedIn: 'dashboard' } })

  const e = await subtickets({ ...ctx, accepted: { tasks: ACCEPTED } })
  assert.equal(e.status, 'ok')
  assert.ok(e.provenance.capped.length, 'the caller must be able to TELL it was clipped')
  assert.deepEqual(e.provenance.capped[0].dropped, ['Acceptance criteria', 'Test cases'])
  assert.match(e.reason, /clipped at 20000 chars/, 'rendered as a persistent panel, so it has to be in the entry')

  const one = fs.readFileSync(path.join(ctx.repoDir, 'docs', KEY, '1.md'), 'utf8')
  assert.ok(one.length <= DESC_CAP + 200, 'the body stays near the budget')
  // The observed failure this rule comes from: AC + tests reached the cap and dropped the Figma link.
  assert.match(one, /figma\.com\/file\/abc/)
  assert.match(one, /spreadsheets\/d\/deck/)
  assert.match(one, /browse\/ABC-1234/)
  assert.match(one, /## Files to modify/)
  assert.match(one, /Acceptance criteria \(full\): `docs\/ABC-1234\/ac\.md`/, 'the pointer survives even when the content does not')
})

test('renderSubticket never drops a head section, even when the head alone is over budget', () => {
  const { body, dropped } = renderSubticket({
    key: KEY, task: { id: 1, title: 'Big' },
    head: ['## Context and pointers\n\n- Figma: https://figma.com/x'],
    tail: [{ title: 'Acceptance criteria', body: 'x'.repeat(100) }],
    cap: 10,
  })
  assert.match(body, /figma\.com\/x/)
  assert.deepEqual(dropped, ['Acceptance criteria'])
})

test('a leftover sub-ticket from an earlier, larger accept is removed and named', async () => {
  const ctx = withLinks(withTasks(ACCEPTED))
  fs.writeFileSync(path.join(ctx.repoDir, 'docs', KEY, '3.md'), '# a sub-ticket nobody accepted\n')
  const e = await subtickets({ ...ctx, accepted: { tasks: ACCEPTED } })
  assert.ok(!fs.existsSync(path.join(ctx.repoDir, 'docs', KEY, '3.md')), 'it would be handed to /loush-feature as a phantom sub-ticket')
  assert.match(e.reason, /removed 3\.md/)
})

test('blast-radius findings ride into the sub-ticket, gaps in words', async () => {
  const ctx = withLinks(withTasks(ACCEPTED))
  const rel = `docs/${KEY}/blast-radius.json`
  fs.writeFileSync(path.join(ctx.repoDir, rel), JSON.stringify({
    files: [{ file: 'lib/a.mjs', tasks: [1], importers: 40, sample: [] }],
    gaps: [{ file: 'lib/b.mjs', tasks: [2], kind: 'not-indexed', detail: 'lib/b.mjs is not in graphify-out/manifest.json, so its blast radius is unknown, not zero' }],
    stale: [],
  }))
  ctx.manifest.stages['blast-radius'] = entry({ stage: 'blast-radius', status: 'ok', artifacts: [rel], provenance: { groundedIn: 'graphify-cli' } })

  await subtickets({ ...ctx, accepted: { tasks: ACCEPTED } })
  const one = fs.readFileSync(path.join(ctx.repoDir, 'docs', KEY, '1.md'), 'utf8')
  assert.match(one, /40 importer\(s\)[\s\S]*heavily depended on/)
  const two = fs.readFileSync(path.join(ctx.repoDir, 'docs', KEY, '2.md'), 'utf8')
  assert.match(two, /blast radius UNKNOWN/)
  assert.doesNotMatch(two, /lib\/b\.mjs` — 0 importer/)
})
