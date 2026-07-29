import React, { useEffect, useState } from 'react'
import { api } from '../lib/api.js'

const MONO = 'var(--mono)'
const HEAD = 'var(--head)'
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 12 }

// Poll rather than stream. The board reads the tail of each transcript, which is cheap, and a
// couple of seconds of latency is invisible on a screen whose slowest signal is a human deciding
// what to type. A socket here would be more machinery for no perceptible gain.
const POLL_MS = 2000

// Every status carries its own colour and a plain-language gloss. `unknown` is a first-class
// state, not an error: it means the transcript did not say, and saying so beats guessing idle.
const STATUS = {
  thinking: { color: 'var(--green)', gloss: 'working right now' },
  waiting: { color: 'var(--amber, #d79921)', gloss: 'stopped and handed the turn back to you' },
  idle: { color: 'var(--text-tertiary)', gloss: 'nothing recent' },
  error: { color: 'var(--red)', gloss: 'last activity was a failure' },
  unknown: { color: 'var(--violet)', gloss: 'the transcript did not say' },
}

const ago = ms => {
  if (ms == null) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export default function LiveSection() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    const tick = () => api.get('/api/live').then(d => { if (alive) { setData(d); setErr('') } }).catch(e => alive && setErr(e.message))
    tick()
    const h = setInterval(tick, POLL_MS)
    return () => { alive = false; clearInterval(h) }
  }, [])

  if (err && !data) return <div style={{ ...PANEL, color: 'var(--red)', font: `400 12px ${MONO}` }}>{err}</div>
  if (!data) return <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>loading…</div>

  return (
    <div className="hx" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...PANEL }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 10 }}>
          <div style={{ font: `600 14px ${HEAD}` }}>Now</div>
          <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>
            from transcripts · refreshes every {POLL_MS / 1000}s
            {/* Say which signal is in play. Without the hook receiver this board is accurate but
                lags a turn's internal steps; claiming live-ness it doesn't have would be worse. */}
            {data.hookReceiver ? ' · hook receiver connected (mid-turn)' : ' · hook receiver not installed — states update per transcript write, not per step'}
          </span>
        </div>

        {data.sessions.length === 0 && (
          <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no sessions with activity yet</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.sessions.map(s => {
            const st = STATUS[s.status.status] || STATUS.unknown
            const pct = s.context?.percent
            return (
              <div key={s.sessionId} style={{ border: '1px solid var(--border-subtle)', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span title={st.gloss} style={{ font: `600 11px ${MONO}`, color: st.color }}>● {s.status.label || s.status.status}</span>
                  <span style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)' }}>{s.label}</span>
                  <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{ago(s.status.elapsedMs)}</span>
                  {s.permission && (
                    <span title={s.permission.description || ''} style={{ font: `600 10px ${MONO}`, color: 'var(--violet)', border: '1px solid var(--violet)', borderRadius: 3, padding: '0 4px' }}>
                      {s.permission.label}
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>
                    {s.msgs} turns · {s.toolCalls} tool calls
                  </span>
                </div>

                {/* Context pressure. A known percentage gets a bar; an unknown window gets the
                    real token count and no bar, because inventing a denominator to fill a bar
                    is exactly the kind of plausible-looking guess this codebase refuses. */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>
                  {s.context?.known ? (
                    <>
                      <div style={{ flex: 1, height: 4, background: 'var(--border-subtle)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--amber, #d79921)' : 'var(--accent-light)' }} />
                      </div>
                      <span style={{ color: s.context.over ? 'var(--red)' : undefined }}>
                        {Math.round(pct)}% of {(s.context.window / 1000).toFixed(0)}k
                        {s.context.over && ' — over: our window figure for this model is wrong'}
                      </span>
                    </>
                  ) : (
                    <span>
                      context: {s.context?.total != null ? `${s.context.total.toLocaleString()} tokens` : 'unknown'}
                      {s.context?.reason === 'unknown-model-window' && ` · no window known for ${s.context.model}`}
                      {s.context?.reason === 'no-current-turn-input-tokens' && ' · last turn reported no usage'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* collapseIdle hides rows deliberately. Showing the count keeps the board from reading
            as a complete list of everything that exists. */}
        {data.hidden > 0 && (
          <div style={{ marginTop: 10, font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>
            {data.hidden} row{data.hidden === 1 ? '' : 's'} hidden ({Object.entries(data.hiddenReasons || {}).map(([k, v]) => `${v} ${k.replace(/-/g, ' ')}`).join(', ')})
          </div>
        )}
      </div>
    </div>
  )
}
