// L2 — aggregate the three loush-run gate signals into ONE verdict so a human sees
// PASSING / BLOCKED / NEEDS-HUMAN per run instead of reading each gate separately.
// Pure (all inputs passed in) so it's unit-testable; server.mjs does the fs reads and calls this.
// Rules from the loush contract: §14 Critical/Required findings block; §15 build/verify cap 3, resolve-pr cap 5.
export const RETRY_CAP = { build: 3, verify: 3, fix: 3, 'pr-review': 3, 'resolve-pr': 5 }

export function verdictFrom({ review, retries, phase, phaseStatus, terminalFailed, terminalDone, awaitingApproval }) {
  if (awaitingApproval) return 'NEEDS-HUMAN' // converged to a gated artifact awaiting sign-off (the promote gate)
  const blocking = (review?.findings || []).filter(f => ['Critical', 'Required'].includes(f.severity)).length
  const capHit = Object.entries(retries || {}).some(([ph, n]) => n >= (RETRY_CAP[ph] || Infinity))
  if (terminalFailed || phaseStatus === 'failed' || capHit || (review?.decision === 'REQUEST_CHANGES' && blocking)) return 'BLOCKED'
  const done = terminalDone || phase === 'done' || phaseStatus === 'passed'
  if (done && !blocking) return 'PASSING'
  return null // running / unknown — no verdict yet
}
