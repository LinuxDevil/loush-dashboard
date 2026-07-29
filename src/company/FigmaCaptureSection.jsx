import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, tildify } from '../lib/api.js'

// Figma Capture & Annotation — visual editor for Captures produced by the /figma-capture skill.
// Creation happens in the skill (it has Figma MCP tool access this dashboard doesn't); this page
// only reads/writes the on-disk convention: <repo>/.claude/figma-captures/<slug>/{capture.json,
// screenshot.png, annotations.json, context.md}. See dashboard/CONTEXT.md for the glossary
// (Capture, Annotation, Component catalog).
const MONO = "var(--mono)"
const HEAD = "var(--head)"
const SANS = 'var(--body)'
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12, padding: '16px 18px', minWidth: 0 }
const ACCENT = 'var(--blue)'
const Dim = ({ children, style }) => <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', ...style }}>{children}</div>

// smallest-area node whose rect contains (px,py) — "most specific" layer under the click
function nodeAt(nodes, px, py) {
  let best = null
  for (const n of nodes || []) {
    if (px >= n.x && px <= n.x + n.w && py >= n.y && py <= n.y + n.h) {
      if (!best || n.w * n.h < best.w * best.h) best = n
    }
  }
  return best
}

// Figma-panel-style picker: collapsible categories -> components -> variants (Storybook story
// names for that component). Clicking a component sets its fullTitle; clicking a variant appends
// " / <variant>". The text field stays freeform underneath — the tree is a shortcut, not a cage.
function ComponentPicker({ catalog, projectComponents, value, onChange }) {
  const [openCat, setOpenCat] = useState({})
  const [openComp, setOpenComp] = useState({})
  const grouped = useMemo(() => {
    const fromProject = (projectComponents || []).map(c => ({ category: 'Project', name: c.name, fullTitle: `${c.name} (${c.file})`, file: c.file, variants: [] }))
    const byCat = new Map()
    for (const c of [...fromProject, ...(catalog || [])]) { if (!byCat.has(c.category)) byCat.set(c.category, []); byCat.get(c.category).push(c) }
    return [...byCat.entries()]
  }, [catalog, projectComponents])

  const chevron = open => (
    <span style={{ display: 'inline-block', width: 10, transition: 'transform .1s', transform: open ? 'rotate(90deg)' : 'none' }}>▸</span>
  )

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <input value={value} onChange={e => onChange(e.target.value)}
        placeholder="design-system component — pick below, or type your own" style={{ font: `400 12px ${MONO}` }} />
      <div style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-default)', borderRadius: 6, padding: 6, maxHeight: 240, overflow: 'auto' }}>
        {grouped.length === 0 && <Dim style={{ padding: 4 }}>no catalog yet — run `npm run catalog:refresh`</Dim>}
        {grouped.map(([cat, comps]) => {
          const catOpen = openCat[cat] !== false
          return (
            <div key={cat}>
              <div onClick={() => setOpenCat(o => ({ ...o, [cat]: !catOpen }))}
                style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', font: `600 10px ${MONO}`, color: 'var(--text-secondary)', letterSpacing: '0.08em', padding: '4px 2px' }}>
                {chevron(catOpen)}{cat.toUpperCase()}
              </div>
              {catOpen && comps.map(c => {
                const compOpen = !!openComp[c.fullTitle]
                const hasVariants = c.variants?.length > 0
                return (
                  <div key={c.fullTitle}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingLeft: 14, borderRadius: 4, background: value === c.fullTitle ? 'var(--blue-bg)' : 'transparent' }}>
                      <span onClick={() => hasVariants && setOpenComp(o => ({ ...o, [c.fullTitle]: !compOpen }))}
                        style={{ cursor: hasVariants ? 'pointer' : 'default', visibility: hasVariants ? 'visible' : 'hidden' }}>{chevron(compOpen)}</span>
                      <span onClick={() => onChange(c.fullTitle)} style={{ flex: 1, cursor: 'pointer', font: `400 12px ${SANS}`, color: value === c.fullTitle ? ACCENT : 'var(--text-primary)', padding: '3px 2px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        ⊞ {c.name}{c.file && <span style={{ marginLeft: 6, font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>{c.file}</span>}
                      </span>
                    </div>
                    {compOpen && c.variants.map(v => {
                      const full = `${c.fullTitle} / ${v}`
                      return (
                        <div key={v} onClick={() => onChange(full)}
                          style={{ marginLeft: 34, padding: '3px 6px', cursor: 'pointer', borderRadius: 4, font: `400 11px ${MONO}`, color: value === full ? ACCENT : 'var(--text-secondary)', background: value === full ? 'var(--blue-bg)' : 'transparent' }}>
                          {v}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AnnotationForm({ initial, annotations, catalog, projectComponents, onSave, onCancel }) {
  const [component, setComponent] = useState(initial.component || '')
  const [note, setNote] = useState(initial.note || '')
  const [parentId, setParentId] = useState(initial.parentId || '')
  return (
    <div style={{ ...PANEL, display: 'grid', gap: 8 }}>
      <Dim>region {Math.round(initial.region.x)},{Math.round(initial.region.y)} · {Math.round(initial.region.w)}×{Math.round(initial.region.h)}{initial.nodeId ? ` · node ${initial.nodeId}` : ' · freehand'}</Dim>
      <ComponentPicker catalog={catalog} projectComponents={projectComponents} value={component} onChange={setComponent} />
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
        placeholder="note — comment, usage instruction, context: whatever Claude needs to know about this region"
        style={{ font: `400 12px ${MONO}`, resize: 'vertical' }} />
      <select value={parentId} onChange={e => setParentId(e.target.value)} style={{ font: `400 11px ${MONO}` }}>
        <option value="">no parent</option>
        {annotations.filter(a => a.id !== initial.id).map(a => <option key={a.id} value={a.id}>{a.component || a.id} (parent)</option>)}
      </select>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onSave({ ...initial, component, note, parentId: parentId || undefined })}>save</button>
        <button onClick={onCancel}>cancel</button>
      </div>
    </div>
  )
}

function Editor({ repo, slug, catalog, onBack }) {
  const [capture, setCapture] = useState(null)
  const [annotations, setAnnotations] = useState(null)
  const [draft, setDraft] = useState(null) // { id?, region, nodeId? } mid-edit
  const [editingId, setEditingId] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [contextMd, setContextMd] = useState(null)
  const [liveRect, setLiveRect] = useState(null) // dashed preview while dragging out a brand-new box
  const [projectComponents, setProjectComponents] = useState([])
  const [imgSize, setImgSize] = useState(null) // set on <img> onLoad — the SVG viewBox needs a state, not a ref, so boxes re-render once the screenshot loads
  const imgRef = useRef(null)
  const dragRef = useRef(null) // { mode: 'draw'|'move'|'resize', id?, handle?, start, startRegion?, moved }

  useEffect(() => {
    api.get(`/api/figma-capture/${slug}?repo=${encodeURIComponent(repo)}`)
      .then(r => { setCapture(r.capture); setAnnotations(r.annotations || []) })
      .catch(() => { setCapture({}); setAnnotations([]) })
  }, [repo, slug])

  // components actually defined in the target repo itself — a real project component beats a
  // docs-site guess when mapping a region, so it lives in the same picker as the catalog.
  useEffect(() => {
    api.get('/api/figma-capture/project-components?repo=' + encodeURIComponent(repo)).then(setProjectComponents).catch(() => setProjectComponents([]))
  }, [repo])

  const nodes = capture?.nodeTree || []
  const screenshotUrl = `/api/figma-capture/${slug}/screenshot?repo=${encodeURIComponent(repo)}`

  const toImageCoords = e => {
    const el = imgRef.current
    const rect = el.getBoundingClientRect()
    const scaleX = el.naturalWidth / rect.width
    const scaleY = el.naturalHeight / rect.height
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY, scaleX, scaleY }
  }

  const xEdges = useMemo(() => nodes.flatMap(n => [n.x, n.x + n.w]), [nodes])
  const yEdges = useMemo(() => nodes.flatMap(n => [n.y, n.y + n.h]), [nodes])
  const SNAP_PX = 8 // screen pixels, converted to image space per-axis below since the screenshot may be scaled
  const snapAxis = (edges, value, scale) => {
    let best = value, bestDist = SNAP_PX * scale
    for (const e of edges) { const d = Math.abs(e - value); if (d < bestDist) { bestDist = d; best = e } }
    return best
  }
  // the bottom-right corner snaps to the nearest layer edge while dragging; the top-left stays exactly where you clicked
  const snappedCorner = cur => ({ x: snapAxis(xEdges, cur.x, cur.scaleX), y: snapAxis(yEdges, cur.y, cur.scaleY) })

  // dragging a corner handle: 'w'/'e' adjust x+width, 'n'/'s' adjust y+height, clamped to a 4px minimum
  const resizeRegion = (start, handle, dx, dy) => {
    let { x, y, w, h } = start
    if (handle.includes('w')) { x = start.x + dx; w = start.w - dx }
    if (handle.includes('e')) w = start.w + dx
    if (handle.includes('n')) { y = start.y + dy; h = start.h - dy }
    if (handle.includes('s')) h = start.h + dy
    return { x, y, w: Math.max(4, w), h: Math.max(4, h) }
  }

  // starts on the raw canvas (rects/handles call stopPropagation before this bubbles up) — always a new box
  const onMouseDown = e => { dragRef.current = { mode: 'draw', start: toImageCoords(e), moved: false } }
  // starts on an existing box or one of its resize handles
  const startDrag = (mode, a, handle) => e => {
    e.stopPropagation()
    setDraft(null); setEditingId(a.id)
    dragRef.current = { mode, id: a.id, handle, start: toImageCoords(e), startRegion: { ...a.region }, moved: false }
  }

  const onMouseMove = e => {
    const d = dragRef.current
    if (!d) return
    d.moved = true
    const cur = toImageCoords(e)
    if (d.mode === 'draw') {
      const corner = snappedCorner(cur)
      setLiveRect({ x: d.start.x, y: d.start.y, w: Math.max(0, corner.x - d.start.x), h: Math.max(0, corner.y - d.start.y) })
    } else if (d.mode === 'move') {
      const dx = cur.x - d.start.x, dy = cur.y - d.start.y
      setAnnotations(prev => prev.map(a => a.id === d.id ? { ...a, region: { ...d.startRegion, x: d.startRegion.x + dx, y: d.startRegion.y + dy } } : a))
    } else if (d.mode === 'resize') {
      setAnnotations(prev => prev.map(a => a.id === d.id ? { ...a, region: resizeRegion(d.startRegion, d.handle, cur.x - d.start.x, cur.y - d.start.y) } : a))
    }
  }

  const onMouseUp = e => {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    if (d.mode === 'move' || d.mode === 'resize') { setDirty(true); return }
    setLiveRect(null)
    const cur = toImageCoords(e)
    if (!d.moved || (Math.abs(cur.x - d.start.x) < 4 && Math.abs(cur.y - d.start.y) < 4)) {
      // click, no drag: snap to node under the point
      const n = nodeAt(nodes, d.start.x, d.start.y)
      if (!n) return
      setDraft({ id: crypto.randomUUID(), region: { x: n.x, y: n.y, w: n.w, h: n.h }, nodeId: n.id })
    } else {
      // top-left is exactly where you clicked; bottom-right is the snapped drag corner
      const corner = snappedCorner(cur)
      const w = Math.max(0, corner.x - d.start.x), h = Math.max(0, corner.y - d.start.y)
      if (w < 4 || h < 4) return // collapsed (dragged up/left of the start point) — not a usable box
      setDraft({ id: crypto.randomUUID(), region: { x: d.start.x, y: d.start.y, w, h } })
    }
    setEditingId(null)
  }

  const saveAnnotation = a => {
    setAnnotations(prev => {
      const exists = prev.some(p => p.id === a.id)
      return exists ? prev.map(p => (p.id === a.id ? a : p)) : [...prev, { ...a, createdAt: new Date().toISOString() }]
    })
    setDraft(null); setEditingId(null); setDirty(true)
  }
  const deleteAnnotation = id => { setAnnotations(prev => prev.filter(a => a.id !== id)); setDirty(true) }
  // lock = click-through: the box stays visible but stops capturing the pointer, so you can draw a new box on top of it.
  const toggleLock = id => { setAnnotations(prev => prev.map(a => a.id === id ? { ...a, locked: !a.locked } : a)); setEditingId(cur => cur === id ? null : cur); setDirty(true) }

  const persist = () => {
    api.post(`/api/figma-capture/${slug}/annotations?repo=${encodeURIComponent(repo)}`, { annotations })
      .then(() => setDirty(false))
  }
  const generateContext = () => {
    api.post(`/api/figma-capture/${slug}/context?repo=${encodeURIComponent(repo)}`, {})
      .then(r => setContextMd(r.contextMd))
  }

  if (!capture || !annotations) return <Dim>loading capture…</Dim>
  const editing = editingId ? annotations.find(a => a.id === editingId) : draft

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <button onClick={onBack}>← captures</button>
        <span style={{ font: `600 14px ${HEAD}`, color: ACCENT }}>{capture.frameName || slug}</span>
        <Dim>{annotations.length} annotation{annotations.length === 1 ? '' : 's'}</Dim>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={persist} disabled={!dirty}>{dirty ? '● save annotations' : '✓ saved'}</button>
          <button onClick={generateContext}>⤴ generate context.md</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, alignItems: 'start' }}>
        <div style={{ position: 'relative', lineHeight: 0, userSelect: 'none', background: 'var(--bg-surface-active)', borderRadius: 8, padding: 16 }}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
          <img ref={imgRef} src={screenshotUrl} alt={capture.frameName} style={{ maxWidth: '100%', display: 'block', cursor: 'crosshair' }} draggable={false}
            onLoad={e => setImgSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })} />
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            viewBox={imgSize ? `0 0 ${imgSize.w} ${imgSize.h}` : '0 0 1 1'} preserveAspectRatio="none">
            {annotations.map(a => {
              const selected = a.id === editingId
              const hs = Math.max(4, Math.min(a.region.w, a.region.h) * 0.12) // handle half-size, scales down on tiny boxes
              const handles = selected && !a.locked ? [
                { key: 'nw', cx: a.region.x, cy: a.region.y },
                { key: 'ne', cx: a.region.x + a.region.w, cy: a.region.y },
                { key: 'sw', cx: a.region.x, cy: a.region.y + a.region.h },
                { key: 'se', cx: a.region.x + a.region.w, cy: a.region.y + a.region.h },
              ] : []
              return (
                <g key={a.id}>
                  <rect x={a.region.x} y={a.region.y} width={a.region.w} height={a.region.h}
                   
                    strokeWidth={2} strokeDasharray={a.locked ? '5 4' : undefined}
                    style={{ fill: (selected ? 'var(--blue-bg)' : a.locked ? 'var(--bg-surface-active)' : 'var(--green-bg)'), stroke: (selected ? ACCENT : a.locked ? 'var(--text-tertiary)' : 'var(--green)'), pointerEvents: a.locked ? 'none' : 'auto', cursor: 'move' }} onMouseDown={a.locked ? undefined : startDrag('move', a)} />
                  {handles.map(h => (
                    <rect key={h.key} x={h.cx - hs} y={h.cy - hs} width={hs * 2} height={hs * 2}
                      strokeWidth={1}
                      style={{ fill: (ACCENT), stroke: 'var(--bg-surface)', pointerEvents: 'auto', cursor: `${h.key}-resize` }} onMouseDown={startDrag('resize', a, h.key)} />
                  ))}
                </g>
              )
            })}
            {liveRect && <rect x={liveRect.x} y={liveRect.y} width={liveRect.w} height={liveRect.h}
              strokeWidth={2} strokeDasharray="4 3"  style={{ fill: 'var(--blue)', stroke: (ACCENT) }} />}
            {draft && <rect x={draft.region.x} y={draft.region.y} width={draft.region.w} height={draft.region.h}
              strokeWidth={2} strokeDasharray="4 3"  style={{ fill: 'var(--blue)', stroke: (ACCENT) }} />}
          </svg>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          {editing ? (
            <AnnotationForm initial={editing} annotations={annotations} catalog={catalog} projectComponents={projectComponents}
              onSave={saveAnnotation} onCancel={() => { setDraft(null); setEditingId(null) }} />
          ) : (
            <Dim>Click a layer to snap a box to it, or drag anywhere to draw a freehand region. Drag an existing box to move it, drag a corner handle to resize it, or click it to edit component/note.</Dim>
          )}
          <div style={{ ...PANEL, display: 'grid', gap: 6, maxHeight: 360, overflow: 'auto' }}>
            {annotations.length === 0 && <Dim>no annotations yet</Dim>}
            {annotations.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 6, alignItems: 'baseline', font: `400 11px ${SANS}`, color: 'var(--text-primary)' }}>
                <span style={{ color: a.locked ? 'var(--text-tertiary)' : ACCENT, cursor: 'pointer' }} onClick={() => { setDraft(null); setEditingId(a.id) }}>{a.component || '(untitled)'}</span>
                <Dim style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.note}</Dim>
                <button style={{ font: `400 10px ${MONO}`, padding: '1px 6px' }} title={a.locked ? 'unlock (make editable)' : 'lock (click-through, so you can draw over it)'} onClick={() => toggleLock(a.id)}>{a.locked ? '🔒' : '🔓'}</button>
                <button style={{ font: `400 10px ${MONO}`, padding: '1px 6px' }} onClick={() => deleteAnnotation(a.id)}>✕</button>
              </div>
            ))}
          </div>
          {contextMd && (
            <details style={PANEL} open>
              <summary style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)', cursor: 'pointer' }}>context.md</summary>
              <pre style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', marginTop: 8 }}>{contextMd}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}

// A capture sourced from a live URL instead of a Figma frame. It writes the same capture.json
// shape into the same directory, so everything below — the list, the annotator, the node picker
// — works on it unchanged; the page's structured blocks fill the slot Figma's node tree fills.
function CreatePageCaptureForm({ repo, onCreated }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [scheme, setScheme] = useState('light')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const create = () => {
    setBusy(true); setErr(null)
    api.post('/api/page-capture/create', { repo, url: url.trim(), colorScheme: scheme })
      .then(r => { setOpen(false); setUrl(''); onCreated(r.slug) })
      .catch(e => setErr(e.message))
      .finally(() => setBusy(false))
  }

  if (!open) return <button onClick={() => setOpen(true)}>+ capture a web page</button>
  return (
    <div style={{ ...PANEL, display: 'grid', gap: 8 }}>
      <Dim>Loads the page in a headless browser and records what it is built from — colour, type and spacing ranked by real usage, CSS variables, breakpoints, and hover states. Takes a few seconds.</Dim>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com"
          onKeyDown={e => { if (e.key === 'Enter' && url.trim() && !busy) create() }}
          style={{ font: `400 12px ${MONO}`, flex: 1 }} />
        <select value={scheme} onChange={e => setScheme(e.target.value)}>
          <option value="light">light</option>
          <option value="dark">dark</option>
        </select>
        <button onClick={create} disabled={busy || !url.trim()}>{busy ? 'capturing…' : 'capture'}</button>
        <button onClick={() => setOpen(false)}>cancel</button>
      </div>
      {/* Loopback and private addresses are refused server-side unless PAGE_CAPTURE_ALLOW_LOCAL=1,
          so say that here rather than letting the user meet it as a bare 400. */}
      <Dim>Public URLs only. To capture your own dev server, start the dashboard with PAGE_CAPTURE_ALLOW_LOCAL=1.</Dim>
      {err && <div style={{ font: `400 12px ${MONO}`, color: 'var(--red)' }}>{err}</div>}
    </div>
  )
}

function CreateCaptureForm({ repo, onCreated }) {
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const create = () => {
    setBusy(true); setErr(null)
    api.post('/api/figma-capture/create', { repo, figmaLink: link.trim() })
      .then(r => { setOpen(false); setLink(''); onCreated(r.slug) })
      .catch(e => setErr(e.message))
      .finally(() => setBusy(false))
  }

  if (!open) return <button onClick={() => setOpen(true)}>+ create capture</button>
  return (
    <div style={{ ...PANEL, display: 'grid', gap: 8 }}>
      <Dim>Paste a Figma link to a specific frame (select the frame, Share → Copy link — must include a node-id).</Dim>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={link} onChange={e => setLink(e.target.value)} placeholder="https://www.figma.com/design/…?node-id=…"
          onKeyDown={e => { if (e.key === 'Enter' && link.trim() && !busy) create() }}
          style={{ font: `400 12px ${MONO}`, flex: 1 }} />
        <button onClick={create} disabled={busy || !link.trim()}>{busy ? 'fetching…' : 'create'}</button>
        <button onClick={() => setOpen(false)}>cancel</button>
      </div>
      {err && <div style={{ font: `400 12px ${MONO}`, color: 'var(--red)' }}>{err}</div>}
    </div>
  )
}

function CaptureList({ repo, onOpen }) {
  const [captures, setCaptures] = useState(null)
  const load = () => api.get('/api/figma-capture/list?repo=' + encodeURIComponent(repo)).then(setCaptures).catch(() => setCaptures([]))
  useEffect(() => { load() }, [repo])
  if (captures === null) return <Dim>loading captures…</Dim>
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <CreateCaptureForm repo={repo} onCreated={onOpen} />
        <CreatePageCaptureForm repo={repo} onCreated={onOpen} />
      </div>
      {captures.length === 0 ? (
        <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>
          No Captures found under <span style={{ color: ACCENT }}>.claude/figma-captures/</span> in this repo yet.
          Use the button above (needs <span style={{ color: ACCENT }}>FIGMA_TOKEN</span> set on the dashboard server), or run
          {' '}<span style={{ color: ACCENT }}>/figma-capture &lt;figma-link&gt;</span> from that repo in Claude Code.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {captures.map(c => (
            <div key={c.slug} onClick={() => onOpen(c.slug)} style={{ ...PANEL, cursor: 'pointer', display: 'grid', gap: 6 }}>
              <div style={{ font: `600 13px ${HEAD}`, color: ACCENT }}>{c.frameName || c.slug}</div>
              <Dim>{c.annotationCount} annotation{c.annotationCount === 1 ? '' : 's'} · fetched {c.fetchedAt ? new Date(c.fetchedAt).toLocaleDateString() : '—'}</Dim>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BranchChip({ repo }) {
  const [branch, setBranch] = useState(null)
  useEffect(() => { setBranch(null); api.get('/api/figma-capture/branch?repo=' + encodeURIComponent(repo)).then(r => setBranch(r.branch)).catch(() => setBranch(null)) }, [repo])
  if (!branch) return null
  return <Dim>⎇ {branch}</Dim>
}

// Figma personal-access-token setup — lets a new device set the key from the UI instead of the
// server's env. The key is write-only over the API: status tells you if it's set, never the value.
function FigmaTokenBar() {
  const [status, setStatus] = useState(null)
  const [val, setVal] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = () => api.get('/api/figma-capture/token').then(setStatus).catch(() => setStatus({ set: false }))
  useEffect(() => { load() }, [])
  const put = token => { setBusy(true); return api.put('/api/figma-capture/token', { token }).then(() => { setVal(''); setOpen(false); load() }).catch(e => alert(e.message)).finally(() => setBusy(false)) }
  if (!status) return null
  return (
    <div style={{ ...PANEL, padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: status.set ? 'var(--green)' : 'var(--accent-light)', display: 'inline-block' }} />
      <span>Figma API key: <span style={{ color: status.set ? 'var(--green)' : 'var(--accent-light)' }}>{status.set ? `set · ${status.source}` : 'not set'}</span></span>
      {status.envLocked ? <Dim>managed via FIGMA_TOKEN env — unset it there to edit here</Dim>
        : !open ? <button style={{ font: `400 10px ${MONO}`, padding: '2px 8px' }} onClick={() => setOpen(true)}>{status.set ? 'change' : '+ add key'}</button>
        : <>
            <input type="password" value={val} onChange={e => setVal(e.target.value)} placeholder="figd_… personal access token" autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && val.trim() && !busy) put(val.trim()) }} style={{ font: `400 11px ${MONO}`, minWidth: 280 }} />
            <button onClick={() => put(val.trim())} disabled={busy || !val.trim()}>{busy ? 'saving…' : 'save'}</button>
            {status.set && <button onClick={() => put('')} disabled={busy}>clear</button>}
            <button onClick={() => { setOpen(false); setVal('') }}>cancel</button>
          </>}
      <Dim style={{ marginLeft: 'auto' }}>Figma → Settings → Security → personal access tokens</Dim>
    </div>
  )
}

export default function FigmaCaptureSection() {
  const [projects, setProjects] = useState(null)
  const [repo, setRepo] = useState('')
  const [custom, setCustom] = useState('')
  const [slug, setSlug] = useState(null)
  const [catalog, setCatalog] = useState([])

  // Same project list as Workspaces > Projects (GET /api/projects) — any of them can get its
  // first Capture via `/figma-capture <link>`, so we don't pre-filter to ones that already have one.
  useEffect(() => {
    api.get('/api/projects').then(ps => {
      const existing = ps.filter(p => p.exists)
      setProjects(existing)
      setRepo(r => r || existing[0]?.path || '')
    }).catch(() => setProjects([]))
  }, [])
  useEffect(() => { api.get('/api/figma-capture/catalog').then(r => setCatalog(r.components || [])).catch(() => setCatalog([])) }, [])

  if (projects === null) return <Dim>loading projects…</Dim>

  const pathInput = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {projects.length > 0 && (
        <select value={repo} onChange={e => { setRepo(e.target.value); setSlug(null) }} style={{ font: `400 12px ${MONO}`, maxWidth: 380 }}>
          {projects.map(p => <option key={p.path} value={p.path}>{p.name}</option>)}
          {repo && !projects.some(p => p.path === repo) && <option value={repo}>{tildify(repo)}</option>}
        </select>
      )}
      <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="…or paste a repo path"
        onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) { setRepo(custom.trim()); setSlug(null); setCustom('') } }}
        style={{ font: `400 12px ${MONO}`, minWidth: 240 }} />
      {repo && <BranchChip repo={repo} />}
    </div>
  )

  if (!repo) return (
    <div style={{ display: 'grid', gap: 12 }}>
      <FigmaTokenBar />
      <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>
        No projects found under Workspaces — paste a repo path below.
      </div>
      {pathInput}
    </div>
  )

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <FigmaTokenBar />
      {pathInput}
      {slug
        ? <Editor repo={repo} slug={slug} catalog={catalog} onBack={() => setSlug(null)} />
        : <CaptureList repo={repo} onOpen={setSlug} />}
    </div>
  )
}
