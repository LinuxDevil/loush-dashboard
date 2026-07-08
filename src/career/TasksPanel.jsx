import React from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'
const BUCKETS = [['inProgress', 'In progress'], ['toTest', 'To test (my side)'], ['pending', 'Pending']]
const reco = t => t.bucket === 'toTest' ? 'Write/run the acceptance checks before handing off.'
  : t.bucket === 'inProgress' ? (t.ageDays > t.slaDays ? '⚠ Past expected date — checkpoint or escalate in your next 1:1.' : 'Keep scope tight; commit at each green checkpoint.')
  : 'Confirm acceptance criteria with the reporter before starting.'
export default function TasksPanel({ snap, reload }) {
  const tasks = snap.tasks || []
  const risk = (snap.focus || []).filter(f => f.area === 'tasks')
  const act = async (f) => { try { await api.post('/api/career/focus/act', { id: f.id, ref: f.evidenceRefs?.[0] }); toast('marked acted-on', 'success'); reload?.() } catch (e) { toast(e.message, 'error') } }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {risk.length ? <div style={{ ...PANEL, borderColor: '#f2a2c455' }}>
        <div style={{ font: `600 13px ${HEAD}`, color: '#f2a2c4', marginBottom: 8 }}>Risk to commitments</div>
        {risk.map(f => <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
          <div style={{ flex: 1, font: `400 12px ${MONO}` }}>{f.message}</div>
          <button onClick={() => act(f)} disabled={!!f.actedOn} style={{ font: `600 11px ${MONO}`, color: f.actedOn ? '#5fd39a' : ACCENT, background: 'transparent', border: `1px solid ${f.actedOn ? '#5fd39a' : ACCENT}55`, borderRadius: 6, padding: '3px 8px', cursor: f.actedOn ? 'default' : 'pointer' }}>{f.actedOn ? '✓ acted on' : 'mark acted on'}</button>
        </div>)}
      </div> : null}
      {BUCKETS.map(([key, label]) => {
        const rows = tasks.filter(t => t.bucket === key)
        return <div key={key} style={PANEL}>
          <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>{label} <span style={{ color: '#7a716a' }}>({rows.length})</span></div>
          {rows.length ? rows.map(t => <div key={t.id} style={{ padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ font: `500 12px ${MONO}` }}>{t.id} · {t.title || ''}</div>
            <div style={{ font: `400 11px ${MONO}`, color: '#9a8f86' }}>→ {reco(t)}</div>
          </div>) : <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>empty</div>}
        </div>
      })}
    </div>
  )
}
