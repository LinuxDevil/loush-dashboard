// Jira cycle-time + originated-vs-assigned import. Quarantined: never throws (spec §11.A).
// Written against the Task-0 fixture shape (Jira Cloud REST v3 issue + expand=changelog):
//   [{ key, fields:{ status.name, created, reporter.accountId, assignee.accountId },
//      changelog:{ histories:[{ created, items:[{ field, fromString, toString }] }] } }]
import { matchesMe } from './career-identity.mjs'

// Changelog items carry status NAMES only (no category), so "done" is matched by name.
const DONE = new Set(['done', 'closed', 'resolved', 'released', 'complete', 'completed', 'shipped'])
const isDone = s => DONE.has(String(s || '').toLowerCase())
const HRS = ms => ms / 3_600_000

function statusChanges(issue) {
  // ascending by time: [{ at, from, to }]
  return (issue.changelog?.histories || [])
    .flatMap(h => (h.items || []).filter(i => i.field === 'status').map(i => ({ at: Date.parse(h.created), from: i.fromString, to: i.toString })))
    .filter(c => !Number.isNaN(c.at))
    .sort((a, b) => a.at - b.at)
}

function parse({ issues, resolved }) {
  if (!Array.isArray(issues)) throw new Error('issues is not an array')
  const cycleTimeByPhaseHrs = {}, estimateVsActual = []
  let originated = 0, assigned = 0, reopened = 0

  for (const issue of issues) {
    const f = issue.fields || {}
    if (matchesMe(resolved, { jiraAccountId: f.reporter?.accountId })) originated++
    if (matchesMe(resolved, { jiraAccountId: f.assignee?.accountId })) assigned++

    const changes = statusChanges(issue)
    if (changes.some(c => isDone(c.from) && !isDone(c.to))) reopened++

    // time in each status: created → first change is the initial status; then each change enters c.to
    // until the next change (or "now" for the current status).
    const created = Date.parse(f.created)
    if (!Number.isNaN(created) && changes.length) {
      let prevAt = created, prevStatus = changes[0].from || f.status?.name
      for (const c of changes) {
        if (prevStatus) push(cycleTimeByPhaseHrs, prevStatus, HRS(c.at - prevAt))
        prevAt = c.at; prevStatus = c.to
      }
    }

    // estimate vs actual: latest Story Points value = estimate; actual = created → last activity.
    const sp = latestStoryPoints(issue)
    if (sp != null) {
      const lastAt = changes.length ? changes[changes.length - 1].at : null
      const actualHrs = !Number.isNaN(created) && lastAt ? HRS(lastAt - created) : 0
      estimateVsActual.push({ key: issue.key, estimateSp: sp, actualHrs })
    }
  }

  const total = issues.length || 1
  return {
    cycleTimeByPhaseHrs, estimateVsActual,
    reopenedRate: reopened / total,
    originatedVsAssigned: { originated, assigned, ratio: assigned ? originated / assigned : 0 },
  }
}

function push(map, k, v) { (map[k] || (map[k] = [])).push(v) }

function latestStoryPoints(issue) {
  let sp = null
  for (const h of issue.changelog?.histories || [])
    for (const i of h.items || [])
      if (i.field === 'Story Points' && i.toString != null && i.toString !== '') { const n = Number(i.toString); if (!Number.isNaN(n)) sp = n }
  return sp
}

const empty = () => ({ cycleTimeByPhaseHrs: {}, estimateVsActual: [], reopenedRate: 0, originatedVsAssigned: { originated: 0, assigned: 0, ratio: 0 } })

export function importJira({ issues = [], resolved } = {}) {
  try { return parse({ issues, resolved }) }
  catch (e) { return { error: e.message, ...empty() } }
}
