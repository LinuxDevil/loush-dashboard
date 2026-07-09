import React, { useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, MONO, BODY, ACCENT, MUTE, INK, GREEN, RED, PURPLE, Tile, Badge, MiniTable, SectionTitle, LoadingPanel, Updating } from './theme.jsx'
import { Kanban, TrendChart, HeaderPills } from './charts.jsx'
import { useEngSelf, cycleTrend } from './data.jsx'
import { JiraRetro } from './TicketRetroPanel.jsx'

const jiraUrl = i => i.host ? `https://${i.host}/browse/${i.key}` : null
// board column order + accent, mirroring the Eng dashboard
const COLS = [
  ['To Do', '#7f8ea1'], ['In Progress', '#58a6ff'], ['In Code Review', '#bc8cff'], ['Code review', '#bc8cff'],
  ['Ready for QA', '#e3b341'], ['In QA', '#e3b341'], ['Design QA', '#f2a2c4'], ['Reopen', '#f85149'],
]

export default function TasksPanel({ snap, reload }) {
  const risk = (snap.focus || []).filter(f => f.area === 'tasks')
  const { data: eng, loading, revalidating } = useEngSelf()
  const [retro, setRetro] = useState(null)
  const act = async (f) => { try { await api.post('/api/career/focus/act', { id: f.id, ref: f.evidenceRefs?.[0] }); toast('marked acted-on', 'success'); reload?.() } catch (e) { toast(e.message, 'error') } }

  if (loading && !eng) return <LoadingPanel label="Loading JIRA delivery data… (first load can take up to a minute)" />
  if (!eng?.accountId) {
    return <div style={{ ...PANEL, color: MUTE, font: `400 12px ${BODY}` }}>Engineering feed {eng?.available ? 'could not match your identity' : 'unavailable'} — no JIRA tickets to show.</div>
  }

  const open = eng.issues.filter(i => i.active)
  const atRisk = open.filter(i => i.rec?.atRisk).sort((a, b) => b.inCurrent - a.inCurrent)
  const seen = new Set()
  const columns = COLS.map(([title, color]) => ({ title, color, items: open.filter(i => i.status === title) }))
    .filter(c => { c.items.forEach(i => seen.add(i.key)); return c.items.length })
  const other = open.filter(i => !seen.has(i.key))
  if (other.length) columns.push({ title: 'Other', color: MUTE, items: other })
  const trend = cycleTrend(eng.issues)
  const shipRows = eng.issues.filter(i => i.live).sort((a, b) => Date.parse(b.closedAt || 0) - Date.parse(a.closedAt || 0)).slice(0, 30)
  const d = eng.dora

  const keyCol = { key: 'key', label: 'ticket', render: i => <a href={jiraUrl(i)} target="_blank" rel="noreferrer" style={{ color: ACCENT, textDecoration: 'none', font: `500 12px ${MONO}` }}>{i.key}</a> }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <HeaderPills items={[[open.length, 'in progress', ACCENT], [atRisk.length, 'at risk', atRisk.length ? RED : GREEN], [d.throughput90, 'shipped / 90d', GREEN], [(eng.prs || []).length, 'PRs', PURPLE]]} />
        <Updating show={revalidating} />
      </div>

      {/* KPI + trend */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignContent: 'start' }}>
          <Tile label="cycle (median)" value={`${d.cycleMedian}d`} sub={`avg ${d.cycleAvg}d`} />
          <Tile label="est accuracy" value={`${d.estAcc}%`} sub="pts vs actual" tone={GREEN} />
          <Tile label="open" value={open.length} sub="assigned" tone={ACCENT} />
          <Tile label="rework" value={d.reworkAvg} sub="per ticket" tone={d.reworkAvg > 0.5 ? PURPLE : INK} />
        </div>
        <TrendChart series={trend} title="Cycle-time trend" unit="d" invertDelta height={180} />
      </div>

      {/* Claude commitment risk */}
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

      {/* at-risk tickets */}
      {atRisk.length ? (
        <div style={{ ...PANEL, borderColor: '#f8514955' }}>
          <SectionTitle right={<Badge tone="red">{atRisk.length}</Badge>}>At risk — move before due date</SectionTitle>
          {atRisk.slice(0, 8).map(i => (
            <div key={i.key} style={{ padding: '6px 0', borderTop: `1px solid #21262d` }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>{keyCol.render(i)}<Badge tone="accent">{i.status}</Badge><span style={{ font: `400 12px ${BODY}`, color: INK }}>{i.summary}</span></div>
              <div style={{ font: `400 11px ${MONO}`, color: RED, marginTop: 2 }}>→ {i.rec?.moveBy ? `move by ${new Date(i.rec.moveBy).toLocaleDateString()}` : 'past SLA'} · {i.inCurrent}d in {i.status}</div>
            </div>
          ))}
        </div>
      ) : null}

      {/* kanban active work */}
      <div style={PANEL}>
        <SectionTitle right={<span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{open.length} active · hover a card for detail</span>}>Active work · in progress now</SectionTitle>
        <Kanban columns={columns} />
      </div>

      {/* delivered → click for retro */}
      <div style={{ display: 'grid', gridTemplateColumns: retro ? '1fr 1fr' : '1fr', gap: 16 }}>
        <div style={PANEL}>
          <SectionTitle>Recently delivered · click for retro</SectionTitle>
          <MiniTable
            columns={[keyCol, { key: 'summary', label: 'summary', width: 320, render: i => i.summary },
              { key: 'delivery', label: 'cycle', align: 'right', render: i => `${i.delivery}d` },
              { key: 'rework', label: 'rework', align: 'right', render: i => i.rework || 0 }]}
            rows={shipRows} onRowClick={setRetro} />
        </div>
        {retro && <div style={PANEL}><SectionTitle right={<button onClick={() => setRetro(null)} style={{ font: `400 12px ${MONO}`, color: MUTE, background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>}>Retro</SectionTitle><JiraRetro i={retro} /></div>}
      </div>
    </div>
  )
}
