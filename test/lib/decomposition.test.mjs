import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTasks, validateTasks, globToRegExp, matchGlob, SIZES, MAX_TASKS } from '../../lib/decomposition.mjs'

const REPO = [
  'server/eng.mjs', 'server/ticket.mjs', 'server/index.mjs',
  'lib/task-graph.mjs', 'lib/decomposition.mjs',
  'src/eng/ReadyBlocked.jsx', 'src/sections/EngDashboard.jsx',
  'test/lib/task-graph.test.mjs',
]

const task = (id, { size = 'S', deps = '[]', conflicts = '[]', files = '' } = {}) =>
  `## ${id}. Task ${id}\n- size: ${size}\n- depends_on: ${deps}\n- conflicts_with: ${conflicts}\n- files: ${files}\n`

const kinds = v => v.problems.map(p => p.kind)

// ---- globs ----

test('a literal path matches only itself', () => {
  assert.deepEqual(matchGlob('server/eng.mjs', REPO), ['server/eng.mjs'])
  assert.deepEqual(matchGlob('server/nope.mjs', REPO), [])
})

test('* stays inside one path segment', () => {
  assert.deepEqual(matchGlob('server/*.mjs', REPO).sort(), ['server/eng.mjs', 'server/index.mjs', 'server/ticket.mjs'])
  assert.deepEqual(matchGlob('*.mjs', REPO), [], 'a single star must not cross a slash')
})

test('** crosses segments and also matches zero of them', () => {
  assert.deepEqual(matchGlob('src/**/*.jsx', REPO).sort(), ['src/eng/ReadyBlocked.jsx', 'src/sections/EngDashboard.jsx'])
  assert.deepEqual(matchGlob('lib/**/*.mjs', REPO).sort(), ['lib/decomposition.mjs', 'lib/task-graph.mjs'],
    'lib/**/ must match lib/x.mjs with no intervening directory')
})

test('brace alternation works', () => {
  assert.deepEqual(matchGlob('server/{eng,ticket}.mjs', REPO).sort(), ['server/eng.mjs', 'server/ticket.mjs'])
})

test('regex metacharacters in a path are literal, not operators', () => {
  assert.deepEqual(matchGlob('a.b', ['a.b', 'axb']), ['a.b'], 'the dot must not match any character')
})

test('an empty or unparseable glob matches nothing rather than everything', () => {
  for (const g of ['', null, undefined, '   ']) assert.equal(globToRegExp(g), null, JSON.stringify(g))
  assert.deepEqual(matchGlob('', REPO), [])
})

// ---- parsing ----

test('a well-formed task parses into its fields', () => {
  const { tasks } = parseTasks(task(1, { size: 'M', deps: '[2, 3]', files: 'server/eng.mjs, lib/task-graph.mjs' }))
  assert.equal(tasks.length, 1)
  assert.deepEqual(tasks[0], {
    ...tasks[0],
    id: 1, size: 'M', dependsOn: [2, 3], conflictsWith: [], files: ['server/eng.mjs', 'lib/task-graph.mjs'],
  })
})

test('a heading with no task number is reported, not renumbered into place', () => {
  const p = parseTasks('## Overview\nsome prose\n\n' + task(1))
  assert.equal(p.tasks.length, 1)
  assert.equal(p.malformed.length, 1)
  assert.match(p.malformed[0].reason, /nothing can depend on it/)
})

test('a size outside the vocabulary is kept verbatim but not accepted', () => {
  const { tasks } = parseTasks(task(1, { size: 'HUGE' }))
  assert.equal(tasks[0].size, null)
  assert.equal(tasks[0].sizeRaw, 'HUGE')
})

test('every declared size is accepted', () => {
  for (const s of SIZES) assert.equal(parseTasks(task(1, { size: s })).tasks[0].size, s)
})

test('parsing junk yields no tasks rather than throwing', () => {
  for (const junk of ['', null, undefined, 'no headings at all', '## \n']) {
    assert.doesNotThrow(() => parseTasks(junk))
  }
})

// ---- validation ----

test('a clean two-task plan validates', () => {
  const v = validateTasks(parseTasks(task(1, { files: 'server/eng.mjs' }) + task(2, { deps: '[1]', files: 'lib/task-graph.mjs' })), REPO)
  assert.equal(v.ok, true)
  assert.equal(v.counts.errors, 0)
  assert.equal(v.filesChecked, true)
  assert.equal(v.note, null)
})

test('a dependency on a task that does not exist is an error', () => {
  const v = validateTasks(parseTasks(task(1, { deps: '[9]', files: 'server/eng.mjs' })), REPO)
  assert.ok(kinds(v).includes('unknown-dependency'))
  assert.equal(v.ok, false)
})

test('a self-dependency is an error', () => {
  const v = validateTasks(parseTasks(task(1, { deps: '[1]', files: 'server/eng.mjs' })), REPO)
  assert.ok(kinds(v).includes('self-dependency'))
})

test('a dependency cycle is an error and names the loop', () => {
  const v = validateTasks(parseTasks(
    task(1, { deps: '[2]', files: 'server/eng.mjs' }) + task(2, { deps: '[1]', files: 'server/ticket.mjs' })), REPO)
  const c = v.problems.find(p => p.kind === 'dependency-cycle')
  assert.ok(c)
  assert.match(c.detail, /can never start/)
  assert.equal(v.ok, false)
})

test('two independent tasks touching the same file is an error nobody declared', () => {
  const v = validateTasks(parseTasks(
    task(1, { files: 'server/eng.mjs' }) + task(2, { files: 'server/eng.mjs' })), REPO)
  const o = v.problems.find(p => p.kind === 'undeclared-overlap')
  assert.ok(o, 'this is the failure the document itself cannot show')
  assert.deepEqual(o.tasks, [1, 2])
  assert.deepEqual(o.files, ['server/eng.mjs'])
  assert.equal(v.ok, false)
})

test('the same overlap is fine once it is declared', () => {
  const v = validateTasks(parseTasks(
    task(1, { files: 'server/eng.mjs', conflicts: '[2]' }) + task(2, { files: 'server/eng.mjs' })), REPO)
  assert.ok(kinds(v).includes('declared-conflict'))
  assert.equal(v.counts.errors, 0)
})

test('an ordered pair cannot conflict, however much scope they share', () => {
  const v = validateTasks(parseTasks(
    task(1, { files: 'server/eng.mjs' }) + task(2, { deps: '[1]', files: 'server/eng.mjs' })), REPO)
  assert.ok(!kinds(v).includes('undeclared-overlap'), 'task 2 runs after task 1 — they never collide')
})

test('a transitive ordering also prevents a conflict', () => {
  const v = validateTasks(parseTasks(
    task(1, { files: 'server/eng.mjs' }) + task(2, { deps: '[1]', files: 'lib/task-graph.mjs' }) + task(3, { deps: '[2]', files: 'server/eng.mjs' })), REPO)
  assert.ok(!kinds(v).includes('undeclared-overlap'))
})

test('overlap is computed on matched files, so different globs hitting one file still collide', () => {
  const v = validateTasks(parseTasks(
    task(1, { files: 'server/*.mjs' }) + task(2, { files: 'server/eng.mjs' })), REPO)
  const o = v.problems.find(p => p.kind === 'undeclared-overlap')
  assert.ok(o, 'a glob and a literal that resolve to the same file are the same scope')
  assert.ok(o.files.includes('server/eng.mjs'))
})

test('a path matching nothing in the checkout is a warning that names the pattern', () => {
  const v = validateTasks(parseTasks(task(1, { files: 'src/imaginary/Thing.jsx' })), REPO)
  const p = v.problems.find(x => x.kind === 'path-not-in-repo')
  assert.equal(p.pattern, 'src/imaginary/Thing.jsx')
  assert.equal(p.severity, 'warn', 'a task that CREATES a file legitimately matches nothing')
  assert.equal(v.ok, true)
})

test('without the checkout, the file checks are reported as not run rather than passing', () => {
  const v = validateTasks(parseTasks(task(1, { files: 'server/eng.mjs' }) + task(2, { files: 'server/eng.mjs' })))
  assert.equal(v.filesChecked, false)
  assert.match(v.note, /NOT checked/)
  assert.ok(!kinds(v).includes('undeclared-overlap'), 'it cannot know, so it must not claim')
})

test('duplicate task numbers are an error, since a dependency on one is ambiguous', () => {
  const v = validateTasks(parseTasks(task(1, { files: 'server/eng.mjs' }) + task(1, { files: 'lib/task-graph.mjs' })), REPO)
  assert.ok(kinds(v).includes('duplicate-id'))
})

test('a missing size and a missing file scope are warnings, not errors', () => {
  const v = validateTasks(parseTasks('## 1. Bare task\n'), REPO)
  assert.ok(kinds(v).includes('missing-size'))
  assert.ok(kinds(v).includes('no-file-scope'))
  assert.equal(v.counts.errors, 0)
})

test('more tasks than the cap is reported rather than truncated', () => {
  let md = ''
  for (let i = 1; i <= MAX_TASKS + 3; i++) md += task(i, { files: `server/eng.mjs` })
  const v = validateTasks(parseTasks(md), REPO)
  const p = v.problems.find(x => x.kind === 'too-many-tasks')
  assert.match(p.detail, new RegExp(`${MAX_TASKS + 3} tasks`))
  assert.equal(v.tasks.length, MAX_TASKS + 3, 'nothing is dropped — the reader decides')
})

test('an empty decomposition is an error, not a vacuous pass', () => {
  const v = validateTasks(parseTasks('just prose, no tasks'), REPO)
  assert.ok(kinds(v).includes('no-tasks'))
  assert.equal(v.ok, false)
})

test('validation never throws on junk', () => {
  for (const junk of [null, undefined, {}, { tasks: null }]) {
    assert.doesNotThrow(() => validateTasks(junk, REPO), JSON.stringify(junk))
  }
})
