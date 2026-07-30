import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { select, zoom, zoomIdentity, drag } from 'd3'


const MONO = 'var(--mono)', HEAD = 'var(--head)'
export { W, H } from './tidy.js'
import { W, H, LABEL_MAX_W, LABEL_H, placeEdgeLabels } from './tidy.js'
const GRID = 8

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

function Shape({ type, selected, primary }) {
  const stroke = primary ? 'var(--text-primary)' : selected ? 'var(--accent)' : 'var(--border-default)'
  // --bg-elevated, not --bg-surface: in LIGHT both --bg-surface and --bg-inset are #f6f8fa, so a
  const common = { fill: 'var(--bg-elevated)', stroke, strokeWidth: 1.5 }
  const box = { position: 'absolute', inset: 0, pointerEvents: 'none' }
  if (type === 'store') return (
    <svg width={W} height={H} style={box} aria-hidden="true">
      <path d={`M0 10 A ${W / 2} 10 0 0 1 ${W} 10 L ${W} ${H - 10} A ${W / 2} 10 0 0 1 0 ${H - 10} Z`} {...common} />
      <path d={`M0 10 A ${W / 2} 10 0 0 0 ${W} 10`} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  )
  if (type === 'decision') return (
    <svg width={W} height={H} style={box} aria-hidden="true">
      <path d={`M${W / 2} 1 L ${W - 1} ${H / 2} L ${W / 2} ${H - 1} L 1 ${H / 2} Z`} {...common} />
    </svg>
  )
  const t = TYPES[type] || TYPES.process
  return (
    <svg width={W} height={H} style={box} aria-hidden="true">
      <rect x="0.75" y="0.75" width={W - 1.5} height={H - 1.5} rx="6"
        fill="var(--bg-elevated)" stroke={stroke} strokeWidth="1.5" strokeDasharray={type === 'external' ? '4 3' : undefined} />
      {type === 'service' && <rect x="0.75" y="0.75" width="3" height={H - 1.5} fill={t.accent} />}
      {type === 'ui' && <rect x="0.75" y="0.75" width={W - 1.5} height="3" fill={t.accent} />}
      {type === 'queue' && [10, 18, 26].map(y => <rect key={y} x="5" y={y} width="2" height="12" fill={t.accent} />)}
    </svg>
  )
}

export default function DesignCanvas({
  graph, selected, selection, onSelect, onSelection, onMove, onDelete, onConnect, readOnly, focusId, announce,
}) {
  const wrapRef = useRef(null)
  const gRef = useRef(null)
  const [tf, setTf] = useState(() => zoomIdentity)
  const [dragPos, setDragPos] = useState(null)
  const [marquee, setMarquee] = useState(null)
  const [wire, setWire] = useState(null)
  const [geo, setGeo] = useState(false)
  const [focusNode, setFocusNode] = useState(null)
  const zoomRef = useRef(null)

  const nodes = graph?.nodes || []
  const edges = graph?.edges || []
  const sel = selection instanceof Set ? selection : new Set(selected ? [selected] : [])
  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])
  const posOf = useCallback(n => (dragPos && dragPos[n.id]) || n.position || { x: 0, y: 0 }, [dragPos])

  const labelSpots = useMemo(() => placeEdgeLabels(
    edges.map(e => {
      const s = byId.get(e.source), t = byId.get(e.target)
      if (!s || !t || !e.label) return null
      const sp = posOf(s), tp = posOf(t)
      const dx = tp.x - sp.x
      return {
        id: e.id, label: e.label,
        a: { x: sp.x + (dx >= 0 ? W : 0), y: sp.y + H / 2 },
        b: { x: tp.x + (dx >= 0 ? 0 : W), y: tp.y + H / 2 },
      }
    }).filter(Boolean),
    nodes.map(posOf),
  ), [edges, nodes, byId, posOf])

  useEffect(() => { if (!focusNode && nodes.length) setFocusNode(nodes[0].id) }, [nodes, focusNode])

  const near = useMemo(() => {
    if (!focusId) return null
    const keep = new Set([focusId])
    for (let hop = 0; hop < 2; hop++) for (const e of edges) {
      if (keep.has(e.source)) keep.add(e.target)
      if (keep.has(e.target)) keep.add(e.source)
    }
    return keep
  }, [focusId, edges])

  // ---- pan / zoom -------------------------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const z = zoom().scaleExtent([0.25, 2.5])
      .filter(ev => !ev.button && !ev.shiftKey && (ev.type !== 'wheel' || ev.ctrlKey || ev.metaKey))
      .on('zoom', ev => setTf(ev.transform))
    zoomRef.current = z
    select(el).call(z)
    return () => { select(el).on('.zoom', null) }
  }, [])

  const applyTf = useCallback(t => { setTf(t); if (wrapRef.current && zoomRef.current) select(wrapRef.current).call(zoomRef.current.transform, t) }, [])

  const extent = useMemo(() => {
    if (!nodes.length) return { w: 400, h: 300, minX: 0, minY: 0 }
    const xs = nodes.map(n => (n.position?.x || 0)), ys = nodes.map(n => (n.position?.y || 0))
    return { w: Math.max(...xs) + W + 60, h: Math.max(...ys) + H + 60, minX: Math.min(...xs), minY: Math.min(...ys) }
  }, [nodes])

  /** Real zoom-to-fit. The old "fit" reset to 100% at the origin, which on a wide graph left half
   *  the nodes off-screen — a label that did the opposite of what it said. */
  const fit = useCallback(() => {
    const el = wrapRef.current
    if (!el || !nodes.length) return
    const pad = 24
    const k = Math.max(0.25, Math.min(2.5, Math.min((el.clientWidth - pad * 2) / extent.w, (el.clientHeight - pad * 2) / extent.h)))
    applyTf(zoomIdentity.translate((el.clientWidth - extent.w * k) / 2, (el.clientHeight - extent.h * k) / 2).scale(k))
  }, [nodes.length, extent, applyTf])

  const panBy = useCallback((dx, dy) => applyTf(tf.translate(dx / tf.k, dy / tf.k)), [tf, applyTf])
  const zoomBy = useCallback(f => {
    const el = wrapRef.current
    if (!el) return
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2
    const k = Math.max(0.25, Math.min(2.5, tf.k * f))
    applyTf(zoomIdentity.translate(cx - ((cx - tf.x) / tf.k) * k, cy - ((cy - tf.y) / tf.k) * k).scale(k))
  }, [tf, applyTf])

  const reveal = useCallback(id => {
    const el = wrapRef.current, n = byId.get(id)
    if (!el || !n?.position) return
    const x = n.position.x * tf.k + tf.x, y = n.position.y * tf.k + tf.y
    const m = 40
    let dx = 0, dy = 0
    if (x < m) dx = m - x; else if (x + W * tf.k > el.clientWidth - m) dx = el.clientWidth - m - (x + W * tf.k)
    if (y < m) dy = m - y; else if (y + H * tf.k > el.clientHeight - m) dy = el.clientHeight - m - (y + H * tf.k)
    if (dx || dy) applyTf(tf.translate(dx / tf.k, dy / tf.k))
  }, [byId, tf, applyTf])

  // ---- node drag (moves the whole selection) ----------------------------------------------------
  useEffect(() => {
    if (readOnly) return
    const g = gRef.current
    if (!g) return
    const s = select(g).selectAll('[data-node]')
    s.call(drag()
      .filter(ev => !ev.button && !ev.target.closest?.('[data-handle]'))
      .on('start', function () { select(this).raise() })
      .on('drag', function (ev) {
        const id = this.getAttribute('data-node')
        const group = sel.has(id) && sel.size > 1 ? [...sel] : [id]
        setDragPos(p => {
          const next = { ...(p || {}) }
          for (const gid of group) {
            const n = byId.get(gid)
            if (!n) continue
            next[gid] = { x: (next[gid]?.x ?? n.position?.x ?? 0) + ev.dx / tf.k, y: (next[gid]?.y ?? n.position?.y ?? 0) + ev.dy / tf.k }
          }
          return next
        })
      })
      .on('end', function () {
        setDragPos(p => {
          if (!p) return null
          const out = {}
          for (const [id, v] of Object.entries(p)) out[id] = { x: Math.round(v.x / GRID) * GRID, y: Math.round(v.y / GRID) * GRID }
          if (Object.keys(out).length) onMove?.(out)
          return null
        })
      }))
    return () => { s.on('.drag', null) }
  }, [nodes, byId, tf.k, readOnly, onMove, sel])

  // ---- marquee (shift-drag on empty canvas) -----------------------------------------------------
  const toGraph = useCallback(ev => {
    const r = wrapRef.current.getBoundingClientRect()
    return { x: (ev.clientX - r.left - tf.x) / tf.k, y: (ev.clientY - r.top - tf.y) / tf.k }
  }, [tf])

  const onCanvasDown = ev => {
    if (readOnly || !ev.shiftKey || ev.target.closest('[data-node]')) return
    ev.preventDefault()
    const p = toGraph(ev)
    setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
    const move = e => setMarquee(m => (m ? { ...m, ...(({ x, y }) => ({ x1: x, y1: y }))(toGraph(e)) } : m))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setMarquee(m => {
        if (m) {
          const [lo, hi] = [{ x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1) }, { x: Math.max(m.x0, m.x1), y: Math.max(m.y0, m.y1) }]
          const hit = nodes.filter(n => { const p2 = posOf(n); return p2.x + W > lo.x && p2.x < hi.x && p2.y + H > lo.y && p2.y < hi.y }).map(n => n.id)
          if (hit.length) { onSelection?.(new Set(hit)); announce?.(`${hit.length} component${hit.length > 1 ? 's' : ''} selected`) }
        }
        return null
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- drag-to-connect ---------------------------------------------------------------------------
  const startWire = (ev, id) => {
    if (readOnly) return
    ev.preventDefault(); ev.stopPropagation()
    const p = toGraph(ev)
    setWire({ from: id, x: p.x, y: p.y })
    const move = e => { const q = toGraph(e); setWire(w => (w ? { ...w, x: q.x, y: q.y } : w)) }
    const up = e => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const target = el?.closest('[data-node]')?.getAttribute('data-node')
      setWire(null)
      if (target && target !== id) { onConnect?.(id, target); announce?.(`connected ${byId.get(id)?.data.label} to ${byId.get(target)?.data.label}`) }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- keyboard ----------------------------------------------------------------------------------
  const outOf = id => edges.filter(e => e.source === id)
  const inOf = id => edges.filter(e => e.target === id)

  const step = (id, dir) => {
    if (geo) {
      const from = posOf(byId.get(id))
      const cand = nodes.filter(n => n.id !== id).map(n => ({ n, p: posOf(n) })).filter(({ p }) => (
        dir === 'right' ? p.x > from.x : dir === 'left' ? p.x < from.x : dir === 'down' ? p.y > from.y : p.y < from.y
      ))
      if (!cand.length) return null
      cand.sort((a, b) => (Math.hypot(a.p.x - from.x, a.p.y - from.y) - Math.hypot(b.p.x - from.x, b.p.y - from.y)))
      return { id: cand[0].n.id, say: cand[0].n.data.label }
    }
    if (dir === 'right') { const e = outOf(id)[0]; return e ? { id: e.target, say: `${byId.get(e.target)?.data.label}. Followed outgoing connection ${e.label || 'unlabelled'}. 1 of ${outOf(id).length}.` } : null }
    if (dir === 'left') { const e = inOf(id)[0]; return e ? { id: e.source, say: `${byId.get(e.source)?.data.label}. Followed incoming connection ${e.label || 'unlabelled'}.` } : null }
    const outs = outOf(id)
    if (outs.length > 1) { const e = outs[dir === 'down' ? 1 : outs.length - 1]; return { id: e.target, say: `${byId.get(e.target)?.data.label}. ${e.label || 'unlabelled'}.` } }
    const idx = nodes.findIndex(n => n.id === id)
    const next = nodes[dir === 'down' ? Math.min(nodes.length - 1, idx + 1) : Math.max(0, idx - 1)]
    return next && next.id !== id ? { id: next.id, say: next.data.label } : null
  }

  const onKey = ev => {
    const id = focusNode
    if (!id) return
    const k = ev.key
    const DIR = { ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down' }
    if (DIR[k]) {
      ev.preventDefault()
      if (ev.altKey && !readOnly) {
        const d = ev.shiftKey ? GRID * 6 : GRID
        const group = sel.has(id) && sel.size > 1 ? [...sel] : [id]
        const out = {}
        for (const gid of group) {
          const p = posOf(byId.get(gid))
          out[gid] = { x: p.x + (DIR[k] === 'right' ? d : DIR[k] === 'left' ? -d : 0), y: p.y + (DIR[k] === 'down' ? d : DIR[k] === 'up' ? -d : 0) }
        }
        onMove?.(out)
        announce?.(`moved ${group.length} component${group.length > 1 ? 's' : ''}`)
        return
      }
      const to = step(id, DIR[k])
      if (!to) { announce?.('no connection that way'); return }
      setFocusNode(to.id); reveal(to.id)
      if (ev.shiftKey) { const n = new Set(sel); n.add(to.id); onSelection?.(n) } else onSelect?.(to.id)
      announce?.(to.say)
      return
    }
    if (k === 'g') { setGeo(g => { announce?.(!g ? 'geometric navigation on' : 'connection navigation on'); return !g }) }
    else if (k === ' ') { ev.preventDefault(); const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); onSelection?.(n); announce?.(`${n.size} selected`) }
    else if (k === 'Enter') { ev.preventDefault(); onSelect?.(id) }
    else if ((k === 'Delete' || k === 'Backspace') && !readOnly) { ev.preventDefault(); onDelete?.(id) }
    else if (k === '0') { ev.preventDefault(); fit(); announce?.('zoomed to fit') }
    else if (k === '1') { ev.preventDefault(); applyTf(zoomIdentity) }
    else if (k === '+' || k === '=') { ev.preventDefault(); zoomBy(1.2) }
    else if (k === '-') { ev.preventDefault(); zoomBy(1 / 1.2) }
    else if (k === 'a' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); onSelection?.(new Set(nodes.map(n => n.id))); announce?.(`all ${nodes.length} selected`) }
    else if (k === 'Escape') { onSelection?.(new Set()); onSelect?.(null) }
    else if (k === 'h' || k === 'j' || k === 'l' || k === 'i') {
      ev.preventDefault()
      panBy(k === 'l' ? -60 : k === 'h' ? 60 : 0, k === 'j' ? -60 : k === 'i' ? 60 : 0)
    }
  }

  if (!nodes.length) return null

  return (
    <div ref={wrapRef} onPointerDown={onCanvasDown} onKeyDown={onKey}
      style={{ position: 'relative', overflow: 'hidden', background: 'var(--bg-inset)', border: '1px solid var(--border-default)', borderRadius: 8, height: 'min(62vh, 640px)', cursor: marquee ? 'crosshair' : 'grab' }}>
      {}
      <div ref={gRef} role="listbox" aria-multiselectable="true"
        aria-label={`Design graph — ${nodes.length} components, ${edges.length} connections. Arrow keys follow connections, g toggles spatial movement, shift-drag selects an area.`}
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
            const lit = sel.has(e.source) || sel.has(e.target)
            const dim = near && !(near.has(e.source) && near.has(e.target))
            const inferred = e.data?.isStatic === false
            return (
              <path key={e.id} d={`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`} opacity={dim ? 0.25 : 1}
                fill="none" markerEnd="url(#dc-arrow)" strokeWidth={lit ? 2 : 1.3}
                strokeDasharray={e.data?.kind === 'publishes' ? '5 3' : undefined}
                // --bg-surface-active on --bg-inset is 1.10:1 in light: invisible lines with
                style={{ stroke: lit ? 'var(--text-primary)' : inferred ? 'var(--text-tertiary)' : 'var(--text-secondary)' }} />
            )
          })}
          {wire && byId.get(wire.from) && (() => {
            const p = posOf(byId.get(wire.from))
            return <path d={`M ${p.x + W} ${p.y + H / 2} L ${wire.x} ${wire.y}`} fill="none" strokeWidth="1.5" strokeDasharray="4 3" style={{ stroke: 'var(--accent)' }} />
          })()}
          {marquee && (
            <rect x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)}
              width={Math.abs(marquee.x1 - marquee.x0)} height={Math.abs(marquee.y1 - marquee.y0)}
              style={{ fill: 'var(--accent-bg)', stroke: 'var(--accent)', strokeWidth: 1 }} />
          )}
        </svg>

        {}
        {edges.map(e => {
          const s = byId.get(e.source), t = byId.get(e.target)
          if (!s || !t || !e.label) return null
          const dim = near && !(near.has(e.source) && near.has(e.target))
          const spot = labelSpots.get(e.id)
          if (!spot) return null
          return (
            <div key={e.id + ':l'} aria-hidden="true"
              style={{ position: 'absolute', left: spot.x, top: spot.y - LABEL_H / 2, transform: 'translateX(-50%)', textAlign: 'center', pointerEvents: 'none', opacity: dim ? 0.25 : 1 }}>
              {}
              <span style={{ font: `400 10px ${MONO}`, fontStyle: e.data?.isStatic === false ? 'italic' : 'normal', color: 'var(--text-secondary)', background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', maxWidth: LABEL_MAX_W }}>
                {e.label}
              </span>
            </div>
          )
        })}

        {nodes.map(n => {
          const p = posOf(n)
          const t = TYPES[n.type] || TYPES.process
          const isSel = sel.has(n.id)
          const isPrimary = selected === n.id
          const dim = near && !near.has(n.id)
          const files = n.data?.files?.length || 0
          const inbound = edges.filter(e => e.target === n.id).length
          const outbound = edges.filter(e => e.source === n.id).length
          return (
            <button key={n.id} data-node={n.id} role="option" aria-selected={isSel}
              tabIndex={focusNode === n.id ? 0 : -1}
              onFocus={() => setFocusNode(n.id)}
              aria-label={`${n.data?.label}. ${n.type}. ${inbound} incoming, ${outbound} outgoing connections. ${files} files. ${n.data?.origin === 'user' ? 'Added by you' : n.data?.origin === 'assistant' ? 'Proposed by the assistant' : 'Generated'}.`}
              onClick={ev => {
                ev.stopPropagation()
                if (ev.shiftKey || ev.metaKey || ev.ctrlKey) { const s2 = new Set(sel); s2.has(n.id) ? s2.delete(n.id) : s2.add(n.id); onSelection?.(s2) }
                else onSelect?.(isPrimary ? null : n.id)
              }}
              style={{
                position: 'absolute', left: p.x, top: p.y, width: W, height: H, padding: 0, border: 'none',
                background: 'transparent', borderRadius: 6, cursor: readOnly ? 'pointer' : 'grab',
                opacity: dim ? 0.3 : 1, textAlign: 'left',
                boxShadow: isPrimary ? '0 0 0 1px var(--text-primary)' : isSel ? '0 0 0 1px var(--accent)' : 'none',
              }}>
              <Shape type={n.type} selected={isSel} primary={isPrimary} />
              <span style={{ position: 'absolute', inset: 0, padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 3, pointerEvents: 'none' }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ color: t.accent, font: `600 11px ${MONO}` }} aria-hidden="true">{t.glyph}</span>
                  <span style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{n.data?.label}</span>
                  <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }} aria-hidden="true">{ORIGIN[n.data?.origin] || ''}</span>
                </span>
                {}
                <span style={{ font: `600 9px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                  {n.type}{files ? ` · ${files} file${files > 1 ? 's' : ''}` : ''}
                </span>
              </span>
              {}
              {!readOnly && (
                <span data-handle="1" onPointerDown={ev => startWire(ev, n.id)} aria-hidden="true"
                  title="drag to connect"
                  style={{ position: 'absolute', right: -5, top: H / 2 - 5, width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', cursor: 'crosshair', opacity: isSel || focusNode === n.id ? 1 : 0.35 }} />
              )}
            </button>
          )
        })}
      </div>

      <div style={{ position: 'absolute', right: 8, bottom: 8, display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>{geo ? 'spatial' : 'connections'} · {Math.round(tf.k * 100)}%</span>
        <button className="mini" style={{ marginTop: 0 }} title="zoom to fit (0)" onClick={fit}>⤢ fit</button>
      </div>
    </div>
  )
}
