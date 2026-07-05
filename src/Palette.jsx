import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'

const MONO = "'IBM Plex Mono', monospace"

// ⌘K palette: jump anywhere, run actions, full-text search chats (feature 16)
export default function Palette({ sections, onNav }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [items, setItems] = useState([]) // static-ish sources
  const [chatHits, setChatHits] = useState([])
  const inputRef = useRef(null)

  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); setQ(''); setIdx(0) }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    setTimeout(() => inputRef.current?.focus(), 30)
    Promise.allSettled([api.get('/api/overview'), api.get('/api/projects'), api.get('/api/gov/profiles')]).then(([ov, pr, pf]) => {
      const out = []
      for (const s of sections) out.push({ icon: s.icon, label: s.label, meta: 'section', run: () => onNav(s.id) })
      out.push({ icon: '＋', label: 'New chat session', meta: 'action', run: () => onNav('chat') })
      out.push({ icon: '⚗', label: 'Run harness evals', meta: 'action', run: () => api.post('/api/gov/evals/run', { scope: 'global' }).then(() => onNav('reliability')) })
      out.push({ icon: '⧖', label: 'Open dry-run', meta: 'action', run: () => onNav('harness') })
      out.push({ icon: '🏗', label: 'Scaffold a new project harness', meta: 'action', run: () => { onNav('projects'); window.dispatchEvent(new Event('open-scaffolder')) } })
      if (pf.status === 'fulfilled') for (const p of pf.value) out.push({ icon: '❒', label: `Apply profile: ${p.name}`, meta: 'action · asks scope in Library', run: () => onNav('library') })
      if (pr.status === 'fulfilled') for (const p of pr.value) out.push({ icon: '⊞', label: p.name, meta: 'project · ' + p.path, run: () => onNav('projects') })
      if (ov.status === 'fulfilled') {
        const nav = { skills: 'skills', commands: 'commands', agents: 'agents', mcp: 'mcp', templates: 'skills', plugins: 'overview' }
        for (const it of ov.value.items) out.push({ icon: { skills: '✦', commands: '⌘', agents: '◆', mcp: '⇌' }[it.kind] || '❒', label: it.name, meta: it.kind, run: () => onNav(nav[it.kind] || 'overview') })
      }
      setItems(out)
    })
  }, [open])

  useEffect(() => { // full-text chat search, debounced
    if (!open || q.length < 3) return setChatHits([])
    const t = setTimeout(() => api.get('/api/search?q=' + encodeURIComponent(q)).then(setChatHits).catch(() => {}), 250)
    return () => clearTimeout(t)
  }, [q, open])

  const results = useMemo(() => {
    const needle = q.toLowerCase()
    const ranked = !needle ? items.slice(0, 12) :
      items.map(it => ({ it, at: it.label.toLowerCase().indexOf(needle) })).filter(x => x.at >= 0)
        .sort((a, b) => a.at - b.at || a.it.label.length - b.it.label.length).slice(0, 10).map(x => x.it)
    const chats = chatHits.map(h => ({
      icon: '⌨', label: h.snippet, meta: `chat · ${h.proj.split('-').slice(-2).join('-')} · ${new Date(h.t).toLocaleDateString()}`,
      run: () => onNav('chat'),
    }))
    return [...ranked, ...chats]
  }, [items, q, chatHits])

  useEffect(() => { setIdx(0) }, [q])
  if (!open) return null

  const exec = it => { if (!it) return; setOpen(false); it.run() }
  return (
    <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(8,6,5,0.6)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', paddingTop: '12vh' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 620, maxWidth: '92vw', height: 'fit-content', maxHeight: '64vh', display: 'flex', flexDirection: 'column', background: '#17130f', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 16, boxShadow: '0 30px 80px rgba(0,0,0,0.7)', overflow: 'hidden' }}>
        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, results.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
            if (e.key === 'Enter') exec(results[idx])
          }}
          placeholder="Jump to a project, skill, agent, chat… or run an action"
          style={{ border: 'none', borderBottom: '1px solid rgba(255,255,255,0.07)', borderRadius: 0, background: 'transparent', padding: '15px 18px', font: "400 15px 'IBM Plex Sans'" }} />
        <div style={{ overflowY: 'auto' }}>
          {results.map((it, i) => (
            <div key={i} onMouseEnter={() => setIdx(i)} onClick={() => exec(it)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px', cursor: 'pointer', background: i === idx ? 'rgba(217,119,87,0.12)' : 'transparent' }}>
              <span style={{ width: 20, textAlign: 'center', fontSize: 14, opacity: 0.85 }}>{it.icon}</span>
              <span style={{ flex: 1, font: "400 13px 'IBM Plex Sans'", color: '#e5dbd2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
              <span style={{ font: `400 10px ${MONO}`, color: '#7a716a', flexShrink: 0, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.meta}</span>
            </div>
          ))}
          {results.length === 0 && <div style={{ padding: '18px 16px', font: `400 12px ${MONO}`, color: '#5a514a' }}>no matches{q.length < 3 ? ' — type 3+ chars to also search chat history' : ''}</div>}
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', font: `400 10px ${MONO}`, color: '#6a615a' }}>↑↓ navigate · ↵ open · esc close · ⌘K toggle</div>
      </div>
    </div>
  )
}
