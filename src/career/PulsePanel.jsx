import React, { useState } from 'react'
import { api, toast } from '../api.js'
import { MONO, BODY, ACCENT, GREEN, RED, MUTE, INK } from './theme.jsx'
import { Card } from './charts.jsx'
import { useApi } from './data.jsx'

// Self-only weekly friction pulse. The prompt appears when due (no entry in >7d) and
// disappears once logged — the page render IS the reminder, so there is no scheduler.
const WEEK = 7 * 24 * 60 * 60 * 1000
const toneFor = b => (b >= 4 ? RED : b === 3 ? ACCENT : GREEN)

export default function PulsePanel() {
  const { data, reload } = useApi('/api/career/pulse')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const entries = data?.entries || []
  const newest = entries[entries.length - 1]
  const due = !newest || Date.now() - newest.ts > WEEK

  const log = async (blocked) => {
    setSaving(true)
    try {
      await api.post('/api/career/pulse', { blocked, note: note.trim() })
      setNote(''); toast('logged ✓', 'success'); reload()
    } catch (e) { toast(e.message, 'error') } finally { setSaving(false) }
  }

  return (
    <Card title="Friction pulse" sub="private to this laptop — never synced, never rolled up" json={entries}>
      {due ? (
        <div style={{ display: 'grid', gap: 8, marginBottom: entries.length ? 14 : 0 }}>
          <div style={{ font: `400 13px ${BODY}`, color: INK }}>How blocked did you feel this week?</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} className="press" disabled={saving} onClick={() => log(n)} title={n === 1 ? 'flowing' : n === 5 ? 'blocked' : ''}
                style={{ flex: 1, font: `600 15px ${MONO}`, color: saving ? MUTE : toneFor(n), background: 'transparent', border: `1px solid ${(saving ? MUTE : toneFor(n)) + '55'}`, borderRadius: 6, padding: '8px 0', cursor: saving ? 'default' : 'pointer' }}>{n}</button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', font: `400 10px ${MONO}`, color: MUTE }}><span>1 flowing</span><span>5 blocked</span></div>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={1} placeholder="optional note (what got in the way)"
            style={{ resize: 'vertical', font: `400 12px ${MONO}`, background: '#161b22', color: '#e6edf3', border: `1px solid ${MUTE}55`, borderRadius: 6, padding: '6px 8px' }} />
        </div>
      ) : null}
      {entries.length ? <Sparkline entries={entries.slice(-12)} /> : (!due ? null : <div style={{ font: `400 11px ${BODY}`, color: MUTE, marginTop: 4 }}>No pulses logged yet — tap a number to start.</div>)}
    </Card>
  )
}

// ~12-point inline sparkline; y inverted so lower (flowing) sits high.
function Sparkline({ entries }) {
  const W = 260, H = 40, pad = 3
  const pts = entries.map((e, i) => {
    const x = pad + (entries.length === 1 ? 0 : i * (W - 2 * pad) / (entries.length - 1))
    const y = pad + (e.blocked - 1) / 4 * (H - 2 * pad)
    return [x, y, e]
  })
  const last = entries[entries.length - 1]
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ font: `400 10.5px ${BODY}`, color: MUTE, marginBottom: 4 }}>last {entries.length} · latest {new Date(last.ts).toISOString().slice(0, 10)}{last.note ? ` · ${last.note}` : ''}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ overflow: 'visible' }}>
        <polyline fill="none" stroke={ACCENT} strokeWidth="1.5" points={pts.map(([x, y]) => `${x},${y}`).join(' ')} />
        {pts.map(([x, y, e]) => <circle key={e.id} cx={x} cy={y} r="2.5" fill={toneFor(e.blocked)} />)}
      </svg>
    </div>
  )
}
