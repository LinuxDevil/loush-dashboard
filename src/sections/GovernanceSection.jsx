import React, { useEffect, useState } from 'react'
import { useDebounced } from '../lib/hooks.js'
import { api, tildify, fmtDate } from '../lib/api.js'
import { Tabs, DiffView, lineDiff } from '../ui/tabs.jsx'

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }

export default function GovernanceSection() {
  const [tab, setTab] = useState('Versions')
  return (
    <div className="hx" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Tabs tabs={['Versions', 'Approvals', 'Audit log', 'Drift', 'Batch ops']} tab={tab} setTab={setTab} />
      {tab === 'Versions' && <Versions />}
      {tab === 'Approvals' && <Approvals />}
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
            <div key={v.id} onClick={() => inspect(v.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px', borderBottom: '1px solid rgba(255,255,255,0.045)', cursor: 'pointer', borderRadius: 8, background: sel.includes(v.id) ? 'rgba(217,119,87,0.08)' : 'transparent' }}>
              <input type="checkbox" checked={sel.includes(v.id)} onClick={e => e.stopPropagation()} onChange={() => pick(v.id)} style={{ width: 14 }} aria-label="select for compare" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "500 12.5px 'IBM Plex Sans'", color: '#eee3da', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.summary || '(no summary)'}</div>
                <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{tildify(v.file)} · {v.author}{v.approvedBy ? ` · approved by ${v.approvedBy}` : ''}</div>
              </div>
              <span style={{ font: `400 10px ${MONO}`, color: '#8a807a', flexShrink: 0 }}>{fmtDate(v.ts)}</span>
              <button className="mini" onClick={e => { e.stopPropagation(); rollback(v.id, 'prev') }} title="restore the state before this change">undo</button>
            </div>
          ))}
          {list.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>no tracked changes yet — edits made through the dashboard appear here</div>}
        </div>
        <div style={{ marginTop: 10, font: `400 10.5px ${MONO}`, color: '#7a716a' }}>tick two entries to diff between versions · click one to see its change</div>
      </div>
      <div style={{ ...PANEL }}>
        <div style={{ font: `600 15px ${HEAD}`, marginBottom: 12 }}>{diff ? diff.title : 'Diff'}</div>
        {diff ? <>
          <DiffView before={diff.before} after={diff.after} />
          {diff.id && <button className="mini" style={{ marginTop: 10 }} onClick={() => rollback(diff.id, 'content')}>restore this version</button>}
        </> : <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>select a change on the left</div>}
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
        <div style={{ font: `600 15px ${HEAD}`, marginBottom: 6 }}>Proposed global changes</div>
        <div style={{ font: `400 11px ${MONO}`, color: '#7a716a', marginBottom: 12 }}>global config edits take effect only after review · project edits apply directly but are logged</div>
        {pending.map(p => (
          <div key={p.id} onClick={() => view(p)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px', borderBottom: '1px solid rgba(255,255,255,0.045)', cursor: 'pointer', borderRadius: 8, background: open?.id === p.id ? 'rgba(217,119,87,0.08)' : 'transparent' }}>
            <span style={{ font: `600 9px ${MONO}`, padding: '2px 7px', borderRadius: 5, background: 'rgba(232,160,106,0.16)', color: '#e8a06a', flexShrink: 0 }}>PROPOSED</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "500 12.5px 'IBM Plex Sans'", color: '#eee3da' }}>{p.summary}</div>
              <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{p.author} · {fmtDate(p.ts)}</div>
            </div>
          </div>
        ))}
        {pending.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>nothing awaiting review</div>}
        <div style={{ marginTop: 18, font: `600 11px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7a716a', marginBottom: 6 }}>Recently reviewed</div>
        {list.filter(a => a.status !== 'proposed').slice(0, 8).map(p => (
          <div key={p.id} style={{ display: 'flex', gap: 10, padding: '7px 8px', font: `400 11px ${MONO}`, color: '#8a807a', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ color: p.status === 'approved' ? '#3fb96a' : '#e5484d' }}>{p.status}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.summary}</span>
            <span>{p.reviewedBy}{p.note ? ` — ${p.note.slice(0, 30)}` : ''}</span>
          </div>
        ))}
      </div>
      <div style={{ ...PANEL }}>
        {open ? <>
          <div style={{ font: `600 15px ${HEAD}`, marginBottom: 12 }}>Review: {open.summary}</div>
          <DiffView before={current} after={open.content} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="review note (optional)" style={{ flex: 1 }} />
            <button className="primary" onClick={() => decide(true)}>Approve</button>
            <button className="danger" onClick={() => decide(false)}>Reject</button>
          </div>
        </> : <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>select a proposal to review its diff against the current global config</div>}
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
        <div style={{ font: `600 15px ${HEAD}` }}>Immutable audit log</div>
        <span style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>append-only · {tildify('~/.claude/dashboard-versions.jsonl')}</span>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="search…" style={{ marginLeft: 'auto', width: 220 }} />
        <button className="mini" style={{ marginTop: 0 }} disabled={!list.length} onClick={() => {
          const blob = new Blob([list.map(v => JSON.stringify(v)).join('\n')], { type: 'application/x-ndjson' })
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'audit-log.jsonl'; a.click(); URL.revokeObjectURL(a.href)
        }}>export</button>
      </div>
      <div style={{ maxHeight: 520, overflowY: 'auto' }}>
        {list.map(v => (
          <div key={v.id} style={{ display: 'flex', gap: 12, padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.045)', font: `400 11px ${MONO}` }}>
            <span style={{ color: '#7a716a', flexShrink: 0, width: 150 }}>{fmtDate(v.ts)}</span>
            <span style={{ color: '#e8a06a', flexShrink: 0, width: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.author}@{v.machine?.split('.')[0]}</span>
            <span style={{ color: '#8b7cf6', flexShrink: 0, width: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.scope === 'global' ? 'global' : v.scope.split('/').pop()}</span>
            <span style={{ color: '#c8bdb4', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.summary} <span style={{ color: '#5a514a' }}>· {tildify(v.file)}</span></span>
            {v.approvedBy && <span style={{ color: '#3fb96a', flexShrink: 0 }}>✓ {v.approvedBy}</span>}
          </div>
        ))}
        {list.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>empty — every dashboard config write lands here</div>}
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
        <div style={{ font: `600 15px ${HEAD}` }}>Batch operation</div>
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
        {op === 'sync-drift' && <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>syncs every drifted field back to the project's baseline bundle — projects without a baseline are skipped</div>}
        <div>
          <div style={{ font: `600 11px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a807a', marginBottom: 8 }}>
            targets <button className="mini" style={{ marginTop: 0, marginLeft: 8 }} onClick={() => setTargets(targets.length === projects.length ? [] : projects.map(p => p.id))}>{targets.length === projects.length ? 'none' : 'all'}</button>
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {projects.map(p => (
              <label key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', font: `400 12px ${MONO}`, color: '#c8bdb4', cursor: 'pointer' }}>
                <input type="checkbox" style={{ width: 13 }} checked={targets.includes(p.id)} onChange={() => toggle(p.id)} />
                {p.label} {p.ovCount > 0 && <span style={{ font: `600 8px ${MONO}`, padding: '1px 5px', borderRadius: 4, background: 'rgba(139,124,246,0.16)', color: '#a78bfa' }}>OVR {p.ovCount}</span>}
              </label>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => run(true)} disabled={!targets.length}>Dry run</button>
          <button className="primary" onClick={() => run(false)} disabled={!result?.dryRun || !result.results.some(r => r.changed)}>Apply to {targets.length} project{targets.length === 1 ? '' : 's'}</button>
        </div>
        <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>apply is enabled only after a dry run · every write is versioned and reversible in Versions</div>
      </div>
      <div style={{ ...PANEL }}>
        <div style={{ font: `600 15px ${HEAD}`, marginBottom: 12 }}>{result ? (result.dryRun ? 'Dry-run preview' : 'Applied') : 'Preview'}</div>
        {result?.results.map(r => (
          <div key={r.target} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
            <span style={{ font: `600 12px ${MONO}`, color: '#e8a06a', flexShrink: 0, width: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.target.split('/').pop()}</span>
            <span style={{ flex: 1, font: `400 11.5px ${MONO}`, color: r.desc.startsWith('error') ? '#e5484d' : r.changed ? '#c8bdb4' : '#7a716a' }}>{r.desc}</span>
            <span style={{ font: `600 10px ${MONO}`, color: r.applied ? '#3fb96a' : r.changed ? '#e5a03a' : '#5a514a', flexShrink: 0 }}>{r.applied ? '✓ applied' : r.changed ? 'would change' : 'no-op'}</span>
          </div>
        ))}
        {!result && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>pick targets and dry-run to see per-project effects</div>}
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
        <div style={{ font: `600 15px ${HEAD}` }}>Drift vs agreed baseline</div>
        <select value={project} onChange={e => setProject(e.target.value)}>
          {scopes.filter(s => s.id !== 'global').map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={drift?.baseline || ''} onChange={e => setBaseline(e.target.value)} style={{ maxWidth: 260 }}>
          <option value="">— pick baseline bundle —</option>
          {library.map(b => <option key={b.file} value={b.file}>{b.name} ({b.provenance?.author}@{b.provenance?.machine?.split('.')[0]})</option>)}
        </select>
        <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>export a bundle in Library → Bundles, share it, and compare any machine against it</span>
      </div>
      {!drift?.baseline && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>no baseline set for this project</div>}
      {drift?.baseline && drift.drifts.length === 0 && <div style={{ font: `400 12px ${MONO}`, color: '#3fb96a' }}>✓ in sync with baseline "{drift.baseline}"</div>}
      {drift?.drifts.map(x => (
        <div key={x.field} style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ font: `600 12px ${MONO}`, color: '#e8a06a' }}>{x.field}</span>
            <button className="mini" onClick={() => sync(x.field)} disabled={!x.syncable}>sync from baseline</button>
          </div>
          <div className="hx-2" style={{ gap: 10 }}>
            <pre style={{ margin: 0, padding: 10, font: `400 10.5px/1.5 ${MONO}`, color: '#8a807a', background: 'rgba(0,0,0,0.25)', borderRadius: 8, overflow: 'hidden' }}>baseline: {x.baseline}</pre>
            <pre style={{ margin: 0, padding: 10, font: `400 10.5px/1.5 ${MONO}`, color: '#c8bdb4', background: 'rgba(0,0,0,0.25)', borderRadius: 8, overflow: 'hidden' }}>current: {x.current}</pre>
          </div>
        </div>
      ))}
    </div>
  )
}
