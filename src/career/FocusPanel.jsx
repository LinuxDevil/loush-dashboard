import React from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'
import Analyze from './Analyze.jsx'

const SEV = { high: '#f2a2c4', med: ACCENT, low: '#5fd39a' }

export default function FocusPanel({ snap, reload }) {
  const focus = snap.focus || []
  const act = async (f) => { try { await api.post('/api/career/focus/act', { id: f.id, ref: f.evidenceRefs?.[0] }); toast('marked acted-on', 'success'); reload?.() } catch (e) { toast(e.message, 'error') } }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {focus.length ? focus.map(f => <div key={f.id} style={{ ...PANEL, borderColor: (SEV[f.severity] || ACCENT) + '55' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ font: `700 10px ${MONO}`, color: SEV[f.severity] || ACCENT, textTransform: 'uppercase' }}>{f.severity}</span>
          <div style={{ flex: 1, font: `500 13px ${HEAD}`, color: '#e5dbd2' }}>{f.message}</div>
          <button onClick={() => act(f)} disabled={!!f.actedOn} style={{ font: `600 11px ${MONO}`, color: f.actedOn ? '#5fd39a' : ACCENT, background: 'transparent', border: `1px solid ${f.actedOn ? '#5fd39a' : ACCENT}55`, borderRadius: 6, padding: '3px 8px', cursor: f.actedOn ? 'default' : 'pointer' }}>{f.actedOn ? '✓ acted on' : 'mark acted on'}</button>
        </div>
        <Analyze panelKey="focus" payload={f} />
      </div>) : <div style={{ ...PANEL, color: '#7a716a' }}>No focus items — a clean window, or run ↻ refresh.</div>}
    </div>
  )
}
