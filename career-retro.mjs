// Per-ticket retro. Composes ticket history + PRs + bugs + (only-if-confident) sessions.
// Linkage rule (spec §11.B): a wrong join is worse than a missing one — so a session is only
// shown when the ticket ID appears in its working BRANCH (high confidence). A mere prompt mention
// is too weak; in that case sessionsShown=false and the retro renders without session data.

// stages that mean "sent back" when they follow a QA-ready stage
const QA_READY = new Set(['ready-for-qa', 'qa-running', 'released'])
const REGRESS = new Set(['in-progress', 'code-review', 'fixing'])

function idRe(id) { return new RegExp('\\b' + String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i') }

// High confidence = branch match. Prompt-only match is 'low' and does NOT show.
function linkSessions(ticket, sessions) {
  if (!ticket?.id) return { sessions: [], confidence: 'none' }
  const re = idRe(ticket.id)
  const linked = []
  for (const s of sessions || []) {
    if (re.test(s.branch || '')) linked.push({ id: s.id, confidence: 'high', via: 'branch' })
    else if (re.test(s.first_prompt || '')) linked.push({ id: s.id, confidence: 'low', via: 'prompt' })
  }
  const shown = linked.filter(l => l.confidence === 'high')
  return { sessions: shown, confidence: shown.length ? 'high' : (linked.length ? 'low' : 'none') }
}

function cycleByPhase(history = []) {
  const out = {}
  for (let i = 0; i < history.length - 1; i++) {
    const dur = (history[i + 1].at - history[i].at) / 86400000
    out[history[i].stage] = (out[history[i].stage] || 0) + Math.max(0, dur)
  }
  return out
}

function countReopened(history = []) {
  let n = 0, wasReady = false
  for (const h of history) {
    if (QA_READY.has(h.stage)) wasReady = true
    else if (wasReady && REGRESS.has(h.stage)) { n++; wasReady = false }
  }
  return n
}

export function ticketRetro({ ticket, prs = [], bugs = [], sessions = [], ticketLinks = {}, coverage = null } = {}) {
  const history = ticket?.history || []
  const id = ticket?.id || null
  // item 13: the persisted join (branch/commit → ticket, from the session's own Bash commands) is the
  // high-confidence source. The old prompt/branch heuristic stays as the fallback for un-joined sessions.
  const joined = id ? ticketLinks[String(id).toUpperCase()] || ticketLinks[id] || null : null
  const link = linkSessions(ticket, sessions)
  const shown = joined ? joined.sessions.map(s => ({ id: s.id, confidence: 'high', via: s.via || 'branch', at: s.at, endAt: s.endAt || null })) : link.sessions
  const first = history[0]?.at, last = history[history.length - 1]?.at
  const actualDays = first && last ? (last - first) / 86400000 : null
  const escapedBugs = (bugs || []).filter(b => b.ticket === id && b.escaped).length
  return {
    ticketId: id,
    cycleByPhase: cycleByPhase(history),
    estimateVsActual: ticket?.estimateDays != null
      ? { estimateDays: ticket.estimateDays, actualDays } : null,
    reopened: countReopened(history),
    escapedBugs,
    prs: [...new Set([
      ...(prs || []).filter(p => idRe(id || '\0').test(p.title || '')).map(p => p.number),
      ...(joined?.prs || []).map(s => Number(String(s).split('#')[1])).filter(Boolean),
    ])].map(number => ({ number, title: (prs || []).find(p => p.number === number)?.title || '' })),
    sessionsShown: shown.length > 0,
    sessions: shown,
    linkConfidence: joined ? 'high' : link.confidence,
    // real cost of shipping this ticket — self-plane, and honest about how much of the sample it covers
    cost: joined ? { sessions: joined.sessions.length, tokens: joined.tokens, usd: joined.usd } : null,
    joinCoverage: coverage,   // % of this laptop's sessions that carry a ticket key at all
  }
}
