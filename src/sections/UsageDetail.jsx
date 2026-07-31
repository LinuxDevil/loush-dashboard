import React, { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import ScopeBar from '../ui/ScopeBar.jsx'

// Three usage views that share one rule: a number nobody measured never renders as a number.
//
//   · an unpriced bucket shows "—", not $0
//   · a rate below its sample floor shows its n and is marked, not hidden
//   · a "you would have saved X" figure is labelled modelled, with the assumption on screen
//
// The last one matters most. It is the figure most likely to be screenshotted, and it is
// arithmetic on tokens another model produced — nobody ran the cheaper model.

const MONO = 'var(--mono)'
const RED = 'var(--red)', AMBER = 'var(--amber)', GREEN = 'var(--green)', DIM = 'var(--text-tertiary)'
const usd = n => (n == null ? '—' : '$' + n.toFixed(2))
const pct = n => (n == null ? '—' : (n * 100).toFixed(1) + '%')
const tok = n => (n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n))

function useEndpoint(url) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(true)
  useEffect(() => { setBusy(true); api.get(url).then(x => { setD(x); setErr(null) }).catch(e => setErr(e.message)).finally(() => setBusy(false)) }, [url])
  return { d, err, busy }
}

// ---------------------------------------------------------------- tool efficiency

function ToolEfficiency() {
  const { d, err, busy } = useEndpoint('/api/usage/tool-efficiency')
  if (busy && !d) return <div className="panel"><h3>Tool efficiency</h3><p className="small">scanning transcripts…</p></div>
  if (err) return <div className="panel"><h3>Tool efficiency</h3><p className="small" style={{ color: RED }}>{err}</p></div>
  const tools = d.tools || []
  const sc = d.scanned || {}
  return (
    <div className="panel">
      <h3 style={{ marginBottom: 4 }}>Tool efficiency <span className="muted small">success rate and cost per useful result</span></h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        {sc.files} of {sc.filesAvailable} transcript file(s){sc.malformedLines ? ` · ${sc.malformedLines} malformed line(s) skipped` : ''}{sc.truncated ? ' · scan hit its cap' : ''}
      </p>
      <table style={{ width: '100%', font: `400 11px ${MONO}` }}>
        <thead><tr style={{ color: DIM, textAlign: 'right' }}>
          <th style={{ textAlign: 'left' }}>tool</th><th>calls</th><th>ok</th><th>fail</th><th>unresolved</th><th>success</th><th>out bytes</th>
        </tr></thead>
        <tbody>
          {tools.map(t => (
            <tr key={t.name} style={{ textAlign: 'right', opacity: t.lowSample ? 0.65 : 1 }}
              title={t.lowSample ? `only ${t.calls} call(s) — below the sample floor, so this rate is noise; shown rather than hidden` : undefined}>
              <td style={{ textAlign: 'left', color: 'var(--text-primary)' }}>{t.name}{t.lowSample && <span style={{ color: AMBER }}> ⚠</span>}</td>
              <td>{t.calls}</td>
              <td style={{ color: GREEN }}>{t.success}</td>
              <td style={{ color: t.failure ? RED : DIM }}>{t.failure}</td>
              {/* A call with no matching result is a THIRD state. Counting it as either success or
                  failure moves the rate in a direction nobody measured. */}
              <td style={{ color: t.unresolved ? AMBER : DIM }}>{t.unresolved}</td>
              <td>{pct(t.successRate)}</td>
              <td>{t.meanOutputBytes == null ? '—' : tok(Math.round(t.meanOutputBytes))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.bounds?.note && <p className="small" style={{ color: AMBER, marginBottom: 0 }}>{d.bounds.note}</p>}
      {tools.some(t => t.lowSample) && <p className="small muted" style={{ marginBottom: 0 }}>⚠ marks a tool below the sample floor — its rate is shown but should not be read as a trend.</p>}
    </div>
  )
}

// ---------------------------------------------------------------- buckets

function Buckets() {
  const [family, setFamily] = useState(false)
  const { d, err, busy } = useEndpoint('/api/usage/buckets' + (family ? '?familyFallback=1' : ''))
  if (busy && !d) return <div className="panel"><h3>Usage by tier</h3><p className="small">pricing entries…</p></div>
  if (err) return <div className="panel"><h3>Usage by tier</h3><p className="small" style={{ color: RED }}>{err}</p></div>
  const t = d.totals || {}
  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Usage by tier</h3>
        <span className="small muted">model · speed · geo · service tier</span>
        <label className="small" style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={family} onChange={e => setFamily(e.target.checked)} />
          guess unknown models from their family
        </label>
      </div>
      <p className="small muted" style={{ marginTop: 4 }}>
        {usd(t.pricedUsd)} priced · coverage {pct(t.coverage)}{t.complete ? '' : ' — incomplete'}
        {t.estimated && <span style={{ color: AMBER }}> · contains estimated rates{t.maxUnderstatementUsd ? `, understated by at most ${usd(t.maxUnderstatementUsd)}` : ''}</span>}
      </p>
      {t.unpricedReasons && Object.keys(t.unpricedReasons).length > 0 && (
        <p className="small" style={{ color: AMBER, marginTop: 0 }}>
          not priced: {Object.entries(t.unpricedReasons).map(([k, v]) => `${v}× ${k}`).join(', ')} — missing from the total, not zero
        </p>
      )}
      <table style={{ width: '100%', font: `400 11px ${MONO}` }}>
        <thead><tr style={{ color: DIM, textAlign: 'right' }}>
          <th style={{ textAlign: 'left' }}>model</th><th>speed</th><th>geo</th><th>tier</th><th>entries</th><th>tokens</th><th>cost</th>
        </tr></thead>
        <tbody>
          {(d.buckets || []).map((b, i) => (
            <tr key={i} style={{ textAlign: 'right' }}>
              <td style={{ textAlign: 'left', color: 'var(--text-primary)' }}>{b.model || '—'}</td>
              <td className="muted">{b.speed}</td><td className="muted">{b.inference_geo}</td><td className="muted">{b.service_tier}</td>
              <td>{b.entries}</td><td>{tok(b.tokens)}</td>
              {/* cost is null unless EVERY entry in the bucket priced; a partial sum is exposed
                  under partialCost so it cannot be mistaken for the whole. */}
              <td style={{ color: b.cost == null ? AMBER : 'var(--text-primary)' }}
                title={b.cost == null ? `${b.unpricedEntries} of ${b.entries} entries could not be priced${b.partialCost != null ? ` — the priced part comes to ${usd(b.partialCost)}` : ''}` : undefined}>
                {b.cost == null ? (b.partialCost != null ? `≥ ${usd(b.partialCost)}` : '—') : usd(b.cost)}
                {b.estimated && <span style={{ color: AMBER }}> ~</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.bounds?.note && <p className="small" style={{ color: AMBER, marginBottom: 0 }}>{d.bounds.note}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- subagents

const CANDIDATES = ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5']

function Subagents() {
  const [reprice, setReprice] = useState('')
  const { d, err, busy } = useEndpoint('/api/usage/subagents' + (reprice ? `?repriceAs=${encodeURIComponent(reprice)}` : ''))
  if (busy && !d) return <div className="panel"><h3>Subagents</h3><p className="small">rolling up…</p></div>
  if (err) return <div className="panel"><h3>Subagents</h3><p className="small" style={{ color: RED }}>{err}</p></div>
  const t = d.totals || {}
  const s = d.savings
  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Subagents</h3>
        <span className="small muted">{t.agents} subagent(s) · {t.turns} turns · {usd(t.cost)}</span>
        <label className="small" style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          re-price at
          <select value={reprice} onChange={e => setReprice(e.target.value)}>
            <option value="">(off)</option>
            {CANDIDATES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </div>
      {d.attribution && <p className="small" style={{ color: AMBER }}>{d.attribution}</p>}
      {d.note && <p className="small" style={{ color: AMBER }}>{d.note}</p>}

      {s && (
        <div style={{ border: `1px solid ${AMBER}`, borderRadius: 10, padding: '9px 13px', margin: '8px 0' }}>
          <div style={{ font: `600 11px ${MONO}`, color: AMBER }}>MODELLED — not measured</div>
          {s.ok ? (
            <>
              <div className="small" style={{ marginTop: 3 }}>
                {usd(s.actualCost)} actual vs {usd(s.modelledCost)} at {s.candidate} over {s.comparableTurns} comparable turn(s)
                {' → '}
                <b style={{ color: s.wouldCostMore ? RED : GREEN }}>
                  {s.wouldCostMore ? `would cost ${usd(Math.abs(s.modelledSaving))} MORE` : `${usd(s.modelledSaving)} less`}
                </b>
                {s.modelledSavingPct != null && ` (${s.modelledSavingPct.toFixed(0)}%)`}
              </div>
              <div className="small muted" style={{ marginTop: 3 }}>{s.assumption}</div>
              {s.caveat && <div className="small" style={{ color: AMBER }}>{s.caveat}</div>}
            </>
          ) : <div className="small" style={{ marginTop: 3 }}>{s.detail || s.reason}</div>}
        </div>
      )}

      <table style={{ width: '100%', font: `400 11px ${MONO}` }}>
        <thead><tr style={{ color: DIM, textAlign: 'right' }}>
          <th style={{ textAlign: 'left' }}>agent</th><th>turns</th><th>tokens</th><th>cost</th><th style={{ textAlign: 'left', paddingLeft: 12 }}>dominant model</th>
        </tr></thead>
        <tbody>
          {(d.agents || []).slice(0, 25).map((a, i) => (
            <tr key={i} style={{ textAlign: 'right' }}>
              <td style={{ textAlign: 'left', color: a.isMain ? 'var(--text-primary)' : 'var(--blue)' }}>{a.isMain ? 'main thread' : a.agent.slice(0, 12)}</td>
              <td>{a.turns}</td><td>{tok(a.tokens)}</td>
              <td style={{ color: a.cost == null ? AMBER : 'var(--text-primary)' }}
                title={a.cost == null ? 'no turn in this agent could be priced — that is not the same as free' : a.costComplete ? undefined : `${a.unpricedTurns} turn(s) unpriced, so this is a floor`}>
                {a.cost == null ? '—' : (a.costComplete ? usd(a.cost) : `≥ ${usd(a.cost)}`)}
              </td>
              {/* dominantShare travels with the label: a 40%-dominant model describes less than
                  half the agent, and the label is worse than useless without it. */}
              <td style={{ textAlign: 'left', paddingLeft: 12 }} className="muted"
                title={a.mixedModel ? `mixed-model agent — this label covers ${(a.dominantShare * 100).toFixed(0)}% of its tokens` : undefined}>
                {a.dominantModel || '—'}
                {a.mixedModel && <span style={{ color: AMBER }}> ({(a.dominantShare * 100).toFixed(0)}%)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function UsageDetail() {
  const [projects, setProjects] = useState([])
  useEffect(() => { api.get('/api/projects').then(ps => setProjects((ps || []).map(p => ({ id: p.path, label: p.name })))).catch(() => {}) }, [])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 045: the active scope is shown, not just applied. A filtered aggregate that looks global
          is a wrong number, and `unenforced` names the panels below that do NOT yet honour the
          scope — better to admit the gap than to imply a filter that is not happening. */}
      <ScopeBar projects={projects} unenforced={['tool efficiency', 'usage by tier', 'subagents']} />
      <ToolEfficiency />
      <Buckets />
      <Subagents />
    </div>
  )
}
