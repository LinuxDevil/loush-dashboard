// Shared UI primitives. These three lived inside GovernanceSection.jsx — a routable section — while
// eight other sections imported them from it, so opening any of those files implied that Governance
// was involved. They are pure presentation with no Governance coupling; only their address changes.
import React from 'react'

const MONO = "var(--mono)"

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
  <pre style={{ margin: 0, padding: '14px 16px', font: `400 11px/1.6 ${MONO}`, overflowX: 'auto', maxHeight: 420, overflowY: 'auto', background: 'var(--bg-inset)', borderRadius: 6 }}>
    {lineDiff(before, after).map((d, i) => (
      <div key={i} style={{ color: d.t === '+' ? 'var(--green)' : d.t === '-' ? 'var(--red)' : 'var(--text-secondary)', background: d.t === '+' ? 'var(--green-bg)' : d.t === '-' ? 'var(--red-bg)' : 'transparent', whiteSpace: 'pre-wrap' }}>
        {d.t} {d.l}
      </div>
    ))}
  </pre>
)

// Underline tabs, not a pill group: the active tab is marked by a 2px rule that reads as "this panel
// belongs to that label", and the row doubles as the section's top border. Styling lives in the .tabs
// block of styles.css so the whole app changes in one place.
export const Tabs = ({ tabs, tab, setTab }) => (
  <div className="tabs" role="tablist">
    {tabs.map(t => (
      <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
    ))}
  </div>
)
