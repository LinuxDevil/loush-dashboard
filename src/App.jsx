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
import { api } from './api.js'

const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n))
const xpLevel = msgs => Math.floor(Math.sqrt(msgs / 50))

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: '◧', kicker: 'Dashboard', title: 'Your Claude Code, at a glance', el: <Overview /> },
  { id: 'projects', label: 'Projects', icon: '⊞', kicker: 'Workspaces', title: 'Projects', el: <ProjectsSection /> },
  { id: 'chat', label: 'Chat', icon: '⌨', kicker: 'Live', title: 'Talk to Claude Code', el: <ChatSection /> },
  { id: 'skills', label: 'Skills', icon: '✦', kicker: 'Capabilities', title: 'Skills', el: <ResourceSection kind="skills" title="Skills" /> },
  { id: 'commands', label: 'Prompts / Commands', icon: '⌘', kicker: 'Capabilities', title: 'Prompts / Commands', el: <ResourceSection kind="commands" title="Prompts / Commands" /> },
  { id: 'mcp', label: 'MCP Servers', icon: '⇌', kicker: 'Connections', title: 'MCP Servers', el: <McpSection /> },
  { id: 'agents', label: 'Agents', icon: '◆', kicker: 'Capabilities', title: 'Agents', el: <ResourceSection kind="agents" title="Agents" /> },
  { id: 'teams', label: 'Agent Teams', icon: '⧉', kicker: 'Experimental', title: 'Agent Teams', el: <TeamsSection /> },
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
  useEffect(() => {
    api.get('/api/usage').then(u => {
      const ab = u.activeBlock
      setChip({
        lv: xpLevel(u.totalMsgs), streak: u.streak,
        out: ab ? fmtTok(ab.out) : null,
        resets: ab ? Math.round((ab.end - Date.now()) / 60000) : null,
      })
    }).catch(() => {})
  }, [])
  const cur = SECTIONS.find(s => s.id === section)
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand"><div className="brand-mark">C</div><div className="brand-name">Claude Code</div></div>
        {SECTIONS.map(s => (
          <button key={s.id} className={section === s.id ? 'active' : ''} onClick={() => setSection(s.id)}>
            <span className="nav-icon">{s.icon}</span> {s.label}
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
        <div key={section}>{cur.el}</div>
      </main>
    </div>
  )
}
