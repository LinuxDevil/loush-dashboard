import React, { useEffect, useState } from 'react'
import { api, fmtDate, toast } from '../lib/api.js'

// Prompt Quality — how *you* prompt, rated across 8 fixed dimensions. Server caches a `claude -p`
// analysis of your real prompts (Claude Code or Cursor); Refresh recomputes it (costs a call).
const MONO = "var(--mono)"
const HEAD = "var(--head)"
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12, padding: '16px 18px', minWidth: 0 }
const CX = { low: 'var(--green)', moderate: 'var(--amber)', high: 'var(--red)' }
const scoreColor = s => s >= 8 ? 'var(--green)' : s >= 6 ? 'var(--amber)' : 'var(--red)'

const Chip = ({ text, color = 'var(--text-tertiary)' }) => (
  <span style={{ font: `500 10px ${MONO}`, color, border: `1px solid ${color}55`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{text}</span>
)

function Dim({ d }) {
  const c = scoreColor(d.score)
  return (
    <div style={{ ...PANEL, borderLeft: `3px solid ${c}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ font: `600 14px ${HEAD}`, color: 'var(--text-primary)' }}>{d.name}</span>
        <Chip text={d.complexity} color={CX[d.complexity] || 'var(--text-tertiary)'} />
        <span style={{ marginLeft: 'auto', font: `700 14px ${MONO}`, color: c }}>{d.score}<span style={{ color: 'var(--text-tertiary)', fontWeight: 400, fontSize: 11 }}>/10</span></span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'var(--bg-surface-hover)' }}>
        <div style={{ height: '100%', width: `${d.score * 10}%`, borderRadius: 3, background: c }} />
      </div>
      {d.example?.quote && (
        <div style={{ borderLeft: '2px solid var(--border-default)', paddingLeft: 10 }}>
          <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: 1.5 }}>"{d.example.quote}"</div>
          {d.example.where && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginTop: 3 }}>{d.example.where}</div>}
        </div>
      )}
      {d.optimize && (
        <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>→ optimize: </span>{d.optimize}
        </div>
      )}
    </div>
  )
}

export default function PromptQuality({ source = 'claude' }) {
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => api.get(`/api/promptcheck?source=${source}`).then(setD).catch(() => {})
  useEffect(() => { load() }, [source])
  const refresh = () => {
    setBusy(true)
    api.post('/api/promptcheck/refresh', { source })
      .then(r => { setD(r); toast(`analyzed ${r.sampled} ${source} prompts`, 'success') })
      .catch(e => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }
  if (!d) return <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-tertiary)', padding: 16 }}>loading…</div>
  const tool = source === 'cursor' ? 'Cursor' : 'Claude Code'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...PANEL, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ font: `700 20px ${MONO}`, color: scoreColor(d.avg) }}>{d.avg}<span style={{ color: 'var(--text-tertiary)', fontWeight: 400, fontSize: 13 }}>/10 avg</span></div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ font: `600 13px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 3 }}>How you prompt {tool}</div>
          <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{d.summary}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <button onClick={refresh} disabled={busy}
            style={{ font: `500 12px ${MONO}`, padding: '7px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--accent-bg)', color: 'var(--accent)', cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? '↻ analyzing…' : '↻ refresh'}
          </button>
          <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>
            {d.available && d.generatedAt ? `cached · ${fmtDate(d.generatedAt)}${d.sampled ? ` · ${d.sampled} prompts` : ''}` : 'baseline — refresh to analyze'}
          </span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 12 }}>
        {d.dimensions.map((x, i) => <Dim key={i} d={x} />)}
      </div>
    </div>
  )
}
