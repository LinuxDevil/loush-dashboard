import React, { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { api, tildify } from './api.js'

// Constitution — .wakeel/constitution knowledge-base explorer. Shared by both dashboards;
// pass accent to match the shell (claude amber vs cursor blue).
const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)', minWidth: 0 }
const KIND_COLOR = { constitution: '#c792ea', rule: '#e5764d', skill: '#3fb96a', workflow: '#5eb3f6', file: '#8a817a' }
const KIND_LABEL = { constitution: 'constitution', rule: 'rules', skill: 'skills', workflow: 'workflows', file: 'code files' }

const Chip = ({ text, color = '#7a716a' }) => <span style={{ font: `500 10px ${MONO}`, color, border: `1px solid ${color}55`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{text}</span>
const Stat = ({ label, val }) => (
  <div style={{ ...PANEL, padding: '14px 18px', flex: 1, minWidth: 120 }}>
    <div style={{ font: `700 24px ${HEAD}`, color: '#e5dbd2' }}>{val ?? '—'}</div>
    <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{label}</div>
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
      .style('background', 'rgba(0,0,0,0.18)').style('border-radius', '12px').style('cursor', 'grab')
    const g = svg.append('g')
    svg.call(d3.zoom().scaleExtent([0.25, 5]).on('zoom', e => g.attr('transform', e.transform)))

    const link = g.append('g').selectAll('line').data(links).join('line')
      .attr('stroke', '#ffffff').attr('stroke-opacity', 0.10).attr('stroke-width', l => Math.min(3, 0.5 + l.n * 0.25))
    const node = g.append('g').selectAll('circle').data(nodes).join('circle')
      .attr('r', r).attr('fill', n => KIND_COLOR[n.kind]).attr('fill-opacity', n => n.kind === 'file' ? 0.75 : 0.95)
      .attr('stroke', '#0d0b0a').attr('stroke-width', 1).style('cursor', 'pointer')
    node.append('title').text(n => n.kind === 'file' ? `${n.id}\ncited by ${n.artifacts} artifacts · ${n.citations} citations` : `${n.id}\n${n.atoms} atoms`)
    const label = g.append('g').selectAll('text').data(nodes.filter(n => n.kind !== 'file' || n.artifacts >= 4)).join('text')
      .text(n => short(n.id)).attr('font-size', 8.5).attr('font-family', 'IBM Plex Mono, monospace')
      .attr('fill', n => n.kind === 'file' ? '#9a8f86' : '#d8cfc7').attr('pointer-events', 'none').attr('dy', -9).attr('text-anchor', 'middle')

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
        <div style={{ font: `600 13px ${HEAD}`, color: '#e5dbd2' }}>Citation graph</div>
        {Object.entries(KIND_LABEL).map(([k, l]) => (
          <span key={k} style={{ font: `400 10px ${MONO}`, color: '#9a8f86' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: KIND_COLOR[k], marginRight: 4 }} />{l}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', font: `400 10.5px ${MONO}`, color: '#7a716a', display: 'flex', alignItems: 'center', gap: 6 }}>
          show files cited by ≥
          <input type="range" min="1" max="8" value={minDeg} onChange={e => setMinDeg(Number(e.target.value))} style={{ width: 90 }} />
          <b style={{ color: accent }}>{minDeg}</b> artifacts
        </span>
      </div>
      <div ref={ref} />
      <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginTop: 8 }}>
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
          <span style={{ font: `600 15px ${HEAD}`, color: KIND_COLOR[a.kind] }}>{a.name}</span>
          <Chip text={`${a.atoms} atoms`} color={accent} />
        </div>
        {(a.description || a.whenToUse) && (
          <div style={{ ...PANEL, display: 'grid', gap: 6 }}>
            {a.description && <div style={{ font: `400 12.5px "IBM Plex Sans", sans-serif`, color: '#d8cfc7' }}>{a.description}</div>}
            {a.whenToUse && <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}><span style={{ color: accent }}>when to use:</span> {a.whenToUse}</div>}
          </div>
        )}
        {a.paths.length > 0 && (
          <div style={PANEL}>
            <div style={{ font: `600 12px ${HEAD}`, color: '#e5dbd2', marginBottom: 6 }}>Governed paths — loads when working on</div>
            {a.paths.map(p => <div key={p} style={{ font: `400 11.5px ${MONO}`, color: '#d8cfc7', padding: '2px 0', overflowWrap: 'anywhere' }}>{p}</div>)}
          </div>
        )}
        <div style={PANEL}>
          <div style={{ font: `600 12px ${HEAD}`, color: '#e5dbd2', marginBottom: 6 }}>Cited code files ({files.length})</div>
          {files.map(({ file, n }) => (
            <div key={file} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <span style={{ font: `400 11.5px ${MONO}`, color: '#d8cfc7', flex: 1, overflowWrap: 'anywhere' }}>{file}</span>
              <span style={{ font: `400 10.5px ${MONO}`, color: accent }}>{n} cite{n > 1 ? 's' : ''}</span>
              <span style={{ font: `400 10px ${MONO}`, color: '#5c554f' }}>{(artsOf.get(file) || []).length - 1} others cite it</span>
            </div>
          ))}
          {files.length === 0 && <div style={{ font: `400 11.5px ${MONO}`, color: '#7a716a' }}>no code citations</div>}
        </div>
        <div style={PANEL}>
          <div style={{ font: `600 12px ${HEAD}`, color: '#e5dbd2', marginBottom: 6 }}>Connected artifacts — share cited files</div>
          {conns.map(({ other, files: shared }) => (
            <div key={other} style={{ padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span onClick={() => openArtifact(other)} style={{ font: `500 11.5px ${MONO}`, color: KIND_COLOR[other.split(':')[0]], cursor: 'pointer', textDecoration: 'underline dotted' }}>{other}</span>
                <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginLeft: 'auto' }}>{shared.length} shared file{shared.length > 1 ? 's' : ''}</span>
              </div>
              <div style={{ font: `400 10px ${MONO}`, color: '#5c554f', overflowWrap: 'anywhere' }}>{shared.slice(0, 4).map(f => f.split('/').pop()).join(' · ')}{shared.length > 4 ? ` · +${shared.length - 4}` : ''}</div>
            </div>
          ))}
          {conns.length === 0 && <div style={{ font: `400 11.5px ${MONO}`, color: '#7a716a' }}>no shared files with other artifacts</div>}
        </div>
        <details style={PANEL}>
          <summary style={{ font: `600 12px ${HEAD}`, color: '#e5dbd2', cursor: 'pointer' }}>Markdown source</summary>
          <pre style={{ font: `400 11px ${MONO}`, color: '#d8cfc7', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 8, maxHeight: '55vh', overflowY: 'auto' }}>{md ?? 'loading…'}</pre>
        </details>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <div style={PANEL}>
        {rows.map(a => (
          <div key={a.label} onClick={() => openArtifact(a.label)} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 4px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ font: `500 12.5px ${MONO}`, color: KIND_COLOR[kind], whiteSpace: 'nowrap' }}>{a.name}</span>
            <span style={{ font: `400 11px "IBM Plex Sans", sans-serif`, color: '#7a716a', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.description}</span>
            <span style={{ font: `400 10.5px ${MONO}`, color: accent }}>{a.atoms} atoms</span>
            <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{a.paths.length} paths · {(filesOf.get(a.label) || []).length} files</span>
          </div>
        ))}
        {rows.length === 0 && <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>none</div>}
      </div>
      {kind === 'workflow' && data.workflowOverlaps.length > 0 && (
        <div style={PANEL}>
          <div style={{ font: `600 12px ${HEAD}`, color: '#e5dbd2', marginBottom: 6 }}>Overlaps — workflows sharing implementation files</div>
          {data.workflowOverlaps.map((o, i) => (
            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span onClick={() => openArtifact('workflow:' + o.a)} style={{ cursor: 'pointer' }}><Chip text={o.a} color={KIND_COLOR.workflow} /></span>
                <span style={{ color: '#7a716a' }}>↔</span>
                <span onClick={() => openArtifact('workflow:' + o.b)} style={{ cursor: 'pointer' }}><Chip text={o.b} color={KIND_COLOR.workflow} /></span>
                <span style={{ font: `700 11px ${MONO}`, color: accent, marginLeft: 'auto' }}>{o.shared.length} shared</span>
              </div>
              <div style={{ font: `400 10.5px ${MONO}`, color: '#9a8f86', marginTop: 3 }}>{o.shared.join('  ·  ')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const TABS = ['graph', 'workflows', 'rules', 'skills', 'hot files', 'coverage', 'debt']
export default function ConstitutionSection({ accent = '#e5a03a' }) {
  const [repos, setRepos] = useState(null)
  const [repo, setRepo] = useState('')
  const [custom, setCustom] = useState('')
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('graph')

  useEffect(() => { api.get('/api/constitution/repos').then(rs => { setRepos(rs); setRepo(r => r || rs[0] || '') }).catch(() => setRepos([])) }, [])
  useEffect(() => {
    if (!repo) return
    setData(null); setErr(null)
    api.get('/api/constitution/insights?repo=' + encodeURIComponent(repo)).then(setData).catch(e => setErr(e.message))
  }, [repo])

  if (repos === null) return <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>looking for .wakeel/constitution repos…</div>

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
    </div>
  )

  if (repos.length === 0 && !repo) return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: '#7a716a' }}>
        No repo with a <span style={{ color: accent }}>.wakeel/constitution/</span> knowledge base found among your Claude / Cursor projects.
      </div>
      {pathInput}
    </div>
  )

  const t = data?.totals
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {pathInput}
      {err && <div style={{ font: `400 12px ${MONO}`, color: '#e5484d' }}>{err}</div>}
      {!data && !err && <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>crunching atoms…</div>}
      {data && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Stat label="artifacts" val={t.artifacts} />
            <Stat label="verified atoms" val={t.atoms} />
            <Stat label="code files cited" val={t.citedFiles} />
            <Stat label="debt / migration atoms" val={t.debtAtoms} />
            <Stat label="workflow overlaps" val={data.workflowOverlaps.length} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {TABS.map(x => <button key={x} className={tab === x ? 'active' : ''} onClick={() => setTab(x)}>{x}</button>)}
          </div>

          {tab === 'graph' && <ForceGraph graph={data.graph} accent={accent} />}
          {tab === 'workflows' && <ArtifactBrowser kind="workflow" data={data} accent={accent} repo={repo} />}
          {tab === 'rules' && <ArtifactBrowser kind="rule" data={data} accent={accent} repo={repo} />}
          {tab === 'skills' && <ArtifactBrowser kind="skill" data={data} accent={accent} repo={repo} />}

          {tab === 'hot files' && (
            <div style={PANEL}>
              <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginBottom: 8 }}>files cited by the most artifacts — editing one touches every listed rule/skill/workflow</div>
              {data.hotFiles.map(f => (
                <div key={f.file} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 4px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexWrap: 'wrap' }}>
                  <span style={{ font: `400 11.5px ${MONO}`, color: '#e5dbd2', flex: 1, minWidth: 220, overflowWrap: 'anywhere' }}>{f.file}</span>
                  <span style={{ font: `700 11px ${MONO}`, color: accent }}>{f.artifacts} artifacts</span>
                  <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{f.citations} cites</span>
                  <div style={{ flexBasis: '100%', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {f.citedBy.slice(0, 8).map(a => <Chip key={a} text={a} color={KIND_COLOR[a.split(':')[0]]} />)}
                    {f.citedBy.length > 8 && <Chip text={`+${f.citedBy.length - 8} more`} />}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'coverage' && (
            <div style={PANEL}>
              <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginBottom: 8 }}>which governed path is watched by which artifacts — a source dir absent here has no path-scoped guidance</div>
              {data.coverage.map(c => (
                <div key={c.path} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '5px 4px', borderBottom: '1px solid rgba(255,255,255,0.03)', flexWrap: 'wrap' }}>
                  <span style={{ font: `400 11.5px ${MONO}`, color: '#e5dbd2', minWidth: 280, flex: 1, overflowWrap: 'anywhere' }}>{c.path}</span>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {c.artifacts.map(a => <Chip key={a} text={a} color={KIND_COLOR[a.split(':')[0]]} />)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'debt' && (
            <div style={PANEL}>
              <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginBottom: 8 }}>atoms mentioning @ts-nocheck / @ts-ignore / v1 / legacy / migration — the burn-down list</div>
              {data.debt.map((x, i) => (
                <div key={i} style={{ padding: '6px 4px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <Chip text={x.artifact} color={KIND_COLOR[x.artifact.split(':')[0]]} />
                    {x.cite && <span style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginLeft: 'auto', overflowWrap: 'anywhere' }}>{x.cite}</span>}
                  </div>
                  <div style={{ font: `400 11.5px "IBM Plex Sans", sans-serif`, color: '#d8cfc7', marginTop: 3 }}>{x.claim}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
