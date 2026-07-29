import React, { useEffect, useState } from 'react'
import { api } from '../lib/api.js'

const MONO = 'var(--mono)'
const HEAD = 'var(--head)'
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 12 }

// Everything here reads snapshot.quality, which server/eng.mjs already computes — escape rate,
// area hotspots, ownership concentration and bus factor. None of it was reachable before.
//
// Gated behind the Engineering flag in projects.json, and off by default, because every figure
// depends on the JIRA/GitHub snapshot: without credentials this renders an empty frame rather
// than anything worth reading.
export default function EngineeringSection() {
  const [snap, setSnap] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.get('/api/eng/snapshot').then(setSnap).catch(e => setErr(e.message)) }, [])

  if (err) return <div style={{ ...PANEL, color: 'var(--red)', font: `400 12px ${MONO}` }}>{err}</div>
  if (!snap) return <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>loading snapshot…</div>
  if (snap.available === false) {
    return (
      <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>
        The delivery snapshot is not available{snap.error ? ` — ${snap.error}` : ''}.
        <div style={{ marginTop: 6 }}>These metrics are derived from JIRA and GitHub; configure credentials in Setup first. Nothing here is estimated in their absence.</div>
      </div>
    )
  }
  const q = snap.quality || {}
  return (
    <div className="hx" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Totals totals={q.totals} />
      <EscapeRate series={q.escapeRate} meta={q.escapeMeta} />
      <Hotspots rows={q.hotspots} />
      <Ownership rows={q.ownership} />
    </div>
  )
}

function Totals({ totals }) {
  if (!totals) return null
  const cells = [
    ['bugs', totals.bugs, 'bugs in the window'],
    ['escaped', totals.escaped, 'reached production'],
    ['caught in QA', totals.qaCaught, 'found before release'],
    ['reopened', totals.reopens, 'tickets that went backwards at least once'],
  ]
  return (
    <div style={{ ...PANEL, display: 'flex', gap: 26, flexWrap: 'wrap' }}>
      {cells.map(([label, n, gloss]) => (
        <div key={label} title={gloss}>
          <div style={{ font: `600 20px ${HEAD}`, color: 'var(--text-primary)' }}>{n ?? '—'}</div>
          <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{label}</div>
        </div>
      ))}
    </div>
  )
}

// Escape rate is cohort-correct upstream: an escaped bug counts against the month its PARENT
// shipped, so numerator and denominator describe the same release. It is also the metric most
// likely to be unmeasurable, because it needs bugs linked to the work that caused them — so the
// linkable percentage is shown next to it rather than buried.
function EscapeRate({ series, meta }) {
  if (!series?.length) {
    return (
      <div style={{ ...PANEL, font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>
        <div style={{ font: `600 14px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 6 }}>Escape rate</div>
        No measurable months{meta?.note ? ` — ${meta.note}` : ''}.
      </div>
    )
  }
  const max = Math.max(1, ...series.map(p => p.rate ?? 0))
  return (
    <div style={{ ...PANEL }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 10 }}>
        <div style={{ font: `600 14px ${HEAD}` }}>Escape rate</div>
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>
          bugs that reached production, against the release they came from
          {meta?.linkablePct != null && ` · ${Math.round(meta.linkablePct)}% of bugs were linkable to a parent`}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 90 }}>
        {series.map(p => (
          // A month with no measurable data draws nothing and says so on hover — it is not
          // the same as a month with an escape rate of zero, and drawing it as a zero bar
          // would make an absence look like a success.
          <div key={p.month} title={p.rate == null ? `${p.month}: not measurable` : `${p.month}: ${p.rate}% (${p.escaped}/${p.shipped})`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
            {p.rate == null
              ? <div style={{ height: '100%', borderBottom: '1px dashed var(--border-default)' }} />
              : <div style={{ height: `${(p.rate / max) * 100}%`, background: 'var(--accent-light)', borderRadius: '2px 2px 0 0', minHeight: 2 }} />}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', marginTop: 4 }}>
        <span>{series[0]?.month}</span><span>{series[series.length - 1]?.month}</span>
      </div>
    </div>
  )
}

function Hotspots({ rows }) {
  if (!rows?.length) return null
  return (
    <div style={{ ...PANEL }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 10 }}>
        <div style={{ font: `600 14px ${HEAD}` }}>Area hotspots</div>
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>bugs per area, from the files the fixing PRs touched</span>
      </div>
      <table className="data" style={{ font: `400 11px ${MONO}`, width: '100%' }}>
        <thead><tr><th style={{ textAlign: 'left' }}>area</th><th>bugs</th><th>escaped</th><th>shipped</th><th>bugs / shipped</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.area}>
              <td style={{ color: 'var(--text-secondary)' }}>{r.area}</td>
              <td className="num">{r.bugs}</td>
              <td className="num" style={{ color: r.escaped ? 'var(--red)' : undefined }}>{r.escaped}</td>
              <td className="num">{r.shipped}</td>
              {/* Null when nothing shipped from this area — a ratio with a zero denominator is
                  undefined, not zero, and rendering it as 0.00 would read as "very healthy". */}
              <td className="num">{r.bugsPerShipped == null ? <span className="muted">—</span> : r.bugsPerShipped}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Ownership concentration, per engineer. This is the one panel here that names individuals, so
// the framing is deliberate: rows are AREAS, and the question is "what happens to this area if
// its main contributor is unavailable" — a delivery-risk question about the codebase. Sorting is
// by area volume, never by person, because a table sorted by people is a ranking of people
// whatever it is captioned.
function Ownership({ rows }) {
  const [open, setOpen] = useState(() => new Set())
  if (!rows?.length) return null
  const toggle = a => setOpen(s => { const n = new Set(s); n.has(a) ? n.delete(a) : n.add(a); return n })
  return (
    <div style={{ ...PANEL }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 4 }}>
        <div style={{ font: `600 14px ${HEAD}` }}>Ownership concentration</div>
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>single points of failure by area</span>
      </div>
      <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', marginBottom: 10, lineHeight: 1.6 }}>
        Bus factor is the number of people holding most of an area. It is a staffing risk about the
        codebase, not a measure of anybody's output — ticket counts reflect what people were
        assigned, which is a fact about planning rather than performance.
      </div>
      <table className="data" style={{ font: `400 11px ${MONO}`, width: '100%' }}>
        <thead><tr><th style={{ textAlign: 'left' }}>area</th><th>tickets</th><th>contributors</th><th>bus factor</th><th>top share</th><th /></tr></thead>
        <tbody>
          {rows.map(r => (
            <React.Fragment key={r.area}>
              <tr>
                <td style={{ color: 'var(--text-secondary)' }}>{r.area}</td>
                <td className="num">{r.total}</td>
                <td className="num">{r.contributors}</td>
                {/* null below the minimum sample is "unknown", not "safe" — an area with three
                    tickets has one contributor because it has three tickets. */}
                <td className="num" title={r.busFactorReason || ''} style={{ color: r.busFactor === 1 ? 'var(--red)' : undefined }}>
                  {r.busFactor == null ? <span className="muted">— (n&lt;{r.busFactorMinN})</span> : r.busFactor}
                </td>
                <td className="num">{r.top ? `${r.top.share}%` : '—'}</td>
                <td><button className="mini" style={{ marginTop: 0 }} onClick={() => toggle(r.area)}>{open.has(r.area) ? 'hide' : 'contributors'}</button></td>
              </tr>
              {open.has(r.area) && (
                <tr>
                  <td colSpan={6} style={{ paddingLeft: 18 }}>
                    {r.rows.map(p => (
                      <div key={p.who} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '2px 0' }}>
                        <span style={{ width: 200, color: 'var(--text-secondary)' }}>{p.who}</span>
                        <div style={{ flex: 1, maxWidth: 240, height: 5, background: 'var(--border-subtle)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${p.share}%`, height: '100%', background: p.share >= 70 ? 'var(--red)' : 'var(--accent-light)' }} />
                        </div>
                        <span style={{ color: 'var(--text-tertiary)' }}>{p.n} tickets · {p.share}%</span>
                      </div>
                    ))}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
