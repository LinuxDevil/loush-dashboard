import React, { useEffect, useState } from 'react'
import { api } from '../lib/api.js'

const MONO = 'var(--mono)'
const HEAD = 'var(--head)'
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12, padding: '16px 18px' }

// lib/design-map.mjs has had no endpoint and no UI since it was added in PR #4 — it could not be
// called at all. It walks a design-system checkout, enumerates its components, harvests the Figma
// node ids its story files claim, and flags collisions where two stories point at the same node.
//
// It sits beside Figma Capture because that is where the design-system config already lives, and
// because the two answer adjacent questions: Capture asks "what does this frame look like", this
// asks "which component in code is that frame supposed to be".
export default function DesignMapSection() {
  const [repo, setRepo] = useState('')
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [only, setOnly] = useState('all')

  // Default to whatever the design-system package resolves to, so the common case needs no typing.
  useEffect(() => { api.get('/api/setup').then(s => { const p = s?.designSystem?.repo || s?.designSystem?.path; if (p) setRepo(p) }).catch(() => {}) }, [])

  const run = () => {
    setBusy(true); setErr(''); setD(null)
    api.get('/api/design-map?repo=' + encodeURIComponent(repo.trim()))
      .then(setD).catch(e => setErr(e.message)).finally(() => setBusy(false))
  }

  const rows = (d?.rows || []).filter(r =>
    only === 'all' || (only === 'unmapped' ? !r.figma : only === 'collisions' ? r.evidence?.collisionWith?.length : true))

  return (
    <div style={{ ...PANEL }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ font: `600 14px ${HEAD}` }}>Design map</div>
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>components in code ↔ the Figma nodes their stories claim</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input value={repo} onChange={e => setRepo(e.target.value)} placeholder="/path/to/design-system-repo"
          onKeyDown={e => { if (e.key === 'Enter' && repo.trim() && !busy) run() }}
          style={{ font: `400 12px ${MONO}`, flex: 1 }} />
        <button onClick={run} disabled={busy || !repo.trim()}>{busy ? 'scanning…' : 'scan'}</button>
      </div>
      {err && <div style={{ font: `400 11px ${MONO}`, color: 'var(--red)', marginBottom: 8 }}>{err}</div>}

      {d && (
        <>
          <div style={{ display: 'flex', gap: 16, font: `400 11px ${MONO}`, marginBottom: 8, flexWrap: 'wrap' }}>
            <span>{d.summary.total} components</span>
            <span style={{ color: 'var(--green)' }}>{d.summary.mapped} mapped</span>
            {/* Unmapped is a state, not a fault: the component exists and no story claims a node
                for it. Naming it that way keeps it from reading as a failure count. */}
            <span style={{ color: 'var(--text-tertiary)' }}>{d.summary.unmapped} unmapped</span>
            {d.summary.collisions > 0 && <span style={{ color: 'var(--red)' }}>{d.summary.collisions} collisions</span>}
            <span style={{ color: 'var(--text-tertiary)' }}>
              {/* buildMap deliberately has no fallback package name — a hardcoded default would be
                  one company's package and silently wrong everywhere else. */}
              import from: {d.importFrom || <em>package unnamed in package.json</em>}
            </span>
            <select value={only} onChange={e => setOnly(e.target.value)} style={{ marginLeft: 'auto' }}>
              <option value="all">all</option>
              <option value="unmapped">unmapped only</option>
              <option value="collisions">collisions only</option>
            </select>
          </div>

          {d.summary.total === 0 && (
            <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>
              No components found under <code>src/components/</code> in that checkout — this expects a
              design-system repo, not an application.
            </div>
          )}

          {rows.length > 0 && (
            <table className="data" style={{ font: `400 11px ${MONO}`, width: '100%' }}>
              <thead><tr><th style={{ textAlign: 'left' }}>component</th><th style={{ textAlign: 'left' }}>figma node</th><th>source</th><th>status</th><th style={{ textAlign: 'left' }}>collides with</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.component}>
                    <td style={{ color: 'var(--text-primary)' }}>{r.component}</td>
                    <td style={{ color: r.figma ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>{r.figma || '—'}</td>
                    <td>{r.source || <span className="muted">—</span>}</td>
                    <td style={{ color: r.status === 'unmapped' ? 'var(--text-tertiary)' : 'var(--accent-light)' }}>{r.status}</td>
                    <td style={{ color: 'var(--red)' }}>{(r.evidence?.collisionWith || []).join(', ') || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}
