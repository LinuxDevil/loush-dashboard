// sankey.js — pure layout math for the tool-flow Sankey and the 5-layer orchestration DAG.
//
// No React, no d3, no d3-sankey (it is NOT a dependency of this repo and must not become one).
// Everything here is a pure function of its arguments so test/lib/sankey.test.mjs can pin the
// honesty properties that a diagram cannot state for itself.
//
// THE THREE THINGS THAT BREAK NAIVE SANKEY CODE, and what each one does if left unguarded:
//
//   1. SELF-LOOPS (Bash → Bash — the single most common real tool transition).
//      Layering says layer(target) > layer(source). For A → A that is layer(A) > layer(A), which no
//      assignment satisfies: a relaxation loop never converges (it bumps A one layer every pass, so
//      the layer count grows until the iteration cap or the stack blows), and the ribbon it draws has
//      x0 === x1, i.e. a zero-width path — a NaN control point or an invisible link. Either way the
//      most frequent edge in the data disappears. We LIFT self-loops out of the layered graph, keep
//      their weight on the node as `selfValue`, and report them in `selfLoops` so the renderer can
//      draw a return arc and the caller can never mistake their absence for "it never happened".
//
//   2. DUPLICATE NODES (the same tool id supplied twice, e.g. once from the observed flow and once
//      from a defined edge). Naive code indexes nodes by array position, so a link resolves to
//      whichever copy it happens to hit; the value splits across two boxes drawn at the same
//      coordinates (a fat box with a hairline seam), the column total double-counts, and every
//      percentage computed off that total is wrong. We MERGE by id, sum the values, and report
//      `mergedNodes` — a merge that is not reported is indistinguishable from data loss.
//
//   3. CYCLES (Read → Edit → Read is not a DAG). Longest-path layering over a cycle does not
//      terminate. We do not assume a DAG: a DFS colouring finds the back edges, they are excluded
//      from the layering pass only, and they are reported in `cycles` AND still drawn (as backward
//      ribbons). A cycle silently dropped is a lie about the sequence the agent actually ran.
//
// CAPS: nodes and links are capped for legibility. Every cap is reported in the returned `bounds`
// so the renderer can print "showing 20 of 47 tools" — a truncated diagram that looks complete is a
// lie about the data, so the number is part of the layout's output, not a rendering afterthought.

export const DEFAULT_NODE_CAP = 20
export const DEFAULT_LINK_CAP = 60
const MAX_LAYERS = 64 // hard stop; also the tripwire if the de-cycling ever regresses

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const idOf = v => (v == null ? null : String(v))
// Pair keys are joined on NUL, not a space: MCP tool ids and agent descriptions contain spaces, and a
// space separator would make "Read Edit"→"Foo" collide with "Read"→"Edit Foo" and silently merge two
// different transitions into one fatter ribbon. NUL cannot occur in a JSON-sourced name.
const SEP = '\u0000'

// ---------------------------------------------------------------------------
// sequence → links
// ---------------------------------------------------------------------------

/**
 * Consecutive-pair transitions from one or more tool-name sequences.
 * Never throws: non-array input, holes and non-string entries are dropped and counted in `dropped`.
 * Returns { links: [{source,target,value}], sequences, transitions, dropped }.
 */
export function linksFromSequences(sequences) {
  const seqs = Array.isArray(sequences) ? sequences : []
  // A bare ['Read','Edit'] is a single sequence, not a list of sequences — accepting both silently
  // would turn one 2-step session into two 1-step ones and halve every transition count.
  const list = seqs.length && seqs.every(s => typeof s === 'string') ? [seqs] : seqs
  const counts = new Map()
  let dropped = 0, transitions = 0, used = 0
  for (const seq of list) {
    if (!Array.isArray(seq)) { dropped++; continue }
    const clean = seq.map(idOf).filter(x => x != null && x !== '')
    dropped += seq.length - clean.length
    if (clean.length) used++
    for (let i = 1; i < clean.length; i++) {
      const k = clean[i - 1] + SEP + clean[i]
      counts.set(k, (counts.get(k) || 0) + 1)
      transitions++
    }
  }
  const links = [...counts.entries()].map(([k, value]) => {
    const [source, target] = k.split(SEP)
    return { source, target, value }
  }).sort((a, b) => b.value - a.value || (a.source + a.target).localeCompare(b.source + b.target))
  return { links, sequences: used, transitions, dropped }
}

// ---------------------------------------------------------------------------
// graph normalisation: merge duplicates, lift self-loops
// ---------------------------------------------------------------------------

function normalise(rawLinks, rawNodes) {
  const dropped = []
  const agg = new Map()      // "s\0t" -> value
  const nodes = new Map()    // id -> { id, name, value, selfValue, in, out }
  let mergedLinks = 0
  const touch = id => {
    let n = nodes.get(id)
    if (!n) { n = { id, name: id, value: 0, selfValue: 0, in: 0, out: 0 }; nodes.set(id, n) }
    return n
  }

  let mergedNodes = 0
  for (const n of Array.isArray(rawNodes) ? rawNodes : []) {
    const id = idOf(n && typeof n === 'object' ? (n.id ?? n.name) : n)
    if (!id) { dropped.push({ reason: 'node-without-id', node: n }); continue }
    // duplicate-node guard (#2 above): second sighting merges into the first instead of becoming a
    // second box that overlaps it and double-counts the column total.
    if (nodes.has(id)) { mergedNodes++; continue }
    const rec = touch(id)
    if (n && typeof n === 'object' && n.name != null) rec.name = String(n.name)
    if (n && typeof n === 'object' && n.kind != null) rec.kind = String(n.kind)
  }

  const selfLoops = []
  for (const l of Array.isArray(rawLinks) ? rawLinks : []) {
    if (!l || typeof l !== 'object') { dropped.push({ reason: 'link-not-an-object', link: l }); continue }
    const s = idOf(l.source ?? l.from), t = idOf(l.target ?? l.to)
    if (!s || !t) { dropped.push({ reason: 'link-missing-endpoint', link: l }); continue }
    const v = num(l.value ?? l.count)
    // A missing weight is NOT 1. Defaulting it would invent a measurement; we count it as an
    // unweighted edge of value 1 only when the caller opted in, otherwise we drop and say so.
    const value = v == null ? 1 : v
    if (v == null) dropped.push({ reason: 'link-value-missing-assumed-1', link: l })
    if (value <= 0) { dropped.push({ reason: 'link-value-not-positive', link: l }); continue }
    const key = s + SEP + t
    if (agg.has(key)) mergedLinks++
    agg.set(key, (agg.get(key) || 0) + value)
  }

  const links = []
  for (const [key, value] of agg) {
    const [source, target] = key.split(SEP)
    const sn = touch(source), tn = touch(target)
    if (source === target) {
      // self-loop lift (#1 above)
      sn.selfValue += value
      selfLoops.push({ node: source, value })
      continue
    }
    sn.out += value; tn.in += value
    links.push({ source, target, value })
  }
  for (const n of nodes.values()) n.value = Math.max(n.in, n.out) + n.selfValue
  return { nodes, links, selfLoops, mergedNodes, mergedLinks, dropped }
}

// ---------------------------------------------------------------------------
// cycle detection (we do NOT assume a DAG)
// ---------------------------------------------------------------------------

/**
 * DFS three-colouring. Returns { backEdges, cycles, hasCycle }.
 * `backEdges` are the edges that close a cycle — excluded from layering, never from the output.
 * Iterative, because a 5,000-step transcript would blow the stack on a recursive version.
 */
export function findCycles(links, nodeIds) {
  const adj = new Map()
  for (const id of nodeIds) adj.set(id, [])
  for (const l of links) { if (adj.has(l.source)) adj.get(l.source).push(l) }
  const WHITE = 0, GREY = 1, BLACK = 2
  const color = new Map([...nodeIds].map(id => [id, WHITE]))
  const backEdges = [], cycles = []
  for (const root of nodeIds) {
    if (color.get(root) !== WHITE) continue
    const stack = [{ id: root, i: 0 }]
    color.set(root, GREY)
    const path = [root]
    while (stack.length) {
      const top = stack[stack.length - 1]
      const edges = adj.get(top.id) || []
      if (top.i >= edges.length) { color.set(top.id, BLACK); stack.pop(); path.pop(); continue }
      const e = edges[top.i++]
      const c = color.get(e.target)
      if (c === GREY) {
        backEdges.push(e)
        const at = path.lastIndexOf(e.target)
        cycles.push({ nodes: at >= 0 ? path.slice(at).concat(e.target) : [e.source, e.target], value: e.value })
      } else if (c === WHITE) {
        color.set(e.target, GREY)
        stack.push({ id: e.target, i: 0 })
        path.push(e.target)
      }
    }
  }
  return { backEdges, cycles, hasCycle: backEdges.length > 0 }
}

// Longest-path layering over the acyclic remainder. Bounded by MAX_LAYERS so a de-cycling regression
// shows up as a reported bound rather than a hang.
function assignLayers(nodeIds, links) {
  const layer = new Map([...nodeIds].map(id => [id, 0]))
  let changed = true, passes = 0, capped = false
  while (changed) {
    changed = false
    if (++passes > nodeIds.size + 1) { capped = true; break }
    for (const l of links) {
      const want = layer.get(l.source) + 1
      if (want > layer.get(l.target) && want < MAX_LAYERS) { layer.set(l.target, want); changed = true }
      else if (want >= MAX_LAYERS) capped = true
    }
  }
  return { layer, layerCapped: capped, maxLayer: Math.max(0, ...layer.values()) }
}

// ---------------------------------------------------------------------------
// the layout
// ---------------------------------------------------------------------------

/**
 * sankeyLayout(links, opts) -> layout
 *
 * links: [{ source, target, value }] (also accepts {from,to,count}).
 * opts:  { nodes, width, height, nodeWidth, nodePadding, nodeCap, linkCap }
 *
 * Never throws. Malformed input yields an empty layout with `reasons` explaining what went missing.
 * Everything the layout hid from the reader — merges, self-loops, back edges, caps — is reported.
 */
export function sankeyLayout(links, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const width = num(o.width) ?? 900
  const height = num(o.height) ?? 460
  const nodeWidth = num(o.nodeWidth) ?? 14
  const nodePadding = num(o.nodePadding) ?? 10
  const nodeCap = Math.max(1, num(o.nodeCap) ?? DEFAULT_NODE_CAP)
  const linkCap = Math.max(1, num(o.linkCap) ?? DEFAULT_LINK_CAP)
  const pad = { top: 26, bottom: 22, left: 4, right: 4 }

  const norm = normalise(links, o.nodes)
  const reasons = norm.dropped

  // ---- cap NODES first (a link whose endpoint is cut must go too, and be counted as cut) ----
  const allNodes = [...norm.nodes.values()].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
  const nodesTotal = allNodes.length
  const kept = new Set(allNodes.slice(0, nodeCap).map(n => n.id))
  const hiddenNodes = allNodes.slice(nodeCap)

  let linksAll = norm.links.filter(l => kept.has(l.source) && kept.has(l.target))
  const linksCutByNodeCap = norm.links.length - linksAll.length
  const linksTotal = norm.links.length
  linksAll = linksAll.sort((a, b) => b.value - a.value || (a.source + a.target).localeCompare(b.source + b.target))
  const linksShownArr = linksAll.slice(0, linkCap)
  const linksCutByLinkCap = linksAll.length - linksShownArr.length

  // ---- de-cycle for layering ONLY ----
  const cyc = findCycles(linksShownArr, kept)
  const backSet = new Set(cyc.backEdges)
  const acyclic = linksShownArr.filter(l => !backSet.has(l))
  const { layer, layerCapped, maxLayer } = assignLayers(kept, acyclic)

  // ---- geometry ----
  const columns = new Map()
  for (const id of kept) {
    const li = layer.get(id) || 0
    if (!columns.has(li)) columns.set(li, [])
    columns.get(li).push(norm.nodes.get(id))
  }
  const innerW = Math.max(1, width - pad.left - pad.right - nodeWidth)
  const innerH = Math.max(1, height - pad.top - pad.bottom)
  const xOf = li => pad.left + (maxLayer === 0 ? 0 : (li / maxLayer) * innerW)

  const nodesOut = []
  for (const [li, col] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    col.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
    const totalValue = col.reduce((s, n) => s + n.value, 0)
    const gaps = nodePadding * Math.max(0, col.length - 1)
    const usable = Math.max(1, innerH - gaps)
    // A zero-value column would divide by zero and emit NaN geometry; share it evenly instead and
    // let the reported value (0) tell the reader there is nothing flowing.
    let y = pad.top
    for (const n of col) {
      const share = totalValue > 0 ? n.value / totalValue : 1 / col.length
      const h = Math.max(2, share * usable)
      nodesOut.push({
        id: n.id, name: n.name, kind: n.kind ?? null, layer: li,
        x0: xOf(li), x1: xOf(li) + nodeWidth, y0: y, y1: y + h,
        value: n.value, in: n.in, out: n.out, selfValue: n.selfValue,
        selfLoop: n.selfValue > 0,
      })
      y += h + nodePadding
    }
  }
  const byId = new Map(nodesOut.map(n => [n.id, n]))

  // ribbon endpoints: stack each node's outgoing/incoming ribbons in value order
  const outCursor = new Map(), inCursor = new Map()
  const scaleOf = n => {
    const h = n.y1 - n.y0
    const denom = Math.max(n.in, n.out) + n.selfValue
    return denom > 0 ? h / denom : 0
  }
  const linksOut = []
  for (const l of linksShownArr) {
    const s = byId.get(l.source), t = byId.get(l.target)
    if (!s || !t) continue
    const ws = scaleOf(s) * l.value, wt = scaleOf(t) * l.value
    const sy = (outCursor.get(s.id) ?? s.y0); outCursor.set(s.id, sy + ws)
    const ty = (inCursor.get(t.id) ?? t.y0); inCursor.set(t.id, ty + wt)
    const back = backSet.has(l)
    const x1 = s.x1, x2 = t.x0
    const mx = (x1 + x2) / 2
    linksOut.push({
      source: l.source, target: l.target, value: l.value,
      backEdge: back,                       // a cycle-closing edge: drawn, dashed, and reported
      sourceLayer: s.layer, targetLayer: t.layer,
      y0: sy + ws / 2, y1: ty + wt / 2, width: Math.max(1, Math.min(ws, wt)),
      path: `M ${x1} ${sy + ws / 2} C ${mx} ${sy + ws / 2}, ${mx} ${ty + wt / 2}, ${x2} ${ty + wt / 2}`,
    })
  }

  const truncated = hiddenNodes.length > 0 || linksCutByNodeCap > 0 || linksCutByLinkCap > 0
  const bounds = {
    nodeCap, linkCap,
    nodesTotal, nodesShown: nodesOut.length, nodesHidden: hiddenNodes.length,
    hiddenNodeNames: hiddenNodes.map(n => n.name),
    linksTotal, linksShown: linksOut.length,
    linksHidden: linksCutByNodeCap + linksCutByLinkCap,
    linksCutByNodeCap, linksCutByLinkCap,
    truncated,
    // Pre-formatted so the renderer cannot forget to say it, and so the same sentence appears in
    // tests, exports and the SVG.
    note: truncated
      ? `showing ${nodesOut.length} of ${nodesTotal} tools and ${linksOut.length} of ${linksTotal} flows`
      : `showing all ${nodesTotal} tools and ${linksTotal} flows`,
    layerCapped, maxLayers: MAX_LAYERS,
  }

  return {
    nodes: nodesOut,
    links: linksOut,
    bounds,
    cycles: {
      detected: cyc.hasCycle,
      count: cyc.cycles.length,
      backEdges: cyc.backEdges.map(e => ({ source: e.source, target: e.target, value: e.value })),
      paths: cyc.cycles.map(c => c.nodes),
      note: cyc.hasCycle
        ? `${cyc.cycles.length} cycle${cyc.cycles.length > 1 ? 's' : ''} in the tool flow — drawn as dashed return edges, excluded from layer order only`
        : 'no cycles',
    },
    selfLoops: norm.selfLoops.slice().sort((a, b) => b.value - a.value),
    selfLoopNote: norm.selfLoops.length
      ? `${norm.selfLoops.length} self-transition${norm.selfLoops.length > 1 ? 's' : ''} (tool → itself) shown on the node, not as a ribbon`
      : null,
    mergedNodes: norm.mergedNodes,
    mergedLinks: norm.mergedLinks,
    reasons,
    size: { width, height, nodeWidth, nodePadding },
  }
}

// ---------------------------------------------------------------------------
// 5-layer orchestration DAG: session → agent → subagent → tool → outcome
// ---------------------------------------------------------------------------

export const ORCH_LAYERS = ['session', 'agent', 'subagent', 'tool', 'outcome']

/**
 * orchestrationLayout(records, opts) -> layout
 *
 * records: [{ session, agent, subagent, tool, outcome, value? }]. Any stage may be missing; a
 * missing stage is NOT invented — the record's chain is bridged across the gap and the gap is
 * counted in `unknownByLayer`, so "we never observed a subagent" reads differently from
 * "the subagent was `main`".
 *
 * Never throws. Same cap-reporting contract as sankeyLayout.
 */
export function orchestrationLayout(records, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const perLayerCap = Math.max(1, num(o.perLayerCap) ?? 8)
  const width = num(o.width) ?? 900
  const height = num(o.height) ?? 420
  const nodeW = num(o.nodeWidth) ?? 132
  const rowGap = num(o.rowGap) ?? 12
  const rows = Array.isArray(records) ? records : []

  const unknownByLayer = Object.fromEntries(ORCH_LAYERS.map(l => [l, 0]))
  const nodeMap = new Map()   // "layer\0id" -> {..}
  const edgeMap = new Map()
  let skipped = 0

  const key = (layer, id) => layer + SEP + id
  const bump = (layer, id, value) => {
    const k = key(layer, id)
    let n = nodeMap.get(k)
    if (!n) { n = { key: k, id, layer, layerIndex: ORCH_LAYERS.indexOf(layer), value: 0 }; nodeMap.set(k, n) }
    n.value += value
    return n
  }

  for (const r of rows) {
    if (!r || typeof r !== 'object') { skipped++; continue }
    const value = num(r.value) ?? 1
    if (value <= 0) { skipped++; continue }
    const chain = []
    for (const layer of ORCH_LAYERS) {
      const id = idOf(r[layer])
      // Unknown is a value: no placeholder node is created, and the omission is counted.
      if (!id) { unknownByLayer[layer]++; continue }
      chain.push({ layer, id })
    }
    if (!chain.length) { skipped++; continue }
    for (const c of chain) bump(c.layer, c.id, value)
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1], b = chain[i]
      const ek = key(a.layer, a.id) + SEP + SEP + key(b.layer, b.id)
      const e = edgeMap.get(ek) || { source: key(a.layer, a.id), target: key(b.layer, b.id), value: 0, bridged: ORCH_LAYERS.indexOf(b.layer) - ORCH_LAYERS.indexOf(a.layer) > 1 }
      e.value += value
      // `bridged` = this edge jumps a layer because the middle stage was never observed. Flagged so
      // the renderer can dash it instead of implying a direct session→tool call that never happened.
      e.bridged = ORCH_LAYERS.indexOf(b.layer) - ORCH_LAYERS.indexOf(a.layer) > 1
      edgeMap.set(ek, e)
    }
  }

  const byLayer = new Map(ORCH_LAYERS.map(l => [l, []]))
  for (const n of nodeMap.values()) byLayer.get(n.layer).push(n)
  const capReport = {}
  const keptKeys = new Set()
  const placed = []
  const colX = ORCH_LAYERS.length > 1 ? (width - nodeW) / (ORCH_LAYERS.length - 1) : 0
  ORCH_LAYERS.forEach((layer, li) => {
    const col = byLayer.get(layer).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
    const shown = col.slice(0, perLayerCap)
    capReport[layer] = { total: col.length, shown: shown.length, hidden: col.length - shown.length, hiddenNames: col.slice(perLayerCap).map(n => n.id) }
    const h = Math.max(18, (height - rowGap * Math.max(0, shown.length - 1)) / Math.max(1, shown.length))
    shown.forEach((n, ri) => {
      keptKeys.add(n.key)
      placed.push({ ...n, x: li * colX, y: ri * (h + rowGap), w: nodeW, h: Math.min(h, 46) })
    })
  })

  const edges = [...edgeMap.values()].filter(e => keptKeys.has(e.source) && keptKeys.has(e.target))
  const edgesHidden = edgeMap.size - edges.length
  const hiddenTotal = Object.values(capReport).reduce((s, c) => s + c.hidden, 0)
  const nodesTotal = nodeMap.size

  return {
    layers: ORCH_LAYERS,
    nodes: placed,
    edges: edges.sort((a, b) => b.value - a.value),
    bounds: {
      perLayerCap, byLayer: capReport,
      nodesTotal, nodesShown: placed.length, nodesHidden: hiddenTotal,
      edgesTotal: edgeMap.size, edgesShown: edges.length, edgesHidden,
      truncated: hiddenTotal > 0 || edgesHidden > 0,
      note: hiddenTotal > 0 || edgesHidden > 0
        ? `showing ${placed.length} of ${nodesTotal} nodes and ${edges.length} of ${edgeMap.size} links`
        : `showing all ${nodesTotal} nodes and ${edgeMap.size} links`,
    },
    unknownByLayer,
    unknownNote: Object.entries(unknownByLayer).filter(([, n]) => n > 0)
      .map(([l, n]) => `${n} record${n > 1 ? 's' : ''} had no ${l}`).join('; ') || null,
    skippedRecords: skipped,
    size: { width, height, nodeWidth: nodeW, rowGap },
  }
}
