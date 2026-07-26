import React, { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'

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

const fmtCost = n => '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 })

export default function UsagePanel() {
  const [usage, setUsage] = useState(null)
  const [err, setErr] = useState(null)
  const [budget, setBudget] = useState(() => Number(localStorage.getItem('dash-monthly-budget')) || '')
  useEffect(() => {
    api.get('/api/usage' + (budget ? `?budget=${budget}` : '')).then(setUsage).catch(e => setErr(e.message))
  }, [budget])
  if (!usage) return err ? <p className="small">{err}</p> : <Skeleton tiles={0} rows={8} />
  const max = Math.max(...usage.daily.map(d => d.out), 1)
  const models = Object.entries(usage.perModel).map(([m, v], i) => ({ label: m.replace(/^claude-/, ''), value: v.msgs, color: PROJ_COLORS[i % PROJ_COLORS.length] })).sort((a, b) => b.value - a.value).slice(0, 5)
  const GRADE_COLOR = { A: '#3fb96a', B: '#8bd450', C: '#e8a06a', D: '#e5a03a', F: '#e5484d' }
  const reg = usage.regression
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {usage.health && (
        <div className="panel" style={{ marginBottom: 0 }}>
          <div className="panel-head"><h3>Harness health <span className="muted">usage efficiency, not config completeness — see Harness ▸ Config for that</span></h3></div>
          <div className="kpi-grid" style={{ margin: '0 16px 12px' }}>
            {/* null grade is "not measured", never a letter. Below MIN_TURNS the factors are noise:
                one turn scored 0/F and a single good day flipped it to A. */}
            <div className="kpi"><div className="kpi-label"><span>score</span></div>
              <div className="kpi-value" style={{ color: usage.health.grade ? GRADE_COLOR[usage.health.grade] : '#8a807a' }}>
                {usage.health.grade
                  ? <>{usage.health.total} <span style={{ fontSize: 14 }}>{usage.health.grade}</span></>
                  : <span style={{ fontSize: 20 }}>—</span>}
              </div>
              <div className="kpi-sub">
                {usage.health.reason === 'insufficient-data'
                  ? `not enough data to grade — ${usage.health.n} of ${usage.health.minN} turns needed`
                  : usage.health.reason === 'no-data' ? 'no usable token history yet'
                  : 'weighted: cost trend, cache efficiency, context efficiency'}
              </div></div>
            {usage.health.factors.map(f => (
              <div className="kpi" key={f.name}><div className="kpi-label"><span>{f.name.replace(/([A-Z])/g, ' $1').toLowerCase()}</span></div>
                <div className="kpi-value" style={{ fontSize: 20 }}>{f.na ? '—' : f.score}</div>
                <div className="kpi-sub">
                  {f.name === 'costTrend' && (f.na ? 'not enough history yet' : `${f.raw.changePct >= 0 ? '+' : ''}${f.raw.changePct}% vs prior 7d`)}
                  {f.name === 'cacheEfficiency' && (f.na ? 'no cache-eligible tokens yet' : `${Math.round(f.raw.ratio * 100)}% of cache-eligible tokens were reads`)}
                  {f.name === 'contextEfficiency' && (f.na ? 'no context observed yet'
                    : `${Math.round(f.raw.ratio * 100)}% of context is always-loaded overhead (assumes ${f.raw.hiddenPerTurn.toLocaleString()} tok/turn — an estimate, editable in settings)`)}
                </div></div>
            ))}
          </div>
          {reg?.regressed && (
            <p className="small" style={{ margin: '0 16px 12px', color: '#e5a03a' }}>
              ⚠ tokens/turn up {reg.tokensPerTurn.deltaPct}% vs last week ({fmtTok(reg.tokensPerTurn.previous)} → {fmtTok(reg.tokensPerTurn.current)}){reg.cause ? ` — likely cause: ${reg.cause}` : ''}
            </p>
          )}
        </div>
      )}
      <div className="grid-2" style={{ marginBottom: 0 }}>
        <div className="panel">
          <div className="panel-head">
            <h3>Month-end cost projection</h3>
            <input placeholder="monthly budget $" value={budget} type="number"
              onChange={e => { const v = e.target.value; setBudget(v); localStorage.setItem('dash-monthly-budget', v) }} style={{ width: 130 }} />
          </div>
          {usage.costProjection ? (
            <>
              <div className="kpi-value" style={{ color: usage.costProjection.overBudget ? '#e5484d' : undefined }}>{fmtCost(usage.costProjection.projected)}</div>
              <div className="kpi-sub">
                {fmtCost(usage.costProjection.monthToDate)} MTD + {fmtCost(usage.costProjection.dailyAvg)}/day × {usage.costProjection.daysRemaining}d remaining
                · confidence: {usage.costProjection.confidence}
              </div>
              {usage.costProjection.diff != null && (
                <p className="small" style={{ color: usage.costProjection.overBudget ? '#e5484d' : '#3fb96a' }}>
                  {usage.costProjection.overBudget ? 'over' : 'under'} budget by {fmtCost(Math.abs(usage.costProjection.diff))}
                </p>
              )}
            </>
          ) : <p className="small">not enough history yet — need ≥3 active days this week</p>}
        </div>
        <div className="panel">
          <h3>Cache TTL impact <span className="muted">rolling 7d hit-rate</span></h3>
          {usage.cacheTtl && (
            <>
              <div className="kpi-value">{usage.cacheTtl.bestEffPct}%<span style={{ fontSize: 14, color: '#8a807a' }}> best · {usage.cacheTtl.worstEffPct}% worst</span></div>
              <div className="kpi-sub">
                est. ${usage.cacheTtl.wasteCost?.toFixed(2)} spent on cache re-writes that a longer cache TTL would have avoided
                (vs. this repo's own best-observed efficiency window)
              </div>
            </>
          )}
        </div>
      </div>
      {usage.anomalies?.length > 0 && (
        <div className="panel" style={{ marginBottom: 0 }}>
          <h3>Usage anomalies <span className="muted">days &gt;2× the trailing baseline — runaway/looping-agent tell</span></h3>
          <table className="data inv">
            <thead><tr><th>Date</th><th>Tokens</th><th>vs baseline</th><th>Cost</th><th>vs baseline</th><th>Kind</th></tr></thead>
            <tbody>
              {usage.anomalies.map(a => (
                <tr key={a.date}>
                  <td className="mono">{a.date}</td><td className="num">{fmtTok(a.tokens)}</td>
                  <td className="num" style={{ color: '#e8a06a' }}>{a.tokenRatio}×</td>
                  <td className="num">${a.cost.toFixed(2)}</td>
                  <td className="num" style={{ color: '#e8a06a' }}>{a.costRatio}×</td>
                  <td className="mono" style={{ color: '#8a807a' }}>{a.kind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
