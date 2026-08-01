
const MONTH = t => new Date(t).toISOString().slice(0, 7)

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
export function estAccuracy(est, actual) {
  if (!(est > 0) || !(actual > 0)) return null
  return (Math.min(est, actual) / Math.max(est, actual)) * 100
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
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
    const monthEnd = Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1)
    const provisional = now < monthEnd + maturityDays * 86400_000
    return {
      month: m,
      shipped: shippedN,
      escaped: esc,
      qaCaught: (caughtBy[m] || []).length,
      rate: !shippedN || linked === 0 ? null : +(esc / shippedN * 100).toFixed(1),
      provisional,
      lowN: shippedN < 5,
    }
  })
  return {
    series,
    linkablePct: linkable == null ? null : +linkable.toFixed(2),
    measurable: linked > 0,
    note: linked === 0
      ? 'No bug in this window links to a parent ticket, so an escaped defect cannot be distinguished from one caught in QA. Rate is null, not 0.'
      : null,
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
export const BUS_FACTOR_MIN_TICKETS = 5

export function busFactor({ total = 0, rows = [], minTickets = BUS_FACTOR_MIN_TICKETS, threshold = 70 }) {
  if (total < minTickets || !rows.length) return { busFactor: null, reason: 'insufficient-data', n: total, minN: minTickets }
  const soleOwner = rows.length === 1
  const dominant = (rows[0]?.share || 0) >= threshold
  return { busFactor: soleOwner || dominant, reason: soleOwner ? 'sole-contributor' : dominant ? 'dominant-contributor' : null, n: total, minN: minTickets }
}
