import React, { useEffect, useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'

const uid = p => p + Math.random().toString(36).slice(2, 9)
const inp = (flex, w) => ({ flex, minWidth: w, font: `400 11px ${MONO}`, background: '#1c1815', color: '#e5dbd2', border: '1px solid #7a716a55', borderRadius: 6, padding: '4px 8px' })
const btn = (bg = ACCENT) => ({ font: `600 11px ${MONO}`, color: '#0d0b0a', background: bg, border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' })

// Active request (nudge) + capture. Nudges come from the snapshot (shipped tickets); once you act,
// they become tracked requests. Solicited feedback becomes growth/strength evidence for a competency area.
export default function FeedbackPanel({ snap }) {
  const [cfg, setCfg] = useState(null)
  const [f, setF] = useState({ source: '', text: '', tag: 'strength', linkedArea: '' })
  useEffect(() => { api.get('/api/career/config').then(setCfg).catch(e => toast(e.message, 'error')) }, [])
  if (!cfg) return <div style={{ ...PANEL, color: '#7a716a' }}>Loading…</div>
  const requests = cfg.feedbackRequests || []
  const askedTriggers = new Set(requests.map(r => r.trigger))
  const nudges = (snap?.feedbackNudges || []).filter(n => !askedTriggers.has(n.trigger))

  const saveReq = async (next) => { setCfg({ ...cfg, feedbackRequests: next }); try { await api.post('/api/career/config', { feedbackRequests: next }); toast('saved', 'success') } catch (e) { toast(e.message, 'error') } }
  const saveCap = async (next) => { setCfg({ ...cfg, feedback: next }); try { await api.post('/api/career/config', { feedback: next }); toast('saved', 'success') } catch (e) { toast(e.message, 'error') } }

  const markAsked = (n) => saveReq([...requests, { id: uid('fr'), trigger: n.trigger, topic: n.topic, status: 'asked', requestedAt: Date.now() }])
  const markReceived = (id) => saveReq(requests.map(r => r.id === id ? { ...r, status: 'received', receivedAt: Date.now() } : r))
  const addCapture = () => { if (!f.text.trim()) return toast('feedback text required', 'error'); saveCap([...(cfg.feedback || []), { id: uid('fb'), date: Date.now(), ...f }]); setF({ source: '', text: '', tag: 'strength', linkedArea: '' }) }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Ask for feedback</div>
        {nudges.length ? nudges.map(n => (
          <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <div style={{ flex: 1, font: `400 12px ${MONO}`, color: '#9a8f86' }}>{n.suggestion}</div>
            <button onClick={() => markAsked(n)} style={btn()}>mark asked</button>
          </div>
        )) : <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>No pending nudges — ship something and one appears here.</div>}
        {requests.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid #7a716a22', padding: '4px 0' }}>
            <div style={{ flex: 1, font: `400 12px ${MONO}`, color: '#9a8f86' }}>{r.topic} <span style={{ color: '#7a716a' }}>· {r.status}</span></div>
            {r.status !== 'received' && <button onClick={() => markReceived(r.id)} style={btn('#5fd39a')}>received</button>}
          </div>
        ))}
      </div>

      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Capture feedback</div>
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input value={f.source} onChange={e => setF({ ...f, source: e.target.value })} placeholder="from whom…" style={inp(1, 120)} />
            <select value={f.tag} onChange={e => setF({ ...f, tag: e.target.value })} style={inp(0, 90)}>{['strength', 'growth'].map(t => <option key={t}>{t}</option>)}</select>
            <input value={f.linkedArea} onChange={e => setF({ ...f, linkedArea: e.target.value })} placeholder="competency area" style={inp(1, 120)} />
          </div>
          <input value={f.text} onChange={e => setF({ ...f, text: e.target.value })} placeholder="what they said…" style={inp(1, 200)} />
          <button onClick={addCapture} style={{ ...btn(), alignSelf: 'start' }}>+ capture</button>
        </div>
        {(cfg.feedback || []).slice().reverse().map(x => (
          <div key={x.id} style={{ font: `400 12px ${MONO}`, color: '#9a8f86', borderTop: '1px solid #7a716a22', padding: '4px 0' }}>
            <span style={{ color: x.tag === 'growth' ? '#f2a2c4' : '#5fd39a' }}>[{x.tag}]</span> {x.text} <span style={{ color: '#7a716a' }}>— {x.source}{x.linkedArea ? ` · ${x.linkedArea}` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
