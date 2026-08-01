import React, { useMemo } from 'react'
import { Card, Empty, TicketLink, initials, HEAD, BODY, MONO, BB, GREEN, GOLD, RED, PURPLE, DIM, HI, TXT } from './ui.jsx'
import { MIN_N, fx } from './stats.js'
import { metricsFor, buildRadars } from './memberMetrics.mjs'

// ---------- Per-member insight cards + charts (Members tab) ----------
export { metricsFor, buildRadars } from './memberMetrics.mjs'

// ---------- Radar (hexagon) — 0.5 ring = the median teammate ----------
function Radar({ axes, size = 210, lowN }) {
  const c = size / 2, R = c - 34, n = axes.length
  const pt = (i, r) => { const a = -Math.PI / 2 + (i / n) * 2 * Math.PI; return [c + Math.cos(a) * r * R, c + Math.sin(a) * r * R] }
  const poly = rs => rs.map((r, i) => pt(i, r).join(',')).join(' ')
  const shape = axes.map(a => a.pct == null ? 0.5 : a.pct)
  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      {[0.25, 0.5, 0.75, 1].map(r => (
        <polygon key={r} points={poly(axes.map(() => r))} fill="none"
          strokeWidth={r === 0.5 ? 1 : 0.75} strokeDasharray={r === 0.5 ? '3 3' : ''}  style={{ stroke: (r === 0.5 ? 'var(--amber-bg)' : 'var(--bg-surface-active)') }} />
      ))}
      {axes.map((a, i) => { const [x, y] = pt(i, 1); return <line key={i} x1={c} y1={c} x2={x} y2={y}  style={{ stroke: 'var(--text-secondary)' }} /> })}
      <polygon points={poly(shape)} strokeWidth={1.5}  style={{ fill: (lowN ? 'var(--bg-surface-active)' : 'var(--violet-bg)'), stroke: (lowN ? DIM : PURPLE) }} />
      {axes.map((a, i) => {
        const [x, y] = pt(i, a.pct == null ? 0.5 : a.pct)
        const [lx, ly] = pt(i, 1.16)
        return <g key={a.key}>
          <circle cx={x} cy={y} r={a.pct == null ? 2 : 3}  style={{ fill: (a.pct == null ? DIM : PURPLE) }} />
          <text x={lx} y={ly} fontSize={8.5} fontFamily={MONO}
            textAnchor={lx < c - 8 ? 'end' : lx > c + 8 ? 'start' : 'middle'} dominantBaseline="middle" style={{ fill: (a.raw == null ? DIM : 'var(--text-secondary)') }}>
            {a.label}{a.raw != null ? '' : ' ·'}
          </text>
        </g>
      })}
    </svg>
  )
}

function Throughput({ shipped, reopened, win }) {
  const bars = useMemo(() => {
    const WK = 7 * 86400000, out = []
    const span = Math.max(WK, win.to - win.from), weeks = Math.min(12, Math.max(3, Math.round(span / WK)))
    for (let w = 0; w < weeks; w++) {
      const a = win.to - (weeks - w) * WK, b = a + WK
      const inWk = shipped.filter(i => { const t = Date.parse(i.liveAt || i.closedAt || 0); return t > a && t <= b })
      out.push({ n: inWk.length, bad: inWk.filter(i => i.rework > 0).length })
    }
    return out
  }, [shipped, win])
  const max = Math.max(1, ...bars.map(b => b.n))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 60 }}>
      {bars.map((b, i) => (
        <div key={i} title={`${b.n} shipped${b.bad ? ` · ${b.bad} reworked` : ''}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
          <div style={{ height: (b.n / max) * 100 + '%', minHeight: b.n ? 3 : 0, borderRadius: 3, background: b.bad ? RED : GREEN }} />
        </div>
      ))}
    </div>
  )
}

function recFor(i) {
  if (i.rec?.atRisk) return { c: RED, t: `Overdue in ${i.status} — move to ${i.rec.next} now (${fx(Math.abs(i.rec.remaining))}d over budget)` }
  if (i.active && !(i.prNums || []).length) return { c: BB, t: 'No PR yet — open one to unblock review' }
  if (i.waitDays > i.activeDays && i.waitDays > 1) return { c: GOLD, t: `Waiting on review/QA (${fx(i.waitDays)}d) — chase the reviewer, not the code` }
  if ((i.qaCycles || 0) > 1) return { c: GOLD, t: `${i.qaCycles} QA rounds — tighten AC before the next hand-off` }
  if (i.rec) return { c: GREEN, t: `On track — move to ${i.rec.next} by ${new Date(i.rec.moveBy).toLocaleDateString([], { month: 'short', day: 'numeric' })}` }
  return { c: DIM, t: 'On track — nothing flagged' }
}

const Tile = ({ label, v, c = HI, sub }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ font: `600 16px ${MONO}`, color: c }}>{v}</div>
    <div style={{ font: `600 8px ${MONO}`, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{label}</div>
    {sub && <div style={{ font: `400 9px ${MONO}`, color: DIM }}>{sub}</div>}
  </div>
)

export function MemberCard({ name, m, radar, active, onClick }) {
  const top = m.focus[0] || m.inFlight[0]
  return (
    <button onClick={onClick} style={{ textAlign: 'left', cursor: 'pointer', padding: 14, border: `1px solid ${active ? 'var(--violet-bg)' : 'var(--bg-surface-active)'}`, borderRadius: 8, background: active ? 'var(--violet-bg)' : 'var(--bg-surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 11 }}>
        <div style={{ width: 30, height: 30, borderRadius: 6, background: 'var(--bg-surface-active)', color: 'var(--bg-surface-active)', display: 'grid', placeItems: 'center', font: `700 11px ${HEAD}`, flexShrink: 0 }}>{initials(name)}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: `600 13px ${BODY}`, color: HI, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
          <div style={{ font: `400 10px ${MONO}`, color: DIM }}>{m.shipped.length} shipped · {m.pts} pts</div>
        </div>
        {m.atRisk.length > 0 && <span style={{ marginLeft: 'auto', font: `700 8px ${MONO}`, padding: '2px 6px', borderRadius: 5, background: 'var(--red-bg)', color: RED }}>{m.atRisk.length} at risk</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 10 }}>
        <Tile label="Open" v={m.open.length} c={BB} />
        <Tile label="Flight" v={m.inFlight.length} c={PURPLE} />
        <Tile label="Bugs" v={m.bugs.length} c={m.bugs.length ? GOLD : DIM} />
        <Tile label="PRs" v={m.merged.length} c={m.merged.length ? GREEN : DIM} />
      </div>
      <div style={{ font: `400 10px ${MONO}`, color: DIM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {top ? <><span style={{ color: BB }}>{top.key}</span> {top.summary}</> : 'nothing in flight'}
      </div>
    </button>
  )
}

export function MemberDetail({ name, m, radar, win }) {
  const strong = radar.filter(a => a.pct != null && a.pct >= 0.66).sort((a, b) => b.pct - a.pct)
  const weak = radar.filter(a => a.pct != null && a.pct <= 0.34).sort((a, b) => a.pct - b.pct)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.3fr)', gap: 14 }}>
      <Card>
        <div style={{ font: `600 12px ${HEAD}`, color: HI, marginBottom: 2 }}>Skills radar <span style={{ font: `400 10px ${MONO}`, color: DIM }}>vs team · {win.label}</span></div>
        <div style={{ display: 'flex', justifyContent: 'center' }}><Radar axes={radar} lowN={m.lowN} /></div>
        <div style={{ font: `400 9px ${MONO}`, color: DIM, textAlign: 'center', marginTop: -6 }}>
          dashed ring = median teammate · outward = ahead of team · <span style={{ color: DIM }}>·</span> = too little data
        </div>
        {m.lowN && <div style={{ font: `400 10px ${BODY}`, color: GOLD, marginTop: 8 }}>⚠ Under {MIN_N} shipped tickets this window — read the shape as a hint, not a verdict.</div>}
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {strong.length > 0 && <div style={{ font: `400 11px ${BODY}`, color: TXT }}><b style={{ color: GREEN }}>Strengths:</b> {strong.map(a => `${a.label} (${a.fmt(a.raw)})`).join(' · ')}</div>}
          {weak.length > 0 && <div style={{ font: `400 11px ${BODY}`, color: TXT }}><b style={{ color: GOLD }}>Focus on:</b> {weak.map(a => `${a.label} (${a.fmt(a.raw)})`).join(' · ')}</div>}
          {!strong.length && !weak.length && <div style={{ font: `400 11px ${BODY}`, color: DIM }}>Middle of the pack on every axis this window — no standout strength or gap.</div>}
        </div>
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Card>
          <div style={{ font: `600 12px ${HEAD}`, color: HI, marginBottom: 8 }}>Weekly throughput <span style={{ font: `400 10px ${MONO}`, color: DIM }}>green = clean · amber/red = reworked</span></div>
          <Throughput shipped={m.shipped} win={win} />
          <div style={{ display: 'flex', gap: 22, marginTop: 12, flexWrap: 'wrap' }}>
            <Tile label="Cycle p50/p90" v={m.cyc.n ? `${fx(m.cyc.p50)}/${fx(m.cyc.p90)}d` : '—'} c={m.cyc.n < MIN_N ? DIM : HI} sub={`n=${m.cyc.n}`} />
            <Tile label="Rework" v={m.reworkRate == null ? '—' : Math.round(m.reworkRate * 100) + '%'} c={m.reopened.length ? GOLD : DIM} sub={`${m.reopened.length} of ${m.shipped.length}`} />
            <Tile label="3+ QA rounds" v={m.qaHeavy.length} c={m.qaHeavy.length ? GOLD : DIM} />
            <Tile label="PR merge p50" v={m.prMerge.n ? fx(m.prMerge.p50) + 'd' : '—'} c={m.prMerge.n < MIN_N ? DIM : HI} sub={`n=${m.prMerge.n}`} />
            <Tile label="Est acc p50" v={m.est.n ? fx(m.est.p50, 0) + '%' : '—'} c={m.est.n < MIN_N ? DIM : HI} sub={`n=${m.est.n}`} />
          </div>
        </Card>

        <Card>
          <div style={{ font: `600 12px ${HEAD}`, color: HI, marginBottom: 8 }}>This sprint — to finish <span style={{ font: `400 10px ${MONO}`, color: DIM }}>recommended next move per ticket</span></div>
          {m.focus.length === 0 ? <Empty text="No committed, unfinished tickets in the active sprint." /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {[...m.focus].sort((a, b) => (b.rec?.atRisk ? 1 : 0) - (a.rec?.atRisk ? 1 : 0) || (b.inCurrent || 0) - (a.inCurrent || 0)).slice(0, 8).map(i => {
                const r = recFor(i)
                return (
                  <div key={i.key} style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
                    <TicketLink i={i} style={{ font: `600 11px ${MONO}`, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, font: `400 11px ${BODY}`, color: TXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.summary}</span>
                    <span style={{ font: `400 10px ${MONO}`, color: r.c, flexShrink: 0, maxWidth: '52%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.t}>{r.t}</span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
