import { CLAUDE, propose, readJson, track } from './dashboard-core.mjs'
import { exec, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { runAgent } from '../lib/agent.mjs'
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

const projCfg = (board, project) => ({ pipeline: 'default', base: 'main', branchPrefix: 'ticket/', mergeMethod: 'merge', requirePr: false, defaultModel: '', previewCmd: '', previewStopCmd: '', previewIdleMin: 240, qaSeesFindings: false, ...(board.projects[project] || {}) })

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

function recordRun(t, kind, model, r, handoff) {
  (t.runs ||= []).push({ at: Date.now(), kind, model: model || 'default', status: r.error ? 'error' : r.blocked ? 'blocked' : 'ok', cost: r.cost || 0, turns: r.turns || 0, ms: r.ms || 0, sessionId: r.sessionId || null, summary: (r.result || r.error || '').slice(0, 1500), handoff })
  const outcome = r.error ? 'failed' : r.blocked ? 'blocked' : 'passed'
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
    const r = await runAgent({ onSpawn: c => { const live = boardRuns.get(t.id); if (live) live.child = c }, cwd: t.worktree, prompt, model, resume })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    recordRun(t2, 'dev', model, r, { passed: ['ticket', 'sub-ticket breakdown', 'worktree codebase + CLAUDE.md', ...(reply ? ['unblock reply'] : [])], excluded: ['prior tickets', 'other branches'] })
    if (r.error) blockT(t2, 'dev agent', 'agent-error', r.error)
    else if (r.blocked) blockT(t2, 'dev agent', 'needs-input', r.blocked, r.blocked)
    else { stamp(t2, 'code-review', 'dev done — idle until you run code review'); conflictScan(b2, t2) }
    writeBoard(b2)
  })().catch(() => boardRuns.delete(t.id))
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
  const tickets = board.tickets.filter(t => !project || t.project === project).map(t => ({
    ...t,
    running: boardRuns.get(t.id) || null,
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

  // Branch and base are answered once, when the worktree is cut. Accepting an edit afterwards
  // would change the label without moving the checkout — the agent would keep committing to the
  // old branch while the board, the reviewer's diff and the merge all named the new one.
  for (const k of ['branch', 'base']) {
    if (req.body[k] === undefined || req.body[k] === t[k]) continue
    if (t.worktree && fs.existsSync(t.worktree)) {
      return res.status(409).json({
        error: `${k} cannot be changed once the worktree exists`,
        detail: `${t.branch} is checked out at ${t.worktree}. Delete the ticket and re-file it, or rename the branch in git yourself.`,
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
app.post('/api/board/tickets/:id/stop', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  const run = boardRuns.get(t.id)
  if (!run) return res.status(400).json({ error: 'nothing is running on this ticket' })

  const file = transcriptFor(t, { startedAt: run.startedAt })
  t.resumeSessionId = file ? path.basename(file, '.jsonl') : null
  t.stoppedAt = Date.now()
  ;(t.history ||= []).push({ at: Date.now(), from: t.stage, to: t.stage, note: `${run.kind} agent stopped after ${Math.round((Date.now() - run.startedAt) / 1000)}s` })
  writeBoard(board)

  const child = run.child
  if (!child) return res.json({ ok: true, note: 'the run was marked stopped, but its process had not started yet' })
  try { child.kill('SIGTERM') } catch {}
  // SIGTERM is a request. A child that ignores it keeps running and keeps spending, so the escalation
  // is scheduled rather than hoped for.
  setTimeout(() => { try { if (boardRuns.get(t.id)?.child === child) child.kill('SIGKILL') } catch {} }, 5000).unref?.()
  res.json({ ok: true, kind: run.kind, resumeSessionId: t.resumeSessionId })
})

app.post('/api/board/tickets/:id/analyze', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t) return res.status(404).json({ error: 'no such ticket' })
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'a run is already active on this ticket' })
  const { model } = teamStage(board, t, 'dev')
  boardRuns.set(t.id, { kind: 'analyze', startedAt: Date.now() })
  res.json({ ok: true })
  ;(async () => {
    const prompt = `Analyze this ticket and propose a breakdown into independently-workable sub-tickets (e.g. "add API endpoint", "add frontend form", "write migration"). Explore the codebase briefly to ground the breakdown.\n\n## Ticket: ${t.title}\n${t.desc}\n\nReturn ONLY a JSON array: [{"title": "...", "desc": "1-3 sentence scope incl. likely files", "deps": [indices of sub-tickets this one is blocked by]}]. 2-6 sub-tickets; fewer is better.`
    const r = await runAgent({ onSpawn: c => { const live = boardRuns.get(t.id); if (live) live.child = c }, cwd: t.project, prompt, model, timeoutMs: 300_000 })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    recordRun(t2, 'analyze', model, r, { passed: ['ticket title+desc', 'codebase (agent-explored)'], excluded: ['prior tickets', 'chat history'] })
    t2.proposal = r.error ? null : (extractJson(r.result) || []).filter(s => s.title).slice(0, 8)
    writeBoard(b2)
  })().catch(() => boardRuns.delete(t.id))
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
      '\nReturn ONLY JSON: [{"severity": "critical|high|medium|low", "file": "path", "summary": "one sentence"}]. Empty array [] if clean. critical/high = must fix before QA.',
    ].filter(Boolean).join('\n')
    const r = await runAgent({ onSpawn: c => { const live = boardRuns.get(t.id); if (live) live.child = c }, cwd: t.worktree, prompt, model, timeoutMs: 900_000 })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    recordRun(t2, 'review', model, r, { passed: ['diff vs ' + baseOf(b2, t2), 'ticket', 'dev agent summary'], excluded: ['dev agent raw transcript'] })
    if (r.error) blockT(t2, 'review agent', 'agent-error', r.error)
    else {
      t2.findings = (extractJson(r.result) || []).filter(f => f.summary).map(f => ({ ...f, at: Date.now() }))
      const blocking = t2.findings.filter(f => ['critical', 'high'].includes(f.severity))
      if (!blocking.length) { stamp(t2, 'ready-for-qa', `review clean (${t2.findings.length} minor) — idle until you run QA`); startPreview(b2, t2) }
      else stamp(t2, 'code-review', `${blocking.length} blocking finding${blocking.length === 1 ? '' : 's'}`)
    }
    writeBoard(b2)
  })().catch(() => boardRuns.delete(t.id))
})

app.post('/api/board/tickets/:id/fix', (req, res) => {
  const board = readBoard(); const t = tkt(board, req.params.id)
  if (!t?.findings?.length) return res.status(400).json({ error: 'no findings to fix' })
  if (boardRuns.has(t.id)) return res.status(409).json({ error: 'already running' })
  const fixes = (t.runs || []).filter(r => r.kind === 'fix').length
  if (fixes >= 3) { blockT(t, 'fix loop', 'max-iterations', '3 fix iterations without a clean review — take over manually'); writeBoard(board); return res.status(400).json({ error: 'max fix iterations hit — ticket blocked' }) }
  const { model } = teamStage(board, t, 'dev')
  const cfg = projCfg(board, t.project)
  stamp(t, 'fixing', 'auto-fixing review findings (' + (fixes + 1) + '/3)')
  boardRuns.set(t.id, { kind: 'fix', startedAt: Date.now() })
  writeBoard(board)
  res.json({ ok: true })
  ;(async () => {
    const prompt = `Fix these code-review findings on the current branch (diff vs ${baseOf(board, t)}). Commit the fixes. Do NOT re-architect — address the findings only.\n\n## Ticket: ${t.title}\n\n## Findings\n${t.findings.map(f => `- [${f.severity}] ${f.file}: ${f.summary}`).join('\n')}`
    const r = await runAgent({ onSpawn: c => { const live = boardRuns.get(t.id); if (live) live.child = c }, cwd: t.worktree, prompt, model, resume: (t.runs || []).filter(x => x.kind === 'dev' && x.sessionId).pop()?.sessionId })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    recordRun(t2, 'fix', model, r, { passed: ['findings', 'original diff context (resumed session when possible)'], excluded: ['full codebase re-read'] })
    if (r.error) blockT(t2, 'fix agent', 'agent-error', r.error)
    // The findings the fix run addressed are cleared: leaving them on the ticket says "reviewed
    // and still broken" to anyone — human or autopilot — reading the ticket before the re-review.
    else { t2.findings = []; stamp(t2, 'code-review', 'fixes committed — re-run code review') }
    writeBoard(b2)
  })().catch(() => boardRuns.delete(t.id))
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
    const r = await runAgent({ onSpawn: c => { const live = boardRuns.get(t.id); if (live) live.child = c }, cwd: t.worktree, prompt, model, timeoutMs: 1800_000 })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    recordRun(t2, 'designqa', model, r, { passed: ['ticket', 'figma links', 'local captures', 'content sheet', 'running app'], excluded: ['code-review findings'] })
    if (r.error) { blockT(t2, 'design QA agent', 'agent-error', r.error); return writeBoard(b2) }
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
  })().catch(() => boardRuns.delete(t.id))
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
    const r = await runAgent({ onSpawn: c => { const live = boardRuns.get(t.id); if (live) live.child = c }, cwd: t.worktree, prompt, model, timeoutMs: 1800_000 })
    const b2 = readBoard(); const t2 = tkt(b2, t.id)
    boardRuns.delete(t.id)
    if (!t2) return
    recordRun(t2, 'qa', model, r, { passed: ['ticket+AC', 'changed files list', 'preview URL + QA inputs', ...(cfg.qaSeesFindings ? ['review findings (opt-in)'] : [])], excluded: cfg.qaSeesFindings ? [] : ['code-review findings'] })
    if (r.error) return blockT(t2, 'QA agent', 'agent-error', r.error), writeBoard(b2)
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
  })().catch(() => boardRuns.delete(t.id))
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
