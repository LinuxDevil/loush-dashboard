// Layered auto-layout for the ticket design graph — the "Tidy" button.
//
// A generated graph arrives with whatever positions the model guessed, which is usually a pile. The
// layout that suits THIS canvas is left-to-right layered: edges are drawn from a node's right edge
// to the next node's left edge (see DesignCanvas), so depth must map to x, or every edge doubles
// back on itself and the picture reads as noise regardless of how good the graph is.
//
// Node geometry lives here rather than in DesignCanvas because a layout that does not know the node
// size cannot avoid overlapping them — and this module must stay free of React and d3 so the layout
// is testable on its own.
import { planLayout } from '../lib/plan.js'

export const W = 176, H = 64
// Also the cap DesignCanvas renders with — one source of truth, or the gap computed here stops
// matching the box actually drawn. Generous on purpose: these labels say what moves along a
// connection ("recomputes buffer minutes from the selected flight"), and a truncated one is the
// single most useless thing on the canvas. Widening a column is the cheaper price.
export const LABEL_MAX_W = 360
const MIN_GAP_X = 72
// Rows must clear a card AND leave room for the label boxes that end up between them; at 28 the
// labels of two adjacent rows were landing on each other.
const GAP_Y = 44

/**
 * Width the edge label box will occupy, in px. The canvas draws it at 10px monospace with 5px of
 * padding and a 1px border each side; monospace advance is ~0.6em, which is what makes estimating
 * this from the string length honest rather than a guess.
 */
export function labelWidth(label) {
  if (!label) return 0
  return Math.min(LABEL_MAX_W, Math.ceil(label.length * 6) + 12)
}

export const LABEL_H = 16   // 10px line + 1px padding + 1px border, top and bottom

/**
 * A point on the edge curve at `t`. DesignCanvas draws each edge as a cubic bezier whose control
 * points share the span's horizontal midpoint, so the label has to follow the same curve or it
 * detaches from the line it belongs to.
 */
export function bezierPoint(a, b, t) {
  const mx = (a.x + b.x) / 2
  const u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t
  return { x: w0 * a.x + w1 * mx + w2 * mx + w3 * b.x, y: w0 * a.y + w1 * a.y + w2 * b.y + w3 * b.y }
}

/** Axis-aligned overlap of a label box centred at (cx,cy) against an obstacle {x,y,w,h}. */
const overlaps = (cx, cy, w, o) =>
  Math.abs(cx - (o.x + o.w / 2)) < (w + o.w) / 2 && Math.abs(cy - (o.y + o.h / 2)) < (LABEL_H + o.h) / 2

/** Obstacle rect for a node card at `pos`. */
export const nodeBox = pos => ({ x: pos.x, y: pos.y, w: W, h: H })
/** Obstacle rect for a label box already placed, given its CENTRE. */
export const labelBox = (spot, w) => ({ x: spot.x - w / 2, y: spot.y - LABEL_H / 2, w, h: LABEL_H })

// Vertical nudges tried at each point along the curve, nearest first. A small vertical step is far
// less disruptive than sliding a long way down the edge — the label stays beside the line it
// belongs to — so these are exhausted before the search moves along `t`.
const NUDGES = [0, -19, 19, -38, 38, -57, 57]

/**
 * Where to draw an edge's label: the midpoint of the curve, moved only as much as it takes to clear
 * everything already on the canvas.
 *
 * Obstacles are BOTH node cards and labels already placed. Label-vs-label is the one that actually
 * matters on a real graph: a dense middle column produces a dozen edges whose midpoints are all
 * within a few pixels of each other, and avoiding only the cards leaves them stacked into an
 * unreadable pile. Node avoidance additionally matters because cards are draggable.
 *
 * @param obstacles {x, y, w, h} rects — build them with nodeBox()/labelBox().
 * @returns {{x, y}} the CENTRE of the label box.
 */
export function placeEdgeLabel(a, b, width, obstacles) {
  // Outward from the middle in small steps, so a label that must move moves as little as possible.
  // The step is fine (and the sweep stops at ±0.32) because a coarse one overshoots by tens of
  // pixels, and a label that has drifted near an endpoint reads as belonging to that node.
  for (let step = 0; step <= 16; step++) {
    for (const t of step === 0 ? [0.5] : [0.5 - step * 0.02, 0.5 + step * 0.02]) {
      const p = bezierPoint(a, b, t)
      for (const dy of NUDGES) {
        if (!obstacles.some(o => overlaps(p.x, p.y + dy, width, o))) return { x: p.x, y: p.y + dy }
      }
    }
  }
  return bezierPoint(a, b, 0.5)   // nowhere clear — the midpoint is still the honest place for it
}

/**
 * Place every labelled edge's label, each avoiding the cards and the labels placed before it.
 * Sequential and in edge order, so the result is deterministic — a label that jumped around between
 * renders would be worse than one that overlaps.
 *
 * @param edges  [{id, label, a, b}] with a/b the endpoints the edge is drawn between
 * @returns Map<edgeId, {x, y}> centre points
 */
export function placeEdgeLabels(edges, nodePositions) {
  const obstacles = nodePositions.map(nodeBox)
  const out = new Map()
  for (const e of edges) {
    if (!e.label) continue
    const w = labelWidth(e.label)
    const spot = placeEdgeLabel(e.a, e.b, w, obstacles)
    obstacles.push(labelBox(spot, w))
    out.set(e.id, spot)
  }
  return out
}

/**
 * Compute tidy positions for every node. Pure: returns a NEW nodes array, same order as the input,
 * with `position` replaced. Never mutates, never drops a node.
 *
 * Layering reuses planLayout's longest-path walk, which already survives dependency cycles — a
 * design graph is user-editable and absolutely can contain one, and a layout that infinite-loops on
 * a cycle would be a hang with no error.
 */
export function tidyPositions(graph) {
  const nodes = graph?.nodes || [], edges = graph?.edges || []
  if (!nodes.length) return []

  const ids = new Set(nodes.map(n => n.id))
  // planLayout speaks {step_id, dependencies} — a node depends on whatever points AT it, so an
  // edge source→target means target sits one layer to the right of source.
  const steps = nodes.map(n => ({
    step_id: n.id,
    dependencies: edges.filter(e => e.target === n.id && ids.has(e.source)).map(e => e.source),
  }))
  const { depth } = planLayout(steps)

  const columns = new Map()
  for (const n of nodes) {
    const d = depth.get(n.id) || 0
    if (!columns.has(d)) columns.set(d, [])
    columns.get(d).push(n)
  }

  // Order each column by the mean row of its parents in the column before it (a barycentre pass).
  // ponytail: ONE pass, left to right, no reverse sweep — that is the cheap 80% of crossing
  // reduction. If dense graphs still look tangled, iterate sweeps rather than reaching for a
  // layout library.
  const rowOf = new Map()
  for (const d of [...columns.keys()].sort((a, b) => a - b)) {
    const col = columns.get(d)
    const bary = n => {
      const parents = edges.filter(e => e.target === n.id && rowOf.has(e.source)).map(e => rowOf.get(e.source))
      return parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : Infinity
    }
    // Infinity keeps parentless nodes below the connected ones instead of scattering them through
    // the column; the original order breaks ties so a tidy of an already-tidy graph is stable.
    const keyed = col.map((n, i) => ({ n, i, b: bary(n) }))
    keyed.sort((a, b) => (a.b - b.b) || (a.i - b.i))
    columns.set(d, keyed.map(k => k.n))
    keyed.forEach((k, row) => rowOf.set(k.n.id, row))
  }

  // The gap between two columns has to fit the label boxes drawn across it, or the labels sit on
  // top of the node cards — the boxes are centred on the edge midpoint, so a 260px label straddling
  // a 72px gap overhangs ~94px into BOTH columns.
  //
  // Sized PER ADJACENT PAIR, not once for the whole graph: one verbose label should widen the gap it
  // is drawn in, not every gap in the diagram.
  //
  // Only single-column hops are counted. An edge spanning several columns has its label placed by
  // the canvas, which nudges it clear of whatever it would have covered — reserving graph-wide
  // width for it here would stretch the layout to fix something already handled at draw time.
  const gapNeeded = new Map()
  for (const e of edges) {
    if (!e.label) continue
    const sd = depth.get(e.source), td = depth.get(e.target)
    if (sd === undefined || td === undefined || td - sd !== 1) continue
    gapNeeded.set(sd, Math.max(gapNeeded.get(sd) || 0, labelWidth(e.label) + 24))
  }

  // x accumulates across columns rather than being `d * pitch`, because the pitch now varies.
  const xOf = new Map()
  let cursor = 0
  for (const d of [...columns.keys()].sort((a, b) => a - b)) {
    xOf.set(d, cursor)
    cursor += W + Math.max(MIN_GAP_X, gapNeeded.get(d) || 0)
  }

  // Centre every column against the tallest one, so a 1-node column lands beside the middle of a
  // 6-node column rather than at its top.
  const tallest = Math.max(...[...columns.values()].map(c => c.length))
  const pos = new Map()
  for (const [d, col] of columns) {
    const offset = ((tallest - col.length) / 2) * (H + GAP_Y)
    col.forEach((n, row) => pos.set(n.id, { x: xOf.get(d), y: Math.round(offset + row * (H + GAP_Y)) }))
  }

  return nodes.map(n => ({ ...n, position: pos.get(n.id) }))
}
