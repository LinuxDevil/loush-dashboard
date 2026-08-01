import React, { useMemo, useState } from 'react'
import { sankeyLayout, orchestrationLayout, linksFromSequences, ORCH_LAYERS, DEFAULT_NODE_CAP, DEFAULT_LINK_CAP } from '../lib/sankey.js'

// FlowDiagram.jsx — SVG renderer for the tool-flow Sankey and the 5-layer orchestration DAG.
// All arithmetic lives in ../lib/sankey.js so it can be unit-tested; this file only draws.
//
// Everything the layout had to hide is printed ON the diagram, not buried in a tooltip:
//   * the node/link cap        → "showing 20 of 47 tools and 60 of 210 flows"
//   * cycles                   → a banner plus dashed return ribbons
//   * self-loops (Bash → Bash) → a ↻ badge with its count on the node
//   * merged duplicate ids     → a banner
//   * unknown stages in the DAG → "3 records had no subagent" (never a fabricated "main" node)
// A diagram that looks complete while showing a subset is a lie about the data, so none of these
// notices are optional and none of them are hover-only.

const MONO = 'var(--mono)'
const HEAD = 'var(--head)'
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 12 }
const DIM = 'var(--text-secondary)'
const FAINT = 'var(--text-tertiary)'

const tipStyle = { position: 'fixed', zIndex: 2147483647, padding: '7px 10px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-md)', pointerEvents: 'none', font: `500 11px ${MONO}`, color: 'var(--text-primary)', maxWidth: 320 }

const LAYER_COLOR = { session: 'var(--violet)', agent: 'var(--blue)', subagent: 'var(--accent)', tool: 'var(--green)', outcome: 'var(--amber)' }
const hue = i => ['var(--blue)', 'var(--green)', 'var(--accent)', 'var(--violet)', 'var(--amber)'][i % 5]

function Notice({ tone = 'info', children }) {
  const col = tone === 'warn' ? 'var(--amber)' : tone === 'bad' ? 'var(--red)' : 'var(--blue)'
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'baseline', padding: '5px 9px', borderRadius: 7, background: `${col}12`, border: `1px solid ${col}30`, font: `500 11px ${MONO}`, color: 'var(--text-primary)' }}>
      <span style={{ color: col, flexShrink: 0 }}>{tone === 'warn' ? '▲' : tone === 'bad' ? '✕' : 'ℹ'}</span>
      <span>{children}</span>
    </div>
  )
}

/** The always-rendered honesty header. Never conditional on `truncated` — "showing all 12 of 12"
 *  is itself information, and a banner that only appears sometimes teaches readers to stop looking. */
function BoundsBar({ bounds, extra = [] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 9 }}>
      <Notice tone={bounds.truncated ? 'warn' : 'info'}>
        {bounds.note}
        {bounds.truncated && bounds.hiddenNodeNames?.length ? <span style={{ color: DIM }}> · hidden: {bounds.hiddenNodeNames.slice(0, 6).join(', ')}{bounds.hiddenNodeNames.length > 6 ? ` +${bounds.hiddenNodeNames.length - 6}` : ''}</span> : null}
      </Notice>
      {extra.filter(Boolean).map((e, i) => <Notice key={i} tone={e.tone}>{e.text}</Notice>)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tool-flow Sankey
// ---------------------------------------------------------------------------

/**
 * <ToolFlowSankey links=[{source,target,value}] | sequences=[[toolName,…]] />
 * Either input works; `sequences` is turned into links by the same pure helper the tests use.
 */
export function ToolFlowSankey({ links, sequences, nodes, nodeCap = DEFAULT_NODE_CAP, linkCap = DEFAULT_LINK_CAP, width = 900, height = 460, onPickNode }) {
  const [hov, setHov] = useState(null)
  const derived = useMemo(() => (links ? { links, dropped: 0, transitions: null } : linksFromSequences(sequences)), [links, sequences])
  const L = useMemo(() => sankeyLayout(derived.links, { nodes, nodeCap, linkCap, width, height }), [derived.links, nodes, nodeCap, linkCap, width, height])

  const extra = [
    L.cycles.detected && { tone: 'warn', text: `${L.cycles.note} — ${L.cycles.backEdges.slice(0, 4).map(e => `${e.source}→${e.target}`).join(', ')}${L.cycles.backEdges.length > 4 ? ` +${L.cycles.backEdges.length - 4}` : ''}` },
    L.selfLoopNote && { tone: 'info', text: `${L.selfLoopNote} — ${L.selfLoops.slice(0, 4).map(s => `${s.node} ↻${s.value}`).join(', ')}` },
    L.mergedNodes > 0 && { tone: 'info', text: `${L.mergedNodes} duplicate node id${L.mergedNodes > 1 ? 's were' : ' was'} merged (same tool supplied twice)` },
    L.mergedLinks > 0 && { tone: 'info', text: `${L.mergedLinks} duplicate edge${L.mergedLinks > 1 ? 's were' : ' was'} summed` },
    derived.dropped > 0 && { tone: 'warn', text: `${derived.dropped} unusable entr${derived.dropped > 1 ? 'ies were' : 'y was'} dropped from the input` },
    L.reasons.length > 0 && { tone: 'warn', text: `${L.reasons.length} malformed link${L.reasons.length > 1 ? 's' : ''} skipped: ${[...new Set(L.reasons.map(r => r.reason))].join(', ')}` },
    L.bounds.layerCapped && { tone: 'bad', text: `layer count hit the ${L.bounds.maxLayers}-layer ceiling — depth beyond that is not drawn` },
  ]

  if (!L.nodes.length) {
    return (
      <div style={PANEL}>
        <BoundsBar bounds={L.bounds} extra={extra} />
        <div style={{ padding: 20, textAlign: 'center', font: `400 12px ${MONO}`, color: FAINT }}>No tool transitions to draw.</div>
      </div>
    )
  }

  return (
    <div style={{ ...PANEL, position: 'relative' }}>
      <BoundsBar bounds={L.bounds} extra={extra} />
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto', display: 'block' }}>
        <g>
          {L.links.map((l, i) => (
            <path key={i} d={l.path} fill="none"
              strokeWidth={Math.max(1, l.width)} strokeOpacity={hov && hov.node && hov.node !== l.source && hov.node !== l.target ? 0.08 : 0.3}
              strokeDasharray={l.backEdge ? '6 5' : undefined}
              style={{ stroke: l.backEdge ? 'var(--amber)' : 'var(--blue)' }}
              onMouseEnter={e => setHov({ x: e.clientX, y: e.clientY, txt: `${l.source} → ${l.target}: ${l.value}${l.backEdge ? ' · cycle-closing edge (drawn dashed, excluded from layer order only)' : ''}` })}
              onMouseLeave={() => setHov(null)} />
          ))}
        </g>
        {L.nodes.map((n, i) => (
          <g key={n.id} onMouseEnter={e => setHov({ x: e.clientX, y: e.clientY, node: n.id, txt: `${n.name} · in ${n.in} · out ${n.out}${n.selfValue ? ` · ↻ ${n.selfValue} self` : ''}` })}
            onMouseLeave={() => setHov(null)} onClick={() => onPickNode?.(n)} style={{ cursor: onPickNode ? 'pointer' : 'default' }}>
            <rect x={n.x0} y={n.y0} width={n.x1 - n.x0} height={Math.max(2, n.y1 - n.y0)} rx="2" style={{ fill: hue(n.layer) }} />
            {/* self-loop badge: the edge exists in the data but has no ribbon, so the node has to say so */}
            {n.selfLoop && <text x={n.x1 + 4} y={n.y0 + 10} style={{ font: `700 9px ${MONO}`, fill: 'var(--amber)' }}>↻{n.selfValue}</text>}
            <text x={n.x1 + 5} y={(n.y0 + n.y1) / 2 + 3} style={{ font: `500 10px ${MONO}`, fill: 'var(--text-primary)' }}>{n.name}</text>
            <text x={n.x1 + 5} y={(n.y0 + n.y1) / 2 + 14} style={{ font: `400 9px ${MONO}`, fill: FAINT }}>{n.value}</text>
          </g>
        ))}
        {[...new Set(L.nodes.map(n => n.layer))].sort((a, b) => a - b).map(li => {
          const x = L.nodes.find(n => n.layer === li).x0
          return <text key={li} x={x} y={14} style={{ font: `600 9px ${MONO}`, fill: FAINT }}>step {li + 1}</text>
        })}
      </svg>
      {hov && <div style={{ ...tipStyle, left: Math.min(hov.x + 12, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 330), top: hov.y - 46 }}>{hov.txt}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 5-layer orchestration DAG
// ---------------------------------------------------------------------------

/** <OrchestrationDAG records=[{session,agent,subagent,tool,outcome,value}] /> */
export function OrchestrationDAG({ records, perLayerCap = 8, width = 900, height = 420, onPickNode }) {
  const [hov, setHov] = useState(null)
  const L = useMemo(() => orchestrationLayout(records, { perLayerCap, width, height }), [records, perLayerCap, width, height])
  const byKey = useMemo(() => new Map(L.nodes.map(n => [n.key, n])), [L])

  const extra = [
    // Unknown is a value: a missing stage is stated, never back-filled with a plausible "main" node.
    L.unknownNote && { tone: 'warn', text: `${L.unknownNote} — those stages are absent from the diagram, not defaulted` },
    L.edges.some(e => e.bridged) && { tone: 'info', text: 'dashed links skip a layer that was never observed for those records' },
    L.skippedRecords > 0 && { tone: 'warn', text: `${L.skippedRecords} record${L.skippedRecords > 1 ? 's were' : ' was'} unusable and skipped` },
  ]

  if (!L.nodes.length) {
    return <div style={PANEL}><BoundsBar bounds={L.bounds} extra={extra} /><div style={{ padding: 20, textAlign: 'center', font: `400 12px ${MONO}`, color: FAINT }}>No orchestration records.</div></div>
  }

  const svgH = Math.max(height, ...L.nodes.map(n => n.y + n.h)) + 26
  return (
    <div style={{ ...PANEL, position: 'relative' }}>
      <BoundsBar bounds={L.bounds} extra={extra} />
      <svg viewBox={`0 0 ${width} ${svgH}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto', display: 'block' }}>
        {ORCH_LAYERS.map((layer, li) => {
          const any = L.nodes.find(n => n.layer === layer)
          const cap = L.bounds.byLayer[layer]
          const x = any ? any.x : (li * (width - 132)) / (ORCH_LAYERS.length - 1)
          return (
            <g key={layer}>
              <text x={x} y={12} style={{ font: `600 9px ${MONO}`, fill: LAYER_COLOR[layer] }}>{layer.toUpperCase()}</text>
              {/* per-layer cap printed per column, so a column that hides 30 of 38 cannot pass for complete */}
              <text x={x} y={22} style={{ font: `400 9px ${MONO}`, fill: FAINT }}>{cap.shown} of {cap.total}</text>
            </g>
          )
        })}
        <g transform="translate(0,28)">
          {L.edges.map((e, i) => {
            const a = byKey.get(e.source), b = byKey.get(e.target)
            if (!a || !b) return null
            const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2
            return <path key={i} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none"
              strokeWidth={Math.min(6, 1 + Math.log2(1 + e.value))} strokeOpacity="0.4"
              strokeDasharray={e.bridged ? '5 4' : undefined}
              style={{ stroke: e.bridged ? 'var(--amber)' : 'var(--border-default)' }}
              onMouseEnter={ev => setHov({ x: ev.clientX, y: ev.clientY, txt: `${a.id} → ${b.id}: ${e.value}${e.bridged ? ' (skips an unobserved layer)' : ''}` })}
              onMouseLeave={() => setHov(null)} />
          })}
          {L.nodes.map(n => (
            <g key={n.key} onClick={() => onPickNode?.(n)} style={{ cursor: onPickNode ? 'pointer' : 'default' }}
              onMouseEnter={e => setHov({ x: e.clientX, y: e.clientY, txt: `${n.layer}: ${n.id} · ${n.value}` })} onMouseLeave={() => setHov(null)}>
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="6" style={{ fill: 'var(--bg-surface-hover)', stroke: LAYER_COLOR[n.layer], strokeWidth: 1 }} />
              <text x={n.x + 8} y={n.y + n.h / 2 + 1} style={{ font: `500 10px ${MONO}`, fill: 'var(--text-primary)' }}>{String(n.id).slice(0, 16)}</text>
              <text x={n.x + 8} y={n.y + n.h / 2 + 12} style={{ font: `400 9px ${MONO}`, fill: FAINT }}>{n.value}</text>
            </g>
          ))}
        </g>
      </svg>
      {hov && <div style={{ ...tipStyle, left: Math.min(hov.x + 12, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 330), top: hov.y - 46 }}>{hov.txt}</div>}
    </div>
  )
}

/** Both diagrams with a heading, for dropping straight into a section. */
export default function FlowDiagram({ title = 'Tool flow', links, sequences, records, ...rest }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ font: `600 14px ${HEAD}`, color: 'var(--text-primary)' }}>{title} <span style={{ font: `400 11px ${MONO}`, color: DIM }}>observed tool-to-tool transitions</span></div>
      <ToolFlowSankey links={links} sequences={sequences} {...rest} />
      {records && <>
        <div style={{ font: `600 14px ${HEAD}`, color: 'var(--text-primary)' }}>Orchestration <span style={{ font: `400 11px ${MONO}`, color: DIM }}>session → agent → subagent → tool → outcome</span></div>
        <OrchestrationDAG records={records} {...rest} />
      </>}
    </div>
  )
}
