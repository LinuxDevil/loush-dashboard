import React, { useEffect, useState } from 'react'
import { api, toast } from './api.js'
import { PANEL, HEAD, BODY, MONO, ACCENT, BG, PANEL_BG, LINE, INK, MUTE } from './career/theme.jsx'
import { SubTabs } from './career/charts.jsx'
import { resetCareerData } from './career/data.jsx'
import OverviewPage from './career/OverviewPage.jsx'
import DeliveryPage from './career/DeliveryPage.jsx'
import QualityPanel from './career/QualityPanel.jsx'
import WorkflowPanel from './career/WorkflowPanel.jsx'
import InsightsProjectPanel from './career/InsightsProjectPanel.jsx'
import OkrPanel from './career/OkrPanel.jsx'
import CompetencyPanel from './career/CompetencyPanel.jsx'
import LearningPanel from './career/LearningPanel.jsx'
import InfluencePanel from './career/InfluencePanel.jsx'
import AllocationPanel from './career/AllocationPanel.jsx'
import BragPanel from './career/BragPanel.jsx'
import OneOnOnePanel from './career/OneOnOnePanel.jsx'
import FeedbackPanel from './career/FeedbackPanel.jsx'
import DecisionPanel from './career/DecisionPanel.jsx'
import LessonsPanel from './career/LessonsPanel.jsx'
import GamePanel from './career/GamePanel.jsx'

// composed page with an intra-page sub-tab strip
function SubPage({ tabs }) {
  const [t, setT] = useState(tabs[0].label)
  const cur = tabs.find(x => x.label === t) || tabs[0]
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SubTabs tabs={tabs.map(x => x.label)} active={t} onChange={setT} />
      {cur.render()}
    </div>
  )
}

// 8 pages. Each render() gets the current snapshot + reload via closure.
function pagesFor(snap, reload) {
  return {
    'Overview': () => <OverviewPage snap={snap} />,
    'Delivery': () => <DeliveryPage snap={snap} reload={reload} />,
    'Quality': () => <QualityPanel snap={snap} />,
    'Workflow': () => <SubPage tabs={[
      { label: 'Workflow', render: () => <WorkflowPanel snap={snap} /> },
      { label: 'Insights', render: () => <InsightsProjectPanel snap={snap} /> },
    ]} />,
    'Growth': () => <SubPage tabs={[
      { label: 'OKRs', render: () => <OkrPanel snap={snap} /> },
      { label: 'Competency', render: () => <CompetencyPanel /> },
      { label: 'Learning', render: () => <LearningPanel /> },
    ]} />,
    'Influence': () => <SubPage tabs={[
      { label: 'Influence', render: () => <InfluencePanel snap={snap} /> },
      { label: 'Allocation', render: () => <AllocationPanel snap={snap} /> },
    ]} />,
    'Journal': () => <SubPage tabs={[
      { label: 'Brag', render: () => <BragPanel reload={reload} /> },
      { label: '1:1 Prep', render: () => <OneOnOnePanel reload={reload} /> },
      { label: 'Feedback', render: () => <FeedbackPanel snap={snap} /> },
      { label: 'Decisions', render: () => <DecisionPanel /> },
      { label: 'Lessons', render: () => <LessonsPanel snap={snap} reload={reload} /> },
    ]} />,
    'Game': () => <GamePanel snap={snap} />,
  }
}

// side menu: [icon, label]
const NAV = [
  ['Now', [['◆', 'Overview'], ['▤', 'Delivery'], ['✦', 'Quality']]],
  ['Work', [['⟳', 'Workflow'], ['▲', 'Growth'], ['➤', 'Influence']]],
  ['Reflect', [['✎', 'Journal'], ['♜', 'Game']]],
]

function Skeleton() {
  const pulse = { background: PANEL_BG, border: `1px solid ${LINE}`, borderRadius: 10, animation: 'crPulse 1.4s ease-in-out infinite' }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <style>{`@keyframes crPulse{0%,100%{opacity:.45}50%{opacity:.9}}`}</style>
      <div style={{ display: 'flex', gap: 16 }}>{[0, 1, 2, 3].map(i => <div key={i} style={{ ...pulse, height: 74, flex: 1, animationDelay: `${i * 0.12}s` }} />)}</div>
      <div style={{ ...pulse, height: 160 }} />
      <div style={{ ...pulse, height: 220 }} />
    </div>
  )
}

// '' = full year to date. Only the current year is shown — no prior year.
const PERIODS = [['', 'Year'], ['Q1', 'Q1'], ['Q2', 'Q2'], ['Q3', 'Q3'], ['Q4', 'Q4']]

export default function CareerDashboard({ onExit }) {
  const [snap, setSnap] = useState(null)
  const [tab, setTab] = useState('Overview')
  const [period, setPeriod] = useState('')
  const [busy, setBusy] = useState(false)
  const load = (p = period) => api.get('/api/career/snapshot' + (p ? `?period=${p}` : '')).then(setSnap).catch(e => toast(e.message, 'error'))
  useEffect(() => { setSnap(null); load(period) }, [period])
  const refresh = async () => { setBusy(true); try { resetCareerData(); await api.post('/api/career/refresh'); await load() } finally { setBusy(false) } }

  const pages = snap ? pagesFor(snap, load) : null

  const btn = (active) => ({
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
    font: `${active ? 600 : 400} 13px ${BODY}`, color: active ? INK : MUTE,
    background: active ? '#1f6feb1a' : 'transparent',
    border: '1px solid ' + (active ? '#1f6feb44' : 'transparent'),
    borderRadius: 7, padding: '7px 10px', cursor: 'pointer', transition: 'background .12s',
  })

  return (
    <div style={{ minHeight: '100vh', background: BG, color: INK, display: 'flex', font: `400 13px ${BODY}` }}>
      <style>{`.cr-nav button:hover{background:#ffffff0a!important}@keyframes crSpin{to{transform:rotate(360deg)}}@keyframes crPulse{0%,100%{opacity:.45}50%{opacity:.9}}`}</style>
      <aside style={{ width: 208, borderRight: `1px solid ${LINE}`, padding: '18px 12px', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 18px' }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: ACCENT, boxShadow: `0 0 10px ${ACCENT}` }} />
          <span style={{ font: `600 15px ${HEAD}`, color: INK, letterSpacing: '-0.3px' }}>Career</span>
        </div>
        <nav className="cr-nav" style={{ display: 'grid', gap: 16 }}>
          {NAV.map(([group, items]) => (
            <div key={group}>
              <div style={{ font: `500 10px ${MONO}`, color: MUTE, textTransform: 'uppercase', letterSpacing: '1px', padding: '0 10px 6px' }}>{group}</div>
              <div style={{ display: 'grid', gap: 2 }}>
                {items.map(([icon, t]) => (
                  <button key={t} onClick={() => setTab(t)} style={btn(tab === t)}>
                    <span style={{ width: 16, textAlign: 'center', opacity: tab === t ? 1 : 0.6, color: tab === t ? ACCENT : 'inherit' }}>{icon}</span>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <main style={{ flex: 1, minWidth: 0 }}>
        <header style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 28px', borderBottom: `1px solid ${LINE}`, background: `${BG}e6`, backdropFilter: 'blur(8px)' }}>
          <div style={{ font: `600 14px ${HEAD}`, color: INK }}>{tab}</div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 2, padding: 2, background: PANEL_BG, border: `1px solid ${LINE}`, borderRadius: 8 }}>
            {PERIODS.map(([val, lbl]) => (
              <button key={val || 'year'} onClick={() => setPeriod(val)} title={val ? `${new Date().getFullYear()} ${lbl}` : `${new Date().getFullYear()} to date`}
                style={{ font: `${period === val ? 600 : 400} 12px ${MONO}`, color: period === val ? INK : MUTE,
                  background: period === val ? '#1f6feb1a' : 'transparent', border: '1px solid ' + (period === val ? '#1f6feb44' : 'transparent'),
                  borderRadius: 6, padding: '5px 11px', cursor: 'pointer' }}>{lbl}</button>
            ))}
          </div>
          <button onClick={refresh} disabled={busy} style={{ font: `500 12px ${MONO}`, color: busy ? MUTE : ACCENT, background: '#1f6feb14', border: `1px solid ${busy ? LINE : '#1f6feb44'}`, borderRadius: 7, padding: '6px 12px', cursor: busy ? 'default' : 'pointer' }}>{busy ? '↻ refreshing…' : '↻ refresh'}</button>
          <button onClick={onExit} style={{ font: `500 12px ${MONO}`, color: MUTE, background: 'transparent', border: `1px solid ${LINE}`, borderRadius: 7, padding: '6px 12px', cursor: 'pointer' }}>⇄ Claude</button>
        </header>
        <div style={{ padding: '24px 28px', maxWidth: 1180 }}>{pages ? (pages[tab] || pages['Overview'])() : <Skeleton />}</div>
      </main>
    </div>
  )
}
