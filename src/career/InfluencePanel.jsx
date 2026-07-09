import React, { useEffect, useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, ACCENT } from './theme.jsx'

const uid = () => 'own' + Math.random().toString(36).slice(2, 9)
const inp = (flex, w) => ({ flex, minWidth: w, font: `400 11px ${MONO}`, background: '#1c1815', color: '#e5dbd2', border: '1px solid #7a716a55', borderRadius: 6, padding: '4px 8px' })

const Section = ({ title, items }) => (
  <div style={PANEL}>
    <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 6 }}>{title}</div>
    {items.length ? items.map((it, i) => (
      <div key={i} style={{ font: `400 12px ${MONO}`, color: '#9a8f86', marginBottom: 3 }}>{it.label}{it.evidence ? <span style={{ color: '#7a716a' }}> · {it.evidence}</span> : null}</div>
    )) : <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>Nothing yet.</div>}
  </div>
)

// Read-mostly: auto-seeded from Decision Log (ADRs) + GitHub reviews-for-others; manual add for talks/OSS/owned.
export default function InfluencePanel({ snap }) {
  const [cfg, setCfg] = useState(null)
  const [o, setO] = useState({ type: 'talk', label: '', evidence: '' })
  useEffect(() => { api.get('/api/career/config').then(setCfg).catch(e => toast(e.message, 'error')) }, [])
  if (!cfg) return <div style={{ ...PANEL, color: '#7a716a' }}>Loading…</div>

  const adrs = (cfg.decisions || []).filter(d => d.becameAdr).map(d => ({ label: d.chose, evidence: 'ADR' }))
  const reviewedFor = snap?.github?.reviewFootprint?.reviewedForOthers || {}
  const mentorship = Object.entries(reviewedFor).map(([who, n]) => ({ label: `Reviewed ${n} PR(s) for ${who}`, evidence: 'github' }))
  const owned = (cfg.ownership || [])
  const byType = t => owned.filter(x => x.type === t).map(x => ({ label: x.label, evidence: x.evidence }))

  const persist = async (next) => { setCfg({ ...cfg, ownership: next }); try { await api.post('/api/career/config', { ownership: next }); toast('saved', 'success') } catch (e) { toast(e.message, 'error') } }
  const add = () => { if (!o.label.trim()) return toast('label required', 'error'); persist([...(cfg.ownership || []), { id: uid(), ...o }]); setO({ type: 'talk', label: '', evidence: '' }) }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Section title="ADRs & design docs" items={adrs} />
      <Section title="Mentorship (reviews for others)" items={mentorship} />
      <Section title="Talks / writing / OSS" items={byType('talk').concat(byType('oss'))} />
      <Section title="Systems owned" items={byType('system')} />

      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Add influence evidence</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select value={o.type} onChange={e => setO({ ...o, type: e.target.value })} style={inp(0, 90)}>
            {['talk', 'oss', 'system', 'design-doc'].map(t => <option key={t}>{t}</option>)}
          </select>
          <input value={o.label} onChange={e => setO({ ...o, label: e.target.value })} placeholder="what…" style={inp(1, 160)} />
          <input value={o.evidence} onChange={e => setO({ ...o, evidence: e.target.value })} placeholder="link/evidence" style={inp(1, 120)} />
          <button onClick={add} style={{ font: `600 11px ${MONO}`, color: '#0d0b0a', background: ACCENT, border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>+ add</button>
        </div>
      </div>
    </div>
  )
}
