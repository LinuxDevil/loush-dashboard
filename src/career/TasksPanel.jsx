import React from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, BODY, ACCENT, MUTE, INK, GREEN, PURPLE, RED, Tile, Badge, MiniTable, SectionTitle } from './theme.jsx'
import { useEngSelf } from './data.jsx'

const jiraUrl = i => i.host ? `https://${i.host}/browse/${i.key}` : null
const statusTone = k => k === 'done' || k === 'active' ? 'green' : k === 'wait' ? 'accent' : 'mute'

export default function TasksPanel({ snap, reload }) {
  const tasks = snap.tasks || []
  const risk = (snap.focus || []).filter(f => f.area === 'tasks')
  const { data: eng, loading } = useEngSelf()
  const act = async (f) => { try { await api.post('/api/career/focus/act', { id: f.id, ref: f.evidenceRefs?.[0] }); toast('marked acted-on', 'success'); reload?.() } catch (e) { toast(e.message, 'error') } }

  // JIRA-driven view: my open tickets, at-risk first
  const open = (eng?.issues || []).filter(i => i.active).sort((a, b) => (b.rec?.atRisk ? 1 : 0) - (a.rec?.atRisk ? 1 : 0) || b.inCurrent - a.inCurrent)
  const atRisk = open.filter(i => i.rec?.atRisk)
  const byStatus = {}
  for (const i of open) (byStatus[i.status] ||= []).push(i)

  const keyCol = { key: 'key', label: 'ticket', render: i => <a href={jiraUrl(i)} target="_blank" rel="noreferrer" style={{ color: ACCENT, textDecoration: 'none', font: `500 12px ${MONO}` }}>{i.key}</a> }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {eng?.dora && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Tile label="open tickets" value={open.length} sub="assigned to me" tone={ACCENT} />
          <Tile label="at risk" value={atRisk.length} sub="past expected move date" tone={atRisk.length ? RED : GREEN} />
          <Tile label="shipped (90d)" value={eng.dora.throughput90} sub="delivered" tone={GREEN} />
          <Tile label="cycle (median)" value={`${eng.dora.cycleMedian}d`} sub="In-Progress→Live" />
        </div>
      )}

      {/* Claude-side commitment risk (heuristic) */}
      {risk.length ? (
        <div style={{ ...PANEL, borderColor: '#bc8cff55' }}>
          <SectionTitle>Risk to commitments</SectionTitle>
          {risk.map(f => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
              <div style={{ flex: 1, font: `400 12px ${BODY}`, color: INK }}>{f.message}</div>
              <button onClick={() => act(f)} disabled={!!f.actedOn} style={{ font: `600 11px ${MONO}`, color: f.actedOn ? GREEN : ACCENT, background: 'transparent', border: `1px solid ${f.actedOn ? GREEN : ACCENT}55`, borderRadius: 6, padding: '3px 8px', cursor: f.actedOn ? 'default' : 'pointer' }}>{f.actedOn ? '✓ acted on' : 'mark acted on'}</button>
            </div>
          ))}
        </div>
      ) : null}

      {/* at-risk JIRA tickets with recommendation */}
      {atRisk.length ? (
        <div style={{ ...PANEL, borderColor: '#f8514955' }}>
          <SectionTitle right={<Badge tone="red">{atRisk.length}</Badge>}>At risk — move before due date</SectionTitle>
          {atRisk.slice(0, 8).map(i => (
            <div key={i.key} style={{ padding: '6px 0', borderTop: `1px solid #21262d` }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>{keyCol.render(i)}<Badge tone={statusTone(i.statusKind)}>{i.status}</Badge><span style={{ font: `400 12px ${BODY}`, color: INK }}>{i.summary}</span></div>
              <div style={{ font: `400 11px ${MONO}`, color: RED, marginTop: 2 }}>→ {i.rec?.moveBy ? `move by ${new Date(i.rec.moveBy).toLocaleDateString()}` : 'past SLA'} · {i.inCurrent}d in {i.status}</div>
            </div>
          ))}
        </div>
      ) : null}

      {/* all open, grouped by status */}
      {loading ? <div style={{ ...PANEL, color: MUTE, font: `400 12px ${MONO}` }}>Loading JIRA…</div>
        : eng?.accountId ? Object.entries(byStatus).map(([status, rows]) => (
          <div key={status} style={PANEL}>
            <SectionTitle right={<span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{rows.length}</span>}>{status}</SectionTitle>
            <MiniTable
              columns={[keyCol, { key: 'summary', label: 'summary', width: 420, render: i => i.summary },
                { key: 'inCurrent', label: 'days here', align: 'right', render: i => `${i.inCurrent}d` },
                { key: 'pts', label: 'pts', align: 'right', render: i => i.pts || '—' }]}
              rows={rows} />
          </div>
        )) : (
          // fall back to Claude taskboard buckets
          [['inProgress', 'In progress'], ['toTest', 'To test'], ['pending', 'Pending']].map(([key, label]) => {
            const rows = tasks.filter(t => t.bucket === key)
            return <div key={key} style={PANEL}>
              <SectionTitle right={<span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{rows.length}</span>}>{label}</SectionTitle>
              {rows.length ? rows.map(t => <div key={t.id} style={{ padding: '6px 0', borderTop: `1px solid #21262d`, font: `500 12px ${MONO}`, color: INK }}>{t.id} · {t.title || ''}</div>)
                : <div style={{ font: `400 11px ${MONO}`, color: MUTE }}>empty</div>}
            </div>
          })
        )}
    </div>
  )
}
