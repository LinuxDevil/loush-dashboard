import React, { useEffect, useState } from 'react'
import ResourceSection from './ResourceSection.jsx'
import CustomizeSection from './CustomizeSection.jsx'
import McpSection from './McpSection.jsx'
import HooksSection from './HooksSection.jsx'
import ArtifactsSection from './ArtifactsSection.jsx'
import Overview from './Overview.jsx'
import ProjectsSection from './ProjectsSection.jsx'
import ChatSection from './ChatSection.jsx'
import HarnessSection from './HarnessSection.jsx'
import ContextExplorerSection from './ContextExplorerSection.jsx'
import GovernanceSection from './GovernanceSection.jsx'
import ReliabilitySection from './ReliabilitySection.jsx'
import LibrarySection from './LibrarySection.jsx'
import PromptStudio from './PromptStudio.jsx'
import FlowSection from './FlowSection.jsx'
import RunsSection from './RunsSection.jsx'
import Hub from './Hub.jsx'
import InsightsSection from './InsightsSection.jsx'
import InboxSection from './InboxSection.jsx'
import BugsSection from './BugsSection.jsx'
import QualitySection from './QualitySection.jsx'
import BoardSection from './BoardSection.jsx'
import QuickActions from './QuickActions.jsx'
import DeliverySection from './DeliverySection.jsx'
import WorkingSet from './WorkingSet.jsx'
import SetupSection from './SetupSection.jsx'
import CapabilityLedger, { Inventory } from './CapabilityLedger.jsx'
import SessionsSection from './SessionsSection.jsx'
import ForensicsSection from './ForensicsSection.jsx'
import UsagePanel from './UsagePanel.jsx'
import TeamBaseline from './TeamBaseline.jsx'
import Palette from './Palette.jsx'
import { api, forceFresh } from './api.js'

// THE GAMIFICATION LAYER IS GONE — deleted, not hidden. The topbar carried a "Lv N · 🔥Nd" chip whose
// level was derived from all-time assistant MESSAGE COUNT, so the fastest way to level up was a long,
// thrashing, unproductive conversation. A token-count level plus a streak is one product decision away
// from a per-engineer leaderboard, at which point every number on this screen stops being trusted.
// src/Gamification.jsx is deleted. Overview's XP bar, streak flame and 10 achievement badges are deleted.

// The four-shell portal is DISSOLVED. Eng folds in as `delivery`. Cursor and Career move out of the
// topbar (one click from an IC's Overview is precisely what made this app feel like surveillance) into
// a sidebar-footer "switch dashboard" menu.
const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: '◧', kicker: 'Dashboard', title: 'What needs a human today', el: <Overview /> },
  // The only section in this app scoped to your CODE rather than your harness or your JIRA board, and
  // the only one that needs zero external config. It sits directly under Overview because Overview's
  // top fold is a "not configured" card for anyone without JIRA + gh, and this is not.
  { id: 'workingset', label: 'Working Set', icon: '◈', kicker: 'Dashboard', title: 'Working Set — what the agent did to your code', el: <WorkingSet /> },
  { id: 'inbox', label: 'Inbox', icon: '◎', kicker: 'Dashboard', title: 'Attention inbox — work + harness', el: <InboxSection /> },
  { id: 'delivery', label: 'Delivery', icon: '▤', kicker: 'Delivery', title: 'Delivery — JIRA, GitHub, CI', el: <DeliverySection /> },
  { id: 'projects', label: 'Projects', icon: '⊞', kicker: 'Workspaces', title: 'Projects', el: <ProjectsSection /> },
  { id: 'chat', label: 'Chat', icon: '⌨', kicker: 'Live', title: 'Talk to Claude Code', el: (
    <Hub items={[{ label: 'Chat', el: <ChatSection /> }, { label: 'Insights', el: <InsightsSection /> }]} />
  ) },
  { id: 'workflows', label: 'Workflows', icon: '▦', kicker: 'Workflows', title: 'Agent work — board, runs, quality & bugs', el: (
    <Hub items={[
      { label: 'Quick Actions', el: <QuickActions /> },
      { label: 'Task Board', el: <BoardSection /> },
      { label: 'Loush Runs', el: <RunsSection /> },
      { label: 'Quality', el: <QualitySection /> },
      { label: 'Bugs', el: <BugsSection /> },
    ]} />
  ) },
  // ROI ledger leads. The Inventory table and its frontmatter linter are demoted OFF the landing page
  // to the end of this hub, reframed as what they are: an authoring aid, not a metric.
  { id: 'capabilities', label: 'Capabilities', icon: '✦', kicker: 'Capabilities', title: 'Capabilities — what you pay for, and what actually fires', el: (
    <Hub items={[
      { label: 'ROI ledger', el: <CapabilityLedger /> },
      { label: 'Skills', el: <ResourceSection kind="skills" title="Skills" /> },
      { label: 'Commands', el: <ResourceSection kind="commands" title="Prompts / Commands" /> },
      { label: 'Agents', el: <ResourceSection kind="agents" title="Agents" /> },
      { label: 'Flow', el: <FlowSection /> },
      { label: 'Inventory (linter)', el: <Inventory /> },
      { label: 'Customize', el: <CustomizeSection /> },
    ]} />
  ) },
  { id: 'harness', label: 'Harness', icon: '⚙', kicker: 'Harness engineering', title: 'Harness — sessions, forensics, config & governance', el: (
    <Hub items={[
      { label: 'Sessions', el: <SessionsSection /> },
      { label: 'Context Explorer', el: <ContextExplorerSection /> },
      { label: 'Forensics', el: <ForensicsSection /> },
      { label: 'Usage', el: <UsagePanel /> },
      { label: 'Config', el: <HarnessSection /> },
      { label: 'Governance', el: <GovernanceSection /> },
      { label: 'Team baseline', el: <TeamBaseline /> },
      { label: 'Reliability', el: <ReliabilitySection /> },
      { label: 'Library', el: <LibrarySection /> },
      { label: 'MCP', el: <McpSection /> },
    ]} />
  ) },
  { id: 'authoring', label: 'Authoring', icon: '✍', kicker: 'Authoring', title: 'Authoring — prompt studio', el: <PromptStudio /> },
  { id: 'hooks', label: 'Hooks', icon: '⑂', kicker: 'Automation', title: 'Hooks', el: <HooksSection /> },
  { id: 'artifacts', label: 'Artifacts', icon: '⬡', kicker: 'Output', title: 'Artifacts', el: <ArtifactsSection /> },
  // Everything org-specific is user config now, so there has to be somewhere to enter it. Credentials
  // here are write-only: no endpoint returns a stored token, so the fields are always blank on load.
  { id: 'setup', label: 'Setup', icon: '⚒', kicker: 'Configuration', title: 'Setup — projects, credentials, work week', el: <SetupSection /> },
]


// There is one shell now. The Cursor and Career dashboards were separate SPAs behind this menu;
// both are deleted, so the switcher has nothing to switch to. What remains is the harness-health strip.
function SidebarFoot() {
  const [h, setH] = useState(null)
  const [alerts, setAlerts] = useState([])
  useEffect(() => {
    const load = () => {
      api.get('/api/harness').then(d => setH(d.valid)).catch(() => {})
      api.get('/api/gov/costs?days=1').then(d => setAlerts(d.alerts || [])).catch(() => {})
    }
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [])
  const ok = (!h || h.ok) && !alerts.some(a => a.level === 'error')
  const issue = h && !h.ok ? h.conflicts[0] : alerts[0]?.text
  return (
    <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="sidebar-foot" style={{ marginTop: 0 }} title={[...(h?.conflicts || []), ...alerts.map(a => a.text)].join('\n')}>
        <div className="live" style={ok && !alerts.length ? {} : { color: ok ? '#e5a03a' : '#e5484d' }}>
          {h && !h.ok ? `${h.conflicts.length} conflict${h.conflicts.length === 1 ? '' : 's'}` : alerts.length ? 'budget alert' : 'harness valid'}
        </div>
        {issue ? issue.slice(0, 46) : 'settings schema · backups synced'}
      </div>
    </div>
  )
}

export default function App() {
  // ?dash=eng no longer opens a separate shell — Eng IS the Delivery section now. The Eng panels write
  // dash=eng into the query string themselves (src/eng/urlState.js), so an old link, or any link copied
  // out of the folded-in dashboard, lands on Delivery rather than on a shell that no longer exists.
  const initial = new URLSearchParams(window.location.search).get('dash') || 'claude'
  const [section, setSection] = useState(initial === 'eng' ? 'delivery' : 'overview')
  const [inboxCount, setInboxCount] = useState(0)
  const [stale, setStale] = useState(null)
  const [tick, setTick] = useState(0)
  const [visited, setVisited] = useState(initial === 'eng' ? { overview: true, delivery: true } : { overview: true })
  const [toasts, setToasts] = useState([])
  useEffect(() => {
    const onCache = e => setStale(s => (s === null ? e.detail.at : Math.min(s, e.detail.at)))
    let lastAt = 0, lastUrl = ''
    const push = detail => {
      const id = Date.now() + Math.random()
      setToasts(t => [...t.slice(-3), { id, ...detail }])
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 7000)
    }
    const onErr = e => {
      const now = Date.now()
      if (e.detail.url === lastUrl && now - lastAt < 4000) return
      lastAt = now; lastUrl = e.detail.url
      push({ ...e.detail, kind: 'error' })
    }
    const onToast = e => push(e.detail)
    window.addEventListener('api-cache', onCache)
    window.addEventListener('api-error', onErr)
    window.addEventListener('app-toast', onToast)
    return () => { window.removeEventListener('api-cache', onCache); window.removeEventListener('api-error', onErr); window.removeEventListener('app-toast', onToast) }
  }, [])
  useEffect(() => setStale(null), [section, tick])
  const refresh = () => { forceFresh(); setStale(null); setVisited({ [section]: true }); setTick(t => t + 1) }
  const nav = id => { setVisited(v => (v[id] ? v : { ...v, [id]: true })); setSection(id) }
  const staleMin = stale ? Math.floor((Date.now() - stale) / 60000) : 0
  useEffect(() => {
    const navChat = () => nav('chat')
    window.addEventListener('nav-chat', navChat)
    // inbox badge + desktop notifications for new error/warning items (277 real items, not harness trivia)
    const seen = new Set()
    let first = true
    const poll = () => api.get('/api/inbox').then(items => {
      const open = items.filter(i => !i.done)
      setInboxCount(open.length)
      api.get('/api/notify').then(cfg => {
        for (const i of open) {
          if (i.severity === 'info' || seen.has(i.key)) continue
          seen.add(i.key)
          if (!first && cfg.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted')
            new Notification('claude-dashboard', { body: i.text })
        }
        first = false
      }).catch(() => {})
    }).catch(() => {})
    poll()
    const t = setInterval(poll, 60_000)
    return () => { clearInterval(t); window.removeEventListener('nav-chat', navChat) }
  }, [])
  const cur = SECTIONS.find(s => s.id === section)
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand"><div className="brand-mark">C</div><div className="brand-name">Claude Code</div></div>
        {SECTIONS.map(s => (
          <button key={s.id} className={section === s.id ? 'active' : ''} onClick={() => nav(s.id)}>
            <span className="nav-icon">{s.icon}</span> {s.label}
            {s.id === 'inbox' && inboxCount > 0 && <span className="nav-badge">{inboxCount}</span>}
          </button>
        ))}
        <SidebarFoot />
      </nav>
      <main className="content">
        <header className="topbar">
          <div>
            <div className="kicker">{cur.kicker}</div>
            <h1>{cur.title}</h1>
          </div>
          <div className="topbar-right">
            <button className="top-chip" onClick={refresh} title="aggregates are cached server-side (no tokens spent) — click to recompute this section now"
              style={{ cursor: 'pointer', color: staleMin >= 5 ? '#e5a03a' : undefined }}>
              ↻ {stale === null ? 'refresh' : staleMin < 1 ? 'cached · fresh' : `cached · ${staleMin}m old`}
            </button>
            <div className="avatar">AM</div>
          </div>
        </header>
        {SECTIONS.filter(s => visited[s.id]).map(s => (
          <div key={s.id + ':' + tick} className={s.id === section ? 'enter' : undefined} style={s.id === section ? undefined : { display: 'none' }}>
            {React.cloneElement(s.el, { onNav: nav })}
          </div>
        ))}
      </main>
      <Palette sections={SECTIONS} onNav={nav} />
      {toasts.length > 0 && (
        <div style={{ position: 'fixed', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 9999, maxWidth: 360 }}>
          {toasts.map(t => {
            const c = t.kind === 'error' ? '#e5484d' : t.kind === 'success' ? '#3fb96a' : '#7cc4f7'
            return (
              <div key={t.id} onClick={() => setToasts(x => x.filter(y => y.id !== t.id))}
                style={{ cursor: 'pointer', background: 'rgba(24,20,18,0.96)', border: `1px solid ${c}66`, borderRadius: 10, padding: '10px 14px', font: "400 11px 'IBM Plex Mono', monospace", color: '#e5dbd2', boxShadow: '0 6px 24px rgba(0,0,0,0.4)' }}>
                <div style={{ color: c, fontWeight: 600 }}>{t.kind === 'error' ? (t.url ? 'request failed' : 'error') : t.kind === 'success' ? 'done' : 'note'} · click to dismiss</div>
                <div style={{ color: '#b0a69e', marginTop: 3 }}>{t.message}{t.url ? <span style={{ color: '#7a716a' }}> ({String(t.url).split('?')[0]})</span> : ''}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
