import React, { useEffect, useMemo, useState } from 'react'
import Hub from '../ui/Hub.jsx'
import Skeleton from '../ui/Skeleton.jsx'
import { api, toast } from '../lib/api.js'

// ---------- 2: Delivery ----------
// The Engineering Metrics dashboard that used to be the first tab here is DELETED — its per-metric panels
// (Attention Queue, Review flow, Quality, Investment, Predictability, Epics, CI, Load, Export) and the
// whole src/eng/ tree are gone. What remains reads the same /api/eng/snapshot directly: the idea→prod
// funnel (11), the cohort AI ROI (8), DORA and the 1:1 prep card (15).
const MONO = "var(--mono)"
const HEAD = "var(--head)"
const RED = 'var(--red)', GOLD = 'var(--amber)', GREEN = 'var(--green)', BLUE = 'var(--blue)', PURPLE = 'var(--violet)', DIM = 'var(--text-secondary)'
const d1 = n => (n == null ? '—' : (Math.round(n * 10) / 10).toFixed(1))
const pctl = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * q))] }

const useSnap = () => {
  const [s, setS] = useState(null)
  useEffect(() => { api.get('/api/eng/snapshot?project=all').then(setS).catch(e => setS({ available: false, reason: e.message })) }, [])
  return s
}
const NotWired = ({ s }) => (
  <div className="panel"><h3>Delivery <span className="muted">not configured</span></h3>
    <p className="small" style={{ marginTop: 0 }}>{s?.reason || s?.error || 'JIRA credentials / gh auth are not wired'} — nothing is fabricated here.</p></div>
)

export default function DeliverySection() {
  return (
    <Hub items={[
      { label: 'Idea → prod funnel', el: <Funnel /> },
      { label: 'AI ROI', el: <Roi /> },
      { label: 'DORA', el: <Dora /> },
      { label: '1:1 prep', el: <OneOnOne /> },
    ]} />
  )
}

// ---------- 11: idea→prod funnel — with the QUEUE half included ----------
// If lead time is 30d and cycle time is 6d, no amount of AI coding speed matters. The gap is the point.
const QUEUE = ['PM Backlog', 'Backlog', 'To Do', 'On Hold']
const ACTIVE = ['In Progress', 'In Code Review', 'Code review', 'Design QA', 'Ready for QA', 'in QA (dev)', 'In QA', 'QA Blocked', 'Reopen', 'Ready for Release']

function Funnel() {
  const S = useSnap()
  const f = useMemo(() => {
    if (!S?.available) return null
    const cut = Date.now() - 90 * 86400_000
    const shipped = (S.issues || []).filter(i => i.live && i.closedAt && Date.parse(i.closedAt) >= cut)
    const stage = name => {
      const v = shipped.map(i => (i.daysIn || {})[name]).filter(n => typeof n === 'number' && n > 0)
      return { name, n: v.length, p50: pctl(v, 0.5), p90: pctl(v, 0.9) }
    }
    const q = QUEUE.map(stage).filter(s => s.n)
    const a = ACTIVE.map(stage).filter(s => s.n)
    const lead = shipped.map(i => i.leadDays).filter(n => typeof n === 'number')
    const cyc = shipped.map(i => i.delivery).filter(n => typeof n === 'number')
    const leadP50 = pctl(lead, 0.5), cycP50 = pctl(cyc, 0.5)
    return { shipped: shipped.length, q, a, leadP50, leadP90: pctl(lead, 0.9), cycP50, cycP90: pctl(cyc, 0.9), gap: leadP50 != null && cycP50 != null ? leadP50 - cycP50 : null }
  }, [S])

  if (!S) return <Skeleton tiles={2} rows={8} />
  if (!S.available) return <NotWired s={S} />
  if (!f.shipped) return <div className="panel"><h3>Idea → prod funnel</h3><p className="small" style={{ marginTop: 0 }}>nothing shipped in the last 90 days — no funnel to draw. This is a real zero, not a fabricated one.</p></div>

  // Scale by the p50 max, NOT the p90 max: one stage with a 1,841-day p90 tail (a ticket that sat in PM
  // Backlog for five years) otherwise squashes every real bar to a single pixel. The p90 ghost clamps at
  // full width and says so in the label — the tail is stated, not drawn to scale.
  const max = Math.max(...[...f.q, ...f.a].map(s => s.p50 || 0), 1)
  const Row = ({ s, color }) => {
    const p90w = Math.min(100, (s.p90 / max) * 100)
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 155px', gap: 10, alignItems: 'center', padding: '5px 0' }}>
        <span style={{ font: `400 12px ${MONO}`, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
        <div style={{ position: 'relative', height: 18, background: 'var(--bg-surface-hover)', borderRadius: 6 }}>
          <div title={`p90 ${d1(s.p90)}d${p90w >= 100 ? ' — off the scale' : ''}`} style={{ position: 'absolute', inset: 0, width: p90w + '%', background: color + '33', borderRadius: 6 }} />
          <div title={`p50 ${d1(s.p50)}d`} style={{ position: 'absolute', inset: 0, width: Math.max(2, (s.p50 / max) * 100) + '%', background: color, borderRadius: 6, opacity: 0.9 }} />
        </div>
        <span style={{ font: `500 11px ${MONO}`, color: DIM }}>p50 <b style={{ color }}>{d1(s.p50)}d</b> · p90 <b style={{ color: s.p90 > max ? RED : DIM }}>{d1(s.p90)}d</b> · n={s.n}</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel" style={{ marginBottom: 0 }}>
        <h3>Lead time vs cycle time <span className="muted">{f.shipped} tickets shipped · 90d · working days</span></h3>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><div style={{ font: `700 20px ${HEAD}`, color: 'var(--text-primary)' }}>{d1(f.leadP50)}d</div><div style={{ font: `400 11px ${MONO}`, color: DIM }}>LEAD (created → live) · p90 {d1(f.leadP90)}d</div></div>
          <div style={{ font: `600 18px ${HEAD}`, color: DIM }}>−</div>
          <div><div style={{ font: `700 20px ${HEAD}`, color: BLUE }}>{d1(f.cycP50)}d</div><div style={{ font: `400 11px ${MONO}`, color: DIM }}>CYCLE (first In Progress → live) · p90 {d1(f.cycP90)}d</div></div>
          <div style={{ font: `600 18px ${HEAD}`, color: DIM }}>=</div>
          <div><div style={{ font: `700 20px ${HEAD}`, color: f.gap > f.cycP50 ? RED : GOLD }}>{d1(f.gap)}d</div><div style={{ font: `400 11px ${MONO}`, color: DIM }}>TIME IT SAT WAITING ON US</div></div>
          <p className="small" style={{ flex: 1, minWidth: 240, marginTop: 0 }}>
            If the queue half is bigger than the active half, no amount of AI coding speed moves the number a
            stakeholder feels. Here it is <b style={{ color: f.gap > f.cycP50 ? RED : GOLD }}>{f.cycP50 ? Math.round((f.gap / f.cycP50) * 100) : 0}%</b> of cycle time.
          </p>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 0 }}>
        <div className="panel">
          <h3>Queue stages <span className="muted">waiting on nobody in particular</span></h3>
          {f.q.map(s => <Row key={s.name} s={s} color={GOLD} />)}
          {!f.q.length && <p className="small" style={{ marginTop: 0 }}>no queue time recorded</p>}
        </div>
        <div className="panel">
          <h3>Active stages <span className="muted">someone is on the hook</span></h3>
          {f.a.map(s => <Row key={s.name} s={s} color={BLUE} />)}
        </div>
      </div>
      <p className="small">Bars: solid = p50, ghost = p90, scaled to the largest p50 — a p90 in red ran off the end of the chart and is printed instead of drawn. Working days only (10:00–18:00 Sun–Thu). Means are deliberately absent: the mean is the number that hides the escalation.</p>
    </div>
  )
}

// ---------- 8: AI ROI — COHORT LEVEL ONLY ----------
// The endpoint drops the author/assignee field before aggregating. There is no per-person view here and
// the server physically cannot produce one. Correlational, not causal. n<5 is greyed. Unattributed % is stated.
function Roi() {
  const [d, setD] = useState(null)
  useEffect(() => { api.get('/api/roi?days=90').then(setD).catch(e => setD({ available: false, reason: e.message })) }, [])
  if (!d) return <Skeleton tiles={3} rows={8} />
  if (!d.available) return <div className="panel"><h3>AI ROI</h3><p className="small" style={{ marginTop: 0 }}>{d.reason} — no snapshot, no numbers.</p></div>
  const h = d.headline
  const pts = d.trend.filter(t => t.perPoint != null)
  const max = Math.max(...pts.map(t => t.perPoint), 1)

  const Cell = ({ c, field, fmt = d1 }) => (
    <td className="num" style={{ color: c.n === 0 ? DIM : c.low ? 'var(--text-tertiary)' : 'var(--text-primary)' }}
      title={c.low ? `n=${c.n} — fewer than 5 tickets. Greyed on purpose: this cell is noise.` : `n=${c.n}`}>
      {c.n === 0 ? '—' : fmt(c[field])}{c.low && c.n > 0 ? <span style={{ fontSize: 9, marginLeft: 3 }}>n={c.n}</span> : ''}
    </td>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="kpi-grid" style={{ marginBottom: 0 }}>
        <div className="kpi"><div className="kpi-label"><span>AI $ per shipped point</span><span className="kpi-tag" style={{ background: 'var(--bg-surface-hover)', color: DIM }}>90d</span></div>
          <div className="kpi-value">${h.spendPerPoint ?? '—'}</div>
          <div className="kpi-sub">${h.spend.toLocaleString()} spend ÷ {h.shippedPoints} points</div></div>
        <div className="kpi"><div className="kpi-label"><span>rework rate</span><span className="kpi-tag" style={{ background: 'var(--bg-surface-hover)', color: DIM }}>90d</span></div>
          <div className="kpi-value" style={{ color: h.reworkRate > 0.25 ? GOLD : undefined }}>{h.reworkRate == null ? '—' : Math.round(h.reworkRate * 100) + '%'}</div>
          <div className="kpi-sub">{h.reworkedTickets} of {h.shippedTickets} shipped tickets bounced back (reopened / re-entered In Progress)</div></div>
        <div className="kpi"><div className="kpi-label"><span>unattributed spend</span></div>
          <div className="kpi-value" style={{ color: h.unattributedPct > 0.4 ? GOLD : undefined }}>{Math.round(h.unattributedPct * 100)}%</div>
          <div className="kpi-sub">on branches that map to no ticket — the honest denominator</div></div>
        <div className="kpi"><div className="kpi-label"><span>tickets with AI spend</span></div>
          <div className="kpi-value">{h.ticketsWithSpend}</div>
          <div className="kpi-sub">of {h.shippedTickets} pointed tickets shipped</div></div>
        <div className="kpi"><div className="kpi-label"><span>shipped, unpointed</span></div>
          <div className="kpi-value" style={{ color: DIM }}>{h.unpointedShipped}</div>
          <div className="kpi-sub">carry no story points — they cannot enter a bucket, so they are named instead of hidden</div></div>
      </div>

      <div className="panel" style={{ marginBottom: 0 }}>
        <h3>$ per point <span className="muted">weekly · {d.days}d</span></h3>
        <p className="small" style={{ marginTop: 0 }}>Read this against the rework rate above — cheap, fast points mean little if they bounce back. Rework is the quality guardrail on this number.</p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 110 }}>
          {pts.map(t => (
            <div key={t.week} title={`${t.week}: $${t.perPoint}/pt · $${t.spend} · ${t.points} pts`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
              <div style={{ width: '100%', height: (t.perPoint / max) * 90 + 'px', background: `linear-gradient(180deg, ${PURPLE}, ${PURPLE}77)`, borderRadius: 5 }} />
              <span style={{ font: `400 9px ${MONO}`, color: 'var(--text-tertiary)' }}>{t.week.slice(5)}</span>
            </div>
          ))}
          {!pts.length && <p className="small">no week has both spend and shipped points</p>}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 0 }}>
        <h3>AI-touched vs untouched <span className="muted">by story-point bucket · cohorts, never people</span></h3>
        <table className="data inv">
          <thead><tr>
            <th>Bucket</th>
            <th className="num" colSpan={3} style={{ color: PURPLE }}>AI-touched (cycle · QA cycles · rework)</th>
            <th className="num" colSpan={3} style={{ color: DIM }}>Untouched (cycle · QA cycles · rework)</th>
          </tr></thead>
          <tbody>
            {d.cohort.map(c => (
              <tr key={c.bucket}>
                <td className="mono" style={{ color: 'var(--text-primary)' }}>{c.bucket} pts</td>
                <Cell c={c.aiTouched} field="medianCycleDays" />
                <Cell c={c.aiTouched} field="medianQaCycles" />
                <Cell c={c.aiTouched} field="reworkRate" fmt={v => (v == null ? '—' : Math.round(v * 100) + '%')} />
                <Cell c={c.untouched} field="medianCycleDays" />
                <Cell c={c.untouched} field="medianQaCycles" />
                <Cell c={c.untouched} field="reworkRate" fmt={v => (v == null ? '—' : Math.round(v * 100) + '%')} />
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small" style={{ color: GOLD }}>⚠ {d.caveat}</p>
        <p className="small">Cells with n&lt;5 are greyed — they are noise and should not be argued with. "AI-touched" means touched by <b>this machine's</b> Claude; harness telemetry is self-only, so it cannot mean anything else.</p>
      </div>
    </div>
  )
}

// ---------- DORA four keys — with 2023 Google Cloud benchmark bands ----------
// Two of the four keys are genuinely measurable from what this repo collects (JIRA + GitHub PRs); the
// other two are NOT, and are rendered as explicit "no data source" cards rather than faked from a proxy.
// - Lead time: PR open→merge p50/p90 (working days) — already computed in review.mergeTime.
// - Deploy frequency: merges to the default branch, trailing 30d → per-week rate. Labeled "merges to main",
//   NOT "deploys" — there is no deploy pipeline wired, so calling it deployment count would be fabrication.
// - Change failure rate + MTTR: no deploy-event or incident feed exists anywhere in the repo. Shown blank.
// Bands are the DORA report's calendar-time ballpark; ours are WORKING days, so an elite lead-time reading
// is if anything conservative. Cohort-level only by construction — no per-person split.
const DORA_BANDS = [{ key: 'Elite', color: GREEN }, { key: 'High', color: BLUE }, { key: 'Medium', color: GOLD }, { key: 'Low', color: RED }]
const DEPLOY_SEGS = ['multiple/day', '≥1/week', '≥1/month', '<1/month']
const LEAD_SEGS = ['<1 day', '<1 week', '<1 month', '>1 month']
const CFR_SEGS = ['0–15%', '16–30%', '31–45%', '46–60%']
const MTTR_SEGS = ['<1 hr', '<1 day', '<1 week', '>1 week']
const deployBand = pw => pw == null ? null : pw >= 7 ? 0 : pw >= 1 ? 1 : pw >= 0.23 ? 2 : 3 // 0.23/wk ≈ 1/month
const leadBand = d => d == null ? null : d < 1 ? 0 : d < 7 ? 1 : d < 30 ? 2 : 3
const LOW_N = 5 // mirror the n<5 suppression the Roi/Funnel tabs use — a band off 3 PRs is noise

function BandStrip({ segs, active }) {
  const dead = active == null
  return (
    <div style={{ display: 'flex', gap: 3, marginTop: 12 }}>
      {DORA_BANDS.map((b, i) => {
        const on = active === i
        return (
          <div key={b.key} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ height: 6, borderRadius: 3, background: dead ? 'var(--bg-surface-hover)' : on ? b.color : b.color + '2e' }} />
            <div style={{ font: `600 9px ${MONO}`, letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 4, color: dead ? 'var(--text-tertiary)' : on ? b.color : DIM }}>{b.key}</div>
            <div style={{ font: `400 9px ${MONO}`, color: dead ? 'var(--text-tertiary)' : 'var(--text-tertiary)' }}>{segs[i]}</div>
          </div>
        )
      })}
    </div>
  )
}

function DoraCard({ title, tag, value, unit, sub, segs, active, low, body }) {
  const dead = active == null && !low
  const valColor = dead || low ? 'var(--text-tertiary)' : (active != null ? DORA_BANDS[active].color : 'var(--text-primary)')
  return (
    <div className="panel" style={{ marginBottom: 0 }}>
      <h3>{title} <span className="muted">{tag}</span></h3>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ font: `700 20px ${HEAD}`, color: valColor }}>{value}</span>
        {unit && <span style={{ font: `500 12px ${MONO}`, color: DIM }}>{unit}</span>}
      </div>
      {sub && <div style={{ font: `400 11px ${MONO}`, color: DIM, marginTop: 2 }}>{sub}</div>}
      <BandStrip segs={segs} active={active} />
      {body && <p className="small" style={{ marginTop: 12, marginBottom: 0 }}>{body}</p>}
    </div>
  )
}

function Dora() {
  const S = useSnap()
  const d = useMemo(() => {
    if (!S?.available) return null
    const cut = Date.now() - 30 * 86400_000
    const merged = (S.prs || []).filter(p => p.state === 'Merged' && p.mergedAt)
    const toMain = merged.filter(p => p.baseRefName && p.defaultBranch && p.baseRefName === p.defaultBranch && Date.parse(p.mergedAt) >= cut)
    const perWeek = toMain.length / (30 / 7)
    const lt = S.review?.mergeTime || {}
    const ltN = merged.filter(p => typeof p.mergeDays === 'number').length
    return { deployN: toMain.length, perWeek, ltP50: lt.p50, ltP90: lt.p90, ltN }
  }, [S])

  if (!S) return <Skeleton tiles={4} rows={4} />
  if (!S.available) return <NotWired s={S} />

  const deployLow = d.deployN < LOW_N
  const leadLow = d.ltN < LOW_N

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="grid-2" style={{ marginBottom: 0 }}>
        <DoraCard
          title="Deployment frequency" tag="merges to main · 30d"
          value={d1(d.perWeek)} unit="/ week"
          sub={`${d.deployN} PRs merged to the default branch · trailing 30d${deployLow ? ` · n<${LOW_N}, greyed as noise` : ''}`}
          segs={DEPLOY_SEGS} active={deployBand(d.perWeek)} low={deployLow} />
        <DoraCard
          title="Lead time for changes" tag="PR open → merge · working days"
          value={d1(d.ltP50)} unit="d p50"
          sub={`p90 ${d1(d.ltP90)}d · n=${d.ltN}${leadLow ? ` · n<${LOW_N}, greyed as noise` : ''}`}
          segs={LEAD_SEGS} active={leadBand(d.ltP50)} low={leadLow} />
        <DoraCard
          title="Change failure rate" tag="no data source"
          value="—" segs={CFR_SEGS} active={null}
          body={<>Needs a deploy/incident data source this dashboard does not collect — only JIRA and GitHub PRs are wired, there is no deploy-event or rollback/hotfix feed. Escaped-defect or rework rate answers a different question (defects ÷ shipped tickets, not failed deploys ÷ deploys), so it is <b>not</b> shown here relabeled as CFR. Not fabricated.</>} />
        <DoraCard
          title="Time to restore (MTTR)" tag="no data source"
          value="—" segs={MTTR_SEGS} active={null}
          body={<>Needs an incident/restore feed this dashboard does not collect. Bug-created→closed is fix time, not service-restoration time, and no incident concept exists in the data — so there is no honest proxy. Not fabricated.</>} />
      </div>
      <p className="small">
        Bands are the 2023 Google Cloud DORA ballpark (calendar time); our lead time is <b>working</b> days (10:00–18:00 Sun–Thu),
        so an elite reading is if anything conservative. "Deployment frequency" here is <b>merges to the default branch</b>, not prod
        deploys — there is no deploy pipeline wired, so it is a merge-frequency proxy, not a deploy count. All four keys are team
        aggregates; there is no per-person split. Low-sample readings (n&lt;{LOW_N}) are greyed because a band off a handful of PRs is noise.
      </p>
    </div>
  )
}

// ---------- 15: 1:1 prep card — ships LAST, on purpose ----------
// Built ONLY from plane-A work artifacts the subject can already open about themselves. Alphabetical, no
// score, no ranking, no sort-by-output. NO token, cost, hours or transcript field appears anywhere on it.
// Default view is SELF. Nothing here is persisted as a running tally anyone can screenshot.
function OneOnOne() {
  const S = useSnap()
  const [me, setMe] = useState(null)
  const [who, setWho] = useState(null)
  useEffect(() => { api.get('/api/eng/creds').then(setMe).catch(() => setMe({})) }, [])

  const members = useMemo(() => [...(S?.members || [])].sort((a, b) => a.name.localeCompare(b.name)), [S])
  const self = useMemo(() => members.find(m => (m.email || '').toLowerCase() === (me?.email || '').toLowerCase()), [members, me])
  const sel = who ? members.find(m => m.id === who) : self
  useEffect(() => { if (!who && self) setWho(self.id) }, [self])

  const card = useMemo(() => {
    if (!S?.available || !sel) return null
    const mine = (S.issues || []).filter(i => i.assignee?.id === sel.id || i.devAssignee?.id === sel.id)
    const cut = Date.now() - 30 * 86400_000
    const shipped = mine.filter(i => i.live && i.closedAt && Date.parse(i.closedAt) >= cut)
    const wip = mine.filter(i => i.active)
    const cyc = shipped.map(i => i.delivery).filter(n => typeof n === 'number')
    const reopened = mine.filter(i => i.rework && i.closedAt && Date.parse(i.closedAt) >= cut)
    const bugs = mine.filter(i => i.isBug && i.created && Date.parse(i.created) >= cut)
    const qaHeavy = shipped.filter(i => (i.qaCycles || 0) >= 3)
    const atRisk = wip.filter(i => i.rec?.atRisk)
    const talking = []
    if (atRisk.length) talking.push(`${atRisk[0].key} has been in ${atRisk[0].status} ${d1(atRisk[0].inCurrent)} working days — ${d1(-atRisk[0].rec.remaining)}d past its budget. What is blocking it?`)
    if (qaHeavy.length) talking.push(`${qaHeavy.length} ticket(s) shipped after 3+ QA rounds (e.g. ${qaHeavy[0].key}). Is the handoff or the AC the problem?`)
    if (wip.length > 2) talking.push(`${wip.length} tickets in flight at once. Which two would you drop to finish one?`)
    if (reopened.length) talking.push(`${reopened.length} ticket(s) went backwards into development after review/QA. Worth a retro note?`)
    if (shipped.length && !talking.length) talking.push(`${shipped.length} tickets shipped in 30d with a p50 cycle of ${d1(pctl(cyc, 0.5))}d and no rework. What made that go well?`)
    if (!talking.length) talking.push('No delivery signal in the last 30 days from work artifacts. Ask what they have been on — the dashboard genuinely does not know.')
    return { shipped: shipped.length, pts: shipped.reduce((s, i) => s + (i.pts || 0), 0), p50: pctl(cyc, 0.5), p90: pctl(cyc, 0.9), wip: wip.length, atRisk: atRisk.length, reopened: reopened.length, bugs: bugs.length, qaHeavy: qaHeavy.length, talking, list: [...wip].sort((a, b) => (b.inCurrent || 0) - (a.inCurrent || 0)).slice(0, 6) }
  }, [S, sel])

  const copyNote = () => {
    const md = [`# 1:1 — ${sel.name} · ${new Date().toLocaleDateString()}`, '',
      `- shipped (30d): ${card.shipped} tickets / ${card.pts} pts`,
      `- cycle p50 ${d1(card.p50)}d · p90 ${d1(card.p90)}d (working days)`,
      `- in flight: ${card.wip}${card.atRisk ? ` (${card.atRisk} past budget)` : ''}`,
      `- rework: ${card.reopened} · 3+ QA rounds: ${card.qaHeavy} · bugs assigned: ${card.bugs}`, '',
      '## Talking points', ...card.talking.map(t => '- ' + t), '', '## Notes', '- '].join('\n')
    // POST /api/notes reads req.body.content; this sent {text}, so every "1:1 note" click
    // wrote a ZERO-BYTE file and still toasted "saved". ChatSection sends {title, content},
    // which is why it went unnoticed.
    api.post('/api/notes', { title: `1:1 prep ${new Date().toISOString().slice(0, 10)}`, content: md })
      .catch(e => toast(e.message, 'error'))
    navigator.clipboard.writeText(md).catch(() => {})
    toast('1:1 note copied (and saved to notes) — nothing is kept as a running tally', 'success')
  }

  if (!S) return <Skeleton tiles={0} rows={8} />
  if (!S.available) return <NotWired s={S} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel" style={{ marginBottom: 0 }}>
        <div className="panel-head">
          <h3>1:1 prep <span className="muted">work artifacts only · alphabetical · no score</span></h3>
          <select value={who || ''} onChange={e => setWho(e.target.value)}>
            {members.map(m => <option key={m.id} value={m.id}>{m.name}{self?.id === m.id ? ' (you)' : ''}</option>)}
          </select>
          {card && <button className="mini" style={{ marginTop: 0 }} onClick={copyNote}>start 1:1 note</button>}
        </div>
        {!card ? <p className="small" style={{ marginTop: 0 }}>pick a person</p> : (
          <>
            <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginBottom: 16 }}>
              {[['shipped · 30d', card.shipped, `${card.pts} pts`, GREEN],
                ['cycle p50', d1(card.p50) + 'd', `p90 ${d1(card.p90)}d`, BLUE],
                ['in flight', card.wip, card.atRisk ? `${card.atRisk} past budget` : 'on budget', card.atRisk ? RED : DIM],
                ['rework', card.reopened, '30d', card.reopened ? GOLD : DIM],
                ['3+ QA rounds', card.qaHeavy, '30d', card.qaHeavy ? GOLD : DIM],
                ['bugs assigned', card.bugs, '30d', DIM]].map(([l, v, s, c]) => (
                <div key={l}><div style={{ font: `700 18px ${HEAD}`, color: c }}>{v}</div>
                  <div style={{ font: `500 10px ${MONO}`, letterSpacing: '0.06em', color: DIM, textTransform: 'uppercase' }}>{l}</div>
                  <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>{s}</div></div>
              ))}
            </div>
            <div style={{ font: `600 13px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 8 }}>Talking points <span className="muted">drafted from the artifacts above</span></div>
            {card.talking.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 9, padding: '7px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--accent)', font: `600 12px ${MONO}` }}>{i + 1}</span>
                <span style={{ font: "400 13px var(--body)", color: 'var(--text-secondary)' }}>{t}</span>
              </div>
            ))}
            {card.list.length > 0 && (
              <>
                <div style={{ font: `600 13px ${HEAD}`, color: 'var(--text-primary)', margin: '16px 0 8px' }}>In flight <span className="muted">oldest first</span></div>
                {card.list.map(i => (
                  <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <a href={i.url} target="_blank" rel="noreferrer" style={{ font: `600 12px ${MONO}`, color: BLUE, textDecoration: 'none', flexShrink: 0 }}>{i.key}</a>
                    <span style={{ flex: 1, minWidth: 0, font: "400 12px var(--body)", color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.summary}</span>
                    <span style={{ font: `400 11px ${MONO}`, color: i.rec?.atRisk ? RED : DIM, flexShrink: 0 }}>{i.status} · {d1(i.inCurrent)}d</span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
        <p className="small">
          Every number on this card comes from a JIRA ticket the subject can open about themselves, and every card is
          renderable BY its subject — that is the whole contract. There is no token, cost, session-hour or transcript
          field here, there is no ranking, and rows are alphabetical because a sort order is a scoreboard.
        </p>
      </div>
    </div>
  )
}
