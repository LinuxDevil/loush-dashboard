// OKRs with metric-linked auto-tracking. A KR's `metricRef` is a dotted path into the snapshot
// (e.g. 'quality.changeFailProxy'); resolving it live is what makes an OKR auto-tracked, not a text file.

// Safe dotted-path lookup. Any missing segment (or absent/empty metricRef) → null, never a throw.
export function resolveKrCurrent(kr, snapshot) {
  const ref = kr?.metricRef
  if (!ref) return null
  let cur = snapshot
  for (const seg of ref.split('.')) {
    if (cur == null || typeof cur !== 'object' || !(seg in cur)) return null
    cur = cur[seg]
  }
  return typeof cur === 'number' ? cur : (cur == null ? null : cur)
}

// Pure: return OKRs with each KR's `current` hydrated from the snapshot when metric-linked,
// else the KR's own manual `current`. Never mutates the input.
export function hydrateOkrs(okrs = [], snapshot = {}) {
  return okrs.map(o => ({ ...o, krs: (o.krs || []).map(kr => {
    const live = resolveKrCurrent(kr, snapshot)
    return { ...kr, current: live != null ? live : (kr.current ?? null) }
  }) }))
}

// XP is 25 per closed KR (outcome event, Task 5). Idempotent by event id downstream (awardXp).
export function krClosed(kr) {
  return { type: 'kr', id: 'kr:' + kr.id, xp: 25, at: Date.now(), label: kr.text || kr.id }
}
