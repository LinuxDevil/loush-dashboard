// Tests for lib/design-schema.mjs — the riskiest code in the Ticket feature, and the only part of
// it that is fully verifiable without a `claude` binary or JIRA credentials. Every case here is a
// shape a model actually emits: prose around the document, a wrong example before the right one,
// truncation, coordinates it was told not to invent, edges to components that do not exist.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGraph, extractDoc, validateGraph, mergeGraph, layout, applyOps, toMermaid, NODE_TYPES } from '../../lib/design-schema.mjs'

const codes = w => w.map(x => x.code)

// ── extraction ───────────────────────────────────────────────────────────────────────────────────
test('a bare YAML document parses', () => {
  const { graph, warnings } = parseGraph(`nodes:\n  - id: api\n    label: Ticket API\n    type: process\n`)
  assert.equal(graph.nodes.length, 1)
  assert.equal(graph.nodes[0].id, 'api')
  assert.deepEqual(warnings, [])
})

test('prose around a fenced block is ignored', () => {
  const raw = `Here is the design.\n\n\`\`\`yaml\nnodes:\n  - id: api\n    label: API\n\`\`\`\n\nLet me know if you want more detail.`
  const { graph, how } = parseGraph(raw)
  assert.equal(how, 'fence')
  assert.equal(graph.nodes.length, 1)
})

test('prose containing a closing brace does not break extraction — the JSON scanner bug', () => {
  // A greedy /\{[\s\S]*\}/ (server/index.mjs:4105) swallows this. YAML never sees a brace.
  const raw = 'The handler closes with } and then returns.\n\n```yaml\nnodes:\n  - id: h\n    label: Handler\n```\n\nDone }'
  const { graph } = parseGraph(raw)
  assert.equal(graph.nodes.length, 1)
  assert.equal(graph.nodes[0].data.label, 'Handler')
})

test('when a model shows a wrong example first, the LAST valid block wins', () => {
  const raw = '```yaml\nnodes:\n  - id: wrong\n    label: Example\n```\nActually, for your repo:\n```yaml\nnodes:\n  - id: right\n    label: Real\n```'
  const { graph } = parseGraph(raw)
  assert.equal(graph.nodes.length, 1)
  assert.equal(graph.nodes[0].id, 'right')
})

test('JSON inside a fence still works — the model is not forced to obey', () => {
  const raw = '```json\n{"nodes":[{"id":"api","label":"API","type":"service"}]}\n```'
  const { graph } = parseGraph(raw)
  assert.equal(graph.nodes[0].type, 'service')
})

test('an untagged fence is accepted', () => {
  const { graph } = parseGraph('```\nnodes:\n  - id: a\n    label: A\n```')
  assert.equal(graph.nodes.length, 1)
})

test('a document that starts mid-output is recovered from the nodes: key', () => {
  const { graph, how } = parseGraph('Some preamble with no fence at all.\n\nnodes:\n  - id: a\n    label: A\n')
  assert.equal(how, 'tail')
  assert.equal(graph.nodes.length, 1)
})

test('unparseable output fails closed, with a reason to feed back to the model', () => {
  const { graph, warnings, error } = parseGraph('I could not determine the architecture.')
  assert.deepEqual(graph, { nodes: [], edges: [] })
  assert.deepEqual(codes(warnings), ['parse-failed'])
  assert.ok(error && error.length > 0)
})

test('empty output is reported, not crashed on', () => {
  assert.equal(extractDoc('').error, 'empty output')
  assert.equal(extractDoc(null).doc, null)
})

// ── validation ───────────────────────────────────────────────────────────────────────────────────
test('an unknown node type is coerced AND the coercion is recorded', () => {
  const { graph, warnings } = validateGraph({ nodes: [{ id: 'a', label: 'A', type: 'lambda' }] })
  assert.equal(graph.nodes[0].type, 'process')
  assert.ok(codes(warnings).includes('type-coerced'))
})

test('every declared node type survives validation', () => {
  const { graph } = validateGraph({ nodes: NODE_TYPES.map((t, i) => ({ id: 'n' + i, label: 'N' + i, type: t })) })
  assert.deepEqual(graph.nodes.map(n => n.type), NODE_TYPES)
})

test('a dangling edge is dropped AND the drop is recorded', () => {
  const { graph, warnings } = validateGraph({
    nodes: [{ id: 'a', label: 'A' }],
    edges: [{ source: 'a', target: 'ghost', label: 'x' }],
  })
  assert.equal(graph.edges.length, 0)
  assert.ok(codes(warnings).includes('edge-dropped'))
  assert.ok(warnings[0].detail.includes('ghost'))
})

test('a model-supplied position is rejected outright and reported', () => {
  const { graph, warnings } = validateGraph({ nodes: [{ id: 'a', label: 'A', position: { x: 10, y: 20 } }] })
  assert.equal(graph.nodes[0].position, null)
  assert.ok(codes(warnings).includes('position-rejected'))
})

test('duplicate ids keep the first and warn', () => {
  const { graph, warnings } = validateGraph({ nodes: [{ id: 'a', label: 'First' }, { id: 'a', label: 'Second' }] })
  assert.equal(graph.nodes.length, 1)
  assert.equal(graph.nodes[0].data.label, 'First')
  assert.ok(codes(warnings).includes('dup-id'))
})

test('a node with no label is dropped — an unlabelled box is not a component', () => {
  const { graph, warnings } = validateGraph({ nodes: [{ id: 'a' }, { id: 'b', label: 'B' }] })
  assert.equal(graph.nodes.length, 1)
  assert.ok(codes(warnings).includes('bad-node'))
})

test('ids are slugified so a label-only node still merges predictably', () => {
  const { graph } = validateGraph({ nodes: [{ label: 'Ticket API v2!' }] })
  assert.equal(graph.nodes[0].id, 'ticket-api-v2')
})

test('a self-edge is dropped', () => {
  const { graph, warnings } = validateGraph({ nodes: [{ id: 'a', label: 'A' }], edges: [{ source: 'a', target: 'a' }] })
  assert.equal(graph.edges.length, 0)
  assert.ok(codes(warnings).includes('edge-dropped'))
})

test('node and edge counts are capped, and truncation is reported', () => {
  const nodes = Array.from({ length: 80 }, (_, i) => ({ id: 'n' + i, label: 'N' + i }))
  const { graph, warnings } = validateGraph({ nodes })
  assert.equal(graph.nodes.length, 60)
  assert.ok(codes(warnings).includes('truncated'))
})

test('generated edges are marked non-static so the UI can render them dashed', () => {
  const { graph } = validateGraph({ nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ source: 'a', target: 'b' }] })
  assert.equal(graph.edges[0].data.isStatic, false)
  assert.equal(graph.edges[0].data.origin, 'generated')
})

test('files normalise to {rel, change}', () => {
  const { graph } = validateGraph({ nodes: [{ id: 'a', label: 'A', files: ['./server/x.mjs', { rel: 'lib/y.mjs', change: 'create' }] }] })
  assert.deepEqual(graph.nodes[0].data.files, [{ rel: 'server/x.mjs', change: null }, { rel: 'lib/y.mjs', change: 'create' }])
})

test('a document with no nodes key is reported rather than throwing', () => {
  const { graph, warnings } = validateGraph({ edges: [] })
  assert.deepEqual(graph.nodes, [])
  assert.ok(codes(warnings).includes('no-nodes'))
})

// ── merge — regeneration must not destroy hand work ──────────────────────────────────────────────
const G = (nodes, edges = []) => ({ nodes, edges })
const N = (id, label, extra = {}) => ({ id, type: 'process', position: null, data: { label, note: '', files: [], origin: 'generated', ...extra } })

test('regeneration preserves node positions by slug id', () => {
  const oldG = G([{ ...N('api', 'API'), position: { x: 500, y: 300 } }])
  const { graph, report } = mergeGraph(oldG, G([N('api', 'API')]))
  assert.deepEqual(graph.nodes[0].position, { x: 500, y: 300 })
  assert.equal(report.kept, 1)
})

test('regeneration does not overwrite a hand-edited label, and surfaces the new one', () => {
  const oldG = G([N('api', 'Ticket API (corrected)', { origin: 'user' })])
  const { graph } = mergeGraph(oldG, G([N('api', 'API')]))
  assert.equal(graph.nodes[0].data.label, 'Ticket API (corrected)')
  assert.equal(graph.nodes[0].data.regeneratedLabel, 'API')
  assert.equal(graph.nodes[0].data.origin, 'user')
})

test('a user-authored node the model omitted is NOT deleted by regeneration', () => {
  const oldG = G([N('api', 'API'), N('mine', 'My node', { origin: 'user' })])
  const { graph, report } = mergeGraph(oldG, G([N('api', 'API')]))
  assert.ok(graph.nodes.some(n => n.id === 'mine'), 'user node survived')
  assert.equal(report.dropped, 0)
})

test('the merge report drives the kept/added/dropped preview', () => {
  const oldG = G([N('a', 'A'), N('b', 'B')])
  const { report } = mergeGraph(oldG, G([N('a', 'A'), N('c', 'C')]))
  assert.equal(report.kept, 1)
  assert.equal(report.added, 1)
  assert.equal(report.dropped, 1)
  assert.deepEqual(report.addedIds, ['c'])
  assert.deepEqual(report.droppedIds, ['b'])
})

test('edges to nodes that no longer exist are pruned by the merge', () => {
  const oldG = G([N('a', 'A'), N('b', 'B')], [{ id: 'e:a>b', source: 'a', target: 'b', label: '', data: {} }])
  const { graph } = mergeGraph(oldG, G([N('a', 'A')], [{ id: 'e:a>b', source: 'a', target: 'b', label: '', data: {} }]))
  assert.equal(graph.edges.length, 0)
})

// ── layout ───────────────────────────────────────────────────────────────────────────────────────
test('layout assigns coordinates by dependency depth', () => {
  const g = layout(G([N('a', 'A'), N('b', 'B')], [{ id: 'e', source: 'a', target: 'b', data: {} }]))
  assert.ok(g.nodes[0].position.x < g.nodes[1].position.x, 'b sits right of a')
})

test('layout never moves a node that already has a position', () => {
  const g = layout(G([{ ...N('a', 'A'), position: { x: 999, y: 999 } }, N('b', 'B')], [{ id: 'e', source: 'a', target: 'b', data: {} }]))
  assert.deepEqual(g.nodes[0].position, { x: 999, y: 999 })
  assert.ok(g.nodes[1].position)
})

test('layout terminates on a cyclic graph', () => {
  const g = layout(G([N('a', 'A'), N('b', 'B')], [
    { id: 'e1', source: 'a', target: 'b', data: {} },
    { id: 'e2', source: 'b', target: 'a', data: {} },
  ]))
  assert.ok(g.nodes.every(n => n.position), 'every node placed despite the cycle')
})

test('layout of an empty graph is a no-op, not a crash', () => {
  assert.deepEqual(layout(G([])).nodes, [])
})

// ── ops — the chat proposes, the user applies ────────────────────────────────────────────────────
test('a valid op list applies', () => {
  const { graph, results } = applyOps(G([N('a', 'A')]), [
    { op: 'add-node', id: 'q', label: 'Queue', type: 'queue' },
    { op: 'add-edge', source: 'a', target: 'q', label: 'enqueue' },
  ])
  assert.equal(graph.nodes.length, 2)
  assert.equal(graph.edges.length, 1)
  assert.ok(results.every(r => r.ok))
  assert.equal(graph.nodes[1].data.origin, 'assistant')
})

test('an invalid op fails alone — the valid ones still apply', () => {
  const { graph, results } = applyOps(G([N('a', 'A')]), [
    { op: 'add-node', id: 'q', label: 'Queue' },
    { op: 'add-edge', source: 'a', target: 'ghost' },
  ])
  assert.equal(graph.nodes.length, 2)
  assert.equal(results[0].ok, true)
  assert.equal(results[1].ok, false)
  assert.ok(results[1].error.includes('ghost'))
})

test('removing a node also removes its edges, and says so via the resulting graph', () => {
  const g = G([N('a', 'A'), N('b', 'B')], [{ id: 'e:a>b', source: 'a', target: 'b', data: {} }])
  const { graph } = applyOps(g, [{ op: 'remove-node', id: 'a' }])
  assert.equal(graph.nodes.length, 1)
  assert.equal(graph.edges.length, 0)
})

test('an unknown op is reported, not thrown', () => {
  const { results } = applyOps(G([]), [{ op: 'drop-database' }])
  assert.equal(results[0].ok, false)
  assert.ok(results[0].error.includes('unknown op'))
})

test('applyOps does not mutate the input graph', () => {
  const g = G([N('a', 'A')])
  applyOps(g, [{ op: 'remove-node', id: 'a' }])
  assert.equal(g.nodes.length, 1)
})

// ── export ───────────────────────────────────────────────────────────────────────────────────────
test('mermaid export uses the right shape per type and dashes inferred edges', () => {
  const g = G(
    [{ ...N('db', 'Store'), type: 'store' }, { ...N('d', 'Ready?'), type: 'decision' }],
    [{ id: 'e', source: 'db', target: 'd', label: 'check', data: { isStatic: false } }],
  )
  const m = toMermaid(g)
  assert.ok(m.startsWith('flowchart LR'))
  assert.ok(m.includes('db[("Store")]'), m)
  assert.ok(m.includes('d{"Ready?"}'), m)
  assert.ok(m.includes('-.->'), m)   // inferred stays visually distinct in the export too
})

test('mermaid export escapes quotes rather than producing broken syntax', () => {
  const m = toMermaid(G([N('a', 'The "main" API')]))
  assert.ok(!m.includes('"The "main" API"'), m)
  assert.ok(m.includes("The 'main' API"), m)
})
