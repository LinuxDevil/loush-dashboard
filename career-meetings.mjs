// G5 meeting analytics. Pure — computed from imported calendar events (the server can't call the
// Calendar MCP directly, so events arrive via POST /api/career/import/calendar, mirroring the Jira paste).
// events: [{ start, end, title, organizer }]  (ISO strings + organizer email)
const DECISION = /\b(decision|review|planning|design|architecture|retro|kick-?off|roadmap|1:1|1-1)\b/i
const STATUS = /\b(standup|stand-up|status|daily|scrum|check-?in)\b/i

export function meetingStats(events = [], { meEmails = [] } = {}) {
  const me = new Set(meEmails.map(e => String(e).toLowerCase()))
  let hours = 0, decisionCount = 0, statusCount = 0, organizedByMe = 0, droveDecisions = 0
  for (const e of events) {
    const dur = (Date.parse(e.end) - Date.parse(e.start)) / 3_600_000
    if (dur > 0 && dur < 24) hours += dur
    const t = e.title || ''
    const isDecision = DECISION.test(t), mine = e.organizer && me.has(String(e.organizer).toLowerCase())
    if (isDecision) decisionCount++
    else if (STATUS.test(t)) statusCount++
    if (mine) organizedByMe++
    if (mine && isDecision) droveDecisions++
  }
  return { count: events.length, hours: Math.round(hours * 10) / 10, decisionCount, statusCount, organizedByMe, droveDecisions }
}
