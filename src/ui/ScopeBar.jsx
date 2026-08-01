import React, { useEffect, useState } from 'react'
import { dataScope, describeScope } from '../lib/dataScope.js'

// ScopeBar — the global data-scope filter, made VISIBLE.
//
// A scope that narrows every aggregate but shows nothing on screen is the worst version of this
// feature: the numbers are right for a scope the reader cannot see, which makes them wrong for the
// one they assume. So this bar always states the active scope in words (including "no filter"), and
// it renders a warning whenever a panel reports that its endpoint does NOT honour part of the scope
// — an aggregate that is wider than its heading is the same lie as a stale response.

const MONO = 'var(--mono)'

/** Subscribe once, re-render on every scope change. Unsubscribes on unmount — no leaked listeners. */
export function useDataScope() {
  const [scope, setScope] = useState(() => dataScope.get())
  useEffect(() => dataScope.subscribe(setScope), [])
  return scope
}

export default function ScopeBar({ projects = [], sources = [], unenforced = null }) {
  const scope = useDataScope()
  const chip = {
    font: `400 11px ${MONO}`, padding: '2px 8px', borderRadius: 999,
    background: scope.isFiltered ? 'var(--accent-bg)' : 'var(--bg-inset)',
    color: scope.isFiltered ? 'var(--accent-light)' : 'var(--text-tertiary)',
    border: '1px solid var(--border-default)',
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={scope.project || ''} onChange={e => dataScope.set({ project: e.target.value || null })} title="narrows every aggregate on this page">
        <option value="">all projects</option>
        {projects.map(p => <option key={p.id ?? p} value={p.id ?? p}>{p.label ?? p.id ?? p}</option>)}
      </select>
      {sources.length > 0 && (
        <select value={scope.source || ''} onChange={e => dataScope.set({ source: e.target.value || null })}>
          <option value="">all sources</option>
          {sources.map(s => <option key={s.id ?? s} value={s.id ?? s}>{s.label ?? s.id ?? s}</option>)}
        </select>
      )}
      {/* The sentence, always — never let a filtered page look global. */}
      <span style={chip}>{scope.describe}</span>
      {scope.isFiltered && <button className="mini" style={{ marginTop: 0 }} onClick={() => dataScope.clear()}>clear filter</button>}
      {unenforced?.length > 0 && (
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--amber)' }}>
          ⚠ this panel does not narrow by {unenforced.join(', ')} — the numbers below are wider than the heading
        </span>
      )}
      {unenforced === null && scope.isFiltered && (
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }} title="the panel did not declare which scope params its endpoint honours">
          scope enforcement unverified
        </span>
      )}
    </div>
  )
}

/** Heading text for a panel — pass the scope a RESULT was fetched under, not the current one. */
export const ScopeHeading = ({ title, scope }) => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
    <span style={{ font: '600 14px var(--head)' }}>{title}</span>
    <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{describeScope(scope || {})}</span>
  </div>
)
