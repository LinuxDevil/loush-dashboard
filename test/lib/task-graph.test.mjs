import test from 'node:test'
import assert from 'node:assert/strict'
import { dependenciesOf, findCycles, partitionByReadiness, unblockImpact } from '../../lib/task-graph.mjs'

const issue = (key, statusKind, links = [], extra = {}) => ({
  key, statusKind, status: statusKind === 'done' ? 'Live' : 'In Progress',
  summary: `${key} summary`, links, ...extra,
})
const link = (key, rel) => ({ key, rel, dir: 'inward', type: 'Blocks', status: '' })

test('"is blocked by" is a dependency; "blocks" is the other side of one', () => {
  assert.deepEqual(dependenciesOf(issue('A', 'active', [link('B', 'is blocked by')])).dependsOn, ['B'])
  assert.deepEqual(dependenciesOf(issue('A', 'active', [link('B', 'blocks')])).dependsOn, [])
})

test('the other real JIRA blocking phrases are recognised', () => {
  for (const rel of ['is blocked by', 'blocked by', 'depends on', 'is caused by']) {
    assert.deepEqual(dependenciesOf(issue('A', 'active', [link('B', rel)])).dependsOn, ['B'], rel)
  }
})

test('relates/duplicates/clones are not dependencies, and are reported as such', () => {
  const d = dependenciesOf(issue('A', 'active', [
    link('B', 'relates to'), link('C', 'duplicates'), link('D', 'is cloned by'),
  ]))
  assert.deepEqual(d.dependsOn, [])
  assert.deepEqual(d.ignored.map(x => x.key), ['B', 'C', 'D'])
  assert.deepEqual(d.unclassified, [], 'known non-blocking types must not land in unclassified')
})

test('a custom link type is surfaced rather than silently treated as no dependency', () => {
  const d = dependenciesOf(issue('A', 'active', [link('B', 'is prerequisite for')]))
  assert.deepEqual(d.dependsOn, [])
  assert.deepEqual(d.unclassified, [{ key: 'B', rel: 'is prerequisite for' }])
})

test('duplicate edges collapse and junk links are skipped', () => {
  const d = dependenciesOf(issue('A', 'active', [
    link('B', 'is blocked by'), link('B', 'depends on'), null, { rel: 'is blocked by' }, { key: '', rel: 'blocked by' },
  ]))
  assert.deepEqual(d.dependsOn, ['B'])
})

test('an issue with no links has no dependencies and does not crash', () => {
  assert.deepEqual(dependenciesOf({ key: 'A' }).dependsOn, [])
  assert.deepEqual(dependenciesOf(null).dependsOn, [])
})

// ---- partition ----

test('an issue whose blocker is done is ready', () => {
  const p = partitionByReadiness([
    issue('A', 'active', [link('B', 'is blocked by')]),
    issue('B', 'done'),
  ])
  assert.deepEqual(p.ready.map(r => r.key), ['A'])
  assert.equal(p.blocked.length, 0)
})

test('an issue whose blocker is open is blocked, and the blocker is named', () => {
  const p = partitionByReadiness([
    issue('A', 'active', [link('B', 'is blocked by')]),
    issue('B', 'active'),
  ])
  assert.deepEqual(p.blocked.map(r => r.key), ['A'])
  assert.deepEqual(p.blocked[0].unmet.map(u => u.key), ['B'])
  assert.equal(p.blocked[0].unmet[0].summary, 'B summary', 'naming the blocker means saying what it is')
  assert.deepEqual(p.ready.map(r => r.key), ['B'], 'B is open with no dependencies of its own, so it is startable')
})

test('B with no dependencies is ready even while it blocks A', () => {
  const p = partitionByReadiness([
    issue('A', 'active', [link('B', 'is blocked by')]),
    issue('B', 'active', [link('A', 'blocks')]),
  ])
  assert.deepEqual(p.ready.map(r => r.key), ['B'])
  assert.deepEqual(p.blocked.map(r => r.key), ['A'])
})

test('a blocker outside the fetched set is UNKNOWN, never ready', () => {
  const p = partitionByReadiness([issue('A', 'active', [link('OTHER-99', 'is blocked by')])])
  assert.deepEqual(p.ready, [], 'calling this ready would send someone at genuinely blocked work')
  assert.deepEqual(p.unknown.map(r => r.key), ['A'])
  assert.deepEqual(p.unknown[0].unresolved, ['OTHER-99'])
  assert.match(p.note, /outside the fetched set/)
})

test('a known unmet blocker outranks an unresolvable one — blocked beats unknown', () => {
  const p = partitionByReadiness([
    issue('A', 'active', [link('B', 'is blocked by'), link('GONE-1', 'is blocked by')]),
    issue('B', 'active'),
  ])
  assert.deepEqual(p.blocked.map(r => r.key), ['A'])
  assert.deepEqual(p.blocked[0].unresolved, ['GONE-1'], 'the unresolvable one is still reported on the row')
})

test('done issues are not partitioned at all', () => {
  const p = partitionByReadiness([issue('A', 'done'), issue('B', 'active')])
  assert.deepEqual(p.ready.map(r => r.key), ['B'])
  assert.equal(p.counts.open, 1)
  assert.equal(p.counts.total, 2)
})

test('a two-node cycle is reported as a cycle, not merely as blocked', () => {
  const p = partitionByReadiness([
    issue('A', 'active', [link('B', 'is blocked by')]),
    issue('B', 'active', [link('A', 'is blocked by')]),
  ])
  assert.equal(p.cycles.length, 1)
  assert.deepEqual([...new Set(p.cycles[0])].sort(), ['A', 'B'])
  assert.equal(p.ready.length, 0)
  assert.ok(p.blocked.every(b => b.cycle), 'every member of a cycle carries it')
  assert.match(p.note, /never unblock on their own/)
})

test('a longer cycle is found and reported once, not once per entry point', () => {
  const p = partitionByReadiness([
    issue('A', 'active', [link('B', 'is blocked by')]),
    issue('B', 'active', [link('C', 'is blocked by')]),
    issue('C', 'active', [link('A', 'is blocked by')]),
  ])
  assert.equal(p.cycles.length, 1)
  assert.deepEqual([...new Set(p.cycles[0])].sort(), ['A', 'B', 'C'])
})

test('a self-dependency is a cycle', () => {
  const p = partitionByReadiness([issue('A', 'active', [link('A', 'is blocked by')])])
  assert.equal(p.cycles.length, 1)
})

test('a clean chain has no cycles', () => {
  const p = partitionByReadiness([
    issue('A', 'active', [link('B', 'is blocked by')]),
    issue('B', 'active', [link('C', 'is blocked by')]),
    issue('C', 'active'),
  ])
  assert.deepEqual(p.cycles, [])
  assert.deepEqual(p.ready.map(r => r.key), ['C'])
  assert.deepEqual(p.blocked.map(r => r.key).sort(), ['A', 'B'])
})

test('a deep chain does not blow the stack', () => {
  const n = 20_000
  const issues = []
  for (let i = 0; i < n; i++) issues.push(issue(`K-${i}`, 'active', i + 1 < n ? [link(`K-${i + 1}`, 'is blocked by')] : []))
  const p = partitionByReadiness(issues)
  assert.deepEqual(p.ready.map(r => r.key), [`K-${n - 1}`])
  assert.equal(p.blocked.length, n - 1)
  assert.deepEqual(p.cycles, [])
})

test('blocked rows are ordered by how stuck they are', () => {
  const p = partitionByReadiness([
    issue('A', 'active', [link('X', 'is blocked by')]),
    issue('B', 'active', [link('X', 'is blocked by'), link('Y', 'is blocked by')]),
    issue('X', 'active'), issue('Y', 'active'),
  ])
  assert.deepEqual(p.blocked.map(r => r.key), ['B', 'A'])
})

test('counts add up and every bound is reported', () => {
  const p = partitionByReadiness([
    issue('A', 'active', [link('B', 'is blocked by')]),
    issue('B', 'active'),
    issue('C', 'active', [link('GONE', 'is blocked by')]),
    issue('D', 'done'),
    issue('E', 'active', [link('F', 'is prerequisite for')]),
  ])
  assert.equal(p.counts.ready + p.counts.blocked + p.counts.unknown, p.counts.open)
  assert.equal(p.counts.unclassifiedLinks, 1)
  assert.match(p.note, /does not classify/)
})

test('junk input yields an empty partition rather than a crash', () => {
  for (const junk of [null, undefined, 'nope', 42, [null, 'x', {}, { key: 5 }]]) {
    const p = partitionByReadiness(junk)
    assert.deepEqual(p.ready, [])
    assert.equal(p.counts.total, 0)
  }
})

test('note is null when there is nothing to warn about', () => {
  assert.equal(partitionByReadiness([issue('A', 'active')]).note, null)
})

// ---- impact ----

test('impact counts only the issues a key would actually unblock', () => {
  const impact = unblockImpact([
    issue('A', 'active', [link('X', 'is blocked by')]),
    issue('B', 'active', [link('X', 'is blocked by')]),
    // C has two blockers, so finishing X alone does not free it — it must not be counted.
    issue('C', 'active', [link('X', 'is blocked by'), link('Y', 'is blocked by')]),
    issue('X', 'active'), issue('Y', 'active'),
  ])
  assert.deepEqual(impact[0], { key: 'X', unblocks: ['A', 'B'], count: 2 })
  assert.equal(impact.length, 1, 'Y unblocks nothing on its own either')
})

test('impact is empty when nothing is blocked', () => {
  assert.deepEqual(unblockImpact([issue('A', 'active'), issue('B', 'active')]), [])
})

// ---- cycle helper directly ----

test('findCycles ignores edges pointing outside the given set', () => {
  assert.deepEqual(findCycles(new Map([['A', ['OUTSIDE']]])), [])
})

test('findCycles handles a diamond without reporting a false cycle', () => {
  const m = new Map([['A', ['B', 'C']], ['B', ['D']], ['C', ['D']], ['D', []]])
  assert.deepEqual(findCycles(m), [])
})
