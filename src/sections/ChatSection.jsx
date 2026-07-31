import React, { useEffect, useRef, useState } from 'react'
import SelectionChips, { useSelectionChips } from '../ui/SelectionChips.jsx'
import { api, fmtDate } from '../lib/api.js'
import { extractPlan, blocksToPlan, diagnoseSession } from '../lib/plan.js'
import PlanGraph from './PlanGraph.jsx'
import { ContextTimeline } from './ContextExplorerSection.jsx'
import ActivityTimeline from './ActivityTimeline.jsx'
// Transcript rendering lives in ui/chatBlocks.jsx — see the header there for the split.
import { buildBlocks, ContextPill, MessageLog, SessionCostPill } from '../ui/chatBlocks.jsx'

const fileToB64 = f => new Promise((ok, err) => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.onerror = err; r.readAsDataURL(f) })

function InputBar({ cwd, ended, onSend, initial }) {
  const [input, setInput] = useState(initial || '')
  useEffect(() => { if (initial) setInput(initial) }, [initial])
  const [atts, setAtts] = useState([])
  const [sug, setSug] = useState(null)
  const cmdsRef = useRef(null)
  const taRef = useRef(null)
  const fileRef = useRef(null)
  const debRef = useRef(null)
  useEffect(() => { cmdsRef.current = null }, [cwd])
  useEffect(() => { if (initial) setInput(initial) }, [initial])

  const updateSug = (text, caret) => {
    clearTimeout(debRef.current)
    const before = text.slice(0, caret)
    const cmd = /^\/([\w:-]*)$/.exec(before)
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
    if (sug.trigger === '@') {
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
          // The server refuses with a machine reason and the bound it applied. Saying which limit
          // was hit is the difference between "try a smaller file" and "the upload is broken".
          if (!r.ok) throw new Error(
            j.reason === 'file-too-large' ? `too large — ${(j.size / 1048576).toFixed(1)}MB, limit is ${Math.round(j.limit / 1048576)}MB`
            : j.reason === 'exceeds-quota' ? `no room — the upload folder is capped at ${Math.round(j.limit / 1048576)}MB and this file cannot fit`
            : j.reason === 'unusable-name' ? 'that filename has no usable characters'
            : j.reason || j.error || `HTTP ${r.status}`)
          // Eviction is reported rather than silent: an older attachment's `@path` in a prior
          // message may no longer resolve, and that is worth knowing.
          if (j.reclaimed?.length) console.warn(`upload quota: reclaimed ${j.reclaimed.length} older upload(s)`, j.reclaimed)
          setAtts(a => [...a, { kind: 'file', name: f.name, path: j.path, bytes: j.bytes, reclaimed: j.reclaimed }])
        } catch (e) { alert('upload failed: ' + e.message) }
      }
    }
  }
  const chips = useSelectionChips()
  const send = async () => {
    const images = []
    for (const a of atts.filter(x => x.kind === 'image')) images.push({ media_type: a.media_type, data: a.data || await a._p })
    const refs = atts.filter(x => x.kind === 'file' || x.kind === 'ref').map(x => `@${x.path || x.name}`).join('\n')
    // 077: editor selections ride along as chips. `chipsToPrompt` reports its own truncation
    // inside the text it returns, so a clipped payload cannot look complete to the model.
    const chipText = chips.toPrompt ? chips.toPrompt() : ''
    const text = [input.trim(), refs, chipText].filter(Boolean).join('\n')
    if (!text && !images.length) return
    setInput(''); setAtts([]); setSug(null)
    chips.clear?.()
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
      <SelectionChips packed={chips.packed} onRemove={chips.remove} onClear={chips.clear}
        onToggleData={chips.toggleData} tabNotice={chips.tabNotice} onDismissNotice={chips.dismissNotice} />
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
  const [active, setActive] = useState([])
  const [pins, setPins] = useState([])
  const [chatId, setChatId] = useState(null)
  const [events, setEvents] = useState([])
  const [prefill, setPrefill] = useState('')
  const [model, setModel] = useState('')
  const [permMode, setPermMode] = useState('skip')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState('chat')
  const [ctxData, setCtxData] = useState(null)
  const [ctxHover, setCtxHover] = useState(null)
  const [gap, setGap] = useState(null)
  const esRef = useRef(null)
  const reconnectRef = useRef(null)
  const endRef = useRef(null)

  const loadPins = () => api.get('/api/pins').then(setPins).catch(() => {})
  useEffect(() => {
    api.get('/api/projects').then(ps => { const ex = ps.filter(p => p.exists); setProjects(ex); if (ex[0]) setCwd(ex[0].path) })
    api.get('/api/chat').then(setActive).catch(() => {})
    loadPins()
    const pre = sessionStorage.getItem('ctx-bundle-prompt')
    if (pre) { setPrefill(pre); sessionStorage.removeItem('ctx-bundle-prompt') }
  }, [])
  const togglePin = (s, pinned) => {
    const label = pinned ? (prompt('Label (optional):', '') ?? '') : ''
    api.put('/api/pins', { sessionId: s.sessionId, cwd: s.cwd || cwd, title: s.title || '', label, pinned }).then(loadPins).catch(e => alert(e.message))
  }
  useEffect(() => { if (cwd) api.get('/api/chat/sessions?cwd=' + encodeURIComponent(cwd)).then(setSessions) }, [cwd])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [events])

  // The highest seq this client has actually applied. On a reconnect it is handed back as
  // ?fromSeq so the server sends only what was missed — EventSource's own reconnect re-requests
  // the same URL, which replays the entire retained log every time the network blips.
  const seqRef = useRef(0)
  const openStream = (id, fromSeq) => {
    const url = `/api/chat/${id}/events` + (fromSeq > 0 ? `?fromSeq=${fromSeq}` : '')
    const es = new EventSource(url)
    es.onmessage = m => {
      let ev
      try { ev = JSON.parse(m.data) } catch { return }
      if (ev.type === 'replay_gap') {
        // The server cannot serve the gap. Say so in the transcript rather than letting a
        // silently truncated history read as the whole run.
        setGap({ earliestSeq: ev.earliestSeq, from: ev.requestedFrom, dropped: ev.dropped })
        seqRef.current = Math.max(seqRef.current, (ev.earliestSeq || 1) - 1)
        return
      }
      // Native EventSource reconnects can re-deliver frames we already have; seq makes that
      // detectable instead of duplicating the transcript.
      if (ev.seq != null && ev.seq <= seqRef.current) return
      if (ev.seq != null) seqRef.current = ev.seq
      setEvents(prev => [...prev, ev])
      if (ev.type === 'result' || ev.type === 'closed') setBusy(false)
    }
    es.onerror = () => {
      // Take over the retry so the reopened stream carries fromSeq. Left to EventSource, the
      // reconnect would replay from the beginning.
      if (es.readyState !== EventSource.CLOSED) return
      es.close()
      if (esRef.current !== es) return
      reconnectRef.current = setTimeout(() => { esRef.current = openStream(id, seqRef.current) }, 1000)
    }
    return es
  }
  const attach = (id, chatCwd) => {
    esRef.current?.close()
    clearTimeout(reconnectRef.current)
    if (chatCwd) setCwd(chatCwd)
    seqRef.current = 0
    setEvents([]); setChatId(id); setView('chat'); setCtxData(null); setGap(null)
    esRef.current = openStream(id, 0)
  }
  useEffect(() => () => { esRef.current?.close(); clearTimeout(reconnectRef.current) }, [])

  // Every launch path goes through here. There are three of them — New session, the `chat-open`
  // window event, and clicking a pin — and an option added to only one of them means "resumed
  // from a pin" silently ignores the mode you picked.
  const startBody = over => ({ cwd, model: model || undefined, permissionMode: permMode, ...over })

  const start = async resume => {
    const { id } = await api.post('/api/chat', startBody({ resume }))
    attach(id)
    api.get('/api/chat').then(setActive).catch(() => {})
  }
  useEffect(() => {
    const onOpen = e => {
      const { sessionId, cwd: c, prefill: pre } = e.detail || {}
      if (pre) setPrefill(pre)
      api.post('/api/chat', startBody({ cwd: c || cwd, resume: sessionId || undefined }))
        .then(({ id }) => { attach(id, c); api.get('/api/chat').then(setActive).catch(() => {}) })
        .catch(err => alert(err.message))
    }
    window.addEventListener('chat-open', onOpen)
    return () => window.removeEventListener('chat-open', onOpen)
  }, [cwd, model, permMode]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (text, images) => {
    if (!chatId) return
    setBusy(true)
    await api.post(`/api/chat/${chatId}/message`, { text, images }).catch(e => { setBusy(false); alert(e.message) })
  }
  const detach = () => {
    esRef.current?.close()
    clearTimeout(reconnectRef.current)
    setChatId(null); setEvents([]); setBusy(false); setGap(null)
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
  const initEvent = events.find(e => e.type === 'system' && e.subtype === 'init')
  const liveModel = initEvent?.model
  const realSessionId = initEvent?.session_id || null

  useEffect(() => {
    if (view !== 'context' || !realSessionId) return
    api.get(`/api/context/${realSessionId}`).then(setCtxData).catch(() => setCtxData(null))
  }, [view, realSessionId, events.length])

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
          <select value={permMode} onChange={e => setPermMode(e.target.value)} title="how the agent asks before using tools — 'skip' is the historical default and asks for nothing">
            <option value="skip">skip permissions</option>
            <option value="default">ask (default)</option>
            <option value="acceptEdits">auto-accept edits</option>
            <option value="plan">plan only</option>
          </select>
          <button className="primary" onClick={() => start()}>New session</button>
        </div>
        {active.filter(a => a.alive).length > 0 && (
          <div className="chat-sessions">
            <h3>Live now</h3>
            {active.filter(a => a.alive).map(a => (
              <div key={a.id} className="chat-session" onClick={() => attach(a.id, a.cwd)}>
                <b>{a.cwd.split('/').pop()}</b> <span className="dim">{a.model ? a.model + ' · ' : ''}{a.permissionMode && a.permissionMode !== 'skip' ? a.permissionMode + ' · ' : ''}{a.events} events · {a.cwd}</span>
              </div>
            ))}
          </div>
        )}
        {pins.length > 0 && (
          <div className="chat-sessions">
            <h3>Pinned</h3>
            {pins.map(p => (
              <div key={p.sessionId} className="chat-session" onClick={() => { if (p.cwd) setCwd(p.cwd); api.post('/api/chat', startBody({ cwd: p.cwd || cwd, resume: p.sessionId })).then(({ id }) => attach(id, p.cwd)) }}>
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
                  <button className="mini" title={pinned ? 'unpin' : 'pin (bookmarks the session + current config version)'} style={{ marginLeft: 8, marginTop: 0, color: pinned ? 'var(--amber)' : undefined }}
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
          {liveModel && <span className="dim" style={{ border: '1px solid var(--border-default)', borderRadius: 6, padding: '1px 7px' }}>{liveModel}</span>}
          {permMode !== 'skip' && <span className="pill" title="tool permissions are restricted for this session">{permMode}</span>}
          <ContextPill events={events} />
          <SessionCostPill blocks={blocks} />
        </span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button className="mini" style={{ marginTop: 0, color: view === 'plan' ? 'var(--accent)' : undefined }} disabled={!plan}
            title={plan ? undefined : 'no plan or tool activity yet'}
            onClick={() => setView(v => v === 'plan' ? 'chat' : 'plan')}>
            {view === 'plan' ? 'chat' : `${realPlan ? 'plan' : 'activity'} graph${plan ? ` (${plan.length})` : ''}`}
          </button>
          <button className="mini" style={{ marginTop: 0, color: view === 'context' ? 'var(--accent)' : undefined }} disabled={!realSessionId}
            title={realSessionId ? undefined : 'session not started yet'}
            onClick={() => setView(v => v === 'context' ? 'chat' : 'context')}>
            {view === 'context' ? 'chat' : 'context window'}
          </button>
          <button className="mini" style={{ marginTop: 0, color: view === 'activity' ? 'var(--accent)' : undefined }} disabled={!blocks.length}
            title={blocks.length ? undefined : 'nothing has happened yet'}
            onClick={() => setView(v => v === 'activity' ? 'chat' : 'activity')}>
            {view === 'activity' ? 'chat' : 'activity tree'}
          </button>
          <button className="mini" style={{ marginTop: 0 }} onClick={stop}>{ended ? 'close' : 'stop session'}</button>
        </span>
      </div>
      {view === 'plan' && plan
        ? <div className="chat-log"><PlanGraph steps={plan} cwd={cwd} derived={!realPlan} diagnostics={diagnoseSession(blocks)} /></div>
        : view === 'context'
        ? <div className="chat-log">
          {!ctxData
            ? <div className="dim" style={{ padding: 16 }}>loading context timeline…</div>
            : <ContextTimeline data={ctxData} hover={ctxHover} setHover={setCtxHover} playing={false} setPlaying={() => {}} cursor={-1} setCursor={() => {}} />}
        </div>
        : view === 'activity'
        ? <div className="chat-log"><ActivityTimeline blocks={blocks} /></div>
        : <div className="chat-log">
        <MessageLog blocks={blocks} gap={gap} busy={busy} chatId={chatId} cwd={cwd} />
        <div ref={endRef} />
      </div>}
      <InputBar cwd={cwd} ended={ended} onSend={send} initial={prefill} />
    </div>
  )
}
