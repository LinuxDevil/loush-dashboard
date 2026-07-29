import { planLayout } from '../lib/plan.js'

export const W = 176, H = 64
export const LABEL_MAX_W = 360
const MIN_GAP_X = 72
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

export const LABEL_H = 16

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

const overlaps = (cx, cy, w, o) =>
  Math.abs(cx - (o.x + o.w / 2)) < (w + o.w) / 2 && Math.abs(cy - (o.y + o.h / 2)) < (LABEL_H + o.h) / 2

export const nodeBox = pos => ({ x: pos.x, y: pos.y, w: W, h: H })
export const labelBox = (spot, w) => ({ x: spot.x - w / 2, y: spot.y - LABEL_H / 2, w, h: LABEL_H })

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
  for (let step = 0; step <= 16; step++) {
    for (const t of step === 0 ? [0.5] : [0.5 - step * 0.02, 0.5 + step * 0.02]) {
      const p = bezierPoint(a, b, t)
      for (const dy of NUDGES) {
        if (!obstacles.some(o => overlaps(p.x, p.y + dy, width, o))) return { x: p.x, y: p.y + dy }
      }
    }
  }
  return bezierPoint(a, b, 0.5)
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

  // ponytail: ONE pass, left to right, no reverse sweep — that is the cheap 80% of crossing
  const rowOf = new Map()
  for (const d of [...columns.keys()].sort((a, b) => a - b)) {
    const col = columns.get(d)
    const bary = n => {
      const parents = edges.filter(e => e.target === n.id && rowOf.has(e.source)).map(e => rowOf.get(e.source))
      return parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : Infinity
    }
    const keyed = col.map((n, i) => ({ n, i, b: bary(n) }))
    keyed.sort((a, b) => (a.b - b.b) || (a.i - b.i))
    columns.set(d, keyed.map(k => k.n))
    keyed.forEach((k, row) => rowOf.set(k.n.id, row))
  }

  const gapNeeded = new Map()
  for (const e of edges) {
    if (!e.label) continue
    const sd = depth.get(e.source), td = depth.get(e.target)
    if (sd === undefined || td === undefined || td - sd !== 1) continue
    gapNeeded.set(sd, Math.max(gapNeeded.get(sd) || 0, labelWidth(e.label) + 24))
  }

  const xOf = new Map()
  let cursor = 0
  for (const d of [...columns.keys()].sort((a, b) => a - b)) {
    xOf.set(d, cursor)
    cursor += W + Math.max(MIN_GAP_X, gapNeeded.get(d) || 0)
  }

  const tallest = Math.max(...[...columns.values()].map(c => c.length))
  const pos = new Map()
  for (const [d, col] of columns) {
    const offset = ((tallest - col.length) / 2) * (H + GAP_Y)
    col.forEach((n, row) => pos.set(n.id, { x: xOf.get(d), y: Math.round(offset + row * (H + GAP_Y)) }))
  }

  return nodes.map(n => ({ ...n, position: pos.get(n.id) }))
}
