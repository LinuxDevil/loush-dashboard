import React, { useEffect, useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'
export default function OneOnOnePanel({ reload }) {
  const [b, setB] = useState(null)
  const [fb, setFb] = useState(''); const [topic, setTopic] = useState(''); const [actions, setActions] = useState('')
  const [decision, setDecision] = useState('')
  const loadBrief = () => api.get('/api/career/brief').then(b => { setB(b); setTopic(b.growthTopic || '') }).catch(e => toast(e.message, 'error'))
  useEffect(() => { loadBrief() }, [])
  const save = async () => {
    const agreedActions = actions.split('\n').filter(Boolean).map(text => ({ text, done: false }))
    await api.post('/api/career/one-on-one', { agreedActions, managerFeedback: fb, growthTopic: topic })
    toast('1:1 logged — next brief will track these', 'success'); setFb(''); setActions(''); reload?.(); loadBrief()
  }
  const addDecision = async () => { if (!decision.trim()) return; await api.post('/api/career/pending-decision', { text: decision }); setDecision(''); toast('added', 'success'); loadBrief() }
  if (!b) return <div style={{ ...PANEL, color: '#7a716a' }}>composing brief…</div>
  const Sec = ({ t, items, empty }) => <div style={PANEL}><div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>{t}</div>{items.length ? items.map((x, i) => <div key={i} style={{ font: `400 12px ${MONO}`, padding: '3px 0' }}>• {typeof x === 'string' ? x : x.text}{x.done === false ? ' ⏳' : ''}</div>) : <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>{empty}</div>}</div>
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Sec t="Status of what we agreed" items={b.lastAgreed} empty="no prior 1:1 on record" />
      <Sec t="Wins since last 1:1" items={b.winsSinceLast} empty="log wins in the Brag panel" />
      <Sec t="Blockers & risks to raise" items={b.blockers} empty="nothing high-severity" />
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Decisions I need</div>
        {(b.decisionsNeeded || []).map((x, i) => <div key={i} style={{ font: `400 12px ${MONO}`, padding: '3px 0' }}>• {x}</div>)}
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input value={decision} onChange={e => setDecision(e.target.value)} placeholder="a decision I need from my manager" style={{ flex: 1, font: `400 12px ${MONO}`, background: '#1c1815', color: '#e5dbd2', border: '1px solid #7a716a55', borderRadius: 6, padding: '6px 8px' }} />
          <button onClick={addDecision} style={{ font: `600 11px ${MONO}`, color: ACCENT, background: 'transparent', border: `1px solid ${ACCENT}55`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>+ add</button>
        </div>
      </div>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 4 }}>Growth topic to raise</div>
        <div style={{ font: `400 12px ${MONO}`, color: b.growthTopic ? '#e5dbd2' : '#7a716a' }}>{b.growthTopic || 'no focus item pending — pick one to discuss'}</div>
      </div>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>After the 1:1 — log it</div>
        <textarea value={actions} onChange={e => setActions(e.target.value)} placeholder="agreed actions (one per line)" style={{ width: '100%', height: 60, font: `400 12px ${MONO}`, background: '#1c1815', color: '#e5dbd2', border: '1px solid #7a716a55', borderRadius: 6, padding: 8, marginBottom: 6 }} />
        <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="growth topic discussed" style={{ width: '100%', font: `400 12px ${MONO}`, background: '#1c1815', color: '#e5dbd2', border: '1px solid #7a716a55', borderRadius: 6, padding: '6px 8px', marginBottom: 6 }} />
        <input value={fb} onChange={e => setFb(e.target.value)} placeholder="manager feedback" style={{ width: '100%', font: `400 12px ${MONO}`, background: '#1c1815', color: '#e5dbd2', border: '1px solid #7a716a55', borderRadius: 6, padding: '6px 8px', marginBottom: 8 }} />
        <button onClick={save} style={{ font: `600 11px ${MONO}`, color: '#0d0b0a', background: ACCENT, border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>log 1:1</button>
      </div>
    </div>
  )
}
