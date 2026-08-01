import React, { useEffect, useRef, useState } from 'react'
import { createEditorHost } from '../lib/editorHost.js'

// 076: a text editor driven by the EditorHost contract.
//
// The load-bearing rule is that content NEVER lives in React state. The textarea's DOM value is
// the single source of truth; the host pushes into it via `applyContent` and pulls out of it via
// `getCurrentContent`. Putting the text in state instead means every keystroke re-renders, and a
// watcher event or a slow save that lands mid-typing overwrites what the user is in the middle of
// writing — which is the failure this whole contract exists to prevent.
//
// What IS in React state is the host's own status (dirty / saving / error) and its notices. Those
// change rarely and are what the chrome renders.

const MONO = 'var(--mono)'

export default function EditableView({ path, initialContent = '', onSaved }) {
  const taRef = useRef(null)
  const hostRef = useRef(null)
  const [st, setSt] = useState(null)

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    const host = createEditorHost({
      path,
      adapter: {
        applyContent: text => { if (taRef.current) taRef.current.value = text ?? '' },
        getCurrentContent: () => (taRef.current ? taRef.current.value : ''),
        // No setTheme: the textarea inherits the app's CSS variables. The host reports this as a
        // degraded capability rather than pretending it applied.
      },
      io: {
        read: async p => {
          const r = await fetch('/api/artifacts/content?path=' + encodeURIComponent(p))
          const j = await r.json()
          if (!r.ok) return { ok: false, reason: j.error || `HTTP ${r.status}` }
          return { ok: true, content: j.content }
        },
        write: async (p, content) => {
          // expectedMtimeMs is the lost-update guard: the server refuses if the file moved under
          // us, rather than overwriting whatever landed there since we loaded it.
          const r = await fetch('/api/artifacts/content?path=' + encodeURIComponent(p), {
            method: 'PUT', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ content, expectedMtimeMs: hostRef.current?._mtime ?? undefined }),
          })
          const j = await r.json()
          if (!r.ok) return { ok: false, reason: j.detail || j.error || `HTTP ${r.status}` }
          // The post-write stat is what makes echo detection possible: a watcher event whose stat
          // matches this one is our own save, not somebody else's edit.
          if (hostRef.current) hostRef.current._mtime = j.mtimeMs
          return { ok: true, stat: { mtimeMs: j.mtimeMs, size: j.size } }
        },
      },
      onChange: setSt,
    })
    hostRef.current = host
    if (initialContent) host.applyLoaded?.(initialContent)
    host.load?.()
    setSt(host.getState())
    return () => host.dispose?.()
  }, [path])

  const save = async () => {
    const r = await hostRef.current?.save?.()
    setSt(hostRef.current?.getState?.() ?? null)
    if (r?.ok && onSaved) onSaved()
  }

  const notices = st?.notices || []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 8px', font: `400 11px ${MONO}` }}>
        <span style={{ color: st?.dirty ? 'var(--amber)' : 'var(--text-tertiary)' }}>
          {st?.status === 'saving' ? 'saving…' : st?.dirty ? 'unsaved changes' : 'saved'}
        </span>
        {st?.reason && <span style={{ color: 'var(--red)' }}>{st.reason}</span>}
        <button className="mini" style={{ marginTop: 0, marginLeft: 'auto' }} disabled={!st?.dirty || st?.status === 'saving'} onClick={save}>save</button>
      </div>
      {/* Every suppressed, capped or degraded thing the host recorded. These are exactly the
          events a quieter implementation would swallow — an echo it could not prove was an echo,
          a capability the adapter does not implement. */}
      {notices.map((n, i) => (
        <div key={i} className="small" style={{ color: n.level === 'warn' ? 'var(--amber)' : 'var(--text-secondary)', padding: '0 8px' }}>{n.text}</div>
      ))}
      <textarea ref={taRef} defaultValue={initialContent}
        onInput={() => { hostRef.current?.markDirty?.(); setSt(hostRef.current?.getState?.() ?? null) }}
        spellCheck={false}
        style={{ flex: 1, minHeight: 240, resize: 'none', fontFamily: 'var(--mono)', fontSize: 12, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', padding: 8 }} />
    </div>
  )
}
