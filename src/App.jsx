import React, { useEffect, useState } from 'react'
import ResourceSection from './ResourceSection.jsx'
import McpSection from './McpSection.jsx'
import HooksSection from './HooksSection.jsx'
import ArtifactsSection from './ArtifactsSection.jsx'
import Overview from './Overview.jsx'
import ProjectsSection from './ProjectsSection.jsx'
import ChatSection from './ChatSection.jsx'
import TeamsSection from './TeamsSection.jsx'
import HarnessSection from './HarnessSection.jsx'
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
import CursorDashboard from './CursorDashboard.jsx'
import EngDashboard from './EngDashboard.jsx'
import ConstitutionSection from './ConstitutionSection.jsx'
import Palette from './Palette.jsx'
import { api, forceFresh } from './api.js'

const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n))
const xpLevel = msgs => Math.floor(Math.sqrt(msgs / 50))

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: '◧', kicker: 'Dashboard', title: 'Your Claude Code, at a glance', el: <Overview /> },
  { id: 'inbox', label: 'Inbox', icon: '◎', kicker: 'Dashboard', title: 'Attention inbox', el: <InboxSection /> },
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
  { id: 'capabilities', label: 'Capabilities', icon: '✦', kicker: 'Capabilities', title: 'Skills, commands, agents & flow', el: (
    <Hub items={[
      { label: 'Skills', el: <ResourceSection kind="skills" title="Skills" /> },
      { label: 'Commands', el: <ResourceSection kind="commands" title="Prompts / Commands" /> },
      { label: 'Agents', el: <ResourceSection kind="agents" title="Agents" /> },
      { label: 'Flow', el: <FlowSection /> },
    ]} />
  ) },
  { id: 'harness', label: 'Harness', icon: '⚙', kicker: 'Harness engineering', title: 'Config, governance, reliability, library & MCP', el: (
    <Hub items={[
      { label: 'Config', el: <HarnessSection /> },
      { label: 'Governance', el: <GovernanceSection /> },
      { label: 'Reliability', el: <ReliabilitySection /> },
      { label: 'Library', el: <LibrarySection /> },
      { label: 'MCP', el: <McpSection /> },
    ]} />
  ) },
  { id: 'constitution', label: 'Constitution', icon: '⚖', kicker: 'Knowledge', title: 'Constitution — verified repo knowledge base', el: <ConstitutionSection /> },
  { id: 'teams', label: 'Agent Teams', icon: '⧉', kicker: 'Experimental', title: 'Agent Teams', el: <TeamsSection /> },
  { id: 'authoring', label: 'Authoring', icon: '✍', kicker: 'Authoring', title: 'Authoring — prompt studio', el: <PromptStudio /> },
  { id: 'hooks', label: 'Hooks', icon: '⑂', kicker: 'Automation', title: 'Hooks', el: <HooksSection /> },
  { id: 'artifacts', label: 'Artifacts', icon: '⬡', kicker: 'Output', title: 'Artifacts', el: <ArtifactsSection /> },
]

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
    <div className="sidebar-foot" title={[...(h?.conflicts || []), ...alerts.map(a => a.text)].join('\n')}>
      <div className="live" style={ok && !alerts.length ? {} : { color: ok ? '#e5a03a' : '#e5484d' }}>
        {h && !h.ok ? `${h.conflicts.length} conflict${h.conflicts.length === 1 ? '' : 's'}` : alerts.length ? 'budget alert' : 'harness valid'}
      </div>
      {issue ? issue.slice(0, 46) : 'settings schema · backups synced'}
    </div>
  )
}

export default function App() {
  // two dashboards, one toggle, zero mixing: ?dash=cursor renders the Cursor shell instead
  const [dash, setDash] = useState(() => new URLSearchParams(window.location.search).get('dash') || 'claude')
  const goDash = (name) => {
    const q = new URLSearchParams(window.location.search)
    name === 'claude' ? q.delete('dash') : q.set('dash', name)
    history.replaceState(null, '', window.location.pathname + (q.toString() ? '?' + q : ''))
    setDash(name)
  }
  const switchDash = () => goDash(dash === 'cursor' ? 'claude' : 'cursor')
  const [section, setSection] = useState('overview')
  const [chip, setChip] = useState(null)
  const [inboxCount, setInboxCount] = useState(0)
  const [stale, setStale] = useState(null) // oldest x-cached-at seen for the current section's data
  const [tick, setTick] = useState(0)
  const [visited, setVisited] = useState({ overview: true }) // keep-alive: sections stay mounted (hidden) once opened, so their state survives switching
  const [toasts, setToasts] = useState([]) // failed GET surfacing — sections swallow errors, this makes them visible
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
      if (e.detail.url === lastUrl && now - lastAt < 4000) return // dedupe a polling endpoint that keeps failing
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
  const refresh = () => { forceFresh(); setStale(null); setVisited({ [section]: true }); setTick(t => t + 1) } // remounts current section with fresh=1; others refetch on next visit
  const nav = id => { setVisited(v => (v[id] ? v : { ...v, [id]: true })); setSection(id) }
  const staleMin = stale ? Math.floor((Date.now() - stale) / 60000) : 0
  useEffect(() => {
    api.get('/api/usage').then(u => {
      const ab = u.activeBlock
      setChip({
        lv: xpLevel(u.totalMsgs), streak: u.streak,
        out: ab ? fmtTok(ab.out) : null,
        resets: ab ? Math.round((ab.end - Date.now()) / 60000) : null,
      })
    }).catch(() => {})
    const navChat = () => nav('chat') // context bundles hand-off
    window.addEventListener('nav-chat', navChat)
    // inbox badge + desktop notifications for new error/warning items
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
  if (dash === 'cursor') return <CursorDashboard onSwitch={switchDash} />
  if (dash === 'eng') return <EngDashboard onExit={() => goDash('claude')} />
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
            <button className="top-chip" onClick={switchDash} style={{ cursor: 'pointer' }} title="switch to the Cursor dashboard (read-only view of your Cursor usage)">⇄ Cursor</button>
            <button className="top-chip" onClick={() => goDash('eng')} style={{ cursor: 'pointer' }} title="Engineering Metrics — JIRA changelog + GitHub PRs for the Flight team">⇄ Eng Metrics</button>
            <button className="top-chip" onClick={refresh} title="aggregates are cached server-side (no tokens spent) — click to recompute this section now"
              style={{ cursor: 'pointer', color: staleMin >= 5 ? '#e5a03a' : undefined }}>
              ↻ {stale === null ? 'refresh' : staleMin < 1 ? 'cached · fresh' : `cached · ${staleMin}m old`}
            </button>
            {chip && (
              <div className="top-chip">
                <span className="flame">✦</span>
                <span>Lv {chip.lv}</span>
                <span className="div" />
                <span className="meta">
                  {chip.out ? <>{chip.out} <i>out · {Math.floor(chip.resets / 60)}h{String(chip.resets % 60).padStart(2, '0')}m</i></> : <i>idle</i>}
                  {' '}<i>· 🔥{chip.streak}d</i>
                </span>
              </div>
            )}
            <div className="avatar">AM</div>
          </div>
        </header>
        {SECTIONS.filter(s => visited[s.id]).map(s => (
          <div key={s.id + ':' + tick} style={s.id === section ? undefined : { display: 'none' }}>
            {s.id === 'inbox' ? <InboxSection onNav={nav} /> : s.el}
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
