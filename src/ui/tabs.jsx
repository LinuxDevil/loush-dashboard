// Shared UI primitives. These three lived inside GovernanceSection.jsx — a routable section — while
// eight other sections imported them from it, so opening any of those files implied that Governance
// was involved. They are pure presentation with no Governance coupling; only their address changes.
import React from 'react'

const MONO = "'IBM Plex Mono', monospace"

// minimal LCS line diff — good enough for config files
export function lineDiff(a, b) {
  const A = (a || '').split('\n'), B = (b || '').split('\n')
  const m = A.length, n = B.length
  if (m * n > 400000) return A.map(l => ({ t: ' ', l })).concat([{ t: ' ', l: '… (file too large to diff)' }])
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1))
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out = []
  let i = 0, j = 0
  while (i < m && j < n) {
    if (A[i] === B[j]) { out.push({ t: ' ', l: A[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: '-', l: A[i] }); i++ }
    else { out.push({ t: '+', l: B[j] }); j++ }
  }
  while (i < m) out.push({ t: '-', l: A[i++] })
  while (j < n) out.push({ t: '+', l: B[j++] })
  return out
}

export const DiffView = ({ before, after }) => (
  <pre style={{ margin: 0, padding: '14px 16px', font: `400 11px/1.6 ${MONO}`, overflowX: 'auto', maxHeight: 420, overflowY: 'auto', background: 'rgba(0,0,0,0.3)', borderRadius: 10 }}>
    {lineDiff(before, after).map((d, i) => (
      <div key={i} style={{ color: d.t === '+' ? '#7fd6a0' : d.t === '-' ? '#f0a0a3' : '#8a807a', background: d.t === '+' ? 'rgba(63,185,106,0.07)' : d.t === '-' ? 'rgba(229,72,77,0.07)' : 'transparent', whiteSpace: 'pre-wrap' }}>
        {d.t} {d.l}
      </div>
    ))}
  </pre>
)

export const Tabs = ({ tabs, tab, setTab }) => (
  <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', width: 'fit-content' }}>
    {tabs.map(t => (
      <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', font: `600 11px ${MONO}`, background: tab === t ? 'rgba(217,119,87,0.18)' : 'transparent', color: tab === t ? '#f0e7e0' : '#8a807a' }}>{t}</button>
    ))}
  </div>
)
