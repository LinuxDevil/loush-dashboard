import React, { useEffect, useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, ACCENT, GREEN, PURPLE, INK, Tile } from './theme.jsx'
import { useEngSelf } from './data.jsx'

const uid = () => 'own' + Math.random().toString(36).slice(2, 9)
const inp = (flex, w) => ({ flex, minWidth: w, font: `400 11px ${MONO}`, background: '#161b22', color: '#e6edf3', border: '1px solid #8b949e55', borderRadius: 6, padding: '4px 8px' })

const Section = ({ title, items }) => (
  <div style={PANEL}>
    <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 6 }}>{title}</div>
    {items.length ? items.map((it, i) => (
      <div key={i} style={{ font: `400 12px ${MONO}`, color: '#8b949e', marginBottom: 3 }}>{it.label}{it.evidence ? <span style={{ color: '#8b949e' }}> · {it.evidence}</span> : null}</div>
    )) : <div style={{ font: `400 12px ${MONO}`, color: '#8b949e' }}>Nothing yet.</div>}
  </div>
)

// Read-mostly: auto-seeded from Decision Log (ADRs) + GitHub reviews-for-others; manual add for talks/OSS/owned.
export default function InfluencePanel({ snap }) {
  const [cfg, setCfg] = useState(null)
  const [o, setO] = useState({ type: 'talk', label: '', evidence: '' })
  const { data: eng } = useEngSelf()
  useEffect(() => { api.get('/api/career/config').then(setCfg).catch(e => toast(e.message, 'error')) }, [])
  if (!cfg) return <div style={{ ...PANEL, color: '#8b949e' }}>Loading…</div>

  const adrs = (cfg.decisions || []).filter(d => d.becameAdr).map(d => ({ label: d.chose, evidence: 'ADR' }))
  const reviewedFor = snap?.github?.reviewFootprint?.reviewedForOthers || {}
  // cross-team fixes: bugs I resolved (fixer) that I didn't originate (owner) → mentorship signal from JIRA
  const crossFixes = (eng?.issues || []).filter(i => i.isBug && i.fixerId === eng.accountId && i.ownerId !== eng.accountId)
  const mentorship = Object.entries(reviewedFor).map(([who, n]) => ({ label: `Reviewed ${n} PR(s) for ${who}`, evidence: 'github' }))
    .concat(crossFixes.slice(0, 8).map(i => ({ label: `Fixed ${i.key} (${i.owner?.name || 'teammate'}'s bug)`, evidence: 'jira' })))
  const owned = (cfg.ownership || [])
  const byType = t => owned.filter(x => x.type === t).map(x => ({ label: x.label, evidence: x.evidence }))

  const persist = async (next) => { setCfg({ ...cfg, ownership: next }); try { await api.post('/api/career/config', { ownership: next }); toast('saved', 'success') } catch (e) { toast(e.message, 'error') } }
  const add = () => { if (!o.label.trim()) return toast('label required', 'error'); persist([...(cfg.ownership || []), { id: uid(), ...o }]); setO({ type: 'talk', label: '', evidence: '' }) }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {eng?.dora && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Tile label="PRs authored" value={(eng.prs || []).length} sub="merged + open" tone={ACCENT} />
          <Tile label="shipped (90d)" value={eng.dora.throughput90} sub="delivered tickets" tone={GREEN} />
          <Tile label="cross-team fixes" value={crossFixes.length} sub="others' bugs I resolved" tone={PURPLE} />
        </div>
      )}
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
          <button onClick={add} style={{ font: `600 11px ${MONO}`, color: '#0d1117', background: ACCENT, border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>+ add</button>
        </div>
      </div>
    </div>
  )
}
