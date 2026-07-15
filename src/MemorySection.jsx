import React, { useEffect, useState } from 'react'
import { api, fmtDate } from './api.js'

// Memory Recall — ask your past self. Searches curated memory facts + raw transcripts.
const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const accent = '#d97757'
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '16px 18px', backdropFilter: 'blur(10px)', minWidth: 0 }
const TYPE_COLOR = { user: '#8a817a', feedback: '#e5764d', project: '#5eb3f6', reference: '#3fb96a', memory: '#c792ea' }

const Chip = ({ text, color = '#7a716a' }) => (
  <span style={{ font: `500 10px ${MONO}`, color, border: `1px solid ${color}55`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{text}</span>
)

// highlight query terms inside an excerpt
function Highlight({ text, terms }) {
  if (!terms.length) return text
  const re = new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig')
  const parts = String(text).split(re)
  return parts.map((p, i) => re.test(p)
    ? <mark key={i} style={{ background: accent + '33', color: '#f0e6dd', borderRadius: 3 }}>{p}</mark>
    : <span key={i}>{p}</span>)
}

function MemoryCard({ r, terms }) {
  const [full, setFull] = useState(null)
  const color = TYPE_COLOR[r.type] || TYPE_COLOR.memory
  return (
    <div style={{ ...PANEL, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ font: `600 14px ${HEAD}`, color: '#e5dbd2' }}>{r.name}</span>
        <Chip text={r.type} color={color} />
        <Chip text={r.project} />
        <span style={{ marginLeft: 'auto', font: `400 10px ${MONO}`, color: '#7a716a' }}>{fmtDate(r.mtime)}</span>
      </div>
      {r.description && <div style={{ font: `400 12px ${MONO}`, color: '#b8a89c', marginBottom: 8 }}><Highlight text={r.description} terms={terms} /></div>}
      <div style={{ font: `400 12px ${MONO}`, color: '#9a8f84', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
        <Highlight text={full || r.excerpt} terms={terms} />{!full && r.excerpt.length >= 600 ? '…' : ''}
      </div>
      {!full && r.excerpt.length >= 600 && (
        <button style={{ marginTop: 8, font: `400 11px ${MONO}` }}
          onClick={() => api.get('/api/memory/file?path=' + encodeURIComponent(r.path)).then(d => setFull(d.content.replace(/^---[\s\S]*?---\n/, '')))}>
          expand full memory
        </button>
      )}
    </div>
  )
}

function TranscriptCard({ r, terms }) {
  return (
    <div style={{ ...PANEL, borderLeft: '3px solid #4a423c', padding: '12px 16px' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 5 }}>
        <Chip text={r.role} color={r.role === 'user' ? '#8a817a' : accent} />
        <Chip text={r.project} />
        <span style={{ font: `400 10px ${MONO}`, color: '#5f574f' }}>transcript</span>
        <span style={{ marginLeft: 'auto', font: `400 10px ${MONO}`, color: '#7a716a' }}>{r.t ? fmtDate(r.t) : ''}</span>
      </div>
      <div style={{ font: `400 12px ${MONO}`, color: '#9a8f84', lineHeight: 1.55 }}><Highlight text={r.excerpt} terms={terms} /></div>
    </div>
  )
}

export default function MemorySection() {
  const [q, setQ] = useState('')
  const [project, setProject] = useState('')
  const [srcMem, setSrcMem] = useState(true)
  const [srcTx, setSrcTx] = useState(true)
  const [projects, setProjects] = useState([])
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [ran, setRan] = useState('')

  useEffect(() => { api.get('/api/memory/projects').then(setProjects).catch(() => {}) }, [])

  const run = () => {
    const query = q.trim()
    if (query.length < 2) return
    const sources = [srcMem && 'memory', srcTx && 'transcript'].filter(Boolean).join(',')
    if (!sources) return
    setBusy(true); setRan(query)
    const url = `/api/memory/search?q=${encodeURIComponent(query)}&sources=${sources}` + (project ? `&project=${encodeURIComponent(project)}` : '')
    api.get(url).then(d => setRes(d.results)).catch(() => setRes([])).finally(() => setBusy(false))
  }

  const terms = ran.toLowerCase().split(/\s+/).filter(Boolean)
  const memHits = (res || []).filter(r => r.source === 'memory')
  const txHits = (res || []).filter(r => r.source === 'transcript')

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ ...PANEL, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
          placeholder="what did I decide about…"
          style={{ font: `400 13px ${MONO}`, flex: 1, minWidth: 240, padding: '9px 12px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#e5dbd2' }} />
        <select value={project} onChange={e => setProject(e.target.value)} style={{ font: `400 12px ${MONO}`, maxWidth: 220 }}>
          <option value="">all projects</option>
          {projects.map(p => <option key={p.dir} value={p.dir}>{p.label} ({p.count})</option>)}
        </select>
        <button onClick={run} disabled={busy || q.trim().length < 2} style={{ font: `500 12px ${MONO}`, padding: '8px 16px' }}>
          {busy ? 'searching…' : '⌕ recall'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', font: `400 11px ${MONO}`, color: '#9a8f84', paddingLeft: 4 }}>
        <label style={{ cursor: 'pointer' }}><input type="checkbox" checked={srcMem} onChange={e => setSrcMem(e.target.checked)} /> curated memory</label>
        <label style={{ cursor: 'pointer' }}><input type="checkbox" checked={srcTx} onChange={e => setSrcTx(e.target.checked)} /> transcripts</label>
        {res && <span style={{ marginLeft: 'auto', color: '#7a716a' }}>{res.length} hit{res.length === 1 ? '' : 's'} for “{ran}”</span>}
      </div>

      {res === null && <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: '#7a716a' }}>
        Ask your past self. Curated memory captures the <em>why</em> (decisions, conventions); transcripts hold the full record. Try a topic, a filename, or a decision you half-remember.
      </div>}
      {res && res.length === 0 && <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: '#7a716a' }}>Nothing found for “{ran}”. Try fewer / different words, or enable transcripts.</div>}

      {memHits.length > 0 && <>
        <div style={{ font: `600 11px ${MONO}`, color: TYPE_COLOR.memory, letterSpacing: 0.5 }}>◆ CURATED MEMORY · {memHits.length}</div>
        {memHits.map((r, i) => <MemoryCard key={'m' + i} r={r} terms={terms} />)}
      </>}
      {txHits.length > 0 && <>
        <div style={{ font: `600 11px ${MONO}`, color: '#8a817a', letterSpacing: 0.5, marginTop: memHits.length ? 6 : 0 }}>◇ TRANSCRIPTS · {txHits.length}</div>
        {txHits.map((r, i) => <TranscriptCard key={'t' + i} r={r} terms={terms} />)}
      </>}
    </div>
  )
}
