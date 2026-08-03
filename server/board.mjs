import { CLAUDE, propose, readJson, track } from './dashboard-core.mjs'
import { exec, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runAgent } from '../lib/agent.mjs'
import { unfinishedReason } from '../lib/agent-outcome.mjs'
import { git as gitSafe } from '../lib/git-safe.mjs'

const BOARD_FILE = path.join(CLAUDE, 'taskboard.json')

const WORKTREES = path.join(CLAUDE, 'board-worktrees')

const DEFAULT_STAGES = ['backlog', 'in-progress', 'code-review', 'fixing', 'ready-for-qa', 'qa-running', 'bug-reported', 'ready-for-release', 'released']

const DEFAULT_BOARD = {
  teams: [],
  pipelines: [
    { id: 'default', name: 'Team Production', version: 1, stages: DEFAULT_STAGES, wip: {} },
    { id: 'solo', name: 'Solo Side Project', version: 1, stages: ['backlog', 'in-progress', 'ready-for-release', 'released'], wip: {} },
  ],
  projects: {},
  tickets: [],
}

const readBoard = () => { const b = readJson(BOARD_FILE, {}); return { ...DEFAULT_BOARD, ...b, pipelines: b.pipelines?.length ? b.pipelines : DEFAULT_BOARD.pipelines } }

const writeBoard = b => track(BOARD_FILE, JSON.stringify(b, null, 2), { summary: 'update task board' })

const projCfg = (board, project) => ({ pipeline: 'default', base: 'main', branchPrefix: 'ticket/', mergeMethod: 'merge', requirePr: false, defaultModel: '', previewCmd: '', previewStopCmd: '', previewIdleMin: 240, qaSeesFindings: false,
  // 0 = no cap, which is the historical behaviour. A ticket that has already spent this much has
  // usually stopped converging rather than nearly finished — AIR-10733 reached $18.84 across five
  // agent runs and was no closer to clean than it had been at $10.
  costCap: 0, ...(board.projects[project] || {}) })

const tkt = (board, id) => board.tickets.find(t => t.id === id)

/**
 * What this ticket branches from and merges back into.
 *
 * A sub-ticket answers "the parent's branch". The five sub-tickets of one JIRA ticket are one
 * change split five ways: based on the project's base they would each be reviewed against code
 * their siblings had already replaced, and released one at a time into main as five half-features.
 * Stacked on the parent, the parent branch integrates them and is the single thing that merges.
 *
 * An explicit `base` still wins — it was set by hand for a reason, and a rule that cannot be
 * overridden is a rule you work around by deleting the ticket.
 */
const baseOf = (board, t) =>
  t.base || (t.parent ? tkt(board, t.parent)?.branch : null) || projCfg(board, t.project).base

const stamp = (t, to, note) => { (t.history ||= []).push({ at: Date.now(), from: t.stage, to, note: note || '' }); t.stage = to; if (to === 'released') { loushRunEmit(t.project, t.id, 'run.completed', { status: 'completed' }); loushRunState(t.project, t.id, 'released', 'passed') } }

// The block reason is what a human reads to decide what to do. Truncating it silently at 1500
// chars can cut off the part that says WHY — so the truncation is recorded on the block itself.
const REASON_CAP = 1500
const STOP_GRACE_MS = 120_000
const blockT = (t, by, category, reason, needed) => {
  // A run you stopped is not a run that failed. Killing the child makes `claude -p` exit without
  // its JSON, which every completion handler reads as an agent error — so the ticket would land
  // blocked, in red, in the Inbox, demanding a decision about a thing you already decided.
  if (category === 'agent-error' && t.stoppedAt && Date.now() - t.stoppedAt < STOP_GRACE_MS) {
    t.stoppedAt = null
    ;(t.history ||= []).push({ at: Date.now(), from: t.stage, to: t.stage, note: `${by} stopped by you` })
    return
  }
  const full = String(reason)
  t.blocked = {
    at: Date.now(), by, category, reason: full.slice(0, REASON_CAP), needed: needed || '',
    ...(full.length > REASON_CAP ? { reasonTruncated: { cap: REASON_CAP, originalLength: full.length } } : {}),
  }
  ;(t.history ||= []).push({ at: Date.now(), from: t.stage, to: 'blocked:' + category, note: full.slice(0, 200) })
}

const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

const extractJson = s => { for (const re of [/\[[\s\S]*\]/, /\{[\s\S]*\}/]) { const m = re.exec(s || ''); if (m) try { return JSON.parse(m[0]) } catch {} } return null }

const boardRuns = new Map()

// A run lives in `boardRuns`, which is memory. Any restart — a crash, a deploy, `node --watch`
// noticing an edit — therefore loses every in-flight agent while the agent itself keeps running and
// keeps committing. Nothing is then left that can show it, stop it, or record what it did, and the
// ticket sits at in-progress looking idle forever. Observed on AIR-10733: a one-line edit to this
// file orphaned a dev agent that went on to land a complete commit nobody was told about.
//
// The pid is persisted so a restarted server can at least tell the truth. It cannot adopt the
// process — the promise that would have read its output died with the old process — so the honest
// outcome is a blocked ticket naming the pid and the branch, not a silent in-progress.
const markRunPersisted = (id, kind, pid) => {
  const b = readBoard(); const t = tkt(b, id); if (!t) return
  t.runMarker = { kind: kind || 'agent', pid, startedAt: Date.now() }
  writeBoard(b)
}
/** Clear on a ticket the caller is about to write. Preferred — see the note at the call sites. */
const clearRunMarker = t => { if (t?.runMarker) delete t.runMarker }
/** Clear when there is no snapshot in hand (the error paths, which write nothing of their own). */
const clearRunPersisted = id => {
  const b = readBoard(); const t = tkt(b, id); if (!t?.runMarker) return
  delete t.runMarker; writeBoard(b)
}
/**
 * Called by the server at boot — NEVER on import.
 *
 * It used to run itself from a module-level timer, which meant merely importing this file mutated
 * the real board: `node --test` on a findings test blocked a live ticket and wrote a bogus "lost"
 * run against an agent that was working perfectly. A module that rewrites user state as a side
 * effect of being loaded cannot be tested, scripted, or imported by anything else.
 */
export function reconcileOrphanedRuns() {
  const b = readBoard(); let changed = false
  for (const t of b.tickets || []) {
    if (!t.runMarker) continue
    const { kind, pid } = t.runMarker
    let alive = false
    try { process.kill(pid, 0); alive = true } catch {}
    // A run entry even though nothing can be recovered. Without one the ticket's history simply
    // skips the run: on AIR-10733 the dev agent's cost, duration and output are absent from the
    // record entirely, so the ticket reads as though the code committed itself for free.
    ;(t.runs ||= []).push({ at: t.runMarker.startedAt || Date.now(), kind, model: 'unknown', status: 'lost', cost: null, turns: 0,
      ms: Date.now() - (t.runMarker.startedAt || Date.now()), sessionId: null, headSha: headShaOf(t), transcriptDir: null,
      summary: `the server restarted while this ${kind} run was in flight; its output and cost were never received${alive ? ` (pid ${pid} was still alive at reconcile)` : ''}` })
    delete t.runMarker; changed = true
    blockT(t, 'system', 'orphaned-run', alive
      ? `the ${kind} agent (pid ${pid}) is still running, but this server restarted and no longer owns it — its result will not be recorded. Check ${t.branch || 'the branch'} for commits; kill ${pid} to stop it.`
      : `the ${kind} agent was lost when this server restarted, so its result was never recorded. Check ${t.branch || 'the branch'} — it may already have commits.`)
  }
  if (changed) writeBoard(b)
}

function loushRunEmit(project, ticket, type, data) {
  if (!project || !fs.existsSync(project)) return
  try {
    const dir = path.join(project, '.loush', ticket)
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, 'events.jsonl')
    const n = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0
    const rows = []
    if (n === 0) rows.push({ seq: 1, t: new Date().toISOString(), type: 'run.started', data: { flow: 'board' } })
    rows.push({ seq: n + rows.length + 1, t: new Date().toISOString(), type, data })
    fs.appendFileSync(f, rows.map(x => JSON.stringify(x)).join('\n') + '\n')
  } catch {}
}

function loushRunState(project, ticket, phase, phase_status) {
  if (!project || !fs.existsSync(project)) return
  try {
    const dir = path.join(project, '.loush', ticket)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ticket_id: ticket, flow: 'board', phase, phase_status, updated_at: new Date().toISOString() }, null, 2))
  } catch {}
}

// ---- findings lifecycle ------------------------------------------------------------------------
//
// A review used to REPLACE `t.findings` wholesale and a fix used to empty it, so every round
// re-derived the list from nothing. Three consequences, all observed on AIR-10733:
//   · findings the fix agent cannot resolve — "get Avo to register this container event", "compare
//     against Figma" — came back every single round. Raised three times, never actionable.
//   · counts oscillated 9 → 8 → 9, and nothing could tell oscillation from progress, because
//     nothing knew whether round 3's item was round 1's item.
//   · a human decision to accept a finding had nowhere to live, so it could not be made.
// Identity is (file, severity, first eight significant words). Not the full sentence: a reviewer
// rewords the same defect between rounds, and an id that changes with the wording is not an id.
const FIND_STOP = new Set(['the', 'a', 'an', 'is', 'are', 'to', 'of', 'and', 'in', 'on', 'for', 'that', 'this', 'it', 'its', 'with', 'so', 'but'])
export function findingId(f) {
  const words = String(f.summary || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !FIND_STOP.has(w)).slice(0, 8).join('-')
  return `${(f.file || 'repo').split('/').pop()}:${f.severity || 'low'}:${words}`.slice(0, 120)
}

// `code` is the only class a fix agent can act on. The other two exist so a finding can be true,
// unresolved, and still not block forever — which is the state most of AIR-10733's tail was in.
const FIND_CLASSES = new Set(['code', 'needs-human', 'pre-existing'])
const normClass = c => (FIND_CLASSES.has(c) ? c : 'code')

/**
 * Merge a fresh review's findings over what the ticket already knows.
 *
 * Carried across: the class, any human acknowledgement, and when the finding was first seen. A
 * finding absent from the new review is RESOLVED rather than deleted — the history of what a round
 * fixed is the only evidence that the loop is converging.
 */
export function mergeFindings(prev, fresh, sha) {
  const byId = new Map((prev || []).map(f => [f.id || findingId(f), f]))
  const now = Date.now()
  const out = []
  for (const raw of fresh || []) {
    const id = findingId(raw)
    const old = byId.get(id)
    byId.delete(id)
    out.push({
      ...raw,
      id,
      class: normClass(raw.class ?? old?.class),
      status: old?.status === 'acked' ? 'acked' : 'open',
      ackNote: old?.ackNote || null,
      firstSeenSha: old?.firstSeenSha || sha || null,
      lastSeenSha: sha || null,
      firstSeenAt: old?.firstSeenAt || now,
      at: now,
      seenCount: (old?.seenCount || 0) + 1,
    })
  }
  // Everything the new review did NOT raise: it was addressed, or it stopped reproducing.
  for (const gone of byId.values()) {
    // Normalised on the way through: findings recorded before this lifecycle existed have no class
    // at all, and a resolved finding still gets rendered — an undefined class would read to the UI
    // as whatever its fallback happens to be rather than as what it was.
    const carried = { ...gone, id: gone.id || findingId(gone), class: normClass(gone.class) }
    if (gone.status === 'resolved') { out.push(carried); continue }
    out.push({ ...carried, status: 'resolved', resolvedAt: now, resolvedSha: sha || null })
  }
  return out
}

// ---- convergence -------------------------------------------------------------------------------
//
// The old stop condition was "three fix runs, then block". It cannot tell a loop that is closing in
// from one going round in circles, and on AIR-10733 it would have reported the same verdict for
// both: findings went 9 → 8 → 9 while severity went critical → high → high, and the count alone
// says nothing. What actually matters is whether the WORST open problem is getting less bad, and
// whether the same items keep coming back.
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1 }
const worstOf = findings => findings.reduce((m, f) => Math.max(m, SEV_RANK[f.severity] || 1), 0)

/**
 * Decide what the loop should do after a review.
 *
 * `rounds` is the ticket's review history, oldest first: [{ worst, open }]. Returns one of
 * `advance` | `fix` | `stalled` | `budget`, always with a reason a human can read — a loop that
 * stops without saying why is indistinguishable from one that crashed.
 */
export function convergenceVerdict({ rounds, blocking, openCode, spend, budget, maxRounds = 5 }) {
  if (budget && spend >= budget) return { action: 'budget', reason: `$${spend.toFixed(2)} spent against a $${budget.toFixed(2)} cap — stopping before the next run` }
  if (!blocking.length) return { action: 'advance', reason: openCode.length ? `no blocking findings (${openCode.length} minor left open)` : 'no open findings' }
  const worst = worstOf(blocking)
  const prev = rounds.slice(-3)
  // Not improving means: the worst severity has not fallen AND the open count has not fallen across
  // the last three reviews. Either one moving is progress worth another round.
  if (prev.length >= 3) {
    const severityStuck = prev.every(r => r.worst >= worst)
    const countStuck = prev.every(r => r.open <= openCode.length)
    if (severityStuck && countStuck) {
      const repeats = blocking.filter(f => f.seenCount >= 3).length
      return { action: 'stalled', reason: `three reviews without the worst severity or the finding count falling${repeats ? ` — ${repeats} finding(s) raised 3+ times` : ''}. Another fix run is unlikely to help; accept, reclassify, or take over.` }
    }
  }
  if (rounds.length >= maxRounds) return { action: 'stalled', reason: `${rounds.length} review rounds without a clean result — take over manually` }
  return { action: 'fix', reason: `${blocking.length} blocking finding(s), worst is ${blocking.find(f => (SEV_RANK[f.severity] || 1) === worst)?.severity}` }
}

/** What the loop is allowed to act on, and what it is allowed to be blocked by. */
export const openCodeFindings = t => (t.findings || []).filter(f => f.status === 'open' && f.class === 'code')
const BLOCKING_SEVERITIES = new Set(['critical', 'high'])
export const blockingFindings = t => openCodeFindings(t).filter(f => BLOCKING_SEVERITIES.has(f.severity))

/** Where a run's prompt and raw output are kept. Per ticket, per run — never overwritten. */
const RUNS_DIR = path.join(os.homedir(), '.claude', 'board-runs')
const runTranscriptDir = (ticketId, kind) => path.join(RUNS_DIR, ticketId, `${Date.now()}-${kind}`)

/** The commit a run actually saw. A finding or a verdict without one cannot be trusted later. */
function headShaOf(t) {
  if (!t?.worktree) return null
  const r = gitB(t.worktree, ['rev-parse', 'HEAD'])
  return r.status === 0 ? String(r.stdout || '').trim().slice(0, 40) || null : null
}

function recordRun(t, kind, model, r, handoff) {
  // `!r.error` is not the same as "it ran": an account-limit notice arrives as a normal result on a
  // zero exit code, and recording that as `ok` is what promoted AIR-10733 on a review that never
  // happened. Its own status rather than `lost` — `lost` already means "the server restarted and
  // never received this run's output", and reusing it here would name the wrong cause.
  const unfinished = !r.error && unfinishedReason(r.result, null)
  ;(t.runs ||= []).push({ at: Date.now(), kind, model: model || 'default', status: r.error ? 'error' : r.blocked ? 'blocked' : unfinished ? 'unfinished' : 'ok', cost: r.cost || 0, turns: r.turns || 0, ms: r.ms || 0, sessionId: r.sessionId || null, summary: (r.result || r.error || '').slice(0, 1500), handoff,
    // The three fields that make a run auditable after the fact: what commit it saw, and where the
    // prompt it was given and the output it produced are on disk.
    headSha: headShaOf(t), transcriptDir: r.transcriptDir || null, blocked: r.blocked || null,
    ...(unfinished ? { unfinished } : {}) })
  const outcome = r.error || unfinished ? 'failed' : r.blocked ? 'blocked' : 'passed'
  loushRunEmit(t.project, t.id, 'step.completed', { label: kind, agent: 'board:' + kind, status: outcome })
  // The OUTCOME, not 'running'. Written at the end of a run, 'running' was never true by the time
  // it was written — and since a board ticket only ever emits a terminal event when it is released,
  // every ticket that had ever run an agent sat in Loush Runs as "running" forever. Nine idle
  // tickets reported as nine live agents.
  loushRunState(t.project, t.id, kind, outcome)
}

const teamStage = (board, t, stageKind) => { const team = board.teams.find(x => x.id === t.team); const s = team?.stages?.[stageKind] || {}; return { model: t.model || s.model || projCfg(board, t.project).defaultModel || undefined, instructions: s.instructions || '' } }

// Routed through git-safe so reads take no optional lock: the board rebases worktrees while a
// dashboard poll may be running a diff against the same repo, which is exactly the collision.
// spawnSync's shape is preserved (.status/.stdout) so callers are unchanged.
const gitB = (project, args, timeout = 60_000) => {
  const r = gitSafe(project, args, { timeout, maxBuffer: 8 * 1024 * 1024 })
  return { status: r.ok ? 0 : (r.status ?? 1), stdout: r.stdout, stderr: r.stderr, locked: r.locked, reason: r.reason }
}

const changedFiles = (project, base, ref) => { const r = gitB(project, ['diff', '--name-only', `${base}...${ref}`]); return r.status === 0 ? r.stdout.toString().trim().split('\n').filter(Boolean) : [] }

function conflictScan(board, t) {
  if (!t.branch || !fs.existsSync(t.project)) return
  const mine = new Set(changedFiles(t.project, baseOf(board, t), t.branch))
  t.conflictRisk = []
  for (const o of board.tickets) {
    if (o.id === t.id || o.project !== t.project || !o.branch || o.stage === 'released' || o.stage === 'backlog') continue
    // Each side is diffed against its OWN base — two tickets off different bases still overlap on
    // the files they both touch, and diffing one of them against the wrong base invents changes.
    const overlap = changedFiles(t.project, baseOf(board, o), o.branch).filter(f => mine.has(f))
    if (overlap.length) t.conflictRisk.push({ ticket: o.id, title: o.title, files: overlap.slice(0, 10) })
  }
}

function ensureWorktree(board, t) {
  const cfg = projCfg(board, t.project)
  // The branch is named after the JIRA key when there is one. `tk1a2b3c` is a name only this
  // board understands; every other tool the work passes through — the PR, CI, the reviewer
  // looking at a list of branches — is keyed on AIR-10817.
  t.branch ||= cfg.branchPrefix + (t.branchKey || t.jiraKey || t.id)
  t.worktree ||= path.join(WORKTREES, t.id)
  if (fs.existsSync(path.join(t.worktree, '.git'))) return null
  fs.mkdirSync(WORKTREES, { recursive: true })

  // A sub-ticket branches off its parent, so the parent's branch has to exist first — and usually
  // does not, because the normal flow is to break a ticket down and start the children while the
  // parent itself never runs an agent. It is created here as a plain ref off the parent's own base:
  // no worktree, nothing checked out, just the integration branch the children stack on and the
  // one branch that eventually merges.
  const parent = t.parent ? tkt(board, t.parent) : null
  if (parent && !t.base && parent.project === t.project) {
    parent.branch ||= projCfg(board, parent.project).branchPrefix + (parent.branchKey || parent.jiraKey || parent.id)
    if (gitB(t.project, ['rev-parse', '--verify', parent.branch]).status !== 0) {
      const parentBase = baseOf(board, parent)
      const mk = gitB(t.project, ['branch', parent.branch, parentBase])
      if (mk.status !== 0) return `could not create the parent branch ${parent.branch} off ${parentBase}: ${mk.stderr.toString().slice(0, 400)}`
      parent.basedOn = parentBase
      ;(parent.history ||= []).push({ at: Date.now(), from: parent.stage, to: parent.stage, note: `branch ${parent.branch} created off ${parentBase} for its sub-tickets` })
    }
  }

  const dep = (t.deps || []).map(d => tkt(board, d)).find(d => d?.branch && d.project === t.project)
  const baseRef = dep?.branch && gitB(t.project, ['rev-parse', '--verify', dep.branch]).status === 0 ? dep.branch : baseOf(board, t)
  const r = gitB(t.project, ['worktree', 'add', t.worktree, '-b', t.branch, baseRef])
  if (r.status !== 0) {
    const r2 = gitB(t.project, ['worktree', 'add', t.worktree, t.branch])
    if (r2.status !== 0) return (r.stderr.toString() + r2.stderr.toString()).slice(0, 800)
  }
  t.basedOn = baseRef
  return null
}

/**
 * Start the dev agent on ONE ticket. Mutates `board`; the caller writes it.
 *
 * Split out of the route so a parent can start each of its children through exactly the same path
 * — the WIP limit, the dependency check and the worktree provisioning are the same rules whether
 * one ticket was started by hand or five were started by starting their parent.
 */
function beginDev(board, t, { model: modelOverride, reply, resume } = {}) {
  if (boardRuns.has(t.id)) return { error: 'already running' }
  const unmet = (t.deps || []).map(d => tkt(board, d)).filter(d => d && !['ready-for-release', 'released'].includes(d.stage))
  if (unmet.length) return { error: 'blocked by: ' + unmet.map(d => d.title).join(', ') }
  const pipe = board.pipelines.find(p => p.id === projCfg(board, t.project).pipeline) || board.pipelines[0]
  const wip = pipe.wip?.['in-progress']
  if (wip && board.tickets.filter(x => x.project === t.project && x.stage === 'in-progress').length >= wip) return { error: `WIP limit for in-progress is ${wip}` }
  if (modelOverride) t.model = modelOverride
  const wtErr = ensureWorktree(board, t)
  if (wtErr) { blockT(t, 'system', 'provision', 'worktree/branch creation failed: ' + wtErr); return { error: wtErr } }
  const { model, instructions } = teamStage(board, t, 'dev')
  const kids = board.tickets.filter(x => x.parent === t.id)
  stamp(t, 'in-progress', 'dev agent started' + (model ? ' (' + model + ')' : ''))
  boardRuns.set(t.id, { kind: 'dev', startedAt: Date.now() })
  ;(async () => {
    const prompt = [
      `Implement this ticket. You are in an isolated git worktree on branch ${t.branch} — commit incrementally with clear messages. Run the project's tests/build before declaring done.`,
      instructions, `\n## Ticket: ${t.title}\n${t.desc}`,
      kids.length ? '\n## Accepted sub-ticket breakdown\n' + kids.map(k => `- ${k.title}: ${k.desc}`).join('\n') : '',
      t.type === 'bug' && t.qaEvidence ? '\n## QA evidence / repro\n' + t.qaEvidence : '',
      reply ? '\n## Answer to your blocking question\n' + reply : '',
      '\nIf you hit a genuinely ambiguous requirement, missing credential, or unresolvable dependency: stop and print a final line "BLOCKED: <exactly what you need>".',
    ].filter(Boolean).join('\n')
    const r = await runAgent({ transcriptDir: runTranscriptDir(t.id, boardRuns.get(t.id)?.kind || 'agent'), onSpawn: c => { const live = boardRuns.get(t.id); if (live) live.child = c; markRunPersisted(t.id, live?.kind, c.pid) }, cwd: t.worktree, prompt, model, resume })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    // Cleared on THIS snapshot, not through a separate read-modify-write. `b2` was read before any
    // such write, so `writeBoard(b2)` at the end of this block would put the marker straight back —
    // which is exactly what happened on the AIR-10733 review: the run ended, the marker survived,
    // and the next restart would have reported a finished agent as orphaned.
    clearRunMarker(t2)
    recordRun(t2, 'dev', model, r, { passed: ['ticket', 'sub-ticket breakdown', 'worktree codebase + CLAUDE.md', ...(reply ? ['unblock reply'] : [])], excluded: ['prior tickets', 'other branches'] })
    // A run that never ran is a failed run, not an empty one (lib/agent-outcome.mjs).
    const unfinished = unfinishedReason(r.result, r.error)
    if (unfinished) blockT(t2, 'dev agent', r.error ? 'agent-error' : 'agent-unfinished', unfinished)
    else if (r.blocked) blockT(t2, 'dev agent', 'needs-input', r.blocked, r.blocked)
    else { stamp(t2, 'code-review', 'dev done — idle until you run code review'); conflictScan(b2, t2) }
    writeBoard(b2)
  })().catch(() => { boardRuns.delete(t.id); clearRunPersisted(t.id) })
  return { ok: true }
}

/**
 * Starting a parent starts its CHILDREN.
 *
 * A ticket that has been broken down is a container: the work lives in the sub-tickets, each with
 * its own worktree, and running an agent on the parent instead would put one agent in one worktree
 * doing all five jobs — which is the thing the breakdown existed to avoid. Children whose
 * dependencies are unmet are left in backlog and named in the response rather than force-started,
 * since a dependency is the breakdown saying these two cannot be written at the same time.
 */
function startTicket(id, opts = {}, res) {
  const board = readBoard(); const t = tkt(board, id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })

  const kids = board.tickets.filter(x => x.parent === t.id && x.type !== 'bug' && x.stage !== 'released')
  if (kids.length) {
    const started = [], skipped = []
    for (const k of kids) {
      if (k.stage !== 'backlog') { skipped.push({ id: k.id, title: k.title, why: `already ${k.stage}` }); continue }
      const r = beginDev(board, k, opts)
      if (r.error) skipped.push({ id: k.id, title: k.title, why: r.error })
      else started.push({ id: k.id, title: k.title, branch: k.branch })
    }
    if (started.length) stamp(t, 'in-progress', `started ${started.length} of ${kids.length} sub-ticket${kids.length === 1 ? '' : 's'}`)
    writeBoard(board)
    if (!started.length) {
      return res.status(400).json({ error: 'no sub-ticket could start', detail: skipped.map(s => `${s.title}: ${s.why}`).join(' · '), skipped })
    }
    return res.json({ ok: true, startedChildren: started, skipped })
  }

  const r = beginDev(board, t, opts)
  writeBoard(board)
  if (r.error) return res.status(r.error === 'already running' ? 409 : 400).json({ error: r.error })
  res.json({ ok: true })
}

const previews = new Map()

function startPreview(board, t) {
  const cfg = projCfg(board, t.project)
  if (!cfg.previewCmd || previews.has(t.id)) return
  const child = spawn('sh', ['-c', cfg.previewCmd], { cwd: t.worktree || t.project, env: { ...process.env, TICKET: t.id, BRANCH: t.branch || '', WORKTREE: t.worktree || '' }, detached: true })
  previews.set(t.id, child)
  let out = ''
  const onData = d => {
    out += d
    const m = /https?:\/\/[^\s'"]+/.exec(out)
    if (m && !t.preview?.url) {
      const b2 = readBoard(); const t2 = tkt(b2, t.id)
      if (t2) { t2.preview = { url: m[0], startedAt: Date.now() }; if (t2.qa) t2.qa.baseUrl = m[0]; else t2.qa = { baseUrl: m[0] }; writeBoard(b2) }
    }
  }
  child.stdout.on('data', onData); child.stderr.on('data', onData)
  child.on('exit', code => {
    previews.delete(t.id)
    if (code && !out.includes('http')) {
      const b2 = readBoard(); const t2 = tkt(b2, t.id)
      if (t2 && t2.stage === 'ready-for-qa') { blockT(t2, 'preview provisioning', 'provision', 'preview command exited ' + code + ':\n' + out.slice(-1200)); writeBoard(b2) }
    }
  })
}

function stopPreview(t) {
  const child = previews.get(t.id)
  if (child) { try { process.kill(-child.pid) } catch { try { child.kill() } catch {} }; previews.delete(t.id) }
  if (t.preview) t.preview = null
}

const mergeLocks = new Map()

export default function mountBoard(app) {
app.get('/api/board', (req, res) => {
  const board = readBoard()
  const project = req.query.project
  // `boardRuns` holds a live ChildProcess under `.child` so a run can be killed. Spreading the
  // whole entry serialised that process — its stdio streams, buffers and internal socket state —
  // into every response, on a list the board polls every 5s per open tab. Only the two fields the
  // client actually renders cross the wire; the handle stays server-side where it is useful.
  const liveOf = id => { const r = boardRuns.get(id); return r ? { kind: r.kind, startedAt: r.startedAt } : null }
  const tickets = board.tickets.filter(t => !project || t.project === project).map(t => ({
    ...t,
    running: liveOf(t.id),
    // A worktree PATH can be chosen before anything is checked out; a worktree that EXISTS is what
    // freezes the branch, the base and the path itself. The client cannot stat, and guessing from
    // stage or run count gets it wrong on exactly the ticket where it matters — so the answer is
    // computed here, where it is one call.
    worktreeCut: !!(t.worktree && fs.existsSync(path.join(t.worktree, '.git'))),
    depBlocked: (t.deps || []).filter(d => { const o = tkt(board, d); return o && !['ready-for-release', 'released'].includes(o.stage) }),
  }))
  res.json({ tickets, teams: board.teams, pipelines: board.pipelines, config: project ? projCfg(board, project) : null })
})

app.post('/api/board/tickets', (req, res) => {
  const { project, title, desc, parent, deps, team, model, type, jiraKey, designDoc, designRefs, sources } = req.body
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'valid project required' })
  if (!title?.trim()) return res.status(400).json({ error: 'title required' })
  const board = readBoard()
  const cfg = projCfg(board, project)
  const pipe = board.pipelines.find(p => p.id === cfg.pipeline) || board.pipelines[0]
  const t = {
    id: 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    project, title: title.trim(), desc: String(desc || '').slice(0, DESC_CAP), type: type || 'feature',
    parent: parent || null, deps: deps || [], team: team || null, model: model || null,
    jiraKey: typeof jiraKey === 'string' && jiraKey ? jiraKey.toUpperCase() : null,
    designDoc: typeof designDoc === 'string' && designDoc ? designDoc : null,
    // Only the three shapes design QA reads. An unchecked passthrough here would let a caller
    // put anything on the ticket and have it read back as a design reference.
    designRefs: designRefs && typeof designRefs === 'object' ? {
      figma: (Array.isArray(designRefs.figma) ? designRefs.figma : []).filter(x => typeof x === 'string').slice(0, 20),
      captures: (Array.isArray(designRefs.captures) ? designRefs.captures : []).filter(x => typeof x === 'string').slice(0, 40),
      contentCsv: typeof designRefs.contentCsv === 'string' ? designRefs.contentCsv : null,
    } : null,
    // What intake managed to follow, so the card can say so without re-reading the description.
    sources: sources && typeof sources === 'object' ? {
      jira: (Array.isArray(sources.jira) ? sources.jira : []).filter(x => typeof x === 'string').slice(0, 10),
      confluence: (Array.isArray(sources.confluence) ? sources.confluence : []).filter(x => typeof x === 'string').slice(0, 10),
      sheet: ['fetched', 'in-repo', 'link-only', 'none'].includes(sources.sheet) ? sources.sheet : 'none',
      unresolved: (Array.isArray(sources.unresolved) ? sources.unresolved : []).filter(x => typeof x === 'string').slice(0, 10),
    } : null,
    designQa: null,
    stage: 'backlog', stages: pipe.stages, pipelineVersion: `${pipe.id}@v${pipe.version}`,
    blocked: null, branch: null, worktree: null, qa: null, qaResults: [], findings: [], runs: [], conflictRisk: [], preview: null, proposal: null,
    history: [{ at: Date.now(), from: null, to: 'backlog', note: 'created' }], createdAt: Date.now(), releasedAt: null,
  }
  board.tickets.push(t); writeBoard(board)
  // The 20k description cap was applied silently; a truncated description that reads as the whole
  // thing is how a requirement goes missing.
  const descCapped = String(desc || '').length > DESC_CAP
  res.json({ ...t, ...(descCapped ? { capped: [{ field: 'desc', cap: DESC_CAP, originalLength: String(desc).length }] } : {}) })
})

// Seven fields used to be copied straight off req.body with no type check, and ANY string was
// accepted as `stage`. BoardSection renders a stage outside the pipeline as an "extra" column, so
// a typo silently created a new column holding one ticket — the ticket looked filed and was
// invisible in the flow everyone else watches.
const FIELD_TYPES = {
  title: v => (typeof v === 'string' && v.trim() ? { ok: true, value: v.trim().slice(0, 500), capped: v.trim().length > 500 } : { ok: false, why: 'must be a non-empty string' }),
  desc: v => (typeof v === 'string' ? { ok: true, value: v.slice(0, 20000), capped: v.length > 20000 } : { ok: false, why: 'must be a string' }),
  team: v => (v === null || typeof v === 'string' ? { ok: true, value: v } : { ok: false, why: 'must be a string or null' }),
  model: v => (v === null || typeof v === 'string' ? { ok: true, value: v } : { ok: false, why: 'must be a string or null' }),
  type: v => (typeof v === 'string' && v ? { ok: true, value: v } : { ok: false, why: 'must be a non-empty string' }),
  deps: v => (Array.isArray(v) && v.every(x => typeof x === 'string') ? { ok: true, value: v } : { ok: false, why: 'must be an array of ticket ids' }),
  qa: v => (v === null || typeof v === 'object' ? { ok: true, value: v } : { ok: false, why: 'must be an object or null' }),
  branch: v => gitRef(v, 'branch'),
  base: v => gitRef(v, 'base'),
  worktree: v => absDir(v),
}

/**
 * Where the checkout goes, or null for the board's own directory.
 *
 * `git worktree add` takes this as a path argument and will happily create it anywhere, so a
 * relative path would resolve against the server's cwd rather than anything the user pictured.
 * Absolute is required for that reason, not for tidiness.
 */
function absDir(v) {
  if (v === null || v === '') return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, why: 'must be a string or null' }
  const s = v.trim().replace(/^~(?=\/|$)/, os.homedir())
  if (!s) return { ok: true, value: null }
  if (!path.isAbsolute(s)) return { ok: false, why: `must be an absolute path (got "${v.trim()}")` }
  if (s.length > 400) return { ok: false, why: 'is too long for a path' }
  if (s.split(path.sep).includes('..')) return { ok: false, why: 'must not contain ".."' }
  return { ok: true, value: s }
}

/**
 * A git ref name, or null to fall back to the project default.
 *
 * These strings are handed to git as arguments, so the check is not cosmetic. Refs are rejected
 * rather than sanitised: silently rewriting `feat/ x` into `feat/x` would create a branch the user
 * did not name and cannot find.
 */
function gitRef(v, what) {
  if (v === null || v === '') return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, why: 'must be a string or null' }
  const s = v.trim()
  if (!s) return { ok: true, value: null }
  if (s.length > 200) return { ok: false, why: 'is too long for a git ref' }
  if (!/^[A-Za-z0-9._\-/]+$/.test(s)) return { ok: false, why: `must be a git ref — letters, digits, and . _ - / only (got "${s}")` }
  if (/^[-/.]|[-/.]$|\.\.|\/\/|\.lock$|@\{/.test(s)) return { ok: false, why: `is not a valid ${what} name — no leading/trailing separators, no "..", no ".lock"` }
  return { ok: true, value: s }
}

const DESC_CAP = 20000

app.patch('/api/board/tickets/:id', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })

  // Compare-and-set. The board polls every 5s and background agents write to it, so two edits
  // landing in the same window silently discarded one of them. `expectedVersion` is optional so
  // existing callers keep working, but when supplied a stale write is refused with both versions
  // named rather than applied over someone else's edit.
  const version = Number(t.version) || 0
  if (req.body.expectedVersion !== undefined && Number(req.body.expectedVersion) !== version) {
    return res.status(409).json({
      error: 'this ticket changed since you loaded it', expectedVersion: Number(req.body.expectedVersion), actualVersion: version,
      detail: 'reload the ticket and reapply your edit — writing now would discard the other change',
    })
  }

  // Branch, base and worktree are answered once, when the worktree is cut. Accepting an edit
  // afterwards would change the label without moving the checkout — the agent would keep
  // committing to the old branch at the old path while the board, the reviewer's diff and the
  // merge all named the new one.
  for (const k of ['branch', 'base', 'worktree']) {
    if (req.body[k] === undefined || req.body[k] === t[k]) continue
    // The `.git` file is the line: a chosen path that nothing has been checked out into yet is
    // still an answer the user is allowed to change their mind about.
    if (t.worktree && fs.existsSync(path.join(t.worktree, '.git'))) {
      return res.status(409).json({
        error: `${k} cannot be changed once the worktree exists`,
        detail: `${t.branch} is checked out at ${t.worktree}. Delete the ticket and re-file it, or rename the branch in git yourself.`,
      })
    }
    // Pointing a second ticket at a directory that already holds a checkout would give two tickets
    // one working copy, and whichever agent ran second would commit over the first one's branch.
    if (k === 'worktree' && req.body[k] && fs.existsSync(path.join(String(req.body[k]).replace(/^~(?=\/|$)/, os.homedir()), '.git'))) {
      return res.status(409).json({
        error: 'that directory already holds a git checkout',
        detail: `${req.body[k]} is already a working copy. Pick an empty path — the board creates the directory itself.`,
      })
    }
  }

  const rejected = [], capped = []
  for (const [k, check] of Object.entries(FIELD_TYPES)) {
    if (req.body[k] === undefined) continue
    const r = check(req.body[k])
    if (!r.ok) { rejected.push({ field: k, why: r.why, got: typeof req.body[k] }); continue }
    if (r.capped) capped.push({ field: k, cap: k === 'desc' ? 20000 : 500 })
    t[k] = r.value
  }
  if (rejected.length) return res.status(400).json({ error: 'some fields were not accepted', rejected })

  if (req.body.stage && req.body.stage !== t.stage) {
    const allowed = Array.isArray(t.stages) ? t.stages.map(x => (typeof x === 'string' ? x : x?.id)).filter(Boolean) : []
    // 'released' is a terminal stage the pipeline may not list explicitly but the code below acts on.
    if (allowed.length && !allowed.includes(req.body.stage) && req.body.stage !== 'released') {
      return res.status(400).json({ error: `"${req.body.stage}" is not a stage in this ticket's pipeline`, allowed, detail: 'an unrecognised stage would render as its own column holding this one ticket' })
    }
    stamp(t, req.body.stage, 'manual move')
    if (req.body.stage === 'released') { t.releasedAt = Date.now(); stopPreview(t) }
  }
  if (req.body.blocked === null && t.blocked) { t.blocked = null; (t.history ||= []).push({ at: Date.now(), from: 'blocked', to: t.stage, note: 'manually unblocked' }) }
  t.version = version + 1
  writeBoard(board)
  // Caps are reported rather than applied silently: a description that came back shorter than it
  // went in should say so, not look like the client's own text.
  res.json({ ...t, ...(capped.length ? { capped } : {}) })
})

/**
 * Delete a ticket, its sub-tickets, and their worktrees.
 *
 * Three things this refuses to do quietly. It will not delete a ticket with a live agent on it —
 * the run would keep writing into a directory that had been removed out from under it. It takes
 * the children with the parent, because a sub-ticket whose parent is gone is unreachable in the UI
 * and holds a worktree open forever. And it does NOT delete branches: the worktree is scaffolding,
 * the commits are work, and no button in a kanban board should be able to throw those away.
 */
app.delete('/api/board/tickets/:id', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.json({ ok: true, removed: 0 })

  const doomed = [t, ...board.tickets.filter(x => x.parent === t.id)]
  const live = doomed.filter(x => boardRuns.has(x.id))
  if (live.length) {
    return res.status(409).json({
      error: `${live.length === 1 && live[0].id === t.id ? 'this ticket has' : 'a sub-ticket has'} an agent running (${live.map(x => boardRuns.get(x.id).kind).join(', ')})`,
      detail: 'wait for it to finish — deleting now would pull the worktree out from under a live run',
    })
  }

  const ids = new Set(doomed.map(x => x.id))
  const branches = []
  for (const x of doomed) {
    stopPreview(x)
    if (x.worktree && fs.existsSync(x.worktree)) gitB(x.project, ['worktree', 'remove', '--force', x.worktree])
    if (x.branch) branches.push(x.branch)
    // The run log outlived the ticket, so Loush Runs kept listing deleted tickets as live runs.
    try { fs.rmSync(path.join(x.project, '.loush', x.id), { recursive: true, force: true }) } catch {}
  }
  board.tickets = board.tickets.filter(x => !ids.has(x.id))
  // A dangling dep silently blocks `start` forever with "blocked by: undefined".
  for (const x of board.tickets) if (x.deps?.some(d => ids.has(d))) x.deps = x.deps.filter(d => !ids.has(d))
  writeBoard(board)
  res.json({ ok: true, removed: ids.size, branchesKept: [...new Set(branches)] })
})

/**
 * Watch a ticket's agent work, live.
 *
 * Board agents run headless through `claude -p`, so nothing streams back to the browser — the run
 * is a black box until it finishes and drops a summary. But the CLI writes its transcript to
 * ~/.claude/projects/<encoded-cwd>/<session>.jsonl as it goes, so "live" is a tail of that file.
 * Nothing about how agents are spawned had to change for this, which is the point: a streaming
 * pipeline through the server would be a second copy of the transcript that can disagree with it.
 *
 * Byte offsets are the cursor. The client sends back the file and offset it last saw; a different
 * file (new session) or an offset past the end (truncation) restarts near the tail rather than
 * replaying a 40MB transcript into the drawer.
 */
const transcriptDirFor = cwd => path.join(CLAUDE, 'projects', String(cwd).replace(/[\\/:._]/g, '-'))
const TAIL_CAP = 512 * 1024

/**
 * The transcript belonging to THIS ticket's agent.
 *
 * Naively taking the most recently modified file in the directory is wrong for any step that runs
 * in the project directory rather than a worktree — `analyze` does — because the human's own
 * session in that repo is also being written, and being written right now it always wins. It
 * showed the user their own transcript, which is a convincing way to be completely wrong.
 *
 * So: a finished run is identified by the session id `claude -p` reported, which is exact. A live
 * run has no id yet, so it is identified by a transcript FILE CREATED after the run started —
 * created, not modified, since that is the part a concurrent session cannot fake.
 */
function transcriptFor(t, running) {
  const cwd = t.worktree || t.project
  let files
  try {
    const dir = transcriptDirFor(cwd)
    files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => {
      const p = path.join(dir, f)
      const st = fs.statSync(p)
      return { p, id: f.replace(/\.jsonl$/, ''), m: st.mtimeMs, born: st.birthtimeMs || st.ctimeMs }
    })
  } catch { return null }
  if (!files.length) return null

  if (running) {
    const born = files.filter(x => x.born >= running.startedAt - 5000).sort((a, b) => b.m - a.m)[0]
    // A worktree is this ticket's alone, so before the file exists the newest there is still ours.
    return born?.p || (t.worktree ? files.sort((a, b) => b.m - a.m)[0].p : null)
  }
  const sid = (t.runs || []).slice().reverse().find(r => r.sessionId)?.sessionId
  if (sid) return files.find(x => x.id === sid)?.p || null
  return t.worktree ? files.sort((a, b) => b.m - a.m)[0].p : null
}

/**
 * A transcript record, trimmed for transport.
 *
 * The client renders these with the same `buildBlocks`/`MessageLog` the Chat section uses, so the
 * shape has to stay the shape those expect — this only bounds it. Tool results are the reason:
 * a single `Read` of a large file is megabytes, and a poll every two seconds would ship the same
 * megabytes again. 20k matches what the renderer keeps anyway.
 */
const RESULT_CAP = 20_000
const capContent = c => {
  if (typeof c === 'string') return c.length > RESULT_CAP ? c.slice(0, RESULT_CAP) + `\n… (${c.length - RESULT_CAP} more chars)` : c
  try { const s = JSON.stringify(c); return s.length > RESULT_CAP ? s.slice(0, RESULT_CAP) + '…' : c } catch { return c }
}
function trimRecord(j) {
  if (!j || typeof j !== 'object') return null
  const base = { type: j.type, timestamp: j.timestamp || null, parent_tool_use_id: j.parent_tool_use_id || null }
  if (j.type === 'result') return { ...base, duration_ms: j.duration_ms, total_cost_usd: j.total_cost_usd }
  if (!j.message) return null
  const m = j.message
  const content = Array.isArray(m.content)
    ? m.content.map(c => (c?.type === 'tool_result' ? { ...c, content: capContent(c.content) } : c))
    : m.content
  const out = { ...base, message: { role: m.role, model: m.model, usage: m.usage, content } }
  if (j.toolUseResult && typeof j.toolUseResult === 'object') {
    out.toolUseResult = { status: j.toolUseResult.status, interrupted: j.toolUseResult.interrupted }
  }
  return out
}

app.get('/api/board/tickets/:id/live', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  const run = boardRuns.get(t.id) || null
  const running = run ? { kind: run.kind, startedAt: run.startedAt } : null
  const file = transcriptFor(t, running)
  if (!file) {
    return res.json({
      running, file: null, offset: 0, events: [],
      note: running ? 'the agent has started but has not written its transcript yet' : 'no agent session has run in this worktree yet',
    })
  }

  let size = 0
  try { size = fs.statSync(file).size } catch { return res.json({ running, file: null, offset: 0, events: [] }) }
  let offset = Number(req.query.offset) || 0
  if (req.query.file !== file || offset > size || offset < 0) offset = Math.max(0, size - TAIL_CAP)

  let chunk = ''
  if (size > offset) {
    const fd = fs.openSync(file, 'r')
    try {
      const len = Math.min(size - offset, TAIL_CAP)
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, offset)
      chunk = buf.toString('utf8')
    } finally { fs.closeSync(fd) }
  }
  // A read can land mid-line. The cursor advances only to the last complete line, so the remainder
  // is re-read next poll instead of being parsed as truncated JSON and dropped.
  const lastNl = chunk.lastIndexOf('\n')
  const consumed = lastNl < 0 ? 0 : lastNl + 1
  const events = []
  for (const line of chunk.slice(0, consumed).split('\n')) {
    if (!line.trim()) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    const rec = trimRecord(j)
    if (rec) events.push(rec)
  }
  res.json({ running, file, offset: offset + consumed, events: events.slice(-300), atEnd: offset + consumed >= size })
})

/**
 * Stop the agent on this ticket.
 *
 * There is no pause: `claude -p` is a one-shot process with no suspend that keeps its place, and
 * SIGSTOP would freeze it holding its context, its file handles and its API connection open
 * indefinitely — a "pause" you could never safely resume from. So it is stopped for real, and the
 * session id is captured from the live transcript first, which is what makes it resumable: the
 * killed process never gets to report that id itself.
 */
/** Stop one ticket's agent. Mutates `board` (caller writes); returns what was stopped, or null. */
function stopRun(board, t) {
  const run = boardRuns.get(t.id)
  if (!run) return null
  const file = transcriptFor(t, { startedAt: run.startedAt })
  t.resumeSessionId = file ? path.basename(file, '.jsonl') : null
  t.stoppedAt = Date.now()
  ;(t.history ||= []).push({ at: Date.now(), from: t.stage, to: t.stage, note: `${run.kind} agent stopped after ${Math.round((Date.now() - run.startedAt) / 1000)}s` })
  const child = run.child
  if (child) {
    try { child.kill('SIGTERM') } catch {}
    // SIGTERM is a request. A child that ignores it keeps running and keeps spending, so the
    // escalation is scheduled rather than hoped for.
    setTimeout(() => { try { if (boardRuns.get(t.id)?.child === child) child.kill('SIGKILL') } catch {} }, 5000).unref?.()
  }
  return { id: t.id, title: t.title, kind: run.kind, resumeSessionId: t.resumeSessionId, hadProcess: !!child }
}

app.post('/api/board/tickets/:id/stop', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  const stopped = stopRun(board, t)
  if (!stopped) return res.status(400).json({ error: 'nothing is running on this ticket' })
  writeBoard(board)
  res.json({ ok: true, ...stopped, note: stopped.hadProcess ? undefined : 'the run was marked stopped, but its process had not started yet' })
})

/**
 * Stop every running agent, optionally scoped to one project.
 *
 * The single-ticket stop is the same call made from a screen where you already know which ticket
 * you mean. This one is for the case where you do not — a fan-out that started five children, a
 * loop you want out of, a laptop about to go in a bag — and hunting them down one card at a time
 * is exactly when you would miss one and leave it spending.
 */
app.post('/api/board/stop-all', (req, res) => {
  const board = readBoard()
  const project = req.body?.project ? path.resolve(String(req.body.project)) : null
  const targets = board.tickets.filter(t => boardRuns.has(t.id) && (!project || t.project === project))
  const stopped = targets.map(t => stopRun(board, t)).filter(Boolean)
  if (stopped.length) writeBoard(board)
  const orphans = project ? [] : reapOrphanAgents()
  res.json({ ok: true, stopped: stopped.length, runs: stopped, orphansKilled: orphans })
})

/**
 * Agents this server has lost the handle to.
 *
 * `boardRuns` lives in memory, so a server restart — a crash, a `node --watch` reload after an
 * edit — forgets every child it spawned while the children keep running, keep editing worktrees
 * and keep spending. They are invisible to the board and unkillable from the UI: the exact thing
 * "stop all" exists to prevent. Found one live in the wild while testing this, 11 minutes after
 * the run that started it had vanished from the dashboard.
 *
 * Matched on the board's own prompt preamble, which no interactive session has, so an interactive
 * `claude` the user is typing into is never a candidate.
 */
function reapOrphanAgents() {
  const killed = []
  try {
    const out = spawnSync('ps', ['-Ao', 'pid=,command='], { encoding: 'utf8', timeout: 8000 }).stdout || ''
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line)
      if (!m) continue
      const [, pid, cmd] = m
      if (!/^claude -p /.test(cmd)) continue
      if (!/isolated git worktree on branch|Senior code review of this branch|You are a QA agent|You are a design QA agent|propose a breakdown into independently-workable/.test(cmd)) continue
      if ([...boardRuns.values()].some(r => String(r.child?.pid) === pid)) continue   // tracked, already handled above
      try { process.kill(Number(pid), 'SIGTERM'); killed.push(Number(pid)) } catch {}
    }
  } catch {}
  return killed
}

app.post('/api/board/tickets/:id/analyze', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'a run is already active on this ticket' })
  const { model } = teamStage(board, t, 'dev')
  boardRuns.set(t.id, { kind: 'analyze', startedAt: Date.now() })
  res.json({ ok: true })
  ;(async () => {
    const prompt = `Analyze this ticket and propose a breakdown into independently-workable sub-tickets (e.g. "add API endpoint", "add frontend form", "write migration"). Explore the codebase briefly to ground the breakdown.\n\n## Ticket: ${t.title}\n${t.desc}\n\nReturn ONLY a JSON array: [{"title": "...", "desc": "1-3 sentence scope incl. likely files", "deps": [indices of sub-tickets this one is blocked by]}]. 2-6 sub-tickets; fewer is better.`
    const r = await runAgent({ transcriptDir: runTranscriptDir(t.id, boardRuns.get(t.id)?.kind || 'agent'), onSpawn: c => { const live = boardRuns.get(t.id); if (live) live.child = c; markRunPersisted(t.id, live?.kind, c.pid) }, cwd: t.project, prompt, model, timeoutMs: 300_000 })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    // Cleared on THIS snapshot, not through a separate read-modify-write. `b2` was read before any
    // such write, so `writeBoard(b2)` at the end of this block would put the marker straight back —
    // which is exactly what happened on the AIR-10733 review: the run ended, the marker survived,
    // and the next restart would have reported a finished agent as orphaned.
    clearRunMarker(t2)
    recordRun(t2, 'analyze', model, r, { passed: ['ticket title+desc', 'codebase (agent-explored)'], excluded: ['prior tickets', 'chat history'] })
    // Same rule as every other path: a limit notice is not a breakdown of zero sub-tickets.
    t2.proposal = unfinishedReason(r.result, r.error) ? null : (extractJson(r.result) || []).filter(s => s.title).slice(0, 8)
    writeBoard(b2)
  })().catch(() => { boardRuns.delete(t.id); clearRunPersisted(t.id) })
})

app.post('/api/board/tickets/:id/breakdown', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  const subs = (req.body.subs || []).filter(s => s.title?.trim())
  const ids = subs.map(() => 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5))
  subs.forEach((s, i) => board.tickets.push({
    id: ids[i], project: t.project, title: s.title.trim(), desc: String(s.desc || ''), type: 'sub', parent: t.id,
    // Not `jiraKey`: AIR-10817-2 is a branch name, not an issue anyone can open. It exists so a
    // sub-ticket's branch reads as part of its parent's work instead of as a random board id.
    branchKey: t.jiraKey ? `${t.jiraKey}-${i + 1}` : null, designRefs: t.designRefs || null,
    deps: (s.deps || []).map(d => ids[d]).filter(Boolean), team: t.team, model: t.model,
    stage: 'backlog', stages: t.stages, pipelineVersion: t.pipelineVersion,
    blocked: null, branch: null, worktree: null, qa: null, qaResults: [], findings: [], runs: [], conflictRisk: [], preview: null, proposal: null,
    history: [{ at: Date.now(), from: null, to: 'backlog', note: 'from breakdown of ' + t.id }], createdAt: Date.now(), releasedAt: null,
  }))
  t.proposal = null
  writeBoard(board); res.json({ ok: true, created: ids.length })
})

/**
 * Acknowledge, reclassify, or reopen a single finding.
 *
 * The missing half of the loop: a finding can be true, unfixable by an agent, and still need to
 * stop blocking. Three of AIR-10733's round-three findings were exactly that — a GTM container
 * value only Avo can register, Figma fidelity that needs design QA, a package another team
 * publishes — and with nowhere to put that judgement they were re-raised every round forever.
 * Acknowledging is a decision with a name on it, so it is recorded rather than silently dropped.
 */
app.post('/api/board/tickets/:id/findings/:findingId', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  const f = (t.findings || []).find(x => x.id === req.params.findingId)
  if (!f) return res.status(404).json({ error: 'no such finding on this ticket' })
  const { status, class: cls, note } = req.body || {}
  if (status && !['open', 'acked'].includes(status)) return res.status(400).json({ error: 'status must be open or acked' })
  if (cls && !FIND_CLASSES.has(cls)) return res.status(400).json({ error: `class must be one of ${[...FIND_CLASSES].join(', ')}` })
  if (status) f.status = status
  if (cls) f.class = cls
  if (note !== undefined) f.ackNote = note || null
  f.decidedAt = Date.now()
  writeBoard(board)
  res.json({ ok: true, finding: f, blocking: blockingFindings(t).length })
})

app.post('/api/board/tickets/:id/start', (req, res) => startTicket(req.params.id, req.body, res))

app.post('/api/board/tickets/:id/review', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t?.worktree) return res.status(400).json({ error: 'no worktree — start the ticket first' })
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'already running' })
  const { model, instructions } = teamStage(board, t, 'review')
  const cfg = projCfg(board, t.project)
  const devRun = (t.runs || []).filter(r => r.kind === 'dev').pop()
  boardRuns.set(t.id, { kind: 'review', startedAt: Date.now() })
  writeBoard(board)
  res.json({ ok: true })
  ;(async () => {
    const prompt = [
      `Senior code review of this branch. Run \`git diff ${baseOf(board, t)}...HEAD\` and review the changes against the ticket. ${instructions}`,
      `\n## Ticket: ${t.title}\n${t.desc}`,
      devRun ? '\n## Dev agent summary of what it did\n' + devRun.summary : '',
      // `class` is what stops the loop re-raising things it cannot act on. Without it the reviewer
      // kept returning "needs Avo sign-off" and "compare against Figma" every round, the fix agent
      // could do nothing with either, and the count never reached zero.
      '\nClassify every finding:',
      '  · "code" — fixable by editing this branch. Only these are sent to the fix agent.',
      '  · "needs-human" — real, but needs a decision or access outside this repo (third-party config, design sign-off, another team\'s release).',
      '  · "pre-existing" — already true on the base branch; this change did not cause it.',
      '\nReturn ONLY JSON: [{"severity": "critical|high|medium|low", "class": "code|needs-human|pre-existing", "file": "path", "summary": "one sentence"}]. Empty array [] if clean. critical/high = must fix before QA.',
    ].filter(Boolean).join('\n')
    const r = await runAgent({ transcriptDir: runTranscriptDir(t.id, boardRuns.get(t.id)?.kind || 'agent'), onSpawn: c => { const live = boardRuns.get(t.id); if (live) live.child = c; markRunPersisted(t.id, live?.kind, c.pid) }, cwd: t.worktree, prompt, model, timeoutMs: 900_000 })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    // Cleared on THIS snapshot, not through a separate read-modify-write. `b2` was read before any
    // such write, so `writeBoard(b2)` at the end of this block would put the marker straight back —
    // which is exactly what happened on the AIR-10733 review: the run ended, the marker survived,
    // and the next restart would have reported a finished agent as orphaned.
    clearRunMarker(t2)
    recordRun(t2, 'review', model, r, { passed: ['diff vs ' + baseOf(b2, t2), 'ticket', 'dev agent summary'], excluded: ['dev agent raw transcript'] })
    // The promotion bug. A review that never ran extracts no JSON, so it produced no findings, so
    // the verdict was `advance` and the ticket was stamped ready-for-qa on nothing at all. It must
    // block like an error and never reach convergenceVerdict: a verdict computed from an agent that
    // did not run is not a weak verdict, it is a meaningless one.
    const unfinished = unfinishedReason(r.result, r.error)
    if (unfinished) blockT(t2, 'review agent', r.error ? 'agent-error' : 'agent-unfinished', unfinished)
    else {
      const sha = headShaOf(t2)
      t2.findings = mergeFindings(t2.findings, (extractJson(r.result) || []).filter(f => f.summary), sha)
      t2.reviewedSha = sha
      const blocking = blockingFindings(t2)
      const openCode = openCodeFindings(t2)
      const parked = (t2.findings || []).filter(f => f.status === 'open' && f.class !== 'code').length
      // The round is recorded BEFORE the verdict, because the verdict is about the trend and this
      // review is part of it.
      ;(t2.reviewRounds ||= []).push({ at: Date.now(), sha, worst: worstOf(blocking), open: openCode.length, blocking: blocking.length })
      const spend = (t2.runs || []).reduce((s, x) => s + (x.cost || 0), 0)
      const verdict = convergenceVerdict({ rounds: t2.reviewRounds.slice(0, -1), blocking, openCode, spend, budget: cfg.costCap || 0 })
      t2.verdict = { ...verdict, at: Date.now() }
      if (verdict.action === 'advance') {
        stamp(t2, 'ready-for-qa', `${verdict.reason}${parked ? `, ${parked} parked for a human` : ''} — idle until you run QA`)
        startPreview(b2, t2)
      } else if (verdict.action === 'stalled' || verdict.action === 'budget') {
        // A named stop. The previous cap said only "3 iterations", which read as a tooling limit
        // rather than as "this is not converging and needs a decision".
        blockT(t2, 'review loop', verdict.action === 'budget' ? 'cost-cap' : 'not-converging', verdict.reason)
        stamp(t2, 'code-review', verdict.reason)
      } else stamp(t2, 'code-review', `${blocking.length} blocking finding${blocking.length === 1 ? '' : 's'}${parked ? ` (+${parked} parked)` : ''}`)
    }
    writeBoard(b2)
  })().catch(() => { boardRuns.delete(t.id); clearRunPersisted(t.id) })
})

app.post('/api/board/tickets/:id/fix', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  // Counted the raw list before, which included findings already attempted and awaiting a
  // re-review — so a second fix could be launched against work whose outcome was still unknown.
  if (!t || !openCodeFindings(t).length) {
    const attempted = (t?.findings || []).filter(f => f.status === 'fix-attempted').length
    return res.status(400).json({ error: attempted ? `${attempted} finding(s) already addressed and awaiting re-review — run the review first` : 'no actionable findings to fix' })
  }
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'already running' })
  // The hard ceiling stays as a backstop, but the real stop is the convergence verdict written by
  // the review — a count of iterations cannot tell "two rounds and nearly clean" from "two rounds
  // and going backwards", and blocking on the count alone stops the first as readily as the second.
  if (t.verdict && ['stalled', 'budget'].includes(t.verdict.action)) return res.status(400).json({ error: t.verdict.reason, verdict: t.verdict.action })
  const fixes = (t.runs || []).filter(r => r.kind === 'fix').length
  if (fixes >= 6) { blockT(t, 'fix loop', 'max-iterations', '6 fix runs on one ticket — take over manually'); writeBoard(board); return res.status(400).json({ error: 'max fix iterations hit — ticket blocked' }) }
  const { model } = teamStage(board, t, 'dev')
  const cfg = projCfg(board, t.project)
  stamp(t, 'fixing', 'auto-fixing review findings (' + (fixes + 1) + '/3)')
  boardRuns.set(t.id, { kind: 'fix', startedAt: Date.now() })
  writeBoard(board)
  res.json({ ok: true })
  ;(async () => {
    // Highest open severity only, not the whole list. Handing over all nine findings at once is
    // how round 2 on AIR-10733 turned a cosmetic "the layout flashes" note into a card that
    // rendered zero flight legs: the agent rewrote 140 lines of a container it had no need to
    // touch. One severity band per run, re-reviewed in between, keeps the blast radius readable.
    const actionable = openCodeFindings(t)
    const band = ['critical', 'high', 'medium', 'low'].find(s => actionable.some(f => f.severity === s))
    const batch = actionable.filter(f => f.severity === band)
    const prompt = `Fix these code-review findings on the current branch (diff vs ${baseOf(board, t)}). Commit the fixes. Do NOT re-architect — address the findings only, and change nothing the findings do not name.\n\n## Ticket: ${t.title}\n\n## Findings (${band} severity — other findings are deliberately withheld this round)\n${batch.map(f => `- [${f.severity}] ${f.file}: ${f.summary}`).join('\n')}`
    const r = await runAgent({ transcriptDir: runTranscriptDir(t.id, boardRuns.get(t.id)?.kind || 'agent'), onSpawn: c => { const live = boardRuns.get(t.id); if (live) live.child = c; markRunPersisted(t.id, live?.kind, c.pid) }, cwd: t.worktree, prompt, model, resume: (t.runs || []).filter(x => x.kind === 'dev' && x.sessionId).pop()?.sessionId })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    // Cleared on THIS snapshot, not through a separate read-modify-write. `b2` was read before any
    // such write, so `writeBoard(b2)` at the end of this block would put the marker straight back —
    // which is exactly what happened on the AIR-10733 review: the run ended, the marker survived,
    // and the next restart would have reported a finished agent as orphaned.
    clearRunMarker(t2)
    recordRun(t2, 'fix', model, r, { passed: ['findings', 'original diff context (resumed session when possible)'], excluded: ['full codebase re-read'] })
    const unfinished = unfinishedReason(r.result, r.error)
    if (unfinished) blockT(t2, 'fix agent', r.error ? 'agent-error' : 'agent-unfinished', unfinished)
    // Marked attempted, NOT deleted. Emptying the list threw away the only record of what each
    // round had addressed, so the next review's output could not be compared with the last one's —
    // which is precisely what made 9 → 8 → 9 indistinguishable from progress. The re-review is what
    // decides whether these are genuinely gone; until it runs they are claims, not outcomes.
    else {
      const attempted = new Set(batch.map(f => f.id))
      t2.findings = (t2.findings || []).map(f => (attempted.has(f.id) ? { ...f, status: 'fix-attempted', fixAttemptedAt: Date.now() } : f))
      stamp(t2, 'code-review', `${batch.length} ${band} finding${batch.length === 1 ? '' : 's'} addressed — re-review to confirm`)
    }
    writeBoard(b2)
  })().catch(() => { boardRuns.delete(t.id); clearRunPersisted(t.id) })
})

app.post('/api/board/tickets/:id/preview', (req, res) => { const b = readBoard(); const t = tkt(b, req.params.id); if (!t) return res.status(404).json({ error: 'no such ticket' }); startPreview(b, t); writeBoard(b); res.json({ ok: true }) })

app.delete('/api/board/tickets/:id/preview', (req, res) => { const b = readBoard(); const t = tkt(b, req.params.id); if (t) { stopPreview(t); writeBoard(b) } res.json({ ok: true }) })
setInterval(() => {
  const b = readBoard(); let dirty = false
  for (const t of b.tickets) if (t.preview && Date.now() - t.preview.startedAt > projCfg(b, t.project).previewIdleMin * 60_000) { stopPreview(t); dirty = true }
  if (dirty) writeBoard(b)
}, 600_000).unref()

/**
 * Design QA — the built screen against the design and the agreed copy, before functional QA.
 *
 * Failures come back as review findings rather than filed bugs on purpose: a wrong gap, a wrong
 * token or the wrong string is the same kind of defect the fix loop already knows how to close,
 * and routing it there keeps one repair path instead of two. Functional QA files bugs because a
 * failing user journey usually is not a one-line fix.
 */
app.post('/api/board/tickets/:id/designqa', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t?.worktree) return res.status(400).json({ error: 'no worktree — start the ticket first' })
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'already running' })
  const refs = t.designRefs || {}
  if (!refs.figma?.length && !refs.captures?.length && !refs.contentCsv) {
    return res.status(400).json({ error: 'no design references on this ticket — nothing to compare against' })
  }
  const { model, instructions } = teamStage(board, t, 'qa')
  const baseUrl = t.qa?.baseUrl || t.preview?.url || ''
  boardRuns.set(t.id, { kind: 'designqa', startedAt: Date.now() })
  writeBoard(board)
  res.json({ ok: true })
  ;(async () => {
    const prompt = [
      `You are a design QA agent. Compare what this branch actually renders against the design and the agreed copy. Check layout, spacing, states, and every user-visible string.`,
      instructions,
      `\n## Ticket: ${t.title}\n${t.desc}`,
      baseUrl ? `\n## Running app\n${baseUrl} — open it with your browser tools and inspect the real thing.`
        : `\n## Running app\n(none provisioned — read the components in this worktree instead and say so in the evidence)`,
      refs.figma?.length ? `\n## Design\n${refs.figma.join('\n')}\nOpen these with your browser tools. Read the design in Dev Mode; do NOT select a whole section, the token cost is prohibitive — go frame by frame.` : '',
      refs.captures?.length ? `\n## Local design captures (screenshots + annotations already pulled)\n${refs.captures.join('\n')}` : '',
      refs.contentCsv ? `\n## Agreed copy — this file is the source of truth for every string\n${refs.contentCsv}` : '',
      `\nReport ONLY differences you can point at. Return ONLY JSON: {"cases": [{"name": "...", "pass": true|false, "severity": "critical|high|medium|low", "file": "component path if known", "evidence": "what the design says vs what the build does, ≤300 chars"}]}`,
    ].filter(Boolean).join('\n')
    const r = await runAgent({ transcriptDir: runTranscriptDir(t.id, boardRuns.get(t.id)?.kind || 'agent'), onSpawn: c => { const live = boardRuns.get(t.id); if (live) live.child = c; markRunPersisted(t.id, live?.kind, c.pid) }, cwd: t.worktree, prompt, model, timeoutMs: 1800_000 })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    // Cleared on THIS snapshot, not through a separate read-modify-write. `b2` was read before any
    // such write, so `writeBoard(b2)` at the end of this block would put the marker straight back —
    // which is exactly what happened on the AIR-10733 review: the run ended, the marker survived,
    // and the next restart would have reported a finished agent as orphaned.
    clearRunMarker(t2)
    recordRun(t2, 'designqa', model, r, { passed: ['ticket', 'figma links', 'local captures', 'content sheet', 'running app'], excluded: ['code-review findings'] })
    // Without this an unfinished run yields zero cases, and zero failed cases stamps ready-for-qa
    // with `designQa.pass = true` — a design sign-off nobody performed.
    const unfinished = unfinishedReason(r.result, r.error)
    if (unfinished) { blockT(t2, 'design QA agent', r.error ? 'agent-error' : 'agent-unfinished', unfinished); return writeBoard(b2) }
    const cases = (extractJson(r.result)?.cases || []).slice(0, 60)
    const failed = cases.filter(c => c.pass === false)
    // Only a PASS is recorded on the ticket. `designQa` is the "this build was checked against the
    // design" marker, so leaving a failed one set would let the fix that closes it ship without
    // anyone looking at the design again — the fix loop must come back through here.
    t2.designQa = failed.length ? null : { at: Date.now(), pass: true, cases }
    if (failed.length) {
      t2.findings = failed.map(c => ({ severity: c.severity || 'high', file: c.file || '(design)', summary: `design: ${c.name} — ${c.evidence || ''}`.slice(0, 300), at: Date.now() }))
      stamp(t2, 'code-review', `${failed.length} design QA failure${failed.length === 1 ? '' : 's'} — back to the fix loop`)
    } else stamp(t2, 'ready-for-qa', `design QA clean (${cases.length} checks) — functional QA next`)
    writeBoard(b2)
  })().catch(() => { boardRuns.delete(t.id); clearRunPersisted(t.id) })
})

app.post('/api/board/tickets/:id/qa', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t?.worktree) return res.status(400).json({ error: 'no worktree — start the ticket first' })
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'already running' })
  const pipe = board.pipelines.find(p => p.id === projCfg(board, t.project).pipeline) || board.pipelines[0]
  const wip = pipe.wip?.['qa-running']
  if (wip && board.tickets.filter(x => x.project === t.project && x.stage === 'qa-running').length >= wip) return res.status(400).json({ error: `WIP limit for qa-running is ${wip}` })
  t.qa = { ...(t.qa || {}), ...req.body }
  const cfg = projCfg(board, t.project)
  const { model, instructions } = teamStage(board, t, 'qa')
  const files = changedFiles(t.project, baseOf(board, t), t.branch || 'HEAD')
  stamp(t, 'qa-running', 'QA agent started')
  boardRuns.set(t.id, { kind: 'qa', startedAt: Date.now() })
  writeBoard(board)
  res.json({ ok: true })
  ;(async () => {
    const prompt = [
      `You are a QA agent. From the ticket below, derive acceptance criteria (if not given) and a concrete test-case list (functional, edge cases, regression-relevant). Execute each case: API assertions via curl, UI flows via browser tools if available — otherwise mark them "manual" with exact steps. Capture evidence (response bodies, observed text).`,
      instructions,
      `\n## Ticket: ${t.title}\n${t.desc}`,
      `\n## Changed files (focus tests here)\n${files.slice(0, 40).join('\n') || '(unknown)'}`,
      `\n## Environment\nbase URL: ${t.qa.baseUrl || '(none — API/unit-level checks only)'}\nenv: ${t.qa.env || 'staging'}\nscope: ${t.qa.scope || 'whole ticket'}\nlogin/notes: ${t.qa.notes || '-'}`,
      cfg.qaSeesFindings && t.findings?.length ? '\n## Code-review findings (user opted QA in)\n' + t.findings.map(f => `- ${f.summary}`).join('\n') : '',
      '\nReturn ONLY JSON: {"cases": [{"name": "...", "kind": "ui|api|manual", "pass": true|false, "severity": "critical|high|medium|low", "evidence": "≤300 chars"}]}',
    ].filter(Boolean).join('\n')
    const r = await runAgent({ transcriptDir: runTranscriptDir(t.id, boardRuns.get(t.id)?.kind || 'agent'), onSpawn: c => { const live = boardRuns.get(t.id); if (live) live.child = c; markRunPersisted(t.id, live?.kind, c.pid) }, cwd: t.worktree, prompt, model, timeoutMs: 1800_000 })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    // Cleared on THIS snapshot, not through a separate read-modify-write. `b2` was read before any
    // such write, so `writeBoard(b2)` at the end of this block would put the marker straight back —
    // which is exactly what happened on the AIR-10733 review: the run ended, the marker survived,
    // and the next restart would have reported a finished agent as orphaned.
    clearRunMarker(t2)
    recordRun(t2, 'qa', model, r, { passed: ['ticket+AC', 'changed files list', 'preview URL + QA inputs', ...(cfg.qaSeesFindings ? ['review findings (opt-in)'] : [])], excluded: cfg.qaSeesFindings ? [] : ['code-review findings'] })
    // Same hazard as design QA: zero cases with zero failures used to stamp ready-for-release.
    const unfinished = unfinishedReason(r.result, r.error)
    if (unfinished) return blockT(t2, 'QA agent', r.error ? 'agent-error' : 'agent-unfinished', unfinished), writeBoard(b2)
    const cases = (extractJson(r.result)?.cases || []).slice(0, 60)
    const failed = cases.filter(c => c.pass === false)
    ;(t2.qaResults ||= []).push({ at: Date.now(), cases, pass: !failed.length })
    if (failed.length) {
      stamp(t2, 'bug-reported', `${failed.length} QA failure${failed.length === 1 ? '' : 's'} — bugs filed`)
      for (const c of failed.slice(0, 5)) b2.tickets.push({
        id: 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        project: t2.project, title: 'QA bug: ' + c.name, type: 'bug', parent: t2.id,
        desc: `QA-found on ${t2.branch} @ ${gitB(t2.project, ['rev-parse', '--short', t2.branch]).stdout?.toString().trim() || '?'}\nseverity: ${c.severity || 'medium'}\n\nrepro / evidence:\n${c.evidence || '(see QA run)'}`,
        qaEvidence: c.evidence || '', deps: [], team: t2.team, model: t2.model,
        stage: 'backlog', stages: t2.stages, pipelineVersion: t2.pipelineVersion,
        blocked: null, branch: t2.branch, worktree: t2.worktree, qa: t2.qa, qaResults: [], findings: [], runs: [], conflictRisk: [], preview: null, proposal: null,
        history: [{ at: Date.now(), from: null, to: 'backlog', note: 'auto-filed by QA on ' + t2.id }], createdAt: Date.now(), releasedAt: null,
      })
    } else stamp(t2, 'ready-for-release', 'QA clean — human release gate')
    writeBoard(b2)
  })().catch(() => { boardRuns.delete(t.id); clearRunPersisted(t.id) })
})

app.post('/api/board/tickets/:id/release', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  const cfg = projCfg(board, t.project)
  const base = baseOf(board, t)
  if (cfg.requirePr) {
    stamp(t, 'released', 'marked released (PR flow)'); t.releasedAt = Date.now(); stopPreview(t); writeBoard(board)
    // The branch only exists locally — nothing here has ever pushed it — so a bare `gh pr create`
    // would fail on a head that GitHub has never seen. The push is part of the command, and the
    // command is still handed to a human to run: this endpoint publishes nothing by itself.
    return res.json({
      ok: true,
      prCmd: `cd ${t.project} && git push -u origin ${t.branch} && gh pr create --head ${t.branch} --base ${base} --title "${t.title.replace(/"/g, '')}" --body "Ticket ${t.id}"`,
    })
  }
  const prev = mergeLocks.get(t.project) || Promise.resolve()
  const job = prev.then(() => {
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    if (!t2?.branch) return
    const dirty = gitB(t2.project, ['status', '--porcelain']).stdout.toString().trim()
    if (dirty) { blockT(t2, 'merge', 'merge-conflict', 'main working tree is dirty — commit or stash before releasing'); writeBoard(b2); return }
    gitB(t2.project, ['checkout', base])
    const reb = gitSafe(t2.worktree, ['rebase', base], { timeout: 120_000 })
    if (reb.status !== 0) {
      const hunks = gitSafe(t2.worktree, ['diff'], { timeout: 30_000 }).stdout.slice(0, 3000)
      gitSafe(t2.worktree, ['rebase', '--abort'], { timeout: 30_000 })
      blockT(t2, 'merge', 'merge-conflict', 'rebase onto ' + base + ' conflicts:\n' + (reb.stderr.toString().slice(0, 500) || '') + '\n' + hunks)
      writeBoard(b2); return
    }
    const method = cfg.mergeMethod === 'squash' ? ['merge', '--squash', t2.branch] : cfg.mergeMethod === 'rebase' ? ['merge', '--ff-only', t2.branch] : ['merge', '--no-ff', '-m', `merge: ${t2.title} (${t2.id})`, t2.branch]
    const m = gitB(t2.project, method, 120_000)
    if (m.status !== 0) { gitB(t2.project, ['merge', '--abort']); blockT(t2, 'merge', 'merge-conflict', m.stderr.toString().slice(0, 2000)); writeBoard(b2); return }
    if (cfg.mergeMethod === 'squash') gitB(t2.project, ['commit', '-m', `${t2.title} (${t2.id})`])
    const sha = gitB(t2.project, ['rev-parse', '--short', 'HEAD']).stdout.toString().trim()
    stamp(t2, 'released', `merged ${t2.branch} → ${base} @ ${sha} (${cfg.mergeMethod})`)
    t2.releasedAt = Date.now(); stopPreview(t2)
    if (t2.worktree && fs.existsSync(t2.worktree)) gitB(t2.project, ['worktree', 'remove', '--force', t2.worktree])
    writeBoard(b2)
  }).catch(() => {})
  mergeLocks.set(t.project, job)
  job.then(() => { if (mergeLocks.get(t.project) === job) mergeLocks.delete(t.project) })
  res.json({ ok: true, queued: true })
})

app.post('/api/board/tickets/:id/unblock', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t?.blocked) return res.status(400).json({ error: 'ticket is not blocked' })
  const lastSession = (t.runs || []).filter(r => r.sessionId).pop()?.sessionId
  t.blocked = null
  t.stage = 'backlog'
  ;(t.history ||= []).push({ at: Date.now(), from: 'blocked', to: 'backlog', note: 'unblocked with reply' })
  writeBoard(board)
  startTicket(t.id, { reply: req.body.reply || '', resume: lastSession }, res)
})

app.post('/api/board/teams', (req, res) => {
  const board = readBoard(); const team = req.body
  if (!team.name?.trim()) return res.status(400).json({ error: 'name required' })
  const existing = board.teams.find(x => x.id === team.id)
  if (existing) Object.assign(existing, team, { version: (existing.version || 1) + 1 })
  else board.teams.push({ ...team, id: 'team' + Date.now().toString(36), version: 1 })
  writeBoard(board); res.json({ ok: true })
})

app.delete('/api/board/teams/:id', (req, res) => { const b = readBoard(); b.teams = b.teams.filter(x => x.id !== req.params.id); writeBoard(b); res.json({ ok: true }) })

app.post('/api/board/pipelines', (req, res) => {
  const board = readBoard(); const p = req.body
  if (!p.name?.trim() || !p.stages?.length) return res.status(400).json({ error: 'name and stages required' })
  const existing = board.pipelines.find(x => x.id === p.id)
  if (existing) Object.assign(existing, p, { version: (existing.version || 1) + 1 })
  else board.pipelines.push({ ...p, id: 'pipe' + Date.now().toString(36), version: 1 })
  writeBoard(board); res.json({ ok: true })
})

app.post('/api/board/config', (req, res) => {
  const { project, ...cfg } = req.body
  if (!project) return res.status(400).json({ error: 'project required' })
  const board = readBoard()
  board.projects[project] = { ...projCfg(board, project), ...cfg }
  writeBoard(board); res.json(board.projects[project])
})

app.get('/api/board/analytics', (req, res) => {
  const board = readBoard()
  const days = Number(req.query.days) || 30
  const since = Date.now() - days * 86400_000
  const tickets = board.tickets.filter(t => (!req.query.project || t.project === req.query.project) && t.createdAt >= since - 90 * 86400_000)
  const stageSet = [...new Set([...DEFAULT_STAGES, ...board.pipelines.flatMap(p => p.stages)])]
  const columns = Object.fromEntries(stageSet.map(s => [s, tickets.filter(t => t.stage === s && !t.blocked).length]))
  const blockedNow = tickets.filter(t => t.blocked)
  const stageDur = {}, blockedDur = {}
  for (const t of tickets) {
    const h = t.history || []
    for (let i = 0; i < h.length; i++) {
      const end = h[i + 1]?.at ?? (t.stage === 'released' ? h[i].at : Date.now())
      const d = Math.max(0, end - h[i].at)
      if (h[i].to.startsWith('blocked:')) (blockedDur[h[i].to.slice(8)] ||= []).push(d)
      else (stageDur[h[i].to] ||= []).push(d)
    }
  }
  const released = tickets.filter(t => t.releasedAt && t.releasedAt >= since)
  const cycles = released.map(t => t.releasedAt - t.createdAt)
  const perDay = {}
  for (const t of released) { const k = new Date(t.releasedAt).toISOString().slice(0, 10); perDay[k] = (perDay[k] || 0) + 1 }
  const bugs = tickets.filter(t => t.type === 'bug' && t.parent)
  const groupBy = key => {
    const g = {}
    for (const t of tickets) {
      const k = key(t) || '(none)'
      const o = g[k] ||= { released: 0, bugs: 0, findings: 0, reviews: 0, cost: 0, cycles: [], escalations: 0, touches: 0 }
      if (t.releasedAt) { o.released++; o.cycles.push(t.releasedAt - t.createdAt) }
      o.bugs += tickets.filter(b => b.type === 'bug' && b.parent === t.id).length
      const firstReview = (t.runs || []).find(r => r.kind === 'review')
      if (firstReview) { o.reviews++; o.findings += (t.findings || []).length }
      o.cost += (t.runs || []).reduce((s, r) => s + (r.cost || 0), 0)
      const models = new Set((t.runs || []).map(r => r.model))
      if (models.size > 1) o.escalations++
      o.touches += (t.runs || []).filter(r => ['review', 'qa', 'fix'].includes(r.kind)).length
    }
    return Object.fromEntries(Object.entries(g).map(([k, o]) => [k, { ...o, avgCycleH: o.cycles.length ? Math.round(o.cycles.reduce((a, b) => a + b, 0) / o.cycles.length / 3600_000 * 10) / 10 : null, bugRatio: o.released ? Math.round(o.bugs / o.released * 100) / 100 : null, cycles: undefined }]))
  }
  const qaDist = { 0: 0, 1: 0, 2: 0, '3+': 0 }
  for (const t of released) { const fails = (t.qaResults || []).filter(q => !q.pass).length; qaDist[fails >= 3 ? '3+' : fails]++ }
  const runCost = kind => tickets.reduce((s, t) => s + (t.runs || []).filter(r => r.kind === kind).reduce((a, r) => a + (r.cost || 0), 0), 0)
  const sunk = tickets.filter(t => !t.releasedAt).reduce((s, t) => s + (t.runs || []).reduce((a, r) => a + (r.cost || 0), 0), 0)
  const caseStats = {}
  for (const t of tickets) for (const q of t.qaResults || []) for (const c of q.cases || []) { const o = caseStats[c.name] ||= { runs: 0, fails: 0 }; o.runs++; if (c.pass === false) o.fails++ }
  const stale = Object.entries(caseStats).filter(([, o]) => o.runs >= 2 && !o.fails).length
  res.json({
    days, total: tickets.length, columns, blockedNow: blockedNow.map(t => ({ id: t.id, title: t.title, category: t.blocked.category, since: t.blocked.at })),
    timeInStageH: Object.fromEntries(Object.entries(stageDur).map(([s, arr]) => [s, { avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length / 3600_000 * 10) / 10, p90: Math.round((pct(arr, 0.9) || 0) / 3600_000 * 10) / 10, n: arr.length }])),
    blockedByReasonH: Object.fromEntries(Object.entries(blockedDur).map(([c, arr]) => [c, Math.round(arr.reduce((a, b) => a + b, 0) / 3600_000 * 10) / 10])),
    cycle: { p50h: cycles.length ? Math.round(pct(cycles, 0.5) / 3600_000 * 10) / 10 : null, p90h: cycles.length ? Math.round(pct(cycles, 0.9) / 3600_000 * 10) / 10 : null, released: released.length },
    throughputPerDay: perDay,
    bugRatio: released.length ? Math.round(bugs.length / released.length * 100) / 100 : null,
    qaCyclesDist: qaDist,
    byTeam: groupBy(t => board.teams.find(x => x.id === t.team)?.name),
    byModel: groupBy(t => t.model || projCfg(board, t.project).defaultModel || '(default)'),
    costByStage: { dev: runCost('dev') + runCost('fix'), review: runCost('review'), qa: runCost('qa') + runCost('analyze') },
    costSunkUnreleased: sunk,
    costPerReleased: released.length ? (tickets.reduce((s, t) => s + (t.runs || []).reduce((a, r) => a + (r.cost || 0), 0), 0) - sunk) / released.length : null,
    staleRegressionCases: stale,
  })
})
}

export { boardRuns, projCfg, readBoard, tkt, writeBoard }
