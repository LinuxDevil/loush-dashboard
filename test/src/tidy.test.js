// Tests for the design-graph auto-layout behind the "Tidy" button.
//
// The properties that matter: every node keeps a position, dependency order maps to x (or the
// canvas draws every edge doubling back), nothing overlaps, and a cycle does not hang — the graph
// is user-editable, so a cycle is a matter of time.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tidyPositions, labelWidth, placeEdgeLabel, placeEdgeLabels, bezierPoint, nodeBox, labelBox, W, H, LABEL_MAX_W, LABEL_H } from '../../src/ticket/tidy.js'

const g = (nodes, edges = []) => ({
  nodes: nodes.map(id => ({ id, position: { x: 0, y: 0 }, data: { label: id } })),
  edges: edges.map(([source, target, label]) => ({ id: `e:${source}>${target}`, source, target, label })),
})

/** The gap the canvas actually draws an edge across: source card's right edge to target's left. */
const gapBetween = (out, from, to) => {
  const by = Object.fromEntries(out.map(n => [n.id, n.position]))
  return by[to].x - (by[from].x + W)
}

test('a chain lays out strictly left to right', () => {
  const out = tidyPositions(g(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]))
  const x = Object.fromEntries(out.map(n => [n.id, n.position.x]))
  assert.ok(x.a < x.b && x.b < x.c, `expected a<b<c, got ${JSON.stringify(x)}`)
})

test('siblings share a column and do not overlap', () => {
  const out = tidyPositions(g(['root', 'x', 'y'], [['root', 'x'], ['root', 'y']]))
  const by = Object.fromEntries(out.map(n => [n.id, n.position]))
  assert.equal(by.x.x, by.y.x, 'siblings belong in the same column')
  assert.ok(Math.abs(by.x.y - by.y.y) >= H, 'sibling cards must not overlap vertically')
  assert.ok(by.x.x - by.root.x >= W, 'a child column must clear the parent card')
})

test('a cycle lays out instead of hanging', () => {
  // planLayout's cycle guard is the thing being leaned on; without it this never returns.
  const out = tidyPositions(g(['a', 'b'], [['a', 'b'], ['b', 'a']]))
  assert.equal(out.length, 2)
  for (const n of out) assert.ok(Number.isFinite(n.position.x) && Number.isFinite(n.position.y))
})

test('every node keeps a position, including disconnected ones', () => {
  const out = tidyPositions(g(['a', 'b', 'orphan'], [['a', 'b']]))
  assert.equal(out.length, 3)
  for (const n of out) assert.ok(n.position && Number.isFinite(n.position.x), `${n.id} lost its position`)
})

test('tidy is stable — running it twice changes nothing', () => {
  const once = tidyPositions(g(['a', 'b', 'c'], [['a', 'b'], ['a', 'c']]))
  const twice = tidyPositions({ nodes: once, edges: g([], [['a', 'b'], ['a', 'c']]).edges })
  assert.deepEqual(twice.map(n => n.position), once.map(n => n.position))
})

test('it does not mutate the input graph', () => {
  const input = g(['a', 'b'], [['a', 'b']])
  const before = JSON.stringify(input)
  tidyPositions(input)
  assert.equal(JSON.stringify(input), before, 'tidyPositions must be pure — undo relies on it')
})

test('an empty graph is not an error', () => {
  assert.deepEqual(tidyPositions({ nodes: [], edges: [] }), [])
  assert.deepEqual(tidyPositions(null), [])
})

test('the column gap fits the connection label box, so labels never sit on a card', () => {
  // The label is centred on the edge span, so it overhangs by half its width into each column
  // unless the gap is at least as wide as the box. This is what the fixed 72px gap got wrong.
  const label = 'recomputes buffer minutes from the selected flight'
  const out = tidyPositions(g(['a', 'b'], [['a', 'b', label]]))
  const gap = gapBetween(out, 'a', 'b')
  assert.ok(gap >= labelWidth(label), `gap ${gap} must fit the ${labelWidth(label)}px label box`)
})

test('the widest label sets the gap, and a capped label is still cleared', () => {
  const long = 'x'.repeat(400)   // wider than LABEL_MAX_W, so the box is capped and ellipsised
  const out = tidyPositions(g(['a', 'b'], [['a', 'b', long]]))
  assert.equal(labelWidth(long), LABEL_MAX_W, 'labelWidth must respect the render cap')
  assert.ok(gapBetween(out, 'a', 'b') >= LABEL_MAX_W)
})

test('a long label widens only the gap it is drawn in', () => {
  // a→b carries the long label; b→c carries none. The b..c gap must stay at the minimum.
  const long = 'recomputes buffer minutes from the selected departing flight'
  const out = tidyPositions(g(['a', 'b', 'c'], [['a', 'b', long], ['b', 'c']]))
  assert.ok(gapBetween(out, 'a', 'b') >= labelWidth(long), 'the labelled gap must fit its label')
  assert.equal(gapBetween(out, 'b', 'c'), 72, 'the unlabelled gap must not be widened by a distant label')
})

// ---- label placement ---------------------------------------------------------------------------

const rect = (x, y) => nodeBox({ x, y })
const hits = (p, w, o) =>
  Math.abs(p.x - (o.x + o.w / 2)) < (w + o.w) / 2 && Math.abs(p.y - (o.y + o.h / 2)) < (LABEL_H + o.h) / 2

test('with nothing in the way the label sits at the midpoint of the curve', () => {
  const a = { x: 0, y: 32 }, b = { x: 400, y: 32 }
  assert.deepEqual(placeEdgeLabel(a, b, 80, []), bezierPoint(a, b, 0.5))
})

test('a label slides along the curve rather than sitting on an intervening card', () => {
  // The exact case a multi-column edge produces: a card parked at the edge's midpoint.
  const a = { x: 0, y: 32 }, b = { x: 800, y: 32 }
  const mid = bezierPoint(a, b, 0.5)
  const blocker = rect(mid.x - W / 2, mid.y - H / 2)
  const spot = placeEdgeLabel(a, b, 100, [blocker])
  assert.ok(!hits(spot, 100, blocker), 'label must clear the card')
  assert.notDeepEqual(spot, mid)
})

test('a displaced label steps aside rather than sliding down the edge', () => {
  // Clearing a card sideways costs ~138px of travel; stepping over it costs 57. A label that has
  // slid a long way along its edge is harder to attribute to that edge than one nudged off it.
  const a = { x: 0, y: 32 }, b = { x: 800, y: 32 }
  const mid = bezierPoint(a, b, 0.5)
  const blocker = rect(mid.x - W / 2, mid.y - H / 2)
  const spot = placeEdgeLabel(a, b, 100, [blocker])

  assert.ok(!hits(spot, 100, blocker), 'label must clear the card')
  assert.equal(spot.x, mid.x, 'it should not have moved along the edge at all')
  assert.ok(Math.abs(spot.y - mid.y) <= 57, `nudged further than needed: ${spot.y - mid.y}px`)
})

test('a fully blocked edge still returns the midpoint instead of nothing', () => {
  const a = { x: 0, y: 32 }, b = { x: 300, y: 32 }
  // one obstacle swallowing every candidate — every t, every vertical nudge
  const wall = [{ x: -400, y: -400, w: 1200, h: 900 }]
  assert.deepEqual(placeEdgeLabel(a, b, 100, wall), bezierPoint(a, b, 0.5))
})

test('labels avoid each other, not just the cards', () => {
  // The real failure on a generated graph: a dense column gives many edges near-identical
  // midpoints, and avoiding only cards leaves every label stacked in one illegible pile.
  const edges = Array.from({ length: 6 }, (_, i) => ({
    id: `e${i}`, label: `connection number ${i}`,
    a: { x: 0, y: 100 }, b: { x: 600, y: 100 },   // deliberately identical spans
  }))
  const spots = placeEdgeLabels(edges, [])
  assert.equal(spots.size, 6)

  const boxes = edges.map(e => labelBox(spots.get(e.id), labelWidth(e.label)))
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [p, q] = [boxes[i], boxes[j]]
      const apart = Math.abs((p.x + p.w / 2) - (q.x + q.w / 2)) >= (p.w + q.w) / 2
        || Math.abs((p.y + p.h / 2) - (q.y + q.h / 2)) >= (p.h + q.h) / 2
      assert.ok(apart, `labels ${i} and ${j} overlap`)
    }
  }
})

test('label placement is deterministic', () => {
  // A label that moved between renders would be worse than one that overlaps.
  const edges = Array.from({ length: 5 }, (_, i) => ({
    id: `e${i}`, label: `edge ${i}`, a: { x: 0, y: 50 }, b: { x: 500, y: 50 },
  }))
  assert.deepEqual([...placeEdgeLabels(edges, [])], [...placeEdgeLabels(edges, [])])
})

test('unlabelled edges get no spot at all', () => {
  const spots = placeEdgeLabels([{ id: 'e0', label: '', a: { x: 0, y: 0 }, b: { x: 300, y: 0 } }], [])
  assert.equal(spots.size, 0)
})

test('bezierPoint at t=0.5 matches the span midpoint the path is drawn across', () => {
  const a = { x: 10, y: 20 }, b = { x: 210, y: 120 }
  assert.deepEqual(bezierPoint(a, b, 0.5), { x: 110, y: 70 })
  assert.deepEqual(bezierPoint(a, b, 0), { x: 10, y: 20 })
  assert.deepEqual(bezierPoint(a, b, 1), { x: 210, y: 120 })
})

test('unlabelled edges keep the layout compact', () => {
  // Sizing every gap for a label that is not drawn would spread a plain graph across the canvas.
  const out = tidyPositions(g(['a', 'b'], [['a', 'b']]))
  assert.equal(gapBetween(out, 'a', 'b'), 72, 'no labels means the minimum gap')
})

test('an edge pointing at a missing node does not break layering', () => {
  // Half-deleted state reaches this function via undo/redo, so a dangling edge must be survivable.
  const out = tidyPositions(g(['a', 'b'], [['ghost', 'a'], ['a', 'b']]))
  const x = Object.fromEntries(out.map(n => [n.id, n.position.x]))
  assert.ok(x.a < x.b)
})
