import React from 'react'

// Cursor-only chart primitives. src/charts.jsx is shared and stays untouched; the only shape it
// lacks is a vertical column chart, which the trend (item 1), the $/day bars (item 2) and the
// context-pressure histogram (item 9) all need. One component, three callers.
const MONO = "'IBM Plex Mono', monospace"

// items: [{ label, value, hint?, color? }] — label is the x tick (thinned automatically)
export function Columns({ items, color = '#7cc4f7', height = 96, ticks = 6, valueLabel = v => v, empty = 'no data' }) {
  if (!items?.length) return <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>{empty}</div>
  const max = Math.max(1, ...items.map(i => i.value || 0))
  const every = Math.max(1, Math.ceil(items.length / ticks))
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: items.length > 60 ? 1 : 2, height }}>
        {items.map((it, i) => (
          <div key={i} title={it.hint || `${it.label}: ${valueLabel(it.value)}`}
            style={{
              flex: 1, minWidth: 2, borderRadius: '3px 3px 0 0',
              height: Math.max(it.value > 0 ? 2 : 1, (it.value / max) * height) + 'px',
              background: it.value > 0 ? (it.color || color) : 'rgba(255,255,255,0.06)',
              opacity: 0.9, transition: 'height .4s cubic-bezier(.2,.8,.2,1)',
            }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 2, marginTop: 5 }}>
        {items.map((it, i) => (
          <div key={i} style={{ flex: 1, minWidth: 0, font: `400 8.5px ${MONO}`, color: '#5c554f', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {i % every === 0 ? it.label : ''}
          </div>
        ))}
      </div>
    </div>
  )
}
