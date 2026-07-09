import React, { useEffect, useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, BODY, ACCENT, MUTE, INK, GREEN, Ring as DonutRing } from './theme.jsx'
import { useEngSelf } from './data.jsx'

const uid = () => 'o' + Math.random().toString(36).slice(2, 9)
// enumerated snapshot metrics a KR can auto-track (lower-is-better noted; the ring just shows current/target)
const METRICS = [
  { ref: '', label: '— manual (no metric) —' },
  { ref: 'quality.changeFailProxy', label: 'quality.changeFailProxy (escaped bug ratio)' },
  { ref: 'quality.myPrCount', label: 'quality.myPrCount' },
  { ref: 'flow.afterHoursPct', label: 'flow.afterHoursPct' },
  { ref: 'flow.wip', label: 'flow.wip' },
  { ref: 'workflow.oneShotRate', label: 'workflow.oneShotRate' },
  { ref: 'workflow.interruptRate', label: 'workflow.interruptRate' },
]

const inp = (flex, w) => ({ flex, minWidth: w, font: `400 11px ${MONO}`, background: '#161b22', color: '#e6edf3', border: '1px solid #8b949e55', borderRadius: 6, padding: '4px 8px' })
const btn = (bg = ACCENT) => ({ font: `600 11px ${MONO}`, color: '#0d1117', background: bg, border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' })

function Ring({ current, target }) {
  if (current == null || target == null) return <span style={{ font: `400 11px ${MONO}`, color: '#8b949e' }}>{current ?? '—'} / {target ?? '—'}</span>
  const pct = target === 0 ? (current === 0 ? 1 : 0) : Math.max(0, Math.min(1, current <= target ? 1 : target / current))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: '#8b949e33', borderRadius: 4 }}><div style={{ width: `${pct * 100}%`, height: '100%', background: pct >= 1 ? '#3fb950' : ACCENT, borderRadius: 4 }} /></div>
      <span style={{ font: `400 10.5px ${MONO}`, color: '#8b949e' }}>{Number(current).toFixed(2)} → {target}</span>
    </div>
  )
}

// compute progress of a JIRA parent (epic / story) from its children in the eng snapshot
function epicProgress(issues, parentKey) {
  if (!parentKey || !issues) return null
  const key = parentKey.trim().toUpperCase()
  const children = issues.filter(i => (i.parent?.key || '').toUpperCase() === key || (i.linkedKey || '').toUpperCase() === key)
  const self = issues.find(i => i.key.toUpperCase() === key)
  if (!children.length && !self) return { unknown: true, key }
  const done = children.filter(i => i.live).length
  const total = children.length
  return { key, done, total, pct: total ? done / total : (self?.live ? 1 : 0), selfStatus: self?.status, host: self?.host || children[0]?.host, children }
}

export default function OkrPanel({ snap }) {
  const [okrs, setOkrs] = useState(null)
  const [o, setO] = useState({ objective: '', quarter: '' })
  const { data: eng } = useEngSelf()
  useEffect(() => { api.get('/api/career/config').then(cfg => setOkrs(cfg.okrs || [])).catch(e => toast(e.message, 'error')) }, [])
  if (!okrs) return <div style={{ ...PANEL, color: '#8b949e' }}>Loading…</div>
  // live KR.current comes from the snapshot (auto-tracking); merge onto the authored config
  const live = Object.fromEntries((snap?.okrs || []).map(x => [x.id, x]))
  const engIssues = eng?.allIssues || eng?.issues || []

  const persist = async (next) => { setOkrs(next); try { await api.post('/api/career/config', { okrs: next }); toast('saved', 'success') } catch (e) { toast(e.message, 'error') } }
  const addOkr = () => { if (!o.objective.trim()) return toast('objective required', 'error'); persist([...okrs, { id: uid(), objective: o.objective, quarter: o.quarter, jiraParent: '', krs: [] }]); setO({ objective: '', quarter: '' }) }
  const setObj = (oid, patch) => persist(okrs.map(x => x.id === oid ? { ...x, ...patch } : x))
  const addKr = (oid) => persist(okrs.map(x => x.id === oid ? { ...x, krs: [...x.krs, { id: uid(), text: 'new KR', metricRef: '', target: 1 }] } : x))
  const setKr = (oid, kid, patch) => persist(okrs.map(x => x.id === oid ? { ...x, krs: x.krs.map(k => k.id === kid ? { ...k, ...patch } : k) } : x))
  const closeKr = async (kr) => { try { const r = await api.post('/api/career/okr/close-kr', { krId: kr.id, text: kr.text }); toast(`+XP (total ${r.xp})`, 'success') } catch (e) { toast(e.message, 'error') } }
  const del = (oid) => persist(okrs.filter(x => x.id !== oid))

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>New objective</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input value={o.objective} onChange={e => setO({ ...o, objective: e.target.value })} placeholder="objective…" style={inp(1, 200)} />
          <input value={o.quarter} onChange={e => setO({ ...o, quarter: e.target.value })} placeholder="2026Q3" style={inp(0, 90)} />
          <button onClick={addOkr} style={btn()}>+ OKR</button>
        </div>
      </div>

      {okrs.map(x => {
        const prog = epicProgress(engIssues, x.jiraParent)
        return (
        <div key={x.id} style={PANEL}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {prog && !prog.unknown && <DonutRing value={prog.pct} label={`${Math.round(prog.pct * 100)}%`} size={54} stroke={6} color={prog.pct >= 1 ? GREEN : ACCENT} />}
            <div style={{ flex: 1 }}>
              <div style={{ font: `600 14px ${HEAD}`, color: INK }}>{x.objective}</div>
              {prog && !prog.unknown && <div style={{ font: `400 11px ${MONO}`, color: MUTE, marginTop: 2 }}>
                <a href={prog.host ? `https://${prog.host}/browse/${prog.key}` : undefined} target="_blank" rel="noreferrer" style={{ color: ACCENT, textDecoration: 'none' }}>{prog.key}</a> · {prog.done}/{prog.total} child tickets live{prog.selfStatus ? ` · epic ${prog.selfStatus}` : ''}
              </div>}
              {prog?.unknown && <div style={{ font: `400 11px ${MONO}`, color: MUTE, marginTop: 2 }}>{prog.key} — no children found in JIRA snapshot</div>}
            </div>
            <span style={{ font: `400 10.5px ${MONO}`, color: MUTE }}>{x.quarter}</span>
            <button onClick={() => del(x.id)} style={{ font: `400 11px ${MONO}`, color: MUTE, background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
            <span style={{ font: `400 11px ${MONO}`, color: MUTE }}>JIRA parent</span>
            <input value={x.jiraParent || ''} onChange={e => setObj(x.id, { jiraParent: e.target.value })} placeholder="epic / story key e.g. AIR-1234" style={inp(0, 180)} />
            <span style={{ font: `400 10.5px ${MONO}`, color: MUTE }}>progress = child tickets Live ÷ total</span>
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {(live[x.id]?.krs || x.krs).map(k => (
              <div key={k.id} style={{ display: 'grid', gap: 4, borderTop: '1px solid #8b949e22', paddingTop: 6 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input value={k.text} onChange={e => setKr(x.id, k.id, { text: e.target.value })} style={inp(1, 140)} />
                  <select value={k.metricRef || ''} onChange={e => setKr(x.id, k.id, { metricRef: e.target.value })} style={inp(0, 150)}>
                    {METRICS.map(m => <option key={m.ref} value={m.ref}>{m.label}</option>)}
                  </select>
                  <input type="number" step="0.01" value={k.target ?? ''} onChange={e => setKr(x.id, k.id, { target: Number(e.target.value) })} placeholder="target" style={inp(0, 70)} />
                  <button onClick={() => closeKr(k)} style={btn('#3fb950')}>close ✓</button>
                </div>
                <Ring current={k.current} target={k.target} />
              </div>
            ))}
            <button onClick={() => addKr(x.id)} style={{ ...btn('transparent'), color: ACCENT, border: `1px solid ${ACCENT}55`, alignSelf: 'start' }}>+ KR</button>
          </div>
        </div>
      )})}
    </div>
  )
}
