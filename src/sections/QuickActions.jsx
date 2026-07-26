import React, { useEffect, useRef, useState } from 'react'
import { api, toast, tildify } from '../lib/api.js'
import { buildBlocks, Block } from './ChatSection.jsx'

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }

// each button is just a slash command + the project context — the run primitive does the rest
const ACTIONS = [
  { cmd: '/code-review', label: 'Review branch', hint: 'review the current diff for correctness bugs' },
  { cmd: '/security-review', label: 'Security review', hint: 'same diff, security lens' },
  { cmd: '/simplify', label: 'Simplify', hint: 'reuse / simplification / efficiency cleanups, applied' },
  { cmd: '/init', label: 'Init CLAUDE.md', hint: 'bootstrap codebase docs for the project' },
]

const fmtDur = ms => (ms >= 60000 ? `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`)

function Analysis({ a }) {
  if (!a) return null
  const chip = (label, items) => items?.length ? (
    <div style={{ marginTop: 6 }}>
      <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{label} </span>
      {items.map(x => <span key={x} style={{ font: `400 11px ${MONO}`, color: '#e5dbd2', background: 'rgba(255,255,255,0.06)', borderRadius: 6, padding: '1px 7px', marginRight: 5 }}>{x}</span>)}
    </div>
  ) : null
  const tools = Object.entries(a.tools || {}).sort((x, y) => y[1] - x[1])
  return (
    <div style={{ ...PANEL, padding: '12px 16px', marginBottom: 10 }}>
      <div style={{ font: `600 12px ${HEAD}`, color: '#d97757', marginBottom: 4 }}>Run analysis</div>
      <div style={{ font: `400 11.5px ${MONO}`, color: '#e5dbd2' }}>
        {a.durationMs != null && <span>⏱ {fmtDur(a.durationMs)} · </span>}
        {a.cost != null && <span>${a.cost.toFixed(3)} · </span>}
        {a.turns != null && <span>{a.turns} turns · </span>}
        {tools.reduce((s, [, n]) => s + n, 0)} tool calls
      </div>
      {tools.length > 0 && chip('tools', tools.map(([n, c]) => `${n}×${c}`))}
      {chip('skills', a.skills)}
      {chip('agents', a.agents)}
      {chip('mcp', a.mcp)}
      {chip('files touched', (a.files || []).map(tildify))}
    </div>
  )
}

// live output window: subscribes to the run's SSE stream, renders the same blocks as Chat.
// exported — the Cursor dashboard reuses it for cursor-agent runs.
export function RunWindow({ run, onClose }) {
  const [events, setEvents] = useState([])
  const [live, setLive] = useState(null) // refreshed run row (analysis arrives on exit)
  const endRef = useRef(null)
  useEffect(() => {
    setEvents([])
    const es = new EventSource(`/api/chat/${run.id}/events`)
    es.onmessage = e => { try { const ev = JSON.parse(e.data); setEvents(p => [...p, ev]); if (ev.type === 'closed') api.get('/api/actions').then(rs => setLive(rs.find(r => r.id === run.id))).catch(() => {}) } catch {} }
    es.onerror = () => es.close()
    return () => es.close()
  }, [run.id])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [events.length])
  const r = live || run
  return (
    <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', minHeight: 300, maxHeight: '72vh' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ font: `600 14px ${HEAD}`, color: '#e5dbd2' }}>{r.cmd}{r.args ? ` ${r.args}` : ''}</span>
        <span style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>{tildify(r.cwd)}</span>
        <span style={{ font: `400 11px ${MONO}`, color: r.alive ? '#5eb3f6' : r.exitCode === 0 ? '#3fb96a' : '#e5484d' }}>
          {r.alive ? '● running' : r.exitCode === 0 ? '✓ done' : `✗ exit ${r.exitCode}`}
        </span>
        <button style={{ marginLeft: 'auto' }} onClick={onClose}>✕</button>
      </div>
      <Analysis a={r.analysis} />
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {events.length === 0 && <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>waiting for output…</div>}
        {buildBlocks(events).map((b, i) => <Block key={i} b={b} />)}
        <div ref={endRef} />
      </div>
    </div>
  )
}

export default function QuickActions() {
  const [projects, setProjects] = useState([])
  const [cwd, setCwd] = useState('')
  const [custom, setCustom] = useState('')
  const [runs, setRuns] = useState([])
  const [open, setOpen] = useState(null) // run to show in the output window
  useEffect(() => { api.get('/api/projects').then(ps => { const ex = ps.filter(p => p.exists !== false); setProjects(ex); setCwd(c => c || ex[0]?.path || '') }).catch(() => {}) }, [])
  useEffect(() => {
    const load = () => api.get('/api/actions').then(setRuns).catch(() => {})
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])
  const launch = async cmdLine => {
    if (!cwd) return toast('pick a project first', 'error')
    const [cmd, ...rest] = cmdLine.trim().split(/\s+/)
    try {
      const { id } = await api.post('/api/actions/run', { cmd, cwd, args: rest.join(' ') })
      toast(`${cmd} started in ${tildify(cwd)}`, 'success')
      const run = { id, cmd, args: rest.join(' '), cwd, alive: true, startedAt: Date.now() }
      setRuns(rs => [run, ...rs])
      setOpen(run)
    } catch (e) { toast(e.message, 'error') }
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ ...PANEL, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>run in</span>
        <select value={cwd} onChange={e => setCwd(e.target.value)} style={{ font: `400 12px ${MONO}`, maxWidth: 340 }}>
          {projects.map(p => <option key={p.path} value={p.path}>{tildify(p.path)}</option>)}
        </select>
        {ACTIONS.map(a => (
          <button key={a.cmd} title={`${a.cmd} — ${a.hint}`} onClick={() => launch(a.cmd)}>{a.label}</button>
        ))}
        <input
          value={custom} onChange={e => setCustom(e.target.value)} placeholder="/any-command args…"
          onKeyDown={e => { if (e.key === 'Enter' && custom.startsWith('/')) { launch(custom); setCustom('') } }}
          style={{ font: `400 12px ${MONO}`, minWidth: 180, flex: 1 }}
        />
      </div>
      {open && <RunWindow run={open} onClose={() => setOpen(null)} />}
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: '#e5dbd2', marginBottom: 8 }}>Runs</div>
        {runs.length === 0 && <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>no action runs yet — pick a project and hit a button</div>}
        {runs.map(r => (
          <div key={r.id} onClick={() => setOpen(r)} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 4px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ font: `400 11px ${MONO}`, color: r.alive ? '#5eb3f6' : r.exitCode === 0 ? '#3fb96a' : '#e5484d' }}>{r.alive ? '●' : r.exitCode === 0 ? '✓' : '✗'}</span>
            <span style={{ font: `500 12.5px ${MONO}`, color: '#e5dbd2' }}>{r.cmd}</span>
            <span style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>{tildify(r.cwd)}</span>
            <span style={{ font: `400 11px ${MONO}`, color: '#7a716a', marginLeft: 'auto' }}>
              {r.analysis?.cost != null && `$${r.analysis.cost.toFixed(3)} · `}
              {r.endedAt ? fmtDur(r.endedAt - r.startedAt) : 'running'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
