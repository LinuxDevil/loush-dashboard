import React from 'react'
import { PANEL, MONO, BODY, ACCENT, MUTE, INK, GREEN, PURPLE, RED, Tile, Bar, SectionTitle } from './theme.jsx'
import { useUsage, useEngSelf } from './data.jsx'
import Analyze from './Analyze.jsx'

const Bars = ({ title, obj, color = ACCENT }) => {
  const rows = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const max = Math.max(1, ...rows.map(r => r[1]))
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ font: `500 10.5px ${MONO}`, color: MUTE, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>{title}</div>
      {rows.length ? rows.map(([key, v]) => (
        <div key={key} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 5 }}>
          <div style={{ width: 150, font: `400 11px ${MONO}`, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{key}</div>
          <Bar v={v} max={max} color={color} h={5} />
          <div style={{ width: 32, textAlign: 'right', font: `500 10.5px ${MONO}`, color: MUTE }}>{v}</div>
        </div>
      )) : <div style={{ font: `400 11px ${MONO}`, color: MUTE }}>no data</div>}
    </div>
  )
}
const pct = n => `${Math.round((n || 0) * 100)}%`

export default function WorkflowPanel({ snap }) {
  const w = snap.workflow || {}
  const gh = snap.github?.reviewFootprint
  const { data: usage } = useUsage()
  const { data: eng } = useEngSelf()
  const models = usage?.perModel || {}
  const d = eng?.dora

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Tile label="one-shot rate" value={pct(w.oneShotRate)} sub="single-task, no interrupts" tone={GREEN} />
        <Tile label="interrupts / session" value={(w.interruptRate || 0).toFixed(1)} sub="lower is smoother" tone={w.interruptRate > 1 ? RED : INK} />
        <Tile label="top friction" value={w.topFriction || '—'} sub="most common blocker" tone={PURPLE} />
        {d && <Tile label="PR review rounds" value={d.prReviewRounds} sub={`merge ${d.prMergeDays}d`} tone={d.prReviewRounds > 2 ? RED : INK} />}
      </div>

      <div style={PANEL}>
        <SectionTitle>How I work with Claude</SectionTitle>
        {/* DEMOTED (roadmap Cut): the friction / helpfulness bars are an LLM's opinion of your session and
            only exist after /insights has run. The deterministic replacement — real tool error RATES and
            real USD — is the Run economics panel above. These stay only as an authoring aid. */}
        <div style={{ font: `400 10.5px ${BODY}`, color: MUTE, marginTop: 4 }}>
          The two bars below are LLM-judged and only populate after <b style={{ color: INK }}>/insights</b> has run.
          The deterministic version of this question — which tools actually fail, and how often — is in <b style={{ color: INK }}>Run economics</b> above.
        </div>
        <Bars title="Friction (what slows me down) — LLM-judged" obj={w.friction} color={PURPLE} />
        <Bars title="Perceived helpfulness — LLM-judged" obj={w.helpfulness} color={GREEN} />
        <Bars title="Model mix" obj={Object.fromEntries(Object.entries(models).map(([m, v]) => [m.replace(/^claude-|-\d.*$/g, ''), v.msgs]))} color={ACCENT} />
        <Bars title="Tool mix" obj={w.tools} />
        {gh && <div style={{ font: `400 12px ${BODY}`, color: MUTE, marginTop: 12 }}>Review footprint: {gh.prsReviewed} PRs reviewed · mentorship for {Object.keys(gh.reviewedForOthers || {}).length} teammates</div>}
        <Analyze panelKey="workflow" payload={{ oneShotRate: w.oneShotRate, interruptRate: w.interruptRate, topFriction: w.topFriction, friction: w.friction, helpfulness: w.helpfulness }} label="✨ Analyze — what to change" />
      </div>
    </div>
  )
}
