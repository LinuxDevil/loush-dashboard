import React, { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { api } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import { Tabs } from '../ui/tabs.jsx'

const MONO = "var(--mono)"
const HEAD = "var(--head)"
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 12 }
const EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SubagentStop', 'SessionStart', 'SessionEnd', 'PreCompact', 'Notification']

export default function HooksSection() {
  const [tab, setTab] = useState('Hooks')
  return (
    <div className="hx" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Tabs tabs={['Hooks', 'Dry-run', 'Health', 'Library']} tab={tab} setTab={setTab} />
      {tab === 'Hooks' && <Editor />}
      {tab === 'Dry-run' && <DryRun />}
      {tab === 'Health' && <Health />}
      {tab === 'Library' && <Library />}
    </div>
  )
}

// matcher tester: same semantics Claude Code uses — empty = all, else anchored regex
function MatcherTest() {
  const [matcher, setMatcher] = useState('Edit|Write')
  const [tool, setTool] = useState('Edit')
  const [r, setR] = useState(null)
  useEffect(() => {
    const t = setTimeout(() => api.post('/api/hooks/test', { matcher, tool }).then(setR).catch(() => {}), 200)
    return () => clearTimeout(t)
  }, [matcher, tool])
  return (
    <div style={{ ...PANEL, padding: '14px 16px' }}>
      <div style={{ font: `600 13px ${HEAD}`, marginBottom: 10 }}>Matcher tester</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={matcher} onChange={e => setMatcher(e.target.value)} placeholder="matcher pattern (regex, empty = all)" style={{ flex: 1 }} />
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>vs tool</span>
        <input value={tool} onChange={e => setTool(e.target.value)} placeholder="Bash" style={{ width: 200 }} />
        {r && <span style={{ font: `600 12px ${MONO}`, color: r.fires ? 'var(--green)' : 'var(--red)', width: 90 }}>{r.fires ? '✓ fires' : '✗ no match'}</span>}
      </div>
      {r?.note && <div style={{ font: `400 11px ${MONO}`, color: 'var(--amber)', marginTop: 6 }}>{r.note}</div>}
    </div>
  )
}

function Editor() {
  const [data, setData] = useState(null)
  const [scope, setScope] = useState('user')
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const load = () => api.get('/api/hooks').then(d => { setData(d); setText(JSON.stringify(d[scope]?.settings?.hooks ?? {}, null, 2)) })
  useEffect(() => { load() }, [])
  useEffect(() => { if (data) setText(JSON.stringify(data[scope]?.settings?.hooks ?? {}, null, 2)) }, [scope])

  if (!data) return <Skeleton tiles={0} rows={7} />
  const flash = m => { setStatus(m); setTimeout(() => setStatus(''), 4000) }
  const save = () => {
    let hooks
    try { hooks = JSON.parse(text) } catch (e) { return flash('invalid JSON: ' + e.message) }
    api.put('/api/hooks', { scope, hooks }).then(() => { flash('saved (backup made)'); load() }).catch(e => flash('error: ' + e.message))
  }
  const hooks = data?.[scope]?.settings?.hooks || {}
  const summary = Object.entries(hooks).flatMap(([event, groups]) =>
    (groups || []).flatMap((g, gi) => (g.hooks || []).map((h, hi) => ({ event, matcher: g.matcher, type: h.type || 'command', command: h.command || h.prompt || '', timeout: h.timeout, key: `${event}-${gi}-${hi}` })))
  )
  const removeHook = k => {
    const [ev, gi, hi] = k.split('-')
    const next = JSON.parse(JSON.stringify(hooks))
    next[ev][gi].hooks.splice(Number(hi), 1)
    if (!next[ev][gi].hooks.length) next[ev].splice(Number(gi), 1)
    if (!next[ev].length) delete next[ev]
    setText(JSON.stringify(next, null, 2))
  }
  const addHook = () => {
    const ev = prompt('Event (' + EVENTS.join(', ') + '):', 'PreToolUse')
    if (!ev || !EVENTS.includes(ev)) return
    const matcher = prompt('Matcher (regex, empty = all tools):', 'Bash') ?? ''
    const command = prompt('Shell command (JSON tool-call arrives on stdin; exit 2 = block):', '')
    if (!command) return
    const next = JSON.parse(text || '{}')
    next[ev] ||= []
    next[ev].push({ matcher, hooks: [{ type: 'command', command, timeout: 10 }] })
    setText(JSON.stringify(next, null, 2))
  }
  return (
    <>
      <MatcherTest />
      <div className="section">
        <div className="list-pane">
          <div className="list-head">
            <h2>Hooks <span className="muted">({summary.length})</span></h2>
            <button className="mini" onClick={addHook}>+ add</button>
          </div>
          <div className="chips" style={{ marginBottom: 8 }}>
            {['user', 'project', 'local'].map(s => (
              <button key={s} className={'mini' + (scope === s ? ' active' : '')} onClick={() => setScope(s)}>
                {s}{data && data[s]?.settings === null ? ' (missing)' : ''}
              </button>
            ))}
          </div>
          <div className="rows">
            {summary.length === 0 && <p className="muted">no hooks in this scope</p>}
            {summary.map(h => (
              <div key={h.key} className="row">
                <div className="row-title">{h.event}{h.matcher ? <span className="badge project">{h.matcher}</span> : <span className="badge user">all tools</span>}<span className="badge">{h.type}</span></div>
                <div className="row-desc mono">{h.command}</div>
                <div className="row-meta">
                  {h.timeout ? `timeout: ${h.timeout}s · ` : ''}
                  <span style={{ cursor: 'pointer', color: 'var(--red)' }} onClick={() => removeHook(h.key)}>remove</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="detail-pane">
          <div className="detail-head">
            <code className="path">{data?.[scope]?.path} → "hooks"</code>
            <div className="actions"><button onClick={save}>Save</button></div>
          </div>
          {status && <div className="status">{status}</div>}
          <CodeMirror value={text} height="100%" theme="dark" extensions={[json()]} onChange={setText} className="editor" />
        </div>
      </div>
    </>
  )
}

function DryRun() {
  const [data, setData] = useState(null)
  const [pick, setPick] = useState('')
  const [command, setCommand] = useState('')
  const [event, setEvent] = useState('PreToolUse')
  const [toolName, setToolName] = useState('Edit')
  const [toolInput, setToolInput] = useState('{"file_path": "/app/.env", "content": "SECRET=1"}')
  const [r, setR] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get('/api/hooks').then(setData).catch(() => {}) }, [])
  const all = data ? ['user', 'project', 'local'].flatMap(s => Object.entries(data[s]?.settings?.hooks || {}).flatMap(([ev, gs]) => (gs || []).flatMap(g => (g.hooks || []).map(h => ({ label: `${s} · ${ev}${g.matcher ? ' · ' + g.matcher : ''}`, event: ev, command: h.command }))))) : []
  const run = async () => {
    let input
    try { input = JSON.parse(toolInput) } catch (e) { return alert('tool input is not valid JSON: ' + e.message) }
    setBusy(true); setR(null)
    try { setR(await api.post('/api/hooks/dryrun', { command, event, toolName, toolInput: input })) }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="hx-2a">
      <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ font: `600 14px ${HEAD}` }}>Dry-run a hook</div>
        <select value={pick} onChange={e => { setPick(e.target.value); const h = all[Number(e.target.value)]; if (h) { setCommand(h.command); setEvent(h.event) } }} style={{ width: '100%' }}>
          <option value="">— pick an existing hook, or type a command —</option>
          {all.map((h, i) => <option key={i} value={i}>{h.label} — {h.command.slice(0, 60)}</option>)}
        </select>
        <textarea rows={3} value={command} onChange={e => setCommand(e.target.value)} placeholder="hook command — receives the tool call as JSON on stdin" />
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={event} onChange={e => setEvent(e.target.value)}>{EVENTS.map(ev => <option key={ev}>{ev}</option>)}</select>
          <input value={toolName} onChange={e => setToolName(e.target.value)} placeholder="tool name" style={{ width: 160 }} />
        </div>
        <textarea rows={3} value={toolInput} onChange={e => setToolInput(e.target.value)} placeholder='sample tool input (JSON)' />
        <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={run} disabled={busy || !command}>{busy ? 'running…' : '▸ Dry-run'}</button>
        <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>runs the real command with your sample payload on stdin — nothing is written to config · exit 2 = block, JSON {'{"decision":…}'} honoured</div>
      </div>
      <div style={{ ...PANEL }}>
        <div style={{ font: `600 14px ${HEAD}`, marginBottom: 12 }}>Result</div>
        {r ? <>
          <div style={{ font: `600 16px ${HEAD}`, color: /BLOCK/.test(r.decision) ? 'var(--red)' : r.decision === 'allow' ? 'var(--green)' : 'var(--amber)' }}>{r.decision}</div>
          <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', margin: '6px 0 10px' }}>exit {r.exit ?? '—'} · {r.ms != null ? r.ms + 'ms latency added per matching tool call' : ''}</div>
          {r.stdout && <pre style={{ font: `400 11px/1.5 ${MONO}`, color: 'var(--text-secondary)', background: 'var(--bg-inset)', borderRadius: 8, padding: 10, whiteSpace: 'pre-wrap' }}>{r.stdout}</pre>}
          {r.stderr && <pre style={{ font: `400 11px/1.5 ${MONO}`, color: 'var(--red)', background: 'var(--red-bg)', borderRadius: 8, padding: 10, whiteSpace: 'pre-wrap' }}>{r.stderr}</pre>}
        </> : <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>run a hook against a sample tool call to see whether it would fire, allow, or block — and what latency it adds</div>}
      </div>
    </div>
  )
}

function Health() {
  const [h, setH] = useState(null)
  useEffect(() => { api.get('/api/hooks/health').then(setH).catch(() => {}) }, [])
  if (!h) return <Skeleton tiles={3} rows={5} />
  const rows = Object.entries(h.byEvent).sort((a, b) => b[1] - a[1])
  const max = Math.max(...rows.map(r => r[1]), 1)
  return (
    <div className="hx-2a">
      <div style={{ ...PANEL }}>
        <div style={{ font: `600 14px ${HEAD}`, marginBottom: 12 }}>Firings by event <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>all transcripts</span></div>
        {rows.map(([ev, n]) => (
          <div key={ev} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
            <span style={{ width: 150, font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>{ev}</span>
            <div style={{ flex: 1, height: 9, borderRadius: 5, background: 'var(--bg-surface-hover)', overflow: 'hidden' }}>
              <div style={{ width: `${(n / max) * 100}%`, height: '100%', background: 'linear-gradient(90deg,var(--accent-light),var(--accent))', borderRadius: 5 }} />
            </div>
            <span style={{ width: 70, textAlign: 'right', font: `500 11px ${MONO}`, color: 'var(--text-secondary)' }}>{n.toLocaleString()}</span>
          </div>
        ))}
        {rows.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no hook firings found in transcripts</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="hx-2" style={{ gap: 14 }}>
          {[['Total firings', h.total, 'var(--accent)'], ['Blocks observed', h.blocks, 'var(--red)'], ['Sessions scanned', h.sessions, 'var(--blue)']].map(([l, v, c]) => (
            <div key={l} style={{ ...PANEL, padding: '15px 17px' }}>
              <div style={{ font: `600 11px ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{l}</div>
              <div style={{ font: `600 20px ${HEAD}`, color: c, marginTop: 6 }}>{Number(v).toLocaleString()}</div>
            </div>
          ))}
        </div>
        <div style={{ ...PANEL, font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', lineHeight: 1.7 }}>{h.note} — agent-type hooks spawn subagents and add real time per call; dry-run one to measure it.</div>
      </div>
    </div>
  )
}

function Library() {
  const [lib, setLib] = useState([])
  const [scopes, setScopes] = useState([])
  const [scope, setScope] = useState('global')
  useEffect(() => {
    api.get('/api/hooks/library').then(setLib).catch(() => {})
    api.get('/api/harness').then(d => setScopes(d.scopes)).catch(() => {})
  }, [])
  const install = async name => {
    const r = await api.post('/api/hooks/install', { name, scope }).catch(e => alert(e.message))
    if (r?.already) alert('already installed in this scope')
    else if (r?.proposed) alert('global change proposed — approve it in Governance → Approvals')
    else if (r?.ok) alert('installed — active from the next Claude Code session')
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>install into</span>
        <select value={scope} onChange={e => setScope(e.target.value)}>{scopes.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 14 }}>
        {lib.map(p => (
          <div key={p.name} style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ font: `600 14px ${HEAD}` }}>{p.name}</span>
              <span className="badge project">{p.event}</span>
              {p.matcher && <span className="badge user">{p.matcher}</span>}
            </div>
            <div style={{ font: "400 12px var(--body)", color: 'var(--text-secondary)', flex: 1 }}>{p.description}</div>
            <pre style={{ margin: 0, font: `400 10px/1.5 ${MONO}`, color: 'var(--text-tertiary)', background: 'var(--bg-inset)', borderRadius: 8, padding: 8, maxHeight: 90, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{p.command}</pre>
            <button className="primary" style={{ alignSelf: 'flex-start', fontSize: 12 }} onClick={() => install(p.name)}>Install</button>
          </div>
        ))}
      </div>
    </div>
  )
}
