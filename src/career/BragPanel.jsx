import React, { useEffect, useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, BODY, ACCENT, GREEN, MUTE, INK } from './theme.jsx'
import { useEngSelf } from './data.jsx'
export default function BragPanel({ reload }) {
  const [data, setData] = useState({ candidates: [], entries: [] })
  const [retro, setRetro] = useState({ worked: '', didnt: '', change: '' })
  const [importing, setImporting] = useState(false)
  const { data: eng } = useEngSelf()
  const load = () => api.get('/api/career/brag').then(setData).catch(e => toast(e.message, 'error'))
  useEffect(() => { load() }, [])
  const importGh = async () => {
    setImporting(true)
    try { const r = await api.post('/api/career/import/github'); toast(`imported ${r.prs} PRs`, 'success'); load(); reload?.() }
    catch (e) { toast(e.message, 'error') } finally { setImporting(false) }
  }
  const accept = async (c) => { await api.post('/api/career/brag', { entry: { title: c.title, impact: c.impact, evidence: c.evidence } }); toast('added to brag log', 'success'); load(); reload?.() }

  // JIRA-derived candidates: recently shipped tickets + cross-team bug fixes
  const engCandidates = eng?.accountId ? [
    ...eng.issues.filter(i => i.live && !i.isBug).sort((a, b) => Date.parse(b.closedAt || 0) - Date.parse(a.closedAt || 0)).slice(0, 6)
      .map(i => ({ id: i.key, title: `Shipped ${i.key}: ${i.summary}`, impact: `${i.delivery}d cycle · ${i.pts || '?'} pts`, evidence: i.host ? `https://${i.host}/browse/${i.key}` : i.key })),
    ...eng.issues.filter(i => i.isBug && i.fixerId === eng.accountId && i.ownerId !== eng.accountId).slice(0, 3)
      .map(i => ({ id: i.key, title: `Fixed teammate's bug ${i.key}`, impact: 'cross-team support', evidence: i.host ? `https://${i.host}/browse/${i.key}` : i.key })),
  ] : []
  const saveRetro = async () => { const weekOf = new Date().toISOString().slice(0, 10); await api.post('/api/career/retro', { weekOf, ...retro }); setRetro({ worked: '', didnt: '', change: '' }); toast('retro saved', 'success') }
  const exportStory = async () => { const { markdown } = await api.get('/api/career/story-so-far'); await navigator.clipboard.writeText(markdown); toast('story-so-far copied', 'success') }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={PANEL}>
        <div style={{ display: 'flex', alignItems: 'center' }}><div style={{ font: `600 13px ${HEAD}`, color: ACCENT, flex: 1 }}>Brag log ({data.entries.length})</div>
          <button onClick={exportStory} style={{ font: `600 11px ${MONO}`, color: ACCENT, background: 'transparent', border: `1px solid ${ACCENT}55`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>⧉ story-so-far</button></div>
        {data.entries.slice(-10).reverse().map(e => <div key={e.id} style={{ font: `400 12px ${MONO}`, padding: '4px 0' }}>• {e.title}</div>)}
      </div>
      {/* item 16 — candidates harvested from merged PRs, review footprint and ownership keystones.
          When the GitHub drop is missing the server returns [] — which means "not imported", NOT
          "you did nothing". Say that, and give the button that fixes it. */}
      <div style={PANEL}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, flex: 1 }}>Auto-harvested candidates <span style={{ color: MUTE, font: `400 11px ${MONO}` }}>· merged PRs · reviews given · ownership keystones · JIRA</span></div>
          <button onClick={importGh} disabled={importing} style={{ font: `600 11px ${MONO}`, color: importing ? MUTE : ACCENT, background: 'transparent', border: `1px solid ${importing ? '#30363d' : ACCENT + '55'}`, borderRadius: 6, padding: '4px 8px', cursor: importing ? 'default' : 'pointer' }}>{importing ? '↻ importing…' : '↓ import GitHub'}</button>
        </div>
        {/* the GitHub-sourced half of the harvest is missing → say so even when JIRA has candidates,
            otherwise the absent source looks like an absent contribution */}
        {!data.candidates.length && engCandidates.length ? (
          <div style={{ font: `400 11px ${BODY}`, color: MUTE, marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #21262d' }}>
            Showing JIRA-derived lines only — the merged-PR, review-footprint and ownership-keystone harvest needs a GitHub import, which is not configured.
          </div>
        ) : null}
        {[...engCandidates, ...data.candidates].length ? [...engCandidates, ...data.candidates].map(c => <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0' }}>
          <div style={{ flex: 1, font: `400 12px ${MONO}`, color: '#e6edf3' }}>{c.title}{c.impact ? <span style={{ color: GREEN }}> · {c.impact}</span> : null}</div>
          <button onClick={() => accept(c)} style={{ font: `600 11px ${MONO}`, color: ACCENT, background: 'transparent', border: `1px solid ${ACCENT}55`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>+ add</button>
        </div>) : (
          <div style={{ font: `400 12px ${BODY}`, color: MUTE, lineHeight: 1.6 }}>
            No GitHub import configured — the merged-PR / review-footprint / ownership harvest has nothing to read.
            <br /><b style={{ color: INK }}>This is an empty source, not an empty year.</b> Hit <b style={{ color: ACCENT }}>↓ import GitHub</b> above (it shells the gh CLI you are already logged into, writes one JSON drop, and uploads nothing).
          </div>
        )}
      </div>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Weekly retro (feeds Analyze + streak)</div>
        {['worked', 'didnt', 'change'].map(k => <input key={k} value={retro[k]} onChange={e => setRetro(r => ({ ...r, [k]: e.target.value }))} placeholder={k === 'worked' ? 'what worked' : k === 'didnt' ? "what didn't" : 'what I will do differently'} style={{ display: 'block', width: '100%', marginBottom: 6, font: `400 12px ${MONO}`, background: '#161b22', color: '#e6edf3', border: '1px solid #8b949e55', borderRadius: 6, padding: '6px 8px' }} />)}
        <button onClick={saveRetro} style={{ font: `600 11px ${MONO}`, color: '#0d1117', background: ACCENT, border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>save retro</button>
      </div>
    </div>
  )
}
