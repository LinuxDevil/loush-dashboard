
import YAML from 'yaml'

export const NODE_TYPES = ['process', 'service', 'store', 'decision', 'external', 'ui', 'queue']
export const EDGE_KINDS = ['calls', 'reads', 'writes', 'publishes', 'depends', 'sync', 'renders']
export const MAX_NODES = 60
export const MAX_EDGES = 120

const slug = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

function fencedBlocks(text) {
  const out = []
  for (const m of String(text).matchAll(/```[ \t]*([\w-]*)[ \t]*\r?\n([\s\S]*?)```/g)) out.push({ lang: (m[1] || '').toLowerCase(), body: m[2] })
  return out
}

const tryYaml = s => { try { const v = YAML.parse(s); return v && typeof v === 'object' ? v : null } catch { return null } }
const tryJson = s => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : null } catch { return null } }

/**
 * Extract a graph document from raw model output.
 * @returns {{doc: object|null, how: string, error: string|null}} `how` names which rung of the
 *   ladder succeeded, so the failure UX can say something specific and telemetry can show which
 *   rungs are actually load-bearing in practice.
 */
export function extractDoc(raw) {
  const text = typeof raw === 'string' ? raw : ''
  if (!text.trim()) return { doc: null, how: 'none', error: 'empty output' }

  const whole = tryYaml(text)
  if (whole && (whole.nodes || whole.edges)) return { doc: whole, how: 'whole', error: null }

  const blocks = fencedBlocks(text)
  const tagged = blocks.filter(b => b.lang === 'yaml' || b.lang === 'yml' || b.lang === 'json')
  for (const list of [tagged, blocks]) {
    for (let i = list.length - 1; i >= 0; i--) {
      const d = tryYaml(list[i].body) || tryJson(list[i].body)
      if (d && (d.nodes || d.edges)) return { doc: d, how: 'fence', error: null }
    }
  }

  const at = text.search(/^nodes:\s*$/m)
  if (at >= 0) {
    const d = tryYaml(text.slice(at))
    if (d && (d.nodes || d.edges)) return { doc: d, how: 'tail', error: null }
  }

  let error = 'no `nodes:` document found in the output'
  try { YAML.parse(text) } catch (e) { error = e.message.split('\n')[0] }
  return { doc: null, how: 'none', error }
}

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

/**
 * Normalize a raw document into a graph.
 * Never throws and never returns null: a partially-broken graph plus honest warnings beats an
 * exception, because the caller still has a markdown document worth showing.
 * @returns {{graph: {nodes: [], edges: []}, warnings: [{code: string, detail: string}]}}
 */
export function validateGraph(doc, { trustPositions = false } = {}) {
  const warnings = []
  const warn = (code, detail) => warnings.push({ code, detail })
  const rawNodes = Array.isArray(doc?.nodes) ? doc.nodes : []
  const rawEdges = Array.isArray(doc?.edges) ? doc.edges : []
  if (!Array.isArray(doc?.nodes)) warn('no-nodes', 'the document had no `nodes:` list')

  const nodes = []
  const seen = new Set()
  for (const n of rawNodes) {
    if (!n || typeof n !== 'object') { warn('bad-node', 'a node entry was not an object'); continue }
    const label = typeof n.label === 'string' ? n.label.trim() : (typeof n.data?.label === 'string' ? n.data.label.trim() : '')
    if (!label) { warn('bad-node', `node "${n.id || '(no id)'}" has no label`); continue }
    let id = slug(n.id) || slug(label)
    if (!id) { warn('bad-node', `node "${label}" produced no usable id`); continue }
    if (seen.has(id)) { warn('dup-id', `duplicate node id "${id}" — kept the first`); continue }
    seen.add(id)

    let type = String(n.type || '').toLowerCase().trim()
    if (!NODE_TYPES.includes(type)) {
      if (type) warn('type-coerced', `node "${id}" had unknown type "${type}" — treated as process`)
      type = 'process'
    }
    if (nodes.length >= MAX_NODES) { warn('truncated', `more than ${MAX_NODES} nodes — the rest were dropped`); break }

    const files = (Array.isArray(n.files) ? n.files : []).map(f => {
      const rel = typeof f === 'string' ? f : f?.rel
      const change = (typeof f === 'object' && f?.change === 'modify') ? 'modify' : (typeof f === 'object' && f?.change === 'create') ? 'create' : null
      return rel ? { rel: String(rel).trim().replace(/^\.\//, ''), change } : null
    }).filter(Boolean)

    const pos = n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y) ? { x: n.position.x, y: n.position.y } : null
    if (!trustPositions && (n.position || n.x != null || n.y != null)) warn('position-rejected', `node "${id}" supplied coordinates — layout is computed, not authored`)

    nodes.push({
      id, type,
      position: trustPositions ? pos : null,
      data: { label, note: typeof n.note === 'string' ? n.note.trim() : '', files, origin: 'generated' },
    })
  }

  const byId = new Set(nodes.map(n => n.id))
  const edges = []
  const edgeSeen = new Set()
  for (const e of rawEdges) {
    if (!e || typeof e !== 'object') { warn('bad-edge', 'an edge entry was not an object'); continue }
    const source = slug(e.source ?? e.from), target = slug(e.target ?? e.to)
    if (!byId.has(source) || !byId.has(target)) {
      warn('edge-dropped', `edge ${e.source ?? e.from} → ${e.target ?? e.to} references a component that does not exist`)
      continue
    }
    if (source === target) { warn('edge-dropped', `edge on "${source}" points at itself`); continue }
    const id = `e:${source}>${target}`
    if (edgeSeen.has(id)) { warn('dup-edge', `duplicate edge ${source} → ${target} — kept the first`); continue }
    edgeSeen.add(id)
    if (edges.length >= MAX_EDGES) { warn('truncated', `more than ${MAX_EDGES} edges — the rest were dropped`); break }
    let kind = String(e.kind || '').toLowerCase().trim()
    if (!EDGE_KINDS.includes(kind)) kind = 'depends'
    edges.push({
      id, source, target,
      label: typeof e.label === 'string' ? e.label.trim() : '',
      data: { kind, origin: 'generated', isStatic: false, evidence: typeof e.evidence === 'string' ? e.evidence.trim() : '' },
    })
  }

  return { graph: { nodes, edges }, warnings }
}

/**
 * Extract an op list from a chat reply.
 * Deliberately lenient about ABSENCE and strict about SHAPE: "no ops" is the correct and common
 * answer to a question, so a reply with no fenced block returns `[]` rather than an error. A reply
 * whose ops are malformed returns only the well-formed ones — applyOps then reports the rest.
 */
export function parseOps(raw) {
  const text = typeof raw === 'string' ? raw : ''
  if (!text.trim()) return []
  let doc = null
  const blocks = fencedBlocks(text)
  for (let i = blocks.length - 1; i >= 0 && !doc; i--) {
    const d = tryYaml(blocks[i].body) || tryJson(blocks[i].body)
    if (d && Array.isArray(d.ops)) doc = d
    else if (Array.isArray(d) && d.some(x => x && x.op)) doc = { ops: d }
  }
  if (!doc) {
    const at = text.search(/^ops:\s*$/m)
    if (at >= 0) { const d = tryYaml(text.slice(at)); if (d && Array.isArray(d.ops)) doc = d }
  }
  if (!doc) return []
  const OPS = new Set(['add-node', 'remove-node', 'rename-node', 'set-note', 'add-edge', 'remove-edge'])
  return doc.ops.filter(o => o && typeof o === 'object' && OPS.has(o.op)).slice(0, 40)
}

export function parseGraph(raw) {
  const { doc, how, error } = extractDoc(raw)
  if (!doc) return { graph: { nodes: [], edges: [] }, warnings: [{ code: 'parse-failed', detail: error }], how, error }
  const { graph, warnings } = validateGraph(doc)
  return { graph, warnings, how, error: null }
}

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

/**
 * Merge a freshly-generated graph over the existing one, keyed by semantic slug id.
 * Positions and user-authored labels survive; the report drives the "kept N · added M · dropped K"
 * preview the user approves. Nothing is applied silently.
 */
export function mergeGraph(oldGraph, newGraph) {
  const oldNodes = new Map((oldGraph?.nodes || []).map(n => [n.id, n]))
  const kept = [], added = [], dropped = []

  const nodes = (newGraph?.nodes || []).map(n => {
    const prev = oldNodes.get(n.id)
    if (!prev) { added.push(n.id); return n }
    kept.push(n.id)
    return {
      ...n,
      position: prev.position ?? null,
      data: {
        ...n.data,
        label: prev.data?.origin === 'user' ? prev.data.label : n.data.label,
        note: prev.data?.note && prev.data.origin === 'user' ? prev.data.note : n.data.note,
        origin: prev.data?.origin === 'user' ? 'user' : n.data.origin,
        ...(prev.data?.origin === 'user' && prev.data.label !== n.data.label ? { regeneratedLabel: n.data.label } : {}),
      },
    }
  })

  const newIds = new Set(nodes.map(n => n.id))
  for (const id of oldNodes.keys()) if (!newIds.has(id)) dropped.push(id)

  for (const [id, n] of oldNodes) {
    if (!newIds.has(id) && n.data?.origin === 'user') {
      nodes.push(n)
      newIds.add(id)
      dropped.splice(dropped.indexOf(id), 1)
      kept.push(id)
    }
  }

  const finalIds = new Set(nodes.map(n => n.id))
  const edges = (newGraph?.edges || []).filter(e => finalIds.has(e.source) && finalIds.has(e.target))
  for (const e of oldGraph?.edges || []) {
    if (e.data?.origin === 'user' && finalIds.has(e.source) && finalIds.has(e.target) && !edges.some(x => x.id === e.id)) edges.push(e)
  }

  return { graph: { nodes, edges }, report: { kept: kept.length, added: added.length, dropped: dropped.length, addedIds: added, droppedIds: dropped } }
}

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

const COLW = 240, ROWH = 120, PAD = 24

/**
 * Assign coordinates to any node whose `position` is null. Existing positions are never moved —
 * a regeneration must not rearrange a diagram the user has already arranged.
 *
 * Layer = longest-path depth over the edge DAG (cycles broken by first-seen order, since a design
 * graph legitimately contains cycles and a layout must not hang on one). Within a layer, nodes are
 * ordered by the mean position of their predecessors — one barycentre pass, which is the cheap part
 * of Sugiyama and removes most crossings on graphs this size.
 */
export function layout(graph) {
  const nodes = graph?.nodes || []
  const edges = graph?.edges || []
  if (!nodes.length) return graph

  const idx = new Map(nodes.map((n, i) => [n.id, i]))
  const preds = new Map(nodes.map(n => [n.id, []]))
  const succs = new Map(nodes.map(n => [n.id, []]))
  for (const e of edges) {
    if (!preds.has(e.target) || !succs.has(e.source)) continue
    preds.get(e.target).push(e.source)
    succs.get(e.source).push(e.target)
  }

  const depth = new Map()
  const computing = new Set()
  const depthOf = id => {
    if (depth.has(id)) return depth.get(id)
    if (computing.has(id)) return 0
    computing.add(id)
    const p = preds.get(id) || []
    const d = p.length ? Math.max(...p.map(x => depthOf(x) + 1)) : 0
    computing.delete(id)
    depth.set(id, d)
    return d
  }
  for (const n of nodes) depthOf(n.id)

  const byDepth = new Map()
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0
    if (!byDepth.has(d)) byDepth.set(d, [])
    byDepth.get(d).push(n)
  }
  const layers = [...byDepth.keys()].sort((a, b) => a - b).map(d => byDepth.get(d))

  const order = new Map()
  layers.forEach((layer, li) => {
    if (li > 0) {
      layer.sort((a, b) => {
        const bary = n => {
          const p = (preds.get(n.id) || []).map(x => order.get(x)).filter(v => v != null)
          return p.length ? p.reduce((s, v) => s + v, 0) / p.length : idx.get(n.id)
        }
        return bary(a) - bary(b) || idx.get(a.id) - idx.get(b.id)
      })
    }
    layer.forEach((n, i) => order.set(n.id, i))
  })

  const tallest = Math.max(1, ...layers.map(l => l.length))
  layers.forEach((layer, li) => {
    const offset = (tallest - layer.length) / 2
    layer.forEach((n, i) => {
      if (n.position) return
      n.position = { x: PAD + li * COLW, y: Math.round(PAD + (offset + i) * ROWH) }
    })
  })
  return graph
}

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

/**
 * Apply an ordered op list to a graph. Returns the new graph plus a per-op result, so a partially
 * valid proposal applies the valid parts and reports the rest instead of failing whole.
 * Ops: {op:'add-node'|'remove-node'|'rename-node'|'add-edge'|'remove-edge'|'set-note', …}
 */
export function applyOps(graph, ops) {
  const g = { nodes: (graph?.nodes || []).map(n => ({ ...n, data: { ...n.data } })), edges: (graph?.edges || []).map(e => ({ ...e, data: { ...e.data } })) }
  const results = []
  const find = id => g.nodes.find(n => n.id === id)

  for (const raw of Array.isArray(ops) ? ops : []) {
    const op = raw?.op
    try {
      if (op === 'add-node') {
        const id = slug(raw.id) || slug(raw.label)
        if (!id || !raw.label) throw new Error('add-node needs a label')
        if (find(id)) throw new Error(`"${id}" already exists`)
        const type = NODE_TYPES.includes(raw.type) ? raw.type : 'process'
        g.nodes.push({ id, type, position: null, data: { label: String(raw.label), note: '', files: [], origin: 'assistant' } })
        results.push({ op, id, ok: true })
      } else if (op === 'remove-node') {
        const id = slug(raw.id)
        if (!find(id)) throw new Error(`"${id}" does not exist`)
        g.nodes = g.nodes.filter(n => n.id !== id)
        g.edges = g.edges.filter(e => e.source !== id && e.target !== id)
        results.push({ op, id, ok: true })
      } else if (op === 'rename-node') {
        const n = find(slug(raw.id))
        if (!n) throw new Error(`"${raw.id}" does not exist`)
        if (!raw.label) throw new Error('rename-node needs a label')
        n.data.label = String(raw.label)
        n.data.origin = 'assistant'
        results.push({ op, id: n.id, ok: true })
      } else if (op === 'set-note') {
        const n = find(slug(raw.id))
        if (!n) throw new Error(`"${raw.id}" does not exist`)
        n.data.note = String(raw.note ?? '')
        results.push({ op, id: n.id, ok: true })
      } else if (op === 'add-edge') {
        const source = slug(raw.source), target = slug(raw.target)
        if (!find(source) || !find(target)) throw new Error(`edge ${raw.source} → ${raw.target} references a component that does not exist`)
        const id = `e:${source}>${target}`
        if (g.edges.some(e => e.id === id)) throw new Error('that edge already exists')
        g.edges.push({ id, source, target, label: String(raw.label || ''), data: { kind: EDGE_KINDS.includes(raw.kind) ? raw.kind : 'depends', origin: 'assistant', isStatic: false, evidence: '' } })
        results.push({ op, id, ok: true })
      } else if (op === 'remove-edge') {
        const id = raw.id || `e:${slug(raw.source)}>${slug(raw.target)}`
        if (!g.edges.some(e => e.id === id)) throw new Error('that edge does not exist')
        g.edges = g.edges.filter(e => e.id !== id)
        results.push({ op, id, ok: true })
      } else {
        throw new Error(`unknown op "${op}"`)
      }
    } catch (e) {
      results.push({ op: op || '(none)', ok: false, error: e.message })
    }
  }
  return { graph: g, results }
}

export function toMermaid(graph) {
  const SHAPE = {
    process: ['[', ']'], service: ['([', '])'], store: ['[(', ')]'], decision: ['{', '}'],
    external: ['[/', '/]'], ui: ['[[', ']]'], queue: ['>', ']'],
  }
  const esc = s => String(s || '').replace(/"/g, "'").replace(/[\r\n]+/g, ' ')
  const lines = ['flowchart LR']
  for (const n of graph?.nodes || []) {
    const [o, c] = SHAPE[n.type] || SHAPE.process
    lines.push(`  ${n.id}${o}"${esc(n.data?.label)}"${c}`)
  }
  for (const e of graph?.edges || []) {
    const arrow = e.data?.isStatic === false ? '-.->' : '-->'
    lines.push(e.label ? `  ${e.source} ${arrow}|"${esc(e.label)}"| ${e.target}` : `  ${e.source} ${arrow} ${e.target}`)
  }
  return lines.join('\n')
}
