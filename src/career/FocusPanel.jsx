import React, { useState } from 'react'
import { marked } from 'marked'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'

const SEV = { high: '#f2a2c4', med: ACCENT, low: '#5fd39a' }

// Lazy per-item Analyze: heuristic message stays visible; ✨ fetches claude -p markdown into an expander.
function AnalyzeExpander({ item }) {
  const [state, setState] = useState('idle') // idle | loading | done
  const [md, setMd] = useState('')
  const run = async () => {
    setState('loading')
    try { const r = await api.post('/api/career/analyze', { panelKey: 'focus', payload: item }); setMd(r.markdown); setState('done') }
    catch (e) { setMd(`_Analyze failed: ${e.message}. The heuristic guidance above still stands._`); setState('done') }
  }
  return <div style={{ marginTop: 6 }}>
    <button onClick={run} disabled={state === 'loading'} style={{ font: `600 11px ${MONO}`, color: ACCENT, background: 'transparent', border: `1px solid ${ACCENT}55`, borderRadius: 6, padding: '3px 8px', cursor: state === 'loading' ? 'default' : 'pointer' }}>
      {state === 'loading' ? '✨ analyzing…' : '✨ Analyze'}
    </button>
    {state === 'done' && <div style={{ marginTop: 8, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, font: `400 12px ${MONO}`, color: '#d8cec4' }} dangerouslySetInnerHTML={{ __html: marked.parse(md || '') }} />}
  </div>
}

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
        <AnalyzeExpander item={f} />
      </div>) : <div style={{ ...PANEL, color: '#7a716a' }}>No focus items — a clean window, or run ↻ refresh.</div>}
    </div>
  )
}
