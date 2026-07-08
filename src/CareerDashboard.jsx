import React, { useEffect, useState } from 'react'
import { api, toast } from './api.js'
import { PANEL, HEAD, MONO, ACCENT } from './career/theme.jsx'
import MePanel from './career/MePanel.jsx'
import TasksPanel from './career/TasksPanel.jsx'
import FlowPanel from './career/FlowPanel.jsx'
import QualityPanel from './career/QualityPanel.jsx'
import InsightsProjectPanel from './career/InsightsProjectPanel.jsx'

const TABS = ['Me / Now', 'Tasks', 'Flow', 'Quality', 'Insights', 'Brag', '1:1 Prep']

export default function CareerDashboard({ onExit }) {
  const [snap, setSnap] = useState(null)
  const [tab, setTab] = useState('Me / Now')
  const [busy, setBusy] = useState(false)
  const load = () => api.get('/api/career/snapshot').then(setSnap).catch(e => toast(e.message, 'error'))
  useEffect(() => { load() }, [])
  const refresh = async () => { setBusy(true); try { await api.post('/api/career/refresh'); await load() } finally { setBusy(false) } }
  return (
    <div style={{ minHeight: '100vh', background: '#0d0b0a', color: '#e5dbd2', padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <div style={{ font: `700 22px ${HEAD}`, color: ACCENT }}>Career</div>
        <div style={{ flex: 1 }} />
        <button onClick={refresh} disabled={busy} style={{ font: `600 12px ${MONO}`, color: ACCENT, background: 'transparent', border: `1px solid ${ACCENT}55`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>{busy ? 'refreshing…' : '↻ refresh'}</button>
        <button onClick={onExit} style={{ font: `600 12px ${MONO}`, color: '#7a716a', background: 'transparent', border: '1px solid #7a716a55', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>⇄ Claude</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {TABS.map(t => <button key={t} onClick={() => setTab(t)} style={{ font: `600 12px ${MONO}`, color: tab === t ? '#0d0b0a' : '#e5dbd2', background: tab === t ? ACCENT : 'transparent', border: `1px solid ${ACCENT}55`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>{t}</button>)}
      </div>
      {!snap ? <div style={{ ...PANEL, color: '#7a716a' }}>Loading… (run ↻ refresh if empty)</div>
        : tab === 'Me / Now' ? <MePanel snap={snap} />
        : tab === 'Tasks' ? <TasksPanel snap={snap} reload={load} />
        : tab === 'Flow' ? <FlowPanel snap={snap} />
        : tab === 'Quality' ? <QualityPanel snap={snap} />
        : tab === 'Insights' ? <InsightsProjectPanel snap={snap} />
        : <div style={{ ...PANEL }}>Panel "{tab}" — wired in Tasks 11–16. Snapshot has {snap.projects?.length || 0} projects, {snap.focus?.length || 0} focus items.</div>}
    </div>
  )
}
