import React, { useEffect, useState, useCallback } from 'react'
import { api, toast } from './api.js'
import { PANEL, HEAD, BODY, MONO, ACCENT, BG, PANEL_BG, LINE, INK, MUTE, PURPLE } from './career/theme.jsx'
import { SubTabs } from './career/charts.jsx'
import { resetCareerData, setEngPeriod, priorPeriod } from './career/data.jsx'
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
import FocusPanel from './career/FocusPanel.jsx'
import TasksPanel from './career/TasksPanel.jsx'
import TicketRetroPanel from './career/TicketRetroPanel.jsx'
import ReviewsPanel from './career/ReviewsPanel.jsx'
import EstimationPanel from './career/EstimationPanel.jsx'
// the rebuild
import TeamBoard from './career/TeamBoard.jsx'
import ReviewFlow from './career/ReviewFlow.jsx'
import FlowBottleneck from './career/FlowBottleneck.jsx'
import EffortMix from './career/EffortMix.jsx'
import Commitments from './career/Commitments.jsx'
import OwnershipMap from './career/OwnershipMap.jsx'
import CiHealth from './career/CiHealth.jsx'
import Sustainability from './career/Sustainability.jsx'
import PersonPacket from './career/PersonPacket.jsx'
import HarnessROI from './career/HarnessROI.jsx'
import RunEconomics from './career/RunEconomics.jsx'
import TicketEconomics from './career/TicketEconomics.jsx'
import Omnibox from './career/Omnibox.jsx'

// composed page with an intra-page sub-tab strip. These are ordinary navigation tabs — NOT a lens,
// scope or role switcher. There is none of those in this app, by design: scope is a property of the
// DATA (enforced in server-team.mjs), never a mode the viewer picks.
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

// The privacy contract, stated in one line on every page that shows another human being.
function PlaneBanner() {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '9px 12px', background: '#1f6feb14', border: `1px solid #1f6feb33`, borderRadius: 8, font: `400 11.5px ${BODY}`, color: MUTE, lineHeight: 1.5 }}>
      <span style={{ color: ACCENT }}>◈</span>
      <span>
        <b style={{ color: INK }}>Work artifacts only.</b> Every fact on this page comes from JIRA or GitHub — things the person
        can already open about themselves. No transcript, token, cost, hour or session field can reach it: the endpoint that
        builds it throws if one tries. Rows are alphabetical and carry no score. Hit <b style={{ color: INK }}>{'{ }'}</b> on any
        panel for the raw payload and check.
      </span>
    </div>
  )
}

// Team page — one page. Everything on it is Plane A.
function TeamPage() {
  const [person, setPerson] = useState(null)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PlaneBanner />
      <TeamBoard onPacket={setPerson} />
      <ReviewFlow />
      <OwnershipMap />
      <CiHealth />
      <Sustainability />
      <PersonPacket personId={person} onPerson={setPerson} />
    </div>
  )
}

// 9 pages. Each render() gets the current snapshot + reload via closure.
function pagesFor(snap, reload, setTab) {
  return {
    'Overview': () => <OverviewPage snap={snap} onGoto={setTab} />,
    'Delivery': () => (
      <div style={{ display: 'grid', gap: 16 }}>
        <DeliveryPage snap={snap} reload={reload} />
        <FlowBottleneck />
        <EffortMix />
        <Commitments />
      </div>
    ),
    'Team': () => <TeamPage />,
    'Quality': () => <QualityPanel snap={snap} />,
    'Focus': () => <SubPage tabs={[
      { label: 'Focus', render: () => <FocusPanel snap={snap} reload={reload} /> },
      { label: 'Tasks', render: () => <TasksPanel snap={snap} reload={reload} /> },
    ]} />,
    // Harness is Tier-A-free by construction: it is the page that structurally cannot be rolled up.
    'Harness': () => (
      <div style={{ display: 'grid', gap: 16 }}>
        <HarnessROI />
        <RunEconomics />
        <TicketEconomics />
        <SubPage tabs={[
          { label: 'Workflow', render: () => <WorkflowPanel snap={snap} /> },
          { label: 'Session allocation', render: () => <AllocationPanel snap={snap} /> },
          { label: 'Insights', render: () => <InsightsProjectPanel snap={snap} /> },
        ]} />
      </div>
    ),
    'Journal': () => <SubPage tabs={[
      { label: 'Brag', render: () => <BragPanel reload={reload} /> },
      { label: '1:1 Prep', render: () => <OneOnOnePanel reload={reload} /> },
      { label: 'Feedback', render: () => <FeedbackPanel snap={snap} /> },
      { label: 'Decisions', render: () => <DecisionPanel /> },
      { label: 'Lessons', render: () => <LessonsPanel snap={snap} reload={reload} /> },
      { label: 'Retro', render: () => <TicketRetroPanel /> },
    ]} />,
    // twice-a-year artifacts, off the daily path
    'Review season': () => <SubPage tabs={[
      { label: 'OKRs', render: () => <OkrPanel snap={snap} /> },
      { label: 'Competency', render: () => <CompetencyPanel /> },
      { label: 'Learning', render: () => <LearningPanel /> },
      { label: 'Estimation', render: () => <EstimationPanel /> },
      { label: 'Influence', render: () => <InfluencePanel snap={snap} /> },
      { label: 'My reviews', render: () => <ReviewsPanel snap={snap} /> },
    ]} />,
  }
}

// side menu: [icon, label]
const NAV = [
  ['Now', [['◆', 'Overview'], ['▤', 'Delivery'], ['◈', 'Team'], ['✦', 'Quality'], ['◎', 'Focus']]],
  ['Me', [['⟳', 'Harness']]],
  ['Reflect', [['✎', 'Journal'], ['▲', 'Review season']]],
]
const TABS = NAV.flatMap(([, items]) => items.map(([, t]) => t))

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

// item 4 — the year clamp is GONE. Prior-year quarters are first-class, because every QoQ question and
// every "did the intervention work" question is expressed against a period that is not this one.
const YEAR = new Date().getFullYear()
const periodsFor = (year) => [[String(year), year === YEAR ? 'YTD' : String(year)], ...[1, 2, 3, 4].map(q => [`${year}Q${q}`, `Q${q}`])]

// URL state: tab + period live in the query string, so any view is bookmarkable and pasteable into Slack.
const readUrl = () => {
  const p = new URLSearchParams(location.search)
  return { tab: TABS.includes(p.get('tab')) ? p.get('tab') : 'Overview', period: p.get('period') || String(YEAR) }
}
const writeUrl = (tab, period) => {
  const p = new URLSearchParams(location.search)
  p.set('tab', tab); p.set('period', period)
  history.replaceState(null, '', `?${p}`)
}

export default function CareerDashboard({ onExit }) {
  const init = readUrl()
  const [snap, setSnap] = useState(null)
  const [tab, setTab] = useState(init.tab)
  const [period, setPeriod] = useState(init.period)
  const [year, setYear] = useState(Number(String(init.period).slice(0, 4)) || YEAR)
  const [busy, setBusy] = useState(false)
  const [omni, setOmni] = useState(false)

  const load = (p = period) => api.get(`/api/career/snapshot?period=${encodeURIComponent(p)}&compare=1`).then(setSnap).catch(e => toast(e.message, 'error'))
  useEffect(() => { setSnap(null); setEngPeriod(period); load(period) }, [period])
  useEffect(() => { writeUrl(tab, period) }, [tab, period])
  const refresh = async () => { setBusy(true); try { resetCareerData(); await api.post('/api/career/refresh'); await load() } finally { setBusy(false) } }

  // ⌘K / ctrl-K → omnibox (item 10)
  useEffect(() => {
    const h = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOmni(o => !o) }
      if (e.key === 'Escape') setOmni(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const goto = useCallback(t => { if (TABS.includes(t)) setTab(t) }, [])
  const pages = snap ? pagesFor(snap, load, goto) : null
  const periods = periodsFor(year)

  const btn = (active) => ({
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
    font: `${active ? 600 : 400} 13px ${BODY}`, color: active ? INK : MUTE,
    background: active ? '#1f6feb1a' : 'transparent',
    border: '1px solid ' + (active ? '#1f6feb44' : 'transparent'),
    borderRadius: 7, padding: '7px 10px', cursor: 'pointer', transition: 'background .12s',
  })
  const pill = (active) => ({
    font: `${active ? 600 : 400} 12px ${MONO}`, color: active ? INK : MUTE,
    background: active ? '#1f6feb1a' : 'transparent', border: '1px solid ' + (active ? '#1f6feb44' : 'transparent'),
    borderRadius: 6, padding: '5px 11px', cursor: 'pointer',
  })

  return (
    <div style={{ minHeight: '100vh', background: BG, color: INK, display: 'flex', font: `400 13px ${BODY}` }}>
      <style>{`.cr-nav button:hover{background:#ffffff0a!important}@keyframes crSpin{to{transform:rotate(360deg)}}@keyframes crPulse{0%,100%{opacity:.45}50%{opacity:.9}}`}</style>
      <Omnibox open={omni} onClose={() => setOmni(false)} />
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
        <button onClick={() => setOmni(true)} style={{ ...btn(false), marginTop: 18, border: `1px solid ${LINE}`, font: `400 12px ${MONO}` }}>
          <span style={{ width: 16, textAlign: 'center' }}>⌕</span> Search <span style={{ flex: 1 }} /> <span style={{ font: `400 10px ${MONO}`, color: MUTE }}>⌘K</span>
        </button>
      </aside>

      <main style={{ flex: 1, minWidth: 0 }}>
        <header style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 28px', borderBottom: `1px solid ${LINE}`, background: `${BG}e6`, backdropFilter: 'blur(8px)' }}>
          <div style={{ font: `600 14px ${HEAD}`, color: INK }}>{tab}</div>
          <div style={{ font: `400 11px ${MONO}`, color: MUTE }}>vs {priorPeriod(period)}</div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 2, background: PANEL_BG, border: `1px solid ${LINE}`, borderRadius: 8 }}>
            <button onClick={() => setYear(y => y - 1)} title="previous year" style={{ ...pill(false), padding: '5px 8px' }}>‹</button>
            <span style={{ font: `500 11px ${MONO}`, color: MUTE, padding: '0 4px' }}>{year}</span>
            <button onClick={() => setYear(y => Math.min(YEAR, y + 1))} disabled={year >= YEAR} title="next year" style={{ ...pill(false), padding: '5px 8px', opacity: year >= YEAR ? 0.3 : 1 }}>›</button>
            <span style={{ width: 1, height: 16, background: LINE, margin: '0 4px' }} />
            {periods.map(([val, lbl]) => (
              <button key={val} onClick={() => setPeriod(val)} title={val} style={pill(period === val)}>{lbl}</button>
            ))}
          </div>
          <button onClick={refresh} disabled={busy} style={{ font: `500 12px ${MONO}`, color: busy ? MUTE : ACCENT, background: '#1f6feb14', border: `1px solid ${busy ? LINE : '#1f6feb44'}`, borderRadius: 7, padding: '6px 12px', cursor: busy ? 'default' : 'pointer' }}>{busy ? '↻ refreshing…' : '↻ refresh'}</button>
          <button onClick={onExit} style={{ font: `500 12px ${MONO}`, color: MUTE, background: 'transparent', border: `1px solid ${LINE}`, borderRadius: 7, padding: '6px 12px', cursor: 'pointer' }}>⇄ Claude</button>
        </header>
        <div style={{ padding: '24px 28px', maxWidth: 1240 }}>{pages ? (pages[tab] || pages['Overview'])() : <Skeleton />}</div>
      </main>
    </div>
  )
}
