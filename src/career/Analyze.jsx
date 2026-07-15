import React, { useState } from 'react'
import { marked } from 'marked'
import { api } from '../api.js'
import { MONO, ACCENT } from './theme.jsx'

// Shared on-demand ✨ Analyze: heuristic content stays visible; ✨ lazy-loads claude -p markdown (§6 degradation).
export default function Analyze({ panelKey, payload, label = '✨ Analyze' }) {
  const [state, setState] = useState('idle')
  const [md, setMd] = useState('')
  const run = async () => {
    setState('loading')
    try { const r = await api.post('/api/career/analyze', { panelKey, payload }); setMd(r.markdown); setState('done') }
    catch (e) { setMd(`_Analyze failed: ${e.message}. The heuristic guidance still stands._`); setState('done') }
  }
  return <div style={{ marginTop: 6 }}>
    <button onClick={run} disabled={state === 'loading'} style={{ font: `600 11px ${MONO}`, color: ACCENT, background: 'transparent', border: `1px solid ${ACCENT}55`, borderRadius: 6, padding: '3px 8px', cursor: state === 'loading' ? 'default' : 'pointer' }}>
      {state === 'loading' ? '✨ analyzing…' : label}
    </button>
    {state === 'done' && <div style={{ marginTop: 8, padding: '10px 12px', background: '#161b22', borderRadius: 8, font: `400 12px ${MONO}`, color: '#e6edf3' }} dangerouslySetInnerHTML={{ __html: marked.parse(md || '') }} />}
  </div>
}
