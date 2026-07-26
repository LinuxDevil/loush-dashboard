import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, toast } from '../lib/api.js'

const MONO = "'IBM Plex Mono', monospace"

// ---------- 16: search my past self ----------
// ⌘K used to index user PROMPTS only. It now searches assistant text, tool_use inputs (bash commands,
// file paths touched) and Edit hunks — and carries the killer filter: `file:src/auth.ts` answers
// "what has Claude ever done to this file", the query the IC most wants and literally could not express.
// Plane B: this machine's own transcripts. No user/machine parameter exists on /api/search.
const KINDS = [
  ['prompt', 'my prompts', '⌨', '#d97757'],
  ['assistant', 'what Claude said', '✦', '#8b7cf6'],
  ['bash', 'commands run', '$', '#3fb96a'],
  ['edit', 'edit hunks', '±', '#5eb3f6'],
  ['session', 'sessions', '◧', '#e8a06a'],
]
const KIND_META = Object.fromEntries(KINDS.map(k => [k[0], k]))

export default function Palette({ sections, onNav }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [file, setFile] = useState('')
  const [kinds, setKinds] = useState({})   // {} = all
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

  // transcript search — debounced. `file:` narrows to sessions that touched that path.
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
    // when a file filter is on, the transcript hits ARE the query — do not dilute them with section jumps
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
    copyResume(r.hit)   // Enter on a transcript hit = get me back into that session
  }

  return (
    <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(8,6,5,0.6)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', paddingTop: '10vh' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 700, maxWidth: '94vw', height: 'fit-content', maxHeight: '76vh', display: 'flex', flexDirection: 'column', background: '#17130f', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 16, boxShadow: '0 30px 80px rgba(0,0,0,0.7)', overflow: 'hidden' }}>
        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, results.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
            if (e.key === 'Enter') exec(results[idx])
          }}
          placeholder="Search everything Claude ever said, ran or edited — or jump to a section"
          style={{ border: 'none', borderBottom: '1px solid rgba(255,255,255,0.07)', borderRadius: 0, background: 'transparent', padding: '15px 18px', font: "400 15px 'IBM Plex Sans'" }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
          {KINDS.map(([id, label, icon, color]) => (
            <button key={id} onClick={() => setKinds(k => ({ ...k, [id]: !k[id] }))} title={label}
              style={{ marginTop: 0, cursor: 'pointer', font: `600 10.5px ${MONO}`, padding: '4px 9px', borderRadius: 8, border: `1px solid ${kinds[id] ? color + '77' : 'rgba(255,255,255,0.07)'}`, background: kinds[id] ? color + '1f' : 'transparent', color: kinds[id] ? color : '#6a615a' }}>
              {icon} {label}
            </button>
          ))}
          <input value={file} onChange={e => setFile(e.target.value)} placeholder="only sessions that touched <path>…"
            title="the killer query: what has Claude ever done to src/auth.ts"
            style={{ marginLeft: 'auto', width: 250, padding: '5px 9px', font: `400 11px ${MONO}`, border: `1px solid ${file ? '#5eb3f6' : 'rgba(255,255,255,0.08)'}` }} />
        </div>

        <div style={{ overflowY: 'auto' }}>
          {results.map((r, i) => {
            const sel = i === idx
            if (r.run) return (
              <div key={'a' + i} onMouseEnter={() => setIdx(i)} onClick={() => exec(r)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px', cursor: 'pointer', background: sel ? 'rgba(217,119,87,0.12)' : 'transparent' }}>
                <span style={{ width: 20, textAlign: 'center', fontSize: 14, opacity: 0.85 }}>{r.icon}</span>
                <span style={{ flex: 1, font: "400 13px 'IBM Plex Sans'", color: '#e5dbd2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                <span style={{ font: `400 10px ${MONO}`, color: '#7a716a', flexShrink: 0 }}>{r.meta}</span>
              </div>
            )
            const h = r.hit
            const [, , icon, color] = KIND_META[h.kind] || ['', '', '·', '#8a807a']
            return (
              <div key={'h' + i} onMouseEnter={() => setIdx(i)} onClick={() => exec(r)}
                style={{ display: 'flex', gap: 11, padding: '10px 16px', cursor: 'pointer', background: sel ? 'rgba(217,119,87,0.12)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <span style={{ width: 18, flexShrink: 0, textAlign: 'center', font: `600 12px ${MONO}`, color }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: `400 12px ${h.kind === 'bash' || h.kind === 'edit' ? MONO : "'IBM Plex Sans'"}`, color: '#e5dbd2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.snippet}</div>
                  <div style={{ font: `400 10px ${MONO}`, color: '#6a615a', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color }}>{h.kind}</span>
                    <span>{h.proj?.split('-').slice(-2).join('-')}</span>
                    {h.branch && <span style={{ color: '#8b7cf6' }}>{h.branch}</span>}
                    <span>{new Date(h.t).toLocaleDateString()}</span>
                    {h.file && <span style={{ color: '#5eb3f6' }}>{h.file}{h.add != null ? ` +${h.add}/−${h.del}` : ''}</span>}
                    {!h.file && h.files?.length > 0 && <span style={{ color: '#5eb3f6', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 300, whiteSpace: 'nowrap' }}>{h.files.join(' · ')}</span>}
                  </div>
                </div>
                <button className="mini" style={{ marginTop: 0, flexShrink: 0 }} onClick={e => { e.stopPropagation(); copyResume(h) }} title={h.resume}>↵ resume</button>
              </div>
            )
          })}
          {results.length === 0 && (
            <div style={{ padding: '18px 16px', font: `400 12px ${MONO}`, color: '#5a514a' }}>
              {busy ? 'searching transcripts…' : q.length < 3 && !file ? 'type 3+ chars — or put a path in the file box to see every session that touched it' : 'no matches'}
            </div>
          )}
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', font: `400 10px ${MONO}`, color: '#6a615a' }}>
          ↑↓ navigate · ↵ open / copy the resume line · esc close · ⌘K toggle · everything here is your own machine's transcripts
        </div>
      </div>
    </div>
  )
}
