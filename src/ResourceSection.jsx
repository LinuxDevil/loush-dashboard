import React, { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { marked } from 'marked'
import { api, fmtDate } from './api.js'
import Drawer, { SPECS, serializeFM } from './Drawer.jsx'
import { usePager } from './Pager.jsx'

function FrontmatterTable({ fm }) {
  const keys = Object.keys(fm || {})
  if (!keys.length) return <p className="muted">no frontmatter</p>
  return (
    <table className="kv">
      <tbody>
        {keys.map(k => (
          <tr key={k}><td>{k}</td><td>{Array.isArray(fm[k]) ? fm[k].join(', ') : String(fm[k])}</td></tr>
        ))}
      </tbody>
    </table>
  )
}

function Preview({ kind, detail }) {
  const [args, setArgs] = useState('')
  if (!detail) return null
  const { fm, body } = detail
  return (
    <div className="preview">
      <h3>Frontmatter</h3>
      <FrontmatterTable fm={fm} />
      {kind === 'skills' && fm?.description && (
        <><h3>Test run — what triggers this skill</h3>
          <p className="trigger-box">Claude invokes this skill when the request matches:<br /><em>{fm.description}</em></p></>
      )}
      {kind === 'commands' && (
        <><h3>Test run — expansion</h3>
          <input placeholder="type arguments…" value={args} onChange={e => setArgs(e.target.value)} />
          <pre className="expansion">{(body || '').replaceAll('$ARGUMENTS', args || '$ARGUMENTS')}</pre></>
      )}
      {kind === 'agents' && fm?.tools && (
        <><h3>Tools</h3>
          <div className="chips">{String(fm.tools).split(',').map(t => <span className="chip" key={t}>{t.trim()}</span>)}</div></>
      )}
      <h3>Rendered body</h3>
      <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(body || '') }} />
      {detail.assets?.length > 0 && (
        <><h3>Supporting assets</h3>
          <ul>{detail.assets.map(a => <li key={a}><code>{a}</code></li>)}</ul></>
      )}
    </div>
  )
}

export default function ResourceSection({ kind, title }) {
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null) // {scope, name}
  const [detail, setDetail] = useState(null)
  const [content, setContent] = useState('')
  const [tab, setTab] = useState('edit')
  const [status, setStatus] = useState('')
  const [drawer, setDrawer] = useState(null) // {mode:'create'|'edit'}

  const load = () => api.get(`/api/res/${kind}`).then(setItems)
  useEffect(() => { load() }, [kind])
  useEffect(() => {
    if (!sel) return setDetail(null)
    api.get(`/api/res/${kind}/item?scope=${sel.scope}&name=${encodeURIComponent(sel.name)}`)
      .then(d => { setDetail(d); setContent(d.content); setStatus('') })
      .catch(e => setStatus(e.message))
  }, [sel])

  const flash = m => { setStatus(m); setTimeout(() => setStatus(''), 3000) }
  const save = () =>
    api.put(`/api/res/${kind}/item?scope=${sel.scope}&name=${encodeURIComponent(sel.name)}`, { content })
      .then(r => { flash(`saved (backup: ${r.backup ? '✓' : 'none'})`); load(); setDetail(d => ({ ...d, ...parseClient(content) })) })
      .catch(e => flash('error: ' + e.message))
  const fmToDrawerValues = fm => {
    const v = {}
    for (const f of SPECS[kind].fields) {
      const x = fm?.[f.k]
      if (x === undefined || x === null) continue
      v[f.k] = f.list && Array.isArray(x) ? x.join(', ') : String(x)
    }
    return v
  }
  const drawerSave = values => {
    const fmBlock = serializeFM(values, SPECS[kind])
    if (drawer.mode === 'create') {
      const body = SPECS[kind].defaultBody(values.name)
      return api.post(`/api/res/${kind}`, { name: values.name, scope: 'user', content: fmBlock + '\n' + body })
        .then(() => { setDrawer(null); load(); setSel({ scope: 'user', name: values.name }) })
    }
    // edit: swap only the frontmatter block, keep the (possibly unsaved) body from the editor
    const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content)
    const newContent = fmBlock + (m ? content.slice(m[0].length) : content)
    return api.put(`/api/res/${kind}/item?scope=${sel.scope}&name=${encodeURIComponent(sel.name)}`, { content: newContent })
      .then(r => {
        setDrawer(null); flash(`fields saved (backup: ${r.backup ? '✓' : 'none'})`); load()
        return api.get(`/api/res/${kind}/item?scope=${sel.scope}&name=${encodeURIComponent(sel.name)}`).then(d => { setDetail(d); setContent(d.content) })
      })
  }
  const remove = () => {
    if (!confirm(`Delete ${sel.name}? A timestamped backup is made first in ~/.claude/dashboard-backups.`)) return
    api.del(`/api/res/${kind}/item?scope=${sel.scope}&name=${encodeURIComponent(sel.name)}`)
      .then(r => { flash('deleted, backup at ' + r.backup); setSel(null); load() }).catch(e => flash('error: ' + e.message))
  }
  // ponytail: client-side frontmatter re-parse for live preview is naive (no YAML lib) — server stays authoritative
  const parseClient = src => {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src)
    if (!m) return { body: src }
    return { body: src.slice(m[0].length) }
  }

  const filtered = items.filter(i => (i.name + ' ' + i.description).toLowerCase().includes(q.toLowerCase()))
  const { slice, pager } = usePager(filtered, 20)
  return (
    <div className="section">
      <div className="list-pane">
        <div className="list-head">
          <h2>{title} <span className="muted">({items.length})</span></h2>
          <button className="primary" onClick={() => setDrawer({ mode: 'create' })}>+ New</button>
        </div>
        <input placeholder="search…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="rows">
          {slice.map(i => (
            <div key={i.scope + i.name} className={'row' + (sel && sel.name === i.name && sel.scope === i.scope ? ' selected' : '')} onClick={() => setSel({ scope: i.scope, name: i.name })}>
              <div className="row-title">{i.name} <span className={'badge ' + i.scope}>{i.scope}</span></div>
              <div className="row-desc">{i.description}</div>
              <div className="row-meta">{fmtDate(i.mtime)}</div>
            </div>
          ))}
        </div>
        {pager}
      </div>
      <div className="detail-pane">
        {!sel ? <p className="muted center">select an item</p> : !detail ? <p className="muted center">{status || 'loading…'}</p> : (
          <>
            <div className="detail-head">
              <code className="path">{detail.path}</code>
              <div className="actions">
                <button className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>Edit</button>
                <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>Preview</button>
                <button onClick={() => setDrawer({ mode: 'edit' })}>Edit fields</button>
                <button className="primary" onClick={save} disabled={content === detail.content}>Save</button>
                <button className="danger" onClick={remove}>Delete</button>
              </div>
            </div>
            {status && <div className="status">{status}</div>}
            {tab === 'edit'
              ? <CodeMirror value={content} height="100%" theme="dark" extensions={[markdown()]} onChange={setContent} className="editor" />
              : <Preview kind={kind} detail={{ ...detail, ...parseClient(content) }} />}
          </>
        )}
      </div>
      <Drawer
        open={!!drawer} mode={drawer?.mode} kind={kind}
        initial={drawer?.mode === 'edit' ? { ...fmToDrawerValues(detail?.fm), name: sel?.name } : null}
        onSave={drawerSave} onClose={() => setDrawer(null)}
      />
    </div>
  )
}
