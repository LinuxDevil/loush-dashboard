import React, { useEffect, useMemo, useState } from 'react'
import { api, fmtDate, fmtSize } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import { Viewer, typeIcon } from '../ui/viewers.jsx'
import { usePager } from '../ui/Pager.jsx'

export default function ArtifactsSection() {
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [group, setGroup] = useState('')
  const [sort, setSort] = useState('date')
  const [sel, setSel] = useState(null)
  const [raw, setRaw] = useState(false)
  const [status, setStatus] = useState('')

  const [loaded, setLoaded] = useState(false)
  const load = () => api.get('/api/artifacts').then(d => { setItems(d); setLoaded(true) })
  useEffect(() => { load() }, [])
  const flash = m => { setStatus(m); setTimeout(() => setStatus(''), 4000) }

  const types = useMemo(() => [...new Set(items.map(i => i.ext).filter(Boolean))].sort(), [items])
  const groups = useMemo(() => [...new Set(items.map(i => i.group))].sort(), [items])
  const filtered = useMemo(() => {
    let r = items.filter(i =>
      (!q || (i.name + ' ' + i.path).toLowerCase().includes(q.toLowerCase())) &&
      (!type || i.ext === type) && (!group || i.group === group))
    r.sort(sort === 'date' ? (a, b) => b.mtime - a.mtime : sort === 'type' ? (a, b) => a.ext.localeCompare(b.ext) : (a, b) => a.name.localeCompare(b.name))
    return r
  }, [items, q, type, group, sort])
  const { slice, pager } = usePager(filtered, 60)

  if (!loaded) return <Skeleton tiles={0} rows={8} />

  const act = {
    reveal: () => api.post('/api/artifacts/reveal', { path: sel.path }),
    copyPath: () => { navigator.clipboard.writeText(sel.path); flash('path copied') },
    download: () => window.open('/api/artifacts/download?path=' + encodeURIComponent(sel.path)),
    rename: () => {
      const newName = prompt('New filename:', sel.name)
      if (!newName || newName === sel.name) return
      api.post('/api/artifacts/rename', { path: sel.path, newName })
        .then(r => { flash('renamed'); setSel({ ...sel, path: r.path, name: newName }); load() }).catch(e => flash('error: ' + e.message))
    },
    remove: () => {
      if (!confirm(`Delete ${sel.name}? A timestamped backup is made first.`)) return
      api.del('/api/artifacts?path=' + encodeURIComponent(sel.path))
        .then(r => { flash('deleted, backup at ' + r.backup); setSel(null); load() }).catch(e => flash('error: ' + e.message))
    },
  }

  return (
    <div className="section artifacts">
      <div className="list-pane wide">
        <div className="list-head"><h2>Artifacts <span className="muted">({filtered.length}/{items.length})</span></h2></div>
        <div className="filters">
          <input placeholder="search filename or path…" value={q} onChange={e => setQ(e.target.value)} />
          <select value={type} onChange={e => setType(e.target.value)}><option value="">all types</option>{types.map(t => <option key={t}>{t}</option>)}</select>
          <select value={group} onChange={e => setGroup(e.target.value)}><option value="">all groups</option>{groups.map(g => <option key={g}>{g}</option>)}</select>
          <select value={sort} onChange={e => setSort(e.target.value)}><option value="date">by date</option><option value="type">by type</option><option value="name">by name</option></select>
        </div>
        <div className="grid">
          {filtered.length === 0 && <p className="muted center" style={{ padding: 20, gridColumn: '1 / -1' }}>{items.length ? 'no artifacts match your filter' : 'no artifacts yet'}</p>}
          {slice.map(i => (
            <div key={i.path} className={'card' + (sel?.path === i.path ? ' selected' : '')} onClick={() => { setSel(i); setRaw(false) }} title={i.path}>
              <div className="card-icon">{typeIcon(i.ext)}</div>
              <div className="card-name">{i.name}</div>
              <div className="card-meta">{i.group} · {fmtSize(i.size)}</div>
              <div className="card-meta">{fmtDate(i.mtime)}</div>
            </div>
          ))}
        </div>
        {pager}
      </div>
      <div className="detail-pane">
        {!sel ? <p className="muted center">select an artifact</p> : (
          <>
            <div className="detail-head">
              <code className="path">{sel.path}</code>
              <div className="actions">
                <button className={!raw ? 'active' : ''} onClick={() => setRaw(false)}>Rendered</button>
                <button className={raw ? 'active' : ''} onClick={() => setRaw(true)}>Source</button>
                <button onClick={act.reveal}>Reveal</button>
                <button onClick={act.copyPath}>Copy path</button>
                <button onClick={act.download}>Download</button>
                <button onClick={act.rename}>Rename</button>
                <button className="danger" onClick={act.remove}>Delete</button>
              </div>
            </div>
            {status && <div className="status">{status}</div>}
            <div className="viewer-body"><Viewer item={sel} raw={raw} /></div>
          </>
        )}
      </div>
    </div>
  )
}
