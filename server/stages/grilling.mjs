// Stage 11 — `grilling`, gate G1. And the accept half of gate G2.
//
// This is the stage the pipeline exists to reach, and almost everything unusual in here protects one
// rule: **the human ends the grilling, always.** There is deliberately no machine "are we done"
// check — not a question count, not an unresolved-AC gate. Both were considered on the map and
// rejected (`.wayfinder/tickets/04-how-the-grilling-surfaces.md`). A *Generate sub-tickets* action is
// live from the first turn; the agent asks questions and never decides it is satisfied.
//
// Three consequences that are load-bearing rather than tidy:
//
//   * **Nothing here is a new chat engine.** `runAgent({cwd, prompt, resume})` with `{sessionId, cwd}`
//     persisted is the machinery `ticket.mjs:995-1005` already uses for the design chat, and it
//     already survives a page reload. Reused verbatim.
//   * **ADRs are written INCREMENTALLY, by the agent, after every question.** The transcript is not
//     the durable record — only `{sessionId, cwd}` ever was — and an agent session store can expire
//     or be pruned. Anything decided but unwritten is lost on a cold resume, so writing as we go
//     bounds that loss to the current question. The ADRs go to `docs/<KEY>/`, git-tracked, and the
//     server VERIFIES after each turn rather than trusting the prompt.
//   * **"Come back tomorrow" therefore has two tiers**, and both are reported by name: the decisions
//     are safe (tier 1, in the repo), the conversational context is best-effort (tier 2, gone when
//     the session store no longer holds the id). A resume that finds no session says so — it never
//     silently starts a fresh conversation as if nothing was lost.
//
// G2 lives here too because it is the same human, one screen later: propose → the human edits the
// decomposition inline → a SEPARATE explicit accept call. Nothing writes `docs/<KEY>/N.md` until
// that call, and the call runs the `subtickets` stage through the runner's own door, so a stage that
// is not on this server yet is a reasoned `unavailable` and never a crash.

import fs from 'node:fs'
import path from 'node:path'

import { entry, readManifest } from '../../lib/dossier.mjs'
import { STAGES as GRAPH } from '../../lib/stage-graph.mjs'
import { runAgent } from '../../lib/agent.mjs'
import { parseTasks, validateTasks } from '../../lib/decomposition.mjs'
import { dossierCache } from '../../lib/paths.mjs'
import { capabilityPrompt, normalizeKey, repoFor, workspaceById } from '../ticket.mjs'

const STAGE = 'grilling'
const TURN_TIMEOUT = 900_000            // same budget as the other paid stages (`ticket.mjs:553`)
const TURN_LOG_CAP = 200                // the best-effort transcript is bounded; the ADRs are not

const KEY = k => String(k || '').toUpperCase()
const docsDir = (repoDir, key) => path.join(repoDir, 'docs', KEY(key))
const declared = GRAPH.find(s => s.stage === STAGE) || { hard: [], soft: [] }

// ---------------------------------------------------------------------------------------------
// The two tiers, as two files
// ---------------------------------------------------------------------------------------------

/**
 * Tier 1 — the durable record. `docs/<KEY>/adr/` and `docs/<KEY>/glossary.md`, git-tracked, in the
 * target repo, reviewable in the pull request and travelling with a clone.
 */
const adrDir = (repoDir, key) => path.join(docsDir(repoDir, key), 'adr')
const GLOSSARY = 'glossary.md'

/**
 * Tier 2 — the session pointer and a bounded log of what was asked and answered. DISPOSABLE half on
 * purpose: `{sessionId, cwd}` is machine-local and worthless on another machine, and the log is a
 * convenience for redrawing the panel after a reload, not the record of any decision. Losing this
 * file costs the conversation's context and no decision — which is the whole point of tier 1.
 */
const sessionFile = cacheDir => path.join(cacheDir, 'grilling.session.json')

const readSession = cacheDir => {
  try { return JSON.parse(fs.readFileSync(sessionFile(cacheDir), 'utf8')) }
  catch { return { sessionId: null, cwd: null, turns: [], endedAt: null } }
}

/** tmp + rename, like the manifest: a crash mid-write must not leave an unreadable session file. */
function writeSession(cacheDir, s) {
  fs.mkdirSync(cacheDir, { recursive: true })
  const target = sessionFile(cacheDir)
  fs.writeFileSync(target + '.tmp', JSON.stringify(s, null, 2))
  fs.renameSync(target + '.tmp', target)
  return s
}

/** Repo-relative, because the repo half is committed and travels with the clone (spec §2). */
function decisionsOnDisk(repoDir, key) {
  const rel = []
  try {
    for (const f of fs.readdirSync(adrDir(repoDir, key)).sort()) {
      if (f.endsWith('.md')) rel.push(`docs/${KEY(key)}/adr/${f}`)
    }
  } catch { /* no ADR directory yet — the first turn has not written one */ }
  if (fs.existsSync(path.join(docsDir(repoDir, key), GLOSSARY))) rel.push(`docs/${KEY(key)}/${GLOSSARY}`)
  return rel
}

// ---------------------------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------------------------

/**
 * Why the grilling cannot start, in words naming the upstream stage — or null.
 *
 * Hard inputs are `ticket` and `ac`. Everything else is soft and shows on screen as a visible gap
 * with its reason, because the human decides whether to grill now or fix the gap first: there is no
 * machine threshold for "enough dossier to be worth grilling".
 */
export function blockedBy(manifest) {
  for (const dep of declared.hard) {
    const e = manifest?.stages?.[dep]
    if (!e || e.status !== 'ok') {
      return `\`${dep}\` is ${e?.status || 'not run'}${e?.reason ? ` (${e.reason})` : ''}, and the grilling has nothing to grill without it`
    }
  }
  return null
}

/** The soft inputs that are NOT available, so the panel can show the gaps rather than hide them. */
export function gaps(manifest) {
  return declared.soft
    .map(dep => {
      const e = manifest?.stages?.[dep]
      return e?.status === 'ok' ? null : { stage: dep, reason: e?.reason || `${dep} has not run` }
    })
    .filter(Boolean)
}

// ---------------------------------------------------------------------------------------------
// The seeded agenda
// ---------------------------------------------------------------------------------------------

const AGENDA_HEADING = /^##\s+Unspecified\s*[—–-]\s*needs an answer\s*$/im

/**
 * `ac.md`'s `## Unspecified — needs an answer` section IS the grilling's agenda — it is the list the
 * AC stage was told to write instead of guessing. Returns null when the section is absent, which the
 * caller reports rather than papering over: an agenda invented here would be the guess the AC stage
 * refused to make.
 */
export function agendaFrom(md) {
  const m = AGENDA_HEADING.exec(md || '')
  if (!m) return null
  const rest = md.slice(m.index + m[0].length)
  const next = /^##\s+/m.exec(rest)
  const body = (next ? rest.slice(0, next.index) : rest).trim()
  return body || null
}

const repoHalf = e => (e?.artifacts || []).filter(p => !path.isAbsolute(p))
const readRel = (repoDir, rel) => { try { return fs.readFileSync(path.resolve(repoDir, rel), 'utf8') } catch { return null } }

// ---------------------------------------------------------------------------------------------
// One turn
// ---------------------------------------------------------------------------------------------

const RULES = key => `You are running a GRILLING session with the engineer who owns ${KEY(key)}.

Ask **ONE question at a time**, and nothing else. No preamble, no summary of the ticket, no list of
things you plan to ask. The reply you get is a human's answer to that one question.

You are NEVER the one who decides the grilling is finished. The human ends it with a button you
cannot see. Do not ask whether they are done, do not offer to wrap up, do not say "one last thing".
If you run out of agenda, keep going on what the answers just opened up.

# Write the decision down BEFORE you ask the next question

The moment an answer settles something, write it to disk, in this order: the ADR first, then your
next question. This session's transcript is NOT stored anywhere — only the session id is, and a
session store can expire. Anything decided but unwritten is lost. Writing as you go bounds that loss
to the question in flight.

- One ADR per decision: \`docs/${KEY(key)}/adr/NNN-short-slug.md\`, NNN zero-padded and increasing.
  Sections: \`# NNN. Title\`, \`## Status\` (accepted), \`## Context\` (the question you asked and why
  it was open), \`## Decision\` (the human's answer, in their words where they were specific),
  \`## Consequences\` (what this now forbids or requires downstream).
- Terms the answers define go in \`docs/${KEY(key)}/${GLOSSARY}\` — append, one \`## term\` per entry.
- Never rewrite an existing ADR to reflect a later answer. Supersede it with a new one and say so.

Your reply to this message is the question itself and nothing more.`

const detectLostSession = err => /no conversation|session.*not found|could not find.*session|invalid session/i.test(String(err || ''))

/**
 * One grilling turn. `text` is the human's answer, or empty for the opening question.
 *
 * Never throws: every failure here is one a person has to read and act on, so it comes back as a
 * field. Writes ADRs nowhere itself — the agent does, in the repo, with its own tools — but it
 * VERIFIES what landed after every turn, because "the prompt told it to" is not evidence.
 */
export async function turn(ctx, { text = '' } = {}, deps = {}) {
  const { repoDir, cacheDir, key, manifest } = ctx
  const run = deps.run || runAgent

  const blocked = blockedBy(manifest)
  if (blocked) return { error: blocked, blocked: true }

  const prev = readSession(cacheDir)
  const acRel = repoHalf(manifest?.stages?.ac)[0] || ''
  const acMd = readRel(repoDir, acRel)
  const agenda = agendaFrom(acMd)

  const opening = !prev.sessionId
  let prompt
  if (opening) {
    const ticketRel = repoHalf(manifest?.stages?.ticket)[0] || ''
    prompt = `${RULES(key)}

# The repository

You are in \`${path.basename(repoDir)}\`, checked out at \`${repoDir}\`. Read it before you assume.
${capabilityPrompt(repoDir)}

# The dossier for ${KEY(key)}

Repo-relative paths. Read the ones that bear on the question you are about to ask.

${[ticketRel && `- \`${ticketRel}\` — the ticket`, acRel && `- \`${acRel}\` — the acceptance criteria`]
  .concat(Object.values(manifest?.stages || {})
    .filter(e => e.status === 'ok' && e.stage !== 'ticket' && e.stage !== 'ac')
    .flatMap(e => repoHalf(e).map(p => `- \`${p}\` — from the \`${e.stage}\` stage`)))
  .filter(Boolean).join('\n')}

# Your agenda

${agenda
  ? `Taken verbatim from \`${acRel}\`'s \`## Unspecified — needs an answer\`. These are the questions the
acceptance criteria refused to guess at. Work through them, hardest first, and follow the answers
wherever they go — this list is the seed, not the ceiling.

${agenda}`
  : `\`${acRel || 'the ac artifact'}\` has no \`## Unspecified — needs an answer\` section, so there is no
seeded agenda. Say so in your first message, then derive your own questions from the criteria and
the repository — and treat that missing section as itself worth asking about.`}

Ask your first question now.`
  } else {
    prompt = text
  }

  const before = decisionsOnDisk(repoDir, key)
  let out = await run({ cwd: repoDir, prompt, resume: prev.sessionId || undefined, model: deps.model, timeoutMs: TURN_TIMEOUT })

  // Tier 2 gone. Reported by name and retried from scratch EXPLICITLY, because a fresh conversation
  // that looks like a resumed one is the failure this whole two-tier story exists to make visible:
  // the decisions are still on disk, the context behind them is not.
  let contextLost = null
  if (out.error && prev.sessionId && detectLostSession(out.error)) {
    contextLost = `the agent session ${prev.sessionId} is no longer in the session store (${String(out.error).slice(0, 200)}). The DECISIONS are safe — ${before.length} file(s) under docs/${KEY(key)}/ — but the conversation's context is gone, so this turn starts a new session that has read them rather than remembered them`
    out = await run({
      cwd: repoDir, model: deps.model, timeoutMs: TURN_TIMEOUT,
      prompt: `${RULES(key)}

# You are resuming a grilling that lost its conversational context

An earlier session for ${KEY(key)} ended without being resumable. Its decisions survive, because they
were written down as they were made. READ THEM FIRST — they are yours, do not re-litigate them:

${before.map(p => `- \`${p}\``).join('\n') || '- (none were written before the context was lost)'}

The engineer's most recent message was:

${text || '(they had not answered anything yet)'}

Continue from there. One question.`,
    })
  }

  const after = decisionsOnDisk(repoDir, key)
  const wrote = after.filter(p => !before.includes(p))

  const turns = [...(prev.turns || [])]
  if (text) turns.push({ role: 'human', text, at: new Date().toISOString() })
  if (out.result) turns.push({ role: 'agent', text: out.result, at: new Date().toISOString(), wrote })

  const session = writeSession(cacheDir, {
    ...prev,
    // The two fields that were ever persisted, and the only ones that matter (`ticket.mjs:1002`).
    sessionId: out.sessionId || (contextLost ? null : prev.sessionId),
    cwd: repoDir,
    turns: turns.slice(-TURN_LOG_CAP),
    contextLost: contextLost || null,
    lastError: out.error || null,
    cost: (prev.cost || 0) + (out.cost || 0),
    endedAt: null,
  })

  return {
    question: out.result || null,
    error: out.error || null,
    contextLost,
    // Verified from disk, not from the agent's word for it. A turn that decided something and wrote
    // nothing is the one case where the loss is real, so it is reported rather than inferred.
    decisions: after,
    wrote,
    session: { sessionId: session.sessionId, cwd: session.cwd, turns: session.turns },
  }
}

// ---------------------------------------------------------------------------------------------
// The stage entry — written when, and only when, the human ends the grilling
// ---------------------------------------------------------------------------------------------

/**
 * `grilling` as the runner's stage contract sees it: `(ctx) => entry()`.
 *
 * Calling this IS the human ending the grilling. Nothing else writes this entry, which is what makes
 * `nextAction` return `blocked-on-human` for as long as the session runs — the poller has no door to
 * this stage at all (`ticket-pipeline.mjs:170`), so there is no path by which a machine ends it.
 */
export async function grilling(ctx) {
  const { repoDir, cacheDir, key, manifest } = ctx
  const tracked = manifest?.tracked !== false

  const blocked = blockedBy(manifest)
  if (blocked) return entry({ stage: STAGE, status: 'skipped', reason: blocked, tracked })

  const s = readSession(cacheDir)
  const decisions = decisionsOnDisk(repoDir, key)
  const missing = gaps(manifest)

  try { writeSession(cacheDir, { ...s, endedAt: new Date().toISOString() }) } catch { /* tier 2 only */ }

  const notes = [
    `ended by the human after ${(s.turns || []).filter(t => t.role === 'human').length} answer(s)`,
    decisions.length ? `${decisions.length} decision file(s) written as the session went` : 'NO decisions were written — the session ended without recording anything, so nothing downstream is grounded in it',
    missing.length ? `grilled without ${missing.map(g => `${g.stage} (${g.reason})`).join(', ')}` : null,
    s.contextLost ? 'the conversation lost its context at least once; the decisions on disk are the record' : null,
    tracked ? null : 'the workspace is not a git repo, so these decisions are written but not tracked',
  ].filter(Boolean)

  return entry({
    // `ok` with an empty decision list is still `ok`: the human ran the gate and chose to move on.
    // The reason says loudly that nothing was recorded, which is the honest version of that.
    stage: STAGE, status: 'ok', tracked, reason: notes.join(' · '),
    artifacts: decisions,
    provenance: {
      groundedIn: path.basename(repoDir),
      handoff: { passed: declared.soft.filter(d => !missing.some(g => g.stage === d)).concat(declared.hard), excluded: missing.map(g => g.stage) },
      model: 'claude', cost: s.cost ?? null, turns: (s.turns || []).length,
      sessionId: s.sessionId || null,
      contextLost: !!s.contextLost,
      consumedStale: [],
    },
  })
}

export const STAGES = { [STAGE]: grilling }

// ---------------------------------------------------------------------------------------------
// G2 — propose, edit inline, accept
// ---------------------------------------------------------------------------------------------

/** The repo file list `repo` cached, so `validateTasks` can check file scopes against the checkout. */
function repoFiles(manifest) {
  const cached = (manifest?.stages?.repo?.artifacts || []).find(p => path.isAbsolute(p) && p.endsWith('files.json'))
  if (!cached) return null
  try { return JSON.parse(fs.readFileSync(cached, 'utf8')).files || null } catch { return null }
}

/**
 * What G2 shows: the proposed decomposition, plus the two checks that the document itself cannot
 * show. `validateTasks` is the only thing in the repo that enforces the parallel-safety invariant
 * loush's worktree build depends on, and blast radius answers "task 3 touches a file with 40
 * importers — is that one task?". Both render ABOVE the document, for the reason at
 * `TicketSection.jsx:399-402`: a decomposition always reads as coherent.
 */
export function proposal(ctx) {
  const { repoDir, key, manifest } = ctx
  const dec = manifest?.stages?.decompose
  if (!dec || dec.status !== 'ok') {
    return { available: false, reason: `\`decompose\` is ${dec?.status || 'not run'}${dec?.reason ? ` (${dec.reason})` : ''}, so there is no split to accept` }
  }
  const rel = repoHalf(dec)[0] || ''
  const md = readRel(repoDir, rel)
  if (md == null) return { available: false, reason: `the decompose artifact (${rel || 'no path in its entry'}) could not be read under ${repoDir}` }

  const parsed = parseTasks(md)
  return {
    available: true, key: KEY(key), path: rel, md,
    validation: validateTasks(parsed, repoFiles(manifest)),
    blastRadius: manifest?.stages?.['blast-radius'] || null,
    // Everything below the fold is proposed, not accepted. `docs/<KEY>/N.md` does not exist yet and
    // will not until `accept` is called.
    accepted: !!manifest?.stages?.subtickets,
  }
}

/**
 * Accept the split. The edited markdown replaces the decompose artifact FIRST — the human's edit is
 * the accepted version, and `subtickets` reads the artifact rather than a payload, so there is
 * exactly one thing on disk that the sub-tickets were generated from.
 *
 * Then the `subtickets` stage runs through the runner's own door (`startStage`), which is what makes
 * a stage that does not exist on this server yet an explained `unavailable` entry rather than a
 * crash — and what keeps the manifest written in exactly one place.
 */
export async function accept(ws, key, { md, ctx }, deps = {}) {
  const p = proposal(ctx)
  if (!p.available) return [409, { error: p.reason }]

  const body = String(md ?? p.md)
  if (!body.trim()) return [400, { error: 'refusing to accept an empty decomposition — nothing would be written and the reason would be invisible' }]

  const target = path.resolve(ctx.repoDir, p.path)
  fs.writeFileSync(target + '.tmp', body.endsWith('\n') ? body : body + '\n')
  fs.renameSync(target + '.tmp', target)

  const start = deps.startStage || (await import('../ticket-pipeline.mjs')).startStage
  const [status, out] = await start(ws, key, 'subtickets')
  return [status, { ...out, accepted: p.path, tasks: parseTasks(body).tasks.length }]
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

export default function mountGrilling(app) {
  const resolve = (req, res) => {
    const key = normalizeKey(req.params.key)
    if (!key) { res.status(400).json({ error: `"${req.params.key}" is not a JIRA key — expected something like ABC-1234` }); return null }
    const asked = req.query.workspace || req.body?.workspace
    if (!asked) { res.status(400).json({ error: 'a project is required — select one before opening a ticket' }); return null }
    const ws = workspaceById(String(Array.isArray(asked) ? asked[0] : asked))
    if (!ws) { res.status(404).json({ error: `"${asked}" is not one of your open projects` }); return null }
    const repo = repoFor(ws)
    if (!repo.dir) { res.status(400).json({ error: repo.reason }); return null }
    return {
      key, ws,
      ctx: { repoDir: repo.dir, cacheDir: dossierCache(ws.id, key), key, manifest: readManifest(repo.dir, key) },
    }
  }

  // ---- G1: the session, rebuilt from disk on every read (nothing lives in browser state) ----
  app.get('/api/ticket/:key/grilling', (req, res) => {
    const r = resolve(req, res); if (!r) return
    const s = readSession(r.ctx.cacheDir)
    const blocked = blockedBy(r.ctx.manifest)
    res.json({
      key: r.key, blocked, gaps: gaps(r.ctx.manifest),
      started: !!s.sessionId || !!(s.turns || []).length,
      ended: !!s.endedAt,
      // The two tiers, named on the wire so the panel does not have to infer them.
      decisions: decisionsOnDisk(r.ctx.repoDir, r.key),
      contextLost: s.contextLost || null,
      // Best-effort, and labelled as such: this log lives in the disposable cache and is a
      // convenience for redrawing the panel, never the record of a decision.
      turns: s.turns || [], sessionId: s.sessionId || null,
    })
  })

  // ---- one turn. Empty text opens the session ----
  app.post('/api/ticket/:key/grilling/turn', async (req, res) => {
    const r = resolve(req, res); if (!r) return
    const out = await turn(r.ctx, { text: String(req.body?.text || '') })
    res.status(out.blocked ? 409 : 200).json(out)
  })

  // ---- G1's only exit: the human ends it. Live from the first turn, and the ONLY way this ends ----
  app.post('/api/ticket/:key/grilling/end', async (req, res) => {
    const r = resolve(req, res); if (!r) return
    const e = await grilling(r.ctx)
    // The runner owns every manifest write, so the entry goes back through its door rather than
    // being written here. `startStage` refuses `grilling` as a human gate — correctly — so this is
    // the one place that writes it, using the same `entry()` contract and nothing else.
    const { writeManifest } = await import('../../lib/dossier.mjs')
    const m = readManifest(r.ctx.repoDir, r.key)
    writeManifest(r.ctx.repoDir, r.key, { ...m, stages: { ...m.stages, [STAGE]: e } })
    res.json({ ok: true, entry: e })
  })

  // ---- G2: propose ----
  app.get('/api/ticket/:key/decomposition', (req, res) => {
    const r = resolve(req, res); if (!r) return
    res.json(proposal(r.ctx))
  })

  // ---- G2: the separate, explicit accept. Nothing writes docs/<KEY>/N.md before this ----
  app.post('/api/ticket/:key/decomposition/accept', async (req, res) => {
    const r = resolve(req, res); if (!r) return
    const [status, body] = await accept(r.ws, r.key, { md: req.body?.md, ctx: r.ctx })
    res.status(status).json(body)
  })
}
