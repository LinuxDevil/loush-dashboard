import React, { useState } from 'react';
import { BODY, MONO, HEAD, GREEN, GOLD, RED, DIM, HI, miniBtn, useCopy, Spinner } from './ui.jsx';

const ago = (t) => {
  const m = Math.round((Date.now() - Date.parse(t)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
};
const asText = (v) =>
  v == null
    ? ''
    : typeof v === 'string'
    ? v
    : Array.isArray(v)
    ? v
        .map((x) => (x.jql ? `-- ${x.project}\n${x.jql}` : x.cmd ? `# ${x.project}\n${x.cmd}` : JSON.stringify(x)))
        .join('\n\n')
    : JSON.stringify(v, null, 2);

export default function Provenance({ snap, onRefresh, busy }) {
  const [open, setOpen] = useState(false);
  const [copy, copied] = useCopy();
  const p = snap.provenance || {};
  const errors = snap.errors || [];
  // Age is judged against the actual cache window (p.ttlMs), not a hardcoded threshold. The
  // previous 1h threshold was stricter than the 24h TTL, so data well within the cache window
  // showed "past the 24h refresh window" — misleading users into thinking caching was broken and
  // driving them to click refresh (a 29s blocking live fetch). Now: neutral within TTL, amber
  // past TTL, wording sharpens past TTL + a working day. Red is reserved for source errors.
  const ttlMs = p.ttlMs || 86400000;
  const ageMs = snap.generatedAt ? Date.now() - Date.parse(snap.generatedAt) : null;
  const stale = ageMs != null && ageMs > ttlMs;
  const veryStale = ageMs != null && ageMs > ttlMs + 8 * 3600_000;
  const bad = errors.length > 0;
  const c = bad ? RED : stale ? GOLD : 'var(--bg-surface-active)';
  const bg = bad ? 'var(--red-bg)' : stale ? 'var(--amber-bg)' : 'var(--bg-surface)';
  return (
    <div
      style={{ borderRadius: 6, border: `1px solid ${bad || stale ? c : 'var(--bg-surface-active)'}`, background: bg }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', flexWrap: 'wrap' }}>
        <span style={{ font: `500 11px ${MONO}`, color: bad ? RED : stale ? GOLD : 'var(--text-secondary)' }}>
          {bad ? '✕' : stale ? '⚠' : '●'} JIRA {snap.issues?.length || 0} issues · GitHub {snap.prs?.length || 0} PRs
          {!snap.ghAvailable && ' (gh unavailable — PR panels are EMPTY, not zero)'}
          {' · built '}
          {snap.generatedAt ? ago(snap.generatedAt) : '—'}
          {/* Within TTL the age is expected, not a failure — say so plainly. Past TTL, name the
            window and the escape hatch so the reader knows both how old is too old and what to do. */}
          {!stale && ageMs != null && ` · cached (within ${Math.round(ttlMs / 3600000)}h window)`}
          {stale &&
            ` · ${veryStale ? 'well past' : 'past'} the ${Math.round(
              ttlMs / 3600000
            )}h cache window — refresh for live data`}
        </span>
        {snap.refreshing && (
          <span
            style={{
              font: `500 11px ${MONO}`,
              color: 'var(--text-tertiary)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Spinner size={10} /> refreshing in background…
          </span>
        )}
        {bad && (
          <span style={{ font: `500 11px ${BODY}`, color: RED }}>
            {errors.length} source error{errors.length > 1 ? 's' : ''}
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={() => setOpen((o) => !o)}
            style={{
              ...miniBtn,
              borderColor: bad ? 'var(--red-bg)' : undefined,
              color: bad ? RED : 'var(--text-primary)',
            }}
          >
            {open ? 'hide' : bad ? 'show error' : 'provenance'}
          </button>
          <button
            onClick={onRefresh}
            disabled={busy}
            style={{ ...miniBtn, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {busy ? <Spinner size={11} /> : '↻'} refresh
          </button>
        </span>
      </div>
      {open && (
        <div
          style={{
            borderTop: `1px solid var(--border-default)`,
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {errors.map((e, i) => (
            <div key={i} style={{ font: `400 11px ${MONO}`, color: RED, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              <b>
                [{e.source}
                {e.project ? ' · ' + e.project : ''}]
              </b>{' '}
              {e.message}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ font: `600 9px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: DIM }}>
              reproduce it
            </span>
            <button style={miniBtn} onClick={() => copy(asText(p.jql), 'jql')}>
              {copied === 'jql' ? '✓ copied' : 'Copy the JQL'}
            </button>
            <button style={miniBtn} onClick={() => copy(asText(p.ghCommand), 'gh')}>
              {copied === 'gh' ? '✓ copied' : 'Copy the gh command'}
            </button>
            <button style={miniBtn} onClick={() => copy(asText(p.graphql), 'gql')}>
              {copied === 'gql' ? '✓ copied' : 'Copy the GraphQL'}
            </button>
            <button style={miniBtn} onClick={() => copy(JSON.stringify(snap, null, 2), 'all')}>
              {copied === 'all' ? '✓ copied' : '{ } whole snapshot'}
            </button>
          </div>
          <div style={{ font: `400 10px ${MONO}`, color: DIM }}>
            working time: {p.workingTime || '—'} · cache TTL {Math.round((p.ttlMs || 0) / 60000)}m · every duration on
            this page is WORKING days, not calendar days.
          </div>
        </div>
      )}
    </div>
  );
}
