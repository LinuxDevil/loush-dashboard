import React, { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { api, fmtDate } from './api.js'
import { extractPlan, blocksToPlan, diagnoseSession } from './plan.js'
import PlanGraph from './PlanGraph.jsx'

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
        else if (c.type === 'image' && c.source?.data) target(ev).push({ kind: 'user-image', src: `data:${c.source.media_type};base64,${c.source.data}` })
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
  if (b.kind === 'user-image') return <div className="chat-msg user" style={{ padding: 4 }}><img src={b.src} alt="attachment" style={{ maxWidth: 280, maxHeight: 220, borderRadius: 8, display: 'block' }} /></div>
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

const fileToB64 = f => new Promise((ok, err) => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.onerror = err; r.readAsDataURL(f) })

// input bar with "/" command + "@" file autocomplete, image paste/attach, any-file upload
function InputBar({ cwd, ended, onSend, initial }) {
  const [input, setInput] = useState(initial || '')
  const [atts, setAtts] = useState([]) // {kind:'image', name, media_type, data} | {kind:'file', name, path}
  const [sug, setSug] = useState(null) // {trigger:'/'|'@', items, idx, start, end}
  const cmdsRef = useRef(null)
  const taRef = useRef(null)
  const fileRef = useRef(null)
  const debRef = useRef(null)
  useEffect(() => { cmdsRef.current = null }, [cwd])
  useEffect(() => { if (initial) setInput(initial) }, [initial])

  const updateSug = (text, caret) => {
    clearTimeout(debRef.current)
    const before = text.slice(0, caret)
    const cmd = /^\/([\w:-]*)$/.exec(before) // slash commands are message-initial
    const file = /@([^\s@]*)$/.exec(before)
    if (!cmd && !file) return setSug(null)
    debRef.current = setTimeout(async () => {
      try {
        let items
        if (cmd) {
          cmdsRef.current ||= await api.get('/api/chat/complete?cwd=' + encodeURIComponent(cwd))
          items = cmdsRef.current.filter(c => c.name.toLowerCase().includes(cmd[1].toLowerCase()))
        } else {
          items = await api.get(`/api/chat/complete?kind=files&cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(file[1])}`)
        }
        const m = cmd || file
        setSug(items.length ? { trigger: cmd ? '/' : '@', items: items.slice(0, 12), idx: 0, start: m.index, end: caret } : null)
      } catch { setSug(null) }
    }, cmd && cmdsRef.current ? 0 : 150)
  }
  const pick = item => {
    if (sug.trigger === '@') { // file/folder refs become tags, not inline text
      setInput(input.slice(0, sug.start) + input.slice(sug.end))
      setAtts(a => [...a, { kind: 'ref', name: item.name }])
    } else {
      setInput(input.slice(0, sug.start) + '/' + item.name + ' ' + input.slice(sug.end))
    }
    setSug(null)
    taRef.current?.focus()
  }
  const addFiles = async files => {
    for (const f of files) {
      if (f.type.startsWith('image/')) setAtts(a => [...a, { kind: 'image', name: f.name || 'pasted image', media_type: f.type, data: null, _p: fileToB64(f) }])
      else {
        try {
          const r = await fetch('/api/chat/upload?name=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f })
          const j = await r.json()
          if (!r.ok) throw new Error(j.error)
          setAtts(a => [...a, { kind: 'file', name: f.name, path: j.path }])
        } catch (e) { alert('upload failed: ' + e.message) }
      }
    }
  }
  const send = async () => {
    const images = []
    for (const a of atts.filter(x => x.kind === 'image')) images.push({ media_type: a.media_type, data: a.data || await a._p })
    const refs = atts.filter(x => x.kind === 'file' || x.kind === 'ref').map(x => `@${x.path || x.name}`).join('\n')
    const text = [input.trim(), refs].filter(Boolean).join('\n')
    if (!text && !images.length) return
    setInput(''); setAtts([]); setSug(null)
    onSend(text || 'see attached', images)
  }
  const key = e => {
    if (sug) {
      if (e.key === 'ArrowDown') { e.preventDefault(); return setSug({ ...sug, idx: (sug.idx + 1) % sug.items.length }) }
      if (e.key === 'ArrowUp') { e.preventDefault(); return setSug({ ...sug, idx: (sug.idx - 1 + sug.items.length) % sug.items.length }) }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); return pick(sug.items[sug.idx]) }
      if (e.key === 'Escape') return setSug(null)
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }
  return (
    <div className="chat-inputwrap">
      {sug && (
        <div className="chat-sug">
          {sug.items.map((it, i) => (
            <div key={it.name + i} className={'chat-sug-item' + (i === sug.idx ? ' sel' : '')} onMouseDown={e => { e.preventDefault(); pick(it) }}>
              <b>{sug.trigger}{it.name}</b>
              {it.scope && <span className="dim"> {it.scope}</span>}
              {it.desc && <span className="dim"> — {it.desc.slice(0, 70)}</span>}
            </div>
          ))}
        </div>
      )}
      {atts.length > 0 && (
        <div className="chat-atts">
          {atts.map((a, i) => (
            <span key={i} className="chat-att">{a.kind === 'image' ? '🖼' : a.kind === 'ref' ? (a.name.endsWith('/') ? '📁' : '📄') : '📎'} {a.name.length > 42 ? '…' + a.name.slice(-40) : a.name}
              <button onClick={() => setAtts(atts.filter((_, j) => j !== i))}>✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="chat-inputbar">
        <button className="mini" style={{ marginTop: 0 }} title="attach images (sent to the model) or any file — videos, PDFs, CSVs — saved and referenced as @path" onClick={() => fileRef.current?.click()} disabled={ended}>📎</button>
        <input ref={fileRef} type="file" multiple hidden onChange={e => { addFiles([...e.target.files]); e.target.value = '' }} />
        <textarea
          ref={taRef}
          value={input} rows={2} placeholder={ended ? 'session ended' : 'Message Claude…  / commands · @ files · paste images · Enter to send'}
          disabled={ended}
          onChange={e => { setInput(e.target.value); updateSug(e.target.value, e.target.selectionStart) }}
          onKeyDown={key}
          onBlur={() => setTimeout(() => setSug(null), 150)}
          onPaste={e => { const imgs = [...e.clipboardData.items].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean); if (imgs.length) { e.preventDefault(); addFiles(imgs) } }}
        />
        <button className="primary" disabled={ended || (!input.trim() && !atts.length)} onClick={send}>Send</button>
      </div>
    </div>
  )
}

export default function ChatSection() {
  const [projects, setProjects] = useState([])
  const [cwd, setCwd] = useState('')
  const [sessions, setSessions] = useState([])
  const [active, setActive] = useState([]) // live server-side chats
  const [pins, setPins] = useState([])
  const [chatId, setChatId] = useState(null)
  const [events, setEvents] = useState([])
  const [prefill, setPrefill] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState('chat')
  const esRef = useRef(null)
  const endRef = useRef(null)

  const loadPins = () => api.get('/api/pins').then(setPins).catch(() => {})
  useEffect(() => {
    api.get('/api/projects').then(ps => { const ex = ps.filter(p => p.exists); setProjects(ex); if (ex[0]) setCwd(ex[0].path) })
    api.get('/api/chat').then(setActive).catch(() => {})
    loadPins()
    const pre = sessionStorage.getItem('ctx-bundle-prompt') // feature 22 hand-off
    if (pre) { setPrefill(pre); sessionStorage.removeItem('ctx-bundle-prompt') }
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
    setEvents([]); setChatId(id); setView('chat')
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
    const { id } = await api.post('/api/chat', { cwd, resume, model: model || undefined })
    attach(id)
    api.get('/api/chat').then(setActive).catch(() => {})
  }
  const send = async (text, images) => {
    if (!chatId) return
    setBusy(true)
    await api.post(`/api/chat/${chatId}/message`, { text, images }).catch(e => { setBusy(false); alert(e.message) })
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
  const realPlan = extractPlan(blocks)
  const plan = realPlan || (blocks.some(b => b.kind === 'tool') ? blocksToPlan(blocks) : null)
  const ended = blocks.some(b => b.kind === 'closed')
  const liveModel = events.find(e => e.type === 'system' && e.subtype === 'init')?.model

  if (!chatId)
    return (
      <div className="chat-launcher">
        <div className="chat-row">
          <select value={cwd} onChange={e => setCwd(e.target.value)}>
            {projects.map(p => <option key={p.path} value={p.path}>{p.name} — {p.path}</option>)}
          </select>
          <select value={model} onChange={e => setModel(e.target.value)} title="model for new & resumed sessions — pick a cheaper one when you're near a usage limit">
            <option value="">default model</option>
            <option value="haiku">haiku</option>
            <option value="sonnet">sonnet</option>
            <option value="opus">opus</option>
          </select>
          <button className="primary" onClick={() => start()}>New session</button>
        </div>
        {active.filter(a => a.alive).length > 0 && (
          <div className="chat-sessions">
            <h3>Live now</h3>
            {active.filter(a => a.alive).map(a => (
              <div key={a.id} className="chat-session" onClick={() => attach(a.id, a.cwd)}>
                <b>{a.cwd.split('/').pop()}</b> <span className="dim">{a.model ? a.model + ' · ' : ''}{a.events} events · {a.cwd}</span>
              </div>
            ))}
          </div>
        )}
        {pins.length > 0 && (
          <div className="chat-sessions">
            <h3>Pinned</h3>
            {pins.map(p => (
              <div key={p.sessionId} className="chat-session" onClick={() => { if (p.cwd) setCwd(p.cwd); api.post('/api/chat', { cwd: p.cwd || cwd, resume: p.sessionId, model: model || undefined }).then(({ id }) => attach(id, p.cwd)) }}>
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
          {liveModel && <span className="dim" style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '1px 7px' }}>{liveModel}</span>}
        </span>
        <span style={{ display: 'flex', gap: 8 }}>
          {plan && <button className="mini" style={{ marginTop: 0, color: view === 'plan' ? '#d97757' : undefined }} onClick={() => setView(view === 'plan' ? 'chat' : 'plan')}>{view === 'plan' ? 'chat' : `${realPlan ? 'plan' : 'activity'} graph (${plan.length})`}</button>}
          <button className="mini" style={{ marginTop: 0 }} onClick={stop}>{ended ? 'close' : 'stop session'}</button>
        </span>
      </div>
      {view === 'plan' && plan
        ? <div className="chat-log"><PlanGraph steps={plan} cwd={cwd} derived={!realPlan} diagnostics={diagnoseSession(blocks)} /></div>
        : <div className="chat-log">
        {blocks.map((b, i) => (b.kind === 'user' || b.kind === 'text') ? <Cap key={i} text={b.text}><Block b={b} /></Cap> : <Block key={i} b={b} />)}
        {busy && <div className="chat-line dim">✦ working…</div>}
        <div ref={endRef} />
      </div>}
      <InputBar cwd={cwd} ended={ended} onSend={send} initial={prefill} />
    </div>
  )
}
