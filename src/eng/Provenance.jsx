import React, { useState } from 'react'
import { BODY, MONO, HEAD, GREEN, GOLD, RED, DIM, HI, miniBtn, useCopy, Spinner } from './ui.jsx'

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
  // Age is judged on its own threshold, NOT on the cache window. Keying the warning to ttlMs
  // meant raising that window silently made this indicator less sensitive — at a 24h window,
  // data twenty hours old rendered as current. The refresh policy is an operational choice; how
  // old data has to be before a reader should be told is a separate question, so: amber past an
  // hour, and the wording sharpens past a working day. The strip stays amber rather than going
  // red, because red here means a source ERROR — stale data is not the same failure and
  // conflating them would make both easier to ignore. The exact age is always printed.
  const AGE_WARN_MS = 3600_000, AGE_BAD_MS = 8 * 3600_000
  const ageMs = snap.generatedAt ? Date.now() - Date.parse(snap.generatedAt) : null
  const stale = ageMs != null && ageMs > AGE_WARN_MS
  const veryStale = ageMs != null && ageMs > AGE_BAD_MS
  const bad = errors.length > 0
  const c = bad ? RED : stale ? GOLD : 'var(--bg-surface-active)'
  const bg = bad ? 'var(--red-bg)' : stale ? 'var(--amber-bg)' : 'var(--bg-surface)'
  return <div style={{ borderRadius: 6, border: `1px solid ${bad || stale ? c : 'var(--bg-surface-active)'}`, background: bg }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', flexWrap: 'wrap' }}>
      <span style={{ font: `500 11px ${MONO}`, color: bad ? RED : stale ? GOLD : 'var(--text-secondary)' }}>
        {bad ? '✕' : stale ? '⚠' : '●'} JIRA {snap.issues?.length || 0} issues · GitHub {snap.prs?.length || 0} PRs
        {!snap.ghAvailable && ' (gh unavailable — PR panels are EMPTY, not zero)'}
        {' · built '}{snap.generatedAt ? ago(snap.generatedAt) : '—'}
        {/* Say how long the window is, so "built 6h ago" is readable as expected rather than
            broken — and name the escape hatch instead of leaving the reader stuck with it. */}
        {stale && ` · ${veryStale ? 'well past' : 'past'} the ${Math.round((p.ttlMs || 0) / 3600000) || '?'}h refresh window — hit refresh for live data`}
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
