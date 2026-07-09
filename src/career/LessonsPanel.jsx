import React, { useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'

const inp = (flex, w) => ({ flex, minWidth: w, font: `400 11px ${MONO}`, background: '#1c1815', color: '#e5dbd2', border: '1px solid #7a716a55', borderRadius: 6, padding: '4px 8px' })
const btn = (bg = ACCENT) => ({ font: `600 11px ${MONO}`, color: '#0d0b0a', background: bg, border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' })

// Framing (spec §11.B): graduated lessons are celebrated as loudly as new ones; the panel never opens
// on a wall of failures. So we show internalized first, then active (with their live delta), then draft-a-lesson.
export default function LessonsPanel({ snap, reload }) {
  const lessons = snap?.lessons || []
  const graduated = lessons.filter(l => l.status === 'internalized')
  const active = lessons.filter(l => l.status === 'active')
  const [draft, setDraft] = useState({ situation: '', pattern: '', rule: '', metricRef: '', comparator: '<=', target: '', freeText: '' })

  const add = async () => {
    if (!draft.rule.trim()) return toast('a lesson needs a rule', 'error')
    const check = draft.metricRef ? { metricRef: draft.metricRef, comparator: draft.comparator, target: Number(draft.target), window: '30d' } : { freeText: draft.freeText }
    try { await api.post('/api/career/lessons', { lesson: { situation: draft.situation, pattern: draft.pattern, rule: draft.rule, check } }); toast('lesson raised', 'success'); setDraft({ situation: '', pattern: '', rule: '', metricRef: '', comparator: '<=', target: '', freeText: '' }); reload?.() }
    catch (e) { toast(e.message, 'error') }   // 409 = active cap of 5 reached
  }
  const discard = async (id) => { try { await api.post(`/api/career/lessons/${id}/discard`, {}); reload?.() } catch (e) { toast(e.message, 'error') } }

  const statusPill = (l) => {
    const s = l.eval?.status
    const c = s === 'cleared' ? '#5fd39a' : s === 'recurring' ? '#f2a2c4' : '#7a716a'
    return <span style={{ font: `700 10px ${MONO}`, color: c }}>{s || 'pending'}{l.eval?.flag1on1 ? ' · flag 1:1' : ''}</span>
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {graduated.length > 0 && (
        <div style={{ ...PANEL, borderColor: '#5fd39a55' }}>
          <div style={{ font: `600 13px ${HEAD}`, color: '#5fd39a', marginBottom: 6 }}>✓ Internalized — friction you’ve trended down</div>
          {graduated.map(l => <div key={l.id} style={{ font: `400 12px ${MONO}`, color: '#9a8f86', marginBottom: 3 }}>{l.rule}</div>)}
        </div>
      )}

      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Active lessons <span style={{ color: '#7a716a', font: `400 11px ${MONO}` }}>({active.length}/5)</span></div>
        {active.length ? active.map(l => (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid #7a716a22', padding: '6px 0' }}>
            <div style={{ flex: 1 }}>
              <div style={{ font: `500 12px ${HEAD}` }}>{l.rule}</div>
              {l.pattern && <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>{l.situation} → {l.pattern}</div>}
              <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{l.check?.metricRef ? `check: ${l.check.metricRef} ${l.check.comparator} ${l.check.target} (${l.check.window})` : `check: “${l.check?.freeText || '—'}” (manual)`}</div>
            </div>
            {statusPill(l)}
            <button onClick={() => discard(l.id)} style={{ font: `400 11px ${MONO}`, color: '#7a716a', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
          </div>
        )) : <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>No active lessons — raise one from a recurring friction below.</div>}
      </div>

      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Raise a lesson</div>
        <div style={{ display: 'grid', gap: 6 }}>
          <input value={draft.situation} onChange={e => setDraft({ ...draft, situation: e.target.value })} placeholder="situation…" style={inp(1, 200)} />
          <input value={draft.pattern} onChange={e => setDraft({ ...draft, pattern: e.target.value })} placeholder="pattern I keep hitting…" style={inp(1, 200)} />
          <input value={draft.rule} onChange={e => setDraft({ ...draft, rule: e.target.value })} placeholder="rule to apply next time…" style={inp(1, 200)} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={draft.metricRef} onChange={e => setDraft({ ...draft, metricRef: e.target.value })} placeholder="metricRef (structured → auto-graduates)" style={inp(1, 180)} />
            <select value={draft.comparator} onChange={e => setDraft({ ...draft, comparator: e.target.value })} style={inp(0, 60)}>{['<=', '<', '>=', '>'].map(c => <option key={c}>{c}</option>)}</select>
            <input type="number" step="0.01" value={draft.target} onChange={e => setDraft({ ...draft, target: e.target.value })} placeholder="target" style={inp(0, 70)} />
          </div>
          <input value={draft.freeText} onChange={e => setDraft({ ...draft, freeText: e.target.value })} placeholder="…or a free-text check (manual-graduate only)" style={inp(1, 200)} />
          <button onClick={add} style={{ ...btn(), alignSelf: 'start' }}>+ raise</button>
        </div>
      </div>
    </div>
  )
}
