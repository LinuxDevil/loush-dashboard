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

export function ticketRetro({ ticket, prs = [], bugs = [], sessions = [], ticketLinks = {} } = {}) {
  const history = ticket?.history || []
  const link = linkSessions(ticket, sessions)
  const first = history[0]?.at, last = history[history.length - 1]?.at
  const actualDays = first && last ? (last - first) / 86400000 : null
  const escapedBugs = (bugs || []).filter(b => b.ticket === ticket?.id && b.escaped).length
  return {
    ticketId: ticket?.id || null,
    cycleByPhase: cycleByPhase(history),
    estimateVsActual: ticket?.estimateDays != null
      ? { estimateDays: ticket.estimateDays, actualDays } : null,
    reopened: countReopened(history),
    escapedBugs,
    prs: (prs || []).filter(p => idRe(ticket?.id || '\0').test(p.title || '')).map(p => ({ number: p.number, title: p.title })),
    sessionsShown: link.confidence === 'high',
    sessions: link.sessions,
    linkConfidence: link.confidence,
  }
}
