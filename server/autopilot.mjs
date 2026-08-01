/**
 * Autopilot — drives a board ticket through the stages that already exist, without a human
 * clicking each one.
 *
 * It deliberately owns no logic of its own. Every step it takes is the same HTTP endpoint the
 * button in the UI hits, called on loopback, so a stage's guards (WIP limits, "already running",
 * dependency checks, the 3-iteration fix cap) apply identically whether a person or the ticker
 * pressed it. That is also why this is a poller rather than a chain of callbacks: the board is a
 * file, a run can die with the process, and the next tick simply reads the state that survived.
 *
 * Where it STOPS is the point of it:
 *   - blocked            → an agent asked a question; answering is a human's job
 *   - bug-reported       → QA found real failures; a person decides whether to fix or accept
 *   - ready-for-release  → merging to the base branch is never automatic
 */
import { boardRuns, projCfg, readBoard, tkt } from './board.mjs'
import { PORT } from './dashboard-core.mjs'

const TICK_MS = 20_000
const ranKind = (t, kind) => (t.runs || []).some(r => r.kind === kind)
const isBlocking = f => ['critical', 'high'].includes(f.severity)

/** The design refs the ticket carries, if the Ticket tab found any when it pushed it here. */
const hasDesignRefs = t => !!(t.designRefs?.figma?.length || t.designRefs?.captures?.length || t.designRefs?.contentCsv)

/**
 * The single next action for one ticket, or null for "nothing to do — or nothing I should do".
 * Returned as [path, body] so the caller does not have to know which endpoints take input.
 */
export function nextAction(board, t) {
  if (t.blocked || boardRuns.has(t.id)) return null
  const kids = board.tickets.filter(x => x.parent === t.id && x.type !== 'bug' && x.stage !== 'released')

  switch (t.stage) {
    case 'backlog':
      if (t.type === 'bug') return null                       // QA-filed bugs are a human call
      if (kids.length) return null                            // a parent waits on its children
      if (t.proposal?.length) return ['breakdown', { subs: t.proposal }]
      if (!t.parent && !ranKind(t, 'analyze')) return ['analyze', {}]
      return ['start', {}]

    case 'code-review':
      // Findings are cleared by the fix step, so their presence means "reviewed, not yet fixed".
      return (t.findings || []).some(isBlocking) ? ['fix', {}] : ['review', {}]

    case 'ready-for-qa':
      if (hasDesignRefs(t) && !t.designQa) return ['designqa', {}]
      return ['qa', {}]

    default:
      return null   // in-progress / fixing / qa-running are runs in flight; the rest are gates
  }
}

async function tick() {
  let board
  try { board = readBoard() } catch { return }
  for (const t of board.tickets) {
    if (!projCfg(board, t.project).autopilot) continue
    const action = nextAction(board, t)
    if (!action) continue
    const [step, body] = action
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/board/tickets/${t.id}/${step}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      // A 4xx here is a guard doing its job (WIP limit, already running). It is not an error to
      // report — the next tick re-reads the board and either finds the door open or does not.
      if (!r.ok) continue
      // One step per ticket per tick. The board this loop is iterating is already stale for this
      // ticket, and re-reading it mid-loop to chase the next step is how you get two runs started.
    } catch { /* server mid-restart; try again next tick */ }
  }
}

export default function mountAutopilot() {
  let busy = false
  const timer = setInterval(async () => {
    if (busy) return
    busy = true
    try { await tick() } finally { busy = false }
  }, TICK_MS)
  timer.unref()
  return timer
}
