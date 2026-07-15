import React, { useState } from 'react'
import { PANEL, MONO, BODY, ACCENT, MUTE, INK, GREEN, PURPLE, Tile, Bar, MiniTable, Sparkline, SectionTitle } from './theme.jsx'
import { useUsage } from './data.jsx'

const k = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n || 0)

const Hist = ({ title, obj, color = ACCENT }) => {
  const rows = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const max = Math.max(1, ...rows.map(r => r[1]))
  return (
    <div>
      <div style={{ font: `500 10.5px ${MONO}`, color: MUTE, textTransform: 'uppercase', letterSpacing: '0.6px', margin: '10px 0 5px' }}>{title}</div>
      {rows.length ? rows.map(([key, v]) => (
        <div key={key} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
          <div style={{ width: 130, font: `400 10.5px ${MONO}`, color: INK }}>{key}</div>
          <Bar v={v} max={max} color={color} h={5} />
          <div style={{ width: 30, textAlign: 'right', font: `500 10.5px ${MONO}`, color: MUTE }}>{v}</div>
        </div>
      )) : <div style={{ font: `400 11px ${MONO}`, color: MUTE }}>no data</div>}
    </div>
  )
}
const Harness = ({ h }) => {
  const col = h.score >= 75 ? GREEN : h.score >= 50 ? ACCENT : PURPLE
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ font: `700 22px ${MONO}`, color: col }}>{h.score}</div>
        <div style={{ font: `500 11px ${MONO}`, color: MUTE }}>harness score (re-detected each refresh)</div>
      </div>
      {(h.fixes || []).map(f => <div key={f.id} style={{ font: `400 11px ${BODY}`, color: INK, marginTop: 4 }}>→ <b style={{ color: col }}>{f.title}:</b> {f.detail}</div>)}
    </div>
  )
}

export default function InsightsProjectPanel({ snap }) {
  const projects = snap.projects || []
  const [sel, setSel] = useState('')
  const p = sel ? projects.find(x => x.path === sel) : null
  const nar = snap.insights?.narrative || {}
  const narEmpty = nar.error || (!nar.wins?.length && !nar.atAGlance?.working)
  const { data: usage } = useUsage()
  const kpi = usage?.kpis || {}
  const daily = usage?.daily || []

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* machine-wide activity overview from the Claude dashboard */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Tile label="active days" value={usage?.activeDays ?? '—'} sub={`${usage?.streak || 0}-day streak`} tone={GREEN} />
        <Tile label="sessions (30d)" value={kpi.sessions30 ?? '—'} sub={`${projects.length} projects`} />
        <Tile label="lines (7d)" value={`+${k(kpi.lines7d?.add || 0)}`} sub={`−${k(kpi.lines7d?.del || 0)}`} tone={GREEN} />
        <Tile label="output (30d)" value={k(daily.slice(-30).reduce((s, d) => s + (d.out || 0), 0))} sub="tokens" spark={daily.slice(-30).map(d => d.out || 0)} />
      </div>

      {/* top tools + projects table */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={PANEL}>
          <SectionTitle>Top tools</SectionTitle>
          {(usage?.tools || []).length ? (usage.tools).map(t => {
            const max = usage.tools[0].count
            return <div key={t.name} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
              <div style={{ width: 90, font: `400 11px ${MONO}`, color: INK }}>{t.name}</div>
              <Bar v={t.count} max={max} color={ACCENT} />
              <div style={{ width: 44, textAlign: 'right', font: `500 11px ${MONO}`, color: MUTE }}>{k(t.count)}</div>
            </div>
          }) : <div style={{ font: `400 11px ${MONO}`, color: MUTE }}>no data</div>}
        </div>
        <div style={PANEL}>
          <SectionTitle>Projects</SectionTitle>
          <MiniTable
            columns={[
              { key: 'name', label: 'project', render: x => x.name || x.path.split('-').pop() },
              { key: 'sessions', label: 'sessions', align: 'right' },
              { key: 'running', label: 'live', align: 'right', render: x => x.running ? '●' : '' }]}
            rows={[...projects].sort((a, b) => b.sessions - a.sessions).slice(0, 10)} maxHeight={220} />
        </div>
      </div>

      {/* per-project /insights breakdown */}
      <div style={PANEL}>
        <select value={sel} onChange={e => setSel(e.target.value)} style={{ font: `500 12px ${MONO}`, background: '#0d1117', color: INK, border: `1px solid ${MUTE}55`, borderRadius: 8, padding: '6px 10px' }}>
          <option value="">All projects ({projects.length})</option>
          {projects.map(x => <option key={x.path} value={x.path}>{x.path.split('-').pop()} · {x.sessions} sessions</option>)}
        </select>
        {p ? <div style={{ marginTop: 12 }}>{p.harness && <Harness h={p.harness} />}<Hist title="Outcomes" obj={p.outcomes} color={GREEN} /><Hist title="Friction" obj={p.friction} color={PURPLE} /><Hist title="Languages" obj={p.languages} /><Hist title="Tools" obj={p.tools} /></div>
          : <div style={{ font: `400 12px ${MONO}`, color: MUTE, marginTop: 8 }}>Pick a project to see its /insights breakdown.</div>}
      </div>

      <div style={PANEL}>
        <SectionTitle>/insights narrative</SectionTitle>
        {narEmpty ? <div style={{ font: `400 12px ${BODY}`, color: MUTE }}>No parsed narrative — run <code>/insights</code> in Claude Code, then ↻ refresh.</div>
          : <div style={{ display: 'grid', gap: 8 }}>
            {nar.atAGlance?.working && <div style={{ font: `400 12px ${BODY}`, color: GREEN }}><b>Working:</b> {nar.atAGlance.working}</div>}
            {nar.atAGlance?.hindering && <div style={{ font: `400 12px ${BODY}`, color: PURPLE }}><b>Hindering:</b> {nar.atAGlance.hindering}</div>}
            {(nar.wins || []).slice(0, 3).map((w, i) => <div key={i} style={{ font: `400 12px ${BODY}`, color: INK }}>🏆 {w.title}</div>)}
          </div>}
      </div>
    </div>
  )
}
