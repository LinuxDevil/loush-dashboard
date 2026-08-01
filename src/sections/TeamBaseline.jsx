import React, { useEffect, useState } from 'react'
import { api, toast } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'

// ---------- 14: team harness baseline ----------
const MONO = "var(--mono)"
const HEAD = "var(--head)"
const RED = 'var(--red)', GOLD = 'var(--amber)', GREEN = 'var(--green)', DIM = 'var(--text-secondary)'
const STATUS = {
  'on-baseline': [GREEN, 'on baseline'],
  'drifted': [GOLD, 'drifted'],
  'never-scaffolded': [RED, 'never scaffolded'],
  'not-cloned': [DIM, 'not cloned locally'],
  'no-baseline': [DIM, 'no baseline pinned'],
}

export default function TeamBaseline() {
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(null)
  const [file, setFile] = useState('')
  const load = () => api.get('/api/gov/team').then(r => { setD(r); setFile(r.file || '') }).catch(() => {})
  useEffect(() => { load() }, [])

  const pin = async () => {
    setBusy(true)
    try { await api.post('/api/gov/team/baseline', { file }); toast('baseline pinned', 'success'); load() }
    catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const exportBaseline = async repo => {
    if (!repo.localPath) return
    setBusy(true)
    try {
      const dry = await api.post('/api/gov/team/export', { project: repo.localPath, file: file || undefined, dryRun: true })
      if (!confirm(`Write ${dry.bytes} bytes to ${dry.file}?\n\nskills: ${dry.skills.join(', ') || 'none'}\nrules: ${dry.rules.join(', ') || 'none'}\n\nThis writes a file into a git working copy — commit and push it to share it.`)) return
      const r = await api.post('/api/gov/team/export', { project: repo.localPath, file: file || undefined })
      toast(r.note, 'success'); load()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const sync = async repo => {
    setBusy(true)
    try {
      const dry = await api.post('/api/gov/team/sync', { project: repo.localPath, dryRun: true })
      if (!dry.drifts.length) return toast('nothing to sync', 'info')
      if (!confirm(`Sync ${repo.name} to the team baseline?\n\n${dry.drifts.map(x => '· ' + x.field).join('\n')}\n\nEvery file is backed up first.`)) return
      const r = await api.post('/api/gov/team/sync', { project: repo.localPath })
      toast(`synced ${r.applied.length} field(s) · backed up`, 'success'); load()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  if (!d) return <Skeleton tiles={0} rows={6} />
  const drifted = d.repos.filter(r => r.status === 'drifted')

  return (
    <div className="panel" style={{ marginBottom: 0 }}>
      <div className="panel-head">
        <h3>Team harness baseline <span className="muted">{d.repos.length} repo{d.repos.length === 1 ? '' : 's'} · {drifted.length} drifted</span></h3>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input value={file} onChange={e => setFile(e.target.value)} placeholder="/path/to/shared-repo/team-harness.json" style={{ flex: 1, minWidth: 260 }} />
        <button className="mini" style={{ marginTop: 0 }} disabled={busy || !file} onClick={pin}>pin baseline</button>
        <span style={{ font: `400 11px ${MONO}`, color: d.hasBaseline ? GREEN : GOLD }}>
          {d.hasBaseline ? `✓ baseline read from ${d.file}` : 'no baseline pinned — every repo shows "no baseline"'}
        </span>
      </div>

      <table className="data inv">
        <thead><tr><th>Project</th><th>Repo</th><th>Status</th><th>Drifts</th><th>Local clone</th><th /></tr></thead>
        <tbody>
          {d.repos.map(r => {
            const [c, label] = STATUS[r.status] || [DIM, r.status]
            return (
              <React.Fragment key={r.key}>
                <tr>
                  <td className="mono" style={{ color: 'var(--text-primary)' }}>{r.name}</td>
                  <td className="mono" style={{ color: 'var(--violet)' }}>{r.repo}</td>
                  <td><span style={{ font: `700 10px ${MONO}`, padding: '2px 7px', borderRadius: 5, color: c, background: c + '1c' }}>{label}</span></td>
                  <td className="num" style={{ color: r.drifts.length ? GOLD : DIM }}>
                    {r.drifts.length ? <button className="mini" style={{ marginTop: 0 }} onClick={() => setOpen(open === r.key ? null : r.key)}>{r.drifts.length} field{r.drifts.length === 1 ? '' : 's'}</button> : '—'}
                  </td>
                  <td className="mono" style={{ color: r.localPath ? 'var(--text-tertiary)' : RED, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.localPath || 'clone it to compare'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.status === 'drifted' && <button className="mini" style={{ marginTop: 0 }} disabled={busy} onClick={() => sync(r)}>sync to baseline</button>}
                    {r.localPath && <button className="mini" style={{ marginTop: 0, marginLeft: 4 }} disabled={busy || !file} title="export THIS repo's harness as the team baseline" onClick={() => exportBaseline(r)}>export as baseline</button>}
                  </td>
                </tr>
                {open === r.key && (
                  <tr><td colSpan={6}>
                    <div style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--bg-inset)', font: `400 11px ${MONO}`, color: 'var(--text-secondary)', maxHeight: 200, overflowY: 'auto' }}>
                      {r.drifts.map(x => (
                        <div key={x.field} style={{ marginBottom: 6 }}>
                          <b style={{ color: GOLD }}>{x.field}</b>
                          <div style={{ color: GREEN }}>baseline: {x.baseline}</div>
                          <div style={{ color: RED }}>current : {x.current}</div>
                        </div>
                      ))}
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            )
          })}
          {d.repos.length === 0 && <tr><td colSpan={6} style={{ font: `400 11px ${MONO}`, color: DIM, padding: 12 }}>no repos with a githubRepo in projects.json</td></tr>}
        </tbody>
      </table>
      <p className="small">
        The baseline is a plain <code>team-harness.json</code> file inside a repo you already share — pin its path,
        export one repo's harness into it, then sync the others. Sync is dry-run-previewed and backs every file up
        first. Repos are compared; <b>people are not</b>.
      </p>
    </div>
  )
}
