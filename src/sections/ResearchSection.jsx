// Deep Research — ask a question, watch the agent search and read, get a cited report.
//
// The run lives on the SERVER (server/research.mjs), keyed by id. This component owns nothing but
// the view: src/App.jsx remounts every section on refresh, so anything stateful here would be lost
// mid-research. On mount it asks the server what is running and reattaches — that is the whole
// resume story.
//
// Transcript rendering is NOT duplicated here. `buildBlocks` + `Block` from ui/chatBlocks.jsx are
// the same renderer the chat uses, so a WebFetch in a research run looks like a WebFetch in a chat.
import React, { useEffect, useRef, useState } from 'react'
import { api, fmtDate, fmtSize } from '../lib/api.js'
import { buildBlocks, Block } from '../ui/chatBlocks.jsx'
import Markdown from '../ui/Markdown.jsx'

// A cancelled or interrupted run must never read as a finished one, so every terminal state gets
// its own label and colour rather than collapsing into "not running".
const STATUS = {
  running: { label: 'researching', cls: 'run' },
  done: { label: 'done', cls: 'done' },
  cancelled: { label: 'cancelled', cls: 'stop' },
  error: { label: 'failed', cls: 'err' },
  interrupted: { label: 'interrupted', cls: 'err' },
}
const statusOf = s => STATUS[s] || { label: s || 'unknown', cls: '' }

export default function ResearchSection() {
  const [list, setList] = useState([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)
  const [events, setEvents] = useState([])
  const [gap, setGap] = useState(null)
  const [err, setErr] = useState(null)
  const esRef = useRef(null)
  const seqRef = useRef(0)
  const retryRef = useRef(null)

  const load = () => api.get('/api/research').then(setList).catch(e => setErr(e.message))
  const merge = (id, patch) => setSel(s => (s && s.id === id ? { ...s, ...patch } : s))
  const detail = id => api.get(`/api/research/${id}`).then(d => merge(id, d)).catch(e => setErr(e.message))

  // The highest frame seq applied. Handed back as ?fromSeq on reconnect so the server sends only
  // what was missed instead of replaying the run from the start on every network blip.
  const openStream = (id, fromSeq) => {
    const es = new EventSource(`/api/research/${id}/events` + (fromSeq > 0 ? `?fromSeq=${fromSeq}` : ''))
    es.onmessage = m => {
      let f
      try { f = JSON.parse(m.data) } catch { return }
      if (f.kind === 'gap') {
        // Said out loud in the feed rather than swallowed: a truncated step feed reads as complete.
        setGap(f.payload)
        seqRef.current = Math.max(seqRef.current, (f.payload?.earliestSeq || 1) - 1)
        return
      }
      if (f.seq != null && f.seq <= seqRef.current) return
      if (f.seq != null) seqRef.current = f.seq
      if (f.kind === 'event') setEvents(prev => [...prev, f.payload])
      if (f.kind === 'complete') { es.close(); merge(id, f.payload); detail(id); load() }
    }
    es.onerror = () => {
      // Own the retry, because EventSource's own reconnect re-requests the original URL — without
      // fromSeq that replays everything.
      if (es.readyState !== EventSource.CLOSED) return
      es.close()
      if (esRef.current !== es) return
      retryRef.current = setTimeout(() => { esRef.current = openStream(id, seqRef.current) }, 1000)
    }
    return es
  }

  const attach = item => {
    esRef.current?.close()
    clearTimeout(retryRef.current)
    seqRef.current = 0
    setEvents([]); setGap(null); setErr(null); setSel(item)
    detail(item.id)
    if (item.status === 'running') esRef.current = openStream(item.id, 0)
  }

  useEffect(() => {
    api.get('/api/research')
      .then(d => { setList(d); const live = d.find(r => r.status === 'running'); if (live) attach(live) })
      .catch(e => setErr(e.message))
    return () => { esRef.current?.close(); clearTimeout(retryRef.current) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    const question = q.trim()
    if (!question) return
    setQ('')
    api.post('/api/research', { question })
      .then(({ id }) => { attach({ id, question, status: 'running', at: new Date().toISOString(), reportBytes: 0 }); load() })
      .catch(e => { setErr(e.message); setQ(question) })
  }
  const cancel = () => api.post(`/api/research/${sel.id}/cancel`).then(load).catch(e => setErr(e.message))
  const remove = r => {
    if (!confirm(`Delete this research and its report?\n\n${r.question.slice(0, 160)}`)) return
    api.del(`/api/research/${r.id}`)
      .then(() => { if (sel?.id === r.id) { esRef.current?.close(); setSel(null); setEvents([]) } ; load() })
      .catch(e => setErr(e.message))
  }

  const blocks = buildBlocks(events)
  const st = sel ? statusOf(sel.status) : null

  return (
    <div className="section research">
      <div className="list-pane wide">
        <div className="list-head"><h2>Deep Research <span className="muted">({list.length})</span></h2></div>
        <div className="research-ask">
          <textarea
            rows={3} value={q}
            placeholder="Ask a research question… the agent searches the web, reads the sources it cites, and writes a report with inline links"
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); start() } }}
          />
          <button className="primary" disabled={!q.trim()} onClick={start}>Research</button>
        </div>
        {err && <div className="chat-line err">{err}</div>}
        <div className="research-list">
          {list.length === 0 && <p className="muted center" style={{ padding: 20 }}>no research yet</p>}
          {list.map(r => (
            <div key={r.id} className={'row' + (sel?.id === r.id ? ' selected' : '')} onClick={() => attach(r)} title={r.question}>
              <div className="row-title">{r.question.length > 110 ? r.question.slice(0, 110) + '…' : r.question}</div>
              <div className="row-meta research-rowmeta">
                <span className={'research-st ' + statusOf(r.status).cls}>{statusOf(r.status).label}</span>
                <span>{fmtDate(Date.parse(r.at))}</span>
                {r.reportBytes > 0 && <span>{fmtSize(r.reportBytes)}</span>}
                <button className="mini" title="delete this research and its report" onClick={e => { e.stopPropagation(); remove(r) }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="detail-pane">
        {!sel ? <p className="muted center" style={{ padding: 24 }}>ask a question, or open a past report</p> : (
          <>
            <div className="research-head">
              <div className="research-question">{sel.question}</div>
              <div className="research-headright">
                <span className={'research-st ' + st.cls}>{st.label}</span>
                {sel.ms > 0 && <span className="dim">{(sel.ms / 1000).toFixed(0)}s</span>}
                {sel.cost > 0 && <span className="dim">${sel.cost.toFixed(3)}</span>}
                {sel.status === 'running' && <button className="mini" onClick={cancel}>Cancel</button>}
              </div>
            </div>
            {sel.error && <div className="chat-line err">{sel.error}</div>}
            {(events.length > 0 || gap) && (
              <details className="research-steps" open={sel.status === 'running'}>
                <summary>steps <span className="dim">({blocks.length} event{blocks.length === 1 ? '' : 's'})</span></summary>
                <div className="chat-log research-feed">
                  {gap && (
                    <div className="chat-line err">
                      ⚠ reconnected past the retained step history — events between seq {gap.requestedFrom + 1} and {(gap.earliestSeq || 1) - 1} are gone
                      {gap.dropped ? ` (${gap.dropped} dropped on this run)` : ''}. This feed is not the whole run; the report itself is unaffected.
                    </div>
                  )}
                  {blocks.map((b, i) => <Block key={i} b={b} />)}
                  {sel.status === 'running' && <div className="chat-line dim">✦ researching…</div>}
                </div>
              </details>
            )}
            <div className="research-report">
              {sel.report ? <Markdown source={sel.report} /> : (
                <p className="muted">{
                  sel.status === 'running' ? 'the report is written at the end of the run — watch the steps above'
                  : sel.status === 'cancelled' ? 'no report: this run was cancelled before it wrote one'
                  : sel.status === 'interrupted' ? 'no report: the dashboard restarted while this run was in flight'
                  : 'no report was produced'
                }</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
