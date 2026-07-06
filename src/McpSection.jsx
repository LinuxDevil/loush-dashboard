import React, { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { api } from './api.js'
import Drawer, { mcpConfigFrom, mcpValuesFrom } from './Drawer.jsx'

export default function McpSection() {
  const [servers, setServers] = useState([])
  const [sel, setSel] = useState(null)
  const [text, setText] = useState('')
  const [tests, setTests] = useState({}) // name -> {state:'testing'|'ok'|'fail', ...result}
  const [status, setStatus] = useState('')
  const [drawer, setDrawer] = useState(null)

  const load = () => api.get('/api/mcp').then(setServers)
  useEffect(() => { load() }, [])
  const flash = m => { setStatus(m); setTimeout(() => setStatus(''), 4000) }
  const key = s => s.scope + ':' + (s.project || '') + ':' + s.name

  const select = s => { setSel(s); setText(JSON.stringify(s.config, null, 2)) }
  const test = async s => {
    setTests(t => ({ ...t, [key(s)]: { state: 'testing' } }))
    const r = await api.post(`/api/mcp/${encodeURIComponent(s.name)}/test`, { config: s.config }).catch(e => ({ ok: false, error: e.message }))
    // 401/403 = reachable but needs OAuth — not a healthy "connected"; show it distinctly, not green.
    const state = r.ok ? (r.status === 401 || r.status === 403 ? 'auth' : 'ok') : 'fail'
    setTests(t => ({ ...t, [key(s)]: { state, ...r } }))
  }
  const save = () => {
    let config
    try { config = JSON.parse(text) } catch (e) { return flash('invalid JSON: ' + e.message) }
    api.put(`/api/mcp/${encodeURIComponent(sel.name)}`, { config, project: sel.project })
      .then(r => { flash('saved, backup made'); load() }).catch(e => flash('error: ' + e.message))
  }
  const drawerSave = async values => {
    const config = mcpConfigFrom(values)
    if (drawer.mode === 'create')
      return api.post('/api/mcp', { name: values.name, config }).then(() => { setDrawer(null); load() }).catch(e => flash('error: ' + e.message))
    if (values.name && values.name !== sel.name) { // rename: server keys off :name, so recreate + delete old (user scope)
      if (sel.project) return flash('rename not supported for project-scoped servers')
      try {
        await api.post('/api/mcp', { name: values.name, config })
        await api.del(`/api/mcp/${encodeURIComponent(sel.name)}`)
        setDrawer(null); flash('renamed, backup made'); setSel(null); load()
      } catch (e) { flash('error: ' + e.message) }
      return
    }
    return api.put(`/api/mcp/${encodeURIComponent(sel.name)}`, { config, project: sel.project })
      .then(() => { setDrawer(null); flash('saved, backup made'); setSel({ ...sel, config }); setText(JSON.stringify(config, null, 2)); load() }).catch(e => flash('error: ' + e.message))
  }
  const remove = s => {
    if (!confirm(`Remove MCP server "${s.name}"? ~/.claude.json is backed up first.`)) return
    api.del(`/api/mcp/${encodeURIComponent(s.name)}${s.project ? '?project=' + encodeURIComponent(s.project) : ''}`)
      .then(() => { setSel(null); load() }).catch(e => flash('error: ' + e.message))
  }

  return (
    <div className="section">
      <div className="list-pane">
        <div className="list-head"><h2>MCP Servers <span className="muted">({servers.length})</span></h2><button className="primary" onClick={() => setDrawer({ mode: 'create' })}>+ New</button></div>
        <div className="rows">
          {servers.length === 0 && <p className="muted center" style={{ padding: 20 }}>no MCP servers configured — click “+ New” to add one</p>}
          {servers.map(s => {
            const t = tests[key(s)]
            return (
              <div key={key(s)} className={'row' + (sel && key(sel) === key(s) ? ' selected' : '')} onClick={() => select(s)}>
                <div className="row-title">
                  <span className={'dot ' + (t?.state || 'unknown')} title={t?.state || 'untested'} />
                  {s.name} <span className={'badge ' + s.scope}>{s.scope}</span>
                </div>
                <div className="row-desc">{s.config.url || [s.config.command, ...(s.config.args || [])].join(' ')}</div>
                {s.project && <div className="row-meta">{s.project}</div>}
                {t && t.state !== 'testing' && (
                  <div className="row-meta" style={t.state === 'auth' ? { color: '#e5a03a' } : undefined}>{t.state === 'ok' ? `connected ${t.ms}ms${t.serverInfo ? ' — ' + t.serverInfo.name + ' ' + (t.serverInfo.version || '') : ''}${t.status ? ' (HTTP ' + t.status + ')' : ''}` : t.state === 'auth' ? `reachable — needs auth (HTTP ${t.status})` : `failed: ${t.error || 'HTTP ' + t.status}`}</div>
                )}
                <button className="mini" onClick={e => { e.stopPropagation(); test(s) }} disabled={t?.state === 'testing'}>
                  {t?.state === 'testing' ? 'testing…' : 'Test connection'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
      <div className="detail-pane">
        {!sel ? <p className="muted center">select a server</p> : (
          <>
            <div className="detail-head">
              <code className="path">~/.claude.json → {sel.project ? `projects["${sel.project}"].mcpServers` : 'mcpServers'}.{sel.name}</code>
              <div className="actions">
                <button onClick={() => setDrawer({ mode: 'edit' })}>Edit fields</button>
                <button className="primary" onClick={save}>Save</button>
                <button className="danger" onClick={() => remove(sel)}>Delete</button>
              </div>
            </div>
            {status && <div className="status">{status}</div>}
            <CodeMirror value={text} height="100%" theme="dark" extensions={[json()]} onChange={setText} className="editor" />
          </>
        )}
      </div>
      <Drawer
        open={!!drawer} mode={drawer?.mode} kind="mcp"
        initial={drawer?.mode === 'edit' ? mcpValuesFrom(sel.name, sel.config) : null}
        onSave={drawerSave} onClose={() => setDrawer(null)}
        extraNote="Written to ~/.claude.json (backed up first)."
      />
    </div>
  )
}
