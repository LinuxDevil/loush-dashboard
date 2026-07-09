import React, { useEffect, useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'

const uid = () => 'd' + Math.random().toString(36).slice(2, 9)
const todayStr = () => new Date().toISOString().slice(0, 10)

export default function DecisionPanel() {
  const [decisions, setDecisions] = useState(null)
  const [d, setD] = useState({ chose: '', over: '', because: '', revisitWhen: '' })
  useEffect(() => { api.get('/api/career/config').then(cfg => setDecisions(cfg.decisions || [])).catch(e => toast(e.message, 'error')) }, [])
  if (!decisions) return <div style={{ ...PANEL, color: '#7a716a' }}>Loading…</div>

  const persist = async (next) => { setDecisions(next); try { await api.post('/api/career/config', { decisions: next }); toast('saved', 'success') } catch (e) { toast(e.message, 'error') } }
  const add = () => {
    if (!d.chose.trim()) return toast('a decision needs a "chose"', 'error')
    persist([...decisions, { id: uid(), date: Date.now(), ...d, outcome: '', becameAdr: false }])
    setD({ chose: '', over: '', because: '', revisitWhen: '' })
  }
  const setField = (id, patch) => persist(decisions.map(x => x.id === id ? { ...x, ...patch } : x))
  const del = id => persist(decisions.filter(x => x.id !== id))
  const dueNow = x => x.revisitWhen && x.revisitWhen <= todayStr() && !x.outcome

  const inp = (flex, w) => ({ flex, minWidth: w, font: `400 11px ${MONO}`, background: '#1c1815', color: '#e5dbd2', border: '1px solid #7a716a55', borderRadius: 6, padding: '4px 8px' })

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Log a decision</div>
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input value={d.chose} onChange={e => setD({ ...d, chose: e.target.value })} placeholder="chose…" style={inp(1, 120)} />
            <input value={d.over} onChange={e => setD({ ...d, over: e.target.value })} placeholder="over…" style={inp(1, 120)} />
          </div>
          <input value={d.because} onChange={e => setD({ ...d, because: e.target.value })} placeholder="because…" style={inp(1, 200)} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label style={{ font: `400 11px ${MONO}`, color: '#9a8f86' }}>revisit when:</label>
            <input type="date" value={d.revisitWhen} onChange={e => setD({ ...d, revisitWhen: e.target.value })} style={inp(0, 140)} />
            <button onClick={add} style={{ font: `600 11px ${MONO}`, color: '#0d0b0a', background: ACCENT, border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer' }}>+ log</button>
          </div>
        </div>
      </div>

      {decisions.slice().reverse().map(x => <div key={x.id} style={{ ...PANEL, borderColor: dueNow(x) ? '#f2a2c455' : PANEL.border }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, font: `500 13px ${HEAD}` }}>{x.chose} {x.over ? <span style={{ color: '#7a716a' }}>over {x.over}</span> : null}</div>
          {dueNow(x) && <span style={{ font: `700 10px ${MONO}`, color: '#f2a2c4', border: '1px solid #f2a2c455', borderRadius: 5, padding: '2px 6px' }}>REVISIT DUE</span>}
          {x.becameAdr && <span style={{ font: `700 10px ${MONO}`, color: '#5fd39a' }}>ADR</span>}
          <button onClick={() => del(x.id)} style={{ font: `400 11px ${MONO}`, color: '#7a716a', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>
        {x.because && <div style={{ font: `400 12px ${MONO}`, color: '#9a8f86', marginTop: 2 }}>because {x.because}</div>}
        <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginTop: 2 }}>{new Date(x.date).toLocaleDateString()}{x.revisitWhen ? ` · revisit ${x.revisitWhen}` : ''}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <input value={x.outcome || ''} onChange={e => setField(x.id, { outcome: e.target.value })} placeholder="outcome (closes the revisit)" style={inp(1, 160)} />
          <label style={{ font: `400 11px ${MONO}`, color: '#9a8f86', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={!!x.becameAdr} onChange={e => setField(x.id, { becameAdr: e.target.checked })} /> graduate to ADR
          </label>
        </div>
      </div>)}
    </div>
  )
}
