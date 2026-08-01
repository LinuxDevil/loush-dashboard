import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, toast } from '../lib/api.js'

const MONO = "var(--mono)"

// ---------- 16: search my past self ----------
const KINDS = [
  ['prompt', 'my prompts', '⌨', 'var(--accent)'],
  ['assistant', 'what Claude said', '✦', 'var(--violet)'],
  ['bash', 'commands run', '$', 'var(--green)'],
  ['edit', 'edit hunks', '±', 'var(--blue)'],
  ['session', 'sessions', '◧', 'var(--accent-light)'],
]
const KIND_META = Object.fromEntries(KINDS.map(k => [k[0], k]))

export default function Palette({ sections, onNav }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [file, setFile] = useState('')
  const [kinds, setKinds] = useState({})
  const [idx, setIdx] = useState(0)
  const [items, setItems] = useState([])
  const [hits, setHits] = useState([])
  const [busy, setBusy] = useState(false)
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
      out.push({ icon: '⚗', label: 'Run harness evals', meta: 'action', run: () => api.post('/api/gov/evals/run', { scope: 'global' }).then(() => onNav('harness')) })
      out.push({ icon: '🏗', label: 'Scaffold a new project harness', meta: 'action', run: () => { onNav('projects'); window.dispatchEvent(new Event('open-scaffolder')) } })
      if (pf.status === 'fulfilled') for (const p of pf.value) out.push({ icon: '❒', label: `Apply profile: ${p.name}`, meta: 'action · asks scope in Library', run: () => onNav('harness') })
      if (pr.status === 'fulfilled') for (const p of pr.value) out.push({ icon: '⊞', label: p.name, meta: 'project · ' + p.path, run: () => onNav('projects') })
      if (ov.status === 'fulfilled') {
        for (const it of ov.value.items) out.push({ icon: { skills: '✦', commands: '⌘', agents: '◆', mcp: '⇌' }[it.kind] || '❒', label: it.name, meta: it.kind, run: () => onNav('capabilities') })
      }
      setItems(out)
    })
  }, [open])

  const kindQs = useMemo(() => { const on = Object.keys(kinds).filter(k => kinds[k]); return on.length ? on.join(',') : 'all' }, [kinds])
  useEffect(() => {
    if (!open || (q.length < 3 && !file)) { setHits([]); return }
    setBusy(true)
    const t = setTimeout(() => {
      api.get(`/api/search?q=${encodeURIComponent(q)}&file=${encodeURIComponent(file)}&kind=${kindQs}&limit=30`)
        .then(setHits).catch(() => setHits([])).finally(() => setBusy(false))
    }, 250)
    return () => { clearTimeout(t); setBusy(false) }
  }, [q, file, kindQs, open])

  const results = useMemo(() => {
    const needle = q.toLowerCase()
    const ranked = file ? [] : !needle ? items.slice(0, 10) :
      items.map(it => ({ it, at: it.label.toLowerCase().indexOf(needle) })).filter(x => x.at >= 0)
        .sort((a, b) => a.at - b.at || a.it.label.length - b.it.label.length).slice(0, 6).map(x => x.it)
    return [...ranked, ...hits.map(h => ({ hit: h }))]
  }, [items, q, hits, file])

  useEffect(() => { setIdx(0) }, [q, file, kindQs])
  if (!open) return null

  const copyResume = h => { navigator.clipboard.writeText(h.resume).catch(() => {}); toast('copied: ' + h.resume, 'success') }
  const exec = r => {
    if (!r) return
    if (r.run) { setOpen(false); return r.run() }
    copyResume(r.hit)
  }

  return (
    <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'var(--bg-base)', display: 'flex', justifyContent: 'center', paddingTop: '10vh' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 700, maxWidth: '94vw', height: 'fit-content', maxHeight: '76vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, boxShadow: 'var(--shadow-md)', overflow: 'hidden' }}>
        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, results.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
            if (e.key === 'Enter') exec(results[idx])
          }}
          placeholder="Search everything Claude ever said, ran or edited — or jump to a section"
          style={{ border: 'none', borderBottom: '1px solid var(--border-default)', borderRadius: 0, background: 'transparent', padding: '15px 18px', font: "400 14px var(--body)" }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderBottom: '1px solid var(--border-default)', flexWrap: 'wrap' }}>
          {KINDS.map(([id, label, icon, color]) => (
            <button key={id} onClick={() => setKinds(k => ({ ...k, [id]: !k[id] }))} title={label}
              style={{ marginTop: 0, cursor: 'pointer', font: `600 11px ${MONO}`, padding: '4px 9px', borderRadius: 8, border: `1px solid ${kinds[id] ? color + '77' : 'var(--bg-surface-hover)'}`, background: kinds[id] ? color + '1f' : 'transparent', color: kinds[id] ? color : 'var(--text-tertiary)' }}>
              {icon} {label}
            </button>
          ))}
          <input value={file} onChange={e => setFile(e.target.value)} placeholder="only sessions that touched <path>…"
            title="the killer query: what has Claude ever done to src/auth.ts"
            style={{ marginLeft: 'auto', width: 250, padding: '5px 9px', font: `400 11px ${MONO}`, border: `1px solid ${file ? 'var(--blue)' : 'var(--bg-surface-active)'}` }} />
        </div>

        <div style={{ overflowY: 'auto' }}>
          {results.map((r, i) => {
            const sel = i === idx
            if (r.run) return (
              <div key={'a' + i} onMouseEnter={() => setIdx(i)} onClick={() => exec(r)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px', cursor: 'pointer', background: sel ? 'var(--accent-bg)' : 'transparent' }}>
                <span style={{ width: 20, textAlign: 'center', fontSize: 14, opacity: 0.85 }}>{r.icon}</span>
                <span style={{ flex: 1, font: "400 13px var(--body)", color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', flexShrink: 0 }}>{r.meta}</span>
              </div>
            )
            const h = r.hit
            const [, , icon, color] = KIND_META[h.kind] || ['', '', '·', 'var(--text-secondary)']
            return (
              <div key={'h' + i} onMouseEnter={() => setIdx(i)} onClick={() => exec(r)}
                style={{ display: 'flex', gap: 11, padding: '10px 16px', cursor: 'pointer', background: sel ? 'var(--accent-bg)' : 'transparent', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ width: 18, flexShrink: 0, textAlign: 'center', font: `600 12px ${MONO}`, color }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: `400 12px ${h.kind === 'bash' || h.kind === 'edit' ? MONO : "var(--body)"}`, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.snippet}</div>
                  <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color }}>{h.kind}</span>
                    <span>{h.proj?.split('-').slice(-2).join('-')}</span>
                    {h.branch && <span style={{ color: 'var(--violet)' }}>{h.branch}</span>}
                    <span>{new Date(h.t).toLocaleDateString()}</span>
                    {h.file && <span style={{ color: 'var(--blue)' }}>{h.file}{h.add != null ? ` +${h.add}/−${h.del}` : ''}</span>}
                    {!h.file && h.files?.length > 0 && <span style={{ color: 'var(--blue)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 300, whiteSpace: 'nowrap' }}>{h.files.join(' · ')}</span>}
                  </div>
                </div>
                <button className="mini" style={{ marginTop: 0, flexShrink: 0 }} onClick={e => { e.stopPropagation(); copyResume(h) }} title={h.resume}>↵ resume</button>
              </div>
            )
          })}
          {results.length === 0 && (
            <div style={{ padding: '18px 16px', font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>
              {busy ? 'searching transcripts…' : q.length < 3 && !file ? 'type 3+ chars — or put a path in the file box to see every session that touched it' : 'no matches'}
            </div>
          )}
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border-default)', font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>
          ↑↓ navigate · ↵ open / copy the resume line · esc close · ⌘K toggle · everything here is your own machine's transcripts
        </div>
      </div>
    </div>
  )
}
