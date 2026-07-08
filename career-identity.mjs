// Single source of truth for "mine". Resolve once; validate matches on every import.
export function resolveIdentity(identity = {}) {
  const emails = new Set((identity.gitEmails || []).map(e => String(e).toLowerCase()))
  const r = {
    emails,
    githubHandle: identity.githubHandle || '',
    jiraAccountId: identity.jiraAccountId || '',
    confluenceUser: identity.confluenceUser || '',
    slackUserId: identity.slackUserId || '',
  }
  r.isEmpty = emails.size === 0 && !r.githubHandle && !r.jiraAccountId && !r.confluenceUser && !r.slackUserId
  return r
}

export function matchesMe(resolved, { email } = {}) {
  if (!resolved || resolved.isEmpty) return false
  if (email && resolved.emails.has(String(email).toLowerCase())) return true
  return false
}

export function warnIfNoMatch(resolved, matchedCount, label, log = console.warn) {
  if (!resolved.isEmpty && matchedCount === 0)
    log(`[career] identity matched 0 records in ${label} — check career.json identity (${label})`)
}
