import React, { useEffect, useState } from 'react'
import ResourceSection from './ResourceSection.jsx'
import McpSection from './McpSection.jsx'
import HooksSection from './HooksSection.jsx'
import ArtifactsSection from './ArtifactsSection.jsx'
import Overview from './Overview.jsx'
import ProjectsSection from './ProjectsSection.jsx'
import ChatSection from './ChatSection.jsx'
import TeamsSection from './TeamsSection.jsx'
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
  { id: 'hooks', label: 'Hooks', icon: '⑂', kicker: 'Automation', title: 'Hooks', el: <HooksSection /> },
  { id: 'artifacts', label: 'Artifacts', icon: '⬡', kicker: 'Output', title: 'Artifacts', el: <ArtifactsSection /> },
]

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
        <div className="sidebar-foot">
          <div className="live">backups synced</div>
          ~/.claude/dashboard-backups
        </div>
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
