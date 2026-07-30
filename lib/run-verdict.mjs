export const RETRY_CAP = { build: 3, verify: 3, fix: 3, 'pr-review': 3, 'resolve-pr': 5 }

export function verdictFrom({ review, retries, phase, phaseStatus, terminalFailed, terminalDone, awaitingApproval }) {
  if (awaitingApproval) return 'NEEDS-HUMAN'
  const blocking = (review?.findings || []).filter(f => ['Critical', 'Required'].includes(f.severity)).length
  const capHit = Object.entries(retries || {}).some(([ph, n]) => n >= (RETRY_CAP[ph] || Infinity))
  if (terminalFailed || phaseStatus === 'failed' || capHit || (review?.decision === 'REQUEST_CHANGES' && blocking)) return 'BLOCKED'
  const done = terminalDone || phase === 'done' || phaseStatus === 'passed'
  if (done && !blocking) return 'PASSING'
  return null
}
