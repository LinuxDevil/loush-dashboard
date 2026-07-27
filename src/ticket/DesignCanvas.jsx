import React, { useEffect, useMemo, useRef, useState } from 'react'
import { select, zoom, zoomIdentity, drag } from 'd3'

// Editable design canvas — hand-rolled on the d3 that is ALREADY in this app's bundle.
//
// WHY NOT REACT FLOW
// It is MIT and genuinely good, and its own d3 deps (d3-zoom/d3-drag/d3-selection) are already
// vendored inside the `d3` package this repo imports wholesale — so the weight argument is weak.
// The blocking reason is theming: it ships a stylesheet carrying its own colour values, and
// src/styles.css:7 says outright "if you add a raw hex anywhere, you have broken the light theme".
// Owning ~500 lines beats owning an override sheet plus a prefers-reduced-motion override. The
// persisted schema uses React Flow's field names (id/position/data, source/target) so adopting it
// later is an adapter, not a migration. See docs/ticket-tab/references.md §5.
//
// Colour is NEVER the only channel: every node carries a shape, a glyph and its type printed as
// text, because seven hues are not distinguishable under deuteranopia.

const MONO = 'var(--mono)', HEAD = 'var(--head)'
const W = 176, H = 64

export const TYPES = {
  process:  { glyph: '▸', accent: 'var(--blue)',           tint: 'var(--blue-bg)' },
  service:  { glyph: '⬡', accent: 'var(--violet)',         tint: 'var(--violet-bg)' },
  store:    { glyph: '▤', accent: 'var(--green)',          tint: 'var(--green-bg)' },
  decision: { glyph: '◆', accent: 'var(--amber)',          tint: 'var(--amber-bg)' },
  external: { glyph: '↗', accent: 'var(--text-secondary)', tint: 'color-mix(in srgb, var(--text-secondary) 12%, transparent)' },
  ui:       { glyph: '▭', accent: 'var(--pink)',           tint: 'color-mix(in srgb, var(--pink) 15%, transparent)' },
  queue:    { glyph: '≡', accent: 'var(--orange)',         tint: 'var(--orange-bg)' },
}
const ORIGIN = { generated: '◇', user: '✎', assistant: '✦' }

/** Anchor on a node's border, so an edge meets the box instead of its centre. */
const anchor = (n, dx) => ({ x: (n.position?.x ?? 0) + (dx > 0 ? W : 0), y: (n.position?.y ?? 0) + H / 2 })

// Shape is drawn as an SVG background layer beneath the HTML card, so labels stay real text
// (selectable, translatable, and readable by a screen reader) while the silhouette still differs.
function Shape({ type, selected }) {
  const t = TYPES[type] || TYPES.process
  const stroke = selected ? 'var(--text-primary)' : 'var(--border-default)'
  // --bg-elevated, not --bg-surface: in the LIGHT theme --bg-surface and --bg-inset are both
  // #f6f8fa, so a node filled with --bg-surface on an --bg-inset canvas is 1.00:1 — the cylinder
  // and diamond silhouettes collapse to line art, losing the shape channel that carries type for a
  // colourblind reader. --bg-elevated is #ffffff light / #1c2128 dark, so a card reads as raised
  // in both themes.
  const common = { fill: 'var(--bg-elevated)', stroke, strokeWidth: 1.5 }
  if (type === 'store') {
    return (
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
        <path d={`M0 10 A ${W / 2} 10 0 0 1 ${W} 10 L ${W} ${H - 10} A ${W / 2} 10 0 0 1 0 ${H - 10} Z`} {...common} />
        <path d={`M0 10 A ${W / 2} 10 0 0 0 ${W} 10`} fill="none" stroke={stroke} strokeWidth="1" />
      </svg>
    )
  }
  if (type === 'decision') {
    return (
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
        <path d={`M${W / 2} 1 L ${W - 1} ${H / 2} L ${W / 2} ${H - 1} L 1 ${H / 2} Z`} {...common} />
      </svg>
    )
  }
  return (
    <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="6"
        fill="var(--bg-elevated)" stroke={stroke} strokeWidth="1.5" strokeDasharray={type === 'external' ? '4 3' : undefined} />
      {type === 'service' && <rect x="0.5" y="0.5" width="3" height={H - 1} fill={t.accent} />}
      {type === 'ui' && <rect x="0.5" y="0.5" width={W - 1} height="3" fill={t.accent} />}
      {type === 'queue' && [10, 18, 26].map(y => <rect key={y} x="4" y={y} width="2" height="12" fill={t.accent} />)}
    </svg>
  )
}

export default function DesignCanvas({ graph, selected, onSelect, onMove, onDelete, readOnly, focusId }) {
  const wrapRef = useRef(null)
  const gRef = useRef(null)
  const [tf, setTf] = useState(() => zoomIdentity)
  const [dragPos, setDragPos] = useState(null)   // {id: {x,y}} while dragging, before commit
  const nodes = graph?.nodes || []
  const edges = graph?.edges || []

  const posOf = n => (dragPos && dragPos[n.id]) || n.position || { x: 0, y: 0 }
  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])

  // Focus mode: dim everything more than 2 hops from the selection rather than hiding it, so the
  // user never loses their bearings — the substitute for a minimap we deliberately did not build.
  const near = useMemo(() => {
    if (!focusId) return null
    const keep = new Set([focusId])
    for (let hop = 0; hop < 2; hop++) {
      for (const e of edges) {
        if (keep.has(e.source)) keep.add(e.target)
        if (keep.has(e.target)) keep.add(e.source)
      }
    }
    return keep
  }, [focusId, edges])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const z = zoom().scaleExtent([0.25, 2.5])
      .filter(ev => !ev.button && (ev.type !== 'wheel' || ev.ctrlKey || ev.metaKey || !ev.shiftKey))
      .on('zoom', ev => setTf(ev.transform))
    select(el).call(z)
    return () => { select(el).on('.zoom', null) }
  }, [])

  // d3-drag on each node. Committed on end so we PATCH positions once per gesture, not per frame.
  useEffect(() => {
    if (readOnly) return
    const g = gRef.current
    if (!g) return
    const sel = select(g).selectAll('[data-node]')
    sel.call(drag()
      .on('start', function () { select(this).raise() })
      .on('drag', function (ev) {
        const id = this.getAttribute('data-node')
        const n = byId.get(id)
        if (!n) return
        setDragPos(p => ({ ...(p || {}), [id]: { x: (p?.[id]?.x ?? n.position?.x ?? 0) + ev.dx / tf.k, y: (p?.[id]?.y ?? n.position?.y ?? 0) + ev.dy / tf.k } }))
      })
      .on('end', function () {
        const id = this.getAttribute('data-node')
        setDragPos(p => {
          if (p && p[id]) onMove?.({ [id]: { x: Math.round(p[id].x / 8) * 8, y: Math.round(p[id].y / 8) * 8 } })
          const { [id]: _, ...rest } = p || {}
          return Object.keys(rest).length ? rest : null
        })
      }))
    return () => { sel.on('.drag', null) }
  }, [nodes, byId, tf.k, readOnly, onMove])

  const extent = useMemo(() => {
    if (!nodes.length) return { w: 400, h: 300 }
    return { w: Math.max(...nodes.map(n => (n.position?.x || 0))) + W + 60, h: Math.max(...nodes.map(n => (n.position?.y || 0))) + H + 60 }
  }, [nodes])

  if (!nodes.length) return null

  return (
    <div ref={wrapRef}
      style={{ position: 'relative', overflow: 'hidden', background: 'var(--bg-inset)', border: '1px solid var(--border-default)', borderRadius: 8, height: 'min(62vh, 640px)', cursor: 'grab' }}>
      {/* role="listbox" is REQUIRED for the role="option" nodes below to be valid ARIA — an option
          with no listbox ancestor is ignored, which would leave the whole canvas unannounced.
          listbox/option is the closest real pattern to a node graph (there is no ARIA graph
          pattern, and role="application" would suppress browse mode entirely). */}
      <div ref={gRef} role="listbox" aria-multiselectable="false"
        aria-label={`Design graph — ${nodes.length} components, ${edges.length} connections`}
        style={{ position: 'absolute', transformOrigin: '0 0', transform: `translate(${tf.x}px,${tf.y}px) scale(${tf.k})`, width: extent.w, height: extent.h }}>
        <svg width={extent.w} height={extent.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
          <defs>
            <marker id="dc-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
              <path d="M0 0 L6 3 L0 6 z" style={{ fill: 'var(--text-secondary)' }} />
            </marker>
          </defs>
          {edges.map(e => {
            const s = byId.get(e.source), t = byId.get(e.target)
            if (!s || !t) return null
            const sp = posOf(s), tp = posOf(t)
            const dx = tp.x - sp.x
            const a = { x: sp.x + (dx >= 0 ? W : 0), y: sp.y + H / 2 }
            const b = { x: tp.x + (dx >= 0 ? 0 : W), y: tp.y + H / 2 }
            const mx = (a.x + b.x) / 2
            const lit = selected === e.source || selected === e.target
            const dim = near && !(near.has(e.source) && near.has(e.target))
            // An edge the model asserted (isStatic:false) is drawn in a weaker colour AND its label
            // is prefixed "?" — the dash alone would be invisible to a screen reader.
            const inferred = e.data?.isStatic === false
            return (
              <g key={e.id} opacity={dim ? 0.25 : 1}>
                <path d={`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`}
                  fill="none" markerEnd="url(#dc-arrow)" strokeWidth={lit ? 2 : 1.3}
                  strokeDasharray={e.data?.kind === 'publishes' ? '5 3' : undefined}
                  // --bg-surface-active on --bg-inset is 1.10:1 in light and 1.27:1 in dark: the
                  // lines vanish and you are left with a field of floating arrowheads, in the one
                  // view whose entire deliverable IS the connections. --text-secondary matches the
                  // arrowhead marker already in use; inferred edges stay weaker on purpose.
                  style={{ stroke: lit ? 'var(--text-primary)' : inferred ? 'var(--text-tertiary)' : 'var(--text-secondary)' }} />
              </g>
            )
          })}
        </svg>

        {/* edge labels as HTML so they stay real text */}
        {edges.map(e => {
          const s = byId.get(e.source), t = byId.get(e.target)
          if (!s || !t || !e.label) return null
          const sp = posOf(s), tp = posOf(t)
          const dim = near && !(near.has(e.source) && near.has(e.target))
          return (
            <div key={e.id + ':l'} style={{
              position: 'absolute', left: (sp.x + tp.x) / 2 + W / 2 - 50, top: (sp.y + tp.y) / 2 + H / 2 - 9, width: 100,
              textAlign: 'center', pointerEvents: 'none', opacity: dim ? 0.25 : 1,
            }}>
              <span style={{
                font: `400 10px ${MONO}`, color: 'var(--text-secondary)', background: 'var(--bg-base)',
                border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '1px 5px',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', maxWidth: '100%',
              }}>{e.data?.isStatic === false ? '? ' : ''}{e.label}</span>
            </div>
          )
        })}

        {nodes.map(n => {
          const p = posOf(n)
          const t = TYPES[n.type] || TYPES.process
          const isSel = selected === n.id
          const dim = near && !near.has(n.id)
          const files = n.data?.files?.length || 0
          const inbound = edges.filter(e => e.target === n.id).length
          const outbound = edges.filter(e => e.source === n.id).length
          return (
            <button key={n.id} data-node={n.id} role="option" aria-selected={isSel}
              aria-label={`${n.data?.label}. ${n.type}. ${inbound} incoming, ${outbound} outgoing connections. ${files} files. ${n.data?.origin === 'user' ? 'Added by you' : n.data?.origin === 'assistant' ? 'Proposed by the assistant' : 'Generated'}.`}
              onClick={ev => { ev.stopPropagation(); onSelect?.(isSel ? null : n.id) }}
              onKeyDown={ev => { if ((ev.key === 'Delete' || ev.key === 'Backspace') && !readOnly) { ev.preventDefault(); onDelete?.(n.id) } }}
              style={{
                position: 'absolute', left: p.x, top: p.y, width: W, height: H, padding: 0, border: 'none',
                background: 'transparent', borderRadius: 6, cursor: readOnly ? 'pointer' : 'grab',
                opacity: dim ? 0.3 : 1, textAlign: 'left',
                boxShadow: isSel ? '0 0 0 1px var(--text-primary)' : 'none',
              }}>
              <Shape type={n.type} selected={isSel} />
              <span style={{ position: 'absolute', inset: 0, padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 3, pointerEvents: 'none' }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ color: t.accent, font: `600 11px ${MONO}` }} aria-hidden="true">{t.glyph}</span>
                  <span style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{n.data?.label}</span>
                  <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }} aria-hidden="true">{ORIGIN[n.data?.origin] || ''}</span>
                </span>
                {/* the type is PRINTED, not just coloured — this is the real colourblind answer */}
                <span style={{ font: `600 9px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                  {n.type}{files ? ` · ${files} file${files > 1 ? 's' : ''}` : ''}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div style={{ position: 'absolute', right: 8, bottom: 8, display: 'flex', gap: 4 }}>
        <button className="mini" style={{ marginTop: 0 }} title="zoom to fit"
          onClick={() => { setTf(zoomIdentity); select(wrapRef.current).call(zoom().transform, zoomIdentity) }}>⤢ fit</button>
        <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)', alignSelf: 'center', padding: '0 4px' }}>{Math.round(tf.k * 100)}%</span>
      </div>
    </div>
  )
}
