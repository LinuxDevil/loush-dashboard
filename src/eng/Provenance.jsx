import React, { useState } from 'react'
import { BODY, MONO, HEAD, GREEN, GOLD, RED, DIM, HI, miniBtn, useCopy, Spinner } from './ui.jsx'

// §3 — "JIRA 412 issues · GitHub 288 PRs · built 14m ago · [refresh]".
// Amber when the 2h cache is stale. RED with the REAL error text when a source failed — today an expired
// gh auth renders a perfectly confident dashboard with zero PRs and says nothing.
// §13 — "Copy the JQL" / "Copy the gh command": an engineer who can reproduce a number in a terminal in
// ten seconds argues with the data instead of dismissing the dashboard.
const ago = t => {
  const m = Math.round((Date.now() - Date.parse(t)) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`
}
const asText = v => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(x => (x.jql ? `-- ${x.project}\n${x.jql}` : x.cmd ? `# ${x.project}\n${x.cmd}` : JSON.stringify(x))).join('\n\n') : JSON.stringify(v, null, 2))

export default function Provenance({ snap, onRefresh, busy }) {
  const [open, setOpen] = useState(false)
  const [copy, copied] = useCopy()
  const p = snap.provenance || {}
  const errors = snap.errors || []
  const stale = snap.generatedAt && Date.now() - Date.parse(snap.generatedAt) > (p.ttlMs || 7200000)
  const bad = errors.length > 0
  const c = bad ? RED : stale ? GOLD : 'var(--bg-surface-active)'
  const bg = bad ? 'var(--red-bg)' : stale ? 'var(--amber-bg)' : 'var(--bg-surface)'
  return <div style={{ borderRadius: 6, border: `1px solid ${bad || stale ? c : 'var(--bg-surface-active)'}`, background: bg }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', flexWrap: 'wrap' }}>
      <span style={{ font: `500 11px ${MONO}`, color: bad ? RED : stale ? GOLD : 'var(--text-secondary)' }}>
        {bad ? '✕' : stale ? '⚠' : '●'} JIRA {snap.issues?.length || 0} issues · GitHub {snap.prs?.length || 0} PRs
        {!snap.ghAvailable && ' (gh unavailable — PR panels are EMPTY, not zero)'}
        {' · built '}{snap.generatedAt ? ago(snap.generatedAt) : '—'}{stale ? ' · cache stale' : ''}
      </span>
      {bad && <span style={{ font: `500 11px ${BODY}`, color: RED }}>{errors.length} source error{errors.length > 1 ? 's' : ''}</span>}
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
        <button onClick={() => setOpen(o => !o)} style={{ ...miniBtn, borderColor: bad ? 'var(--red-bg)' : undefined, color: bad ? RED : 'var(--text-primary)' }}>{open ? 'hide' : bad ? 'show error' : 'provenance'}</button>
        <button onClick={onRefresh} disabled={busy} style={{ ...miniBtn, display: 'flex', alignItems: 'center', gap: 6 }}>{busy ? <Spinner size={11} /> : '↻'} refresh</button>
      </span>
    </div>
    {open && <div style={{ borderTop: `1px solid var(--border-default)`, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {errors.map((e, i) => <div key={i} style={{ font: `400 11px ${MONO}`, color: RED, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
        <b>[{e.source}{e.project ? ' · ' + e.project : ''}]</b> {e.message}
      </div>)}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ font: `600 9px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: DIM }}>reproduce it</span>
        <button style={miniBtn} onClick={() => copy(asText(p.jql), 'jql')}>{copied === 'jql' ? '✓ copied' : 'Copy the JQL'}</button>
        <button style={miniBtn} onClick={() => copy(asText(p.ghCommand), 'gh')}>{copied === 'gh' ? '✓ copied' : 'Copy the gh command'}</button>
        <button style={miniBtn} onClick={() => copy(asText(p.graphql), 'gql')}>{copied === 'gql' ? '✓ copied' : 'Copy the GraphQL'}</button>
        <button style={miniBtn} onClick={() => copy(JSON.stringify(snap, null, 2), 'all')}>{copied === 'all' ? '✓ copied' : '{ } whole snapshot'}</button>
      </div>
      <div style={{ font: `400 10px ${MONO}`, color: DIM }}>working time: {p.workingTime || '—'} · cache TTL {Math.round((p.ttlMs || 0) / 60000)}m · every duration on this page is WORKING days, not calendar days.</div>
    </div>}
  </div>
}
