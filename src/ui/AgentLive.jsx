import React, { useEffect, useRef, useState } from 'react'
import { api, toast } from '../lib/api.js'
import { buildBlocks, MessageLog } from './chatBlocks.jsx'

const MONO = 'var(--mono)'
const HEAD = 'var(--head)'
const Meta = ({ children, color = 'var(--text-tertiary)' }) => <span style={{ font: `400 11px ${MONO}`, color }}>{children}</span>
const elapsed = ms => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`)

/**
 * What a board agent is doing, tailed from its transcript and rendered as a chat.
 *
 * Shared by the ticket drawer and Loush Runs rather than written twice: they are the same question
 * asked from two screens, and the second copy is the one that drifts.
 *
 * Liveness comes from the poll, never from the caller's snapshot. The board list refreshes on its
 * own 5s timer and pauses while the tab is hidden, so `running` handed in from a ticket can be
 * minutes stale — this panel showed "◐ dev agent — live, 1m 40s" for a run that had already
 * finished. Once the endpoint has answered even once, its answer wins.
 *
 * `source` makes the endpoints a parameter so the ticket pipeline can tail a stage with the same
 * component rather than a second copy of it. It defaults to the board's paths, which is what both
 * existing callers pass nothing for.
 */
const boardSource = ticketId => ({ live: `/api/board/tickets/${ticketId}/live`, stop: `/api/board/tickets/${ticketId}/stop` })

export default function AgentLive({ ticketId, running: runningHint, onStopped, source }) {
  const src = source || boardSource(ticketId)
  const [log, setLog] = useState({ events: [], file: null, running: null, note: null, polled: false })
  const [now, setNow] = useState(Date.now())
  const boxRef = useRef(null)
  const stick = useRef(true)
  const cursor = useRef({ file: null, offset: 0 })

  useEffect(() => {
    cursor.current = { file: null, offset: 0 }
    setLog({ events: [], file: null, running: null, note: null, polled: false })
  }, [src.live])

  useEffect(() => {
    let alive = true
    const poll = () => {
      const { file, offset } = cursor.current
      const q = new URLSearchParams({ offset: String(offset), ...(file ? { file } : {}) })
      api.get(`${src.live}${src.live.includes('?') ? '&' : '?'}${q}`).then(d => {
        if (!alive) return
        cursor.current = { file: d.file, offset: d.offset }
        setLog(prev => ({ ...d, polled: true, events: [...(d.file === prev.file ? prev.events : []), ...d.events].slice(-400) }))
        setNow(Date.now())
      }).catch(() => {})
    }
    poll()
    // A live run earns a 2s heartbeat; a finished transcript is not moving.
    const id = setInterval(poll, runningHint ? 2000 : 15000)
    return () => { alive = false; clearInterval(id) }
  }, [src.live, runningHint?.kind, runningHint?.startedAt])

  useEffect(() => { if (stick.current && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight }, [log.events.length])

  const blocks = React.useMemo(() => buildBlocks(log.events), [log.events])
  const run = log.polled ? log.running : runningHint
  const tools = blocks.filter(b => b.kind === 'tool').length
  const stop = () => api.post(src.stop)
    .then(r => { toast(r.resumeSessionId ? 'stopped — resumable' : 'stopped', 'success'); onStopped?.() })
    .catch(e => alert(e.message))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ font: `600 12px ${HEAD}` }}>{run ? `◐ ${run.kind} agent — live` : 'last agent session'}</div>
        {run && <Meta color="var(--blue)">{elapsed(now - run.startedAt)} · {tools} tool call{tools === 1 ? '' : 's'}</Meta>}
        {run && <button className="mini" style={{ marginTop: 0, color: 'var(--red)' }} onClick={stop} title="kills the agent process — the session id is kept so it can be resumed">■ stop</button>}
        {log.file && <Meta>{log.file.split('/').pop().replace('.jsonl', '')}</Meta>}
      </div>
      {log.note && <Meta>{log.note}</Meta>}
      {!!blocks.length && (
        <div ref={boxRef}
          onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24 }}
          style={{ maxHeight: 420, overflow: 'auto', background: 'var(--bg-inset)', borderRadius: 6, padding: '8px 10px' }}>
          <MessageLog blocks={blocks} busy={!!run} />
        </div>
      )}
    </div>
  )
}
