// Tests for src/lib/sankey.js — the tool-flow Sankey and the 5-layer orchestration DAG.
//
// These pin the HONESTY properties, not the pixels: a cycle must be reported rather than silently
// dropped, a truncation must be reported rather than drawn as if complete, a self-loop must survive
// as data even though it has no ribbon, and duplicate node ids must merge (and say they merged)
// instead of double-counting a column.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sankeyLayout, orchestrationLayout, linksFromSequences, findCycles,
  ORCH_LAYERS, DEFAULT_NODE_CAP, DEFAULT_LINK_CAP,
} from '../../src/lib/sankey.js'

const L = (source, target, value) => ({ source, target, value })

// ---------------------------------------------------------------------------
// linksFromSequences
// ---------------------------------------------------------------------------

test('a flat string array is ONE sequence, not many one-element sequences', () => {
  const r = linksFromSequences(['Read', 'Edit', 'Bash'])
  assert.equal(r.sequences, 1)
  assert.equal(r.transitions, 2)
  assert.deepEqual(r.links.map(l => `${l.source}>${l.target}`).sort(), ['Edit>Bash', 'Read>Edit'])
})

test('repeated transitions are counted, not deduplicated', () => {
  const r = linksFromSequences([['Read', 'Edit'], ['Read', 'Edit'], ['Read', 'Bash']])
  const re = r.links.find(l => l.source === 'Read' && l.target === 'Edit')
  assert.equal(re.value, 2)
  assert.equal(r.sequences, 3)
})

test('malformed input never throws and the drops are counted', () => {
  const r = linksFromSequences([null, ['Read', null, undefined, 'Edit'], 'nope'])
  assert.equal(typeof r.dropped, 'number')
  assert.ok(r.dropped >= 2)
  assert.deepEqual(linksFromSequences(null).links, [])
  assert.deepEqual(linksFromSequences(undefined).links, [])
  assert.deepEqual(linksFromSequences(42).links, [])
})

test('tool names containing spaces do not collide into one ribbon', () => {
  // "Read Edit"→"Foo" and "Read"→"Edit Foo" would be the same key under a space separator.
  const r = linksFromSequences([['Read Edit', 'Foo'], ['Read', 'Edit Foo']])
  assert.equal(r.links.length, 2)
})

// ---------------------------------------------------------------------------
// self-loops
// ---------------------------------------------------------------------------

test('a self-loop survives as reported data even though it has no ribbon', () => {
  const out = sankeyLayout([L('Bash', 'Bash', 7), L('Bash', 'Read', 2)])
  assert.equal(out.selfLoops.length, 1)
  assert.deepEqual(out.selfLoops[0], { node: 'Bash', value: 7 })
  assert.match(out.selfLoopNote, /self-transition/)
  // and it is not drawn as a link (a zero-width ribbon would be invisible or NaN)
  assert.equal(out.links.filter(l => l.source === l.target).length, 0)
  // the node carries it, so a renderer can badge it
  const bash = out.nodes.find(n => n.id === 'Bash')
  assert.equal(bash.selfValue, 7)
  assert.equal(bash.selfLoop, true)
})

test('a graph that is ONLY a self-loop still lays out and still reports the loop', () => {
  const out = sankeyLayout([L('Bash', 'Bash', 3)])
  assert.equal(out.links.length, 0)
  assert.equal(out.nodes.length, 1)
  assert.equal(out.selfLoops[0].value, 3)
  assert.equal(out.bounds.layerCapped, false, 'a self-loop must not drive the layering to its ceiling')
})

test('no geometry is NaN anywhere', () => {
  const out = sankeyLayout([L('A', 'A', 5), L('A', 'B', 1), L('B', 'A', 1), L('B', 'C', 0.5)])
  for (const n of out.nodes) for (const k of ['x0', 'x1', 'y0', 'y1']) assert.ok(Number.isFinite(n[k]), `${n.id}.${k}`)
  for (const l of out.links) {
    assert.ok(Number.isFinite(l.y0) && Number.isFinite(l.y1) && Number.isFinite(l.width))
    assert.ok(!/NaN/.test(l.path), l.path)
  }
})

// ---------------------------------------------------------------------------
// duplicate nodes
// ---------------------------------------------------------------------------

test('duplicate node ids merge into one box and the merge is reported', () => {
  const out = sankeyLayout([L('Read', 'Edit', 3)], { nodes: [{ id: 'Read' }, { id: 'Read', name: 'Read (again)' }, { id: 'Edit' }] })
  assert.equal(out.nodes.filter(n => n.id === 'Read').length, 1)
  assert.equal(out.mergedNodes, 1, 'the merge must be reported, not silent')
})

test('duplicate links are summed and the merge is reported', () => {
  const out = sankeyLayout([L('Read', 'Edit', 2), L('Read', 'Edit', 5)])
  assert.equal(out.links.length, 1)
  assert.equal(out.links[0].value, 7)
  assert.equal(out.mergedLinks, 1)
})

// ---------------------------------------------------------------------------
// cycles
// ---------------------------------------------------------------------------

test('findCycles detects a back edge in a 3-cycle', () => {
  const links = [L('A', 'B', 1), L('B', 'C', 1), L('C', 'A', 1)]
  const r = findCycles(links, new Set(['A', 'B', 'C']))
  assert.equal(r.hasCycle, true)
  assert.equal(r.backEdges.length, 1)
})

test('a cycle is REPORTED, not silently dropped, and the back edge is still drawn', () => {
  const out = sankeyLayout([L('Read', 'Edit', 5), L('Edit', 'Read', 4)])
  assert.equal(out.cycles.detected, true)
  assert.equal(out.cycles.count, 1)
  assert.match(out.cycles.note, /cycle/)
  // WHICH of the two edges is called the back edge depends on DFS entry order and is not a promise
  // this layout makes; that exactly one of them is named, and that both are still drawn, is.
  assert.equal(out.cycles.backEdges.length, 1)
  assert.ok(['Read>Edit', 'Edit>Read'].includes(`${out.cycles.backEdges[0].source}>${out.cycles.backEdges[0].target}`))
  assert.ok(out.cycles.paths[0].length >= 2, 'the cycle path is reported so a reader can see the loop')
  // both directions are still rendered — dropping one would misstate the sequence
  assert.equal(out.links.length, 2)
  assert.equal(out.links.filter(l => l.backEdge).length, 1)
  assert.equal(out.bounds.linksHidden, 0, 'a cycle must not be laundered as a truncation')
})

test('an acyclic graph says so explicitly', () => {
  const out = sankeyLayout([L('A', 'B', 1), L('B', 'C', 1)])
  assert.equal(out.cycles.detected, false)
  assert.equal(out.cycles.note, 'no cycles')
})

test('layering terminates on a cyclic graph and does not hit the layer ceiling', () => {
  const links = []
  for (let i = 0; i < 30; i++) links.push(L('n' + i, 'n' + ((i + 1) % 30), 1))
  const out = sankeyLayout(links, { nodeCap: 40, linkCap: 60 })
  assert.equal(out.cycles.detected, true)
  assert.equal(out.bounds.layerCapped, false)
  assert.ok(out.nodes.every(n => n.layer < 64))
})

// ---------------------------------------------------------------------------
// caps — the "showing 20 of 47" contract
// ---------------------------------------------------------------------------

test('truncation is reported in words and in numbers', () => {
  const links = []
  for (let i = 0; i < 47; i++) links.push(L('t' + i, 't' + (i + 1), 47 - i))
  const out = sankeyLayout(links, { nodeCap: 20, linkCap: 60 })
  assert.equal(out.bounds.nodesTotal, 48)
  assert.equal(out.bounds.nodesShown, 20)
  assert.equal(out.bounds.truncated, true)
  assert.match(out.bounds.note, /showing 20 of 48 tools/)
  assert.ok(out.bounds.hiddenNodeNames.length > 0, 'the reader must be able to see WHICH tools were cut')
})

test('links dropped because their endpoint was capped are counted separately', () => {
  const links = [L('A', 'B', 10), L('A', 'C', 9), L('A', 'D', 8)]
  const out = sankeyLayout(links, { nodeCap: 2 })
  assert.ok(out.bounds.linksCutByNodeCap >= 1)
  assert.equal(out.bounds.linksCutByNodeCap + out.bounds.linksCutByLinkCap, out.bounds.linksHidden)
  assert.equal(out.bounds.truncated, true)
})

test('an untruncated diagram says "showing all" rather than staying silent', () => {
  const out = sankeyLayout([L('A', 'B', 1)])
  assert.equal(out.bounds.truncated, false)
  assert.match(out.bounds.note, /showing all 2 tools and 1 flows/)
})

test('the default caps are the documented ones', () => {
  assert.equal(DEFAULT_NODE_CAP, 20)
  assert.equal(DEFAULT_LINK_CAP, 60)
  const links = []
  for (let i = 0; i < 30; i++) links.push(L('a' + i, 'b' + i, 1))
  const out = sankeyLayout(links)
  assert.equal(out.bounds.nodeCap, 20)
  assert.equal(out.bounds.nodesShown, 20)
})

// ---------------------------------------------------------------------------
// malformed input never throws
// ---------------------------------------------------------------------------

test('malformed input yields an explained empty layout instead of throwing', () => {
  for (const bad of [null, undefined, 42, 'x', {}, [null, 1, 'x'], [{ source: 'A' }], [{ source: 'A', target: 'B', value: -1 }]]) {
    const out = sankeyLayout(bad)
    assert.ok(Array.isArray(out.nodes) && Array.isArray(out.links))
    assert.ok(out.bounds && typeof out.bounds.note === 'string')
  }
  const out = sankeyLayout([{ source: 'A' }, { source: 'A', target: 'B', value: 0 }, 'junk'])
  assert.ok(out.reasons.length >= 3, 'every skipped input needs a stated reason')
  assert.ok(out.reasons.every(r => typeof r.reason === 'string'))
})

test('a link with no value is flagged rather than quietly weighted 1', () => {
  const out = sankeyLayout([{ source: 'A', target: 'B' }])
  assert.ok(out.reasons.some(r => r.reason === 'link-value-missing-assumed-1'))
})

test('bad opts are tolerated', () => {
  assert.ok(sankeyLayout([L('A', 'B', 1)], null).nodes.length === 2)
  assert.ok(sankeyLayout([L('A', 'B', 1)], { width: NaN, height: 'tall', nodeCap: -5 }).nodes.length >= 1)
})

// ---------------------------------------------------------------------------
// orchestration DAG
// ---------------------------------------------------------------------------

const rec = o => ({ session: 's1', agent: 'planner', subagent: 'explore', tool: 'Read', outcome: 'ok', ...o })

test('the orchestration layout has the five named layers in order', () => {
  assert.deepEqual(ORCH_LAYERS, ['session', 'agent', 'subagent', 'tool', 'outcome'])
  const out = orchestrationLayout([rec()])
  assert.equal(out.nodes.length, 5)
  assert.deepEqual(out.nodes.map(n => n.layer), ORCH_LAYERS)
  assert.equal(out.edges.length, 4)
  assert.ok(out.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)))
})

test('a missing stage is reported as unknown and never back-filled with a plausible node', () => {
  const out = orchestrationLayout([rec({ subagent: null }), rec({ subagent: undefined })])
  assert.equal(out.unknownByLayer.subagent, 2)
  assert.match(out.unknownNote, /had no subagent/)
  assert.equal(out.nodes.filter(n => n.layer === 'subagent').length, 0, 'no invented "main" node')
  // the chain is bridged across the gap, and the bridge says so
  const bridged = out.edges.filter(e => e.bridged)
  assert.ok(bridged.length >= 1)
})

test('per-layer caps are reported per layer', () => {
  const rows = []
  for (let i = 0; i < 12; i++) rows.push(rec({ tool: 'tool' + i }))
  const out = orchestrationLayout(rows, { perLayerCap: 4 })
  assert.equal(out.bounds.byLayer.tool.total, 12)
  assert.equal(out.bounds.byLayer.tool.shown, 4)
  assert.equal(out.bounds.byLayer.tool.hidden, 8)
  assert.equal(out.bounds.truncated, true)
  assert.match(out.bounds.note, /showing \d+ of \d+ nodes/)
})

test('orchestration values aggregate across records rather than duplicating nodes', () => {
  const out = orchestrationLayout([rec(), rec(), rec()])
  assert.equal(out.nodes.filter(n => n.layer === 'session').length, 1)
  assert.equal(out.nodes.find(n => n.layer === 'session').value, 3)
})

test('orchestration never throws on malformed input and counts what it skipped', () => {
  for (const bad of [null, undefined, 'x', 7, [null, 3, 'nope'], [{}]]) {
    const out = orchestrationLayout(bad)
    assert.ok(Array.isArray(out.nodes))
    assert.ok(typeof out.bounds.note === 'string')
  }
  const out = orchestrationLayout([null, {}, rec()])
  assert.equal(out.skippedRecords, 2)
})
