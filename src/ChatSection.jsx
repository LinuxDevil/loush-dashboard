import React, { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { api, fmtDate } from './api.js'

const short = (v, n = 200) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > n ? s.slice(0, n) + '…' : s
}

// fold raw stream-json events into renderable blocks; events with parent_tool_use_id
// nest under the Task tool_use that spawned them (that's the subagent's output)
export function buildBlocks(events) {
  const blocks = [], byToolId = {}
  const target = ev => (ev.parent_tool_use_id && byToolId[ev.parent_tool_use_id]?.children) || blocks
  for (const ev of events) {
    if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
      for (const c of ev.message.content)
        if (c.type === 'tool_result' && byToolId[c.tool_use_id]) byToolId[c.tool_use_id].result = short(c.content, 400)
        else if (c.type === 'text') target(ev).push({ kind: 'user', text: c.text })
    } else if (ev.type === 'user') {
      target(ev).push({ kind: 'user', text: String(ev.message?.content ?? '') })
    } else if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
      for (const c of ev.message.content) {
        if (c.type === 'text' && c.text.trim()) target(ev).push({ kind: 'text', text: c.text })
        else if (c.type === 'tool_use') {
          const b = { kind: 'tool', id: c.id, name: c.name, input: c.input, children: c.name === 'Task' || c.name === 'Agent' ? [] : null }
          byToolId[c.id] = b
          target(ev).push(b)
        }
      }
    } else if (ev.type === 'result') {
      blocks.push({ kind: 'turn-end', ms: ev.duration_ms, cost: ev.total_cost_usd })
    } else if (ev.type === 'stderr') {
      blocks.push({ kind: 'stderr', text: ev.text })
    } else if (ev.type === 'closed') {
      blocks.push({ kind: 'closed', code: ev.code, error: ev.error })
    }
  }
  return blocks
}

export function Block({ b }) {
  if (b.kind === 'user') return <div className="chat-msg user">{b.text}</div>
  if (b.kind === 'text') return <div className="chat-msg assistant" dangerouslySetInnerHTML={{ __html: marked.parse(b.text) }} />
  if (b.kind === 'stderr') return <div className="chat-line err">{b.text}</div>
  if (b.kind === 'closed') return <div className="chat-line err">session ended{b.error ? ` — ${b.error}` : b.code ? ` (exit ${b.code})` : ''}</div>
  if (b.kind === 'turn-end') return <div className="chat-line dim">◦ turn done {b.ms ? `· ${(b.ms / 1000).toFixed(1)}s` : ''} {b.cost ? `· $${b.cost.toFixed(3)}` : ''}</div>
  if (b.kind === 'tool' && b.children) {
    const agent = b.input?.subagent_type || 'agent'
    return (
      <details className="chat-agent">
        <summary>◆ {agent} — {b.input?.description || b.input?.prompt?.slice(0, 80) || 'subagent'} <span className="dim">({b.children.length} events)</span></summary>
        <div className="chat-agent-body">
          {b.children.map((c, i) => <Block key={i} b={c} />)}
          {b.result && <div className="chat-line dim">↳ {b.result}</div>}
        </div>
      </details>
    )
  }
  if (b.kind === 'tool')
    return (
      <div className="chat-line tool" title={JSON.stringify(b.input, null, 2)}>
        ▸ <b>{b.name}</b> <span className="dim">{short(b.input?.command || b.input?.file_path || b.input?.pattern || b.input?.prompt || b.input, 120)}</span>
        {b.result != null && <div className="chat-tool-result">{b.result}</div>}
      </div>
    )
  return null
}

// feature 20: promote any message to a reusable artifact in one click
function capture(text) {
  const kind = prompt('Capture as: command / skill / prompt / note', 'command')
  if (!kind) return
  const done = p => p.then(r => alert('saved' + (r.path ? ' → ' + r.path : ''))).catch(e => alert(e.message))
  if (kind === 'command' || kind === 'skill') {
    const name = prompt(`${kind} name:`)
    if (!name) return
    const content = kind === 'command'
      ? `---\ndescription: captured from a chat session\n---\n\n${text}\n\n$ARGUMENTS\n`
      : `---\nname: ${name}\ndescription: captured from a chat session\n---\n\n${text}\n`
    done(api.post(`/api/res/${kind}s`, { scope: 'user', name, content }))
  } else if (kind === 'prompt') {
    done(api.post('/api/prompts', { title: text.slice(0, 60), tags: ['captured'], inputs: [{ type: 'text', value: text }] }))
  } else {
    done(api.post('/api/notes', { title: text.slice(0, 40), content: text }))
  }
}

const Cap = ({ text, children }) => (
  <div className="cap-wrap">
    {children}
    <button className="cap-btn" title="capture as command / skill / prompt / note" onClick={() => capture(text)}>⤴</button>
  </div>
)

export default function ChatSection() {
  const [projects, setProjects] = useState([])
  const [cwd, setCwd] = useState('')
  const [sessions, setSessions] = useState([])
  const [active, setActive] = useState([]) // live server-side chats
  const [pins, setPins] = useState([])
  const [chatId, setChatId] = useState(null)
  const [events, setEvents] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const esRef = useRef(null)
  const endRef = useRef(null)

  const loadPins = () => api.get('/api/pins').then(setPins).catch(() => {})
  useEffect(() => {
    api.get('/api/projects').then(ps => { const ex = ps.filter(p => p.exists); setProjects(ex); if (ex[0]) setCwd(ex[0].path) })
    api.get('/api/chat').then(setActive).catch(() => {})
    loadPins()
    const pre = sessionStorage.getItem('ctx-bundle-prompt') // feature 22 hand-off
    if (pre) { setInput(pre); sessionStorage.removeItem('ctx-bundle-prompt') }
  }, [])
  const togglePin = (s, pinned) => {
    const label = pinned ? (prompt('Label (optional):', '') ?? '') : ''
    api.put('/api/pins', { sessionId: s.sessionId, cwd: s.cwd || cwd, title: s.title || '', label, pinned }).then(loadPins).catch(e => alert(e.message))
  }
  useEffect(() => { if (cwd) api.get('/api/chat/sessions?cwd=' + encodeURIComponent(cwd)).then(setSessions) }, [cwd])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [events])

  const attach = (id, chatCwd) => {
    esRef.current?.close()
    if (chatCwd) setCwd(chatCwd)
    setEvents([]); setChatId(id)
    const es = new EventSource(`/api/chat/${id}/events`)
    es.onmessage = m => {
      const ev = JSON.parse(m.data)
      setEvents(prev => [...prev, ev])
      if (ev.type === 'result' || ev.type === 'closed') setBusy(false)
    }
    esRef.current = es
  }
  useEffect(() => () => esRef.current?.close(), [])

  const start = async resume => {
    const { id } = await api.post('/api/chat', { cwd, resume })
    attach(id)
    api.get('/api/chat').then(setActive).catch(() => {})
  }
  const send = async () => {
    const text = input.trim()
    if (!text || !chatId) return
    setInput(''); setBusy(true)
    await api.post(`/api/chat/${chatId}/message`, { text }).catch(e => { setBusy(false); alert(e.message) })
  }
  const detach = () => {
    esRef.current?.close()
    setChatId(null); setEvents([]); setBusy(false)
    api.get('/api/chat').then(setActive).catch(() => {})
  }
  const stop = async () => {
    if (chatId) await api.del('/api/chat/' + chatId)
    detach()
  }

  const blocks = buildBlocks(events)
  const ended = blocks.some(b => b.kind === 'closed')

  if (!chatId)
    return (
      <div className="chat-launcher">
        <div className="chat-row">
          <select value={cwd} onChange={e => setCwd(e.target.value)}>
            {projects.map(p => <option key={p.path} value={p.path}>{p.name} — {p.path}</option>)}
          </select>
          <button className="primary" onClick={() => start()}>New session</button>
        </div>
        {active.filter(a => a.alive).length > 0 && (
          <div className="chat-sessions">
            <h3>Live now</h3>
            {active.filter(a => a.alive).map(a => (
              <div key={a.id} className="chat-session" onClick={() => attach(a.id, a.cwd)}>
                <b>{a.cwd.split('/').pop()}</b> <span className="dim">{a.events} events · {a.cwd}</span>
              </div>
            ))}
          </div>
        )}
        {pins.length > 0 && (
          <div className="chat-sessions">
            <h3>Pinned</h3>
            {pins.map(p => (
              <div key={p.sessionId} className="chat-session" onClick={() => { if (p.cwd) setCwd(p.cwd); api.post('/api/chat', { cwd: p.cwd || cwd, resume: p.sessionId }).then(({ id }) => attach(id, p.cwd)) }}>
                <b>★ {p.label || p.title || p.sessionId}</b>
                <span className="dim">
                  {(p.cwd || '').split('/').pop()}{p.configVersion ? ` · cfg ${p.configVersion}` : ''}
                  <button className="mini" style={{ marginLeft: 8, marginTop: 0 }} onClick={e => { e.stopPropagation(); togglePin(p, false) }}>unpin</button>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="chat-sessions">
          <h3>Past sessions</h3>
          {sessions.length === 0 && <div className="dim">none for this project</div>}
          {sessions.map(s => {
            const pinned = pins.some(p => p.sessionId === s.sessionId)
            return (
              <div key={s.sessionId} className="chat-session" onClick={() => start(s.sessionId)}>
                <b>{s.title || s.sessionId}</b>
                <span className="dim">
                  {fmtDate(s.mtime)}
                  <button className="mini" title={pinned ? 'unpin' : 'pin (bookmarks the session + current config version)'} style={{ marginLeft: 8, marginTop: 0, color: pinned ? '#e5a03a' : undefined }}
                    onClick={e => { e.stopPropagation(); togglePin({ ...s, cwd }, !pinned) }}>{pinned ? '★' : '☆'}</button>
                </span>
              </div>
            )
          })}
        </div>
      </div>
    )

  return (
    <div className="chat">
      <div className="chat-head">
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="mini" onClick={detach} title="back to session list (keeps session running)">‹ sessions</button>
          <b>{cwd.split('/').pop()}</b> <span className="dim">{cwd}</span>
        </span>
        <button className="mini" onClick={stop}>{ended ? 'close' : 'stop session'}</button>
      </div>
      <div className="chat-log">
        {blocks.map((b, i) => (b.kind === 'user' || b.kind === 'text') ? <Cap key={i} text={b.text}><Block b={b} /></Cap> : <Block key={i} b={b} />)}
        {busy && <div className="chat-line dim">✦ working…</div>}
        <div ref={endRef} />
      </div>
      <div className="chat-inputbar">
        <textarea
          value={input} rows={2} placeholder={ended ? 'session ended' : 'Message Claude… (Enter to send)'}
          disabled={ended}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <button className="primary" disabled={ended || !input.trim()} onClick={send}>Send</button>
      </div>
    </div>
  )
}
