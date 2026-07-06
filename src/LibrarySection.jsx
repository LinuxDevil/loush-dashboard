import React, { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { api, fmtDate, toast } from './api.js'
import { Tabs } from './GovernanceSection.jsx'

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }
const SEV = { error: '#e5484d', warning: '#e8a06a', info: '#8a807a' }

function useScopes() {
  const [scopes, setScopes] = useState([])
  useEffect(() => { api.get('/api/harness').then(d => setScopes(d.scopes)).catch(() => {}) }, [])
  return scopes
}

export default function LibrarySection() {
  const [tab, setTab] = useState('Profiles')
  return (
    <div className="hx" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Tabs tabs={['Profiles', 'Bundles', 'Context bundles', 'Recommendations']} tab={tab} setTab={setTab} />
      {tab === 'Profiles' && <Profiles />}
      {tab === 'Bundles' && <Bundles />}
      {tab === 'Context bundles' && <CtxBundles />}
      {tab === 'Recommendations' && <Recs />}
    </div>
  )
}

function Profiles() {
  const scopes = useScopes()
  const [profiles, setProfiles] = useState([])
  const [editing, setEditing] = useState(null) // {index, text}
  const [applyScope, setApplyScope] = useState('global')
  const load = () => api.get('/api/gov/profiles').then(setProfiles)
  useEffect(() => { load() }, [])
  const save = async next => { await api.put('/api/gov/profiles', { profiles: next }).catch(e => toast(e.message, 'error')); load() }
  const apply = async name => {
    const r = await api.post('/api/gov/profiles/apply', { name, scope: applyScope }).catch(e => toast(e.message, 'error'))
    if (r?.proposed) alert('Global change proposed — approve it in Governance → Approvals')
    else if (r?.ok) alert(`Profile "${name}" applied to ${applyScope === 'global' ? 'global' : applyScope.split('/').pop()}`)
  }
  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>apply to</span>
        <select value={applyScope} onChange={e => setApplyScope(e.target.value)}>
          {scopes.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button className="mini" style={{ marginTop: 0 }} onClick={() => save([...profiles, { name: 'new profile', description: '', harness: { turnPolicy: { maxTurns: 40 } } }])}>+ new profile</button>
        <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginLeft: 'auto' }}>profiles merge into the scope's harness config · versioned like any change</span>
      </div>
      <div className="hx-overview" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        {profiles.map((p, i) => (
          <div key={p.name + i} style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ font: `600 15px ${HEAD}` }}>{p.name}</div>
            <div style={{ font: "400 12px 'IBM Plex Sans'", color: '#b0a69e', lineHeight: 1.5, flex: 1 }}>{p.description || 'no description'}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {p.harness?.turnPolicy?.maxTurns && <span style={{ font: `500 10px ${MONO}`, padding: '2px 8px', borderRadius: 6, background: 'rgba(217,119,87,0.12)', color: '#e8a06a' }}>{p.harness.turnPolicy.maxTurns} turns</span>}
              {p.harness?.modelRouting?.[0] && <span style={{ font: `500 10px ${MONO}`, padding: '2px 8px', borderRadius: 6, background: 'rgba(139,124,246,0.12)', color: '#a78bfa' }}>plan: {p.harness.modelRouting[0].model}</span>}
              {p.harness?.context?.compactionThreshold && <span style={{ font: `500 10px ${MONO}`, padding: '2px 8px', borderRadius: 6, background: 'rgba(94,179,246,0.12)', color: '#7cc4f7' }}>compact @{Math.round(p.harness.context.compactionThreshold * 100)}%</span>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="primary" style={{ fontSize: 12 }} onClick={() => apply(p.name)}>Apply</button>
              <button className="mini" style={{ marginTop: 0 }} onClick={() => setEditing({ index: i, text: JSON.stringify(p, null, 2) })}>edit</button>
              <button className="mini" style={{ marginTop: 0 }} onClick={() => save([...profiles, { ...p, name: p.name + ' copy' }])}>duplicate</button>
              <button className="mini danger" style={{ marginTop: 0 }} onClick={() => confirm('Delete profile?') && save(profiles.filter((_, j) => j !== i))}>delete</button>
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <>
          <div className="drawer-overlay" onClick={() => setEditing(null)} />
          <div className="drawer" role="dialog" aria-label="edit profile" style={{ width: 520 }}>
            <div className="drawer-head"><h3>Edit profile</h3><button className="ghost" onClick={() => setEditing(null)}>✕</button></div>
            <div className="drawer-body" style={{ padding: 0 }}>
              <CodeMirror value={editing.text} height="100%" theme="dark" extensions={[json()]} onChange={v => setEditing(e => ({ ...e, text: v }))} className="editor" />
            </div>
            <div className="drawer-foot">
              <button onClick={() => setEditing(null)}>Cancel</button>
              <button className="primary" onClick={() => {
                try {
                  const p = JSON.parse(editing.text)
                  save(profiles.map((x, j) => j === editing.index ? p : x)); setEditing(null)
                } catch (e) { alert('invalid JSON: ' + e.message) }
              }}>Save</button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function Bundles() {
  const scopes = useScopes()
  const [library, setLibrary] = useState([])
  const [project, setProject] = useState('')
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const load = () => api.get('/api/gov/library').then(setLibrary)
  useEffect(() => { load() }, [])
  useEffect(() => { if (scopes.length > 1 && !project) setProject(scopes[1].id) }, [scopes])
  const exportB = async () => {
    const r = await api.post('/api/gov/bundle/export', { project, name: name || undefined, description: desc }).catch(e => toast(e.message, 'error'))
    if (r?.ok) { setName(''); setDesc(''); load() }
  }
  const importB = async file => {
    const target = scopes.filter(s => s.id !== 'global').find(s => s.id === prompt('Import into which project path?', project))?.id || project
    if (!confirm(`Import bundle into ${target}? Existing files are overwritten (versioned, reversible).`)) return
    const r = await api.post('/api/gov/bundle/import', { file, project: target }).catch(e => toast(e.message, 'error'))
    if (r?.ok) alert('Imported: ' + r.written.join(', '))
  }
  const download = async b => {
    const full = await api.get('/api/hub/file?path=' + encodeURIComponent(b.path || '')).catch(() => null)
    const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = b.name + '.harness.json'; a.click()
  }
  return (
    <div className="hx-2a">
      <div style={{ ...PANEL }}>
        <div style={{ font: `600 15px ${HEAD}`, marginBottom: 12 }}>Export a project's harness</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <select value={project} onChange={e => setProject(e.target.value)}>
            {scopes.filter(s => s.id !== 'global').map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="bundle name (defaults to project name)" />
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="description — what this harness is tuned for" />
          <button className="primary" onClick={exportB}>Export to library</button>
          <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', lineHeight: 1.6 }}>bundles include project rules, skills, agents, MCP config, and profiles — share the file from ~/.claude/harness-library/ with your team, or set one as a drift baseline in Governance → Drift</div>
        </div>
      </div>
      <div style={{ ...PANEL }}>
        <div style={{ font: `600 15px ${HEAD}`, marginBottom: 12 }}>Harness library</div>
        {library.map(b => (
          <div key={b.file} style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ font: `600 13px ${MONO}`, color: '#eee3da' }}>{b.name}</span>
              <span style={{ font: `400 10px ${MONO}`, color: '#7a716a' }}>{b.counts.rules} rules · {b.counts.skills} skills · {b.counts.agents} agents</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="mini" style={{ marginTop: 0 }} onClick={() => importB(b.file)}>import…</button>
              </span>
            </div>
            <div style={{ font: "400 11.5px 'IBM Plex Sans'", color: '#b0a69e', marginTop: 3 }}>{b.description || '—'}</div>
            <div style={{ font: `400 10px ${MONO}`, color: '#5a514a', marginTop: 2 }}>from {b.provenance?.author}@{b.provenance?.machine?.split('.')[0]} · {b.provenance?.project?.split('/').pop()} · {fmtDate(b.provenance?.createdAt)}</div>
          </div>
        ))}
        {library.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>empty — export a project to start your library</div>}
      </div>
    </div>
  )
}

// feature 22: named sets of files/docs/rules to load into a session in one go
export const bundlePrompt = b =>
  `Load this context before we start — "${b.name}"${b.description ? ` (${b.description})` : ''}:\n` +
  (b.refs || []).map(r => `- read ${r.startsWith('http') ? r : '@' + r}`).join('\n') +
  (b.notes ? `\n\nNotes:\n${b.notes}` : '')

function CtxBundles() {
  const [bundles, setBundles] = useState([])
  const [edit, setEdit] = useState(null) // {index|-1, name, description, refs (textarea), notes}
  const load = () => api.get('/api/ctxbundles').then(setBundles)
  useEffect(() => { load() }, [])
  const save = async list => { await api.put('/api/ctxbundles', { bundles: list }).catch(e => toast(e.message, 'error')); load() }
  const copy = b => navigator.clipboard.writeText(bundlePrompt(b)).then(() => alert('load-prompt copied — paste it into any session (Chat section or the CLI)'))
  const toChat = b => { sessionStorage.setItem('ctx-bundle-prompt', bundlePrompt(b)); window.dispatchEvent(new Event('nav-chat')) }
  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="mini" style={{ marginTop: 0 }} onClick={() => setEdit({ index: -1, name: '', description: '', refs: '', notes: '' })}>+ new context bundle</button>
        <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>stop re-attaching the same files — save a named set once, load it into any session on demand · stored in ~/.claude/context-bundles.json</span>
      </div>
      <div className="hx-overview" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        {bundles.map((b, i) => (
          <div key={b.name + i} style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ font: `600 15px ${HEAD}` }}>{b.name}</div>
            <div style={{ font: "400 12px 'IBM Plex Sans'", color: '#b0a69e', lineHeight: 1.5 }}>{b.description || 'no description'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
              {(b.refs || []).slice(0, 6).map(r => <span key={r} style={{ font: `400 10.5px ${MONO}`, color: '#8a807a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {r}</span>)}
              {(b.refs || []).length > 6 && <span style={{ font: `400 10px ${MONO}`, color: '#5a514a' }}>+{b.refs.length - 6} more</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="primary" style={{ fontSize: 12 }} onClick={() => toChat(b)}>Load in chat</button>
              <button className="mini" style={{ marginTop: 0 }} onClick={() => copy(b)}>copy prompt</button>
              <button className="mini" style={{ marginTop: 0 }} onClick={() => setEdit({ index: i, name: b.name, description: b.description || '', refs: (b.refs || []).join('\n'), notes: b.notes || '' })}>edit</button>
              <button className="mini danger" style={{ marginTop: 0 }} onClick={() => confirm('Delete bundle?') && save(bundles.filter((_, j) => j !== i))}>delete</button>
            </div>
          </div>
        ))}
        {bundles.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>none yet — e.g. "auth subsystem context": the 6 files + ADR you attach every time</div>}
      </div>
      {edit && (
        <>
          <div className="drawer-overlay" onClick={() => setEdit(null)} />
          <div className="drawer" role="dialog" aria-label="edit context bundle">
            <div className="drawer-head"><h3>{edit.index < 0 ? 'New' : 'Edit'} context bundle</h3><button className="ghost" onClick={() => setEdit(null)}>✕</button></div>
            <div className="drawer-body">
              <label className="field">name<input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="auth subsystem context" /></label>
              <label className="field">description<input value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} /></label>
              <label className="field">references — one path or URL per line
                <textarea rows={7} value={edit.refs} onChange={e => setEdit({ ...edit, refs: e.target.value })} placeholder={'src/auth/session.ts\ndocs/adr/007-auth.md\nhttps://…'} /></label>
              <label className="field">notes / rules loaded with it
                <textarea rows={4} value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></label>
            </div>
            <div className="drawer-foot">
              <button onClick={() => setEdit(null)}>Cancel</button>
              <button className="primary" disabled={!edit.name.trim()} onClick={() => {
                const b = { name: edit.name.trim(), description: edit.description, refs: edit.refs.split('\n').map(s => s.trim()).filter(Boolean), notes: edit.notes }
                save(edit.index < 0 ? [...bundles, b] : bundles.map((x, j) => j === edit.index ? b : x)); setEdit(null)
              }}>Save</button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function Recs() {
  const scopes = useScopes()
  const [project, setProject] = useState('')
  const [recs, setRecs] = useState([])
  useEffect(() => { if (scopes.length > 1 && !project) setProject(scopes[1].id) }, [scopes])
  const load = () => api.get('/api/gov/recs?project=' + encodeURIComponent(project)).then(setRecs)
  useEffect(() => { if (project) load() }, [project])
  const dismiss = async r => {
    const reason = prompt('Dismiss reason (recorded):', 'intentional')
    if (reason === null) return
    await api.post('/api/gov/recs/dismiss', { key: r.key, reason })
    load()
  }
  const active = recs.filter(r => !r.dismissed), gone = recs.filter(r => r.dismissed)
  return (
    <div style={{ ...PANEL }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <div style={{ font: `600 15px ${HEAD}` }}>Recommendations</div>
        <select value={project} onChange={e => setProject(e.target.value)}>
          {scopes.filter(s => s.id !== 'global').map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>computed live from the resolved config · feeds the project health score</span>
      </div>
      {active.map(r => (
        <div key={r.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
          <span style={{ font: `600 9px ${MONO}`, padding: '2px 6px', borderRadius: 4, color: SEV[r.severity], background: 'rgba(255,255,255,0.04)', flexShrink: 0 }}>{r.severity.toUpperCase()}</span>
          <span style={{ flex: 1, font: "400 12.5px 'IBM Plex Sans'", color: '#c8bdb4', lineHeight: 1.5 }}>{r.text}</span>
          {r.fix && <span style={{ font: `400 10px ${MONO}`, color: '#7a716a', flexShrink: 0, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.fix}>{r.fix.split('/').slice(-2).join('/')}</span>}
          <button className="mini" style={{ marginTop: 0, flexShrink: 0 }} onClick={() => dismiss(r)}>dismiss</button>
        </div>
      ))}
      {active.length === 0 && <div style={{ font: `400 12px ${MONO}`, color: '#3fb96a' }}>✓ nothing to recommend — harness looks healthy</div>}
      {gone.length > 0 && <>
        <div style={{ font: `600 10px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7a716a', margin: '16px 0 6px' }}>Dismissed</div>
        {gone.map(r => (
          <div key={r.key} style={{ font: `400 11px ${MONO}`, color: '#5a514a', padding: '4px 0' }}>· {r.text.slice(0, 90)} — "{r.dismissed.reason}" ({r.dismissed.by})</div>
        ))}
      </>}
    </div>
  )
}
