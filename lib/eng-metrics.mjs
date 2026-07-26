// eng-metrics.mjs — pure delivery metrics extracted from server-eng.mjs so their arithmetic can be
// pinned by tests. Each function here replaces one an audit found to be wrong in a specific way; the
// comment above it says which, because the wrong version looked perfectly reasonable.

const MONTH = t => new Date(t).toISOString().slice(0, 7)

// ---------------------------------------------------------------------------
// estimate accuracy
// ---------------------------------------------------------------------------
//
// WAS: `actual <= est ? (actual/est)*50 + 50 : (est/actual)*100`
// With est = 5 days that scored finishing in 0.1d as 51% and finishing in 10d as 50% — i.e. it rated
// "10x faster than estimated" as WORSE than "2x slower". Non-monotone, asymmetric, and wired to an
// OKR target of >=85%, so the only reliable way to hit it was to inflate estimates: overshoot was
// punished gently and undershoot was punished hard.
//
// NOW: symmetric ratio accuracy — min/max. 100% is a perfect estimate; being wrong by the same
// factor in either direction scores the same; and inflating an estimate no longer helps, because
// finishing early is exactly as inaccurate as finishing late. Monotone in |log(actual/est)|.
export function estAccuracy(est, actual) {
  if (!(est > 0) || !(actual > 0)) return null
  return (Math.min(est, actual) / Math.max(est, actual)) * 100
}

// ---------------------------------------------------------------------------
// escape rate
// ---------------------------------------------------------------------------
//
// WAS: escaped bugs bucketed by the month the BUG WAS FILED, divided by tickets shipped that month.
// Numerator and denominator were different cohorts: a bug filed today against something shipped six
// months ago landed in today's numerator. Ship 2 things in a slow month, have 4 old bugs surface,
// and the dashboard reported a 200% escape rate.
//
// NOW: an escaped bug is attributed to the month ITS PARENT SHIPPED. Numerator and denominator are
// then the same cohort — "of the things we shipped in March, what fraction came back?" — which is
// the question the metric is named after.
//
// Two further guards the old version lacked:
//   * A month is `provisional` until `maturityDays` have passed, because bugs against a recent
//     release have not had time to surface yet and the rate is biased low.
//   * If NO bug in the window carries a parent link, the rate is `null`, not 0. `isEscaped` requires
//     a linked parent, so a team that does not link bugs to parents scored a permanent, fabricated
//     0% — a *good*-looking number produced entirely by missing data.
export function escapeRateSeries({ bugs = [], shipped = [], now = Date.now(), months = 12, maturityDays = 30 }) {
  const shippedBy = {}
  for (const s of shipped) if (s.liveAt) (shippedBy[MONTH(s.liveAt)] ||= []).push(s)

  const escapedBy = {}, caughtBy = {}
  let linked = 0
  for (const b of bugs) {
    if (b.parentLiveAt) linked++
    if (b.escaped && b.parentLiveAt) (escapedBy[MONTH(b.parentLiveAt)] ||= []).push(b)
    else if (!b.escaped && b.created) (caughtBy[MONTH(b.created)] ||= []).push(b)
  }
  const linkable = bugs.length ? linked / bugs.length : null

  const keys = [...new Set([...Object.keys(shippedBy), ...Object.keys(escapedBy)])].sort().slice(-months)
  const series = keys.map(m => {
    const shippedN = (shippedBy[m] || []).length
    const esc = (escapedBy[m] || []).length
    // youngest possible release in this month is the 1st; a month is mature once every release in it
    // has had `maturityDays` to produce a bug report.
    const monthEnd = Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1)
    const provisional = now < monthEnd + maturityDays * 86400_000
    return {
      month: m,
      shipped: shippedN,
      escaped: esc,
      qaCaught: (caughtBy[m] || []).length,
      // null, not 0, when we shipped nothing (nothing could escape) or nothing is linkable
      rate: !shippedN || linked === 0 ? null : +(esc / shippedN * 100).toFixed(1),
      provisional,
      lowN: shippedN < 5,
    }
  })
  return {
    series,
    linkablePct: linkable == null ? null : +linkable.toFixed(2),
    // The UI must not read a 0% as "clean" when it is really "we cannot tell".
    measurable: linked > 0,
    note: linked === 0
      ? 'No bug in this window links to a parent ticket, so an escaped defect cannot be distinguished from one caught in QA. Rate is null, not 0.'
      : null,
  }
}

// ---------------------------------------------------------------------------
// bus factor
// ---------------------------------------------------------------------------
//
// WAS: `rows.length === 1 || rows[0].share >= 70` — with no minimum sample. An area with a SINGLE
// ticket has exactly one contributor, so it was flagged as a bus-factor risk, which would send a
// manager to "spread knowledge" about a component that had one ticket all quarter.
//
// NOW: below `minTickets` the answer is `null` — unknown, not safe and not risky.
export const BUS_FACTOR_MIN_TICKETS = 5

export function busFactor({ total = 0, rows = [], minTickets = BUS_FACTOR_MIN_TICKETS, threshold = 70 }) {
  if (total < minTickets || !rows.length) return { busFactor: null, reason: 'insufficient-data', n: total, minN: minTickets }
  const soleOwner = rows.length === 1
  const dominant = (rows[0]?.share || 0) >= threshold
  return { busFactor: soleOwner || dominant, reason: soleOwner ? 'sole-contributor' : dominant ? 'dominant-contributor' : null, n: total, minN: minTickets }
}
