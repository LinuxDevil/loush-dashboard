import React, { useEffect, useState } from 'react'
import { api, toast, tildify, fmtDate } from './api.js'
import { RunWindow } from './QuickActions.jsx'
import ConstitutionSection from './ConstitutionSection.jsx'

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }
const ACCENT = '#7cc4f7' // cursor mode is blue so you always know which dashboard you're in
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const fmtDur = ms => ms > 0 ? (ms >= 864e5 ? Math.round(ms / 864e5) + 'd' : ms >= 36e5 ? (ms / 36e5).toFixed(1) + 'h' : Math.round(ms / 6e4) + 'm') : '—'
const fmtNum = n => n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n)
const SCOPE = { always: ['#7cc4f7', 'always loaded'], glob: ['#e5a03a', 'on glob match'], 'agent-requested': ['#7a716a', 'agent-requested'] }
const Chip = ({ text, color = '#7a716a' }) => <span style={{ font: `500 10px ${MONO}`, color, border: `1px solid ${color}55`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{text}</span>

const Stat = ({ label, val }) => (
  <div style={{ ...PANEL, padding: '14px 18px', flex: 1, minWidth: 130 }}>
    <div style={{ font: `700 24px ${HEAD}`, color: '#e5dbd2' }}>{val ?? '—'}</div>
    <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{label}</div>
  </div>
)

function Heatmap({ heat }) {
  if (!heat) return null
  const max = Math.max(1, ...heat.flat())
  return (
    <div style={PANEL}>
      <div style={{ font: `600 13px ${HEAD}`, color: '#e5dbd2', marginBottom: 10 }}>Activity — day × hour</div>
      <div style={{ overflowX: 'auto' }}>
        {heat.map((row, d) => (
          <div key={d} style={{ display: 'flex', gap: 2, marginBottom: 2, alignItems: 'center' }}>
            <span style={{ font: `400 9.5px ${MONO}`, color: '#7a716a', width: 28 }}>{DAYS[d]}</span>
            {row.map((v, h) => (
              <div key={h} title={`${DAYS[d]} ${h}:00 — ${v} sessions`}
                style={{ width: 16, height: 14, borderRadius: 3, background: v ? `rgba(124,196,247,${0.15 + 0.85 * (v / max)})` : 'rgba(255,255,255,0.03)' }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function Overview() {
  const [o, setO] = useState(null)
  useEffect(() => { api.get('/api/cursor/overview').then(setO).catch(() => {}) }, [])
  if (!o) return <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>parsing Cursor's database… (first load reads a 2 GB sqlite file)</div>
  if (!o.available) return <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>Cursor is not installed on this machine (no state.vscdb found).</div>
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Stat label="chat sessions" val={o.sessions} />
        <Stat label="messages" val={o.messages} />
        <Stat label="workspaces" val={o.workspaces} />
        <Stat label="active days" val={o.activeDays} />
        <Stat label="subagent runs" val={o.subagents} />
      </div>
      <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>
        {isFinite(o.first) && <>first activity {fmtDate(o.first)} · last {fmtDate(o.last)}</>}
      </div>
      <Heatmap heat={o.heat} />
    </div>
  )
}

function Projects({ onOpen }) {
  const [ps, setPs] = useState(null)
  useEffect(() => { api.get('/api/cursor/projects').then(setPs).catch(() => {}) }, [])
  if (!ps) return <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>loading…</div>
  return (
    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
      {ps.map(p => (
        <div key={p.workspaceId || p.folder} style={{ ...PANEL, cursor: 'pointer' }} onClick={() => onOpen(p)}>
          <div style={{ font: `600 13.5px ${HEAD}`, color: '#e5dbd2', marginBottom: 4 }}>{p.folder ? tildify(p.folder).split('/').pop() : '(unknown workspace)'}</div>
          <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginBottom: 8, overflowWrap: 'anywhere' }}>{p.folder ? tildify(p.folder) : p.workspaceId}</div>
          <div style={{ font: `400 11px ${MONO}`, color: ACCENT }}>{p.sessions} sessions · {p.messages} msgs</div>
          <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>last active {p.last ? fmtDate(p.last) : '—'}</div>
        </div>
      ))}
    </div>
  )
}

function ChatAnalysis({ a, name, createdAt }) {
  const ctxPct = a.contextLimit ? Math.round(100 * a.contextTokens / a.contextLimit) : 0
  const cells = [
    ['model', a.model || '—'], ['user msgs', a.userMsgs], ['assistant msgs', a.asstMsgs],
    ['tool calls', `${a.toolCalls}${a.distinctTools ? ` · ${a.distinctTools} kinds` : ''}`],
    ['lines', `+${fmtNum(a.linesAdded)} / −${fmtNum(a.linesRemoved)}`],
    ['duration', fmtDur(a.durationMs)], ['files touched', a.files.length],
    ['context', a.contextTokens ? `${fmtNum(a.contextTokens)} tok${ctxPct ? ` (${ctxPct}%)` : ''}` : '—'],
  ]
  return (
    <div style={{ ...PANEL, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ font: `600 13px ${HEAD}`, color: '#e5dbd2' }}>Chat analysis</div>
        {a.agentic && <Chip text="agent" color={ACCENT} />}
        <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginLeft: 'auto' }}>{createdAt ? fmtDate(createdAt) : ''}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px,1fr))', gap: 8 }}>
        {cells.map(([l, v]) => (
          <div key={l}><div style={{ font: `600 14px ${HEAD}`, color: '#e5dbd2', overflowWrap: 'anywhere' }}>{v}</div><div style={{ font: `400 9.5px ${MONO}`, color: '#7a716a' }}>{l}</div></div>
        ))}
      </div>
      {a.rulesApplied.length > 0 && (
        <div>
          <div style={{ font: `400 10px ${MONO}`, color: '#7a716a', marginBottom: 6 }}>rules / skills that applied (recorded per message)</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{a.rulesApplied.map(r => <Chip key={r} text={r} color={ACCENT} />)}</div>
        </div>
      )}
      {a.files.length > 0 && (
        <details>
          <summary style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', cursor: 'pointer' }}>{a.files.length} files touched</summary>
          <div style={{ marginTop: 6, display: 'grid', gap: 2 }}>
            {a.files.slice(0, 40).map(f => <div key={f} style={{ font: `400 10.5px ${MONO}`, color: '#d8cfc7', overflowWrap: 'anywhere' }}>{tildify(f)}</div>)}
          </div>
        </details>
      )}
    </div>
  )
}

function SessionDetail({ id, onBack }) {
  const [s, setS] = useState(null)
  useEffect(() => { setS(null); api.get(`/api/cursor/session/${id}`).then(setS).catch(() => {}) }, [id])
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div><button onClick={onBack}>← sessions</button></div>
      {s?.analysis && <ChatAnalysis a={s.analysis} name={s.name} createdAt={s.createdAt} />}
      {!s ? <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>loading conversation…</div> : (
        <div style={{ ...PANEL, maxHeight: '70vh', overflowY: 'auto' }}>
          <div style={{ font: `600 15px ${HEAD}`, color: '#e5dbd2', marginBottom: 12 }}>{s.name || '(unnamed session)'}</div>
          {s.messages.map((m, i) => (
            <div key={i} style={{
              margin: '8px 0', padding: '8px 12px', borderRadius: 10, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
              font: `400 12.5px ${m.type === 1 ? MONO : "'IBM Plex Sans', sans-serif"}`,
              background: m.type === 1 ? 'rgba(124,196,247,0.08)' : 'rgba(255,255,255,0.03)',
              borderLeft: `2px solid ${m.type === 1 ? ACCENT : 'rgba(255,255,255,0.1)'}`, color: '#d8cfc7',
            }}>{m.text}</div>
          ))}
          {s.messages.length === 0 && <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>no text messages in this session</div>}
        </div>
      )}
    </div>
  )
}

function Harness({ folder }) {
  const [h, setH] = useState(null)
  useEffect(() => { setH(null); folder && folder.startsWith('/') ? api.get('/api/cursor/harness?workspace=' + encodeURIComponent(folder)).then(setH).catch(() => setH({ available: false })) : setH({ available: false }) }, [folder])
  if (!h) return <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>reading .cursor/ …</div>
  if (!h.available) return <div style={{ ...PANEL, font: `400 11.5px ${MONO}`, color: '#7a716a' }}>No local folder for this workspace — harness files aren't reachable.</div>
  const Group = ({ title, children, empty }) => (
    <div><div style={{ font: `600 11px ${MONO}`, color: '#9a8f86', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>{children || <div style={{ font: `400 11px ${MONO}`, color: '#5c554f' }}>{empty}</div>}</div>
  )
  return (
    <div style={{ ...PANEL, display: 'grid', gap: 16 }}>
      <div style={{ font: `600 14px ${HEAD}`, color: '#e5dbd2' }}>Harness — what's configured for this project</div>
      {/* always-loaded context: the real "what enters every chat here" */}
      <div style={{ border: `1px solid ${ACCENT}44`, borderRadius: 10, padding: '12px 14px', background: `${ACCENT}0d` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ font: `600 12px ${HEAD}`, color: ACCENT }}>Always-loaded context</div>
          <div style={{ font: `700 12px ${MONO}`, color: '#e5dbd2', marginLeft: 'auto' }}>≈{fmtNum(h.context.tokens)} tok</div>
        </div>
        <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginTop: 4 }}>
          {[...h.context.alwaysRules, h.context.agents && 'AGENTS.md', h.context.legacy && '.cursorrules'].filter(Boolean).join(' · ') || 'nothing always-on — rules load only on glob match'}
        </div>
      </div>
      <Group title={`Rules (${h.rules.length})`} empty="no .cursor/rules/*.mdc">
        {h.rules.length > 0 && <div style={{ display: 'grid', gap: 6 }}>{h.rules.map(r => (
          <div key={r.name} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <Chip text={SCOPE[r.scope][1]} color={SCOPE[r.scope][0]} />
            <span style={{ font: `500 12px ${MONO}`, color: '#e5dbd2' }}>{r.name}</span>
            {r.globs && <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{r.globs}</span>}
            <span style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginLeft: 'auto' }}>≈{fmtNum(r.tokens)} tok</span>
            {r.description && <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', flexBasis: '100%' }}>{r.description}</div>}
          </div>
        ))}</div>}
      </Group>
      <Group title={`MCP servers (${h.mcp.project.length} project · ${h.mcp.global.length} global)`} empty="none">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {h.mcp.project.map(s => <Chip key={'p' + s.name} text={s.name} color={ACCENT} />)}
          {h.mcp.global.map(s => <Chip key={'g' + s.name} text={s.name + ' (global)'} />)}
        </div>
      </Group>
      {h.commands.length > 0 && <Group title={`Commands (${h.commands.length})`}>
        <div style={{ display: 'grid', gap: 3 }}>{h.commands.map(c => <div key={c.name} style={{ font: `400 11px ${MONO}`, color: '#d8cfc7' }}><span style={{ color: ACCENT }}>/{c.name}</span> {c.description && <span style={{ color: '#7a716a' }}>— {c.description}</span>}</div>)}</div>
      </Group>}
      {h.skills.length > 0 && <Group title={`Skills (${h.skills.length})`}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{h.skills.map(s => <Chip key={s} text={s} />)}</div>
      </Group>}
      {h.hooks.length > 0 && <Group title="Hooks"><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{h.hooks.map(x => <Chip key={x} text={x} />)}</div></Group>}
    </div>
  )
}

function ProjectDetail({ project, onBack, onOpenSessions, onOpenSession }) {
  const [a, setA] = useState(null)
  const ws = project.folder || project.workspaceId
  useEffect(() => { setA(null); api.get('/api/cursor/project?workspace=' + encodeURIComponent(ws)).then(setA).catch(() => {}) }, [ws])
  const name = project.folder ? tildify(project.folder).split('/').pop() : '(unknown workspace)'
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={onBack}>← projects</button>
        <button onClick={() => onOpenSessions(project)}>view all sessions →</button>
      </div>
      <div>
        <div style={{ font: `700 18px ${HEAD}`, color: '#e5dbd2' }}>{name}</div>
        <div style={{ font: `400 11px ${MONO}`, color: '#7a716a', overflowWrap: 'anywhere' }}>{project.folder ? tildify(project.folder) : project.workspaceId}</div>
      </div>
      {!a ? <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>analyzing…</div> : a.sessions === 0 ? <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>no sessions</div> : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Stat label="sessions" val={a.sessions} />
            <Stat label="messages" val={fmtNum(a.messages)} />
            <Stat label="avg msgs/session" val={a.avgMessages} />
            <Stat label="active days" val={a.activeDays} />
            <Stat label="lines +/−" val={`${fmtNum(a.linesAdded)}/${fmtNum(a.linesRemoved)}`} />
          </div>
          <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>{isFinite(a.first) && <>first {fmtDate(a.first)} · last {fmtDate(a.last)}</>}</div>
          {a.models.length > 0 && <div style={{ ...PANEL }}>
            <div style={{ font: `600 12px ${HEAD}`, color: '#e5dbd2', marginBottom: 8 }}>Models used</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{a.models.map(m => <Chip key={m.name} text={`${m.name} · ${m.n}`} color={ACCENT} />)}</div>
          </div>}
          <Heatmap heat={a.heat} />
          {a.topSessions?.length > 0 && <div style={PANEL}>
            <div style={{ font: `600 12px ${HEAD}`, color: '#e5dbd2', marginBottom: 8 }}>Biggest sessions (by lines changed)</div>
            {a.topSessions.map(s => (
              <div key={s.id} onClick={() => onOpenSession(s.id)} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 4px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ font: `500 12px "IBM Plex Sans", sans-serif`, color: '#e5dbd2', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name || '(unnamed)'}</span>
                {s.model && <Chip text={s.model} />}
                <span style={{ font: `400 10.5px ${MONO}`, color: ACCENT }}>+{fmtNum(s.linesAdded)}/−{fmtNum(s.linesRemoved)}</span>
                <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{s.messages} msgs</span>
              </div>
            ))}
          </div>}
          <Harness folder={project.folder} />
        </>
      )}
    </div>
  )
}

function Sessions({ workspace, initialOpen }) {
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(initialOpen || null)
  const [q, setQ] = useState('')
  useEffect(() => { api.get('/api/cursor/sessions' + (workspace ? `?workspace=${encodeURIComponent(workspace)}` : '')).then(setList).catch(() => {}) }, [workspace])
  if (open) return <SessionDetail id={open} onBack={() => setOpen(null)} />
  if (!list) return <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>loading…</div>
  const shown = list.filter(s => !q || (s.name || '').toLowerCase().includes(q.toLowerCase()) || (s.folder || '').toLowerCase().includes(q.toLowerCase()))
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="filter by name or folder…" style={{ font: `400 12px ${MONO}`, maxWidth: 340 }} />
      <div style={PANEL}>
        {shown.slice(0, 200).map(s => (
          <div key={s.id} onClick={() => setOpen(s.id)} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 4px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ font: `500 12.5px "IBM Plex Sans", sans-serif`, color: '#e5dbd2', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name || '(unnamed)'}</span>
            <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{s.folder ? tildify(s.folder).split('/').pop() : ''}</span>
            <span style={{ font: `400 10.5px ${MONO}`, color: ACCENT }}>{s.messages} msgs</span>
            <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', width: 130, textAlign: 'right' }}>{s.lastUpdatedAt ? fmtDate(s.lastUpdatedAt) : ''}</span>
          </div>
        ))}
        {shown.length === 0 && <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>no sessions</div>}
      </div>
    </div>
  )
}

function Insights() {
  const [ins, setIns] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { api.get('/api/cursor/insights').then(setIns).catch(e => setErr(e.message)) }, [])
  if (err) return <div style={{ font: `400 12px ${MONO}`, color: '#e5484d' }}>{err}</div>
  if (!ins) return <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>scanning all message blobs… first run over the 2 GB database takes a while; later loads are cached.</div>
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Stat label="user prompts (8–500 chars)" val={ins.userPrompts} />
        <Stat label="duplicate prompt groups" val={ins.dupes.length} />
      </div>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: '#e5dbd2', marginBottom: 8 }}>Repeated prompts — candidates for a reusable command</div>
        {ins.dupes.map((d, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 4px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ font: `700 12px ${MONO}`, color: ACCENT, width: 34 }}>{d.count}×</span>
            <span style={{ font: `400 12px ${MONO}`, color: '#d8cfc7', flex: 1, overflowWrap: 'anywhere' }}>{d.text}</span>
            <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{d.sessions} sessions</span>
          </div>
        ))}
        {ins.dupes.length === 0 && <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>no repeated prompts found</div>}
      </div>
    </div>
  )
}

// ---- Capabilities: skills / rules / commands / agents with edit / create / delete ----
const KIND_TABS = ['skills', 'rules', 'commands', 'agents']
function Capabilities() {
  const [kind, setKind] = useState('skills')
  const [items, setItems] = useState(null)
  const [open, setOpen] = useState(null) // {path, name}
  const [content, setContent] = useState('')
  const [folders, setFolders] = useState([])
  const load = k => api.get('/api/cursor/res/' + k).then(setItems).catch(() => setItems([]))
  useEffect(() => { setItems(null); setOpen(null); load(kind) }, [kind])
  useEffect(() => { api.get('/api/cursor/projects').then(ps => setFolders([...new Set(ps.map(p => p.folder).filter(Boolean))])).catch(() => {}) }, [])
  const openItem = it => api.get('/api/cursor/res-item?path=' + encodeURIComponent(it.path)).then(r => { setOpen(it); setContent(r.content) }).catch(e => toast(e.message, 'error'))
  const save = () => api.put('/api/cursor/res-item', { path: open.path, content }).then(() => { toast('saved (backup taken)', 'success'); load(kind) }).catch(e => toast(e.message, 'error'))
  const del = () => confirm(`Delete ${open.name}? A backup is kept.`) && api.del('/api/cursor/res-item?path=' + encodeURIComponent(open.path)).then(() => { setOpen(null); load(kind); toast('deleted', 'success') }).catch(e => toast(e.message, 'error'))
  const create = () => {
    const name = prompt(`New ${kind.slice(0, -1)} name:`); if (!name) return
    const needsFolder = kind === 'rules' || kind === 'commands'
    const folder = needsFolder ? prompt('Project folder:\n' + folders.map((f, i) => `${i}: ${tildify(f)}`).join('\n') + '\n\nEnter a number (empty = global commands):') : null
    const body = { name, folder: folder !== null && folder !== '' ? folders[Number(folder)] : undefined }
    api.post('/api/cursor/res/' + kind, body).then(r => { load(kind); openItem({ path: r.path, name }) }).catch(e => toast(e.message, 'error'))
  }
  if (open) return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={() => setOpen(null)}>← {kind}</button>
        <span style={{ font: `600 13px ${HEAD}`, color: '#e5dbd2' }}>{open.name}</span>
        <span style={{ font: `400 10px ${MONO}`, color: '#7a716a', overflowWrap: 'anywhere' }}>{tildify(open.path)}</span>
        <button className="primary" style={{ marginLeft: 'auto' }} onClick={save}>Save</button>
        <button className="danger" onClick={del}>Delete</button>
      </div>
      <textarea value={content} onChange={e => setContent(e.target.value)} spellCheck={false}
        style={{ ...PANEL, width: '100%', minHeight: '62vh', font: `400 12.5px ${MONO}`, color: '#e5dbd2', resize: 'vertical' }} />
    </div>
  )
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {KIND_TABS.map(k => <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{k}</button>)}
        <button className="primary" style={{ marginLeft: 'auto' }} onClick={create}>+ New</button>
      </div>
      {!items ? <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>loading…</div> : (
        <div style={PANEL}>
          {items.map(it => (
            <div key={it.path} onClick={() => openItem(it)} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 4px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ font: `500 12.5px ${MONO}`, color: '#e5dbd2' }}>{it.name}</span>
              <Chip text={it.scope} color={it.scope === 'project' ? ACCENT : undefined} />
              {it.alwaysApply && <Chip text="always" color="#e5a03a" />}
              <span style={{ font: `400 11px "IBM Plex Sans", sans-serif`, color: '#7a716a', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.description}</span>
              {it.folder && <span style={{ font: `400 10px ${MONO}`, color: '#5c554f' }}>{tildify(it.folder).split('/').pop()}</span>}
              <span style={{ font: `400 10px ${MONO}`, color: '#5c554f', width: 110, textAlign: 'right' }}>{it.tokensAlways ? `≈${fmtNum(it.tokensAlways)} always` : `≈${fmtNum(it.tokensOnInvoke)} on use`}</span>
            </div>
          ))}
          {items.length === 0 && <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>none found</div>}
        </div>
      )}
    </div>
  )
}

// ---- MCP servers: global + per-project, JSON edit + live JSON-RPC test ----
function Mcp() {
  const [servers, setServers] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [tests, setTests] = useState({})
  const load = () => api.get('/api/cursor/mcp').then(setServers).catch(() => setServers([]))
  useEffect(() => { load() }, [])
  const key = s => s.scope + ':' + s.name
  const save = s => {
    let config; try { config = JSON.parse(drafts[key(s)] ?? JSON.stringify(s.config)) } catch { return toast('invalid JSON', 'error') }
    api.put('/api/cursor/mcp/' + encodeURIComponent(s.name), { scope: s.scope, config }).then(() => { toast('saved (backup taken)', 'success'); load() }).catch(e => toast(e.message, 'error'))
  }
  const test = s => {
    let config; try { config = JSON.parse(drafts[key(s)] ?? JSON.stringify(s.config)) } catch { return toast('invalid JSON', 'error') }
    setTests(t => ({ ...t, [key(s)]: { running: true } }))
    api.post('/api/cursor/mcp/' + encodeURIComponent(s.name) + '/test', { config }).then(r => setTests(t => ({ ...t, [key(s)]: r }))).catch(e => setTests(t => ({ ...t, [key(s)]: { ok: false, error: e.message } })))
  }
  const del = s => confirm(`Remove MCP server "${s.name}" from ${s.scope === 'user' ? 'global config' : tildify(s.scope)}?`) &&
    api.del(`/api/cursor/mcp/${encodeURIComponent(s.name)}?scope=${encodeURIComponent(s.scope)}`).then(load).catch(e => toast(e.message, 'error'))
  const add = () => {
    const name = prompt('Server name:'); if (!name) return
    api.post('/api/cursor/mcp', { name, scope: 'user', config: { command: 'npx', args: [] } }).then(load).catch(e => toast(e.message, 'error'))
  }
  if (!servers) return <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>loading…</div>
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div><button className="primary" onClick={add}>+ Add server (global)</button></div>
      {servers.map(s => {
        const t = tests[key(s)]
        return (
          <div key={key(s)} style={{ ...PANEL, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ font: `600 13px ${HEAD}`, color: '#e5dbd2' }}>{s.name}</span>
              <Chip text={s.scope === 'user' ? 'global' : tildify(s.scope).split('/').pop()} color={s.scope === 'user' ? undefined : ACCENT} />
              {t && <span style={{ font: `400 11px ${MONO}`, color: t.running ? '#7cc4f7' : t.ok ? '#3fb96a' : '#e5484d' }}>
                {t.running ? 'testing…' : t.ok ? `✓ live · ${t.ms}ms${t.serverInfo?.name ? ` · ${t.serverInfo.name}` : ''}` : `✗ ${t.error || 'status ' + t.status}`}</span>}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button onClick={() => test(s)}>Test</button>
                <button onClick={() => save(s)}>Save</button>
                <button className="danger" onClick={() => del(s)}>✕</button>
              </span>
            </div>
            <textarea value={drafts[key(s)] ?? JSON.stringify(s.config, null, 2)} onChange={e => setDrafts(d => ({ ...d, [key(s)]: e.target.value }))} spellCheck={false}
              style={{ width: '100%', minHeight: 90, font: `400 11.5px ${MONO}`, color: '#d8cfc7', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 10, resize: 'vertical' }} />
          </div>
        )
      })}
    </div>
  )
}

// ---- Context: what Cursor pays every session vs on invoke ----
function ContextView() {
  const [ctx, setCtx] = useState(null)
  const [ws, setWs] = useState('')
  const [folders, setFolders] = useState([])
  useEffect(() => { api.get('/api/cursor/projects').then(ps => setFolders([...new Set(ps.map(p => p.folder).filter(Boolean))])).catch(() => {}) }, [])
  useEffect(() => { setCtx(null); api.get('/api/cursor/context' + (ws ? '?workspace=' + encodeURIComponent(ws) : '')).then(setCtx).catch(() => {}) }, [ws])
  const List = ({ title, rows, color }) => (
    <div style={PANEL}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <div style={{ font: `600 13px ${HEAD}`, color }}>{title}</div>
        <div style={{ font: `700 12px ${MONO}`, color: '#e5dbd2', marginLeft: 'auto' }}>≈{fmtNum(rows.reduce((s, x) => s + x.tokens, 0))} tok</div>
      </div>
      {rows.slice(0, 60).map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '4px 2px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
          <Chip text={r.kind} />
          <span style={{ font: `400 12px ${MONO}`, color: '#e5dbd2', flex: 1 }}>{r.name}</span>
          {r.why && <span style={{ font: `400 10px ${MONO}`, color: '#5c554f' }}>{r.why}</span>}
          <span style={{ font: `400 11px ${MONO}`, color }}>≈{fmtNum(r.tokens)}</span>
        </div>
      ))}
    </div>
  )
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <select value={ws} onChange={e => setWs(e.target.value)} style={{ font: `400 12px ${MONO}`, maxWidth: 380 }}>
        <option value="">all projects (global view)</option>
        {folders.map(f => <option key={f} value={f}>{tildify(f)}</option>)}
      </select>
      {!ctx ? <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>computing…</div> : (
        <>
          <List title="Always in context — paid every chat" rows={ctx.always} color="#e5a03a" />
          <List title="On invoke — loaded only when triggered" rows={ctx.onInvoke} color={ACCENT} />
        </>
      )}
    </div>
  )
}

// ---- Quick actions: headless cursor-agent runs with live output ----
const CURSOR_ACTIONS = [
  { label: 'Review changes', prompt: 'Review my uncommitted git changes for correctness bugs. Do not edit any files — report findings with file:line references.' },
  { label: 'Explain repo', prompt: 'Give a concise architectural overview of this repository: entry points, main modules, and how they connect.' },
  { label: 'Find dead code', prompt: 'Find likely-dead or unused code in this repository. Do not edit anything — list candidates with evidence.' },
]
function CursorRuns() {
  const [folders, setFolders] = useState([])
  const [cwd, setCwd] = useState('')
  const [custom, setCustom] = useState('')
  const [runs, setRuns] = useState([])
  const [open, setOpen] = useState(null)
  useEffect(() => { api.get('/api/cursor/projects').then(ps => { const fs = [...new Set(ps.map(p => p.folder).filter(Boolean))]; setFolders(fs); setCwd(c => c || fs[0] || '') }).catch(() => {}) }, [])
  useEffect(() => {
    const load = () => api.get('/api/actions').then(rs => setRuns(rs.filter(r => r.runner === 'cursor'))).catch(() => {})
    load(); const t = setInterval(load, 5000); return () => clearInterval(t)
  }, [])
  const launch = async promptText => {
    if (!cwd) return toast('pick a project first', 'error')
    try {
      const { id } = await api.post('/api/actions/run', { runner: 'cursor', cmd: promptText, cwd })
      const run = { id, cmd: promptText, cwd, alive: true, startedAt: Date.now() }
      setRuns(rs => [run, ...rs]); setOpen(run)
    } catch (e) { toast(e.message, 'error') }
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>
        runs `cursor-agent -p` headless in the chosen project — needs a one-time <span style={{ color: ACCENT }}>cursor-agent login</span> in your terminal
      </div>
      <div style={{ ...PANEL, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>run in</span>
        <select value={cwd} onChange={e => setCwd(e.target.value)} style={{ font: `400 12px ${MONO}`, maxWidth: 340 }}>
          {folders.map(f => <option key={f} value={f}>{tildify(f)}</option>)}
        </select>
        {CURSOR_ACTIONS.map(a => <button key={a.label} title={a.prompt} onClick={() => launch(a.prompt)}>{a.label}</button>)}
        <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="any prompt…"
          onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) { launch(custom.trim()); setCustom('') } }}
          style={{ font: `400 12px ${MONO}`, minWidth: 180, flex: 1 }} />
      </div>
      {open && <RunWindow run={open} onClose={() => setOpen(null)} />}
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: '#e5dbd2', marginBottom: 8 }}>Runs</div>
        {runs.length === 0 && <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>no cursor-agent runs yet</div>}
        {runs.map(r => (
          <div key={r.id} onClick={() => setOpen(r)} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 4px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ font: `400 11px ${MONO}`, color: r.alive ? '#5eb3f6' : r.exitCode === 0 ? '#3fb96a' : '#e5484d' }}>{r.alive ? '●' : r.exitCode === 0 ? '✓' : '✗'}</span>
            <span style={{ font: `400 12px "IBM Plex Sans", sans-serif`, color: '#e5dbd2', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.cmd}</span>
            <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{tildify(r.cwd).split('/').pop()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: '◧', title: 'Your Cursor usage, at a glance' },
  { id: 'projects', label: 'Projects', icon: '⊞', title: 'Workspaces' },
  { id: 'sessions', label: 'Sessions', icon: '⌨', title: 'Chat sessions' },
  { id: 'capabilities', label: 'Capabilities', icon: '✎', title: 'Skills, rules, commands & agents' },
  { id: 'mcp', label: 'MCP', icon: '⋈', title: 'MCP servers' },
  { id: 'context', label: 'Context', icon: '◔', title: 'Loaded context — always vs on invoke' },
  { id: 'runs', label: 'Quick Actions', icon: '▶', title: 'Headless cursor-agent runs' },
  { id: 'constitution', label: 'Constitution', icon: '⚖', title: 'Constitution — verified repo knowledge base' },
  { id: 'insights', label: 'Insights', icon: '✦', title: 'Prompt insights' },
]

export default function CursorDashboard({ onSwitch }) {
  const [section, setSection] = useState('overview')
  const [workspace, setWorkspace] = useState(null) // set when drilling in from Projects
  const [project, setProject] = useState(null) // open project detail (analysis + harness)
  const [deepSession, setDeepSession] = useState(null) // open a specific session in Sessions
  const cur = SECTIONS.find(s => s.id === section)
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand"><div className="brand-mark" style={{ background: ACCENT, color: '#0d0b0a' }}>▮</div><div className="brand-name">Cursor</div></div>
        {SECTIONS.map(s => (
          <button key={s.id} className={section === s.id ? 'active' : ''} onClick={() => { setSection(s.id); setProject(null); setDeepSession(null); if (s.id !== 'sessions') setWorkspace(null) }}>
            <span className="nav-icon">{s.icon}</span> {s.label}
          </button>
        ))}
        <div style={{ marginTop: 'auto', padding: 12 }}>
          <button onClick={onSwitch} style={{ width: '100%' }} title="switch to the Claude Code dashboard">⇄ Claude dashboard</button>
        </div>
      </nav>
      <main className="content">
        <header className="topbar">
          <div>
            <div className="kicker" style={{ color: ACCENT }}>Cursor</div>
            <h1>{cur.title}</h1>
          </div>
          <div className="topbar-right">
            <button className="top-chip" onClick={onSwitch} style={{ cursor: 'pointer' }}>⇄ Claude</button>
            <div className="avatar" style={{ background: ACCENT, color: '#0d0b0a' }}>Cu</div>
          </div>
        </header>
        {section === 'overview' && <Overview />}
        {section === 'projects' && (project
          ? <ProjectDetail project={project}
              onBack={() => setProject(null)}
              onOpenSessions={p => { setWorkspace(p.workspaceId || p.folder); setDeepSession(null); setProject(null); setSection('sessions') }}
              onOpenSession={id => { setWorkspace(project.workspaceId || project.folder); setDeepSession(id); setProject(null); setSection('sessions') }} />
          : <Projects onOpen={setProject} />)}
        {section === 'sessions' && <Sessions key={deepSession || workspace || 'all'} workspace={workspace} initialOpen={deepSession} />}
        {section === 'capabilities' && <Capabilities />}
        {section === 'mcp' && <Mcp />}
        {section === 'context' && <ContextView />}
        {section === 'runs' && <CursorRuns />}
        {section === 'constitution' && <ConstitutionSection accent={ACCENT} />}
        {section === 'insights' && <Insights />}
      </main>
    </div>
  )
}
