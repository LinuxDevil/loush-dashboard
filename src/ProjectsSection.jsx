import React, { useEffect, useState } from 'react'
import { api } from './api.js'
import Skeleton from './Skeleton.jsx'
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

// feature 18: new-project harness scaffolder — dry-run preview, then real writes via /api/scaffold
function Scaffolder({ projects, onClose, onDone }) {
  const [dir, setDir] = useState('')
  const [profiles, setProfiles] = useState([])
  const [skills, setSkills] = useState([])
  const [profile, setProfile] = useState('')
  const [cloneFrom, setCloneFrom] = useState('')
  const [picked, setPicked] = useState([])
  const [skillQ, setSkillQ] = useState('')
  const [preview, setPreview] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    api.get('/api/gov/profiles').then(setProfiles).catch(() => {})
    api.get('/api/res/skills').then(s => setSkills(s.filter(x => x.scope === 'user'))).catch(() => {})
  }, [])
  const body = { dir: dir.trim(), profile: profile || undefined, cloneFrom: cloneFrom || undefined, skills: picked }
  const dryRun = () => api.post('/api/scaffold', { ...body, dryRun: true }).then(r => { setPreview(r.files); setErr('') }).catch(e => { setErr(e.message); setPreview(null) })
  const create = () => api.post('/api/scaffold', body).then(r => { alert('written:\n' + r.written.join('\n')); onDone(); onClose() }).catch(e => setErr(e.message))
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label="scaffold harness" style={{ width: 470 }}>
        <div className="drawer-head"><h3>Scaffold a project harness</h3><button className="ghost" onClick={onClose}>✕</button></div>
        <div className="drawer-body">
          <label className="field">target directory (must exist)
            <input value={dir} onChange={e => { setDir(e.target.value); setPreview(null) }} placeholder="/Users/you/code/new-repo" /></label>
          <label className="field">profile
            <select value={profile} onChange={e => { setProfile(e.target.value); setPreview(null) }} style={{ width: '100%' }}>
              <option value="">— none —</option>
              {profiles.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select></label>
          <label className="field">clone setup from
            <select value={cloneFrom} onChange={e => { setCloneFrom(e.target.value); setPreview(null) }} style={{ width: '100%' }}>
              <option value="">— start fresh —</option>
              {projects.filter(p => p.exists).map(p => <option key={p.path} value={p.path}>{p.name}</option>)}
            </select></label>
          <div className="field">recommended skills (copied from ~/.claude/skills)
            <input value={skillQ} onChange={e => setSkillQ(e.target.value)} placeholder="filter skills…" />
            <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
              {skills.filter(s => !skillQ || s.name.includes(skillQ)).slice(0, 40).map(s => (
                <label key={s.name} style={{ display: 'flex', gap: 8, alignItems: 'center', font: "400 12px 'IBM Plex Mono'", color: '#c8bdb4', cursor: 'pointer' }}>
                  <input type="checkbox" style={{ width: 13 }} checked={picked.includes(s.name)}
                    onChange={e => { setPicked(p => e.target.checked ? [...p, s.name] : p.filter(x => x !== s.name)); setPreview(null) }} />
                  {s.name}
                </label>
              ))}
            </div>
          </div>
          {err && <div className="drawer-err">{err}</div>}
          {preview && (
            <div className="field">dry-run preview — nothing written yet
              <div style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                {preview.map(f => (
                  <details key={f.rel} style={{ padding: '4px 0', font: "400 12px 'IBM Plex Mono'" }}>
                    <summary style={{ cursor: 'pointer', color: f.exists ? '#e5a03a' : '#3fb96a' }}>{f.exists ? '⚠ overwrites' : '+ creates'} {f.rel}</summary>
                    <pre style={{ margin: '6px 0 0', padding: 10, background: 'rgba(0,0,0,0.3)', borderRadius: 8, maxHeight: 160, overflow: 'auto', font: "400 10.5px/1.5 'IBM Plex Mono'", color: '#9a9089', whiteSpace: 'pre-wrap' }}>{f.content.slice(0, 1500)}</pre>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="drawer-foot">
          <button onClick={dryRun} disabled={!dir.trim()}>Preview (dry run)</button>
          <button className="primary" onClick={create} disabled={!preview}>Create harness</button>
        </div>
      </div>
    </>
  )
}

export default function ProjectsSection() {
  const [projects, setProjects] = useState(null)
  const [scaffolding, setScaffolding] = useState(false)
  const { slice, pager } = usePager(projects || [], 9)
  const load = () => api.get('/api/projects').then(setProjects)
  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    const open = () => setScaffolding(true) // palette action
    window.addEventListener('open-scaffolder', open)
    return () => { clearInterval(t); window.removeEventListener('open-scaffolder', open) }
  }, [])

  if (!projects) return <Skeleton tiles={3} rows={6} />
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="primary" onClick={() => setScaffolding(true)}>+ Scaffold harness for a new repo</button>
      </div>
      {scaffolding && <Scaffolder projects={projects} onClose={() => setScaffolding(false)} onDone={load} />}
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
