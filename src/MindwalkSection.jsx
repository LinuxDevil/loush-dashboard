import React, { useEffect, useState } from 'react'

// mindwalk serves its own React/Three.js UI from a Go binary — we start it and iframe it.
export default function MindwalkSection() {
  const [source, setSource] = useState('claude')
  const [state, setState] = useState({ loading: true })

  useEffect(() => {
    let cancelled = false
    setState({ loading: true })
    fetch('/api/mindwalk/serve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    })
      .then(r => r.json())
      .then(d => { if (!cancelled) setState(d.ok ? { port: d.port } : { error: d.error }) })
      .catch(e => { if (!cancelled) setState({ error: String(e) }) })
    return () => { cancelled = true }
  }, [source])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {['claude', 'cursor'].map(s => (
          <button key={s} className={'chip' + (source === s ? ' active' : '')} onClick={() => setSource(s)}>
            {s === 'claude' ? 'Claude Code' : 'Cursor'}
          </button>
        ))}
        {state.port && (
          <a className="chip" href={`http://127.0.0.1:${state.port}/`} target="_blank" rel="noreferrer">Open in tab ↗</a>
        )}
      </div>

      {state.loading && <div className="muted">Starting mindwalk{source === 'cursor' ? ' — transcoding Cursor sessions, this takes a few seconds' : ''}…</div>}

      {state.error && (
        <div className="card" style={{ padding: 16 }}>
          <b>mindwalk unavailable</b>
          <div className="muted" style={{ marginTop: 6 }}>{state.error}</div>
          <pre style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>curl -fsSL https://raw.githubusercontent.com/cosmtrek/mindwalk/master/scripts/install.sh | sh</pre>
        </div>
      )}

      {state.port && (
        <iframe
          title="mindwalk"
          src={`http://127.0.0.1:${state.port}/`}
          style={{ flex: 1, minHeight: 640, width: '100%', border: '1px solid var(--line, #222)', borderRadius: 8, background: '#000' }}
        />
      )}
    </div>
  )
}
