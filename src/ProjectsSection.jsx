import React, { useEffect, useState } from 'react'
import { api } from './api.js'
import { usePager } from './Pager.jsx'

const PROJ_COLORS = ['#5eb3f6', '#3fb96a', '#8b7cf6', '#e8a06a', '#d97757', '#c98bf6']
const LANG_COLOR = { TypeScript: '#3b82f6', JavaScript: '#e5a03a', Python: '#3fb96a', Go: '#5eb3f6', Rust: '#e5484d', Ruby: '#e5484d', CSS: '#c98bf6', Markdown: '#9a9089', Shell: '#3fb96a', Vue: '#3fb96a', PHP: '#8b7cf6', Java: '#e8a06a', Kotlin: '#8b7cf6', Swift: '#e8a06a', Dart: '#5eb3f6' }
const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n))
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago' }

const sparkPts = (arr, h) => {
  const mx = Math.max(...arr), mn = Math.min(...arr), rng = mx - mn || 1, n = arr.length
  return arr.map((v, i) => `${((i / (n - 1)) * 100).toFixed(1)},${((h - 2) - ((v - mn) / rng) * (h - 4)).toFixed(1)}`).join(' ')
}

function ResChips({ p }) {
  const groups = [['skills', p.skills], ['commands', p.commands], ['agents', p.agents], ['mcp', p.mcp]]
  if (!groups.some(([, v]) => v.length)) return null
  return (
    <div className="proj-res">
      {groups.map(([label, names]) => names.length > 0 && (
        <details key={label}>
          <summary><b>{names.length}</b> {label}</summary>
          <div className="chips">{names.map(n => <span className="chip" key={n}>{n}</span>)}</div>
        </details>
      ))}
    </div>
  )
}

export default function ProjectsSection() {
  const [projects, setProjects] = useState(null)
  const { slice, pager } = usePager(projects || [], 9)
  const load = () => api.get('/api/projects').then(setProjects)
  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [])

  if (!projects) return <p className="muted center">scanning projects & transcripts…</p>
  const active = projects.filter(p => p.running + p.runningAgents > 0)
  const totOut = projects.reduce((s, p) => s + (p.usage?.out || 0), 0)
  const totAdd = projects.reduce((s, p) => s + (p.usage?.linesAdd || 0), 0)
  const totDel = projects.reduce((s, p) => s + (p.usage?.linesDel || 0), 0)
  const totSess = projects.reduce((s, p) => s + p.sessions, 0)

  const stats = [
    ['Active now', active.length, '#3fb96a', `of ${projects.length} tracked`],
    ['Output tokens', fmtTok(totOut), '#d97757', 'all projects · all time'],
    ['Lines changed', fmtTok(totAdd + totDel), '#5eb3f6', `+${fmtTok(totAdd)} / −${fmtTok(totDel)} via edits`],
    ['Sessions', totSess, '#8b7cf6', `${projects.reduce((s, p) => s + p.running + p.runningAgents, 0)} running`],
  ]

  return (
    <div className="overview">
      <div className="proj-stats">
        {stats.map(([label, value, color, sub], i) => (
          <div className="proj-stat" key={label} style={{ animationDelay: 0.05 * i + 's' }}>
            <div className="label">{label}</div>
            <div className="value" style={{ color }}>{value}</div>
            <div className="sub">{sub}</div>
          </div>
        ))}
      </div>
      <div className="proj-grid">
        {slice.map((p, i) => {
          const color = PROJ_COLORS[i % 6]
          const live = p.running + p.runningAgents > 0
          return (
            <div key={p.path} className="proj-card" style={{ '--pc': color, animationDelay: 0.04 * i + 's' }}>
              <div className="proj-head">
                <b>{p.name}</b>
                <span className={'proj-status ' + (live ? 'on' : 'off')}><i />{live ? `active${p.runningAgents ? ` +${p.runningAgents} agents` : ''}` : p.exists ? 'idle' : 'deleted'}</span>
              </div>
              <div className="proj-path">{p.path}{p.current ? '  ·  this project' : ''}</div>
              {p.langs.length > 0 && (
                <div className="proj-langs">
                  {p.langs.map(l => <span className="proj-lang" key={l}><i style={{ background: LANG_COLOR[l] || '#9a9089' }} />{l}</span>)}
                </div>
              )}
              {p.usage && (
                <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="proj-spark">
                  <polyline points={sparkPts(p.usage.spark, 30)} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
                </svg>
              )}
              {p.progress && (
                <div className="proj-progress" title=".planning/ROADMAP.md checkboxes">
                  <div className="xp-track"><div className="xp-fill" style={{ width: (p.progress.done / p.progress.total) * 100 + '%' }} /></div>
                  <span className="small">GSD {p.progress.done}/{p.progress.total} · {Math.round((p.progress.done / p.progress.total) * 100)}%</span>
                </div>
              )}
              <div className="proj-nums">
                <div><b>{p.sessions}</b><span>sessions</span></div>
                <div><b>{p.usage ? fmtTok(p.usage.out) : '0'}</b><span>tokens</span></div>
                <div><b className="g">{p.usage ? '+' + fmtTok(p.usage.linesAdd) : '—'}</b><span>lines</span></div>
                <div><b>{p.commits ?? '—'}</b><span>commits</span></div>
              </div>
              <ResChips p={p} />
              <div className="proj-foot">
                last active {p.usage ? ago(p.usage.last) : 'never'}
                {p.usage?.topModel ? ` · mostly ${p.usage.topModel.replace(/^claude-/, '')}` : ''}
              </div>
            </div>
          )
        })}
      </div>
      {pager}
      <p className="small">projects from ~/.claude.json · usage from ~/.claude/projects transcripts · "active" = transcript written in last 5 min (refreshes 30s) · sparkline = daily output tokens, 14d · lines = edit-tool diffs · commits = git rev-list count</p>
    </div>
  )
}
