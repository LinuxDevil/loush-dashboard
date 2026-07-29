import React, { useState } from 'react'


const MONO = 'var(--mono)', HEAD = 'var(--head)'
const mini = { padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer', font: '500 11px var(--body)' }

const Col = ({ title, colour, ids, labelOf, empty }) => (
  <div style={{ flex: 1, minWidth: 170 }}>
    {}
    <div style={{ font: `600 10px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: colour, marginBottom: 6 }}>{title} {ids.length}</div>
    {ids.length === 0
      ? <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>{empty}</div>
      : ids.slice(0, 12).map(id => (
          <div key={id} title={id} style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', padding: '1px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelOf(id)}</div>
        ))}
    {ids.length > 12 && <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>… {ids.length - 12} more</div>}
  </div>
)

export default function RederivePreview({ pending, current, onApply, onDiscard, busy }) {
  const report = pending?.report || { kept: 0, added: 0, dropped: 0, addedIds: [], droppedIds: [] }
  const curById = new Map((current?.nodes || []).map(n => [n.id, n]))
  const newById = new Map((pending?.graph?.nodes || []).map(n => [n.id, n]))
  const labelOf = id => newById.get(id)?.data?.label || curById.get(id)?.data?.label || id

  const mine = (report.droppedIds || []).filter(id => ['user', 'assistant'].includes(curById.get(id)?.data?.origin))
  const [keep, setKeep] = useState(() => new Set(mine))
  const keptIds = (pending?.graph?.nodes || []).map(n => n.id).filter(id => !(report.addedIds || []).includes(id))

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--amber)', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ font: `600 13px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 4 }}>Re-derive from the regenerated document</div>
      <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', marginBottom: 12 }}>
        kept {report.kept} · added {report.added} · dropped {report.dropped} · positions of kept components are preserved, matched by id
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <Col title="kept" colour="var(--text-secondary)" ids={keptIds} labelOf={labelOf} empty="nothing carried over" />
        <Col title="added" colour="var(--green)" ids={report.addedIds || []} labelOf={labelOf} empty="nothing new" />
        <Col title="dropped" colour="var(--red)" ids={report.droppedIds || []} labelOf={labelOf} empty="nothing removed" />
      </div>

      {mine.length > 0 && (
        <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber)', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>
          <div style={{ font: `600 11px ${MONO}`, color: 'var(--text-primary)', marginBottom: 6 }}>
            {mine.length} dropped component{mine.length > 1 ? 's were' : ' was'} yours — kept unless you say otherwise
          </div>
          {mine.map(id => (
            <label key={id} style={{ display: 'flex', gap: 8, alignItems: 'center', font: `400 11px ${MONO}`, color: 'var(--text-secondary)', padding: '1px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={keep.has(id)} style={{ width: 'auto' }}
                onChange={e => setKeep(s => { const n = new Set(s); e.target.checked ? n.add(id) : n.delete(id); return n })} />
              <span>{curById.get(id)?.data?.origin === 'assistant' ? '✦' : '✎'} {labelOf(id)}</span>
            </label>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="primary" disabled={busy} onClick={() => onApply([...keep])}>{busy ? 'applying…' : `Apply${keep.size ? ` · keep ${keep.size}` : ''}`}</button>
        <button style={mini} disabled={busy} onClick={onDiscard}>Keep the current diagram</button>
      </div>
    </div>
  )
}
