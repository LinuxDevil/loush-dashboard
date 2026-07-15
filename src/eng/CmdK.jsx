import React, { useEffect, useMemo, useState } from 'react'
import { HEAD, BODY, MONO, BB, GOLD, DIM, HI, PANEL, useCopy } from './ui.jsx'

// §13 — ⌘K: type a JIRA key or a PR number and land on it. Also the raw-data escape hatches, because an
// engineer who can reproduce a number in a terminal in ten seconds argues with the data instead of
// dismissing the dashboard.
export default function CmdK({ snap, routes, onRoute, onOpenTicket, open, setOpen }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [copy] = useCopy()
  useEffect(() => {
    const h = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); setQ(''); setSel(0) }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  const items = useMemo(() => {
    const s = q.trim().toLowerCase()
    const out = []
    for (const [id, label] of routes) if (!s || label.toLowerCase().includes(s)) out.push({ kind: 'route', id, label, sub: 'go to' })
    if (s.length >= 2) {
      for (const i of (snap.issues || [])) if (i.key.toLowerCase().includes(s) || i.summary.toLowerCase().includes(s)) out.push({ kind: 'ticket', id: i.key, label: `${i.key} ${i.summary}`, sub: `${i.status} · ${i.assignee?.name || 'unassigned'}` })
      for (const p of (snap.prs || [])) if (String(p.num).includes(s) || p.title.toLowerCase().includes(s)) out.push({ kind: 'pr', id: p.url, label: `#${p.num} ${p.title}`, sub: `${p.state} · ${p.author}` })
    }
    out.push({ kind: 'copy', id: 'jql', label: 'Copy the JQL that produced these numbers', sub: 'provenance' })
    out.push({ kind: 'copy', id: 'gh', label: 'Copy the gh command that produced these PRs', sub: 'provenance' })
    return out.slice(0, 40)
  }, [q, snap, routes])
  if (!open) return null
  const run = it => {
    if (it.kind === 'route') onRoute(it.id)
    else if (it.kind === 'ticket') onOpenTicket(it.id)
    else if (it.kind === 'pr') window.open(it.id, '_blank')
    else if (it.kind === 'copy') {
      const p = snap.provenance || {}
      const v = it.id === 'jql' ? p.jql : p.ghCommand
      copy(typeof v === 'string' ? v : JSON.stringify(v, null, 2))
    }
    setOpen(false)
  }
  return <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(4,7,11,0.7)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', paddingTop: '12vh' }}>
    <div onClick={e => e.stopPropagation()} style={{ ...PANEL, width: 620, maxWidth: '94vw', height: 'fit-content', maxHeight: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <input autoFocus value={q} placeholder="jump to a ticket, a PR number, or a page…" onChange={e => { setQ(e.target.value); setSel(0) }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, items.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
          if (e.key === 'Enter' && items[sel]) run(items[sel])
        }}
        style={{ padding: '15px 18px', border: 'none', borderBottom: '1px solid rgba(142,200,255,0.1)', background: 'transparent', color: '#eaf1f9', font: `500 15px ${BODY}`, outline: 'none' }} />
      <div style={{ overflowY: 'auto' }}>
        {items.map((it, i) => <div key={it.kind + it.id + i} onMouseEnter={() => setSel(i)} onClick={() => run(it)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', cursor: 'pointer', background: i === sel ? 'rgba(142,200,255,0.1)' : 'transparent' }}>
          <span style={{ font: `600 8.5px ${MONO}`, letterSpacing: '0.05em', width: 46, color: it.kind === 'ticket' ? BB : it.kind === 'pr' ? '#a894f0' : it.kind === 'copy' ? GOLD : DIM }}>{it.kind.toUpperCase()}</span>
          <span style={{ flex: 1, minWidth: 0, font: `500 12.5px ${BODY}`, color: HI, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
          <span style={{ font: `400 10px ${MONO}`, color: DIM, flexShrink: 0 }}>{it.sub}</span>
        </div>)}
      </div>
    </div>
  </div>
}
