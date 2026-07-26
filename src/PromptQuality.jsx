import React, { useEffect, useState } from 'react'
import { api, fmtDate, toast } from './api.js'

// Prompt Quality — how *you* prompt, rated across 8 fixed dimensions. Server caches a `claude -p`
// analysis of your real prompts (Claude Code or Cursor); Refresh recomputes it (costs a call).
const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '16px 18px', backdropFilter: 'blur(10px)', minWidth: 0 }
const CX = { low: '#3fb96a', moderate: '#e5a03a', high: '#e5484d' }
const scoreColor = s => s >= 8 ? '#3fb96a' : s >= 6 ? '#e5a03a' : '#e5484d'

const Chip = ({ text, color = '#7a716a' }) => (
  <span style={{ font: `500 10px ${MONO}`, color, border: `1px solid ${color}55`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{text}</span>
)

function Dim({ d }) {
  const c = scoreColor(d.score)
  return (
    <div style={{ ...PANEL, borderLeft: `3px solid ${c}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ font: `600 14px ${HEAD}`, color: '#e5dbd2' }}>{d.name}</span>
        <Chip text={d.complexity} color={CX[d.complexity] || '#7a716a'} />
        <span style={{ marginLeft: 'auto', font: `700 15px ${MONO}`, color: c }}>{d.score}<span style={{ color: '#7a716a', fontWeight: 400, fontSize: 11 }}>/10</span></span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.07)' }}>
        <div style={{ height: '100%', width: `${d.score * 10}%`, borderRadius: 3, background: c }} />
      </div>
      {d.example?.quote && (
        <div style={{ borderLeft: '2px solid rgba(255,255,255,0.12)', paddingLeft: 10 }}>
          <div style={{ font: `400 12px ${MONO}`, color: '#b8a89c', fontStyle: 'italic', lineHeight: 1.5 }}>"{d.example.quote}"</div>
          {d.example.where && <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginTop: 3 }}>{d.example.where}</div>}
        </div>
      )}
      {d.optimize && (
        <div style={{ font: `400 12px ${MONO}`, color: '#9a8f84', lineHeight: 1.55 }}>
          <span style={{ color: '#d97757', fontWeight: 600 }}>→ optimize: </span>{d.optimize}
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
  if (!d) return <div style={{ font: `400 12px ${MONO}`, color: '#7a716a', padding: 16 }}>loading…</div>
  const tool = source === 'cursor' ? 'Cursor' : 'Claude Code'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...PANEL, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ font: `700 30px ${MONO}`, color: scoreColor(d.avg) }}>{d.avg}<span style={{ color: '#7a716a', fontWeight: 400, fontSize: 13 }}>/10 avg</span></div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ font: `600 13px ${HEAD}`, color: '#e5dbd2', marginBottom: 3 }}>How you prompt {tool}</div>
          <div style={{ font: `400 12px ${MONO}`, color: '#9a8f84', lineHeight: 1.5 }}>{d.summary}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <button onClick={refresh} disabled={busy}
            style={{ font: `500 12px ${MONO}`, padding: '7px 12px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(217,119,87,0.14)', color: '#d97757', cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? '↻ analyzing…' : '↻ refresh'}
          </button>
          <span style={{ font: `400 10px ${MONO}`, color: '#7a716a' }}>
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
