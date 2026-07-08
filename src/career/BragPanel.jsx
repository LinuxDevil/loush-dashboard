import React, { useEffect, useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'
export default function BragPanel({ reload }) {
  const [data, setData] = useState({ candidates: [], entries: [] })
  const [retro, setRetro] = useState({ worked: '', didnt: '', change: '' })
  const load = () => api.get('/api/career/brag').then(setData).catch(e => toast(e.message, 'error'))
  useEffect(() => { load() }, [])
  const accept = async (c) => { await api.post('/api/career/brag', { entry: { title: c.title, impact: c.impact, evidence: c.evidence } }); toast('added to brag log', 'success'); load(); reload?.() }
  const saveRetro = async () => { const weekOf = new Date().toISOString().slice(0, 10); await api.post('/api/career/retro', { weekOf, ...retro }); setRetro({ worked: '', didnt: '', change: '' }); toast('retro saved', 'success') }
  const exportStory = async () => { const { markdown } = await api.get('/api/career/story-so-far'); await navigator.clipboard.writeText(markdown); toast('story-so-far copied', 'success') }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={PANEL}>
        <div style={{ display: 'flex', alignItems: 'center' }}><div style={{ font: `600 13px ${HEAD}`, color: ACCENT, flex: 1 }}>Brag log ({data.entries.length})</div>
          <button onClick={exportStory} style={{ font: `600 11px ${MONO}`, color: ACCENT, background: 'transparent', border: `1px solid ${ACCENT}55`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>⧉ story-so-far</button></div>
        {data.entries.slice(-10).reverse().map(e => <div key={e.id} style={{ font: `400 12px ${MONO}`, padding: '4px 0' }}>• {e.title}</div>)}
      </div>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Auto-seeded candidates</div>
        {data.candidates.length ? data.candidates.map(c => <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '3px 0' }}>
          <div style={{ flex: 1, font: `400 12px ${MONO}` }}>{c.title}</div>
          <button onClick={() => accept(c)} style={{ font: `600 11px ${MONO}`, color: ACCENT, background: 'transparent', border: `1px solid ${ACCENT}55`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>+ add</button>
        </div>) : <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>no candidates — ship a ticket or run /insights</div>}
      </div>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Weekly retro (feeds Analyze + streak)</div>
        {['worked', 'didnt', 'change'].map(k => <input key={k} value={retro[k]} onChange={e => setRetro(r => ({ ...r, [k]: e.target.value }))} placeholder={k === 'worked' ? 'what worked' : k === 'didnt' ? "what didn't" : 'what I will do differently'} style={{ display: 'block', width: '100%', marginBottom: 6, font: `400 12px ${MONO}`, background: '#1c1815', color: '#e5dbd2', border: '1px solid #7a716a55', borderRadius: 6, padding: '6px 8px' }} />)}
        <button onClick={saveRetro} style={{ font: `600 11px ${MONO}`, color: '#0d0b0a', background: ACCENT, border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>save retro</button>
      </div>
    </div>
  )
}
