import React, { useEffect, useState } from 'react'
import { api } from './api.js'
import Skeleton from './Skeleton.jsx'

// DEMOTED off the landing page (all four personas):
//   · the 18-week output-token heatmap — a GitHub-green-squares clone measuring TOKEN VOLUME, i.e. a proxy
//     for "was he typing". It is the first panel anyone would screenshot to judge someone. It survives here,
//     on the harness page, where it is what it actually is: a record of your own machine's activity.
//   · tool-usage-all-time bars and most-used-models bars — mildly interesting, never a landing-page question.
const A = '#d97757'
const PROJ_COLORS = ['#5eb3f6', '#3fb96a', '#8b7cf6', '#e8a06a', '#d97757', '#c98bf6']
const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)))

function Bars({ data, unit }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div className="bars">
      {data.map(d => (
        <div className="bar-row" key={d.label} title={`${d.label}: ${fmtTok(d.value)} ${unit}`}>
          <div className="bar-label">{d.label}</div>
          <div className="bar-track"><div className="bar-fill" style={{ width: (d.value / max) * 100 + '%', background: `linear-gradient(90deg, ${d.color || A}, ${d.color || A}cc)` }} /></div>
          <div className="bar-value">{fmtTok(d.value)}</div>
        </div>
      ))}
    </div>
  )
}

export default function UsagePanel() {
  const [usage, setUsage] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { api.get('/api/usage').then(setUsage).catch(e => setErr(e.message)) }, [])
  if (!usage) return err ? <p className="small">{err}</p> : <Skeleton tiles={0} rows={8} />
  const max = Math.max(...usage.daily.map(d => d.out), 1)
  const models = Object.entries(usage.perModel).map(([m, v], i) => ({ label: m.replace(/^claude-/, ''), value: v.msgs, color: PROJ_COLORS[i % PROJ_COLORS.length] })).sort((a, b) => b.value - a.value).slice(0, 5)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel" style={{ marginBottom: 0 }}>
        <div className="panel-head">
          <h3>Activity <span className="muted">output tokens · 18 wks · your machine only</span></h3>
          <div className="heat-legend">less<i style={{ background: 'rgba(255,255,255,0.06)' }} /><i style={{ background: 'rgba(217,119,87,0.35)' }} /><i style={{ background: 'rgba(217,119,87,0.6)' }} /><i style={{ background: 'rgba(217,119,87,0.9)' }} />more</div>
        </div>
        <div className="heat-grid">
          {usage.daily.map(d => {
            const v = d.out / max
            return <div key={d.date} className="heat-cell" title={`${d.date}: ${fmtTok(d.out)} out tok · ${d.msgs} msgs`}
              style={{ background: d.out === 0 ? 'rgba(255,255,255,0.05)' : `rgba(217,119,87,${(0.3 + Math.min(1, Math.pow(v, 0.5)) * 0.6).toFixed(2)})` }} />
          })}
        </div>
        <p className="small">
          This is a token-volume heatmap. It measures how much Claude wrote, which is a proxy for how much you
          typed — <b>not</b> for what shipped. It lives here, not on Overview, on purpose. Nothing about anyone
          else's machine is readable from this app, and no endpoint exists that could make it so.
        </p>
      </div>
      <div className="grid-2" style={{ marginBottom: 0 }}>
        <div className="panel">
          <h3>Tool usage <span className="muted">all time</span></h3>
          <Bars unit="calls" data={usage.tools.map((t, i) => ({ label: t.name.replace(/^mcp__.*__/, 'mcp:'), value: t.count, color: [A, '#e8a06a', '#8b7cf6', '#5eb3f6', '#3fb96a', '#f0b455', '#c98bf6'][i % 7] }))} />
        </div>
        <div className="panel">
          <h3>Most used models <span className="muted">all time</span></h3>
          <Bars data={models} unit="msgs" />
          <p className="small">{fmtTok(usage.totalMsgs)} assistant messages · {usage.activeDays} active days · {usage.streak}-day streak (a fact, not a score)</p>
        </div>
      </div>
    </div>
  )
}
