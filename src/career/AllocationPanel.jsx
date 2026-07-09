import React, { useEffect, useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'

const KEYS = [['deepWork', 'Deep work'], ['reviewsMentorship', 'Reviews & mentorship'], ['designStrategy', 'Design & strategy'], ['opsInterrupts', 'Ops & interrupts']]

export default function AllocationPanel({ snap }) {
  const alloc = snap.allocation || { actual: {}, drift: {} }
  const [target, setTarget] = useState(null)
  useEffect(() => { api.get('/api/career/config').then(cfg => setTarget(cfg.timeTarget || { deepWork: 50, reviewsMentorship: 20, designStrategy: 20, opsInterrupts: 10 })).catch(e => toast(e.message, 'error')) }, [])
  const save = async () => {
    const sum = KEYS.reduce((t, [k]) => t + (+target[k] || 0), 0)
    if (sum !== 100) return toast(`targets must sum to 100 (now ${sum})`, 'error')
    try { await api.post('/api/career/config', { timeTarget: target }); toast('saved — ↻ refresh to recompute drift', 'success') } catch (e) { toast(e.message, 'error') }
  }
  if (!target) return <div style={{ ...PANEL, color: '#7a716a' }}>Loading…</div>

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Target vs actual</div>
        {KEYS.map(([k, label]) => {
          const a = alloc.actual[k] || 0, t = +target[k] || 0, warn = alloc.drift?.[k]?.warn
          return <div key={k} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: `400 12px ${MONO}` }}>
              <div style={{ width: 150 }}>{label}</div>
              <div style={{ flex: 1, position: 'relative', height: 14, background: 'rgba(255,255,255,0.06)', borderRadius: 4 }}>
                <div style={{ position: 'absolute', inset: 0, width: `${a}%`, background: warn ? '#f2a2c4' : ACCENT, borderRadius: 4 }} />
                <div title={`target ${t}%`} style={{ position: 'absolute', left: `${t}%`, top: -2, bottom: -2, width: 2, background: '#fff' }} />
              </div>
              <div style={{ width: 90, textAlign: 'right', color: '#9a8f86' }}>{a}% <span style={{ color: '#7a716a' }}>/ {t}%</span></div>
            </div>
            {warn && <div style={{ font: `400 11px ${MONO}`, color: '#f2a2c4', marginLeft: 158 }}>⚠ under half your target this window</div>}
          </div>
        })}
        <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginTop: 4 }}>White tick = target. Bars are actuals from this window's sessions + review footprint.</div>
      </div>

      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Set intended split (must sum to 100)</div>
        {KEYS.map(([k, label]) => <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, font: `400 12px ${MONO}` }}>
          <div style={{ width: 150 }}>{label}</div>
          <input type="number" min="0" max="100" value={target[k] ?? 0} onChange={e => setTarget({ ...target, [k]: +e.target.value })} style={{ width: 70, font: `500 12px ${MONO}`, background: '#1c1815', color: '#e5dbd2', border: '1px solid #7a716a55', borderRadius: 6, padding: '3px 8px' }} />
          <span style={{ color: '#7a716a' }}>%</span>
        </div>)}
        <button onClick={save} style={{ marginTop: 8, font: `600 12px ${MONO}`, color: '#0d0b0a', background: ACCENT, border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}>Save target</button>
      </div>
    </div>
  )
}
