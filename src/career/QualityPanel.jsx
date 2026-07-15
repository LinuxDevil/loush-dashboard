import React from 'react'
import { PANEL, HEAD, MONO, BODY, ACCENT, MUTE, INK, GREEN, RED, PURPLE, Tile, Ring, MiniTable, Badge, SectionTitle, LoadingPanel, Updating } from './theme.jsx'
import { useEngSelf } from './data.jsx'

const pct = n => Math.round((n || 0) * 100) + '%'
const jiraUrl = i => i.host ? `https://${i.host}/browse/${i.key}` : null
const statusTone = k => k === 'done' || k === 'active' ? 'green' : k === 'wait' ? 'mute' : 'accent'

export default function QualityPanel({ snap }) {
  const { data: eng, loading, revalidating } = useEngSelf()
  const q = snap.quality || {}

  // Claude-side escaped-bug attribution (kept as a secondary signal)
  const claudeAttr = q.attributed || []

  if (loading && !eng) return <LoadingPanel label="Loading engineering metrics… (first load can take up to a minute)" tiles={3} />

  // fall back to the original Claude-only view if the Eng feed can't identify me
  if (!eng?.available || !eng.accountId) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ ...PANEL, color: MUTE, font: `400 12px ${BODY}` }}>
          Engineering-metrics feed {eng?.available ? 'could not match your identity' : 'unavailable'} — showing Claude-side signals only.
          {eng?.reason === 'identity-unresolved' && <> Set your JIRA account in career.json identity.</>}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Tile label="change-fail (escaped)" value={pct(q.changeFailProxy)} sub="escaped defects ÷ my PRs" tone={RED} />
          <Tile label="caught in review" value={pct(q.defectDensityCaughtInReview)} sub="self-verification signal" tone={ACCENT} />
        </div>
      </div>
    )
  }

  const d = eng.dora
  const shipRows = eng.issues.filter(i => i.live && !i.isBug).sort((a, b) => Date.parse(b.closedAt || 0) - Date.parse(a.closedAt || 0)).slice(0, 40)
  const bugRows = eng.issues.filter(i => i.isBug).sort((a, b) => (b.rework || 0) - (a.rework || 0)).slice(0, 40)

  const keyCol = { key: 'key', label: 'ticket', render: i => <a href={jiraUrl(i)} target="_blank" rel="noreferrer" style={{ color: ACCENT, textDecoration: 'none', font: `500 12px ${MONO}` }}>{i.key}</a> }
  const statusCol = { key: 'status', label: 'status', render: i => <Badge tone={statusTone(i.statusKind)}>{i.status}</Badge> }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {revalidating && <Updating show />}
      {/* DORA KPI row */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ ...PANEL, display: 'flex', gap: 18, alignItems: 'center' }}>
          <Ring value={1 - d.changeFailRate} label={pct(d.changeFailRate)} sub="change-fail" color={d.changeFailRate > 0.15 ? RED : GREEN} />
          <div>
            <div style={{ font: `600 13px ${HEAD}`, color: INK }}>{d.escapedBugs} escaped bugs</div>
            <div style={{ font: `400 11px ${BODY}`, color: MUTE, marginTop: 2 }}>of {eng.issues.filter(i => i.live && !i.isBug).length} delivered tickets</div>
          </div>
        </div>
        <Tile label="cycle time (median)" value={`${d.cycleMedian}d`} sub={`avg ${d.cycleAvg}d · In-Progress→Live`} />
        <Tile label="throughput (90d)" value={d.throughput90} sub={`${d.openNow} open now`} tone={GREEN} />
        <Tile label="est. accuracy" value={`${d.estAcc}%`} sub="story-point vs actual" />
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Tile label="PR review rounds" value={d.prReviewRounds} sub="avg cycles to merge" tone={d.prReviewRounds > 2 ? RED : INK} />
        <Tile label="PR merge time" value={`${d.prMergeDays}d`} sub={`first review ${d.prFirstReviewDays}d`} />
        <Tile label="rework" value={d.reworkAvg} sub="avg reopen/back-to-dev per ticket" tone={PURPLE} />
        <Tile label="caught in review (Claude)" value={pct(q.defectDensityCaughtInReview)} sub="self-verification signal" tone={ACCENT} />
      </div>

      {/* my bugs */}
      <div style={PANEL}>
        <SectionTitle right={<span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{bugRows.length} shown</span>}>Bugs on my tickets</SectionTitle>
        <MiniTable
          columns={[keyCol, { key: 'summary', label: 'summary', width: 380, render: i => i.summary }, statusCol,
            { key: 'rework', label: 'rework', align: 'right', render: i => i.rework || 0 }, { key: 'area', label: 'area', render: i => i.area || '—' }]}
          rows={bugRows} empty="no bugs attributed to you — clean" />
        {claudeAttr.length ? <div style={{ font: `400 11px ${MONO}`, color: MUTE, marginTop: 8 }}>+ {claudeAttr.length} Claude-blamed escaped bug(s): {claudeAttr.map(a => a.id).join(', ')}</div> : null}
      </div>

      {/* recent ships */}
      <div style={PANEL}>
        <SectionTitle>Recently delivered</SectionTitle>
        <MiniTable
          columns={[keyCol, { key: 'summary', label: 'summary', width: 380, render: i => i.summary },
            { key: 'delivery', label: 'cycle', align: 'right', render: i => `${i.delivery}d` },
            { key: 'estAcc', label: 'est', align: 'right', render: i => i.estAcc == null ? '—' : `${i.estAcc}%` },
            { key: 'prNums', label: 'PRs', align: 'right', render: i => (i.prNums || []).length || '—' }]}
          rows={shipRows} empty="nothing delivered in window" />
      </div>
    </div>
  )
}
