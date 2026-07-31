import React, { useEffect, useState } from 'react'
import { api } from '../lib/api.js'

// Three checks that answer "is this installation sound?" — the config linter, the external-format
// contract guard, and the repo complexity/over-engineering audit.
//
// They are on one screen because they share a failure mode: each can examine nothing and report
// success. A linter given no files, a contract check with no samples, and an audit over a window
// too short to judge all produce a green screen that means "not checked". So every panel here
// leads with what was actually examined, and refuses to render a verdict without it.

const MONO = 'var(--mono)'
const SEV = { error: 'var(--red)', warn: 'var(--amber)', warning: 'var(--amber)', info: 'var(--text-secondary)' }

const Bar = ({ tone, children, title }) => (
  <div title={title} style={{ border: `1px solid ${tone}`, borderRadius: 10, padding: '9px 13px', marginBottom: 10, font: '400 12px var(--body)' }}>
    {children}
  </div>
)

function useEndpoint(url) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(true)
  const load = () => { setBusy(true); api.get(url).then(x => { setD(x); setErr(null) }).catch(e => setErr(e.message)).finally(() => setBusy(false)) }
  useEffect(load, [url])
  return { d, err, busy, reload: load }
}

// ---------------------------------------------------------------- config lint

function ConfigLint() {
  const { d, err, busy, reload } = useEndpoint('/api/config/lint')
  if (busy && !d) return <div className="panel"><h3>Config lint</h3><p className="small">reading config files…</p></div>
  if (err) return <div className="panel"><h3>Config lint</h3><p className="small" style={{ color: SEV.error }}>{err}</p></div>

  const c = d.counts || {}
  const cov = d.coverage || {}
  const diags = d.diagnostics || []
  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Config lint</h3>
        <span className="small muted">CLAUDE.md · skills · settings · MCP</span>
        <button className="mini" style={{ marginLeft: 'auto' }} onClick={reload}>recheck</button>
      </div>

      {/* Coverage first, deliberately. "0 problems" over 0 files examined is the failure this
          panel exists to prevent, and it is invisible unless the denominator is on screen. */}
      <Bar tone={d.vacuous ? SEV.error : cov.targetsMissing ? SEV.warn : 'var(--green)'}>
        {d.vacuous
          ? <b>Nothing was linted.</b>
          : <>Examined <b>{cov.targetsParsed}</b> of {cov.targetsRequested} candidate files
            {cov.skillsParsed != null && <> · <b>{cov.skillsParsed}</b> skill(s)</>}
            {cov.targetsMissing > 0 && <> · {cov.targetsMissing} not present</>}
            {cov.targetsUnparseable > 0 && <> · <span style={{ color: SEV.error }}>{cov.targetsUnparseable} unreadable</span></>}</>}
        {d.note && <div className="small" style={{ marginTop: 4 }}>{d.note}</div>}
        {cov.note && !d.note && <div className="small muted" style={{ marginTop: 4 }}>{cov.note}</div>}
      </Bar>

      <div style={{ font: `600 12px ${MONO}` }}>
        <span style={{ color: c.error ? SEV.error : 'var(--text-tertiary)' }}>{c.error || 0} error</span>{' · '}
        <span style={{ color: c.warn ? SEV.warn : 'var(--text-tertiary)' }}>{c.warn || 0} warning</span>{' · '}
        <span className="muted">{c.info || 0} info</span>
      </div>

      {!diags.length && !d.vacuous && <p className="small" style={{ marginTop: 8 }}>No diagnostics across the files that were read.</p>}
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {diags.map((x, i) => (
          <div key={i} style={{ borderLeft: `2px solid ${SEV[x.severity] || SEV.info}`, paddingLeft: 10 }}>
            <div style={{ font: `600 11px ${MONO}`, color: SEV[x.severity] || SEV.info }}>
              {x.id}{x.file && <span className="muted"> · {String(x.file).split('/').slice(-2).join('/')}{x.line != null ? `:${x.line}` : ''}</span>}
            </div>
            <div className="small" style={{ marginTop: 2 }}>{x.message}</div>
            {/* A line we could not locate says so rather than guessing a number. */}
            {x.line == null && x.lineReason && <div className="small muted">no line: {x.lineReason}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- contracts

function Contracts() {
  const { d, err, busy, reload } = useEndpoint('/api/contracts')
  if (busy && !d) return <div className="panel"><h3>Format contracts</h3><p className="small">sampling real files…</p></div>
  if (err) return <div className="panel"><h3>Format contracts</h3><p className="small" style={{ color: SEV.error }}>{err}</p></div>

  const notChecked = d.sourcesNotChecked || []
  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Format contracts</h3>
        <span className="small muted">does Claude Code still emit what we parse?</span>
        <button className="mini" style={{ marginLeft: 'auto' }} onClick={reload}>recheck</button>
      </div>

      <Bar tone={notChecked.length ? SEV.warn : d.ok ? 'var(--green)' : SEV.error}>
        {d.ok ? 'Every declared field was present in the samples read.' : 'A declared field was missing — the transcript format may have changed under us.'}
        {notChecked.length > 0 && (
          <div className="small" style={{ marginTop: 4 }}>
            <b>{notChecked.length} source(s) were NOT checked</b> — no verdict is claimed for them.
          </div>
        )}
      </Bar>

      {/* The raw report is already written to be read by a human; rendering it verbatim keeps the
          UI from paraphrasing away a caveat. */}
      <pre style={{ font: `400 11px ${MONO}`, whiteSpace: 'pre-wrap', margin: 0, color: 'var(--text-secondary)' }}>{d.report}</pre>
    </div>
  )
}

// ---------------------------------------------------------------- complexity

function Complexity() {
  const { d, err, busy, reload } = useEndpoint('/api/repo/complexity')
  if (busy && !d) return <div className="panel"><h3>Repo complexity</h3><p className="small">walking the checkout…</p></div>
  if (err) return <div className="panel"><h3>Repo complexity</h3><p className="small" style={{ color: SEV.error }}>{err}</p></div>

  const dims = d.dimensions || []
  const audit = d.audit || null
  const skipped = d.evidence?.nestedCheckoutsSkipped || []
  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Repo complexity</h3>
        <span style={{ font: `600 13px ${MONO}` }}>{d.score}/{d.scoreOutOf ?? d.maxScore ?? 6}</span>
        <span className="small muted">{d.dimensionsMeasured != null ? `${d.dimensionsMeasured} of ${d.maxScore} dimensions measurable` : ''}</span>
        {d.incompleteNote && <span className="small" style={{ color: SEV.warn }}>{d.incompleteNote}</span>}
        <button className="mini" style={{ marginLeft: 'auto' }} onClick={reload}>recompute</button>
      </div>

      <table style={{ width: '100%', font: `400 11px ${MONO}`, marginTop: 8 }}>
        <tbody>
          {dims.map(x => (
            <tr key={x.key || x.label}>
              <td style={{ color: 'var(--text-secondary)' }} title={x.measuredFrom || x.rationale || undefined}>{x.label || x.key}</td>
              <td className="num" style={{ color: 'var(--text-primary)' }}>{String(x.measured)}</td>
              <td className="num muted">≥ {String(x.threshold)}</td>
              <td className="num" style={{ color: x.met ? 'var(--green)' : 'var(--text-tertiary)' }}>{x.met ? 'met' : '—'}</td>
              <td className="muted" style={{ paddingLeft: 10 }}>{x.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {skipped.length > 0 && (
        <div className="small muted" style={{ marginTop: 6 }}>
          {skipped.length} nested checkout(s) excluded from the count: {skipped.join(', ')}
        </div>
      )}

      {audit && (
        <div style={{ marginTop: 12 }}>
          <div style={{ font: '600 12px var(--head)' }}>Installed vs used</div>
          {/* The load-bearing caveat: a capability with no recorded invocation is NOT proven
              unused. The audit computes provenUnusedCount separately and it is deliberately 0
              unless the observation window can support the claim. */}
          <Bar tone={audit.observationWindow?.tooShortForHabitClaims ? SEV.warn : 'var(--text-tertiary)'}>
            {audit.headline || `${audit.installedCount ?? '?'} installed, ${audit.noRecordedInvocationCount ?? '?'} with no recorded invocation`}
            <div className="small" style={{ marginTop: 4 }}>
              Observation window {audit.observationWindow?.days != null ? `${audit.observationWindow.days.toFixed(2)} days` : 'unknown'}
              {audit.observationWindow?.tooShortForHabitClaims && ' — too short to tell "not needed" from "not needed this week"; treat every zero as "no data yet".'}
            </div>
            {(audit.caveats || []).map((c, i) => (
              <div key={i} className="small" style={{ marginTop: 3, color: SEV.warn }}>{typeof c === 'string' ? c : c.text || c.reason}</div>
            ))}
            {audit.inventoryCompleteness && audit.inventoryCompleteness !== 'complete' && (
              <div className="small" style={{ marginTop: 4, color: SEV.warn }}>
                Inventory is {audit.inventoryCompleteness}: managed/plugin capabilities are not on local disk, so the installed count is a floor, not a total.
              </div>
            )}
          </Bar>
        </div>
      )}
    </div>
  )
}

export default function HealthSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ConfigLint />
      <Contracts />
      <Complexity />
    </div>
  )
}
