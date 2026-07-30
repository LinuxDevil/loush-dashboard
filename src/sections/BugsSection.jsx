import React, { useEffect, useState } from 'react'
import { api, fmtDate, toast } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'

const MONO = "var(--mono)"
const HEAD = "var(--head)"
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12, padding: '16px 18px' }
const SEV = { critical: 'var(--red)', high: 'var(--accent-light)', medium: 'var(--amber)', low: 'var(--text-secondary)' }
const STATUS = { open: 'var(--red)', 'in-session': 'var(--blue)', fixed: 'var(--green)', closed: 'var(--text-tertiary)' }
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
    .then(() => { setTitle(''); setIntake(''); onDone() }).catch(e => toast(e.message, 'error'))
  return (
    <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ font: `600 14px ${HEAD}` }}>New bug</div>
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
  const start = () => api.post(`/api/bugs/${bug.id}/bisect`, { good, cmd }).then(onRefresh).catch(e => toast(e.message, 'error'))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ font: `600 12px ${HEAD}` }}>Auto-bisect</div>
      {!b || b.status === 'error' ? <>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={good} onChange={e => setGood(e.target.value)} placeholder="last known good — tag, commit, or HEAD~20" style={{ flex: 1 }} />
          <input value={cmd} onChange={e => setCmd(e.target.value)} placeholder="repro command (exit 0 = good)" style={{ flex: 1.4 }} />
          <button className="mini" style={{ marginTop: 0 }} onClick={start} disabled={!good || !cmd || !bug.project}>run git bisect</button>
        </div>
        {b?.status === 'error' && <div style={{ font: `400 11px ${MONO}`, color: 'var(--red)', whiteSpace: 'pre-wrap' }}>{b.log?.slice(0, 400)}</div>}
        {!bug.project && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>needs a project — bisect runs in its git repo (working tree must be clean)</div>}
      </> : b.status === 'running' ? (
        <div style={{ font: `400 11px ${MONO}`, color: 'var(--accent-light)' }}>◐ bisecting… started {fmtDate(b.startedAt)} — this checks out old commits and runs your command repeatedly</div>
      ) : (
        <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 6, padding: '10px 12px' }}>
          <div style={{ font: `600 12px ${MONO}`, color: 'var(--red)' }}>culprit: {b.culprit.short} — {b.culprit.subject}</div>
          <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', marginTop: 3 }}>{b.culprit.author} · {b.culprit.date}</div>
          <pre style={{ margin: '8px 0 0', font: `400 10px/1.5 ${MONO}`, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 130, overflow: 'auto' }}>{b.culprit.stat}</pre>
        </div>
      )}
    </div>
  )
}

function SecurityFindings() {
  const [file, setFile] = useState('')
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = () => {
    setBusy(true); setErr(''); setD(null)
    api.get('/api/security/findings?file=' + encodeURIComponent(file.trim()))
      .then(setD).catch(e => setErr(e.message)).finally(() => setBusy(false))
  }
  const SEV = { HIGH: 'var(--red)', MEDIUM: 'var(--amber, #d79921)', LOW: 'var(--text-tertiary)' }
  return (
    <div className="panel">
      <h3>Security findings <span className="muted">from a claudecode-results.json artifact</span></h3>
      <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
        <input value={file} onChange={e => setFile(e.target.value)} placeholder="/path/to/claudecode-results.json"
          onKeyDown={e => { if (e.key === 'Enter' && file.trim() && !busy) run() }}
          style={{ font: '400 12px var(--mono)', flex: 1 }} />
        <button onClick={run} disabled={busy || !file.trim()}>{busy ? 'reading…' : 'load'}</button>
      </div>
      {err && <div style={{ font: '400 11px var(--mono)', color: 'var(--red)' }}>{err}</div>}
      {d && (
        <>
          {}
          {d.filterFailedOpen && (
            <div style={{ font: '400 11px var(--mono)', color: 'var(--red)', border: '1px solid var(--red)', borderRadius: 6, padding: 8, margin: '8px 0' }}>
              ⚠ The upstream filter failed open — findings below were NOT filtered as the summary claims.
              {d.failOpen?.kinds?.length ? ` (${d.failOpen.kinds.join(', ')})` : ''}
            </div>
          )}
          <div style={{ display: 'flex', gap: 16, font: '400 11px var(--mono)', flexWrap: 'wrap', marginBottom: 8 }}>
            <span>{(d.findings || []).length} kept</span>
            {}
            <span style={{ color: 'var(--text-tertiary)' }}>hard-excluded: {d.filterStats?.hardExcluded ?? '—'}</span>
            <span style={{ color: 'var(--text-tertiary)' }}>claude-excluded: {d.filterStats?.claudeExcluded ?? '—'}</span>
            <span style={{ color: 'var(--text-tertiary)' }}>avg confidence: {d.filterStats?.averageConfidence ?? '—'}</span>
            {d.localFilter && <span title="what this machine's copy of the rules would drop, independent of what the vendor actually dropped">local rules would drop {d.localFilter.excluded?.length ?? 0}</span>}
          </div>
          <table className="data" style={{ font: '400 11px var(--mono)', width: '100%' }}>
            <thead><tr><th>sev</th><th style={{ textAlign: 'left' }}>file</th><th style={{ textAlign: 'left' }}>category</th><th style={{ textAlign: 'left' }}>description</th></tr></thead>
            <tbody>
              {(d.findings || []).map((f, i) => (
                <tr key={i}>
                  <td style={{ color: SEV[f.severity] || 'var(--violet)' }}>{f.severity || 'unknown'}</td>
                  <td>{f.file}{f.line != null ? ':' + f.line : ''}</td>
                  <td style={{ color: 'var(--text-tertiary)' }}>{f.category || '—'}</td>
                  <td style={{ color: 'var(--text-secondary)' }} title={f.exploit_scenario || ''}>{String(f.description || '').slice(0, 120)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(d.malformed || []).length > 0 && (
            <p className="small">{d.malformed.length} record(s) could not be parsed and are excluded from the counts above.</p>
          )}
        </>
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
  useEffect(() => { load(); const t = setInterval(() => { if (!document.hidden) load() }, 10_000); return () => clearInterval(t) }, [])
  if (!bugs) return <Skeleton tiles={0} rows={6} />

  const patch = (id, body) => api.patch('/api/bugs/' + id, body).then(load).catch(e => toast(e.message, 'error'))
  const launchSession = async (bug, regressionOnly) => {
    const { prompt } = await api.get(`/api/bugs/${bug.id}/context`).catch(e => { toast(e.message, 'error'); return {} })
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
      <SecurityFindings />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <select value={fProj} onChange={e => setFProj(e.target.value)}><option value="">all projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)}><option value="">all statuses</option>{Object.keys(STATUS).map(s => <option key={s}>{s}</option>)}</select>
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{counts('open')} open · {counts('in-session')} in session · {counts('fixed')} fixed</span>
      </div>
      {shown.map(b => (
        <div key={b.id} style={{ ...PANEL, padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpen(open === b.id ? null : b.id)}>
            <span style={{ font: `600 9px ${MONO}`, padding: '2px 7px', borderRadius: 5, color: SEV[b.severity], background: 'var(--bg-surface-hover)' }}>{b.severity.toUpperCase()}</span>
            <span style={{ font: "500 14px var(--body)", color: 'var(--text-primary)', flex: 1 }}>{b.title}</span>
            <span style={{ font: `500 11px ${MONO}`, color: STATUS[b.status] }}>● {b.status}</span>
            {b.boardTicketId && <span title={'linked board ticket ' + b.boardTicketId} style={{ font: `500 9px ${MONO}`, color: 'var(--blue)' }}>▦ on board</span>}
            <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{b.project ? b.project.split('/').pop() + ' · ' : ''}{age(b.createdAt)}</span>
          </div>
          {open === b.id && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
              {b.frames?.length > 0 && (
                <div>
                  <div style={{ font: `600 12px ${HEAD}`, marginBottom: 6 }}>Extracted frames</div>
                  {b.frames.slice(0, 8).map((f, i) => (
                    <div key={i} style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', padding: '2px 0' }}>
                      <span style={{ color: 'var(--accent-light)' }}>{f.file}</span>{f.line ? ':' + f.line : ''}{f.fn ? <span style={{ color: 'var(--blue)' }}> in {f.fn}</span> : ''}
                    </div>
                  ))}
                </div>
              )}
              {b.links?.length > 0 && <div style={{ font: `400 11px ${MONO}` }}>{b.links.map(l => <a key={l} href={l} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', marginRight: 12 }}>{l.slice(0, 60)}</a>)}</div>}
              <Bisect bug={b} onRefresh={load} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="primary" onClick={() => launchSession(b)} title="opens Chat prefilled with trace + suspect files + git blame context">▸ Root-cause session</button>
                {b.status !== 'fixed' && <button onClick={() => patch(b.id, { status: 'fixed' })}>mark fixed</button>}
                {b.status === 'fixed' && <button onClick={() => launchSession(b, true)}>⚗ generate regression test</button>}
                <select value={b.severity} onChange={e => patch(b.id, { severity: e.target.value })}>{Object.keys(SEV).map(s => <option key={s}>{s}</option>)}</select>
                {b.fix?.configVersion && <span style={{ font: `400 11px ${MONO}`, color: 'var(--green)', alignSelf: 'center' }}>fixed {fmtDate(b.fix.at)} · config version {b.fix.configVersion} (Governance → Versions)</span>}
                {b.status === 'fixed' && b.project && (
                  <button className="mini" style={{ marginTop: 0 }} onClick={() => navigator.clipboard.writeText(`cd ${b.project} && gh pr create --title "fix: ${b.title.replace(/"/g, '')}" --body "Fixes: ${b.title}\n\nBug ${b.id}${b.fix?.configVersion ? ` · config ${b.fix.configVersion}` : ''}"`).then(() => alert('gh pr create command copied'))}>copy PR command</button>
                )}
                <button className="mini danger" style={{ marginTop: 0, marginLeft: 'auto' }} onClick={() => confirm('Delete bug?') && api.del('/api/bugs/' + b.id).then(load)}>delete</button>
              </div>
              <details><summary style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', cursor: 'pointer' }}>raw intake</summary>
                <pre style={{ margin: '6px 0 0', font: `400 11px/1.5 ${MONO}`, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto', background: 'var(--bg-inset)', borderRadius: 8, padding: 10 }}>{b.intake}</pre>
              </details>
            </div>
          )}
        </div>
      ))}
      {}
      {shown.length === 0 && (bugs.length === 0
        ? <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: 'var(--text-secondary)' }}>no bugs have been recorded here yet — this is an empty log, not a clean bill of health</div>
        : <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: 'var(--green)' }}>✓ none of the {bugs.length} recorded bug{bugs.length === 1 ? '' : 's'} match this filter</div>)}
      <p className="small">bugs live in ~/.claude/bugs.json · bisect runs real git bisect against your repro command · root-cause session = Chat prefilled with trace, @suspect-files and git blame · fixing links the config version active at fix time</p>
    </div>
  )
}
