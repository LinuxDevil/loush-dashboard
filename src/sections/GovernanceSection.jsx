import React, { useEffect, useState } from 'react'
import { useDebounced } from '../lib/hooks.js'
import { api, tildify, fmtDate } from '../lib/api.js'
import { Tabs, DiffView, lineDiff } from '../ui/tabs.jsx'

const MONO = "var(--mono)"
const HEAD = "var(--head)"
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12, padding: '16px 18px' }

export default function GovernanceSection() {
  const [tab, setTab] = useState('Versions')
  return (
    <div className="hx" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Tabs tabs={['Versions', 'Approvals', 'Access', 'Freeze audit', 'Audit log', 'Drift', 'Batch ops']} tab={tab} setTab={setTab} />
      {tab === 'Versions' && <Versions />}
      {tab === 'Approvals' && <Approvals />}
      {tab === 'Access' && <Access />}
      {tab === 'Freeze audit' && <FreezeAudit />}
      {tab === 'Audit log' && <Audit />}
      {tab === 'Drift' && <Drift />}
      {tab === 'Batch ops' && <BatchOps />}
    </div>
  )
}

function useScopes() {
  const [scopes, setScopes] = useState([])
  useEffect(() => { api.get('/api/harness').then(d => setScopes(d.scopes)).catch(() => {}) }, [])
  return scopes
}

function Versions() {
  const [list, setList] = useState([])
  const [q, setQ] = useState('')
  const [scope, setScope] = useState('')
  const [sel, setSel] = useState([]) // up to 2 version ids for diff
  const [diff, setDiff] = useState(null)
  const scopes = useScopes()
  const dq = useDebounced(q)
  const load = () => api.get(`/api/gov/versions?q=${encodeURIComponent(q)}&scope=${encodeURIComponent(scope)}`).then(setList).catch(() => {})
  useEffect(() => { api.get(`/api/gov/versions?q=${encodeURIComponent(dq)}&scope=${encodeURIComponent(scope)}`).then(setList).catch(() => {}) }, [dq, scope]) // debounced search
  const pick = async id => {
    const next = sel.includes(id) ? sel.filter(x => x !== id) : [...sel.slice(-1), id]
    setSel(next)
    if (next.length === 2) {
      const [a, b] = await Promise.all(next.map(i => api.get('/api/gov/versions/' + i)))
      const [older, newer] = a.ts <= b.ts ? [a, b] : [b, a]
      setDiff({ title: `${fmtDate(older.ts)} → ${fmtDate(newer.ts)}`, before: older.content, after: newer.content })
    } else setDiff(null)
  }
  const rollback = async (id, to) => {
    if (!confirm('Roll back? This writes a new version (never destructive).')) return
    await api.post('/api/gov/rollback', { id, to }).catch(e => alert(e.message))
    setSel([]); setDiff(null); load()
  }
  const inspect = async id => {
    const v = await api.get('/api/gov/versions/' + id)
    setDiff({ title: `change ${v.id} — ${v.summary}`, before: v.prev, after: v.content, id })
  }
  return (
    <div className="hx-2a">
      <div style={{ ...PANEL }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="search summary / file…" style={{ flex: 1, minWidth: 160 }} />
          <select value={scope} onChange={e => setScope(e.target.value)}>
            <option value="">all scopes</option>
            {scopes.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div style={{ maxHeight: 480, overflowY: 'auto' }}>
          {list.map(v => (
            <div key={v.id} onClick={() => inspect(v.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', borderRadius: 8, background: sel.includes(v.id) ? 'var(--accent-bg)' : 'transparent' }}>
              <input type="checkbox" checked={sel.includes(v.id)} onClick={e => e.stopPropagation()} onChange={() => pick(v.id)} style={{ width: 14 }} aria-label="select for compare" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "500 13px var(--body)", color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.summary || '(no summary)'}</div>
                <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{tildify(v.file)} · {v.author}{v.approvedBy ? ` · approved by ${v.approvedBy}` : ''}</div>
              </div>
              <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)', flexShrink: 0 }}>{fmtDate(v.ts)}</span>
              <button className="mini" onClick={e => { e.stopPropagation(); rollback(v.id, 'prev') }} title="restore the state before this change">undo</button>
            </div>
          ))}
          {list.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no tracked changes yet — edits made through the dashboard appear here</div>}
        </div>
        <div style={{ marginTop: 10, font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>tick two entries to diff between versions · click one to see its change</div>
      </div>
      <div style={{ ...PANEL }}>
        <div style={{ font: `600 14px ${HEAD}`, marginBottom: 12 }}>{diff ? diff.title : 'Diff'}</div>
        {diff ? <>
          <DiffView before={diff.before} after={diff.after} />
          {diff.id && <button className="mini" style={{ marginTop: 10 }} onClick={() => rollback(diff.id, 'content')}>restore this version</button>}
        </> : <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>select a change on the left</div>}
      </div>
    </div>
  )
}

function Approvals() {
  const [list, setList] = useState([])
  const [open, setOpen] = useState(null)
  const [note, setNote] = useState('')
  const [current, setCurrent] = useState(null)
  const load = () => api.get('/api/gov/approvals').then(setList)
  useEffect(() => { load() }, [])
  const view = async p => {
    setOpen(p); setNote('')
    const raw = await api.get('/api/harness/raw?scope=global').catch(() => null)
    setCurrent(raw?.content || '')
  }
  const decide = async approve => {
    await api.post('/api/gov/approvals/' + open.id, { approve, note }).catch(e => alert(e.message))
    setOpen(null); load()
  }
  const pending = list.filter(a => a.status === 'proposed')
  return (
    <div className="hx-2a">
      <div style={{ ...PANEL }}>
        <div style={{ font: `600 14px ${HEAD}`, marginBottom: 6 }}>Proposed global changes</div>
        <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginBottom: 12 }}>global config edits take effect only after review · project edits apply directly but are logged</div>
        {pending.map(p => (
          <div key={p.id} onClick={() => view(p)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', borderRadius: 8, background: open?.id === p.id ? 'var(--accent-bg)' : 'transparent' }}>
            <span style={{ font: `600 9px ${MONO}`, padding: '2px 7px', borderRadius: 5, background: 'var(--accent-bg)', color: 'var(--accent-light)', flexShrink: 0 }}>PROPOSED</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "500 13px var(--body)", color: 'var(--text-primary)' }}>{p.summary}</div>
              <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{p.author} · {fmtDate(p.ts)}</div>
            </div>
          </div>
        ))}
        {pending.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>nothing awaiting review</div>}
        <div style={{ marginTop: 18, font: `600 11px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 6 }}>Recently reviewed</div>
        {list.filter(a => a.status !== 'proposed').slice(0, 8).map(p => (
          <div key={p.id} style={{ display: 'flex', gap: 10, padding: '7px 8px', font: `400 11px ${MONO}`, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{ color: p.status === 'approved' ? 'var(--green)' : 'var(--red)' }}>{p.status}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.summary}</span>
            <span>{p.reviewedBy}{p.note ? ` — ${p.note.slice(0, 30)}` : ''}</span>
          </div>
        ))}
      </div>
      <div style={{ ...PANEL }}>
        {open ? <>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 12 }}>Review: {open.summary}</div>
          <DiffView before={current} after={open.content} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="review note (optional)" style={{ flex: 1 }} />
            <button className="primary" onClick={() => decide(true)}>Approve</button>
            <button className="danger" onClick={() => decide(false)}>Reject</button>
          </div>
        </> : <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>select a proposal to review its diff against the current global config</div>}
      </div>
    </div>
  )
}

// Per-(profile, project) rwx matrix. r = may read/display, w = may write into, x = may run
// commands against. Unconfigured cells read `---`: access is granted, never inherited.
const MODE_BITS = ['r', 'w', 'x']
const MODE_HELP = { r: 'read and display this project', w: 'write into it (config, captures, tickets)', x: 'run commands against it' }

function Access() {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [newProfile, setNewProfile] = useState('')
  const load = () => api.get('/api/access').then(setData).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])

  const send = async (fn) => {
    setBusy(true); setErr('')
    try { await fn(); await load() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  // Clicking a bit flips just that bit and writes the whole cell back, so the mode string the
  // server stores is always the one shown in the grid.
  const toggleBit = (profile, project, mode, bit) => {
    const next = MODE_BITS.map((b, i) => (b === bit ? (mode[i] === b ? '-' : b) : mode[i])).join('')
    return send(() => api.put('/api/access/permission', { profile, project, mode: next }))
  }

  if (err && !data) return <div style={{ ...PANEL, color: 'var(--red)', font: `400 12px ${MONO}` }}>{err}</div>
  if (!data) return <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>loading…</div>
  const { matrix, enforced } = data

  return (
    <div style={{ ...PANEL }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 4 }}>
        <div style={{ font: `600 14px ${HEAD}` }}>Project access</div>
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{tildify(data.file)}</span>
        <span style={{ marginLeft: 'auto', font: `400 11px ${MONO}`, color: enforced ? 'var(--green)' : 'var(--amber, var(--text-tertiary))' }}>
          {enforced ? 'enforcing' : 'not enforced — recording only'}
        </span>
        <button className="mini" style={{ marginTop: 0 }} disabled={busy}
          onClick={() => send(() => api.put('/api/access/enforced', { enforced: !enforced }))}>
          {enforced ? 'stop enforcing' : 'start enforcing'}
        </button>
      </div>
      <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.6 }}>
        {MODE_BITS.map(b => <span key={b} style={{ marginRight: 14 }}><b style={{ color: 'var(--text-secondary)' }}>{b}</b> {MODE_HELP[b]}</span>)}
        <div style={{ marginTop: 4 }}>
          A cell with no entry is <code>---</code>. Nothing is inherited between cells — a profile with access to one project has none on another.
          {!enforced && ' While not enforcing, denied actions are allowed and flagged, so you can fill this in safely before switching it on.'}
        </div>
      </div>
      {err && <div style={{ font: `400 11px ${MONO}`, color: 'var(--red)', marginBottom: 8 }}>{err}</div>}

      {matrix.projects.length === 0
        ? <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no projects known yet — open Workspaces &gt; Projects first</div>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', font: `400 11px ${MONO}`, minWidth: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '6px 10px 6px 4px', color: 'var(--text-tertiary)', fontWeight: 400 }}>profile</th>
                  {matrix.projects.map(p => (
                    <th key={p} title={p} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-secondary)', fontWeight: 400, whiteSpace: 'nowrap' }}>
                      {p.split('/').pop() || p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map(row => (
                  <tr key={row.profile}>
                    <td style={{ padding: '6px 10px 6px 4px', color: 'var(--accent-light)', whiteSpace: 'nowrap' }}>{row.profile}</td>
                    {row.cells.map(cell => (
                      <td key={cell.project} style={{ padding: '4px 10px' }}>
                        <span style={{ display: 'inline-flex', gap: 2 }}>
                          {MODE_BITS.map((b, i) => {
                            const on = cell.mode[i] === b
                            return (
                              <button key={b} disabled={busy} title={`${row.profile} may ${MODE_HELP[b]}`}
                                onClick={() => toggleBit(row.profile, cell.project, cell.mode, b)}
                                style={{
                                  marginTop: 0, padding: '1px 5px', minWidth: 18, cursor: 'pointer',
                                  font: `600 11px ${MONO}`,
                                  color: on ? 'var(--green)' : 'var(--text-tertiary)',
                                  background: on ? 'var(--bg-raised, transparent)' : 'transparent',
                                  border: `1px solid ${on ? 'var(--green)' : 'var(--border-subtle)'}`, borderRadius: 3,
                                }}>{on ? b : '-'}</button>
                            )
                          })}
                          {!cell.configured && <span title="never configured — denied by default" style={{ color: 'var(--text-tertiary)', marginLeft: 4 }}>·</span>}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
        <input value={newProfile} onChange={e => setNewProfile(e.target.value)} placeholder="new profile name…" style={{ width: 200 }} />
        <button className="mini" style={{ marginTop: 0 }} disabled={busy || !newProfile.trim() || !matrix.projects.length}
          onClick={() => send(async () => {
            // A new profile starts denied everywhere — it exists as a row to grant from.
            await api.put('/api/access/permission', { profile: newProfile.trim(), project: matrix.projects[0], mode: '---' })
            setNewProfile('')
          })}>add profile</button>
      </div>
    </div>
  )
}

const FA_STATUS = {
  pass: { color: 'var(--green)', gloss: 'checked against the repo and satisfied' },
  fail: { color: 'var(--red)', gloss: 'checked against the repo and not satisfied' },
  manual: { color: 'var(--text-tertiary)', gloss: 'no machine can decide this — tick it yourself once reviewed' },
  'n-a': { color: 'var(--text-tertiary)', gloss: 'scoped to a stack this project does not use' },
  unknown: { color: 'var(--violet)', gloss: 'the check itself could not run — not a pass and not a fail' },
}

// A production-readiness checklist attested against a real checkout. The differentiator is that
// most of it is actually verified rather than asserted, so the honest handling of the parts that
// cannot be verified is what makes the verified parts worth anything.
function FreezeAudit() {
  const [projects, setProjects] = useState([])
  const [project, setProject] = useState('')
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [show, setShow] = useState('actionable')

  useEffect(() => {
    api.get('/api/projects').then(list => {
      setProjects(list)
      setProject(p => p || (list.find(x => x.current) || list[0] || {}).path || '')
    }).catch(e => setErr(e.message))
  }, [])
  const load = p => { setD(null); api.get('/api/gov/freeze-audit?fresh=1&project=' + encodeURIComponent(p)).then(setD).catch(e => setErr(e.message)) }
  useEffect(() => { if (project) load(project) }, [project])

  const tick = (id, ticked) =>
    api.put('/api/gov/freeze-audit/tick', { project, id, ticked }).then(() => load(project)).catch(e => setErr(e.message))

  if (err && !d) return <div style={{ ...PANEL, color: 'var(--red)', font: `400 12px ${MONO}` }}>{err}</div>
  if (!d) return <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>auditing…</div>

  const sum = d.summary || {}
  // Default view hides what nobody can act on right now. The counts stay visible so the list
  // never reads as the whole checklist.
  const rows = (d.items || []).filter(i => show === 'all' || ['fail', 'unknown', 'manual'].includes(i.status))
  const ready = d.verdict === 'READY TO FREEZE'

  return (
    <div style={{ ...PANEL }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ font: `600 14px ${HEAD}` }}>Freeze audit</div>
        <select value={project} onChange={e => setProject(e.target.value)} style={{ maxWidth: 280 }}>
          {projects.map(p => <option key={p.path} value={p.path}>{p.name}</option>)}
        </select>
        <span style={{ font: `600 11px ${MONO}`, color: ready ? 'var(--green)' : 'var(--amber, #d79921)' }}>{d.verdict}</span>
        <select value={show} onChange={e => setShow(e.target.value)} style={{ marginLeft: 'auto' }}>
          <option value="actionable">needs attention</option>
          <option value="all">all {sum.total} items</option>
        </select>
      </div>

      <div style={{ display: 'flex', gap: 14, font: `400 11px ${MONO}`, marginBottom: 6, flexWrap: 'wrap' }}>
        {['pass', 'fail', 'manual', 'n-a', 'unknown'].map(k => (
          <span key={k} title={FA_STATUS[k].gloss} style={{ color: FA_STATUS[k].color }}>{sum[k] || 0} {k}</span>
        ))}
      </div>
      <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.6 }}>
        {/* Stack scoping decides which items even apply, so showing the evidence for it keeps a
            wrong guess visible instead of quietly turning real failures into n-a. */}
        stacks detected: {d.detectedStacks?.length ? d.detectedStacks.join(', ') : 'none'}
        {d.stackEvidence && Object.keys(d.stackEvidence).length > 0 && ' (' + Object.entries(d.stackEvidence).map(([k, v]) => `${k}: ${v.join('; ')}`).join(' · ') + ')'}
        <div>
          <b>{sum.manual || 0}</b> items no machine can decide — they stay open until a human ticks them.
          {sum.unknown > 0 && <> <b style={{ color: 'var(--violet)' }}>{sum.unknown} could not be checked at all</b>, which blocks a freeze exactly as hard as a failure.</>}
        </div>
      </div>
      {err && <div style={{ font: `400 11px ${MONO}`, color: 'var(--red)', marginBottom: 8 }}>{err}</div>}

      <div style={{ maxHeight: 520, overflowY: 'auto' }}>
        {rows.map(i => {
          const st = FA_STATUS[i.status] || FA_STATUS.unknown
          const isTicked = (d.ticked || []).includes(i.id)
          return (
            <div key={i.id} style={{ display: 'flex', gap: 10, padding: '7px 4px', borderBottom: '1px solid var(--border-subtle)', font: `400 11px ${MONO}`, alignItems: 'flex-start' }}>
              <span title={st.gloss} style={{ color: st.color, width: 62, flexShrink: 0 }}>{i.status}</span>
              <span style={{ color: 'var(--text-tertiary)', width: 54, flexShrink: 0 }}>{i.id}</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: 'var(--text-secondary)' }}>{i.text}</div>
                {/* Evidence is what separates this from a checklist you tick by feel. */}
                {i.evidence?.detail && <div style={{ color: 'var(--text-tertiary)', marginTop: 2 }}>{i.evidence.detail}</div>}
                {i.status === 'manual' && i.manualReason && <div style={{ color: 'var(--text-tertiary)', marginTop: 2 }}>manual: {i.manualReason}</div>}
              </div>
              {/* A tick can only settle a `manual` item. It deliberately cannot clear a fail or
                  an unknown — a human asserting a machine-checkable fact we already checked and
                  found false is exactly the failure this whole screen exists to prevent. */}
              {i.status === 'manual' && (
                <label style={{ flexShrink: 0, display: 'flex', gap: 4, alignItems: 'center', color: isTicked ? 'var(--green)' : 'var(--text-tertiary)' }}>
                  <input type="checkbox" checked={isTicked} onChange={e => tick(i.id, e.target.checked)} />
                  reviewed
                </label>
              )}
            </div>
          )
        })}
        {rows.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--green)' }}>nothing needs attention</div>}
      </div>
    </div>
  )
}

function Audit() {
  const [list, setList] = useState([])
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  useEffect(() => { api.get('/api/gov/versions?q=' + encodeURIComponent(dq)).then(setList).catch(() => {}) }, [dq]) // debounced
  return (
    <div style={{ ...PANEL }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 12 }}>
        <div style={{ font: `600 14px ${HEAD}` }}>Immutable audit log</div>
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>append-only · {tildify('~/.claude/dashboard-versions.jsonl')}</span>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="search…" style={{ marginLeft: 'auto', width: 220 }} />
        <button className="mini" style={{ marginTop: 0 }} disabled={!list.length} onClick={() => {
          const blob = new Blob([list.map(v => JSON.stringify(v)).join('\n')], { type: 'application/x-ndjson' })
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'audit-log.jsonl'; a.click(); URL.revokeObjectURL(a.href)
        }}>export</button>
      </div>
      <div style={{ maxHeight: 520, overflowY: 'auto' }}>
        {list.map(v => (
          <div key={v.id} style={{ display: 'flex', gap: 12, padding: '8px 4px', borderBottom: '1px solid var(--border-subtle)', font: `400 11px ${MONO}` }}>
            <span style={{ color: 'var(--text-tertiary)', flexShrink: 0, width: 150 }}>{fmtDate(v.ts)}</span>
            <span style={{ color: 'var(--accent-light)', flexShrink: 0, width: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.author}@{v.machine?.split('.')[0]}</span>
            <span style={{ color: 'var(--violet)', flexShrink: 0, width: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.scope === 'global' ? 'global' : v.scope.split('/').pop()}</span>
            <span style={{ color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.summary} <span style={{ color: 'var(--text-tertiary)' }}>· {tildify(v.file)}</span></span>
            {v.approvedBy && <span style={{ color: 'var(--green)', flexShrink: 0 }}>✓ {v.approvedBy}</span>}
          </div>
        ))}
        {list.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>empty — every dashboard config write lands here</div>}
      </div>
    </div>
  )
}

// feature 19: apply one change across many projects — always dry-run first
const BATCH_OPS = [
  ['set-setting', 'set a settings field'],
  ['enable-skill', 'enable a global skill'],
  ['disable-skill', 'disable a project skill'],
  ['push-rule', 'push a rule to CLAUDE.md'],
  ['sync-drift', 'sync drift from baseline'],
]
function BatchOps() {
  const scopes = useScopes()
  const [op, setOp] = useState('set-setting')
  const [targets, setTargets] = useState([])
  const [skills, setSkills] = useState([])
  const [params, setParams] = useState({ path: 'harness.turnPolicy.maxTurns', value: '40', skill: '', rule: '' })
  const [result, setResult] = useState(null)
  useEffect(() => { api.get('/api/res/skills').then(s => setSkills([...new Set(s.map(x => x.name))])).catch(() => {}) }, [])
  const projects = scopes.filter(s => s.id !== 'global')
  const toggle = id => { setTargets(t => t.includes(id) ? t.filter(x => x !== id) : [...t, id]); setResult(null) }
  const buildParams = () => {
    if (op === 'set-setting') { let v; try { v = JSON.parse(params.value) } catch { v = params.value }; return { path: params.path, value: v } }
    if (op === 'enable-skill' || op === 'disable-skill') return { skill: params.skill }
    if (op === 'push-rule') return { rule: params.rule }
    return {}
  }
  const run = dryRun => api.post('/api/batch', { op, targets, params: buildParams(), dryRun }).then(setResult).catch(e => alert(e.message))
  const set = (k, v) => { setParams(p => ({ ...p, [k]: v })); setResult(null) }
  return (
    <div className="hx-2a">
      <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ font: `600 14px ${HEAD}` }}>Batch operation</div>
        <select value={op} onChange={e => { setOp(e.target.value); setResult(null) }} style={{ width: '100%' }}>
          {BATCH_OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {op === 'set-setting' && <>
          <input value={params.path} onChange={e => set('path', e.target.value)} placeholder="dot path, e.g. harness.turnPolicy.maxTurns" />
          <input value={params.value} onChange={e => set('value', e.target.value)} placeholder='value (JSON) — null deletes the field' />
        </>}
        {(op === 'enable-skill' || op === 'disable-skill') && (
          <select value={params.skill} onChange={e => set('skill', e.target.value)} style={{ width: '100%' }}>
            <option value="">— pick a skill —</option>
            {skills.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {op === 'push-rule' && <textarea rows={4} value={params.rule} onChange={e => set('rule', e.target.value)} placeholder={'markdown appended to each project\'s CLAUDE.md (skipped when already present)'} />}
        {op === 'sync-drift' && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>syncs every drifted field back to the project's baseline bundle — projects without a baseline are skipped</div>}
        <div>
          <div style={{ font: `600 11px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 8 }}>
            targets <button className="mini" style={{ marginTop: 0, marginLeft: 8 }} onClick={() => setTargets(targets.length === projects.length ? [] : projects.map(p => p.id))}>{targets.length === projects.length ? 'none' : 'all'}</button>
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {projects.map(p => (
              <label key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', font: `400 12px ${MONO}`, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" style={{ width: 13 }} checked={targets.includes(p.id)} onChange={() => toggle(p.id)} />
                {p.label} {p.ovCount > 0 && <span style={{ font: `600 8px ${MONO}`, padding: '1px 5px', borderRadius: 4, background: 'var(--violet-bg)', color: 'var(--violet)' }}>OVR {p.ovCount}</span>}
              </label>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => run(true)} disabled={!targets.length}>Dry run</button>
          <button className="primary" onClick={() => run(false)} disabled={!result?.dryRun || !result.results.some(r => r.changed)}>Apply to {targets.length} project{targets.length === 1 ? '' : 's'}</button>
        </div>
        <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>apply is enabled only after a dry run · every write is versioned and reversible in Versions</div>
      </div>
      <div style={{ ...PANEL }}>
        <div style={{ font: `600 14px ${HEAD}`, marginBottom: 12 }}>{result ? (result.dryRun ? 'Dry-run preview' : 'Applied') : 'Preview'}</div>
        {result?.results.map(r => (
          <div key={r.target} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{ font: `600 12px ${MONO}`, color: 'var(--accent-light)', flexShrink: 0, width: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.target.split('/').pop()}</span>
            <span style={{ flex: 1, font: `400 12px ${MONO}`, color: r.desc.startsWith('error') ? 'var(--red)' : r.changed ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>{r.desc}</span>
            <span style={{ font: `600 10px ${MONO}`, color: r.applied ? 'var(--green)' : r.changed ? 'var(--amber)' : 'var(--text-tertiary)', flexShrink: 0 }}>{r.applied ? '✓ applied' : r.changed ? 'would change' : 'no-op'}</span>
          </div>
        ))}
        {!result && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>pick targets and dry-run to see per-project effects</div>}
      </div>
    </div>
  )
}

function Drift() {
  const scopes = useScopes()
  const [project, setProject] = useState('')
  const [library, setLibrary] = useState([])
  const [drift, setDrift] = useState(null)
  useEffect(() => { api.get('/api/gov/library').then(setLibrary) }, [])
  useEffect(() => { if (scopes.length > 1 && !project) setProject(scopes[1].id) }, [scopes])
  const load = () => project && api.get('/api/gov/drift?project=' + encodeURIComponent(project)).then(setDrift)
  useEffect(() => { load() }, [project])
  const setBaseline = async file => { await api.post('/api/gov/baseline', { project, file }); load() }
  const sync = async field => { await api.post('/api/gov/drift/sync', { project, field }).catch(e => alert(e.message)); load() }
  return (
    <div style={{ ...PANEL }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ font: `600 14px ${HEAD}` }}>Drift vs agreed baseline</div>
        <select value={project} onChange={e => setProject(e.target.value)}>
          {scopes.filter(s => s.id !== 'global').map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={drift?.baseline || ''} onChange={e => setBaseline(e.target.value)} style={{ maxWidth: 260 }}>
          <option value="">— pick baseline bundle —</option>
          {library.map(b => <option key={b.file} value={b.file}>{b.name} ({b.provenance?.author}@{b.provenance?.machine?.split('.')[0]})</option>)}
        </select>
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>export a bundle in Library → Bundles, share it, and compare any machine against it</span>
      </div>
      {!drift?.baseline && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no baseline set for this project</div>}
      {drift?.baseline && drift.drifts.length === 0 && <div style={{ font: `400 12px ${MONO}`, color: 'var(--green)' }}>✓ in sync with baseline "{drift.baseline}"</div>}
      {drift?.drifts.map(x => (
        <div key={x.field} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ font: `600 12px ${MONO}`, color: 'var(--accent-light)' }}>{x.field}</span>
            <button className="mini" onClick={() => sync(x.field)} disabled={!x.syncable}>sync from baseline</button>
          </div>
          <div className="hx-2" style={{ gap: 10 }}>
            <pre style={{ margin: 0, padding: 10, font: `400 11px/1.5 ${MONO}`, color: 'var(--text-secondary)', background: 'var(--bg-inset)', borderRadius: 8, overflow: 'hidden' }}>baseline: {x.baseline}</pre>
            <pre style={{ margin: 0, padding: 10, font: `400 11px/1.5 ${MONO}`, color: 'var(--text-secondary)', background: 'var(--bg-inset)', borderRadius: 8, overflow: 'hidden' }}>current: {x.current}</pre>
          </div>
        </div>
      ))}
    </div>
  )
}
