import React, { useEffect, useRef, useState } from 'react'
import { api, toast, tildify } from '../lib/api.js'
import { buildBlocks, Block } from './ChatSection.jsx'

const MONO = "var(--mono)"
const HEAD = "var(--head)"
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 12 }

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
      <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{label} </span>
      {items.map(x => <span key={x} style={{ font: `400 11px ${MONO}`, color: 'var(--text-primary)', background: 'var(--bg-surface-hover)', borderRadius: 6, padding: '1px 7px', marginRight: 5 }}>{x}</span>)}
    </div>
  ) : null
  const tools = Object.entries(a.tools || {}).sort((x, y) => y[1] - x[1])
  return (
    <div style={{ ...PANEL, padding: '12px 16px', marginBottom: 10 }}>
      <div style={{ font: `600 12px ${HEAD}`, color: 'var(--accent)', marginBottom: 4 }}>Run analysis</div>
      <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-primary)' }}>
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
        <span style={{ font: `600 14px ${HEAD}`, color: 'var(--text-primary)' }}>{r.cmd}{r.args ? ` ${r.args}` : ''}</span>
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{tildify(r.cwd)}</span>
        <span style={{ font: `400 11px ${MONO}`, color: r.alive ? 'var(--blue)' : r.exitCode === 0 ? 'var(--green)' : 'var(--red)' }}>
          {r.alive ? '● running' : r.exitCode === 0 ? '✓ done' : `✗ exit ${r.exitCode}`}
        </span>
        <button style={{ marginLeft: 'auto' }} onClick={onClose}>✕</button>
      </div>
      <Analysis a={r.analysis} />
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {events.length === 0 && <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>waiting for output…</div>}
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
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>run in</span>
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
        <div style={{ font: `600 13px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 8 }}>Runs</div>
        {runs.length === 0 && <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>no action runs yet — pick a project and hit a button</div>}
        {runs.map(r => (
          <div key={r.id} onClick={() => setOpen(r)} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 4px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{ font: `400 11px ${MONO}`, color: r.alive ? 'var(--blue)' : r.exitCode === 0 ? 'var(--green)' : 'var(--red)' }}>{r.alive ? '●' : r.exitCode === 0 ? '✓' : '✗'}</span>
            <span style={{ font: `500 13px ${MONO}`, color: 'var(--text-primary)' }}>{r.cmd}</span>
            <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{tildify(r.cwd)}</span>
            <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
              {r.analysis?.cost != null && `$${r.analysis.cost.toFixed(3)} · `}
              {r.endedAt ? fmtDur(r.endedAt - r.startedAt) : 'running'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
