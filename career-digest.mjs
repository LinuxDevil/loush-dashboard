// G10 weekly digest. Deterministic, composed from the snapshot + the persisted weekly time-series (★).
// No LLM, no cron — the scheduler half of the roadmap stays gated; this is the digest CONTENT on demand.
const round = x => x == null ? null : Math.round(x * 1000) / 1000
const delta = (a, b) => (a == null || b == null) ? null : round(a - b)

export function weeklyDigest(snap = {}) {
  const hist = snap.rollup?.history || []
  const cur = hist[hist.length - 1] || {}, prev = hist[hist.length - 2] || null
  const wins = (snap.bragCandidates || []).slice(-5).map(c => c.title)
  const focus = (snap.focus || []).filter(f => !f.actedOn).slice(0, 3).map(f => f.message)
  return {
    week: cur.week || null,
    xp: cur.xp ?? 0, xpDelta: delta(cur.xp, prev?.xp),
    sessions: cur.sessions ?? 0, sessionsDelta: delta(cur.sessions, prev?.sessions),
    oneShotRate: cur.oneShotRate ?? 0, oneShotDelta: delta(cur.oneShotRate, prev?.oneShotRate),
    changeFail: cur.changeFailProxy ?? 0, changeFailDelta: delta(cur.changeFailProxy, prev?.changeFailProxy),
    aiCodeShare: snap.ai?.codeShare ?? null,
    movedKpis: snap.impact?.movedCount ?? 0,
    droveDecisions: snap.meetings?.droveDecisions ?? 0,
    keystones: (snap.domain?.keystones || []).length,
    wins, focus,
  }
}
