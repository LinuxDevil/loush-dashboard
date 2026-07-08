import React from 'react'
export const HEAD = "'Space Grotesk', sans-serif"
export const BODY = "'IBM Plex Sans', sans-serif"
export const MONO = "'IBM Plex Mono', monospace"
export const ACCENT = '#c9a15a' // career mode is warm gold
export const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }
export const Stat = ({ label, val }) => (
  <div style={{ ...PANEL, padding: '14px 18px', flex: 1, minWidth: 130 }}>
    <div style={{ font: `700 24px ${HEAD}`, color: '#e5dbd2' }}>{val ?? '—'}</div>
    <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{label}</div>
  </div>
)
