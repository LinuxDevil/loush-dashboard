import { matchesMe } from './career-identity.mjs'

const SEVERE = new Set(['warning', 'error', 'critical'])

export function attributeBugs({ bugs = [], findings = [], myPrCount = 0, reverts = 0, resolved }) {
  const attributed = [], unattributed = []
  for (const b of bugs) {
    let rule = null
    if (matchesMe(resolved, { email: b.ticketAuthorEmail })) rule = 'ticket-branch'
    else if (matchesMe(resolved, { email: b.culpritAuthorEmail })) rule = 'culprit-commit'
    if (rule) attributed.push({ id: b.id, rule })
    else unattributed.push({ id: b.id })
  }
  const caughtInReview = findings
    .filter(f => SEVERE.has(String(f.severity).toLowerCase()) && matchesMe(resolved, { email: f.diffAuthorEmail }))
    .map(f => ({ id: f.id, severity: f.severity }))
  const denom = Math.max(1, myPrCount)
  return {
    attributed, unattributed, caughtInReview,
    changeFailProxy: (attributed.length + reverts) / denom,        // escaped only
    defectDensityCaughtInReview: caughtInReview.length / denom,     // separate axis
  }
}
