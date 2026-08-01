import React, { useMemo, useState } from 'react'
import { ACTIVITY, COLUMNS, buildSessionCards, searchCards, sessionsForFile } from '../../lib/session-cards.mjs'

// SessionCards — sessions as kanban cards, with the session↔file link clickable in both directions.
//
// Everything honest about this view lives in lib/session-cards.mjs; this file only renders it. The
// two rules it must not break:
//   1. a card with `fileCount === null` NEVER renders a number — it renders "file activity not
//      recorded", because "0 files" is a claim about a measurement that was not taken,
//   2. a capped list always renders its cap next to the true total, so nobody reads 25 as "all".

const MONO = 'var(--mono)'
const CARD = { background: 'var(--bg-inset)', border: '1px solid var(--bg-surface-hover)', borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }
const Meta = ({ children, color = 'var(--text-tertiary)' }) => <span style={{ font: `400 11px ${MONO}`, color }}>{children}</span>
const fmtAge = ms => (ms == null ? '—' : ms < 3600_000 ? Math.round(ms / 60_000) + 'm' : ms < 86400_000 ? Math.round(ms / 3600_000) + 'h' : Math.round(ms / 86400_000) + 'd')

function FileActivity({ card, onFile }) {
  if (card.activity === ACTIVITY.UNRECORDED)
    return <Meta color="var(--amber)" title={card.reason}>file activity not recorded</Meta>
  if (card.activity === ACTIVITY.RECORDED_EMPTY)
    return <Meta title={card.reason}>0 files touched (measured)</Meta>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Meta color="var(--text-secondary)">{card.fileCount} file{card.fileCount === 1 ? '' : 's'} touched</Meta>
      {card.files.map(f => (
        <span key={f} onClick={e => { e.stopPropagation(); onFile?.(f) }} title={`who else touched ${f}?`}
          style={{ font: `400 10px ${MONO}`, color: 'var(--accent-light)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</span>
      ))}
      {/* the cap, stated next to the true total — never a bare truncated list */}
      {card.filesCapped && <Meta color="var(--amber)" title={card.filesCapped.reason}>+{card.filesCapped.hidden} more not listed (cap {card.filesCapped.cap} of {card.filesCapped.total})</Meta>}
    </div>
  )
}

export default function SessionCards({ sessions, fileActivity, now }) {
  const [q, setQ] = useState('')
  const [file, setFile] = useState('')
  const built = useMemo(() => buildSessionCards(sessions, fileActivity, { now }), [sessions, fileActivity, now])
  const found = useMemo(() => searchCards(built, { text: q || undefined, file: file || undefined }), [built, q, file])
  const reverse = file ? sessionsForFile(built, file) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="filter sessions — id, project, branch, path" style={{ flex: 1, minWidth: 220 }} />
        {file && <button className="mini" style={{ marginTop: 0 }} onClick={() => setFile('')}>✕ file: {file}</button>}
        {/* the board states what it is showing, always */}
        <Meta>{found.describe}</Meta>
      </div>

      {built.caps.cards && <Meta color="var(--amber)">{built.caps.cards.reason}</Meta>}
      {built.totals.unrecorded > 0 && (
        <Meta color="var(--amber)">
          {built.totals.unrecorded} of {built.totals.cards} session(s) have NO file-activity record — they are on the board, and they are excluded from the {built.totals.filesTouched}-file total ({built.totals.filesTouchedBasis})
        </Meta>
      )}
      {reverse && (
        <div style={{ ...CARD, background: 'var(--bg-surface)' }}>
          <Meta color="var(--text-primary)">{reverse.total} session(s) touched {file}</Meta>
          {reverse.sessions.map(s => <Meta key={s.sessionId}>{s.sessionId.slice(0, 8)} · {s.project || 'no project'} · {s.branch || 'no branch'}</Meta>)}
          {reverse.capped && <Meta color="var(--amber)">{reverse.capped.reason}</Meta>}
          {reverse.reason && <Meta color="var(--amber)">{reverse.reason}</Meta>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', alignItems: 'flex-start' }}>
        {COLUMNS.map(col => {
          const cards = found.matched.filter(c => c.column === col.id)
          return (
            <div key={col.id} style={{ minWidth: 230, flex: '1 0 230px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ font: `600 10px ${MONO}`, color: col.id === 'unknown' ? 'var(--amber)' : 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }} title={col.hint}>
                {col.label} <span style={{ color: 'var(--text-tertiary)' }}>{cards.length}</span>
              </div>
              {cards.map(c => (
                <div key={c.sessionId} style={CARD}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ font: `600 11px ${MONO}`, color: 'var(--text-primary)' }}>{c.sessionId.slice(0, 8)}</span>
                    <Meta>{c.project || 'no project'}</Meta>
                    <Meta color={c.columnReason ? 'var(--amber)' : 'var(--text-tertiary)'} title={c.columnReason || undefined}>
                      {c.columnReason ? 'no timestamp' : fmtAge(c.ageMs)}
                    </Meta>
                  </div>
                  <Meta>{c.branch || 'no branch'}{c.cost == null ? ' · cost not recorded' : ` · $${c.cost.toFixed(2)}`}{c.toolCalls == null ? '' : ` · ${c.toolCalls} tools`}</Meta>
                  {c.cwdReason && <Meta color="var(--amber)" title={c.cwdReason}>no cwd recorded</Meta>}
                  <FileActivity card={c} onFile={setFile} />
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {found.uncertain.length > 0 && (
        <Meta color="var(--amber)">
          {found.uncertain.length} session(s) could not be ruled out by this file filter — {found.uncertain[0].reason}
        </Meta>
      )}
    </div>
  )
}
