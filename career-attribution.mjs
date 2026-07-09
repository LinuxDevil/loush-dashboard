import { matchesMe } from './career-identity.mjs'

const SEVERE = new Set(['warning', 'error', 'critical'])

// Shared across both attributors so the escaped-vs-caught split (§2.5) stays identical: review
// findings are ALWAYS a separate axis and NEVER enter changeFailProxy.
function finish({ attributed, unattributed, bugs, findings, myPrCount, reverts, resolved }) {
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

export function attributeBugs({ bugs = [], findings = [], myPrCount = 0, reverts = 0, resolved }) {
  const attributed = [], unattributed = []
  for (const b of bugs) {
    let rule = null
    if (matchesMe(resolved, { email: b.ticketAuthorEmail })) rule = 'ticket-branch'
    else if (matchesMe(resolved, { email: b.culpritAuthorEmail })) rule = 'culprit-commit'
    if (rule) attributed.push({ id: b.id, rule })
    else unattributed.push({ id: b.id })
  }
  return finish({ attributed, unattributed, bugs, findings, myPrCount, reverts, resolved })
}

// Blame upgrade (§2.5): rule (2) becomes "bug is mine if the commit that introduced the fixed lines is
// mine" — via bug.introducingAuthorEmail, computed at IMPORT (pure data here, no git spawn on refresh).
// Augments, never replaces: the ticket-branch rule and the review axis are preserved verbatim.
export function attributeBugsWithBlame({ bugs = [], findings = [], myPrCount = 0, reverts = 0, resolved }) {
  const attributed = [], unattributed = []
  for (const b of bugs) {
    let rule = null
    if (matchesMe(resolved, { email: b.ticketAuthorEmail })) rule = 'ticket-branch'
    else if (matchesMe(resolved, { email: b.introducingAuthorEmail })) rule = 'blame'
    else if (matchesMe(resolved, { email: b.culpritAuthorEmail })) rule = 'culprit-commit'
    if (rule) attributed.push({ id: b.id, rule })
    else unattributed.push({ id: b.id })
  }
  return finish({ attributed, unattributed, bugs, findings, myPrCount, reverts, resolved })
}
