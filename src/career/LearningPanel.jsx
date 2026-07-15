import React, { useEffect, useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'

const RINGS = ['adopt', 'trial', 'assess', 'hold']
const RING_COL = { adopt: '#3fb950', trial: ACCENT, assess: '#58a6ff', hold: '#bc8cff' }
const uid = () => 'g' + Math.random().toString(36).slice(2, 9)

function GoalList({ title, goals, onChange }) {
  const [draft, setDraft] = useState({ title: '', measure: '', target: '' })
  const add = () => { if (!draft.title.trim()) return toast('goal needs a title', 'error'); onChange([...goals, { id: uid(), ...draft, progress: 0, links: [] }]); setDraft({ title: '', measure: '', target: '' }) }
  const set = (i, patch) => { const g = [...goals]; g[i] = { ...g[i], ...patch }; onChange(g) }
  const del = i => onChange(goals.filter((_, j) => j !== i))
  return <div style={PANEL}>
    <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>{title}</div>
    {goals.map((g, i) => <div key={g.id} style={{ padding: '6px 0', borderTop: '1px solid #21262d' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, font: `500 12px ${MONO}` }}>{g.title} {g.measure ? <span style={{ color: '#8b949e' }}>· {g.measure} → {g.target}</span> : <span style={{ color: '#bc8cff' }}>· needs measure+target</span>}</div>
        <span style={{ font: `500 11px ${MONO}`, color: '#8b949e' }}>{g.progress || 0}%</span>
        <button onClick={() => del(i)} style={{ font: `400 11px ${MONO}`, color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
      </div>
      <input type="range" min="0" max="100" value={g.progress || 0} onChange={e => set(i, { progress: +e.target.value })} style={{ width: '100%', accentColor: ACCENT }} />
    </div>)}
    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
      <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="goal" style={inp(1, 120)} />
      <input value={draft.measure} onChange={e => setDraft({ ...draft, measure: e.target.value })} placeholder="measure" style={inp(0, 90)} />
      <input value={draft.target} onChange={e => setDraft({ ...draft, target: e.target.value })} placeholder="target" style={inp(0, 70)} />
      <button onClick={add} style={btn()}>+ add</button>
    </div>
  </div>
}
const inp = (flex, w) => ({ flex, minWidth: w, font: `400 11px ${MONO}`, background: '#161b22', color: '#e6edf3', border: '1px solid #8b949e55', borderRadius: 6, padding: '4px 8px' })
const btn = () => ({ font: `600 11px ${MONO}`, color: ACCENT, background: 'transparent', border: `1px solid ${ACCENT}55`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer' })

export default function LearningPanel() {
  const [learning, setLearning] = useState(null)
  const [courses, setCourses] = useState([])
  const [cDraft, setCDraft] = useState({ title: '', provider: '', status: 'in-progress', progress: 0 })
  const [tDraft, setTDraft] = useState({ tech: '', ring: 'trial', note: '' })
  useEffect(() => { api.get('/api/career/config').then(cfg => {
    setLearning(cfg.learning || { now: [], next: [], techRadar: [] }); setCourses(cfg.courses || [])
  }).catch(e => toast(e.message, 'error')) }, [])
  if (!learning) return <div style={{ ...PANEL, color: '#8b949e' }}>Loading…</div>

  const save = async () => {
    // a measurable goal requires measure + target (validate before save)
    const bad = [...learning.now, ...learning.next].find(g => (g.measure && !g.target) || (g.target && !g.measure))
    if (bad) return toast(`"${bad.title}" needs both measure and target`, 'error')
    try { await api.post('/api/career/config', { learning, courses }); toast('saved', 'success') } catch (e) { toast(e.message, 'error') }
  }
  const addTech = () => { if (!tDraft.tech.trim()) return; setLearning({ ...learning, techRadar: [...(learning.techRadar || []), { id: uid(), ...tDraft }] }); setTDraft({ tech: '', ring: 'trial', note: '' }) }
  const addCourse = () => { if (!cDraft.title.trim()) return; setCourses([...courses, { id: uid(), ...cDraft }]); setCDraft({ title: '', provider: '', status: 'in-progress', progress: 0 }) }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <GoalList title="Now learning" goals={learning.now || []} onChange={now => setLearning({ ...learning, now })} />
      <GoalList title="Will learn (next)" goals={learning.next || []} onChange={next => setLearning({ ...learning, next })} />

      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Courses</div>
        {courses.map((c, i) => <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', font: `400 12px ${MONO}` }}>
          <div style={{ flex: 1 }}>{c.title} <span style={{ color: '#8b949e' }}>· {c.provider} · {c.status} · {c.progress}%</span></div>
          <button onClick={() => setCourses(courses.filter((_, j) => j !== i))} style={{ font: `400 11px ${MONO}`, color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>)}
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <input value={cDraft.title} onChange={e => setCDraft({ ...cDraft, title: e.target.value })} placeholder="course" style={inp(1, 110)} />
          <input value={cDraft.provider} onChange={e => setCDraft({ ...cDraft, provider: e.target.value })} placeholder="provider" style={inp(0, 90)} />
          <input type="number" value={cDraft.progress} onChange={e => setCDraft({ ...cDraft, progress: +e.target.value })} placeholder="%" style={inp(0, 50)} />
          <button onClick={addCourse} style={btn()}>+ add</button>
        </div>
      </div>

      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Tech radar (will-learn backlog)</div>
        {RINGS.map(ring => { const rows = (learning.techRadar || []).filter(t => t.ring === ring); return rows.length ? <div key={ring} style={{ marginBottom: 6 }}>
          <div style={{ font: `600 11px ${MONO}`, color: RING_COL[ring], textTransform: 'uppercase' }}>{ring}</div>
          {rows.map(t => <div key={t.id} style={{ display: 'flex', gap: 8, font: `400 12px ${MONO}`, padding: '2px 0' }}>
            <div style={{ flex: 1 }}>{t.tech} {t.note ? <span style={{ color: '#8b949e' }}>— {t.note}</span> : null}</div>
            <button onClick={() => setLearning({ ...learning, techRadar: learning.techRadar.filter(x => x.id !== t.id) })} style={{ font: `400 11px ${MONO}`, color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
          </div>)}
        </div> : null })}
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <input value={tDraft.tech} onChange={e => setTDraft({ ...tDraft, tech: e.target.value })} placeholder="tech" style={inp(1, 100)} />
          <select value={tDraft.ring} onChange={e => setTDraft({ ...tDraft, ring: e.target.value })} style={inp(0, 80)}>{RINGS.map(r => <option key={r} value={r}>{r}</option>)}</select>
          <input value={tDraft.note} onChange={e => setTDraft({ ...tDraft, note: e.target.value })} placeholder="note" style={inp(1, 100)} />
          <button onClick={addTech} style={btn()}>+ add</button>
        </div>
      </div>

      <button onClick={save} style={{ font: `600 12px ${MONO}`, color: '#0d1117', background: ACCENT, border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', justifySelf: 'start' }}>Save</button>
    </div>
  )
}
