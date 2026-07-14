import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { MONO, BODY, HEAD, ACCENT, MUTE, INK, GREEN, RED, PURPLE, LINE, BG, PANEL_BG, Badge, Spinner } from './theme.jsx'
import { Btn, Empty } from './charts.jsx'
import { copy } from './data.jsx'

// item 10 — the omnibox. Two indexes, routed by whether the query looks like a ticket key:
//   TRN-123  → Plane A: status, days in status, PRs, history (answer a stakeholder without pinging a dev)
//   anything → self plane: my own memories + transcripts ("have I solved this before")
// Cmd-K / Ctrl-K anywhere in the dashboard.
export default function Omnibox({ open, onClose }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)

  useEffect(() => { if (open) { setTimeout(() => ref.current?.focus(), 30) } else { setQ(''); setRes(null) } }, [open])
  useEffect(() => {
    if (!open || q.trim().length < 3) { setRes(null); return }
    let live = true
    const t = setTimeout(async () => {
      setBusy(true)
      try { const r = await api.get('/api/career/lookup?q=' + encodeURIComponent(q.trim())); if (live) setRes(r) }
      catch (e) { if (live) setRes({ kind: 'error', error: e.message }) }
      finally { if (live) setBusy(false) }
    }, 260)
    return () => { live = false; clearTimeout(t) }
  }, [q, open])

  if (!open) return null
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: '#00000099', backdropFilter: 'blur(2px)', display: 'flex', justifyContent: 'center', paddingTop: '12vh' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(760px, 92vw)', maxHeight: '70vh', display: 'flex', flexDirection: 'column', background: BG, border: `1px solid ${LINE}`, borderRadius: 12, boxShadow: '0 24px 60px #000a', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${LINE}` }}>
          <span style={{ color: ACCENT, font: `600 13px ${MONO}` }}>⌘K</span>
          <input ref={ref} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Escape' && onClose()}
            placeholder="TRN-123 for a ticket · an error string, path or library for precedent in my own sessions"
            style={{ flex: 1, font: `400 13px ${BODY}`, color: INK, background: 'transparent', border: 'none', outline: 'none' }} />
          {busy && <Spinner size={13} />}
        </div>
        <div style={{ overflowY: 'auto', padding: 14 }}>
          {!res ? <Empty>{q.trim().length < 3 ? 'Type at least 3 characters.' : 'Searching…'}</Empty>
            : res.kind === 'error' ? <Empty tone={RED}>{res.error}</Empty>
            : res.kind === 'ticket' ? <TicketHit r={res} />
            : res.kind === 'precedent' ? <Precedent hits={res.hits} />
            : <Empty>No result.</Empty>}
        </div>
      </div>
    </div>
  )
}

function TicketHit({ r }) {
  const t = r.ticket || {}
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ font: `600 15px ${HEAD}`, color: ACCENT }}>{r.key}</span>
        <Badge tone="accent">{t.status || '—'}</Badge>
        {t.type ? <Badge>{t.type}</Badge> : null}
        <span style={{ flex: 1 }} />
        <Btn onClick={() => copy(r.copy, 'status summary copied — paste it to the stakeholder')}>⧉ copy status summary</Btn>
      </div>
      <div style={{ font: `400 13px ${BODY}`, color: INK }}>{t.summary}</div>
      <div style={{ font: `400 11.5px ${MONO}`, color: MUTE }}>{r.copy}</div>
      {(t.prs || []).length ? (
        <div style={{ font: `400 11.5px ${MONO}`, color: MUTE }}>PRs: {(t.prs || []).map(p => (
          <a key={p.num} href={p.url} target="_blank" rel="noreferrer" style={{ color: ACCENT, textDecoration: 'none', marginRight: 8 }}>#{p.num} ({p.state})</a>
        ))}</div>
      ) : null}
      {(t.history || []).length ? (
        <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 8 }}>
          <div style={{ font: `500 10.5px ${MONO}`, color: MUTE, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 5 }}>last changes</div>
          {(t.history || []).slice(-3).reverse().map((h, i) => (
            <div key={i} style={{ font: `400 11.5px ${MONO}`, color: INK, padding: '2px 0' }}>
              <span style={{ color: MUTE }}>{String(h.at || '').slice(0, 10)}</span> {h.from || '—'} → <b>{h.to || h.status || '—'}</b> {h.by ? <span style={{ color: MUTE }}>· {h.by}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Precedent({ hits = [] }) {
  if (!hits.length) return <Empty>No hits in your memories or transcripts. That is a "not found", not a "does not exist".</Empty>
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ font: `400 10.5px ${BODY}`, color: MUTE }}>Self-plane: your own memories and transcripts. Nobody else's, ever.</div>
      {hits.map((h, i) => (
        <div key={i} style={{ background: PANEL_BG, border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 11px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <Badge tone={h.source === 'memory' ? 'purple' : 'mute'}>{h.source}</Badge>
            {h.project ? <span style={{ font: `400 11px ${MONO}`, color: ACCENT }}>{h.project}</span> : null}
            {h.date ? <span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{String(h.date).slice(0, 10)}</span> : null}
            <span style={{ flex: 1 }} />
            {h.resume ? <Btn tone={GREEN} onClick={() => copy(h.resume, 'resume command copied')}>⧉ resume</Btn> : null}
          </div>
          <div style={{ font: `400 12px ${BODY}`, color: INK, lineHeight: 1.45 }}>{h.excerpt}</div>
        </div>
      ))}
    </div>
  )
}
