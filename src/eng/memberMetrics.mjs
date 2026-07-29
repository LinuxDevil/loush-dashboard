// Pure per-member aggregation for the Members tab — no React, so `node --test` can exercise the ranking
// maths directly. The rule: every field is a JIRA ticket or GitHub PR count over the selected window; nulls
// stay null (a p50 over 0 tickets is not 0). The radar is RELATIVE — rank inside this team, never absolute.
import { of, pos, MIN_N, fx } from './stats.js'

// window predicates — inlined (not imported from TimeLens.jsx) so this module stays React-free and testable
const inWin = (t, w) => { const p = Date.parse(t || 0); return !!p && p >= w.from && p <= w.to }
const shippedIn = (w, i) => inWin(i.liveAt || i.closedAt, w)
const createdIn = (w, i) => inWin(i.created, w)
const prIn = (w, p) => inWin(p.mergedAt || p.createdAt, w)
const inActiveSprint = i => (i.sprints || []).some(s => /active/i.test(s.state || '')) || /active/i.test(i.sprint?.state || '')

export function metricsFor(id, issues, prs, win) {
  const mine = issues.filter(i => i.assignee?.id === id)
  const shipped = mine.filter(i => i.live && shippedIn(win, i))
  const open = mine.filter(i => !i.live)
  const inFlight = mine.filter(i => i.active)
  const atRisk = inFlight.filter(i => i.rec?.atRisk)
  const bugs = issues.filter(i => i.isBug && i.ownerId === id && createdIn(win, i)) // bugs they own, raised this window
  const reopened = shipped.filter(i => i.rework > 0)
  const qaHeavy = shipped.filter(i => (i.qaCycles || 0) >= 3)
  const cyc = of(shipped, i => pos(i.delivery))
  const est = of(shipped, i => i.estAcc)
  const prNums = new Set(mine.flatMap(i => i.prNums || []))
  const myPrs = prs.filter(p => prNums.has(p.num))
  const merged = myPrs.filter(p => p.state === 'Merged' && prIn(win, p))
  const prMerge = of(merged, p => pos(p.mergeDays))
  const focus = open.filter(i => inActiveSprint(i) || i.active) // current-sprint work still to finish
  return {
    id, mine, shipped, open, inFlight, atRisk, bugs, reopened, qaHeavy, cyc, est, myPrs, merged, prMerge, focus,
    pts: shipped.reduce((s, i) => s + (i.pts || 0), 0),
    reworkRate: shipped.length ? reopened.length / shipped.length : null,
    riskShare: inFlight.length ? atRisk.length / inFlight.length : null,
    lowN: shipped.length < MIN_N,
  }
}

// rank a value inside the team → 0..1 (fraction of teammates-with-data this person beats). betterHigh flips
// direction for durations (a faster cycle should rank HIGH). Members with no data for an axis are excluded.
export function ranker(rows, valueOf, betterHigh) {
  const vals = rows.map(r => ({ id: r.id, v: valueOf(r) })).filter(x => x.v != null && Number.isFinite(x.v))
  return id => {
    const me = vals.find(x => x.id === id)
    if (!me || vals.length < 2) return me ? { pct: 0.5, raw: me.v, has: true } : { has: false }
    const worse = vals.filter(x => x.id !== id && (betterHigh ? x.v < me.v : x.v > me.v)).length
    return { pct: worse / (vals.length - 1), raw: me.v, has: true }
  }
}

// the six axes — each a real metric, each ranked within the team over the window
export const AXES = [
  { key: 'throughput', label: 'Throughput', high: true, val: m => m.shipped.length, fmt: v => v + ' shipped' },
  { key: 'speed', label: 'Cycle speed', high: false, val: m => m.cyc.p50, fmt: v => fx(v) + 'd p50' },
  { key: 'quality', label: 'Low rework', high: false, val: m => m.reworkRate, fmt: v => Math.round(v * 100) + '% reworked' },
  { key: 'prspeed', label: 'PR merge', high: false, val: m => m.prMerge.p50, fmt: v => fx(v) + 'd p50' },
  { key: 'estimate', label: 'Estimation', high: true, val: m => m.est.p50, fmt: v => fx(v, 0) + '% acc' },
  { key: 'ontrack', label: 'On-track', high: false, val: m => m.riskShare, fmt: v => Math.round(v * 100) + '% at risk' },
]

export function buildRadars(metrics) {
  const rank = Object.fromEntries(AXES.map(a => [a.key, ranker(metrics, a.val, a.high)]))
  return Object.fromEntries(metrics.map(m => [m.id, AXES.map(a => {
    const r = rank[a.key](m.id)
    return { ...a, pct: r.has ? r.pct : null, raw: r.has ? r.raw : null }
  })]))
}
