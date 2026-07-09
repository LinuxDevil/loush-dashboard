import React, { useEffect, useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'

export default function TicketRetroPanel() {
  const [tickets, setTickets] = useState(null)
  const [retro, setRetro] = useState(null)
  useEffect(() => { api.get('/api/career/retro-tickets').then(r => setTickets(r.tickets || [])).catch(e => toast(e.message, 'error')) }, [])
  const open = async (id) => { setRetro('loading'); try { setRetro(await api.get('/api/career/retro/' + id)) } catch (e) { toast(e.message, 'error'); setRetro(null) } }
  if (!tickets) return <div style={{ ...PANEL, color: '#7a716a' }}>Loading…</div>

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16 }}>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Closed tickets</div>
        {tickets.length ? tickets.map(t => (
          <button key={t.id} onClick={() => open(t.id)} style={{ display: 'block', width: '100%', textAlign: 'left', font: `400 11px ${MONO}`, color: '#e5dbd2', background: 'none', border: '1px solid #7a716a33', borderRadius: 6, padding: '5px 8px', marginBottom: 4, cursor: 'pointer' }}>
            <b>{t.id}</b> <span style={{ color: '#7a716a' }}>{t.stage}</span><br /><span style={{ color: '#9a8f86' }}>{t.title}</span>
          </button>
        )) : <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>No closed tickets in taskboard.</div>}
      </div>

      <div style={PANEL}>
        {!retro ? <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>Pick a ticket to compose its retro.</div>
          : retro === 'loading' ? <div style={{ color: '#7a716a' }}>Composing…</div>
          : <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ font: `600 14px ${HEAD}`, color: ACCENT }}>{retro.ticketId}</div>
              <div style={{ font: `400 12px ${MONO}`, color: '#9a8f86' }}>
                {retro.estimateVsActual ? `estimate ${retro.estimateVsActual.estimateDays}d vs actual ${retro.estimateVsActual.actualDays?.toFixed?.(1) ?? '—'}d` : 'no estimate on file'}
              </div>
              <div style={{ font: `400 12px ${MONO}`, color: '#9a8f86' }}>reopened: {retro.reopened} · escaped bugs: {retro.escapedBugs}</div>
              <div style={{ font: `400 11px ${MONO}`, color: '#9a8f86' }}>cycle by phase: {Object.entries(retro.cycleByPhase || {}).map(([k, v]) => `${k} ${v.toFixed(1)}d`).join(' · ') || '—'}</div>
              <div style={{ font: `400 11px ${MONO}`, color: retro.sessionsShown ? '#5fd39a' : '#7a716a' }}>
                {retro.sessionsShown ? `${retro.sessions.length} linked session(s)` : 'sessions not shown — no confident link (won’t guess a join)'}
              </div>
            </div>}
      </div>
    </div>
  )
}
