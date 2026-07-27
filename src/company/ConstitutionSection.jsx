import React, { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { api, tildify } from '../lib/api.js'
import AtomsSection from './AtomsSection.jsx'
import { StackedBar, Bars, DataTable, Facts } from '../ui/charts.jsx'

// Constitution — .wakeel/constitution knowledge-base explorer. Shared by both dashboards;
// pass accent to match the shell (claude amber vs cursor blue).
const MONO = "var(--mono)"
const HEAD = "var(--head)"
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 12, minWidth: 0 }
const KIND_COLOR = { constitution: 'var(--violet)', rule: 'var(--accent)', skill: 'var(--green)', workflow: 'var(--blue)', file: 'var(--text-secondary)' }
const KIND_LABEL = { constitution: 'constitution', rule: 'rules', skill: 'skills', workflow: 'workflows', file: 'code files' }

const Chip = ({ text, color = 'var(--text-tertiary)' }) => <span style={{ font: `500 10px ${MONO}`, color, border: `1px solid ${color}55`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{text}</span>
const Stat = ({ label, val }) => (
  <div style={{ ...PANEL, padding: '14px 18px', flex: 1, minWidth: 120 }}>
    <div style={{ font: `700 20px ${HEAD}`, color: 'var(--text-primary)' }}>{val ?? '—'}</div>
    <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{label}</div>
  </div>
)

function ForceGraph({ graph, accent }) {
  const ref = useRef(null)
  const [minDeg, setMinDeg] = useState(2) // hide files cited by fewer artifacts — declutters by default
  const [focus, setFocus] = useState(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !graph) return
    const width = el.clientWidth || 900, height = 560

    const files = graph.nodes.filter(n => n.kind === 'file' && n.artifacts >= minDeg)
    const keep = new Set(files.map(f => f.id))
    const links = graph.links.filter(l => keep.has(l.target)).map(l => ({ ...l }))
    const connected = new Set(links.flatMap(l => [l.source, l.target]))
    const nodes = graph.nodes.filter(n => (n.kind === 'file' ? keep.has(n.id) : connected.has(n.id))).map(n => ({ ...n }))

    const deg = id => nodes.find(n => n.id === id)
    const r = n => n.kind === 'file' ? 3 + Math.min(10, n.artifacts * 1.4) : 4 + Math.min(12, Math.sqrt(n.atoms || 1) * 1.6)
    const short = id => id.includes('/') ? id.split('/').pop() : id.replace(/^[a-z]+:/, '')

    const svg = d3.select(el).html('').append('svg')
      .attr('width', width).attr('height', height)
      .style('background', 'var(--bg-inset)').style('border-radius', '12px').style('cursor', 'grab')
    const g = svg.append('g')
    svg.call(d3.zoom().scaleExtent([0.25, 5]).on('zoom', e => g.attr('transform', e.transform)))

    const link = g.append('g').selectAll('line').data(links).join('line')
      .style('stroke', 'var(--border-default)').attr('stroke-opacity', 0.9).attr('stroke-width', l => Math.min(3, 0.5 + l.n * 0.25))
    const node = g.append('g').selectAll('circle').data(nodes).join('circle')
      .attr('r', r).style('fill', n => KIND_COLOR[n.kind]).attr('fill-opacity', n => n.kind === 'file' ? 0.75 : 0.95)
      .style('stroke', 'var(--bg-base)').attr('stroke-width', 1).style('cursor', 'pointer')
    node.append('title').text(n => n.kind === 'file' ? `${n.id}\ncited by ${n.artifacts} artifacts · ${n.citations} citations` : `${n.id}\n${n.atoms} atoms`)
    const label = g.append('g').selectAll('text').data(nodes.filter(n => n.kind !== 'file' || n.artifacts >= 4)).join('text')
      .text(n => short(n.id)).attr('font-size', 8.5).attr('font-family', 'var(--mono)')
      .style('fill', n => n.kind === 'file' ? 'var(--text-secondary)' : 'var(--text-primary)').attr('pointer-events', 'none').attr('dy', -9).attr('text-anchor', 'middle')

    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(n => n.id).distance(l => 40 + 60 / Math.sqrt(l.n)).strength(0.35))
      .force('charge', d3.forceManyBody().strength(-70))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide().radius(n => r(n) + 3))
      .on('tick', () => {
        link.attr('x1', l => l.source.x).attr('y1', l => l.source.y).attr('x2', l => l.target.x).attr('y2', l => l.target.y)
        node.attr('cx', n => n.x).attr('cy', n => n.y)
        label.attr('x', n => n.x).attr('y', n => n.y)
      })

    node.call(d3.drag()
      .on('start', (e, n) => { if (!e.active) sim.alphaTarget(0.3).restart(); n.fx = n.x; n.fy = n.y })
      .on('drag', (e, n) => { n.fx = e.x; n.fy = e.y })
      .on('end', (e, n) => { if (!e.active) sim.alphaTarget(0); n.fx = null; n.fy = null }))

    // click to spotlight a node + its neighborhood; click background to reset
    const neighbors = id => {
      const s = new Set([id])
      for (const l of links) { if (l.source.id === id) s.add(l.target.id); if (l.target.id === id) s.add(l.source.id) }
      return s
    }
    node.on('click', (e, n) => {
      e.stopPropagation()
      const hood = neighbors(n.id)
      node.attr('fill-opacity', m => hood.has(m.id) ? 0.95 : 0.12)
      link.attr('stroke-opacity', l => l.source.id === n.id || l.target.id === n.id ? 0.5 : 0.03)
      label.attr('opacity', m => hood.has(m.id) ? 1 : 0.1)
      setFocus({ id: n.id, kind: n.kind, n: hood.size - 1 })
    })
    svg.on('click', () => {
      node.attr('fill-opacity', n => n.kind === 'file' ? 0.75 : 0.95)
      link.attr('stroke-opacity', 0.10)
      label.attr('opacity', 1)
      setFocus(null)
    })
    return () => sim.stop()
  }, [graph, minDeg])

  return (
    <div style={PANEL}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ font: `600 13px ${HEAD}`, color: 'var(--text-primary)' }}>Citation graph</div>
        {Object.entries(KIND_LABEL).map(([k, l]) => (
          <span key={k} style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: KIND_COLOR[k], marginRight: 4 }} />{l}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          show files cited by ≥
          <input type="range" min="1" max="8" value={minDeg} onChange={e => setMinDeg(Number(e.target.value))} style={{ width: 90 }} />
          <b style={{ color: accent }}>{minDeg}</b> artifacts
        </span>
      </div>
      <div ref={ref} />
      <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginTop: 8 }}>
        {focus
          ? <>focused: <span style={{ color: KIND_COLOR[focus.kind] }}>{focus.id}</span> — {focus.n} direct connections · click background to reset</>
          : 'drag nodes · scroll to zoom · click a node to spotlight its blast radius'}
      </div>
    </div>
  )
}

// browse one artifact kind: list → click → detail with governed paths, cited files,
// and connected artifacts (share ≥1 cited code file). Connections derive from graph.links.
function ArtifactBrowser({ kind, data, accent, repo }) {
  const [open, setOpen] = useState(null) // label
  const [md, setMd] = useState(null)
  const rows = data.artifacts.filter(a => a.kind === kind)

  const { filesOf, artsOf } = React.useMemo(() => {
    const filesOf = new Map(), artsOf = new Map() // label -> [{file,n}] / file -> [{label,n}]
    for (const l of data.graph.links) {
      if (!filesOf.has(l.source)) filesOf.set(l.source, [])
      filesOf.get(l.source).push({ file: l.target, n: l.n })
      if (!artsOf.has(l.target)) artsOf.set(l.target, [])
      artsOf.get(l.target).push({ label: l.source, n: l.n })
    }
    for (const v of filesOf.values()) v.sort((a, b) => b.n - a.n)
    return { filesOf, artsOf }
  }, [data])

  const connections = label => {
    const shared = new Map() // other label -> [files]
    for (const { file } of filesOf.get(label) || [])
      for (const { label: other } of artsOf.get(file) || []) {
        if (other === label) continue
        if (!shared.has(other)) shared.set(other, [])
        shared.get(other).push(file)
      }
    return [...shared.entries()].map(([other, files]) => ({ other, files })).sort((a, b) => b.files.length - a.files.length)
  }

  const openArtifact = label => {
    setOpen(label); setMd(null)
    const [k, n] = [label.split(':')[0], label.slice(label.indexOf(':') + 1)]
    api.get(`/api/constitution/artifact?repo=${encodeURIComponent(repo)}&kind=${k}&name=${encodeURIComponent(n)}`)
      .then(r => setMd(r.content)).catch(() => setMd('(could not load markdown)'))
  }

  if (open) {
    const a = data.artifacts.find(x => x.label === open)
    if (!a) { setOpen(null); return null }
    const files = filesOf.get(open) || []
    const conns = connections(open)
    return (
      <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <button onClick={() => setOpen(null)}>← {KIND_LABEL[kind]}</button>
          <span style={{ font: `600 14px ${HEAD}`, color: KIND_COLOR[a.kind] }}>{a.name}</span>
          <Chip text={`${a.atoms} atoms`} color={accent} />
        </div>
        <div style={{ ...PANEL, display: 'grid', gap: 10 }}>
          {a.description && <div style={{ font: `400 13px var(--body)`, color: 'var(--text-primary)' }}>{a.description}</div>}
          <Facts items={[
            { label: 'atoms', value: a.atoms, color: accent },
            { label: 'governed paths', value: a.paths.length },
            { label: 'cited files', value: files.length },
            { label: 'connected artifacts', value: conns.length },
          ]} />
          {a.whenToUse && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}><span style={{ color: accent }}>when to use:</span> {a.whenToUse}</div>}
          {a.paths.length > 0 && (
            <div>
              <div style={{ font: `600 11px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 5 }}>Governed paths — loads when working on</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{a.paths.map(p => <Chip key={p} text={p} color="var(--text-secondary)" />)}</div>
            </div>
          )}
        </div>
        <div style={PANEL}>
          <div style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 8 }}>Cited code files ({files.length})</div>
          <DataTable maxHeight="45vh" sort={{ key: 'n', dir: -1 }} columns={[
            { key: 'file', label: 'file', render: r => <span style={{ overflowWrap: 'anywhere' }}>{r.file}</span> },
            { key: 'n', label: 'cites', width: 70, align: 'right', render: r => <span style={{ color: accent, font: `600 11px ${MONO}` }}>{r.n}</span> },
            { key: 'others', label: 'others citing it', width: 120, align: 'right', sortValue: r => r.others, render: r => <span style={{ color: 'var(--text-tertiary)' }}>{r.others}</span> },
          ]} rows={files.map(({ file, n }) => ({ file, n, others: (artsOf.get(file) || []).length - 1, __key: file }))} />
        </div>
        <div style={PANEL}>
          <div style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 8 }}>Connected artifacts — share cited files (click to open)</div>
          <DataTable maxHeight="40vh" sort={{ key: 'shared', dir: -1 }} onRowClick={r => openArtifact(r.other)} columns={[
            { key: 'other', label: 'artifact', width: 240, render: r => <span style={{ color: KIND_COLOR[r.other.split(':')[0]], textDecoration: 'underline dotted' }}>{r.other}</span> },
            { key: 'shared', label: 'shared', width: 70, align: 'right', sortValue: r => r.files.length, render: r => <span style={{ color: accent, font: `600 11px ${MONO}` }}>{r.files.length}</span> },
            { key: 'files', label: 'shared files', render: r => <span style={{ color: 'var(--text-tertiary)', font: `400 10px ${MONO}`, overflowWrap: 'anywhere' }}>{r.files.slice(0, 5).map(f => f.split('/').pop()).join(' · ')}{r.files.length > 5 ? ` · +${r.files.length - 5}` : ''}</span> },
          ]} rows={conns.map(({ other, files: shared }) => ({ other, files: shared, __key: other }))} />
        </div>
        <details style={PANEL}>
          <summary style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)', cursor: 'pointer' }}>Markdown source</summary>
          <pre style={{ font: `400 11px ${MONO}`, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 8, maxHeight: '55vh', overflowY: 'auto' }}>{md ?? 'loading…'}</pre>
        </details>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <div style={PANEL}>
        <div style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 8 }}>Atoms per {kind} — click a bar to open</div>
        <Bars color={KIND_COLOR[kind]} onClick={it => openArtifact(`${kind}:${it.label}`)}
          items={[...rows].sort((x, y) => y.atoms - x.atoms).slice(0, 15).map(a => ({ label: a.name, value: a.atoms, hint: a.description }))} />
        {rows.length > 15 && <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', marginTop: 6 }}>top 15 of {rows.length} — full list below</div>}
      </div>
      <div style={PANEL}>
        <div style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 8 }}>All {KIND_LABEL[kind]} ({rows.length}) — click to open</div>
        <DataTable maxHeight="55vh" onRowClick={r => openArtifact(r.label)} columns={[
          { key: 'name', label: 'name', width: 210, render: r => <span style={{ color: KIND_COLOR[kind], font: `500 12px ${MONO}` }}>{r.name}</span> },
          { key: 'description', label: 'what it covers', render: r => <span style={{ font: `400 11px var(--body)`, color: 'var(--text-secondary)' }}>{r.description}</span> },
          { key: 'atoms', label: 'atoms', width: 64, align: 'right', render: r => <span style={{ color: accent, font: `600 11px ${MONO}` }}>{r.atoms}</span> },
          { key: 'paths', label: 'paths', width: 60, align: 'right', sortValue: r => r.paths.length, render: r => r.paths.length },
          { key: 'files', label: 'files', width: 60, align: 'right', sortValue: r => (filesOf.get(r.label) || []).length, render: r => (filesOf.get(r.label) || []).length },
        ]} rows={rows.map(r => ({ ...r, __key: r.label }))} />
      </div>
      {kind === 'workflow' && data.workflowOverlaps.length > 0 && (
        <div style={PANEL}>
          <div style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 8 }}>Overlaps — workflows sharing implementation files</div>
          <DataTable maxHeight="40vh" sort={{ key: 'n', dir: -1 }} columns={[
            { key: 'a', label: 'workflow', width: 200, render: o => <span onClick={() => openArtifact('workflow:' + o.a)} style={{ cursor: 'pointer' }}><Chip text={o.a} color={KIND_COLOR.workflow} /></span> },
            { key: 'b', label: '↔ workflow', width: 200, render: o => <span onClick={() => openArtifact('workflow:' + o.b)} style={{ cursor: 'pointer' }}><Chip text={o.b} color={KIND_COLOR.workflow} /></span> },
            { key: 'n', label: 'shared', width: 64, align: 'right', sortValue: o => o.shared.length, render: o => <span style={{ color: accent, font: `700 11px ${MONO}` }}>{o.shared.length}</span> },
            { key: 'shared', label: 'shared files', render: o => <span style={{ color: 'var(--text-secondary)', font: `400 10px ${MONO}`, overflowWrap: 'anywhere' }}>{o.shared.map(f => f.split('/').pop()).join(' · ')}</span> },
          ]} rows={data.workflowOverlaps.map((o, i) => ({ ...o, __key: i }))} />
        </div>
      )}
    </div>
  )
}

const TABS = ['graph', 'catalog', 'ask', 'triage', 'workflows', 'rules', 'skills', 'hot files', 'coverage', 'debt']
export default function ConstitutionSection({ accent = 'var(--amber)' }) {
  const [repos, setRepos] = useState(null)
  const [repo, setRepo] = useState('')
  const [custom, setCustom] = useState('')
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('graph')
  const statsRef = useRef(null)
  const contentRef = useRef(null)
  const [exporting, setExporting] = useState(null)

  // ponytail: export = snapshot the already-rendered DOM of the SELECTED repo, tab by tab,
  // driving real clicks into sub-pages (artifact / catalog detail) and saving one linked
  // HTML file per page via the server. No re-implementation of any view.
  const snapshot = (el, linkify) => {
    for (const i of el.querySelectorAll('input')) { // React holds input state as properties — mirror to attributes so it serializes
      if (i.type === 'checkbox') i.checked ? i.setAttribute('checked', '') : i.removeAttribute('checked')
      else i.setAttribute('value', i.value)
    }
    const clone = el.cloneNode(true)
    if (linkify) linkify(clone)
    return clone.innerHTML
  }
  const waitIdle = async (extra = 0) => {
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 100))
      if (!/crunching atoms…|indexing atoms…|loading…|loading review state…/.test(contentRef.current?.parentElement?.innerText || '')) break
    }
    if (extra) await new Promise(r => setTimeout(r, extra)) // let the d3 force layout settle
  }
  const fileName = s => s.replace(/[^\w.-]+/g, '_') + '.html'
  const page = (title, body) => {
    const head = [...document.querySelectorAll('style, link[rel="stylesheet"], link[rel="preconnect"]')].map(n => n.outerHTML).join('\n')
    return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}
<style>body{background:var(--bg-surface);color:var(--text-primary);padding:28px;max-width:1280px;margin:0 auto}h1{font:700 20px ${HEAD};margin:30px 0 10px}h2{font:600 13px ${HEAD};color:${accent};margin:24px 0 10px;text-transform:uppercase;letter-spacing:.08em}a{color:${accent}}</style>
</head><body>${body}</body></html>`
  }

  // capture every clickable sub-page reachable from the current tab: click each row/card,
  // snapshot the detail view, click "←" back. Returns [{label, file}] and pushes files.
  const captureSubPages = async (prefix, files) => {
    const clickables = () => [...contentRef.current.querySelectorAll('tbody tr[style*="pointer"], div[style*="grid-template-columns"] > div[style*="pointer"]')]
    const n = clickables().length
    const links = []
    for (let i = 0; i < n; i++) {
      const el = clickables()[i]
      if (!el) break
      el.click()
      await waitIdle(150)
      const back = contentRef.current.querySelector('button') // "← …" is always the first button on a detail view
      if (!back || !/←/.test(back.textContent)) continue // row wasn't a drill-down after all
      const title = contentRef.current.querySelector('span')?.textContent || `${prefix}-${i}`
      for (const d of contentRef.current.querySelectorAll('details')) d.setAttribute('open', '') // expand markdown source etc.
      const file = fileName(`${prefix}-${title}`)
      files.push({ name: file, html: page(title, `<a href="index.html">← index</a><h1>${title}</h1><div style="display:grid;gap:14px">${snapshot(contentRef.current)}</div>`) })
      links[i] = { label: title, file } // index-aligned with clickables() so the list view can wire row → file
      setExporting(`${prefix} ${i + 1}/${n}`)
      back.click()
      await waitIdle(100)
    }
    return links
  }

  const exportHtml = async () => {
    const origTab = tab
    const files = []
    const parts = [`<h1>${repo}</h1><div style="display:flex;gap:12px;flex-wrap:wrap">${snapshot(statsRef.current)}</div>`]
    for (const x of TABS) {
      if (x === 'ask') continue // interactive-only, nothing prefilled to share
      setExporting(x); setTab(x)
      await waitIdle(x === 'graph' ? 2500 : 200)
      if (!contentRef.current) continue
      if (['catalog', 'workflows', 'rules', 'skills'].includes(x)) {
        const links = await captureSubPages(x, files) // walk the drill-downs first…
        // …then snapshot the list view with each card/row wired to its sub-page file
        const listHtml = snapshot(contentRef.current, clone => {
          const els = [...clone.querySelectorAll('tbody tr[style*="pointer"], div[style*="grid-template-columns"] > div[style*="pointer"]')]
          els.forEach((el, i) => links[i] && el.setAttribute('onclick', `window.location.href='${links[i].file}'`))
        })
        parts.push(`<h2>${x}</h2><div style="display:grid;gap:14px">${listHtml}</div>`)
      } else {
        parts.push(`<h2>${x}</h2><div style="display:grid;gap:14px">${snapshot(contentRef.current)}</div>`)
      }
    }
    setTab(origTab); setExporting('saving…')
    files.push({ name: 'index.html', html: page(`Constitution — ${tildify(repo)}`, parts.join('\n')) })
    try {
      const r = await api.post('/api/constitution/export', { name: 'constitution-' + repo.split('/').pop(), files })
      setExporting(`✓ ${r.count} files → ${tildify(r.dir)}`)
    } catch (e) { setExporting('✗ ' + e.message) }
    setTimeout(() => setExporting(null), 10000)
  }

  useEffect(() => { api.get('/api/constitution/repos').then(rs => { setRepos(rs); setRepo(r => r || rs[0] || '') }).catch(() => setRepos([])) }, [])
  useEffect(() => {
    if (!repo) return
    setData(null); setErr(null)
    api.get('/api/constitution/insights?repo=' + encodeURIComponent(repo)).then(setData).catch(e => setErr(e.message))
  }, [repo])

  if (repos === null) return <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>looking for .wakeel/constitution repos…</div>

  const pathInput = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {repos.length > 0 && (
        <select value={repo} onChange={e => setRepo(e.target.value)} style={{ font: `400 12px ${MONO}`, maxWidth: 380 }}>
          {repos.map(r => <option key={r} value={r}>{tildify(r)}</option>)}
          {repo && !repos.includes(repo) && <option value={repo}>{tildify(repo)}</option>}
        </select>
      )}
      <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="…or paste a repo path"
        onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) { setRepo(custom.trim()); setCustom('') } }}
        style={{ font: `400 12px ${MONO}`, minWidth: 240 }} />
      <button onClick={exportHtml} disabled={!!exporting && !exporting.startsWith('✓') && !exporting.startsWith('✗')} style={{ marginLeft: 'auto' }}>
        {exporting ? exporting : '⬇ export html'}
      </button>
    </div>
  )

  if (repos.length === 0 && !repo) return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>
        No repo with a <span style={{ color: accent }}>.wakeel/constitution/</span> knowledge base found among your Claude / Cursor projects.
      </div>
      {pathInput}
    </div>
  )

  const t = data?.totals
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {pathInput}
      {err && <div style={{ font: `400 12px ${MONO}`, color: 'var(--red)' }}>{err}</div>}
      {!data && !err && <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>crunching atoms…</div>}
      {data && (
        <>
          <div ref={statsRef} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Stat label="artifacts" val={t.artifacts} />
            <Stat label="verified atoms" val={t.atoms} />
            <Stat label="code files cited" val={t.citedFiles} />
            <Stat label="debt / migration atoms" val={t.debtAtoms} />
            <Stat label="workflow overlaps" val={data.workflowOverlaps.length} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {TABS.map(x => <button key={x} className={tab === x ? 'active' : ''} onClick={() => setTab(x)}>{x}</button>)}
          </div>
          <div ref={contentRef} style={{ display: 'grid', gap: 14, minWidth: 0 }}>

          {tab === 'graph' && (
            <>
              <div style={{ ...PANEL, display: 'grid', gap: 8 }}>
                <div style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)' }}>Knowledge base composition — atoms per artifact kind</div>
                <StackedBar height={12} segments={['workflow', 'rule', 'skill', 'constitution'].map(k => ({
                  label: k, color: KIND_COLOR[k],
                  value: data.artifacts.filter(a => a.kind === k).reduce((s, a) => s + a.atoms, 0),
                }))} />
              </div>
              <ForceGraph graph={data.graph} accent={accent} />
            </>
          )}
          {tab === 'catalog' && <AtomsSection view="catalog" repo={repo} accent={accent} />}
          {tab === 'ask' && <AtomsSection view="ask" repo={repo} accent={accent} />}
          {tab === 'triage' && <AtomsSection view="triage" repo={repo} accent={accent} />}
          {tab === 'workflows' && <ArtifactBrowser kind="workflow" data={data} accent={accent} repo={repo} />}
          {tab === 'rules' && <ArtifactBrowser kind="rule" data={data} accent={accent} repo={repo} />}
          {tab === 'skills' && <ArtifactBrowser kind="skill" data={data} accent={accent} repo={repo} />}

          {tab === 'hot files' && (
            <div style={PANEL}>
              <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginBottom: 8 }}>files cited by the most artifacts — editing one touches every listed rule/skill/workflow</div>
              <div style={{ marginBottom: 16 }}>
                <Bars color={accent} height={13}
                  items={data.hotFiles.slice(0, 12).map(f => ({ label: f.file.split('/').pop(), value: f.artifacts, hint: f.file }))}
                  valueLabel={v => v + ' art.'} />
              </div>
              <DataTable maxHeight="60vh" sort={{ key: 'artifacts', dir: -1 }} columns={[
                { key: 'file', label: 'file', width: 320, render: f => <span style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{f.file}</span> },
                { key: 'artifacts', label: 'artifacts', width: 78, align: 'right', render: f => <span style={{ color: accent, font: `700 11px ${MONO}` }}>{f.artifacts}</span> },
                { key: 'citations', label: 'cites', width: 60, align: 'right', render: f => <span style={{ color: 'var(--text-tertiary)' }}>{f.citations}</span> },
                {
                  key: 'citedBy', label: 'cited by', sortValue: f => f.citedBy.length,
                  render: f => (
                    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                      {f.citedBy.slice(0, 6).map(a => <Chip key={a} text={a} color={KIND_COLOR[a.split(':')[0]]} />)}
                      {f.citedBy.length > 6 && <Chip text={`+${f.citedBy.length - 6}`} />}
                    </span>
                  ),
                },
              ]} rows={data.hotFiles.map(f => ({ ...f, __key: f.file }))} />
            </div>
          )}

          {tab === 'coverage' && <AtomsSection view="gaps" repo={repo} accent={accent} />}
          {tab === 'coverage' && (
            <div style={PANEL}>
              <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginBottom: 8 }}>which governed path is watched by which artifacts — a source dir absent here has no path-scoped guidance</div>
              <DataTable maxHeight="60vh" columns={[
                { key: 'path', label: 'governed path', width: 380, render: c => <span style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{c.path}</span> },
                { key: 'n', label: 'artifacts', width: 78, align: 'right', sortValue: c => c.artifacts.length, render: c => <span style={{ color: accent, font: `600 11px ${MONO}` }}>{c.artifacts.length}</span> },
                {
                  key: 'artifacts', label: 'watched by', sortValue: c => c.artifacts.join(','),
                  render: c => <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{c.artifacts.map(a => <Chip key={a} text={a} color={KIND_COLOR[a.split(':')[0]]} />)}</span>,
                },
              ]} rows={data.coverage.map(c => ({ ...c, __key: c.path }))} />
            </div>
          )}
          {tab === 'debt' && (
            <div style={PANEL}>
              <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginBottom: 8 }}>atoms mentioning @ts-nocheck / @ts-ignore / v1 / legacy / migration — the burn-down list</div>
              <div style={{ marginBottom: 16 }}>
                <Bars color="var(--accent)" height={13}
                  items={[...data.debt.reduce((m, x) => m.set(x.artifact, (m.get(x.artifact) || 0) + 1), new Map())]
                    .map(([label, value]) => ({ label: label.replace(/^[a-z]+:/, ''), value, color: KIND_COLOR[label.split(':')[0]], hint: label }))
                    .sort((x, y) => y.value - x.value).slice(0, 12)} />
              </div>
              <DataTable maxHeight="60vh" columns={[
                { key: 'artifact', label: 'artifact', width: 190, render: x => <Chip text={x.artifact} color={KIND_COLOR[x.artifact.split(':')[0]]} /> },
                { key: 'tone', label: 'tone', width: 70, render: x => x.tone ? <Chip text={x.tone} color={x.tone === 'must-not' ? 'var(--red)' : 'var(--amber)'} /> : null },
                { key: 'claim', label: 'debt claim', render: x => <span style={{ font: `400 12px var(--body)`, color: 'var(--text-primary)' }}>{x.claim}</span> },
                { key: 'cite', label: 'citation', width: 210, render: x => <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>{x.cite}</span> },
              ]} rows={data.debt.map((x, i) => ({ ...x, __key: i }))} />
            </div>
          )}
          </div>
        </>
      )}
    </div>
  )
}
