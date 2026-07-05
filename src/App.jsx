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
import InsightsSection from './InsightsSection.jsx'
import InboxSection from './InboxSection.jsx'
import BugsSection from './BugsSection.jsx'
import QualitySection from './QualitySection.jsx'
import BoardSection from './BoardSection.jsx'
import Palette from './Palette.jsx'
import { api } from './api.js'

const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n))
const xpLevel = msgs => Math.floor(Math.sqrt(msgs / 50))

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: '◧', kicker: 'Dashboard', title: 'Your Claude Code, at a glance', el: <Overview /> },
  { id: 'inbox', label: 'Inbox', icon: '◎', kicker: 'Dashboard', title: 'Attention inbox', el: <InboxSection /> },
  { id: 'projects', label: 'Projects', icon: '⊞', kicker: 'Workspaces', title: 'Projects', el: <ProjectsSection /> },
  { id: 'chat', label: 'Chat', icon: '⌨', kicker: 'Live', title: 'Talk to Claude Code', el: <ChatSection /> },
  { id: 'insights', label: 'Chat Insights', icon: '∿', kicker: 'Live', title: 'Chat stats & duplicated prompts', el: <InsightsSection /> },
  { id: 'bugs', label: 'Bugs', icon: '⌖', kicker: 'Workflows', title: 'Bug triage', el: <BugsSection /> },
  { id: 'quality', label: 'Quality', icon: '❖', kicker: 'Workflows', title: 'Analytics events, design drift & reviews', el: <QualitySection /> },
  { id: 'board', label: 'Task Board', icon: '▦', kicker: 'Workflows', title: 'Agentic task board — dev → review → QA → release', el: <BoardSection /> },
  { id: 'skills', label: 'Skills', icon: '✦', kicker: 'Capabilities', title: 'Skills', el: <ResourceSection kind="skills" title="Skills" /> },
  { id: 'commands', label: 'Prompts / Commands', icon: '⌘', kicker: 'Capabilities', title: 'Prompts / Commands', el: <ResourceSection kind="commands" title="Prompts / Commands" /> },
  { id: 'mcp', label: 'MCP Servers', icon: '⇌', kicker: 'Connections', title: 'MCP Servers', el: <McpSection /> },
  { id: 'agents', label: 'Agents', icon: '◆', kicker: 'Capabilities', title: 'Agents', el: <ResourceSection kind="agents" title="Agents" /> },
  { id: 'teams', label: 'Agent Teams', icon: '⧉', kicker: 'Experimental', title: 'Agent Teams', el: <TeamsSection /> },
  { id: 'flow', label: 'Flow Graph', icon: '⇶', kicker: 'Capabilities', title: 'Skills & agents flow', el: <FlowSection /> },
  { id: 'harness', label: 'Harness', icon: '⚙', kicker: 'Harness engineering', title: 'Harness', el: <HarnessSection /> },
  { id: 'governance', label: 'Governance', icon: '☑', kicker: 'Harness engineering', title: 'Versions, approvals & drift', el: <GovernanceSection /> },
  { id: 'reliability', label: 'Reliability', icon: '𝜎', kicker: 'Harness engineering', title: 'Evals, failures, traces & costs', el: <ReliabilitySection /> },
  { id: 'library', label: 'Library', icon: '❒', kicker: 'Harness engineering', title: 'Profiles, bundles & recommendations', el: <LibrarySection /> },
  { id: 'prompts', label: 'Prompt Studio', icon: '✍', kicker: 'Authoring', title: 'Prompt Studio', el: <PromptStudio /> },
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
  const [section, setSection] = useState('overview')
  const [chip, setChip] = useState(null)
  const [inboxCount, setInboxCount] = useState(0)
  useEffect(() => {
    api.get('/api/usage').then(u => {
      const ab = u.activeBlock
      setChip({
        lv: xpLevel(u.totalMsgs), streak: u.streak,
        out: ab ? fmtTok(ab.out) : null,
        resets: ab ? Math.round((ab.end - Date.now()) / 60000) : null,
      })
    }).catch(() => {})
    const navChat = () => setSection('chat') // context bundles hand-off
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
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand"><div className="brand-mark">C</div><div className="brand-name">Claude Code</div></div>
        {SECTIONS.map(s => (
          <button key={s.id} className={section === s.id ? 'active' : ''} onClick={() => setSection(s.id)}>
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
        <div key={section}>{section === 'inbox' ? <InboxSection onNav={setSection} /> : cur.el}</div>
      </main>
      <Palette sections={SECTIONS} onNav={setSection} />
    </div>
  )
}
