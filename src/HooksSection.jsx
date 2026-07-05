import React, { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { api } from './api.js'

export default function HooksSection() {
  const [data, setData] = useState(null)
  const [scope, setScope] = useState('user')
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')

  const load = () => api.get('/api/hooks').then(d => {
    setData(d)
    setText(JSON.stringify(d[scope]?.settings?.hooks ?? {}, null, 2))
  })
  useEffect(() => { load() }, [])
  useEffect(() => { if (data) setText(JSON.stringify(data[scope]?.settings?.hooks ?? {}, null, 2)) }, [scope])

  const flash = m => { setStatus(m); setTimeout(() => setStatus(''), 4000) }
  const save = () => {
    let hooks
    try { hooks = JSON.parse(text) } catch (e) { return flash('invalid JSON: ' + e.message) }
    api.put('/api/hooks', { scope, hooks }).then(r => { flash('saved (backup made)'); load() }).catch(e => flash('error: ' + e.message))
  }

  const hooks = data?.[scope]?.settings?.hooks || {}
  const summary = Object.entries(hooks).flatMap(([event, groups]) =>
    (groups || []).flatMap((g, gi) => (g.hooks || []).map((h, hi) => ({ event, matcher: g.matcher, command: h.command, timeout: h.timeout, key: `${event}-${gi}-${hi}` })))
  )

  return (
    <div className="section">
      <div className="list-pane">
        <div className="list-head"><h2>Hooks <span className="muted">({summary.length})</span></h2></div>
        <div className="chips" style={{ marginBottom: 8 }}>
          {['user', 'project', 'local'].map(s => (
            <button key={s} className={'mini' + (scope === s ? ' active' : '')} onClick={() => setScope(s)}>
              {s}{data && data[s]?.settings === null ? ' (missing)' : ''}
            </button>
          ))}
        </div>
        <div className="rows">
          {summary.length === 0 && <p className="muted">no hooks in this scope</p>}
          {summary.map(h => (
            <div key={h.key} className="row">
              <div className="row-title">{h.event}{h.matcher ? <span className="badge project">{h.matcher}</span> : null}</div>
              <div className="row-desc mono">{h.command}</div>
              {h.timeout && <div className="row-meta">timeout: {h.timeout}s</div>}
            </div>
          ))}
        </div>
      </div>
      <div className="detail-pane">
        <div className="detail-head">
          <code className="path">{data?.[scope]?.path} → "hooks"</code>
          <div className="actions"><button onClick={save}>Save</button></div>
        </div>
        {status && <div className="status">{status}</div>}
        <CodeMirror value={text} height="100%" theme="dark" extensions={[json()]} onChange={setText} className="editor" />
      </div>
    </div>
  )
}
