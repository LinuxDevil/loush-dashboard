import React, { useEffect, useState } from 'react'
import { api, fmtDate } from './api.js'
import Skeleton from './Skeleton.jsx'

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }
const SEV = { critical: '#e5484d', high: '#e8a06a', medium: '#e5a03a', low: '#8a807a' }
const STATUS = { open: '#e5484d', 'in-session': '#5eb3f6', fixed: '#3fb96a', closed: '#6a6f78' }
const age = t => { const d = Math.floor((Date.now() - t) / 86400_000); return d === 0 ? 'today' : d + 'd' }

function useProjects() {
  const [scopes, setScopes] = useState([])
  useEffect(() => { api.get('/api/harness').then(d => setScopes(d.scopes.filter(s => s.id !== 'global'))).catch(() => {}) }, [])
  return scopes
}

function Intake({ projects, onDone }) {
  const [title, setTitle] = useState('')
  const [project, setProject] = useState('')
  const [severity, setSeverity] = useState('medium')
  const [intake, setIntake] = useState('')
  const submit = () => api.post('/api/bugs', { title, project, severity, intake })
    .then(() => { setTitle(''); setIntake(''); onDone() }).catch(e => alert(e.message))
  return (
    <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ font: `600 15px ${HEAD}` }}>New bug</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="title — what breaks" style={{ flex: 1 }} />
        <select value={project} onChange={e => setProject(e.target.value)}>
          <option value="">no project</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <select value={severity} onChange={e => setSeverity(e.target.value)}>{Object.keys(SEV).map(s => <option key={s}>{s}</option>)}</select>
      </div>
      <textarea rows={6} value={intake} onChange={e => setIntake(e.target.value)} placeholder="paste a stack trace, error log, Sentry/GitHub issue link, or repro steps — file paths, functions and stack frames are auto-extracted" />
      <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={submit} disabled={!title.trim()}>File bug</button>
    </div>
  )
}

function Bisect({ bug, onRefresh }) {
  const [good, setGood] = useState('')
  const [cmd, setCmd] = useState('npm test')
  const b = bug.bisect
  const start = () => api.post(`/api/bugs/${bug.id}/bisect`, { good, cmd }).then(onRefresh).catch(e => alert(e.message))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ font: `600 12px ${HEAD}` }}>Auto-bisect</div>
      {!b || b.status === 'error' ? <>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={good} onChange={e => setGood(e.target.value)} placeholder="last known good — tag, commit, or HEAD~20" style={{ flex: 1 }} />
          <input value={cmd} onChange={e => setCmd(e.target.value)} placeholder="repro command (exit 0 = good)" style={{ flex: 1.4 }} />
          <button className="mini" style={{ marginTop: 0 }} onClick={start} disabled={!good || !cmd || !bug.project}>run git bisect</button>
        </div>
        {b?.status === 'error' && <div style={{ font: `400 11px ${MONO}`, color: '#e5484d', whiteSpace: 'pre-wrap' }}>{b.log?.slice(0, 400)}</div>}
        {!bug.project && <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>needs a project — bisect runs in its git repo (working tree must be clean)</div>}
      </> : b.status === 'running' ? (
        <div style={{ font: `400 11px ${MONO}`, color: '#e8a06a' }}>◐ bisecting… started {fmtDate(b.startedAt)} — this checks out old commits and runs your command repeatedly</div>
      ) : (
        <div style={{ background: 'rgba(229,72,77,0.06)', border: '1px solid rgba(229,72,77,0.2)', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ font: `600 12px ${MONO}`, color: '#e5484d' }}>culprit: {b.culprit.short} — {b.culprit.subject}</div>
          <div style={{ font: `400 11px ${MONO}`, color: '#b0a69e', marginTop: 3 }}>{b.culprit.author} · {b.culprit.date}</div>
          <pre style={{ margin: '8px 0 0', font: `400 10px/1.5 ${MONO}`, color: '#8a807a', whiteSpace: 'pre-wrap', maxHeight: 130, overflow: 'auto' }}>{b.culprit.stat}</pre>
        </div>
      )}
    </div>
  )
}

export default function BugsSection() {
  const projects = useProjects()
  const [bugs, setBugs] = useState(null)
  const [open, setOpen] = useState(null)
  const [fProj, setFProj] = useState('')
  const [fStatus, setFStatus] = useState('')
  const load = () => api.get('/api/bugs').then(setBugs).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t) }, [])
  if (!bugs) return <Skeleton tiles={0} rows={6} />

  const patch = (id, body) => api.patch('/api/bugs/' + id, body).then(load).catch(e => alert(e.message))
  const launchSession = async (bug, regressionOnly) => {
    const { prompt } = await api.get(`/api/bugs/${bug.id}/context`).catch(e => { alert(e.message); return {} })
    if (!prompt) return
    const text = regressionOnly ? prompt + '\n\nThe fix is already in place — ONLY write the regression test now.' : prompt
    sessionStorage.setItem('ctx-bundle-prompt', text)
    if (!regressionOnly) patch(bug.id, { status: 'in-session' })
    window.dispatchEvent(new Event('nav-chat'))
  }

  const shown = bugs.filter(b => (!fProj || b.project === fProj) && (!fStatus || b.status === fStatus))
  const cur = bugs.find(b => b.id === open)
  const counts = s => bugs.filter(b => b.status === s).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Intake projects={projects} onDone={load} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <select value={fProj} onChange={e => setFProj(e.target.value)}><option value="">all projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)}><option value="">all statuses</option>{Object.keys(STATUS).map(s => <option key={s}>{s}</option>)}</select>
        <span style={{ font: `400 11px ${MONO}`, color: '#7a716a', marginLeft: 'auto' }}>{counts('open')} open · {counts('in-session')} in session · {counts('fixed')} fixed</span>
      </div>
      {shown.map(b => (
        <div key={b.id} style={{ ...PANEL, padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpen(open === b.id ? null : b.id)}>
            <span style={{ font: `600 9px ${MONO}`, padding: '2px 7px', borderRadius: 5, color: SEV[b.severity], background: 'rgba(255,255,255,0.04)' }}>{b.severity.toUpperCase()}</span>
            <span style={{ font: "500 13.5px 'IBM Plex Sans'", color: '#e5dbd2', flex: 1 }}>{b.title}</span>
            <span style={{ font: `500 10.5px ${MONO}`, color: STATUS[b.status] }}>● {b.status}</span>
            <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{b.project ? b.project.split('/').pop() + ' · ' : ''}{age(b.createdAt)}</span>
          </div>
          {open === b.id && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
              {b.frames?.length > 0 && (
                <div>
                  <div style={{ font: `600 12px ${HEAD}`, marginBottom: 6 }}>Extracted frames</div>
                  {b.frames.slice(0, 8).map((f, i) => (
                    <div key={i} style={{ font: `400 11px ${MONO}`, color: '#b0a69e', padding: '2px 0' }}>
                      <span style={{ color: '#e8a06a' }}>{f.file}</span>{f.line ? ':' + f.line : ''}{f.fn ? <span style={{ color: '#7cc4f7' }}> in {f.fn}</span> : ''}
                    </div>
                  ))}
                </div>
              )}
              {b.links?.length > 0 && <div style={{ font: `400 11px ${MONO}` }}>{b.links.map(l => <a key={l} href={l} target="_blank" rel="noreferrer" style={{ color: '#7cc4f7', marginRight: 12 }}>{l.slice(0, 60)}</a>)}</div>}
              <Bisect bug={b} onRefresh={load} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="primary" onClick={() => launchSession(b)} title="opens Chat prefilled with trace + suspect files + git blame context">▸ Root-cause session</button>
                {b.status !== 'fixed' && <button onClick={() => patch(b.id, { status: 'fixed' })}>mark fixed</button>}
                {b.status === 'fixed' && <button onClick={() => launchSession(b, true)}>⚗ generate regression test</button>}
                <select value={b.severity} onChange={e => patch(b.id, { severity: e.target.value })}>{Object.keys(SEV).map(s => <option key={s}>{s}</option>)}</select>
                {b.fix?.configVersion && <span style={{ font: `400 10.5px ${MONO}`, color: '#3fb96a', alignSelf: 'center' }}>fixed {fmtDate(b.fix.at)} · config version {b.fix.configVersion} (Governance → Versions)</span>}
                {b.status === 'fixed' && b.project && (
                  <button className="mini" style={{ marginTop: 0 }} onClick={() => navigator.clipboard.writeText(`cd ${b.project} && gh pr create --title "fix: ${b.title.replace(/"/g, '')}" --body "Fixes: ${b.title}\n\nBug ${b.id}${b.fix?.configVersion ? ` · config ${b.fix.configVersion}` : ''}"`).then(() => alert('gh pr create command copied'))}>copy PR command</button>
                )}
                <button className="mini danger" style={{ marginTop: 0, marginLeft: 'auto' }} onClick={() => confirm('Delete bug?') && api.del('/api/bugs/' + b.id).then(load)}>delete</button>
              </div>
              <details><summary style={{ font: `400 11px ${MONO}`, color: '#7a716a', cursor: 'pointer' }}>raw intake</summary>
                <pre style={{ margin: '6px 0 0', font: `400 10.5px/1.5 ${MONO}`, color: '#8a807a', whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto', background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: 10 }}>{b.intake}</pre>
              </details>
            </div>
          )}
        </div>
      ))}
      {shown.length === 0 && <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: '#3fb96a' }}>✓ no bugs match — quiet day</div>}
      <p className="small">bugs live in ~/.claude/bugs.json · bisect runs real git bisect against your repro command · root-cause session = Chat prefilled with trace, @suspect-files and git blame · fixing links the config version active at fix time</p>
    </div>
  )
}
